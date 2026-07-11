import { api } from '../api.js';
import { toast, modal } from '../ui.js';

export function openAddNew(ctx) {
  const dlg = modal({
    title: '➕ Add a new MCP',
    body: `
      <div class="field"><label>Name</label><input class="input" id="nName" placeholder="Weather" autofocus></div>
      <div class="field"><label>Slug (URL path)</label><input class="input mono" id="nSlug" placeholder="weather_mcp">
        <div class="help">Endpoint becomes <span class="mono">${location.origin}/&lt;slug&gt;</span> — lowercase, digits, _ or -.</div></div>
      <div class="field"><label>Icon (emoji)</label><input class="input" id="nIcon" placeholder="🌦️" maxlength="4"></div>
      <div class="field"><label>Description</label><input class="input" id="nDesc" placeholder="What this MCP does"></div>
      <div class="error-text" id="nErr"></div>`,
    foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" data-create>Create from template</button>`
  });

  const name = dlg.querySelector('#nName');
  const slug = dlg.querySelector('#nSlug');
  let slugTouched = false;
  slug.oninput = () => { slugTouched = true; };
  name.oninput = () => {
    if (!slugTouched) slug.value = name.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + (name.value ? '_mcp' : '');
  };

  dlg.querySelector('[data-cancel]').onclick = () => dlg.close();
  dlg.querySelector('[data-create]').onclick = async () => {
    const err = dlg.querySelector('#nErr');
    err.textContent = '';
    try {
      await api('/mcps', {
        method: 'POST',
        body: {
          name: name.value.trim() || slug.value.trim(),
          slug: slug.value.trim(),
          icon: dlg.querySelector('#nIcon').value.trim() || '🔌',
          description: dlg.querySelector('#nDesc').value.trim()
        }
      });
      toast('Module created from template — open its Code to build the tools (ask the ✦ popup!)', 'ok', 5200);
      dlg.close();
      ctx.refresh();
    } catch (ex) {
      err.textContent = ex.message;
    }
  };
}
