// ============================================================================
// KALSHI GPU — AI Economy → Compute → GPU prices: what a prediction market
// expects a GPU-hour to rent for, month by month.
//
// Kalshi lists, for five chips (H100, H200, B200, A100, RTX 5090), one event
// per calendar month about ten months out. Each event is a ladder of yes/no
// contracts, "will the month's average hourly price be above $X", settled on
// the arithmetic mean of the hourly values of Ornn's rental index — the same
// index this dashboard already charts daily (/api/ornn). A ladder of "above
// $X" prices is the market's survival curve for the month's average, and the
// price where it crosses 50% is the market's median: half the money says
// higher, half says lower.
//
// Reading that median honestly takes more than averaging bid and ask, because
// most months beyond the first three have no resting quotes at all:
//   envelope   the chance of "above $X" can only fall as X rises, so a bid at
//              any strike is a floor for every strike below it and an ask is
//              a ceiling for every strike above it. That gives each strike a
//              band [lo, hi] the order book supports.
//   estimate   where the band is narrower than RULES.usable, its midpoint
//              (a "quoted" read; "tight" under RULES.tight). Where it is not
//              and the strike has traded, the last trade held inside the band
//              — a price of unknown age. Otherwise the strike says nothing.
//   monotone   the estimates are pooled so they never rise with the strike
//              (weighted by how they were read), then the 50% crossing is
//              interpolated between the two strikes around it.
//   bounds     the highest strike still bid at 50¢ or more and the lowest
//              strike offered at 50¢ or less: the range resting orders pin the
//              median to. A side with no such order is open.
// The crossing is interpolated inside one gap between strikes (25¢ on the
// H100, 50¢ on the H200 and B200), so when the odds fall from near-certain to
// near-zero across a single gap the point lands mid-gap by construction: the
// market has said which gap, not where in it. `between` carries the gap.
// A month reads `firm` when both strikes around the crossing are tightly
// quoted, `quoted` when both come from the book, and `trades` when either
// rests on a last trade; `gaps` marks a crossing that had to skip strikes with
// no read between its two legs. Months where every strike reads above or below
// 50% report only a floor or a ceiling.
//
// Months read from last trades also carry the date of the older of the trades
// they rest on. Kalshi keeps recent trades on /markets/trades and moves older
// ones to /historical/trades (the split date is at /historical/cutoff), so the
// live tape is asked first and the historical one when it has nothing.
//
// Beside the curve: the index's own daily history, its average by month, and
// for the month in progress where the month would finish if the index held at
// its latest value (`tracking`) and whether that sits inside the market's
// bounds. The daily index is one value a day and the contract settles on
// hourly values, so that check is approximate — though the daily averages for
// September and October 2026 matched Kalshi's settlements to the cent.
//
// A daily snapshot of every implied price is kept in kalshi-gpu-archive.json
// (gitignored) so the curve's movement can be read later; the last good build
// is served from it when Kalshi cannot be reached.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2'
const MIN = 60e3
const TTL = 30 * MIN
const sleep = ms => new Promise(r => setTimeout(r, ms))
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 2) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

export const CHIPS = [
  { id: 'h100', label: 'H100', series: 'KXH100MS' },
  { id: 'h200', label: 'H200', series: 'KXH200MS' },
  { id: 'b200', label: 'B200', series: 'KXB200MS' },
  { id: 'a100', label: 'A100', series: 'KXA100MS' },
  { id: 'rtx5090', label: 'RTX 5090', series: 'KXRTX5090MS' },
]
// tight / usable: the widest order-book band, in probability, that counts as a tight or a usable quote
export const RULES = { tight: 0.15, usable: 0.6, level: 0.5, weights: { tight: 4, quoted: 2, trade: 1 } }

// 'KXH100MS-26NOV' → '2026-11'
export function monthOf(event) {
  const m = /-(\d{2})([A-Z]{3})$/.exec(String(event || '')), i = m ? MONTHS.indexOf(m[2]) : -1
  return i < 0 ? null : `20${m[1]}-${String(i + 1).padStart(2, '0')}`
}

// strike markets → the same, sorted, each with the band [lo, hi] the order book supports
export function envelope(markets) {
  const m = (markets || []).filter(x => fin(x.strike)).sort((a, b) => a.strike - b.strike)
  const lo = [], hi = []
  let run = 0
  for (let i = m.length - 1; i >= 0; i--) { run = Math.max(run, fin(m[i].bid) ? m[i].bid : 0); lo[i] = run }
  run = 1
  for (let i = 0; i < m.length; i++) { run = Math.min(run, fin(m[i].ask) && m[i].ask > 0 ? m[i].ask : 1); hi[i] = run }
  return m.map((x, i) => ({ ...x, lo: Math.min(lo[i], hi[i]), hi: Math.max(lo[i], hi[i]) }))
}

// weighted pooling so the values never rise along the list
export function monotone(points) {
  const blocks = []
  for (const pt of points) {
    blocks.push({ sum: pt.p * pt.w, w: pt.w, n: 1 })
    while (blocks.length > 1 && blocks.at(-2).sum / blocks.at(-2).w < blocks.at(-1).sum / blocks.at(-1).w) {
      const b = blocks.pop(), a = blocks.at(-1)
      a.sum += b.sum; a.w += b.w; a.n += b.n
    }
  }
  return blocks.flatMap(b => Array(b.n).fill(b.sum / b.w))
}

// strike markets → [{ strike, p, read, lo, hi, ... }]: the chance of settling above each strike
export function survival(markets, R = RULES) {
  const env = envelope(markets).map(x => {
    const width = x.hi - x.lo
    if (width <= R.usable) return { ...x, raw: (x.lo + x.hi) / 2, read: width <= R.tight ? 'tight' : 'quoted' }
    if (fin(x.last) && x.last > 0 && (x.volume || 0) > 0) return { ...x, raw: clamp(x.last, x.lo, x.hi), read: 'trade' }
    return { ...x, raw: null, read: null }
  })
  const known = env.filter(x => x.read)
  const pooled = monotone(known.map(x => ({ p: x.raw, w: R.weights[x.read] })))
  known.forEach((x, i) => { x.p = clamp(pooled[i], x.lo, x.hi) })
  return env.map(({ raw, ...x }) => ({ ...x, p: fin(x.p) ? x.p : null }))
}

// the market's median and how well it is supported
export function implied(markets, R = RULES) {
  const s = survival(markets, R), known = s.filter(x => fin(x.p)), L = R.level
  const out = { implied: null, read: null, between: null, gaps: false, legs: [], floor: null, ceiling: null, lo: null, hi: null, strikes: s }
  // what resting orders pin the median to
  for (const x of s) { if (x.lo >= L) out.lo = x.strike; if (x.hi <= L && out.hi == null) out.hi = x.strike }
  if (!known.length) return out
  const k = known.findIndex(x => x.p < L)
  if (k === -1) { out.floor = known.at(-1).strike; return out }
  if (k === 0) { out.ceiling = known[0].strike; return out }
  const a = known[k - 1], b = known[k]
  out.implied = a.strike + (b.strike - a.strike) * ((a.p - L) / (a.p - b.p))
  out.between = [a.strike, b.strike]
  out.legs = [a, b].filter(x => x.read === 'trade').map(x => x.ticker).filter(Boolean)
  out.gaps = s.indexOf(b) - s.indexOf(a) > 1
  out.read = a.read === 'tight' && b.read === 'tight' && !out.gaps ? 'firm' : a.read !== 'trade' && b.read !== 'trade' ? 'quoted' : 'trades'
  return out
}

// the index's daily rows → one chip's history, monthly averages, and the month in progress against a target
export function realised(rows, key, target) {
  const daily = (rows || []).filter(r => r.d && fin(r[key])).map(r => ({ d: r.d, v: r[key] }))
  const by = {}
  for (const r of daily) (by[r.d.slice(0, 7)] ||= []).push(r.v)
  const monthly = Object.entries(by).sort().map(([month, v]) => {
    const [y, m] = month.split('-').map(Number), days = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return { month, avg: rnd(v.reduce((a, b) => a + b, 0) / v.length, 3), n: v.length, days, complete: v.length >= days - 1 }
  })
  let progress = null
  const cur = target && monthly.find(x => x.month === target.month)
  if (cur && fin(target.implied) && cur.n < cur.days) {
    const left = cur.days - cur.n, tracking = (cur.avg * cur.n + daily.at(-1).v * left) / cur.days
    const inside = (target.lo == null || tracking >= target.lo) && (target.hi == null || tracking <= target.hi)
    progress = { month: cur.month, soFar: rnd(cur.avg, 2), n: cur.n, days: cur.days, left, latest: daily.at(-1).v, tracking: rnd(tracking, 2), inside, bounded: target.lo != null && target.hi != null }
  }
  return { daily, monthly, latest: daily.at(-1) || null, progress }
}

// one month's event → a row
export function monthRow(event, markets, R = RULES) {
  const r = implied(markets, R), sum = k => markets.reduce((a, x) => a + (fin(x[k]) ? x[k] : 0), 0)
  return {
    event: event.event, month: monthOf(event.event), implied: rnd(r.implied, 2), read: r.read, between: r.between, gaps: r.gaps, legs: r.legs, tradedOn: null,
    floor: r.floor, ceiling: r.ceiling, lo: r.lo, hi: r.hi,
    volume: Math.round(sum('volume')), volume24h: Math.round(sum('volume24h')), openInterest: Math.round(sum('openInterest')),
    strikes: r.strikes.map(x => ({ strike: x.strike, bid: x.bid, ask: x.ask, last: x.last, volume: Math.round(x.volume || 0), p: rnd(x.p, 3), read: x.read })),
  }
}

export function createKalshiGpu({ dir, markets, feeds = {} }) {
  const FILE = path.join(dir, 'kalshi-gpu-archive.json')
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return { days: {}, last: null } } }
  let memo = null, pending = null

  // the date a strike last traded: the live tape, then the historical one
  async function lastTraded(ticker) {
    for (const tape of ['markets', 'historical']) {
      const j = await markets.getJson(`${KALSHI}/${tape}/trades?ticker=${encodeURIComponent(ticker)}&limit=1`).catch(() => null)
      const d = j?.trades?.[0]?.created_time?.slice(0, 10)
      if (d) return d
    }
    return null
  }

  async function chip(c, rows) {
    const events = await markets.kalshiEvents(c.series)
    const months = (await Promise.all(events.map(async e => monthRow(e, (await markets.kalshi(e.event)).markets)))).filter(m => m.month).sort((a, b) => a.month.localeCompare(b.month))
    // how old the trades behind a trade-read month are: the older of its legs
    await Promise.all(months.filter(m => m.legs.length).map(async m => {
      const dates = (await Promise.all(m.legs.map(lastTraded))).filter(Boolean)
      m.tradedOn = dates.length ? dates.sort()[0] : null
    }))
    for (const m of months) delete m.legs
    const front = months[0] || null, r = realised(rows, c.id, front)
    const read = months.filter(m => fin(m.implied))
    return {
      id: c.id, label: c.label, series: c.series, url: `https://kalshi.com/markets/${c.series.toLowerCase()}`,
      index: r.latest, daily: r.daily, monthly: r.monthly, progress: r.progress, months,
      front: front && fin(front.implied) ? front : null, last: read.at(-1) || null,
      supported: months.filter(m => m.read === 'firm' || m.read === 'quoted').length,
      volume: months.reduce((a, m) => a + m.volume, 0), volume24h: months.reduce((a, m) => a + m.volume24h, 0), openInterest: months.reduce((a, m) => a + m.openInterest, 0),
    }
  }

  async function build() {
    const ornn = await Promise.resolve(feeds.ornn?.()).catch(() => null)
    // one chip at a time (a build is ~200 requests and Kalshi rate-limits bursts); a chip that fails is tried once
    // more, then carried over from the last good build and marked
    const store = load(), chips = []
    let failure = null
    for (const c of CHIPS) {
      let got = await chip(c, ornn?.gpuRows).catch(() => null)
      if (!got) { await sleep(3000); got = await chip(c, ornn?.gpuRows).catch(e => { failure = e.message; return null }) }
      const kept = got?.months.length ? got : store.last?.chips?.find(x => x.id === c.id)
      if (kept) chips.push(got?.months.length ? got : { ...kept, carried: store.last.asOf })
    }
    if (!chips.some(c => !c.carried)) throw new Error(failure || 'no open Kalshi GPU events')
    const asOf = new Date().toISOString()
    store.days[asOf.slice(0, 10)] = Object.fromEntries(chips.map(c => [c.id, Object.fromEntries(c.months.filter(m => fin(m.implied)).map(m => [m.month, m.implied]))]))
    for (const d of Object.keys(store.days).sort().slice(0, -400)) delete store.days[d]
    const data = {
      asOf, chips, rules: RULES, archivedDays: Object.keys(store.days).length, missing: CHIPS.filter(c => !chips.some(x => x.id === c.id)).map(c => c.label),
      source: { venue: 'Kalshi', settlesOn: 'Ornn rental index, arithmetic mean of hourly values over the calendar month', index: 'https://dashboard.ornnai.com/compute', terms: 'https://assets.kalshi.com/contract_terms/INDEXVALUE.pdf' },
    }
    store.last = data
    try { fs.writeFileSync(FILE, JSON.stringify(store)) } catch (e) { console.warn('kalshi-gpu archive:', e.message) }
    return data
  }

  return {
    async get() {
      if (memo && Date.now() - memo.ts < TTL) return memo.data
      const last = memo?.data || load().last, start = !pending
      pending ||= build().then(data => { memo = { ts: Date.now(), data }; return data })
        .catch(e => { const last = load().last; if (last) return { ...last, stale: true, error: e.message }; throw e })
        .finally(() => { pending = null })
      if (start) pending.catch(() => {})
      // a build takes ~20 s cold; a build from the last day is served at once and replaced when the fresh one lands
      if (last && Date.now() - Date.parse(last.asOf) < 24 * 60 * MIN) return { ...last, refreshing: true }
      return pending
    },
  }
}
