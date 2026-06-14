#!/usr/bin/env node
"use strict";

// {{slug}} — thin stdin loop that wires the pure reducer in game.js to the terminal.
// All the game rules live in game.js; this file only handles I/O.

const readline = require("node:readline");
const { initialState, step } = require("./game.js");

function main() {
  const target = 1 + Math.floor(Math.random() * 100);
  let state = initialState(target);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log(`{{slug}}: ${state.message} (1-100)`);
  rl.setPrompt("> ");
  rl.prompt();

  rl.on("line", (line) => {
    const guess = Number.parseInt(line.trim(), 10);
    if (Number.isNaN(guess)) {
      console.log("Enter a number.");
      rl.prompt();
      return;
    }
    state = step(state, guess);
    console.log(state.message);
    if (state.status === "won") {
      rl.close();
      return;
    }
    rl.prompt();
  });
}

if (require.main === module) {
  main();
}

module.exports = { main };
