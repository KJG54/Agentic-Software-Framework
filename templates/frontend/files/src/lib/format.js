// {{slug}} — {{summary}}
// Pure UI-logic helpers live here, framework-free, so they can be unit-tested with `node --test`
// (no jsdom, no build step, no npm install). Keep view logic that is worth testing in modules
// like this one; the React components in src/ stay thin wrappers around them.

/**
 * Build the greeting the app shows. Pure: a string in, a string out.
 * @param {string} [name]
 * @returns {string}
 */
export function formatGreeting(name) {
  const who = (name || "").trim() || "world";
  return `Hello, ${who}!`;
}
