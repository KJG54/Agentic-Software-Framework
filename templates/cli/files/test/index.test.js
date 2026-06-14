"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { main } = require("../src/index.js");

test("main exits cleanly", () => {
  assert.equal(main([]), 0);
});
