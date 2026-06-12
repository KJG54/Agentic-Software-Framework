# Agentic Software Framework

App Builder V2 is a CLI-first, artifact-driven workbench for moving an idea through a repeatable application-building loop:

```text
Idea -> Requirements -> Plan -> Scaffold -> Build -> Test -> Review -> Ship
```

The first implementation batch focuses on the multi-agent coordination foundation: versioned contracts, a root config, focused agent rules, an internal coordination worktree, claims, handoffs, readiness checks, and generated status.

## Quickstart

```bash
npm test
node cli/appbuilder.js doctor
```

In a Git repository with at least one commit:

```bash
node cli/appbuilder.js init-coordination
node cli/appbuilder.js status
```

Human-approved queue tasks live on the dedicated `coordination/main` branch. Normal agents should use the CLI instead of manually editing files under `coordination/`.

## Core Commands

```bash
appbuilder init-coordination
appbuilder doctor
appbuilder status
appbuilder claim TASK-001
appbuilder release TASK-001
appbuilder handoff --task TASK-001 --status complete
appbuilder ready TASK-001
appbuilder events
```

The workflow commands `start`, `plan`, `scaffold`, `build`, `test`, `review`, and `ship` are present as placeholders for later phases.
