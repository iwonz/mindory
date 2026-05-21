# LLM Adapter

`@mindory/llm` is the single runtime entrypoint for Mindory subsystems that need
LLM-backed capabilities. Current runtime use is embeddings for document indexing
and query-time semantic search. Future chat/generation features should extend
this module instead of constructing provider SDKs directly inside API, worker,
MCP, CLI or adapter code.

## Providers

`MINDORY_LLM_PROVIDER` accepts:

- `disabled`
- `openai-compatible`
- `ollama`

Disabled mode is the default local path. Documents process to `chunked` and
search uses text fallback. OpenAI-compatible and Ollama modes enable embeddings
for worker indexing and API query search through the shared adapter.

## Configuration

```env
MINDORY_LLM_PROVIDER=disabled
MINDORY_LLM_EMBEDDING_MODEL=
MINDORY_LLM_CHAT_MODEL=
MINDORY_LLM_EMBEDDING_DIMENSIONS=
MINDORY_LLM_OPENAI_COMPATIBLE_BASE_URL=
MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE=none
MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY=
MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN=
MINDORY_LLM_OLLAMA_BASE_URL=http://ollama:11434
```

`MINDORY_LLM_CHAT_MODEL` is reserved for future generation flows. It is kept in
the same component so subsystems do not introduce separate provider config.

## OpenAI-Compatible Auth

`MINDORY_LLM_OPENAI_COMPATIBLE_AUTH_MODE` accepts:

- `none` for local fake or unauthenticated OpenAI-compatible endpoints.
- `api-key` with `MINDORY_LLM_OPENAI_COMPATIBLE_API_KEY`.
- `oauth-bearer` with `MINDORY_LLM_OPENAI_OAUTH_ACCESS_TOKEN`.

The OAuth mode expects the host runtime to supply an already-issued bearer
access token, for example from a Codex or Hermes integration. Mindory does not
run an interactive OAuth login flow in the MVP; it only consumes the supplied
token through the shared adapter and sends it as `Authorization: Bearer ...`.

## Runtime Boundary

API and worker code call `buildMindoryEmbeddingsProvider` or
`buildMindoryLlmRuntime` from `@mindory/llm`. Provider-specific packages remain
low-level adapters, but runtime packages must not instantiate them directly.

This keeps provider selection, token handling and model naming in one module,
so future subsystems can share the same configuration and auth behavior.
