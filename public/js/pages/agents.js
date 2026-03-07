// Agents Page
let gatewayNodes = [];

export async function init(el) {
  el.innerHTML = buildLayout();
  await load();
  bindEvents(el);
  // Listen for live gateway agent updates
  window.addEventListener('mc:event', (e) => {
    if (e.detail.type === 'GATEWAY_NODES') {
      gatewayNodes = e.detail.payload?.nodes || [];
      renderGatewayAgents();
    }
    if (e.detail.type === 'GATEWAY_AGENTS_UPDATED') {
      // fallback just in case
      gatewayNodes = e.detail.payload?.agents || [];
      renderGatewayAgents();
    }
  });
}
export async function refresh() { await load(); }

async function load() {
  gatewayNodes = await window.apiFetch('/gateway/agents').catch(() => []);
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

  <div id="gateway-agents-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:1rem;"></div>`;
}

function renderGatewayAgents() {
  const grid = document.getElementById('gateway-agents-grid');
  if (!grid) return;
  if (!gatewayNodes || !gatewayNodes.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><i class="fa fa-plug-circle-xmark"></i><p>No agents found.<br>Connect your Gateway to see live agents.</p></div>`;
    return;
  }
  grid.innerHTML = gatewayNodes.map(n => {
    // node from node.list
    const name = n.name || n.id;
    const kind = n.kind || 'unknown';
    const status = n.status || 'offline';
    const isDefault = n.isDefault;
    const scopes = (n.scopes || []).join(', ') || 'none';

    // Some stats might be grouped under stats or heartbeat
    const lastPing = n.stats?.lastPing ? new Date(n.stats.lastPing).toLocaleTimeString() : 'never';

    return `
  <div class="card">
    <div style="display:flex;align-items:center;gap:0.75rem;margin-bottom:0.75rem;">
      <div style="width:40px;height:40px;border-radius:50%;background:var(--color-surface);border:2px solid #6366f1;display:flex;align-items:center;justify-content:center;">
        <i class="fa ${kind === 'operator' ? 'fa-server' : 'fa-robot'}" style="color:#6366f1;"></i>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;">${escHtml(name)}</div>
        <div style="font-size:0.75rem;color:var(--color-text-muted);">${escHtml(n.id)}</div>
      </div>
      <span class="badge ${status === 'online' ? 'badge-success' : 'badge-danger'}">${status}</span>
    </div>
    <div class="divider"></div>
    <div style="font-size:0.78rem;display:grid;grid-template-columns:1fr 1fr;gap:0.35rem;">
      <div><span class="text-muted">Kind:</span> <span>${escHtml(kind)}</span></div>
      <div><span class="text-muted">Ping:</span> <span>${lastPing}</span></div>
      <div style="grid-column:1/-1;margin-top:0.25rem;color:var(--color-text-muted);font-size:0.72rem;">Scopes: ${escHtml(scopes)}</div>
    </div>
    <div style="margin-top:0.75rem;display:flex;gap:0.4rem;justify-content:flex-end;">
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
  });
}

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
