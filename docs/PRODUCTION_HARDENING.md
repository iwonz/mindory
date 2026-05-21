# Production Hardening

Mindory can run as a local MVP through Docker Compose, but non-demo use must
separate demo defaults from production operations. This document records the
minimum baseline for the MVP release path.

## CI Gate

Pull requests and pushes to `master` run `.github/workflows/ci.yml`. The job
uses Node.js 24, installs the locked pnpm dependency graph, verifies Docker
Compose is available and runs:

```bash
pnpm check
```

The default CI path must not require private provider credentials. Live external
embedding providers, hosted storage and real Hermes deployments are verified by
separate environment-specific checks.

## Release Images

Build release images from a verified `master` commit or signed release tag after
`pnpm check` passes.

```bash
export IMAGE=ghcr.io/<org>/mindory
export GIT_SHA=$(git rev-parse --short=12 HEAD)
docker build -t "$IMAGE:$GIT_SHA" .
docker tag "$IMAGE:$GIT_SHA" "$IMAGE:<semver>"
docker push "$IMAGE:$GIT_SHA"
docker push "$IMAGE:<semver>"
```

The Dockerfile installs with `pnpm install --frozen-lockfile` and runs
`pnpm typecheck`, so the image build is tied to the committed lockfile and
workspace TypeScript outputs.

## Migrations, Backup And Rollback

Run migrations as a deployment step before API and worker services accept
traffic. Docker Compose does this through the `migrate` service with
`pnpm db:migrate`.

Before applying migrations in production, create and verify a database backup:

```bash
pg_dump "$MINDORY_DATABASE_URL" > "mindory-before-$(date +%Y%m%d%H%M%S).sql"
```

The MVP uses forward migrations. If a migration or release must be rolled back,
stop API and worker traffic, restore the verified backup, redeploy the previous
known-good image and then run acceptance against that restored deployment.
Automated down migrations are deferred until the schema is managed by a release
process that can test both forward and backward paths.

Object storage is not part of PostgreSQL backup. Back up the configured local
filesystem volume or S3 bucket before migrations that change document metadata
or chunk/index expectations.

## Production Secret Handling

Never use `.env.example` values as production secrets. Put production values in
a secret manager or in deployment-scoped environment injection that is not
committed to git.

Required production overrides include:

- `MINDORY_DATABASE_URL`
- `MINDORY_REDIS_URL`
- `MINDORY_S3_ACCESS_KEY_ID` and `MINDORY_S3_SECRET_ACCESS_KEY` when S3 is used
- `MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY` or `MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN` when external LLM providers are used
- `MINDORY_MCP_API_TOKEN`
- `MINDORY_CLI_API_TOKEN`
- `MINDORY_HERMES_API_TOKEN`
- bearer tokens created through the token API or CLI
- bundled Postgres, MinIO and demo token defaults

Rotate API tokens through the token API or CLI. Raw tokens are returned once on
create or rotate, so store them immediately after issuance.

## Request Guards

The API enables an in-process rate limit by default:

```env
MINDORY_API_RATE_LIMIT_ENABLED=true
MINDORY_API_RATE_LIMIT_WINDOW_MS=60000
MINDORY_API_RATE_LIMIT_MAX=600
```

The guard exempts `/health` and `/ready`, keys authenticated requests by a
hashed authorization header and unauthenticated requests by client IP, and
returns structured `429 rate_limited` errors with `x-ratelimit-*` headers.

This is a baseline guard for one API process. Distributed rate limiting is
deferred for the MVP; production deployments should also enforce global limits,
TLS, upload body limits and trusted proxy headers at the reverse proxy or load
balancer.

## Observability

API logs use Fastify structured JSON output. Authorization headers are redacted,
and requests carry a generated or caller-provided request id. Worker and
processor logs should keep the same style. The production baseline depends on
structured logs rather than plain text output.

Operational diagnosis should include these fields where available:

- `request_id`
- `project_id`
- `document_id`
- `job_id`
- `session_id`
- `memory_id`

Expected API errors should log at info level. Rejected rate limit requests log
the key type and reset time without raw tokens. Worker failures should include
processor name, job type, retry attempt and failed status transition context.

Metrics, tracing, log aggregation and alerting are deferred to a later hardening
task, but the emitted logs must remain structured enough to support those
systems without rewriting runtime code.
