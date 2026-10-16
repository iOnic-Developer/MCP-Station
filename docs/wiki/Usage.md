# Usage

**MCP Station 2.7.0.** Usage is measured operational metadata,
not generated demo activity, full auditing, cost tracking, or billing records.

## What is measured

Authenticated, enabled MCP `tools/call` requests with a request ID count when their HTTP response
finishes. A tool's `isError`, JSON-RPC/schema failure, or thrown tool error counts as an error even
when HTTP is 200. Initialization, tool listing, admin Test, denied authentication, disabled
endpoints, and aborted/unfinished responses are excluded.

Overview aggregates calls, errors, success rate, and average latency. Account Activity filters to
that exact account, not its siblings. Daily buckets use UTC dates; the selected window is a rolling
1–30 days. With no calls, counts are zero and rate/latency are unavailable—not fabricated success.

## What is retained

Only these event fields are stored in `/data/usage.json`:

- UTC time;
- account ID and shared source/module ID;
- registered tool name (invalid names become `(invalid)`);
- duration in milliseconds;
- success/failure outcome.

**No arguments, results, request/response bodies, error messages, client identifiers, or credentials**
are retained by the usage recorder. This privacy boundary describes usage metadata, not every
module's logs, chat history, or upstream provider policy.

The global cap is **30 days / 5,000 events**. Heavy activity can evict younger events through the
count cap. Recent results return at most 100 events. Writes are debounced; abrupt termination can
lose the small trailing batch. Full station backups flush pending usage and include it.

## API reference

`GET /api/usage?days=7&instanceId=<account-id>` requires the admin session. `days` defaults to 7;
invalid ranges return 400. Omit `instanceId` for station totals. The response includes `since`,
`days`, `totals`, `daily`, `integrations`, and `recent`. API `successRate` is a fraction from 0 to 1,
not a percentage. A removed account may still have retained history.

[Accounts](Accounts) · [Backups](Backups)
