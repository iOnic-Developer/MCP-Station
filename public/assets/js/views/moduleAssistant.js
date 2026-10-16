import { api } from '../api.js';
import { chatPane } from '../chat.js';
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
  let chat, disposed = false;
  panel.addEventListener('station:dispose', () => { disposed = true; chat?.dispose(); }, { once: true });
  panel.stationRefresh = () => {
    panel.querySelector('[data-provider-warning]').hidden = Boolean(ctx.me.hasAssistantKey || ctx.me.hasAnthropicKey);
  };
  panel.stationRefresh();
  const path = `/mcps/${encodeURIComponent(source.id)}/chat`;
  async function load() {
    try {
      const { messages = [] } = await api(path);
      if (disposed || !panel.isConnected) return;
      chat = chatPane({
        el: panel.querySelector('.chat-body'),
        history: messages,
        persist: (h) => api(path, { method: 'PUT', body: { messages: h } }),
        extra: () => ({ mcpId: source.id }),
        placeholder: `Ask about ${name}, or describe a change…`,
        greeting: `<h2>Work on ${esc(name)}</h2><p>Ask me to explain a tool, diagnose a connection or improve this service’s code. I can edit its files directly; changes affect every account of this service.</p>`
      });
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
