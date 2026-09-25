const axios = require('axios');
const crypto = require('crypto');
const { pool } = require('../config/db');
const apiQuota = require('./apiQuota');

const BASE = process.env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io';
const KEY = process.env.API_FOOTBALL_KEY;

const ENDPOINTS = [
  'status', 'timezone', 'countries', 'leagues', 'leagues/seasons',
  'teams', 'teams/statistics', 'teams/seasons', 'teams/countries', 'venues',
  'standings', 'fixtures', 'fixtures/rounds', 'fixtures/headtohead',
  'fixtures/statistics', 'fixtures/events', 'fixtures/lineups', 'fixtures/players',
  'injuries', 'predictions', 'coachs', 'players', 'players/profiles',
  'players/seasons', 'players/squads', 'players/topscorers', 'players/topassists',
  'players/topyellowcards', 'players/topredcards', 'transfers', 'trophies',
  'sidelined', 'odds/live', 'odds/live/bets', 'odds', 'odds/mapping',
  'odds/bookmakers', 'odds/bets',
];

const ENDPOINT_SET = new Set(ENDPOINTS);

function assertEndpoint(endpoint) {
  if (!ENDPOINT_SET.has(endpoint)) throw Object.assign(new Error('Unsupported API-Football endpoint'), { status: 400 });
}

function cleanParams(params) {
  if (!params || typeof params !== 'object' || Array.isArray(params)) return {};
  return Object.fromEntries(Object.entries(params)
    .filter(([key, value]) => /^[a-z_]+$/i.test(key) && value !== '' && value !== null && value !== undefined)
    .map(([key, value]) => [key, String(value).slice(0, 500)]));
}

function externalId(item) {
  const candidates = [
    item?.fixture?.id, item?.player?.id, item?.team?.id, item?.league?.id,
    item?.venue?.id, item?.coach?.id, item?.id,
  ];
  const found = candidates.find(value => value !== undefined && value !== null);
  return found === undefined ? null : String(found);
}

async function storeResponse(endpoint, rawParams, rawResponse) {
  if (!ENDPOINT_SET.has(endpoint)) return { received: 0, inserted: 0 };
  const params = cleanParams(rawParams);
  const records = Array.isArray(rawResponse)
    ? rawResponse
    : rawResponse === undefined || rawResponse === null ? [] : [rawResponse];
  let inserted = 0;
  for (const item of records) {
    const payload = JSON.stringify(item);
    const hash = crypto.createHash('sha256').update(payload).digest('hex');
    const [result] = await pool.query(
      `INSERT INTO api_football_records
         (endpoint, external_id, request_params, payload, content_hash)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE last_seen_at=NOW(), request_params=VALUES(request_params)`,
      [endpoint, externalId(item), JSON.stringify(params), payload, hash]
    );
    if (result.affectedRows === 1) inserted++;
  }
  return { received: records.length, inserted };
}

async function archiveEndpoint(endpoint, rawParams = {}, requestedMaxPages = 10) {
  assertEndpoint(endpoint);
  if (!KEY) throw Object.assign(new Error('API_FOOTBALL_KEY is not configured'), { status: 503 });

  const params = cleanParams(rawParams);
  delete params.page;
  const maxPages = Math.min(Math.max(parseInt(requestedMaxPages) || 10, 1), 100);
  const [run] = await pool.query(
    `INSERT INTO api_football_imports (endpoint, request_params) VALUES (?, ?)`,
    [endpoint, JSON.stringify(params)]
  );

  let pagesFetched = 0;
  let recordsReceived = 0;
  let recordsInserted = 0;
  try {
    let page = 1;
    let totalPages = 1;
    do {
      apiQuota.checkAndIncrement(`archive:${endpoint}`);
      const response = await axios.get(`${BASE}/${endpoint}`, {
        params: { ...params, ...(totalPages > 1 || page > 1 ? { page } : {}) },
        headers: { 'x-apisports-key': KEY },
        timeout: 30000,
      });
      const apiErrors = response.data?.errors;
      if (apiErrors && (Array.isArray(apiErrors) ? apiErrors.length : Object.keys(apiErrors).length)) {
        throw new Error(`API-Football: ${JSON.stringify(apiErrors)}`);
      }

      const raw = response.data?.response;
      const records = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw];
      const paging = response.data?.paging || {};
      totalPages = Math.max(parseInt(paging.total) || 1, 1);
      pagesFetched++;
      recordsReceived += records.length;

      const stored = await storeResponse(endpoint, params, records);
      recordsInserted += stored.inserted;
      page++;
    } while (page <= totalPages && pagesFetched < maxPages);

    await pool.query(
      `UPDATE api_football_imports SET status='completed', pages_fetched=?, records_received=?,
       records_inserted=?, completed_at=NOW() WHERE id=?`,
      [pagesFetched, recordsReceived, recordsInserted, run.insertId]
    );
    return { importId: run.insertId, endpoint, pagesFetched, totalPages, recordsReceived, recordsInserted, truncated: pagesFetched < totalPages };
  } catch (error) {
    await pool.query(
      `UPDATE api_football_imports SET status='failed', pages_fetched=?, records_received=?,
       records_inserted=?, error_message=?, completed_at=NOW() WHERE id=?`,
      [pagesFetched, recordsReceived, recordsInserted, error.message.slice(0, 2000), run.insertId]
    );
    throw error;
  }
}

module.exports = { ENDPOINTS, archiveEndpoint, storeResponse };
