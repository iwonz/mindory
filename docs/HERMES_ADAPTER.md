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
- `MindoryHermesRuntimeBridge`
- `buildMindoryHermesTools`
- `handleTurn`

The adapter remains runtime-agnostic and does not import a Hermes SDK. A Hermes
host should call these methods from its lifecycle hooks.

## Runtime Contract Fixture

`TASK-33` documents and verifies a local Hermes runtime contract fixture because
no Hermes SDK or generated Hermes hook definitions are vendored in this
repository as of 2026-05-21.

Contract source:

- `docs/PRD.md` section 21, "Hermes adapter MVP".
- This document's lifecycle method definitions.
- `tasks/TASK-33.json` acceptance criteria.
- Fixture file: `apps/adapters/hermes/fixtures/runtime-contract.json`.

The fixture mirrors the normalized host surface the adapter expects:

- `before_prompt`: Hermes has a project/user/agent/session identity and optional
  user query text; Mindory must ensure identity and build prompt context before
  model prompt construction.
- `after_response`: Hermes has the user text, optional assistant text and
  optional attachments; Mindory must upload attachments and save user/assistant
  turns through the HTTP API.
- `completed_turn`: a convenience hook for hosts that call one method after an
  answer is available; it performs context preparation then turn save.

`MindoryHermesRuntimeBridge` maps this normalized shape to
`MindoryHermesAdapter` methods. A real Hermes host should adapt its native hook
payloads into this contract rather than giving the adapter direct access to
Hermes internals.

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
client. `pnpm hermes:contract` validates the local Hermes runtime fixture over
the real `HermesMindoryApiClient` against a fake HTTP API: deterministic
identity mapping, context-before-save ordering, attachment upload, user and
assistant message persistence, later-session recall and optional tool recall.
Live API acceptance remains part of the end-to-end hardening task.

## Setup Notes

Configure these variables when a Hermes host loads the adapter:

```env
MINDORY_HERMES_ADAPTER_ENABLED=true
MINDORY_HERMES_API_URL=http://localhost:3000
MINDORY_HERMES_API_TOKEN=<bearer-token>
MINDORY_HERMES_DEFAULT_PROJECT=default
MINDORY_HERMES_DEFAULT_USER_PEER=default-user
MINDORY_HERMES_DEFAULT_AGENT_PEER=hermes
MINDORY_HERMES_CONTEXT_TOKEN_BUDGET=3000
```

Limitations:

- The adapter intentionally does not import a Hermes SDK.
- Attachment linking is currently represented in saved message metadata until a
  dedicated attachment linking API is added.
- Hermes host implementations must provide stable external session ids; empty
  session ids are rejected to avoid unstable recall.
