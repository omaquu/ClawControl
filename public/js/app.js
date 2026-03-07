// ─── Core App JS — SPA Router + Auth + Theme + Live Feed ─────────────────────
const API = { base: '/api' };
let currentSession = null;
let sseSource = null;
let gatewaySocket = null;
let errorCount = 0;
const feedItems = [];

// ─── API Helpers ──────────────────────────────────────────────────────────────
async function apiFetch(url, opts = {}) {
  if (!opts.headers) opts.headers = {};
  if (currentSession) opts.headers['x-session-id'] = currentSession;
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }
  const fullPath = url.startsWith('auth/') ? '/api' + url : (url.startsWith('http') ? url : 'api' + url); // Fallback logic
  const res = await fetch(fullPath, opts);
  if (res.status === 401 && !url.includes('/auth/logout')) {
    handleLogout();
    return null;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API error');
    return data;
  }
  return await res.text();
}
// Expose globally so dynamic ES-module pages can call window.apiFetch(...)
window.apiFetch = apiFetch;

// Convenience alias — new pages use window.api(path, opts)
window.api = async (path, opts = {}) => {
  if (!opts.headers) opts.headers = {};
  if (currentSession) opts.headers['x-session-id'] = currentSession;
  if (opts.body && typeof opts.body === 'string') opts.headers['Content-Type'] = 'application/json';
  const fullPath = path.startsWith('api') ? path : 'api' + (path.startsWith('/') ? path : '/' + path);
  const res = await fetch(fullPath, opts);
  if (res.status === 401 && !fullPath.includes('/auth/logout')) {
    handleLogout();
    return null;
  }
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('json')) {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'API error');
    return data;
  }
  return await res.text();
};


// ─── Auth ─────────────────────────────────────────────────────────────────────
async function checkAuth() {
  const stored = localStorage.getItem('mc_session') || sessionStorage.getItem('mc_session');
  if (stored) currentSession = stored;
  const status = await apiFetch('/auth/status').catch(() => null);
  if (!status) { showAuthPage('login'); return false; }
  if (!status.registered) { showAuthPage('register'); return false; }
  if (!status.authenticated) { showAuthPage('login'); return false; }
  return true;
}

function showAuthPage(type) {
  document.getElementById('app-shell').classList.add('hidden');
  document.getElementById('auth-guard').classList.remove('hidden');

  // Hide all auth pages first
  document.querySelectorAll('.auth-page').forEach(el => el.classList.add('hidden'));

  // Show the requested one
  const target = document.getElementById(`auth-${type}`);
  if (target) target.classList.remove('hidden');
}

window.showAuthPage = showAuthPage;

function showApp(username) {
  document.getElementById('auth-guard').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  document.getElementById('username-display').textContent = username || '';
  initSSE();
  initGateway();
  loadWorkspaces();
  loadSidebarAgents();
  window.updateNotifBadge?.();

  // Start background polling only after login
  if (!window._sidebarPoll) {
    window._sidebarPoll = setInterval(loadSidebarAgents, 15000);
  }
}

// Global expose for inline onclicks in index.html
window.doReset = async function (e) {
  if (e) e.preventDefault();
  const token = document.getElementById('rec-token').value;
  const pw = document.getElementById('rec-pass').value;
  try {
    await apiFetch('/auth/reset-password', { method: 'POST', body: { token, newPassword: pw } });
    window.showToast('Password reset! Please login.', 'success');
    showAuthPage('login');
  } catch (e) { showAuthError(e.message, 'rec-error'); }
};

// Removed old duplicate doReset
function showAuthError(msg, id = 'login-error') {
  const el = document.getElementById(id);
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

document.addEventListener('submit', async (e) => {
  if (e.target.id === 'login-form') {
    e.preventDefault();
    document.getElementById('login-error')?.classList.add('hidden');
    const username = document.getElementById('login-user').value;
    const password = document.getElementById('login-pass').value;
    const totp = document.getElementById('login-totp')?.value;
    const remember = document.getElementById('remember-me')?.checked;
    try {
      const res = await apiFetch('/auth/login', { method: 'POST', body: { username, password, totp } });
      if (!res) return;
      if (res.mfaRequired) {
        document.getElementById('totp-group').classList.remove('hidden');
        document.getElementById('login-totp').focus();
        return;
      }
      currentSession = res.sessionId;
      const storage = remember ? localStorage : sessionStorage;
      storage.setItem('mc_session', res.sessionId);
      showApp(res.username);
      navigateTo(currentPage || 'kanban');
    } catch (err) { showAuthError(err.message, 'login-error'); }
  }
  else if (e.target.id === 'register-form') {
    e.preventDefault();
    document.getElementById('reg-error')?.classList.add('hidden');
    const username = document.getElementById('reg-user').value;
    const password = document.getElementById('reg-pass').value;
    const pw2 = document.getElementById('reg-pass2').value;
    if (password !== pw2) { showAuthError('Passwords do not match', 'reg-error'); return; }
    try {
      await apiFetch('/auth/register', { method: 'POST', body: { username, password } });
      window.showToast('Account created! Please login.', 'success');
      showAuthPage('login');
    } catch (err) { showAuthError(err.message, 'reg-error'); }
  }
  else if (e.target.id === 'recover-form') {
    e.preventDefault();
    window.doReset(e);
  }
});

async function handleLogout() {
  try { await apiFetch('/auth/logout', { method: 'POST' }); } catch { }
  currentSession = null;
  localStorage.removeItem('mc_session');
  sessionStorage.removeItem('mc_session');
  if (sseSource) { sseSource.close(); sseSource = null; }
  showAuthPage('login');
}

// ─── SSE Live Feed ────────────────────────────────────────────────────────────
function initSSE() {
  if (sseSource) sseSource.close();
  const url = `api/live?sessionId=${currentSession}`;
  sseSource = new EventSource(url);
  sseSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      if (event.type === 'connected') return;
      addFeedItem(event);
      if (event.type && (event.type.startsWith('AGENT_') || event.type === 'TASK_ASSIGNED')) {
        loadSidebarAgents();
      }
      if (event.type === 'NOTIFICATION') {
        window.updateNotifBadge?.();
        window.showToast(event.payload?.title || 'New notification', 'info');
      }
      if (event.type === 'PROVIDER_HEALTH_CHANGED') {
        window._providerRefresh?.();
      }
      if (event.type === 'GATEWAY_CONNECTED_OK') {
        initGateway();
      }
      if (event.type === 'GATEWAY_NODES') {
        loadSidebarAgents();
      }
      // dispatch to page handlers
      window.dispatchEvent(new CustomEvent('mc:event', { detail: event }));
    } catch { }
  };
  sseSource.onerror = () => { setTimeout(initSSE, 3000); };
}

// Gateway log buffer — last 50 entries visible in the sidebar popover
const _gatewayLogs = [];
function addGatewayLog(msg, level = 'info') {
  const ts = new Date().toLocaleTimeString();
  _gatewayLogs.unshift({ ts, msg, level });
  if (_gatewayLogs.length > 50) _gatewayLogs.pop();
  // Refresh popover if open
  const pop = document.getElementById('gateway-log-popover');
  if (pop) renderGatewayPopover(pop);
}

function renderGatewayPopover(pop) {
  pop.innerHTML = `
    <div style="font-size:0.72rem;font-weight:700;color:var(--color-text-muted);margin-bottom:0.5rem;letter-spacing:0.06em;">GATEWAY LOG</div>
    ${_gatewayLogs.length ? _gatewayLogs.slice(0, 20).map(l => `
      <div style="display:flex;gap:0.5rem;margin-bottom:0.2rem;line-height:1.4;">
        <span style="color:var(--color-text-muted);font-size:0.68rem;flex-shrink:0;">${l.ts}</span>
        <span style="font-size:0.75rem;color:${l.level === 'error' ? 'var(--color-danger)' : l.level === 'success' ? 'var(--color-success)' : 'var(--color-text)'};">${l.msg}</span>
      </div>`).join('') : '<div style="color:var(--color-text-muted);font-size:0.78rem;">No logs yet</div>'}`;
}

function initGateway() {
  apiFetch('/gateway/status').then(s => {
    const dot = document.getElementById('gateway-dot');
    const label = document.getElementById('gateway-label');
    if (!dot || !label) return;
    if (s && s.connected) {
      dot.className = 'status-dot online';
      label.textContent = 'Gateway Online';
      addGatewayLog(`✅ Connected to ${s.url || 'gateway'}`, 'success');
    } else {
      dot.className = 'status-dot offline';
      const retryPart = s?.reconnectAttempts ? ` (retry #${s.reconnectAttempts})` : '';
      label.textContent = `Gateway Offline${retryPart}`;
      if (s?.lastError) {
        label.title = s.lastError;
        addGatewayLog(`❌ ${s.lastError}`, 'error');
      } else {
        addGatewayLog(`⚠️ Gateway offline${retryPart}`, 'warn');
      }
    }
  }).catch(e => {
    addGatewayLog(`❌ Status fetch failed: ${e.message}`, 'error');
  });
}

// Make gateway pill clickable to show log popover
document.getElementById('gateway-status')?.addEventListener('click', () => {
  let pop = document.getElementById('gateway-log-popover');
  if (pop) { pop.remove(); return; }
  pop = document.createElement('div');
  pop.id = 'gateway-log-popover';
  pop.style.cssText = 'position:fixed;left:260px;top:80px;width:340px;max-height:320px;overflow-y:auto;z-index:500;background:var(--color-card);border:1px solid var(--color-border);border-radius:10px;padding:0.75rem 1rem;box-shadow:0 8px 32px rgba(0,0,0,0.4);font-family:var(--font-mono);';
  renderGatewayPopover(pop);
  document.body.appendChild(pop);
  setTimeout(() => document.addEventListener('click', function handler(e) {
    if (!pop.contains(e.target) && e.target.id !== 'gateway-status' && !document.getElementById('gateway-status')?.contains(e.target)) {
      pop.remove(); document.removeEventListener('click', handler);
    }
  }, { capture: true }), 100);
});


// Notification badge helper
window.updateNotifBadge = async function () {
  try {
    const r = await apiFetch('/notifications/unread-count');
    const badge = document.getElementById('notif-nav-badge');
    if (badge) {
      badge.textContent = r?.count || 0;
      badge.classList.toggle('hidden', !r?.count);
    }
  } catch { }
};

async function loadWorkspaces() {
  const sel = document.getElementById('workspace-selector');
  if (!sel) return;
  try {
    const list = await apiFetch('/workspaces');
    sel.innerHTML = list.map(w => `<option value="${w.id}" ${w.active ? 'selected' : ''}>${w.name}</option>`).join('');
  } catch (e) { sel.innerHTML = '<option>Workspace</option>'; }
}

async function loadSidebarAgents() {
  const list = document.getElementById('sidebar-agents-list');
  if (!list) return;
  try {
    const agents = await apiFetch('/gateway/agents');
    if (!agents || !agents.length) {
      list.innerHTML = '<div style="font-size:0.7rem;color:var(--color-text-muted);">No agents</div>';
      return;
    }
    // Cache for kanban task modal
    window._agents = agents;
    list.innerHTML = agents.map(a => {
      const status = a.status || 'offline';
      const statusColor = status === 'online' || status === 'active' ? 'var(--color-success)' : status === 'busy' ? 'var(--color-warning)' : status === 'error' ? 'var(--color-danger)' : 'var(--color-text-muted)';
      const statusDot = `<div style="width:6px;height:6px;border-radius:50%;background:${statusColor};flex-shrink:0;"></div>`;
      return `<div class="sidebar-agent-item" style="display:flex;align-items:center;gap:0.4rem;padding:0.3rem 0;cursor:pointer;opacity:0.8;transition:0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'" onclick="window.navigate('chat', { agentId: '${a.id}' })">
        ${statusDot}
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.75rem;font-weight:500;color:var(--color-text);" class="truncate">${a.name}</div>
          <div style="font-size:0.65rem;color:var(--color-text-muted);" class="truncate">${a.kind || a.model || 'agent'}</div>
        </div>
      </div>`;
    }).join('');
  } catch (e) { }
}

function addFeedItem(event) {
  const container = document.getElementById('feed-items');
  if (!container) return;

  // Filter out noisy events from the Live Feed UI
  const t = event.type || '';
  if (
    t.includes('TICK') ||
    t === 'GATEWAY_MSG' ||
    t === 'GATEWAY_CONNECTED' ||
    t === 'GATEWAY_DISCONNECTED' ||
    t === 'GATEWAY_NODES' ||
    t === 'PROVIDER_HEALTH_CHANGED'
  ) {
    if (t !== 'GATEWAY_MSG' || !event.payload?.raw?.includes('"event":"error"')) {
      // Only let GATEWAY_MSG through if it's an explicit error
      return;
    }
  }

  const typeClass = t.includes('ERROR') ? 'type-error' : t.includes('DONE') ? 'type-success' : '';
  const item = document.createElement('div');
  item.className = `feed-item ${typeClass}`;
  item.innerHTML = `<div class="feed-item-type">${t || 'EVENT'}</div>
    <div class="truncate text-xs" style="color:var(--color-text-muted);">${JSON.stringify(event.payload || {}).slice(0, 80)}</div>
    <div class="feed-item-time">${new Date().toLocaleTimeString()}</div>`;
  item.addEventListener('click', () => openModal(`<div class="modal-header"><span class="modal-title">${t}</span><button class="icon-btn" onclick="closeModal()"><i class="fa fa-xmark"></i></button></div> <pre style="font-size:0.78rem;overflow:auto;max-height:400px;">${JSON.stringify(event, null, 2)}</pre>`));
  container.prepend(item);
  // Keep max 100 items
  while (container.children.length > 100) container.removeChild(container.lastChild);

  if (typeClass === 'type-error') {
    errorCount++;
    const badge = document.getElementById('error-badge');
    badge.classList.remove('hidden');
    document.getElementById('error-count').textContent = errorCount;
  }
}

// ─── Toast ────────────────────────────────────────────────────────────────────
window.showToast = function (message, type = 'info', title = '') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<div style="margin-right:0.25rem;color:var(--color-${type === 'success' ? 'success' : type === 'error' ? 'danger' : type === 'warning' ? 'warning' : 'info'})"> <i class="fa fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'circle-exclamation' : type === 'warning' ? 'triangle-exclamation' : 'circle-info'}"></i></div>
    <div class="toast-body">${title ? `<div class="toast-title">${title}</div>` : ''}<div class="toast-msg">${message}</div></div>
    <button class="icon-btn" style="flex-shrink:0" onclick="this.parentElement.remove()"><i class="fa fa-xmark"></i></button>`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(30px)'; el.style.transition = '0.3s'; setTimeout(() => el.remove(), 300); }, 4000);
};

// ─── Modal ────────────────────────────────────────────────────────────────────
window.openModal = function (html, size = '') {
  const overlay = document.getElementById('global-modal');
  const box = document.getElementById('modal-content');
  box.className = `modal-box ${size}`;
  box.innerHTML = html;
  overlay.classList.remove('hidden');
};
window.closeModal = function () { document.getElementById('global-modal').classList.add('hidden'); };
document.getElementById('global-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

// showModal helper used by new page modules
window.showModal = function (title, bodyHtml, buttons = []) {
  const btns = buttons.map(b => `<button class="btn ${b.cls || 'btn-ghost'}" id="modal-btn-${b.label.replace(/\s+/g, '_')}">${b.label}</button>`).join('');
  window.openModal(`
    <div class="modal-header"><span class="modal-title">${title}</span>
      <button class="icon-btn" onclick="closeModal()"><i class="fa fa-xmark"></i></button></div>
    <div class="modal-body" style="padding:1rem;">${bodyHtml}</div>
    <div class="modal-footer" style="padding:0.75rem 1rem;display:flex;justify-content:flex-end;gap:0.5rem;border-top:1px solid var(--color-border);">${btns}</div>`);
  buttons.forEach(b => {
    const el = document.getElementById(`modal-btn-${b.label.replace(/\s+/g, '_')}`);
    if (el && b.onClick) el.addEventListener('click', b.onClick);
  });
};

// toast alias
window.toast = (msg, type = 'info') => window.showToast(msg, type);

// ─── Theme System ─────────────────────────────────────────────────────────────
const PRESETS = {
  dark: { '--color-bg': '#0a0a0f', '--color-surface': '#13131a', '--color-card': '#1a1a24', '--color-sidebar': '#0d0d14', '--color-accent': '#6366f1', '--color-accent2': '#8b5cf6', '--color-text': '#e2e8f0', '--color-border': '#2a2a3a', '--color-success': '#10b981', '--color-warning': '#f59e0b', '--color-danger': '#ef4444' },
  midnight: { '--color-bg': '#050510', '--color-surface': '#0a0a1a', '--color-card': '#0f0f22', '--color-sidebar': '#070712', '--color-accent': '#818cf8', '--color-accent2': '#a78bfa', '--color-text': '#c7d2fe', '--color-border': '#1e1e3a', '--color-success': '#34d399', '--color-warning': '#fbbf24', '--color-danger': '#f87171' },
  cyber: { '--color-bg': '#000a0e', '--color-surface': '#001219', '--color-card': '#001e28', '--color-sidebar': '#000d14', '--color-accent': '#00e5ff', '--color-accent2': '#00bcd4', '--color-text': '#e0f7fa', '--color-border': '#003344', '--color-success': '#00e676', '--color-warning': '#ffea00', '--color-danger': '#ff1744' },
  forest: { '--color-bg': '#080f0a', '--color-surface': '#0e1a10', '--color-card': '#142518', '--color-sidebar': '#0a1210', '--color-accent': '#4caf50', '--color-accent2': '#66bb6a', '--color-text': '#e8f5e9', '--color-border': '#1e3320', '--color-success': '#69f0ae', '--color-warning': '#ffca28', '--color-danger': '#ff5252' }
};

function applyTheme(vars) {
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  const accentHex = vars['--color-accent'] || getComputedStyle(root).getPropertyValue('--color-accent').trim();
  const r = parseInt(accentHex.slice(1, 3), 16), g = parseInt(accentHex.slice(3, 5), 16), b = parseInt(accentHex.slice(5, 7), 16);
  root.style.setProperty('--color-accent-glow', `rgba(${r}, ${g}, ${b}, 0.25)`);
  localStorage.setItem('mc_theme', JSON.stringify(vars));
}

window.resetTheme = function () { applyTheme(PRESETS.dark); syncThemePickers(PRESETS.dark); };

function syncThemePickers(vars) {
  document.querySelectorAll('.theme-options input[data-var]').forEach(inp => {
    const v = vars[inp.dataset.var];
    if (v) inp.value = v;
  });
}

// Load saved theme
const savedTheme = localStorage.getItem('mc_theme');
if (savedTheme) try { applyTheme(JSON.parse(savedTheme)); } catch { }

document.addEventListener('input', (e) => {
  if (e.target.dataset.var) { document.documentElement.style.setProperty(e.target.dataset.var, e.target.value); }
});

document.querySelectorAll('.preset-btn').forEach(btn => {
  btn.addEventListener('click', () => { const p = PRESETS[btn.dataset.preset]; if (p) { applyTheme(p); syncThemePickers(p); } });
});

document.getElementById('theme-toggle-btn').addEventListener('click', () => {
  document.getElementById('theme-panel').classList.toggle('hidden');
});

// ─── SPA Router ───────────────────────────────────────────────────────────────
const PAGE_MODULES = {};
let currentPage = 'kanban';

const PAGE_TITLES = {
  kanban: 'Mission Queue', chat: 'Agent Chat', consul: 'Consul',
  sessions: 'Sessions', costs: 'Costs', ratelimits: 'Rate Limits',
  agents: 'Agents', channels: 'Channels', files: 'Files',
  health: 'Health', logs: 'Logs', crons: 'Crons', settings: 'Settings',
  providers: '🔌 Provider Gateway', memory: '🧠 Memory Browser',
  search: '🔎 Global Search', notifications: '🔔 Notifications', office3d: '🏢 3D Office'
};

const PAGE_ORDER = [
  'kanban', 'chat', 'consul', 'sessions', 'costs', 'ratelimits',
  'agents', 'channels', 'files', 'health', 'logs', 'crons', 'settings',
  'providers', 'memory', 'search', 'notifications', 'office3d'
];

// Deep-link params store: window.navigate('chat', { agentId: 'x' }) stores params here before navigating
const _pageParams = {};

async function navigateTo(page) {
  if (!PAGE_TITLES[page]) page = 'kanban';
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  document.getElementById('page-title').textContent = PAGE_TITLES[page] || page;
  const container = document.getElementById('page-container');
  let pageEl = document.getElementById(`page-${page}`);
  if (!pageEl) {
    pageEl = document.createElement('div');
    pageEl.id = `page-${page}`;
    pageEl.className = 'page';
    container.appendChild(pageEl);
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  pageEl.classList.add('active');

  // Consume any stored params for this page
  const params = _pageParams[page] || {};
  delete _pageParams[page];

  if (!PAGE_MODULES[page]) {
    try {
      const mod = await import(`./pages/${page}.js`);
      PAGE_MODULES[page] = mod;
      await mod.init(pageEl, params);
    } catch (e) {
      console.error(`[Router] Failed to load page "${page}":`, e);
      pageEl.innerHTML = `<div class="empty-state"><i class="fa fa-triangle-exclamation"></i><p>Page "${page}" failed to load.<br><small>${e.message}</small></p></div>`;
    }
  } else {
    // Re-init if params supplied (e.g. deep-link from agents page), otherwise just refresh
    if (Object.keys(params).length) {
      await PAGE_MODULES[page].init?.(pageEl, params);
    } else {
      await PAGE_MODULES[page].refresh?.(pageEl);
    }
  }
}
// Expose for inline onclick attributes in HTML
window.navigateTo = (page) => navigateTo(page);

// Deep-link helper: store params for target page and navigate
window.navigate = function (page, params = {}) {
  if (params && Object.keys(params).length) _pageParams[page] = params;
  navigateTo(page);
};


// Nav click handler
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', async (e) => {
    e.preventDefault();
    await navigateTo(el.dataset.page);
  });
});

// Sidebar toggle
let sidebarCollapsed = false;
document.getElementById('sidebar-toggle').addEventListener('click', () => {
  sidebarCollapsed = !sidebarCollapsed;
  document.getElementById('app-shell').classList.toggle('sidebar-collapsed', sidebarCollapsed);
});

// Live feed toggle — supports both open and close
let feedVisible = true;
function toggleFeed(show) {
  feedVisible = show !== undefined ? show : !feedVisible;
  document.getElementById('app-shell').classList.toggle('feed-hidden', !feedVisible);
  const btn = document.getElementById('feed-toggle-btn');
  if (btn) {
    btn.title = feedVisible ? 'Hide Live Feed' : 'Show Live Feed';
    btn.querySelector('i').className = feedVisible ? 'fa fa-satellite' : 'fa fa-satellite-dish';
  }
}
document.getElementById('close-feed-btn').addEventListener('click', () => toggleFeed(false));
window.toggleFeed = toggleFeed;

// Logout
document.getElementById('logout-btn').addEventListener('click', handleLogout);

// Error badge click
document.getElementById('error-badge').addEventListener('click', () => {
  errorCount = 0;
  document.getElementById('error-badge').classList.add('hidden');
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.key === '?') { document.getElementById('kb-help').classList.toggle('hidden'); return; }
  if (e.key === 'Escape') {
    closeModal();
    document.getElementById('kb-help').classList.add('hidden');
    document.getElementById('theme-panel').classList.add('hidden');
    return;
  }
  if (e.key === 't' || e.key === 'T') { document.getElementById('theme-panel').classList.toggle('hidden'); return; }
  if (e.key === 'n' || e.key === 'N') { window.dispatchEvent(new CustomEvent('mc:newTask')); return; }
  const idx = parseInt(e.key);
  if (idx >= 1 && idx <= PAGE_ORDER.length) navigateTo(PAGE_ORDER[idx - 1]);
});

// Gateway status polling
setInterval(initGateway, 30000);

// ─── Bootstrap ────────────────────────────────────────────────────────────────
(async () => {
  const authed = await checkAuth();
  if (authed) {
    const status = await apiFetch('/auth/status');
    showApp(localStorage.getItem('mc_username') || '');
    navigateTo(currentPage);
  }
})();
