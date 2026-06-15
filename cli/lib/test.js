"use strict";

// The test phase: the loop gate after build. There is no LLM here — the CLI actually runs the
// built project's own test suite (node --test in build/<slug>/), gates on a clean green, and
// writes build/<slug>/test-report.json for the review phase. A single CLI-driven verb (like
// scaffold): the build phase had the agent *declare* its work, so here the CLI *verifies* it by
// execution. A report on disk means the gate passed — nothing is written on failure.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { writeJson } = require("./util");
const { loadProject, validateTestReport } = require("./validate");

// Force the TAP reporter so the machine-readable summary lines are emitted regardless of whether
// stdout is a TTY (the spec reporter, used for TTYs, prints a different, non-`#` summary).
const RUN_ARGS = ["--test", "--test-reporter=tap"];

function test(cwd, args = []) {
  const slug = args.find((arg) => !arg.startsWith("--"));
  if (!slug || !/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
    throw new Error("Usage: appbuilder test <project-slug>");
  }
  const project = loadProject(cwd);
  const buildDir = path.join(project.root, "build", slug);

  // Precondition: you cannot test what was not built.
  if (!fs.existsSync(path.join(buildDir, "build-report.json"))) {
    console.log(`fail test: no build report for ${slug} (expected build/${slug}/build-report.json). Run appbuilder build ${slug} first.`);
    return 1;
  }

  const command = `node ${RUN_ARGS.join(" ")}`;
  // Run as a fresh top-level test run: if appbuilder itself is invoked from within a
  // `node --test` process, NODE_TEST_CONTEXT would make the child think it is nested and skip
  // discovering files. Strip it so the built project's suite always runs.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(process.execPath, RUN_ARGS, { cwd: buildDir, encoding: "utf8", env });
  const output = `${result.stdout || ""}${result.stderr || ""}`;
  const counts = parseTapSummary(output);

  let failure = null;
  if (!counts || counts.total === 0) {
    failure = "no tests found";
  } else if (counts.failed > 0) {
    failure = `${counts.failed} test(s) failed`;
  } else if (result.status !== 0) {
    failure = "test run exited non-zero";
  }

  if (failure) {
    if (output.trim()) console.log(output.trim());
    console.log(`fail test: ${failure}`);
    return 1;
  }

  const report = {
    schema_version: "1.0",
    project: slug,
    generated_at: new Date().toISOString(),
    command,
    tests_total: counts.total,
    tests_passed: counts.passed,
    tests_failed: counts.failed,
    tests_skipped: counts.skipped
  };
  const validation = validateTestReport(report, project.root);
  if (!validation.ok) throw new Error(`Generated test report is invalid:\n${validation.errors.join("\n")}`);
  writeJson(path.join(buildDir, "test-report.json"), report);

  console.log(`test ${slug}`);
  console.log(`tests=${counts.total} passed=${counts.passed} failed=${counts.failed} skipped=${counts.skipped}`);
  console.log(`report=build/${slug}/test-report.json`);
  return 0;
}

// Parse node --test's TAP summary lines (e.g. `# tests 5`, `# pass 5`, `# fail 0`). Returns null
// when no summary is present (the runner found no test files / crashed before reporting).
function parseTapSummary(output) {
  const count = (label) => {
    const match = new RegExp(`^# ${label} (\\d+)$`, "m").exec(output);
    return match ? Number(match[1]) : null;
  };
  const total = count("tests");
  if (total === null) return null;
  return {
    total,
    passed: count("pass") || 0,
    failed: count("fail") || 0,
    skipped: count("skipped") || 0
  };
}

module.exports = {
  test
};
