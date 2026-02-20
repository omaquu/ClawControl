// Logs Page
let autoRefresh = null;

export async function init(el) {
  el.innerHTML = buildLayout();
  await loadLogs();
  bindEvents(el);
}
export function refresh(el) { loadLogs(); }

function buildLayout() {
  return `
  <div style="display:flex;gap:0.75rem;align-items:center;margin-bottom:1rem;flex-wrap:wrap;">
    <select id="log-service" style="width:160px;">
      <option value="audit">Audit Log</option>
      <option value="system">System</option>
      <option value="openclaw">OpenClaw</option>
      <option value="clawcontrol">ClawControl</option>
    </select>
    <select id="log-lines" style="width:100px;">
      <option value="50">50 lines</option><option value="100" selected>100 lines</option>
      <option value="200">200 lines</option><option value="500">500 lines</option>
    </select>
    <button class="btn btn-primary btn-sm" id="log-refresh-btn"><i class="fa fa-rotate"></i> Refresh</button>
    <label style="display:flex;align-items:center;gap:0.4rem;font-size:0.8rem;margin-left:auto;">
      <input type="checkbox" id="log-auto-refresh" style="width:auto;"> Auto-refresh (5s)
    </label>
  </div>
  <div class="card" style="padding:0;overflow:hidden;">
    <div style="padding:0.65rem 1rem;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between;">
      <span style="font-size:0.78rem;font-family:var(--font-mono);color:var(--color-text-muted);" id="log-title">audit.log</span>
      <button class="btn btn-sm btn-ghost" onclick="window.copyLogs()"><i class="fa fa-copy"></i> Copy</button>
    </div>
    <div id="log-output" style="background:#05050d;font-family:var(--font-mono);font-size:0.77rem;padding:1rem;overflow-y:auto;max-height:calc(100vh - var(--topbar-height) - 12rem);white-space:pre-wrap;word-break:break-all;color:#94a3b8;line-height:1.6;">
      Loading…
    </div>
  </div>`;
}

async function loadLogs() {
  const service = document.getElementById('log-service')?.value || 'audit';
  const lines = document.getElementById('log-lines')?.value || '100';
  const title = document.getElementById('log-title');
  if (title) title.textContent = service + '.log';
  const out = document.getElementById('log-output');
  try {
    const data = await window.apiFetch(`/logs?service=${service}&lines=${lines}`);
    if (!data || !out) return;
    // Colorize log lines
    out.innerHTML = colorizeLog(data.lines || 'No logs');
    out.scrollTop = out.scrollHeight;
  } catch (e) { if (out) out.textContent = 'Error: ' + e.message; }
}

function colorizeLog(text) {
  return text.split('\n').map(line => {
    const esc = line.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    if (/error|ERR|FATAL|failed|exception/i.test(line)) return `<span style="color:#ef4444;">${esc}</span>`;
    if (/warn|WARNING/i.test(line)) return `<span style="color:#f59e0b;">${esc}</span>`;
    if (/success|OK|connected|started|listening/i.test(line)) return `<span style="color:#10b981;">${esc}</span>`;
    if (/\d{4}-\d{2}-\d{2}/.test(line)) return `<span style="color:#6366f1;">${esc}</span>`;
    return esc;
  }).join('\n');
}

window.copyLogs = function () {
  const out = document.getElementById('log-output');
  navigator.clipboard.writeText(out.textContent).then(() => window.showToast('Copied!', 'success'));
};

function bindEvents(el) {
  document.getElementById('log-refresh-btn')?.addEventListener('click', loadLogs);
  document.getElementById('log-service')?.addEventListener('change', loadLogs);
  document.getElementById('log-lines')?.addEventListener('change', loadLogs);
  document.getElementById('log-auto-refresh')?.addEventListener('change', (e) => {
    if (autoRefresh) { clearInterval(autoRefresh); autoRefresh = null; }
    if (e.target.checked) autoRefresh = setInterval(loadLogs, 5000);
  });
}
