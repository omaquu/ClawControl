// ─── notifications.js — Notification Center Page ─────────────────────────────
export const page = {
    id: 'notifications',
    title: '🔔 Notifications',
    icon: 'fa-bell',

    render() {
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
    },

    async init() {
        await this.loadNotifications();
        document.getElementById('notif-read-all').addEventListener('click', async () => {
            await window.api('/api/notifications/read-all', { method: 'POST' });
            await this.loadNotifications();
            window.updateNotifBadge?.();
        });
        document.getElementById('notif-add-btn').addEventListener('click', () => this.showAddModal());
    },

    async loadNotifications() {
        const items = await window.api('/api/notifications');
        this.render_list(items);
        window.updateNotifBadge?.();
    },

    typeIcon(t) {
        return { info: '💬', success: '✅', warning: '⚠️', error: '❌', agent: '🤖' }[t] || '🔔';
    },

    render_list(items) {
        const el = document.getElementById('notif-list');
        if (!items.length) {
            el.innerHTML = `<div class="empty-state"><i class="fa fa-bell-slash"></i><p>No notifications</p></div>`;
            return;
        }
        el.innerHTML = items.map(n => `
      <div class="notif-item ${n.read ? 'read' : 'unread'}" style="display:flex;gap:1rem;align-items:flex-start;padding:0.9rem 1.25rem;border-bottom:1px solid var(--color-border10);${!n.read ? 'border-left:3px solid var(--color-accent);' : ''}">
        <div style="font-size:1.2rem;line-height:1;">${this.typeIcon(n.type)}</div>
        <div style="flex:1;">
          <div style="display:flex;align-items:center;gap:0.75rem;">
            <strong style="font-size:0.9rem;${!n.read ? 'color:var(--color-text)' : 'color:var(--color-text-dim)'}">${n.title}</strong>
            ${!n.read ? '<span style="font-size:0.65rem;padding:1px 6px;border-radius:9999px;background:var(--color-accent);color:white;font-weight:600;">NEW</span>' : ''}
          </div>
          ${n.body ? `<div style="font-size:0.82rem;color:var(--color-text-dim);margin-top:0.25rem;">${n.body}</div>` : ''}
          <div style="font-size:0.72rem;color:var(--color-text-dim);margin-top:0.35rem;">${new Date(n.created_at * 1000).toLocaleString()}</div>
        </div>
        <div style="display:flex;gap:0.25rem;flex-shrink:0;">
          ${!n.read ? `<button class="btn btn-sm btn-ghost" title="Mark read" onclick="window._notifRead('${n.id}')"><i class="fa fa-check"></i></button>` : ''}
          <button class="btn btn-sm btn-ghost" style="color:var(--color-danger)" title="Delete" onclick="window._notifDelete('${n.id}')"><i class="fa fa-trash"></i></button>
        </div>
      </div>`).join('');

        window._notifRead = async (id) => {
            await window.api(`/api/notifications/${id}/read`, { method: 'PUT' });
            await this.loadNotifications();
        };
        window._notifDelete = async (id) => {
            await window.api(`/api/notifications/${id}`, { method: 'DELETE' });
            await this.loadNotifications();
        };
    },

    showAddModal() {
        window.showModal('New Notification', `
      <div style="display:flex;flex-direction:column;gap:0.75rem;">
        <div>
          <label class="form-label">Type</label>
          <select class="form-select" id="notif-type-sel">
            ${['info', 'success', 'warning', 'error', 'agent'].map(t => `<option value="${t}">${t}</option>`).join('')}
          </select>
        </div>
        <div>
          <label class="form-label">Title</label>
          <input class="form-input" id="notif-title-inp" placeholder="Notification title">
        </div>
        <div>
          <label class="form-label">Body (optional)</label>
          <textarea class="form-input" id="notif-body-inp" rows="3" placeholder="Additional details…"></textarea>
        </div>
      </div>`, [
            { label: 'Cancel', cls: 'btn-ghost', onClick: window.closeModal },
            {
                label: 'Create', cls: 'btn-primary', onClick: async () => {
                    const type = document.getElementById('notif-type-sel').value;
                    const title = document.getElementById('notif-title-inp').value.trim();
                    const body = document.getElementById('notif-body-inp').value.trim();
                    if (!title) return;
                    await window.api('/api/notifications', { method: 'POST', body: JSON.stringify({ type, title, body }) });
                    window.closeModal();
                    await this.loadNotifications();
                    window.toast('Notification created', 'success');
                }
            }
        ]);
    }
};
