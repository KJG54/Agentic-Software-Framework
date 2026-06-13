---
schema_version: "1.0"
project: plan-interview
---

# Architecture: plan-interview

## Overview

The `/plan` flow currently tells the agent to "help fill in `requirements.json`" — thin
guidance that assumes the operator already has a well-formed idea. This change replaces that
step with a **build-type-aware intake interview**: the agent asks structured questions that get
to the root of what the operator wants, then synthesizes the answers into the existing planning
artifacts.

The change is **additive and skill-layer only**. The `appbuilder` CLI (`plan new/compile/seed`)
is untouched and stays LLM-free; all new behavior lives in a shared markdown script that agents
read and follow. This keeps the CLI deterministic and testable while moving the "thinking" to
the agent, exactly as the framework intends.

## Components

- **`.agent/plan-interview.md` (new) — the interview script.** Single source of truth, written
  agent-agnostically so both Claude Code (`/plan`) and Codex (CLI verbs) run the same flow.
  Contains:
  - *Phase A — universal triage* (asked one question at a time):
    1. What are you building, in a sentence or two? → seeds `summary`
    2. What's the core outcome / the one thing it must do well? → seeds the top `goal`
    3. Who uses it, and in what context? → seeds `constraints` and framing
    4. Which best describes it — game / CLI tool / app / library / something else? → routes to
       Phase B
  - *Phase B — build-type deep-dive* (~4–6 questions per track):
    - **Game** — core loop, win/lose conditions, player input, platform, art/audio scope
    - **CLI tool** — commands/verbs, input→output contract, flags, exit codes, scripting use
    - **App** — users & roles, key screens/flows, data model & persistence, platform
    - **Library** — public API surface, consumers, language/runtime, versioning & docs
    - **Generic fallback** — inputs, outputs, key operations, dependencies, done-criteria
  - *Synthesis & confirm-back* — map answers onto `requirements.json` fields, show the proposed
    document in plain language, confirm, then propose and confirm a first-draft `task-plan.json`.

- **Operator surfaces (edited) — the wiring.** `.claude/commands/plan.md` step 2 points at the
  guide; `AGENTS.md` references it from the `/plan` documentation so Codex follows it;
  `HOWTO.md` describes the new interview behavior for humans.

- **Drift guard (edited) — `cli/appbuilder.js` + `tests/appbuilder.test.js`.** A `doctor` check
  and a test assert the guide exists and is referenced, so the wiring cannot silently rot.

## Data flow

```text
operator idea
  → Phase A triage  → build-type
  → Phase B deep-dive
  → synthesis  → [confirm] → requirements.json
              → [confirm] → task-plan.json (TASK-NNN, files_touched_estimate, depends_on)
  → plan compile  → HUMAN APPROVAL GATE  → plan seed → coordination queue
```

The interview never writes to disk before the operator confirms the synthesized artifacts, and
the existing human-approval gate before `seed` is preserved.

## Decisions

- **Self-contained, not a superpowers wrapper.** The interview overlaps with the superpowers
  `brainstorming` skill, but App Builder must stay portable (Codex operators cannot invoke
  superpowers). So the interview is authored natively as a shared guide rather than delegating.
- **Shared `.agent/` guide over inline command prose.** A single agent-agnostic file keeps one
  source of truth and lets both the Claude command and `AGENTS.md`/Codex run the same script —
  mirroring how `.agent/rules/` already works.
- **Two-phase over a flat questionnaire.** Branching by build-type asks materially better
  questions (a game and a CLI library should not get the same generic prompts).
- **No CLI changes for the interview itself.** Encoding questions as data near the CLI was
  rejected to avoid pushing "thinking" toward the LLM-free control plane; the only CLI edit is
  the existence/reference drift check.

## Out of scope

- Changes to `plan new/compile/seed` semantics or the `requirements`/`task-plan` schemas.
- Build/test/review/ship phases.
- The global `TASK-NNN` collision limitation (tracked separately).
