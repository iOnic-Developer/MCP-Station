// Progressive enhancement only: navigation and installation work without JavaScript.
const copyButton = document.querySelector('[data-copy]');
const command = document.querySelector('#pull-command');
const status = document.querySelector('[data-copy-status]');
if (copyButton && command && status && navigator.clipboard?.writeText) {
  copyButton.hidden = false;
  copyButton.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(command.textContent.trim());
      status.textContent = 'Command copied. Follow the full guide before starting the station.';
    } catch {
      status.textContent = 'Copy unavailable. Select and copy the command above.';
    }
  });
}

// GIFs are user-initiated only. Stop removes animation by restoring the PNG.
for (const figure of document.querySelectorAll('[data-demo]')) {
  const button = figure.querySelector('[data-demo-play]');
  const image = figure.querySelector('[data-demo-image]');
  const label = figure.querySelector('[data-demo-status]');
  if (!button || !image || !label) continue;
  const poster = image.getAttribute('src');
  const playLabel = button.textContent;
  const posterAlt = image.alt;
  const stop = () => {
    image.setAttribute('src', poster);
    image.alt = posterAlt;
    button.setAttribute('aria-pressed', 'false');
    button.textContent = playLabel;
    label.textContent = 'Static poster';
  };
  button.hidden = false;
  button.addEventListener('click', () => {
    if (button.getAttribute('aria-pressed') === 'true') { stop(); return; }
    image.setAttribute('src', button.dataset.gif);
    image.alt = posterAlt.replace('static real-app result', 'animated real-app demonstration');
    button.setAttribute('aria-pressed', 'true');
    button.textContent = playLabel.replace('Play ', 'Stop ');
    label.textContent = 'Playing accelerated scripted-provider demo';
  });
  image.addEventListener('error', () => {
    if (button.getAttribute('aria-pressed') !== 'true') return;
    stop();
    label.textContent = 'Animation unavailable; static poster restored.';
  });
  // If the preference changes while playing, return to the static alternative.
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (event) => {
    if (event.matches) stop();
  });
}
