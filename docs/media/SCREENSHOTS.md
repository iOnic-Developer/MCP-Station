# Product screenshots and captions

The product assets are present under `docs/assets/product/`. They are real application captures
with sanitized, labeled sample data—not customer activity or live upstream-service validation.
They show the upcoming source workspace, not stable 2.4 or the exact `2.7.0_beta` image at `7945275`.

| Asset | Caption | Alt text |
| --- | --- | --- |
| `docs/assets/product/integrations.png` | Your integrations, with account setup and connection actions in one place. Source preview; sample data. | MCP Station Integrations workspace with service cards, account selection, configuration and connection actions using sanitized sample data. |
| `docs/assets/product/workspace.png` | Work with one service account while reusing the shared integration. Source preview; sample data. | MCP Station account workspace using sanitized sample configuration. |
| `docs/assets/product/assistant.png` | Build and edit integrations with the full-page Assistant. Source preview; sample data. | MCP Station full-page Assistant workspace using sanitized sample content. |
| `docs/assets/product/mobile.png` | Your station on a smaller screen. Source preview; sample data. | MCP Station account-aware interface at a narrow mobile viewport with sample data. |

## Original artwork

- `public/assets/brand/station-wordmark.svg`: “MCP Station — original forest-green Ribbon S wordmark.”
- `docs/assets/product/brand-banner.png` and `.svg`: original project brand artwork, not UI captures.
- `docs/assets/product/social-card.png` and `.svg`: original promotional artwork, not service evidence.

Suggested social-card description: “MCP Station — turn APIs and services into MCP tools. Self-host
integrations for compatible local and cloud AI clients.” Match any added text to the actual artwork;
the graphics owner controls image changes. No provider logo implies endorsement.

## Capture and publication checks

- Keep sample-data labels visible; do not replace them with invented adoption or activity claims.
- Exclude tokens, one-time secret reveals, personal identifiers, private URLs, and customer payloads.
- Check desktop/mobile crops, readable text, and alt text against the delivered assets.
- Raw branch links resolve publicly only after the parent pushes the assets.
- `docs/assets/screenshots/` remains a legacy stable-interface archive, not current-product evidence.
