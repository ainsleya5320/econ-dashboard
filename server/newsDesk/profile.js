// ============================================================================
// NEWS DESK PROFILE: what the desk reads the news for.
//
//   buildProfile({ dir, UA, FMP_KEY, tensions }) → {
//     tickers:    [{ symbol, name, aliases, cik, sector, industry }], sorted by symbol
//     categories: data/news/categories.json, in file order
//     tensions:   [{ id, domain, title, question, watch }], sorted by domain then id
//   }
//
// tickers   the watchlist in tickers.json (gitignored, shared with the Stocks
//           and Options tabs), read on every build so edits show up at once.
//           Company names, CIKs and sectors come from FMP's /stable/profile
//           (one call per symbol; the batch form returns nothing) and are
//           cached in news-profile.json at the repo root (gitignored: it names
//           the holdings). Each entry is refreshed after 7 days; a failed
//           fetch keeps the old entry and retries after 6 hours. A symbol FMP
//           has no CIK for is looked up in SEC's company_tickers.json.
//           aliases: the short form of the company name (suffixes such as
//           Inc. or Holdings removed) plus any names the user adds to the
//           "aliases" array in news-profile.json, which refreshes never touch.
//           The model handles every other alias itself.
// tensions  `tensions` is a getter (sync or async) for the AI and economy
//           Tensions boards; it may return a list of checks, a board payload
//           ({ checks }), a list of payloads, or { ai, economy }. Only the id,
//           domain, title, question and watch labels are kept. 20 s timeout;
//           null or a failure gives [].
// The profile holds no timestamps, so rendering it into a prompt is stable
// from one call to the next (prompt caching depends on that).
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { writeJsonAtomic, readJsonSafe, setAside } from './store.js'

const CACHE_FILE = 'news-profile.json'
const REFRESH_MS = 7 * 864e5
const RETRY_MS = 6 * 3600e3
const TENSIONS_TIMEOUT = 20e3
const README = 'News Desk company profiles for the watchlist in tickers.json (per machine, gitignored). Add other names a company goes by to its "aliases" list; the weekly refresh rewrites the other fields and keeps aliases.'

const SUFFIX = /[,\s]+(inc\.?|incorporated|corp\.?|corporation|company|co\.?|ltd\.?|limited|plc|n\.?\s?v\.?|s\.?\s?a\.?|ag|se|holdings?|group|l\.?p\.?|llc|class [a-c]( common stock| ordinary shares| shares)?|common stock|ordinary shares|american depositary shares?|ads)$/i
// The everyday form of a registered company name: legal suffixes off.
export function shortName(name) {
  let s = String(name || '').trim().replace(/^the\s+/i, ''), prev
  do { prev = s; s = s.replace(SUFFIX, '').trim() } while (s && s !== prev)
  return s || String(name || '').trim()
}

const padCik = c => (c == null || c === '' || !/^\d+$/.test(String(c)) ? null : String(c).replace(/^0+/, '').padStart(10, '0'))
const str = v => (typeof v === 'string' && v.trim() ? v.trim() : null)

// tickers.json: a list of symbols (strings, or objects with a symbol)
export function readWatchlist(dir) {
  const res = readJsonSafe(path.join(dir, 'tickers.json'))
  if (res.state !== 'ok' || !Array.isArray(res.data)) return []
  const out = []
  for (const t of res.data) {
    const s = String(typeof t === 'string' ? t : t?.symbol || '').trim().toUpperCase()
    if (/^[A-Z0-9][A-Z0-9.\-]{0,11}$/.test(s) && !out.includes(s)) out.push(s)
  }
  return out
}

export function loadCategories(dir) {
  const res = readJsonSafe(path.join(dir, 'data', 'news', 'categories.json'))
  if (res.state !== 'ok') { console.warn(`News desk: data/news/categories.json ${res.state}${res.error ? ` (${res.error})` : ''}`); return [] }
  const rows = Array.isArray(res.data) ? res.data : Array.isArray(res.data?.categories) ? res.data.categories : []
  return rows
    .filter(c => c && str(c.id) && str(c.label))
    .map(c => ({
      id: c.id.trim(),
      label: c.label.trim(),
      description: str(c.description) || '',
      keywords: Array.isArray(c.keywords) ? c.keywords.filter(k => typeof k === 'string' && k.trim()).map(k => k.trim()) : [],
    }))
}

// ── tensions ────────────────────────────────────────────────────────────────
function checksOf(x) {
  if (!x) return []
  if (Array.isArray(x)) return x.flatMap(v => (v && Array.isArray(v.checks) ? v.checks : [v]))
  if (Array.isArray(x.checks)) return x.checks
  if (typeof x === 'object') return Object.values(x).flatMap(v => (v && Array.isArray(v.checks) ? v.checks : Array.isArray(v) ? v : []))
  return []
}
export function normaliseTensions(raw) {
  const seen = new Set(), out = []
  for (const c of checksOf(raw)) {
    if (!c || !str(c.id) || !str(c.title) || seen.has(c.id)) continue
    seen.add(c.id)
    const watch = (Array.isArray(c.watch) ? c.watch : [])
      .map(w => (typeof w === 'string' ? w : w?.label || w?.name || w?.text || ''))
      .map(w => String(w).trim()).filter(Boolean)
    out.push({ id: c.id, domain: str(c.domain) || null, title: c.title.trim(), question: str(c.question) || '', watch })
  }
  return out.sort((a, b) => String(a.domain).localeCompare(String(b.domain)) || a.id.localeCompare(b.id))
}
async function readTensions(getter) {
  if (typeof getter !== 'function') return []
  let timer
  try {
    const raw = await Promise.race([
      Promise.resolve().then(() => getter()),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timed out')), TENSIONS_TIMEOUT); timer.unref?.() }),
    ])
    return normaliseTensions(raw)
  } catch (e) {
    console.warn(`News desk profile: tensions unavailable (${e.message})`)
    return []
  } finally { clearTimeout(timer) }
}

// ── the per-machine profile cache ───────────────────────────────────────────
function readCache(file) {
  const res = readJsonSafe(file)
  if (res.state === 'missing') return { ok: true, data: { tickers: {} } }
  if (res.state === 'error') { console.warn(`News desk profile: cannot read ${CACHE_FILE} (${res.error})`); return { ok: false, data: { tickers: {} } } }
  if (res.state === 'corrupt' || !res.data || typeof res.data.tickers !== 'object' || Array.isArray(res.data.tickers)) {
    try {
      const dest = setAside(file)
      console.error(`News desk profile: ${CACHE_FILE} could not be parsed; moved it to ${path.basename(dest)} (copy any aliases back from it)`)
      return { ok: true, data: { tickers: {} } }
    } catch (e) { console.error(`News desk profile: ${CACHE_FILE} unreadable and not moved: ${e.message}`); return { ok: false, data: { tickers: {} } } }
  }
  return { ok: true, data: res.data }
}

async function getJson(url, UA, timeout = 15e3) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(timeout) })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

async function fmpProfile(symbol, { UA, FMP_KEY }) {
  const j = await getJson(`https://financialmodelingprep.com/stable/profile?symbol=${encodeURIComponent(symbol)}&apikey=${FMP_KEY}`, UA)
  const p = Array.isArray(j) ? j[0] : null
  if (!p || !str(p.companyName)) throw new Error('no profile')
  return {
    name: p.companyName.trim(),
    cik: padCik(p.cik),
    sector: str(p.sector),
    industry: str(p.industry),
    exchange: str(p.exchange),
    country: str(p.country),
  }
}

async function secTickerMap(UA) {
  const j = await getJson('https://www.sec.gov/files/company_tickers.json', UA, 30e3)
  const m = new Map()
  for (const v of Object.values(j || {})) if (v?.ticker) m.set(String(v.ticker).toUpperCase(), { cik: padCik(v.cik_str), title: str(v.title) })
  return m
}

const inflight = new Map()

async function refreshCache({ dir, UA, FMP_KEY, symbols }) {
  const file = path.join(dir, CACHE_FILE)
  const { ok, data } = readCache(file)
  const now = Date.now()
  const due = s => {
    const e = data.tickers[s]
    if (!e) return true
    if (e.failedAt && now - Date.parse(e.failedAt) < RETRY_MS) return false
    return !e.fetched || now - Date.parse(e.fetched) > REFRESH_MS || (e.failedAt && !e.fetched)
  }
  const todo = symbols.filter(due)
  if (!todo.length) return data

  // FMP: three at a time
  const q = [...todo]
  const worker = async () => {
    for (let s; (s = q.shift());) {
      const prev = data.tickers[s] || { aliases: [] }
      try {
        if (!FMP_KEY) throw new Error('no FMP key')
        const p = await fmpProfile(s, { UA, FMP_KEY })
        data.tickers[s] = { ...prev, ...p, cik: p.cik || prev.cik || null, fetched: new Date().toISOString(), aliases: Array.isArray(prev.aliases) ? prev.aliases : [] }
        delete data.tickers[s].failedAt
        delete data.tickers[s].error
      } catch (e) {
        data.tickers[s] = { name: prev.name || s, cik: prev.cik || null, sector: prev.sector || null, industry: prev.industry || null, ...prev, failedAt: new Date().toISOString(), error: e.message, aliases: Array.isArray(prev.aliases) ? prev.aliases : [] }
      }
    }
  }
  await Promise.all([worker(), worker(), worker()])

  // SEC: CIKs (and a name, if FMP had none) for whatever is still missing one
  const missing = todo.filter(s => !data.tickers[s]?.cik)
  if (missing.length) {
    try {
      const m = await secTickerMap(UA)
      for (const s of missing) {
        const hit = m.get(s) || m.get(s.replace(/\./g, '-')) || m.get(s.replace(/-/g, '.'))
        if (!hit) continue
        data.tickers[s].cik = hit.cik
        if ((!data.tickers[s].name || data.tickers[s].name === s) && hit.title) data.tickers[s].name = hit.title
      }
    } catch (e) { console.warn(`News desk profile: SEC ticker list unavailable (${e.message})`) }
  }

  if (ok) {
    try {
      // pick up alias edits made while we were fetching
      const fresh = readJsonSafe(file)
      if (fresh.state === 'ok' && fresh.data?.tickers) {
        for (const [s, e] of Object.entries(fresh.data.tickers)) {
          if (data.tickers[s] && Array.isArray(e?.aliases)) data.tickers[s].aliases = e.aliases
          else if (!data.tickers[s] && e) data.tickers[s] = e
        }
      }
      const tickers = Object.fromEntries(Object.keys(data.tickers).sort().map(s => [s, data.tickers[s]]))
      writeJsonAtomic(file, { _readme: README, tickers }, { pretty: true })
    } catch (e) { console.error(`News desk profile: could not save ${CACHE_FILE}: ${e.message}`) }
  }
  return data
}

export async function buildProfile({ dir, UA, FMP_KEY, tensions } = {}) {
  if (!dir) throw new Error('buildProfile needs dir')
  const symbols = readWatchlist(dir)
  const key = `${dir}|${symbols.join(',')}`
  if (!inflight.has(key)) inflight.set(key, refreshCache({ dir, UA, FMP_KEY, symbols }).finally(() => inflight.delete(key)))
  const [cache, tens] = await Promise.all([inflight.get(key), readTensions(tensions)])

  const tickers = [...symbols].sort().map(symbol => {
    const e = cache.tickers?.[symbol] || {}
    const name = str(e.name) || symbol
    const aliases = []
    const add = a => {
      const v = String(a || '').trim()
      if (v && v !== name && v.toUpperCase() !== symbol && !aliases.some(x => x.toLowerCase() === v.toLowerCase())) aliases.push(v)
    }
    add(shortName(name))
    for (const a of Array.isArray(e.aliases) ? e.aliases : []) add(a)
    return { symbol, name, aliases, cik: padCik(e.cik), sector: str(e.sector), industry: str(e.industry) }
  })

  return { tickers, categories: loadCategories(dir), tensions: tens }
}
