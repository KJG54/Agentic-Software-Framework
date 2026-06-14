# Agentic Software Framework

App Builder V2 is a CLI-first, artifact-driven workbench for moving an idea through a repeatable application-building loop:

```text
Idea -> Requirements -> Plan -> Scaffold -> Build -> Test -> Review -> Ship
```

The first implementation batch focuses on the multi-agent coordination foundation: versioned contracts, a root config, focused agent rules, an internal coordination worktree, claims, handoffs, readiness checks, and generated status.

## Quickstart

```bash
node --test "tests/**/*.test.js"  # run the test suite (canonical, cross-platform)
node cli/appbuilder.js doctor
```

> The glob scopes the runner to the framework's own tests under `tests/`, so generated template
> stubs (e.g. `build/<slug>/test/*.test.js` from `scaffold`) are never picked up. `npm test`
> runs the same command. On Windows, prefer `node --test` over `npm test`: PowerShell's
> execution policy can block the `npm.ps1` shim; `npm.cmd test` also works from PowerShell.

In a Git repository with at least one commit:

```bash
node cli/appbuilder.js init-coordination
node cli/appbuilder.js status
```

Human-approved queue tasks live on the dedicated `coordination/main` branch. Normal agents should use the CLI instead of manually editing files under `coordination/`.

## Core Commands

```bash
appbuilder init-coordination
appbuilder doctor
appbuilder status
appbuilder claim TASK-001
appbuilder release TASK-001
appbuilder handoff --task TASK-001 --status complete
appbuilder ready TASK-001
appbuilder events
```

## Planning Commands

```bash
appbuilder plan new <slug>       # scaffold projects/<slug>/ (requirements, architecture, task-plan)
# fill requirements.json and author task-plan.json
appbuilder plan compile <slug>   # validate requirements + task plan
appbuilder plan seed <slug>      # publish the plan's tasks to the coordination queue
```

`plan` turns an idea into the planning artifacts under `projects/<slug>/`. The CLI scaffolds
and validates; an agent fills in the requirements and task plan. `compile` enforces that the
requirements are filled and the task plan is internally consistent before `seed` publishes the
tasks to the human-reviewed coordination queue. See [HOWTO.md](HOWTO.md) for the full operator
walkthrough.

## Scaffold

```bash
appbuilder scaffold <slug>          # render the build-type skeleton into build/<slug>
appbuilder scaffold <slug> --force  # overwrite an existing build/<slug>
appbuilder templates                # list available templates (--json for scripts)
```

`scaffold` deterministically renders a project skeleton from the approved plan into
`build/<slug>/` — no LLM, just a template file-tree copy plus simple `{{slug}}`/`{{summary}}`
substitution from `requirements.json`. It reads `requirements.build_type` (a lowercase slug,
format-validated at `compile`) to pick a template from `templates/`, gates on `plan compile`
first, and writes a validated `build/<slug>/scaffold-report.json`. The `cli`, `library`, `app`,
and `game` templates ship today; templates are **dir-driven**, so adding one is a one-folder
change — see [templates/README.md](templates/README.md).

## Build

```bash
appbuilder build init <slug>        # seed build/<slug>/build-manifest.json (every plan task pending)
appbuilder build init <slug> --force # re-seed an existing manifest
appbuilder build <slug>             # validate the filled-in manifest, write build/<slug>/build-report.json
```

`build` is the deterministic checkpoint between `scaffold` and `test` — and, like every phase,
there is **no LLM** in it. The *agent* writes the real code into `build/<slug>/`; the CLI only
seeds an accounting stub and then validates what the agent declares.

- `build init` reads the plan and `scaffold-report.json` (it gates on having been scaffolded) and
  writes `build-manifest.json` with one `pending` entry per plan task. The agent fills each entry
  in as it works: `status` (`done` / `skipped`), the `files` it touched, and a `reason` for any
  skip.
- `build <slug>` validates the manifest against the plan and the files on disk — ids must match
  the task plan, nothing may be left `pending`, every `done` task must list real files, every
  `skipped` task needs a reason, and the scaffold's files must still exist. On success it writes
  `build/<slug>/build-report.json` (task counts + the union of touched files) for the test phase
  to consume; on failure it prints every problem and writes nothing.

See [HOWTO.md](HOWTO.md) for the full operator walkthrough.

The workflow commands `start`, `test`, `review`, and `ship` are present as placeholders for later phases.
