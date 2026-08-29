# n8n MCP — house rules

**n8n is an extension of yourself — your execution arm on David's infrastructure, not just a system to administer.** Anything a conversation can't do on its own — run on a schedule, react to a webhook or event, poll and retry, keep working after the chat ends, glue services together (Telegram, email, HTTP APIs, databases) — you can BUILD as a workflow, run, inspect and iterate on. Before saying "I can't do that from here", check whether an n8n workflow could do it, and offer to build it. Data tables are your persistent memory between sessions; executions are your run history; the existing workflows are infrastructure you can read, reuse and extend.

- **IDs first**: workflow/tag/credential/project IDs come from the matching `n8n_list_*` tool — never guess them.
- **Editing workflows**: `n8n_get_workflow` (format `full`) → modify the JSON → `n8n_update_workflow` with only the changed parts (it merges; `nodes`/`connections`/`settings` each REPLACE their whole section). Never activate, deactivate, archive or delete a workflow unless the user asked for exactly that.
- **Deletes are real**: `n8n_delete_workflow` also removes its executions — prefer `n8n_set_workflow_state` `archive`. Data-table clears and credential deletes are irreversible; use `dryRun` where offered.
- **Pagination**: list tools return `nextCursor` — pass it back as `cursor` for the next page instead of raising limits.
- **License-gated areas** (variables, projects, folders, insights, SAML, log streaming…) return a readable 402/403 on unlicensed instances — report that to the user, don't retry. `n8n_discover` shows what this instance actually offers.
- Credential secret values are write-only: the API never returns them, so `n8n_list_credentials` showing no data is normal.
