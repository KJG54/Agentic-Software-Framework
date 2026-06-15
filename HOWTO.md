# HOWTO — Operating App Builder V2

This guide is for **humans** driving the framework. Agents auto-load their charter from
[AGENTS.md](AGENTS.md) (which points to the detailed rules in [.agent/rules/](.agent/rules/));
this is the operator's view.

App Builder V2 is a CLI-first workbench. There is **no LLM inside the CLI** — the `appbuilder`
commands scaffold, validate, and coordinate; the *thinking* (writing requirements, building
code) is done by you or by AI agents. State that must be shared across agents lives on a
dedicated `coordination/main` branch, reached through the `appbuilder` commands rather than by
editing files directly.

## Prerequisites

- Node.js 18+
- Git 2.x+ with at least one commit in the repo

```bash
appbuilder doctor                  # check the environment and framework layout
node --test "tests/**/*.test.js"   # run the test suite (canonical, cross-platform)
```

> **Running the tests:** `node --test "tests/**/*.test.js"` is the canonical command and works
> the same on every platform. The glob scopes the runner to the framework's own tests under
> `tests/`, so generated template stubs (e.g. `build/<slug>/test/*.test.js` produced by
> `scaffold`) are never discovered and run. `npm test` runs the same command. On Windows, prefer
> `node --test` over `npm test` — PowerShell's execution policy can block the `npm.ps1` shim with
> an error like *"running scripts is disabled on this system"*; `npm.cmd test` also works.

## 1. One-time setup

```bash
appbuilder init-coordination   # create/verify the coordination branch + internal worktree
appbuilder status              # show active claims, expired claims, orphaned branches
```

## 2. Plan a project (idea → tasks)

`plan` is a three-step flow with a human review gate before work becomes claimable.

```bash
appbuilder plan new my-app
```

Scaffolds `projects/my-app/` with three stubs:

- `requirements.json` — goals, features, constraints (starts empty).
- `architecture.md` — a notes stub.
- `task-plan.json` — the list of tasks to queue (starts empty).

Now **fill them in.** If you drive this through an agent (`/plan` in Claude Code, or the same
`/plan` flow Codex loads from [AGENTS.md](AGENTS.md)), it won't just ask you to type JSON — it
runs a **build-type interview** first, scripted in
[.agent/plan-interview.md](.agent/plan-interview.md):

- **Phase A — universal triage.** Four questions, asked one at a time, that pin down what
  you're building, the core outcome, who uses it, and which build-type it is (game, CLI, app,
  library, or something else).
- **Phase B — build-type deep-dive.** Only the track matching your Phase A answer runs (~4–6
  more questions), drilling into the specifics that build-type needs.

The agent then **synthesizes** the answers into the artifacts and shows them back at two
**confirm-back gates** — first the proposed `requirements.json` (`summary`, `goals`,
`features`, `constraints`), then the first-draft `task-plan.json` (the `TASK-NNN` tasks, each
with `title`, `files_touched_estimate`, and optional `depends_on`). Nothing is written to disk
until you confirm each gate. Driving it yourself by hand works too — fill the same fields in
directly — but the interview is what makes the requirements step thorough rather than a blank
form.

```bash
appbuilder plan compile my-app
```

Validates structure **and** readiness: `summary`/`goals`/`features` must be non-empty, every
task must be valid, ids unique, and every `depends_on` must resolve within the plan. It writes
nothing — fix any `fail` lines and re-run until it prints `ok compile: ... passed`.

**Review the plan.** Once you're happy with it:

```bash
appbuilder plan seed my-app
```

Publishes each task to the coordination queue on `coordination/main`. Ids that already exist in
the queue are skipped (printed as `skip seed: TASK-00X already exists`) — never overwritten.

> Note: task ids are global `TASK-NNN` for now, so they can collide across projects. The `skip`
> lines make that visible; a per-project id scheme is a future improvement.

## 3. Scaffold the skeleton (plan → `build/<slug>`)

Once a plan is approved, `scaffold` turns it into a runnable project skeleton:

```bash
appbuilder scaffold my-app          # render into build/my-app
appbuilder scaffold my-app --force  # overwrite an existing build/my-app
```

What it does — deterministically, with **no LLM**:

- Reads `requirements.build_type` (a lowercase slug — the build-type interview sets it, and
  `plan compile` validates its format) and picks the matching template from `templates/`. Run
  `appbuilder templates` to see what's available.
- Gates on `plan compile` first — a project is only scaffolded once its plan is valid.
- Copies the template's file tree into `build/<slug>/`, substituting `{{slug}}` and `{{summary}}`
  from `requirements.json` into file contents.
- Writes a machine-readable `build/<slug>/scaffold-report.json` (build_type, template, the list
  of rendered files) for the next phase to consume.

```text
build/my-app/
  package.json  README.md  .gitignore
  src/index.js  test/index.test.js
  scaffold-report.json
```

Generated code lives under `build/<slug>/` (tracked) — separate from the plan artifacts in
`projects/<slug>/`. The `cli`, `library`, `app`, and `game` templates ship today (see
`appbuilder templates`). Templates are **dir-driven**: any `templates/<id>/` with a valid
manifest is scaffoldable, so a `build_type` with no matching folder simply reports a clear "no
template for build_type X yet". Adding a new template is a one-folder change — see
[templates/README.md](templates/README.md).

## 4. Build the project (`build/<slug>` → `build-report.json`)

`build` is the deterministic checkpoint between `scaffold` and `test`. Like every phase, it has
**no LLM**: the *agent* writes the real code into `build/<slug>/`, and the `build` command only
seeds an accounting stub and then validates what the agent declares against the plan and the
files on disk. It is a two-verb flow, mirroring `plan new` → `plan compile`.

```bash
appbuilder build init my-app          # seed the manifest (every plan task pending)
appbuilder build init my-app --force  # re-seed an existing manifest
appbuilder build my-app               # validate the filled-in manifest, write the report
```

### Step 1 — `build init`: seed the manifest

`build init` gates on `build/<slug>/scaffold-report.json` (you cannot build what was not
scaffolded), reads the compiled plan, and writes `build/<slug>/build-manifest.json` with **one
entry per plan task, all `pending`**:

```json
{
  "schema_version": "1.0",
  "project": "my-app",
  "tasks": [
    { "id": "TASK-001", "status": "pending", "files": [], "reason": "" }
  ]
}
```

It refuses to overwrite an existing manifest unless you pass `--force`, so a partly-filled
manifest is never clobbered by accident.

### Step 2 — the agent fills it in

As each task is implemented, the agent edits its manifest entry:

- **`status`** — one of:
  - `done` — implemented. Must list at least one real file under `files`.
  - `skipped` — deliberately not done. Must carry a non-empty `reason`.
  - `pending` — not addressed yet. Blocks the gate (this is the point — nothing is left
    unaccounted for).
- **`files`** — the paths (relative to `build/<slug>/`) the task touched.
- **`reason`** — required for a `skip`; explains why a planned task was dropped or deferred.

### Step 3 — `build`: validate and report

`appbuilder build <slug>` is the gate. It **passes only when**:

1. `build-manifest.json` exists and is schema-valid.
2. The manifest's task ids exactly match `task-plan.json` — no plan task missing, no stray ids.
3. No task is `pending`.
4. Every `done` task lists ≥1 `file`, and every listed file exists under `build/<slug>/`.
5. Every `skipped` task has a non-empty `reason`.
6. The files recorded in `scaffold-report.json` still exist (the scaffold has not regressed).

On success it writes `build/<slug>/build-report.json` — task counts plus the union of touched
files — for the test phase to consume:

```json
{
  "schema_version": "1.0",
  "project": "my-app",
  "generated_at": "2026-06-14T00:00:00.000Z",
  "tasks_total": 3,
  "tasks_done": 2,
  "tasks_skipped": 1,
  "files_touched": ["src/index.js", "src/parser.js"]
}
```

On **any** failure it prints every problem as a `fail build: …` line (all at once, like `plan
compile`), exits non-zero, and **writes nothing** — so a red gate never leaves a stale report
behind. Common failures and their fixes:

| `fail build: …` says | Fix |
| --- | --- |
| `task TASK-NNN is still pending` | Finish it and set `status`, or `skip` it with a reason. |
| `done task TASK-NNN must list at least one file` | Record the files it touched. |
| `done task TASK-NNN lists a missing file: X` | Fix the path, or create the file. |
| `skipped task TASK-NNN must carry a reason` | Add a `reason` for the skip. |
| `manifest is missing plan task TASK-NNN` | Add the task entry (or `build init --force` to re-seed). |
| `manifest task TASK-NNN is not in the plan` | Remove the stray id, or add the task to the plan. |
| `scaffold file no longer exists: X` | Restore the scaffolded file the build deleted. |

Re-run `appbuilder build <slug>` until it passes. The resulting `build-report.json` is what the
`test` phase consumes next.

## 5. Test the build (`build/<slug>` → `test-report.json`)

`test` is the gate after `build`, and the first phase where the CLI actually **runs** code rather
than only validating what the agent declared. Like every phase it has **no LLM** — running tests
is deterministic. It is a single verb:

```bash
appbuilder test my-app
```

What it does:

- **Gates on the build first.** `build/my-app/build-report.json` must exist — you cannot test
  what was not built. If it is missing you get `fail test: ... run appbuilder build my-app first`.
- **Runs the built project's own suite.** It executes `node --test` (with the TAP reporter, so
  the results are machine-readable) inside `build/my-app/`, discovering the test files the
  template and the build phase produced under `test/`.
- **Parses and gates.** It reads the run's summary and passes **only when** a build report
  exists, **at least one test ran**, and **zero tests failed**.

On success it writes `build/my-app/test-report.json` — the exact command plus the counts — for
the review phase to consume:

```json
{
  "schema_version": "1.0",
  "project": "my-app",
  "generated_at": "2026-06-14T00:00:00.000Z",
  "command": "node --test --test-reporter=tap",
  "tests_total": 5,
  "tests_passed": 5,
  "tests_failed": 0,
  "tests_skipped": 0
}
```

On **any** failure it prints the `node --test` output, adds a `fail test: …` line, exits
non-zero, and **writes nothing** — so, exactly like `scaffold` and `build`, a `test-report.json`
on disk always means the gate passed. Common failures and their fixes:

| `fail test: …` says | Fix |
| --- | --- |
| `no build report for <slug> …` | Run `appbuilder build <slug>` until it passes first. |
| `no tests found` | The build produced no runnable tests — add tests (the framework is test-first). |
| `N test(s) failed` | Read the printed output, fix the code or the test, and re-run. |

Re-run `appbuilder test <slug>` until it passes. The resulting `test-report.json` is what the
`review` phase consumes next.

## 6. Review the build (`test-report.json` → `review-report.md`)

`review` is the gate after `test`, before `ship`. Like every phase it has **no LLM** — but unlike
scaffold/build/test (which emit machine-written JSON reports), review's artifact is *prose*:
`build/<slug>/review-report.md`, a markdown file with YAML frontmatter (the same shape as
`architecture.md`/`handoff.md`). The agent or human writes the review; the CLI seeds a structured
stub and then validates it. It is a two-verb flow, mirroring `build init` → `build`.

```bash
appbuilder review init my-app          # seed the review-report.md stub
appbuilder review init my-app --force  # re-seed an existing review
appbuilder review my-app               # validate the filled-in review and gate
```

### Step 1 — `review init`: seed the report

`review init` gates on `build/my-app/test-report.json` (you cannot review an untested build) and
writes `build/my-app/review-report.md` with frontmatter and empty sections to fill:

```markdown
---
schema_version: "1.0"
project: my-app
reviewed_at: 2026-06-14T00:00:00.000Z
decision: changes_requested
---

# Review: my-app

## Summary

_What was built and tested, and the overall assessment._

## Findings

_Issues, risks, and observations from the review._

## Checklist

_What you verified: requirements met, tests meaningful, no obvious gaps._
```

`decision` starts at `changes_requested` so the gate stays red until you deliberately approve. It
refuses to overwrite an existing report without `--force`.

### Step 2 — the reviewer fills it in

Write the actual review under each heading, then — once you're satisfied — set `decision: approved`
in the frontmatter. The body is yours; the three sections (`## Summary`, `## Findings`,
`## Checklist`) must each carry real content.

### Step 3 — `review`: validate and gate

`appbuilder review my-app` is the gate. It **passes only when**:

1. `build/my-app/test-report.json` exists (the build was tested).
2. `build/my-app/review-report.md` exists.
3. Its frontmatter validates (`schema_version`, `project`, `reviewed_at`, and a `decision` of
   `approved` or `changes_requested`).
4. The `## Summary`, `## Findings`, and `## Checklist` sections are all present and non-empty.
5. `decision` is `approved`.

On **any** failure it prints each problem as a `fail review: …` line, exits non-zero, and writes
nothing new — `review-report.md` *is* the artifact, and your approval is recorded in its `decision`
field for the ship phase to read. Common failures and their fixes:

| `fail review: …` says | Fix |
| --- | --- |
| `no test report …` | Run `appbuilder test <slug>` until it passes first. |
| `no review report …` | Run `appbuilder review init <slug>` and fill it in. |
| `section ## Findings is empty` | Write real content under every required heading. |
| `decision is "changes_requested" …` | Address the findings, then set `decision: approved`. |

Re-run `appbuilder review <slug>` until it passes. An approved `review-report.md` is what the
`ship` phase reads to close the loop.

## 7. Ship the build (`review-report.md` → `ship-checklist.md`)

`ship` is the terminal phase that closes the loop. Like every phase it has **no LLM**, and like
`test`/`scaffold` it is a single verb — there is nothing to seed, because the artifact is entirely
CLI-generated. `ship` verifies the *whole* chain is on disk and rolls those facts up into
`build/<slug>/ship-checklist.md`.

```bash
appbuilder ship my-app           # verify the full chain, write build/my-app/ship-checklist.md
appbuilder ship my-app --force   # regenerate over an existing checklist
```

### Step 1 — the full-chain gate

Unlike the earlier per-phase gates, `ship` re-checks the **entire** upstream chain and collects
*every* failure before writing anything. It passes only when all of these hold:

1. `build/my-app/scaffold-report.json` exists and parses.
2. `build/my-app/build-report.json` exists and parses.
3. `build/my-app/test-report.json` exists and parses.
4. `build/my-app/review-report.md` exists, its frontmatter validates, and **`decision: approved`**.

On **any** failure it prints each problem as a `fail ship: …` line, exits non-zero, and writes
nothing. Common failures and their fixes:

| `fail ship: …` says | Fix |
| --- | --- |
| `no scaffold-report …` | Run `appbuilder scaffold <slug>`. |
| `no build-report …` | Run `appbuilder build <slug>` until it reports. |
| `no test-report …` | Run `appbuilder test <slug>` until it passes. |
| `no review report …` | Run `appbuilder review init <slug>` and fill it in. |
| `review decision is "changes_requested" …` | Finish the review and set `decision: approved`. |
| `… already exists. Re-run with --force` | The build already shipped; pass `--force` only if you mean to regenerate. |

### Step 2 — the generated checklist

On a passing chain `ship` reads the reports and writes `build/my-app/ship-checklist.md` — markdown
with validated flat frontmatter, plus three sections:

```markdown
---
schema_version: "1.0"
project: my-app
shipped_at: 2026-06-15T00:00:00.000Z
review_decision: approved
reviewed_at: 2026-06-14T00:00:00.000Z
---

# Ship Checklist: my-app

## Phase Summary
- Scaffold / Build / Test / Review roll-up (with the test counts from test-report.json)

## Artifacts
- the built files (from build-report.json) plus the four upstream reports

## Manual Go-Live Steps
- [ ] Tag the release, update the changelog, deploy, announce …
```

The `## Manual Go-Live Steps` checkboxes are **informational** — the CLI never verifies or ticks
them; they are a reminder list for the human shipping the release. Because they are human-tickable,
`ship` **refuses to overwrite an existing `ship-checklist.md` without `--force`** (like `scaffold`
and `review init`), so a re-run never wipes your go-live progress. A checklist on disk always means
the full-chain gate passed.

## 8. How work gets done

Once tasks are in the queue, an agent (or you) runs the coordination loop per task:

```bash
appbuilder claim TASK-001                                   # claim + create the task branch
# ... implement the change (test-first) ...
appbuilder handoff --task TASK-001 --status complete --tests-run --tests-passed
appbuilder ready TASK-001                                   # before-merge gate
# open a PR, get it reviewed, merge to main
appbuilder release TASK-001 --reason "merged via PR #N"     # free the claim
```

The human stays in the loop at two points: approving the plan before `seed`, and reviewing each
PR before merge.

> Sizing tip: a task's `files_touched_estimate` is also its size class — 1–2 files is small,
> 6+ is a hint to split it in the plan. See [.agent/rules/token-use.md](.agent/rules/token-use.md)
> for the per-session, weekly, and handoff-compression budgeting heuristics agents follow.

## Slash commands (Claude Code)

In a Claude Code session opened in this repo, these shortcuts wrap the CLI verbs above. They
load automatically — if they don't appear, run `/doctor` (or `appbuilder doctor`) and check the
`onboarding:*` lines.

- `/status` — coordination status (active/expired claims, orphaned branches).
- `/doctor` — framework diagnostics, including the `onboarding:*` checks that confirm the repo
  is agent-drivable.
- `/plan <slug>` — guide an idea through `plan new` → **build-type interview** → fill artifacts
  (with confirm-back gates) → `plan compile` → (human review) → `plan seed`. See
  [.agent/plan-interview.md](.agent/plan-interview.md) for the interview script.
- `/work <TASK>` — claim a task and run the per-task loop (claim → test-first → handoff →
  ready → PR/merge → release).

The commands are thin wrappers; the underlying `appbuilder` verbs work the same without them.
Codex agents don't get the shortcuts but auto-load the same workflow from [AGENTS.md](AGENTS.md).

## The loop, end to end

The full loop is now implemented end to end:

```text
plan → scaffold → build → test → review → ship
```

Each phase gates on the previous one's artifact and `ship` re-verifies the whole chain before it
writes `build/<slug>/ship-checklist.md` — the terminal artifact that marks the build ready for
go-live.
