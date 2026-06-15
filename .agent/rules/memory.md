---
schema_version: "1.0"
---

# Memory Rules

The vault is **memory-assisted, not memory-dependent**: it helps you start from prior art, but the
current project's files are always the source of truth.

- **Retrieve before planning.** At the start of the plan interview, run `appbuilder lessons
  "<keywords>"` to surface relevant prior lessons and project notes before drafting requirements.
- **Verify, don't trust.** A retrieved `reusable_rule` is a *hypothesis*, not a fact. Check it
  against this project's requirements, architecture, and code before letting it shape a decision.
  If it does not hold here, ignore it and say so.
- **Capture after shipping.** After a project ships, record what you learned with
  `appbuilder lesson add` — one reusable rule per lesson, with the context and what worked/failed.
- **Working branch only.** Lessons and ADRs live in the Obsidian vault on the working branch and
  ride the normal task-branch PR to `main`. Never write them to the coordination branch.
