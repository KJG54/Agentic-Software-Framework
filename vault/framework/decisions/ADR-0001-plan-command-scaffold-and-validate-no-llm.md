---
schema_version: "1.0"
id: ADR-0001
title: "Plan command: scaffold-and-validate, no LLM"
status: accepted
context: "Coordination core was complete but the product loop (plan->...->ship) was placeholder verbs; plan is the head of that loop, turning an idea into the artifacts later commands consume and feeding the human-approved queue."
decision: "plan is three deterministic subcommands (new/compile/seed) with a human review gate between compile and seed: the zero-dependency CLI scaffolds artifact stubs and validates them while the agent supplies the thinking; JSON Schema validates structure, CLI code enforces semantic readiness and task-plan integrity."
consequences: "plan stays deterministic and testable; non-empty/uniqueness/reference checks live in CLI code (the validator has no $ref/minItems/uniqueItems); global TASK-NNN ids can collide across projects (accepted for V1, made auditable by a loud skip-seed line)."
date: 2026-06-13
options_considered:
  - "Embed an LLM/idea-parser in the CLI (rejected: charter forbids LLM in CLI)"
  - "One monolithic plan command (rejected: the compile/seed split is what creates the human gate)"
---

# ADR-0001: Plan command: scaffold-and-validate, no LLM

**Status:** accepted — **Date:** 2026-06-13

## Context

Coordination core was complete but the product loop (plan->...->ship) was placeholder verbs; plan is the head of that loop, turning an idea into the artifacts later commands consume and feeding the human-approved queue.

## Decision

plan is three deterministic subcommands (new/compile/seed) with a human review gate between compile and seed: the zero-dependency CLI scaffolds artifact stubs and validates them while the agent supplies the thinking; JSON Schema validates structure, CLI code enforces semantic readiness and task-plan integrity.

## Options considered

- Embed an LLM/idea-parser in the CLI (rejected: charter forbids LLM in CLI)
- One monolithic plan command (rejected: the compile/seed split is what creates the human gate)

## Consequences

plan stays deterministic and testable; non-empty/uniqueness/reference checks live in CLI code (the validator has no $ref/minItems/uniqueItems); global TASK-NNN ids can collide across projects (accepted for V1, made auditable by a loud skip-seed line).
