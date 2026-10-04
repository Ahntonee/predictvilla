// Shared admin utilities
(function () {
  const savedAdminTheme = localStorage.getItem('pv_admin_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedAdminTheme);

  // Guard: redirect to login if not admin
  function getAdmin() {
    try {
      const s = localStorage.getItem('ol_admin');
      if (!s) return null;
      const u = JSON.parse(s);
      return (u.role === 'admin' || u.role === 'super_admin') ? u : null;
    } catch { return null; }
  }

  window.adminUser = getAdmin();
  if (!window.adminUser && !location.pathname.endsWith('/admin/index.html') && !location.pathname.endsWith('/admin/')) {
    location.href = '/admin/index.html';
  }

  // Inject sidebar + topbar
  window.injectAdminShell = function (activePage) {
    const nav = [
      { href: 'dashboard.html', icon: 'home', label: 'Dashboard' },
      { href: 'predictions.html', icon: 'sports_soccer', label: 'Predictions' },
      { href: 'intelligence.html', icon: 'psychology', label: 'Intelligence' },
      { href: 'game-browser.html', icon: 'grid_view', label: 'Game Browser' },
      { href: 'categories.html', icon: 'label', label: 'Categories' },
      { href: 'leaderboard.html', icon: 'emoji_events', label: 'Leaderboard' },
      { href: 'blog.html', icon: 'edit_note', label: 'Blog' },
      { href: 'subscriptions.html', icon: 'credit_card', label: 'Subscriptions' },
      { href: 'users.html', icon: 'group', label: 'Users' },
      { href: 'leagues.html', icon: 'public', label: 'Leagues' },
      { href: 'sync.html', icon: 'sync', label: 'Data Sync' },
      { href: 'api-data.html', icon: 'storage', label: 'API Data Hub' },
      { href: 'analytics.html', icon: 'analytics', label: 'Analytics' },
      { href: 'prediction-stats.html', icon: 'auto_awesome', label: 'Pred. Intelligence' },
      { href: 'revenue.html', icon: 'payments', label: 'Revenue' },
      { href: 'seo.html', icon: 'manage_search', label: 'SEO' },
      { href: 'seo-pages.html', icon: 'article', label: 'SEO Pages' },
      { href: 'backlinks.html', icon: 'link', label: 'Textlinks' },
      { href: 'ads.html', icon: 'campaign', label: 'Ads' },
      { href: 'pages.html', icon: 'web', label: 'Pages' },
      { href: 'settings.html', icon: 'settings', label: 'Settings' },
    ];

    const sidebar = document.getElementById('admin-sidebar');
    const topbar = document.getElementById('admin-topbar');
    if (sidebar) {
      sidebar.innerHTML = `
        <div class="admin-brand"><img src="/images/logo.svg" alt="Predictvilla" style="height:32px;object-fit:contain"></div>
        <nav class="admin-nav">
          ${nav.map(n => `<a href="${n.href}" class="admin-nav-link${activePage === n.href ? ' active' : ''}"><span class="material-icons-round">${n.icon}</span> ${n.label}</a>`).join('')}
        </nav>
        <div class="admin-nav-footer">
          <a href="/" class="admin-nav-link" target="_blank"><span class="material-icons-round">language</span> View Site</a>
          <button class="admin-nav-link" style="width:100%;text-align:left;background:none;border:none;cursor:pointer;color:var(--danger)" onclick="adminLogout()"><span class="material-icons-round">logout</span> Logout</button>
        </div>`;
    }
    if (topbar) {
      topbar.innerHTML = `
        <button class="admin-menu-toggle" onclick="document.getElementById('admin-sidebar').classList.toggle('open')"><span class="material-icons-round">menu</span></button>
        <span class="admin-page-title" id="admin-page-title"></span>
        <button type="button" class="admin-theme-toggle" id="admin-theme-toggle" title="Switch day/night mode" aria-label="Switch day/night mode">
          <span class="material-icons-round">${document.documentElement.dataset.theme === 'light' ? 'dark_mode' : 'light_mode'}</span>
          <span>${document.documentElement.dataset.theme === 'light' ? 'Night' : 'Day'} mode</span>
        </button>
        <span class="text-soft" style="font-size:13px">${escHtml(window.adminUser?.name || 'Admin')}</span>`;
      document.getElementById('admin-theme-toggle')?.addEventListener('click', () => {
        const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('pv_admin_theme', next);
        const toggle = document.getElementById('admin-theme-toggle');
        toggle.innerHTML = `<span class="material-icons-round">${next === 'light' ? 'dark_mode' : 'light_mode'}</span><span>${next === 'light' ? 'Night' : 'Day'} mode</span>`;
      });
    }
  };

  window.adminLogout = async function () {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    localStorage.removeItem('ol_admin');
    location.href = '/admin/index.html';
  };

  window.escHtml = function (s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  };

  window.fmtDate = function (d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
  };

  window.fmtDateTime = function (d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-GB', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
  };

  window.showToast = function (msg, type = 'info') {
    let tc = document.getElementById('toast-container');
    if (!tc) { tc = document.createElement('div'); tc.id = 'toast-container'; tc.className = 'toast-container'; document.body.appendChild(tc); }
    const lastToast = tc.lastElementChild;
    if (lastToast?.textContent === String(msg) && lastToast.classList.contains(`toast-${type}`)) return;
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = msg;
    tc.appendChild(t);
    setTimeout(() => t.classList.add('show'), 10);
    setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
  };

  window.api = async function (path, opts = {}) {
    const { silent = false, ...fetchOpts } = opts;
    try {
      const r = await fetch(`/api${path}`, {
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...(fetchOpts.headers || {}) },
        ...fetchOpts,
      });
      const contentType = r.headers.get('content-type') || '';
      const data = contentType.includes('application/json')
        ? await r.json()
        : { success: false, message: (await r.text()) || `Request failed (${r.status})` };

      if (!r.ok) {
        if (r.status === 401) {
          localStorage.removeItem('ol_admin');
          location.href = '/admin/index.html';
        }
        const message = data.message || `Request failed (${r.status})`;
        if (!silent) showToast(message, 'error');
        return { ...data, success: false, status: r.status };
      }
      return data;
    } catch (err) {
      const message = err instanceof SyntaxError
        ? 'The server returned an invalid response.'
        : 'Could not reach the server. Check your connection and try again.';
      console.error(`[Admin API] ${path}:`, err);
      if (!silent) showToast(message, 'error');
      return { success: false, message, error: err.message };
    }
  };

  // Styled async confirm dialog — matches app brand colors
  (function () {
    const s = document.createElement('style');
    s.textContent = `
      .adm-confirm-overlay{position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,0.60);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;padding:16px;animation:adm-fade .18s ease}
      @keyframes adm-fade{from{opacity:0}to{opacity:1}}
      .adm-confirm-card{background:#182200;border:1px solid rgba(160,208,0,0.22);border-radius:20px;max-width:360px;width:100%;padding:28px 28px 24px;box-shadow:0 24px 64px rgba(0,0,0,0.60);position:relative;font-family:'Bai Jamjuree','KoHo',sans-serif;animation:adm-slide .22s cubic-bezier(.22,.61,.36,1)}
      @keyframes adm-slide{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
      .adm-confirm-card h3{font-size:17px;font-weight:700;color:#f4f8e0;margin:0 28px 10px 0;font-family:'Bai Jamjuree','KoHo',sans-serif;letter-spacing:-0.1px}
      .adm-confirm-card p{font-size:13px;line-height:1.65;color:rgba(244,248,224,0.60);margin:0 0 22px}
      .adm-confirm-close{position:absolute;top:14px;right:16px;background:none;border:none;cursor:pointer;color:rgba(244,248,224,0.40);font-size:20px;line-height:1;padding:3px 5px;border-radius:6px;font-family:'Material Icons Round','Material Icons';transition:color .15s}
      .adm-confirm-close:hover{color:#f4f8e0}
      .adm-confirm-actions{display:flex;gap:10px}
      .adm-confirm-btn{flex:1;padding:11px 16px;border-radius:50px;font-size:14px;font-weight:700;cursor:pointer;border:none;font-family:'Bai Jamjuree','KoHo',sans-serif;letter-spacing:0.1px;transition:opacity .15s}
      .adm-confirm-btn:hover{opacity:.85}
      .adm-btn-cancel{background:rgba(244,248,224,0.08);color:rgba(244,248,224,0.70);border:1px solid rgba(244,248,224,0.14)}
      .adm-btn-danger{background:#0d1600;color:#ef4444;border:1px solid rgba(239,68,68,0.35)}
      .adm-btn-primary{background:#0d1600;color:#a0d000;border:1px solid rgba(160,208,0,0.35)}
      html[data-theme="light"] .adm-confirm-card{background:#fff;border-color:rgba(78,112,0,0.16)}
      html[data-theme="light"] .adm-confirm-card h3{color:#0d1600}
      html[data-theme="light"] .adm-confirm-card p{color:rgba(13,22,0,0.55)}
      html[data-theme="light"] .adm-confirm-close{color:rgba(13,22,0,0.30)}
      html[data-theme="light"] .adm-confirm-close:hover{color:#0d1600}
      html[data-theme="light"] .adm-btn-cancel{background:rgba(13,22,0,0.06);color:rgba(13,22,0,0.60);border-color:rgba(13,22,0,0.12)}
      html[data-theme="light"] .adm-btn-danger{background:#fff;color:#dc2626;border-color:rgba(220,38,38,0.30)}
      html[data-theme="light"] .adm-btn-primary{background:#fff;color:#4e7000;border-color:rgba(78,112,0,0.30)}
    `;
    document.head.appendChild(s);
  })();

  window.adminConfirm = function (title, message, confirmLabel = 'Confirm', type = 'danger') {
    return new Promise(resolve => {
      const overlay = document.createElement('div');
      overlay.className = 'adm-confirm-overlay';
      overlay.innerHTML = `
        <div class="adm-confirm-card" role="dialog" aria-modal="true">
          <button class="adm-confirm-close" id="adm-close">&#x2715;</button>
          <h3>${title}</h3>
          <p>${message}</p>
          <div class="adm-confirm-actions">
            <button class="adm-confirm-btn adm-btn-cancel" id="adm-cancel">Cancel</button>
            <button class="adm-confirm-btn ${type === 'danger' ? 'adm-btn-danger' : 'adm-btn-primary'}" id="adm-ok">${confirmLabel}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const done = val => { overlay.remove(); resolve(val); };
      document.getElementById('adm-ok').addEventListener('click', () => done(true));
      document.getElementById('adm-cancel').addEventListener('click', () => done(false));
      document.getElementById('adm-close').addEventListener('click', () => done(false));
      overlay.addEventListener('click', e => { if (e.target === overlay) done(false); });
    });
  };

  // Pagination helper
  window.renderPager = function (el, page, total, limit, cb) {
    const pages = Math.ceil(total / limit);
    if (pages <= 1) { el.innerHTML = ''; return; }
    const callback = typeof cb === 'function' ? cb : window[cb];
    const visible = Array.from({ length: pages }, (_, i) => i + 1)
      .filter(p => pages <= 9 || p === 1 || p === pages || Math.abs(p - page) <= 2);
    el.innerHTML = `<button type="button" class="btn btn-sm btn-ghost" data-pager-page="${page - 1}" ${page <= 1 ? 'disabled' : ''}>Previous</button>`
      + visible.map((p, index) => `${index && p - visible[index - 1] > 1 ? '<span class="text-soft">…</span>' : ''}<button type="button" class="btn btn-sm ${p === page ? 'btn-primary' : 'btn-ghost'}" data-pager-page="${p}">${p}</button>`).join('')
      + `<button type="button" class="btn btn-sm btn-ghost" data-pager-page="${page + 1}" ${page >= pages ? 'disabled' : ''}>Next</button>`;
    el.querySelectorAll('[data-pager-page]:not(:disabled)').forEach(button => {
      button.addEventListener('click', () => callback?.(Number(button.dataset.pagerPage)));
    });
  };
})();
