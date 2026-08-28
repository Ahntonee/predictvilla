const { pool } = require('../config/db');
const { successResponse, errorResponse, asyncHandler } = require('../utils/helpers');

const DEFAULT_PAGES = [
  { slug: 'terms',   title: 'Terms of Service', content: '# Terms of Service\n\nEdit this page from the admin panel.' },
  { slug: 'privacy', title: 'Privacy Policy',   content: '# Privacy Policy\n\nEdit this page from the admin panel.' },
  { slug: 'contact', title: 'Contact Us',        content: '# Contact Us\n\nEdit this page from the admin panel.' },
  { slug: 'homepage_article', title: 'Homepage SEO Article', content: '## Football Predictions & Tips — Expert Guide\n\nWelcome to Predictvilla, your go-to destination for data-driven football predictions. Our AI-powered Intelligence Engine analyses form, H2H data, and live bookie odds to deliver the most accurate football tips across 160+ leagues.\n\n### What Are Football Predictions?\n\nFootball predictions use statistical models and team data to forecast match outcomes — from the final result to goals, corners, and more. At Predictvilla, every tip is backed by real-time data and a confidence score.\n\n### Free vs VIP Tips\n\nWe publish free tips daily for casual bettors and offer a VIP subscription for those who want our highest-confidence banker picks, AI-graded analysis, and early access to upcoming fixtures.\n\n### How to Use Our Tips\n\nBrowse by date, league, or market. Filter by category — Over 2.5 Goals, BTTS, 1X2, and more. Our confidence bar tells you how strongly our model backs each pick.\n\n*Always bet responsibly. Tips are for entertainment only.*' },
];

exports.listPages = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT slug, title, updated_at FROM static_pages ORDER BY slug');
  const existing = new Set(rows.map(r => r.slug));
  const missing = DEFAULT_PAGES.filter(p => !existing.has(p.slug));
  if (missing.length) {
    await Promise.all(missing.map(p =>
      pool.query('INSERT IGNORE INTO static_pages (slug, title, content) VALUES (?,?,?)', [p.slug, p.title, p.content])
    ));
    const [refreshed] = await pool.query('SELECT slug, title, updated_at FROM static_pages ORDER BY slug');
    return successResponse(res, { pages: refreshed });
  }
  return successResponse(res, { pages: rows });
});

exports.getPage = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM static_pages WHERE slug=?', [req.params.slug]);
  if (!rows.length) return errorResponse(res, 'Page not found', 404);
  return successResponse(res, { page: rows[0] });
});

exports.updatePage = asyncHandler(async (req, res) => {
  const { title, content, extra } = req.body;
  await pool.query(
    'INSERT INTO static_pages (slug, title, content, extra) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE title=VALUES(title), content=VALUES(content), extra=VALUES(extra), updated_at=NOW()',
    [req.params.slug, title, content, extra ? JSON.stringify(extra) : null]
  );
  return successResponse(res, null, 'Page updated');
});

exports.getSocialLinks = asyncHandler(async (req, res) => {
  const keys = ['social_twitter','social_telegram','social_facebook','social_instagram','social_youtube','social_tiktok'];
  const [rows] = await pool.query(
    `SELECT setting_key, setting_value FROM site_settings WHERE setting_key IN (${keys.map(() => '?').join(',')})`,
    keys
  );
  const links = {};
  rows.forEach(r => { if (r.setting_value) links[r.setting_key.replace('social_','')] = r.setting_value; });
  return successResponse(res, { links });
});

exports.updateSocialLinks = asyncHandler(async (req, res) => {
  const allowed = ['twitter','telegram','facebook','instagram','youtube','tiktok'];
  const entries = Object.entries(req.body).filter(([k]) => allowed.includes(k));
  if (entries.length) {
    await Promise.all(entries.map(([k, v]) =>
      pool.query(
        'INSERT INTO site_settings (setting_key, setting_value) VALUES (?,?) ON DUPLICATE KEY UPDATE setting_value=VALUES(setting_value)',
        ['social_' + k, v]
      )
    ));
  }
  return successResponse(res, null, 'Social links updated');
});
