# Backend account instances and usage

## Model and compatibility

One installed folder is one **source module** (`manifest.json`, `index.js`, instructions and docs).
It can serve several independently configured **account instances**, without folder copies.
Example: one Gmail source, its default account, plus Personal and Work accounts on separate URLs.

- The existing module id, manifest slug, endpoint, encrypted settings, static bearer, enabled flag,
  last test and OAuth grants remain the **default account**. There is no destructive migration.
- New accounts are registry entries in `DATA_DIR/station.json` under `mcps[instanceId]`:
  `{id, sourceId, slug, name, enabled, settings, token, tokenExpiresAt, createdAt, updatedAt?}`.
  `id` equals the new endpoint slug and is stable for the lifetime of that account.
- An instance uses the source's register/test functions and schema. Resolution creates a fresh
  virtual manifest with the instance id and slug, never changes a shared manifest or global alias.
- Each MCP request captures its own settings snapshot. `getSettings()` returns a fresh object each
  time, so callbacks cannot mutate another account's host settings, even across concurrent calls.
- New accounts are **disabled and blank**, without tokens, credentials, test results or OAuth
  connections copied from the default. Manifest setting defaults are not inherited by new accounts;
  explicitly configure their fields. Default-account manifest defaults continue to work unchanged.
- Source edits and reloads apply to all its accounts. Account settings never overwrite the source's
  `.config.json` mirror. Only the original default account is mirrored/adopted from that file.

## Frontend API contract

All `/api/*` routes below require the existing admin session cookie. Mutations also require
`x-station-csrf: 1`. Validation failures use `{error: "message"}` with HTTP 400 unless noted.
There are no new frontend files in this implementation.

### Listing and selection

`GET /api/mcps` remains `{mcps: [module, ...]}` with **one card per source**, not one per account.
Existing module properties remain at the top level; the module additionally has `sourceId` and
`instances`. Each account entry has:

```json
{
  "id": "gmail--work",
  "sourceId": "gmail",
  "name": "Work",
  "url": "https://station.example/gmail--work/mcp",
  "enabled": false,
  "configured": false,
  "error": null,
  "lastTest": null,
  "settings": {"api_key": ""},
  "tokenSet": false,
  "tokenExpiresAt": null,
  "clients": 0
}
```

The **first** entry is always the default account: `id === module.id`,
`sourceId === module.id`, `name === 'Default account'`, using the original endpoint/settings.
Secret settings return `••••••` when set, never plaintext. `tokenExpiresAt` is epoch milliseconds,
null for no expiry/no token; `tokenSet` distinguishes those states. `clients` follows the existing
connection-count contract (including station-wide grants that can access that endpoint).
`lastTest` is null or `{ok, message, at}` as before; `error` is a source-load error or null.

Frontend selection: keep the source card, resolve the chosen account from `module.instances`,
and use **that entry's id** for settings/test/access and **that entry's url** for connecting clients.
Use `sourceId` for shared-code/editor operations. The backend does not persist a UI selection.

### Creating an account

`POST /api/mcps/:moduleId/instances` with `{name, slug?}` returns HTTP 201:
`{ok: true, instance: <entry above>}`.

- `moduleId` must identify an installed source, not another instance.
- Name: nonempty trimmed string, up to 100 characters.
- Optional slug: 1–128 lowercase letters, digits, `_` or `-`, beginning with a letter/digit.
- Without a slug, generate `<source-slug>--<normalized-name>`, adding `-2`, `-3`, etc. on collision.
- Existing source ids/slugs, stored instance ids/slugs, folders and station-reserved routes are
  unavailable. Reserved routes include `/api`, `/assets`, `/f`, login/auth and OAuth routes.
- No account renaming or endpoint migration API is added in this change.

### Operating on an account

Existing routes accept `:instanceId` (including the default module id) without contract changes:

| Route | Contract |
| --- | --- |
| `PATCH /api/mcps/:instanceId` | `{enabled?: boolean, settings?: object}` → `{ok:true}`; saved settings clear lastTest |
| `POST /api/mcps/:instanceId/test` | `{ok, message}`; stores this account's lastTest |
| `POST /api/mcps/:instanceId/token` | `{expiry?}` → `{ok:true, token, expiresAt}`; plaintext returned once |
| `DELETE /api/mcps/:instanceId/token` | Clears only this account's static bearer |
| `GET /api/mcps/:instanceId/connections` | `{connections:[...]}` with existing handles/client names/expiry fields |
| `DELETE /api/connections/:handle` | Existing connection revocation contract |
| `GET /api/mcps/:instanceId/capabilities` | Source tools inspected in this account context |
| `GET /api/mcps/:instanceId/skill` | Skill points at the selected account's URL |

Source files, source ZIP export, editor and module chat are **source-only** operations. Passing a
nondefault instance id returns 400 with a message directing callers to its `sourceId`. This applies
to direct host calls as well as HTTP routes, including the station self-management tools.
Dot-files are station-managed and cannot be read/written through the editor. File paths cannot
escape through parent paths or symlinks; file listings/ZIP exports skip symlinks.

`DELETE /api/mcps/:instanceId` does **not** delete an instance or its shared source (400).
Deleting a source with additional accounts is refused until those accounts are explicitly removed.

### Removing an account

`DELETE /api/mcps/:moduleId/instances/:instanceId` returns `{ok:true}`.
Wrong parent, unknown instance or attempting to remove the default account returns 404.

This removes only that account's registry/settings/static bearer and revokes its OAuth access,
refresh tokens, unredeemed codes and unfinished consent requests. Other accounts, source files
and shared OAuth client registrations remain. Removal/revocation are persisted before success.
Reusing a deleted endpoint cannot resurrect its old credentials. Historical metadata remains
until retention expires; it contains no credentials or payloads.

## Authorization boundaries (not multi-user hosting)

- Per-account static tokens work only at their endpoint; cross-account use returns 403.
  The legacy cross-source static-token rejection remains 401 when neither side is a new instance.
- OAuth discovery and RFC 8707 resource resolution recognize instance endpoints. New scoped
  grants and rotating refreshes stay bound to that instance slug; cross-account access returns 403.
- Explicit unknown/removed OAuth resources cannot mint a station-wide token. Account removal
  revokes its pending and active scoped grants, including refresh tokens.
- Existing master `MCP_TOKEN` and legacy resource-less station-wide OAuth grants retain their
  intentional all-endpoint privileges. A new blank account has no *own* grants, but a station-wide
  grant is still shown in its connections list and can access it once enabled.
- This is **not human multi-user authentication or tenant sandboxing**. The single station admin
  can configure every account. The privileged `station` module can manage shared source/settings.
  Module JS is trusted in-process code: malicious modules or modules caching credentials in
  module-global variables are not isolated by a VM/process. Modules must obtain request settings
  through the injected closure, not cache per-account credentials globally.
- A future shared-human deployment needs user identities, ownership/membership, account-level
  permissions on every admin and MCP operation, consent bound to a user/account, scoped service
  credentials, protected source-edit/assistant powers, auditing and potentially process isolation.
  Those permissions are **not implemented** here.

## Backup and portability

Full `.tar.gz` station backups include registry instance records, the station encryption key, OAuth
state, shared source and `usage.json`; the HTTP backup route flushes pending state/usage first.
Restore reloads the account resolver and usage metadata. Keep the full backup private: it contains
credentials and the key needed to decrypt them.

The existing portable `/api/export` and `/api/import` format remains **source/default-account only**.
It does not export/import additional account records or usage. A shareable module ZIP contains only
source, never instance configuration; restoring just a source's `.config.json` restores its default
account, not the additional accounts. Use a full station backup for those accounts.

## Usage analytics contract

`GET /api/usage?days=7&instanceId=gmail--work` is authenticated via the same admin session.
`days` defaults to 7 and must be an integer 1–30 (400 otherwise). `instanceId` is optional and
filters to exactly that account, not its siblings. A valid unknown/deleted id can return empty
results or retained history. No synthetic activity is generated.

```json
{
  "since": "2026-10-09T03:00:00.000Z",
  "days": 7,
  "totals": {"calls": 0, "errors": 0, "successRate": null, "averageLatencyMs": null},
  "daily": [],
  "integrations": [],
  "recent": []
}
```

- `since` is a rolling UTC timestamp, `days * 24h` before the query; daily buckets use UTC dates.
- Totals: `calls`, `errors`, `successRate` (fraction **0–1**, not percentage), `averageLatencyMs`.
  Empty history returns zero counts and **null** rate/latency, not made-up 100% success or 0 latency.
- `daily`: ascending `{date: 'YYYY-MM-DD', calls, errors}` for dates with observed calls only.
- `integrations`: per-account `{id, name, calls, errors, averageLatencyMs}`, highest call count first.
  Names are resolved from current module/account metadata; removed accounts fall back to id.
- `recent`: newest 100 retained events at most; each contains **only**:
  `{time, instanceId, moduleId, tool, durationMs, ok}`. `moduleId` is the shared source id.
- Instrumentation observes JSON-RPC responses on the MCP transport, then records at HTTP response
  `finish`, for authenticated, enabled `tools/call` requests with an id only. Tool `isError: true`,
  thrown tool errors and JSON-RPC/schema failures count as errors even when HTTP status is 200.
  Non-tool traffic, denied authentication, disabled endpoints and unfinished/aborted responses do
  not generate usage events. Initialization, tool listing and admin connectivity tests are excluded.
- No arguments, results, error messages, request/response bodies, client identifiers or credentials
  are saved. Invalid tool identifiers use `(invalid)` rather than arbitrary request text.
- Separate `DATA_DIR/usage.json`, strict field projection, at most **30 days / 5000 events** globally,
  with at most 100 recent events in a response. Pruning runs on load, reads, writes and the periodic
  10-minute maintenance pass. Persistence is debounced 150ms and flushed on graceful shutdown and
  backup; an abrupt process kill can lose that small trailing batch. This is bounded operational
  metadata, not a complete billing ledger, and old events may be evicted earlier by the count cap.

## Verification

Run inside the development workspace:

```sh
node scripts/test-instances.mjs
node scripts/test-usage.mjs
ASSISTANT_PROVIDER=anthropic bash scripts/smoke.sh
bash scripts/smoke-oauth.sh
bash scripts/smoke-scoping.sh
bash scripts/smoke-selfcontained.sh
```

The new instance harness uses temporary source/state and an ephemeral local HTTP port, creates two
accounts from one dummy module, issues 24 interleaved real MCP tool calls, and verifies snapshots,
tokens, OAuth, restart/migration, shared-source guards and deletion. Usage tests exercise HTTP
completion/failures, privacy, auth, aggregation, retention and persistence, without external APIs.
