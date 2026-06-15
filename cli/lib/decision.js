"use strict";

// The decision (ADR) flow: capture an Architecture Decision Record as a markdown file with
// validated flat frontmatter under <vault_framework_dir>/decisions/. Like ship/review, the
// record is validated BEFORE it is written, so a malformed ADR never lands on disk. This is a
// working-branch writer — it never touches the coordination worktree, so ADRs ride the normal
// task-branch PR to main (and stay visible to humans and the Obsidian vault), exactly like
// plan artifacts. The id auto-increments (ADR-0001, ADR-0002, ...) from the existing records.

const fs = require("fs");
const path = require("path");
const { writeText, slug } = require("./util");
const { loadProject, validateAdr } = require("./validate");

const STATUSES = ["proposed", "accepted", "superseded", "deprecated"];

// Minimal flag reader: --key value (repeatable keys collected into an array).
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

function decision(cwd, args = []) {
  const sub = args[0];
  if (sub !== "add") {
    throw new Error("Usage: appbuilder decision add --title <t> --context <c> --decision <d> --consequences <q> [--status proposed|accepted|superseded|deprecated] [--date YYYY-MM-DD] [--option <alt> ...] [--force]");
  }
  const rest = args.slice(1);
  const project = loadProject(cwd);

  const title = readOption(rest, "--title");
  const context = readOption(rest, "--context");
  const decisionText = readOption(rest, "--decision");
  const consequences = readOption(rest, "--consequences");
  const status = readOption(rest, "--status") || "accepted";
  const date = readOption(rest, "--date") || new Date().toISOString().slice(0, 10);
  const options = readAll(rest, "--option");

  const missing = [];
  if (!title) missing.push("--title");
  if (!context) missing.push("--context");
  if (!decisionText) missing.push("--decision");
  if (!consequences) missing.push("--consequences");
  if (missing.length) {
    throw new Error(`decision add is missing required flags: ${missing.join(", ")}`);
  }
  if (!STATUSES.includes(status)) {
    throw new Error(`--status must be one of ${STATUSES.join(", ")} (got "${status}")`);
  }

  const decisionsDir = path.join(project.root, project.config.vault_framework_dir, "decisions");
  const id = nextAdrId(decisionsDir);

  const frontmatter = {
    schema_version: "1.0",
    id,
    title,
    status,
    context,
    decision: decisionText,
    consequences,
    date
  };
  if (options.length) frontmatter.options_considered = options;

  const validation = validateAdr(frontmatter, project.root);
  if (!validation.ok) {
    throw new Error(`Generated ADR is invalid:\n${validation.errors.map((e) => `- ${e}`).join("\n")}`);
  }

  const file = path.join(decisionsDir, `${id}-${slug(title)}.md`);
  if (fs.existsSync(file)) {
    throw new Error(`${id}-${slug(title)}.md already exists. Re-run with --force to overwrite.`);
  }
  writeText(file, renderAdr(frontmatter));

  const rel = path.relative(project.root, file).replace(/\\/g, "/");
  console.log(`decision ${id}`);
  console.log(`adr=${rel}`);
  return 0;
}

// Scan existing ADR-NNNN-*.md and return the next zero-padded id.
function nextAdrId(decisionsDir) {
  let max = 0;
  if (fs.existsSync(decisionsDir)) {
    for (const entry of fs.readdirSync(decisionsDir)) {
      const match = /^ADR-([0-9]{4,})-/.exec(entry);
      if (match) max = Math.max(max, Number(match[1]));
    }
  }
  return `ADR-${String(max + 1).padStart(4, "0")}`;
}

function renderAdr(fm) {
  const lines = [
    "---",
    `schema_version: "${fm.schema_version}"`,
    `id: ${fm.id}`,
    `title: ${quote(fm.title)}`,
    `status: ${fm.status}`,
    `context: ${quote(fm.context)}`,
    `decision: ${quote(fm.decision)}`,
    `consequences: ${quote(fm.consequences)}`,
    `date: ${fm.date}`
  ];
  if (fm.options_considered) {
    lines.push("options_considered:");
    for (const option of fm.options_considered) lines.push(`  - ${quote(option)}`);
  }
  lines.push(
    "---",
    "",
    `# ${fm.id}: ${fm.title}`,
    "",
    `**Status:** ${fm.status} — **Date:** ${fm.date}`,
    "",
    "## Context",
    "",
    fm.context,
    "",
    "## Decision",
    "",
    fm.decision,
    ""
  );
  if (fm.options_considered && fm.options_considered.length) {
    lines.push("## Options considered", "", ...fm.options_considered.map((o) => `- ${o}`), "");
  }
  lines.push("## Consequences", "", fm.consequences, "");
  return lines.join("\n");
}

// Quote frontmatter scalars so a value containing ':' stays a single field that the flat
// parser reads back intact.
function quote(value) {
  return `"${String(value).replace(/"/g, '\\"')}"`;
}

module.exports = { decision };
