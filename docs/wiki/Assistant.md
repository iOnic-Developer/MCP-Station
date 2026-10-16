# Assistant

MCP Station 2.7.0 includes the full-page Assistant, per-source conversations, and
account-workspace source editing.

## Build deliberately

1. Select and configure OpenAI, Anthropic, or Gemini (or a compatible configured gateway).
2. Provide API documentation, an OpenAPI description, or sanitized endpoint examples.
3. Ask for a small module with explicit tool descriptions, required settings, and actionable errors.
4. Review the generated files, permissions, and destructive operations.
5. Configure service credentials in secret settings fields, test, and then enable the endpoint.

The Assistant can fetch documentation and create/edit/reload module files using its station tools.
Success depends on provider availability, API documentation, credentials, and generated code; it is
not a guarantee that every API becomes complete automatically. Sites without usable APIs need
an appropriate adapter, authentication, and site permission; no universal browser access is built in.

## Where the context goes

Conversations, live station context, relevant module source, and tool output can be sent to the
selected AI provider or configured gateway. Module chat is source-scoped, not private to each
service account. Do not paste real API keys into chat or keep them in source files. Use settings
fields, least-privilege credentials, and the provider's appropriate privacy controls.

A self-hosted station is not an offline or cloud-free Assistant. Provider usage may incur charges.
Station secret encryption does not keep conversation content on your server.

## Shared code and authority

Editing a source affects **all** its service accounts. AI-generated module code runs as trusted
in-process JavaScript; review it like code you would install yourself. The Station management MCP
also grants broad module-management powers: connect it only to clients you trust.

Assistant work happens during requests. MCP Station does not provide a built-in background job
scheduler; use a separately configured automation system such as n8n when appropriate.

[Configuration](Configuration) · [Building a Module](Building-a-Module) · [Accounts](Accounts)
