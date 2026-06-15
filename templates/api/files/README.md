# {{slug}}

{{summary}}

A zero-dependency JSON REST API: routing is a pure function (`src/router.js`) served over
`node:http` (`src/server.js`).

## Run

```bash
node src/server.js        # serves on PORT (default 3000)
curl localhost:3000/health
```

## Develop

```bash
node --test               # runs the pure router tests
```

Add endpoints by extending the `routes` table in `src/router.js` and its test — keep the routing
pure so it stays testable without a running server.
