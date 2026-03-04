// ─── search.js — Global Search Page ─────────────────────────────────────────
let _searchDebounce = null;
let _searchEl = null;

export function init(el) {
  _searchEl = el;
  el.innerHTML = renderPage();
  const input = el.querySelector('#search-query');
  const scope = el.querySelector('#search-scope');
  input.focus();
  input.addEventListener('input', () => {
    clearTimeout(_searchDebounce);
    _searchDebounce = setTimeout(() => doSearch(el), 300);
  });
  scope.addEventListener('change', () => doSearch(el));
}

export function refresh(el) { /* no-op, search is stateless */ }

function renderPage() {
  return `
  <div class="page-header">
    <div>
      <h2 class="page-heading">Global Search</h2>
      <p class="page-sub">Full-text search across memory and workspace files</p>
    </div>
  </div>

  <div class="card" style="padding:1rem 1.25rem;margin-bottom:1rem;">
    <div style="display:flex;gap:0.75rem;align-items:center;">
      <div style="position:relative;flex:1;">
        <i class="fa fa-magnifying-glass" style="position:absolute;left:1rem;top:50%;transform:translateY(-50%);color:var(--color-text-muted);pointer-events:none;"></i>
        <input class="form-input" id="search-query" placeholder="Search memory files, workspace, code…" style="padding-left:2.5rem;font-size:1rem;" autofocus>
      </div>
      <select class="form-select" id="search-scope" style="width:160px;">
        <option value="all">All sources</option>
        <option value="memory">Memory only</option>
        <option value="files">Workspace only</option>
      </select>
    </div>
    <div id="search-meta" style="margin-top:0.5rem;font-size:0.78rem;color:var(--color-text-muted);min-height:1.2em;"></div>
  </div>

  <div id="search-results"></div>`;
}

async function doSearch(el) {
  const q = el.querySelector('#search-query').value.trim();
  const scope = el.querySelector('#search-scope').value;
  const metaEl = el.querySelector('#search-meta');
  const resultsEl = el.querySelector('#search-results');
  if (!q || q.length < 2) { resultsEl.innerHTML = ''; metaEl.textContent = ''; return; }
  metaEl.textContent = 'Searching…';
  const t0 = Date.now();
  const results = await window.apiFetch(`/search?q=${encodeURIComponent(q)}&scope=${scope}`);
  if (!results) return;
  const elapsed = Date.now() - t0;
  metaEl.textContent = `${results.length} result${results.length !== 1 ? 's' : ''} in ${elapsed}ms`;
  renderResults(results, q, resultsEl);
}

function highlight(text, q) {
  if (!q) return escHtml(text);
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escHtml(text).replace(new RegExp(`(${escaped})`, 'gi'), '<mark style="background:rgba(99,102,241,0.3);color:var(--color-text);border-radius:2px;padding:0 1px;">$1</mark>');
}

function renderResults(results, q, resultsEl) {
  if (!results.length) {
    resultsEl.innerHTML = `<div class="empty-state"><i class="fa fa-magnifying-glass"></i><p>No results found</p></div>`;
    return;
  }
  const byFile = {};
  for (const r of results) {
    const key = `${r.source}:${r.file}`;
    if (!byFile[key]) byFile[key] = { source: r.source, file: r.file, matches: [] };
    byFile[key].matches.push(r);
  }
  resultsEl.innerHTML = Object.values(byFile).map(group => `
    <div class="card" style="margin-bottom:0.75rem;padding:0;overflow:hidden;">
      <div style="padding:0.6rem 1rem;background:var(--color-surface);border-bottom:1px solid var(--color-border);display:flex;align-items:center;gap:0.75rem;">
        <span style="font-size:0.7rem;padding:1px 6px;border-radius:4px;background:rgba(99,102,241,0.15);color:var(--color-accent)">${group.source}</span>
        <span style="font-family:var(--font-mono);font-size:0.8rem;">${group.file}</span>
        <span style="margin-left:auto;font-size:0.72rem;color:var(--color-text-muted)">${group.matches.length} match${group.matches.length !== 1 ? 'es' : ''}</span>
      </div>
      ${group.matches.slice(0, 8).map(m => `
        <div style="padding:0.5rem 1rem 0.5rem 1.5rem;border-bottom:1px solid rgba(255,255,255,0.04);display:flex;gap:1rem;align-items:baseline;">
          <span style="font-family:var(--font-mono);font-size:0.7rem;color:var(--color-text-muted);min-width:40px;text-align:right;">L${m.line}</span>
          <span style="font-family:var(--font-mono);font-size:0.8rem;line-height:1.5;">${highlight(m.snippet, q)}</span>
        </div>`).join('')}
      ${group.matches.length > 8 ? `<div style="padding:0.4rem 1rem;font-size:0.75rem;color:var(--color-text-muted);">…and ${group.matches.length - 8} more matches</div>` : ''}
    </div>`).join('');
}

function escHtml(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
