// Agent Chat Page — supports both local DB agents and OpenClaw gateway agents
let localAgents = [];
let gatewayAgents = [];
let allAgents = []; // merged: { id, name, source: 'local'|'gateway' }
let selectedAgent = null;
let chatMessages = [];
let terminalWs = null;
let terminalBuffer = '';

export async function init(el, params = {}) {
  [localAgents, gatewayAgents] = await Promise.all([
    window.apiFetch('/agents').catch(() => []),
    window.apiFetch('/api/gateway/agents').catch(() => [])
  ]);
  localAgents = localAgents || [];
  gatewayAgents = gatewayAgents || [];

  // Merge: gateway agents prefixed with 'gw:'
  allAgents = [
    ...localAgents.map(a => ({ ...a, source: 'local', displayName: a.name })),
    ...gatewayAgents.map(a => ({ id: `gw:${a.agentId}`, agentId: a.agentId, name: a.name || a.agentId, displayName: `${a.name || a.agentId} (Gateway)`, source: 'gateway', status: 'active' }))
  ];

  el.innerHTML = buildLayout(allAgents);
  bindEvents(el);

  // If navigation params requested a specific gateway agent
  if (params?.agentId && params?.source === 'gateway') {
    const target = allAgents.find(a => a.id === `gw:${params.agentId}`);
    if (target) selectAgent(target, el);
  } else if (allAgents.length > 0) {
    selectAgent(allAgents[0], el);
  }

  window.addEventListener('mc:event', (e) => {
    if (e.detail.type === 'CHAT_MESSAGE' && e.detail.payload?.agent_id === selectedAgent?.id) {
      appendMessage(e.detail.payload);
    }
  });
}

export async function refresh(el) { init(el); }

function buildLayout(agents) {
  return `
  <div class="chat-layout" style="height:calc(100vh - var(--topbar-height) - 3rem);">
    <!-- Left: Chat -->
    <div class="chat-pane">
      <div class="chat-pane-header">
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <select id="agent-selector" style="font-size:0.8rem;background:var(--color-surface);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:0.3rem 0.6rem;color:var(--color-text);">
            <option value="">Select agent…</option>
            ${agents.length ? `<optgroup label="Local Agents">${agents.filter(a => a.source === 'local').map(a => `<option value="${a.id}">${escHtml(a.displayName)}</option>`).join('')}</optgroup>` : ''}
            ${agents.filter(a => a.source === 'gateway').length ? `<optgroup label="Gateway Agents">${agents.filter(a => a.source === 'gateway').map(a => `<option value="${a.id}">${escHtml(a.displayName)}</option>`).join('')}</optgroup>` : ''}
          </select>
          <span id="agent-status-badge" class="badge badge-standby">standby</span>
        </div>
        <button class="btn btn-sm btn-ghost" id="clear-chat-btn"><i class="fa fa-broom"></i></button>
      </div>
      <div class="chat-messages" id="chat-messages">
        <div class="empty-state"><i class="fa fa-robot"></i><p>Select an agent to start chatting</p></div>
      </div>
      <div class="chat-input-area">
        <textarea id="chat-input" placeholder="Type a message… (Enter to send, Shift+Enter for newline)" rows="2" disabled></textarea>
        <button class="btn btn-primary" id="chat-send" disabled><i class="fa fa-paper-plane"></i></button>
      </div>
    </div>
    <!-- Right: Agent Desktop / Terminal -->
    <div class="chat-pane">
      <div class="chat-pane-header">
        <span><i class="fa fa-display"></i> Agent Desktop</span>
        <div style="display:flex;gap:0.5rem;">
          <button class="btn btn-sm btn-secondary" id="btn-terminal" onclick="window.switchDesktopView('terminal')"><i class="fa fa-terminal"></i> Terminal</button>
          <button class="btn btn-sm btn-secondary" id="btn-info" onclick="window.switchDesktopView('info')"><i class="fa fa-info-circle"></i> Info</button>
        </div>
      </div>
      <div id="desktop-view" style="flex:1;overflow:hidden;display:flex;flex-direction:column;">
        <div class="empty-state" id="desktop-empty">
          <i class="fa fa-satellite-dish"></i>
          <p>Agent desktop streams here when active</p>
        </div>
        <div id="terminal-view" class="terminal-pane hidden">
          <div id="terminal-output" style="white-space:pre-wrap;word-break:break-all;"></div>
        </div>
        <div id="terminal-input-row" class="hidden" style="display:flex;gap:0.5rem;padding:0.5rem;border-top:1px solid var(--color-border);flex-shrink:0;">
          <span style="color:var(--color-success);font-family:var(--font-mono);font-size:0.8rem;align-self:center;">$</span>
          <input id="terminal-cmd" class="form-input font-mono" style="flex:1;font-size:0.8rem;" placeholder="command…">
          <button class="btn btn-sm btn-primary" onclick="window.sendTermCmd()">↵</button>
        </div>
      </div>
    </div>
  </div>`;
}

function bindEvents(el) {
  const selector = document.getElementById('agent-selector');
  selector?.addEventListener('change', () => {
    const agent = allAgents.find(a => a.id === selector.value);
    if (agent) selectAgent(agent, el);
  });
  const input = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send');
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  sendBtn?.addEventListener('click', sendMessage);
  document.getElementById('clear-chat-btn')?.addEventListener('click', () => {
    chatMessages = [];
    document.getElementById('chat-messages').innerHTML = '';
  });
}

async function selectAgent(agent, el) {
  selectedAgent = agent;
  document.getElementById('agent-selector').value = agent.id;
  const badge = document.getElementById('agent-status-badge');
  badge.className = `badge badge-${agent.status || 'standby'}`;
  badge.textContent = agent.source === 'gateway' ? 'gateway' : (agent.status || 'standby');
  document.getElementById('chat-input').disabled = false;
  document.getElementById('chat-send').disabled = false;

  const container = document.getElementById('chat-messages');
  container.innerHTML = '';
  chatMessages = [];

  if (agent.source === 'local') {
    // Load local chat history
    const msgs = await window.apiFetch(`/chat/${agent.id}`).catch(() => []);
    chatMessages = msgs || [];
    chatMessages.forEach(appendMessage);
  } else {
    // Gateway agent — show info card
    const info = gatewayAgents.find(a => a.agentId === agent.agentId);
    if (info) {
      const sessions = info.sessions?.count || 0;
      const recent = info.sessions?.recent?.slice(0, 3) || [];
      container.innerHTML = `<div class="card" style="margin:1rem;">
                <div style="font-weight:600;margin-bottom:0.5rem;"><i class="fa fa-satellite-dish"></i> ${escHtml(info.name || info.agentId)}</div>
                <div style="font-size:0.8rem;color:var(--color-text-muted);">Sessions: ${sessions} · Heartbeat: ${info.heartbeat?.enabled ? info.heartbeat.every : 'Off'}</div>
                ${recent.length ? `<div style="margin-top:0.5rem;font-size:0.75rem;color:var(--color-text-muted);">Recent sessions:<br>${recent.map(s => `&nbsp;&nbsp;• ${escHtml(s.key)}`).join('<br>')}</div>` : ''}
                <div style="margin-top:0.75rem;padding:0.5rem;background:var(--color-surface);border-radius:var(--radius-sm);font-size:0.75rem;color:#f59e0b;">
                    <i class="fa fa-info-circle"></i> Type a message below to send to this gateway agent.
                </div>
            </div>`;
    }
  }
}

function appendMessage(msg) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  const div = document.createElement('div');
  div.className = `chat-msg ${msg.role === 'user' ? 'user' : 'agent'}`;
  div.innerHTML = `<div class="chat-msg-bubble">${escHtml(msg.content)}</div>
    <div class="chat-msg-meta">${msg.role === 'user' ? 'You' : selectedAgent?.name || 'Agent'} · ${timeAgo(msg.created_at)}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function sendMessage() {
  const input = document.getElementById('chat-input');
  const content = input.value.trim();
  if (!content || !selectedAgent) return;
  input.value = '';

  const msg = { agent_id: selectedAgent.id, role: 'user', content, created_at: Math.floor(Date.now() / 1000) };
  appendMessage(msg);

  try {
    if (selectedAgent.source === 'gateway') {
      // Send via gateway
      const res = await window.apiFetch('/api/gateway/chat', { method: 'POST', body: { agentId: selectedAgent.agentId, message: content } });
      if (!res.ok && !res.requestId) throw new Error(res.error || 'Gateway send failed');
    } else {
      await window.apiFetch(`/chat/${selectedAgent.id}`, { method: 'POST', body: { role: 'user', content } });
    }
  } catch (e) { window.showToast('Failed to send: ' + e.message, 'error'); }
}

window.switchDesktopView = function (view) {
  const termView = document.getElementById('terminal-view');
  const termInput = document.getElementById('terminal-input-row');
  const empty = document.getElementById('desktop-empty');
  if (view === 'terminal') {
    termView?.classList.remove('hidden');
    termInput?.classList.remove('hidden');
    termInput.style.display = 'flex';
    empty?.classList.add('hidden');
    if (!terminalWs) initTerminal();
  } else {
    termView?.classList.add('hidden');
    termInput?.classList.add('hidden');
    empty?.classList.remove('hidden');
  }
};

function initTerminal() {
  const session = localStorage.getItem('mc_session') || sessionStorage.getItem('mc_session');
  const wsProto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  terminalWs = new WebSocket(`${wsProto}//${location.host}/ws/terminal?sessionId=${session}`);
  terminalWs.onmessage = (e) => {
    const { type, data } = JSON.parse(e.data);
    if (type === 'output') {
      terminalBuffer += data;
      const out = document.getElementById('terminal-output');
      if (out) { out.textContent = terminalBuffer.slice(-10000); out.parentElement.scrollTop = out.parentElement.scrollHeight; }
    }
  };
  terminalWs.onclose = () => { terminalWs = null; };
}

window.sendTermCmd = function () {
  const input = document.getElementById('terminal-cmd');
  if (!terminalWs || !input.value) return;
  terminalWs.send(JSON.stringify({ type: 'input', data: input.value + '\n' }));
  input.value = '';
};

document.addEventListener('keydown', (e) => {
  const inp = document.getElementById('terminal-cmd');
  if (inp && e.target === inp && e.key === 'Enter') window.sendTermCmd();
});

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function timeAgo(ts) { if (!ts) return ''; const d = Math.floor(Date.now() / 1000) - ts; return d < 60 ? `${d}s` : d < 3600 ? `${Math.floor(d / 60)}m` : d < 86400 ? `${Math.floor(d / 3600)}h` : `${Math.floor(d / 86400)}d`; }
