const axios = require('axios');
const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');
const { sendVipWelcomeEmail, sendExpiryReminderEmail } = require('../utils/email');

// ── Plan duration map ─────────────────────────────────────────────────────────
const DURATIONS = {
  // Tiered plans (3 tiers × 2 billing periods)
  basic_biweekly:    14,
  basic_monthly:     30,
  standard_biweekly: 14,
  standard_monthly:  30,
  diamond_biweekly:  14,
  diamond_monthly:   30,
  // Legacy IDs kept for backward compat with existing DB records
  biweekly: 14, monthly: 30, quarterly: 90, annual: 365,
};

// Nigerian Naira prices (differentiated per tier)
const NIGERIA_PRICES = {
  basic_biweekly:    parseInt(process.env.NGN_BASIC_BIWEEKLY)    || 3000,
  basic_monthly:     parseInt(process.env.NGN_BASIC_MONTHLY)     || 5000,
  standard_biweekly: parseInt(process.env.NGN_STANDARD_BIWEEKLY) || 5000,
  standard_monthly:  parseInt(process.env.NGN_STANDARD_MONTHLY)  || 10000,
  diamond_biweekly:  parseInt(process.env.NGN_DIAMOND_BIWEEKLY)  || 10000,
  diamond_monthly:   parseInt(process.env.NGN_DIAMOND_MONTHLY)   || 20000,
  // Legacy
  biweekly: 5000, monthly: 7500, quarterly: 19500, annual: 59900,
};

// International USD prices — flat rate across all tiers
const INTL_PRICES_USD = {
  basic_biweekly:    parseFloat(process.env.USD_BIWEEKLY) || 10,
  basic_monthly:     parseFloat(process.env.USD_MONTHLY)  || 15,
  standard_biweekly: parseFloat(process.env.USD_BIWEEKLY) || 10,
  standard_monthly:  parseFloat(process.env.USD_MONTHLY)  || 15,
  diamond_biweekly:  parseFloat(process.env.USD_BIWEEKLY) || 10,
  diamond_monthly:   parseFloat(process.env.USD_MONTHLY)  || 15,
  // Legacy
  biweekly: 15, monthly: 45, quarterly: 120, annual: 400,
};

// Extract tier from plan ID (e.g. 'diamond_monthly' → 'diamond')
function planTier(plan) {
  const t = plan.split('_')[0];
  return ['basic', 'standard', 'diamond'].includes(t) ? t : null;
}

function isNigeria(country) {
  if (!country) return true;
  return /nigeria|ng\b/i.test(country);
}

exports.DURATIONS = DURATIONS;
exports.NIGERIA_PRICES = NIGERIA_PRICES;
exports.INTL_PRICES_USD = INTL_PRICES_USD;
exports.isNigeria = isNigeria;
exports.planTier = planTier;

exports.getStatus = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    "SELECT plan, status, expires_at FROM subscriptions WHERE user_id=? AND status='active' ORDER BY expires_at DESC LIMIT 1",
    [req.user.id]
  );
  return successResponse(res, { subscription: rows[0] || null });
});

exports.paystackVerify = asyncHandler(async (req, res) => {
  const { reference, plan } = req.body;
  if (!reference || !plan) return errorResponse(res, 'reference and plan required', 400);
  if (!DURATIONS[plan]) return errorResponse(res, 'Invalid plan', 400);

  // Prevent duplicate activation of the same reference
  const [[dupRef]] = await pool.query(
    'SELECT id FROM subscriptions WHERE paystack_reference=?', [reference]
  );
  if (dupRef) return errorResponse(res, 'This payment reference has already been processed', 400);

  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    const txn = response.data.data;
    if (txn.status !== 'success') return errorResponse(res, 'Payment not successful', 400);

    // Verify currency — accept NGN (Nigerian) or USD (international)
    const txnCurrency = (txn.currency || 'NGN').toUpperCase();
    if (txnCurrency !== 'NGN' && txnCurrency !== 'USD') {
      return errorResponse(res, `Unsupported payment currency: ${txnCurrency}`, 400);
    }

    // Verify amount matches the correct price table for the currency (1% tolerance)
    const expectedAmount = txnCurrency === 'USD'
      ? INTL_PRICES_USD[plan]
      : NIGERIA_PRICES[plan];
    if (expectedAmount > 0 && txn.amount / 100 < expectedAmount * 0.99) {
      return errorResponse(res, 'Payment amount does not match the selected plan price', 400);
    }

    // Verify plan label in metadata matches (if Paystack sends it)
    if (txn.metadata?.plan && txn.metadata.plan !== plan) {
      return errorResponse(res, 'Payment plan mismatch', 400);
    }

    // Extension logic: extend from current expiry if still active, else start from now
    const now = new Date();
    const [[currentSub]] = await pool.query(
      "SELECT expires_at FROM subscriptions WHERE user_id=? AND status='active' ORDER BY expires_at DESC LIMIT 1",
      [req.user.id]
    );
    const baseDate = (currentSub && new Date(currentSub.expires_at) > now)
      ? new Date(currentSub.expires_at)
      : now;
    const expiresAt = new Date(baseDate.getTime() + DURATIONS[plan] * 24 * 60 * 60 * 1000);

    const tier = planTier(plan);
    await pool.query(
      `INSERT INTO subscriptions (user_id, plan, status, provider, paystack_reference, amount, currency, expires_at)
       VALUES (?,?,'active','paystack',?,?,?,?)`,
      [req.user.id, plan, reference, txn.amount / 100, txn.currency, expiresAt]
    );
    await pool.query(
      "UPDATE users SET role='vip', subscription_tier=COALESCE(?,subscription_tier), updated_at=NOW() WHERE id=?",
      [tier, req.user.id]
    );

    const telegramLink = process.env.TELEGRAM_VIP_INVITE_LINK;
    try { await sendVipWelcomeEmail({ ...req.user, plan, telegramLink }); } catch {}

    return successResponse(res, { expiresAt }, 'VIP subscription activated!');
  } catch (err) {
    if (err.response?.data) return errorResponse(res, 'Payment verification failed', 400);
    throw err;
  }
});

exports.cancel = asyncHandler(async (req, res) => {
  // Mark as cancelled but keep role=vip until expires_at — expiry middleware will downgrade on next request
  await pool.query(
    "UPDATE subscriptions SET status='cancelled' WHERE user_id=? AND status='active'",
    [req.user.id]
  );
  // Check if there's still time left on the cancelled plan
  const [[remaining]] = await pool.query(
    "SELECT expires_at FROM subscriptions WHERE user_id=? AND status='cancelled' AND expires_at > NOW() ORDER BY expires_at DESC LIMIT 1",
    [req.user.id]
  );
  if (!remaining) {
    await pool.query("UPDATE users SET role='user' WHERE id=?", [req.user.id]);
    return successResponse(res, null, 'Subscription cancelled');
  }
  return successResponse(res, { expires_at: remaining.expires_at },
    'Subscription cancelled. You keep VIP access until your billing period ends.');
});

// Admin
exports.adminGrant = asyncHandler(async (req, res) => {
  const { user_id, plan, days } = req.body;
  const dur = days ? parseInt(days) : (DURATIONS[plan] || 30);
  const expiresAt = new Date(Date.now() + dur * 24 * 60 * 60 * 1000);
  const tier = planTier(plan) || null;
  await pool.query(
    `INSERT INTO subscriptions (user_id, plan, status, provider, expires_at) VALUES (?,?,'active','manual',?)`,
    [user_id, plan || 'diamond_monthly', expiresAt]
  );
  await pool.query(
    "UPDATE users SET role='vip', subscription_tier=COALESCE(?,subscription_tier) WHERE id=?",
    [tier, user_id]
  );
  return successResponse(res, null, 'VIP granted');
});

exports.adminList = asyncHandler(async (req, res) => {
  // Lists subscriptions for admin filtering, searching and pagination.
  const { status, plan, search, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  let where = [];
  const params = [];
  if (status) { where.push('s.status=?'); params.push(status); }
  if (plan) { where.push('s.plan=?'); params.push(plan); }
  if (search) {
    where.push('(u.name LIKE ? OR u.email LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [[count]] = await pool.query(
    `SELECT COUNT(*) AS total FROM subscriptions s JOIN users u ON u.id=s.user_id ${whereStr}`,
    params
  );
  const [rows] = await pool.query(
    `SELECT s.*, u.name, u.email FROM subscriptions s JOIN users u ON u.id=s.user_id
     ${whereStr} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
    [...params, parseInt(limit), parseInt(offset)]
  );
  return successResponse(res, { subscriptions: rows, total: count.total });
});

exports.adminExtend = asyncHandler(async (req, res) => {
  const { days } = req.body;
  await pool.query(
    'UPDATE subscriptions SET expires_at = DATE_ADD(expires_at, INTERVAL ? DAY) WHERE id=?',
    [parseInt(days) || 30, req.params.id]
  );
  return successResponse(res, null, `Extended by ${days} days`);
});

exports.adminCancel = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT user_id FROM subscriptions WHERE id=?', [req.params.id]);
  if (rows.length) {
    await pool.query("UPDATE subscriptions SET status='cancelled' WHERE id=?", [req.params.id]);
    await pool.query("UPDATE users SET role='user' WHERE id=?", [rows[0].user_id]);
  }
  return successResponse(res, null, 'Subscription cancelled');
});

exports.adminNotifyExpiry = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT s.*, u.name, u.email FROM subscriptions s JOIN users u ON u.id=s.user_id WHERE s.id=?',
    [req.params.id]
  );
  if (!rows.length) return errorResponse(res, 'Not found', 404);
  await sendExpiryReminderEmail(rows[0]);
  return successResponse(res, null, 'Reminder sent');
});

exports.adminExport = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT s.id, u.name, u.email, s.plan, s.status, s.amount, s.provider,
            s.created_at, s.expires_at
     FROM subscriptions s JOIN users u ON u.id=s.user_id ORDER BY s.created_at DESC`
  );
  const escape = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const headers = ['id','name','email','plan','status','amount','provider','created_at','expires_at'];
  const csv = [headers.join(','), ...rows.map(row => headers.map(key => escape(row[key])).join(','))].join('\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="subscriptions.csv"');
  res.send(csv);
});
