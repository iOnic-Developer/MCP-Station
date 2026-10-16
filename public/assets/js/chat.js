import { esc, toast, md, copyText } from './ui.js';

/**
 * Streaming chat pane, shared by the ✦ station popup and the per-MCP editor chat.
 * History lives wherever the caller says: `history` is the starting array, `persist`
 * is called with the updated array after every turn (localStorage / module folder).
 * `extra()` adds fields to the POST body — the editor passes { mcpId } to scope it.
 *
 * Server events (one SSE stream per turn): {text} deltas, {tool} status lines, {notice}
 * (a cut-off reply, the hop limit — shown, never persisted), {file_changed} (a tool wrote a
 * module file → `station:module-file-changed` for the editor), {modules_changed} (→ one
 * `station:mcps-changed` per turn), {error}, then {done}. A stream that ends without
 * {done} was cut by something between here and the station — say so instead of going quiet.
 */
export function chatPane({ el, greeting, history = [], persist = () => {}, extra = () => ({}), placeholder = 'Ask…', fields = [] }) {
  let controller = null;
  let disposed = false;
  const saveHistory = async () => { if (disposed) return; try { await persist(history); } catch { toast('Conversation could not be saved. Your current messages are still visible.', 'err'); } };
  el.innerHTML = `
    <div class="a-msgs" role="log" aria-label="Conversation" aria-live="polite" aria-relevant="additions"></div>
    ${fields.length ? `<details class="chat-options"><summary>Add API context (optional)</summary><div class="a-fields">${fields
      .map((f) => `<label>${esc(f.label)}<input class="input" data-field="${esc(f.key)}" placeholder="${esc(f.placeholder)}"></label>`)
      .join('')}</div></details>` : ''}
    <div class="a-input">
      <textarea class="input" rows="2" aria-label="Message to the assistant" placeholder="${esc(placeholder)}"></textarea>
      <button class="btn primary">Send</button><button class="btn" data-stop hidden>Stop</button>
    </div><p class="chat-hint">Enter to send · Shift + Enter for a new line. Review changes before using them.</p><p class="chat-error" role="alert" hidden></p>`;
  const msgsEl = el.querySelector('.a-msgs');
  const input = el.querySelector('textarea');
  const sendBtn = el.querySelector('.a-input button');
  const stopBtn = el.querySelector('[data-stop]');
  const errorEl = el.querySelector('.chat-error');
  stopBtn.onclick = () => controller?.abort();
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

  /** Dashed status line (tool progress, notices) — shown in the transcript, never persisted. */
  function addNote(html, kind = '') {
    const note = addBubble('assistant', '');
    note.className = `msg bot tool-note ${kind}`.trim();
    note.innerHTML = html;
    return note;
  }

  async function send() {
    const typed = input.value.trim();
    if (!typed || sendBtn.disabled || disposed) return;
    errorEl.hidden = true;
    controller = new AbortController();
    stopBtn.hidden = false;
    // Optional context fields (API host / docs) ride along inside the message so they
    // persist in history and work identically on both providers.
    const hints = fields
      .map((f, i) => ({ label: f.label || f.key, val: fieldEls[i]?.value.trim() }))
      .filter((h) => h.val)
      .map((h) => `${h.label}: ${h.val}`);
    const text = hints.length ? `${typed}\n\n(${hints.join(' · ')})` : typed;
    input.value = '';
    history.push({ role: 'user', content: text });
    const userBubble = addBubble('user', text);

    sendBtn.disabled = true;
    const think = document.createElement('div');
    think.className = 'thinking';
    think.textContent = 'Working on your request…';
    think.setAttribute('role', 'status');
    msgsEl.appendChild(think);
    msgsEl.scrollTop = msgsEl.scrollHeight;

    let bubble = null;
    let acc = '';
    let gotDone = false;
    let modulesChanged = false;
    // Text before a tool call is its own bubble in the transcript; close it out and save it,
    // so a turn that dies half-way keeps what already arrived.
    const closeSegment = () => {
      if (!acc) return;
      history.push({ role: 'assistant', content: acc });
      acc = '';
      bubble = null;
      void saveHistory();
    };

    try {
      const r = await fetch('/api/assistant', {
        signal: controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-station-csrf': '1' },
        body: JSON.stringify({ messages: history, ...extra() })
      });
      if (!r.ok) {
        if (r.status === 401) window.dispatchEvent(new Event('station:unauthed'));
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
            const t = ev.tool;
            if (t.status === 'running') {
              closeSegment();
              addNote(`Running <code>${esc(t.name)}</code>…`);
            } else {
              const notes = msgsEl.querySelectorAll('.tool-note');
              const last = notes[notes.length - 1];
              if (last) last.innerHTML = `${t.ok ? 'Completed:' : 'Failed:'} <code>${esc(t.name)}</code>${t.detail ? ` — ${esc(String(t.detail))}` : ''}`;
            }
            msgsEl.scrollTop = msgsEl.scrollHeight;
          }
          if (ev.notice) {
            closeSegment();
            think.remove();
            addNote(`Notice: ${esc(ev.notice)}`, 'notice');
          }
          if (ev.file_changed) {
            window.dispatchEvent(new CustomEvent('station:module-file-changed', { detail: ev.file_changed }));
          }
          if (ev.modules_changed) modulesChanged = true;
          if (ev.error) throw new Error(ev.error);
          if (ev.done) gotDone = true;
        }
      }
      closeSegment();
      if (!gotDone) throw new Error('The connection dropped before the reply finished (a proxy timeout, usually) — try again.');
    } catch (e) {
      const message = e.name === 'AbortError' ? 'Reply stopped. Any completed tool changes are kept.' : e.message;
      if (!disposed) { errorEl.textContent = message; errorEl.hidden = false; }
      closeSegment();
      if (history[history.length - 1]?.role === 'user') {
        // Nothing came back: roll the turn back and hand the text back for a clean retry.
        history.pop();
        userBubble.remove();
        input.value = typed;
      }
    } finally {
      think.remove();
      sendBtn.disabled = false;
      stopBtn.hidden = true;
      if (input.isConnected && !disposed) input.focus();
      if (!disposed) await saveHistory();
      if (modulesChanged && !disposed) {
        toast('Modules updated — refreshing');
        window.dispatchEvent(new CustomEvent('station:mcps-changed'));
      }
    }
  }

  sendBtn.onclick = send;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  msgsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy-code]');
    if (!btn) return;
    void copyText(codeOf(btn), 'Code copied');
  });

  render();
  return {
    msgsEl,
    input,
    render,
    dispose: () => { disposed = true; controller?.abort(); },
    clear: async () => { if (sendBtn.disabled) return toast('Stop the current reply before clearing the conversation.', 'err'); history.length = 0; await saveHistory(); render(); }
  };
}

/** The <code> text belonging to a button inside a rendered code block. */
export function codeOf(btn) {
  return btn.closest('pre')?.querySelector('code')?.textContent ?? '';
}
