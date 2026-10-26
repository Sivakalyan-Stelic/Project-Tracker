// Stelic Portfolio Roadmap: shared state stored in Databricks.
// GET  /api/state          -> { state, authorized }   (authorized = x-admin-key matches ADMIN_PASSWORD)
// POST /api/state {state}  -> { ok:true }              (needs the admin password)
// Both need the roadmap password (x-view-key header).
//
// Table layout (one row, id = 'main'):
//   id STRING, payload STRING (the roadmap JSON), updated_at TIMESTAMP
//
// Vercel environment variables:
//   ADMIN_PASSWORD            the edit password (required, no default)
//   ROADMAP_VIEW_PASSWORD     the password to open the roadmap (see _viewauth.js)
//   DATABRICKS_ROADMAP_TABLE  full table name, e.g. main.stelic.roadmap_state
//   DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID (see _databricks.js)

import { runSql, tableName } from "./_databricks.js";
import { requireView, sameSecret } from "./_viewauth.js";

const ROW_ID = "main";

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise(resolve => {
    let d = ""; req.on("data", c => d += c);
    req.on("end", () => { try { resolve(JSON.parse(d || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

export default async function handler(req, res) {
  if (!(await requireView(req, res))) return;

  const ADMIN = process.env.ADMIN_PASSWORD;
  if (!ADMIN) return res.status(500).json({ error: "ADMIN_PASSWORD is not set on the server" });
  const given = String(req.headers["x-admin-key"] || "");
  const authorized = !!given && sameSecret(given, ADMIN);

  let table;
  try { table = tableName(process.env.DATABRICKS_ROADMAP_TABLE, "DATABRICKS_ROADMAP_TABLE"); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  if (req.method === "GET") {
    try {
      const rows = await runSql(`SELECT payload FROM ${table} WHERE id = :id LIMIT 1`,
        [{ name: "id", value: ROW_ID, type: "STRING" }]);
      if (!rows.length || rows[0][0] == null) return res.status(200).json({ state: null, authorized });
      return res.status(200).json({ state: JSON.parse(rows[0][0]), authorized });
    } catch (e) {
      // Report the failure. Never answer "empty" here, or the page could save a blank roadmap over real data.
      return res.status(502).json({ error: String(e.message || e), authorized });
    }
  }

  if (req.method === "POST") {
    if (!authorized) return res.status(401).json({ error: "Wrong password" });
    const body = await readJsonBody(req);
    const state = body && body.state;
    if (!state || !Array.isArray(state.sections) || !Array.isArray(state.weeks)) {
      return res.status(400).json({ error: "Invalid roadmap payload" });
    }
    try {
      await runSql(
        `MERGE INTO ${table} AS t
         USING (SELECT :id AS id, :payload AS payload) AS s
         ON t.id = s.id
         WHEN MATCHED THEN UPDATE SET t.payload = s.payload, t.updated_at = current_timestamp()
         WHEN NOT MATCHED THEN INSERT (id, payload, updated_at) VALUES (s.id, s.payload, current_timestamp())`,
        [
          { name: "id", value: ROW_ID, type: "STRING" },
          { name: "payload", value: JSON.stringify(state), type: "STRING" }
        ]);
      return res.status(200).json({ ok: true });
    } catch (e) {
      return res.status(500).json({ error: String(e.message || e) });
    }
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
