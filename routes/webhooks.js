const router = require('express').Router();
const crypto = require('crypto');
const { pool } = require('../config/db');
const { sendVipWelcomeEmail } = require('../utils/email');
const { awardTokens, REWARDS } = require('../services/tokens');
const { getSubscriptionPlan } = require('../config/subscriptionPlans');

router.post('/paystack', async (req, res) => {
  const sig = req.headers['x-paystack-signature'];
  const secret = process.env.PAYSTACK_SECRET_KEY || '';
  const hash = crypto.createHmac('sha512', secret).update(req.body).digest('hex');

  if (hash !== sig) return res.status(401).json({ message: 'Invalid signature' });

  let event;
  try { event = JSON.parse(req.body.toString()); } catch { return res.status(400).end(); }

  try {
    if (event.event === 'charge.success') {
      const { reference, metadata, amount, currency } = event.data;
      const plan = metadata?.plan;
      const userId = metadata?.user_id;
      if (userId && plan) {
        const selectedPlan = getSubscriptionPlan(plan, currency === 'USD' ? 'USD' : 'NGN');
        if (!selectedPlan) return res.status(400).json({ message: 'Invalid subscription plan' });
        const dur = selectedPlan.days;
        const expiresAt = new Date(Date.now() + dur * 24 * 60 * 60 * 1000);
        const [result] = await pool.query(
          `INSERT IGNORE INTO subscriptions (user_id, plan, tier, status, provider, paystack_reference, amount, currency, expires_at)
           VALUES (?,?,?,'active','paystack',?,?,?,?)`,
          [userId, plan, selectedPlan.tier, reference, amount / 100, currency, expiresAt]
        );
        await pool.query("UPDATE users SET role='vip' WHERE id=?", [userId]);

        // Send VIP welcome email only when a new subscription row was created
        if (result.affectedRows > 0) {
          const [[user]] = await pool.query('SELECT name, email FROM users WHERE id=?', [userId]);
          if (user) {
            const telegramLink = process.env.TELEGRAM_VIP_INVITE_LINK;
            try { await sendVipWelcomeEmail({ name: user.name, email: user.email, plan: selectedPlan.tier, telegramLink }); } catch {}
          }
          try { await awardTokens(userId, REWARDS.VIP_UPGRADE, `VIP upgrade bonus — ${plan} plan`); } catch {}
        }
      }
    }
    if (event.event === 'subscription.disable') {
      const userId = event.data?.customer?.metadata?.user_id;
      if (userId) {
        await pool.query("UPDATE subscriptions SET status='expired' WHERE user_id=? AND status='active'", [userId]);
        await pool.query("UPDATE users SET role='user' WHERE id=?", [userId]);
      }
    }
  } catch (err) {
    console.error('[Webhook] Paystack error:', err.message);
  }

  res.status(200).json({ received: true });
});

module.exports = router;
