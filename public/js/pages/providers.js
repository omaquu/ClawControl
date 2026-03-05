// ─── providers.js — API Gateway / Provider Manager Page ──────────────────────
let _providerPage = null;

export async function init(el) {
  _providerPage = { el };
  el.innerHTML = renderPage();
  await loadProviders(el);
  await loadGatewayStats(el);
  await loadAntigravityStatus();
  el.querySelector('#add-provider-btn').addEventListener('click', () => showAddModal());
  el.querySelector('#proxy-test-btn').addEventListener('click', () => testProxy());
  el.querySelector('#antigravity-btn')?.addEventListener('click', () => startAntigravityOAuth());
  el.querySelector('#prov-info-toggle').addEventListener('click', () => {
    const box = el.querySelector('#prov-how-to');
    box.style.display = box.style.display === 'none' ? 'block' : 'none';
  });
  window._providerRefresh = () => { loadProviders(el); loadGatewayStats(el); };

  // Auto-refresh stats while on the page
  const poll = setInterval(() => {
    if (document.getElementById('gateway-stats')) {
      loadGatewayStats(el);
    } else {
      clearInterval(poll);
    }
  }, 10000);
}

export async function refresh(el) {
  await loadProviders(el);
  await loadGatewayStats(el);
}

function renderPage() {
  return `
  <div class="page-header">
    <div>
      <h2 class="page-heading">API Gateway</h2>
      <p class="page-sub">Manage AI providers, priorities, and automatic fallback</p>
    </div>
    <div style="display:flex;gap:0.5rem;align-items:center;">
      <button class="btn btn-ghost" id="prov-info-toggle" title="How to use"><i class="fa fa-circle-question"></i> How it works</button>
      <button class="btn btn-primary" id="add-provider-btn"><i class="fa fa-plus"></i> Add Provider</button>
    </div>
  </div>

  <div id="prov-how-to" class="info-box" style="display:none;">
    <strong>How agents use this gateway:</strong><br>
    • All agents automatically route through your providers in <strong>priority order</strong> (lowest # = first).<br>
    • Set <strong>Agent Scope</strong> to an agent ID to bind a provider exclusively to that agent, or leave as <code>global</code> for all agents.<br>
    • Use <strong>Load Balance Mode</strong>: <code>priority</code> = first healthy, <code>round-robin</code> = rotate, <code>manual</code> = use Force button below.<br>
    • <strong>Force Agent →</strong> overrides the active provider for a specific agent <em>immediately</em> — no restart needed.<br>
    • The proxy endpoint is <code>POST /api/proxy/chat</code>. Agents should call this instead of provider APIs directly.
  </div>

  <div id="gateway-stats"></div>

  <div id="providers-list"></div>

  <div class="card" style="margin-top:1rem;">
    <div class="card-header" style="padding:0.75rem 1rem;border-bottom:1px solid var(--color-border);font-size:0.85rem;font-weight:600;display:flex;align-items:center;gap:0.5rem;">
      <i class="fa fa-key"></i> Google Antigravity
      <span style="flex:1;"></span>
      <span id="antigravity-status" style="font-size:0.78rem;font-weight:400;color:var(--color-text-muted);">Checking…</span>
    </div>
    <div style="padding:1rem;">
      <div style="font-size:0.78rem;color:var(--color-text-muted);margin-bottom:0.75rem;">
        Authenticate with Google Cloud Code Assist to unlock <code>google-antigravity/claude-opus-4-6-thinking</code> and other Antigravity models in OpenClaw.
      </div>
      <button class="btn btn-primary btn-sm" id="antigravity-btn"><i class="fa fa-right-to-bracket"></i> Sign in with Google</button>
    </div>
  </div>

  <div class="card" style="margin-top:1rem;">
    <div class="card-header" style="padding:0.75rem 1rem;border-bottom:1px solid var(--color-border);font-size:0.85rem;font-weight:600;"><i class="fa fa-route"></i> Proxy Test Console</div>
    <div style="padding:1rem;">
      <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;">
        <input class="form-input" id="proxy-test-msg" placeholder="Send a test message via /api/proxy/chat…" style="flex:1;">
        <button class="btn btn-ghost" id="proxy-test-btn"><i class="fa fa-paper-plane"></i> Send</button>
      </div>
      <pre id="proxy-test-result" style="background:var(--color-surface);padding:1rem;border-radius:8px;font-size:0.78rem;max-height:200px;overflow:auto;color:var(--color-text-muted);">Response will appear here…</pre>
    </div>
  </div>`;
}


async function loadProviders(el) {
  const providers = await window.apiFetch('/providers');
  if (!providers) return;
  renderList(el, providers);
}

async function loadGatewayStats(el) {
  const stats = await window.apiFetch('/gateway/stats');
  if (!stats) return;

  const statsEl = el.querySelector('#gateway-stats');
  const usageKeys = Object.keys(stats.usage);
  const isEnabled = stats.fullMasterToken && stats.fullMasterToken.length > 0;

  statsEl.innerHTML = `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
      <div class="card" style="padding:1.25rem;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;">
            <h3 style="font-size:0.9rem;display:flex;align-items:center;gap:0.5rem;"><i class="fa fa-server" style="color:var(--color-accent)"></i> Dashboard API Gateway</h3>
            <span style="font-size:0.72rem;padding:2px 8px;border-radius:9999px;background:var(--color-${isEnabled ? 'success' : 'danger'}20);color:var(--color-${isEnabled ? 'success' : 'danger'});border:1px solid var(--color-${isEnabled ? 'success' : 'danger'}40)">
              ${isEnabled ? '● Active' : '● Disabled'}
            </span>
          </div>
          <div style="display:flex;flex-direction:column;gap:0.75rem;">
            <div>
              <div class="stat-label">MASTER API TOKEN</div>
              <div style="display:flex;gap:0.5rem;align-items:center;">
                <code id="master-token" style="background:var(--color-surface);padding:4px 8px;border-radius:4px;flex:1;">${stats.masterToken}</code>
                <button class="btn btn-sm btn-ghost" onclick="window._tokenToggle('${stats.fullMasterToken}')" title="Show/Hide"><i class="fa fa-eye"></i></button>
              </div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
              <div><div class="stat-label">API ENDPOINT</div><code style="font-size:0.7rem;">${stats.apiUrl}</code></div>
              <div><div class="stat-label">WS ENDPOINT</div><code style="font-size:0.7rem;">${stats.wsUrl}</code></div>
            </div>
          </div>
      </div>

      <div class="card" style="padding:1.25rem;">
        <h3 style="font-size:0.9rem;margin-bottom:1rem;display:flex;align-items:center;gap:0.5rem;"><i class="fa fa-users-viewfinder" style="color:var(--color-success)"></i> Live Agent Usage</h3>
        <div style="display:flex;gap:1.5rem;align-items:center;">
          <div><div class="stat-label">CONNECTED AGENTS</div><div class="stat-value" style="font-size:1.5rem;">${stats.connectedAgents}</div></div>
          <div style="flex:1;">
            ${usageKeys.length === 0 ? '<p style="font-size:0.8rem;color:var(--color-text-muted)">No recent activity tracked through proxy.</p>' : `
            <table style="width:100%;font-size:0.75rem;border-collapse:collapse;">
              <thead><tr style="text-align:left;color:var(--color-text-muted);border-bottom:1px solid var(--color-border)"><th>Agent</th><th>Last Model Used</th><th>Provider</th></tr></thead>
              <tbody>
                ${usageKeys.map(id => {
    const u = stats.usage[id];
    return `<tr style="border-bottom:1px solid var(--color-border)20">
                    <td style="padding:4px 0;"><strong>${id}</strong></td>
                    <td>${u.model}</td>
                    <td><span style="color:var(--color-text-muted)">${u.provider}</span></td>
                  </tr>`;
  }).join('')}
              </tbody>
            </table>`}
          </div>
        </div>
      </div>
    </div>
  `;

  window._tokenToggle = (full) => {
    const el = document.getElementById('master-token');
    if (el.textContent.includes('...')) {
      el.textContent = full;
    } else {
      el.textContent = full.substring(0, 4) + '...' + full.substring(full.length - 4);
    }
  };
}

function typeIcon(type) {
  return { anthropic: '🟠', openai: '🟢', google: '🔵', openrouter: '🟣', custom: '⚪' }[type] || '⚪';
}

function healthBadge(h) {
  const cls = { healthy: 'success', down: 'danger', unknown: 'warning', degraded: 'warning' };
  const c = cls[h] || 'warning';
  return `<span style="font-size:0.72rem;padding:2px 8px;border-radius:9999px;background:var(--color-${c}20,rgba(0,0,0,0.15));color:var(--color-${c});border:1px solid var(--color-${c}40,rgba(0,0,0,0.2))">${h || 'unknown'}</span>`;
}

function renderList(el, providers) {
  const listEl = el.querySelector('#providers-list');
  if (!providers.length) {
    listEl.innerHTML = `<div class="empty-state"><i class="fa fa-plug"></i><p>No providers yet.<br>Add your first provider to enable the AI Gateway.</p></div>`;
    return;
  }
  listEl.innerHTML = `
  <div class="table-wrap">
    <table class="data-table">
      <thead><tr>
        <th>#</th><th>Provider</th><th>Type</th><th>Models</th>
        <th>Scope</th><th>Mode</th><th>Health</th><th>On</th><th>Actions</th>
      </tr></thead>
      <tbody>
      ${[...providers].sort((a, b) => a.priority - b.priority).map((p, i) => `
        <tr data-id="${p.id}">
          <td style="color:var(--color-text-muted);width:32px;">${i + 1}</td>
          <td><strong>${typeIcon(p.type)} ${p.name}</strong><br>
            <span style="font-size:0.72rem;color:var(--color-text-muted)">${p.base_url || p.type}</span>
          </td>
          <td><span style="font-family:var(--font-mono);font-size:0.82rem">${p.type}</span></td>
          <td style="font-size:0.78rem;color:var(--color-text-muted)">${(p.models || []).slice(0, 2).join(', ') || '—'}${(p.models || []).length > 2 ? ` +${p.models.length - 2}` : ''}</td>
          <td><span style="font-size:0.78rem">${p.agent_scope === 'global' ? '🌐 global' : `🤖 ${p.agent_scope}`}</span></td>
          <td style="font-size:0.78rem">${p.load_balance_mode}</td>
          <td>${healthBadge(p.health)}</td>
          <td>
            <label style="display:flex;align-items:center;cursor:pointer;">
              <input type="checkbox" ${p.enabled ? 'checked' : ''} onchange="window._provToggle('${p.id}', this.checked)" style="width:auto;">
            </label>
          </td>
          <td style="white-space:nowrap;">
            <button class="btn btn-sm btn-ghost" onclick="window._provForce('${p.id}')" title="Force agent to use this provider"><i class="fa fa-bolt"></i></button>
            <button class="btn btn-sm btn-ghost" onclick="window._provTest('${p.id}')" title="Test health"><i class="fa fa-stethoscope"></i></button>
            <button class="btn btn-sm btn-ghost" onclick="window._provEdit('${p.id}')" title="Edit"><i class="fa fa-pen"></i></button>
            <button class="btn btn-sm btn-ghost" style="color:var(--color-danger)" onclick="window._provDel('${p.id}')" title="Delete"><i class="fa fa-trash"></i></button>
          </td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>`;


  window._provToggle = async (id, enabled) => {
    await window.apiFetch(`/providers/${id}`, { method: 'PUT', body: { enabled } });
    await loadProviders(el);
  };
  window._provTest = async (id) => {
    window.showToast('Testing connection…', 'info');
    const r = await window.apiFetch(`/providers/${id}/test`, { method: 'POST' });
    window.showToast(r.healthy ? `✅ Healthy (${r.latency}ms)` : `❌ Down: ${r.error}`, r.healthy ? 'success' : 'error');
    await loadProviders(el);
  };
  window._provEdit = async (id) => {
    const list = await window.apiFetch('/providers');
    const p = list?.find(x => x.id === id);
    if (p) showEditModal(p, el);
  };
  window._provDel = async (id) => {
    if (!confirm('Delete this provider?')) return;
    await window.apiFetch(`/providers/${id}`, { method: 'DELETE' });
    await loadProviders(el);
    window.showToast('Provider deleted', 'success');
  };
  window._provForce = async (id) => {
    const agents = await window.apiFetch('/agents') || [];
    const opts = [{ id: 'global', name: '🌐 All Agents (global)' }, ...agents].map(a =>
      `<option value="${a.id}">${a.name}</option>`).join('');
    window.showModal('⚡ Force Agent → Provider', `
      <p style="color:var(--color-text-muted);font-size:0.85rem;margin-bottom:0.75rem;">
        Select an agent to immediately route their requests through this provider.<br>
        No restart required — takes effect on the next request.
      </p>
      <label class="form-label">Agent</label>
      <select class="form-select" id="force-agent-sel">${opts}</select>`, [
      { label: 'Cancel', cls: 'btn-ghost', onClick: window.closeModal },
      {
        label: '⚡ Force Now', cls: 'btn-primary', onClick: async () => {
          const scope = document.getElementById('force-agent-sel').value;
          await window.apiFetch(`/providers/${id}`, { method: 'PUT', body: { agent_scope: scope } });
          window.closeModal();
          await loadProviders(el);
          window.showToast(scope === 'global' ? 'Provider set to global' : `Provider forced for agent`, 'success');
        }
      }
    ]);
  };
}


function providerFormHTML(p = {}) {
  const types = ['anthropic', 'openai', 'google', 'openrouter', 'custom'];
  const modes = ['priority', 'round-robin', 'manual'];
  return `
  <form id="provider-form" style="display:flex;flex-direction:column;gap:0.75rem;">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
      <div><label class="form-label">Name</label><input class="form-input" name="name" value="${p.name || ''}" placeholder="e.g. Anthropic Primary" required></div>
      <div><label class="form-label">Type</label>
        <select class="form-select" name="type">${types.map(t => `<option value="${t}" ${p.type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
      </div>
    </div>
    <div><label class="form-label">API Key <span style="color:var(--color-text-muted);font-size:0.75rem">(leave empty to keep existing)</span></label>
      <input class="form-input" name="api_key" type="password" placeholder="sk-… (encrypted at rest)">
    </div>
    <div><label class="form-label">Base URL <span style="color:var(--color-text-muted);font-size:0.75rem">(optional, for local providers)</span></label>
      <input class="form-input" name="base_url" value="${p.base_url || ''}" placeholder="http://localhost:11434">
    </div>
    <div><label class="form-label">Models (comma-separated, first is default)</label>
      <input class="form-input" name="models" value="${(p.models || []).join(', ')}" placeholder="claude-3-5-haiku-20241022">
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem;">
      <div><label class="form-label">Priority (0=highest)</label><input class="form-input" name="priority" type="number" value="${p.priority ?? 0}" min="0"></div>
      <div><label class="form-label">Agent Scope</label><input class="form-input" name="agent_scope" value="${p.agent_scope || 'global'}" placeholder="global or agent-id"></div>
      <div><label class="form-label">Load Balance Mode</label>
        <select class="form-select" name="load_balance_mode">${modes.map(m => `<option value="${m}" ${p.load_balance_mode === m ? 'selected' : ''}>${m}</option>`).join('')}</select>
      </div>
    </div>
  </form>`;
}

function collectForm() {
  const form = document.getElementById('provider-form');
  const d = Object.fromEntries(new FormData(form));
  d.models = d.models.split(',').map(m => m.trim()).filter(Boolean);
  d.priority = parseInt(d.priority) || 0;
  if (!d.api_key) delete d.api_key;
  return d;
}

function showAddModal() {
  window.showModal('Add Provider', providerFormHTML(), [
    { label: 'Cancel', cls: 'btn-ghost', onClick: window.closeModal },
    {
      label: 'Add Provider', cls: 'btn-primary', onClick: async () => {
        const d = collectForm();
        await window.apiFetch('/providers', { method: 'POST', body: d });
        window.closeModal();
        await loadProviders(_providerPage.el);
        window.showToast('Provider added', 'success');
      }
    }
  ]);
}

function showEditModal(p, el) {
  window.showModal('Edit Provider', providerFormHTML(p), [
    { label: 'Cancel', cls: 'btn-ghost', onClick: window.closeModal },
    {
      label: 'Save', cls: 'btn-primary', onClick: async () => {
        const d = collectForm();
        await window.apiFetch(`/providers/${p.id}`, { method: 'PUT', body: d });
        window.closeModal();
        await loadProviders(el);
        window.showToast('Provider updated', 'success');
      }
    }
  ]);
}

async function testProxy() {
  const msg = document.getElementById('proxy-test-msg')?.value?.trim();
  if (!msg) return;
  const btn = document.getElementById('proxy-test-btn');
  const pre = document.getElementById('proxy-test-result');
  btn.disabled = true;
  pre.textContent = 'Sending…';
  try {
    const resp = await window.apiFetch('/proxy/chat', {
      method: 'POST',
      body: { messages: [{ role: 'user', content: msg }] }
    });
    pre.textContent = JSON.stringify(resp, null, 2);
  } catch (e) {
    pre.textContent = 'Error: ' + e.message;
  }
  btn.disabled = false;
}

async function startAntigravityOAuth() {
  const statusEl = document.getElementById('antigravity-status');
  if (statusEl) statusEl.textContent = 'Starting OAuth…';
  try {
    const { authUrl } = await window.apiFetch('/api/oauth/antigravity/start', { method: 'POST' });
    const popup = window.open(authUrl, 'antigravity-oauth', 'width=600,height=700,scrollbars=yes');
    if (!popup) { window.showToast('Allow popups for OAuth to work', 'warning'); return; }
    const handleMsg = (e) => {
      if (e.data?.type !== 'antigravity-oauth-ok') return;
      window.removeEventListener('message', handleMsg);
      const { email, projectId } = e.data;
      if (statusEl) statusEl.innerHTML = `<span style="color:var(--color-success);">✅ ${escHtml(email)} (${escHtml(projectId)})</span>`;
      window.showToast(`Antigravity authenticated as ${email}`, 'success');
    };
    window.addEventListener('message', handleMsg);
  } catch (e) { window.showToast('OAuth failed: ' + e.message, 'error'); }
}

async function loadAntigravityStatus() {
  const statusEl = document.getElementById('antigravity-status');
  if (!statusEl) return;
  try {
    const data = await window.apiFetch('/api/oauth/antigravity/status');
    if (data.connected) {
      statusEl.innerHTML = `<span style="color:var(--color-success);">✅ ${escHtml(data.email || '?')} (${escHtml(data.projectId || '?')})</span>`;
    } else {
      statusEl.textContent = 'Not authenticated';
    }
  } catch { if (statusEl) statusEl.textContent = 'Not authenticated'; }
}

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
