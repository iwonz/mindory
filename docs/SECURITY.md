# Security

Mindory MVP uses project-level authorization through access tokens. Tokens can
grant permissions across one or more projects.

`TASK-17` makes API runtime authorization active. Raw bearer tokens are never
stored by the API; the runtime hashes presented tokens with SHA-256 and compares
them with `access_tokens.token_hash`. Active, non-expired tokens receive their
project scopes from `access_token_project_scopes`. Protected routes return
`401` for missing or invalid bearer tokens and `403` when the token lacks the
required project permission.

## MVP Permissions

- `project:read`
- `session:read`
- `session:write`
- `message:read`
- `message:write`
- `document:read`
- `document:write`
- `document:search`
- `memory:read`
- `memory:write`
- `memory:delete`
- `context:build`

## Antivirus Policy

ClamAV support is required by the PRD. The recommended default mode is
`async_quarantine`, where uploads return quickly but read, extraction and
indexing are blocked until scanning is clean.

`TASK-8` adds the ClamAV adapter and document scan processor wrapper. The scanner
uses clamd `INSTREAM` so the daemon receives file contents over the socket
instead of requiring access to the local upload path. Live clamd execution is not
part of the scaffold validation.

Fine-grained document ACLs, enterprise audit logs and policy engines are not MVP
requirements.
