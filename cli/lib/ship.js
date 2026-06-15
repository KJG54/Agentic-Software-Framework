"use strict";

// The ship phase: the terminal generator that closes the loop after review. There is no LLM — the
// CLI verifies the *whole* chain is on disk (scaffold/build/test reports parse, and the review is
// approved) and then rolls those facts up into build/<slug>/ship-checklist.md. Like build and
// review, ship collects every failure and writes nothing unless all gates pass; like scaffold and
// review init, it refuses to overwrite an existing checklist without --force so a human's go-live
// ticks survive a re-run. The checklist is markdown with flat frontmatter (parseFrontmatter is
// flat-only), modeled on review.js's renderStub.

const fs = require("fs");
const path = require("path");
const { readJson, writeText } = require("./util");
const { loadProject, parseFrontmatter, validateReviewReport, validateShipChecklist } = require("./validate");

function ship(cwd, args = []) {
  const slug = args.find((arg) => !arg.startsWith("--"));
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error("Usage: appbuilder ship <project-slug> [--force]");
  }
  const force = args.includes("--force");
  const project = loadProject(cwd);
  const buildDir = path.join(project.root, "build", slug);

  const checklistPath = path.join(buildDir, "ship-checklist.md");
  if (fs.existsSync(checklistPath) && !force) {
    throw new Error(`build/${slug}/ship-checklist.md already exists. Re-run with --force to regenerate (this resets human go-live ticks).`);
  }

  // Full-chain gate: collect every failure before writing anything.
  const failures = [];
  const reports = {};
  for (const name of ["scaffold-report", "build-report", "test-report"]) {
    const reportPath = path.join(buildDir, `${name}.json`);
    if (!fs.existsSync(reportPath)) {
      failures.push(`no ${name} (expected build/${slug}/${name}.json). Run the ${name.split("-")[0]} phase first`);
      continue;
    }
    try {
      reports[name] = readJson(reportPath);
    } catch (error) {
      failures.push(`${name}.json did not parse: ${error.message}`);
    }
  }

  let review = null;
  const reviewPath = path.join(buildDir, "review-report.md");
  if (!fs.existsSync(reviewPath)) {
    failures.push(`no review report (expected build/${slug}/review-report.md). Run appbuilder review init ${slug} first`);
  } else {
    const parsed = parseFrontmatter(fs.readFileSync(reviewPath, "utf8"));
    if (!parsed) {
      failures.push("review-report.md is missing YAML frontmatter");
    } else {
      const validation = validateReviewReport(parsed.data, project.root);
      if (!validation.ok) failures.push(...validation.errors.map((error) => `review frontmatter ${error}`));
      if (parsed.data.decision !== "approved") {
        failures.push(`review decision is "${parsed.data.decision}" (must be "approved" to ship)`);
      }
      review = parsed.data;
    }
  }

  if (failures.length) {
    for (const failure of failures) console.log(`fail ship: ${failure}`);
    return 1;
  }

  const frontmatter = {
    schema_version: "1.0",
    project: slug,
    shipped_at: new Date().toISOString(),
    review_decision: "approved",
    reviewed_at: review.reviewed_at
  };
  const validation = validateShipChecklist(frontmatter, project.root);
  if (!validation.ok) throw new Error(`Generated ship checklist is invalid:\n${validation.errors.join("\n")}`);

  writeText(checklistPath, renderChecklist(slug, frontmatter, reports));

  console.log(`ship ${slug}`);
  console.log(`review_decision=approved reviewed_at=${frontmatter.reviewed_at}`);
  console.log(`checklist=build/${slug}/ship-checklist.md`);
  console.log(`note: capture a lesson with: appbuilder lesson add --project ${slug} --context "<what this taught>" --rule "<reusable rule>" --worked "<...>"`);
  return 0;
}

function renderChecklist(slug, frontmatter, reports) {
  const scaffold = reports["scaffold-report"];
  const buildReport = reports["build-report"];
  const test = reports["test-report"];

  // Built files: the build-report's files_touched, plus the four upstream report artifacts.
  const builtFiles = Array.from(new Set(buildReport.files_touched || [])).sort();
  const artifacts = [
    ...builtFiles,
    `build/${slug}/scaffold-report.json`,
    `build/${slug}/build-report.json`,
    `build/${slug}/test-report.json`,
    `build/${slug}/review-report.md`
  ];

  return [
    "---",
    `schema_version: "${frontmatter.schema_version}"`,
    `project: ${slug}`,
    `shipped_at: ${frontmatter.shipped_at}`,
    `review_decision: ${frontmatter.review_decision}`,
    `reviewed_at: ${frontmatter.reviewed_at}`,
    "---",
    "",
    `# Ship Checklist: ${slug}`,
    "",
    "## Phase Summary",
    "",
    `- Scaffold: template \`${scaffold.template}\` (build_type \`${scaffold.build_type}\`)`,
    `- Build: ${buildReport.tasks_done} done, ${buildReport.tasks_skipped} skipped of ${buildReport.tasks_total} tasks`,
    `- Test: ${test.tests_passed} passed, ${test.tests_failed} failed, ${test.tests_skipped} skipped of ${test.tests_total} (\`${test.command}\`)`,
    `- Review: approved at ${frontmatter.reviewed_at}`,
    "",
    "## Artifacts",
    "",
    ...artifacts.map((file) => `- ${file}`),
    "",
    "## Manual Go-Live Steps",
    "",
    "_Informational reminders — the CLI does not verify these._",
    "",
    "- [ ] Tag the release in version control",
    "- [ ] Update the changelog / release notes",
    "- [ ] Deploy or publish the build",
    "- [ ] Announce the release to stakeholders",
    ""
  ].join("\n");
}

module.exports = {
  ship
};
