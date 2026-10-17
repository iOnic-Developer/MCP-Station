import { api, download } from '../api.js';
import { esc, toast, copyText, confirmModal } from '../ui.js';
import { icon } from '../icons.js';
import { accounts, selected, accountSelect, workspaceUrl, testCopy, testAccount } from './accounts.js';
import { openSettings } from './settings.js';
import { openAccess } from './access.js';
import { openCapabilities } from './capabilities.js';
import { openEditor } from './editor.js';
import { renderUsage } from './usage.js';
import { renderModuleAssistant } from './moduleAssistant.js';
import { openSourceTask } from './addNew.js';
const tabs = [['settings','Settings'],['connect','Connect'],['tools','Tools'],['code','Code'],['activity','Activity'],['assistant','Assistant']];
export async function renderIntegration(root, ctx, route) {
  const source = ctx.mcps.find((s) => s.id === route.sourceId);
  if (!source) { root.innerHTML = '<section class="empty-state panel"><h1>Integration not found</h1><a class="btn" href="#/integrations">Back to integrations</a></section>'; return; }
  if (route.tab === 'add-account') return renderAddAccount(root,ctx,source.id);
  if (!tabs.some(([id]) => id === route.tab)) { root.innerHTML = '<p role="alert">Unknown workspace tab.</p><a href="#/integrations">Back to integrations</a>'; return; }
  if (route.account && !accounts(source).some((a) => a.id === route.account)) { root.innerHTML = `<p role="alert">This account no longer exists for this service.</p><a href="${workspaceUrl(source.id)}">Open default account</a>`; return; }
  let m = selected(source,ctx,route.account);
  const name = source.manifest?.name || source.id;
  root.innerHTML = `<a class="back-link" href="#/integrations">← Back to integrations</a><header class="module-heading"><div><h1>${esc(name)}</h1><p class="help">Account settings are independent · Code is shared across all accounts.</p></div><div class="actions ai-source-actions" aria-label="AI source actions"><button class="btn" data-ai-fix>${icon('assistant')}Fix something</button><button class="btn action-accent" data-ai-modify>${icon('assistant')}Change or extend</button></div></header><p class="help ai-source-note">AI actions prepare a request for review before Send. Source changes affect every account; credentials stay in Settings.</p><section class="workspace-endpoint panel" aria-label="Account and endpoint actions"><div class="workspace-account">${accountSelect(source,ctx)}<a class="btn" href="${workspaceUrl(source.id,'add-account')}" aria-label="Add account for ${esc(name)}">${icon('plus')}Add account</a></div><div class="endpoint"><code class="url" title="${esc(m.url)}" tabindex="0" aria-label="Endpoint: ${esc(m.url)}">${esc(m.url)}</code><button class="btn" data-copy aria-label="Copy endpoint">${icon('copy')}<span>Copy</span></button></div><button class="btn action-accent" data-workspace-test ${m.manifest ? '' : 'disabled'}>${icon('test')}Test connection</button><label class="enable-control"><input type="checkbox" role="switch" data-enable ${m.enabled ? 'checked' : ''} ${m.error ? 'disabled' : ''} aria-label="Enable ${esc(m.name)}"><span class="switch-track"></span><span>Enabled</span></label><p data-workspace-result class="help" role="status">${esc(testCopy(m))}</p></section><nav class="workspace-tabs" aria-label="Integration workspace sections">${tabs.map(([id,label]) => `<a class="btn ${route.tab === id ? 'active' : ''}" ${route.tab === id ? 'aria-current="page"' : ''} href="${workspaceUrl(source.id,id,m.id)}">${label}</a>`).join('')}</nav><div data-workspace-surface></div>`;
  for (const [selector, intent] of [['[data-ai-fix]', 'fix'], ['[data-ai-modify]', 'modify']]) {
    root.querySelector(selector).onclick = async (event) => {
      const button = event.currentTarget; button.disabled = true;
      try { await openSourceTask(source, intent); }
      catch (err) { toast(err.message, 'err'); }
      finally { button.disabled = false; }
    };
  }
  const target = root.querySelector('[data-workspace-surface]'); target.dataset.back = '/integrations';
  const update = () => {
    const fresh = ctx.mcps.find((s) => s.id === source.id);
    if (!root.isConnected || !fresh) return;
    m = selected(fresh,ctx,m.id);
    root.querySelector('[data-enable]').checked = Boolean(m.enabled);
    root.querySelector('[data-enable]').disabled = Boolean(m.error);
    const url = root.querySelector('.workspace-endpoint .url');
    url.textContent = m.url; url.title = m.url; url.setAttribute('aria-label', `Endpoint: ${m.url}`);
    root.querySelector('[data-workspace-result]').textContent = testCopy(m);
  };
  ctx.workspaceRefresh = () => { update(); target.querySelector('[data-module-assistant]')?.stationRefresh?.(); }; update();
  root.querySelector('[data-account]').onchange = (e) => { location.hash = workspaceUrl(source.id,route.tab,e.target.value).slice(1); };
  root.querySelector('[data-copy]').onclick = () => copyText(m.url,'Endpoint copied. Add it to your client when this account is configured and enabled.');
  root.querySelector('[data-workspace-test]').onclick = (e) => testAccount(m,e.currentTarget,root.querySelector('[data-workspace-result]'),ctx);
  root.querySelector('[data-enable]').onchange = async (e) => {
    const b = e.target; b.disabled = true;
    try { await api(`/mcps/${encodeURIComponent(m.id)}`,{ method:'PATCH',body:{enabled:b.checked} }); await ctx.refresh(); }
    catch (err) { toast(err.message,'err'); b.checked = !b.checked; }
    finally { b.disabled = Boolean(m.error); }
  };
  target.innerHTML = '<p role="status">Loading workspace…</p>';
  if (route.tab === 'settings') openSettings(m,ctx,target);
  if (route.tab === 'connect') await openAccess(m,ctx,target);
  if (route.tab === 'tools') await openCapabilities(m,target);
  if (route.tab === 'code') await openEditor(source,ctx,target);
  if (route.tab === 'activity') renderUsage(target,m.id);
  if (route.tab === 'assistant') await renderModuleAssistant(target, source, ctx);
  if (!root.isConnected) return;
  if (route.tab === 'tools' || route.tab === 'code') {
    const extras = document.createElement('section'); extras.className = 'panel workspace-portability';
    extras.innerHTML = '<h2>Share and portability</h2><p class="help">Source exports include shared code, not account credentials. A generated skill points at the selected account.</p><div class="actions"><button class="btn" data-export>Export shared source</button><button class="btn" data-skill>Download account skill</button><button class="btn" data-share>Share skill link</button></div>';
    root.appendChild(extras);
    extras.querySelector('[data-export]').onclick = () => perform(() => download(`/mcps/${encodeURIComponent(source.id)}/export-module`,`${source.id}-module.zip`));
    extras.querySelector('[data-skill]').onclick = () => perform(() => download(`/mcps/${encodeURIComponent(m.id)}/skill`,`${m.id}-skill.zip`));
    extras.querySelector('[data-share]').onclick = async () => {
      if (!await confirmModal('Create a public skill link?','Anyone with this link can read the generated skill for 7 days. It may describe your endpoint and tools. Sharing does not grant endpoint access.','Create public link')) return;
      await perform(async () => { const {url} = await api(`/mcps/${encodeURIComponent(m.id)}/skill/share`,{method:'POST',body:{}}); await copyText(url,'Public skill link copied. Expires in 7 days.'); });
    };
  }
}
async function perform(fn) { try { await fn(); } catch (e) { toast(e.message,'err'); } }
export function renderAddAccount(root,ctx,sourceId = '') {
  root.innerHTML = `<a class="back-link" href="#/integrations">← Back to integrations</a><div class="page-heading"><div><p class="eyebrow">Connect another account</p><h1>Add an account</h1><p class="page-description">Reuse an installed service with separate settings and its own endpoint. No credentials are copied.</p></div></div><section class="panel account-create"><form data-create-account><div class="field"><label for="accountService">Which service do you want to connect?</label><select id="accountService" class="input" required><option value="">Choose an installed service</option>${ctx.mcps.filter((m) => m.manifest && !m.error).map((m) => `<option value="${esc(m.id)}" ${sourceId === m.id ? 'selected' : ''}>${esc(m.manifest.name)}</option>`).join('')}</select></div><div class="field"><label for="accountName">Account name</label><input class="input" id="accountName" required maxlength="100" placeholder="e.g. Work or Personal" autocomplete="off"><p class="help">A name you recognize. Your endpoint address is created automatically.</p></div><p class="error-text" data-create-error role="alert"></p><button class="btn primary" type="submit">Continue to settings ${icon('arrow')}</button></form></section><section class="panel workspace-portability"><h2>Need a different service?</h2><p class="desc">Describe a new service and build its tools with AI before configuring an account.</p><a class="btn action-accent" href="#/integrations/new">${icon('assistant')}Create an MCP with AI</a></section>`;
  const form = root.querySelector('[data-create-account]');
  form.onsubmit = async (e) => {
    e.preventDefault(); const button = form.querySelector('button'); button.disabled = true;
    const id = root.querySelector('#accountService').value;
    try {
      const {instance} = await api(`/mcps/${encodeURIComponent(id)}/instances`,{method:'POST',body:{name:root.querySelector('#accountName').value.trim()}});
      ctx.accountSelection ||= new Map(); ctx.accountSelection.set(id,instance.id);
      await ctx.refresh(); location.hash = workspaceUrl(id,'settings',instance.id).slice(1);
      toast('Account created blank and disabled. Add its settings, then test the connection.');
    } catch (err) { root.querySelector('[data-create-error]').textContent = err.message; }
    finally { button.disabled = false; }
  };
}
