import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readJson(relativePath) {
  const filePath = path.join(root, relativePath);
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read valid JSON from ${relativePath}: ${error.message}`);
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const registry = readJson("tasks/tasks.json");
const statuses = new Set(registry.statuses ?? []);

assert(registry.project === "mindory", "tasks/tasks.json must describe the mindory project.");
assert(registry.process === "mindory-ralph-cycle", "tasks/tasks.json must use the Mindory Ralph-cycle.");
assert(registry.task_id_prefix === "TASK", "task_id_prefix must be TASK.");
assert(typeof registry.current_task_id === "string", "current_task_id must be set.");
assert(Array.isArray(registry.tasks) && registry.tasks.length > 0, "tasks registry must contain tasks.");

const taskIds = new Set();

for (const task of registry.tasks) {
  assert(/^TASK-[1-9][0-9]*$/.test(task.id), `Invalid task id: ${task.id}`);
  assert(!taskIds.has(task.id), `Duplicate task id: ${task.id}`);
  taskIds.add(task.id);
  assert(statuses.has(task.status), `Task ${task.id} has invalid registry status ${task.status}.`);
  assert(task.file === `tasks/${task.id}.json`, `Task ${task.id} file must be tasks/${task.id}.json.`);
  assert(task.branch.includes(task.id), `Task ${task.id} branch must include the task id.`);

  const taskFile = readJson(task.file);
  assert(taskFile.id === task.id, `${task.file} id must match registry.`);
  assert(taskFile.status === task.status, `${task.file} status must match registry.`);
  assert(taskFile.branch === task.branch, `${task.file} branch must match registry.`);
  assert(Array.isArray(taskFile.acceptance_criteria) && taskFile.acceptance_criteria.length > 0, `${task.file} must define acceptance criteria.`);
  assert(Array.isArray(taskFile.scope?.in) && taskFile.scope.in.length > 0, `${task.file} must define in-scope work.`);
  assert(Array.isArray(taskFile.verification?.commands) && taskFile.verification.commands.length > 0, `${task.file} must define verification commands.`);
}

assert(taskIds.has(registry.current_task_id), "current_task_id must refer to a registered task.");

console.log(`Validated ${registry.tasks.length} task file(s).`);
