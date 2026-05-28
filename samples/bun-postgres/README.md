# bun-postgres

Minimal Bun + TypeScript HTTP server backed by PostgreSQL. Purpose-built as the
fixture for the **backup-under-load** end-to-end test: stream continuous writes
while a `pg_dump` backup runs, and assert zero write errors (zero-downtime
backup).

## Contract

- **Build pack:** `dockerfile`
- **Listen port:** `3000` (honours `$PORT`)
- **Required env:** `DATABASE_URL` — a PostgreSQL connection string. In myserver,
  set it to the provisioned database resource's `internal_db_url`.

## Endpoints

- `GET /healthz` → `{ ok: true }`. Also creates the `events` table on boot.
- `POST /write` (body `{ "seq": <n> }`, optional) → inserts one row into
  `events`; returns `{ ok: true, seq }`. The streaming writer hammers this.
- `GET /count` → `{ count, max_seq }` over `events` — used to assert writes
  progressed across the backup window.

## Schema

```sql
CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  seq bigint,
  created_at timestamptz
);
```
