// ============================================================================
// GURU TRACKER — what well-known managers hold, build and hedge, from their 13Fs
//   The tracker itself lives in the Research Database (github.com/ainsleya5320/
//   Research-Database: scripts/gurus.py reads EDGAR every Monday and writes
//   data/generated/gurus.json). This module only reads that summary, so the
//   numbers keep one home; the Gurus tab draws them and links each name to the
//   full story workbench in the Research Database app.
//   local     RESEARCH_DB_DIR in .env, else a Research Database checkout next
//             to this folder or one level up. Re-read whenever the file
//             changes (a `git pull` there, or its own weekly refresh).
//   github    when no checkout is found and RESEARCH_DB_TOKEN (or GITHUB_TOKEN)
//             holds a token that can read the private repo: the same file from
//             RESEARCH_DB_BRANCH (default codex/research-workspace), cached an
//             hour, the last copy served if GitHub fails.
//   link      RESEARCH_DB_URL is where the Research Database app runs
//             (`python scripts/serve.py`, http://localhost:5050/app/ unless
//             given another port).
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const FILE = ['data', 'generated', 'gurus.json']
const NAMES = ['Research-Database', 'research-database', 'Research Database', 'ResearchDatabase']
const HOUR = 3600e3

// The first folder that holds the tracker's summary: the one named in .env, then siblings and cousins of this repo.
export function findCheckout(dir, configured) {
  const candidates = configured ? [path.resolve(dir, configured)]
    : NAMES.flatMap(n => [path.resolve(dir, '..', n), path.resolve(dir, '..', '..', n)])
  return candidates.find(c => fs.existsSync(path.join(c, ...FILE))) || null
}

export function createGuruTracker({ dir, env = {}, UA = 'econ-dashboard' }) {
  const configured = env.RESEARCH_DB_DIR || process.env.RESEARCH_DB_DIR || ''
  const token = env.RESEARCH_DB_TOKEN || process.env.RESEARCH_DB_TOKEN || env.GITHUB_TOKEN || process.env.GITHUB_TOKEN || ''
  const repo = env.RESEARCH_DB_REPO || 'ainsleya5320/Research-Database'
  const branch = env.RESEARCH_DB_BRANCH || 'codex/research-workspace'
  const researchUrl = (env.RESEARCH_DB_URL || process.env.RESEARCH_DB_URL || 'http://localhost:5050/app/').replace(/#.*$/, '')
  let local = { file: null, mtime: 0, data: null }
  let remote = { data: null, ts: 0 }

  function readLocal() {
    const root = findCheckout(dir, configured)
    if (!root) return null
    const file = path.join(root, ...FILE), mtime = fs.statSync(file).mtimeMs
    if (local.file !== file || local.mtime !== mtime) local = { file, mtime, data: JSON.parse(fs.readFileSync(file, 'utf8')) }
    return { data: local.data, source: 'local', where: root }
  }

  async function readGitHub() {
    if (!token) return null
    if (remote.data && Date.now() - remote.ts < HOUR) return { data: remote.data, source: 'github', where: `${repo}@${branch}` }
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/contents/${FILE.join('/')}?ref=${encodeURIComponent(branch)}`, {
        headers: { Accept: 'application/vnd.github.raw', Authorization: `Bearer ${token}`, 'User-Agent': UA },
      })
      if (!r.ok) throw new Error(`GitHub answered ${r.status}`)
      remote = { data: await r.json(), ts: Date.now() }
    } catch (e) {
      if (!remote.data) throw e
    }
    return { data: remote.data, source: 'github', where: `${repo}@${branch}` }
  }

  async function get() {
    const found = readLocal() || await readGitHub()
    if (!found) {
      return { available: false, researchUrl,
        reason: configured ? `No guru summary at ${configured}/${FILE.join('/')}.`
          : 'No Research Database checkout next to this folder. Set RESEARCH_DB_DIR in .env to its folder (or RESEARCH_DB_TOKEN to read it from GitHub).' }
    }
    return { available: true, source: found.source, where: found.where, researchUrl, ...found.data }
  }

  return { get }
}
