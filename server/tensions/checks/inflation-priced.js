// ============================================================================
// INFLATION PRICED: do the near-term inflation prices square with the
// long-term ones? Kalshi prices the next CPI prints near today's inflation,
// while the 5-year breakeven (the inflation rate at which inflation-protected
// Treasuries, TIPS, and ordinary Treasuries pay the same) prices five years of
// CPI. The check builds the CPI index path the shorter claims imply over the
// breakeven's own five-year window. The Fed path starts from the latest
// print: the rest of this calendar year runs at the pace that carries the
// index to the Fed's December level (SEP median PCE inflation, read as
// December over December, turned into CPI with the CPI-PCE wedge measured
// over the past 20 years), and later years run at the projected rates (the
// longer-run rate after the last projected year). Kalshi's furthest readable
// month then sets the level for that month, and the path keeps the Fed path's
// month-to-month pace after it, so the market's news about the price level
// persists and no Fed annual rate is applied twice. Gap = that path's
// five-year average minus the 5-year breakeven, in percentage points; its
// size is graded and its sign sets the wording.
// Kalshi covers only the first few of the 60 months, so the gap turns mostly
// on the Fed path and the wedge. Two benchmarks show how much those carry,
// and neither enters the grade: the same path at the other measured wedges
// (10-year, today's headline and today's core), and a path that drops the
// Fed after the first December and closes the distance to the Fed's
// longer-run rate at history's pace. That pace is the slope of the 12-month
// CPI rate on its own value a year earlier, monthly since 1990, estimated at
// the 12-month horizon directly: compounding a month-to-month slope twelve
// times overstates persistence, because neighbouring 12-month rates share 11
// of their 12 months.
// Thresholds: a breakeven differs from expected inflation by the inflation
// risk premium less the TIPS liquidity premium. The Cleveland Fed's model of
// expected CPI inflation (built from Treasury yields, inflation swaps, survey
// forecasts and inflation data, not from TIPS) is the yardstick here for that
// difference: since 2003 the 5-year breakeven has sat within 0.5 pp of the
// model in about 83% of months and within 1.0 pp in about 95%, and the months
// beyond 1.0 pp cluster in 2008-09 and 2021-22 (shares and episodes are
// recomputed live in the arithmetic). Under 0.5 pp the claims fit with
// ordinary premia; from 0.5 pp the circle needs squaring; from 1.0 pp the gap
// is larger than premia have explained outside a few episodes.
// Inputs: Kalshi KXCPIYOY and KXUSCPIYEAR; Polymarket's monthly "Inflation
// US - Annual" event, found through its public search (a cross-check on the
// next print only, outside the path); FRED breakevens, SEP medians, CPI, PCE
// and the Cleveland Fed model.
// ============================================================================
import { fin, pct, pp, prob, grade, last, lastV, mon, ladder, normCdf } from '../lib.js'

const TENSION = 0.5, CONTRADICTION = 1.0
const WEDGE_YEARS = 20
const PERSIST_FROM = 1990
// Kalshi volume floor: a strike counts only if it has traded at least 1,000
// contracts and is quoted on both sides no more than 10 cents apart (its price
// is then the midpoint). A month's ladder anchors the path only with at least
// four such strikes, 10,000 contracts between them, and a 50% crossing.
const MIN_STRIKE_VOL = 1000, MAX_SPREAD = 0.1, MIN_STRIKES = 4, MIN_EVENT_VOL = 10000
// Polymarket floor: the event has traded at least $50,000 and every bucket is priced.
const POLY_MIN_VOL = 50000
// KXCPIYOY's rules say it pays on the one-decimal figure BLS publishes, so
// "more than 3.7%" pays on a 3.8% print, i.e. an unrounded rate of 3.75% or
// more. KXUSCPIYEAR's rules name "the initially reported value" of the
// 12-month change, which BLS also publishes to one decimal, so the same
// reading is inferred there. Shifting every strike up half a tenth reads the
// ladder on the unrounded rate, which is what the CPI path and the breakevens
// measure.
const HALF_TICK = 0.05
// One strike on a thin year-ahead ladder gives P(rate > strike), which fixes
// the market's median only together with a spread: median = strike +
// spread × z(p). Year-ahead CPI forecasts have typically missed by roughly a
// point, so the strike is read at every spread from 0.5 to 1.5 points, and
// the market leans only when that whole band for its median clears the path
// by 0.1 point.
const SPREADS = [0.5, 1.5], LEAN_TOL = 0.1

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const MONTH_RE = new RegExp(`(${MONTHS.join('|')})\\s+(\\d{4})`)
const STRIKE_RE = /(?:more than|above)\s+(-?\d+(?:\.\d+)?)%/i
const mi = d => +d.slice(0, 4) * 12 + (+d.slice(5, 7) - 1) // month index
const md = i => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`
const monI = i => (i == null ? null : mon(md(i)))
const day = iso => (iso ? `${MONTHS[+iso.slice(5, 7) - 1].slice(0, 3)} ${+iso.slice(8, 10)}, ${iso.slice(0, 4)}` : null)
const pts = v => (fin(v) ? `${Math.abs(v).toFixed(2)} points` : '—')
const side = (v, a = 'above', b = 'below') => (fin(v) ? `${pts(v)} ${v >= 0 ? a : b}` : '—')
const months = n => `${n} month${n === 1 ? '' : 's'}`
// months a to b inclusive: 'Oct to Dec 2026', 'Sep 2026 to Aug 2031'
const span = (a, b) => (a === b ? monI(a) : Math.floor(a / 12) === Math.floor(b / 12) ? `${monI(a).slice(0, 3)} to ${monI(b)}` : `${monI(a)} to ${monI(b)}`)
const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length
const yoyMap = s => {
  const m = new Map((s || []).map(x => [mi(x.d), x.v]))
  return new Map((s || []).filter(x => m.has(mi(x.d) - 12)).map(x => [mi(x.d), (x.v / m.get(mi(x.d) - 12) - 1) * 100]))
}
const lastOf = m => (m.size ? Math.max(...m.keys()) : null)
const latestBoth = (a, b) => { const ks = [...a.keys()].filter(i => b.has(i)); return ks.length ? Math.max(...ks) : null }
// inverse of the standard normal CDF, by bisection
const zOf = p => { let lo = -8, hi = 8; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (normCdf(m) < p) lo = m; else hi = m } return (lo + hi) / 2 }
// the market client does not retry; one retry after a pause rides out a rate limit
const retry = async f => { try { return await f() } catch { await new Promise(r => setTimeout(r, 800)); return f() } }
// [2008, 2009, 2013, 2021, 2022] → '2008-09, 2013 and 2021-22'
const yearRuns = ys => {
  const out = []
  for (const y of [...new Set(ys)].sort((a, b) => a - b)) { const r = out[out.length - 1]; if (r && y === r[1] + 1) r[1] = y; else out.push([y, y]) }
  const s = out.map(([a, b]) => (a === b ? `${a}` : `${a}-${String(b).slice(2)}`))
  return s.length > 1 ? `${s.slice(0, -1).join(', ')} and ${s[s.length - 1]}` : s[0] || ''
}

// One Kalshi event read from its own rules: which month, which strikes are
// readable, and (when it brackets 50%) the median of the unrounded rate.
function readEvent(ev) {
  let month = null, volume = 0
  const usable = [], skipped = []
  for (const m of ev?.markets || []) {
    volume += m.volume || 0
    const rule = m.rules || ''
    const k = rule.match(STRIKE_RE)
    const headlineYoY = /twelve months|12-month/i.test(rule) && /Consumer Price Index|CPI/.test(rule) && !/core|less food|excluding/i.test(rule)
    if (!headlineYoY || !k || !fin(m.strike) || Math.abs(+k[1] - m.strike) > 1e-9) { skipped.push(m); continue }
    const mm = rule.match(MONTH_RE)
    if (mm && !month) month = `${mm[2]}-${String(MONTHS.indexOf(mm[1]) + 1).padStart(2, '0')}-01`
    if (!fin(m.bid) || !fin(m.ask) || m.ask <= 0 || m.ask - m.bid > MAX_SPREAD || (m.volume ?? 0) < MIN_STRIKE_VOL) { skipped.push(m); continue }
    usable.push({ strike: m.strike + HALF_TICK, label: m.strike, p: (m.bid + m.ask) / 2, volume: m.volume })
  }
  usable.sort((a, b) => a.strike - b.strike)
  const lad = usable.length >= 2 ? ladder(usable) : null
  const usableVol = usable.reduce((a, x) => a + x.volume, 0)
  const brackets = lad && lad.strikes[0].p >= 0.5 && lad.strikes[lad.strikes.length - 1].p < 0.5
  const ok = !!(lad && brackets && usable.length >= MIN_STRIKES && usableVol >= MIN_EVENT_VOL)
  // the two published strikes either side of the 50% crossing, for the notes
  let lo = null, hi = null
  for (const u of usable) { if (u.p >= 0.5) lo = u; else if (!hi) hi = u }
  const closes = (ev?.markets || []).map(m => m.closes).filter(Boolean).sort()[0] || null
  return { event: ev?.event, month, usable, skipped: skipped.length, volume, usableVol, median: ok ? lad.median : null, ok, lo, hi, closes }
}
const odds = r => [r.lo && `${prob(r.lo.p)} odds of a print above ${pct(r.lo.label)}`, r.hi && `${prob(r.hi.p)} above ${pct(r.hi.label)}`].filter(Boolean).join(', ')
  + (r.lo && r.hi && r.hi.label - r.lo.label > 0.1 + 1e-9 ? ' (the strikes between are quoted too wide to read)' : '')
const kContracts = v => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : `${Math.round(v)}`)

// Polymarket's US CPI event: one bucket per one-decimal print plus two open
// ends ("≤2.9%", "≥4.0%"). Bucket prices are scaled to sum to one, summed into
// P(print > v) and read as a ladder on the unrounded rate, like Kalshi's.
function readPoly(pm) {
  const rows = []
  for (const m of pm?.markets || []) {
    const k = String(m.label || '').match(/^\s*(≤|<=|<|≥|>=|>)?\s*(-?\d+(?:\.\d+)?)%/)
    if (!k || !fin(m.yes) || m.closed) return null
    rows.push({ v: +k[2], low: /≤|<=|</.test(k[1] || ''), high: /≥|>=|>/.test(k[1] || ''), yes: m.yes })
  }
  if (rows.length < 4 || rows.filter(r => r.low).length > 1 || rows.filter(r => r.high).length > 1) return null
  const tot = rows.reduce((a, r) => a + r.yes, 0)
  if (tot < 0.9 || tot > 1.15) return null
  const grid = [...new Set(rows.filter(r => !r.high).map(r => r.v))].sort((a, b) => a - b)
  const strikes = grid.map(v => ({ strike: v + HALF_TICK, label: v, p: rows.filter(r => r.v > v).reduce((a, r) => a + r.yes, 0) / tot }))
  const lad = ladder(strikes)
  if (!lad || !(lad.strikes[0].p >= 0.5 && lad.strikes[lad.strikes.length - 1].p < 0.5)) return null
  return { median: lad.median, pAbove: v => strikes.find(s => Math.abs(s.label - v) < 1e-9)?.p ?? null, total: tot }
}
const dollarsK = v => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}k`)

export default {
  id: 'inflation-priced',
  domain: 'economy',
  order: 3,
  title: 'What inflation is priced?',
  question: 'Do the prices on the next few CPI prints square with the five years of inflation the bond market prices?',
  see: 'Charts: U.S. Economy → Inflation (What the market and households expect next); U.S. Economy → Rates & Fed → Treasuries & mortgages (what the 10-year is made of).',
  async compute(ctx) {
    const N_IDX = WEDGE_YEARS * 12 + 30
    const N_HIST = (+ctx.today.slice(0, 4) - PERSIST_FROM + 2) * 12
    // the Polymarket search runs alongside everything else; its result is read later
    const polySearch = ctx.fetchJson(`https://gamma-api.polymarket.com/public-search?q=${encodeURIComponent('Inflation US Annual')}&limit_per_type=10&events_status=active`).catch(err => ({ error: err }))
    const [be5s, be10s, fwds, cle5, sepY, sepLR, cpiSA, cpiNSA, pce, corePce, coreCpi] = await Promise.all([
      ctx.fred('T5YIE', 6000), ctx.fred('T10YIE', 5), ctx.fred('T5YIFR', 5), ctx.fred('EXPINF5YR', 300),
      ctx.fred('PCECTPIMD', 10), ctx.fred('PCECTPIMDLR', 2),
      ctx.fred('CPIAUCSL', 40), ctx.fred('CPIAUCNS', N_HIST), ctx.fred('PCEPI', N_IDX), ctx.fred('PCEPILFE', 20), ctx.fred('CPILFESL', 20),
    ])

    // ── Kalshi: every open monthly CPI ladder, read from its rules ──
    // (the events carry no date, so they are ordered by the month their rules name)
    const notes = []
    let monthly = [], kalshiUp = false
    try {
      const evs = await retry(() => ctx.markets.kalshiEvents('KXCPIYOY'))
      kalshiUp = true
      const got = await Promise.allSettled(evs.map(e => retry(() => ctx.markets.kalshi(e.event))))
      monthly = got.filter(g => g.status === 'fulfilled').map(g => readEvent(g.value)).filter(r => r.month).sort((a, b) => a.month.localeCompare(b.month))
      const failed = evs.filter((_, i) => got[i].status === 'rejected').map(e => e.event)
      if (failed.length) notes.push(`Kalshi ${failed.join(', ')} failed to load and ${failed.length > 1 ? 'are' : 'is'} left out`)
    } catch (e) { notes.push(`Kalshi monthly CPI ladders unavailable (${e.message})`) }

    // ── official inflation ──
    const cpiY = yoyMap(cpiNSA), pceY = yoyMap(pce), corePceY = yoyMap(corePce), coreCpiY = yoyMap(coreCpi)
    const cpiLast = lastOf(cpiY), cpiNow = cpiY.get(cpiLast)
    const pceNow = pceY.get(lastOf(pceY))
    const corePceLast = lastOf(corePceY), corePceNow = corePceY.get(corePceLast), coreCpiNow = coreCpiY.get(lastOf(coreCpiY))
    // the path is built on the seasonally adjusted index, so a part-year pace carries no seasonal swing
    const sa = new Map((cpiSA || []).map(x => [mi(x.d), x.v]))
    const S = sa.size ? lastOf(sa) : lastOf(cpiY) // latest published index: the path starts here
    const lvl = i => sa.get(i) ?? (sa.has(i - 1) && sa.has(i + 1) ? Math.sqrt(sa.get(i - 1) * sa.get(i + 1)) : null) // the 2025 shutdown left October 2025 unpublished
    const LS = S != null ? sa.get(S) ?? null : null
    if (!fin(LS) && S != null) notes.push(`the seasonally adjusted CPI index did not load, so Kalshi's prices stay out of the path and the rest of ${Math.floor(S / 12)} runs at the Fed's annual rate`)

    // ── the CPI-PCE wedge, measured: mean gap between the 12-month rates ──
    // (today's wedge is read at the latest month both series have: CPI has no 12-month rate for October 2026)
    const wm = latestBoth(cpiY, pceY), cwm = latestBoth(coreCpiY, corePceY)
    const wedgeNow = wm != null ? cpiY.get(wm) - pceY.get(wm) : null
    const coreWedgeNow = cwm != null ? coreCpiY.get(cwm) - corePceY.get(cwm) : null
    const wedgeOver = years => {
      if (wm == null) return null
      const xs = []
      for (const [i, v] of cpiY) if (i > wm - years * 12 && i <= wm && pceY.has(i)) xs.push(v - pceY.get(i))
      return xs.length >= years * 12 * 0.9 ? { mean: mean(xs), n: xs.length } : null
    }
    const w20 = wedgeOver(WEDGE_YEARS), w10 = wedgeOver(10)
    const wedge = w20?.mean ?? w10?.mean ?? null
    const wedgeYears = w20 ? WEDGE_YEARS : 10

    // ── the Fed's projections (SEP median PCE inflation, Q4 over Q4) ──
    const sep = new Map((sepY || []).map(x => [+x.d.slice(0, 4), x.v]))
    const lr = lastV(sepLR), sepDate = last(sepLR)?.d
    const sepYears = [...sep.keys()].sort((a, b) => a - b)

    const be5 = lastV(be5s), be10 = lastV(be10s), fwd = lastV(fwds), beDate = last(be5s)?.d
    if (!fin(be5) || !fin(lr) || !fin(wedge) || S == null || !sepYears.length) {
      return { status: 'unavailable', headline: 'The breakeven, the Fed projections or the CPI and PCE history did not load.', asOf: beDate, claims: [], implied: [], gives: [], watch: [], math: notes.map(n => `Note: ${n}.`), sources: [] }
    }
    if (!fin(fwd)) notes.push('the 5y5y forward (FRED T5YIFR) did not load, so the years-six-to-ten comparison is left out')
    if (!fin(be10)) notes.push('the 10-year breakeven (FRED T10YIE) did not load, so the ten-year comparison is left out')

    // ── the near-term anchor: the furthest readable month after the latest published index ──
    const future = monthly.filter(r => mi(r.month) > S)
    const next = future[0] || null
    const anchor = [...future].reverse().find(r => r.ok) || null
    const e = anchor ? mi(anchor.month) : null
    const useMkt = !!anchor && fin(LS) && fin(lvl(e - 12))
    if (!future.length && kalshiUp) notes.push('no open Kalshi CPI month lies beyond the latest published one, so the path starts from the Fed projection')
    else if (future.length && !anchor) notes.push(`no Kalshi month passed the volume floor, so the path starts from the Fed's ${Math.floor(S / 12)} projection`)
    if (anchor && fin(LS) && !useMkt) notes.push(`the CPI index for ${monI(e - 12)} is missing, so Kalshi's ${mon(anchor.month)} price is shown but not used`)

    // ── the path: monthly index levels relative to the latest print, out to ten years ──
    const pceFor = y => (sep.has(y) ? sep.get(y) : lr)
    // The Fed path runs from the latest print: the rest of this calendar year at the pace that reaches the
    // Fed's December level, later years at the projected December-over-December rate. With a Kalshi anchor
    // the path follows Kalshi's level to the anchor month and the Fed path's month-to-month pace after it,
    // so Kalshi's news about the price level persists and no Fed annual rate is applied twice.
    const decS = S + (11 - (S % 12)) // the first December at or after the latest print
    const buildPath = ({ w = wedge, med = anchor?.median, yearRate = y => pceFor(y) + w } = {}) => {
      const F = new Map([[S, 1]])
      const base = fin(LS) ? lvl(decS - 12) / LS : null, yS = Math.floor(decS / 12)
      const g = decS > S && fin(base) ? Math.pow((base * (1 + yearRate(yS) / 100)), 1 / (decS - S)) : Math.pow(1 + yearRate(yS) / 100, 1 / 12)
      for (let k = S + 1; k <= S + 120; k++) F.set(k, F.get(k - 1) * (k <= decS ? g : Math.pow(1 + yearRate(Math.floor(k / 12)) / 100, 1 / 12)))
      const end = useMkt ? (lvl(e - 12) * (1 + med / 100)) / LS : null
      const shift = useMkt ? end / F.get(e) : 1
      const rel = i => (i === S ? 1 : i < S ? (fin(LS) ? lvl(i) / LS : null) : useMkt && i <= e ? Math.pow(end, (i - S) / (e - S)) : F.get(i) * shift)
      const segs = []
      for (let k = S + 1; k <= S + 60; k++) {
        const y = Math.floor(k / 12)
        const [key, rate] = useMkt && k <= e ? ['kalshi', (Math.pow(end, 12 / (e - S)) - 1) * 100]
          : k <= decS ? ['rest', (Math.pow(g, 12) - 1) * 100]
          : [sep.has(y) ? `sep${y}` : 'lr', yearRate(y)]
        const s = segs[segs.length - 1]
        if (s && s.key === key) s.to = k; else segs.push({ key, y, from: k, to: k, rate })
      }
      return { rel, segs, shift, fedAt: i => F.get(i) }
    }
    const avgOf = (p, from, to) => (Math.pow(p.rel(to) / p.rel(from), 12 / (to - from)) - 1) * 100
    const P = buildPath()
    const avg5 = avgOf(P, S, S + 60), avg10 = avgOf(P, S, S + 120), avgFwd = avgOf(P, S + 60, S + 120)
    const mktSeg = P.segs.find(s => s.key === 'kalshi')
    const yS = Math.floor(decS / 12)
    const fedRest = decS > S ? (Math.pow(P.fedAt(decS), 12 / (decS - S)) - 1) * 100 : null // the Fed path's pace for the rest of this year
    const mktRate = mktSeg?.rate ?? null
    const k0 = useMkt ? e : S
    const decP = k0 + (11 - (k0 % 12)) // the path's first December at or after the anchor
    const decY = Math.floor(decP / 12)
    const firstYear = decY + 1 // its first whole calendar year
    // what the breakeven leaves once the Kalshi stretch is paid for (only meaningful with a Kalshi anchor)
    const restMonths = useMkt ? S + 60 - e : null
    const pathRest = useMkt ? avgOf(P, e, S + 60) : null
    const beRest = useMkt ? (Math.pow(Math.pow(1 + be5 / 100, 5) / P.rel(e), 12 / restMonths) - 1) * 100 : null

    const gapSigned = avg5 - be5
    const value = Math.abs(gapSigned)
    const above = gapSigned >= 0
    const status = grade(value, { tension: TENSION, contradiction: CONTRADICTION })
    const fwdGap = fin(fwd) ? avgFwd - fwd : null
    const tenGap = fin(be10) ? avg10 - be10 : null

    // ── what the gap carries: the wedge, Kalshi's price, and the pace of disinflation ──
    const caseAt = (name, w, m) => { if (!fin(w)) return null; const a = avgOf(buildPath({ w }), S, S + 60); return { name, w, m, avg: a, gap: a - be5, status: grade(Math.abs(a - be5), { tension: TENSION, contradiction: CONTRADICTION }) } }
    const cases = [
      w20 ? caseAt('the 10-year average wedge', w10?.mean) : null,
      caseAt(`today's headline wedge`, wedgeNow, wm),
      caseAt(`today's core wedge`, coreWedgeNow, cwm),
    ].filter(Boolean)
    const perPoint = useMkt ? avgOf(buildPath({ med: anchor.median + 1 }), S, S + 60) - avg5 : null
    const px = [], py = []
    for (const [i, v] of cpiY) if (i >= PERSIST_FROM * 12 && cpiY.has(i + 12)) { px.push(v); py.push(cpiY.get(i + 12)) }
    let rho = null, rho1 = null
    if (px.length >= 120) {
      const mx = mean(px), my = mean(py)
      let sxy = 0, sxx = 0
      for (let k = 0; k < px.length; k++) { sxy += (px[k] - mx) * (py[k] - my); sxx += (px[k] - mx) ** 2 }
      rho = sxy / sxx
      const qx = [], qy = []
      for (const [i, v] of cpiY) if (i >= PERSIST_FROM * 12 && cpiY.has(i + 1)) { qx.push(v); qy.push(cpiY.get(i + 1)) }
      const qmx = mean(qx), qmy = mean(qy)
      let qxy = 0, qxx = 0
      for (let k = 0; k < qx.length; k++) { qxy += (qx[k] - qmx) * (qy[k] - qmy); qxx += (qx[k] - qmx) ** 2 }
      rho1 = qxy / qxx
    }
    const x0 = (P.rel(decP) / P.rel(decP - 12) - 1) * 100 // the path's 12-month rate at its first December
    const aLR = lr + wedge
    const histRate = y => (y <= decY ? pceFor(y) + wedge : aLR + (x0 - aLR) * Math.pow(rho, y - decY))
    const H = fin(rho) && rho > 0 && rho < 1 && fin(x0) ? buildPath({ yearRate: histRate }) : null
    const avg5h = H ? avgOf(H, S, S + 60) : null
    const statusH = H ? grade(Math.abs(avg5h - be5), { tension: TENSION, contradiction: CONTRADICTION }) : null

    // ── the first December-on-December market after the Kalshi stretch, read only where it is quoted tightly ──
    // (tickers name the close date, year first, so a text sort is chronological; events are fetched one at a
    // time and the first whose rules name a later December is used)
    let yearAhead = null
    try {
      const evs = (await retry(() => ctx.markets.kalshiEvents('KXUSCPIYEAR'))).sort((a, b) => a.event.localeCompare(b.event))
      const after = useMkt ? e : S
      for (const ev of evs.slice(0, 3)) {
        let r = null
        try { r = readEvent(await retry(() => ctx.markets.kalshi(ev.event))) } catch (err) { notes.push(`Kalshi ${ev.event} failed to load (${err.message})`); continue }
        if (r.month && mi(r.month) > after) { yearAhead = r; break }
      }
    } catch (err) { notes.push(`Kalshi year-ahead CPI market unavailable (${err.message})`) }
    const yaM = yearAhead ? mi(yearAhead.month) : null
    const yaPath = yaM != null && yaM <= S + 120 && fin(P.rel(yaM - 12)) ? (P.rel(yaM) / P.rel(yaM - 12) - 1) * 100 : null
    const yaPick = yearAhead?.usable?.length ? [...yearAhead.usable].sort((a, b) => Math.abs(a.p - 0.5) - Math.abs(b.p - 0.5))[0] : null
    const yaBand = yearAhead?.ok ? [yearAhead.median, yearAhead.median]
      : yaPick && yaPick.p > 0.02 && yaPick.p < 0.98 ? SPREADS.map(s => yaPick.strike + s * zOf(yaPick.p)).sort((a, b) => a - b) : null
    const yaLean = !yaBand || !fin(yaPath) ? null : yaBand[0] > yaPath + LEAN_TOL ? 'above' : yaBand[1] < yaPath - LEAN_TOL ? 'below' : 'level'
    if (yearAhead && !yaPick) notes.push(`Kalshi ${yearAhead.event} has no strike above the volume floor and is left out`)

    // ── Polymarket: the next monthly print, as a cross-check on Kalshi (outside the path) ──
    let poly = null
    try {
      const j = await polySearch
      if (j?.error) throw j.error
      const cands = (j?.events || []).map(ev => {
        const d = ev.description || '', mm = d.match(/12-month period ending (\w+) (\d{4})/)
        const fits = /^[a-z]+-inflation-us-annual/.test(ev.slug || '') && !ev.closed && /before seasonal adjustment/i.test(d) && /Consumer Price Index/.test(d) && /one decimal/i.test(d) && mm && MONTHS.includes(mm[1])
        return fits ? { slug: ev.slug, month: `${mm[2]}-${String(MONTHS.indexOf(mm[1]) + 1).padStart(2, '0')}-01` } : null
      }).filter(c => c && mi(c.month) > S).sort((a, b) => a.month.localeCompare(b.month))
      if (cands.length) {
        const pm = await ctx.markets.polymarket(cands[0].slug)
        const r = (pm.volume ?? 0) >= POLY_MIN_VOL ? readPoly(pm) : null
        if (r) poly = { ...r, ...cands[0], volume: pm.volume }
        else notes.push(`Polymarket ${cands[0].slug} is ${(pm.volume ?? 0) < POLY_MIN_VOL ? `below the ${dollarsK(POLY_MIN_VOL)} volume floor` : 'not readable as a ladder'} and is left out`)
      } else notes.push('Polymarket\'s search found no open US CPI event for a month after the latest print, so the next print has no second venue')
    } catch (err) { notes.push(`Polymarket's CPI search is unavailable (${err.message}), so the next print has no second venue`) }

    // ── thresholds, calibrated live: the breakeven against the Cleveland Fed model's expected inflation ──
    const beMon = new Map()
    for (const x of be5s || []) { const k = x.d.slice(0, 7); const a = beMon.get(k) || []; a.push(x.v); beMon.set(k, a) }
    const calib = (cle5 || []).filter(x => beMon.has(x.d.slice(0, 7))).map(x => ({ m: x.d.slice(0, 7), d: mean(beMon.get(x.d.slice(0, 7))) - x.v }))
    const share = t => (calib.length ? Math.round((calib.filter(c => Math.abs(c.d) < t).length / calib.length) * 100) : null)
    const episodes = yearRuns(calib.filter(c => Math.abs(c.d) >= CONTRADICTION).map(c => +c.m.slice(0, 4)))
    const calibFrom = calib[0]?.m?.slice(0, 4)
    const cleNow = lastV(cle5), cleDate = last(cle5)?.d
    const beCle = cleDate && beMon.has(cleDate.slice(0, 7)) ? mean(beMon.get(cleDate.slice(0, 7))) : null
    const cleGap = fin(cleNow) && fin(beCle) ? cleNow - beCle : null // model less that month's average breakeven
    const cleTxt = fin(cleGap) ? `The Cleveland Fed model put five-year expected CPI inflation at ${pct(cleNow, 2)} for ${monI(mi(cleDate))}, ${side(cleGap)} that month's average breakeven` : null

    // ── wording ──
    const sepNow = pceFor(decY), sepNext = pceFor(firstYear)
    const falling = sepNext <= sepNow - 0.3
    const fedMove = `${sepNext < sepNow ? 'drop' : sepNext > sepNow ? 'rise' : 'hold'} to ${pct(sepNext)} PCE inflation in ${firstYear}`
    const nearRate = useMkt ? anchor.median : cpiNow
    const nearTxt = useMkt ? `Kalshi prices 12-month CPI inflation for ${mon(anchor.month)} at ${pct(anchor.median)}` : `CPI inflation is ${pct(cpiNow)} over the 12 months to ${monI(cpiLast)}`
    const coreLow = fin(coreCpiNow) && coreCpiNow < cpiNow - 0.5
    // The headline states the wedge assumption briefly. "Keeps running" only when today's gap is at
    // or above its average; otherwise the grade rests on the gap returning, and the headline says so.
    const wedgeShort = fin(wedgeNow) && wedgeNow < wedge - 0.1
      ? `if the gap between CPI and PCE returns to its ${wedgeYears}-year average of ${wedge >= 0 ? '+' : '−'}${pts(wedge)} (${wedgeNow >= 0 ? '+' : '−'}${pts(wedgeNow)} in ${monI(wm)})`
      : `if CPI keeps running its usual ${pts(wedge)} ${wedge >= 0 ? 'above' : 'below'} PCE`
    const headline = status === 'consistent'
      ? `${nearTxt} against a ${pct(be5, 2)} 5-year breakeven; the Fed's projected ${fedMove} ${falling ? 'brings' : 'puts'} the five-year average ${falling ? 'down ' : ''}to ${pct(avg5, 2)}, ${side(gapSigned)} the breakeven, ${wedgeShort}.`
      : above
        ? `${nearTxt} against a ${pct(be5, 2)} 5-year breakeven, and ${falling ? 'even on' : 'on'} the Fed's projected ${fedMove}, five-year average CPI inflation is ${pct(avg5, 2)}, ${pts(gapSigned)} above the breakeven, ${wedgeShort}: the bond market prices ${falling ? 'a faster disinflation than the Fed projects' : 'less inflation than the Fed projects'}, or TIPS are unusually cheap.`
        : `${nearTxt}, ${fin(nearRate) && nearRate < be5 ? 'yet' : 'and'} the 5-year breakeven of ${pct(be5, 2)} sits ${pts(gapSigned)} above the ${pct(avg5, 2)} CPI inflation that ${useMkt ? 'those prices and the Fed path' : 'the Fed path'} average over five years, ${wedgeShort}: bond investors price more inflation, or more inflation risk, than the Fed projects.`

    const polyNote = r => (poly && r && poly.month === r.month
      ? `; Polymarket (${dollarsK(poly.volume)} traded) has the median at ${pct(poly.median, 2)}${r.hi ? ` and ${prob(poly.pAbove(r.hi.label))} above ${pct(r.hi.label)}` : ''}, against Kalshi's ${pct(r.median, 2)}${r.hi ? ` and ${prob(r.hi.p)}` : ''}`
      : '')
    const claims = [
      { label: 'CPI, 12 months', display: pct(cpiNow, 2), kind: 'official', source: 'BLS CPI-U, not seasonally adjusted, as published (FRED CPIAUCNS)', asOf: monI(cpiLast), note: fin(coreCpiNow) ? `core CPI (excluding food and energy) ${pct(coreCpiNow, 2)}` : null },
      { label: 'Core PCE prices, 12 months', display: pct(corePceNow, 2), kind: 'official', source: 'BEA PCE price index excluding food and energy (FRED PCEPILFE)', asOf: monI(corePceLast), note: `headline PCE ${pct(pceNow, 2)}; the Fed's 2% target is on headline PCE` },
    ]
    if (next && next !== anchor) claims.push({ label: `Kalshi: CPI for ${mon(next.month)}, 12 months`, display: next.ok ? `${pct(next.median)} median` : '—', kind: 'market', source: `Kalshi ${next.event}`, asOf: ctx.today, note: next.ok ? `${odds(next)}; ${kContracts(next.volume)} contracts traded${next.closes ? `; published ${day(next.closes)}` : ''}${polyNote(next)}` : `below the volume floor (${next.usable.length} readable strikes)` })
    if (anchor) claims.push({ label: `Kalshi: CPI for ${mon(anchor.month)}, 12 months`, display: `${pct(anchor.median)} median`, kind: 'market', source: `Kalshi ${anchor.event}`, asOf: ctx.today, note: `${odds(anchor)}; ${kContracts(anchor.volume)} contracts traded${polyNote(anchor)}${e % 12 === 11 ? `. The Fed's ${Math.floor(e / 12)} projection, ${pct(pceFor(Math.floor(e / 12)))} PCE, is ${pct(pceFor(Math.floor(e / 12)) + wedge, 2)} in CPI terms at the average wedge` : ''}` })
    if (poly && ![next, anchor].some(r => r?.month === poly.month)) claims.push({ label: `Polymarket: CPI for ${mon(poly.month)}, 12 months`, display: `${pct(poly.median)} median`, kind: 'market', source: `Polymarket ${poly.slug}`, asOf: ctx.today, note: `${dollarsK(poly.volume)} traded; one-decimal buckets read as a ladder` })
    if (yearAhead && yaPick) {
      const read = yearAhead.ok ? `median ${pct(yearAhead.median, 2)}` : `${prob(yaPick.p)} odds of a print above ${pct(yaPick.label)} put the market's median between ${pct(yaBand?.[0], 2)} and ${pct(yaBand?.[1], 2)} at spreads of ${SPREADS[0]} to ${SPREADS[1]} points`
      const lean = yaLean === 'level' ? 'shows no clear lean against it'
        : yaLean ? `leans ${yaLean} it, ${(yaLean === 'above') === above ? 'further from the breakeven than the Fed path' : 'toward the breakeven'}` : null
      claims.push({ label: `Kalshi: CPI for ${mon(yearAhead.month)}, 12 months`, display: yearAhead.ok ? `${pct(yearAhead.median)} median` : `${prob(yaPick.p)} above ${pct(yaPick.label)}`, kind: 'market', source: `Kalshi ${yearAhead.event}`, asOf: ctx.today, note: `${yearAhead.ok ? '' : `thin: ${yearAhead.usable.length} of ${yearAhead.usable.length + yearAhead.skipped} strikes clear the volume floor; `}${read}${fin(yaPath) ? `; the path has ${pct(yaPath, 2)}${lean ? `, so the market ${lean}` : ''}` : ''}` })
    }
    claims.push(
      { label: `Fed projections (SEP median), PCE inflation ${sepYears[0]} to ${sepYears[sepYears.length - 1]}`, display: sepYears.map(y => (fin(sep.get(y)) ? sep.get(y).toFixed(1) : '—')).join(' → ') + '%', kind: 'consensus', source: 'FOMC Summary of Economic Projections, fourth quarter over fourth quarter (FRED PCECTPIMD)', asOf: sepDate, note: `longer run ${pct(lr)}` },
      { label: '5-year breakeven inflation', display: pct(be5, 2), kind: 'market', source: '5-year Treasury yield less the 5-year TIPS yield; TIPS principal rises with CPI (FRED T5YIE)', asOf: beDate, note: fin(be10) ? `the 10-year breakeven is ${pct(be10, 2)}` : null },
      ...(fin(fwd) ? [{ label: '5-year breakeven, five years ahead (5y5y forward)', display: pct(fwd, 2), kind: 'market', source: 'FRED T5YIFR', asOf: last(fwds)?.d, note: 'the inflation priced for years six to ten' }] : []),
      ...(fin(cleNow) ? [{ label: 'Cleveland Fed model: expected CPI inflation, next 5 years', display: pct(cleNow, 2), kind: 'forecast', source: 'Federal Reserve Bank of Cleveland, from Treasury yields, inflation swaps, survey forecasts and inflation data (FRED EXPINF5YR)', asOf: monI(mi(cleDate)), note: fin(cleGap) ? `the breakeven averaged ${pct(beCle, 2)} that month, ${side(-cleGap)} the model; read here as the inflation risk premium less the TIPS liquidity premium` : null }] : []),
    )

    // ── what the near-term prices require ──
    const paceOver = (a, b) => (fin(lvl(a)) && fin(lvl(b)) ? (Math.pow(lvl(b) / lvl(a), 12 / (b - a)) - 1) * 100 : null)
    const pace3 = paceOver(S - 3, S), pace6 = paceOver(S - 6, S)
    const recent = `${pct(cpiNow, 2)} over the 12 months to ${monI(cpiLast)}, ${pct(pace6)} a year over the six months to ${monI(S)} and ${pct(pace3)} over the three`
    const nI = useMkt && next?.ok && next !== anchor ? mi(next.month) : null
    const split = nI != null && nI > S && nI < e && fin(lvl(nI - 12))
    const nRel = split ? (lvl(nI - 12) * (1 + next.median / 100)) / LS : null
    // the rise from one index to the next that a Kalshi price needs: one month as a percent change, longer as an annual pace
    const riseRow = (r, from, to, ratio, then, extra) => (to - from === 1
      ? { label: `CPI rise in ${monI(to)} that Kalshi's ${mon(r.month)} price ${then ? 'then ' : ''}needs`, display: `${ratio >= 1 ? '+' : '−'}${Math.abs((ratio - 1) * 100).toFixed(2)}% in the month`, note: `seasonally adjusted, about ${pct((Math.pow(ratio, 12) - 1) * 100)} at an annual pace${extra}` }
      : { label: `CPI pace for ${span(from + 1, to)} that Kalshi's ${mon(r.month)} price ${then ? 'then ' : ''}needs`, display: `${pct((Math.pow(ratio, 12 / (to - from)) - 1) * 100)} a year`, note: extra.replace(/^; /, '') })
    const nearRows = !useMkt ? [] : split ? [
      riseRow(next, S, nI, nRel, false, `; for a ${pct(next.median, 2)} 12-month rate in ${mon(next.month)}; against ${recent}`),
      riseRow(anchor, nI, e, P.rel(e) / nRel, true, `; ${pct(mktRate)} a year over ${span(S + 1, e)} in all, for a ${pct(anchor.median, 2)} 12-month rate in ${mon(anchor.month)}`),
    ] : [riseRow(anchor, S, e, P.rel(e), false, `; for a ${pct(anchor.median, 2)} 12-month rate in ${mon(anchor.month)}; against ${recent}`)]

    const period = s => (s.from % 12 === 0 && s.to % 12 === 11 ? `${Math.floor(s.from / 12)}` : span(s.from, s.to))
    const segLabel = s => (s.key === 'kalshi' ? `${period(s)}, from Kalshi` : s.key === 'rest' ? (fin(LS) ? `${period(s)}, the Fed path's pace to its December ${s.y} level` : `${period(s)}, Fed ${pct(pceFor(s.y))} + wedge`) : s.key === 'lr' ? `${period(s)}, Fed longer run ${pct(lr)} + wedge` : `${period(s)}, Fed ${pct(pceFor(+s.key.slice(3)))} + wedge`)
    const implied = [
      { label: `CPI-PCE wedge, ${wedgeYears}-year average`, display: pp(wedge, 2), note: `CPI's 12-month rate less PCE's over ${(w20 || w10)?.n} months; 10-year average ${pp(w10?.mean, 2)}; ${monI(wm)} ${pp(wedgeNow, 2)}${fin(coreWedgeNow) ? `, core ${pp(coreWedgeNow, 2)}${cwm !== wm ? ` (${monI(cwm)})` : ''}` : ''}` },
      ...nearRows,
      { label: `CPI path over the breakeven's window, ${span(S + 1, S + 60)}`, display: `${pct(avg5, 2)} a year`, note: P.segs.map(s => `${segLabel(s)}: ${pct(s.rate, 2)}`).join('; ') },
      ...(useMkt ? [{ label: `CPI the breakeven leaves for ${span(e + 1, S + 60)}`, display: `${pct(beRest, 2)} a year`, note: `against ${pct(pathRest, 2)} on the path, once the ${pct(mktRate)} pace for ${span(S + 1, e)} is paid for` }] : []),
      ...(H ? [{ label: "CPI path if disinflation runs at history's pace", display: `${pct(avg5h, 2)} a year`, note: `after ${monI(decP)} the Fed path gives way to history: ${prob(rho)} of the distance from ${pct(x0, 2)} to the Fed's longer-run ${pct(aLR, 2)} (in CPI terms) is left a year later, as on average since ${PERSIST_FROM}. That gives ${pct(histRate(firstYear), 2)} for ${firstYear}, against the Fed path's ${pct(pceFor(firstYear) + wedge, 2)}, and an average ${side(avg5h - be5)} the breakeven; not graded` }] : []),
      ...(fin(fwd) ? [{ label: 'Fed longer run in CPI terms, less the 5y5y forward', display: pp(fwdGap, 2), note: `${pct(avgFwd, 2)} on the path against ${pct(fwd, 2)} priced for years six to ten${fin(be10) ? `; over ten years the path averages ${pct(avg10, 2)} against the ${pct(be10, 2)} 10-year breakeven` : ''}` }] : []),
    ]

    // ── what has to give ──
    const wedgeLow = cases.filter(c => c.m != null && c.w < wedge).sort((a, b) => a.w - b.w)[0] || null
    const wedgeHigh = cases.filter(c => c.w > wedge).sort((a, b) => b.w - a.w)[0] || null
    const caseTxt = c => `at ${c.name} (${pp(c.w, 2)}) the path averages ${pct(c.avg, 2)}, ${side(c.gap)} the breakeven${c.status !== 'consistent' ? `: a ${c.status}${Math.sign(c.gap) !== Math.sign(gapSigned) ? ' the other way' : ''}` : ''}`
    const wedgesToday = `In ${monI(wm)} headline CPI inflation ran ${side(wedgeNow)} PCE's${fin(coreWedgeNow) ? `, and core CPI ${side(coreWedgeNow)} core PCE's` : ''}.`
    const histTxt = H ? ` At history's pace of disinflation the path averages ${pct(avg5h, 2)}, ${side(avg5h - be5)} the breakeven${statusH !== 'consistent' ? ` (a ${statusH})` : ''}.` : ''
    const disinflation = falling
      ? { label: 'The disinflation does not arrive', note: `The path needs PCE inflation to fall from ${pct(sepNow)} in ${decY} to ${pct(sepNext)} in ${firstYear}${fin(corePceNow) ? `, with core PCE still at ${pct(corePceNow, 2)}` : ''}.${histTxt} If inflation holds nearer today's pace, the path ${above ? 'pulls further above' : 'rises past'} the breakeven, which then reprices up, and TIPS beat ordinary Treasuries of the same maturity.` }
      : { label: 'Inflation stays above the Fed path', note: `${fin(corePceNow) ? `Core PCE is ${pct(corePceNow, 2)}. ` : ''}If inflation runs above the Fed's ${pct(sepNext)} for ${firstYear}, the breakeven is too low: it reprices up and TIPS beat ordinary Treasuries of the same maturity.${histTxt}` }
    const tipsCheap = { label: 'TIPS are cheap, not inflation low', note: `TIPS trade less often than ordinary Treasuries (they are less liquid), so investors ask a higher yield on them, which pulls the breakeven below expected inflation.${cleTxt ? ` ${cleTxt}${cleGap > 0 ? ', which reads as a liquidity discount larger than the inflation risk premium' : ', so on that model premia do not explain the gap'}.` : ''}` }
    const fasterTxt = useMkt
      ? `CPI averages ${pct(beRest, 2)} a year over ${span(e + 1, S + 60)}, not the ${pct(pathRest, 2)} on the path`
      : `CPI averages ${pct(be5, 2)} over the five years, not the ${pct(avg5, 2)} on the path`
    const gives = status === 'consistent' ? [
      disinflation,
      wedgeLow
        ? { label: 'The CPI-PCE wedge stays below its average', note: `${wedgesToday} The fit assumes the ${pp(wedge, 2)} average returns; ${caseTxt(wedgeLow)}.` }
        : wedgeHigh ? { label: 'The CPI-PCE wedge runs above its average', note: `${wedgesToday} The fit assumes the ${pp(wedge, 2)} average; ${caseTxt(wedgeHigh)}.` } : null,
      { label: 'Inflation falls faster than the Fed projects', note: `${coreLow ? `Core CPI is already ${pct(coreCpiNow, 2)}, so much of today's ${pct(cpiNow, 2)} is food and energy, which can reverse fast. ` : ''}A faster fall leaves the breakeven pricing more inflation than arrives, and ordinary Treasuries beat TIPS of the same maturity.` },
    ].filter(Boolean) : above ? [
      { label: 'Disinflation runs faster than the Fed projects', note: `The breakeven is a fair forecast and ${fasterTxt}.${coreLow ? ` Core CPI is already ${pct(coreCpiNow, 2)}, so much of today's ${pct(cpiNow, 2)} is food and energy, which can reverse fast.` : ''}` },
      tipsCheap,
      disinflation,
      wedgeLow
        ? { label: 'The CPI-PCE wedge stays below its average', note: `${wedgesToday} ${caseTxt(wedgeLow)[0].toUpperCase()}${caseTxt(wedgeLow).slice(1)}.` }
        : { label: 'The CPI-PCE wedge runs below its average', note: `A narrower wedge than the ${pp(wedge, 2)} average turns the same PCE path into less CPI inflation. ${wedgesToday} ${fin(coreWedgeNow) ? 'Neither is' : 'That is not'} narrower than the average, so this would take a reversal.` },
    ] : [
      { label: 'Bond investors pay for inflation insurance', note: `An inflation risk premium lifts the breakeven above expected inflation.${cleTxt ? ` ${cleTxt}${cleGap < 0 ? ', which reads as an inflation risk premium larger than the TIPS liquidity discount' : ', so on that model the premium does not explain the gap'}.` : ''}` },
      { label: 'Inflation stays above the Fed path', note: `The breakeven is a fair forecast: ${useMkt ? `CPI averages ${pct(beRest, 2)} a year over ${span(e + 1, S + 60)}, against ${pct(pathRest, 2)} on the Fed's path` : `CPI averages ${pct(be5, 2)} over the five years, against ${pct(avg5, 2)} on the Fed's path`}${fin(corePceNow) ? `, with core PCE at ${pct(corePceNow, 2)}` : ''}.${histTxt}` },
      wedgeHigh
        ? { label: 'The CPI-PCE wedge runs above its average', note: `A wider wedge than the ${pp(wedge, 2)} average turns the same PCE path into more CPI inflation; ${caseTxt(wedgeHigh)}.` }
        : { label: 'The CPI-PCE wedge widens', note: `A wider wedge than the ${pp(wedge, 2)} average turns the same PCE path into more CPI inflation. ${wedgesToday} ${fin(coreWedgeNow) ? 'Neither is' : 'That is not'} wider than the average.` },
    ]

    const watch = [
      ...(next ? [{ label: `CPI for ${mon(next.month)}`, display: next.ok ? `${pct(next.median)} priced` : '', note: `published ${next.closes ? day(next.closes) : 'mid-month'}; each print moves the Kalshi ladders first` }] : []),
      { label: '5-year breakeven against the path', display: `${pct(be5, 2)} vs ${pct(avg5, 2)}`, note: 'the gap on this card' },
      { label: 'Core CPI and core PCE, 12 months', display: `${pct(coreCpiNow, 2)} / ${pct(corePceNow, 2)}`, note: 'where headline inflation settles once food and energy prices pass through, and which way the CPI-PCE wedge is heading' },
      { label: 'The next Fed projections', display: `${pct(sepNext)} PCE for ${firstYear}`, note: `four a year; a ${above ? 'lower' : 'higher'} number for ${firstYear} would narrow the gap from the Fed's side, a ${above ? 'higher' : 'lower'} one widen it` },
      ...(fin(fwd) ? [{ label: '5y5y forward', display: pct(fwd, 2), note: `long-run anchoring: the Fed's longer-run rate is ${pct(avgFwd, 2)} in CPI terms` }] : []),
    ]

    // the near-term reading: the adjusted 12-month rate against the unadjusted one, a year before the anchor
    const saYoY = useMkt && fin(lvl(e - 24)) ? (lvl(e - 12) / lvl(e - 24) - 1) * 100 : null
    const nsaYoY = useMkt ? cpiY.get(e - 12) : null
    const flips = cases.filter(c => c.status !== status).sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap))
    const math = [
      `Window: TIPS are indexed to CPI with a lag of about three months, so a 5-year breakeven priced on ${day(beDate)} covers CPI from about ${monI(mi(beDate) - 3)} to ${monI(mi(beDate) + 57)}. The path runs 60 months from the latest published index (${monI(S)}) to ${monI(S + 60)}${(off => (off === 0 ? ', the same window' : `, ${months(Math.abs(off))} ${off > 0 ? 'later' : 'earlier'}`))(S - (mi(beDate) - 3))}.`,
      `Wedge: CPI-U's 12-month rate less the PCE price index's, averaged over the last ${(w20 || w10)?.n} months to ${monI(wm)}: ${pp(wedge, 2)}. Over 10 years it is ${pp(w10?.mean, 2)}; in ${monI(wm)} it was ${pp(wedgeNow, 2)} (CPI ${pct(cpiY.get(wm), 2)}, PCE ${pct(pceY.get(wm), 2)})${fin(coreWedgeNow) ? `, and core CPI less core PCE was ${pp(coreWedgeNow, 2)} in ${monI(cwm)}` : ''}.`,
      useMkt
        ? `Near term: ${anchor.event} median ${pct(anchor.median, 2)}, read on the unrounded rate (strikes shifted up ${HALF_TICK} because the contract pays on the one-decimal BLS print). ${mon(anchor.month)} index = ${monI(e - 12)} index ${lvl(e - 12).toFixed(2)} × ${(1 + anchor.median / 100).toFixed(4)} = ${(P.rel(e) * LS).toFixed(2)}; from ${LS.toFixed(2)} in ${monI(S)} that is ${pct(mktRate, 2)} a year over ${months(e - S)}. The seasonally adjusted index keeps part-year seasonal swings out of the pace; the contract settles on the unadjusted 12-month rate${fin(saYoY) && fin(nsaYoY) ? `, and in ${monI(e - 12)} the adjusted and unadjusted 12-month rates differed by ${Math.abs(saYoY - nsaYoY).toFixed(2)} points` : ''}.`
        : `Near term: no Kalshi month could anchor the path, so it starts from the latest published index.`,
      ...(fedRest != null && fin(LS) ? [`Fed path: the Fed's ${yS} projection is read as December over December, ${pct(pceFor(yS))} + ${wedge.toFixed(2)} pp wedge = ${pct(pceFor(yS) + wedge, 2)} in CPI terms on the ${monI(decS - 12)} index; from the ${monI(S)} index that needs ${pct(fedRest, 2)} a year for ${span(S + 1, decS)}. Later years run at the projected rates.${useMkt ? ` Kalshi's ${mon(anchor.month)} level is ${Math.abs((P.shift - 1) * 100).toFixed(2)}% ${P.shift >= 1 ? 'above' : 'below'} the Fed path's for that month; after it the path keeps the Fed path's month-to-month pace, so the difference persists.` : ''}`] : useMkt ? [`Fed path: later years run at the Fed's projected rates; after ${mon(anchor.month)} the path keeps the Fed path's month-to-month pace from Kalshi's level, ${Math.abs((P.shift - 1) * 100).toFixed(2)}% ${P.shift >= 1 ? 'above' : 'below'} the Fed path's for that month.`] : []),
      `Path: ${P.segs.map(s => `${months(s.to - s.from + 1)} at ${pct(s.rate, 2)}`).join(', ')}. Compounded over 60 months: ${pct(avg5, 2)} a year. The Fed's fourth-quarter-over-fourth-quarter rates are applied as December-over-December rates; after the last projected year, the longer-run rate.`,
      `Gap: ${pct(avg5, 2)} − ${pct(be5, 2)} breakeven = ${pp(gapSigned, 2)}. Graded on its size: under ${TENSION.toFixed(1)} pp consistent, ${TENSION.toFixed(1)} to ${CONTRADICTION.toFixed(1)} pp tension, ${CONTRADICTION.toFixed(1)} pp or more contradiction.`,
      ...(useMkt ? [
        `Reverse view: ${pct(be5, 2)} a year for five years, after ${pct(mktRate, 2)} for the first ${e - S === 1 ? "month" : months(e - S)}, leaves ${pct(beRest, 2)} a year for the remaining ${months(restMonths)}, against ${pct(pathRest, 2)} on the path.`,
        `Weight of the near-term prices: Kalshi covers ${e - S} of the 60 months, and 1 point more on its ${mon(anchor.month)} price would move the five-year average by ${pp(perPoint, 2)}, so the average turns mostly on the Fed path and the wedge.`,
      ] : []),
      ...(fin(fwd) || fin(be10) ? [`Beyond year five: the Fed's longer-run ${pct(lr)} + ${wedge.toFixed(2)} pp wedge = ${pct(avgFwd, 2)}${fin(fwd) ? ` against the ${pct(fwd, 2)} 5y5y forward (${pp(fwdGap, 2)})` : ''}.${fin(be10) ? ` Over ten years the path averages ${pct(avg10, 2)} against the ${pct(be10, 2)} 10-year breakeven (${pp(tenGap, 2)}).` : ''}`] : []),
      ...(cases.length ? [`Sensitivity to the wedge: ${cases.map(c => `${c.name} (${pp(c.w, 2)}) gives ${pct(c.avg, 2)}, gap ${pp(c.gap, 2)}, ${c.status}`).join('; ')}.${flips.length ? ` So the grade depends on the wedge returning to its ${wedgeYears}-year average.` : ' The grade is the same at every measured wedge.'}`] : []),
      ...(H ? [`History's pace: the 12-month CPI rate regressed on its own value a year earlier, monthly since ${PERSIST_FROM} (${px.length} pairs), has a slope of ${rho.toFixed(2)}: a year on, ${prob(rho)} of a gap from the mean is left. From the path's ${monI(decP)} rate of ${pct(x0, 2)}, closing in on the Fed's longer-run ${pct(aLR, 2)} in CPI terms at that pace gives ${[firstYear, firstYear + 1, firstYear + 2].map(y => `${pct(histRate(y), 2)} for ${y}`).join(', ')}, and ${pct(avg5h, 2)} over the five years (gap ${pp(avg5h - be5, 2)}, ${statusH}). ${fin(rho1) ? `Compounding the month-to-month slope instead (${rho1.toFixed(3)} a month, ${Math.pow(rho1, 12).toFixed(2)} over twelve) would overstate persistence, because neighbouring 12-month rates share 11 of their months. ` : ''}Not graded.`] : []),
      calib.length
        ? `Thresholds: since ${calibFrom} the 5-year breakeven (monthly average) has sat within ${TENSION.toFixed(1)} pp of the Cleveland Fed model's expected inflation in ${share(TENSION)}% of ${calib.length} months, and within ${CONTRADICTION.toFixed(1)} pp in ${share(CONTRADICTION)}%. That difference is read here as the inflation risk premium less the TIPS liquidity premium, so a gap past ${CONTRADICTION.toFixed(1)} pp is more than premia have explained${episodes ? ` outside ${episodes}` : ''}.`
        : 'Thresholds: the Cleveland Fed series did not load, so the live calibration is missing; the bands stay at 0.5 and 1.0 pp (see the check file).',
      `Kalshi floor: a strike counts with at least ${MIN_STRIKE_VOL.toLocaleString('en-US')} contracts traded and a two-sided quote no wider than ${Math.round(MAX_SPREAD * 100)} cents, priced at the midpoint; a month anchors the path with at least ${MIN_STRIKES} such strikes, ${MIN_EVENT_VOL.toLocaleString('en-US')} contracts between them and a 50% crossing. The median is used rather than the mean because the open tails are thin. A thin year-ahead ladder is read from its one strike nearest 50% at spreads of ${SPREADS[0]} to ${SPREADS[1]} points (year-ahead CPI forecasts have typically missed by roughly a point).`,
      `Polymarket floor: the event must have traded ${dollarsK(POLY_MIN_VOL)}; its one-decimal buckets are scaled to sum to 100%${poly ? ` (they summed to ${Math.round(poly.total * 100)}%)` : ''} and read as a ladder on the unrounded rate. It cross-checks the next print only and does not enter the path.`,
      ...notes.map(n => `Note: ${n}.`),
    ]

    return {
      status, asOf: beDate, headline, claims, implied,
      gap: {
        label: 'CPI path minus the 5-year breakeven', value, display: pp(gapSigned, 2),
        tension: TENSION, contradiction: CONTRADICTION, max: 1.6, tensionLabel: '0.5 pp', contradictionLabel: '1.0 pp',
        note: `${above
          ? `Positive: ${useMkt ? 'the near-term prices and the Fed path add' : 'the Fed path adds'} up to more inflation than the bond market pays for.`
          : `Negative: the bond market pays for more inflation than ${useMkt ? 'the near-term prices and the Fed path add' : 'the Fed path adds'} up to.`} Graded on size, either sign.${flips.length ? ` The grade assumes the CPI-PCE wedge returns to its ${wedgeYears}-year average of ${pp(wedge, 2)}; ${caseTxt(flips[0])}.` : ''}`,
      },
      gives, watch, math,
      sources: [
        { label: 'Kalshi: CPI 12-month rate by month (KXCPIYOY)', url: 'https://kalshi.com/markets/kxcpiyoy' },
        { label: 'Kalshi: December CPI 12-month rate by year (KXUSCPIYEAR)', url: 'https://kalshi.com/markets/kxuscpiyear' },
        ...(poly ? [{ label: `Polymarket: ${mon(poly.month)} US CPI, 12 months`, url: `https://polymarket.com/event/${poly.slug}` }] : []),
        { label: '5-year breakeven inflation (FRED T5YIE)', url: 'https://fred.stlouisfed.org/series/T5YIE' },
        { label: '5-year, 5-year forward inflation expectation (FRED T5YIFR)', url: 'https://fred.stlouisfed.org/series/T5YIFR' },
        { label: 'FOMC SEP median PCE inflation (FRED PCECTPIMD)', url: 'https://fred.stlouisfed.org/series/PCECTPIMD' },
        { label: 'CPI-U, not seasonally adjusted (FRED CPIAUCNS)', url: 'https://fred.stlouisfed.org/series/CPIAUCNS' },
        { label: 'PCE price index (FRED PCEPI)', url: 'https://fred.stlouisfed.org/series/PCEPI' },
        { label: 'Cleveland Fed inflation expectations model (FRED EXPINF5YR)', url: 'https://www.clevelandfed.org/indicators-and-data/inflation-expectations' },
        { label: 'TreasuryDirect: how TIPS are indexed to CPI', url: 'https://www.treasurydirect.gov/marketable-securities/tips/' },
      ],
    }
  },
}
