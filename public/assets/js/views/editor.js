import { api } from '../api.js';
import { esc, toast, drawer } from '../ui.js';
import { chatPane } from '../chat.js';

export async function openEditor(m, ctx) {
  let files = [];
  let history = [];
  try {
    [{ files }, { messages: history }] = await Promise.all([
      api(`/mcps/${m.id}/files`),
      api(`/mcps/${m.id}/chat`)
    ]);
  } catch (ex) {
    return toast(ex.message, 'err');
  }

  const name = m.manifest?.name || m.id;
  const d = drawer({
    title: `‹/› ${name} — code`,
    body: `
      <div class="files" id="fileTabs"></div>
      <textarea class="code" id="codeArea" spellcheck="false" placeholder="Pick a file…"></textarea>
      <div class="editor-chat chat" id="mcpChat" hidden>
        <div class="a-head">✦ Ask about ${esc(name)}<span class="sub">sees this module's files · history saved in the module folder</span>
          <div class="spacer"></div>
          <button class="btn sm" data-clear title="Clear this module's conversation">🧹</button>
        </div>
        <div class="chat-body"></div>
      </div>`,
    foot: `<button class="btn" data-cancel>Close</button>
           <button class="btn" data-chat>✦ Chat</button>
           <div class="spacer"></div>
           <button class="btn" data-reload>⟳ Save &amp; reload modules</button>
           <button class="btn primary" data-save>Save</button>`
  });

  const tabs = d.el.querySelector('#fileTabs');
  const area = d.el.querySelector('#codeArea');
  const chatBox = d.el.querySelector('#mcpChat');
  let current = null;
  let dirty = false;
  area.oninput = () => { dirty = true; };

  const chat = chatPane({
    el: chatBox.querySelector('.chat-body'),
    history,
    persist: (h) => api(`/mcps/${m.id}/chat`, { method: 'PUT', body: { messages: h } }),
    extra: () => ({ mcpId: m.id }),
    placeholder: `e.g. add a delete_message tool, or: why does get_updates 409?`,
    greeting: `I can see <b>${esc(name)}</b>'s files (manifest.json, index.js, …) and the module contract.<br><br>Ask me to add a tool, fix a bug or explain what it does — I'll reply with the complete file, and you can drop it straight into the open editor with <b>⤵ Insert</b>.`
  });

  // Code blocks the assistant returns can go straight into the open file.
  chat.msgsEl.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-insert-code]');
    if (!btn) return;
    if (!current) return toast('Open a file tab first', 'err');
    area.value = btn.closest('pre').querySelector('code').textContent;
    dirty = true;
    toast(`Inserted into ${current} — Save to write it`);
  });
  const addInsertButtons = () => {
    for (const pre of chat.msgsEl.querySelectorAll('pre')) {
      if (pre.querySelector('[data-insert-code]')) continue;
      const b = document.createElement('button');
      b.className = 'btn sm copy-code insert-code';
      b.dataset.insertCode = '1';
      b.textContent = '⤵ Insert';
      pre.prepend(b);
    }
  };
  new MutationObserver(addInsertButtons).observe(chat.msgsEl, { childList: true, subtree: true });
  addInsertButtons();

  function renderTabs() {
    tabs.innerHTML = files.map((f) =>
      `<button class="btn sm ${f.path === current ? 'active' : ''}" data-f="${esc(f.path)}">${esc(f.path)}</button>`).join('');
    tabs.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => open(b.dataset.f); });
  }

  async function open(p) {
    if (dirty && !confirm('Discard unsaved changes in the current file?')) return;
    try {
      const r = await api(`/mcps/${m.id}/file?path=${encodeURIComponent(p)}`);
      current = p;
      area.value = r.content;
      dirty = false;
      renderTabs();
    } catch (ex) { toast(ex.message, 'err'); }
  }

  async function saveCurrent() {
    if (!current) throw new Error('No file open');
    await api(`/mcps/${m.id}/file`, { method: 'PUT', body: { path: current, content: area.value } });
    dirty = false;
  }

  d.el.querySelector('[data-cancel]').onclick = d.close;
  d.el.querySelector('[data-chat]').onclick = () => {
    chatBox.hidden = !chatBox.hidden;
    if (!chatBox.hidden) chat.input.focus();
  };
  chatBox.querySelector('[data-clear]').onclick = chat.clear;
  d.el.querySelector('[data-save]').onclick = async () => {
    try { await saveCurrent(); toast(`Saved ${current} — reload modules to apply`); }
    catch (ex) { toast(ex.message, 'err'); }
  };
  d.el.querySelector('[data-reload]').onclick = async () => {
    try {
      await saveCurrent();
      await api('/reload', { method: 'POST' });
      toast('Saved and reloaded ✓');
      ctx.refresh();
    } catch (ex) { toast(ex.message, 'err'); }
  };

  renderTabs();
  const first = files.find((f) => f.path === 'index.js') || files[0];
  if (first) open(first.path);
}
