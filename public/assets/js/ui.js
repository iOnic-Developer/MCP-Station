/** Shared accessible UI; HTML arguments are trusted templates, dynamic text must be escaped. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
let sequence = 0;
export function toast(msg, kind = 'ok', ms = 6000) {
  const container = document.getElementById('toasts');
  if (!container) return;
  const t = document.createElement('div'); t.className = `toast ${kind}`;
  const text = document.createElement('span'); text.textContent = msg;
  const dismiss = document.createElement('button'); dismiss.className = 'btn sm'; dismiss.type = 'button';
  dismiss.textContent = 'Dismiss'; dismiss.onclick = () => t.remove();
  t.append(text,dismiss); container.append(t);
  if (kind !== 'err' && ms > 0) setTimeout(() => t.remove(),ms);
}
function restoreFocus(previous) {
  queueMicrotask(() => {
    if (previous?.isConnected && !previous.disabled) previous.focus({preventScroll:true});
  });
}
function containFocus(dialog) {
  dialog.tabIndex = -1;
  const controls = () => [...dialog.querySelectorAll('button,input,textarea,select,a[href],[tabindex]')].filter(el => !el.disabled && el.tabIndex >= 0 && el.getClientRects().length);
  dialog.addEventListener('keydown',event => {
    if (event.key !== 'Tab' || [...document.querySelectorAll('dialog[open]')].at(-1) !== dialog) return;
    const items = controls();
    const index = items.indexOf(document.activeElement);
    if (!items.length) { event.preventDefault(); dialog.focus(); }
    else if (event.shiftKey && index <= 0) { event.preventDefault(); items.at(-1).focus(); }
    else if (!event.shiftKey && (index < 0 || index === items.length-1)) { event.preventDefault(); items[0].focus(); }
  });
  // Async loading can disable the initial button. Keep focus inside the top dialog.
  const observer = new MutationObserver(() => {
    if (dialog.open && [...document.querySelectorAll('dialog[open]')].at(-1) === dialog && !dialog.contains(document.activeElement)) (controls()[0] || dialog).focus();
  });
  observer.observe(dialog,{subtree:true,attributes:true,attributeFilter:['disabled'],childList:true});
  dialog.addEventListener('close',() => observer.disconnect(),{once:true});
}
export function modal({title,body,foot=''}) {
  const previous = document.activeElement;
  const dlg = document.createElement('dialog'); dlg.className = 'modal';
  const id = `modal-title-${++sequence}`;
  dlg.setAttribute('aria-labelledby',id);
  dlg.innerHTML = `<div class="m-head"><h2 id="${id}">${esc(title)}</h2><button type="button" class="btn sm x" data-x aria-label="Close ${esc(title)}">Close</button></div><div class="m-body">${body}</div>${foot ? `<div class="m-foot">${foot}</div>` : ''}`;
  document.body.append(dlg); containFocus(dlg);
  dlg.querySelector('[data-x]').onclick = () => { if (dlg.getAttribute('aria-busy') !== 'true') dlg.close(); };
  dlg.addEventListener('cancel',e => { if (dlg.getAttribute('aria-busy') === 'true') e.preventDefault(); });
  dlg.addEventListener('close',() => { dlg.remove(); restoreFocus(previous); },{once:true});
  dlg.showModal();
  return dlg;
}
export function confirmModal(title,text,{confirmLabel='Continue',danger=true}={}) {
  return new Promise(resolve => {
    const dlg = modal({ title, body:`<p>${esc(text)}</p>`, foot:`<button type="button" class="btn" data-no>Cancel</button><button type="button" class="btn ${danger?'danger':'primary'}" data-yes>${esc(confirmLabel)}</button>` });
    let answer = false;
    dlg.querySelector('[data-no]').onclick = () => dlg.close();
    dlg.querySelector('[data-yes]').onclick = () => { answer = true; dlg.close(); };
    dlg.addEventListener('close',() => resolve(answer),{once:true});
    dlg.querySelector('[data-no]').focus();
  });
}
export function drawer({title,body,foot=''}) {
  const previous = document.activeElement;
  const el = document.createElement('dialog'); el.className = 'drawer';
  const id = `drawer-title-${++sequence}`; el.setAttribute('aria-labelledby',id);
  el.innerHTML = `<div class="d-head"><h2 id="${id}">${esc(title)}</h2><button type="button" class="btn sm" data-x aria-label="Close ${esc(title)}">Close</button></div><div class="d-body">${body}</div>${foot?`<div class="d-foot">${foot}</div>`:''}`;
  let checking = false;
  const state = {
    el, guardClose:null,
    async close() {
      if (checking || !el.open) return;
      checking = true;
      try { if (!state.guardClose || await state.guardClose()) state.forceClose(); }
      finally { checking = false; }
    },
    forceClose() { if (el.open) el.close(); }
  };
  el.querySelector('[data-x]').onclick = state.close;
  el.addEventListener('cancel',e => { e.preventDefault(); state.close(); });
  el.addEventListener('click',e => {
    if (e.target !== el) return;
    const r = el.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) state.close();
  });
  el.addEventListener('close',() => { el.remove(); restoreFocus(previous); },{once:true});
  document.body.append(el); containFocus(el); el.showModal(); return state;
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
