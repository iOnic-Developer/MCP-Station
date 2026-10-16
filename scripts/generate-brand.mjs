/** Original Station ribbon artwork. Build-time only; never imported by the app.
 * BRAND_RESVG_MODULE=/absolute/path/to/@resvg/resvg-js/index.js node scripts/generate-brand.mjs
 * Renderer: @resvg/resvg-js 2.6.2. Install separately, not in the runtime project.
 */
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { Resvg } = require(process.env.BRAND_RESVG_MODULE || '@resvg/resvg-js');
const dir = new URL('../public/assets/brand/', import.meta.url);
const forest = '#116859';
const ink = '#172c25';
const pale = '#f7f8fa';
// A broad, asymmetric drawn S: curved bowls, diagonal waist, chisel-cut terminals.
// The ink plane is the ribbon's underside, not a second rail or disconnected bar.
const ribbon = `<path fill="${forest}" d="M53 13 44 23C40 19 36 17 31 17 25 17 22 19 22 22 22 25 25 27 31 29L38 31C49 35 54 40 54 47 54 56 45 61 32 61 21 61 12 57 6 51L15 41C20 46 26 49 32 49 38 49 42 47 42 44 42 41 39 39 33 37L26 35C15 31 10 26 10 19 10 10 19 5 31 5 40 5 48 8 53 13Z"/><path fill="${ink}" d="M22 22C22 25 25 27 31 29L38 31C41 32 44 33 46 35L42 44C42 41 39 39 33 37L26 35C25 35 23 34 22 34Z"/>`;
// Optical small-size drawing: one colour, wider counters, no fold detail.
const micro = `<path fill="${forest}" d="M13 4 11 6C10 5 9 5 8 5 6 5 5 5 5 6 5 7 7 7 9 8 12 9 13 10 13 12 13 14 11 15 8 15 5 15 3 14 2 13L4 11C5 12 6 12 8 12 9 12 10 12 10 11 10 10 8 10 6 9 3 8 2 7 2 5 2 3 4 2 7 2 10 2 12 3 13 4Z"/>`;
const svg = (size, body, title) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size}" role="img" aria-labelledby="title"><title id="title">${title}</title>${body}</svg>\n`;
const field = (radius = 0) => `<rect width="512" height="512"${radius ? ` rx="${radius}"` : ''} fill="${pale}"/>`;
await mkdir(dir, { recursive: true });
const lettering = (await readFile(new URL('wordmark-lettering.svg', dir), 'utf8'))
  .replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const sources = {
  'station-mark.svg': svg('64 64', ribbon, 'MCP Station — ribbon S'),
  'station-wordmark.svg': svg('260 48', `<g transform="translate(0 -1) scale(.75)">${ribbon}</g>${lettering}`, 'MCP Station'),
  'favicon.svg': svg('16 16', `<rect width="16" height="16" rx="3" fill="${pale}"/>${micro}`, 'MCP Station'),
  'icon-source.svg': svg('512 512', `${field(108)}<g transform="translate(32 32) scale(7)">${ribbon}</g>`, 'MCP Station'),
  // Extrema lie within the central 40%-radius safe circle, with generous margin.
  'maskable-source.svg': svg('512 512', `${field()}<g transform="translate(80 80) scale(5.5)">${ribbon}</g>`, 'MCP Station')
};
for (const [name, content] of Object.entries(sources)) await writeFile(new URL(name, dir), content);
const render = (source, width) => new Resvg(source, {
  fitTo: { mode: 'width', value: width }, font: { loadSystemFonts: false }
}).render().asPng();
for (const [name, size, source] of [
  ['icon-192.png', 192, 'icon-source.svg'],
  ['icon-512.png', 512, 'icon-source.svg'],
  ['maskable-512.png', 512, 'maskable-source.svg'],
  ['apple-touch-icon.png', 180, 'maskable-source.svg']
]) await writeFile(new URL(name, dir), render(sources[source], size));
// ICO directory + lossless PNG payloads. The 16px frame uses the optical micro.
const sizes = [16, 32, 48];
const frames = sizes.map((size) => render(sources['favicon.svg'], size));
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach((frame, i) => {
  const at = 6 + i * 16;
  header[at] = header[at + 1] = sizes[i];
  header.writeUInt16LE(1, at + 4);
  header.writeUInt16LE(32, at + 6);
  header.writeUInt32LE(frame.length, at + 8);
  header.writeUInt32LE(offset, at + 12);
  offset += frame.length;
});
await writeFile(new URL('favicon.ico', dir), Buffer.concat([header, ...frames]));
console.log('Generated 5 SVGs, 4 PNGs and a 16/32/48px ICO from original ribbon geometry.');
