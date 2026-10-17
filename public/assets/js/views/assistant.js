import { getStationSession, resetChatSessions } from '../chatSessions.js';
import { esc, confirmModal } from '../ui.js';
import { icon } from '../icons.js';
let panel, chat;
export function parkAssistant() { panel?.remove(); }
export function resetAssistant() { resetChatSessions(); panel?.remove(); panel = null; chat = null; }
/** Route disposal parks the pane; only application teardown aborts its stream. */
export function renderAssistant(root, ctx) {
  if (!panel) {
    const provider = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini' }[ctx.me.provider] || ctx.me.provider;
    panel = document.createElement('section'); panel.className = 'assistant-page page-surface chat panel';
    panel.innerHTML = `<div class="a-head">${icon('assistant')}<div><h1>Assistant</h1><span class="sub">${esc(provider)} · ${esc(ctx.me.model || 'No model selected')}</span></div><div class="spacer"></div><button class="btn sm" data-clear>${icon('trash')}Clear chat</button></div><div class="banner" data-provider-warning hidden>Add an API key in <a href="#/settings">Settings</a> to start chatting.</div><div class="chat-body"></div>`;
    panel.addEventListener('station:dispose', parkAssistant);
    panel.querySelector('[data-clear]').onclick = async () => { if (await confirmModal('Clear this conversation?', 'This removes the conversation saved in this browser. It does not undo changes made to integrations.', 'Clear conversation')) chat.clear(); };
  }
  const session = getStationSession();
  session.mount(panel.querySelector('.chat-body'));
  chat = session.chat;
  const refresh = () => {
    if (!panel) return;
    const providerName = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Google Gemini' }[ctx.me.provider] || ctx.me.provider;
    panel.querySelector('.sub').textContent = `${providerName} · ${ctx.me.model || 'No model selected'}`;
    panel.querySelector('[data-provider-warning]').hidden = Boolean(ctx.me.hasAssistantKey || ctx.me.hasAnthropicKey);
  };
  ctx.workspaceRefresh = refresh;
  refresh();
  root.appendChild(panel);
  if (ctx.pendingAssistantPrompt) { getStationSession().setDraft(ctx.pendingAssistantPrompt); ctx.pendingAssistantPrompt = ''; }
}
export function mountAssistant() { location.hash = '/assistant'; }
