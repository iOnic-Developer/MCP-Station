import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, password } from './server-fixture.mjs';
let server;
before(async () => { server = await startServer(); });
after(async () => { await server?.stop(); });
test('actual health and public OAuth discovery remain available', async () => {
  const response = await fetch(`${server.base}/healthz`);
  assert.equal(response.status, 200); assert.equal((await response.json()).modules, 0);
  const oauth = await fetch(`${server.base}/.well-known/oauth-authorization-server`);
  assert.equal(oauth.status, 200);
  assert.equal((await oauth.json()).issuer, `${server.base}/`);
});
test('actual auth: invalid login, HttpOnly session, protected API, CSRF rejection and logout', async () => {
  assert.equal((await fetch(`${server.base}/api/mcps`)).status, 401);
  const login = (value) => fetch(`${server.base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: value }) });
  assert.equal((await login('incorrect')).status, 401);
  const response = await login(password); assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie'); assert.match(cookie, /HttpOnly/); assert.match(cookie, /SameSite=Lax/);
  const headers = { cookie: cookie.split(';')[0] };
  assert.equal((await fetch(`${server.base}/api/mcps`, { headers })).status, 200);
  const rejected = await fetch(`${server.base}/api/reload`, { method: 'POST', headers });
  assert.equal(rejected.status, 403); assert.match((await rejected.json()).error, /CSRF/);
  assert.equal((await fetch(`${server.base}/api/logout`, { method: 'POST', headers })).status, 200);
  assert.equal((await fetch(`${server.base}/api/mcps`, { headers })).status, 401);
});
test('real static response headers, manifest MIME and decodable PNG icon dimensions', async () => {
  for (const route of ['/', '/assets/js/app.js', '/assets/manifest.webmanifest', '/sw.js']) {
    const response = await fetch(server.base + route); assert.equal(response.status, 200, route);
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff', route);
    assert.equal(response.headers.get('x-frame-options'), 'DENY', route);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer', route);
  }
  const worker = await fetch(`${server.base}/sw.js`);
  assert.equal(worker.headers.get('service-worker-allowed'), '/');
  assert.equal(worker.headers.get('cache-control'), 'no-cache');
  assert.match(worker.headers.get('content-type'), /javascript/);
  const response = await fetch(`${server.base}/assets/manifest.webmanifest`);
  assert.match(response.headers.get('content-type'), /manifest\+json/);
  const manifest = await response.json(); assert.equal(manifest.scope, '/'); assert.equal(manifest.display, 'standalone');
  assert(manifest.icons.some((icon) => icon.purpose === 'maskable'));
  for (const icon of manifest.icons) {
    const response = await fetch(server.base + icon.src); assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /image\/png/);
    const png = Buffer.from(await response.arrayBuffer()); assert.equal(png.toString('hex', 0, 8), '89504e470d0a1a0a');
    assert.equal(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`, icon.sizes);
  }
});
