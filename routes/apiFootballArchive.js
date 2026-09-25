const router = require('express').Router();
const { pool } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler, successResponse, parsePagination, paginate } = require('../utils/helpers');
const { ENDPOINTS, archiveEndpoint } = require('../services/apiFootballArchive');

router.use(authenticate, requireAdmin);

router.get('/endpoints', (req, res) => successResponse(res, { endpoints: ENDPOINTS }));

router.post('/import', asyncHandler(async (req, res) => {
  const { endpoint, params = {}, maxPages = 10 } = req.body || {};
  const result = await archiveEndpoint(endpoint, params, maxPages);
  return successResponse(res, result, `Imported ${result.recordsReceived} records from ${endpoint}`);
}));

router.get('/records', asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const endpoint = req.query.endpoint || '';
  const where = endpoint ? 'WHERE endpoint=?' : '';
  const params = endpoint ? [endpoint] : [];
  const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM api_football_records ${where}`, params);
  const [rows] = await pool.query(
    `SELECT id, endpoint, external_id, request_params, payload, first_imported_at, last_seen_at
     FROM api_football_records ${where} ORDER BY last_seen_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return successResponse(res, { records: rows, pagination: paginate(count.total, page, limit) });
}));

router.get('/imports', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT * FROM api_football_imports ORDER BY started_at DESC LIMIT 100`
  );
  return successResponse(res, { imports: rows });
}));

module.exports = router;
