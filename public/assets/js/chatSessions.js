import { api } from './api.js';
import { chatPane } from './chat.js';
import { esc } from './ui.js';

// The application owns conversations; route views only borrow their DOM node.
const sources = new Map();
let station = null;
let generation = 0;
const STORE = 'station.chat.v1';
const MAX_IDLE = 10;

export function assistantStatus() {
  const sessions = [station, ...[...sources.values()].map((entry) => entry.session)]
    .filter((session) => session?.chat.running)
    .map(({ scope, sourceId, label, href }) => ({ scope, sourceId, label, href }));
  return { count: sessions.length, sessions };
}
function notify() {
  window.dispatchEvent(new CustomEvent('station:assistant-status', { detail: assistantStatus() }));
}
function trimIdle() {
  const idle = [...sources.entries()].filter(([, entry]) => entry.session
    && !entry.session.chat.running && !entry.session.pane.isConnected
    && !entry.session.chat.input.value && !entry.session.pane.querySelector('.a-fields input')?.value);
  for (const [id, entry] of idle.slice(0, Math.max(0, idle.length - MAX_IDLE))) {
    entry.session.chat.dispose(); sources.delete(id);
  }
}
function createSession({ scope, sourceId, label, href, ...options }) {
  const pane = document.createElement('div'); pane.className = 'chat-session';
  // Retain the existing flex layout without requiring stylesheet changes.
  pane.style.display = 'contents';
  const chat = chatPane({ ...options, el: pane, onStatus: () => { notify(); queueMicrotask(trimIdle); } });
  chat.msgsEl.tabIndex = 0;
  const session = {
    scope, sourceId, label, href, pane, chat,
    mount(target) { target.replaceChildren(pane); trimIdle(); },
    detach(target) { if (pane.parentNode === target) pane.remove(); trimIdle(); },
    setDraft(prompt) { chat.input.value = String(prompt ?? ''); }
  };
  return session;
}
export function getStationSession(options = {}) {
  if (!station) {
    let history = [];
    try { const saved = JSON.parse(localStorage.getItem(STORE) || '[]'); if (Array.isArray(saved)) history = saved.filter((m) => m && ['user', 'assistant'].includes(m.role) && typeof m.content === 'string'); } catch {}
    station = createSession({
      placeholder: 'Ask a question, or describe an integration to build…', fields: [{ key: 'apiHost', label: 'API base URL (optional)', placeholder: 'https://api.example.com' }, { key: 'apiDocs', label: 'API documentation (optional)', placeholder: 'Link to the service’s API docs' }], greeting: `<h2>What would you like to connect?</h2><p>I can explain your integrations, build new ones and edit their code. Try “Explain how to connect Claude” or “Build an integration for my service”.</p><p class="help">I can change files on this station. Review the tools and test an integration before relying on it. For focused changes, choose Ask assistant on an integration card.</p>`, ...options, scope: 'station', label: 'Station Assistant', href: '#/assistant', history,
      persist: (messages) => { try { localStorage.setItem(STORE, JSON.stringify(messages.slice(-60))); } catch {} }
    });
  }
  return station;
}
/** One in-flight load and one conversation for the SOURCE id, never an account id. */
export function getSourceSession(source) {
  const id = typeof source === 'string' ? source : source.id;
  if (sources.has(id)) return sources.get(id).promise;
  const version = generation;
  const name = typeof source === 'string' ? id : source.manifest?.name || id;
  const path = `/mcps/${encodeURIComponent(id)}/chat`;
  const entry = {};
  sources.set(id, entry);
  entry.promise = api(path).then(({ messages = [] }) => {
    if (version !== generation) throw new Error('Conversation session ended');
    entry.session = createSession({
      scope: `source:${id}`, sourceId: id, label: `${name} Assistant`, href: `#/integrations/${encodeURIComponent(id)}/assistant`,
      history: messages,
      persist: (history) => version === generation ? api(path, { method: 'PUT', body: { messages: history } }) : undefined,
      extra: () => ({ mcpId: id }),
      placeholder: `Ask about ${name}, or describe a change…`,
      greeting: `<h2>Work on ${esc(name)}</h2><p>Ask me to explain a tool, diagnose a connection or improve this service’s code. I can edit its files directly; changes affect every account of this service.</p>`
    });
    trimIdle();
    return entry.session;
  }).catch((error) => { if (sources.get(id) === entry) sources.delete(id); throw error; });
  return entry.promise;
}
/** Stage only: caller navigates/mounts the view; submission always requires the user. */
export async function stageDraft(scope, prompt) {
  const session = scope === 'station' || !scope ? getStationSession()
    : await getSourceSession(String(scope).replace(/^source:/, ''));
  session.setDraft(prompt);
  return session;
}
/** Hard teardown for logout, authentication failure or station connectivity failure. */
export function resetChatSessions({ clearStored = true } = {}) {
  generation++;
  station?.chat.dispose(); station?.pane.remove(); station = null;
  for (const entry of sources.values()) { entry.session?.chat.dispose(); entry.session?.pane.remove(); }
  sources.clear();
  if (clearStored) { try { localStorage.removeItem(STORE); } catch {} }
  notify();
}
window.addEventListener('station:unauthed', () => resetChatSessions());
