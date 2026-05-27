import pg from "pg";
import mysql from "mysql2/promise";
import Redis from "ioredis";
import { MongoClient } from "mongodb";
import { createClient as createClickHouseClient } from "@clickhouse/client";
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync } from "fs";
import { dirname } from "path";

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
// Resolution order:
//   1. DATABASE_URL — accepts sqlite:///path (Python URI), jdbc:sqlite:/path
//      (JDBC), file:/path (Prisma/Go), or a bare /path. Set this manually
//      to point at the file mounted by a myserver SQLite resource.
//   2. ${DATA_DIR}/history.sqlite — falls back to /data so the file
//      lands on a mounted volume, not the ephemeral container fs
function resolveSqlitePath(): string {
  const url = (process.env.DATABASE_URL || "").trim();
  if (url) {
    // Strip the most common SQLite URL prefixes — bun:sqlite wants the
    // bare filesystem path, not a URL. Matches what `myserver` shows on
    // its SQLite resource detail page.
    if (url.startsWith("sqlite://"))      return url.replace(/^sqlite:\/\//, "");
    if (url.startsWith("jdbc:sqlite:"))   return url.replace(/^jdbc:sqlite:/, "");
    if (url.startsWith("file:"))          return url.replace(/^file:/, "").split("?")[0];
    if (url.startsWith("/"))              return url; // bare absolute path
  }
  const dataDir = process.env.DATA_DIR || "/data";
  return `${dataDir}/history.sqlite`;
}
const HISTORY_DB_PATH = resolveSqlitePath();
const historyDir = dirname(HISTORY_DB_PATH);
if (historyDir && historyDir !== "." && !existsSync(historyDir)) {
  mkdirSync(historyDir, { recursive: true });
}
const historyDb = new Database(HISTORY_DB_PATH, { create: true });
historyDb.run("PRAGMA journal_mode = WAL");
historyDb.run("PRAGMA busy_timeout = 5000");
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

// ── SQLite connectivity check ────────────────────────────────────
// Always-available because the bun:sqlite import opens a local file —
// no env var required. Distinguishes between "DATABASE_URL pointed us at
// this file" (custom path, user-managed) vs "no DATABASE_URL set, using
// the default DATA_DIR/history.sqlite fallback".
function testSqlite(): DBResult {
  const start = performance.now();
  try {
    const ver = historyDb.query<{ v: string }, []>("SELECT sqlite_version() as v").get()!;
    const rows = historyDb.query<{ c: number }, []>("SELECT count(*) as c FROM runs").get()!;
    // PRAGMA returns a column literally named "journal_mode" — alias it
    // so the typed Bun query lines up with the destructure.
    const journal = historyDb.query<{ j: string }, []>("SELECT journal_mode AS j FROM pragma_journal_mode").get()!;
    const userSet = !!(process.env.DATABASE_URL || "").trim();
    return {
      name: userSet ? "SQLite (DATABASE_URL)" : "SQLite (local)",
      type: "sqlite",
      host: HISTORY_DB_PATH,
      status: "connected",
      latency_ms: Math.round(performance.now() - start),
      details: `SQLite ${ver.v} | journal=${journal.j} | rows=${rows.c}` + (userSet ? " | path from DATABASE_URL" : " | DATABASE_URL not set — using fallback path"),
    };
  } catch (e: any) {
    return {
      name: "SQLite",
      type: "sqlite",
      host: HISTORY_DB_PATH,
      status: "error",
      latency_ms: Math.round(performance.now() - start),
      error: e.message,
    };
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

// ── MongoDB client ───────────────────────────────────────────────
// `family: 4` forces IPv4 — Bun's getaddrinfo otherwise tries AAAA first
// on Docker bridge networks where MongoDB only listens on IPv4 and stalls
// for the full 30s socket timeout. `serverSelectionTimeoutMS: 3000` makes
// a broken DB fail fast so the dashboard's other chips stay responsive.
const mongoClient = process.env.MONGO_URL
  ? new MongoClient(process.env.MONGO_URL, {
      serverSelectionTimeoutMS: 3000,
      connectTimeoutMS: 5000,
      family: 4,
    })
  : null;
let mongoConnected = false;

async function testMongo(): Promise<DBResult> {
  if (!mongoClient) return { name: "MongoDB", type: "mongodb", host: "-", status: "error", latency_ms: 0, error: "MONGO_URL not set" };
  const start = performance.now();
  try {
    if (!mongoConnected) { await mongoClient.connect(); mongoConnected = true; }
    const admin = mongoClient.db().admin();
    const info = await admin.serverStatus();
    return {
      name: "MongoDB", type: "mongodb",
      host: process.env.MONGO_URL?.replace(/\/\/.*@/, "//***@") || "",
      status: "connected", latency_ms: Math.round(performance.now() - start),
      details: `MongoDB ${info.version} | host=${info.host} | uptime=${Math.round(info.uptime || 0)}s`,
    };
  } catch (e: any) {
    return { name: "MongoDB", type: "mongodb", host: process.env.MONGO_URL?.replace(/\/\/.*@/, "//***@") || "", status: "error", latency_ms: Math.round(performance.now() - start), error: e.message?.replace(/\/\/[^@]*@/g, "//***@").replace(/password[= ][^\s;,)]+/gi, "password=***") };
  }
}

// ── ClickHouse client ────────────────────────────────────────────
// myserver's resolved ${e2e-clickhouse.DATABASE_URL} points at the native
// TCP port (clickhouse://user:pass@host:9000/db). The npm @clickhouse/client
// drives the HTTP interface, so normalize the scheme + port. Set
// CLICKHOUSE_HTTP_URL explicitly to skip this rewrite when running against
// a non-myserver ClickHouse that already exposes only HTTP.
function clickhouseHttpURL(): string | undefined {
  const direct = process.env.CLICKHOUSE_HTTP_URL?.trim();
  if (direct) return direct;
  const raw = process.env.CLICKHOUSE_URL?.trim();
  if (!raw) return undefined;
  return raw
    .replace(/^clickhouse:\/\//, "http://")
    .replace(/:9000(\/|$)/, ":8123$1");
}
const chURL = clickhouseHttpURL();
const chClient = chURL ? createClickHouseClient({ url: chURL, request_timeout: 5000 }) : null;

async function testClickHouse(): Promise<DBResult> {
  if (!chClient) return { name: "ClickHouse", type: "clickhouse", host: "-", status: "error", latency_ms: 0, error: "CLICKHOUSE_URL not set" };
  const hostDisplay = chURL?.replace(/\/\/.*@/, "//***@") || "";
  const start = performance.now();
  try {
    const rs = await chClient.query({ query: "SELECT version() AS v, currentDatabase() AS db, hostName() AS host", format: "JSONEachRow" });
    const rows = await rs.json() as Array<{ v: string; db: string; host: string }>;
    const r = rows[0] || { v: "unknown", db: "?", host: "?" };
    return {
      name: "ClickHouse", type: "clickhouse",
      host: hostDisplay,
      status: "connected", latency_ms: Math.round(performance.now() - start),
      details: `ClickHouse ${r.v} | db=${r.db} | host=${r.host}`,
    };
  } catch (e: any) {
    return { name: "ClickHouse", type: "clickhouse", host: hostDisplay, status: "error", latency_ms: Math.round(performance.now() - start), error: e.message?.replace(/\/\/[^@]*@/g, "//***@").replace(/password[= ][^\s;,)]+/gi, "password=***") };
  }
}

// ── KeyDB + Dragonfly (both speak Redis wire protocol, reuse ioredis) ──
const keydbClient = process.env.KEYDB_URL
  ? new Redis(process.env.KEYDB_URL, { maxRetriesPerRequest: 1, connectTimeout: 5000, lazyConnect: true })
  : null;
const dragonflyClient = process.env.DRAGONFLY_URL
  ? new Redis(process.env.DRAGONFLY_URL, { maxRetriesPerRequest: 1, connectTimeout: 5000, lazyConnect: true })
  : null;

async function testRedisFamily(label: string, type: string, client: Redis | null, url: string | undefined): Promise<DBResult> {
  if (!client) return { name: label, type, host: "-", status: "error", latency_ms: 0, error: `${type.toUpperCase()}_URL not set` };
  const start = performance.now();
  try {
    if (client.status === "wait") await client.connect();
    const info = await client.info("server");
    // KeyDB reports itself as redis_version + keydb_version; Dragonfly reports redis_version + dragonfly_version
    const version = info.match(/redis_version:(.+)/)?.[1]?.trim() || "unknown";
    const flavor = info.match(/keydb_version:(.+)/)?.[1]?.trim()
                || info.match(/dragonfly_version:(.+)/)?.[1]?.trim()
                || "";
    const key = `disco:ping:${Date.now()}`;
    await client.set(key, "pong", "EX", 10);
    await client.get(key);
    await client.del(key);
    return {
      name: label, type,
      host: url?.replace(/:.*@/, ":***@") || "",
      status: "connected", latency_ms: Math.round(performance.now() - start),
      details: `${label} ${flavor || version} (wire=redis ${version})`,
    };
  } catch (e: any) {
    return { name: label, type, host: url?.replace(/:.*@/, ":***@") || "", status: "error", latency_ms: Math.round(performance.now() - start), error: e.message?.replace(/\/\/[^@]*@/g, "//***@").replace(/password[= ][^\s;,)]+/gi, "password=***") };
  }
}

const testKeyDB     = () => testRedisFamily("KeyDB",     "keydb",     keydbClient,     process.env.KEYDB_URL);
const testDragonfly = () => testRedisFamily("Dragonfly", "dragonfly", dragonflyClient, process.env.DRAGONFLY_URL);

// ── Write-mode round-trip probes ─────────────────────────────────
// INSERT → SELECT-back → DELETE per DB. Catches the failure modes a
// connectivity probe can't see: URL rewrites that silently route to a
// read-only replica, credential drift, disk-full on a volume, schema
// privilege loss after a backup/restore. Every probe uses a per-call
// unique key/id so concurrent CI runs don't collide, and cleans up its
// own row so the table doesn't grow unbounded.
async function writeRoundTrip(slug: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  const t0 = performance.now();
  const sentinel = `disco-wr-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    switch (slug) {
      case "postgres": case "postgresql": {
        if (!pgPool) throw new Error("POSTGRES_URL not set");
        const c = await pgPool.connect();
        try {
          await c.query("CREATE TABLE IF NOT EXISTS _wrcheck(k TEXT PRIMARY KEY, v TEXT)");
          await c.query("INSERT INTO _wrcheck(k,v) VALUES($1,$2)", [sentinel, "ok"]);
          const r = await c.query("SELECT v FROM _wrcheck WHERE k=$1", [sentinel]);
          await c.query("DELETE FROM _wrcheck WHERE k=$1", [sentinel]);
          if (r.rows[0]?.v !== "ok") throw new Error("readback mismatch");
        } finally { c.release(); }
        break;
      }
      case "mysql": case "mariadb": {
        const pool = slug === "mysql" ? mysqlPool : mariaPool;
        if (!pool) throw new Error(`${slug.toUpperCase()}_URL not set`);
        await pool.query("CREATE TABLE IF NOT EXISTS _wrcheck(k VARCHAR(64) PRIMARY KEY, v VARCHAR(8))");
        await pool.query("INSERT INTO _wrcheck(k,v) VALUES(?,?)", [sentinel, "ok"]);
        const [rows] = await pool.query("SELECT v FROM _wrcheck WHERE k=?", [sentinel]) as any;
        await pool.query("DELETE FROM _wrcheck WHERE k=?", [sentinel]);
        if (rows[0]?.v !== "ok") throw new Error("readback mismatch");
        break;
      }
      case "mongo": case "mongodb": {
        if (!mongoClient) throw new Error("MONGO_URL not set");
        if (!mongoConnected) { await mongoClient.connect(); mongoConnected = true; }
        const coll = mongoClient.db().collection("_wrcheck");
        await coll.insertOne({ _id: sentinel as any, v: "ok" });
        const doc = await coll.findOne({ _id: sentinel as any });
        await coll.deleteOne({ _id: sentinel as any });
        if ((doc as any)?.v !== "ok") throw new Error("readback mismatch");
        break;
      }
      case "redis": case "keydb": case "dragonfly": {
        const client = slug === "redis" ? redisClient : slug === "keydb" ? keydbClient : dragonflyClient;
        if (!client) throw new Error(`${slug.toUpperCase()}_URL not set`);
        if (client.status === "wait") await client.connect();
        await client.set(`_wrcheck:${sentinel}`, "ok", "EX", 30);
        const v = await client.get(`_wrcheck:${sentinel}`);
        await client.del(`_wrcheck:${sentinel}`);
        if (v !== "ok") throw new Error("readback mismatch");
        break;
      }
      case "clickhouse": {
        if (!chClient) throw new Error("CLICKHOUSE_URL not set");
        // CH has no temp tables in the HTTP client sense; use Memory engine —
        // dies with the server, so it's effectively per-process cleanup if we
        // forget to drop. We drop explicitly anyway.
        await chClient.command({ query: "CREATE TABLE IF NOT EXISTS _wrcheck (k String, v String) ENGINE = Memory" });
        await chClient.insert({ table: "_wrcheck", values: [{ k: sentinel, v: "ok" }], format: "JSONEachRow" });
        const rs = await chClient.query({ query: `SELECT v FROM _wrcheck WHERE k='${sentinel.replace(/'/g, "''")}'`, format: "JSONEachRow" });
        const rows = await rs.json() as Array<{ v: string }>;
        await chClient.command({ query: `ALTER TABLE _wrcheck DELETE WHERE k='${sentinel.replace(/'/g, "''")}'` });
        if (rows[0]?.v !== "ok") throw new Error("readback mismatch");
        break;
      }
      default:
        throw new Error(`write-mode not implemented for ${slug}`);
    }
    return { ok: true, latencyMs: Math.round(performance.now() - t0) };
  } catch (e: any) {
    return { ok: false, latencyMs: Math.round(performance.now() - t0), error: String(e.message || e).slice(0, 200) };
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

// Ensure bench tables exist once (called before benchmarks/stress, not per-op).
// Idempotent; safe to call repeatedly.
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
  if (mongoClient) {
    if (!mongoConnected) { await mongoClient.connect(); mongoConnected = true; }
    // Mongo collections are lazy — no CREATE step needed. Index on `n` so
    // the "complex" bench mode's range query isn't a collection scan.
    await mongoClient.db().collection("_bench").createIndex({ n: 1 }).catch(() => {});
  }
  if (chClient) {
    // Memory engine — cheap, no on-disk footprint, dies with the server.
    // Sufficient for bench; production would use MergeTree.
    await chClient.command({ query: "CREATE TABLE IF NOT EXISTS _bench (id UInt32, val String, n UInt32, ts DateTime DEFAULT now()) ENGINE = Memory" });
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

// Parameterized over the client so KeyDB + Dragonfly can reuse it — they
// speak the Redis wire protocol so the ops are identical.
function redisFamilyQueries(client: Redis | null, mode: string): QueryFn {
  if (!client) return async () => {};
  switch (mode) {
    case "write":
      return async () => {
        const key = `bench:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
        await client.set(key, JSON.stringify({ ts: Date.now(), val: Math.random() }), "EX", 60);
      };
    case "read_write":
      return async () => {
        const key = `bench:rw:${Math.random().toString(36).slice(2, 8)}`;
        await client.set(key, JSON.stringify({ ts: Date.now(), val: Math.random() }), "EX", 60);
        await client.get(key);
        await client.incr("bench:counter");
        await client.lpush("bench:log", `${Date.now()}`);
        await client.ltrim("bench:log", 0, 99);
        await client.del(key);
      };
    case "pipeline":
      return async () => {
        const pipe = client.pipeline();
        for (let i = 0; i < 10; i++) {
          pipe.set(`bench:pipe:${i}`, `val-${Date.now()}`, "EX", 60);
          pipe.get(`bench:pipe:${i}`);
        }
        await pipe.exec();
      };
    case "complex":
      return async () => {
        const key = `bench:hash:${Math.random().toString(36).slice(2, 6)}`;
        await client.hset(key, { name: "test", score: String(Math.random() * 100 | 0), ts: String(Date.now()) });
        await client.hgetall(key);
        await client.zadd("bench:leaderboard", Math.random() * 1000 | 0, key);
        await client.zrangebyscore("bench:leaderboard", "-inf", "+inf", "LIMIT", 0, 10);
        await client.expire(key, 60);
      };
    default:
      return async () => { await client.ping(); };
  }
}

// Back-compat alias — many call sites read `redisQueries(mode)`.
const redisQueries = (mode: string) => redisFamilyQueries(redisClient, mode);

// ── MongoDB bench queries ────────────────────────────────────────
function mongoQueries(mode: string): QueryFn {
  if (!mongoClient) return async () => {};
  const coll = () => mongoClient!.db().collection("_bench");
  switch (mode) {
    case "write":
      return async () => {
        await coll().insertOne({ val: `row-${Date.now()}`, n: Math.random() * 1000 | 0, ts: new Date() });
      };
    case "read_write":
      return async () => {
        const ins = await coll().insertOne({ val: `rw-${Date.now()}`, n: Math.random() * 1000 | 0, ts: new Date() });
        await coll().aggregate([{ $group: { _id: null, cnt: { $sum: 1 }, avg_n: { $avg: "$n" }, max_n: { $max: "$n" } } }]).toArray();
        await coll().deleteOne({ _id: ins.insertedId });
      };
    case "transaction":
      return async () => {
        // Standalone Mongo (no replica set) refuses real transactions —
        // simulate with bulkWrite which is atomic per-document on a single shard.
        await coll().bulkWrite([
          { insertOne: { document: { val: `tx-${Date.now()}`, n: Math.random() * 1000 | 0, ts: new Date() } } },
          { updateOne: { filter: {}, update: { $inc: { n: 1 } } } },
        ]);
        await coll().find().sort({ ts: -1 }).limit(10).toArray();
      };
    case "complex":
      return async () => {
        await coll().insertOne({ val: `cx-${Date.now()}`, n: Math.random() * 10000 | 0, ts: new Date() });
        await coll().aggregate([
          { $sort: { ts: -1 } }, { $limit: 100 },
          { $group: { _id: null, cnt: { $sum: 1 }, avg_n: { $avg: "$n" }, std_n: { $stdDevPop: "$n" } } },
        ]).toArray();
      };
    default: // ping
      return async () => { await mongoClient!.db().admin().ping(); };
  }
}

// ── ClickHouse bench queries ─────────────────────────────────────
// Memory engine table (created in ensureBenchTables). HTTP transport, so
// every op is a round-trip — expect higher latency than wire-protocol DBs.
function clickhouseQueries(mode: string): QueryFn {
  if (!chClient) return async () => {};
  switch (mode) {
    case "write":
      return async () => {
        await chClient.insert({
          table: "_bench",
          values: [{ id: Math.random() * 1e9 | 0, val: `row-${Date.now()}`, n: Math.random() * 1000 | 0 }],
          format: "JSONEachRow",
        });
      };
    case "read_write":
      return async () => {
        await chClient.insert({
          table: "_bench",
          values: [{ id: Math.random() * 1e9 | 0, val: `rw-${Date.now()}`, n: Math.random() * 1000 | 0 }],
          format: "JSONEachRow",
        });
        const rs = await chClient.query({ query: "SELECT count(*) AS cnt, avg(n) AS avg_n, max(n) AS max_n FROM _bench", format: "JSONEachRow" });
        await rs.json();
      };
    case "complex":
      return async () => {
        await chClient.insert({
          table: "_bench",
          values: [{ id: Math.random() * 1e9 | 0, val: `cx-${Date.now()}`, n: Math.random() * 10000 | 0 }],
          format: "JSONEachRow",
        });
        const rs = await chClient.query({
          query: "SELECT count(*) AS cnt, avg(n) AS avg_n, stddevPop(n) AS std_n FROM (SELECT n FROM _bench ORDER BY ts DESC LIMIT 100)",
          format: "JSONEachRow",
        });
        await rs.json();
      };
    default: // ping
      return async () => { const rs = await chClient.query({ query: "SELECT 1", format: "JSONEachRow" }); await rs.json(); };
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
function logLine(level: "info" | "warn" | "error" | "debug", msg: string, fields: Record<string, unknown> = {}) {
  const entry = { ts: new Date().toISOString(), level, msg, pid: process.pid, ...fields };
  const stream = level === "error" ? process.stderr : process.stdout;
  stream.write(JSON.stringify(entry) + "\n");
}

let requestCounter = 0;

const server = Bun.serve({
  port: PORT,
  async fetch(request) {
    const url = new URL(request.url);
    const reqId = (++requestCounter).toString(36);
    logLine("info", "request", { req_id: reqId, method: request.method, path: url.pathname, query: url.search, ua: request.headers.get("user-agent") || "" });

    if (url.pathname === "/health") return new Response("OK");

    // Per-DB health probe — exit-code friendly for smoke.sh / CI gating.
    // Returns 200 on connected, 503 on error so curl --fail trips correctly.
    //
    // Default (?write=0): connect + version()/INFO only. Cheap, ~10ms.
    // ?write=1: INSERT a row, SELECT it back, DELETE it. Catches URL-shape
    //   regressions a SELECT-1 probe misses (e.g. the ClickHouse scheme
    //   rewrite class — connectivity would pass even if the URL pointed at
    //   a read-only replica). Slower (~50-200ms per DB).
    if (url.pathname.startsWith("/health/")) {
      const slug = url.pathname.slice("/health/".length).toLowerCase();
      const wantWrite = url.searchParams.get("write") === "1";
      const probeMap: Record<string, () => Promise<DBResult>> = {
        postgres:   testPostgres,   postgresql: testPostgres,
        mysql:      testMySQL,
        mariadb:    testMariaDB,
        mongo:      testMongo,      mongodb:    testMongo,
        redis:      testRedis,
        clickhouse: testClickHouse,
        keydb:      testKeyDB,
        dragonfly:  testDragonfly,
      };
      const probe = probeMap[slug];
      if (!probe) return Response.json({ error: `unknown db type: ${slug}`, available: Object.keys(probeMap) }, { status: 404 });
      const r = await probe();
      // If write-mode requested AND the connect probe passed, exercise the
      // round-trip. A connect-pass + write-fail surfaces as a 503 so CI gates
      // catch credential drift / RO-replica routing / disk-full silently.
      let write: { ok: boolean; latencyMs: number; error?: string } | undefined;
      if (wantWrite && r.status === "connected") {
        write = await writeRoundTrip(slug);
      }
      const overallOk = r.status === "connected" && (!wantWrite || (write?.ok ?? false));
      return Response.json({
        ok: overallOk,
        type: r.type,
        latencyMs: r.latency_ms,
        write,
        probedAt: new Date().toISOString(),
        target: r.host,
        details: r.details,
        error: r.error,
      }, { status: overallOk ? 200 : 503 });
    }

    // API: connectivity test
    if (url.pathname === "/api/test") {
      const results = await Promise.all([
        testPostgres(), testMySQL(), testMariaDB(),
        testMongo(), testRedis(), testClickHouse(),
        testKeyDB(), testDragonfly(),
        Promise.resolve(testSqlite()),
      ]);
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
        mongoClient ? runBenchmark("MongoDB", mongoQueries(mode), n) : null,
        (redisClient && redisClient.status !== "wait") ? runBenchmark("Redis", redisFamilyQueries(redisClient, mode), n) : null,
        chClient ? runBenchmark("ClickHouse", clickhouseQueries(mode), n) : null,
        (keydbClient && keydbClient.status !== "wait") ? runBenchmark("KeyDB", redisFamilyQueries(keydbClient, mode), n) : null,
        (dragonflyClient && dragonflyClient.status !== "wait") ? runBenchmark("Dragonfly", redisFamilyQueries(dragonflyClient, mode), n) : null,
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
        mongoClient ? stressTest("MongoDB", mongoQueries("read_write"), concurrency, ops) : null,
        (redisClient && redisClient.status !== "wait") ? stressTest("Redis", redisFamilyQueries(redisClient, "read_write"), concurrency, ops) : null,
        chClient ? stressTest("ClickHouse", clickhouseQueries("read_write"), concurrency, ops) : null,
        (keydbClient && keydbClient.status !== "wait") ? stressTest("KeyDB", redisFamilyQueries(keydbClient, "read_write"), concurrency, ops) : null,
        (dragonflyClient && dragonflyClient.status !== "wait") ? stressTest("Dragonfly", redisFamilyQueries(dragonflyClient, "read_write"), concurrency, ops) : null,
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
    :root {
      --bg: #f7f8fa; --card: #fff; --border: #e5e7eb; --border-light: #f3f4f6;
      --text: #1f2937; --text-secondary: #6b7280; --text-muted: #9ca3af;
      --btn-bg: #fff; --btn-hover: #f3f4f6; --pill-bg: #f3f4f6;
      --skeleton-a: #f3f4f6; --skeleton-b: #e5e7eb;
      --badge-blue-bg: #eff6ff; --badge-blue: #2563eb;
      --badge-green-bg: #f0fdf4; --badge-green: #16a34a;
      --badge-orange-bg: #fff7ed; --badge-orange: #ea580c;
      --badge-red-bg: #fef2f2; --badge-red: #dc2626;
      --hover-row: #fafafa; --pre-bg: #f9fafb;
      --chart-grid: #f3f4f6; --chart-text: #6b7280;
      --select-bg: #fff;
    }
    [data-theme="dark"] {
      --bg: #0b0d0f; --card: #141619; --border: #23272e; --border-light: #1c1f25;
      --text: #e5e7eb; --text-secondary: #9ca3af; --text-muted: #6b7280;
      --btn-bg: #1c1f25; --btn-hover: #23272e; --pill-bg: #1c1f25;
      --skeleton-a: #1c1f25; --skeleton-b: #23272e;
      --badge-blue-bg: #172554; --badge-blue: #60a5fa;
      --badge-green-bg: #052e16; --badge-green: #4ade80;
      --badge-orange-bg: #431407; --badge-orange: #fb923c;
      --badge-red-bg: #450a0a; --badge-red: #f87171;
      --hover-row: #1c1f25; --pre-bg: #1c1f25;
      --chart-grid: #23272e; --chart-text: #6b7280;
      --select-bg: #1c1f25;
    }
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: "Inter", -apple-system, BlinkMacSystemFont, sans-serif; background: var(--bg); color: var(--text); line-height: 1.5; -webkit-font-smoothing: antialiased; transition: background 0.2s, color 0.2s; }
    .container { max-width: 1200px; margin: 0 auto; padding: 0 24px; }
    .grid-4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px; }
    .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; }
    .grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; }
    .card { background: var(--card); border-radius: 16px; border: 1px solid var(--border); box-shadow: 0 1px 3px rgba(0,0,0,0.04); padding: 20px; transition: background 0.2s, border-color 0.2s; }
    .card-bordered { border-left: 3px solid var(--border); }
    .card-pg { border-left-color: #4F7BEF; }
    .card-mysql { border-left-color: #00A7D0; }
    .card-mariadb { border-left-color: #C4784F; }
    .card-mongo { border-left-color: #00684A; }
    .card-redis { border-left-color: #E84D3D; }
    .card-clickhouse { border-left-color: #FFCC02; }
    .card-keydb { border-left-color: #319D7E; }
    .card-dragonfly { border-left-color: #DC382D; }
    .card-sqlite { border-left-color: #003B57; }
    .btn { display: inline-flex; align-items: center; justify-content: center; padding: 8px 16px; border-radius: 8px; border: 1px solid var(--border); background: var(--btn-bg); color: var(--text); font-size: 13px; font-weight: 500; cursor: pointer; transition: all 0.15s ease; font-family: inherit; }
    .btn:hover { background: var(--btn-hover); border-color: var(--text-muted); }
    .btn:active { transform: scale(0.97); }
    .btn-primary { background: #4F7BEF; color: #fff; border-color: #4F7BEF; }
    .btn-primary:hover { background: #3b65d9; border-color: #3b65d9; }
    .btn-danger { background: var(--btn-bg); color: #E84D3D; border-color: #fca5a5; }
    .btn-danger:hover { background: var(--badge-red-bg); border-color: #E84D3D; }
    .btn-sm { padding: 5px 10px; font-size: 12px; }
    .btn-group { display: flex; gap: 6px; flex-wrap: wrap; }
    .tab-bar { display: flex; border-bottom: 2px solid var(--border); margin-bottom: 24px; gap: 0; }
    .tab { padding: 10px 20px; font-size: 14px; font-weight: 500; color: var(--text-secondary); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all 0.15s ease; background: none; border-top: none; border-left: none; border-right: none; font-family: inherit; }
    .tab:hover { color: var(--text); }
    .tab-active { color: #4F7BEF; border-bottom-color: #4F7BEF; }
    .badge { display: inline-flex; align-items: center; padding: 2px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; }
    .badge-blue { background: var(--badge-blue-bg); color: var(--badge-blue); }
    .badge-green { background: var(--badge-green-bg); color: var(--badge-green); }
    .badge-orange { background: var(--badge-orange-bg); color: var(--badge-orange); }
    .badge-red { background: var(--badge-red-bg); color: var(--badge-red); }
    .badge-gray { background: var(--pill-bg); color: var(--text-secondary); }
    .stat-card { text-align: center; }
    .stat-value { font-size: 28px; font-weight: 700; color: var(--text); line-height: 1.2; }
    .stat-label { font-size: 12px; color: var(--text-muted); font-weight: 500; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
    .table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th { text-align: left; padding: 10px 12px; font-weight: 600; color: var(--text-secondary); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid var(--border); }
    td { padding: 10px 12px; border-bottom: 1px solid var(--border-light); }
    tr:last-child td { border-bottom: none; }
    .text-secondary { color: var(--text-secondary); }
    .text-muted { color: var(--text-muted); }
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
    .skeleton { background: linear-gradient(90deg, var(--skeleton-a) 25%, var(--skeleton-b) 50%, var(--skeleton-a) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 8px; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .spinner { width: 20px; height: 20px; border: 2px solid var(--border); border-top-color: #4F7BEF; border-radius: 50%; animation: spin 0.6s linear infinite; display: inline-block; vertical-align: middle; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .header { padding: 24px 0; }
    .logo { width: 36px; height: 36px; background: #4F7BEF; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #fff; font-weight: 700; font-size: 16px; flex-shrink: 0; }
    .header-title { font-size: 20px; font-weight: 700; }
    .header-sub { font-size: 13px; color: var(--text-secondary); }
    .pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 20px; font-size: 11px; font-weight: 500; background: var(--pill-bg); color: var(--text-secondary); }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; margin-right: 6px; }
    .status-ok { background: #22c55e; }
    .status-err { background: #ef4444; }
    .sparkline { display: inline-flex; align-items: flex-end; gap: 1px; height: 20px; }
    .sparkline-bar { width: 3px; background: #4F7BEF; border-radius: 1px; min-height: 2px; }
    .progress-bar { height: 6px; border-radius: 3px; background: var(--pill-bg); overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 3px; transition: width 0.3s ease; }
    .expand-row { cursor: pointer; }
    .expand-row:hover { background: var(--hover-row); }
    .expand-detail { background: var(--hover-row); }
    .chart-container { position: relative; height: 300px; }
    select { font-family: inherit; font-size: 13px; padding: 7px 28px 7px 10px; border-radius: 8px; border: 1px solid var(--border); background: var(--select-bg); color: var(--text); -webkit-appearance: none; appearance: none; cursor: pointer; }
    select:hover { border-color: var(--text-muted); }
    .empty-state { text-align: center; padding: 60px 20px; color: var(--text-muted); }
    .empty-state-title { font-size: 16px; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }
    .theme-toggle { width: 36px; height: 36px; border-radius: 8px; border: 1px solid var(--border); background: var(--btn-bg); cursor: pointer; display: flex; align-items: center; justify-content: center; font-size: 18px; transition: all 0.15s; }
    .theme-toggle:hover { background: var(--btn-hover); }
    @media (prefers-color-scheme: dark) { :root:not([data-theme]) { --bg: #0b0d0f; --card: #141619; --border: #23272e; --border-light: #1c1f25; --text: #e5e7eb; --text-secondary: #9ca3af; --text-muted: #6b7280; --btn-bg: #1c1f25; --btn-hover: #23272e; --pill-bg: #1c1f25; --skeleton-a: #1c1f25; --skeleton-b: #23272e; --badge-blue-bg: #172554; --badge-blue: #60a5fa; --badge-green-bg: #052e16; --badge-green: #4ade80; --badge-orange-bg: #431407; --badge-orange: #fb923c; --badge-red-bg: #450a0a; --badge-red: #f87171; --hover-row: #1c1f25; --pre-bg: #1c1f25; --chart-grid: #23272e; --chart-text: #6b7280; --select-bg: #1c1f25; } }
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
          <span class="pill" style="background:var(--badge-blue-bg);color:var(--badge-blue)">Server #${process.env.MYSERVER_SERVER_ID || "?"}</span>
          <button class="theme-toggle" onclick="toggleTheme()" id="theme-btn" title="Toggle dark mode"></button>
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
      <div id="cards" class="grid-3">
        <div class="card skeleton" style="height:160px"></div>
        <div class="card skeleton" style="height:160px"></div>
        <div class="card skeleton" style="height:160px"></div>
        <div class="card skeleton" style="height:160px"></div>
        <div class="card skeleton" style="height:160px"></div>
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
    var DB_COLORS = { 'PostgreSQL': '#4F7BEF', 'MySQL': '#00A7D0', 'MariaDB': '#C4784F', 'MongoDB': '#00684A', 'Redis': '#E84D3D', 'ClickHouse': '#FFCC02', 'KeyDB': '#319D7E', 'Dragonfly': '#DC382D', 'SQLite (DATABASE_URL)': '#003B57', 'SQLite (local)': '#6b7280', 'SQLite': '#003B57' };
    var DB_CLASS = { 'PostgreSQL': 'card-pg', 'MySQL': 'card-mysql', 'MariaDB': 'card-mariadb', 'MongoDB': 'card-mongo', 'Redis': 'card-redis', 'ClickHouse': 'card-clickhouse', 'KeyDB': 'card-keydb', 'Dragonfly': 'card-dragonfly', 'SQLite (DATABASE_URL)': 'card-sqlite', 'SQLite (local)': 'card-sqlite', 'SQLite': 'card-sqlite' };
    var benchChart = null;
    var stressChart = null;
    var historyChart = null;

    function isDark() { return document.documentElement.getAttribute('data-theme') === 'dark'; }
    function getChartColors() { return { grid: isDark() ? '#23272e' : '#f3f4f6', text: '#6b7280' }; }
    function updateThemeBtn() { document.getElementById('theme-btn').textContent = isDark() ? '☀' : '☾'; }
    function toggleTheme() {
      var html = document.documentElement;
      if (isDark()) { html.removeAttribute('data-theme'); localStorage.setItem('theme', 'light'); }
      else { html.setAttribute('data-theme', 'dark'); localStorage.setItem('theme', 'dark'); }
      updateThemeBtn();
    }
    (function() {
      var saved = localStorage.getItem('theme');
      if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
        document.documentElement.setAttribute('data-theme', 'dark');
      }
      updateThemeBtn();
    })();

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
          scales: { y: { beginAtZero: true, title: { display: true, text: 'Latency (ms)', font: { family: 'Inter' } }, grid: { color: getChartColors().grid } }, x: { grid: { display: false } } }
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
          scales: { x: { beginAtZero: true, title: { display: true, text: 'Operations per second', font: { family: 'Inter' } }, grid: { color: getChartColors().grid } }, y: { grid: { display: false } } }
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
          scales: { y: { beginAtZero: true, title: { display: true, text: 'Avg Latency (ms)', font: { family: 'Inter' } }, grid: { color: getChartColors().grid } }, x: { grid: { display: false } } }
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
logLine("info", "server.started", { port: server.port, bun: Bun.version, node_env: process.env.NODE_ENV || "development" });

// Heartbeat: emit mixed-level logs so VictoriaLogs has steady activity to query.
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 5000);
const sampleEvents = [
  { level: "info" as const, msg: "cache.refresh", fields: () => ({ keys: Math.floor(Math.random() * 500), hit_ratio: +(Math.random()).toFixed(3) }) },
  { level: "info" as const, msg: "job.tick", fields: () => ({ queue: "default", pending: Math.floor(Math.random() * 20) }) },
  { level: "debug" as const, msg: "gc.stats", fields: () => ({ heap_mb: +(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1), rss_mb: +(process.memoryUsage().rss / 1024 / 1024).toFixed(1) }) },
  { level: "warn" as const, msg: "slow.query", fields: () => ({ db: ["pg", "mysql", "redis"][Math.floor(Math.random() * 3)], duration_ms: 500 + Math.floor(Math.random() * 2000) }) },
  { level: "error" as const, msg: "upstream.timeout", fields: () => ({ upstream: "analytics", retry: Math.floor(Math.random() * 3), err: "context deadline exceeded" }) },
];
let heartbeatTick = 0;
setInterval(() => {
  heartbeatTick++;
  logLine("info", "heartbeat", { tick: heartbeatTick, uptime_s: Math.round(process.uptime()) });
  if (heartbeatTick % 3 === 0) {
    const ev = sampleEvents[Math.floor(Math.random() * sampleEvents.length)];
    logLine(ev.level, ev.msg, ev.fields());
  }
}, HEARTBEAT_MS);
