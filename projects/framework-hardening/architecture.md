---
schema_version: "1.0"
project: framework-hardening
---

# Architecture: framework-hardening

## Overview

_Describe the high-level architecture here._

## Components

_List the major components and their responsibilities._

## Decisions

### AJV / fuller JSON Schema — DEFERRED (decided 2026-06-14)

**Decision:** Keep the custom validator (`core/validation/schema-validator.js`). Do **not** adopt
AJV or any external schema library now.

**Evidence:** Audited every keyword used across the 9 `contracts/schemas/v1/*.json` schemas
against what the custom validator implements. The schemas use only `type`, `required`,
`properties`, `items`, `enum`, `const`, `minLength`, `pattern`, `minimum`,
`additionalProperties` (true/false), and `format: date-time` — **all supported**. No schema
uses `$ref`, `oneOf/anyOf/allOf`, `if/then/else`, `minItems`, `maxLength`, `uniqueItems`, or
any other unsupported keyword. So there is **zero validation gap today**; AJV would catch
nothing the custom validator misses, while spending the framework's deliberate
zero-dependency posture.

**Residual risk:** a future schema author adds an unsupported keyword (e.g. `minItems`) and the
custom validator **silently ignores** it — a constraint claimed but not enforced. Mitigation is
a small guard test (assert no `contracts/schemas/v1` schema uses an unsupported keyword), which
keeps zero-dep and turns that silent gap into a loud failure. TASK-404 isolated the validator
behind one seam (`cli/lib/validate.js`), so a later swap stays cheap.

**Trigger to revisit:** a contract genuinely needs a JSON Schema feature the custom validator
does not support ($ref, oneOf, conditionals). That is the day AJV is worth reconsidering.
