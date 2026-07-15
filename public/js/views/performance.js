/* ============================================================
 *  AIQwhisper — Performance View
 *  System selector, resource tabs, time range, line charts
 * ============================================================ */

const PerformanceView = {
  systemId: null,
  resourceType: 'volume',
  range: '24h',
  resources: [],

  ranges: {
    '1h':  { label: '1 Hour',   ms: 3600000 },
    '6h':  { label: '6 Hours',  ms: 21600000 },
    '24h': { label: '24 Hours', ms: 86400000 },
    '7d':  { label: '7 Days',   ms: 604800000 },
    '30d': { label: '30 Days',  ms: 2592000000 },
    '6m':  { label: '6 Months', ms: 15552000000 }
  },

  getTier(rangeKey) {
    const ms = this.ranges[rangeKey]?.ms || 3600000;
    const hours = ms / 3600000;
    if (hours <= 6) return 'raw';
    if (hours <= 72) return 'hourly';
    if (hours <= 720) return 'daily';
    return 'weekly';
  },

  async render(container) {
    const self = this;
    container.innerHTML = `
      <div class="page-header">
        <h2>Performance</h2>
        <span class="subtitle">Metrics &amp; Trends</span>
      </div>
      <div class="filter-bar">
        <select class="input select" id="perf-system-select">
          <option value="">Select System…</option>
        </select>
        <div class="btn-group" id="perf-range-btns"></div>
      </div>
      <div class="tabs" id="perf-resource-tabs"></div>
      <div id="perf-charts"></div>`;

    // Time range buttons
    const rangeBtns = document.getElementById('perf-range-btns');
    if (rangeBtns) {
      rangeBtns.innerHTML = Object.entries(this.ranges).map(([k, v]) =>
        `<button class="btn btn-ghost btn-sm ${k === self.range ? 'active' : ''}" data-range="${k}">${v.label}</button>`
      ).join('');
      rangeBtns.addEventListener('click', e => {
        const btn = e.target.closest('[data-range]');
        if (!btn) return;
        self.range = btn.dataset.range;
        rangeBtns.querySelectorAll('.btn').forEach(b => b.classList.toggle('active', b.dataset.range === self.range));
        self.loadCharts();
      });
    }

    // Load systems
    try {
      const sys = await api.get('/systems');
      const sel = document.getElementById('perf-system-select');
      if (sel && sys.data) {
        sys.data.forEach(s => {
          sel.innerHTML += `<option value="${s.id}">${escapeHtml(s.name)} (${s.type})</option>`;
        });
        if (sys.data.length > 0 && !self.systemId) {
          self.systemId = sys.data[0].id;
          sel.value = self.systemId;
        } else if (self.systemId) {
          sel.value = self.systemId;
        }
        sel.addEventListener('change', () => {
          self.systemId = sel.value ? Number(sel.value) : null;
          self.loadResources();
        });
      }
    } catch (_) { /* ignore */ }

    if (this.systemId) this.loadResources();
  },

  async loadResources() {
    if (!this.systemId) return;
    const self = this;
    const tabsEl = document.getElementById('perf-resource-tabs');

    try {
      const res = await api.get(`/performance/${this.systemId}/resources`);
      this.resources = res.data || [];

      if (tabsEl && this.resources.length) {
        const types = this.resources.map(r => r.resource_type);
        if (!types.includes(this.resourceType)) this.resourceType = types[0];

        tabsEl.innerHTML = types.map(t =>
          `<button class="tab-btn ${t === self.resourceType ? 'active' : ''}" data-rtype="${t}">${escapeHtml(t)}</button>`
        ).join('');
        tabsEl.addEventListener('click', e => {
          const btn = e.target.closest('.tab-btn');
          if (!btn) return;
          self.resourceType = btn.dataset.rtype;
          tabsEl.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.rtype === self.resourceType));
          self.loadCharts();
        });
      }

      this.loadCharts();
    } catch (err) {
      if (tabsEl) tabsEl.innerHTML = '';
      const chartsEl = document.getElementById('perf-charts');
      if (chartsEl) chartsEl.innerHTML = `<div class="chart-empty">Failed to load resources: ${escapeHtml(err.message)}</div>`;
    }
  },

  async loadCharts() {
    if (!this.systemId) return;
    const chartsEl = document.getElementById('perf-charts');
    if (!chartsEl) return;
    showLoading(chartsEl, 'Loading metrics…');

    const rGroup = this.resources.find(r => r.resource_type === this.resourceType);
    if (!rGroup || !rGroup.resources || !rGroup.resources.length) {
      chartsEl.innerHTML = '<div class="chart-empty">No resources found for this type</div>';
      return;
    }

    const now = new Date();
    const rangeMs = this.ranges[this.range]?.ms || 3600000;
    const start = new Date(now.getTime() - rangeMs).toISOString();
    const end = now.toISOString();
    const tier = this.getTier(this.range);
    const metrics = ['read_iops', 'write_iops', 'read_latency', 'write_latency', 'read_throughput', 'write_throughput'];
    const resource = rGroup.resources[0];

    const chartConfigs = [
      { title: 'IOPS', metrics: ['read_iops', 'write_iops'], yLabel: 'ops/s', yFormatter: v => formatNumber(Math.round(v)) },
      { title: 'Latency', metrics: ['read_latency', 'write_latency'], yLabel: 'ms', yFormatter: v => v.toFixed(2) },
      { title: 'Throughput', metrics: ['read_throughput', 'write_throughput'], yLabel: 'B/s', yFormatter: v => formatBytes(v) }
    ];

    chartsEl.innerHTML = `<div class="perf-tier-info">Tier: <strong>${tier}</strong> | Range: ${this.ranges[this.range]?.label}</div>` +
      chartConfigs.map(c => `<div class="card"><h3>${c.title}</h3><div class="chart-container" id="perf-chart-${c.title.toLowerCase()}"></div></div>`).join('');

    for (const cfg of chartConfigs) {
      const chartEl = document.getElementById(`perf-chart-${cfg.title.toLowerCase()}`);
      if (!chartEl) continue;

      try {
        const seriesData = await Promise.all(cfg.metrics.map(async metric => {
          try {
            const available = resource.metric_names || [];
            if (available.length && !available.includes(metric)) return null;
            const res = await api.get(`/performance/${this.systemId}/timeseries?resource_type=${this.resourceType}&resource_id=${encodeURIComponent(resource.resource_id)}&metric_name=${metric}&start=${start}&end=${end}&tier=${tier}`);
            return { label: metric.replace('_', ' '), yKey: 'value', data: res.data || [], color: undefined };
          } catch (_) { return null; }
        }));

        const validSeries = seriesData.filter(s => s && s.data.length > 0);
        Charts.line(chartEl, {
          series: validSeries,
          xKey: 'timestamp',
          yLabel: cfg.yLabel,
          yFormatter: cfg.yFormatter,
          height: 220
        });
      } catch (err) {
        chartEl.innerHTML = `<div class="chart-empty">${escapeHtml(err.message)}</div>`;
      }
    }
  }
};
