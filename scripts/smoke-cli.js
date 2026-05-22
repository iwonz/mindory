import { MindoryCliApiError, MindoryCliNetworkError } from "../apps/cli/dist/http-client.js";
import { runMindoryCli } from "../apps/cli/dist/run.js";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

class RecordingApi {
  calls = [];
  error = null;

  constructor(error = null) {
    this.error = error;
  }

  async getJson(path) {
    return this.record("GET", path);
  }

  async postJson(path, body) {
    return this.record("POST", path, body);
  }

  async patchJson(path, body) {
    return this.record("PATCH", path, body);
  }

  async deleteJson(path) {
    return this.record("DELETE", path);
  }

  async uploadDocument(input) {
    this.calls.push({ method: "UPLOAD", path: "/v1/documents", input });
    return { ok: true };
  }

  async record(method, path, body = undefined) {
    if (this.error) {
      throw this.error;
    }
    this.calls.push({ method, path, body });
    return { ok: true };
  }
}

async function run(argv, api = new RecordingApi(), env = {}) {
  const output = {
    stdout: "",
    stderr: ""
  };
  const code = await runMindoryCli({
    argv,
    env,
    apiClient: api,
    stdout: (text) => {
      output.stdout += `${text}\n`;
    },
    stderr: (text) => {
      output.stderr += `${text}\n`;
    }
  });
  return {
    code,
    stdout: output.stdout,
    stderr: output.stderr,
    calls: api.calls
  };
}

const routeCases = [
  {
    argv: ["project", "list"],
    expected: { method: "GET", path: "/v1/projects" }
  },
  {
    argv: ["token", "list", "--project", "p1", "--limit", "2"],
    expected: { method: "GET", path: "/v1/tokens?projectId=p1&limit=2" }
  },
  {
    argv: ["token", "create", "--project", "p1", "--permissions", "project:read,token:read"],
    expected: { method: "POST", path: "/v1/tokens" }
  },
  {
    argv: ["token", "revoke", "tok1", "--project", "p1"],
    expected: { method: "POST", path: "/v1/tokens/tok1/revoke" }
  },
  {
    argv: ["token", "rotate", "tok1", "--project", "p1", "--expires-at", "2030-01-01T00:00:00.000Z"],
    expected: { method: "POST", path: "/v1/tokens/tok1/rotate" }
  },
  {
    argv: ["session", "list", "--project", "p1", "--limit", "2"],
    expected: { method: "GET", path: "/v1/sessions?projectId=p1&limit=2" }
  },
  {
    argv: ["message", "list", "--session", "s1", "--project", "p1"],
    expected: { method: "GET", path: "/v1/sessions/s1/messages?projectId=p1" }
  },
  {
    argv: ["document", "status", "d1", "--project", "p1"],
    expected: { method: "GET", path: "/v1/documents/d1/status?projectId=p1" }
  },
  {
    argv: ["document", "reprocess", "d1", "--project", "p1", "--stages", "image,video"],
    expected: { method: "POST", path: "/v1/documents/d1/recompute" }
  },
  {
    argv: ["document", "runs", "d1", "--project", "p1"],
    expected: { method: "GET", path: "/v1/documents/d1/processing-runs?projectId=p1" }
  },
  {
    argv: ["document", "search", "--project", "p1", "--metadata-filter", "{\"key\":\"extension\",\"valueText\":\"pdf\"}", "source refs"],
    expected: { method: "POST", path: "/v1/documents/search" }
  },
  {
    argv: ["artifact", "search", "--project", "p1", "--artifact-type", "ocr_text,image_caption", "--metadata-filter", "{\"key\":\"extension\",\"valueText\":\"png\"}", "passport airport"],
    expected: { method: "POST", path: "/v1/artifacts/search" }
  },
  {
    argv: ["search", "query", "--project", "p1", "--target", "documents,artifacts,faces", "--artifact-type", "ocr_text,image_caption", "--metadata-filter", "{\"key\":\"extension\",\"valueText\":\"png\"}", "passport airport"],
    expected: { method: "POST", path: "/v1/search" }
  },
  {
    argv: ["face", "identities", "--project", "p1"],
    expected: { method: "GET", path: "/v1/faces/identities?projectId=p1" }
  },
  {
    argv: ["face", "observations", "--project", "p1", "--document", "d1"],
    expected: { method: "GET", path: "/v1/faces/observations?projectId=p1&documentId=d1" }
  },
  {
    argv: ["face", "rename", "face1", "--project", "p1", "--label", "Ivan"],
    expected: { method: "PATCH", path: "/v1/faces/identities/face1" }
  },
  {
    argv: ["face", "merge", "face1", "--project", "p1", "--target", "face2"],
    expected: { method: "POST", path: "/v1/faces/identities/face1/merge" }
  },
  {
    argv: ["memory", "remember", "--project", "p1", "--source-ref", "message:m1", "Remember this source-backed fact"],
    expected: { method: "POST", path: "/v1/memories" }
  },
  {
    argv: ["context", "build", "--project", "p1", "--session", "s1", "workers"],
    expected: { method: "POST", path: "/v1/context/build" }
  },
  {
    argv: ["jobs", "get", "j1", "--project", "p1"],
    expected: { method: "GET", path: "/v1/jobs/j1?projectId=p1" }
  },
  {
    argv: ["jobs", "retry", "j1", "--project", "p1"],
    expected: { method: "POST", path: "/v1/jobs/j1/retry" }
  },
  {
    argv: ["document", "upload", "/tmp/mindory-smoke.txt", "--project", "p1", "--mime-type", "text/plain"],
    expected: { method: "UPLOAD", path: "/v1/documents" }
  }
];

for (const testCase of routeCases) {
  const result = await run(testCase.argv);
  assert(result.code === 0, `${testCase.argv.join(" ")} should exit 0.`);
  const call = result.calls[0];
  assert(call?.method === testCase.expected.method, `${testCase.argv.join(" ")} should use ${testCase.expected.method}.`);
  assert(call?.path === testCase.expected.path, `${testCase.argv.join(" ")} should call ${testCase.expected.path}; got ${call?.path}.`);
}

const usageError = await run(["document", "read", "d1"]);
assert(usageError.code === 2, "Missing project id should exit 2.");
assert(usageError.stderr.includes("--project is required."), "Usage error should explain the missing project flag.");
assert(usageError.calls.length === 0, "Usage error must not call the API.");

const apiError = await run(["project", "list"], new RecordingApi(new MindoryCliApiError(
  403,
  "No project access.",
  { error: { code: "forbidden", message: "No project access." } },
  "forbidden"
)));
assert(apiError.code === 3, "API errors should exit 3.");
assert(apiError.stderr.includes("API 403 forbidden: No project access."), "API errors should include status, code and message.");

const networkError = await run(["project", "list"], new RecordingApi(new MindoryCliNetworkError("Unable to reach Mindory API at http://localhost:3000.")));
assert(networkError.code === 4, "Network errors should exit 4.");
assert(networkError.stderr.includes("Unable to reach Mindory API"), "Network errors should explain connectivity failure.");

const generationScript = `
const fs = require('node:fs');
const request = JSON.parse(fs.readFileSync(0, 'utf8'));
const media = Buffer.from(request.operation + ':' + request.input.prompt).toString('base64');
if (request.operation === 'image_generation') {
  console.log(JSON.stringify({ status: 'ok', role: request.role, model: request.model, output: { data_base64: media, mime_type: 'image/png', metadata: { prompt: request.input.prompt } }, usage: { image_count: 1 } }));
} else if (request.operation === 'audio_generation') {
  console.log(JSON.stringify({ status: 'ok', role: request.role, model: request.model, output: { data_base64: media, mime_type: 'audio/wav', metadata: { durationSeconds: 1 } }, usage: { audio_seconds: 1 } }));
} else {
  console.log(JSON.stringify({ status: 'failed', role: request.role, model: request.model, error_code: 'unexpected_operation', error_message: request.operation }));
}
`;
const generationEnv = {
  MINDORY_INSTALL_ALLOW_EXPERIMENTAL: "true",
  MINDORY_LLM_IMAGE_GENERATION_ENABLED: "true",
  MINDORY_LLM_IMAGE_GENERATION_PROVIDER: "local-command",
  MINDORY_LLM_IMAGE_GENERATION_MODEL: "cli-image-generator",
  MINDORY_LLM_AUDIO_GENERATION_ENABLED: "true",
  MINDORY_LLM_AUDIO_GENERATION_PROVIDER: "local-command",
  MINDORY_LLM_AUDIO_GENERATION_MODEL: "cli-audio-generator",
  MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_COMMAND: process.execPath,
  MINDORY_LLM_LOCAL_COMMAND_HEALTHCHECK_ARGS: JSON.stringify(["-e", "console.log(JSON.stringify({ status: 'ok', role: process.argv[1], model: process.argv[2] }));", "{role}", "{model}"]),
  MINDORY_LLM_LOCAL_COMMAND_OPERATION_COMMAND: process.execPath,
  MINDORY_LLM_LOCAL_COMMAND_OPERATION_ARGS: JSON.stringify(["-e", generationScript, "{role}", "{model}", "{operation}"])
};
const imageGeneration = await run(["llm", "generate-image", "draw a diagram"], new RecordingApi(), generationEnv);
assert(imageGeneration.code === 0, "llm generate-image should exit 0.");
const imagePayload = JSON.parse(imageGeneration.stdout);
assert(imagePayload.status === "success", "llm generate-image must report success.");
assert(imagePayload.mimeType === "image/png", "llm generate-image must report image MIME type.");
assert(imagePayload.byteLength > 0, "llm generate-image must report generated byte length.");
assert(typeof imagePayload.dataBase64 === "undefined", "llm generate-image must not print media bytes unless requested.");

const audioGeneration = await run(["llm", "generate-audio", "say hello", "--include-bytes"], new RecordingApi(), generationEnv);
assert(audioGeneration.code === 0, "llm generate-audio should exit 0.");
const audioPayload = JSON.parse(audioGeneration.stdout);
assert(audioPayload.status === "success", "llm generate-audio must report success.");
assert(audioPayload.mimeType === "audio/wav", "llm generate-audio must report audio MIME type.");
assert(typeof audioPayload.dataBase64 === "string" && audioPayload.dataBase64.length > 0, "llm generate-audio --include-bytes must print base64 media.");

const disabledGeneration = await run(["llm", "generate-image", "disabled role"], new RecordingApi());
assert(disabledGeneration.code === 0, "Disabled llm generate-image should exit 0.");
assert(JSON.parse(disabledGeneration.stdout).status === "disabled", "Disabled llm generate-image must return disabled status.");

console.log("CLI smoke scenario passed.");
