// Stelic Portfolio Roadmap: shared state stored in a Databricks table.
//
// GET  /api/state           -> { state, authorized }   authorized=true if x-admin-key matches ADMIN_PASSWORD
// POST /api/state {state}   -> { ok:true, savedAt }    requires the x-admin-key header
// GET  /api/state?check=1   -> health check: env vars, warehouse, table, row (no secrets shown)
//
// Vercel environment variables:
//   ADMIN_PASSWORD           edit password                                       (required)
//   DATABRICKS_HOST          server hostname, e.g. dbc-1234.cloud.databricks.com   (required)
//   DATABRICKS_TOKEN         access token with the sql scope                       (required)
//   DATABRICKS_WAREHOUSE_ID  last segment of the warehouse HTTP path               (required)
//   DATABRICKS_TABLE         defaults to workspace.stelic_projects.roadmap_state
//
// Table layout: id STRING, payload STRING (the whole roadmap JSON), updated_at TIMESTAMP

const PASSWORD  = (process.env.ADMIN_PASSWORD || '').trim();
const HOST      = (process.env.DATABRICKS_HOST || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '');
const TOKEN     = (process.env.DATABRICKS_TOKEN || '').trim();
const WAREHOUSE = (process.env.DATABRICKS_WAREHOUSE_ID || '').trim().split('/').pop();
const TABLE     = (process.env.DATABRICKS_TABLE || 'workspace.stelic_projects.roadmap_state').trim();
const ROW_ID    = 'main';

const STATEMENTS_URL = `https://${HOST}/api/2.0/sql/statements`;
const MAX_WAIT_MS = 50000; // total wait per statement, including warehouse start up

const sleep = ms => new Promise(r => setTimeout(r, ms));

class DbxError extends Error {
  constructor(message, status) { super(message); this.status = status || 500; }
}

/* ---------- Data cleanup ----------
   Keeps the roadmap in the exact shape the page expects:
   dates as YYYY-MM-DD, and no null entries in cells or notes
   (a null cell would make a project look like it spans every week). */
function normalizeState(s) {
  if (!s || typeof s !== 'object') return s;
  const day = v => (typeof v === 'string' ? v.slice(0, 10) : v);
  const clean = o => {
    const out = {};
    for (const k in (o || {})) if (o[k] != null) out[k] = o[k];
    return out;
  };
  if (Array.isArray(s.weeks)) s.weeks = s.weeks.map(day);
  if (s.currentWeekIso) s.currentWeekIso = day(s.currentWeekIso);
  (s.sections || []).forEach(sec => (sec.projects || []).forEach(p => {
    p.cells = clean(p.cells);
    p.notes = clean(p.notes);
    if (p.link == null) delete p.link;
  }));
  return s;
}

/* ---------- Databricks SQL ---------- */
function dbxHeaders() {
  return { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };
}

async function readJson(r) {
  const text = await r.text();
  try { return JSON.parse(text); } catch (e) { return { message: text.slice(0, 300) }; }
}

// Runs one SQL statement. If the warehouse is still starting, keeps polling until it finishes.
async function dbx(statement, parameters = []) {
  const started = Date.now();
  let r;
  try {
    r = await fetch(STATEMENTS_URL, {
      method: 'POST',
      headers: dbxHeaders(),
      body: JSON.stringify({
        warehouse_id: WAREHOUSE,
        statement,
        parameters,
        wait_timeout: '20s',
        on_wait_timeout: 'CONTINUE',
        format: 'JSON_ARRAY',
        disposition: 'INLINE'
      })
    });
  } catch (e) {
    throw new DbxError(`Cannot reach Databricks at ${HOST}. Check DATABRICKS_HOST. (${e.message})`, 502);
  }

  let d = await readJson(r);
  if (r.status === 401 || r.status === 403) {
    throw new DbxError('Databricks rejected the token. Check DATABRICKS_TOKEN, its expiry, and that it has the sql scope.', 502);
  }
  if (!r.ok) {
    throw new DbxError(`Databricks error ${r.status}: ${d.message || d.error_code || 'unknown'}`, 502);
  }

  // Poll while the warehouse starts or the query runs
  while (d.status && (d.status.state === 'PENDING' || d.status.state === 'RUNNING')) {
    if (Date.now() - started > MAX_WAIT_MS) {
      fetch(`${STATEMENTS_URL}/${d.statement_id}/cancel`, { method: 'POST', headers: dbxHeaders() }).catch(() => {});
      throw new DbxError('The Databricks warehouse is still starting. Wait a minute and reload.', 503);
    }
    await sleep(1500);
    const pr = await fetch(`${STATEMENTS_URL}/${d.statement_id}`, { headers: dbxHeaders() });
    d = await readJson(pr);
    if (!pr.ok) throw new DbxError(`Databricks error ${pr.status}: ${d.message || 'unknown'}`, 502);
  }

  if (!d.status || d.status.state !== 'SUCCEEDED') {
    const msg = d.status?.error?.message || d.message || JSON.stringify(d.status || d).slice(0, 300);
    throw new DbxError('Databricks query failed: ' + msg, 502);
  }
  return d;
}

async function dbGet() {
  const d = await dbx(`SELECT payload FROM ${TABLE} WHERE id = :id`, [
    { name: 'id', value: ROW_ID, type: 'STRING' }
  ]);
  const row = d.result?.data_array?.[0];
  if (!row || row[0] == null) return null;
  let parsed;
  try { parsed = JSON.parse(row[0]); }
  catch (e) { throw new DbxError('The stored roadmap is not valid JSON. Check the payload column in Databricks.', 500); }
  return normalizeState(parsed);
}

async function dbPut(state) {
  const clean = normalizeState(JSON.parse(JSON.stringify(state)));
  await dbx(
    `MERGE INTO ${TABLE} t
     USING (SELECT :id AS id, :payload AS payload) s
     ON t.id = s.id
     WHEN MATCHED THEN UPDATE SET payload = s.payload, updated_at = current_timestamp()
     WHEN NOT MATCHED THEN INSERT (id, payload, updated_at)
       VALUES (s.id, s.payload, current_timestamp())`,
    [
      { name: 'id', value: ROW_ID, type: 'STRING' },
      { name: 'payload', value: JSON.stringify(clean), type: 'STRING' }
    ]
  );
}

/* ---------- Request helpers ---------- */
function isAuthorized(req) {
  const key = String(req.headers['x-admin-key'] || '').trim();
  return PASSWORD !== '' && key === PASSWORD;
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

function missingEnv() {
  const m = [];
  if (!PASSWORD)  m.push('ADMIN_PASSWORD');
  if (!HOST)      m.push('DATABRICKS_HOST');
  if (!TOKEN)     m.push('DATABRICKS_TOKEN');
  if (!WAREHOUSE) m.push('DATABRICKS_WAREHOUSE_ID');
  return m;
}

async function healthCheck(res) {
  const report = {
    env: {
      ADMIN_PASSWORD: !!PASSWORD,
      DATABRICKS_HOST: HOST || false,
      DATABRICKS_TOKEN: !!TOKEN,
      DATABRICKS_WAREHOUSE_ID: WAREHOUSE || false
    },
    table: TABLE
  };
  if (missingEnv().length) {
    report.result = 'Missing environment variables: ' + missingEnv().join(', ');
    return res.status(500).json(report);
  }
  try {
    const d = await dbx(`SELECT length(payload) AS bytes, updated_at FROM ${TABLE} WHERE id = :id`, [
      { name: 'id', value: ROW_ID, type: 'STRING' }
    ]);
    const row = d.result?.data_array?.[0];
    report.rowFound = !!row;
    if (row) { report.payloadBytes = Number(row[0]); report.updatedAt = row[1]; }
    report.result = row
      ? 'OK: Databricks connected and roadmap row found.'
      : 'Connected, but no row with id = main. The first admin save will create it.';
    return res.status(200).json(report);
  } catch (e) {
    report.result = e.message;
    return res.status(e.status || 500).json(report);
  }
}

/* ---------- Handler ---------- */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET' && req.query && req.query.check !== undefined) {
    return healthCheck(res);
  }

  const missing = missingEnv();
  if (missing.length) {
    return res.status(500).json({ error: 'Missing environment variables: ' + missing.join(', ') });
  }

  try {
    if (req.method === 'GET') {
      const state = await dbGet();
      return res.status(200).json({ state, authorized: isAuthorized(req) });
    }

    if (req.method === 'POST') {
      if (!isAuthorized(req)) {
        return res.status(401).json({ error: 'Wrong or missing admin password' });
      }
      let body;
      try { body = await readBody(req); }
      catch (e) { return res.status(400).json({ error: 'Request body is not valid JSON' }); }

      const state = body && body.state;
      if (!state || !Array.isArray(state.sections) || !Array.isArray(state.weeks)) {
        return res.status(400).json({ error: 'Invalid roadmap data: expected state.sections and state.weeks' });
      }
      await dbPut(state);
      return res.status(200).json({ ok: true, savedAt: new Date().toISOString() });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(e.status || 500).json({ error: e.message });
  }
}
