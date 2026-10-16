# Accounts

**MCP Station 2.7.0.** An account means a service configuration,
not a person signing in. One station administrator can manage every account.

## One source, independent configuration

An installed source folder holds `manifest.json`, `index.js`, and optional instructions/docs.
Its existing endpoint and settings remain the **Default account**. Additional accounts reuse that
source with distinct settings, endpoint slugs, enable flags, test results, static tokens, and scoped
authorizations. No folder copies or destructive migration are required.

1. In Integrations, choose an installed service and add an account.
2. Name it for the configuration you intend to connect.
3. Save that account's required settings and run its test.
4. Enable it explicitly and copy its own endpoint.
5. Authorize the client for that endpoint, or issue its scoped bearer.

A new account starts **blank, disabled, and untested**, without copied credentials, grants, or tokens.
Manifest defaults are not inherited by additional accounts. Copying a URL does not complete setup.
Account selection controls settings, tests, capabilities, skills, tokens, and the connection URL.

## Shared code is shared risk

Code, module chat, ZIP exports, and source editing belong to the source. Editing or reloading it
affects every account. Request settings are captured independently and exposed through
`getSettings()`; do not cache credentials in module-global variables.

This is **not process isolation or multi-user tenancy**. Modules execute as trusted JavaScript in
the station process. The privileged Station module, master `MCP_TOKEN`, and legacy resource-less
station-wide OAuth grants can reach broadly. Scoped account grants are narrower, but do not create
separate administrators or protect against malicious source code.

## Removing an additional account

The confirmed account-removal flow deletes its registry/settings/static bearer and revokes its
pending and active scoped OAuth access. Sibling accounts and source files remain. Retained usage
metadata can remain until retention expiry. Reusing the slug does not revive old scoped credentials.
The default account cannot be removed through this flow. Remove additional accounts before deleting
their shared source. There is no account-renaming or endpoint-migration API in this contract.

## Recovery

Full station backups include additional accounts and usage. Portable JSON and source ZIPs do not.
Keep backups private and preserve any externally supplied `SESSION_SECRET`. [Backups](Backups).

[Backend contract](https://github.com/iOnic-Developer/MCP-Station/blob/main/docs/ACCOUNT_INSTANCES.md)
