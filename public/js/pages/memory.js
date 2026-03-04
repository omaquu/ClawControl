// ─── memory.js — Memory Browser Page ─────────────────────────────────────────
let _memFiles = [];
let _memCurrent = null;
let _memEl = null;

export async function init(el) {
  _memEl = el;
  el.innerHTML = renderPage();
  await loadFiles(el);
  el.querySelector('#mem-refresh-btn').addEventListener('click', () => loadFiles(el));
  el.querySelector('#mem-search-input').addEventListener('input', (e) => filterFiles(e.target.value, el));
  el.querySelector('#mem-save-btn').addEventListener('click', () => saveFile());
  el.querySelector('#mem-editor').addEventListener('input', () => {
    el.querySelector('#mem-save-btn').style.display = '';
  });
}

export async function refresh(el) { await loadFiles(el); }

function renderPage() {
  return `
  <div class="page-header">
    <div>
      <h2 class="page-heading">Memory Browser</h2>
      <p class="page-sub">Explore and edit agent memory files</p>
    </div>
    <div style="display:flex;gap:0.5rem;">
      <input class="form-input" id="mem-search-input" placeholder="🔎 Filter files…" style="width:220px;">
      <button class="btn btn-ghost" id="mem-refresh-btn"><i class="fa fa-rotate"></i></button>
    </div>
  </div>

  <div style="display:grid;grid-template-columns:260px 1fr;gap:1rem;height:calc(100vh - 200px);">
    <div class="card" style="overflow-y:auto;padding:0;">
      <div id="mem-file-list" style="padding:0.5rem;"></div>
    </div>
    <div class="card" style="display:flex;flex-direction:column;padding:0;overflow:hidden;">
      <div style="padding:0.65rem 1rem;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between;flex-shrink:0;">
        <span id="mem-editor-path" style="font-family:var(--font-mono);font-size:0.8rem;color:var(--color-text-muted)">Select a file…</span>
        <button class="btn btn-sm btn-ghost" id="mem-save-btn" style="display:none"><i class="fa fa-floppy-disk"></i> Save</button>
      </div>
      <textarea id="mem-editor" style="flex:1;background:transparent;border:none;outline:none;padding:1rem;font-family:var(--font-mono);font-size:0.82rem;color:var(--color-text);resize:none;line-height:1.6;" placeholder="Select a file from the left panel…"></textarea>
    </div>
  </div>`;
}

async function loadFiles(el) {
  const files = await window.apiFetch('/memory');
  if (!files) return;
  _memFiles = files;
  renderFileList(_memFiles, el);
}

function filterFiles(q, el) {
  if (!q) { renderFileList(_memFiles, el); return; }
  const filtered = _memFiles.filter(f => f.path.toLowerCase().includes(q.toLowerCase()) || f.name.toLowerCase().includes(q.toLowerCase()));
  renderFileList(filtered, el);
}

function renderFileList(files, el) {
  const listEl = el.querySelector('#mem-file-list');
  if (!files.length) { listEl.innerHTML = `<div style="padding:1rem;color:var(--color-text-muted);font-size:0.85rem;">No files found</div>`; return; }

  const groups = {};
  for (const f of files) {
    const dir = f.path.includes('/') ? f.path.split('/').slice(0, -1).join('/') : '';
    if (!groups[dir]) groups[dir] = [];
    groups[dir].push(f);
  }

  listEl.innerHTML = Object.entries(groups).map(([dir, fls]) => `
    <div>
      ${dir ? `<div style="padding:0.4rem 0.5rem 0.2rem;font-size:0.7rem;color:var(--color-text-muted);text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">${dir}</div>` : ''}
      ${fls.map(f => `
        <div class="mem-file-item ${_memCurrent === f.path ? 'active' : ''}" data-path="${f.path}"
          style="display:flex;align-items:center;gap:0.5rem;padding:0.4rem 0.5rem;border-radius:6px;cursor:pointer;${_memCurrent === f.path ? 'background:var(--color-card);' : ''}transition:0.15s;"
          onmouseover="this.style.background='var(--color-card)'" onmouseout="this.style.background='${_memCurrent === f.path ? 'var(--color-card)' : 'transparent'}'"
          onclick="window._memOpen('${f.path}')">
          <i class="fa ${f.name.endsWith('.md') ? 'fa-file-lines' : f.name.endsWith('.json') ? 'fa-file-code' : 'fa-file'}" style="color:var(--color-accent);font-size:0.8rem;flex-shrink:0;"></i>
          <span style="font-size:0.82rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</span>
          <span style="font-size:0.68rem;color:var(--color-text-muted)">${Math.round(f.size / 1024 * 10) / 10}k</span>
        </div>`).join('')}
    </div>`).join('');

  window._memOpen = async (filePath) => {
    _memCurrent = filePath;
    renderFileList(_memFiles, el);
    const data = await window.apiFetch(`/memory/file?path=${encodeURIComponent(filePath)}`);
    if (!data) return;
    el.querySelector('#mem-editor-path').textContent = filePath;
    el.querySelector('#mem-editor').value = data.content || '';
    el.querySelector('#mem-save-btn').style.display = 'none';
  };
}

async function saveFile() {
  if (!_memCurrent || !_memEl) return;
  const content = _memEl.querySelector('#mem-editor').value;
  await window.apiFetch('/memory/file', { method: 'POST', body: { path: _memCurrent, content } });
  window.showToast('Saved ✓', 'success');
  _memEl.querySelector('#mem-save-btn').style.display = 'none';
}
