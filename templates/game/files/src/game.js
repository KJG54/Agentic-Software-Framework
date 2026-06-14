"use strict";

// {{slug}} — {{summary}}
// Pure game logic for a number-guessing game. Keeping the rules in a pure
// reducer (no I/O) is what makes them testable without a terminal. The stdin
// loop in index.js is the only part that touches the outside world.

/**
 * Build the initial game state.
 * @param {number} target the secret number the player must guess
 * @returns {{ target: number, guesses: number, status: "playing", message: string }}
 */
function initialState(target) {
  return { target, guesses: 0, status: "playing", message: "Guess the number!" };
}

/**
 * Apply one guess. Pure: returns a new state, never mutates the input.
 * @param {object} state current state (from initialState or a previous step)
 * @param {number} guess the player's guess
 * @returns {object} the next state
 */
function step(state, guess) {
  if (state.status === "won") return state;
  const guesses = state.guesses + 1;
  if (guess === state.target) {
    return { ...state, guesses, status: "won", message: `Correct in ${guesses} guess(es)!` };
  }
  const hint = guess < state.target ? "higher" : "lower";
  return { ...state, guesses, message: `Try ${hint}.` };
}

module.exports = { initialState, step };
