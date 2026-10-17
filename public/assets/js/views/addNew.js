import { api } from '../api.js';
import { toast, surface, confirmModal } from '../ui.js';
import { icon } from '../icons.js';
import { getSourceSession, stageDraft } from '../chatSessions.js';
export function openAddNew(ctx, target) {
  const dlg = surface({ target, title: 'Create manually', body: `<p class="desc">Advanced: create a disabled, empty starter for the code editor. This does not build tools or verify a connection.</p><form id="newIntegration"><div class="field"><label for="nName">Integration name</label><input class="input" id="nName" name="name" placeholder="e.g. Weather" required autofocus maxlength="100"></div><div class="field"><label for="nSlug">Endpoint path</label><input class="input mono" id="nSlug" name="slug" placeholder="weather_mcp" pattern="[a-z0-9_-]+" required><div class="help">A unique URL path: lowercase letters, numbers, underscores and hyphens. You can copy the full endpoint after creating it.</div></div><div class="field"><label for="nDesc">What will it do? <span class="dim">(optional)</span></label><textarea class="input" rows="3" id="nDesc" name="description" placeholder="Find the current forecast for a location"></textarea></div><p class="error-text" id="nErr" role="alert"></p></form>`, foot: `<button class="btn" data-cancel>Cancel</button><button class="btn primary" type="submit" form="newIntegration">${icon('plus')}Create manual starter</button>` });
  const form = dlg.querySelector('form'), name = dlg.querySelector('#nName'), slug = dlg.querySelector('#nSlug'), button = dlg.querySelector('[type=submit]');
  let slugTouched = false, created = null;
  slug.oninput = () => { slugTouched = true; };
  name.oninput = () => { if (!slugTouched) slug.value = name.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') + (name.value ? '_mcp' : ''); };
  dlg.querySelector('[data-cancel]').onclick = () => dlg.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = dlg.querySelector('#nErr'); err.textContent = ''; button.disabled = true; button.textContent = 'Creating…';
    try {
      created ||= await api('/mcps', { method: 'POST', body: { name: name.value.trim(), slug: slug.value.trim(), icon: '🔌', description: dlg.querySelector('#nDesc').value.trim(), enabled: false } });
      await api(`/mcps/${encodeURIComponent(created.id)}`, { method: 'PATCH', body: { enabled: false } });
      toast('Manual starter created and disabled. Build its tools in Code; configure and test before enabling.', 'ok', 7000); dlg.close(); await ctx.refresh();
    } catch (ex) { err.textContent = `${created?.id ? `Starter ${created.id} already exists; disabling may not have completed. Retry continues with it. ` : ''}${ex.message}`; }
    finally { button.disabled = false; button.innerHTML = `${icon('plus')}${created ? 'Retry disabling starter' : 'Create manual starter'}`; }
  };
}

/** Source-only intents: never copy settings, test payloads or credentials into chat. */
export async function openSourceTask(source, intent) {
  const session = await getSourceSession(source);
  if (session.chat.input.value.trim() && !await confirmModal('Replace the Assistant draft?', 'This source already has an unsent draft. Its conversation and running work will be kept.', 'Replace draft')) return;
  const task = intent === 'fix'
    ? 'Help me diagnose and fix a problem in this service. Ask what is going wrong and what I expected before changing code. Inspect the source and latest test/configuration status without printing settings values, credentials or raw test output into chat. Explain the root cause and propose the smallest safe fix.'
    : 'Help me change or extend this service. Ask which behavior or tools I want before editing. Read the existing source and authoritative API documentation; preserve existing behavior unless I explicitly request otherwise.';
  await stageDraft(`source:${source.id}`, `Work only on source ${JSON.stringify(source.id)} (${JSON.stringify(source.manifest?.name || source.id)}). ${task} Changes to source code affect every account of this service. Do not copy credentials between accounts, enable accounts, or perform destructive live operations. Use the existing backend file tools for agreed changes and report what was actually verified. Credentials belong in Settings, not chat.`);
  location.hash = session.href;
  toast('Request prepared. Add details, then press Send to start.');
}
