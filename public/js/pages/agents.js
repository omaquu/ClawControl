// Agents Page
let localAgents = [];
let gatewayAgents = [];

export async function init(el) {
  el.innerHTML = buildLayout();
  await load();
  bindEvents(el);
  // Listen for live gateway agent updates
  window.addEventListener('mc:event', (e) => {
    if (e.detail.type === 'GATEWAY_AGENTS_UPDATED') {
      gatewayAgents = e.detail.payload?.agents || [];
      renderGatewayAgents();
    }
  });
}
export async function refresh() { await load(); }

async function load() {
  [localAgents, gatewayAgents] = await Promise.all([
    window.apiFetch('/agents').catch(() => []),
    window.apiFetch('/api/gateway/agents').catch(() => [])
  ]);
  localAgents = localAgents || [];
  gatewayAgents = gatewayAgents || [];
  window._agents = localAgents;
  renderLocalAgents();
  renderGatewayAgents();
}

function buildLayout() {
  return `
  <div class="section-header">
    <div>
      <h2 class="section-title"><i class="fa fa-robot"></i> Agents</h2>
      <div style="font-size:0.8rem;color:var(--color-text-muted);">Manage AI agents, models and API quotas</div>
    </div>
    <button class="btn btn-primary" data-action="new-agent"><i class="fa fa-plus"></i> New Agent</button>
  </div>

  <div style="margin-bottom:1rem;">
    <div style="display:flex;gap:0.5rem;border-bottom:1px solid var(--color-border);margin-bottom:1rem;">
      <button class="btn btn-ghost tab-btn active" data-tab="local" style="border-radius:0;border-bottom:2px solid var(--color-accent);">
        <i class="fa fa-database"></i> Local Agents
      </button>
      <button class="btn btn-ghost tab-btn" data-tab="gateway">
        <i class="fa fa-satellite-dish"></i> Gateway Agents
      </button>
    </div>
  </div>

  <div id="agents-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;"></div>
  <div id="gateway-agents-grid" style="display:none;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;"></div>`;
}

function renderLocalAgents() {
  const grid = document.getElementById('agents-grid');
  if (!grid) return;
  if (!localAgents.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><i class="fa fa-robot"></i><p>No local agents yet. Create your first agent!</p></div>`;
    return;
  }
  grid.innerHTML = localAgents.map(a => `
  <div class="card" style="cursor:pointer;" data-action="edit-agent" data-id="${a.id}">
    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;">
      <div style="width:40px;height:40px;border-radius:50%;background:var(--color-surface);border:2px solid var(--color-accent);display:flex;align-items:center;justify-content:center;">
        <i class="fa fa-robot" style="color:var(--color-accent);"></i>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;">${escHtml(a.name)}</div>
        <div style="font-size:0.75rem;color:var(--color-text-muted);">${escHtml(a.role || 'No role')}</div>
      </div>
      <span class="badge badge-${a.status || 'standby'}">${a.status || 'standby'}</span>
    </div>
    <div class="divider"></div>
    <div style="font-size:0.78rem;display:grid;grid-template-columns:1fr 1fr;gap:0.35rem;">
      <div><span class="text-muted">Model:</span> <span style="color:${modelColor(a.model)};">${escHtml(a.model || '—')}</span></div>
      <div><span class="text-muted">Fallback:</span> <span>${escHtml(a.fallback_model || '—')}</span></div>
      ${a.quota_limit ? `<div style="grid-column:1/-1;">
        <div style="margin-top:0.35rem;">
          <div class="progress-label"><span>Quota</span><span>${a.quota_used || 0} / ${a.quota_limit}</span></div>
          <div class="progress-track"><div class="progress-fill ${quotaColor(a)}" style="width:${quotaPct(a)}%;"></div></div>
        </div>
      </div>` : ''}
    </div>
    <div style="margin-top:0.75rem;display:flex;gap:0.4rem;justify-content:flex-end;">
      <button class="btn btn-sm btn-secondary" data-action="edit-agent" data-id="${a.id}"><i class="fa fa-edit"></i></button>
      <button class="btn btn-sm btn-danger" data-action="delete-agent" data-id="${a.id}"><i class="fa fa-trash"></i></button>
    </div>
  </div>`).join('');
}

function renderGatewayAgents() {
  const grid = document.getElementById('gateway-agents-grid');
  if (!grid) return;
  if (!gatewayAgents.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><i class="fa fa-satellite-dish"></i><p>No gateway agents found. Check gateway connection.</p></div>`;
    return;
  }
  grid.innerHTML = gatewayAgents.map(a => {
    const sessions = a.sessions?.count || 0;
    const recent = a.sessions?.recent?.[0];
    const heartbeat = a.heartbeat?.enabled ? `Every ${a.heartbeat.every}` : 'Off';
    const isDefault = a.isDefault;
    return `
  <div class="card">
    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;">
      <div style="width:40px;height:40px;border-radius:50%;background:var(--color-surface);border:2px solid #6366f1;display:flex;align-items:center;justify-content:center;">
        <i class="fa fa-satellite-dish" style="color:#6366f1;"></i>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;">${escHtml(a.name || a.agentId)}</div>
        <div style="font-size:0.75rem;color:var(--color-text-muted);">ID: ${escHtml(a.agentId)}</div>
      </div>
      ${isDefault ? `<span class="badge" style="background:#6366f1;color:white;">default</span>` : ''}
    </div>
    <div class="divider"></div>
    <div style="font-size:0.78rem;display:grid;grid-template-columns:1fr 1fr;gap:0.35rem;">
      <div><span class="text-muted">Sessions:</span> <span>${sessions}</span></div>
      <div><span class="text-muted">Heartbeat:</span> <span>${escHtml(heartbeat)}</span></div>
      ${recent ? `<div style="grid-column:1/-1;margin-top:0.25rem;color:var(--color-text-muted);font-size:0.72rem;">Last: ${escHtml(recent.key)}</div>` : ''}
    </div>
    <div style="margin-top:0.75rem;display:flex;gap:0.4rem;justify-content:flex-end;">
      <button class="btn btn-sm btn-secondary" data-action="chat-gateway-agent" data-id="${a.agentId}"><i class="fa fa-comment"></i> Chat</button>
    </div>
  </div>`;
  }).join('');
}

function bindEvents(el) {
  // Tab switching
  el.addEventListener('click', (e) => {
    const tab = e.target.closest('.tab-btn');
    if (tab) {
      el.querySelectorAll('.tab-btn').forEach(b => { b.classList.remove('active'); b.style.borderBottom = '2px solid transparent'; });
      tab.classList.add('active'); tab.style.borderBottom = '2px solid var(--color-accent)';
      const t = tab.dataset.tab;
      document.getElementById('agents-grid').style.display = t === 'local' ? 'grid' : 'none';
      document.getElementById('gateway-agents-grid').style.display = t === 'gateway' ? 'grid' : 'none';
      return;
    }

    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    const action = actionBtn.dataset.action;
    const id = actionBtn.dataset.id;

    if (action === 'new-agent') openAgentModal();
    else if (action === 'edit-agent') openAgentModal(id);
    else if (action === 'delete-agent') { e.stopPropagation(); deleteAgent(id); }
    else if (action === 'chat-gateway-agent') window.navigate?.('chat', { agentId: id, source: 'gateway' });
  });
}

function openAgentModal(id) {
  const a = id ? localAgents.find(x => x.id === id) : null;
  const config = a?.config || {};
  window.openModal(`
  <div class="modal-header">
    <span class="modal-title">${a ? 'Edit Agent' : 'New Agent'}</span>
    <button class="icon-btn" onclick="closeModal()"><i class="fa fa-xmark"></i></button>
  </div>
  <div class="form-row">
    <div class="form-group"><label class="form-label">Name *</label><input class="form-input" id="ag-name" value="${escHtml(a?.name || '')}"></div>
    <div class="form-group"><label class="form-label">Role</label><input class="form-input" id="ag-role" value="${escHtml(a?.role || '')}" placeholder="e.g. Code Reviewer"></div>
  </div>
  <div class="form-row">
    <div class="form-group"><label class="form-label">Primary Model</label>
      <input class="form-input" id="ag-model" value="${escHtml(a?.model || '')}" placeholder="claude-opus-4-5"></div>
    <div class="form-group"><label class="form-label">Fallback Model</label>
      <input class="form-input" id="ag-fallback" value="${escHtml(a?.fallback_model || '')}" placeholder="gemini-2.0-flash"></div>
  </div>
  <div class="form-row">
    <div class="form-group"><label class="form-label">Status</label>
      <select class="form-select" id="ag-status">
        ${['standby', 'active', 'busy', 'error'].map(s => `<option ${(a?.status || 'standby') === s ? 'selected' : ''}>${s}</option>`).join('')}
      </select></div>
    <div class="form-group"><label class="form-label">Quota Limit (tokens)</label>
      <input class="form-input" type="number" id="ag-quota" value="${a?.quota_limit || 0}"></div>
  </div>
  <div class="form-group"><label class="form-label">System Prompt / Starting Role</label>
    <textarea class="form-textarea" id="ag-system" style="min-height:100px;">${escHtml(config.systemPrompt || '')}</textarea></div>
  <div class="form-group"><label class="form-label">Notes</label>
    <input class="form-input" id="ag-notes" value="${escHtml(config.notes || '')}"></div>
  <div class="form-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="ag-save-btn"><i class="fa fa-save"></i> ${a ? 'Update' : 'Create'}</button>
  </div>`, 'modal-lg');

  document.getElementById('ag-save-btn').onclick = () => saveAgent(id);
}

async function saveAgent(id) {
  const name = document.getElementById('ag-name').value.trim();
  if (!name) { window.showToast('Name required', 'warning'); return; }
  const body = {
    name, role: document.getElementById('ag-role').value,
    model: document.getElementById('ag-model').value,
    fallback_model: document.getElementById('ag-fallback').value,
    status: document.getElementById('ag-status').value,
    quota_limit: parseInt(document.getElementById('ag-quota').value) || 0,
    config: { systemPrompt: document.getElementById('ag-system').value, notes: document.getElementById('ag-notes').value }
  };
  try {
    if (id) await window.apiFetch(`/agents/${id}`, { method: 'PUT', body });
    else await window.apiFetch('/agents', { method: 'POST', body });
    window.closeModal(); window.showToast(id ? 'Agent updated!' : 'Agent created!', 'success');
    await load();
  } catch (e) { window.showToast(e.message, 'error'); }
}

async function deleteAgent(id) {
  if (!confirm('Delete this agent?')) return;
  try {
    await window.apiFetch(`/agents/${id}`, { method: 'DELETE' });
    localAgents = localAgents.filter(a => a.id !== id);
    renderLocalAgents();
    window.showToast('Agent deleted', 'info');
  } catch (e) { window.showToast(e.message, 'error'); }
}

function modelColor(m) { if (!m) return 'var(--color-text-muted)'; if (m.includes('opus')) return '#f59e0b'; if (m.includes('sonnet')) return '#6366f1'; if (m.includes('gemini')) return '#3b82f6'; return 'var(--color-text)'; }
function quotaPct(a) { return a.quota_limit ? Math.min(Math.round((a.quota_used || 0) / a.quota_limit * 100), 100) : 0; }
function quotaColor(a) { const p = quotaPct(a); return p >= 85 ? 'red' : p >= 60 ? 'yellow' : 'green'; }
function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
