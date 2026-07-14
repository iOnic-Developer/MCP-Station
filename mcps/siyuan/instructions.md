SIYUAN KB HOUSE STYLE — follow this on every create/edit in SiYuan.

PLACEMENT (one home, one truth): before creating, survey structure (list_notebooks + the tree tool)
and give the topic exactly ONE home; never duplicate content across notebooks. If a section is named
(e.g. "personal"), map it to that notebook and pick or create the right parent; ask only if genuinely
ambiguous. If a topic outgrows its spot, MOVE it (move_docs) and leave a small pointer page behind
(a callout + a real block ref to the new home) — never copy.

GRAPH (no orphans): every doc has at least one incoming AND one outgoing block ref, written as REAL
refs ((id "Title")) — never plain text and never siyuan:// URLs (only real refs create backlinks and
graph edges). Hub/parent pages end with a Contents section (refs to their children) plus a
"Back to «parent»" ref. Every notebook has one entry-point index page, bookmarked in the Hubs group.
Related pages cross-link in a Connections section. After a batch of work, run find_orphans and wire in
anything with no refs either way.

PAGE ANATOMY (same skeleton everywhere): Title -> tag line -> ONE status callout (a single >-quote
line led by an emoji, e.g. "> ✅ ..." or "> ⚠️ ...", dated if it matters) stating what the page is ->
content (use tables wherever data is tabular; put facts in two-column field/value tables, not prose)
-> Connections/Contents at the bottom.

TAGS = categories, not labels: two levels max, category -> subcategory (media -> downloaders,
business -> finance). Never tag with an app, device, or person name. No synonyms — pick one term and
keep it. Set BOTH the doc-level tags (via set_block_attrs "tags") and a matching inline #tag# line.
Names, nicknames and model numbers go in the alias attribute, NOT in tags.

ATTRIBUTES on every meaningful page (set_block_attrs): alias (every way you'd search for it), memo
(one-line hover summary), and bookmark on key pages only — one bookmark group per area
(Hubs, Estate, HomeLab, Business, Guides, Credentials, Projects) so the panel stays a short jump-list.

CODE FORMATTING, always: fenced code blocks with a language for multi-line commands, configs and
scripts; inline code for single commands, paths, ports, filenames and API keys — including inside
tables. If a table can't hold the code cleanly, restructure the content; don't unformat it.

SOURCING & HISTORY: if Gmail/Drive connectors are available, back mailbox-checked facts with the Gmail
thread link and documents with the Drive file link plus the folder path. Never silently delete
superseded info — add a dated "supersedes the above" note so history reads correctly. Date every
update; keep a newest-first status log on live matters.

VERIFY before finishing (query with sql, don't eyeball): zero orphans, zero untagged docs, zero
unformatted code, no duplicate content, no dead refs.

EFFICIENCY (stay fast and under tool-use limits): reuse ids you already have — don't re-run
list_notebooks/search_text to rediscover them. To rewrite a page, read_doc once then replace_doc once;
never edit blocks one at a time. Prefer one coarse call (replace_doc, update_blocks, tree,
find_orphans) over many small ones.
