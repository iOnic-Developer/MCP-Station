/** Optional app integration: import { initPwa } from './pwa.js'; initPwa();
 * No dashboard data, form contents or authentication state is read or persisted.
 */
let started = false;
let registration = null;
let installPrompt = null;
let panel;
let status;
let installButton;
let updateButton;
let details;
let dismissButton;
let consentToReload = false;
let updateWorker = null;
let reloaded = false;
let installed = false;
let installDismissed = false;
let lastFocused = null;
const DISMISS_KEY = 'mcp-station-pwa-install-dismissed';

const standalone = () => window.matchMedia?.('(display-mode: standalone)').matches ||
  window.matchMedia?.('(display-mode: minimal-ui)').matches || navigator.standalone === true;
const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function setStatus(message) {
  status.textContent = message;
  status.hidden = !message;
}

function render() {
  const secure = window.isSecureContext;
  installButton.hidden = !secure || installed || standalone() || installDismissed;
  installButton.textContent = installPrompt ? 'Install Station' : 'Install options';
  // No update CTA until a real waiting worker exists. Installing is not waiting.
  updateButton.hidden = !registration?.waiting;
  updateButton.disabled = consentToReload;
  updateButton.textContent = consentToReload ? 'Applying update…' : 'Update ready · reload';
  dismissButton.hidden = installButton.hidden;
  panel.hidden = status.hidden && installButton.hidden && updateButton.hidden && details.hidden;
}

function showDetails(message) {
  details.querySelector('p').textContent = message;
  details.hidden = false;
  lastFocused = document.activeElement;
  render();
  details.querySelector('button').focus();
}

function closeDetails() {
  details.hidden = true;
  render();
  if (lastFocused?.isConnected && !lastFocused.hidden) lastFocused.focus();
}

function connectionChanged() {
  if (!window.isSecureContext) {
    setStatus('Install requires HTTPS. Open Station through a secure browser URL (localhost is also supported).');
  } else if (navigator.onLine === false) {
    setStatus('Your browser reports this device is offline. Station actions need a server connection.');
  } else {
    // A browser's online flag does not establish server reachability.
    setStatus('');
  }
  render();
}

/** Mount once, even when authentication or view boot runs again. Returns the panel. */
export function initPwa() {
  if (started) return panel;
  if (!document.body) return null;
  started = true;
  installed = standalone();
  try { installDismissed = sessionStorage.getItem(DISMISS_KEY) === '1'; } catch { /* Storage optional. */ }

  panel = document.createElement('aside');
  panel.className = 'station-pwa';
  panel.setAttribute('aria-label', 'Station installation and connection');
  panel.innerHTML = `
    <div class="station-pwa-rail">
      <p class="station-pwa-status" role="status" aria-live="polite" aria-atomic="true" hidden></p>
      <button type="button" class="station-pwa-button" data-install>Install options</button>
      <button type="button" class="station-pwa-button station-pwa-primary" data-update hidden>Update ready · reload</button>
      <button type="button" class="station-pwa-button station-pwa-dismiss" data-dismiss aria-label="Dismiss installation suggestion">Not now</button>
    </div>
    <section class="station-pwa-details" aria-label="Installation guidance" hidden>
      <p></p><button type="button" class="station-pwa-button" data-close>Close instructions</button>
    </section>`;
  document.body.append(panel);
  status = panel.querySelector('[role="status"]');
  installButton = panel.querySelector('[data-install]');
  updateButton = panel.querySelector('[data-update]');
  details = panel.querySelector('.station-pwa-details');
  dismissButton = panel.querySelector('[data-dismiss]');
  installButton.addEventListener('click', requestInstall);
  updateButton.addEventListener('click', applyUpdate);
  details.querySelector('[data-close]').addEventListener('click', closeDetails);
  details.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeDetails(); });
  dismissButton.addEventListener('click', () => {
    installDismissed = true;
    details.hidden = true;
    try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* Storage optional. */ }
    render();
  });
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    if (!installed && !standalone()) installPrompt = event;
    render();
  });
  window.addEventListener('appinstalled', () => {
    installed = true;
    installPrompt = null;
    details.hidden = true;
    render();
  });
  window.addEventListener('online', connectionChanged);
  window.addEventListener('offline', connectionChanged);
  connectionChanged();
  dismissButton.hidden = installButton.hidden;

  if (!window.isSecureContext || !('serviceWorker' in navigator)) return panel;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // First install and updates accepted in another tab must never reload this editor.
    if (!consentToReload || reloaded) return;
    reloaded = true;
    window.location.reload();
  });
  navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
    .then((reg) => {
      registration = reg;
      const watch = (worker) => {
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'redundant' && worker === updateWorker && consentToReload) {
            consentToReload = false;
            setStatus('The update could not be applied. Keep editing and try again later.');
          }
          render();
        });
      };
      watch(reg.installing);
      reg.addEventListener('updatefound', () => { watch(reg.installing); render(); });
      render();
    })
    .catch(() => {
      setStatus('Offline page unavailable: Station could not register its public service worker. You can still use the station online.');
      render();
    });
  return panel;
}

/** Call directly from a user gesture. Without a native prompt, give honest manual help. */
export async function requestInstall() {
  initPwa();
  if (!panel) return false;
  if (!window.isSecureContext) {
    showDetails('Installation requires HTTPS, or localhost for local development. A plain HTTP LAN address cannot install this PWA.');
    return false;
  }
  if (installed || standalone()) {
    showDetails('Station is already running as an installed app.');
    return false;
  }
  if (!installPrompt) {
    showDetails(ios()
      ? 'On iPhone or iPad, open Station in Safari. Use Share, then Add to Home Screen (it may be under More), and confirm Add. If the option is absent, this browser or device may not support installation.'
      : 'Use your browser’s menu and look for Install MCP Station, Install app, or Add to Home Screen. Availability depends on your browser and its install checks. No install prompt is available here right now.');
    return false;
  }
  const prompt = installPrompt;
  installPrompt = null;
  render();
  try {
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === 'accepted') {
      // Acceptance is not a confirmed installation; appinstalled is the confirmation.
      showDetails('Install request accepted. Complete any remaining browser steps to add Station.');
    } else {
      installDismissed = true;
      try { sessionStorage.setItem(DISMISS_KEY, '1'); } catch { /* Storage optional. */ }
    }
    render();
    return choice.outcome === 'accepted';
  } catch {
    showDetails('The browser could not open its installer. Use the browser menu to check whether installation is available.');
    return false;
  }
}

/** Explicit consent only. Other tabs stay untouched; never auto-reload active edits. */
export function applyUpdate() {
  initPwa();
  const worker = registration?.waiting;
  if (!worker || consentToReload) return false;
  if (!window.confirm('Reload this tab to apply the Station update? Save your edits first. Unsaved changes in this tab will be lost. Other tabs will not be reloaded.')) return false;
  updateWorker = worker;
  consentToReload = true;
  render();
  try {
    worker.postMessage({ type: 'SKIP_WAITING' });
    return true;
  } catch {
    consentToReload = false;
    setStatus('The update is no longer waiting. Keep working and try again later.');
    render();
    return false;
  }
}
