# {{slug}}

{{summary}}

A zero-dependency terminal game. A number-guessing game ships as a starting point.

## Play

```bash
npm start   # or: node src/index.js
```

Guess a number between 1 and 100; the game hints higher/lower until you win.

## Develop

```bash
npm test   # runs node --test against the pure reducer
```

The rules live in `src/game.js` as a pure reducer (`initialState`, `step`) — fully testable
without a terminal. `src/index.js` is just the stdin loop. Replace the reducer with your own
game's rules and keep the I/O in the loop.
