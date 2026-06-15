---
schema_version: "1.0"
id: ADR-0002
title: "Ship phase: full-chain generator writing a markdown checklist"
status: accepted
context: "Scaffold/Build/Test/Review were implemented; ship was the last loop step (a bare placeholder). project-workflow.md names ship-checklist.md as required and scanForArtifactVersions already expects it to carry schema_version frontmatter, so the artifact name and markdown-with-flat-frontmatter format were effectively pre-decided. The CLI has no LLM and ship records readiness, it does not deploy."
decision: "ship is a single generator verb (like build/test): it verifies the FULL upstream chain (scaffold/build/test reports parse and review is approved), and only on success deterministically writes build/<slug>/ship-checklist.md (markdown frontmatter + phase roll-up + static manual go-live steps), validating the generated frontmatter before writing and refusing to overwrite without --force."
consequences: "The invariant report-on-disk==gate-passed holds; ship fails loudly rather than emit an incomplete manifest; human go-live ticks survive re-runs via --force; the loop becomes placeholder-free end to end."
date: 2026-06-14
options_considered:
  - "ship init + ship (rejected: the artifact is CLI-generated, nothing to seed)"
  - "Gate only on the immediately-prior artifact (rejected: the roll-up needs every report and ship is the terminal gate)"
  - "Emit JSON like build/test (rejected: the repo already reserves ship-checklist.md as frontmatter markdown)"
---

# ADR-0002: Ship phase: full-chain generator writing a markdown checklist

**Status:** accepted — **Date:** 2026-06-14

## Context

Scaffold/Build/Test/Review were implemented; ship was the last loop step (a bare placeholder). project-workflow.md names ship-checklist.md as required and scanForArtifactVersions already expects it to carry schema_version frontmatter, so the artifact name and markdown-with-flat-frontmatter format were effectively pre-decided. The CLI has no LLM and ship records readiness, it does not deploy.

## Decision

ship is a single generator verb (like build/test): it verifies the FULL upstream chain (scaffold/build/test reports parse and review is approved), and only on success deterministically writes build/<slug>/ship-checklist.md (markdown frontmatter + phase roll-up + static manual go-live steps), validating the generated frontmatter before writing and refusing to overwrite without --force.

## Options considered

- ship init + ship (rejected: the artifact is CLI-generated, nothing to seed)
- Gate only on the immediately-prior artifact (rejected: the roll-up needs every report and ship is the terminal gate)
- Emit JSON like build/test (rejected: the repo already reserves ship-checklist.md as frontmatter markdown)

## Consequences

The invariant report-on-disk==gate-passed holds; ship fails loudly rather than emit an incomplete manifest; human go-live ticks survive re-runs via --force; the loop becomes placeholder-free end to end.
