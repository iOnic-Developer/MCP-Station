# Use Cases

Examples below describe possible workflows with configured modules and suitable permissions—not
promises of automatic results or bundled integrations beyond the [inventory](Bundled-Modules).

## Connect knowledge and files

Use SiYuan to search and organize notes, then Files to save a report in a configured root.
Review public-share controls before asking a client to distribute any file.

> “Find the project decision and save a summary to my reports folder.”

## Inspect home-lab services

Use Radarr/Sonarr tools to inspect queues and disk state. Explicitly review monitoring, search,
quality, and download decisions. Natural-language instructions do not override service settings
or guarantee that a release follows your preferred size/codec rules.

> “Show the queue and flag items that need attention; don't start a search yet.”

## Work with business records

Xero tools can access accounting/payroll operations when your Custom Connection, region, and
subscription permit them. Inspect the live tool contract and confirmation behavior before writes.

> “Prepare an invoice draft for review.”

## Keep automation in its execution system

The n8n module can manage workflows and executions through the n8n API, subject to permissions.
Schedules, webhooks, and retries run in your separately configured n8n instance—not in Station.

> “Inspect the failed workflow execution and propose a fix before changing it.”

## Reuse a source with different credentials

Add Personal and Work configurations for a suitable installed service, each with its own
endpoint and grants. These are service accounts under one administrator, not human-user profiles.
The bundled Gmail and Google Drive modules provide practical examples; each configuration needs
its own credentials.

## Move between AI clients

Authorize the same service-account endpoint in compatible clients rather than rebuilding the
integration for each one. Use ChatGPT or Claude where custom MCP features are available, Claude
Code for CLI workflows, or local/cloud models through LibreChat.
[Client setup](Connecting-AI-Clients).

## Build the missing integration

Use sanitized API docs and the Assistant to draft a narrow module. Review source, configure secret
fields, test real behavior, and enable only what you need. Provider charges and service terms still
apply; a useful integration is not guaranteed by having an HTTP API alone.

[Assistant](Assistant) · [Accounts](Accounts) · [Building a Module](Building-a-Module)
