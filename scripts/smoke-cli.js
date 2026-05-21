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

async function run(argv, api = new RecordingApi()) {
  const output = {
    stdout: "",
    stderr: ""
  };
  const code = await runMindoryCli({
    argv,
    env: {},
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

console.log("CLI smoke scenario passed.");
