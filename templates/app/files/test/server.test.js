"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { start } = require("../src/server.js");

// Issue a single GET against the running server and resolve the status + body.
function get(port, urlPath) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method: "GET" }, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("the health endpoint responds ok on an ephemeral port", async () => {
  const server = start(0);
  await new Promise((resolve) => server.on("listening", resolve));
  const { port } = server.address();
  try {
    const res = await get(port, "/health");
    assert.equal(res.status, 200);
    assert.match(res.body, /ok/);
  } finally {
    server.close();
  }
});
