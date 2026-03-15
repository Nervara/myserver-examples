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
  return '<!DOCTYPE html>\n' +
'<html lang="en">\n' +
'<head>\n' +
'  <meta charset="UTF-8">\n' +
'  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
'  <title>Database Performance Observatory | myserver</title>\n' +
'  <link rel="preconnect" href="https://fonts.googleapis.com">\n' +
'  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
'  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">\n' +
'  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"><\/script>\n' +
'  <style>\n' +
'    *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }\n' +
'    :root {\n' +
'      --bg: #09090b; --card: #111113; --elevated: #18181b; --border: #1a1a1f;\n' +
'      --text: #fafafa; --secondary: #a1a1aa; --muted: #52525b;\n' +
'      --pg: #5b8def; --my: #00b4d8; --ma: #c0765a; --re: #ef4444;\n' +
'      --green: #22c55e; --red: #ef4444;\n' +
'    }\n' +
'    body { font-family: "Inter", system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; font-size: 13px; font-weight: 400; -webkit-font-smoothing: antialiased; }\n' +
'    .top-gradient { position: fixed; top: 0; left: 0; right: 0; height: 2px; background: linear-gradient(90deg, #5b8def, #8b5cf6, #ec4899); z-index: 100; }\n' +
'    .container { max-width: 1200px; margin: 0 auto; padding: 32px 24px; }\n' +
'\n' +
'    /* Header */\n' +
'    .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 32px; padding-top: 8px; }\n' +
'    .header-left h1 { font-size: 28px; font-weight: 700; letter-spacing: -0.01em; background: linear-gradient(135deg, #5b8def, #8b5cf6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }\n' +
'    .header-left .subtitle { color: var(--secondary); font-size: 13px; margin-top: 4px; }\n' +
'    .header-right { display: flex; gap: 8px; align-items: center; }\n' +
'    .pill { display: inline-flex; align-items: center; font-size: 11px; font-weight: 500; padding: 4px 10px; border-radius: 9999px; background: var(--elevated); border: 1px solid var(--muted); color: var(--secondary); letter-spacing: 0.02em; }\n' +
'\n' +
'    /* Tabs */\n' +
'    .tabs { display: flex; gap: 4px; margin-bottom: 24px; overflow-x: auto; -webkit-overflow-scrolling: touch; scrollbar-width: none; }\n' +
'    .tabs::-webkit-scrollbar { display: none; }\n' +
'    .tab { padding: 8px 16px; cursor: pointer; font-size: 13px; font-weight: 500; color: var(--secondary); border-radius: 8px; transition: all 0.15s ease; user-select: none; white-space: nowrap; display: flex; align-items: center; gap: 6px; min-height: 44px; }\n' +
'    .tab:hover { color: var(--text); background: rgba(255,255,255,0.04); }\n' +
'    .tab.active { color: var(--text); background: var(--elevated); border: 1px solid var(--border); }\n' +
'    .tab-icon { font-size: 14px; opacity: 0.7; }\n' +
'    .tab-content { display: none; animation: fadeIn 0.15s ease; }\n' +
'    .tab-content.active { display: block; }\n' +
'    @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }\n' +
'\n' +
'    /* Cards grid */\n' +
'    .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 24px; }\n' +
'    .card { background: var(--card); border-radius: 10px; padding: 20px 20px 20px 24px; border: 1px solid var(--border); border-left: 4px solid var(--border); transition: all 0.2s ease; position: relative; }\n' +
'    .card:hover { transform: translateY(-1px); border-color: rgba(255,255,255,0.06); }\n' +
'    .card.pg { border-left-color: var(--pg); } .card.pg:hover { box-shadow: 0 4px 24px rgba(91,141,239,0.05); }\n' +
'    .card.my { border-left-color: var(--my); } .card.my:hover { box-shadow: 0 4px 24px rgba(0,180,216,0.05); }\n' +
'    .card.ma { border-left-color: var(--ma); } .card.ma:hover { box-shadow: 0 4px 24px rgba(192,118,90,0.05); }\n' +
'    .card.re { border-left-color: var(--re); } .card.re:hover { box-shadow: 0 4px 24px rgba(239,68,68,0.05); }\n' +
'    .card .card-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; }\n' +
'    .card .name { font-weight: 600; font-size: 14px; letter-spacing: -0.01em; }\n' +
'    .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }\n' +
'    .status-dot.ok { background: var(--green); box-shadow: 0 0 6px rgba(34,197,94,0.4); }\n' +
'    .status-dot.err { background: var(--red); box-shadow: 0 0 6px rgba(239,68,68,0.4); }\n' +
'    .status-row { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; }\n' +
'    .status-text { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; }\n' +
'    .status-text.ok { color: var(--green); }\n' +
'    .status-text.err { color: var(--red); }\n' +
'    .card .latency { font-size: 20px; font-weight: 700; font-variant-numeric: tabular-nums; margin-bottom: 4px; }\n' +
'    .card.pg .latency { color: var(--pg); } .card.my .latency { color: var(--my); }\n' +
'    .card.ma .latency { color: var(--ma); } .card.re .latency { color: var(--re); }\n' +
'    .latency-unit { font-size: 11px; font-weight: 400; color: var(--muted); margin-left: 2px; }\n' +
'    .card .meta { font-size: 11px; color: var(--muted); line-height: 1.7; word-break: break-all; margin-top: 8px; }\n' +
'\n' +
'    /* Skeleton loading */\n' +
'    .skeleton { background: var(--card); border-radius: 10px; padding: 20px 20px 20px 24px; border: 1px solid var(--border); border-left: 4px solid var(--border); }\n' +
'    .skeleton-line { height: 12px; background: linear-gradient(90deg, var(--elevated) 25%, rgba(255,255,255,0.06) 50%, var(--elevated) 75%); background-size: 200% 100%; border-radius: 4px; animation: shimmer 1.5s infinite; margin-bottom: 10px; }\n' +
'    .skeleton-line.w40 { width: 40%; }\n' +
'    .skeleton-line.w60 { width: 60%; }\n' +
'    .skeleton-line.w80 { width: 80%; }\n' +
'    .skeleton-line.h24 { height: 24px; width: 50%; }\n' +
'    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }\n' +
'\n' +
'    /* Panel */\n' +
'    .panel { background: var(--card); border-radius: 10px; padding: 24px; border: 1px solid var(--border); margin-bottom: 16px; }\n' +
'    .panel h2 { font-size: 14px; font-weight: 600; letter-spacing: -0.01em; margin-bottom: 4px; }\n' +
'    .panel .desc { font-size: 11px; color: var(--muted); margin-bottom: 16px; letter-spacing: 0.02em; }\n' +
'\n' +
'    /* Tables */\n' +
'    .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }\n' +
'    table { width: 100%; border-collapse: collapse; font-size: 13px; }\n' +
'    th { text-align: left; color: var(--muted); font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.05em; padding: 8px 12px; border-bottom: 1px solid var(--border); }\n' +
'    td { padding: 10px 12px; font-variant-numeric: tabular-nums; }\n' +
'    tr:nth-child(even) td { background: rgba(13,13,15,0.5); }\n' +
'    tr:hover td { background: rgba(255,255,255,0.02); }\n' +
'\n' +
'    /* Stat cards */\n' +
'    .stat-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px; }\n' +
'    .stat { padding: 16px; background: var(--elevated); border-radius: 8px; border: 1px solid var(--border); }\n' +
'    .stat .val { font-size: 20px; font-weight: 700; color: var(--text); font-variant-numeric: tabular-nums; }\n' +
'    .stat .lbl { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.05em; margin-top: 4px; }\n' +
'    .stat .stat-name { font-size: 11px; color: var(--secondary); margin-top: 2px; }\n' +
'\n' +
'    /* Charts */\n' +
'    .chart-wrap { position: relative; height: 280px; margin-bottom: 20px; }\n' +
'    .chart-legend { display: flex; gap: 16px; margin-bottom: 12px; flex-wrap: wrap; }\n' +
'    .legend-item { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--secondary); }\n' +
'    .legend-dot { width: 8px; height: 8px; border-radius: 50%; }\n' +
'\n' +
'    /* Sparkline */\n' +
'    .spark { display: inline-flex; align-items: flex-end; gap: 1px; height: 22px; }\n' +
'    .spark div { width: 3px; border-radius: 1px; min-height: 2px; opacity: 0.8; }\n' +
'\n' +
'    /* Stress bar */\n' +
'    .stress-bar { display: flex; height: 4px; border-radius: 2px; overflow: hidden; width: 100%; margin-bottom: 4px; }\n' +
'    .stress-bar .ok-part { background: var(--green); }\n' +
'    .stress-bar .err-part { background: var(--red); }\n' +
'\n' +
'    /* Buttons */\n' +
'    button { background: rgba(255,255,255,0.04); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 8px 16px; cursor: pointer; font-size: 13px; font-weight: 500; transition: all 0.15s ease; font-family: "Inter", system-ui, sans-serif; min-height: 44px; }\n' +
'    button:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.1); }\n' +
'    button:active { transform: scale(0.98); }\n' +
'    button:disabled { opacity: 0.35; cursor: not-allowed; transform: none; }\n' +
'    button.primary { background: rgba(91,141,239,0.12); border-color: rgba(91,141,239,0.25); color: #93b4f6; }\n' +
'    button.primary:hover { background: rgba(91,141,239,0.2); }\n' +
'    button.ghost { background: transparent; border-color: transparent; color: var(--muted); font-size: 11px; padding: 6px 12px; min-height: auto; }\n' +
'    button.ghost:hover { color: var(--secondary); background: rgba(255,255,255,0.04); }\n' +
'\n' +
'    /* Stress presets */\n' +
'    .stress-pill { border-radius: 9999px; font-size: 13px; font-weight: 500; padding: 8px 20px; min-height: 44px; }\n' +
'    .stress-pill.light { background: var(--elevated); border-color: var(--border); }\n' +
'    .stress-pill.medium { background: #1e293b; border-color: #2a3a50; }\n' +
'    .stress-pill.heavy { background: #172554; border-color: #1e3a8a; color: #93b4f6; }\n' +
'    .stress-pill.extreme { background: #450a0a; border-color: #7f1d1d; color: #fca5a5; }\n' +
'\n' +
'    /* Actions */\n' +
'    .actions { display: flex; gap: 8px; margin-bottom: 24px; flex-wrap: wrap; align-items: center; }\n' +
'\n' +
'    /* Select */\n' +
'    select { background: var(--elevated); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; font-size: 13px; cursor: pointer; font-family: "Inter", system-ui, sans-serif; min-height: 44px; -webkit-appearance: none; appearance: none; background-image: url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'12\' height=\'12\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%2352525b\' stroke-width=\'2\'%3E%3Cpath d=\'m6 9 6 6 6-6\'/%3E%3C/svg%3E"); background-repeat: no-repeat; background-position: right 10px center; padding-right: 30px; }\n' +
'    select:focus { outline: none; border-color: var(--pg); }\n' +
'\n' +
'    /* Iteration pills */\n' +
'    .iter-pill { border-radius: 9999px; padding: 8px 16px; font-size: 13px; }\n' +
'\n' +
'    /* Spinner */\n' +
'    .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.08); border-top-color: var(--pg); border-radius: 50%; animation: spin 0.6s linear infinite; vertical-align: middle; }\n' +
'    @keyframes spin { to { transform: rotate(360deg); } }\n' +
'\n' +
'    /* History */\n' +
'    .history-row { cursor: pointer; transition: background 0.1s; }\n' +
'    .history-row:hover td { background: rgba(91,141,239,0.04); }\n' +
'    .type-badge { font-size: 11px; padding: 3px 8px; border-radius: 6px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.03em; }\n' +
'    .type-badge.bench { background: rgba(91,141,239,0.12); color: var(--pg); }\n' +
'    .type-badge.stress { background: rgba(251,146,60,0.12); color: #fb923c; }\n' +
'\n' +
'    /* Expanded detail row */\n' +
'    .detail-inline { background: var(--elevated); border-radius: 8px; padding: 16px; margin: 8px 0; border: 1px solid var(--border); }\n' +
'\n' +
'    /* Empty state */\n' +
'    .empty-state { text-align: center; padding: 48px 24px; color: var(--muted); font-size: 13px; }\n' +
'\n' +
'    /* Footer */\n' +
'    .footer { text-align: center; padding: 24px 0 8px; margin-top: 32px; }\n' +
'    .footer-text { font-size: 11px; color: var(--muted); }\n' +
'    .footer-link { color: var(--muted); text-decoration: none; font-size: 11px; margin-top: 4px; display: inline-block; }\n' +
'    .footer-link:hover { color: var(--secondary); }\n' +
'\n' +
'    /* Responsive */\n' +
'    @media (max-width: 768px) {\n' +
'      .container { padding: 24px 16px; }\n' +
'      .header { flex-direction: column; gap: 12px; }\n' +
'      .header-left h1 { font-size: 22px; }\n' +
'      .grid { grid-template-columns: repeat(2, 1fr); gap: 12px; }\n' +
'      .stat-row { grid-template-columns: repeat(2, 1fr); }\n' +
'      .chart-wrap { height: 220px; }\n' +
'      .actions { gap: 6px; }\n' +
'    }\n' +
'    @media (max-width: 480px) {\n' +
'      .grid { grid-template-columns: 1fr; }\n' +
'      .stat-row { grid-template-columns: repeat(2, 1fr); }\n' +
'      .chart-wrap { height: 200px; }\n' +
'      .header-left h1 { font-size: 22px; }\n' +
'      button, .stress-pill, .iter-pill { font-size: 12px; padding: 8px 12px; }\n' +
'    }\n' +
'  </style>\n' +
'</head>\n' +
'<body>\n' +
'  <div class="top-gradient"></div>\n' +
'  <div class="container">\n' +
'    <div class="header">\n' +
'      <div class="header-left">\n' +
'        <h1>myserver</h1>\n' +
'        <p class="subtitle">Database Performance Observatory</p>\n' +
'      </div>\n' +
'      <div class="header-right">\n' +
'        <span class="pill">Bun ' + Bun.version + '</span>\n' +
'        <span class="pill">' + process.platform + '/' + process.arch + '</span>\n' +
'      </div>\n' +
'    </div>\n' +
'\n' +
'    <div class="tabs">\n' +
'      <div class="tab active" onclick="switchTab(\'connections\')"><span class="tab-icon">&#x2B21;</span> Connections</div>\n' +
'      <div class="tab" onclick="switchTab(\'benchmark\')"><span class="tab-icon">&#x25C6;</span> Benchmark</div>\n' +
'      <div class="tab" onclick="switchTab(\'stress\')"><span class="tab-icon">&#x26A1;</span> Stress Test</div>\n' +
'      <div class="tab" onclick="switchTab(\'history\')"><span class="tab-icon">&#x25F7;</span> History</div>\n' +
'    </div>\n' +
'\n' +
'    <div id="tab-connections" class="tab-content active">\n' +
'      <div id="cards" class="grid"></div>\n' +
'    </div>\n' +
'\n' +
'    <div id="tab-benchmark" class="tab-content">\n' +
'      <div class="actions">\n' +
'        <select id="benchMode">\n' +
'          <option value="ping">Ping (SELECT 1)</option>\n' +
'          <option value="write">Write (INSERT)</option>\n' +
'          <option value="read_write" selected>Read + Write Mix</option>\n' +
'          <option value="transaction">Transaction (BEGIN..COMMIT)</option>\n' +
'          <option value="complex">Complex (CTE / Pipeline)</option>\n' +
'        </select>\n' +
'        <button class="iter-pill" onclick="runBench(50)" id="benchBtn50">50 iter</button>\n' +
'        <button class="iter-pill" onclick="runBench(200)" id="benchBtn200">200 iter</button>\n' +
'        <button class="iter-pill primary" onclick="runBench(500)" id="benchBtn500">500 iter</button>\n' +
'      </div>\n' +
'      <div id="benchResults"></div>\n' +
'    </div>\n' +
'\n' +
'    <div id="tab-stress" class="tab-content">\n' +
'      <div class="actions">\n' +
'        <button class="stress-pill light" onclick="runStress(5, 20)">Light (5&times;20)</button>\n' +
'        <button class="stress-pill medium" onclick="runStress(10, 50)" id="stressBtn">Medium (10&times;50)</button>\n' +
'        <button class="stress-pill heavy" onclick="runStress(20, 50)">Heavy (20&times;50)</button>\n' +
'        <button class="stress-pill extreme" onclick="runStress(50, 100)">Extreme (50&times;100)</button>\n' +
'      </div>\n' +
'      <div id="stressResults"></div>\n' +
'    </div>\n' +
'\n' +
'    <div id="tab-history" class="tab-content">\n' +
'      <div id="historyChart" class="panel" style="display:none">\n' +
'        <h2>Performance Trend</h2>\n' +
'        <p class="desc">Ops/sec across all runs</p>\n' +
'        <div class="chart-wrap" style="height:300px"><canvas id="trendCanvas"></canvas></div>\n' +
'      </div>\n' +
'      <div id="historyTable"></div>\n' +
'      <div id="historyDetail"></div>\n' +
'    </div>\n' +
'\n' +
'    <div class="footer">\n' +
'      <div class="footer-text">Powered by myserver service discovery</div>\n' +
'      <a class="footer-link" href="#">View source on GitHub</a>\n' +
'    </div>\n' +
'  </div>\n' +
'\n' +
'  <script>\n' +
'    var DB_COLORS = { PostgreSQL: "#5b8def", MySQL: "#00b4d8", MariaDB: "#c0765a", Redis: "#ef4444" };\n' +
'    var DB_CARD_CLASS = { postgresql: "pg", mysql: "my", mariadb: "ma", redis: "re" };\n' +
'    var TAB_NAMES = ["connections", "benchmark", "stress", "history"];\n' +
'    var benchChart = null;\n' +
'    var stressChart = null;\n' +
'    var trendChart = null;\n' +
'    var expandedRunId = null;\n' +
'\n' +
'    function switchTab(name) {\n' +
'      document.querySelectorAll(".tab").forEach(function(t) { t.classList.remove("active"); });\n' +
'      document.querySelectorAll(".tab-content").forEach(function(t) { t.classList.remove("active"); });\n' +
'      document.getElementById("tab-" + name).classList.add("active");\n' +
'      document.querySelectorAll(".tab")[TAB_NAMES.indexOf(name)].classList.add("active");\n' +
'      if (name === "connections") runTest();\n' +
'      if (name === "history") loadHistory();\n' +
'    }\n' +
'\n' +
'    function sparkline(hist, color) {\n' +
'      if (!hist || !hist.length) return "";\n' +
'      var max = Math.max.apply(null, hist.concat([1]));\n' +
'      var html = \'<span class="spark">\';\n' +
'      for (var i = 0; i < hist.length; i++) {\n' +
'        var h = Math.max(2, (hist[i] / max) * 20);\n' +
'        html += \'<div style="height:\' + h + \'px;background:\' + (color || "#5b8def") + \'"></div>\';\n' +
'      }\n' +
'      return html + \'</span>\';\n' +
'    }\n' +
'\n' +
'    function makeGradient(ctx, chartArea, color) {\n' +
'      if (!chartArea) return color + "33";\n' +
'      var gradient = ctx.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);\n' +
'      gradient.addColorStop(0, color + "33");\n' +
'      gradient.addColorStop(1, color + "05");\n' +
'      return gradient;\n' +
'    }\n' +
'\n' +
'    function renderSkeletons() {\n' +
'      var html = "";\n' +
'      var classes = ["pg", "my", "ma", "re"];\n' +
'      for (var i = 0; i < 4; i++) {\n' +
'        html += \'<div class="skeleton" style="border-left-color:var(--\' + classes[i] + \');animation-delay:\' + (i * 100) + \'ms">\';\n' +
'        html += \'<div class="skeleton-line w40"></div>\';\n' +
'        html += \'<div class="skeleton-line w60" style="margin-top:8px"></div>\';\n' +
'        html += \'<div class="skeleton-line h24" style="margin-top:12px"></div>\';\n' +
'        html += \'<div class="skeleton-line w80" style="margin-top:12px"></div>\';\n' +
'        html += \'</div>\';\n' +
'      }\n' +
'      return html;\n' +
'    }\n' +
'\n' +
'    function chartTooltipConfig() {\n' +
'      return {\n' +
'        backgroundColor: "#18181b",\n' +
'        titleColor: "#fafafa",\n' +
'        bodyColor: "#a1a1aa",\n' +
'        borderColor: "#1a1a1f",\n' +
'        borderWidth: 1,\n' +
'        cornerRadius: 8,\n' +
'        padding: 10,\n' +
'        titleFont: { family: "Inter", size: 12, weight: "600" },\n' +
'        bodyFont: { family: "Inter", size: 11 }\n' +
'      };\n' +
'    }\n' +
'\n' +
'    async function runTest() {\n' +
'      document.getElementById("cards").innerHTML = renderSkeletons();\n' +
'      try {\n' +
'        var resp = await fetch("/api/test");\n' +
'        var data = await resp.json();\n' +
'        var html = "";\n' +
'        for (var i = 0; i < data.databases.length; i++) {\n' +
'          var db = data.databases[i];\n' +
'          var cls = DB_CARD_CLASS[db.type] || "";\n' +
'          var statusCls = db.status === "connected" ? "ok" : "err";\n' +
'          html += \'<div class="card \' + cls + \'" style="animation:fadeIn 0.3s ease \' + (i * 80) + \'ms both">\';\n' +
'          html += \'<div class="card-header"><span class="name">\' + db.name + \'</span></div>\';\n' +
'          html += \'<div class="status-row"><span class="status-dot \' + statusCls + \'"></span>\';\n' +
'          html += \'<span class="status-text \' + statusCls + \'">\' + db.status + \'</span></div>\';\n' +
'          html += \'<div class="latency">\' + db.latency_ms + \'<span class="latency-unit">ms</span></div>\';\n' +
'          html += \'<div class="meta">\';\n' +
'          if (db.details) html += db.details + \'<br>\';\n' +
'          if (db.pool_size) html += \'pool: \' + db.pool_size + \'<br>\';\n' +
'          if (db.host) html += db.host;\n' +
'          if (db.error) html += \'<br><span style="color:var(--red)">\' + db.error + \'</span>\';\n' +
'          html += \'</div></div>\';\n' +
'        }\n' +
'        document.getElementById("cards").innerHTML = html;\n' +
'      } catch (e) {\n' +
'        document.getElementById("cards").innerHTML = \'<div class="panel" style="grid-column:1/-1"><p style="color:var(--red)">Error: \' + e.message + \'</p></div>\';\n' +
'      }\n' +
'    }\n' +
'\n' +
'    async function runBench(n) {\n' +
'      var mode = document.getElementById("benchMode").value;\n' +
'      var btnIds = ["benchBtn50", "benchBtn200", "benchBtn500"];\n' +
'      btnIds.forEach(function(id) { var b = document.getElementById(id); if (b) b.disabled = true; });\n' +
'      var activeBtn = document.getElementById("benchBtn" + n) || document.getElementById("benchBtn50");\n' +
'      activeBtn.innerHTML = \'<span class="spinner"></span> Running \' + mode + \'...\';\n' +
'      try {\n' +
'        var resp = await fetch("/api/bench?n=" + n + "&mode=" + mode);\n' +
'        var data = await resp.json();\n' +
'        var benchmarks = data.benchmarks;\n' +
'        var bestAvg = Infinity;\n' +
'        var bestAvgName = "";\n' +
'        var bestOps = 0;\n' +
'        var bestOpsName = "";\n' +
'        var totalIter = 0;\n' +
'        for (var i = 0; i < benchmarks.length; i++) {\n' +
'          if (benchmarks[i].avg_ms < bestAvg) { bestAvg = benchmarks[i].avg_ms; bestAvgName = benchmarks[i].name; }\n' +
'          if (benchmarks[i].ops_per_sec > bestOps) { bestOps = benchmarks[i].ops_per_sec; bestOpsName = benchmarks[i].name; }\n' +
'          totalIter += benchmarks[i].iterations;\n' +
'        }\n' +
'\n' +
'        var html = \'<div class="stat-row">\';\n' +
'        html += \'<div class="stat"><div class="val">\' + bestAvg + \'<span class="latency-unit">ms</span></div><div class="lbl">Fastest Avg</div><div class="stat-name">\' + bestAvgName + \'</div></div>\';\n' +
'        html += \'<div class="stat"><div class="val">\' + bestOps.toLocaleString() + \'</div><div class="lbl">Highest Throughput</div><div class="stat-name">\' + bestOpsName + \'</div></div>\';\n' +
'        html += \'<div class="stat"><div class="val">\' + totalIter.toLocaleString() + \'</div><div class="lbl">Total Queries</div></div>\';\n' +
'        html += \'</div>\';\n' +
'\n' +
'        html += \'<div class="panel"><h2>Benchmark Results</h2>\' +\n' +
'          \'<p class="desc">Mode: \' + mode + \' &middot; \' + n + \' iterations per database (+ 10% warmup) &middot; \' + data.timestamp + \'</p>\';\n' +
'\n' +
'        html += \'<div class="chart-legend">\';\n' +
'        for (var i = 0; i < benchmarks.length; i++) {\n' +
'          html += \'<span class="legend-item"><span class="legend-dot" style="background:\' + (DB_COLORS[benchmarks[i].name] || "#5b8def") + \'"></span>\' + benchmarks[i].name + \'</span>\';\n' +
'        }\n' +
'        html += \'</div>\';\n' +
'\n' +
'        html += \'<div class="chart-wrap"><canvas id="benchCanvas"></canvas></div>\';\n' +
'\n' +
'        html += \'<div class="table-wrap"><table><thead><tr><th>DB</th><th>Avg</th><th>P50</th><th>P95</th><th>P99</th>\';\n' +
'        html += \'<th>&sigma;</th><th>Ops/s</th><th>Distribution</th></tr></thead><tbody>\';\n' +
'        for (var i = 0; i < benchmarks.length; i++) {\n' +
'          var b = benchmarks[i];\n' +
'          var color = DB_COLORS[b.name] || "#5b8def";\n' +
'          html += \'<tr><td><span class="legend-dot" style="background:\' + color + \';display:inline-block;margin-right:6px;vertical-align:middle"></span>\';\n' +
'          html += \'<strong style="color:\' + color + \'">\' + b.name + \'</strong></td>\';\n' +
'          html += \'<td>\' + b.avg_ms + \'ms</td>\';\n' +
'          html += \'<td>\' + b.p50_ms + \'ms</td>\';\n' +
'          html += \'<td>\' + b.p95_ms + \'ms</td>\';\n' +
'          html += \'<td>\' + b.p99_ms + \'ms</td>\';\n' +
'          html += \'<td>\' + b.stddev_ms + \'</td>\';\n' +
'          html += \'<td><strong>\' + b.ops_per_sec.toLocaleString() + \'</strong></td>\';\n' +
'          html += \'<td>\' + sparkline(b.histogram, color) + \'</td></tr>\';\n' +
'        }\n' +
'        html += \'</tbody></table></div></div>\';\n' +
'\n' +
'        document.getElementById("benchResults").innerHTML = html;\n' +
'\n' +
'        var canvas = document.getElementById("benchCanvas");\n' +
'        if (canvas && benchmarks.length > 0) {\n' +
'          if (benchChart) benchChart.destroy();\n' +
'          var labels = [];\n' +
'          var avgData = [];\n' +
'          var borderColors = [];\n' +
'          var bgColors = [];\n' +
'          for (var i = 0; i < benchmarks.length; i++) {\n' +
'            labels.push(benchmarks[i].name);\n' +
'            avgData.push(benchmarks[i].avg_ms);\n' +
'            var c = DB_COLORS[benchmarks[i].name] || "#5b8def";\n' +
'            borderColors.push(c);\n' +
'            bgColors.push(c);\n' +
'          }\n' +
'          benchChart = new Chart(canvas, {\n' +
'            type: "bar",\n' +
'            data: {\n' +
'              labels: labels,\n' +
'              datasets: [{\n' +
'                label: "Avg Latency (ms)",\n' +
'                data: avgData,\n' +
'                backgroundColor: function(ctx) {\n' +
'                  var chart = ctx.chart;\n' +
'                  var area = chart.chartArea;\n' +
'                  if (!area) return bgColors[ctx.dataIndex] + "33";\n' +
'                  var g = chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);\n' +
'                  g.addColorStop(0, bgColors[ctx.dataIndex] + "55");\n' +
'                  g.addColorStop(1, bgColors[ctx.dataIndex] + "0a");\n' +
'                  return g;\n' +
'                },\n' +
'                borderColor: borderColors,\n' +
'                borderWidth: 1,\n' +
'                borderRadius: 4,\n' +
'                borderSkipped: false\n' +
'              }]\n' +
'            },\n' +
'            options: {\n' +
'              responsive: true,\n' +
'              maintainAspectRatio: false,\n' +
'              plugins: {\n' +
'                legend: { display: false },\n' +
'                tooltip: Object.assign({}, chartTooltipConfig(), {\n' +
'                  callbacks: {\n' +
'                    afterBody: function(items) {\n' +
'                      var idx = items[0].dataIndex;\n' +
'                      var b = benchmarks[idx];\n' +
'                      return [\n' +
'                        "P50: " + b.p50_ms + "ms",\n' +
'                        "P95: " + b.p95_ms + "ms",\n' +
'                        "P99: " + b.p99_ms + "ms",\n' +
'                        "Ops/s: " + b.ops_per_sec.toLocaleString()\n' +
'                      ];\n' +
'                    }\n' +
'                  }\n' +
'                })\n' +
'              },\n' +
'              scales: {\n' +
'                y: {\n' +
'                  beginAtZero: true,\n' +
'                  grid: { color: "rgba(255,255,255,0.04)", drawBorder: false },\n' +
'                  ticks: { color: "#52525b", font: { family: "Inter", size: 11 } },\n' +
'                  title: { display: true, text: "Latency (ms)", color: "#52525b", font: { family: "Inter", size: 11 } }\n' +
'                },\n' +
'                x: {\n' +
'                  grid: { display: false },\n' +
'                  ticks: { color: "#a1a1aa", font: { family: "Inter", size: 11 } }\n' +
'                }\n' +
'              }\n' +
'            }\n' +
'          });\n' +
'        }\n' +
'      } catch (e) {\n' +
'        document.getElementById("benchResults").innerHTML = \'<div class="panel"><p style="color:var(--red)">Error: \' + e.message + \'</p></div>\';\n' +
'      }\n' +
'      btnIds.forEach(function(id) { var b = document.getElementById(id); if (b) b.disabled = false; });\n' +
'      activeBtn.textContent = n + " iter";\n' +
'    }\n' +
'\n' +
'    async function runStress(c, ops) {\n' +
'      var btns = document.querySelectorAll("#tab-stress button");\n' +
'      btns.forEach(function(b) { b.disabled = true; });\n' +
'      document.getElementById("stressResults").innerHTML = \'<div class="panel" style="text-align:center;padding:32px"><span class="spinner"></span><p style="color:var(--secondary);margin-top:12px">Running stress test: \' + c + \' concurrent workers &times; \' + ops + \' operations each...</p></div>\';\n' +
'      try {\n' +
'        var resp = await fetch("/api/stress?c=" + c + "&ops=" + ops);\n' +
'        var data = await resp.json();\n' +
'        var results = data.results;\n' +
'\n' +
'        var totalOps = 0;\n' +
'        var totalDuration = 0;\n' +
'        var totalErrors = 0;\n' +
'        for (var i = 0; i < results.length; i++) {\n' +
'          totalOps += results[i].total_ops;\n' +
'          totalDuration += results[i].duration_ms;\n' +
'          totalErrors += results[i].errors;\n' +
'        }\n' +
'        var errRate = totalOps > 0 ? ((totalErrors / totalOps) * 100).toFixed(2) : "0.00";\n' +
'\n' +
'        var html = \'<div class="stat-row">\';\n' +
'        html += \'<div class="stat"><div class="val">\' + totalOps.toLocaleString() + \'</div><div class="lbl">Total Operations</div></div>\';\n' +
'        html += \'<div class="stat"><div class="val">\' + Math.round(totalDuration / results.length).toLocaleString() + \'<span class="latency-unit">ms</span></div><div class="lbl">Avg Duration</div></div>\';\n' +
'        html += \'<div class="stat"><div class="val" style="color:\' + (totalErrors > 0 ? \'var(--red)\' : \'var(--green)\') + \'">\' + errRate + \'%</div><div class="lbl">Error Rate</div></div>\';\n' +
'        html += \'</div>\';\n' +
'\n' +
'        html += \'<div class="panel"><h2>Stress Test Results</h2>\' +\n' +
'          \'<p class="desc">\' + c + \' concurrent workers &times; \' + data.ops_per_worker + \' ops each &middot; \' + data.timestamp + \'</p>\';\n' +
'\n' +
'        html += \'<div class="chart-wrap" style="height:200px"><canvas id="stressCanvas"></canvas></div>\';\n' +
'\n' +
'        html += \'<div class="table-wrap"><table><thead><tr><th>Database</th><th>Total Ops</th><th>Success</th><th>Errors</th><th>Avg</th><th>P99</th><th>Duration</th><th>Ops/s</th><th style="width:16%">Success Rate</th></tr></thead><tbody>\';\n' +
'        for (var i = 0; i < results.length; i++) {\n' +
'          var r = results[i];\n' +
'          var pct = r.total_ops ? (r.success / r.total_ops * 100) : 0;\n' +
'          html += \'<tr><td><span class="legend-dot" style="background:\' + (DB_COLORS[r.name] || "#5b8def") + \';display:inline-block;margin-right:6px;vertical-align:middle"></span>\';\n' +
'          html += \'<strong style="color:\' + (DB_COLORS[r.name] || "#5b8def") + \'">\' + r.name + \'</strong></td>\';\n' +
'          html += \'<td>\' + r.total_ops.toLocaleString() + \'</td>\';\n' +
'          html += \'<td style="color:var(--green)">\' + r.success.toLocaleString() + \'</td>\';\n' +
'          html += \'<td style="color:\' + (r.errors ? \'var(--red)\' : \'var(--muted)\') + \'">\' + r.errors + \'</td>\';\n' +
'          html += \'<td>\' + r.avg_ms + \'ms</td>\';\n' +
'          html += \'<td>\' + r.p99_ms + \'ms</td>\';\n' +
'          html += \'<td>\' + r.duration_ms + \'ms</td>\';\n' +
'          html += \'<td><strong>\' + r.ops_per_sec.toLocaleString() + \'</strong></td>\';\n' +
'          html += \'<td><div class="stress-bar"><div class="ok-part" style="width:\' + pct + \'%"></div><div class="err-part" style="width:\' + (100 - pct) + \'%"></div></div>\';\n' +
'          html += \'<span style="font-size:11px;color:var(--muted)">\' + pct.toFixed(1) + \'%</span></td></tr>\';\n' +
'        }\n' +
'        html += \'</tbody></table></div></div>\';\n' +
'\n' +
'        document.getElementById("stressResults").innerHTML = html;\n' +
'\n' +
'        var canvas = document.getElementById("stressCanvas");\n' +
'        if (canvas && results.length > 0) {\n' +
'          if (stressChart) stressChart.destroy();\n' +
'          var labels = [];\n' +
'          var opsData = [];\n' +
'          var bgColors = [];\n' +
'          var borderColors = [];\n' +
'          for (var i = 0; i < results.length; i++) {\n' +
'            labels.push(results[i].name);\n' +
'            opsData.push(results[i].ops_per_sec);\n' +
'            var c2 = DB_COLORS[results[i].name] || "#5b8def";\n' +
'            bgColors.push(c2 + "33");\n' +
'            borderColors.push(c2);\n' +
'          }\n' +
'          stressChart = new Chart(canvas, {\n' +
'            type: "bar",\n' +
'            data: {\n' +
'              labels: labels,\n' +
'              datasets: [{\n' +
'                label: "Ops/sec",\n' +
'                data: opsData,\n' +
'                backgroundColor: bgColors,\n' +
'                borderColor: borderColors,\n' +
'                borderWidth: 1,\n' +
'                borderRadius: 4,\n' +
'                borderSkipped: false\n' +
'              }]\n' +
'            },\n' +
'            options: {\n' +
'              indexAxis: "y",\n' +
'              responsive: true,\n' +
'              maintainAspectRatio: false,\n' +
'              plugins: {\n' +
'                legend: { display: false },\n' +
'                tooltip: chartTooltipConfig()\n' +
'              },\n' +
'              scales: {\n' +
'                x: {\n' +
'                  beginAtZero: true,\n' +
'                  grid: { color: "rgba(255,255,255,0.04)", drawBorder: false },\n' +
'                  ticks: { color: "#52525b", font: { family: "Inter", size: 11 } },\n' +
'                  title: { display: true, text: "Operations / second", color: "#52525b", font: { family: "Inter", size: 11 } }\n' +
'                },\n' +
'                y: {\n' +
'                  grid: { display: false },\n' +
'                  ticks: { color: "#a1a1aa", font: { family: "Inter", size: 11 } }\n' +
'                }\n' +
'              }\n' +
'            }\n' +
'          });\n' +
'        }\n' +
'      } catch (e) {\n' +
'        document.getElementById("stressResults").innerHTML = \'<div class="panel"><p style="color:var(--red)">Error: \' + e.message + \'</p></div>\';\n' +
'      }\n' +
'      btns.forEach(function(b) { b.disabled = false; });\n' +
'    }\n' +
'\n' +
'    async function loadHistory() {\n' +
'      try {\n' +
'        var resp = await fetch("/api/history");\n' +
'        var runs = await resp.json();\n' +
'        if (!runs.length) {\n' +
'          document.getElementById("historyChart").style.display = "none";\n' +
'          document.getElementById("historyTable").innerHTML = \'<div class="empty-state">No runs recorded yet. Run a benchmark to get started.</div>\';\n' +
'          return;\n' +
'        }\n' +
'\n' +
'        document.getElementById("historyChart").style.display = "block";\n' +
'        buildTrendChart(runs);\n' +
'\n' +
'        var html = \'<div class="panel"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">\';\n' +
'        html += \'<div><h2>Past Runs</h2><p class="desc" style="margin-bottom:0">\' + runs.length + \' runs recorded</p></div>\';\n' +
'        html += \'<button class="ghost" onclick="clearAllHistory()">Clear History</button></div>\';\n' +
'        html += \'<div class="table-wrap"><table><thead><tr><th>#</th><th>Type</th><th>Mode</th><th>Timestamp</th><th>Summary</th></tr></thead><tbody>\';\n' +
'        for (var i = 0; i < runs.length; i++) {\n' +
'          var r = runs[i];\n' +
'          var summary = "";\n' +
'          if (r.type === "bench" && r.data.benchmarks) {\n' +
'            var names = [];\n' +
'            for (var j = 0; j < r.data.benchmarks.length; j++) {\n' +
'              names.push(r.data.benchmarks[j].name + " " + r.data.benchmarks[j].ops_per_sec + " ops/s");\n' +
'            }\n' +
'            summary = names.join(", ");\n' +
'          } else if (r.type === "stress" && r.data.results) {\n' +
'            var names = [];\n' +
'            for (var j = 0; j < r.data.results.length; j++) {\n' +
'              names.push(r.data.results[j].name + " " + r.data.results[j].ops_per_sec + " ops/s");\n' +
'            }\n' +
'            summary = names.join(", ");\n' +
'          }\n' +
'          html += \'<tr class="history-row" onclick="toggleRunDetail(\' + r.id + \', this)">\';\n' +
'          html += \'<td>\' + r.id + \'</td>\';\n' +
'          html += \'<td><span class="type-badge \' + r.type + \'">\' + r.type + \'</span></td>\';\n' +
'          html += \'<td>\' + r.mode + \'</td>\';\n' +
'          html += \'<td style="font-size:11px;color:var(--muted)">\' + formatTimestamp(r.timestamp) + \'</td>\';\n' +
'          html += \'<td style="font-size:11px;max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--secondary)">\' + summary + \'</td></tr>\';\n' +
'          html += \'<tr class="detail-row" id="detail-\' + r.id + \'" style="display:none"><td colspan="5"></td></tr>\';\n' +
'        }\n' +
'        html += \'</tbody></table></div></div>\';\n' +
'        document.getElementById("historyTable").innerHTML = html;\n' +
'        document.getElementById("historyDetail").innerHTML = "";\n' +
'        expandedRunId = null;\n' +
'      } catch (e) {\n' +
'        document.getElementById("historyTable").innerHTML = \'<div class="panel"><p style="color:var(--red)">Error: \' + e.message + \'</p></div>\';\n' +
'      }\n' +
'    }\n' +
'\n' +
'    function formatTimestamp(ts) {\n' +
'      try {\n' +
'        var d = new Date(ts);\n' +
'        var now = new Date();\n' +
'        var hours = String(d.getHours()).length < 2 ? "0" + d.getHours() : String(d.getHours());\n' +
'        var mins = String(d.getMinutes()).length < 2 ? "0" + d.getMinutes() : String(d.getMinutes());\n' +
'        if (d.toDateString() === now.toDateString()) return hours + ":" + mins;\n' +
'        var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];\n' +
'        return months[d.getMonth()] + " " + d.getDate() + " " + hours + ":" + mins;\n' +
'      } catch (e) { return ts; }\n' +
'    }\n' +
'\n' +
'    function buildTrendChart(runs) {\n' +
'      var canvas = document.getElementById("trendCanvas");\n' +
'      if (!canvas) return;\n' +
'      if (trendChart) trendChart.destroy();\n' +
'\n' +
'      var dbNames = ["PostgreSQL", "MySQL", "MariaDB", "Redis"];\n' +
'      var series = {};\n' +
'      for (var d = 0; d < dbNames.length; d++) {\n' +
'        series[dbNames[d]] = [];\n' +
'      }\n' +
'      var labels = [];\n' +
'\n' +
'      var chronological = runs.slice().reverse();\n' +
'      for (var i = 0; i < chronological.length; i++) {\n' +
'        var r = chronological[i];\n' +
'        labels.push(formatTimestamp(r.timestamp));\n' +
'        var items = r.type === "bench" ? (r.data.benchmarks || []) : (r.data.results || []);\n' +
'        var found = {};\n' +
'        for (var j = 0; j < items.length; j++) {\n' +
'          found[items[j].name] = items[j].ops_per_sec;\n' +
'        }\n' +
'        for (var d = 0; d < dbNames.length; d++) {\n' +
'          series[dbNames[d]].push(found[dbNames[d]] !== undefined ? found[dbNames[d]] : null);\n' +
'        }\n' +
'      }\n' +
'\n' +
'      var datasets = [];\n' +
'      for (var d = 0; d < dbNames.length; d++) {\n' +
'        var name = dbNames[d];\n' +
'        var hasData = false;\n' +
'        for (var k = 0; k < series[name].length; k++) {\n' +
'          if (series[name][k] !== null) { hasData = true; break; }\n' +
'        }\n' +
'        if (!hasData) continue;\n' +
'        datasets.push({\n' +
'          label: name,\n' +
'          data: series[name],\n' +
'          borderColor: DB_COLORS[name],\n' +
'          backgroundColor: DB_COLORS[name] + "1a",\n' +
'          tension: 0.3,\n' +
'          pointRadius: 0,\n' +
'          pointHoverRadius: 4,\n' +
'          pointHoverBackgroundColor: DB_COLORS[name],\n' +
'          spanGaps: true,\n' +
'          fill: true,\n' +
'          borderWidth: 2\n' +
'        });\n' +
'      }\n' +
'\n' +
'      trendChart = new Chart(canvas, {\n' +
'        type: "line",\n' +
'        data: { labels: labels, datasets: datasets },\n' +
'        options: {\n' +
'          responsive: true,\n' +
'          maintainAspectRatio: false,\n' +
'          interaction: { mode: "index", intersect: false },\n' +
'          plugins: {\n' +
'            legend: {\n' +
'              labels: { color: "#a1a1aa", usePointStyle: true, pointStyle: "circle", font: { family: "Inter", size: 11 }, padding: 16 }\n' +
'            },\n' +
'            tooltip: chartTooltipConfig()\n' +
'          },\n' +
'          scales: {\n' +
'            y: {\n' +
'              beginAtZero: true,\n' +
'              grid: { color: "rgba(255,255,255,0.04)", drawBorder: false },\n' +
'              ticks: { color: "#52525b", font: { family: "Inter", size: 11 } },\n' +
'              title: { display: true, text: "Ops/sec", color: "#52525b", font: { family: "Inter", size: 11 } }\n' +
'            },\n' +
'            x: {\n' +
'              grid: { color: "rgba(255,255,255,0.02)", drawBorder: false },\n' +
'              ticks: { color: "#52525b", maxRotation: 45, font: { family: "Inter", size: 10 } }\n' +
'            }\n' +
'          }\n' +
'        }\n' +
'      });\n' +
'    }\n' +
'\n' +
'    async function toggleRunDetail(id, rowEl) {\n' +
'      var detailRow = document.getElementById("detail-" + id);\n' +
'      if (!detailRow) return;\n' +
'      if (expandedRunId === id) {\n' +
'        detailRow.style.display = "none";\n' +
'        expandedRunId = null;\n' +
'        return;\n' +
'      }\n' +
'      if (expandedRunId !== null) {\n' +
'        var prev = document.getElementById("detail-" + expandedRunId);\n' +
'        if (prev) prev.style.display = "none";\n' +
'      }\n' +
'      expandedRunId = id;\n' +
'      var cell = detailRow.querySelector("td");\n' +
'      cell.innerHTML = \'<div style="padding:8px 0;text-align:center"><span class="spinner"></span></div>\';\n' +
'      detailRow.style.display = "";\n' +
'      try {\n' +
'        var resp = await fetch("/api/history/" + id);\n' +
'        var run = await resp.json();\n' +
'        var html = \'<div class="detail-inline">\';\n' +
'        html += \'<div style="margin-bottom:8px"><span class="type-badge \' + run.type + \'">\' + run.type + \'</span>\';\n' +
'        html += \' <span style="color:var(--muted);font-size:11px">Mode: \' + run.mode + \' &middot; \' + run.timestamp + \'</span></div>\';\n' +
'\n' +
'        if (run.type === "bench" && run.data.benchmarks) {\n' +
'          var benchmarks = run.data.benchmarks;\n' +
'          html += \'<div class="table-wrap"><table><thead><tr><th>Database</th><th>Avg</th><th>P50</th><th>P95</th><th>P99</th><th>Stddev</th><th>Ops/s</th><th>Iterations</th></tr></thead><tbody>\';\n' +
'          for (var i = 0; i < benchmarks.length; i++) {\n' +
'            var b = benchmarks[i];\n' +
'            html += \'<tr><td><strong style="color:\' + (DB_COLORS[b.name] || "#5b8def") + \'">\' + b.name + \'</strong></td>\';\n' +
'            html += \'<td>\' + b.avg_ms + \'ms</td><td>\' + b.p50_ms + \'ms</td><td>\' + b.p95_ms + \'ms</td>\';\n' +
'            html += \'<td>\' + b.p99_ms + \'ms</td><td>\' + b.stddev_ms + \'</td>\';\n' +
'            html += \'<td><strong>\' + b.ops_per_sec.toLocaleString() + \'</strong></td>\';\n' +
'            html += \'<td>\' + b.iterations + \'</td></tr>\';\n' +
'          }\n' +
'          html += \'</tbody></table></div>\';\n' +
'        } else if (run.type === "stress" && run.data.results) {\n' +
'          var results = run.data.results;\n' +
'          html += \'<div class="table-wrap"><table><thead><tr><th>Database</th><th>Total Ops</th><th>Success</th><th>Errors</th><th>Avg</th><th>P99</th><th>Ops/s</th></tr></thead><tbody>\';\n' +
'          for (var i = 0; i < results.length; i++) {\n' +
'            var r = results[i];\n' +
'            html += \'<tr><td><strong style="color:\' + (DB_COLORS[r.name] || "#5b8def") + \'">\' + r.name + \'</strong></td>\';\n' +
'            html += \'<td>\' + r.total_ops + \'</td>\';\n' +
'            html += \'<td style="color:var(--green)">\' + r.success + \'</td>\';\n' +
'            html += \'<td style="color:\' + (r.errors ? \'var(--red)\' : \'var(--muted)\') + \'">\' + r.errors + \'</td>\';\n' +
'            html += \'<td>\' + r.avg_ms + \'ms</td><td>\' + r.p99_ms + \'ms</td>\';\n' +
'            html += \'<td><strong>\' + r.ops_per_sec.toLocaleString() + \'</strong></td></tr>\';\n' +
'          }\n' +
'          html += \'</tbody></table></div>\';\n' +
'        }\n' +
'\n' +
'        html += \'</div>\';\n' +
'        cell.innerHTML = html;\n' +
'      } catch (e) {\n' +
'        cell.innerHTML = \'<div class="detail-inline" style="color:var(--red)">Error: \' + e.message + \'</div>\';\n' +
'      }\n' +
'    }\n' +
'\n' +
'    async function clearAllHistory() {\n' +
'      if (!confirm("Clear all history?")) return;\n' +
'      await fetch("/api/history", { method: "DELETE" });\n' +
'      loadHistory();\n' +
'    }\n' +
'\n' +
'    runTest();\n' +
'  <\/script>\n' +
'</body>\n' +
'</html>';
}

console.log("Discovery showcase listening on http://localhost:" + server.port);
