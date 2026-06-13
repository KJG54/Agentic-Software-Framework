# AGENTS.md — Charter for Agents Working in App Builder V2

This file is the **canonical entry point** for any agent (Codex, Claude Code, or other) that
picks up this repository. Read it first. It is intentionally short and points to the detailed
ruleset rather than repeating it.

> Humans: see [HOWTO.md](HOWTO.md) for the operator's walkthrough. Claude Code loads this file
> via [CLAUDE.md](CLAUDE.md).

## What this is

App Builder V2 is a CLI-first, artifact-driven workbench that moves an idea through a
repeatable loop:

```text
Idea -> Requirements -> Plan -> Scaffold -> Build -> Test -> Review -> Ship
```

There is **no LLM inside the CLI**. The `appbuilder` commands scaffold, validate, and
coordinate; the *thinking* (writing requirements, building code) is done by you, the agent.

## Control plane: the `appbuilder` CLI

All shared state goes through the CLI — never hand-edit coordination state.

```bash
node cli/appbuilder.js <command>
```

Coordination state (queue tasks, claims, handoffs) lives on the `coordination/main` branch and
is reached only through the CLI, never by editing files directly.

## Quickstart (bootstrap, then per-task loop)

```bash
node cli/appbuilder.js doctor              # verify environment + framework layout
node cli/appbuilder.js init-coordination   # one-time: create the coordination branch/worktree
node cli/appbuilder.js status              # active claims, expired claims, orphaned branches
```

Per task:

```bash
node cli/appbuilder.js claim TASK-001                              # claim + create agent/ branch
# ... implement the change TEST-FIRST ...
node cli/appbuilder.js handoff --task TASK-001 --status complete --tests-run --tests-passed
node cli/appbuilder.js ready TASK-001                              # before-merge gate
# open a PR, get it reviewed, merge to main (direct push to main is blocked)
node cli/appbuilder.js release TASK-001 --reason "merged via PR #N"
```

## Hard rules

- **Advise before executing.** Before implementing or planning a requested change, assess
  whether it is practical, warranted, and consistent with the framework's design. If it isn't —
  or if an existing command/artifact/pattern already does the job — say so *first* and propose
  the better alternative. Never silently build something you believe is the wrong call.
- **Claim before editing.** Never edit a file under another agent's open claim.
- **Never work directly on `main`**; use `agent/TASK-NNN-short-description` branches.
- **Never hand-edit live files on `coordination/main`** — use the CLI.
- **Human-approval gates** stand at two points: approving a plan before `plan seed`, and
  reviewing each PR before merge. Do not bypass them.
- **Report failures with evidence** — full output, exit code, and impact. Do not mark partial
  work as complete.
- **No secrets in commits.** Do not run destructive commands without explicit approval.
- **Implement only what was asked**; do not add folders, services, or commands unless they
  directly improve the core loop.

## Slash commands (sugar over the CLI)

Humans and supported agents get these shortcuts; they wrap the CLI verbs below. Any agent can
run the CLI form directly — that is the universal interface.

| Command | CLI equivalent |
| --- | --- |
| `/status` | `appbuilder status` |
| `/doctor` | `appbuilder doctor` |
| `/plan` | `appbuilder plan new <slug>` → run the [build-type interview](.agent/plan-interview.md) → fill artifacts → `plan compile <slug>` → `plan seed <slug>` |
| `/work <TASK>` | `appbuilder claim <TASK>` → implement test-first → `handoff --tests-run --tests-passed` → `ready <TASK>` → PR/merge → `release <TASK>` |

Definitions live in `.claude/commands/` (Claude Code, auto-loaded per-project). Codex agents
need no shortcuts — Codex auto-loads this `AGENTS.md`, so run the CLI verbs above directly.
(Codex custom prompts are deprecated; a first-class Codex Skill is a possible future addition.)

The `/plan` flow opens with a **build-type interview** — see
[.agent/plan-interview.md](.agent/plan-interview.md). Both surfaces run the same script: Claude
Code reaches it through `/plan`, Codex through this `/plan` row. Conduct the interview before
writing `requirements.json`, and never seed without the human-approval gate.

## Detailed ruleset

The full rules live in [.agent/rules/](.agent/rules/) — read the one relevant to your task:

- [core.md](.agent/rules/core.md) — the loop, artifact discipline, anti-bloat.
- [coordination.md](.agent/rules/coordination.md) — claims, branches, the queue.
- [project-workflow.md](.agent/rules/project-workflow.md) — required artifacts and phase gates.
- [safety.md](.agent/rules/safety.md) — secrets, destructive ops, validation gates.
- [token-use.md](.agent/rules/token-use.md) — keep context focused.
- [collaboration.md](.agent/rules/collaboration.md) — advise before executing.
