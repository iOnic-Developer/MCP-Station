# Wiki source and publication

These files target **MCP Station 2.7.0 stable**. Internal links use extensionless wiki page names;
repository browsing uses the corresponding `.md` files. Historical version context is in Versions
and Images, not current feature caveats.

`.github/workflows/wiki.yml` mirrors `docs/wiki/` into `MCP-Station.wiki.git` on matching pushes to
`main` or manual dispatch. It preserves unrelated pages and excludes `_PUBLISHING.md`.
Source preparation alone is not a publication. The approved parent release process owns sync and
verification. Review CI, actual registry tags/digests, link targets, and sample-data captions first.
`_Sidebar.md` owns navigation; filenames define wiki URLs. Edit source rather than web-UI copies,
which the next sync overwrites.
