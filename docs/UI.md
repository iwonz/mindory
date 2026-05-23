# Web UI

`@mindory/ui` is the browser UI foundation for the Mindory local MVP. It is a
vanilla TypeScript workspace package and uses only the public HTTP API.

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

The foundation includes:

- API URL and bearer token entry;
- local browser storage for connection state;
- redacted token display;
- API health banner;
- project/session navigation;
- project peer count;
- selected session message list;
- loading, empty, `401`, `403` and generic error states.

The UI calls:

- `GET /health`
- `GET /v1/projects`
- `GET /v1/peers`
- `GET /v1/sessions`
- `GET /v1/sessions/:id/messages`

It does not access PostgreSQL, Redis, object storage, vector backends or worker
internals directly.

## Validation

Run:

```bash
pnpm ui:validate
```

`pnpm check` includes the same validation. The validator builds the UI, checks
workspace/typecheck registration, verifies the API client and connection states
and confirms the docs/config entries stay in sync.
