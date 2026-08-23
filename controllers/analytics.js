const { pool } = require('../config/db');
const { successResponse, asyncHandler } = require('../utils/helpers');

exports.overview = asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const [daily] = await pool.query(
    `SELECT DATE(viewed_at) as date, COUNT(*) as views, COUNT(DISTINCT session_id) as sessions
     FROM page_views WHERE viewed_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
     GROUP BY DATE(viewed_at) ORDER BY date`,
    [days]
  );
  const [[totals]] = await pool.query(
    `SELECT COUNT(*) as total_views, COUNT(DISTINCT session_id) as unique_sessions
     FROM page_views WHERE viewed_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)`,
    [days]
  );
  return successResponse(res, { daily, totals });
});

exports.topPages = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT path, COUNT(*) as views FROM page_views
     WHERE viewed_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
     GROUP BY path ORDER BY views DESC LIMIT 20`
  );
  return successResponse(res, { pages: rows });
});

exports.countries = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT country, COUNT(*) as views FROM page_views
     WHERE viewed_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND country IS NOT NULL
     GROUP BY country ORDER BY views DESC LIMIT 30`
  );
  return successResponse(res, { countries: rows });
});

exports.devices = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT device_type, COUNT(*) as views FROM page_views
     WHERE viewed_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
     GROUP BY device_type`
  );
  return successResponse(res, { devices: rows });
});

exports.referrers = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT referrer, COUNT(*) as views FROM page_views
     WHERE viewed_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND referrer IS NOT NULL AND referrer != ''
     GROUP BY referrer ORDER BY views DESC LIMIT 20`
  );
  return successResponse(res, { referrers: rows });
});

exports.revenueOverview = asyncHandler(async (req, res) => {
  const [[month]] = await pool.query(
    "SELECT SUM(amount) as revenue, COUNT(*) as count FROM subscriptions WHERE DATE_FORMAT(created_at,'%Y-%m')=DATE_FORMAT(NOW(),'%Y-%m')"
  );
  const [[total]] = await pool.query("SELECT SUM(amount) as revenue, COUNT(*) as count FROM subscriptions");
  const [[active]] = await pool.query("SELECT COUNT(*) as count FROM subscriptions WHERE status='active'");
  const [[avgLtv]] = await pool.query("SELECT AVG(amount) as ltv FROM subscriptions");
  return successResponse(res, {
    thisMonth: month,
    allTime: total,
    activeSubscribers: active.count,
    avgLtv: avgLtv.ltv || 0,
  });
});

exports.revenueByMonth = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(created_at,'%Y-%m') as month, plan,
            SUM(amount) as revenue, COUNT(*) as count
     FROM subscriptions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
     GROUP BY month, plan ORDER BY month`
  );
  return successResponse(res, { data: rows });
});

exports.revenuePlans = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    "SELECT plan, COUNT(*) as count, SUM(amount) as revenue FROM subscriptions GROUP BY plan"
  );
  return successResponse(res, { plans: rows });
});

exports.revenueChurn = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT DATE_FORMAT(created_at,'%Y-%m') as month,
            SUM(CASE WHEN status='expired' OR status='cancelled' THEN 1 ELSE 0 END) as churned,
            COUNT(*) as total
     FROM subscriptions WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
     GROUP BY month ORDER BY month`
  );
  return successResponse(res, { data: rows });
});

// ─────────────────────────────────────────────────────────────────────────────
// PREDICTION INTELLIGENCE ANALYTICS
// ─────────────────────────────────────────────────────────────────────────────

exports.accuracyTracker = asyncHandler(async (req, res) => {
  const [[overall]] = await pool.query(`
    SELECT COUNT(*) as total, SUM(is_correct) as won, COUNT(*)-SUM(is_correct) as lost,
    ROUND(SUM(is_correct)/NULLIF(COUNT(*),0)*100,2) as accuracy
    FROM prediction_accuracy_log`);
  const [byMarket] = await pool.query(`
    SELECT market, COUNT(*) as total, SUM(is_correct) as won,
    ROUND(SUM(is_correct)/NULLIF(COUNT(*),0)*100,1) as accuracy
    FROM prediction_accuracy_log GROUP BY market ORDER BY total DESC`);
  const [byBand] = await pool.query(`
    SELECT CONCAT(FLOOR(confidence_score/5)*5,'–',FLOOR(confidence_score/5)*5+4,'%') as band,
    FLOOR(confidence_score/5)*5 as band_start,
    COUNT(*) as total, SUM(is_correct) as won,
    ROUND(SUM(is_correct)/NULLIF(COUNT(*),0)*100,1) as accuracy
    FROM prediction_accuracy_log WHERE confidence_score IS NOT NULL
    GROUP BY band_start, band ORDER BY band_start DESC`);
  const [byTip] = await pool.query(`
    SELECT market, tip, COUNT(*) as total, SUM(is_correct) as won,
    ROUND(SUM(is_correct)/NULLIF(COUNT(*),0)*100,1) as accuracy
    FROM prediction_accuracy_log
    GROUP BY market, tip ORDER BY market, accuracy DESC`);
  return successResponse(res, { overall, byMarket, byBand, byTip });
});

exports.leagueSubmarket = asyncHandler(async (req, res) => {
  const market = req.query.market || '';
  let where = ['pal.is_correct IS NOT NULL'];
  const params = [];
  if (market) { where.push('pal.market = ?'); params.push(market); }
  const [rows] = await pool.query(`
    SELECT l.name as league_name, l.country, pal.market, pal.tip,
    COUNT(*) as total, SUM(pal.is_correct) as won,
    ROUND(SUM(pal.is_correct)/NULLIF(COUNT(*),0)*100,1) as accuracy
    FROM prediction_accuracy_log pal
    JOIN predictions p ON p.id = pal.prediction_id
    JOIN leagues l ON l.id = p.league_id
    WHERE ${where.join(' AND ')}
    GROUP BY l.name, l.country, pal.market, pal.tip
    HAVING total >= 3
    ORDER BY pal.market, accuracy DESC`, params);
  return successResponse(res, { rows });
});

exports.teamConsistency = asyncHandler(async (req, res) => {
  const market = req.query.market || '';
  const tip = req.query.tip || '';
  const where = ['pal.is_correct IS NOT NULL'];
  const params = [];
  if (market) { where.push('pal.market = ?'); params.push(market); }
  if (tip)    { where.push('pal.tip = ?');    params.push(tip); }
  const w = where.join(' AND ');
  const [homeRows] = await pool.query(`
    SELECT p.home_team as team, l.name as league_name, l.country, pal.market, pal.tip, 'home' as side,
    COUNT(*) as total, SUM(pal.is_correct) as won,
    ROUND(SUM(pal.is_correct)/NULLIF(COUNT(*),0)*100,1) as accuracy
    FROM prediction_accuracy_log pal
    JOIN predictions p ON p.id = pal.prediction_id
    JOIN leagues l ON l.id = p.league_id
    WHERE ${w} GROUP BY p.home_team, l.name, l.country, pal.market, pal.tip HAVING total >= 3`, params);
  const [awayRows] = await pool.query(`
    SELECT p.away_team as team, l.name as league_name, l.country, pal.market, pal.tip, 'away' as side,
    COUNT(*) as total, SUM(pal.is_correct) as won,
    ROUND(SUM(pal.is_correct)/NULLIF(COUNT(*),0)*100,1) as accuracy
    FROM prediction_accuracy_log pal
    JOIN predictions p ON p.id = pal.prediction_id
    JOIN leagues l ON l.id = p.league_id
    WHERE ${w} GROUP BY p.away_team, l.name, l.country, pal.market, pal.tip HAVING total >= 3`, params);
  const teams = [...homeRows, ...awayRows].sort((a, b) => b.accuracy - a.accuracy);
  return successResponse(res, { teams });
});

exports.calibration = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT market, tip,
    CONCAT(FLOOR(confidence_score/5)*5,'–',FLOOR(confidence_score/5)*5+4,'%') as band,
    FLOOR(confidence_score/5)*5 as band_start,
    COUNT(*) as total, SUM(is_correct) as won,
    ROUND(SUM(is_correct)/NULLIF(COUNT(*),0)*100,1) as accuracy,
    MAX(logged_at) as last_updated
    FROM prediction_accuracy_log WHERE confidence_score IS NOT NULL
    GROUP BY market, tip, band_start, band HAVING total >= 5
    ORDER BY market, tip, band_start DESC`);
  return successResponse(res, { rows });
});

exports.predictionFrequency = asyncHandler(async (req, res) => {
  const leagueId = req.query.league_id || '';
  let where = [];
  const params = [];
  if (leagueId) { where.push('p.league_id = ?'); params.push(leagueId); }
  const wStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [rows] = await pool.query(`
    SELECT l.name as league_name, l.country, p.market, p.tip,
    COUNT(*) as total_predictions,
    SUM(CASE WHEN p.result IN ('won','lost') THEN 1 ELSE 0 END) as resolved,
    SUM(CASE WHEN p.result = 'won' THEN 1 ELSE 0 END) as won,
    ROUND(SUM(CASE WHEN p.result='won' THEN 1 ELSE 0 END)/NULLIF(SUM(CASE WHEN p.result IN ('won','lost') THEN 1 ELSE 0 END),0)*100,1) as accuracy
    FROM predictions p JOIN leagues l ON l.id = p.league_id
    ${wStr}
    GROUP BY p.league_id, p.market, p.tip
    HAVING total_predictions >= 2
    ORDER BY l.name, total_predictions DESC`, params);
  return successResponse(res, { rows });
});

// League-level: goals/game, btts%, over2.5%, our prediction win rate
exports.leagueStats = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT
      l.id, l.name AS league_name, l.country,
      ROUND(ls.goals_per_game, 2)           AS goals_per_game,
      ROUND(ls.btts_percentage, 1)          AS btts_pct,
      ROUND(ls.over_1_5_percentage, 1)      AS over15_pct,
      ROUND(ls.over_2_5_percentage, 1)      AS over25_pct,
      ROUND(ls.over_3_5_percentage, 1)      AS over35_pct,
      ROUND(ls.home_win_percentage, 1)      AS home_win_pct,
      ROUND(ls.draw_percentage, 1)          AS draw_pct,
      ROUND(ls.away_win_percentage, 1)      AS away_win_pct,
      ls.matches_played                     AS stat_matches,
      COUNT(pal.id)                         AS total_predictions,
      COALESCE(SUM(pal.is_correct), 0)      AS correct_predictions,
      ROUND(SUM(pal.is_correct) / NULLIF(COUNT(pal.id), 0) * 100, 1) AS prediction_win_rate
    FROM leagues l
    LEFT JOIN league_statistics ls ON ls.api_league_id = l.api_league_id
    LEFT JOIN predictions p   ON p.league_id = l.id
    LEFT JOIN prediction_accuracy_log pal ON pal.prediction_id = p.id
    WHERE l.is_active = 1
    GROUP BY l.id, l.name, l.country,
             ls.goals_per_game, ls.btts_percentage,
             ls.over_1_5_percentage, ls.over_2_5_percentage, ls.over_3_5_percentage,
             ls.home_win_percentage, ls.draw_percentage, ls.away_win_percentage,
             ls.matches_played
    ORDER BY ls.goals_per_game DESC, l.name
  `);
  return successResponse(res, { leagues: rows });
});

// Market-level: which pick types win the most
exports.marketStats = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT
      market, category,
      SUM(total_predictions) AS total,
      SUM(correct_predictions) AS correct,
      ROUND(SUM(correct_predictions) / NULLIF(SUM(total_predictions), 0) * 100, 1) AS win_rate,
      ROUND(AVG(avg_confidence), 1) AS avg_confidence
    FROM prediction_market_stats
    WHERE total_predictions >= 3
    GROUP BY market, category
    ORDER BY win_rate DESC
  `);
  return successResponse(res, { markets: rows });
});

// Best league+market combinations by win rate
exports.bestPicks = asyncHandler(async (req, res) => {
  const [byLeagueMarket] = await pool.query(`
    SELECT
      l.name AS league_name, l.country,
      pal.market, pal.category,
      COUNT(*) AS total,
      SUM(pal.is_correct) AS correct,
      ROUND(SUM(pal.is_correct) / COUNT(*) * 100, 1) AS win_rate,
      ROUND(AVG(pal.confidence_score), 1) AS avg_conf
    FROM prediction_accuracy_log pal
    JOIN predictions p ON p.id = pal.prediction_id
    JOIN leagues l ON l.id = p.league_id
    GROUP BY l.name, l.country, pal.market, pal.category
    HAVING total >= 5
    ORDER BY win_rate DESC
    LIMIT 30
  `);

  // Teams where our predictions win most (both as home and away)
  const [byTeam] = await pool.query(`
    SELECT team, SUM(total) AS total, SUM(correct) AS correct,
           ROUND(SUM(correct) / SUM(total) * 100, 1) AS win_rate
    FROM (
      SELECT p.home_team AS team, COUNT(*) AS total, SUM(pal.is_correct) AS correct
      FROM prediction_accuracy_log pal JOIN predictions p ON p.id = pal.prediction_id
      GROUP BY p.home_team
      UNION ALL
      SELECT p.away_team AS team, COUNT(*) AS total, SUM(pal.is_correct) AS correct
      FROM prediction_accuracy_log pal JOIN predictions p ON p.id = pal.prediction_id
      GROUP BY p.away_team
    ) t
    GROUP BY team
    HAVING total >= 5
    ORDER BY win_rate DESC
    LIMIT 20
  `);

  return successResponse(res, { byLeagueMarket, byTeam });
});

// Team statistics: scoring, conceding, home/away records
exports.teamStats = asyncHandler(async (req, res) => {
  const sort = req.query.sort || 'scored';
  const orderMap = {
    scored:        'ts.goals_scored_avg DESC',
    conceded:      'ts.goals_conceded_avg DESC',
    home_scored:   'ts.home_goals_scored_avg DESC',
    away_scored:   'ts.away_goals_scored_avg DESC',
    home_conceded: 'ts.home_goals_conceded_avg DESC',
    away_conceded: 'ts.away_goals_conceded_avg DESC',
    clean_sheets:  'ts.clean_sheets DESC',
    btts:          'ts.btts_count DESC',
    wins:          'ts.wins DESC',
  };
  const orderBy = orderMap[sort] || 'ts.goals_scored_avg DESC';
  const filter  = req.query.filter; // 'under2', 'under3', 'score2plus', 'concede2plus'

  let havingClause = '';
  if (filter === 'under2')      havingClause = 'HAVING ts.goals_scored_avg < 2';
  if (filter === 'under3')      havingClause = 'HAVING ts.goals_scored_avg < 3';
  if (filter === 'score2plus')  havingClause = 'HAVING ts.goals_scored_avg >= 2';
  if (filter === 'concede2plus') havingClause = 'HAVING ts.goals_conceded_avg >= 2';

  const [rows] = await pool.query(`
    SELECT
      ts.team_name, l.name AS league_name, l.country,
      ts.matches_played, ts.wins, ts.draws, ts.losses,
      ROUND(ts.goals_scored_avg, 2)           AS goals_scored_avg,
      ROUND(ts.goals_conceded_avg, 2)         AS goals_conceded_avg,
      ROUND(ts.home_goals_scored_avg, 2)      AS home_scored_avg,
      ROUND(ts.away_goals_scored_avg, 2)      AS away_scored_avg,
      ROUND(ts.home_goals_conceded_avg, 2)    AS home_conceded_avg,
      ROUND(ts.away_goals_conceded_avg, 2)    AS away_conceded_avg,
      ts.clean_sheets, ts.btts_count,
      ROUND(ts.wins / NULLIF(ts.matches_played, 0) * 100) AS win_pct,
      ROUND(ts.clean_sheets / NULLIF(ts.matches_played, 0) * 100) AS clean_sheet_pct
    FROM team_statistics ts
    LEFT JOIN leagues l ON l.id = ts.league_id
    WHERE ts.matches_played >= 5
      AND ts.season = (SELECT MAX(t2.season) FROM team_statistics t2 WHERE t2.api_team_id = ts.api_team_id AND t2.league_id = ts.league_id)
    ${havingClause}
    ORDER BY ${orderBy}
    LIMIT 100
  `);
  return successResponse(res, { teams: rows });
});

// League goal-profile filter: under2, under3, high-scoring
exports.leagueGoalProfiles = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`
    SELECT
      l.name AS league_name, l.country,
      ROUND(ls.goals_per_game, 2)        AS goals_per_game,
      ROUND(ls.btts_percentage, 1)       AS btts_pct,
      ROUND(ls.over_1_5_percentage, 1)   AS over15_pct,
      ROUND(ls.over_2_5_percentage, 1)   AS over25_pct,
      ROUND(ls.over_3_5_percentage, 1)   AS over35_pct,
      ROUND(ls.home_win_percentage, 1)   AS home_win_pct,
      ROUND(ls.draw_percentage, 1)       AS draw_pct,
      ROUND(ls.away_win_percentage, 1)   AS away_win_pct,
      ls.matches_played
    FROM league_statistics ls
    JOIN leagues l ON l.api_league_id = ls.api_league_id
    WHERE ls.goals_per_game IS NOT NULL AND l.is_active = 1
    ORDER BY ls.goals_per_game ASC
  `);
  return successResponse(res, { leagues: rows });
});
