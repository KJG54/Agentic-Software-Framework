# {{slug}}

{{summary}}

A zero-dependency Node.js HTTP service built on `node:http`.

## Run

```bash
npm start          # serves on PORT (default 3000)
PORT=8080 npm start
```

Then:

```bash
curl localhost:3000/health   # {"status":"ok","service":"{{slug}}"}
```

## Develop

```bash
npm test   # runs node --test (binds an ephemeral port)
```

`src/server.js` exports `handler` (test it without a port) and `start(port)` (pass `0` for an
ephemeral port). Replace the routing in `handler` with your real endpoints.
