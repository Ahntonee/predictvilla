const { verifyToken, COOKIE_NAME } = require('../utils/jwt');
const { errorResponse } = require('../utils/helpers');
const { pool } = require('../config/db');

async function authenticate(req, res, next) {
  try {
    const token = req.cookies?.[COOKIE_NAME];
    if (!token) return errorResponse(res, 'Authentication required', 401);
    const decoded = verifyToken(token);
    const [rows] = await pool.query(
      'SELECT id, name, email, role, country, timezone, telegram_invited, is_banned FROM users WHERE id = ?',
      [decoded.id]
    );
    if (!rows.length) return errorResponse(res, 'User not found', 401);
    const user = rows[0];
    if (user.is_banned) return errorResponse(res, 'Account suspended', 403);
    req.user = user;
    next();
  } catch {
    return errorResponse(res, 'Invalid or expired session', 401);
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) return errorResponse(res, 'Authentication required', 401);
  if (req.user.role !== 'admin' && req.user.role !== 'super_admin') return errorResponse(res, 'Admin access required', 403);
  next();
}

function requireVip(req, res, next) {
  if (!req.user) return errorResponse(res, 'Authentication required', 401);
  if (req.user.role !== 'vip' && req.user.role !== 'admin') {
    return errorResponse(res, 'VIP subscription required', 403);
  }
  next();
}

function optionalAuth(req, res, next) {
  const token = req.cookies?.[COOKIE_NAME];
  if (!token) { req.user = null; return next(); }
  try {
    const decoded = verifyToken(token);
    pool.query(
      'SELECT id, name, email, role, country, timezone, telegram_invited, is_banned FROM users WHERE id = ?',
      [decoded.id]
    ).then(([rows]) => {
      req.user = rows[0] || null;
      next();
    }).catch(() => { req.user = null; next(); });
  } catch {
    req.user = null;
    next();
  }
}

module.exports = { authenticate, requireAdmin, requireVip, optionalAuth };
