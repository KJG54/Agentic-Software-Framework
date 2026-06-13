#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  validateJsonArtifact,
  validateMarkdownArtifact
} = require("../core/validation/schema-validator");

const ROOT_CONFIG = "appbuilder.json";
const REQUIRED_SCHEMA_NAMES = ["appbuilder-config", "queue-task", "claim", "handoff", "registry", "template", "mcp-profile"];
const COORD_WORKTREE = path.join(".appbuilder", "coordination-worktree");
const TASK_ID_RE = /^TASK-\d{3,}$/;

function main(argv = process.argv.slice(2), cwd = process.cwd()) {
  const command = argv[0] || "help";
  const args = argv.slice(1);
  try {
    switch (command) {
      case "help":
      case "--help":
      case "-h":
        printHelp();
        return 0;
      case "init-coordination":
        return initCoordination(cwd);
      case "doctor":
        return doctor(cwd);
      case "status":
        return status(cwd);
      case "claim":
        return claim(cwd, args);
      case "release":
        return release(cwd, args);
      case "handoff":
        return handoff(cwd, args);
      case "ready":
        return ready(cwd, args);
      case "events":
        return events(cwd);
      case "start":
      case "plan":
      case "scaffold":
      case "build":
      case "test":
      case "review":
      case "ship":
        console.log(`${command} is reserved for a later phase. Coordination commands are available now.`);
        return 0;
      default:
        console.error(`Unknown command: ${command}`);
        printHelp();
        return 1;
    }
  } catch (error) {
    console.error(error.message);
    if (process.env.APPBUILDER_DEBUG) console.error(error.stack);
    return 1;
  }
}

function printHelp() {
  console.log(`appbuilder <command>

Core coordination commands:
  init-coordination        Create or verify the coordination branch worktree
  doctor                   Run framework diagnostics
  status                   Derive current project status
  claim <task-id>          Claim a queue task and switch to a task branch
  claim --refresh <task>   Refresh heartbeat_at and expires_at for a claim
  release <task-id>        Delete an active claim after merge or expiry
  handoff                  Write a machine-parseable handoff
                           (--tests-run --tests-passed|--tests-failed records test results)
  ready <task-id>          Run the before-merge gate
  events                   Derive coordination events from Git history

Later-phase workflow placeholders:
  start plan scaffold build test review ship`);
}

function findRoot(start) {
  let current = path.resolve(start);
  while (true) {
    if (fs.existsSync(path.join(current, ROOT_CONFIG))) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function loadProject(cwd) {
  const root = findRoot(cwd);
  if (!root) throw new Error(`Could not find ${ROOT_CONFIG}. Run from an App Builder project.`);
  const configPath = path.join(root, ROOT_CONFIG);
  const config = readJson(configPath);
  const validation = validateAppbuilderConfig(config, root);
  if (!validation.ok) {
    throw new Error(`${ROOT_CONFIG} is invalid:\n${validation.errors.map((item) => `- ${item}`).join("\n")}`);
  }
  return { root, config };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`Failed to read JSON ${file}: ${error.message}`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, value);
}

function validationRoot(root) {
  return root || findRoot(process.cwd()) || path.resolve(__dirname, "..");
}

function validateAppbuilderConfig(config, root) {
  return validateJsonArtifact(validationRoot(root), "appbuilder-config", config);
}

function validateQueueTask(task, root) {
  return validateJsonArtifact(validationRoot(root), "queue-task", task);
}

function validateClaim(claimFile, root) {
  const claim = typeof claimFile === "string" ? readJson(claimFile) : claimFile;
  const result = validateJsonArtifact(validationRoot(root), "claim", claim);
  return { ...result, claim };
}

function validateRegistryEntry(entry, root) {
  return validateJsonArtifact(validationRoot(root), "registry", entry);
}

function validateHandoff(file, root) {
  const text = fs.readFileSync(file, "utf8");
  const parsed = parseFrontmatter(text);
  if (!parsed) return { ok: false, errors: ["Missing YAML frontmatter"] };
  const data = parsed.data;
  const result = validateMarkdownArtifact(validationRoot(root), "handoff", data);
  const errors = [...result.errors];
  if (data.status === "blocked" && (!Array.isArray(data.blockers) || data.blockers.length === 0)) {
    errors.push("blocked handoffs require blockers");
  }
  return { ok: errors.length === 0, errors, data };
}

function parseFrontmatter(text) {
  if (!text.startsWith("---\n")) return null;
  const end = text.indexOf("\n---", 4);
  if (end === -1) return null;
  const yaml = text.slice(4, end).trim();
  const data = {};
  let currentList = null;
  for (const rawLine of yaml.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    if (!line.trim()) continue;
    if (line.trimStart().startsWith("- ") && currentList) {
      data[currentList].push(unquote(line.trimStart().slice(2).trim()));
      continue;
    }
    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rawValue] = match;
    if (rawValue === "[]") {
      data[key] = [];
      currentList = key;
    } else if (rawValue === "") {
      data[key] = [];
      currentList = key;
    } else if (rawValue === "true" || rawValue === "false") {
      data[key] = rawValue === "true";
      currentList = null;
    } else {
      data[key] = unquote(rawValue);
      currentList = null;
    }
  }
  return { data };
}

function unquote(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function git(root, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture === false ? "inherit" : "pipe"
  });
  if (result.error) {
    if (options.allowFail) return result;
    throw new Error(`git ${args.join(" ")} failed: ${result.error.message}`);
  }
  if (result.status !== 0 && !options.allowFail) {
    throw new Error(`git ${args.join(" ")} failed:\n${(result.stderr || result.stdout).trim()}`);
  }
  return result;
}

function isGitRepo(root) {
  return git(root, ["rev-parse", "--is-inside-work-tree"], { allowFail: true }).status === 0;
}

function hasAnyCommit(root) {
  return git(root, ["rev-parse", "--verify", "HEAD"], { allowFail: true }).status === 0;
}

function currentBranch(root) {
  const result = git(root, ["branch", "--show-current"], { allowFail: true });
  return result.status === 0 ? result.stdout.trim() : "";
}

function branchExists(root, branch) {
  return git(root, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { allowFail: true }).status === 0;
}

function remoteBranchExists(root, branch) {
  return git(root, ["ls-remote", "--exit-code", "--heads", "origin", branch], { allowFail: true }).status === 0;
}

function hasRemote(root) {
  return git(root, ["remote", "get-url", "origin"], { allowFail: true }).status === 0;
}

function ensureCoordinationWorktree(project, options = {}) {
  const { root, config } = project;
  const worktree = path.join(root, COORD_WORKTREE);
  const branch = config.coordination_branch;
  if (!isGitRepo(root)) throw new Error("Coordination requires a Git repository. Run git init and make an initial commit first.");
  if (!hasAnyCommit(root)) throw new Error("Coordination requires at least one Git commit before a worktree can be created.");

  if (!branchExists(root, branch)) {
    if (!options.create) throw new Error(`Missing local coordination branch ${branch}. Run appbuilder init-coordination.`);
    if (hasRemote(root) && remoteBranchExists(root, branch)) {
      git(root, ["fetch", "origin", `${branch}:${branch}`]);
    } else {
      git(root, ["branch", branch]);
    }
  }

  if (!fs.existsSync(worktree)) {
    if (!options.create) throw new Error(`Missing internal coordination worktree. Run appbuilder init-coordination.`);
    fs.mkdirSync(path.dirname(worktree), { recursive: true });
    git(root, ["worktree", "add", worktree, branch]);
  }
  syncCoordinationWorktree(worktree, branch);
  return worktree;
}

function syncCoordinationWorktree(worktree, branch) {
  if (!hasRemote(worktree)) return false;
  const fetched = git(worktree, ["fetch", "origin", branch], { allowFail: true });
  if (fetched.status !== 0) return false;
  const rebase = git(worktree, ["rebase", `origin/${branch}`], { allowFail: true });
  if (rebase.status !== 0) {
    git(worktree, ["rebase", "--abort"], { allowFail: true });
    throw new Error(
      `Coordination worktree has local commits that conflict with origin/${branch}. ` +
      `Inspect ${worktree}, or discard the local coordination commits with: ` +
      `git -C "${worktree}" reset --hard origin/${branch}`
    );
  }
  return true;
}

function commitIfChanged(repo, message) {
  git(repo, ["add", "coordination"]);
  const diff = git(repo, ["diff", "--cached", "--quiet"], { allowFail: true });
  if (diff.status === 0) return false;
  git(repo, ["commit", "-m", message]);
  return true;
}

function maybePush(repo, branch) {
  if (!hasRemote(repo)) return false;
  let result = git(repo, ["push", "origin", branch], { allowFail: true });
  if (result.status === 0) return true;

  // The remote moved while this command was running. Replay local commits on
  // top of origin and retry once; a rebase conflict means a true race (e.g.
  // two agents claiming the same task), where origin wins and local state is
  // restored from it.
  const fetched = git(repo, ["fetch", "origin", branch], { allowFail: true });
  if (fetched.status === 0) {
    const rebase = git(repo, ["rebase", `origin/${branch}`], { allowFail: true });
    if (rebase.status !== 0) {
      git(repo, ["rebase", "--abort"], { allowFail: true });
      git(repo, ["reset", "--hard", `origin/${branch}`]);
      const error = new Error(
        `Lost a coordination race on ${branch}: a conflicting update reached origin first. ` +
        `Local coordination commits were discarded and state was restored from origin.`
      );
      error.code = "ECOORDINATIONRACE";
      throw error;
    }
    result = git(repo, ["push", "origin", branch], { allowFail: true });
    if (result.status === 0) return true;
  }
  throw new Error(`Failed to push ${branch}:\n${result.stderr.trim()}`);
}

function initCoordination(cwd) {
  const project = loadProject(cwd);
  const worktree = ensureCoordinationWorktree(project, { create: true });
  const coordinationRoot = path.join(worktree, "coordination");
  for (const folder of ["queue", "claims", "registry", "handoffs", "generated"]) {
    fs.mkdirSync(path.join(coordinationRoot, folder), { recursive: true });
  }
  writeText(path.join(coordinationRoot, "README.md"), [
    "# Coordination State",
    "",
    "This branch stores live operational coordination state.",
    "Use `appbuilder` commands instead of manually editing these files.",
    ""
  ].join("\n"));
  writeText(path.join(coordinationRoot, "generated", ".gitignore"), "*\n!.gitignore\n");
  const committed = commitIfChanged(worktree, "coordination: initialize coordination state");
  const pushed = committed ? maybePush(worktree, project.config.coordination_branch) : false;
  console.log(`coordination_branch=${project.config.coordination_branch}`);
  console.log(`coordination_worktree=${path.relative(project.root, worktree)}`);
  console.log(committed ? "status=initialized" : "status=already-initialized");
  if (pushed) console.log("pushed=true");
  return 0;
}

function doctor(cwd) {
  const root = findRoot(cwd);
  const failures = [];
  const warnings = [];
  const checks = [];
  function check(name, ok, detail, level = "fail") {
    checks.push({ name, ok, detail });
    if (!ok) (level === "warn" ? warnings : failures).push(`${name}: ${detail}`);
  }

  check("node", Number(process.versions.node.split(".")[0]) >= 18, `found ${process.versions.node}`);
  const npm = findPackageManager();
  check("package-manager", npm.status === 0, npm.status === 0 ? `npm ${npm.stdout.trim()}` : "npm not found", "warn");
  check("project-root", Boolean(root), root || `${ROOT_CONFIG} not found`);
  if (!root) return printDoctor(checks, failures, warnings);

  let project;
  try {
    project = loadProject(root);
    check("appbuilder-config", true, "valid");
  } catch (error) {
    check("appbuilder-config", false, error.message);
  }

  const requiredDirs = [
    ".agent/rules",
    "cli",
    "core",
    "contracts/schemas/v1",
    "contracts/examples",
    "templates",
    "tools",
    "vault/framework",
    "vault/projects",
    "projects",
    "reports",
    "tests",
    "docs"
  ];
  for (const dir of requiredDirs) check(`folder:${dir}`, fs.existsSync(path.join(root, dir)), "exists");

  for (const schema of REQUIRED_SCHEMA_NAMES) {
    check(`schema:${schema}`, fs.existsSync(path.join(root, "contracts", "schemas", "v1", `${schema}.schema.json`)), "exists");
  }

  const gitOk = isGitRepo(root);
  check("git-repository", gitOk, gitOk ? "inside worktree" : "not a Git repository");
  if (gitOk && project) {
    check("git-remote", hasRemote(root), "origin remote configured", "warn");
    check("git-head", hasAnyCommit(root), "initial commit exists");
    check("coordination-branch", branchExists(root, project.config.coordination_branch), project.config.coordination_branch);
    check("coordination-worktree", fs.existsSync(path.join(root, COORD_WORKTREE)), COORD_WORKTREE);
    const statusResult = git(root, ["status", "--short"], { allowFail: true });
    check("git-status", statusResult.status === 0, statusResult.stdout.trim() || "clean", "warn");
  }

  scanForArtifactVersions(root, failures, warnings);
  return printDoctor(checks, failures, warnings);
}

function findPackageManager() {
  if (process.platform === "win32") {
    const result = spawnSync("cmd.exe", ["/d", "/s", "/c", "npm.cmd --version"], { encoding: "utf8", stdio: "pipe" });
    if (result.status === 0) return result;
  }
  const candidates = ["npm"];
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], { encoding: "utf8", stdio: "pipe" });
    if (result.status === 0) return result;
  }
  return { status: 1, stdout: "", stderr: "npm not found" };
}

function printDoctor(checks, failures, warnings) {
  for (const item of checks) {
    console.log(`${item.ok ? "ok" : "problem"} ${item.name}: ${item.detail}`);
  }
  if (warnings.length) {
    console.log("\nwarnings:");
    for (const warning of warnings) console.log(`- ${warning}`);
  }
  if (failures.length) {
    console.log("\nfailures:");
    for (const failure of failures) console.log(`- ${failure}`);
    return 1;
  }
  console.log("\nappbuilder doctor passed");
  return 0;
}

function scanForArtifactVersions(root, failures, warnings) {
  const artifactNames = new Set([
    "requirements.json",
    "task-plan.json",
    "scaffold-report.json",
    "test-report.json"
  ]);
  for (const file of walk(root, { skip: [".git", ".appbuilder", "node_modules"] })) {
    const base = path.basename(file);
    if (artifactNames.has(base)) {
      try {
        const value = readJson(file);
        if (!value.schema_version) failures.push(`${path.relative(root, file)}: missing schema_version`);
      } catch (error) {
        failures.push(error.message);
      }
    }
    if (["architecture.md", "review-report.md", "ship-checklist.md", "handoff.md"].includes(base)) {
      const text = fs.readFileSync(file, "utf8");
      if (!parseFrontmatter(text)?.data.schema_version) failures.push(`${path.relative(root, file)}: missing schema_version frontmatter`);
    }
  }
}

function walk(root, options = {}) {
  const skip = new Set(options.skip || []);
  const found = [];
  function visit(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(full);
      else found.push(full);
    }
  }
  visit(root);
  return found;
}

function status(cwd) {
  const project = loadProject(cwd);
  let worktree;
  try {
    worktree = ensureCoordinationWorktree(project);
  } catch (error) {
    const generated = baseStatus(project, error.message);
    console.log(JSON.stringify(generated, null, 2));
    return 1;
  }
  const generated = deriveStatus(project, worktree);
  const outputPath = path.join(worktree, project.config.generated_dir, "project-status.json");
  writeJson(outputPath, generated);
  console.log(JSON.stringify(generated, null, 2));
  return generated.blockers.length ? 1 : 0;
}

function baseStatus(project, blocker) {
  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    active_project: project.config.framework_name,
    current_phase: "coordination",
    active_tasks: [],
    expired_claims: [],
    merged_unreleased_claims: [],
    orphaned_branches: [],
    blockers: [blocker],
    last_validated_artifact: null
  };
}

function deriveStatus(project, worktree) {
  const now = Date.now();
  const claims = readClaims(worktree);
  const handoffs = readHandoffs(worktree);
  const activeTasks = [];
  const expiredClaims = [];
  for (const claim of claims) {
    const expires = Date.parse(claim.expires_at);
    if (Number.isFinite(expires) && expires < now) {
      expiredClaims.push({ id: claim.task, owner: claim.owner, claim_expires: claim.expires_at });
    } else {
      activeTasks.push({ id: claim.task, owner: claim.owner, claim_expires: claim.expires_at, heartbeat_at: claim.heartbeat_at, branch: claim.branch });
    }
  }
  return {
    schema_version: "1.0",
    generated_at: new Date().toISOString(),
    active_project: project.config.framework_name,
    current_phase: "coordination",
    active_tasks: activeTasks,
    expired_claims: expiredClaims,
    merged_unreleased_claims: mergedUnreleasedClaims(project.root, claims),
    orphaned_branches: orphanedBranches(project.root, claims),
    blockers: [],
    last_validated_artifact: handoffs.length ? "coordination/handoffs" : null
  };
}

function branchIsAncestorOfMain(root, branch) {
  if (!branch || !branchExists(root, branch)) return false;
  return git(root, ["merge-base", "--is-ancestor", branch, "main"], { allowFail: true }).status === 0;
}

function mergedUnreleasedClaims(root, claims) {
  if (!isGitRepo(root)) return [];
  const merged = [];
  for (const claim of claims) {
    if (branchIsAncestorOfMain(root, claim.branch)) {
      merged.push({ id: claim.task, owner: claim.owner, branch: claim.branch });
    }
  }
  return merged;
}

function listAgentBranches(root) {
  const result = git(root, ["for-each-ref", "--format=%(refname:short)", "refs/heads/agent"], { allowFail: true });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function orphanedBranches(root, claims) {
  if (!isGitRepo(root)) return [];
  const claimed = new Set(claims.map((claim) => claim.branch).filter(Boolean));
  return listAgentBranches(root).filter((branch) => !claimed.has(branch));
}

function readClaims(worktree) {
  const dir = path.join(worktree, "coordination", "claims");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readJson(path.join(dir, file)));
}

function readRegistry(worktree) {
  const dir = path.join(worktree, "coordination", "registry");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => readJson(path.join(dir, file)));
}

function registryEntryFor(worktree, agentId) {
  return readRegistry(worktree).find((entry) => entry.agent_id === agentId) || null;
}

function pathWithinAllowed(file, allowedPaths) {
  const target = normalizePath(file);
  return allowedPaths.some((allowed) => {
    const base = normalizePath(allowed);
    return target === base || target.startsWith(`${base}/`);
  });
}

function readHandoffs(worktree) {
  const dir = path.join(worktree, "coordination", "handoffs");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => path.join(dir, file));
}

function claim(cwd, args) {
  const taskId = args.find((arg) => TASK_ID_RE.test(arg));
  if (args.includes("--refresh")) return refreshClaim(cwd, args);
  if (!taskId) throw new Error("Usage: appbuilder claim <TASK-001> [--force-overlap --reason <text>] or appbuilder claim --refresh <TASK-001>");
  const forceOverlap = args.includes("--force-overlap");
  const reason = readOption(args, "--reason");
  if (forceOverlap && !reason) throw new Error("--force-overlap requires --reason");

  const project = loadProject(cwd);
  const worktree = ensureCoordinationWorktree(project);
  const taskPath = path.join(worktree, "coordination", "queue", `${taskId}.json`);
  if (!fs.existsSync(taskPath)) throw new Error(`Queue task not found on coordination branch: ${taskId}`);
  const task = readJson(taskPath);
  const taskValidation = validateQueueTask(task, project.root);
  if (!taskValidation.ok) throw new Error(`Queue task ${taskId} is invalid:\n${taskValidation.errors.join("\n")}`);

  const claims = readClaims(worktree);
  const existing = claims.find((item) => item.task === taskId);
  if (existing) {
    if (isExpired(existing)) {
      throw new Error(
        `${taskId} has an expired claim by ${existing.owner} (expired ${existing.expires_at}). ` +
        `Reap it first with an audited takeover: appbuilder release --expired ${taskId} --reason <text>.`
      );
    }
    throw new Error(`${taskId} is already claimed by ${existing.owner} until ${existing.expires_at}`);
  }
  const dependencyErrors = dependencyErrorsForTask(task, worktree, project.root);
  if (dependencyErrors.length) throw new Error(`Dependencies are incomplete:\n${dependencyErrors.map((item) => `- ${item}`).join("\n")}`);

  const overlaps = findOverlaps(task, claims, worktree);
  if (overlaps.length && !forceOverlap) {
    throw new Error(`Path overlap detected:\n${overlaps.map((item) => `- ${item}`).join("\n")}\nUse --force-overlap --reason <text> if approved.`);
  }

  const agentId = agentIdFromEnv();
  const registryEntry = registryEntryFor(worktree, agentId);
  if (registryEntry) {
    const registryValidation = validateRegistryEntry(registryEntry, project.root);
    if (!registryValidation.ok) throw new Error(`Registry entry for ${agentId} is invalid:\n${registryValidation.errors.join("\n")}`);
    const outside = (task.files_touched_estimate || []).filter((file) => !pathWithinAllowed(file, registryEntry.allowed_paths || []));
    if (outside.length) {
      throw new Error(
        `Agent ${agentId} is not allowed to touch:\n${outside.map((file) => `- ${file}`).join("\n")}\n` +
        `allowed_paths: ${(registryEntry.allowed_paths || []).join(", ") || "(none)"}`
      );
    }
  }
  const branch = task.branch || `agent/${taskId}-${slug(task.title)}`;
  const now = new Date();
  const expires = new Date(now.getTime() + project.config.claim_ttl_minutes * 60 * 1000);
  const claimDoc = {
    schema_version: "1.0",
    task: taskId,
    owner: agentId,
    branch,
    claimed_at: now.toISOString(),
    heartbeat_at: now.toISOString(),
    expires_at: expires.toISOString(),
    files_touched_estimate: task.files_touched_estimate || [],
    depends_on: task.depends_on || [],
    overlap_override: forceOverlap ? { reason, overlaps } : null
  };
  const claimValidation = validateClaim(claimDoc, project.root);
  if (!claimValidation.ok) throw new Error(`Generated claim is invalid:\n${claimValidation.errors.join("\n")}`);
  writeJson(path.join(worktree, "coordination", "claims", `${taskId}.json`), claimDoc);
  commitIfChanged(worktree, `coordination: claim ${taskId} by ${agentId}`);
  try {
    maybePush(worktree, project.config.coordination_branch);
  } catch (error) {
    if (error.code !== "ECOORDINATIONRACE") throw error;
    const winner = readClaims(worktree).find((item) => item.task === taskId);
    const detail = winner
      ? `${taskId} is now claimed by ${winner.owner} until ${winner.expires_at}.`
      : "Run appbuilder status and retry.";
    throw new Error(`Claim for ${taskId} lost the race to another agent. ${detail}`);
  }

  if (isGitRepo(project.root)) {
    if (branchExists(project.root, branch)) git(project.root, ["checkout", branch], { capture: false });
    else git(project.root, ["checkout", "-b", branch], { capture: false });
  }
  console.log(`claimed ${taskId}`);
  console.log(`agent=${agentId}`);
  console.log(`branch=${branch}`);
  return 0;
}

function refreshClaim(cwd, args) {
  const taskId = args.find((arg) => TASK_ID_RE.test(arg));
  if (!taskId) throw new Error("Usage: appbuilder claim --refresh <TASK-001>");
  const project = loadProject(cwd);
  const worktree = ensureCoordinationWorktree(project);
  const claimPath = path.join(worktree, "coordination", "claims", `${taskId}.json`);
  if (!fs.existsSync(claimPath)) throw new Error(`Claim not found: ${taskId}`);
  const claimDoc = readJson(claimPath);
  const validation = validateClaim(claimDoc, project.root);
  if (!validation.ok) throw new Error(`Claim ${taskId} is invalid:\n${validation.errors.join("\n")}`);
  if (isExpired(claimDoc)) throw new Error(`${taskId} expired at ${claimDoc.expires_at}; use release --expired with a reason before reclaiming.`);
  const now = new Date();
  claimDoc.heartbeat_at = now.toISOString();
  claimDoc.expires_at = new Date(now.getTime() + project.config.claim_ttl_minutes * 60 * 1000).toISOString();
  const nextValidation = validateClaim(claimDoc, project.root);
  if (!nextValidation.ok) throw new Error(`Refreshed claim is invalid:\n${nextValidation.errors.join("\n")}`);
  writeJson(claimPath, claimDoc);
  commitIfChanged(worktree, `coordination: refresh ${taskId} by ${claimDoc.owner}`);
  maybePush(worktree, project.config.coordination_branch);
  console.log(`refreshed ${taskId}`);
  console.log(`heartbeat_at=${claimDoc.heartbeat_at}`);
  console.log(`expires_at=${claimDoc.expires_at}`);
  return 0;
}

function readOption(args, option) {
  const index = args.indexOf(option);
  if (index === -1) return null;
  return args[index + 1] || null;
}

function isExpired(claim) {
  const expires = Date.parse(claim.expires_at);
  return Number.isFinite(expires) && expires < Date.now();
}

function agentIdFromEnv() {
  return process.env.APPBUILDER_AGENT_ID || `${os.userInfo().username || "agent"}@${os.hostname()}`;
}

function slug(value) {
  return String(value || "task")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "task";
}

function dependencyErrorsForTask(task, worktree, root) {
  const errors = [];
  for (const dependency of task.depends_on || []) {
    const complete = latestValidHandoff(worktree, dependency, root)?.data.status === "complete";
    if (!complete) errors.push(`${dependency} does not have a valid complete handoff`);
  }
  return errors;
}

function latestValidHandoff(worktree, taskId, root) {
  const handoffs = readHandoffs(worktree)
    .filter((file) => path.basename(file).startsWith(`${taskId}--`))
    .sort();
  for (const file of handoffs.reverse()) {
    const validation = validateHandoff(file, root);
    if (validation.ok) return validation;
  }
  return null;
}

function findOverlaps(task, claims, worktree) {
  const taskPaths = task.files_touched_estimate || [];
  const overlaps = [];
  for (const claim of claims) {
    if (isExpired(claim)) continue;
    if (claim.task === task.id) continue;
    const otherPaths = claim.files_touched_estimate || taskPathsForClaim(claim, worktree);
    for (const left of taskPaths) {
      for (const right of otherPaths) {
        if (pathsOverlap(left, right)) overlaps.push(`${task.id}:${left} overlaps ${claim.task}:${right}`);
      }
    }
  }
  return overlaps;
}

function taskPathsForClaim(claim, worktree) {
  const taskPath = path.join(worktree, "coordination", "queue", `${claim.task}.json`);
  if (!fs.existsSync(taskPath)) return [];
  return readJson(taskPath).files_touched_estimate || [];
}

function pathsOverlap(left, right) {
  const a = normalizePath(left);
  const b = normalizePath(right);
  return a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

function normalizePath(value) {
  return String(value || "").replace(/\\/g, "/").replace(/\/+$/, "");
}

function release(cwd, args) {
  const taskId = args.find((arg) => TASK_ID_RE.test(arg));
  if (!taskId) throw new Error("Usage: appbuilder release <TASK-001> [--reason <text>] or appbuilder release --expired <TASK-001> --reason <text>");
  const project = loadProject(cwd);
  const worktree = ensureCoordinationWorktree(project);
  const claimPath = path.join(worktree, "coordination", "claims", `${taskId}.json`);
  if (!fs.existsSync(claimPath)) throw new Error(`Claim not found: ${taskId}`);
  const claimDoc = readJson(claimPath);
  const validation = validateClaim(claimDoc, project.root);
  if (!validation.ok) throw new Error(`Claim ${taskId} is invalid:\n${validation.errors.join("\n")}`);
  const reason = readOption(args, "--reason") || "Human orchestrator released after merge or explicit approval.";
  const expiredRelease = args.includes("--expired");
  if (expiredRelease && !readOption(args, "--reason")) throw new Error("release --expired requires --reason");
  if (expiredRelease && !isExpired(claimDoc)) throw new Error(`${taskId} is not expired; use release without --expired after merge approval.`);
  fs.unlinkSync(claimPath);
  const reaper = agentIdFromEnv();
  const message = expiredRelease
    ? `coordination: reap expired claim ${taskId} by ${reaper} - ${reason}`
    : `coordination: release ${taskId} by ${reaper} - ${reason}`;
  commitIfChanged(worktree, message);
  maybePush(worktree, project.config.coordination_branch);
  console.log(expiredRelease ? `reaped expired ${taskId}` : `released ${taskId}`);
  return 0;
}

function handoff(cwd, args) {
  const taskId = readOption(args, "--task") || inferTaskFromBranch(loadProject(cwd).root);
  if (!TASK_ID_RE.test(taskId || "")) throw new Error("Usage: appbuilder handoff --task TASK-001 [--status complete|partial|blocked|abandoned]");
  const statusValue = readOption(args, "--status") || "partial";
  if (!["complete", "partial", "blocked", "abandoned"].includes(statusValue)) throw new Error(`Invalid handoff status: ${statusValue}`);
  const project = loadProject(cwd);
  const worktree = ensureCoordinationWorktree(project);
  const branch = currentBranch(project.root) || "unknown";
  const agent = agentIdFromEnv();
  const changedFiles = changedFilesForHandoff(project.root);
  const blockers = readOption(args, "--blocker") ? [readOption(args, "--blocker")] : [];
  const warnings = readOption(args, "--warning") ? [readOption(args, "--warning")] : [];
  const tests = resolveTestResults(args);
  const timestamp = compactTimestamp(new Date());
  const file = path.join(worktree, "coordination", "handoffs", `${taskId}--${safeAgent(agent)}--${timestamp}.md`);
  const body = buildHandoffMarkdown({
    taskId,
    agent,
    branch,
    status: statusValue,
    filesChanged: changedFiles,
    blockers,
    warnings,
    testsRun: tests.run,
    testsPassed: tests.passed,
    nextRecommendedTask: readOption(args, "--next") || ""
  });
  writeText(file, body);
  const validation = validateHandoff(file, project.root);
  if (!validation.ok) throw new Error(`Generated handoff is invalid:\n${validation.errors.join("\n")}`);
  commitIfChanged(worktree, `coordination: handoff ${taskId} by ${agent}`);
  maybePush(worktree, project.config.coordination_branch);
  console.log(`handoff=${path.relative(worktree, file)}`);
  return 0;
}

function resolveTestResults(args) {
  const passedFlag = args.includes("--tests-passed");
  const failedFlag = args.includes("--tests-failed");
  if (passedFlag && failedFlag) throw new Error("Pass only one of --tests-passed or --tests-failed.");
  const run = args.includes("--tests-run") || passedFlag || failedFlag;
  return { run, passed: run ? passedFlag : false };
}

function inferTaskFromBranch(root) {
  const match = /(TASK-\d{3,})/.exec(currentBranch(root));
  return match ? match[1] : null;
}

function changedFilesForHandoff(root) {
  const base = git(root, ["merge-base", "HEAD", "main"], { allowFail: true });
  const args = base.status === 0 && base.stdout.trim()
    ? ["diff", "--name-only", `${base.stdout.trim()}...HEAD`]
    : ["diff", "--name-only", "HEAD"];
  const result = git(root, args, { allowFail: true });
  if (result.status !== 0) return [];
  return result.stdout.split(/\r?\n/).filter(Boolean);
}

function compactTimestamp(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function safeAgent(agent) {
  return String(agent).replace(/[^A-Za-z0-9_.-]+/g, "-").slice(0, 64);
}

function yamlList(values) {
  if (!values || values.length === 0) return "[]";
  return `\n${values.map((item) => `  - "${String(item).replace(/"/g, '\\"')}"`).join("\n")}`;
}

function buildHandoffMarkdown(input) {
  return `---
schema_version: "1.0"
task: ${input.taskId}
agent: "${input.agent}"
branch: "${input.branch}"
status: ${input.status}
files_changed:${yamlList(input.filesChanged)}
tests_run: ${input.testsRun === true}
tests_passed: ${input.testsPassed === true}
blockers:${yamlList(input.blockers)}
next_recommended_task: "${input.nextRecommendedTask}"
warnings:${yamlList(input.warnings)}
---

# Agent Handoff

## What I worked on

See the branch diff for implementation details.

## Files changed

${input.filesChanged.length ? input.filesChanged.map((file) => `- ${file}`).join("\n") : "None detected."}

## Decisions made

No additional decisions recorded.

## Blockers

${input.blockers.length ? input.blockers.map((item) => `- ${item}`).join("\n") : "None."}

## Tests run

${input.testsRun === true ? (input.testsPassed === true ? "Test suite ran and passed." : "Test suite ran and FAILED.") : "Not run by this handoff."}

## Next recommended task

${input.nextRecommendedTask || "None."}

## Warnings for next agent

${input.warnings.length ? input.warnings.map((item) => `- ${item}`).join("\n") : "None."}
`;
}

function ready(cwd, args) {
  const taskId = args.find((arg) => TASK_ID_RE.test(arg));
  if (!taskId) throw new Error("Usage: appbuilder ready <TASK-001>");
  const project = loadProject(cwd);
  const worktree = ensureCoordinationWorktree(project);
  const failures = [];
  const warnings = [];

  const taskPath = path.join(worktree, "coordination", "queue", `${taskId}.json`);
  if (!fs.existsSync(taskPath)) failures.push(`Task not found: ${taskId}`);
  const task = fs.existsSync(taskPath) ? readJson(taskPath) : null;
  if (task) {
    const validation = validateQueueTask(task, project.root);
    if (!validation.ok) failures.push(`Task invalid: ${validation.errors.join(", ")}`);
    failures.push(...dependencyErrorsForTask(task, worktree, project.root));
  }

  const claimPath = path.join(worktree, "coordination", "claims", `${taskId}.json`);
  if (!fs.existsSync(claimPath)) failures.push(`Claim not found: ${taskId}`);
  const claimDoc = fs.existsSync(claimPath) ? readJson(claimPath) : null;
  if (claimDoc) {
    const validation = validateClaim(claimDoc, project.root);
    if (!validation.ok) failures.push(`Claim invalid: ${validation.errors.join(", ")}`);
    if (isExpired(claimDoc)) failures.push(`Claim expired at ${claimDoc.expires_at}`);
    const branch = currentBranch(project.root);
    if (branch && claimDoc.branch !== branch) warnings.push(`Current branch ${branch} does not match claim branch ${claimDoc.branch}`);
  }

  const handoffValidation = latestValidHandoff(worktree, taskId, project.root);
  if (!handoffValidation) failures.push(`No valid handoff found for ${taskId}`);
  else {
    if (handoffValidation.data.status !== "complete") failures.push(`Latest valid handoff status is ${handoffValidation.data.status}, not complete`);
    if (handoffValidation.data.tests_run === true) {
      if (handoffValidation.data.tests_passed !== true) failures.push("Latest handoff reports tests ran but did not pass; fix tests before merge");
    } else {
      warnings.push("Latest handoff reports tests were not run; run the suite and record it with handoff --tests-run --tests-passed");
    }
  }

  const changedFiles = changedFilesForHandoff(project.root);
  for (const file of changedFiles) {
    if (file.startsWith("coordination/") || file.startsWith(".appbuilder/")) failures.push(`Forbidden changed file in task branch: ${file}`);
    if (looksLikeSecret(file, project.root)) failures.push(`Possible secret in changed file: ${file}`);
  }

  for (const warning of warnings) console.log(`warn ${warning}`);
  if (failures.length) {
    for (const failure of failures) console.log(`fail ${failure}`);
    return 1;
  }
  console.log(`${taskId} is ready for human merge review`);
  return 0;
}

function looksLikeSecret(file, root) {
  const full = path.join(root, file);
  if (!fs.existsSync(full) || fs.statSync(full).size > 1024 * 1024) return false;
  const text = fs.readFileSync(full, "utf8");
  return /(api[_-]?key|secret|password|token)\s*[:=]\s*['"]?[A-Za-z0-9_\-.]{16,}/i.test(text);
}

function events(cwd) {
  const project = loadProject(cwd);
  const worktree = ensureCoordinationWorktree(project);
  const result = git(worktree, ["log", "--date=iso-strict", "--pretty=format:%H%x09%aI%x09%s"], { allowFail: true });
  if (result.status !== 0) throw new Error("Unable to derive events from coordination history.");
  const rows = result.stdout.split(/\r?\n/).filter(Boolean).map((line) => {
    const [commit, at, ...messageParts] = line.split("\t");
    return { schema_version: "1.0", commit, at, message: messageParts.join("\t") };
  });
  const outputPath = path.join(worktree, project.config.generated_dir, "events.jsonl");
  writeText(outputPath, rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
  for (const row of rows) console.log(JSON.stringify(row));
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = {
  main,
  maybePush,
  syncCoordinationWorktree,
  validateAppbuilderConfig,
  validateQueueTask,
  validateClaim,
  validateHandoff,
  parseFrontmatter,
  buildHandoffMarkdown,
  pathsOverlap,
  slug
};
