/** Tiny shared UI helpers: escaping, toasts, modals, markdown-lite. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function toast(msg, kind = 'ok', ms = 3200) {
  const t = document.createElement('div');
  t.className = `toast ${kind}`;
  t.textContent = msg;
  document.getElementById('toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}

/** Open a modal from HTML. Returns the <dialog>; wire events on it, then dlg.close(). */
export function modal({ title, body, foot = '' }) {
  const dlg = document.createElement('dialog');
  dlg.className = 'modal';
  dlg.innerHTML = `
    <div class="m-head">${esc(title)}<button class="btn sm x" data-x>✕</button></div>
    <div class="m-body">${body}</div>
    ${foot ? `<div class="m-foot">${foot}</div>` : ''}`;
  document.body.appendChild(dlg);
  dlg.querySelector('[data-x]').onclick = () => dlg.close();
  dlg.addEventListener('close', () => dlg.remove());
  dlg.showModal();
  return dlg;
}

export function confirmModal(title, text) {
  return new Promise((resolve) => {
    const dlg = modal({
      title,
      body: `<p style="margin:0">${esc(text)}</p>`,
      foot: `<button class="btn" data-no>Cancel</button><button class="btn danger" data-yes>Yes, do it</button>`
    });
    dlg.querySelector('[data-no]').onclick = () => { resolve(false); dlg.close(); };
    dlg.querySelector('[data-yes]').onclick = () => { resolve(true); dlg.close(); };
    dlg.addEventListener('close', () => resolve(false), { once: true });
  });
}

/** Drawer (right panel). Returns { el, close }. */
export function drawer({ title, body, foot = '' }) {
  const back = document.createElement('div');
  back.className = 'drawer-backdrop';
  const d = document.createElement('div');
  d.className = 'drawer';
  d.innerHTML = `
    <div class="d-head"><h2>${esc(title)}</h2><button class="btn sm" data-x>✕</button></div>
    <div class="d-body">${body}</div>
    ${foot ? `<div class="d-foot">${foot}</div>` : ''}`;
  const close = () => { back.remove(); d.remove(); };
  back.onclick = close;
  d.querySelector('[data-x]').onclick = close;
  document.body.append(back, d);
  return { el: d, close };
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
