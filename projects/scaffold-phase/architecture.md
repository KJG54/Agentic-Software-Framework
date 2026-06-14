---
schema_version: "1.0"
project: scaffold-phase
---

# Architecture: scaffold-phase

This is the design spec for the `appbuilder scaffold` phase. It is the brainstorming
output for the slice and the source of truth the task plan implements.

## Overview

`scaffold` is the loop phase between `plan` and `build`:

```text
Idea -> Requirements -> Plan -> [Scaffold] -> Build -> Test -> Review -> Ship
```

`appbuilder scaffold <slug> [--force]` deterministically renders a build-type project
skeleton from an approved plan into `build/<slug>/`. There is no LLM in the CLI: scaffolding
is a file-tree copy plus simple `{{variable}}` substitution. The *thinking* (writing the real
code into the skeleton) happens in the Build phase, by an agent.

This first slice ships the whole mechanism end-to-end with a single `cli` template.

## Components

### 1. `build_type` in `requirements.json`

`requirements.schema.json` gains an **optional** `build_type` property, enum-constrained to
`["game", "cli", "app", "library", "other"]`. The interview writes it; `plan compile` enforces
the enum **when present**. It stays optional so existing `requirements.json` files remain valid.

Division of responsibility:

- **compile** validates the *vocabulary* (build_type is a recognized enum value).
- **scaffold** validates *availability* (a template exists for that build_type). So
  `build_type: "game"` compiles fine, but `scaffold` reports "no template for 'game' yet" until
  a `templates/game/` template is authored in a later slice.

### 2. Template format — `templates/<id>/`

```text
templates/cli/
  template.json          # manifest, valid against the existing template.schema.json
  files/                 # the literal tree to render
    package.json
    README.md
    .gitignore
    src/index.js
    test/index.test.js
```

`template.json` carries `id`, `name`, `description`, `tags`, and `required_files` (the list of
paths the render must produce — a post-render sanity check). The `files/` subtree is copied
verbatim except for variable substitution.

### 3. Render — copy + simple substitution

`scaffold` copies `templates/<build_type>/files/` into `build/<slug>/`, replacing a small,
documented set of placeholders in **file contents**:

| Placeholder   | Source                       |
| ------------- | ---------------------------- |
| `{{slug}}`    | the project slug             |
| `{{summary}}` | `requirements.json` `summary`|

Substitution is a literal string replace — no expression language, no conditionals, no logic.
The variable set is intentionally minimal and can grow in later slices.

### 4. Output & report

- Skeleton lands in **`build/<slug>/`**, a new tracked top-level tree (it is the product being
  built; plan artifacts stay in `projects/<slug>/`).
- `scaffold` writes `build/<slug>/scaffold-report.json`, validated against a new
  `contracts/schemas/v1/scaffold-report.schema.json` and registered in `doctor`'s
  `REQUIRED_SCHEMA_NAMES`:

```json
{
  "schema_version": "1.0",
  "project": "<slug>",
  "build_type": "cli",
  "template": "cli",
  "generated_at": "<iso-8601>",
  "output_dir": "build/<slug>",
  "rendered_files": ["package.json", "README.md", ".gitignore", "src/index.js", "test/index.test.js"]
}
```

### 5. Command module — `cli/lib/scaffold.js`

Post-TASK-404 the CLI is modular; `scaffold` is a new `cli/lib/scaffold.js` dispatched from the
router (replacing the `scaffold` placeholder). Flow of `appbuilder scaffold <slug> [--force]`:

1. `loadProject`; locate `projects/<slug>/`.
2. **Gate:** reuse `compilePlan(project, slug)` — the plan must compile. Fail clearly otherwise.
3. Read `requirements.build_type`; require it present **and** that `templates/<build_type>/`
   exists. Fail with a precise message otherwise.
4. Resolve `build/<slug>/`. If it exists and `--force` was not passed, refuse (mirrors how
   `plan new` refuses to clobber).
5. Copy `templates/<build_type>/files/` -> `build/<slug>/` with `{{variable}}` substitution.
6. Assert every `required_files` entry from the manifest was produced.
7. Write `build/<slug>/scaffold-report.json`; validate it against its schema.
8. Print a summary (output dir, template, file count).

Dependency direction stays acyclic: `scaffold` -> `plan` (for `compilePlan`) -> `coordination`
-> `validate` -> `git`/`util`.

### 6. Test-runner scoping

`scripts.test` is `node --test`, which would otherwise discover generated
`build/<slug>/test/*.test.js` stubs and run them as framework tests. Scope the runner to
`tests/` (e.g. `node --test tests/`) and mirror that in the canonical invocation so generated
stubs never pollute the suite.

## Decisions

- **Skeleton, not stubs or manifest-only.** scaffold produces a runnable build-type skeleton so
  Build has a real foundation (vs. per-task empty stubs or a report-only bridge).
- **`build/<slug>/`, tracked.** Generated product is separated from plan artifacts and tracked
  in git (it is the app being built).
- **Artifact-driven template selection.** `build_type` lives in `requirements.json`, not a
  required flag — consistent with the framework's artifact-first design.
- **Copy + simple substitution.** Deterministic and minimal; conditional/logic-driven
  generation is explicitly out of scope (anti-bloat, no LLM).
- **One `cli` template this slice.** Prove the pipeline with the least authoring; game/app/
  library templates are deferred to later slices.

## Out of scope (this slice)

- game / app / library templates.
- The `build` phase itself (writing real code into the skeleton).
- Conditional or logic-driven template rendering; any expression language.
- A `doctor` check specific to scaffold beyond the existing `scaffold-report.json`
  `schema_version` scan.

## Test-first coverage

- Render + substitution: `scaffold` populates `build/<slug>/` from `templates/cli/` with
  `{{slug}}`/`{{summary}}` substituted.
- Idempotency: refuses when `build/<slug>/` exists; `--force` overwrites.
- Gating: fails when `build_type` is missing, out of enum (caught at compile), or has no
  template.
- Report: `scaffold-report.json` is written, schema-versioned, and valid against its schema.
- Suite hygiene: generated `build/<slug>/test/*.test.js` stubs are not run by the framework suite.
