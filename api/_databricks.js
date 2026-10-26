// Shared Databricks SQL helper (Statement Execution API). The leading
// underscore stops Vercel from deploying this file as its own endpoint.
//
// Vercel environment variables:
//   DATABRICKS_HOST          workspace address only, e.g. dbc-1234abcd-5678.cloud.databricks.com
//                            (DATABRICKS_SERVER_HOSTNAME also works)
//   DATABRICKS_TOKEN         token for an account with access to the tables
//   DATABRICKS_WAREHOUSE_ID  SQL warehouse id (DATABRICKS_HTTP_PATH also works)

export function tableName(envValue, label) {
  const t = String(envValue || "").trim();
  if (!t) throw new Error(`${label} is not set on the server`);
  if (!/^[A-Za-z0-9_.`]+$/.test(t)) throw new Error(`${label} has an invalid table name`);
  return t;
}

// Reads the Databricks settings. Accepts either naming style:
//   DATABRICKS_HOST or DATABRICKS_SERVER_HOSTNAME
//   DATABRICKS_WAREHOUSE_ID, or DATABRICKS_HTTP_PATH (/sql/1.0/warehouses/<id>)
export function databricksConfig() {
  const env = process.env;
  const hostRaw = env.DATABRICKS_HOST || env.DATABRICKS_SERVER_HOSTNAME || "";
  const host = hostRaw.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  const token = (env.DATABRICKS_TOKEN || "").trim();
  let warehouse = (env.DATABRICKS_WAREHOUSE_ID || "").trim();
  if (!warehouse && env.DATABRICKS_HTTP_PATH) {
    const m = String(env.DATABRICKS_HTTP_PATH).match(/warehouses\/([A-Za-z0-9]+)/);
    if (m) warehouse = m[1];
  }
  const missing = [];
  if (!host) missing.push("DATABRICKS_HOST");
  if (!token) missing.push("DATABRICKS_TOKEN");
  if (!warehouse) missing.push("DATABRICKS_WAREHOUSE_ID");
  return { host, token, warehouse, missing };
}

// Runs one SQL statement and returns its rows (array of arrays).
// Waits up to ~50 seconds so a warehouse that was asleep has time to start.
export async function runSql(statement, parameters = []) {
  const cfg = databricksConfig();
  if (cfg.missing.length) throw new Error("Missing Vercel settings: " + cfg.missing.join(", "));
  const { host } = cfg;
  const headers = { Authorization: `Bearer ${cfg.token}`, "Content-Type": "application/json" };

  let r = await fetch(`https://${host}/api/2.0/sql/statements`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      warehouse_id: cfg.warehouse,
      statement,
      parameters,
      wait_timeout: "30s",
      on_wait_timeout: "CONTINUE",
      disposition: "INLINE",
      format: "JSON_ARRAY"
    })
  });
  let d = await r.json().catch(() => ({}));
  if (!r.ok) {
    const hint = r.status === 401 || r.status === 403 ? " Check DATABRICKS_TOKEN." : r.status === 404 ? " Check DATABRICKS_HOST and the warehouse id." : "";
    throw new Error(`Databricks request failed (${r.status}). ${d.message || ""}${hint}`.trim());
  }

  const deadline = Date.now() + 20000;
  while (d.status && (d.status.state === "PENDING" || d.status.state === "RUNNING")) {
    if (Date.now() > deadline) throw new Error("Databricks query timed out. The SQL warehouse may still be starting; try again.");
    await new Promise(res => setTimeout(res, 1500));
    r = await fetch(`https://${host}/api/2.0/sql/statements/${d.statement_id}`, { headers });
    d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`Databricks status check failed (${r.status})`);
  }
  if (!d.status || d.status.state !== "SUCCEEDED") {
    const msg = d.status && d.status.error && d.status.error.message;
    throw new Error("Databricks query failed" + (msg ? `: ${msg}` : ""));
  }
  return (d.result && d.result.data_array) || [];
}
