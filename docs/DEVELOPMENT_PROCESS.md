# Development Process

Mindory uses the Mindory Ralph-cycle: every change is tied to a task before any
code, documentation, configuration, schema or behavior is changed.

## Required Flow

1. Read `PRD.md`, then `docs/PRD.md`.
2. Read `tasks/tasks.json`.
3. Read the current task file from `current_task_id`.
4. Confirm the change is in scope.
5. Start from a clean, green `master`.
6. Create a dedicated task branch from `master`.
7. Make only task-scoped changes.
8. Update docs and `.env.example` when relevant.
9. Run applicable verification.
10. Commit the task as a single honest task commit when practical.
11. Update task status after acceptance.
12. Merge the task branch back into `master` after acceptance.

## Task IDs

Task IDs use the `TASK-<number>` format, with no leading zeroes.

Examples:

```text
TASK-1
TASK-2
TASK-13
```

## Branches and Commits

`master` is the only long-lived branch. Task branches include the full task ID.
Every new task must branch from the current `master`; do not start a new task
from a previous task branch. After acceptance and verification, the task branch
is merged back into `master`, and the next task starts from that updated
`master`.

Each task should be represented by one clear task commit when practical. If a
task requires multiple commits during development, squash or otherwise present a
clean task-level commit before merge unless preserving the intermediate commits
has explicit review value.

Examples:

```text
task/TASK-1-bootstrap-repository-operating-model
task/TASK-2-bootstrap-pnpm-monorepo
fix/TASK-10-fix-document-status-transition
```

Preferred commit format:

```text
chore(TASK-1): bootstrap repository operating model
feat(TASK-4): add document upload API
fix(TASK-10): fix document status transition
```

## Quality Gates

Every task must satisfy its task-specific acceptance criteria and the global
criteria in `tasks/tasks.json`. Implementation tasks should include relevant
lint, typecheck, tests and migrations.

## Integration Tests

`TASK-30` replaces the placeholder test script with a real MVP integration
suite. `pnpm test` starts the isolated `mindory-test` Docker Compose project
with PostgreSQL and Redis, applies migrations, starts API and worker runtimes
in-process and verifies auth, document upload/chunking, jobs and context build.

Default test ports:

```text
PostgreSQL: localhost:55432
Redis:      localhost:56379
```

Use `MINDORY_TEST_POSTGRES_PORT`, `MINDORY_TEST_REDIS_PORT`,
`MINDORY_TEST_DATABASE_URL` and `MINDORY_TEST_REDIS_URL` to override local
connection settings. Use `MINDORY_TEST_SKIP_DOCKER=true` only when equivalent
PostgreSQL and Redis services are already running.

## Repository Scripts

`TASK-2` adds the baseline script contract:

```bash
pnpm check
pnpm lint
pnpm typecheck
pnpm test
pnpm tasks:validate
pnpm workspace:validate
pnpm db:validate
pnpm db:repositories:validate
pnpm api:validate
pnpm api:runtime:validate
pnpm storage:validate
pnpm queue:validate
pnpm documents:validate
pnpm processing:validate
pnpm memory:validate
pnpm mcp:validate
pnpm cli:validate
pnpm hermes:validate
pnpm production:validate
```

The scripts are implemented with Node-based validation during bootstrap so the
repository can be checked before runtime dependencies are introduced. Once
dependencies are installed, `typecheck` will use the local TypeScript compiler.

Drizzle migration generation and migration application are exposed as
`pnpm db:generate` and `pnpm db:migrate` after pnpm dependencies are installed.
