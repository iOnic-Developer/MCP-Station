import { hasSessionWork } from './assistant-shell.js';

let deferredInstall = null;
let registration = null;
let acceptingUpdate = false;
function offerUpdate() {
  const button = document.getElementById('station-update');
  if (!button || !registration?.waiting) return;
  button.hidden = false;
  button.onclick = () => {
    const drafts = hasSessionWork();
    if (!confirm(drafts ? 'Update and reload Station? Open drafts and assistant history will be erased, and in-flight assistant requests will be cancelled.' : 'Update Station and reload this page?')) return;
    acceptingUpdate = true;
    registration.waiting?.postMessage({ type: 'STATION_ACCEPT_UPDATE' });
  };
}
export function setupPwa() {
  window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); deferredInstall = event; });
  window.addEventListener('appinstalled', () => { deferredInstall = null; });
  window.addEventListener('station:shell-ready', offerUpdate);
  // The skip link must not change the application's hash route.
  document.querySelector('.skip-link')?.addEventListener('click', (event) => {
    event.preventDefault();
    const main = document.getElementById('main-content');
    main?.setAttribute('tabindex', '-1');
    main?.focus();
  });
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Never reload another tab or force an update over unsaved work.
    if (acceptingUpdate) location.reload();
  });
  navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then((reg) => {
    registration = reg;
    offerUpdate();
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      worker?.addEventListener('statechange', () => { if (worker.state === 'installed') offerUpdate(); });
    });
  }).catch(() => { /* Console remains fully usable without install support. */ });
}
export async function requestInstall() {
  const help = document.getElementById('install-help');
  if (deferredInstall) {
    await deferredInstall.prompt();
    await deferredInstall.userChoice;
    deferredInstall = null;
    return;
  }
  if (help) help.textContent = window.isSecureContext
    ? 'Use your browser menu: Install app or Add to Home Screen, if supported. Some browsers do not offer installation.'
    : 'Serve Station over trusted HTTPS to enable installation on your LAN. Plain HTTP LAN addresses are not secure contexts; localhost is an exception.';
}
