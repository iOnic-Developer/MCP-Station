const media = matchMedia('(prefers-color-scheme: dark)');
let preference = 'system';
try { const stored = localStorage.getItem('station.theme'); if (['light','dark','system'].includes(stored)) preference = stored; } catch {}
function apply() {
  const theme = preference === 'system' ? (media.matches ? 'dark' : 'light') : preference;
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme === 'dark' ? '#101622' : '#f5f6fa');
  document.querySelectorAll('[data-theme-choice]').forEach(el => { el.value = preference; });
}
apply();
media.addEventListener('change',apply);
const mount = () => {
  const footer = document.querySelector('.sidebar-footer');
  if (footer && !footer.querySelector('[data-theme-choice]')) {
    const label = document.createElement('label'); label.className = 'appearance-label'; label.htmlFor = 'themeChoice'; label.textContent = 'Appearance';
    const select = document.createElement('select'); select.id = 'themeChoice'; select.dataset.themeChoice = ''; select.className = 'input';
    for (const value of ['system','light','dark']) { const option = document.createElement('option'); option.value = value; option.textContent = value[0].toUpperCase()+value.slice(1); select.append(option); }
    select.value = preference;
    select.onchange = () => { preference = select.value; try { localStorage.setItem('station.theme',preference); } catch {} apply(); };
    footer.prepend(label,select);
  }
};
window.addEventListener('station:shell-ready',mount);
mount();
