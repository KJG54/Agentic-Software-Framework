#!/usr/bin/env node
"use strict";

// Command router for the appbuilder CLI. The command implementations live in cli/lib/*:
// util (primitives), git (git wrappers), validate (artifact + config validation seam),
// coordination (the control plane), and plan (the planning flow). This file dispatches to
// them and owns doctor (the cross-cutting diagnostic). The module.exports surface below is
// the stable API the test suite and any embedders depend on.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { ROOT_CONFIG, COORD_WORKTREE, findRoot, readJson, walk, slug } = require("./lib/util");
const {
  isGitRepo,
  hasAnyCommit,
  currentBranch,
  branchExists,
  hasRemote,
  git
} = require("./lib/git");
const {
  loadProject,
  validateAppbuilderConfig,
  validateQueueTask,
  validateClaim,
  validateHandoff,
  validateScaffoldReport,
  parseFrontmatter
} = require("./lib/validate");
const {
  initCoordination,
  status,
  claim,
  release,
  handoff,
  ready,
  events,
  maybePush,
  syncCoordinationWorktree,
  buildHandoffMarkdown,
  pathsOverlap
} = require("./lib/coordination");
const { plan } = require("./lib/plan");
const { scaffold } = require("./lib/scaffold");

const REQUIRED_SCHEMA_NAMES = ["appbuilder-config", "queue-task", "claim", "handoff", "registry", "template", "mcp-profile", "requirements", "task-plan", "scaffold-report"];

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
        return status(cwd, args);
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
      case "plan":
        return plan(cwd, args);
      case "scaffold":
        return scaffold(cwd, args);
      case "start":
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

Planning commands:
  plan new <slug>          Scaffold a project plan (requirements, architecture, task-plan)
  plan compile <slug>      Validate requirements and the task plan
  plan seed <slug>         Publish the plan's tasks to the coordination queue
  scaffold <slug>          Render the build-type skeleton into build/<slug> (--force to overwrite)

Later-phase workflow placeholders:
  start build test review ship`);
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

  // Agent onboarding: the framework is only drivable if an agent dropped into the repo
  // auto-loads its charter. AGENTS.md is the canonical source; CLAUDE.md must point at it.
  check("onboarding:AGENTS.md", fs.existsSync(path.join(root, "AGENTS.md")), "exists");
  const claudePath = path.join(root, "CLAUDE.md");
  if (!fs.existsSync(claudePath)) {
    check("onboarding:CLAUDE.md", false, "missing");
  } else {
    const refsAgents = /AGENTS\.md/.test(fs.readFileSync(claudePath, "utf8"));
    check("onboarding:CLAUDE.md", refsAgents, refsAgents ? "references AGENTS.md" : "present but does not reference AGENTS.md");
  }

  // Plan-interview drift guard: the build-type interview is part of the /plan contract.
  // The guide must exist and stay referenced from every operator surface — the two agent
  // surfaces (plan.md, AGENTS.md) and the human HOWTO — or /plan silently drifts back to
  // "just fill in requirements" on whichever surface lost the link.
  const interviewRel = ".agent/plan-interview.md";
  const interviewExists = fs.existsSync(path.join(root, interviewRel));
  check("plan-interview:guide", interviewExists, interviewExists ? "exists" : `${interviewRel} missing`);
  const surfaces = [
    { name: "plan-interview:plan.md", file: path.join(".claude", "commands", "plan.md") },
    { name: "plan-interview:AGENTS.md", file: "AGENTS.md" },
    { name: "plan-interview:HOWTO.md", file: "HOWTO.md" }
  ];
  for (const { name, file } of surfaces) {
    const surfacePath = path.join(root, file);
    if (!fs.existsSync(surfacePath)) {
      check(name, false, `${file} missing`);
      continue;
    }
    const refs = fs.readFileSync(surfacePath, "utf8").includes("plan-interview.md");
    check(name, refs, refs ? `references ${interviewRel}` : `present but does not reference ${interviewRel}`);
  }

  const gitOk = isGitRepo(root);
  check("git-repository", gitOk, gitOk ? "inside worktree" : "not a Git repository");
  if (gitOk && project) {
    check("git-remote", hasRemote(root), "origin remote configured", "warn");
    check("git-head", hasAnyCommit(root), "initial commit exists");
    check("coordination-branch", branchExists(root, project.config.coordination_branch), project.config.coordination_branch);
    check("coordination-worktree", fs.existsSync(path.join(root, COORD_WORKTREE)), COORD_WORKTREE);
    // Live coordination state (claims/queue/handoffs) belongs only on the coordination branch,
    // reached through the internal .appbuilder worktree. If it is tracked on a normal branch
    // (e.g. leaked in by a stray merge), agents can read a stale, contradictory mirror — so fail.
    if (currentBranch(root) !== project.config.coordination_branch) {
      const tracked = git(root, ["ls-files", "coordination/claims", "coordination/queue", "coordination/handoffs"], { allowFail: true });
      const trackedFiles = (tracked.stdout || "").split("\n").map((line) => line.trim()).filter(Boolean);
      const cleanState = trackedFiles.length === 0;
      check(
        "coordination:tracked-state",
        cleanState,
        cleanState ? "no live coordination state tracked on this branch" : `tracked here (belongs on ${project.config.coordination_branch}): ${trackedFiles.join(", ")}`
      );
    }
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
  validateScaffoldReport,
  parseFrontmatter,
  buildHandoffMarkdown,
  pathsOverlap,
  slug
};
