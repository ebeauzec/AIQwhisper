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
    // Show format picker
    const formats = [
      { key: 'csv',   label: 'CSV (Excel-compatible)',  icon: '📊' },
      { key: 'json',  label: 'JSON (raw data)',          icon: '📄' },
      { key: 'pdf',   label: 'PDF (print to PDF)',       icon: '📑' }
    ];

    const html = `
      <div style="display:flex;flex-direction:column;gap:12px;padding:8px 0">
        ${formats.map(f => `
          <button class="btn btn-ghost" style="justify-content:flex-start;gap:10px;font-size:0.95rem"
                  onclick="ReportsView._doDownload(${id}, '${name.replace(/'/g, "\\'")}', '${f.key}')">
            <span style="font-size:1.3rem">${f.icon}</span> ${f.label}
          </button>`).join('')}
      </div>`;
    showModal('Download: ' + (name || 'Report'), html);
  },

  async _doDownload(id, name, format) {
    try {
      const res = await api.get(`/reports/${id}`);
      const reportData = res.data?.report || res.data || {};
      const filename = (name || `report_${id}`).replace(/[^a-zA-Z0-9_-]/g, '_');

      if (format === 'json') {
        const blob = new Blob([JSON.stringify(reportData, null, 2)], { type: 'application/json' });
        this._triggerDownload(blob, filename + '.json');
      } else if (format === 'csv') {
        const csv = this._reportToCsv(reportData);
        // Use UTF-8 BOM for Excel compatibility
        const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
        this._triggerDownload(blob, filename + '.csv');
      } else if (format === 'pdf') {
        this._printReportAsPdf(reportData, name);
      }

      // Close any modal
      const modalOverlay = document.querySelector('.modal-overlay');
      if (modalOverlay) modalOverlay.remove();
      showToast(`Downloaded as ${format.toUpperCase()}`, 'success');
    } catch (err) {
      showToast('Download failed: ' + err.message, 'error');
    }
  },

  _triggerDownload(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    URL.revokeObjectURL(url);
  },

  /** Convert a report JSON payload into a multi-section CSV string. */
  _reportToCsv(report) {
    const lines = [];

    const toCsvRow = (arr) => arr.map(v => {
      const s = String(v == null ? '' : v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    }).join(',');

    // Walk top-level keys in the report
    for (const [section, value] of Object.entries(report)) {
      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
        // It's a table-like array of objects
        lines.push(`--- ${section.toUpperCase()} ---`);
        const headers = Object.keys(value[0]);
        lines.push(toCsvRow(headers));
        for (const row of value) {
          lines.push(toCsvRow(headers.map(h => row[h])));
        }
        lines.push('');
      } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        // Nested object — flatten one level
        lines.push(`--- ${section.toUpperCase()} ---`);
        for (const [k, v] of Object.entries(value)) {
          if (typeof v === 'object') {
            lines.push(toCsvRow([k, JSON.stringify(v)]));
          } else {
            lines.push(toCsvRow([k, v]));
          }
        }
        lines.push('');
      } else {
        lines.push(toCsvRow([section, value]));
      }
    }
    return lines.join('\n');
  },

  /** Open a print-friendly window for "Save as PDF" via the browser's print dialog. */
  _printReportAsPdf(report, name) {
    const win = window.open('', '_blank', 'width=900,height=700');
    if (!win) { showToast('Popup blocked — allow popups for PDF export', 'warning'); return; }

    let html = `<!DOCTYPE html><html><head><title>${name}</title>
      <style>
        body { font-family: Arial, sans-serif; padding: 40px; color: #1a1a1a; font-size: 13px; }
        h1 { color: #1e293b; border-bottom: 2px solid #3b82f6; padding-bottom: 8px; }
        h2 { color: #334155; margin-top: 28px; }
        table { border-collapse: collapse; width: 100%; margin: 12px 0; page-break-inside: auto; }
        th { background: #f1f5f9; text-align: left; font-weight: 600; }
        th, td { border: 1px solid #cbd5e1; padding: 6px 10px; font-size: 12px; }
        tr:nth-child(even) { background: #f8fafc; }
        .meta { color: #64748b; font-size: 11px; margin-bottom: 24px; }
        @media print { body { padding: 20px; } }
      </style></head><body>
      <h1>${escapeHtml(name)}</h1>
      <div class="meta">Generated: ${report.generated || new Date().toISOString()}</div>`;

    for (const [section, value] of Object.entries(report)) {
      if (section === 'generated') continue;
      html += `<h2>${escapeHtml(section.replace(/_/g, ' ').toUpperCase())}</h2>`;

      if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
        const headers = Object.keys(value[0]);
        html += '<table><thead><tr>' + headers.map(h => `<th>${escapeHtml(h)}</th>`).join('') + '</tr></thead><tbody>';
        for (const row of value.slice(0, 200)) {
          html += '<tr>' + headers.map(h => `<td>${escapeHtml(String(row[h] ?? ''))}</td>`).join('') + '</tr>';
        }
        html += '</tbody></table>';
        if (value.length > 200) html += `<p style="color:#94a3b8"><em>... and ${value.length - 200} more rows</em></p>`;
      } else if (typeof value === 'object' && value !== null) {
        html += '<table><tbody>';
        for (const [k, v] of Object.entries(value)) {
          html += `<tr><td style="font-weight:600">${escapeHtml(k)}</td><td>${escapeHtml(typeof v === 'object' ? JSON.stringify(v) : String(v))}</td></tr>`;
        }
        html += '</tbody></table>';
      } else {
        html += `<p>${escapeHtml(String(value))}</p>`;
      }
    }

    html += `<script>setTimeout(()=>{window.print();},400)<\/script></body></html>`;
    win.document.write(html);
    win.document.close();
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
