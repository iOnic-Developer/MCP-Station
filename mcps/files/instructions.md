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
