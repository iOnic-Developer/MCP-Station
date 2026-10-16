/** Small, local stroke-icon vocabulary. Decorative; controls supply visible names. */
const paths = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  plug: '<path d="M8 3v5m8-5v5M6 8h12v3a6 6 0 0 1-6 6v4m-6-13h12"/>',
  connect: '<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  assistant: '<rect x="4" y="6" width="16" height="14" rx="4"/><path d="M12 2v4m-4 6h.01M16 12h.01M9 16h6"/>',
  settings: '<path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2"/><circle cx="16" cy="12" r="2"/><circle cx="10" cy="18" r="2"/>',
  backup: '<path d="M4 8h16v13H4zM3 3h18v5H3zM9 12h6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>', chevron: '<path d="m9 5 7 7-7 7"/>',
  panel: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18m5-12-3 3 3 3"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/>',
  reload: '<path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/>',
  logout: '<path d="M9 4H4v16h5m6-13 5 5-5 5M8 12h12"/>',
  moon: '<path d="M20 14a8 8 0 0 1-10-10 8 8 0 1 0 10 10Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>',
  code: '<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
  tools: '<path d="m14 6 4 4m-9 6-5 5-2-2 5-5M14 3a6 6 0 0 0-7 7l7 7a6 6 0 0 0 7-7l-4 3-4-4 3-4Z"/>',
  key: '<circle cx="8" cy="8" r="5"/><path d="m12 12 9 9m-4-4 3-3m-6 0 3-3"/>',
  test: '<path d="M9 3h6m-5 0v7L4 20a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1l-6-10V3M8 14h8"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m9 10 6-4m-6 8 6 4"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>', warning: '<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3h.01"/>',
  file: '<path d="M14 2H4v20h16V8l-6-6Zm0 0v6h6M8 13h8m-8 4h6"/>',
  database: '<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v14c0 4 16 4 16 0V5M4 12c0 4 16 4 16 0"/>',
  message: '<path d="M21 3H3v14h5v4l5-4h8V3Z"/>',
  workflow: '<rect x="2" y="2" width="7" height="6" rx="1"/><rect x="15" y="16" width="7" height="6" rx="1"/><path d="M5 8v11h10M9 5h10v11"/>',
  media: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="m10 8 5 3-5 3V8ZM8 22h8m-4-4v4"/>',
  folder: '<path d="M3 6V3h6l3 3h9v15H3V6Z"/>',
};
export function icon(name, cls = '') {
  return `<svg class="icon ${cls}" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths[name] || paths.plug}</svg>`;
}
/** Local category symbols, not official service logos. Identity never follows status. */
export function serviceIdentity(id, name = id) {
  const value = String(id).toLowerCase();
  const categories = [
    [/sonarr|radarr|plex|jellyfin|media/, 'media', 'Media'],
    [/files|drive|dropbox|storage/, 'folder', 'Files & storage'],
    [/telegram|slack|gmail|pushover|mail|message/, 'message', 'Messaging'],
    [/github|gitlab|docker|unraid|forge/, 'code', 'Development'],
    [/n8n|openproject|todoist|workflow/, 'workflow', 'Work & automation'],
    [/siyuan|notes|notion|xero|booker|pos-companion/, 'database', 'Knowledge & data'],
    [/gemini|openai|anthropic|assistant/, 'assistant', 'AI services'],
    [/proton|password|vault/, 'key', 'Security']
  ];
  const match = categories.find(([pattern]) => pattern.test(value));
  // Four restrained, theme-aware identity tones. Source ID is stable across account/state changes.
  let hash = 0;
  for (const char of value) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  const words = String(name).trim().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const monogram = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || 'IN').slice(0, 2)).toUpperCase();
  return { icon: match?.[1] || 'plug', category: match?.[2] || 'Custom integration', tone: ['forest', 'ocean', 'plum', 'slate'][hash % 4], monogram };
}
export function serviceIcon(id) {
  return icon(serviceIdentity(id).icon);
}
