"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const cli = require("../cli/appbuilder");
const repoRoot = path.resolve(__dirname, "..");
const cliPath = path.join(repoRoot, "cli", "appbuilder.js");

test("config validation requires schema_version and positive TTL", () => {
  const result = cli.validateAppbuilderConfig({ schema_version: "1.0", claim_ttl_minutes: 0 });
  assert.equal(result.ok, false);
  assert(result.errors.some((item) => item.includes("claim_ttl_minutes")));
  assert(result.errors.some((item) => item.includes("framework_name")));
});

test("validation dispatches by declared schema version", () => {
  const result = cli.validateQueueTask({
    schema_version: "2.0",
    id: "TASK-001",
    title: "Unsupported schema",
    files_touched_estimate: []
  }, repoRoot);
  assert.equal(result.ok, false);
  assert(result.errors.some((item) => item.includes("schema_version 2.0")));
});

test("frontmatter parser preserves list values", () => {
  const markdown = `---
schema_version: "1.0"
task: TASK-001
files_changed:
  - "cli/appbuilder.js"
blockers: []
---

# Handoff
`;
  const parsed = cli.parseFrontmatter(markdown);
  assert.equal(parsed.data.schema_version, "1.0");
  assert.deepEqual(parsed.data.files_changed, ["cli/appbuilder.js"]);
  assert.deepEqual(parsed.data.blockers, []);
});

test("path overlap detects parent and child paths", () => {
  assert.equal(cli.pathsOverlap("cli/", "cli/appbuilder.js"), true);
  assert.equal(cli.pathsOverlap("contracts/schemas", "cli"), false);
});

test("coordination thin slice initializes, claims, hands off, and becomes ready", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run("git", ["init", "-b", "main"], fixture);
  run("git", ["config", "user.email", "test@example.com"], fixture);
  run("git", ["config", "user.name", "Test Agent"], fixture);
  run("git", ["add", "."], fixture);
  run("git", ["commit", "-m", "initial"], fixture);

  run(process.execPath, [cliPath, "init-coordination"], fixture);
  const coord = path.join(fixture, ".appbuilder", "coordination-worktree");
  const taskPath = path.join(coord, "coordination", "queue", "TASK-001.json");
  fs.mkdirSync(path.dirname(taskPath), { recursive: true });
  fs.writeFileSync(taskPath, JSON.stringify({
    schema_version: "1.0",
    id: "TASK-001",
    title: "Update docs",
    depends_on: [],
    files_touched_estimate: ["docs/"]
  }, null, 2));
  run("git", ["add", "coordination/queue/TASK-001.json"], coord);
  run("git", ["commit", "-m", "coordination: publish TASK-001"], coord);

  const env = { ...process.env, APPBUILDER_AGENT_ID: "agent-test" };
  run(process.execPath, [cliPath, "claim", "TASK-001"], fixture, env);
  const claimPath = path.join(coord, "coordination", "claims", "TASK-001.json");
  const firstClaim = JSON.parse(fs.readFileSync(claimPath, "utf8"));
  assert.equal(firstClaim.task, "TASK-001");
  assert.equal(firstClaim.owner, "agent-test");
  assert.equal(typeof firstClaim.heartbeat_at, "string");

  run(process.execPath, [cliPath, "claim", "--refresh", "TASK-001"], fixture, env);
  const refreshedClaim = JSON.parse(fs.readFileSync(claimPath, "utf8"));
  assert(Date.parse(refreshedClaim.heartbeat_at) >= Date.parse(firstClaim.heartbeat_at));

  fs.writeFileSync(path.join(fixture, "docs", "note.md"), "# Note\n");
  run("git", ["add", "docs/note.md"], fixture);
  run("git", ["commit", "-m", "docs: add note"], fixture);

  run(process.execPath, [cliPath, "handoff", "--task", "TASK-001", "--status", "complete"], fixture, env);
  const ready = run(process.execPath, [cliPath, "ready", "TASK-001"], fixture, env);
  assert.match(ready.stdout, /ready for human merge review/);

  const status = run(process.execPath, [cliPath, "status"], fixture, env);
  const parsedStatus = JSON.parse(status.stdout);
  assert.equal(parsedStatus.active_tasks[0].id, "TASK-001");
  assert(fs.existsSync(path.join(coord, "coordination", "generated", "project-status.json")));

  run(process.execPath, [cliPath, "release", "TASK-001", "--reason", "merged by test"], fixture, env);
  assert.equal(fs.existsSync(claimPath), false);
  const releasedStatus = run(process.execPath, [cliPath, "status"], fixture, env);
  assert.equal(JSON.parse(releasedStatus.stdout).active_tasks.length, 0);
});

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "appbuilder-test-"));
  copyFile("appbuilder.json", dir);
  copyDir("contracts", dir);
  copyDir("cli", dir);
  fs.mkdirSync(path.join(dir, "docs"), { recursive: true });
  fs.mkdirSync(path.join(dir, "tests"), { recursive: true });
  fs.mkdirSync(path.join(dir, ".agent", "rules"), { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), "# Fixture\n");
  return dir;
}

function copyFile(relative, toRoot) {
  const target = path.join(toRoot, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, relative), target);
}

function copyDir(relative, toRoot) {
  fs.cpSync(path.join(repoRoot, relative), path.join(toRoot, relative), { recursive: true });
}

function run(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", stdio: "pipe" });
  assert.equal(result.status, 0, `${command} ${args.join(" ")} failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
  return result;
}
