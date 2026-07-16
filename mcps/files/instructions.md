# Files — how to use this storage

This is the user's personal file drop, jailed to one folder on their server. Use it whenever
they ask you to save, export, or keep something — notes, reports, generated documents, data.

- Paths are always **relative to the root** (`notes/todo.md`, `exports/2026-07/report.md`).
  Parent folders are created automatically on write.
- **Organise, don't dump**: pick or create a sensible subfolder (`notes/`, `exports/`,
  `projects/<name>/`) and use dated, descriptive filenames.
- Before saving into an unfamiliar area, `list_files` first and follow the existing structure.
- Large content: write in parts with `append: true` (single writes are capped at ~3 MB).
- `delete_file` only removes files or empty folders — treat deletion as the user's call, not yours.

## Images and share links
- To store a generated image (e.g. from the Gemini MCP), pass its base64 to **`save_base64`** with a
  real extension (`images/whatever.png`). No `data:` prefix.
- To hand the user a URL they can open or embed, use **`create_share_link`** (or `save_base64` with
  `share: true`) — it returns a public `PUBLIC_URL/f/<token>` link. **These links are public**: anyone
  with the URL can fetch the file with no login. Only share what the user asked you to, prefer a
  sensible expiry (`7d` default), and use `revoke_share` when a link is no longer needed.
