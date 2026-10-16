// Validate after body consumption too: old-session response headers can arrive before sign-out.
let sessionEpoch = 0;
window.addEventListener('station:session-ended', () => { sessionEpoch++; });
const assertSession = ticket => { if (ticket !== sessionEpoch) throw new DOMException('Session changed','AbortError'); };
/** Admin JSON requests: cookie session + CSRF, never bearer credentials. */
export async function api(path, opts = {}) {
  const ticket = sessionEpoch;
  if (navigator.onLine === false) throw new Error('You are offline. Reconnect before changing the station.');
  const init = { method: opts.method || 'GET', cache: 'no-store', credentials: 'same-origin',
    headers: { 'x-station-csrf': '1', ...(opts.headers || {}) } };
  if (opts.signal) init.signal = opts.signal;
  if (opts.body !== undefined) {
    if (opts.raw) init.body = opts.body;
    else { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(opts.body); }
  }
  let r;
  try { r = await fetch(`/api${path}`, init); }
  catch (error) { if (error.name === 'AbortError') throw error; throw new Error('Station unreachable. Check your connection and try again.'); }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await r.json() : null;
  assertSession(ticket);
  if (!r.ok) { const error = new Error(data?.error || (r.status === 401 ? 'Not signed in' : `Request failed (HTTP ${r.status})`)); error.status = r.status; throw error; }
  return data;
}

/** Authenticated download; the shell handles any expired-session response. */
export async function download(path, filename) {
  const ticket = sessionEpoch;
  if (navigator.onLine === false) throw new Error('Reconnect to download this file.');
  const r = await fetch(`/api${path}`, { cache:'no-store', credentials:'same-origin', headers:{'x-station-csrf':'1'} });
  if (!r.ok) throw new Error(`Download failed (HTTP ${r.status})`);
  const a = document.createElement('a');
  const blob = await r.blob();
  assertSession(ticket);
  const url = URL.createObjectURL(blob);
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
