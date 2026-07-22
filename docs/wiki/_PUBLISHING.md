# Publishing these pages to the GitHub Wiki

These Markdown files are written as GitHub Wiki pages (the internal links use bare page names like
`[Use Cases](Use-Cases)`, which is how the wiki resolves them). To publish them:

## One-time: enable the wiki

Repo → **Settings → Features → Wikis** (tick it), then create the first page in the web UI once (this
initialises the wiki's git repo at `github.com/iOnic-Developer/MCP-Station.wiki.git`).

## Push all pages at once

```bash
git clone https://github.com/iOnic-Developer/MCP-Station.wiki.git
cd MCP-Station.wiki
cp ../MCP-Station/docs/wiki/Home.md .
cp ../MCP-Station/docs/wiki/Use-Cases.md .
cp ../MCP-Station/docs/wiki/Quick-Start.md .
cp ../MCP-Station/docs/wiki/Building-a-Module.md .
cp ../MCP-Station/docs/wiki/Connecting-Claude.md .
cp ../MCP-Station/docs/wiki/FAQ.md .
cp ../MCP-Station/docs/wiki/Troubleshooting.md .
git add -A && git commit -m "Wiki: initial pages" && git push
```

`Home.md` becomes the wiki landing page automatically. (Don't copy this `_PUBLISHING.md` file.)

They also render fine as-is inside the repo under `docs/wiki/`, so publishing to the wiki is optional.
