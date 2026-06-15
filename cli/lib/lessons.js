"use strict";

// The lessons / memory layer: capture a lesson after work (`lesson add`) and retrieve relevant
// prior lessons at plan time (`lessons [query]`). File-based and keyword-searched first — a
// vector DB is a future step, recorded via an ADR if ever taken.
//
// Like decision.js this is a WORKING-BRANCH writer: it never touches the coordination worktree,
// so lessons live in the Obsidian vault on the working branch and ride the normal task-branch PR
// to main — they must never land on the coordination branch (doctor's coordination:tracked-state
// guard would trip, and humans/Obsidian couldn't see them). Capture validates BEFORE writing, so
// a malformed lesson never lands; retrieval is strictly read-only.

const fs = require("fs");
const path = require("path");
const { writeText, slug, walk } = require("./util");
const { loadProject, validateLesson, parseFrontmatter } = require("./validate");

function readOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1 || index === args.length - 1) return undefined;
  return args[index + 1];
}

function readAll(args, name) {
  const values = [];
  for (let i = 0; i < args.length - 1; i += 1) {
    if (args[i] === name) values.push(args[i + 1]);
  }
  return values;
}

// --- capture: `appbuilder lesson add ...` ----------------------------------

function lesson(cwd, args = []) {
  const sub = args[0];
  if (sub !== "add") {
    throw new Error("Usage: appbuilder lesson add --project <p> --context <c> --rule <r> (--worked <w> | --failed <f>) [--date YYYY-MM-DD] [--tag <t> ...] [--force]");
  }
  const rest = args.slice(1);
  const project = loadProject(cwd);

  const projectName = readOption(rest, "--project");
  const context = readOption(rest, "--context");
  const rule = readOption(rest, "--rule");
  const worked = readOption(rest, "--worked");
  const failed = readOption(rest, "--failed");
  const date = readOption(rest, "--date") || new Date().toISOString().slice(0, 10);
  const tags = readAll(rest, "--tag");
  const force = rest.includes("--force");

  const missing = [];
  if (!projectName) missing.push("--project");
  if (!context) missing.push("--context");
  if (!rule) missing.push("--rule");
  if (missing.length) throw new Error(`lesson add is missing required flags: ${missing.join(", ")}`);
  if (!worked && !failed) {
    throw new Error("lesson add needs at least one of --worked or --failed (a lesson with neither has no content)");
  }

  const frontmatter = {
    schema_version: "1.0",
    project: projectName,
    context,
    reusable_rule: rule,
    date
  };
  if (worked) frontmatter.what_worked = worked;
  if (failed) frontmatter.what_failed = failed;
  if (tags.length) frontmatter.tags = tags;

  const validation = validateLesson(frontmatter, project.root);
  if (!validation.ok) {
    throw new Error(`Generated lesson is invalid:\n${validation.errors.map((e) => `- ${e}`).join("\n")}`);
  }

  const lessonsDir = path.join(project.root, project.config.vault_framework_dir, "lessons");
  const file = path.join(lessonsDir, `${date}-${slug(projectName)}-${slug(rule)}.md`);
  if (fs.existsSync(file) && !force) {
    throw new Error(`${path.basename(file)} already exists. Re-run with --force to overwrite.`);
  }
  writeText(file, renderLesson(frontmatter));

  const rel = path.relative(project.root, file).replace(/\\/g, "/");
  console.log(`lesson ${rel}`);
  console.log(`rule="${rule}"`);
  return 0;
}

function renderLesson(fm) {
  const lines = [
    "---",
    `schema_version: "${fm.schema_version}"`,
    `project: ${quote(fm.project)}`,
    `context: ${quote(fm.context)}`,
    `reusable_rule: ${quote(fm.reusable_rule)}`,
    `date: ${fm.date}`
  ];
  if (fm.what_worked) lines.push(`what_worked: ${quote(fm.what_worked)}`);
  if (fm.what_failed) lines.push(`what_failed: ${quote(fm.what_failed)}`);
  if (fm.tags) {
    lines.push("tags:");
    for (const tag of fm.tags) lines.push(`  - ${quote(tag)}`);
  }
  lines.push(
    "---",
    "",
    `# Lesson: ${fm.reusable_rule}`,
    "",
    "## Context",
    "",
    fm.context,
    ""
  );
  if (fm.what_worked) lines.push("## What worked", "", fm.what_worked, "");
  if (fm.what_failed) lines.push("## What failed", "", fm.what_failed, "");
  lines.push("## Reusable rule", "", fm.reusable_rule, "");
  return lines.join("\n");
}

function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

// --- retrieve: `appbuilder lessons [query]` (read-only) --------------------

function lessons(cwd, args = []) {
  const project = loadProject(cwd);
  const limit = Number(readOption(args, "--limit")) || 3;
  // Drop --limit and the value right after it, plus any other --flags; the rest is the query.
  const query = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--limit") { i += 1; continue; }
    if (args[i].startsWith("--")) continue;
    query.push(args[i]);
  }

  const dirs = [
    path.join(project.root, project.config.vault_framework_dir, "lessons"),
    path.join(project.root, project.config.vault_projects_dir)
  ];
  const files = [];
  for (const dir of dirs) {
    for (const file of walk(dir, { skip: [".obsidian"] })) {
      if (file.endsWith(".md") && !path.basename(file).startsWith(".")) files.push(file);
    }
  }

  const tokens = query.join(" ").toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
  const scored = files.map((file) => ({ file, ...summarize(file) }));

  let results;
  if (tokens.length === 0) {
    // No query: most recent first (filenames are date-prefixed, so name sort == recency).
    results = scored.sort((a, b) => path.basename(b.file).localeCompare(path.basename(a.file)));
  } else {
    results = scored
      .map((entry) => ({ ...entry, score: scoreEntry(entry, tokens) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  const top = results.slice(0, limit);
  for (const entry of top) {
    const rel = path.relative(project.root, entry.file).replace(/\\/g, "/");
    console.log(`- ${rel}`);
    console.log(`  ${entry.date || "?"} · ${entry.project || "?"} · ${entry.rule}`);
  }
  console.log(`matched=${tokens.length === 0 ? top.length : results.length}`);
  return 0;
}

// Pull a compact summary from a lesson/note file: date, project, and the reusable rule (falling
// back to the first non-empty body line for plain notes without lesson frontmatter).
function summarize(file) {
  const text = fs.readFileSync(file, "utf8");
  const parsed = parseFrontmatter(text);
  const data = (parsed && parsed.data) || {};
  let rule = typeof data.reusable_rule === "string" ? data.reusable_rule : "";
  if (!rule) {
    const body = parsed ? text.slice(text.indexOf("\n---", 4) + 4) : text;
    const firstLine = body.split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith("#"));
    rule = firstLine || "(no summary)";
  }
  return {
    text,
    date: typeof data.date === "string" ? data.date : "",
    project: typeof data.project === "string" ? data.project : "",
    rule
  };
}

function scoreEntry(entry, tokens) {
  const base = path.basename(entry.file).toLowerCase();
  const body = entry.text.toLowerCase();
  const fmText = `${entry.project} ${entry.rule} ${entry.date}`.toLowerCase();
  let score = 0;
  for (const token of tokens) {
    if (base.includes(token)) score += 3;
    if (fmText.includes(token)) score += 2;
    if (body.includes(token)) score += 1;
  }
  return score;
}

module.exports = { lesson, lessons };
