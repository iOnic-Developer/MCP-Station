Suggested subreddit: r/selfhosted (also fits r/ClaudeAI, r/homelab)

Suggested title:
I built a self-hosted hub that turns any API into an MCP server for Claude, so I stopped waiting for vendors to ship one

Image order (attach in this order):
1. docs/assets/screenshots/dashboard.png      — the main page
2. docs/assets/screenshots/tools-inspector.png — "here's exactly what one module exposes"
3. docs/assets/screenshots/oauth-consent.png   — the claude.ai connect screen
4. docs/assets/screenshots/add-mcp.png         — building a new one (optional)

---

Bit of background first: I run a fish and chip shop and a small homelab, and I've been leaning on Claude for more of the day-to-day. Kept hitting the same wall though. Claude's clever but it can only touch things someone's already built a connector for, and half the stuff I actually use (Radarr, Sonarr, my SiYuan notes, my POS, Xero) either has no MCP or a really limited one.

So I made MCP Station. It's one Docker container. You drop a folder in `mcps/` and it becomes a URL like `https://mcp.example.com/whatever/mcp` that Claude connects to as a custom connector. One container, one password, as many MCPs as you want.

The part I didn't expect to enjoy as much as I do: you don't write the modules by hand. There's a chat built into the admin page. I paste in an API's docs (or honestly just a couple of example curl calls), make a throwaway API key, and tell it to build the module and test it against the real thing. A minute later it's a live endpoint I can add to Claude. Then I download the little "skill" file it spits out, drop that into Claude as well, and tell Claude any house rules I want. For my Radarr one I just said "only grab stuff under a certain size, x265" and now it always does that without me asking.

The demo that actually sold my mates on it is embarrassingly simple. I type:

> get spider man 2

and it comes back with:

> Added Spider-Man 2 (2004) to Radarr, monitored and searching now. If you meant The Amazing Spider-Man 2 (2014), say so and I'll swap it.

That's the whole interaction. No app, no menus, and it even knows there are two films with basically the same name.

The bigger reason I bothered making it public though: you can make any API Claude-compatible yourself. You're not stuck with whatever a vendor decided to ship, and you're not waiting around for one either. My Xero module has all the bits my shop actually needs (invoices, payroll, employee leave, pay runs, live reports), built straight off Xero's own API docs, running on my box with my keys. Is it more tools than the official Xero connector? Doesn't really matter. It's mine and it fits how the shop works, and I had it going in an afternoon.

New in the latest version, and the reason I finally cleaned it up for release: you can export any module as a zip and hand it to someone else. They drop it in their station, add their own keys, and it just works. The export strips the secrets out so you're not leaking anything. Seemed like the obvious thing for passing modules around.

A few things it does, for the checklist people:

- OAuth 2.1 is built in, so claude.ai (web and mobile) connects by URL with no token faff. There's a proper consent screen with a Deny button.
- Per-module tokens and scoping, so you can hand a script one endpoint without giving it the keys to everything.
- Encrypted settings, an in-browser code editor with hot reload, a "show me exactly what tools this exposes" inspector, and backups.
- Runs on plain Docker, Unraid, or TrueNAS.

One thing that caught me out and might catch you: if you put it behind Cloudflare, their AI-bot blocking silently kills the connector after the password page (claude.ai's actual calls come in as "Claude-User" and get 403'd at the edge). There's a whole section in the docs on the fix. Took me an embarrassingly long time to work that one out.

It's MIT, fully self-hosted, no cloud dependency. GitHub is in the comments, Docker image is `dbzocchi/mcp-station`.

Fair warning: I built a big chunk of this with Claude's help and I'm a chip shop owner, not a career dev, so kick the tyres and tell me what's rubbish. Happy to answer anything.

---
(Post the GitHub link as the first comment rather than in the body — some subs down-rank link-in-body posts. Link: https://github.com/iOnic-Developer/MCP-Station )
