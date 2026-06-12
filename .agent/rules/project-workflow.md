---
schema_version: "1.0"
---

# Project Workflow Rules

- Follow the loop: Idea -> Requirements -> Plan -> Scaffold -> Build -> Test -> Review -> Ship.
- Required artifacts include `requirements.json`, `architecture.md`, `task-plan.json`, `scaffold-report.json`, `test-report.json`, `review-report.md`, `ship-checklist.md`, and `handoff.md`.
- JSON artifacts must declare `schema_version`.
- Markdown artifacts must include YAML frontmatter with `schema_version`.
- Do not advance a phase until required artifacts exist and validate.
- Review gates must run before build, merge, and ship.
