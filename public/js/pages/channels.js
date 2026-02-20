// Channels Page
let channels = [];

export async function init(el) {
    el.innerHTML = buildLayout();
    await load();
    document.getElementById('new-channel-btn')?.addEventListener('click', openChannelModal);
}
export async function refresh(el) { await load(); }

async function load() {
    channels = (await window.apiFetch('/channels').catch(() => [])) || [];
    renderChannels();
}

function buildLayout() {
    return `
  <div class="section-header">
    <div>
      <h2 class="section-title"><i class="fa fa-satellite-dish"></i> Channels</h2>
      <div style="font-size:0.8rem;color:var(--color-text-muted);">Track YouTube channels and content sources for agent research</div>
    </div>
    <button class="btn btn-primary" id="new-channel-btn"><i class="fa fa-plus"></i> Add Channel</button>
  </div>
  <div id="channels-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:1rem;"></div>`;
}

function renderChannels() {
    const grid = document.getElementById('channels-grid');
    if (!grid) return;
    if (!channels.length) {
        grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><i class="fa fa-satellite-dish"></i><p>No channels tracked yet.<br>Add YouTube channels for agent research.</p></div>`;
        return;
    }
    grid.innerHTML = channels.map(ch => `
  <div class="card">
    <div style="display:flex;align-items:flex-start;gap:0.75rem;margin-bottom:0.75rem;">
      <div style="width:48px;height:48px;border-radius:50%;background:${platformColor(ch.platform)};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        <i class="fa fa-${platformIcon(ch.platform)}" style="color:#fff;"></i>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="font-weight:600;truncate;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(ch.name)}</div>
        <a href="${escHtml(ch.url)}" target="_blank" style="font-size:0.72rem;color:var(--color-text-muted);display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(ch.url)}</a>
      </div>
    </div>
    <div class="divider"></div>
    <div style="font-size:0.78rem;display:flex;justify-content:space-between;margin-top:0.5rem;">
      <span><span class="text-muted">Platform:</span> ${ch.platform || 'YouTube'}</span>
      <span><span class="text-muted">Added:</span> ${timeAgo(ch.created_at)}</span>
    </div>
    ${ch.notes ? `<div style="margin-top:0.5rem;font-size:0.78rem;color:var(--color-text-muted);">${escHtml(ch.notes)}</div>` : ''}
    <div style="margin-top:0.75rem;display:flex;gap:0.35rem;justify-content:flex-end;">
      <a class="btn btn-sm btn-secondary" href="${ch.url}" target="_blank"><i class="fa fa-arrow-up-right-from-square"></i></a>
      <button class="btn btn-sm btn-ghost" onclick="window.openChannelModal('${ch.id}')"><i class="fa fa-edit"></i></button>
      <button class="btn btn-sm btn-danger" onclick="window.deleteChannel('${ch.id}')"><i class="fa fa-trash"></i></button>
    </div>
  </div>`).join('');
}

window.openChannelModal = function (id) {
    const ch = id ? channels.find(c => c.id === id) : null;
    window.openModal(`
  <div class="modal-header">
    <span class="modal-title">${ch ? 'Edit Channel' : 'Add Channel'}</span>
    <button class="icon-btn" onclick="closeModal()"><i class="fa fa-xmark"></i></button>
  </div>
  <div class="form-group"><label class="form-label">Channel Name *</label><input class="form-input" id="ch-name" value="${ch?.name || ''}" placeholder="Lex Fridman"></div>
  <div class="form-group"><label class="form-label">URL *</label><input class="form-input" id="ch-url" type="url" value="${ch?.url || ''}" placeholder="https://youtube.com/@lexfridman"></div>
  <div class="form-group"><label class="form-label">Platform</label>
    <select class="form-select" id="ch-platform">
      ${['YouTube', 'Twitter/X', 'Twitch', 'Podcast', 'Newsletter', 'Blog', 'Discord', 'Other'].map(p => `<option ${(ch?.platform || 'YouTube') === p ? 'selected' : ''}>${p}</option>`).join('')}
    </select></div>
  <div class="form-group"><label class="form-label">Notes</label><input class="form-input" id="ch-notes" value="${ch?.notes || ''}" placeholder="Why is this channel useful?"></div>
  <div class="form-actions">
    <button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" onclick="window.saveChannel('${id || ''}')"><i class="fa fa-save"></i> ${ch ? 'Update' : 'Add'}</button>
  </div>`);
};

window.saveChannel = async function (id) {
    const name = document.getElementById('ch-name').value.trim();
    const url = document.getElementById('ch-url').value.trim();
    if (!name || !url) { window.showToast('Name and URL required', 'warning'); return; }
    const body = { name, url, platform: document.getElementById('ch-platform').value, notes: document.getElementById('ch-notes').value };
    try {
        if (id) await window.apiFetch(`/channels/${id}`, { method: 'PUT', body });
        else await window.apiFetch('/channels', { method: 'POST', body });
        closeModal(); window.showToast('Saved!', 'success'); load();
    } catch (e) { window.showToast(e.message, 'error'); }
};

window.deleteChannel = async function (id) {
    if (!confirm('Remove this channel?')) return;
    await window.apiFetch(`/channels/${id}`, { method: 'DELETE' });
    channels = channels.filter(c => c.id !== id); renderChannels();
    window.showToast('Channel removed', 'info');
};

function platformColor(p) { const m = { 'YouTube': '#ff0000', 'Twitter/X': '#1da1f2', 'Twitch': '#9146ff', 'Podcast': '#f59e0b', 'Newsletter': '#10b981', 'Blog': '#6366f1' }; return m[p] || '#6b7280'; }
function platformIcon(p) { const m = { 'YouTube': 'youtube', 'Twitter/X': 'twitter', 'Twitch': 'twitch', 'Podcast': 'podcast' }; return m[p] || 'rss'; }
function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function timeAgo(ts) { if (!ts) return '—'; const d = Math.floor(Date.now() / 1000) - ts; return d < 86400 ? `${Math.floor(d / 3600)}h ago` : `${Math.floor(d / 86400)}d ago`; }
