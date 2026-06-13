---
description: Guide an idea through the App Builder plan flow
argument-hint: <slug>
---

Drive the planning flow for project `$ARGUMENTS` (ask for a slug if none was given):

1. `node cli/appbuilder.js plan new $ARGUMENTS` — scaffold `projects/$ARGUMENTS/`
   (`requirements.json`, `architecture.md`, `task-plan.json`).
2. Help fill in `requirements.json` (real `summary`, `goals`, `features`) and author
   `task-plan.json` (`TASK-NNN` ids, `title`, `files_touched_estimate`, optional `depends_on`).
3. `node cli/appbuilder.js plan compile $ARGUMENTS` — fix every `fail` line and re-run until it
   passes.
4. Stop and ask the human to review the plan. Only after approval:
   `node cli/appbuilder.js plan seed $ARGUMENTS` to publish tasks to the coordination queue.

Do not seed without explicit human approval of the plan.
