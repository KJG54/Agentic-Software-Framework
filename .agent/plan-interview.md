---
schema_version: "1.0"
---

# Plan Interview — build-type intake for `/plan`

This is the script the agent runs during the **requirements step** of the plan flow
(`appbuilder plan new <slug>` → *interview* → fill `requirements.json` + `task-plan.json` →
`plan compile` → human approval → `plan seed`).

It exists because the old guidance — "help fill in `requirements.json`" — assumed the operator
already had a well-formed idea. Instead, **interview the operator to get to the root of what
they want to build**, then synthesize the answers into the planning artifacts.

This guide is agent-agnostic: Claude Code reaches it via the `/plan` command, Codex via the
`AGENTS.md` `/plan` documentation. Both run the same script.

## How to run it

- **Ask one question at a time.** Wait for the answer before asking the next. Do not dump the
  whole list at once.
- **Prefer concrete, answerable questions** (multiple choice where natural). The operator is
  technical — keep questions terse and skip hand-holding.
- **Listen and adapt.** If an answer already covers a later question, skip it. If an answer
  opens a real gap, follow up before moving on.
- **Do not write any artifact until the confirm-back step.** The interview gathers; synthesis
  writes.
- **Never skip the human-approval gate before `plan seed`** (see the end of this guide).

---

## Step 0 — consult prior lessons

Before the first question, run `appbuilder lessons "<keywords from the idea>"` to surface relevant
prior lessons and project notes from the vault. Skim the top few. Treat any `reusable_rule` as a
**hypothesis to verify against this project**, not a fact to apply blindly — see
[.agent/rules/memory.md](.agent/rules/memory.md). Let useful prior art shape your questions; never
let it override the operator.

---

## Phase A — universal triage

Every project gets these four, in order. The fourth classifies the build-type and routes to the
matching Phase B track.

1. **What are you building, in a sentence or two?**
   → seeds `summary`.
2. **What's the core outcome — the one thing it must do well to be worth building?**
   → seeds the top entry in `goals`.
3. **Who uses it, and in what context?** (who, where, how often, what they bring)
   → seeds `constraints` and frames the features.
4. **Which best describes it — a game, a CLI tool, an app, a JSON API, an automation/script, a
   web frontend, a library, or something else?**
   → seeds `build_type` (a lowercase slug) and routes to the matching **Phase B** track below
   (use the generic fallback for "something else"). `build_type` is dir-driven, not a fixed
   enum — run `appbuilder templates` for the live list of build types `scaffold` can render.

---

## Phase B — build-type deep-dive

Run **only** the track that matches the Phase A answer. Each track is ~4–6 questions; ask them
one at a time. Every answer should land in `goals`, `features`, or `constraints` — the field
each track feeds is noted.

### Track: Game

1. **Core loop** — what does the player do, moment to moment? → `features`
2. **Win / lose / progress** — how does a session end or advance? → `features`, `goals`
3. **Player input & controls** — keyboard, mouse, touch, gamepad? → `features`, `constraints`
4. **Platform & runtime** — terminal, browser, desktop, mobile? → `constraints`
5. **Art / audio scope** — text-only, sprites, sound? What's in vs out? → `features`, `constraints`

### Track: CLI tool

1. **Commands / verbs** — what are the top-level commands and what does each do? → `features`
2. **Input → output contract** — what goes in (args, stdin, files), what comes out (stdout,
   files, exit code)? → `features`
3. **Flags & options** — the important ones that change behavior. → `features`
4. **Exit codes & errors** — how does it signal success vs each failure mode? → `features`,
   `constraints`
5. **Scripting / composition** — is it meant to be piped or run in CI? Any quiet/JSON mode? →
   `constraints`

### Track: App (web / desktop / mobile)

1. **Users & roles** — who logs in, and what can each role do? → `features`, `constraints`
2. **Key screens / flows** — the 2–4 flows that matter most. → `features`
3. **Data model** — the core entities and how they relate. → `features`
4. **Persistence & state** — where does data live; offline or always-online? → `constraints`
5. **Platform** — web, desktop, mobile; any framework constraints? → `constraints`

### Track: Library / package

1. **Public API surface** — the main functions/types a consumer calls. → `features`
2. **Consumers** — who imports this and what problem does it solve for them? → `goals`,
   `constraints`
3. **Language / runtime** — language, minimum version, dependency limits. → `constraints`
4. **Versioning & stability** — semver expectations, what's public vs internal. → `constraints`
5. **Docs & examples** — what must ship for adoption (README, examples)? → `features`

### Track: API (JSON / HTTP service)

1. **Resources & endpoints** — the main paths and methods (e.g. `GET /items`, `POST /items`). → `features`
2. **Request / response shapes** — what JSON goes in and comes back per endpoint. → `features`
3. **Auth & access** — who can call it; tokens, keys, or open? → `features`, `constraints`
4. **Status & errors** — success codes and how each failure is reported. → `features`
5. **Persistence & dependencies** — datastore, upstream services, runtime limits. → `constraints`

### Track: Automation / script

1. **Trigger** — how it runs: cron, CI, manual, on an event? → `constraints`
2. **Inputs** — the source it reads (files, API, queue, env). → `features`
3. **Transform** — the core processing step(s) between input and output. → `features`
4. **Outputs & side effects** — what it writes/sends, and idempotency. → `features`, `constraints`
5. **Success / failure signal** — exit code, log, alert on failure. → `goals`, `constraints`

### Track: Frontend (web SPA)

1. **Key screens / views** — the 2–4 views that matter most. → `features`
2. **State & interactions** — what the user changes and how the UI reacts. → `features`
3. **Data source** — which API/backend it talks to (or static). → `features`, `constraints`
4. **Framework & tooling** — React/Vite by default; any constraint otherwise. → `constraints`
5. **Testable logic** — the pure view-logic worth unit-testing (lives in `src/lib/`). → `features`

### Track: Generic fallback (anything else)

Use when the build-type doesn't match a track above (automation, service, data pipeline, …).

1. **Inputs** — what does it consume? → `features`
2. **Outputs** — what does it produce, and for whom? → `features`, `goals`
3. **Key operations** — the main steps between input and output. → `features`
4. **Dependencies & environment** — what it needs to run. → `constraints`
5. **Done-criteria** — how do you know it works? → `goals`, `constraints`

---

## Synthesis & confirm-back

Do **not** write to disk until the operator confirms. Two gates:

### Gate 1 — requirements

1. Synthesize the answers into a proposed `requirements.json`:
   - `summary` — one or two sentences (from Phase A Q1, refined by the deep-dive).
   - `goals[]` — the core outcome plus the other must-be-trues. Non-empty.
   - `features[]` — each `{ "name", "description" }`, drawn from the deep-dive answers.
     Non-empty; every `name` non-empty.
   - `constraints[]` — platform, runtime, hard limits.
   - **Discrete optional fields — populate each only when the answers cover it** (leave it out
     otherwise; all are optional and backward-compatible):
     - `out_of_scope[]` — explicit non-goals / things deliberately not built.
     - `security[]` — security or privacy requirements (auth, data handling, secrets).
     - `performance[]` — latency, throughput, or resource targets.
     - `timeline` — any deadline or milestone the operator stated.
     - `success_criteria[]` — how "done"/"working" is judged (the acceptance bar).
2. **Show it back in plain language** and ask the operator to confirm or correct. If a prior
   lesson (from Step 0) influenced any requirement, say so and confirm it still holds *for this
   project* before keeping it.
3. On confirmation: run `appbuilder plan new <slug>` (if not already done) and write
   `requirements.json`.

### Gate 1.5 — stack decision (Checkpoint 3)

Before the task plan, settle the stack explicitly so the choice is reviewable rather than buried
in `architecture.md` prose. Ask, one at a time:

1. **Given the build type and constraints, what stack do you recommend?** → `recommended_stack`
   (e.g. "Node.js + node:test", "Python + FastAPI", "Vite + React").
2. **Why that stack?** → `rationale`.
3. **What are the tradeoffs of this choice?** → `tradeoffs[]`.
4. **What alternatives did you weigh and set aside?** → `alternatives_considered[]`.
5. **Is this a call the human must make before you proceed?** → `human_decision_needed` (boolean).

Then:

1. Synthesize a proposed `stack-decision.json` (`recommended_stack`, `rationale`, `tradeoffs[]`,
   `alternatives_considered[]`, `human_decision_needed`).
2. **Show it back in plain language** and confirm or correct. If `human_decision_needed` is true,
   call that out explicitly and get the human's pick before continuing.
3. On confirmation: write `stack-decision.json` (its `recommended_stack` must be non-empty —
   `plan compile` gates on it).

### Gate 2 — task plan

1. Propose a first-draft `task-plan.json` derived from the features. Each task:
   - `id` — `TASK-NNN` (pick a range that doesn't collide with the existing queue).
   - `title`, `description`, `files_touched_estimate[]`.
   - `depends_on[]` where one task needs another first.
   - Keep tasks single-purpose and small; build **test-first** where the deliverable is code.
2. **Show the task list back** and ask the operator to confirm or adjust.
3. On confirmation: write `task-plan.json`.

### Compile & approve

1. Run `appbuilder plan compile <slug>` and fix every `fail` line until it passes.
2. **Stop and ask the human to review the plan.** Do not seed without explicit approval.
3. Only after approval: `appbuilder plan seed <slug>` to publish tasks to the coordination
   queue.

The confirm-back gates and the human-approval-before-`seed` gate are mandatory. The interview
makes the requirements step thorough; it does not remove the human from the loop.
