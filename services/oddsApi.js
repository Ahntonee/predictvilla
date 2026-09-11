const axios = require('axios');
const { pool } = require('../config/db');

const BASE = process.env.ODDS_API_BASE_URL || 'https://api.the-odds-api.com/v4';
const KEY = process.env.ODDS_API_KEY;

async function getCallsToday() {
  const [rows] = await pool.query(`SELECT setting_value FROM site_settings WHERE setting_key = 'odds_api_calls_today'`);
  return parseInt(rows[0]?.setting_value || '0');
}
async function incrementCallsToday() {
  await pool.query(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES ('odds_api_calls_today', '1')
     ON DUPLICATE KEY UPDATE setting_value = CAST(CAST(setting_value AS UNSIGNED) + 1 AS CHAR)`
  );
}

function fuzzyTeamMatch(name1, name2) {
  const n1 = name1.toLowerCase().replace(/[^a-z]/g, '');
  const n2 = name2.toLowerCase().replace(/[^a-z]/g, '');
  return n1.includes(n2.slice(0, 4)) || n2.includes(n1.slice(0, 4));
}

async function getLiveOddsForFixture(homeTeam, awayTeam, commenceDate) {
  if (!KEY || KEY.includes('YOUR_ODDS_API')) return null;
  const calls = await getCallsToday();
  if (calls >= 16) return null; // stay under 500/month free tier

  try {
    const date = new Date(commenceDate);
    const resp = await axios.get(`${BASE}/sports/soccer/odds/`, {
      params: {
        apiKey: KEY,
        regions: 'uk,eu,us,af',
        markets: 'h2h,totals',
        dateFormat: 'iso',
      },
      timeout: 8000,
    });
    await incrementCallsToday();

    const events = resp.data || [];
    const dateMin = new Date(date.getTime() - 24 * 3600 * 1000);
    const dateMax = new Date(date.getTime() + 24 * 3600 * 1000);

    const match = events.find(e => {
      const ct = new Date(e.commence_time);
      if (ct < dateMin || ct > dateMax) return false;
      return (fuzzyTeamMatch(e.home_team, homeTeam) && fuzzyTeamMatch(e.away_team, awayTeam));
    });

    if (!match) return null;

    const bookmakerNames = match.bookmakers?.map(b => b.title) || [];
    let homeOdds, drawOdds, awayOdds, over25Odds, under25Odds;

    for (const bk of match.bookmakers || []) {
      for (const mkt of bk.markets || []) {
        if (mkt.key === 'h2h' && !homeOdds) {
          mkt.outcomes?.forEach(o => {
            if (fuzzyTeamMatch(o.name, homeTeam)) homeOdds = o.price;
            else if (fuzzyTeamMatch(o.name, awayTeam)) awayOdds = o.price;
            else drawOdds = o.price;
          });
        }
        if (mkt.key === 'totals' && !over25Odds) {
          mkt.outcomes?.forEach(o => {
            if (o.name === 'Over' && Math.abs(o.point - 2.5) < 0.1) over25Odds = o.price;
            if (o.name === 'Under' && Math.abs(o.point - 2.5) < 0.1) under25Odds = o.price;
          });
        }
      }
    }

    return { bookmakers: bookmakerNames, homeOdds, drawOdds, awayOdds, over25Odds, under25Odds };
  } catch (err) {
    console.error('[OddsAPI] Error:', err.message);
    return null;
  }
}

async function syncOddsForTodayFixtures() {
  if (!KEY || KEY.includes('YOUR_ODDS_API')) return 0;
  const [predictions] = await pool.query(
    `SELECT id, home_team, away_team, match_date FROM predictions
     WHERE DATE(match_date) = CURDATE() AND result = 'pending' ORDER BY match_date`
  );

  let updated = 0;
  for (const pred of predictions) {
    const odds = await getLiveOddsForFixture(pred.home_team, pred.away_team, pred.match_date);
    if (odds?.bookmakers?.length) {
      await pool.query(
        'UPDATE predictions SET bookies_available = ? WHERE id = ?',
        [JSON.stringify(odds.bookmakers), pred.id]
      );
      updated++;
    }
  }
  console.log(`[OddsAPI] Synced bookie odds for ${updated}/${predictions.length} fixtures`);
  return updated;
}

module.exports = { getLiveOddsForFixture, syncOddsForTodayFixtures };
