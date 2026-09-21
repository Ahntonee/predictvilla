const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler, parsePagination } = require('../utils/helpers');
const { getSubscriptionPlan } = require('../config/subscriptionPlans');

exports.listUsers = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const { role, country, status } = req.query;
  let where = [];
  const params = [];
  if (role) { where.push('role=?'); params.push(role); }
  if (country) { where.push('country=?'); params.push(country); }
  if (status === 'banned') where.push('is_banned=1');
  else if (status === 'active') where.push('is_banned=0');
  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [rows] = await pool.query(
    `SELECT id, name, email, role, country, is_banned, created_at FROM users ${whereStr} ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [cnt] = await pool.query(`SELECT COUNT(*) as total FROM users ${whereStr}`, params);
  return successResponse(res, { users: rows, total: cnt[0].total });
});

exports.getUser = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, name, email, role, country, timezone, is_banned, telegram_invited, created_at FROM users WHERE id=?',
    [req.params.id]
  );
  if (!rows.length) return errorResponse(res, 'User not found', 404);
  const [subs] = await pool.query('SELECT * FROM subscriptions WHERE user_id=? ORDER BY created_at DESC LIMIT 5', [req.params.id]);
  return successResponse(res, { user: rows[0], subscriptions: subs });
});

exports.banUser = asyncHandler(async (req, res) => {
  await pool.query('UPDATE users SET is_banned=1 WHERE id=?', [req.params.id]);
  return successResponse(res, null, 'User banned');
});

exports.unbanUser = asyncHandler(async (req, res) => {
  await pool.query('UPDATE users SET is_banned=0 WHERE id=?', [req.params.id]);
  return successResponse(res, null, 'User unbanned');
});

exports.grantVip = asyncHandler(async (req, res) => {
  const { plan, days } = req.body;
  const selectedPlan = getSubscriptionPlan(plan || 'minimum_monthly');
  if (!selectedPlan) return errorResponse(res, 'Invalid subscription plan', 400);
  const dur = parseInt(days) || selectedPlan.days;
  const expiresAt = new Date(Date.now() + dur * 24 * 60 * 60 * 1000);
  await pool.query(
    "INSERT INTO subscriptions (user_id, plan, tier, status, provider, expires_at) VALUES (?,?,?,'active','manual',?)",
    [req.params.id, selectedPlan.id, selectedPlan.tier, expiresAt]
  );
  await pool.query("UPDATE users SET role='vip' WHERE id=?", [req.params.id]);
  return successResponse(res, null, 'VIP granted');
});

exports.updateUserRole = asyncHandler(async (req, res) => {
  const allowedRoles = new Set(['user', 'vip']);
  const { role } = req.body;
  if (!allowedRoles.has(role)) return errorResponse(res, 'Invalid user role', 400);
  const [result] = await pool.query('UPDATE users SET role=? WHERE id=?', [role, req.params.id]);
  if (!result.affectedRows) return errorResponse(res, 'User not found', 404);
  return successResponse(res, null, `User role updated to ${role}`);
});

exports.getLeaderboard = asyncHandler(async (req, res) => {
  const { period = '30d', group_by = 'market', sort_by = 'win_rate' } = req.query;
  const days = period === '7d' ? 7 : period === '90d' ? 90 : 30;

  const [rows] = await pool.query(
    `SELECT pal.market, pal.category, pal.league_id, l.name as league_name,
            COUNT(*) as total, SUM(pal.is_correct) as correct,
            ROUND(SUM(pal.is_correct)/COUNT(*)*100,2) as win_rate,
            AVG(pal.confidence_score) as avg_confidence
     FROM prediction_accuracy_log pal
     LEFT JOIN predictions p ON p.id = pal.prediction_id
     LEFT JOIN leagues l ON l.id = p.league_id
     WHERE pal.logged_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY pal.market, pal.category, pal.league_id
     ORDER BY win_rate DESC LIMIT 50`,
    [days]
  );
  return successResponse(res, { leaderboard: rows.map(row => ({ ...row, won: row.correct })) });
});

exports.getSettings = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT setting_key, setting_value FROM site_settings');
  const settings = {};
  rows.forEach(r => { settings[r.setting_key] = r.setting_value; });
  return successResponse(res, { settings });
});

exports.updateSetting = asyncHandler(async (req, res) => {
  const { value } = req.body;
  await pool.query(
    'INSERT INTO site_settings (setting_key, setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=?',
    [req.params.key, value, value]
  );
  return successResponse(res, null, 'Setting updated');
});

exports.getSeoSettings = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM seo_settings ORDER BY page_key');
  return successResponse(res, { seo: rows });
});

exports.updateSeoSetting = asyncHandler(async (req, res) => {
  const { title, description, keywords, og_image } = req.body;
  await pool.query(
    `INSERT INTO seo_settings (page_key, title, description, keywords, og_image) VALUES (?,?,?,?,?)
     ON DUPLICATE KEY UPDATE title=VALUES(title), description=VALUES(description),
       keywords=VALUES(keywords), og_image=VALUES(og_image)`,
    [req.params.pageKey, title || null, description || null, keywords || null, og_image || null]
  );
  return successResponse(res, null, 'SEO setting updated');
});

exports.getDashboardStats = asyncHandler(async (req, res) => {
  const [[predTotal]] = await pool.query("SELECT COUNT(*) as cnt FROM predictions WHERE published_at IS NOT NULL");
  const [[predToday]] = await pool.query("SELECT COUNT(*) as cnt FROM predictions WHERE DATE(created_at)=CURDATE()");
  const [[winRate]] = await pool.query("SELECT stat_value FROM accuracy_stats WHERE stat_key='overall_win_rate'");
  const [[activeVip]] = await pool.query("SELECT COUNT(*) as cnt FROM subscriptions WHERE status='active'");
  const [[totalUsers]] = await pool.query("SELECT COUNT(*) as cnt FROM users");
  const [[newUsers]] = await pool.query("SELECT COUNT(*) as cnt FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)");
  const [[revMonth]] = await pool.query("SELECT SUM(amount) as total FROM subscriptions WHERE DATE_FORMAT(created_at,'%Y-%m')=DATE_FORMAT(NOW(),'%Y-%m') AND status='active'");
  const [[revTotal]] = await pool.query("SELECT SUM(amount) as total FROM subscriptions WHERE status IN ('active','expired','cancelled')");
  const [[queueCount]] = await pool.query("SELECT COUNT(*) as cnt FROM predictions WHERE source='intelligence' AND published_at IS NULL");
  const [[lastRun]] = await pool.query("SELECT setting_value FROM site_settings WHERE setting_key='last_intelligence_run'");

  return successResponse(res, {
    predictions: { total: predTotal.cnt, today: predToday.cnt, queue: queueCount.cnt },
    winRate: winRate?.stat_value || 0,
    subscribers: { active: activeVip.cnt },
    users: { total: totalUsers.cnt, newThisWeek: newUsers.cnt },
    revenue: { thisMonth: revMonth.total || 0, total: revTotal.total || 0 },
    intelligence: { lastRun: lastRun?.setting_value, queueCount: queueCount.cnt },
  });
});
