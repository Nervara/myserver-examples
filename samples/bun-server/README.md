# bun-server — myserver polyglot connectivity showcase

Single Bun + TypeScript app that probes every database type myserver provisions and renders the results as a dashboard. Used as the recurring end-to-end fixture for env 14 / team 10.

## What it does

- `/` — dashboard with one card per DB (PostgreSQL, MySQL, MariaDB, MongoDB, Redis, ClickHouse, KeyDB, Dragonfly, SQLite). Auto-refreshes via `/api/test`.
- `/health` — flat `OK` (for Docker/Caddy healthcheck).
- `/health/<type>` — per-DB JSON probe. Returns 200 on connect, 503 on error. Designed for `curl --fail` in CI.
  - Accepts: `postgres`, `postgresql`, `mysql`, `mariadb`, `mongo`, `mongodb`, `redis`, `clickhouse`, `keydb`, `dragonfly`.
  - `?write=1` — also runs INSERT → SELECT-back → DELETE per DB. Cleans up its own row. Catches the failure modes a `SELECT 1` probe can't see: URL-shape regressions silently routing to a read-only replica, credential drift, disk-full on a volume, schema-privilege loss after restore. The response gains a `write: {ok, latencyMs, error?}` field and the overall `ok` requires both probes to pass.
- `/api/test` — JSON connectivity report across all configured DBs.
- `/api/bench?n=N&mode=...` — micro-benchmark (PG/MySQL/MariaDB/Redis only).
- `/api/stress?c=N&ops=N` — concurrent stress test.
- `/api/history` — SQLite-backed run history for benches.

## Environment variables

Each `<TYPE>_URL` is independent — omit any one and that chip renders "not configured". The app does NOT require all to be present.

| Env var | Maps to | myserver DB type |
|---|---|---|
| `POSTGRES_URL` | `postgresql://…` | postgresql |
| `MYSQL_URL` | `mysql://…` | mysql |
| `MARIADB_URL` | `mysql://…` (MySQL wire) | mariadb |
| `MONGO_URL` | `mongodb://…?authSource=admin` | mongodb |
| `REDIS_URL` | `redis://…` | redis |
| `CLICKHOUSE_URL` | `http://user:pass@host:8123` | clickhouse |
| `KEYDB_URL` | `redis://…` (Redis wire) | keydb |
| `DRAGONFLY_URL` | `redis://…` (Redis wire) | dragonfly |
| `DATABASE_URL` | `sqlite:///path` or bare path | sqlite resource |

On myserver, wire each via `set_env_var(app_id, key=..., value='${<db-name>.DATABASE_URL}', is_literal=true)` — the deploy pipeline resolves the reference to the live connection string at build time. The DB resource's `name` is what fills the `${...}` slot, so keep names stable.

## Smoke test

```bash
# DB connectivity only (fast, ~10ms per chip)
./smoke.sh https://your-fqdn

# Write-mode (INSERT/SELECT/DELETE per DB — catches RO-replica / cred-drift / disk-full)
./smoke.sh https://your-fqdn --write

# Connectivity + service-FQDN smoke in one pass
./smoke.sh https://your-fqdn --services https://adminer.fqdn https://gitea.fqdn ...
```

Exit 0 only when every configured DB returns ok. "Not set" chips are SKIP not FAIL.

The CI workflow at `.github/workflows/e2e-smoke.yml` runs this nightly against the deployed e2e-polyglot fixture in env 14 (team 10 / green server 8).

## Local development

```bash
bun install
POSTGRES_URL=postgres://postgres:postgres@localhost:5432/postgres \
REDIS_URL=redis://localhost:6379 \
bun run index.ts
```
