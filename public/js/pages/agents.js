// Agents Page — with profile images + model/provider editing
let gatewayNodes = [];
let agentImageIds = new Set();

export async function init(el) {
  el.innerHTML = buildLayout();
  await load();
  bindEvents(el);
  window.addEventListener('mc:event', (e) => {
    if (e.detail.type === 'GATEWAY_NODES') { gatewayNodes = e.detail.payload?.nodes || []; renderGatewayAgents(); }
    if (e.detail.type === 'GATEWAY_AGENTS_UPDATED') { gatewayNodes = e.detail.payload?.agents || []; renderGatewayAgents(); }
  });
}
export async function refresh() { await load(); }

async function load() {
  [gatewayNodes] = await Promise.all([
    window.apiFetch('/gateway/agents').catch(() => []),
  ]);
  // Load which agents have custom images
  const ids = await window.apiFetch('/agents/images/list').catch(() => []);
  agentImageIds = new Set(ids || []);
  renderGatewayAgents();
}

function buildLayout() {
  return `
  <div class="section-header">
    <div>
      <h2 class="section-title"><i class="fa fa-satellite-dish"></i> Live Agents</h2>
      <div style="font-size:0.8rem;color:var(--color-text-muted);">Agents connected to your OpenClaw Gateway</div>
    </div>
  </div>
  <div id="gateway-agents-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:1rem;"></div>
  <input type="file" id="agent-img-upload" accept="image/png,image/jpeg,image/gif" style="display:none;">`;
}

function renderGatewayAgents() {
  const grid = document.getElementById('gateway-agents-grid');
  if (!grid) return;
  if (!gatewayNodes || !gatewayNodes.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><i class="fa fa-plug-circle-xmark"></i><p>No agents found.<br>Connect your Gateway to see live agents.</p></div>`;
    return;
  }
  grid.innerHTML = gatewayNodes.map(n => {
    const name = n.name || n.id;
    const kind = n.kind || 'unknown';
    const status = n.status || 'offline';
    const scopes = (n.scopes || []).join(', ') || 'none';
    const lastPing = n.stats?.lastPing ? new Date(n.stats.lastPing).toLocaleTimeString() : 'never';
    const model = n.model || '—';
    const imgSrc = `/api/agents/${n.id}/image?t=${Date.now()}`;
    const fallbackIcon = kind === 'operator' ? 'fa-server' : 'fa-robot';

    // Always attempt to load the image; onerror reveals the fallback icon div
    const avatar = `
      <div style="width:44px;height:44px;border-radius:50%;background:var(--color-surface);border:2px solid var(--color-accent);display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;" class="agent-avatar-wrap">
        <i class="fa ${fallbackIcon}" style="color:var(--color-accent);" data-fallback></i>
        <img src="${imgSrc}" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.style.display='none'" onload="this.previousElementSibling.style.display='none'">
      </div>`;
    // Keep agentImageIds sync for future uploads but don't gate image display
    const hasImg = true; // always try

    const statusColor = { online: '#10b981', active: '#10b981', busy: '#f59e0b', idle: '#eab308', offline: '#6b7280', error: '#ef4444' }[status] || '#6b7280';

    return `
  <div class="card" style="position:relative;">
    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;">
      <div style="position:relative;flex-shrink:0;">
        ${avatar}
        <span style="position:absolute;bottom:1px;right:1px;width:10px;height:10px;border-radius:50%;background:${statusColor};border:1.5px solid var(--color-card);"></span>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(name)}</div>
        <div style="font-size:0.72rem;color:var(--color-text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${escHtml(n.id)}</div>
      </div>
      <span class="badge ${status === 'online' || status === 'active' ? 'badge-active' : status === 'busy' ? 'badge-warning' : 'badge-danger'}" style="flex-shrink:0;">${status}</span>
    </div>
    <div class="divider"></div>
    <div style="font-size:0.78rem;display:grid;grid-template-columns:1fr 1fr;gap:0.35rem;margin-top:0.5rem;">
      <div><span class="text-muted">Kind:</span> ${escHtml(kind)}</div>
      <div><span class="text-muted">Ping:</span> ${lastPing}</div>
      <div><span class="text-muted">Model:</span> <span style="color:var(--color-accent);">${escHtml(model)}</span></div>
      <div><span class="text-muted">Default:</span> ${n.isDefault ? '★ Yes' : 'No'}</div>
      <div style="grid-column:1/-1;color:var(--color-text-muted);font-size:0.7rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(scopes)}">Scopes: ${escHtml(scopes)}</div>
    </div>
    <div style="margin-top:0.75rem;display:flex;gap:0.4rem;justify-content:flex-end;flex-wrap:wrap;">
      <button class="btn btn-sm btn-ghost" data-action="upload-image" data-id="${n.id}" title="Set profile image"><i class="fa fa-image"></i></button>
      <button class="btn btn-sm btn-ghost" data-action="edit-agent" data-id="${n.id}" title="Edit model/provider"><i class="fa fa-sliders"></i> Edit</button>
      ${kind !== 'operator' ? `<button class="btn btn-sm btn-secondary" data-action="chat-gateway-agent" data-id="${n.id}"><i class="fa fa-comment"></i> Chat</button>` : ''}
    </div>
  </div>`;
  }).join('');
}

function bindEvents(el) {
  el.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    const action = actionBtn.dataset.action;
    const id = actionBtn.dataset.id;

    if (action === 'chat-gateway-agent') {
      window.navigate?.('chat', { agentId: id, source: 'gateway' });
    }
    if (action === 'upload-image') {
      const uploader = document.getElementById('agent-img-upload');
      uploader.dataset.targetId = id;
      uploader.click();
    }
    if (action === 'edit-agent') {
      const agent = gatewayNodes.find(n => n.id === id);
      openEditModal(agent);
    }
  });

  document.getElementById('agent-img-upload')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    const agentId = e.target.dataset.targetId;
    if (!file || !agentId) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const data = ev.target.result; // base64 data URL
      try {
        await window.apiFetch(`/agents/${agentId}/image`, { method: 'POST', body: { data, type: file.type } });
        agentImageIds.add(agentId);
        renderGatewayAgents();
        window.showToast('Profile image updated!', 'success');
      } catch (err) { window.showToast('Image upload failed: ' + err.message, 'error'); }
    };
    reader.readAsDataURL(file);
    e.target.value = '';
  });
}

function openEditModal(agent) {
  if (!agent) return;
  window.openModal(`
  <div class="modal-header">
    <span class="modal-title"><i class="fa fa-sliders"></i> Edit Agent — ${escHtml(agent.name || agent.id)}</span>
    <button class="icon-btn" onclick="closeModal()"><i class="fa fa-xmark"></i></button>
  </div>
  <div style="font-size:0.78rem;color:var(--color-text-muted);background:var(--color-surface);padding:0.5rem;border-radius:6px;margin-bottom:0.75rem;">
    <strong>Agent ID:</strong> ${escHtml(agent.id)}<br>
    <strong>Kind:</strong> ${escHtml(agent.kind || '—')}<br>
    Changes are saved to openclaw.json and require an OpenClaw restart to take effect.
  </div>
  <div class="form-group">
    <label class="form-label">Primary Model</label>
    <input class="form-input font-mono" id="ea-model" value="${escHtml(typeof agent.model === 'object' ? (agent.model?.primary || '') : (agent.model || ''))}" placeholder="claude-3-5-sonnet-20241022">
  </div>
  <div class="form-group">
    <label class="form-label">Fallback Model</label>
    <input class="form-input font-mono" id="ea-fallback" value="${escHtml(agent.fallback_model || typeof agent.model === 'object' ? (agent.model?.fallback || '') : '')}" placeholder="gemini-2.0-flash">
  </div>
  <div class="form-group">
    <label class="form-label">Display Name</label>
    <input class="form-input" id="ea-name" value="${escHtml(agent.name || '')}">
  </div>
  <div class="form-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="window._saveAgentEdit('${agent.id}')"><i class="fa fa-save"></i> Save to Config</button>
  </div>`);

  window._saveAgentEdit = async (agentId) => {
    const model = document.getElementById('ea-model').value.trim();
    const fallback = document.getElementById('ea-fallback').value.trim();
    const name = document.getElementById('ea-name').value.trim();
    try {
      // Read current config, patch the agent entry, save back
      const cfg = await window.apiFetch('/config');
      const obj = JSON.parse(cfg.content || '{}');
      const agentList = Array.isArray(obj.agents) ? obj.agents : (obj.agents?.list || []);
      const idx = agentList.findIndex(a => a.id === agentId);
      if (idx >= 0) {
        if (model) agentList[idx].model = fallback ? { primary: model, fallback } : model;
        if (name) agentList[idx].name = name;
        if (Array.isArray(obj.agents)) obj.agents = agentList;
        else obj.agents.list = agentList;
      } else if (obj.agent && (!obj.agent.id || obj.agent.id === agentId || agentId === 'local' || agentList.length === 0)) {
        // Fallback for singleton configuration
        if (model) obj.agent.model = fallback ? { primary: model, fallback } : model;
        if (name) obj.agent.name = name;
      } else {
        if (!obj.agents) obj.agents = [];
        if (Array.isArray(obj.agents)) obj.agents.push({ id: agentId, name: name || agentId, model: fallback ? { primary: model, fallback } : model });
      }
      await window.apiFetch('/config', { method: 'POST', body: { content: JSON.stringify(obj, null, 2) } });
      window.closeModal();
      window.showToast('Saved to openclaw.json — restart OpenClaw to apply.', 'success');
    } catch (e) { window.showToast('Failed: ' + e.message, 'error'); }
  };
}

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
