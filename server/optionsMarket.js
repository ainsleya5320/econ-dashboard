// ============================================================================
// OPTIONS MARKET: Options → Market, the temperature of the options market.
//   indices    Cboe's daily index histories, cdn.cboe.com/api/global/us_indices/
//              daily_prices/{NAME}_History.csv: VIX (since 1990), VIX9D, VIX3M,
//              VIX6M, VIX1Y, VVIX, SKEW, VXN, RVX, OVX, GVZ. Refetched every 12
//              hours; the live value comes from Cboe's delayed index quotes
//              (about 15 minutes behind, cached 10 minutes). Each reading's
//              percentile is the share of daily closes below it (ties count
//              half) over the past year, five years and the whole history. The
//              previous close comes from the history, because Cboe's own
//              prev_day_close rolls to today's close in the evening.
//   term       VIX9D, VIX, VIX3M, VIX6M and VIX1Y as a curve (9, 30, 93, 184
//              and 365 days), now, a month ago and a year ago. The state is
//              read from VIX ÷ VIX3M: inverted at 1.00 or above, flat from 0.95,
//              contango below.
//   put/call   Cboe's daily market statistics, one JSON per trading day at
//              cdn.cboe.com/data/us/options/market_statistics/daily/
//              {YYYY-MM-DD}_daily_options: put volume over call volume for all
//              products, index, exchange-traded products, equity, SPX + SPXW
//              and VIX options. These are Cboe Options Exchange volumes, not
//              the whole market. The ratios are recomputed from the published
//              volumes to three decimals (Cboe prints two). The tracked archive
//              data/options/cboe-put-call.json is built by `node
//              scripts/refresh-seeds.mjs putcall` (two years) and grown here:
//              each trading day missing from the last two weeks is fetched once
//              it is published (today's only after 6 pm ET, so a partial day
//              is never archived). Weekdays missing from VIX's history are
//              holidays and are not requested; VIX also lists a few market
//              holidays (Thanksgiving, July 4 …), which Cboe answers with 403
//              and are dropped once a later day is in. Checked at most every
//              30 minutes.
//   scan       Cboe's delayed option chains, cdn-api.cboe.com/api/global/
//              delayed_quotes/options/{SYMBOL}.json, for SPY QQQ IWM DIA (index),
//              TLT HYG GLD USO (macro), the eleven Select Sector SPDRs and SMH
//              (sector), the 15 largest S&P 500 members by market cap in
//              sp500-data.json, one share class each (megacap), and the
//              watchlist in tickers.json, read at each scan (watchlist; a name
//              already in another group keeps it and gets watch: true). Per name:
//                iv30, iv30Chg   Cboe's own 30-day implied volatility, %
//                ivCm30          ours: constant-maturity 30-day ATM IV
//                                (constantMaturityIv), %
//                ivTerm          ATM IV at each listed expiry up to 365 days
//                smile, rr25     the out-of-the-money smile at the expiry
//                                nearest 30 days (7 to 60 out); 25-delta put
//                                and call IV and ATM IV at a constant 30 days,
//                                interpolated in total variance between the
//                                expiries either side (skewAt). rr25 = put25 -
//                                call25, positive when puts are dearer
//                volume, OI      every contract of the name's own root,
//                                same-day expiries included; premium is volume
//                                × mid × 100 (the last price without a
//                                two-sided quote), so dollars traded today
//                move            ATM straddle mid ÷ spot at the nearest expiry at
//                                least 5 days out
//                fan             risk-neutral 10/25/50/75/90% quantiles as % of
//                                spot at up to ten expiries 5-200 days out, from
//                                smileDistribution with marketInputs (FMP
//                                Treasury rate nearest the expiry, trailing-year
//                                dividends; server/optionsContext.js)
//                earnings        next earnings date from the same context
//                ivRv.rv21       21-day realized volatility from FMP daily closes,
//                                fetched once per 12 hours per name
//                picks           one candidate per classic strategy (screenChain in
//                                src/lib/optionStrategies.js) at the expiry nearest
//                                45 days, default deltas and widths, odds from the
//                                same distribution as the fan; trimmed fields
//              The smile, skew and term use quotes with a positive bid, a valid
//              ask, a spread under 50% of mid and some open interest: looser
//              than quoteQuality's defaults (35%, 50 contracts), which leave
//              most single-stock wings empty in Cboe's closing snapshot. The
//              constant-maturity IV and the fan keep the defaults. After the
//              close that snapshot pulls or widens many quotes (most sector
//              ETFs lose their wings), so a scan outside 9:35 am-4:10 pm ET keeps
//              the skew, ivCm30, term, smile, fan and move blocks from the day's
//              last in-session scan wherever its own come out empty, and names
//              them in row.carried.
//   unusual    contracts with volume of at least 500, above 1.5 × open interest
//              (or open interest 0), and premium of at least $100k, expiring
//              tomorrow or later; the 40 largest by premium across the scan.
//              The snapshot holds the day's cumulative volume, not trades, so
//              the direction is unknown: side is only where the last trade
//              printed against the current bid and ask.
// Cadence: stale-while-revalidate. A GET serves the last scan at once and
// starts a background rescan when it is older than 30 minutes (3 hours from
// 8 pm to 7 am ET and at weekends, when the delayed data does not change); the
// first GET with no scan on disk waits for one (about 15-20 s). Two chains at a
// time, starting at least 300 ms apart, browser user agent, 45 s timeout; Cboe
// answers 429 with Retry-After when pushed (seen after ~150 chains in a few
// minutes), which holds every request that long, up to four times. A chain is
// dropped once its row is computed. A symbol that fails becomes an entry in
// scan.errors; one that fails for a passing reason keeps its previous row
// (kept: true). A failed scan is not retried for 5 minutes. A source that fails
// is a null block plus a line in sourceErrors, never a 500.
// Files (repo root, gitignored because they name the watchlist):
//   options-market-scan.json      the last scan, the realized-vol cache and each
//                                 name's blocks from the last in-session scan
//   options-market-history.json   archive: one row per name per trading day (the
//                                 last scan of the day wins) with iv30, rr25 and
//                                 pcVol, 400 days kept; the payload carries 260
//   options-market-indices.json   cache of the Cboe index histories
// The archive and the put/call file are never written over when they cannot be
// read (logged and skipped until someone looks); caches are rebuilt. Every
// write is a temp file renamed into place.
// Route: /api/options-market
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import {
  finite, todayNY, normalizeChain, constantMaturityIv, smileDistribution, distributionQuantile, realizedHistory,
  marketInputs, quotesByExpiry, atmTerm, skewAt, smilePoints, straddleMove, unusualContracts,
} from '../src/lib/optionsAnalysis.js'
import { screenChain } from '../src/lib/optionStrategies.js'

export const PUTCALL_REL = path.join('data', 'options', 'cboe-put-call.json')
const HIST_URL = n => `https://cdn.cboe.com/api/global/us_indices/daily_prices/${n}_History.csv`
const QUOTE_URL = n => `https://cdn.cboe.com/api/global/delayed_quotes/quotes/_${n}.json`
const STATS_URL = d => `https://cdn.cboe.com/data/us/options/market_statistics/daily/${d}_daily_options`
const CHAIN_URL = s => `https://cdn-api.cboe.com/api/global/delayed_quotes/options/${encodeURIComponent(s)}.json`

export const INDICES = [
  ['VIX', 'S&P 500 volatility, 30 days'], ['VIX9D', 'S&P 500 volatility, 9 days'], ['VIX3M', 'S&P 500 volatility, 3 months'],
  ['VIX6M', 'S&P 500 volatility, 6 months'], ['VIX1Y', 'S&P 500 volatility, 1 year'], ['VVIX', 'Volatility of the VIX'],
  ['SKEW', 'S&P 500 tail risk (SKEW)'], ['VXN', 'Nasdaq-100 volatility'], ['RVX', 'Russell 2000 volatility'],
  ['OVX', 'Crude oil volatility'], ['GVZ', 'Gold volatility'],
]
const TERM = [['VIX9D', 9], ['VIX', 30], ['VIX3M', 93], ['VIX6M', 184], ['VIX1Y', 365]]
const ETFS = [
  ['SPY', 'index', 'S&P 500', 'SPDR S&P 500 ETF Trust'], ['QQQ', 'index', 'Nasdaq-100', 'Invesco QQQ Trust'],
  ['IWM', 'index', 'Russell 2000', 'iShares Russell 2000 ETF'], ['DIA', 'index', 'Dow Jones Industrials', 'SPDR Dow Jones Industrial Average ETF'],
  ['TLT', 'macro', 'Long Treasuries (20+ years)', 'iShares 20+ Year Treasury Bond ETF'], ['HYG', 'macro', 'High-yield credit', 'iShares iBoxx $ High Yield Corporate Bond ETF'],
  ['GLD', 'macro', 'Gold', 'SPDR Gold Shares'], ['USO', 'macro', 'Crude oil', 'United States Oil Fund'],
  ['XLK', 'sector', 'Technology', 'Technology Select Sector SPDR Fund'], ['XLF', 'sector', 'Financials', 'Financial Select Sector SPDR Fund'],
  ['XLE', 'sector', 'Energy', 'Energy Select Sector SPDR Fund'], ['XLV', 'sector', 'Health care', 'Health Care Select Sector SPDR Fund'],
  ['XLY', 'sector', 'Consumer discretionary', 'Consumer Discretionary Select Sector SPDR Fund'], ['XLP', 'sector', 'Consumer staples', 'Consumer Staples Select Sector SPDR Fund'],
  ['XLI', 'sector', 'Industrials', 'Industrial Select Sector SPDR Fund'], ['XLU', 'sector', 'Utilities', 'Utilities Select Sector SPDR Fund'],
  ['XLB', 'sector', 'Materials', 'Materials Select Sector SPDR Fund'], ['XLRE', 'sector', 'Real estate', 'Real Estate Select Sector SPDR Fund'],
  ['XLC', 'sector', 'Communication services', 'Communication Services Select Sector SPDR Fund'], ['SMH', 'sector', 'Semiconductors', 'VanEck Semiconductor ETF'],
]
const MEGACAPS = 15
const BOARD_QUOTES = { maxSpread: 0.5, minOi: 1 }
const CHAIN_GAP = 300, NO_OPTIONS = 'no options listed on Cboe'
const UNUSUAL = { minVol: 500, volOi: 1.5, minPremium: 1e5 }
const FAN_TARGETS = [7, 14, 21, 30, 45, 60, 90, 120, 150, 180]
const PC_KEYS = [['total', 'SUM OF ALL PRODUCTS', 'TOTAL PUT/CALL RATIO'], ['equity', 'EQUITY OPTIONS', 'EQUITY PUT/CALL RATIO'], ['index', 'INDEX OPTIONS', 'INDEX PUT/CALL RATIO'],
  ['etp', 'EXCHANGE TRADED PRODUCTS', 'EXCHANGE TRADED PRODUCTS PUT/CALL RATIO'], ['spx', 'SPX + SPXW', 'SPX + SPXW PUT/CALL RATIO'], ['vix', 'CBOE VOLATILITY INDEX (VIX)', 'CBOE VOLATILITY INDEX (VIX) PUT/CALL RATIO']]
const PC_VOL = ['equity', 'index', 'etp', 'total']
const ARCHIVE_DAYS = 400, PAYLOAD_DAYS = 260
const H12 = 12 * 3600e3, MIN30 = 30 * 60e3

const num = v => (v != null && String(v).trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const rd = (v, k) => (finite(v) ? Math.round(v * 10 ** k) / 10 ** k : null)
const pctOf = v => (finite(v) ? Math.round(v * 1000) / 10 : null) // decimal IV → % with one decimal
// one strategy pick, trimmed for the payload (the Strategies builder rebuilds full candidates client-side)
const slimPick = c => (!c ? null : {
  strategy: c.strategy, expiryDate: c.expiryDate, dte: c.dte, spot: c.spot, key: c.key, shares: c.shares || 0,
  legs: c.legs.map(l => ({ type: l.type, side: l.side, strike: l.strike, fill: l.fill, delta: rd(l.delta, 3) })),
  netPerShare: rd(c.netPerShare, 2), maxProfit: rd(c.maxProfit, 2), maxLoss: rd(c.maxLoss, 2), unlimitedProfit: !!c.unlimitedProfit, unlimitedLoss: !!c.unlimitedLoss,
  breakevens: (c.breakevens || []).map(b => rd(b, 2)), capital: rd(c.capital, 2), returnOnRisk: rd(c.returnOnRisk, 4), returnOnCapital: rd(c.returnOnCapital, 4),
  annualized: rd(c.annualized, 4), pop: rd(c.pop, 3), pMax: rd(c.pMax, 3), liquidity: { worstSpread: rd(c.liquidity?.worstSpread, 3), minOi: c.liquidity?.minOi ?? null },
})
const mean = xs => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : null)
const shift = (d, { y = 0, m = 0, days = 0 }) => { const t = new Date(`${d}T00:00:00Z`); t.setUTCFullYear(t.getUTCFullYear() + y, t.getUTCMonth() + m, t.getUTCDate() + days); return t.toISOString().slice(0, 10) }
const weekday = d => { const w = new Date(`${d}T00:00:00Z`).getUTCDay(); return w > 0 && w < 6 }
const sleep = ms => new Promise(r => setTimeout(r, ms))
// share of values below x, ties counted half, 0-100
const rankIn = (vals, x) => { if (!finite(x) || !vals.length) return null; let lo = 0, eq = 0; for (const v of vals) { if (v < x) lo++; else if (v === x) eq++ } return Math.round((1000 * (lo + eq / 2)) / vals.length) / 10 }
// the close on or before a date in a sorted [[d, v]] series
const onOrBefore = (s, d) => { let lo = 0, hi = s.length - 1, hit = null; while (lo <= hi) { const mid = (lo + hi) >> 1; if (s[mid][0] <= d) { hit = s[mid][1]; lo = mid + 1 } else hi = mid - 1 } return hit }
const etClock = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hourCycle: 'h23', weekday: 'short', hour: '2-digit', minute: '2-digit', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date()).map(x => [x.type, x.value]))
  const hour = Number(p.hour) % 24
  return { date: `${p.year}-${p.month}-${p.day}`, hour, mins: hour * 60 + Number(p.minute), weekend: p.weekday === 'Sat' || p.weekday === 'Sun' }
}
async function pool(items, n, fn) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; await fn(items[k], k) } }))
}
async function fetchText(url, UA, ms = 30_000, tries = 2) {
  for (let a = 1; ; a++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,text/csv,*/*' }, signal: AbortSignal.timeout(ms) })
      if (r.ok) return await r.text()
      r.body?.cancel().catch(() => {})
      const err = new Error(`HTTP ${r.status}`); err.status = r.status
      if (a >= tries || (r.status < 500 && r.status !== 429)) throw err
    } catch (e) {
      if (e.status || a >= tries) throw e.name === 'TimeoutError' ? new Error('timed out') : e
    }
    await sleep(1500)
  }
}
function readStrict(file) {
  try { return { data: JSON.parse(fs.readFileSync(file, 'utf8')) } } catch (e) { return e?.code === 'ENOENT' ? { missing: true } : { error: e.message } }
}
function writeAtomic(file, text) {
  const tmp = `${file}.tmp`
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(tmp, text); fs.renameSync(tmp, file); return true } catch (e) { console.warn(`Options market: ${path.basename(file)} not written (${e.message})`); return false }
}

// ── Cboe index histories ─────────────────────────────────────────────────────
export function parseIndexCsv(text) {
  const lines = String(text).trim().split(/\r?\n/), head = (lines.shift() || '').split(',').map(s => s.trim().toUpperCase())
  const di = head.indexOf('DATE'), ci = head.includes('CLOSE') ? head.indexOf('CLOSE') : head.length === 2 ? 1 : -1
  if (di < 0 || ci < 0) throw new Error(`unexpected columns ${head.join(',')}`)
  const out = []
  for (const l of lines) {
    const c = l.split(','), m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec((c[di] || '').trim()), v = Number(c[ci])
    if (m && Number.isFinite(v) && v > 0) out.push([`${m[3]}-${m[1]}-${m[2]}`, Math.round(v * 100) / 100])
  }
  out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return out.filter((r, i) => i === 0 || r[0] !== out[i - 1][0])
}
export async function fetchIndexHistory(name, UA) {
  const s = parseIndexCsv(await fetchText(HIST_URL(name), UA, 60_000))
  if (s.length < 250) throw new Error(`only ${s.length} rows`)
  return s
}

// ── Cboe daily market statistics (put/call) ──────────────────────────────────
// One trading day's ratios and volumes; null when Cboe has no file for the day
// (it answers 403 for weekends, holidays and days not yet published).
export async function fetchPutCallDay(day, UA) {
  let text
  try { text = await fetchText(STATS_URL(day), UA, 30_000) } catch (e) { if (e.status === 403 || e.status === 404) return null; throw new Error(`${day}: ${e.message}`) }
  const j = JSON.parse(text)
  const ratios = Object.fromEntries((j.ratios || []).map(r => [String(r.name).trim().toUpperCase(), num(r.value)]))
  const volOf = block => { const v = (j[block] || []).find(x => /^VOLUME$/i.test(String(x.name).trim())); return v && finite(num(v.call)) && finite(num(v.put)) ? { call: num(v.call), put: num(v.put) } : null }
  const row = { d: day }, vol = {}
  for (const [key, block, ratio] of PC_KEYS) {
    const v = volOf(block)
    row[key] = v && v.call > 0 ? rd(v.put / v.call, 3) : ratios[ratio] ?? null
    if (PC_VOL.includes(key)) vol[key] = v
  }
  if (!finite(row.total) && !finite(row.equity)) throw new Error(`${day}: no put/call ratios in the file`)
  row.vol = vol
  return row
}
// The archive file: one row per line so git diffs show the days added.
export function formatPutCall(rows) {
  const head = { source: 'Cboe Options Exchange daily market statistics (cdn.cboe.com/data/us/options/market_statistics/daily/)', note: 'put volume / call volume, recomputed from the published volumes; vol = Cboe Options Exchange contracts traded', updated: new Date().toISOString() }
  return `${JSON.stringify(head).slice(0, -1)},"rows":[\n${rows.map(r => JSON.stringify(r)).join(',\n')}\n]}\n`
}
// Fetch the given trading days (4 at a time); returns { rows, missing }.
export async function fetchPutCallDays(days, UA, log = () => {}) {
  const rows = [], missing = [], failed = []
  let done = 0
  await pool(days, 4, async d => {
    try { const r = await fetchPutCallDay(d, UA); r ? rows.push(r) : missing.push(d) } catch (e) { failed.push(`${d} (${e.message})`) }
    if (++done % 100 === 0) log(`  … ${done} of ${days.length} days`)
  })
  rows.sort((a, b) => a.d.localeCompare(b.d))
  return { rows, missing: missing.sort(), failed }
}

// ── the module ───────────────────────────────────────────────────────────────
export function createOptionsMarket({ UA, dir, FMP_KEY, context }) {
  const SCAN_FILE = path.join(dir, 'options-market-scan.json')
  const ARCHIVE_FILE = path.join(dir, 'options-market-history.json')
  const INDEX_FILE = path.join(dir, 'options-market-indices.json')
  const PUTCALL_FILE = path.join(dir, PUTCALL_REL)
  const TICKERS_FILE = path.join(dir, 'tickers.json'), SP500_FILE = path.join(dir, 'sp500-data.json')

  // ── indices ──
  let idx = null, idxRunning = null
  const quotes = new Map()
  const loadIdx = () => { if (!idx) { const c = readStrict(INDEX_FILE).data; idx = c && c.series && c.fetched ? c : { fetched: {}, series: {} } } return idx }
  async function refreshIndices(names, errors) {
    await pool(names, 4, async name => {
      try { idx.series[name] = await fetchIndexHistory(name, UA); idx.fetched[name] = new Date().toISOString() } catch (e) { errors?.push({ source: `Cboe ${name} history`, error: e.message }); console.warn(`Options market: ${name} history: ${e.message}`) }
    })
    writeAtomic(INDEX_FILE, JSON.stringify(idx))
  }
  async function ensureIndices(errors) {
    loadIdx()
    const missing = INDICES.map(([n]) => n).filter(n => !idx.series[n]?.length)
    if (missing.length) await refreshIndices(missing, errors)
    const stale = INDICES.map(([n]) => n).filter(n => idx.series[n]?.length && !(Date.now() - Date.parse(idx.fetched[n] || 0) < H12))
    if (stale.length && !idxRunning) idxRunning = refreshIndices(stale).finally(() => { idxRunning = null })
  }
  async function quote(name) {
    const c = quotes.get(name)
    if (c && Date.now() - c.at < 10 * 60e3) return c.q
    try {
      const d = JSON.parse(await fetchText(QUOTE_URL(name), UA, 15_000, 1)).data || {}
      const q = { price: num(d.current_price), time: d.last_trade_time || null, date: String(d.last_trade_time || '').slice(0, 10) }
      quotes.set(name, { at: Date.now(), q })
      return q
    } catch (e) { if (c) return c.q; throw e }
  }
  function indexBlock(name, label, s, q) {
    if (!s?.length) return null
    const lastH = s[s.length - 1]
    let last = lastH[1], asOf = lastH[0], prevClose = s.length > 1 ? s[s.length - 2][1] : null, date = lastH[0], hist = s
    if (q && finite(q.price) && q.price > 0 && /^\d{4}-\d{2}-\d{2}$/.test(q.date) && q.date >= lastH[0]) {
      last = q.price; asOf = q.time || q.date; date = q.date
      if (q.date > lastH[0]) { prevClose = lastH[1]; hist = [...s, [q.date, q.price]] } else hist = [...s.slice(0, -1), [q.date, q.price]]
    }
    const from = years => shift(date, { y: -years })
    const closes = since => s.filter(r => r[0] > since).map(r => r[1])
    const y1 = closes(from(1))
    return {
      name, label, last, prevClose, change: finite(prevClose) ? rd(last - prevClose, 2) : null, asOf,
      history: hist.filter(r => r[0] > from(3)),
      pct: { y1: rankIn(y1, last), y5: rankIn(closes(from(5)), last), all: rankIn(s.map(r => r[1]), last) },
      avg1y: rd(mean(y1), 2),
    }
  }
  async function buildIndices(errors) {
    await ensureIndices(errors)
    const out = {}
    await Promise.all(INDICES.map(async ([name, label]) => {
      const q = await quote(name).catch(e => { errors.push({ source: `Cboe ${name} quote`, error: e.message }); return null })
      out[name] = indexBlock(name, label, idx.series[name], q)
    }))
    return Object.fromEntries(INDICES.map(([n]) => [n, out[n] ?? null]))
  }
  function buildTerm(indices) {
    const vix = indices.VIX, v3 = indices.VIX3M
    if (!vix) return null
    const date = String(vix.asOf).slice(0, 10)
    const points = TERM.map(([key, days]) => {
      const b = indices[key], s = idx.series[key] || []
      return { key, days, last: b?.last ?? null, monthAgo: s.length ? onOrBefore(s, shift(date, { m: -1 })) : null, yearAgo: s.length ? onOrBefore(s, shift(date, { y: -1 })) : null, avg1y: b?.avg1y ?? null }
    })
    const ratio = (a, b) => (finite(indices[a]?.last) && indices[b]?.last > 0 ? rd(indices[a].last / indices[b].last, 3) : null)
    const ratios = { vix9dVix: ratio('VIX9D', 'VIX'), vixVix3m: ratio('VIX', 'VIX3M'), vix3mVix6m: ratio('VIX3M', 'VIX6M') }
    const v3by = new Map((v3?.history || []).map(r => [r[0], r[1]]))
    const ratioHistory = vix.history.filter(r => v3by.get(r[0]) > 0).map(r => [r[0], rd(r[1] / v3by.get(r[0]), 3)])
    const r = ratios.vixVix3m
    return { points, ratios, ratioHistory, state: !finite(r) ? null : r >= 1 ? 'inverted' : r >= 0.95 ? 'flat' : 'contango' }
  }

  // ── put/call archive ──
  let pc = null, pcBroken = false, pcRunning = null, pcChecked = 0
  const pcTried = new Map(), pcNoFile = new Set()
  function loadPutCall() {
    if (pc || pcBroken) return pc
    const st = readStrict(PUTCALL_FILE)
    if (st.error || (st.data && !Array.isArray(st.data.rows))) {
      pcBroken = true
      console.warn(`Options market: ${PUTCALL_REL} could not be read (${st.error || 'no rows array'}); it is not written until it is fixed`)
      return null
    }
    if (st.missing) console.warn(`Options market: ${PUTCALL_REL} is missing; starting it from the last two weeks (rebuild: node scripts/refresh-seeds.mjs putcall)`)
    pc = (st.data?.rows || []).filter(r => r && /^\d{4}-\d{2}-\d{2}$/.test(r.d)).sort((a, b) => a.d.localeCompare(b.d))
    return pc
  }
  async function appendPutCall() {
    pcChecked = Date.now()
    const rows = loadPutCall()
    if (!rows) return
    const et = etClock(), have = new Set(rows.map(r => r.d))
    const vixDays = idx?.series?.VIX || [], vixLast = vixDays.length ? vixDays[vixDays.length - 1][0] : null, vixSet = new Set(vixDays.map(r => r[0]))
    const cutoff = et.hour >= 18 ? et.date : shift(et.date, { days: -1 })
    // every day after the last row, and any hole in the last two weeks
    const twoWeeks = shift(et.date, { days: -14 }), after = rows.length ? shift(rows[rows.length - 1].d, { days: 1 }) : twoWeeks
    const start = after < twoWeeks ? after : twoWeeks, want = []
    for (let d = start; d <= cutoff; d = shift(d, { days: 1 })) {
      if (!weekday(d) || have.has(d) || pcNoFile.has(d) || (vixLast && d <= vixLast && !vixSet.has(d))) continue
      if (Date.now() - (pcTried.get(d) || 0) < MIN30) continue
      want.push(d)
    }
    if (!want.length) return
    want.forEach(d => pcTried.set(d, Date.now()))
    const got = await fetchPutCallDays(want, UA)
    for (const f of got.failed) console.warn(`Options market: put/call ${f}`)
    const merged = [...rows, ...got.rows.filter(r => !have.has(r.d))].sort((a, b) => a.d.localeCompare(b.d))
    // no file while a later day has one: a holiday (VIX's history lists some, e.g. Thanksgiving)
    const newest = merged.length ? merged[merged.length - 1].d : ''
    for (const d of got.missing) if (d < newest) pcNoFile.add(d)
    if (!got.rows.length) return
    // re-read first: never replace a file that has become unreadable since it was loaded
    const now = readStrict(PUTCALL_FILE)
    if (now.error) { pcBroken = true; pc = null; console.warn(`Options market: ${PUTCALL_REL} could not be read (${now.error}); not written`); return }
    if (writeAtomic(PUTCALL_FILE, formatPutCall(merged))) pc = merged
  }
  async function buildPutCall(first) {
    if (first) await appendPutCall().catch(e => console.warn(`Options market: put/call append: ${e.message}`))
    else if (!pcRunning && Date.now() - pcChecked > MIN30) pcRunning = appendPutCall().catch(e => console.warn(`Options market: put/call append: ${e.message}`)).finally(() => { pcRunning = null })
    const rows = loadPutCall()
    if (!rows?.length) return null
    const keys = PC_KEYS.map(k => k[0]), L = rows[rows.length - 1], since = shift(L.d, { y: -1 }), y1 = rows.filter(r => r.d > since)
    const pick = f => Object.fromEntries(keys.map(k => [k, f(k)]))
    return {
      latest: { date: L.d, ...pick(k => L[k] ?? null) },
      ma10: pick(k => rd(mean(rows.slice(-10).map(r => r[k]).filter(finite)), 3)),
      pct1y: pick(k => rankIn(y1.map(r => r[k]).filter(finite), L[k])),
      history: rows.map(r => ({ d: r.d, total: r.total ?? null, equity: r.equity ?? null, index: r.index ?? null, spx: r.spx ?? null })),
      volume: { date: L.d, ...Object.fromEntries(PC_VOL.map(k => [k, L.vol?.[k] ?? null])) },
    }
  }

  // ── the scan universe ──
  function universe() {
    const list = ETFS.map(([symbol, group, label, name]) => ({ symbol, group, label, watch: false, name }))
    const has = s => list.find(u => u.symbol === s)
    const sp = readStrict(SP500_FILE).data?.data || []
    let watch = readStrict(TICKERS_FILE).data
    watch = Array.isArray(watch) ? watch : Array.isArray(watch?.tickers) ? watch.tickers : []
    watch = [...new Set(watch.map(t => String(typeof t === 'string' ? t : t?.symbol || '').trim().toUpperCase()).filter(s => /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s)))]
    // one share class per company (Alphabet, Fox, News Corp list two): the watched one if either is
    const byName = new Map()
    for (const r of [...sp].filter(r => r?.symbol && finite(r.mktCap)).sort((a, b) => b.mktCap - a.mktCap)) { const k = r.name || r.symbol; byName.has(k) ? byName.get(k).push(r) : byName.set(k, [r]) }
    let megas = 0
    for (const classes of byName.values()) {
      if (megas >= MEGACAPS) break
      const r = classes.find(c => watch.includes(c.symbol)) || classes[0]
      if (classes.some(c => has(c.symbol))) continue
      list.push({ symbol: r.symbol, group: 'megacap', label: r.sector || null, watch: false, name: r.name || null }); megas++
    }
    for (const s of watch) {
      const u = has(s)
      if (u) { u.watch = true; continue }
      const r = sp.find(x => x.symbol === s)
      list.push({ symbol: s, group: 'watchlist', label: r?.sector || null, watch: true, name: r?.name || null })
    }
    return list
  }

  // ── one name ──
  // sums over every contract of the name's own root that had not expired on the trade date
  function activity(raw, root, tradeDate) {
    const t = { callVol: 0, putVol: 0, callOi: 0, putOi: 0, premCall: 0, premPut: 0 }
    for (const o of raw || []) {
      const m = /^(.*?)(\d{6})([CP])(\d{8})$/.exec(o.option || '')
      if (!m || m[1] !== root || `20${m[2].slice(0, 2)}-${m[2].slice(2, 4)}-${m[2].slice(4)}` < tradeDate) continue
      const vol = num(o.volume) || 0, oi = num(o.open_interest) || 0, bid = num(o.bid), ask = num(o.ask)
      const mid = bid > 0 && finite(ask) && ask >= bid ? (bid + ask) / 2 : num(o.last_trade_price) || 0
      if (m[3] === 'C') { t.callVol += vol; t.callOi += oi; t.premCall += vol * mid * 100 } else { t.putVol += vol; t.putOi += oi; t.premPut += vol * mid * 100 }
    }
    return t
  }
  // Cboe's chain host rate-limits (429 with Retry-After, seen after ~150 chains in a
  // few minutes): requests start at least CHAIN_GAP apart and a 429 holds every
  // request until its Retry-After has passed.
  const gate = { next: 0 }
  async function fetchChain(symbol) {
    for (let a = 1; ; a++) {
      const wait = gate.next - Date.now()
      if (wait > 0) await sleep(wait)
      gate.next = Math.max(gate.next, Date.now()) + CHAIN_GAP
      let r
      try { r = await fetch(CHAIN_URL(symbol), { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(45_000) }) } catch (e) {
        if (a >= 3) throw new Error(e.name === 'TimeoutError' ? 'timed out' : e.message)
        await sleep(1500); continue
      }
      if (r.ok) return r.text()
      r.body?.cancel().catch(() => {})
      if (r.status === 429 && a < 5) { gate.next = Math.max(gate.next, Date.now() + 1000 * Math.min(60, Math.max(5, Number(r.headers.get('retry-after')) || 15))); continue }
      if (r.status >= 500 && a < 3) { await sleep(1500); continue }
      const e = new Error(`HTTP ${r.status}`); e.status = r.status; throw e
    }
  }
  async function scanOne(u, ctxP, rvP) {
    const root = u.symbol.replace(/[.\-]/g, '')
    let text
    try { text = await fetchChain(u.symbol) } catch (e) { throw new Error(e.status === 403 || e.status === 404 ? NO_OPTIONS : `Cboe chain: ${e.message}`) }
    let json = JSON.parse(text); text = null
    const d = json.data || {}
    const chain = normalizeChain(json, root)
    const tradeDate = String(d.last_trade_time || '').slice(0, 10) || todayNY()
    const act = activity(d.options, root, tradeDate)
    json = null; d.options = null
    const spot = chain.spot, opts = chain.options.filter(o => o.standard)
    if (!(spot > 0)) throw new Error('no underlying price')
    if (!opts.length) throw new Error('no listed options')

    const by = quotesByExpiry(opts, BOARD_QUOTES)
    const sk = skewAt(opts, spot, 30, 7, by)
    const smileDte = [...by.keys()].filter(t => t >= 7 && t <= 60 && smilePoints(by.get(t), spot).length >= 5).sort((a, b) => Math.abs(a - 30) - Math.abs(b - 30) || a - b)[0]
    const mv = straddleMove(opts, spot, 5)
    const ctx = await ctxP, rv = await rvP
    const etf = u.group === 'index' || u.group === 'macro' || u.group === 'sector'
    const today = todayNY()
    const dtes = [...new Set(opts.map(o => o.dte))].filter(t => t >= 5 && t <= 200).sort((a, b) => a - b)
    const fanDtes = [...new Set(FAN_TARGETS.map(t => dtes.slice().sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0]).filter(t => t != null))].sort((a, b) => a - b)
    const fan = []
    for (const t of fanDtes) {
      const inp = marketInputs(ctx, spot, t)
      if (!finite(inp.rate) || !finite(inp.dividend)) break
      const dist = smileDistribution(opts, t, spot, inp.rate, inp.dividend)
      if (!dist) continue
      const q = [0.1, 0.25, 0.5, 0.75, 0.9].map(p => distributionQuantile(dist, p))
      if (q.every(finite)) fan.push({ expiryDate: dist.expiryDate, dte: t, q10: rd(100 * q[0] / spot, 2), q25: rd(100 * q[1] / spot, 2), q50: rd(100 * q[2] / spot, 2), q75: rd(100 * q[3] / spot, 2), q90: rd(100 * q[4] / spot, 2) })
    }
    // one pick per classic strategy at the expiry nearest 45 days (src/lib/optionStrategies.js), odds from the
    // same risk-neutral distribution as the fan; null when no strategy can be built from liquid quotes
    let picks = null
    try {
      const sc = screenChain({ spot, options: opts }, { dte: 45, dist: (_e, t) => { const inp = marketInputs(ctx, spot, t); return finite(inp.rate) && finite(inp.dividend) ? smileDistribution(opts, t, spot, inp.rate, inp.dividend) : null } })
      const p = Object.fromEntries(Object.entries(sc.picks).map(([k, c]) => [k, slimPick(c)]))
      if (Object.values(p).some(Boolean)) picks = p
    } catch { picks = null }
    const unusual = unusualContracts(opts.filter(o => o.dte >= 1), spot, UNUSUAL).slice(0, 40).map(x => ({
      symbol: u.symbol, sym: x.sym, type: x.type, strike: x.strike, expiryDate: x.expiryDate, dte: x.dte, m: rd(x.m, 3), vol: x.vol, oi: x.oi, ratio: rd(x.ratio, 2),
      premium: Math.round(x.premium), iv: pctOf(x.iv), delta: rd(x.delta, 3), last: x.last, side: x.side,
    }))
    const iv30 = num(d.iv30)
    const row = {
      symbol: u.symbol, group: u.group, label: u.label ?? null, watch: !!u.watch, name: u.name ?? null,
      spot, chgPct: rd(num(d.price_change_percent), 2), iv30: iv30 > 0 ? rd(iv30, 2) : null, iv30Chg: iv30 > 0 ? rd(num(d.iv30_change), 2) : null,
      ivCm30: pctOf(constantMaturityIv(opts, spot, 30)),
      ivTerm: atmTerm(opts, spot, 365, by).map(p => ({ dte: p.dte, iv: pctOf(p.iv) })),
      smile: smileDte == null ? null : { expiryDate: by.get(smileDte)[0].expiryDate, dte: smileDte, points: smilePoints(by.get(smileDte), spot).map(p => ({ m: rd(p.m, 4), delta: rd(p.delta, 3), iv: pctOf(p.iv) })) },
      rr25: pctOf(sk.rr25), put25: pctOf(sk.put25), call25: pctOf(sk.call25), atm: pctOf(sk.atm),
      callVol: act.callVol, putVol: act.putVol, callOi: act.callOi, putOi: act.putOi,
      pcVol: act.callVol > 0 ? rd(act.putVol / act.callVol, 3) : null, pcOi: act.callOi > 0 ? rd(act.putOi / act.callOi, 3) : null,
      premCall: Math.round(act.premCall), premPut: Math.round(act.premPut),
      move: mv ? { expiryDate: mv.expiryDate, dte: mv.dte, pct: rd(mv.pct, 2) } : null,
      fan,
      earnings: etf ? null : (ctx?.events || []).find(e => e.type === 'Earnings' && e.date >= today)?.date ?? null,
      ivRv: finite(rv) ? { rv21: rd(rv, 1) } : null,
      picks,
      asOf: d.last_trade_time || null,
    }
    return { row, unusual, tradeDate }
  }

  // ── realized volatility (FMP daily closes), 12h per name ──
  async function realizedVol(symbol, rvCache) {
    const c = rvCache[symbol]
    if (c && Date.now() - Date.parse(c.at) < H12) return c.rv21
    if (!FMP_KEY) return null
    const fmpSym = symbol.replace('.', '-'), from = shift(todayNY(), { days: -50 })
    const r = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=${encodeURIComponent(fmpSym)}&from=${from}&apikey=${FMP_KEY}`, { signal: AbortSignal.timeout(20_000) })
    if (!r.ok) throw new Error(`FMP prices HTTP ${r.status}`)
    const j = await r.json()
    if (!Array.isArray(j)) throw new Error('FMP prices: unexpected response')
    const h = realizedHistory(j.map(x => ({ date: String(x.date).slice(0, 10), close: num(x.price) })).filter(x => x.close > 0), 21)
    const rv21 = h.length ? h[h.length - 1].rv : null
    rvCache[symbol] = { at: new Date().toISOString(), rv21 }
    return rv21
  }

  // ── the scan ──
  let scan = null, scanRunning = null, scanError = null
  const loadScan = () => { if (!scan) { const c = readStrict(SCAN_FILE).data; if (c?.scanBuilt && Array.isArray(c.rows)) scan = c } return scan }
  function maxAge() { const et = etClock(); return et.weekend || et.hour >= 20 || et.hour < 7 ? 3 * 3600e3 : MIN30 }
  // After the close Cboe's snapshot pulls or widens many quotes (sector ETFs above
  // all), so the skew, smile, term and fan can no longer be read for some names.
  // An after-hours scan keeps those blocks from the day's last in-session scan
  // (same trade date) where its own come out empty, and lists them in carried.
  const CARRY = [['rr25', 'put25', 'call25', 'atm'], ['ivCm30'], ['ivTerm'], ['smile'], ['fan'], ['move'], ['picks']]
  const empty = v => v == null || (Array.isArray(v) && !v.length)
  function carrySession(rows, dates, et) {
    const prev = loadScan()?.session || {}, live = !et.weekend && et.mins >= 9 * 60 + 35 && et.mins <= 16 * 60 + 10
    const session = Object.fromEntries(Object.entries(prev).filter(([, s]) => s?.tradeDate && s.tradeDate >= shift(et.date, { days: -7 })))
    for (const r of rows) {
      const d = dates[r.symbol]
      r.carried = []
      if (live && d === et.date) { session[r.symbol] = { tradeDate: d, at: new Date().toISOString(), fields: Object.fromEntries(CARRY.flat().map(f => [f, r[f]])) }; continue }
      const s = session[r.symbol]
      if (!s || s.tradeDate !== d) continue
      for (const group of CARRY) if (empty(r[group[0]]) && !empty(s.fields[group[0]])) { for (const f of group) r[f] = s.fields[f]; r.carried.push(...group) }
    }
    return session
  }
  async function runScan() {
    const t0 = Date.now(), et0 = etClock(), uni = universe(), rvCache = { ...(loadScan()?.rv || {}) }
    const withTimeout = (p, ms) => Promise.race([p, sleep(ms).then(() => null)])
    // contexts and realized vol fetched alongside the chains (4 at a time), awaited per name
    const side = new Map(uni.map(u => [u.symbol, {}]))
    for (const s of side.values()) { s.ctx = new Promise(r => { s.ctxDone = r }); s.rv = new Promise(r => { s.rvDone = r }) }
    const sideJob = pool(uni, 4, async u => {
      const s = side.get(u.symbol), fmpSym = u.symbol.replace('.', '-')
      s.ctxDone(await withTimeout(Promise.resolve(context ? context(fmpSym) : null), 30_000).catch(() => null))
      s.rvDone(await withTimeout(realizedVol(u.symbol, rvCache), 25_000).catch(() => null))
    })
    const rows = [], unusual = [], errors = [], dates = {}
    await pool(uni, 2, async u => {
      try {
        const s = side.get(u.symbol)
        const { row, unusual: un, tradeDate } = await scanOne(u, s.ctx, s.rv)
        rows.push(row); unusual.push(...un); dates[u.symbol] = tradeDate
      } catch (e) { errors.push({ symbol: u.symbol, error: e.message || String(e) }) }
    })
    await sideJob
    if (!rows.length) throw new Error(`no chains could be read (${errors[0]?.error || 'unknown'})`)
    const session = carrySession(rows, dates, et0)
    // a name that failed for a passing reason (rate limit, timeout) keeps its previous
    // row, marked kept, and its previous unusual-activity lines
    const prev = loadScan(), fresh = rows.length
    for (const e of errors) {
      const old = e.error !== NO_OPTIONS && prev?.rows?.find(r => r.symbol === e.symbol)
      if (!old) continue
      const u = uni.find(x => x.symbol === e.symbol)
      rows.push({ ...old, group: u.group, label: u.label ?? null, watch: !!u.watch, kept: true })
      unusual.push(...(prev.unusual || []).filter(x => x.symbol === e.symbol))
      e.kept = true
    }
    const order = new Map(uni.map((u, i) => [u.symbol, i]))
    rows.sort((a, b) => order.get(a.symbol) - order.get(b.symbol))
    errors.sort((a, b) => order.get(a.symbol) - order.get(b.symbol))
    unusual.sort((a, b) => b.premium - a.premium)
    const next = {
      scanBuilt: new Date().toISOString(), ms: Date.now() - t0,
      universe: uni.map(({ symbol, group, label, watch }) => ({ symbol, group, label, watch })),
      rows, unusual: unusual.slice(0, 40), errors, rv: rvCache, session,
    }
    scan = next
    writeAtomic(SCAN_FILE, JSON.stringify(next))
    updateArchive(rows.filter(r => dates[r.symbol]), dates)
    console.log(`Options market: scanned ${fresh} of ${uni.length} names in ${(next.ms / 1000).toFixed(1)} s${errors.length ? ` (${errors.length} failed)` : ''}`)
    return next
  }
  // a failed scan is not retried for 5 minutes, so a Cboe outage is not hammered
  let lastFail = 0
  function startScan() {
    if (!scanRunning && Date.now() - lastFail > 5 * 60e3) scanRunning = runScan().then(s => { scanError = null; return s }).catch(e => { scanError = e.message; lastFail = Date.now(); console.warn(`Options market: scan failed: ${e.message}`); return null }).finally(() => { scanRunning = null })
    return scanRunning
  }

  // ── the daily archive ──
  let archive = null, archiveBroken = false
  function loadArchive() {
    if (archive || archiveBroken) return archive
    const st = readStrict(ARCHIVE_FILE)
    if (st.error || (st.data && typeof st.data.symbols !== 'object')) {
      archiveBroken = true
      console.warn(`Options market: ${path.basename(ARCHIVE_FILE)} could not be read (${st.error || 'no symbols'}); the daily archive is not written until it is fixed`)
      return null
    }
    archive = st.data || { version: 1, symbols: {} }
    return archive
  }
  function updateArchive(rows, dates) {
    if (!loadArchive()) return
    // re-read: another server instance (after a config reload) may have written since
    const st = readStrict(ARCHIVE_FILE)
    if (st.error || (st.data && typeof st.data.symbols !== 'object')) { archiveBroken = true; archive = null; console.warn(`Options market: ${path.basename(ARCHIVE_FILE)} could not be read; not written`); return }
    const a = st.data || { version: 1, symbols: {} }
    for (const r of rows) {
      const d = dates[r.symbol]
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d || '')) continue
      const m = (a.symbols[r.symbol] ||= {})
      m[d] = [r.iv30, r.rr25, r.pcVol]
      const days = Object.keys(m).sort()
      for (const old of days.slice(0, Math.max(0, days.length - ARCHIVE_DAYS))) delete m[old]
    }
    if (writeAtomic(ARCHIVE_FILE, JSON.stringify(a))) archive = a
  }
  function historyFor(symbols) {
    const a = loadArchive()?.symbols || {}
    return Object.fromEntries(symbols.filter(s => a[s]).map(s => [s, Object.keys(a[s]).sort().slice(-PAYLOAD_DAYS).map(d => ({ d, iv30: a[s][d][0], rr25: a[s][d][1], pcVol: a[s][d][2] }))]))
  }

  // ── the payload ──
  let firstPc = true
  async function get() {
    const sourceErrors = []
    let s = loadScan()
    const age = () => (s ? Date.now() - Date.parse(s.scanBuilt) : Infinity)
    const scanP = s ? null : startScan()
    if (s && age() > maxAge()) startScan()
    const indices = await buildIndices(sourceErrors).catch(e => { sourceErrors.push({ source: 'Cboe indices', error: e.message }); return {} })
    const term = (() => { try { return buildTerm(indices) } catch (e) { sourceErrors.push({ source: 'term structure', error: e.message }); return null } })()
    const putCall = await buildPutCall(firstPc).catch(e => { sourceErrors.push({ source: 'Cboe put/call', error: e.message }); return null })
    firstPc = false
    if (scanP) { await scanP; s = loadScan() }
    if (!putCall && !sourceErrors.some(e => e.source === 'Cboe put/call')) sourceErrors.push({ source: 'Cboe put/call', error: pcBroken ? `${PUTCALL_REL} could not be read` : 'no rows' })
    if (!s && scanError) sourceErrors.push({ source: 'option scan', error: scanError })
    return {
      built: new Date().toISOString(), scanBuilt: s?.scanBuilt ?? null, refreshing: !!scanRunning, stale: age() > maxAge(),
      indices, term, putCall,
      scan: s ? { universe: s.universe, rows: s.rows, unusual: s.unusual, errors: s.errors, ms: s.ms } : null,
      history: s ? historyFor(s.universe.map(u => u.symbol)) : {},
      sourceErrors,
    }
  }
  return { get }
}
