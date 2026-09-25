const router = require('express').Router();
const axios = require('axios');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler, successResponse } = require('../utils/helpers');
const { syncFixtures, syncResults, syncLiveScores, autoPredictFixtures } = require('../services/apiFootball');
const { syncOddsForTodayFixtures } = require('../services/oddsApi');
const { runForAllToday } = require('../services/intelligence');
const { logUntracked, recalculateStats, autoAdjustMarketWeights } = require('../services/accuracy');
const { syncAllTeamStats, syncCornerStats, syncH2HForUpcoming, runFullHistoricalSeed } = require('../services/historicalData');
const { refreshTeamStatistics, refreshLeagueStatistics, refreshMarketStats } = require('../services/statistics');
const { gradeFinished } = require('../services/scheduler');
const apiQuota = require('../services/apiQuota');
const { pool } = require('../config/db');

router.use(authenticate, requireAdmin);
router.use((req, res, next) => {
  if (req.method !== 'GET') {
    res.on('finish', () => {
      if (res.statusCode < 400) {
        pool.query(
          `INSERT INTO site_settings (setting_key, setting_value) VALUES ('last_sync_action', NOW())
           ON DUPLICATE KEY UPDATE setting_value=NOW()`
        ).catch(error => console.error('[Sync] Could not update last sync timestamp:', error.message));
      }
    });
  }
  next();
});

router.post('/fixtures', asyncHandler(async (req, res) => {
  const count = await syncFixtures(0);
  return successResponse(res, { synced: count }, `Synced ${count} fixtures`);
}));

router.post('/fixtures/tomorrow', asyncHandler(async (req, res) => {
  const count = await syncFixtures(1);
  return successResponse(res, { synced: count }, `Synced ${count} tomorrow fixtures`);
}));

router.post('/results', asyncHandler(async (req, res) => {
  const count = await syncResults();
  return successResponse(res, { updated: count }, `Updated ${count} results`);
}));

router.post('/live', asyncHandler(async (req, res) => {
  const updated = await syncLiveScores();
  await gradeFinished();
  return successResponse(res, { updated }, `Live scores synced for ${updated} predictions`);
}));

router.post('/scores', asyncHandler(async (req, res) => {
  await gradeFinished();
  return successResponse(res, null, 'Scores processed');
}));

router.post('/auto-predict', asyncHandler(async (req, res) => {
  const fixtures = await autoPredictFixtures();
  const result = await runForAllToday();
  return successResponse(res, { fixtures: fixtures.length, ...result }, 'Auto-predict complete');
}));

router.post('/odds', asyncHandler(async (req, res) => {
  const updated = await syncOddsForTodayFixtures();
  return successResponse(res, { updated }, `Updated API-Football odds for ${updated} predictions`);
}));

router.post('/statistics', asyncHandler(async (req, res) => {
  await refreshTeamStatistics();
  await refreshLeagueStatistics();
  await refreshMarketStats();
  return successResponse(res, null, 'Statistics refreshed');
}));

router.post('/accuracy', asyncHandler(async (req, res) => {
  const logged = await logUntracked();
  const stats = await recalculateStats();
  return successResponse(res, { logged, ...stats }, 'Accuracy stats recalculated');
}));

// ── Historical data sync ──────────────────────────────────────────────────────

router.post('/team-stats', asyncHandler(async (req, res) => {
  const result = await syncAllTeamStats();
  return successResponse(res, result,
    `Team stats synced: ${result.teams} teams across ${result.leagues} leagues`);
}));

router.post('/corner-stats', asyncHandler(async (req, res) => {
  const updated = await syncCornerStats();
  return successResponse(res, { updated }, `Corner stats updated for ${updated} teams`);
}));

router.post('/h2h', asyncHandler(async (req, res) => {
  const updated = await syncH2HForUpcoming();
  return successResponse(res, { updated }, `H2H synced for ${updated} upcoming fixtures`);
}));

router.post('/adjust-weights', asyncHandler(async (req, res) => {
  await autoAdjustMarketWeights();
  return successResponse(res, null, 'Market weights auto-adjusted from historical win rates');
}));

// Kick off in background — returns immediately with a job ID message.
// The actual work logs to console and updates site_settings when done.
router.post('/seed-historical', asyncHandler(async (req, res) => {
  const seasons = req.body?.seasons || null;
  const leagues = Array.isArray(req.body?.leagues)
    ? req.body.leagues.map(Number).filter(Number.isInteger)
    : null;
  if (Array.isArray(seasons) && !seasons.length) {
    return res.status(400).json({ success: false, message: 'Select at least one season to backfill' });
  }
  if (Array.isArray(leagues) && !leagues.length) {
    return res.status(400).json({ success: false, message: 'Select at least one league to backfill' });
  }
  // Don't await — runs in background so the HTTP request doesn't time out
  setImmediate(() => {
    runFullHistoricalSeed(seasons, leagues).catch(err =>
      console.error('[SeedHistorical] background error:', err.message)
    );
  });
  const desc = seasons ? seasons.join(', ') : 'current + previous season';
  return successResponse(res, { status: 'started', seasons: desc, leagues: leagues?.length || 'all active' },
    `Historical seed started in background (${desc}). Check server logs for progress.`);
}));

router.get('/status', asyncHandler(async (req, res) => {
  const keys = ['last_sync_fixtures','last_sync_results','last_intelligence_run','odds_api_calls_today'];
  const [rows] = await pool.query(
    `SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN (${keys.map(() => '?').join(',')})`,
    keys
  );
  const status = {};
  rows.forEach(r => { status[r.setting_key] = r.setting_value; });
  return successResponse(res, status);
}));

// API-Football live quota status
router.get('/api-status', asyncHandler(async (req, res) => {
  const KEY = process.env.API_FOOTBALL_KEY;
  const BASE = process.env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io';
  const local = { calls_today: apiQuota.getToday(), daily_limit: apiQuota.getLimit() };
  if (!KEY) return successResponse(res, { local, requests: { current: 0, limit_day: 0 } });
  try {
    const r = await axios.get(`${BASE}/status`, { headers: { 'x-apisports-key': KEY }, timeout: 8000 });
    return successResponse(res, { local, ...(r.data.response || {}) });
  } catch {
    return successResponse(res, { local });
  }
}));

// Sync all leagues from API-Football
router.post('/leagues', asyncHandler(async (req, res) => {
  const KEY = process.env.API_FOOTBALL_KEY;
  const BASE = process.env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io';
  if (!KEY) return successResponse(res, { synced: 0 }, 'No API key configured');
  const r = await axios.get(`${BASE}/leagues`, { headers: { 'x-apisports-key': KEY }, timeout: 15000 });
  const leagues = r.data.response || [];
  let synced = 0;
  for (const item of leagues) {
    const l = item.league;
    const c = item.country;
    if (!l?.id) continue;
    await pool.query(
      `INSERT INTO leagues (api_league_id, name, country, logo_url, is_active)
       VALUES (?, ?, ?, ?, 0)
       ON DUPLICATE KEY UPDATE name=VALUES(name), country=VALUES(country), logo_url=VALUES(logo_url)`,
      [l.id, l.name, c?.name || '', l.logo || '']
    );
    synced++;
  }
  return successResponse(res, { synced }, `Synced ${synced} leagues`);
}));

// Seed fixtures for a date range (up to 60 days) — runs in background
router.post('/fixtures/range', asyncHandler(async (req, res) => {
  const KEY = process.env.API_FOOTBALL_KEY;
  const BASE = process.env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io';
  if (!KEY) return successResponse(res, { synced: 0 }, 'No API key configured');

  const days = Math.min(Math.max(parseInt(req.body?.days) || 30, 1), 60);
  const fromOffset = Math.max(parseInt(req.body?.fromOffset) || 0, 0);
  const season = process.env.API_FOOTBALL_SEASON || new Date().getFullYear();

  // Respond immediately — work runs in background
  res.json({ success: true, data: { days, fromOffset }, message: `Seeding ${days} days of fixtures in background (offsets +${fromOffset} to +${fromOffset + days - 1}). Watch server logs.` });

  setImmediate(async () => {
    let totalSynced = 0;
    for (let i = fromOffset; i < fromOffset + days; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const dateStr = d.toISOString().split('T')[0];
      try {
        const r = await axios.get(`${BASE}/fixtures`, {
          params: { date: dateStr, season },
          headers: { 'x-apisports-key': KEY },
          timeout: 20000,
        });
        const fixtures = r.data.response || [];
        let dayCnt = 0;
        for (const f of fixtures) {
          const fix = f.fixture, teams = f.teams, league = f.league;
          if (!fix?.id) continue;
          const [leagueRows] = await pool.query('SELECT id FROM leagues WHERE api_league_id = ?', [league.id]);
          if (!leagueRows.length) continue;
          await pool.query(
            `INSERT INTO fixtures (api_fixture_id, league_id, home_team, away_team, match_date, status, season)
             VALUES (?,?,?,?,?,?,?)
             ON DUPLICATE KEY UPDATE status=VALUES(status)`,
            [fix.id, leagueRows[0].id, teams.home.name, teams.away.name, new Date(fix.date), fix.status?.short || 'TBD', league.season]
          );
          dayCnt++;
        }
        totalSynced += dayCnt;
        console.log(`[range-seed] ${dateStr}: ${dayCnt} fixtures stored`);
        await new Promise(r => setTimeout(r, 150)); // gentle rate-limit
      } catch (err) {
        console.error(`[range-seed] ${dateStr} error:`, err.message);
      }
    }
    console.log(`[range-seed] Done — ${totalSynced} total fixtures across ${days} days`);
  });
}));

// Sync fixtures for a specific date
router.post('/fixtures/by-date', asyncHandler(async (req, res) => {
  const date = req.body?.date;
  if (!date) return res.status(400).json({ success: false, message: 'date required' });
  const KEY = process.env.API_FOOTBALL_KEY;
  const BASE = process.env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io';
  if (!KEY) return successResponse(res, { synced: 0 }, 'No API key');
  const r = await axios.get(`${BASE}/fixtures`, {
    params: { date },
    headers: { 'x-apisports-key': KEY },
    timeout: 20000,
  });
  const fixtures = r.data.response || [];
  const { pool: db } = require('../config/db');
  let synced = 0;
  for (const f of fixtures) {
    const fix = f.fixture; const teams = f.teams; const league = f.league;
    if (!fix?.id) continue;
    const [leagueRows] = await db.query('SELECT id FROM leagues WHERE api_league_id = ?', [league.id]);
    if (!leagueRows.length) continue;
    await db.query(
      `INSERT INTO fixtures (api_fixture_id, league_id, home_team, away_team, match_date, status, season)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status=VALUES(status)`,
      [fix.id, leagueRows[0].id, teams.home.name, teams.away.name, new Date(fix.date), fix.status?.short || 'TBD', league.season]
    );
    synced++;
  }
  return successResponse(res, { synced, date }, `Synced ${synced} fixtures for ${date}`);
}));

// Update results for a specific date
router.post('/results/by-date', asyncHandler(async (req, res) => {
  const date = req.body?.date;
  if (!date) return res.status(400).json({ success: false, message: 'date required' });
  const count = await syncResults(date);
  return successResponse(res, { updated: count, date }, `Updated ${count} results for ${date}`);
}));

// Auto-predict with controls
router.post('/auto-predict/run', asyncHandler(async (req, res) => {
  const { targetDate = 'today', limit = 20, minConfidence = 68, autoPublish = true } = req.body || {};
  const options = {
    targetDate: ['today', 'tomorrow', 'today+tomorrow'].includes(targetDate) ? targetDate : 'today',
    limit: Math.min(Math.max(parseInt(limit) || 20, 1), 100),
    minConfidence: Math.min(Math.max(parseInt(minConfidence) || 68, 1), 99),
    autoPublish: autoPublish === true,
  };
  let fixturesSynced = 0;
  if (options.targetDate === 'today' || options.targetDate === 'today+tomorrow') {
    fixturesSynced += await syncFixtures(0);
  }
  if (options.targetDate === 'tomorrow' || options.targetDate === 'today+tomorrow') {
    fixturesSynced += await syncFixtures(1);
  }
  const fixtures = await autoPredictFixtures(options);
  const result = await runForAllToday(options);
  const message = result.autoPublished > 0
    ? `Auto-predict published ${result.autoPublished} prediction${result.autoPublished === 1 ? '' : 's'} to the frontend`
    : result.generated > 0
      ? `Generated ${result.generated} prediction${result.generated === 1 ? '' : 's'}, but none reached ${options.minConfidence}% confidence for auto-publishing`
      : 'No eligible fixtures were found. Sync active leagues and verify the selected date.';
  return successResponse(res, {
    fixturesSynced,
    fixturesPrepared: Array.isArray(fixtures) ? fixtures.length : 0,
    thresholds: { confidence: options.minConfidence },
    ...result,
  }, message);
}));

module.exports = router;
