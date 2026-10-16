import { api } from '../api.js';
import { esc } from '../ui.js';

export function renderLogin(root, { me, onAuthed }) {
  document.title = 'Sign in · MCP Station';
  root.innerHTML = `<main class="station-login" id="main-content"><section class="login-story" aria-label="About MCP Station"><div class="station-brand"><img src="/assets/brand/station-mark.svg" alt="" width="40" height="40"><span>MCP Station<small>INTEGRATION CONTROL PLANE</small></span></div><div><p class="eyebrow">YOUR SERVICES. YOUR TOOLS. YOUR CONTROL.</p><h1>Bring your APIs into the conversation.</h1><p>One self-hosted workspace to build modules, manage access and connect your AI clients.</p></div><footer>MODULES / CONFIGURATION / CLIENT ACCESS</footer></section><section class="login-panel"><form id="loginForm"><p class="eyebrow">STATION ADMINISTRATION</p><h2>Sign in to your workspace</h2><p>Use the administrator password set for this Station.</p>${me.passwordSet ? '' : '<div class="banner">Sign-in is locked. Set APP_PASSWORD in the container environment and restart Station.</div>'}<div class="field"><label for="pw">Station password</label><input class="input" id="pw" name="password" type="password" required autocomplete="current-password" aria-describedby="password-help loginErr" ${me.passwordSet ? '' : 'disabled'}><div class="help" id="password-help">Your service API keys are managed separately in module settings.</div></div><div class="error-text" id="loginErr" role="alert" aria-live="assertive"></div><button class="btn primary" type="submit" ${me.passwordSet ? '' : 'disabled'}>Sign in</button><p class="login-host">${me.publicUrl ? esc(me.publicUrl) : 'Self-hosted MCP Station'}<br>Admin access only · MCP clients authenticate separately.</p></form></section></main>`;
  const form = root.querySelector('#loginForm');
  const password = form.querySelector('#pw');
  const button = form.querySelector('button[type=submit]');
  const error = form.querySelector('#loginErr');
  let pending = false;
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (pending || !me.passwordSet || !form.reportValidity()) return;
    pending = true;
    button.disabled = true;
    button.textContent = 'Signing in…';
    form.setAttribute('aria-busy', 'true');
    password.removeAttribute('aria-invalid');
    error.textContent = '';
    try {
      await api('/login', { method: 'POST', body: { password: password.value } });
      password.value = '';
      if (form.isConnected) await onAuthed();
    } catch (ex) {
      if (form.isConnected) {
        error.textContent = ex.status === 401 || ex.message === 'Not signed in' ? 'Password not accepted. Check your Station password and try again.' : (ex.message || 'Sign-in failed. Please try again.');
        password.setAttribute('aria-invalid', 'true');
        password.focus();
      }
    } finally {
      pending = false;
      if (form.isConnected) { button.disabled = false; button.textContent = 'Sign in'; form.removeAttribute('aria-busy'); }
    }
  };
}
