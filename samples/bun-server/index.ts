import pg from "pg";
import mysql from "mysql2/promise";
import Redis from "ioredis";
import { Database } from "bun:sqlite";

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

// ── SQLite history database ──────────────────────────────────────
const historyDb = new Database("history.sqlite");
historyDb.run("CREATE TABLE IF NOT EXISTS runs(id INTEGER PRIMARY KEY AUTOINCREMENT, type TEXT NOT NULL, mode TEXT NOT NULL, timestamp TEXT NOT NULL, data JSON NOT NULL)");

function saveRun(type: string, mode: string, data: any): number {
  const stmt = historyDb.prepare("INSERT INTO runs(type, mode, timestamp, data) VALUES(?, ?, ?, ?)");
  const result = stmt.run(type, mode, new Date().toISOString(), JSON.stringify(data));
  return Number(result.lastInsertRowid);
}

function getHistory(limit = 50): any[] {
  return historyDb.prepare("SELECT id, type, mode, timestamp, data FROM runs ORDER BY id DESC LIMIT ?").all(limit) as any[];
}

function getHistoryById(id: number): any {
  return historyDb.prepare("SELECT id, type, mode, timestamp, data FROM runs WHERE id = ?").get(id) as any;
}

function clearHistory(): void {
  historyDb.run("DELETE FROM runs");
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

// Ensure bench tables exist once (called before benchmarks/stress, not per-op)
async function ensureBenchTables() {
  if (pgPool) {
    const c = await pgPool.connect();
    await c.query("CREATE TABLE IF NOT EXISTS _bench(id serial PRIMARY KEY, val text, n int, ts timestamptz DEFAULT now())");
    c.release();
  }
  if (mysqlPool) {
    await mysqlPool.query("CREATE TABLE IF NOT EXISTS _bench(id INT AUTO_INCREMENT PRIMARY KEY, val VARCHAR(255), n INT, ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  }
  if (mariaPool) {
    await mariaPool.query("CREATE TABLE IF NOT EXISTS _bench(id INT AUTO_INCREMENT PRIMARY KEY, val VARCHAR(255), n INT, ts TIMESTAMP DEFAULT CURRENT_TIMESTAMP)");
  }
}

// Query functions for each DB (multiple complexity levels)
function pgQueries(mode: string): QueryFn {
  if (!pgPool) return async () => {};
  switch (mode) {
    case "write":
      return async () => {
        const c = await pgPool.connect();
        await c.query("INSERT INTO _bench(val, n) VALUES($1, $2)", [`row-${Date.now()}`, Math.random() * 1000 | 0]);
        c.release();
      };
    case "read_write":
      return async () => {
        const c = await pgPool.connect();
        await c.query("INSERT INTO _bench(val, n) VALUES($1, $2) RETURNING id", [`rw-${Date.now()}`, Math.random() * 1000 | 0]);
        await c.query("SELECT count(*), avg(n), max(n) FROM _bench");
        await c.query("DELETE FROM _bench WHERE id IN (SELECT id FROM _bench ORDER BY random() LIMIT 5)");
        c.release();
      };
    case "transaction":
      return async () => {
        const c = await pgPool.connect();
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
        await pool.query("INSERT INTO _bench(val, n) VALUES(?, ?)", [`row-${Date.now()}`, Math.random() * 1000 | 0]);
      };
    case "read_write":
      return async () => {
        await pool.query("INSERT INTO _bench(val, n) VALUES(?, ?)", [`rw-${Date.now()}`, Math.random() * 1000 | 0]);
        await pool.query("SELECT count(*) as cnt, avg(n) as avg_n, max(n) as max_n FROM _bench");
        await pool.query("DELETE FROM _bench ORDER BY RAND() LIMIT 5");
      };
    case "transaction":
      return async () => {
        const conn = await pool.getConnection();
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
      if (mode !== "ping") await ensureBenchTables();
      const results = (await Promise.all([
        pgPool ? runBenchmark("PostgreSQL", pgQueries(mode), n) : null,
        mysqlPool ? runBenchmark("MySQL", mysqlQueries(mysqlPool, mode), n) : null,
        mariaPool ? runBenchmark("MariaDB", mysqlQueries(mariaPool, mode), n) : null,
        (redisClient && redisClient.status !== "wait") ? runBenchmark("Redis", redisQueries(mode), n) : null,
      ])).filter(Boolean);
      const payload = { timestamp: new Date().toISOString(), iterations: n, mode, benchmarks: results };
      saveRun("bench", mode, payload);
      return Response.json(payload);
    }

    // API: stress test
    if (url.pathname === "/api/stress") {
      await ensureBenchTables();
      const concurrency = Math.min(Math.max(parseInt(url.searchParams.get("c") || "10"), 1), 50);
      const rawOps = Math.min(Math.max(parseInt(url.searchParams.get("ops") || "20"), 5), 200);
      // Cap total ops to prevent Cloudflare tunnel timeout (~100s).
      // read_write mode does ~4 queries per op, ~5-15ms each = ~40ms/op.
      // 1500 total ops ≈ 60s worst case per DB (they run in parallel).
      const maxTotal = 1500;
      const ops = Math.min(rawOps, Math.floor(maxTotal / concurrency));
      const results = (await Promise.all([
        pgPool ? stressTest("PostgreSQL", pgQueries("read_write"), concurrency, ops) : null,
        mysqlPool ? stressTest("MySQL", mysqlQueries(mysqlPool, "read_write"), concurrency, ops) : null,
        mariaPool ? stressTest("MariaDB", mysqlQueries(mariaPool, "read_write"), concurrency, ops) : null,
        (redisClient && redisClient.status !== "wait") ? stressTest("Redis", redisQueries("read_write"), concurrency, ops) : null,
      ])).filter(Boolean);
      const payload = { timestamp: new Date().toISOString(), concurrency, ops_per_worker: ops, results };
      saveRun("stress", "read_write", payload);
      return Response.json(payload);
    }

    // API: history
    if (url.pathname === "/api/history" && request.method === "GET") {
      const rows = getHistory();
      const parsed = rows.map((r: any) => ({ id: r.id, type: r.type, mode: r.mode, timestamp: r.timestamp, data: JSON.parse(r.data) }));
      return Response.json(parsed);
    }

    if (url.pathname === "/api/history" && request.method === "DELETE") {
      clearHistory();
      return Response.json({ ok: true });
    }

    if (url.pathname.startsWith("/api/history/") && request.method === "GET") {
      const id = parseInt(url.pathname.split("/").pop() || "0");
      const row = getHistoryById(id) as any;
      if (!row) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json({ id: row.id, type: row.type, mode: row.mode, timestamp: row.timestamp, data: JSON.parse(row.data) });
    }

    // Dashboard
    return new Response(renderDashboard(), { headers: { "Content-Type": "text/html" } });
  },
});

function renderDashboard(): string {
  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Database Performance Observatory | myserver</title>
  <link href="https://cdn.jsdelivr.net/npm/daisyui@4/dist/full.min.css" rel="stylesheet">
  <script src="https://cdn.tailwindcss.com"><\/script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"><\/script>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script>
  tailwind.config = {
    theme: { extend: { fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] } } },
    daisyui: { themes: ['dark'] }
  }
  <\/script>
  <style>
    .spark { display: inline-flex; align-items: flex-end; gap: 1px; height: 22px; }
    .spark div { width: 3px; border-radius: 1px; min-height: 2px; opacity: 0.8; }
  </style>
</head>
<body class="font-sans min-h-screen">
  <div class="max-w-7xl mx-auto px-4 sm:px-6 py-8">

    <!-- Header -->
    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center border-b border-base-300 pb-6 mb-6 gap-4">
      <div>
        <h1 class="text-2xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">myserver</h1>
        <p class="text-sm text-base-content/60">Database Performance Observatory</p>
      </div>
      <div class="flex gap-2">
        <span class="badge badge-outline">Bun ${Bun.version}</span>
        <span class="badge badge-outline">${process.platform}/${process.arch}</span>
      </div>
    </div>

    <!-- Tabs -->
    <div class="flex justify-center mb-6">
      <div class="tabs tabs-boxed" id="mainTabs">
        <a class="tab tab-active" onclick="switchTab('connections')">Connections</a>
        <a class="tab" onclick="switchTab('benchmark')">Benchmark</a>
        <a class="tab" onclick="switchTab('stress')">Stress Test</a>
        <a class="tab" onclick="switchTab('history')">History</a>
      </div>
    </div>

    <!-- Connections Tab -->
    <div id="tab-connections" class="tab-content">
      <div id="cards" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4"></div>
    </div>

    <!-- Benchmark Tab -->
    <div id="tab-benchmark" class="tab-content hidden">
      <div class="flex flex-wrap gap-2 mb-6 items-center">
        <select id="benchMode" class="select select-bordered select-sm">
          <option value="ping">Ping (SELECT 1)</option>
          <option value="write">Write (INSERT)</option>
          <option value="read_write" selected>Read + Write Mix</option>
          <option value="transaction">Transaction (BEGIN..COMMIT)</option>
          <option value="complex">Complex (CTE / Pipeline)</option>
        </select>
        <button class="btn btn-sm btn-ghost" onclick="runBench(50)" id="benchBtn50">50 iter</button>
        <button class="btn btn-sm btn-ghost" onclick="runBench(200)" id="benchBtn200">200 iter</button>
        <button class="btn btn-sm btn-primary" onclick="runBench(500)" id="benchBtn500">500 iter</button>
      </div>
      <div id="benchResults"></div>
    </div>

    <!-- Stress Test Tab -->
    <div id="tab-stress" class="tab-content hidden">
      <div class="flex flex-wrap gap-2 mb-6">
        <button class="btn btn-sm btn-ghost" onclick="runStress(5, 20)">Light (5x20)</button>
        <button class="btn btn-sm btn-ghost" onclick="runStress(10, 50)">Medium (10x50)</button>
        <button class="btn btn-sm btn-primary" onclick="runStress(20, 50)">Heavy (20x50)</button>
        <button class="btn btn-sm btn-error" onclick="runStress(50, 100)">Extreme (50x100)</button>
      </div>
      <div id="stressResults"></div>
    </div>

    <!-- History Tab -->
    <div id="tab-history" class="tab-content hidden">
      <div id="historyChart" class="card bg-base-200 shadow-sm mb-4" style="display:none">
        <div class="card-body">
          <h2 class="card-title text-sm">Performance Trend</h2>
          <p class="text-xs text-base-content/50">Ops/sec across all runs</p>
          <div style="height:300px"><canvas id="trendCanvas"></canvas></div>
        </div>
      </div>
      <div id="historyTable"></div>
      <div id="historyDetail"></div>
    </div>

    <!-- Footer -->
    <div class="text-center pt-6 mt-8 border-t border-base-300">
      <p class="text-xs text-base-content/40">Powered by myserver service discovery</p>
    </div>
  </div>

  <script>
    var DB_COLORS = { PostgreSQL: '#60a5fa', MySQL: '#22d3ee', MariaDB: '#fb923c', Redis: '#f87171' };
    var DB_BORDER_CLS = { postgresql: 'border-blue-400', mysql: 'border-cyan-400', mariadb: 'border-orange-400', redis: 'border-red-400' };
    var DB_TEXT_CLS = { postgresql: 'text-blue-400', mysql: 'text-cyan-400', mariadb: 'text-orange-400', redis: 'text-red-400' };
    var TAB_NAMES = ['connections', 'benchmark', 'stress', 'history'];
    var benchChart = null;
    var stressChart = null;
    var trendChart = null;
    var expandedRunId = null;

    function switchTab(name) {
      var tabEls = document.querySelectorAll('#mainTabs .tab');
      for (var i = 0; i < tabEls.length; i++) {
        tabEls[i].classList.remove('tab-active');
      }
      tabEls[TAB_NAMES.indexOf(name)].classList.add('tab-active');
      for (var i = 0; i < TAB_NAMES.length; i++) {
        var el = document.getElementById('tab-' + TAB_NAMES[i]);
        if (TAB_NAMES[i] === name) {
          el.classList.remove('hidden');
        } else {
          el.classList.add('hidden');
        }
      }
      if (name === 'connections') runTest();
      if (name === 'history') loadHistory();
    }

    function sparkline(hist, color) {
      if (!hist || !hist.length) return '';
      var max = Math.max.apply(null, hist.concat([1]));
      var html = '<span class="spark">';
      for (var i = 0; i < hist.length; i++) {
        var h = Math.max(2, (hist[i] / max) * 20);
        html += '<div style="height:' + h + 'px;background:' + (color || '#60a5fa') + '"></div>';
      }
      return html + '</span>';
    }

    function chartTooltipConfig() {
      return {
        backgroundColor: '#1d232a',
        titleColor: '#a6adbb',
        bodyColor: '#a6adbb',
        borderColor: '#373f4a',
        borderWidth: 1,
        cornerRadius: 8,
        padding: 10,
        titleFont: { family: 'Inter', size: 12, weight: '600' },
        bodyFont: { family: 'Inter', size: 11 }
      };
    }

    function renderSkeletons() {
      var html = '';
      var borders = ['border-blue-400', 'border-cyan-400', 'border-orange-400', 'border-red-400'];
      for (var i = 0; i < 4; i++) {
        html += '<div class="card bg-base-200 shadow-sm border-l-4 ' + borders[i] + '">';
        html += '<div class="card-body gap-3">';
        html += '<div class="skeleton h-4 w-24"></div>';
        html += '<div class="skeleton h-3 w-16"></div>';
        html += '<div class="skeleton h-8 w-20"></div>';
        html += '<div class="skeleton h-3 w-32"></div>';
        html += '</div></div>';
      }
      return html;
    }

    async function runTest() {
      document.getElementById('cards').innerHTML = renderSkeletons();
      try {
        var resp = await fetch('/api/test');
        var data = await resp.json();
        var html = '';
        for (var i = 0; i < data.databases.length; i++) {
          var db = data.databases[i];
          var borderCls = DB_BORDER_CLS[db.type] || 'border-base-300';
          var textCls = DB_TEXT_CLS[db.type] || 'text-base-content';
          var isOk = db.status === 'connected';
          html += '<div class="card bg-base-200 shadow-sm border-l-4 ' + borderCls + '">';
          html += '<div class="card-body gap-2">';
          html += '<div class="font-semibold text-sm">' + db.name + '</div>';
          html += '<div class="flex items-center gap-2">';
          if (isOk) {
            html += '<span class="badge badge-sm badge-success">connected</span>';
          } else {
            html += '<span class="badge badge-sm badge-error">error</span>';
          }
          html += '</div>';
          html += '<div class="text-2xl font-bold ' + textCls + '">' + db.latency_ms + '<span class="text-xs font-normal text-base-content/50 ml-1">ms</span></div>';
          html += '<div class="text-xs text-base-content/50">';
          if (db.details) html += db.details + '<br>';
          if (db.pool_size) html += 'pool: ' + db.pool_size + '<br>';
          if (db.host) html += db.host;
          if (db.error) html += '<br><span class="text-error">' + db.error + '</span>';
          html += '</div>';
          html += '</div></div>';
        }
        document.getElementById('cards').innerHTML = html;
      } catch (e) {
        document.getElementById('cards').innerHTML = '<div class="alert alert-error col-span-full"><span>Error: ' + e.message + '</span></div>';
      }
    }

    async function runBench(n) {
      var mode = document.getElementById('benchMode').value;
      var btnIds = ['benchBtn50', 'benchBtn200', 'benchBtn500'];
      btnIds.forEach(function(id) { var b = document.getElementById(id); if (b) b.disabled = true; });
      var activeBtn = document.getElementById('benchBtn' + n) || document.getElementById('benchBtn50');
      activeBtn.innerHTML = '<span class="loading loading-spinner loading-xs"></span> Running ' + mode + '...';
      try {
        var resp = await fetch('/api/bench?n=' + n + '&mode=' + mode);
        var data = await resp.json();
        var benchmarks = data.benchmarks;
        var bestAvg = Infinity;
        var bestAvgName = '';
        var bestOps = 0;
        var bestOpsName = '';
        var totalIter = 0;
        for (var i = 0; i < benchmarks.length; i++) {
          if (benchmarks[i].avg_ms < bestAvg) { bestAvg = benchmarks[i].avg_ms; bestAvgName = benchmarks[i].name; }
          if (benchmarks[i].ops_per_sec > bestOps) { bestOps = benchmarks[i].ops_per_sec; bestOpsName = benchmarks[i].name; }
          totalIter += benchmarks[i].iterations;
        }

        var html = '<div class="stats shadow w-full mb-4 bg-base-200">';
        html += '<div class="stat"><div class="stat-title">Fastest Avg</div><div class="stat-value text-lg">' + bestAvg + '<span class="text-xs font-normal text-base-content/50 ml-1">ms</span></div><div class="stat-desc">' + bestAvgName + '</div></div>';
        html += '<div class="stat"><div class="stat-title">Highest Throughput</div><div class="stat-value text-lg">' + bestOps.toLocaleString() + '</div><div class="stat-desc">' + bestOpsName + '</div></div>';
        html += '<div class="stat"><div class="stat-title">Total Queries</div><div class="stat-value text-lg">' + totalIter.toLocaleString() + '</div></div>';
        html += '</div>';

        html += '<div class="card bg-base-200 shadow-sm"><div class="card-body">';
        html += '<h2 class="card-title text-sm">Benchmark Results</h2>';
        html += '<p class="text-xs text-base-content/50 mb-4">Mode: ' + mode + ' &middot; ' + n + ' iterations per database (+ 10% warmup) &middot; ' + data.timestamp + '</p>';

        html += '<div style="height:280px" class="mb-4"><canvas id="benchCanvas"></canvas></div>';

        html += '<div class="overflow-x-auto"><table class="table table-sm table-zebra">';
        html += '<thead><tr><th>DB</th><th>Avg</th><th>P50</th><th>P95</th><th>P99</th>';
        html += '<th>&sigma;</th><th>Ops/s</th><th>Distribution</th></tr></thead><tbody>';
        for (var i = 0; i < benchmarks.length; i++) {
          var b = benchmarks[i];
          var color = DB_COLORS[b.name] || '#60a5fa';
          html += '<tr><td><span class="inline-block w-2 h-2 rounded-full mr-2" style="background:' + color + '"></span>';
          html += '<strong style="color:' + color + '">' + b.name + '</strong></td>';
          html += '<td>' + b.avg_ms + 'ms</td>';
          html += '<td>' + b.p50_ms + 'ms</td>';
          html += '<td>' + b.p95_ms + 'ms</td>';
          html += '<td>' + b.p99_ms + 'ms</td>';
          html += '<td>' + b.stddev_ms + '</td>';
          html += '<td><strong>' + b.ops_per_sec.toLocaleString() + '</strong></td>';
          html += '<td>' + sparkline(b.histogram, color) + '</td></tr>';
        }
        html += '</tbody></table></div>';
        html += '</div></div>';

        document.getElementById('benchResults').innerHTML = html;

        var canvas = document.getElementById('benchCanvas');
        if (canvas && benchmarks.length > 0) {
          if (benchChart) benchChart.destroy();
          var labels = [];
          var avgData = [];
          var bgColors = [];
          for (var i = 0; i < benchmarks.length; i++) {
            labels.push(benchmarks[i].name);
            avgData.push(benchmarks[i].avg_ms);
            bgColors.push(DB_COLORS[benchmarks[i].name] || '#60a5fa');
          }
          benchChart = new Chart(canvas, {
            type: 'bar',
            data: {
              labels: labels,
              datasets: [{
                label: 'Avg Latency (ms)',
                data: avgData,
                backgroundColor: function(ctx) {
                  return bgColors[ctx.dataIndex] + 'cc';
                },
                borderColor: 'transparent',
                borderWidth: 0,
                borderRadius: 6,
                borderSkipped: false,
                barPercentage: 0.7,
                categoryPercentage: 0.8
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: Object.assign({}, chartTooltipConfig(), {
                  callbacks: {
                    afterBody: function(items) {
                      var idx = items[0].dataIndex;
                      var b = benchmarks[idx];
                      return [
                        'P50: ' + b.p50_ms + 'ms',
                        'P95: ' + b.p95_ms + 'ms',
                        'P99: ' + b.p99_ms + 'ms',
                        'Ops/s: ' + b.ops_per_sec.toLocaleString()
                      ];
                    }
                  }
                })
              },
              scales: {
                y: {
                  beginAtZero: true,
                  grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
                  ticks: { color: '#6b7280', font: { family: 'Inter', size: 11 } },
                  title: { display: true, text: 'Latency (ms)', color: '#6b7280', font: { family: 'Inter', size: 11 } }
                },
                x: {
                  grid: { display: false },
                  ticks: { color: '#9ca3af', font: { family: 'Inter', size: 11 } }
                }
              }
            }
          });
        }
      } catch (e) {
        document.getElementById('benchResults').innerHTML = '<div class="alert alert-error"><span>Error: ' + e.message + '</span></div>';
      }
      btnIds.forEach(function(id) { var b = document.getElementById(id); if (b) b.disabled = false; });
      activeBtn.textContent = n + ' iter';
    }

    async function runStress(c, ops) {
      var btns = document.querySelectorAll('#tab-stress button');
      btns.forEach(function(b) { b.disabled = true; });
      document.getElementById('stressResults').innerHTML = '<div class="flex flex-col items-center justify-center py-12"><span class="loading loading-spinner loading-md"></span><p class="text-base-content/60 mt-4 text-sm">Running stress test: ' + c + ' concurrent workers x ' + ops + ' operations each...</p></div>';
      try {
        var resp = await fetch('/api/stress?c=' + c + '&ops=' + ops);
        var data = await resp.json();
        var results = data.results;

        var totalOps = 0;
        var totalDuration = 0;
        var totalErrors = 0;
        for (var i = 0; i < results.length; i++) {
          totalOps += results[i].total_ops;
          totalDuration += results[i].duration_ms;
          totalErrors += results[i].errors;
        }
        var errRate = totalOps > 0 ? ((totalErrors / totalOps) * 100).toFixed(2) : '0.00';

        var html = '<div class="stats stats-vertical sm:stats-horizontal shadow w-full mb-4 bg-base-200">';
        html += '<div class="stat"><div class="stat-title">Total Operations</div><div class="stat-value text-lg">' + totalOps.toLocaleString() + '</div></div>';
        html += '<div class="stat"><div class="stat-title">Avg Duration</div><div class="stat-value text-lg">' + Math.round(totalDuration / results.length).toLocaleString() + '<span class="text-xs font-normal text-base-content/50 ml-1">ms</span></div></div>';
        html += '<div class="stat"><div class="stat-title">Error Rate</div><div class="stat-value text-lg ' + (totalErrors > 0 ? 'text-error' : 'text-success') + '">' + errRate + '%</div></div>';
        html += '</div>';

        html += '<div class="card bg-base-200 shadow-sm"><div class="card-body">';
        html += '<h2 class="card-title text-sm">Stress Test Results</h2>';
        html += '<p class="text-xs text-base-content/50 mb-4">' + c + ' concurrent workers x ' + data.ops_per_worker + ' ops each &middot; ' + data.timestamp + '</p>';

        html += '<div style="height:200px" class="mb-4"><canvas id="stressCanvas"></canvas></div>';

        html += '<div class="overflow-x-auto"><table class="table table-sm">';
        html += '<thead><tr><th>Database</th><th>Total Ops</th><th>Success</th><th>Errors</th><th>Avg</th><th>P99</th><th>Duration</th><th>Ops/s</th><th>Success Rate</th></tr></thead><tbody>';
        for (var i = 0; i < results.length; i++) {
          var r = results[i];
          var pct = r.total_ops ? (r.success / r.total_ops * 100) : 0;
          var color = DB_COLORS[r.name] || '#60a5fa';
          html += '<tr>';
          html += '<td><span class="inline-block w-2 h-2 rounded-full mr-2" style="background:' + color + '"></span>';
          html += '<strong style="color:' + color + '">' + r.name + '</strong></td>';
          html += '<td>' + r.total_ops.toLocaleString() + '</td>';
          html += '<td class="text-success">' + r.success.toLocaleString() + '</td>';
          html += '<td class="' + (r.errors ? 'text-error' : 'text-base-content/40') + '">' + r.errors + '</td>';
          html += '<td>' + r.avg_ms + 'ms</td>';
          html += '<td>' + r.p99_ms + 'ms</td>';
          html += '<td>' + r.duration_ms + 'ms</td>';
          html += '<td><strong>' + r.ops_per_sec.toLocaleString() + '</strong></td>';
          html += '<td><progress class="progress progress-success w-20" value="' + pct.toFixed(1) + '" max="100"></progress>';
          html += ' <span class="text-xs text-base-content/50">' + pct.toFixed(1) + '%</span></td></tr>';
        }
        html += '</tbody></table></div>';
        html += '</div></div>';

        document.getElementById('stressResults').innerHTML = html;

        var canvas = document.getElementById('stressCanvas');
        if (canvas && results.length > 0) {
          if (stressChart) stressChart.destroy();
          var labels = [];
          var opsData = [];
          var bgColors = [];
          for (var i = 0; i < results.length; i++) {
            labels.push(results[i].name);
            opsData.push(results[i].ops_per_sec);
            bgColors.push((DB_COLORS[results[i].name] || '#60a5fa') + 'cc');
          }
          stressChart = new Chart(canvas, {
            type: 'bar',
            data: {
              labels: labels,
              datasets: [{
                label: 'Ops/sec',
                data: opsData,
                backgroundColor: bgColors,
                borderColor: 'transparent',
                borderWidth: 0,
                borderRadius: 6,
                borderSkipped: false,
                barPercentage: 0.7,
                categoryPercentage: 0.8
              }]
            },
            options: {
              indexAxis: 'y',
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: { display: false },
                tooltip: chartTooltipConfig()
              },
              scales: {
                x: {
                  beginAtZero: true,
                  grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
                  ticks: { color: '#6b7280', font: { family: 'Inter', size: 11 } },
                  title: { display: true, text: 'Operations / second', color: '#6b7280', font: { family: 'Inter', size: 11 } }
                },
                y: {
                  grid: { display: false },
                  ticks: { color: '#9ca3af', font: { family: 'Inter', size: 11 } }
                }
              }
            }
          });
        }
      } catch (e) {
        document.getElementById('stressResults').innerHTML = '<div class="alert alert-error"><span>Error: ' + e.message + '</span></div>';
      }
      btns.forEach(function(b) { b.disabled = false; });
    }

    async function loadHistory() {
      try {
        var resp = await fetch('/api/history');
        var runs = await resp.json();
        if (!runs.length) {
          document.getElementById('historyChart').style.display = 'none';
          document.getElementById('historyTable').innerHTML = '<div class="alert justify-center my-8"><span>No runs recorded yet. Run a benchmark to get started.</span></div>';
          return;
        }

        document.getElementById('historyChart').style.display = '';
        buildTrendChart(runs);

        var html = '<div class="card bg-base-200 shadow-sm"><div class="card-body">';
        html += '<div class="flex justify-between items-center mb-4">';
        html += '<div><h2 class="card-title text-sm">Run History</h2><p class="text-xs text-base-content/50">' + runs.length + ' runs recorded</p></div>';
        html += '<button class="btn btn-sm btn-ghost btn-error" onclick="clearAllHistory()">Clear History</button></div>';
        html += '<div class="overflow-x-auto"><table class="table table-sm">';
        html += '<thead><tr><th>#</th><th>Type</th><th>Mode</th><th>Timestamp</th><th>Summary</th></tr></thead><tbody>';
        for (var i = 0; i < runs.length; i++) {
          var r = runs[i];
          var summary = '';
          if (r.type === 'bench' && r.data.benchmarks) {
            var names = [];
            for (var j = 0; j < r.data.benchmarks.length; j++) {
              names.push(r.data.benchmarks[j].name + ' ' + r.data.benchmarks[j].ops_per_sec + ' ops/s');
            }
            summary = names.join(', ');
          } else if (r.type === 'stress' && r.data.results) {
            var names = [];
            for (var j = 0; j < r.data.results.length; j++) {
              names.push(r.data.results[j].name + ' ' + r.data.results[j].ops_per_sec + ' ops/s');
            }
            summary = names.join(', ');
          }
          html += '<tr class="cursor-pointer hover" onclick="toggleRunDetail(' + r.id + ', this)">';
          html += '<td>' + r.id + '</td>';
          html += '<td>';
          if (r.type === 'bench') {
            html += '<span class="badge badge-sm badge-info">' + r.type + '</span>';
          } else {
            html += '<span class="badge badge-sm badge-warning">' + r.type + '</span>';
          }
          html += '</td>';
          html += '<td>' + r.mode + '</td>';
          html += '<td class="text-xs text-base-content/50">' + formatTimestamp(r.timestamp) + '</td>';
          html += '<td class="text-xs max-w-[350px] overflow-hidden text-ellipsis whitespace-nowrap text-base-content/60">' + summary + '</td></tr>';
          html += '<tr class="detail-row" id="detail-' + r.id + '" style="display:none"><td colspan="5"></td></tr>';
        }
        html += '</tbody></table></div>';
        html += '</div></div>';
        document.getElementById('historyTable').innerHTML = html;
        document.getElementById('historyDetail').innerHTML = '';
        expandedRunId = null;
      } catch (e) {
        document.getElementById('historyTable').innerHTML = '<div class="alert alert-error"><span>Error: ' + e.message + '</span></div>';
      }
    }

    function formatTimestamp(ts) {
      try {
        var d = new Date(ts);
        var now = new Date();
        var hours = String(d.getHours()).length < 2 ? '0' + d.getHours() : String(d.getHours());
        var mins = String(d.getMinutes()).length < 2 ? '0' + d.getMinutes() : String(d.getMinutes());
        if (d.toDateString() === now.toDateString()) return hours + ':' + mins;
        var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        return months[d.getMonth()] + ' ' + d.getDate() + ' ' + hours + ':' + mins;
      } catch (e) { return ts; }
    }

    function buildTrendChart(runs) {
      var canvas = document.getElementById('trendCanvas');
      if (!canvas) return;
      if (trendChart) trendChart.destroy();

      var dbNames = ['PostgreSQL', 'MySQL', 'MariaDB', 'Redis'];
      var series = {};
      for (var d = 0; d < dbNames.length; d++) {
        series[dbNames[d]] = [];
      }
      var labels = [];

      var chronological = runs.slice().reverse();
      for (var i = 0; i < chronological.length; i++) {
        var r = chronological[i];
        labels.push(formatTimestamp(r.timestamp));
        var items = r.type === 'bench' ? (r.data.benchmarks || []) : (r.data.results || []);
        var found = {};
        for (var j = 0; j < items.length; j++) {
          found[items[j].name] = items[j].ops_per_sec;
        }
        for (var d = 0; d < dbNames.length; d++) {
          series[dbNames[d]].push(found[dbNames[d]] !== undefined ? found[dbNames[d]] : null);
        }
      }

      var datasets = [];
      for (var d = 0; d < dbNames.length; d++) {
        var name = dbNames[d];
        var hasData = false;
        for (var k = 0; k < series[name].length; k++) {
          if (series[name][k] !== null) { hasData = true; break; }
        }
        if (!hasData) continue;
        datasets.push({
          label: name,
          data: series[name],
          borderColor: DB_COLORS[name],
          backgroundColor: DB_COLORS[name] + '1a',
          tension: 0.3,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: DB_COLORS[name],
          spanGaps: true,
          fill: true,
          borderWidth: 2
        });
      }

      trendChart = new Chart(canvas, {
        type: 'line',
        data: { labels: labels, datasets: datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: {
              labels: { color: '#9ca3af', usePointStyle: true, pointStyle: 'circle', font: { family: 'Inter', size: 11 }, padding: 16 }
            },
            tooltip: chartTooltipConfig()
          },
          scales: {
            y: {
              beginAtZero: true,
              grid: { color: 'rgba(255,255,255,0.04)', drawBorder: false },
              ticks: { color: '#6b7280', font: { family: 'Inter', size: 11 } },
              title: { display: true, text: 'Ops/sec', color: '#6b7280', font: { family: 'Inter', size: 11 } }
            },
            x: {
              grid: { color: 'rgba(255,255,255,0.02)', drawBorder: false },
              ticks: { color: '#6b7280', maxRotation: 45, font: { family: 'Inter', size: 10 } }
            }
          }
        }
      });
    }

    async function toggleRunDetail(id, rowEl) {
      var detailRow = document.getElementById('detail-' + id);
      if (!detailRow) return;
      if (expandedRunId === id) {
        detailRow.style.display = 'none';
        expandedRunId = null;
        return;
      }
      if (expandedRunId !== null) {
        var prev = document.getElementById('detail-' + expandedRunId);
        if (prev) prev.style.display = 'none';
      }
      expandedRunId = id;
      var cell = detailRow.querySelector('td');
      cell.innerHTML = '<div class="flex justify-center py-4"><span class="loading loading-spinner loading-sm"></span></div>';
      detailRow.style.display = '';
      try {
        var resp = await fetch('/api/history/' + id);
        var run = await resp.json();
        var html = '<div class="bg-base-300 rounded-lg p-4 my-2">';
        html += '<div class="mb-3">';
        if (run.type === 'bench') {
          html += '<span class="badge badge-sm badge-info mr-2">' + run.type + '</span>';
        } else {
          html += '<span class="badge badge-sm badge-warning mr-2">' + run.type + '</span>';
        }
        html += '<span class="text-xs text-base-content/50">Mode: ' + run.mode + ' &middot; ' + run.timestamp + '</span></div>';

        if (run.type === 'bench' && run.data.benchmarks) {
          var benchmarks = run.data.benchmarks;
          html += '<div class="overflow-x-auto"><table class="table table-sm">';
          html += '<thead><tr><th>Database</th><th>Avg</th><th>P50</th><th>P95</th><th>P99</th><th>Stddev</th><th>Ops/s</th><th>Iterations</th></tr></thead><tbody>';
          for (var i = 0; i < benchmarks.length; i++) {
            var b = benchmarks[i];
            html += '<tr><td><strong style="color:' + (DB_COLORS[b.name] || '#60a5fa') + '">' + b.name + '</strong></td>';
            html += '<td>' + b.avg_ms + 'ms</td><td>' + b.p50_ms + 'ms</td><td>' + b.p95_ms + 'ms</td>';
            html += '<td>' + b.p99_ms + 'ms</td><td>' + b.stddev_ms + '</td>';
            html += '<td><strong>' + b.ops_per_sec.toLocaleString() + '</strong></td>';
            html += '<td>' + b.iterations + '</td></tr>';
          }
          html += '</tbody></table></div>';
        } else if (run.type === 'stress' && run.data.results) {
          var results = run.data.results;
          html += '<div class="overflow-x-auto"><table class="table table-sm">';
          html += '<thead><tr><th>Database</th><th>Total Ops</th><th>Success</th><th>Errors</th><th>Avg</th><th>P99</th><th>Ops/s</th></tr></thead><tbody>';
          for (var i = 0; i < results.length; i++) {
            var r = results[i];
            html += '<tr><td><strong style="color:' + (DB_COLORS[r.name] || '#60a5fa') + '">' + r.name + '</strong></td>';
            html += '<td>' + r.total_ops + '</td>';
            html += '<td class="text-success">' + r.success + '</td>';
            html += '<td class="' + (r.errors ? 'text-error' : 'text-base-content/40') + '">' + r.errors + '</td>';
            html += '<td>' + r.avg_ms + 'ms</td><td>' + r.p99_ms + 'ms</td>';
            html += '<td><strong>' + r.ops_per_sec.toLocaleString() + '</strong></td></tr>';
          }
          html += '</tbody></table></div>';
        }

        html += '</div>';
        cell.innerHTML = html;
      } catch (e) {
        cell.innerHTML = '<div class="alert alert-error my-2"><span>Error: ' + e.message + '</span></div>';
      }
    }

    async function clearAllHistory() {
      if (!confirm('Clear all history?')) return;
      await fetch('/api/history', { method: 'DELETE' });
      loadHistory();
    }

    runTest();
  <\/script>
</body>
</html>`;
}

console.log("Discovery showcase listening on http://localhost:" + server.port);
