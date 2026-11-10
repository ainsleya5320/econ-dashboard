// ============================================================================
// RESEARCH DATABASE READER — one way to read a file out of the private Research
// Database (github.com/ainsleya5320/Research-Database), for the modules whose
// inputs live there: the guru tracker (server/guruTracker.js) and the AI
// section's company-level inputs (server/taiwanRevenue.js, server/aiCredit.js,
// server/aiFlows.js). Those inputs name holdings, so they stay in the private
// repository and this public one only reads them.
//   local     RESEARCH_DB_DIR in .env, else a Research Database checkout next
//             to this folder or one level up. Each file is re-read whenever it
//             changes (a `git pull` there, or its own weekly refresh).
//   github    when no checkout is found and RESEARCH_DB_TOKEN (or GITHUB_TOKEN)
//             holds a token that can read the private repo: the same files from
//             RESEARCH_DB_BRANCH (default codex/research-workspace), cached an
//             hour, the last copy served if GitHub fails.
//   link      RESEARCH_DB_URL is where the Research Database app runs
//             (`python scripts/serve.py`, http://localhost:5050/app/ unless
//             given another port).
// read(parts) answers { data, source, where, mtime } (data null when the file is
// missing) or null when there is neither a checkout nor a token.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const MARKER = ['data', 'generated', 'gurus.json']
const NAMES = ['Research-Database', 'research-database', 'Research Database', 'ResearchDatabase']
const HOUR = 3600e3

// The first folder that holds the tracker's summary: the one named in .env, then siblings and cousins of this repo.
export function findCheckout(dir, configured) {
  const candidates = configured ? [path.resolve(dir, configured)]
    : NAMES.flatMap(n => [path.resolve(dir, '..', n), path.resolve(dir, '..', '..', n)])
  return candidates.find(c => fs.existsSync(path.join(c, ...MARKER))) || null
}

export function createResearchDb({ dir, env = {}, UA = 'econ-dashboard' }) {
  const configured = env.RESEARCH_DB_DIR || process.env.RESEARCH_DB_DIR || ''
  const token = env.RESEARCH_DB_TOKEN || process.env.RESEARCH_DB_TOKEN || env.GITHUB_TOKEN || process.env.GITHUB_TOKEN || ''
  const repo = env.RESEARCH_DB_REPO || 'ainsleya5320/Research-Database'
  const branch = env.RESEARCH_DB_BRANCH || 'codex/research-workspace'
  const researchUrl = (env.RESEARCH_DB_URL || process.env.RESEARCH_DB_URL || 'http://localhost:5050/app/').replace(/#.*$/, '')
  const local = new Map()    // file → { mtime, data }
  const remote = new Map()   // file → { data, ts }

  // One file from the checkout, re-parsed only when its mtime moves; null when there is no checkout.
  function readLocal(parts) {
    const root = findCheckout(dir, configured)
    if (!root) return null
    const file = path.join(root, ...parts)
    if (!fs.existsSync(file)) return { data: null, source: 'local', where: root, file }
    const mtime = fs.statSync(file).mtimeMs, hit = local.get(file)
    if (!hit || hit.mtime !== mtime) local.set(file, { mtime, data: JSON.parse(fs.readFileSync(file, 'utf8')) })
    return { data: local.get(file).data, source: 'local', where: root, file, mtime }
  }

  async function readGitHub(parts) {
    if (!token) return null
    const key = parts.join('/'), hit = remote.get(key)
    if (hit?.data !== undefined && Date.now() - hit.ts < HOUR) return { data: hit.data, source: 'github', where: `${repo}@${branch}`, mtime: hit.ts }
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/contents/${key}?ref=${encodeURIComponent(branch)}`, {
        headers: { Accept: 'application/vnd.github.raw', Authorization: `Bearer ${token}`, 'User-Agent': UA },
      })
      if (r.status === 404) remote.set(key, { data: null, ts: Date.now() })
      else if (!r.ok) throw new Error(`GitHub answered ${r.status}`)
      else remote.set(key, { data: await r.json(), ts: Date.now() })
    } catch (e) {
      if (!hit) throw e
    }
    const now = remote.get(key)
    return { data: now.data, source: 'github', where: `${repo}@${branch}`, mtime: now.ts }
  }

  const read = async parts => readLocal(parts) || await readGitHub(parts)

  // what to say when nothing can be read: `what` names the missing file in a sentence
  function missing(what = 'guru summary', file = MARKER) {
    return { available: false, researchUrl,
      reason: configured ? `No ${what} at ${configured}/${file.join('/')}.`
        : 'No Research Database checkout next to this folder. Set RESEARCH_DB_DIR in .env to its folder (or RESEARCH_DB_TOKEN to read it from GitHub).' }
  }

  return { read, missing, researchUrl }
}
