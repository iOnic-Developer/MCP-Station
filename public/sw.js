/* Public artwork + offline document only. Never an offline admin application.
 * Change the version when any precached resource changes.
 */
const CACHE_PREFIX = 'mcp-station-public-product-';
const CACHE_NAME = 'mcp-station-public-product-v3-stable-270';
const OFFLINE_URL = '/offline.html';
const PUBLIC_ASSETS = Object.freeze([
  '/offline.html',
  '/manifest.webmanifest',
  '/assets/css/pwa.css',
  '/assets/fonts/plus-jakarta-sans-latin.woff2',
  '/assets/brand/station-mark.svg',
  '/assets/brand/station-wordmark.svg',
  '/assets/brand/favicon.svg',
  '/assets/brand/favicon.ico',
  '/assets/brand/icon-192.png',
  '/assets/brand/icon-512.png',
  '/assets/brand/maskable-512.png',
  '/assets/brand/apple-touch-icon.png'
]);
const allowed = new Set(PUBLIC_ASSETS);

function publicResponse(response, url) {
  return response.ok && response.type !== 'opaque' && !response.redirected &&
    (!response.url || response.url === url) &&
    !/\b(?:private|no-store)\b/i.test(response.headers.get('Cache-Control') || '') &&
    !/(?:^|,)\s*(?:cookie|authorization|\*)\s*(?:,|$)/i.test(response.headers.get('Vary') || '');
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    // Validate all responses before writing; credentialless fetches cannot include sessions.
    const entries = await Promise.all(PUBLIC_ASSETS.map(async (path) => {
      const request = new Request(new URL(path, self.location.origin), {
        credentials: 'omit', cache: 'reload', redirect: 'error'
      });
      const response = await fetch(request);
      if (!publicResponse(response, request.url)) throw new Error('Public asset unavailable');
      const type = response.headers.get('Content-Type') || '';
      if (path === OFFLINE_URL ? !type.includes('text/html') : type.includes('text/html')) {
        throw new Error('Unexpected public asset type');
      }
      return [request, response];
    }));
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(entries.map(([request, response]) => cache.put(request, response)));
    // Do not skip waiting. An open editor must keep its current worker until consent.
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
      .map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  // Accept activation only from a same-origin window under this registration's scope.
  if (event.data?.type !== 'SKIP_WAITING' || event.source?.type !== 'window') return;
  try {
    const url = new URL(event.source.url);
    if (url.origin === self.location.origin && url.href.startsWith(self.registration.scope)) {
      event.waitUntil(self.skipWaiting());
    }
  } catch { /* No trusted client: keep waiting. */ }
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.search ||
      request.headers.has('authorization') || request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    // Authentication / API / MCP / shared-file URLs pass through without interception.
    // Only the dashboard document gets a generic offline fallback; never cache it.
    if (url.pathname !== '/' && url.pathname !== '/index.html') return;
    event.respondWith((async () => {
      try { return await fetch(request); }
      catch {
        const cache = await caches.open(CACHE_NAME);
        return await cache.match(OFFLINE_URL) || new Response(
          'MCP Station cannot be reached. Reconnect, then reload. No dashboard data is stored offline.',
          { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } }
        );
      }
    })());
    return;
  }

  if (!allowed.has(url.pathname)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    // Lookup only, no runtime cache writes. Queries, tokens and arbitrary URLs cannot enter.
    return await cache.match(url.pathname) || fetch(request);
  })());
});
