import { chatPane } from './chat.js';
import { esc } from './ui.js';
import { icon } from './product.js';

let assistantHasWork = () => false;
export function hasSessionWork() {
  return !!document.querySelector('dialog[open], .drawer') || assistantHasWork();
}

// Keep the existing mountAssistant(ctx) contract, with history confined to this session.
export function mountAssistant(ctx) {
  const fab = document.createElement('button');
  fab.className = 'fab';
  fab.innerHTML = `${icon('assistant')}<span>Assistant</span>`;
  fab.setAttribute('aria-expanded', 'false');
  fab.setAttribute('aria-controls', 'station-assistant');
  const panel = document.createElement('section');
  panel.id = 'station-assistant';
  panel.className = 'assistant chat';
  panel.setAttribute('aria-label', 'Station assistant');
  panel.hidden = true;
  panel.innerHTML = `<div class="a-head"><span>Station assistant</span><span class="sub">${esc(ctx.me.provider || '')}</span><div class="spacer"></div><button class="btn sm" data-clear>Clear</button><button class="btn sm" data-close aria-label="Close assistant">Close</button></div><div class="chat-body"></div>`;
  document.body.append(fab, panel);
  const history = [];
  const chat = chatPane({
    el: panel.querySelector('.chat-body'), history,
    placeholder: 'Describe the integration you need…',
    greeting: 'Describe a service API and I can help build its module. To edit an existing module, open its Code panel. Review generated tools and test before granting client access.'
  });
  const hasWork = () => chat.isBusy() || chat.hasWork();
  assistantHasWork = hasWork;
  chat.input.setAttribute('aria-label', 'Message to Station assistant');
  const close = () => { panel.hidden = true; fab.setAttribute('aria-expanded', 'false'); fab.focus(); };
  fab.onclick = () => {
    panel.hidden = !panel.hidden;
    fab.setAttribute('aria-expanded', String(!panel.hidden));
    if (!panel.hidden) chat.input.focus();
  };
  panel.querySelector('[data-close]').onclick = close;
  panel.querySelector('[data-clear]').onclick = chat.clear;
  panel.onkeydown = (event) => { if (event.key === 'Escape') close(); };
  return () => { if (assistantHasWork === hasWork) assistantHasWork = () => false; chat.dispose(); history.length = 0; chat.input.value = ''; panel.remove(); fab.remove(); };
}
