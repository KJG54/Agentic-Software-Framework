"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { process: runPipeline } = require("../src/pipeline.js");

test("the pipeline keeps only active records", () => {
  const result = runPipeline([
    { id: 1, active: true },
    { id: 2, active: false },
    { id: 3, active: true }
  ]);
  assert.equal(result.processed, 3);
  assert.equal(result.kept, 2);
});

test("an empty batch processes cleanly", () => {
  const result = runPipeline([]);
  assert.equal(result.processed, 0);
  assert.equal(result.kept, 0);
});
