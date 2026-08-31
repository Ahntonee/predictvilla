require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const { connectWithRetry } = require('./config/db');
const { pool } = require('./config/db');
const { startScheduler } = require('./services/scheduler');

const app = express();
const isProd = process.env.NODE_ENV === 'production';
const PORT = process.env.PORT || 3000;

// ─── Security ──────────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", "https://js.paystack.co", "https://pagead2.googlesyndication.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: null, // disabled — site runs on HTTP behind nginx
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  origin: true,
  credentials: true,
}));

const apiLimiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 200,
  standardHeaders: true, legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please slow down.' },
});
app.use('/api/', apiLimiter);

// ─── Parsing ────────────────────────────────────────────────────────────────
// Raw body for Paystack webhook (must come before express.json)
app.use('/api/webhooks/paystack', express.raw({ type: 'application/json' }));

// Large body limit for admin blog/pages uploads
app.use('/api/admin/blog', express.json({ limit: '10mb' }));
app.use('/api/admin/pages', express.json({ limit: '10mb' }));
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());
app.use(compression());
app.use(morgan(isProd ? 'combined' : 'dev'));

// ─── Analytics middleware ────────────────────────────────────────────────────
function getDeviceType(ua) {
  if (!ua) return 'unknown';
  if (/mobile|android|iphone|ipad/i.test(ua)) return /ipad|tablet/i.test(ua) ? 'tablet' : 'mobile';
  return 'desktop';
}

app.use(async (req, res, next) => {
  if (req.method !== 'GET' || req.path.startsWith('/api/') || req.path.startsWith('/admin/')) return next();
  try {
    let sessionId = req.cookies?.ol_session;
    if (!sessionId) {
      sessionId = crypto.randomBytes(16).toString('hex');
      res.cookie('ol_session', sessionId, { maxAge: 30 * 60 * 1000, httpOnly: true });
    }
    const referrer = req.headers.referer ? new URL(req.headers.referer).hostname : null;
    const device = getDeviceType(req.headers['user-agent']);
    await pool.query(
      'INSERT INTO page_views (path, device_type, referrer, session_id) VALUES (?,?,?,?)',
      [req.path.slice(0, 499), device, referrer?.slice(0, 499) || null, sessionId]
    );
  } catch {}
  next();
});

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api/auth', require('./routes/auth'));
app.use('/api/predictions', require('./routes/predictions'));
app.use('/api/admin/predictions', require('./routes/predictions'));
app.use('/api/leagues', require('./routes/leagues'));
app.use('/api/admin/leagues', require('./routes/leagues'));
app.use('/api/statistics', require('./routes/statistics'));
app.use('/api/admin/intelligence', require('./routes/intelligence'));
app.use('/api/blog', require('./routes/blog'));
app.use('/api/admin/blog', require('./routes/blog'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/webhooks', require('./routes/webhooks'));
app.use('/api/comments', require('./routes/comments'));
app.use('/api/users', require('./routes/users'));
app.use('/api/admin/seo', require('./routes/seo'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/admin/analytics', require('./routes/analytics'));
app.use('/api/admin/revenue', require('./routes/analytics'));
app.use('/api/pages', require('./routes/pages'));
app.use('/api/admin/pages', require('./routes/pages'));
app.use('/api/sync', require('./routes/sync'));
app.use('/api/tokens', require('./routes/tokens'));
app.use('/api/backlinks', require('./routes/backlinks'));
app.use('/api/ads', require('./routes/ads'));
app.use('/api/admin/seo-pages', require('./routes/seoPages'));
app.use('/api', require('./routes/standings'));

// Public config (safe keys only — never expose secrets)
app.get('/api/config/public', (req, res) => {
  res.json({ paystackKey: process.env.PAYSTACK_PUBLIC_KEY || '' });
});

// Public SEO article page data
app.get('/api/seo-article-public/:slug', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, slug, title, meta_description, content, market, show_live_predictions, updated_at FROM seo_article_pages WHERE slug=? AND is_published=1 LIMIT 1`,
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Not found' });
    return res.json({ success: true, data: { page: rows[0] } });
  } catch (e) {
    return res.status(500).json({ success: false, message: e.message });
  }
});

// ─── Health ──────────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ success: true, status: 'ok' }));
app.get('/api/status', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ success: true, db: 'connected', env: process.env.NODE_ENV });
  } catch {
    res.status(503).json({ success: false, db: 'error' });
  }
});

// Shared slug helper used by league routes and sitemap
function leagueSlug(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// ─── SSR shell builders ───────────────────────────────────────────────────────
function buildStaticHeader(currentPath = '/') {
  const navLinks = [
    ['/', 'Home'],
    ['/predictions.html', 'Predictions'],
    ['/pricing.html', 'Subscription'],
    ['/blog.html', 'Blog'],
    ['/about.html', 'About Us'],
  ];
  const navHtml = navLinks.map(([href, label]) => {
    const active = (href === '/' ? currentPath === '/' : currentPath.startsWith(href.replace('.html', ''))) ? ' class="nav-link active"' : ' class="nav-link"';
    return `<a href="${href}"${active}>${label}</a>`;
  }).join('');
  return `<link rel="manifest" href="/manifest.json"><meta name="theme-color" content="#a0d000"><header class="site-header" id="header-placeholder">
  <div class="container"><div class="header-inner">
    <a href="/" class="site-logo">
      <img src="/images/logo.png" alt="Predictvilla" width="32" height="32">
      <span>Predictvilla</span>
    </a>
    <nav class="main-nav" id="main-nav">
      ${navHtml}
      <div class="nav-dropdown">
        <button class="nav-link nav-dropdown-btn">Tips <span class="material-icons-round" style="font-size:14px">expand_more</span></button>
        <div class="nav-dropdown-menu">
          <a href="/predictions/over-25">Over 2.5 Goals</a>
          <a href="/predictions/btts">BTTS</a>
          <a href="/predictions/accumulator">Accumulator</a>
          <a href="/predictions/1x2">1X2 / Win-Draw-Win</a>
          <a href="/predictions/correct-score">Correct Score</a>
          <a href="/predictions/double-chance">Double Chance</a>
          <a href="/predictions/draw-no-bet">Draw No Bet</a>
        </div>
      </div>
    </nav>
    <div class="header-actions">
      <a href="/pricing.html#login" class="btn btn-ghost btn-sm">Login</a>
      <a href="/pricing.html#register" class="btn btn-primary btn-sm">Register</a>
    </div>
  </div></div>
</header>`;
}

let _footerCache = { html: null, at: 0 };
async function buildStaticFooter() {
  if (_footerCache.html && Date.now() - _footerCache.at < 3600000) return _footerCache.html;
  let leagueLinksHtml = '<a href="/predictions.html">All Predictions</a>';
  try {
    const [popularLeagues] = await pool.query(
      'SELECT name FROM leagues WHERE is_active=1 AND is_popular=1 LIMIT 6'
    );
    if (popularLeagues.length) {
      leagueLinksHtml = popularLeagues.map(l =>
        `<a href="/league/${leagueSlug(l.name)}">${esc(l.name)}</a>`
      ).join('');
    }
  } catch {}
  const base2 = process.env.SITE_URL || 'https://www.predictvilla.com';
  const orgSchema = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Predictvilla","url":"${base2}","logo":{"@type":"ImageObject","url":"${base2}/images/logo.png"},"sameAs":["https://twitter.com/predictvilla","https://t.me/predictvilla"],"description":"AI-powered football predictions and VIP betting tips covering 160+ leagues worldwide."}</script>`;
  const html = `${orgSchema}<footer class="site-footer" id="footer-placeholder">
  <div class="container">
    <div class="footer-grid">
      <div class="footer-brand">
        <img src="/images/logo.png" alt="Predictvilla" width="48" height="48">
        <p>Data-Driven Picks. Proven Results.</p>
      </div>
      <div>
        <h4>Quick Links</h4>
        <a href="/predictions.html">Predictions</a>
        <a href="/pricing.html">VIP Subscription</a>
        <a href="/statistics.html">Statistics</a>
        <a href="/blog.html">Blog</a>
      </div>
      <div>
        <h4>Markets</h4>
        <a href="/predictions/over-25">Over 2.5 Goals</a>
        <a href="/predictions/btts">BTTS Tips</a>
        <a href="/predictions/accumulator">Acca Tips</a>
        <a href="/predictions/1x2">1X2 Tips</a>
        <a href="/predictions/correct-score">Correct Score</a>
        <a href="/predictions/double-chance">Double Chance</a>
      </div>
      <div>
        <h4>Top Leagues</h4>
        ${leagueLinksHtml}
      </div>
      <div>
        <h4>Legal</h4>
        <a href="/terms.html">Terms of Service</a>
        <a href="/privacy.html">Privacy Policy</a>
        <a href="/contact.html">Contact</a>
      </div>
    </div>
    <div class="footer-bottom">
      <p>&copy; 2025 Predictvilla &bull; For entertainment only. Please gamble responsibly.</p>
    </div>
  </div>
</footer>`;
  _footerCache = { html, at: Date.now() };
  return html;
}

function buildPredictionCard(p) {
  const resultClass = p.result === 'won' ? 'won' : p.result === 'lost' ? 'lost' : 'pending';
  const resultLabel = p.result === 'won' ? 'WON' : p.result === 'lost' ? 'LOST' : 'PENDING';
  const bankerBadge = p.is_banker ? '<span class="badge badge-banker" style="font-size:10px;padding:2px 8px">⭐ BANKER</span>' : '';
  const vipBadge = p.is_vip && !p.is_banker ? '<span class="badge badge-vip" style="font-size:10px">VIP</span>' : '';
  const date = new Date(p.match_date);
  const dateStr = date.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });
  return `<div class="prediction-card">
  <div class="flex-between mb-2">
    <div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">${bankerBadge}${vipBadge}</div>
    <span class="badge badge-${resultClass}">${resultLabel}</span>
  </div>
  <p class="text-soft" style="font-size:12px;margin-bottom:6px">${esc(p.league_name || 'Football')}</p>
  <h3 style="font-size:15px;font-weight:700;margin-bottom:8px">${esc(p.home_team)} vs ${esc(p.away_team)}</h3>
  <div class="flex-between mb-2">
    <span class="badge" style="background:rgba(160,208,0,0.1);color:var(--primary);font-size:12px">${esc(p.tip || 'TBD')}</span>
    ${p.odds ? `<span class="text-soft" style="font-size:12px">@ ${parseFloat(p.odds).toFixed(2)}</span>` : ''}
  </div>
  <div class="flex-between mt-2">
    <span class="text-muted" style="font-size:12px">${dateStr}</span>
    <a href="/prediction/${p.slug}" class="btn btn-sm btn-outline">View →</a>
  </div>
</div>`;
}

async function injectStaticShell(html, currentPath) {
  const header = buildStaticHeader(currentPath);
  const footer = await buildStaticFooter();
  return html
    .replace('<div id="header-placeholder"></div>', header)
    .replace('<div id="footer-placeholder"></div>', footer);
}

// ─── robots.txt ───────────────────────────────────────────────────────────────
app.get('/robots.txt', (req, res) => {
  const base = process.env.SITE_URL || 'https://www.predictvilla.com';
  res.type('text').send(
    `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${base}/sitemap.xml`
  );
});

// ─── Sitemap ──────────────────────────────────────────────────────────────────
let sitemapCache = { xml: null, at: 0 };
app.get('/sitemap.xml', async (req, res) => {
  if (Date.now() - sitemapCache.at < 3600000 && sitemapCache.xml) {
    res.type('xml').send(sitemapCache.xml);
    return;
  }
  const base = process.env.SITE_URL || 'https://www.predictvilla.com';
  const [preds] = await pool.query('SELECT slug, updated_at FROM predictions WHERE published_at IS NOT NULL ORDER BY updated_at DESC LIMIT 500');
  const [posts] = await pool.query('SELECT slug, updated_at FROM blog_posts WHERE is_published=1 ORDER BY updated_at DESC LIMIT 200');
  const [activeLeagues] = await pool.query('SELECT name FROM leagues WHERE is_active = 1');
  const [seoArticles] = await pool.query('SELECT slug, updated_at FROM seo_article_pages WHERE is_published=1 ORDER BY updated_at DESC LIMIT 200').catch(() => [[]]);

  const today = new Date().toISOString();
  const staticPriorities = {
    '': '1.0', '/predictions.html': '0.9', '/pricing.html': '0.85',
    '/statistics.html': '0.8', '/blog.html': '0.8', '/about.html': '0.6',
  };
  const staticUrls = Object.entries(staticPriorities);
  const marketUrls = Object.keys(MARKET_PAGES).map(slug =>
    `<url><loc>${base}/predictions/${slug}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.85</priority></url>`
  );
  const leagueUrls = activeLeagues.map(l =>
    `<url><loc>${base}/league/${leagueSlug(l.name)}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>0.8</priority></url>`
  );
  const urls = [
    ...staticUrls.map(([p, pri]) => `<url><loc>${base}${p}</loc><lastmod>${today}</lastmod><changefreq>daily</changefreq><priority>${pri}</priority></url>`),
    ...marketUrls,
    ...leagueUrls,
    ...preds.map(p => `<url><loc>${base}/prediction/${p.slug}</loc><lastmod>${new Date(p.updated_at).toISOString()}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority><image:image><image:loc>${base}/images/logo.png</image:loc><image:title>${esc(p.home_team)} vs ${esc(p.away_team)}</image:title></image:image></url>`),
    ...posts.map(p => `<url><loc>${base}/blog/${p.slug}</loc><lastmod>${new Date(p.updated_at).toISOString()}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`),
    ...seoArticles.map(p => `<url><loc>${base}/tips/${p.slug}</loc><lastmod>${new Date(p.updated_at).toISOString()}</lastmod><changefreq>weekly</changefreq><priority>0.8</priority></url>`),
  ];
  const xml = `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${urls.join('')}</urlset>`;
  sitemapCache = { xml, at: Date.now() };
  res.type('xml').send(xml);
});

// ─── SEO meta injection middleware ────────────────────────────────────────────
const SEO_PAGE_MAP = {
  '/': 'home', '/index.html': 'home',
  '/predictions.html': 'predictions', '/statistics.html': 'statistics',
  '/blog.html': 'blog', '/pricing.html': 'pricing',
  '/about.html': 'about', '/contact.html': 'contact',
  '/terms.html': 'terms', '/privacy.html': 'privacy',
};
let _seoCache = { data: null, at: 0 };
async function getSeoMeta(pageKey) {
  if (!_seoCache.data || Date.now() - _seoCache.at > 300000) {
    try {
      const [rows] = await pool.query('SELECT page_key, title, description FROM seo_settings');
      _seoCache = { data: Object.fromEntries(rows.map(r => [r.page_key, r])), at: Date.now() };
    } catch { _seoCache.at = Date.now(); }
  }
  return _seoCache.data?.[pageKey] || null;
}
const _htmlCache = {};
function readHtmlFile(filePath) {
  if (isProd && _htmlCache[filePath]) return _htmlCache[filePath];
  _htmlCache[filePath] = fs.readFileSync(filePath, 'utf8');
  return _htmlCache[filePath];
}
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

app.use(async (req, res, next) => {
  if (req.method !== 'GET') return next();
  const pageKey = SEO_PAGE_MAP[req.path];
  if (!pageKey) return next();
  const fileName = req.path === '/' ? 'index.html' : req.path.slice(1);
  try {
    let html = readHtmlFile(path.join(__dirname, 'public', fileName));
    const meta = await getSeoMeta(pageKey).catch(() => null);
    if (meta?.title) html = html.replace(/<title>[^<]*<\/title>/, `<title>${esc(meta.title)}</title>`);
    if (meta?.description) html = html.replace(/(<meta name="description" content=")[^"]*(")/i, `$1${esc(meta.description)}$2`);
    // Also update the visible H1 hero title from the DB title
    if (meta?.title) {
      const words = meta.title.trim().split(/\s+/);
      const spanWords = words.length > 3 ? words.slice(-2).join(' ') : words.slice(-1).join(' ');
      const restWords = words.slice(0, words.length - (words.length > 3 ? 2 : 1)).join(' ');
      html = html.replace(
        /<h1 class="page-hero-title">[^<]*<span>[^<]*<\/span><\/h1>/,
        `<h1 class="page-hero-title">${esc(restWords)} <span>${esc(spanWords)}</span></h1>`
      );
    }

    // Inject canonical + OG tags on static pages
    const base = process.env.SITE_URL || 'https://www.predictvilla.com';
    const canonicalPath = req.path === '/index.html' ? '/' : req.path;
    const canonicalUrl = `${base}${canonicalPath}`;
    const titleMatch = html.match(/<title>([^<]*)<\/title>/);
    const titleText = titleMatch ? titleMatch[1] : 'Predictvilla';
    const descMatch = html.match(/<meta name="description" content="([^"]*)"/i);
    const descText = descMatch ? descMatch[1] : '';
    if (!html.includes('rel="canonical"')) {
      html = html.replace('</head>', `<link rel="canonical" href="${canonicalUrl}">
<link rel="alternate" hreflang="en" href="${canonicalUrl}">
<meta property="og:title" content="${titleText}">
<meta property="og:description" content="${descText}">
<meta property="og:url" content="${canonicalUrl}">
<meta property="og:type" content="website">
<meta property="og:image" content="${base}/images/logo.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${titleText}">
<meta name="twitter:description" content="${descText}">
<meta name="twitter:image" content="${base}/images/logo.png">
</head>`);
    } else if (!html.includes('hreflang')) {
      html = html.replace('</head>', `<link rel="alternate" hreflang="en" href="${canonicalUrl}">
</head>`);
    }

    // Inject static header/footer for Googlebot crawlability
    html = await injectStaticShell(html, req.path);

    // Fix 4: SSR today's predictions into the homepage grid
    if (pageKey === 'home') {
      try {
        const [preds] = await pool.query(
          `SELECT p.slug, p.home_team, p.away_team, p.tip, p.odds, p.market, p.match_date,
                  p.result, p.is_vip, p.is_banker, l.name AS league_name
           FROM predictions p LEFT JOIN leagues l ON l.id = p.league_id
           WHERE p.published_at IS NOT NULL AND p.is_vip = 0
             AND DATE(CONVERT_TZ(p.match_date, '+00:00', '+01:00')) = CURDATE()
           ORDER BY p.is_banker DESC, p.intelligence_score DESC LIMIT 9`,
        );
        if (preds.length) {
          const cardsHtml = preds.map(buildPredictionCard).join('');
          html = html.replace(
            '<div class="grid-1" id="predictions-grid"></div>',
            `<div class="grid-1" id="predictions-grid">${cardsHtml}</div>`,
          );
          // Also SSR banker section
          const banker = preds.find(p => p.is_banker);
          if (banker) {
            const bankerHtml = `<div class="card" style="border-color:var(--warning);margin-bottom:0">
              <div class="text-center mb-2"><span class="badge badge-banker">⭐ Banker of the Day</span></div>
              <h2 style="text-align:center;font-size:20px;margin:8px 0">${esc(banker.home_team)} vs ${esc(banker.away_team)}</h2>
              <p class="text-soft text-center" style="font-size:13px">${esc(banker.league_name||'Football')}</p>
              <div class="text-center mt-2"><span class="badge" style="background:rgba(160,208,0,0.15);color:var(--primary);font-size:14px;padding:6px 18px">${esc(banker.tip||'TBD')}</span></div>
              <div class="text-center mt-3"><a href="/prediction/${banker.slug}" class="btn btn-primary">View Banker →</a></div>
            </div>`;
            html = html.replace('<div class="container" id="banker-section"></div>', `<div class="container" id="banker-section">${bankerHtml}</div>`);
          }
        }
      } catch {}
    }

    return res.type('html').send(html);
  } catch { return next(); }
});

// ─── Market filter pages (SEO) ────────────────────────────────────────────────
const MARKET_PAGES = {
  'over-25': {
    title: 'Over 2.5 Goals Predictions Today | Predictvilla',
    description: "Today's best over 2.5 goals predictions with AI-powered analysis. Free and VIP over/under tips updated daily for major leagues.",
    keywords: 'over 2.5 predictions, over 2.5 goals today, over 2.5 tips, football goals predictions',
    label: 'Over 2.5 Goals',
    api: 'Over/Under',
    intro: 'Browse today\'s over 2.5 goals predictions, scored by our AI Intelligence Engine across major football leagues. Each pick includes odds, market confidence and form data to help you decide.',
  },
  'btts': {
    title: 'BTTS Predictions Today | Both Teams to Score | Predictvilla',
    description: "Both teams to score predictions for today's matches. Free BTTS tips with AI intelligence scoring and league statistics.",
    keywords: 'BTTS predictions, both teams to score today, BTTS tips, football BTTS',
    label: 'BTTS',
    api: 'BTTS',
    intro: 'Both Teams to Score predictions for today\'s fixtures, powered by Predictvilla\'s Intelligence Engine. Filter by league or category to find the strongest BTTS picks across Europe and beyond.',
  },
  'correct-score': {
    title: 'Correct Score Predictions Today | Predictvilla',
    description: "Today's correct score predictions powered by AI analysis. High-value correct score tips for major leagues with form and head-to-head data.",
    keywords: 'correct score predictions, correct score tips today, football score predictions, scoreline tips',
    label: 'Correct Score',
    api: 'Correct Score',
    intro: 'Correct score predictions for today\'s matches selected by our Intelligence Engine. These high-value picks are analysed against team form, head-to-head records and scoring patterns.',
  },
  'accumulator': {
    title: 'Accumulator Tips Today | Daily Acca Predictions | Predictvilla',
    description: 'Daily accumulator tips with carefully selected matches. Free and VIP acca predictions updated daily across major football leagues.',
    keywords: 'accumulator tips today, acca predictions, football accumulator, daily acca tips',
    label: 'Accumulator',
    api: 'Accumulator',
    intro: 'Daily accumulator tips handpicked and validated by the Predictvilla Intelligence Engine. Each acca combines value picks across multiple matches — filter by date or category to build your slip.',
  },
  '1x2': {
    title: '1X2 Predictions Today | Win Draw Win Tips | Predictvilla',
    description: "Today's 1X2 match result predictions. Home win, away win and draw tips for major leagues powered by AI analysis.",
    keywords: '1x2 predictions, match result tips, win draw win predictions, 1x2 football tips',
    label: '1X2',
    api: '1X2',
    intro: '1X2 match result predictions for today\'s fixtures. Our Intelligence Engine analyses form, league position and head-to-head data to rate each home win, draw or away win pick.',
  },
  'double-chance': {
    title: 'Double Chance Predictions Today | Predictvilla',
    description: 'Double chance betting predictions for today. Safe and high-probability double chance tips powered by AI intelligence scoring.',
    keywords: 'double chance predictions, double chance tips, safe football tips, double chance betting',
    label: 'Double Chance',
    api: 'Double Chance',
    intro: 'Double chance predictions for today — covering Home/Draw, Away/Draw and Home/Away markets. A safer betting option backed by AI confidence scoring and current form data.',
  },
  'draw-no-bet': {
    title: 'Draw No Bet Predictions Today | Predictvilla',
    description: 'Draw No Bet predictions for today\'s matches. Risk-reduced football tips with AI-powered analysis and intelligence scoring.',
    keywords: 'draw no bet predictions, DNB tips, draw no bet football, risk free football tips',
    label: 'Draw No Bet',
    api: 'Draw No Bet',
    intro: 'Draw No Bet predictions for today\'s fixtures — get your stake back if the match ends level. Each tip is scored by our Intelligence Engine for form, value and market reliability.',
  },
};

let _marketTemplate = null;
function getMarketTemplate() {
  if (!_marketTemplate) _marketTemplate = fs.readFileSync(path.join(__dirname, 'public', 'market-predictions.html'), 'utf8');
  return _marketTemplate;
}

app.get('/predictions/:market', async (req, res) => {
  const meta = MARKET_PAGES[req.params.market];
  if (!meta) return res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
  const canonical = `${process.env.SITE_URL || 'https://www.predictvilla.com'}/predictions/${req.params.market}`;
  let html = getMarketTemplate()
    .replace(/__META_TITLE__/g,   meta.title)
    .replace(/__META_DESC__/g,    meta.description)
    .replace(/__META_KEYWORDS__/g, meta.keywords)
    .replace(/__CANONICAL__/g,    canonical)
    .replace(/__MARKET_SLUG__/g,  req.params.market)
    .replace(/__MARKET_LABEL__/g, meta.label)
    .replace(/__MARKET_API__/g,   meta.api)
    .replace(/__MARKET_INTRO__/g, meta.intro);
  html = await injectStaticShell(html, req.path);
  res.send(html);
});

// ─── League filter pages (SEO) ───────────────────────────────────────────────
let _leaguePredTemplate = null;
function getLeaguePredTemplate() {
  if (!_leaguePredTemplate) _leaguePredTemplate = fs.readFileSync(path.join(__dirname, 'public', 'league-predictions.html'), 'utf8');
  return _leaguePredTemplate;
}

app.get('/league/:slug', async (req, res) => {
  try {
    const [leagues] = await pool.query('SELECT id, name, country, continent FROM leagues WHERE is_active = 1');
    const league = leagues.find(l => leagueSlug(l.name) === req.params.slug);
    if (!league) return res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));

    const base = process.env.SITE_URL || 'https://www.predictvilla.com';
    const canonical = `${base}/league/${req.params.slug}`;
    const title = `${league.name} Predictions Today | Predictvilla`;
    const description = `Today's ${league.name} football predictions with AI-powered analysis. Free and VIP ${league.name} tips updated daily.`;
    const keywords = `${league.name} predictions, ${league.name} tips${league.country ? `, ${league.country} football predictions` : ''}`;

    const leagueBreadcrumbLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: base },
        { '@type': 'ListItem', position: 2, name: 'Predictions', item: `${base}/predictions.html` },
        { '@type': 'ListItem', position: 3, name: `${league.name} Predictions`, item: canonical },
      ],
    });
    let html = getLeaguePredTemplate()
      .replace(/__META_TITLE__/g,    esc(title))
      .replace(/__META_DESC__/g,     esc(description))
      .replace(/__META_KEYWORDS__/g, esc(keywords))
      .replace(/__CANONICAL__/g,     canonical)
      .replace(/__LEAGUE_ID__/g,     league.id)
      .replace(/__LEAGUE_NAME__/g,   esc(league.name))
      .replace(/__LEAGUE_COUNTRY__/g, esc(league.country || ''));
    html = html.replace('</head>', `<link rel="alternate" hreflang="en" href="${canonical}">
<script type="application/ld+json">${leagueBreadcrumbLd}</script>
</head>`);

    html = await injectStaticShell(html, req.path);
    res.type('html').send(html);
  } catch {
    res.status(500).sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ─── Pretty URL rewriting ─────────────────────────────────────────────────────
app.get('/prediction/:slug', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT p.home_team, p.away_team, p.tip, p.odds, p.market, p.match_date, p.slug,
              l.name AS league_name
       FROM predictions p LEFT JOIN leagues l ON l.id = p.league_id
       WHERE p.slug = ? AND p.published_at IS NOT NULL LIMIT 1`,
      [req.params.slug]
    );
    if (!rows.length) return res.sendFile(path.join(__dirname, 'public', 'prediction-detail.html'));
    const p = rows[0];
    const base = process.env.SITE_URL || 'https://www.predictvilla.com';
    const title = `${p.home_team} vs ${p.away_team} Prediction — ${p.league_name || 'Football'} | Predictvilla`;
    const tipStr = p.tip && p.tip !== 'TBD' ? ` Tip: ${p.tip}${p.odds ? ` @ ${p.odds}` : ''}.` : '';
    const description = `${p.home_team} vs ${p.away_team} prediction for ${new Date(p.match_date).toDateString()}.${tipStr} Free football tips from Predictvilla.`;
    const canonical = `${base}/prediction/${p.slug}`;
    const ldJson = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'SportsEvent',
      name: `${p.home_team} vs ${p.away_team}`,
      startDate: p.match_date, sport: 'Football', url: canonical,
      description,
      location: { '@type': 'Place', name: p.league_name || 'Football' },
      competitor: [
        { '@type': 'SportsTeam', name: p.home_team },
        { '@type': 'SportsTeam', name: p.away_team },
      ],
    });
    let html = readHtmlFile(path.join(__dirname, 'public', 'prediction-detail.html'));
    // Build full BreadcrumbList + SportsEvent schema
    const breadcrumbLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: base },
        { '@type': 'ListItem', position: 2, name: 'Predictions', item: `${base}/predictions.html` },
        { '@type': 'ListItem', position: 3, name: `${p.home_team} vs ${p.away_team}`, item: canonical },
      ],
    });
    html = html.replace(
      /<title>[^<]*<\/title>/,
      `<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<link rel="alternate" hreflang="en" href="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="article">
<meta property="og:image" content="${base}/images/logo.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${base}/images/logo.png">
<script type="application/ld+json">${ldJson}</script>
<script type="application/ld+json">${breadcrumbLd}</script>`
    );

    // Fix 3: SSR prediction body so Google reads actual content
    const matchDate = new Date(p.match_date);
    const dateStr = matchDate.toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
    const resultClass = p.result === 'won' ? 'won' : p.result === 'lost' ? 'lost' : 'pending';
    const ssrBody = `<div class="card" id="ssr-detail">
      ${p.is_banker ? '<div class="text-center mb-3"><span class="badge badge-banker" style="font-size:14px;padding:6px 18px">⭐ BANKER OF THE DAY</span></div>' : ''}
      <div class="flex-between mb-3" style="flex-wrap:wrap;gap:10px">
        <div class="league-tag"><span class="material-icons-round" style="font-size:20px">emoji_events</span><strong>${esc(p.league_name || 'Football')}</strong></div>
        <div style="display:flex;gap:8px;align-items:center">
          <span class="badge badge-${resultClass}">${(p.result||'pending').toUpperCase()}</span>
          <span class="text-soft" style="font-size:13px">${esc(dateStr)}</span>
        </div>
      </div>
      <h1 style="font-size:22px;font-weight:800;text-align:center;margin:20px 0">${esc(p.home_team)} vs ${esc(p.away_team)}</h1>
      ${p.tip && p.tip !== 'TBD' ? `<div class="text-center mb-3">
        <span style="font-size:13px;color:var(--text-soft)">Our Prediction</span>
        <div style="margin-top:6px"><span class="badge" style="background:rgba(160,208,0,0.15);color:var(--primary);font-size:16px;padding:8px 24px;border-radius:20px">${esc(p.tip)}</span>
        ${p.odds ? `<span class="text-soft" style="margin-left:10px;font-size:14px">@ ${parseFloat(p.odds).toFixed(2)}</span>` : ''}</div>
      </div>` : ''}
      ${p.analysis ? `<div style="margin-top:16px;padding:16px;background:rgba(173,223,241,0.04);border-radius:10px;font-size:14px;line-height:1.7">${esc(p.analysis)}</div>` : ''}
    </div>
    <div class="skeleton" style="height:300px;border-radius:14px;margin-top:16px" aria-hidden="true"></div>`;

    html = html.replace(
      '<div id="detail-content">\n        <div class="skeleton" style="height:400px;border-radius:14px"></div>\n      </div>',
      `<div id="detail-content">${ssrBody}</div>`
    );

    // Fix 5: inject static header/footer
    html = await injectStaticShell(html, req.path);
    res.type('html').send(html);
  } catch {
    res.sendFile(path.join(__dirname, 'public', 'prediction-detail.html'));
  }
});
app.get('/blog/:slug', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT title, meta_title, meta_description, excerpt, featured_image, slug, published_at, author_name
       FROM blog_posts WHERE slug = ? AND is_published = 1 LIMIT 1`,
      [req.params.slug]
    );
    if (!rows.length) return res.sendFile(path.join(__dirname, 'public', 'blog-post.html'));
    const p = rows[0];
    const base = process.env.SITE_URL || 'https://www.predictvilla.com';
    const canonical = `${base}/blog/${p.slug}`;
    const title = `${p.meta_title || p.title} | Predictvilla`;
    const description = p.meta_description || p.excerpt || `Read ${p.title} on the Predictvilla football predictions blog.`;
    const image = p.featured_image && !p.featured_image.startsWith('data:') ? p.featured_image : `${base}/images/logo.png`;
    let html = readHtmlFile(path.join(__dirname, 'public', 'blog-post.html'));
    html = html.replace(
      '<title>Blog — Predictvilla</title>',
      `<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="article">
<meta property="og:image" content="${esc(image)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">`
    );
    res.type('html').send(html);
  } catch {
    res.sendFile(path.join(__dirname, 'public', 'blog-post.html'));
  }
});
app.get('/terms', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
app.get('/privacy', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/contact', (req, res) => res.sendFile(path.join(__dirname, 'public', 'contact.html')));

// ─── SEO Article Pages (public, indexed by search engines) ───────────────────
app.get('/tips/:slug', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT * FROM seo_article_pages WHERE slug = ? AND is_published = 1 LIMIT 1`,
      [req.params.slug]
    );
    if (!rows.length) return res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
    const p = rows[0];
    const base = process.env.SITE_URL || 'https://www.predictvilla.com';
    const canonical = `${base}/tips/${p.slug}`;
    const title = `${p.title} | Predictvilla`;
    const description = p.meta_description || `${p.title} — Football predictions and tips from Predictvilla.`;
    let html = readHtmlFile(path.join(__dirname, 'public', 'seo-article.html'));
    html = html.replace(
      '<title>Predictvilla — Football Intelligence Predictions</title>',
      `<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${p.meta_keywords ? `<meta name="keywords" content="${esc(p.meta_keywords)}">` : ''}
<link rel="canonical" href="${canonical}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:type" content="article">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${esc(title)}">`
    );
    res.type('html').send(html);
  } catch {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

// ─── Programmatic league × date pages (SEO) ──────────────────────────────────
app.get('/predictions/:league/:date', async (req, res) => {
  try {
    const { league: leagueParam, date: dateParam } = req.params;
    // Validate date format (YYYY-MM-DD or 'today' / 'tomorrow')
    let resolvedDate = dateParam;
    if (dateParam === 'today') {
      resolvedDate = new Date().toISOString().slice(0, 10);
    } else if (dateParam === 'tomorrow') {
      const d = new Date(); d.setDate(d.getDate() + 1);
      resolvedDate = d.toISOString().slice(0, 10);
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
      return res.redirect('/predictions.html');
    }

    const [leagues] = await pool.query('SELECT id, name, country FROM leagues WHERE is_active = 1');
    const league = leagues.find(l => leagueSlug(l.name) === leagueParam);
    if (!league) return res.status(404).sendFile(path.join(__dirname, 'public', 'predictions.html'));

    const base = process.env.SITE_URL || 'https://www.predictvilla.com';
    const dateObj = new Date(resolvedDate);
    const dateLabel = dateObj.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const canonical = `${base}/predictions/${leagueParam}/${resolvedDate}`;
    const title = `${league.name} Predictions ${dateLabel} | Predictvilla`;
    const description = `AI-powered ${league.name} football predictions for ${dateLabel}. Free tips, confidence scores, H2H data and VIP picks.`;
    const keywords = `${league.name} predictions ${dateLabel}, ${league.name} tips today, ${league.country ? league.country + ' football predictions, ' : ''}football tips`;

    const breadcrumbLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Home', item: base },
        { '@type': 'ListItem', position: 2, name: 'Predictions', item: `${base}/predictions.html` },
        { '@type': 'ListItem', position: 3, name: `${league.name} Predictions`, item: `${base}/league/${leagueParam}` },
        { '@type': 'ListItem', position: 4, name: dateLabel, item: canonical },
      ],
    });
    const webpageLd = JSON.stringify({
      '@context': 'https://schema.org', '@type': 'WebPage',
      name: title, description, url: canonical,
      breadcrumb: `${base}/predictions/${leagueParam}/${resolvedDate}`,
    });

    let html = getLeaguePredTemplate()
      .replace(/__META_TITLE__/g,    esc(title))
      .replace(/__META_DESC__/g,     esc(description))
      .replace(/__META_KEYWORDS__/g, esc(keywords))
      .replace(/__CANONICAL__/g,     canonical)
      .replace(/__LEAGUE_ID__/g,     league.id)
      .replace(/__LEAGUE_NAME__/g,   esc(league.name))
      .replace(/__LEAGUE_COUNTRY__/g, esc(league.country || ''));
    html = html.replace('</head>',
      `<link rel="alternate" hreflang="en" href="${canonical}">
<script type="application/ld+json">${breadcrumbLd}</script>
<script type="application/ld+json">${webpageLd}</script>
</head>`);
    // Pass the date to the league page JS via a global var
    html = html.replace('</body>', `<script>window.__PV_DATE__ = ${JSON.stringify(resolvedDate)};</script></body>`);
    html = await injectStaticShell(html, req.path);
    res.type('html').send(html);
  } catch {
    res.status(500).sendFile(path.join(__dirname, 'public', 'predictions.html'));
  }
});

// ─── Prediction votes API ─────────────────────────────────────────────────────
app.get('/api/predictions/:id/votes', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ success: false });
    const [[row]] = await pool.query(
      `SELECT
         COALESCE(SUM(vote_type='home'),0) as home,
         COALESCE(SUM(vote_type='draw'),0) as draw,
         COALESCE(SUM(vote_type='away'),0) as away
       FROM prediction_votes WHERE prediction_id = ?`, [id]
    );
    res.json({ success: true, data: { votes: { home: Number(row.home), draw: Number(row.draw), away: Number(row.away) } } });
  } catch { res.status(500).json({ success: false }); }
});

app.post('/api/predictions/:id/vote', async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { vote } = req.body;
    if (isNaN(id) || !['home','draw','away'].includes(vote)) return res.status(400).json({ success: false, message: 'Invalid vote' });
    const ip = req.ip || req.connection.remoteAddress || '';
    const crypto = require('crypto');
    const ipHash = crypto.createHash('sha256').update(ip + id).digest('hex').slice(0, 64);
    // One vote per IP per prediction
    const [[exists]] = await pool.query('SELECT id FROM prediction_votes WHERE prediction_id=? AND ip_hash=?', [id, ipHash]);
    if (exists) return res.status(409).json({ success: false, message: 'Already voted' });
    await pool.query('INSERT INTO prediction_votes (prediction_id, vote_type, ip_hash) VALUES (?,?,?)', [id, vote, ipHash]);
    const [[row]] = await pool.query(
      `SELECT COALESCE(SUM(vote_type='home'),0) as home, COALESCE(SUM(vote_type='draw'),0) as draw, COALESCE(SUM(vote_type='away'),0) as away
       FROM prediction_votes WHERE prediction_id=?`, [id]
    );
    res.json({ success: true, data: { votes: { home: Number(row.home), draw: Number(row.draw), away: Number(row.away) } } });
  } catch { res.status(500).json({ success: false }); }
});

// ─── Static files ────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public'), {
  maxAge: isProd ? '1y' : 0,
  etag: true,
}));

// ─── Admin path guard ─────────────────────────────────────────────────────────
const ALLOWED_ADMIN = [
  'index.html','dashboard.html','intelligence.html','predictions.html',
  'categories.html','leaderboard.html','blog.html','subscriptions.html',
  'users.html','leagues.html','sync.html','analytics.html','revenue.html',
  'seo.html','pages.html','settings.html','prediction-stats.html',
  'game-browser.html','backlinks.html','ads.html','seo-pages.html',
];
app.get('/admin/:file', (req, res, next) => {
  if (!ALLOWED_ADMIN.includes(req.params.file)) return res.status(403).json({ message: 'Forbidden' });
  next();
});

// ─── 404 ───────────────────────────────────────────────────────────────────────
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'Route not found' });
  }
  res.status(404).sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Global error handler ─────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('[Error]', err.message, err.stack?.split('\n')[1]);
  const msg = isProd ? 'An error occurred.' : err.message;
  res.status(err.status || 500).json({ success: false, message: msg });
});

// ─── Start ────────────────────────────────────────────────────────────────────
async function start() {
  await connectWithRetry();
  app.listen(PORT, () => {
    console.log(`[Server] Predictvilla running on port ${PORT} (${process.env.NODE_ENV})`);
  });
  if (!process.env.pm_id || process.env.pm_id === '0') {
    startScheduler();
  }
}

start().catch(err => {
  console.error('[Start] Fatal error:', err.message);
  process.exit(1);
});

module.exports = app;
