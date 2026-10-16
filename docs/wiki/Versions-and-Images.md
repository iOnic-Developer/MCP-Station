# Versions and Images

**Publication snapshot: 2026-10-16.** These labels distinguish image tags, source, and the app's
internal version. A Docker tag is not a GitHub release announcement.

| Channel | Tag/source | Status |
| --- | --- | --- |
| Stable | `dbzocchi/mcp-station:2.4.0`; moving `:latest`; `main` | Stable 2.4 interface. |
| Published beta | `dbzocchi/mcp-station:2.7.0_beta` | Built from `7945275`, internal version `2.6.0-beta`. |
| Branch preview | `redesign/public-product` | Upcoming 18-module bundle, newer workspace, site source and product documentation; not in the published beta image. |

The beta adds account-aware workspaces and Connections, real bounded tool-usage metadata,
full-page Assistant work, and installable PWA support. Installation depends on browser/device and
HTTPS; it is not offline access to private station content. Later navigation, card, and action-layout
changes are branch-preview work until a subsequent image is explicitly built and verified.

`latest` is moving, not a reproducibility guarantee. Version-looking tags can also be republished;
use a verified image digest when exact reproducibility matters. The app's `2.6.0-beta` display does
not mean the Docker `2.7.0_beta` tag is wrong: those version labels have not been aligned in code.

## Safe evaluation

1. Take a full backup and preserve any externally set `SESSION_SECRET`.
2. Use a separate deployment with separate `/data`, `/app/mcps`, and Files storage for beta.
3. Record the selected image/digest and test accounts, tools, access, and restoration.
4. Do not assume an older image can consume beta state safely; restore a matching validated backup.

Existing default account settings/endpoints are preserved by the beta model. Additional accounts
are blank/disabled and reuse shared source. Bundled folders absent from the module volume are
seeded on start; existing source folders are not replaced by a new image.

## Build the review source

```sh
git clone --branch redesign/public-product https://github.com/iOnic-Developer/MCP-Station.git
cd MCP-Station
docker build -t mcp-station:local-preview .
```

Build from the approved, published source commit to reproduce the upcoming preview. The checked-in Compose file can lag image labels; choose your image
explicitly using the [Quick Start](Quick-Start) rather than assuming its label proves publication.

## Historical material

`docs/REFERENCE_2_4.md` preserves the old technical reference for historical context. It may contain
outdated capability, model, or operational claims; it is not the current product or deployment
contract. Prefer this wiki and the current module source.

## Public documentation

The public `main` README remains stable until an approved merge. Wiki source in this branch is a
review draft; the published GitHub Wiki may still have older stable pages until an approved sync.
No merge, image push, wiki sync, hosted-site launch, or Docker Hub page update is implied here.

[Review branch](https://github.com/iOnic-Developer/MCP-Station/tree/redesign/public-product) ·
[Docker Hub](https://hub.docker.com/r/dbzocchi/mcp-station) · [Backups](Backups)
