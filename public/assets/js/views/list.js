import { api, download } from '../api.js';
import { esc, toast, confirmModal } from '../ui.js';
import { openSettings } from './settings.js';
import { openEditor } from './editor.js';
import { openAccess } from './access.js';
import { openCapabilities } from './capabilities.js';

function statusOf(m) {
  if (m.error) return { cls: 'err', label: 'load error', kind: 'error' };
  if (!m.enabled) return { cls: '', label: 'disabled', kind: 'disabled' };
  if (!m.configured) return { cls: 'warn', label: 'needs settings', kind: 'setup' };
  return { cls: 'ok', label: 'live', kind: 'live' };
}

function settingsState(m) {
  if (!m.manifest) return { cls: 'st-err', hint: 'failed to load — open to see the error or delete it' };
  if (!m.configured) return { cls: 'st-err', hint: 'not set up — required settings are missing' };
  if (m.error || m.lastTest?.ok === false) return { cls: 'st-warn', hint: m.error ? `load error: ${m.error}` : `last test failed: ${m.lastTest.message}` };
  return { cls: 'st-ok', hint: 'configured' };
}
function testState(m) {
  if (!m.manifest) return { cls: '', hint: 'cannot test — module failed to load' };
  if (!m.lastTest) return { cls: 'st-warn', hint: m.configured ? 'not tested yet' : 'not tested — set it up first' };
  const when = m.lastTest.at ? new Date(m.lastTest.at).toLocaleString() : '';
  return m.lastTest.ok
    ? { cls: 'st-ok', hint: `passed ${when}: ${m.lastTest.message}` }
    : { cls: 'st-err', hint: `failed ${when}: ${m.lastTest.message}` };
}

const action = ({ icon, label, attr, title, cls = '', disabled = false, edge = false }) =>
  `<div class="act-slot"><button class="btn sm ic ${cls}${edge ? ' edge-left' : ''}" ${attr} ${disabled ? 'disabled' : ''} title="${esc(title)}" aria-label="${esc(label)}"><span>${icon}</span><span class="act-label">${esc(label)}</span></button></div>`;

function accessAction(m, clients) {
  const title = `Access — ${clients} connected client${clients === 1 ? '' : 's'}${m.tokenSet ? ' · own token set' : ' · no token yet'}`;
  return `<div class="act-slot span-2">
    <button class="btn sm ic access-btn ${m.tokenSet || clients ? 'st-ok' : ''}" data-access ${m.manifest ? '' : 'disabled'} title="${esc(title)}" aria-label="Access">
      <span>🔑</span><span class="access-num">${clients}</span><span class="access-token ${m.tokenSet ? 'set' : ''}" title="${m.tokenSet ? 'Own token set' : 'No own token'}"></span><span class="act-label">Access</span>
    </button>
  </div>`;
}

function toggleControl(m) {
  return `<div class="enable-slot">
    <label class="v-toggle" title="${m.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}">
      <input type="checkbox" data-toggle ${m.enabled ? 'checked' : ''} ${m.error ? 'disabled' : ''} aria-label="${m.enabled ? 'Disable' : 'Enable'} module">
      <span class="v-toggle-face"><span class="v-toggle-label on">ON</span><span class="v-toggle-label off">OFF</span><span class="v-toggle-thumb"></span></span>
    </label>
  </div>`;
}

function filterCounts(mcps) {
  const counts = { all: mcps.length, live: 0, setup: 0, disabled: 0, error: 0 };
  for (const m of mcps) counts[statusOf(m).kind]++;
  return counts;
}

export function renderList(root, ctx) {
  const { mcps } = ctx;
  if (!mcps.length) {
    root.innerHTML = `<div class="card" style="text-align:center;padding:44px">
      <div style="font-size:34px">🛰️</div>
      <h3 style="margin:8px 0 4px">No MCPs yet</h3>
      <div class="desc">Hit ➕ Add MCP to create one from the template — then ask the ✦ assistant to write the tools.</div>
    </div>`;
    return;
  }

  ctx.listState ||= { q: '', filter: 'all' };
  const counts = filterCounts(mcps);
  const chip = (id, label) => `<button class="mcp-filter ${ctx.listState.filter === id ? 'active' : ''}" data-filter="${id}">${label}<span class="count">${counts[id]}</span></button>`;

  root.innerHTML = `<div class="mcp-toolbar">
    <div class="mcp-search-wrap">
      <span class="mcp-search-icon">⌕</span>
      <input class="mcp-search" data-mcp-search value="${esc(ctx.listState.q)}" placeholder="Search modules…  /" autocomplete="off" spellcheck="false" aria-label="Search MCP modules">
      <button class="mcp-search-clear" data-search-clear title="Clear search" aria-label="Clear search">×</button>
    </div>
    <div class="mcp-filters" role="group" aria-label="Filter modules by status">
      ${chip('all', 'All')}${chip('live', 'Live')}${chip('setup', 'Setup')}${chip('disabled', 'Off')}${chip('error', 'Errors')}
    </div>
  </div>
  <div class="rows">${mcps.map((m) => {
    const s = statusOf(m);
    const name = m.manifest?.name || m.id;
    const slug = m.manifest?.slug || m.id;
    const ok = Boolean(m.manifest && !m.error);
    const set = settingsState(m);
    const tst = testState(m);
    const info = m.error ? `⚠️ ${m.error}` : (m.manifest?.description || 'No description.');
    const clients = Number(m.clients || 0);
    const haystack = [name, m.id, slug, m.manifest?.description || '', s.label].join(' ').toLowerCase();
    return `
    <div class="mcp-row ${m.enabled ? '' : 'off'} ${m.error ? 'err' : ''}" data-id="${esc(m.id)}" data-kind="${s.kind}" data-search="${esc(haystack)}">
      <div class="r-ident">
        <span class="r-icon">${esc(m.manifest?.icon || '🔌')}</span>
        <div class="r-main">
          <span class="r-name" title="${esc(name)} · ${esc(s.label)}${m.manifest ? ` · v${esc(m.manifest.version)}` : ''} · /${esc(slug)}">
            <span class="dot ${s.cls}"></span>${esc(name)}${m.manifest ? `<small>v${esc(m.manifest.version)}</small>` : ''}
          </span>
          <div class="r-sub"><span class="state ${s.cls}">${esc(s.label)}</span> · <span class="mono">/${esc(slug)}</span>${m.manifest?.description ? ` · ${esc(m.manifest.description)}` : ''}</div>
        </div>
      </div>
      <div class="r-btns">
        ${accessAction(m, clients)}
        ${action({ icon: '⚙', label: 'Config', attr: 'data-settings', cls: set.cls, title: `Config — ${set.hint}` })}
        ${action({ icon: '▶', label: 'Test', attr: 'data-test', cls: tst.cls, disabled: !m.manifest, title: `Test — ${tst.hint}` })}
        ${action({ icon: '‹/›', label: 'Code', attr: 'data-code', title: `Code — edit the module's files, with the ✦ chat beside them` })}
        ${action({ icon: '🧰', label: 'Tools', attr: 'data-caps', disabled: !ok, title: 'Tools — what this MCP can do', edge: true })}
        ${toggleControl(m)}

        ${action({ icon: 'ⓘ', label: 'Info', attr: 'data-info', title: info })}
        ${action({ icon: '🔗', label: 'Share', attr: 'data-skill-link', disabled: !ok, title: `Share — copy a public link to this module's skill (SKILL.md, 7 days)` })}
        ${action({ icon: '📦', label: 'Export', attr: 'data-export', disabled: !m.manifest, title: `Export this module as a .zip — drop the folder into any station's mcps/ (no secrets included)` })}
        ${action({ icon: '📄', label: 'Skill', attr: 'data-skill', disabled: !ok, title: 'Skill — download a Claude skill (.zip) for claude.ai → Settings → Capabilities → Skills' })}
        ${action({ icon: '⧉', label: 'Copy URL', attr: 'data-copy', title: `Copy the MCP URL: ${m.url}` })}
        ${action({ icon: '🗑', label: 'Delete', attr: 'data-delete', cls: 'danger', title: 'Delete this module (a copy is kept in data/trash)', edge: true })}
      </div>
      <div class="r-desc ${m.error ? 'is-err' : ''}" hidden>${esc(info)}<span class="mono dim"> · ${esc(m.url)}</span></div>
    </div>`;
  }).join('')}</div>
  <div class="mcp-empty-filter" data-filter-empty hidden>No modules match this search/filter.</div>
  <p style="color:var(--muted);font-size:12px;margin-top:18px">
    Connect in claude.ai: Settings → Connectors → <b>Add custom connector</b> → paste a module's URL (Copy URL) → approve with your station password.
    For Claude Code: <span class="mono">claude mcp add --transport http &lt;name&gt; &lt;url&gt; --header "Authorization: Bearer $MCP_TOKEN"</span>
  </p>`;

  const search = root.querySelector('[data-mcp-search]');
  const empty = root.querySelector('[data-filter-empty]');
  const applyFilters = () => {
    const q = String(ctx.listState.q || '').trim().toLowerCase();
    let shown = 0;
    for (const row of root.querySelectorAll('.mcp-row[data-id]')) {
      const kindOk = ctx.listState.filter === 'all' || row.dataset.kind === ctx.listState.filter;
      const textOk = !q || row.dataset.search.includes(q);
      row.hidden = !(kindOk && textOk);
      if (!row.hidden) shown++;
    }
    empty.hidden = shown !== 0;
  };

  search.addEventListener('input', () => { ctx.listState.q = search.value; applyFilters(); });
  root.querySelector('[data-search-clear]').onclick = () => { search.value = ''; ctx.listState.q = ''; applyFilters(); search.focus(); };
  for (const b of root.querySelectorAll('[data-filter]')) b.onclick = () => {
    ctx.listState.filter = b.dataset.filter;
    root.querySelectorAll('[data-filter]').forEach((x) => x.classList.toggle('active', x === b));
    applyFilters();
  };
  root.onkeydown = (e) => {
    if (e.key === '/' && !['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) { e.preventDefault(); search.focus(); search.select(); }
    if (e.key === 'Escape' && document.activeElement === search && search.value) { search.value = ''; ctx.listState.q = ''; applyFilters(); }
  };
  applyFilters();

  for (const row of root.querySelectorAll('.mcp-row[data-id]')) {
    const id = row.dataset.id;
    const m = mcps.find((x) => x.id === id);

    row.querySelector('[data-info]').onclick = () => {
      const d = row.querySelector('.r-desc');
      d.hidden = !d.hidden;
    };

    row.querySelector('[data-toggle]')?.addEventListener('change', async (e) => {
      try {
        await api(`/mcps/${id}`, { method: 'PATCH', body: { enabled: e.target.checked } });
        toast(`${m.manifest?.name || id} ${e.target.checked ? 'enabled' : 'disabled'}`);
        ctx.refresh();
      } catch (ex) { toast(ex.message, 'err'); e.target.checked = !e.target.checked; }
    });

    row.querySelector('[data-copy]').onclick = async () => {
      await navigator.clipboard.writeText(m.url);
      toast('Endpoint URL copied');
    };

    row.querySelector('[data-delete]').onclick = async () => {
      const name = m.manifest?.name || m.id;
      if (!await confirmModal('Delete module?', `'${name}' will be moved to data/trash and its settings removed. The endpoint /${m.manifest?.slug || m.id} goes away immediately.`)) return;
      try {
        await api(`/mcps/${id}`, { method: 'DELETE' });
        toast('Module deleted (copy kept in data/trash)');
        ctx.refresh();
      } catch (ex) { toast(ex.message, 'err'); }
    };

    row.querySelector('[data-caps]')?.addEventListener('click', () => openCapabilities(m));
    row.querySelector('[data-settings]')?.addEventListener('click', () => openSettings(m, ctx));
    row.querySelector('[data-access]')?.addEventListener('click', () => openAccess(m, ctx));
    row.querySelector('[data-code]').onclick = () => openEditor(m, ctx);

    row.querySelector('[data-test]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const old = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span>…</span><span class="act-label">Testing</span>';
      try {
        const r = await api(`/mcps/${id}/test`, { method: 'POST' });
        toast(r.message, r.ok ? 'ok' : 'err', 5200);
        ctx.refresh();
      } catch (ex) { toast(ex.message, 'err'); btn.disabled = false; btn.innerHTML = old; }
    });

    const skillName = (m.manifest?.slug || id).replace(/_/g, '-');

    row.querySelector('[data-skill]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await download(`/mcps/${id}/skill`, `${skillName}-skill.zip`);
        toast('Skill .zip downloaded — claude.ai → Settings → Capabilities → Skills → Upload', 'ok', 6000);
      } catch (ex) { toast(ex.message, 'err'); }
      btn.disabled = false;
    });

    row.querySelector('[data-skill-link]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        const { url } = await api(`/mcps/${id}/skill/share`, { method: 'POST', body: {} });
        await navigator.clipboard.writeText(url);
        toast(`Public link copied (7 days) — tell Claude to fetch it: ${url}`, 'ok', 7000);
      } catch (ex) { toast(ex.message, 'err'); }
      btn.disabled = false;
    });

    row.querySelector('[data-export]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await download(`/mcps/${id}/export-module`, `${id}-module.zip`);
        toast('Module .zip downloaded — unzip into any station\'s mcps/ folder and hit Reload', 'ok', 6000);
      } catch (ex) { toast(ex.message, 'err'); }
      btn.disabled = false;
    });
  }
}
