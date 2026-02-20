// Kanban Board — Mission Queue
const STATUSES = ['PLANNING', 'INBOX', 'ASSIGNED', 'IN_PROGRESS', 'TESTING', 'REVIEW', 'DONE', 'ARCHIVE'];
const STATUS_LABELS = { PLANNING: 'Planning', INBOX: 'Inbox', ASSIGNED: 'Assigned', IN_PROGRESS: 'In Progress', TESTING: 'Testing', REVIEW: 'Review', DONE: 'Done', ARCHIVE: 'Archive' };
const ACTIVE_STATUSES = ['PLANNING', 'INBOX', 'ASSIGNED', 'IN_PROGRESS', 'TESTING', 'REVIEW', 'DONE'];
let tasks = [], showArchive = false;
let colColors = JSON.parse(localStorage.getItem('mc_col_colors') || '{}');

const DEFAULT_COL_COLORS = {
  PLANNING: '#6366f1', INBOX: '#9ca3af', ASSIGNED: '#3b82f6',
  IN_PROGRESS: '#f59e0b', TESTING: '#c084fc', REVIEW: '#fb923c',
  DONE: '#10b981', ARCHIVE: '#4b5563'
};

function colColor(s) { return colColors[s] || DEFAULT_COL_COLORS[s] || '#6366f1'; }

export async function init(el) {
  el.innerHTML = buildBoard();
  await loadTasks(el);
  initDragDrop(el);
  bindEvents(el);
  window.addEventListener('mc:newTask', () => openNewTaskModal());
  window.addEventListener('mc:event', (e) => {
    const { type } = e.detail;
    if (['TASK_CREATED', 'TASK_UPDATED', 'TASK_DELETED'].includes(type)) loadTasks(el);
  });
}

export async function refresh(el) { await loadTasks(el); }

function buildBoard() {
  return `
  <div class="kanban-topbar" id="kanban-topbar">
    <div style="display:flex;gap:0.5rem;align-items:center;">
      <input type="text" class="form-input" id="task-search" placeholder="🔍 Search tasks…" style="width:200px;">
      <select class="form-select" id="task-filter-priority" style="width:130px;">
        <option value="">All priorities</option>
        <option>HIGH</option><option>MEDIUM</option><option>LOW</option>
      </select>
      <button class="btn btn-sm btn-ghost" id="toggle-archive-btn" title="Toggle Archive">
        <i class="fa fa-archive"></i> Archive
      </button>
    </div>
    <div id="task-summary-bar" style="display:flex;gap:0.75rem;align-items:center;font-size:0.75rem;color:var(--color-text-muted);"></div>
    <button class="btn btn-primary" id="new-task-btn"><i class="fa fa-plus"></i> New Task</button>
  </div>
  <div class="kanban-board" id="kanban-board">
    ${ACTIVE_STATUSES.map(s => buildCol(s)).join('')}
  </div>
  <div id="kanban-archive" style="display:none;margin-top:1.5rem;">
    <div style="font-size:0.8rem;font-weight:600;color:var(--color-text-muted);margin-bottom:0.5rem;display:flex;align-items:center;gap:0.5rem;">
      <i class="fa fa-archive"></i> ARCHIVED TASKS <span id="archive-count" style="background:var(--color-surface);padding:0.1rem 0.5rem;border-radius:99px;"></span>
    </div>
    <div class="kanban-cards" id="col-ARCHIVE" data-status="ARCHIVE" style="display:flex;flex-wrap:wrap;gap:0.5rem;padding:0.5rem 0;"></div>
  </div>`;
}

function buildCol(s) {
  const color = colColor(s);
  return `
  <div class="kanban-col" data-status="${s}" id="kcol-${s}">
    <div class="kanban-col-accent" id="accent-${s}" style="background:${color};" title="Click to change column color" data-col="${s}"></div>
    <div class="kanban-col-header" style="color:${color};">
      <span>${STATUS_LABELS[s]}</span>
      <span class="kanban-col-count" id="count-${s}">0</span>
    </div>
    <div class="kanban-cards" id="col-${s}" data-status="${s}"></div>
    <div class="kanban-add-btn" data-add="${s}">+ Add task</div>
  </div>`;
}

async function loadTasks(el) {
  try {
    tasks = await window.apiFetch('/tasks');
    if (!tasks) return;
    applyFilters();
    updateSummaryBar();
  } catch (e) { console.error(e); }
}

function updateSummaryBar() {
  const bar = document.getElementById('task-summary-bar');
  if (!bar) return;
  const active = tasks.filter(t => t.status !== 'ARCHIVE');
  const byStatus = {};
  active.forEach(t => { byStatus[t.status] = (byStatus[t.status] || 0) + 1; });
  const total = active.length;
  bar.innerHTML = `<span style="font-weight:600;color:var(--color-text);">${total} tasks</span> · ` +
    ['IN_PROGRESS', 'REVIEW', 'DONE'].map(s => byStatus[s] ? `<span style="color:${colColor(s)};">${byStatus[s]} ${STATUS_LABELS[s]}</span>` : '').filter(Boolean).join(' · ');
}

function applyFilters() {
  const search = document.getElementById('task-search')?.value?.toLowerCase() || '';
  const pri = document.getElementById('task-filter-priority')?.value || '';
  const filtered = tasks.filter(t =>
    (!search || t.title.toLowerCase().includes(search) || (t.description || '').toLowerCase().includes(search)) &&
    (!pri || t.priority === pri)
  );
  renderCards(filtered);
}

function renderCards(filtered) {
  ACTIVE_STATUSES.forEach(s => {
    const col = document.getElementById(`col-${s}`);
    const count = document.getElementById(`count-${s}`);
    if (!col) return;
    const colTasks = filtered.filter(t => t.status === s);
    count.textContent = colTasks.length;
    col.innerHTML = colTasks.map(t => taskCardHTML(t)).join('');
  });
  // Archive
  const archiveCol = document.getElementById('col-ARCHIVE');
  const archiveCount = document.getElementById('archive-count');
  const archived = filtered.filter(t => t.status === 'ARCHIVE');
  if (archiveCol) archiveCol.innerHTML = archived.map(t => taskCardHTML(t, true)).join('');
  if (archiveCount) archiveCount.textContent = archived.length;
}

function taskCardHTML(task, compact = false) {
  const hasErrors = (task.errors || []).length > 0;
  const agentName = task.agent_id ? `<span class="task-card-agent"><i class="fa fa-robot" style="font-size:0.65rem;"></i> ${task.agent_id.slice(0, 8)}</span>` : '';
  const errorDot = hasErrors ? '<span class="task-card-error-dot" title="Has errors"></span>' : '';
  const priBadge = task.priority === 'HIGH' ? '<span style="font-size:0.65rem;color:var(--color-danger);">● HIGH</span>' :
    task.priority === 'LOW' ? '<span style="font-size:0.65rem;color:var(--color-text-muted);">● LOW</span>' : '';
  return `<div class="task-card${compact ? ' task-card-compact' : ''}" data-id="${task.id}" data-status="${task.status}">
    <div class="task-card-title">${escHtml(task.title)}</div>
    <div class="task-card-meta">${errorDot}${priBadge}${agentName}
      <span class="task-card-time">${timeAgo(task.updated_at)}</span>
    </div>
    ${(task.tags || []).length ? `<div style="margin-top:0.35rem;display:flex;gap:0.25rem;flex-wrap:wrap;">${(task.tags || []).map(t => `<span class="chip">${escHtml(t)}</span>`).join('')}</div>` : ''}
  </div>`;
}

function initDragDrop(el) {
  el.addEventListener('dragover', (e) => {
    const col = e.target.closest('.kanban-cards');
    if (col) { e.preventDefault(); col.parentElement.classList.add('drag-over'); }
  });
  el.addEventListener('dragleave', (e) => {
    const col = e.target.closest('.kanban-col');
    if (col && !col.contains(e.relatedTarget)) col.classList.remove('drag-over');
  });
  el.addEventListener('drop', async (e) => {
    e.preventDefault();
    const col = e.target.closest('.kanban-cards');
    if (!col) return;
    col.parentElement.classList.remove('drag-over');
    const taskId = e.dataTransfer.getData('taskId');
    const newStatus = col.dataset.status;
    const task = tasks.find(t => t.id === taskId);
    if (task && task.status !== newStatus) {
      task.status = newStatus;
      renderCards(tasks);
      try {
        await window.apiFetch(`/tasks/${taskId}`, { method: 'PUT', body: { status: newStatus } });
        window.showToast(`Moved to ${STATUS_LABELS[newStatus]}`, 'success');
      } catch (e) { window.showToast('Failed to update task', 'error'); }
    }
  });
}

function bindEvents(el) {
  el.addEventListener('click', (e) => {
    const card = e.target.closest('.task-card');
    if (card) { openTaskModal(card.dataset.id); return; }
    if (e.target.closest('[data-add]')) { openNewTaskModal(e.target.closest('[data-add]').dataset.add); return; }
    if (e.target.closest('.kanban-col-accent')) {
      const s = e.target.closest('.kanban-col-accent').dataset.col;
      openColorPicker(s, e.target.closest('.kanban-col-accent'));
      return;
    }
  });
  el.addEventListener('dragstart', (e) => {
    const card = e.target.closest('.task-card');
    if (card) { card.classList.add('dragging'); e.dataTransfer.setData('taskId', card.dataset.id); }
  });
  el.addEventListener('dragend', (e) => {
    const card = e.target.closest('.task-card');
    if (card) card.classList.remove('dragging');
  });

  document.getElementById('new-task-btn')?.addEventListener('click', () => openNewTaskModal());
  document.getElementById('task-search')?.addEventListener('input', () => applyFilters());
  document.getElementById('task-filter-priority')?.addEventListener('change', () => applyFilters());
  document.getElementById('toggle-archive-btn')?.addEventListener('click', () => {
    showArchive = !showArchive;
    document.getElementById('kanban-archive').style.display = showArchive ? 'block' : 'none';
    document.getElementById('toggle-archive-btn').classList.toggle('btn-secondary', showArchive);
  });
}

function openColorPicker(status, anchorEl) {
  const existing = document.getElementById('col-color-picker');
  if (existing) existing.remove();
  const picker = document.createElement('div');
  picker.id = 'col-color-picker';
  picker.style.cssText = 'position:fixed;background:var(--color-card);border:1px solid var(--color-border);border-radius:var(--radius);padding:0.75rem;z-index:1000;box-shadow:0 8px 32px rgba(0,0,0,0.4);';
  const rect = anchorEl.getBoundingClientRect();
  picker.style.top = (rect.bottom + 6) + 'px';
  picker.style.left = rect.left + 'px';
  picker.innerHTML = `<div style="font-size:0.75rem;font-weight:600;color:var(--color-text-muted);margin-bottom:0.5rem;">Column Color</div>
      <input type="color" value="${colColor(status)}" style="width:100%;height:36px;border:none;cursor:pointer;background:transparent;" id="col-color-input">
      <div style="display:flex;gap:0.25rem;margin-top:0.5rem;flex-wrap:wrap;">
        ${['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#3b82f6', '#c084fc', '#fb923c', '#9ca3af'].map(c =>
    `<div style="width:20px;height:20px;border-radius:4px;background:${c};cursor:pointer;" data-color="${c}"></div>`
  ).join('')}
      </div>`;
  document.body.appendChild(picker);
  picker.querySelector('#col-color-input').addEventListener('input', (e) => applyColColor(status, e.target.value));
  picker.addEventListener('click', (e) => {
    if (e.target.dataset.color) applyColColor(status, e.target.dataset.color);
  });
  setTimeout(() => document.addEventListener('click', function handler(e) {
    if (!picker.contains(e.target) && !anchorEl.contains(e.target)) { picker.remove(); document.removeEventListener('click', handler); }
  }), 100);
}

function applyColColor(status, color) {
  colColors[status] = color;
  localStorage.setItem('mc_col_colors', JSON.stringify(colColors));
  const accent = document.getElementById(`accent-${status}`);
  const header = document.querySelector(`#kcol-${status} .kanban-col-header`);
  if (accent) accent.style.background = color;
  if (header) header.style.color = color;
}

window.openNewTaskModal = function (defaultStatus = 'PLANNING') {
  const agentsList = window._agents || [];
  window.openModal(`
  <div class="modal-header">
    <span class="modal-title"><i class="fa fa-plus"></i> New Task</span>
    <button class="icon-btn" onclick="closeModal()"><i class="fa fa-xmark"></i></button>
  </div>
  <div class="form-group"><label class="form-label">Title *</label><input class="form-input" id="nt-title" placeholder="Task title…" autofocus></div>
  <div class="form-group"><label class="form-label">Description</label><textarea class="form-textarea" id="nt-desc" placeholder="What needs to be done?"></textarea></div>
  <div class="form-row">
    <div class="form-group"><label class="form-label">Status</label>
      <select class="form-select" id="nt-status">${ACTIVE_STATUSES.map(s => `<option value="${s}" ${s === defaultStatus ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select></div>
    <div class="form-group"><label class="form-label">Priority</label>
      <select class="form-select" id="nt-priority"><option>HIGH</option><option selected>MEDIUM</option><option>LOW</option></select></div>
  </div>
  <div class="form-group"><label class="form-label">Agent</label>
    <select class="form-select" id="nt-agent"><option value="">Unassigned</option>${agentsList.map(a => `<option value="${a.id}">${escHtml(a.name)}</option>`).join('')}</select></div>
  <div class="form-group"><label class="form-label">Tags (comma separated)</label><input class="form-input" id="nt-tags" placeholder="feature, bug, urgent"></div>
  <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="nt-submit"><i class="fa fa-save"></i> Create</button></div>`);
  document.getElementById('nt-submit').onclick = async () => {
    const title = document.getElementById('nt-title').value.trim();
    if (!title) { window.showToast('Title required', 'warning'); return; }
    const tags = document.getElementById('nt-tags').value.split(',').map(t => t.trim()).filter(Boolean);
    try {
      await window.apiFetch('/tasks', {
        method: 'POST', body: {
          title, description: document.getElementById('nt-desc').value,
          status: document.getElementById('nt-status').value,
          priority: document.getElementById('nt-priority').value,
          agent_id: document.getElementById('nt-agent').value || null, tags
        }
      });
      closeModal(); window.showToast('Task created!', 'success');
    } catch (e) { window.showToast(e.message, 'error'); }
  };
};

window.openTaskModal = async function (id) {
  const task = tasks.find(t => t.id === id);
  if (!task) return;
  const isArchived = task.status === 'ARCHIVE';
  window.openModal(`
  <div class="modal-header">
    <span class="modal-title">${escHtml(task.title)}</span>
    <div style="display:flex;gap:0.5rem;">
      ${isArchived ? `<button class="btn btn-sm btn-secondary" onclick="moveTask('${id}','PLANNING')"><i class="fa fa-rotate-left"></i> Restore</button>` :
      `<button class="btn btn-sm btn-ghost" onclick="moveTask('${id}','ARCHIVE')" title="Archive"><i class="fa fa-archive"></i></button>`}
      <button class="btn btn-sm btn-danger" onclick="deleteTask('${id}')"><i class="fa fa-trash"></i></button>
      <button class="icon-btn" onclick="closeModal()"><i class="fa fa-xmark"></i></button>
    </div>
  </div>
  <div style="display:flex;gap:0.5rem;flex-wrap:wrap;margin-bottom:1rem;">
    <span class="badge badge-${(task.status || '').toLowerCase().replace(/_/g, '-')}">${STATUS_LABELS[task.status] || task.status}</span>
    <span class="chip">${task.priority}</span>
    ${task.agent_id ? `<span class="chip"><i class="fa fa-robot"></i> ${task.agent_id.slice(0, 8)}</span>` : ''}
  </div>
  ${task.description ? `<div style="font-size:0.875rem;line-height:1.6;margin-bottom:1rem;color:var(--color-text-muted);">${escHtml(task.description)}</div>` : ''}
  <hr class="divider">
  <div>
    <div style="font-size:0.75rem;font-weight:600;margin-bottom:0.5rem;color:var(--color-text-muted);">MOVE TO</div>
    <div style="display:flex;flex-wrap:wrap;gap:0.35rem;">${ACTIVE_STATUSES.filter(s => s !== task.status).map(s =>
        `<button class="btn btn-sm btn-secondary" onclick="moveTask('${id}','${s}')">${STATUS_LABELS[s]}</button>`
      ).join('')}</div>
  </div>
  ${(task.deliverables || []).length > 0 ? `<hr class="divider"><div style="font-size:0.75rem;font-weight:600;margin-bottom:0.5rem;color:var(--color-success);">✅ DELIVERABLES</div><ul style="font-size:0.8rem;padding-left:1rem;">${(task.deliverables || []).map(d => `<li>${escHtml(d)}</li>`).join('')}</ul>` : ''}
  ${(task.errors || []).length > 0 ? `<hr class="divider"><div style="font-size:0.75rem;font-weight:600;margin-bottom:0.5rem;color:var(--color-danger);">❌ ERRORS</div><ul style="font-size:0.8rem;padding-left:1rem;">${(task.errors || []).map(e => `<li style="color:var(--color-danger);">${escHtml(e)}</li>`).join('')}</ul>` : ''}
  <hr class="divider">
  <div style="font-size:0.72rem;color:var(--color-text-muted);">Created ${timeAgo(task.created_at)} · Updated ${timeAgo(task.updated_at)}</div>`, 'modal-lg');
};

window.moveTask = async function (id, status) {
  try {
    await window.apiFetch(`/tasks/${id}`, { method: 'PUT', body: { status } });
    closeModal();
    window.showToast(`Moved to ${STATUS_LABELS[status]}`, 'success');
    const t = tasks.find(t => t.id === id); if (t) t.status = status;
    renderCards(tasks); updateSummaryBar();
  } catch (e) { window.showToast(e.message, 'error'); }
};

window.deleteTask = async function (id) {
  if (!confirm('Delete this task?')) return;
  await window.apiFetch(`/tasks/${id}`, { method: 'DELETE' });
  tasks = tasks.filter(t => t.id !== id);
  renderCards(tasks); updateSummaryBar();
  closeModal(); window.showToast('Task deleted', 'info');
};

// Load agents
window.apiFetch('/agents').then(a => { if (a) window._agents = a; }).catch(() => { });

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function timeAgo(ts) {
  if (!ts) return '';
  const diff = Math.floor(Date.now() / 1000) - ts;
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
