"use strict";

// {{slug}} — {{summary}}
// The route table is pure data + a pure `dispatch` function: given a method and path it returns
// a `{ status, body }` pair with no I/O. Keeping routing pure is what lets the whole API be
// unit-tested with `node --test` and no running server (see test/router.test.js).

const routes = {
  "GET /health": () => ({ status: 200, body: { status: "ok", service: "{{slug}}" } }),
  "GET /items": () => ({ status: 200, body: { items: [] } })
};

/**
 * Resolve a request to a JSON response without any I/O.
 * @param {string} method  HTTP method, e.g. "GET"
 * @param {string} pathName URL path, e.g. "/health"
 * @returns {{ status: number, body: object }}
 */
function dispatch(method, pathName) {
  const handler = routes[`${method} ${pathName}`];
  if (!handler) {
    return { status: 404, body: { error: "not found", path: pathName } };
  }
  return handler();
}

module.exports = { routes, dispatch };
