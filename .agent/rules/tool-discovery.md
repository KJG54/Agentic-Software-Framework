---
schema_version: "1.0"
---

# Tool-Discovery Rules

Before building or adding any tool, command, template, or dependency, check what already exists.

- Check `tools/internal-tool-registry.json` first — it catalogs the reusable internal tools
  (the appbuilder CLI and its verbs, the schema-validator, the templates, the vault).
- Then check `templates/` (run `appbuilder templates`) and the `vault/` memory (decisions,
  lessons, known-problems) for prior art.
- Prefer an existing command, template, schema, or pattern over a new one. If one already does
  the job, use it and say so instead of building a parallel path.
- Only when nothing fits, add the new tool — and record it in
  `tools/internal-tool-registry.json` with its `purpose`, `usage`, `maintenance`, the `reason`
  it was needed, and the `alternatives_considered`.
- Do not add folders, services, or commands that do not directly improve the core loop.
