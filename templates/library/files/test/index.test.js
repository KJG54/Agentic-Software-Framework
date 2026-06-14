"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { greet } = require("../src/index.js");

test("greet returns a greeting that includes the name", () => {
  assert.match(greet("Ada"), /Ada/);
});

test("greet defaults to world", () => {
  assert.match(greet(), /world/);
});
