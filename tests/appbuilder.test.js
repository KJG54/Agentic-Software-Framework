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

function runFail(command, args, cwd, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, encoding: "utf8", stdio: "pipe" });
  assert.notEqual(result.status, 0, `${command} ${args.join(" ")} unexpectedly succeeded\nSTDOUT:\n${result.stdout}`);
  return result;
}
