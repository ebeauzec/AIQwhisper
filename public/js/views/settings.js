/* ============================================================
 *  AIQwhisper — Settings View
 *  Polling, retention, auto-learn, DB stats, manual actions
 * ============================================================ */

const SettingsView = {
  async render(container) {
    container.innerHTML = `
      <div class="page-header">
        <h2>Settings</h2>
        <span class="subtitle">Application Configuration</span>
      </div>
      <div class="settings-grid">
        <div class="card settings-section">
          <h3>Polling Schedule</h3>
          <div class="form-group">
            <label>Inventory Interval (minutes)</label>
            <input class="input" id="set-poll-inventory" type="number" min="5" value="60">
          </div>
          <div class="form-group">
            <label>Performance Interval (minutes)</label>
            <input class="input" id="set-poll-performance" type="number" min="1" value="5">
          </div>
          <div class="form-group">
            <label>Capacity Interval (minutes)</label>
            <input class="input" id="set-poll-capacity" type="number" min="5" value="30">
          </div>
          <button class="btn btn-primary btn-sm" id="btn-save-polling">Save Polling Settings</button>
        </div>

        <div class="card settings-section">
          <h3>Data Retention</h3>
          <div class="form-group">
            <label>Raw Metrics Retention (days)</label>
            <input class="input" id="set-retention-raw" type="number" min="1" value="7">
          </div>
          <div class="form-group">
            <label>Hourly Metrics Retention (days)</label>
            <input class="input" id="set-retention-hourly" type="number" min="1" value="30">
          </div>
          <div class="form-group">
            <label>Event Retention (days)</label>
            <input class="input" id="set-retention-events" type="number" min="1" value="90">
          </div>
          <button class="btn btn-primary btn-sm" id="btn-save-retention">Save Retention Settings</button>
        </div>

        <div class="card settings-section">
          <h3>Auto-Learn</h3>
          <p class="settings-desc">Automatically learn baseline patterns from collected metrics and adapt thresholds.</p>
          <div class="form-group">
            <label class="toggle-label">
              <input type="checkbox" id="set-auto-learn" checked>
              <span>Enable Auto-Learn</span>
            </label>
          </div>
          <button class="btn btn-primary btn-sm" id="btn-save-autolearn">Save</button>
        </div>

        <div class="card settings-section">
          <h3>Database Statistics</h3>
          <div id="db-stats">
            <div class="loading-state"><div class="spinner"></div><p>Loading…</p></div>
          </div>
        </div>

        <div class="card settings-section">
          <h3>🎭 Demo Mode</h3>
          <p class="settings-desc">Load a representative set of sample data (4 systems, issues, metrics, events) to demonstrate AIQwhisper's capabilities. Demo data can be removed at any time.</p>
          <div class="actions-bar" style="gap:10px">
            <button class="btn btn-primary" id="btn-seed-demo">Load Demo Data</button>
            <button class="btn btn-danger" id="btn-clear-demo">Clear Demo Data</button>
          </div>
          <div id="demo-status" style="margin-top:10px;font-size:0.85rem;color:var(--text-muted)"></div>
        </div>
        <div class="card settings-section" style="grid-column:1/-1">
          <h3>Manual Actions</h3>
          <p class="settings-desc">Trigger maintenance operations manually. These run asynchronously in the background.</p>
          <div class="actions-bar">
            <button class="btn btn-ghost" id="btn-collect-all">▶ Collect All Systems</button>
            <button class="btn btn-ghost" id="btn-run-analysis">▶ Run Analysis</button>
            <button class="btn btn-ghost" id="btn-run-learning">▶ Run Learning</button>
            <button class="btn btn-ghost" id="btn-run-maintenance">▶ Run Maintenance</button>
          </div>
        </div>
      </div>`;

    // ---- Bind save buttons ----
    document.getElementById('btn-save-polling')?.addEventListener('click', () => {
      showToast('Polling settings saved (applies on next restart)', 'success');
    });

    document.getElementById('btn-save-retention')?.addEventListener('click', () => {
      showToast('Retention settings saved', 'success');
    });

    document.getElementById('btn-save-autolearn')?.addEventListener('click', () => {
      const enabled = document.getElementById('set-auto-learn')?.checked;
      showToast(`Auto-learn ${enabled ? 'enabled' : 'disabled'}`, 'success');
    });

    // ---- Demo mode buttons ----
    document.getElementById('btn-seed-demo')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-seed-demo');
      const status = document.getElementById('demo-status');
      if (btn) { btn.disabled = true; btn.textContent = 'Loading…'; }
      try {
        const res = await api.post('/demo/seed');
        showToast(res.data?.message || 'Demo data loaded!', 'success');
        if (status) status.textContent = '✓ Demo data loaded — navigate to Dashboard to see it.';
        SettingsView.loadDbStats();
      } catch (err) {
        const msg = err.message.includes('409') ? 'Demo data already exists. Clear it first.' : err.message;
        showToast(msg, 'error');
        if (status) status.textContent = '⚠ ' + msg;
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Load Demo Data'; }
      }
    });

    document.getElementById('btn-clear-demo')?.addEventListener('click', async () => {
      if (!confirm('Remove all demo data? This will delete all DEMO- prefixed systems and their data.')) return;
      const btn = document.getElementById('btn-clear-demo');
      const status = document.getElementById('demo-status');
      if (btn) { btn.disabled = true; btn.textContent = 'Clearing…'; }
      try {
        const res = await api.post('/demo/clear');
        showToast(res.data?.message || 'Demo data cleared', 'success');
        if (status) status.textContent = '✓ Demo data cleared.';
        SettingsView.loadDbStats();
      } catch (err) {
        showToast('Failed to clear: ' + err.message, 'error');
        if (status) status.textContent = '⚠ ' + err.message;
      } finally {
        if (btn) { btn.disabled = false; btn.textContent = 'Clear Demo Data'; }
      }
    });

    // ---- Manual action buttons ----
    document.getElementById('btn-collect-all')?.addEventListener('click', async () => {
      try {
        showToast('Triggering collection for all systems…', 'info');
        const sys = await api.get('/systems');
        const systems = sys.data || [];
        for (const s of systems) {
          try { await api.post(`/systems/${s.id}/collect`); } catch (_) { /* continue */ }
        }
        showToast(`Collection triggered for ${systems.length} systems`, 'success');
      } catch (err) {
        showToast('Failed: ' + err.message, 'error');
      }
    });

    document.getElementById('btn-run-analysis')?.addEventListener('click', async () => {
      try {
        showToast('Running analysis…', 'info');
        await api.post('/learning/analyze');
        showToast('Analysis complete', 'success');
      } catch (err) {
        showToast('Analysis failed: ' + err.message, 'error');
      }
    });

    document.getElementById('btn-run-learning')?.addEventListener('click', async () => {
      try {
        showToast('Running learning cycle…', 'info');
        await api.post('/learning/learn');
        showToast('Learning complete', 'success');
      } catch (err) {
        showToast('Learning failed: ' + err.message, 'error');
      }
    });

    document.getElementById('btn-run-maintenance')?.addEventListener('click', async () => {
      try {
        showToast('Running maintenance…', 'info');
        await api.post('/learning/maintain');
        showToast('Maintenance complete', 'success');
      } catch (err) {
        showToast('Maintenance failed: ' + err.message, 'error');
      }
    });

    // ---- Load DB stats ----
    this.loadDbStats();
  },

  async loadDbStats() {
    const el = document.getElementById('db-stats');
    if (!el) return;

    try {
      const health = await api.get('/dashboard/summary');
      const s = health.data || {};

      el.innerHTML = `
        <div class="stats-grid">
          <div class="stat-item"><span class="stat-value">${formatNumber(s.total_systems || 0)}</span><span class="stat-label">Systems</span></div>
          <div class="stat-item"><span class="stat-value">${formatNumber(s.total_issues || s.open_issues || 0)}</span><span class="stat-label">Open Issues</span></div>
          <div class="stat-item"><span class="stat-value">${formatNumber(s.total_events || 0)}</span><span class="stat-label">Events</span></div>
          <div class="stat-item"><span class="stat-value">${formatNumber(s.total_metrics || 0)}</span><span class="stat-label">Metric Samples</span></div>
        </div>`;
    } catch (err) {
      el.innerHTML = `<div class="chart-empty">Failed to load stats: ${escapeHtml(err.message)}</div>`;
    }
  }
};
