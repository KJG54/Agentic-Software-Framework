---
schema_version: "1.0"
---

# Coordination Rules

- Claim work before editing.
- Do not work directly on `main`.
- Use task branches named `agent/TASK-001-short-description`.
- Use `appbuilder claim`, `appbuilder release`, `appbuilder handoff`, and `appbuilder ready`.
- Never manually edit live files on `coordination/main`.
- Never commit queue tasks, claims, or handoffs to `main`.
- Respect claim expiry.
- Run `appbuilder ready <task-id>` before merge review.
