# Hermes Adapter

The Hermes adapter is the MVP deep runtime adapter. It must be separate from the
API and call Mindory through HTTP.

## Responsibilities

- Initialize from configuration.
- Map Hermes users, agents and sessions to Mindory projects, peers and sessions.
- Call context build before prompt construction.
- Inject returned context into Hermes prompts.
- Save user and assistant turns.
- Upload attachments when Hermes exposes them.

The adapter must preserve stable external identity mappings and must not collapse
different external users into one peer unless explicitly configured.

## Current Runtime Boundary

`TASK-13` adds the adapter boundary and `TASK-25` wires it into the real Mindory
HTTP runtime surface. `@mindory/adapter-hermes` now exposes:

- `MindoryHermesAdapter`
- `buildMindoryHermesAdapter`
- `HermesMindoryApiClient`
- `mapHermesIdentity`
- `buildMindoryHermesTools`
- `handleTurn`

The adapter remains runtime-agnostic and does not import a Hermes SDK. A Hermes
host should call these methods from its lifecycle hooks.

## Identity Mapping

External identities are mapped into stable Mindory ids:

```text
external_user_id -> user peer id
external_session_id -> session id
agent_id -> agent peer id
```

`externalSessionId` is required. `externalUserId` and `agentId` are used when
provided; otherwise the configured default peer ids are used.

## Lifecycle Methods

- `preparePromptContext` ensures project/peer/session records through HTTP,
  calls `/v1/context/build` and returns prompt-ready context text.
- `handleTurn` builds context before the model call surface, then saves the user
  and assistant turn after the host has a response.
- `saveTurn` saves user and assistant messages through session message HTTP
  paths and uploads attachments when provided. Uploaded attachment responses and
  Hermes attachment ids are preserved in user-message metadata until a dedicated
  attachment linking API is added.
- Optional `memor_recall`, `memor_remember`, `memor_document_search`,
  `memor_document_read` and `memor_explain` tools call memory/document HTTP API
  paths after ensuring project/peer/session identity.

The adapter calls only implemented MVP HTTP route surfaces for project, peer,
session, message, document upload, memory, document search and context build.
`pnpm hermes:smoke` validates the lifecycle order with an injectable HTTP
client; live API acceptance remains part of the end-to-end hardening task.
