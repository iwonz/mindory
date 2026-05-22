import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const requiredFiles = [
  "apps/api/src/app.ts",
  "apps/api/src/server.ts",
  "apps/api/src/auth.ts",
  "apps/api/src/errors.ts",
  "apps/api/src/routes/dependencies.ts",
  "apps/api/src/routes/health.ts",
  "apps/api/src/routes/projects.ts",
  "apps/api/src/routes/tokens.ts",
  "packages/config/src/index.ts"
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

for (const file of requiredFiles) {
  assert(fs.existsSync(path.join(root, file)), `${file} is required.`);
}

const rootPackage = JSON.parse(read("package.json"));
const apiPackage = JSON.parse(read("apps/api/package.json"));
const configPackage = JSON.parse(read("packages/config/package.json"));
const app = read("apps/api/src/app.ts");
const server = read("apps/api/src/server.ts");
const auth = read("apps/api/src/auth.ts");
const errors = read("apps/api/src/errors.ts");
const routeDependencies = read("apps/api/src/routes/dependencies.ts");
const healthRoutes = read("apps/api/src/routes/health.ts");
const projectRoutes = read("apps/api/src/routes/projects.ts");
const tokenRoutes = read("apps/api/src/routes/tokens.ts");
const config = read("packages/config/src/index.ts");
const envExample = read(".env.example");
const compose = read("docker-compose.yml");

assert(rootPackage.scripts?.["api:validate"] === "node scripts/validate-api-contract.js", "Root package must expose api:validate.");
assert(apiPackage.dependencies?.fastify, "@mindory/api must depend on fastify.");
assert(apiPackage.dependencies?.["@mindory/config"] === "workspace:*", "@mindory/api must depend on @mindory/config.");
assert(configPackage.exports?.["."], "@mindory/config must export its root module.");

assert(app.includes("Fastify(fastifyOptions)") || app.includes("Fastify({"), "API app must create a Fastify instance.");
assert(app.includes("registerAuth"), "API app must register auth.");
assert(app.includes("registerErrorHandlers"), "API app must register error handlers.");
assert(app.includes("registerHealthRoutes"), "API app must register health routes.");
assert(app.includes("registerTokenRoutes"), "API app must register token routes.");
assert(app.includes("registerProjectRoutes"), "API app must register project routes.");
assert(app.includes("redact"), "API logger must redact sensitive fields.");
assert(app.includes("allowDependencyFreeRoutes"), "API app must keep dependency-free route mode explicit.");

assert(server.includes("app.listen"), "API server entrypoint must listen.");
assert(server.includes("loadMindoryConfig"), "API server must load config.");
assert(server.includes("allowDependencyFreeRoutes: false"), "API server must require runtime dependencies.");

assert(auth.includes("verifyBearerToken"), "Auth must verify bearer tokens when a repository is injected.");
assert(auth.includes("buildDependencyFreeAuthorizationContext"), "Auth must keep explicit dependency-free support for tests.");
assert(auth.includes("requireProjectPermission"), "Auth must expose project permission enforcement.");
assert(auth.includes("API auth requires accessTokenRepository runtime dependency"), "Auth must fail fast when production dependencies are missing.");
assert(!auth.includes("allowedProjects: [{"), "Dependency-free auth must not grant project permissions.");

assert(routeDependencies.includes("assertRouteDependencies"), "API routes must validate runtime dependencies during registration.");
assert(routeDependencies.includes("requireRouteDependency"), "API route handlers must protect dependency-free tests.");
assert(routeDependencies.includes("api_dependency_missing"), "Missing route dependency errors must use api_dependency_missing.");

assert(errors.includes("setErrorHandler"), "API must define an error handler.");
assert(errors.includes("setNotFoundHandler"), "API must define a not-found handler.");
assert(errors.includes("requestId"), "Error responses must include requestId.");
assert(!errors.includes("not" + "_implemented"), "API errors must not expose incomplete-route codes as a product contract.");

for (const route of ['"/health"', '"/ready"']) {
  assert(healthRoutes.includes(route), `Health routes must include ${route}.`);
}

for (const route of ['"/v1/projects"', '"/v1/projects/:id"']) {
  assert(projectRoutes.includes(route), `Project routes must include ${route}.`);
}
assert(projectRoutes.includes("app.post"), "Project routes must include POST /v1/projects.");
assert(projectRoutes.includes("assertRouteDependencies"), "Project routes must fail fast when runtime dependencies are missing.");
assert(projectRoutes.includes("requireRouteDependency"), "Project route handlers must use dependency guards.");

for (const route of ['"/v1/tokens"', '"/v1/tokens/:id/revoke"', '"/v1/tokens/:id/rotate"']) {
  assert(tokenRoutes.includes(route), `Token routes must include ${route}.`);
}
assert(tokenRoutes.includes("assertRouteDependencies"), "Token routes must fail fast when runtime dependencies are missing.");
assert(tokenRoutes.includes("requireRouteDependency"), "Token route handlers must use dependency guards.");

for (const envName of ["MINDORY_LOG_LEVEL", "MINDORY_API_HOST", "MINDORY_API_PORT", "MINDORY_DATABASE_URL", "MINDORY_REDIS_URL"]) {
  assert(config.includes(envName), `Config loader must read ${envName}.`);
  assert(envExample.includes(envName), `.env.example must include ${envName}.`);
}
assert(compose.includes("MINDORY_LOG_LEVEL"), "Docker Compose environment must include MINDORY_LOG_LEVEL.");

console.log("API contract validated.");
