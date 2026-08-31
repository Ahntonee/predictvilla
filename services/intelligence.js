const { pool } = require('../config/db');
const { calculateConfidence, getWeight, poissonPMF } = require('./confidence');
const { clamp } = require('../utils/helpers');
const { getLiveOddsForFixture } = require('./oddsApi');

function factorial(n) {
  if (n <= 1) return 1;
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return r;
}

function pmf(lambda, k) {
  return Math.exp(-lambda) * Math.pow(lambda, k) / factorial(k);
}

function buildScoreMatrix(lh, la, maxK = 6) {
  const matrix = [];
  for (let h = 0; h <= maxK; h++) {
    matrix[h] = [];
    for (let a = 0; a <= maxK; a++) {
      matrix[h][a] = pmf(lh, h) * pmf(la, a);
    }
  }
  return matrix;
}

function scoreMatrixProbs(matrix, maxK = 6) {
  let homeWin = 0, draw = 0, awayWin = 0, bttsYes = 0, total = 0;
  const goalProbs = {};
  for (let h = 0; h <= maxK; h++) {
    for (let a = 0; a <= maxK; a++) {
      const p = matrix[h][a];
      total += p;
      if (h > a) homeWin += p;
      else if (h === a) draw += p;
      else awayWin += p;
      if (h >= 1 && a >= 1) bttsYes += p;
      const n = h + a;
      goalProbs[n] = (goalProbs[n] || 0) + p;
    }
  }
  const over15 = 1 - (goalProbs[0] || 0) - (goalProbs[1] || 0);
  const over25 = over15 - (goalProbs[2] || 0);
  const over35 = over25 - (goalProbs[3] || 0);
  return {
    homeWin: homeWin / total,
    draw:    draw    / total,
    awayWin: awayWin / total,
    bttsYes: bttsYes / total,
    bttsNo:  1 - bttsYes / total,
    over15, over25, over35,
    under15: 1 - over15,
    under25: 1 - over25,
    under35: 1 - over35,
  };
}

function impliedProb(odds) {
  return odds && parseFloat(odds) > 1 ? 1 / parseFloat(odds) : null;
}

// Returns the most probable non-draw exact score from the matrix with probability >= minProb.
function bestCorrectScore(matrix, minProb = 0.09) {
  let best = { h: 0, a: 0, prob: 0 };
  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      if (matrix[h][a] > best.prob) best = { h, a, prob: matrix[h][a] };
    }
  }
  return best.prob >= minProb ? best : null;
}

/**
 * Select the single best market/tip for a fixture.
 * @param {object} probs       — output of scoreMatrixProbs
 * @param {object|null} bookOdds — live bookie odds (may be null)
 * @param {number[][]} matrix   — Poisson score matrix
 * @param {object} cornerData  — { homeCornerAvg, awayCornerAvg } from team_statistics (may be null)
 */
function selectBestMarket(probs, bookOdds, matrix, cornerData) {
  const dnbTotal = (probs.homeWin + probs.awayWin) || 1;

  const candidates = [
    // ── 1X2 ──────────────────────────────────────────────────────────────────
    { tip: 'Home Win',          market: '1X2',          category: 'home_win', prob: probs.homeWin,  odds: bookOdds?.homeOdds },
    { tip: 'Away Win',          market: '1X2',          category: 'away_win', prob: probs.awayWin,  odds: bookOdds?.awayOdds },
    { tip: 'Draw',              market: '1X2',          category: 'draw',     prob: probs.draw,     odds: bookOdds?.drawOdds },
    // ── Over / Under ─────────────────────────────────────────────────────────
    { tip: 'Over 1.5 Goals',    market: 'Over/Under',   category: 'over_1_5',  prob: probs.over15 },
    { tip: 'Over 2.5 Goals',    market: 'Over/Under',   category: 'over_2_5',  prob: probs.over25, odds: bookOdds?.over25Odds },
    { tip: 'Over 3.5 Goals',    market: 'Over/Under',   category: 'over_3_5',  prob: probs.over35 },
    { tip: 'Under 1.5 Goals',   market: 'Over/Under',   category: 'under_1_5', prob: probs.under15 },
    { tip: 'Under 2.5 Goals',   market: 'Over/Under',   category: 'under_2_5', prob: probs.under25, odds: bookOdds?.under25Odds },
    { tip: 'Under 3.5 Goals',   market: 'Over/Under',   category: 'under_3_5', prob: probs.under35 },
    // ── BTTS ─────────────────────────────────────────────────────────────────
    { tip: 'BTTS Yes',          market: 'BTTS',         category: 'gg',        prob: probs.bttsYes },
    { tip: 'BTTS No',           market: 'BTTS',         category: 'ng',        prob: probs.bttsNo },
    // ── Double Chance ────────────────────────────────────────────────────────
    { tip: 'Double Chance 1X',  market: 'Double Chance', category: 'dc_1x',   prob: probs.homeWin + probs.draw },
    { tip: 'Double Chance X2',  market: 'Double Chance', category: 'dc_x2',   prob: probs.draw   + probs.awayWin },
    { tip: 'Double Chance 12',  market: 'Double Chance', category: 'dc_12',   prob: probs.homeWin + probs.awayWin },
    // ── Draw No Bet ──────────────────────────────────────────────────────────
    { tip: 'Draw No Bet Home',  market: 'Draw No Bet',   category: 'dnb_home', prob: probs.homeWin / dnbTotal },
    { tip: 'Draw No Bet Away',  market: 'Draw No Bet',   category: 'dnb_away', prob: probs.awayWin / dnbTotal },
  ];

  // ── Correct Score (only if a single scoreline probability ≥ 9%) ──────────
  if (matrix) {
    const cs = bestCorrectScore(matrix, 0.09);
    if (cs) {
      candidates.push({
        tip: `Score ${cs.h}-${cs.a}`,
        market: 'Correct Score',
        category: 'correct_score',
        prob: cs.prob,
      });
    }
  }

  // ── Corners (only when we have historical corner averages) ────────────────
  if (cornerData?.homeCornerAvg && cornerData?.awayCornerAvg) {
    const exp = parseFloat(cornerData.homeCornerAvg) + parseFloat(cornerData.awayCornerAvg);
    if (exp > 10.0) {
      candidates.push({ tip: 'Over 9.5 Corners',  market: 'Corners', category: 'corners_over_9_5',  prob: 0.65 });
    }
    if (exp > 12.0) {
      candidates.push({ tip: 'Over 10.5 Corners', market: 'Corners', category: 'corners_over_10_5', prob: 0.57 });
    }
    if (exp < 8.5) {
      candidates.push({ tip: 'Under 9.5 Corners', market: 'Corners', category: 'corners_under_9_5', prob: 0.62 });
    }
  }

  // ── Selection: highest probability with meaningful edge ──────────────────
  // DC candidates naturally have higher prob — penalise slightly so they don't
  // always win when the underlying 1X2 signal is equally strong.
  const dcPenalty = { 'Double Chance': 0.05, 'Draw No Bet': 0.02 };

  let best = null;
  for (const c of candidates) {
    const effectiveProb = c.prob - (dcPenalty[c.market] || 0);
    if (effectiveProb < 0.52) continue;
    const implied   = c.odds ? impliedProb(c.odds) : null;
    const hasValue  = implied ? (effectiveProb - implied > 0.05) : (effectiveProb > 0.60);
    if (!hasValue) continue;
    if (!best || effectiveProb > (best.prob - (dcPenalty[best.market] || 0))) best = c;
  }

  // Fallback: just pick highest raw probability
  return best || candidates.slice().sort((a, b) => b.prob - a.prob)[0];
}

function generateAnalysis({ homeTeam, awayTeam, homeForm, awayForm, probs, selected, confidence, bookmakers, homeGoalsAvg, awayGoalsAvg }) {
  const bookStr = bookmakers?.length ? `Live odds available on ${bookmakers.slice(0, 3).join(', ')}.` : '';
  const marketNote = {
    'Double Chance': `Double Chance covers two outcomes — lower odds but higher security.`,
    'Draw No Bet':   `Draw No Bet removes draw risk; stake returned if the match ends level.`,
    'Correct Score': `Correct Score prediction carries higher variance but significant value.`,
    'Corners':       `Corners market based on combined corner averages for both teams.`,
  }[selected.market] || '';
  return [
    `${homeTeam} are in ${homeForm?.includes('W') ? 'good' : 'mixed'} form (${homeForm || 'N/A'}).`,
    `${awayTeam} form: ${awayForm || 'N/A'}. Expected goals — home: ${parseFloat(homeGoalsAvg || 1.3).toFixed(2)}, away: ${parseFloat(awayGoalsAvg || 1.1).toFixed(2)}.`,
    `Poisson model: Home ${(probs.homeWin * 100).toFixed(0)}% / Draw ${(probs.draw * 100).toFixed(0)}% / Away ${(probs.awayWin * 100).toFixed(0)}%.`,
    `Over 2.5: ${(probs.over25 * 100).toFixed(0)}%. BTTS: ${(probs.bttsYes * 100).toFixed(0)}%.`,
    marketNote,
    `Selected: ${selected.tip}. Confidence: ${confidence}/100. ${bookStr}`,
  ].filter(Boolean).join(' ');
}

async function runForFixture(fixtureData) {
  const { id, homeTeam, awayTeam, matchDate, homeForm, awayForm, homeCornerAvg, awayCornerAvg, leagueId, dbLeagueId } = fixtureData;

  // Destructuring defaults only apply to `undefined`, not `null`. MySQL NULLs
  // arrive as null, which coerces to 0 in multiplication and breaks the Poisson
  // model (lh=0, la=0 → 100% draw). Use explicit fallbacks instead.
  const homeGoalsAvg           = parseFloat(fixtureData.homeGoalsAvg)           || 1.3;
  const awayGoalsAvg           = parseFloat(fixtureData.awayGoalsAvg)           || 1.1;
  const homeGoalsConcededAvg   = parseFloat(fixtureData.homeGoalsConcededAvg)   || 1.2;
  const awayGoalsConcededAvg   = parseFloat(fixtureData.awayGoalsConcededAvg)   || 1.3;

  const homeAdv = await getWeight('home_advantage') || 1.15;
  const lh = homeGoalsAvg * awayGoalsConcededAvg * homeAdv;
  const la = awayGoalsAvg * homeGoalsConcededAvg;

  const matrix = buildScoreMatrix(lh, la);
  const probs  = scoreMatrixProbs(matrix);

  const bookOdds  = await getLiveOddsForFixture(homeTeam, awayTeam, matchDate).catch(() => null);
  const bookmakers = bookOdds?.bookmakers || [];

  const selected = selectBestMarket(
    probs, bookOdds, matrix,
    { homeCornerAvg, awayCornerAvg }
  );

  const confidence = await calculateConfidence({
    market:  selected.market,
    category: selected.category,
    tip:     selected.tip,
    homeForm, awayForm,
    homeGoalsAvg, awayGoalsAvg,
    homeGoalsConcededAvg, awayGoalsConcededAvg,
    odds:    selected.odds,
    leagueId: dbLeagueId,
  });

  const minConf = parseInt(process.env.INTELLIGENCE_MIN_CONFIDENCE) || 60;
  console.log(`[Intelligence] ${homeTeam} vs ${awayTeam} → ${selected.tip} (${selected.market}) conf=${confidence} min=${minConf} lh=${lh.toFixed(2)} la=${la.toFixed(2)}`);
  if (confidence < minConf) return null;

  const analysis = generateAnalysis({
    homeTeam, awayTeam, homeForm, awayForm,
    probs, selected, confidence, bookmakers,
    homeGoalsAvg, awayGoalsAvg,
  });

  const autoThreshold = parseInt(process.env.INTELLIGENCE_AUTO_PUBLISH_THRESHOLD) || 78;
  const publishedAt   = confidence >= autoThreshold ? new Date() : null;

  return {
    id,
    tip:              selected.tip,
    market:           selected.market,
    category:         selected.category,
    odds:             selected.odds ?? null,
    confidence_score: confidence,
    intelligence_score: confidence,
    analysis,
    source:           'intelligence',
    bookies_available: bookmakers.length ? JSON.stringify(bookmakers) : null,
    published_at:     publishedAt,
    is_vip:           confidence >= 85 ? 1 : 0,
    homeGoalsAvg, awayGoalsAvg,
  };
}

async function runForAllToday() {
  const [fixtures] = await pool.query(
    `SELECT
       p.id,
       p.home_team           AS homeTeam,
       p.away_team           AS awayTeam,
       p.match_date          AS matchDate,
       p.home_form           AS homeForm,
       p.away_form           AS awayForm,
       p.home_goals_avg      AS homeGoalsAvg,
       p.away_goals_avg      AS awayGoalsAvg,
       p.home_goals_conceded_avg AS homeGoalsConcededAvg,
       p.away_goals_conceded_avg AS awayGoalsConcededAvg,
       p.league_id           AS dbLeagueId,
       l.api_league_id       AS leagueId,
       tsh.home_corners_avg  AS homeCornerAvg,
       tsa.away_corners_avg  AS awayCornerAvg
     FROM predictions p
     LEFT JOIN leagues l ON l.id = p.league_id
     LEFT JOIN team_statistics tsh
       ON tsh.team_name = p.home_team AND tsh.league_id = p.league_id
     LEFT JOIN team_statistics tsa
       ON tsa.team_name = p.away_team AND tsa.league_id = p.league_id
     WHERE DATE(p.match_date) IN (CURDATE(), CURDATE()+1)
       AND p.result = 'pending'
       AND p.published_at IS NULL
       AND p.source IN ('auto_sync', 'intelligence')
     LIMIT 100`
  );

  console.log(`[Intelligence] Found ${fixtures.length} fixtures to process`);
  let generated = 0, autoPublished = 0;
  for (const fx of fixtures) {
    try {
      const result = await runForFixture(fx);
      if (!result) {
        console.log(`[Intelligence] Skipped fixture ${fx.id} (${fx.homeTeam} vs ${fx.awayTeam}) — below confidence threshold or no data`);
        continue;
      }

      await pool.query(
        `UPDATE predictions
         SET tip=?, market=?, category=?, odds=?, confidence_score=?, intelligence_score=?,
             analysis=?, source='intelligence', bookies_available=?, published_at=?, is_vip=?,
             home_goals_avg=?, away_goals_avg=?
         WHERE id=?`,
        [result.tip, result.market, result.category, result.odds ?? null,
         result.confidence_score, result.intelligence_score,
         result.analysis, result.bookies_available, result.published_at, result.is_vip,
         result.homeGoalsAvg, result.awayGoalsAvg, result.id]
      );
      generated++;
      if (result.published_at) autoPublished++;
    } catch (err) {
      console.error(`[Intelligence] runForAllToday fixture ${fx.id}:`, err.message);
    }
  }

  await pool.query(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES ('last_intelligence_run', NOW())
     ON DUPLICATE KEY UPDATE setting_value = NOW()`
  );
  console.log(`[Intelligence] Generated ${generated}, auto-published ${autoPublished}`);
  return { generated, autoPublished };
}

async function getPatternInsights() {
  const [bestMarket] = await pool.query(
    `SELECT market, category, total_predictions, correct_predictions, win_rate
     FROM prediction_market_stats WHERE win_rate IS NOT NULL ORDER BY win_rate DESC LIMIT 1`
  );
  const [bestLeague] = await pool.query(
    `SELECT pms.league_id, l.name, pms.win_rate
     FROM prediction_market_stats pms JOIN leagues l ON l.id = pms.league_id
     WHERE pms.win_rate IS NOT NULL AND pms.league_id IS NOT NULL
     ORDER BY pms.win_rate DESC LIMIT 1`
  );
  const [bestTeam] = await pool.query(
    `SELECT team_name, market, win_rate FROM prediction_market_stats
     WHERE team_name IS NOT NULL AND win_rate IS NOT NULL ORDER BY win_rate DESC LIMIT 1`
  );
  return {
    bestMarket: bestMarket[0] || null,
    bestLeague: bestLeague[0] || null,
    bestTeam:   bestTeam[0]   || null,
  };
}

async function getLearningPerformance(days = 30) {
  const [rows] = await pool.query(
    `SELECT DATE(recorded_at) as date, market,
            COUNT(*) as total, SUM(is_correct) as correct
     FROM intelligence_outcomes
     WHERE recorded_at >= DATE_SUB(CURDATE(), INTERVAL ? DAY)
       AND is_correct IS NOT NULL
     GROUP BY DATE(recorded_at), market
     ORDER BY date`,
    [days]
  );
  return rows;
}

// ── Daily Specials Engine ─────────────────────────────────────────────────────
async function runDailySpecials() {
  const [candidates] = await pool.query(`
    SELECT
      p.id, p.home_team, p.away_team, p.match_date, p.tip, p.market,
      p.category, p.odds, p.confidence_score, p.league_id,
      COALESCE(pms.win_rate, 0)          AS hist_win_rate,
      COALESCE(pms.total_predictions, 0) AS hist_samples,
      (
        p.confidence_score
          * (0.55 - 0.15 * LEAST(COALESCE(pms.total_predictions, 0), 30) / 30)
        + COALESCE(pms.win_rate, p.confidence_score)
          * (0.30 + 0.15 * LEAST(COALESCE(pms.total_predictions, 0), 30) / 30)
        + LEAST(COALESCE(pms.total_predictions, 0), 30) / 30 * 10
      ) AS composite_score
    FROM predictions p
    LEFT JOIN prediction_market_stats pms
      ON pms.market    = p.market
     AND pms.category  = p.category
     AND pms.league_id = p.league_id
    WHERE DATE(p.match_date) = CURDATE()
      AND p.source            = 'intelligence'
      AND p.tip IS NOT NULL AND p.tip != 'TBD'
      AND p.confidence_score IS NOT NULL
      AND p.published_at IS NOT NULL
      AND (p.result = 'pending' OR p.result IS NULL)
      AND p.odds IS NOT NULL AND p.odds > 1
      AND p.market NOT IN ('Correct Score', 'Corners')
    ORDER BY composite_score DESC
    LIMIT 200
  `);

  if (!candidates.length) {
    console.log('[DailySpecials] No qualifying intelligence predictions for today');
    return { banker: 0, specials: 0, acca: 0 };
  }

  await pool.query(
    `UPDATE predictions SET is_banker = 0
     WHERE DATE(match_date) = CURDATE() AND source = 'intelligence'`
  );
  await pool.query(
    `UPDATE predictions SET category = 'Free'
     WHERE DATE(match_date) = CURDATE() AND source = 'intelligence'
       AND category IN ('Banker', 'Daily Special')`
  );
  await pool.query(
    `DELETE FROM predictions WHERE DATE(match_date) = CURDATE() AND source = 'daily_special'`
  );

  let bankerCount = 0, specialsCount = 0, accaCount = 0;
  const usedMatchKeys = new Set();

  // ── BANKER ────────────────────────────────────────────────────────────────
  const banker = candidates.find(c =>
    c.confidence_score >= 85 &&
    (c.hist_samples < 5 || c.hist_win_rate >= 68)
  );
  if (banker) {
    await pool.query(
      `UPDATE predictions SET is_banker=1, category='Banker', is_vip=0 WHERE id=?`,
      [banker.id]
    );
    usedMatchKeys.add(`${banker.home_team}|${banker.away_team}`);
    bankerCount = 1;
    console.log(`[DailySpecials] Banker → ${banker.home_team} vs ${banker.away_team}: ${banker.tip} (conf:${banker.confidence_score})`);
  }

  // ── 2-ODDS DAILY SPECIALS ─────────────────────────────────────────────────
  for (const c of candidates) {
    if (specialsCount >= 3) break;
    if (c.id === banker?.id) continue;
    if (usedMatchKeys.has(`${c.home_team}|${c.away_team}`)) continue;
    const odds = parseFloat(c.odds);
    if (isNaN(odds) || odds < 1.80 || odds > 2.20) continue;
    if (c.confidence_score < 82) continue;
    if (c.hist_samples >= 5 && c.hist_win_rate < 65) continue;
    await pool.query(`UPDATE predictions SET category='Daily Special' WHERE id=?`, [c.id]);
    usedMatchKeys.add(`${c.home_team}|${c.away_team}`);
    specialsCount++;
    console.log(`[DailySpecials] 2-Odds #${specialsCount} → ${c.home_team} vs ${c.away_team}: ${c.tip} @ ${odds}`);
  }

  // ── MEGA ACCUMULATOR ──────────────────────────────────────────────────────
  const accaCandidates = candidates.filter(c => {
    if (usedMatchKeys.has(`${c.home_team}|${c.away_team}`)) return false;
    const odds = parseFloat(c.odds);
    return !isNaN(odds) && odds >= 1.70 && odds <= 2.50 &&
           c.confidence_score >= 78 &&
           (c.hist_samples < 5 || c.hist_win_rate >= 62);
  });

  const accaPicks = [];
  const accaMatchKeys = new Set(usedMatchKeys);
  let combinedOdds = 1.0;

  for (const c of accaCandidates) {
    if (accaPicks.length >= 12) break;
    if (combinedOdds >= 580) break;
    const matchKey = `${c.home_team}|${c.away_team}`;
    if (accaMatchKeys.has(matchKey)) continue;
    const cOdds = parseFloat(c.odds);
    if (combinedOdds * cOdds > 870 && accaPicks.length >= 6) continue;
    accaPicks.push(c);
    combinedOdds *= cOdds;
    accaMatchKeys.add(matchKey);
  }

  if (accaPicks.length >= 6 && combinedOdds >= 280) {
    const avgConf  = Math.round(accaPicks.reduce((s, c) => s + c.confidence_score, 0) / accaPicks.length);
    const avgHist  = (accaPicks.reduce((s, c) => s + c.hist_win_rate, 0) / accaPicks.length).toFixed(1);
    const leagueCt = new Set(accaPicks.map(c => c.league_id)).size;
    const totalSamples = accaPicks.reduce((s, c) => s + c.hist_samples, 0);
    const pickLines = accaPicks.map((c, i) =>
      `${i + 1}. ${c.home_team} vs ${c.away_team} — ${c.tip} @ ${parseFloat(c.odds).toFixed(2)}`
    );
    const analysis = [
      `${accaPicks.length}-FOLD MEGA ACCUMULATOR`,
      `Combined Odds: ${combinedOdds.toFixed(0)}x | Avg Confidence: ${avgConf}/100 | Avg Historical Win Rate: ${avgHist}%`,
      `Covers ${leagueCt} league${leagueCt !== 1 ? 's' : ''}`,
      '', 'SELECTIONS:', ...pickLines, '',
      'Each pick independently validated by the Predictvilla Intelligence Engine:',
      '• Poisson goal model (home/away scoring averages, venue advantage)',
      '• Recent form analysis (last 5 matches, home/away weighted)',
      `• ${totalSamples} logged historical outcomes informing win-rate estimates`,
      '• Live odds value check (model probability vs implied probability gap)',
    ].join('\n');

    const dateStr   = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const slug      = `mega-acca-${dateStr}-${accaPicks.length}fold`;
    const latestDate = accaPicks.reduce(
      (max, c) => new Date(c.match_date) > new Date(max) ? c.match_date : max,
      accaPicks[0].match_date
    );

    await pool.query(
      `INSERT INTO predictions
         (home_team, away_team, match_date, tip, market, category, odds, result,
          confidence_score, intelligence_score, analysis, source, published_at, is_vip, league_id, slug)
       VALUES (?,?,?,?,'Accumulator','Accumulator',?,'pending',?,?,?,'daily_special',NOW(),1,?,?)`,
      [
        `${accaPicks.length}-Fold Mega Acca`,
        `${combinedOdds.toFixed(0)}x Combined Odds`,
        latestDate, `${accaPicks.length}-Fold Accumulator`,
        parseFloat(combinedOdds.toFixed(2)),
        avgConf, avgConf, analysis, accaPicks[0].league_id, slug,
      ]
    );
    accaCount = 1;
    console.log(`[DailySpecials] Mega Acca → ${accaPicks.length} picks, combined: ${combinedOdds.toFixed(0)}x`);
  } else {
    const reason = accaPicks.length < 6
      ? `only ${accaPicks.length}/6 qualifying picks`
      : `combined odds ${combinedOdds.toFixed(1)} below minimum 280`;
    console.log(`[DailySpecials] Mega Acca skipped: ${reason}`);
  }

  await pool.query(
    `INSERT INTO site_settings (setting_key, setting_value) VALUES ('last_daily_specials_run', NOW())
     ON DUPLICATE KEY UPDATE setting_value = NOW()`
  );
  console.log(`[DailySpecials] Done — Banker: ${bankerCount}, 2-Odds: ${specialsCount}, Mega Acca: ${accaCount}`);
  return { banker: bankerCount, specials: specialsCount, acca: accaCount };
}

/**
 * Pure computation: given team stats, return full Poisson probability breakdown
 * for every market we support. Used by the /predictions/:id/probabilities endpoint.
 */
async function computeAllProbabilities({
  homeGoalsAvg = 1.3, awayGoalsAvg = 1.1,
  homeGoalsConcededAvg = 1.2, awayGoalsConcededAvg = 1.3,
  homeCornerAvg, awayCornerAvg,
} = {}) {
  const homeAdv = await getWeight('home_advantage') || 1.15;
  const lh = homeGoalsAvg * awayGoalsConcededAvg * homeAdv;
  const la = awayGoalsAvg * homeGoalsConcededAvg;

  const matrix = buildScoreMatrix(lh, la);
  const p      = scoreMatrixProbs(matrix);

  const dnbTotal = (p.homeWin + p.awayWin) || 1;

  // Top 8 most likely exact scorelines
  const scorelines = [];
  for (let h = 0; h <= 6; h++) {
    for (let a = 0; a <= 6; a++) {
      scorelines.push({ score: `${h}-${a}`, prob: matrix[h][a], pct: Math.round(matrix[h][a] * 100) });
    }
  }
  scorelines.sort((a, b) => b.prob - a.prob);

  return {
    lambdas: { home: +lh.toFixed(2), away: +la.toFixed(2) },
    markets: {
      '1X2': [
        { label: 'Home Win',    prob: p.homeWin,  pct: Math.round(p.homeWin  * 100) },
        { label: 'Draw',        prob: p.draw,     pct: Math.round(p.draw     * 100) },
        { label: 'Away Win',    prob: p.awayWin,  pct: Math.round(p.awayWin  * 100) },
      ],
      'Over/Under': [
        { label: 'Over 1.5',    prob: p.over15,  pct: Math.round(p.over15  * 100) },
        { label: 'Over 2.5',    prob: p.over25,  pct: Math.round(p.over25  * 100) },
        { label: 'Over 3.5',    prob: p.over35,  pct: Math.round(p.over35  * 100) },
        { label: 'Under 1.5',   prob: p.under15, pct: Math.round(p.under15 * 100) },
        { label: 'Under 2.5',   prob: p.under25, pct: Math.round(p.under25 * 100) },
        { label: 'Under 3.5',   prob: p.under35, pct: Math.round(p.under35 * 100) },
      ],
      'BTTS': [
        { label: 'BTTS Yes',    prob: p.bttsYes, pct: Math.round(p.bttsYes * 100) },
        { label: 'BTTS No',     prob: p.bttsNo,  pct: Math.round(p.bttsNo  * 100) },
      ],
      'Double Chance': [
        { label: '1X (Home or Draw)', prob: p.homeWin + p.draw,  pct: Math.round((p.homeWin + p.draw)  * 100) },
        { label: 'X2 (Draw or Away)', prob: p.draw   + p.awayWin, pct: Math.round((p.draw  + p.awayWin) * 100) },
        { label: '12 (Home or Away)', prob: p.homeWin + p.awayWin, pct: Math.round((p.homeWin + p.awayWin) * 100) },
      ],
      'Draw No Bet': [
        { label: 'Home DNB', prob: p.homeWin / dnbTotal, pct: Math.round(p.homeWin / dnbTotal * 100) },
        { label: 'Away DNB', prob: p.awayWin / dnbTotal, pct: Math.round(p.awayWin / dnbTotal * 100) },
      ],
    },
    topScorelines: scorelines.slice(0, 8),
    ...(homeCornerAvg && awayCornerAvg
      ? { expectedCorners: +(parseFloat(homeCornerAvg) + parseFloat(awayCornerAvg)).toFixed(1) }
      : {}),
  };
}

module.exports = {
  runForFixture, runForAllToday, getPatternInsights,
  getLearningPerformance, runDailySpecials, computeAllProbabilities,
};
