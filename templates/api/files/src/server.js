"use strict";

// {{slug}} — {{summary}}
// A thin node:http shell over the pure `dispatch` in router.js. The server only does I/O:
// read the request line, hand it to dispatch, and write the JSON response. Add real endpoints
// by extending the route table in router.js (and its test) — not by branching in here.

const http = require("node:http");
const { dispatch } = require("./router.js");

const PORT = Number(process.env.PORT) || 3000;

function handler(req, res) {
  const pathName = (req.url || "/").split("?")[0];
  const { status, body } = dispatch(req.method, pathName);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

/**
 * Start the API. Pass port 0 to bind an ephemeral port (useful in tests).
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
    console.log(`{{slug}} API listening on http://localhost:${port}`);
  });
}

module.exports = { handler, start };
