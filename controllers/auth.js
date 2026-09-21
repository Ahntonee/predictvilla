const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../config/db');
const { generateToken, setTokenCookie, clearTokenCookie } = require('../utils/jwt');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');
const { sendVerificationEmail, sendWelcomeEmail, sendPasswordResetEmail } = require('../utils/email');
const { awardTokens, REWARDS } = require('../services/tokens');

// In-memory OTP brute-force tracker
const otpFailMap = new Map(); // email -> { count, resetAt }

function getOtpFails(email) {
  const entry = otpFailMap.get(email);
  if (!entry || Date.now() > entry.resetAt) return 0;
  return entry.count;
}
function incrementOtpFails(email) {
  const existing = otpFailMap.get(email);
  const resetAt = Date.now() + 15 * 60 * 1000;
  otpFailMap.set(email, { count: (existing?.count || 0) + 1, resetAt: existing?.resetAt || resetAt });
}
function clearOtpFails(email) {
  otpFailMap.delete(email);
}

exports.initiateRegister = asyncHandler(async (req, res) => {
  const { name, email, password, country } = req.body;
  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) return errorResponse(res, 'Email already registered', 409);

  const password_hash = await bcrypt.hash(password, 12);
  const token = String(Math.floor(100000 + Math.random() * 900000));
  const expires_at = new Date(Date.now() + 15 * 60 * 1000);

  await pool.query(
    `INSERT INTO pending_registrations (email, name, password_hash, country, token, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE name=VALUES(name), password_hash=VALUES(password_hash), country=VALUES(country), token=VALUES(token), expires_at=VALUES(expires_at)`,
    [email, name, password_hash, country || null, token, expires_at]
  );

  try { await sendVerificationEmail({ name, email, otp: token }); } catch {}

  return successResponse(res, { email }, 'Verification code sent to your email', 201);
});

exports.verifyRegistration = asyncHandler(async (req, res) => {
  const { email, token } = req.body;

  if (getOtpFails(email) >= 5) {
    return errorResponse(res, 'Too many failed attempts. Try again in 15 minutes.', 429);
  }

  const [rows] = await pool.query(
    'SELECT * FROM pending_registrations WHERE email = ? AND expires_at > NOW()',
    [email]
  );
  if (!rows.length) return errorResponse(res, 'Verification code expired or not found', 400);

  const reg = rows[0];
  if (reg.token !== token) {
    incrementOtpFails(email);
    return errorResponse(res, 'Invalid verification code', 400);
  }

  clearOtpFails(email);

  const [result] = await pool.query(
    'INSERT INTO users (name, email, password_hash, country) VALUES (?, ?, ?, ?)',
    [reg.name, reg.email, reg.password_hash, reg.country]
  );
  await pool.query('DELETE FROM pending_registrations WHERE email = ?', [email]);

  const user = { id: result.insertId, name: reg.name, email: reg.email, role: 'user' };
  const jwtToken = generateToken({ id: user.id, role: user.role });
  setTokenCookie(res, jwtToken, req);

  try { await sendWelcomeEmail(user); } catch {}
  try { await awardTokens(result.insertId, REWARDS.SIGNUP, 'Welcome bonus — account created'); } catch {}

  return successResponse(res, { user }, 'Account created successfully', 201);
});

exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const [rows] = await pool.query(
    'SELECT id, name, email, password_hash, role, is_banned FROM users WHERE email = ?',
    [email]
  );
  if (!rows.length) return errorResponse(res, 'Invalid email or password', 401);
  const user = rows[0];
  if (user.is_banned) return errorResponse(res, 'Account suspended', 403);
  const match = await bcrypt.compare(password, user.password_hash);
  if (!match) return errorResponse(res, 'Invalid email or password', 401);

  const jwtToken = generateToken({ id: user.id, role: user.role });
  setTokenCookie(res, jwtToken, req);

  return successResponse(res, { user: { id: user.id, name: user.name, email: user.email, role: user.role } }, 'Login successful');
});

exports.logout = asyncHandler(async (req, res) => {
  clearTokenCookie(res, req);
  return successResponse(res, null, 'Logged out');
});

exports.me = asyncHandler(async (req, res) => {
  const [subs] = await pool.query(
    `SELECT plan, status, expires_at FROM subscriptions WHERE user_id = ? AND status = 'active' ORDER BY expires_at DESC LIMIT 1`,
    [req.user.id]
  );
  return successResponse(res, { user: req.user, subscription: subs[0] || null });
});

exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const [rows] = await pool.query('SELECT id, name FROM users WHERE email = ?', [email]);
  if (rows.length) {
    const rawToken = crypto.randomBytes(32).toString('hex');
    const hashedToken = crypto.createHash('sha256').update(rawToken).digest('hex');
    const expires = new Date(Date.now() + 60 * 60 * 1000);
    await pool.query(
      'UPDATE users SET password_reset_token = ?, password_reset_expires = ? WHERE email = ?',
      [hashedToken, expires, email]
    );
    const resetUrl = `${process.env.SITE_URL}/reset-password.html?token=${rawToken}`;
    try { await sendPasswordResetEmail({ name: rows[0].name, email, resetUrl }); } catch {}
  }
  return successResponse(res, null, 'If that email exists, a reset link has been sent');
});

exports.resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
  const [rows] = await pool.query(
    'SELECT id FROM users WHERE password_reset_token = ? AND password_reset_expires > NOW()',
    [hashedToken]
  );
  if (!rows.length) return errorResponse(res, 'Invalid or expired reset token', 400);

  const hash = await bcrypt.hash(password, 12);
  await pool.query(
    'UPDATE users SET password_hash = ?, password_reset_token = NULL, password_reset_expires = NULL WHERE id = ?',
    [hash, rows[0].id]
  );
  return successResponse(res, null, 'Password updated successfully');
});

exports.changePassword = asyncHandler(async (req, res) => {
  const { current_password, new_password } = req.body;
  const [rows] = await pool.query('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  const match = await bcrypt.compare(current_password, rows[0].password_hash);
  if (!match) return errorResponse(res, 'Current password incorrect', 400);

  const hash = await bcrypt.hash(new_password, 12);
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.user.id]);
  return successResponse(res, null, 'Password changed successfully');
});
