import { api } from '../api.js';
import { esc, toast, drawer, confirmModal } from '../ui.js';
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
      <div class="edit-split">
        <div class="edit-code">
          <div class="files" id="fileTabs"></div>
          <textarea class="code" id="codeArea" spellcheck="false" placeholder="Pick a file…"></textarea>
        </div>
        <div class="editor-chat chat" id="mcpChat" hidden>
          <div class="a-head">✦ Ask about ${esc(name)}<span class="sub">sees and edits this module's files</span>
            <div class="spacer"></div>
            <button class="btn sm" data-clear title="Clear this module's conversation">🧹</button>
          </div>
          <div class="chat-body"></div>
        </div>
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
    greeting: `I can see <b>${esc(name)}</b>'s files (manifest.json, index.js, …) and the module contract.<br><br>Ask me to add a tool, fix a bug or explain what it does — I <b>edit the files directly</b> and reload the module, and the open tab refreshes when I change it. Nothing to copy.<br><br>If you'd rather paste something yourself, ask to see the code: <b>⤵ Replace file</b> on a code block swaps the whole open file for it (complete files only).`
  });

  // The assistant edits files on disk with its tools — keep the open tab (and tab list) in sync.
  const onFileChanged = async (e) => {
    if (!d.el.isConnected) return window.removeEventListener('station:module-file-changed', onFileChanged);
    const { id, path: p } = e.detail || {};
    if (id !== m.id) return;
    try { files = (await api(`/mcps/${m.id}/files`)).files; } catch { /* keep the old list */ }
    if (p !== current) {
      renderTabs();
      if (p) toast(`✦ wrote ${p} — open its tab to see it`);
      return;
    }
    if (dirty && !(await confirmModal('File changed on disk', `The assistant changed ${p}. Reload it into the editor and discard your unsaved edits?`))) return;
    try {
      const r = await api(`/mcps/${m.id}/file?path=${encodeURIComponent(p)}`);
      area.value = r.content;
      dirty = false;
      renderTabs();
      toast(`✦ updated ${p} — module reloaded`);
    } catch (ex) { toast(ex.message, 'err'); }
  };
  window.addEventListener('station:module-file-changed', onFileChanged);

  // A code block the assistant shows can still replace the open file — deliberately, and only
  // the whole file: a snippet pasted over index.js is how modules used to get wrecked.
  chat.msgsEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-insert-code]');
    if (!btn) return;
    if (!current) return toast('Open a file tab first', 'err');
    const code = btn.closest('pre').querySelector('code').textContent;
    const looksPartial = current === 'index.js'
      ? !/export\s+(async\s+)?function\s+register\b/.test(code)
      : current === 'manifest.json'
        ? !(() => { try { const j = JSON.parse(code); return Boolean(j && j.slug); } catch { return false; } })()
        : false;
    const ok = await confirmModal(
      `Replace ${current}?`,
      (looksPartial ? `⚠️ This block looks like a snippet, not a complete ${current} — replacing the whole file with it will break the module. Better: ask the assistant to apply the change itself. ` : '')
        + `This replaces the entire contents of ${current} in the editor with this code block. You still need to Save.`
    );
    if (!ok) return;
    area.value = code;
    dirty = true;
    toast(`Replaced ${current} in the editor — Save to write it`);
  });
  const addInsertButtons = () => {
    for (const pre of chat.msgsEl.querySelectorAll('pre')) {
      if (pre.querySelector('[data-insert-code]')) continue;
      const b = document.createElement('button');
      b.className = 'btn sm copy-code insert-code';
      b.dataset.insertCode = '1';
      b.title = 'Replace the whole open file with this code block (complete files only)';
      b.textContent = '⤵ Replace file';
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
  // Chat opens beside the code, and the drawer widens to make room for both.
  d.el.querySelector('[data-chat]').onclick = (e) => {
    chatBox.hidden = !chatBox.hidden;
    d.el.classList.toggle('wide', !chatBox.hidden);
    e.currentTarget.classList.toggle('active', !chatBox.hidden);
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
