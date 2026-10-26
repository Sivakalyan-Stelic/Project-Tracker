// Stelic Portfolio Roadmap: shared state stored in a Databricks table.
// GET  /api/state          -> { state, authorized }   (authorized=true if x-admin-key matches ADMIN_PASSWORD)
// POST /api/state {state}  -> { ok:true }              (requires the admin password header)
//
// The Databricks token lives ONLY here on the server (env var), so editors just need the password.
// Environment variables (set in the Vercel project):
//   ADMIN_PASSWORD           the edit password                                   (required)
//   DATABRICKS_HOST          server hostname, without https://                     (required)
//   DATABRICKS_TOKEN         access token with the sql scope                       (required)
//   DATABRICKS_WAREHOUSE_ID  last segment of the warehouse HTTP path               (required)
//   DATABRICKS_TABLE         defaults to workspace.stelic_projects.roadmap_state

const PASSWORD  = process.env.ADMIN_PASSWORD || '';
const HOST      = process.env.DATABRICKS_HOST || '';
const TOKEN     = process.env.DATABRICKS_TOKEN || '';
const WAREHOUSE = process.env.DATABRICKS_WAREHOUSE_ID || '';
const TABLE     = process.env.DATABRICKS_TABLE || 'workspace.stelic_projects.roadmap_state';

async function dbx(statement, parameters = []) {
  const r = await fetch(`https://${HOST}/api/2.0/sql/statements`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      warehouse_id: WAREHOUSE,
      statement,
      parameters,
      wait_timeout: '30s',
      format: 'JSON_ARRAY',
      disposition: 'INLINE'
    })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.status?.state !== 'SUCCEEDED') {
    const msg = d.status?.error?.message || d.message || ('HTTP ' + r.status);
    throw new Error('Databricks query failed: ' + msg);
  }
  return d;
}

async function dbGet() {
  const d = await dbx(`SELECT payload FROM ${TABLE} WHERE id = 'main'`);
  const row = d.result?.data_array?.[0];
  return row ? JSON.parse(row[0]) : null;
}

async function dbPut(state) {
  await dbx(
    `MERGE INTO ${TABLE} t
     USING (SELECT 'main' AS id, :payload AS payload) s
     ON t.id = s.id
     WHEN MATCHED THEN UPDATE SET payload = s.payload, updated_at = current_timestamp()
     WHEN NOT MATCHED THEN INSERT (id, payload, updated_at)
       VALUES (s.id, s.payload, current_timestamp())`,
    [{ name: 'payload', value: JSON.stringify(state), type: 'STRING' }]
  );
}

function isAuthorized(req) {
  const key = req.headers['x-admin-key'] || '';
  return PASSWORD !== '' && key === PASSWORD;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  const missing = [];
  if (!PASSWORD)  missing.push('ADMIN_PASSWORD');
  if (!HOST)      missing.push('DATABRICKS_HOST');
  if (!TOKEN)     missing.push('DATABRICKS_TOKEN');
  if (!WAREHOUSE) missing.push('DATABRICKS_WAREHOUSE_ID');
  if (missing.length) {
    return res.status(500).json({ error: 'Missing environment variables: ' + missing.join(', ') });
  }

  try {
    if (req.method === 'GET') {
      const state = await dbGet();
      return res.status(200).json({ state, authorized: isAuthorized(req) });
    }

    if (req.method === 'POST') {
      if (!isAuthorized(req)) return res.status(401).json({ error: 'Wrong or missing admin password' });
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const state = body.state;
      if (!state || !Array.isArray(state.sections) || !Array.isArray(state.weeks)) {
        return res.status(400).json({ error: 'Invalid roadmap data' });
      }
      await dbPut(state);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
