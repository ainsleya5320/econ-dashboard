// ============================================================================
// FOLLY MARKETS: Stocks → Sin & Folly, the market half of folly, and the
// gauge that sets sin, folly and the reckoning side by side.
//   CAPE         Shiller's cyclically adjusted P/E, monthly since 1881, from
//                shillerdata.com (the Yale copy stopped in 2023)
//   margin debt  the Fed's Financial Accounts: broker-dealer receivables from
//                customers, mostly margin loans (FRED BOGZ1FL663067003Q),
//                quarterly since 1945, against GDP. FINRA's monthly margin
//                statistics refuse scripted downloads.
//   IPOs         Jay Ritter's monthly counts and first-day returns since 1960
//                (IPOALL.xlsx), and his yearly share of IPOs with negative
//                earnings since 1980 (data/folly/ritter-ipos.json, read from
//                his PDF by scripts/ritter-ipos.py)
//   street gap   adjusted ("street") EPS against GAAP EPS, summed across
//                today's S&P 500 each quarter since 2007, from FMP. About
//                1,000 requests, so only the seed script builds it. S&P's own
//                operating-vs-reported history is behind its premium sign-in;
//                the totals in its public buyback report (2018 to Sept 2025)
//                make the same turns as this series, about four points lower,
//                since analysts' street figures leave out more than S&P's
//                operating definition does.
//   the gauge    each series as a percentile of its own history, averaged into
//                Folly (CAPE, margin-loan growth, IPO first-day returns, loss-
//                making IPOs, SPAC filings, buzzword 8-Ks), Sin (accruals, the
//                Beneish and Montier shares, the street gap) and the Reckoning
//                (restatements, auditor changes, late 10-Ks, material
//                weaknesses), quarterly since 1980. The SEC series come from
//                the Sin monitor (server/sinMonitor.js).
// Route: /api/folly-markets. The light sources refresh weekly in the
// background; data/seeds/folly-markets.json (node scripts/refresh-seeds.mjs
// folly) is the fallback and the only home of the street gap.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'
import { streetVsGaap, pctRank } from '../src/lib/accountingQuality.js'

export const SEED_NAME = 'folly-markets.json'
const WEEK = 7 * 864e5
const SHILLER_PAGE = 'https://shillerdata.com/'
const RITTER_MONTHLY = 'https://site.warrington.ufl.edu/ritter/files/IPOALL.xlsx'
const MARGIN = 'BOGZ1FL663067003Q', GDP = 'GDP'
const fin = v => v != null && Number.isFinite(v)
const r4 = v => (fin(v) ? Math.round(v * 1e4) / 1e4 : null)
const pad = n => String(n).padStart(2, '0')
const sleep = ms => new Promise(r => setTimeout(r, ms))
const qOf = ym => `${ym.slice(0, 4)}Q${Math.floor((+ym.slice(5, 7) - 1) / 3) + 1}`

async function download(url, UA, as = 'buffer') {
  const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*' }, signal: AbortSignal.timeout(120_000) })
  if (!r.ok) throw new Error(`${new URL(url).host} HTTP ${r.status}`)
  return as === 'text' ? r.text() : Buffer.from(await r.arrayBuffer())
}

// Shiller's Data sheet; dates are YYYY.MM with October written .1
async function fetchCape(UA) {
  const html = await download(SHILLER_PAGE, UA, 'text')
  const link = /href="([^"]*ie_data\.xls[^"]*)"/.exec(html)?.[1]
  if (!link) throw new Error('shillerdata.com: no ie_data.xls link')
  const wb = XLSX.read(await download(new URL(link.replace(/&amp;/g, '&'), SHILLER_PAGE).href, UA), { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Data, { header: 1, raw: true, defval: null })
  const h = rows.findIndex(r => r[0] === 'Date' && /CAPE/.test(String(r[12])))
  if (h < 0) throw new Error('Shiller Data sheet: the CAPE column moved')
  const out = []
  for (const r of rows.slice(h + 1)) {
    if (typeof r[0] !== 'number' || typeof r[12] !== 'number') continue
    const y = Math.floor(r[0]), m = Math.round((r[0] - y) * 100)
    if (m >= 1 && m <= 12) out.push([`${y}-${pad(m)}`, Math.round(r[12] * 100) / 100])
  }
  if (out.length < 1500) throw new Error(`Shiller CAPE: only ${out.length} months`)
  return out
}

// Ritter's IPOALL sheet: month, two-digit year (99 wraps to 0), average
// first-day return %, gross count, net count; "." where there is no return
async function fetchIpoMonthly(UA) {
  const wb = XLSX.read(await download(RITTER_MONTHLY, UA), { type: 'buffer' })
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: null })
  const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  let century = 1900, prev = -1
  const out = []
  for (const r of rows) {
    if (typeof r[0] !== 'number' || typeof r[1] !== 'number' || r[0] < 1 || r[0] > 12) continue
    if (r[1] < prev) century += 100
    prev = r[1]
    out.push({ d: `${century + r[1]}-${pad(r[0])}`, ret: fin(num(r[2])) ? r4(num(r[2]) / 100) : null, gross: num(r[3]), net: num(r[4]) })
  }
  if (out[0]?.d !== '1960-01' || out.length < 700) throw new Error(`Ritter IPOALL: unexpected layout (${out[0]?.d}, ${out.length} months)`)
  return out
}

// the cheap sources, refreshed weekly; fred(id) returns [{ d, v }]
export async function fetchLight({ UA, fred }) {
  const [cape, ipoMonthly, margin, gdp] = await Promise.all([
    fetchCape(UA), fetchIpoMonthly(UA),
    fred(MARGIN).then(o => o.filter(x => fin(x.v)).map(x => [x.d.slice(0, 7), x.v])),
    fred(GDP).then(o => o.filter(x => fin(x.v)).map(x => [x.d.slice(0, 7), x.v])),
  ])
  if (margin.length < 200 || gdp.length < 200) throw new Error('FRED margin or GDP history looks short')
  return { lightBuilt: new Date().toISOString(), cape, ipoMonthly, margin, gdp }
}

// Adjusted against GAAP earnings across today's S&P 500 (symbols from the
// screener file). A quarter belongs to the calendar quarter it mostly covers;
// an adjustment larger than half the quarter's revenue is a data error and is
// skipped. Dollars are EPS × diluted shares on the statement's basis, which FMP
// keeps split-adjusted on both sides.
export async function buildStreetGap({ fmpKey, symbols, log = console.log }) {
  let next = 0, calls = 0
  const fmp = async p => {
    for (let a = 0; ; a++) {
      const slot = Math.max(Date.now(), next); next = slot + 250
      if (slot > Date.now()) await sleep(slot - Date.now())
      const r = await fetch(`https://financialmodelingprep.com/stable${p}&apikey=${fmpKey}`, { signal: AbortSignal.timeout(60_000) })
      if (++calls % 200 === 0) log(`  … ${calls} FMP requests`)
      if (r.ok) { const j = await r.json().catch(() => null); return Array.isArray(j) ? j : [] }
      if (r.status === 429 && a < 4) { await sleep(15_000); continue }
      return []
    }
  }
  const byQ = new Map()
  let used = 0
  for (let i = 0; i < symbols.length; i += 4) {
    await Promise.all(symbols.slice(i, i + 4).map(async sym => {
      const [e, q] = await Promise.all([fmp(`/earnings?symbol=${encodeURIComponent(sym)}&limit=80`), fmp(`/income-statement?symbol=${encodeURIComponent(sym)}&period=quarter&limit=80`)])
      const rows = streetVsGaap(e, q)
      if (rows.length) used++
      for (const r of rows) {
        if (!fin(r.shares) || r.shares <= 0 || !fin(r.rev) || r.rev <= 0) continue
        const street = r.street * r.shares, gaap = r.gaap * r.shares
        if (Math.abs(street - gaap) > 0.5 * r.rev) continue
        const mid = new Date(Date.parse(`${r.end}T00:00:00Z`) - 45 * 864e5).toISOString().slice(0, 7)
        const k = qOf(mid)
        const s = byQ.get(k) || { street: 0, gaap: 0, n: 0, up: 0 }
        s.street += street; s.gaap += gaap; s.n++; if (r.street > r.gaap + 0.005) s.up++
        byQ.set(k, s)
      }
    }))
  }
  const qs = [...byQ.keys()].sort()
  // keep quarters most of the index has reported; the newest may still be filling in
  const counts = qs.map(k => byQ.get(k).n), peak = Math.max(...counts)
  const keep = qs.filter(k => byQ.get(k).n >= 0.6 * peak)
  log(`street gap: ${used} of ${symbols.length} companies matched, ${keep[0]}–${keep[keep.length - 1]}, ${calls} FMP requests`)
  return { built: new Date().toISOString(), companies: used, of: symbols.length, quarters: keep.map(k => { const s = byQ.get(k); return [k, Math.round(s.street / 1e6), Math.round(s.gaap / 1e6), s.n, s.up] }) }
}

// ── the gauge ───────────────────────────────────────────────────────────────
const quartersBetween = (a, b) => {
  const out = []; let [y, q] = a.split('Q').map(Number); const [by, bq] = b.split('Q').map(Number)
  while (y < by || (y === by && q <= bq)) { out.push(`${y}Q${q}`); q === 4 ? (y++, q = 1) : q++ }
  return out
}
const lastDone = () => { const d = new Date(); const q = Math.floor(d.getUTCMonth() / 3) + 1; return q === 1 ? `${d.getUTCFullYear() - 1}Q4` : `${d.getUTCFullYear()}Q${q - 1}` }
const prevQ = l => { const [y, q] = l.split('Q').map(Number); return q === 1 ? `${y - 1}Q4` : `${y}Q${q - 1}` }
// trailing four-quarter sum: the quarter and the three before it, all present
const t4 = (labels, vals) => {
  const m = new Map(labels.map((l, i) => [l, vals[i]]).filter(([, v]) => fin(v))), out = new Map()
  for (const l of m.keys()) { let k = l, s = 0, ok = true; for (let i = 0; i < 4 && ok; i++) { ok = fin(m.get(k)); s += m.get(k) ?? 0; k = prevQ(k) } if (ok) out.set(l, s) }
  return out
}

export function buildGauge({ d, ritter, sin }) {
  const comps = []
  // native: Map(label → value) at its own frequency; annual maps use 'YYYY'
  const done = lastDone()
  const add = (group, key, label, unit, native, annual = false) => {
    // an unfinished quarter would rank low just for being short; leave it out
    if (!annual) native = new Map([...native].filter(([k]) => k <= done))
    const vals = [...native.values()].filter(fin).sort((a, b) => a - b)
    if (vals.length >= 5) comps.push({ group, key, label, unit, native, annual, vals, since: [...native.keys()].sort()[0] })
  }
  // FOLLY
  if (d?.cape?.length) {
    const q = new Map(); for (const [m, v] of d.cape) { const k = qOf(m); const a = q.get(k) || []; a.push(v); q.set(k, a) }
    add('folly', 'cape', 'Shiller CAPE', 'x', new Map([...q].map(([k, a]) => [k, a.reduce((s, v) => s + v, 0) / a.length])))
  }
  if (d?.margin?.length) {
    // against the same quarter a year earlier (before 1952 the Fed publishes year-ends only)
    const m = new Map(d.margin.map(([ym, v]) => [qOf(ym), v])), g = new Map()
    for (const [k, v] of m) { const p = m.get(`${+k.slice(0, 4) - 1}${k.slice(4)}`); if (p > 0) g.set(k, v / p - 1) }
    add('folly', 'margin', 'Margin loans, growth over a year', '%', g)
  }
  if (d?.ipoMonthly?.length) {
    // first-day return over the trailing twelve months, weighted by IPO count
    const out = new Map(), mo = d.ipoMonthly
    for (let i = 11; i < mo.length; i++) {
      if (!/-(03|06|09|12)$/.test(mo[i].d)) continue
      let w = 0, s = 0
      for (let k = i - 11; k <= i; k++) { const n = mo[k].net ?? mo[k].gross; if (fin(mo[k].ret) && n > 0) { w += n; s += n * mo[k].ret } }
      if (w >= 10) out.set(qOf(mo[i].d), s / w)
    }
    add('folly', 'ipoRet', 'IPO first-day return, past year', '%', out)
  }
  if (ritter?.rows?.length) add('folly', 'ipoNeg', 'IPOs losing money', '%', new Map(ritter.rows.map(r => [String(r.y), r.neg])), true)
  if (sin?.folly?.series) {
    const Q = sin.folly.quarters, S = sin.folly.series
    add('folly', 'spac', 'SPAC registrations, past year', 'n', t4(Q, S.spac))
    add('folly', 'buzz', 'Buzzword 8-Ks, past year', 'n', t4(Q, Q.map((_, i) => ['blockchain', 'metaverse', 'ai', 'treasury'].reduce((s, k) => (fin(S[k]?.[i]) && fin(s) ? s + S[k][i] : null), 0))))
  }
  // SIN
  if (sin?.agg) {
    const years = Object.keys(sin.agg).filter(y => !sin.agg[y].partial)
    add('sin', 'accruals', 'Median accruals (the 500)', '%', new Map(years.map(y => [y, sin.agg[y].accruals.med])), true)
    add('sin', 'mShare', 'In Beneish manipulator zone', '%', new Map(years.map(y => [y, sin.agg[y].m.share])), true)
    add('sin', 'cShare', 'Montier C-score 4+', '%', new Map(years.map(y => [y, sin.agg[y].c.share])), true)
  }
  if (d?.streetGap?.quarters?.length) {
    const q = d.streetGap.quarters, L = q.map(x => x[0])
    const st = t4(L, q.map(x => x[1])), ga = t4(L, q.map(x => x[2]))
    add('sin', 'streetGap', 'Street over GAAP earnings, S&P 500', '%', new Map([...st].filter(([k]) => ga.get(k) > 0).map(([k, v]) => [k, v / ga.get(k) - 1])))
  }
  // RECKONING
  if (sin?.events?.all) {
    const Q = sin.events.quarters, A = sin.events.all
    for (const [key, label] of [['restatement', 'Restatement 8-Ks'], ['auditor', 'Auditor changes'], ['late10k', 'Late 10-K notices'], ['weakness', 'Material weaknesses']])
      if (A[key]) add('reckoning', key, `${label}, past year`, 'n', t4(Q, A[key]))
  }

  // each component's reading for a quarter, carried forward until a newer one
  // arrives so the latest quarter is not judged on whichever series reported
  // first: a quarterly series for up to three quarters, a yearly one through
  // the following year (FY2025 accounting is the newest until FY2026 is filed)
  const grid = quartersBetween('1980Q1', done)
  const reading = (c, q) => {
    if (c.annual) {
      for (let y = +q.slice(0, 4), back = 0; back <= 1; back++, y--) { const v = c.native.get(String(y)); if (fin(v)) return { v, as: String(y) } }
      return null
    }
    for (let k = q, back = 0; back <= 3; back++, k = prevQ(k)) { const v = c.native.get(k); if (fin(v)) return { v, as: k } }
    return null
  }
  const at = (c, q) => reading(c, q)?.v ?? null
  const series = { folly: [], sin: [], reckoning: [] }, counts = { folly: [], sin: [], reckoning: [] }
  for (const q of grid) {
    for (const g of Object.keys(series)) {
      const ps = comps.filter(c => c.group === g).map(c => pctRank(c.vals, at(c, q))).filter(fin)
      series[g].push(ps.length >= 2 ? Math.round((ps.reduce((s, p) => s + p, 0) / ps.length) * 1000) / 10 : null)
      counts[g].push(ps.length)
    }
  }
  // the newest reading, dated by the period it describes (a year for yearly series)
  const latestOf = c => { const r = reading(c, grid[grid.length - 1]); return r ? { q: r.as, v: r4(r.v), pct: Math.round(pctRank(c.vals, r.v) * 100) } : null }
  return {
    quarters: grid, ...series, counts,
    components: comps.map(c => ({ group: c.group, key: c.key, label: c.label, unit: c.unit, since: c.since, freq: c.annual ? 'yearly' : 'quarterly', n: c.vals.length, latest: latestOf(c) })),
  }
}

export function createFollyMarkets({ UA, dir, fetchFredSeries, sinMonitor }) {
  const CACHE = path.join(dir, 'folly-markets.json'), SEED = path.join(dir, 'data', 'seeds', SEED_NAME), RITTER = path.join(dir, 'data', 'folly', 'ritter-ipos.json')
  const read = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
  let mem = null, running = null, lastError = null
  function current() {
    if (mem) return mem
    const c = read(CACHE), s = read(SEED)
    // the cache carries fresher light sources; the street gap is newest in whichever was built later
    mem = c && s ? { ...s, ...c, streetGap: [c.streetGap, s.streetGap].filter(Boolean).sort((a, b) => Date.parse(b.built) - Date.parse(a.built))[0] || null } : c || s
    return mem
  }
  function refresh() {
    if (running) return running
    running = fetchLight({ UA, fred: id => fetchFredSeries(id, 4000) })
      .then(light => { mem = { ...(current() || {}), ...light }; lastError = null; try { fs.writeFileSync(CACHE, JSON.stringify(mem)) } catch (e) { console.error('folly-markets save:', e.message) } })
      .catch(e => { lastError = e.message; console.error('folly-markets refresh:', e.message) })
      .finally(() => { running = null })
    return running
  }
  async function get() {
    let d = current()
    if (!d) { await refresh(); d = current() }
    if (!d) throw new Error(`folly markets unavailable (${lastError || 'no data'}); run: node scripts/refresh-seeds.mjs folly`)
    if (!d.lightBuilt || Date.now() - Date.parse(d.lightBuilt) > WEEK) refresh()
    const ritter = read(RITTER)
    const sin = await sinMonitor().catch(() => null)
    return { ...d, ipoAnnual: ritter, gauge: buildGauge({ d, ritter, sin }), refreshing: !!running, refreshError: lastError }
  }
  return { get }
}
