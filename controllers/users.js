const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler, sanitiseText } = require('../utils/helpers');

exports.getProfile = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, name, email, role, country, timezone, telegram_invited, created_at FROM users WHERE id=?',
    [req.user.id]
  );
  return successResponse(res, { user: rows[0] });
});

exports.updateProfile = asyncHandler(async (req, res) => {
  const { name, country, timezone } = req.body;
  await pool.query(
    'UPDATE users SET name=?, country=?, timezone=? WHERE id=?',
    [sanitiseText(name || req.user.name), country || null, timezone || 'UTC', req.user.id]
  );
  return successResponse(res, null, 'Profile updated');
});

exports.setTelegramInvited = asyncHandler(async (req, res) => {
  await pool.query('UPDATE users SET telegram_invited=1 WHERE id=?', [req.user.id]);
  return successResponse(res, null, 'Marked as invited');
});

exports.getTelegramLink = asyncHandler(async (req, res) => {
  if (req.user.role !== 'vip' && req.user.role !== 'admin' && req.user.role !== 'super_admin') {
    return errorResponse(res, 'VIP access required', 403);
  }
  const link = process.env.TELEGRAM_VIP_INVITE_LINK;
  if (!link || link.includes('YOUR_INVITE')) {
    return errorResponse(res, 'Telegram link not configured yet', 404);
  }
  await pool.query('UPDATE users SET telegram_invited=1 WHERE id=?', [req.user.id]);
  return successResponse(res, { link });
});

exports.getBookmarks = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.id, p.slug, p.home_team, p.away_team, p.match_date, p.tip, p.result,
            p.confidence_score, p.is_vip, b.created_at as bookmarked_at
     FROM bookmarks b JOIN predictions p ON p.id=b.prediction_id
     WHERE b.user_id=? ORDER BY b.created_at DESC`,
    [req.user.id]
  );
  return successResponse(res, { bookmarks: rows });
});

exports.addBookmark = asyncHandler(async (req, res) => {
  await pool.query(
    'INSERT IGNORE INTO bookmarks (user_id, prediction_id) VALUES (?,?)',
    [req.user.id, req.params.predictionId]
  );
  return successResponse(res, null, 'Bookmarked', 201);
});

exports.removeBookmark = asyncHandler(async (req, res) => {
  await pool.query(
    'DELETE FROM bookmarks WHERE user_id=? AND prediction_id=?',
    [req.user.id, req.params.predictionId]
  );
  return successResponse(res, null, 'Bookmark removed');
});

exports.getBetHistory = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT bh.*, p.home_team, p.away_team, p.tip
     FROM bet_history bh LEFT JOIN predictions p ON p.id=bh.prediction_id
     WHERE bh.user_id=? ORDER BY bh.created_at DESC`,
    [req.user.id]
  );
  const totalPnl = rows.reduce((s, r) => s + (parseFloat(r.profit_loss) || 0), 0);
  return successResponse(res, { history: rows, totalPnl });
});

exports.addBetHistory = asyncHandler(async (req, res) => {
  const { prediction_id, stake, odds, result, notes } = req.body;
  if (!stake) return errorResponse(res, 'Stake required', 400);
  const profitLoss = result === 'won' ? (stake * (odds || 1) - stake) : (result === 'lost' ? -stake : 0);
  await pool.query(
    'INSERT INTO bet_history (user_id, prediction_id, stake, odds, result, profit_loss, notes) VALUES (?,?,?,?,?,?,?)',
    [req.user.id, prediction_id || null, stake, odds || null, result || 'void', profitLoss, notes || null]
  );
  return successResponse(res, null, 'Bet logged', 201);
});

exports.deleteBetHistory = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM bet_history WHERE id=? AND user_id=?', [req.params.id, req.user.id]);
  return successResponse(res, null, 'Deleted');
});

exports.deleteAccount = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM users WHERE id=?', [req.user.id]);
  res.clearCookie('ol_token');
  return successResponse(res, null, 'Account deleted');
});
