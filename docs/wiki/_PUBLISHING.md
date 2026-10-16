# Wiki source and publication

These files are the source of the GitHub Wiki. Internal links use extensionless wiki page names;
when browsing the repository folder, open the corresponding `.md` file.

## Current boundary

This branch contains a dual-channel documentation draft: stable 2.4 alongside clearly marked beta
and later branch-preview behavior. The published wiki may still contain older stable pages. Editing
this folder does not itself publish anything, and the public main README remains stable until an
approved merge. Do not manually sync or merge as part of the product-copy task.

## Existing workflow

`.github/workflows/wiki.yml` mirrors `docs/wiki/` into `MCP-Station.wiki.git` on matching pushes to
`main` or manual dispatch. It deletes wiki pages absent from source and excludes `_PUBLISHING.md`.
A manual dispatch is a publication action too: obtain approval and select the intended source.

Before publication, verify image/build/channel statements, local links, screenshots, and the parent
product-site handoff. `_Sidebar.md` owns navigation; filenames define public page URLs.
The next sync overwrites web-UI wiki edits, so make approved edits in source instead.
