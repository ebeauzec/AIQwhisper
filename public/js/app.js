/* ============================================================
 *  AIQwhisper — Main SPA Application
 *  Hash-based router, API client, utilities, toast system
 * ============================================================ */

const App = {
  currentView: null,
  refreshTimer: null,

  async init() {
    // Wait for the backend API to be reachable before routing
    const appEl = document.getElementById('app');
    let ready = false;
    for (let i = 0; i < 15; i++) {
      try {
        const r = await fetch('/health', { signal: AbortSignal.timeout(2000) });
        if (r.ok) { ready = true; break; }
      } catch (_) { /* server not ready yet */ }
      // Update the loading message with retry count
      if (appEl && i > 0) {
        appEl.innerHTML = `
          <div class="loading-state">
            <div class="spinner"></div>
            <p>Connecting to server… (attempt ${i + 1})</p>
          </div>`;
      }
      await new Promise(r => setTimeout(r, 1000));
    }

    if (!ready) {
      if (appEl) {
        appEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">⚠</div>
            <h2>Cannot Connect to Server</h2>
            <p>The AIQwhisper backend is not responding. Make sure start.bat is running.</p>
            <button class="btn btn-primary" onclick="location.reload()">Retry</button>
          </div>`;
      }
      return;
    }

    // Update status dot to online
    const dot = document.querySelector('.status-dot');
    if (dot) dot.classList.add('online');

    window.addEventListener('hashchange', () => this.route());
    this.route();
  },

  route() {
    const hash = window.location.hash || '#/dashboard';
    const path = hash.replace('#/', '').split('?')[0];

    const views = {
      'dashboard':    typeof DashboardView    !== 'undefined' ? DashboardView    : null,
      'inventory':    typeof InventoryView    !== 'undefined' ? InventoryView    : null,
      'issues':       typeof IssuesView       !== 'undefined' ? IssuesView       : null,
      'performance':  typeof PerformanceView  !== 'undefined' ? PerformanceView  : null,
      'capacity':     typeof CapacityView     !== 'undefined' ? CapacityView     : null,
      'reports':      typeof ReportsView      !== 'undefined' ? ReportsView      : null,
      'systems':      typeof SystemsView      !== 'undefined' ? SystemsView      : null,
      'settings':     typeof SettingsView     !== 'undefined' ? SettingsView     : null,
    };

    const view = views[path] || views['dashboard'];
    this.currentView = view;

    const appEl = document.getElementById('app');
    if (view && typeof view.render === 'function') {
      view.render(appEl);
    } else {
      appEl.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">🚧</div>
          <h2>View Not Available</h2>
          <p>The "${escapeHtml(path)}" module has not been loaded yet.</p>
          <a href="#/dashboard" class="btn btn-primary">Go to Dashboard</a>
        </div>`;
    }

    this.updateNav(path);

    // Close mobile sidebar on navigation
    document.querySelector('.sidebar').classList.remove('open');
    document.querySelector('.sidebar-overlay').classList.remove('open');

    // Auto-refresh dashboard every 60 seconds
    clearInterval(this.refreshTimer);
    if (path === 'dashboard' && view && typeof view.render === 'function') {
      this.refreshTimer = setInterval(() => {
        view.render(document.getElementById('app'));
      }, 60000);
    }
  },

  updateNav(path) {
    document.querySelectorAll('.nav-item').forEach(el => {
      el.classList.toggle('active', el.dataset.path === path);
    });
  }
};

/* -------------------------------------------------------
 *  API Client (all methods have 10s timeout)
 * ------------------------------------------------------- */
function _timeout(ms) {
  // Use AbortSignal.timeout if available, otherwise manual AbortController
  if (typeof AbortSignal.timeout === 'function') return { signal: AbortSignal.timeout(ms) };
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return { signal: c.signal };
}

const api = {
  async get(path) {
    const r = await fetch('/api' + path, _timeout(10000));
    if (!r.ok) throw new Error(`GET ${path}: ${r.status} ${r.statusText}`);
    return r.json();
  },

  async post(path, body) {
    const r = await fetch('/api' + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ..._timeout(10000)
    });
    if (!r.ok) throw new Error(`POST ${path}: ${r.status} ${r.statusText}`);
    return r.json();
  },

  async put(path, body) {
    const r = await fetch('/api' + path, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ..._timeout(10000)
    });
    if (!r.ok) throw new Error(`PUT ${path}: ${r.status} ${r.statusText}`);
    return r.json();
  },

  async patch(path, body) {
    const r = await fetch('/api' + path, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ..._timeout(10000)
    });
    if (!r.ok) throw new Error(`PATCH ${path}: ${r.status} ${r.statusText}`);
    return r.json();
  },

  async delete(path) {
    const r = await fetch('/api' + path, { method: 'DELETE', ..._timeout(10000) });
    if (!r.ok) throw new Error(`DELETE ${path}: ${r.status} ${r.statusText}`);
    if (r.status === 204) return null;
    return r.json();
  }
};

/* -------------------------------------------------------
 *  Utility Functions
 * ------------------------------------------------------- */
function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
  const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
  const val = bytes / Math.pow(k, i);
  return parseFloat(val.toFixed(2)) + ' ' + sizes[i];
}

function formatNumber(n) {
  if (n === null || n === undefined) return '–';
  if (typeof n !== 'number') n = Number(n);
  if (isNaN(n)) return '–';
  return n.toLocaleString();
}

function formatPercent(n, decimals = 1) {
  if (n === null || n === undefined) return '–';
  return parseFloat(n).toFixed(decimals) + '%';
}

function timeAgo(ts) {
  if (!ts) return '–';
  const now = Date.now();
  const date = new Date(ts);
  const seconds = Math.floor((now - date.getTime()) / 1000);

  if (seconds < 0) return 'just now';
  if (seconds < 5) return 'just now';
  if (seconds < 60) return seconds + 's ago';

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm ago';

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h ago';

  const days = Math.floor(hours / 24);
  if (days < 7) return days + 'd ago';

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return weeks + 'w ago';

  const months = Math.floor(days / 30);
  if (months < 12) return months + 'mo ago';

  const years = Math.floor(days / 365);
  return years + 'y ago';
}

function formatDate(ts) {
  if (!ts) return '–';
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function formatDuration(ms) {
  if (!ms || ms < 0) return '–';
  if (ms < 1000) return ms + 'ms';
  const s = ms / 1000;
  if (s < 60) return s.toFixed(1) + 's';
  const m = Math.floor(s / 60);
  const rs = Math.floor(s % 60);
  if (m < 60) return m + 'm ' + rs + 's';
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return h + 'h ' + rm + 'm';
}

function escapeHtml(str) {
  if (!str) return '';
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
  return String(str).replace(/[&<>"']/g, c => map[c]);
}

function debounce(fn, delay = 300) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}

function severityBadge(severity) {
  const cls = {
    critical: 'badge-critical',
    warning: 'badge-warning',
    info: 'badge-info',
    success: 'badge-success',
    error: 'badge-critical',
    high: 'badge-critical',
    medium: 'badge-warning',
    low: 'badge-info',
  };
  const cssClass = cls[(severity || '').toLowerCase()] || 'badge-info';
  return `<span class="badge ${cssClass}">${escapeHtml(severity)}</span>`;
}

/* -------------------------------------------------------
 *  Toast Notifications
 * ------------------------------------------------------- */
let toastContainer = null;

function ensureToastContainer() {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    document.body.appendChild(toastContainer);
  }
  return toastContainer;
}

function showToast(message, type = 'info') {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icons = { info: 'ℹ', success: '✓', warning: '⚠', error: '✕', danger: '✕' };
  const icon = icons[type] || icons.info;

  toast.innerHTML = `
    <span class="toast-icon">${icon}</span>
    <span class="toast-message">${escapeHtml(message)}</span>
    <button class="toast-close" onclick="this.parentElement.remove()">×</button>
  `;

  container.appendChild(toast);

  // Trigger animation
  requestAnimationFrame(() => toast.classList.add('toast-visible'));

  // Auto-remove after 4 seconds
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

/* -------------------------------------------------------
 *  Modal Helpers
 * ------------------------------------------------------- */
function showModal(title, contentHtml, actions = []) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <h3>${escapeHtml(title)}</h3>
        <button class="modal-close" onclick="this.closest('.modal-overlay').remove()">×</button>
      </div>
      <div class="modal-body">${contentHtml}</div>
      ${actions.length ? `<div class="modal-footer">${actions.map(a =>
        `<button class="btn ${a.className || 'btn-primary'}" id="modal-action-${a.id || ''}">${escapeHtml(a.label)}</button>`
      ).join('')}</div>` : ''}
    </div>`;

  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('modal-visible'));

  // Close on overlay click
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });

  // Bind action callbacks
  actions.forEach(a => {
    if (a.id && a.onClick) {
      const btn = overlay.querySelector(`#modal-action-${a.id}`);
      if (btn) btn.addEventListener('click', () => { a.onClick(overlay); });
    }
  });

  return overlay;
}

function closeModal(overlay) {
  if (overlay) overlay.remove();
}

/* -------------------------------------------------------
 *  Loading Spinner
 * ------------------------------------------------------- */
function showLoading(container, message = 'Loading…') {
  container.innerHTML = `
    <div class="loading-state">
      <div class="spinner"></div>
      <p>${escapeHtml(message)}</p>
    </div>`;
}

/* -------------------------------------------------------
 *  Mobile Sidebar Toggle
 * ------------------------------------------------------- */
function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('open');
  document.querySelector('.sidebar-overlay').classList.toggle('open');
}

/* -------------------------------------------------------
 *  Bootstrap
 * ------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => App.init());
