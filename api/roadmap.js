const DBX = `https://${process.env.DATABRICKS_HOST}/api/2.0/sql/statements`;
const TABLE = "workspace.stelic_projects.roadmap_state";

async function run(statement, parameters = []) {
  const r = await fetch(DBX, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DATABRICKS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      warehouse_id: process.env.DATABRICKS_WAREHOUSE_ID,
      statement,
      parameters,
      wait_timeout: "30s",
      format: "JSON_ARRAY",
      disposition: "INLINE"
    })
  });
  const data = await r.json();
  if (data.status?.state !== "SUCCEEDED") {
    throw new Error(JSON.stringify(data.status || data));
  }
  return data;
}

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const d = await run(`SELECT payload FROM ${TABLE} WHERE id = 'main'`);
      const row = d.result?.data_array?.[0];
      if (!row) return res.status(404).json({ error: "No roadmap row found" });
      res.setHeader("Cache-Control", "no-store");
      return res.json(JSON.parse(row[0]));
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? req.body : JSON.stringify(req.body);
      JSON.parse(body);
      await run(
        `UPDATE ${TABLE} SET payload = :payload, updated_at = current_timestamp() WHERE id = 'main'`,
        [{ name: "payload", value: body, type: "STRING" }]
      );
      return res.json({ ok: true });
    }

    res.status(405).end();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
