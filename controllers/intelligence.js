const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');
const { runForAllToday, getPatternInsights, getLearningPerformance, runDailySpecials } = require('../services/intelligence');
const { autoPredictFixtures } = require('../services/apiFootball');
const { runBacktest, getBacktestSummary } = require('../services/backtest');
const { refreshLeagueReliability } = require('../services/statistics');

exports.getStatus = asyncHandler(async (req, res) => {
  const [lastRun] = await pool.query("SELECT setting_value FROM site_settings WHERE setting_key='last_intelligence_run'");
  const [lastSync] = await pool.query(
    `SELECT MAX(CAST(setting_value AS DATETIME)) AS last_sync FROM site_settings
     WHERE setting_key IN ('last_sync_action','last_sync_fixtures','last_sync_results','last_intelligence_run')`
  );
  const [queueCount] = await pool.query("SELECT COUNT(*) as cnt FROM predictions WHERE source='intelligence' AND published_at IS NULL");
  const [todayGenerated] = await pool.query("SELECT COUNT(*) as cnt FROM predictions WHERE source='intelligence' AND DATE(created_at)=CURDATE()");
  const [autoPublished] = await pool.query("SELECT COUNT(*) as cnt FROM predictions WHERE source='intelligence' AND DATE(published_at)=CURDATE()");
  return successResponse(res, {
    lastRun: lastRun[0]?.setting_value || null,
    lastSync: lastSync[0]?.last_sync || lastRun[0]?.setting_value || null,
    queueCount: queueCount[0].cnt,
    todayGenerated: todayGenerated[0].cnt,
    autoPublished: autoPublished[0].cnt,
  });
});

exports.getWeights = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM intelligence_weights ORDER BY weight_key');
  return successResponse(res, { weights: rows });
});

exports.updateWeights = asyncHandler(async (req, res) => {
  const { weights } = req.body;
  if (!Array.isArray(weights)) return errorResponse(res, 'weights must be an array', 400);
  for (const { weight_key, weight_value } of weights) {
    await pool.query(
      'UPDATE intelligence_weights SET weight_value=? WHERE weight_key=?',
      [weight_value, weight_key]
    );
  }
  return successResponse(res, null, 'Weights updated');
});

exports.getQueue = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT p.*, l.name as league_name FROM predictions p
     LEFT JOIN leagues l ON l.id = p.league_id
     WHERE p.source = 'intelligence' AND p.published_at IS NULL
     ORDER BY p.intelligence_score DESC LIMIT 100`
  );
  return successResponse(res, { queue: rows });
});

exports.approveQueue = asyncHandler(async (req, res) => {
  await pool.query("UPDATE predictions SET published_at=NOW() WHERE id=? AND source='intelligence'", [req.params.id]);
  return successResponse(res, null, 'Prediction approved and published');
});

exports.rejectQueue = asyncHandler(async (req, res) => {
  await pool.query("DELETE FROM predictions WHERE id=? AND source='intelligence' AND published_at IS NULL", [req.params.id]);
  return successResponse(res, null, 'Prediction rejected');
});

exports.getPatterns = asyncHandler(async (req, res) => {
  const patterns = await getPatternInsights();
  return successResponse(res, patterns);
});

exports.getPerformance = asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30;
  const data = await getLearningPerformance(days);
  return successResponse(res, { data });
});

exports.runEngine = asyncHandler(async (req, res) => {
  // Populate goal averages + form from team_statistics / API before running the model
  await autoPredictFixtures().catch(e => console.error('[Intelligence] autoPredictFixtures:', e.message));
  const result = await runForAllToday();
  return successResponse(res, result, `Intelligence Engine complete: ${result.generated} generated, ${result.autoPublished} auto-published`);
});

exports.runSpecials = asyncHandler(async (req, res) => {
  const result = await runDailySpecials();
  return successResponse(res, result,
    `Daily Specials: Banker=${result.banker}, 2-Odds Picks=${result.specials}, Mega Acca=${result.acca}`
  );
});

exports.runBacktest = asyncHandler(async (req, res) => {
  const { league_ids, seasons, limit = 300 } = req.body;
  // Run async — can take several minutes; respond immediately then process in background
  res.json({ success: true, message: `Backtest started — processing up to ${limit} fixtures. Check /backtest/summary when done.` });
  runBacktest({
    leagueIds: league_ids || null,
    seasons: seasons || null,
    limit: parseInt(limit),
    onProgress: ({ totalProcessed, league, season }) => {
      if (totalProcessed % 50 === 0) console.log(`[Backtest] ${totalProcessed} processed — current: ${league} ${season}`);
    },
  }).then(r => {
    refreshLeagueReliability().catch(() => {});
    console.log(`[Backtest] Complete — ${r.totalProcessed} fixtures, ${r.overallWinRate}% accuracy`);
  }).catch(e => console.error('[Backtest] Error:', e.message));
});

exports.getBacktestSummary = asyncHandler(async (req, res) => {
  const summary = await getBacktestSummary();
  return successResponse(res, summary);
});
