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
// Not read: Polymarket's thinner "GPU rental prices (X) end of <month>" and
// "hit $X in 2026" events (a month-end value and a barrier, not an average;
// a few thousand dollars of liquidity each).
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
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const fin = v => v != null && Number.isFinite(v)
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
  return { chip: label.toLowerCase().replace(/[^a-z0-9]/g, ''), label, month: `${m[3]}-${String(mi + 1).padStart(2, '0')}`, slug: e.slug, markets,
    volume: num(e.volume) ?? 0, volume24h: num(e.volume24hr) ?? 0, liquidity: num(e.liquidity) ?? 0 }
}

// parsed events + the index's daily rows → one entry per chip, months in order
export function buildChips(events, rows) {
  const by = {}
  for (const e of events) {
    const row = monthRow({ event: e.slug, month: e.month }, e.markets)
    delete row.legs; delete row.openInterest
    ;(by[e.chip] ||= { id: e.chip, label: e.label, months: [] }).months.push({ ...row, volume: Math.round(e.volume), volume24h: Math.round(e.volume24h), liquidity: Math.round(e.liquidity), url: `https://polymarket.com/event/${e.slug}` })
  }
  return Object.values(by).map(c => {
    c.months.sort((a, b) => a.month.localeCompare(b.month))
    const r = realised(rows, c.id, c.months[0]), sum = k => c.months.reduce((a, m) => a + m[k], 0)
    return { ...c, url: c.months[0]?.url, index: r.latest, daily: r.daily, monthly: r.monthly, progress: r.progress,
      supported: c.months.filter(m => m.read === 'firm' || m.read === 'quoted').length, volume: sum('volume'), volume24h: sum('volume24h'), liquidity: sum('liquidity') }
  }).sort((a, b) => b.volume - a.volume)
}

export function createPolymarketGpu({ dir, markets, feeds = {}, now = () => Date.now() }) {
  const FILE = path.join(dir, 'polymarket-gpu-archive.json')
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return { days: {}, last: null } } }
  let memo = null, pending = null

  async function build() {
    const raw = []
    for (let off = 0; off < 1000; off += 100) {
      const page = await markets.getJson(`${GAMMA}/events?tag_slug=${TAG}&closed=false&limit=100&offset=${off}`)
      raw.push(...(Array.isArray(page) ? page : []))
      if (!Array.isArray(page) || page.length < 100) break
    }
    const events = raw.map(parseEvent).filter(Boolean)
    if (!events.length) throw new Error('no open Polymarket GPU price events')
    const ornn = await Promise.resolve(feeds.ornn?.()).catch(() => null)
    const chips = buildChips(events, ornn?.gpuRows), asOf = new Date(now()).toISOString(), store = load()
    store.days[asOf.slice(0, 10)] = Object.fromEntries(chips.map(c => [c.id, Object.fromEntries(c.months.filter(m => fin(m.implied)).map(m => [m.month, m.implied]))]))
    for (const d of Object.keys(store.days).sort().slice(0, -400)) delete store.days[d]
    const data = { asOf, venue: 'Polymarket', chips, events: events.length, archivedDays: Object.keys(store.days).length,
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
