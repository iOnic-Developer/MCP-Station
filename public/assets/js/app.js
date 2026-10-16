import { api } from './api.js';
import { esc, toast, drawer } from './ui.js';
import { icon } from './icons.js';
import { initPwa } from './pwa.js';
import { renderLogin } from './views/login.js';
import { renderList } from './views/list.js';
import { renderIntegration, renderAddAccount } from './views/integration.js';
import { renderConnections } from './views/connections.js';
import { renderUsage } from './views/usage.js';
import { accounts, workspaceUrl } from './views/accounts.js';
import { openBackup } from './views/backup.js';
import { openStation } from './views/station.js';
import { renderAssistant, resetAssistant } from './views/assistant.js';
const root = document.getElementById('app');
// Focus the current main region without sending the skip fragment to the router.
document.querySelector('.station-skip-link')?.addEventListener('click', (event) => {
  event.preventDefault();
  document.getElementById('main-content')?.focus();
});
const ctx = { me: null, mcps: [], loadError: '', refresh: () => boot() };
const routes = {
  overview: ['Overview', 'Your tools. One well-connected home.', 'overview'],
  integrations: ['Integrations', 'Connect the services you use to the assistants you trust.', 'plug'],
  connect: ['Connections', 'Choose an account, test its service and connect your AI client.', 'connect'],
  assistant: ['Assistant', 'Build, understand and improve your integrations.', 'assistant'],
  settings: ['Settings', 'Make this station work for you.', 'settings'],
  backups: ['Backups & portability', 'Keep a safe copy. Take your configuration with you.', 'backup']
};
let bootVersion = 0;
let routeVersion = 0;
let renderedRoute = '';
let acceptedHash = location.hash;
let navigating = false;
try { document.documentElement.dataset.theme = localStorage.getItem('station.theme') || 'light'; } catch { document.documentElement.dataset.theme = 'light'; }
initPwa();
window.addEventListener('station:unauthed', () => {
  // A wrong login password also returns 401: leave that form intact to show its error.
  if (ctx.me?.authed) { ctx.me = null; boot(); }
});
window.addEventListener('station:mcps-changed', () => boot());
window.addEventListener('hashchange', async () => {
  if (!ctx.me?.authed || navigating) return;
  navigating = true;
  try {
    const guard = root.querySelector('#routeRoot .page-surface')?.stationBeforeClose;
    if (guard && !await guard()) {
      history.replaceState(null, '', `${location.pathname}${location.search}${acceptedHash}`);
      const picker = root.querySelector('[data-workspace-surface]')?.parentElement.querySelector('[data-account]');
      if (picker) picker.value = new URLSearchParams(acceptedHash.split('?')[1] || '').get('account') || ctx.accountSelection?.get(routeDetails().sourceId);
      return;
    }
    acceptedHash = location.hash;
    await renderRoute(true);
  } finally { navigating = false; if (ctx.me?.authed && location.hash !== acceptedHash) window.dispatchEvent(new Event('hashchange')); }
});
window.addEventListener('beforeunload', (e) => {
  if (root.querySelector('#routeRoot .page-surface')?.stationDirty?.()) { e.preventDefault(); e.returnValue = ''; }
});
function routeDetails() {
  try {
    const raw = location.hash.replace(/^#\/?/, '') || 'overview';
    const split = raw.indexOf('?'), path = split < 0 ? raw : raw.slice(0, split);
    const parts = path.split('/').map(decodeURIComponent);
    const params = new URLSearchParams(split < 0 ? '' : raw.slice(split + 1));
    if (parts.length > 3 || (parts[0] !== 'integrations' && parts.length > 1) || params.getAll('account').length > 1) return { key: 'invalid' };
    return { key: parts[0], create: parts.length === 2 && parts[1] === 'new', sourceId: parts[1], tab: parts[2] || 'settings', account: params.get('account') || undefined };
  } catch { return { key: 'invalid' }; }
}
function navLink(key, mobile = false) {
  return `<a class="nav-link" href="#/${key}" data-route="${key}">${icon(routes[key][2])}<span>${key === 'backups' ? 'Backups' : mobile && key === 'integrations' ? 'Integrations' : routes[key][0]}</span></a>`;
}
async function boot() {
  const version = ++bootVersion;
  try {
    const me = await api('/me');
    if (version !== bootVersion) return;
    ctx.me = me;
    if (!me.authed) {
      resetAssistant();
      root.querySelectorAll('.page-surface').forEach((el) => el.dispatchEvent(new Event('station:dispose')));
      document.querySelectorAll('dialog').forEach((d) => d.close());
      ctx.accountSelection = new Map();
      ctx.workspaceRefresh = null;
      renderedRoute = '';
      renderLogin(root, { me, onAuthed: boot });
      const main = root.querySelector('main');
      main.id = 'main-content';
      main.tabIndex = -1;
      return;
    }
    try { ctx.mcps = (await api('/mcps')).mcps; ctx.loadError = ''; }
    catch (e) { ctx.loadError = e.message; }
    if (version !== bootVersion) return;
    if (!root.querySelector('.app-shell')) renderShell();
    await renderRoute(false);
  } catch {
    if (version !== bootVersion) return;
    root.innerHTML = `<main id="main-content" class="login-wrap" tabindex="-1"><section class="login"><img class="login-mark" src="/assets/brand/station-mark.svg" alt=""><h1>We couldn’t reach your station</h1><p>Check your connection and that MCP Station is running, then try again.</p><button class="btn primary" id="retryBoot">Try again</button></section></main>`;
    root.querySelector('#retryBoot').onclick = boot;
  }
}
function renderShell() {
  root.innerHTML = `<div class="app-shell">
    <aside class="sidebar" aria-label="Primary navigation"><a href="#/overview" class="brand"><img src="/assets/brand/station-mark.svg" alt="" width="32" height="32"><span>MCP Station<small>Your connection workspace</small></span></a>
      <div class="nav-caption">Workspace</div><nav>${['overview', 'integrations', 'connect', 'assistant'].map((k) => navLink(k)).join('')}</nav>
      <div class="nav-caption">Manage</div><nav>${['settings', 'backups'].map((k) => navLink(k)).join('')}</nav>
      <div class="sidebar-foot"><span class="sidebar-version">Self-hosted · v${esc(ctx.me.version)}</span><button class="nav-link" data-logout>${icon('logout')}<span>Sign out</span></button></div>
    </aside>
    <div class="workspace"><header class="workspace-bar"><button class="btn icon-btn mobile-menu" data-menu aria-label="Open navigation">${icon('menu')}</button><div class="breadcrumbs"><span>Workspace</span>${icon('chevron')}<span id="crumb">Overview</span></div><div class="spacer"></div><button class="btn icon-btn" data-theme aria-label="Switch color theme"></button><button class="btn primary" data-add>${icon('plus')}<span>Add integration</span></button></header>
      <main id="main-content" class="main" tabindex="-1"><div id="routeRoot"></div></main>
    </div><nav class="bottom-nav" aria-label="Mobile navigation">${['overview', 'integrations', 'connect', 'assistant'].map((k) => navLink(k, true)).join('')}</nav></div>`;
  root.querySelector('[data-add]').onclick = () => { location.hash = '/integrations/new'; };
  root.querySelector('[data-logout]').onclick = logout;
  const theme = root.querySelector('[data-theme]');
  const updateTheme = () => { const dark = document.documentElement.dataset.theme === 'dark'; theme.innerHTML = icon(dark ? 'sun' : 'moon'); theme.setAttribute('aria-label', dark ? 'Use light theme' : 'Use dark theme'); };
  updateTheme();
  theme.onclick = () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem('station.theme', document.documentElement.dataset.theme); } catch {} updateTheme(); };
  root.querySelector('[data-menu]').onclick = () => {
    const d = drawer({ title: 'Your workspace', body: `<nav class="mobile-nav">${Object.keys(routes).map((k) => navLink(k)).join('')}</nav><button class="btn" data-signout>${icon('logout')}Sign out</button>` });
    d.el.querySelectorAll('a').forEach((a) => { a.onclick = d.close; });
    d.el.querySelector('[data-signout]').onclick = () => { d.close(); logout(); };
  };
}
async function logout() {
  const guard = root.querySelector('#routeRoot .page-surface')?.stationBeforeClose;
  if (guard && !await guard()) return;
  try { await api('/logout', { method: 'POST' }); await boot(); }
  catch (e) { toast(`Could not sign out: ${e.message}. Try again.`, 'err'); }
}
async function renderRoute(focus) {
  const version = ++routeVersion;
  const route = routeDetails(), key = route.key;
  const signature = location.hash || '#/overview';
  const page = root.querySelector('#routeRoot');
  if (!page) return;
  const same = renderedRoute === signature;
  if (same && !focus && (['assistant', 'settings', 'backups'].includes(key) || route.sourceId)) { ctx.workspaceRefresh?.(); return; }
  const wasLibrary = renderedRoute.split('?')[0] === '#/integrations';
  if (wasLibrary) { ctx.listState ||= { q: '', filter: 'all' }; ctx.listState.scroll = window.scrollY; }
  if (renderedRoute.startsWith('#/assistant') && key !== 'assistant') resetAssistant();
  page.querySelectorAll('.page-surface').forEach((el) => el.dispatchEvent(new Event('station:dispose')));
  ctx.workspaceRefresh = null;
  renderedRoute = signature;
  const info = routes[key];
  if (!info) {
    page.innerHTML = `<section class="empty-state"><h1>Page not found</h1><p>This page may have moved.</p><a class="btn primary" href="#/overview">Back to overview</a></section>`;
    return;
  }
  document.title = `${info[0]} · MCP Station`;
  root.querySelector('#crumb').textContent = info[0];
  root.querySelectorAll('[data-route]').forEach((a) => { if (a.dataset.route === key) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current'); });
  if (key === 'integrations' && route.sourceId) {
    page.innerHTML = '<div id="viewRoot"></div>';
    const content = page.querySelector('#viewRoot');
    if (ctx.loadError) content.innerHTML = `<p class="error-text" role="alert">Could not load integrations: ${esc(ctx.loadError)}. Return to the library to retry.</p><a href="#/integrations">Back to integrations</a>`;
    else if (route.create) renderAddAccount(content, ctx);
    else await renderIntegration(content, ctx, route);
    if (version !== routeVersion) return;
    if (focus) { window.scrollTo(0,0); root.querySelector('#main-content').focus({preventScroll:true}); }
    return;
  }
  page.innerHTML = `<div class="page-heading"><div><p class="eyebrow">${key === 'settings' || key === 'backups' ? 'Station management' : 'Your workspace'}</p><h1>${info[0]}</h1><p class="page-description">${info[1]}</p></div>${key === 'integrations' ? `<button class="btn" data-reload>${icon('reload')}Reload modules</button>` : ''}</div><div id="viewRoot"></div>`;
  const view = page.querySelector('#viewRoot');
  if (ctx.loadError) view.innerHTML = `<div class="banner" role="alert">We couldn’t load integrations: ${esc(ctx.loadError)}. <button class="btn sm" data-retry>Try again</button></div>`;
  const content = document.createElement('div'); view.appendChild(content);
  view.querySelector('[data-retry]')?.addEventListener('click', boot);
  if (key === 'overview') renderOverview(content);
  if (key === 'integrations') {
    if (!ctx.loadError) renderList(content, ctx);
    page.querySelector('[data-reload]').onclick = async (e) => {
      const b = e.currentTarget; b.disabled = true;
      try { await api('/reload', { method: 'POST' }); toast('Integration folders reloaded'); await boot(); }
      catch (err) { toast(err.message, 'err'); } finally { b.disabled = false; }
    };
  }
  if (key === 'connect' && !ctx.loadError) renderConnections(content, ctx);
  if (key === 'assistant') renderAssistant(content, ctx);
  if (key === 'settings' || key === 'backups') {
    content.innerHTML = '<p class="loading" role="status">Loading your station…</p>';
    const fn = key === 'settings' ? openStation : openBackup;
    await fn(ctx, content);
    if (version !== routeVersion) return;
  }
  if (focus) root.querySelector('#main-content').focus({ preventScroll: true });
  if (key === 'integrations') requestAnimationFrame(() => { if (version === routeVersion) window.scrollTo(0,ctx.listState?.scroll || 0); });
  else if (focus) window.scrollTo(0,0);
}
function renderOverview(el) {
  if (ctx.loadError) { el.innerHTML = '<p>Your station summary will appear when integrations can be loaded.</p>'; return; }
  const allAccounts = ctx.mcps.flatMap((s) => accounts(s).map((a) => ({ ...s, ...a, sourceId: s.id, manifest:s.manifest })));
  const configured = allAccounts.filter((m) => m.configured).length;
  const enabled = allAccounts.filter((m) => m.enabled).length;
  const errors = allAccounts.filter((m) => m.error || m.lastTest?.ok === false).length;
  const needs = allAccounts.filter((m) => !m.configured || m.error || m.lastTest?.ok === false);
  el.innerHTML = `<section class="welcome-panel"><div><p class="eyebrow">Less setup. More possibility.</p><h2>A home for your AI’s tools.</h2><p>MCP connects an AI assistant to real services — like your files, messages or projects. This station keeps those connections in one place, on your own server.</p><a class="btn primary" href="#/integrations">Explore integrations ${icon('arrow')}</a></div><div class="welcome-aside">${icon('plug')}<span>Your services</span><span class="connection-line"></span>${icon('assistant')}<span>Your assistant</span></div></section>
  <section class="stats-grid" aria-label="Integration summary">${[['Integrations', ctx.mcps.length, 'Installed on this station'], ['Accounts configured', configured, 'Required settings supplied'], ['Accounts enabled', enabled, 'Available to connect'], ['Needs attention', errors, 'Load errors or failed last tests']].map(([title, number, desc]) => `<article class="stat"><span>${title}</span><strong>${number}</strong><small>${desc}</small></article>`).join('')}</section>
  <p class="metric-note">Enabled does not mean verified. Run a connection test from an integration to check its service.</p>
  <div class="overview-columns"><section class="panel"><div class="section-heading"><h2>Make your first connection</h2><span class="tag">Quick start</span></div><ol class="setup-steps"><li><span class="step-number">01</span><div><a href="#/integrations">Choose an integration</a><p>Configure the service and save its credentials.</p></div></li><li><span class="step-number">02</span><div><a href="#/integrations">Test the connection</a><p>Run a test, review the result, then enable the integration.</p></div></li><li><span class="step-number">03</span><div><a href="#/connect">Connect your AI client</a><p>Copy its endpoint and approve access from your client.</p></div></li></ol></section>
  <section class="panel"><div class="section-heading"><h2>Next up</h2><a href="#/integrations">View all ${icon('arrow')}</a></div>${needs.length ? needs.slice(0, 4).map((m) => `<a class="next-action" href="${workspaceUrl(m.sourceId,'settings',m.id)}">${icon(m.error || m.lastTest?.ok === false ? 'warning' : 'settings')}<span><strong>${esc(m.manifest?.name || m.id)} · ${esc(m.name)}</strong><small>${m.error ? 'Resolve a load error' : m.lastTest?.ok === false ? 'Review the last failed test' : 'Finish configuration'}</small></span>${icon('chevron')}</a>`).join('') : `<p class="desc">${ctx.mcps.length ? 'Required settings are in place. Test your integrations, then connect a client.' : 'Start by adding an integration, or ask the Assistant to build one.'}</p><a class="btn" href="#/assistant">${icon('assistant')}Open Assistant</a>`}<div class="quiet-note">${icon('backup')}<span>Keep a safe copy of your work. <a href="#/backups">Manage backups</a></span></div></section></div><div data-overview-usage></div>`;
  renderUsage(el.querySelector('[data-overview-usage]'));
}
boot();
