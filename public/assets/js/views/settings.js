import { icon } from '../icons.js';
import { api } from '../api.js';
import { esc, toast, workspaceSurface, confirmModal } from '../ui.js';

export function openSettings(m, ctx, target) {
  // A module whose manifest failed to load has nothing to configure — but it still needs a way out.
  if (!m.manifest) return openBroken(m, ctx, target);
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
        <button type="button" class="btn sm danger" data-clear="${esc(s.key)}" title="Remove saved value" ${cur ? '' : 'disabled'}>Clear</button>
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

  const d = workspaceSurface({
    target,
    title: `${m.manifest.name} · Configuration`,
    body: `${m.error ? `<div class="banner">This integration could not load: ${esc(m.error)} — fix it in Edit code (the Assistant can help diagnose the error), or delete it below.</div>` : ''}
      <p class="desc">Connect this service by saving its settings. Required fields are marked *. Saved secrets stay unchanged unless you replace or clear them.</p><form id="setForm">${fields}<p class="error-text" data-form-error role="alert"></p></form>
      <div class="field" style="margin-top:18px">
        <label>Endpoint</label>
        <div class="endpoint"><span class="url mono">${esc(m.url)}</span></div>
        <div class="help">Add this URL in claude.ai → Settings → Connectors → Add custom connector.</div>
      </div>`,
    foot: `<button class="btn" data-cancel>Cancel</button>
           <button class="btn danger" data-del title="Delete this module (a copy is kept in data/trash)">${icon('trash')}${m.id !== (m.sourceId || m.id) ? 'Remove account' : 'Delete integration'}</button>
           <div class="spacer"></div>
           <button class="btn" data-test>${icon('test')}Save &amp; test</button>
           <button class="btn primary" data-save>Save</button>`
  });
  wireDelete(d, m, ctx, target);

  d.el.querySelector('#setForm').onsubmit = (e) => { e.preventDefault(); d.el.querySelector('[data-save]').click(); };
  const cleared = new Set();
  let dirty = false;
  d.el.stationDirty = () => dirty;
  d.el.stationBeforeClose = async () => !dirty || await confirmModal('Discard unsaved settings?', 'Your changes have not been saved.', 'Discard changes');
  d.el.querySelector('#setForm').addEventListener('input', () => { dirty = true; });
  d.el.querySelector('#setForm').addEventListener('change', () => { dirty = true; });
  d.el.querySelectorAll('[data-clear]').forEach((b) => {
    b.onclick = () => {
      dirty = true;
      cleared.add(b.dataset.clear);
      const input = b.closest('.row').querySelector('input');
      input.value = '';
      input.placeholder = 'Will be removed when you save';
      b.disabled = true;
    };
  });

  async function collectAndSave() {
    d.el.querySelector('[data-form-error]').textContent = '';
    const form = d.el.querySelector('#setForm');
    const values = {};
    for (const s of m.manifest.settings || []) {
      const el = form.elements.namedItem(s.key);
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
    await api(`/mcps/${encodeURIComponent(m.id)}`, { method: 'PATCH', body: { settings: values } });
    m.settings = { ...values };
    for (const setting of m.manifest.settings || []) {
      if (setting.type === 'secret') {
        m.settings[setting.key] = values[setting.key] ? '••••••' : '';
        const input = form.elements.namedItem(setting.key);
        input.value = '';
        input.placeholder = values[setting.key] ? '•••••• (saved — leave blank to keep)' : 'not set';
      }
    }
    cleared.clear(); dirty = false;
    d.el.querySelectorAll('[data-clear]').forEach((b) => { b.disabled = !m.settings[b.dataset.clear]; });
  }

  d.el.querySelector('[data-cancel]').onclick = d.close;
  d.el.querySelector('[data-save]').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      await collectAndSave();
      toast('Settings saved');
      if (!target) d.close();
      await ctx.refresh();
    } catch (ex) { d.el.querySelector('[data-form-error]').textContent = ex.message; }
    finally { b.disabled = false; }
  };
  d.el.querySelector('[data-test]').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      await collectAndSave();
      const r = await api(`/mcps/${m.id}/test`, { method: 'POST' });
      d.el.querySelector('[data-form-error]').textContent = `${r.ok ? 'Test passed' : 'Test failed'}: ${r.message}`;
      toast(r.message, r.ok ? 'ok' : 'err', 6000);
      ctx.refresh();
    } catch (ex) { toast(ex.message, 'err'); }
    b.disabled = false;
  };
}

/** Destructive operations belong in Settings, never the everyday library actions. */
function wireDelete(d, m, ctx, target) {
  d.el.querySelector('[data-del]').onclick = async () => {
    const name = m.manifest?.name || m.id;
    const account = m.id !== (m.sourceId || m.id);
    if (!await confirmModal(account ? 'Remove account?' : 'Delete module?', account ? `Remove ${m.name || name} and its credentials and access? Shared source and other accounts stay unchanged.` : `'${name}' will be moved to data/trash and its settings removed. Remove additional accounts first. This endpoint goes away immediately.`)) return;
    try {
      await api(account ? `/mcps/${encodeURIComponent(m.sourceId)}/instances/${encodeURIComponent(m.id)}` : `/mcps/${encodeURIComponent(m.id)}`, { method: 'DELETE' });
      toast(account ? 'Account removed' : 'Module deleted (copy kept in data/trash)');
      d.el.stationBeforeClose = null;
      if (target) location.hash = '/integrations';
      if (!target) d.close();
      await ctx.refresh();
    } catch (ex) { toast(ex.message, 'err'); }
  };
}

/** Failed sources remain repairable from Code and removable after confirmation. */
function openBroken(m, ctx, target) {
  const d = workspaceSurface({
    target,
    title: `${m.id} · Load error`,
    body: `<div class="banner">${esc(m.error || 'Unknown load error')}</div>
      <p class="desc">Fix the file in <b>Edit code</b> (the Assistant can read the error and help repair the integration), or delete the module.</p>`,
    foot: `<button class="btn" data-cancel>Close</button>
           <button class="btn danger" data-del>${icon('trash')}${m.id !== (m.sourceId || m.id) ? 'Remove account' : 'Delete integration'}</button>
           <div class="spacer"></div>`
  });
  d.el.querySelector('[data-cancel]').onclick = d.close;
  wireDelete(d, m, ctx, target);
}
