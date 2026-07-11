import { esc, toast, md } from '../ui.js';

const STORE = 'station.chat.v1';

/** Floating ✦ Claude popup. Chat persists in localStorage; instructions live server-side. */
export function mountAssistant(ctx) {
  if (document.querySelector('.fab')) return;

  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.title = 'Station Claude — knows this site and how to build MCPs for it';
  fab.textContent = '✦';
  document.body.appendChild(fab);

  const panel = document.createElement('div');
  panel.className = 'assistant';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="a-head">✦ Station Claude
      <span class="sub">knows this station &amp; the module contract</span>
      <div class="spacer"></div>
      <button class="btn sm" data-clear title="Clear conversation">🧹</button>
      <button class="btn sm" data-close>✕</button>
    </div>
    <div class="a-msgs" id="aMsgs"></div>
    <div class="a-input">
      <textarea class="input" id="aInput" rows="2" placeholder="e.g. Build me a weather MCP using open-meteo, no key needed"></textarea>
      <button class="btn primary" id="aSend">Send</button>
    </div>`;
  document.body.appendChild(panel);

  const msgsEl = panel.querySelector('#aMsgs');
  const input = panel.querySelector('#aInput');
  const sendBtn = panel.querySelector('#aSend');

  let history = [];
  try { history = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { /* fresh */ }

  function persist() { localStorage.setItem(STORE, JSON.stringify(history.slice(-60))); }

  function renderAll() {
    msgsEl.innerHTML = history.length ? '' : `<div class="msg bot">Hi — I'm the resident Claude. I know how this station works and exactly how its MCP modules are built.<br><br>Ask me to <b>write a new MCP</b>, debug one, or explain the OAuth hookup. I'll give you complete files to paste into the Code editor.</div>`;
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
    const text = input.value.trim();
    if (!text || sendBtn.disabled) return;
    input.value = '';
    history.push({ role: 'user', content: text });
    persist();
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
        body: JSON.stringify({ messages: history })
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
          if (ev.error) throw new Error(ev.error);
        }
      }
      if (acc) {
        history.push({ role: 'assistant', content: acc });
        persist();
      }
    } catch (e) {
      toast(e.message, 'err', 6000);
      if (!acc) history.pop(); // roll back the user turn so retry is clean
      persist();
    } finally {
      think.remove();
      sendBtn.disabled = false;
      input.focus();
    }
  }

  fab.onclick = () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { renderAll(); input.focus(); }
  };
  panel.querySelector('[data-close]').onclick = () => { panel.hidden = true; };
  panel.querySelector('[data-clear]').onclick = () => { history = []; persist(); renderAll(); };
  sendBtn.onclick = send;
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // copy buttons inside code blocks (delegated)
  msgsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-copy-code]');
    if (!btn) return;
    navigator.clipboard.writeText(btn.nextElementSibling?.textContent || btn.parentElement.textContent.replace(/^Copy/, ''));
    toast('Code copied — paste it in the module editor');
  });
}
