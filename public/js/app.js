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
  const res = await fetch('/api' + url, opts);
  if (res.status === 401) { handleLogout(); return null; }
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
  document.getElementById('auth-guard').innerHTML = type === 'register' ? renderRegisterPage() : renderLoginPage();
}

function showApp(username) {
  document.getElementById('auth-guard').classList.add('hidden');
  document.getElementById('app-shell').classList.remove('hidden');
  document.getElementById('username-display').textContent = username || '';
  initSSE();
  initGateway();
  loadWorkspaces();
  loadSidebarAgents();
}

function renderLoginPage() {
  return `
  <div class="auth-page">
    <div class="auth-box">
      <div class="auth-logo">
        <i class="fa fa-satellite-dish"></i>
        <h1>Mission Control</h1>
        <p>OpenClaw Operations Dashboard</p>
      </div>
      <div id="auth-error" class="auth-error hidden"></div>
      <form id="login-form">
        <div class="form-group">
          <label class="form-label">Username</label>
          <input class="form-input" type="text" id="login-user" autocomplete="username" required>
        </div>
        <div class="form-group">
          <label class="form-label">Password</label>
          <input class="form-input" type="password" id="login-pass" autocomplete="current-password" required>
        </div>
        <div class="form-group hidden" id="totp-group">
          <label class="form-label">Authenticator Code</label>
          <input class="form-input" type="text" id="login-totp" placeholder="6-digit code" maxlength="6" autocomplete="one-time-code">
        </div>
        <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem;">
          <input type="checkbox" id="remember-me" style="width:auto;">
          <label style="font-size:0.8rem;color:var(--color-text-muted);" for="remember-me">Remember me (3h)</label>
        </div>
        <button class="btn btn-primary w-full" type="submit" id="login-btn">
          <i class="fa fa-right-to-bracket"></i> Login
        </button>
      </form>
      <div style="text-align:center;margin-top:1rem;">
        <a href="#" onclick="showForgotPassword()" style="font-size:0.78rem;color:var(--color-text-muted);">Forgot password?</a>
      </div>
    </div>
  </div>`;
}

function renderRegisterPage() {
  return `
  <div class="auth-page">
    <div class="auth-box">
      <div class="auth-logo">
        <i class="fa fa-satellite-dish"></i>
        <h1>Mission Control</h1>
        <p>First-time setup — create your account</p>
      </div>
      <div id="auth-error" class="auth-error hidden"></div>
      <form id="register-form">
        <div class="form-group">
          <label class="form-label">Username</label>
          <input class="form-input" type="text" id="reg-user" required>
        </div>
        <div class="form-group">
          <label class="form-label">Password (min 8 chars)</label>
          <input class="form-input" type="password" id="reg-pass" required minlength="8">
        </div>
        <div class="form-group">
          <label class="form-label">Confirm Password</label>
          <input class="form-input" type="password" id="reg-pass2" required>
        </div>
        <button class="btn btn-primary w-full" type="submit">
          <i class="fa fa-user-plus"></i> Create Account
        </button>
      </form>
    </div>
  </div>`;
}

window.showForgotPassword = function () {
  document.getElementById('auth-guard').innerHTML = `
  <div class="auth-page">
    <div class="auth-box">
      <div class="auth-logo"><i class="fa fa-key"></i><h1>Password Recovery</h1></div>
      <div id="auth-error" class="auth-error hidden"></div>
      <div class="form-group"><label class="form-label">Recovery Token</label>
        <input class="form-input" type="text" id="rec-token" placeholder="From server startup logs"></div>
      <div class="form-group"><label class="form-label">New Password</label>
        <input class="form-input" type="password" id="rec-pass"></div>
      <button class="btn btn-primary w-full" onclick="doReset()"><i class="fa fa-rotate"></i> Reset Password</button>
      <div style="text-align:center;margin-top:0.75rem;">
        <a href="#" onclick="showAuthPage('login')" style="font-size:0.78rem;color:var(--color-text-muted);">Back to login</a>
      </div>
    </div>
  </div>`;
};

window.doReset = async function () {
  const token = document.getElementById('rec-token').value;
  const pw = document.getElementById('rec-pass').value;
  try {
    await apiFetch('/auth/reset-password', { method: 'POST', body: { token, newPassword: pw } });
    showToast('Password reset! Please login.', 'success');
    showAuthPage('login');
  } catch (e) { showAuthError(e.message); }
};

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  if (el) { el.textContent = msg; el.classList.remove('hidden'); }
}

document.addEventListener('submit', async (e) => {
  if (e.target.id === 'login-form') {
    e.preventDefault();
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
    } catch (e) { showAuthError(e.message); }
  }
  if (e.target.id === 'register-form') {
    e.preventDefault();
    const username = document.getElementById('reg-user').value;
    const password = document.getElementById('reg-pass').value;
    const pw2 = document.getElementById('reg-pass2').value;
    if (password !== pw2) { showAuthError('Passwords do not match'); return; }
    try {
      await apiFetch('/auth/register', { method: 'POST', body: { username, password } });
      showToast('Account created! Please login.', 'success');
      showAuthPage('login');
    } catch (e) { showAuthError(e.message); }
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
  const url = `/api/live?sessionId=${currentSession}`;
  sseSource = new EventSource(url);
  sseSource.onmessage = (e) => {
    try {
      const event = JSON.parse(e.data);
      if (event.type === 'connected') return;
      addFeedItem(event);
      if (event.type && (event.type.startsWith('AGENT_') || event.type === 'TASK_ASSIGNED')) {
        loadSidebarAgents();
      }
      // dispatch to page handlers
      window.dispatchEvent(new CustomEvent('mc:event', { detail: event }));
    } catch { }
  };
  sseSource.onerror = () => { setTimeout(initSSE, 3000); };
}

function initGateway() {
  apiFetch('/gateway/status').then(s => {
    const dot = document.getElementById('gateway-dot');
    const label = document.getElementById('gateway-label');
    if (s && s.connected) { dot.className = 'status-dot online'; label.textContent = 'Gateway Online'; }
    else { dot.className = 'status-dot offline'; label.textContent = 'Gateway Offline'; }
  }).catch(() => { });
}

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
    const agents = await apiFetch('/agents');
    if (!agents || !agents.length) {
      list.innerHTML = '<div style="font-size:0.7rem;color:var(--color-text-muted);">No agents</div>';
      return;
    }
    list.innerHTML = agents.map(a => {
      const statusColor = a.status === 'active' ? 'var(--color-success)' : a.status === 'busy' ? 'var(--color-warning)' : a.status === 'error' ? 'var(--color-danger)' : 'var(--color-text-muted)';
      const statusDot = `<div style="width:6px;height:6px;border-radius:50%;background:${statusColor};flex-shrink:0;"></div>`;
      return `<div class="sidebar-agent-item" style="display:flex;align-items:center;gap:0.4rem;padding:0.3rem 0;cursor:pointer;opacity:0.8;transition:0.2s;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.8'" onclick="document.querySelector('[data-page=agents]').click()">
        ${statusDot}
        <div style="flex:1;min-width:0;">
          <div style="font-size:0.75rem;font-weight:500;color:var(--color-text);" class="truncate">${a.name}</div>
          <div style="font-size:0.65rem;color:var(--color-text-muted);" class="truncate">${a.model || 'No model'}</div>
        </div>
      </div>`;
    }).join('');
  } catch (e) { }
}

function addFeedItem(event) {
  const container = document.getElementById('feed-items');
  if (!container) return;
  const typeClass = event.type?.includes('ERROR') ? 'type-error' : event.type?.includes('DONE') ? 'type-success' : '';
  const item = document.createElement('div');
  item.className = `feed - item ${typeClass} `;
  item.innerHTML = `< div class="feed-item-type" > ${event.type || 'EVENT'}</div >
    <div class="truncate text-xs" style="color:var(--color-text-muted);">${JSON.stringify(event.payload || {}).slice(0, 80)}</div>
    <div class="feed-item-time">${new Date().toLocaleTimeString()}</div>`;
  item.addEventListener('click', () => openModal(`< div class="modal-header" ><span class="modal-title">${event.type}</span><button class="icon-btn" onclick="closeModal()"><i class="fa fa-xmark"></i></button></div > <pre style="font-size:0.78rem;overflow:auto;max-height:400px;">${JSON.stringify(event, null, 2)}</pre>`));
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
  el.className = `toast ${type} `;
  el.innerHTML = `< div style = "margin-right:0.25rem;color:var(--color-${type === 'success' ? 'success' : type === 'error' ? 'danger' : type === 'warning' ? 'warning' : 'info'})" > <i class="fa fa-${type === 'success' ? 'check-circle' : type === 'error' ? 'circle-exclamation' : type === 'warning' ? 'triangle-exclamation' : 'circle-info'}"></i></div >
    <div class="toast-body">${title ? `<div class="toast-title">${title}</div>` : ''}<div class="toast-msg">${message}</div></div>
    <button class="icon-btn" style="flex-shrink:0" onclick="this.parentElement.remove()"><i class="fa fa-xmark"></i></button>`;
  container.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translateX(30px)'; el.style.transition = '0.3s'; setTimeout(() => el.remove(), 300); }, 4000);
};

// ─── Modal ────────────────────────────────────────────────────────────────────
window.openModal = function (html, size = '') {
  const overlay = document.getElementById('global-modal');
  const box = document.getElementById('modal-content');
  box.className = `modal - box ${size} `;
  box.innerHTML = html;
  overlay.classList.remove('hidden');
};
window.closeModal = function () { document.getElementById('global-modal').classList.add('hidden'); };
document.getElementById('global-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeModal();
});

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
  health: 'Health', logs: 'Logs', crons: 'Crons', settings: 'Settings'
};

const PAGE_ORDER = ['kanban', 'chat', 'consul', 'sessions', 'costs', 'ratelimits', 'agents', 'channels', 'files', 'health', 'logs', 'crons', 'settings'];

async function navigateTo(page) {
  if (!PAGE_TITLES[page]) page = 'kanban';
  currentPage = page;
  document.querySelectorAll('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.page === page));
  document.getElementById('page-title').textContent = PAGE_TITLES[page] || page;
  const container = document.getElementById('page-container');
  let pageEl = document.getElementById(`page - ${page} `);
  if (!pageEl) {
    pageEl = document.createElement('div');
    pageEl.id = `page - ${page} `;
    pageEl.className = 'page';
    container.appendChild(pageEl);
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  pageEl.classList.add('active');

  if (!PAGE_MODULES[page]) {
    try {
      const mod = await import(`/ js / pages / ${page}.js`);
      PAGE_MODULES[page] = mod;
      mod.init(pageEl);
    } catch (e) {
      pageEl.innerHTML = `< div class="empty-state" ><i class="fa fa-triangle-exclamation"></i><p>Page "${page}" failed to load.<br><small>${e.message}</small></p></div > `;
    }
  } else {
    PAGE_MODULES[page].refresh?.(pageEl);
  }
}

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

// Live feed toggle
let feedVisible = true;
document.getElementById('close-feed-btn').addEventListener('click', () => {
  feedVisible = false;
  document.getElementById('app-shell').classList.add('feed-hidden');
});

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
