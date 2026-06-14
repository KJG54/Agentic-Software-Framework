"use strict";

// The build phase: the deterministic checkpoint between scaffold and test. There is no LLM
// here — the agent writes the real code into build/<slug>/, and these commands only seed an
// accounting stub (build init) and validate the agent's declared work against the plan and the
// files on disk (build). build init mirrors `plan new`; the default gate mirrors `scaffold`.

const fs = require("fs");
const path = require("path");
const { readJson, writeJson } = require("./util");
const { loadProject, validateBuildManifest } = require("./validate");
const { compilePlan } = require("./plan");

function build(cwd, args = []) {
  if (args[0] === "init") return buildInit(cwd, args.slice(1));
  // The validation gate (default verb) arrives in TASK-703.
  console.log("build <slug> validation gate is not implemented yet. Use: appbuilder build init <slug>");
  return 1;
}

function resolveSlug(args) {
  const slug = args.find((arg) => !arg.startsWith("--"));
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error("Usage: appbuilder build init <project-slug> [--force]");
  }
  return slug;
}

function buildInit(cwd, args) {
  const slug = resolveSlug(args);
  const force = args.includes("--force");
  const project = loadProject(cwd);

  // Gate: you cannot build what was not scaffolded.
  const buildDir = path.join(project.root, "build", slug);
  const scaffoldReportPath = path.join(buildDir, "scaffold-report.json");
  if (!fs.existsSync(scaffoldReportPath)) {
    throw new Error(`No scaffold report for ${slug} (expected build/${slug}/scaffold-report.json). Run appbuilder scaffold ${slug} first.`);
  }

  // The plan must compile so the task list is authoritative.
  const compiled = compilePlan(project, slug);
  if (!compiled.ok) {
    for (const line of compiled.lines) console.log(line);
    console.log("fail build init: plan must compile before seeding a manifest");
    return 1;
  }

  const manifestPath = path.join(buildDir, "build-manifest.json");
  if (fs.existsSync(manifestPath) && !force) {
    throw new Error(`build/${slug}/build-manifest.json already exists. Re-run with --force to re-seed.`);
  }

  const tasks = (compiled.taskPlan.tasks || []).map((task) => ({
    id: task.id,
    status: "pending",
    files: [],
    reason: ""
  }));
  const manifest = {
    schema_version: "1.0",
    project: slug,
    tasks
  };
  const validation = validateBuildManifest(manifest, project.root);
  if (!validation.ok) throw new Error(`Generated build manifest is invalid:\n${validation.errors.join("\n")}`);
  writeJson(manifestPath, manifest);

  console.log(`build init ${slug}`);
  console.log(`manifest=build/${slug}/build-manifest.json`);
  console.log(`tasks=${tasks.length} (all pending)`);
  console.log(`next: implement each task, set its status (done|skipped) + files in the manifest, then appbuilder build ${slug}`);
  return 0;
}

module.exports = {
  build
};
