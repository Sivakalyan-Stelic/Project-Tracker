// GET /api/meetings?q=<keyword>  -> { meetings: [{ id, title, date, overview, actionItems, url }] }
// Lists recent Fireflies meetings so an admin can pick which summaries to add to the roadmap.
// Needs the roadmap password and the admin password. Viewers never call this:
// imported summaries are saved in the roadmap data in Databricks.
//
// Vercel environment variables:
//   FIREFLIES_API_KEY          API key from Fireflies (Settings, Developer settings)
//   FIREFLIES_MEETING_KEYWORD  optional default search, e.g. "Roadmap" to match the bi-monthly call title

import { requireView, sameSecret } from "./_viewauth.js";

const QUERY = `query RoadmapMeetings($keyword: String, $limit: Int) {
  transcripts(keyword: $keyword, limit: $limit) {
    id
    title
    date
    transcript_url
    summary { overview action_items }
  }
}`;

// Fireflies returns action items as one text block; turn it into a clean list.
function toList(v) {
  const lines = Array.isArray(v) ? v : String(v || "").split(/\r?\n/);
  return lines
    .map(s => String(s).replace(/^[\s*\-\u2022\d.)]+/, "").replace(/\*\*/g, "").trim())
    .filter(Boolean);
}

export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ error: "Use GET" });
  if (!(await requireView(req, res))) return;

  const ADMIN = process.env.ADMIN_PASSWORD || "";
  const given = String(req.headers["x-admin-key"] || "");
  if (!ADMIN || !given || !sameSecret(given, ADMIN)) return res.status(401).json({ error: "Admin sign in required" });

  const KEY = process.env.FIREFLIES_API_KEY;
  if (!KEY) return res.status(500).json({ error: "Missing Vercel setting: FIREFLIES_API_KEY" });

  const url = new URL(req.url || "/", "http://x");
  const keyword = (url.searchParams.get("q") ?? process.env.FIREFLIES_MEETING_KEYWORD ?? "").trim().slice(0, 100);
  const variables = { limit: 15 };
  if (keyword) variables.keyword = keyword;

  try {
    const r = await fetch("https://api.fireflies.ai/graphql", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ query: QUERY, variables })
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d.errors) {
      const msg = (d.errors && d.errors[0] && d.errors[0].message) || `HTTP ${r.status}`;
      const hint = r.status === 401 || r.status === 403 ? " Check FIREFLIES_API_KEY." : "";
      return res.status(502).json({ error: "Fireflies request failed: " + msg + hint });
    }
    const meetings = ((d.data && d.data.transcripts) || []).map(t => ({
      id: String(t.id),
      title: t.title || "Untitled meeting",
      date: typeof t.date === "number" ? t.date : (Date.parse(t.date) || null),
      overview: (t.summary && t.summary.overview) || "",
      actionItems: toList(t.summary && t.summary.action_items),
      url: t.transcript_url || ""
    }));
    return res.status(200).json({ meetings, keyword });
  } catch (e) {
    return res.status(502).json({ error: "Could not reach Fireflies" });
  }
}
