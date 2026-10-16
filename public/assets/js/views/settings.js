import { confirmAction as confirmModal } from './access.js';
import { api } from '../api.js';
import { esc, toast, drawer } from '../ui.js';
import { icon } from '../product.js';
let settingsSequence = 0;

export function openSettings(m, ctx) {
  const prefix = `settings-${++settingsSequence}`;
  const specs = m.manifest?.settings || [];
  const fields = specs.map((s, i) => {
    const cur = m.settings?.[s.key] ?? ''; const id = `${prefix}-${i}`;
    const attrs = `id="${id}" name="${esc(s.key)}" ${s.help ? `aria-describedby="${id}-help"` : ''} ${s.required ? 'aria-required="true"' : ''}`;
    let control;
    if (s.type === 'select') control = `<select class="input" ${attrs}>${(s.options || []).map((o) => `<option value="${esc(o)}" ${o === cur ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
    else if (s.type === 'textarea') control = `<textarea class="input" rows="4" ${attrs}>${esc(cur)}</textarea>`;
    else if (s.type === 'secret') control = `<div class="row"><input class="input" type="password" ${attrs} placeholder="${cur ? 'Saved — leave blank to keep' : 'Not set'}" autocomplete="new-password">${`<button type="button" class="btn sm danger" data-clear="${i}" ${cur ? '' : 'disabled'} aria-label="Clear saved ${esc(s.label || s.key)}">Clear saved value</button>`}</div><div class="help">Blank keeps a saved secret. Clear saved value removes it. Typing a replacement overrides Clear.</div>`;
    else control = `<input class="input" type="text" ${attrs} value="${esc(cur)}">`;
    return `<div class="field"><label for="${id}">${esc(s.label || s.key)}${s.required ? ' *' : ''}</label>${control}${s.help ? `<div class="help" id="${id}-help">${esc(s.help)}</div>` : ''}</div>`;
  }).join('');
  const d = drawer({
    title: `${m.manifest?.name || m.id} — configuration`,
    body: `${!m.manifest || m.error ? `<div class="banner">Load error: ${esc(m.error || 'Manifest unavailable')}. Open Edit code in the library to repair this module, or delete it below.</div>` : ''}<form id="${prefix}-form">${fields || '<p>This module declares no configurable settings.</p>'}</form><div class="field"><label for="${prefix}-endpoint">MCP endpoint</label><input class="input mono" readonly id="${prefix}-endpoint" value="${esc(m.url)}"><div class="help">Use this endpoint in your MCP client. Saving configuration does not prove service connectivity.</div></div><p class="error-text" data-error role="alert"></p><p class="help" data-result role="status"></p>`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn danger" data-del>${icon('logout')}Delete module</button><div class="spacer"></div>${m.manifest ? `<button class="btn" data-test>${icon('arrow')}Save &amp; test</button><button class="btn primary" data-save>Save configuration</button>` : ''}`
  });
  const form = d.el.querySelector('form'); const cleared = new Set(); const savedSecrets = new Set(specs.filter((s) => s.type === 'secret' && m.settings?.[s.key]).map((s) => s.key));
  let dirty = false; let pending = false;
  const error = d.el.querySelector('[data-error]'); const result = d.el.querySelector('[data-result]');
  d.guardClose = () => pending ? false : (!dirty || confirmModal('Discard unsaved settings?', 'Your changes have not been saved.', { confirmLabel: 'Discard changes', danger: true }));
  const closeSaved = () => { dirty = false; (d.forceClose || d.close)(); };
  form.oninput = (e) => {
    dirty = true;
    if (e.target.name && e.target.value !== '') {
      cleared.delete(e.target.name);
      const index = specs.findIndex((s) => s.key === e.target.name);
      const b = d.el.querySelector(`[data-clear="${index}"]`); if (b) b.disabled = false;
    }
  };
  form.onchange = () => { dirty = true; };
  d.el.querySelectorAll('[data-clear]').forEach((b) => { b.onclick = () => {
    const s = specs[Number(b.dataset.clear)]; const input = form.elements.namedItem(s.key);
    input.value = ''; input.placeholder = 'Will be cleared on save'; cleared.add(s.key); dirty = true; b.disabled = true; input.focus();
  }; });
  const setBusy = (busy) => {
    pending = busy; d.el.setAttribute('aria-busy', String(busy));
    d.el.querySelectorAll('button,input,textarea,select').forEach((el) => { if (busy) { el.dataset.savedDisabled = String(el.disabled); el.disabled = true; } else el.disabled = el.dataset.savedDisabled === 'true'; });
  };
  async function save(test) {
    if (pending) return;
    error.textContent = ''; result.textContent = '';
    const values = {};
    for (const s of specs) {
      const input = form.elements.namedItem(s.key); const value = input?.value ?? '';
      values[s.key] = s.type !== 'secret' ? value : value || (cleared.has(s.key) ? '' : savedSecrets.has(s.key) ? '••••••' : '');
      if (s.required && !values[s.key].trim() && !(s.type === 'secret' && cleared.has(s.key))) { error.textContent = `${s.label || s.key} is required.`; input?.focus(); return; }
    }
    setBusy(true); let saved = false;
    try {
      await api(`/mcps/${encodeURIComponent(m.id)}`, { method: 'PATCH', body: { settings: values } });
      saved = true; dirty = false;
      // Rebase saved secret state after every successful save, including Save & test.
      specs.filter((s) => s.type === 'secret').forEach((s) => {
        const input = form.elements.namedItem(s.key);
        if (values[s.key]) savedSecrets.add(s.key); else savedSecrets.delete(s.key);
        input.value = ''; input.placeholder = savedSecrets.has(s.key) ? 'Saved — leave blank to keep' : 'Not set';
        const b = d.el.querySelector(`[data-clear="${specs.indexOf(s)}"]`); if (b) b.dataset.savedDisabled = String(!savedSecrets.has(s.key));
      });
      cleared.clear();
      if (test) {
        result.textContent = 'Configuration saved. Running test…';
        const r = await api(`/mcps/${encodeURIComponent(m.id)}/test`, { method: 'POST' });
        if (r.ok) result.textContent = `Configuration saved. Test passed: ${r.message}`;
        else { result.textContent = ''; error.textContent = `Configuration saved, but the test failed: ${r.message}`; }
      } else { toast('Configuration saved'); closeSaved(); }
    } catch (e) { result.textContent = ''; error.textContent = `${saved ? 'Configuration saved, but the test could not complete: ' : 'Configuration was not saved: '}${e.message}`; }
    finally { setBusy(false); if (saved) await ctx.refresh(); }
  }
  d.el.querySelector('[data-cancel]').onclick = () => d.close();
  d.el.querySelector('[data-save]')?.addEventListener('click', () => save(false));
  d.el.querySelector('[data-test]')?.addEventListener('click', () => save(true));
  form.onsubmit = (e) => { e.preventDefault(); save(false); };
  d.el.querySelector('[data-del]').onclick = async () => {
    if (pending) return;
    setBusy(true); error.textContent = '';
    try {
      if (!await confirmModal('Delete module?', `Delete '${m.manifest?.name || m.id}' and its settings? Its endpoint stops immediately; a code copy is kept in data/trash.`, { confirmLabel: 'Delete module', danger: true })) return;
      await api(`/mcps/${encodeURIComponent(m.id)}`, { method: 'DELETE' }); closeSaved(); toast('Module deleted'); await ctx.refresh();
    } catch (e) { error.textContent = e.message; }
    finally { setBusy(false); }
  };
}
