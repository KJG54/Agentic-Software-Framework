---
schema_version: "1.0"
project: test-phase
---

# Architecture: test-phase

## Overview

The **test** phase is the loop gate after **build**. It is the first phase where the CLI
*executes* code rather than only validating declarations: `appbuilder test <slug>` runs the
built project's own test suite, gates on a clean green, and writes
`build/<slug>/test-report.json` for the **review** phase to consume. It is a single CLI-driven
verb (like `scaffold`) — no `init`, no agent-authored manifest, the complement to build's
agent-declared accounting. Still **no LLM**: running tests is deterministic.

## Components

### `appbuilder test <slug>` (cli/lib/test.js)

1. **Precondition gate.** `build/<slug>/build-report.json` must exist — you cannot test what was
   not built. Missing → `fail test: run appbuilder build <slug> first`.
2. **Run.** Spawn `node --test` in `build/<slug>/` over an explicit test-file glob (mirroring the
   framework's own scoped-glob convention; the shipped templates put tests under `test/`).
   Capture exit code and stdout.
3. **Parse.** Read the `node --test` summary lines (`# tests`, `# pass`, `# fail`, `# skipped`)
   for counts.
4. **Gate & report.** The gate passes **only when**: build-report exists **AND** at least one
   test ran **AND** zero failures.
   - Zero tests found/run → `fail test: no tests found` (the framework is test-first; a build
     that reached this phase with no runnable tests is broken — no hollow greens).
   - Any failure → print the captured `node --test` output, then `fail test: N test(s) failed`,
     exit 1.
   - **On any failure, write nothing.** Same invariant as build/scaffold: a `test-report.json`
     on disk *means the gate passed*, so review can trust its presence.
   - On pass → write `build/<slug>/test-report.json` (validated before writing).

### test-report.json contract (contracts/schemas/v1/test-report.schema.json)

New schema, enum-free like the build-phase schemas. All fields required; counts are integers
>= 0; `command` records exactly what ran.

```json
{
  "schema_version": "1.0",
  "project": "demo-app",
  "generated_at": "2026-06-14T00:00:00.000Z",
  "command": "node --test test/**/*.test.js",
  "tests_total": 5,
  "tests_passed": 5,
  "tests_failed": 0,
  "tests_skipped": 0
}
```

No coverage and no duration field — YAGNI, and duration is non-deterministic and would churn the
artifact on every run.

### Validation + CLI wiring

- **cli/lib/validate.js** — add `validateTestReport`; add `"test-report"` to
  `REQUIRED_SCHEMA_NAMES`. (`scanForArtifactVersions` in cli/appbuilder.js already lists
  `test-report.json` — the slot was anticipated.)
- **cli/appbuilder.js** — remove `test` from the `start/test/review/ship` placeholder case, add
  `case "test": return test(cwd, args);`, and extend the help text with a Test section.
- **README.md / HOWTO.md** — a Test section plus a thorough operator walkthrough (renumbering the
  "How work gets done" section), per the standing rule that every command ships a full HOWTO
  walkthrough.

## Testing

Reuses the scaffold->build helpers already at the bottom of tests/appbuilder.test.js (makeFixture
/ writeFilledPlan / run / runFail). The scaffold tests already spawn `node --test` inside
`build/<slug>/`, so this phase formalizes an existing, proven pattern.

- `validateTestReport` unit test (valid + invalid).
- Happy path: scaffold the `cli` template -> `build init` + fill manifest + `build` -> `test`
  passes; assert the report counts (tests_passed >= 1, tests_failed 0) and schema validity.
- Gate reds: missing build-report (run `test` before `build`); a deliberately failing test in
  `build/<slug>/` (gate fails, no report written); zero tests (test files removed -> `no tests
  found`, no report written).

## Decisions

- **Single CLI-execute verb, no manifest.** Build needed an agent-declared manifest because the
  CLI could not know what the agent did; test can simply run the suite, so a manifest would be
  ceremony. This is the deliberate complement to build.
- **`node --test` directly, not `npm test`.** Exit code is the gate; the summary lines give
  parseable counts. Avoids the npm/PowerShell shim issues already documented for this repo and
  keeps output machine-readable.
- **No report on failure.** Preserves the cross-phase invariant that a report's existence means
  its gate passed — review depends on it.
- **Zero tests = fail.** A test-first framework should never green on nothing.
- **No coverage/duration in the report.** YAGNI; duration is non-deterministic.

## Task breakdown

Mirrors the build-phase batch; serialized because all three touch tests/appbuilder.test.js.

- **TASK-801** — test-report contract + `validateTestReport` + `REQUIRED_SCHEMA_NAMES`.
- **TASK-802** — cli/lib/test.js (run + gate + report) + router/help wiring (depends on 801).
- **TASK-803** — README + HOWTO operator walkthrough (depends on 802).
