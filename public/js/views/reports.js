/* ============================================================
 *  AIQwhisper — Reports View
 *  Report type selector, generation, and report list
 * ============================================================ */

const ReportsView = {
  reportTypes: [
    { key: 'executive', label: 'Executive', icon: '📊', desc: 'High-level health overview with system scores and critical issues.' },
    { key: 'capacity',  label: 'Capacity',  icon: '💾', desc: 'Storage utilization trends, projections, and runway analysis.' },
    { key: 'firmware',  label: 'Firmware',  icon: '🔧', desc: 'Software versions, firmware matrix, and upgrade recommendations.' },
    { key: 'issues',    label: 'Issues',    icon: '⚠',  desc: 'Complete issue listing with recommendations and remediation steps.' },
    { key: 'security',  label: 'Security',  icon: '🔒', desc: 'Security advisories, vulnerabilities, and compliance status.' }
  ],

  selectedType: 'executive',

  async render(container) {
    const self = this;
    container.innerHTML = `
      <div class="page-header">
        <h2>Reports</h2>
        <span class="subtitle">Generate &amp; View Reports</span>
      </div>
      <div class="report-types-grid" id="report-types"></div>
      <div class="card" style="margin-top:1rem">
        <div class="report-generate-bar">
          <button class="btn btn-primary" id="btn-generate-report">Generate Report</button>
          <span class="report-selected" id="report-selected-label">Selected: ${self.selectedType}</span>
        </div>
      </div>
      <div class="card" id="reports-list-card">
        <h3>Generated Reports</h3>
        <div id="reports-table-container"></div>
      </div>`;

    // Render type selector cards
    const typesEl = document.getElementById('report-types');
    if (typesEl) {
      typesEl.innerHTML = this.reportTypes.map(t => `
        <div class="report-type-card ${t.key === self.selectedType ? 'selected' : ''}" data-type="${t.key}">
          <div class="report-type-icon">${t.icon}</div>
          <div class="report-type-label">${t.label}</div>
          <div class="report-type-desc">${t.desc}</div>
        </div>`).join('');

      typesEl.addEventListener('click', e => {
        const card = e.target.closest('.report-type-card');
        if (!card) return;
        self.selectedType = card.dataset.type;
        typesEl.querySelectorAll('.report-type-card').forEach(c => c.classList.toggle('selected', c.dataset.type === self.selectedType));
        const label = document.getElementById('report-selected-label');
        if (label) label.textContent = 'Selected: ' + self.selectedType;
      });
    }

    // Generate button
    const genBtn = document.getElementById('btn-generate-report');
    if (genBtn) {
      genBtn.addEventListener('click', () => self.generateReport());
    }

    this.loadReportsList();
  },

  async generateReport() {
    const btn = document.getElementById('btn-generate-report');
    if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

    try {
      const res = await api.post('/reports/generate', { type: this.selectedType });
      const status = res.data?.status || 'unknown';
      showToast(`Report generated (${status})`, status === 'completed' ? 'success' : 'warning');
      this.loadReportsList();
    } catch (err) {
      showToast('Failed to generate report: ' + err.message, 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = 'Generate Report'; }
    }
  },

  async loadReportsList() {
    const tableContainer = document.getElementById('reports-table-container');
    if (!tableContainer) return;
    showLoading(tableContainer, 'Loading reports…');

    try {
      const res = await api.get('/reports');
      const reports = res.data || [];

      Tables.create(tableContainer, {
        columns: [
          { key: 'id', label: 'ID', width: '60px' },
          { key: 'name', label: 'Name' },
          { key: 'type', label: 'Type', formatter: v => `<span class="badge badge-info">${escapeHtml(v)}</span>` },
          { key: 'status', label: 'Status', formatter: v => {
            const cls = v === 'completed' ? 'badge-success' : v === 'failed' ? 'badge-critical' : 'badge-warning';
            return `<span class="badge ${cls}">${escapeHtml(v)}</span>`;
          }},
          { key: 'generated_at', label: 'Generated', formatter: v => formatDate(v) },
          { key: 'file_size_bytes', label: 'Size', formatter: v => v ? formatBytes(v) : '–' },
          { key: 'id', label: 'Actions', sortable: false, formatter: (v, row) => {
            let btns = '';
            if (row.status === 'completed') {
              btns += `<button class="btn btn-ghost btn-sm" onclick="ReportsView.viewReport(${v})">View</button> `;
              btns += `<button class="btn btn-ghost btn-sm" onclick="ReportsView.downloadReport(${v}, '${escapeHtml(row.name)}')">Download</button> `;
            }
            btns += `<button class="btn btn-ghost btn-sm" style="color:var(--danger)" onclick="ReportsView.deleteReport(${v}, '${escapeHtml(row.name)}')">Delete</button>`;
            return btns;
          }}
        ],
        data: reports,
        pageSize: 10,
        emptyMessage: 'No reports generated yet.'
      });
    } catch (err) {
      tableContainer.innerHTML = `<div class="chart-empty">Failed to load reports: ${escapeHtml(err.message)}</div>`;
    }
  },

  async viewReport(id) {
    try {
      const res = await api.get(`/reports/${id}`);
      const report = res.data || {};
      const content = report.report
        ? `<pre class="code-block" style="max-height:500px;overflow:auto">${escapeHtml(JSON.stringify(report.report, null, 2))}</pre>`
        : '<p>No report data available.</p>';

      showModal(report.name || 'Report', content);
    } catch (err) {
      showToast('Failed to load report: ' + err.message, 'error');
    }
  },

  downloadReport(id, name) {
    const filename = (name || `report_${id}`) + '.json';
    api.get(`/reports/${id}`).then(res => {
      const blob = new Blob([JSON.stringify(res.data?.report || res.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    }).catch(err => showToast('Download failed: ' + err.message, 'error'));
  },

  async deleteReport(id, name) {
    const confirmed = confirm(`Delete report "${name}"?\nThis action cannot be undone.`);
    if (!confirmed) return;

    try {
      await api.delete(`/reports/${id}`);
      showToast('Report deleted', 'success');
      this.loadReportsList();
    } catch (err) {
      showToast('Failed to delete report: ' + err.message, 'error');
    }
  }
};
