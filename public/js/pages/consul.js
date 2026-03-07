// Consul — Democratic Council with Multi-Round Voting + Member Selection
let consulMessages = [];
let votes = [];
let agents = [];
let councilMembers = new Set(); // ids of selected council members
let councilSize = 3;
let democraticMode = false;

// Persist council settings in localStorage
function loadCouncilSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('cc_council') || '{}');
    councilSize = s.size || 3;
    democraticMode = !!s.democratic;
    councilMembers = new Set(s.members || []);
  } catch { }
}
function saveCouncilSettings() {
  localStorage.setItem('cc_council', JSON.stringify({ size: councilSize, democratic: democraticMode, members: [...councilMembers] }));
}

export async function init(el) {
  loadCouncilSettings();
  el.innerHTML = buildLayout();
  [agents, votes] = await Promise.all([
    window.apiFetch('/gateway/agents').catch(() => []),
    window.apiFetch('/consul/votes').catch(() => [])
  ]);

  // Auto-populate council from first N agents if empty
  if (!councilMembers.size && agents.length) {
    agents.slice(0, councilSize).forEach(a => councilMembers.add(a.id));
    saveCouncilSettings();
  }

  consulMessages = (await window.apiFetch('/consul/messages').catch(() => [])) || [];
  renderMessages();
  renderVotes();
  renderCouncilPanel();
  bindEvents(el);
  window.addEventListener('mc:event', (e) => {
    if (e.detail.type === 'CONSUL_MESSAGE') { consulMessages.push(e.detail.payload); renderMessages(); }
    if (['VOTE_CREATED', 'VOTE_CAST', 'VOTE_CLOSED'].includes(e.detail.type)) loadVotes();
  });
}
export async function refresh(el) { init(el); }

async function loadVotes() {
  votes = (await window.apiFetch('/consul/votes').catch(() => [])) || [];
  renderVotes();
}

function buildLayout() {
  return `
  <div class="consul-layout" style="display:grid;grid-template-columns:1fr 300px;gap:1rem;height:calc(100vh - var(--topbar-height) - 3rem);overflow:hidden;">
    <!-- Left: Chamber -->
    <div class="card" style="display:flex;flex-direction:column;overflow:hidden;padding:0;">
      <div style="padding:0.6rem 1rem;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <span style="font-weight:600;display:flex;align-items:center;gap:0.5rem;"><i class="fa fa-landmark"></i> Council Chamber</span>
        <div style="display:flex;gap:0.4rem;align-items:center;">
          <span id="consul-agent-count" style="font-size:0.75rem;color:var(--color-text-muted);"></span>
          <button class="btn btn-sm btn-ghost" id="council-settings-btn"><i class="fa fa-gear"></i> Council</button>
          <button class="btn btn-sm btn-secondary" id="new-vote-btn"><i class="fa fa-check-to-slot"></i> New Vote</button>
        </div>
      </div>
      <div class="chat-messages" id="consul-messages" style="flex:1;overflow-y:auto;"></div>
      <div class="chat-input-area" style="flex-shrink:0;">
        <textarea id="consul-input" placeholder="Speak to all council members… (Enter to send)" rows="2"></textarea>
        <button class="btn btn-primary" id="consul-send"><i class="fa fa-paper-plane"></i></button>
      </div>
    </div>

    <!-- Right: Votes + Members -->
    <div style="display:flex;flex-direction:column;gap:0.75rem;overflow-y:auto;min-width:0;">
      <div class="card" style="flex:1;overflow-y:auto;min-height:0;padding:0.75rem;">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.5rem;">
          <span class="card-title" style="margin:0;"><i class="fa fa-check-to-slot"></i> Votes</span>
          <button class="btn btn-sm btn-ghost" id="refresh-votes-btn"><i class="fa fa-rotate"></i></button>
        </div>
        <div id="votes-panel"></div>
      </div>
      <div class="card" style="flex-shrink:0;padding:0.75rem;">
        <div class="card-title" style="margin-bottom:0.5rem;"><i class="fa fa-robot"></i> Council (<span id="council-count">0</span>)</div>
        <div id="consul-members"></div>
      </div>
    </div>
  </div>`;
}

function renderCouncilPanel() {
  const mem = document.getElementById('consul-members');
  const countEl = document.getElementById('council-count');
  if (countEl) countEl.textContent = councilMembers.size;
  if (!mem) return;
  const agentCount = document.getElementById('consul-agent-count');
  if (agentCount) agentCount.textContent = `${agents.length} agents`;

  if (!agents.length) { mem.innerHTML = '<div class="text-muted" style="font-size:0.8rem;">No agents yet</div>'; return; }

  mem.innerHTML = agents.map(a => {
    const isMember = councilMembers.has(a.id);
    return `<div style="display:flex;align-items:center;gap:0.4rem;padding:0.25rem 0;font-size:0.8rem;">
      <input type="checkbox" id="cm-${a.id}" ${isMember ? 'checked' : ''} onchange="window.toggleCouncilMember('${a.id}',this.checked)"
        style="width:auto;flex-shrink:0;" ${democraticMode ? 'disabled title="Democratic mode active"' : ''}>
      <span style="width:7px;height:7px;border-radius:50%;background:${statusColor(a.status)};flex-shrink:0;"></span>
      <label for="cm-${a.id}" style="flex:1;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escHtml(a.name)}">${escHtml(a.name)}</label>
      <span class="text-muted" style="font-size:0.7rem;flex-shrink:0;">${escHtml(a.model || '—').slice(0, 10)}</span>
    </div>`;
  }).join('');
}

window.toggleCouncilMember = function (id, checked) {
  if (checked) councilMembers.add(id);
  else councilMembers.delete(id);
  saveCouncilSettings();
  const countEl = document.getElementById('council-count');
  if (countEl) countEl.textContent = councilMembers.size;
};

function openCouncilSettings() {
  window.openModal(`
  <div class="modal-header">
    <span class="modal-title"><i class="fa fa-landmark"></i> Council Settings</span>
    <button class="icon-btn" onclick="closeModal()"><i class="fa fa-xmark"></i></button>
  </div>
  <div class="form-group">
    <label class="form-label">Council Size (max members)</label>
    <input class="form-input" type="number" id="cs-size" value="${councilSize}" min="1" max="${agents.length || 20}">
  </div>
  <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem;">
    <input type="checkbox" id="cs-democratic" ${democraticMode ? 'checked' : ''}>
    <label for="cs-democratic" style="font-size:0.85rem;">
      <strong>Democratic Mode</strong>
      <div style="font-size:0.75rem;color:var(--color-text-muted);">Automatically selects top N agents by message activity. Manual selection disabled.</div>
    </label>
  </div>
  ${democraticMode ? `<div style="font-size:0.78rem;color:var(--color-text-muted);background:var(--color-surface);padding:0.5rem;border-radius:6px;margin-bottom:1rem;">
    <strong>Current ranking</strong> (by messages sent):<br>
    ${rankAgentsByActivity().slice(0, councilSize).map((a, i) => `${i + 1}. ${escHtml(a.name)}`).join('<br>') || 'No data yet'}
  </div>` : ''}
  <div class="form-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="window.saveCouncilSettings()"><i class="fa fa-save"></i> Apply</button>
  </div>`);
}

function rankAgentsByActivity() {
  const tally = {};
  consulMessages.forEach(m => { if (m.agent_id) tally[m.agent_id] = (tally[m.agent_id] || 0) + 1; });
  return agents.slice().sort((a, b) => (tally[b.id] || 0) - (tally[a.id] || 0));
}

window.saveCouncilSettings = function () {
  democraticMode = document.getElementById('cs-democratic')?.checked;
  councilSize = Math.max(1, parseInt(document.getElementById('cs-size')?.value) || 3);
  if (democraticMode) {
    councilMembers = new Set(rankAgentsByActivity().slice(0, councilSize).map(a => a.id));
  }
  saveCouncilSettings();
  renderCouncilPanel();
  window.closeModal();
  window.showToast('Council settings saved!', 'success');
};

function renderMessages() {
  const container = document.getElementById('consul-messages');
  if (!container) return;
  container.innerHTML = '';
  consulMessages.slice(-100).forEach(msg => {
    const div = document.createElement('div');
    div.className = `chat-msg ${msg.role === 'user' ? 'user' : 'agent'}`;
    const name = msg.agent_name || (msg.role === 'user' ? 'You' : 'Agent');
    div.innerHTML = `<div class="chat-msg-bubble">${escHtml(msg.content)}</div>
      <div class="chat-msg-meta">${escHtml(name)} · ${timeAgo(msg.created_at)}</div>`;
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;
  renderCouncilPanel();
}

function statusColor(s) {
  return { online: '#10b981', active: '#10b981', busy: '#f59e0b', error: '#ef4444', offline: '#6b7280', standby: '#6b7280', idle: '#eab308' }[s] || '#6b7280';
}

function renderVotes() {
  const panel = document.getElementById('votes-panel');
  if (!panel) return;
  if (!votes.length) { panel.innerHTML = '<div class="empty-state" style="padding:1rem;"><p style="font-size:0.8rem;">No votes yet. Create one!</p></div>'; return; }
  panel.innerHTML = votes.map(v => renderVoteCard(v)).join('');
}

function renderVoteCard(v) {
  const tally = {};
  Object.values(v.results || {}).forEach(opt => { tally[opt] = (tally[opt] || 0) + 1; });
  const total = Object.values(tally).reduce((s, n) => s + n, 0);
  const winner = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]?.[0] || '—';
  const open = v.status === 'open';
  return `<div style="border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:0.6rem;margin-bottom:0.5rem;font-size:0.8rem;">
    <div style="font-weight:600;margin-bottom:0.35rem;color:${open ? 'var(--color-accent)' : 'var(--color-text-muted)'};">${open ? '🔓' : '🔒'} ${escHtml(v.topic)}</div>
    ${(v.options || []).map(opt => {
    const c = tally[opt] || 0; const w = total ? Math.round(c / total * 100) : 0;
    return `<div style="margin-bottom:0.3rem;">
        <div style="display:flex;justify-content:space-between;font-size:0.75rem;margin-bottom:0.15rem;">
          <span>${escHtml(opt)}</span><span style="color:var(--color-text-muted);">${c}/${total} (${w}%)</span>
        </div>
        <div style="height:4px;background:var(--color-surface);border-radius:2px;">
          <div style="width:${w}%;height:100%;background:var(--color-accent);border-radius:2px;transition:width 0.3s;"></div>
        </div>
      </div>`;
  }).join('')}
    ${open ? `<div style="margin-top:0.4rem;display:flex;gap:0.4rem;flex-wrap:wrap;">
      ${(v.options || []).map(opt => `<button class="btn btn-sm btn-ghost" style="font-size:0.72rem;" onclick="window.castVote('${v.id}','${escHtml(opt)}')">Vote: ${escHtml(opt)}</button>`).join('')}
      <button class="btn btn-sm btn-danger" style="font-size:0.72rem;" onclick="window.closeVote('${v.id}')">Close</button>
    </div>` : `<div style="margin-top:0.3rem;font-size:0.72rem;color:var(--color-text-muted);">Winner: <strong>${escHtml(winner)}</strong></div>`}
  </div>`;
}

function bindEvents(el) {
  el.querySelector('#new-vote-btn')?.addEventListener('click', openNewVoteModal);
  el.querySelector('#council-settings-btn')?.addEventListener('click', openCouncilSettings);
  el.querySelector('#refresh-votes-btn')?.addEventListener('click', loadVotes);
  const sendBtn = el.querySelector('#consul-send');
  const input = el.querySelector('#consul-input');
  const send = async () => {
    const content = input?.value.trim();
    if (!content) return;
    input.value = '';
    await window.apiFetch('/consul/messages', { method: 'POST', body: { role: 'user', content, agent_name: 'You' } }).catch(() => { });
    consulMessages.push({ role: 'user', content, agent_name: 'You', created_at: Math.floor(Date.now() / 1000) });
    renderMessages();
  };
  sendBtn?.addEventListener('click', send);
  input?.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } });
}

function openNewVoteModal() {
  window.openModal(`
  <div class="modal-header">
    <span class="modal-title"><i class="fa fa-check-to-slot"></i> New Vote</span>
    <button class="icon-btn" onclick="closeModal()"><i class="fa fa-xmark"></i></button>
  </div>
  <div class="form-group"><label class="form-label">Topic *</label><input class="form-input" id="vt-topic" placeholder="What should we decide?"></div>
  <div class="form-group">
    <label class="form-label">Options (one per line)</label>
    <textarea class="form-input" id="vt-options" rows="3" placeholder="Option A&#10;Option B&#10;Option C"></textarea>
  </div>
  <div class="form-group">
    <label class="form-label">Mode</label>
    <select class="form-select" id="vt-mode">
      <option value="democratic">Democratic (equal weight)</option>
      <option value="weighted">Weighted (by performance)</option>
    </select>
  </div>
  <div class="form-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="window._createVote()"><i class="fa fa-check"></i> Create</button>
  </div>`);
  window._createVote = async () => {
    const topic = document.getElementById('vt-topic').value.trim();
    const opts = document.getElementById('vt-options').value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!topic || opts.length < 2) { window.showToast('Need topic + at least 2 options', 'warning'); return; }
    await window.apiFetch('/consul/votes', { method: 'POST', body: { topic, options: opts, mode: document.getElementById('vt-mode').value } });
    closeModal(); loadVotes(); window.showToast('Vote created!', 'success');
  };
}

window.castVote = async (voteId, option) => {
  await window.apiFetch(`/consul/votes/${voteId}/cast`, { method: 'POST', body: { option, voter: 'user' } });
  loadVotes();
};

window.closeVote = async (voteId) => {
  await window.apiFetch(`/consul/votes/${voteId}`, { method: 'PUT', body: { status: 'closed' } });
  loadVotes();
};

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function timeAgo(ts) { if (!ts) return '—'; const d = Math.floor(Date.now() / 1000) - ts; return d < 60 ? `${d}s ago` : d < 3600 ? `${Math.floor(d / 60)}m ago` : d < 86400 ? `${Math.floor(d / 3600)}h ago` : `${Math.floor(d / 86400)}d ago`; }
