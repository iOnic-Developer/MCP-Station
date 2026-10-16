/** Build-time only. No runtime/site dependencies or network requests.
 * BRAND_RESVG_MODULE=/absolute/path/to/@resvg/resvg-js/index.js \
 * PRODUCT_FONT_FILE=/absolute/path/to/PlusJakartaSans.ttf node docs/site/generate-media.mjs
 * Use the licensed Plus Jakarta Sans upstream TTF documented in assets/SOURCES.md.
 * The output SVGs outline all lettering, so neither media format needs fonts installed.
 */
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
const require = createRequire(import.meta.url);
if (!process.env.PRODUCT_FONT_FILE) throw new Error('Set PRODUCT_FONT_FILE to the licensed Plus Jakarta Sans TTF.');
const { Resvg } = require(process.env.BRAND_RESVG_MODULE || '@resvg/resvg-js');
const root = new URL('./', import.meta.url);
const out = new URL('assets/product/', root);
await mkdir(out, { recursive: true });
const inner = (svg) => svg.replace(/^<svg[^>]*>/, '').replace(/<title[^>]*>.*?<\/title>/s, '').replace(/<\/svg>\s*$/, '');
const mark = inner(await readFile(new URL('assets/station-mark.svg', root), 'utf8'));
const wordmark = inner(await readFile(new URL('assets/station-wordmark.svg', root), 'utf8'));
const svg = (width, height, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#f6f4ee"/>${body}</svg>`;
const text = (x, y, size, content, color = '#172c25', weight = 600) => `<text x="${x}" y="${y}" font-family="Plus Jakarta Sans" font-size="${size}" font-weight="${weight}" letter-spacing="-1">${content}</text>`;
const items = [
  ['social-card', 1200, 630, svg(1200, 630, `
    <g transform="translate(64 48)">${wordmark}</g>
    <path d="M64 126H1136" stroke="#c9d1c6"/>
    ${text(64, 224, 54, 'Turn your APIs and')}
    ${text(64, 292, 54, 'services into MCP tools.', '#116859')}
    ${text(64, 369, 28, 'One integration. Multiple accounts.')}
    ${text(64, 414, 28, 'Your local and cloud AI clients.', '#506258', 400)}
    <rect x="976" y="166" width="160" height="160" rx="12" fill="#e8ede5"/>
    <g transform="translate(1008 198) scale(1.5)">${mark}</g>
    <path d="M64 470H1136" stroke="#c9d1c6"/>
    ${text(64, 528, 24, 'Your APIs → MCP tools → Compatible clients')}
    ${text(64, 590, 18, 'Self-hosted / Compatible MCP clients', '#506258', 400)}
  `)],
  ['brand-banner', 1600, 560, svg(1600, 560, `
    <g transform="translate(72 48) scale(1.15)">${wordmark}</g>
    <path d="M72 132H1528" stroke="#c9d1c6"/>
    ${text(72, 246, 64, 'Turn your APIs and services')}
    ${text(72, 326, 64, 'into MCP tools.', '#116859')}
    <rect x="1288" y="180" width="184" height="184" rx="12" fill="#e8ede5"/>
    <g transform="translate(1324 216) scale(1.75)">${mark}</g>
    ${text(72, 390, 27, 'One integration. Multiple accounts. Your local and cloud AI clients.', '#506258', 400)}
    <path d="M72 436H1528" stroke="#c9d1c6"/>
    ${text(72, 496, 25, 'Your APIs → MCP tools → Compatible clients')}
    ${text(1190, 496, 19, 'Self-hosted MCP hub', '#506258', 400)}
  `)]
];
for (const [name, width, height, source] of items) {
  const renderer = new Resvg(source, { font: { loadSystemFonts: false, fontFiles: [process.env.PRODUCT_FONT_FILE] } });
  const outlined = renderer.toString();
  if (/<text[\s>]/.test(outlined)) throw new Error(`${name}: text was not outlined`);
  const accessible = outlined.replace(/<svg\b/, '<svg role="img" aria-labelledby="title"')
    .replace(/(<svg[^>]*>)/, '$1<title id="title">MCP Station — Turn your APIs and services into MCP tools. One integration. Multiple accounts. Your local and cloud AI clients. Self-hosted MCP hub.</title>');
  await writeFile(new URL(`${name}.svg`, out), accessible);
  await writeFile(new URL(`${name}.png`, out), renderer.render().asPng());
  console.log(`Generated ${name}.svg / .png (${width} × ${height}), with outlined lettering.`);
}
