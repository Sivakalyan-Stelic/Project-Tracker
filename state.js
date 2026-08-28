// Stelic Portfolio Roadmap - shared state stored as roadmap.json in a GitHub repo.
// GET  /api/state          -> { state, authorized }   (authorized=true if x-admin-key === ADMIN_PASSWORD)
// POST /api/state {state}  -> { ok:true }              (requires the admin password header)
//
// The GitHub token lives ONLY here on the server (env var), so editors just need the password.
// Environment variables (set in the Vercel project):
//   ADMIN_PASSWORD   the edit password (defaults to stelic@2026 if unset)
//   GITHUB_TOKEN     a fine-grained token with Contents read and write on the data repo   (required)
//   GITHUB_REPO      "owner/repo", e.g. "siva-stelic/stelic-roadmap-data"                 (required)
//   GITHUB_PATH      file path in the repo (defaults to roadmap.json)
//   GITHUB_BRANCH    branch (defaults to main)

const PASSWORD = process.env.ADMIN_PASSWORD || 'stelic@2026';
const TOKEN    = process.env.GITHUB_TOKEN || '';
const REPO     = process.env.GITHUB_REPO || '';
const FILEPATH = process.env.GITHUB_PATH || 'roadmap.json';
const BRANCH   = process.env.GITHUB_BRANCH || 'main';

function apiUrl(){ return `https://api.github.com/repos/${REPO}/contents/${FILEPATH.split('/').map(encodeURIComponent).join('/')}`; }
function ghHeaders(){ return { Authorization:`Bearer ${TOKEN}`, Accept:'application/vnd.github+json', 'User-Agent':'stelic-roadmap' }; }

async function ghGet(){
  const r = await fetch(`${apiUrl()}?ref=${encodeURIComponent(BRANCH)}`, { headers: ghHeaders(), cache:'no-store' });
  if (r.status === 404) return { state:null, sha:null };
  if (!r.ok) throw new Error('GitHub read failed: ' + r.status + ' ' + (await r.text()));
  const d = await r.json();
  const json = Buffer.from(d.content || '', 'base64').toString('utf8');
  return { state: JSON.parse(json), sha: d.sha };
}
async function ghPut(state, sha){
  const body = { message:`Roadmap update ${new Date().toISOString()}`, content: Buffer.from(JSON.stringify(state, null, 2)).toString('base64'), branch: BRANCH };
  if (sha) body.sha = sha;
  const r = await fetch(apiUrl(), { method:'PUT', headers:{ ...ghHeaders(), 'Content-Type':'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error('GitHub write failed: ' + r.status + ' ' + (await r.text()));
  return r.json();
}
async function readJsonBody(req){
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise((resolve)=>{ let d=''; req.on('data',c=>d+=c); req.on('end',()=>{ try{resolve(JSON.parse(d||'{}'));}catch{resolve({});} }); req.on('error',()=>resolve({})); });
}

export default async function handler(req, res){
  const authorized = (req.headers['x-admin-key'] || '') === PASSWORD;

  if (!TOKEN || !REPO) {
    return res.status(500).json({ error: 'Server is missing GITHUB_TOKEN or GITHUB_REPO environment variables.' });
  }

  if (req.method === 'GET') {
    res.setHeader('Cache-Control','no-store');
    try { const { state } = await ghGet(); return res.status(200).json({ state, authorized }); }
    catch (e) { return res.status(200).json({ state:null, authorized, error:String(e.message||e) }); }
  }

  if (req.method === 'POST') {
    if (!authorized) return res.status(401).json({ error:'Wrong password' });
    const body = await readJsonBody(req);
    const state = body && body.state;
    if (!state || !Array.isArray(state.sections)) return res.status(400).json({ error:'Invalid roadmap payload' });
    try { const { sha } = await ghGet(); await ghPut(state, sha); return res.status(200).json({ ok:true }); }
    catch (e) { return res.status(500).json({ error:String(e.message||e) }); }
  }

  res.setHeader('Allow','GET, POST');
  return res.status(405).json({ error:'Method not allowed' });
}
