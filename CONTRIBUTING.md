# Contributing To Mindory

Mindory is built through the Mindory Ralph-cycle described in `AGENTS.md` and
`docs/DEVELOPMENT_PROCESS.md`. Contributions should keep the repository
runnable, documented and honest about supported versus experimental behavior.

## Before You Start

- Read `PRD.md`, `tasks/tasks.json` and the current task file.
- Confirm the change is covered by an existing `TASK-<number>` file.
- Start from a clean `master` branch.
- Create a dedicated branch that includes the task id, for example
  `task/TASK-70-public-github-hygiene`.
- Keep one task to one coherent commit before merge.

No task means no code, documentation, configuration, schema or behavior change.

## Development Setup

Requirements:

- Node.js 22 or newer.
- pnpm 10 or newer.
- Docker and Docker Compose for integration tests and local demo flows.

Install dependencies:

```bash
corepack enable
pnpm install --frozen-lockfile
```

Run the default verification gate:

```bash
pnpm check
```

For a local demo:

```bash
pnpm mvp:demo
```

## Pull Request Expectations

Pull requests should include:

- the task id in the branch name, commit message and PR title;
- a short summary of the behavior, docs or configuration changed;
- verification commands run locally, especially `pnpm check`;
- relevant documentation updates under `docs/`;
- `.env.example` and `docs/CONFIGURATION.md` updates when configuration changes;
- migrations when database schema changes;
- no committed secrets, local data directories, generated release bundles or
  unrelated formatting churn.

Preferred commit format:

```text
type(TASK-70): concise description
```

Use `fix`, `feat`, `docs`, `chore` or another conventional type that matches
the task.

## Support Levels

Public wording must match `docs/SUPPORT_MATRIX.md`:

- `supported`: expected to work in the documented local MVP path;
- `experimental`: available for testing with clear limits;
- `placeholder` or `profile-smoke`: intentionally not a production feature;
- `future`: planned but not implemented.

Do not describe future or placeholder functionality as supported.

## Security

Do not open public issues for vulnerabilities. Follow `SECURITY.md`.

Never commit real secrets. Generated credentials belong under `MINDORY_HOME`,
not in the repository.
