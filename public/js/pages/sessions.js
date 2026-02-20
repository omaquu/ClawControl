// Sessions Page
let sessions = [];

export async function init(el) {
    el.innerHTML = buildLayout();
    await loadSessions(el);
    bindEvents(el);
}
export async function refresh(el) { await loadSessions(el); }

function buildLayout() {
    return `
  <div class="stat-grid" id="session-stats"></div>
  <!-- Timeline -->
  <div class="card" style="margin-bottom:1rem;">
    <div class="card-header">
      <span class="card-title"><i class="fa fa-chart-gantt"></i> Session Timeline</span>
    </div>
    <canvas id="timeline-canvas" style="width:100%;height:80px;"></canvas>
  </div>
  <!-- Filters -->
  <div style="display:flex;gap:0.75rem;margin-bottom:1rem;flex-wrap:wrap;align-items:center;">
    <input type="text" id="sess-search" placeholder="🔍 Search sessions…" style="width:200px;">
    <select id="sess-model" style="width:180px;"><option value="">All models</option></select>
    <select id="sess-status" style="width:140px;"><option value="">All status</option><option>active</option><option>idle</option><option>subs</option></select>
    <span style="margin-left:auto;font-size:0.8rem;color:var(--color-text-muted);" id="sess-count"></span>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr><th></th><th>Name</th><th>Type</th><th>Model</th><th>Tokens</th><th>Cost</th><th>Last Message</th><th>Updated</th></tr></thead>
      <tbody id="sessions-tbody"></tbody>
    </table>
  </div>`;
}

async function loadSessions(el) {
    sessions = (await window.apiFetch('/sessions').catch(() => [])) || [];
    renderSessions();
    renderStats();
    populateModelFilter();
    drawTimeline();
}

function renderStats() {
    const totalTokens = sessions.reduce((s, x) => s + (x.tokens || 0), 0);
    const totalCost = sessions.reduce((s, x) => s + (x.cost || 0), 0);
    const active = sessions.filter(s => s.status === 'active').length;
    document.getElementById('session-stats').innerHTML = `
    <div class="stat-card"><div class="stat-label">Sessions</div><div class="stat-value">${sessions.length}</div></div>
    <div class="stat-card"><div class="stat-label">Active</div><div class="stat-value text-success">${active}</div></div>
    <div class="stat-card"><div class="stat-label">Total Tokens</div><div class="stat-value">${fmtNum(totalTokens)}</div></div>
    <div class="stat-card"><div class="stat-label">Total Cost</div><div class="stat-value">$${totalCost.toFixed(2)}</div></div>`;
}

function populateModelFilter() {
    const sel = document.getElementById('sess-model');
    if (!sel) return;
    const models = [...new Set(sessions.map(s => s.model).filter(Boolean))];
    sel.innerHTML = '<option value="">All models</option>' + models.map(m => `<option>${m}</option>`).join('');
}

function renderSessions() {
    const search = document.getElementById('sess-search')?.value?.toLowerCase() || '';
    const model = document.getElementById('sess-model')?.value || '';
    const status = document.getElementById('sess-status')?.value || '';
    const filtered = sessions.filter(s =>
        (!search || (s.agent_name || s.agent_id || '').toLowerCase().includes(search) || (s.model || '').includes(search)) &&
        (!model || s.model === model) &&
        (!status || s.status === status));
    document.getElementById('sess-count').textContent = `${filtered.length} sessions`;
    document.getElementById('sessions-tbody').innerHTML = filtered.map(s => `
    <tr onclick="window.openSessionModal('${s.id}')" style="cursor:pointer;">
      <td><span class="status-dot ${s.status === 'active' ? 'online' : ''}" style="display:inline-block;margin-right:0.3rem;"></span></td>
      <td><span class="font-mono" style="font-size:0.78rem;">${s.agent_name || s.agent_id?.slice(0, 12) || '—'}</span></td>
      <td><span class="badge badge-${s.status || 'idle'}">${s.status || 'idle'}</span></td>
      <td style="color:${modelColor(s.model)};">${s.model || '—'}</td>
      <td>${fmtNum(s.tokens || 0)}</td>
      <td>${s.cost ? '$' + s.cost.toFixed(4) : '—'}</td>
      <td class="truncate" style="max-width:200px;color:var(--color-text-muted);font-size:0.78rem;">${s.last_message || '—'}</td>
      <td style="color:var(--color-text-muted);font-size:0.78rem;">${timeAgo(s.updated_at)}</td>
    </tr>`).join('') || '<tr><td colspan="8" style="text-align:center;padding:2rem;color:var(--color-text-muted);">No sessions</td></tr>';
}

function drawTimeline() {
    const canvas = document.getElementById('timeline-canvas');
    if (!canvas || !sessions.length) return;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.parentElement.offsetWidth;
    canvas.height = 80;
    const colors = ['#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#3b82f6', '#ef4444'];
    const now = Date.now() / 1000;
    const range = 7 * 86400; // 7 days
    sessions.slice(0, 8).forEach((s, i) => {
        const start = Math.max(s.created_at || now - range, now - range);
        const end = s.updated_at || now;
        const x1 = ((start - (now - range)) / range) * canvas.width;
        const x2 = ((end - (now - range)) / range) * canvas.width;
        const y = 8 + i * 9;
        ctx.fillStyle = colors[i % colors.length] + '33';
        ctx.fillRect(x1, y, Math.max(x2 - x1, 4), 6);
        ctx.fillStyle = colors[i % colors.length];
        ctx.fillRect(x2 - 2, y, 4, 6);
        ctx.fillStyle = '#94a3b8';
        ctx.font = '9px Inter,sans-serif';
        ctx.fillText(s.agent_name || s.agent_id?.slice(0, 8) || '?', 4, y + 5);
    });
}

window.openSessionModal = function (id) {
    const s = sessions.find(x => x.id === id);
    if (!s) return;
    window.openModal(`
  <div class="modal-header"><span class="modal-title">${s.agent_name || s.id}</span>
    <button class="icon-btn" onclick="closeModal()"><i class="fa fa-xmark"></i></button></div>
  <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">
    <span class="badge badge-${s.status}">${s.status}</span>
    <span class="chip" style="color:${modelColor(s.model)};">${s.model || '?'}</span>
  </div>
  <div class="stat-grid">
    <div class="stat-card"><div class="stat-label">Tokens</div><div class="stat-value">${fmtNum(s.tokens || 0)}</div></div>
    <div class="stat-card"><div class="stat-label">Cost</div><div class="stat-value">${s.cost ? '$' + s.cost.toFixed(4) : '—'}</div></div>
  </div>
  <div class="form-group" style="margin-top:1rem;"><div class="form-label">Last Message</div>
    <div style="font-size:0.8rem;color:var(--color-text-muted);padding:0.5rem;background:var(--color-surface);border-radius:var(--radius-sm);">${s.last_message || '—'}</div></div>
  <div style="font-size:0.72rem;color:var(--color-text-muted);margin-top:0.75rem;">ID: ${s.id} · Created ${timeAgo(s.created_at)} · Updated ${timeAgo(s.updated_at)}</div>`);
};

function bindEvents(el) {
    document.getElementById('sess-search')?.addEventListener('input', renderSessions);
    document.getElementById('sess-model')?.addEventListener('change', renderSessions);
    document.getElementById('sess-status')?.addEventListener('change', renderSessions);
}

function modelColor(m) { if (!m) return 'var(--color-text-muted)'; if (m.includes('opus')) return '#f59e0b'; if (m.includes('sonnet')) return '#6366f1'; if (m.includes('gemini')) return '#3b82f6'; if (m.includes('gpt')) return '#10b981'; return 'var(--color-text)'; }
function fmtNum(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n); }
function timeAgo(ts) { if (!ts) return ''; const d = Math.floor(Date.now() / 1000) - ts; return d < 60 ? `${d}s` : d < 3600 ? `${Math.floor(d / 60)}m` : d < 86400 ? `${Math.floor(d / 3600)}h` : `${Math.floor(d / 86400)}d`; }
