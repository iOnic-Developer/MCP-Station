import { api } from '../api.js';
import { esc, toast, modal } from '../ui.js';

export function openAddNew(ctx) {
  const base = String(ctx.me?.publicUrl || location.origin).replace(/\/$/, '');
  const dlg = modal({
    title: 'Add a module',
    body: `<p>Create a starting point, not a working integration. Implement its tools in Edit code, configure the service, then run Test.</p><form id="new-module-form"><div class="field"><label for="nName">Module name <span class="req">*</span></label><input class="input" id="nName" placeholder="Weather" required autofocus></div><div class="field"><label for="nSlug">Endpoint slug <span class="req">*</span></label><input class="input mono" id="nSlug" placeholder="weather_mcp" required pattern="[a-z0-9_\\-]+" aria-describedby="slug-help endpoint-preview"><div class="help" id="slug-help">Lowercase letters, digits, underscores and hyphens only. Reserved or existing paths will be rejected.</div><div class="help mono" id="endpoint-preview">${esc(base)}/&lt;slug&gt;/mcp</div></div><div class="field"><label for="nIcon">Module icon (optional emoji)</label><input class="input" id="nIcon" maxlength="16"></div><div class="field"><label for="nDesc">Description</label><textarea class="input" id="nDesc" rows="3" placeholder="What will this module do?"></textarea></div><p class="error-text" id="nErr" role="alert"></p></form>`,
    foot: '<button class="btn" data-cancel>Cancel</button><button class="btn primary" type="submit" form="new-module-form" data-create>Create template</button>'
  });
  const name = dlg.querySelector('#nName'); const slug = dlg.querySelector('#nSlug'); const form = dlg.querySelector('form');
  let slugTouched = false; let pending = false;
  const preview = () => { dlg.querySelector('#endpoint-preview').textContent = `${base}/${slug.value || '<slug>'}/mcp`; };
  slug.oninput = () => { slugTouched = true; preview(); };
  name.oninput = () => { if (!slugTouched) { slug.value = name.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + (name.value.trim() ? '_mcp' : ''); preview(); } };
  dlg.querySelector('[data-cancel]').onclick = () => { if (!pending) dlg.close(); };
  dlg.addEventListener('cancel', (e) => { if (pending) e.preventDefault(); });
  form.onsubmit = async (e) => {
    e.preventDefault(); if (pending || !form.reportValidity()) return;
    const err = dlg.querySelector('#nErr'); err.textContent = '';
    if (!name.value.trim() || !/^[a-z0-9_-]+$/.test(slug.value)) { err.textContent = 'Enter a name and a valid endpoint slug.'; return; }
    const body = { name: name.value.trim(), slug: slug.value, icon: dlg.querySelector('#nIcon').value.trim() || '🔌', description: dlg.querySelector('#nDesc').value.trim() };
    pending = true; form.setAttribute('aria-busy', 'true'); dlg.querySelectorAll('input,textarea,button').forEach((b) => { b.disabled = true; });
    try { await api('/mcps', { method: 'POST', body }); toast('Template created. Open Edit code to implement the integration.', 'ok', 6000); dlg.close(); await ctx.refresh(); }
    catch (ex) { err.textContent = ex.message; }
    finally { pending = false; form.setAttribute('aria-busy', 'false'); dlg.querySelectorAll('input,textarea,button').forEach((b) => { b.disabled = false; }); }
  };
}
