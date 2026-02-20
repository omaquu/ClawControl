// Crons Page — Visual Schedule Builder
let crons = [];

export async function init(el) {
  el.innerHTML = buildLayout();
  await load();
  el.addEventListener('click', handleClick);
}
export async function refresh() { await load(); }

async function load() {
  crons = (await window.apiFetch('/crons').catch(() => [])) || [];
  renderCrons();
}

function handleClick(e) {
  if (e.target.closest('#new-cron-btn')) openCronModal();
  else if (e.target.closest('[data-trigger]')) triggerCron(e.target.closest('[data-trigger]').dataset.trigger);
  else if (e.target.closest('[data-edit]')) openCronModal(e.target.closest('[data-edit]').dataset.edit);
  else if (e.target.closest('[data-delete]')) deleteCron(e.target.closest('[data-delete]').dataset.delete);
}

function buildLayout() {
  return `
  <div class="section-header">
    <div>
      <h2 class="section-title"><i class="fa fa-clock"></i> Cron Jobs</h2>
      <div style="font-size:0.8rem;color:var(--color-text-muted);">Scheduled tasks and periodic jobs</div>
    </div>
    <button class="btn btn-primary" id="new-cron-btn"><i class="fa fa-plus"></i> New Cron</button>
  </div>
  <div class="table-wrap">
    <table>
      <thead><tr><th>Name</th><th>Schedule</th><th>Description</th><th>Command</th><th>Last Run</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody id="crons-tbody"></tbody>
    </table>
  </div>`;
}

function renderCrons() {
  const tbody = document.getElementById('crons-tbody');
  if (!tbody) return;
  tbody.innerHTML = crons.map(c => `
    <tr>
      <td><strong>${escHtml(c.name)}</strong></td>
      <td><code style="font-size:0.78rem;background:var(--color-surface);padding:0.1rem 0.4rem;border-radius:4px;">${c.schedule}</code></td>
      <td style="font-size:0.78rem;color:var(--color-accent);">${cronDesc(c.schedule)}</td>
      <td class="truncate" style="max-width:160px;font-size:0.78rem;color:var(--color-text-muted);" title="${escHtml(c.command)}">${escHtml(c.command)}</td>
      <td style="font-size:0.78rem;">${c.last_run ? timeAgo(c.last_run) : 'Never'}</td>
      <td><label class="switch"><input type="checkbox" ${c.enabled ? 'checked' : ''} onchange="window.toggleCron('${c.id}',this.checked)"><span class="switch-track"></span></label></td>
      <td style="display:flex;gap:0.3rem;">
        <button class="btn btn-sm btn-secondary" data-trigger="${c.id}" title="Run now"><i class="fa fa-play"></i></button>
        <button class="btn btn-sm btn-ghost" data-edit="${c.id}"><i class="fa fa-edit"></i></button>
        <button class="btn btn-sm btn-danger" data-delete="${c.id}"><i class="fa fa-trash"></i></button>
      </td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:2rem;color:var(--color-text-muted);">No cron jobs yet</td></tr>';
}

// ─── Cron Expression Helpers ──────────────────────────────────────────────────
function cronDesc(expr) {
  if (!expr) return '';
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return expr;
  const [min, hour, dom, month, dow] = parts;
  if (min.startsWith('*/') && hour === '*' && dom === '*' && month === '*' && dow === '*') return `Every ${min.slice(2)} minutes`;
  if (min === '0' && hour.startsWith('*/') && dom === '*' && month === '*' && dow === '*') return `Every ${hour.slice(2)} hours`;
  if (min !== '*' && hour !== '*' && dom === '*' && month === '*' && dow === '*') return `Daily at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  if (min !== '*' && hour !== '*' && dom === '*' && month === '*' && dow !== '*') {
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    return `Weekly on ${days[int(dow)] || dow} at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  }
  if (min !== '*' && hour !== '*' && dom !== '*' && month === '*' && dow === '*') return `Monthly on day ${dom} at ${hour.padStart(2, '0')}:${min.padStart(2, '0')}`;
  return expr;
}
function int(v) { return parseInt(v) || 0; }

function buildScheduleFromUI() {
  const type = document.getElementById('cr-freq')?.value;
  const every = document.getElementById('cr-every')?.value || '30';
  const atH = document.getElementById('cr-hour')?.value || '0';
  const atM = document.getElementById('cr-minute')?.value || '0';
  const onDay = document.getElementById('cr-day')?.value || '1';
  const onDow = document.getElementById('cr-dow')?.value || '1';
  switch (type) {
    case 'minutes': return `*/${every} * * * *`;
    case 'hours': return `${atM} */${every} * * *`;
    case 'daily': return `${atM} ${atH} * * *`;
    case 'weekly': return `${atM} ${atH} * * ${onDow}`;
    case 'monthly': return `${atM} ${atH} ${onDay} * *`;
    case 'advanced': return document.getElementById('cr-advanced')?.value || '*/30 * * * *';
    default: return '*/30 * * * *';
  }
}

function updatePreview() {
  const el = document.getElementById('cr-preview');
  if (el) el.textContent = cronDesc(buildScheduleFromUI());
  const adv = document.getElementById('cr-advanced-wrap');
  if (adv) adv.style.display = document.getElementById('cr-freq')?.value === 'advanced' ? 'block' : 'none';
}

function openCronModal(id) {
  const c = id ? crons.find(x => x.id === id) : null;
  window.openModal(`
  <div class="modal-header">
    <span class="modal-title">${c ? 'Edit Cron' : 'New Cron Job'}</span>
    <button class="icon-btn" onclick="closeModal()"><i class="fa fa-xmark"></i></button>
  </div>
  <div class="form-group"><label class="form-label">Name *</label><input class="form-input" id="cr-name" value="${escHtml(c?.name || '')}"></div>
  
  <div class="form-group">
    <label class="form-label">Schedule</label>
    <select class="form-select" id="cr-freq" onchange="window._updateCronPreview()">
      <option value="minutes">Every N minutes</option>
      <option value="hours">Every N hours</option>
      <option value="daily">Daily at time</option>
      <option value="weekly">Weekly on day</option>
      <option value="monthly">Monthly on date</option>
      <option value="advanced">Advanced (raw cron)</option>
    </select>
  </div>
  <div id="cr-schedule-opts" style="display:grid;grid-template-columns:1fr 1fr;gap:0.5rem;margin-bottom:0.75rem;">
    <div class="form-group"><label class="form-label">Every (N)</label><input class="form-input" type="number" id="cr-every" value="30" min="1" onchange="window._updateCronPreview()"></div>
    <div class="form-group"><label class="form-label">At hour</label><input class="form-input" type="number" id="cr-hour" value="9" min="0" max="23" onchange="window._updateCronPreview()"></div>
    <div class="form-group"><label class="form-label">At minute</label><input class="form-input" type="number" id="cr-minute" value="0" min="0" max="59" onchange="window._updateCronPreview()"></div>
    <div class="form-group"><label class="form-label">Day of week</label>
      <select class="form-select" id="cr-dow" onchange="window._updateCronPreview()">
        ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => `<option value="${i}">${d}</option>`).join('')}
      </select></div>
    <div class="form-group"><label class="form-label">Day of month</label><input class="form-input" type="number" id="cr-day" value="1" min="1" max="31" onchange="window._updateCronPreview()"></div>
  </div>
  <div id="cr-advanced-wrap" style="display:none;" class="form-group">
    <label class="form-label">Cron expression</label>
    <input class="form-input font-mono" id="cr-advanced" value="${c?.schedule || '*/30 * * * *'}" placeholder="*/30 * * * *" onchange="window._updateCronPreview()">
  </div>
  <div style="padding:0.5rem 0.75rem;background:var(--color-surface);border-radius:var(--radius-sm);margin-bottom:1rem;font-size:0.8rem;color:var(--color-accent);">
    <i class="fa fa-eye"></i> <span id="cr-preview">Every 30 minutes</span>
  </div>
  <div class="form-group"><label class="form-label">Command / Script</label>
    <input class="form-input font-mono" id="cr-command" value="${escHtml(c?.command || '')}" placeholder="node /workspace/scripts/task.js"></div>
  <div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem;">
    <input type="checkbox" id="cr-enabled" ${c?.enabled !== false ? 'checked' : ''}>
    <label for="cr-enabled" style="font-size:0.8rem;">Enabled</label>
  </div>
  <div class="form-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="cr-save"><i class="fa fa-save"></i> ${c ? 'Update' : 'Create'}</button>
  </div>`);

  window._updateCronPreview = updatePreview;
  updatePreview();

  // If editing, try to pre-select the right freq type
  if (c?.schedule) {
    const adv = document.getElementById('cr-advanced');
    if (adv) adv.value = c.schedule;
    document.getElementById('cr-freq').value = 'advanced';
    updatePreview();
  }

  document.getElementById('cr-save').onclick = () => saveCron(id || '');
}

async function triggerCron(id) {
  try {
    const r = await window.apiFetch(`/crons/${id}/trigger`, { method: 'POST' });
    window.showToast(r?.message || 'Triggered!', 'success');
    setTimeout(load, 500);
  } catch (e) { window.showToast(e.message, 'error'); }
}

window.toggleCron = async function (id, enabled) {
  await window.apiFetch(`/crons/${id}`, { method: 'PUT', body: { enabled } });
  const c = crons.find(x => x.id === id); if (c) c.enabled = enabled;
  window.showToast(enabled ? 'Cron enabled' : 'Cron disabled', 'info');
};

async function deleteCron(id) {
  if (!confirm('Delete this cron job?')) return;
  await window.apiFetch(`/crons/${id}`, { method: 'DELETE' });
  crons = crons.filter(c => c.id !== id); renderCrons();
  window.showToast('Cron deleted', 'info');
}

async function saveCron(id) {
  const name = document.getElementById('cr-name').value.trim();
  if (!name) { window.showToast('Name required', 'warning'); return; }
  const schedule = buildScheduleFromUI();
  const body = { name, schedule, command: document.getElementById('cr-command').value, enabled: document.getElementById('cr-enabled').checked };
  try {
    if (id) await window.apiFetch(`/crons/${id}`, { method: 'PUT', body });
    else await window.apiFetch('/crons', { method: 'POST', body });
    closeModal(); window.showToast(id ? 'Cron updated!' : 'Cron created!', 'success'); load();
  } catch (e) { window.showToast(e.message, 'error'); }
}

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function timeAgo(ts) { if (!ts) return '—'; const d = Math.floor(Date.now() / 1000) - ts; return d < 0 ? 'upcoming' : d < 60 ? `${d}s ago` : d < 3600 ? `${Math.floor(d / 60)}m ago` : d < 86400 ? `${Math.floor(d / 3600)}h ago` : `${Math.floor(d / 86400)}d ago`; }
