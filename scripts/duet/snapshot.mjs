// ============================================================================
// Snapshot every /api answer for the Claude Duet copy of the dashboard.
//
// Duet shows the dashboard as a published page with no server behind it, so the
// page answers /api requests from a saved copy (scripts/duet/shim.js). This
// script makes that copy on this computer, where the dev server can reach FRED,
// the SEC and the rest and .env holds the keys:
//
//   npm run duet:snapshot              uses the dev server on :5180 if it is up,
//                                      otherwise starts one and stops it after
//   npm run duet:snapshot -- --with-finra   also keeps the FINRA bond data
//
// It writes duet-snapshot/ and duet-snapshot.tar.gz (both gitignored). Drop the
// .tar.gz into the Duet thread; scripts/duet/build-page.mjs turns it into the
// page. The archive holds the watchlist, News Desk and Deal Book, which is why
// it never goes into this public repo. FINRA's corporate and Treasury data are
// left out unless asked for: its terms allow personal use only.
// ============================================================================
import { spawn, execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { fredChunk, FRED_CHUNKS, routeKey } from './shared.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..', '..')
const OUT = path.join(ROOT, 'duet-snapshot')
const ARCHIVE = path.join(ROOT, 'duet-snapshot.tar.gz')
const WITH_FINRA = process.argv.includes('--with-finra')
const ROUTE_TIMEOUT_MS = 300_000
const CONCURRENCY = 3
// a route answered with less than this goes into a shared pack file, so the
// page stays under the Artifact tool's 255 files per publish
const PACK_BELOW = 200_000

// Routes the page cannot use or must not carry.
const SKIP = new Set([
  'chat', 'fred', 'aa-check', 'ideas/onepager', 'corporate-bonds/watchlist',
  'news-desk/clip', 'news-desk/refresh', 'news-desk/proposal', 'news-desk/x-token',
])
const FINRA = new Set(['corporate-bonds', 'treasury-volume'])

const sleep = ms => new Promise(r => setTimeout(r, ms))
const log = (...a) => console.log('[duet]', ...a)

async function up(base) {
  try { return (await fetch(base + '/api/tickers', { signal: AbortSignal.timeout(4000) })).ok } catch { return false }
}

async function server() {
  const port = Number(process.env.PORT || 5180)
  const running = `http://127.0.0.1:${port}`
  if (await up(running)) { log(`using the dev server on ${port}`); return { base: running, stop() {} } }
  const own = 5198
  log(`starting a dev server on ${own}…`)
  const proc = spawn(process.execPath, [path.join(ROOT, 'node_modules', 'vite', 'bin', 'vite.js'), '--port', String(own), '--strictPort'], {
    cwd: ROOT, stdio: 'ignore', env: { ...process.env, BROWSER: 'none' },
  })
  const base = `http://127.0.0.1:${own}`
  for (let t = Date.now(); Date.now() - t < 120_000; await sleep(700)) {
    if (proc.exitCode != null) throw new Error('vite exited during boot')
    if (await up(base)) { await sleep(5000); return { base, stop: () => proc.kill('SIGTERM') } }
  }
  proc.kill('SIGKILL')
  throw new Error('the dev server did not come up within 2 minutes')
}

// every /api path the server answers, read from the source rather than listed
// by hand, so a new feed is picked up without editing this file
function plainRoutes() {
  const files = [path.join(ROOT, 'vite.config.js')]
  const walk = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name)
    if (e.isDirectory()) walk(p); else if (p.endsWith('.js')) files.push(p)
  })
  walk(path.join(ROOT, 'server'))
  const found = new Set()
  for (const f of files) for (const m of fs.readFileSync(f, 'utf8').matchAll(/['"`]\/api\/([a-zA-Z0-9_/-]+)/g)) found.add(m[1].replace(/\/+$/, ''))
  return [...found].filter(r => !SKIP.has(r) && (WITH_FINRA || !FINRA.has(r))
    && !['municipality', 'options-context', 're-metro', 're-metro-employment', 'market-map', 'market-map/history', 'tensions', 'gurus/manager'].includes(r))
    .sort().map(r => `/api/${r}`)
}

async function enumeratedRoutes(base) {
  const { METROS } = await import('../../server/realEstateFeeds.js')
  const { CITIES } = await import('../../server/municipalities.js')
  const { STATES } = await import('../../server/marketMapSeed.js')
  let watch = []
  try { const t = await (await fetch(base + '/api/tickers')).json(); if (Array.isArray(t)) watch = t.map(x => (typeof x === 'string' ? x : x?.symbol)).filter(Boolean) } catch {}
  const symbols = [...new Set(['SPY', 'QQQ', 'IWM', 'DIA', 'AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', ...watch])]
  return [
    '/api/tensions', '/api/tensions?domain=ai', '/api/tensions?domain=economy',
    '/api/news-desk?auto=0', '/api/ideas?only=stocks',
    ...CITIES.map(c => `/api/municipality?city=${c.id}`),
    ...METROS.flatMap(m => [`/api/re-metro?code=${m.code}`, `/api/re-metro-employment?code=${m.code}`]),
    ...['state', 'metro', 'county'].map(l => `/api/market-map/${l}`),
    ...STATES.map(s => `/api/market-map/history/${s[0]}`),
    ...symbols.map(s => `/api/options-context?symbol=${encodeURIComponent(s)}`),
  ]
}

async function one(base, u) {
  const t = Date.now()
  const r = await fetch(base + u, { signal: AbortSignal.timeout(ROUTE_TIMEOUT_MS) })
  const body = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status} ${body.slice(0, 120)}`)
  const j = JSON.parse(body)
  if (j && typeof j === 'object' && !Array.isArray(j) && j.error && Object.keys(j).length <= 2) throw new Error(String(j.error).slice(0, 120))
  return { body, ms: Date.now() - t }
}

async function pool(items, n, fn) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]) }))
}

async function main() {
  fs.rmSync(OUT, { recursive: true, force: true })
  fs.mkdirSync(path.join(OUT, 'data', 'a'), { recursive: true })
  fs.mkdirSync(path.join(OUT, 'data', 'fred'), { recursive: true })
  const srv = await server()
  const urls = [...plainRoutes(), ...await enumeratedRoutes(srv.base)]
  log(`${urls.length} routes`)
  const got = {}, missing = []
  const fetchAll = list => pool(list, CONCURRENCY, async u => {
    try { const { body, ms } = await one(srv.base, u); got[u] = body; log(`  ok    ${u}  ${(body.length / 1024).toFixed(0)}kb  ${(ms / 1000).toFixed(1)}s`) }
    catch (e) { missing.push(u); log(`  miss  ${u}  ${e.message}`) }
  })
  await fetchAll(urls)
  // the Gurus tab opens a page per manager; the slugs come from the summary just saved
  let managers = []
  try { managers = (JSON.parse(got['/api/gurus'] || '{}').managers || []).map(m => m?.slug).filter(Boolean) } catch {}
  if (managers.length) { log(`${managers.length} Gurus manager pages`); await fetchAll(managers.map(s => `/api/gurus/manager?slug=${encodeURIComponent(s)}`)) }
  // rate-limited sources (BLS especially) often answer when asked one at a time
  const retry = missing.splice(0)
  for (const u of retry) { await sleep(1500); await fetchAll([u]) }
  srv.stop()

  // small answers share pack files; big ones get a file each
  const routes = {}, packs = []
  let pack = {}, packSize = 0, n = 0
  const flush = () => { if (!packSize) return; const f = `data/a/p${packs.length}.json`; fs.writeFileSync(path.join(OUT, f), JSON.stringify(pack)); packs.push(f); pack = {}; packSize = 0 }
  for (const [u, body] of Object.entries(got)) {
    const key = routeKey(u)
    if (body.length >= PACK_BELOW) { const f = `data/a/${n++}.json`; fs.writeFileSync(path.join(OUT, f), body); routes[key] = { f } }
    else { pack[key] = body; packSize += body.length; routes[key] = { f: `data/a/p${packs.length}.json`, k: key }; if (packSize > 3_000_000) flush() }
  }
  flush()

  // FRED: the relay's cache holds every series the app has asked for
  const cache = JSON.parse(fs.readFileSync(path.join(ROOT, 'fred-cache.json'), 'utf8'))
  const chunks = Array.from({ length: FRED_CHUNKS }, () => ({}))
  let fredAsOf = ''
  for (const [id, hit] of Object.entries(cache)) {
    if (!hit?.obs?.length) continue
    chunks[fredChunk(id)][id] = hit.obs.slice(-6500).map(o => [o.d, o.v])
    if (id === 'DGS10') fredAsOf = hit.obs[hit.obs.length - 1].d
  }
  chunks.forEach((c, i) => fs.writeFileSync(path.join(OUT, 'data', 'fred', `${i}.json`), JSON.stringify(c)))

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify({
    built: new Date().toISOString(), fredAsOf, routes, missing: missing.sort(), finra: WITH_FINRA,
  }, null, 1))
  fs.rmSync(ARCHIVE, { force: true })
  execFileSync('tar', ['-czf', ARCHIVE, '-C', OUT, '.'])
  const mb = (fs.statSync(ARCHIVE).size / 1048576).toFixed(1)
  log(`${Object.keys(got).length} saved · ${missing.length} missing · FRED through ${fredAsOf || '?'}`)
  log(`wrote duet-snapshot.tar.gz (${mb} MB): drop it into the Duet thread`)
}

main().catch(e => { console.error('[duet] failed:', e.message); process.exit(1) })
