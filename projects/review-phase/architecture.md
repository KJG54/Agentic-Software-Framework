---
schema_version: "1.0"
project: review-phase
---

# Architecture: review-phase

## Overview

The **review** phase is the loop gate after **test** and before **ship**. Unlike scaffold/build/
test (each emits a CLI-authored JSON report), review's artifact is a *prose* document —
`build/<slug>/review-report.md`, a markdown file with flat YAML frontmatter, mirroring
`architecture.md`/`handoff.md`. There is **no LLM**: the agent/human writes the review; the CLI
seeds a structured stub and validates/gates on it. The phase ships as two verbs mirroring
`build init` -> `build`. This slice also removes the vestigial `start` command, which is not part
of the canonical loop and has no defined behavior.

## Components

### `appbuilder review init <slug>` (cli/lib/review.js)

Gates on `build/<slug>/test-report.json` existing — you cannot review an untested build. Refuses
to overwrite `build/<slug>/review-report.md` without `--force`. Seeds the file with flat
frontmatter and body section headings:

```markdown
---
schema_version: "1.0"
project: my-app
reviewed_at: 2026-06-15T00:00:00.000Z
decision: changes_requested
---

# Review: my-app

## Summary
_..._

## Findings
_..._

## Checklist
_..._
```

`decision: changes_requested` is the safe default so the gate stays red until a human deliberately
flips it to `approved`. The seeded stub must itself pass frontmatter validation.

### `appbuilder review <slug>` (cli/lib/review.js)

The gate. Collects all failures (like `build`) and passes **only when**:

1. `build/<slug>/test-report.json` exists (precondition).
2. `build/<slug>/review-report.md` exists.
3. Its frontmatter validates against the review-report schema (`schema_version`, `project`,
   `reviewed_at` date-time, `decision` enum).
4. The required body sections (`## Summary`, `## Findings`, `## Checklist`) are present with
   non-empty content (custom check, per the `validateHandoff` precedent — the markdown validator
   only checks frontmatter).
5. `decision == "approved"`.

On failure it prints each problem as a `fail review: ...` line and exits non-zero. On success it
prints a summary and **writes no new file** — `review-report.md` is the artifact, and approval is
encoded in its `decision` frontmatter for a later ship phase to read.

### review-report contract (contracts/schemas/v1/review-report.schema.json)

A markdown-frontmatter schema (validated via `validateMarkdownArtifact`). Flat, because the
frontmatter parser is flat-only:

- `schema_version` const "1.0"
- `project` string, minLength 1
- `reviewed_at` string, format date-time
- `decision` enum ["approved", "changes_requested"]
- `additionalProperties: true` (like `handoff.schema.json`, so reviewers may add fields)

### Validation + CLI wiring

- **cli/lib/validate.js** — add `validateReviewReport(frontmatter, root)` ->
  `validateMarkdownArtifact(..., "review-report", ...)`; export it. Reuse the existing
  `parseFrontmatter` for reading the file in review.js.
- **cli/appbuilder.js** — import + re-export `validateReviewReport`; add `"review-report"` to
  `REQUIRED_SCHEMA_NAMES`; route `case "review"`; **remove** the `case "start"` line; add a
  "Review commands:" help block; change the placeholder help line to just `ship`.
- **README.md / HOWTO.md** — a Review section + a thorough operator walkthrough, and drop `start`
  from the placeholder wording.

## Testing

Extends the scaffold->build->test fixture chain (the `buildDemoApp` helper, plus a `test` step) in
tests/appbuilder.test.js:

- `validateReviewReport` unit (valid frontmatter passes; bad `decision` / missing fields fail).
- `review init` seeds a stub and gates on `test-report.json` (refuses when not yet tested).
- Happy path: fill the sections, set `decision: approved` -> `review` passes.
- Gate reds: no test-report; no review-report; `decision: changes_requested`; a missing/empty
  required section. Each prints `fail review:` and writes nothing new.
- `start` is now an unknown command (non-zero exit).

## Decisions

- **review-report.md, not .json.** The loop docs (`project-workflow.md`) and
  `scanForArtifactVersions` already name `review-report.md`. Review output is inherently prose;
  flat frontmatter carries the machine-readable fields (`decision`) ship will consume.
- **Validation gate, not a generator.** Review diverges from the JSON-report phases: the CLI does
  not author the artifact, it validates an agent-authored one. The "passed" signal is
  `decision: approved` in the frontmatter, not the file's existence (the file exists from
  `review init` onward). This is closer to `ready` than to `scaffold`.
- **Two verbs.** `review init` gives the reviewer a correct, schema-valid scaffold to fill, the
  same ergonomics as `build init` and `plan new`.
- **`changes_requested` default.** Approval must be a deliberate edit, never the default.
- **Remove `start`.** It is not in the canonical loop and has no behavior; anti-bloat says drop
  it while the router/help are already being edited.

## Task breakdown

Three serialized tasks (all touch tests/appbuilder.test.js), mirroring the test-phase batch.

- **TASK-901** — review-report contract + `validateReviewReport` + `REQUIRED_SCHEMA_NAMES`.
- **TASK-902** — cli/lib/review.js (init + gate) + router/help wiring + remove `start`
  (depends on 901).
- **TASK-903** — README Review section + thorough HOWTO walkthrough + drop `start` from docs
  (depends on 902).
