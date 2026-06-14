"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { initialState, step } = require("../src/game.js");

test("a guess below the target hints higher", () => {
  const next = step(initialState(42), 10);
  assert.equal(next.status, "playing");
  assert.match(next.message, /higher/);
  assert.equal(next.guesses, 1);
});

test("a guess above the target hints lower", () => {
  const next = step(initialState(42), 90);
  assert.match(next.message, /lower/);
});

test("a correct guess wins and counts the guesses", () => {
  let state = initialState(42);
  state = step(state, 10);
  state = step(state, 42);
  assert.equal(state.status, "won");
  assert.equal(state.guesses, 2);
});

test("step is pure and a finished game is terminal", () => {
  const start = initialState(42);
  step(start, 10);
  assert.equal(start.guesses, 0, "input state must not be mutated");
  const won = step(start, 42);
  assert.equal(step(won, 1), won, "stepping a won game returns it unchanged");
});
