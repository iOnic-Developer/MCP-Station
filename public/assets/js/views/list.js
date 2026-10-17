import { api } from '../api.js';
import { esc, toast, copyText } from '../ui.js';
import { icon, serviceIdentity } from '../icons.js';
import { accounts, workspaceUrl, statusOf, testCopy, testAccount } from './accounts.js';
export function renderList(root, ctx) {
  ctx.listState ||= { q: '', filter: 'all', scroll: 0 };
  const rows = ctx.mcps.flatMap((source) => accounts(source).map((account) => ({ source, m: { ...source, ...account, sourceId: source.id } })));
  const counts = { all: rows.length, live: 0, setup: 0, disabled: 0, error: 0 };
  for (const { m } of rows) counts[statusOf(m).kind]++;
  root.innerHTML = `<div class="mcp-toolbar"><div class="mcp-search-wrap">${icon('search')}<label class="sr-only" for="integrationSearch">Search integrations</label><input class="mcp-search" id="integrationSearch" data-mcp-search value="${esc(ctx.listState.q)}" placeholder="Search integrations…"><button class="btn icon-btn" data-search-clear aria-label="Clear search">${icon('close')}</button></div><div class="mcp-filters" role="group" aria-label="Filter integrations">${[['all','All'],['live','Enabled'],['setup','Setup needed'],['disabled','Disabled'],['error','Attention']].map(([key,label]) => `<button class="mcp-filter ${ctx.listState.filter === key ? 'active' : ''}" data-filter="${key}" aria-pressed="${ctx.listState.filter === key}">${label}<span class="count">${counts[key]}</span></button>`).join('')}</div><a class="btn" href="#/integrations/new">${icon('plus')}Add existing account</a><a class="btn" href="#/assistant">${icon('assistant')}Open assistant</a></div><p class="results-count" data-result-count role="status"></p><div class="integration-grid account-rows">${rows.map(({ source, m }) => {
    const s = statusOf(m), name = m.manifest?.name || source.id;
    const identity = serviceIdentity(source.id, source.manifest?.name || source.id);
    return `<article class="mcp-row integration-card" data-id="${esc(m.id)}" data-source="${esc(source.id)}" data-kind="${s.kind}" data-service-tone="${identity.tone}" data-search="${esc([name, m.name, source.id, m.manifest?.description].join(' ').toLowerCase())}"><div class="integration-head"><span class="service-icon" aria-hidden="true">${icon(identity.icon)}<span class="service-monogram">${esc(identity.monogram)}</span></span><div class="service-heading"><p class="service-category" title="${esc(identity.category)}">${esc(identity.category)}</p><h2 title="${esc(name)}">${esc(name)}</h2></div><span class="status-pill ${s.cls}"><span class="dot"></span>${s.label}</span></div><p class="integration-description">${esc(m.manifest?.description || 'A custom integration hosted on your station.')}</p><p class="account-row-name"><span class="help">Account</span><strong>${esc(m.name)}</strong></p><div class="endpoint"><code class="url" title="${esc(m.url)}">${esc(m.url)}</code><button class="btn sm" data-copy>${icon('copy')}Copy endpoint</button></div><div class="integration-primary"><a class="btn sm primary" href="${workspaceUrl(source.id,'settings',m.id)}">${icon('settings')}Configure</a><button class="btn sm" data-test ${m.manifest ? '' : 'disabled'}>${icon('test')}Test</button><div class="card-footer"><a href="${workspaceUrl(source.id,'connect',m.id)}">Access ${icon('arrow')}</a><label class="enable-control account-enable"><input type="checkbox" role="switch" data-toggle ${m.enabled ? 'checked' : ''} ${m.error ? 'disabled' : ''} aria-label="Enable ${esc(name)} ${esc(m.name)}"><span>${m.enabled ? 'On' : 'Off'}</span></label></div></div><p class="test-summary" data-result role="status" title="${esc(testCopy(m))}">${esc(testCopy(m))} · ${Number(m.clients || 0)} clients</p><div class="card-assistant"><a class="help" href="${workspaceUrl(source.id,'assistant',m.id)}">${icon('assistant')}Ask assistant</a></div></article>`;
  }).join('')}</div><section class="empty-state panel" data-filter-empty hidden><h2>${ctx.mcps.length ? 'No matching integrations' : 'Start with a service'}</h2><p>${ctx.mcps.length ? 'Try another search or choose All.' : 'Create a service integration, then add and configure its accounts.'}</p>${ctx.mcps.length ? '' : '<a class="btn primary" href="#/create">Create integration</a>'}</section>`;
  const search = root.querySelector('[data-mcp-search]');
  const apply = () => {
    const q = ctx.listState.q.trim().toLowerCase(); let count = 0;
    for (const row of root.querySelectorAll('[data-id]')) {
      row.hidden = !((ctx.listState.filter === 'all' || ctx.listState.filter === row.dataset.kind) && (!q || row.dataset.search.includes(q)));
      if (!row.hidden) count++;
    }
    root.querySelector('[data-filter-empty]').hidden = count !== 0;
    root.querySelector('[data-result-count]').textContent = `${count} account${count === 1 ? '' : 's'}`;
  };
  search.oninput = () => { ctx.listState.q = search.value; apply(); };
  root.querySelector('[data-search-clear]').onclick = () => { search.value = ''; ctx.listState.q = ''; apply(); search.focus(); };
  root.querySelectorAll('[data-filter]').forEach((b) => { b.onclick = () => { ctx.listState.filter = b.dataset.filter; root.querySelectorAll('[data-filter]').forEach((x) => { x.classList.toggle('active', x === b); x.setAttribute('aria-pressed', String(x === b)); }); apply(); }; });
  root.onkeydown = (e) => {
    if (e.key === '/' && !['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)) { e.preventDefault(); search.focus(); }
    if (e.key === 'Escape' && document.activeElement === search) { search.value = ''; ctx.listState.q = ''; apply(); }
  };
  for (const row of root.querySelectorAll('[data-id]')) {
    const { m } = rows.find(({ m }) => m.id === row.dataset.id);
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
