/**
 * k6 load test — go-database sample
 *
 * Scenarios
 * ─────────────────────────────────────────────────────────
 *  health_probe       Constant health checks (smoke / availability)
 *  tenant_write       Create / upsert tenants (write-heavy)
 *  facility_ops       Create facilities + read them back (read/write mix)
 *  asset_lifecycle    Create assets, flip states, read back (state machine)
 *  telemetry_ingest   High-throughput telemetry inserts (hot write path)
 *  metrics_read       Read mv_facility_metrics (read-heavy / reporting)
 *  full_flow          The all-in-one /run endpoint (E2E regression)
 *
 * Usage
 * ─────────────────────────────────────────────────────────
 *  k6 run load-test.js
 *  BASE_URL=https://my-server k6 run load-test.js
 *
 * Run a single scenario
 *  k6 run --env SCENARIO=telemetry_ingest load-test.js
 */

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';
import { randomItem } from 'https://jslib.k6.io/k6-utils/1.4.0/index.js';

// ── Config ────────────────────────────────────────────────────────────────────
const BASE_URL   = (__ENV.BASE_URL || 'http://localhost:8080').replace(/\/$/, '');
const SCENARIO   = __ENV.SCENARIO || null; // optional filter

// ── Custom metrics ────────────────────────────────────────────────────────────
const errors        = new Counter('scenario_errors');
const successRate   = new Rate('scenario_success_rate');
const writeDuration = new Trend('write_duration_ms', true);
const readDuration  = new Trend('read_duration_ms',  true);

// ── Shared state (VU-level cache to chain requests) ───────────────────────────
// k6 does not share state between VUs; each VU seeds its own IDs.

// ── Thresholds ────────────────────────────────────────────────────────────────
export const options = {
  scenarios: {

    // ── 1. Health probe ──────────────────────────────────────────────────────
    health_probe: {
      executor:        'constant-arrival-rate',
      rate:            20,            // 20 req/s
      timeUnit:        '1s',
      duration:        '9m',          // runs for the full test duration
      preAllocatedVUs: 5,
      maxVUs:          10,
      exec:            'healthScenario',
      tags:            { scenario: 'health_probe' },
    },

    // ── 2. Tenant writes ─────────────────────────────────────────────────────
    tenant_write: {
      executor:        'ramping-vus',
      startVUs:        0,
      stages: [
        { duration: '30s', target: 5  },
        { duration: '2m',  target: 15 },
        { duration: '2m',  target: 15 },
        { duration: '30s', target: 0  },
      ],
      exec:  'tenantScenario',
      tags:  { scenario: 'tenant_write' },
    },

    // ── 3. Facility ops ──────────────────────────────────────────────────────
    facility_ops: {
      executor:        'ramping-vus',
      startVUs:        0,
      stages: [
        { duration: '1m',  target: 10 },
        { duration: '3m',  target: 10 },
        { duration: '30s', target: 0  },
      ],
      exec:  'facilityScenario',
      tags:  { scenario: 'facility_ops' },
    },

    // ── 4. Asset lifecycle ───────────────────────────────────────────────────
    asset_lifecycle: {
      executor:        'ramping-vus',
      startVUs:        0,
      stages: [
        { duration: '1m',  target: 8  },
        { duration: '3m',  target: 20 },
        { duration: '1m',  target: 40 }, // stress spike
        { duration: '1m',  target: 8  },
        { duration: '30s', target: 0  },
      ],
      exec:  'assetScenario',
      tags:  { scenario: 'asset_lifecycle' },
    },

    // ── 5. Telemetry ingest (hot write path) ─────────────────────────────────
    telemetry_ingest: {
      executor:        'constant-arrival-rate',
      rate:            50,            // 50 inserts/s
      timeUnit:        '1s',
      duration:        '5m',
      preAllocatedVUs: 20,
      maxVUs:          100,
      exec:            'telemetryScenario',
      tags:            { scenario: 'telemetry_ingest' },
    },

    // ── 6. Metrics read ──────────────────────────────────────────────────────
    metrics_read: {
      executor:        'constant-arrival-rate',
      rate:            10,
      timeUnit:        '1s',
      duration:        '5m',
      preAllocatedVUs: 5,
      maxVUs:          30,
      exec:            'metricsScenario',
      tags:            { scenario: 'metrics_read' },
    },

    // ── 7. Full E2E flow ─────────────────────────────────────────────────────
    full_flow: {
      executor:  'ramping-vus',
      startVUs:  0,
      stages: [
        { duration: '30s', target: 1  },
        { duration: '3m',  target: 5  },
        { duration: '1m',  target: 15 }, // stress
        { duration: '1m',  target: 5  },
        { duration: '30s', target: 0  },
      ],
      exec:  'fullFlowScenario',
      tags:  { scenario: 'full_flow' },
    },

  },

  thresholds: {
    // Health: very tight — this must never degrade
    'http_req_duration{scenario:health_probe}': ['p(95)<150'],
    'http_req_failed{scenario:health_probe}':   ['rate<0.001'],

    // Writes: allow more latency due to DB I/O
    'http_req_duration{scenario:tenant_write}':    ['p(95)<3000'],
    'http_req_duration{scenario:facility_ops}':    ['p(95)<4000'],
    'http_req_duration{scenario:asset_lifecycle}': ['p(95)<4000'],
    'http_req_duration{scenario:telemetry_ingest}':['p(95)<2000', 'p(99)<5000'],

    // Reads: tighter (materialized view)
    'http_req_duration{scenario:metrics_read}': ['p(95)<500'],

    // E2E: full DB round-trip incl. mat-view refresh
    'http_req_duration{scenario:full_flow}': ['p(95)<8000'],

    // Overall
    'http_req_failed':    ['rate<0.05'],
    'scenario_success_rate': ['rate>0.95'],
    'write_duration_ms':  ['p(95)<5000'],
    'read_duration_ms':   ['p(95)<1000'],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const HEADERS = { 'Content-Type': 'application/json' };

function post(path, body, tags) {
  return http.post(`${BASE_URL}${path}`, JSON.stringify(body), { headers: HEADERS, tags });
}

function get(path, tags) {
  return http.get(`${BASE_URL}${path}`, { tags });
}

function patch(path, body, tags) {
  return http.patch(`${BASE_URL}${path}`, JSON.stringify(body), { headers: HEADERS, tags });
}

function ok(res, label) {
  const passed = check(res, {
    [`${label} status 2xx`]: (r) => r.status >= 200 && r.status < 300,
    [`${label} has body`]:   (r) => r.body && r.body.length > 0,
  });
  successRate.add(passed);
  if (!passed) {
    errors.add(1);
    console.error(`[${label}] ${res.status}: ${res.body.slice(0, 200)}`);
  }
  return passed;
}

// Seeded tenant names so /POST returns a stable tenant_id via ON CONFLICT
const TENANT_NAMES = ['Omega Fleet', 'Blue Logistics', 'Atlas Cargo', 'Nord Shipping'];

function randomTenantName() {
  return randomItem(TENANT_NAMES) + ' ' + Math.floor(Math.random() * 1000);
}

function parseTenantID(res) {
  try { return JSON.parse(res.body).tenant_id; } catch { return null; }
}

function parseFacilityID(res) {
  try { return JSON.parse(res.body).facility_id; } catch { return null; }
}

function parseAssetID(res) {
  try { return JSON.parse(res.body).asset_id; } catch { return null; }
}

// ── Scenario functions ────────────────────────────────────────────────────────

export function healthScenario() {
  const res = get('/health', { endpoint: 'health' });
  ok(res, 'health');
}

export function tenantScenario() {
  group('tenant_write', () => {
    const t0  = Date.now();
    const res = post('/tenants', {
      name:   randomTenantName(),
      config: { region: 'eu-west-1', tier: 'standard' },
    }, { endpoint: 'tenants' });
    writeDuration.add(Date.now() - t0);

    if (!ok(res, 'createTenant')) return;

    const tenantID = parseTenantID(res);
    if (!tenantID) return;

    // Read it back
    const t1  = Date.now();
    const get1 = get(`/tenants/${tenantID}`, { endpoint: 'tenants_get' });
    readDuration.add(Date.now() - t1);
    ok(get1, 'getTenant');
  });
  sleep(0.5 + Math.random());
}

export function facilityScenario() {
  group('facility_ops', () => {
    // First seed a tenant
    const tRes = post('/tenants', {
      name:   randomTenantName(),
      config: { region: 'us-east-1' },
    }, { endpoint: 'tenants' });
    if (!ok(tRes, 'facilityScenario/tenant')) return;
    const tenantID = parseTenantID(tRes);
    if (!tenantID) return;

    // Create facility
    const t0 = Date.now();
    const fRes = post('/facilities', {
      tenant_id: tenantID,
      latitude:  53.349805 + (Math.random() - 0.5),
      longitude: -6.260310 + (Math.random() - 0.5),
      features:  randomItem([['cold-storage'], ['hazmat'], ['cold-storage', 'hazmat'], []]),
    }, { endpoint: 'facilities' });
    writeDuration.add(Date.now() - t0);
    if (!ok(fRes, 'createFacility')) return;

    const facilityID = parseFacilityID(fRes);
    if (!facilityID) return;

    // Read it back
    const t1 = Date.now();
    const gRes = get(`/facilities/${facilityID}`, { endpoint: 'facilities_get' });
    readDuration.add(Date.now() - t1);
    ok(gRes, 'getFacility');
  });
  sleep(1 + Math.random());
}

export function assetScenario() {
  group('asset_lifecycle', () => {
    // Seed tenant + facility
    const tRes = post('/tenants', {
      name: randomTenantName(), config: {},
    }, { endpoint: 'tenants' });
    if (!ok(tRes, 'assetScenario/tenant')) return;
    const tenantID = parseTenantID(tRes);

    const fRes = post('/facilities', {
      tenant_id: tenantID,
      latitude:  51.5 + Math.random(),
      longitude: -0.1 + Math.random(),
      features:  [],
    }, { endpoint: 'facilities' });
    if (!ok(fRes, 'assetScenario/facility')) return;
    const facilityID = parseFacilityID(fRes);
    if (!facilityID) return;

    // Create asset
    const t0 = Date.now();
    const aRes = post('/assets', {
      facility_id: facilityID,
      state:       'pending',
      max_payload: parseFloat((1000 + Math.random() * 4000).toFixed(2)),
    }, { endpoint: 'assets' });
    writeDuration.add(Date.now() - t0);
    if (!ok(aRes, 'createAsset')) return;
    const assetID = parseAssetID(aRes);
    if (!assetID) return;

    // Transition through states
    const states = ['active', 'maintenance', 'active', 'decommissioned'];
    for (const state of states) {
      const pRes = patch(`/assets/${assetID}/state`, { state }, { endpoint: 'assets_state' });
      ok(pRes, `setState:${state}`);
      sleep(0.1);
    }

    // Read final state
    const gRes = get(`/assets/${assetID}`, { endpoint: 'assets_get' });
    ok(gRes, 'getAsset');
  });
  sleep(0.5 + Math.random());
}

export function telemetryScenario() {
  // Telemetry needs a pre-created asset_id. We create one fresh per VU iteration
  // to avoid contention; the insert uses ON CONFLICT DO NOTHING on (asset_id, recorded_at).
  group('telemetry_ingest', () => {
    const tRes = post('/tenants', { name: randomTenantName(), config: {} }, { endpoint: 'tenants' });
    if (!ok(tRes, 'telemetry/tenant')) return;
    const tenantID = parseTenantID(tRes);

    const fRes = post('/facilities', {
      tenant_id: tenantID, latitude: 48.8 + Math.random(), longitude: 2.3 + Math.random(), features: [],
    }, { endpoint: 'facilities' });
    if (!ok(fRes, 'telemetry/facility')) return;
    const facilityID = parseFacilityID(fRes);

    const aRes = post('/assets', {
      facility_id: facilityID, state: 'active', max_payload: 2000,
    }, { endpoint: 'assets' });
    if (!ok(aRes, 'telemetry/asset')) return;
    const assetID = parseAssetID(aRes);
    if (!assetID) return;

    // Insert a burst of telemetry events
    const baseTime = Date.now();
    for (let i = 0; i < 5; i++) {
      const t0 = Date.now();
      const recorded_at = new Date(baseTime + i * 1000).toISOString();
      const tRes2 = post(`/assets/${assetID}/telemetry`, {
        recorded_at,
        temperature: parseFloat((-5 + Math.random() * 20).toFixed(2)),
        metrics: {
          cpu_load:    parseFloat((Math.random() * 100).toFixed(1)),
          battery_pct: Math.floor(Math.random() * 100),
          rpm:         Math.floor(Math.random() * 3000),
        },
      }, { endpoint: 'telemetry' });
      writeDuration.add(Date.now() - t0);
      ok(tRes2, `telemetry_event_${i}`);
    }

    // Read back
    const t1  = Date.now();
    const lRes = get(`/assets/${assetID}/telemetry`, { endpoint: 'telemetry_list' });
    readDuration.add(Date.now() - t1);
    ok(lRes, 'listTelemetry');
  });
}

export function metricsScenario() {
  // Metrics read against a known-seeded facility from /run
  group('metrics_read', () => {
    // First call /run to ensure at least one facility exists
    const runRes = get('/run', { endpoint: 'run' });
    if (!ok(runRes, 'metricsScenario/run')) return;
    let facilityID;
    try { facilityID = JSON.parse(runRes.body).facility_id; } catch { return; }

    // Fetch metrics
    const t0   = Date.now();
    const mRes = get(`/facilities/${facilityID}/metrics`, { endpoint: 'metrics' });
    readDuration.add(Date.now() - t0);
    ok(mRes, 'facilityMetrics');

    // Periodically trigger a refresh (1 in 10 VU iterations)
    if (Math.random() < 0.1) {
      const rRes = post(`/facilities/${facilityID}/refresh`, {}, { endpoint: 'metrics_refresh' });
      ok(rRes, 'refreshMetrics');
    }
  });
  sleep(1 + Math.random() * 2);
}

export function fullFlowScenario() {
  group('full_flow', () => {
    const t0  = Date.now();
    const res = get('/run', { endpoint: 'run' });
    writeDuration.add(Date.now() - t0);

    const passed = check(res, {
      'run 200':            (r) => r.status === 200,
      'run has tenant_id':  (r) => { try { return !!JSON.parse(r.body).tenant_id; } catch { return false; } },
      'run has facility_id':(r) => { try { return !!JSON.parse(r.body).facility_id; } catch { return false; } },
      'run has asset_id':   (r) => { try { return !!JSON.parse(r.body).asset_id; } catch { return false; } },
    });
    successRate.add(passed);
    if (!passed) {
      errors.add(1);
      console.error(`[full_flow] ${res.status}: ${res.body.slice(0, 300)}`);
    }
  });
  sleep(1 + Math.random() * 2);
}

// ── Summary ───────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  const m = data.metrics;
  const p = (key, pct) => (m[key]?.values?.[`p(${pct})`] ?? 0).toFixed(0);
  const r = (key)      => ((m[key]?.values?.rate ?? 0) * 100).toFixed(2);

  console.log(`
╔══════════════════════════════════════════════════════╗
║                 k6 Test Summary                      ║
╠══════════════════════════════════════════════════════╣
║  Scenario          │ p95 (ms)   │ p99 (ms)           ║
║  ─────────────────────────────────────────────────── ║
║  health_probe      │ ${p('http_req_duration{scenario:health_probe}','95').padEnd(10)}│             ║
║  tenant_write      │ ${p('http_req_duration{scenario:tenant_write}','95').padEnd(10)}│             ║
║  facility_ops      │ ${p('http_req_duration{scenario:facility_ops}','95').padEnd(10)}│             ║
║  asset_lifecycle   │ ${p('http_req_duration{scenario:asset_lifecycle}','95').padEnd(10)}│             ║
║  telemetry_ingest  │ ${p('http_req_duration{scenario:telemetry_ingest}','95').padEnd(10)}│ ${p('http_req_duration{scenario:telemetry_ingest}','99').padEnd(12)}║
║  metrics_read      │ ${p('http_req_duration{scenario:metrics_read}','95').padEnd(10)}│             ║
║  full_flow         │ ${p('http_req_duration{scenario:full_flow}','95').padEnd(10)}│             ║
╠══════════════════════════════════════════════════════╣
║  Overall error rate   : ${(r('http_req_failed') + '%').padEnd(27)}║
║  Scenario success rate: ${(r('scenario_success_rate') + '%').padEnd(27)}║
║  Write p95            : ${(p('write_duration_ms','95') + ' ms').padEnd(27)}║
║  Read  p95            : ${(p('read_duration_ms','95') + ' ms').padEnd(27)}║
╚══════════════════════════════════════════════════════╝
`);

  return { stdout: JSON.stringify(data, null, 2) };
}
