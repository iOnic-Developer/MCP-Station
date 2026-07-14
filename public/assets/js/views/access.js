import { api } from '../api.js';
import { esc, toast, modal, confirmModal } from '../ui.js';

const when = (ms) => (ms ? new Date(ms).toLocaleString() : '—');

/** 🔑 Access: this MCP's own bearer token + the live OAuth connectors that can reach it. */
export async function openAccess(m, ctx) {
  let connections = [];
  try {
    ({ connections } = await api(`/mcps/${m.id}/connections`));
  } catch (e) { return toast(e.message, 'err'); }

  const slug = m.manifest?.slug || m.id;
  const dlg = modal({
    title: `🔑 Access — ${m.manifest?.name || m.id}`,
    body: `
      <div class="field"><label>Endpoint</label>
        <div class="endpoint"><span class="url mono">${esc(m.url)}</span></div>
      </div>

      <h4 style="margin:16px 0 8px">This MCP's own token</h4>
      <div class="help" style="margin-bottom:10px">A bearer that opens <b>only</b> /${esc(slug)} — hand it to a script or n8n without giving away the rest of the station. The station-wide <span class="mono">MCP_TOKEN</span> ${ctx.me.mcpTokenSet ? 'is set and still opens every MCP' : 'is not set'}.</div>
      <div id="tokBox">${m.tokenSet
        ? `<div class="list-row"><span class="grow">✅ A token is set (stored encrypted — it can't be shown again)</span></div>`
        : `<div class="list-row"><span class="grow dim">No token yet</span></div>`}</div>
      <div class="actions" style="margin-top:10px">
        <button class="btn sm" data-gen>${m.tokenSet ? '🔄 Rotate token' : '🔑 Generate token'}</button>
        ${m.tokenSet ? '<button class="btn sm danger" data-clear>Clear</button>' : ''}
      </div>

      <h4 style="margin:20px 0 8px">Connected clients (OAuth)</h4>
      <div class="help" style="margin-bottom:10px">Live tokens that can reach this MCP right now. Revoking kills the connector — the client has to authorise again.</div>
      <div class="list-rows" id="connRows">${renderConns(connections)}</div>`,
    foot: `<div class="spacer"></div><button class="btn primary" data-cancel>Done</button>`
  });

  function renderConns(list) {
    if (!list.length) return `<div class="list-row"><span class="grow dim">Nothing connected yet.</span></div>`;
    return list.map((c) => `
      <div class="list-row">
        <span class="grow">
          <b>${esc(c.clientName)}</b>${c.allMcps ? ' <span class="dim">· ⚠ scoped to ALL MCPs</span>' : ''}<br>
          <span class="dim" style="font-size:11.5px">last used ${esc(when(c.lastUsedAt))} · expires ${esc(when(c.expiresAt))}</span>
        </span>
        <button class="btn sm danger" data-revoke="${esc(c.handle)}">Revoke</button>
      </div>`).join('');
  }

  async function refreshConns() {
    const r = await api(`/mcps/${m.id}/connections`);
    dlg.querySelector('#connRows').innerHTML = renderConns(r.connections);
    wireRevoke();
  }

  function wireRevoke() {
    for (const b of dlg.querySelectorAll('[data-revoke]')) {
      b.onclick = async () => {
        if (!await confirmModal('Revoke this connection?', 'The client loses access immediately and must authorise again.')) return;
        try {
          await api(`/connections/${b.dataset.revoke}`, { method: 'DELETE' });
          toast('Connection revoked');
          await refreshConns();
        } catch (e) { toast(e.message, 'err'); }
      };
    }
  }
  wireRevoke();

  dlg.querySelector('[data-gen]').onclick = async () => {
    if (m.tokenSet && !await confirmModal('Rotate the token?', 'The current token stops working immediately. Anything using it must be updated.')) return;
    try {
      const { token } = await api(`/mcps/${m.id}/token`, { method: 'POST' });
      dlg.querySelector('#tokBox').innerHTML = `
        <div class="field"><label>Copy it now — it is stored encrypted and will never be shown again</label>
          <div class="endpoint"><span class="url mono" id="newTok">${esc(token)}</span>
            <button class="btn sm" data-copytok title="Copy">⧉</button></div>
          <div class="help">Claude Code: <span class="mono">claude mcp add --transport http ${esc(slug)} ${esc(m.url)} --header "Authorization: Bearer ${esc(token)}"</span></div>
        </div>`;
      dlg.querySelector('[data-copytok]').onclick = async () => {
        await navigator.clipboard.writeText(token);
        toast('Token copied');
      };
      ctx.refresh();
    } catch (e) { toast(e.message, 'err'); }
  };

  dlg.querySelector('[data-clear]')?.addEventListener('click', async () => {
    if (!await confirmModal('Clear the token?', `Nothing can reach /${slug} with it afterwards.`)) return;
    try {
      await api(`/mcps/${m.id}/token`, { method: 'DELETE' });
      toast('Token cleared');
      dlg.close();
      ctx.refresh();
    } catch (e) { toast(e.message, 'err'); }
  });

  dlg.querySelector('[data-cancel]').onclick = () => dlg.close();
}
