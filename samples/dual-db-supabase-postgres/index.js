const http = require('http');
const { Pool } = require('pg');

const PORT = process.env.PORT || 3000;
const PG_URL = process.env.PG_URL || '';
const SUPABASE_URL = process.env.SUPABASE_URL || '';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const SUPABASE_DB_URL = process.env.SUPABASE_DB_URL || '';
const SEED_BATCH_SIZE = parseInt(process.env.SEED_BATCH_SIZE || '100', 10);
const MAX_ROWS = parseInt(process.env.MAX_ROWS || '100000', 10);
const RUN_ID = process.env.RUN_ID || `e2e-br-matrix-137-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)}`;

let pgPool = null;
if (PG_URL) {
  pgPool = new Pool({ connectionString: PG_URL, max: 5 });
}
let supabaseDbPool = null;
if (SUPABASE_DB_URL) {
  supabaseDbPool = new Pool({ connectionString: SUPABASE_DB_URL, max: 3 });
}

function supabaseHeaders() {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
    'apikey': SUPABASE_SERVICE_ROLE_KEY,
  };
}

async function supabaseFetch(path, opts = {}) {
  const url = `${SUPABASE_URL}/rest/v1${path}`;
  const res = await fetch(url, { ...opts, headers: { ...supabaseHeaders(), ...(opts.headers || {}) } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Supabase ${res.status}: ${text.slice(0, 200)}`);
  }
  return res;
}

function json(res, data, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function healthz() {
  const result = { app: 'ok', run_id: RUN_ID, pg: 'not_configured', supabase: 'not_configured' };
  if (pgPool) {
    try {
      const r = await pgPool.query('SELECT 1 as ok');
      result.pg = r.rows[0]?.ok === 1 ? 'connected' : 'error';
    } catch (e) {
      result.pg = `error: ${e.message.slice(0, 100)}`;
    }
  }
  if (SUPABASE_DB_URL) {
    try {
      const r = await supabaseDbPool.query('SELECT 1 as ok');
      result.supabase_db = r.rows[0]?.ok === 1 ? 'connected' : 'error';
    } catch (e) {
      result.supabase_db = `error: ${e.message.slice(0, 100)}`;
    }
  }
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const r = await supabaseFetch('/br_matrix_supabase?select=id&limit=1');
      result.supabase = 'connected';
    } catch (e) {
      result.supabase = `error: ${e.message.slice(0, 100)}`;
    }
  }
  return result;
}

async function seedRows(n) {
  n = Math.min(Math.max(1, n), MAX_ROWS);
  const results = { requested: n, pg_inserted: 0, supabase_inserted: 0, errors: [] };

  // Ensure tables exist (standalone PG - direct; Supabase - via DB URL for CREATE, REST API for data)
  if (pgPool) {
    await pgPool.query(`
      CREATE TABLE IF NOT EXISTS br_matrix_pg (
        id SERIAL PRIMARY KEY,
        run_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        value TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);
  }

  if (supabaseDbPool) {
    try {
      await supabaseDbPool.query(`
        CREATE TABLE IF NOT EXISTS br_matrix_supabase (
          id SERIAL PRIMARY KEY,
          run_id TEXT NOT NULL,
          seq INTEGER NOT NULL,
          value TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    } catch (e) {
      results.errors.push(`supabase table create: ${e.message.slice(0, 100)}`);
    }
  }

  // Seed PG in batches
  if (pgPool) {
    let pgCount = 0;
    for (let i = 0; i < n; i += SEED_BATCH_SIZE) {
      const batch = Math.min(SEED_BATCH_SIZE, n - i);
      const values = [];
      const params = [];
      for (let j = 0; j < batch; j++) {
        const seq = i + j + 1;
        params.push(RUN_ID, seq, `val-${RUN_ID}-${seq}`);
        values.push(`($${params.length - 2}, $${params.length - 1}, $${params.length})`);
      }
      try {
        await pgPool.query(
          `INSERT INTO br_matrix_pg (run_id, seq, value) VALUES ${values.join(', ')}`,
          params
        );
        pgCount += batch;
      } catch (e) {
        results.errors.push(`pg batch ${i}: ${e.message.slice(0, 100)}`);
        break;
      }
    }
    results.pg_inserted = pgCount;
  }

  // Seed Supabase in batches
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    let sbCount = 0;
    for (let i = 0; i < n; i += SEED_BATCH_SIZE) {
      const batch = Math.min(SEED_BATCH_SIZE, n - i);
      const rows = [];
      for (let j = 0; j < batch; j++) {
        const seq = i + j + 1;
        rows.push({ run_id: RUN_ID, seq, value: `val-${RUN_ID}-${seq}` });
      }
      try {
        await supabaseFetch('/br_matrix_supabase', {
          method: 'POST',
          body: JSON.stringify(rows),
          headers: { 'Prefer': 'resolution=merge-duplicates' },
        });
        sbCount += batch;
      } catch (e) {
        results.errors.push(`supabase batch ${i}: ${e.message.slice(0, 100)}`);
        break;
      }
    }
    results.supabase_inserted = sbCount;
  }

  return results;
}

async function getCounts() {
  const result = { pg: null, supabase: null };
  if (pgPool) {
    try {
      const r = await pgPool.query('SELECT COUNT(*)::int as cnt FROM br_matrix_pg');
      result.pg = r.rows[0].cnt;
    } catch (e) {
      result.pg = `error: ${e.message.slice(0, 100)}`;
    }
  }
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const r = await supabaseFetch('/br_matrix_supabase?select=id&limit=1', { headers: { 'Prefer': 'count=exact' } });
      result.supabase = parseInt(r.headers.get('content-range')?.split('/')[1] || '0', 10);
    } catch (e) {
      result.supabase = `error: ${e.message.slice(0, 100)}`;
    }
  }
  return result;
}

async function writeOne() {
  const result = { pg: null, supabase: null, seq: 0 };
  // Get max seq
  if (pgPool) {
    try {
      const r = await pgPool.query('SELECT COALESCE(MAX(seq), 0) + 1 as nxt FROM br_matrix_pg');
      result.seq = r.rows[0].nxt;
      await pgPool.query(
        'INSERT INTO br_matrix_pg (run_id, seq, value) VALUES ($1, $2, $3)',
        [RUN_ID + '-post', result.seq, `post-restore-${result.seq}`]
      );
      result.pg = 'written';
    } catch (e) {
      result.pg = `error: ${e.message.slice(0, 100)}`;
    }
  }
  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    try {
      await supabaseFetch('/br_matrix_supabase', {
        method: 'POST',
        body: JSON.stringify({ run_id: RUN_ID + '-post', seq: result.seq, value: `post-restore-${result.seq}` }),
        headers: { 'Prefer': 'resolution=merge-duplicates' },
      });
      result.supabase = 'written';
    } catch (e) {
      result.supabase = `error: ${e.message.slice(0, 100)}`;
    }
  }
  return result;
}

async function verifyCounts(expected) {
  const counts = await getCounts();
  const pgOk = typeof counts.pg === 'number' && counts.pg >= expected;
  const sbOk = typeof counts.supabase === 'number' && counts.supabase >= expected;
  const samples = { pg: [], supabase: [] };

  if (pgPool) {
    try {
      const r = await pgPool.query('SELECT id, seq, value FROM br_matrix_pg ORDER BY id LIMIT 3');
      samples.pg = r.rows;
    } catch (e) {}
  }

  if (SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
    try {
      const r = await supabaseFetch('/br_matrix_supabase?select=id,seq,value&limit=3');
      const data = await r.json();
      samples.supabase = data;
    } catch (e) {}
  }

  return {
    expected,
    counts,
    pg_ok: pgOk,
    supabase_ok: sbOk,
    all_ok: pgOk && sbOk,
    samples,
  };
}

// Routes
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  try {
    if (req.method === 'GET' && url.pathname === '/healthz') {
      return json(res, await healthz());
    }
    if (req.method === 'POST' && url.pathname === '/seed') {
      const n = parseInt(url.searchParams.get('rows') || '1000', 10);
      return json(res, await seedRows(n));
    }
    if (req.method === 'GET' && url.pathname === '/counts') {
      return json(res, await getCounts());
    }
    if (req.method === 'POST' && url.pathname === '/write-one') {
      return json(res, await writeOne());
    }
    if (req.method === 'GET' && url.pathname === '/verify') {
      const n = parseInt(url.searchParams.get('expected') || '1000', 10);
      return json(res, await verifyCounts(n));
    }
    json(res, { error: 'not found' }, 404);
  } catch (e) {
    json(res, { error: e.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`dual-db app listening on port ${PORT}`);
  console.log(`PG_URL: ${PG_URL ? 'configured' : 'not set'}`);
  console.log(`SUPABASE_URL: ${SUPABASE_URL ? 'configured' : 'not set'}`);
  console.log(`RUN_ID: ${RUN_ID}`);
});
