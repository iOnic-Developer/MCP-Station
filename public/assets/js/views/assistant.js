import { chatPane } from '../chat.js';
import { esc } from '../ui.js';

const STORE = 'station.chat.v1';

/** Floating ✦ station popup. Chat persists in localStorage; instructions live server-side. */
export function mountAssistant(ctx) {
  if (document.querySelector('.fab')) return;

  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.title = 'Station assistant — knows this site and how to build MCPs for it';
  fab.textContent = '✦';
  document.body.appendChild(fab);

  const gemini = ctx.me.provider === 'gemini';
  const who = gemini ? 'Gemini' : 'Claude';

  const panel = document.createElement('div');
  panel.className = 'assistant chat';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="a-head">✦ Station assistant
      <span class="sub">${who} · ${ctx.me.model || ''}</span>
      <div class="spacer"></div>
      <button class="btn sm" data-clear title="Clear conversation">🧹</button>
      <button class="btn sm" data-close>✕</button>
    </div>
    <div class="chat-body"></div>`;
  document.body.appendChild(panel);

  let history = [];
  try { history = JSON.parse(localStorage.getItem(STORE) || '[]'); } catch { /* fresh */ }

  const chat = chatPane({
    el: panel.querySelector('.chat-body'),
    history,
    persist: (h) => localStorage.setItem(STORE, JSON.stringify(h.slice(-60))),
    placeholder: 'e.g. Make me a Gmail MCP',
    fields: [
      { key: 'apiHost', label: 'API base URL', placeholder: 'API base URL (optional — I can usually find it)' },
      { key: 'apiDocs', label: 'API docs', placeholder: 'API docs link (optional)' }
    ],
    greeting: `Hi — I'm the station assistant, running on <b>${who}</b> (${esc(ctx.me.model || '')}). Switch provider in ⚙ Station.<br><br>Ask me to <b>build an MCP</b> and I'll <b>actually create it</b> on this station and reload it live — say <i>“make one for Gmail”</i> and I'll find everything I need. The two boxes below are <b>optional</b>: fill them only if you want to point me at a specific API host or docs page.<br><br>For changes to an <i>existing</i> module, open its <b>‹/› Code</b> drawer — the chat in there can see that module's files.`
  });

  fab.onclick = () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { chat.render(); chat.input.focus(); }
  };
  panel.querySelector('[data-close]').onclick = () => { panel.hidden = true; };
  panel.querySelector('[data-clear]').onclick = chat.clear;
}
