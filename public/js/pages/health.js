// Health Page — System Monitoring + OpenClaw Gateway Healthcheck
let healthTimer = null;
const cpuHistory = new Array(24).fill(0);
const ramHistory = new Array(24).fill(0);

export async function init(el) {
  el.innerHTML = buildLayout();
  await load(el);
  healthTimer = setInterval(() => load(el), 5000);
  el.addEventListener('click', handleClick);
}
export function refresh(el) { load(el); }

function handleClick(e) {
  const action = e.target.closest('[data-action]')?.dataset.action;
  if (action) doAction(action);
}

async function load(el) {
  const [data, gwData] = await Promise.all([
    window.apiFetch('/system').catch(() => null),
    window.apiFetch('/gateway/status').catch(() => null)
  ]);
  if (data) {
    cpuHistory.push(data.cpu || 0); cpuHistory.shift();
    ramHistory.push(data.ram?.percent || 0); ramHistory.shift();
    renderHealth(data, gwData);
  }
}

function buildLayout() {
  return `
  <div class="health-grid" id="health-cards"></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-bottom:1rem;">
    <div class="card"><div class="card-title" style="margin-bottom:0.5rem;"><i class="fa fa-microchip"></i> CPU (24 snapshots)</div>
      <canvas class="sparkline-canvas" id="cpu-spark"></canvas></div>
    <div class="card"><div class="card-title" style="margin-bottom:0.5rem;"><i class="fa fa-memory"></i> RAM (24 snapshots)</div>
      <canvas class="sparkline-canvas" id="ram-spark"></canvas></div>
  </div>
  <div class="card" style="margin-bottom:1rem;">
    <div class="card-title" style="margin-bottom:0.75rem;"><i class="fa fa-hard-drive"></i> Disk Usage (All Drives)</div>
    <div id="disk-bars"><div class="text-muted" style="font-size:0.8rem;">Loading...</div></div>
  </div>
  <div class="card" style="margin-bottom:1rem;" id="gw-card">
    <div class="card-title" style="margin-bottom:0.75rem;"><i class="fa fa-satellite-dish"></i> OpenClaw Gateway</div>
    <div id="gw-info"><div class="text-muted" style="font-size:0.8rem;">Checking...</div></div>
  </div>
  <div class="card">
    <div class="card-title" style="margin-bottom:0.75rem;"><i class="fa fa-bolt"></i> Quick Actions</div>
    <div style="display:flex;gap:0.75rem;flex-wrap:wrap;">
      <button class="btn btn-secondary" data-action="restart-clawcontrol"><i class="fa fa-rotate"></i> Restart Server</button>
      <button class="btn btn-secondary" data-action="clear-events"><i class="fa fa-broom"></i> Clear Events</button>
      <button class="btn btn-secondary" data-action="nuke-data" style="color:var(--color-danger);border-color:var(--color-danger);"><i class="fa fa-skull"></i> Wipe All Data</button>
    </div>
  </div>`;
}

function renderHealth(data, gwData) {
  // Stat cards
  const cards = document.getElementById('health-cards');
  if (cards) cards.innerHTML = `
    <div class="health-card"><div class="health-card-label">CPU Usage</div>
      <div class="health-card-value ${data.cpu > 80 ? 'text-danger' : data.cpu > 60 ? 'text-warning' : 'text-success'}">${data.cpu || 0}%</div></div>
    <div class="health-card"><div class="health-card-label">RAM Used</div>
      <div class="health-card-value">${data.ram?.percent || 0}%</div>
      <div style="font-size:0.72rem;color:var(--color-text-muted);">${fmtBytes(data.ram?.used || 0)} / ${fmtBytes(data.ram?.total || 0)}</div></div>
    <div class="health-card"><div class="health-card-label">Temperature</div>
      <div class="health-card-value ${(data.temp || 0) > 80 ? 'text-danger' : (data.temp || 0) > 60 ? 'text-warning' : 'text-success'}">${data.temp ? data.temp + '°C' : 'N/A'}</div></div>
    <div class="health-card"><div class="health-card-label">Uptime</div>
      <div class="health-card-value">${fmtUptime(data.uptime || 0)}</div></div>`;

  drawSparkline('cpu-spark', cpuHistory, '#6366f1');
  drawSparkline('ram-spark', ramHistory, '#10b981');

  // All disks
  const diskBars = document.getElementById('disk-bars');
  if (diskBars) {
    const disks = data.disk || [];
    if (!disks.length) {
      diskBars.innerHTML = '<div class="text-muted" style="font-size:0.8rem;">No disk data available</div>';
    } else {
      diskBars.innerHTML = disks.map(d => {
        const pct = Math.round(d.use || d.percent || 0);
        const sizeStr = d.size ? fmtBytes(d.size) : (d.blocks ? fmtBytes(d.blocks * 512) : '?');
        const usedStr = d.used ? fmtBytes(d.used) : '?';
        const mount = d.mount || d.fs || d.drive || 'Drive';
        return `<div class="progress-bar-wrap">
          <div class="progress-label">
            <span><strong>${escHtml(mount)}</strong> <span style="font-size:0.7rem;color:var(--color-text-muted);">${escHtml(d.type || d.fstype || '')}</span></span>
            <span>${usedStr} / ${sizeStr} (${pct}%)</span>
          </div>
          <div class="progress-track"><div class="progress-fill ${pct > 85 ? 'red' : pct > 60 ? 'yellow' : 'green'}" style="width:${pct}%;"></div></div>
        </div>`;
      }).join('');
    }
  }

  // Gateway
  const gwInfo = document.getElementById('gw-info');
  if (gwInfo) {
    if (gwData && gwData.connected) {
      gwInfo.innerHTML = `
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;font-size:0.82rem;">
          <div><span class="text-muted">Status:</span> <span style="color:var(--color-success);font-weight:600;"><i class="fa fa-circle-check"></i> Online</span></div>
          <div><span class="text-muted">URL:</span> ${escHtml(gwData.url || '—')}</div>
          ${gwData.version ? `<div><span class="text-muted">Version:</span> ${escHtml(gwData.version)}</div>` : ''}
          ${gwData.model ? `<div><span class="text-muted">Model:</span> <span style="color:var(--color-accent);">${escHtml(gwData.model)}</span></div>` : ''}
          ${gwData.tokensIn !== undefined ? `<div><span class="text-muted">Tokens In:</span> ${gwData.tokensIn?.toLocaleString() || 0}</div>` : ''}
          ${gwData.tokensOut !== undefined ? `<div><span class="text-muted">Tokens Out:</span> ${gwData.tokensOut?.toLocaleString() || 0}</div>` : ''}
        </div>`;
    } else {
      gwInfo.innerHTML = `<div style="color:var(--color-danger);font-size:0.85rem;"><i class="fa fa-circle-xmark"></i> Gateway Offline / Not Configured
        <div style="font-size:0.75rem;color:var(--color-text-muted);margin-top:0.4rem;">Set OPENCLAW_GATEWAY_URL in Settings or .env to connect</div></div>`;
    }
  }
}

function drawSparkline(id, data, color) {
  const canvas = document.getElementById(id);
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  canvas.width = canvas.parentElement.offsetWidth - 40;
  canvas.height = 60;
  const w = canvas.width, h = canvas.height;
  const max = Math.max(...data, 1);
  ctx.clearRect(0, 0, w, h);
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, color + '55'); grad.addColorStop(1, color + '00');
  ctx.beginPath(); ctx.moveTo(0, h);
  data.forEach((v, i) => { ctx.lineTo((i / (data.length - 1)) * w, h - (v / max) * h); });
  ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
  ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 2;
  data.forEach((v, i) => { const x = (i / (data.length - 1)) * w, y = h - (v / max) * h; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
  ctx.stroke();
}

async function doAction(action) {
  if (action === 'nuke-data' && !confirm('⚠️ This will delete ALL tasks, agents, sessions and chat data. Are you sure?')) return;
  try {
    const res = await window.apiFetch(`/action/${action}`, { method: 'POST' });
    window.showToast(res?.message || 'Done', 'success');
  } catch (e) { window.showToast(e.message, 'error'); }
}

window.doAction = doAction;

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtBytes(b) { if (!b) return '0 B'; const k = 1024; const s = ['B', 'KB', 'MB', 'GB', 'TB']; const i = Math.min(Math.floor(Math.log(b) / Math.log(k)), s.length - 1); return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i]; }
function fmtUptime(s) { const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60); return h > 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : h > 0 ? `${h}h ${m}m` : `${m}m`; }
