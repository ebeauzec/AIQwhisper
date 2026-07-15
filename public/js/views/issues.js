/* ============================================================
 *  AIQwhisper — Issues View
 *  Filterable issue list with expandable details and actions
 * ============================================================ */

const IssuesView = {
  filters: { severity: '', category: '', status: '' },

  async render(container) {
    const self = this;
    container.innerHTML = `
      <div class="page-header">
        <h2>Issues</h2>
        <span class="subtitle">Active Alerts &amp; Findings</span>
      </div>
      <div class="filter-bar" id="issues-filters">
        <select class="input select" id="filter-severity">
          <option value="">All Severities</option>
          <option value="critical">Critical</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
          <option value="info">Info</option>
        </select>
        <select class="input select" id="filter-category">
          <option value="">All Categories</option>
          <option value="performance">Performance</option>
          <option value="capacity">Capacity</option>
          <option value="security">Security</option>
          <option value="availability">Availability</option>
          <option value="configuration">Configuration</option>
          <option value="firmware">Firmware</option>
        </select>
        <select class="input select" id="filter-status">
          <option value="">All Statuses</option>
          <option value="open">Open</option>
          <option value="acknowledged">Acknowledged</option>
          <option value="in_progress">In Progress</option>
          <option value="resolved">Resolved</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </div>
      <div id="issues-list"></div>`;

    // Bind filters
    ['severity', 'category', 'status'].forEach(key => {
      const el = document.getElementById(`filter-${key}`);
      if (el) {
        el.value = self.filters[key];
        el.addEventListener('change', () => {
          self.filters[key] = el.value;
          self.loadIssues();
        });
      }
    });

    this.loadIssues();
  },

  async loadIssues() {
    const listEl = document.getElementById('issues-list');
    if (!listEl) return;
    showLoading(listEl, 'Loading issues…');

    try {
      const params = new URLSearchParams();
      if (this.filters.severity) params.set('severity', this.filters.severity);
      if (this.filters.category) params.set('category', this.filters.category);
      if (this.filters.status) params.set('status', this.filters.status);
      const q = params.toString() ? '?' + params.toString() : '';

      const res = await api.get(`/issues${q}`);
      const issues = res.data || [];

      if (!issues.length) {
        listEl.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">✓</div>
            <h2>No Issues Found</h2>
            <p>All clear — no matching issues.</p>
          </div>`;
        return;
      }

      listEl.innerHTML = issues.map((issue, idx) => `
        <div class="card issue-card" style="animation-delay:${idx * 40}ms" data-issue-id="${issue.id}">
          <div class="issue-header" onclick="IssuesView.toggleDetail(${issue.id})">
            <div class="issue-left">
              ${severityBadge(issue.severity)}
              <div class="issue-info">
                <div class="issue-title">${escapeHtml(issue.title)}</div>
                <div class="issue-desc">${escapeHtml(issue.description || '')}</div>
              </div>
            </div>
            <div class="issue-right">
              <span class="issue-resource">${escapeHtml(issue.resource_type || '')} ${escapeHtml(issue.resource_id || '')}</span>
              <span class="issue-time">${timeAgo(issue.detected_at || issue.created_at)}</span>
              <span class="badge badge-info">${escapeHtml(issue.status || 'open')}</span>
            </div>
          </div>
          <div class="issue-detail" id="issue-detail-${issue.id}" style="display:none">
            <div class="issue-detail-body">
              <div class="detail-section">
                <strong>Category:</strong> ${escapeHtml(issue.category || '–')}
              </div>
              <div class="detail-section">
                <strong>Affected System:</strong> ${escapeHtml(issue.system_name || 'System ' + issue.system_id)}
              </div>
              <div class="detail-section">
                <strong>Rule:</strong> ${escapeHtml(issue.rule_id || '–')}
              </div>
              ${issue.remediation ? `<div class="detail-section"><strong>Remediation:</strong><p>${escapeHtml(issue.remediation)}</p></div>` : ''}
              ${issue.details_json ? `<div class="detail-section"><strong>Details:</strong><pre class="code-block">${escapeHtml(typeof issue.details_json === 'string' ? issue.details_json : JSON.stringify(issue.details_json, null, 2))}</pre></div>` : ''}
              <div class="issue-actions">
                ${issue.status !== 'acknowledged' && issue.status !== 'resolved' ? `<button class="btn btn-ghost btn-sm" onclick="IssuesView.acknowledge(${issue.id})">✓ Acknowledge</button>` : ''}
                ${issue.status !== 'resolved' ? `<button class="btn btn-primary btn-sm" onclick="IssuesView.resolve(${issue.id})">✓ Resolve</button>` : ''}
              </div>
            </div>
          </div>
        </div>`).join('');
    } catch (err) {
      listEl.innerHTML = `<div class="chart-empty">Failed to load issues: ${escapeHtml(err.message)}</div>`;
    }
  },

  toggleDetail(id) {
    const el = document.getElementById(`issue-detail-${id}`);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
  },

  async acknowledge(id) {
    try {
      await api.patch(`/issues/${id}/acknowledge`);
      showToast('Issue acknowledged', 'success');
      this.loadIssues();
    } catch (err) {
      showToast('Failed to acknowledge: ' + err.message, 'error');
    }
  },

  async resolve(id) {
    try {
      await api.patch(`/issues/${id}/resolve`);
      showToast('Issue resolved', 'success');
      this.loadIssues();
    } catch (err) {
      showToast('Failed to resolve: ' + err.message, 'error');
    }
  }
};
