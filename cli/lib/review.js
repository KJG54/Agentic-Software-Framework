"use strict";

// The review phase: the loop gate after test and before ship. There is no LLM — the agent/human
// writes the review prose; the CLI seeds a structured review-report.md stub (review init) and
// validates it (review). The artifact is markdown with flat frontmatter, like architecture.md /
// handoff.md. Unlike scaffold/build/test, review writes no JSON report: the review-report.md *is*
// the artifact, and approval is encoded in its `decision` frontmatter for ship to read. The gate
// therefore behaves like an enriched `ready`, not a generator.

const fs = require("fs");
const path = require("path");
const { writeText } = require("./util");
const { loadProject, parseFrontmatter, validateReviewReport } = require("./validate");

const REQUIRED_SECTIONS = ["Summary", "Findings", "Checklist"];

function review(cwd, args = []) {
  if (args[0] === "init") return reviewInit(cwd, args.slice(1));
  return reviewGate(cwd, args);
}

function resolveSlug(args, usage) {
  const slug = args.find((arg) => !arg.startsWith("--"));
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(usage);
  return slug;
}

function reviewInit(cwd, args) {
  const slug = resolveSlug(args, "Usage: appbuilder review init <project-slug> [--force]");
  const force = args.includes("--force");
  const project = loadProject(cwd);
  const buildDir = path.join(project.root, "build", slug);

  // Gate: you cannot review an untested build.
  if (!fs.existsSync(path.join(buildDir, "test-report.json"))) {
    throw new Error(`No test report for ${slug} (expected build/${slug}/test-report.json). Run appbuilder test ${slug} first.`);
  }

  const reportPath = path.join(buildDir, "review-report.md");
  if (fs.existsSync(reportPath) && !force) {
    throw new Error(`build/${slug}/review-report.md already exists. Re-run with --force to re-seed.`);
  }

  const frontmatter = {
    schema_version: "1.0",
    project: slug,
    reviewed_at: new Date().toISOString(),
    decision: "changes_requested"
  };
  const validation = validateReviewReport(frontmatter, project.root);
  if (!validation.ok) throw new Error(`Generated review report is invalid:\n${validation.errors.join("\n")}`);
  writeText(reportPath, renderStub(slug, frontmatter));

  console.log(`review init ${slug}`);
  console.log(`report=build/${slug}/review-report.md`);
  console.log(`next: fill ## Summary / ## Findings / ## Checklist, set decision: approved, then appbuilder review ${slug}`);
  return 0;
}

function renderStub(slug, frontmatter) {
  return [
    "---",
    `schema_version: "${frontmatter.schema_version}"`,
    `project: ${slug}`,
    `reviewed_at: ${frontmatter.reviewed_at}`,
    `decision: ${frontmatter.decision}`,
    "---",
    "",
    `# Review: ${slug}`,
    "",
    "## Summary",
    "",
    "_What was built and tested, and the overall assessment._",
    "",
    "## Findings",
    "",
    "_Issues, risks, and observations from the review._",
    "",
    "## Checklist",
    "",
    "_What you verified: requirements met, tests meaningful, no obvious gaps._",
    ""
  ].join("\n");
}

function reviewGate(cwd, args) {
  const slug = resolveSlug(args, "Usage: appbuilder review <project-slug>");
  const project = loadProject(cwd);
  const buildDir = path.join(project.root, "build", slug);
  const failures = [];

  if (!fs.existsSync(path.join(buildDir, "test-report.json"))) {
    failures.push(`no test report (expected build/${slug}/test-report.json). Run appbuilder test ${slug} first`);
  }

  const reportPath = path.join(buildDir, "review-report.md");
  if (!fs.existsSync(reportPath)) {
    failures.push(`no review report (expected build/${slug}/review-report.md). Run appbuilder review init ${slug} first`);
    for (const failure of failures) console.log(`fail review: ${failure}`);
    return 1;
  }

  const text = fs.readFileSync(reportPath, "utf8");
  const parsed = parseFrontmatter(text);
  if (!parsed) {
    failures.push("review-report.md is missing YAML frontmatter");
  } else {
    const validation = validateReviewReport(parsed.data, project.root);
    if (!validation.ok) failures.push(...validation.errors.map((error) => `frontmatter ${error}`));
  }

  for (const heading of REQUIRED_SECTIONS) {
    const content = sectionContent(text, heading);
    if (content === null) failures.push(`missing section: ## ${heading}`);
    else if (content === "") failures.push(`section ## ${heading} is empty`);
  }

  const decision = parsed && parsed.data ? parsed.data.decision : undefined;
  if (decision && decision !== "approved") {
    failures.push(`decision is "${decision}" (must be "approved" to pass)`);
  }

  if (failures.length) {
    for (const failure of failures) console.log(`fail review: ${failure}`);
    return 1;
  }

  console.log(`review ${slug}`);
  console.log("decision=approved");
  console.log(`report=build/${slug}/review-report.md`);
  return 0;
}

// Return the trimmed text under a `## <heading>` up to the next `## ` heading (or EOF), or null if
// the heading is absent. The markdown validator only checks frontmatter, so required-section
// presence/non-emptiness is enforced here (the validateHandoff precedent for custom checks).
function sectionContent(text, heading) {
  const lines = text.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === `## ${heading}`);
  if (start === -1) return null;
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^##\s/.test(lines[i].trim())) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim();
}

module.exports = {
  review
};
