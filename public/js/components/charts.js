/* ============================================================
 *  AIQwhisper — SVG Chart Library
 *  Zero-dependency, dark-themed SVG charts
 *  Line, Bar, Donut, Gauge, Sparkline
 * ============================================================ */

const Charts = {
  /* -------------------------------------------------------
   *  Helpers
   * ------------------------------------------------------- */
  _uid: 0,
  _id() { return 'chart-' + (++this._uid); },

  _svgNS: 'http://www.w3.org/2000/svg',

  _textStyle: 'fill:var(--text-secondary);font-family:var(--font);font-size:11px;',

  _lerp(a, b, t) { return a + (b - a) * t; },

  _clamp(v, min, max) { return Math.max(min, Math.min(max, v)); },

  _polarToCart(cx, cy, r, angleDeg) {
    const rad = (angleDeg - 90) * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  },

  _formatAxisValue(v) {
    if (Math.abs(v) >= 1e9) return (v / 1e9).toFixed(1) + 'B';
    if (Math.abs(v) >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (Math.abs(v) >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    if (Number.isInteger(v)) return v.toString();
    return v.toFixed(1);
  },

  _niceScale(minVal, maxVal, ticks = 5) {
    if (minVal === maxVal) { minVal -= 1; maxVal += 1; }
    const range = maxVal - minVal;
    const rough = range / ticks;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const norm = rough / mag;
    let step;
    if (norm <= 1.5) step = 1 * mag;
    else if (norm <= 3) step = 2 * mag;
    else if (norm <= 7) step = 5 * mag;
    else step = 10 * mag;
    const niceMin = Math.floor(minVal / step) * step;
    const niceMax = Math.ceil(maxVal / step) * step;
    const values = [];
    for (let v = niceMin; v <= niceMax + step * 0.5; v += step) values.push(parseFloat(v.toFixed(10)));
    return { min: niceMin, max: niceMax, step, values };
  },

  _cubicBezierPoints(pts) {
    if (pts.length < 2) return '';
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const cur = pts[i];
      const cpx1 = prev.x + (cur.x - prev.x) * 0.4;
      const cpy1 = prev.y;
      const cpx2 = cur.x - (cur.x - prev.x) * 0.4;
      const cpy2 = cur.y;
      d += ` C ${cpx1} ${cpy1}, ${cpx2} ${cpy2}, ${cur.x} ${cur.y}`;
    }
    return d;
  },

  /* -------------------------------------------------------
   *  LINE CHART
   * ------------------------------------------------------- */
  line(container, datasets, options = {}) {
    if (!container) return;
    const id = this._id();
    const {
      width = 600, height = 320,
      title = '', showGrid = true, showDots = true,
      xAxisLabel = '', yAxisLabel = '',
      padding = { top: 30, right: 30, bottom: 50, left: 60 }
    } = options;

    // Compute data bounds
    let allX = [], allY = [];
    datasets.forEach(ds => {
      ds.data.forEach(d => { allX.push(d.x); allY.push(d.y); });
    });
    if (allX.length === 0) {
      container.innerHTML = '<div class="chart-empty">No data</div>';
      return;
    }

    const isTimeSeries = typeof allX[0] === 'string' || allX[0] instanceof Date || allX[0] > 1e10;
    if (isTimeSeries) allX = allX.map(x => new Date(x).getTime());

    const xMin = Math.min(...allX);
    const xMax = Math.max(...allX);
    const yScale = this._niceScale(Math.min(...allY, 0), Math.max(...allY));

    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;

    const scaleX = v => {
      const numV = isTimeSeries ? new Date(v).getTime() : v;
      return padding.left + (xMax === xMin ? plotW / 2 : ((numV - xMin) / (xMax - xMin)) * plotW);
    };
    const scaleY = v => padding.top + plotH - ((v - yScale.min) / (yScale.max - yScale.min)) * plotH;

    let svg = `<svg viewBox="0 0 ${width} ${height}" class="chart chart-line" xmlns="${this._svgNS}">`;
    svg += `<defs>`;
    datasets.forEach((ds, i) => {
      svg += `<linearGradient id="${id}-grad-${i}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="${ds.color || 'var(--accent)'}" stop-opacity="0.3"/>
        <stop offset="100%" stop-color="${ds.color || 'var(--accent)'}" stop-opacity="0.02"/>
      </linearGradient>`;
    });
    svg += `</defs>`;

    // Title
    if (title) {
      svg += `<text x="${width / 2}" y="16" text-anchor="middle" style="fill:var(--text-primary);font-family:var(--font);font-size:13px;font-weight:600;">${title}</text>`;
    }

    // Grid lines + Y axis labels
    if (showGrid) {
      yScale.values.forEach(v => {
        const y = scaleY(v);
        if (y >= padding.top && y <= padding.top + plotH) {
          svg += `<line x1="${padding.left}" y1="${y}" x2="${padding.left + plotW}" y2="${y}" stroke="var(--border-color)" stroke-dasharray="4,4"/>`;
          svg += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" style="${this._textStyle}">${this._formatAxisValue(v)}</text>`;
        }
      });
    }

    // X axis labels
    const xTickCount = Math.min(allX.length, 8);
    const uniqueX = [...new Set(allX)].sort((a, b) => a - b);
    const xStep = Math.max(1, Math.floor(uniqueX.length / xTickCount));
    for (let i = 0; i < uniqueX.length; i += xStep) {
      const xVal = uniqueX[i];
      const x = padding.left + (xMax === xMin ? plotW / 2 : ((xVal - xMin) / (xMax - xMin)) * plotW);
      const label = isTimeSeries
        ? new Date(xVal).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : this._formatAxisValue(xVal);
      svg += `<text x="${x}" y="${height - padding.bottom + 20}" text-anchor="middle" style="${this._textStyle}">${label}</text>`;
    }

    // Axes
    svg += `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotH}" stroke="var(--border-color)"/>`;
    svg += `<line x1="${padding.left}" y1="${padding.top + plotH}" x2="${padding.left + plotW}" y2="${padding.top + plotH}" stroke="var(--border-color)"/>`;

    // Axis labels
    if (yAxisLabel) {
      svg += `<text x="14" y="${padding.top + plotH / 2}" text-anchor="middle" transform="rotate(-90,14,${padding.top + plotH / 2})" style="${this._textStyle}font-size:10px;">${yAxisLabel}</text>`;
    }
    if (xAxisLabel) {
      svg += `<text x="${padding.left + plotW / 2}" y="${height - 6}" text-anchor="middle" style="${this._textStyle}font-size:10px;">${xAxisLabel}</text>`;
    }

    // Data lines
    datasets.forEach((ds, di) => {
      const color = ds.color || 'var(--accent)';
      const sorted = [...ds.data].sort((a, b) => {
        const ax = isTimeSeries ? new Date(a.x).getTime() : a.x;
        const bx = isTimeSeries ? new Date(b.x).getTime() : b.x;
        return ax - bx;
      });
      const points = sorted.map(d => ({ x: scaleX(d.x), y: scaleY(d.y), raw: d }));
      if (points.length === 0) return;

      // Area fill
      const pathD = this._cubicBezierPoints(points);
      const areaD = pathD + ` L ${points[points.length - 1].x} ${padding.top + plotH} L ${points[0].x} ${padding.top + plotH} Z`;
      svg += `<path d="${areaD}" fill="url(#${id}-grad-${di})" class="chart-area"/>`;

      // Line
      svg += `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="chart-line-path"/>`;

      // Dots
      if (showDots) {
        points.forEach((p, pi) => {
          svg += `<circle cx="${p.x}" cy="${p.y}" r="3.5" fill="${color}" stroke="var(--bg-card)" stroke-width="2" class="chart-dot">
            <title>${ds.label || ''}: ${typeof p.raw.y === 'number' ? p.raw.y.toLocaleString() : p.raw.y}</title>
          </circle>`;
        });
      }
    });

    // Legend
    if (datasets.length > 1) {
      let lx = padding.left;
      const ly = height - 8;
      datasets.forEach((ds, i) => {
        svg += `<rect x="${lx}" y="${ly - 8}" width="12" height="3" rx="1.5" fill="${ds.color || 'var(--accent)'}"/>`;
        svg += `<text x="${lx + 16}" y="${ly - 4}" style="${this._textStyle}font-size:10px;">${ds.label || 'Series ' + (i + 1)}</text>`;
        lx += (ds.label || 'Series X').length * 6 + 30;
      });
    }

    svg += '</svg>';

    // Tooltip overlay
    const wrapperId = id + '-wrap';
    container.innerHTML = `<div class="chart-container" id="${wrapperId}">${svg}<div class="chart-tooltip" id="${id}-tooltip"></div></div>`;

    // Hover interaction
    const wrapper = document.getElementById(wrapperId);
    const tooltip = document.getElementById(id + '-tooltip');
    if (wrapper && tooltip) {
      wrapper.addEventListener('mousemove', e => {
        const rect = wrapper.querySelector('svg').getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        const ratioX = mx / rect.width;
        const ratioY = my / rect.height;
        const svgX = ratioX * width;
        const svgY = ratioY * height;

        let closest = null, closestDist = Infinity, closestDs = null;
        datasets.forEach(ds => {
          ds.data.forEach(d => {
            const px = scaleX(d.x);
            const py = scaleY(d.y);
            const dist = Math.hypot(px - svgX, py - svgY);
            if (dist < closestDist) { closestDist = dist; closest = d; closestDs = ds; }
          });
        });

        if (closest && closestDist < 40) {
          const label = closestDs ? closestDs.label : '';
          const xLabel = isTimeSeries ? new Date(closest.x).toLocaleDateString() : closest.x;
          tooltip.innerHTML = `<strong>${label}</strong><br>${xLabel}: <b>${typeof closest.y === 'number' ? closest.y.toLocaleString() : closest.y}</b>`;
          tooltip.style.opacity = '1';
          tooltip.style.left = (e.clientX - rect.left + 16) + 'px';
          tooltip.style.top = (e.clientY - rect.top - 10) + 'px';
        } else {
          tooltip.style.opacity = '0';
        }
      });
      wrapper.addEventListener('mouseleave', () => { tooltip.style.opacity = '0'; });
    }
  },

  /* -------------------------------------------------------
   *  BAR CHART
   * ------------------------------------------------------- */
  bar(container, data, options = {}) {
    if (!container) return;

    // Support both bar(el, array, opts) and bar(el, {data, ...opts})
    if (data && !Array.isArray(data) && typeof data === 'object') {
      options = data;
      data = data.data || [];
    }

    const id = this._id();
    const {
      width = 500, height = 300, title = '',
      padding = { top: 30, right: 20, bottom: 50, left: 60 },
      barColor = 'var(--accent)', showValues = true,
    } = options;

    if (!data || !Array.isArray(data) || data.length === 0) {
      container.innerHTML = '<div class="chart-empty">No data</div>';
      return;
    }

    const plotW = width - padding.left - padding.right;
    const plotH = height - padding.top - padding.bottom;
    const maxVal = Math.max(...data.map(d => d.value), 0);
    const yScale = this._niceScale(0, maxVal);
    const barW = Math.min(40, (plotW / data.length) * 0.6);
    const gap = (plotW - barW * data.length) / (data.length + 1);

    let svg = `<svg viewBox="0 0 ${width} ${height}" class="chart chart-bar" xmlns="${this._svgNS}">`;
    svg += `<defs><linearGradient id="${id}-bar-grad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${barColor}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${barColor}" stop-opacity="0.6"/>
    </linearGradient></defs>`;

    if (title) {
      svg += `<text x="${width / 2}" y="16" text-anchor="middle" style="fill:var(--text-primary);font-family:var(--font);font-size:13px;font-weight:600;">${title}</text>`;
    }

    // Grid
    yScale.values.forEach(v => {
      const y = padding.top + plotH - ((v - yScale.min) / (yScale.max - yScale.min)) * plotH;
      svg += `<line x1="${padding.left}" y1="${y}" x2="${padding.left + plotW}" y2="${y}" stroke="var(--border-color)" stroke-dasharray="4,4"/>`;
      svg += `<text x="${padding.left - 8}" y="${y + 4}" text-anchor="end" style="${this._textStyle}">${this._formatAxisValue(v)}</text>`;
    });

    // Bars
    data.forEach((d, i) => {
      const color = d.color || `url(#${id}-bar-grad)`;
      const x = padding.left + gap * (i + 1) + barW * i;
      const barH = maxVal === 0 ? 0 : (d.value / yScale.max) * plotH;
      const y = padding.top + plotH - barH;

      svg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" ry="4" fill="${color}" class="chart-bar-rect" style="animation: barGrow 0.5s ease ${i * 60}ms both;">
        <title>${d.label}: ${d.value.toLocaleString()}</title>
      </rect>`;

      if (showValues && d.value > 0) {
        svg += `<text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" style="${this._textStyle}font-size:10px;font-weight:600;">${this._formatAxisValue(d.value)}</text>`;
      }

      // X labels
      svg += `<text x="${x + barW / 2}" y="${height - padding.bottom + 18}" text-anchor="middle" style="${this._textStyle}font-size:10px;" transform="rotate(-30,${x + barW / 2},${height - padding.bottom + 18})">${d.label}</text>`;
    });

    // Axes
    svg += `<line x1="${padding.left}" y1="${padding.top}" x2="${padding.left}" y2="${padding.top + plotH}" stroke="var(--border-color)"/>`;
    svg += `<line x1="${padding.left}" y1="${padding.top + plotH}" x2="${padding.left + plotW}" y2="${padding.top + plotH}" stroke="var(--border-color)"/>`;

    svg += '</svg>';
    container.innerHTML = `<div class="chart-container">${svg}</div>`;
  },

  /* -------------------------------------------------------
   *  DONUT CHART
   * ------------------------------------------------------- */
  donut(container, segments, options = {}) {
    if (!container) return;

    // Support both donut(el, array, opts) and donut(el, {data, ...opts})
    if (segments && !Array.isArray(segments) && typeof segments === 'object') {
      options = segments;
      segments = segments.data || [];
    }

    const {
      size = 240, thickness = 32, title = '', showLegend = true,
      centerLabel = '', centerValue = '',
    } = options;

    if (!segments || !Array.isArray(segments) || segments.length === 0) {
      container.innerHTML = '<div class="chart-empty">No data</div>';
      return;
    }

    const total = segments.reduce((s, seg) => s + seg.value, 0);
    const cx = size / 2, cy = size / 2;
    const outerR = (size - 20) / 2;
    const innerR = outerR - thickness;

    let svg = `<svg viewBox="0 0 ${size} ${size}" class="chart chart-donut" xmlns="${this._svgNS}">`;

    // Background ring
    svg += `<circle cx="${cx}" cy="${cy}" r="${(outerR + innerR) / 2}" fill="none" stroke="var(--border-color)" stroke-width="${thickness}" opacity="0.3"/>`;

    let currentAngle = -90;
    segments.forEach((seg, i) => {
      if (seg.value <= 0) return;
      const angle = (seg.value / total) * 360;
      const startAngle = currentAngle;
      const endAngle = currentAngle + angle;
      const largeArc = angle > 180 ? 1 : 0;
      const midR = (outerR + innerR) / 2;

      const start = this._polarToCart(cx, cy, midR, startAngle);
      const end = this._polarToCart(cx, cy, midR, endAngle - 0.5);

      svg += `<path d="M ${start.x} ${start.y} A ${midR} ${midR} 0 ${largeArc} 1 ${end.x} ${end.y}"
        fill="none" stroke="${seg.color || 'var(--accent)'}" stroke-width="${thickness}"
        stroke-linecap="round" class="donut-segment"
        style="animation: donutDraw 0.8s ease ${i * 100}ms both;">
        <title>${seg.label}: ${seg.value.toLocaleString()} (${total > 0 ? ((seg.value / total) * 100).toFixed(1) : 0}%)</title>
      </path>`;

      currentAngle = endAngle;
    });

    // Center text
    const cValue = centerValue || (total !== undefined ? total.toLocaleString() : '');
    const cLabel = centerLabel || 'Total';
    svg += `<text x="${cx}" y="${cy - 6}" text-anchor="middle" style="fill:var(--text-primary);font-family:var(--font);font-size:20px;font-weight:700;">${cValue}</text>`;
    svg += `<text x="${cx}" y="${cy + 14}" text-anchor="middle" style="fill:var(--text-secondary);font-family:var(--font);font-size:11px;">${cLabel}</text>`;

    svg += '</svg>';

    // Legend
    let legend = '';
    if (showLegend) {
      legend = '<div class="chart-legend">';
      segments.forEach(seg => {
        const pct = total > 0 ? ((seg.value / total) * 100).toFixed(1) : '0.0';
        legend += `<div class="legend-item">
          <span class="legend-dot" style="background:${seg.color || 'var(--accent)'}"></span>
          <span class="legend-label">${seg.label}</span>
          <span class="legend-value">${seg.value.toLocaleString()} (${pct}%)</span>
        </div>`;
      });
      legend += '</div>';
    }

    container.innerHTML = `<div class="chart-container chart-donut-wrapper">${svg}${legend}</div>`;
  },

  /* -------------------------------------------------------
   *  GAUGE CHART
   * ------------------------------------------------------- */
  gauge(container, value, max, options = {}) {
    if (!container) return;
    const id = this._id();
    const {
      size = 200, title = '', unit = '%',
      thresholds = { green: 60, yellow: 80, red: 100 },
    } = options;

    const pct = max > 0 ? this._clamp((value / max) * 100, 0, 100) : 0;
    const cx = size / 2, cy = size / 2 + 10;
    const r = (size - 40) / 2;
    const startAngle = -210;
    const endAngle = 30;
    const totalArc = endAngle - startAngle;
    const valueAngle = startAngle + (pct / 100) * totalArc;

    // Determine color
    let color;
    if (pct <= thresholds.green) color = 'var(--success)';
    else if (pct <= thresholds.yellow) color = 'var(--warning)';
    else color = 'var(--danger)';

    let svg = `<svg viewBox="0 0 ${size} ${size}" class="chart chart-gauge" xmlns="${this._svgNS}">`;

    svg += `<defs>
      <linearGradient id="${id}-gauge-bg" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="var(--success)" stop-opacity="0.15"/>
        <stop offset="50%" stop-color="var(--warning)" stop-opacity="0.15"/>
        <stop offset="100%" stop-color="var(--danger)" stop-opacity="0.15"/>
      </linearGradient>
      <linearGradient id="${id}-gauge-fill" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0%" stop-color="var(--success)"/>
        <stop offset="60%" stop-color="var(--warning)"/>
        <stop offset="100%" stop-color="var(--danger)"/>
      </linearGradient>
    </defs>`;

    // Background arc
    const bgStart = this._polarToCart(cx, cy, r, startAngle);
    const bgEnd = this._polarToCart(cx, cy, r, endAngle);
    svg += `<path d="M ${bgStart.x} ${bgStart.y} A ${r} ${r} 0 1 1 ${bgEnd.x} ${bgEnd.y}"
      fill="none" stroke="var(--border-color)" stroke-width="12" stroke-linecap="round" opacity="0.4"/>`;

    // Value arc
    if (pct > 0) {
      const valEnd = this._polarToCart(cx, cy, r, valueAngle);
      const largeArc = (valueAngle - startAngle) > 180 ? 1 : 0;
      svg += `<path d="M ${bgStart.x} ${bgStart.y} A ${r} ${r} 0 ${largeArc} 1 ${valEnd.x} ${valEnd.y}"
        fill="none" stroke="${color}" stroke-width="12" stroke-linecap="round"
        class="gauge-fill" style="filter: drop-shadow(0 0 6px ${color});">
      </path>`;
    }

    // Tick marks
    for (let t = 0; t <= 100; t += 10) {
      const tAngle = startAngle + (t / 100) * totalArc;
      const outer = this._polarToCart(cx, cy, r + 10, tAngle);
      const inner = this._polarToCart(cx, cy, r + 4, tAngle);
      svg += `<line x1="${inner.x}" y1="${inner.y}" x2="${outer.x}" y2="${outer.y}" stroke="var(--text-muted)" stroke-width="1"/>`;
    }

    // Center value
    const displayVal = unit === '%' ? pct.toFixed(1) + '%' : value.toLocaleString() + (unit ? ' ' + unit : '');
    svg += `<text x="${cx}" y="${cy + 4}" text-anchor="middle" style="fill:var(--text-primary);font-family:var(--font);font-size:22px;font-weight:700;">${displayVal}</text>`;
    if (title) {
      svg += `<text x="${cx}" y="${cy + 22}" text-anchor="middle" style="fill:var(--text-secondary);font-family:var(--font);font-size:11px;">${title}</text>`;
    }

    svg += '</svg>';
    container.innerHTML = `<div class="chart-container">${svg}</div>`;
  },

  /* -------------------------------------------------------
   *  SPARKLINE
   * ------------------------------------------------------- */
  sparkline(container, values, options = {}) {
    if (!container) return;
    const {
      width = 120, height = 32,
      color = 'var(--accent)', filled = true, strokeWidth = 1.5,
    } = options;

    if (!values || values.length < 2) {
      container.innerHTML = `<svg viewBox="0 0 ${width} ${height}" class="sparkline"><line x1="0" y1="${height / 2}" x2="${width}" y2="${height / 2}" stroke="var(--border-color)" stroke-width="1"/></svg>`;
      return;
    }

    const pad = 2;
    const minV = Math.min(...values);
    const maxV = Math.max(...values);
    const range = maxV - minV || 1;

    const pts = values.map((v, i) => ({
      x: pad + (i / (values.length - 1)) * (width - pad * 2),
      y: pad + (1 - (v - minV) / range) * (height - pad * 2),
    }));

    const pathD = this._cubicBezierPoints(pts);

    let svg = `<svg viewBox="0 0 ${width} ${height}" class="sparkline" xmlns="${this._svgNS}">`;

    if (filled) {
      const areaD = pathD + ` L ${pts[pts.length - 1].x} ${height} L ${pts[0].x} ${height} Z`;
      svg += `<path d="${areaD}" fill="${color}" opacity="0.15"/>`;
    }

    svg += `<path d="${pathD}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`;

    // End dot
    const last = pts[pts.length - 1];
    svg += `<circle cx="${last.x}" cy="${last.y}" r="2" fill="${color}"/>`;

    svg += '</svg>';
    container.innerHTML = svg;
  }
};
