import pg from "pg";
import mysql from "mysql2/promise";
import Redis from "ioredis";

const PORT = process.env.PORT || 3000;

// ── Connection configs from env vars ──────────────────────────────
// Each database uses the discovery DNS name (e.g. disco-postgres.production.internal)
// resolved via CoreDNS on the myserver mesh network.

interface DBResult {
  name: string;
  type: string;
  host: string;
  status: "connected" | "error";
  latency_ms: number;
  pool_size?: number;
  details?: string;
  error?: string;
}

// ── PostgreSQL pool ──────────────────────────────────────────────
const pgPool = process.env.POSTGRES_URL
  ? new pg.Pool({
      connectionString: process.env.POSTGRES_URL,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    })
  : null;

async function testPostgres(): Promise<DBResult> {
  if (!pgPool) return { name: "PostgreSQL", type: "postgresql", host: "-", status: "error", latency_ms: 0, error: "POSTGRES_URL not set" };
  const start = performance.now();
  try {
    const client = await pgPool.connect();
    const res = await client.query("SELECT version() as version, current_database() as db, current_user as user, pg_postmaster_start_time() as uptime");
    client.release();
    return {
      name: "PostgreSQL",
      type: "postgresql",
      host: process.env.POSTGRES_URL?.replace(/\/\/.*@/, "//***@") || "",
      status: "connected",
      latency_ms: Math.round(performance.now() - start),
      pool_size: pgPool.totalCount,
      details: `${res.rows[0].version.split(",")[0]} | db=${res.rows[0].db} user=${res.rows[0].user}`,
    };
  } catch (e: any) {
    return { name: "PostgreSQL", type: "postgresql", host: process.env.POSTGRES_URL?.replace(/\/\/.*@/, "//***@") || "", status: "error", latency_ms: Math.round(performance.now() - start), error: e.message };
  }
}

// ── MySQL pool ───────────────────────────────────────────────────
const mysqlPool = process.env.MYSQL_URL
  ? mysql.createPool({
      uri: process.env.MYSQL_URL,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 5000,
    })
  : null;

async function testMySQL(): Promise<DBResult> {
  if (!mysqlPool) return { name: "MySQL", type: "mysql", host: "-", status: "error", latency_ms: 0, error: "MYSQL_URL not set" };
  const start = performance.now();
  try {
    const [rows] = await mysqlPool.query("SELECT version() as version, database() as db, current_user() as user") as any;
    return {
      name: "MySQL",
      type: "mysql",
      host: process.env.MYSQL_URL?.replace(/\/\/.*@/, "//***@") || "",
      status: "connected",
      latency_ms: Math.round(performance.now() - start),
      pool_size: 10,
      details: `MySQL ${rows[0].version} | db=${rows[0].db} user=${rows[0].user}`,
    };
  } catch (e: any) {
    return { name: "MySQL", type: "mysql", host: process.env.MYSQL_URL?.replace(/\/\/.*@/, "//***@") || "", status: "error", latency_ms: Math.round(performance.now() - start), error: e.message };
  }
}

// ── MariaDB pool ─────────────────────────────────────────────────
const mariaPool = process.env.MARIADB_URL
  ? mysql.createPool({
      uri: process.env.MARIADB_URL,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      connectTimeout: 5000,
    })
  : null;

async function testMariaDB(): Promise<DBResult> {
  if (!mariaPool) return { name: "MariaDB", type: "mariadb", host: "-", status: "error", latency_ms: 0, error: "MARIADB_URL not set" };
  const start = performance.now();
  try {
    const [rows] = await mariaPool.query("SELECT version() as version, database() as db, current_user() as user") as any;
    return {
      name: "MariaDB",
      type: "mariadb",
      host: process.env.MARIADB_URL?.replace(/\/\/.*@/, "//***@") || "",
      status: "connected",
      latency_ms: Math.round(performance.now() - start),
      pool_size: 10,
      details: `MariaDB ${rows[0].version} | db=${rows[0].db} user=${rows[0].user}`,
    };
  } catch (e: any) {
    return { name: "MariaDB", type: "mariadb", host: process.env.MARIADB_URL?.replace(/\/\/.*@/, "//***@") || "", status: "error", latency_ms: Math.round(performance.now() - start), error: e.message };
  }
}

// ── Redis pool ───────────────────────────────────────────────────
const redisClient = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      lazyConnect: true,
    })
  : null;

async function testRedis(): Promise<DBResult> {
  if (!redisClient) return { name: "Redis", type: "redis", host: "-", status: "error", latency_ms: 0, error: "REDIS_URL not set" };
  const start = performance.now();
  try {
    if (redisClient.status === "wait") await redisClient.connect();
    const info = await redisClient.info("server");
    const version = info.match(/redis_version:(.+)/)?.[1]?.trim() || "unknown";
    const mode = info.match(/redis_mode:(.+)/)?.[1]?.trim() || "unknown";
    const uptime = info.match(/uptime_in_seconds:(.+)/)?.[1]?.trim() || "0";

    // Quick SET/GET roundtrip
    const key = `disco:ping:${Date.now()}`;
    await redisClient.set(key, "pong", "EX", 10);
    await redisClient.get(key);
    await redisClient.del(key);

    return {
      name: "Redis",
      type: "redis",
      host: process.env.REDIS_URL?.replace(/:.*@/, ":***@") || "",
      status: "connected",
      latency_ms: Math.round(performance.now() - start),
      details: `Redis ${version} | mode=${mode} uptime=${uptime}s`,
    };
  } catch (e: any) {
    return { name: "Redis", type: "redis", host: process.env.REDIS_URL?.replace(/:.*@/, ":***@") || "", status: "error", latency_ms: Math.round(performance.now() - start), error: e.message };
  }
}

// ── Latency benchmark ────────────────────────────────────────────
interface BenchResult {
  name: string;
  iterations: number;
  avg_ms: number;
  min_ms: number;
  max_ms: number;
  p99_ms: number;
}

async function benchmarkPostgres(n: number): Promise<BenchResult | null> {
  if (!pgPool) return null;
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = performance.now();
    const c = await pgPool.connect();
    await c.query("SELECT 1");
    c.release();
    times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);
  return { name: "PostgreSQL", iterations: n, avg_ms: round(avg(times)), min_ms: round(times[0]), max_ms: round(times[n - 1]), p99_ms: round(times[Math.floor(n * 0.99)]) };
}

async function benchmarkMySQL(n: number): Promise<BenchResult | null> {
  if (!mysqlPool) return null;
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = performance.now();
    await mysqlPool.query("SELECT 1");
    times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);
  return { name: "MySQL", iterations: n, avg_ms: round(avg(times)), min_ms: round(times[0]), max_ms: round(times[n - 1]), p99_ms: round(times[Math.floor(n * 0.99)]) };
}

async function benchmarkMariaDB(n: number): Promise<BenchResult | null> {
  if (!mariaPool) return null;
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = performance.now();
    await mariaPool.query("SELECT 1");
    times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);
  return { name: "MariaDB", iterations: n, avg_ms: round(avg(times)), min_ms: round(times[0]), max_ms: round(times[n - 1]), p99_ms: round(times[Math.floor(n * 0.99)]) };
}

async function benchmarkRedis(n: number): Promise<BenchResult | null> {
  if (!redisClient || redisClient.status === "wait") return null;
  const times: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = performance.now();
    await redisClient.ping();
    times.push(performance.now() - s);
  }
  times.sort((a, b) => a - b);
  return { name: "Redis", iterations: n, avg_ms: round(avg(times)), min_ms: round(times[0]), max_ms: round(times[n - 1]), p99_ms: round(times[Math.floor(n * 0.99)]) };
}

function avg(arr: number[]) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function round(n: number) { return Math.round(n * 10) / 10; }

// ── HTTP server ──────────────────────────────────────────────────
const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("OK");
    }

    // API: connectivity test
    if (url.pathname === "/api/test") {
      const results = await Promise.all([testPostgres(), testMySQL(), testMariaDB(), testRedis()]);
      return Response.json({
        timestamp: new Date().toISOString(),
        runtime: `Bun ${Bun.version}`,
        server: { platform: process.platform, arch: process.arch, pid: process.pid },
        databases: results,
        summary: {
          total: results.length,
          connected: results.filter(r => r.status === "connected").length,
          errors: results.filter(r => r.status === "error").length,
        },
      });
    }

    // API: latency benchmark
    if (url.pathname === "/api/bench") {
      const n = parseInt(url.searchParams.get("n") || "50");
      const iterations = Math.min(Math.max(n, 10), 500);
      const results = (await Promise.all([
        benchmarkPostgres(iterations),
        benchmarkMySQL(iterations),
        benchmarkMariaDB(iterations),
        benchmarkRedis(iterations),
      ])).filter(Boolean);
      return Response.json({
        timestamp: new Date().toISOString(),
        iterations,
        note: "All queries use connection pools — measures pooled query latency, not connection setup",
        benchmarks: results,
      });
    }

    // Dashboard UI
    return new Response(renderDashboard(), { headers: { "Content-Type": "text/html" } });
  },
});

function renderDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Discovery Showcase | myserver</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: #0f172a; color: #e2e8f0; min-height: 100vh; }
    .container { max-width: 1000px; margin: 0 auto; padding: 2rem; }
    h1 { font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem; }
    h1 span { background: linear-gradient(135deg, #38bdf8, #818cf8, #f472b6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtitle { color: #94a3b8; margin-bottom: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .card { background: #1e293b; border-radius: 12px; padding: 1.25rem; border: 1px solid #334155; transition: border-color 0.2s; }
    .card.ok { border-color: #22c55e; }
    .card.err { border-color: #ef4444; }
    .card .icon { font-size: 2rem; margin-bottom: 0.5rem; }
    .card .name { font-weight: 600; font-size: 1.1rem; margin-bottom: 0.25rem; }
    .card .status { font-size: 0.8rem; padding: 2px 8px; border-radius: 9999px; display: inline-block; margin-bottom: 0.5rem; }
    .card .status.ok { background: #052e16; color: #4ade80; }
    .card .status.err { background: #450a0a; color: #fca5a5; }
    .card .meta { font-size: 0.75rem; color: #64748b; line-height: 1.6; }
    .card .latency { font-size: 1.5rem; font-weight: 700; color: #38bdf8; }
    .bench { background: #1e293b; border-radius: 12px; padding: 1.5rem; border: 1px solid #334155; margin-bottom: 2rem; }
    .bench h2 { font-size: 1.2rem; margin-bottom: 1rem; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; color: #94a3b8; font-size: 0.75rem; text-transform: uppercase; padding: 0.5rem; border-bottom: 1px solid #334155; }
    td { padding: 0.5rem; border-bottom: 1px solid #1e293b; font-variant-numeric: tabular-nums; }
    .bar-cell { position: relative; }
    .bar { height: 20px; background: linear-gradient(90deg, #38bdf8, #818cf8); border-radius: 4px; min-width: 2px; transition: width 0.5s; }
    button { background: #334155; color: #e2e8f0; border: 1px solid #475569; border-radius: 8px; padding: 0.6rem 1.2rem; cursor: pointer; font-size: 0.9rem; transition: background 0.2s; }
    button:hover { background: #475569; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .actions { display: flex; gap: 1rem; margin-bottom: 2rem; }
    .footer { text-align: center; color: #475569; font-size: 0.8rem; margin-top: 2rem; }
    .spinner { display: inline-block; width: 16px; height: 16px; border: 2px solid #475569; border-top-color: #38bdf8; border-radius: 50%; animation: spin 0.6s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div class="container">
    <h1><span>Service Discovery</span> Showcase</h1>
    <p class="subtitle">Bun ${Bun.version} connecting to databases via myserver mesh discovery (CoreDNS)</p>

    <div class="actions">
      <button onclick="runTest()" id="testBtn">Test Connections</button>
      <button onclick="runBench()" id="benchBtn">Run Benchmark (50 iterations)</button>
      <button onclick="runBench(200)" id="benchBtn200">Benchmark (200)</button>
    </div>

    <div id="cards" class="grid"></div>
    <div id="benchSection" class="bench" style="display:none">
      <h2>Connection Pool Benchmark</h2>
      <table>
        <thead><tr><th>Database</th><th>Avg</th><th>Min</th><th>Max</th><th>P99</th><th style="width:40%">Distribution</th></tr></thead>
        <tbody id="benchBody"></tbody>
      </table>
    </div>
    <div class="footer">Powered by myserver internal service discovery</div>
  </div>

  <script>
    const icons = { postgresql: "&#x1f418;", mysql: "&#x1f42c;", mariadb: "&#x1f9ad;", redis: "&#x26a1;" };
    const labels = { postgresql: "PostgreSQL", mysql: "MySQL", mariadb: "MariaDB", redis: "Redis" };

    async function runTest() {
      const btn = document.getElementById("testBtn");
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Testing...';
      try {
        const res = await fetch("/api/test");
        const data = await res.json();
        const container = document.getElementById("cards");
        container.innerHTML = data.databases.map(db => \`
          <div class="card \${db.status === "connected" ? "ok" : "err"}">
            <div class="icon">\${icons[db.type] || "&#x1f4be;"}</div>
            <div class="name">\${db.name}</div>
            <div class="status \${db.status === "connected" ? "ok" : "err"}">\${db.status}</div>
            <div class="latency">\${db.latency_ms}ms</div>
            <div class="meta">
              \${db.details ? db.details + "<br>" : ""}
              \${db.pool_size ? "pool: " + db.pool_size + "<br>" : ""}
              \${db.host ? db.host : ""}
              \${db.error ? '<br><span style="color:#fca5a5">' + db.error + '</span>' : ""}
            </div>
          </div>
        \`).join("");
      } catch (e) {
        document.getElementById("cards").innerHTML = '<div class="card err">Error: ' + e.message + '</div>';
      }
      btn.disabled = false;
      btn.textContent = "Test Connections";
    }

    async function runBench(n = 50) {
      const btn = document.getElementById(n > 50 ? "benchBtn200" : "benchBtn");
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Running...';
      try {
        const res = await fetch("/api/bench?n=" + n);
        const data = await res.json();
        const section = document.getElementById("benchSection");
        section.style.display = "block";
        const maxMs = Math.max(...data.benchmarks.map(b => b.max_ms), 1);
        document.getElementById("benchBody").innerHTML = data.benchmarks.map(b => \`
          <tr>
            <td>\${icons[b.name.toLowerCase()] || ""} \${b.name}</td>
            <td><strong>\${b.avg_ms}ms</strong></td>
            <td>\${b.min_ms}ms</td>
            <td>\${b.max_ms}ms</td>
            <td>\${b.p99_ms}ms</td>
            <td class="bar-cell"><div class="bar" style="width: \${(b.avg_ms / maxMs) * 100}%"></div></td>
          </tr>
        \`).join("");
      } catch (e) {
        document.getElementById("benchBody").innerHTML = '<tr><td colspan="6">Error: ' + e.message + '</td></tr>';
      }
      btn.disabled = false;
      btn.textContent = n > 50 ? "Benchmark (" + n + ")" : "Run Benchmark (50 iterations)";
    }

    // Auto-run test on load
    runTest();
  </script>
</body>
</html>`;
}

console.log(\`Discovery showcase listening on http://localhost:\${server.port}\`);
