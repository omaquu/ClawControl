// ─── providers.js — API Gateway / Provider Manager Page ──────────────────────
export const page = {
    id: 'providers',
    title: '🔌 Provider Gateway',
    icon: 'fa-plug',

    render() {
        return `
    <div class="page-header">
      <div>
        <h2 class="page-heading">API Gateway</h2>
        <p class="page-sub">Manage AI providers, priorities, and automatic fallback</p>
      </div>
      <div style="display:flex;gap:0.5rem;align-items:center;">
        <div id="provider-health-summary" style="display:flex;gap:0.5rem;font-size:0.78rem;"></div>
        <button class="btn btn-primary" id="add-provider-btn"><i class="fa fa-plus"></i> Add Provider</button>
      </div>
    </div>

    <div class="card" style="margin-bottom:1rem;padding:1rem 1.25rem;">
      <div style="display:flex;gap:1.5rem;align-items:center;flex-wrap:wrap;">
        <div>
          <div class="stat-label">PROVIDERS</div>
          <div class="stat-value" id="prov-count">—</div>
        </div>
        <div>
          <div class="stat-label">HEALTHY</div>
          <div class="stat-value" id="prov-healthy" style="color:var(--color-success)">—</div>
        </div>
        <div>
          <div class="stat-label">DOWN</div>
          <div class="stat-value" id="prov-down" style="color:var(--color-danger)">—</div>
        </div>
        <div style="flex:1;text-align:right;font-size:0.78rem;color:var(--color-text-dim)">
          Health checked every 60s &nbsp;•&nbsp; API keys encrypted at rest (AES-256-GCM)
        </div>
      </div>
    </div>

    <div id="providers-list"></div>

    <div class="card" style="margin-top:1rem;">
      <div class="card-header"><i class="fa fa-route"></i> Proxy Test</div>
      <div style="padding:1rem;">
        <div style="display:flex;gap:0.5rem;margin-bottom:0.75rem;">
          <input class="form-input" id="proxy-test-msg" placeholder='Test message to send via /api/proxy/chat' style="flex:1;">
          <select class="form-select" id="proxy-agent-scope" style="width:160px;">
            <option value="">Global (any)</option>
          </select>
          <button class="btn btn-ghost" id="proxy-test-btn"><i class="fa fa-paper-plane"></i> Send</button>
        </div>
        <pre id="proxy-test-result" style="background:var(--color-surface);padding:1rem;border-radius:8px;font-size:0.78rem;max-height:200px;overflow:auto;color:var(--color-text-dim);">Response will appear here…</pre>
      </div>
    </div>`;
    },

    async init() {
        await this.loadProviders();
        document.getElementById('add-provider-btn').addEventListener('click', () => this.showAddModal());
        document.getElementById('proxy-test-btn').addEventListener('click', () => this.testProxy());
        // Refresh on SSE PROVIDER_HEALTH_CHANGED
        window._providerRefresh = () => this.loadProviders();
    },

    async loadProviders() {
        const providers = await window.api('/api/providers');
        this.renderList(providers);
        this.updateStats(providers);
        this.populateAgentScope(providers);
    },

    updateStats(providers) {
        document.getElementById('prov-count').textContent = providers.length;
        document.getElementById('prov-healthy').textContent = providers.filter(p => p.health === 'healthy').length;
        document.getElementById('prov-down').textContent = providers.filter(p => p.health === 'down').length;
    },

    populateAgentScope(providers) {
        const sel = document.getElementById('proxy-agent-scope');
        if (!sel) return;
        // Populate from agents list additionally — just show providers' scopes
        const scopes = [...new Set(providers.map(p => p.agent_scope).filter(s => s !== 'global'))];
        sel.innerHTML = '<option value="">Global (any)</option>' + scopes.map(s => `<option value="${s}">${s}</option>`).join('');
    },

    typeIcon(type) {
        const icons = { anthropic: '🟠', openai: '🟢', google: '🔵', openrouter: '🟣', custom: '⚪' };
        return icons[type] || '⚪';
    },

    healthBadge(h) {
        const cls = { healthy: 'success', down: 'danger', unknown: 'warning', degraded: 'warning' };
        const c = cls[h] || 'warning';
        return `<span style="font-size:0.72rem;padding:2px 8px;border-radius:9999px;background:var(--color-${c}20);color:var(--color-${c});border:1px solid var(--color-${c}40)">${h || 'unknown'}</span>`;
    },

    renderList(providers) {
        const el = document.getElementById('providers-list');
        if (!providers.length) {
            el.innerHTML = `<div class="empty-state"><i class="fa fa-plug"></i><p>No providers yet.<br>Add your first provider to enable the AI Gateway.</p></div>`;
            return;
        }
        el.innerHTML = `
    <div class="table-wrap">
      <table class="data-table">
        <thead><tr>
          <th>#</th><th>Provider</th><th>Type</th><th>Models</th>
          <th>Scope</th><th>Mode</th><th>Health</th><th>Enabled</th><th></th>
        </tr></thead>
        <tbody>
        ${providers.sort((a, b) => a.priority - b.priority).map((p, i) => `
          <tr data-id="${p.id}">
            <td style="color:var(--color-text-dim);width:32px;">${i + 1}</td>
            <td><strong>${this.typeIcon(p.type)} ${p.name}</strong><br>
              <span style="font-size:0.72rem;color:var(--color-text-dim)">${p.api_key || '(no key)'}</span>
            </td>
            <td><span style="font-family:var(--font-mono);font-size:0.82rem">${p.type}</span></td>
            <td style="font-size:0.78rem;color:var(--color-text-dim)">${(p.models || []).slice(0, 2).join(', ') || '—'}${(p.models || []).length > 2 ? ` +${p.models.length - 2}` : ''}</td>
            <td><span style="font-size:0.78rem">${p.agent_scope === 'global' ? '🌐 global' : `🤖 ${p.agent_scope}`}</span></td>
            <td style="font-size:0.78rem">${p.load_balance_mode}</td>
            <td>${this.healthBadge(p.health)}</td>
            <td>
              <label class="toggle-switch" title="${p.enabled ? 'Disable' : 'Enable'}">
                <input type="checkbox" ${p.enabled ? 'checked' : ''} onchange="window._providerToggle('${p.id}', this.checked)">
                <span class="toggle-track"></span>
              </label>
            </td>
            <td style="white-space:nowrap;">
              <button class="btn btn-sm btn-ghost" onclick="window._providerTest('${p.id}')" title="Test connection"><i class="fa fa-stethoscope"></i></button>
              <button class="btn btn-sm btn-ghost" onclick="window._providerEdit('${p.id}')" title="Edit"><i class="fa fa-pen"></i></button>
              <button class="btn btn-sm btn-ghost" style="color:var(--color-danger)" onclick="window._providerDelete('${p.id}')" title="Delete"><i class="fa fa-trash"></i></button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>`;

        // Register global callbacks
        window._providerToggle = async (id, enabled) => {
            await window.api(`/api/providers/${id}`, { method: 'PUT', body: JSON.stringify({ enabled }) });
            await this.loadProviders();
        };
        window._providerTest = async (id) => {
            window.toast('Testing connection…', 'info');
            const r = await window.api(`/api/providers/${id}/test`, { method: 'POST' });
            window.toast(r.healthy ? `✅ Healthy (${r.latency}ms)` : `❌ Down: ${r.error}`, r.healthy ? 'success' : 'error');
            await this.loadProviders();
        };
        window._providerEdit = async (id) => {
            const providers = await window.api('/api/providers');
            const p = providers.find(x => x.id === id);
            if (p) this.showEditModal(p);
        };
        window._providerDelete = async (id) => {
            if (!confirm('Delete this provider?')) return;
            await window.api(`/api/providers/${id}`, { method: 'DELETE' });
            await this.loadProviders();
            window.toast('Provider deleted', 'success');
        };
    },

    providerFormHTML(p = {}) {
        const types = ['anthropic', 'openai', 'google', 'openrouter', 'custom'];
        const modes = ['priority', 'round-robin', 'manual'];
        return `
    <form id="provider-form" style="display:flex;flex-direction:column;gap:0.75rem;">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.75rem;">
        <div>
          <label class="form-label">Name</label>
          <input class="form-input" name="name" value="${p.name || ''}" placeholder="e.g. Anthropic Primary" required>
        </div>
        <div>
          <label class="form-label">Type</label>
          <select class="form-select" name="type">
            ${types.map(t => `<option value="${t}" ${p.type === t ? 'selected' : ''}>${t}</option>`).join('')}
          </select>
        </div>
      </div>
      <div>
        <label class="form-label">API Key <span style="color:var(--color-text-dim);font-size:0.75rem">(leave empty to keep existing)</span></label>
        <input class="form-input" name="api_key" type="password" placeholder="sk-…  (encrypted at rest)">
      </div>
      <div>
        <label class="form-label">Base URL <span style="color:var(--color-text-dim);font-size:0.75rem">(optional, for custom / local providers)</span></label>
        <input class="form-input" name="base_url" value="${p.base_url || ''}" placeholder="http://localhost:11434">
      </div>
      <div>
        <label class="form-label">Models (comma-separated, first is default)</label>
        <input class="form-input" name="models" value="${(p.models || []).join(', ')}" placeholder="claude-3-5-haiku-20241022, claude-3-5-sonnet-20241022">
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:0.75rem;">
        <div>
          <label class="form-label">Priority <span style="color:var(--color-text-dim);font-size:0.75rem">(0 = highest)</span></label>
          <input class="form-input" name="priority" type="number" value="${p.priority ?? 0}" min="0">
        </div>
        <div>
          <label class="form-label">Agent Scope</label>
          <input class="form-input" name="agent_scope" value="${p.agent_scope || 'global'}" placeholder="global or agent-id">
        </div>
        <div>
          <label class="form-label">Load Balance Mode</label>
          <select class="form-select" name="load_balance_mode">
            ${modes.map(m => `<option value="${m}" ${p.load_balance_mode === m ? 'selected' : ''}>${m}</option>`).join('')}
          </select>
        </div>
      </div>
    </form>`;
    },

    showAddModal() {
        window.showModal('Add Provider', this.providerFormHTML(), [
            { label: 'Cancel', cls: 'btn-ghost', onClick: window.closeModal },
            {
                label: 'Add Provider', cls: 'btn-primary', onClick: async () => {
                    const form = document.getElementById('provider-form');
                    const d = Object.fromEntries(new FormData(form));
                    d.models = d.models.split(',').map(m => m.trim()).filter(Boolean);
                    d.priority = parseInt(d.priority) || 0;
                    if (!d.api_key) delete d.api_key;
                    await window.api('/api/providers', { method: 'POST', body: JSON.stringify(d) });
                    window.closeModal();
                    await this.loadProviders();
                    window.toast('Provider added', 'success');
                }
            }
        ]);
    },

    showEditModal(p) {
        window.showModal('Edit Provider', this.providerFormHTML(p), [
            { label: 'Cancel', cls: 'btn-ghost', onClick: window.closeModal },
            {
                label: 'Save', cls: 'btn-primary', onClick: async () => {
                    const form = document.getElementById('provider-form');
                    const d = Object.fromEntries(new FormData(form));
                    d.models = d.models.split(',').map(m => m.trim()).filter(Boolean);
                    d.priority = parseInt(d.priority) || 0;
                    if (!d.api_key) delete d.api_key;
                    await window.api(`/api/providers/${p.id}`, { method: 'PUT', body: JSON.stringify(d) });
                    window.closeModal();
                    await this.loadProviders();
                    window.toast('Provider updated', 'success');
                }
            }
        ]);
    },

    async testProxy() {
        const msg = document.getElementById('proxy-test-msg').value.trim();
        const agentId = document.getElementById('proxy-agent-scope').value || undefined;
        if (!msg) return;
        const btn = document.getElementById('proxy-test-btn');
        btn.disabled = true;
        const pre = document.getElementById('proxy-test-result');
        pre.textContent = 'Sending…';
        try {
            const resp = await window.api('/api/proxy/chat', {
                method: 'POST',
                body: JSON.stringify({ messages: [{ role: 'user', content: msg }], agentId })
            });
            pre.textContent = JSON.stringify(resp, null, 2);
        } catch (e) {
            pre.textContent = 'Error: ' + e.message;
        }
        btn.disabled = false;
    }
};
