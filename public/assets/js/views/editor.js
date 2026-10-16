import { api } from '../api.js';
import { esc, toast, drawer, confirmModal } from '../ui.js';
import { chatPane } from '../chat.js';

export async function openEditor(m, ctx) {
  // Register before the first await: a completed fetch must not reopen a signed-out UI.
  let alive = true;
  const ended = () => { alive = false; };
  window.addEventListener('station:session-ended', ended);
  let files = [];
  let history = [];
  try {
    [{ files }, { messages: history }] = await Promise.all([
      api(`/mcps/${m.id}/files`), api(`/mcps/${m.id}/chat`)
    ]);
  } catch (error) {
    if (alive) toast(error.message, 'err');
    return;
  } finally {
    window.removeEventListener('station:session-ended', ended);
  }
  if (!alive) return;

  const name = m.manifest?.name || m.id;
  const d = drawer({
    title: `${name} — code`,
    body: `<div class="edit-split">
      <div class="edit-code">
        <div class="files" id="fileTabs" role="tablist" aria-label="Module files"></div>
        <div role="tabpanel" id="sourcePanel" style="display:flex;flex-direction:column;flex:1;min-height:0"><label for="codeArea">Source code</label>
          <p id="codeHelp">Tab indents. Press Escape then Tab to leave the editor.</p>
          <textarea class="code" id="codeArea" aria-describedby="codeHelp" spellcheck="false" placeholder="Pick a file…" disabled></textarea>
        </div>
        <output data-status role="status" aria-live="polite"></output>
      </div>
      <div class="editor-chat chat" id="mcpChat" hidden>
        <div class="a-head">Ask about ${esc(name)}<span class="sub">sees and edits this module's files</span>
          <div class="spacer"></div><button class="btn sm" data-clear>Clear conversation</button>
        </div><div class="chat-body"></div>
      </div>
    </div>`,
    foot: `<button class="btn" data-cancel>Close</button>
      <button class="btn" data-chat aria-expanded="false" aria-controls="mcpChat">Chat</button>
      <div class="spacer"></div><button class="btn" data-reload>Save &amp; reload modules</button>
      <button class="btn primary" data-save>Save</button>`
  });
  const tabs = d.el.querySelector('#fileTabs');
  const area = d.el.querySelector('#codeArea');
  const sourcePanel = d.el.querySelector('#sourcePanel');
  const chatBox = d.el.querySelector('#mcpChat');
  const status = d.el.querySelector('[data-status]');
  const saveBtn = d.el.querySelector('[data-save]');
  const reloadBtn = d.el.querySelector('[data-reload]');
  let current = null;
  let baseline = '';
  let dirty = false;
  let busy = false;
  let loading = false;
  let loadGeneration = 0;
  let listGeneration = 0;
  let editGeneration = 0;
  let escapeTab = false;
  let prompting = false;
  const live = () => alive && d.el.isConnected;
  const say = (text) => { if (live()) status.textContent = text; };
  const chat = chatPane({
    el: chatBox.querySelector('.chat-body'), history,
    persist: (messages) => alive ? api(`/mcps/${m.id}/chat`, { method: 'PUT', body: { messages } }) : undefined,
    extra: () => ({ mcpId: m.id }),
    placeholder: 'Describe a change or ask about this module…',
    greeting: `I can see <b>${esc(name)}</b>'s files and module contract. Ask me to add a tool, fix a bug or explain its code. I edit files directly and reload the module. Review changes before using them.<br><br>Replace file copies a complete code block into the open editor; Save writes it to disk.`
  });

  async function ask(title, text) {
    if (!live() || prompting) return false;
    prompting = true;
    try { return !!(await confirmModal(title, text)) && live(); }
    catch { return false; }
    finally { prompting = false; }
  }
  function controls() {
    if (!live()) return;
    saveBtn.disabled = reloadBtn.disabled = busy || loading || !current;
    for (const button of tabs.querySelectorAll('button')) button.disabled = busy;
    area.disabled = !current;
  }
  function changed() {
    editGeneration++;
    dirty = area.value !== baseline;
    renderTabs();
    say(`${current || 'Source'} — ${dirty ? 'Unsaved changes' : 'No unsaved changes'}${busy ? ' (save in progress)' : ''}`);
  }
  area.oninput = changed;
  area.onkeydown = (event) => {
    if (event.key === 'Escape') { escapeTab = true; event.preventDefault(); event.stopPropagation(); return; }
    if (event.key !== 'Tab') { escapeTab = false; return; }
    if (escapeTab || event.shiftKey) { escapeTab = false; return; }
    event.preventDefault();
    area.setRangeText('  ', area.selectionStart, area.selectionEnd, 'end');
    changed();
  };
  area.onblur = () => { escapeTab = false; };

  function renderTabs() {
    if (!live()) return;
    tabs.innerHTML = files.map((file, index) => `<button class="btn sm ${file.path === current ? 'active' : ''}" role="tab" id="source-tab-${index}" aria-controls="sourcePanel" aria-selected="${file.path === current}" tabindex="${file.path === current || (!current && index === 0) ? '0' : '-1'}" data-f="${esc(file.path)}">${esc(file.path)}${file.path === current && dirty ? ' *' : ''}</button>`).join('');
    const selected = files.findIndex((file) => file.path === current);
    if (selected !== -1) sourcePanel.setAttribute('aria-labelledby', `source-tab-${selected}`);
    controls();
  }
  const tabClick = (event) => {
    const button = event.target.closest('[data-f]');
    if (button && !button.disabled) void open(button.dataset.f);
  };
  const tabKey = (event) => {
    const buttons = [...tabs.querySelectorAll('[data-f]')];
    const index = buttons.indexOf(event.target);
    if (busy || index < 0) return;
    let next;
    if (event.key === 'ArrowRight') next = (index + 1) % buttons.length;
    else if (event.key === 'ArrowLeft') next = (index + buttons.length - 1) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = buttons.length - 1;
    else return;
    event.preventDefault();
    buttons[next].focus();
    // Manual activation: Enter/Space selects the focused native button.
  };
  tabs.addEventListener('click', tabClick);
  tabs.addEventListener('keydown', tabKey);

  async function open(path) {
    if (!live() || busy || prompting) return;
    const ticket = ++loadGeneration;
    loading = false;
    controls();
    const edits = editGeneration;
    if (dirty && !(await ask('Discard unsaved changes?', `Switching or reloading ${current} will discard your unsaved edits. Cancel keeps them.`))) return;
    if (!live() || busy || ticket !== loadGeneration || edits !== editGeneration) return;
    loading = true;
    controls();
    say(`Loading ${path}…`);
    try {
      const result = await api(`/mcps/${m.id}/file?path=${encodeURIComponent(path)}`);
      if (!live() || busy || ticket !== loadGeneration || edits !== editGeneration) return;
      current = path;
      area.value = baseline = result.content;
      dirty = false;
      editGeneration++;
      renderTabs();
      say(`${path} — No unsaved changes`);
    } catch (error) { if (live() && ticket === loadGeneration) say(error.message); }
    finally {
      if (live() && ticket === loadGeneration) { loading = false; controls(); }
    }
  }

  async function saveCurrent(reload = false) {
    if (!live() || busy || loading || !current) return;
    const path = current;
    const content = area.value;
    busy = true;
    controls();
    say(`Saving ${path}…`);
    try {
      await api(`/mcps/${m.id}/file`, { method: 'PUT', body: { path, content } });
      if (!live()) return;
      if (current === path) { baseline = content; dirty = area.value !== content; }
      if (reload) {
        say(`Saved ${path}. Reloading modules…`);
        await api('/reload', { method: 'POST' });
        if (!live()) return;
        await ctx.refresh();
        if (!live()) return;
      }
      say(`Saved ${path}${reload ? ' and reloaded modules' : ' — reload modules to apply'}.${dirty ? ' Newer edits are still unsaved.' : ''}`);
    } catch (error) { if (live()) say(`Could not ${reload ? 'save/reload' : 'save'} ${path}: ${error.message}`); }
    finally { if (live()) { busy = false; renderTabs(); } }
  }

  const onFileChanged = async (event) => {
    const { id, path } = event.detail || {};
    if (!live() || id !== m.id) return;
    const ticket = ++listGeneration;
    try {
      const result = await api(`/mcps/${m.id}/files`);
      if (!live() || ticket !== listGeneration) return;
      files = result.files;
      renderTabs();
      if (path === current && !busy && !loading) await open(path);
      else say(`${path || 'Module'} changed on disk. Open its tab to review${busy ? ' after saving' : ''}.`);
    } catch (error) { if (live() && ticket === listGeneration) say(error.message); }
  };
  window.addEventListener('station:module-file-changed', onFileChanged);

  const insert = async (event) => {
    const button = event.target.closest('[data-insert-code]');
    if (!button || !live() || busy || loading || !current) return;
    const path = current;
    const edits = editGeneration;
    const code = button.closest('pre')?.querySelector('code')?.textContent || '';
    const partial = path === 'index.js' ? !/export\s+(async\s+)?function\s+register\b/.test(code)
      : path === 'manifest.json' ? !(() => { try { return !!JSON.parse(code)?.slug; } catch { return false; } })() : false;
    const ok = await ask(`Replace ${path}?`, `${partial ? 'This looks like a snippet, not a complete file, and may break the module. ' : ''}Replace the entire open file with this code block? Save is still required. Cancel keeps your edits.`);
    if (!ok || !live() || busy || loading || path !== current || edits !== editGeneration) return;
    area.value = code;
    changed();
  };
  chat.msgsEl.addEventListener('click', insert);
  const addInsertButtons = () => {
    if (!live()) return;
    for (const pre of chat.msgsEl.querySelectorAll('pre')) {
      if (pre.querySelector('[data-insert-code]')) continue;
      const button = document.createElement('button');
      button.className = 'btn sm copy-code insert-code';
      button.dataset.insertCode = '1';
      button.title = 'Replace the whole open file with this code block (complete files only)';
      button.textContent = 'Replace file';
      pre.prepend(button);
    }
  };
  const observer = new MutationObserver(addInsertButtons);
  observer.observe(chat.msgsEl, { childList: true, subtree: true });
  addInsertButtons();

  d.guardClose = async () => {
    if (!alive || (!dirty && !busy && !chat.isBusy() && !chat.input.value.trim())) return true;
    return ask('Close code editor?', `${busy ? 'A save is still in progress and may finish on the server. ' : ''}${chat.isBusy() ? 'The assistant is still running. Closing stops this response. ' : ''}${dirty ? 'Unsaved source changes will be lost. ' : ''}${chat.input.value.trim() ? 'Your unsent assistant draft will be lost. ' : ''}Close anyway? Cancel keeps the editor open.`);
  };
  const beforeUnload = (event) => {
    if (!alive || (!dirty && !busy && !chat.isBusy() && !chat.input.value.trim())) return;
    event.preventDefault();
    event.returnValue = '';
  };
  function dispose() {
    if (!alive) return;
    alive = false;
    loadGeneration++;
    listGeneration++;
    chat.dispose();
    observer.disconnect();
    window.removeEventListener('station:module-file-changed', onFileChanged);
    window.removeEventListener('station:session-ended', sessionEnd);
    window.removeEventListener('beforeunload', beforeUnload);
    d.el.removeEventListener('close', dispose);
    tabs.removeEventListener('click', tabClick);
    tabs.removeEventListener('keydown', tabKey);
    chat.msgsEl.removeEventListener('click', insert);
    area.oninput = area.onkeydown = area.onblur = null;
    for (const button of d.el.querySelectorAll('button')) button.onclick = null;
    d.guardClose = null;
  }
  const sessionEnd = () => { dispose(); d.forceClose?.(); };
  window.addEventListener('station:session-ended', sessionEnd);
  window.addEventListener('beforeunload', beforeUnload);
  d.el.addEventListener('close', dispose);
  d.el.querySelector('[data-cancel]').onclick = () => { void d.close(); };
  d.el.querySelector('[data-chat]').onclick = (event) => {
    chatBox.hidden = !chatBox.hidden;
    d.el.classList.toggle('wide', !chatBox.hidden);
    event.currentTarget.classList.toggle('active', !chatBox.hidden);
    event.currentTarget.setAttribute('aria-expanded', String(!chatBox.hidden));
    if (!chatBox.hidden) chat.input.focus();
  };
  chatBox.querySelector('[data-clear]').onclick = () => { void chat.clear(); };
  saveBtn.onclick = () => { void saveCurrent(); };
  reloadBtn.onclick = () => { void saveCurrent(true); };
  renderTabs();
  const first = files.find((file) => file.path === 'index.js') || files[0];
  if (first) void open(first.path);
  else say('This module has no editable files.');
}
