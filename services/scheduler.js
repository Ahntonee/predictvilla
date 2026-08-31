const cron = require('node-cron');
const { syncFixtures, syncResults, syncLiveScores, autoPredictFixtures } = require('./apiFootball');
const apiQuota = require('./apiQuota');
const { syncOddsForTodayFixtures } = require('./oddsApi');
const { runForAllToday, runDailySpecials } = require('./intelligence');
const { settleBets } = require('./tokens');
const { logUntracked, recalculateStats, autoAdjustMarketWeights } = require('./accuracy');
const { refreshTeamStatistics, refreshLeagueStatistics, refreshMarketStats, refreshLeagueReliability } = require('./statistics');
const { pool } = require('../config/db');
const { sendExpiryReminderEmail } = require('../utils/email');

const isInstance0 = !process.env.pm_id || process.env.pm_id === '0';

async function checkSubscriptionExpiry() {
  const [expiringSoon] = await pool.query(
    `SELECT s.id, s.user_id, s.plan, s.expires_at, u.email, u.name
     FROM subscriptions s JOIN users u ON u.id = s.user_id
     WHERE s.status = 'active' AND s.expires_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 3 DAY)
       AND s.notified_expiry = 0`
  );
  for (const sub of expiringSoon) {
    try {
      await sendExpiryReminderEmail(sub);
      await pool.query('UPDATE subscriptions SET notified_expiry=1 WHERE id=?', [sub.id]);
    } catch (e) {
      console.error('[Scheduler] expiry notify error:', e.message);
    }
  }

  // Expire overdue subscriptions
  await pool.query(
    `UPDATE subscriptions SET status='expired' WHERE status='active' AND expires_at < NOW()`
  );
  // Downgrade expired VIP users
  await pool.query(
    `UPDATE users u SET u.role='user'
     WHERE u.role='vip' AND u.id NOT IN (
       SELECT DISTINCT user_id FROM subscriptions WHERE status='active' AND expires_at > NOW()
     )`
  );
}

async function gradeFinished() {
  const { gradeResult } = require('./accuracy');
  const [pending] = await pool.query(
    `SELECT * FROM predictions WHERE result='pending' AND home_score IS NOT NULL AND away_score IS NOT NULL`
  );
  let graded = 0;
  for (const p of pending) {
    const correct = gradeResult(p);
    if (correct === null) continue;
    const result = correct ? 'won' : 'lost';
    await pool.query('UPDATE predictions SET result=? WHERE id=?', [result, p.id]);
    try { await settleBets(p.id, result); } catch (e) {
      console.error(`[Scheduler] settleBets error for prediction ${p.id}:`, e.message);
    }
    graded++;
  }
  console.log(`[Scheduler] Graded ${graded} predictions, settled token bets`);
}

function startScheduler() {
  if (!isInstance0) {
    console.log(`[Scheduler] Skipping on PM2 instance ${process.env.pm_id}`);
    return;
  }
  console.log('[Scheduler] Starting cron jobs on instance 0');

  // ── Nightly wind-down (before midnight) ─────────────────────────────────────
  // 23:30 — pull final scores for yesterday's fixtures
  cron.schedule('30 23 * * *', async () => {
    try { await syncResults(); } catch (e) { console.error('[Scheduler] syncResults error:', e.message); }
  });

  // 23:45 — grade finished predictions + log outcomes for accuracy engine
  cron.schedule('45 23 * * *', async () => {
    try {
      await logUntracked();
      await recalculateStats();
    } catch (e) { console.error('[Scheduler] accuracy error:', e.message); }
  });

  // 23:50 — rebuild statistics tables from graded data
  cron.schedule('50 23 * * *', async () => {
    try {
      await refreshTeamStatistics();
      await refreshLeagueStatistics();
      await refreshMarketStats();
      await refreshLeagueReliability();
    } catch (e) { console.error('[Scheduler] stats refresh error:', e.message); }
  });

  // 23:55 — reset both API daily counters so midnight run starts with full quota
  cron.schedule('55 23 * * *', async () => {
    try {
      await pool.query(`UPDATE site_settings SET setting_value='0' WHERE setting_key='odds_api_calls_today'`);
      apiQuota.reset();
    } catch {}
  });

  // ── Midnight reset (00:00) ───────────────────────────────────────────────────
  const SYNC_SCHEDULE = process.env.SYNC_CRON_SCHEDULE || '0 0 * * *';
  cron.schedule(SYNC_SCHEDULE, async () => {
    console.log('[Scheduler] Midnight reset — syncing fixtures + running intelligence');
    try {
      await syncFixtures(0);   // today
      await syncFixtures(1);   // tomorrow
      await autoPredictFixtures();
      await runForAllToday();
      await runDailySpecials();
    } catch (e) { console.error('[Scheduler] midnight sync error:', e.message); }
  });

  // 00:10 — second intelligence pass (catches any fixtures missed at 00:00)
  cron.schedule('10 0 * * *', async () => {
    try {
      await runForAllToday();
      await runDailySpecials();
    } catch (e) { console.error('[Scheduler] re-score error:', e.message); }
  });

  cron.schedule('0 * * * *', async () => {
    try { await checkSubscriptionExpiry(); } catch (e) { console.error('[Scheduler] expiry check error:', e.message); }
  });

  cron.schedule('*/20 * * * *', async () => {
    try {
      await gradeFinished();
      // Immediately log new outcomes so the confidence engine learns in near-real-time
      await logUntracked();
    } catch (e) { console.error('[Scheduler] grade error:', e.message); }
  });

  // Weekly self-learning: adjust market coefficients based on accumulated win rates.
  // Runs Sunday 02:00 — after the nightly stats refresh has settled.
  cron.schedule('0 2 * * 0', async () => {
    try {
      await autoAdjustMarketWeights();
    } catch (e) { console.error('[Scheduler] market weight adjust error:', e.message); }
  });

  cron.schedule('*/30 * * * *', async () => {
    try { await syncOddsForTodayFixtures(); } catch (e) { console.error('[Scheduler] odds sync error:', e.message); }
  });

  // Live score polling every 2 minutes between 10:00 and 23:58 (covers all kick-off zones)
  cron.schedule('*/2 10-23 * * *', async () => {
    try { await syncLiveScores(); } catch (e) { console.error('[Scheduler] live scores error:', e.message); }
  });
}

module.exports = { startScheduler, checkSubscriptionExpiry, gradeFinished };
