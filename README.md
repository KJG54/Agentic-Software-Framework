# Agentic Software Framework

App Builder V2 is a CLI-first, artifact-driven workbench for moving an idea through a repeatable application-building loop:

```text
Idea -> Requirements -> Plan -> Scaffold -> Build -> Test -> Review -> Ship
```

The full loop is implemented end to end, built on a multi-agent coordination foundation: versioned contracts, a root config, focused agent rules, an internal coordination worktree, claims, handoffs, readiness checks, and generated status.

> New here? Start with **[GUIDE.md](GUIDE.md)** — a plain-language tour of what this is, everything it does, and the whole workflow step by step. This README is the quick command reference.

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

## Test

```bash
appbuilder test <slug>              # run the built project's tests, write build/<slug>/test-report.json
```

`test` is the gate after `build` — and the first phase where the CLI *runs* something rather than
only validating declarations. Still **no LLM**: it executes the built project's own suite with
`node --test` inside `build/<slug>/`, parses the results, and gates on a clean green.

- It first checks that `build/<slug>/build-report.json` exists — you cannot test what was not
  built.
- The gate passes only when a build report exists, **at least one test ran**, and **zero tests
  failed** (a test-first build must never green on nothing).
- On success it writes `build/<slug>/test-report.json` (the exact command plus pass/fail/skip
  counts) for the review phase to consume; on any failure it prints the test output and writes
  nothing — so a report on disk always means the gate passed.

See [HOWTO.md](HOWTO.md) for the full operator walkthrough.

## Review

```bash
appbuilder review init <slug>       # seed build/<slug>/review-report.md (gated on test-report.json)
appbuilder review init <slug> --force # re-seed an existing review
appbuilder review <slug>            # validate the filled-in review, gate on decision: approved
```

`review` is the gate after `test`, before `ship` — still **no LLM**. Unlike the earlier phases it
produces a *prose* artifact, `build/<slug>/review-report.md` (markdown with YAML frontmatter, like
`architecture.md`). The agent/human writes the review; the CLI seeds a structured stub and
validates it.

- `review init` gates on `build/<slug>/test-report.json` (you cannot review an untested build) and
  seeds a stub with frontmatter (`decision: changes_requested`) plus `## Summary` / `## Findings` /
  `## Checklist` headings. It refuses to overwrite without `--force`.
- `review <slug>` passes only when the test report exists, the review report's frontmatter
  validates, the required sections are non-empty, **and `decision: approved`**. On failure it
  prints every problem and writes nothing. Approval lives in the `decision` frontmatter for the
  ship phase to read.

See [HOWTO.md](HOWTO.md) for the full operator walkthrough.

## Ship

```bash
appbuilder ship <slug>              # verify the full chain, write build/<slug>/ship-checklist.md
appbuilder ship <slug> --force      # regenerate over an existing checklist
```

`ship` is the terminal phase that closes the loop — still **no LLM**. A single verb (there is
nothing to seed): it verifies the *whole* chain is on disk and rolls those facts up into
`build/<slug>/ship-checklist.md`.

- The full-chain gate collects **every** failure before writing anything: `scaffold-report.json`,
  `build-report.json`, and `test-report.json` must exist and parse, and `review-report.md` must have
  valid frontmatter with **`decision: approved`**. On any failure it prints each `fail ship:` line
  and writes nothing.
- On a passing chain it writes `build/<slug>/ship-checklist.md` (markdown with validated frontmatter):
  a `## Phase Summary` with the test counts, a `## Artifacts` roll-up (the built files plus the four
  upstream reports), and static `## Manual Go-Live Steps` checkboxes — informational reminders the
  CLI never verifies.
- Like `scaffold` and `review init`, it refuses to overwrite an existing checklist without `--force`,
  so a human's go-live ticks survive a re-run.

See [HOWTO.md](HOWTO.md) for the full operator walkthrough.
