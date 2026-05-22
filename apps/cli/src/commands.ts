import { createHash } from "node:crypto";
import { loadMindoryConfig, type EnvSource } from "@mindory/config";
import { buildMindoryLlm, type LlmGeneratedMediaOutput, type LlmOperationAudit, type LlmOperationResult, type LlmRole } from "@mindory/llm";
import { readBooleanFlag, readFlag, readFlagValues, type ParsedCliArgs } from "./args.js";
import { MindoryCliApiClient, queryString } from "./http-client.js";

export interface CliCommandContext {
  api: MindoryCliApiClient;
  env?: EnvSource;
}

export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

export async function dispatchCliCommand(parsed: ParsedCliArgs, context: CliCommandContext): Promise<unknown> {
  const [area, action, ...args] = parsed.positionals;
  if (!area || readBooleanFlag(parsed.flags, "help")) {
    return helpText();
  }

  switch (`${area}:${action ?? ""}`) {
    case "project:create":
      return createProject(args, parsed, context);
    case "project:get":
      return context.api.getJson(`/v1/projects/${encodeURIComponent(requiredArg(args, 0, "project id"))}`);
    case "project:list":
      return context.api.getJson("/v1/projects");
    case "token:create":
      return createToken(parsed, context);
    case "token:list":
      return context.api.getJson(`/v1/tokens?${queryString({
        projectId: requiredFlag(parsed, "project"),
        limit: readPositiveIntegerFlag(parsed, "limit")
      })}`);
    case "token:revoke":
      return context.api.postJson(`/v1/tokens/${encodeURIComponent(requiredArg(args, 0, "token id"))}/revoke`, {
        projectId: requiredFlag(parsed, "project")
      });
    case "token:rotate":
      return rotateToken(args, parsed, context);
    case "session:create":
      return createSession(parsed, context);
    case "session:get":
      return context.api.getJson(`/v1/sessions/${encodeURIComponent(requiredArg(args, 0, "session id"))}?${projectQuery(parsed)}`);
    case "session:list":
      return context.api.getJson(`/v1/sessions?${queryString({
        projectId: requiredFlag(parsed, "project"),
        limit: readPositiveIntegerFlag(parsed, "limit")
      })}`);
    case "message:add":
      return addMessage(parsed, context);
    case "message:list":
      return context.api.getJson(`/v1/sessions/${encodeURIComponent(requiredFlag(parsed, "session"))}/messages?${queryString({
        projectId: requiredFlag(parsed, "project"),
        limit: readPositiveIntegerFlag(parsed, "limit")
      })}`);
    case "document:upload":
      return uploadDocument(args, parsed, context);
    case "document:status":
      return context.api.getJson(`/v1/documents/${encodeURIComponent(requiredArg(args, 0, "document id"))}/status?${projectQuery(parsed)}`);
    case "document:reprocess":
    case "document:recompute":
      return reprocessDocument(args, parsed, context);
    case "document:runs":
      return context.api.getJson(`/v1/documents/${encodeURIComponent(requiredArg(args, 0, "document id"))}/processing-runs?${projectQuery(parsed)}`);
    case "document:search":
      return searchDocuments(args, parsed, context);
    case "document:read":
      return context.api.getJson(`/v1/documents/${encodeURIComponent(requiredArg(args, 0, "document id"))}?${projectQuery(parsed)}`);
    case "document:list":
      return context.api.getJson(`/v1/documents?${queryString({
        projectId: requiredFlag(parsed, "project"),
        status: readFlag(parsed.flags, "status"),
        limit: readPositiveIntegerFlag(parsed, "limit")
      })}`);
    case "artifact:search":
      return searchArtifacts(args, parsed, context);
    case "search:query":
      return searchUnified(args, parsed, context);
    case "face:identities":
      return context.api.getJson(`/v1/faces/identities?${queryString({
        projectId: requiredFlag(parsed, "project"),
        status: readFlag(parsed.flags, "status"),
        limit: readPositiveIntegerFlag(parsed, "limit")
      })}`);
    case "face:identity":
      return context.api.getJson(`/v1/faces/identities/${encodeURIComponent(requiredArg(args, 0, "face identity id"))}?${projectQuery(parsed)}`);
    case "face:observations":
      return context.api.getJson(`/v1/faces/observations?${queryString({
        projectId: requiredFlag(parsed, "project"),
        identityId: readFlag(parsed.flags, "identity"),
        documentId: readFlag(parsed.flags, "document"),
        limit: readPositiveIntegerFlag(parsed, "limit")
      })}`);
    case "face:rename":
      return context.api.patchJson(`/v1/faces/identities/${encodeURIComponent(requiredArg(args, 0, "face identity id"))}`, {
        projectId: requiredFlag(parsed, "project"),
        label: readNullableLabel(parsed)
      });
    case "face:merge":
      return context.api.postJson(`/v1/faces/identities/${encodeURIComponent(requiredArg(args, 0, "source face identity id"))}/merge`, {
        projectId: requiredFlag(parsed, "project"),
        targetIdentityId: requiredFlag(parsed, "target")
      });
    case "memory:remember":
      return rememberMemory(args, parsed, context);
    case "memory:recall":
      return recallMemory(args, parsed, context);
    case "memory:explain":
      return context.api.postJson(`/v1/memories/${encodeURIComponent(requiredArg(args, 0, "memory id"))}/explain`, {
        projectId: requiredFlag(parsed, "project")
      });
    case "memory:forget":
      return context.api.deleteJson(`/v1/memories/${encodeURIComponent(requiredArg(args, 0, "memory id"))}?${projectQuery(parsed)}`);
    case "memory:list":
      return context.api.postJson("/v1/memories/search", {
        projectIds: readProjectIds(parsed),
        statuses: optionalCsvFlag(parsed, "status"),
        types: optionalCsvFlag(parsed, "type"),
        limit: readPositiveIntegerFlag(parsed, "limit") ?? 20
      });
    case "context:build":
      return buildContext(args, parsed, context);
    case "jobs:list":
      return context.api.getJson(`/v1/jobs?${queryString({
        projectId: requiredFlag(parsed, "project"),
        status: readFlag(parsed.flags, "status"),
        type: readFlag(parsed.flags, "type"),
        limit: readPositiveIntegerFlag(parsed, "limit")
      })}`);
    case "jobs:get":
      return context.api.getJson(`/v1/jobs/${encodeURIComponent(requiredArg(args, 0, "job id"))}?${projectQuery(parsed)}`);
    case "jobs:retry":
      return context.api.postJson(`/v1/jobs/${encodeURIComponent(requiredArg(args, 0, "job id"))}/retry`, {
        projectId: requiredFlag(parsed, "project")
      });
    case "llm:generate-image":
      return generateMedia(args, parsed, context, "image-generation");
    case "llm:generate-audio":
      return generateMedia(args, parsed, context, "audio-generation");
    default:
      throw new CliError(`Unknown command: ${parsed.positionals.join(" ") || "(empty)"}\n\n${helpText()}`, 2);
  }
}

export function helpText(): string {
  return [
    "Mindory CLI",
    "",
    "Usage:",
    "  mindory project create <id> [--name <name>] [--description <text>]",
    "  mindory project get <id>",
    "  mindory project list",
    "  mindory token create --project <id> --permissions <csv> [--name <name>]",
    "  mindory token list --project <id> [--limit 20]",
    "  mindory token revoke <id> --project <id>",
    "  mindory token rotate <id> --project <id> [--expires-at <iso|null>]",
    "  mindory session create --project <id> [--title <text>] [--peer <id>]",
    "  mindory session get <id> --project <id>",
    "  mindory session list --project <id> [--limit 20]",
    "  mindory message add --session <id> --project <id> --peer <id> --text <text> [--role user]",
    "  mindory message list --session <id> --project <id> [--limit 50]",
    "  mindory document upload <path> --project <id> [--mime-type <type>] [--title <text>]",
    "  mindory document status <id> --project <id>",
    "  mindory document reprocess <id> --project <id> [--stages text,pdf,image,audio,video]",
    "  mindory document runs <id> --project <id>",
    "  mindory document search --project <id> <query> [--limit 10] [--metadata-filter <json>]",
    "  mindory document read <id> --project <id>",
    "  mindory document list --project <id> [--status <status>] [--limit 20]",
    "  mindory artifact search --project <id> <query> [--artifact-type <csv>] [--span-type <csv>] [--metadata-filter <json>]",
    "  mindory search query --project <id> [query] [--target documents,artifacts,faces] [--artifact-type <csv>] [--span-type <csv>] [--metadata-filter <json>] [--face-status <csv>]",
    "  mindory face identities --project <id> [--status candidate] [--limit 20]",
    "  mindory face identity <id> --project <id>",
    "  mindory face observations --project <id> [--identity <id>] [--document <id>]",
    "  mindory face rename <id> --project <id> --label <text|null>",
    "  mindory face merge <source-id> --project <id> --target <target-id>",
    "  mindory memory remember --project <id> --source-ref <type:id> <text>",
    "  mindory memory recall --project <id> <query> [--limit 10]",
    "  mindory memory explain <id> --project <id>",
    "  mindory memory forget <id> --project <id>",
    "  mindory memory list --project <id> [--status active] [--limit 20]",
    "  mindory context build --project <id> [--session <id>] [--token-budget 3000] <query>",
    "  mindory jobs list --project <id> [--status <status>] [--limit 20]",
    "  mindory jobs get <id> --project <id>",
    "  mindory jobs retry <id> --project <id>",
    "  mindory llm generate-image <prompt> [--include-bytes]",
    "  mindory llm generate-audio <prompt> [--include-bytes]",
    "",
    "Global flags:",
    "  --api-url <url>     Override MINDORY_CLI_API_URL.",
    "  --token <token>     Override MINDORY_CLI_API_TOKEN.",
    "  --help              Show this help."
  ].join("\n");
}

function createProject(args: string[], parsed: ParsedCliArgs, context: CliCommandContext): Promise<unknown> {
  const id = requiredArg(args, 0, "project id");
  return context.api.postJson("/v1/projects", {
    id,
    name: readFlag(parsed.flags, "name") ?? id,
    description: readFlag(parsed.flags, "description"),
    metadata: readJsonFlag(parsed, "metadata")
  });
}

function createToken(parsed: ParsedCliArgs, context: CliCommandContext): Promise<unknown> {
  return context.api.postJson("/v1/tokens", {
    projectId: requiredFlag(parsed, "project"),
    name: readFlag(parsed.flags, "name") ?? "cli-token",
    permissions: requiredCsvFlag(parsed, "permissions"),
    expiresAt: readFlag(parsed.flags, "expires-at")
  });
}

function rotateToken(args: string[], parsed: ParsedCliArgs, context: CliCommandContext): Promise<unknown> {
  const body: Record<string, unknown> = {
    projectId: requiredFlag(parsed, "project")
  };
  const expiresAt = readFlag(parsed.flags, "expires-at");
  if (expiresAt !== undefined) {
    body.expiresAt = expiresAt === "null" ? null : expiresAt;
  }

  return context.api.postJson(`/v1/tokens/${encodeURIComponent(requiredArg(args, 0, "token id"))}/rotate`, body);
}

function createSession(parsed: ParsedCliArgs, context: CliCommandContext): Promise<unknown> {
  return context.api.postJson("/v1/sessions", {
    projectId: requiredFlag(parsed, "project"),
    title: readFlag(parsed.flags, "title"),
    peerIds: readFlagValues(parsed.flags, "peer"),
    metadata: readJsonFlag(parsed, "metadata")
  });
}

function addMessage(parsed: ParsedCliArgs, context: CliCommandContext): Promise<unknown> {
  const sessionId = requiredFlag(parsed, "session");
  return context.api.postJson(`/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
    projectId: requiredFlag(parsed, "project"),
    authorPeerId: requiredFlag(parsed, "peer"),
    role: readFlag(parsed.flags, "role") ?? "user",
    content: requiredFlag(parsed, "text"),
    metadata: readJsonFlag(parsed, "metadata")
  });
}

function uploadDocument(args: string[], parsed: ParsedCliArgs, context: CliCommandContext): Promise<unknown> {
  const mimeType = readFlag(parsed.flags, "mime-type");
  const title = readFlag(parsed.flags, "title");
  return context.api.uploadDocument({
    projectId: requiredFlag(parsed, "project"),
    filePath: requiredArg(args, 0, "document path"),
    ...(mimeType ? { mimeType } : {}),
    ...(title ? { title } : {})
  });
}

function reprocessDocument(args: string[], parsed: ParsedCliArgs, context: CliCommandContext): Promise<unknown> {
  return context.api.postJson(`/v1/documents/${encodeURIComponent(requiredArg(args, 0, "document id"))}/recompute`, {
    projectId: requiredFlag(parsed, "project"),
    stages: optionalCsvFlag(parsed, "stages"),
    reason: readFlag(parsed.flags, "reason"),
    requestId: readFlag(parsed.flags, "request-id")
  });
}

function searchDocuments(args: string[], parsed: ParsedCliArgs, context: CliCommandContext): Promise<unknown> {
  return context.api.postJson("/v1/documents/search", {
    projectIds: readProjectIds(parsed),
    query: requiredQuery(args),
    limit: readPositiveIntegerFlag(parsed, "limit") ?? 10,
    metadataFilters: readMetadataFilters(parsed)
  });
}

function searchArtifacts(args: string[], parsed: ParsedCliArgs, context: CliCommandContext): Promise<unknown> {
  return context.api.postJson("/v1/artifacts/search", {
    projectIds: readProjectIds(parsed),
    query: requiredQuery(args),
    artifactTypes: optionalCsvFlag(parsed, "artifact-type"),
    spanTypes: optionalCsvFlag(parsed, "span-type"),
    metadataFilters: readMetadataFilters(parsed),
    limit: readPositiveIntegerFlag(parsed, "limit") ?? 10
  });
}

function searchUnified(args: string[], parsed: ParsedCliArgs, context: CliCommandContext): Promise<unknown> {
  const body: Record<string, unknown> = {
    projectIds: readProjectIds(parsed),
    targets: optionalCsvFlag(parsed, "target"),
    artifactTypes: optionalCsvFlag(parsed, "artifact-type"),
    spanTypes: optionalCsvFlag(parsed, "span-type"),
    faceIdentityStatuses: optionalCsvFlag(parsed, "face-status"),
    metadataFilters: readMetadataFilters(parsed),
    limit: readPositiveIntegerFlag(parsed, "limit") ?? 10
  };
  const query = optionalQuery(args);
  if (query !== undefined) {
    body.query = query;
  }
  return context.api.postJson("/v1/search", body);
}

function rememberMemory(args: string[], parsed: ParsedCliArgs, context: CliCommandContext): Promise<unknown> {
  return context.api.postJson("/v1/memories", {
    projectId: requiredFlag(parsed, "project"),
    type: readFlag(parsed.flags, "type") ?? "semantic",
    text: requiredQuery(args),
    status: readFlag(parsed.flags, "status") ?? "active",
    importance: readNumberFlag(parsed, "importance"),
    confidence: readNumberFlag(parsed, "confidence"),
    sourceRefs: readSourceRefs(parsed),
    metadata: readJsonFlag(parsed, "metadata")
  });
}

function recallMemory(args: string[], parsed: ParsedCliArgs, context: CliCommandContext): Promise<unknown> {
  return context.api.postJson("/v1/memories/search", {
    projectIds: readProjectIds(parsed),
    query: requiredQuery(args),
    statuses: optionalCsvFlag(parsed, "status"),
    types: optionalCsvFlag(parsed, "type"),
    limit: readPositiveIntegerFlag(parsed, "limit") ?? 10
  });
}

function buildContext(args: string[], parsed: ParsedCliArgs, context: CliCommandContext): Promise<unknown> {
  return context.api.postJson("/v1/context/build", {
    projectIds: readProjectIds(parsed),
    sessionId: readFlag(parsed.flags, "session"),
    query: args.join(" "),
    tokenBudget: readPositiveIntegerFlag(parsed, "token-budget") ?? 3000,
    include: readJsonFlag(parsed, "include")
  });
}

async function generateMedia(
  args: string[],
  parsed: ParsedCliArgs,
  context: CliCommandContext,
  roleName: Extract<LlmRole, "image-generation" | "audio-generation">
): Promise<unknown> {
  const audits: LlmOperationAudit[] = [];
  const runtime = buildMindoryLlm(loadMindoryConfig(context.env), {
    auditSink: (audit) => {
      audits.push(audit);
    }
  });
  const role = runtime.registry.require(roleName);
  const refs = llmRefs(parsed);
  const result = runtime.generation === undefined
    ? runtime.disabledResult<LlmGeneratedMediaOutput>(roleName, refs)
    : roleName === "image-generation"
      ? await runtime.generation.generateImage({ prompt: requiredQuery(args) }, { role, refs })
      : await runtime.generation.generateAudio({ prompt: requiredQuery(args) }, { role, refs });
  const summary = generationResultSummary(result, readBooleanFlag(parsed.flags, "include-bytes"));
  if (audits.length > 0) {
    summary.audits = audits;
  } else {
    summary.audits = [result.audit];
  }
  return summary;
}

function generationResultSummary(
  result: LlmOperationResult<LlmGeneratedMediaOutput>,
  includeBytes: boolean
): Record<string, unknown> {
  const summary: Record<string, unknown> = {
    status: result.status,
    audit: result.audit
  };
  if (result.value === undefined) {
    return summary;
  }
  summary.mimeType = result.value.mimeType;
  summary.byteLength = result.value.bytes.length;
  summary.sha256 = createHash("sha256").update(result.value.bytes).digest("hex");
  if (result.value.metadata !== undefined) {
    summary.metadata = result.value.metadata;
  }
  if (includeBytes) {
    summary.dataBase64 = Buffer.from(result.value.bytes).toString("base64");
  }
  return summary;
}

function llmRefs(parsed: ParsedCliArgs): Record<string, string> {
  const refs: Record<string, string> = {};
  for (const [flag, key] of [
    ["project", "projectId"],
    ["document", "documentId"],
    ["job", "jobId"],
    ["session", "sessionId"],
    ["message", "messageId"]
  ] as const) {
    const value = readFlag(parsed.flags, flag);
    if (value !== undefined) {
      refs[key] = value;
    }
  }
  return refs;
}

function requiredArg(args: string[], index: number, label: string): string {
  const value = args[index];
  if (!value) {
    throw new CliError(`${label} is required.`, 2);
  }
  return value;
}

function requiredFlag(parsed: ParsedCliArgs, name: string): string {
  const value = readFlag(parsed.flags, name);
  if (!value) {
    throw new CliError(`--${name} is required.`, 2);
  }
  return value;
}

function requiredQuery(args: string[]): string {
  const query = args.join(" ").trim();
  if (!query) {
    throw new CliError("query/text argument is required.", 2);
  }
  return query;
}

function optionalQuery(args: string[]): string | undefined {
  const query = args.join(" ").trim();
  return query.length > 0 ? query : undefined;
}

function readProjectIds(parsed: ParsedCliArgs): string[] {
  const projects = readFlag(parsed.flags, "projects") ?? readFlag(parsed.flags, "project");
  if (!projects) {
    throw new CliError("--project or --projects is required.", 2);
  }
  const projectIds = projects.split(",").map((project) => project.trim()).filter(Boolean);
  if (projectIds.length === 0) {
    throw new CliError("--project or --projects must include at least one project id.", 2);
  }
  return projectIds;
}

function readSourceRefs(parsed: ParsedCliArgs): Array<{ type: string; id: string }> {
  const values = readFlagValues(parsed.flags, "source-ref");
  if (values.length === 0) {
    throw new CliError("--source-ref <type:id> is required for memory remember.", 2);
  }

  return values.map((value) => {
    const [type, ...idParts] = value.split(":");
    const id = idParts.join(":");
    if (!type || !id) {
      throw new CliError(`Invalid --source-ref value: ${value}. Expected type:id.`, 2);
    }
    return { type, id };
  });
}

function requiredCsvFlag(parsed: ParsedCliArgs, name: string): string[] {
  const values = readCsvFlag(parsed, name);
  if (values.length === 0) {
    throw new CliError(`--${name} is required.`, 2);
  }
  return values;
}

function readCsvFlag(parsed: ParsedCliArgs, name: string): string[] {
  const value = readFlag(parsed.flags, name);
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function optionalCsvFlag(parsed: ParsedCliArgs, name: string): string[] | undefined {
  const values = readCsvFlag(parsed, name);
  return values.length > 0 ? values : undefined;
}

function readNumberFlag(parsed: ParsedCliArgs, name: string): number | undefined {
  const value = readFlag(parsed.flags, name);
  if (!value) {
    return undefined;
  }
  const parsedValue = Number(value);
  if (!Number.isFinite(parsedValue)) {
    throw new CliError(`--${name} must be a number.`, 2);
  }
  return parsedValue;
}

function readPositiveIntegerFlag(parsed: ParsedCliArgs, name: string): number | undefined {
  const value = readNumberFlag(parsed, name);
  if (value === undefined) {
    return undefined;
  }
  if (!Number.isInteger(value) || value <= 0) {
    throw new CliError(`--${name} must be a positive integer.`, 2);
  }
  return value;
}

function readJsonFlag(parsed: ParsedCliArgs, name: string): Record<string, unknown> | undefined {
  const value = readFlag(parsed.flags, name);
  if (!value) {
    return undefined;
  }
  const parsedValue = JSON.parse(value) as unknown;
  if (typeof parsedValue !== "object" || parsedValue === null || Array.isArray(parsedValue)) {
    throw new CliError(`--${name} must be a JSON object.`, 2);
  }
  return parsedValue as Record<string, unknown>;
}

function readMetadataFilters(parsed: ParsedCliArgs): Record<string, unknown>[] | undefined {
  const values = readFlagValues(parsed.flags, "metadata-filter");
  if (values.length === 0) {
    return undefined;
  }
  return values.map((value) => {
    const parsedValue = JSON.parse(value) as unknown;
    if (typeof parsedValue !== "object" || parsedValue === null || Array.isArray(parsedValue)) {
      throw new CliError("--metadata-filter must be a JSON object.", 2);
    }
    return parsedValue as Record<string, unknown>;
  });
}

function readNullableLabel(parsed: ParsedCliArgs): string | null {
  const label = requiredFlag(parsed, "label");
  return label === "null" ? null : label;
}

function projectQuery(parsed: ParsedCliArgs): string {
  return queryString({ projectId: requiredFlag(parsed, "project") });
}
