const { pool } = require('../config/db');

const REWARDS = {
  SIGNUP:       100,
  VIP_UPGRADE:  500,
  DAILY_CHECKIN: 20,
  STREAK_7:      50,
  STREAK_30:    200,
  WIN_BOOKMARK:   5,
  BET_PAYOUT:  1.80, // multiplier on won bets
};

async function ensureBalance(userId) {
  await pool.query(
    `INSERT IGNORE INTO token_balances (user_id, balance, total_earned) VALUES (?, 0, 0)`,
    [userId]
  );
}

async function getBalance(userId) {
  await ensureBalance(userId);
  const [[row]] = await pool.query(
    `SELECT balance, total_earned FROM token_balances WHERE user_id = ?`,
    [userId]
  );
  return row;
}

async function awardTokens(userId, amount, reason, refId = null, refType = null) {
  if (amount <= 0) return;
  await ensureBalance(userId);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.query(
      `UPDATE token_balances SET balance = balance + ?, total_earned = total_earned + ? WHERE user_id = ?`,
      [amount, amount, userId]
    );
    await conn.query(
      `INSERT INTO token_transactions (user_id, amount, type, reason, reference_id, reference_type)
       VALUES (?, ?, 'credit', ?, ?, ?)`,
      [userId, amount, reason, refId, refType]
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function deductTokens(userId, amount, reason, refId = null, refType = null) {
  if (amount <= 0) return;
  await ensureBalance(userId);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [[bal]] = await conn.query(
      `SELECT balance FROM token_balances WHERE user_id = ? FOR UPDATE`, [userId]
    );
    if ((bal?.balance || 0) < amount) {
      await conn.rollback();
      throw new Error('Insufficient PVT balance');
    }
    await conn.query(
      `UPDATE token_balances SET balance = balance - ? WHERE user_id = ?`, [amount, userId]
    );
    await conn.query(
      `INSERT INTO token_transactions (user_id, amount, type, reason, reference_id, reference_type)
       VALUES (?, ?, 'debit', ?, ?, ?)`,
      [userId, amount, reason, refId, refType]
    );
    await conn.commit();
  } catch (e) {
    await conn.rollback();
    throw e;
  } finally {
    conn.release();
  }
}

async function dailyCheckin(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const [[existing]] = await pool.query(
    `SELECT id FROM daily_checkins WHERE user_id = ? AND checkin_date = ?`, [userId, today]
  );
  if (existing) return { alreadyCheckedIn: true, tokens: 0, streakDay: 0 };

  const [[last]] = await pool.query(
    `SELECT checkin_date, streak_day FROM daily_checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1`,
    [userId]
  );

  const streakContinues = last && last.checkin_date === yesterday;
  const streakDay = streakContinues ? (last.streak_day + 1) : 1;

  let tokens = REWARDS.DAILY_CHECKIN;
  let bonus = '';
  if (streakDay === 7)                  { tokens += REWARDS.STREAK_7;  bonus = '7-day streak bonus!'; }
  else if (streakDay >= 30 && streakDay % 30 === 0) { tokens += REWARDS.STREAK_30; bonus = `${streakDay}-day streak bonus!`; }

  await pool.query(
    `INSERT INTO daily_checkins (user_id, checkin_date, streak_day, tokens_awarded) VALUES (?, ?, ?, ?)`,
    [userId, today, streakDay, tokens]
  );
  await awardTokens(userId, tokens, `Daily check-in — day ${streakDay}${bonus ? ' (' + bonus + ')' : ''}`);

  return { alreadyCheckedIn: false, tokens, streakDay, bonus };
}

async function getCheckinStatus(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  const [[todayRow]] = await pool.query(
    `SELECT streak_day, tokens_awarded FROM daily_checkins WHERE user_id = ? AND checkin_date = ?`,
    [userId, today]
  );
  const [[lastRow]] = await pool.query(
    `SELECT checkin_date, streak_day FROM daily_checkins WHERE user_id = ? ORDER BY checkin_date DESC LIMIT 1`,
    [userId]
  );

  const streakActive = lastRow && (lastRow.checkin_date === today || lastRow.checkin_date === yesterday);
  const currentStreak = todayRow?.streak_day ?? (streakActive ? lastRow.streak_day : 0);

  return {
    checkedInToday: !!todayRow,
    currentStreak,
    nextMilestone: currentStreak < 7 ? 7 : currentStreak < 30 ? 30 : Math.ceil((currentStreak + 1) / 30) * 30,
    lastCheckin: lastRow?.checkin_date || null,
  };
}

async function getTransactions(userId, limit = 30) {
  const [rows] = await pool.query(
    `SELECT id, amount, type, reason, reference_type, created_at
     FROM token_transactions WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`,
    [userId, limit]
  );
  return rows;
}

// ── Betting ───────────────────────────────────────────────────────────────────

async function placeBet(userId, predictionId, amount, direction) {
  if (!['for', 'against'].includes(direction)) throw new Error('direction must be "for" or "against"');
  if (amount < 10) throw new Error('Minimum bet is 10 PVT');

  const [[pred]] = await pool.query(
    `SELECT id, result, tip FROM predictions WHERE id = ? AND result = 'pending' AND published_at IS NOT NULL`,
    [predictionId]
  );
  if (!pred) throw new Error('Prediction not available for betting');

  const [[existing]] = await pool.query(
    `SELECT id FROM prediction_bets WHERE user_id = ? AND prediction_id = ?`, [userId, predictionId]
  );
  if (existing) throw new Error('You already have a bet on this prediction');

  await deductTokens(userId, amount, `Bet ${direction} — prediction #${predictionId}`, predictionId, 'bet');
  await pool.query(
    `INSERT INTO prediction_bets (user_id, prediction_id, amount, direction) VALUES (?, ?, ?, ?)`,
    [userId, predictionId, amount, direction]
  );
  return { placed: true, amount, direction, predictionId };
}

async function settleBets(predictionId, predictionResult) {
  // predictionResult: 'won' | 'lost'
  const [bets] = await pool.query(
    `SELECT * FROM prediction_bets WHERE prediction_id = ? AND outcome = 'pending'`, [predictionId]
  );
  for (const bet of bets) {
    const won = (bet.direction === 'for' && predictionResult === 'won') ||
                (bet.direction === 'against' && predictionResult === 'lost');
    const payout = won ? Math.floor(bet.amount * REWARDS.BET_PAYOUT) : 0;
    await pool.query(
      `UPDATE prediction_bets SET outcome = ?, tokens_returned = ? WHERE id = ?`,
      [won ? 'won' : 'lost', payout, bet.id]
    );
    if (won && payout > 0) {
      await awardTokens(bet.user_id, payout,
        `Bet won — prediction #${predictionId} (${bet.direction})`,
        bet.id, 'bet_payout'
      );
    }
  }
  return bets.length;
}

async function getUserBets(userId, limit = 30) {
  const [rows] = await pool.query(
    `SELECT pb.*, p.home_team, p.away_team, p.tip, p.match_date, p.slug, p.result as pred_result
     FROM prediction_bets pb JOIN predictions p ON p.id = pb.prediction_id
     WHERE pb.user_id = ? ORDER BY pb.created_at DESC LIMIT ?`,
    [userId, limit]
  );
  return rows;
}

async function getPredictionBetStats(predictionId) {
  const [[stats]] = await pool.query(
    `SELECT
       COUNT(*) as total_bets,
       SUM(CASE WHEN direction='for' THEN 1 ELSE 0 END) as for_count,
       SUM(CASE WHEN direction='against' THEN 1 ELSE 0 END) as against_count,
       SUM(CASE WHEN direction='for' THEN amount ELSE 0 END) as for_tokens,
       SUM(CASE WHEN direction='against' THEN amount ELSE 0 END) as against_tokens
     FROM prediction_bets WHERE prediction_id = ? AND outcome = 'pending'`,
    [predictionId]
  );
  const total = stats.total_bets || 0;
  return {
    total_bets: total,
    for_pct: total ? Math.round((stats.for_count / total) * 100) : 50,
    against_pct: total ? Math.round((stats.against_count / total) * 100) : 50,
    for_tokens: stats.for_tokens || 0,
    against_tokens: stats.against_tokens || 0,
  };
}

module.exports = {
  REWARDS, getBalance, awardTokens, deductTokens,
  dailyCheckin, getCheckinStatus, getTransactions,
  placeBet, settleBets, getUserBets, getPredictionBetStats,
};
