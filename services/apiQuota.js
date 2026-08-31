/**
 * Shared daily API-Football call counter.
 * Tracks calls in-memory, flushes to site_settings every 5s, resets at midnight.
 */
const { pool } = require('../config/db');

const DAILY_LIMIT = parseInt(process.env.API_DAILY_LIMIT) || 2500;
let _callsToday = 0;
let _lastDate = new Date().toDateString();
let _flushPending = false;

async function _init() {
  try {
    const [rows] = await pool.query(
      `SELECT setting_key, setting_value FROM site_settings
       WHERE setting_key IN ('api_calls_today', 'api_calls_date')`
    );
    const map = {};
    rows.forEach(r => { map[r.setting_key] = r.setting_value; });
    const savedDate = map['api_calls_date'] || '';
    const today = new Date().toDateString();
    _callsToday = savedDate === today ? (parseInt(map['api_calls_today']) || 0) : 0;
    _lastDate = today;
    console.log(`[ApiQuota] Loaded: ${_callsToday}/${DAILY_LIMIT} calls used today`);
  } catch {}
}

function _flush() {
  if (_flushPending) return;
  _flushPending = true;
  setTimeout(async () => {
    _flushPending = false;
    try {
      const today = new Date().toDateString();
      await pool.query(
        `INSERT INTO site_settings (setting_key, setting_value) VALUES ('api_calls_today', ?),('api_calls_date', ?)
         ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
        [String(_callsToday), today]
      );
    } catch {}
  }, 5000);
}

function checkAndIncrement(label = '') {
  const today = new Date().toDateString();
  if (today !== _lastDate) {
    _callsToday = 0;
    _lastDate = today;
  }
  if (_callsToday >= DAILY_LIMIT) {
    const msg = `[ApiQuota] BLOCKED: daily limit ${DAILY_LIMIT} reached (${label})`;
    console.warn(msg);
    throw new Error(`API daily limit reached (${DAILY_LIMIT}/day). Try again tomorrow.`);
  }
  _callsToday++;
  _flush();
  return _callsToday;
}

function getToday() { return _callsToday; }
function getLimit() { return DAILY_LIMIT; }
function reset() {
  _callsToday = 0;
  _lastDate = new Date().toDateString();
  _flush();
  console.log('[ApiQuota] Daily counter reset');
}

_init();

module.exports = { checkAndIncrement, getToday, getLimit, reset };
