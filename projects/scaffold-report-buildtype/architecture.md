---
schema_version: "1.0"
project: scaffold-report-buildtype
---

# Architecture: scaffold-report-buildtype

## Overview

A one-task cleanup that finishes the "dir-driven templates" promise from the
`scaffold-templates` batch. Today `scaffold` picks a template purely from disk
(`templates/<build_type>/`), and `requirements.schema.json` already accepts any lowercase
`build_type` slug — but `scaffold-report.schema.json` still pins `build_type` to a fixed
five-value enum. The result: a brand-new template folder renders fine, then fails
`scaffold-report.json` validation. This task removes that last hardcoded list so adding a
template is genuinely a one-folder change.

## Components

- **contracts/schemas/v1/scaffold-report.schema.json** — `build_type` changes from
  `{ "enum": ["game","cli","app","library","other"] }` to
  `{ "type": "string", "pattern": "^[a-z0-9][a-z0-9-]*$" }`, the exact shape
  `requirements.schema.json` uses. The two now validate `build_type` identically.
- **cli/lib/scaffold.js** — the missing-`build_type` error message drops the hardcoded
  `(game|cli|app|library|other)` and instead points the operator at the `templates/` directory
  (run `appbuilder templates`). No logic change; the lookup was already dir-driven.
- **tests/appbuilder.test.js** — a new test scaffolds a project whose `build_type` is a slug
  absent from the old enum (a throwaway template folder created in the fixture) and asserts both
  that `scaffold` succeeds and that the emitted `scaffold-report.json` passes
  `validateScaffoldReport`. Written first (red), then made green by the schema change.

## Decisions

- **Mirror the requirements pattern rather than invent a new one.** Using the identical
  `^[a-z0-9][a-z0-9-]*$` keeps a single source of truth for what a `build_type` slug looks like
  and guarantees the two schemas can't disagree about a value.
- **Pattern, not free string.** Keeping the format guard (vs. `type: string` alone) preserves the
  invariant that `build_type` maps to a directory name, so junk values still fail fast.
- **No changes to build-manifest/build-report.** Those were authored enum-free in the build
  phase; only the older scaffold-report schema carried the legacy enum.
- **Single task, no dependencies.** The change is one schema line plus an error string and its
  regression test — small enough to claim, prove, and merge in one PR.
