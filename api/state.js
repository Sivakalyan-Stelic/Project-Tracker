// Stelic Portfolio Roadmap: shared state stored in Databricks.
// GET  /api/state           -> { state, authorized }   (authorized = x-admin-key matches ADMIN_PASSWORD)
// POST /api/state {state}   -> { ok:true }              (needs the admin password)
// GET  /api/state?check=1   -> setup check: which settings are present and whether Databricks answers.
//                              Returns no roadmap data, so it is safe to open in a browser.
// Reading and saving need the roadmap password (x-view-key header).
//
// Table layout (one row, id = 'main'):
//   id STRING, payload STRING (the roadmap JSON), updated_at TIMESTAMP
//
// Vercel environment variables:
//   ROADMAP_VIEW_PASSWORD     password to open the roadmap (see _viewauth.js)
//   ADMIN_PASSWORD            password to edit (if missing, the roadmap still loads but nobody can edit)
//   DATABRICKS_ROADMAP_TABLE  full table name, e.g. workspace.stelic_projects.roadmap_state
//   DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID (see _databricks.js)

import { runSql, tableName, databricksConfig } from "./_databricks.js";
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

// Lists every missing setting at once, so one look shows everything to fix.
function missingSettings() {
  const missing = [...databricksConfig().missing];
  if (!process.env.DATABRICKS_ROADMAP_TABLE) missing.push("DATABRICKS_ROADMAP_TABLE");
  if (!process.env.ROADMAP_VIEW_PASSWORD) missing.push("ROADMAP_VIEW_PASSWORD");
  return missing;
}

async function setupCheck(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const env = process.env;
  const settings = {
    ROADMAP_VIEW_PASSWORD: !!env.ROADMAP_VIEW_PASSWORD,
    ADMIN_PASSWORD: !!env.ADMIN_PASSWORD,
    DATABRICKS_ROADMAP_TABLE: !!env.DATABRICKS_ROADMAP_TABLE,
    DATABRICKS_HOST: !!(env.DATABRICKS_HOST || env.DATABRICKS_SERVER_HOSTNAME),
    DATABRICKS_TOKEN: !!env.DATABRICKS_TOKEN,
    DATABRICKS_WAREHOUSE_ID: !!(env.DATABRICKS_WAREHOUSE_ID || env.DATABRICKS_HTTP_PATH)
  };
  const missing = Object.keys(settings).filter(k => !settings[k]);
  let databricks = "not tested (settings missing)";
  if (!databricksConfig().missing.length && env.DATABRICKS_ROADMAP_TABLE) {
    try {
      const table = tableName(env.DATABRICKS_ROADMAP_TABLE, "DATABRICKS_ROADMAP_TABLE");
      const rows = await runSql(`SELECT count(*) FROM ${table} WHERE id = :id`, [{ name: "id", value: ROW_ID, type: "STRING" }]);
      databricks = Number(rows[0] && rows[0][0]) > 0 ? "ok, roadmap row found" : "connected, but no row with id = 'main'";
    } catch (e) { databricks = "failed: " + String(e.message || e); }
  }
  return res.status(200).json({ settings, missing, databricks });
}

export default async function handler(req, res) {
  const url = new URL(req.url || "/", "http://x");
  if (req.method === "GET" && url.searchParams.get("check") === "1") return setupCheck(req, res);

  if (!(await requireView(req, res))) return;

  const missing = missingSettings();
  if (missing.length) return res.status(500).json({ error: "Missing Vercel settings: " + missing.join(", ") });

  const ADMIN = process.env.ADMIN_PASSWORD || "";
  const given = String(req.headers["x-admin-key"] || "");
  const authorized = !!ADMIN && !!given && sameSecret(given, ADMIN);

  let table;
  try { table = tableName(process.env.DATABRICKS_ROADMAP_TABLE, "DATABRICKS_ROADMAP_TABLE"); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  if (req.method === "GET") {
    try {
      const rows = await runSql(`SELECT payload FROM ${table} WHERE id = :id LIMIT 1`,
        [{ name: "id", value: ROW_ID, type: "STRING" }]);
      if (!rows.length || rows[0][0] == null) return res.status(200).json({ state: null, authorized });
      let state;
      try { state = JSON.parse(rows[0][0]); }
      catch { return res.status(502).json({ error: "The payload in Databricks is not valid JSON", authorized }); }
      return res.status(200).json({ state, authorized });
    } catch (e) {
      // Report the failure. Never answer "empty" here, or the page could save a blank roadmap over real data.
      return res.status(502).json({ error: String(e.message || e), authorized });
    }
  }

  if (req.method === "POST") {
    if (!ADMIN) return res.status(500).json({ error: "Missing Vercel setting: ADMIN_PASSWORD" });
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
