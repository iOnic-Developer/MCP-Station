import { api } from '../api.js';
import { esc, modal, toast } from '../ui.js';
import { openSettings } from './settings.js';
import { openAccess } from './access.js';

// Only explicit, non-secret identity settings qualify. This is not remote identity verification.
export function serviceAccount(m) {
  const specs = Array.isArray(m.manifest?.settings) ? m.manifest.settings : [];
  for (const key of ['username', 'account', 'email']) {
    const spec = specs.find((s) => typeof s.key === 'string' && s.key.toLowerCase() === key && s.type !== 'secret');
    const value = spec && m.settings?.[spec.key];
    if (typeof value !== 'string') continue;
    const account = value.trim();
    if (!account || account.length > 254 || /[\r\n\x00-\x1f]/.test(account) || /(?:[a-z][a-z0-9+.-]*:\/\/|www\.|^\/\/|^(?:data|javascript|mailto):)/i.test(account) || /^(?:[•*]+|bearer\s|sk[-_]|gh[pousr]_|eyJ)/i.test(account)) continue;
    return account;
  }
  return 'Not provided';
}

export function connectionRows(ctx) {
  ctx.connectionPending ||= new Set();
  ctx.connectionFeedback ||= new Map();
  return `<div class="connection-list" aria-label="Module connections">${ctx.mcps.map((m) => {
    const name = m.manifest?.name || m.id;
    const valid = Boolean(m.manifest && !m.error);
    const busy = ctx.connectionPending.has(m.id);
    const offline = navigator.onLine === false;
    const disabled = (invalid = false) => busy || offline || invalid ? 'disabled' : '';
    const button = (action, label, invalid = false, glyph = '') => `<button class="btn" data-connection-action="${action}" aria-label="${esc(label)} — ${esc(name)}" ${disabled(invalid)}>${glyph}${label}</button>`;
    const test = m.lastTest;
    const at = test?.at && new Date(test.at);
    const when = at && Number.isFinite(at.getTime()) ? ` · ${at.toLocaleString()}` : '';
    const clients = Number.isSafeInteger(m.clients) && m.clients >= 0 ? m.clients : 0;
    const token = !m.tokenSet ? 'Not configured' : m.tokenExpiresAt && m.tokenExpiresAt < Date.now() ? 'Expired' : 'Configured';
    return `<article class="connection-row" data-connection-id="${esc(m.id)}" aria-label="${esc(name)} connection" aria-busy="${busy}">
      <div class="connection-main"><div class="connection-name"><span class="connection-label">Name</span><h2>${esc(name)}</h2></div>
      <div class="connection-account"><span class="connection-label">Service account · not verified</span><span>${esc(serviceAccount(m))}</span></div>
      <div class="connection-endpoint"><span class="connection-label">Endpoint</span><code>${esc(typeof m.url === 'string' && m.url ? m.url : 'Endpoint unavailable')}</code></div>
      ${button('copy', 'Copy', !m.url)}<div class="connection-actions" role="group" aria-label="${esc(name)} actions">
      ${button('config', 'Config', false, '<svg class="station-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9 3-1 3-3 1-2 5 2 5 3 1 1 3h6l1-3 3-1 2-5-2-5-3-1-1-3z"/><circle cx="12" cy="12" r="3"/></svg>')}${button('test', 'Test', !valid)}${button('access', 'Access', !valid)}
      <label class="connection-enable"><span>Enable</span><input type="checkbox" role="switch" data-connection-action="toggle" aria-label="Enable — ${esc(name)}" ${m.enabled ? 'checked' : ''} ${disabled(!valid)}></label></div></div>
      <div class="connection-meta"><span>${clients} authorized client${clients === 1 ? '' : 's'} (authorization records, not live connections)</span><span>Module token: ${token}</span><span>${m.enabled ? 'Enabled' : 'Disabled'} · ${m.error ? 'Load error' : m.configured ? 'Configuration saved' : 'Needs configuration'}</span><span>Last test: ${test ? test.ok ? 'Passed' : 'Failed' : 'Not run'}${esc(when)} (saved observation, not live health)</span></div>
      <p class="connection-feedback" role="status">${esc(ctx.connectionFeedback.get(m.id) || (offline ? 'Offline — reconnect to use connection controls.' : ''))}</p></article>`;
  }).join('') || `<p>${ctx.inventoryState === 'ready' ? 'No modules installed. Add a module to create an endpoint.' : 'Module endpoints are not available in the current inventory.'}</p>`}</div>`;
}

async function copyEndpoint(value, current) {
  try {
    if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
    await navigator.clipboard.writeText(value);
    if (current()) toast('Endpoint copied');
  } catch {
    if (!current()) return;
    const dlg = modal({ title: 'Copy endpoint manually', body: `<p>Clipboard access is unavailable. Select and copy this endpoint.</p><label for="connection-copy-value">Endpoint</label><textarea class="input mono" id="connection-copy-value" readonly>${esc(value)}</textarea>`, foot: '<button class="btn primary" data-done>Done</button>' });
    dlg.querySelector('[data-done]').onclick = () => dlg.close();
    const field = dlg.querySelector('textarea'); field.focus(); field.select();
  }
}

export function bindConnections(root, ctx) {
  const pending = ctx.connectionPending;
  function sync() {
    if (pending !== ctx.connectionPending || !root.isConnected) return;
    root.querySelectorAll('[data-connection-id]').forEach((row) => {
      const m = ctx.mcps.find((item) => item.id === row.dataset.connectionId);
      if (!m) return;
      const busy = pending.has(m.id);
      row.setAttribute('aria-busy', String(busy));
      row.querySelectorAll('[data-connection-action]').forEach((control) => {
        const action = control.dataset.connectionAction;
        control.disabled = busy || navigator.onLine === false || (['test', 'access', 'toggle'].includes(action) && (!m.manifest || Boolean(m.error))) || (action === 'copy' && !m.url);
        if (action === 'toggle' && !busy) control.checked = Boolean(m.enabled);
      });
      row.querySelector('.connection-feedback').textContent = ctx.connectionFeedback.get(m.id) || (navigator.onLine === false ? 'Offline — reconnect to use connection controls.' : '');
    });
  }
  async function perform(event) {
    const control = event.target.closest('[data-connection-action]');
    if (!control || !root.contains(control)) return;
    const action = control.dataset.connectionAction;
    if ((action === 'toggle') !== (event.type === 'change')) return;
    const row = control.closest('[data-connection-id]');
    const m = ctx.mcps.find((item) => item.id === row?.dataset.connectionId);
    if (!m || control.disabled || navigator.onLine === false || pending.has(m.id)) return;
    const enabled = control.checked;
    const focused = document.activeElement === control;
    pending.add(m.id); ctx.connectionFeedback.set(m.id, 'Working…'); sync();
    const current = () => pending === ctx.connectionPending && Boolean(ctx.me?.authed);
    try {
      if (action === 'config') openSettings(m, ctx);
      else if (action === 'access') await openAccess(m, ctx);
      else if (action === 'copy') await copyEndpoint(m.url, current);
      else if (action === 'test') {
        const r = await api(`/mcps/${encodeURIComponent(m.id)}/test`, { method: 'POST' });
        if (!current()) return;
        ctx.connectionFeedback.set(m.id, r.ok ? 'Test passed.' : 'Test failed. Review configuration and try again.');
        await ctx.refresh();
      } else if (action === 'toggle') {
        await api(`/mcps/${encodeURIComponent(m.id)}`, { method: 'PATCH', body: { enabled } });
        if (!current()) return;
        m.enabled = enabled;
        ctx.connectionFeedback.set(m.id, enabled ? 'Module enabled.' : 'Module disabled.');
        await ctx.refresh();
      }
      if (current() && ctx.connectionFeedback.get(m.id) === 'Working…') ctx.connectionFeedback.delete(m.id);
    } catch (error) {
      if (current() && error.name !== 'AbortError') ctx.connectionFeedback.set(m.id, 'Connection action failed. Check your connection and configuration, then try again.');
    } finally {
      pending.delete(m.id);
      if (!current()) return;
      sync();
      if (focused && !root.hidden && !document.querySelector('dialog[open], .drawer') && (document.activeElement === document.body || document.activeElement === control)) {
        const target = [...root.querySelectorAll('[data-connection-id]')].find((el) => el.dataset.connectionId === m.id)?.querySelector(`[data-connection-action="${action}"]`);
        if (target && !target.disabled) target.focus({ preventScroll: true });
      }
    }
  }
  root.onclick = perform;
  root.onchange = perform;
  sync();
}
