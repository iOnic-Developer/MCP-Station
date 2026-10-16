import { api, download } from '../api.js';
import { esc, toast, modal } from '../ui.js';
import { icon } from '../product.js';
import { openSettings } from './settings.js';
import { openEditor } from './editor.js';
import { openAccess, confirmAction as confirmModal } from './access.js';
import { openCapabilities } from './capabilities.js';

function statusOf(m) {
  if (m.error || !m.manifest) return { kind: 'error', label: 'Load error', cls: 'err' };
  if (!m.enabled) return { kind: 'disabled', label: 'Disabled', cls: '' };
  if (!m.configured) return { kind: 'setup', label: 'Needs configuration', cls: 'warn' };
  return { kind: 'ready', label: 'Ready', cls: 'ok' };
}
function lastTest(m) {
  const t = m.lastTest;
  if (!t) return 'Not tested yet';
  return `Last test ${t.ok ? 'passed' : 'failed'}${t.at ? ` · ${new Date(t.at).toLocaleString()}` : ''}: ${t.message || 'No detail returned'}`;
}
async function copyOrShow(value, title) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(value);
    toast(`${title} copied`);
  } catch {
    const dlg = modal({ title: `Copy ${title.toLowerCase()} manually`, body: `<p>Clipboard access is unavailable. Select and copy this value.</p><label for="module-copy-value">${esc(title)}</label><textarea id="module-copy-value" class="input mono" readonly>${esc(value)}</textarea>`, foot: '<button class="btn primary" data-done>Done</button>' });
    dlg.querySelector('[data-done]').onclick = () => dlg.close();
    const field = dlg.querySelector('textarea'); field.focus(); field.select();
  }
}

export function renderList(root, ctx) {
  ctx.renderModuleList = renderList;
  ctx.listState ||= { q: '', filter: 'all' };
  // Pending keys outlive the DOM so a background refresh cannot unlock a request.
  ctx.modulePending ||= new Set();
  const state = ctx.listState;
  if (state.filter === 'live') state.filter = 'ready';
  const active = root.contains(document.activeElement) ? document.activeElement : null;
  const focus = active ? { search: active.matches('[data-mcp-search]'), filter: active.dataset.filter, id: active.closest('[data-id]')?.dataset.id, action: active.dataset.action, start: active.selectionStart, end: active.selectionEnd } : (!document.querySelector('dialog[open], .drawer') ? state.restoreFocus : null);
  const opened = new Set([...root.querySelectorAll('[data-id] details[open]')].map((d) => d.closest('[data-id]').dataset.id));
  const mcps = ctx.mcps || [];
  const counts = { all: mcps.length, ready: 0, setup: 0, disabled: 0, error: 0 };
  mcps.forEach((m) => counts[statusOf(m).kind]++);
  const chip = (id, label) => `<button class="mcp-filter ${state.filter === id ? 'active' : ''}" data-filter="${id}" aria-pressed="${state.filter === id}">${label}<span class="count">${counts[id]}</span></button>`;
  const button = (action, label, glyph, disabled = false, cls = '') => `<button class="btn ${cls}" data-action="${action}" data-${action} ${disabled ? 'disabled' : ''}>${icon(glyph)}${label}</button>`;
  root.innerHTML = `<div class="module-library"><div class="library-toolbar"><div class="library-search"><label for="module-search">Search modules</label><div class="row"><input id="module-search" class="input" data-mcp-search value="${esc(state.q)}" placeholder="Name, description or endpoint" autocomplete="off" spellcheck="false"><button class="btn" data-search-clear aria-label="Clear search">Clear</button></div></div><div class="mcp-filters" role="group" aria-label="Module status">${chip('all', 'All')}${chip('ready', 'Ready')}${chip('setup', 'Needs setup')}${chip('disabled', 'Disabled')}${chip('error', 'Load errors')}</div></div><p class="library-summary" data-summary role="status"></p><div class="module-grid">${mcps.map((m) => {
    const s = statusOf(m); const valid = Boolean(m.manifest && !m.error);
    const name = m.manifest?.name || m.id;
    return `<article class="module-card mcp-row ${!m.enabled ? 'off' : ''}" data-id="${esc(m.id)}" data-kind="${s.kind}" data-search="${esc([name, m.id, m.manifest?.description, m.url, s.label].join(' ').toLowerCase())}"><div class="module-heading"><span class="module-mark">${m.manifest?.icon ? esc(m.manifest.icon) : icon('modules')}</span><div><h2>${esc(name)}</h2><span class="mono subtle">/${esc(m.manifest?.slug || m.id)}${m.manifest?.version ? ` · v${esc(m.manifest.version)}` : ''}</span></div><span class="module-state ${s.cls}">${s.label}</span></div><p class="module-description">${esc(m.manifest?.description || 'No description provided.')}</p><div class="module-facts"><span>${m.configured ? 'Configuration saved' : 'Configuration incomplete'} · ${m.enabled ? 'Enabled' : 'Disabled'}</span><span class="${m.lastTest?.ok === false ? 'is-error' : ''}">${esc(lastTest(m))}</span>${m.error ? `<span class="is-error">${esc(m.error)}</span>` : ''}</div><div class="module-primary">${button('settings', 'Configure', 'settings')}${button('test', 'Test', 'arrow', !valid)}${button('caps', 'Tools', 'modules', !valid)}</div><details class="module-more" ${opened.has(m.id) ? 'open' : ''}><summary data-action="more">More actions</summary><div class="module-secondary">${button('access', `Access (${Number(m.clients || 0)})`, 'connections', !valid)}${button('code', 'Edit code', 'settings')}${button('copy', 'Copy endpoint', 'connections')}${button('info', 'Module info', 'help')}${button('skill', 'Download skill', 'backup', !valid)}${button('skill-link', 'Create public skill link', 'connections', !valid)}${button('export', 'Export module', 'backup', !m.manifest)}${button('delete', 'Delete module', 'logout', false, 'danger')}<label class="module-enable"><input type="checkbox" data-toggle data-action="toggle" ${m.enabled ? 'checked' : ''} ${!valid ? 'disabled' : ''}> Enable module</label></div></details><div class="module-info" hidden data-info-panel><p>${esc(m.error || m.manifest?.description || 'No additional description.')}</p><code>${esc(m.url)}</code><p>${m.tokenSet ? 'Module token configured' : 'No module token configured'}. Ready means enabled and configured, not a live health check.</p></div><p class="module-feedback" role="status" data-feedback></p></article>`;
  }).join('')}</div><section class="module-empty" data-filter-empty hidden><h2>${mcps.length ? 'No matching modules' : 'Your library starts here'}</h2><p>${mcps.length ? 'Try a different search or status filter.' : 'Choose Add module above to create a template, then implement and test its tools.'}</p><button class="btn" data-reset-filters>Clear search &amp; filters</button></section><p class="library-note">Ready means enabled and configured. Test results are saved observations, not continuous service health. Open Access to connect a client using a module-scoped token or OAuth.</p></div>`;
  const search = root.querySelector('[data-mcp-search]');
  const apply = () => {
    const q = state.q.trim().toLowerCase(); let shown = 0;
    root.querySelectorAll('.module-card').forEach((row) => { row.hidden = !((state.filter === 'all' || row.dataset.kind === state.filter) && (!q || row.dataset.search.includes(q))); if (!row.hidden) shown++; });
    root.querySelector('[data-filter-empty]').hidden = shown !== 0;
    root.querySelector('[data-summary]').textContent = `${shown} of ${mcps.length} module${mcps.length === 1 ? '' : 's'}`;
    root.querySelector('[data-search-clear]').disabled = !state.q;
    root.querySelectorAll('[data-filter]').forEach((b) => { b.classList.toggle('active', b.dataset.filter === state.filter); b.setAttribute('aria-pressed', String(b.dataset.filter === state.filter)); });
  };
  search.oninput = () => { state.q = search.value; apply(); };
  root.querySelector('[data-search-clear]').onclick = () => { state.q = ''; search.value = ''; apply(); search.focus(); };
  root.querySelector('[data-reset-filters]').onclick = () => { state.q = ''; state.filter = 'all'; search.value = ''; apply(); search.focus(); };
  root.querySelectorAll('[data-filter]').forEach((b) => { b.onclick = () => { state.filter = b.dataset.filter; apply(); }; });
  root.onkeydown = (e) => { if (e.key === '/' && !document.activeElement?.isContentEditable && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { e.preventDefault(); search.focus(); } if (e.key === 'Escape' && e.target === search) { state.q = ''; search.value = ''; apply(); } };
  for (const row of root.querySelectorAll('.module-card')) {
    const m = mcps.find((item) => item.id === row.dataset.id); const id = encodeURIComponent(m.id);
    const pendingKey = m.id;
    const setBusy = (busy) => { row.setAttribute('aria-busy', String(busy)); row.querySelectorAll('button,input').forEach((el) => { if (busy) { el.dataset.wasDisabled = String(el.disabled); el.disabled = true; } else { el.disabled = el.dataset.wasDisabled === 'true'; } }); };
    if (ctx.modulePending.has(pendingKey)) setBusy(true);
    async function run(task) {
      if (ctx.modulePending.has(pendingKey)) return;
      const focused = document.activeElement;
      if (row.contains(focused) && focused.dataset.action) state.restoreFocus = { id: m.id, action: focused.dataset.action };
      ctx.modulePending.add(pendingKey); setBusy(true);
      const feedback = row.querySelector('[data-feedback]'); feedback.textContent = 'Working…';
      try { await task(feedback); }
      catch (e) { feedback.textContent = e.message; feedback.classList.add('is-error'); toast(e.message, 'err'); }
      finally { ctx.modulePending.delete(pendingKey); setBusy(false); if (feedback.textContent === 'Working…') feedback.textContent = ''; if (!row.isConnected && root.isConnected) renderList(root, ctx); else if (state.restoreFocus?.id === m.id && !document.querySelector('dialog[open], .drawer')) { const el = row.querySelector(`[data-action="${state.restoreFocus.action}"]`); if (el && !el.disabled) el.focus({ preventScroll: true }); state.restoreFocus = null; } }
    }
    row.querySelector('[data-settings]').onclick = () => openSettings(m, ctx);
    row.querySelector('[data-access]').onclick = () => run(() => openAccess(m, ctx));
    row.querySelector('[data-code]').onclick = () => run(() => openEditor(m, ctx));
    row.querySelector('[data-caps]').onclick = () => run(() => openCapabilities(m));
    row.querySelector('[data-info]').onclick = (e) => { const panel = row.querySelector('[data-info-panel]'); panel.hidden = !panel.hidden; e.currentTarget.setAttribute('aria-expanded', String(!panel.hidden)); };
    row.querySelector('[data-copy]').onclick = () => copyOrShow(m.url, 'Endpoint URL');
    row.querySelector('[data-toggle]').onchange = (e) => {
      const control = e.currentTarget; const enabled = control.checked;
      return run(async () => { try { await api(`/mcps/${id}`, { method: 'PATCH', body: { enabled } }); m.enabled = enabled; await ctx.refresh(); } catch (err) { control.checked = !enabled; throw err; } });
    };
    row.querySelector('[data-test]').onclick = () => run(async (feedback) => { const r = await api(`/mcps/${id}/test`, { method: 'POST' }); feedback.textContent = r.message; m.lastTest = { ...r, at: new Date().toISOString() }; toast(r.message, r.ok ? 'ok' : 'err', 6000); await ctx.refresh(); });
    row.querySelector('[data-delete]').onclick = () => run(async () => {
      if (!await confirmModal('Delete module?', `Delete '${m.manifest?.name || m.id}' and its settings? Its endpoint stops immediately. A code copy is kept in data/trash.`, { confirmLabel: 'Delete module', danger: true })) return;
      await api(`/mcps/${id}`, { method: 'DELETE' }); toast('Module deleted; code copy kept in data/trash'); await ctx.refresh();
    });
    row.querySelector('[data-skill]').onclick = () => run(() => download(`/mcps/${id}/skill`, `${(m.manifest?.slug || m.id).replace(/_/g, '-')}-skill.zip`));
    row.querySelector('[data-export]').onclick = () => run(() => download(`/mcps/${id}/export-module`, `${m.id}-module.zip`));
    row.querySelector('[data-skill-link]').onclick = () => run(async () => {
      if (!await confirmModal('Create a PUBLIC skill link?', 'Anyone with this link can read this module’s skill without signing in. The PUBLIC link expires in 7 days. Create it?', { confirmLabel: 'Create public link' })) return;
      const { url } = await api(`/mcps/${id}/skill/share`, { method: 'POST', body: {} }); await copyOrShow(url, 'Public skill link (expires in 7 days)');
    });
  }
  apply();
  if (focus) {
    let target = focus.search ? search : [...root.querySelectorAll('[data-filter]')].find((b) => b.dataset.filter === focus.filter);
    if (focus.id) target = [...root.querySelectorAll('[data-id]')].find((r) => r.dataset.id === focus.id)?.querySelector(`[data-action="${focus.action}"]`);
    if (!target && focus.id) target = search;
    if (target && !target.disabled) { target.focus({ preventScroll: true }); state.restoreFocus = null; if (focus.search && focus.start != null) target.setSelectionRange(focus.start, focus.end); }
  }
}
