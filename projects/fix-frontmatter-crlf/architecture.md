---
schema_version: "1.0"
project: fix-frontmatter-crlf
---

# Architecture: fix-frontmatter-crlf

## Overview

A targeted bugfix. `doctor` falsely reports `missing schema_version frontmatter` on Windows
because `parseFrontmatter` (cli/appbuilder.js) gates on a leading `---\n` delimiter while git
`autocrlf` rewrites checked-out files to `---\r\n`. The inner YAML loop already splits on
`\r?\n`; only the delimiter check is brittle.

## Components

- **`cli/appbuilder.js` — `parseFrontmatter`.** Accept a CRLF-terminated opening `---` delimiter
  as well as LF. Minimal, localized change; no schema or behavior change otherwise.
- **`.gitattributes` (new).** Normalize tracked text artifacts (`.md`, `.json`) to LF so git
  stops reintroducing CRLF on Windows checkout — defense in depth alongside the parser fix.
- **`tests/appbuilder.test.js`.** Regression test asserting `parseFrontmatter` reads
  `schema_version` from CRLF-terminated frontmatter.

## Decisions

- **Fix both the parser and the line endings.** The parser fix makes the CLI robust regardless
  of checkout settings; `.gitattributes` keeps the repo's own artifacts clean. Either alone
  leaves a gap.
- **Test-first.** The regression test is written before the parser change and must fail first.
