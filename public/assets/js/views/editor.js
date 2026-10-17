import { icon } from '../icons.js';
import { api } from '../api.js';
import { esc, toast, workspaceSurface, confirmModal } from '../ui.js';
import { getSourceSession } from '../chatSessions.js';
import { workspaceUrl } from './accounts.js';

export async function openEditor(m, ctx, target) {
  let files = [];
  let session;
  try {
    [{ files }, session] = await Promise.all([
      api(`/mcps/${m.id}/files`),
      getSourceSession(m)
    ]);
  } catch (ex) {
    if (target?.isConnected) target.innerHTML = `<p class="error-text" role="alert">Could not load source: ${esc(ex.message)}. Reopen this tab to retry.</p>`;
    return toast(ex.message, 'err');
  }

  if (target && !target.isConnected) return;
  const name = m.manifest?.name || m.id;
  const d = workspaceSurface({
    target,
    title: `${name} · Code editor`,
    body: `
      <div class="editor-toolbar"><strong>Shared source</strong><div class="spacer"></div><a class="btn action-accent" href="${workspaceUrl(m.id,'assistant')}">${icon('assistant')}Assistant workspace</a><button class="btn" data-chat aria-expanded="false" aria-controls="mcpChat">${icon('assistant')}Show assistant</button></div><p class="help">Advanced · Shared source for every account of this service. Changes are written to the server. Save, then reload to apply them. The Assistant can edit files directly.</p><div class="edit-split">
        <div class="edit-code">
          <div class="files" id="fileTabs"></div>
          <label class="sr-only" for="codeArea">Module source code</label><textarea class="code" id="codeArea" aria-describedby="editorState" spellcheck="false" placeholder="Pick a file…"></textarea>
        </div>
        <div class="editor-chat chat" id="mcpChat" hidden>
          <div class="a-head">${icon('assistant')}Ask about ${esc(name)}<span class="sub">sees and edits this module's files</span>
            <div class="spacer"></div>
            <button class="btn sm" data-clear title="Clear this module's conversation" aria-label="Clear module conversation">${icon('trash')}</button>
          </div>
          <div class="chat-body"></div>
        </div>
      </div>`,
    foot: `<span class="help" id="editorState" role="status">No file selected</span><button class="btn" data-cancel>Close</button>
           <div class="spacer"></div>
           <button class="btn" data-reload>${icon('reload')}Save &amp; reload</button>
           <button class="btn primary" data-save>Save</button>`
  });

  d.el.classList.add('editor-surface');
  const tabs = d.el.querySelector('#fileTabs');
  const area = d.el.querySelector('#codeArea');
  const chatBox = d.el.querySelector('#mcpChat');
  let current = null;
  let dirty = false;
  const status = d.el.querySelector('#editorState');
  const mark = () => { status.textContent = `${current || 'No file selected'}${dirty ? ' · Unsaved changes' : ' · Saved'}`; };
  area.oninput = () => { dirty = true; mark(); };
  d.el.stationDirty = () => dirty;
  d.el.stationBeforeClose = async () => !dirty || await confirmModal('Discard unsaved edits?', 'Your changes in the editor have not been saved to the server.', 'Discard edits');

  const chatTarget = chatBox.querySelector('.chat-body');
  session.mount(chatTarget);
  const chat = session.chat;

  chat.msgsEl.tabIndex = 0;

  // The assistant edits files on disk with its tools — keep the open tab (and tab list) in sync.
  const onFileChanged = async (e) => {
    if (!d.el.isConnected) return window.removeEventListener('station:module-file-changed', onFileChanged);
    const { id, path: p } = e.detail || {};
    if (id !== m.id) return;
    try { files = (await api(`/mcps/${m.id}/files`)).files; } catch { /* keep the old list */ }
    if (p !== current) {
      renderTabs();
      if (p) toast(`Assistant wrote ${p} — open its tab to see it`);
      return;
    }
    if (dirty && !(await confirmModal('File changed on disk', `The assistant changed ${p}. Reload it into the editor and discard your unsaved edits?`))) return;
    try {
      const r = await api(`/mcps/${m.id}/file?path=${encodeURIComponent(p)}`);
      if (!d.el.isConnected) return;
      area.value = r.content;
      dirty = false;
      mark();
      renderTabs();
      toast(`Assistant updated ${p} — module reloaded`);
    } catch (ex) { toast(ex.message, 'err'); }
  };
  window.addEventListener('station:module-file-changed', onFileChanged);

  // A code block the assistant shows can still replace the open file — deliberately, and only
  // the whole file: a snippet pasted over index.js is how modules used to get wrecked.
  const onInsertCode = async (e) => {
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
    mark();
    toast(`Replaced ${current} in the editor — Save to write it`);
  };
  chat.msgsEl.addEventListener('click', onInsertCode);
  const addInsertButtons = () => {
    for (const pre of chat.msgsEl.querySelectorAll('pre')) {
      if (pre.querySelector('[data-insert-code]')) continue;
      const b = document.createElement('button');
      b.className = 'btn sm copy-code insert-code';
      b.dataset.insertCode = '1';
      b.title = 'Replace the whole open file with this code block (complete files only)';
      b.textContent = 'Replace file';
      pre.prepend(b);
    }
  };
  const observer = new MutationObserver(addInsertButtons);
  observer.observe(chat.msgsEl, { childList: true, subtree: true });
  d.el.addEventListener('station:dispose', () => { observer.disconnect(); session.detach(chatTarget); chat.msgsEl.removeEventListener('click', onInsertCode); chat.msgsEl.querySelectorAll('[data-insert-code]').forEach((button) => button.remove()); window.removeEventListener('station:module-file-changed', onFileChanged); });
  addInsertButtons();

  function renderTabs() {
    tabs.innerHTML = files.map((f) =>
      `<button class="btn sm ${f.path === current ? 'active' : ''}" data-f="${esc(f.path)}">${esc(f.path)}</button>`).join('');
    tabs.querySelectorAll('[data-f]').forEach((b) => { b.onclick = () => open(b.dataset.f); });
  }

  async function open(p) {
    if (dirty && !await confirmModal('Discard unsaved edits?', 'Switching files will discard edits in the current file.', 'Discard edits')) return;
    try {
      const r = await api(`/mcps/${m.id}/file?path=${encodeURIComponent(p)}`);
      current = p;
      if (!d.el.isConnected) return;
      area.value = r.content;
      dirty = false;
      mark();
      renderTabs();
    } catch (ex) { toast(ex.message, 'err'); }
  }

  async function saveCurrent() {
    if (!current) throw new Error('Choose a file before saving.');
    const path = current, content = area.value;
    await api(`/mcps/${m.id}/file`, { method: 'PUT', body: { path, content } });
    if (current === path) dirty = area.value !== content;
    mark();
  }

  d.el.querySelector('[data-cancel]').onclick = d.close;
  // Chat opens beside the shared source on the full-page code surface.
  d.el.querySelector('[data-chat]').onclick = (e) => {
    chatBox.hidden = !chatBox.hidden;
    d.el.classList.toggle('wide', !chatBox.hidden);
    e.currentTarget.classList.toggle('active', !chatBox.hidden);
    e.currentTarget.setAttribute('aria-expanded', String(!chatBox.hidden));
    e.currentTarget.innerHTML = `${icon('assistant')}${chatBox.hidden ? 'Show assistant' : 'Hide assistant'}`;
    if (!chatBox.hidden) { chatBox.scrollIntoView({ block: 'nearest' }); chat.input.focus({ preventScroll: true }); }
  };
  // Open a useful split only when both source and conversation have room.
  if (window.matchMedia('(min-width: 1200px)').matches) {
    chatBox.hidden = false;
    d.el.classList.add('wide');
    const toggle = d.el.querySelector('[data-chat]');
    toggle.classList.add('active'); toggle.setAttribute('aria-expanded', 'true');
    toggle.innerHTML = `${icon('assistant')}Hide assistant`;
  }
  chatBox.querySelector('[data-clear]').onclick = async () => { if (await confirmModal('Clear this conversation?', 'This clears the module conversation but does not undo file changes.', 'Clear conversation')) chat.clear(); };
  d.el.querySelector('[data-save]').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try { await saveCurrent(); toast(`Saved ${current} — reload modules to apply`); }
    catch (ex) { toast(ex.message, 'err'); }
    finally { b.disabled = false; }
  };
  d.el.querySelector('[data-reload]').onclick = async (e) => {
    const b = e.currentTarget; b.disabled = true;
    try {
      await saveCurrent();
      await api('/reload', { method: 'POST' });
      toast('Saved and reloaded ✓');
      ctx.refresh();
    } catch (ex) { toast(ex.message, 'err'); }
    finally { b.disabled = false; }
  };

  renderTabs();
  const first = files.find((f) => f.path === 'index.js') || files[0];
  if (first) open(first.path);
}
