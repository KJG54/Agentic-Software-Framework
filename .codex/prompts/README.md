# Codex prompts

These files are the version-controlled source of truth for App Builder's Codex slash commands
(`/status`, `/doctor`, `/plan`, `/work`). They mirror the Claude Code commands in
`.claude/commands/`.

**To use them as slash commands in Codex**, copy them into Codex's prompt directory, which
Codex discovers globally (per-project `.codex/prompts/` is not reliably auto-discovered across
Codex versions):

```bash
mkdir -p ~/.codex/prompts
cp status.md doctor.md plan.md work.md ~/.codex/prompts/
```

Either way, the underlying `appbuilder` CLI verbs work directly without the shortcuts — that is
the universal interface documented in [../../AGENTS.md](../../AGENTS.md).
