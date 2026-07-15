/* ============================================================
 *  AIQwhisper — Inventory View
 *  Tabbed inventory browser with data tables and system filter
 * ============================================================ */

const InventoryView = {
  tabs: [
    { key: 'clusters',   label: 'Clusters',   columns: [{ key: 'name', label: 'Name' }, { key: 'system_id', label: 'System' }, { key: 'uuid', label: 'UUID', width: '220px' }, { key: 'version', label: 'Version' }, { key: 'serial_number', label: 'Serial' }] },
    { key: 'nodes',      label: 'Nodes',      columns: [{ key: 'name', label: 'Name' }, { key: 'system_id', label: 'System' }, { key: 'model', label: 'Model' }, { key: 'serial_number', label: 'Serial' }, { key: 'is_epsilon', label: 'Epsilon' }, { key: 'uptime', label: 'Uptime' }] },
    { key: 'aggregates', label: 'Aggregates', columns: [{ key: 'name', label: 'Name' }, { key: 'system_id', label: 'System' }, { key: 'state', label: 'State' }, { key: 'total_bytes', label: 'Total', formatter: v => formatBytes(v) }, { key: 'used_bytes', label: 'Used', formatter: v => formatBytes(v) }, { key: 'available_bytes', label: 'Available', formatter: v => formatBytes(v) }] },
    { key: 'volumes',    label: 'Volumes',    columns: [{ key: 'name', label: 'Name' }, { key: 'svm_name', label: 'SVM' }, { key: 'state', label: 'State' }, { key: 'type', label: 'Type' }, { key: 'total_bytes', label: 'Total', formatter: v => formatBytes(v) }, { key: 'used_bytes', label: 'Used', formatter: v => formatBytes(v) }] },
    { key: 'disks',      label: 'Disks',      columns: [{ key: 'name', label: 'Name' }, { key: 'system_id', label: 'System' }, { key: 'media_type', label: 'Type' }, { key: 'status', label: 'Status' }, { key: 'capacity_bytes', label: 'Capacity', formatter: v => formatBytes(v) }, { key: 'platform', label: 'Platform' }] },
    { key: 'luns',       label: 'LUNs',       columns: [{ key: 'name', label: 'Name' }, { key: 'system_id', label: 'System' }, { key: 'serial_number', label: 'Serial' }, { key: 'os_type', label: 'OS Type' }, { key: 'total_bytes', label: 'Size', formatter: v => formatBytes(v) }, { key: 'status', label: 'Status' }] },
    { key: 'svms',       label: 'SVMs',       columns: [{ key: 'name', label: 'Name' }, { key: 'system_id', label: 'System' }, { key: 'state', label: 'State' }, { key: 'subtype', label: 'Subtype' }, { key: 'uuid', label: 'UUID', width: '220px' }] },
    { key: 'grids',      label: 'Grids',      columns: [{ key: 'name', label: 'Name' }, { key: 'system_id', label: 'System' }, { key: 'version', label: 'Version' }, { key: 'node_count', label: 'Nodes' }, { key: 'site_count', label: 'Sites' }] },
    { key: 'arrays',     label: 'Arrays',     columns: [{ key: 'name', label: 'Name' }, { key: 'system_id', label: 'System' }, { key: 'status', label: 'Status' }, { key: 'firmware_version', label: 'Firmware' }, { key: 'drive_count', label: 'Drives' }] },
    { key: 'buckets',    label: 'Buckets',    columns: [{ key: 'name', label: 'Name' }, { key: 'system_id', label: 'System' }, { key: 'region', label: 'Region' }, { key: 'object_count', label: 'Objects', formatter: v => formatNumber(v) }, { key: 'data_bytes', label: 'Data', formatter: v => formatBytes(v) }] }
  ],

  activeTab: 'clusters',
  systemFilter: '',

  async render(container) {
    const self = this;
    container.innerHTML = `
      <div class="page-header">
        <h2>Inventory</h2>
        <span class="subtitle">Infrastructure Resources</span>
      </div>
      <div class="filter-bar">
        <select class="input select" id="inv-system-filter">
          <option value="">All Systems</option>
        </select>
      </div>
      <div class="tabs" id="inv-tabs"></div>
      <div class="card" id="inv-table-card">
        <div id="inv-table-container"></div>
      </div>`;

    // Load system list for filter
    try {
      const sys = await api.get('/systems');
      const sel = document.getElementById('inv-system-filter');
      if (sel && sys.data) {
        sys.data.forEach(s => {
          sel.innerHTML += `<option value="${s.id}">${escapeHtml(s.name)} (${s.type})</option>`;
        });
        sel.value = self.systemFilter;
        sel.addEventListener('change', () => {
          self.systemFilter = sel.value;
          self.loadTab(self.activeTab);
        });
      }
    } catch (_) { /* ignore filter load failure */ }

    // Render tabs
    const tabsEl = document.getElementById('inv-tabs');
    if (tabsEl) {
      tabsEl.innerHTML = this.tabs.map(t =>
        `<button class="tab-btn ${t.key === self.activeTab ? 'active' : ''}" data-tab="${t.key}">${t.label}</button>`
      ).join('');
      tabsEl.addEventListener('click', e => {
        const btn = e.target.closest('.tab-btn');
        if (!btn) return;
        self.activeTab = btn.dataset.tab;
        tabsEl.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === self.activeTab));
        self.loadTab(self.activeTab);
      });
    }

    this.loadTab(this.activeTab);
  },

  async loadTab(tabKey) {
    const tabCfg = this.tabs.find(t => t.key === tabKey);
    if (!tabCfg) return;

    const tableContainer = document.getElementById('inv-table-container');
    if (!tableContainer) return;
    showLoading(tableContainer, `Loading ${tabCfg.label}…`);

    try {
      const query = this.systemFilter ? `?system_id=${this.systemFilter}` : '';
      const res = await api.get(`/inventory/${tabKey}${query}`);
      Tables.create(tableContainer, {
        columns: tabCfg.columns,
        data: res.data || [],
        pageSize: 20,
        emptyMessage: `No ${tabCfg.label.toLowerCase()} found.`,
        searchable: true
      });
    } catch (err) {
      tableContainer.innerHTML = `<div class="chart-empty">Failed to load ${tabCfg.label}: ${escapeHtml(err.message)}</div>`;
    }
  }
};
