"use strict";

// The scaffold phase: deterministically render a build-type project skeleton from an approved
// plan into build/<slug>/. No LLM — copy the template's files/ tree and substitute a small,
// documented set of {{variables}} from requirements.json. Gates on compilePlan so a project is
// only scaffolded once its plan is valid.

const fs = require("fs");
const path = require("path");
const { readJson, writeJson } = require("./util");
const { loadProject, validateScaffoldReport } = require("./validate");
const { compilePlan } = require("./plan");

// The documented substitution variables. Intentionally small; extend deliberately.
function templateVars(requirements, slug) {
  return {
    slug,
    summary: requirements.summary || ""
  };
}

function substitute(content, vars) {
  return content.replace(/\{\{(\w+)\}\}/g, (match, key) => (key in vars ? vars[key] : match));
}

function renderTree(srcDir, destDir, vars) {
  const produced = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      const rel = path.relative(srcDir, full).replace(/\\/g, "/");
      const out = path.join(destDir, rel);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, substitute(fs.readFileSync(full, "utf8"), vars));
      produced.push(rel);
    }
  }
  visit(srcDir);
  return produced.sort();
}

function scaffold(cwd, args = []) {
  const slug = args.find((arg) => !arg.startsWith("--"));
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error("Usage: appbuilder scaffold <project-slug> [--force]");
  }
  const force = args.includes("--force");
  const project = loadProject(cwd);

  // Gate: the plan must compile before we scaffold from it.
  const compiled = compilePlan(project, slug);
  if (!compiled.ok) {
    for (const line of compiled.lines) console.log(line);
    console.log("fail scaffold: plan must compile before scaffolding");
    return 1;
  }

  const requirements = compiled.requirements;
  const buildType = requirements.build_type;
  if (!buildType) {
    throw new Error(
      `scaffold requires requirements.build_type for ${slug}. ` +
      `Set a build_type (game|cli|app|library|other) in projects/${slug}/requirements.json.`
    );
  }

  const templateDir = path.join(project.root, "templates", buildType);
  const manifestPath = path.join(templateDir, "template.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`No template for build_type "${buildType}" yet (expected templates/${buildType}/template.json).`);
  }
  const manifest = readJson(manifestPath);
  const filesDir = path.join(templateDir, "files");

  const outputRel = `build/${slug}`;
  const outDir = path.join(project.root, "build", slug);
  if (fs.existsSync(outDir)) {
    if (!force) throw new Error(`${outputRel} already exists. Re-run with --force to overwrite.`);
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  const renderedFiles = renderTree(filesDir, outDir, templateVars(requirements, slug));

  const missing = (manifest.required_files || []).filter((rel) => !renderedFiles.includes(rel));
  if (missing.length) {
    throw new Error(`Template "${buildType}" did not produce required files: ${missing.join(", ")}`);
  }

  const report = {
    schema_version: "1.0",
    project: slug,
    build_type: buildType,
    template: manifest.id,
    generated_at: new Date().toISOString(),
    output_dir: outputRel,
    rendered_files: renderedFiles
  };
  const validation = validateScaffoldReport(report, project.root);
  if (!validation.ok) throw new Error(`Generated scaffold report is invalid:\n${validation.errors.join("\n")}`);
  writeJson(path.join(outDir, "scaffold-report.json"), report);

  console.log(`scaffolded ${slug}`);
  console.log(`build_type=${buildType}`);
  console.log(`output_dir=${outputRel}`);
  console.log(`files=${renderedFiles.length}`);
  return 0;
}

module.exports = {
  scaffold
};
