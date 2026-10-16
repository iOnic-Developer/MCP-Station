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
