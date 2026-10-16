import { esc } from './ui.js';

const paths = {
  overview: '<path d="M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z"/>',
  modules: '<path d="m12 3 9 5-9 5-9-5zM3 12l9 5 9-5M3 16l9 5 9-5"/>',
  connections: '<path d="M9 8H7a4 4 0 0 0 0 8h2m6-8h2a4 4 0 0 1 0 8h-2M8 12h8"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6M9 15v6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 4 2c-1 .7-1.5 1-1.5 3m0 3h.01"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  reload: '<path d="M20 10a8 8 0 1 0-1 7M20 4v6h-6"/>',
  backup: '<path d="M4 9h16v11H4zM3 4h18v5H3zM9 13h6"/>',
  arrow: '<path d="M5 12h14m-6-6 6 6-6 6"/>',
  assistant: '<path d="M4 4h16v12H9l-5 4zM8 8h8m-8 4h5"/>',
  logout: '<path d="M10 4H4v16h6m4-13 5 5-5 5m-5-5h10"/>'
};
export function icon(name) {
  return `<svg class="station-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${paths[name] || paths.modules}</svg>`;
}
export const destinations = ['overview', 'modules', 'connections', 'settings', 'help'];
export const titleOf = (route) => route.charAt(0).toUpperCase() + route.slice(1);
export function counts(mcps) {
  return {
    total: mcps.length,
    ready: mcps.filter((m) => m.enabled && m.configured && !m.error).length,
    attention: mcps.filter((m) => m.error || !m.configured || m.lastTest?.ok === false).length,
    disabled: mcps.filter((m) => !m.enabled).length
  };
}
export function inventoryNotice(ctx) {
  if (ctx.inventoryState === 'error') return `<div class="banner" role="status"><p>${esc(ctx.inventoryError || 'Module inventory unavailable. Please retry.')}${ctx.inventoryLoaded ? ' Showing the last successful inventory; it may be stale.' : ' No inventory counts are available.'}</p><button class="btn" data-action="inventory-retry">Retry inventory</button></div>`;
  if (ctx.inventoryState === 'loading') return `<p role="status">${ctx.inventoryLoaded ? 'Refreshing module inventory — showing the last successful data.' : 'Loading module inventory…'}</p>`;
  return '';
}
export function overview(ctx) {
  const known = ctx.inventoryLoaded || ctx.inventoryState === 'ready';
  const n = known ? counts(ctx.mcps) : null;
  return `<div class="page-intro"><div><p class="eyebrow">YOUR INTEGRATION CONTROL PLANE</p><h1 tabindex="-1">A clear path from API to AI.</h1><p>Add a module, configure its service, test it, then connect your MCP client.</p></div><button class="btn primary" data-action="add">${icon('plus')}Add module</button></div>
    ${inventoryNotice(ctx)}
    <div class="metric-grid" aria-label="Module inventory">${[[n?.total ?? '—', 'Installed modules'], [n?.ready ?? '—', 'Enabled & configured'], [n?.attention ?? '—', 'Need attention'], [n?.disabled ?? '—', 'Disabled']].map(([v, label]) => `<div class="metric"><strong>${v}</strong><span>${label}</span></div>`).join('')}</div>
    <section class="panel getting-started"><div class="section-heading"><div><p class="eyebrow">THE WORKFLOW</p><h2>Build the connection. Keep control.</h2></div><a href="#/help">Read the guide ${icon('arrow')}</a></div><ol class="workflow">${[
      ['Add', 'Create a module from the template or import a shared module.'],
      ['Configure', 'Enter service URLs and credentials in the module’s settings.'],
      ['Test', 'Run its test and inspect the tools before enabling access.'],
      ['Connect', 'Use its endpoint and choose narrowly scoped access.']
    ].map(([name, text], i) => `<li><span class="step-number">0${i + 1}</span><h3>${name}</h3><p>${text}</p></li>`).join('')}</ol></section>
    <div class="split-grid"><section class="panel"><p class="eyebrow">MODULE OPERATIONS</p><h2>${ctx.inventoryState !== 'ready' ? 'Your module inventory.' : n.total ? 'Your modules, in one place.' : 'Start with your first module.'}</h2><p>${ctx.inventoryState !== 'ready' ? 'Load the module inventory to review configuration and test results.' : n.total ? 'Review configuration, load errors and test results in the module library. Enabled and configured does not guarantee a service is reachable.' : 'A module is a small folder that turns a service API into tools your MCP client can use.'}</p><a class="btn" href="#/modules">Open module library ${icon('arrow')}</a></section><section class="panel"><p class="eyebrow">ACCESS POSTURE</p><h2>Connect deliberately.</h2><dl class="status-list"><div><dt>OAuth</dt><dd>${ctx.me.oauth ? 'Available' : 'Not configured'}</dd></div><div><dt>Station-wide bearer</dt><dd>${ctx.me.mcpTokenSet ? 'Configured' : 'Not configured'}</dd></div><div><dt>Assistant provider key</dt><dd>${ctx.me.hasAssistantKey ?? ctx.me.hasAnthropicKey ? 'Available' : 'Not configured'}</dd></div></dl><a href="#/connections">Review connection options ${icon('arrow')}</a></section></div>`;
}
export function connections(ctx) {
  return `<div class="page-intro"><div><p class="eyebrow">CLIENT ACCESS</p><h1 tabindex="-1">Connections</h1><p>One endpoint per module. Choose the access scope before sharing it.</p></div></div>
    ${inventoryNotice(ctx)}<div class="split-grid"><section class="panel"><h2>OAuth approval</h2><p>${ctx.me.oauth ? 'OAuth is available. Add a module endpoint in a compatible client, then approve the requested access with your Station password.' : 'OAuth is unavailable. Configure PUBLIC_URL in the container environment and restart to enable discovery and approval.'}</p><p>Resource-aware clients receive module-scoped authorization. Approval without a resource can be station-wide; check the consent screen.</p></section><section class="panel"><h2>Bearer tokens</h2><p>Create a per-module token in that module’s <strong>Access</strong> panel for clients that accept bearer authentication.</p><p>The environment’s <code>MCP_TOKEN</code> is station-wide: ${ctx.me.mcpTokenSet ? 'configured' : 'not configured'}. It is not the admin session and grants broader access than a module token.</p></section></div>
    <section class="panel"><div class="section-heading"><div><h2>Module endpoints</h2><p>These are configured endpoints, not proof of connected clients or successful calls.</p></div><a class="btn" href="#/modules">Manage module Access</a></div><div class="endpoint-list">${ctx.mcps.length ? ctx.mcps.map((m) => `<article class="connection-row"><div><h3>${esc(m.manifest?.name || m.id)}</h3><span class="subtle">${m.error ? 'Load error' : !m.enabled ? 'Disabled' : !m.configured ? 'Needs configuration' : 'Enabled & configured'}</span></div><code>${esc(m.url || 'Endpoint unavailable')}</code><a class="btn sm" href="#/modules?module=${encodeURIComponent(m.id)}">Find module</a></article>`).join('') : ctx.inventoryState === 'ready' ? '<p>No modules installed. Add a module to create an endpoint.</p>' : '<p>Module endpoints are not available in the current inventory.</p>'}</div></section>`;
}
export function settings(ctx) {
  return `<div class="page-intro"><div><p class="eyebrow">STATION ADMINISTRATION</p><h1 tabindex="-1">Settings</h1><p>Manage the assistant, retained instructions and station backups.</p></div></div>${inventoryNotice(ctx)}<div class="split-grid"><section class="panel"><h2>Station configuration</h2><p>Assistant provider, API keys, model, instructions and logs live in Station settings. Service credentials belong to each module.</p><button class="btn primary" data-action="station">${icon('settings')}Open Station settings</button></section><section class="panel"><h2>Backup & restore</h2><p>Export configuration or download a full archive. Store backups securely: they may contain sensitive configuration.</p><button class="btn" data-action="backup">${icon('backup')}Open backup tools</button></section></div><section class="panel"><h2>Deployment</h2><dl class="status-list"><div><dt>Version</dt><dd>${esc(ctx.me.version)}</dd></div><div><dt>Public URL</dt><dd class="mono">${esc(ctx.me.publicUrl || 'Not configured')}</dd></div><div><dt>Transport</dt><dd>Streamable HTTP, per module</dd></div></dl><p>Public URL and environment changes are managed in your container configuration, not in this dashboard.</p></section>`;
}
export function help() {
  return `<div class="page-intro"><div><p class="eyebrow">FIELD GUIDE</p><h1 tabindex="-1">Make your first connection.</h1><p>A practical guide to modules, credentials and client access.</p></div></div><div class="guide-grid"><nav class="guide-index" aria-label="Guide sections"><a href="#/help?section=workflow">Getting started</a><a href="#/help?section=scopes">Access scopes</a><a href="#/help?section=contract">Module contract</a><a href="#/help?section=install">Install & offline</a></nav><div class="guide-content"><section class="panel" id="guide-workflow" tabindex="-1"><h2>01 / Add → configure → test → connect</h2><ol><li>Open <a href="#/modules">Modules</a> and choose <strong>Add module</strong>. Start from the template, import a shared module, or ask the assistant to build one.</li><li>Open the module’s <strong>Settings</strong>. Enter the service URL and the service’s own credentials. These are not your Station admin password.</li><li>Run <strong>Test</strong> and inspect <strong>Tools</strong>. A module without a test export can only report that it loads, not that the upstream service works.</li><li>Enable the module. Open <strong>Access</strong>, then copy its endpoint to your MCP client. Test from the client before relying on it.</li></ol></section><section class="panel" id="guide-scopes" tabindex="-1"><h2>02 / Separate the three access lanes</h2><p><strong>Admin session:</strong> your browser cookie grants dashboard access. It is not accepted as MCP authentication.</p><p><strong>Module access:</strong> a per-module bearer token or resource-scoped OAuth grant limits access to one module. Manage tokens and authorized clients in the module’s Access panel.</p><p><strong>Station-wide bearer:</strong> the container’s MCP_TOKEN reaches all enabled modules. Share narrow module access instead whenever possible. OAuth approvals without a resource can also be station-wide.</p></section><section class="panel" id="guide-contract" tabindex="-1"><h2>03 / A module is a folder, not a package install</h2><p>Each module has <code>manifest.json</code> for identity, slug and settings, plus <code>index.js</code> exporting <code>register</code>. An optional <code>test</code> export checks connectivity. Modules use the injected helpers and existing runtime; do not assume per-module npm dependencies are installed.</p><p>Save code, then reload modules to apply changes. Inspect load errors in the library. An enabled switch is not a successful test.</p></section><section class="panel" id="guide-install" tabindex="-1"><h2>04 / Installable, not an offline control plane</h2><p>Supported browsers can install Station from their menu when served over HTTPS (or localhost). An ordinary HTTP LAN address is not a secure context, so installation and the worker may be unavailable. Browser support varies.</p><p>Only public styles, fonts, icons, the manifest and a generic offline notice may be cached. Dashboard pages, JavaScript, API responses, credentials and OAuth/MCP traffic are never cached by Station’s worker. Reconnect before changing configuration.</p><button class="btn" data-action="install">Installation options</button><p id="install-help" class="subtle" role="status"></p></section></div></div>`;
}
