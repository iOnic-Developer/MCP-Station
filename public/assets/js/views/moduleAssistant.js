import { getSourceSession } from '../chatSessions.js';
import { esc, confirmModal } from '../ui.js';
import { icon } from '../icons.js';

/** Source-scoped inline workspace: account selection never broadens the tool scope. */
export async function renderModuleAssistant(root, source, ctx) {
  const panel = document.createElement('section');
  panel.className = 'module-assistant assistant-page page-surface chat panel';
  panel.dataset.moduleAssistant = '';
  const name = source.manifest?.name || source.id;
  panel.innerHTML = `<div class="a-head">${icon('assistant')}<div><h2>${esc(name)} Assistant</h2><span class="sub">Source-scoped conversation · shared by this service’s accounts</span></div><div class="spacer"></div><button class="btn sm" data-clear disabled aria-label="Clear module conversation">${icon('trash')}Clear chat</button></div><p class="assistant-scope-note">The assistant can edit shared code for <strong>all accounts</strong> of this service. Account settings and credentials remain independent. Review and test changes.</p><div class="banner" data-provider-warning hidden>Add an API key in <a href="#/settings">Settings</a> to start chatting.</div><div class="chat-body"><p class="loading" role="status">Loading conversation…</p></div>`;
  root.replaceChildren(panel);
  let chat, session, disposed = false;
  panel.addEventListener('station:dispose', () => { disposed = true; session?.detach(panel.querySelector('.chat-body')); }, { once: true });
  panel.stationRefresh = () => {
    panel.querySelector('[data-provider-warning]').hidden = Boolean(ctx.me.hasAssistantKey || ctx.me.hasAnthropicKey);
  };
  panel.stationRefresh();
  async function load() {
    try {
      session = await getSourceSession(source);
      if (disposed || !panel.isConnected) return;
      session.mount(panel.querySelector('.chat-body'));
      chat = session.chat;
      if (ctx.pendingAssistantPrompt) { session.setDraft(ctx.pendingAssistantPrompt); ctx.pendingAssistantPrompt = ''; }
      chat.msgsEl.tabIndex = 0;
      panel.querySelector('[data-clear]').disabled = false;
      panel.querySelector('[data-clear]').onclick = async () => {
        if (await confirmModal('Clear this conversation?', 'This clears the shared source conversation for all accounts of this service. It does not undo file changes.', 'Clear conversation')) chat.clear();
      };
    } catch (e) {
      if (disposed || !panel.isConnected) return;
      panel.querySelector('.chat-body').innerHTML = `<div class="assistant-load-error"><p class="error-text" role="alert">Could not load conversation: ${esc(e.message)}</p><button class="btn" data-retry>Try again</button></div>`;
      panel.querySelector('[data-retry]').onclick = load;
    }
  }
  await load();
}
