import { api } from '../api.js';
import { toast, surface } from '../ui.js';
import { icon } from '../icons.js';
export function openAddNew(ctx, target) {
  const dlg = surface({ target, title: 'Add an integration', body: `<p class="desc">Start with a name. We’ll create a private module template you can build on in the code editor or with the Assistant.</p><form id="newIntegration"><div class="field"><label for="nName">Integration name</label><input class="input" id="nName" name="name" placeholder="e.g. Weather" required autofocus maxlength="100"></div><div class="field"><label for="nSlug">Endpoint path</label><input class="input mono" id="nSlug" name="slug" placeholder="weather_mcp" pattern="[a-z0-9_-]+" required><div class="help">A unique URL path: lowercase letters, numbers, underscores and hyphens. You can copy the full endpoint after creating it.</div></div><div class="field"><label for="nDesc">What will it do? <span class="dim">(optional)</span></label><textarea class="input" rows="3" id="nDesc" name="description" placeholder="Find the current forecast for a location"></textarea></div><p class="error-text" id="nErr" role="alert"></p></form>`, foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" type="submit" form="newIntegration">${icon('plus')}Create integration</button>` });
  const form = dlg.querySelector('form'), name = dlg.querySelector('#nName'), slug = dlg.querySelector('#nSlug'), button = dlg.querySelector('[type=submit]');
  let slugTouched = false;
  slug.oninput = () => { slugTouched = true; };
  name.oninput = () => { if (!slugTouched) slug.value = name.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + (name.value ? '_mcp' : ''); };
  dlg.querySelector('[data-cancel]').onclick = () => dlg.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = dlg.querySelector('#nErr'); err.textContent = ''; button.disabled = true; button.textContent = 'Creating…';
    try {
      await api('/mcps', { method: 'POST', body: { name: name.value.trim(), slug: slug.value.trim(), icon: '🔌', description: dlg.querySelector('#nDesc').value.trim() } });
      toast('Integration created. Open Edit code to build its tools, or ask the Assistant.', 'ok', 7000); dlg.close(); ctx.refresh();
    } catch (ex) { err.textContent = ex.message; }
    finally { button.disabled = false; button.innerHTML = `${icon('plus')}Create integration`; }
  };
}
