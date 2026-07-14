# Plan — adapt the SiYuan Companion MCP into MCP Station

**Status (2026-07-14, v1.2.0):** Phases 1, 2, 4 and 5 are **done and tested** — the module is live at `/siyuan`
with 19 tools, 2 prompts and its house style, and modules are now self-contained (`scripts/smoke-selfcontained.sh`,
10/10). **Phase 3 (per-MCP auth scoping) is NOT started** — it is optional, riskier, and nothing in the port needs it.
Source tallies at 19 tools (the `tools.mjs` header comment saying "15" is stale).
Written 2026-07-14 against station v1.1.0.
**Goal:** SiYuan Companion's 19 tools, 2 prompts and house-style `instructions` run as a *station module*, fully configurable in the admin UI, and **self-contained**: delete `mcps/siyuan/`, put the folder back, and the station picks it up with its config intact and carries on.

---

## 0. What this plan is reacting to

The source has **not been received yet** — only the `/mcp` design doc. Everything below is written against that doc plus the station code as it stands. Task 1.1 is "get the real files"; a few estimates (tool count, schema shapes) may shift when they land.

### 0.1 Findings from reading the station (verified, not assumed)

| # | Finding | Where | Consequence |
|---|---|---|---|
| F1 | `buildServerFor` builds `new McpServer({name, version})` with **no options object** | `server/lib/mcpHost.js:128` | Modules **cannot** set MCP `instructions`. The house style is the whole point of the SiYuan server → **host change needed**. |
| F2 | `McpServer.registerPrompt(name, config, cb)` exists in the installed SDK | `node_modules/@modelcontextprotocol/sdk/…/server/mcp.js:727` | The 2 prompts work today with **no host change** — just undocumented in our module contract. |
| F3 | `loadModules` creates `st.mcps[id]` only when absent, and **never prunes** entries for missing folders | `server/lib/mcpHost.js:77-80` | Manual folder delete → restore **already** keeps settings. Good. |
| F4 | The UI Delete button (`deleteModule`) **does** `delete st.mcps[id]` | `server/lib/mcpHost.js:207` | Delete-in-UI then restore-from-trash **loses all settings**. This is the hole in "self-contained". |
| F5 | Settings are encrypted with the station key (`SESSION_SECRET` or `/data/secret.key`) | `server/lib/crypto.js` | Any module-local config file can hold secrets only in station-encrypted form. Portable *within* a station, not *between* stations unless `SESSION_SECRET` matches. Must be documented, not hidden. |
| F6 | OAuth tokens persist a `resource` (the `/slug` they were minted for) … | `server/lib/oauth.js:187-192` | … but `requireBearer` (line 219) **never checks it**. Any token reaches every enabled MCP. This is the hook for per-MCP auth. |
| F7 | Module tools must use a **plain object of zod fields** as `inputSchema`, never `z.object()` | `CLAUDE.md` invariant 1 | The SiYuan tools ship Anthropic-style JSON Schema `input_schema` → 19 hand conversions. |
| F8 | Modules take **no npm deps**; they get `fetchJson` injected | `CLAUDE.md` invariant 2 | The `siyuan()` wrapper (browser UA, 3× transport retry, transient-kernel retry) must be written inside the module using injected `fetchJson` / global `fetch`. Both are dependency-free. |
| F9 | Station already runs the OAuth AS + static `MCP_TOKEN` dual lane for every module | `server/lib/oauth.js`, `server/index.js` | The Companion's own `lib/oauth.mjs` and `lib/mcp.mjs` are **dropped entirely** — the station is that layer. Only `tools.mjs` + `principles.mjs` port over. |

### 0.2 Design decisions to confirm before coding (these change the work)

- **D1 — where does module config live?** Recommend **hybrid (option C)**: `station.json` stays the source of truth, but every save also mirrors to `mcps/<id>/.config.json`; on load, a module folder with a `.config.json` but **no** registry entry *adopts* the file. That satisfies delete-and-restore in both directions (manual removal *and* UI delete → restore from trash) with a small diff.
- **D2 — per-MCP auth toggle.** Recommend enforcing the `resource` claim already stored on tokens, plus per-module `auth.oauth` / `auth.static` flags. Legacy tokens with an empty `resource` keep station-wide access so existing claude.ai connectors don't break.
- **D3 — where do `instructions` live?** Recommend an optional **`instructions.md` in the module folder**: no manifest schema change, editable in the code drawer, travels with the folder, and the per-MCP chatbot can already see it.

---

## 1. Phase 1 — Inputs and baseline (no code changes)

- [ ] **1.1 Obtain the real Companion source**
  - [ ] 1.1.1 `lib/tools.mjs` (the 19 tool defs + `siyuan()` + `execSiyuanTool`)
  - [ ] 1.1.2 `lib/principles.mjs` (the house style text)
  - [ ] 1.1.3 Confirm which tools are in/out of scope (doc says `generate_image`, instruction CRUD, `uploadAsset` are **not** MCP tools → excluded)
  - **Check:** tool count actually equals 19; every `input_schema` is plain JSON Schema (no `$ref`/`oneOf` — those need extra conversion care)

- [ ] **1.2 Baseline: prove the current self-contained behaviour, before changing anything**
  - [ ] 1.2.1 Boot a scratch station (`DATA_DIR=/tmp/plan-test`), configure the `gemini` module with a fake key
  - [ ] 1.2.2 `mv mcps/gemini /tmp/x` → `POST /api/reload` → module gone from `/api/mcps`; station still serves
  - [ ] 1.2.3 `mv /tmp/x mcps/gemini` → `POST /api/reload` → **assert settings still present and decryptable** (`GET /api/mcps` shows configured)
  - [ ] 1.2.4 Repeat via the **UI Delete** path (`DELETE /api/mcps/gemini`), restore the folder from `data/trash/` → **assert settings are GONE** (this is F4; it's the bug the feature must fix)
  - **Test artefact:** `scripts/smoke-selfcontained.sh` — runs 1.2.2–1.2.4, asserts the expected before/after. Red on 1.2.4 today; green after Phase 2.

- [ ] **1.3 Baseline: prove `instructions` and prompts are missing/working**
  - [ ] 1.3.1 `initialize` against `/gemini_mcp` → assert the response has **no** `instructions` field (confirms F1)
  - [ ] 1.3.2 Temporarily add `server.registerPrompt(...)` to the `_template` module in a scratch copy → `prompts/list` → assert it returns (confirms F2, no host change needed)
  - **Gate:** do not start Phase 2 until 1.2 and 1.3 have run and their results match F1–F4. If any differ, revise this plan first.

---

## 2. Phase 2 — Host capabilities (small, additive, module-agnostic)

Every change here benefits *all* modules, not just SiYuan. Ship as its own release before the port.

- [ ] **2.1 Module-supplied `instructions`** (fixes F1)
  - [ ] 2.1.1 In `loadModules`, read optional `instructions.md` from the module folder into `entry.instructions` (cap ~100 KB; missing file = `undefined`)
  - [ ] 2.1.2 In `buildServerFor`, pass `new McpServer({name, version}, { instructions: mod.instructions })` when present
  - [ ] 2.1.3 Exclude `instructions.md` from nothing — it *should* appear as an editable tab in the code drawer (it's a `.md`, so `EDITABLE` already allows it)
  - **Check:** `initialize` on a module with `instructions.md` returns the text; a module without one is byte-identical to today's response
  - **Test:** extend `scripts/smoke.sh` — assert `result.instructions` contains a known sentinel string

- [ ] **2.2 Prompts in the module contract** (documents F2 — no code)
  - [ ] 2.2.1 `docs/BUILDING_MCPS.md`: document `server.registerPrompt(name, {title, description, argsSchema}, cb)`
  - [ ] 2.2.2 `server/lib/seedInstructions.js`: same (invariant — contract docs move together)
  - [ ] 2.2.3 `mcps/_template/index.js`: add one commented-out example prompt
  - **Check:** the ✦ popup, asked "how do I add a prompt?", answers correctly from the seeded instructions

- [ ] **2.3 Self-contained module config** (fixes F4, decision D1)
  - [ ] 2.3.1 `saveSettings()` also writes `mcps/<id>/.config.json` = `{ enabled, settings: {…encrypted…}, updatedAt }` (dot-prefixed → invisible to the file walker, same trick as `.chat.json`)
  - [ ] 2.3.2 The enable/disable toggle (`PATCH /api/mcps/:id`) mirrors too
  - [ ] 2.3.3 In `loadModules`, when a folder has **no** registry entry but **has** `.config.json` → adopt it (log `adopted config for '<id>' from module folder`)
  - [ ] 2.3.4 Conflict rule: registry entry exists → **registry wins**, file is refreshed from it. One direction only; no merge logic, no clock comparison.
  - [ ] 2.3.5 Decide + document: adoption fails to decrypt (foreign station) → keep the module, drop the secrets, mark "NEEDS SETTINGS" rather than crash-loop
  - [ ] 2.3.6 `.gitignore` + export/backup: `.config.json` **must** be inside the tar (it's the point) but **must not** be committed to the repo
  - **Checks:**
    - delete folder → restore → settings intact (already true; must stay true)
    - UI-delete → restore from `data/trash/` → **settings intact** (new)
    - move a module folder to a *different* station with a different key → module loads, secrets are cleared, UI says NEEDS SETTINGS, nothing throws
  - **Test:** `scripts/smoke-selfcontained.sh` from 1.2 flips green on 1.2.4; add the foreign-key case

- [ ] **2.4 Release checkpoint**
  - [ ] 2.4.1 Full `scripts/smoke.sh` (34 checks) still green
  - [ ] 2.4.2 Bump `cfg.version` + `CHANGELOG.md`, commit, tag
  - **Gate:** Phase 3 and Phase 4 are independent — either can go next. Phase 4 (the port) does not *need* Phase 3.

---

## 3. Phase 3 — Per-MCP auth ("all of them added to claude.ai")

Addresses "a separate settings button for the OAuth, or a second on/off toggle". Today: one OAuth AS, and **any** token opens **every** MCP (F6). Each module already has its own connector URL (`PUBLIC_URL/<slug>`) and its own `/.well-known/oauth-protected-resource/<slug>`, so adding all of them to claude.ai *already works* — what's missing is scoping and a discoverable UI.

- [ ] **3.1 Enforce the `resource` claim on tokens** (server/lib/oauth.js)
  - [ ] 3.1.1 `requireBearer`: if `token.resource` is set, require it to match the requested `/<slug>`; empty/absent `resource` = legacy, station-wide (do **not** break existing connectors)
  - [ ] 3.1.2 Log a one-line warning when a legacy station-wide token is used, so they age out visibly
  - **Checks:** token minted for `/siyuan` → 200 on `/siyuan`, **403** on `/gemini_mcp`; static `MCP_TOKEN` unchanged (station-wide by design); a pre-upgrade token keeps working
  - **Test:** two PKCE round trips against two slugs, cross-call each → assert 200/403 matrix

- [ ] **3.2 Per-module auth toggles**
  - [ ] 3.2.1 Registry: `auth: { oauth: true, static: true }` defaulted on, mirrored into `.config.json` (2.3)
  - [ ] 3.2.2 `handleMcpRequest` honours them: OAuth-disabled module rejects OAuth-minted tokens; static-disabled module rejects `MCP_TOKEN`
  - [ ] 3.2.3 Guard: turning **both** off = the module is unreachable → require an explicit confirm in the UI, and say so on the card
  - **Check:** each of the 4 on/off combinations returns the expected 200/401 for each lane

- [ ] **3.3 "Connect" popup per MCP card**
  - [ ] 3.3.1 Button on each card → shows the connector URL, an OAuth on/off toggle, a static-token on/off toggle
  - [ ] 3.3.2 Copy-paste blocks: claude.ai connector URL, and the `claude mcp add --transport http … --header "Authorization: Bearer …"` line
  - [ ] 3.3.3 Live state: ✅ OAuth on / ❌ `PUBLIC_URL` not set; ✅ / — static token
  - **Check:** with `PUBLIC_URL` unset the popup says OAuth is off and explains why, instead of offering a URL that cannot work

---

## 4. Phase 4 — Port the SiYuan module

One folder, `mcps/siyuan/`. No npm deps (F8). Files: `manifest.json`, `index.js`, `instructions.md` (the house style), `.config.json` (generated), `.chat.json` (generated).

- [ ] **4.1 Skeleton + settings**
  - [ ] 4.1.1 `manifest.json`: `id: siyuan`, `slug: siyuan` *(check against `RESERVED_SLUGS` — `mcp`, `api`, `oauth`… are taken; `siyuan` is free)*, icon 📓, settings: `siyuan_url` (text, required), `siyuan_token` (secret, required)
  - [ ] 4.1.2 Note what does **not** become a setting: `MCP_TOKEN`, `PUBLIC_URL`, `APP_PASSWORD`, `STATE_DIR` — all station-level now (F9)
  - [ ] 4.1.3 `export async function test(settings, { fetchJson })` → `notebook/lsNotebooks`, returns "✓ 7 notebooks" — wires up the card's Test button
  - **Check:** module loads, card shows NEEDS SETTINGS; after entering URL+token, Test goes green

- [ ] **4.2 The `siyuan()` kernel wrapper** — port faithfully, it is the load-bearing part
  - [ ] 4.2.1 Browser `User-Agent` header (Cloudflare bot-fight returns error 1010 without it — **do not "simplify" this away**)
  - [ ] 4.2.2 Transport retry: 403/429/5xx → 3× linear backoff (500/1000/1500 ms)
  - [ ] 4.2.3 Kernel transient retry: HTTP 200 + non-zero `code` matching `/query notebook failed|busy|locked|reindex|syncing|database is locked|timeout/i` → 3× (700/1400/2100 ms); anything else throws immediately
  - [ ] 4.2.4 Errors returned as `{ content: [...], isError: true }`, never thrown out of the handler
  - **Checks:** point at a bogus URL → clean tool error, transport stays up; simulate a 429 → observe 3 retries in the log; a non-transient kernel error throws on the first attempt (no pointless retries)

- [ ] **4.3 The 19 tools — JSON Schema → zod shapes** (F7). Convert and verify in batches; `tools/list` after each.
  - [ ] 4.3.1 **Read/discover (6):** `list_notebooks`, `sql`, `search_text`, `read_doc`, `tree`, `find_orphans`
  - [ ] 4.3.2 **Create (2):** `create_doc`, `create_notebook`
  - [ ] 4.3.3 **Edit (6):** `replace_doc`, `update_block`, `update_blocks`, `append_blocks`, `prepend_blocks`, `insert_blocks`, `set_block_attrs` *(that is 7 — reconcile the count against the real source in 1.1)*
  - [ ] 4.3.4 **Move/delete (4):** `rename_doc`, `move_docs`, `remove_doc`, `delete_block`
  - [ ] 4.3.5 `replace_doc` stays composite (getChildBlocks → deleteBlock × N → appendBlock) and **preserves the doc id** — recreating would break every inbound `((id "…"))` ref. Carry the existing non-atomicity comment across verbatim.
  - **Per-batch check:** `tools/list` returns the batch with the right names *and* descriptions; `inputSchema` is a **plain zod-field object**, never `z.object()` (invariant 1 — a `z.object()` here silently produces a broken schema)
  - **Live test (read-only first):** `list_notebooks` → `tree` → `sql` against David's real kernel; only then exercise one write (`create_doc` into a scratch notebook) and one destructive call (`delete_block` on that same scratch doc)

- [ ] **4.4 The house style as `instructions`** (needs 2.1)
  - [ ] 4.4.1 `principles.mjs` text → `mcps/siyuan/instructions.md` verbatim
  - [ ] 4.4.2 `initialize` on `/siyuan` returns it in full
  - **Check:** connect Claude Code to `/siyuan`, ask it to add a page, and confirm it surveys with `list_notebooks` + `tree` first and writes real `((id "…"))` refs — i.e. the style actually landed, not just the string

- [ ] **4.5 The 2 prompts** (needs nothing — F2)
  - [ ] 4.5.1 `add-to-siyuan` (optional `section` arg)
  - [ ] 4.5.2 `audit-siyuan` (no args, read-only)
  - **Check:** `prompts/list` returns both; `prompts/get` renders `add-to-siyuan` with and without `section`

- [ ] **4.6 End-to-end acceptance**
  - [ ] 4.6.1 claude.ai connector against `PUBLIC_URL/siyuan` → OAuth approval → tools usable from the phone
  - [ ] 4.6.2 Claude Code via static `MCP_TOKEN` → same tools
  - [ ] 4.6.3 **The self-contained drill:** stop station → `rm -rf mcps/siyuan` → start → station healthy, module simply absent → restore the folder → `POST /api/reload` → **module back, settings intact, claude.ai connector still works without re-auth**
  - [ ] 4.6.4 Hot-reload drill: edit a tool description in the code drawer → Save & reload → `tools/list` reflects it with **no process restart** (invariant 6)

---

## 5. Phase 5 — Docs, contract, release

- [ ] 5.1 `docs/BUILDING_MCPS.md`: `instructions.md`, prompts, `.config.json` (the three new contract surfaces)
- [ ] 5.2 `server/lib/seedInstructions.js`: same three — **same commit** (CLAUDE.md invariant: contract docs move together or not at all)
- [ ] 5.3 `mcps/_template/`: `instructions.md` stub + commented prompt example
- [ ] 5.4 `CLAUDE.md`: update the "Known gaps" section (per-MCP scoping is no longer a gap if Phase 3 ships)
- [ ] 5.5 `CHANGELOG.md` + `cfg.version` bump; tag → CI builds the image
- [ ] 5.6 `docs/BUILD_JOURNAL.md` work-log row

---

## 6. Risks, and what I will not do quietly

| Risk | Mitigation |
|---|---|
| **Destructive SiYuan tools** (`remove_doc`, `delete_block`, `move_docs`) run against David's **live** kernel | All live testing in a scratch notebook first. No test touches an existing doc. |
| Enforcing token `resource` (3.1) **breaks existing claude.ai connectors** | Legacy tokens (empty `resource`) explicitly keep station-wide access. Verified by test before release. |
| `.config.json` carries **encrypted** secrets; a folder moved to another station **cannot** decrypt them | Documented, and handled: adopt the module, clear the secrets, show NEEDS SETTINGS. Never a crash-loop, never a silent empty key. |
| `replace_doc` is **not atomic** — a failed append after the deletes leaves the doc empty | Known and accepted upstream; comment ported verbatim. SiYuan's own history/sync is the safety net. Not silently "fixed". |
| 19 hand-converted schemas = 19 chances for a typo | `tools/list` asserted per batch; a wrong schema surfaces there, not in front of the model. |
| The station is **Docker + `/app/mcps` volume**; a "deleted" folder may just be a volume mount away | 4.6.3 runs against the container, not only the dev checkout. |

---

## 7. Order of play (recommendation)

1. **Phase 1** — get the source, run the baseline tests. Cheap, and it may invalidate assumptions above.
2. **Phase 2** — host capabilities. Small, additive, useful to every module. Ship + tag.
3. **Phase 4** — the SiYuan port. Delivers the actual ask.
4. **Phase 3** — per-MCP auth. Bigger, riskier (touches OAuth), and *not* required for SiYuan to work. Do it once the port proves the shape.

Phase 3 last is deliberate: nothing in the port needs it, and it is the only phase that can break connectors that already work.
