#!/usr/bin/env node
"use strict";

function main(argv = process.argv.slice(2)) {
  console.log("{{slug}}: hello from your scaffolded CLI");
  return 0;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main };
