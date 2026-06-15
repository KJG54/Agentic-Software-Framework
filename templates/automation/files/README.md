# {{slug}}

{{summary}}

A zero-dependency automation script: a pure processing pipeline (`src/pipeline.js`) with a thin
runner (`src/index.js`) made to run headless on a schedule (cron) or in CI.

## Run

```bash
node src/index.js
```

## Develop

```bash
node --test
```

Put the real work in `src/pipeline.js` (keep it pure — input in, result out) and wire the input
source in `src/index.js`. The exit code signals success/failure to your scheduler.
