# Use Cases & Recipes

MCP Station is a blank hub — its value is whatever you dock into it. Here's what people actually run,
with the kind of thing you'd say to Claude once the module is connected.

## 🎬 Media library on voice command

The `radarr_mcp` and `sonarr_mcp` modules put your whole download stack behind natural language.

> **You:** get spider man 2
>
> **Claude:** Added *Spider-Man 2* (2004) to Radarr — monitored, searching now. If you meant *The
> Amazing Spider-Man 2* (2014), say so and I'll swap it.

No app, no menus, no quality-profile hunting. And because you can tweak the downloaded **skill**, you
can bake in standing rules — *"only grab releases under a set size, x265/HEVC"* — so every request
follows them automatically. Ask "what's downloading?" and it reads the queue with warnings; "how much
disk is left?" and it tells you.

## 📓 A knowledge base Claude can read and write

The `siyuan` module gives Claude 19 tools over a live [SiYuan](https://b3log.org/siyuan/) knowledge
base — search, read, create, edit, move and audit docs, with your house style shipped as MCP
instructions so new notes land tagged and linked correctly.

> "File this decision under the MCP Station project, tag it, and link it back to the hub page."

## 💷 Your accounting, your tools

The `xero` module is the poster child for *build-your-own*: ~31 tools covering the exact operations a
small business runs — invoices, quotes, payments, employee leave, **pay runs**, tracking categories,
live P&L / balance-sheet reports — built straight from Xero's API docs, self-hosted with your own
keys.

> "Draft an invoice to the Thursday supplier for £240, net 14 days." · "How much holiday does Sam
> have left?" · "Show me this month's P&L."

The point isn't that a hand-built module beats the vendor's on tool count — it's that it's shaped to
*your* workflow, runs on *your* hardware, and you built it in an afternoon instead of waiting for
anyone.

## 📁 Give Claude a place to put things

The `files` module is jailed file storage: Claude can read, write, move and delete inside one folder,
save images from base64, and mint public share links. Great as a scratch space, an export target, or
a drop for generated reports and images.

> "Save that chart as a PNG in exports/2026-07 and give me a share link."

## ✈️ Notifications & messaging

The `telegram` module lets Claude send and read messages through a bot — wire it into a workflow so a
long job pings your phone when it's done, or ask Claude to message the family chat.

## 🪄 Anything with an API

This is the real use case. A weather API, an RSS feed, your NAS, a smart-home hub, a POS system, a
Postgres database, an internal microservice — paste its docs into the ✦ assistant and it writes the
module. Some real-world "there's no official MCP for this, so I made one" examples:

- **A point-of-sale system** → daily sales summaries and forecasting in chat.
- **A home-automation hub** → "turn the shop sign off" from Claude.
- **An RSS feed / news API** → "what's new in X since yesterday?"
- **An internal ticketing API** → triage and answer from one place.

If it speaks HTTP, it can be an MCP — and once it is, it's a `.zip` you can hand to anyone.

## The pattern behind all of these

1. Open the chat, paste the API docs (or endpoints), make a **temp key**.
2. Have it build the module and **test** it with the temp key.
3. Swap in a real key, toggle it on, **add the URL to Claude**, download the **skill**.
4. Tell Claude to tweak the skill to match how you work.

Minutes, not a project.
