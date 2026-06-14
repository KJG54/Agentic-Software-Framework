"use strict";

// {{slug}} — {{summary}}
// Replace this sample export with your library's real public API.

/**
 * Greet a name. Sample export so the scaffolded library has a working,
 * tested entry point from the start.
 * @param {string} name
 * @returns {string}
 */
function greet(name = "world") {
  return `Hello, ${name}, from {{slug}}!`;
}

module.exports = { greet };
