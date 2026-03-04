// ─── notifications.js — Notification Center Page ─────────────────────────────
let _notifEl = null;

export async function init(el) {
  _notifEl = el;
  el.innerHTML = renderPage();
  await loadNotifications(el);
  el.querySelector('#notif-read-all').addEventListener('click', async () => {
    await window.apiFetch('/notifications/read-all', { method: 'POST' });
    await loadNotifications(el);
    window.updateNotifBadge?.();
  });
  el.querySelector('#notif-add-btn').addEventListener('click', () => showAddModal(el));
}

export async function refresh(el) { await loadNotifications(el); }

function renderPage() {
  return `
  <div class="page-header">
    <div>
      <h2 class="page-heading">Notifications</h2>
      <p class="page-sub">System alerts, agent events, and activity log</p>
    </div>
    <div style="display:flex;gap:0.5rem;">
      <button class="btn btn-ghost" id="notif-read-all"><i class="fa fa-check-double"></i> Mark all read</button>
      <button class="btn btn-primary" id="notif-add-btn"><i class="fa fa-plus"></i> Add</button>
    </div>
  </div>
  <div class="card" style="padding:0;overflow:hidden;">
    <div id="notif-list"></div>
  </div>`;
}

async function loadNotifications(el) {
  const items = await window.apiFetch('/notifications');
  if (!items) return;
  renderList(items, el);
  window.updateNotifBadge?.();
}

function typeIcon(t) {
  return { info: '💬', success: '✅', warning: '⚠️', error: '❌', agent: '🤖' }[t] || '🔔';
}

function renderList(items, el) {
  const listEl = el.querySelector('#notif-list');
  if (!items.length) {
    listEl.innerHTML = `<div class="empty-state"><i class="fa fa-bell-slash"></i><p>No notifications</p></div>`;
    return;
  }
  listEl.innerHTML = items.map(n => `
    <div style="display:flex;gap:1rem;align-items:flex-start;padding:0.9rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.04);${!n.read ? 'border-left:3px solid var(--color-accent);' : ''}">
      <div style="font-size:1.2rem;line-height:1;flex-shrink:0;">${typeIcon(n.type)}</div>
      <div style="flex:1;">
        <div style="display:flex;align-items:center;gap:0.75rem;">
          <strong style="font-size:0.9rem;${!n.read ? '' : 'color:var(--color-text-muted)'}">${n.title}</strong>
          ${!n.read ? '<span style="font-size:0.65rem;padding:1px 6px;border-radius:9999px;background:var(--color-accent);color:white;font-weight:600;">NEW</span>' : ''}
        </div>
        ${n.body ? `<div style="font-size:0.82rem;color:var(--color-text-muted);margin-top:0.25rem;">${n.body}</div>` : ''}
        <div style="font-size:0.72rem;color:var(--color-text-muted);margin-top:0.35rem;">${new Date(n.created_at * 1000).toLocaleString()}</div>
      </div>
      <div style="display:flex;gap:0.25rem;flex-shrink:0;">
        ${!n.read ? `<button class="btn btn-sm btn-ghost" title="Mark read" onclick="window._nRead('${n.id}')"><i class="fa fa-check"></i></button>` : ''}
        <button class="btn btn-sm btn-ghost" style="color:var(--color-danger)" title="Delete" onclick="window._nDel('${n.id}')"><i class="fa fa-trash"></i></button>
      </div>
    </div>`).join('');

  window._nRead = async (id) => {
    await window.apiFetch(`/notifications/${id}/read`, { method: 'PUT' });
    await loadNotifications(el);
  };
  window._nDel = async (id) => {
    await window.apiFetch(`/notifications/${id}`, { method: 'DELETE' });
    await loadNotifications(el);
  };
}

function showAddModal(el) {
  window.showModal('New Notification', `
    <div style="display:flex;flex-direction:column;gap:0.75rem;">
      <div><label class="form-label">Type</label>
        <select class="form-select" id="notif-type-sel">
          ${['info', 'success', 'warning', 'error', 'agent'].map(t => `<option value="${t}">${t}</option>`).join('')}
        </select>
      </div>
      <div><label class="form-label">Title</label><input class="form-input" id="notif-title-inp" placeholder="Notification title"></div>
      <div><label class="form-label">Body (optional)</label><textarea class="form-input" id="notif-body-inp" rows="3" placeholder="Additional details…"></textarea></div>
    </div>`, [
    { label: 'Cancel', cls: 'btn-ghost', onClick: window.closeModal },
    {
      label: 'Create', cls: 'btn-primary', onClick: async () => {
        const type = document.getElementById('notif-type-sel').value;
        const title = document.getElementById('notif-title-inp').value.trim();
        const body = document.getElementById('notif-body-inp').value.trim();
        if (!title) return;
        await window.apiFetch('/notifications', { method: 'POST', body: { type, title, body } });
        window.closeModal();
        await loadNotifications(el);
        window.showToast('Notification created', 'success');
      }
    }
  ]);
}
