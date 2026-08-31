const axios = require('axios');
const { pool } = require('../config/db');
const { generatePredictionSlug } = require('../utils/helpers');
const quota = require('./apiQuota');

const BASE = process.env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io';
const KEY = process.env.API_FOOTBALL_KEY;
// Dynamically pick season: Aug-Dec = current year, Jan-Jul = current year (leagues started prev year)
function currentSeason() {
  const y = new Date().getFullYear();
  const m = new Date().getMonth() + 1; // 1-12
  // Most leagues: season = year they start. Summer months (Jun/Jul) overlap two seasons — use env override if set.
  if (process.env.API_FOOTBALL_SEASON) return process.env.API_FOOTBALL_SEASON;
  return m >= 6 ? String(y) : String(y - 1);
}
const SEASON = currentSeason();

const api = axios.create({
  baseURL: BASE,
  headers: { 'x-apisports-key': KEY },
  timeout: 15000,
});

// All external API calls go through here — enforces the 2500/day cap
async function trackedGet(endpoint, params) {
  quota.checkAndIncrement(endpoint);
  return api.get(endpoint, { params });
}

async function getLeagueIds() {
  const [rows] = await pool.query('SELECT api_league_id FROM leagues WHERE is_active = 1 AND api_league_id IS NOT NULL');
  return rows.map(r => r.api_league_id);
}

async function syncFixtures(daysAhead = 0) {
  if (!KEY) { console.log('[ApiFootball] No API key configured'); return 0; }

  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  const dateStr = date.toISOString().split('T')[0];

  // Build a set of our active api_league_ids for fast lookup
  const [dbLeagues] = await pool.query(
    'SELECT id, api_league_id FROM leagues WHERE is_active=1 AND api_league_id IS NOT NULL'
  );
  const leagueMap = new Map(dbLeagues.map(l => [l.api_league_id, l.id]));

  // Single API call for the whole date — vastly more efficient than one call per league
  let fixtures = [];
  try {
    const resp = await trackedGet('/fixtures', { date: dateStr, timezone: 'UTC' });
    fixtures = resp.data?.response || [];
  } catch (err) {
    console.error('[ApiFootball] syncFixtures fetch error:', err.message);
    return 0;
  }

  // Filter to only leagues we track
  const relevant = fixtures.filter(f => leagueMap.has(f.league.id));
  console.log(`[ApiFootball] ${fixtures.length} total fixtures on ${dateStr}, ${relevant.length} in tracked leagues`);

  let synced = 0;
  for (const f of relevant) {
    try {
      const { fixture, teams } = f;
      const dbLeagueId = leagueMap.get(f.league.id);
      const homeTeam = teams.home.name;
      const awayTeam = teams.away.name;
      const matchDate = new Date(fixture.date);
      const slug = generatePredictionSlug(homeTeam, awayTeam, matchDate);

      await pool.query(
        `INSERT IGNORE INTO predictions
           (slug, league_id, home_team, away_team, home_team_logo, away_team_logo, match_date, tip, market, category, source, api_fixture_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'TBD', '1X2', 'free', 'auto_sync', ?)`,
        [slug, dbLeagueId, homeTeam, awayTeam, teams.home.logo, teams.away.logo, matchDate, fixture.id]
      );
      synced++;
    } catch (err) {
      console.error(`[ApiFootball] insert fixture ${f.fixture.id}:`, err.message);
    }
  }

  await pool.query(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES ('last_sync_fixtures', NOW())
     ON DUPLICATE KEY UPDATE setting_value = NOW()`
  );
  console.log(`[ApiFootball] Synced ${synced} new fixtures for ${dateStr}`);
  return synced;
}

const FINISHED_STATUSES = new Set(['FT', 'AET', 'PEN', 'AWD', 'WO']);

async function syncResults() {
  if (!KEY) return 0;
  const [pending] = await pool.query(
    `SELECT id, api_fixture_id, DATE_FORMAT(match_date, '%Y-%m-%d') AS match_day
     FROM predictions
     WHERE result = 'pending' AND api_fixture_id IS NOT NULL AND match_date < NOW() - INTERVAL 2 HOUR`
  );
  if (!pending.length) return 0;

  // Group by date — 1 API call per date instead of 1 per prediction
  const byDate = new Map();
  for (const p of pending) {
    if (!byDate.has(p.match_day)) byDate.set(p.match_day, []);
    byDate.get(p.match_day).push(p);
  }

  let updated = 0;
  for (const [date, preds] of byDate) {
    try {
      const resp = await trackedGet('/fixtures', { date, timezone: 'UTC' });
      const fixtures = resp.data?.response || [];
      const fixtureMap = new Map(fixtures.map(f => [f.fixture.id, f]));

      for (const pred of preds) {
        const f = fixtureMap.get(pred.api_fixture_id);
        if (!f) continue;
        const status = f.fixture.status.short;
        if (!FINISHED_STATUSES.has(status)) continue;
        await pool.query(
          `UPDATE predictions SET home_score=?, away_score=? WHERE id=?`,
          [f.goals.home, f.goals.away, pred.id]
        );
        updated++;
      }
    } catch (err) {
      console.error(`[ApiFootball] syncResults ${date}:`, err.message);
    }
  }

  await pool.query(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES ('last_sync_results', NOW())
     ON DUPLICATE KEY UPDATE setting_value = NOW()`
  );
  console.log(`[ApiFootball] Updated ${updated} results via ${byDate.size} API call(s) (was ${pending.length})`);
  return updated;
}

async function getTeamStats(teamId, leagueId) {
  try {
    const resp = await trackedGet('/teams/statistics', { team: teamId, league: leagueId, season: SEASON });
    return resp.data?.response || null;
  } catch { return null; }
}

async function getH2H(home, away) {
  try {
    const resp = await trackedGet('/fixtures/headtohead', { h2h: `${home}-${away}`, last: 10 });
    return resp.data?.response || [];
  } catch { return []; }
}

async function getFixtureOdds(fixtureId) {
  try {
    const resp = await trackedGet('/odds', { fixture: fixtureId });
    return resp.data?.response?.[0] || null;
  } catch { return null; }
}

/**
 * Populate prediction rows with team stats for the intelligence engine.
 * Priority: team_statistics DB rows (pre-fetched by syncAllTeamStats) → live API call.
 * Live API calls only happen for teams not yet in the DB, keeping quota usage low.
 */
async function autoPredictFixtures() {
  if (!KEY) return [];

  const [fixtures] = await pool.query(
    `SELECT
       p.id, p.home_team, p.away_team, p.match_date,
       p.api_fixture_id, p.league_id, l.api_league_id,
       COALESCE(tsh.home_goals_scored_avg,   tsh.goals_scored_avg)   AS db_home_scored,
       COALESCE(tsh.home_goals_conceded_avg, tsh.goals_conceded_avg) AS db_home_conceded,
       tsh.home_form                                                  AS db_home_form,
       COALESCE(tsa.away_goals_scored_avg,   tsa.goals_scored_avg)   AS db_away_scored,
       COALESCE(tsa.away_goals_conceded_avg, tsa.goals_conceded_avg) AS db_away_conceded,
       tsa.away_form                                                  AS db_away_form
     FROM predictions p
     LEFT JOIN leagues l ON l.id = p.league_id
     LEFT JOIN team_statistics tsh
       ON tsh.team_name = p.home_team AND tsh.league_id = p.league_id
     LEFT JOIN team_statistics tsa
       ON tsa.team_name = p.away_team AND tsa.league_id = p.league_id
     WHERE p.published_at IS NULL
       AND p.result = 'pending'
       AND DATE(p.match_date) IN (CURDATE(), CURDATE()+1)
       AND p.api_fixture_id IS NOT NULL
       AND p.source IN ('auto_sync', 'intelligence')
     LIMIT 50`
  );

  const generated = [];
  for (const fx of fixtures) {
    try {
      let homeGoalsAvg, awayGoalsAvg, homeGoalsConcededAvg, awayGoalsConcededAvg;
      let homeForm, awayForm;

      if (fx.db_home_scored !== null && fx.db_away_scored !== null) {
        // Use pre-fetched DB data — no API call needed
        homeGoalsAvg         = parseFloat(fx.db_home_scored)   || 1.3;
        awayGoalsAvg         = parseFloat(fx.db_away_scored)   || 1.1;
        homeGoalsConcededAvg = parseFloat(fx.db_home_conceded) || 1.2;
        awayGoalsConcededAvg = parseFloat(fx.db_away_conceded) || 1.3;
        homeForm             = (fx.db_home_form || '').slice(-10) || null;
        awayForm             = (fx.db_away_form || '').slice(-10) || null;
      } else {
        // Fallback: fetch from API for teams not yet in our DB
        const statsResp = await trackedGet('/fixtures', { id: fx.api_fixture_id });
        const fxData    = statsResp.data?.response?.[0];
        if (!fxData) continue;

        const homeId = fxData.teams.home.id;
        const awayId = fxData.teams.away.id;

        const [homeStats, awayStats] = await Promise.all([
          getTeamStats(homeId, fx.api_league_id),
          getTeamStats(awayId, fx.api_league_id),
        ]);

        homeGoalsAvg         = parseFloat(homeStats?.goals?.for?.average?.home)     || 1.3;
        awayGoalsAvg         = parseFloat(awayStats?.goals?.for?.average?.away)     || 1.1;
        homeGoalsConcededAvg = parseFloat(homeStats?.goals?.against?.average?.home) || 1.2;
        awayGoalsConcededAvg = parseFloat(awayStats?.goals?.against?.average?.away) || 1.3;
        homeForm             = homeStats?.form?.slice(-10) || null;
        awayForm             = awayStats?.form?.slice(-10) || null;
      }

      generated.push({
        id: fx.id,
        homeGoalsAvg, awayGoalsAvg, homeGoalsConcededAvg, awayGoalsConcededAvg,
        homeForm, awayForm, leagueId: fx.api_league_id,
      });

      await pool.query(
        `UPDATE predictions
         SET home_goals_avg=?, away_goals_avg=?,
             home_goals_conceded_avg=?, away_goals_conceded_avg=?,
             home_form=?, away_form=?
         WHERE id=?`,
        [homeGoalsAvg, awayGoalsAvg,
         homeGoalsConcededAvg, awayGoalsConcededAvg,
         homeForm, awayForm, fx.id]
      );
    } catch (err) {
      console.error(`[ApiFootball] autoPredictFixtures ${fx.id}:`, err.message);
    }
  }
  return generated;
}

// Live status codes from API-Football
const LIVE_STATUSES = new Set(['1H', 'HT', '2H', 'ET', 'BT', 'P', 'INT', 'LIVE']);

/**
 * Fetches live + in-play scores for today's pending predictions.
 * Uses a single API call (/fixtures?date=today) to avoid quota waste.
 * Updates home_score, away_score, fixture_status, elapsed_minutes.
 */
async function syncLiveScores() {
  if (!KEY) return 0;

  // Only fetch predictions with an API fixture id that haven't been graded yet
  const [preds] = await pool.query(
    `SELECT id, api_fixture_id FROM predictions
     WHERE result = 'pending' AND api_fixture_id IS NOT NULL
       AND DATE(match_date) = CURDATE()`
  );
  if (!preds.length) return 0;

  const idSet = new Set(preds.map(p => p.api_fixture_id));

  // Single API call: all fixtures for today
  const today = new Date().toISOString().slice(0, 10);
  let fixtures;
  try {
    const resp = await trackedGet('/fixtures', { date: today, timezone: 'UTC' });
    fixtures = resp.data?.response || [];
  } catch (err) {
    console.error('[ApiFootball] syncLiveScores fetch error:', err.message);
    return 0;
  }

  let updated = 0;
  for (const f of fixtures) {
    const fixtureId = f.fixture.id;
    if (!idSet.has(fixtureId)) continue;

    const status = f.fixture.status.short;
    const isLive = LIVE_STATUSES.has(status);
    const isFinished = FINISHED_STATUSES.has(status);
    if (!isLive && !isFinished) continue;

    const hScore = f.goals.home ?? null;
    const aScore = f.goals.away ?? null;
    const elapsed = f.fixture.status.elapsed ?? null;

    // Find matching prediction row(s)
    const matched = preds.filter(p => p.api_fixture_id === fixtureId);
    for (const pred of matched) {
      await pool.query(
        `UPDATE predictions SET home_score=?, away_score=?, fixture_status=?, elapsed_minutes=? WHERE id=?`,
        [hScore, aScore, status, elapsed, pred.id]
      );
      updated++;
    }
  }

  console.log(`[ApiFootball] Live scores: updated ${updated} predictions`);
  return updated;
}

module.exports = { syncFixtures, syncResults, syncLiveScores, autoPredictFixtures, getTeamStats, getH2H };
