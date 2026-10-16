# Troubleshooting

Start with the running image tag/digest and health response. These guides target **2.7.0 stable**;
older tags are historical. Back up state and source before any upgrade or restore.

| Symptom | Check |
| --- | --- |
| OAuth unavailable | `PUBLIC_URL` is unset, incorrect, or not publicly reachable over HTTPS. |
| Approval works but tools fail | Check enabled state, credentials, public proxy/WAF events, and endpoint scope; do not assume one cause. |
| Authorization fails immediately | Match `PUBLIC_URL` and connector origin; retry a fresh consent flow. |
| Connection disappears on redeploy | Verify persistent `/data`, the encryption key, and any fixed `SESSION_SECRET`. |
| Service says not configured | Save required settings for the actual selected account, not a sibling/default. |
| Valid bearer gets 403 | It may be scoped to another account/module; use the correct endpoint token. |
| Valid endpoint returns 404 | Check the slug, account existence, and explicit enablement. |
| Test passes but tools fail | A source without `test()` may only confirm load; test is not a client call. |
| Usage is empty | Initialization, tool listing, setup Test, denied requests, and aborted calls do not count. |
| Stable features missing | Verify the running image/digest is 2.7.0, recreate after pulling, and check browser cache and logs. |
| Gmail/Drive badge says configured but calls fail | Alternative OAuth requirements need Test; save an access token or complete refresh-token configuration. |
| ChatGPT app / Claude connector option missing | Check provider plan, workspace policy, and supported app features; see Connecting AI Clients. |
| New bundled modules missing | 2.7.0 seeds all 18 on a fresh install and adds missing folders at startup; existing folders are not overwritten. Check image, mounts, logs, and filters before changing source. |
| No install option | PWA installation depends on HTTPS, browser, and device; there is no private offline dashboard. |

## Network and access

Check `/healthz`, discovery reachability, station logs, and reverse-proxy/WAF logs. An external login
wall can block connectors. Cloudflare bot policies can block client requests after OAuth succeeds;
verify that in edge events rather than broadly disabling protections on suspicion.

The repository includes `scripts/claude-flow-sim.mjs` and `scripts/diagnose-connector.sh` for deeper
checks. Review their invocation and handle passwords/tokens privately; never paste real credentials
or raw sensitive traces into issue reports. A successful simulation narrows the problem, not proof
that every third-party client works.

## Account and restore problems

Shared source edits affect all accounts; test them deliberately. Portable JSON and module ZIPs do
not restore additional accounts or usage. Use a matching full backup in an isolated environment.
An environment-provided `SESSION_SECRET` must be preserved separately from the archive.

Report the channel, image/build, deployment shape, sanitized error, and reproduction steps.
Remove passwords, bearer tokens, provider keys, personal payloads, and private URLs first.

[Usage](Usage) · [Backups](Backups) · [Configuration](Configuration)
