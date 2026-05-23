import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const scenario = [
  "login/token connection through API URL and bearer token",
  "upload fixture through the document workspace",
  "watch jobs and document pipeline state",
  "inspect artifacts and source refs",
  "run unified search",
  "create source-backed memory",
  "build context preview",
  "verify desktop layout",
  "verify mobile layout",
  "run with Playwright in live mode"
];

if (process.env.MINDORY_UI_E2E_LIVE !== "true") {
  await validateDryRunCoverage();
  console.log("Web UI E2E dry-run validated. Set MINDORY_UI_E2E_LIVE=true to run Playwright against a live UI.");
  process.exit(0);
}

const uiUrl = trimTrailingSlash(process.env.MINDORY_UI_E2E_URL ?? "http://127.0.0.1:3080");
const apiUrl = trimTrailingSlash(process.env.MINDORY_E2E_API_URL ?? "http://127.0.0.1:3000");
const browserApiUrl = process.env.MINDORY_UI_E2E_BROWSER_API_URL ?? "/api";
const token = process.env.MINDORY_DEMO_TOKEN ?? "mindory-demo-token";
const projectId = process.env.MINDORY_DEMO_PROJECT_ID ?? "mindory-demo";
const runId = `ui_e2e_${Date.now()}_${randomUUID().slice(0, 8)}`;
const userPeerId = `peer_${runId}_user`;
const agentPeerId = `peer_${runId}_agent`;
const sessionId = `sess_${runId}`;
const documentTitle = `Mindory UI E2E ${runId}`;
const fileName = `mindory-ui-e2e-${runId}.txt`;
const marker = `source backed ui e2e marker ${runId}`;
const memoryText = `The UI E2E run ${runId} keeps source-backed context visible.`;

await waitForService(`${apiUrl}/health`, "API");
await waitForService(`${uiUrl}/health`, "Web UI");
await seedLiveScenario();
const { chromium } = await import("@playwright/test");

const launchOptions = {
  headless: process.env.MINDORY_UI_E2E_HEADLESS !== "false"
};
if (process.env.MINDORY_UI_E2E_BROWSER_EXECUTABLE) {
  Object.assign(launchOptions, { executablePath: process.env.MINDORY_UI_E2E_BROWSER_EXECUTABLE });
}

let browser;
try {
  browser = await chromium.launch(launchOptions);
} catch (error) {
  throw new Error([
    "Playwright could not launch Chromium.",
    "Run `pnpm exec playwright install chromium` or set MINDORY_UI_E2E_BROWSER_EXECUTABLE to a local Chrome/Chromium binary.",
    error instanceof Error ? error.message : String(error)
  ].join(" "));
}

try {
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const desktopPage = await desktop.newPage();
  await runDesktopScenario(desktopPage);
  await desktop.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const mobilePage = await mobile.newPage();
  await runMobileScenario(mobilePage);
  await mobile.close();
} finally {
  await browser.close();
}

console.log("Live Web UI E2E acceptance passed.");

async function validateDryRunCoverage() {
  for (const required of [
    "login/token",
    "upload fixture",
    "watch jobs",
    "source refs",
    "unified search",
    "source-backed memory",
    "context preview",
    "desktop layout",
    "mobile layout",
    "Playwright"
  ]) {
    assert(scenario.some((step) => step.includes(required)), `Dry-run scenario must include ${required}.`);
  }

  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  assert(packageJson.devDependencies?.["@playwright/test"], "Root devDependencies must include @playwright/test.");
  assert(packageJson.scripts?.["ui:e2e"] === "node scripts/ui-e2e-acceptance.js", "Root package must expose ui:e2e.");

  const checkRepo = await readFile(path.join(root, "scripts/check-repo.js"), "utf8");
  assert(checkRepo.includes("ui:e2e"), "pnpm check must include ui:e2e.");

  const docs = [
    await readFile(path.join(root, "README.md"), "utf8"),
    await readFile(path.join(root, "docs/UI.md"), "utf8"),
    await readFile(path.join(root, "docs/MVP_ACCEPTANCE.md"), "utf8"),
    await readFile(path.join(root, "docs/REPOSITORY_STATUS.md"), "utf8")
  ].join("\n");
  for (const token of [
    "pnpm ui:e2e",
    "MINDORY_UI_E2E_LIVE=true",
    "MINDORY_UI_E2E_URL",
    "MINDORY_UI_E2E_BROWSER_EXECUTABLE",
    "desktop",
    "mobile"
  ]) {
    assert(docs.includes(token), `Web UI E2E docs must include ${token}.`);
  }
}

async function runDesktopScenario(page) {
  await connect(page);
  await page.getByRole("button", { name: /^Documents$/ }).click();
  await page.getByLabel("Document file").setInputFiles({
    name: fileName,
    mimeType: "text/plain",
    buffer: Buffer.from([
      "Mindory Web UI E2E fixture.",
      marker,
      "This text must be searchable and usable as source-backed evidence."
    ].join("\n"), "utf8")
  });
  await page.getByLabel("Document title").fill(documentTitle);
  await page.getByRole("button", { name: /^Upload$/ }).click();
  await page.getByText(`Uploaded ${fileName}.`).waitFor({ timeout: 30_000 });

  const document = await waitForUploadedDocument();
  await waitForDocumentReady(document.id);
  await waitForArtifacts(document.id);
  await page.getByRole("button", { name: new RegExp(escapeRegExp(documentTitle)) }).click();
  await page.getByText("Pipeline").waitFor({ timeout: 15_000 });
  await page.getByText("Jobs").waitFor({ timeout: 15_000 });
  await page.getByText("Artifacts").waitFor({ timeout: 15_000 });
  await page.getByText("Source refs").first().waitFor({ timeout: 15_000 });

  await page.getByRole("button", { name: /^Search$/ }).click();
  await page.getByLabel("Search query").fill(marker);
  await page.getByRole("button", { name: /^Search$/ }).click();
  await page.getByText(marker).waitFor({ timeout: 30_000 });
  await page.getByText("Source refs").first().waitFor({ timeout: 15_000 });

  await page.getByLabel("Context query").fill(marker);
  await page.getByRole("button", { name: /^Build context$/ }).click();
  await page.getByText("Context preview").waitFor({ timeout: 30_000 });

  await page.getByLabel("Memory text").fill(memoryText);
  await page.getByLabel("Memory source type").selectOption("document");
  await page.getByLabel("Memory source id").fill(document.id);
  await page.getByRole("button", { name: /^Remember$/ }).click();
  await page.getByText("Source-backed memories").waitFor({ timeout: 30_000 });
  await page.getByText(memoryText).waitFor({ timeout: 30_000 });

  await assertNoHorizontalOverflow(page, "desktop");
}

async function runMobileScenario(page) {
  await connect(page);
  await page.getByText("Mindory").waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: /^Documents$/ }).click();
  await page.getByText("Documents").waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: /^Search$/ }).click();
  await page.getByText("Unified search").waitFor({ timeout: 15_000 });
  await assertNoHorizontalOverflow(page, "mobile");
}

async function connect(page) {
  await page.goto(uiUrl, { waitUntil: "domcontentloaded" });
  await page.getByLabel("API URL").fill(browserApiUrl);
  await page.getByLabel("Bearer token").fill(token);
  await page.getByRole("button", { name: /^Save$/ }).click();
  await page.getByText("Connection saved").waitFor({ timeout: 15_000 });
  await page.getByRole("button", { name: /Mindory UI E2E/ }).waitFor({ timeout: 30_000 });
  await page.getByRole("button", { name: /Mindory UI E2E/ }).click();
}

async function seedLiveScenario() {
  const project = await requestJson("POST", "/v1/projects", {
    id: projectId,
    name: "Mindory UI E2E",
    metadata: { ui_e2e: true }
  });
  assert(project.id === projectId, "Project seeding should return the configured project.");

  await requestJson("POST", "/v1/peers", {
    id: userPeerId,
    projectId,
    type: "human",
    name: "UI E2E User",
    externalId: userPeerId,
    metadata: { ui_e2e: true }
  });
  await requestJson("POST", "/v1/peers", {
    id: agentPeerId,
    projectId,
    type: "agent",
    name: "UI E2E Agent",
    externalId: agentPeerId,
    metadata: { ui_e2e: true }
  });
  await requestJson("POST", "/v1/sessions", {
    id: sessionId,
    projectId,
    peerIds: [userPeerId, agentPeerId],
    title: `UI E2E ${runId}`,
    metadata: { ui_e2e: true }
  });
  await requestJson("POST", `/v1/sessions/${encodeURIComponent(sessionId)}/messages`, {
    projectId,
    authorPeerId: userPeerId,
    role: "user",
    content: `Please remember ${marker} for UI E2E context.`,
    metadata: { ui_e2e: true }
  });
}

async function waitForUploadedDocument() {
  return waitForValue(async () => {
    const payload = await requestJson("GET", `/v1/documents?projectId=${encodeURIComponent(projectId)}&limit=100`);
    const document = payload.documents?.find((item) => item.title === documentTitle || item.original_filename === fileName);
    return document ?? null;
  }, "uploaded document to appear in API list", 60, 1_000);
}

async function waitForDocumentReady(documentId) {
  const accepted = new Set(["chunked", "indexed"]);
  return waitForValue(async () => {
    const payload = await requestJson("GET", `/v1/documents/${encodeURIComponent(documentId)}/status?projectId=${encodeURIComponent(projectId)}`);
    if (accepted.has(payload.status)) {
      return payload;
    }
    if (["failed", "scan_failed", "scan_infected", "quarantined"].includes(payload.status)) {
      throw new Error(`Document processing failed with status ${payload.status}.`);
    }
    return null;
  }, "document to reach chunked or indexed status", 90, 1_000);
}

async function waitForArtifacts(documentId) {
  return waitForValue(async () => {
    const payload = await requestJson("GET", `/v1/documents/${encodeURIComponent(documentId)}/artifacts?projectId=${encodeURIComponent(projectId)}`);
    return Array.isArray(payload.artifacts) && payload.artifacts.length > 0 ? payload.artifacts : null;
  }, "document artifacts to be available", 60, 1_000);
}

async function requestJson(method, pathname, body = undefined) {
  const headers = {
    accept: "application/json",
    authorization: `Bearer ${token}`
  };
  if (body !== undefined) {
    headers["content-type"] = "application/json";
  }
  const response = await fetch(`${apiUrl}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(`${method} ${pathname} failed: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function waitForService(url, label) {
  await waitForValue(async () => {
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      return response.ok ? true : null;
    } catch {
      return null;
    }
  }, `${label} service at ${url}`, 60, 1_000);
}

async function waitForValue(callback, label, attempts, intervalMs) {
  let lastError = "";
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const value = await callback();
      if (value) {
        return value;
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (!lastError.includes("Document processing failed")) {
        await delay(intervalMs);
        continue;
      }
      throw error;
    }
    await delay(intervalMs);
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError}` : ""}.`);
}

async function assertNoHorizontalOverflow(page, label) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyScrollWidth: document.body.scrollWidth,
    viewportWidth: window.innerWidth
  }));
  const width = Math.max(overflow.clientWidth, overflow.viewportWidth);
  assert(overflow.scrollWidth <= width + 2 && overflow.bodyScrollWidth <= width + 2, `${label} layout must not overflow horizontally: ${JSON.stringify(overflow)}`);
}

function trimTrailingSlash(value) {
  return value.replace(/\/$/, "");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}
