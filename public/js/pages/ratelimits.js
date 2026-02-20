// Rate Limits Page
let refreshTimer = null;

export async function init(el) {
    el.innerHTML = buildLayout();
    await load(el);
    refreshTimer = setInterval(() => load(el), 10000);
}
export function refresh(el) { load(el); }

async function load(el) {
    const data = await window.apiFetch('/rate-limits').catch(() => null);
    if (!data) return;
    renderRateLimits(data);
}

function buildLayout() {
    return `
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;">
    <div>
      <div style="font-size:0.8rem;color:var(--color-text-muted);">Claude Max 5x — 5-hour rolling windows</div>
    </div>
    <button class="btn btn-sm btn-secondary" onclick="window.dispatchEvent(new CustomEvent('mc:refresh'))"><i class="fa fa-rotate"></i> Refresh</button>
  </div>
  <div class="card" style="margin-bottom:1rem;" id="claude-card">
    <div class="card-header"><span class="card-title"><i class="fa fa-c" style="color:#f59e0b;"></i> Claude Usage (Anthropic)</span>
      <span style="font-size:0.72rem;color:var(--color-text-muted);" id="claude-updated">—</span></div>
    <div id="claude-bars"></div>
  </div>
  <div class="card" style="margin-bottom:1rem;" id="gemini-card">
    <div class="card-header"><span class="card-title"><i class="fa fa-gem" style="color:#3b82f6;"></i> Gemini Usage (Google)</span></div>
    <div id="gemini-bars"></div>
  </div>
  <div class="stat-grid" id="rl-stats"></div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;margin-top:1rem;">
    <div class="card" id="model-breakdown">
      <div class="card-title" style="margin-bottom:0.75rem;"><i class="fa fa-chart-pie"></i> Model Usage Breakdown</div>
      <canvas id="model-donut" style="width:100%;height:160px;"></canvas>
    </div>
    <div class="card" id="window-breakdown">
      <div class="card-title" style="margin-bottom:0.75rem;"><i class="fa fa-receipt"></i> Window Cost Breakdown</div>
      <div id="window-cost-items"></div>
    </div>
  </div>`;
}

function renderRateLimits(data) {
    const claude = data.claude || {};
    const gemini = data.gemini || {};
    // Claude bars
    const claudeBars = document.getElementById('claude-bars');
    if (claudeBars) {
        const sessionPct = claude.windowLimit ? Math.round((claude.windowTokens / claude.windowLimit) * 100) : 0;
        const weekPct = claude.weeklyLimit ? Math.round((claude.weeklyTokens / claude.weeklyLimit) * 100) : 0;
        claudeBars.innerHTML = `
      ${progressBar('Session (5h window)', claude.windowTokens || 0, claude.windowLimit || 0, sessionPct)}
      ${progressBar('Weekly (All Models)', claude.weeklyTokens || 0, claude.weeklyLimit || 0, weekPct)}`;
    }
    // Gemini bars
    const geminiBars = document.getElementById('gemini-bars');
    if (geminiBars) {
        const gemPct = gemini.windowLimit ? Math.round((gemini.windowTokens / gemini.windowLimit) * 100) : 0;
        geminiBars.innerHTML = progressBar('Window Usage', gemini.windowTokens || 0, gemini.windowLimit || 0, gemPct);
    }
    // Stats
    const stats = document.getElementById('rl-stats');
    if (stats) stats.innerHTML = `
    <div class="stat-card"><div class="stat-label">Burn Rate (tok/min)</div><div class="stat-value">${claude.burnRate || 0}</div></div>
    <div class="stat-card"><div class="stat-label">Window Cost</div><div class="stat-value">$${(claude.windowCost || 0).toFixed(2)}</div></div>
    <div class="stat-card"><div class="stat-label">API Calls (5h)</div><div class="stat-value">${claude.apiCalls || 0}</div></div>
    <div class="stat-card"><div class="stat-label">Window Resets In</div><div class="stat-value">${claude.windowResets ? fmtTime(claude.windowResets) : '—'}</div></div>
    <div class="stat-card"><div class="stat-label">Est. Time to Limit</div><div class="stat-value ${claude.safeUntilLimit ? 'text-success' : 'text-warning'}">${claude.safeUntilLimit ? '✅ Safe' : '⚠️ Watch'}</div></div>
    <div class="stat-card"><div class="stat-label">Cost/min</div><div class="stat-value">$${(claude.costPerMin || 0).toFixed(4)}</div></div>`;
    // Updated
    const upd = document.getElementById('claude-updated');
    if (upd) upd.textContent = data.updated ? timeAgo(Math.floor(data.updated / 1000)) + ' ago' : '—';
    // Window cost items
    const wci = document.getElementById('window-cost-items');
    if (wci && claude.modelBreakdown) {
        wci.innerHTML = Object.entries(claude.modelBreakdown).map(([m, v]) => `
      <div style="display:flex;justify-content:space-between;padding:0.35rem 0;border-bottom:1px solid var(--color-border);font-size:0.8rem;">
        <span>${m}</span><span style="color:var(--color-warning);">$${(v.cost || 0).toFixed(6)}</span>
      </div>`).join('');
    }
}

function progressBar(label, used, limit, pct) {
    const colorClass = pct >= 85 ? 'red' : pct >= 60 ? 'yellow' : 'green';
    const limitStr = limit ? `${fmtNum(used)} / ${fmtNum(limit)}` : `${fmtNum(used)}`;
    return `<div class="progress-bar-wrap">
    <div class="progress-label"><span>${label}</span><span>${limitStr} (${pct}%)</span></div>
    <div class="progress-track"><div class="progress-fill ${colorClass}" style="width:${Math.min(pct, 100)}%;"></div></div>
  </div>`;
}

function fmtNum(n) { return n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n || 0); }
function fmtTime(s) { const m = Math.floor(s / 60); const h = Math.floor(m / 60); return h > 0 ? `${h}h ${m % 60}m` : `${m}m`; }
function timeAgo(ts) { if (!ts) return '—'; const d = Math.floor(Date.now() / 1000) - ts; return d < 60 ? `${d}s` : d < 3600 ? `${Math.floor(d / 60)}m` : `${Math.floor(d / 3600)}h`; }
