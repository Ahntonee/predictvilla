const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler, parsePagination, paginate, generatePredictionSlug, sanitiseText } = require('../utils/helpers');

function redactVip(pred, user) {
  if (pred.is_vip && (!user || (user.role !== 'vip' && user.role !== 'admin'))) {
    return { ...pred, tip: '🔒 VIP Pick', analysis: null, odds: null, intelligence_score: null, bookies_available: null };
  }
  return pred;
}

exports.list = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const { date, league_id, category, market, vip, result, search } = req.query;
  const isAdmin = req.user?.role === 'admin';
  const adminView = isAdmin && req.query.admin_view === '1';

  let where = [];
  const params = [];

  if (!adminView) {
    where.push('published_at IS NOT NULL');
  } else if (req.query.is_published === '1') {
    where.push('published_at IS NOT NULL');
  } else if (req.query.is_published === '0') {
    where.push('published_at IS NULL');
  }

  if (date === 'today') { where.push('DATE(match_date) = CURDATE()'); }
  else if (date === 'yesterday') { where.push('DATE(match_date) = CURDATE() - INTERVAL 1 DAY'); }
  else if (date === 'tomorrow') { where.push('DATE(match_date) = CURDATE() + INTERVAL 1 DAY'); }
  else if (date) { where.push('DATE(match_date) = ?'); params.push(date); }

  if (league_id) { where.push('league_id = ?'); params.push(league_id); }
  if (category && category !== 'all') {
    if (category === 'free') {
      // "All Free" tab = all non-VIP predictions regardless of market category
      where.push('is_vip = 0');
    } else if (category === 'vip') {
      where.push('is_vip = 1');
    } else {
      where.push('category = ?'); params.push(category);
    }
  }
  if (market) { where.push('market = ?'); params.push(market); }
  if (vip === '1') { where.push('is_vip = 1'); }

  // Admin view tabs
  const view = req.query.view;
  const LIVE_STATUSES = ['1H','2H','HT','ET','BT','P','LIVE','1H_HT','2H_ET'];
  if (view === 'upcoming') {
    where.push(`(result = 'pending' OR result IS NULL)`);
    where.push(`fixture_status NOT IN (${LIVE_STATUSES.map(()=>'?').join(',')})`);
    params.push(...LIVE_STATUSES);
    if (!adminView) where.push('match_date >= NOW() - INTERVAL 3 HOUR');
  } else if (view === 'live') {
    where.push(`fixture_status IN (${LIVE_STATUSES.map(()=>'?').join(',')})`);
    params.push(...LIVE_STATUSES);
  } else if (view === 'finished') {
    where.push(`(match_date < NOW() - INTERVAL 2 HOUR OR result IN ('won','lost','void'))`);
    where.push(`fixture_status NOT IN (${LIVE_STATUSES.map(()=>'?').join(',')})`);
    params.push(...LIVE_STATUSES);
  } else if (result === 'live') {
    where.push(`fixture_status IN (${LIVE_STATUSES.map(()=>'?').join(',')})`);
    params.push(...LIVE_STATUSES);
  } else if (result === 'finished') {
    where.push(`result IN ('won','lost')`);
  } else if (result) {
    where.push('result = ?'); params.push(result);
  }

  if (search) { where.push('(home_team LIKE ? OR away_team LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }

  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [countRows] = await pool.query(`SELECT COUNT(*) as cnt FROM predictions ${whereStr}`, params);
  const total = countRows[0].cnt;

  const [rows] = await pool.query(
    `SELECT p.*, l.name as league_name, l.logo_url as league_logo
     FROM predictions p LEFT JOIN leagues l ON l.id = p.league_id
     ${whereStr} ORDER BY p.match_date ASC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  const predictions = rows.map(p => redactVip(p, req.user));
  return successResponse(res, { predictions, pagination: paginate(total, page, limit) });
});

exports.recentWins = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.id, p.slug, p.home_team, p.away_team, p.tip, p.market,
            p.match_date, p.home_score, p.away_score, p.home_team_logo, p.away_team_logo,
            l.name as league_name
     FROM predictions p
     LEFT JOIN leagues l ON l.id = p.league_id
     WHERE p.result = 'won' AND p.published_at IS NOT NULL
     ORDER BY p.match_date DESC
     LIMIT 50`
  );
  return successResponse(res, { wins: rows });
});

exports.getStats = asyncHandler(async (req, res) => {
  const [stats] = await pool.query("SELECT stat_key, stat_value FROM accuracy_stats WHERE stat_key IN ('overall_win_rate','vip_win_rate','total_predictions','total_won')");
  const [overrides] = await pool.query('SELECT stat_key, stat_value FROM site_stat_overrides');
  const [leagueCount] = await pool.query('SELECT COUNT(*) as cnt FROM leagues WHERE is_active=1');
  const [todayCount] = await pool.query("SELECT COUNT(*) as cnt FROM predictions WHERE DATE(match_date) = CURDATE() AND published_at IS NOT NULL");

  const statMap = {};
  stats.forEach(s => { statMap[s.stat_key] = s.stat_value; });
  overrides.forEach(o => { statMap[o.stat_key] = o.stat_value; });

  return successResponse(res, {
    winRate: statMap.overall_win_rate || '82',
    vipWinRate: statMap.vip_win_rate || '87',
    totalPredictions: statMap.total_predictions || 0,
    totalWon: statMap.total_won || 0,
    tipsToday: todayCount[0].cnt,
    leaguesCovered: leagueCount[0].cnt,
  });
});

exports.getBankers = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.*, l.name as league_name FROM predictions p
     LEFT JOIN leagues l ON l.id = p.league_id
     WHERE p.is_banker = 1 AND DATE(p.match_date) = CURDATE() AND p.published_at IS NOT NULL
     ORDER BY p.confidence_score DESC LIMIT 2`
  );
  return successResponse(res, { predictions: rows });
});

exports.getFeatured = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.*, l.name as league_name FROM predictions p
     LEFT JOIN leagues l ON l.id = p.league_id
     WHERE p.is_featured = 1 AND p.published_at IS NOT NULL
     ORDER BY p.match_date DESC LIMIT 6`
  );
  return successResponse(res, { predictions: rows.map(p => redactVip(p, req.user)) });
});

exports.getBySlug = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.*, l.name as league_name, l.logo_url as league_logo
     FROM predictions p LEFT JOIN leagues l ON l.id = p.league_id
     WHERE p.slug = ? AND p.published_at IS NOT NULL`,
    [req.params.slug]
  );
  if (!rows.length) return errorResponse(res, 'Prediction not found', 404);
  return successResponse(res, { prediction: redactVip(rows[0], req.user) });
});

exports.getById = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.*, l.name as league_name, l.logo_url as league_logo
     FROM predictions p LEFT JOIN leagues l ON l.id = p.league_id
     WHERE p.id = ?`,
    [req.params.id]
  );
  if (!rows.length) return errorResponse(res, 'Prediction not found', 404);
  return successResponse(res, { prediction: rows[0] });
});

// Admin CRUD
exports.create = asyncHandler(async (req, res) => {
  const { home_team, away_team, match_date, tip, market, category, league_id,
          odds, confidence_score, analysis, is_vip, is_banker, is_featured,
          is_published, home_form, away_form, h2h_summary, home_goals_avg, away_goals_avg,
          home_goals_conceded_avg, away_goals_conceded_avg, bookies_available,
          home_team_logo, away_team_logo, api_fixture_id } = req.body;

  const slug = generatePredictionSlug(home_team, away_team, match_date);
  const bookiesJson = bookies_available ? JSON.stringify(bookies_available.split(',').map(s => s.trim())) : null;
  const publishedAt = is_published ? new Date() : null;

  const [result] = await pool.query(
    `INSERT INTO predictions (slug, league_id, home_team, away_team, home_team_logo, away_team_logo,
      match_date, tip, market, category, odds, confidence_score, analysis, is_vip, is_banker, is_featured,
      home_form, away_form, h2h_summary, home_goals_avg, away_goals_avg, home_goals_conceded_avg,
      away_goals_conceded_avg, bookies_available, api_fixture_id, source, published_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'manual', ?)`,
    [slug, league_id || null, sanitiseText(home_team), sanitiseText(away_team),
     home_team_logo || null, away_team_logo || null, match_date, sanitiseText(tip),
     market || '1X2', category || 'Free', odds || null, confidence_score || null,
     analysis ? sanitiseText(analysis) : null,
     is_vip ? 1 : 0, is_banker ? 1 : 0, is_featured ? 1 : 0,
     home_form || null, away_form || null, h2h_summary || null,
     home_goals_avg || null, away_goals_avg || null,
     home_goals_conceded_avg || null, away_goals_conceded_avg || null,
     bookiesJson, api_fixture_id || null, publishedAt]
  );
  return successResponse(res, { id: result.insertId, slug }, 'Prediction created', 201);
});

exports.update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const fields = ['home_team','away_team','match_date','tip','market','category','league_id',
    'odds','confidence_score','intelligence_score','analysis','is_vip','is_banker','is_featured',
    'home_form','away_form','h2h_summary','home_goals_avg','away_goals_avg',
    'home_goals_conceded_avg','away_goals_conceded_avg','home_team_logo','away_team_logo'];
  const updates = [], params = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { updates.push(`${f} = ?`); params.push(req.body[f]); }
  }
  if (req.body.bookies_available !== undefined) {
    updates.push('bookies_available = ?');
    params.push(typeof req.body.bookies_available === 'string'
      ? JSON.stringify(req.body.bookies_available.split(',').map(s => s.trim()))
      : JSON.stringify(req.body.bookies_available));
  }
  if (req.body.is_published !== undefined) {
    updates.push('published_at = ?');
    params.push(req.body.is_published ? new Date() : null);
  }
  updates.push("source = 'manual'");
  if (!updates.length) return errorResponse(res, 'No fields to update', 400);
  params.push(id);
  await pool.query(`UPDATE predictions SET ${updates.join(', ')} WHERE id = ?`, params);
  return successResponse(res, null, 'Prediction updated');
});

exports.remove = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM predictions WHERE id = ?', [req.params.id]);
  return successResponse(res, null, 'Prediction deleted');
});

exports.setResult = asyncHandler(async (req, res) => {
  const { result, home_score, away_score } = req.body;
  await pool.query(
    'UPDATE predictions SET result=?, home_score=?, away_score=? WHERE id=?',
    [result, home_score ?? null, away_score ?? null, req.params.id]
  );
  return successResponse(res, null, 'Result updated');
});

exports.togglePublish = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT published_at FROM predictions WHERE id=?', [req.params.id]);
  if (!rows.length) return errorResponse(res, 'Not found', 404);
  const nowPublished = rows[0].published_at ? null : new Date();
  await pool.query('UPDATE predictions SET published_at=? WHERE id=?', [nowPublished, req.params.id]);
  return successResponse(res, { published: !!nowPublished }, nowPublished ? 'Published' : 'Unpublished');
});

exports.toggleBanker = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query('SELECT is_banker, match_date FROM predictions WHERE id=?', [id]);
  if (!rows.length) return errorResponse(res, 'Not found', 404);
  const current = rows[0].is_banker;
  if (!current) {
    const [bankerCount] = await pool.query(
      "SELECT COUNT(*) as cnt FROM predictions WHERE is_banker=1 AND DATE(match_date)=DATE(?)", [rows[0].match_date]
    );
    if (bankerCount[0].cnt >= 2) return errorResponse(res, 'Maximum 2 bankers per day', 400);
  }
  await pool.query('UPDATE predictions SET is_banker=? WHERE id=?', [current ? 0 : 1, id]);
  return successResponse(res, null, current ? 'Banker removed' : 'Banker set');
});

exports.setCategory = asyncHandler(async (req, res) => {
  const { category } = req.body;
  await pool.query('UPDATE predictions SET category=? WHERE id=?', [category, req.params.id]);
  return successResponse(res, null, 'Category updated');
});

// ── H2H history for a prediction ─────────────────────────────────────────────
exports.getH2H = asyncHandler(async (req, res) => {
  const [pred] = await pool.query(
    'SELECT home_team, away_team FROM predictions WHERE id=?', [req.params.id]
  );
  if (!pred.length) return errorResponse(res, 'Prediction not found', 404);
  const { home_team, away_team } = pred[0];

  const [matches] = await pool.query(
    `SELECT home_team, away_team, home_score, away_score,
            DATE_FORMAT(match_date,'%d %b %Y') AS date_fmt, season
     FROM h2h_history
     WHERE (home_team = ? AND away_team = ?)
        OR (home_team = ? AND away_team = ?)
     ORDER BY match_date DESC LIMIT 10`,
    [home_team, away_team, away_team, home_team]
  );

  let homeWins = 0, draws = 0, awayWins = 0;
  const formatted = matches.map(m => {
    const flipped = m.home_team === away_team;
    const hs = flipped ? m.away_score : m.home_score;
    const as = flipped ? m.home_score : m.away_score;
    if      (hs > as) homeWins++;
    else if (hs < as) awayWins++;
    else              draws++;
    return { date: m.date_fmt, homeScore: hs, awayScore: as,
             result: hs > as ? 'H' : hs < as ? 'A' : 'D', season: m.season };
  });

  return successResponse(res, {
    homeTeam: home_team, awayTeam: away_team,
    matches: formatted,
    summary: { homeWins, draws, awayWins, total: matches.length },
  });
});

// ── Full Poisson market probability breakdown ─────────────────────────────────
exports.getProbabilities = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.home_team, p.away_team,
            COALESCE(p.home_goals_avg,          tsh.home_goals_scored_avg,   tsh.goals_scored_avg,   1.3) AS homeGA,
            COALESCE(p.away_goals_avg,          tsa.away_goals_scored_avg,   tsa.goals_scored_avg,   1.1) AS awayGA,
            COALESCE(p.home_goals_conceded_avg, tsh.home_goals_conceded_avg, tsh.goals_conceded_avg, 1.2) AS homeGCA,
            COALESCE(p.away_goals_conceded_avg, tsa.away_goals_conceded_avg, tsa.goals_conceded_avg, 1.3) AS awayGCA,
            tsh.home_corners_avg AS homeCornerAvg,
            tsa.away_corners_avg AS awayCornerAvg
     FROM predictions p
     LEFT JOIN team_statistics tsh
       ON tsh.team_name = p.home_team AND tsh.league_id = p.league_id
      AND tsh.season = (SELECT MAX(t.season) FROM team_statistics t WHERE t.team_name = p.home_team AND t.league_id = p.league_id)
     LEFT JOIN team_statistics tsa
       ON tsa.team_name = p.away_team AND tsa.league_id = p.league_id
      AND tsa.season = (SELECT MAX(t.season) FROM team_statistics t WHERE t.team_name = p.away_team AND t.league_id = p.league_id)
     WHERE p.id = ?`,
    [req.params.id]
  );
  if (!rows.length) return errorResponse(res, 'Prediction not found', 404);
  const r = rows[0];

  const { computeAllProbabilities } = require('../services/intelligence');
  const result = await computeAllProbabilities({
    homeGoalsAvg:         parseFloat(r.homeGA)  || 1.3,
    awayGoalsAvg:         parseFloat(r.awayGA)  || 1.1,
    homeGoalsConcededAvg: parseFloat(r.homeGCA) || 1.2,
    awayGoalsConcededAvg: parseFloat(r.awayGCA) || 1.3,
    homeCornerAvg: r.homeCornerAvg || null,
    awayCornerAvg: r.awayCornerAvg || null,
  });

  return successResponse(res, { homeTeam: r.home_team, awayTeam: r.away_team, ...result });
});
