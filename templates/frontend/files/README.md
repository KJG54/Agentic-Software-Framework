# {{slug}}

{{summary}}

A Vite + React single-page app. The view logic worth testing lives in pure modules under
`src/lib/` so it can be checked with `node --test` (no build step); the React components stay
thin wrappers around them.

## Develop

```bash
npm install      # pull in vite + react (the only step that needs the network)
npm run dev      # start the Vite dev server
npm run build    # production build into dist/
```

## Test

```bash
node --test      # runs the pure-logic tests under test/ (no npm install needed)
```

> Note: the framework's `appbuilder test` gate runs bare `node --test`, which covers the pure
> modules in `src/lib/`. To unit-test React components themselves, add a runner like Vitest +
> Testing Library (`npm i -D vitest @testing-library/react jsdom`) and run it with `npm test`.
