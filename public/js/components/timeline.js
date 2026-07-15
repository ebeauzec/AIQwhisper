/* ============================================================
 *  AIQwhisper — Timeline Component
 *  Vertical timeline with severity dots, relative time, source
 * ============================================================ */

const Timeline = {
  /**
   * Render a vertical timeline of events.
   *
   * @param {HTMLElement} container  – element to render into
   * @param {Array} events          – [{title, description, timestamp, severity, source}]
   * @param {Object} [options]      – optional overrides
   * @param {number} [options.maxItems] – max events to display (default: all)
   */
  create(container, events, options = {}) {
    if (!container) return;
    const items = options.maxItems ? events.slice(0, options.maxItems) : events;

    if (!items || items.length === 0) {
      container.innerHTML = `
        <div class="timeline-empty">
          <p>No events to display.</p>
        </div>`;
      return;
    }

    // Sort newest first
    const sorted = [...items].sort((a, b) => {
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });

    const severityColor = (sev) => {
      const map = {
        critical: 'var(--danger)',
        error: 'var(--danger)',
        high: 'var(--danger)',
        warning: 'var(--warning)',
        medium: 'var(--warning)',
        info: 'var(--info)',
        low: 'var(--info)',
        success: 'var(--success)',
        normal: 'var(--success)',
      };
      return map[(sev || '').toLowerCase()] || 'var(--accent)';
    };

    const severityClass = (sev) => {
      const map = {
        critical: 'badge-critical',
        error: 'badge-critical',
        high: 'badge-critical',
        warning: 'badge-warning',
        medium: 'badge-warning',
        info: 'badge-info',
        low: 'badge-info',
        success: 'badge-success',
        normal: 'badge-success',
      };
      return map[(sev || '').toLowerCase()] || 'badge-info';
    };

    let html = '<div class="timeline">';

    sorted.forEach((event, idx) => {
      const color = severityColor(event.severity);
      const relTime = typeof timeAgo === 'function' ? timeAgo(event.timestamp) : '';
      const absTime = event.timestamp ? new Date(event.timestamp).toLocaleString() : '';
      const sevBadge = event.severity
        ? `<span class="badge ${severityClass(event.severity)}">${escapeHtml(event.severity)}</span>`
        : '';
      const srcBadge = event.source
        ? `<span class="badge badge-info">${escapeHtml(event.source)}</span>`
        : '';
      const desc = event.description
        ? `<p class="timeline-desc">${escapeHtml(event.description)}</p>`
        : '';

      html += `
        <div class="timeline-item" style="animation-delay: ${idx * 60}ms">
          <div class="timeline-dot" style="background: ${color}; box-shadow: 0 0 8px ${color}"></div>
          <div class="timeline-connector"></div>
          <div class="timeline-content">
            <div class="timeline-header">
              <span class="timeline-title">${escapeHtml(event.title || 'Event')}</span>
              <span class="timeline-time" title="${absTime}">${relTime}</span>
            </div>
            ${desc}
            <div class="timeline-meta">
              ${sevBadge}${srcBadge}
            </div>
          </div>
        </div>`;
    });

    html += '</div>';
    container.innerHTML = html;
  }
};
