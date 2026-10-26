// Shared Databricks SQL helper (Statement Execution API). The leading
// underscore stops Vercel from deploying this file as its own endpoint.
//
// Vercel environment variables:
//   DATABRICKS_HOST          e.g. adb-1234567890.12.azuredatabricks.net
//   DATABRICKS_TOKEN         token for a service principal with access to the tables
//   DATABRICKS_WAREHOUSE_ID  SQL warehouse id

export function tableName(envValue, label) {
  const t = String(envValue || "").trim();
  if (!t) throw new Error(`${label} is not set on the server`);
  if (!/^[A-Za-z0-9_.`]+$/.test(t)) throw new Error(`${label} has an invalid table name`);
  return t;
}

// Runs one SQL statement and returns its rows (array of arrays).
// Waits up to ~50 seconds so a warehouse that was asleep has time to start.
export async function runSql(statement, parameters = []) {
  const { DATABRICKS_HOST, DATABRICKS_TOKEN, DATABRICKS_WAREHOUSE_ID } = process.env;
  if (!DATABRICKS_HOST || !DATABRICKS_TOKEN || !DATABRICKS_WAREHOUSE_ID) {
    throw new Error("Server is missing DATABRICKS_HOST, DATABRICKS_TOKEN or DATABRICKS_WAREHOUSE_ID");
  }
  const host = DATABRICKS_HOST.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${DATABRICKS_TOKEN}`, "Content-Type": "application/json" };

  let r = await fetch(`https://${host}/api/2.0/sql/statements`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      warehouse_id: DATABRICKS_WAREHOUSE_ID,
      statement,
      parameters,
      wait_timeout: "30s",
      on_wait_timeout: "CONTINUE",
      disposition: "INLINE",
      format: "JSON_ARRAY"
    })
  });
  let d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Databricks request failed (${r.status}) ${d.message || ""}`.trim());

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
