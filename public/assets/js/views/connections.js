import { esc, copyText } from '../ui.js';
import { icon } from '../icons.js';
import { selected, accountSelect, workspaceUrl, statusOf, testCopy, testAccount } from './accounts.js';
export function renderConnections(root, ctx) {
  root.innerHTML = `<p class="desc">Choose an account, test its service, then copy its endpoint into your AI client. Manage authorization in its Connect workspace.</p><div class="connections-list">${ctx.mcps.map((source) => {
    const m = selected(source,ctx), s = statusOf(m);
    return `<section class="panel connection-row" data-source="${esc(source.id)}"><div class="section-heading"><h2>${esc(source.manifest?.name || source.id)}</h2><span class="status-pill ${s.cls}">${s.label}</span></div>${accountSelect(source,ctx)}<div class="endpoint"><code class="url">${esc(m.url)}</code><button class="btn" data-copy>${icon('copy')}Copy endpoint</button></div><div class="actions"><a class="btn primary" href="${workspaceUrl(source.id,'settings',m.id)}">Configure</a><button class="btn" data-test ${m.manifest ? '' : 'disabled'}>Test connection</button><a class="btn" href="${workspaceUrl(source.id,'connect',m.id)}">Manage access</a></div><p data-result role="status" class="help">${esc(testCopy(m))}</p><p class="help">${Number(m.clients || 0)} authorized clients · ${m.tokenSet ? 'Private token saved' : 'No private token'}. ${!m.enabled ? 'Enable this account in its workspace before connecting.' : ''}</p></section>`;
  }).join('')}</div>${!ctx.mcps.length ? '<section class="empty-state panel"><h2>No services installed</h2><a class="btn primary" href="#/integrations/new">Add an integration</a></section>' : ''}<section class="panel connection-guide"><h2>Add an endpoint to your client</h2><ol class="guide-steps"><li><h3>Prepare the account</h3><p>Configure its required settings, run a test and enable the account.</p></li><li><h3>Copy its endpoint</h3><p>In your client, add a custom MCP connection and paste the URL. For claude.ai: Settings → Connectors → Add custom connector.</p></li><li><h3>Approve access</h3><p>Sign in with your station password when asked. For scripts, open Manage access to create a private account token.</p></li></ol>${!ctx.me.oauth ? '<div class="banner">Browser authorization is unavailable. Configure PUBLIC_URL on the server, or use a private token with a supported client.</div>' : ''}</section>`;
  for (const row of root.querySelectorAll('[data-source]')) {
    const source = ctx.mcps.find((s) => s.id === row.dataset.source), m = selected(source,ctx);
    row.querySelector('[data-account]').onchange = (e) => { ctx.accountSelection.set(source.id,e.target.value); renderConnections(root,ctx); root.querySelector(`[data-source="${CSS.escape(source.id)}"] [data-account]`).focus({ preventScroll:true }); };
    row.querySelector('[data-copy]').onclick = () => copyText(m.url,'Endpoint copied');
    row.querySelector('[data-test]').onclick = (e) => testAccount(m,e.currentTarget,row.querySelector('[data-result]'),ctx);
  }
}
