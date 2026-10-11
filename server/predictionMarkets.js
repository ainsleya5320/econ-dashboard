// ============================================================================
// PREDICTION MARKETS: a small read-only client for the two public venues the
// Tensions boards price claims from. No keys, no accounts.
//   Kalshi      api.elections.kalshi.com/trade-api/v2 (CFTC-regulated; the
//               "elections" host serves every category). Events group strike
//               markets ("Above 4.00%", "Starts in 2027"); a market's prices
//               are dollars per $1 contract, so a price is a probability.
//   Polymarket  gamma-api.polymarket.com (event by slug; outcomePrices is a
//               JSON string inside the JSON).
// Prices: the bid/ask midpoint when both sides are quoted and the spread is
// 10 cents or less, otherwise the last trade; a market with neither is null.
// Every result carries volume so a check can ignore thin markets.
// Cache: 15 minutes in memory, one in-flight request per URL.
// ============================================================================

const TTL = 15 * 60e3
const KALSHI = 'https://api.elections.kalshi.com/trade-api/v2'
const GAMMA = 'https://gamma-api.polymarket.com'
const num = v => { const n = typeof v === 'string' ? parseFloat(v) : v; return Number.isFinite(n) ? n : null }
// spreads are compared in whole cents: in floating point 0.55 − 0.45 is a hair over 0.10 and 0.30 − 0.20 a hair under
const mid = (bid, ask, last) => (bid != null && ask != null && ask > 0 && Math.round((ask - bid) * 100) <= 10 ? (bid + ask) / 2 : last != null && last > 0 ? last : null)

// Each venue's requests go through a small queue (at most 3 at once), and a 429
// or 5xx is retried with backoff, because a full board build fires a dozen
// calls together and Kalshi rate-limits bursts.
const MAX_CONCURRENT = 3, RETRIES = 3
const sleep = ms => new Promise(r => setTimeout(r, ms))

export function createPredictionMarkets({ UA }) {
  const cache = new Map(), inflight = new Map(), slots = {}
  const withSlot = async (host, fn) => {
    const s = (slots[host] ||= { busy: 0, waiting: [] })
    if (s.busy >= MAX_CONCURRENT) await new Promise(r => s.waiting.push(r))
    s.busy++
    try { return await fn() } finally { s.busy--; s.waiting.shift()?.() }
  }
  const getJson = async url => {
    const hit = cache.get(url)
    if (hit && Date.now() - hit.ts < TTL) return hit.json
    if (inflight.has(url)) return inflight.get(url)
    const host = new URL(url).host
    const p = withSlot(host, async () => {
      for (let attempt = 0; ; attempt++) {
        const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
        if ((r.status === 429 || r.status >= 500) && attempt < RETRIES) { await sleep(800 * 2 ** attempt); continue }
        if (!r.ok) throw new Error(`HTTP ${r.status} from ${host}`)
        const json = await r.json()
        cache.set(url, { ts: Date.now(), json })
        return json
      }
    }).finally(() => inflight.delete(url))
    inflight.set(url, p)
    return p
  }

  const kalshiMarket = m => {
    const bid = num(m.yes_bid_dollars), ask = num(m.yes_ask_dollars), last = num(m.last_price_dollars)
    return {
      ticker: m.ticker, label: m.yes_sub_title || m.subtitle || m.title, strike: num(m.floor_strike), cap: num(m.cap_strike),
      bid, ask, last, p: mid(bid, ask, last),
      volume: num(m.volume_fp) ?? num(m.volume), openInterest: num(m.open_interest_fp) ?? num(m.open_interest),
      closes: m.close_time || null, rules: m.rules_primary || null,
    }
  }

  return {
    // any public GET on either venue through the same queue, retry and cache (ctx.fetchJson uses it)
    getJson,
    // open events in a Kalshi series, soonest first: [{ event, title, subtitle, date }]
    async kalshiEvents(series) {
      const j = await getJson(`${KALSHI}/events?series_ticker=${encodeURIComponent(series)}&status=open&limit=50`)
      return (j.events || []).map(e => ({ event: e.event_ticker, title: e.title, subtitle: e.sub_title || null, date: e.strike_date || null }))
        .sort((a, b) => String(a.date || a.event).localeCompare(String(b.date || b.event)))
    },
    // one Kalshi event's strike markets: { event, url, markets: [...] } sorted by strike
    async kalshi(event) {
      const j = await getJson(`${KALSHI}/markets?event_ticker=${encodeURIComponent(event)}&limit=100`)
      const markets = (j.markets || []).map(kalshiMarket).sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0))
      return { venue: 'Kalshi', event, url: `https://kalshi.com/markets/${event.split('-')[0].toLowerCase()}`, markets }
    },
    // one Polymarket event by slug: { title, url, closed, markets: [{ label, question, yes, bid, ask, volume, outcomes, prices }] }
    async polymarket(slug) {
      const j = await getJson(`${GAMMA}/events?slug=${encodeURIComponent(slug)}`)
      const e = Array.isArray(j) ? j[0] : null
      if (!e) throw new Error(`Polymarket event ${slug} not found`)
      const markets = (e.markets || []).map(m => {
        let prices = []
        try { prices = JSON.parse(m.outcomePrices || '[]').map(num) } catch { /* malformed */ }
        const bid = num(m.bestBid), ask = num(m.bestAsk), last = num(m.lastTradePrice)
        return { label: m.groupItemTitle || m.question, question: m.question, yes: mid(bid, ask, last) ?? prices[0] ?? null, bid, ask, last,
          volume: num(m.volumeNum) ?? num(m.volume), closed: !!m.closed, ends: m.endDate || null,
          // the raw outcome prices too: a resolved market's quotes are gone but these show which side won
          outcomes: (() => { try { return JSON.parse(m.outcomes || '[]') } catch { return [] } })(), prices }
      })
      return { venue: 'Polymarket', slug, title: e.title, url: `https://polymarket.com/event/${slug}`, closed: !!e.closed, ends: e.endDate || null, volume: num(e.volume), markets }
    },
  }
}
