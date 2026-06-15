# Ship Phase — Design

**Date:** 2026-06-14
**Status:** Approved (design); pending implementation plan
**Scope:** The final phase of the App Builder V2 loop — `Idea → Requirements → Plan → Scaffold → Build → Test → Review → **Ship**`.

## Context

Scaffold, Build, Test, and Review are implemented and documented. `ship` is the last remaining
loop step (today a bare `case "ship"` placeholder in `cli/appbuilder.js`). Two existing signals
pre-shape it:

- `.agent/rules/project-workflow.md:8` names **`ship-checklist.md`** as a required artifact, and
  line 12 states *"Review gates must run before build, merge, and ship."*
- `scanForArtifactVersions` (`cli/appbuilder.js`) already expects `ship-checklist.md` to carry
  `schema_version` **frontmatter**, alongside `architecture.md` / `review-report.md` / `handoff.md`.

So the artifact name and format are effectively pre-decided: **markdown with flat frontmatter**.

There is **no LLM** in the CLI (charter invariant). `ship` records readiness; it does not deploy.

## Decisions (approved)

1. **Phase shape — Generator** (like `build` / `test`). A single verb. The CLI verifies the
   upstream chain and, only on success, deterministically *writes* `ship-checklist.md`. The
   invariant "report on disk == gate passed" holds. The one divergence from build/test: the
   generated artifact is **markdown with flat frontmatter** (not JSON), because the repo already
   reserves `ship-checklist.md` as a frontmatter-bearing markdown file. (`review init` already
   proves the CLI can emit frontmatter'd markdown.)
2. **Gate scope — Full chain.** `ship` requires *all* prior reports present + valid, not just the
   immediately-prior artifact. The roll-up needs every report anyway, and ship is the terminal
   gate — it should fail loudly rather than emit an incomplete manifest.
3. **Output — Roll-up + manual go-live steps.** A machine roll-up of the whole loop PLUS a short
   static checklist of human go-live steps. The manual items honor the "checklist" name; they are
   informational (the CLI does not verify them).

## Design

### Command

```bash
appbuilder ship <slug>            # verify the full chain, write build/<slug>/ship-checklist.md
appbuilder ship <slug> --force    # regenerate over an existing checklist
```

Single verb (no `ship init`): the artifact is CLI-generated, so there is nothing to seed.

### The gate (full chain)

`ship <slug>` collects *all* failures (like `build` / `review`) and writes nothing unless every
check passes:

1. `build/<slug>/scaffold-report.json` exists & parses.
2. `build/<slug>/build-report.json` exists & parses.
3. `build/<slug>/test-report.json` exists & parses.
4. `build/<slug>/review-report.md` exists, frontmatter validates, **`decision: approved`**.

On failure: print each `fail ship: …` line, return exit 1, write nothing. (Mirrors the review
gate's output style and the "write nothing on failure" rule.)

### The output

On pass, `ship` reads those reports for facts and generates `build/<slug>/ship-checklist.md`:

- **Frontmatter (flat — `parseFrontmatter` is flat-only):**
  - `schema_version: "1.0"`
  - `project: <slug>`
  - `shipped_at: <now ISO>`
  - `review_decision: approved` (carried through; the gate guarantees it)
  - `reviewed_at: <from review-report.md frontmatter>`
- **`## Phase Summary`** — Scaffold ✓ · Build ✓ · Test ✓ (N passed / 0 failed, from
  `test-report.json`) · Review ✓ approved (`reviewed_at`).
- **`## Artifacts`** — the built files (union from `build-report.json`) plus the four upstream
  reports.
- **`## Manual Go-Live Steps`** — static `- [ ]` reminders (tag the release, update the changelog,
  deploy, announce). Informational; the CLI does not verify them.

The generated frontmatter is validated against the new schema before writing (the `review init`
precedent: a generated artifact must itself pass validation).

### Overwrite behavior

Because `## Manual Go-Live Steps` is human-tickable, `ship` **refuses to overwrite an existing
`ship-checklist.md` without `--force`** (like `scaffold` and `review init`) — re-running must not
wipe a human's go-live progress. This does not break "existence == passed": the file only ever got
written because the gate passed.

## Components

- **`contracts/schemas/v1/ship-checklist.schema.json`** (new): flat frontmatter schema —
  `schema_version` const `"1.0"`, `project` (string, minLength 1), `shipped_at` (date-time),
  `review_decision` const `"approved"`, `reviewed_at` (date-time); `additionalProperties: true`
  (like `handoff.schema.json` / `review-report.schema.json`).
- **`cli/lib/ship.js`** (new): `ship(cwd, args)` — single verb. `resolveSlug`, `loadProject`,
  compute `buildDir`; run the full-chain gate collecting failures; on pass read the reports, build
  the markdown, validate frontmatter, honor `--force`, write, print a summary. Reuse
  `parseFrontmatter` + `validateShipChecklist` from `validate.js`, `readJson` / `writeText` from
  `util.js`. Model the markdown rendering on `renderStub` in `cli/lib/review.js`.
- **`cli/lib/validate.js`**: add `validateShipChecklist(frontmatter, root)` →
  `validateMarkdownArtifact(..., "ship-checklist", ...)`; export it.
- **`cli/appbuilder.js`**: `const { ship } = require("./lib/ship")`; replace the `case "ship"`
  placeholder body with `return ship(cwd, args)`; import + re-export `validateShipChecklist`; add
  `"ship-checklist"` to `REQUIRED_SCHEMA_NAMES` (doctor checks it); add a **"Ship commands:"** help
  block; **remove the now-empty "Later-phase workflow placeholders" group** — the loop becomes
  placeholder-free.
- **`README.md`**: add a **Ship** section; remove the "ship is a placeholder" line.
- **`HOWTO.md`**: add a thorough **§7 "Ship the build"** walkthrough (the single verb, the
  full-chain gate, the generated checklist content, `--force`, a failure-mode → fix table);
  renumber the current "How work gets done" section accordingly.

## Testing

- `validateShipChecklist` unit (valid frontmatter passes; bad `review_decision`, missing fields
  fail).
- End-to-end via the existing fixture chain (extend `approvedReview` → a `shipped` helper):
  scaffold → build → test → review (approved) → `ship` writes a valid `ship-checklist.md` with the
  roll-up; frontmatter validates; the summary reflects the test counts.
- Reds (full-chain gate): missing scaffold-report / build-report / test-report / review-report,
  and `decision: changes_requested`, each → `fail ship:` line, exit 1, **no file written**.
- `--force`: second `ship` without `--force` refuses; with `--force` regenerates.
- `doctor` recognizes `schema:ship-checklist`.

## Tasks (3, serialized — all touch `tests/appbuilder.test.js`)

Mirrors the review batch.

- **TASK-1001** — ship-checklist contract + `validateShipChecklist` + `"ship-checklist"` in
  `REQUIRED_SCHEMA_NAMES` + unit test.
- **TASK-1002** — the `ship` generator (full-chain gate + roll-up + `--force`), wire router/help,
  drop the placeholder group *(depends on 1001)*.
- **TASK-1003** — README **Ship** section + HOWTO **§7** walkthrough *(depends on 1002)*.

## Execution flow

After this spec is approved: `appbuilder plan new ship-phase` → write
`requirements.json` / `architecture.md` / `task-plan.json` capturing the above → `plan compile` →
human approval → land plan artifacts (and this spec) via a `plan/ship-phase` PR → `plan seed` →
per-task loop (claim → test-first → handoff → ready → PR → **human merge** → release), one task at
a time.

## Verification

- `node --test "tests/**/*.test.js"` — full suite green (44 today + the new ship tests).
- `node cli/appbuilder.js doctor` — green, including `ok schema:ship-checklist: exists`.
- `node cli/appbuilder.js help` — shows a **Ship commands** block; **no placeholder group**.
- End-to-end (automated): a demo app goes scaffold → build → test → review (approved) → `ship`,
  producing `ship-checklist.md`; flipping the review decision or removing any prior report makes
  `ship` fail and write nothing.

## Outcome

The loop is implemented and documented **end to end** — `Idea → … → Ship` — with **no remaining
placeholders**.
