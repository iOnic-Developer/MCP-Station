import { api } from '../api.js';
import { esc } from '../ui.js';
import { icon } from '../icons.js';
export function renderLogin(root, { me, onAuthed }) {
  document.title = 'Welcome · MCP Station';
  root.innerHTML = `<main class="login-layout"><section class="login-story"><a class="brand" href="#/overview"><img src="/assets/brand/station-mark.svg" width="36" height="36" alt=""><span>MCP Station</span></a><div><p class="eyebrow">Your tools. Your server. Your control.</p><h1>A little less friction.<br>A lot more connection.</h1><p>Bring your services and AI assistants together in one thoughtfully simple workspace.</p><div class="login-benefits"><span>${icon('plug')}Connect your everyday services</span><span>${icon('key')}Control who has access</span><span>${icon('assistant')}Build something of your own</span></div></div><small>Self-hosted. Made to be yours.</small></section><section class="login-wrap"><form class="login" id="loginForm" aria-labelledby="loginTitle"><img class="login-mark" src="/assets/brand/station-mark.svg" alt="" width="48" height="48"><p class="eyebrow">Welcome back</p><h2 id="loginTitle">Sign in to your station</h2><p>One place for all your connections.${me.publicUrl ? `<span class="login-host mono">${esc(me.publicUrl)}</span>` : ''}</p>${me.passwordSet ? '' : '<div class="banner" role="alert">Your server needs a station password. Set APP_PASSWORD in its environment and restart before signing in.</div>'}<input class="sr-only" name="username" autocomplete="username" value="station" readonly tabindex="-1" aria-label="Station account"><div class="field"><label for="pw">Station password</label><input class="input" id="pw" name="password" type="password" required autocomplete="current-password" aria-describedby="passwordHelp loginErr" autofocus ${me.passwordSet ? '' : 'disabled'}><div class="help" id="passwordHelp">Use the password set by your station administrator.</div></div><p class="error-text" id="loginErr" role="alert"></p><button class="btn primary login-submit" type="submit" ${me.passwordSet ? '' : 'disabled'}>Sign in ${icon('arrow')}</button><p class="login-privacy">Your credentials stay with your station.</p></form></section></main>`;
  const form = root.querySelector('#loginForm'), input = form.querySelector('#pw'), button = form.querySelector('[type=submit]');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const err = form.querySelector('#loginErr'); err.textContent = ''; input.removeAttribute('aria-invalid'); button.disabled = true; button.textContent = 'Signing in…';
    try { await api('/login', { method: 'POST', body: { password: input.value } }); await onAuthed(); }
    catch (ex) { err.textContent = ['Wrong password', 'Not signed in'].includes(ex.message) ? 'That password wasn’t recognized. Please try again.' : ex.message; input.setAttribute('aria-invalid', 'true'); input.focus(); }
    finally { button.disabled = !me.passwordSet; button.innerHTML = `Sign in ${icon('arrow')}`; }
  };
}
