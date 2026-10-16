/** Run with: node scripts/test-pwa.mjs — built-ins only, no running server needed. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import vm from 'node:vm';
import { inflateSync } from 'node:zlib';

const publicDir = new URL('../public/', import.meta.url);
const read = (path, encoding = 'utf8') => readFile(new URL(path.replace(/^\//, ''), publicDir), encoding);
const workerSource = await read('sw.js');
const pwaSource = await read('assets/js/pwa.js');
const origin = 'https://station.test';
const cacheName = 'mcp-station-public-product-v3-stable-270';

function workerHarness({ offline = false, response = () => new Response('public', {
  headers: { 'Content-Type': 'text/plain', 'Cache-Control': 'no-cache' }
}) } = {}) {
  const listeners = new Map();
  const stores = new Map();
  const fetches = [];
  let writes = 0;
  let skips = 0;
  let claims = 0;
  const key = (req) => new URL(typeof req === 'string' ? req : req.url, origin).href;
  const caches = {
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async put(req, value) { writes++; store.set(key(req), value); },
        async match(req) { return store.get(key(req))?.clone(); }
      };
    }
  };
  const context = vm.createContext({
    URL, Request, Response, Set, Object, caches,
    fetch: async (req) => {
      fetches.push(req);
      if (offline) throw new TypeError('Network unavailable');
      const path = new URL(req.url).pathname;
      if (path === '/offline.html') return new Response('PUBLIC OFFLINE', { headers: { 'Content-Type': 'text/html' } });
      return response(req);
    },
    self: {
      location: { origin }, registration: { scope: `${origin}/` },
      clients: { async claim() { claims++; } },
      async skipWaiting() { skips++; },
      addEventListener(type, listener) { listeners.set(type, listener); }
    }
  });
  vm.runInContext(workerSource, context);
  return {
    context, stores, fetches, get writes() { return writes; }, get skips() { return skips; }, get claims() { return claims; },
    assets: Array.from(vm.runInContext('PUBLIC_ASSETS', context)),
    async fire(type, extra = {}) {
      let pending;
      listeners.get(type)({ ...extra, waitUntil(promise) { pending = promise; } });
      await pending;
    },
    fetch(path, { mode = 'cors', method = 'GET', headers = {} } = {}) {
      let result;
      listeners.get('fetch')({
        request: { url: new URL(path, origin).href, mode, method, headers: new Headers(headers) },
        respondWith(promise) { result = promise; }
      });
      return result;
    }
  };
}

function pngSize(data) {
  assert.equal(data.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(data.toString('ascii', 12, 16), 'IHDR');
  return [data.readUInt32BE(16), data.readUInt32BE(20)];
}

function decodePng(data) {
  const [width, height] = pngSize(data);
  assert.equal(data[24], 8, '8-bit PNG');
  assert.equal(data[25], 6, 'RGBA PNG');
  const chunks = [];
  for (let at = 8; at < data.length;) {
    const size = data.readUInt32BE(at);
    if (data.toString('ascii', at + 4, at + 8) === 'IDAT') chunks.push(data.subarray(at + 8, at + 8 + size));
    at += 12 + size;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a, b, c) => {
    const p = a + b - c;
    const da = Math.abs(p - a), db = Math.abs(p - b), dc = Math.abs(p - c);
    return da <= db && da <= dc ? a : db <= dc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    assert.ok(filter <= 4);
    for (let x = 0; x < stride; x++) {
      const at = y * stride + x;
      const left = x >= 4 ? pixels[at - 4] : 0;
      const above = y ? pixels[at - stride] : 0;
      const upperLeft = y && x >= 4 ? pixels[at - stride - 4] : 0;
      const delta = [0, left, above, Math.floor((left + above) / 2), paeth(left, above, upperLeft)][filter];
      pixels[at] = (raw[y * (stride + 1) + 1 + x] + delta) & 255;
    }
  }
  return { width, height, pixels };
}

test('manifest has stable identity, correct launch scope and separate any/maskable icons', async () => {
  const manifest = JSON.parse(await read('manifest.webmanifest'));
  for (const field of ['id', 'start_url', 'scope']) assert.equal(manifest[field], '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.name, 'MCP Station');
  assert.ok(manifest.description);
  assert.equal(manifest.theme_color, '#116859');
  assert.equal(manifest.background_color, '#f7f8fa');
  assert.deepEqual(manifest.icons.map((icon) => [icon.sizes, icon.purpose]), [
    ['192x192', 'any'], ['512x512', 'any'], ['512x512', 'maskable']
  ]);
  for (const icon of manifest.icons) {
    assert.match(icon.src, /^\/assets\/brand\/[a-z0-9-]+\.png$/);
    assert.equal(icon.type, 'image/png');
    assert.equal(pngSize(await read(icon.src, null)).join('x'), icon.sizes);
  }
  assert.deepEqual(pngSize(await read('assets/brand/apple-touch-icon.png', null)), [180, 180]);
});

test('maskable glyph is opaque and entirely inside the 40% safe circle', async () => {
  const { width, height, pixels } = decodePng(await read('assets/brand/maskable-512.png', null));
  let glyphPixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const at = (y * width + x) * 4;
    assert.equal(pixels[at + 3], 255);
    if (pixels[at] !== 247 || pixels[at + 1] !== 248 || pixels[at + 2] !== 250) {
      glyphPixels++;
      assert.ok(Math.hypot(x + 0.5 - width / 2, y + 0.5 - height / 2) <= width * 0.4);
    }
  }
  assert.ok(glyphPixels > 10000);
});

test('ICO contains valid 16/32/48 PNG frames; SVG wordmark uses portable outlines', async () => {
  const ico = await read('assets/brand/favicon.ico', null);
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  assert.equal(ico.readUInt16LE(4), 3);
  for (const [i, size] of [16, 32, 48].entries()) {
    const at = 6 + i * 16;
    assert.equal(ico[at], size);
    assert.equal(ico[at + 1], size);
    const start = ico.readUInt32LE(at + 12), len = ico.readUInt32LE(at + 8);
    assert.ok(start + len <= ico.length);
    assert.deepEqual(pngSize(ico.subarray(start, start + len)), [size, size]);
  }
  for (const file of ['station-mark.svg', 'station-wordmark.svg', 'favicon.svg']) {
    const svg = await read(`assets/brand/${file}`);
    assert.match(svg, /viewBox=/);
    assert.doesNotMatch(svg, /<(?:script|image|text|foreignObject)|(?:href|src)=|gradient/i);
  }
});

test('index only loads app and PWA CSS, accessible metadata and licensed local WOFF2', async () => {
  const index = await read('index.html');
  assert.deepEqual([...index.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((x) => x[1]), [
    '/assets/css/app.css', '/assets/css/pwa.css'
  ]);
  assert.match(index, /viewport-fit=cover/);
  assert.doesNotMatch(index, /user-scalable|maximum-scale/);
  assert.match(index, /href="#main-content"/);
  assert.match(index, /id="toasts"[^>]*aria-live="polite"/);
  assert.match(index, /href="\/manifest.webmanifest"/);
  assert.match(index, /apple-touch-icon/);
  assert.equal((await read('assets/fonts/plus-jakarta-sans-latin.woff2', null)).toString('ascii', 0, 4), 'wOF2');
  assert.match(await read('assets/fonts/plus-jakarta-sans-OFL.txt'), /SIL OPEN FONT LICENSE Version 1.1/);
  assert.match(await read('assets/fonts/SOURCES.md'), /google\/fonts/);
  const offline = await read('offline.html');
  assert.match(offline, /id="main-content"/);
  assert.match(offline, /href="\/"/);
  assert.doesNotMatch(offline, /<script|app\.js|\/api\//);
});

test('precache is an explicit existing public allowlist; credentials omitted; no app or private paths', async () => {
  const worker = workerHarness();
  assert.equal(worker.assets.length, new Set(worker.assets).size);
  for (const path of worker.assets) {
    assert.ok(path === '/offline.html' || path === '/manifest.webmanifest' ||
      path === '/assets/css/pwa.css' || path === '/assets/fonts/plus-jakarta-sans-latin.woff2' ||
      /^\/assets\/brand\/[a-z0-9-]+\.(svg|ico|png)$/.test(path), path);
    assert.doesNotMatch(path, /api|auth|token|settings|login|app\.(js|css)|views|\?/);
    await access(new URL(path.slice(1), publicDir));
  }
  await worker.fire('install');
  assert.equal(worker.writes, worker.assets.length);
  assert.equal(worker.skips, 0);
  assert.equal(worker.fetches.length, worker.assets.length);
  for (const request of worker.fetches) {
    assert.equal(request.credentials, 'omit');
    assert.equal(request.redirect, 'error');
    assert.equal(request.cache, 'reload');
  }
});

test('precache fails closed for private, varying, redirected, HTML or failed static responses', async () => {
  const badResponses = [
    () => new Response('private', { headers: { 'Cache-Control': 'private' } }),
    () => new Response('private', { headers: { 'Cache-Control': 'no-store' } }),
    ...['Cookie', 'Authorization', '*', 'Accept-Encoding, Cookie'].map((vary) => () => new Response('varies', { headers: { Vary: vary } })),
    () => new Response('login', { headers: { 'Content-Type': 'text/html' } }),
    () => new Response('missing', { status: 404 }),
    () => ({ ok: true, type: 'basic', redirected: true, headers: new Headers() })
  ];
  for (const response of badResponses) {
    const worker = workerHarness({ response });
    await assert.rejects(worker.fire('install'));
    assert.equal(worker.writes, 0);
    assert.equal(worker.skips, 0);
  }
});

test('auth, OAuth queries, API, MCP, arbitrary paths and non-GET requests are not intercepted', async () => {
  const worker = workerHarness();
  for (const path of ['/api/me', '/api/settings', '/login', '/logout', '/authorize', '/oauth/callback',
    '/token', '/register', '/siyuan/mcp', '/siyuan', '/f/secret', '/.well-known/oauth-authorization-server',
    '/unknown', '/?code=secret&state=secret', '/index.html?token=secret', '/assets/brand/icon-192.png?access_token=secret',
    'https://other.test/assets/brand/icon-192.png']) {
    for (const mode of ['cors', 'navigate']) assert.equal(worker.fetch(path, { mode }), undefined, path);
  }
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
    assert.equal(worker.fetch('/assets/brand/icon-192.png', { method }), undefined);
  }
  for (const headers of [{ Authorization: 'Bearer secret' }, { Range: 'bytes=0-10' }]) {
    assert.equal(worker.fetch('/', { mode: 'navigate', headers }), undefined);
    assert.equal(worker.fetch('/assets/brand/icon-192.png', { headers }), undefined);
  }
  assert.equal(worker.writes, 0);
  assert.equal(worker.fetches.length, 0);
});

test('dashboard is network-first, never written to cache; offline is generic; HTTP errors preserved', async () => {
  const worker = workerHarness({ response: () => new Response('AUTHENTICATED DASHBOARD') });
  await worker.fire('install');
  const before = worker.writes;
  assert.equal(await (await worker.fetch('/', { mode: 'navigate' })).text(), 'AUTHENTICATED DASHBOARD');
  assert.equal(worker.writes, before);
  assert.equal(worker.stores.get(cacheName).has(`${origin}/`), false);
  const offline = workerHarness({ offline: true });
  offline.stores.set(cacheName, new Map([[`${origin}/offline.html`, new Response('PUBLIC OFFLINE')]]));
  for (const path of ['/', '/index.html']) {
    assert.equal(await (await offline.fetch(path, { mode: 'navigate' })).text(), 'PUBLIC OFFLINE');
  }
  assert.equal(offline.writes, 0);
  const empty = workerHarness({ offline: true });
  const fallback = await empty.fetch('/', { mode: 'navigate' });
  assert.equal(fallback.status, 503);
  assert.match(await fallback.text(), /No dashboard data/);
  for (const status of [401, 403, 500, 503]) {
    const error = workerHarness({ response: () => new Response('server error', { status }) });
    assert.equal((await error.fetch('/', { mode: 'navigate' })).status, status);
  }
});

test('static hits read only own cache; missing assets never populate runtime cache', async () => {
  const worker = workerHarness();
  await worker.fire('install');
  const before = worker.writes, requests = worker.fetches.length;
  assert.equal(await (await worker.fetch('/assets/brand/favicon.svg')).text(), 'public');
  assert.equal(worker.fetches.length, requests);
  worker.stores.get(cacheName).delete(`${origin}/assets/brand/favicon.svg`);
  await worker.fetch('/assets/brand/favicon.svg');
  assert.equal(worker.fetches.length, requests + 1);
  assert.equal(worker.writes, before);
});

test('activation deletes only owned prefix; user message alone can skip waiting', async () => {
  const worker = workerHarness();
  for (const name of [cacheName, 'mcp-station-public-product-v0', 'other-app-v1', 'mcp-station-private-v1']) worker.stores.set(name, new Map());
  await worker.fire('activate');
  assert.deepEqual([...worker.stores.keys()], [cacheName, 'other-app-v1', 'mcp-station-private-v1']);
  assert.equal(worker.claims, 1);
  assert.equal(worker.skips, 0);
  for (const extra of [
    { data: { type: 'SKIP_WAITING' } },
    { data: { type: 'SKIP_WAITING' }, source: { url: 'https://other.test/', type: 'window' } },
    { data: { type: 'SKIP_WAITING' }, source: { url: `${origin}/`, type: 'worker' } },
    { data: { type: 'OTHER' }, source: { url: `${origin}/`, type: 'window' } }
  ]) await worker.fire('message', extra);
  assert.equal(worker.skips, 0);
  await worker.fire('message', { data: { type: 'SKIP_WAITING' }, source: { url: `${origin}/`, type: 'window' } });
  assert.equal(worker.skips, 1);
});

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, fn) { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); },
    emit(type, event = {}) { for (const fn of listeners.get(type) || []) fn(event); }
  };
}
function uiHarness({ secure = true, ios = false, standalone = false, online = true, stored = false } = {}) {
  const children = new Map();
  function element() {
    return Object.assign(eventTarget(), {
      hidden: false, textContent: '', isConnected: true,
      setAttribute() {}, focus() { document.activeElement = this; },
      querySelector(selector) {
        if (!children.has(selector)) children.set(selector, element());
        return children.get(selector);
      }
    });
  }
  const document = { activeElement: null, createElement: element, body: { append() {} } };
  let registrations = 0, reloads = 0, confirmed = false, messages = 0;
  const registration = Object.assign(eventTarget(), { waiting: null, installing: null });
  const serviceWorker = Object.assign(eventTarget(), { register: async () => { registrations++; return registration; } });
  const navigator = { serviceWorker, onLine: online, userAgent: ios ? 'iPhone' : 'Test browser', platform: 'Test', maxTouchPoints: 0 };
  const window = Object.assign(eventTarget(), {
    isSecureContext: secure, matchMedia: () => ({ matches: standalone }),
    location: { reload() { reloads++; } }, confirm: () => confirmed
  });
  const context = vm.createContext({ window, navigator, document, sessionStorage: {
    getItem: () => stored ? '1' : null, setItem() { stored = true; }
  } });
  vm.runInContext(pwaSource.replace(/export (async )?function/g, '$1function'), context);
  return {
    children, window, navigator, registration, serviceWorker,
    init: () => vm.runInContext('initPwa()', context),
    install: () => vm.runInContext('requestInstall()', context),
    update: () => vm.runInContext('applyUpdate()', context),
    get registrations() { return registrations; }, get reloads() { return reloads; }, get messages() { return messages; },
    confirm(value) { confirmed = value; },
    waiting() { registration.waiting = Object.assign(eventTarget(), { postMessage(msg) { assert.equal(msg.type, 'SKIP_WAITING'); messages++; } }); },
    flush: () => new Promise((resolve) => setImmediate(resolve))
  };
}

test('initPwa is idempotent, secure-only, and insecure install explains HTTPS', async () => {
  const ui = uiHarness();
  assert.equal(ui.init(), ui.init());
  await ui.flush();
  assert.equal(ui.registrations, 1);
  const insecure = uiHarness({ secure: false });
  insecure.init();
  assert.equal(insecure.registrations, 0);
  assert.match(insecure.children.get('[role="status"]').textContent, /requires HTTPS/);
  assert.equal(await insecure.install(), false);
  assert.match(insecure.children.get('p').textContent, /plain HTTP LAN/);
});

test('manual installation is honest; iOS has instructions; dismissal and installed mode hide suggestion', async () => {
  for (const isIos of [false, true]) {
    const ui = uiHarness({ ios: isIos });
    ui.init();
    assert.equal(await ui.install(), false);
    assert.match(ui.children.get('p').textContent, isIos ? /Safari.*Share.*Add to Home Screen/ : /No install prompt is available/);
    ui.children.get('[data-dismiss]').emit('click');
    assert.equal(ui.children.get('[data-install]').hidden, true);
  }
  for (const options of [{ standalone: true }, { stored: true }]) {
    const ui = uiHarness(options); ui.init();
    assert.equal(ui.children.get('[data-install]').hidden, true);
  }
});

test('native prompt is one-use; acceptance is not claimed as confirmed installation', async () => {
  const ui = uiHarness(); ui.init();
  let prompts = 0, prevented = 0;
  ui.window.emit('beforeinstallprompt', {
    preventDefault() { prevented++; }, async prompt() { prompts++; },
    userChoice: Promise.resolve({ outcome: 'accepted' })
  });
  assert.equal(ui.children.get('[data-install]').textContent, 'Install Station');
  assert.equal(await ui.install(), true);
  assert.equal(prompts, 1); assert.equal(prevented, 1);
  assert.match(ui.children.get('p').textContent, /Complete any remaining/);
  assert.equal(await ui.install(), false);
  assert.equal(prompts, 1);
  ui.window.emit('appinstalled');
  assert.equal(ui.children.get('[data-install]').hidden, true);
});

test('offline event is truthful; online never claims server reachability', () => {
  const ui = uiHarness({ online: false }); ui.init();
  assert.match(ui.children.get('[role="status"]').textContent, /browser reports.*offline/);
  ui.navigator.onLine = true; ui.window.emit('online');
  assert.equal(ui.children.get('[role="status"]').textContent, '');
});

test('update requires waiting worker and reload consent; first install / other tabs never reload', async () => {
  const ui = uiHarness(); ui.init(); await ui.flush();
  assert.equal(ui.children.get('[data-update]').hidden, true);
  assert.equal(ui.update(), false);
  ui.serviceWorker.emit('controllerchange'); assert.equal(ui.reloads, 0);
  ui.registration.installing = Object.assign(eventTarget(), { state: 'installing' });
  ui.registration.emit('updatefound');
  assert.equal(ui.children.get('[data-update]').hidden, true);
  ui.waiting(); ui.registration.installing.state = 'installed'; ui.registration.installing.emit('statechange');
  assert.equal(ui.children.get('[data-update]').hidden, false);
  assert.equal(ui.update(), false); assert.equal(ui.messages, 0);
  ui.serviceWorker.emit('controllerchange'); assert.equal(ui.reloads, 0);
  ui.confirm(true); assert.equal(ui.update(), true); assert.equal(ui.messages, 1);
  assert.equal(ui.update(), false);
  // The retiring ACTIVE worker also becomes redundant: it is not an update failure.
  ui.registration.installing.state = 'redundant'; ui.registration.installing.emit('statechange');
  ui.serviceWorker.emit('controllerchange'); ui.serviceWorker.emit('controllerchange');
  assert.equal(ui.reloads, 1);
});


test('retiring active worker becoming redundant cannot cancel consent for a different waiting worker', async () => {
  const ui = uiHarness();
  const retiringWorker = Object.assign(eventTarget(), { state: 'installing' });
  ui.registration.installing = retiringWorker;
  ui.init(); await ui.flush();
  ui.waiting();
  ui.confirm(true); assert.equal(ui.update(), true);
  retiringWorker.state = 'redundant'; retiringWorker.emit('statechange');
  ui.serviceWorker.emit('controllerchange');
  assert.equal(ui.reloads, 1);
});
