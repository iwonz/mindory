# Web UI

`@mindory/ui` is the browser UI for the Mindory local MVP. It is a vanilla
TypeScript workspace package and uses only the public HTTP API.

## Build And Run

Build the UI package:

```bash
pnpm --filter @mindory/ui build
```

Start the local static/proxy server:

```bash
pnpm --filter @mindory/ui start
```

Defaults:

- UI URL: `http://127.0.0.1:3080`
- API proxy: `/api`
- Upstream API: `http://localhost:3000`

The server reads:

- `MINDORY_UI_HOST`
- `MINDORY_UI_PORT`
- `MINDORY_UI_API_URL`

`MINDORY_UI_API_URL` is the upstream API used by the UI server proxy. Browser
requests go to `/api`, and the server forwards them to the configured Mindory
API. This keeps the local UI path usable without requiring browser CORS changes
in the API service.

## Current Surface

The UI includes:

- API URL and bearer token entry;
- local browser storage for connection state;
- redacted token display;
- API health banner;
- project/session navigation;
- project peer count;
- selected session message list;
- document upload;
- document list/detail;
- processing run list;
- document job progress;
- failed job retry;
- document reprocess request;
- derived artifact list with source refs;
- unified search with document/artifact/face targets;
- context preview;
- manual memory creation with source refs;
- source-backed memory search display;
- face identity list, rename, merge and observation display;
- runtime diagnostics for storage/vector/AV/model settings;
- provider health states;
- recent job status summary;
- metrics links;
- redacted installer/config summary;
- loading, empty, `401`, `403` and generic error states.

The UI calls:

- `GET /health`
- `GET /v1/projects`
- `GET /v1/peers`
- `GET /v1/sessions`
- `GET /v1/sessions/:id/messages`
- `POST /v1/documents`
- `GET /v1/documents`
- `GET /v1/documents/:id`
- `GET /v1/documents/:id/processing-runs`
- `GET /v1/documents/:id/artifacts`
- `POST /v1/documents/:id/recompute`
- `GET /v1/jobs`
- `POST /v1/jobs/:id/retry`
- `POST /v1/search`
- `POST /v1/context/build`
- `POST /v1/memories`
- `POST /v1/memories/search`
- `GET /v1/faces/identities`
- `GET /v1/faces/observations`
- `PATCH /v1/faces/identities/:id`
- `POST /v1/faces/identities/:id/merge`
- `GET /v1/runtime/diagnostics`
- `GET /v1/jobs`

It does not access PostgreSQL, Redis, object storage, vector backends or worker
internals directly.

## Validation

Run:

```bash
pnpm ui:validate
pnpm ui:documents:validate
pnpm ui:insights:validate
pnpm ui:diagnostics:validate
```

`pnpm check` includes these validators. The validators build the UI, check
workspace/typecheck registration, verify the API client, document pipeline
workspace, search/context/memory/faces workspace, runtime diagnostics workspace,
connection states and confirm the docs/config entries stay in sync.
