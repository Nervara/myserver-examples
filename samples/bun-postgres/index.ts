import { Client } from "pg";

const PORT = Number(process.env.PORT ?? 3000);
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}

const client = new Client({ connectionString: DATABASE_URL });
await client.connect();

// Ensure the events table exists on boot.
await client.query(`
  CREATE TABLE IF NOT EXISTS events (
    id bigserial PRIMARY KEY,
    seq bigint,
    created_at timestamptz
  )
`);

let counter = 0;

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);

    // Health check.
    if (url.pathname === "/healthz" && req.method === "GET") {
      return Response.json({ ok: true });
    }

    // Insert one event. Body may carry { seq }; otherwise an in-process counter.
    if (url.pathname === "/write" && req.method === "POST") {
      let seq: number | undefined;
      try {
        const body = await req.json();
        seq = body?.seq;
      } catch {}
      if (seq === undefined) seq = ++counter;

      try {
        await client.query(
          "INSERT INTO events (seq, created_at) VALUES ($1, now())",
          [seq],
        );
        return Response.json({ ok: true, seq });
      } catch (err) {
        console.error("write error", err);
        return Response.json({ ok: false }, { status: 500 });
      }
    }

    // Current row count and max seq — used to assert writes progressed.
    if (url.pathname === "/count" && req.method === "GET") {
      try {
        const res = await client.query(
          "SELECT count(*)::int AS count, max(seq) AS max_seq FROM events",
        );
        return Response.json(res.rows[0]);
      } catch (err) {
        return Response.json({ count: 0, max_seq: null }, { status: 500 });
      }
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`bun-postgres listening on :${PORT}`);
