// Zero-dependency HTTP server on port 80. Identifies the sample so a
// deploy smoke test can assert on the response body, and reports whether
// the pre-built `cache` sibling is reachable (proves intra-compose
// networking + depends_on healthcheck ordering).
const http = require("http");
const net = require("net");

const PORT = Number(process.env.PORT) || 80;

function checkCache() {
  return new Promise((resolve) => {
    const url = process.env.CACHE_URL || "redis://cache:6379";
    const m = /redis:\/\/([^:]+):(\d+)/.exec(url);
    if (!m) return resolve(false);
    const socket = net.createConnection({ host: m[1], port: Number(m[2]) }, () => {
      socket.end();
      resolve(true);
    });
    socket.setTimeout(1000, () => { socket.destroy(); resolve(false); });
    socket.on("error", () => resolve(false));
  });
}

const server = http.createServer(async (req, res) => {
  if (req.url === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    return res.end("ok");
  }
  const cacheReachable = await checkCache();
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      sample: "compose-build-context",
      built_from: "app/web (nested build context)",
      cache_reachable: cacheReachable,
    }) + "\n",
  );
});

server.listen(PORT, () => {
  console.log(`compose-build-context web listening on :${PORT}`);
});
