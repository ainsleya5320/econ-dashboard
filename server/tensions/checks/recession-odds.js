// ============================================================================
// RECESSION ODDS: how likely is a recession, and do the ways of pricing one
// agree? Each source answers a slightly different question:
//   Kalshi (KXRECSSNBER)   pays on two straight quarters of negative real GDP
//                          growth according to BEA, inside a window set by the
//                          contract's rules (despite "NBER" in the ticker, no
//                          NBER call is involved). Which estimate counts is
//                          read from each contract's own rules: KXRECSSNBER-27
//                          names the advance (first) estimate of each quarter,
//                          KXRECSSNBER-26 does not say.
//   Polymarket             the newest quarter at its advance estimate with the
//                          quarter before at its latest revised estimate, or
//                          an NBER announcement made by the window's last
//                          advance GDP release ("US recession by end of YYYY",
//                          found by search with the known slugs as a backstop;
//                          each year includes the one before it).
//   NY Fed yield curve     Estrella-Mishkin probit on the 10-year minus
//                          3-month spread (monthly average, bill on a bond-
//                          equivalent basis): the chance the economy is in an
//                          NBER recession twelve months later.
// Normalization: everything is put on one window, a recession whose first
// quarter of decline falls in the next four calendar quarters (one starting in
// the next 12 months). A contract's window is read from its rules text; one
// covering n quarters is rescaled at a constant rate, 1 − (1 − p)^(4/n). The
// curve's "in recession in month M+12" (P) becomes a 12-month start
// probability at a constant monthly start rate λ: being in recession in a month
// means one began within the D months before it (D = the mean length of
// recessions since 1959, FRED USREC), so 1 − e^(−Dλ) = P and the 12-month
// figure is 1 − e^(−12λ) = 1 − (1 − P)^(12/D). Only the latest month's spread
// is counted: each NY Fed reading is a 12-month-ahead forecast from the spread
// of its day, the latest supersedes the older ones, and its reading already
// covers starts from about the window's second month on. The NY Fed's older
// readings for the months inside the window are shown, converted the same
// way, but not counted. Contracts whose window holds no future quarter (this
// year's, once the year's last quarter has begun) are read against the
// Atlanta Fed GDPNow nowcast instead.
// Term premium (Kim-Wright, FRED THREEFYTP10): the model reads all steepness
// as expected growth, so its reading is recomputed with the term premium held
// at two yardsticks, its level six months ago and its 1990-2009 average (the
// part of the model's 1959-2009 sample the estimate covers; on the ACM
// estimate term premia ran higher in the 1970s and 1980s, so that average is
// if anything low). The two can point opposite ways, so the label is chosen
// from both and neither is counted.
// Credit spreads (Baa, ranked since 1986), the real-time Sahm rule and the
// Fed's unemployment projection are shown beside them but not counted: none
// of them is a probability.
// Volume floor: $50,000 traded. Polymarket reports dollars; Kalshi reports $1
// contracts, put on dollars at today's price (contracts × price). That
// understates a contract that once traded higher, so it errs toward leaving a
// market out.
// Gap = highest minus lowest comparable 12-month probability, in percentage
// points. Under 10 pp the sources agree within their own slack: first-print
// GDP declines and NBER recessions differ (two declines in 2022's first prints
// with no recession; no two in a row in 2001's recession), bid-ask spreads run
// 1 to 3 cents and the horizon conversion is approximate, each worth a few
// points, so the slack is counted in points rather than as a ratio. From 10 pp
// one source sees more risk than definitions explain; from 20 pp, with the
// lower source at the 10-30% where recession odds usually sit, one prices 1.7
// to 3 times the other's risk for the same twelve months, and both cannot be
// right. The gap note prints today's ratio.
// Inputs: Kalshi, Polymarket, the NY Fed's yield.csv, FRED.
// ============================================================================
import { fin, pct, pp, times, normCdf, last, lastV, mon, grade } from '../lib.js'

const KALSHI_SERIES = 'KXRECSSNBER'
const KALSHI_API = 'https://api.elections.kalshi.com/trade-api/v2'
const POLY_SEARCH = 'https://gamma-api.polymarket.com/public-search?q=US%20recession%20by%20end%20of&limit_per_type=10&events_status=active'
const POLY_TITLE = /^US recession by end of (\d{4})\??$/i
// also tried for any year the search does not return
const POLY_FALLBACK = ['us-recession-by-end-of-2026', 'us-recession-by-end-of-2027-20260807185409760']
const NYFED_CSV = 'https://www.newyorkfed.org/medialibrary/media/research/capital_markets/yield/assets/data/yield.csv'
// NY Fed probit, P(NBER recession twelve months ahead) = Φ(α + β × spread), estimated on
// Jan 1959–Dec 2009; α and β as printed on newyorkfed.org/research/capital_markets/ycfaq (read Oct 2026)
const ALPHA = -0.5333, BETA = -0.6330
// Atlanta Fed GDPNow: root-mean-square error of the final nowcast against BEA's first print,
// 2011 Q3–2025 Q2 (atlantafed.org/research-and-data/data/gdpnow, read Oct 2026). Earlier
// nowcasts miss by more, so 1.5× is shown as well.
const GDPNOW_RMSE = 1.17
// the term-premium yardstick: the years of the model's 1959-2009 sample the Kim-Wright estimate covers
const TP_ERA = ['1990-01-01', '2009-12-01']
// NBER took 4 to 12 months to date the start of each recession since 1980 (peaks of Jan 1980, Jul 1981,
// Jul 1990, Mar 2001, Dec 2007 and Feb 2020, announced Jun 1980, Jan 1982, Apr 1991, Nov 2001, Dec 2008 and
// Jun 2020; nber.org/research/business-cycle-dating), so what followed a month counts as known once its
// window ended a year before FRED's latest USREC month (USREC fills recent months with 0 until NBER rules)
const NBER_LAG = 12
const FLOOR = 50000 // dollars traded
const TENSION = 10, CONTRADICTION = 20

// ── small helpers ──
const ord = n => (fin(n) ? `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th')}` : '—')
const p1 = v => (fin(v) ? `${(v * 100).toFixed(1)}%` : '—')
const signed = (v, dp = 1) => (fin(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)}%` : '—')
const vol = v => (fin(v) ? (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : String(Math.round(v))) : '—')
const traded = c => (c.venue === 'Kalshi' ? `${vol(c.volume)} contracts traded, about $${vol(c.dollars)} at today's price` : `$${vol(c.dollars)} traded`)
const num = (v, dp) => v.toFixed(dp).replace('-', '−')
const abs2 = v => `${Math.abs(v).toFixed(2)} pp`
const avg = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null)
const median = a => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : null)
const pctile = (s, v) => (s?.length && fin(v) ? Math.round((s.filter(x => x.v <= v).length / s.length) * 100) : null)
const mOf = d => +d.slice(0, 4) * 12 + (+d.slice(5, 7) - 1)
const mLab = i => mon(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`)
const qOf = d => +d.slice(0, 4) * 4 + Math.floor((+d.slice(5, 7) - 1) / 3)
const qLab = i => `Q${(i % 4) + 1} ${Math.floor(i / 4)}`
const list = a => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`)
// 3-month bill discount rate (%) → bond-equivalent yield (%), as the NY Fed converts it
const bey = d => (365 * d) / (360 - 0.91 * d)
const curveP = s => normCdf(ALPHA + BETA * s)
const annualize = (p, n) => (n === 4 ? p : 1 - Math.pow(1 - p, 4 / n))
const monthly = s => {
  const m = new Map()
  for (const x of s || []) { const k = mOf(x.d); const a = m.get(k) || [0, 0]; a[0] += x.v; a[1]++; m.set(k, a) }
  return new Map([...m].sort((a, b) => a[0] - b[0]).map(([k, [sum, n]]) => [k, sum / n]))
}

// the window of quarters a contract's rules cover: "Q4 2026 through Q4 2027",
// "between Q2 2025 and Q4 2026", or "in 2025 or 2026"
function windowOf(text, year) {
  const t = text || ''
  const m = t.match(/Q([1-4])\s*(\d{4})\s*(?:through|to|and|-|–)\s*Q([1-4])\s*(\d{4})/i)
  if (m) return { from: +m[2] * 4 + +m[1] - 1, to: +m[4] * 4 + +m[3] - 1 }
  const ys = (t.match(/\bin ((?:\d{4})(?:(?:,\s*|\s+or\s+|\s+and\s+)\d{4})*)/i)?.[1].match(/\d{4}/g) || []).map(Number)
  if (ys.length) return { from: Math.min(...ys) * 4, to: Math.max(...ys) * 4 + 3 }
  return fin(year) ? { from: year * 4, to: year * 4 + 3 } : null
}

// Kalshi: every open event in the series. The shared client keeps only rules_primary, which sets
// the window; which GDP estimate counts is in rules_secondary, read from the raw market.
async function kalshiContracts(ctx) {
  const evs = await ctx.markets.kalshiEvents(KALSHI_SERIES)
  const dropped = []
  const out = await Promise.all(evs.map(async e => {
    try {
      const [k, raw] = await Promise.all([
        ctx.markets.kalshi(e.event),
        ctx.fetchJson(`${KALSHI_API}/markets?event_ticker=${encodeURIComponent(e.event)}&limit=100`).catch(() => null),
      ])
      const m = k.markets[0] // one yes/no market per event
      if (!m || !fin(m.p)) { dropped.push(`Kalshi ${e.event}: no quote or trade, dropped`); return null }
      const yy = e.event.match(/-(\d{2})$/)?.[1]
      const year = yy ? 2000 + +yy : null
      const window = windowOf(m.rules, year)
      if (!window) { dropped.push(`Kalshi ${e.event}: rules not readable, dropped`); return null }
      const r = raw?.markets?.find(x => x.ticker === m.ticker)
      const vintage = !r ? null : /reported in the Advance Estimate/i.test(`${r.rules_primary || ''} ${r.rules_secondary || ''}`) ? 'advance' : 'unspecified'
      return { venue: 'Kalshi', id: e.event, year, p: m.p, bid: m.bid, ask: m.ask, volume: m.volume, dollars: fin(m.volume) ? m.volume * m.p : null,
        url: k.url, rules: m.rules, vintage, window, nber: /NBER|National Bureau/i.test(m.rules || '') }
    } catch { dropped.push(`Kalshi ${e.event}: market data unavailable, dropped`); return null }
  }))
  return { list: out.filter(Boolean), dropped }
}

// Polymarket: the events the search finds, plus the known slugs for any year it misses. A year
// whose event has closed or vanished is dropped with a note while that year is still live.
async function polyContracts(ctx, Y) {
  let found = []
  try {
    const j = await ctx.fetchJson(POLY_SEARCH)
    found = (j.events || []).filter(e => !e.closed && POLY_TITLE.test(e.title || '')).map(e => ({ slug: e.slug, rules: e.description, year: +e.title.match(POLY_TITLE)[1] }))
  } catch { /* search unavailable: the known slugs below still run */ }
  for (const slug of POLY_FALLBACK) { const year = +slug.match(/\d{4}/)[0]; if (!found.some(f => f.year === year)) found.push({ slug, year }) }
  const missed = []
  const out = await Promise.all(found.map(async f => {
    const gone = why => { if (f.year >= Y) missed.push({ year: f.year, text: `Polymarket by end of ${f.year}: ${why}, dropped` }); return null }
    try {
      const e = await ctx.markets.polymarket(f.slug)
      const m = e.markets.find(x => !x.closed)
      if (e.closed || !m) return gone('event closed')
      if (!fin(m.yes)) return gone('no quote or trade')
      let rules = f.rules
      if (!rules) rules = (await ctx.fetchJson(`https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(f.slug)}`))?.[0]?.description
      const year = f.year || +(e.title.match(/(\d{4})/)?.[1] ?? NaN)
      const window = windowOf(rules, year)
      if (!window || !fin(year)) return gone('rules not readable')
      return { venue: 'Polymarket', id: f.slug, year, p: m.yes, bid: m.bid, ask: m.ask, volume: m.volume, dollars: m.volume, url: e.url, rules, window, nber: /NBER|National Bureau/i.test(rules || '') }
    } catch { return gone('event not found or unavailable') }
  }))
  // one contract per year, the most traded
  const byYear = new Map()
  for (const c of out) if (c && (!byYear.has(c.year) || (c.volume || 0) > (byYear.get(c.year).volume || 0))) byYear.set(c.year, c)
  const dropped = [...new Map(missed.filter(x => !byYear.has(x.year)).map(x => [x.year, x.text])).values()]
  return { list: [...byYear.values()].sort((a, b) => a.year - b.year), dropped }
}

// the NY Fed's own published file: the latest month with a spread, the probability it gives a year
// later, and every published probability by target month
async function nyfedPublished() {
  const r = await fetch(NYFED_CSV, { headers: { 'User-Agent': 'Mozilla/5.0 (econ-dashboard tensions)' }, signal: AbortSignal.timeout(15000) })
  if (!r.ok) throw new Error(`NY Fed HTTP ${r.status}`)
  const MON = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 }
  const month = s => {
    let m = s.match(/^\d{1,2}-([A-Za-z]{3})-(\d{2})$/)
    if (m) return (+m[2] >= 50 ? 1900 + +m[2] : 2000 + +m[2]) * 12 + MON[m[1]]
    m = s.match(/^(\d{1,2})\/\d{1,2}\/(\d{4})$/)
    return m ? +m[2] * 12 + +m[1] - 1 : null
  }
  const rows = (await r.text()).trim().split(/\r?\n/).slice(1).map(l => l.split(',')).map(c => ({ m: month(c[0]), spread: parseFloat(c[4]), prob: parseFloat(c[5]) / 100 })).filter(x => fin(x.m))
  const latest = rows.filter(x => fin(x.spread)).pop()
  const target = latest && rows.find(x => x.m === latest.m + 12)
  if (!latest || !fin(target?.prob)) throw new Error('NY Fed file has no current reading')
  return { m: latest.m, spread: latest.spread, prob: target.prob, rows }
}

export default {
  id: 'recession-odds',
  domain: 'economy',
  order: 2,
  title: 'How likely is a recession?',
  question: 'Do prediction markets and the yield curve price the same chance of a recession in the next year, and do credit spreads and the jobs data back them up?',
  see: 'Charts: U.S. Economy → Pulse (leading indicators), Labor (Sahm rule), Growth → Activity (GDP), Rates & Fed → Treasuries & mortgages (10-year minus 3-month spread), Credit → Corporate (Baa spread).',
  async compute(ctx) {
    const today = ctx.today, Y = +today.slice(0, 4)
    const settled = await Promise.allSettled([
      kalshiContracts(ctx), polyContracts(ctx, Y), nyfedPublished(),
      ctx.fred('GS10', 84), ctx.fred('TB3MS', 84), ctx.fred('DGS10', 30), ctx.fred('DTB3', 30), ctx.fred('USREC', 1000),
      ctx.fred('BAA10Y', 11000), ctx.fred('THREEFYTP10', 10000), ctx.fred('SAHMREALTIME', 3), ctx.fred('UNRATE', 16),
      ctx.fred('UNRATEMD', 4), ctx.fred('UNRATERH', 4), ctx.fred('GDPC1MD', 4), ctx.fred('A191RL1Q225SBEA', 8), ctx.fred('GDPNOW', 4), ctx.fred('UNRATEMDLR', 2),
    ])
    const val = i => (settled[i].status === 'fulfilled' ? settled[i].value : null)
    const kalR = val(0), polyR = val(1), pub = val(2)
    const kal = kalR?.list || [], poly = polyR?.list || []
    const [gs10, tb3, dgs10, dtb3, usrec, baa, tp, sahm, unrate, uMd, uRh, gMd, gdp, nowc, uLr] = Array.from({ length: 15 }, (_, i) => val(i + 3) || [])
    // what could not be priced today: said on the board, never dropped silently
    const missing = [
      !kalR && 'Kalshi: event list unavailable',
      kalR && !kal.length && !kalR.dropped.length && 'Kalshi: no open recession contract listed',
      ...(kalR?.dropped || []),
      !poly.length && !polyR?.dropped?.length && 'Polymarket: no open "US recession by end of" event found',
      ...(polyR?.dropped || []),
      !pub && "NY Fed's published file unavailable (the model is computed from FRED's yields)",
    ].filter(Boolean)

    const q0 = qOf(today), qEnd = q0 + 3
    const span = `${qLab(q0)} to ${qLab(qEnd)}`
    for (const c of [...kal, ...poly]) c.liquid = (c.dollars || 0) >= FLOOR

    // a recession "starts" in the first of its two negative quarters, so a contract
    // paying on a pair inside [from, to] covers starts in [from, to − 1]. Starts BEA
    // has already ruled out are dead: the live ones begin after the last reported
    // quarter, or at it if it was negative. overlap counts live starts from this
    // quarter on, inside the common window.
    const lastQ = gdp.length ? qOf(last(gdp).d) : null, lastG = lastV(gdp)
    const liveFrom = fin(lastQ) ? (lastG < 0 ? lastQ : lastQ + 1) : q0
    const starts = (c, from = c.window.from) => {
      const a = Math.max(from, liveFrom), b = c.window.to - 1
      return { a, b, n: Math.max(0, b - a + 1), overlap: Math.max(0, Math.min(b, qEnd) - Math.max(a, q0) + 1) }
    }

    // ── Kalshi: the contract whose forward window best matches the next four quarters ──
    const kPick = kal.map(c => ({ c, s: starts(c) })).filter(x => x.s.overlap >= 2).sort((x, y) => y.s.overlap - x.s.overlap || x.s.n - y.s.n)[0]
    const k12 = kPick ? { name: 'Kalshi', c: kPick.c, s: kPick.s, p: annualize(kPick.c.p, kPick.s.n), liquid: kPick.c.liquid } : null
    if (kal.length && !k12 && !kalR.dropped.length) missing.push('Kalshi: no open contract covers at least two quarters of the next 12 months')

    // ── Polymarket: by-end-of-Y contains by-end-of-(Y−1), so Y alone is the difference ──
    let p12 = null
    for (const c of poly) {
      const prior = poly.find(x => x.year === c.year - 1 && x.window.from === c.window.from && x.window.to < c.window.to)
      const s = starts(c, prior ? prior.window.to : c.window.from)
      if (s.overlap < 2 || (p12 && p12.s.overlap >= s.overlap)) continue
      const raw = prior ? c.p - prior.p : c.p
      p12 = { name: 'Polymarket', c, prior, s, raw, p: annualize(Math.max(0, raw), s.n), liquid: c.liquid && (!prior || prior.liquid) }
    }
    if (poly.length && !p12 && !polyR.dropped.length) missing.push('Polymarket: no open contract covers at least two quarters of the next 12 months')

    // ── NY Fed yield-curve model on the latest full month (GS10 less TB3MS on a bond-equivalent basis) ──
    const tbBy = new Map(tb3.map(x => [mOf(x.d), x.v]))
    const rows = gs10.filter(x => tbBy.has(mOf(x.d))).map(x => ({ m: mOf(x.d), y10: x.v, b3: tbBy.get(mOf(x.d)), s: x.v - bey(tbBy.get(mOf(x.d))) }))
    const cur = last(rows)
    const pT = cur ? curveP(cur.s) : null
    // recession lengths since 1959, the start of the model's sample (USREC runs of 1s, peak to trough)
    const runs = []
    let run = null
    for (const x of usrec) {
      if (x.v === 1) run = run ? { ...run, end: x.d, n: run.n + 1 } : { start: x.d, end: x.d, n: 1 }
      else if (run) { runs.push(run); run = null }
    }
    const since59 = runs.filter(r => r.start >= '1959-01-01')
    const D = since59.length ? since59.reduce((a, r) => a + r.n, 0) / since59.length : null
    // in recession in a month ⇔ a start within the D months before it, at a constant start rate λ
    const to12 = p => (fin(p) && fin(D) ? 1 - Math.pow(1 - p, 12 / D) : null)
    const lam = fin(pT) && fin(D) ? -Math.log(1 - pT) / D : null
    const c12 = to12(pT)
    const curve = fin(c12) ? { name: 'the yield curve (NY Fed model)', p: c12, liquid: true } : null
    const mine = pub ? rows.find(r => r.m === pub.m) : null
    // month to date, same basis, from the daily series
    const mNow = mOf(today)
    const d10 = dgs10.filter(x => mOf(x.d) === mNow), d3 = dtb3.filter(x => mOf(x.d) === mNow)
    const mtd = cur && mNow > cur.m && d10.length >= 3 && d3.length >= 3 ? d10.reduce((a, x) => a + x.v, 0) / d10.length - bey(d3.reduce((a, x) => a + x.v, 0) / d3.length) : null

    // the NY Fed's older readings for the months of the common window, each made from the spread a
    // year before it; months past the latest reading carry the latest. Shown, not counted.
    let path = null
    if (cur && fin(D) && pub) {
      const pubBy = new Map(pub.rows.filter(r => fin(r.prob)).map(r => [r.m, r.prob]))
      const ms = []
      for (let m = q0 * 3; m <= qEnd * 3 + 2; m++) ms.push({ m, p: m < cur.m + 12 ? (pubBy.get(m) ?? null) : pT, old: m < cur.m + 12 })
      const old = ms.filter(x => x.old)
      if (ms.every(x => fin(x.p)) && old.length >= 3) {
        path = { old, avg: avg(ms.map(x => x.p)), lo: Math.min(...old.map(x => x.p)), hi: Math.max(...old.map(x => x.p)),
          p: 1 - ms.reduce((a, x) => a * Math.pow(1 - x.p, 1 / D), 1), carried: ms.length - old.length }
      }
    }

    // ── term premium: the model's reading with it held at two yardsticks ──
    const tpM = monthly(tp)
    const tpNow = cur ? tpM.get(cur.m) ?? null : null
    const era = [...tpM].filter(([m]) => m >= mOf(TP_ERA[0]) && m <= mOf(TP_ERA[1]))
    const tpEra = era.length >= 120 ? avg(era.map(([, v]) => v)) : null
    const eraLab = era.length ? `${Math.floor(era[0][0] / 12)}-${TP_ERA[1].slice(0, 4)}` : null
    const six = cur ? rows.find(r => r.m === cur.m - 6) : null
    const dS = six ? cur.s - six.s : null
    const tpSix = six ? tpM.get(six.m) ?? null : null
    const tpScen = fin(tpNow) && fin(D) ? [
      fin(tpSix) && { key: 'six', base: tpSix, what: `its ${mLab(six.m)} level` },
      fin(tpEra) && { key: 'era', base: tpEra, what: `its ${eraLab} average` },
    ].filter(Boolean).map(x => { const s = cur.s - (tpNow - x.base); const p = curveP(s); return { ...x, s, p, c: to12(p) } }) : []
    const scen = k => tpScen.find(x => x.key === k)

    // the model's last big call: its highest reading in the past six years whose month has passed
    const lastRec = last(usrec)
    const recBy = new Map(usrec.map(x => [mOf(x.d), x.v]))
    const called = lastRec ? rows.filter(r => r.m + 12 <= mOf(lastRec.d) && r.m >= mNow - 72).map(r => ({ ...r, p: curveP(r.s) })) : []
    const peak = called.sort((a, b) => b.p - a.p)[0]
    const peakMissed = peak && peak.p >= 0.4 && called.every(r => recBy.get(r.m + 12) === 0)

    // ── credit: the Baa spread's rank, and what followed when it was this tight ──
    const baaNow = lastV(baa), baaPct = pctile(baa, baaNow), baaFrom = baa[0]?.d?.slice(0, 4)
    const baaMed = baa.length ? median(baa.map(x => x.v)) : null
    const baaM = monthly(baa)
    const recStarts = runs.map(r => mOf(r.start))
    const lastRecM = lastRec ? mOf(lastRec.d) : null
    // months not in recession whose W-month window NBER has had time to date
    const known = W => [...baaM.keys()].filter(m => recBy.get(m) === 0 && fin(lastRecM) && m + W + NBER_LAG <= lastRecM)
    const within = W => m => recStarts.some(s => s > m && s <= m + W)
    const startYears = ms => list([...new Set(ms.map(m => Math.floor(recStarts.find(s => s > m) / 12)))].map(String))
    // the band: the spread's median move over three months since 1986, so "near today's level" means one typical quarter away
    const baaArr = [...baaM.values()]
    const band = baaArr.length > 12 ? Math.round(median(baaArr.slice(3).map((v, i) => Math.abs(v - baaArr[i]))) * 100) / 100 : null
    const u12 = known(12), u18 = known(18)
    const allRate = u12.length ? u12.filter(within(12)).length / u12.length : null
    const allRate18 = u18.length ? u18.filter(within(18)).length / u18.length : null
    const tight = fin(baaNow) ? u12.filter(m => baaM.get(m) <= baaNow) : [], tightHits = tight.filter(within(12))
    const near = fin(baaNow) && fin(band) ? u12.filter(m => baaM.get(m) <= baaNow + band) : [], nearHits = near.filter(within(12))
    const tight18 = fin(baaNow) ? u18.filter(m => baaM.get(m) <= baaNow) : [], tight18Hits = tight18.filter(within(18))
    const tightEpisodes = tight.reduce((a, m, i) => a + (i === 0 || m - tight[i - 1] > 6 ? 1 : 0), 0)
    const nearRate = near.length ? nearHits.length / near.length : null
    // tight credit tells against a recession only when such months led one far less often than months in general
    const creditInformative = near.length >= 12 && fin(allRate) && nearRate < 0.5 * allRate
    const recPeaks = runs.filter(r => baaM.has(mOf(r.start))).map(r => Math.max(...[...baaM].filter(([m]) => m >= mOf(r.start) - 1 && m <= mOf(r.end) + 6).map(([, v]) => v)))
    const minPeak = recPeaks.length ? Math.min(...recPeaks) : null

    // ── labor and the Fed ──
    const sahmNow = lastV(sahm), uNow = lastV(unrate)
    const avg3 = unrate.map((x, i) => (i >= 2 ? (x.v + unrate[i - 1].v + unrate[i - 2].v) / 3 : null))
    const lows = avg3.slice(-12).filter(fin)
    const sahmTrigger = lows.length ? Math.min(...lows) + 0.5 : null
    const at = (s, y) => s.find(x => x.d.startsWith(`${y}-`))?.v ?? null
    const u1 = at(uMd, Y), u2 = at(uMd, Y + 1), uHi = at(uRh, Y + 1), g1 = at(gMd, Y), g2 = at(gMd, Y + 1)
    // the longer-run median is dated on the day each Summary of Economic Projections is published
    const sepDate = last(uLr)?.d || null

    // ── near term: contracts with no future quarter left, read against the nowcast ──
    const nq = nowc.length ? qOf(last(nowc).d) : null, nv = lastV(nowc)
    const nowcastOk = fin(nq) && fin(lastQ) && nq === lastQ + 1
    // near term: every start the contract can still pay on lies before this quarter
    const isNear = c => { const s = starts(c); return s.overlap === 0 && s.b < q0 }
    const nearC = [...kal, ...poly].filter(c => isNear(c) && fin(lastQ) && c.window.to > lastQ)
    // what they still need: one more negative quarter after a negative one, else two in a row; null once no pair fits
    const needOf = c => (lastG < 0 && lastQ >= c.window.from ? [lastQ + 1] : lastQ + 2 <= c.window.to ? [lastQ + 1, lastQ + 2] : null)
    const need = nearC.length ? needOf(nearC[0]) : null
    const nearNowcast = nearC.length > 0 && nowcastOk && need?.[0] === nq
    const nearYear = nearC[0]?.year, nearNames = nearC.map(c => `${c.venue}'s`).join(' and ')
    const settleQ = nearC.length ? Math.max(...nearC.map(c => c.window.to)) : null
    const pNegLo = nowcastOk ? normCdf(-nv / GDPNOW_RMSE) : null, pNegHi = nowcastOk ? normCdf(-nv / (1.5 * GDPNOW_RMSE)) : null
    const nearMax = nearC.length ? Math.max(...nearC.map(c => c.p)) : null
    const nearPrices = nearC.map(c => p1(c.p)).join(' and ')
    const longShot = nearNowcast && nv > 0 && nearMax > pNegHi
    const quiet = fin(lastG) && lastG > 0 && nowcastOk && nv > 0 && fin(sahmNow) && sahmNow < 0.5

    // ── grade ──
    const comparables = [k12, p12, curve].filter(x => x && fin(x.p))
    const counted = comparables.filter(x => x.liquid)
    const hi = counted.length ? counted.reduce((a, b) => (b.p > a.p ? b : a)) : null
    const lo = counted.length ? counted.reduce((a, b) => (b.p < a.p ? b : a)) : null
    const gap = counted.length >= 2 ? (hi.p - lo.p) * 100 : null
    const status = grade(gap, { tension: TENSION, contradiction: CONTRADICTION })
    const curveLow = fin(gap) && gap > 0 && curve && lo === curve, curveHigh = fin(gap) && gap > 0 && curve && hi === curve
    // the counted market at the other end of the gap from the curve
    const ref = curveLow ? hi : curveHigh ? lo : null
    const marketOdds = [k12, p12].filter(x => x?.liquid && fin(x.p))
    const asOf = kal.length || poly.length ? today : [cur && `${Math.floor(cur.m / 12)}-${String((cur.m % 12) + 1).padStart(2, '0')}-01`, last(baa)?.d].filter(Boolean).sort().pop()

    const verdict = status === 'consistent' ? 'a gap the different definitions and horizons can explain'
      : status === 'tension' ? 'more than the different definitions and horizons explain'
      : 'too far apart for both to be pricing the same twelve months'
    const creditText = !fin(baaPct) ? null
      : baaPct < 50 ? `corporate bond spreads are tighter than on ${100 - baaPct}% of days since ${baaFrom}`
      : `corporate bond spreads are wider than on ${baaPct}% of days since ${baaFrom}`
    const sahmText = !fin(sahmNow) ? null
      : sahmNow >= 0.5 ? `the jobs data's Sahm rule has fired (${sahmNow.toFixed(2)}, against a 0.50 recession trigger)`
      : `the jobs data's Sahm rule reads ${sahmNow.toFixed(2)} against a 0.50 recession trigger`
    // calm on both counts gets one short clause; anything else is spelled out
    const calm = fin(baaPct) && baaPct < 50 && fin(sahmNow) && sahmNow < 0.3
    const tail = calm ? 'credit spreads and the jobs data show no sign of one' : [creditText, sahmText].filter(Boolean).join(', and ')

    // the curve's 12-month figure is this check's conversion, not a number the NY Fed publishes
    const nameOf = x => (x === curve ? "the NY Fed's yield-curve model, put on the same 12-month window," : x.name)
    const headline = fin(gap)
      ? `${nameOf(hi)[0].toUpperCase()}${nameOf(hi).slice(1)} puts the chance of a recession starting in the next 12 months at ${p1(hi.p)} and ${nameOf(lo)} at ${p1(lo.p)}, ${gap.toFixed(1)} percentage points apart, ${verdict}${tail ? `; ${tail}` : ''}.`
      : `Fewer than two comparable recession probabilities could be priced${missing.length ? ` (${missing.join('; ')})` : ''}${curve ? `; the yield curve, through the NY Fed's model converted to a recession starting in the next 12 months, gives ${p1(curve.p)}` : ''}.`

    // ── claims ──
    const vintageOf = c => (c.venue === 'Polymarket' ? "the newest quarter at BEA's advance estimate, the one before at its latest revision"
      : c.vintage === 'advance' ? "each quarter at BEA's advance (first) estimate, per the rules"
      : c.vintage === 'unspecified' ? 'the rules name BEA GDP without saying which estimate' : null)
    const contractClaim = c => {
      const sr = starts(c)
      const where = sr.overlap > 0 ? null
        : isNear(c) ? `a recession must already have begun by ${qLab(c.window.to - 1)}${nowcastOk ? ', so read against the nowcast below' : ''}`
        : `covers starts from ${qLab(sr.a)}, after the common window: shown, not counted`
      return {
        label: `${c.venue}: two straight quarters of falling GDP within ${qLab(c.window.from)} to ${qLab(c.window.to)}${c.nber ? ', or an NBER recession call' : ''}`,
        display: p1(c.p), kind: 'market', source: `${c.venue} ${c.id}, contract rules`, asOf: today,
        note: [fin(c.bid) && fin(c.ask) ? `bid ${Math.round(c.bid * 100)}¢ / ask ${Math.round(c.ask * 100)}¢` : null, traded(c), vintageOf(c),
          !c.liquid ? `thin: under the $${vol(FLOOR)} floor, shown but not counted` : null,
          where].filter(Boolean).join('; '),
      }
    }
    const contracts = [...kal, ...poly].sort((a, b) => b.year - a.year || a.venue.localeCompare(b.venue))
    const claims = [
      ...contracts.map(contractClaim),
      cur && { label: `10-year minus 3-month Treasury spread, ${mLab(cur.m)} average`, display: pp(cur.s, 2), kind: 'market', source: 'FRED GS10 and TB3MS, the NY Fed model\'s inputs', asOf: mLab(cur.m),
        note: `10-year ${pct(cur.y10, 2)} less the 3-month bill at ${pct(bey(cur.b3), 2)} on a bond-equivalent basis${fin(mtd) ? `; ${mLab(mNow)} so far ${pp(mtd, 2)}` : ''}` },
      pub && { label: `NY Fed's published recession probability for ${mLab(pub.m + 12)}`, display: p1(pub.prob), kind: 'forecast', source: 'Federal Reserve Bank of New York, yield-curve model', asOf: mLab(pub.m),
        note: `the chance of being in an NBER recession that month, from the ${mLab(pub.m)} spread (${pp(pub.spread, 2)})${mine ? `; the same arithmetic on FRED's yields gives ${p1(curveP(mine.s))}` : ''}${path ? `; its readings for ${mLab(path.old[0].m)} to ${mLab(last(path.old).m)}, made from the spreads a year before each, run between ${p1(path.lo)} and ${p1(path.hi)}` : ''}` },
      nowcastOk && { label: `Atlanta Fed GDPNow, ${qLab(nq)} real GDP growth`, display: signed(nv), kind: 'forecast', source: 'Federal Reserve Bank of Atlanta (FRED GDPNOW)', asOf: `${qLab(nq)} nowcast`,
        note: `annualized; the last reported quarter, ${qLab(lastQ)}, grew ${signed(lastG)}; the final nowcast has missed BEA's first print by ${GDPNOW_RMSE} pp (root-mean-square, 2011-2025)` },
      fin(sahmNow) && { label: 'Real-time Sahm rule', display: sahmNow.toFixed(2), kind: 'official', source: 'FRED SAHMREALTIME, from BLS unemployment as first published', asOf: mon(last(sahm).d),
        note: `fires at 0.50, when the three-month average unemployment rate sits 0.5 pp above its low of the prior year; unemployment ${pct(uNow)}` },
      fin(baaNow) && { label: 'Baa corporate spread over the 10-year Treasury', display: `${pct(baaNow, 2)} (${ord(baaPct)} pct.)`, kind: 'market', source: "Moody's Baa yield less the 10-year Treasury (FRED BAA10Y)", asOf: last(baa).d,
        note: `ranked since ${baaFrom}, median ${pct(baaMed, 2)}${fin(minPeak) ? `; it reached at least ${pct(minPeak, 2)} in each of the ${recPeaks.length} recessions since ${baaFrom}` : ''}` },
      fin(u2) && { label: `Fed projection: unemployment in Q4 ${Y} and Q4 ${Y + 1} (quarterly average)`, display: `${pct(u1)} / ${pct(u2)}`, kind: 'consensus', source: 'FOMC Summary of Economic Projections, median (FRED UNRATEMD)', ...(sepDate ? { asOf: sepDate } : {}),
        note: `${fin(uNow) ? `now ${pct(uNow)}; ` : ''}highest participant ${pct(uHi)} for Q4 ${Y + 1}; real GDP growth ${pct(g1)} in ${Y} and ${pct(g2)} in ${Y + 1}, Q4 over Q4` },
    ].filter(Boolean)

    // ── implied ──
    const sixS = scen('six'), eraS = scen('era')
    const implied = [
      curve && { label: 'Yield-curve model: a recession starting in the next 12 months', display: p1(curve.p),
        note: `this check's conversion: the model gives ${p1(pT)} for being in recession in ${mLab(cur.m + 12)}; at a constant start rate over the ${D.toFixed(1)}-month average length of a recession, 1 − (1 − ${p1(pT)})^(12 ÷ ${D.toFixed(1)})` },
      path && { label: "Yield-curve model on the NY Fed's older readings (not counted)", display: p1(path.p),
        note: `its published readings for ${mLab(path.old[0].m)} to ${mLab(last(path.old).m)}, made a year before each from the spread of the day, run between ${p1(path.lo)} and ${p1(path.hi)}${path.carried ? `, with ${mLab(cur.m + 12)} from the latest spread` : ''}; the latest spread supersedes them` },
      tpScen.length > 0 && { label: 'Yield-curve model with the term premium held fixed (not counted)', display: tpScen.map(x => p1(x.c)).join(' / '),
        note: `the 12-month figure with the term premium held at ${tpScen.map(x => `${x.what} (${pct(x.base, 2)})`).join(' / ')}, against ${pct(tpNow, 2)} in ${mLab(cur.m)}` },
      k12 && k12.s.n !== 4 && { label: 'Kalshi, rescaled to 12 months', display: p1(k12.p), note: `its window covers ${k12.s.n} forward quarters` },
      p12 && { label: 'Polymarket: a recession starting in the next 12 months', display: p1(p12.p),
        note: `${p12.prior ? `by end of ${p12.c.year} less by end of ${p12.prior.year}` : `by end of ${p12.c.year}`}${p12.raw < 0 ? '; the later contract is priced below the earlier one, which cannot be right' : ''}${!p12.liquid ? '; not counted: thin' : ''}` },
      nearNowcast && { label: `Chance ${qLab(nq)} GDP first prints negative, from the nowcast`, display: `${p1(pNegLo)} to ${p1(pNegHi)}`,
        note: `at GDPNow's usual error and at 1.5× it; ${nearNames} ${nearYear} contract${nearC.length > 1 ? 's need' : ' needs'} this${need.length === 2 ? ` and a negative ${qLab(need[1])}` : ''}` },
      tight.length > 0 && { label: `A recession within a year of a Baa spread this tight, since ${baaFrom}`, display: `${tightHits.length} of ${tight.length} months`,
        note: `${tightEpisodes} separate episode${tightEpisodes === 1 ? '' : 's'}, against ${pct(allRate * 100, 0)} of all months. The count turns on the cutoff and the window: up to ${pct(baaNow + band, 2)} it is ${nearHits.length} of ${near.length}${nearHits.length ? ` (before the ${startYears(nearHits)} recession${new Set(nearHits.map(m => recStarts.find(s => s > m))).size > 1 ? 's' : ''})` : ''}; within 18 months rather than 12, ${tight18Hits.length} of ${tight18.length}${tight18Hits.length ? ` (before the ${startYears(tight18Hits)} recession${new Set(tight18Hits.map(m => recStarts.find(s => s > m))).size > 1 ? 's' : ''})` : ''}. Too few episodes to use as a probability` },
    ].filter(Boolean)

    // ── what has to give ──
    const gives = []
    // term premium: label chosen from both yardsticks against the market at the other end of the gap
    let tpGive = null
    if (tpScen.length) {
      let label = 'How much of the slope is term premium'
      let verdictText = ''
      if (ref && tpScen.length === 2) {
        const g0 = Math.abs(ref.p - c12), gs = tpScen.map(x => Math.abs(ref.p - x.c))
        const kind = gs.every(g => g < 0.5 * g0) ? 'most' : gs.every(g => g < g0) ? 'part' : gs.some(g => g < g0) ? 'both' : 'wider'
        label = { most: 'Term premium explains most of the gap', part: 'Term premium explains part of the gap', both: 'The term premium cuts both ways', wider: 'Term premium widens the gap' }[kind]
        verdictText = ` Against ${ref.name}'s ${p1(ref.p)}, ${{
          most: 'either yardstick closes most of the gap.',
          part: 'both yardsticks narrow the gap, but not both by half.',
          both: 'one yardstick narrows the gap and the other widens it, so the term premium settles nothing on its own: the answer depends on the base.',
          wider: 'both yardsticks widen the gap.',
        }[kind]}`
      }
      const sixText = sixS ? ` Since ${mLab(six.m)} the spread has ${dS >= 0 ? 'widened' : 'narrowed'} by ${abs2(dS)} and the term premium has ${tpNow >= sixS.base ? 'risen' : 'fallen'} by ${abs2(tpNow - sixS.base)}; held at its ${mLab(six.m)} level, the model would read ${p1(sixS.c)} for the next 12 months.` : ''
      const eraText = eraS ? ` Against its ${eraLab} average of ${pct(eraS.base, 2)}, the part of the model's 1959-2009 fitting period the estimate covers, today's term premium is ${tpNow < eraS.base ? 'low, so more of today\'s slope than usual is expected growth' : 'high, so less of today\'s slope than usual is expected growth'}; held at that average, the model would read ${p1(eraS.c)}.` : ''
      tpGive = { label, note: `The model reads every bit of steepness as a sign of growth, but part of a steep curve is term premium, the extra yield investors want for holding long bonds (the Fed's Kim-Wright estimate: ${pct(tpNow, 2)} in ${mLab(cur.m)}).${sixText}${eraText}${verdictText}` }
    }
    if (curveLow) {
      gives.push(tpGive || { label: 'The curve may be too calm', note: 'The model was fit on 1959-2009 and reads every bit of steepness as a sign of growth; part of a steep curve can be term premium, the extra yield investors want for holding long bonds, rather than expected growth.' })
      if (longShot && marketOdds.includes(hi)) {
        gives.push({ label: 'Event contracts may run rich on Yes', note: `The ${nearYear} contracts trade at ${nearPrices} although the nowcast allows at most ${p1(pNegHi)} for ${need.length === 2 ? 'even the first of the two quarters they need' : 'the one quarter they still need'}: buyers of long shots tend to overpay. If ${hi.name}'s ${p1(hi.p)} carries part of that premium, it overstates the odds and the ${gap.toFixed(1)} pp gap to the curve is narrower than it looks.` })
      }
    } else if (curveHigh) {
      gives.push({ label: status === 'consistent' ? 'The curve sees a little more risk than the markets' : 'The markets may be too relaxed',
        note: `${cur.s < 0 ? `The curve is inverted (${pp(cur.s, 2)}), and an inverted curve came before each of the last eight recessions, back to 1969; ` : `The curve is not inverted (${pp(cur.s, 2)}), but `}the model reads more risk than ${ref.name}'s ${p1(ref.p)}.${peakMissed ? ` It is not infallible: its reading for ${mLab(peak.m + 12)} was ${p1(peak.p)}, and no recession came.` : ''}` })
      if (tpGive) gives.push(tpGive)
    } else if (fin(gap) && gap > 0) {
      gives.push({ label: 'The two prediction markets disagree', note: `${hi.name} prices a recession starting in the next 12 months at ${p1(hi.p)} and ${lo.name} at ${p1(lo.p)}${curve && curve !== hi && curve !== lo ? `, with the yield curve between them at ${p1(c12)}` : ''}. Polymarket also pays on an NBER call and reads the earlier of the two quarters at its revised estimate, which should lift its price a little${hi.name === 'Polymarket' ? '; beyond that' : ', not leave it lower; so'}, one venue's traders are paying more for the same twelve months.` })
      if (tpGive) gives.push(tpGive)
    } else if (tpGive) gives.push(tpGive)
    const kDef = k12?.c.vintage === 'advance' ? `Kalshi's ${k12.c.year} contract pays on two straight quarters of falling GDP, each read at BEA's advance (first) estimate`
      : 'Kalshi pays on two straight quarters of falling GDP according to BEA'
    gives.push({ label: 'Definitions explain a few points', note: `${kDef}; Polymarket on the newest quarter's advance estimate paired with the latest revised estimate of the quarter before, or an NBER call; the curve model on NBER-dated recessions. First prints showed two declines in 2022 with no recession, and the 2001 recession never had two in a row, so a contract can sit several points from the model without either being wrong.` })
    if (fin(baaPct)) {
      const hiMkt = marketOdds.length ? marketOdds.reduce((a, b) => (b.p > a.p ? b : a)) : null
      const history = near.length && fin(allRate)
        ? creditInformative
          ? ` Since ${baaFrom}, months with the spread up to ${pct(baaNow + band, 2)} were followed by a recession start within a year only ${pct(nearRate * 100, 0)} of the time, against ${pct(allRate * 100, 0)} for all months; still, credit tends to widen only once a downturn is under way.`
          : ` A spread this tight says lenders see little default risk in the near term, not that a recession within a year is unlikely: since ${baaFrom}, months with the spread up to ${pct(baaNow + band, 2)} were followed by a recession start within a year ${pct(nearRate * 100, 0)} of the time${nearHits.length ? ` (before the ${startYears(nearHits)} recession${new Set(nearHits.map(m => recStarts.find(s => s > m))).size > 1 ? 's' : ''})` : ''}, against ${pct(allRate * 100, 0)} for all months.`
        : ''
      gives.push(baaPct < 25
        ? { label: 'Credit is priced for calm', note: `Corporate bonds pay ${pct(baaNow, 2)} over Treasuries, the ${ord(baaPct)} percentile since ${baaFrom}${fin(minPeak) ? `, and in each of the ${recPeaks.length} recessions since then the spread reached at least ${pct(minPeak, 2)}` : ''}.${history} ${hiMkt ? `If ${hiMkt.name}'s ${p1(hiMkt.p)} is right, spreads have room to widen.` : 'If recession risk rises, spreads have room to widen.'}` }
        : baaPct > 75
          ? { label: 'Credit is already pricing stress', note: `Corporate bonds pay ${pct(baaNow, 2)} over Treasuries, the ${ord(baaPct)} percentile since ${baaFrom}: lenders are charging for risk the lower probabilities leave out.` }
          : { label: 'Credit is neutral', note: `Corporate bonds pay ${pct(baaNow, 2)} over Treasuries, near the middle of their range since ${baaFrom}.` })
    }
    if (nearNowcast) {
      const kN = nearC.find(c => c.venue === 'Kalshi'), pN = nearC.find(c => c.venue === 'Polymarket')
      const venues = kN && pN ? ` The two venues price nearly the same test ${Math.abs(pN.p - kN.p) * 100 < 0.05 ? 'at the same price' : `${(Math.abs(pN.p - kN.p) * 100).toFixed(1)} pp apart`}; Polymarket's extra route, an NBER call announced by the ${qLab(settleQ)} GDP release, ${quiet ? 'adds little while the data show no recession under way, since NBER took 4 to 12 months to date the start of each recession since 1980' : 'could matter only if a recession has already begun, since NBER took 4 to 12 months to date the start of each recession since 1980'}.` : ''
      gives.push(longShot
        ? { label: `The ${nearYear} contracts carry a long-shot premium`, note: `${nearC.length > 1 ? 'They need' : 'It needs'} ${need.map(qLab).join(' and ')} to shrink, yet GDPNow tracks ${qLab(nq)} at ${signed(nv)}, which puts a negative first print at ${p1(pNegLo)} to ${p1(pNegHi)}. ${nearC.length > 1 ? `Prices of ${nearPrices} are` : `A price of ${nearPrices} is`} mostly what buyers pay for a long shot, plus what a seller earns for tying up the stake until the ${qLab(settleQ)} GDP release.${venues}` }
        : { label: `The ${nearYear} contracts against the nowcast`, note: `GDPNow tracks ${qLab(nq)} at ${signed(nv)}, a ${p1(pNegLo)} to ${p1(pNegHi)} chance of a negative first print; the contracts trade at ${nearPrices}.${venues}` })
    } else if (nearC.length && !need) {
      gives.push({ label: `The ${nearYear} contracts can no longer pay on GDP`, note: `${qLab(lastQ)} grew ${signed(lastG)}, so two straight declines no longer fit before ${qLab(settleQ)} ends${nearC.some(c => c.nber) ? '; only an NBER announcement could still settle the Polymarket one Yes' : ''}. Prices of ${nearPrices} are the residue.` })
    }

    // ── what to watch ──
    const watch = [
      nowcastOk && { label: `${qLab(nq)} GDP, first print`, display: `${signed(nv)} nowcast`, note: 'BEA, about four weeks after the quarter ends' },
      fin(mtd) && { label: `10-year minus 3-month spread, ${mLab(mNow)} so far`, display: `${pp(mtd, 2)} (model ${p1(to12(curveP(mtd)))})`,
        note: `on the same 12-month basis as the ${p1(c12)} from ${mLab(cur.m)}; the model's raw chance of recession in ${mLab(mNow + 12)} is ${p1(curveP(mtd))}. The NY Fed updates in the first two weeks of each month, and a zero spread would read ${p1(to12(curveP(0)))} (${p1(curveP(0))} raw)` },
      fin(sahmNow) && { label: 'Sahm rule', display: `${sahmNow.toFixed(2)} (fires at 0.50)`, note: fin(sahmTrigger) ? `a three-month average unemployment rate of about ${pct(sahmTrigger)} would fire it; now ${pct(uNow)}` : 'monthly, with the jobs report' },
      k12 && { label: `Kalshi's ${k12.c.year} contract`, display: p1(k12.c.p), note: traded(k12.c) },
      p12 && !p12.liquid && { label: `Polymarket by end of ${p12.c.year}: trading volume`, display: `$${vol(p12.c.dollars)}`, note: `it counts once it passes $${vol(FLOOR)}` },
      fin(baaNow) && { label: 'Baa spread back to its median', display: `${pct(baaNow, 2)} now, median ${pct(baaMed, 2)}`, note: 'credit is usually the last of these to move and the fastest once it does' },
    ].filter(Boolean)

    // ── the arithmetic ──
    const math = [
      `Common window: a recession whose first quarter of decline falls in ${span}, that is, one starting in the next 12 months.`,
      k12 && `Kalshi ${k12.c.id}: its rules pay on two straight quarters of negative real GDP growth within ${qLab(k12.c.window.from)} to ${qLab(k12.c.window.to)}, so the first decline can still fall in ${qLab(k12.s.a)} to ${qLab(k12.s.b)}: ${k12.s.n} quarter${k12.s.n === 1 ? '' : 's'}${k12.s.n === 4 ? `, ${k12.s.a === q0 ? 'the common window' : 'as long as the common window'}, so ${p1(k12.c.p)} is used as is.` : `; at a constant rate, 1 − (1 − ${p1(k12.c.p)})^(4/${k12.s.n}) = ${p1(k12.p)}.`}`,
      p12 && (p12.prior
        ? `Polymarket: everything that settles "by end of ${p12.prior.year}" Yes also settles "by end of ${p12.c.year}" Yes (same tests, longer window, later NBER deadline), so the ${p12.c.year}-only part is ${p1(p12.c.p)} − ${p1(p12.prior.p)} = ${p1(p12.raw)}${p12.s.n !== 4 ? `, rescaled from ${p12.s.n} quarters to ${p1(p12.p)}` : ''}.${!p12.liquid ? ` Not counted: only $${vol(Math.min(p12.c.dollars || 0, p12.prior.dollars ?? Infinity))} traded, under the $${vol(FLOOR)} floor.` : ''}`
        : `Polymarket by end of ${p12.c.year}: ${p1(p12.c.p)} over ${p12.s.n} forward quarters, ${p1(p12.p)} on 12 months.${!p12.liquid ? ' Not counted: under the volume floor.' : ''}`),
      `Volume floor: $${vol(FLOOR)} traded. Kalshi reports contracts, put on dollars at today's price (contracts × price), which understates a contract that once traded higher.`,
      cur && `Yield curve, ${mLab(cur.m)} averages: ${pct(cur.y10, 2)} − ${pct(bey(cur.b3), 3)} = ${pp(cur.s, 3)}, the bill's ${pct(cur.b3, 2)} discount rate d turned into a bond-equivalent yield by 365d ÷ (360 − 0.91d). P = Φ(${num(ALPHA, 4)} − ${num(-BETA, 4)} × ${num(cur.s, 3)}) = Φ(${num(ALPHA + BETA * cur.s, 3)}) = ${p1(pT)}, where Φ is the standard normal distribution: the chance the economy is in an NBER recession in ${mLab(cur.m + 12)}.`,
      fin(lam) && `Horizon: the ${since59.length} recessions since 1959 lasted ${D.toFixed(1)} months on average (FRED USREC), so being in recession in a given month is about as likely as one starting in the ${D.toFixed(1)} months before it. At a constant monthly start rate λ, 1 − e^(−${D.toFixed(1)}λ) = ${p1(pT)}, so λ = −ln(1 − ${p1(pT)}) ÷ ${D.toFixed(1)} = ${(lam * 100).toFixed(2)}%; over 12 months, 1 − e^(−12λ) = 1 − (1 − ${p1(pT)})^(12 ÷ ${D.toFixed(1)}) = ${p1(c12)}. The ${mLab(cur.m + 12)} reading covers recessions starting from about ${mLab(cur.m + 13 - Math.round(D))} on, most of the window.`,
      pub && `Check: the NY Fed's own file gives ${p1(pub.prob)} for ${mLab(pub.m + 12)} from the ${mLab(pub.m)} spread of ${pp(pub.spread, 2)}${mine ? `; the arithmetic above on FRED's ${mLab(pub.m)} yields gives ${p1(curveP(mine.s))}` : ''}.`,
      path && `Older readings: the NY Fed's file also has ${mLab(path.old[0].m)} to ${mLab(last(path.old).m)}, made from the ${mLab(path.old[0].m - 12)} to ${mLab(last(path.old).m - 12)} spreads, between ${p1(path.lo)} and ${p1(path.hi)}; with ${path.carried ? `the latest reading carried for the ${path.carried === 1 ? 'last month' : `last ${path.carried} months`}` : 'nothing carried'}, they average ${p1(path.avg)}, and summing each month's start rate, 1 − Π(1 − Pₘ)^(1 ÷ ${D.toFixed(1)}) = ${p1(path.p)}. Not counted: each is a 12-month-ahead forecast from the spread of its day, and the latest supersedes them${quiet ? `; since most of them were made, ${qLab(lastQ)} GDP grew ${signed(lastG)}, GDPNow has put ${qLab(nq)} at ${signed(nv)} and the Sahm rule reads ${sahmNow.toFixed(2)}, which argue against a recession that would already have begun` : ''}.`,
      tpScen.length > 0 && `Term premium (Kim-Wright, FRED THREEFYTP10, ${mLab(cur.m)} average ${pct(tpNow, 3)}): the model is rerun on the spread less the term premium's excess over a base, P = Φ(${num(ALPHA, 4)} − ${num(-BETA, 4)} × (s − (TP − base))). ${tpScen.map(x => `Held at ${x.what} (${pct(x.base, 3)}): s = ${num(x.s, 3)}, P = ${p1(x.p)}, 12-month ${p1(x.c)}`).join('. ')}.`,
      fin(gap) && `Gap: ${nameOf(hi)} ${p1(hi.p)} − ${nameOf(lo)} ${p1(lo.p)} = ${gap.toFixed(1)} pp, a ratio of ${times(hi.p / lo.p)}. Counted: ${counted.map(x => x.name).join(', ')}.`,
      missing.length > 0 && `Not available today: ${missing.join('; ')}.`,
      (() => {
        const kNear = kal.find(c => isNear(c) && k12 && c.window.to === k12.c.window.from), pY = p12?.c
        if (!kNear || !k12 || !pY || pY.window.to !== k12.c.window.to) return null
        const a = kNear.p, b = k12.c.p
        return `The same question on Kalshi alone, through ${qLab(k12.c.window.to)}: 1 − (1 − ${p1(a)}) × (1 − ${p1(b)}) = ${p1(1 - (1 - a) * (1 - b))} if the two contracts were independent, and between ${p1(Math.max(a, b))} and ${p1(Math.min(1, a + b))} whatever their overlap, against Polymarket's ${p1(pY.p)}${!pY.liquid ? ', thinly traded,' : ''} which also pays on an NBER call.`
      })(),
      nearNowcast && `Near term: ${nearNames} ${nearYear} contract${nearC.length > 1 ? 's' : ''} need${nearC.length > 1 ? '' : 's'} ${need.map(qLab).join(' and ')} negative (${qLab(lastQ)} grew ${signed(lastG)}). Chance GDPNow's ${signed(nv)} turns into a negative first print, with its ${GDPNOW_RMSE} pp error: Φ(${num(-nv, 2)} ÷ ${GDPNOW_RMSE}) = ${p1(pNegLo)}; at 1.5× the error, ${p1(pNegHi)}.${need.length === 2 ? ` Needing ${qLab(need[1])} negative too makes it less likely still.` : ''}`,
      tight.length > 0 && `Credit: counting only months whose following window ended at least ${NBER_LAG} months before FRED's latest USREC month (NBER took 4 to 12 months to date each recession start since 1980), ${pct(allRate * 100, 0)} of the ${u12.length} months since ${baaFrom} were followed by a recession start within 12 months; of the ${tight.length} with the Baa spread at ${pct(baaNow, 2)} or less, ${tightHits.length}; widening the cutoff by the spread's median three-month move (${band.toFixed(2)} pp) to ${pct(baaNow + band, 2)}, ${nearHits.length} of ${near.length}. Within 18 months: ${pct(allRate18 * 100, 0)} of all ${u18.length} months, ${tight18Hits.length} of the ${tight18.length} at ${pct(baaNow, 2)} or less.`,
      fin(u2) && fin(uNow) && `The Fed's median has unemployment averaging ${pct(u2)} in Q4 ${Y + 1} against ${pct(uNow)} now (${pp(u2 - uNow)}). Each participant projects the most likely outcome rather than an average over risks, so a path with no recession in it fits any recession probability below 50%.`,
    ].filter(Boolean)

    return {
      status: counted.length >= 2 ? status : 'unavailable',
      asOf,
      headline,
      claims,
      implied,
      gap: fin(gap) ? {
        label: 'Spread between the comparable 12-month odds', value: gap, display: `${gap.toFixed(1)} pp`,
        tension: TENSION, contradiction: CONTRADICTION, max: 30, tensionLabel: `${TENSION} pp`, contradictionLabel: `${CONTRADICTION} pp`,
        note: `Highest minus lowest of the counted sources, each put on a recession starting in ${span}; today the higher is ${times(hi.p / lo.p)} the lower. Under ${TENSION} pp the different definitions and quote spreads can explain it.${missing.length ? ` Not available today: ${missing.join('; ')}.` : ''}`,
      } : null,
      gives,
      watch,
      math,
      sources: [
        k12 && { label: 'Kalshi recession contracts (rules on each market)', url: k12.c.url },
        ...poly.map(c => ({ label: `Polymarket: US recession by end of ${c.year}?`, url: c.url })),
        { label: 'NY Fed: the yield curve as a leading indicator (model, coefficients, data)', url: 'https://www.newyorkfed.org/research/capital_markets/ycfaq' },
        { label: 'Estrella and Mishkin (1996), The Yield Curve as a Predictor of U.S. Recessions', url: 'https://www.newyorkfed.org/medialibrary/media/research/current_issues/ci2-7.pdf' },
        { label: 'Kim-Wright ten-year term premium (FRED)', url: 'https://fred.stlouisfed.org/series/THREEFYTP10' },
        { label: 'Atlanta Fed GDPNow (nowcast and its track record)', url: 'https://www.atlantafed.org/research-and-data/data/gdpnow' },
        { label: 'Real-time Sahm rule (FRED)', url: 'https://fred.stlouisfed.org/series/SAHMREALTIME' },
        { label: "Moody's Baa spread over the 10-year Treasury (FRED)", url: 'https://fred.stlouisfed.org/series/BAA10Y' },
        { label: 'FOMC median unemployment projection (FRED)', url: 'https://fred.stlouisfed.org/series/UNRATEMD' },
        { label: 'NBER business cycle dates and announcement dates', url: 'https://www.nber.org/research/business-cycle-dating' },
      ].filter(Boolean),
    }
  },
}
