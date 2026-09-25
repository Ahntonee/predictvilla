const { pool } = require('../config/db');
const { getFixtureOdds } = require('./apiFootball');

const normalise = value => String(value || '').toLowerCase().replace(/[^a-z0-9.]+/g, ' ').trim();

function tipAliases(tip, homeTeam, awayTeam) {
  const map = {
    'Home Win': [homeTeam, 'Home'], 'Away Win': [awayTeam, 'Away'], Draw: ['Draw'],
    'BTTS Yes': ['Yes'], 'BTTS No': ['No'],
    'Double Chance 1X': ['Home/Draw', '1X'], 'Double Chance X2': ['Draw/Away', 'X2'],
    'Double Chance 12': ['Home/Away', '12'],
    'Draw No Bet Home': [homeTeam, 'Home'], 'Draw No Bet Away': [awayTeam, 'Away'],
  };
  const shortened = String(tip || '').replace(/\s+(Goals|Corners)$/i, '');
  return [tip, shortened, ...(map[tip] || [])].map(normalise);
}

function findTipOdds(apiOdds, tip, homeTeam, awayTeam) {
  const aliases = tipAliases(tip, homeTeam, awayTeam);
  const marketWords = tip.includes('Corner') ? ['corner']
    : tip.startsWith('BTTS') ? ['both', 'teams']
      : tip.startsWith('Double Chance') ? ['double', 'chance']
        : tip.startsWith('Draw No Bet') ? ['draw', 'bet']
          : tip.startsWith('First Half') ? ['first', 'half']
            : /^(Over|Under)/.test(tip) ? ['goals', 'over', 'under']
              : ['match', 'winner'];
  for (const bookmaker of apiOdds?.bookmakers || []) {
    for (const bet of bookmaker.bets || []) {
      const betName = normalise(bet.name);
      if (!marketWords.some(word => betName.includes(word))) continue;
      for (const value of bet.values || []) {
        const valueName = normalise(value.value);
        if (aliases.some(alias => valueName === alias || valueName.includes(alias))) {
          const odds = parseFloat(value.odd);
          if (odds > 1) return { odds, bookmaker: bookmaker.name };
        }
      }
    }
  }
  return null;
}

async function getLiveOddsForFixture(homeTeam, awayTeam, commenceDate, fixtureId) {
  if (!fixtureId) return null;
  const raw = await getFixtureOdds(fixtureId);
  if (!raw) return null;
  const price = tip => findTipOdds(raw, tip, homeTeam, awayTeam)?.odds;
  return {
    raw, bookmakers: (raw.bookmakers || []).map(b => b.name), fixtureId, homeTeam, awayTeam, commenceDate,
    homeOdds: price('Home Win'), drawOdds: price('Draw'), awayOdds: price('Away Win'),
    over25Odds: price('Over 2.5 Goals'), under25Odds: price('Under 2.5 Goals'),
  };
}

async function autofillPredictionOdds(predictionId) {
  const [rows] = await pool.query(
    'SELECT id, api_fixture_id, home_team, away_team, match_date, tip FROM predictions WHERE id=? LIMIT 1',
    [predictionId]
  );
  if (!rows.length) return { found: false, reason: 'Prediction not found' };
  const prediction = rows[0];
  if (!prediction.api_fixture_id) return { found: false, reason: 'This prediction has no API-Football fixture ID' };
  const live = await getLiveOddsForFixture(prediction.home_team, prediction.away_team, prediction.match_date, prediction.api_fixture_id);
  if (!live) return { found: false, reason: 'API-Football returned no odds for this fixture' };
  const selected = findTipOdds(live.raw, prediction.tip, prediction.home_team, prediction.away_team);
  if (!selected) return { found: false, reason: `API-Football does not currently offer odds for ${prediction.tip}` };
  await pool.query('UPDATE predictions SET odds=?, bookies_available=? WHERE id=?', [selected.odds, JSON.stringify(live.bookmakers), prediction.id]);
  return { found: true, odds: selected.odds, bookmaker: selected.bookmaker, bookmakers: live.bookmakers };
}

async function syncOddsForTodayFixtures() {
  const [predictions] = await pool.query(
    `SELECT id FROM predictions WHERE DATE(match_date)=CURDATE() AND result='pending' AND api_fixture_id IS NOT NULL ORDER BY match_date`
  );
  let updated = 0;
  for (const prediction of predictions) {
    try {
      const result = await autofillPredictionOdds(prediction.id);
      if (result.found) updated++;
    } catch (error) {
      console.error(`[API-Football Odds] Prediction ${prediction.id}:`, error.message);
    }
  }
  return updated;
}

module.exports = { getLiveOddsForFixture, findTipOdds, autofillPredictionOdds, syncOddsForTodayFixtures };
