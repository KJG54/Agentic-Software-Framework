"use strict";

// {{slug}} — {{summary}}
// A zero-dependency HTTP service on node:http. `handler` is exported so it can be
// tested without binding a port; `start` is exported so the same handler can be
// served on a real (or ephemeral) port.

const http = require("node:http");

const PORT = Number(process.env.PORT) || 3000;

/**
 * Request handler. Replace the routing below with your real endpoints.
 * @param {http.IncomingMessage} req
 * @param {http.ServerResponse} res
 */
function handler(req, res) {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "{{slug}}" }));
    return;
  }
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("hello from {{slug}}");
}

/**
 * Start the service. Pass port 0 to bind an ephemeral port (useful in tests).
 * @param {number} [port]
 * @returns {http.Server}
 */
function start(port = PORT) {
  const server = http.createServer(handler);
  server.listen(port);
  return server;
}

if (require.main === module) {
  const server = start();
  server.on("listening", () => {
    const { port } = server.address();
    console.log(`{{slug}} listening on http://localhost:${port}`);
  });
}

module.exports = { handler, start };
