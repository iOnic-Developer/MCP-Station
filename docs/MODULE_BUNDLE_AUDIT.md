# Public module bundle audit

Date: 2026-10-16. Scope: source-only expansion on `redesign/public-product`.

## Inventory and decision

The supplied snapshot contains **31 directories: 30 service modules plus `_template`**.
The public bundle now contains **18 service modules (60% of the snapshot)** plus
its unchanged template: **10 retained, 8 added, 12 deferred**.

### Added: eight general-purpose modules, 185 registered tools

| Folder | Tools | Configuration needed | Runtime dependency |
| --- | ---: | --- | --- |
| `todoist` | 10 | API key | Node built-ins/native fetch |
| `github` | 47 | PAT; optional default owner | Node built-ins/native fetch |
| `dockerhub` | 30 | Username and PAT | Injected HTTP helper |
| `pushover` | 7 | Application token and user/group key | Injected HTTP helper |
| `protonpass` | 21 | Explicit PAT; optional vault | `pass-cli`, already installed by the existing Dockerfile |
| `gmail` | 25 | Access token **or** OAuth client ID, client secret and refresh token | Native HTTP; no `googleapis` package |
| `gdrive` | 15 | Access token **or** OAuth client ID, client secret and at least one enabled account refresh token | Native HTTP; no `googleapis` package |
| `cloudflare` | 30 | API token and account ID; optional zone | Node built-ins/native fetch |

Every new module has only `index.js`, `manifest.json`, a self-contained `bundle.js`
boundary, and newly written generic `about.md`. No snapshot instructions, agent
skills, package manifests, nested dependencies, credentials or runtime files were copied.
The duplicated small boundary keeps each module independently exportable; it does
not require sibling modules or a host change.

### Retained: ten, unchanged

`files`, `gemini`, `n8n`, `openproject`, `radarr`, `siyuan`, `sonarr`, `station`,
`telegram`, `xero`. Their existing files were SHA-256 compared against the local
pre-expansion baseline. `_template` was also left unchanged. No retained module's
credentials or live service behavior were tested.

### Deferred: twelve

| Modules | Reason / next gate |
| --- | --- |
| `booker`, `lottery`, `payroll`, `planday`, `pos_companion`, `stockmanager` | Private/business-specific integrations, not public defaults. Require an explicit separate product/provenance/privacy review before inclusion. |
| `unraid`, `unraid2` | REST adapters assume deployment-specific endpoints and fallback behavior. Earlier source also contains private settings defaults. Neither was copied. A future read-only adapter needs a supported API contract and mocked compatibility tests; the broad command/power operations are not a safe shortcut. |
| `unraid_ssh`, `unraid_usb` | Depend on `ssh2`, which is absent from the root dependency manifest and is not installed by the Dockerfile. Also expose host execution, private keys and/or USB administration. No dependency was installed or silently added. A separate opt-in dependency/threat-model decision is needed. |
| `code_review_mcp`, `design_mcp` | Private CommonJS-marked agent orchestration packages, not reviewed public ESM module contracts. Defer adapter, instruction sanitization and provenance/license review rather than ship broken or private agent systems. |

## Defaults and behavior

- On a fresh install, the existing loader enables successfully imported modules.
  This expansion does not change that policy or modify existing installation settings.
  The entrypoint seeds missing folders only; existing user modules are not overwritten.
- Enabled means **available for discovery**, not connected to an upstream account.
  Every newly bundled callback checks configuration before invoking its implementation.
  Whitespace-only and partial OAuth configuration fail with actionable Settings guidance.
- All secret defaults are empty. Owner, username, email, account-label, vault, device
  and zone defaults are empty. Only the CLI executable name and enabled/disabled
  account-slot switches retain nonempty defaults. An enabled Drive slot without a
  refresh token is not an authenticated account.
- Gmail and Drive declare alternative authentication configurations. The host now requires
  a complete declared alternative for the readiness badge; disabled Drive slots do not count.
  See MODULE_CONFIGURATION.md and the 85 offline configuration checks. Callbacks separately
  gate missing credentials before I/O. Readiness still does not prove an upstream token works.
- Secrets enter through Settings and use the existing encrypted host storage path.
  No `.config.json`, state, keys, cookies, sessions, tokens or private defaults were imported.
- Gmail's token cache is keyed against the complete OAuth credential tuple. Drive's
  credential-hashed cache keys include client ID, secret and refresh token, with a
  bounded cache. Separate instances cannot reuse a different account's cached token.
- Array, primitive and null `structuredContent` values are normalized to records before
  SDK delivery. Explicit error text is marked `isError`; configured secret values are
  scrubbed from error results. Connectivity tests return generic diagnostics, not raw
  provider bodies or account/session details. This is not general-purpose data-loss prevention.
- Todoist and other remote operations retain their original API implementations. Offline
  compatibility does not establish current live API support, permissions or pagination
  correctness for every operation.

## Deliberate restrictions

### GitHub

The snapshot's `github_clone_repository` and `github_pull_repository` tools are not
bundled. Their implementations, archive extraction, filesystem imports and child-process
imports were removed. This avoids arbitrary local writes, repository hook/config execution
and persistence of PAT-bearing Git remotes. Clone-info output contains credential-free
URLs and commands; authenticate separately with a credential helper.

The remaining API tools include mutations, publishing, deletion and secret management;
use a narrowly scoped PAT. The snapshot's pure-JavaScript sealed-box helper is retained,
not newly vendored; this task does not constitute an independent cryptographic audit.

### Proton Pass

An explicit Settings PAT is required even for local/password tools. Blank settings cannot
use an ambient authenticated session. The child environment is an explicit PATH/LANG/PAT
allowlist rather than the station's environment. Executables are limited to `pass-cli`
or `/usr/local/bin/pass-cli`; calls use `execFile` argument arrays, never a shell. User
arguments containing NUL/newlines or beginning with a CLI option are rejected. This may
reject unusual literal titles/password values; it is intentional conservative behavior.
Password fallback generation uses `crypto.randomInt` rather than modulo reduction.
Raw CLI errors and connection-test session output are not returned.

The Dockerfile already supplies the CLI. It was not installed or invoked during this work.
Configured CLI compatibility, filesystem access and external authentication remain untested.

## Trust and privilege boundary

**Module code runs inside the trusted station process, not in a sandbox.** Transport
bearer/OAuth scoping is not a filesystem or subprocess isolation boundary. Keeping
runtime configuration out of distributable code is not equivalent to a complete security review.

Highest-privilege capabilities include the retained `station` module (code/settings
management), retained `files` module (filesystem and public links), and new `protonpass`
module (passwords, TOTP, private keys and CLI filesystem access). GitHub, Docker Hub,
Gmail, Drive and Cloudflare also expose account mutations; Pushover sends real alerts.
Tool annotations are hints, not confirmation enforcement. Confirm destructive actions at
the client and restrict upstream credentials. New token/password creation and vault reads
can intentionally return secrets: never paste those results into public logs or artifacts.

## Source and license checks

Input was the explicitly supplied, user-owned source snapshot, not an external package
installation. No separate third-party copyright/license notices or vendored dependency
files were identified in the eight selected modules. Existing repository licensing is
unchanged; no independent license grants or blanket provenance guarantee are inferred.
The deferred private agent packages require separate provenance review before redistribution.

Only selected source files were read for copying; configuration/credential/session files
were excluded. Source scanning checked private addresses, personal identifiers/domains,
email examples, common token prefixes, long credential-like literals, imports, subprocess
usage, and literal HTTP hostnames. Personal examples and account labels were replaced;
official service endpoints and generic public examples remain. A character alphabet was
the one long-literal false positive and was split into readable segments. Findings were
reported by file/line/category only, never by sensitive value. `gitleaks` is unavailable;
this is a scoped heuristic scan, not a certificate that no secret can exist.

No files were staged by this task. The scan applies to the complete proposed source set,
not unrelated tracked/untracked work in the shared checkout.

## Verification

Run from the repository root:

```sh
node scripts/test-bundled.mjs
```

The regression script uses only built-ins and the station's existing SDK/Zod dependencies.
It creates throwaway module copies and state, strips ambient secret environment variables,
blocks service HTTP and CLI subprocess execution, and uses fixture strings only. It checks:

1. Exact 18-module inventory and successful host load; all original modules still describe.
2. Exact expected tool names for every new module, using real SDK in-memory `tools/list`.
3. Every one of the 185 new tool callbacks fails actionably when unconfigured, without I/O.
4. Real SDK `tools/call` blank-setting failures, plus a mocked Todoist array success result.
5. Credential-isolated Google caches using distinct fake account/refresh-token tuples.
6. CLI executable and option-input rejection before any subprocess is launched.
7. Blank defaults, source artifact/import allowlists, and credential/address/email patterns.
8. Actual host encryption/decryption and encrypted config mirroring with fake credentials.
9. Provider error redaction and account-independent connectivity-test diagnostics.
10. A local HTTP station fixture: exact tools/list, per-module tokens accepted only on their
    own module, and invalid tokens rejected for all eight new modules.

Result: **18 modules, 185 new tools, 274 counted checks passed**. Syntax checks also passed.
No live service calls, real credentials, CLI invocation, dependency installation, image build,
push, commit or deployment were performed. The parent task owns integration/CI, publication,
live opt-in validation, and the optional-auth UI badge follow-up.
