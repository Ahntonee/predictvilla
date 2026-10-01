const { pool } = require('../config/db');

async function logUntracked() {
  // Log only real, published selections; imported TBD fixtures are data records, not predictions.
  const [resolved] = await pool.query(
    `SELECT p.* FROM predictions p
     LEFT JOIN prediction_accuracy_log pal ON pal.prediction_id = p.id
     WHERE p.result IN ('won','lost')
       AND pal.id IS NULL
       AND p.home_score IS NOT NULL
       AND p.away_score IS NOT NULL
       AND p.published_at IS NOT NULL
       AND p.tip IS NOT NULL
       AND TRIM(p.tip) != ''
       AND UPPER(TRIM(p.tip)) != 'TBD'
       AND p.confidence_score IS NOT NULL`
  );

  let logged = 0;
  for (const p of resolved) {
    const isCorrect = gradeResult(p);
    if (isCorrect === null) continue;

    await pool.query(
      `INSERT IGNORE INTO prediction_accuracy_log
         (prediction_id, market, category, league_id, home_team, away_team,
          tip, confidence_score, intelligence_score, is_correct, source)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [p.id, p.market, p.category, p.league_id, p.home_team, p.away_team,
       p.tip, p.confidence_score, p.intelligence_score, isCorrect ? 1 : 0, p.source]
    );

    if (p.source === 'intelligence') {
      await pool.query(
        `INSERT IGNORE INTO intelligence_outcomes
           (prediction_id, market, category, league_id, home_team, away_team, tip,
            confidence_score, home_goals_avg, away_goals_avg,
            home_goals_conceded_avg, away_goals_conceded_avg,
            actual_home_score, actual_away_score, is_correct)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [p.id, p.market, p.category, p.league_id, p.home_team, p.away_team, p.tip,
         p.confidence_score, p.home_goals_avg, p.away_goals_avg,
         p.home_goals_conceded_avg, p.away_goals_conceded_avg,
         p.home_score, p.away_score, isCorrect ? 1 : 0]
      );
    }
    logged++;
  }

  console.log(`[Accuracy] Logged ${logged} outcomes`);
  return logged;
}

function gradeResult(p) {
  // Grade supported prediction markets; unknown/import placeholder tips remain ungraded.
  const h   = p.home_score;
  const a   = p.away_score;
  if (h === null || a === null) return null;

  const total = h + a;
  const tip   = (p.tip || '').toLowerCase();
  const cat   = (p.category || '');

  // ── 1X2 ──────────────────────────────────────────────────────────────────
  if (tip.includes('home win')        || cat === 'home_win') return h > a;
  if (tip.includes('away win')        || cat === 'away_win') return a > h;
  if ((tip.includes('draw') && !tip.includes('no bet')) || cat === 'draw') return h === a;

  // ── Over / Under ─────────────────────────────────────────────────────────
  if (tip.includes('over 1.5')        || cat === 'over_1_5')  return total > 1;
  if (tip.includes('over 2.5')        || cat === 'over_2_5')  return total > 2;
  if (tip.includes('over 3.5')        || cat === 'over_3_5')  return total > 3;
  if (tip.includes('under 1.5')       || cat === 'under_1_5') return total < 2;
  if (tip.includes('under 2.5')       || cat === 'under_2_5') return total < 3;
  if (tip.includes('under 3.5')       || cat === 'under_3_5') return total < 4;

  // ── BTTS ─────────────────────────────────────────────────────────────────
  if (tip.includes('btts yes') || (tip.includes('btts') && !tip.includes('no')) || cat === 'gg') return h >= 1 && a >= 1;
  if (tip.includes('btts no')  || cat === 'ng') return h === 0 || a === 0;

  // ── Double Chance ─────────────────────────────────────────────────────────
  if (cat === 'dc_1x' || tip.includes('double chance 1x')) return h >= a;  // home win OR draw
  if (cat === 'dc_x2' || tip.includes('double chance x2')) return a >= h;  // draw OR away win
  if (cat === 'dc_12' || tip.includes('double chance 12')) return h !== a; // home OR away (not draw)

  // ── Draw No Bet ───────────────────────────────────────────────────────────
  // Draw = void/push — return null so it's excluded from win-rate calculations.
  if (cat === 'dnb_home' || tip.includes('draw no bet home')) {
    if (h === a) return null;
    return h > a;
  }
  if (cat === 'dnb_away' || tip.includes('draw no bet away')) {
    if (h === a) return null;
    return a > h;
  }

  // ── Correct Score ─────────────────────────────────────────────────────────
  if (cat === 'correct_score' || tip.startsWith('score ')) {
    const m = tip.match(/(\d+)-(\d+)/);
    if (!m) return null;
    return parseInt(m[1]) === h && parseInt(m[2]) === a;
  }

  // ── Corners ───────────────────────────────────────────────────────────────
  // Corner results need the actual corner counts which aren't in the predictions table.
  // Return null — they'll be graded separately when corner data is available.
  if (cat?.startsWith('corners_')) return null;

  // Unsupported tips (including imported TBD fixtures) are not predictions and must not be losses.
  return null;
}

async function recalculateStats() {
  // Rebuild headline and market statistics from published, valid selections only.
  const [rows] = await pool.query(
    `SELECT COUNT(*) as total, SUM(pal.is_correct) as correct
     FROM prediction_accuracy_log pal
     JOIN predictions p ON p.id = pal.prediction_id
     WHERE p.published_at IS NOT NULL
       AND p.confidence_score IS NOT NULL
       AND p.tip IS NOT NULL
       AND TRIM(p.tip) != ''
       AND UPPER(TRIM(p.tip)) != 'TBD'`
  );
  const { total, correct } = rows[0];
  const winRate = total > 0 ? ((correct || 0) / total * 100).toFixed(2) : 0;

  const stats = [
    ['total_predictions', total],
    ['total_won',         correct || 0],
    ['overall_win_rate',  winRate],
  ];

  const [vipRows] = await pool.query(
    `SELECT COUNT(*) as total, SUM(pal.is_correct) as correct
     FROM prediction_accuracy_log pal JOIN predictions p ON p.id = pal.prediction_id
     WHERE p.is_vip = 1
       AND p.published_at IS NOT NULL
       AND p.confidence_score IS NOT NULL
       AND p.tip IS NOT NULL
       AND TRIM(p.tip) != ''
       AND UPPER(TRIM(p.tip)) != 'TBD'`
  );
  const vipWinRate = vipRows[0].total > 0
    ? ((vipRows[0].correct || 0) / vipRows[0].total * 100).toFixed(2)
    : 0;
  stats.push(['vip_win_rate', vipWinRate]);

  for (const [key, val] of stats) {
    await pool.query(
      `INSERT INTO accuracy_stats (stat_key, stat_value) VALUES (?,?)
       ON DUPLICATE KEY UPDATE stat_value=?`,
      [key, val, val]
    );
  }

  // Per-market win rates
  const [marketRows] = await pool.query(
    `SELECT pal.market, pal.category, COUNT(*) as total, SUM(pal.is_correct) as correct,
            AVG(pal.confidence_score) as avg_conf
     FROM prediction_accuracy_log pal
     JOIN predictions p ON p.id = pal.prediction_id
     WHERE p.published_at IS NOT NULL
       AND p.confidence_score IS NOT NULL
       AND p.tip IS NOT NULL
       AND TRIM(p.tip) != ''
       AND UPPER(TRIM(p.tip)) != 'TBD'
     GROUP BY pal.market, pal.category`
  );
  for (const row of marketRows) {
    const wr = row.total > 0 ? (row.correct / row.total * 100).toFixed(2) : 0;
    await pool.query(
      `INSERT INTO prediction_market_stats
         (market, category, total_predictions, correct_predictions, win_rate, avg_confidence)
       VALUES (?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         total_predictions=VALUES(total_predictions),
         correct_predictions=VALUES(correct_predictions),
         win_rate=VALUES(win_rate),
         avg_confidence=VALUES(avg_confidence)`,
      [row.market, row.category, row.total, row.correct || 0, wr, row.avg_conf]
    );
  }

  console.log(`[Accuracy] Stats recalculated: ${total} total, ${winRate}% win rate`);
  return { total, winRate };
}

/**
 * Self-learning: reads historical win rates per market from prediction_market_stats
 * and writes adjusted market coefficients into intelligence_weights.
 *
 * Only adjusts when a market has ≥ 20 graded predictions.
 * Coefficient change is bounded to ±8% of the hardcoded baseline.
 */
async function autoAdjustMarketWeights() {
  const baselines = {
    '1X2':           1.00,
    'Over/Under':    0.95,
    'BTTS':          0.90,
    'Double Chance': 0.92,
    'Draw No Bet':   0.88,
    'Correct Score': 0.55,
    'Corners':       0.80,
  };

  const [marketStats] = await pool.query(
    `SELECT market,
            SUM(correct_predictions) AS correct,
            SUM(total_predictions)   AS total
     FROM prediction_market_stats
     WHERE total_predictions >= 20
     GROUP BY market`
  );

  if (!marketStats.length) return;

  // Overall average win rate across all qualifying markets (baseline reference)
  const allTotal   = marketStats.reduce((s, m) => s + Number(m.total), 0);
  const allCorrect = marketStats.reduce((s, m) => s + Number(m.correct), 0);
  const baseline   = allTotal > 0 ? allCorrect / allTotal : 0.65;

  for (const m of marketStats) {
    const winRate  = Number(m.correct) / Number(m.total);
    const base     = baselines[m.market];
    if (base === undefined) continue;

    // Scale coefficient proportionally to how this market performs vs baseline.
    // A market winning 10% more than average gets +5% on its coefficient.
    const relativePerf = winRate / (baseline || 0.65);
    const rawCoeff     = base * (0.88 + 0.12 * Math.min(relativePerf, 1.5));
    // Hard bounds: keep within ±8% of baseline, never outside [0.40, 1.10]
    const newCoeff = Math.min(Math.max(rawCoeff, base * 0.92, 0.40), base * 1.08, 1.10);

    const key = `market_coeff_${m.market.toLowerCase().replace(/[^a-z]/g, '_')}`;
    await pool.query(
      `INSERT INTO intelligence_weights (weight_key, weight_value, description)
       VALUES (?,?,?)
       ON DUPLICATE KEY UPDATE weight_value=?`,
      [key, newCoeff.toFixed(4),
       `Auto-adjusted market coefficient for ${m.market} (win rate: ${(winRate * 100).toFixed(1)}%, n=${m.total})`,
       newCoeff.toFixed(4)]
    );
    console.log(
      `[SelfLearn] ${m.market}: coeff ${base.toFixed(3)} → ${newCoeff.toFixed(3)} ` +
      `(win rate ${(winRate * 100).toFixed(1)}%, n=${m.total})`
    );
  }
}

module.exports = { logUntracked, recalculateStats, gradeResult, autoAdjustMarketWeights };
