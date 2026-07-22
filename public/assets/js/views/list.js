import { api, download } from '../api.js';
import { esc, toast, confirmModal } from '../ui.js';
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

  root.innerHTML = `<div class="grid">${mcps.map((m) => {
    const s = statusOf(m);
    const name = m.manifest?.name || m.id;
    return `
    <div class="card" data-id="${esc(m.id)}">
      <div class="head">
        <div class="icon">${esc(m.manifest?.icon || '🔌')}</div>
        <div style="min-width:0">
          <h3>${esc(name)}</h3>
          <div class="status"><span class="dot ${s.cls}"></span>${s.label}${m.manifest ? ` · v${esc(m.manifest.version)}` : ''}</div>
        </div>
        <div class="spacer"></div>
        <label class="toggle" title="${m.enabled ? 'Disable' : 'Enable'}">
          <input type="checkbox" data-toggle ${m.enabled ? 'checked' : ''} ${m.error ? 'disabled' : ''}>
          <span class="track"></span>
        </label>
      </div>
      <div class="desc">${esc(m.error ? m.error : (m.manifest?.description || ''))}</div>
      <div class="endpoint">
        <span class="url mono" title="${esc(m.url)}">${esc(m.url)}</span>
        <button class="btn sm" data-copy title="Copy URL">⧉</button>
      </div>
      <div class="actions">
        <button class="btn sm" data-caps ${m.manifest && !m.error ? '' : 'disabled'} title="What this MCP can do">🧰 Tools</button>
        <button class="btn sm" data-settings ${m.manifest ? '' : 'disabled'}>⚙ Settings</button>
        <button class="btn sm" data-access ${m.manifest ? '' : 'disabled'} title="Token + connected clients">🔑 Access${m.tokenSet ? ' ✓' : ''}</button>
        <button class="btn sm" data-code>‹/› Code</button>
        <button class="btn sm" data-test ${m.manifest ? '' : 'disabled'}>▶ Test</button>
        <button class="btn sm" data-skill ${m.manifest && !m.error ? '' : 'disabled'} title="Download a Claude skill (.zip) — upload it in claude.ai → Settings → Capabilities → Skills">📄 Skill</button>
        <button class="btn sm" data-skill-link ${m.manifest && !m.error ? '' : 'disabled'} title="Copy a public link to this skill's SKILL.md (expires in 7 days)">🔗</button>
        <button class="btn sm" data-export ${m.manifest ? '' : 'disabled'} title="Download this module as a shareable .zip — drop the folder into any other station's mcps/ (no secrets included)">📦 Export</button>
        <div class="spacer"></div>
        <button class="btn sm danger" data-del title="Delete module">🗑</button>
      </div>
    </div>`;
  }).join('')}</div>
  <p style="color:var(--muted);font-size:12px;margin-top:18px">
    Connect in claude.ai: Settings → Connectors → <b>Add custom connector</b> → paste an endpoint URL above → approve with your station password.
    For Claude Code: <span class="mono">claude mcp add --transport http &lt;name&gt; &lt;url&gt; --header "Authorization: Bearer $MCP_TOKEN"</span>
  </p>`;

  for (const card of root.querySelectorAll('.card[data-id]')) {
    const id = card.dataset.id;
    const m = mcps.find((x) => x.id === id);

    card.querySelector('[data-toggle]')?.addEventListener('change', async (e) => {
      try {
        await api(`/mcps/${id}`, { method: 'PATCH', body: { enabled: e.target.checked } });
        toast(`${m.manifest?.name || id} ${e.target.checked ? 'enabled' : 'disabled'}`);
        ctx.refresh();
      } catch (ex) { toast(ex.message, 'err'); e.target.checked = !e.target.checked; }
    });

    card.querySelector('[data-copy]').onclick = async () => {
      await navigator.clipboard.writeText(m.url);
      toast('Endpoint URL copied');
    };

    card.querySelector('[data-caps]')?.addEventListener('click', () => openCapabilities(m));
    card.querySelector('[data-settings]')?.addEventListener('click', () => openSettings(m, ctx));
    card.querySelector('[data-access]')?.addEventListener('click', () => openAccess(m, ctx));
    card.querySelector('[data-code]').onclick = () => openEditor(m, ctx);

    card.querySelector('[data-test]')?.addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true; btn.textContent = '… testing';
      try {
        const r = await api(`/mcps/${id}/test`, { method: 'POST' });
        toast(r.message, r.ok ? 'ok' : 'err', 5200);
      } catch (ex) { toast(ex.message, 'err'); }
      btn.disabled = false; btn.textContent = '▶ Test';
    });

    const skillName = (m.manifest?.slug || id).replace(/_/g, '-');

    card.querySelector('[data-skill]')?.addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true;
      try {
        await download(`/mcps/${id}/skill`, `${skillName}-skill.zip`);
        toast('Skill .zip downloaded — claude.ai → Settings → Capabilities → Skills → Upload', 'ok', 6000);
      } catch (ex) { toast(ex.message, 'err'); }
      btn.disabled = false;
    });

    card.querySelector('[data-skill-link]')?.addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true;
      try {
        const { url } = await api(`/mcps/${id}/skill/share`, { method: 'POST', body: {} });
        await navigator.clipboard.writeText(url);
        toast(`Public link copied (7 days) — tell Claude to fetch it: ${url}`, 'ok', 7000);
      } catch (ex) { toast(ex.message, 'err'); }
      btn.disabled = false;
    });

    card.querySelector('[data-export]')?.addEventListener('click', async (e) => {
      const btn = e.target;
      btn.disabled = true;
      try {
        await download(`/mcps/${id}/export-module`, `${id}-module.zip`);
        toast('Module .zip downloaded — unzip into any station\'s mcps/ folder and hit Reload', 'ok', 6000);
      } catch (ex) { toast(ex.message, 'err'); }
      btn.disabled = false;
    });

    card.querySelector('[data-del]').onclick = async () => {
      if (!await confirmModal('Delete module?', `'${m.manifest?.name || id}' will be moved to data/trash and its settings removed. The endpoint /${m.manifest?.slug || id} goes away immediately.`)) return;
      try {
        await api(`/mcps/${id}`, { method: 'DELETE' });
        toast('Module deleted (copy kept in data/trash)');
        ctx.refresh();
      } catch (ex) { toast(ex.message, 'err'); }
    };
  }
}
