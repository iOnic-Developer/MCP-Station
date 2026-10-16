import { api } from './api.js';
import { esc, toast } from './ui.js';
import { renderLogin } from './views/login.js';
import { renderList } from './views/list.js';
import { openAddNew } from './views/addNew.js';
import { openBackup } from './views/backup.js';
import { openStation } from './views/station.js';
import { mountAssistant, hasSessionWork } from './assistant-shell.js';
import { icon, destinations, titleOf, overview, connections, settings, help, inventoryNotice } from './product.js';
import { setupPwa, requestInstall } from './pwa.js';

const root = document.getElementById('app');
const ctx = { me: null, mcps: [], inventoryState: 'loading', inventoryLoaded: false, inventoryError: '', refresh: refreshData };
let generation = 0;
let refreshGeneration = 0;
let shell = null;
let disposeAssistant = null;
let currentRoute = '';
let signingOut = false;
let pendingModuleLink = null;
const scrollPositions = new Map();
const assistantRequests = new Set();
const originalFetch = window.fetch.bind(window);
// The legacy chat pane uses raw fetch; bind its streaming requests to the auth session.
window.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : input, location.href);
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/')) return originalFetch(input, init);
  const ticket = generation;
  const chat = url.pathname === '/api/assistant';
  const controller = chat ? new AbortController() : null;
  if (controller) {
    assistantRequests.add(controller);
    controller.signal.addEventListener('abort', () => assistantRequests.delete(controller), {once:true});
    const signal = init.signal || (input instanceof Request ? input.signal : null);
    if (signal) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  let response;
  try {
    response = await originalFetch(input, controller ? { ...init, signal: controller.signal } : init);
  } catch (error) {
    if (controller) assistantRequests.delete(controller);
    throw error;
  }
  if (controller && !response.ok) assistantRequests.delete(controller);
  if (ticket !== generation) throw new DOMException('Session changed', 'AbortError');
  if (response.status === 401 && url.pathname !== '/api/login' && !signingOut) {
    // Consume protected 401s here, before api.js can emit a duplicate untagged event.
    window.dispatchEvent(new CustomEvent('station:unauthed', { detail: { generation: ticket } }));
    throw new DOMException('Session expired', 'AbortError');
  }
  return response;
};

function clearSession() {
  generation++;
  refreshGeneration++;
  for (const controller of assistantRequests) controller.abort();
  assistantRequests.clear();
  disposeAssistant?.();
  disposeAssistant = null;
  window.dispatchEvent(new Event('station:session-ended'));
  document.querySelectorAll('dialog, .drawer, .drawer-backdrop, .assistant, .fab').forEach((el) => {
    if (el.tagName === 'DIALOG' && el.open) el.close();
    el.remove();
  });
  try { localStorage.removeItem('station.chat.v1'); } catch { /* storage may be blocked */ }
  document.getElementById('toasts').replaceChildren();
  ctx.me = null;
  ctx.mcps = [];
  ctx.inventoryState = 'loading';
  ctx.inventoryLoaded = false;
  ctx.inventoryError = '';
  pendingModuleLink = null;
  delete ctx.listState;
  scrollPositions.clear();
  shell = null;
  currentRoute = '';
  root.replaceChildren();
}

function signedOut(me) {
  clearSession();
  ctx.me = me;
  renderLogin(root, { me, onAuthed: () => boot() });
}
window.addEventListener('station:unauthed', (event) => {
  if (signingOut) return;
  const ticket = event.detail?.generation;
  if (ticket === undefined || ticket !== generation) return; // Only the central interceptor expires sessions; login errors stay inline.
  signedOut({ passwordSet: true, ...ctx.me, authed: false });
});

async function signOut() {
  if (signingOut) return;
  if (hasSessionWork() && !confirm('Sign out? Open drafts and assistant history will be erased, and in-flight assistant requests will be cancelled.')) return;
  const me = { ...ctx.me, authed: false };
  signingOut = true;
  clearSession(); // Hide secrets now, but do not expose login until the cookie is cleared.
  document.title = 'Signing out · MCP Station';
  root.innerHTML = `<main class="connection-error panel" id="main-content"><h1 tabindex="-1">Signing out…</h1><p id="logout-status" role="status">Clearing your server session. Sign-in is unavailable until sign-out is confirmed.</p><button class="btn primary" id="logoutRetry" disabled>Retry sign-out</button></main>`;
  root.querySelector('h1').focus();
  const retry = root.querySelector('#logoutRetry');
  let pending = false;
  async function attempt() {
    if (pending) return;
    pending = true;
    retry.disabled = true;
    root.querySelector('#logout-status').textContent = 'Waiting for the server to confirm sign-out…';
    try {
      await api('/logout', { method: 'POST' });
      signingOut = false;
      signedOut(me);
    } catch {
      root.querySelector('#logout-status').textContent = 'Sign-out is not confirmed. Sensitive content is hidden, but your server session may still be active. Reconnect and retry sign-out before signing in again.';
      retry.disabled = false;
      retry.focus();
    } finally { pending = false; }
  }
  retry.onclick = attempt;
  await attempt();
}
window.addEventListener('station:mcps-changed', () => { if (shell) refreshData(); });
window.addEventListener('hashchange', () => { if (shell) route(); });

async function boot() {
  const ticket = ++generation;
  try {
    const me = await api('/me');
    if (ticket !== generation) return;
    if (!me.authed) return signedOut(me);
    ctx.me = me;
    if (!shell) createShell();
    await refreshData();
  } catch (error) {
    if (ticket !== generation) return;
    root.innerHTML = `<section class="connection-error panel"><p class="eyebrow">MCP STATION</p><h1>Station unavailable</h1><p>Could not reach the backend. Check the connection and retry.</p><button class="btn primary" id="bootRetry">Try again</button></section>`;
    document.getElementById('bootRetry').onclick = boot;
  }
}

async function refreshData() {
  if (!shell) return;
  const session = generation;
  const request = ++refreshGeneration;
  ctx.inventoryState = 'loading';
  ctx.inventoryError = '';
  document.getElementById('shell-status').textContent = 'Refreshing module inventory…';
  updatePageData();
  try {
    const [me, data] = await Promise.all([api('/me'), api('/mcps')]);
    if (session !== generation || request !== refreshGeneration || !shell) return;
    if (!me.authed) return signedOut(me);
    ctx.me = me;
    if (!Array.isArray(data.mcps)) throw new Error('Invalid module inventory');
    ctx.mcps = data.mcps;
    ctx.inventoryLoaded = true;
    ctx.inventoryState = 'ready';
    ctx.inventoryError = '';
    document.getElementById('shell-status').textContent = 'Data refreshed';
    updatePageData();
    window.dispatchEvent(new CustomEvent('station:data-refreshed', { detail: { mcps: ctx.mcps } }));
  } catch (error) {
    if (session !== generation || request !== refreshGeneration || !shell) return;
    ctx.inventoryState = 'error';
    ctx.inventoryError = 'Could not load module inventory. Check the connection and retry.';
    document.getElementById('shell-status').textContent = ctx.inventoryLoaded ? 'Refresh failed — showing last successful inventory' : 'Module inventory unavailable';
    updatePageData();
  }
}

function createShell() {
  root.innerHTML = `<div class="station-shell"><aside class="station-sidebar"><a class="station-brand" href="#/overview" aria-label="MCP Station overview"><img src="/assets/brand/station-mark.svg" width="36" height="36" alt=""><span>MCP Station<small>INTEGRATION CONTROL PLANE</small></span></a><p class="sidebar-caption">WORKSPACE</p><nav class="station-nav" aria-label="Main navigation">${destinations.map((name) => `<a href="#/${name}" data-route="${name}">${icon(name)}<span>${titleOf(name)}</span></a>`).join('')}</nav><div class="sidebar-footer"><span class="subtle">Self-hosted · v${esc(ctx.me.version)}</span><button class="btn" id="bLogout">${icon('logout')}Sign out</button></div></aside><div class="station-workspace"><header class="workspace-bar"><span id="route-label">Overview</span><span id="shell-status" role="status">Loading module inventory…</span><button class="btn sm" id="station-update" hidden>Update available</button></header><main class="station-main" id="main-content" tabindex="-1"><section id="page-overview" data-page="overview"></section><section id="page-modules" data-page="modules" hidden><div class="page-intro"><div><p class="eyebrow">MODULE LIBRARY</p><h1 tabindex="-1">Modules</h1><p>Configure, test and manage the tools exposed by your station.</p></div><div class="page-actions"><button class="btn" id="bReload">${icon('reload')}Reload</button><button class="btn" id="bBackup">${icon('backup')}Backup</button><button class="btn primary" id="bAdd">${icon('plus')}Add module</button></div></div><div id="listRoot" aria-label="Module library"><p>Loading modules…</p></div></section><section id="page-connections" data-page="connections" hidden></section><section id="page-settings" data-page="settings" hidden></section><section id="page-help" data-page="help" hidden></section></main></div></div>`;
  shell = root.firstElementChild;
  shell.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'add') openAddNew(ctx);
    if (action === 'station') openStation(ctx);
    if (action === 'backup') openBackup(ctx);
    if (action === 'install') requestInstall();
    if (action === 'inventory-retry') refreshData();
  });
  document.getElementById('bAdd').onclick = () => openAddNew(ctx);
  document.getElementById('bBackup').onclick = () => openBackup(ctx);
  document.getElementById('bReload').onclick = async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    const session = generation;
    try { await api('/reload', { method: 'POST' }); if (session === generation) { toast('Modules reloaded'); await ctx.refresh(); } }
    catch (error) { if (session === generation) toast(error.message, 'err'); }
    finally { button.disabled = false; }
  };
  document.getElementById('bLogout').onclick = signOut;
  disposeAssistant = mountAssistant(ctx);
  updatePageData();
  route(true);
  window.dispatchEvent(new Event('station:shell-ready'));
}

function modalOwnsFocus() {
  return !!document.querySelector('dialog[open], .drawer, [aria-modal="true"]');
}
function capturePageFocus() {
  const active = document.activeElement;
  const page = active?.closest('#page-overview, #page-connections, #page-settings');
  if (!page || modalOwnsFocus()) return null;
  const key = ['id', 'href', 'data-action'].find((attr) => active.hasAttribute(attr));
  if (!key) return null;
  return { page, active, key, value: active.getAttribute(key), start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection };
}
function restorePageFocus(saved) {
  if (!saved || saved.page.hidden || modalOwnsFocus()) return;
  if (document.activeElement !== document.body && document.activeElement !== saved.active) return;
  const target = [...saved.page.querySelectorAll(`[${saved.key}]`)].find((el) => el.getAttribute(saved.key) === saved.value);
  if (!target || target.disabled) return;
  target.focus({ preventScroll: true });
  if (typeof saved.start === 'number' && target.setSelectionRange) {
    try { target.setSelectionRange(saved.start, saved.end, saved.direction); } catch { /* Not a selectable input. */ }
  }
}
function updatePageData() {
  const focused = capturePageFocus();
  document.getElementById('page-overview').innerHTML = overview(ctx);
  document.getElementById('page-connections').innerHTML = connections(ctx);
  document.getElementById('page-settings').innerHTML = settings(ctx);
  if (!document.getElementById('page-help').hasChildNodes()) document.getElementById('page-help').innerHTML = help();
  // Only this library subtree is replaced; editors, dialogs and the assistant live outside it.
  // Parent can supply ctx.renderModuleList(root, ctx) to preserve library-local state/focus.
  const listRoot = document.getElementById('listRoot');
  if (ctx.inventoryState === 'ready' || (ctx.inventoryLoaded && ctx.mcps.length)) {
    (ctx.renderModuleList || renderList)(listRoot, ctx);
    if (ctx.inventoryState !== 'ready') listRoot.insertAdjacentHTML('afterbegin', inventoryNotice(ctx));
  } else {
    listRoot.innerHTML = inventoryNotice(ctx);
  }
  restorePageFocus(focused);
  applyModuleLink();
  if (pendingModuleLink?.hash === location.hash && pendingModuleLink.generation === generation && ctx.inventoryState === 'ready') applyModuleLink(true);
}
function applyModuleLink(focus = false) {
  const [path, query] = location.hash.slice(1).split('?');
  if (path !== '/modules') return;
  const id = new URLSearchParams(query).get('module');
  if (!id) return;
  const row = [...document.querySelectorAll('#listRoot [data-id]')].find((el) => el.dataset.id === id);
  if (row) {
    row.hidden = false;
    row.classList.add('deep-linked');
    row.setAttribute('tabindex', '-1');
    if (focus && !modalOwnsFocus()) {
      row.scrollIntoView({ block: 'center' });
      row.focus({ preventScroll: true });
      pendingModuleLink = null;
    }
  }
}
function route(initial = false) {
  const [path, query] = location.hash.replace(/^#\/?/, '').split('?');
  const next = destinations.includes(path) ? path : 'overview';
  if (next !== path) history.replaceState(null, '', '#/overview');
  if (currentRoute) scrollPositions.set(currentRoute, window.scrollY);
  currentRoute = next;
  document.querySelectorAll('[data-page]').forEach((el) => { el.hidden = el.dataset.page !== next; });
  document.querySelectorAll('[data-route]').forEach((el) => {
    if (el.dataset.route === next) el.setAttribute('aria-current', 'page'); else el.removeAttribute('aria-current');
  });
  document.getElementById('route-label').textContent = titleOf(next);
  document.title = `${titleOf(next)} · MCP Station`;
  const page = document.getElementById(`page-${next}`);
  const section = new URLSearchParams(query).get('section');
  const target = next === 'help' && ['workflow', 'scopes', 'contract', 'install'].includes(section) ? document.getElementById(`guide-${section}`) : page.querySelector('h1');
  if (!initial) target?.focus({ preventScroll: true });
  window.scrollTo(0, scrollPositions.get(next) || 0);
  if (section && target) target.scrollIntoView({ block: 'start' });
  pendingModuleLink = next === 'modules' && new URLSearchParams(query).has('module') ? { hash: location.hash, generation } : null;
  applyModuleLink(true);
}

try { localStorage.removeItem('station.chat.v1'); } catch { /* no browser storage required */ }
setupPwa();
boot();
