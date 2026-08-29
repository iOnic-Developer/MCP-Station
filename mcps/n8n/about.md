# n8n module

**n8n as an extension of Claude.** This module isn't just admin tooling — it's how Claude extends itself onto the infrastructure: work that needs a schedule, an event trigger, retries, cross-service glue, or a lifetime beyond the current conversation gets built as a workflow, run, inspected and iterated on; data tables act as persistent state between sessions. The `instructions.md` served at initialize carries this framing to every connected client automatically.

Full [n8n Public API v1](https://docs.n8n.io/api/) coverage for a self-hosted n8n instance — all **103 endpoints** of API spec v1.1.1 (the version an instance serves at `/api/v1/docs`), mapped onto 66 tools. Auth is the instance API key (`X-N8N-API-KEY`); instances behind Cloudflare Access can additionally send a service token via the optional `CF-Access-Client-Id` / `CF-Access-Client-Secret` settings.

Related endpoints are grouped where it keeps schemas clean (lifecycle states, tag get/set, column management, settings areas); everything else is one tool per endpoint. License-gated features (variables, projects, folders, insights, SAML, log streaming, source control…) surface n8n's own 402/403 messages — `n8n_discover` reports what the instance actually offers.

## Endpoint → tool map

| API endpoints | Tool |
|---|---|
| `GET /workflows` | `n8n_list_workflows` |
| `GET /workflows/{id}` | `n8n_get_workflow` (summary/full) |
| `POST /workflows` | `n8n_create_workflow` |
| `PUT /workflows/{id}` | `n8n_update_workflow` (fetch-merge-put) |
| `DELETE /workflows/{id}` | `n8n_delete_workflow` |
| `POST /workflows/{id}/{activate\|deactivate\|publish\|unpublish\|archive\|unarchive}` | `n8n_set_workflow_state` |
| `PUT /workflows/{id}/transfer` | `n8n_transfer_workflow` |
| `GET /workflows/{id}/history`, `GET /workflows/{id}/{versionId}` | `n8n_workflow_history` |
| `GET`/`PUT /workflows/{id}/tags` | `n8n_workflow_tags` |
| `GET /executions` | `n8n_list_executions` |
| `GET /executions/{id}` | `n8n_get_execution` |
| `DELETE /executions/{id}` | `n8n_delete_execution` |
| `POST /executions/{id}/retry` | `n8n_retry_execution` |
| `POST /executions/{id}/stop`, `POST /executions/stop` | `n8n_stop_executions` |
| `GET`/`PUT /executions/{id}/tags` | `n8n_execution_tags` |
| `GET /tags`, `GET /tags/{id}` | `n8n_list_tags` |
| `POST /tags` | `n8n_create_tag` |
| `PUT /tags/{id}` | `n8n_update_tag` |
| `DELETE /tags/{id}` | `n8n_delete_tag` |
| `GET /credentials`, `GET /credentials/{id}` | `n8n_list_credentials` |
| `POST /credentials` | `n8n_create_credential` |
| `PATCH /credentials/{id}` | `n8n_update_credential` |
| `DELETE /credentials/{id}` | `n8n_delete_credential` |
| `POST /credentials/{id}/test` | `n8n_test_credential` |
| `GET /credentials/schema/{type}` | `n8n_credential_schema` |
| `PUT /credentials/{id}/transfer` | `n8n_transfer_credential` |
| `GET /variables` | `n8n_list_variables` |
| `POST /variables`, `PUT /variables/{id}` | `n8n_set_variable` |
| `DELETE /variables/{id}` | `n8n_delete_variable` |
| `GET /users`, `GET /users/{id}` | `n8n_list_users` |
| `POST /users` | `n8n_invite_users` |
| `PATCH /users/{id}/role` | `n8n_set_user_role` |
| `DELETE /users/{id}` | `n8n_delete_user` |
| `GET /projects` | `n8n_list_projects` |
| `POST /projects` | `n8n_create_project` |
| `PUT /projects/{projectId}` | `n8n_update_project` |
| `DELETE /projects/{projectId}` | `n8n_delete_project` |
| `GET`/`POST /projects/{id}/users`, `PATCH`/`DELETE /projects/{id}/users/{userId}` | `n8n_project_users` |
| `GET /projects/{id}/folders`, `GET /projects/{id}/folders/{folderId}` | `n8n_list_folders` |
| `POST /projects/{id}/folders` | `n8n_create_folder` |
| `PATCH /projects/{id}/folders/{folderId}` | `n8n_update_folder` |
| `DELETE /projects/{id}/folders/{folderId}` | `n8n_delete_folder` |
| `GET /data-tables`, `GET /data-tables/{id}` | `n8n_list_data_tables` |
| `POST /data-tables` | `n8n_create_data_table` |
| `PATCH /data-tables/{id}` | `n8n_update_data_table` |
| `DELETE /data-tables/{id}` | `n8n_delete_data_table` |
| `GET`/`POST /data-tables/{id}/columns`, `PATCH`/`DELETE …/columns/{columnId}` | `n8n_data_table_columns` |
| `GET /data-tables/{id}/rows` | `n8n_get_data_table_rows` |
| `POST /data-tables/{id}/rows` | `n8n_insert_data_table_rows` |
| `PATCH …/rows/update`, `POST …/rows/upsert` | `n8n_update_data_table_rows` |
| `DELETE …/rows/delete`, `DELETE …/rows/clear` | `n8n_delete_data_table_rows` |
| `GET /workflows/{id}/test-runs`, `GET …/test-runs/{runId}`, `GET …/test-cases` | `n8n_list_test_runs` |
| `POST /workflows/{id}/test-runs` | `n8n_trigger_test_run` |
| `POST …/test-runs/{runId}/cancel` | `n8n_cancel_test_run` |
| `GET /community-packages` | `n8n_list_community_packages` |
| `POST`/`PATCH`/`DELETE /community-packages…` | `n8n_manage_community_package` |
| `POST /audit` | `n8n_generate_audit` |
| `GET /insights/summary` | `n8n_insights_summary` |
| `GET /discover` | `n8n_discover` |
| `POST /source-control/pull` | `n8n_source_control_pull` |
| `GET /settings/security-policy`, `GET /settings/otel`, `GET /settings/sso/saml`, `GET /settings/log-streaming/destinations(+/{id})`, `GET /settings/log-streaming/event-types` | `n8n_get_settings` |
| `PUT /settings/security-policy`, `PUT /settings/otel`, `PUT /settings/sso/saml` | `n8n_update_settings` |
| `POST /settings/otel/test-trace` | `n8n_test_otel_trace` |
| `POST`/`PUT`/`DELETE /settings/log-streaming/destinations…`, `POST …/{id}/test` | `n8n_log_streaming_destinations` |
| `POST /n8n-packages/export` | `n8n_export_package` |
| `POST /n8n-packages/import` | `n8n_import_package` |

## Notes

- `n8n_update_workflow` does a fetch-merge-PUT because n8n's `PUT /workflows/{id}` requires the full body — you can change just a name without resending nodes.
- Package export returns binary gzip, import is multipart — both handled via base64 through Node's built-in `fetch`/`FormData` (no module dependencies).
- Older n8n versions expose fewer endpoints; missing routes come back as clean 404 errors and everything else keeps working.
