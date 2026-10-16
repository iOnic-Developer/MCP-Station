/* PUBLIC ASSETS ONLY. No admin HTML, JavaScript, API, OAuth, MCP or credentials. */
const VERSION = 'station-public-v2';
const PUBLIC_ASSETS = new Map([
  ['/assets/css/app.css', ['text/css']],
  ['/assets/css/v2.css', ['text/css']],
  ['/assets/css/product.css', ['text/css']],
  ['/assets/css/modules.css', ['text/css']],
  ['/assets/fonts/manrope.ttf', ['font/ttf', 'application/x-font-ttf']],
  ['/assets/fonts/jetbrains-mono.ttf', ['font/ttf', 'application/x-font-ttf']],
  ['/assets/brand/station-mark.svg', ['image/svg+xml']],
  ['/assets/brand/favicon-32.png', ['image/png']],
  ['/assets/brand/apple-touch-180.png', ['image/png']],
  ['/assets/brand/icon-192.png', ['image/png']],
  ['/assets/brand/icon-512.png', ['image/png']],
  ['/assets/brand/maskable-512.png', ['image/png']],
  ['/assets/manifest.webmanifest', ['application/manifest+json']]
]);
const OFFLINE = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#101622"><title>Station is offline</title><body style="background:#101622;color:#edf1f9;font:16px/1.6 system-ui;padding:12vh 24px;max-width:520px;margin:auto"><p>MCP STATION</p><h1>You’re offline.</h1><p>Reconnect to sign in and manage modules. No dashboard data or credentials are stored for offline use.</p><a href="/" style="color:#b8c1ff">Try connecting again</a></body></html>';
async function publicResponse(path) {
  const response = await fetch(path, { credentials: 'omit', redirect: 'error', cache: 'no-cache' });
  const mime = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  if (!response.ok || response.type !== 'basic' || !PUBLIC_ASSETS.get(path)?.includes(mime)) throw new Error('Not an approved public asset');
  return response;
}
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.all([...PUBLIC_ASSETS.keys()].map(async (path) => {
      try { await cache.put(path, await publicResponse(path)); } catch { /* retry on next public request */ }
    }));
  })());
});
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith('station-public-') && key !== VERSION).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', (event) => {
  if (event.data?.type === 'STATION_ACCEPT_UPDATE') self.skipWaiting();
});
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search) return;
  // Only the exact application root gets a generic navigation fallback. Never store it.
  if (request.mode === 'navigate' && url.pathname === '/') {
    event.respondWith(fetch(request).catch(() => new Response(OFFLINE, {
      status: 503,
      headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'" }
    })));
    return;
  }
  if (!PUBLIC_ASSETS.has(url.pathname) || request.headers.has('authorization')) return;
  event.respondWith((async () => {
    const cache = await caches.open(VERSION);
    try {
      const response = await publicResponse(url.pathname);
      await cache.put(url.pathname, response.clone());
      return response;
    } catch {
      return (await cache.match(url.pathname)) || new Response('', { status: 503 });
    }
  })());
});
