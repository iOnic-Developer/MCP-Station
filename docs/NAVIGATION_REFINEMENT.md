# Navigation and service identity refinement

Implemented on `redesign/public-product`, starting at `7945275`. No commit, push,
deployment, dependency, PWA implementation, or service-worker/cache changes.

## Shared rail reservation

The fixed `.sidebar` and `.workspace` share `--sidebar-width` (216px expanded,
72px collapsed). `renderShell()` adds `body.station-authenticated`; its body-sibling
`.station-pwa` reserves that same width using `margin-inline-start`, plus the normal
16px/safe-area gutter. This is deliberately a shared layout reservation, not a
z-index workaround or a hidden install control. The selector also beats the
Assistant's existing margin shorthand, while preserving its flexible viewport
height and scrollable installation panel.

Unauthenticated and boot-error screens remove `station-authenticated`,
`sidebar-collapsed`, and `assistant-workspace`. At widths <=720px the shared width
is zero, the desktop rail/toggle are hidden, and the normal labelled mobile drawer
and bottom navigation remain unchanged. Mobile never applies desktop collapse
styling, even when the saved desktop preference is collapsed.

## Collapse interaction and parent QA selectors

- Toggle: `[data-sidebar-toggle]`, minimum 44px in both dimensions.
- Rail: `#station-sidebar.sidebar`; toggle has `aria-controls="station-sidebar"`.
- `aria-expanded="true"` = expanded; `false` = icons-only.
- Accessible toggle labels: `Collapse navigation` / `Expand navigation`.
- Remembered preference: localStorage `station.sidebar.collapsed`, `1` / `0`.
  Storage failures are optional and do not prevent navigation.
- State: `body.station-authenticated.sidebar-collapsed`.
- Links: `.sidebar [data-route]`, with explicit accessible names and normal
  `aria-current="page"` route state. Sign out remains `[data-logout]`.
- `.nav-label` is visually hidden only within the collapsed desktop rail.
- `.nav-tooltip` is actual visible text on hover and keyboard `:focus-visible`,
  positioned outside the scrollable rail. Escape dismisses it; new focus/hover
  restores it. Sidebar scrolling dismisses a stale-position tooltip.
- Installation controls remain `.station-pwa [data-install]` and `[data-dismiss]`.

## Compact service identities

`serviceIdentity(id, name)` in `icons.js` provides a local category icon, semantic
category label, source monogram and stable source-ID hash into four restrained
identity tones: forest, ocean, plum and slate. These are not official logos.
Unknown sources explicitly say `Custom integration`. Status is not an identity
input, so enabling, testing and switching accounts cannot recolour a source.

Parent QA selectors:

- `.integration-card[data-id][data-service-tone]`: persistent 3px identity rail.
- `.integration-head`: consistent header divider.
- `.service-icon`, `.service-monogram`: local decorative category symbol + initials.
- `.service-heading h2`: stronger service-name grouping.
- `.service-category`: visible semantic label; narrow labels ellipsize with full
  text retained in the DOM and title. Identity never depends on colour alone.
- `--identity-{forest,ocean,plum,slate}-{ink,bg}`: light/dark semantic tokens.
- `.integration-primary`: three equal-width, equal-height controls, minimum 44px;
  endpoint and Copy endpoint stay upfront, with no details/disclosure step.
- `.integration-card > .endpoint`, `.card-footer`: consistent section dividers.

The header absorbs the previously separate name row. Cards remain compact,
uniform-height grids; no large new padding, banner or dependency was added.

## Verification

All commands executed only via `unraid_docker_exec_mcp_unraid_ssh` in
`LibreChat-Workspace`, working directory `/workspace/mcp-station-public-product`.

- `npm run test:ui`: 21 frontend modules, exit 0.
- `npm run test:pwa`: 16/16 tests, exit 0; PWA/cache files untouched.
- `npm run test:workflows`: 81/81 checks, 23 axe audits, exit 0.
- Isolated scratch navigation browser check: 46 assertions, exit 0, including
  expanded/collapsed geometry and dismissal hit-testing across all six routes
  plus account settings, refresh preference, real keyboard tooltip visibility
  and unclipped hit-testing, Escape dismissal, 44px toggle, mobile widths 375/720,
  full mobile drawer labels, actual Assistant Not now dismissal, login reservation
  removal, and collapsed light/dark serious/critical axe checks.

Browser dependencies were supplied without installation:

```sh
PLAYWRIGHT_MODULE=/workspace/scratch/station-ci-browser/node_modules/playwright/index.js
AXE_MODULE=/workspace/scratch/station-ci-browser/node_modules/@axe-core/playwright/dist/index.js
# QA_BROWSER_EXECUTABLE resolved through:
node --input-type=module -e "import { chromium } from '/workspace/omniforge/node_modules/playwright/index.mjs'; console.log(chromium.executablePath())"
```

Workflow evidence: `/workspace/scratch/station-navigation-qa/report.json`.
Scratch navigation check: `/workspace/scratch/station-navigation-check.mjs`.
Scratch fixture uses temporary state/modules, synthetic credentials and loopback
HTTP; browser/server cleanup runs in `finally`. No live service was contacted.
The parent agent owns permanent regression additions; no test files were edited.
