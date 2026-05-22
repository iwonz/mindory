import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDir = path.join(root, "packages/installer/fixtures/matrix");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

function readJson(relativePath) {
  return JSON.parse(read(relativePath));
}

const rootPackage = readJson("package.json");
const checkRepo = read("scripts/check-repo.js");
const docs = read("docs/INSTALLER.md");

assert(rootPackage.scripts?.["installer:matrix:validate"]?.includes("scripts/validate-installer-matrix.js"), "Root package must expose installer:matrix:validate.");
assert(checkRepo.includes("installer:matrix:validate"), "pnpm check must include installer matrix validation.");
for (const token of ["Linux", "macOS", "Windows", "dry-run matrix"]) {
  assert(docs.includes(token), `Installer docs must mention ${token}.`);
}

const fixtureNames = fs.readdirSync(fixturesDir).filter((name) => name.endsWith(".answers.json")).sort();
assert(fixtureNames.length === 3, "Installer matrix must include exactly three OS answer snapshots.");
for (const expectedFixture of ["linux-local.answers.json", "macos-librefs.answers.json", "windows-external-s3.answers.json"]) {
  assert(fixtureNames.includes(expectedFixture), `Installer matrix must include ${expectedFixture}.`);
}

const installer = await import("../packages/installer/dist/index.js");

for (const fixtureName of fixtureNames) {
  const fixture = JSON.parse(fs.readFileSync(path.join(fixturesDir, fixtureName), "utf8"));
  const answers = installer.createDefaultInstallAnswers(fixture.answers);
  const errors = installer.validateInstallAnswers(answers);
  assert(errors.length === 0, `${fixtureName} answers must validate: ${errors.join(" ")}`);

  const plan = installer.createInstallPlan(answers);
  assert(plan.mindoryHome === answers.mindoryHome, `${fixtureName} plan must keep MINDORY_HOME.`);
  assert(plan.steps.length >= 8, `${fixtureName} plan must include install steps.`);
  for (const profile of fixture.expected.composeProfiles) {
    assert(plan.composeProfiles.includes(profile), `${fixtureName} must include Compose profile ${profile}.`);
  }

  const summary = installer.buildRedactedInstallSummary(answers);
  const summaryJson = JSON.stringify(summary);
  assert(!summaryJson.includes("fixture-secret"), `${fixtureName} summary must redact S3 secret.`);
  assert(!summaryJson.includes("fixture-cli-token"), `${fixtureName} summary must redact CLI token.`);

  const dependencyChecks = installer.detectHostDependencies(answers, fakeProbeForPlatform(fixture.platform));
  const failures = dependencyChecks
    .filter((check) => check.required && check.status !== "ok" && check.status !== "skipped")
    .map((check) => check.id)
    .sort();
  assert(JSON.stringify(failures) === JSON.stringify([...fixture.expected.dependencyFailures].sort()), `${fixtureName} dependency failures must match fixture expectations.`);

  const diagnostic = installer.formatInstallerDiagnostic(new Error(`${fixture.platform} dry-run failure`), dependencyChecks);
  assert(diagnostic.summary.includes("dry-run failure"), `${fixtureName} diagnostic must include summary.`);
  if (failures.length > 0) {
    assert(diagnostic.nextSteps.length > 1, `${fixtureName} diagnostic must include remediation steps.`);
  }
}

console.log("Installer dev/test matrix validated.");

function fakeProbeForPlatform(platform) {
  return {
    run(command, args) {
      if (platform === "windows" && (command === "node" || command === "pnpm")) {
        return { status: null, stdout: "", stderr: `${command} missing in dry-run fixture` };
      }
      if (platform === "macos" && command === "docker" && args[0] === "info") {
        return { status: 1, stdout: "", stderr: "Docker Desktop is not running in dry-run fixture" };
      }
      return { status: 0, stdout: "ok", stderr: "" };
    },
    isWritable() {
      return true;
    },
    isPortAvailable(port) {
      return !(platform === "windows" && port === 3100);
    },
    diskSpaceBytes() {
      return 10_000_000_000;
    }
  };
}
