---
schema_version: "1.0"
---

# Core Rules

- Use the `appbuilder` CLI as the control plane.
- Produce structured artifacts at each phase.
- Validate artifacts before consuming them.
- Keep the core loop simple: Idea -> Requirements -> Plan -> Scaffold -> Build -> Test -> Review -> Ship.
- Do not add folders, services, memory systems, MCP servers, or automation unless they directly improve the core loop.
- Prefer deterministic file-based workflows over hidden state.
