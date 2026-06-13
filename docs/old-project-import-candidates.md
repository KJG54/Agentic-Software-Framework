---
schema_version: "1.0"
---

# Old-Project Import Candidates

> **Status: planning reference only.** This note records what *should later be moved or
> adapted* from the older `KJG54/App-Builder` repo into this V2 repo. **Nothing here has
> been migrated.** It is not a task list and creates no obligation. Wherever possible the
> recommendation is to **adapt a concept** to V2's conventions, not to copy old files
> verbatim. All paths are written in V2 terms (lowercase `vault/`, `coordination/`,
> `.appbuilder/`, `projects/`) except where a source path is quoted directly.

## Purpose

App Builder V2's Phase 1 — multi-agent coordination — is complete and hardened. The next
direction is the deferred product loop (`plan → scaffold → build → test → review → ship`,
currently CLI placeholders). The old repo already explored much of that territory, plus
governance, a knowledge Vault, and semantic search. This note triages that prior work so
future V2 phases can **reuse proven ideas** instead of reinventing them — or blindly
importing weight V2 was deliberately designed to shed.

## Source Snapshot

- **Old (`KJG54/App-Builder`)** — a heavier *Claude/Vault/Chroma/Docker* workbench:
  Node 20+, Docker Desktop hosting a Chroma vector DB, an Obsidian-style numbered Vault,
  a `.claude/` command/script suite, and a two-agent (Claude Architect / Codex Builder)
  model coordinated through an async `agent-mailbox.js`.
- **This repo (V2)** — a leaner, **CLI-first, git-coordination** framework with **zero
  runtime dependencies** (pure Node 18+ and `node:test`). Coordination state lives on the
  `coordination/main` branch and is driven through the `appbuilder` CLI
  (`claim/release/handoff/ready/doctor/status/events`) against an internal worktree at
  `.appbuilder/coordination-worktree`.

Sources reviewed (old repo, `main`):

- Repo root & README — https://github.com/KJG54/App-Builder
- `AGENTS.md` — https://raw.githubusercontent.com/KJG54/App-Builder/main/AGENTS.md
- `CLAUDE.md` — https://raw.githubusercontent.com/KJG54/App-Builder/main/CLAUDE.md
- `WORKFLOW.md` — https://raw.githubusercontent.com/KJG54/App-Builder/main/WORKFLOW.md
- `GETTING-STARTED.md` — https://raw.githubusercontent.com/KJG54/App-Builder/main/GETTING-STARTED.md
- `COMMANDS.md` — https://raw.githubusercontent.com/KJG54/App-Builder/main/COMMANDS.md

## Recommended Imports — adopt or adapt soon

Concepts worth bringing into V2 in the near term, each adapted to V2's structure.

### 1. Framework-vs-local boundary model
The old README cleanly separates **tracked framework assets** (`Vault/`, `.claude/scripts`
+ `commands`, `settings.json`, docs, `docker-compose.yml`, `.mcp.json`, `package.json`,
`.env.example`) from **local-only state** (`.env`, `Projects/`, `docker/volumes/`,
`.claude/plans|metrics|logs`). Adapt this to V2 paths: framework = `cli/`, `core/`,
`contracts/`, `.agent/rules/`, `templates/`, `tools/`, `vault/framework/`; local/generated
= `projects/`, `vault/projects/`, `coordination/generated/`, `.appbuilder/`. V2 already
gitignores `.appbuilder/`, `.remember/`, `.obsidian/`, and `.env`/`*.env`; document the
boundary explicitly so later phases keep generated project output out of framework history.

### 2. A root `AGENTS.md` for Codex
The old `AGENTS.md` gives non-Claude agents a clear charter (roles, file-claim rule, scope
control, evidence-required reporting). V2 should have a root `AGENTS.md` too — but rewritten
around the **`appbuilder` CLI verbs** (`claim` → `handoff` → `ready` → `release`) rather than
the old `agent-mailbox.js`, and pointing at the existing `.agent/rules/*` as the detailed
ruleset. Keep the strongest old rules: never edit a file under another agent's open claim;
report failures with full output, exit code, and impact; implement only what was asked.

### 3. Workflow & approval guidance
`WORKFLOW.md` and `CLAUDE.md` define a decision-priority order, a 5-tier risk classification
(human-only approval for the top tiers), and three review gates (code review, verification,
documentation sync). Translate these into V2's CLI-first, **`ready`-gate** style and map them
onto the existing `.agent/rules/` files (`core`, `coordination`, `project-workflow`,
`safety`, `token-use`) rather than introducing a parallel governance doc. The risk tiers in
particular are a good fit for deciding which `ready` failures are warnings vs. hard blocks.

### 4. Vault taxonomy
The old Vault uses numbered Obsidian folders (e.g. `Vault/07-Decisions/DECISIONS.md`). V2
already has the lowercase equivalents under `vault/framework/{decisions,lessons,known-problems}`
and `vault/projects/`. Adopt the *taxonomy intent* (durable decisions/lessons separated from
project notes) without the numbering or the Obsidian-specific layout.

### 5. Lifecycle command concepts
The old `/discover` and `/plan-project` commands, plus the Discovery → Planning →
Implementation → Validation → Documentation phases, are the conceptual blueprint for V2's
placeholder verbs `start / plan / scaffold / build / test / review / ship`. Mine them for
the *inputs, outputs, and gates* of each phase when those commands get built (see
**Suggested Future Plan Seeds**).

### 6. Security / review checks
The old repo references security review steps. V2 already does a lightweight regex secret
scan inside `ready`. As a **future, optional** enhancement, consider wrapping `gitleaks`
(secret scanning) and `semgrep` (static analysis) as opt-in checks — concepts only, **no
dependencies added now**, and only if they can stay out of the zero-dep core (e.g. invoked
via `tools/` when present).

## Deferred Imports — wait for the matching V2 phase

Valuable, but premature until V2 has the surface area to host them.

- **Chroma semantic indexing + Docker.** The Vault-into-Chroma vector search and its
  `docker-compose.yml` / `npm run ingest` machinery are powerful but heavy. Defer until V2
  has a real need for semantic recall and a story for staying optionally-dependency-free.
- **Full scaffolder / build-runner / ship-runner.** The end-to-end project generation and
  execution behavior should land incrementally alongside the `scaffold`/`build`/`ship`
  commands, not as a bulk import.
- **MCP profile inventory + richer `setup`/`doctor`.** V2 has an `mcp-profile` schema stub
  and `default_mcp_profile: minimal`; the old MCP inventory and deeper health checks can be
  adapted once MCP profiles are actually consumed.
- **Old slash-command catalog as inspiration only.** `/audit`, `/guardian`, `/curator`,
  `/efficiency`, `/discover`, `/plan-project`, etc. are useful *ideas*. Do **not** import the
  `.claude` command implementations; re-express any that prove valuable as `appbuilder`
  subcommands or `.agent/rules` guidance.

## Explicit Non-Imports — do not copy

- The `.claude/` implementation as-is (commands, scripts, settings).
- The old `package.json` / `package-lock.json`, its dependency versions, and the **Node 20**
  requirement — V2 is intentionally **Node 18+ and zero-dependency**.
- `.obsidian/`, `.smart-env/`, local runtime state, `docker/volumes/`, generated logs, and
  the old `Projects/` contents.
- Any Claude-specific governance text copied **verbatim** instead of adapted — V2 must stay
  CLI-first and agent-agnostic (Codex-friendly), not Claude-coupled.

## Suggested Future Plan Seeds

Concise, non-binding seeds that can later be lifted into real implementation plans. Each is
marked **future** and is **not scheduled**. They target V2's existing-but-unbuilt artifacts
(`requirements.json`, `architecture.md`, `task-plan.json`, `scaffold-report.json`,
`test-report.json`, `review-report.md`, `ship-checklist.md`) declared in
`.agent/rules/project-workflow.md` and scanned by `doctor`.

- **Seed A — `plan` command (future).** Turn an idea / requirements input into
  `requirements.json` + `task-plan.json`, both schema-validated with a `schema_version`,
  reusing the existing validator dispatch in `core/validation/schema-validator.js` and the
  JSON-artifact conventions. Output feeds the coordination queue.
- **Seed B — `scaffold` command (future).** Consume `task-plan.json` to emit a project
  skeleton under `projects/<slug>/` plus a `scaffold-report.json`, wired into the existing
  `ready` gate and coordination claims so scaffolding is a claimable, auditable step.
- **Seed C — governance adaptation (future).** Port the old risk-tier approval gates and the
  code-review / verification / documentation-sync gates into `.agent/rules/*` and the `ready`
  checks, so approval rigor scales with change risk instead of being uniform.

Each seed, when promoted to a plan, should specify its precise inputs, the V2 artifact and
command it targets, and its gate behavior — none of that is decided here.
