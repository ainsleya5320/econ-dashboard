// ============================================================================
// TENSIONS: points of statistical contention. Each check in ./checks puts
// side by side what several independent sources claim about the same piece
// of the economy (prediction markets, bond and stock prices, the Fed's
// projections, official statistics, named forecasts) and works out what
// those claims jointly require. The board shows where the claims fit, where
// the circle needs squaring, and where they cannot all be true at once,
// with what would have to give and the observable to watch.
//
// AI Economy → Tensions shows domain 'ai'; U.S. Economy → Tensions shows
// domain 'economy'. One engine, one board.
//
// A check module (server/tensions/checks/<id>.js) default-exports
//   { id, domain: 'ai'|'economy', title, question, see?, order?, compute(ctx) }
// and compute returns
//   { status, headline, claims[], gap, gives[], watch[], math[], sources[], asOf }
// (the full shape is documented in docs/map/server.md). A check that throws
// or times out is shown as unavailable with its error; the rest still build.
//
// ctx: fred(id, n) → [{ d, v }] through the shared FRED cache;
//      markets.kalshi(event) / kalshiEvents(series) / polymarket(slug);
//      source(name) → another feed's payload (the getters passed in);
//      json(rel) → a repo data file; eia(route, params) → EIA v2 rows;
//      fetchJson(url) for any other public source; today 'YYYY-MM-DD'.
//
// Route: /api/tensions?domain=ai|economy (1h cache, stale served while it
// rebuilds). &only=<id>&fresh=1 rebuilds one check uncached. Check files are
// imported under their modification time, so an edited check is picked up on
// its next run without a restart. lib.js and aiCapexPath.js are not: Node keeps
// the first copy it loads for the life of the process, so restart the dev server
// after editing either.
// History: tensions-history.json at the repo root, one row per check per
// day (status and gap), written on full builds only.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { STATUSES, fin } from './lib.js'

const TTL = 3600e3
const CHECK_TIMEOUT = 120e3
const KEEP_DAYS = 3 * 366
const DOMAINS = ['ai', 'economy']
const pad2 = n => String(n).padStart(2, '0')
const localDay = (t = new Date()) => `${t.getFullYear()}-${pad2(t.getMonth() + 1)}-${pad2(t.getDate())}`

export function createTensions({ fetchFredSeries, markets, sources = {}, UA, dir, EIA_KEY = '' }) {
  const checksDir = path.join(dir, 'server', 'tensions', 'checks')
  const HISTORY_FILE = path.join(dir, 'tensions-history.json')
  const cache = {}, building = {}

  const loadModules = async () => {
    const files = fs.readdirSync(checksDir).filter(f => f.endsWith('.js')).sort()
    const out = []
    for (const f of files) {
      const id = f.replace(/\.js$/, '')
      try {
        const file = path.join(checksDir, f)
        const url = `${pathToFileURL(file).href}?v=${Math.round(fs.statSync(file).mtimeMs)}`
        const mod = (await import(url)).default
        if (!mod || typeof mod.compute !== 'function' || !DOMAINS.includes(mod.domain)) throw new Error('not a check module')
        out.push({ ...mod, id: mod.id || id })
      } catch (e) {
        console.warn(`Tensions: check ${f} failed to load: ${e.message}`)
        out.push({ id, domain: null, title: id, loadError: e.message })
      }
    }
    return out
  }

  const jsonCache = new Map()
  const ctx = {
    fred: (id, n = 60) => fetchFredSeries(id, n),
    markets,
    source: async name => {
      if (!sources[name]) throw new Error(`no source named ${name}`)
      return sources[name]()
    },
    json: rel => {
      const file = path.join(dir, rel)
      const mtime = fs.statSync(file).mtimeMs
      const hit = jsonCache.get(file)
      if (hit && hit.mtime === mtime) return hit.json
      const json = JSON.parse(fs.readFileSync(file, 'utf8'))
      jsonCache.set(file, { mtime, json })
      return json
    },
    eia: async (route, params = {}) => {
      if (!EIA_KEY) throw new Error('EIA_API_KEY not configured')
      const q = new URLSearchParams({ api_key: EIA_KEY })
      for (const [k, v] of Object.entries(params)) (Array.isArray(v) ? v : [v]).forEach(x => q.append(k, x))
      // the URL carries the key, so a network error is reported without it
      let r
      try { r = await fetch(`https://api.eia.gov/v2/${route.replace(/^\/+/, '')}?${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) }) } catch (e) { throw new Error(`EIA request failed (${e?.name || 'network error'})`) }
      if (!r.ok) throw new Error(`EIA HTTP ${r.status}`)
      const j = await r.json()
      // a data route returns its rows; a bare route returns its metadata (facets, frequencies), for exploring
      return j?.response?.data ?? j?.response ?? j
    },
    fetchJson: async (url, opts = {}) => {
      // Kalshi and Polymarket go through the market client's queue, retry and cache, so a raw call
      // made alongside the client's own (contract rules, trade prints) is not rate-limited away
      if (!opts.method && !opts.body && /^https:\/\/(api\.elections\.kalshi\.com|gamma-api\.polymarket\.com)\//.test(url)) return markets.getJson(url)
      const r = await fetch(url, { ...opts, headers: { 'User-Agent': UA, Accept: 'application/json', ...(opts.headers || {}) }, signal: AbortSignal.timeout(30000) })
      if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(url).host}`)
      return r.json()
    },
    // the server's local date (the user's own day), not UTC: an evening build is not stamped tomorrow
    get today() { return localDay() },
  }

  const withTimeout = (p, ms) => { let t; return Promise.race([p, new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`timed out after ${ms / 1000}s`)), ms) })]).finally(() => clearTimeout(t)) }

  const runCheck = async m => {
    const head = { id: m.id, domain: m.domain, title: m.title, question: m.question || null, see: m.see || null, order: m.order ?? 99 }
    if (m.loadError) return { ...head, status: 'unavailable', error: `failed to load: ${m.loadError}` }
    const t0 = Date.now()
    try {
      const r = await withTimeout(Promise.resolve().then(() => m.compute(ctx)), CHECK_TIMEOUT)
      const status = STATUSES.includes(r?.status) ? r.status : 'unavailable'
      return { ...head, ...r, status, ms: Date.now() - t0 }
    } catch (e) {
      const msg = String(e?.message ?? e)
      console.warn(`Tensions: ${m.id}: ${msg}`)
      return { ...head, status: 'unavailable', error: msg, ms: Date.now() - t0 }
    }
  }

  // History is the one thing here that cannot be rebuilt, so it is only ever started afresh when
  // the file does not exist. A file that cannot be read or parsed is left alone (and not written
  // over) until someone looks at it; writes go to a temporary file renamed into place.
  const isObj = x => x && typeof x === 'object' && !Array.isArray(x)
  const readHistory = () => {
    try { const h = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8')); return isObj(h) ? h : null } catch (e) {
      if (e?.code === 'ENOENT') return {}
      console.warn(`Tensions: ${path.basename(HISTORY_FILE)} could not be read (${e?.message}); history is not written until it is fixed`)
      return null
    }
  }
  const writeHistory = checks => {
    const h = readHistory(), day = ctx.today
    if (!h) return {}
    h[day] = { ...(isObj(h[day]) ? h[day] : {}) }
    for (const c of checks) if (c.status !== 'unavailable') h[day][c.id] = { status: c.status, gap: fin(c.gap?.value) ? Math.round(c.gap.value * 1000) / 1000 : null }
    const days = Object.keys(h).sort()
    for (const d of days.slice(0, Math.max(0, days.length - KEEP_DAYS))) delete h[d]
    const tmp = `${HISTORY_FILE}.tmp`
    try {
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(Object.keys(h).sort().map(d => [d, h[d]])), null, 1))
      fs.renameSync(tmp, HISTORY_FILE)
    } catch (e) { console.warn(`Tensions: history not written: ${e.message}`) }
    return h
  }
  const historyFor = (h, ids) => Object.fromEntries(ids.map(id => [id, Object.keys(h).sort().filter(d => isObj(h[d]) && isObj(h[d][id])).map(d => ({ d, ...h[d][id] }))]))

  const build = async domain => {
    const mine = (await loadModules()).filter(m => m.domain === domain || (m.loadError && !m.domain))
    const checks = (await Promise.all(mine.map(runCheck))).sort((a, b) => a.order - b.order || String(a.title).localeCompare(String(b.title)))
    // merged into the whole file, so the other domain's rows for today survive
    const h = writeHistory(checks.filter(c => c.domain === domain))
    const counts = Object.fromEntries(STATUSES.map(s => [s, checks.filter(c => c.status === s).length]))
    return { domain, built: new Date().toISOString(), counts, checks, history: historyFor(h, checks.map(c => c.id)) }
  }

  return {
    async get(req) {
      const q = new URL(req?.url || '/', 'http://x').searchParams
      const domain = q.get('domain') || 'economy'
      if (!DOMAINS.includes(domain)) throw new Error(`domain must be one of ${DOMAINS.join(', ')}`)
      const only = q.get('only'), fresh = q.get('fresh') === '1'
      if (only) {
        // one check, for iteration: never cached, never written to history
        const list = await loadModules()
        const m = list.find(x => x.id === only)
        if (!m) throw new Error(`no check ${only}`)
        return { domain: m.domain, built: new Date().toISOString(), checks: [await runCheck(m)] }
      }
      const hit = cache[domain]
      if (hit && !fresh && Date.now() - hit.ts < TTL) return hit.data
      if (!building[domain]) {
        building[domain] = build(domain).then(data => { cache[domain] = { ts: Date.now(), data }; return data }).finally(() => { building[domain] = null })
        // a background rebuild that fails must not become an unhandled rejection (it would end the
        // dev server); the stale board keeps being served and the next request tries again
        building[domain].catch(e => console.warn(`Tensions: ${domain} rebuild failed: ${e?.message ?? e}`))
      }
      if (hit && !fresh) return { ...hit.data, stale: true }
      return building[domain]
    },
  }
}
