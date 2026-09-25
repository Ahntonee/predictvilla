// Shared admin utilities
(function () {
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
        <span class="text-soft" style="font-size:13px;margin-left:auto">${escHtml(window.adminUser?.name || 'Admin')}</span>`;
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

  window.confirm2 = function (msg) { return window.confirm(msg); };

  // Pagination helper
  window.renderPager = function (el, page, total, limit, cb) {
    const pages = Math.ceil(total / limit);
    if (pages <= 1) { el.innerHTML = ''; return; }
    el.innerHTML = Array.from({ length: pages }, (_, i) => i + 1)
      .map(p => `<button class="btn btn-sm ${p === page ? 'btn-primary' : 'btn-ghost'}" onclick="(${cb})(${p})">${p}</button>`)
      .join('');
  };
})();
