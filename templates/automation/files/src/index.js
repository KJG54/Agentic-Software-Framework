#!/usr/bin/env node
"use strict";

// {{slug}} — {{summary}}
// The runner: the only part with side effects. It gathers input (here, a small sample — swap in
// a real source: a file, an API, a queue), runs the pure pipeline, and reports. Designed to be
// invoked headless on a schedule (cron) or in CI; exit code signals success/failure.

const { process: runPipeline } = require("./pipeline.js");

function main() {
  // Replace this sample with your real input source.
  const sample = [
    { id: 1, active: true },
    { id: 2, active: false },
    { id: 3, active: true }
  ];
  const result = runPipeline(sample);
  console.log(`{{slug}}: processed ${result.processed}, kept ${result.kept}`);
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main };
