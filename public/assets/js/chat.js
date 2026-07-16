import { esc, toast, md } from './ui.js';

/**
 * Streaming chat pane, shared by the ✦ station popup and the per-MCP editor chat.
 * History lives wherever the caller says: `history` is the starting array, `persist`
 * is called with the updated array after every turn (localStorage / module folder).
 * `extra()` adds fields to the POST body — the editor passes { mcpId } to scope it.
 */
export function chatPane({ el, greeting, history = [], persist = () => {}, extra = () => ({}), placeholder = 'Ask…', fields = [] }) {
  el.innerHTML = `
    <div class="a-msgs"></div>
    ${fields.length ? `<div class="a-fields" title="Optional — leave blank and the assistant finds what it needs">${fields
      .map((f) => `<input class="input" data-field="${esc(f.key)}" placeholder="${esc(f.placeholder)}">`)
      .join('')}</div>` : ''}
    <div class="a-input">
      <textarea class="input" rows="2" placeholder="${esc(placeholder)}"></textarea>
      <button class="btn primary">Send</button>
    </div>`;
  const msgsEl = el.querySelector('.a-msgs');
  const input = el.querySelector('textarea');
  const sendBtn = el.querySelector('.a-input button');
  const fieldEls = [...el.querySelectorAll('.a-fields input')];

  function render() {
    msgsEl.innerHTML = history.length ? '' : `<div class="msg bot">${greeting}</div>`;
    for (const m of history) addBubble(m.role, m.content, false);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }

  function addBubble(role, content, scroll = true) {
    const div = document.createElement('div');
    div.className = `msg ${role === 'user' ? 'user' : 'bot'}`;
    div.innerHTML = role === 'user' ? esc(content).replace(/\n/g, '<br>') : md(content);
    msgsEl.appendChild(div);
    if (scroll) msgsEl.scrollTop = msgsEl.scrollHeight;
    return div;
  }

  async function send() {
    let text = input.value.trim();
    if (!text || sendBtn.disabled) return;
    // Optional context fields (API host / docs) ride along inside the message so they
    // persist in history and work identically on both providers.
    const hints = fields
      .map((f, i) => ({ label: f.label || f.key, val: fieldEls[i]?.value.trim() }))
      .filter((h) => h.val)
      .map((h) => `${h.label}: ${h.val}`);
    if (hints.length) text += `\n\n(${hints.join(' · ')})`;
    input.value = '';
    history.push({ role: 'user', content: text });
    addBubble('user', text);

    sendBtn.disabled = true;
    const think = document.createElement('div');
    think.className = 'thinking';
    think.textContent = 'thinking';
    msgsEl.appendChild(think);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    let bubble = null;
    let acc = '';
    try {
      const r = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-station-csrf': '1' },
        body: JSON.stringify({ messages: history, ...extra() })
      });
      if (!r.ok) {
        const e = await r.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let ev;
          try { ev = JSON.parse(line.slice(6)); } catch { continue; }
          if (ev.text) {
            acc += ev.text;
            think.remove();
            if (!bubble) bubble = addBubble('assistant', '');
            bubble.innerHTML = md(acc);
            msgsEl.scrollTop = msgsEl.scrollHeight;
          }
          if (ev.tool) {
            // Tool status line — a new text bubble follows it, so close the current one.
            const t = ev.tool;
            if (t.status === 'running') {
              const note = addBubble('assistant', '');
              note.classList.add('tool-note');
              note.innerHTML = `🛠 <code>${esc(t.name)}</code> …`;
            } else {
              const notes = msgsEl.querySelectorAll('.tool-note');
              const last = notes[notes.length - 1];
              if (last) last.innerHTML = `${t.ok ? '✅' : '⚠️'} <code>${esc(t.name)}</code>${t.detail ? ` — ${esc(String(t.detail))}` : ''}`;
              if (acc) { history.push({ role: 'assistant', content: acc }); acc = ''; bubble = null; }
            }
          }
          if (ev.modules_changed) {
            toast('Modules updated — refreshing');
            window.dispatchEvent(new CustomEvent('station:mcps-changed'));
          }
          if (ev.error) throw new Error(ev.error);
        }
      }
      if (acc) history.push({ role: 'assistant', content: acc });
      await persist(history);
    } catch (e) {
      toast(e.message, 'err', 6000);
      if (!acc) history.pop(); // roll back the user turn so retry is clean
      await persist(history);
    } finally {
      think.remove();
      sendBtn.disabled = false;
      input.focus();
    }
  }

  sendBtn.onclick = send;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  msgsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy-code]');
    if (!btn) return;
    navigator.clipboard.writeText(codeOf(btn));
    toast('Code copied');
  });

  render();
  return {
    msgsEl,
    input,
    render,
    clear: async () => { history.length = 0; await persist(history); render(); }
  };
}

/** The <code> text belonging to a button inside a rendered code block. */
export function codeOf(btn) {
  return btn.nextElementSibling?.textContent || btn.parentElement.textContent.replace(/^Copy/, '');
}
