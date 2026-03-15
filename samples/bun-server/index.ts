import pg from "pg";
import mysql from "mysql2/promise";
import Redis from "ioredis";

const PORT = process.env.PORT || 3000;

// ── Types ────────────────────────────────────────────────────────
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

interface BenchResult {
  name: string;
  iterations: number;
  avg_ms: number;
  min_ms: number;
  max_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  stddev_ms: number;
  ops_per_sec: number;
  histogram: number[];
}

interface StressResult {
  name: string;
  total_ops: number;
  concurrency: number;
  duration_ms: number;
  success: number;
  errors: number;
  avg_ms: number;
  p99_ms: number;
  ops_per_sec: number;
}

// ── PostgreSQL pool ──────────────────────────────────────────────
const pgPool = process.env.POSTGRES_URL
  ? new pg.Pool({
      connectionString: process.env.POSTGRES_URL,
      max: 20,
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
      name: "PostgreSQL", type: "postgresql",
      host: process.env.POSTGRES_URL?.replace(/\/\/.*@/, "//***@") || "",
      status: "connected", latency_ms: Math.round(performance.now() - start),
      pool_size: pgPool.totalCount,
      details: `${res.rows[0].version.split(",")[0]} | db=${res.rows[0].db} user=${res.rows[0].user}`,
    };
  } catch (e: any) {
    return { name: "PostgreSQL", type: "postgresql", host: process.env.POSTGRES_URL?.replace(/\/\/.*@/, "//***@") || "", status: "error", latency_ms: Math.round(performance.now() - start), error: e.message?.replace(/\/\/[^@]*@/g, "//***@").replace(/password[= ][^\s;,)]+/gi, "password=***") };
  }
}

// ── MySQL pool ───────────────────────────────────────────────────
const mysqlPool = process.env.MYSQL_URL
  ? mysql.createPool({ uri: process.env.MYSQL_URL, waitForConnections: true, connectionLimit: 20, queueLimit: 0, connectTimeout: 5000 })
  : null;

async function testMySQL(): Promise<DBResult> {
  if (!mysqlPool) return { name: "MySQL", type: "mysql", host: "-", status: "error", latency_ms: 0, error: "MYSQL_URL not set" };
  const start = performance.now();
  try {
    const [rows] = await mysqlPool.query("SELECT version() as version, database() as db, current_user() as user") as any;
    return {
      name: "MySQL", type: "mysql",
      host: process.env.MYSQL_URL?.replace(/\/\/.*@/, "//***@") || "",
      status: "connected", latency_ms: Math.round(performance.now() - start),
      pool_size: 20,
      details: `MySQL ${rows[0].version} | db=${rows[0].db} user=${rows[0].user}`,
    };
  } catch (e: any) {
    return { name: "MySQL", type: "mysql", host: process.env.MYSQL_URL?.replace(/\/\/.*@/, "//***@") || "", status: "error", latency_ms: Math.round(performance.now() - start), error: e.message?.replace(/\/\/[^@]*@/g, "//***@").replace(/password[= ][^\s;,)]+/gi, "password=***") };
  }
}

// ── MariaDB pool ─────────────────────────────────────────────────
const mariaPool = process.env.MARIADB_URL
  ? mysql.createPool({ uri: process.env.MARIADB_URL, waitForConnections: true, connectionLimit: 20, queueLimit: 0, connectTimeout: 5000 })
  : null;

async function testMariaDB(): Promise<DBResult> {
  if (!mariaPool) return { name: "MariaDB", type: "mariadb", host: "-", status: "error", latency_ms: 0, error: "MARIADB_URL not set" };
  const start = performance.now();
  try {
    const [rows] = await mariaPool.query("SELECT version() as version, database() as db, current_user() as user") as any;
    return {
      name: "MariaDB", type: "mariadb",
      host: process.env.MARIADB_URL?.replace(/\/\/.*@/, "//***@") || "",
      status: "connected", latency_ms: Math.round(performance.now() - start),
      pool_size: 20,
      details: `MariaDB ${rows[0].version} | db=${rows[0].db} user=${rows[0].user}`,
    };
  } catch (e: any) {
    return { name: "MariaDB", type: "mariadb", host: process.env.MARIADB_URL?.replace(/\/\/.*@/, "//***@") || "", status: "error", latency_ms: Math.round(performance.now() - start), error: e.message?.replace(/\/\/[^@]*@/g, "//***@").replace(/password[= ][^\s;,)]+/gi, "password=***") };
  }
}

// ── Redis client ─────────────────────────────────────────────────
const redisClient = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 1, connectTimeout: 5000, lazyConnect: true })
  : null;

async function testRedis(): Promise<DBResult> {
  if (!redisClient) return { name: "Redis", type: "redis", host: "-", status: "error", latency_ms: 0, error: "REDIS_URL not set" };
  const start = performance.now();
  try {
    if (redisClient.status === "wait") await redisClient.connect();
    const info = await redisClient.info("server");
    const version = info.match(/redis_version:(.+)/)?.[1]?.trim() || "unknown";
    const mode = info.match(/redis_mode:(.+)/)?.[1]?.trim() || "unknown";
    const key = `disco:ping:${Date.now()}`;
    await redisClient.set(key, "pong", "EX", 10);
    await redisClient.get(key);
    await redisClient.del(key);
    return {
      name: "Redis", type: "redis",
      host: process.env.REDIS_URL?.replace(/:.*@/, ":***@") || "",
      status: "connected", latency_ms: Math.round(performance.now() - start),
      details: `Redis ${version} | mode=${mode}`,
    };
  } catch (e: any) {
    return { name: "Redis", type: "redis", host: process.env.REDIS_URL?.replace(/:.*@/, ":***@") || "", status: "error", latency_ms: Math.round(performance.now() - start), error: e.message?.replace(/\/\/[^@]*@/g, "//***@").replace(/password[= ][^\s;,)]+/gi, "password=***") };
  }
}

// ── Helpers ──────────────────────────────────────────────────────
function avg(arr: number[]) { return arr.reduce((a, b) => a + b, 0) / arr.length; }
function round(n: number) { return Math.round(n * 100) / 100; }
function percentile(sorted: number[], p: number) { return sorted[Math.min(Math.floor(sorted.length * p), sorted.length - 1)]; }
function stddev(arr: number[], mean: number) { return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length); }
function histogram(times: number[], buckets = 20): number[] {
  const min = times[0], max = times[times.length - 1];
  const step = (max - min) / buckets || 1;
  const hist = new Array(buckets).fill(0);
  for (const t of times) hist[Math.min(Math.floor((t - min) / step), buckets - 1)]++;
  return hist;
}

// ── Benchmark engine ─────────────────────────────────────────────
type QueryFn = () => Promise<void>;

async function runBenchmark(name: string, fn: QueryFn, iterations: number): Promise<BenchResult> {
  // Warmup: 10% of iterations
  const warmup = Math.max(5, Math.floor(iterations * 0.1));
  for (let i = 0; i < warmup; i++) await fn();

  const times: number[] = [];
  const totalStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    const s = performance.now();
    await fn();
    times.push(performance.now() - s);
  }
  const totalDuration = performance.now() - totalStart;
  times.sort((a, b) => a - b);
  const mean = avg(times);

  return {
    name, iterations,
    avg_ms: round(mean),
    min_ms: round(times[0]),
    max_ms: round(times[times.length - 1]),
    p50_ms: round(percentile(times, 0.50)),
    p95_ms: round(percentile(times, 0.95)),
    p99_ms: round(percentile(times, 0.99)),
    stddev_ms: round(stddev(times, mean)),
    ops_per_sec: round((iterations / totalDuration) * 1000),
    histogram: histogram(times),
  };
}

// Query functions for each DB (multiple complexity levels)
function pgQueries(mode: string): QueryFn {
  if (!pgPool) return async () => {};
  switch (mode) {
    case "write":
      return async () => {
        const c = await pgPool.connect();
        await c.query("CREATE TABLE IF NOT EXISTS _bench(id serial PRIMARY KEY, val text, n int, ts timestamptz DEFAULT now())");
        await c.query("INSERT INTO _bench(val, n) VALUES($1, $2)", [`row-${Date.now()}`, Math.random() * 1000 | 0]);
        c.release();
      };
    case "read_write":
      return async () => {
        const c = await pgPool.connect();
        await c.query("CREATE TABLE IF NOT EXISTS _bench(id serial PRIMARY KEY, val text, n int, ts timestamptz DEFAULT now())");
        await c.query("INSERT INTO _bench(val, n) VALUES($1, $2) RETURNING id", [`rw-${Date.now()}`, Math.random() * 1000 | 0]);
        await c.query("SELECT count(*), avg(n), max(n) FROM _bench");
        await c.query("DELETE FROM _bench WHERE id IN (SELECT id FROM _bench ORDER BY random() LIMIT 5)");
        c.release();
      };
    case "transaction":
      return async () => {
        const c = await pgPool.connect();
        await c.query("CREATE TABLE IF NOT EXISTS _bench(id serial PRIMARY KEY, val text, n int, ts timestamptz DEFAULT now())");
        await c.query("BEGIN");
        await c.query("INSERT INTO _bench(val, n) VALUES($1, $2)", [`tx-${Date.now()}`, Math.random() * 1000 | 0]);
        await c.query("UPDATE _bench SET n = n + 1 WHERE id = (SELECT min(id) FROM _bench)");
        await c.query("SELECT * FROM _bench ORDER BY id DESC LIMIT 10");
        await c.query("COMMIT");
        c.release();
      };
    case "complex":
      return async () => {
        const c = await pgPool.connect();
        await c.query("CREATE TABLE IF NOT EXISTS _bench(id serial PRIMARY KEY, val text, n int, ts timestamptz DEFAULT now())");
        await c.query(`
          WITH recent AS (SELECT * FROM _bench ORDER BY ts DESC LIMIT 100),
               stats AS (SELECT count(*) as cnt, avg(n) as avg_n, stddev(n) as std_n FROM recent),
               inserted AS (INSERT INTO _bench(val, n) VALUES($1, $2) RETURNING *)
          SELECT i.*, s.cnt, s.avg_n, s.std_n FROM inserted i CROSS JOIN stats s
        `, [`cx-${Date.now()}`, Math.random() * 10000 | 0]);
        c.release();
      };
    default: // ping
      return async () => { const c = await pgPool.connect(); await c.query("SELECT 1"); c.release(); };
  }
}

function mysqlQueries(pool: mysql.Pool | null, mode: string): QueryFn {
  if (!pool) return async () => {};
  switch (mode) {
    case "write":
      return async () => {
        await pool.query("CREATE TABLE IF NOT EXISTS _bench(id INT AUTO_INCREMENT PRIMARY KEY, val VARCHAR(255), n INT, ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
        await pool.query("INSERT INTO _bench(val, n) VALUES(?, ?)", [`row-${Date.now()}`, Math.random() * 1000 | 0]);
      };
    case "read_write":
      return async () => {
        await pool.query("CREATE TABLE IF NOT EXISTS _bench(id INT AUTO_INCREMENT PRIMARY KEY, val VARCHAR(255), n INT, ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
        await pool.query("INSERT INTO _bench(val, n) VALUES(?, ?)", [`rw-${Date.now()}`, Math.random() * 1000 | 0]);
        await pool.query("SELECT count(*) as cnt, avg(n) as avg_n, max(n) as max_n FROM _bench");
        await pool.query("DELETE FROM _bench ORDER BY RAND() LIMIT 5");
      };
    case "transaction":
      return async () => {
        const conn = await pool.getConnection();
        await conn.query("CREATE TABLE IF NOT EXISTS _bench(id INT AUTO_INCREMENT PRIMARY KEY, val VARCHAR(255), n INT, ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
        await conn.beginTransaction();
        await conn.query("INSERT INTO _bench(val, n) VALUES(?, ?)", [`tx-${Date.now()}`, Math.random() * 1000 | 0]);
        await conn.query("UPDATE _bench SET n = n + 1 ORDER BY id LIMIT 1");
        await conn.query("SELECT * FROM _bench ORDER BY id DESC LIMIT 10");
        await conn.commit();
        conn.release();
      };
    default:
      return async () => { await pool.query("SELECT 1"); };
  }
}

function redisQueries(mode: string): QueryFn {
  if (!redisClient) return async () => {};
  switch (mode) {
    case "write":
      return async () => {
        const key = `bench:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        await redisClient.set(key, JSON.stringify({ ts: Date.now(), val: Math.random() }), "EX", 60);
      };
    case "read_write":
      return async () => {
        const key = `bench:rw:${Math.random().toString(36).slice(2, 8)}`;
        await redisClient.set(key, JSON.stringify({ ts: Date.now(), val: Math.random() }), "EX", 60);
        await redisClient.get(key);
        await redisClient.incr("bench:counter");
        await redisClient.lpush("bench:log", `${Date.now()}`);
        await redisClient.ltrim("bench:log", 0, 99);
        await redisClient.del(key);
      };
    case "pipeline":
      return async () => {
        const pipe = redisClient.pipeline();
        for (let i = 0; i < 10; i++) {
          pipe.set(`bench:pipe:${i}`, `val-${Date.now()}`, "EX", 60);
          pipe.get(`bench:pipe:${i}`);
        }
        await pipe.exec();
      };
    case "complex":
      return async () => {
        const key = `bench:hash:${Math.random().toString(36).slice(2, 6)}`;
        await redisClient.hset(key, { name: "test", score: String(Math.random() * 100 | 0), ts: String(Date.now()) });
        await redisClient.hgetall(key);
        await redisClient.zadd("bench:leaderboard", Math.random() * 1000 | 0, key);
        await redisClient.zrangebyscore("bench:leaderboard", "-inf", "+inf", "LIMIT", 0, 10);
        await redisClient.expire(key, 60);
      };
    default:
      return async () => { await redisClient.ping(); };
  }
}

// ── Stress test (concurrent connections) ─────────────────────────
async function stressTest(name: string, fn: QueryFn, concurrency: number, opsPerWorker: number): Promise<StressResult> {
  const times: number[] = [];
  let errors = 0;
  const totalStart = performance.now();

  const workers = Array.from({ length: concurrency }, async () => {
    for (let i = 0; i < opsPerWorker; i++) {
      const s = performance.now();
      try {
        await fn();
        times.push(performance.now() - s);
      } catch {
        errors++;
      }
    }
  });
  await Promise.all(workers);
  const totalDuration = performance.now() - totalStart;
  times.sort((a, b) => a - b);

  return {
    name,
    total_ops: concurrency * opsPerWorker,
    concurrency,
    duration_ms: round(totalDuration),
    success: times.length,
    errors,
    avg_ms: times.length ? round(avg(times)) : 0,
    p99_ms: times.length ? round(percentile(times, 0.99)) : 0,
    ops_per_sec: round((times.length / totalDuration) * 1000),
  };
}

// ── HTTP server ──────────────────────────────────────────────────
const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health") return new Response("OK");

    // API: connectivity test
    if (url.pathname === "/api/test") {
      const results = await Promise.all([testPostgres(), testMySQL(), testMariaDB(), testRedis()]);
      return Response.json({
        timestamp: new Date().toISOString(),
        runtime: `Bun ${Bun.version}`,
        server: { platform: process.platform, arch: process.arch, pid: process.pid, uptime_s: Math.round(process.uptime()) },
        databases: results,
        summary: { total: results.length, connected: results.filter(r => r.status === "connected").length, errors: results.filter(r => r.status === "error").length },
      });
    }

    // API: benchmark with modes
    if (url.pathname === "/api/bench") {
      const n = Math.min(Math.max(parseInt(url.searchParams.get("n") || "50"), 10), 1000);
      const mode = url.searchParams.get("mode") || "ping";
      const results = (await Promise.all([
        pgPool ? runBenchmark("PostgreSQL", pgQueries(mode), n) : null,
        mysqlPool ? runBenchmark("MySQL", mysqlQueries(mysqlPool, mode), n) : null,
        mariaPool ? runBenchmark("MariaDB", mysqlQueries(mariaPool, mode), n) : null,
        (redisClient && redisClient.status !== "wait") ? runBenchmark("Redis", redisQueries(mode), n) : null,
      ])).filter(Boolean);
      return Response.json({ timestamp: new Date().toISOString(), iterations: n, mode, benchmarks: results });
    }

    // API: stress test
    if (url.pathname === "/api/stress") {
      const concurrency = Math.min(Math.max(parseInt(url.searchParams.get("c") || "10"), 1), 50);
      const ops = Math.min(Math.max(parseInt(url.searchParams.get("ops") || "20"), 5), 200);
      const results = (await Promise.all([
        pgPool ? stressTest("PostgreSQL", pgQueries("read_write"), concurrency, ops) : null,
        mysqlPool ? stressTest("MySQL", mysqlQueries(mysqlPool, "read_write"), concurrency, ops) : null,
        mariaPool ? stressTest("MariaDB", mysqlQueries(mariaPool, "read_write"), concurrency, ops) : null,
        (redisClient && redisClient.status !== "wait") ? stressTest("Redis", redisQueries("read_write"), concurrency, ops) : null,
      ])).filter(Boolean);
      return Response.json({ timestamp: new Date().toISOString(), concurrency, ops_per_worker: ops, results });
    }

    // Dashboard
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
    :root { --bg: #0f172a; --card: #1e293b; --border: #334155; --text: #e2e8f0; --muted: #94a3b8; --dim: #64748b; --blue: #38bdf8; --purple: #818cf8; --pink: #f472b6; --green: #4ade80; --red: #fca5a5; --yellow: #fbbf24; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
    .container { max-width: 1100px; margin: 0 auto; padding: 2rem; }
    h1 { font-size: 2rem; font-weight: 700; margin-bottom: 0.5rem; }
    h1 span { background: linear-gradient(135deg, var(--blue), var(--purple), var(--pink)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtitle { color: var(--muted); margin-bottom: 2rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 1rem; margin-bottom: 2rem; }
    .card { background: var(--card); border-radius: 12px; padding: 1.25rem; border: 1px solid var(--border); transition: all 0.2s; }
    .card:hover { transform: translateY(-2px); box-shadow: 0 8px 25px rgba(0,0,0,0.3); }
    .card.ok { border-color: #22c55e; }
    .card.err { border-color: #ef4444; }
    .card .icon { font-size: 2rem; margin-bottom: 0.5rem; }
    .card .name { font-weight: 600; font-size: 1.1rem; margin-bottom: 0.25rem; }
    .badge { font-size: 0.7rem; padding: 2px 8px; border-radius: 9999px; display: inline-block; margin-bottom: 0.5rem; font-weight: 600; }
    .badge.ok { background: #052e16; color: var(--green); }
    .badge.err { background: #450a0a; color: var(--red); }
    .card .meta { font-size: 0.75rem; color: var(--dim); line-height: 1.6; }
    .card .latency { font-size: 1.5rem; font-weight: 700; color: var(--blue); }
    .panel { background: var(--card); border-radius: 12px; padding: 1.5rem; border: 1px solid var(--border); margin-bottom: 1.5rem; }
    .panel h2 { font-size: 1.1rem; margin-bottom: 0.25rem; }
    .panel .desc { font-size: 0.8rem; color: var(--muted); margin-bottom: 1rem; }
    table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    th { text-align: left; color: var(--muted); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.5rem 0.5rem; border-bottom: 1px solid var(--border); }
    td { padding: 0.6rem 0.5rem; border-bottom: 1px solid #1e293b; font-variant-numeric: tabular-nums; }
    .bar-cell { position: relative; }
    .bar { height: 22px; border-radius: 4px; min-width: 2px; transition: width 0.5s; }
    .bar.pg { background: linear-gradient(90deg, #336791, #5b9bd5); }
    .bar.my { background: linear-gradient(90deg, #00758f, #f29111); }
    .bar.ma { background: linear-gradient(90deg, #003545, #c0765a); }
    .bar.re { background: linear-gradient(90deg, #dc382d, #ff6b6b); }
    .spark { display: inline-flex; align-items: flex-end; gap: 1px; height: 24px; }
    .spark div { width: 4px; background: var(--purple); border-radius: 1px; min-height: 2px; opacity: 0.8; }
    button { background: var(--border); color: var(--text); border: 1px solid #475569; border-radius: 8px; padding: 0.5rem 1rem; cursor: pointer; font-size: 0.85rem; transition: all 0.2s; }
    button:hover { background: #475569; }
    button:disabled { opacity: 0.4; cursor: not-allowed; }
    button.primary { background: #1d4ed8; border-color: #2563eb; }
    button.primary:hover { background: #2563eb; }
    button.danger { background: #991b1b; border-color: #b91c1c; }
    button.danger:hover { background: #b91c1c; }
    .actions { display: flex; gap: 0.75rem; margin-bottom: 1.5rem; flex-wrap: wrap; align-items: center; }
    .mode-select { background: var(--card); color: var(--text); border: 1px solid #475569; border-radius: 8px; padding: 0.5rem; font-size: 0.85rem; }
    .footer { text-align: center; color: #475569; font-size: 0.8rem; margin-top: 2rem; }
    .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid #475569; border-top-color: var(--blue); border-radius: 50%; animation: spin 0.6s linear infinite; vertical-align: middle; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .tabs { display: flex; gap: 0; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border); }
    .tab { padding: 0.6rem 1.2rem; cursor: pointer; font-size: 0.85rem; color: var(--muted); border-bottom: 2px solid transparent; transition: all 0.2s; }
    .tab:hover { color: var(--text); }
    .tab.active { color: var(--blue); border-bottom-color: var(--blue); }
    .tab-content { display: none; }
    .tab-content.active { display: block; }
    .stat-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(120px, 1fr)); gap: 0.75rem; margin-bottom: 1rem; }
    .stat { text-align: center; padding: 0.75rem; background: rgba(56,189,248,0.05); border-radius: 8px; border: 1px solid rgba(56,189,248,0.1); }
    .stat .val { font-size: 1.4rem; font-weight: 700; color: var(--blue); }
    .stat .lbl { font-size: 0.7rem; color: var(--muted); text-transform: uppercase; }
    .stress-bar { display: flex; height: 24px; border-radius: 4px; overflow: hidden; }
    .stress-bar .ok-part { background: #22c55e; }
    .stress-bar .err-part { background: #ef4444; }
    @media (max-width: 640px) { .grid { grid-template-columns: 1fr 1fr; } .stat-grid { grid-template-columns: repeat(3, 1fr); } }
  </style>
</head>
<body>
  <div class="container">
    <h1><span>Service Discovery</span> Showcase</h1>
    <p class="subtitle">Bun ${Bun.version} &bull; ${process.platform}/${process.arch} &bull; PID ${process.pid} &bull; Databases via myserver mesh discovery (CoreDNS)</p>

    <div class="tabs">
      <div class="tab active" onclick="switchTab('connections')">Connections</div>
      <div class="tab" onclick="switchTab('benchmark')">Benchmark</div>
      <div class="tab" onclick="switchTab('stress')">Stress Test</div>
    </div>

    <!-- ═══ CONNECTIONS TAB ═══ -->
    <div id="tab-connections" class="tab-content active">
      <div class="actions">
        <button class="primary" onclick="runTest()" id="testBtn">Test All Connections</button>
      </div>
      <div id="cards" class="grid"></div>
    </div>

    <!-- ═══ BENCHMARK TAB ═══ -->
    <div id="tab-benchmark" class="tab-content">
      <div class="actions">
        <select class="mode-select" id="benchMode">
          <option value="ping">Ping (SELECT 1)</option>
          <option value="write">Write (INSERT)</option>
          <option value="read_write" selected>Read + Write Mix</option>
          <option value="transaction">Transaction (BEGIN..COMMIT)</option>
          <option value="complex">Complex (CTE / Pipeline)</option>
        </select>
        <button onclick="runBench(50)" id="benchBtn50">50 iterations</button>
        <button onclick="runBench(200)" id="benchBtn200">200 iterations</button>
        <button class="primary" onclick="runBench(500)" id="benchBtn500">500 iterations</button>
      </div>
      <div id="benchResults"></div>
    </div>

    <!-- ═══ STRESS TEST TAB ═══ -->
    <div id="tab-stress" class="tab-content">
      <div class="actions">
        <button onclick="runStress(5, 20)">Light (5&times;20)</button>
        <button onclick="runStress(10, 50)" id="stressBtn">Medium (10&times;50)</button>
        <button class="primary" onclick="runStress(20, 50)">Heavy (20&times;50)</button>
        <button class="danger" onclick="runStress(50, 100)">Extreme (50&times;100)</button>
      </div>
      <div id="stressResults"></div>
    </div>

    <div class="footer">Powered by myserver internal service discovery</div>
  </div>

  <script>
    const icons = { postgresql: "\\u{1F418}", mysql: "\\u{1F42C}", mariadb: "\\u{1F9AD}", redis: "\\u{26A1}" };
    const barClass = { PostgreSQL: "pg", MySQL: "my", MariaDB: "ma", Redis: "re" };

    function switchTab(name) {
      document.querySelectorAll(".tab").forEach(t => t.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
      document.querySelector(".tab-content#tab-" + name).classList.add("active");
      document.querySelectorAll(".tab")[["connections","benchmark","stress"].indexOf(name)].classList.add("active");
    }

    function sparkline(hist) {
      if (!hist || !hist.length) return "";
      const max = Math.max(...hist, 1);
      return '<span class="spark">' + hist.map(v => '<div style="height:' + Math.max(2, (v/max)*22) + 'px"></div>').join("") + '</span>';
    }

    async function runTest() {
      const btn = document.getElementById("testBtn");
      btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Testing...';
      try {
        const data = await (await fetch("/api/test")).json();
        document.getElementById("cards").innerHTML = data.databases.map(db =>
          '<div class="card ' + (db.status === "connected" ? "ok" : "err") + '">' +
          '<div class="icon">' + (icons[db.type] || "\\u{1F4BE}") + '</div>' +
          '<div class="name">' + db.name + '</div>' +
          '<div class="badge ' + (db.status === "connected" ? "ok" : "err") + '">' + db.status + '</div>' +
          '<div class="latency">' + db.latency_ms + 'ms</div>' +
          '<div class="meta">' +
            (db.details ? db.details + "<br>" : "") +
            (db.pool_size ? "pool: " + db.pool_size + "<br>" : "") +
            (db.host || "") +
            (db.error ? '<br><span style="color:var(--red)">' + db.error + '</span>' : "") +
          '</div></div>'
        ).join("");
      } catch (e) { document.getElementById("cards").innerHTML = '<div class="card err">Error: ' + e.message + '</div>'; }
      btn.disabled = false; btn.textContent = "Test All Connections";
    }

    async function runBench(n) {
      const mode = document.getElementById("benchMode").value;
      const btns = ["benchBtn50","benchBtn200","benchBtn500"];
      btns.forEach(id => { const b = document.getElementById(id); if(b) { b.disabled = true; }});
      const activeBtn = document.getElementById("benchBtn" + n) || document.getElementById("benchBtn50");
      activeBtn.innerHTML = '<span class="spinner"></span> Running ' + mode + '...';
      try {
        const data = await (await fetch("/api/bench?n=" + n + "&mode=" + mode)).json();
        const maxAvg = Math.max(...data.benchmarks.map(b => b.avg_ms), 0.1);
        const maxOps = Math.max(...data.benchmarks.map(b => b.ops_per_sec), 1);
        document.getElementById("benchResults").innerHTML =
          '<div class="panel"><h2>Benchmark Results</h2>' +
          '<p class="desc">Mode: <strong>' + mode + '</strong> &bull; ' + n + ' iterations per database (+ 10% warmup) &bull; ' + data.timestamp + '</p>' +
          '<table><thead><tr><th>Database</th><th>Avg</th><th>P50</th><th>P95</th><th>P99</th><th>Stddev</th><th>Ops/s</th><th style="width:15%">Latency</th><th style="width:15%">Distribution</th></tr></thead><tbody>' +
          data.benchmarks.map(b =>
            '<tr><td><strong>' + b.name + '</strong></td>' +
            '<td>' + b.avg_ms + 'ms</td>' +
            '<td>' + b.p50_ms + 'ms</td>' +
            '<td>' + b.p95_ms + 'ms</td>' +
            '<td>' + b.p99_ms + 'ms</td>' +
            '<td>' + b.stddev_ms + '</td>' +
            '<td><strong>' + b.ops_per_sec.toLocaleString() + '</strong></td>' +
            '<td class="bar-cell"><div class="bar ' + (barClass[b.name]||"") + '" style="width:' + Math.max(5, (b.avg_ms/maxAvg)*100) + '%"></div></td>' +
            '<td>' + sparkline(b.histogram) + '</td></tr>'
          ).join("") +
          '</tbody></table></div>';
      } catch (e) { document.getElementById("benchResults").innerHTML = '<div class="panel">Error: ' + e.message + '</div>'; }
      btns.forEach(id => { const b = document.getElementById(id); if(b) { b.disabled = false; }});
      activeBtn.textContent = n + " iterations";
    }

    async function runStress(c, ops) {
      const btns = document.querySelectorAll("#tab-stress button");
      btns.forEach(b => b.disabled = true);
      document.getElementById("stressResults").innerHTML = '<div class="panel"><span class="spinner"></span> Running stress test: ' + c + ' concurrent workers &times; ' + ops + ' operations each...</div>';
      try {
        const data = await (await fetch("/api/stress?c=" + c + "&ops=" + ops)).json();
        const maxOps = Math.max(...data.results.map(r => r.ops_per_sec), 1);
        document.getElementById("stressResults").innerHTML =
          '<div class="panel"><h2>Stress Test Results</h2>' +
          '<p class="desc">' + c + ' concurrent workers &times; ' + ops + ' ops each = ' + (c*ops).toLocaleString() + ' total operations &bull; ' + data.timestamp + '</p>' +
          '<div class="stat-grid">' + data.results.map(r =>
            '<div class="stat"><div class="val">' + r.ops_per_sec.toLocaleString() + '</div><div class="lbl">' + r.name + ' ops/s</div></div>'
          ).join("") + '</div>' +
          '<table><thead><tr><th>Database</th><th>Total Ops</th><th>Success</th><th>Errors</th><th>Avg</th><th>P99</th><th>Duration</th><th>Ops/s</th><th style="width:20%">Success Rate</th></tr></thead><tbody>' +
          data.results.map(r => {
            const pct = r.total_ops ? (r.success / r.total_ops * 100) : 0;
            return '<tr><td><strong>' + r.name + '</strong></td>' +
              '<td>' + r.total_ops.toLocaleString() + '</td>' +
              '<td style="color:var(--green)">' + r.success.toLocaleString() + '</td>' +
              '<td style="color:' + (r.errors ? 'var(--red)' : 'var(--dim)') + '">' + r.errors + '</td>' +
              '<td>' + r.avg_ms + 'ms</td>' +
              '<td>' + r.p99_ms + 'ms</td>' +
              '<td>' + r.duration_ms + 'ms</td>' +
              '<td><strong>' + r.ops_per_sec.toLocaleString() + '</strong></td>' +
              '<td><div class="stress-bar"><div class="ok-part" style="width:' + pct + '%"></div><div class="err-part" style="width:' + (100-pct) + '%"></div></div><span style="font-size:0.75rem;color:var(--muted)">' + pct.toFixed(1) + '%</span></td></tr>';
          }).join("") +
          '</tbody></table></div>';
      } catch (e) { document.getElementById("stressResults").innerHTML = '<div class="panel">Error: ' + e.message + '</div>'; }
      btns.forEach(b => b.disabled = false);
    }

    // Auto-run connection test on load
    runTest();
  </script>
</body>
</html>`;
}

console.log(`Discovery showcase listening on http://localhost:${server.port}`);
