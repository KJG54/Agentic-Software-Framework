# Build-type templates

`appbuilder scaffold <slug>` renders one of these templates into `build/<slug>/`, deterministically
and with **no LLM** — it copies the template's file tree and substitutes a small set of
`{{variables}}`. The templates here are the single source of truth for what `scaffold` can produce.

Run `appbuilder templates` (add `--json` for scripts) to list what's currently available.

## Templates that ship today

| `build_type` | What it renders |
| --- | --- |
| `cli` | A zero-dependency Node command-line tool. |
| `library` | A zero-dependency Node module with an exported API and a test. |
| `app` | A zero-dependency `node:http` service (`handler` + `start(port)`). |
| `game` | A terminal game: a pure `step()` reducer plus a thin stdin loop. |

## Authoring a new template

Templates are **dir-driven**: a template is any `templates/<id>/` directory with a valid
`template.json` manifest. Adding one is a single-folder change — **no schema edit, no code
change**. A `build_type` slug with no matching folder simply isn't scaffoldable, and `scaffold`
says so ("no template for build_type X yet").

### 1. Folder layout

```text
templates/<id>/
  template.json        # the manifest (see below)
  files/               # the literal tree scaffold renders into build/<slug>/
    package.json
    README.md
    ...
```

The `<id>` directory name is what an operator sets as `requirements.build_type` to select it.

### 2. The manifest — `template.json`

Validated against [`contracts/schemas/v1/template.schema.json`](../contracts/schemas/v1/template.schema.json).

```json
{
  "schema_version": "1.0",
  "id": "<id>",
  "name": "Human-Readable Name",
  "description": "One line shown by `appbuilder templates`.",
  "tags": ["..."],
  "required_files": ["package.json", "README.md", "src/index.js"]
}
```

`required_files` lists paths (relative to `files/`) that the render **must** produce — `scaffold`
fails loudly if any are missing, so it's a cheap correctness check on your `files/` tree.

### 3. The `files/` tree

Copied verbatim into `build/<slug>/`, except that these placeholders are substituted in **file
contents** (literal string replace — no logic, no expression language):

| Placeholder   | Source                          |
| ------------- | ------------------------------- |
| `{{slug}}`    | the project slug                |
| `{{summary}}` | `requirements.json` → `summary` |

### 4. Conventions

The shipped templates follow these — match them so generated projects behave consistently:

- **Zero runtime dependencies.** Use only `node:` built-ins; no `npm install` required.
- **`node --test` compatible.** Ship a `test/` that passes out of the box. Keep logic testable
  without a TTY or a fixed port (e.g. the `app` template exports `start(port)` so tests bind
  `listen(0)`; the `game` template isolates a pure reducer).
- **Only `{{slug}}`/`{{summary}}`.** Don't invent placeholders; the variable set is intentionally
  small.

### 5. Verify

```bash
appbuilder templates                 # your template appears in the list
appbuilder scaffold <demo-slug>      # with requirements.build_type set to your <id>
node --test "tests/**/*.test.js"     # framework suite stays green
```
