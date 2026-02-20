// Consul — Democratic Council with Multi-Round Voting
let consulMessages = [];
let votes = [];
let agents = [];
let activeVote = null; // vote currently in "reconsider" flow

export async function init(el) {
  el.innerHTML = buildLayout();
  [agents, votes] = await Promise.all([
    window.apiFetch('/agents').catch(() => []),
    window.apiFetch('/consul/votes').catch(() => [])
  ]);
  consulMessages = (await window.apiFetch('/consul/messages').catch(() => [])) || [];
  renderMessages();
  renderVotes();
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
  <div class="consul-layout">
    <div class="chat-pane">
      <div class="chat-pane-header">
        <span><i class="fa fa-landmark"></i> Council Chamber</span>
        <div style="display:flex;gap:0.5rem;align-items:center;">
          <span id="consul-agent-count" style="font-size:0.75rem;color:var(--color-text-muted);"></span>
          <button class="btn btn-sm btn-secondary" id="new-vote-btn"><i class="fa fa-check-to-slot"></i> New Vote</button>
        </div>
      </div>
      <div class="chat-messages" id="consul-messages"></div>
      <div class="chat-input-area">
        <textarea id="consul-input" placeholder="Speak to all agents… (Enter to send)" rows="2"></textarea>
        <button class="btn btn-primary" id="consul-send"><i class="fa fa-paper-plane"></i></button>
      </div>
    </div>
    <div style="display:flex;flex-direction:column;gap:1rem;overflow-y:auto;min-width:320px;">
      <div class="card" style="flex:1;overflow-y:auto;">
        <div class="card-header">
          <span class="card-title"><i class="fa fa-check-to-slot"></i> Votes</span>
          <button class="btn btn-sm btn-ghost" id="refresh-votes-btn"><i class="fa fa-rotate"></i></button>
        </div>
        <div id="votes-panel"></div>
      </div>
      <div class="card" style="flex-shrink:0;">
        <div class="card-title" style="margin-bottom:0.5rem;"><i class="fa fa-robot"></i> Council Members</div>
        <div id="consul-members"></div>
      </div>
    </div>
  </div>`;
}

function renderMessages() {
  const container = document.getElementById('consul-messages');
  if (!container) return;
  container.innerHTML = '';
  const agentCount = document.getElementById('consul-agent-count');
  if (agentCount) agentCount.textContent = `${agents.length} agents`;
  consulMessages.slice(-100).forEach(msg => {
    const div = document.createElement('div');
    div.className = `chat-msg ${msg.role === 'user' ? 'user' : 'agent'}`;
    const name = msg.agent_name || (msg.role === 'user' ? 'You' : 'Agent');
    div.innerHTML = `<div class="chat-msg-bubble">${escHtml(msg.content)}</div>
      <div class="chat-msg-meta">${escHtml(name)} · ${timeAgo(msg.created_at)}</div>`;
    container.appendChild(div);
  });
  container.scrollTop = container.scrollHeight;

  const mem = document.getElementById('consul-members');
  if (mem) mem.innerHTML = agents.length ? agents.map(a => `
    <div style="display:flex;align-items:center;gap:0.5rem;padding:0.3rem 0;font-size:0.8rem;">
      <span style="width:8px;height:8px;border-radius:50%;background:${statusColor(a.status)};flex-shrink:0;"></span>
      <span>${escHtml(a.name)}</span>
      <span class="text-muted" style="font-size:0.72rem;margin-left:auto;">${escHtml(a.model || '—')}</span>
    </div>`).join('') : '<div class="text-muted" style="font-size:0.8rem;">No agents yet</div>';
}

function statusColor(s) {
  return { active: '#10b981', busy: '#f59e0b', error: '#ef4444', standby: '#6b7280' }[s] || '#6b7280';
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
  const total = Object.values(v.results || {}).length;
  const winner = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  const isOpen = v.status === 'open';
  const round = v.round || 1;

  const optBtns = (v.options || []).map(opt => {
    const count = tally[opt] || 0;
    const pct = total ? Math.round(count / total * 100) : 0;
    const isWinning = winner && winner[0] === opt;
    return `<button class="vote-option-btn ${!isOpen ? 'voted' : ''} ${isWinning && !isOpen ? 'winning' : ''}"
        data-vote="${v.id}" data-opt="${escHtml(opt)}">
        <span>${escHtml(opt)}</span>
        <span style="margin-left:auto;font-size:0.7rem;opacity:0.8;">${count} vote${count !== 1 ? 's' : ''} (${pct}%)</span>
        <div class="vote-bar" style="width:${pct}%;background:${isWinning ? 'var(--color-success)' : 'var(--color-accent)'};opacity:0.3;height:3px;border-radius:2px;margin-top:4px;"></div>
      </button>`;
  }).join('');

  const resultSection = !isOpen && winner ? `
    <div style="margin-top:0.75rem;padding:0.6rem;background:var(--color-surface);border-radius:var(--radius-sm);border-left:3px solid var(--color-success);">
      <div style="font-size:0.75rem;font-weight:600;color:var(--color-success);"><i class="fa fa-trophy"></i> Result: ${escHtml(winner[0])}</div>
      <div style="font-size:0.7rem;color:var(--color-text-muted);margin-top:0.25rem;">${winner[1]}/${total} votes (${total ? Math.round(winner[1] / total * 100) : 0}%)</div>
    </div>
    <div style="display:flex;gap:0.5rem;margin-top:0.75rem;flex-wrap:wrap;">
      <button class="btn btn-sm btn-secondary" data-accept="${v.id}"><i class="fa fa-check"></i> Accept Result</button>
      <button class="btn btn-sm btn-ghost" data-reconsider="${v.id}"><i class="fa fa-rotate-left"></i> Reconsider</button>
    </div>` : '';

  const openActions = isOpen ? `
    <div style="margin-top:0.5rem;display:flex;gap:0.5rem;">
      <button class="btn btn-sm btn-secondary" data-close-vote="${v.id}">Close Vote</button>
    </div>` : '';

  return `<div class="vote-card" id="vote-${v.id}">
    <div class="vote-title">${escHtml(v.topic)} ${round > 1 ? `<span style="font-size:0.7rem;color:var(--color-warning);">Round ${round}</span>` : ''}</div>
    <div style="font-size:0.72rem;color:var(--color-text-muted);margin-bottom:0.5rem;">${total} votes · ${v.mode || 'democratic'} · <span style="color:${isOpen ? 'var(--color-warning)' : 'var(--color-success)'};">${v.status}</span></div>
    <div class="vote-options">${optBtns}</div>
    ${resultSection}${openActions}
  </div>`;
}

function bindEvents(el) {
  const input = document.getElementById('consul-input');
  const send = document.getElementById('consul-send');
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendConsulMsg(); } });
  send?.addEventListener('click', sendConsulMsg);
  document.getElementById('new-vote-btn')?.addEventListener('click', openNewVoteModal);
  document.getElementById('refresh-votes-btn')?.addEventListener('click', loadVotes);

  el.addEventListener('click', async (e) => {
    // Cast vote
    const btn = e.target.closest('[data-vote]');
    if (btn && btn.dataset.opt) {
      await castVote(btn.dataset.vote, btn.dataset.opt);
      return;
    }
    // Close vote
    const closeBtn = e.target.closest('[data-close-vote]');
    if (closeBtn) { await closeVote(closeBtn.dataset.closeVote); return; }
    // Accept result
    const acceptBtn = e.target.closest('[data-accept]');
    if (acceptBtn) { acceptResult(acceptBtn.dataset.accept); return; }
    // Reconsider
    const reconsiderBtn = e.target.closest('[data-reconsider]');
    if (reconsiderBtn) { openReconsiderModal(reconsiderBtn.dataset.reconsider); return; }
  });
}

async function castVote(voteId, option) {
  try {
    await window.apiFetch(`/consul/votes/${voteId}/cast`, { method: 'POST', body: { option, voter: 'user' } });
    await loadVotes();
    window.showToast(`Voted: ${option}`, 'success');
  } catch (e) { window.showToast(e.message, 'error'); }
}

async function closeVote(voteId) {
  try {
    await window.apiFetch(`/consul/votes/${voteId}`, { method: 'PUT', body: { status: 'closed' } });
    await loadVotes();
    window.showToast('Vote closed', 'info');
  } catch (e) { window.showToast(e.message, 'error'); }
}

function acceptResult(voteId) {
  const v = votes.find(x => x.id === voteId);
  if (!v) return;
  const tally = {};
  Object.values(v.results || {}).forEach(opt => { tally[opt] = (tally[opt] || 0) + 1; });
  const winner = Object.entries(tally).sort((a, b) => b[1] - a[1])[0];
  window.showToast(`✅ Accepted: "${winner?.[0] || 'result'}"`, 'success');
  // Post acceptance to chamber
  const content = `✅ Result accepted: **${winner?.[0]}** (${winner?.[1]} votes)`;
  window.apiFetch('/consul/messages', { method: 'POST', body: { role: 'user', agent_name: 'You', content } }).catch(() => { });
  consulMessages.push({ role: 'user', agent_name: 'You', content, created_at: Math.floor(Date.now() / 1000) });
  renderMessages();
}

function openReconsiderModal(voteId) {
  const v = votes.find(x => x.id === voteId);
  if (!v) return;
  window.openModal(`
  <div class="modal-header">
    <span class="modal-title"><i class="fa fa-rotate-left"></i> Reconsider Vote</span>
    <button class="icon-btn" onclick="closeModal()"><i class="fa fa-xmark"></i></button>
  </div>
  <div style="font-size:0.85rem;margin-bottom:0.75rem;color:var(--color-text-muted);">Original topic: <strong>${escHtml(v.topic)}</strong></div>
  <div class="form-group"><label class="form-label">Counter-argument / New framing</label>
    <textarea class="form-textarea" id="reconsider-msg" placeholder="I'd like to reconsider because…" style="min-height:80px;"></textarea></div>
  <div class="form-group"><label class="form-label">Same options? Or new options (one per line)?</label>
    <textarea class="form-textarea" id="reconsider-opts" placeholder="${(v.options || []).join('\n')}" style="min-height:80px;">${(v.options || []).join('\n')}</textarea></div>
  <div class="form-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="do-reconsider">Start New Round</button>
  </div>`);
  document.getElementById('do-reconsider').onclick = async () => {
    const msg = document.getElementById('reconsider-msg').value.trim();
    const newOpts = document.getElementById('reconsider-opts').value.split('\n').map(s => s.trim()).filter(Boolean);
    if (newOpts.length < 2) { window.showToast('At least 2 options required', 'warning'); return; }
    // Post reconsideration to chamber
    const content = `🔄 Reconsidering: ${msg || 'new round requested'}`;
    await window.apiFetch('/consul/messages', { method: 'POST', body: { role: 'user', agent_name: 'You', content } }).catch(() => { });
    consulMessages.push({ role: 'user', agent_name: 'You', content, created_at: Math.floor(Date.now() / 1000) });
    // Create new vote (round + 1)
    await window.apiFetch('/consul/votes', { method: 'POST', body: { topic: v.topic, options: newOpts, mode: v.mode || 'democratic', round: (v.round || 1) + 1 } });
    closeModal(); await loadVotes(); renderMessages();
    window.showToast('New round started!', 'success');
  };
}

function openNewVoteModal() {
  window.openModal(`
  <div class="modal-header">
    <span class="modal-title"><i class="fa fa-check-to-slot"></i> New Vote</span>
    <button class="icon-btn" onclick="closeModal()"><i class="fa fa-xmark"></i></button>
  </div>
  <div class="form-group"><label class="form-label">Topic / Question</label>
    <input class="form-input" id="v-topic" placeholder="Should we use TypeScript?"></div>
  <div class="form-group"><label class="form-label">Options (one per line)</label>
    <textarea class="form-textarea" id="v-options" placeholder="Yes&#10;No&#10;Needs more research"></textarea></div>
  <div class="form-group"><label class="form-label">Voting Mode</label>
    <select class="form-select" id="v-mode">
      <option value="democratic">🗳️ Democratic — majority wins</option>
      <option value="user-wins">👑 My vote wins — breaks ties</option>
    </select></div>
  <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="v-submit"><i class="fa fa-check"></i> Create Vote</button></div>`);
  document.getElementById('v-submit').onclick = async () => {
    const topic = document.getElementById('v-topic').value.trim();
    const options = document.getElementById('v-options').value.split('\n').map(s => s.trim()).filter(Boolean);
    const mode = document.getElementById('v-mode').value;
    if (!topic || options.length < 2) { window.showToast('Topic and at least 2 options required', 'warning'); return; }
    await window.apiFetch('/consul/votes', { method: 'POST', body: { topic, options, mode } });
    closeModal(); loadVotes(); window.showToast('Vote created!', 'success');
  };
}

async function sendConsulMsg() {
  const input = document.getElementById('consul-input');
  const content = input.value.trim();
  if (!content) return;
  input.value = '';
  const msg = { agent_id: null, agent_name: 'You', role: 'user', content, created_at: Math.floor(Date.now() / 1000) };
  consulMessages.push(msg);
  renderMessages();
  await window.apiFetch('/consul/messages', { method: 'POST', body: { role: 'user', agent_name: 'You', content } }).catch(() => { });
}

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function timeAgo(ts) { if (!ts) return ''; const d = Math.floor(Date.now() / 1000) - ts; return d < 60 ? `${d}s` : d < 3600 ? `${Math.floor(d / 60)}m` : d < 86400 ? `${Math.floor(d / 3600)}h` : `${Math.floor(d / 86400)}d`; }
