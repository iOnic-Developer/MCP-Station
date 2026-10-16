import { api } from '../api.js';
import { esc, toast, copyText } from '../ui.js';
import { icon, serviceIcon } from '../icons.js';
import { selected, accountSelect, workspaceUrl, statusOf, testCopy, testAccount } from './accounts.js';
export function renderList(root, ctx) {
  ctx.listState ||= { q: '', filter: 'all', scroll: 0 };
  const counts = { all: ctx.mcps.length, live: 0, setup: 0, disabled: 0, error: 0 };
  for (const source of ctx.mcps) counts[statusOf(selected(source, ctx)).kind]++;
  root.innerHTML = `<div class="mcp-toolbar"><div class="mcp-search-wrap">${icon('search')}<label class="sr-only" for="integrationSearch">Search integrations</label><input class="mcp-search" id="integrationSearch" data-mcp-search value="${esc(ctx.listState.q)}" placeholder="Search integrations…"><button class="btn icon-btn" data-search-clear aria-label="Clear search">${icon('close')}</button></div><div class="mcp-filters" role="group" aria-label="Filter integrations">${[['all','All'],['live','Enabled'],['setup','Setup needed'],['disabled','Disabled'],['error','Attention']].map(([key,label]) => `<button class="mcp-filter ${ctx.listState.filter === key ? 'active' : ''}" data-filter="${key}" aria-pressed="${ctx.listState.filter === key}">${label}<span class="count">${counts[key]}</span></button>`).join('')}</div><a class="btn" href="#/integrations/new">${icon('plus')}Add account</a></div><p class="results-count" data-result-count role="status"></p><div class="integration-grid">${ctx.mcps.map((source) => {
    const m = selected(source, ctx), s = statusOf(m), name = m.manifest?.name || source.id;
    return `<article class="mcp-row integration-card" data-id="${esc(source.id)}" data-kind="${s.kind}" data-search="${esc([name, source.id, m.manifest?.description].join(' ').toLowerCase())}"><div class="integration-head"><span class="service-icon">${serviceIcon(source.id)}</span><span class="status-pill ${s.cls}"><span class="dot"></span>${s.label}</span></div><h2 title="${esc(name)}">${esc(name)}</h2><p class="integration-description">${esc(m.manifest?.description || 'A custom integration hosted on your station.')}</p>${accountSelect(source, ctx)}<div class="endpoint"><code class="url" title="${esc(m.url)}">${esc(m.url)}</code></div><div class="integration-primary"><button class="btn sm" data-copy>${icon('copy')}Copy endpoint</button><a class="btn sm primary" href="${workspaceUrl(source.id,'settings',m.id)}">${icon('settings')}Configure</a><button class="btn sm" data-test ${m.manifest ? '' : 'disabled'}>${icon('test')}Test</button></div><p class="test-summary" data-result role="status" title="${esc(testCopy(m))}">${esc(testCopy(m))}</p><div class="card-footer"><a href="${workspaceUrl(source.id,'connect',m.id)}">Open workspace ${icon('arrow')}</a><label class="enable-control"><input type="checkbox" role="switch" data-toggle ${m.enabled ? 'checked' : ''} ${m.error ? 'disabled' : ''} aria-label="Enable ${esc(name)} ${esc(m.name)}"><span class="switch-track"></span><span>${m.enabled ? 'On' : 'Off'}</span></label></div></article>`;
  }).join('')}</div><section class="empty-state panel" data-filter-empty hidden><h2>${ctx.mcps.length ? 'No matching integrations' : 'Start with a service'}</h2><p>${ctx.mcps.length ? 'Try another search or choose All.' : 'Create a service integration, then add and configure its accounts.'}</p>${ctx.mcps.length ? '' : '<a class="btn primary" href="#/integrations/new">Add integration</a>'}</section>`;
  const search = root.querySelector('[data-mcp-search]');
  const apply = () => {
    const q = ctx.listState.q.trim().toLowerCase(); let count = 0;
    for (const row of root.querySelectorAll('[data-id]')) {
      row.hidden = !((ctx.listState.filter === 'all' || ctx.listState.filter === row.dataset.kind) && (!q || row.dataset.search.includes(q)));
      if (!row.hidden) count++;
    }
    root.querySelector('[data-filter-empty]').hidden = count !== 0;
    root.querySelector('[data-result-count]').textContent = `${count} integration${count === 1 ? '' : 's'}`;
  };
  search.oninput = () => { ctx.listState.q = search.value; apply(); };
  root.querySelector('[data-search-clear]').onclick = () => { search.value = ''; ctx.listState.q = ''; apply(); search.focus(); };
  root.querySelectorAll('[data-filter]').forEach((b) => { b.onclick = () => { ctx.listState.filter = b.dataset.filter; root.querySelectorAll('[data-filter]').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); }); apply(); }; });
  root.onkeydown = (e) => {
    if (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) { e.preventDefault(); search.focus(); }
    if (e.key === 'Escape' && document.activeElement === search) { search.value = ''; ctx.listState.q = ''; apply(); }
  };
  for (const row of root.querySelectorAll('[data-id]')) {
    const source = ctx.mcps.find((m) => m.id === row.dataset.id), m = selected(source, ctx);
    row.querySelector('[data-account]').onchange = (e) => { ctx.accountSelection.set(source.id, e.target.value); const scroll = window.scrollY; renderList(root, ctx); window.scrollTo(0, scroll); root.querySelector(`[data-id="${CSS.escape(source.id)}"] [data-account]`).focus({ preventScroll: true }); };
    row.querySelector('[data-copy]').onclick = () => copyText(m.url, 'Endpoint copied');
    row.querySelector('[data-test]').onclick = (e) => testAccount(m, e.currentTarget, row.querySelector('[data-result]'), ctx);
    row.querySelector('[data-toggle]').onchange = async (e) => {
      const b = e.target; b.disabled = true;
      try { await api(`/mcps/${encodeURIComponent(m.id)}`, { method: 'PATCH', body: { enabled: b.checked } }); await ctx.refresh(); }
      catch (error) { toast(error.message, 'err'); b.checked = !b.checked; b.disabled = false; }
    };
  }
  apply();
}
