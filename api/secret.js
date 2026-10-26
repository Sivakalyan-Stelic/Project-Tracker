// POST /api/secret { projectId, pin } -> { password }
// Needs the roadmap password (x-view-key header) and the team PIN, then reads
// one row from a restricted Databricks table. Passwords never go into the roadmap data.
//
// Table layout: project_id STRING, secret STRING, updated_at TIMESTAMP
//
// Vercel environment variables:
//   ROADMAP_ACCESS_PIN     team PIN typed in the password dialog
//   ROADMAP_SECRETS_TABLE  full table name, e.g. main.stelic.roadmap_secrets
//   plus the Databricks values in _databricks.js

import { runSql, tableName } from "./_databricks.js";
import { requireView, sameSecret } from "./_viewauth.js";

// Basic per-instance throttle on wrong PINs. Serverless instances do not share
// memory, so this slows guessing rather than blocking it completely.
const attempts = new Map();
const WINDOW_MS = 60 * 1000;
const MAX_FAILS = 5;
function tooMany(ip) {
  const a = attempts.get(ip);
  return !!a && Date.now() - a.start <= WINDOW_MS && a.fails >= MAX_FAILS;
}
function recordFail(ip) {
  const now = Date.now(); const a = attempts.get(ip);
  if (!a || now - a.start > WINDOW_MS) attempts.set(ip, { start: now, fails: 1 }); else a.fails += 1;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!(await requireView(req, res))) return;

  const PIN = process.env.ROADMAP_ACCESS_PIN;
  if (!PIN) return res.status(500).json({ error: "ROADMAP_ACCESS_PIN is not set on the server" });
  let table;
  try { table = tableName(process.env.ROADMAP_SECRETS_TABLE, "ROADMAP_SECRETS_TABLE"); }
  catch (e) { return res.status(500).json({ error: e.message }); }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const projectId = body && typeof body.projectId === "string" ? body.projectId.trim() : "";
  const pin = body && body.pin;

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() || "unknown";
  if (tooMany(ip)) return res.status(429).json({ error: "Too many attempts" });
  if (!pin || !sameSecret(pin, PIN)) { recordFail(ip); return res.status(401).json({ error: "PIN not accepted" }); }
  if (!projectId || projectId.length > 200) return res.status(400).json({ error: "Missing projectId" });

  try {
    const rows = await runSql(`SELECT secret FROM ${table} WHERE project_id = :pid LIMIT 1`,
      [{ name: "pid", value: projectId, type: "STRING" }]);
    if (!rows.length || rows[0][0] == null) return res.status(404).json({ error: "No password stored" });
    return res.status(200).json({ password: rows[0][0] });
  } catch (e) {
    return res.status(502).json({ error: "Could not read the password from Databricks" });
  }
}
