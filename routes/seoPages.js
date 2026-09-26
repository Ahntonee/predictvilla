const router = require('express').Router();
const { pool } = require('../config/db');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');
const { seedMarketSeoPages } = require('../services/marketSeoPages');

// Admin: list all
router.get('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  await seedMarketSeoPages(pool);
  const [rows] = await pool.query('SELECT id, slug, title, target_url, market, is_published, show_live_predictions, updated_at FROM seo_article_pages ORDER BY target_url, updated_at DESC');
  return successResponse(res, { pages: rows });
}));

// Admin: get single
router.get('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM seo_article_pages WHERE id=?', [req.params.id]);
  if (!rows.length) return errorResponse(res, 'Page not found', 404);
  return successResponse(res, { page: rows[0] });
}));

// Admin: create
router.post('/', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { slug, title, meta_description, meta_keywords, content, target_url, market, is_published, show_live_predictions } = req.body;
  if (!slug || !title) return errorResponse(res, 'Slug and title are required');
  const clean = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  const [r] = await pool.query(
    `INSERT INTO seo_article_pages (slug, title, meta_description, meta_keywords, content, target_url, market, is_published, show_live_predictions)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [clean, title, meta_description||null, meta_keywords||null, content||null, target_url||null, market||null, is_published!==false?1:0, show_live_predictions!==false?1:0]
  );
  return successResponse(res, { id: r.insertId, slug: clean }, 'SEO page created');
}));

// Admin: update
router.put('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  const { title, meta_description, meta_keywords, content, target_url, market, is_published, show_live_predictions } = req.body;
  await pool.query(
    `UPDATE seo_article_pages SET title=?, meta_description=?, meta_keywords=?, content=?, target_url=?, market=?, is_published=?, show_live_predictions=? WHERE id=?`,
    [title, meta_description||null, meta_keywords||null, content||null, target_url||null, market||null, is_published!==false?1:0, show_live_predictions!==false?1:0, req.params.id]
  );
  return successResponse(res, null, 'SEO page updated');
}));

// Admin: delete
router.delete('/:id', authenticate, requireAdmin, asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM seo_article_pages WHERE id=?', [req.params.id]);
  return successResponse(res, null, 'Page deleted');
}));

module.exports = router;
