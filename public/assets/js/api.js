/** Fetch wrapper for the admin API: JSON, CSRF header, 401 → login event. */
export async function api(path, opts = {}) {
  const init = {
    method: opts.method || 'GET',
    headers: { 'x-station-csrf': '1', ...(opts.headers || {}) }
  };
  if (opts.body !== undefined) {
    if (opts.raw) {
      init.body = opts.body;
    } else {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
  }
  const r = await fetch(`/api${path}`, init);
  if (r.status === 401) {
    window.dispatchEvent(new Event('station:unauthed'));
    throw new Error('Not signed in');
  }
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('application/json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((data && data.error) || `HTTP ${r.status}`);
  return data;
}

/** Download a GET endpoint as a file (carries session cookie). */
export async function download(path, filename) {
  const r = await fetch(`/api${path}`, { headers: { 'x-station-csrf': '1' } });
  if (!r.ok) throw new Error(`Download failed (HTTP ${r.status})`);
  const blob = await r.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
