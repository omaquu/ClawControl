// Agent Chat Page
let agents = [];
let selectedAgent = null;
let chatMessages = [];
let terminalWs = null;
let terminalBuffer = '';

export async function init(el) {
    agents = (await window.apiFetch('/agents')) || [];
    el.innerHTML = buildLayout(agents);
    bindEvents(el);
    if (agents.length > 0) selectAgent(agents[0], el);
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
            ${agents.map(a => `<option value="${a.id}">${a.name} (${a.model || 'no model'})</option>`).join('')}
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
        <div id="terminal-view" class="terminal-pane hidden" id="terminal-view">
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
        const agent = agents.find(a => a.id === selector.value);
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
    badge.textContent = agent.status || 'standby';
    document.getElementById('chat-input').disabled = false;
    document.getElementById('chat-send').disabled = false;
    // Load chat history
    const msgs = await window.apiFetch(`/chat/${agent.id}`).catch(() => []);
    chatMessages = msgs || [];
    const container = document.getElementById('chat-messages');
    container.innerHTML = '';
    chatMessages.forEach(appendMessage);
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
        await window.apiFetch(`/chat/${selectedAgent.id}`, { method: 'POST', body: { role: 'user', content } });
    } catch (e) { window.showToast('Failed to send', 'error'); }
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
