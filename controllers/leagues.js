const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');

exports.list = asyncHandler(async (req, res) => {
  const { grouped } = req.query;
  const [rows] = await pool.query(
    'SELECT * FROM leagues WHERE is_active=1 ORDER BY is_popular DESC, continent, name'
  );
  if (grouped) {
    const grouped = {};
    for (const r of rows) {
      const key = r.continent || 'Other';
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(r);
    }
    return successResponse(res, { leagues: grouped });
  }
  return successResponse(res, { leagues: rows });
});

exports.listAdmin = asyncHandler(async (req, res) => {
  const page = Math.max(parseInt(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 30, 1), 100);
  const where = [], params = [];
  if (req.query.search) { where.push('(name LIKE ? OR country LIKE ?)'); params.push(`%${req.query.search}%`, `%${req.query.search}%`); }
  if (req.query.continent) { where.push('continent=?'); params.push(req.query.continent); }
  if (req.query.is_active !== undefined && req.query.is_active !== '') { where.push('is_active=?'); params.push(req.query.is_active === '1' ? 1 : 0); }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM leagues ${clause}`, params);
  const [rows] = await pool.query(
    `SELECT * FROM leagues ${clause} ORDER BY is_popular DESC, continent, name LIMIT ? OFFSET ?`,
    [...params, limit, (page - 1) * limit]
  );
  return successResponse(res, { leagues: rows, total: count.total });
});

exports.getOne = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM leagues WHERE id=?', [req.params.id]);
  if (!rows.length) return errorResponse(res, 'League not found', 404);
  return successResponse(res, { league: rows[0] });
});

exports.create = asyncHandler(async (req, res) => {
  const { api_league_id, name, country, continent, logo_url, is_popular } = req.body;
  const [result] = await pool.query(
    'INSERT INTO leagues (api_league_id, name, country, continent, logo_url, is_popular) VALUES (?,?,?,?,?,?)',
    [api_league_id || null, name, country || null, continent || null, logo_url || null, is_popular ? 1 : 0]
  );
  return successResponse(res, { id: result.insertId }, 'League created', 201);
});

exports.update = asyncHandler(async (req, res) => {
  const fields = ['api_league_id','name','country','continent','logo_url','is_active','is_popular'];
  const updates = [], params = [];
  for (const field of fields) {
    if (req.body[field] === undefined) continue;
    updates.push(`${field}=?`);
    params.push(['is_active','is_popular'].includes(field) ? (req.body[field] ? 1 : 0) : req.body[field]);
  }
  if (!updates.length) return errorResponse(res, 'No fields to update', 400);
  params.push(req.params.id);
  await pool.query(`UPDATE leagues SET ${updates.join(',')} WHERE id=?`, params);
  return successResponse(res, null, 'League updated');
});

exports.remove = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM leagues WHERE id=?', [req.params.id]);
  return successResponse(res, null, 'League deleted');
});
