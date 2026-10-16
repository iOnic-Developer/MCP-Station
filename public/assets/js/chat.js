import * as ui from './ui.js';
const { esc, toast, md } = ui;

/** Shared streaming chat. History is caller-owned, never stored in browser storage here. */
export function chatPane({ el, greeting = '', history = [], persist = () => {}, extra = () => ({}), placeholder = 'Ask…', fields = [] }) {
  el.innerHTML = `
    <div class="a-msgs" aria-label="Conversation"></div>
    ${fields.length ? `<div class="a-fields">${fields.map((f) => `<label style="flex:1;min-width:0">${esc(f.label || f.key)} (optional)<input class="input" data-field="${esc(f.key)}" placeholder="${esc(f.placeholder || '')}"></label>`).join('')}</div>` : ''}
    <div class="a-input">
      <label style="flex:1;min-width:0">Message<textarea class="input" rows="2" placeholder="${esc(placeholder)}"></textarea></label>
      <button class="btn primary" data-send>Send</button>
      <button class="btn" data-stop hidden>Stop</button>
    </div>
    <div class="a-status" role="status" aria-live="polite"></div>`;
  const msgsEl = el.querySelector('.a-msgs');
  const input = el.querySelector('textarea');
  const sendBtn = el.querySelector('[data-send]');
  const stopBtn = el.querySelector('[data-stop]');
  const status = el.querySelector('.a-status');
  const fieldEls = [...el.querySelectorAll('.a-fields input')];
  const drawerEl = el.closest('dialog, .drawer');
  let disposed = false;
  let active = null;
  let revision = 0;
  let persistQueue = Promise.resolve();
  const visible = () => el.isConnected && !el.closest('[hidden]');
  const live = (job) => !disposed && active === job && job.revision === revision;
  const report = (text) => { if (!disposed && el.isConnected) status.textContent = text; };

  // Snapshot each write, serialize it, and invalidate queued writes on Clear/session end.
  function saveHistory() {
    const ticket = revision;
    const snapshot = history.map((m) => ({ ...m }));
    persistQueue = persistQueue.then(async () => {
      if (disposed || ticket !== revision) return;
      try { await persist(snapshot); }
      catch { if (!disposed && ticket === revision) report('Conversation could not be saved.'); }
    }).catch(() => { /* A caller must never receive an unhandled persistence rejection. */ });
    return persistQueue;
  }

  function addBubble(role, content, scroll = true) {
    const div = document.createElement('div');
    div.className = `msg ${role === 'user' ? 'user' : 'bot'}`;
    div.innerHTML = role === 'user' ? esc(content).replace(/\n/g, '<br>') : md(content);
    msgsEl.appendChild(div);
    if (scroll) msgsEl.scrollTop = msgsEl.scrollHeight;
    return div;
  }
  function render() {
    if (disposed || active) return;
    msgsEl.innerHTML = history.length ? '' : `<div class="msg bot">${greeting}</div>`;
    for (const m of history) addBubble(m.role, m.content, false);
    msgsEl.scrollTop = msgsEl.scrollHeight;
  }
  function addNote(html, kind = '') {
    const note = addBubble('assistant', '');
    note.className = `msg bot tool-note ${kind}`.trim();
    note.innerHTML = html;
    return note;
  }
  function busyUI(busy) {
    sendBtn.disabled = busy;
    stopBtn.hidden = !busy;
    el.setAttribute('aria-busy', String(busy));
  }
  function cancel(job) {
    if (!job) return;
    job.controller.abort();
    if (job.reader) {
      try { Promise.resolve(job.reader.cancel()).catch(() => {}); } catch { /* already released */ }
    }
  }
  function stop() {
    if (disposed || !active) return;
    report('Stopping…');
    cancel(active);
  }

  async function send() {
    const typed = input.value.trim();
    if (disposed || active || !typed || !visible()) return;
    const hints = fields.map((f, i) => ({ label: f.label || f.key, val: fieldEls[i]?.value.trim() }))
      .filter((h) => h.val).map((h) => `${h.label}: ${h.val}`);
    const text = hints.length ? `${typed}\n\n(${hints.join(' · ')})` : typed;
    const userMessage = { role: 'user', content: text };
    const job = { controller: new AbortController(), reader: null, revision };
    active = job;
    input.value = '';
    history.push(userMessage);
    const userBubble = addBubble('user', text);
    busyUI(true);
    report('Waiting for response…');
    const think = document.createElement('div');
    think.className = 'thinking';
    think.textContent = 'Thinking…';
    msgsEl.appendChild(think);
    let bubble = null;
    let acc = '';
    let gotDone = false;
    let modulesChanged = false;
    let received = false;
    const closeSegment = () => {
      if (!live(job) || !acc) return;
      history.push({ role: 'assistant', content: acc });
      acc = '';
      bubble = null;
      void saveHistory();
    };
    function eventFrame(frame) {
      if (!live(job) || job.controller.signal.aborted) return;
      const data = frame.split(/\r?\n/).filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, '')).join('\n');
      if (!data) return;
      let ev;
      try { ev = JSON.parse(data); } catch { return; }
      if (!ev || typeof ev !== 'object') return;
      if (ev.text) {
        received = true;
        acc += ev.text;
        think.remove();
        if (!bubble) bubble = addBubble('assistant', '');
        bubble.innerHTML = md(acc);
        msgsEl.scrollTop = msgsEl.scrollHeight;
        report('Receiving response…');
      }
      if (ev.tool) {
        received = true; // Tools may already have side effects even without prose.
        const t = ev.tool;
        if (t.status === 'running') {
          closeSegment();
          addNote(`Running <code>${esc(t.name)}</code>…`);
        } else {
          const last = [...msgsEl.querySelectorAll('.tool-note')].pop();
          if (last) last.innerHTML = `${t.ok ? 'Completed' : 'Failed'} <code>${esc(t.name)}</code>${t.detail ? ` — ${esc(String(t.detail))}` : ''}`;
        }
      }
      if (ev.notice) { closeSegment(); think.remove(); addNote(esc(ev.notice), 'notice'); }
      if (ev.file_changed) received = true;
      if (ev.file_changed) window.dispatchEvent(new CustomEvent('station:module-file-changed', { detail: ev.file_changed }));
      if (!live(job)) return;
      if (ev.modules_changed) { received = true; modulesChanged = true; }
      if (ev.error) throw new Error(ev.error);
      if (ev.done) gotDone = true;
    }
    try {
      const r = await fetch('/api/assistant', {
        method: 'POST', cache: 'no-store', signal: job.controller.signal,
        headers: { 'Content-Type': 'application/json', 'x-station-csrf': '1' },
        body: JSON.stringify({ messages: history, ...extra() })
      });
      if (!live(job)) { try { await r.body?.cancel(); } catch { /* closed */ } return; }
      if (!r.ok) {
        const error = await r.json().catch(() => ({}));
        throw new Error(error.error || `HTTP ${r.status}`);
      }
      if (!r.body) throw new Error('No response stream received.');
      job.reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      const consume = (final = false) => {
        let match;
        while ((match = /\r?\n\r?\n/.exec(buffer))) {
          const frame = buffer.slice(0, match.index);
          buffer = buffer.slice(match.index + match[0].length);
          eventFrame(frame);
          if (!live(job) || job.controller.signal.aborted) return;
        }
        if (final && buffer.trim()) { eventFrame(buffer); buffer = ''; }
      };
      while (live(job) && !job.controller.signal.aborted) {
        const { done, value } = await job.reader.read();
        if (!live(job) || job.controller.signal.aborted) return;
        if (done) { buffer += decoder.decode(); consume(true); break; }
        buffer += decoder.decode(value, { stream: true });
        consume();
      }
      if (live(job) && !gotDone && !job.controller.signal.aborted) throw new Error('The connection dropped before the reply finished — try again.');
      if (live(job)) report(job.controller.signal.aborted ? 'Response stopped.' : 'Response complete.');
    } catch (error) {
      if (live(job)) report(job.controller.signal.aborted ? 'Response stopped.' : error.message);
    } finally {
      // Release an errored/incomplete stream as well as stopped or completed ones.
      try { Promise.resolve(job.reader?.cancel()).catch(() => {}); } catch { /* already released */ }
      if (live(job)) {
        closeSegment();
        if (!received && !input.value) {
          const index = history.indexOf(userMessage);
          if (index !== -1) history.splice(index, 1);
          userBubble.remove();
          if (!input.value) input.value = typed;
        }
        think.remove();
        active = null;
        busyUI(false);
        if (job.controller.signal.aborted) report('Response stopped.');
        // Do not steal focus from newer typing or another panel.
        await saveHistory();
        if (!disposed && job.revision === revision && modulesChanged) {
          window.dispatchEvent(new CustomEvent('station:mcps-changed'));
        }
      }
      job.controller.abort(); // Release shell session tracking after stream completion.
      try { job.reader?.releaseLock(); } catch { /* cancelled */ }
    }
  }

  const keydown = (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void send(); }
  };
  const copy = async (event) => {
    const btn = event.target.closest('[data-copy-code]');
    if (disposed || !btn) return;
    try {
      if (ui.copyText) await ui.copyText(codeOf(btn));
      else await navigator.clipboard.writeText(codeOf(btn));
      if (!disposed && visible()) toast('Code copied');
    } catch { if (!disposed && visible()) toast('Could not copy code. Select and copy it manually.', 'err'); }
  };
  function dispose() {
    if (disposed) return;
    disposed = true;
    revision++;
    cancel(active);
    active = null;
    window.removeEventListener('station:session-ended', dispose);
    drawerEl?.removeEventListener('close', dispose);
    sendBtn.onclick = null;
    stopBtn.onclick = null;
    input.removeEventListener('keydown', keydown);
    msgsEl.removeEventListener('click', copy);
  }
  sendBtn.onclick = () => { void send(); };
  stopBtn.onclick = stop;
  input.addEventListener('keydown', keydown);
  msgsEl.addEventListener('click', copy);
  window.addEventListener('station:session-ended', dispose);
  drawerEl?.addEventListener('close', dispose);
  render();
  return {
    msgsEl, input, render, dispose,
    isBusy: () => !disposed && !!active,
    hasWork: () => !disposed && !!(active || history.length || input.value.trim() || fieldEls.some((f) => f.value.trim())),
    clear: async () => {
      if (disposed) return;
      revision++;
      cancel(active);
      active = null;
      history.length = 0;
      input.value = '';
      busyUI(false);
      report('Conversation cleared.');
      render();
      await saveHistory();
    }
  };
}

/** The code text belonging to a rendered code-block button. */
export function codeOf(btn) {
  return btn.closest('pre')?.querySelector('code')?.textContent ?? '';
}
