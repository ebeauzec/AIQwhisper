/* ============================================================
 *  AIQwhisper — Systems View
 *  System cards grid with add/edit/delete/test/collect actions
 * ============================================================ */

const SystemsView = {
  async render(container) {
    showLoading(container, 'Loading systems…');

    try {
      const res = await api.get('/systems');
      const systems = res.data || [];

      container.innerHTML = `
        <div class="page-header">
          <h2>Systems</h2>
          <span class="subtitle">Managed Storage Systems</span>
        </div>
        <div class="toolbar">
          <button class="btn btn-primary" id="btn-add-system">+ Add System</button>
        </div>
        <div class="systems-grid" id="systems-grid"></div>`;

      document.getElementById('btn-add-system').addEventListener('click', () => this.showAddModal());

      const grid = document.getElementById('systems-grid');
      if (!systems.length) {
        grid.innerHTML = `
          <div class="empty-state" style="grid-column:1/-1">
            <div class="empty-state-icon">⚙</div>
            <h2>No Systems Registered</h2>
            <p>Add your first storage system to begin monitoring.</p>
          </div>`;
        return;
      }

      grid.innerHTML = systems.map((sys, i) => {
        const statusDot = sys.status === 'online' ? 'online' : sys.status === 'degraded' ? 'degraded' : 'offline';
        const typeBadge = { ontap: 'badge-info', storagegrid: 'badge-success', eseries: 'badge-warning' };
        return `
          <div class="system-card card" style="animation-delay:${i * 60}ms">
            <div class="system-card-header">
              <div class="system-card-title">${escapeHtml(sys.name)}</div>
              <span class="badge ${typeBadge[sys.type] || 'badge-info'}">${escapeHtml(sys.type)}</span>
            </div>
            <div class="system-card-body">
              <div class="system-detail"><span class="detail-label">Hostname</span><span class="detail-value">${escapeHtml(sys.hostname)}:${sys.port || 443}</span></div>
              <div class="system-detail"><span class="detail-label">Status</span><span class="status-dot ${statusDot}"></span> ${escapeHtml(sys.status || 'unknown')}</div>
              <div class="system-detail"><span class="detail-label">Version</span><span class="detail-value">${escapeHtml(sys.version || '–')}</span></div>
              <div class="system-detail"><span class="detail-label">Last Polled</span><span class="detail-value">${timeAgo(sys.last_polled_at)}</span></div>
            </div>
            <div class="system-card-actions">
              <button class="btn btn-ghost btn-sm" onclick="SystemsView.testConnection(${sys.id})">Test</button>
              <button class="btn btn-ghost btn-sm" onclick="SystemsView.collectNow(${sys.id})">Collect</button>
              <button class="btn btn-ghost btn-sm" onclick="SystemsView.showEditModal(${sys.id})">Edit</button>
              <button class="btn btn-ghost btn-sm btn-danger" onclick="SystemsView.deleteSystem(${sys.id}, '${escapeHtml(sys.name)}')">Delete</button>
            </div>
          </div>`;
      }).join('');
    } catch (err) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">⚠</div>
          <h2>Failed to Load Systems</h2>
          <p>${escapeHtml(err.message)}</p>
          <button class="btn btn-primary" onclick="SystemsView.render(document.getElementById('app'))">Retry</button>
        </div>`;
    }
  },

  showAddModal() {
    const formHtml = `
      <div class="form-group"><label>Type</label>
        <select class="input select" id="sys-type"><option value="ontap">ONTAP</option><option value="storagegrid">StorageGRID</option><option value="eseries">E-Series</option></select>
      </div>
      <div class="form-group"><label>Name</label><input class="input" id="sys-name" placeholder="Production Cluster"></div>
      <div class="form-group"><label>Hostname / IP</label><input class="input" id="sys-hostname" placeholder="192.168.1.100"></div>
      <div class="form-group"><label>Port</label><input class="input" id="sys-port" type="number" value="443"></div>
      <div class="form-group"><label>Username</label><input class="input" id="sys-username" placeholder="admin"></div>
      <div class="form-group"><label>Password</label><input class="input" id="sys-password" type="password"></div>
      <div id="sys-test-result"></div>`;

    const overlay = showModal('Add System', formHtml, [
      { id: 'test', label: 'Test Connection', className: 'btn btn-ghost', onClick: () => this.testNewSystem(overlay) },
      { id: 'save', label: 'Save System', className: 'btn btn-primary', onClick: () => this.saveNewSystem(overlay) }
    ]);
  },

  async testNewSystem(overlay) {
    const resultEl = overlay.querySelector('#sys-test-result');
    if (resultEl) resultEl.innerHTML = '<span style="color:var(--accent)">Testing…</span>';
    // Test requires a saved system; show info message
    if (resultEl) resultEl.innerHTML = '<span style="color:var(--warning)">Save the system first, then use the Test button on its card.</span>';
  },

  async saveNewSystem(overlay) {
    const body = {
      type: overlay.querySelector('#sys-type')?.value,
      name: overlay.querySelector('#sys-name')?.value,
      hostname: overlay.querySelector('#sys-hostname')?.value,
      port: Number(overlay.querySelector('#sys-port')?.value) || 443,
      username: overlay.querySelector('#sys-username')?.value,
      password: overlay.querySelector('#sys-password')?.value
    };

    if (!body.name || !body.hostname) {
      showToast('Name and hostname are required', 'warning');
      return;
    }

    try {
      await api.post('/systems', body);
      showToast('System added successfully', 'success');
      closeModal(overlay);
      this.render(document.getElementById('app'));
    } catch (err) {
      showToast('Failed to add system: ' + err.message, 'error');
    }
  },

  async showEditModal(id) {
    try {
      const res = await api.get(`/systems/${id}`);
      const sys = res.data;

      const formHtml = `
        <div class="form-group"><label>Type</label>
          <select class="input select" id="edit-type"><option value="ontap" ${sys.type === 'ontap' ? 'selected' : ''}>ONTAP</option><option value="storagegrid" ${sys.type === 'storagegrid' ? 'selected' : ''}>StorageGRID</option><option value="eseries" ${sys.type === 'eseries' ? 'selected' : ''}>E-Series</option></select>
        </div>
        <div class="form-group"><label>Name</label><input class="input" id="edit-name" value="${escapeHtml(sys.name)}"></div>
        <div class="form-group"><label>Hostname</label><input class="input" id="edit-hostname" value="${escapeHtml(sys.hostname)}"></div>
        <div class="form-group"><label>Port</label><input class="input" id="edit-port" type="number" value="${sys.port || 443}"></div>
        <div class="form-group"><label>Username (leave blank to keep)</label><input class="input" id="edit-username"></div>
        <div class="form-group"><label>Password (leave blank to keep)</label><input class="input" id="edit-password" type="password"></div>`;

      const overlay = showModal('Edit System', formHtml, [
        { id: 'save', label: 'Save Changes', className: 'btn btn-primary', onClick: async () => {
          const body = {
            type: overlay.querySelector('#edit-type')?.value,
            name: overlay.querySelector('#edit-name')?.value,
            hostname: overlay.querySelector('#edit-hostname')?.value,
            port: Number(overlay.querySelector('#edit-port')?.value) || 443
          };
          const username = overlay.querySelector('#edit-username')?.value;
          const password = overlay.querySelector('#edit-password')?.value;
          if (username) body.username = username;
          if (password) body.password = password;

          try {
            await api.put(`/systems/${id}`, body);
            showToast('System updated', 'success');
            closeModal(overlay);
            this.render(document.getElementById('app'));
          } catch (err) {
            showToast('Failed to update: ' + err.message, 'error');
          }
        }}
      ]);
    } catch (err) {
      showToast('Failed to load system: ' + err.message, 'error');
    }
  },

  async testConnection(id) {
    showToast('Testing connection…', 'info');
    try {
      const res = await api.post(`/systems/${id}/test`);
      const d = res.data || {};
      showToast(d.success ? 'Connection successful!' : 'Connection failed: ' + (d.message || 'Unknown error'),
        d.success ? 'success' : 'error');
    } catch (err) {
      showToast('Test failed: ' + err.message, 'error');
    }
  },

  async collectNow(id) {
    showToast('Starting collection…', 'info');
    try {
      const res = await api.post(`/systems/${id}/collect`);
      showToast(`Collection started (run #${res.data?.runId})`, 'success');
    } catch (err) {
      showToast('Collection failed: ' + err.message, 'error');
    }
  },

  async deleteSystem(id, name) {
    if (!confirm(`Delete system "${name}"? This removes all associated data.`)) return;
    try {
      await api.delete(`/systems/${id}`);
      showToast('System deleted', 'success');
      this.render(document.getElementById('app'));
    } catch (err) {
      showToast('Failed to delete: ' + err.message, 'error');
    }
  }
};
