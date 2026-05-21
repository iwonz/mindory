# Mindory Agent Instructions

Mindory is developed through the Mindory Ralph-cycle. This file is mandatory
operating guidance for Codex and any coding agent or contributor working in this
repository.

## Required Startup Checklist

Before making any change:

1. Read `PRD.md`, which points to the canonical `docs/PRD.md`.
2. Read `tasks/tasks.json`.
3. Read the current task file named by `current_task_id`.
4. Confirm the requested change is inside the current task scope.
5. Check task-specific and global acceptance criteria.

## Task Rules

- No task means no code, documentation, configuration, schema or behavior change.
- Task IDs use the `TASK-<number>` format, for example `TASK-1`.
- Every task must have a dedicated `tasks/{TASK_ID}.json` file.
- Every new task starts from a clean, green `master`.
- One branch maps to one task and must include the full task ID.
- Do not start a new task from another task branch.
- Preferred commit format is `type(TASK-1): concise description`.
- After task acceptance and verification, merge the task branch back into
  `master` before starting the next task.
- `master` is the only long-lived branch and must stay green.
- Do not include unrelated changes in a task.

## Documentation and Configuration

- Documentation is part of the product and must remain current.
- Update the relevant `docs/` file whenever behavior, architecture, API, config,
  schema, workers, MCP tools, CLI commands or adapters change.
- Keep documentation concise and non-duplicative.
- Update `.env.example` and `docs/CONFIGURATION.md` whenever environment
  variables are added, renamed or removed.
- Never commit real secrets.

## Architecture Principles

- API is stateless.
- PostgreSQL is the source of truth.
- Redis/BullMQ is queue/cache, not durable business state.
- Object storage stores original files.
- Vector index is replaceable.
- Workers perform heavy async processing.
- MCP is an interface, not the core.
- CLI uses HTTP API, not direct DB access.
- Hermes adapter is separate from API.

## Engineering Guidance

- Preserve package and app boundaries from the PRD.
- Prefer mature libraries and framework capabilities over unnecessary custom code.
- Avoid duplicate logic and duplicate docs.
- Keep changes scoped to the current task.
- Include migrations when schema changes.
- Include relevant tests, typecheck and lint for implementation tasks.
- Before finishing, verify every acceptance criterion in the current task file.
