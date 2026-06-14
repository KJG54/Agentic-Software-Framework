"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const cli = require("../cli/appbuilder");
const schemaValidator = require("../core/validation/schema-validator");
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

test("scaffold-report validation requires the core report fields", () => {
  const good = cli.validateScaffoldReport({
    schema_version: "1.0",
    project: "demo",
    build_type: "cli",
    template: "cli",
    generated_at: new Date().toISOString(),
    output_dir: "build/demo",
    rendered_files: ["package.json", "src/index.js"]
  }, repoRoot);
  assert.equal(good.ok, true, (good.errors || []).join("; "));
  const bad = cli.validateScaffoldReport({ schema_version: "1.0", project: "demo", build_type: "cli" }, repoRoot);
  assert.equal(bad.ok, false);
  assert(bad.errors.some((item) => item.includes("template") || item.includes("required")));
});

test("build-manifest validation enforces task ids, status enum, and structure", () => {
  const good = cli.validateBuildManifest({
    schema_version: "1.0",
    project: "demo",
    tasks: [
      { id: "TASK-001", status: "pending", files: [], reason: "" },
      { id: "TASK-002", status: "done", files: ["src/index.js"], reason: "" },
      { id: "TASK-003", status: "skipped", files: [], reason: "deferred" }
    ]
  }, repoRoot);
  assert.equal(good.ok, true, (good.errors || []).join("; "));

  // tasks is required.
  const noTasks = cli.validateBuildManifest({ schema_version: "1.0", project: "demo" }, repoRoot);
  assert.equal(noTasks.ok, false);
  assert(noTasks.errors.some((item) => item.includes("tasks") || item.includes("required")));

  // status must be one of the allowed values.
  const badStatus = cli.validateBuildManifest({
    schema_version: "1.0",
    project: "demo",
    tasks: [{ id: "TASK-001", status: "wip", files: [], reason: "" }]
  }, repoRoot);
  assert.equal(badStatus.ok, false);

  // a task must carry an id.
  const noId = cli.validateBuildManifest({
    schema_version: "1.0",
    project: "demo",
    tasks: [{ status: "pending" }]
  }, repoRoot);
  assert.equal(noId.ok, false);
});

test("build-report validation requires the core report fields", () => {
  const good = cli.validateBuildReport({
    schema_version: "1.0",
    project: "demo",
    generated_at: new Date().toISOString(),
    tasks_total: 3,
    tasks_done: 2,
    tasks_skipped: 1,
    files_touched: ["src/index.js"]
  }, repoRoot);
  assert.equal(good.ok, true, (good.errors || []).join("; "));

  // missing counts fail.
  const bad = cli.validateBuildReport({
    schema_version: "1.0",
    project: "demo",
    generated_at: new Date().toISOString()
  }, repoRoot);
  assert.equal(bad.ok, false);

  // counts cannot be negative.
  const negative = cli.validateBuildReport({
    schema_version: "1.0",
    project: "demo",
    generated_at: new Date().toISOString(),
    tasks_total: -1,
    tasks_done: 0,
    tasks_skipped: 0,
    files_touched: []
  }, repoRoot);
  assert.equal(negative.ok, false);

  // unexpected properties are rejected (additionalProperties: false).
  const extra = cli.validateBuildReport({
    schema_version: "1.0",
    project: "demo",
    generated_at: new Date().toISOString(),
    tasks_total: 0,
    tasks_done: 0,
    tasks_skipped: 0,
    files_touched: [],
    surprise: true
  }, repoRoot);
  assert.equal(extra.ok, false);
});

test("cli template manifest is valid and its required_files exist", () => {
  const templateDir = path.join(repoRoot, "templates", "cli");
  const manifest = JSON.parse(fs.readFileSync(path.join(templateDir, "template.json"), "utf8"));
  const result = schemaValidator.validateJsonArtifact(repoRoot, "template", manifest);
  assert.equal(result.ok, true, (result.errors || []).join("; "));
  assert(Array.isArray(manifest.required_files) && manifest.required_files.length > 0, "required_files must be non-empty");
  for (const rel of manifest.required_files) {
    assert(fs.existsSync(path.join(templateDir, "files", rel)), `template missing required file: ${rel}`);
  }
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

test("frontmatter parser tolerates CRLF line endings", () => {
  // git autocrlf rewrites checked-out files to CRLF on Windows; the parser must
  // still recognize the frontmatter delimiter and read schema_version.
  const markdown = "---\r\nschema_version: \"1.0\"\r\nproject: demo\r\n---\r\n\r\n# Doc\r\n";
  const parsed = cli.parseFrontmatter(markdown);
  assert.notEqual(parsed, null, "CRLF frontmatter should parse, not return null");
  assert.equal(parsed.data.schema_version, "1.0");
  assert.equal(parsed.data.project, "demo");
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

test("claim refuses to overwrite an expired claim until it is reaped", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run("git", ["init", "-b", "main"], fixture);
  configureGitUser(fixture);
  run("git", ["add", "."], fixture);
  run("git", ["commit", "-m", "initial"], fixture);
  run(process.execPath, [cliPath, "init-coordination"], fixture);

  const coord = path.join(fixture, ".appbuilder", "coordination-worktree");
  const taskPath = path.join(coord, "coordination", "queue", "TASK-001.json");
  fs.writeFileSync(taskPath, JSON.stringify({
    schema_version: "1.0",
    id: "TASK-001",
    title: "Update docs",
    depends_on: [],
    files_touched_estimate: ["docs/"]
  }, null, 2));
  run("git", ["add", "coordination/queue/TASK-001.json"], coord);
  run("git", ["commit", "-m", "coordination: publish TASK-001"], coord);

  const owner = { ...process.env, APPBUILDER_AGENT_ID: "agent-owner" };
  run(process.execPath, [cliPath, "claim", "TASK-001"], fixture, owner);

  // Force the claim to look expired, then a different agent tries to take it.
  const claimPath = path.join(coord, "coordination", "claims", "TASK-001.json");
  const claimDoc = JSON.parse(fs.readFileSync(claimPath, "utf8"));
  claimDoc.expires_at = new Date(Date.now() - 60 * 1000).toISOString();
  fs.writeFileSync(claimPath, `${JSON.stringify(claimDoc, null, 2)}\n`);

  const taker = { ...process.env, APPBUILDER_AGENT_ID: "agent-taker" };
  const rejected = runFail(process.execPath, [cliPath, "claim", "TASK-001"], fixture, taker);
  assert.match(rejected.stderr + rejected.stdout, /release --expired/);
  assert.equal(fs.existsSync(claimPath), true, "expired claim must remain until reaped");

  // After an audited reap, the claim is available again.
  run(process.execPath, [cliPath, "release", "--expired", "TASK-001", "--reason", "ttl elapsed"], fixture, owner);
  assert.equal(fs.existsSync(claimPath), false);
  run(process.execPath, [cliPath, "claim", "TASK-001"], fixture, taker);
  const reclaimed = JSON.parse(fs.readFileSync(claimPath, "utf8"));
  assert.equal(reclaimed.owner, "agent-taker");
});

test("handoff records test results and ready gates on them", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run("git", ["init", "-b", "main"], fixture);
  configureGitUser(fixture);
  run("git", ["add", "."], fixture);
  run("git", ["commit", "-m", "initial"], fixture);
  run(process.execPath, [cliPath, "init-coordination"], fixture);

  const coord = path.join(fixture, ".appbuilder", "coordination-worktree");
  const taskPath = path.join(coord, "coordination", "queue", "TASK-001.json");
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
  fs.writeFileSync(path.join(fixture, "docs", "note.md"), "# Note\n");
  run("git", ["add", "docs/note.md"], fixture);
  run("git", ["commit", "-m", "docs: add note"], fixture);

  const handoffsDir = path.join(coord, "coordination", "handoffs");
  const latestHandoff = () => {
    const file = fs.readdirSync(handoffsDir).filter((f) => f.startsWith("TASK-001--")).sort().pop();
    return fs.readFileSync(path.join(handoffsDir, file), "utf8");
  };

  // Failing tests recorded -> ready must fail on the test gate.
  run(process.execPath, [cliPath, "handoff", "--task", "TASK-001", "--status", "complete", "--tests-run", "--tests-failed"], fixture, env);
  const failedText = latestHandoff();
  assert.match(failedText, /tests_run: true/);
  assert.match(failedText, /tests_passed: false/);
  const blocked = runFail(process.execPath, [cliPath, "ready", "TASK-001"], fixture, env);
  assert.match(blocked.stdout + blocked.stderr, /tests/i);

  // Passing tests recorded -> the test gate clears.
  run(process.execPath, [cliPath, "handoff", "--task", "TASK-001", "--status", "complete", "--tests-run", "--tests-passed"], fixture, env);
  const passedText = latestHandoff();
  assert.match(passedText, /tests_run: true/);
  assert.match(passedText, /tests_passed: true/);
  const ok = run(process.execPath, [cliPath, "ready", "TASK-001"], fixture, env);
  assert.match(ok.stdout, /ready for human merge review/);
});

test("ready allows deleting leaked coordination state but forbids adding it", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run("git", ["init", "-b", "main"], fixture);
  configureGitUser(fixture);
  // Simulate leaked live state tracked on main (the bug TASK-401 cleans up).
  const leaked = path.join(fixture, "coordination", "queue", "TASK-OLD.json");
  fs.mkdirSync(path.dirname(leaked), { recursive: true });
  fs.writeFileSync(leaked, JSON.stringify({ id: "TASK-OLD", note: "stale leaked queue entry" }) + "\n");
  run("git", ["add", "."], fixture);
  run("git", ["commit", "-m", "initial (with leaked coordination state)"], fixture);
  run(process.execPath, [cliPath, "init-coordination"], fixture);

  const coord = path.join(fixture, ".appbuilder", "coordination-worktree");
  fs.writeFileSync(path.join(coord, "coordination", "queue", "TASK-001.json"), JSON.stringify({
    schema_version: "1.0", id: "TASK-001", title: "Cleanup", depends_on: [], files_touched_estimate: ["coordination/"]
  }, null, 2));
  run("git", ["add", "coordination/queue/TASK-001.json"], coord);
  run("git", ["commit", "-m", "coordination: publish TASK-001"], coord);

  const env = { ...process.env, APPBUILDER_AGENT_ID: "agent-test" };
  run(process.execPath, [cliPath, "claim", "TASK-001"], fixture, env);

  // Deleting the leaked file on the task branch is the sanctioned cleanup -> not forbidden.
  run("git", ["rm", "coordination/queue/TASK-OLD.json"], fixture);
  run("git", ["commit", "-m", "remove leaked coordination state"], fixture);
  run(process.execPath, [cliPath, "handoff", "--task", "TASK-001", "--status", "complete", "--tests-run", "--tests-passed"], fixture, env);
  const okReady = run(process.execPath, [cliPath, "ready", "TASK-001"], fixture, env);
  assert.doesNotMatch(okReady.stdout, /Forbidden changed file/);
  assert.match(okReady.stdout, /ready for human merge review/);

  // Adding live coordination state on the task branch is still forbidden.
  fs.mkdirSync(path.join(fixture, "coordination", "claims"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "coordination", "claims", "TASK-FOO.json"), JSON.stringify({ id: "TASK-FOO", note: "hand-added claim that must be rejected" }) + "\n");
  run("git", ["add", "coordination/claims/TASK-FOO.json"], fixture);
  run("git", ["commit", "-m", "leak a claim"], fixture);
  const blocked = runFail(process.execPath, [cliPath, "ready", "TASK-001"], fixture, env);
  assert.match(blocked.stdout, /Forbidden changed file in task branch: coordination\/claims\/TASK-FOO\.json/);
});

test("status emits JSON by default and a table with --human", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run("git", ["init", "-b", "main"], fixture);
  configureGitUser(fixture);
  run("git", ["add", "."], fixture);
  run("git", ["commit", "-m", "initial"], fixture);
  run(process.execPath, [cliPath, "init-coordination"], fixture);

  const coord = path.join(fixture, ".appbuilder", "coordination-worktree");
  fs.writeFileSync(path.join(coord, "coordination", "queue", "TASK-001.json"), JSON.stringify({
    schema_version: "1.0", id: "TASK-001", title: "Update docs", depends_on: [], files_touched_estimate: ["docs/"]
  }, null, 2));
  run("git", ["add", "coordination/queue/TASK-001.json"], coord);
  run("git", ["commit", "-m", "coordination: publish TASK-001"], coord);

  const env = { ...process.env, APPBUILDER_AGENT_ID: "agent-test" };
  run(process.execPath, [cliPath, "claim", "TASK-001"], fixture, env);

  // Default output is still the JSON contract agents parse.
  const jsonOut = run(process.execPath, [cliPath, "status"], fixture, env).stdout;
  const parsed = JSON.parse(jsonOut);
  assert.equal(parsed.active_tasks[0].id, "TASK-001");

  // --human renders a table: the task id, its branch, the active state, and a next action.
  const humanOut = run(process.execPath, [cliPath, "status", "--human"], fixture, env).stdout;
  assert.doesNotMatch(humanOut, /^\s*\{/);
  assert.match(humanOut, /TASK-001/);
  assert.match(humanOut, /agent\/TASK-001/);
  assert.match(humanOut, /active/);
  assert.match(humanOut, /NEXT ACTION/);
});

test("status derives merged-unreleased claims and orphaned branches", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run("git", ["init", "-b", "main"], fixture);
  configureGitUser(fixture);
  run("git", ["add", "."], fixture);
  run("git", ["commit", "-m", "initial"], fixture);
  run(process.execPath, [cliPath, "init-coordination"], fixture);

  const coord = path.join(fixture, ".appbuilder", "coordination-worktree");
  const taskPath = path.join(coord, "coordination", "queue", "TASK-001.json");
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

  // Do the task work on its branch, then merge it into main while the claim
  // file is still present -> the claim is merged but unreleased.
  fs.writeFileSync(path.join(fixture, "docs", "note.md"), "# Note\n");
  run("git", ["add", "docs/note.md"], fixture);
  run("git", ["commit", "-m", "docs: add note"], fixture);
  run("git", ["checkout", "main"], fixture);
  run("git", ["merge", "--no-ff", "agent/TASK-001-update-docs", "-m", "merge TASK-001"], fixture);

  // A leftover agent branch with no claim -> orphaned.
  run("git", ["branch", "agent/TASK-999-orphan"], fixture);

  const status = run(process.execPath, [cliPath, "status"], fixture, env);
  const parsed = JSON.parse(status.stdout);
  assert.deepEqual(parsed.merged_unreleased_claims.map((claim) => claim.id), ["TASK-001"]);
  assert.equal(parsed.merged_unreleased_claims[0].owner, "agent-test");
  assert(parsed.orphaned_branches.includes("agent/TASK-999-orphan"));
  assert(!parsed.orphaned_branches.includes("agent/TASK-001-update-docs"), "claimed branch is not orphaned");
});

test("claim enforces registry allowed_paths when an entry exists", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run("git", ["init", "-b", "main"], fixture);
  configureGitUser(fixture);
  run("git", ["add", "."], fixture);
  run("git", ["commit", "-m", "initial"], fixture);
  run(process.execPath, [cliPath, "init-coordination"], fixture);

  const coord = path.join(fixture, ".appbuilder", "coordination-worktree");
  const queueDir = path.join(coord, "coordination", "queue");
  fs.writeFileSync(path.join(queueDir, "TASK-001.json"), JSON.stringify({
    schema_version: "1.0",
    id: "TASK-001",
    title: "Touch cli",
    depends_on: [],
    files_touched_estimate: ["cli/"]
  }, null, 2));
  fs.writeFileSync(path.join(queueDir, "TASK-002.json"), JSON.stringify({
    schema_version: "1.0",
    id: "TASK-002",
    title: "Touch docs",
    depends_on: [],
    files_touched_estimate: ["docs/"]
  }, null, 2));
  const registryDir = path.join(coord, "coordination", "registry");
  fs.mkdirSync(registryDir, { recursive: true });
  fs.writeFileSync(path.join(registryDir, "agent-scoped.json"), JSON.stringify({
    schema_version: "1.0",
    agent_id: "agent-scoped",
    allowed_paths: ["docs/"],
    default_branch_prefix: "agent/"
  }, null, 2));
  run("git", ["add", "coordination"], coord);
  run("git", ["commit", "-m", "coordination: publish tasks and registry"], coord);

  const scoped = { ...process.env, APPBUILDER_AGENT_ID: "agent-scoped" };
  const free = { ...process.env, APPBUILDER_AGENT_ID: "agent-free" };

  // Registered agent claiming outside its allowed_paths is rejected.
  const rejected = runFail(process.execPath, [cliPath, "claim", "TASK-001"], fixture, scoped);
  assert.match(rejected.stderr + rejected.stdout, /cli\//);
  assert.equal(fs.existsSync(path.join(coord, "coordination", "claims", "TASK-001.json")), false);

  // Same agent claiming within allowed_paths succeeds.
  run(process.execPath, [cliPath, "claim", "TASK-002"], fixture, scoped);
  const scopedClaim = JSON.parse(fs.readFileSync(path.join(coord, "coordination", "claims", "TASK-002.json"), "utf8"));
  assert.equal(scopedClaim.owner, "agent-scoped");

  // Unregistered agent keeps unrestricted Phase 1 behavior.
  run(process.execPath, [cliPath, "claim", "TASK-001"], fixture, free);
  const freeClaim = JSON.parse(fs.readFileSync(path.join(coord, "coordination", "claims", "TASK-001.json"), "utf8"));
  assert.equal(freeClaim.owner, "agent-free");
});

test("plan new scaffolds project stubs and refuses to clobber", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run(process.execPath, [cliPath, "plan", "new", "demo-app"], fixture);

  const projectDir = path.join(fixture, "projects", "demo-app");
  const requirements = JSON.parse(fs.readFileSync(path.join(projectDir, "requirements.json"), "utf8"));
  assert.equal(requirements.schema_version, "1.0");
  assert.equal(requirements.project, "demo-app");
  assert.equal(requirements.summary, "");
  assert.deepEqual(requirements.goals, []);
  assert.deepEqual(requirements.features, []);
  assert.deepEqual(requirements.constraints, []);

  const taskPlan = JSON.parse(fs.readFileSync(path.join(projectDir, "task-plan.json"), "utf8"));
  assert.equal(taskPlan.project, "demo-app");
  assert.deepEqual(taskPlan.tasks, []);

  const architecture = fs.readFileSync(path.join(projectDir, "architecture.md"), "utf8");
  assert.match(architecture, /schema_version: "1.0"/);

  // Re-running must refuse rather than overwrite filled-in work.
  const refused = runFail(process.execPath, [cliPath, "plan", "new", "demo-app"], fixture);
  assert.match(refused.stderr + refused.stdout, /already exists/);
});

test("plan compile gates on filled requirements and a consistent task plan", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run(process.execPath, [cliPath, "plan", "new", "demo-app"], fixture);
  const projectDir = path.join(fixture, "projects", "demo-app");
  const requirementsPath = path.join(projectDir, "requirements.json");
  const taskPlanPath = path.join(projectDir, "task-plan.json");

  // Unfilled requirements -> compile fails on semantic readiness.
  const empty = runFail(process.execPath, [cliPath, "plan", "compile", "demo-app"], fixture);
  assert.match(empty.stdout + empty.stderr, /summary|goals|features/);

  fs.writeFileSync(requirementsPath, JSON.stringify({
    schema_version: "1.0",
    project: "demo-app",
    summary: "A small demo app.",
    goals: ["Ship a working slice"],
    features: [{ name: "core", description: "the core feature" }],
    constraints: []
  }, null, 2));
  fs.writeFileSync(taskPlanPath, JSON.stringify({
    schema_version: "1.0",
    project: "demo-app",
    tasks: [
      { schema_version: "1.0", id: "TASK-001", title: "Build core", files_touched_estimate: ["cli/"], depends_on: [] }
    ]
  }, null, 2));
  const ok = run(process.execPath, [cliPath, "plan", "compile", "demo-app"], fixture);
  assert.match(ok.stdout, /passed/);

  // A dangling depends_on is rejected.
  fs.writeFileSync(taskPlanPath, JSON.stringify({
    schema_version: "1.0",
    project: "demo-app",
    tasks: [
      { schema_version: "1.0", id: "TASK-001", title: "Build core", files_touched_estimate: ["cli/"], depends_on: ["TASK-999"] }
    ]
  }, null, 2));
  const dangling = runFail(process.execPath, [cliPath, "plan", "compile", "demo-app"], fixture);
  assert.match(dangling.stdout + dangling.stderr, /TASK-999|depends_on/);
});

test("compile validates build_type format and is dir-driven, not enum-bound", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run(process.execPath, [cliPath, "plan", "new", "demo-app"], fixture);
  const projectDir = path.join(fixture, "projects", "demo-app");
  const requirementsPath = path.join(projectDir, "requirements.json");
  const taskPlanPath = path.join(projectDir, "task-plan.json");
  const requirementsWith = (extra) => JSON.stringify({
    schema_version: "1.0",
    project: "demo-app",
    summary: "A small demo app.",
    goals: ["Ship a working slice"],
    features: [{ name: "core", description: "the core feature" }],
    constraints: [],
    ...extra
  }, null, 2);
  fs.writeFileSync(taskPlanPath, JSON.stringify({
    schema_version: "1.0",
    project: "demo-app",
    tasks: [
      { schema_version: "1.0", id: "TASK-001", title: "Build core", files_touched_estimate: ["cli/"], depends_on: [] }
    ]
  }, null, 2));

  // A malformed build_type (not a slug) is rejected at compile.
  fs.writeFileSync(requirementsPath, requirementsWith({ build_type: "Not A Slug" }));
  const bad = runFail(process.execPath, [cliPath, "plan", "compile", "demo-app"], fixture);
  assert.match(bad.stdout + bad.stderr, /build_type/);

  // build_type is dir-driven: any well-formed slug compiles, even one with no template yet.
  // (Template availability is enforced later, by scaffold — not by the requirements schema.)
  fs.writeFileSync(requirementsPath, requirementsWith({ build_type: "widget" }));
  const novel = run(process.execPath, [cliPath, "plan", "compile", "demo-app"], fixture);
  assert.match(novel.stdout, /passed/);

  // A known build_type compiles.
  fs.writeFileSync(requirementsPath, requirementsWith({ build_type: "cli" }));
  const ok = run(process.execPath, [cliPath, "plan", "compile", "demo-app"], fixture);
  assert.match(ok.stdout, /passed/);

  // An omitted build_type still compiles (the field stays optional).
  fs.writeFileSync(requirementsPath, requirementsWith({}));
  const omitted = run(process.execPath, [cliPath, "plan", "compile", "demo-app"], fixture);
  assert.match(omitted.stdout, /passed/);
});

test("scaffold renders the cli template into build/<slug> with a valid report", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run(process.execPath, [cliPath, "plan", "new", "demo-app"], fixture);
  const projectDir = path.join(fixture, "projects", "demo-app");
  writeFilledPlan(projectDir, { build_type: "cli" });

  const result = run(process.execPath, [cliPath, "scaffold", "demo-app"], fixture);
  assert.match(result.stdout, /scaffolded demo-app/);

  const buildDir = path.join(fixture, "build", "demo-app");
  // {{slug}} / {{summary}} substituted in file contents.
  const pkg = JSON.parse(fs.readFileSync(path.join(buildDir, "package.json"), "utf8"));
  assert.equal(pkg.name, "demo-app");
  assert.match(pkg.description, /demo app/i);
  const indexSrc = fs.readFileSync(path.join(buildDir, "src", "index.js"), "utf8");
  assert.match(indexSrc, /demo-app/);
  assert.doesNotMatch(indexSrc, /\{\{slug\}\}/);

  // Report is written, well-formed, and schema-valid.
  const report = JSON.parse(fs.readFileSync(path.join(buildDir, "scaffold-report.json"), "utf8"));
  assert.equal(report.build_type, "cli");
  assert.equal(report.template, "cli");
  assert.equal(report.output_dir, "build/demo-app");
  assert(report.rendered_files.includes("src/index.js"));
  assert(!report.rendered_files.includes("scaffold-report.json"));
  assert.equal(cli.validateScaffoldReport(report, fixture).ok, true);

  // Refuses to overwrite without --force; --force overwrites.
  const refused = runFail(process.execPath, [cliPath, "scaffold", "demo-app"], fixture);
  assert.match(refused.stdout + refused.stderr, /already exists|--force/);
  run(process.execPath, [cliPath, "scaffold", "demo-app", "--force"], fixture);
});

test("scaffold renders the library template into a working module", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run(process.execPath, [cliPath, "plan", "new", "demo-app"], fixture);
  const projectDir = path.join(fixture, "projects", "demo-app");
  writeFilledPlan(projectDir, { build_type: "library" });

  const result = run(process.execPath, [cliPath, "scaffold", "demo-app"], fixture);
  assert.match(result.stdout, /scaffolded demo-app/);

  const buildDir = path.join(fixture, "build", "demo-app");
  // A library exposes a module entry, not a CLI bin.
  const pkg = JSON.parse(fs.readFileSync(path.join(buildDir, "package.json"), "utf8"));
  assert.equal(pkg.name, "demo-app");
  assert.equal(pkg.main, "src/index.js");
  assert.equal(pkg.bin, undefined);
  const indexSrc = fs.readFileSync(path.join(buildDir, "src", "index.js"), "utf8");
  assert.doesNotMatch(indexSrc, /\{\{\w+\}\}/);

  // Report reflects the library template and is schema-valid.
  const report = JSON.parse(fs.readFileSync(path.join(buildDir, "scaffold-report.json"), "utf8"));
  assert.equal(report.build_type, "library");
  assert.equal(report.template, "library");
  assert(report.rendered_files.includes("src/index.js"));
  assert(report.rendered_files.includes("test/index.test.js"));
  assert.equal(cli.validateScaffoldReport(report, fixture).ok, true);

  // The rendered module ships a passing test.
  const rendered = spawnSync(process.execPath, ["--test", "test/index.test.js"], { cwd: buildDir, encoding: "utf8", stdio: "pipe" });
  assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
});

test("scaffold renders the app template into a working http service", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run(process.execPath, [cliPath, "plan", "new", "demo-app"], fixture);
  const projectDir = path.join(fixture, "projects", "demo-app");
  writeFilledPlan(projectDir, { build_type: "app" });

  const result = run(process.execPath, [cliPath, "scaffold", "demo-app"], fixture);
  assert.match(result.stdout, /scaffolded demo-app/);

  const buildDir = path.join(fixture, "build", "demo-app");
  // An app has a start script, not a bin.
  const pkg = JSON.parse(fs.readFileSync(path.join(buildDir, "package.json"), "utf8"));
  assert.equal(pkg.name, "demo-app");
  assert.match(pkg.scripts.start, /server\.js/);
  const serverSrc = fs.readFileSync(path.join(buildDir, "src", "server.js"), "utf8");
  assert.doesNotMatch(serverSrc, /\{\{\w+\}\}/);

  // Report reflects the app template and is schema-valid.
  const report = JSON.parse(fs.readFileSync(path.join(buildDir, "scaffold-report.json"), "utf8"));
  assert.equal(report.build_type, "app");
  assert.equal(report.template, "app");
  assert(report.rendered_files.includes("src/server.js"));
  assert(report.rendered_files.includes("test/server.test.js"));
  assert.equal(cli.validateScaffoldReport(report, fixture).ok, true);

  // The rendered service ships a passing test that binds an ephemeral port.
  const rendered = spawnSync(process.execPath, ["--test", "test/server.test.js"], { cwd: buildDir, encoding: "utf8", stdio: "pipe" });
  assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
});

test("scaffold renders the game template with a testable pure reducer", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run(process.execPath, [cliPath, "plan", "new", "demo-app"], fixture);
  const projectDir = path.join(fixture, "projects", "demo-app");
  writeFilledPlan(projectDir, { build_type: "game" });

  const result = run(process.execPath, [cliPath, "scaffold", "demo-app"], fixture);
  assert.match(result.stdout, /scaffolded demo-app/);

  const buildDir = path.join(fixture, "build", "demo-app");
  const pkg = JSON.parse(fs.readFileSync(path.join(buildDir, "package.json"), "utf8"));
  assert.equal(pkg.name, "demo-app");
  // Game logic is split into a pure reducer (game.js) and a thin stdin loop (index.js).
  const gameSrc = fs.readFileSync(path.join(buildDir, "src", "game.js"), "utf8");
  assert.doesNotMatch(gameSrc, /\{\{\w+\}\}/);

  // Report reflects the game template and is schema-valid.
  const report = JSON.parse(fs.readFileSync(path.join(buildDir, "scaffold-report.json"), "utf8"));
  assert.equal(report.build_type, "game");
  assert.equal(report.template, "game");
  assert(report.rendered_files.includes("src/game.js"));
  assert(report.rendered_files.includes("src/index.js"));
  assert(report.rendered_files.includes("test/game.test.js"));
  assert.equal(cli.validateScaffoldReport(report, fixture).ok, true);

  // The rendered pure reducer ships a passing test (no TTY needed).
  const rendered = spawnSync(process.execPath, ["--test", "test/game.test.js"], { cwd: buildDir, encoding: "utf8", stdio: "pipe" });
  assert.equal(rendered.status, 0, rendered.stdout + rendered.stderr);
});

test("templates lists the available build-type templates (human and --json)", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  // .gitkeep and a malformed manifest must be skipped without crashing.
  fs.mkdirSync(path.join(fixture, "templates", "broken"), { recursive: true });
  fs.writeFileSync(path.join(fixture, "templates", "broken", "template.json"), "{ not valid json");

  // Human-readable by default.
  const human = run(process.execPath, [cliPath, "templates"], fixture);
  for (const id of ["cli", "library", "app", "game"]) {
    assert.match(human.stdout, new RegExp(`\\b${id}\\b`), `human output should list ${id}`);
  }
  assert.doesNotMatch(human.stdout, /broken/);

  // --json emits a structured list of the valid templates.
  const json = run(process.execPath, [cliPath, "templates", "--json"], fixture);
  const list = JSON.parse(json.stdout);
  assert(Array.isArray(list));
  const ids = list.map((entry) => entry.id).sort();
  assert.deepEqual(ids, ["app", "cli", "game", "library"]);
  for (const entry of list) {
    assert(entry.name && entry.description, `${entry.id} should carry name + description`);
  }
});

test("scaffold fails when build_type is missing or has no template", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run(process.execPath, [cliPath, "plan", "new", "demo-app"], fixture);
  const projectDir = path.join(fixture, "projects", "demo-app");

  // Valid plan, but no build_type -> scaffold refuses.
  writeFilledPlan(projectDir, {});
  const noType = runFail(process.execPath, [cliPath, "scaffold", "demo-app"], fixture);
  assert.match(noType.stdout + noType.stderr, /build_type/);

  // A well-formed build_type with no authored template -> scaffold refuses.
  // "other" is the intentional catch-all that never gets a template.
  writeFilledPlan(projectDir, { build_type: "other" });
  const noTemplate = runFail(process.execPath, [cliPath, "scaffold", "demo-app"], fixture);
  assert.match(noTemplate.stdout + noTemplate.stderr, /template/i);
});

test("build init seeds a pending manifest from the plan after scaffold", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run(process.execPath, [cliPath, "plan", "new", "demo-app"], fixture);
  const projectDir = path.join(fixture, "projects", "demo-app");
  writeFilledPlan(projectDir, { build_type: "cli" });
  run(process.execPath, [cliPath, "scaffold", "demo-app"], fixture);

  const result = run(process.execPath, [cliPath, "build", "init", "demo-app"], fixture);
  assert.match(result.stdout, /demo-app/);

  const buildDir = path.join(fixture, "build", "demo-app");
  const manifest = JSON.parse(fs.readFileSync(path.join(buildDir, "build-manifest.json"), "utf8"));
  assert.equal(cli.validateBuildManifest(manifest, fixture).ok, true);
  // One pending entry per plan task, ids drawn from the task plan.
  assert.deepEqual(manifest.tasks.map((task) => task.id), ["TASK-001"]);
  for (const task of manifest.tasks) {
    assert.equal(task.status, "pending");
    assert.deepEqual(task.files, []);
    assert.equal(task.reason, "");
  }

  // Refuses to overwrite a filled-in manifest without --force; --force re-seeds.
  const refused = runFail(process.execPath, [cliPath, "build", "init", "demo-app"], fixture);
  assert.match(refused.stdout + refused.stderr, /already exists|--force/);
  run(process.execPath, [cliPath, "build", "init", "demo-app", "--force"], fixture);
});

test("build init refuses to seed a project that was not scaffolded", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run(process.execPath, [cliPath, "plan", "new", "demo-app"], fixture);
  const projectDir = path.join(fixture, "projects", "demo-app");
  writeFilledPlan(projectDir, { build_type: "cli" });

  // No scaffold step -> no scaffold-report.json -> build init must refuse.
  const noScaffold = runFail(process.execPath, [cliPath, "build", "init", "demo-app"], fixture);
  assert.match(noScaffold.stdout + noScaffold.stderr, /scaffold/i);
});

test("build validates a filled-in manifest and writes a build-report", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run(process.execPath, [cliPath, "plan", "new", "demo-app"], fixture);
  const projectDir = path.join(fixture, "projects", "demo-app");
  // A two-task plan so we exercise both done and skipped.
  fs.writeFileSync(path.join(projectDir, "requirements.json"), JSON.stringify({
    schema_version: "1.0", project: "demo-app", summary: "A small demo app.",
    goals: ["Ship a working slice"], features: [{ name: "core", description: "the core" }],
    constraints: [], build_type: "cli"
  }, null, 2));
  fs.writeFileSync(path.join(projectDir, "task-plan.json"), JSON.stringify({
    schema_version: "1.0", project: "demo-app",
    tasks: [
      { schema_version: "1.0", id: "TASK-001", title: "Core", files_touched_estimate: ["src/"], depends_on: [] },
      { schema_version: "1.0", id: "TASK-002", title: "Extra", files_touched_estimate: ["src/"], depends_on: [] }
    ]
  }, null, 2));
  run(process.execPath, [cliPath, "scaffold", "demo-app"], fixture);
  run(process.execPath, [cliPath, "build", "init", "demo-app"], fixture);

  const buildDir = path.join(fixture, "build", "demo-app");
  const manifestPath = path.join(buildDir, "build-manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.tasks = [
    { id: "TASK-001", status: "done", files: ["src/index.js"], reason: "" },
    { id: "TASK-002", status: "skipped", files: [], reason: "deferred to a later slice" }
  ];
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const result = run(process.execPath, [cliPath, "build", "demo-app"], fixture);
  assert.match(result.stdout, /done=1/);
  assert.match(result.stdout, /skipped=1/);

  const report = JSON.parse(fs.readFileSync(path.join(buildDir, "build-report.json"), "utf8"));
  assert.equal(cli.validateBuildReport(report, fixture).ok, true);
  assert.equal(report.tasks_total, 2);
  assert.equal(report.tasks_done, 1);
  assert.equal(report.tasks_skipped, 1);
  assert.deepEqual(report.files_touched, ["src/index.js"]);
});

test("build gate rejects pending, missing files, reasonless skips, id mismatch, and scaffold regression", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run(process.execPath, [cliPath, "plan", "new", "demo-app"], fixture);
  const projectDir = path.join(fixture, "projects", "demo-app");
  writeFilledPlan(projectDir, { build_type: "cli" });
  run(process.execPath, [cliPath, "scaffold", "demo-app"], fixture);
  run(process.execPath, [cliPath, "build", "init", "demo-app"], fixture);

  const buildDir = path.join(fixture, "build", "demo-app");
  const manifestPath = path.join(buildDir, "build-manifest.json");
  const reportPath = path.join(buildDir, "build-report.json");
  const setTasks = (tasks) => fs.writeFileSync(manifestPath, JSON.stringify({
    schema_version: "1.0", project: "demo-app", tasks
  }, null, 2));
  const expectFail = (re) => {
    if (fs.existsSync(reportPath)) fs.rmSync(reportPath);
    const r = runFail(process.execPath, [cliPath, "build", "demo-app"], fixture);
    assert.match(r.stdout + r.stderr, re);
    assert(!fs.existsSync(reportPath), "no build-report.json should be written on failure");
  };

  // Seeded manifest is all-pending -> fails.
  expectFail(/pending/i);
  // done but the declared file does not exist.
  setTasks([{ id: "TASK-001", status: "done", files: ["src/nope.js"], reason: "" }]);
  expectFail(/nope\.js|missing|exist/i);
  // skipped without a reason.
  setTasks([{ id: "TASK-001", status: "skipped", files: [], reason: "" }]);
  expectFail(/reason/i);
  // a manifest task that is not in the plan.
  setTasks([
    { id: "TASK-001", status: "done", files: ["src/index.js"], reason: "" },
    { id: "TASK-999", status: "done", files: ["src/index.js"], reason: "" }
  ]);
  expectFail(/TASK-999/);
  // a plan task missing from the manifest.
  setTasks([]);
  expectFail(/TASK-001/);
  // valid manifest, but a scaffold-rendered file was deleted.
  setTasks([{ id: "TASK-001", status: "done", files: ["package.json"], reason: "" }]);
  fs.rmSync(path.join(buildDir, "README.md"));
  expectFail(/README\.md|scaffold/i);
});

test("plan seed publishes tasks and skips ids already in the queue", { timeout: 30000 }, () => {
  const fixture = makeFixture();
  run("git", ["init", "-b", "main"], fixture);
  configureGitUser(fixture);
  run("git", ["add", "."], fixture);
  run("git", ["commit", "-m", "initial"], fixture);
  run(process.execPath, [cliPath, "init-coordination"], fixture);

  run(process.execPath, [cliPath, "plan", "new", "demo-app"], fixture);
  const projectDir = path.join(fixture, "projects", "demo-app");
  fs.writeFileSync(path.join(projectDir, "requirements.json"), JSON.stringify({
    schema_version: "1.0",
    project: "demo-app",
    summary: "A small demo app.",
    goals: ["Ship a working slice"],
    features: [{ name: "core" }],
    constraints: []
  }, null, 2));
  fs.writeFileSync(path.join(projectDir, "task-plan.json"), JSON.stringify({
    schema_version: "1.0",
    project: "demo-app",
    tasks: [
      { schema_version: "1.0", id: "TASK-001", title: "Build core", files_touched_estimate: ["cli/"], depends_on: [] },
      { schema_version: "1.0", id: "TASK-002", title: "Add docs", files_touched_estimate: ["docs/"], depends_on: [] }
    ]
  }, null, 2));

  // Pre-seed TASK-002 directly so seed must skip it.
  const coord = path.join(fixture, ".appbuilder", "coordination-worktree");
  const queueDir = path.join(coord, "coordination", "queue");
  fs.writeFileSync(path.join(queueDir, "TASK-002.json"), JSON.stringify({
    schema_version: "1.0", id: "TASK-002", title: "Pre-existing", files_touched_estimate: ["other/"]
  }, null, 2));
  run("git", ["add", "coordination/queue/TASK-002.json"], coord);
  run("git", ["commit", "-m", "coordination: pre-existing TASK-002"], coord);

  const seeded = run(process.execPath, [cliPath, "plan", "seed", "demo-app"], fixture);
  assert.match(seeded.stdout, /ok seed: TASK-001 published/);
  assert.match(seeded.stdout, /skip seed: TASK-002 already exists/);

  assert.equal(fs.existsSync(path.join(queueDir, "TASK-001.json")), true);
  const keptTask002 = JSON.parse(fs.readFileSync(path.join(queueDir, "TASK-002.json"), "utf8"));
  assert.equal(keptTask002.title, "Pre-existing", "existing queue task must not be overwritten");
});

test("maybePush retries after remote moves and resets on conflicting race", { timeout: 60000 }, () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "appbuilder-race-"));
  const origin = path.join(base, "origin.git");
  run("git", ["init", "--bare", "-b", "main", origin], base);
  const repoA = path.join(base, "a");
  const repoB = path.join(base, "b");
  run("git", ["clone", origin, repoA], base);
  configureGitUser(repoA);
  fs.writeFileSync(path.join(repoA, "shared.txt"), "base\n");
  run("git", ["add", "."], repoA);
  run("git", ["commit", "-m", "init"], repoA);
  run("git", ["push", "-u", "origin", "main"], repoA);
  run("git", ["clone", origin, repoB], base);
  configureGitUser(repoB);

  // Non-conflicting race: B is stale but its commit touches a different file,
  // so maybePush must rebase onto origin and succeed on retry.
  fs.writeFileSync(path.join(repoA, "a.txt"), "from a\n");
  run("git", ["add", "a.txt"], repoA);
  run("git", ["commit", "-m", "add a"], repoA);
  assert.equal(cli.maybePush(repoA, "main"), true);
  fs.writeFileSync(path.join(repoB, "b.txt"), "from b\n");
  run("git", ["add", "b.txt"], repoB);
  run("git", ["commit", "-m", "add b"], repoB);
  assert.equal(cli.maybePush(repoB, "main"), true);
  const subjects = run("git", ["log", "--format=%s", "origin/main"], repoB).stdout.trim().split(/\r?\n/);
  assert.deepEqual(subjects, ["add b", "add a", "init"]);

  // Conflicting race: both sides edit the same file. Origin wins, the loser is
  // reset to origin, and the error carries the race code.
  fs.writeFileSync(path.join(repoA, "shared.txt"), "from a\n");
  run("git", ["add", "shared.txt"], repoA);
  run("git", ["commit", "-m", "a wins"], repoA);
  assert.equal(cli.maybePush(repoA, "main"), true);
  fs.writeFileSync(path.join(repoB, "shared.txt"), "from b\n");
  run("git", ["add", "shared.txt"], repoB);
  run("git", ["commit", "-m", "b loses"], repoB);
  assert.throws(() => cli.maybePush(repoB, "main"), (error) => {
    assert.equal(error.code, "ECOORDINATIONRACE");
    assert.match(error.message, /Lost a coordination race/);
    return true;
  });
  assert.equal(fs.readFileSync(path.join(repoB, "shared.txt"), "utf8").replace(/\r\n/g, "\n"), "from a\n");
  const local = run("git", ["rev-parse", "HEAD"], repoB).stdout.trim();
  const remote = run("git", ["rev-parse", "origin/main"], repoB).stdout.trim();
  assert.equal(local, remote);
});

test("claim sees remote claims across clones without manual sync", { timeout: 60000 }, () => {
  const fixture = makeFixture();
  run("git", ["init", "-b", "main"], fixture);
  configureGitUser(fixture);
  run("git", ["add", "."], fixture);
  run("git", ["commit", "-m", "initial"], fixture);
  const origin = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "appbuilder-origin-")), "origin.git");
  run("git", ["init", "--bare", "-b", "main", origin], fixture);
  run("git", ["remote", "add", "origin", origin], fixture);
  run("git", ["push", "-u", "origin", "main"], fixture);
  run(process.execPath, [cliPath, "init-coordination"], fixture);

  const coordA = path.join(fixture, ".appbuilder", "coordination-worktree");
  const taskPath = path.join(coordA, "coordination", "queue", "TASK-001.json");
  fs.writeFileSync(taskPath, JSON.stringify({
    schema_version: "1.0",
    id: "TASK-001",
    title: "Update docs",
    depends_on: [],
    files_touched_estimate: ["docs/"]
  }, null, 2));
  run("git", ["add", "coordination/queue/TASK-001.json"], coordA);
  run("git", ["commit", "-m", "coordination: publish TASK-001"], coordA);
  run("git", ["push", "origin", "coordination/main"], coordA);

  const cloneB = fs.mkdtempSync(path.join(os.tmpdir(), "appbuilder-clone-"));
  run("git", ["clone", origin, "repo"], cloneB);
  const repoB = path.join(cloneB, "repo");
  configureGitUser(repoB);
  run(process.execPath, [cliPath, "init-coordination"], repoB);

  run(process.execPath, [cliPath, "claim", "TASK-001"], fixture, { ...process.env, APPBUILDER_AGENT_ID: "agent-a" });

  // B never pulls; claim must fetch coordination state itself and reject.
  const rejected = runFail(process.execPath, [cliPath, "claim", "TASK-001"], repoB, { ...process.env, APPBUILDER_AGENT_ID: "agent-b" });
  assert.match(rejected.stderr + rejected.stdout, /already claimed by agent-a/);

  const status = run(process.execPath, [cliPath, "status"], repoB, { ...process.env, APPBUILDER_AGENT_ID: "agent-b" });
  const parsed = JSON.parse(status.stdout);
  assert.equal(parsed.active_tasks.length, 1);
  assert.equal(parsed.active_tasks[0].owner, "agent-a");
});

test("doctor verifies agent onboarding files (AGENTS.md + CLAUDE.md)", () => {
  const fixture = makeFixture();
  const doctor = () =>
    spawnSync(process.execPath, [cliPath, "doctor"], { cwd: fixture, encoding: "utf8" }).stdout;

  // Present and intact (CLAUDE.md references AGENTS.md).
  fs.writeFileSync(path.join(fixture, "AGENTS.md"), "# Agents charter\n");
  fs.writeFileSync(path.join(fixture, "CLAUDE.md"), "See @AGENTS.md for instructions.\n");
  let out = doctor();
  assert.match(out, /ok onboarding:AGENTS\.md/);
  assert.match(out, /ok onboarding:CLAUDE\.md/);

  // CLAUDE.md present but gutted (no reference to AGENTS.md) -> problem.
  fs.writeFileSync(path.join(fixture, "CLAUDE.md"), "nothing useful here\n");
  out = doctor();
  assert.match(out, /problem onboarding:CLAUDE\.md/);

  // AGENTS.md missing -> problem and listed as a hard failure.
  fs.rmSync(path.join(fixture, "AGENTS.md"));
  out = doctor();
  assert.match(out, /problem onboarding:AGENTS\.md/);
  assert.match(out, /failures:[\s\S]*onboarding:AGENTS\.md/);
});

test("doctor guards the plan-interview wiring against drift", () => {
  const fixture = makeFixture();
  const doctor = () =>
    spawnSync(process.execPath, [cliPath, "doctor"], { cwd: fixture, encoding: "utf8" }).stdout;

  const guidePath = path.join(fixture, ".agent", "plan-interview.md");
  const planCmdPath = path.join(fixture, ".claude", "commands", "plan.md");
  const agentsPath = path.join(fixture, "AGENTS.md");
  const howtoPath = path.join(fixture, "HOWTO.md");

  // Fully wired: guide present and referenced by every operator surface
  // (the two agent surfaces plus the human HOWTO).
  fs.mkdirSync(path.dirname(planCmdPath), { recursive: true });
  fs.writeFileSync(guidePath, "# Plan Interview\n");
  fs.writeFileSync(planCmdPath, "Run the interview in .agent/plan-interview.md before writing.\n");
  fs.writeFileSync(agentsPath, "/plan opens the build-type interview: .agent/plan-interview.md\n");
  fs.writeFileSync(howtoPath, "/plan runs the build-type interview: .agent/plan-interview.md\n");
  let out = doctor();
  assert.match(out, /ok plan-interview:guide/);
  assert.match(out, /ok plan-interview:plan\.md/);
  assert.match(out, /ok plan-interview:AGENTS\.md/);
  assert.match(out, /ok plan-interview:HOWTO\.md/);

  // /plan command stops referencing the guide -> drift problem.
  fs.writeFileSync(planCmdPath, "nothing about the interview here\n");
  out = doctor();
  assert.match(out, /problem plan-interview:plan\.md/);

  // HOWTO stops pointing operators at the guide -> drift problem too.
  fs.writeFileSync(howtoPath, "nothing about the interview here\n");
  out = doctor();
  assert.match(out, /problem plan-interview:HOWTO\.md/);

  // Guide file deleted -> problem and listed as a hard failure.
  fs.rmSync(guidePath);
  out = doctor();
  assert.match(out, /problem plan-interview:guide/);
  assert.match(out, /failures:[\s\S]*plan-interview:guide/);
});

test("doctor flags tracked live coordination state on a normal branch", () => {
  const fixture = makeFixture();
  run("git", ["init", "-b", "main"], fixture);
  configureGitUser(fixture);
  run("git", ["add", "."], fixture);
  run("git", ["commit", "-m", "initial"], fixture);

  const doctor = () =>
    spawnSync(process.execPath, [cliPath, "doctor"], { cwd: fixture, encoding: "utf8" }).stdout;

  // Clean: nothing tracked under coordination/claims|queue|handoffs.
  let out = doctor();
  assert.match(out, /ok coordination:tracked-state/);

  // A live claim file gets tracked on the normal branch -> drift problem + hard failure.
  const claimFile = path.join(fixture, "coordination", "claims", "TASK-999.json");
  fs.mkdirSync(path.dirname(claimFile), { recursive: true });
  fs.writeFileSync(claimFile, "{}\n");
  run("git", ["add", "coordination/claims/TASK-999.json"], fixture);
  run("git", ["commit", "-m", "leak coordination state"], fixture);
  out = doctor();
  assert.match(out, /problem coordination:tracked-state/);
  assert.match(out, /failures:[\s\S]*coordination:tracked-state/);

  // Untracking it clears the check.
  run("git", ["rm", "--cached", "coordination/claims/TASK-999.json"], fixture);
  out = doctor();
  assert.match(out, /ok coordination:tracked-state/);
});

function configureGitUser(repo) {
  run("git", ["config", "user.email", "test@example.com"], repo);
  run("git", ["config", "user.name", "Test Agent"], repo);
}

function writeFilledPlan(projectDir, extra = {}) {
  fs.writeFileSync(path.join(projectDir, "requirements.json"), JSON.stringify({
    schema_version: "1.0",
    project: "demo-app",
    summary: "A small demo app.",
    goals: ["Ship a working slice"],
    features: [{ name: "core", description: "the core feature" }],
    constraints: [],
    ...extra
  }, null, 2));
  fs.writeFileSync(path.join(projectDir, "task-plan.json"), JSON.stringify({
    schema_version: "1.0",
    project: "demo-app",
    tasks: [
      { schema_version: "1.0", id: "TASK-001", title: "Build core", files_touched_estimate: ["src/"], depends_on: [] }
    ]
  }, null, 2));
}

function makeFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "appbuilder-test-"));
  copyFile("appbuilder.json", dir);
  copyDir("contracts", dir);
  copyDir("cli", dir);
  copyDir("templates", dir);
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

function runFail(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", stdio: "pipe" });
  assert.notEqual(result.status, 0, `${command} ${args.join(" ")} unexpectedly succeeded\nSTDOUT:\n${result.stdout}`);
  return result;
}
