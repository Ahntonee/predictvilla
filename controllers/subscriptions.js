const axios = require('axios');
const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');
const { sendVipWelcomeEmail, sendExpiryReminderEmail } = require('../utils/email');

const DURATIONS = { monthly: 30, quarterly: 90, annual: 365 };

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

  try {
    const response = await axios.get(
      `https://api.paystack.co/transaction/verify/${reference}`,
      { headers: { Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}` } }
    );
    const txn = response.data.data;
    if (txn.status !== 'success') return errorResponse(res, 'Payment not successful', 400);

    const expiresAt = new Date(Date.now() + DURATIONS[plan] * 24 * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO subscriptions (user_id, plan, status, provider, paystack_reference, amount, currency, expires_at)
       VALUES (?,?,'active','paystack',?,?,?,?)`,
      [req.user.id, plan, reference, txn.amount / 100, txn.currency, expiresAt]
    );
    await pool.query("UPDATE users SET role='vip', updated_at=NOW() WHERE id=?", [req.user.id]);

    const telegramLink = process.env.TELEGRAM_VIP_INVITE_LINK;
    try { await sendVipWelcomeEmail({ ...req.user, plan, telegramLink }); } catch {}

    return successResponse(res, { expiresAt }, 'VIP subscription activated!');
  } catch (err) {
    if (err.response?.data) return errorResponse(res, 'Payment verification failed', 400);
    throw err;
  }
});

exports.cancel = asyncHandler(async (req, res) => {
  await pool.query(
    "UPDATE subscriptions SET status='cancelled' WHERE user_id=? AND status='active'",
    [req.user.id]
  );
  await pool.query("UPDATE users SET role='user' WHERE id=?", [req.user.id]);
  return successResponse(res, null, 'Subscription cancelled');
});

// Admin
exports.adminGrant = asyncHandler(async (req, res) => {
  const { user_id, plan, days } = req.body;
  const dur = days ? parseInt(days) : (DURATIONS[plan] || 30);
  const expiresAt = new Date(Date.now() + dur * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO subscriptions (user_id, plan, status, provider, expires_at) VALUES (?,?,'active','manual',?)`,
    [user_id, plan || 'monthly', expiresAt]
  );
  await pool.query("UPDATE users SET role='vip' WHERE id=?", [user_id]);
  return successResponse(res, null, 'VIP granted');
});

exports.adminList = asyncHandler(async (req, res) => {
  const { status, plan, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;
  let where = [];
  const params = [];
  if (status) { where.push('s.status=?'); params.push(status); }
  if (plan) { where.push('s.plan=?'); params.push(plan); }
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [rows] = await pool.query(
    `SELECT s.*, u.name, u.email FROM subscriptions s JOIN users u ON u.id=s.user_id
     ${whereStr} ORDER BY s.created_at DESC LIMIT ? OFFSET ?`,
    [...params, parseInt(limit), parseInt(offset)]
  );
  return successResponse(res, { subscriptions: rows });
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
