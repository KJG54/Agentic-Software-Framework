"use strict";

// The build phase: the deterministic checkpoint between scaffold and test. There is no LLM
// here — the agent writes the real code into build/<slug>/, and these commands only seed an
// accounting stub (build init) and validate the agent's declared work against the plan and the
// files on disk (build). build init mirrors `plan new`; the default gate mirrors `scaffold`.

const fs = require("fs");
const path = require("path");
const { readJson, writeJson } = require("./util");
const { loadProject, validateBuildManifest, validateBuildReport } = require("./validate");
const { compilePlan } = require("./plan");

function build(cwd, args = []) {
  if (args[0] === "init") return buildInit(cwd, args.slice(1));
  return buildGate(cwd, args);
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

function buildGate(cwd, args) {
  const slug = args.find((arg) => !arg.startsWith("--"));
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error("Usage: appbuilder build <project-slug>");
  }
  const project = loadProject(cwd);
  const buildDir = path.join(project.root, "build", slug);
  const manifestPath = path.join(buildDir, "build-manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No build manifest for ${slug} (expected build/${slug}/build-manifest.json). Run appbuilder build init ${slug} first.`);
  }

  // The plan must compile so its task ids are authoritative.
  const compiled = compilePlan(project, slug);
  if (!compiled.ok) {
    for (const line of compiled.lines) console.log(line);
    console.log("fail build: plan must compile before validating the build");
    return 1;
  }

  const manifest = readJson(manifestPath);
  const failures = [];

  const manifestValidation = validateBuildManifest(manifest, project.root);
  if (!manifestValidation.ok) failures.push(...manifestValidation.errors.map((error) => `manifest: ${error}`));

  const tasks = Array.isArray(manifest.tasks) ? manifest.tasks : [];
  const planIds = (compiled.taskPlan.tasks || []).map((task) => task.id);
  const manifestIds = tasks.map((task) => task.id);
  for (const id of planIds) {
    if (!manifestIds.includes(id)) failures.push(`manifest is missing plan task ${id}`);
  }
  for (const id of manifestIds) {
    if (!planIds.includes(id)) failures.push(`manifest task ${id} is not in the plan`);
  }

  let done = 0;
  let skipped = 0;
  const filesTouched = new Set();
  for (const task of tasks) {
    if (task.status === "pending") {
      failures.push(`task ${task.id} is still pending`);
    } else if (task.status === "done") {
      done += 1;
      const files = Array.isArray(task.files) ? task.files : [];
      if (files.length === 0) failures.push(`done task ${task.id} must list at least one file`);
      for (const rel of files) {
        if (!fs.existsSync(path.join(buildDir, rel))) failures.push(`done task ${task.id} lists a missing file: ${rel}`);
        else filesTouched.add(rel);
      }
    } else if (task.status === "skipped") {
      skipped += 1;
      if (!String(task.reason || "").trim()) failures.push(`skipped task ${task.id} must carry a reason`);
    }
  }

  // Scaffold must not have regressed: the files it rendered still have to exist.
  const scaffoldReportPath = path.join(buildDir, "scaffold-report.json");
  if (!fs.existsSync(scaffoldReportPath)) {
    failures.push(`scaffold report missing: build/${slug}/scaffold-report.json`);
  } else {
    const scaffoldReport = readJson(scaffoldReportPath);
    for (const rel of scaffoldReport.rendered_files || []) {
      if (!fs.existsSync(path.join(buildDir, rel))) failures.push(`scaffold file no longer exists: ${rel}`);
    }
  }

  if (failures.length) {
    for (const failure of failures) console.log(`fail build: ${failure}`);
    return 1;
  }

  const report = {
    schema_version: "1.0",
    project: slug,
    generated_at: new Date().toISOString(),
    tasks_total: tasks.length,
    tasks_done: done,
    tasks_skipped: skipped,
    files_touched: [...filesTouched].sort()
  };
  const reportValidation = validateBuildReport(report, project.root);
  if (!reportValidation.ok) throw new Error(`Generated build report is invalid:\n${reportValidation.errors.join("\n")}`);
  writeJson(path.join(buildDir, "build-report.json"), report);

  console.log(`build ${slug}`);
  console.log(`tasks=${tasks.length} done=${done} skipped=${skipped}`);
  console.log(`report=build/${slug}/build-report.json`);
  return 0;
}

module.exports = {
  build
};
