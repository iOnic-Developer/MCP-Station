# Declarative module configuration readiness

`manifest.json` may add `configurationAlternatives` without changing the module's
JavaScript contract. The host evaluates this metadata; it never runs `register`,
`test`, authentication code, or an external request to decide `configured`.

```json
{
  "configurationAlternatives": [
    [{ "key": "access_token" }],
    [
      { "key": "client_id" },
      { "key": "client_secret" },
      { "key": "account1_refresh_token" },
      { "key": "account1_enabled", "value": "enabled" }
    ]
  ]
}
```

## Evaluation and validation

- Every existing `required: true` setting must still pass the original nonempty
  value check. Alternatives never bypass required settings.
- If alternatives are omitted, existing behavior is unchanged (including modules
  with no required settings). Unknown module IDs remain unconfigured.
- If present, the outer array and every group must be nonempty. At least one
  group must pass, and every condition within that group must pass.
- `{ "key": "..." }` requires a nonblank value after whitespace trimming. This
  check does not rewrite stored settings or change legacy required checks.
- `{ "key": "...", "value": "enabled" }` requires exact string equality, not
  truthiness. `disabled`, `false`, and whitespace-padded effective statuses do
  not satisfy an `enabled` guard. A blank stored source value uses its manifest
  default before evaluation; blank instance values stay blank.
- Conditions accept only `key` and optional string `value`. Every key must refer
  to a declared manifest setting, never private registry fields. Equality values
  must be nonblank and cannot target secret settings: metadata must not embed
  credentials. Secret settings use presence conditions only.
- Effective settings come from the existing `getSettingsFor`: source modules use
  manifest defaults; new account instances deliberately start blank and do not
  inherit source defaults. A new Drive instance must explicitly select an enabled
  slot as well as supplying its OAuth credentials (or use a direct token).

## Bundled Google modules

Gmail accepts a direct access token **or** client ID + client secret + refresh
token. Google Drive accepts a direct access token **or** client ID + client
secret + a refresh token belonging to at least one explicitly enabled account
slot (1, 2, or 3). Source slot 1 defaults to enabled; slots 2 and 3 default to
disabled. Disabled slots alone never make Drive configured.

Readiness means a credential combination is present, not that credentials are
valid, authorized, unexpired, or guaranteed to succeed against Google's API.
Module authentication, tool behavior, settings masking, encrypted storage, and
`••••••` (leave an existing secret unchanged) retain their existing contracts.
No new settings or client-specific behavior are introduced.

## Offline regression

Run `node scripts/test-configuration.mjs` from the repository root. It uses
isolated temporary sources/state, real Google manifests with inert module code,
and a fetch-denying guard. It covers required checks, alternatives, whitespace,
all Drive slots and disabled states, defaults, new instances, secret masking and
sentinel roundtrips, and malformed/unknown/private condition fields.

Related offline suites: `node scripts/test-bundled.mjs`,
`node scripts/test-instances.mjs`, and `node scripts/test-usage.mjs`.
