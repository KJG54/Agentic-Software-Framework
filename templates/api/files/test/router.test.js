"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { dispatch } = require("../src/router.js");

test("GET /health returns ok", () => {
  const res = dispatch("GET", "/health");
  assert.equal(res.status, 200);
  assert.equal(res.body.status, "ok");
});

test("an unknown route returns 404", () => {
  const res = dispatch("GET", "/nope");
  assert.equal(res.status, 404);
  assert.equal(res.body.error, "not found");
});
