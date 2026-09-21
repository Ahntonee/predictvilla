const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler, parsePagination, paginate, generateBlogSlug, sanitiseText } = require('../utils/helpers');

exports.list = asyncHandler(async (req, res) => {
  const { page, limit, offset } = parsePagination(req.query);
  const { category, published, search } = req.query;
  let where = [];
  const params = [];

  if (published !== 'false') { where.push('is_published = 1'); }
  if (category) { where.push('category = ?'); params.push(category); }
  if (search) { where.push('(title LIKE ? OR excerpt LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }

  const whereStr = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const [countRows] = await pool.query(`SELECT COUNT(*) as cnt FROM blog_posts ${whereStr}`, params);
  const [rows] = await pool.query(
    `SELECT id, slug, title, excerpt, featured_image, category, author_name, published_at, created_at
     FROM blog_posts ${whereStr} ORDER BY published_at DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  return successResponse(res, { posts: rows, pagination: paginate(countRows[0].cnt, page, limit) });
});

exports.getBySlug = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM blog_posts WHERE slug=? AND is_published=1', [req.params.slug]);
  if (!rows.length) return errorResponse(res, 'Post not found', 404);
  const post = rows[0];

  const [related] = await pool.query(
    `SELECT id, slug, title, excerpt, featured_image, published_at FROM blog_posts
     WHERE is_published=1 AND category=? AND slug != ? ORDER BY published_at DESC LIMIT 3`,
    [post.category, post.slug]
  );
  return successResponse(res, { post, related });
});

exports.create = asyncHandler(async (req, res) => {
  const { title, content, excerpt, category, author_name, meta_title, meta_description,
          keywords, featured_image, is_published, slug: rawSlug } = req.body;
  const slug = rawSlug ? rawSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') : generateBlogSlug(title);
  const pub = is_published ? new Date() : null;

  const [result] = await pool.query(
    `INSERT INTO blog_posts (slug, title, content, excerpt, category, author_name,
      meta_title, meta_description, keywords, featured_image, is_published, published_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    [slug, sanitiseText(title), content, excerpt ? sanitiseText(excerpt) : null,
     category || null, author_name || 'Predictvilla', meta_title || null, meta_description || null,
     keywords || null, featured_image || null, is_published ? 1 : 0, pub]
  );
  return successResponse(res, { id: result.insertId, slug }, 'Post created', 201);
});

exports.update = asyncHandler(async (req, res) => {
  const { title, content, excerpt, category, author_name, meta_title, meta_description,
          keywords, featured_image, is_published, slug: rawSlug } = req.body;
  const [existing] = await pool.query('SELECT id, is_published FROM blog_posts WHERE id=?', [req.params.id]);
  if (!existing.length) return errorResponse(res, 'Post not found', 404);

  const pub = is_published && !existing[0].is_published ? new Date() : (is_published ? undefined : null);
  const slugUpdate = rawSlug ? rawSlug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') : null;

  await pool.query(
    `UPDATE blog_posts SET title=?, content=?, excerpt=?, category=?, author_name=?,
      meta_title=?, meta_description=?, keywords=?, featured_image=?, is_published=?
      ${slugUpdate ? ', slug=?' : ''}
      ${pub !== undefined ? ', published_at=?' : ''} WHERE id=?`,
    [sanitiseText(title || ''), content, excerpt || null, category || null,
     author_name || 'Predictvilla', meta_title || null, meta_description || null,
     keywords || null, featured_image || null, is_published ? 1 : 0,
     ...(slugUpdate ? [slugUpdate] : []),
     ...(pub !== undefined ? [pub] : []), req.params.id]
  );
  return successResponse(res, null, 'Post updated');
});

exports.remove = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM blog_posts WHERE id=?', [req.params.id]);
  return successResponse(res, null, 'Post deleted');
});

exports.publish = asyncHandler(async (req, res) => {
  const isPublished = req.body?.is_published !== undefined
    ? Boolean(Number(req.body.is_published))
    : true;
  await pool.query(
    'UPDATE blog_posts SET is_published=?, published_at=? WHERE id=?',
    [isPublished ? 1 : 0, isPublished ? new Date() : null, req.params.id]
  );
  return successResponse(res, null, isPublished ? 'Published' : 'Unpublished');
});

exports.uploadImage = asyncHandler(async (req, res) => {
  const { image, filename } = req.body;
  if (!image) return errorResponse(res, 'No image provided', 400);
  // Store as data URL and return for EasyMDE insertion
  return successResponse(res, { url: image, filename });
});
