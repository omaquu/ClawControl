// ─── memory.js — Memory Browser Page ─────────────────────────────────────────
export const page = {
    id: 'memory',
    title: '🧠 Memory Browser',
    icon: 'fa-brain',
    _files: [],
    _current: null,

    render() {
        return `
    <div class="page-header">
      <div>
        <h2 class="page-heading">Memory Browser</h2>
        <p class="page-sub">Explore and edit agent memory files from ${window._app?.openclawDir || 'OPENCLAW_DIR'}</p>
      </div>
      <div style="display:flex;gap:0.5rem;">
        <input class="form-input" id="mem-search-input" placeholder="🔎 Search memory…" style="width:220px;">
        <button class="btn btn-ghost" id="mem-refresh-btn"><i class="fa fa-rotate"></i></button>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:280px 1fr;gap:1rem;height:calc(100vh - 180px);">
      <!-- File Tree -->
      <div class="card" style="overflow-y:auto;padding:0;">
        <div id="mem-file-list" style="padding:0.5rem;"></div>
      </div>
      <!-- Editor -->
      <div class="card" style="display:flex;flex-direction:column;padding:0;overflow:hidden;">
        <div id="mem-editor-header" style="padding:0.75rem 1rem;border-bottom:1px solid var(--color-border);display:flex;align-items:center;justify-content:space-between;">
          <span id="mem-editor-path" style="font-family:var(--font-mono);font-size:0.82rem;color:var(--color-text-dim)">Select a file to view</span>
          <div style="display:flex;gap:0.5rem;">
            <button class="btn btn-sm btn-ghost" id="mem-save-btn" style="display:none"><i class="fa fa-floppy-disk"></i> Save</button>
          </div>
        </div>
        <textarea id="mem-editor" style="flex:1;background:transparent;border:none;outline:none;padding:1rem;font-family:var(--font-mono);font-size:0.82rem;color:var(--color-text);resize:none;line-height:1.6;" placeholder="Select a file from the left panel…" readonly></textarea>
      </div>
    </div>`;
    },

    async init() {
        await this.loadFiles();
        document.getElementById('mem-refresh-btn').addEventListener('click', () => this.loadFiles());
        document.getElementById('mem-search-input').addEventListener('input', (e) => {
            this.filterFiles(e.target.value);
        });
        document.getElementById('mem-save-btn').addEventListener('click', () => this.saveFile());
        document.getElementById('mem-editor').addEventListener('input', () => {
            document.getElementById('mem-save-btn').style.display = '';
            document.getElementById('mem-editor').removeAttribute('readonly');
        });
    },

    async loadFiles() {
        this._files = await window.api('/api/memory');
        this.renderFileList(this._files);
    },

    filterFiles(q) {
        if (!q) { this.renderFileList(this._files); return; }
        const filtered = this._files.filter(f => f.path.toLowerCase().includes(q.toLowerCase()) || f.name.toLowerCase().includes(q.toLowerCase()));
        this.renderFileList(filtered);
    },

    renderFileList(files) {
        const el = document.getElementById('mem-file-list');
        if (!files.length) { el.innerHTML = `<div style="padding:1rem;color:var(--color-text-dim);font-size:0.85rem;">No files found</div>`; return; }

        // Group by directory
        const groups = {};
        for (const f of files) {
            const dir = f.path.includes('/') ? f.path.split('/').slice(0, -1).join('/') : '';
            if (!groups[dir]) groups[dir] = [];
            groups[dir].push(f);
        }

        el.innerHTML = Object.entries(groups).map(([dir, fls]) => `
      <div class="mem-group">
        ${dir ? `<div style="padding:0.4rem 0.5rem 0.2rem;font-size:0.7rem;color:var(--color-text-dim);text-transform:uppercase;letter-spacing:0.08em;font-weight:600;">${dir}</div>` : ''}
        ${fls.map(f => `
          <div class="mem-file-item ${this._current === f.path ? 'active' : ''}" data-path="${f.path}" onclick="window._memOpen('${f.path}')">
            <i class="fa ${f.name.endsWith('.md') ? 'fa-file-lines' : f.name.endsWith('.json') ? 'fa-file-code' : 'fa-file'}" style="color:var(--color-accent);font-size:0.8rem;"></i>
            <span style="font-size:0.82rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${f.name}</span>
            <span style="font-size:0.68rem;color:var(--color-text-dim)">${Math.round(f.size / 1024 * 10) / 10}k</span>
          </div>`).join('')}
      </div>`).join('');

        window._memOpen = async (filePath) => {
            this._current = filePath;
            this.renderFileList(files);
            const data = await window.api(`/api/memory/file?path=${encodeURIComponent(filePath)}`);
            document.getElementById('mem-editor-path').textContent = filePath;
            document.getElementById('mem-editor').value = data.content || '';
            document.getElementById('mem-editor').setAttribute('readonly', '');
            document.getElementById('mem-save-btn').style.display = 'none';
        };
    },

    async saveFile() {
        if (!this._current) return;
        const content = document.getElementById('mem-editor').value;
        await window.api('/api/memory/file', { method: 'POST', body: JSON.stringify({ path: this._current, content }) });
        window.toast('Saved ✓', 'success');
        document.getElementById('mem-save-btn').style.display = 'none';
    }
};
