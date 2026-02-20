// Settings Page — openclaw.json editor + auth settings + MFA
let configText = '';
let currentTab = 'raw';
let configObj = {};

export async function init(el) {
  el.innerHTML = buildLayout();
  await loadConfig();
  await loadAuthSettings();
  renderTabs();
  bindEvents(el);
}
export async function refresh(el) { loadConfig(); }

function buildLayout() {
  return `
  <div style="display:grid;grid-template-columns:1fr 340px;gap:1rem;height:calc(100vh - var(--topbar-height) - 3rem);">
    <!-- Config Editor -->
    <div class="card" style="display:flex;flex-direction:column;overflow:hidden;padding:0;">
      <div style="padding:0.75rem 1rem;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <span style="font-family:var(--font-mono);font-size:0.8rem;color:var(--color-text-muted);">openclaw.json</span>
          <span id="json-error-badge" class="hidden" style="font-size:0.68rem;color:var(--color-danger);background:rgba(239,68,68,0.12);padding:0.15rem 0.5rem;border-radius:999px;"><i class="fa fa-circle-exclamation"></i> Invalid</span>
        </div>
        <div style="display:flex;gap:0.4rem;">
          <button class="btn btn-sm btn-ghost" data-action="copy-json"><i class="fa fa-copy"></i></button>
          <button class="btn btn-sm btn-ghost" data-action="download-json"><i class="fa fa-download"></i></button>
          <button class="btn btn-sm btn-ghost" data-action="upload-json"><i class="fa fa-upload"></i></button>
          <input type="file" id="cfg-upload" accept=".json" style="display:none;">
          <button class="btn btn-sm btn-ghost" data-action="format-json" title="Format JSON"><i class="fa fa-code"></i></button>
          <button class="btn btn-primary btn-sm" data-action="save-config"><i class="fa fa-save"></i> Save</button>
        </div>
      </div>
      <div style="display:flex;border-bottom:1px solid var(--color-border);background:var(--color-bg);overflow-x:auto;" class="config-tabs">
        <button class="tab-btn active" data-tab="raw">Raw JSON</button>
        <button class="tab-btn" data-tab="models">Models</button>
        <button class="tab-btn" data-tab="agents">Agents</button>
        <button class="tab-btn" data-tab="channels">Channels</button>
        <button class="tab-btn" data-tab="env">Env Vars</button>
      </div>
      <div id="tab-content" style="flex:1;display:flex;flex-direction:column;overflow:hidden;">
        <textarea id="config-editor" class="code-editor" style="flex:1;border:none;border-radius:0;font-size:0.78rem;resize:none;padding:1rem;" spellcheck="false" placeholder="Loading openclaw.json…"></textarea>
        <div id="visual-editor" style="flex:1;overflow-y:auto;padding:1rem;display:none;background:var(--color-surface);"></div>
      </div>
    </div>
    <!-- Right panel -->
    <div style="display:flex;flex-direction:column;gap:1rem;overflow-y:auto;">
      <!-- Account -->
      <div class="card">
        <div class="card-title" style="margin-bottom:0.75rem;"><i class="fa fa-user-shield"></i> Account</div>
        <div class="form-group"><label class="form-label">Current Password</label>
          <input class="form-input" type="password" id="cpw-old"></div>
        <div class="form-group"><label class="form-label">New Password</label>
          <input class="form-input" type="password" id="cpw-new"></div>
        <div class="form-group"><label class="form-label">Confirm New Password</label>
          <input class="form-input" type="password" id="cpw-new2"></div>
        <button class="btn btn-secondary w-full" data-action="change-password"><i class="fa fa-key"></i> Change Password</button>
      </div>
      <!-- MFA -->
      <div class="card">
        <div class="card-title" style="margin-bottom:0.75rem;"><i class="fa fa-shield-halved"></i> Two-Factor Auth (TOTP)</div>
        <div id="mfa-status-area"><div style="color:var(--color-text-muted);font-size:0.8rem;">Loading…</div></div>
      </div>
      <!-- API Token -->
      <div class="card">
        <div class="card-title" style="margin-bottom:0.75rem;"><i class="fa fa-key"></i> API Token</div>
        <div style="font-size:0.8rem;color:var(--color-text-muted);margin-bottom:0.5rem;">Bearer token for external API access</div>
        <div style="display:flex;gap:0.4rem;">
          <input type="text" id="api-token-display" class="form-input font-mono" style="font-size:0.72rem;" readonly value="${localStorage.getItem('mc_api_token') || 'Not set'}">
          <button class="btn btn-sm btn-ghost" data-action="copy-token"><i class="fa fa-copy"></i></button>
        </div>
      </div>
      <!-- Gateway -->
      <div class="card">
        <div class="card-title" style="margin-bottom:0.75rem;"><i class="fa fa-network-wired"></i> Gateway Config</div>
        <div id="gateway-settings-status" style="font-size:0.8rem;color:var(--color-text-muted);margin-bottom:0.5rem;">Checking…</div>
        <div class="form-group"><label class="form-label">Client Override URL (localStorage)</label>
          <input type="text" class="form-input font-mono" id="gw-override-url" value="${localStorage.getItem('mc_gateway_override') || ''}" placeholder="ws://localhost:8080"></div>
        <div style="display:flex;gap:0.5rem;">
          <button class="btn btn-secondary btn-sm flex-1" data-action="save-gw-override">Save Override</button>
          <button class="btn btn-secondary btn-sm flex-1" data-action="restart-gateway"><i class="fa fa-rotate"></i> Restart</button>
        </div>
      </div>
      <!-- Danger zone -->
      <div class="card" style="border-color:var(--color-danger)20;">
        <div class="card-title" style="margin-bottom:0.75rem;color:var(--color-danger);"><i class="fa fa-triangle-exclamation"></i> Danger Zone</div>
        <button class="btn btn-danger w-full" data-action="nuke-data"><i class="fa fa-trash"></i> Clear All Data</button>
      </div>
    </div>
  </div>`;
}

function renderTabs() {
  const isRaw = currentTab === 'raw';
  document.getElementById('config-editor').style.display = isRaw ? 'block' : 'none';
  const vis = document.getElementById('visual-editor');
  vis.style.display = isRaw ? 'none' : 'block';

  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tab === currentTab);
  });

  if (!isRaw) {
    try {
      configObj = JSON.parse(document.getElementById('config-editor').value || '{}');
      document.getElementById('json-error-badge').classList.add('hidden');
    } catch (e) {
      vis.innerHTML = `<div style="color:var(--color-danger);"><i class="fa fa-triangle-exclamation"></i> Fix JSON errors in Raw tab first.</div>`;
      return;
    }

    if (currentTab === 'models') vis.innerHTML = renderArrayVisualizer(configObj.models || [], 'models');
    if (currentTab === 'agents') vis.innerHTML = renderArrayVisualizer(configObj.agents || [], 'agents');
    if (currentTab === 'channels') vis.innerHTML = renderArrayVisualizer(configObj.channels || [], 'channels');
    if (currentTab === 'env') vis.innerHTML = renderObjectVisualizer(configObj.env || {}, 'env');
  }
}

function renderArrayVisualizer(arr, key) {
  if (!Array.isArray(arr) || !arr.length) return `<div class="text-muted" style="font-size:0.8rem;">No ${key} found. Edit in raw JSON to add arrays.</div>`;
  return arr.map((item, i) => `
    <div style="background:var(--color-card);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:0.75rem;margin-bottom:0.75rem;">
      <div style="font-weight:600;margin-bottom:0.5rem;font-size:0.85rem;color:var(--color-accent);">${item.id || item.name || `Item ${i}`}</div>
      <div style="display:grid;grid-template-columns:100px 1fr;gap:0.4rem;font-size:0.78rem;">
        ${Object.entries(item).map(([k, v]) => `
          <div style="color:var(--color-text-muted);">${escHtml(k)}</div>
          <div class="truncate font-mono">${escHtml(typeof v === 'object' ? JSON.stringify(v) : v)}</div>
        `).join('')}
      </div>
    </div>`).join('');
}

function renderObjectVisualizer(obj, key) {
  if (typeof obj !== 'object' || !Object.keys(obj).length) return `<div class="text-muted" style="font-size:0.8rem;">No ${key} keys found. Edit in raw JSON.</div>`;
  return `
    <div style="background:var(--color-card);border:1px solid var(--color-border);border-radius:var(--radius-sm);padding:0.75rem;">
      <div style="display:grid;grid-template-columns:minmax(120px,auto) 1fr;gap:0.5rem;font-size:0.8rem;">
        ${Object.entries(obj).map(([k, v]) => `
          <div style="color:var(--color-accent);font-weight:500;">${escHtml(k)}</div>
          <div class="font-mono" style="word-break:break-all;">${escHtml(v)}</div>
        `).join('')}
      </div>
    </div>`;
}

async function loadConfig() {
  try {
    const data = await window.apiFetch('/config');
    const editor = document.getElementById('config-editor');
    if (editor) { configText = JSON.stringify(JSON.parse(data?.content || '{}'), null, 2); editor.value = configText; }
  } catch (e) { const ed = document.getElementById('config-editor'); if (ed) ed.value = '{\n  "error": "' + e.message + '"\n}'; }
}

async function loadAuthSettings() {
  const mfaArea = document.getElementById('mfa-status-area');
  const gw = document.getElementById('gateway-settings-status');
  const st = await window.apiFetch('/auth/status').catch(() => null);
  if (mfaArea) {
    if (st?.mfaEnabled) {
      mfaArea.innerHTML = `<div style="display:flex;align-items:center;gap:0.5rem;font-size:0.8rem;margin-bottom:0.5rem;"><span class="badge badge-active">✅ Enabled</span></div>
        <button class="btn btn-danger btn-sm w-full" data-action="disable-mfa"><i class="fa fa-shield-xmark"></i> Disable TOTP</button>`;
    } else {
      mfaArea.innerHTML = `<div style="font-size:0.8rem;color:var(--color-text-muted);margin-bottom:0.5rem;">TOTP not enabled. Use an authenticator app.</div>
        <button class="btn btn-secondary btn-sm w-full" data-action="setup-mfa"><i class="fa fa-plus"></i> Setup TOTP</button>`;
    }
  }
  const gwData = await window.apiFetch('/gateway/status').catch(() => null);
  if (gw) gw.innerHTML = gwData ? `<span class="badge badge-${gwData.connected ? 'active' : 'standby'}">${gwData.connected ? 'Connected' : 'Disconnected'}</span> <span class="text-muted">${escHtml(gwData.url)}</span>` : 'Unknown';
}

function bindEvents(el) {
  const editor = document.getElementById('config-editor');
  const uploader = document.getElementById('cfg-upload');

  editor?.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveConfig(); }
    if (e.key === 'Tab') { e.preventDefault(); const s = editor.selectionStart; editor.value = editor.value.slice(0, s) + '  ' + editor.value.slice(editor.selectionEnd); editor.selectionStart = editor.selectionEnd = s + 2; }
  });

  editor?.addEventListener('input', () => {
    try { JSON.parse(editor.value); document.getElementById('json-error-badge')?.classList.add('hidden'); }
    catch { document.getElementById('json-error-badge')?.classList.remove('hidden'); }
  });

  uploader?.addEventListener('change', (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = (ev) => {
      try {
        JSON.parse(ev.target.result);
        editor.value = ev.target.result;
        document.getElementById('json-error-badge')?.classList.add('hidden');
        window.showToast('File loaded - press Save to apply', 'info');
      } catch (err) { window.showToast('Invalid JSON file', 'error'); }
    };
    r.readAsText(f); e.target.value = '';
  });

  el.addEventListener('click', (e) => {
    const tb = e.target.closest('.tab-btn');
    if (tb) { currentTab = tb.dataset.tab; renderTabs(); return; }

    const actionBtn = e.target.closest('[data-action]');
    if (!actionBtn) return;
    const action = actionBtn.dataset.action;

    if (action === 'save-config') saveConfig();
    if (action === 'format-json') formatJson();
    if (action === 'copy-json') navigator.clipboard.writeText(editor.value).then(() => window.showToast('Copied!', 'success'));
    if (action === 'download-json') {
      const b = new Blob([editor.value], { type: 'application/json' });
      const u = URL.createObjectURL(b); const a = document.createElement('a'); a.href = u; a.download = 'openclaw.json'; a.click(); URL.revokeObjectURL(u);
    }
    if (action === 'upload-json') uploader.click();

    if (action === 'change-password') changePassword();
    if (action === 'copy-token') navigator.clipboard.writeText(document.getElementById('api-token-display').value).then(() => window.showToast('Copied!', 'success'));
    if (action === 'nuke-data') nukeData();
    if (action === 'restart-gateway') window.apiFetch('/action/restart-gateway', { method: 'POST' }).then(() => window.showToast('Gateway restarted', 'info'));
    if (action === 'setup-mfa') setupMfa();
    if (action === 'disable-mfa') disableMfa();
    if (action === 'save-gw-override') {
      const url = document.getElementById('gw-override-url').value.trim();
      if (url) localStorage.setItem('mc_gateway_override', url);
      else localStorage.removeItem('mc_gateway_override');
      window.showToast('Gateway override saved locally', 'success');
    }
  });
}

async function saveConfig() {
  const editor = document.getElementById('config-editor');
  try {
    const parsed = JSON.parse(editor.value);
    document.getElementById('json-error-badge')?.classList.add('hidden');
    await window.apiFetch('/config', { method: 'POST', body: { content: JSON.stringify(parsed, null, 2) } });
    window.showToast('Config saved!', 'success');
  } catch (e) {
    if (e instanceof SyntaxError) {
      document.getElementById('json-error-badge')?.classList.remove('hidden');
      window.showToast('Invalid JSON — fix errors first', 'error');
    } else window.showToast(e.message, 'error');
  }
}

function formatJson() {
  const editor = document.getElementById('config-editor');
  try { editor.value = JSON.stringify(JSON.parse(editor.value), null, 2); document.getElementById('json-error-badge')?.classList.add('hidden'); } catch { }
}

async function changePassword() {
  const oldPw = document.getElementById('cpw-old').value;
  const newPw = document.getElementById('cpw-new').value;
  const newPw2 = document.getElementById('cpw-new2').value;
  if (!newPw || newPw !== newPw2) { window.showToast('Passwords must match', 'warning'); return; }
  try {
    await window.apiFetch('/auth/change-password', { method: 'POST', body: { currentPassword: oldPw, newPassword: newPw } });
    window.showToast('Password changed!', 'success');
    document.getElementById('cpw-old').value = ''; document.getElementById('cpw-new').value = ''; document.getElementById('cpw-new2').value = '';
  } catch (e) { window.showToast(e.message, 'error'); }
}

async function nukeData() {
  if (!confirm('ℹ️ Are you sure? This will clear ALL tasks, agents, sessions, and events.')) return;
  if (!confirm('⚠️ This is irreversible. Confirm again to proceed.')) return;
  try {
    await window.apiFetch('/action/nuke-data', { method: 'POST' });
    window.showToast('All data cleared', 'info');
  } catch (e) { window.showToast(e.message, 'error'); }
}

async function setupMfa() {
  const data = await window.apiFetch('/auth/mfa/setup', { method: 'POST' }).catch(e => { window.showToast(e.message, 'error'); return null; });
  if (!data) return;
  window.openModal(`
  <div class="modal-header"><span class="modal-title"><i class="fa fa-shield-halved"></i> Setup TOTP</span>
    <button class="icon-btn" onclick="closeModal()"><i class="fa fa-xmark"></i></button></div>
  <div style="text-align:center;margin-bottom:1rem;">
    <img src="${data.qrCode}" style="width:200px;height:200px;border-radius:var(--radius);border:4px solid #fff;">
    <p style="font-size:0.75rem;color:var(--color-text-muted);margin-top:0.5rem;">Scan with Authenticator App</p>
  </div>
  <div style="font-size:0.72rem;font-family:var(--font-mono);word-break:break-all;background:var(--color-surface);padding:0.5rem;border-radius:var(--radius-sm);margin-bottom:0.75rem;">${data.secret}</div>
  <div class="form-group"><label class="form-label">Enter 6-digit code to confirm</label>
    <input class="form-input" type="text" id="totp-confirm" maxlength="6" placeholder="123456"></div>
  <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="btn-confirm-mfa"><i class="fa fa-check"></i> Verify & Enable</button></div>`);
  document.getElementById('btn-confirm-mfa').onclick = async () => {
    const code = document.getElementById('totp-confirm').value;
    try {
      await window.apiFetch('/auth/mfa/enable', { method: 'POST', body: { token: code } });
      window.closeModal(); window.showToast('TOTP enabled!', 'success'); loadAuthSettings();
    } catch (e) { window.showToast(e.message, 'error'); }
  }
}

async function disableMfa() {
  const code = prompt('Enter current TOTP code to disable:');
  if (!code) return;
  try {
    await window.apiFetch('/auth/mfa/disable', { method: 'POST', body: { token: code } });
    window.showToast('TOTP disabled', 'info'); loadAuthSettings();
  } catch (e) { window.showToast(e.message, 'error'); }
}

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
