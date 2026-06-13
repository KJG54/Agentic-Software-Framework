---
schema_version: "1.0"
---

# Design: `plan` command (idea → requirements → task-plan → queue)

Date: 2026-06-13
Status: approved (brainstorm), implementation in progress

## Problem

App Builder V2's coordination core is complete, but the product loop
(`plan → scaffold → build → test → review → ship`) is still placeholder verbs. `plan` is
the head of that loop: it turns an idea into the planning artifacts later commands consume
and feeds the human-approved coordination queue. This design covers **only** `plan`.

## Model

- **Scaffold + validate.** The zero-dependency CLI (no LLM) scaffolds artifact stubs and
  validates them; an agent supplies the thinking in between. This keeps `plan` deterministic
  and testable.
- **JSON Schema validates structure; the CLI enforces semantic readiness.** The validator in
  `core/validation/schema-validator.js` supports `const`/`enum`/`type`/`required`/`properties`/
  `items`/`minLength`/`pattern`/`minimum`/`additionalProperties` only — no `$ref`, `minItems`,
  or `uniqueItems`. So schemas stay simple and non-empty/uniqueness/reference checks live in
  CLI code.

## Three subcommands

A human review gate sits between `compile` and `seed` (the README's "human-approved queue").

1. **`plan new <slug>`** — create `projects/<slug>/` with three stubs; refuse if
   `requirements.json` already exists (no clobber). Stubs are structurally valid but
   semantically empty.
2. **`plan compile <slug>`** — read-only validation, exit 0/1, `ok`/`fail` lines like
   `doctor`/`ready`:
   - Structure: `requirements.json` and `task-plan.json` against their schemas.
   - Semantic readiness (CLI): `summary` non-empty (trimmed), `goals` non-empty, `features`
     non-empty with each `name` non-empty.
   - Task-plan integrity (CLI): `tasks` non-empty; each task passes `validateQueueTask`
     (enforces `TASK-NNN`); ids unique within the plan; every `depends_on` resolves to an id
     in the plan.
3. **`plan seed <slug>`** — re-run compile validation (abort on failure), then publish via the
   existing `ensureCoordinationWorktree → commitIfChanged → maybePush` path. Per task: skip
   ids already present in `coordination/queue/` (no overwrite), else write
   `coordination/queue/<id>.json`. Reports every outcome:
   ```
   ok compile: passed
   ok seed: TASK-001 published
   skip seed: TASK-002 already exists
   ok coordination: committed
   ```

## Artifacts (under `projects/<slug>/`, tracked on `main`)

`doctor` already scans these for `schema_version`, so they belong in the working tree.

- `requirements.json` — `{ schema_version, project, summary, goals[], features[], constraints[] }`;
  `project` is the slug string.
- `architecture.md` — markdown stub with `schema_version` frontmatter; scaffolded, not gated by
  compile, but carries frontmatter so `doctor` stays green.
- `task-plan.json` — `{ schema_version, project, tasks[] }`; each task is queue-task-shaped.

## New schemas

- `contracts/schemas/v1/requirements.schema.json`
- `contracts/schemas/v1/task-plan.schema.json` (`tasks.items` kept broad; per-task rigor via
  `validateQueueTask`)

Both added to `REQUIRED_SCHEMA_NAMES` so `doctor` checks they exist.

## Known V1 limitation

Global `TASK-NNN` ids can collide across projects. Accepted for V1; the loud `skip seed` line
keeps it auditable. A queue allocator or project-prefixed ids is a future item.

## Out of scope

`build/test/review/ship` stay placeholders. No LLM/idea-parsing in the CLI.
