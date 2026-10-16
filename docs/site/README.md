# MCP Station product page

Static HTML, separate CSS/JS, local brand artwork and licensed Plus Jakarta Sans.
No build step, runtime dependencies, analytics, remote fonts, CDN assets, or service worker.
JavaScript only enhances the Docker command with an optional clipboard button.

## Preview and path contract

Serve the repository root and open `/docs/site/`, or serve `docs/` and open `/site/`.
Project-prefixed hosting also works: the page has no origin-root asset paths.
The local mark, wordmark, font, license and stylesheet/script live inside this directory.

The one screenshot is deliberately parent-owned:
`../assets/product/integrations.png` resolves to `docs/assets/product/integrations.png`.
It must be a real final-branch screenshot with sanitized sample data, not a fabricated mockup.
The supplied PNG is 1440 × 1000; HTML reserves that exact intrinsic ratio to avoid layout shift. The fixture shows 12 sanitized samples, not the complete 18-module inventory.

To publish the directory at an arbitrary root, preserve the sibling `assets/product/`
media directory (or deliberately relocate that media and update the three image metadata/src paths).
The page is self-contained for its identity/fonts, not a single-folder screenshot bundle.
No symlinks, duplicate parent screenshots, or reference to `../../public/` are used.

## Publication is a separate decision

This work does not configure GitHub Pages, publish a domain, sync the Wiki, build an image,
or imply that branch-only changes are in the published beta.
Docs links point to the exact Markdown source on `redesign/public-product`.
The source link points to that branch. The beta action points to Docker Hub's `2.7.0_beta` tag.

Open Graph/Twitter image paths are relative because no public site origin was supplied.
Before public sharing, replace both image metadata values with the actual absolute HTTPS URL
of `assets/product/social-card.png` at the chosen hosting location. Add `og:url` and a canonical
only after that location is approved. Some social crawlers will not resolve relative image URLs.
Do not manufacture a published canonical or domain.

## Checks

`node scripts/test-product-page.mjs` runs the dependency-free contract checks.
For browser checks, also set `PRODUCT_BROWSER_MODULE` to an installed Playwright module path
and `PRODUCT_AXE_MODULE` to an installed `@axe-core/playwright` module path.
Set `REQUIRE_PRODUCT_SCREENSHOT=1` at publication time to fail if the parent screenshot is absent.
Set `PRODUCT_TEST_OUTPUT` to an existing scratch directory to save browser screenshots.
Browser checks cover repository-root, docs-root and project-prefixed routes, 375px mobile,
landscape/tablet/desktop, keyboard navigation, reduced motion, clipboard success/failure,
no-JS navigation, local font/image loading, request locality and axe WCAG 2.2 AA checks.

## Original social artwork

`generate-media.mjs` creates the 1200 × 630 social card and 1600 × 560 brand banner.
Supply existing build-time `@resvg/resvg-js` through `BRAND_RESVG_MODULE`, and a licensed
Plus Jakarta Sans TTF through `PRODUCT_FONT_FILE`. No project dependency is added.
SVG lettering is converted to outlines; PNG rendering loads the supplied local font only.
The source brand mark and wordmark are copied unchanged from `public/assets/brand/`.
Font attribution and the complete SIL OFL are kept in `assets/` alongside the WOFF2.

## Positioning and compatibility boundaries

The page leads with “Turn your APIs and services into MCP tools.” and “One integration.
Multiple accounts. Your local and cloud AI clients.” The 18-module inventory is source-branch
scope per `docs/MODULE_BUNDLE_AUDIT.md`, not a claim about the published 2.7 image or live
service verification. Account credentials and permissions are still needed. Custom service
automation needs a usable API or adapter; arbitrary websites are not automatically tools.
Local models need an MCP-capable client. Client names are plain text, not third-party logos,
testimonials, endorsements, certification or evidence of end-to-end tests.

Primary client documentation (recheck current availability and setup before launch):
- ChatGPT: https://help.openai.com/en/articles/12584461-developer-mode-and-full-mcp-connectors-in-chatgpt
  Verify the current plan, workspace permissions, developer-mode/custom MCP setup,
  supported transport and available actions. No universal availability is promised.
- Claude: https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
- LibreChat: https://www.librechat.ai/docs/configuration/librechat_yaml/object_structure/mcp_servers

These describe client capabilities, not certification of MCP Station. The site remains an
unpublished static page, with no invented canonical/domain, hosted service or testimonials.

## Publication configuration

The owner-requested product page is configured for GitHub Pages at
`https://ionic-developer.github.io/MCP-Station/site/` (API-confirmed repository URL).
The optional `product-site.yml` workflow deploys only static website files and PNG media,
never the application server, modules or private state. Canonical/social metadata use that
location. The root redirects to `site/`. A successful Actions deployment and HTTP check,
not source preparation alone, are required before reporting it live.
