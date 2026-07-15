/* ============================================================
 *  AIQwhisper — Data Table Component
 *  Sortable, searchable, paginated dark-themed tables
 * ============================================================ */

const Tables = {
  /**
   * Create a full-featured data table.
   *
   * @param {HTMLElement} container
   * @param {Object}      config
   * @param {Array}       config.columns    – [{key, label, sortable, formatter, width}]
   * @param {Array}       config.data       – row objects
   * @param {number}      [config.pageSize] – rows per page (default 15)
   * @param {Function}    [config.onRowClick] – callback(row)
   * @param {string}      [config.emptyMessage] – shown when no data
   * @param {boolean}     [config.searchable] – show search box (default true)
   */
  create(container, config) {
    if (!container) return;

    const {
      columns = [],
      data = [],
      pageSize = 15,
      onRowClick = null,
      emptyMessage = 'No data available.',
      searchable = true,
    } = config;

    // Internal state
    const state = {
      sortKey: null,
      sortDir: 'asc',
      page: 1,
      search: '',
      filteredData: [...data],
    };

    function applyFilter() {
      const q = state.search.toLowerCase().trim();
      if (!q) {
        state.filteredData = [...data];
      } else {
        state.filteredData = data.filter(row =>
          columns.some(col => {
            const val = row[col.key];
            return val !== null && val !== undefined && String(val).toLowerCase().includes(q);
          })
        );
      }
    }

    function applySort() {
      if (!state.sortKey) return;
      const key = state.sortKey;
      const dir = state.sortDir === 'asc' ? 1 : -1;
      state.filteredData.sort((a, b) => {
        let va = a[key], vb = b[key];
        if (va === null || va === undefined) va = '';
        if (vb === null || vb === undefined) vb = '';
        if (typeof va === 'number' && typeof vb === 'number') return (va - vb) * dir;
        return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: 'base' }) * dir;
      });
    }

    function render() {
      applyFilter();
      applySort();

      const totalPages = Math.max(1, Math.ceil(state.filteredData.length / pageSize));
      if (state.page > totalPages) state.page = totalPages;
      const startIdx = (state.page - 1) * pageSize;
      const pageData = state.filteredData.slice(startIdx, startIdx + pageSize);

      let html = '<div class="table-wrapper">';

      // Toolbar
      if (searchable) {
        html += `
          <div class="table-toolbar">
            <div class="table-search">
              <input type="text" class="input table-search-input"
                     placeholder="Search…" value="${escapeHtml(state.search)}">
            </div>
            <div class="table-info">
              ${state.filteredData.length} record${state.filteredData.length !== 1 ? 's' : ''}
            </div>
          </div>`;
      }

      // Table
      html += '<div class="table-scroll"><table class="data-table"><thead><tr>';
      columns.forEach(col => {
        const sortable = col.sortable !== false;
        const isSorted = state.sortKey === col.key;
        const arrow = isSorted ? (state.sortDir === 'asc' ? ' ▲' : ' ▼') : '';
        const cls = sortable ? 'sortable' : '';
        const sortedCls = isSorted ? ' sorted' : '';
        const widthStyle = col.width ? ` style="width:${col.width}"` : '';
        html += `<th class="${cls}${sortedCls}" data-key="${col.key}"${widthStyle}>${escapeHtml(col.label)}${arrow}</th>`;
      });
      html += '</tr></thead><tbody>';

      if (pageData.length === 0) {
        html += `<tr><td colspan="${columns.length}" class="table-empty">${escapeHtml(emptyMessage)}</td></tr>`;
      } else {
        pageData.forEach((row, ri) => {
          const clickable = onRowClick ? ' class="clickable"' : '';
          html += `<tr data-row-index="${startIdx + ri}"${clickable}>`;
          columns.forEach(col => {
            const raw = row[col.key];
            const display = col.formatter ? col.formatter(raw, row) : (raw !== null && raw !== undefined ? escapeHtml(String(raw)) : '–');
            html += `<td>${display}</td>`;
          });
          html += '</tr>';
        });
      }

      html += '</tbody></table></div>';

      // Pagination
      if (totalPages > 1) {
        html += '<div class="table-pagination">';
        html += `<button class="btn btn-ghost btn-sm pagination-btn" data-page="prev" ${state.page <= 1 ? 'disabled' : ''}>‹ Prev</button>`;
        const pages = paginationRange(state.page, totalPages);
        pages.forEach(p => {
          if (p === '…') {
            html += `<span class="pagination-ellipsis">…</span>`;
          } else {
            html += `<button class="btn btn-ghost btn-sm pagination-btn ${p === state.page ? 'pagination-active' : ''}" data-page="${p}">${p}</button>`;
          }
        });
        html += `<button class="btn btn-ghost btn-sm pagination-btn" data-page="next" ${state.page >= totalPages ? 'disabled' : ''}>Next ›</button>`;
        html += '</div>';
      }

      html += '</div>';
      container.innerHTML = html;

      // Bind events
      bindEvents();
    }

    function bindEvents() {
      // Search
      const searchInput = container.querySelector('.table-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', debounce(e => {
          state.search = e.target.value;
          state.page = 1;
          render();
        }, 250));
        // Re-focus after render
        searchInput.focus();
        searchInput.setSelectionRange(searchInput.value.length, searchInput.value.length);
      }

      // Sort headers
      container.querySelectorAll('th.sortable').forEach(th => {
        th.addEventListener('click', () => {
          const key = th.dataset.key;
          if (state.sortKey === key) {
            state.sortDir = state.sortDir === 'asc' ? 'desc' : 'asc';
          } else {
            state.sortKey = key;
            state.sortDir = 'asc';
          }
          render();
        });
      });

      // Pagination
      container.querySelectorAll('.pagination-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const p = btn.dataset.page;
          const totalPages = Math.max(1, Math.ceil(state.filteredData.length / pageSize));
          if (p === 'prev') { state.page = Math.max(1, state.page - 1); }
          else if (p === 'next') { state.page = Math.min(totalPages, state.page + 1); }
          else { state.page = parseInt(p, 10); }
          render();
        });
      });

      // Row click
      if (onRowClick) {
        container.querySelectorAll('tr.clickable').forEach(tr => {
          tr.addEventListener('click', () => {
            const idx = parseInt(tr.dataset.rowIndex, 10);
            onRowClick(state.filteredData[idx] || data[idx]);
          });
        });
      }
    }

    function paginationRange(current, total) {
      const delta = 2;
      const range = [];
      const left = Math.max(2, current - delta);
      const right = Math.min(total - 1, current + delta);

      range.push(1);
      if (left > 2) range.push('…');
      for (let i = left; i <= right; i++) range.push(i);
      if (right < total - 1) range.push('…');
      if (total > 1) range.push(total);
      return range;
    }

    // Ensure helper is available
    if (typeof escapeHtml === 'undefined') {
      window.escapeHtml = function(s) {
        if (!s) return '';
        const m = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' };
        return String(s).replace(/[&<>"']/g, c => m[c]);
      };
    }
    if (typeof debounce === 'undefined') {
      window.debounce = function(fn, d) {
        let t; return function(...a) { clearTimeout(t); t = setTimeout(() => fn.apply(this, a), d); };
      };
    }

    render();
    return { render, getState: () => state };
  }
};
