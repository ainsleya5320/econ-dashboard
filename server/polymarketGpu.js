// ============================================================================
// POLYMARKET GPU — AI Economy → Compute → GPU prices: the same question the
// Kalshi panel asks (server/kalshiGpu.js), on Polymarket.
//
// Polymarket lists, under the tag `gpu-prices`, one event per chip and month:
// "H100 average rental price in January 2027?" for the H100, B200 and B300,
// the next four months and then June, September and December, out to
// December 2028. Each is a ladder of "above $X" yes/no markets 10¢ apart on
// the H100, resolved on the arithmetic mean of the finalized daily settled
// values of Ornn's index for the month (Kalshi uses the mean of the hourly
// values of the same index). One request returns every event with its markets.
//
// The ladders are read with the Kalshi module's estimator, unchanged: a band
// per strike from the whole order book, the last trade where the band is too
// wide, pooled so the odds never rise with the strike, and the 50% crossing
// as the market's median. These books are tight (a cent or two wide) and
// deep, so nearly every month reads `firm`, and the middle half of the odds —
// the prices with a 75% and a 25% chance of being exceeded — is reported as
// `band`.
//
// Units differ from Kalshi's: `volume` and `liquidity` here are dollars
// (USDC traded since listing; resting order value), not contracts.
//
// Month-end brackets. For more chips (H200, A100, RTX 5090, RTX 6000, and the
// H100 and B200 again) Polymarket lists "GPU rental prices (X) end of
// <month>?": not a ladder but a set of brackets that cannot both be true
// ("<$4.50", "$4.50-$5.00", … "$6.50+"), on the index's finalized value on
// the LAST DAY of the month — one day's value, not the month's average. These
// are thin, a few thousand dollars resting each. bracketRead: a bracket's
// chance is the midpoint of its bid and offer (its last trade held inside
// them when the book is wider than RULES.wide), the chances are scaled to sum
// to one, and the median is placed inside its bracket in proportion (as if
// the chance were spread evenly across it). When the median falls in an
// open-ended bracket only a floor or a ceiling is reported, with the chance of
// that bracket. Where two events ask about the same day (a "December 2026"
// one and an "end of 2026" one), the one with more money resting is used.
// Each chip carries these as `points`; the panel draws them for the chips
// with no monthly average.
//
// Not read: the "hit $X in 2026" events (a barrier, not a level).
//
// A daily snapshot of every median is kept in polymarket-gpu-archive.json
// (gitignored); the last good read is served from it when Polymarket cannot
// be reached.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { monthRow, realised } from './kalshiGpu.js'

const GAMMA = 'https://gamma-api.polymarket.com'
export const TAG = 'gpu-prices'
export const TAGS = ['gpu-prices', 'ornn']      // the monthly averages; everything settled on the Ornn index
export const RULES = { wide: 0.15, firm: 0.06 }
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const fin = v => v != null && Number.isFinite(v)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
const rnd = (v, d = 2) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const chipId = label => label.toLowerCase().replace(/[^a-z0-9]/g, '')
const num = v => { const n = typeof v === 'string' ? parseFloat(v) : v; return fin(n) ? n : null }

// a Polymarket event → { chip, label, month, slug, markets } in the estimator's shape, or null if it is not a monthly average
export function parseEvent(e) {
  const m = /^\s*([A-Za-z0-9 ]+?)\s+average rental price in ([A-Za-z]+) (\d{4})/i.exec(e?.title || ''), mi = m ? MONTHS.indexOf(m[2].toLowerCase()) : -1
  if (mi < 0 || e.closed) return null
  const markets = (e.markets || []).filter(x => x.active !== false && !x.closed).map(x => {
    const s = /^\s*above \$?([\d.]+)/i.exec(x.groupItemTitle || '') || /above \$?([\d.]+)/i.exec(x.question || '')
    // an empty side of the book comes back as 0 (no bid) or 1 (no offer), or not at all
    return s ? { ticker: x.slug || x.id, strike: Number(s[1]), bid: num(x.bestBid) ?? 0, ask: num(x.bestAsk) ?? 1, last: num(x.lastTradePrice), volume: num(x.volumeNum) ?? num(x.volume) ?? 0, volume24h: num(x.volume24hr) ?? 0, openInterest: null, liquidity: num(x.liquidityNum) ?? 0 } : null
  }).filter(x => x && fin(x.strike))
  if (markets.length < 2) return null
  const label = m[1].trim().toUpperCase()
  return { chip: chipId(label), label, month: `${m[3]}-${String(mi + 1).padStart(2, '0')}`, slug: e.slug, markets,
    volume: num(e.volume) ?? 0, volume24h: num(e.volume24hr) ?? 0, liquidity: num(e.liquidity) ?? 0 }
}

// a month-end bracket event → { chip, label, date, buckets } or null
export function parsePointEvent(e) {
  const t = /^\s*GPU rental prices \(([^)]+)\) end of /i.exec(e?.title || '')
  if (!t || e.closed) return null
  let date = null
  const buckets = (e.markets || []).filter(x => x.active !== false && !x.closed).map(x => {
    const g = String(x.groupItemTitle || '').replace(/[$,\s]/g, ''), on = / on ([A-Za-z]+) (\d{1,2}), (\d{4})/.exec(x.question || '')
    if (on && !date) { const mi = MONTHS.indexOf(on[1].toLowerCase()); if (mi >= 0) date = `${on[3]}-${String(mi + 1).padStart(2, '0')}-${on[2].padStart(2, '0')}` }
    const below = /^<([\d.]+)$/.exec(g), above = /^([\d.]+)\+$/.exec(g), range = /^([\d.]+)[-–]([\d.]+)$/.exec(g)
    const lo = above ? Number(above[1]) : range ? Number(range[1]) : null, hi = below ? Number(below[1]) : range ? Number(range[2]) : null
    if (lo == null && hi == null) return null
    return { lo, hi, bid: num(x.bestBid) ?? 0, ask: num(x.bestAsk) ?? 1, last: num(x.lastTradePrice), volume: num(x.volumeNum) ?? 0 }
  }).filter(Boolean).sort((a, b) => (a.lo ?? -Infinity) - (b.lo ?? -Infinity))
  if (!date || buckets.length < 3) return null
  const label = t[1].trim().toUpperCase()
  return { chip: chipId(label), label, date, slug: e.slug, buckets, volume: num(e.volume) ?? 0, volume24h: num(e.volume24hr) ?? 0, liquidity: num(e.liquidity) ?? 0 }
}

// brackets that cannot both be true → the median of the value, the middle half of the odds, and how it was read
export function bracketRead(buckets, R = RULES) {
  const raw = buckets.map(b => { const spread = b.ask - b.bid; return { ...b, spread, raw: spread <= R.wide ? (b.bid + b.ask) / 2 : fin(b.last) && b.volume > 0 ? clamp(b.last, b.bid, b.ask) : (b.bid + Math.min(b.ask, b.bid + R.wide)) / 2 } })
  const sum = raw.reduce((a, b) => a + b.raw, 0), out = { implied: null, band: null, floor: null, ceiling: null, odds: null, read: null, sum: rnd(sum, 3), buckets: [] }
  if (!(sum > 0)) return out
  const bs = raw.map(b => ({ lo: b.lo, hi: b.hi, p: b.raw / sum, spread: b.spread }))
  out.buckets = bs.map(b => ({ lo: b.lo, hi: b.hi, p: rnd(b.p, 3) }))
  // the value below which a share q of the odds lies; an open-ended bracket gives no value, only itself
  const at = q => { let run = 0; for (const b of bs) { if (run + b.p >= q) return b.lo == null || b.hi == null ? { open: b } : { v: b.lo + (b.hi - b.lo) * ((q - run) / b.p) }; run += b.p } return null }
  const med = at(0.5), q1 = at(0.25), q3 = at(0.75)
  if (med?.open) { if (med.open.hi == null) out.floor = med.open.lo; else out.ceiling = med.open.hi; out.odds = rnd(med.open.p, 3) } else if (med) out.implied = med.v
  if (fin(q1?.v) && fin(q3?.v)) out.band = [q1.v, q3.v]
  const main = bs.filter(b => b.p >= 0.1)
  out.read = main.length && Math.max(...main.map(b => b.spread)) <= R.firm ? 'firm' : 'quoted'
  return out
}

// parsed events + the index's daily rows (+ month-end bracket events) → one entry per chip, months in order
export function buildChips(events, rows, pointEvents = []) {
  const by = {}
  // one bracket event per chip and day: the one with the most money resting
  const best = new Map()
  for (const e of pointEvents) { const k = `${e.chip}|${e.date}`; if (!best.has(k) || e.liquidity > best.get(k).liquidity) best.set(k, e) }
  for (const e of best.values()) {
    const r = bracketRead(e.buckets)
    ;(by[e.chip] ||= { id: e.chip, label: e.label, months: [], points: [] }).points.push({ date: e.date, month: e.date.slice(0, 7), implied: rnd(r.implied, 2), band: r.band && r.band.map(v => rnd(v, 2)), floor: r.floor, ceiling: r.ceiling, odds: r.odds, read: r.read, sum: r.sum,
      buckets: r.buckets, volume: Math.round(e.volume), volume24h: Math.round(e.volume24h), liquidity: Math.round(e.liquidity), url: `https://polymarket.com/event/${e.slug}` })
  }
  for (const e of events) {
    const row = monthRow({ event: e.slug, month: e.month }, e.markets)
    delete row.legs; delete row.openInterest
    ;(by[e.chip] ||= { id: e.chip, label: e.label, months: [], points: [] }).months.push({ ...row, volume: Math.round(e.volume), volume24h: Math.round(e.volume24h), liquidity: Math.round(e.liquidity), url: `https://polymarket.com/event/${e.slug}` })
  }
  return Object.values(by).map(c => {
    c.months.sort((a, b) => a.month.localeCompare(b.month))
    c.points.sort((a, b) => a.date.localeCompare(b.date))
    // a chip is totalled on its monthly averages; a chip with brackets only, on those
    const of = c.months.length ? c.months : c.points
    const r = realised(rows, c.id, c.months[0]), sum = k => of.reduce((a, m) => a + m[k], 0)
    return { ...c, url: of[0]?.url, index: r.latest, daily: r.daily, monthly: r.monthly, progress: r.progress,
      supported: c.months.filter(m => m.read === 'firm' || m.read === 'quoted').length, volume: sum('volume'), volume24h: sum('volume24h'), liquidity: sum('liquidity') }
  }).sort((a, b) => b.volume - a.volume)
}

export function createPolymarketGpu({ dir, markets, feeds = {}, now = () => Date.now() }) {
  const FILE = path.join(dir, 'polymarket-gpu-archive.json')
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return { days: {}, last: null } } }
  let memo = null, pending = null

  async function build() {
    const seen = new Map()
    for (const tag of TAGS) for (let off = 0; off < 1000; off += 100) {
      const page = await markets.getJson(`${GAMMA}/events?tag_slug=${tag}&closed=false&limit=100&offset=${off}`).catch(e => { if (tag === TAG) throw e; return [] })
      for (const e of Array.isArray(page) ? page : []) seen.set(e.slug, e)
      if (!Array.isArray(page) || page.length < 100) break
    }
    const raw = [...seen.values()], events = raw.map(parseEvent).filter(Boolean), pointEvents = raw.map(parsePointEvent).filter(Boolean)
    if (!events.length) throw new Error('no open Polymarket GPU price events')
    const ornn = await Promise.resolve(feeds.ornn?.()).catch(() => null)
    const chips = buildChips(events, ornn?.gpuRows, pointEvents), asOf = new Date(now()).toISOString(), store = load()
    store.days[asOf.slice(0, 10)] = Object.fromEntries(chips.map(c => [c.id, Object.fromEntries(c.months.filter(m => fin(m.implied)).map(m => [m.month, m.implied]))]))
    for (const d of Object.keys(store.days).sort().slice(0, -400)) delete store.days[d]
    const data = { asOf, venue: 'Polymarket', chips, events: events.length, pointEvents: pointEvents.length, archivedDays: Object.keys(store.days).length,
      source: { venue: 'Polymarket', url: `https://polymarket.com/predictions/${TAG}`, settlesOn: 'Ornn index, arithmetic mean of the finalized daily settled values in the calendar month', index: 'https://data.ornn.com' } }
    store.last = data
    try { fs.writeFileSync(FILE, JSON.stringify(store)) } catch (e) { console.warn('polymarket-gpu archive:', e.message) }
    return data
  }

  return {
    async get() {
      if (memo && now() - memo.ts < 15 * 60e3) return memo.data
      pending ||= build().then(data => { memo = { ts: now(), data }; return data })
        .catch(e => { const last = load().last; if (last) return { ...last, stale: true, error: String(e?.message || e).slice(0, 160) }; throw e })
        .finally(() => { pending = null })
      return pending
    },
  }
}
