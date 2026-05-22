# Security

Mindory MVP uses project-level authorization through access tokens. Tokens can
grant permissions across one or more projects.

Public vulnerability reporting expectations live in the root `SECURITY.md`.

`TASK-17` makes API runtime authorization active. Raw bearer tokens are never
stored by the API; the runtime hashes presented tokens with SHA-256 and compares
them with `access_tokens.token_hash`. Active, non-expired tokens receive their
project scopes from `access_token_project_scopes`. Protected routes return
`401` for missing or invalid bearer tokens and `403` when the token lacks the
required project permission.

`TASK-29` adds token lifecycle operations through the API and CLI. Token create
and rotate responses return the raw token exactly once; list, revoke and rotate
metadata responses never expose raw token values or token hashes. Store the raw
token in a secret manager immediately after creation or rotation. Revoked tokens
remain in metadata for auditability but cannot authenticate.

## MVP Permissions

- `project:read`
- `token:read`
- `token:write`
- `session:read`
- `session:write`
- `message:read`
- `message:write`
- `document:read`
- `document:write`
- `document:search`
- `face:read`
- `face:write`
- `memory:read`
- `memory:write`
- `memory:delete`
- `context:build`

Token lifecycle endpoints are project-scoped. Listing tokens requires
`token:read`; create, rotate and revoke require `token:write` on the target
project. The deterministic demo seed grants these permissions to the demo token
so local acceptance and operational CLI flows can run without direct database
writes.

## Rate Limits

The API enables a lightweight in-process rate limit by default. Configure it
with:

```env
MINDORY_API_RATE_LIMIT_ENABLED=true
MINDORY_API_RATE_LIMIT_WINDOW_MS=60000
MINDORY_API_RATE_LIMIT_MAX=600
```

The guard exempts `/health` and `/ready`, hashes authorization headers before
using them as rate-limit keys, falls back to client IP for unauthenticated
requests and returns structured `429 rate_limited` responses with
`x-ratelimit-*` headers. Distributed rate limiting remains deferred for the MVP;
production deployments should enforce global limits and trusted proxy behavior
at the reverse proxy or load balancer.

## Production Secret Handling

Production deployments must override demo values from `.env.example`. Required
secret-bearing values include database and Redis URLs, S3 credentials when S3 is
used, model provider keys or OAuth bearer tokens, MCP/CLI/Hermes bearer tokens and
all access tokens issued by Mindory. Store them in a secret manager or
deployment secret store, not in git.

Token create and rotate responses expose raw tokens once. Capture those values
immediately, then rely on token metadata APIs for audit and lifecycle operations.
See `docs/PRODUCTION_HARDENING.md` for the release checklist.

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
