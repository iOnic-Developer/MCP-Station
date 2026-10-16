import { api } from '../api.js';
import { esc, toast, surface, confirmModal, copyText } from '../ui.js';
import { icon } from '../icons.js';
const when = (ms) => ms ? new Date(ms).toLocaleString() : 'Not used yet';
const until = (ms) => ms ? new Date(ms).toLocaleString() : 'No expiry';
const EXPIRY = [['never', 'No expiry'], ['1d', '1 day'], ['1w', '1 week'], ['1m', '1 month']];
export async function openAccess(m, ctx, target) {
  const id = encodeURIComponent(m.id), slug = m.id;
  let tokenSet = Boolean(m.tokenSet);
  let uncopiedToken = false;
  const tokenRow = () => tokenSet ? `<p class="quiet-note">${icon(m.tokenExpiresAt && m.tokenExpiresAt < Date.now() ? 'warning' : 'key')}<span>${m.tokenExpiresAt && m.tokenExpiresAt < Date.now() ? 'This token has expired. Generate a replacement.' : `A private token is saved. ${esc(until(m.tokenExpiresAt))}. It cannot be shown again.`}</span></p>` : '<p class="desc">No integration token has been created.</p>';
  if (target && !target.isConnected) return;
  const dlg = surface({ target, title: `Connect · ${m.manifest?.name || m.id}`, body: `<p class="desc">Choose how your AI client connects. This endpoint belongs only to <strong>${esc(m.manifest?.name || m.id)}</strong>.</p><div class="field"><label>Integration endpoint</label><div class="endpoint"><code class="url">${esc(m.url)}</code><button class="btn sm" data-copy-url>${icon('copy')}Copy URL</button></div></div>${!m.enabled ? '<div class="banner">This integration is disabled. Enable it on its card before connecting a client.</div>' : ''}${!m.configured ? '<div class="banner">Required settings are missing. Configure this integration before connecting.</div>' : ''}<section class="access-section"><h3>Connect with your browser</h3><p class="desc">In claude.ai, go to Settings → Connectors → Add custom connector. Paste the endpoint above, then approve access with your station password.</p>${ctx.me.oauth ? '<p class="help">OAuth authorization is enabled on this station.</p>' : '<div class="banner">OAuth is unavailable. Set PUBLIC_URL in the server environment and restart, or use an integration token with a supported client.</div>'}</section><details class="provider-settings"><summary>Connect with a private token</summary><p class="help">For Claude Code, scripts or automation. This token grants access only to <code>/${esc(slug)}</code>. ${ctx.me.mcpTokenSet ? 'The server’s separate MCP_TOKEN grants access to every integration; use a limited token here when possible.' : 'No station-wide MCP_TOKEN is set.'}</p><div data-token-box>${tokenRow()}</div><div class="field"><label for="tokExpiry">New token lifetime</label><select class="input" id="tokExpiry">${EXPIRY.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select></div><div class="actions"><button class="btn" data-gen>${icon('key')}${tokenSet ? 'Rotate token' : 'Generate token'}</button><button class="btn danger" data-clear ${tokenSet ? '' : 'hidden'}>Revoke token</button></div><p class="help">Keep tokens private. Rotating or revoking one disconnects anything using the old value.</p></details><section class="access-section"><div class="section-heading"><h3>Authorized clients</h3><button class="btn sm" data-refresh>${icon('reload')}Refresh</button></div><p class="help">Clients holding OAuth access to this integration. Revoke a client to require authorization again.</p><div class="list-rows" data-connections role="status">Loading clients…</div></section><p class="error-text" data-error role="alert"></p>`, foot: '<button class="btn primary" data-done>Done</button>' });
  dlg.stationDirty = () => uncopiedToken;
  dlg.stationBeforeClose = async () => {
    if (!uncopiedToken) return true;
    const discard = await confirmModal('Leave without saving your token?', 'This token is shown only once. Copy it to a secure place before leaving, or generate a replacement later.', 'Leave without token');
    if (discard) uncopiedToken = false;
    return discard;
  };
  const error = dlg.querySelector('[data-error]');
  const showError = (e) => { error.textContent = e.message; };
  dlg.querySelector('[data-done]').onclick = () => dlg.close();
  dlg.querySelector('[data-copy-url]').onclick = () => copyText(m.url, 'Endpoint URL copied');
  async function refreshConns() {
    const box = dlg.querySelector('[data-connections]');
    try {
      const { connections } = await api(`/mcps/${id}/connections`);
      if (!dlg.isConnected) return;
      box.innerHTML = connections.length ? connections.map((c) => `<div class="list-row"><span class="grow"><strong>${esc(c.clientName)}</strong>${c.allMcps ? '<span class="tag danger">Station-wide access</span>' : ''}<br><span class="dim">Last used: ${esc(when(c.lastUsedAt))}<br>Expiry: ${esc(until(c.expiresAt))}</span></span><button class="btn sm danger" data-revoke="${esc(c.handle)}">Revoke</button></div>`).join('') : '<p class="quiet-note">No authorized clients yet. Add this endpoint in your client to get started.</p>';
      box.querySelectorAll('[data-revoke]').forEach((b) => { b.onclick = async () => {
        if (!await confirmModal('Revoke client access?', 'This client will lose access immediately and must authorize again.', 'Revoke access')) return;
        b.disabled = true;
        try { await api(`/connections/${encodeURIComponent(b.dataset.revoke)}`, { method: 'DELETE' }); toast('Client access revoked'); await refreshConns(); ctx.refresh(); }
        catch (e) { showError(e); b.disabled = false; }
      }; });
    } catch (e) { box.innerHTML = `<p class="error-text">${esc(e.message)}. Use Refresh to try again.</p>`; }
  }
  dlg.querySelector('[data-refresh]').onclick = refreshConns;
  dlg.querySelector('[data-gen]').onclick = async (e) => {
    const b = e.currentTarget;
    if (tokenSet && !await confirmModal('Replace the current token?', 'The current token stops working immediately. Update every script or client using it.', 'Rotate token')) return;
    b.disabled = true; error.textContent = '';
    try {
      const { token, expiresAt } = await api(`/mcps/${id}/token`, { method: 'POST', body: { expiry: dlg.querySelector('#tokExpiry').value } });
      tokenSet = true; uncopiedToken = true; m.tokenExpiresAt = expiresAt;
      dlg.querySelector('[data-token-box]').innerHTML = `<div class="banner">Copy this token now. You won’t be able to view it again. Expiry: ${esc(until(expiresAt))}.</div><div class="endpoint"><code class="url">${esc(token)}</code><button class="btn sm" data-copy-token>${icon('copy')}Copy token</button></div><p class="help">Use it in the Authorization header of your client:</p><pre class="logbox">claude mcp add --transport http ${esc(slug)} ${esc(m.url)} --header "Authorization: Bearer $TOKEN"</pre>`;
      dlg.querySelector('[data-copy-token]').onclick = async () => {
        if (await copyText(token, 'Token copied. Store it securely.')) uncopiedToken = false;
      };
      const acknowledge = document.createElement('button');
      acknowledge.className = 'btn sm'; acknowledge.textContent = 'I have stored this token securely';
      acknowledge.onclick = () => { uncopiedToken = false; acknowledge.disabled = true; };
      dlg.querySelector('[data-token-box]').appendChild(acknowledge);
      dlg.querySelector('[data-clear]').hidden = false;
      b.innerHTML = `${icon('key')}Rotate token`; ctx.refresh();
    } catch (e) { showError(e); }
    finally { b.disabled = false; }
  };
  dlg.querySelector('[data-clear]').onclick = async (e) => {
    const b = e.currentTarget;
    if (!await confirmModal('Revoke this token?', 'Anything using this token loses access immediately. This does not revoke OAuth clients.', 'Revoke token')) return;
    b.disabled = true;
    try { await api(`/mcps/${id}/token`, { method: 'DELETE' }); tokenSet = false; uncopiedToken = false; dlg.querySelector('[data-token-box]').innerHTML = tokenRow(); b.hidden = true; dlg.querySelector('[data-gen]').innerHTML = `${icon('key')}Generate token`; toast('Integration token revoked'); ctx.refresh(); }
    catch (e) { showError(e); } finally { b.disabled = false; }
  };
  await refreshConns();
}
