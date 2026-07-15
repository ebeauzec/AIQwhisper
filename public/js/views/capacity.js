/* ============================================================
 *  AIQwhisper — Capacity View
 *  Overview cards, runway table, growth chart, projections
 * ============================================================ */

const CapacityView = {
  async render(container) {
    showLoading(container, 'Loading capacity data…');

    try {
      const [projections, runway, growth, efficiency] = await Promise.all([
        api.get('/capacity/projections'),
        api.get('/capacity/runway'),
        api.get('/capacity/growth'),
        api.get('/capacity/efficiency')
      ]);

      const projData = projections.data || [];
      const runwayData = runway.data || [];
      const growthData = growth.data || [];
      const effData = efficiency.data || [];

      // Aggregate totals from efficiency data
      const totalBytes = effData.reduce((s, d) => s + (d.total_bytes || 0), 0);
      const usedBytes = effData.reduce((s, d) => s + (d.used_bytes || 0), 0);
      const availBytes = effData.reduce((s, d) => s + (d.available_bytes || 0), 0);
      const avgUtil = totalBytes > 0 ? (usedBytes / totalBytes * 100) : 0;

      container.innerHTML = `
        <div class="page-header">
          <h2>Capacity Planning</h2>
          <span class="subtitle">Storage Utilization &amp; Projections</span>
        </div>
        <div class="metrics-grid" id="cap-cards"></div>
        <div class="dashboard-grid">
          <div class="card" id="cap-growth-chart">
            <h3>Growth Rate by Resource</h3>
            <div class="chart-container"></div>
          </div>
          <div class="card" id="cap-projection-chart">
            <h3>Days Until Full</h3>
            <div class="chart-container"></div>
          </div>
        </div>
        <div class="card" id="cap-runway-table">
          <h3>Capacity Runway</h3>
          <div id="runway-table-container"></div>
        </div>`;

      // ---- Overview cards ----
      const cards = [
        { label: 'Total Capacity', value: formatBytes(totalBytes), icon: '⬤', cls: 'metric-info' },
        { label: 'Used', value: formatBytes(usedBytes), icon: '⬤', cls: avgUtil > 85 ? 'metric-critical' : avgUtil > 70 ? 'metric-warning' : 'metric-info' },
        { label: 'Available', value: formatBytes(availBytes), icon: '⬤', cls: 'metric-info' },
        { label: 'Avg Utilization', value: formatPercent(avgUtil), icon: '⬤', cls: avgUtil > 85 ? 'metric-critical' : avgUtil > 70 ? 'metric-warning' : 'metric-info' }
      ];

      const cardsEl = document.getElementById('cap-cards');
      if (cardsEl) {
        cardsEl.innerHTML = cards.map((c, i) => `
          <div class="metric-card ${c.cls}" style="animation-delay:${i * 80}ms">
            <div class="metric-icon">${c.icon}</div>
            <div class="metric-body">
              <div class="metric-value">${c.value}</div>
              <div class="metric-label">${c.label}</div>
            </div>
          </div>`).join('');
      }

      // ---- Growth bar chart ----
      const growthEl = document.querySelector('#cap-growth-chart .chart-container');
      if (growthEl) {
        const growthBars = growthData
          .filter(d => d.growth_rate_bytes_per_day > 0)
          .sort((a, b) => b.growth_rate_bytes_per_day - a.growth_rate_bytes_per_day)
          .slice(0, 10)
          .map(d => ({
            label: d.resource_name || d.resource_id || 'Unknown',
            value: d.growth_rate_bytes_per_day
          }));

        if (growthBars.length) {
          Charts.bar(growthEl, {
            data: growthBars,
            valueFormatter: v => formatBytes(v) + '/day',
            labelKey: 'label',
            valueKey: 'value'
          });
        } else {
          growthEl.innerHTML = '<div class="chart-empty">No growth data available</div>';
        }
      }

      // ---- Projection donut chart (days-until-full buckets) ----
      const projEl = document.querySelector('#cap-projection-chart .chart-container');
      if (projEl) {
        const buckets = { critical: 0, warning: 0, healthy: 0 };
        projData.forEach(p => {
          if (p.days_until_full !== null && p.days_until_full <= 30) buckets.critical++;
          else if (p.days_until_full !== null && p.days_until_full <= 90) buckets.warning++;
          else buckets.healthy++;
        });

        Charts.donut(projEl, {
          data: [
            { label: '< 30 days', value: buckets.critical, color: '#ef4444' },
            { label: '30-90 days', value: buckets.warning, color: '#f59e0b' },
            { label: '> 90 days', value: buckets.healthy, color: '#10b981' }
          ].filter(d => d.value > 0),
          size: 180,
          thickness: 28
        });
      }

      // ---- Runway table ----
      const runwayContainer = document.getElementById('runway-table-container');
      if (runwayContainer) {
        Tables.create(runwayContainer, {
          columns: [
            { key: 'system_name', label: 'System' },
            { key: 'resource_name', label: 'Resource' },
            { key: 'resource_type', label: 'Type' },
            { key: 'current_utilization', label: 'Usage', formatter: v => {
              const pct = parseFloat(v) || 0;
              const color = pct >= 90 ? '#ef4444' : pct >= 75 ? '#f59e0b' : '#10b981';
              return `<span style="color:${color};font-weight:600">${formatPercent(pct)}</span>`;
            }},
            { key: 'days_until_full', label: 'Days Until Full', formatter: v => {
              if (v === null || v === undefined) return '∞';
              const n = Math.round(v);
              const color = n <= 30 ? '#ef4444' : n <= 90 ? '#f59e0b' : '#10b981';
              return `<span style="color:${color};font-weight:600">${formatNumber(n)}</span>`;
            }},
            { key: 'growth_rate_bytes_per_day', label: 'Growth/Day', formatter: v => formatBytes(v) },
            { key: 'projected_full_date', label: 'Projected Full', formatter: v => v ? formatDate(v) : '–' }
          ],
          data: runwayData,
          pageSize: 15,
          emptyMessage: 'No resources approaching capacity limits.'
        });
      }
    } catch (err) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠</div>
          <h2>Failed to Load Capacity Data</h2>
          <p>${escapeHtml(err.message)}</p>
          <button class="btn btn-primary" onclick="CapacityView.render(document.getElementById('app'))">Retry</button>
        </div>`;
    }
  }
};
