const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler, parsePagination, paginate, sanitiseText } = require('../utils/helpers');

function slugify(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

exports.list = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const params = [];
  const where = [];
  if (req.query.admin !== '1') where.push('is_published=1');
  else if (req.query.published === '1' || req.query.published === '0') {
    where.push('is_published=?');
    params.push(Number(req.query.published));
  }
  if (req.query.search) {
    where.push('(title LIKE ? OR sponsor_name LIKE ?)');
    params.push(`%${req.query.search}%`, `%${req.query.search}%`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) total FROM sponsored_posts ${whereSql}`, params);
  const [posts] = await pool.query(
    `SELECT id, slug, title, sponsor_name, disclosure, excerpt, featured_image, is_published, published_at, updated_at
     FROM sponsored_posts ${whereSql} ORDER BY updated_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return successResponse(res, { posts, pagination: paginate(total, page, limit), total });
});

exports.getBySlug = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM sponsored_posts WHERE slug=? AND is_published=1 LIMIT 1',
    [req.params.slug]
  );
  if (!rows.length) return errorResponse(res, 'Sponsored post not found', 404);
  return successResponse(res, { post: rows[0] });
});

exports.getById = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM sponsored_posts WHERE id=?', [req.params.id]);
  if (!rows.length) return errorResponse(res, 'Sponsored post not found', 404);
  return successResponse(res, { post: rows[0] });
});

exports.create = asyncHandler(async (req, res) => {
  const {
    title, slug: rawSlug, sponsor_name, sponsor_url, disclosure, excerpt, content,
    featured_image, meta_title, meta_description, keywords, is_published,
  } = req.body;
  if (!title || !sponsor_name || !content) return errorResponse(res, 'Title, sponsor name and content are required', 400);
  const slug = slugify(rawSlug || title);
  if (!slug) return errorResponse(res, 'A valid slug is required', 400);
  const published = Boolean(Number(is_published));
  const [result] = await pool.query(
    `INSERT INTO sponsored_posts
      (slug, title, sponsor_name, sponsor_url, disclosure, excerpt, content, featured_image,
       meta_title, meta_description, keywords, is_published, published_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [slug, sanitiseText(title), sanitiseText(sponsor_name), sponsor_url || null,
      disclosure || 'Sponsored content', excerpt ? sanitiseText(excerpt) : null, content,
      featured_image || null, meta_title || null, meta_description || null, keywords || null,
      published ? 1 : 0, published ? new Date() : null]
  );
  return successResponse(res, { id: result.insertId, slug }, 'Sponsored post created', 201);
});

exports.update = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [existing] = await pool.query('SELECT id FROM sponsored_posts WHERE id=?', [id]);
  if (!existing.length) return errorResponse(res, 'Sponsored post not found', 404);
  const {
    title, slug: rawSlug, sponsor_name, sponsor_url, disclosure, excerpt, content,
    featured_image, meta_title, meta_description, keywords, is_published,
  } = req.body;
  if (!title || !sponsor_name || !content) return errorResponse(res, 'Title, sponsor name and content are required', 400);
  const published = Boolean(Number(is_published));
  await pool.query(
    `UPDATE sponsored_posts SET slug=?, title=?, sponsor_name=?, sponsor_url=?, disclosure=?,
      excerpt=?, content=?, featured_image=?, meta_title=?, meta_description=?, keywords=?,
      is_published=?, published_at=IF(?, COALESCE(published_at, NOW()), NULL) WHERE id=?`,
    [slugify(rawSlug || title), sanitiseText(title), sanitiseText(sponsor_name), sponsor_url || null,
      disclosure || 'Sponsored content', excerpt ? sanitiseText(excerpt) : null, content,
      featured_image || null, meta_title || null, meta_description || null, keywords || null,
      published ? 1 : 0, published ? 1 : 0, id]
  );
  return successResponse(res, null, 'Sponsored post updated');
});

exports.remove = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM sponsored_posts WHERE id=?', [req.params.id]);
  return successResponse(res, null, 'Sponsored post deleted');
});

exports.publish = asyncHandler(async (req, res) => {
  const published = Boolean(Number(req.body?.is_published));
  await pool.query(
    'UPDATE sponsored_posts SET is_published=?, published_at=? WHERE id=?',
    [published ? 1 : 0, published ? new Date() : null, req.params.id]
  );
  return successResponse(res, null, published ? 'Sponsored post published' : 'Sponsored post unpublished');
});
