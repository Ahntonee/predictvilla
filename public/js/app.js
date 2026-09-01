/* Predictvilla — Shared Frontend Logic */

// ── Theme (before DOM to prevent flash) ─────────────────────────────────────
(function() {
  const t = localStorage.getItem('ol_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', t);
})();

// ── Constants ────────────────────────────────────────────────────────────────
const API = '';

// ── Auth State ────────────────────────────────────────────────────────────────
function getUser() {
  try { return JSON.parse(localStorage.getItem('ol_user')); } catch { return null; }
}
function setUser(u) { localStorage.setItem('ol_user', JSON.stringify(u)); }
function clearUser() { localStorage.removeItem('ol_user'); }

// ── Toast ─────────────────────────────────────────────────────────────────────
function showToast(message, type = 'info', duration = 4000) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const icons = { success: 'check_circle', error: 'error', info: 'info', warning: 'warning' };
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<span class="material-icons-round" style="font-size:16px">${icons[type] || 'info'}</span><span>${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.animation = 'none'; toast.style.opacity = '0'; toast.style.transform = 'translateY(20px)'; toast.style.transition = 'all 0.3s'; setTimeout(() => toast.remove(), 300); }, duration);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatDate(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}
function formatDateTime(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
function formatMatchDate(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  const date = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `<span style="display:block;font-size:11px;color:var(--text-soft)">${date}</span><span style="display:block;font-size:12px;font-weight:700;color:var(--primary)">${time}</span>`;
}
function formatOdds(o) { return o ? parseFloat(o).toFixed(2) : 'N/A'; }
function timeAgo(dt) {
  const diff = (Date.now() - new Date(dt)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff/60) + 'm ago';
  if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
  return Math.floor(diff/86400) + 'd ago';
}

// ── League Cache ──────────────────────────────────────────────────────────────
let _leagueCache = null, _leagueCacheAt = 0;
async function fetchLeagues() {
  if (_leagueCache && Date.now() - _leagueCacheAt < 300000) return _leagueCache;
  try {
    const r = await fetch('/api/leagues?grouped=true');
    const data = await r.json();
    const leagues = data.data?.leagues || data.leagues || {};
    if (!Object.keys(leagues).length) throw new Error('empty');
    _leagueCache = leagues;
    _leagueCacheAt = Date.now();
    return _leagueCache;
  } catch {
    return { Europe: [
      { id: 1, name: 'Premier League', api_league_id: 39 },
      { id: 2, name: 'La Liga', api_league_id: 140 },
      { id: 3, name: 'Bundesliga', api_league_id: 78 },
      { id: 4, name: 'Serie A', api_league_id: 135 },
      { id: 5, name: 'Ligue 1', api_league_id: 61 },
      { id: 6, name: 'UCL', api_league_id: 2 },
    ]};
  }
}

// ── Stats Cache ───────────────────────────────────────────────────────────────
let _statsCache = null;
async function fetchStats() {
  if (_statsCache) return _statsCache;
  try {
    const r = await fetch('/api/predictions/stats');
    const data = await r.json();
    _statsCache = data.data || {};
    return _statsCache;
  } catch { return {}; }
}

// ── Social Links ──────────────────────────────────────────────────────────────
async function fetchSocialLinks() {
  try {
    const r = await fetch('/api/pages/social-links');
    const data = await r.json();
    return data.data?.links || {};
  } catch { return {}; }
}

// ── Confidence Bar HTML ───────────────────────────────────────────────────────
function buildConfidenceBar(score) {
  if (!score) return '';
  const cls = score >= 80 ? 'conf-high' : score >= 60 ? 'conf-med' : score >= 40 ? 'conf-low' : 'conf-poor';
  return `<div class="confidence-wrap ${cls}">
    <div class="confidence-label"><span>Confidence</span><span>${score}%</span></div>
    <div class="confidence-bar"><div class="confidence-fill" style="--conf-w:${score}%"></div></div>
  </div>`;
}

// ── Intelligence Score SVG ────────────────────────────────────────────────────
function buildIntelligenceGauge(score) {
  if (!score) return '';
  const r = 28, circ = 2 * Math.PI * r;
  const fill = (score / 100) * circ;
  const color = score >= 80 ? '#02f5a1' : score >= 60 ? '#99cc33' : score >= 40 ? '#faf92a' : '#ff4757';
  return `<div class="intelligence-score">
    <svg width="72" height="72" viewBox="0 0 72 72">
      <circle cx="36" cy="36" r="${r}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="5"/>
      <circle cx="36" cy="36" r="${r}" fill="none" stroke="${color}" stroke-width="5"
        stroke-dasharray="${fill} ${circ}" stroke-linecap="round"/>
    </svg>
    <div class="score-num" style="margin-top:-56px">${score}</div>
    <div class="score-label" style="margin-top:4px">AI Score</div>
  </div>`;
}

// ── Mega Acca Card ────────────────────────────────────────────────────────────
function buildAccaCard(p) {
  const lines = (p.analysis || '').split('\n').filter(l => /^\d+\./.test(l));
  const preview = lines.slice(0, 3);
  const remaining = lines.length - preview.length;
  return `<div class="prediction-card acca-card" data-id="${p.id}">
    <div style="text-align:center;margin-bottom:10px">
      <span class="badge badge-banker" style="background:linear-gradient(135deg,var(--primary),#00b4d8);font-size:11px">
        <span class="material-icons-round" style="font-size:12px;vertical-align:middle">auto_awesome</span>
        MEGA ACCUMULATOR
      </span>
    </div>
    <div class="prediction-header">
      <div class="league-tag"><span class="material-icons-round" style="font-size:18px">emoji_events</span><span>Multi-League</span></div>
      <div class="match-date">${formatMatchDate(p.match_date)}</div>
    </div>
    <div style="text-align:center;padding:14px 0 10px">
      <div style="font-size:36px;font-weight:900;color:var(--primary);line-height:1">${parseFloat(p.odds).toFixed(0)}x</div>
      <div style="font-size:12px;color:var(--text-soft);margin-top:2px">Combined Odds</div>
    </div>
    <div style="margin:0 0 12px;padding:10px 12px;background:rgba(2,245,161,0.06);border-radius:10px;border:1px solid rgba(2,245,161,0.12)">
      ${preview.map(l => `<div style="font-size:12px;color:var(--text-soft);padding:2px 0;border-bottom:1px solid rgba(255,255,255,0.04)">${escapeHtml(l)}</div>`).join('')}
      ${remaining > 0 ? `<div style="font-size:12px;color:var(--primary);margin-top:6px">+${remaining} more selections…</div>` : ''}
    </div>
    ${p.confidence_score ? buildConfidenceBar(p.confidence_score) : ''}
    <div class="prediction-footer">
      <span class="badge" style="background:rgba(173,223,241,0.1);color:var(--info)">Accumulator</span>
      <a href="/prediction/${escapeHtml(p.slug || p.id)}" class="btn btn-sm btn-outline">View Full Acca →</a>
    </div>
  </div>`;
}

// ── Team Form ────────────────────────────────────────────────────────────────
function buildFormDots(form, limit) {
  if (!form) return '';
  const chars = limit ? form.slice(0, limit).split('') : form.split('');
  return chars.map(r => {
    const bg = r === 'W' ? '#02f5a1' : r === 'L' ? '#ff4757' : '#faf92a';
    const fg = r === 'D' ? '#07191e' : r === 'L' ? '#fff' : '#07191e';
    return `<span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border-radius:50%;background:${bg};color:${fg};font-size:9px;font-weight:800;line-height:1">${r}</span>`;
  }).join('');
}

// ── Live status helpers ───────────────────────────────────────────────────────
const LIVE_STATUS_SET = new Set(['1H','HT','2H','ET','BT','P','INT','LIVE']);
const FINISHED_STATUS_SET = new Set(['FT','AET','PEN','AWD','WO']);
const LIVE_STATUS_LABEL = { '1H':'1st Half','HT':'Half Time','2H':'2nd Half','ET':'Extra Time','BT':'Break','P':'Penalties','INT':'Interrupted','LIVE':'Live' };

function buildScoreDivider(p) {
  const hasScore = p.home_score !== null && p.home_score !== undefined &&
                   p.away_score !== null && p.away_score !== undefined;
  const isLive = hasScore && LIVE_STATUS_SET.has(p.fixture_status);
  const isFT   = hasScore && FINISHED_STATUS_SET.has(p.fixture_status);

  if (isLive) {
    const label = LIVE_STATUS_LABEL[p.fixture_status] || 'Live';
    const mins  = p.elapsed_minutes ? `${p.elapsed_minutes}'` : '';
    return `<div style="text-align:center">
      <div style="font-size:22px;font-weight:900;color:var(--primary);line-height:1">${p.home_score} - ${p.away_score}</div>
      <div style="display:flex;align-items:center;justify-content:center;gap:4px;margin-top:3px">
        <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#ff4757;animation:livePulse 1s infinite"></span>
        <span style="font-size:10px;font-weight:700;color:#ff4757;text-transform:uppercase;letter-spacing:.5px">${label}${mins ? ' · '+mins : ''}</span>
      </div>
    </div>`;
  }
  if (isFT) {
    return `<div style="text-align:center">
      <div style="font-size:22px;font-weight:900;color:var(--text);line-height:1">${p.home_score} - ${p.away_score}</div>
      <div style="font-size:10px;font-weight:700;color:var(--text-soft);text-transform:uppercase;letter-spacing:.5px;margin-top:3px">FT</div>
    </div>`;
  }
  return `<div class="vs-divider">VS</div>`;
}

// ── Prediction Card ───────────────────────────────────────────────────────────
function buildPredictionCard(p, isVip = false) {
  if (p.source === 'daily_special' && p.market === 'Accumulator') return buildAccaCard(p);
  const isLocked = p.is_vip && !isVip && (p.tip === '🔒 VIP Pick' || p.tip === 'VIP Pick');
  const isBanker = p.is_banker;
  const bookies = (() => { try { return JSON.parse(p.bookies_available || '[]'); } catch { return []; } })();
  const isLive = LIVE_STATUS_SET.has(p.fixture_status) && p.home_score !== null;
  const resultBadge = p.result !== 'pending'
    ? `<span class="badge badge-${p.result}">${p.result.toUpperCase()}</span>`
    : isLive ? `<span class="badge" style="background:rgba(255,71,87,0.15);color:#ff4757;border:1px solid rgba(255,71,87,0.3)"><span style="display:inline-block;width:6px;height:6px;border-radius:50%;background:#ff4757;animation:livePulse 1s infinite;vertical-align:middle;margin-right:4px"></span>LIVE</span>` : '';

  return `<div class="prediction-card ${isBanker ? 'banker-card' : ''} ${p.is_vip && !isBanker ? 'vip-card' : ''}" data-id="${p.id}" data-slug="${escapeHtml(p.slug||String(p.id))}" style="cursor:pointer">
    ${isBanker ? '<div style="text-align:center;margin-bottom:10px"><span class="badge badge-banker"><span class="material-icons-round" style="font-size:12px;vertical-align:middle">star</span> BANKER OF THE DAY</span></div>' : ''}
    ${p.is_vip && !isBanker ? '<div style="text-align:right;margin-bottom:6px"><span class="badge badge-vip">VIP</span></div>' : ''}
    <div class="prediction-header">
      <div class="league-tag">
        ${p.league_logo ? `<img src="${escapeHtml(p.league_logo)}" alt="" loading="lazy">` : '<span class="material-icons-round" style="font-size:18px">emoji_events</span>'}
        <span>${escapeHtml(p.league_name || 'Football')}</span>
      </div>
      <div class="match-date">${formatMatchDate(p.match_date)}</div>
    </div>
    <div class="teams-row">
      <div class="team">
        ${p.home_team_logo ? `<img src="${escapeHtml(p.home_team_logo)}" alt="${escapeHtml(p.home_team)}" loading="lazy">` : '<span class="material-icons-round" style="font-size:28px">sports_soccer</span>'}
        <div class="team-name">${escapeHtml(p.home_team)}</div>
        ${p.home_form ? `<div style="display:flex;gap:2px;justify-content:center;margin-top:4px">${buildFormDots(p.home_form)}</div>` : ''}
      </div>
      ${buildScoreDivider(p)}
      <div class="team">
        ${p.away_team_logo ? `<img src="${escapeHtml(p.away_team_logo)}" alt="${escapeHtml(p.away_team)}" loading="lazy">` : '<span class="material-icons-round" style="font-size:28px">sports_soccer</span>'}
        <div class="team-name">${escapeHtml(p.away_team)}</div>
        ${p.away_form ? `<div style="display:flex;gap:2px;justify-content:center;margin-top:4px">${buildFormDots(p.away_form)}</div>` : ''}
      </div>
    </div>
    <div class="prediction-tip">
      <div><div class="tip-label">Our Pick</div><div class="tip-value">${escapeHtml(p.tip)}</div></div>
      ${p.odds ? `<div><div class="tip-label">Odds</div><div class="odds-value">${formatOdds(p.odds)}</div></div>` : ''}
    </div>
    ${p.confidence_score ? buildConfidenceBar(p.confidence_score) : ''}
    ${bookies.length ? `<div class="bookie-tags">${bookies.slice(0,4).map(b => `<span class="bookie-tag"><span class="odds-live-dot"></span>${escapeHtml(b)}</span>`).join('')}</div>` : ''}
    <div class="prediction-footer">
      <div class="flex gap-1">${resultBadge}${p.market ? `<span class="badge" style="background:rgba(173,223,241,0.1);color:var(--info)">${escapeHtml(p.market)}</span>` : ''}</div>
      <a href="/prediction/${escapeHtml(p.slug || p.id)}" class="btn btn-sm btn-outline">View →</a>
    </div>
    ${isLocked ? `<div class="vip-overlay"><div class="lock-icon"><span class="material-icons-round" style="font-size:36px">lock</span></div><p>VIP Pick — Subscribe to unlock</p><a href="/pricing.html" class="btn btn-vip btn-sm">Unlock VIP</a></div>` : ''}
  </div>`;
}

// ── Banker Cards ──────────────────────────────────────────────────────────────
async function renderBankerCards(container) {
  if (!container) return;
  try {
    const r = await fetch('/api/predictions/bankers');
    const data = await r.json();
    const bankers = data.data?.predictions || [];
    if (!bankers.length) { container.style.display = 'none'; return; }
    container.innerHTML = `<h2 class="section-title"><span class="material-icons-round">star</span> <span>Banker of the Day</span></h2>
      <div class="grid-2">${bankers.map(p => buildPredictionCard(p, true)).join('')}</div>`;
    container.querySelectorAll('.prediction-card').forEach((el, i) => { el.style.animationDelay = `${i * 60}ms`; });
  } catch { container.style.display = 'none'; }
}

// ── VIP Teaser ────────────────────────────────────────────────────────────────
async function renderVipTeaser(container) {
  if (!container) return;
  const user = getUser();
  const isVip = user?.role === 'vip' || user?.role === 'admin';
  try {
    const r = await fetch('/api/predictions?category=vip&limit=3&date=today');
    const data = await r.json();
    const picks = data.data?.predictions || [];
    if (!picks.length) { container.style.display = 'none'; return; }
    container.innerHTML = `<div class="flex-between mb-2">
      <h2 class="section-title mb-0"><span class="material-icons-round">lock</span> <span>VIP Picks</span></h2>
      ${!isVip ? '<a href="/pricing.html" class="btn btn-vip btn-sm">Unlock VIP</a>' : ''}
    </div>
    <div class="grid-3">${picks.map(p => buildPredictionCard(p, isVip)).join('')}</div>`;
  } catch { container.style.display = 'none'; }
}

// ── Recent Wins Sidebar ───────────────────────────────────────────────────────
async function loadRecentWins(containerId = 'recent-wins-list') {
  const el = document.getElementById(containerId);
  if (!el) return;
  try {
    const r = await fetch('/api/predictions/recent-wins');
    const data = await r.json();
    const wins = data.data?.wins || [];
    if (!wins.length) {
      el.innerHTML = '<p style="text-align:center;color:var(--text-soft);padding:32px 0;font-size:13px">No winning tips recorded yet.</p>';
      return;
    }
    const now = Date.now();
    const displayed = wins.slice(0, 10);
    el.innerHTML = displayed.map(w => {
      const matchMs   = new Date(w.match_date).getTime();
      const isJustWon = (now - matchMs) < 86400000;
      const hasScore  = w.home_score !== null && w.away_score !== null;
      const odds      = w.odds ? parseFloat(w.odds).toFixed(2) : null;
      const tip       = w.tip || w.market || '—';
      const matchDate = new Date(w.match_date);
      const dateLabel = matchDate.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
      const timeLabel = matchDate.toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' });
      const wonLabel  = isJustWon ? '⚡ Just Won' : 'WON 🏆';
      const homeLogo  = w.home_team_logo
        ? `<img src="${escapeHtml(w.home_team_logo)}" alt="${escapeHtml(w.home_team)}" class="rw-logo" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="rw-logo-fallback">${escapeHtml(w.home_team[0]||'?')}</div>`;
      const awayLogo  = w.away_team_logo
        ? `<img src="${escapeHtml(w.away_team_logo)}" alt="${escapeHtml(w.away_team)}" class="rw-logo" loading="lazy" onerror="this.style.display='none'">`
        : `<div class="rw-logo-fallback">${escapeHtml(w.away_team[0]||'?')}</div>`;
      const homeForm  = w.home_form ? buildFormDots(w.home_form, 5) : '';
      const awayForm  = w.away_form ? buildFormDots(w.away_form, 5) : '';

      return `<a href="/prediction/${escapeHtml(w.slug)}" class="rw-card">
        <div class="rw-teams-row">
          <div class="rw-team rw-home">
            <span class="rw-team-name">${escapeHtml(w.home_team)}</span>
            <div class="rw-form">${homeForm}</div>
            ${homeLogo}
          </div>
          <div class="rw-score-block">
            ${hasScore
              ? `<span class="rw-score">${w.home_score} - ${w.away_score}</span>`
              : `<span class="rw-vs">VS</span>`}
          </div>
          <div class="rw-team rw-away">
            ${awayLogo}
            <div class="rw-form">${awayForm}</div>
            <span class="rw-team-name">${escapeHtml(w.away_team)}</span>
          </div>
          <div class="rw-won-badge ${isJustWon ? 'rw-just-won' : ''}">
            <span>${wonLabel}</span>
            <span class="rw-won-date">${dateLabel} · ${timeLabel}</span>
          </div>
        </div>
        <div class="rw-picks-row">
          ${odds ? `<span class="rw-pill rw-odds">Odds: <strong>${odds}</strong></span>` : ''}
          <span class="rw-pill rw-tip"><span class="rw-s">S</span> Tip: ${escapeHtml(tip)}</span>
        </div>
      </a>`;
    }).join('');
  } catch {
    el.innerHTML = '<p style="text-align:center;color:var(--text-soft);padding:24px 0;font-size:13px">Could not load wins.</p>';
  }
}

// ── Ticker ────────────────────────────────────────────────────────────────────
async function initTicker() {
  const wrap = document.querySelector('.ticker-track');
  if (!wrap) return;
  try {
    const r = await fetch('/api/predictions?date=today&limit=20');
    const data = await r.json();
    const preds = data.data?.predictions || [];
    if (!preds.length) { document.querySelector('.ticker-wrap')?.style && (document.querySelector('.ticker-wrap').style.display = 'none'); return; }
    const items = preds.map(p => {
      const cls = p.result === 'won' ? 'won' : p.result === 'lost' ? 'lost' : 'pending';
      return `<span class="ticker-item"><strong class="${cls}">${escapeHtml(p.home_team)} vs ${escapeHtml(p.away_team)}</strong> — ${escapeHtml(p.tip)}${p.odds ? ` @ ${formatOdds(p.odds)}` : ''}</span>`;
    });
    const html = items.join('') + items.join(''); // double for seamless loop
    wrap.innerHTML = `<span class="ticker-content">${html}</span>`;
  } catch {}
}

// ── SEO Meta Helpers ─────────────────────────────────────────────────────────
function setMeta(name, content) {
  if (!content) return;
  let el = document.querySelector(`meta[name="${name}"]`);
  if (!el) { el = document.createElement('meta'); el.name = name; document.head.appendChild(el); }
  el.content = content;
}
function setOg(prop, content) {
  if (!content) return;
  let el = document.querySelector(`meta[property="og:${prop}"]`);
  if (!el) { el = document.createElement('meta'); el.setAttribute('property', `og:${prop}`); document.head.appendChild(el); }
  el.content = content;
}
function setCanonical(url) {
  let el = document.querySelector('link[rel="canonical"]');
  if (!el) { el = document.createElement('link'); el.rel = 'canonical'; document.head.appendChild(el); }
  el.href = url;
}
function injectJsonLd(data) {
  let el = document.getElementById('ld-json-dynamic');
  if (!el) {
    el = document.createElement('script');
    el.type = 'application/ld+json';
    el.id = 'ld-json-dynamic';
    document.head.appendChild(el);
  }
  el.textContent = JSON.stringify(data);
}
function setPageMeta({ title, description, image, type = 'website', noindex = false } = {}) {
  const BASE = 'https://predictvilla.com';
  const img = image || `${BASE}/images/logo.webp`;
  const canonical = BASE + window.location.pathname;
  if (title) { document.title = `${title} — Predictvilla`; setOg('title', title); setMeta('twitter:title', title); }
  if (description) { setMeta('description', description); setOg('description', description); setMeta('twitter:description', description); }
  setOg('image', img); setMeta('twitter:image', img);
  setOg('type', type); setOg('url', canonical);
  setMeta('twitter:card', 'summary_large_image');
  setCanonical(canonical);
  if (noindex) setMeta('robots', 'noindex,nofollow');
}

// ── Header / Left Sidebar ─────────────────────────────────────────────────────
async function injectHeader() {
  const target = document.getElementById('header-placeholder');
  const user = getUser();
  const isAdmin = user?.role === 'admin';
  const isVip = user?.role === 'vip';
  const currentPath = window.location.pathname;

  const isActive = href => {
    const base = href.split('?')[0];
    return (base === '/' ? currentPath === '/' : currentPath.startsWith(base.replace('.html', ''))) ? 'active' : '';
  };

  const mainLinks = [
    ['/', 'home', 'Home'],
    ['/predictions.html', 'sports_soccer', 'All Predictions'],
    ['/blog.html', 'article', 'Blog'],
    ['/pricing.html', 'workspace_premium', 'Subscription'],
    ['/bet-builder.html', 'construction', 'Bet Builder'],
    ['/about.html', 'info', 'About Us'],
  ];
  const catLinks = [
    ['/predictions.html', 'tips_and_updates', 'All Tips'],
    ['/predictions.html?cat=over_2_5', 'trending_up', 'Over 2.5'],
    ['/predictions.html?cat=gg', 'sync_alt', 'BTTS'],
    ['/predictions.html?cat=home_win', 'home', 'Home Win'],
    ['/predictions.html?cat=draw', 'remove', 'Draw'],
    ['/predictions.html?cat=away_win', 'flight_takeoff', 'Away Win'],
    ['/predictions.html?cat=under_2_5', 'trending_down', 'Under 2.5'],
    ['/predictions.html?cat=over_1_5', 'add_circle_outline', 'Over 1.5'],
  ];

  const sidebarAuthHtml = user
    ? `<a href="${isAdmin ? '/admin/dashboard.html' : '/dashboard.html'}" class="snav-link">
        <span class="material-icons-round">account_circle</span>${escapeHtml(user.name?.split(' ')[0] || 'Account')}
        ${isVip ? '<span class="badge badge-vip" style="font-size:9px;margin-left:4px">VIP</span>' : ''}
        ${isAdmin ? '<span class="badge" style="font-size:9px;margin-left:4px;background:rgba(0,245,161,.15);color:var(--primary)">Admin</span>' : ''}
      </a>
      <button class="snav-link w-full" id="sidebar-logout" style="background:none;border:none;text-align:left;cursor:pointer;color:rgba(255,71,87,0.8)">
        <span class="material-icons-round">logout</span>Logout
      </button>`
    : `<a href="/pricing.html#login" class="snav-link"><span class="material-icons-round">login</span>Login</a>
       <a href="/pricing.html#register" class="snav-link" style="color:var(--primary)"><span class="material-icons-round">person_add</span>Register</a>`;

  // Build sidebar
  const sidebar = document.createElement('div');
  sidebar.id = 'left-sidebar';
  sidebar.className = 'left-sidebar';
  sidebar.innerHTML = `
    <div class="sidebar-logo-wrap">
      <a href="/" class="sidebar-logo">
        <img src="/images/logo.svg" alt="Predictvilla" onerror="this.style.display='none'">
        <span>Predictvilla</span>
      </a>
      <button class="sidebar-close-btn" id="sidebar-close"><span class="material-icons-round">close</span></button>
    </div>
    <div class="snav-section">
      ${mainLinks.map(([href, icon, label]) => `<a href="${href}" class="snav-link ${isActive(href)}"><span class="material-icons-round">${icon}</span>${label}</a>`).join('')}
      ${isVip || isAdmin ? `<a href="/pricing.html" class="snav-link vip-snav"><span class="material-icons-round">star</span>VIP Picks</a>` : ''}
    </div>
    <div class="snav-section">
      <div class="snav-label">Categories</div>
      ${catLinks.map(([href, icon, label]) => `<a href="${href}" class="snav-link"><span class="material-icons-round">${icon}</span>${label}</a>`).join('')}
    </div>
    <div class="snav-section snav-bottom">
      <div class="snav-label">Account</div>
      ${sidebarAuthHtml}
      <button class="snav-link w-full" id="sidebar-theme-toggle" style="background:none;border:none;text-align:left;cursor:pointer">
        <span class="material-icons-round" id="sidebar-theme-icon">${(localStorage.getItem('ol_theme')||'dark')==='dark'?'light_mode':'dark_mode'}</span>
        <span id="sidebar-theme-label">${(localStorage.getItem('ol_theme')||'dark')==='dark'?'Light Mode':'Dark Mode'}</span>
      </button>
    </div>`;

  // Overlay for mobile
  const overlay = document.createElement('div');
  overlay.id = 'sidebar-overlay';
  overlay.className = 'sidebar-overlay';

  document.body.insertBefore(overlay, document.body.firstChild);
  document.body.insertBefore(sidebar, document.body.firstChild);
  document.body.classList.add('has-sidebar');

  // Top bar (desktop + mobile)
  if (target) {
    const desktopAuthHtml = user
      ? `<a href="${isAdmin ? '/admin/dashboard.html' : '/dashboard.html'}">${escapeHtml(user.name?.split(' ')[0] || 'Account')}</a>`
      : `<a href="/pricing.html#login">Login</a><span class="tb-divider">|</span><a href="/pricing.html#register">Register</a>`;

    target.className = 'topbar';
    target.innerHTML = `
      <div class="topbar-inner">
        <button class="hamburger-btn" id="sidebar-toggle"><span class="material-icons-round">menu</span></button>
        <a href="/" class="topbar-logo">
          <img src="/images/logo.svg" alt="Predictvilla" onerror="this.style.display='none'">
          <span>Predictvilla</span>
        </a>
        <div style="flex:1"></div>
        <a href="/pricing.html" class="vip-premium-btn">
          <span class="prem-top">★ Go Premium</span>
          <span class="prem-sub">GET STARTED FOR FREE</span>
        </a>
        <div class="topbar-auth-links">${desktopAuthHtml}</div>
        <a href="${user ? (isAdmin ? '/admin/dashboard.html' : '/dashboard.html') : '/pricing.html#login'}" class="topbar-auth-icon">
          <span class="material-icons-round">${user ? 'account_circle' : 'login'}</span>
        </a>
      </div>`;
  }

  // ── Events ───────────────────────────────────────────────────────────────
  const toggleSidebar = () => {
    sidebar.classList.toggle('open');
    overlay.classList.toggle('open');
    document.body.classList.toggle('sidebar-open');
  };
  document.getElementById('sidebar-toggle')?.addEventListener('click', toggleSidebar);
  document.getElementById('sidebar-close')?.addEventListener('click', toggleSidebar);
  overlay.addEventListener('click', toggleSidebar);
  document.getElementById('sidebar-logout')?.addEventListener('click', logout);
  document.getElementById('sidebar-theme-toggle')?.addEventListener('click', () => {
    toggleTheme();
    const isDark = (localStorage.getItem('ol_theme')||'dark') === 'dark';
    const icon = document.getElementById('sidebar-theme-icon');
    const label = document.getElementById('sidebar-theme-label');
    if (icon) icon.textContent = isDark ? 'light_mode' : 'dark_mode';
    if (label) label.textContent = isDark ? 'Light Mode' : 'Dark Mode';
  });

  // Inject ticker into existing sidebar section
  const tickerWrap = document.createElement('div');
  tickerWrap.className = 'ticker-wrap';
  tickerWrap.innerHTML = `<div class="container"><div class="ticker-inner"><span class="ticker-label">LIVE</span><div class="ticker-track"></div></div></div>`;
  if (target) target.appendChild(tickerWrap);
  initTicker();
}

function toggleAvatarMenu() {
  document.getElementById('avatar-dropdown')?.classList.toggle('open');
}

function toggleAvatarMenu() {
  document.getElementById('avatar-dropdown')?.classList.toggle('open');
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('ol_theme', next);
  const icon = document.getElementById('theme-icon');
  if (icon) icon.textContent = next === 'light' ? 'dark_mode' : 'light_mode';
}

function toggleMobileMenu() {
  const nav = document.getElementById('main-nav');
  if (nav) nav.classList.toggle('mobile-open');
}

async function logout() {
  await fetch('/api/auth/logout', { method: 'POST' });
  clearUser();
  window.location.href = '/';
}

// ── Footer ────────────────────────────────────────────────────────────────────
async function injectFooter() {
  const target = document.getElementById('footer-placeholder');
  if (!target) return;

  const [links, backlinksRes] = await Promise.all([
    fetchSocialLinks(),
    fetch('/api/backlinks/public').then(r=>r.json()).catch(()=>({ data: { backlinks: [] } })),
  ]);

  const backlinks = backlinksRes?.data?.backlinks || [];

  const socialIcons = {
    social_twitter:  { icon: '𝕏', label: 'X' },
    social_telegram: { icon: '✈', label: 'Telegram' },
    social_facebook: { icon: 'f', label: 'Facebook' },
    social_whatsapp: { icon: '📱', label: 'WhatsApp' },
  };
  const socialHtml = Object.entries(links).filter(([,v])=>v).map(([k,v]) => {
    const s = socialIcons[k] || { icon: '🔗', label: k };
    return `<a href="${escapeHtml(v)}" target="_blank" rel="noopener" class="footer-social-icon" title="${s.label}">${s.icon}</a>`;
  }).join('');

  const settings = window._siteSettings || {};
  const email     = settings.contact_email    || '';
  const whatsapp  = links.social_whatsapp     || '';
  const telegram  = links.social_telegram     || '';

  const backlinksSection = backlinks.length ? `
    <div class="footer-backlinks-row">
      <span class="footer-backlinks-label">Partner Sites:</span>
      ${backlinks.map(l => `<a href="${escapeHtml(l.url)}" target="_blank" rel="noopener nofollow" class="footer-backlink">${escapeHtml(l.keyword)}</a>`).join('')}
    </div>` : '';

  target.innerHTML = `<footer class="site-footer">
    <div class="footer-main">
      <div class="container">
        <div class="footer-grid-new">

          <div class="footer-brand-col">
            <img src="/images/logo.svg" alt="Predictvilla" class="footer-logo" onerror="this.style.display='none'">
            <p class="footer-desc">Predictvilla is an online service that provides the most accurate football prediction, soccer betting tips as well as news to its users.</p>
            <div class="footer-socials">${socialHtml}</div>
          </div>

          <div class="footer-links-col">
            <h4 class="footer-col-title">Business Links</h4>
            <a href="/pricing.html">VIP Packages</a>
            <a href="/predictions.html">Recent Winning</a>
            <a href="/about.html">About Us</a>
            <a href="/blog.html">Partners</a>
            <a href="/contact.html">Contact us</a>
          </div>

          <div class="footer-links-col">
            <h4 class="footer-col-title">Other Links</h4>
            <a href="/blog.html">Blog</a>
            <a href="/about.html#disclaimer">Disclaimer</a>
            <a href="/privacy.html">Privacy Policy</a>
            <a href="/terms.html">Terms and Conditions</a>
            <a href="#" onclick="event.preventDefault();openCookiePreferences()">Cookie Preferences</a>
          </div>

          <div class="footer-links-col footer-predictions-col">
            <h4 class="footer-col-title">Predictions by Day</h4>
            <a href="/predictions.html">Monday Football Predictions</a>
            <a href="/predictions.html">Tuesday Football Predictions</a>
            <a href="/predictions.html">Wednesday Football Predictions</a>
            <a href="/predictions.html">Thursday Football Predictions</a>
            <a href="/predictions.html">Friday Football Predictions</a>
            <a href="/predictions.html">Saturday Football Predictions</a>
            <a href="/predictions.html">Sunday Football Predictions</a>
          </div>

          <div class="footer-links-col">
            <h4 class="footer-col-title">Contact</h4>
            ${email ? `<span class="footer-contact-item"><strong>Email:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></span>` : ''}
            ${whatsapp ? `<span class="footer-contact-item"><strong>WhatsApp:</strong> <a href="${escapeHtml(whatsapp)}" target="_blank">${escapeHtml(whatsapp.replace('https://wa.me/',''))}</a></span>` : ''}
            ${telegram ? `<span class="footer-contact-item"><strong>Telegram:</strong> <a href="${escapeHtml(telegram)}" target="_blank">Join Channel</a></span>` : ''}
            <span class="footer-contact-item" style="margin-top:10px;display:block">
              <strong style="font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:var(--text-soft)">Textlink/Guestpost Placement:</strong><br>
              <a href="/contact.html" style="color:var(--primary);font-weight:600">Contact via Telegram</a>
            </span>
          </div>

        </div>
      </div>
    </div>

    ${backlinks.length ? `<div class="footer-backlinks-wrap"><div class="container">${backlinksSection}</div></div>` : ''}

    <div class="footer-bottom-bar">
      <div class="container">
        <p>&copy; ${new Date().getFullYear()} Predictvilla &bull; For entertainment only. Please gamble responsibly.</p>
        <div class="footer-bottom-socials">${socialHtml}</div>
      </div>
    </div>
  </footer>`;
}

// ── Ads Renderer ─────────────────────────────────────────────────────────────
async function renderAds(position, container) {
  if (!container) return;
  // Suppress wide banner/inline ads on small screens — they blow the layout
  const inlinePositions = ['homepage_mid', 'predictions_top', 'predictions_bottom', 'predictions_mid'];
  if (window.innerWidth <= 640 && inlinePositions.includes(position)) {
    container.style.display = 'none';
    return;
  }
  try {
    const r = await fetch(`/api/ads/position/${encodeURIComponent(position)}`);
    if (!r.ok) return;
    const data = await r.json();
    const ads = data?.data?.ads || [];
    if (!ads.length) { container.style.display = 'none'; return; }

    container.innerHTML = ads.map(ad => {
      if (ad.type === 'code') {
        return `<div class="ad-slot ad-code" data-id="${ad.id}">${ad.code}</div>`;
      }
      if (ad.type === 'native') {
        return `<a class="ad-slot ad-native" href="${ad.link_url||'#'}" target="_blank" rel="nofollow noopener" data-id="${ad.id}" onclick="trackAdClick(${ad.id})">
          ${ad.image_url ? `<img src="${ad.image_url}" alt="${ad.alt_text||'Sponsored'}" class="ad-native-img">` : ''}
          <div class="ad-native-body">
            <span class="ad-label">Sponsored</span>
            <p class="ad-native-name">${ad.name}</p>
          </div>
        </a>`;
      }
      if (ad.type === 'link') {
        return `<a class="ad-slot ad-link" href="${ad.link_url||'#'}" target="_blank" rel="nofollow noopener" data-id="${ad.id}" onclick="trackAdClick(${ad.id})">
          <span class="ad-label">Ad</span> ${ad.name}
        </a>`;
      }
      // banner (default)
      return `<a class="ad-slot ad-banner" href="${ad.link_url||'#'}" target="_blank" rel="nofollow noopener" data-id="${ad.id}" onclick="trackAdClick(${ad.id})" style="display:block;max-width:100%;overflow:hidden">
        <img src="${ad.image_url}" alt="${ad.alt_text||ad.name}" style="width:100%;height:auto;max-width:${ad.width||468}px;display:block" loading="lazy">
      </a>`;
    }).join('');
  } catch {}
}

function trackAdClick(id) {
  fetch(`/api/ads/${id}/click`, { method: 'POST' }).catch(() => {});
}

// ── AdSense Inject ────────────────────────────────────────────────────────────
async function injectAdSense() {
  try {
    const r = await fetch('/api/admin/settings');
    const data = await r.json();
    const clientId = data.data?.settings?.adsense_client_id;
    if (clientId) {
      const s = document.createElement('script');
      s.async = true;
      s.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(clientId)}`;
      s.crossOrigin = 'anonymous';
      document.head.appendChild(s);
    }
  } catch {}
}

// ── Page Init ─────────────────────────────────────────────────────────────────
let _initPageDone = false;
async function initPage() {
  if (_initPageDone) return;
  _initPageDone = true;
  await injectHeader();
  await injectFooter();
  injectAdSense();

  // Fetch auth state from server to sync localStorage
  try {
    const r = await fetch('/api/auth/me');
    if (r.ok) {
      const data = await r.json();
      if (data.data?.user) setUser(data.data.user);
    } else if (r.status === 401) {
      clearUser();
    }
  } catch {}
}

// ── Prediction Row (VP-style 3-column layout) ─────────────────────────────────
function buildPredictionRow(p, isVip = false) {
  const isLocked = p.is_vip && !isVip;
  const isFT = FINISHED_STATUS_SET.has(p.fixture_status);
  const isLive = LIVE_STATUS_SET.has(p.fixture_status) && p.home_score !== null;
  const resultClass = p.result === 'won' ? 'result-won' : p.result === 'lost' ? 'result-lost' : isLive ? 'result-live' : '';

  const matchDate = new Date(p.match_date);
  const timeStr = matchDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const hasScore = (isFT || isLive) && p.home_score !== null;
  const tipText = isLocked ? 'VIP Only' : (p.tip || p.market || '—');
  const oddVal = p.odds ? parseFloat(p.odds).toFixed(2) : null;
  const homeInitial = (p.home_team || '?')[0].toUpperCase();
  const awayInitial = (p.away_team || '?')[0].toUpperCase();

  let centerTop = '';
  if (hasScore) {
    centerTop = `<div class="vp-score-chip">${p.home_score}–${p.away_score}</div>
      ${isLive
        ? `<span class="vp-live-label">${p.elapsed_minutes ? p.elapsed_minutes + "'" : 'LIVE'}</span>`
        : `<span class="vp-ft-label">FT</span>`}`;
  } else {
    centerTop = `<div class="vp-time-chip"><span class="material-icons-round" style="font-size:11px">schedule</span>${timeStr}</div>`;
  }

  return `<a href="/prediction/${escapeHtml(p.slug || p.id)}" class="pred-row-vp ${resultClass}" data-id="${p.id}">
    <div class="vp-team">
      ${p.home_team_logo
        ? `<img src="${escapeHtml(p.home_team_logo)}" alt="" loading="lazy" class="vp-team-logo" onerror="this.style.display='none'">`
        : `<div class="vp-team-logo-ph">${homeInitial}</div>`}
      <div class="vp-team-info">
        <span class="vp-team-name">${escapeHtml(p.home_team)}</span>
        ${p.home_form ? `<div class="vp-form">${buildFormDots(p.home_form, 5)}</div>` : ''}
      </div>
    </div>
    <div class="vp-center">
      ${centerTop}
      <div class="vp-odds-tips">
        ${oddVal ? `<div class="vp-odds-pill"><span class="vp-odds-label">ODDS</span><span class="vp-odds-val">${oddVal}</span></div>` : ''}
        ${isLocked
          ? `<div class="vp-locked-pill">🔒 VIP</div>`
          : `<div class="vp-tips-pill">${escapeHtml(tipText)}</div>`}
      </div>
    </div>
    <div class="vp-team vp-away">
      <div class="vp-team-info vp-away-info">
        <span class="vp-team-name">${escapeHtml(p.away_team)}</span>
        ${p.away_form ? `<div class="vp-form">${buildFormDots(p.away_form, 5)}</div>` : ''}
      </div>
      ${p.away_team_logo
        ? `<img src="${escapeHtml(p.away_team_logo)}" alt="" loading="lazy" class="vp-team-logo" onerror="this.style.display='none'">`
        : `<div class="vp-team-logo-ph">${awayInitial}</div>`}
    </div>
  </a>`;
}

// ── Prediction Grid ───────────────────────────────────────────────────────────
async function loadPredictions(params = {}, container, append = false) {
  if (!container) return;
  const user = getUser();
  const isVip = user?.role === 'vip' || user?.role === 'admin';
  const qs = new URLSearchParams({ date: 'today', limit: 20, ...params }).toString();

  if (!append) {
    container.innerHTML = `<div class="pred-list-grouped">${`<div class="pred-row-skeleton skeleton" style="height:70px;border-radius:8px;margin-bottom:8px"></div>`.repeat(6)}</div>`;
  }

  try {
    const r = await fetch(`/api/predictions?${qs}`);
    const data = await r.json();
    let preds = data.data?.predictions || [];
    let pagination = data.data?.pagination || {};
    let upcomingBanner = '';

    // Today is empty — try tomorrow, then day-after, for a 3-day window
    if (!preds.length && !append && (params.date === 'today' || !params.date)) {
      for (const fallbackDate of ['tomorrow', 2, 3]) {
        const dateParam = typeof fallbackDate === 'number'
          ? new Date(Date.now() + fallbackDate * 86400000).toISOString().slice(0, 10)
          : fallbackDate;
        const fqs = new URLSearchParams({ date: 'today', limit: 20, ...params, date: dateParam }).toString();
        const r2 = await fetch(`/api/predictions?${fqs}`);
        const d2 = await r2.json();
        const next = d2.data?.predictions || [];
        if (next.length) {
          preds = next;
          pagination = d2.data?.pagination || {};
          const label = fallbackDate === 'tomorrow' ? 'Tomorrow' : `${fallbackDate} days away`;
          upcomingBanner = `<div class="upcoming-notice"><span class="material-icons-round" style="font-size:16px;vertical-align:middle">event</span> No predictions today — showing <strong>${label}'s picks</strong></div>`;
          break;
        }
      }
    }

    if (!preds.length && !append) {
      container.innerHTML = `<div class="empty-state">
        <div class="empty-icon"><span class="material-icons-round" style="font-size:48px;color:var(--primary)">sports_soccer</span></div>
        <h3>No predictions yet</h3>
        <p>Predictions are published daily. Check back soon or <a href="/predictions.html" style="color:var(--primary)">view all picks →</a></p>
      </div>`;
      return pagination;
    }

    // Group predictions by league
    const groups = {};
    preds.forEach(p => {
      const key = p.league_name || 'Other';
      if (!groups[key]) groups[key] = { logo: p.league_logo || '', country: p.country || '', preds: [] };
      groups[key].preds.push(p);
    });
    const rows = Object.entries(groups).map(([name, g]) => {
      const countryPart = g.country ? `<span style="margin-right:2px;opacity:.7">${escapeHtml(g.country)}:</span>` : '';
      return `<div class="league-group">
        <div class="league-group-header">
          ${g.logo ? `<img src="${escapeHtml(g.logo)}" alt="">` : '<span class="material-icons-round" style="font-size:14px">emoji_events</span>'}
          <span>${countryPart}${escapeHtml(name)}</span>
        </div>
        ${g.preds.map(p => buildPredictionRow(p, isVip)).join('')}
      </div>`;
    }).join('');

    if (append) {
      let list = container.querySelector('.pred-list-grouped');
      if (!list) { list = document.createElement('div'); list.className = 'pred-list-grouped'; container.appendChild(list); }
      list.insertAdjacentHTML('beforeend', rows);
    } else {
      container.innerHTML = `${upcomingBanner}<div class="pred-list-grouped">${rows}</div>`;
    }
    return pagination;
  } catch (err) {
    if (!append) container.innerHTML = `<p class="text-soft text-center">Failed to load predictions</p>`;
    return {};
  }
}

// Auto-init on DOM ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPage);
} else {
  initPage();
}

// ─── Cookie Consent ──────────────────────────────────────────────────────────
(function () {
  const COOKIE_KEY = 'ol_cookie_consent';

  function getConsent() {
    try { return JSON.parse(localStorage.getItem(COOKIE_KEY)); } catch { return null; }
  }
  function saveConsent(analytics) {
    localStorage.setItem(COOKIE_KEY, JSON.stringify({ analytics, ts: Date.now() }));
  }

  function injectStyles() {
    const s = document.createElement('style');
    s.textContent = `
      #ol-cookie-banner{position:fixed;bottom:0;left:0;right:0;z-index:99999;background:var(--bg-card,#0d2233);border-top:1px solid rgba(2,245,161,0.18);padding:18px 24px;display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;box-shadow:0 -4px 24px rgba(0,0,0,0.4)}
      #ol-cookie-banner p{margin:0;font-size:13px;color:var(--text-soft,#addff1);flex:1;min-width:200px}
      #ol-cookie-banner a{color:var(--primary,#02f5a1);text-decoration:underline}
      .ol-cb-btns{display:flex;gap:10px;flex-wrap:wrap}
      .ol-cb-btns button{padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none;white-space:nowrap}
      .ol-btn-manage{background:transparent;border:1px solid rgba(173,223,241,0.3)!important;color:var(--text,#e8f4f8)}
      .ol-btn-reject{background:rgba(173,223,241,0.08);color:var(--text-soft,#addff1)}
      .ol-btn-accept{background:var(--primary,#02f5a1);color:#07191e}
      #ol-cookie-overlay{position:fixed;inset:0;z-index:100000;background:rgba(0,0,0,0.7);display:flex;align-items:center;justify-content:center;padding:16px}
      #ol-cookie-modal{background:var(--bg-card,#0d2233);border:1px solid rgba(2,245,161,0.18);border-radius:16px;max-width:520px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,0.6)}
      #ol-cookie-modal .cm-head{padding:24px 24px 0;display:flex;align-items:center;gap:14px;border-bottom:1px solid rgba(255,255,255,0.07);padding-bottom:16px}
      #ol-cookie-modal .cm-head img{height:36px;object-fit:contain}
      #ol-cookie-modal .cm-head h2{margin:0;font-size:18px;font-weight:800;color:var(--text,#e8f4f8)}
      #ol-cookie-modal .cm-body{padding:20px 24px}
      #ol-cookie-modal .cm-body p{font-size:13px;color:var(--text-soft,#addff1);margin:0 0 16px;line-height:1.7}
      #ol-cookie-modal .cm-body a{color:var(--primary,#02f5a1)}
      .cm-cookie-row{border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:14px 16px;margin-bottom:12px}
      .cm-cookie-row h4{margin:0 0 4px;font-size:14px;font-weight:700;color:var(--text,#e8f4f8);display:flex;justify-content:space-between;align-items:center}
      .cm-cookie-row p{margin:0;font-size:12px;color:var(--text-soft,#addff1);line-height:1.6}
      .cm-badge-on{font-size:11px;font-weight:700;padding:2px 10px;border-radius:20px;background:rgba(2,245,161,0.15);color:var(--primary,#02f5a1)}
      .cm-toggle{position:relative;width:40px;height:22px;flex-shrink:0}
      .cm-toggle input{opacity:0;width:0;height:0;position:absolute}
      .cm-toggle-slider{position:absolute;inset:0;border-radius:22px;background:rgba(255,255,255,0.1);cursor:pointer;transition:.3s}
      .cm-toggle input:checked+.cm-toggle-slider{background:var(--primary,#02f5a1)}
      .cm-toggle-slider::before{content:'';position:absolute;width:16px;height:16px;border-radius:50%;background:#fff;bottom:3px;left:3px;transition:.3s}
      .cm-toggle input:checked+.cm-toggle-slider::before{transform:translateX(18px)}
      #ol-cookie-modal .cm-footer{padding:16px 24px 24px;display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;border-top:1px solid rgba(255,255,255,0.07)}
      #ol-cookie-modal .cm-footer button{padding:10px 20px;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer;border:none}
    `;
    document.head.appendChild(s);
  }

  function showBanner() {
    const banner = document.createElement('div');
    banner.id = 'ol-cookie-banner';
    banner.innerHTML = `
      <p>We use cookies to keep Predictvilla running and to improve your experience with personalised football tips. <a href="/privacy.html">Privacy Policy</a></p>
      <div class="ol-cb-btns">
        <button class="ol-btn-manage" id="ol-manage-btn">Manage Cookies</button>
        <button class="ol-btn-reject" id="ol-reject-btn">Reject Optional</button>
        <button class="ol-btn-accept" id="ol-accept-btn">Accept All</button>
      </div>`;
    document.body.appendChild(banner);
    document.getElementById('ol-accept-btn').addEventListener('click', () => { saveConsent(true); banner.remove(); });
    document.getElementById('ol-reject-btn').addEventListener('click', () => { saveConsent(false); banner.remove(); });
    document.getElementById('ol-manage-btn').addEventListener('click', () => { banner.remove(); showModal(); });
  }

  function showModal() {
    const overlay = document.createElement('div');
    overlay.id = 'ol-cookie-overlay';
    overlay.innerHTML = `
      <div id="ol-cookie-modal">
        <div class="cm-head">
          <img src="/images/logo.svg" alt="Predictvilla">
          <h2>Cookie Preferences</h2>
        </div>
        <div class="cm-body">
          <p>Predictvilla uses cookies to deliver accurate football predictions, keep your account secure, and improve the tips we show you. Choose which cookies you're happy with below.</p>

          <div class="cm-cookie-row">
            <h4>Essential Cookies <span class="cm-badge-on">Always On</span></h4>
            <p>Required for the site to function — login sessions, security, and displaying predictions. These cannot be disabled.</p>
          </div>

          <div class="cm-cookie-row">
            <h4>Analytics Cookies
              <label class="cm-toggle"><input type="checkbox" id="cm-analytics-chk"><span class="cm-toggle-slider"></span></label>
            </h4>
            <p>Help us understand which predictions users find most useful, which leagues are most popular, and how to improve our intelligence engine's accuracy.</p>
          </div>

          <div class="cm-cookie-row">
            <h4>Personalisation Cookies
              <label class="cm-toggle"><input type="checkbox" id="cm-personal-chk"><span class="cm-toggle-slider"></span></label>
            </h4>
            <p>Remember your favourite leagues, preferred markets (e.g. Over/Under vs 1X2), and date filters so your predictions list is always relevant.</p>
          </div>

          <p style="font-size:12px;margin-top:4px">You can update these preferences at any time from the site footer. See our <a href="/privacy.html">Privacy Policy</a> for full details.</p>
        </div>
        <div class="cm-footer">
          <button id="cm-reject-btn" style="background:rgba(173,223,241,0.08);color:var(--text-soft,#addff1)">Reject Optional</button>
          <button id="cm-save-btn" style="background:rgba(2,245,161,0.12);color:var(--primary,#02f5a1)">Save Preferences</button>
          <button id="cm-accept-btn" style="background:var(--primary,#02f5a1);color:#07191e">Accept All</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const consent = getConsent();
    if (consent?.analytics) {
      document.getElementById('cm-analytics-chk').checked = true;
      document.getElementById('cm-personal-chk').checked = true;
    }

    document.getElementById('cm-accept-btn').addEventListener('click', () => { saveConsent(true); overlay.remove(); });
    document.getElementById('cm-reject-btn').addEventListener('click', () => { saveConsent(false); overlay.remove(); });
    document.getElementById('cm-save-btn').addEventListener('click', () => {
      const analytics = document.getElementById('cm-analytics-chk').checked || document.getElementById('cm-personal-chk').checked;
      saveConsent(analytics);
      overlay.remove();
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  }

  window.openCookiePreferences = showModal;

  injectStyles();
  if (!getConsent()) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBanner);
    else showBanner();
  }
})();

// ── Prediction Detail Modal ───────────────────────────────────────────────────
(function () {
  let overlay;

  function injectModal() {
    if (document.getElementById('pred-detail-overlay')) return;
    overlay = document.createElement('div');
    overlay.id = 'pred-detail-overlay';
    overlay.className = 'pred-detail-overlay';
    overlay.innerHTML = `
      <div class="pred-detail-modal" id="pred-detail-modal">
        <button class="pdm-close" id="pdm-close" aria-label="Close">&#x2715;</button>
        <div id="pdm-content"><div style="padding:60px;text-align:center"><div class="skeleton" style="height:200px;border-radius:12px"></div></div></div>
      </div>`;
    document.body.appendChild(overlay);
    document.getElementById('pdm-close').addEventListener('click', closeDetail);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeDetail(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDetail(); });
  }

  function closeDetail() {
    if (!overlay) return;
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }

  function fmtForm(formStr, last = 5) {
    if (!formStr) return '';
    return [...formStr].slice(-last).map(c => `<span class="pdm-form-badge ${c}">${c}</span>`).join('');
  }

  function statBar(homeVal, awayVal, label) {
    const h = parseFloat(homeVal) || 0;
    const a = parseFloat(awayVal) || 0;
    const total = h + a || 1;
    const homePct = Math.round(h / total * 100);
    const awayPct = 100 - homePct;
    return `<div class="pdm-stat-row">
      <div class="pdm-stat-label">${label}</div>
      <div class="pdm-stat-bar-wrap">
        <span class="pdm-stat-val home" style="color:var(--primary)">${h % 1 === 0 ? h : h.toFixed(2)}</span>
        <div class="pdm-stat-bar">
          <div class="pdm-stat-bar-home" style="width:${homePct}%"></div>
          <div class="pdm-stat-bar-away" style="width:${awayPct}%"></div>
        </div>
        <span class="pdm-stat-val away" style="color:#ef4444">${a % 1 === 0 ? a : a.toFixed(2)}</span>
      </div>
    </div>`;
  }

  async function openDetail(slug) {
    injectModal();
    overlay.classList.add('open');
    document.body.style.overflow = 'hidden';
    document.getElementById('pdm-content').innerHTML =
      '<div style="padding:60px;text-align:center"><div class="skeleton" style="height:180px;border-radius:12px;margin-bottom:16px"></div><div class="skeleton" style="height:120px;border-radius:12px"></div></div>';

    try {
      const r = await fetch(`/api/predictions/${slug}/detail`);
      const data = await r.json();
      if (!data.success) throw new Error(data.message);
      renderDetail(data.data);
    } catch (e) {
      document.getElementById('pdm-content').innerHTML =
        `<div style="padding:40px;text-align:center;color:var(--text-soft)">Could not load prediction details.</div>`;
    }
  }

  function renderDetail({ prediction: p, h2h, homeStats, awayStats, standings }) {
    const hasScore = p.home_score !== null && p.away_score !== null;
    const isLive   = LIVE_STATUS_SET && LIVE_STATUS_SET.has(p.fixture_status) && hasScore;
    const statusLabel = hasScore
      ? (p.fixture_status === 'FT' || !isLive ? 'FT' : p.fixture_status + (p.elapsed_minutes ? ` ${p.elapsed_minutes}'` : ''))
      : '';

    // H2H summary
    let homeW = 0, draws = 0, awayW = 0;
    h2h.forEach(m => { if (m.result === 'H') homeW++; else if (m.result === 'A') awayW++; else draws++; });

    const teamLogoHtml = (logo, name, form) => logo
      ? `<img src="${escapeHtml(logo)}" alt="${escapeHtml(name)}" loading="lazy">`
      : `<span class="material-icons-round pdm-team-icon">sports_soccer</span>`;

    const content = `
      <div class="pdm-header">
        <div class="pdm-league-row">
          <span>${p.league_logo ? `<img src="${escapeHtml(p.league_logo)}" alt="">` : ''}${escapeHtml(p.league_name || '')} · ${escapeHtml(p.country || '')}</span>
          <span>${formatMatchDate ? formatMatchDate(p.match_date) : ''}</span>
        </div>
        <div class="pdm-teams-row">
          <div class="pdm-team">
            ${teamLogoHtml(p.home_team_logo, p.home_team)}
            <div class="pdm-team-name">${escapeHtml(p.home_team)}</div>
            <div class="pdm-form-row">${fmtForm(p.home_form)}</div>
          </div>
          <div class="pdm-score-col">
            ${hasScore
              ? `<div class="pdm-score">${p.home_score} : ${p.away_score}</div><div class="pdm-status">${statusLabel}</div>`
              : `<div class="pdm-score-vs">VS</div>`}
            <div class="pdm-date">${new Date(p.match_date).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}</div>
          </div>
          <div class="pdm-team">
            ${teamLogoHtml(p.away_team_logo, p.away_team)}
            <div class="pdm-team-name">${escapeHtml(p.away_team)}</div>
            <div class="pdm-form-row">${fmtForm(p.away_form)}</div>
          </div>
        </div>
      </div>

      <div class="pdm-tip-bar">
        <div><div class="pdm-tip-label">Our Pick</div><div class="pdm-tip-value">${escapeHtml(p.tip)}</div></div>
        ${p.market ? `<div class="pdm-tip-divider"></div><div><div class="pdm-tip-label">Market</div><div class="pdm-tip-value" style="color:var(--text)">${escapeHtml(p.market)}</div></div>` : ''}
        ${p.odds ? `<div class="pdm-tip-divider"></div><div><div class="pdm-tip-label">Odds</div><div class="pdm-tip-value">${parseFloat(p.odds).toFixed(2)}</div></div>` : ''}
        ${p.confidence_score ? `<div class="pdm-tip-divider"></div><div><div class="pdm-tip-label">Confidence</div><div class="pdm-tip-value">${p.confidence_score}%</div></div>` : ''}
      </div>

      <div class="pdm-body">
        <div class="pdm-grid">
          <!-- H2H -->
          <div class="pdm-section">
            <div class="pdm-section-head"><span class="material-icons-round" style="font-size:16px">swap_horiz</span>Head to Head</div>
            <div class="pdm-section-body">
              ${h2h.length ? `
                <div class="pdm-h2h-summary">
                  <div class="pdm-h2h-sum-item"><div class="pdm-h2h-sum-num" style="color:var(--primary)">${homeW}</div><div class="pdm-h2h-sum-lbl">${escapeHtml(p.home_team.split(' ')[0])}</div></div>
                  <div class="pdm-h2h-sum-item"><div class="pdm-h2h-sum-num" style="color:var(--text-soft)">${draws}</div><div class="pdm-h2h-sum-lbl">Draws</div></div>
                  <div class="pdm-h2h-sum-item"><div class="pdm-h2h-sum-num" style="color:#ef4444">${awayW}</div><div class="pdm-h2h-sum-lbl">${escapeHtml(p.away_team.split(' ')[0])}</div></div>
                </div>
                ${h2h.map(m => `
                  <div class="pdm-h2h-row">
                    <span class="pdm-h2h-date">${m.date}</span>
                    <span style="font-size:12px;color:var(--text-soft);flex:1;text-align:center">${escapeHtml(p.home_team)}</span>
                    <span class="pdm-h2h-score">${m.homeScore} – ${m.awayScore}</span>
                    <span style="font-size:12px;color:var(--text-soft);flex:1;text-align:center">${escapeHtml(p.away_team)}</span>
                  </div>`).join('')}
              ` : `<div class="pdm-h2h-empty">No H2H history found</div>`}
            </div>
          </div>

          <!-- Team Stats -->
          <div class="pdm-section">
            <div class="pdm-section-head"><span class="material-icons-round" style="font-size:16px">bar_chart</span>Team Stats</div>
            <div class="pdm-section-body">
              ${(homeStats || awayStats) ? `
                ${statBar(homeStats?.matches_played||0, awayStats?.matches_played||0, 'Matches Played')}
                ${statBar(homeStats?.wins||0, awayStats?.wins||0, 'Wins')}
                ${statBar(homeStats?.draws||0, awayStats?.draws||0, 'Draws')}
                ${statBar(homeStats?.losses||0, awayStats?.losses||0, 'Losses')}
                ${statBar(homeStats?.goals_scored_avg||0, awayStats?.goals_scored_avg||0, 'Goals Scored / Game')}
                ${statBar(homeStats?.goals_conceded_avg||0, awayStats?.goals_conceded_avg||0, 'Goals Conceded / Game')}
                ${statBar(homeStats?.clean_sheets||0, awayStats?.clean_sheets||0, 'Clean Sheets')}
                <p style="font-size:10px;color:var(--text-soft);margin-top:8px">
                  <span style="color:var(--primary)">■</span> ${escapeHtml(p.home_team)} &nbsp;
                  <span style="color:#ef4444">■</span> ${escapeHtml(p.away_team)}
                </p>
              ` : `<div style="color:var(--text-soft);font-size:13px;padding:12px 0">No team stats available</div>`}
            </div>
          </div>
        </div>

        ${p.analysis ? `
          <div class="pdm-section" style="margin-bottom:20px">
            <div class="pdm-section-head"><span class="material-icons-round" style="font-size:16px">notes</span>Analysis</div>
            <div class="pdm-section-body" style="font-size:14px;line-height:1.6;color:var(--text)">${escapeHtml(p.analysis)}</div>
          </div>` : ''}

        ${standings.length ? `
          <div class="pdm-standings">
            <h3 style="font-size:14px;font-weight:700;margin-bottom:12px;display:flex;align-items:center;gap:8px">
              <span class="material-icons-round" style="font-size:16px">format_list_numbered</span>League Standings
            </h3>
            <div class="pdm-section">
              <div class="pdm-section-body" style="padding:0;overflow-x:auto">
                <table>
                  <thead><tr>
                    <th style="padding:8px 12px;text-align:left;font-size:11px;color:var(--text-soft);font-weight:600">#</th>
                    <th style="padding:8px 12px;text-align:left;font-size:11px;color:var(--text-soft);font-weight:600">Team</th>
                    <th style="padding:8px 12px;text-align:center;font-size:11px;color:var(--text-soft);font-weight:600">MP</th>
                    <th style="padding:8px 12px;text-align:center;font-size:11px;color:var(--text-soft);font-weight:600">W</th>
                    <th style="padding:8px 12px;text-align:center;font-size:11px;color:var(--text-soft);font-weight:600">D</th>
                    <th style="padding:8px 12px;text-align:center;font-size:11px;color:var(--text-soft);font-weight:600">L</th>
                    <th style="padding:8px 12px;text-align:center;font-size:11px;color:var(--text-soft);font-weight:600">G</th>
                    <th style="padding:8px 12px;text-align:center;font-size:11px;color:var(--text-soft);font-weight:600;color:var(--primary)">Pts</th>
                  </tr></thead>
                  <tbody>
                    ${standings.map(t => {
                      const isHome = t.team === p.home_team;
                      const isAway = t.team === p.away_team;
                      const hl = isHome || isAway ? 'style="background:rgba(160,208,0,0.07)"' : '';
                      return `<tr ${hl}>
                        <td style="padding:8px 12px;font-size:13px;color:var(--text-soft)">${t.rank}</td>
                        <td style="padding:8px 12px">
                          <div style="display:flex;align-items:center;gap:8px">
                            ${t.logo ? `<img src="${t.logo}" style="width:20px;height:20px;object-fit:contain" loading="lazy">` : ''}
                            <span style="font-size:13px;font-weight:${isHome||isAway?'700':'400'}">${escapeHtml(t.team)}</span>
                          </div>
                        </td>
                        <td style="padding:8px 12px;text-align:center;font-size:13px">${t.played}</td>
                        <td style="padding:8px 12px;text-align:center;font-size:13px;color:#22c55e">${t.won}</td>
                        <td style="padding:8px 12px;text-align:center;font-size:13px">${t.drawn}</td>
                        <td style="padding:8px 12px;text-align:center;font-size:13px;color:#ef4444">${t.lost}</td>
                        <td style="padding:8px 12px;text-align:center;font-size:13px">${t.goalsFor}:${t.goalsAgainst}</td>
                        <td style="padding:8px 12px;text-align:center;font-size:13px;font-weight:700;color:var(--primary)">${t.points}</td>
                      </tr>`;
                    }).join('')}
                  </tbody>
                </table>
              </div>
            </div>
          </div>` : ''}
      </div>`;

    document.getElementById('pdm-content').innerHTML = content;

    // Load votes asynchronously after content renders
    const stored = JSON.parse(localStorage.getItem('pv_votes') || '{}');
    const userVote = stored[p.id] || null;
    loadPredictionVotes(p.id).then(votesData => {
      const voteContainer = document.createElement('div');
      voteContainer.className = 'pdm-section';
      voteContainer.style.marginBottom = '20px';
      voteContainer.innerHTML = `
        <div class="pdm-section-head"><span class="material-icons-round" style="font-size:16px">how_to_vote</span>Community Pick</div>
        <div class="pdm-section-body">${buildVoteBar(votesData?.votes || {home:0,draw:0,away:0}, p.id, userVote)}</div>`;
      const body = document.querySelector('.pdm-body');
      if (body) body.insertBefore(voteContainer, body.firstChild);
    });

    // Show affiliate odds if bookies available
    try {
      const bookies = JSON.parse(p.bookies_available || '[]');
      if (bookies.length) {
        const affSection = document.createElement('div');
        affSection.className = 'pdm-section aff-odds-section';
        affSection.style.marginBottom = '20px';
        affSection.innerHTML = `
          <div class="pdm-section-head"><span class="material-icons-round" style="font-size:16px">casino</span>Bet on This Match</div>
          <div class="pdm-section-body">
            <div class="aff-odds-grid">
              ${bookies.slice(0, 6).map(b => {
                const link = BOOKIE_LINKS?.[b] || '#';
                return `<a href="${link}" target="_blank" rel="nofollow noopener" class="aff-odds-card">
                  <div class="aff-odds-bookie">${escapeHtml(b)}</div>
                  <div class="aff-odds-val">Bet Now →</div>
                </a>`;
              }).join('')}
            </div>
          </div>`;
        const body = document.querySelector('.pdm-body');
        if (body) body.insertBefore(affSection, body.firstChild);
      }
    } catch {}
  }

  // Intercept clicks on prediction cards
  document.addEventListener('click', e => {
    const card = e.target.closest('.prediction-card');
    if (!card) return;
    // Don't intercept VIP lock overlay or explicit external links
    if (e.target.closest('.vip-overlay')) return;
    if (e.target.tagName === 'A' && e.target.hostname && e.target.hostname !== location.hostname) return;
    const slug = card.dataset.slug || (() => {
      const a = card.querySelector('a[href^="/prediction/"]');
      return a ? a.pathname.split('/').pop() : null;
    })();
    if (!slug) return;
    e.preventDefault();
    openDetail(slug);
  });

  window.openPredictionDetail = openDetail;
})();


// ═══════════════════════════════════════════════════════
// COMPETITIVE PARITY FEATURES
// ═══════════════════════════════════════════════════════

// ── Row stagger helper ─────────────────────────────────
function applyRowStagger(list, startFrom = 0) {
  if (!list) return;
  const rows = list.querySelectorAll('.pred-row');
  rows.forEach((el, i) => {
    if (i >= startFrom) el.style.animationDelay = `${(i - startFrom) * 30}ms`;
  });
}

// ── Win-rate trust badge ───────────────────────────────
async function renderWinrateBadge(container) {
  if (!container) return;
  try {
    const r = await fetch('/api/statistics/accuracy/summary');
    if (!r.ok) { container.style.display = 'none'; return; }
    const d = await r.json();
    const { total = 0, won = 0, accuracy = 0 } = d.data || {};
    if (total < 10) { container.style.display = 'none'; return; }
    const pct = Math.round(accuracy);
    container.innerHTML = `
      <div class="winrate-badge">
        <div class="winrate-badge-icon">🏆</div>
        <div>
          <div class="winrate-badge-stat">
            <span class="winrate-badge-num">${pct}%</span>
            <span class="winrate-badge-label">tip accuracy</span>
          </div>
          <div class="winrate-badge-sub">
            <strong>${won.toLocaleString()}</strong> winning tips from <strong>${total.toLocaleString()}</strong> predictions tracked
          </div>
        </div>
        <div class="winrate-badge-divider"></div>
        <div class="winrate-badge-sub" style="font-size:12px">
          AI-powered predictions<br>updated daily across 160+ leagues
        </div>
      </div>`;
  } catch { container.style.display = 'none'; }
}

// ── Community votes ────────────────────────────────────
const _votedCache = {};

async function loadPredictionVotes(predId) {
  try {
    const r = await fetch(`/api/predictions/${predId}/votes`);
    if (!r.ok) return null;
    const d = await r.json();
    return d.data || null;
  } catch { return null; }
}

function buildVoteBar(votes, predId, userVote) {
  if (!votes) return '';
  const { home = 0, draw = 0, away = 0 } = votes;
  const total = home + draw + away;
  if (total === 0 && !userVote) {
    return `<div class="vote-bar-wrap" id="votes-${predId}">
      <div class="vote-actions">
        <button class="vote-btn" onclick="castVote(${predId},'home',this)">🏠 Home</button>
        <button class="vote-btn" onclick="castVote(${predId},'draw',this)">🤝 Draw</button>
        <button class="vote-btn" onclick="castVote(${predId},'away',this)">✈️ Away</button>
      </div>
    </div>`;
  }
  const hw = total ? Math.round(home / total * 100) : 33;
  const dw = total ? Math.round(draw / total * 100) : 34;
  const aw = 100 - hw - dw;
  const vc = userVote ? `voted-${userVote}` : '';
  return `<div class="vote-bar-wrap" id="votes-${predId}">
    <div class="vote-bar-label"><span>🏠 ${hw}%</span><span>🤝 ${dw}%</span><span>✈️ ${aw}%</span></div>
    <div class="vote-bar-track">
      <div class="vote-home" style="width:${hw}%"></div>
      <div class="vote-draw" style="width:${dw}%"></div>
      <div class="vote-away" style="width:${aw}%"></div>
    </div>
    <div class="vote-actions">
      <button class="vote-btn ${userVote==='home'?'voted-home':''}" onclick="castVote(${predId},'home',this)">🏠 Home</button>
      <button class="vote-btn ${userVote==='draw'?'voted-draw':''}" onclick="castVote(${predId},'draw',this)">🤝 Draw</button>
      <button class="vote-btn ${userVote==='away'?'voted-away':''}" onclick="castVote(${predId},'away',this)">✈️ Away</button>
    </div>
    ${total > 0 ? `<div style="font-size:11px;color:var(--text-soft);margin-top:4px;text-align:center">${total} community pick${total===1?'':'s'}</div>` : ''}
  </div>`;
}

window.castVote = async function(predId, type, btn) {
  const stored = JSON.parse(localStorage.getItem('pv_votes') || '{}');
  if (stored[predId]) {
    showToast('You already voted on this match', 'info');
    return;
  }
  try {
    const r = await fetch(`/api/predictions/${predId}/vote`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vote: type }),
    });
    if (!r.ok) throw new Error();
    const d = await r.json();
    stored[predId] = type;
    localStorage.setItem('pv_votes', JSON.stringify(stored));
    const wrap = document.getElementById(`votes-${predId}`);
    if (wrap) wrap.outerHTML = buildVoteBar(d.data?.votes, predId, type);
    showToast('Vote cast!', 'success');
  } catch { showToast('Could not cast vote', 'error'); }
};

// ── Bookmaker odds display ─────────────────────────────
const BOOKIE_LINKS = {
  'Bet9ja':    'https://bet9ja.com',
  'Sportybet': 'https://sportybet.com',
  '1xBet':     'https://1xbet.com',
  'BetWay':    'https://betway.com',
  'Betano':    'https://betano.com',
};

function buildBookieOdds(bookiesJson, tip) {
  try {
    const bookies = JSON.parse(bookiesJson || '[]');
    if (!bookies.length) return '';
    const pills = bookies.slice(0, 4).map(b => {
      const link = BOOKIE_LINKS[b] || '#';
      return `<a href="${link}" target="_blank" rel="nofollow noopener" class="bookie-odds-pill">
        <span class="bookie-odds-name">${escapeHtml(b)}</span>
      </a>`;
    }).join('');
    return `<div class="bookie-odds-row">${pills}</div>`;
  } catch { return ''; }
}

// ── PWA install prompt ─────────────────────────────────
let _deferredPwaPrompt = null;

window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredPwaPrompt = e;
  if (localStorage.getItem('pv_pwa_dismissed')) return;
  // Show after 30s on site
  setTimeout(showPwaBanner, 30000);
});

function showPwaBanner() {
  if (document.getElementById('pwa-install-banner')) return;
  const banner = document.createElement('div');
  banner.id = 'pwa-install-banner';
  banner.innerHTML = `
    <div class="pwa-icon">⚽</div>
    <div class="pwa-text">
      <div class="pwa-title">Add Predictvilla to Home Screen</div>
      <div class="pwa-sub">Get instant tips without opening a browser</div>
    </div>
    <div class="pwa-actions">
      <button class="btn-pwa-install" onclick="installPwa()">Install</button>
      <button class="btn-pwa-dismiss" onclick="dismissPwa()" aria-label="Dismiss">×</button>
    </div>`;
  document.body.appendChild(banner);
  // On mobile: toggle open/close by tapping anywhere except the action buttons
  banner.addEventListener('click', function(e) {
    if (!e.target.closest('.pwa-actions')) {
      this.classList.toggle('pwa-open');
    }
  });
}

window.installPwa = async function() {
  if (!_deferredPwaPrompt) return;
  _deferredPwaPrompt.prompt();
  const { outcome } = await _deferredPwaPrompt.userChoice;
  _deferredPwaPrompt = null;
  document.getElementById('pwa-install-banner')?.remove();
  if (outcome === 'accepted') showToast('Predictvilla added to your home screen!', 'success');
};

window.dismissPwa = function() {
  localStorage.setItem('pv_pwa_dismissed', '1');
  document.getElementById('pwa-install-banner')?.remove();
};

// ── Service Worker Registration ────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

// ── League tabs config ─────────────────────────────────
const LEAGUE_TABS = [
  { id: 39,  name: 'England',  flag: '🏴󠁧󠁢󠁥󠁮󠁧󠁿' },
  { id: 140, name: 'Spain',    flag: '🇪🇸' },
  { id: 78,  name: 'Germany',  flag: '🇩🇪' },
  { id: 135, name: 'Italy',    flag: '🇮🇹' },
  { id: 61,  name: 'France',   flag: '🇫🇷' },
];

// ── League Table Widget ────────────────────────────────
async function renderLeagueTableWidget(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="lw-league-tabs">
      ${LEAGUE_TABS.map((l, i) => `<button class="lw-tab${i===0?' active':''}" data-league="${l.id}">${l.flag} ${l.name}</button>`).join('')}
    </div>
    <div class="lw-table-wrap"><div class="skeleton" style="height:200px;border-radius:8px"></div></div>`;
  container.querySelectorAll('.lw-tab').forEach(btn => {
    btn.addEventListener('click', async () => {
      container.querySelectorAll('.lw-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      await _loadStandingsTable(container, parseInt(btn.dataset.league));
    });
  });
  await _loadStandingsTable(container, LEAGUE_TABS[0].id);
}

async function _loadStandingsTable(container, leagueId) {
  const wrap = container.querySelector('.lw-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="skeleton" style="height:200px;border-radius:8px"></div>';
  try {
    const r = await fetch(`/api/standings?league=${leagueId}`);
    const data = await r.json();
    if (!data.success || !data.data?.standings?.length) {
      wrap.innerHTML = '<p style="font-size:12px;color:var(--text-soft);padding:12px 0">No standings available</p>';
      return;
    }
    const top10 = data.data.standings.slice(0, 10);
    wrap.innerHTML = `<div style="overflow-x:auto">
      <table class="lw-table">
        <thead><tr><th>#</th><th>Team</th><th>MP</th><th>W</th><th>D</th><th>L</th><th>Pts</th></tr></thead>
        <tbody>${top10.map(t => `<tr>
          <td class="lw-rank">${t.rank}</td>
          <td><div class="lw-team-cell">
            ${t.logo ? `<img src="${escapeHtml(t.logo)}" alt="" loading="lazy">` : ''}
            <span>${escapeHtml(t.team)}</span>
          </div></td>
          <td>${t.played}</td>
          <td style="color:#22c55e">${t.won}</td>
          <td>${t.drawn}</td>
          <td style="color:#ef4444">${t.lost}</td>
          <td class="lw-pts">${t.points}</td>
        </tr>`).join('')}</tbody>
      </table></div>`;
  } catch {
    wrap.innerHTML = '<p style="font-size:12px;color:var(--text-soft);padding:12px 0">Could not load standings</p>';
  }
}

// ── Top Scorers Widget ─────────────────────────────────
async function renderTopScorersWidget(container) {
  if (!container) return;
  container.innerHTML = `
    <div class="lw-league-tabs">
      ${LEAGUE_TABS.map((l, i) => `<button class="lw-tab ts-tab${i===0?' active':''}" data-league="${l.id}">${l.flag} ${l.name}</button>`).join('')}
    </div>
    <div class="ts-table-wrap"><div class="skeleton" style="height:160px;border-radius:8px"></div></div>`;
  container.querySelectorAll('.ts-tab').forEach(btn => {
    btn.addEventListener('click', async () => {
      container.querySelectorAll('.ts-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      await _loadTopScorers(container, parseInt(btn.dataset.league));
    });
  });
  await _loadTopScorers(container, LEAGUE_TABS[0].id);
}

async function _loadTopScorers(container, leagueId) {
  const wrap = container.querySelector('.ts-table-wrap');
  if (!wrap) return;
  wrap.innerHTML = '<div class="skeleton" style="height:160px;border-radius:8px"></div>';
  try {
    const r = await fetch(`/api/topscorers?league=${leagueId}`);
    const data = await r.json();
    if (!data.success || !data.data?.players?.length) {
      wrap.innerHTML = '<p style="font-size:12px;color:var(--text-soft);padding:12px 0">No data available</p>';
      return;
    }
    wrap.innerHTML = `<table class="ts-table">
      <thead><tr><th>#</th><th>Player</th><th>MP</th><th>⚽</th></tr></thead>
      <tbody>${data.data.players.map((p, i) => `<tr>
        <td>${i+1}</td>
        <td><div class="ts-player">
          <span class="ts-player-name">${escapeHtml(p.name)}</span>
          <span class="ts-player-team">${escapeHtml(p.team)}</span>
        </div></td>
        <td class="ts-matches">${p.matches}</td>
        <td class="ts-goals">${p.goals}</td>
      </tr>`).join('')}</tbody>
    </table>`;
  } catch {
    wrap.innerHTML = '<p style="font-size:12px;color:var(--text-soft);padding:12px 0">Could not load top scorers</p>';
  }
}

// ── Upcoming Picks ─────────────────────────────────────
async function loadUpcomingPicks(container) {
  if (!container) return;
  const sectionWrap = document.getElementById('upcoming-section-wrap') || container.closest('[id]');
  container.innerHTML = `<div class="pred-list-grouped">${`<div class="pred-row-skeleton skeleton" style="height:70px;border-radius:8px;margin-bottom:8px"></div>`.repeat(4)}</div>`;
  try {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = tomorrow.toISOString().slice(0, 10);
    const r = await fetch(`/api/predictions?date=${tomorrowStr}&limit=8`);
    const data = await r.json();
    const preds = data.data?.predictions || [];
    if (!preds.length) { if (sectionWrap) sectionWrap.style.display = 'none'; return; }
    const user = getUser();
    const isVip = user?.role === 'vip' || user?.role === 'admin';
    const groups = {};
    preds.forEach(p => {
      const key = p.league_name || 'Other';
      if (!groups[key]) groups[key] = { logo: p.league_logo || '', country: p.country || '', preds: [] };
      groups[key].preds.push(p);
    });
    const html = Object.entries(groups).map(([name, g]) => {
      const countryPart = g.country ? `<span style="margin-right:2px;opacity:.7">${escapeHtml(g.country)}:</span>` : '';
      return `<div class="league-group">
        <div class="league-group-header">
          ${g.logo ? `<img src="${escapeHtml(g.logo)}" alt="">` : '<span class="material-icons-round" style="font-size:14px">emoji_events</span>'}
          <span>${countryPart}${escapeHtml(name)}</span>
        </div>
        ${g.preds.map(p => buildPredictionRow(p, isVip)).join('')}
      </div>`;
    }).join('');
    container.innerHTML = `<div class="pred-list-grouped">${html}</div>`;
  } catch {
    if (sectionWrap) sectionWrap.style.display = 'none';
  }
}
