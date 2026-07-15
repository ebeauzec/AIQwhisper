/* ============================================================
 *  AIQwhisper — Dashboard View
 *  Infrastructure overview with metrics, charts, and timeline
 * ============================================================ */

const DashboardView = {
  async render(container) {
    showLoading(container, 'Loading dashboard…');

    try {
      const [summary, health, events] = await Promise.all([
        api.get('/dashboard/summary'),
        api.get('/dashboard/health'),
        api.get('/dashboard/recent-events')
      ]);

      const s = summary.data || {};
      const healthData = health.data || [];
      const eventList = events.data || [];

      container.innerHTML = `
        <div class="page-header">
          <h2>Dashboard</h2>
          <span class="subtitle">Infrastructure Overview</span>
        </div>
        <div class="metrics-grid" id="metrics-cards"></div>
        <div class="dashboard-grid">
          <div class="card" id="issues-chart">
            <h3>Issues by Severity</h3>
            <div class="chart-container"></div>
          </div>
          <div class="card" id="capacity-chart">
            <h3>Top Capacity Usage</h3>
            <div class="chart-container"></div>
          </div>
        </div>
        <div class="card" id="events-timeline">
          <h3>Recent Events</h3>
          <div class="timeline-container"></div>
        </div>`;

      // ---- Metric cards ----
      const criticalCount = s.critical_issues ?? s.critical ?? 0;
      const warningCount = s.warning_issues ?? s.warnings ?? 0;
      const totalSystems = s.total_systems ?? healthData.length ?? 0;
      const capacityWarnings = s.capacity_warnings ?? s.capacity_at_risk ?? 0;

      const cards = [
        { label: 'Total Systems', value: formatNumber(totalSystems), icon: '⚙', cls: 'metric-info' },
        { label: 'Critical Issues', value: formatNumber(criticalCount), icon: '✕', cls: 'metric-critical' },
        { label: 'Warnings', value: formatNumber(warningCount), icon: '⚠', cls: 'metric-warning' },
        { label: 'Capacity Warnings', value: formatNumber(capacityWarnings), icon: '⬤', cls: 'metric-warning' }
      ];

      const cardsEl = document.getElementById('metrics-cards');
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

      // ---- Issues donut chart ----
      const issuesChartEl = document.querySelector('#issues-chart .chart-container');
      if (issuesChartEl) {
        const issueData = [
          { label: 'Critical', value: criticalCount, color: '#ef4444' },
          { label: 'Warning', value: warningCount, color: '#f59e0b' },
          { label: 'Info', value: s.info_issues ?? s.info ?? 0, color: '#6366f1' }
        ].filter(d => d.value > 0);

        if (issueData.length) {
          Charts.donut(issuesChartEl, { data: issueData, size: 180, thickness: 28 });
        } else {
          issuesChartEl.innerHTML = '<div class="chart-empty">No open issues 🎉</div>';
        }
      }

      // ---- Capacity bar chart ----
      const capChartEl = document.querySelector('#capacity-chart .chart-container');
      if (capChartEl) {
        const capData = healthData
          .filter(h => h.overall_score !== null && h.overall_score !== undefined)
          .map(h => ({
            label: h.system_name || `System ${h.system_id}`,
            value: 100 - (h.overall_score || 0),
            color: h.overall_score < 50 ? '#ef4444' : h.overall_score < 75 ? '#f59e0b' : '#10b981'
          }))
          .sort((a, b) => b.value - a.value)
          .slice(0, 8);

        if (capData.length) {
          Charts.bar(capChartEl, {
            data: capData,
            valueFormatter: v => v.toFixed(0) + '%',
            labelKey: 'label',
            valueKey: 'value'
          });
        } else {
          capChartEl.innerHTML = '<div class="chart-empty">No capacity data yet</div>';
        }
      }

      // ---- Events timeline ----
      const timelineEl = document.querySelector('#events-timeline .timeline-container');
      if (timelineEl) {
        const mapped = eventList.map(e => ({
          title: e.title || e.event_type || 'Event',
          description: e.description || e.message || '',
          timestamp: e.timestamp || e.created_at,
          severity: e.severity || 'info',
          source: e.system_name || e.source || ''
        }));
        Timeline.create(timelineEl, mapped, { maxItems: 15 });
      }
    } catch (err) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠</div>
          <h2>Failed to Load Dashboard</h2>
          <p>${escapeHtml(err.message)}</p>
          <button class="btn btn-primary" onclick="DashboardView.render(document.getElementById('app'))">Retry</button>
        </div>`;
    }
  }
};
