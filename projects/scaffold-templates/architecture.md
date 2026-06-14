---
schema_version: "1.0"
project: scaffold-templates
---

# Architecture: scaffold-templates

This is the design spec for the second scaffold slice. It is the brainstorming output for the
slice and the source of truth the task plan implements. It builds directly on the
[`scaffold-phase`](../scaffold-phase/architecture.md) design, which shipped the engine and the
single `cli` template.

## Overview

The scaffold engine (`cli/lib/scaffold.js`) is already correct: it copies
`templates/<build_type>/files/` into `build/<slug>/` with `{{slug}}`/`{{summary}}` substitution,
enforces `required_files`, and writes a validated `scaffold-report.json`. This slice does **not**
touch the engine. It:

1. **Authors the three missing templates** — `game`, `app`, `library` — so every meaningful
   build type can be scaffolded end-to-end (`cli` exists; `other` is the intentional
   template-less catch-all).
2. **Makes templates dir-driven** — the `templates/` directory becomes the single source of
   truth for what is scaffoldable, so adding a future template is a one-folder change.
3. **Adds discovery** — `appbuilder templates` lists what is available.

All templates are zero-dependency Node, `node --test` compatible, no `npm install` — consistent
with the existing `cli` template.

## Components

### 1. Dir-driven `build_type` (TASK-601)

Today `build_type` is a closed enum `["game","cli","app","library","other"]` in
`contracts/schemas/v1/requirements.schema.json`. That duplicates truth the `templates/`
directory already owns and forces a two-step edit (folder **and** schema) per new template.

Change `build_type` to an **optional, format-validated slug string**:

```json
"build_type": { "type": "string", "pattern": "^[a-z0-9][a-z0-9-]*$" }
```

Division of responsibility after the change:

- **compile** validates the *format* (a lowercase slug) and keeps the field optional, so existing
  `requirements.json` files (cli, scaffold-phase, omitted) stay valid.
- **scaffold** validates *availability* — its existing "no template for build_type X yet" error
  is now the sole gate on whether a value is scaffoldable.

The old `"other"` sentinel (deliberately no template) is preserved naturally: any `build_type`
without a matching `templates/<id>/` folder simply is not scaffoldable.

> Trade-off (decided): this removes a vocabulary guardrail. We accept it — the enum was premature
> coupling, and scaffold already enforces the only constraint that matters (does a template
> exist). No `plan compile` advisory is added.

### 2. The three templates — `templates/<id>/`

Each follows the established format: a `template.json` manifest (valid against
`template.schema.json`, listing `required_files`) plus a `files/` subtree rendered verbatim
except for `{{slug}}`/`{{summary}}` substitution.

**`library` (TASK-602)** — a reusable Node module.

```text
templates/library/
  template.json
  files/
    package.json        # name {{slug}}, main src/index.js, NO bin, test script
    README.md
    .gitignore
    src/index.js        # exports a sample function
    test/index.test.js  # exercises the exported function
```

**`app` (TASK-603)** — a `node:http` service. The key design choice: `src/server.js` exports
**both** the request handler and a `start(port)` helper, so the test can bind an ephemeral port
(`listen(0)`), issue one request, and assert the response — fully testable, zero dependencies.

```text
templates/app/
  template.json
  files/
    package.json        # name {{slug}}, start script "node src/server.js", test script
    README.md
    .gitignore
    src/server.js       # node:http; exports handler + start(port)
    test/server.test.js # listen(0) -> request -> assert
```

**`game` (TASK-604)** — a terminal game split into a **pure reducer** and a thin loop, so the
logic is testable without a TTY:

```text
templates/game/
  template.json
  files/
    package.json
    README.md
    .gitignore
    src/game.js         # pure: initialState + step(state, input) -> state
    src/index.js        # wires the reducer to a stdin loop
    test/game.test.js   # exercises the pure reducer
```

### 3. Discovery — `appbuilder templates` (TASK-605)

A new `cli/lib/templates.js` exporting `listTemplates(cwd)` that scans `templates/*/template.json`
and returns `{ id, name, description }` per valid manifest. The router dispatches
`appbuilder templates [--json]`:

- default: human-readable list of `id` / `name` / `description`;
- `--json`: structured list (mirrors the `status` command's `--json`/human split).

Non-template entries (`.gitkeep`) and malformed manifests are skipped without crashing. This
surfaces the live, dir-driven list that replaces the hardcoded enum as the canonical answer to
"what can I scaffold?"

### 4. Docs (TASK-606)

- An **authoring-a-template recipe** (`templates/README.md`): folder layout, the
  `template.json` contract, the two substitution variables, `required_files`, and that dropping a
  folder is all it takes.
- `HOWTO.md` / `README.md` scaffold sections mention `appbuilder templates` and the open
  `build_type`.
- `.agent/plan-interview.md` points at the live `appbuilder templates` list instead of a fixed
  enum when classifying the build type.

## Decisions

- **Engine untouched.** The render contract is already correct; this slice is content +
  discovery + decoupling only.
- **Dir-driven over enum.** The `templates/` directory is the single source of truth; adding a
  template is a one-folder change. (See trade-off note above.)
- **Zero-dependency Node, uniformly.** Every template matches the `cli` template's discipline —
  `node:` built-ins only, `node --test` compatible — so generated projects need no `npm install`
  and stay deterministic.
- **Testable-by-construction templates.** `app` exports `start(port)` for ephemeral-port testing;
  `game` isolates a pure reducer. Each rendered template ships a passing test.

## Out of scope (this slice)

- Framework-based templates (Express, HTML5 canvas, etc.) — explicitly rejected to preserve the
  zero-dependency guarantee.
- Additional substitution variables beyond `{{slug}}`/`{{summary}}`.
- The `build` phase (writing real code into the skeletons).
- A `plan compile` advisory for unknown build types.

## Test-first coverage

- **601:** compile accepts a valid slug and an omitted `build_type`; rejects a malformed value;
  existing artifacts still validate.
- **602–604:** scaffolding each `build_type` renders its `files/` tree with substitution, produces
  all `required_files`, writes a valid `scaffold-report.json`, and the rendered test passes under
  `node --test`.
- **605:** `appbuilder templates` lists cli/library/app/game in both human and `--json` modes;
  ignores `.gitkeep` / malformed manifests.
- **606:** docs-only; full suite stays green.
