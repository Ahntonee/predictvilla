const axios = require('axios');
const { pool } = require('../config/db');

const BASE = process.env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io';
const KEY  = process.env.API_FOOTBALL_KEY;

const api = axios.create({
  baseURL: BASE,
  headers: { 'x-apisports-key': KEY },
  timeout: 20000,
});

function currentSeason() {
  if (process.env.API_FOOTBALL_SEASON) return process.env.API_FOOTBALL_SEASON;
  const y = new Date().getFullYear();
  const m = new Date().getMonth() + 1;
  return m >= 6 ? String(y) : String(y - 1);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Fetch and store team statistics for all active leagues.
 * Uses home/away splits from /teams/statistics endpoint.
 * Rate: ~1 call per 300ms → safe under 50 req/min limit.
 */
async function syncAllTeamStats() {
  if (!KEY) { console.log('[HistoricalData] No API key'); return { leagues: 0, teams: 0 }; }

  const season = currentSeason();
  const [leagues] = await pool.query(
    `SELECT id, api_league_id, name FROM leagues WHERE is_active=1 AND api_league_id IS NOT NULL`
  );

  console.log(`[HistoricalData] Syncing ${leagues.length} leagues, season ${season}`);
  let totalTeams = 0;

  for (const league of leagues) {
    try {
      // Get all teams in this league/season
      const teamsResp = await api.get('/teams', {
        params: { league: league.api_league_id, season },
      });
      await sleep(300);

      const teams = teamsResp.data?.response || [];
      if (!teams.length) continue;

      for (const { team } of teams) {
        try {
          const sr = await api.get('/teams/statistics', {
            params: { team: team.id, league: league.api_league_id, season },
          });
          await sleep(300);

          const s = sr.data?.response;
          if (!s) continue;

          const goals    = s.goals   || {};
          const fixtures = s.fixtures || {};
          const form     = (s.form || '').slice(0, 20);

          const totalScoredAvg    = parseFloat(goals.for?.average?.total)  || null;
          const homeScoredAvg     = parseFloat(goals.for?.average?.home)   || null;
          const awayScoredAvg     = parseFloat(goals.for?.average?.away)   || null;
          const totalConcededAvg  = parseFloat(goals.against?.average?.total) || null;
          const homeConcededAvg   = parseFloat(goals.against?.average?.home)  || null;
          const awayConcededAvg   = parseFloat(goals.against?.average?.away)  || null;

          const mp          = fixtures.played?.total  || 0;
          const wins        = fixtures.wins?.total    || 0;
          const draws       = fixtures.draws?.total   || 0;
          const losses      = fixtures.loses?.total   || 0;
          const cleanSheets = s.clean_sheet?.total    || 0;
          const bttsCount   = s.both_scored?.total    || 0;

          await pool.query(
            `INSERT INTO team_statistics
               (api_team_id, team_name, league_id, api_league_id, season,
                matches_played, wins, draws, losses, clean_sheets, btts_count,
                goals_scored_avg, goals_conceded_avg,
                home_goals_scored_avg,  away_goals_scored_avg,
                home_goals_conceded_avg, away_goals_conceded_avg,
                home_form, away_form, updated_at)
             VALUES (?,?,?,?,?, ?,?,?,?,?,?, ?,?, ?,?, ?,?, ?,?, NOW())
             ON DUPLICATE KEY UPDATE
               team_name=VALUES(team_name),
               matches_played=VALUES(matches_played), wins=VALUES(wins),
               draws=VALUES(draws), losses=VALUES(losses),
               clean_sheets=VALUES(clean_sheets), btts_count=VALUES(btts_count),
               goals_scored_avg=VALUES(goals_scored_avg),
               goals_conceded_avg=VALUES(goals_conceded_avg),
               home_goals_scored_avg=VALUES(home_goals_scored_avg),
               away_goals_scored_avg=VALUES(away_goals_scored_avg),
               home_goals_conceded_avg=VALUES(home_goals_conceded_avg),
               away_goals_conceded_avg=VALUES(away_goals_conceded_avg),
               home_form=VALUES(home_form), away_form=VALUES(away_form),
               updated_at=NOW()`,
            [
              team.id, team.name, league.id, league.api_league_id, season,
              mp, wins, draws, losses, cleanSheets, bttsCount,
              totalScoredAvg, totalConcededAvg,
              homeScoredAvg, awayScoredAvg,
              homeConcededAvg, awayConcededAvg,
              form, form,
            ]
          );
          totalTeams++;
        } catch (err) {
          console.error(`[HistoricalData] team ${team.id} (${team.name}):`, err.message);
        }
      }

      console.log(`[HistoricalData] ${league.name}: ${teams.length} teams processed`);
    } catch (err) {
      console.error(`[HistoricalData] league ${league.api_league_id}:`, err.message);
    }
  }

  await pool.query(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES ('last_team_stats_sync', NOW())
     ON DUPLICATE KEY UPDATE setting_value = NOW()`
  );
  console.log(`[HistoricalData] Done — ${totalTeams} teams across ${leagues.length} leagues`);
  return { leagues: leagues.length, teams: totalTeams };
}

/**
 * Fetch corner averages from recent fixtures for teams playing today/tomorrow.
 * Appends home_corners_avg / away_corners_avg to existing team_statistics rows.
 */
async function syncCornerStats() {
  if (!KEY) return 0;

  const season = currentSeason();
  // Find teams without corner data that have upcoming fixtures
  const [teams] = await pool.query(
    `SELECT DISTINCT ts.api_team_id, ts.team_name, ts.api_league_id, ts.id as ts_id
     FROM team_statistics ts
     JOIN predictions p ON (p.home_team = ts.team_name OR p.away_team = ts.team_name)
                        AND p.league_id = ts.league_id
     WHERE DATE(p.match_date) IN (CURDATE(), CURDATE()+1)
       AND (ts.home_corners_avg IS NULL OR ts.away_corners_avg IS NULL)
       AND ts.api_team_id IS NOT NULL
     LIMIT 40`
  );

  let updated = 0;
  for (const t of teams) {
    try {
      // Fetch last 10 fixtures for this team
      const resp = await api.get('/fixtures', {
        params: { team: t.api_team_id, league: t.api_league_id, season, last: 10 },
      });
      await sleep(300);

      const fixtures = resp.data?.response || [];
      if (!fixtures.length) continue;

      let homeCorners = [], awayCorners = [];

      for (const fx of fixtures) {
        // Only fetch stats for finished fixtures
        const status = fx.fixture?.status?.short;
        if (!['FT','AET','PEN'].includes(status)) continue;

        try {
          const sr = await api.get('/fixtures/statistics', {
            params: { fixture: fx.fixture.id, type: 'Corner Kicks' },
          });
          await sleep(200);

          const stats = sr.data?.response || [];
          for (const teamStat of stats) {
            if (!teamStat.statistics?.[0]) continue;
            const corners = parseInt(teamStat.statistics[0].value) || 0;
            const isHome = teamStat.team.id === t.api_team_id &&
                           fx.teams.home.id === t.api_team_id;
            if (isHome) homeCorners.push(corners);
            else awayCorners.push(corners);
          }
        } catch {}
      }

      const avgHome = homeCorners.length
        ? (homeCorners.reduce((a, b) => a + b, 0) / homeCorners.length)
        : null;
      const avgAway = awayCorners.length
        ? (awayCorners.reduce((a, b) => a + b, 0) / awayCorners.length)
        : null;
      const avgTotal = (avgHome !== null && avgAway !== null)
        ? (avgHome + avgAway) / 2
        : (avgHome ?? avgAway);

      if (avgHome !== null || avgAway !== null) {
        await pool.query(
          `UPDATE team_statistics
           SET home_corners_avg=?, away_corners_avg=?, corners_avg=?, updated_at=NOW()
           WHERE id=?`,
          [avgHome, avgAway, avgTotal, t.ts_id]
        );
        updated++;
      }
    } catch (err) {
      console.error(`[HistoricalData] corners team ${t.api_team_id}:`, err.message);
    }
  }

  console.log(`[HistoricalData] Corner stats updated for ${updated} teams`);
  return updated;
}

/**
 * Fetch H2H for today's/tomorrow's fixtures that don't have h2h_summary yet.
 * Stores raw results in h2h_history and writes a compact summary to predictions.
 */
async function syncH2HForUpcoming() {
  if (!KEY) return 0;

  const [fixtures] = await pool.query(
    `SELECT p.id, p.api_fixture_id, p.home_team, p.away_team
     FROM predictions p
     WHERE DATE(p.match_date) IN (CURDATE(), CURDATE()+1)
       AND p.api_fixture_id IS NOT NULL
       AND (p.h2h_summary IS NULL OR p.h2h_summary = '')
     LIMIT 30`
  );

  let updated = 0;
  for (const f of fixtures) {
    try {
      // Resolve team IDs from the fixture
      const fxResp = await api.get('/fixtures', { params: { id: f.api_fixture_id } });
      await sleep(300);
      const fxData = fxResp.data?.response?.[0];
      if (!fxData) continue;

      const homeId = fxData.teams.home.id;
      const awayId = fxData.teams.away.id;

      const h2hResp = await api.get('/fixtures/headtohead', {
        params: { h2h: `${homeId}-${awayId}`, last: 10 },
      });
      await sleep(300);

      const matches = h2hResp.data?.response || [];

      // Persist raw H2H to h2h_history
      for (const m of matches) {
        if (m.goals.home === null || m.goals.away === null) continue;
        try {
          await pool.query(
            `INSERT IGNORE INTO h2h_history
               (home_api_id, away_api_id, fixture_api_id, match_date,
                home_team, away_team, home_score, away_score, league_api_id, season)
             VALUES (?,?,?,?,?,?,?,?,?,?)`,
            [m.teams.home.id, m.teams.away.id, m.fixture.id, new Date(m.fixture.date),
             m.teams.home.name, m.teams.away.name,
             m.goals.home, m.goals.away, m.league.id, String(m.league.season)]
          );
        } catch {}
      }

      // Build compact summary string (recent 5 vs older 5)
      const recent = matches.slice(0, 5);
      const older  = matches.slice(5, 10);

      const tally = (list) => {
        let h = 0, a = 0, d = 0;
        for (const m of list) {
          const fromHome = m.teams.home.id === homeId;
          const hs = m.goals.home, as = m.goals.away;
          if (hs > as) fromHome ? h++ : a++;
          else if (hs < as) fromHome ? a++ : h++;
          else d++;
        }
        return { h, a, d };
      };

      const r = tally(recent);
      const o = tally(older);

      const summary = `RH${r.h}RA${r.a}RD${r.d}|OH${o.h}OA${o.a}OD${o.d}`;
      await pool.query(
        `UPDATE predictions SET h2h_summary=? WHERE api_fixture_id=?`,
        [summary, f.api_fixture_id]
      );
      updated++;
    } catch (err) {
      console.error(`[HistoricalData] H2H fixture ${f.api_fixture_id}:`, err.message);
    }
  }

  console.log(`[HistoricalData] H2H synced for ${updated} fixtures`);
  return updated;
}

/**
 * Fetch ALL finished fixtures for one league/season in a single API call.
 * Extracts:
 *   • H2H records → h2h_history table
 *   • Per-team goal averages (home/away splits) → team_statistics table
 *
 * This is the most quota-efficient way to build historical data:
 * 1 API call per league per season instead of 1 call per team.
 */
async function seedHistoricalFixtures(leagueApiId, dbLeagueId, season) {
  if (!KEY) return { fixtures: 0, teams: 0 };

  let fixtures = [];
  try {
    const resp = await api.get('/fixtures', {
      params: { league: leagueApiId, season, status: 'FT' },
      timeout: 25000,
    });
    await sleep(400);
    fixtures = resp.data?.response || [];
  } catch (err) {
    console.error(`[HistoricalData] fixtures ${leagueApiId}/${season}:`, err.message);
    return { fixtures: 0, teams: 0 };
  }

  if (!fixtures.length) return { fixtures: 0, teams: 0 };

  // Aggregate per-team stats keyed by api_team_id
  const teamMap = new Map();

  for (const f of fixtures) {
    if (f.goals.home === null || f.goals.away === null) continue;

    const ht = f.teams.home, at = f.teams.away;
    const hs = f.goals.home, as = f.goals.away;

    // ── H2H history ───────────────────────────────────────────────────────
    try {
      await pool.query(
        `INSERT IGNORE INTO h2h_history
           (home_api_id, away_api_id, fixture_api_id, match_date,
            home_team, away_team, home_score, away_score, league_api_id, season)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [ht.id, at.id, f.fixture.id, new Date(f.fixture.date),
         ht.name, at.name, hs, as, leagueApiId, String(season)]
      );
    } catch {}

    // ── Aggregate for team_statistics ─────────────────────────────────────
    const ensureTeam = (id, name) => {
      if (!teamMap.has(id)) teamMap.set(id, { id, name, home: [], away: [] });
      return teamMap.get(id);
    };
    ensureTeam(ht.id, ht.name).home.push({ scored: hs, conceded: as });
    ensureTeam(at.id, at.name).away.push({ scored: as, conceded: hs });
  }

  // ── Upsert computed stats into team_statistics ────────────────────────
  let teamsUpdated = 0;
  const avg = (arr, key) => arr.length ? arr.reduce((s, g) => s + g[key], 0) / arr.length : null;

  for (const [apiId, ts] of teamMap) {
    const all = [...ts.home, ...ts.away];
    if (all.length < 3) continue; // not enough data to be meaningful

    const vals = {
      homeScoredAvg:    avg(ts.home, 'scored'),
      awayScoredAvg:    avg(ts.away, 'scored'),
      homeConcededAvg:  avg(ts.home, 'conceded'),
      awayConcededAvg:  avg(ts.away, 'conceded'),
      totalScoredAvg:   avg(all,     'scored'),
      totalConcededAvg: avg(all,     'conceded'),
      mp:     all.length,
      wins:   all.filter(g => g.scored > g.conceded).length,
      draws:  all.filter(g => g.scored === g.conceded).length,
      losses: all.filter(g => g.scored < g.conceded).length,
      cleanSheets: all.filter(g => g.conceded === 0).length,
      bttsCount:   all.filter(g => g.scored >= 1 && g.conceded >= 1).length,
    };

    try {
      const [existing] = await pool.query(
        'SELECT id FROM team_statistics WHERE api_team_id=? AND api_league_id=? AND season=?',
        [apiId, leagueApiId, season]
      );

      if (existing.length) {
        await pool.query(
          `UPDATE team_statistics SET
             team_name=?, matches_played=?, wins=?, draws=?, losses=?,
             clean_sheets=?, btts_count=?,
             goals_scored_avg=?, goals_conceded_avg=?,
             home_goals_scored_avg=?, away_goals_scored_avg=?,
             home_goals_conceded_avg=?, away_goals_conceded_avg=?,
             updated_at=NOW()
           WHERE id=?`,
          [ts.name, vals.mp, vals.wins, vals.draws, vals.losses,
           vals.cleanSheets, vals.bttsCount,
           vals.totalScoredAvg, vals.totalConcededAvg,
           vals.homeScoredAvg, vals.awayScoredAvg,
           vals.homeConcededAvg, vals.awayConcededAvg,
           existing[0].id]
        );
      } else {
        await pool.query(
          `INSERT INTO team_statistics
             (api_team_id, team_name, league_id, api_league_id, season,
              matches_played, wins, draws, losses, clean_sheets, btts_count,
              goals_scored_avg, goals_conceded_avg,
              home_goals_scored_avg, away_goals_scored_avg,
              home_goals_conceded_avg, away_goals_conceded_avg)
           VALUES (?,?,?,?,?, ?,?,?,?,?,?, ?,?, ?,?, ?,?)`,
          [apiId, ts.name, dbLeagueId, leagueApiId, season,
           vals.mp, vals.wins, vals.draws, vals.losses, vals.cleanSheets, vals.bttsCount,
           vals.totalScoredAvg, vals.totalConcededAvg,
           vals.homeScoredAvg, vals.awayScoredAvg,
           vals.homeConcededAvg, vals.awayConcededAvg]
        );
      }
      teamsUpdated++;
    } catch (err) {
      console.error(`[HistoricalData] upsert team ${apiId} (${ts.name}):`, err.message);
    }
  }

  return { fixtures: fixtures.length, teams: teamsUpdated };
}

/**
 * Full 2-year historical seed.
 * Fetches ALL finished fixtures for each active league for each requested season.
 * Quota cost: 1 API call per league per season.
 * 164 leagues × 2 seasons = ~328 API calls total.
 * At 400ms gap: completes in ~2–3 minutes.
 *
 * Populates:
 *   • h2h_history       — every match result for every pair of teams
 *   • team_statistics   — real home/away goal averages per team per season
 */
async function runFullHistoricalSeed(seasons, leagueApiIds) {
  if (!KEY) return { error: 'No API key configured' };

  // Default: current season + previous season
  if (!seasons || !seasons.length) {
    const year = new Date().getFullYear();
    const month = new Date().getMonth() + 1;
    const current = month >= 6 ? year : year - 1;
    seasons = [String(current - 1), String(current)];
  }

  const selectedIds = Array.isArray(leagueApiIds)
    ? leagueApiIds.map(Number).filter(Number.isInteger)
    : [];
  const leagueSql = selectedIds.length
    ? `SELECT id, api_league_id, name FROM leagues WHERE api_league_id IN (${selectedIds.map(() => '?').join(',')})`
    : 'SELECT id, api_league_id, name FROM leagues WHERE is_active=1 AND api_league_id IS NOT NULL';
  const [leagues] = await pool.query(leagueSql, selectedIds);

  const totals = { seasons: seasons.length, leaguesProcessed: 0, fixtures: 0, teams: 0, errors: 0 };

  for (const season of seasons) {
    console.log(`[HistoricalData] Season ${season}: seeding ${leagues.length} leagues…`);
    for (const league of leagues) {
      try {
        const r = await seedHistoricalFixtures(league.api_league_id, league.id, season);
        totals.fixtures += r.fixtures;
        totals.teams    += r.teams;
        totals.leaguesProcessed++;
        if (r.fixtures > 0) {
          console.log(`  ${league.name} ${season}: ${r.fixtures} fixtures, ${r.teams} teams`);
        }
      } catch (err) {
        totals.errors++;
        console.error(`  [ERR] ${league.name} ${season}:`, err.message);
      }
    }
    console.log(`[HistoricalData] Season ${season} done.`);
  }

  await pool.query(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES ('last_historical_seed', NOW())
     ON DUPLICATE KEY UPDATE setting_value = NOW()`
  );
  console.log('[HistoricalData] Full historical seed complete:', totals);
  return totals;
}

module.exports = {
  syncAllTeamStats, syncCornerStats, syncH2HForUpcoming,
  seedHistoricalFixtures, runFullHistoricalSeed,
};
