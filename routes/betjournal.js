const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');
const { pool } = require('../config/db');

// GET /api/bet-journal — list entries for authenticated user
router.get('/', authenticate, asyncHandler(async (req, res) => {
  const { limit = 50, offset = 0, outcome } = req.query;
  let sql = 'SELECT * FROM bet_journal WHERE user_id = ?';
  const params = [req.user.id];
  if (outcome) { sql += ' AND outcome = ?'; params.push(outcome); }
  sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));
  const [rows] = await pool.query(sql, params);
  const [[{ total }]] = await pool.query('SELECT COUNT(*) AS total FROM bet_journal WHERE user_id = ?', [req.user.id]);
  return successResponse(res, { entries: rows, total });
}));

// GET /api/bet-journal/summary — P&L summary for authenticated user
router.get('/summary', authenticate, asyncHandler(async (req, res) => {
  const [[summary]] = await pool.query(`
    SELECT
      COUNT(*)                                          AS total_bets,
      SUM(CASE WHEN outcome='win'  THEN 1 ELSE 0 END)  AS wins,
      SUM(CASE WHEN outcome='loss' THEN 1 ELSE 0 END)  AS losses,
      SUM(CASE WHEN outcome='void' THEN 1 ELSE 0 END)  AS voids,
      SUM(CASE WHEN outcome='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(stake)                                        AS total_staked,
      SUM(returns)                                      AS total_returns,
      SUM(returns) - SUM(stake)                         AS net_profit
    FROM bet_journal WHERE user_id = ?
  `, [req.user.id]);

  const [byMarket] = await pool.query(`
    SELECT market,
      COUNT(*) AS bets,
      SUM(CASE WHEN outcome='win' THEN 1 ELSE 0 END) AS wins,
      SUM(stake) AS staked,
      SUM(returns) AS returns
    FROM bet_journal WHERE user_id = ? AND outcome != 'pending'
    GROUP BY market ORDER BY returns DESC
  `, [req.user.id]);

  const winRate = summary.total_bets > 0
    ? ((summary.wins / (summary.total_bets - (summary.pending || 0) - (summary.voids || 0))) * 100).toFixed(1)
    : 0;

  return successResponse(res, { summary: { ...summary, win_rate: parseFloat(winRate) }, by_market: byMarket });
}));

// POST /api/bet-journal — add a new bet entry
router.post('/', authenticate, asyncHandler(async (req, res) => {
  const { prediction_id, match_label, market, tip, odds, stake, currency, outcome, match_date, notes } = req.body;
  if (!match_label || !tip || !odds || !stake) return errorResponse(res, 'match_label, tip, odds and stake are required', 400);

  const [result] = await pool.query(
    `INSERT INTO bet_journal (user_id, prediction_id, match_label, market, tip, odds, stake, currency, outcome, match_date, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [req.user.id, prediction_id || null, match_label, market || '1X2', tip, parseFloat(odds), parseFloat(stake),
     currency || 'NGN', outcome || 'pending', match_date || null, notes || null]
  );
  const [[entry]] = await pool.query('SELECT * FROM bet_journal WHERE id = ?', [result.insertId]);
  return successResponse(res, entry, 'Bet entry added', 201);
}));

// PATCH /api/bet-journal/:id — update outcome
router.patch('/:id', authenticate, asyncHandler(async (req, res) => {
  const { outcome, notes } = req.body;
  const [[entry]] = await pool.query('SELECT * FROM bet_journal WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!entry) return errorResponse(res, 'Entry not found', 404);
  await pool.query('UPDATE bet_journal SET outcome = COALESCE(?, outcome), notes = COALESCE(?, notes) WHERE id = ?',
    [outcome || null, notes !== undefined ? notes : null, req.params.id]);
  const [[updated]] = await pool.query('SELECT * FROM bet_journal WHERE id = ?', [req.params.id]);
  return successResponse(res, updated, 'Entry updated');
}));

// DELETE /api/bet-journal/:id
router.delete('/:id', authenticate, asyncHandler(async (req, res) => {
  const [[entry]] = await pool.query('SELECT id FROM bet_journal WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  if (!entry) return errorResponse(res, 'Entry not found', 404);
  await pool.query('DELETE FROM bet_journal WHERE id = ?', [req.params.id]);
  return successResponse(res, null, 'Entry deleted');
}));

module.exports = router;
