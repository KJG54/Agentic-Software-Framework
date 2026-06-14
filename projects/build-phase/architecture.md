---
schema_version: "1.0"
project: build-phase
---

# Architecture: build-phase

## Overview

`build` is the deterministic checkpoint between `scaffold` and `test` in the
`Idea → Requirements → Plan → Scaffold → Build → Test → Review → Ship` loop. As with every
other phase, **there is no LLM in the CLI**: the agent writes the real code into
`build/<slug>/`, and the `build` command only *seeds an accounting stub* and then
*validates the agent's declared work* against the plan and the files on disk.

It follows the exact shape of the existing `scaffold` phase — read the prior artifact, gate,
write a report JSON the next phase consumes — and the two-verb shape of `plan` (`plan new` →
`plan compile`).

## Components

- **`cli/lib/build.js`** (new) — exports `build(cwd, args)`, which dispatches the `init`
  subcommand vs. the default validation gate. Reuses `loadProject`, `readJson`/`writeJson`
  from `util`, and `compilePlan` from `plan` to obtain the authoritative task list.
- **`cli/appbuilder.js`** — replace the `case "build":` placeholder with `return build(cwd, args)`;
  register the two new schema names in `REQUIRED_SCHEMA_NAMES`; extend help text.
  `start`/`test`/`review`/`ship` remain placeholders.
- **`contracts/schemas/v1/build-manifest.schema.json`** (new) — the agent-authored input.
- **`contracts/schemas/v1/build-report.schema.json`** (new) — the CLI-authored output.
- **`cli/lib/validate.js`** — add `validateBuildManifest` and `validateBuildReport` helpers,
  mirroring `validateScaffoldReport`. The existing custom validator already supports every
  keyword needed (`const`, `enum`, `type`, `pattern`, `minLength`, `minimum`, `required`,
  `additionalProperties`).

## The two verbs

### `appbuilder build init <slug>`

- **Gate:** `build/<slug>/scaffold-report.json` must exist — you cannot build what was not
  scaffolded.
- Reads `task-plan.json` (via `compilePlan`, so the plan is valid) and `scaffold-report.json`,
  then writes `build/<slug>/build-manifest.json` with every plan task pre-listed as `pending`:

```json
{
  "schema_version": "1.0",
  "project": "<slug>",
  "tasks": [
    { "id": "TASK-NNN", "status": "pending", "files": [], "reason": "" }
  ]
}
```

- Refuses to overwrite an existing manifest without `--force` (like `plan new` / `scaffold`).

### `appbuilder build <slug>` (the gate)

Validates and **passes only when**:

1. `build-manifest.json` exists and is schema-valid.
2. Its task ids exactly match `task-plan.json` — no missing tasks, no stray ids.
3. No task is `pending`.
4. Every `done` task lists ≥1 `file`, and every listed file exists under `build/<slug>/`.
5. Every `skipped` task carries a non-empty `reason`.
6. The files recorded in `scaffold-report.json` still exist (scaffold not regressed).

On pass it writes `build/<slug>/build-report.json` (CLI-authored, parallel to scaffold-report):

```json
{
  "schema_version": "1.0",
  "project": "<slug>",
  "generated_at": "<iso-8601>",
  "tasks_total": 0,
  "tasks_done": 0,
  "tasks_skipped": 0,
  "files_touched": []
}
```

On any failure it prints `fail build: …` lines, exits 1, and writes nothing.

## Contracts

**`build-manifest.schema.json`** — `required: [schema_version, project, tasks]`; each task object
`required: [id, status]` with `status` an `enum ["pending", "done", "skipped"]`, `files` an array
of non-empty strings, `reason` a string.

**`build-report.schema.json`** — `required: [schema_version, project, generated_at, tasks_total,
tasks_done, tasks_skipped, files_touched]`; counts are integers `minimum 0`; `generated_at` is
`format: date-time`; `additionalProperties: false`.

## Testing

Test-first in `tests/appbuilder.test.js`, reusing the scaffold fixture helpers: scaffold a
fixture project, run `build init`, assert the seeded manifest matches the plan's task ids. Then
drive the gate red→green — `pending` fails, a `done` task with a missing declared file fails, a
`skipped` task with no reason fails, mismatched ids fail, scaffold-file deletion fails, and a
fully-`done` manifest passes and writes a schema-valid `build-report.json`.

## Decisions

- **Two verbs (`build init` + `build`)** over a single create-then-validate command, for
  symmetry with `plan new`/`plan compile` and a clear agent-fills-in-between step.
- **Agent-declared manifest, CLI-validated** — the agent does the thinking and records what it
  built; the CLI only checks the record deterministically. Keeps the no-LLM-in-CLI contract.
- **`done` / `skipped` / `pending` vocabulary**, `pending` blocks the gate; `skipped` requires a
  reason so dropped tasks are honest rather than silent.
- **Operator docs are a first-class deliverable** — HOWTO.md gets a full walkthrough of both
  verbs, the manifest the agent fills, the failure modes, and where `build` sits in the loop.
- Out of scope (flagged separately): `scaffold-report.schema.json` still pins `build_type` to a
  closed enum, so a brand-new template slug would render but fail report validation. Not fixed
  here.
