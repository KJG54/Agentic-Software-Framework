---
schema_version: "1.0"
project: ship-phase
---

# Architecture: ship-phase

## Overview

`ship` is the terminal phase of the loop (`Idea → … → Review → Ship`). It is a deterministic
**generator** with **no LLM** — the same family as `build` and `test`: the CLI verifies what came
before and, only on success, writes the phase's report. The single divergence from build/test is
the artifact format: `ship-checklist.md` is **markdown with flat frontmatter** (not JSON), because
`.agent/rules/project-workflow.md` and `scanForArtifactVersions` already reserve it as a
frontmatter-bearing markdown file. `ship` records readiness; it does not deploy.

The invariant "report on disk == gate passed" holds: `ship-checklist.md` is written only when the
full upstream chain passed. Unlike `review-report.md` (which exists from `review init` onward),
`ship-checklist.md` has no init/seed step — its mere existence means ship succeeded.

## Components

- **contracts/schemas/v1/ship-checklist.schema.json** — flat frontmatter schema: `schema_version`
  const `"1.0"`, `project` (string, minLength 1), `shipped_at` (date-time), `review_decision`
  const `"approved"`, `reviewed_at` (date-time); `additionalProperties: true` (mirrors
  review-report/handoff).
- **cli/lib/ship.js** — `ship(cwd, args)`, a single verb. Resolves the slug, loads the project,
  computes `build/<slug>/`, runs the full-chain gate (collecting all failures like `build`/`review`),
  and on success reads the reports, renders the markdown, validates the generated frontmatter, honors
  `--force`, writes the file, and prints a summary. Reuses `parseFrontmatter` +
  `validateShipChecklist` (validate.js) and `readJson`/`writeText` (util.js); markdown rendering
  follows `renderStub` in cli/lib/review.js.
- **cli/lib/validate.js** — `validateShipChecklist(frontmatter, root)` via `validateMarkdownArtifact`,
  exported.
- **cli/appbuilder.js** — import `{ ship }`; replace the `case "ship"` placeholder with
  `return ship(cwd, args)`; import + re-export `validateShipChecklist`; add `"ship-checklist"` to
  `REQUIRED_SCHEMA_NAMES`; add a "Ship commands:" help block; remove the now-empty
  "Later-phase workflow placeholders" group.
- **README.md / HOWTO.md** — a Ship section and a thorough ship-phase walkthrough.

## Data flow

1. `appbuilder ship <slug>` reads, from `build/<slug>/`: `scaffold-report.json`,
   `build-report.json`, `test-report.json` (must exist + parse), and `review-report.md` (frontmatter
   must validate with `decision == approved`).
2. Any failure → print `fail ship: …` per problem, return exit 1, **write nothing**.
3. All pass → build frontmatter (`shipped_at` now; `review_decision`/`reviewed_at` carried from the
   review report) + body (`## Phase Summary` with test counts, `## Artifacts` from the build
   report's file union, `## Manual Go-Live Steps` static checkboxes); validate frontmatter; if
   `ship-checklist.md` already exists and `--force` is absent, refuse; otherwise write it and print a
   summary.

## Decisions

- **Generator, single verb (not a seed+gate pair like review):** the checklist is fully
  CLI-derivable from the upstream reports — there is no human prose to author, so there is nothing
  to seed.
- **Full-chain gate (not prior-artifact-only):** ship is the terminal gate and the checklist rolls
  up every phase, so it requires and reads all upstream reports rather than trusting the chain
  invariant through review alone.
- **Markdown artifact with flat frontmatter:** dictated by the existing `ship-checklist.md`
  reservation; flat because `parseFrontmatter` does not support nested objects.
- **Refuse overwrite without --force:** the `## Manual Go-Live Steps` section is human-tickable, so
  re-running must not silently wipe progress (the scaffold / review init precedent). This preserves
  "existence == passed" — the file only ever got written because the gate passed.
- **Manual steps are informational:** the CLI writes them once and never verifies them; ticking
  them is a human act outside the tool.
