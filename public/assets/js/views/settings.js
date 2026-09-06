import { api } from '../api.js';
import { esc, toast, drawer, confirmModal } from '../ui.js';

export function openSettings(m, ctx) {
  // A module whose manifest failed to load has nothing to configure — but it still needs a way out.
  if (!m.manifest) return openBroken(m, ctx);
  const fields = (m.manifest.settings || []).map((s) => {
    const cur = m.settings?.[s.key] ?? '';
    let control;
    if (s.type === 'select') {
      control = `<select class="input" name="${esc(s.key)}">${(s.options || []).map((o) =>
        `<option value="${esc(o)}" ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    } else if (s.type === 'textarea') {
      control = `<textarea class="input" rows="4" name="${esc(s.key)}">${esc(cur)}</textarea>`;
    } else if (s.type === 'secret') {
      control = `<div class="row">
        <input class="input" type="password" name="${esc(s.key)}" placeholder="${cur ? '•••••• (saved — leave blank to keep)' : 'not set'}" autocomplete="new-password">
        ${cur ? `<button type="button" class="btn sm danger" data-clear="${esc(s.key)}" title="Remove saved value">Clear</button>` : ''}
      </div>`;
    } else {
      control = `<input class="input" type="text" name="${esc(s.key)}" value="${esc(cur)}">`;
    }
    return `<div class="field">
      <label>${esc(s.label)}${s.required ? ' *' : ''}</label>
      ${control}
      ${s.help ? `<div class="help">${esc(s.help)}</div>` : ''}
    </div>`;
  }).join('') || '<p class="desc">This module declares no settings in its manifest.</p>';

  const d = drawer({
    title: `${m.manifest.icon} ${m.manifest.name} — settings`,
    body: `${m.error ? `<div class="banner">⚠️ This module currently fails to load: ${esc(m.error)} — fix it in ‹/› Code (the ✦ chat there sees the error), or delete it below.</div>` : ''}
      <form id="setForm">${fields}</form>
      <div class="field" style="margin-top:18px">
        <label>Endpoint</label>
        <div class="endpoint"><span class="url mono">${esc(m.url)}</span></div>
        <div class="help">Add this URL in claude.ai → Settings → Connectors → Add custom connector.</div>
      </div>`,
    foot: `<button class="btn" data-cancel>Cancel</button>
           <button class="btn danger" data-del title="Delete this module (a copy is kept in data/trash)">🗑 Delete</button>
           <div class="spacer"></div>
           <button class="btn" data-test>▶ Save &amp; test</button>
           <button class="btn primary" data-save>Save</button>`
  });
  wireDelete(d, m, ctx);

  const cleared = new Set();
  d.el.querySelectorAll('[data-clear]').forEach((b) => {
    b.onclick = () => {
      cleared.add(b.dataset.clear);
      b.closest('.row').querySelector('input').placeholder = 'will be cleared on save';
      b.disabled = true;
    };
  });

  async function collectAndSave() {
    const form = d.el.querySelector('#setForm');
    const values = {};
    for (const s of m.manifest.settings || []) {
      const el = form.elements[s.key];
      if (!el) continue;
      const v = el.value;
      if (s.type === 'secret') {
        if (cleared.has(s.key)) values[s.key] = '';
        else if (v === '') { if (m.settings?.[s.key]) values[s.key] = '••••••'; else values[s.key] = ''; }
        else values[s.key] = v;
      } else {
        values[s.key] = v;
      }
    }
    await api(`/mcps/${m.id}`, { method: 'PATCH', body: { settings: values } });
  }

  d.el.querySelector('[data-cancel]').onclick = d.close;
  d.el.querySelector('[data-save]').onclick = async () => {
    try {
      await collectAndSave();
      toast('Settings saved');
      d.close();
      ctx.refresh();
    } catch (ex) { toast(ex.message, 'err'); }
  };
  d.el.querySelector('[data-test]').onclick = async (e) => {
    e.target.disabled = true;
    try {
      await collectAndSave();
      const r = await api(`/mcps/${m.id}/test`, { method: 'POST' });
      toast(r.message, r.ok ? 'ok' : 'err', 6000);
      ctx.refresh();
    } catch (ex) { toast(ex.message, 'err'); }
    e.target.disabled = false;
  };
}

/** The delete button lives in the settings drawer (it used to sit on every card). */
function wireDelete(d, m, ctx) {
  d.el.querySelector('[data-del]').onclick = async () => {
    const name = m.manifest?.name || m.id;
    if (!await confirmModal('Delete module?', `'${name}' will be moved to data/trash and its settings removed. The endpoint /${m.manifest?.slug || m.id} goes away immediately.`)) return;
    try {
      await api(`/mcps/${m.id}`, { method: 'DELETE' });
      toast('Module deleted (copy kept in data/trash)');
      d.close();
      ctx.refresh();
    } catch (ex) { toast(ex.message, 'err'); }
  };
}

/** Settings drawer for a module that failed to load: the error, and the way out. */
function openBroken(m, ctx) {
  const d = drawer({
    title: `⚠️ ${m.id} — failed to load`,
    body: `<div class="banner">${esc(m.error || 'Unknown load error')}</div>
      <p class="desc">Fix the file in <b>‹/› Code</b> (the ✦ chat there can see the error and edit the module), or delete the module.</p>`,
    foot: `<button class="btn" data-cancel>Close</button>
           <button class="btn danger" data-del>🗑 Delete</button>
           <div class="spacer"></div>`
  });
  d.el.querySelector('[data-cancel]').onclick = d.close;
  wireDelete(d, m, ctx);
}
