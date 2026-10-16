# Product presentation handoff

## Status · 2026-10-16

Documentation is prepared in `/workspace/mcp-station-public-product` on `redesign/public-product`.
This pass changes only `README.md`, `docs/wiki/**`, `docs/DOCKERHUB.md`, `docs/media/**`, and this
handoff. No staging, commit, push, merge, deployment, or external publication is performed here.

## Product story

**Turn your APIs and services into MCP tools.**

**One integration. Multiple accounts. Your local and cloud AI clients.**

Lead with reusable integrations and a self-hosted workspace. Name ChatGPT, Claude, Claude Code,
and LibreChat as compatible MCP connection paths, subject to supported features, plans, and
admin policy—not endorsements or completed end-to-end validations. Local/cloud models use an
MCP-capable client such as LibreChat. Websites without usable APIs need an authorized adapter,
authentication, and site permission; do not promise universal browsing.

## Publication surfaces

| Surface | Prepared source | Parent action |
| --- | --- | --- |
| GitHub README | `README.md` | Approve/merge; main is unchanged by local source edits. |
| Wiki | `docs/wiki/` | Approve sync; sidebar links the new AI-client guide and retained Claude guide. |
| Docker Hub overview | `docs/DOCKERHUB.md` | Publish approved copy; record success rather than implying it happened here. |
| Product site | `docs/site/` | Site owner publishes after approval; no product domain selected or announced. |
| Screenshots and artwork | `docs/assets/product/` | Assets exist; parent owns graphics and final visual/public-link checks. |
| Community copy | `docs/media/ANNOUNCEMENTS.md` | Choose channel and publish when approved. |
| Release notes | `docs/media/RELEASE_NOTES_DRAFT.md` | Finalize only against the intended source/image. |
| Historical technical reference | `docs/REFERENCE_2_4.md` | Preserve as archive, not current product truth; may contain outdated claims. |

## Channel and bundle truth

- Stable: **2.4.0**, Docker `latest`, branch `main`.
- Published beta: **`2.7.0_beta`**, source **`7945275`**, internal version **`2.6.0-beta`**.
- Upcoming source: 18-module bundle, later workspace refinements, product site and new imagery.
  The eight-module expansion and newer site/layout are **not in that beta image**.
- Module audit: ten retained plus eight additions, **185 new tools**, **274 offline checks passed**.
  These are the audit's results, not a new live-service or client test run by this docs pass.
- Coverage: 18 of 30 supplied NAS service modules; private business, Unraid host-control/execution,
  and unreviewed agent modules remain deferred. No dependency or code change is owned here.
- New service credentials are empty; callbacks preflight configuration. Fresh-install discovery
  can be enabled before authentication. Additional accounts are separately blank/disabled.
- Gmail/Drive token caches are credential-keyed per the audit; alternative auth can confuse the
  simple configured badge, so use Test. Do not call this process isolation or live Google testing.

## Primary client references

`docs/wiki/Connecting-AI-Clients.md` includes the exact OpenAI developer-mode/apps help link,
Claude's official custom-remote-connector guide, Claude Code's HTTP transport docs, and LibreChat's
MCP server schema. Claude/CLI/LibreChat primary pages were fetched successfully; CLI transport and
LibreChat `streamable-http`, `headers`, `${ENV_VAR}` syntax were checked on 2026-10-16. OpenAI's
help article returned HTTP 403 to the workspace fetch; the supplied official reference is retained
without asserting plan eligibility or exact current menus. No live client session was exercised.

## Operations retained

One administrator; shared trusted source, not tenant isolation; scoped tokens with explicit broad
station exceptions; secret settings encryption, not no-egress. Modules call configured services;
Assistant content/context/source/output can go to the selected provider. Some privileged tools can
return secrets. Usage is bounded metadata (30 days/5,000 events), not payload auditing. Full backups,
default-only JSON, and source ZIPs have distinct purposes. No built-in job scheduler or marketplace.

## Parent publication checklist

- [ ] Review only the documentation diff alongside the other agents' source/assets.
- [ ] Check final screenshot crops and keep sample-data labels visible.
- [ ] Confirm public raw-image/source URLs after approved commit/push.
- [ ] Recheck stable/beta tag facts before publishing; do not imply a new image exists.
- [ ] Build/publish the intended image separately if the expanded bundle should be installable.
- [ ] Validate selected upstream services and AI-client flows with opt-in credentials.
- [ ] Approve merge/wiki sync, Docker Hub copy publication, and site hosting separately.
- [ ] Update this status only after each publication succeeds.

## Documentation verification

Workspace checks passed for **23 Markdown files**, **105 relative link/image targets**,
extensionless wiki links, balanced fences, final newlines, and all **18 module manifest slugs**.
Owned-file `git diff --check` passed. Docker Hub overview is below 10,000 characters.
The bundle's 274-check result is attributed to its audit; no application suite or live-service
validation is claimed by this documentation pass. CI is not triggered without commit/push.

## Publication handoff

Canonical product page: `https://ionic-developer.github.io/MCP-Station/site/`.
The Pages site is API-configured; publication success must be verified after the workflow.
Wiki publication updates matching pages without deleting unrelated existing pages. Docker Hub
copy is sourced from DOCKERHUB.md after the source/screenshots are committed. Main README still
requires the existing PR to be approved and merged; no merge is implicit in documentation work.
