import test from "node:test";
import assert from "node:assert/strict";
import { formatGreeting } from "../src/lib/format.js";

test("formatGreeting uses the given name", () => {
  assert.equal(formatGreeting("Ada"), "Hello, Ada!");
});

test("formatGreeting falls back to world", () => {
  assert.equal(formatGreeting(""), "Hello, world!");
  assert.equal(formatGreeting(), "Hello, world!");
});
