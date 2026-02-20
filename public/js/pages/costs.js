// Costs Page
export async function init(el) {
    el.innerHTML = buildLayout();
    const data = await window.apiFetch('/costs').catch(() => ({ totalCost: 0, totalTokens: 0, byModel: {}, sessions: [] }));
    renderStats(data);
    drawChart(data);
    renderBreakdown(data);
}
export async function refresh(el) { init(el); }

function buildLayout() {
    return `
  <div class="stat-grid" id="cost-stats"></div>
  <div style="display:grid;grid-template-columns:1fr 320px;gap:1rem;margin-bottom:1rem;">
    <div class="card">
      <div class="card-header"><span class="card-title"><i class="fa fa-chart-line"></i> Daily Spend Trend (last 14 days)</span></div>
      <canvas id="cost-chart" style="width:100%;height:220px;"></canvas>
    </div>
    <div class="card">
      <div class="card-header"><span class="card-title"><i class="fa fa-chart-pie"></i> By Model</span></div>
      <canvas id="model-pie" style="width:100%;height:220px;"></canvas>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
    <div class="card">
      <div class="card-title" style="margin-bottom:0.75rem;"><i class="fa fa-tag"></i> Cost by Model</div>
      <div id="model-table"></div>
    </div>
    <div class="card">
      <div class="card-title" style="margin-bottom:0.75rem;"><i class="fa fa-star"></i> Top Sessions</div>
      <div id="session-table"></div>
    </div>
  </div>`;
}

function renderStats(data) {
    const self = data.sessions || [];
    const today = Math.floor(Date.now() / 1000) - 86400;
    const todayCost = self.filter(s => s.updated_at > today).reduce((s, x) => s + (x.cost || 0), 0);
    document.getElementById('cost-stats').innerHTML = `
    <div class="stat-card"><div class="stat-label">Today</div><div class="stat-value text-accent">$${todayCost.toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-label">All Time</div><div class="stat-value">$${(data.totalCost || 0).toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-label">Total Tokens</div><div class="stat-value">${fmtNum(data.totalTokens || 0)}</div></div>
    <div class="stat-card"><div class="stat-label">Sessions</div><div class="stat-value">${(data.sessions || []).length}</div></div>`;
}

function drawChart(data) {
    const canvas = document.getElementById('cost-chart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = canvas.parentElement.offsetWidth - 40;
    canvas.height = 220;
    // Build daily buckets from sessions
    const days = 14;
    const now = Math.floor(Date.now() / 1000);
    const buckets = Array.from({ length: days }, (_, i) => ({ label: fmtDate(now - (days - 1 - i) * 86400), cost: 0 }));
    (data.sessions || []).forEach(s => {
        const dayIdx = days - 1 - Math.floor((now - (s.updated_at || now)) / 86400);
        if (dayIdx >= 0 && dayIdx < days) buckets[dayIdx].cost += s.cost || 0;
    });
    const maxCost = Math.max(...buckets.map(b => b.cost), 0.01);
    const pad = { l: 40, r: 10, t: 10, b: 30 };
    const w = canvas.width - pad.l - pad.r;
    const h = canvas.height - pad.t - pad.b;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    // Grid
    ctx.strokeStyle = '#2a2a3a'; ctx.lineWidth = 1;
    [0, 0.25, 0.5, 0.75, 1].forEach(f => {
        const y = pad.t + h * (1 - f);
        ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(pad.l + w, y); ctx.stroke();
        ctx.fillStyle = '#6b7280'; ctx.font = '9px Inter,sans-serif'; ctx.textAlign = 'right';
        ctx.fillText('$' + (maxCost * f).toFixed(2), pad.l - 4, y + 3);
    });
    // Line
    const pts = buckets.map((b, i) => [pad.l + (i / (days - 1)) * w, pad.t + h * (1 - (b.cost / maxCost))]);
    // Fill
    const grad = ctx.createLinearGradient(0, pad.t, 0, pad.t + h);
    grad.addColorStop(0, 'rgba(99,102,241,0.35)'); grad.addColorStop(1, 'rgba(99,102,241,0)');
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pad.t + h);
    pts.forEach(([x, y]) => ctx.lineTo(x, y));
    ctx.lineTo(pts[pts.length - 1][0], pad.t + h);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();
    // Line stroke
    ctx.beginPath(); ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 2;
    pts.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.stroke();
    // Dots
    pts.forEach(([x, y], i) => {
        ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#6366f1'; ctx.fill();
        if (!(i % 3)) { ctx.fillStyle = '#6b7280'; ctx.font = '8px Inter'; ctx.textAlign = 'center'; ctx.fillText(buckets[i].label, x, canvas.height - 6); }
    });
    // Model pie
    renderPie(data.byModel || {});
}

function renderPie(byModel) {
    const canvas = document.getElementById('model-pie');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = 260; canvas.height = 220;
    const entries = Object.entries(byModel).filter(([, v]) => v.cost > 0);
    if (!entries.length) { ctx.fillStyle = '#6b7280'; ctx.fillText('No data', 100, 110); return; }
    const total = entries.reduce((s, [, v]) => s + v.cost, 0);
    const colors = ['#6366f1', '#8b5cf6', '#10b981', '#f59e0b', '#3b82f6', '#ef4444', '#06b6d4'];
    let angle = -Math.PI / 2;
    const cx = 110, cy = 110, r = 80;
    entries.forEach(([model, { cost }], i) => {
        const slice = (cost / total) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, r, angle, angle + slice); ctx.closePath();
        ctx.fillStyle = colors[i % colors.length]; ctx.fill();
        ctx.strokeStyle = '#0a0a0f'; ctx.lineWidth = 2; ctx.stroke();
        angle += slice;
    });
    // Legend
    entries.forEach(([model, { cost }], i) => {
        const y = 16 + i * 22;
        ctx.fillStyle = colors[i % colors.length]; ctx.fillRect(220, y - 8, 12, 12);
        ctx.fillStyle = '#94a3b8'; ctx.font = '9px Inter'; ctx.textAlign = 'left';
        ctx.fillText(model.slice(-12), 236, y + 1);
        ctx.fillText('$' + cost.toFixed(2), 236, y + 10);
    });
}

function renderBreakdown(data) {
    const mt = document.getElementById('model-table');
    if (mt) mt.innerHTML = Object.entries(data.byModel || {}).map(([m, v]) => `
    <div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--color-border);font-size:0.82rem;">
      <span>${m}</span><span style="font-weight:600;">$${(v.cost || 0).toFixed(4)} <span style="font-weight:400;color:var(--color-text-muted);">(${fmtNum(v.tokens || 0)})</span></span>
    </div>`).join('') || '<div class="text-muted" style="font-size:0.8rem;">No data</div>';
    const st = document.getElementById('session-table');
    if (st) st.innerHTML = (data.sessions || []).sort((a, b) => (b.cost || 0) - (a.cost || 0)).slice(0, 8).map(s => `
    <div style="display:flex;justify-content:space-between;padding:0.4rem 0;border-bottom:1px solid var(--color-border);font-size:0.82rem;">
      <span class="truncate" style="max-width:160px;">${s.agent_name || s.agent_id?.slice(0, 12) || '—'}</span>
      <span style="font-weight:600;color:var(--color-warning);">$${(s.cost || 0).toFixed(4)}</span>
    </div>`).join('') || '<div class="text-muted" style="font-size:0.8rem;">No data</div>';
}

function fmtNum(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n); }
function fmtDate(ts) { const d = new Date(ts * 1000); return `${d.getMonth() + 1}/${d.getDate()}`; }
