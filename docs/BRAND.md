# MCP Station — Ribbon S

## Design intent

An original, drawn Station initial: a broad S ribbon with curved bowls, a diagonal
waist and opposing chisel-cut terminals. An ink plane at the waist suggests the
underside of a folded strip. It is a typographic emblem, not a railway diagram,
network graph, AI sparkle, hexagon, enclosure or iteration of the old rail mark.
The symbol is deliberately asymmetric: the lower bowl has more visual weight,
anchoring the mark without a surrounding badge. No gradients or effects.

## Palette

| Colour | Hex | Role |
| --- | --- | --- |
| Forest | `#116859` | Ribbon face, theme, offline action accent |
| Ink | `#172c25` | Ribbon underside, wordmark, offline primary text |
| Pale | `#f7f8fa` | Icon field and offline background |

Pale is retained as the product's existing PWA background. Forest replaces the
old teal in index/manifest/offline theme metadata. Shared application styles are
outside this artwork change; offline-only colour overrides live in offline.html.

## Typography and usage

The symbol geometry is original vector artwork authored for this redesign.
The wordmark pairs it with the existing outlined Plus Jakarta Sans 700 lettering,
recoloured ink, retaining a readable product name rather than a novelty typeface.
Lettering is saved separately as `wordmark-lettering.svg`; the generated lockup
has no font lookup, embedded raster, external reference or script. The font's SIL
OFL and source information remain in `public/assets/fonts/`.

- Keep the symbol's 64 × 64 proportions; clear space: at least 8 master units.
- Use the full two-tone symbol at 24px and above on light surfaces.
- Use the optical favicon below 24px: a wider-counter, single-colour S drawn on a
  16-unit grid. The fold is intentionally omitted, not merely scaled away.
- The horizontal wordmark remains 260 × 48; recommended minimum width: 180px.
- Do not stretch, rotate, recolour individual planes, add outlines/shadows, or
  place the transparent forest/ink symbol directly on a dark surface.
- For dark browser chrome use the supplied pale-field favicon; for app launchers
  use the supplied pale-field icon. No unprovided dark logo variant is implied.

## Deliverables — existing public URLs preserved

All assets live under `public/assets/brand/`.

| File | Purpose |
| --- | --- |
| `station-mark.svg` | Transparent, two-tone Ribbon S; 64 × 64 viewBox |
| `station-wordmark.svg` | Outlined name + Ribbon S; 260 × 48 viewBox |
| `favicon.svg` | Optical single-colour S on a pale rounded field; 16 × 16 |
| `favicon.ico` | Three lossless PNG frames: 16, 32, 48px |
| `icon-192.png`, `icon-512.png` | General-purpose PWA icons |
| `maskable-512.png` | Opaque, full-bleed field; glyph inside 40%-radius safe circle |
| `apple-touch-icon.png` | Opaque 180px Apple icon; let the OS mask the corners |
| `icon-source.svg`, `maskable-source.svg` | Generated, inspectable raster masters |
| `wordmark-lettering.svg` | Portable font-outline input; not a launcher icon |

## Reproducible generation

`scripts/generate-brand.mjs` owns the ribbon/micro geometry, colours, SVG
composition, PNG rendering and ICO packaging. It reads the lettering source;
all other artwork outputs are regenerated. Do not hand-edit generated files.

The only build-time dependency is **@resvg/resvg-js 2.6.2**. Use a separately
installed copy; no runtime dependency, package or lockfile changes are needed.
This workspace already has the renderer:

```sh
BRAND_RESVG_MODULE=/workspace/scratch/station-brand-tools/node_modules/@resvg/resvg-js/index.js \
  node scripts/generate-brand.mjs
```

Elsewhere, point `BRAND_RESVG_MODULE` to an equivalent renderer installation's
`index.js`, or make that exact version resolvable to Node. Fonts are not loaded
from the host. The same renderer version produces byte-identical artwork.

## PWA integration and verification

The public asset URLs, manifest identity, launch scope and icon purposes do not
change. Only `CACHE_NAME` changes in the worker, to
`mcp-station-public-product-v2-ribbon`, so cached old artwork can retire through
the existing consent-based update lifecycle. No authentication, private cache,
application behaviour or deployment changes are part of this task.

Run `npm run test:pwa`: all 16 checks pass with the new forest theme and versioned ribbon cache.
The dark application rail and login apply a pale field behind the transparent mark so the ink fold
remains readable; SVG and launcher assets retain their specified colors.
