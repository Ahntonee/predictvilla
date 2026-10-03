const router = require('express').Router();
const crypto = require('crypto');
const { pool } = require('../config/db');
const { sendVipWelcomeEmail } = require('../utils/email');
const { awardTokens, REWARDS } = require('../services/tokens');

router.post('/paystack', async (req, res) => {
  const sig = req.headers['x-paystack-signature'];
  const secret = process.env.PAYSTACK_SECRET_KEY || '';
  const hash = crypto.createHmac('sha512', secret).update(req.body).digest('hex');

  if (hash !== sig) {
    console.error('[Webhook] Paystack signature mismatch');
    return res.status(401).json({ message: 'Invalid signature' });
  }

  let event;
  try { event = JSON.parse(req.body.toString()); } catch (e) {
    console.error('[Webhook] JSON parse error:', e.message);
    return res.status(400).end();
  }

  try {
    if (event.event === 'charge.success') {
      const { reference, metadata, amount, currency } = event.data;
      const plan = metadata?.plan;
      const userId = parseInt(metadata?.user_id);
      if (!userId || !plan) {
        console.warn('[Webhook] charge.success missing user_id or plan in metadata');
      } else {
        const DURATIONS = { monthly: 30, quarterly: 90, annual: 365 };
        const dur = DURATIONS[plan] || 30;

        // Extension logic: extend from current expiry if active, else start from now
        const now = new Date();
        const [[currentSub]] = await pool.query(
          "SELECT expires_at FROM subscriptions WHERE user_id=? AND status='active' ORDER BY expires_at DESC LIMIT 1",
          [userId]
        );
        const baseDate = (currentSub && new Date(currentSub.expires_at) > now)
          ? new Date(currentSub.expires_at)
          : now;
        const expiresAt = new Date(baseDate.getTime() + dur * 24 * 60 * 60 * 1000);

        const [result] = await pool.query(
          `INSERT IGNORE INTO subscriptions (user_id, plan, status, provider, paystack_reference, amount, currency, expires_at)
           VALUES (?,?,'active','paystack',?,?,?,?)`,
          [userId, plan, reference, amount / 100, currency, expiresAt]
        );
        await pool.query("UPDATE users SET role='vip' WHERE id=?", [userId]);

        if (result.affectedRows > 0) {
          const [[user]] = await pool.query('SELECT name, email FROM users WHERE id=?', [userId]);
          if (user) {
            const telegramLink = process.env.TELEGRAM_VIP_INVITE_LINK;
            try { await sendVipWelcomeEmail({ name: user.name, email: user.email, plan, telegramLink }); } catch {}
          }
          try { await awardTokens(userId, REWARDS.VIP_UPGRADE, `VIP upgrade bonus — ${plan} plan`); } catch {}
        }
      }
    }

    if (event.event === 'subscription.disable' || event.event === 'subscription.not_renew') {
      // Paystack passes user_id in customer.metadata or subscription metadata
      const meta = event.data?.metadata || event.data?.customer?.metadata || {};
      const userId = parseInt(meta?.user_id || event.data?.customer?.id);
      if (userId) {
        // Mark active subscriptions as cancelled (not expired — expiry middleware handles role demotion)
        await pool.query(
          "UPDATE subscriptions SET status='cancelled' WHERE user_id=? AND status='active'",
          [userId]
        );
      } else {
        console.warn('[Webhook] subscription.disable: no user_id in metadata', JSON.stringify(event.data?.customer));
      }
    }

    if (event.event === 'subscription.expiry_update') {
      const meta = event.data?.metadata || event.data?.customer?.metadata || {};
      const userId = parseInt(meta?.user_id);
      const reference = event.data?.most_recent_invoice?.transaction;
      if (userId && event.data?.next_payment_date) {
        const expiresAt = new Date(event.data.next_payment_date);
        await pool.query(
          "UPDATE subscriptions SET expires_at=? WHERE user_id=? AND status='active' ORDER BY expires_at DESC LIMIT 1",
          [expiresAt, userId]
        );
      }
    }
  } catch (err) {
    console.error('[Webhook] Paystack handler error:', err.message, err.stack);
  }

  res.status(200).json({ received: true });
});

module.exports = router;
