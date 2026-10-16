import { api } from '../api.js';
import { esc, toast, modal, confirmModal as uiConfirmModal } from '../ui.js';
import { icon } from '../product.js';
// Keep destructive wording/default focus explicit with both old and upgraded UI helpers.
export function confirmAction(title, text, options = {}) {
  const answer = uiConfirmModal(title, text, options);
  const dialogs = [...document.querySelectorAll('dialog[open]')];
  const dlg = dialogs.at(-1);
  const yes = dlg?.querySelector('[data-yes]');
  if (yes && options.confirmLabel) yes.textContent = options.confirmLabel;
  dlg?.querySelector('[data-no]')?.focus();
  return answer;
}
const confirmModal = confirmAction;
const when = (ms) => ms ? new Date(ms).toLocaleString() : 'Not recorded';
const until = (ms) => ms ? new Date(ms).toLocaleString() : 'Never';
const EXPIRY = [['never', 'Unlimited'], ['1d', '1 day'], ['1w', '1 week'], ['1m', '1 month']];

export async function openAccess(m, ctx) {
  let connections;
  try { ({ connections } = await api(`/mcps/${encodeURIComponent(m.id)}/connections`)); }
  catch (e) { return toast(e.message, 'err'); }
  const slug = m.manifest?.slug || m.id; const path = `/mcps/${encodeURIComponent(m.id)}`;
  let tokenSet = Boolean(m.tokenSet); let expiresAt = m.tokenExpiresAt; let pending = false;
  const dlg = modal({
    title: `Access — ${m.manifest?.name || m.id}`,
    body: `<div class="field"><label for="access-endpoint">MCP endpoint</label><input class="input mono" id="access-endpoint" readonly value="${esc(m.url)}"></div><h3>Module bearer token</h3><p>A token for <code>/${esc(slug)}</code> only. The station-wide MCP_TOKEN ${ctx.me.mcpTokenSet ? 'is set and grants broader access to all modules' : 'is not set'}.</p><div id="tokBox"></div><div class="field"><label for="tokExpiry">New token expiry</label><select class="input" id="tokExpiry">${EXPIRY.map(([v, label]) => `<option value="${v}">${label}</option>`).join('')}</select></div><div class="actions"><button class="btn" data-gen></button><button class="btn danger" data-clear>Clear module token</button></div><h3 class="access-section">Authorized OAuth clients</h3><p>Authorization records, not a live connectivity check. Revoking access forces a client to authorize again.</p><div class="list-rows" id="connRows"></div><p class="error-text" data-error role="alert"></p>`,
    foot: '<button class="btn primary" data-cancel>Done</button>'
  });
  const error = dlg.querySelector('[data-error]');
  function renderToken() {
    dlg.querySelector('#tokBox').innerHTML = `<p>${!tokenSet ? 'No module token configured.' : expiresAt && expiresAt < Date.now() ? `Token expired ${esc(when(expiresAt))}. Generate a replacement.` : `Token configured · expires ${esc(until(expiresAt))}. Stored encrypted; cannot be revealed again.`}</p>`;
    dlg.querySelector('[data-gen]').innerHTML = `${icon('connections')}${tokenSet ? 'Rotate token' : 'Generate token'}`;
    dlg.querySelector('[data-clear]').hidden = !tokenSet;
  }
  async function run(task) {
    if (pending) return;
    pending = true; error.textContent = ''; dlg.setAttribute('aria-busy', 'true'); dlg.querySelectorAll('button,select').forEach((el) => { el.disabled = true; });
    try { await task(); }
    catch (e) { error.textContent = e.message; }
    finally { pending = false; dlg.setAttribute('aria-busy', 'false'); dlg.querySelectorAll('button,select').forEach((el) => { el.disabled = false; }); }
  }
  function renderConns() {
    dlg.querySelector('#connRows').innerHTML = connections.length ? connections.map((c) => `<div class="list-row"><span class="grow"><b>${esc(c.clientName)}</b>${c.allMcps ? ' · Station-wide access' : ' · Module-scoped'}<br><span class="dim">Last used ${esc(when(c.lastUsedAt))} · expires ${esc(until(c.expiresAt))}</span></span><button class="btn danger" data-revoke="${esc(c.handle)}" aria-label="Revoke access for ${esc(c.clientName)}">Revoke access</button></div>`).join('') : '<p>No authorized clients yet. Add this endpoint in an OAuth-compatible MCP client.</p>';
    dlg.querySelectorAll('[data-revoke]').forEach((b) => { b.onclick = () => run(async () => {
      if (!await confirmModal('Revoke client access?', 'The client loses access immediately and must authorize again.', { confirmLabel: 'Revoke access', danger: true })) return;
      await api(`/connections/${encodeURIComponent(b.dataset.revoke)}`, { method: 'DELETE' });
      connections = connections.filter((c) => c.handle !== b.dataset.revoke); renderConns(); dlg.querySelectorAll('button,select').forEach((el) => { el.disabled = true; }); await ctx.refresh();
    }); });
  }
  renderToken(); renderConns();
  dlg.querySelector('[data-gen]').onclick = () => run(async () => {
    if (tokenSet && !await confirmModal('Rotate module token?', 'The current token stops working immediately. Update every client using it.', { confirmLabel: 'Rotate token', danger: true })) return;
    const r = await api(`${path}/token`, { method: 'POST', body: { expiry: dlg.querySelector('#tokExpiry').value } });
    tokenSet = true; expiresAt = r.expiresAt; renderToken();
    dlg.querySelector('#tokBox').innerHTML = `<div class="field"><label for="newTok">Copy this token now — it will not be shown again</label><textarea class="input mono" id="newTok" readonly>${esc(r.token)}</textarea><button class="btn" data-copytok>${icon('connections')}Copy token</button><p class="help" data-copy-help>Expires ${esc(until(expiresAt))}. Keep it private.</p><p class="help">Claude Code: <code>claude mcp add --transport http ${esc(slug)} ${esc(m.url)} --header &quot;Authorization: Bearer ${esc(r.token)}&quot;</code></p></div>`;
    dlg.querySelector('[data-copytok]').onclick = async () => {
      try { if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(r.token); toast('Token copied'); }
      catch { const input = dlg.querySelector('#newTok'); input.focus(); input.select(); dlg.querySelector('[data-copy-help]').textContent = 'Clipboard unavailable. Token selected — copy it manually and keep it private.'; }
    };
    await ctx.refresh();
  });
  dlg.querySelector('[data-clear]').onclick = () => run(async () => {
    if (!await confirmModal('Clear module token?', 'Clients using this token immediately lose access.', { confirmLabel: 'Clear token', danger: true })) return;
    await api(`${path}/token`, { method: 'DELETE' }); tokenSet = false; expiresAt = null; renderToken(); await ctx.refresh();
  });
  dlg.querySelector('[data-cancel]').onclick = () => { if (!pending) dlg.close(); };
  dlg.addEventListener('cancel', (e) => { if (pending) e.preventDefault(); });
}
