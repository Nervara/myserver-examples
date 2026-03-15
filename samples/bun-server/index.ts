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
'  <title>Discovery Showcase | myserver</title>\n' +
'  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"><\/script>\n' +
'  <style>\n' +
'    :root {\n' +
'      --bg: #0a0f1a; --card: #111827; --card-hover: #1a2332; --border: #1e293b;\n' +
'      --text: #e2e8f0; --muted: #94a3b8; --dim: #64748b;\n' +
'      --pg: #336791; --my: #00758f; --ma: #c0765a; --re: #dc382d;\n' +
'      --green: #22c55e; --red: #ef4444;\n' +
'    }\n' +
'    * { margin: 0; padding: 0; box-sizing: border-box; }\n' +
'    body { font-family: "Inter", system-ui, -apple-system, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }\n' +
'    .container { max-width: 1200px; margin: 0 auto; padding: 2rem; }\n' +
'    .header { margin-bottom: 2rem; }\n' +
'    .header h1 { font-size: 2.2rem; font-weight: 800; letter-spacing: -0.03em; }\n' +
'    .header h1 .brand { background: linear-gradient(135deg, #38bdf8, #818cf8, #c084fc); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text; }\n' +
'    .header .sub { color: var(--muted); font-size: 0.85rem; margin-top: 0.3rem; }\n' +
'    .header .tagline { color: var(--dim); font-size: 0.75rem; margin-top: 0.2rem; font-style: italic; }\n' +
'    .tabs { display: flex; gap: 0; margin-bottom: 1.5rem; border-bottom: 1px solid var(--border); }\n' +
'    .tab { padding: 0.7rem 1.4rem; cursor: pointer; font-size: 0.85rem; font-weight: 500; color: var(--muted); border-bottom: 2px solid transparent; transition: all 0.2s; user-select: none; }\n' +
'    .tab:hover { color: var(--text); background: rgba(255,255,255,0.02); }\n' +
'    .tab.active { color: #818cf8; border-bottom-color: #818cf8; }\n' +
'    .tab-content { display: none; }\n' +
'    .tab-content.active { display: block; }\n' +
'    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 1rem; margin-bottom: 1.5rem; }\n' +
'    .card { background: var(--card); border-radius: 12px; padding: 1.25rem; border: 1px solid var(--border); transition: all 0.25s ease; position: relative; overflow: hidden; }\n' +
'    .card::before { content: ""; position: absolute; top: 0; left: 0; right: 0; height: 2px; opacity: 0; transition: opacity 0.25s; }\n' +
'    .card:hover { transform: translateY(-2px); border-color: rgba(255,255,255,0.1); background: var(--card-hover); }\n' +
'    .card:hover::before { opacity: 1; }\n' +
'    .card.pg::before { background: var(--pg); } .card.my::before { background: var(--my); }\n' +
'    .card.ma::before { background: var(--ma); } .card.re::before { background: var(--re); }\n' +
'    .card.ok { border-color: rgba(34,197,94,0.3); }\n' +
'    .card.err { border-color: rgba(239,68,68,0.3); }\n' +
'    .card .icon { font-size: 1.8rem; margin-bottom: 0.5rem; }\n' +
'    .card .name { font-weight: 600; font-size: 1.05rem; margin-bottom: 0.3rem; }\n' +
'    .badge { font-size: 0.65rem; padding: 2px 8px; border-radius: 9999px; display: inline-block; margin-bottom: 0.5rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }\n' +
'    .badge.ok { background: rgba(34,197,94,0.15); color: var(--green); }\n' +
'    .badge.err { background: rgba(239,68,68,0.15); color: var(--red); }\n' +
'    .card .latency { font-size: 1.8rem; font-weight: 700; margin-bottom: 0.3rem; font-variant-numeric: tabular-nums; }\n' +
'    .card.pg .latency { color: var(--pg); } .card.my .latency { color: var(--my); }\n' +
'    .card.ma .latency { color: var(--ma); } .card.re .latency { color: var(--re); }\n' +
'    .card .meta { font-size: 0.72rem; color: var(--dim); line-height: 1.6; word-break: break-all; }\n' +
'    .panel { background: var(--card); border-radius: 12px; padding: 1.5rem; border: 1px solid var(--border); margin-bottom: 1.5rem; backdrop-filter: blur(10px); background: rgba(17,24,39,0.8); }\n' +
'    .panel h2 { font-size: 1.1rem; font-weight: 600; margin-bottom: 0.25rem; }\n' +
'    .panel .desc { font-size: 0.8rem; color: var(--muted); margin-bottom: 1rem; }\n' +
'    table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }\n' +
'    th { text-align: left; color: var(--muted); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.05em; padding: 0.5rem 0.5rem; border-bottom: 1px solid var(--border); }\n' +
'    td { padding: 0.6rem 0.5rem; border-bottom: 1px solid rgba(30,41,59,0.5); font-variant-numeric: tabular-nums; }\n' +
'    tr:hover td { background: rgba(255,255,255,0.02); }\n' +
'    .stat-row { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 0.75rem; margin-bottom: 1.25rem; }\n' +
'    .stat { text-align: center; padding: 0.8rem; background: rgba(129,140,248,0.05); border-radius: 10px; border: 1px solid rgba(129,140,248,0.1); }\n' +
'    .stat .val { font-size: 1.5rem; font-weight: 700; color: #818cf8; font-variant-numeric: tabular-nums; }\n' +
'    .stat .lbl { font-size: 0.68rem; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 0.2rem; }\n' +
'    .chart-wrap { position: relative; height: 280px; margin-bottom: 1.25rem; }\n' +
'    .spark { display: inline-flex; align-items: flex-end; gap: 1px; height: 22px; }\n' +
'    .spark div { width: 3px; border-radius: 1px; min-height: 2px; opacity: 0.8; }\n' +
'    .stress-bar { display: flex; height: 20px; border-radius: 4px; overflow: hidden; }\n' +
'    .stress-bar .ok-part { background: var(--green); }\n' +
'    .stress-bar .err-part { background: var(--red); }\n' +
'    button { background: rgba(255,255,255,0.06); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 0.5rem 1.1rem; cursor: pointer; font-size: 0.82rem; font-weight: 500; transition: all 0.2s; }\n' +
'    button:hover { background: rgba(255,255,255,0.1); border-color: rgba(255,255,255,0.15); }\n' +
'    button:disabled { opacity: 0.35; cursor: not-allowed; }\n' +
'    button.primary { background: rgba(129,140,248,0.15); border-color: rgba(129,140,248,0.3); color: #a5b4fc; }\n' +
'    button.primary:hover { background: rgba(129,140,248,0.25); }\n' +
'    button.danger { background: rgba(239,68,68,0.15); border-color: rgba(239,68,68,0.3); color: #fca5a5; }\n' +
'    button.danger:hover { background: rgba(239,68,68,0.25); }\n' +
'    .actions { display: flex; gap: 0.75rem; margin-bottom: 1.5rem; flex-wrap: wrap; align-items: center; }\n' +
'    select { background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 8px; padding: 0.5rem 0.75rem; font-size: 0.82rem; cursor: pointer; }\n' +
'    select:focus { outline: none; border-color: #818cf8; }\n' +
'    .spinner { display: inline-block; width: 14px; height: 14px; border: 2px solid rgba(255,255,255,0.1); border-top-color: #818cf8; border-radius: 50%; animation: spin 0.6s linear infinite; vertical-align: middle; }\n' +
'    @keyframes spin { to { transform: rotate(360deg); } }\n' +
'    .history-row { cursor: pointer; }\n' +
'    .history-row:hover td { background: rgba(129,140,248,0.05); }\n' +
'    .type-badge { font-size: 0.65rem; padding: 2px 6px; border-radius: 4px; font-weight: 600; text-transform: uppercase; }\n' +
'    .type-badge.bench { background: rgba(56,189,248,0.15); color: #38bdf8; }\n' +
'    .type-badge.stress { background: rgba(251,191,36,0.15); color: #fbbf24; }\n' +
'    .footer { text-align: center; color: var(--dim); font-size: 0.75rem; margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border); }\n' +
'    @media (max-width: 640px) { .grid { grid-template-columns: 1fr 1fr; } .stat-row { grid-template-columns: repeat(2, 1fr); } .chart-wrap { height: 200px; } }\n' +
'  </style>\n' +
'</head>\n' +
'<body>\n' +
'  <div class="container">\n' +
'    <div class="header">\n' +
'      <h1><span class="brand">myserver</span></h1>\n' +
'      <p class="sub">Bun ' + Bun.version + ' &bull; ' + process.platform + '/' + process.arch + ' &bull; PID ' + process.pid + '</p>\n' +
'      <p class="tagline">powered by service discovery</p>\n' +
'    </div>\n' +
'\n' +
'    <div class="tabs">\n' +
'      <div class="tab active" onclick="switchTab(\'connections\')">Connections</div>\n' +
'      <div class="tab" onclick="switchTab(\'benchmark\')">Benchmark</div>\n' +
'      <div class="tab" onclick="switchTab(\'stress\')">Stress Test</div>\n' +
'      <div class="tab" onclick="switchTab(\'history\')">History</div>\n' +
'    </div>\n' +
'\n' +
'    <div id="tab-connections" class="tab-content active">\n' +
'      <div class="actions">\n' +
'        <button class="primary" onclick="runTest()" id="testBtn">Test All Connections</button>\n' +
'      </div>\n' +
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
'        <button onclick="runBench(50)" id="benchBtn50">50 iterations</button>\n' +
'        <button onclick="runBench(200)" id="benchBtn200">200 iterations</button>\n' +
'        <button class="primary" onclick="runBench(500)" id="benchBtn500">500 iterations</button>\n' +
'      </div>\n' +
'      <div id="benchResults"></div>\n' +
'    </div>\n' +
'\n' +
'    <div id="tab-stress" class="tab-content">\n' +
'      <div class="actions">\n' +
'        <button onclick="runStress(5, 20)">Light (5&times;20)</button>\n' +
'        <button onclick="runStress(10, 50)" id="stressBtn">Medium (10&times;50)</button>\n' +
'        <button class="primary" onclick="runStress(20, 50)">Heavy (20&times;50)</button>\n' +
'        <button class="danger" onclick="runStress(50, 100)">Extreme (50&times;100)</button>\n' +
'      </div>\n' +
'      <div id="stressResults"></div>\n' +
'    </div>\n' +
'\n' +
'    <div id="tab-history" class="tab-content">\n' +
'      <div class="actions">\n' +
'        <button class="primary" onclick="loadHistory()">Refresh</button>\n' +
'        <button class="danger" onclick="clearAllHistory()">Clear History</button>\n' +
'      </div>\n' +
'      <div id="historyChart" class="panel" style="display:none"><div class="chart-wrap"><canvas id="trendCanvas"></canvas></div></div>\n' +
'      <div id="historyTable"></div>\n' +
'      <div id="historyDetail"></div>\n' +
'    </div>\n' +
'\n' +
'    <div class="footer">Powered by myserver internal service discovery</div>\n' +
'  </div>\n' +
'\n' +
'  <script>\n' +
'    var DB_COLORS = { PostgreSQL: "#336791", MySQL: "#00758f", MariaDB: "#c0765a", Redis: "#dc382d" };\n' +
'    var DB_ICONS = { postgresql: "\\u{1F418}", mysql: "\\u{1F42C}", mariadb: "\\u{1F9AD}", redis: "\\u{26A1}" };\n' +
'    var DB_CARD_CLASS = { postgresql: "pg", mysql: "my", mariadb: "ma", redis: "re" };\n' +
'    var TAB_NAMES = ["connections", "benchmark", "stress", "history"];\n' +
'    var benchChart = null;\n' +
'    var stressChart = null;\n' +
'    var trendChart = null;\n' +
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
'        html += \'<div style="height:\' + h + \'px;background:\' + (color || "#818cf8") + \'"></div>\';\n' +
'      }\n' +
'      return html + \'</span>\';\n' +
'    }\n' +
'\n' +
'    async function runTest() {\n' +
'      var btn = document.getElementById("testBtn");\n' +
'      btn.disabled = true;\n' +
'      btn.innerHTML = \'<span class="spinner"></span> Testing...\';\n' +
'      try {\n' +
'        var resp = await fetch("/api/test");\n' +
'        var data = await resp.json();\n' +
'        var html = "";\n' +
'        for (var i = 0; i < data.databases.length; i++) {\n' +
'          var db = data.databases[i];\n' +
'          var cls = DB_CARD_CLASS[db.type] || "";\n' +
'          var statusCls = db.status === "connected" ? "ok" : "err";\n' +
'          html += \'<div class="card \' + cls + " " + statusCls + \'">\' +\n' +
'            \'<div class="icon">\' + (DB_ICONS[db.type] || "\\u{1F4BE}") + \'</div>\' +\n' +
'            \'<div class="name">\' + db.name + \'</div>\' +\n' +
'            \'<div class="badge \' + statusCls + \'">\' + db.status + \'</div>\' +\n' +
'            \'<div class="latency">\' + db.latency_ms + \'<span style="font-size:0.8rem;font-weight:400;color:var(--muted)">ms</span></div>\' +\n' +
'            \'<div class="meta">\' +\n' +
'              (db.details ? db.details + "<br>" : "") +\n' +
'              (db.pool_size ? "pool: " + db.pool_size + "<br>" : "") +\n' +
'              (db.host || "") +\n' +
'              (db.error ? \'<br><span style="color:var(--red)">\' + db.error + \'</span>\' : "") +\n' +
'            \'</div></div>\';\n' +
'        }\n' +
'        document.getElementById("cards").innerHTML = html;\n' +
'      } catch (e) {\n' +
'        document.getElementById("cards").innerHTML = \'<div class="card err">Error: \' + e.message + \'</div>\';\n' +
'      }\n' +
'      btn.disabled = false;\n' +
'      btn.textContent = "Test All Connections";\n' +
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
'        var bestOps = 0;\n' +
'        var totalIter = 0;\n' +
'        for (var i = 0; i < benchmarks.length; i++) {\n' +
'          if (benchmarks[i].avg_ms < bestAvg) bestAvg = benchmarks[i].avg_ms;\n' +
'          if (benchmarks[i].ops_per_sec > bestOps) bestOps = benchmarks[i].ops_per_sec;\n' +
'          totalIter += benchmarks[i].iterations;\n' +
'        }\n' +
'\n' +
'        var html = \'<div class="panel"><h2>Benchmark Results</h2>\' +\n' +
'          \'<p class="desc">Mode: <strong>\' + mode + \'</strong> &bull; \' + n + \' iterations per database (+ 10% warmup) &bull; \' + data.timestamp + \'</p>\';\n' +
'\n' +
'        html += \'<div class="stat-row">\';\n' +
'        html += \'<div class="stat"><div class="val">\' + bestAvg + \'ms</div><div class="lbl">Best Avg Latency</div></div>\';\n' +
'        html += \'<div class="stat"><div class="val">\' + bestOps.toLocaleString() + \'</div><div class="lbl">Best Ops/s</div></div>\';\n' +
'        html += \'<div class="stat"><div class="val">\' + totalIter.toLocaleString() + \'</div><div class="lbl">Total Iterations</div></div>\';\n' +
'        html += \'</div>\';\n' +
'\n' +
'        html += \'<div class="chart-wrap"><canvas id="benchCanvas"></canvas></div>\';\n' +
'\n' +
'        html += \'<table><thead><tr><th>Database</th><th>Avg</th><th>P50</th><th>P95</th><th>P99</th><th>Stddev</th><th>Ops/s</th><th>Distribution</th></tr></thead><tbody>\';\n' +
'        for (var i = 0; i < benchmarks.length; i++) {\n' +
'          var b = benchmarks[i];\n' +
'          var color = DB_COLORS[b.name] || "#818cf8";\n' +
'          html += \'<tr><td><strong style="color:\' + color + \'">\' + b.name + \'</strong></td>\' +\n' +
'            \'<td>\' + b.avg_ms + \'ms</td>\' +\n' +
'            \'<td>\' + b.p50_ms + \'ms</td>\' +\n' +
'            \'<td>\' + b.p95_ms + \'ms</td>\' +\n' +
'            \'<td>\' + b.p99_ms + \'ms</td>\' +\n' +
'            \'<td>\' + b.stddev_ms + \'</td>\' +\n' +
'            \'<td><strong>\' + b.ops_per_sec.toLocaleString() + \'</strong></td>\' +\n' +
'            \'<td>\' + sparkline(b.histogram, color) + \'</td></tr>\';\n' +
'        }\n' +
'        html += \'</tbody></table></div>\';\n' +
'\n' +
'        document.getElementById("benchResults").innerHTML = html;\n' +
'\n' +
'        var canvas = document.getElementById("benchCanvas");\n' +
'        if (canvas && benchmarks.length > 0) {\n' +
'          if (benchChart) benchChart.destroy();\n' +
'          var labels = [];\n' +
'          var avgData = [];\n' +
'          var bgColors = [];\n' +
'          var borderColors = [];\n' +
'          for (var i = 0; i < benchmarks.length; i++) {\n' +
'            labels.push(benchmarks[i].name);\n' +
'            avgData.push(benchmarks[i].avg_ms);\n' +
'            var c = DB_COLORS[benchmarks[i].name] || "#818cf8";\n' +
'            bgColors.push(c + "40");\n' +
'            borderColors.push(c);\n' +
'          }\n' +
'          benchChart = new Chart(canvas, {\n' +
'            type: "bar",\n' +
'            data: {\n' +
'              labels: labels,\n' +
'              datasets: [{\n' +
'                label: "Avg Latency (ms)",\n' +
'                data: avgData,\n' +
'                backgroundColor: bgColors,\n' +
'                borderColor: borderColors,\n' +
'                borderWidth: 2,\n' +
'                borderRadius: 6\n' +
'              }]\n' +
'            },\n' +
'            options: {\n' +
'              responsive: true,\n' +
'              maintainAspectRatio: false,\n' +
'              plugins: {\n' +
'                legend: { display: false },\n' +
'                tooltip: {\n' +
'                  backgroundColor: "#1e293b",\n' +
'                  titleColor: "#e2e8f0",\n' +
'                  bodyColor: "#94a3b8",\n' +
'                  borderColor: "#334155",\n' +
'                  borderWidth: 1,\n' +
'                  cornerRadius: 8,\n' +
'                  callbacks: {\n' +
'                    label: function(ctx) { return ctx.parsed.y + " ms avg"; }\n' +
'                  }\n' +
'                }\n' +
'              },\n' +
'              scales: {\n' +
'                y: {\n' +
'                  beginAtZero: true,\n' +
'                  grid: { color: "rgba(255,255,255,0.05)" },\n' +
'                  ticks: { color: "#94a3b8" },\n' +
'                  title: { display: true, text: "Latency (ms)", color: "#64748b" }\n' +
'                },\n' +
'                x: {\n' +
'                  grid: { display: false },\n' +
'                  ticks: { color: "#94a3b8" }\n' +
'                }\n' +
'              }\n' +
'            }\n' +
'          });\n' +
'        }\n' +
'      } catch (e) {\n' +
'        document.getElementById("benchResults").innerHTML = \'<div class="panel">Error: \' + e.message + \'</div>\';\n' +
'      }\n' +
'      btnIds.forEach(function(id) { var b = document.getElementById(id); if (b) b.disabled = false; });\n' +
'      activeBtn.textContent = n + " iterations";\n' +
'    }\n' +
'\n' +
'    async function runStress(c, ops) {\n' +
'      var btns = document.querySelectorAll("#tab-stress button");\n' +
'      btns.forEach(function(b) { b.disabled = true; });\n' +
'      document.getElementById("stressResults").innerHTML = \'<div class="panel"><span class="spinner"></span> Running stress test: \' + c + \' concurrent workers &times; \' + ops + \' operations each...</div>\';\n' +
'      try {\n' +
'        var resp = await fetch("/api/stress?c=" + c + "&ops=" + ops);\n' +
'        var data = await resp.json();\n' +
'        var results = data.results;\n' +
'\n' +
'        var html = \'<div class="panel"><h2>Stress Test Results</h2>\' +\n' +
'          \'<p class="desc">\' + c + \' concurrent workers &times; \' + data.ops_per_worker + \' ops each &bull; \' + data.timestamp + \'</p>\';\n' +
'\n' +
'        html += \'<div class="stat-row">\';\n' +
'        for (var i = 0; i < results.length; i++) {\n' +
'          html += \'<div class="stat"><div class="val">\' + results[i].ops_per_sec.toLocaleString() + \'</div><div class="lbl">\' + results[i].name + \' ops/s</div></div>\';\n' +
'        }\n' +
'        html += \'</div>\';\n' +
'\n' +
'        html += \'<div class="chart-wrap"><canvas id="stressCanvas"></canvas></div>\';\n' +
'\n' +
'        html += \'<table><thead><tr><th>Database</th><th>Total Ops</th><th>Success</th><th>Errors</th><th>Avg</th><th>P99</th><th>Duration</th><th>Ops/s</th><th style="width:18%">Success Rate</th></tr></thead><tbody>\';\n' +
'        for (var i = 0; i < results.length; i++) {\n' +
'          var r = results[i];\n' +
'          var pct = r.total_ops ? (r.success / r.total_ops * 100) : 0;\n' +
'          html += \'<tr><td><strong style="color:\' + (DB_COLORS[r.name] || "#818cf8") + \'">\' + r.name + \'</strong></td>\' +\n' +
'            \'<td>\' + r.total_ops.toLocaleString() + \'</td>\' +\n' +
'            \'<td style="color:var(--green)">\' + r.success.toLocaleString() + \'</td>\' +\n' +
'            \'<td style="color:\' + (r.errors ? \'var(--red)\' : \'var(--dim)\') + \'">\' + r.errors + \'</td>\' +\n' +
'            \'<td>\' + r.avg_ms + \'ms</td>\' +\n' +
'            \'<td>\' + r.p99_ms + \'ms</td>\' +\n' +
'            \'<td>\' + r.duration_ms + \'ms</td>\' +\n' +
'            \'<td><strong>\' + r.ops_per_sec.toLocaleString() + \'</strong></td>\' +\n' +
'            \'<td><div class="stress-bar"><div class="ok-part" style="width:\' + pct + \'%"></div><div class="err-part" style="width:\' + (100 - pct) + \'%"></div></div>\' +\n' +
'            \'<span style="font-size:0.72rem;color:var(--muted)">\' + pct.toFixed(1) + \'%</span></td></tr>\';\n' +
'        }\n' +
'        html += \'</tbody></table></div>\';\n' +
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
'            var c2 = DB_COLORS[results[i].name] || "#818cf8";\n' +
'            bgColors.push(c2 + "40");\n' +
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
'                borderWidth: 2,\n' +
'                borderRadius: 6\n' +
'              }]\n' +
'            },\n' +
'            options: {\n' +
'              indexAxis: "y",\n' +
'              responsive: true,\n' +
'              maintainAspectRatio: false,\n' +
'              plugins: {\n' +
'                legend: { display: false },\n' +
'                tooltip: {\n' +
'                  backgroundColor: "#1e293b",\n' +
'                  titleColor: "#e2e8f0",\n' +
'                  bodyColor: "#94a3b8",\n' +
'                  borderColor: "#334155",\n' +
'                  borderWidth: 1,\n' +
'                  cornerRadius: 8\n' +
'                }\n' +
'              },\n' +
'              scales: {\n' +
'                x: {\n' +
'                  beginAtZero: true,\n' +
'                  grid: { color: "rgba(255,255,255,0.05)" },\n' +
'                  ticks: { color: "#94a3b8" },\n' +
'                  title: { display: true, text: "Operations / second", color: "#64748b" }\n' +
'                },\n' +
'                y: {\n' +
'                  grid: { display: false },\n' +
'                  ticks: { color: "#94a3b8" }\n' +
'                }\n' +
'              }\n' +
'            }\n' +
'          });\n' +
'        }\n' +
'      } catch (e) {\n' +
'        document.getElementById("stressResults").innerHTML = \'<div class="panel">Error: \' + e.message + \'</div>\';\n' +
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
'          document.getElementById("historyTable").innerHTML = \'<div class="panel"><p style="color:var(--muted);text-align:center">No history yet. Run a benchmark or stress test first.</p></div>\';\n' +
'          return;\n' +
'        }\n' +
'\n' +
'        document.getElementById("historyChart").style.display = "block";\n' +
'        buildTrendChart(runs);\n' +
'\n' +
'        var html = \'<div class="panel"><h2>Past Runs</h2><p class="desc">\' + runs.length + \' runs recorded</p>\';\n' +
'        html += \'<table><thead><tr><th>#</th><th>Type</th><th>Mode</th><th>Timestamp</th><th>Summary</th></tr></thead><tbody>\';\n' +
'        for (var i = 0; i < runs.length; i++) {\n' +
'          var r = runs[i];\n' +
'          var summary = "";\n' +
'          if (r.type === "bench" && r.data.benchmarks) {\n' +
'            var names = [];\n' +
'            for (var j = 0; j < r.data.benchmarks.length; j++) {\n' +
'              names.push(r.data.benchmarks[j].name + ": " + r.data.benchmarks[j].ops_per_sec + " ops/s");\n' +
'            }\n' +
'            summary = names.join(", ");\n' +
'          } else if (r.type === "stress" && r.data.results) {\n' +
'            var names = [];\n' +
'            for (var j = 0; j < r.data.results.length; j++) {\n' +
'              names.push(r.data.results[j].name + ": " + r.data.results[j].ops_per_sec + " ops/s");\n' +
'            }\n' +
'            summary = names.join(", ");\n' +
'          }\n' +
'          html += \'<tr class="history-row" onclick="showRunDetail(\' + r.id + \')">\' +\n' +
'            \'<td>\' + r.id + \'</td>\' +\n' +
'            \'<td><span class="type-badge \' + r.type + \'">\' + r.type + \'</span></td>\' +\n' +
'            \'<td>\' + r.mode + \'</td>\' +\n' +
'            \'<td style="font-size:0.78rem;color:var(--muted)">\' + r.timestamp + \'</td>\' +\n' +
'            \'<td style="font-size:0.78rem;max-width:350px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\' + summary + \'</td></tr>\';\n' +
'        }\n' +
'        html += \'</tbody></table></div>\';\n' +
'        document.getElementById("historyTable").innerHTML = html;\n' +
'        document.getElementById("historyDetail").innerHTML = "";\n' +
'      } catch (e) {\n' +
'        document.getElementById("historyTable").innerHTML = \'<div class="panel">Error: \' + e.message + \'</div>\';\n' +
'      }\n' +
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
'        var label = "#" + r.id + " " + r.type;\n' +
'        labels.push(label);\n' +
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
'          backgroundColor: DB_COLORS[name] + "20",\n' +
'          tension: 0.3,\n' +
'          pointRadius: 3,\n' +
'          pointHoverRadius: 6,\n' +
'          spanGaps: true,\n' +
'          fill: false\n' +
'        });\n' +
'      }\n' +
'\n' +
'      trendChart = new Chart(canvas, {\n' +
'        type: "line",\n' +
'        data: { labels: labels, datasets: datasets },\n' +
'        options: {\n' +
'          responsive: true,\n' +
'          maintainAspectRatio: false,\n' +
'          plugins: {\n' +
'            legend: {\n' +
'              labels: { color: "#94a3b8", usePointStyle: true, pointStyle: "circle" }\n' +
'            },\n' +
'            tooltip: {\n' +
'              backgroundColor: "#1e293b",\n' +
'              titleColor: "#e2e8f0",\n' +
'              bodyColor: "#94a3b8",\n' +
'              borderColor: "#334155",\n' +
'              borderWidth: 1,\n' +
'              cornerRadius: 8\n' +
'            }\n' +
'          },\n' +
'          scales: {\n' +
'            y: {\n' +
'              beginAtZero: true,\n' +
'              grid: { color: "rgba(255,255,255,0.05)" },\n' +
'              ticks: { color: "#94a3b8" },\n' +
'              title: { display: true, text: "Ops/sec", color: "#64748b" }\n' +
'            },\n' +
'            x: {\n' +
'              grid: { color: "rgba(255,255,255,0.03)" },\n' +
'              ticks: { color: "#64748b", maxRotation: 45, font: { size: 10 } }\n' +
'            }\n' +
'          }\n' +
'        }\n' +
'      });\n' +
'    }\n' +
'\n' +
'    async function showRunDetail(id) {\n' +
'      try {\n' +
'        var resp = await fetch("/api/history/" + id);\n' +
'        var run = await resp.json();\n' +
'        var html = \'<div class="panel"><h2>Run #\' + run.id + \' Details</h2>\' +\n' +
'          \'<p class="desc"><span class="type-badge \' + run.type + \'">\' + run.type + \'</span> &bull; Mode: \' + run.mode + \' &bull; \' + run.timestamp + \'</p>\';\n' +
'\n' +
'        if (run.type === "bench" && run.data.benchmarks) {\n' +
'          var benchmarks = run.data.benchmarks;\n' +
'          html += \'<table><thead><tr><th>Database</th><th>Avg</th><th>P50</th><th>P95</th><th>P99</th><th>Stddev</th><th>Ops/s</th><th>Iterations</th></tr></thead><tbody>\';\n' +
'          for (var i = 0; i < benchmarks.length; i++) {\n' +
'            var b = benchmarks[i];\n' +
'            html += \'<tr><td><strong style="color:\' + (DB_COLORS[b.name] || "#818cf8") + \'">\' + b.name + \'</strong></td>\' +\n' +
'              \'<td>\' + b.avg_ms + \'ms</td><td>\' + b.p50_ms + \'ms</td><td>\' + b.p95_ms + \'ms</td>\' +\n' +
'              \'<td>\' + b.p99_ms + \'ms</td><td>\' + b.stddev_ms + \'</td>\' +\n' +
'              \'<td><strong>\' + b.ops_per_sec.toLocaleString() + \'</strong></td>\' +\n' +
'              \'<td>\' + b.iterations + \'</td></tr>\';\n' +
'          }\n' +
'          html += \'</tbody></table>\';\n' +
'        } else if (run.type === "stress" && run.data.results) {\n' +
'          var results = run.data.results;\n' +
'          html += \'<table><thead><tr><th>Database</th><th>Total Ops</th><th>Success</th><th>Errors</th><th>Avg</th><th>P99</th><th>Ops/s</th></tr></thead><tbody>\';\n' +
'          for (var i = 0; i < results.length; i++) {\n' +
'            var r = results[i];\n' +
'            html += \'<tr><td><strong style="color:\' + (DB_COLORS[r.name] || "#818cf8") + \'">\' + r.name + \'</strong></td>\' +\n' +
'              \'<td>\' + r.total_ops + \'</td>\' +\n' +
'              \'<td style="color:var(--green)">\' + r.success + \'</td>\' +\n' +
'              \'<td style="color:\' + (r.errors ? \'var(--red)\' : \'var(--dim)\') + \'">\' + r.errors + \'</td>\' +\n' +
'              \'<td>\' + r.avg_ms + \'ms</td><td>\' + r.p99_ms + \'ms</td>\' +\n' +
'              \'<td><strong>\' + r.ops_per_sec.toLocaleString() + \'</strong></td></tr>\';\n' +
'          }\n' +
'          html += \'</tbody></table>\';\n' +
'        }\n' +
'\n' +
'        html += \'</div>\';\n' +
'        document.getElementById("historyDetail").innerHTML = html;\n' +
'        document.getElementById("historyDetail").scrollIntoView({ behavior: "smooth" });\n' +
'      } catch (e) {\n' +
'        document.getElementById("historyDetail").innerHTML = \'<div class="panel">Error: \' + e.message + \'</div>\';\n' +
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
