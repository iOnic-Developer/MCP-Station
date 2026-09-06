import { api, download } from '../api.js';
import { esc, toast } from '../ui.js';
import { openSettings } from './settings.js';
import { openEditor } from './editor.js';
import { openAccess } from './access.js';
import { openCapabilities } from './capabilities.js';

function statusOf(m) {
  if (m.error) return { cls: 'err', label: 'load error' };
  if (!m.enabled) return { cls: '', label: 'disabled' };
  if (!m.configured) return { cls: 'warn', label: 'needs settings' };
  return { cls: 'ok', label: 'live' };
}

/* Button colours say what the module needs from you, without opening anything:
 *   ⚙ Settings  red = not set up (a required setting is empty) · yellow = set up but something is
 *               wrong (load error, or the last test failed) · green = configured, nothing known wrong
 *   ▶ Test      green = last test passed · red = last test failed · yellow = never tested since the
 *               settings last changed */
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

  root.innerHTML = `<div class="rows">${mcps.map((m) => {
    const s = statusOf(m);
    const name = m.manifest?.name || m.id;
    const ok = Boolean(m.manifest && !m.error);
    const set = settingsState(m);
    const tst = testState(m);
    const info = m.error ? `⚠️ ${m.error}` : (m.manifest?.description || 'No description.');
    return `
    <div class="mcp-row ${m.enabled ? '' : 'off'} ${m.error ? 'err' : ''}" data-id="${esc(m.id)}">
      <span class="r-icon">${esc(m.manifest?.icon || '🔌')}</span>
      <span class="r-name" title="${esc(name)} · ${esc(s.label)}${m.manifest ? ` · v${esc(m.manifest.version)}` : ''} · /${esc(m.manifest?.slug || m.id)}">
        <span class="dot ${s.cls}"></span>${esc(name)}${m.manifest ? `<small>v${esc(m.manifest.version)}</small>` : ''}
      </span>
      <div class="r-btns">
        <div class="grp">
          <button class="btn sm ic" data-info title="${esc(info)}" aria-label="Description">ⓘ</button>
        </div>
        <div class="grp">
          <button class="btn sm ic" data-skill-link ${ok ? '' : 'disabled'} title="Share — copy a public link to this module's skill (SKILL.md, 7 days)" aria-label="Share skill link">🔗</button>
          <button class="btn sm ic" data-export ${m.manifest ? '' : 'disabled'} title="Export this module as a .zip — drop the folder into any station's mcps/ (no secrets included)" aria-label="Export">📦</button>
        </div>
        <div class="grp">
          <button class="btn sm ic ${tst.cls}" data-test ${m.manifest ? '' : 'disabled'} title="Test — ${esc(tst.hint)}" aria-label="Test">▶</button>
          <button class="btn sm ic ${m.tokenSet || m.clients ? 'st-ok' : ''}" data-access ${m.manifest ? '' : 'disabled'} title="Access — ${m.clients} connected client${m.clients === 1 ? '' : 's'}${m.tokenSet ? ' · own token set' : ' · no token yet'}" aria-label="Access">🔑${m.clients ? `<span class="n">${m.clients}</span>` : ''}${m.tokenSet ? '<span class="tok" title="token set">●</span>' : ''}</button>
          <button class="btn sm ic ${set.cls}" data-settings title="Settings — ${esc(set.hint)}" aria-label="Settings">⚙</button>
        </div>
        <div class="grp">
          <button class="btn sm ic" data-code title="Code — edit the module's files, with the ✦ chat beside them" aria-label="Code">‹/›</button>
          <button class="btn sm ic" data-skill ${ok ? '' : 'disabled'} title="Skill — download a Claude skill (.zip) for claude.ai → Settings → Capabilities → Skills" aria-label="Download skill">📄</button>
          <button class="btn sm ic" data-caps ${ok ? '' : 'disabled'} title="Tools — what this MCP can do" aria-label="Tools">🧰</button>
          <button class="btn sm ic" data-copy title="Copy the MCP URL: ${esc(m.url)}" aria-label="Copy MCP URL">⧉</button>
        </div>
        <div class="grp">
          <label class="toggle sm" title="${m.enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}">
            <input type="checkbox" data-toggle ${m.enabled ? 'checked' : ''} ${m.error ? 'disabled' : ''}>
            <span class="track"></span>
          </label>
        </div>
      </div>
      <div class="r-desc ${m.error ? 'is-err' : ''}" hidden>${esc(info)}<span class="mono dim"> · ${esc(m.url)}</span></div>
    </div>`;
  }).join('')}</div>
  <p style="color:var(--muted);font-size:12px;margin-top:18px">
    Connect in claude.ai: Settings → Connectors → <b>Add custom connector</b> → paste a module's URL (⧉ copies it) → approve with your station password.
    For Claude Code: <span class="mono">claude mcp add --transport http &lt;name&gt; &lt;url&gt; --header "Authorization: Bearer $MCP_TOKEN"</span>
  </p>`;

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

    row.querySelector('[data-caps]')?.addEventListener('click', () => openCapabilities(m));
    row.querySelector('[data-settings]')?.addEventListener('click', () => openSettings(m, ctx));
    row.querySelector('[data-access]')?.addEventListener('click', () => openAccess(m, ctx));
    row.querySelector('[data-code]').onclick = () => openEditor(m, ctx);

    row.querySelector('[data-test]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = '…';
      try {
        const r = await api(`/mcps/${id}/test`, { method: 'POST' });
        toast(r.message, r.ok ? 'ok' : 'err', 5200);
        ctx.refresh(); // re-renders with the stored result → the button takes its colour
      } catch (ex) { toast(ex.message, 'err'); btn.disabled = false; btn.textContent = '▶'; }
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
