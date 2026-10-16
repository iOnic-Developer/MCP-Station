/** node scripts/test-product-page.mjs
 * Optional browser checks: PRODUCT_BROWSER_MODULE=/path/to/playwright/index.mjs
 * PRODUCT_AXE_MODULE=/path/to/@axe-core/playwright/dist/index.js
 * REQUIRE_PRODUCT_SCREENSHOT=1 makes the parent screenshot mandatory.
 */
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const site = path.join(root, 'docs/site');
const html = await readFile(path.join(site, 'index.html'), 'utf8');
const css = await readFile(path.join(site, 'site.css'), 'utf8');
const js = await readFile(path.join(site, 'site.js'), 'utf8');
const exists = async (file) => { try { return (await stat(file)).isFile(); } catch { return false; } };
const screenshotPath = path.join(root, 'docs/assets/product/integrations.png');
const hasScreenshot = await exists(screenshotPath);
if (!hasScreenshot) {
  assert.notEqual(process.env.REQUIRE_PRODUCT_SCREENSHOT, '1', 'Missing parent screenshot: docs/assets/product/integrations.png');
  console.log('PENDING: parent screenshot docs/assets/product/integrations.png; only this missing image is tolerated.');
}
assert.equal((html.match(/<h1\b/g) || []).length, 1);
assert.match(html, /Turn your APIs and services<br><span>into MCP tools\./);
assert.match(html, /One integration\. Multiple accounts\. Your local and cloud AI clients\./);
assert.match(html, /Local models require an MCP-capable client/);
assert.match(html, /Live end-to-end compatibility has not been verified/);
assert.match(html, /This is not universal website automation/);
assert.match(html, /complete 18-module bundle/);
assert.match(html, /18 bundled modules/);
assert.match(html, /Included in 2\.7\.0 stable/);
assert.match(html, /Get MCP Station 2\.7\.0/);
assert.match(html, /existing module folders are never overwritten/);
assert.doesNotMatch(html, /2\.7\.0_beta|Stable 2\.4|branch preview|redesign\/public-product|not all in the beta image/i);
for (const client of ['ChatGPT', 'Claude', 'LibreChat', 'Other MCP clients']) assert.ok(html.includes(`<li>${client}</li>`));
const moduleList = html.match(/<ul class="module-names"[^>]*>(.*?)<\/ul>/s)[1];
assert.equal((moduleList.match(/<li>/g) || []).length, 18);
for (const service of ['Gmail', 'Google Drive', 'GitHub', 'Docker Hub', 'Todoist', 'Pushover', 'Proton Pass', 'Cloudflare', 'Files', 'Gemini', 'n8n', 'OpenProject', 'Radarr', 'SiYuan', 'Sonarr', 'Station', 'Telegram', 'Xero']) assert.ok(moduleList.includes(`<li>${service}</li>`));
if (hasScreenshot) {
  const png = await readFile(screenshotPath);
  const image = html.match(/<img class="product-screenshot"[^>]*width="(\d+)" height="(\d+)"/);
  assert.ok(image, 'Reserve screenshot dimensions');
  assert.equal(Number(image[1]), png.readUInt32BE(16));
  assert.equal(Number(image[2]), png.readUInt32BE(20));
}
assert.match(html, /href="#main"/);
assert.match(html, /<main id="main" tabindex="-1"/);
assert.match(css, /:focus-visible/);
assert.match(css, /prefers-reduced-motion/);
assert.doesNotMatch(html, /<style\b|<script[^>]*>\s*[^<\s]|\son\w+=/i);
assert.doesNotMatch(css, /@import|https?:\/\//);
assert.doesNotMatch(js, /fetch\(|import\s|https?:\/\//);
assert.doesNotMatch(html + css, /(?:src|href)=["']\/|url\(["']?\//);
assert.match(html, /docker pull dbzocchi\/mcp-station:2\.7\.0/);
assert.match(html, /Moving <code>2\.7<\/code> and <code>latest<\/code>/);
assert.match(html, /https:\/\/ionic-developer\.github\.io\/MCP-Station\/site\//);
const publishedSite = 'https://ionic-developer.github.io/MCP-Station/site/';
assert.ok(html.includes(`<link rel="canonical" href="${publishedSite}">`));
assert.ok(html.includes(`<meta property="og:url" content="${publishedSite}">`));
for (const tag of ['property="og:image"', 'name="twitter:image"']) {
  assert.ok(html.includes(`<meta ${tag} content="${publishedSite}assets/product/social-card.png">`));
}
assert.ok(await exists(path.join(site, 'assets/product/social-card.png')));
assert.match(html, /href="https:\/\/hub\.docker\.com\/r\/dbzocchi\/mcp-station\/tags\?name=2\.7\.0">Get MCP Station 2\.7\.0/);

const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
assert.equal(new Set(ids).size, ids.length, 'Duplicate HTML IDs');
for (const [, fragment] of html.matchAll(/href="#([^"]+)"/g)) assert.ok(ids.includes(fragment), `Missing anchor ${fragment}`);
for (const [, attr, target] of html.matchAll(/\b(src|href)="([^"]+)"/g)) {
  if (target.startsWith('#')) continue;
  if (target === 'https://ionic-developer.github.io/MCP-Station/site/') continue;
  if (target.startsWith('https://')) {
    const url = new URL(target.replaceAll('&amp;', '&'));
    assert.ok(['github.com', 'hub.docker.com'].includes(url.hostname), `Unexpected external link ${target}`);
    if (url.hostname === 'github.com' && url.pathname.includes('/blob/')) {
      const relative = url.pathname.split('/blob/main/')[1];
      assert.ok(relative, `Docs not linked to main source: ${target}`);
      assert.ok(await exists(path.join(root, relative)), `Missing linked source ${relative}`);
    }
    continue;
  }
  const resolved = path.resolve(site, target);
  if (resolved === screenshotPath && !hasScreenshot) continue;
  assert.ok(await exists(resolved), `Missing local ${attr}: ${target}`);
}
for (const [, target] of css.matchAll(/url\(['"]?([^)'"\s]+)/g)) assert.ok(await exists(path.join(site, target)));
for (const name of ['station-mark.svg', 'station-wordmark.svg', 'favicon.svg']) {
  assert.deepEqual(await readFile(path.join(site, 'assets', name)), await readFile(path.join(root, 'public/assets/brand', name)));
}
for (const name of ['plus-jakarta-sans-latin.woff2', 'plus-jakarta-sans-OFL.txt']) {
  assert.deepEqual(await readFile(path.join(site, 'assets', name)), await readFile(path.join(root, 'public/assets/fonts', name)));
}
for (const [name, width, height] of [['social-card', 1200, 630], ['brand-banner', 1600, 560]]) {
  const png = await readFile(path.join(root, `docs/site/assets/product/${name}.png`));
  assert.equal(png.subarray(1, 4).toString(), 'PNG');
  assert.equal(png.readUInt32BE(16), width);
  assert.equal(png.readUInt32BE(20), height);
  const svg = await readFile(path.join(root, `docs/site/assets/product/${name}.svg`), 'utf8');
  assert.match(svg, /<title/);
  assert.doesNotMatch(svg.match(/<title[^>]*>(.*?)<\/title>/s)[1], /branch preview|beta|2\.4|2\.7/i);
  assert.match(svg, /Turn your APIs and services into MCP tools/);
  assert.match(svg, /One integration\. Multiple accounts\. Your local and cloud AI clients\./);
  assert.doesNotMatch(svg, /<text[\s>]|https?:\/\/(?!www\.w3\.org)/);
}
console.log('PASS: static contracts, local assets/licenses, main documentation targets, metadata and outlined SVG/PNG dimensions.');
if (!process.env.PRODUCT_BROWSER_MODULE) {
  console.log('SKIP: browser checks; set PRODUCT_BROWSER_MODULE and PRODUCT_AXE_MODULE to existing test dependencies.');
} else {
  assert.ok(process.env.PRODUCT_AXE_MODULE, 'Set PRODUCT_AXE_MODULE; browser audit must not silently skip axe.');
  const { chromium } = await import(pathToFileURL(process.env.PRODUCT_BROWSER_MODULE).href);
  const axeModule = require(process.env.PRODUCT_AXE_MODULE);
  const AxeBuilder = axeModule.default || axeModule;
  const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain' };
  const server = createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (pathname.startsWith('/project/')) pathname = `/docs/${pathname.slice('/project/'.length)}`;
      else if (pathname.startsWith('/docs-root/')) pathname = `/docs/${pathname.slice('/docs-root/'.length)}`;
      let file = path.resolve(root, `.${pathname}`);
      if (!file.startsWith(`${root}${path.sep}`)) throw new Error('Outside test root');
      if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(await readFile(file));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  let browser;
  try {
    browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const context = await browser.newContext({ reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
    await context.addInitScript(() => {
      window.productCLS = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.productCLS += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    const page = await context.newPage();
    const errors = [], external = [], broken = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (req) => { if (!req.url().startsWith(origin)) external.push(req.url()); });
    page.on('response', (res) => { if (res.status() >= 400 && !(res.url().endsWith('/assets/product/integrations.png') && !hasScreenshot)) broken.push(res.url()); });
    for (const route of ['/docs/site/', '/docs-root/site/', '/project/site/']) {
      // Project mode publishes docs as the project root, like GitHub Pages docs source.
      await page.goto(origin + route, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts.ready);
      assert.ok(await page.evaluate(() => document.fonts.check('600 16px "Plus Jakarta Sans"')));
      assert.equal(await page.locator('h1').count(), 1);
      if (hasScreenshot) {
        const size = await page.locator('.product-screenshot').evaluate((el) => ({ width: el.naturalWidth, height: el.naturalHeight, reservedWidth: el.width, reservedHeight: el.height, ratio: el.getAttribute('width') / el.getAttribute('height') }));
        assert.ok(size.width > 0 && size.height > 0, 'Parent screenshot must load');
        assert.equal(size.ratio, size.width / size.height, 'Intrinsic screenshot ratio');
      }
    }
    for (const [width, height] of [[375, 812], [667, 375], [768, 1024], [1440, 1000]]) {
      await page.setViewportSize({ width, height });
      await page.goto(origin + '/docs/site/', { waitUntil: 'networkidle' });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Horizontal overflow at ${width}`);
      await page.evaluate(() => document.fonts.ready);
      const cls = await page.evaluate(() => window.productCLS);
      assert.ok(cls <= 0.01, `Unexpected layout shift at ${width}: ${cls}`);
      const smallTargets = await page.locator('a,button').evaluateAll((els) => els.filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width && r.height && (r.width < 44 || r.height < 44);
      }).map((el) => el.textContent.trim()));
      assert.deepEqual(smallTargets, [], `Targets under 44px at ${width}`);
      const audit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
      assert.deepEqual(audit.violations.map((v) => ({ id: v.id, nodes: v.nodes.map((n) => n.target) })), [], `axe violations at ${width}`);
      if (process.env.PRODUCT_TEST_OUTPUT) await page.screenshot({ path: path.join(process.env.PRODUCT_TEST_OUTPUT, `product-${width}.png`), fullPage: true });
      console.log(`PASS: ${width} × ${height}: no overflow, CLS ≤ 0.01, 44px targets, axe WCAG AA.`);
    }
    await page.goto(origin + '/docs/site/');
    const cta = page.getByRole('link', { name: 'Get MCP Station 2.7.0' });
    assert.equal(await cta.count(), 1);
    assert.equal(await cta.getAttribute('href'), 'https://hub.docker.com/r/dbzocchi/mcp-station/tags?name=2.7.0');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'skip-link');
    assert.equal(await page.locator('.skip-link').evaluate((el) => getComputedStyle(el).outlineStyle), 'solid');
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'main');
    await page.locator('a[href="#boundaries"]').click();
    assert.ok(page.url().endsWith('#boundaries'));
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior), 'auto');
    await page.getByRole('button', { name: 'Copy command' }).click();
    await page.waitForFunction(() => document.querySelector('[data-copy-status]').textContent.includes('Command copied'));
    assert.match(await page.locator('[data-copy-status]').textContent(), /Command copied/);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'docker pull dbzocchi/mcp-station:2.7.0');
    await page.evaluate(() => { navigator.clipboard.writeText = async () => { throw new Error('Permission denied'); }; });
    await page.getByRole('button', { name: 'Copy command' }).click();
    await page.waitForFunction(() => document.querySelector('[data-copy-status]').textContent.includes('Select and copy'));
    assert.match(await page.locator('[data-copy-status]').textContent(), /Select and copy/);
    await page.setViewportSize({ width: 375, height: 812 });
    await page.addStyleTag({ content: 'html { font-size: 200%; }' });
    const textOverflow = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => el.getBoundingClientRect().right > innerWidth + 1).map((el) => ({ tag: el.tagName, class: el.className, right: el.getBoundingClientRect().right })));
    assert.deepEqual(textOverflow, [], 'Overflow at 200% text');
    const noJS = await browser.newContext({ javaScriptEnabled: false });
    const plain = await noJS.newPage();
    await plain.goto(origin + '/docs-root/site/');
    assert.ok(await plain.locator('[data-copy]').isHidden());
    await plain.locator('a[href="#start"]').click();
    assert.ok(plain.url().endsWith('#start'));
    assert.match(await plain.locator('#pull-command').textContent(), /^docker pull /);
    assert.deepEqual(external, [], 'Page must make no third-party requests');
    assert.deepEqual(errors, [], 'Browser JS errors');
    assert.deepEqual(broken, [], 'Unexpected missing page resources');
    const loadedImages = await page.locator('img').evaluateAll((els) => els.map((el) => ({ src: el.getAttribute('src'), loaded: el.complete && el.naturalWidth > 0 })));
    for (const img of loadedImages) if (img.src !== '../assets/product/integrations.png' || hasScreenshot) assert.ok(img.loaded, `Image failed: ${img.src}`);
    console.log('PASS: root/prefixed paths, local fonts/images, keyboard skip/focus/navigation, reduced motion, clipboard success/failure, 200% text, no JS and zero external requests.');
  } finally {
    await browser?.close();
    await new Promise((resolve) => server.close(resolve));
  }
}
