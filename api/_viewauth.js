// Shared roadmap password check. The leading underscore stops Vercel from
// deploying this file as its own endpoint.
//
// Vercel environment variable:
//   ROADMAP_VIEW_PASSWORD   the password everyone types to open the roadmap

import crypto from "crypto";

export function sameSecret(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

// Returns true when the request carries the right roadmap password.
// Otherwise it sends the response itself and returns false.
export async function requireView(req, res) {
  res.setHeader("Cache-Control", "no-store");
  const want = process.env.ROADMAP_VIEW_PASSWORD;
  if (!want) { res.status(500).json({ error: "ROADMAP_VIEW_PASSWORD is not set on the server" }); return false; }
  let given = "";
  try { given = decodeURIComponent(String(req.headers["x-view-key"] || "")); } catch (e) {}
  if (given && sameSecret(given, want)) return true;
  await new Promise(r => setTimeout(r, 600)); // slows down password guessing
  res.status(401).json({ error: "Sign in required" });
  return false;
}
