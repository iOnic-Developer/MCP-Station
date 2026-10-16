import { icon } from './icons.js';
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export function toast(msg, kind = 'ok', ms = 5000) {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.setAttribute('role', kind === 'err' ? 'alert' : 'status');
  t.textContent = msg;
  const global = document.getElementById('toasts') || document.body;
  const activeDialog = [...document.querySelectorAll('dialog[open]')].at(-1);
  if (activeDialog) {
    let local = activeDialog.querySelector(':scope > .dialog-toasts');
    if (!local) { local = document.createElement('div'); local.className = 'toasts dialog-toasts'; activeDialog.appendChild(local); }
    local.appendChild(t);
    activeDialog.addEventListener('close', () => { if (t.parentNode) global.appendChild(t); }, { once: true });
  } else global.appendChild(t);
  setTimeout(() => t.remove(), ms);
}
let sequence = 0;
/** Native dialogs supply focus trapping, Escape and nested top-layer semantics. */
function dialog({ title, body, foot = '', kind }) {
  const previous = document.activeElement;
  const rowId = previous?.closest('[data-id]')?.dataset.id;
  const action = previous?.getAttributeNames?.().find((name) => /^data-[a-z-]+$/.test(name));
  const dlg = document.createElement('dialog');
  const id = `station-dialog-${++sequence}`;
  dlg.className = kind;
  dlg.setAttribute('aria-labelledby', id);
  const prefix = kind === 'drawer' ? 'd' : 'm';
  dlg.innerHTML = `<div class="${prefix}-head"><h2 id="${id}">${esc(title)}</h2><button type="button" class="btn icon-btn" data-x aria-label="Close ${esc(title)}">${icon('close')}</button></div><div class="${prefix}-body">${body}</div>${foot ? `<div class="${prefix}-foot">${foot}</div>` : ''}`;
  document.body.appendChild(dlg);
  labelFields(dlg);
  dlg.stationRequestClose = async () => { if (!dlg.stationBeforeClose || await dlg.stationBeforeClose()) dlg.close(); };
  dlg.querySelector('[data-x]').onclick = () => dlg.stationRequestClose();
  dlg.addEventListener('cancel', (e) => { if (dlg.stationBeforeClose) { e.preventDefault(); void dlg.stationRequestClose(); } });
  dlg.addEventListener('close', () => {
    dlg.dispatchEvent(new Event('station:dispose'));
    dlg.remove();
    const replacement = rowId && action ? document.querySelector(`[data-id="${CSS.escape(rowId)}"] [${action}]`) : null;
    const fallback = [...document.querySelectorAll('dialog[open]')].at(-1)?.querySelector('[data-x]') || document.getElementById('main-content');
    (previous?.isConnected ? previous : replacement || fallback)?.focus({ preventScroll: true });
  }, { once: true });
  dlg.showModal();
  return dlg;
}
/** Wire legacy manifest controls to their visible labels without changing names/contracts. */
export function labelFields(root) {
  for (const label of root.querySelectorAll('.field > label')) {
    if (label.htmlFor) continue;
    const field = label.parentElement.querySelector('input:not([type=hidden]), select, textarea');
    if (!field) continue;
    field.id ||= `station-field-${++sequence}`;
    label.htmlFor = field.id;
    const help = label.parentElement.querySelector('.help');
    if (help) { help.id ||= `station-hint-${++sequence}`; field.setAttribute('aria-describedby', help.id); }
  }
}
export function modal(options) { return dialog({ ...options, kind: 'modal' }); }
export function drawer(options) {
  const el = dialog({ ...options, kind: 'drawer' });
  return { el, close: () => el.stationRequestClose() };
}
/** Functional controls can render directly into a routed page without an overlay. */
export function surface({ target, ...options }) {
  if (!target) return modal(options);
  target.innerHTML = `<section class="page-surface"><div class="m-body">${options.body}</div><div class="m-foot">${options.foot || ''}</div></section>`;
  labelFields(target);
  const el = target.firstElementChild;
  el.close = () => { location.hash = target.dataset.back || '/overview'; };
  el.stationRequestClose = async () => { if (!el.stationBeforeClose || await el.stationBeforeClose()) el.close(); };
  return el;
}
export function confirmModal(title, text, action = 'Confirm') {
  return new Promise((resolve) => {
    const dlg = modal({ title, body: `<p>${esc(text)}</p>`, foot: `<button class="btn" data-no autofocus>Cancel</button><button class="btn danger" data-yes>${esc(action)}</button>` });
    dlg.querySelector('[data-no]').onclick = () => dlg.close();
    dlg.querySelector('[data-yes]').onclick = () => { resolve(true); dlg.close(); };
    dlg.addEventListener('close', () => resolve(false), { once: true });
  });
}
export async function copyText(text, message = 'Copied to clipboard') {
  try { await navigator.clipboard.writeText(text); toast(message); return true; }
  catch { modal({ title: 'Copy manually', body: `<p>Your browser could not access the clipboard. Select and copy this value.</p><textarea class="input mono" aria-label="Value to copy" readonly>${esc(text)}</textarea>` }); return false; }
}
/** Markdown-lite for assistant messages: code fences, inline code, bold, links, newlines. */
export function md(text) {
  let out = '';
  const parts = String(text).split(/```(\w*)\n?/);
  // parts: [text, lang, code, text, lang, code, ...]
  for (let i = 0; i < parts.length; i++) {
    if (i % 3 === 0) {
      out += inline(parts[i]);
    } else if (i % 3 === 2) {
      out += `<pre><button class="btn sm copy-code" data-copy-code>Copy</button><code>${esc(parts[i])}</code></pre>`;
    }
  }
  return out;

  function inline(s) {
    return esc(s)
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br>');
  }
}

/** Page-backed equivalent of a drawer; legacy callers can still opt into a dialog. */
export function workspaceSurface(options) {
  if (!options.target) return drawer(options);
  const el = surface(options);
  return { el, close: () => el.close() };
}
