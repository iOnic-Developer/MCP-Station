import { api } from '../api.js';
import { esc, toast } from '../ui.js';
export function accounts(source) {
  return source.instances?.length ? source.instances : [{ ...source, sourceId: source.id, name: 'Default account' }];
}
export function selected(source, ctx, requested) {
  ctx.accountSelection ||= new Map();
  const list = accounts(source);
  const account = list.find((a) => a.id === (requested || ctx.accountSelection.get(source.id))) || list[0];
  ctx.accountSelection.set(source.id, account.id);
  return { ...source, ...account, manifest: source.manifest, sourceId: source.id };
}
export function accountSelect(source, ctx) {
  const m = selected(source, ctx);
  return `<label class="account-picker"><span>Account</span><select class="input" data-account aria-label="Account for ${esc(source.manifest?.name || source.id)}">${accounts(source).map((a) => `<option value="${esc(a.id)}" ${a.id === m.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></label>`;
}
export function workspaceUrl(sourceId, tab = 'settings', accountId) {
  return `#/integrations/${encodeURIComponent(sourceId)}/${encodeURIComponent(tab)}${accountId ? `?${new URLSearchParams({ account: accountId })}` : ''}`;
}
export function statusOf(m) {
  if (m.error) return { cls: 'err', label: 'Load error', kind: 'error' };
  if (m.lastTest?.ok === false) return { cls: 'err', label: 'Last test failed', kind: 'error' };
  if (!m.configured) return { cls: 'warn', label: 'Setup needed', kind: 'setup' };
  if (!m.enabled) return { cls: '', label: 'Disabled', kind: 'disabled' };
  return { cls: 'ok', label: 'Enabled', kind: 'live' };
}
export function testCopy(m) {
  return m.lastTest ? `${m.lastTest.ok ? 'Test passed' : 'Test failed'}${m.lastTest.at ? ` · ${new Date(m.lastTest.at).toLocaleString()}` : ''} — ${m.lastTest.message || 'No message returned'}` : 'Not tested yet. Enabled does not mean verified.';
}
export async function testAccount(m, button, output, ctx) {
  button.disabled = true; output.textContent = 'Testing connection…';
  try {
    const r = await api(`/mcps/${encodeURIComponent(m.id)}/test`, { method: 'POST' });
    output.textContent = `${r.ok ? 'Test passed' : 'Test failed'}: ${r.message}`;
    output.classList.toggle('error-text', !r.ok);
    await ctx.refresh();
  } catch (e) { output.textContent = `Test could not run: ${e.message}`; output.classList.add('error-text'); toast(e.message, 'err'); }
  finally { button.disabled = false; }
}
