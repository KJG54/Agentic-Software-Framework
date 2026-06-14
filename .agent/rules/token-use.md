---
schema_version: "1.0"
---

# Token Use Rules

- Load only files relevant to the current task.
- Prefer summaries and targeted reads over broad scans.
- Use the minimal MCP profile unless the task requires more.
- Do not ingest large folders without a concrete need.
- Keep context focused on the current artifact, command, or handoff.

## Budgeting

These are heuristics, not a metering system — there is no token engine in the CLI. They
exist so a task is sized before it is claimed and a session is paced before it runs dry.

### Task size (use `files_touched_estimate`)

Every queue task carries `files_touched_estimate`. Treat its length as the task's size
class, set at plan time and visible before you claim:

- **Small — 1–2 files.** A focused change. One claim → handoff cycle; little context needed.
- **Medium — 3–5 files.** Read the touched files plus their direct callers, nothing wider.
- **Large — 6+ files.** A planning smell. Prefer splitting it in the task plan into smaller
  tasks with `depends_on` edges. If it genuinely cannot be split, read in waves: load only
  the files for the slice you are editing now, not all of them up front.

If, mid-task, you find you must open far more files than `files_touched_estimate` listed,
that is a signal the estimate (and likely the task boundary) was wrong — record it in the
handoff `warnings` so the plan can be corrected, rather than silently ballooning context.

### Per-session budget

- Aim to finish a claimed task within a single focused session. One task per session keeps
  the working set small and the handoff clean.
- Re-read a file only when it has changed since you last read it — the edit tools report
  success, so you do not need to re-read to confirm a write landed.
- If a task is dragging context past the point of usefulness, stop and write a `partial`
  handoff rather than pushing on with a bloated window. A clean handoff is cheaper than a
  degraded session.

### Weekly budget

- Prefer many small, independently mergeable tasks over a few sprawling ones. Each merges,
  releases, and resets context — the framework's per-task loop is the budget mechanism.
- When a theme needs several tasks, seed them as one plan with `depends_on` ordering so each
  runs in its own fresh session instead of one marathon.

### Handoff compression

The handoff is the context bridge between sessions — keep it dense and high-signal:

- State outcome, not narration: what changed, test result, and the single next action.
- Use `--blocker`/`--warning` for the few things the next agent must know, not a transcript.
- Set `--next` to the recommended follow-up task id so the next session starts pointed.
- Let the branch diff carry implementation detail — do not restate it in prose.
