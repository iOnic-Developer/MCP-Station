import { chatPane } from '../chat.js';
import { esc, confirmModal } from '../ui.js';
import { icon } from '../icons.js';
const STORE = 'station.chat.v1';
let panel, chat;
export function resetAssistant() { chat?.dispose(); panel?.remove(); panel = null; chat = null; }
/** Keep the pane on metadata refresh; the router disposes its stream when leaving. */
export function renderAssistant(root, ctx) {
  if (!panel) {
    const provider = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini' }[ctx.me.provider] || ctx.me.provider;
    panel = document.createElement('section'); panel.className = 'assistant-page chat panel';
    panel.innerHTML = `<div class="a-head">${icon('assistant')}<div><strong>Station Assistant</strong><span class="sub">${esc(provider)} · ${esc(ctx.me.model || 'No model selected')}</span></div><div class="spacer"></div><button class="btn sm" data-clear>${icon('trash')}Clear chat</button></div><div class="banner" data-provider-warning hidden>Add an API key in <a href="#/settings">Settings</a> to start chatting.</div><div class="chat-body"></div>`;
    let history = [];
    try { const saved = JSON.parse(localStorage.getItem(STORE) || '[]'); if (Array.isArray(saved)) history = saved.filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string'); } catch {}
    chat = chatPane({ el: panel.querySelector('.chat-body'), history, persist: (h) => { try { localStorage.setItem(STORE, JSON.stringify(h.slice(-60))); } catch {} }, placeholder: 'Ask a question, or describe an integration to build…', fields: [{ key: 'apiHost', label: 'API base URL (optional)', placeholder: 'https://api.example.com' }, { key: 'apiDocs', label: 'API documentation (optional)', placeholder: 'Link to the service’s API docs' }], greeting: `<h2>What would you like to connect?</h2><p>I can explain your integrations, build new ones and edit their code. Try “Explain how to connect Claude” or “Build an integration for my service”.</p><p class="help">I can change files on this station. Review the tools and test an integration before relying on it. For focused changes, open the integration’s code editor.</p>` });
    panel.querySelector('[data-clear]').onclick = async () => { if (await confirmModal('Clear this conversation?', 'This removes the conversation saved in this browser. It does not undo changes made to integrations.', 'Clear conversation')) chat.clear(); };
  }
  const providerName = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini' }[ctx.me.provider] || ctx.me.provider;
  panel.querySelector('.sub').textContent = `${providerName} · ${ctx.me.model || 'No model selected'}`;
  panel.querySelector('[data-provider-warning]').hidden = Boolean(ctx.me.hasAssistantKey || ctx.me.hasAnthropicKey);
  root.appendChild(panel);
}
export function mountAssistant() { location.hash = '/assistant'; }
