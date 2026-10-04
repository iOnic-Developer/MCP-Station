# Publishing these pages to the GitHub Wiki

These Markdown files are the source of the GitHub Wiki. Internal links use bare page names like
`[Use Cases](Use-Cases)`, which is how the wiki resolves them, so they don't work when browsing this
folder on GitHub — read them on the wiki instead.

## How it publishes

`.github/workflows/wiki.yml` mirrors this folder into `MCP-Station.wiki.git` whenever a change to
`docs/wiki/` lands on `main` (or when you run the workflow by hand from the Actions tab). Pages
deleted here are deleted from the wiki. This file is excluded.

- `_Sidebar.md` is the wiki's sidebar.
- A page's file name is its URL: `Quick-Start.md` → `/wiki/Quick-Start`.

## Don't edit in the web UI

The next sync overwrites wiki-side edits. Change the files here and merge to `main`.
