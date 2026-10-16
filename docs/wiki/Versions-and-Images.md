# Versions and Images

## MCP Station 2.7.0 stable

The 2.7.0 release includes all **18 service modules** plus `_template`, service-account workspaces,
Connections, bounded Usage metadata, the full-page Assistant, and PWA installation where supported.

| Image | Purpose |
| --- | --- |
| `dbzocchi/mcp-station:2.7.0` | Pin the stable release. |
| `dbzocchi/mcp-station:2.7` | Follow stable 2.7 updates. |
| `dbzocchi/mcp-station:latest` | Follow the current stable release. |

Moving tags are not reproducibility guarantees. Record a verified digest for exact reproduction.
Release preparation does not prove registry publication: the parent release process verifies the
GitHub release, registry tags/digests and CI before announcing publication.

## Persisted modules and safe upgrades

A fresh empty `/app/mcps` gets all 18 service modules. Startup seeds missing bundled folders only;
existing folders, including edited sources, are never overwritten by image updates. Back up and
review source updates deliberately. Disabling an unwanted module persists intent; deleting its
bundled folder alone causes reseeding on restart. Additional accounts start blank and disabled.

1. Take a full backup; preserve externally supplied `SESSION_SECRET` and Files storage separately.
2. Record the current image digest and volumes.
3. Validate the new image, restored accounts, tools, scoped access and source in an isolated instance.
4. Recreate production only after validation. See [Quick Start](Quick-Start) and [Backups](Backups).

## Historical tags and rollback

2.4.0 is the previous stable release, not the current installation recommendation. Older tags,
including `2.7.0_beta` (built from `7945275`, internal label `2.6.0-beta`), are retained for historical
reproduction and rollback. They do not contain the complete 2.7.0 release bundle. Do not assume an
older image can read newer state: restore its matching validated full backup in separate volumes.
`docs/REFERENCE_2_4.md` is a historical archive, not the current deployment contract.

## Source and documentation

Use the approved release tag/commit for reproducible source builds, or `main` for current source:

```sh
git clone --branch main https://github.com/iOnic-Developer/MCP-Station.git
cd MCP-Station
docker build -t mcp-station:local .
```

Publishing documentation does not publish an image or deploy the application.
[Source](https://github.com/iOnic-Developer/MCP-Station/tree/main) ·
[Docker Hub](https://hub.docker.com/r/dbzocchi/mcp-station)
