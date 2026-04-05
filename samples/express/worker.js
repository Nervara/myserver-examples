// worker.js — background process that runs alongside the express web server.
// Deploy this as a linked process with start command: node worker.js

const os = require('os');

const WORKER_ID = process.env.WORKER_ID || `worker-${process.pid}`;
const INTERVAL = parseInt(process.env.WORKER_INTERVAL || '5000', 10);

let jobCount = 0;

function processJob() {
  jobCount++;
  const mem = process.memoryUsage();
  console.log(JSON.stringify({
    worker: WORKER_ID,
    job: jobCount,
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    memory_mb: Math.round(mem.rss / 1024 / 1024),
    hostname: os.hostname(),
  }));
}

console.log(`[${WORKER_ID}] Starting background worker (interval: ${INTERVAL}ms)`);
setInterval(processJob, INTERVAL);

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log(`[${WORKER_ID}] Received SIGTERM, shutting down after ${jobCount} jobs`);
  process.exit(0);
});
