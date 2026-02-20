// Files Manager Page
let currentPath = '';
let currentFilePath = '';

export async function init(el) {
  el.innerHTML = buildLayout();
  await loadDir('');
  bindEvents(el);
}
export async function refresh() { loadDir(currentPath); }

function buildLayout() {
  return `
  <div class="file-layout">
    <div class="file-tree" id="file-tree">
      <div style="padding:0.5rem;display:flex;gap:0.35rem;">
        <button class="btn btn-sm btn-ghost" data-file-action="home" title="Home"><i class="fa fa-house"></i></button>
        <button class="btn btn-sm btn-ghost" data-file-action="new" title="New file"><i class="fa fa-plus"></i></button>
      </div>
      <div id="file-tree-items"></div>
    </div>
    <div class="file-content">
      <div class="file-content-header">
        <span id="file-path" style="font-family:var(--font-mono);font-size:0.78rem;color:var(--color-text-muted);">/ (workspace root)</span>
        <div style="display:flex;gap:0.4rem;">
          <button class="btn btn-sm btn-secondary" id="file-save" data-file-action="save" disabled><i class="fa fa-save"></i> Save</button>
          <button class="btn btn-sm btn-ghost" data-file-action="copy"><i class="fa fa-copy"></i></button>
          <button class="btn btn-sm btn-ghost" id="file-download" data-file-action="download" disabled><i class="fa fa-download"></i></button>
        </div>
      </div>
      <div class="file-editor">
        <div id="file-preview" style="display:none;padding:1rem;overflow:auto;flex:1;font-size:0.85rem;line-height:1.6;"></div>
        <textarea id="file-editor-area" class="code-editor" style="border:none;border-radius:0;height:100%;font-size:0.8rem;" placeholder="Select a file to edit…" disabled></textarea>
      </div>
    </div>
  </div>`;
}

async function loadDir(p) {
  currentPath = p;
  try {
    const data = await window.apiFetch(`/files?path=${encodeURIComponent(p)}`);
    if (!data) return;
    if (data.type === 'directory') renderTree(data.items, p);
  } catch (e) { window.showToast(e.message, 'error'); }
}
window.loadDir = loadDir;

function renderTree(items, basePath) {
  const container = document.getElementById('file-tree-items');
  if (!container) return;
  const entries = (items || []).sort((a, b) => {
    if (a.isDir && !b.isDir) return -1;
    if (!a.isDir && b.isDir) return 1;
    return a.name.localeCompare(b.name);
  });
  const parts = basePath.split('/').filter(Boolean);
  let breadcrumb = '<div style="padding:0.25rem 0.5rem;font-size:0.72rem;color:var(--color-text-muted);">';
  breadcrumb += `<span class="file-crumb" data-crumb="" style="cursor:pointer;color:var(--color-accent);">root</span>`;
  parts.forEach((p, i) => { breadcrumb += ` / <span class="file-crumb" data-crumb="${parts.slice(0, i + 1).join('/')}" style="cursor:pointer;color:var(--color-accent);">${escHtml(p)}</span>`; });
  breadcrumb += '</div>';
  container.innerHTML = breadcrumb + entries.map(f => `
    <div class="file-tree-item ${f.isDir ? 'is-dir' : ''}" data-file-path="${escHtml(f.path)}" data-is-dir="${f.isDir ? '1' : '0'}">
      <i class="fa fa-${f.isDir ? 'folder-open' : getFileIcon(f.name)}"></i>
      <span class="truncate" title="${escHtml(f.name)}">${escHtml(f.name)}</span>
      ${!f.isDir ? `<span style="font-size:0.65rem;color:var(--color-text-muted);margin-left:auto;">${fmtSize(f.size)}</span>` : ''}
    </div>`).join('');
}

async function openFile(p) {
  currentFilePath = p;
  document.getElementById('file-path').textContent = '/ ' + p;
  document.getElementById('file-save').disabled = false;
  document.getElementById('file-download').disabled = false;

  const ext = (p.split('.').pop() || '').toLowerCase();
  const imgExts = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico'];
  const area = document.getElementById('file-editor-area');
  const preview = document.getElementById('file-preview');

  if (imgExts.includes(ext)) {
    area.style.display = 'none';
    preview.style.display = 'block';
    const tok = localStorage.getItem('mc_session') || sessionStorage.getItem('mc_session');
    preview.innerHTML = `<div style="text-align:center;"><img src="/api/file?path=${encodeURIComponent(p)}&token=${tok}" style="max-width:100%;max-height:60vh;border-radius:var(--radius);" onerror="this.alt='Load error';"></div>`;
    return;
  }
  preview.style.display = 'none';
  area.style.display = 'block';
  area.disabled = false;
  area.value = 'Loading…';
  try {
    const data = await window.apiFetch(`/file?path=${encodeURIComponent(p)}`);
    area.value = data?.content || '';
  } catch (e) { area.value = `Error: ${e.message}`; }
}
window.openFile = openFile;

async function saveFile() {
  const area = document.getElementById('file-editor-area');
  try {
    await window.apiFetch('/file', { method: 'POST', body: { path: currentFilePath, content: area.value } });
    window.showToast('File saved!', 'success');
  } catch (e) { window.showToast(e.message, 'error'); }
}

function copyFileContent() {
  const area = document.getElementById('file-editor-area');
  navigator.clipboard.writeText(area.value).then(() => window.showToast('Copied!', 'success'));
}

function downloadFile() {
  const area = document.getElementById('file-editor-area');
  const blob = new Blob([area.value], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = currentFilePath.split('/').pop() || 'file.txt'; a.click();
  URL.revokeObjectURL(url);
}

function openNewFileModal() {
  window.openModal(`
  <div class="modal-header"><span class="modal-title"><i class="fa fa-file-plus"></i> New File</span>
    <button class="icon-btn" onclick="closeModal()"><i class="fa fa-xmark"></i></button></div>
  <div class="form-group"><label class="form-label">File path (relative to workspace)</label>
    <input class="form-input" id="nf-path" placeholder="folder/filename.md"></div>
  <div class="form-group"><label class="form-label">Content</label>
    <textarea class="form-textarea" id="nf-content" style="min-height:120px;"></textarea></div>
  <div class="form-actions"><button class="btn btn-ghost" onclick="closeModal()">Cancel</button>
    <button class="btn btn-primary" id="nf-create"><i class="fa fa-save"></i> Create</button></div>`);
  document.getElementById('nf-create').onclick = async () => {
    const p = document.getElementById('nf-path').value.trim();
    if (!p) { window.showToast('Path required', 'warning'); return; }
    await window.apiFetch('/file', { method: 'POST', body: { path: p, content: document.getElementById('nf-content').value } });
    closeModal(); window.showToast('File created!', 'success');
    await loadDir(currentPath);
  };
}

function bindEvents(el) {
  const area = document.getElementById('file-editor-area');
  area?.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveFile(); }
    if (e.key === 'Tab') { e.preventDefault(); const s = area.selectionStart; area.value = area.value.slice(0, s) + '  ' + area.value.slice(area.selectionEnd); area.selectionStart = area.selectionEnd = s + 2; }
  });
  el.addEventListener('click', (e) => {
    const action = e.target.closest('[data-file-action]')?.dataset.fileAction;
    if (action === 'home') { loadDir(''); return; }
    if (action === 'new') { openNewFileModal(); return; }
    if (action === 'save') { saveFile(); return; }
    if (action === 'copy') { copyFileContent(); return; }
    if (action === 'download') { downloadFile(); return; }
    const crumb = e.target.closest('[data-crumb]');
    if (crumb !== null && crumb !== undefined) { loadDir(crumb.dataset.crumb); return; }
    const item = e.target.closest('[data-file-path]');
    if (item) {
      if (item.dataset.isDir === '1') loadDir(item.dataset.filePath);
      else openFile(item.dataset.filePath);
      document.querySelectorAll('[data-file-path]').forEach(i => i.classList.remove('active'));
      item.classList.add('active');
    }
  });
}

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function getFileIcon(name) {
  const ext = (name.split('.').pop() || '').toLowerCase();
  if (['js', 'ts', 'jsx', 'tsx', 'mjs'].includes(ext)) return 'file-code';
  if (['json', 'yaml', 'yml'].includes(ext)) return 'file-shield';
  if (['md', 'txt'].includes(ext)) return 'file-lines';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return 'file-image';
  if (['sh', 'bash', 'zsh'].includes(ext)) return 'terminal';
  if (['py'].includes(ext)) return 'file-code';
  return 'file';
}
function fmtSize(b) { if (!b) return ''; if (b < 1024) return b + 'B'; if (b < 1048576) return (b / 1024).toFixed(1) + 'K'; return (b / 1048576).toFixed(1) + 'M'; }
