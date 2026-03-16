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
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Database Discovery | myserver</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"><\/script>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif; background: #f7f8fa; color: #1f2937; line-height: 1.5; -webkit-font-smoothing: antialiased; }
    .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
    .grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
    .card { background: #fff; border-radius: 16px; border: 1px solid #e5e7eb; box-shadow: 0 1px 3px rgba(0,0,0,0.04); padding: 20px; }
    .card-bordered { border-left: 3px solid #e5e7eb; }
    .card-pg { border-left-color: #4F7BEF; }
    .card-mysql { border-left-color: #00A7D0; }
    .card-mariadb { border-left-color: #C4784F; }
    .card-redis { border-left-color: #E84D3D; }
    .btn { display: inline-flex; align-items: center; justify-content: center; padding: 8px 16px; border-radius: 8px; border: 1px solid #e5e7eb; background: #fff; color: #1f2937; font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s ease; font-family: inherit; }
    .btn:hover { background: #f3f4f6; border-color: #d1d5db; }
    .btn:active { transform: scale(0.97); }
    .btn-primary { background: #4F7BEF; color: #fff; border-color: #4F7BEF; }
    .btn-primary:hover { background: #3b65d9; border-color: #3b65d9; }
    .btn-danger { background: #fff; color: #E84D3D; border-color: #fca5a5; }
    .btn-danger:hover { background: #fef2f2; border-color: #E84D3D; }
    .btn-sm { padding: 5px 10px; font-size: 12px; }
    .btn-group { display: flex; gap: 6px; flex-wrap: wrap; }
    .tab-bar { display: flex; border-bottom: 2px solid #e5e7eb; margin-bottom: 24px; gap: 0; }
    .tab { padding: 10px 20px; font-size: 14px; font-weight: 500; color: #6b7280; cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.15s ease; background: none; border-top: none; border-left: none; border-right: none; font-family: inherit; }
    .tab:hover { color: #1f2937; }
    .tab-active { color: #4F7BEF; border-bottom-color: #4F7BEF; }
    .badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; }
    .badge-blue { background: #eff6ff; color: #2563eb; }
    .badge-green { background: #f0fdf4; color: #16a34a; }
    .badge-orange { background: #fff7ed; color: #ea580c; }
    .badge-red { background: #fef2f2; color: #dc2626; }
    .badge-gray { background: #f3f4f6; color: #6b7280; }
    .stat-card { text-align: center; }
    .stat-value { font-size: 28px; font-weight: 700; color: #1f2937; line-height: 1.2; }
    .stat-label { font-size: 12px; color: #9ca3af; font-weight: 500; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
    .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 10px 12px; font-weight: 600; color: #6b7280; font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #e5e7eb; }
    td { padding: 10px 12px; border-bottom: 1px solid #f3f4f6; }
    tr:last-child td { border-bottom: none; }
    .text-secondary { color: #6b7280; }
    .text-muted { color: #9ca3af; }
    .text-sm { font-size: 13px; }
    .text-xs { font-size: 11px; }
    .mono { font-family: "SF Mono", "Cascadia Code", "Fira Code", monospace; }
    .hidden { display: none !important; }
    .mb-16 { margin-bottom: 16px; }
    .mb-20 { margin-bottom: 20px; }
    .mb-24 { margin-bottom: 24px; }
    .mt-16 { margin-top: 16px; }
    .mt-24 { margin-top: 24px; }
    .flex { display: flex; }
    .flex-wrap { flex-wrap: wrap; }
    .items-center { align-items: center; }
    .justify-between { justify-content: space-between; }
    .gap-8 { gap: 8px; }
    .gap-12 { gap: 12px; }
    .gap-16 { gap: 16px; }
    .skeleton { background: linear-gradient(90deg, #f3f4f6 25%, #e5e7eb 50%, #f3f4f6 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 8px; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .spinner { width: 20px; height: 20px; border: 2px solid #e5e7eb; border-top-color: #4F7BEF; border-radius: 50%; animation: spin 0.6s linear infinite; display: inline-block; vertical-align: middle; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .header { padding: 24px 0; }
    .logo { width: 36px; height: 36px; background: #4F7BEF; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 16px; flex-shrink: 0; }
    .header-title { font-size: 20px; font-weight: 700; }
    .header-sub { font-size: 13px; color: #6b7280; }
    .pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 500; background: #f3f4f6; color: #6b7280; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
    .status-ok { background: #22c55e; }
    .status-err { background: #ef4444; }
    .sparkline { display: inline-flex; align-items: flex-end; gap: 1px; height: 20px; }
    .sparkline-bar { width: 3px; background: #4F7BEF; border-radius: 1px; min-height: 2px; }
    .progress-bar { height: 6px; border-radius: 3px; background: #f3f4f6; overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 3px; transition: width 0.3s ease; }
    .expand-row { cursor: pointer; }
    .expand-row:hover { background: #fafafa; }
    .expand-detail { background: #fafafa; }
    .chart-container { position: relative; height: 300px; }
    select { font-family: inherit; font-size: 13px; padding: 7px 28px 7px 10px; border-radius: 8px; border: 1px solid #e5e7eb; background: #fff; -webkit-appearance: none; appearance: none; color: #1f2937; cursor: pointer; }
    select:hover { border-color: #d1d5db; }
    .empty-state { text-align: center; padding: 60px 20px; color: #9ca3af; }
    .empty-state-title { font-size: 16px; font-weight: 600; color: #6b7280; margin-bottom: 4px; }
    @media (max-width: 1024px) { .grid-4 { grid-template-columns: repeat(2, 1fr); } }
    @media (max-width: 768px) { .grid-4, .grid-3, .grid-2 { grid-template-columns: 1fr; } .tab { padding: 8px 14px; font-size: 13px; } .container { padding: 0 16px; } .header { padding: 16px 0; } }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="flex items-center gap-16 justify-between">
        <div class="flex items-center gap-12">
          <div class="logo">M</div>
          <div>
            <div class="header-title">myserver</div>
            <div class="header-sub">Database Discovery &amp; Performance</div>
          </div>
        </div>
        <div class="flex items-center gap-8 flex-wrap">
          <span class="pill">Bun ${Bun.version}</span>
          <span class="pill">${process.platform}/${process.arch}</span>
          <span class="pill">PID ${process.pid}</span>
        </div>
      </div>
    </div>

    <div class="tab-bar">
      <button class="tab tab-active" onclick="switchTab('connections')">Connections</button>
      <button class="tab" onclick="switchTab('benchmark')">Benchmark</button>
      <button class="tab" onclick="switchTab('stress')">Stress Test</button>
      <button class="tab" onclick="switchTab('history')">History</button>
    </div>

    <!-- Connections Tab -->
    <div id="tab-connections">
      <div class="flex items-center justify-between mb-20">
        <div class="text-secondary text-sm">Auto-testing database connections...</div>
        <button class="btn btn-sm" onclick="testConnections()">Retest</button>
      </div>
      <div id="cards" class="grid-4">
        <div class="card skeleton" style="height:160px"></div>
        <div class="card skeleton" style="height:160px"></div>
        <div class="card skeleton" style="height:160px"></div>
        <div class="card skeleton" style="height:160px"></div>
      </div>
    </div>

    <!-- Benchmark Tab -->
    <div id="tab-benchmark" class="hidden">
      <div class="flex items-center justify-between mb-20 flex-wrap gap-12">
        <div class="flex items-center gap-8 flex-wrap">
          <select id="bench-mode">
            <option value="ping">Ping (SELECT 1)</option>
            <option value="write">Write (INSERT)</option>
            <option value="read_write">Read/Write Mix</option>
            <option value="transaction">Transaction</option>
            <option value="complex">Complex (CTE)</option>
          </select>
          <div class="btn-group">
            <button class="btn btn-sm" onclick="runBench(50)">50x</button>
            <button class="btn btn-sm" onclick="runBench(100)">100x</button>
            <button class="btn btn-sm" onclick="runBench(200)">200x</button>
            <button class="btn btn-sm" onclick="runBench(500)">500x</button>
          </div>
        </div>
        <div id="bench-status" class="text-muted text-sm"></div>
      </div>
      <div id="bench-stats" class="grid-4 mb-24 hidden"></div>
      <div id="bench-chart-wrap" class="card mb-24 hidden">
        <div class="chart-container"><canvas id="bench-chart"></canvas></div>
      </div>
      <div id="bench-table-wrap" class="card hidden">
        <div class="table-wrap"><table id="bench-table"></table></div>
      </div>
    </div>

    <!-- Stress Tab -->
    <div id="tab-stress" class="hidden">
      <div class="flex items-center justify-between mb-20 flex-wrap gap-12">
        <div class="btn-group">
          <button class="btn btn-sm" onclick="runStress(5, 20)">Light (5x20)</button>
          <button class="btn btn-sm" onclick="runStress(10, 20)">Medium (10x20)</button>
          <button class="btn btn-sm" onclick="runStress(20, 30)">Heavy (20x30)</button>
          <button class="btn btn-sm" onclick="runStress(50, 20)">Extreme (50x20)</button>
        </div>
        <div id="stress-status" class="text-muted text-sm"></div>
      </div>
      <div id="stress-stats" class="grid-4 mb-24 hidden"></div>
      <div id="stress-chart-wrap" class="card mb-24 hidden">
        <div class="chart-container"><canvas id="stress-chart"></canvas></div>
      </div>
      <div id="stress-table-wrap" class="card hidden">
        <div class="table-wrap"><table id="stress-table"></table></div>
      </div>
    </div>

    <!-- History Tab -->
    <div id="tab-history" class="hidden">
      <div class="flex items-center justify-between mb-20">
        <div class="text-secondary text-sm" id="history-count"></div>
        <button class="btn btn-danger btn-sm" onclick="clearHist()">Clear History</button>
      </div>
      <div id="history-chart-wrap" class="card mb-24 hidden">
        <div class="chart-container"><canvas id="history-chart"></canvas></div>
      </div>
      <div id="history-table-wrap" class="card">
        <div class="table-wrap"><table id="history-table"></table></div>
      </div>
      <div id="history-empty" class="card hidden">
        <div class="empty-state">
          <div class="empty-state-title">No history yet</div>
          <div class="text-muted text-sm">Run benchmarks or stress tests to see results here.</div>
        </div>
      </div>
    </div>
  </div>

  <div style="height:40px"></div>

  <script>
    var DB_COLORS = { 'PostgreSQL': '#4F7BEF', 'MySQL': '#00A7D0', 'MariaDB': '#C4784F', 'Redis': '#E84D3D' };
    var DB_CLASS = { 'PostgreSQL': 'card-pg', 'MySQL': 'card-mysql', 'MariaDB': 'card-mariadb', 'Redis': 'card-redis' };
    var benchChart = null;
    var stressChart = null;
    var historyChart = null;

    function switchTab(name) {
      var tabs = ['connections', 'benchmark', 'stress', 'history'];
      var buttons = document.querySelectorAll('.tab');
      for (var i = 0; i < tabs.length; i++) {
        var el = document.getElementById('tab-' + tabs[i]);
        if (tabs[i] === name) {
          el.classList.remove('hidden');
          buttons[i].classList.add('tab-active');
        } else {
          el.classList.add('hidden');
          buttons[i].classList.remove('tab-active');
        }
      }
      if (name === 'history') { loadHistory(); }
    }

    function makeSparkline(hist) {
      if (!hist || !hist.length) return '';
      var max = Math.max.apply(null, hist);
      if (max === 0) return '';
      var html = '<span class="sparkline">';
      for (var i = 0; i < hist.length; i++) {
        var h = Math.max(2, Math.round((hist[i] / max) * 20));
        html += '<span class="sparkline-bar" style="height:' + h + 'px"></span>';
      }
      html += '</span>';
      return html;
    }

    function makeProgressBar(pct, color) {
      return '<div class="progress-bar" style="width:100px;display:inline-block;vertical-align:middle"><div class="progress-fill" style="width:' + Math.min(100, pct) + '%;background:' + color + '"></div></div>';
    }

    function testConnections() {
      var cards = document.getElementById('cards');
      cards.innerHTML = '<div class="card skeleton" style="height:160px"></div><div class="card skeleton" style="height:160px"></div><div class="card skeleton" style="height:160px"></div><div class="card skeleton" style="height:160px"></div>';
      fetch('/api/test').then(function(r) { return r.json(); }).then(function(data) {
        var html = '';
        for (var i = 0; i < data.databases.length; i++) {
          var db = data.databases[i];
          var cls = DB_CLASS[db.name] || '';
          var color = DB_COLORS[db.name] || '#6b7280';
          var isOk = db.status === 'connected';
          html += '<div class="card card-bordered ' + cls + '">' +
            '<div class="flex items-center justify-between mb-16">' +
              '<div class="flex items-center gap-8">' +
                '<span class="status-dot ' + (isOk ? 'status-ok' : 'status-err') + '"></span>' +
                '<span style="font-weight:600;font-size:15px">' + db.name + '</span>' +
              '</div>' +
              '<span class="badge ' + (isOk ? 'badge-green' : 'badge-red') + '">' + db.status + '</span>' +
            '</div>';
          if (isOk) {
            html += '<div style="font-size:32px;font-weight:700;color:' + color + '">' + db.latency_ms + '<span style="font-size:14px;font-weight:500;color:#9ca3af"> ms</span></div>' +
              '<div class="text-xs text-muted mt-16" style="word-break:break-all">' + (db.details || '') + '</div>';
            if (db.pool_size !== undefined) {
              html += '<div class="text-xs text-muted" style="margin-top:4px">Pool: ' + db.pool_size + ' connections</div>';
            }
          } else {
            html += '<div class="text-sm" style="color:#E84D3D;margin-top:8px;word-break:break-all">' + (db.error || 'Connection failed') + '</div>';
          }
          html += '</div>';
        }
        cards.innerHTML = html;
      }).catch(function(err) {
        cards.innerHTML = '<div class="card" style="grid-column:1/-1;color:#E84D3D">Error: ' + err.message + '</div>';
      });
    }

    function runBench(n) {
      var mode = document.getElementById('bench-mode').value;
      var status = document.getElementById('bench-status');
      status.innerHTML = '<span class="spinner"></span> Running ' + n + 'x ' + mode + '...';
      document.getElementById('bench-stats').classList.add('hidden');
      document.getElementById('bench-chart-wrap').classList.add('hidden');
      document.getElementById('bench-table-wrap').classList.add('hidden');

      fetch('/api/bench?n=' + n + '&mode=' + mode).then(function(r) { return r.json(); }).then(function(data) {
        status.textContent = 'Completed ' + data.iterations + ' iterations (' + mode + ')';
        var benchmarks = data.benchmarks;
        if (!benchmarks || !benchmarks.length) {
          status.textContent = 'No connected databases to benchmark.';
          return;
        }

        var statsEl = document.getElementById('bench-stats');
        var fastest = benchmarks.slice().sort(function(a, b) { return a.avg_ms - b.avg_ms; })[0];
        var totalOps = 0;
        for (var i = 0; i < benchmarks.length; i++) totalOps += benchmarks[i].ops_per_sec;
        statsEl.innerHTML =
          '<div class="card stat-card"><div class="stat-value">' + benchmarks.length + '</div><div class="stat-label">Databases</div></div>' +
          '<div class="card stat-card"><div class="stat-value">' + fastest.name + '</div><div class="stat-label">Fastest</div></div>' +
          '<div class="card stat-card"><div class="stat-value">' + fastest.avg_ms + ' <span style="font-size:14px;color:#9ca3af">ms</span></div><div class="stat-label">Best Avg Latency</div></div>' +
          '<div class="card stat-card"><div class="stat-value">' + Math.round(totalOps).toLocaleString() + '</div><div class="stat-label">Total ops/sec</div></div>';
        statsEl.classList.remove('hidden');

        renderBenchChart(benchmarks);
        document.getElementById('bench-chart-wrap').classList.remove('hidden');

        var tbl = '<thead><tr><th>Database</th><th>Avg</th><th>P50</th><th>P95</th><th>P99</th><th>Min</th><th>Max</th><th>Stddev</th><th>Ops/s</th><th>Distribution</th></tr></thead><tbody>';
        for (var i = 0; i < benchmarks.length; i++) {
          var b = benchmarks[i];
          var color = DB_COLORS[b.name] || '#6b7280';
          tbl += '<tr>' +
            '<td><span style="color:' + color + ';font-weight:600">' + b.name + '</span></td>' +
            '<td class="mono">' + b.avg_ms + 'ms</td>' +
            '<td class="mono">' + b.p50_ms + 'ms</td>' +
            '<td class="mono">' + b.p95_ms + 'ms</td>' +
            '<td class="mono">' + b.p99_ms + 'ms</td>' +
            '<td class="mono">' + b.min_ms + 'ms</td>' +
            '<td class="mono">' + b.max_ms + 'ms</td>' +
            '<td class="mono">' + b.stddev_ms + 'ms</td>' +
            '<td class="mono" style="font-weight:600">' + Math.round(b.ops_per_sec).toLocaleString() + '</td>' +
            '<td>' + makeSparkline(b.histogram) + '</td>' +
          '</tr>';
        }
        tbl += '</tbody>';
        document.getElementById('bench-table').innerHTML = tbl;
        document.getElementById('bench-table-wrap').classList.remove('hidden');
      }).catch(function(err) {
        status.textContent = 'Error: ' + err.message;
      });
    }

    function renderBenchChart(benchmarks) {
      var ctx = document.getElementById('bench-chart').getContext('2d');
      if (benchChart) benchChart.destroy();
      var labels = [];
      var avgData = [];
      var p95Data = [];
      var p99Data = [];
      var colors = [];
      for (var i = 0; i < benchmarks.length; i++) {
        labels.push(benchmarks[i].name);
        avgData.push(benchmarks[i].avg_ms);
        p95Data.push(benchmarks[i].p95_ms);
        p99Data.push(benchmarks[i].p99_ms);
        colors.push(DB_COLORS[benchmarks[i].name] || '#6b7280');
      }
      benchChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [
            { label: 'Avg (ms)', data: avgData, backgroundColor: colors, borderRadius: 6 },
            { label: 'P95 (ms)', data: p95Data, backgroundColor: colors.map(function(c) { return c + '88'; }), borderRadius: 6 },
            { label: 'P99 (ms)', data: p99Data, backgroundColor: colors.map(function(c) { return c + '44'; }), borderRadius: 6 }
          ]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, font: { family: 'Inter', size: 12 } } } },
          scales: { y: { beginAtZero: true, title: { display: true, text: 'Latency (ms)', font: { family: 'Inter' } }, grid: { color: '#f3f4f6' } }, x: { grid: { display: false } } }
        }
      });
    }

    function runStress(c, ops) {
      var status = document.getElementById('stress-status');
      status.innerHTML = '<span class="spinner"></span> Running stress test (' + c + ' workers x ' + ops + ' ops)...';
      document.getElementById('stress-stats').classList.add('hidden');
      document.getElementById('stress-chart-wrap').classList.add('hidden');
      document.getElementById('stress-table-wrap').classList.add('hidden');

      fetch('/api/stress?c=' + c + '&ops=' + ops).then(function(r) { return r.json(); }).then(function(data) {
        var results = data.results;
        if (!results || !results.length) {
          status.textContent = 'No connected databases to stress test.';
          return;
        }
        status.textContent = 'Completed: ' + data.concurrency + ' workers x ' + data.ops_per_worker + ' ops';

        var totalOps = 0; var totalSuccess = 0; var totalErrors = 0;
        for (var i = 0; i < results.length; i++) {
          totalOps += results[i].total_ops;
          totalSuccess += results[i].success;
          totalErrors += results[i].errors;
        }
        var statsEl = document.getElementById('stress-stats');
        statsEl.innerHTML =
          '<div class="card stat-card"><div class="stat-value">' + totalOps + '</div><div class="stat-label">Total Operations</div></div>' +
          '<div class="card stat-card"><div class="stat-value" style="color:#22c55e">' + totalSuccess + '</div><div class="stat-label">Successful</div></div>' +
          '<div class="card stat-card"><div class="stat-value" style="color:' + (totalErrors > 0 ? '#E84D3D' : '#22c55e') + '">' + totalErrors + '</div><div class="stat-label">Errors</div></div>' +
          '<div class="card stat-card"><div class="stat-value">' + data.concurrency + '</div><div class="stat-label">Concurrency</div></div>';
        statsEl.classList.remove('hidden');

        renderStressChart(results);
        document.getElementById('stress-chart-wrap').classList.remove('hidden');

        var tbl = '<thead><tr><th>Database</th><th>Total</th><th>Success</th><th>Errors</th><th>Avg</th><th>P99</th><th>Ops/s</th><th>Duration</th><th>Success Rate</th></tr></thead><tbody>';
        for (var i = 0; i < results.length; i++) {
          var r = results[i];
          var color = DB_COLORS[r.name] || '#6b7280';
          var pct = r.total_ops > 0 ? Math.round((r.success / r.total_ops) * 100) : 0;
          tbl += '<tr>' +
            '<td><span style="color:' + color + ';font-weight:600">' + r.name + '</span></td>' +
            '<td class="mono">' + r.total_ops + '</td>' +
            '<td class="mono" style="color:#22c55e">' + r.success + '</td>' +
            '<td class="mono" style="color:' + (r.errors > 0 ? '#E84D3D' : '#22c55e') + '">' + r.errors + '</td>' +
            '<td class="mono">' + r.avg_ms + 'ms</td>' +
            '<td class="mono">' + r.p99_ms + 'ms</td>' +
            '<td class="mono" style="font-weight:600">' + Math.round(r.ops_per_sec).toLocaleString() + '</td>' +
            '<td class="mono">' + (r.duration_ms / 1000).toFixed(1) + 's</td>' +
            '<td>' + makeProgressBar(pct, color) + ' <span class="text-xs mono">' + pct + '%</span></td>' +
          '</tr>';
        }
        tbl += '</tbody>';
        document.getElementById('stress-table').innerHTML = tbl;
        document.getElementById('stress-table-wrap').classList.remove('hidden');
      }).catch(function(err) {
        status.textContent = 'Error: ' + err.message;
      });
    }

    function renderStressChart(results) {
      var ctx = document.getElementById('stress-chart').getContext('2d');
      if (stressChart) stressChart.destroy();
      var labels = [];
      var opsData = [];
      var colors = [];
      for (var i = 0; i < results.length; i++) {
        labels.push(results[i].name);
        opsData.push(results[i].ops_per_sec);
        colors.push(DB_COLORS[results[i].name] || '#6b7280');
      }
      stressChart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: labels,
          datasets: [{ label: 'Ops/sec', data: opsData, backgroundColor: colors, borderRadius: 6 }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: { x: { beginAtZero: true, title: { display: true, text: 'Operations per second', font: { family: 'Inter' } }, grid: { color: '#f3f4f6' } }, y: { grid: { display: false } } }
        }
      });
    }

    function loadHistory() {
      fetch('/api/history').then(function(r) { return r.json(); }).then(function(rows) {
        var countEl = document.getElementById('history-count');
        var tableWrap = document.getElementById('history-table-wrap');
        var emptyEl = document.getElementById('history-empty');
        var chartWrap = document.getElementById('history-chart-wrap');

        if (!rows || !rows.length) {
          countEl.textContent = '';
          tableWrap.classList.add('hidden');
          chartWrap.classList.add('hidden');
          emptyEl.classList.remove('hidden');
          return;
        }
        emptyEl.classList.add('hidden');
        countEl.textContent = rows.length + ' runs';

        renderHistoryChart(rows);
        chartWrap.classList.remove('hidden');

        var tbl = '<thead><tr><th>#</th><th>Type</th><th>Mode</th><th>Time</th><th>Summary</th><th></th></tr></thead><tbody>';
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          var summary = '';
          if (row.type === 'bench' && row.data.benchmarks) {
            summary = row.data.benchmarks.length + ' DBs, ' + row.data.iterations + ' iterations';
          } else if (row.type === 'stress' && row.data.results) {
            summary = row.data.results.length + ' DBs, ' + row.data.concurrency + ' workers';
          }
          var badgeCls = row.type === 'bench' ? 'badge-blue' : 'badge-orange';
          var ts = new Date(row.timestamp);
          var timeStr = ts.toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'}) + ' ' + ts.toLocaleDateString([], {month: 'short', day: 'numeric'});
          tbl += '<tr class="expand-row" onclick="toggleDetail(' + row.id + ')">' +
            '<td class="mono text-muted">' + row.id + '</td>' +
            '<td><span class="badge ' + badgeCls + '">' + row.type + '</span></td>' +
            '<td>' + row.mode + '</td>' +
            '<td class="text-muted text-xs">' + timeStr + '</td>' +
            '<td class="text-sm">' + summary + '</td>' +
            '<td class="text-muted text-xs">expand</td>' +
          '</tr>' +
          '<tr class="expand-detail hidden" id="detail-' + row.id + '"><td colspan="6"><pre class="mono text-xs" style="white-space:pre-wrap;max-height:200px;overflow:auto;padding:8px;background:#f9fafb;border-radius:8px">' + JSON.stringify(row.data, null, 2) + '</pre></td></tr>';
        }
        tbl += '</tbody>';
        document.getElementById('history-table').innerHTML = tbl;
        tableWrap.classList.remove('hidden');
      });
    }

    function renderHistoryChart(rows) {
      var ctx = document.getElementById('history-chart').getContext('2d');
      if (historyChart) historyChart.destroy();
      var benchRows = rows.filter(function(r) { return r.type === 'bench'; }).reverse();
      if (benchRows.length < 2) {
        document.getElementById('history-chart-wrap').classList.add('hidden');
        return;
      }
      var labels = benchRows.map(function(r) { return '#' + r.id; });
      var datasets = {};
      for (var i = 0; i < benchRows.length; i++) {
        var bms = benchRows[i].data.benchmarks || [];
        for (var j = 0; j < bms.length; j++) {
          if (!datasets[bms[j].name]) datasets[bms[j].name] = [];
        }
      }
      for (var i = 0; i < benchRows.length; i++) {
        var bms = benchRows[i].data.benchmarks || [];
        var byName = {};
        for (var j = 0; j < bms.length; j++) byName[bms[j].name] = bms[j].avg_ms;
        for (var name in datasets) {
          datasets[name].push(byName[name] !== undefined ? byName[name] : null);
        }
      }
      var chartDatasets = [];
      for (var name in datasets) {
        chartDatasets.push({
          label: name,
          data: datasets[name],
          borderColor: DB_COLORS[name] || '#6b7280',
          backgroundColor: (DB_COLORS[name] || '#6b7280') + '22',
          fill: true,
          tension: 0.3,
          pointRadius: 3
        });
      }
      historyChart = new Chart(ctx, {
        type: 'line',
        data: { labels: labels, datasets: chartDatasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { position: 'top', labels: { usePointStyle: true, font: { family: 'Inter', size: 12 } } } },
          scales: { y: { beginAtZero: true, title: { display: true, text: 'Avg Latency (ms)', font: { family: 'Inter' } }, grid: { color: '#f3f4f6' } }, x: { grid: { display: false } } }
        }
      });
    }

    function toggleDetail(id) {
      var detail = document.getElementById('detail-' + id);
      if (detail) detail.classList.toggle('hidden');
    }

    function clearHist() {
      if (!confirm('Clear all history?')) return;
      fetch('/api/history', { method: 'DELETE' }).then(function() { loadHistory(); });
    }

    testConnections();

    window.onerror = function(msg, url, line) {
      var el = document.getElementById('cards');
      if (el) el.innerHTML = '<div class="card" style="grid-column:1/-1;color:#E84D3D;padding:16px">JS Error: ' + msg + ' at line ' + line + '</div>';
    };
  <\/script>
</body>
</html>`;
}

console.log("Discovery showcase listening on http://localhost:" + server.port);
