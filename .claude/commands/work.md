---
description: Claim a task and run the per-task coordination loop
argument-hint: <TASK-ID>
---

Drive task `$ARGUMENTS` through the per-task loop (ask for a TASK-ID if none was given):

1. `node cli/appbuilder.js claim $ARGUMENTS` — claim the task and create its `agent/` branch.
2. Implement the change **test-first** (write a failing test, then make it pass).
3. `node cli/appbuilder.js handoff --task $ARGUMENTS --status complete --tests-run --tests-passed`
   — only after tests actually pass; report real results.
4. `node cli/appbuilder.js ready $ARGUMENTS` — the before-merge gate; fix any failures.
5. Open a PR, get it reviewed, and merge to `main` (direct push to `main` is blocked).
6. `node cli/appbuilder.js release $ARGUMENTS --reason "merged via PR #N"`.

Respect the hard rules in AGENTS.md: claim before editing, never work on `main`, advise before
executing if the task seems impractical.
