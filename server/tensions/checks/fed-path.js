// ============================================================================
// FED PATH: where will the Fed be in a year?
// Four prices of one thing, the fed funds target range: Kalshi's meeting-by-
// meeting strike ladders (KXFED), Polymarket's per-meeting decision and
// year-end markets, the Treasury curve (Kim-Wright's split of the 1- and
// 2-year yields into expected short rates and a term premium) and the Fed's
// own Summary of Economic Projections (the median official's year-end rate).
// Each is read as the midpoint of the target range, in the Fed's convention
// (an overnight rate on a 360-day year), and compared only with the others at
// the same meeting or over the same window.
// The Fed projects year ends only, so between two year ends its path is a
// band: anywhere between the two values once a meeting has passed, exact at
// each December meeting. Bonds are a band too. Kim-Wright's expected short
// rate is a Treasury bill rate, and bills yield more than fed funds, so the
// bond reading is shown with and without that spread, measured from the
// 3-month bill against the fed funds path the prediction markets price over
// the same three months (the Fed's own path stands in when the markets do
// not price every meeting in it). Bonds are compared as averages over the
// next 12 months and from 12 to 24 months out, the windows the 1- and 2-year
// yields cover.
// Gap = the widest distance between any two sources at one meeting or window,
// in basis points; a band counts only where it lies wholly apart from another
// source. The figures are expectations, so 25 bp is one full quarter-point
// move in expectation: one source prices a move the other does not (a
// tension). 50 bp is two full moves, a different policy rather than
// different odds (a contradiction). Under 25 bp the sources can still differ
// on the most likely outcome (a 50/50 market sits 12.5 bp from either), so
// the headline says they agree only where the markets' odds center on the
// Fed's own range.
// Thin markets are not graded: a Kalshi meeting counts only when every strike
// from 95% down to 5% has a two-sided quote at most 10¢ wide and the meeting
// has traded 10,000 contracts; a Polymarket event counts from $100k traded.
// Long shots priced at or under the larger of 1¢ and what a Treasury bill
// pays until settlement are dropped before averaging.
// Inputs: Kalshi and Polymarket (public APIs), FRED (target range, SEP,
// Treasury yields and bills, Kim-Wright fitted yields and term premia), the
// Fed's FOMC calendar.
// ============================================================================
import { fin, pct, bp, prob, grade, last, lastV, ladder, mon } from '../lib.js'

const STEP = 0.25 // the Fed moves in quarter points
const QUOTE = 0.1 // widest bid-ask spread (dollars per $1 contract) for a Kalshi strike to count
const TAIL = 0.05 // a Kalshi meeting reads only if tight quotes run unbroken from ≥95% to ≤5%
const KALSHI_MIN = 10000 // contracts traded across a meeting's strikes
// A strike in a thin Kalshi meeting bounds its median only from a bid of 55¢ or more (an offer
// of 45¢ or less) with the other side within 20¢, the last trade on the same side of 50¢ and
// 1,000 contracts open: one stray bid a cent over 50¢ says little.
const EDGE = 0.05, BOUND_SPREAD = 0.2, BOUND_OI = 1000
const POLY_MIN = 100000 // dollars traded on a Polymarket event
// A long shot is not read as odds when its price is under what a Treasury bill pays until
// settlement: selling it ties up nearly $1 meanwhile, so nobody bids such prices down to zero.
// The floor is that bill yield over the time to settlement, and never under 1¢.
const FLOOR_MIN = 0.01
const KW_STALE = 30 // days before the Kim-Wright decomposition is too old to grade
const BILL_DAYS = 91 // the 3-month bill is a 13-week bill
const GAMMA = 'https://gamma-api.polymarket.com'
// FOMC decision days (the second day of each meeting), from the Fed's calendar at
// https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (read 2026-10-11). Kalshi's
// open KXFED events are merged in, so a year the Fed publishes later counts once Kalshi lists it.
const FOMC = ['2026-01-28', '2026-03-18', '2026-04-29', '2026-06-17', '2026-07-29', '2026-09-16', '2026-10-28', '2026-12-09',
  '2027-01-27', '2027-03-17', '2027-04-28', '2027-06-09', '2027-07-28', '2027-09-15', '2027-10-27', '2027-12-08']
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six']
const FED = "the Fed's path", BONDS = 'bonds net of term premium'

const day = d => (d ? `${MON[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}, ${d.slice(0, 4)}` : '—')
const addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)
// statements come at 2 pm Eastern: 18:00 UTC from March to October, 19:00 in winter
const statementAt = d => Date.parse(`${d}T${[1, 2, 11, 12].includes(+d.slice(5, 7)) ? 19 : 18}:00:00Z`)
// meeting months as prose, the year said once per run of months: "Mar, Apr and Jun 2027"
const and = a => (a.length < 2 ? a.join('') : `${a.slice(0, -1).join(', ')} and ${a[a.length - 1]}`)
const months = dates => {
  const by = {}
  for (const d of dates) (by[d.slice(0, 4)] ||= []).push(MON[+d.slice(5, 7) - 1])
  return and(Object.entries(by).map(([y, ms]) => `${and(ms)} ${y}`))
}
// a rate on the Fed's eighth-point grid prints exactly (4.125%), anything else to two decimals
const onGrid = v => Math.abs(v * 8 - Math.round(v * 8)) < 1e-6
const rate = v => (!fin(v) ? '—' : onGrid(v) ? `${v.toFixed(3)}%` : pct(v, 2))
const span = (lo, hi) => (Math.abs(hi - lo) < 1e-9 ? rate(lo) : `${onGrid(lo) && onGrid(hi) ? lo.toFixed(3) : lo.toFixed(2)}-${rate(hi)}`)
const show = v => span(v.lo, v.hi)
const range = mid => `${(mid - STEP / 2).toFixed(2)}-${(mid + STEP / 2).toFixed(2)}%`
const p3 = v => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(3)}%`, p4 = v => `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(4)}%`
const signed = (v, dp = 2) => (fin(v) ? `${v < 0 ? '−' : '+'} ${Math.abs(v).toFixed(dp)}` : '—')
const quarter = n => (n === 1 ? 'a quarter point' : `${WORDS[n] || n} quarter points`)
const usdK = v => (fin(v) ? (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1000)}k`) : '—')
const num = v => (fin(v) ? Math.round(v).toLocaleString('en-US') : '—')
const valueOn = (s, d) => { let v = null; for (const x of s || []) if (x.d <= d) v = x.v; return v }
const cents = v => `${Math.round(v * 100)}¢`

// conventions: fed funds is an overnight rate on a 360-day year; Kim-Wright yields are continuously
// compounded on 365 days; the 3-month bill (FRED DTB3) is quoted on a discount basis. All in percent.
const ffToCc = r => 36500 * Math.log(1 + r / 36000)
const ccToFf = x => 36000 * (Math.exp(x / 36500) - 1)
const billCc = (d, t) => (-36500 / t) * Math.log(1 - (d * t) / 36000)

// SEP medians are midpoints of quarter-point ranges (4.125) published to one decimal (4.1);
// a value within 0.05 of a grid point is read as that point, anything else is kept as published
const snap = v => { const g = Math.round((v - STEP / 2) / STEP) * STEP + STEP / 2; return Math.abs(g - v) <= 0.05 ? g : v }

// The Fed's path as a band [lo, hi] on day d (after any decision that day): the target range's
// history before today; then today's midpoint, and each projected year's median from that year's
// December meeting (or its last day, for a year the calendar does not reach yet). Between two
// knots the projections are silent, so once a meeting has passed the rate may sit anywhere between
// the two values; before that meeting it is still the earlier one. Past the end of the known
// calendar a meeting is assumed to have passed. Null beyond the projections.
function fedBand({ medians, mid0, today, calendar, midOn }) {
  const decOf = y => calendar.find(d => d.startsWith(`${y}-12`)) || `${y}-12-31`
  const calEnd = calendar[calendar.length - 1] || today
  const knots = [[today, mid0], ...Object.keys(medians).map(Number).sort((a, b) => a - b).map(y => [decOf(y), medians[y]]).filter(([d]) => d > today)]
  return d => {
    if (d < today) { const v = midOn(d); return fin(v) ? [v, v] : null }
    for (let i = 0; i < knots.length; i++) {
      const [d0, v0] = knots[i], next = knots[i + 1]
      if (!next) return i > 0 && d >= d0 && d.slice(0, 4) === d0.slice(0, 4) ? [v0, v0] : null
      if (d >= d0 && d < next[0]) {
        const moved = d > calEnd || calendar.some(m => (i === 0 ? m >= d0 : m > d0) && m <= d)
        return moved ? [Math.min(v0, next[1]), Math.max(v0, next[1])] : [v0, v0]
      }
    }
    return null
  }
}
// a band's day-by-day average over n days from a
const avgOver = (a, n, f) => {
  let lo = 0, hi = 0
  for (let i = 0; i < n; i++) { const r = f(addDays(a, i)); if (!r) return null; lo += r[0]; hi += r[1] }
  return [lo / n, hi / n]
}

// probability-weighted mean and most likely outcome, after dropping outcomes at or under the floor
function weigh(rows, floor) {
  const ok = rows.filter(r => fin(r.v) && fin(r.p) && r.p > floor + 1e-9)
  const tot = ok.reduce((a, r) => a + r.p, 0)
  if (ok.length < 2 || tot < 0.85 || tot > 1.2) return null
  const out = ok.map(r => ({ ...r, p: r.p / tot })).sort((a, b) => a.v - b.v)
  let c = 0
  const median = out.find(r => (c += r.p) >= 0.5 - 1e-9)
  return { mean: out.reduce((a, r) => a + r.v * r.p, 0), mode: out.reduce((a, r) => (r.p > a.p ? r : a)), median, rows: out }
}

// ── Kalshi: one meeting's "Above X%" ladder ─────────────────────────────────
// The contract rules (rules_primary) resolve on the UPPER bound of the target
// range after the meeting. Outcomes sit a quarter point apart, so the bucket
// between two strikes holds one outcome, and lib.ladder's bucket midpoint is
// that outcome's range midpoint: weighting the buckets gives the expected
// midpoint of the target range (the open tails sit half a step out).
function readMeeting(ev, floor) {
  const rows = (ev.markets || []).filter(m => fin(m.strike)).sort((a, b) => a.strike - b.strike)
  const tight = m => fin(m.bid) && fin(m.ask) && m.ask - m.bid <= QUOTE + 1e-9
  const runs = []
  let cur = []
  for (const m of rows) {
    if (!tight(m)) { cur = []; continue }
    if (cur.length && Math.abs(m.strike - cur[cur.length - 1].strike - STEP) > 1e-6) cur = []
    if (!cur.length) runs.push(cur)
    cur.push({ strike: m.strike, p: (m.bid + m.ask) / 2, volume: m.volume || 0 })
  }
  const volume = rows.reduce((a, m) => a + (m.volume || 0), 0)
  const upperBound = rows.length > 0 && rows.every(m => /upper bound/i.test(m.rules || ''))
  const out = { event: ev.event, date: ev.date, volume, strikes: rows.length, tight: rows.filter(tight).length, rows }
  if (rows.length && !upperBound) return { ...out, bad: true, why: 'the contract rules no longer say they settle on the upper bound' }
  const run = runs.find(r => r.length >= 3 && Math.max(...r.map(x => x.p)) >= 1 - TAIL && Math.min(...r.map(x => x.p)) <= TAIL)
  if (!run) return { ...out, why: `${out.tight} of ${out.strikes} strikes quoted within 10¢` }
  if (volume < KALSHI_MIN) return { ...out, why: `${num(volume)} contracts traded` }
  const L = ladder(run)
  const buckets = L && Math.abs(L.step - STEP) < 1e-6 ? L.buckets.map(b => ({ v: b.mid, p: b.p })) : null
  const w = buckets && weigh(buckets, floor)
  return w ? { ...out, readable: true, ...w, mean0: weigh(buckets, 0)?.mean } : { ...out, why: 'the ladder could not be read' }
}

// What firm quotes alone say about a meeting too thin to read: a bid of 55¢ or more on "above K"
// means every price between bid and offer gives better than even odds of an upper bound above K,
// so the median midpoint is at least K + 0.125; an offer of 45¢ or less puts it at most K − 0.125.
function bounds(m) {
  let lo = null, hi = null, loQ = null, hiQ = null
  for (const r of m.rows) {
    if (!fin(r.bid) || !fin(r.ask) || !fin(r.last) || r.ask - r.bid > BOUND_SPREAD + 1e-9 || (r.openInterest || 0) < BOUND_OI) continue
    if (r.bid >= 0.5 + EDGE - 1e-9 && r.last > 0.5 && (lo == null || r.strike + STEP / 2 > lo)) { lo = r.strike + STEP / 2; loQ = r }
    if (r.ask <= 0.5 - EDGE + 1e-9 && r.last < 0.5 && r.last > 0 && (hi == null || r.strike - STEP / 2 < hi)) { hi = r.strike - STEP / 2; hiQ = r }
  }
  return { lo, hi, loQ, hiQ }
}

async function kalshiSide(ctx) {
  const events = (await ctx.markets.kalshiEvents('KXFED')).filter(e => e.date).map(e => ({ ...e, date: e.date.slice(0, 10) }))
  const books = await Promise.all(events.map(e => ctx.markets.kalshi(e.event).then(k => ({ ...k, date: e.date }))
    .catch(err => ({ event: e.event, date: e.date, error: err.message, markets: [] }))))
  return { calendar: events.map(e => e.date), books }
}

// ── Polymarket ──────────────────────────────────────────────────────────────
// Events are found through public search rather than hardcoded slugs, so a
// closed or renamed event simply drops out. Each is kept only while its own
// description says what this check assumes: decision markets settle on the
// change in the UPPER bound at one meeting versus its level before (the 50+ bp
// buckets counted as 50); year-end markets on the upper bound after the
// December meeting (open-ended outcomes counted at their edge).
const etDay = iso => new Date(Date.parse(iso) - 6 * 3600e3).toISOString().slice(0, 10)
const moveOf = label => {
  if (/no change/i.test(label)) return 0
  const m = String(label).match(/(\d+)\+?\s*bps?\s*(decrease|increase|cut|hike)/i)
  return m ? ((/decrease|cut/i.test(m[2]) ? -1 : 1) * +m[1]) / 100 : null
}

async function polymarketSide(ctx) {
  const search = q => ctx.fetchJson(`${GAMMA}/public-search?q=${encodeURIComponent(q)}&limit_per_type=20&events_status=active`).then(j => j.events || [])
  const errors = []
  const safe = q => search(q).catch(e => { errors.push(`search "${q}": ${e.message}`); return [] })
  const [dec, eoy] = await Promise.all([safe('Fed decision in'), safe('Fed rate be at the end of')])
  const decisions = dec.filter(e => /^fed decision in [a-z]+\??$/i.test((e.title || '').trim()) && !e.closed && e.endDate)
    .map(e => ({ slug: e.slug, date: etDay(e.endDate), why: /upper bound/i.test(e.description || '') && /changed by versus the level it was prior/i.test(e.description || '') ? null : 'its rules no longer say it settles on the change in the upper bound' }))
    .sort((a, b) => a.date.localeCompare(b.date))
  const yearEnds = eoy.filter(e => !e.closed && /fed rate be at the end of \d{4}/i.test(e.title || ''))
    .map(e => ({ slug: e.slug, year: +e.title.match(/end of (\d{4})/i)[1], why: /upper bound/i.test(e.description || '') && /after the December/i.test(e.description || '') ? null : 'its rules no longer say it settles on the upper bound after the December meeting' }))
  const load = x => (x.why ? Promise.resolve(x) : ctx.markets.polymarket(x.slug).then(ev => ({ ...x, ev, volume: ev.volume })).catch(err => ({ ...x, error: err.message })))
  const [d, y] = await Promise.all([Promise.all(decisions.map(load)), Promise.all(yearEnds.map(load))])
  return { decisions: d, yearEnds: y, error: errors.join('; ') || null }
}

export default {
  id: 'fed-path',
  domain: 'economy',
  order: 1,
  title: 'Where will the Fed be in a year?',
  question: 'Do prediction markets, the bond market and the Fed itself agree on where interest rates are going?',
  see: 'Charts: U.S. Economy → Rates & Fed → Treasuries & mortgages (the yield curve, policy rates and the 10-year term premium); Forecasts → Rates & Inflation (live prediction-market Fed odds).',
  async compute(ctx) {
    const today = ctx.today
    const F = (id, n) => ctx.fred(id, n).catch(() => null)
    const [[tu, tl, effr, md, lr, ctl, cth, dgs1, dgs2, dtb3, y1, y2, tp1, tp2, y5, tp5, y10, tp10], kal, poly] = await Promise.all([
      Promise.all([F('DFEDTARU', 500), F('DFEDTARL', 500), F('DFF', 10), F('FEDTARMD', 10), F('FEDTARMDLR', 2), F('FEDTARCTL', 10), F('FEDTARCTH', 10),
        F('DGS1', 30), F('DGS2', 30), F('DTB3', 10), F('THREEFY1', 10), F('THREEFY2', 10), F('THREEFYTP1', 10), F('THREEFYTP2', 10),
        F('THREEFY5', 10), F('THREEFYTP5', 10), F('THREEFY10', 10), F('THREEFYTP10', 10)]),
      kalshiSide(ctx).catch(e => ({ error: e.message, books: [], calendar: [] })),
      polymarketSide(ctx).catch(e => ({ error: e.message, decisions: [], yearEnds: [] })),
    ])
    if (!tu?.length || !tl?.length || !md?.length) throw new Error('FRED target range or SEP medians unavailable')

    // ── the calendar, and whether FRED has caught up with the last decision ──
    // (for a few hours after a statement the resolved markets are gone but FRED still shows the
    // old range; measuring the remaining markets from it would be off by the move just made)
    const near = (a, b) => Math.abs(daysBetween(a, b)) <= 3
    const calendar = [...FOMC, ...(kal.calendar || []).filter(k => !FOMC.some(d => near(d, k)))].sort()
    for (const b of kal.books || []) b.date = calendar.find(d => near(d, b.date)) || b.date
    const decided = d => Date.now() >= statementAt(d)
    const lastDecided = calendar.filter(decided).pop()
    if (lastDecided && last(tu).d < addDays(lastDecided, 1)) throw new Error(`the Fed decided on ${day(lastDecided)} and FRED's target range (dated to ${day(last(tu).d)}) has not caught up yet; the check waits rather than measure markets from the old range`)
    const pending = calendar.filter(d => !decided(d))
    const decOf = y => calendar.find(d => d.startsWith(`${y}-12`)) || null

    // ── today and the Fed's own path ──
    const upper = lastV(tu), lower = lastV(tl), mid0 = (upper + lower) / 2
    const midOn = d => { const u = valueOn(tu, d), l = valueOn(tl, d); return fin(u) && fin(l) ? (u + l) / 2 : null }
    let changed = null
    for (let i = tu.length - 1; i > 0; i--) if (tu[i].v !== tu[i - 1].v) { changed = { d: tu[i].d, from: tu[i - 1].v }; break }
    const medians = {}, published = {}
    for (const x of md) { const y = +x.d.slice(0, 4); published[y] = x.v; medians[y] = snap(x.v) }
    const sepDate = last(lr)?.d || null, sepLR = lastV(lr)
    const sepDay = sepDate ? `${MON[+sepDate.slice(5, 7) - 1]} ${+sepDate.slice(8, 10)}` : 'latest'
    const sepAge = sepDate ? Math.round(daysBetween(sepDate, today) / 7) : null
    const fedAt = fedBand({ medians, mid0, today, calendar, midOn })
    // the next SEP comes with the next March, June, September or December meeting
    const nextSep = pending.find(d => d > (sepDate || today) && [3, 6, 9, 12].includes(+d.slice(5, 7))) || null
    const yearAhead = addDays(today, 365), ctYear = +yearAhead.slice(0, 4)
    const billRate = lastV(dtb3)
    const floorFor = d => Math.max(FLOOR_MIN, fin(billRate) && d ? ((billRate / 100) * Math.max(0, daysBetween(today, d))) / 365 : 0)

    // ── comparison points: one per meeting, plus the two bond windows ──
    const points = new Map()
    const addMeeting = (date, src, v) => {
      if (!fin(v)) return
      if (!points.has(date)) points.set(date, { date, label: `after the ${day(date)} meeting`, vals: [] })
      points.get(date).vals.push({ src, lo: v, hi: v })
    }

    // Kalshi
    const meetings = (kal.books || []).filter(b => !decided(b.date))
      .map(b => (b.error ? { event: b.event, date: b.date, error: b.error, rows: [], why: b.error } : readMeeting(b, floorFor(b.date))))
    const nearest = (list, d) => list.reduce((a, m) => (!a || Math.abs(daysBetween(m.date, d)) < Math.abs(daysBetween(a.date, d)) ? m : a), null)
    const kDec = meetings.find(m => +m.date.slice(5, 7) === 12)
    const kYear = nearest(meetings, yearAhead)
    const readable = meetings.filter(m => m.readable)
    for (const m of readable) addMeeting(m.date, 'Kalshi', m.mean)
    const kFar = readable[readable.length - 1] || null
    // thin meetings after the last readable one, through the December after the year-ahead date
    const horizon = pending.find(d => d >= yearAhead && +d.slice(5, 7) === 12) || addDays(yearAhead, 60)
    const thin = meetings.filter(m => !m.readable && !m.error && !m.bad && m.date > (kFar?.date || today) && m.date <= horizon).map(m => {
      const b = bounds(m), s = fedAt(m.date)
      const dev = !s ? 0 : fin(b.lo) && b.lo > s[1] + 1e-6 ? b.lo - s[1] : fin(b.hi) && b.hi < s[0] - 1e-6 ? b.hi - s[0] : 0
      return { ...m, ...b, sep: s, dev, q: dev > 0 ? b.loQ : b.hiQ }
    })
    const leanUp = thin.filter(m => m.dev > 0), leanDown = thin.filter(m => m.dev < 0)
    const lean = leanUp.length >= leanDown.length ? leanUp : leanDown
    const leanMax = lean.reduce((a, m) => (!a || Math.abs(m.dev) > Math.abs(a.dev) ? m : a), null)
    const leanQ = leanMax ? Math.max(1, Math.round(Math.abs(leanMax.dev) / STEP)) : 0
    const up = leanMax?.dev > 0
    const edge = m => (m.dev > 0 ? m.lo : m.hi)
    const leanBound = leanMax ? (up ? `${range(leanMax.lo)} or higher` : `${range(leanMax.hi)} or lower`) : null
    const leanSame = leanMax && lean.every(m => Math.abs(edge(m) - edge(leanMax)) < 1e-6)
    const leanQuotes = lean.map(m => `${MON[+m.date.slice(5, 7) - 1]} ${m.date.slice(0, 4)}: ${cents(m.q.bid)} bid, ${cents(m.q.ask)} offer that the upper bound ends ${up ? 'above' : 'at or below'} ${m.q.strike.toFixed(2)}%, ${num(m.q.openInterest)} contracts open`)

    // Polymarket: the chain of decision markets, then the year-end distributions
    for (const x of poly.decisions || []) {
      x.meet = calendar.find(d => near(d, x.date)) || null
      if (!x.ev) continue
      const rows = x.ev.markets.filter(m => !m.closed).map(m => ({ v: moveOf(m.label), p: m.yes }))
      x.dist = weigh(rows, floorFor(x.meet || x.date)); x.dist0 = weigh(rows, 0)
    }
    const chain = []
    let cum = 0, cum0 = 0, chainStop = null
    for (const x of (poly.decisions || []).filter(x => !(x.meet ? decided(x.meet) : x.date < today))) {
      if (!x.meet) { chainStop = `the ${day(x.date)} market matches no meeting on the Fed's published calendar`; break }
      // every scheduled meeting before this one must be in the chain, or the sum would skip a move
      const prev = chain.length ? chain[chain.length - 1].date : null
      const skipped = pending.find(d => (!prev || d > prev) && d < x.meet)
      if (skipped) { chainStop = `no Polymarket market for the ${day(skipped)} meeting`; break }
      if (x.why) { chainStop = `the ${day(x.meet)} market was dropped: ${x.why}`; break }
      if (!x.dist) { chainStop = `the ${day(x.meet)} market could not be read${x.error ? ` (${x.error})` : ''}`; break }
      if ((x.volume || 0) < POLY_MIN) { chainStop = `the ${day(x.meet)} market has traded only ${usdK(x.volume)}`; break }
      cum += x.dist.mean; cum0 += x.dist0?.mean ?? x.dist.mean
      const pr = s => x.dist.rows.filter(r => Math.sign(r.v) === s).reduce((a, r) => a + r.p, 0)
      chain.push({ date: x.meet, step: x.dist.mean, v: mid0 + cum, v0: mid0 + cum0, hike: pr(1), cut: pr(-1), url: x.ev.url })
    }
    for (const c of chain) addMeeting(c.date, 'Polymarket by meeting', c.v)
    const pEnd = chain[chain.length - 1] || null
    const pYears = (poly.yearEnds || []).filter(x => x.year >= +today.slice(0, 4)).sort((a, b) => a.year - b.year)
    for (const x of pYears) {
      x.date = decOf(x.year)
      if (!x.ev) continue
      const rows = x.ev.markets.filter(m => !m.closed).map(m => ({ v: parseFloat(String(m.label).replace(/[^\d.]/g, '')), p: m.yes }))
      x.dist = weigh(rows, floorFor(x.date || `${x.year}-12-31`)); x.dist0 = weigh(rows, 0)
    }
    const pYearLive = pYears.filter(x => x.date && x.dist && !decided(x.date) && (x.volume || 0) >= POLY_MIN)
    const pYearThin = pYears.filter(x => x.ev && (x.volume || 0) < POLY_MIN)
    const pYearOff = pYears.filter(x => x.why || (x.ev && !x.date))
    for (const x of pYearLive) { x.mid = x.dist.mean - STEP / 2; addMeeting(x.date, 'Polymarket year-end', x.mid) }

    // what the prediction markets together price for day d: today's midpoint, then at each meeting
    // the average of the markets that price it; null from the first unpriced meeting (flat: held there)
    const pmAt = d => { const p = points.get(d); return p?.vals.length ? p.vals.reduce((a, v) => a + v.lo, 0) / p.vals.length : null }
    const pmPath = (d, flat) => {
      if (d < today) return midOn(d)
      let v = mid0
      for (const m of pending) { if (m >= d) break; const x = pmAt(m); if (!fin(x)) return flat ? v : null; v = x }
      return v
    }
    const lastPriced = (() => { let p = null; for (const m of pending) { if (!fin(pmAt(m))) break; p = m } return p })()

    // ── the bills-over-fed-funds spread: the 3-month bill against the fed funds path the
    // prediction markets price over the same 91 days, both continuously compounded. When the
    // markets do not price every meeting in those three months, the Fed's own band stands in,
    // which turns the spread into a range. ──
    const bill = (() => {
      const d = last(dtb3)?.d, disc = lastV(dtb3)
      if (!fin(disc)) return null
      const out = { d, disc, mmy: disc / (1 - (disc * BILL_DAYS) / 36000), cc: billCc(disc, BILL_DAYS) }
      const path = Array.from({ length: BILL_DAYS }, (_, i) => pmPath(addDays(d, i)))
      if (path.every(fin)) {
        const ff = path.reduce((a, v) => a + v, 0) / BILL_DAYS
        return { ...out, ff: [ff, ff], ffCc: [ffToCc(ff), ffToCc(ff)], s: [out.cc - ffToCc(ff), out.cc - ffToCc(ff)], by: 'markets' }
      }
      const f = avgOver(d, BILL_DAYS, fedAt)
      if (!f) return { ...out, why: 'neither the prediction markets nor the Fed\'s path cover the next three months' }
      return { ...out, ff: f, ffCc: f.map(ffToCc), s: [out.cc - ffToCc(f[1]), out.cc - ffToCc(f[0])], by: 'fed' }
    })()

    // ── Treasuries. Kim-Wright splits each fitted zero-coupon yield into the average short rate
    // investors expect over its life and a term premium, so the 1-year gives the expected average
    // over the next 12 months and 2 × the 2-year less the 1-year the average from 12 to 24 months out.
    // Those averages are brought forward to the latest Treasury yields, term premia held. ──
    let tsy = null
    const kw = (() => {
      const maps = [y1, y2, tp1, tp2].map(s => new Map((s || []).map(x => [x.d, x.v])))
      for (const x of [...(y2 || [])].reverse()) if (maps.every(m => fin(m.get(x.d)))) return { d: x.d, v: maps.map(m => m.get(x.d)) }
      return null
    })()
    if (kw) {
      const [Y1, Y2, T1, T2] = kw.v
      const both = last((dgs2 || []).filter(x => x.d >= kw.d && fin(valueOn(dgs1, x.d)) && (dgs1 || []).some(z => z.d === x.d)))?.d
      const s0 = both || kw.d
      const moved = s => (both && fin(valueOn(s, s0) - valueOn(s, kw.d)) ? valueOn(s, s0) - valueOn(s, kw.d) : 0)
      const d1 = moved(dgs1), d2 = moved(dgs2)
      const A1 = Y1 - T1, A2 = Y2 - T2, A1n = A1 + d1, A2n = A2 + d2
      tsy = { d: kw.d, s0, Y1, Y2, T1, T2, A1, A2, d1, d2, A1n, A2n, w1: A1n, w2: 2 * A2n - A1n, raw1: Y1 + d1, raw2: 2 * (Y2 + d2) - (Y1 + d1), stale: daysBetween(kw.d, today) > KW_STALE }
      // beyond the year: the average expected over years 6 to 10, as of the Kim-Wright date
      const a5 = valueOn(y5, kw.d) - valueOn(tp5, kw.d), a10 = valueOn(y10, kw.d) - valueOn(tp10, kw.d)
      if (fin(a5) && fin(a10)) tsy.far = 2 * a10 - a5
    }
    // bonds run from the full figure less the widest spread to the full figure (or less the narrowest, if negative)
    const sMax = bill?.s ? Math.max(bill.s[1], 0) : null, sMin = bill?.s ? Math.min(bill.s[0], 0) : null
    const bondBand = w => (fin(sMax) ? [ccToFf(w - sMax), ccToFf(w - sMin)] : null)
    const gradeBonds = tsy && !tsy.stale && fin(sMax)
    const windows = tsy ? [['w1', tsy.w1, tsy.raw1, tsy.s0, 'on average over the next 12 months'], ['w2', tsy.w2, tsy.raw2, addDays(tsy.s0, 365), 'on average from 12 to 24 months out']]
      .map(([key, w, raw, a, label]) => ({ key, w, raw, a, label: `${label} (${mon(a)} to ${mon(addDays(a, 364))})`, band: bondBand(w), rawBand: bondBand(raw), fed: avgOver(a, 365, fedAt) })) : []
    if (gradeBonds) for (const w of windows) points.set(w.key, { date: w.a, window: true, fed: w.fed, label: w.label, vals: [{ src: BONDS, lo: w.band[0], hi: w.band[1] }] })
    const pmW1 = tsy && lastPriced ? avgOver(tsy.s0, 365, d => { const v = pmPath(d, true); return fin(v) ? [v, v] : null }) : null

    // ── the Fed's value at each point, then the distance at each ──
    const graded = []
    for (const p of points.values()) {
      const f = p.window ? p.fed : fedAt(p.date)
      if (f) p.vals.push({ src: FED, lo: f[0], hi: f[1] })
      if (p.vals.length < 2) continue
      p.top = p.vals.reduce((a, v) => (v.lo > a.lo ? v : a)); p.bot = p.vals.reduce((a, v) => (v.hi < a.hi ? v : a))
      p.spread = Math.max(0, p.top.lo - p.bot.hi) * 100
      graded.push(p)
    }
    graded.sort((a, b) => (a.window ? 1 : 0) - (b.window ? 1 : 0) || a.date.localeCompare(b.date))
    if (!graded.length) throw new Error('no market could be matched with the Fed at a common date')
    const worst = graded.reduce((a, p) => (p.spread > a.spread + 1e-9 ? p : a))
    const gap = worst.spread
    const status = grade(gap, { tension: 25, contradiction: 50 })

    // ── wording ──
    const isFed = v => v.src === FED
    const name = src => (src === BONDS ? 'the bond market' : src.startsWith('Polymarket') ? 'Polymarket' : src)
    const who = src => name(src)[0].toUpperCase() + name(src).slice(1)
    const fedV = p => p.vals.find(isFed)
    const decPoint = graded.find(p => !p.window && p.date.slice(5, 7) === '12' && fedV(p) && fedV(p).lo === fedV(p).hi && p.vals.length > 1)
    const decDay = decPoint ? (decPoint.date.slice(0, 4) === today.slice(0, 4) ? `${MON[+decPoint.date.slice(5, 7) - 1]} ${+decPoint.date.slice(8, 10)}` : day(decPoint.date)) : null
    // the markets' median outcome for that December, from the full distributions (Kalshi's ladder, Polymarket's year-end market)
    const decDists = !decPoint ? [] : [
      ...readable.filter(m => m.date === decPoint.date).map(m => ({ src: 'Kalshi', med: m.median.v, p: m.median.p })),
      ...pYearLive.filter(x => x.date === decPoint.date).map(x => ({ src: 'Polymarket', med: x.dist.median.v - STEP / 2, p: x.dist.median.p })),
    ]
    const bondPts = graded.filter(p => p.window)
    const bondWorst = bondPts.reduce((a, p) => (!a || p.spread > a.spread ? p : a), null)
    const bondSide = p => (!p || p.spread < 0.5 ? 0 : isFed(p.top) ? -1 : 1) // bonds below or above the Fed's band
    const leanYears = and([...new Set(lean.map(m => m.date.slice(0, 4)))])
    const leanCount = lean.length
    let headline
    if (status === 'consistent') {
      const bs = bondSide(bondWorst)
      const bondWords = whose => (!bondPts.length ? null : bs === 0
        ? `bonds net of the term premium fit ${whose} path over the next two years`
        : `bonds net of the term premium sit ${Math.round(bondWorst.spread)} bp ${bs < 0 ? 'below' : 'above'} ${whose} path ${bondWorst.label.replace(/ \(.*$/, '')}`)
      let lead = null
      if (decPoint) {
        const f = fedV(decPoint).lo, mk = decPoint.vals.filter(v => !isFed(v)).map(v => v.lo)
        const centered = decDists.length && decDists.every(x => Math.abs(x.med - f) < 1e-6)
        lead = centered
          ? `Markets and the Fed agree on December: the odds center on the Fed's projected ${range(f)} after the ${decDay} meeting`
          : decDists.length
            ? `Markets and the Fed are close on December but differ on the most likely outcome: the Fed projected ${range(f)} after the ${decDay} meeting, while the odds center on ${and(decDists.map(x => `${range(x.med)} (${x.src})`))}`
            : `Markets and the Fed are close on December: markets average ${mk.length > 1 ? `${pct(Math.min(...mk), 2)}-${pct(Math.max(...mk), 2)}` : pct(mk[0], 2)} after the ${decDay} meeting against the Fed's ${rate(f)}`
      } else {
        const p = graded.find(q => !q.window)
        if (p) lead = `Markets and the Fed are close: ${p.label} the markets average ${and(p.vals.filter(v => !isFed(v)).map(show))} against the Fed's path of ${show(fedV(p))}`
      }
      const tail = leanMax && leanCount >= 2
        ? (() => {
          // months carry their year when the meetings span two years, so 'Dec' is never ambiguous
          const multi = new Set(lean.map(m => m.date.slice(0, 4))).size > 1
          const months = and(lean.map(m => `${MON[+m.date.slice(5, 7) - 1]}${multi ? ` ${m.date.slice(0, 4)}` : ''}`))
          return `; Kalshi's firmly quoted ${multi ? '' : `${leanYears} `}meetings (${months}) sit at least ${quarter(leanQ)} ${up ? 'higher' : 'lower'}, though ${multi ? 'those meetings trade' : `${leanYears} trades`} thinly`
        })()
        : ''
      const bw = bondWords("the Fed's")
      headline = lead
        ? `${lead}${bw ? `, and ${bw}` : ''}${tail}.`
        : `${bw[0].toUpperCase()}${bw.slice(1)}${gap < 0.5 ? ', with no gap between them' : `, with a widest gap of ${Math.round(gap)} bp`}; the prediction markets could not be read cleanly this run.`
    } else {
      const fedSide = isFed(worst.top) ? 'hi' : isFed(worst.bot) ? 'lo' : null
      if (fedSide) {
        const mkt = fedSide === 'hi' ? worst.bot : worst.top, fed = fedSide === 'hi' ? worst.top : worst.bot
        const above = fedSide === 'lo'
        const extra = Math.max(1, Math.round(gap / 25))
        headline = `${who(mkt.src)} prices a ${above ? 'higher' : 'lower'} path than the Fed's ${sepDay} projections: ${worst.label} it puts the target range's midpoint at ${show(mkt)}, ${Math.round(gap)} bp ${above ? 'above' : 'below'} the Fed's ${show(fed)}, about ${extra === 1 ? 'one' : WORDS[extra] || extra} full quarter-point move${extra > 1 ? 's' : ''} apart in expectation.`
      } else {
        headline = `The markets disagree with each other more than with the Fed: ${worst.label} ${name(worst.bot.src)} prices the midpoint at ${show(worst.bot)} and ${name(worst.top.src)} at ${show(worst.top)}, ${Math.round(gap)} bp apart, against the Fed's ${fedV(worst) ? show(fedV(worst)) : '—'}.`
      }
    }

    // ── claims ──
    const claims = []
    claims.push({
      label: 'Fed target range today', display: `${lower.toFixed(2)}-${upper.toFixed(2)}%`, kind: 'official', source: 'Federal Reserve (FRED DFEDTARL, DFEDTARU)', asOf: last(tu)?.d,
      note: [`midpoint ${rate(mid0)}`, fin(lastV(effr)) && `effective fed funds rate ${pct(lastV(effr), 2)}`,
        changed && `in effect since ${day(changed.d)}, ${changed.from < upper ? 'up' : 'down'} from ${(changed.from - STEP).toFixed(2)}-${changed.from.toFixed(2)}%`].filter(Boolean).join('; '),
    })
    const yrs = Object.keys(medians).map(Number).sort().filter(y => y >= +today.slice(0, 4))
    const ct = [valueOn(ctl, `${ctYear}-01-01`), valueOn(cth, `${ctYear}-01-01`)]
    claims.push({
      label: `Fed's median projection, end of ${yrs.slice(0, 2).join(' and ')}`, display: yrs.slice(0, 2).map(y => `${published[y]}%`).join(' · '), kind: 'consensus',
      source: 'FOMC Summary of Economic Projections, median official (FRED FEDTARMD)', asOf: sepDate,
      note: [sepDate && `published ${day(sepDate)}, ${sepAge} week${sepAge === 1 ? '' : 's'} ago${nextSep ? `; the next comes with the ${day(nextSep)} meeting` : ''}`,
        `each the midpoint of a quarter-point range, so ${yrs.slice(0, 2).map(y => rate(medians[y])).join(' and ')}`,
        fin(ct[0]) && fin(ct[1]) && `for ${ctYear} most officials (all but the three highest and three lowest) see ${ct[0]}-${ct[1]}%`,
        yrs.length > 2 && `then ${yrs.slice(2).map(y => `${published[y]}% (${y})`).join(', ')}`, fin(sepLR) && `longer run ${sepLR}%`].filter(Boolean).join('; '),
    })
    if (readable.length) claims.push({
      label: `Kalshi: target rate after the ${months(readable.map(m => m.date))} meeting${readable.length > 1 ? 's' : ''}`, display: readable.map(m => pct(m.mean, 2)).join(' · '), kind: 'market',
      source: `Kalshi ${readable.map(m => m.event).join(', ')}: the odds across its "above X%" contracts, averaged`, asOf: today,
      note: `${readable.map(m => `${MON[+m.date.slice(5, 7) - 1]} ${+m.date.slice(8, 10)}: most likely ${range(m.mode.v)} (${prob(m.mode.p)}), ${num(m.volume)} contracts traded`).join('; ')}; the contracts settle on the upper bound of the target range, per their rules`,
    })
    if (kDec && !kDec.readable) claims.push({ label: `Kalshi: target rate after the ${day(kDec.date)} meeting`, display: 'not read', kind: 'market', source: `Kalshi ${kDec.event}`, asOf: today, note: kDec.error ? `could not be fetched: ${kDec.error}` : `not graded: ${kDec.why}` })
    if (kYear && !kYear.readable && kYear !== kDec && thin.length) claims.push({
      label: `Kalshi: ${leanYears || and([...new Set(thin.map(m => m.date.slice(0, 4)))])} meetings`, display: leanMax ? `${up ? '≥' : '≤'} ${rate(up ? leanMax.lo : leanMax.hi)}` : 'too thin', kind: 'market', source: 'Kalshi KXFED order books, firm quotes only', asOf: today,
      note: `not graded: too thin to read in full (the ${day(kYear.date)} meeting, a year out: ${kYear.why})${leanMax
        ? `. Firm quotes put the median ${leanSame ? `at ${leanBound}` : `${up ? 'above' : 'below'} the Fed's path`} after the ${months(lean.map(m => m.date))} meeting${lean.length > 1 ? 's' : ''}, at least ${quarter(leanQ)} ${up ? 'above' : 'below'} the Fed's path (${leanQuotes.join('; ')}). Small markets: a lean, not a price`
        : '; no firm quote contradicts the Fed\'s path'}`,
    })
    for (const x of pYearLive) claims.push({
      label: `Polymarket: target rate at the end of ${x.year}`, display: pct(x.mid, 2), kind: 'market', source: 'Polymarket year-end market, the odds across its outcomes averaged', asOf: today,
      note: `most likely ${range(x.dist.mode.v - STEP / 2)} (${prob(x.dist.mode.p)}); ${usdK(x.volume)} traded; settles on the upper bound after the December meeting, per its rules`,
    })
    if (pEnd) claims.push({
      label: `Polymarket: target rate after the ${day(pEnd.date)} meeting`, display: pct(pEnd.v, 2), kind: 'market', source: `Polymarket decision markets, one per meeting (${chain.length})`, asOf: today,
      note: `today's midpoint plus each meeting's expected move: ${chain.map(c => `${MON[+c.date.slice(5, 7) - 1]} ${bp(c.step * 100)} (${[c.hike >= 0.005 && `${prob(c.hike)} hike`, c.cut >= 0.005 && `${prob(c.cut)} cut`].filter(Boolean).join(', ') || 'hold'})`).join(', ')}${chainStop ? `; the chain stops there because ${chainStop}` : ''}`,
    })
    else if (chainStop) claims.push({ label: 'Polymarket: decision markets', display: 'not read', kind: 'market', source: 'Polymarket decision markets', asOf: today, note: `not graded: ${chainStop}` })
    if (fin(lastV(dgs2))) claims.push({
      label: '2-year Treasury yield', display: pct(lastV(dgs2), 2), kind: 'market', source: 'U.S. Treasury constant maturity (FRED DGS2); split by Kim-Wright, a Federal Reserve Board model', asOf: last(dgs2)?.d,
      note: tsy
        ? `Kim-Wright (${day(tsy.d)}) splits the 2-year zero-coupon yield, ${pct(tsy.Y2, 2)}, into ${pct(tsy.A2, 2)} of expected short-term rates and a ${pct(tsy.T2, 2)} term premium, the extra yield for tying money up for two years instead of rolling over bills; the 1-year: ${pct(tsy.A1, 2)} and ${pct(tsy.T1, 2)}${tsy.s0 > tsy.d ? `. Since then the 1-year yield has moved ${bp(tsy.d1 * 100)} and the 2-year ${bp(tsy.d2 * 100)}, which moves the bond reading for the next 12 months by ${bp(tsy.d1 * 100)} and for 12 to 24 months out by ${bp((2 * tsy.d2 - tsy.d1) * 100)}; both are brought forward to ${day(tsy.s0)}` : ''}${tsy.stale ? `. That split is over ${KW_STALE} days old, so bonds are not graded` : ''}`
        : 'the Kim-Wright term premium is unavailable, so bonds are not graded',
    })
    if (bill) claims.push({
      label: '3-month Treasury bill', display: pct(bill.disc, 2), kind: 'market', source: 'Secondary market, discount basis (FRED DTB3)', asOf: bill.d,
      note: bill.s ? `${pct(bill.mmy, 2)} as a money-market yield; ${(bill.s[1] - bill.s[0] < 0.0005 ? bp(bill.s[0] * 100) : `${bp(bill.s[0] * 100)} to ${bp(bill.s[1] * 100)}`)} over the fed funds rate ${bill.by === 'markets' ? 'the prediction markets price' : "on the Fed's own path (the prediction markets do not price every meeting in those months)"} for the same three months (continuously compounded), the extra yield Treasury bills carry over fed funds` : `not used: ${bill.why}`,
    })

    // ── implied ──
    const implied = graded.map(p => ({
      label: p.label[0].toUpperCase() + p.label.slice(1), display: `${Math.round(p.spread)} bp apart`,
      note: p.vals.map(v => `${v.src} ${show(v)}${v.src === BONDS ? ' (with and without the bills-over-fed-funds spread)' : isFed(v) && v.lo !== v.hi ? (p.window ? ' (averaged)' : ' (the projections give year ends only)') : ''}`).join(', ')
        + (p === points.get('w1') ? (pmW1 ? `; prediction markets ${pct(pmW1[0], 2)} if the rate holds after the ${day(lastPriced)} meeting (context, not graded)` : '') : ''),
    }))
    if (tsy && fin(sMax)) implied.push({ label: 'Bonds with no term premium', display: `${show({ lo: windows[0].rawBand[0], hi: windows[0].rawBand[1] })} · ${show({ lo: windows[1].rawBand[0], hi: windows[1].rawBand[1] })}`, note: `the next 12 months and 12 to 24 months out if the whole yield were expected policy, against the Fed's ${windows[0].fed ? span(...windows[0].fed) : '—'} and ${windows[1].fed ? span(...windows[1].fed) : '—'}; context only, since the term premium is a model estimate` })
    if (fin(tsy?.far) && fin(sepLR)) {
      const fb = fin(sMax) ? [ccToFf(tsy.far - sMax), ccToFf(tsy.far - sMin)] : [ccToFf(tsy.far), ccToFf(tsy.far)]
      implied.push({ label: 'Beyond the next two years: bonds, 6 to 10 years out', display: span(...fb), note: `against the Fed's longer-run ${sepLR}% (${bp((fb[0] - sepLR) * 100)} to ${bp((fb[1] - sepLR) * 100)}), as of ${day(tsy.d)}; context only, the grade covers the next two years` })
    }

    // ── what gives ──
    const gives = []
    const tpGive = (side, w) => ({ label: `The term premium is ${side < 0 ? 'smaller' : 'larger'} than the model says`, note: `Kim-Wright's ${pct(tsy.T2, 2)} on the 2-year is a model estimate, not a price. ${side < 0 ? `A smaller one means a higher expected path than shown: with none, bonds would price ${show({ lo: w.rawBand[0], hi: w.rawBand[1] })} ${w.label.replace(/ \(.*$/, '')}, against the Fed's ${span(...w.fed)}` : 'A larger one means a lower expected path than shown, closer to the Fed\'s'}.` })
    if (status === 'consistent') {
      gives.push({ label: 'Nothing has to give yet', note: gap < 0.5 ? 'Every source that can be read cleanly overlaps the others at the same meeting or over the same window.' : `Every source that can be read cleanly sits within ${Math.round(gap)} bp of the others at the same meeting or over the same window, less than one full quarter-point move in expectation.` })
      if (leanMax) gives.push({ label: `Kalshi's ${leanYears} quotes are right`, note: `If the ${months(lean.map(m => m.date))} order books are informed rather than merely thin, traders expect a ${up ? 'higher' : 'lower'} path than the Fed projects, and either the ${nextSep ? day(nextSep) : 'next'} projections or the cleaner markets have to move.` })
    } else if (isFed(worst.top) || isFed(worst.bot)) {
      const above = isFed(worst.bot), mkt = above ? worst.top : worst.bot, fed = above ? worst.bot : worst.top
      gives.push({ label: `The Fed ${above ? 'raises' : 'lowers'} its projections`, note: `${nextSep ? `The ${day(nextSep)} projections` : 'The next projections'} move the median toward ${show(mkt)}; the ${sepDay} projections are ${sepAge} weeks old, and data since may already have changed minds.` })
      gives.push({ label: `${who(mkt.src)} comes ${above ? 'down' : 'up'} to the Fed's path`, note: `Inflation and jobs data in line with the Fed's own projections would pull ${name(mkt.src)} back toward ${show(fed)}.` })
      if (mkt.src === BONDS) gives.push(tpGive(above ? 1 : -1, windows.find(w => w.key === (worst === points.get('w1') ? 'w1' : 'w2'))))
    } else {
      gives.push({ label: 'One venue is mispriced', note: `${who(worst.bot.src)} and ${name(worst.top.src)} price the same ${worst.window ? 'window' : 'meeting'} ${Math.round(gap)} bp apart; one of them has to move.` })
    }

    // ── watch ──
    const watch = []
    if (nextSep) watch.push({ label: `Fed projections at the ${day(nextSep)} meeting`, display: `${published[ctYear] ?? '—'}% for ${ctYear} now`, note: `whether the ${ctYear} median moves toward the markets` })
    if (leanMax) watch.push({ label: `Kalshi ${months(lean.map(m => m.date))} order books`, display: `median ${leanBound}`, note: 'graded once quotes tighten to 10¢ from 95% down to 5%' })
    for (const x of pYearThin) watch.push({ label: `Polymarket end-of-${x.year} market`, display: `${usdK(x.volume)} traded`, note: `counts from ${usdK(POLY_MIN)}; it settles on the same date as the Fed's end-${x.year} projection` })
    if (tsy && fin(sMax) && windows[0].fed) {
      const r = windows[0].rawBand, f = windows[0].fed, side = r[0] > f[1] ? 'above' : r[1] < f[0] ? 'below' : 'within'
      watch.push({ label: '2-year term premium (Kim-Wright)', display: pct(tsy.T2, 2), note: `a model estimate: if it is too high, bonds price a higher path than shown, up to ${show({ lo: r[0], hi: r[1] })} over the next 12 months with none, ${side} the Fed's ${span(...f)}` })
    }

    // ── the arithmetic ──
    const notRead = [kal.error && `Kalshi (${kal.error})`, poly.error && `Polymarket (${poly.error})`, !tsy && 'the Kim-Wright split',
      tsy && !bill && 'the 3-month bill (FRED DTB3), so the bills-over-fed-funds spread is unknown and bonds are not graded', bill?.why && `the bills-over-fed-funds spread (${bill.why}), so bonds are not graded`,
      ...pYearOff.map(x => `Polymarket end-of-${x.year} (${x.why || `the Fed has not published its December ${x.year} meeting date`})`)].filter(Boolean)
    const floored = [
      ...readable.filter(m => fin(m.mean0) && Math.abs(m.mean0 - m.mean) >= 0.005).map(m => `Kalshi ${MON[+m.date.slice(5, 7) - 1]} ${pct(m.mean0, 2)} to ${pct(m.mean, 2)}`),
      ...pYearLive.filter(x => x.dist0 && Math.abs(x.dist0.mean - x.dist.mean) >= 0.005).map(x => `Polymarket end-${x.year} ${pct(x.dist0.mean - STEP / 2, 2)} to ${pct(x.mid, 2)}`),
      pEnd && Math.abs(pEnd.v0 - pEnd.v) >= 0.005 && `the Polymarket chain ${pct(pEnd.v0, 2)} to ${pct(pEnd.v, 2)}`,
    ].filter(Boolean)
    const fl = [...readable.map(m => floorFor(m.date)), ...chain.map(c => floorFor(c.date)), ...pYearLive.map(x => floorFor(x.date))]
    const flShow = fl.length ? (Math.max(...fl) - Math.min(...fl) < 0.0005 ? cents(fl[0]) : `${(Math.min(...fl) * 100).toFixed(1)}¢ to ${(Math.max(...fl) * 100).toFixed(1)}¢`) : null
    const math = [
      notRead.length && `Not read this run: ${notRead.join('; ')}.`,
      `Every rate here is the midpoint of the Fed's quarter-point target range: ${range(mid0)} today is ${rate(mid0)}. Kalshi and Polymarket contracts settle on the upper bound, so the midpoint is the upper bound less 0.125.`,
      `Fed path: today's ${rate(mid0)}, then the median official's projection after each December meeting (${yrs.map(y => `${y} ${rate(medians[y])}`).join(', ')}). The projections give year ends only, so between two of them the Fed's path is a band from one year-end value to the next, reached no earlier than the next meeting. Medians are published to one decimal, so 4.1 is read as 4.125 when it sits within 0.05 of a range midpoint.`,
      `Market figures are probability-weighted averages; the Fed's is the median official's projection. The gap compares averages; the headline's "odds centered on" compares the market's median outcome with the Fed's median.`,
      readable.length && `Kalshi: each "Above X%" contract is the chance the upper bound ends above X. Between two strikes a quarter point apart there is one outcome, so the probability-weighted midpoints give the expected midpoint (${readable.map(m => `${MON[+m.date.slice(5, 7) - 1]} ${pct(m.mean, 2)}`).join(', ')}). A meeting is read only when every strike from 95% down to 5% has a bid and offer at most 10¢ apart and ${num(KALSHI_MIN)} contracts have traded; ${meetings.length - readable.length} of ${meetings.length} open meetings fail that test.`,
      leanMax && `Thin Kalshi meetings: a bid of 55¢ or more on "above K" means every price between bid and offer gives better than even odds of an upper bound above K, so the median midpoint is at least K + 0.125. A quote counts only with its offer within 20¢, its last trade on the same side of 50¢ and ${num(BOUND_OI)} contracts open. ${lean.map(m => `${MON[+m.date.slice(5, 7) - 1]} ${m.date.slice(0, 4)}: median ${up ? `≥ ${rate(m.lo)}` : `≤ ${rate(m.hi)}`}, Fed ${span(...m.sep)}`).join('; ')}.`,
      pEnd && `Polymarket decision markets: expected move = Σ move × probability over the outcomes (50+ bp counted as 50). Summed through ${day(pEnd.date)}: ${p3(mid0)} ${chain.map(c => `${signed(c.step, 3)}`).join(' ')} = ${p3(pEnd.v)}. Events count from ${usdK(POLY_MIN)} traded.`,
      pYearLive.length && `Polymarket year-end: probability-weighted upper bound (open-ended outcomes at their edge) less 0.125: ${pYearLive.map(x => `${x.year} ${p3(x.dist.mean)} − 0.125 = ${p3(x.mid)}`).join('; ')}.`,
      flShow && `Long shots priced at or under ${flShow} are dropped and the rest scaled to 100%: selling one ties up nearly $1 until settlement, so nobody sells it for less than a Treasury bill pays meanwhile (${fin(billRate) ? pct(billRate, 2) : 'about 4%'} a year), and its price is not odds. The floor is the larger of 1¢ and that bill yield over the time to settlement.${floored.length ? ` Dropping them moves ${and(floored)}.` : ''}`,
      tsy && `Bonds (Kim-Wright, ${day(tsy.d)}, continuously compounded): expected average short rate = zero-coupon yield − term premium. 1-year ${p4(tsy.Y1)} − ${p4(tsy.T1)} = ${p4(tsy.A1)}; 2-year ${p4(tsy.Y2)} − ${p4(tsy.T2)} = ${p4(tsy.A2)}.${tsy.s0 > tsy.d ? ` Brought forward to ${day(tsy.s0)} by the change in the 1- and 2-year Treasury yields since (${bp(tsy.d1 * 100)} and ${bp(tsy.d2 * 100)}), term premia held: ${p4(tsy.A1n)} and ${p4(tsy.A2n)}.` : ''} Next 12 months: ${p4(tsy.w1)}. From 12 to 24 months out: 2 × ${p4(tsy.A2n)} − ${p4(tsy.A1n)} = ${p4(tsy.w2)}.`,
      bill?.s && `Bills over fed funds: the 3-month bill at ${pct(bill.disc, 2)} on a discount basis (${day(bill.d)}) is ${p3(bill.cc)} continuously compounded; ${bill.by === 'markets' ? "the prediction markets' fed funds path" : "the Fed's path (standing in for the prediction markets, which do not price every meeting in those months)"} averages ${span(...bill.ff)} over the same 91 days, ${bill.ffCc[1] - bill.ffCc[0] < 0.0005 ? p3(bill.ffCc[0]) : bill.ffCc.map(p3).join(' to ')} continuously compounded; spread ${bill.s[1] - bill.s[0] < 0.0005 ? p3(bill.s[0]) : bill.s.map(p3).join(' to ')}. Kim-Wright's expected short rate is a bill rate, so bonds are shown from the full figure less the spread to the full figure, then converted to the Fed's 360-day convention: ${windows.filter(w => w.band).map(w => `${p3(w.w)} → ${span(...w.band)}`).join('; ')}.`,
      windows.some(w => w.fed) && `Fed path averaged day by day over the same windows: ${windows.filter(w => w.fed).map(w => `${w.label.replace(/^on average /, '')} ${span(...w.fed)}`).join('; ')}.${pmW1 ? ` Prediction markets over the next 12 months, holding the rate after the ${day(lastPriced)} meeting: ${pct(pmW1[0], 2)}.` : ''}`,
      `Gap: the widest distance between any two sources at one meeting or window, zero where their ranges overlap (${graded.map(p => `${p.label.replace(/ \(.*$/, '')} ${Math.round(p.spread)} bp`).join('; ')}). 25 bp is one full quarter-point move in expectation.`,
    ].filter(Boolean)

    const sources = [
      { label: 'Kalshi: fed funds rate after each FOMC meeting (KXFED)', url: 'https://kalshi.com/markets/kxfed' },
      ...pYearLive.map(x => ({ label: `Polymarket: ${x.ev.title}`, url: x.ev.url })),
      ...chain.map(c => ({ label: `Polymarket: Fed decision, ${MON[+c.date.slice(5, 7) - 1]} ${c.date.slice(0, 4)}`, url: c.url })),
      { label: 'FOMC Summary of Economic Projections (FRED FEDTARMD)', url: 'https://fred.stlouisfed.org/series/FEDTARMD' },
      { label: 'FOMC meeting calendar (Federal Reserve)', url: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm' },
      { label: 'Kim-Wright fitted yields and term premia (Federal Reserve Board)', url: 'https://www.federalreserve.gov/data/three-factor-nominal-term-structure-model.htm' },
      { label: '2-year Treasury constant maturity (FRED DGS2)', url: 'https://fred.stlouisfed.org/series/DGS2' },
      { label: '3-month Treasury bill, discount basis (FRED DTB3)', url: 'https://fred.stlouisfed.org/series/DTB3' },
    ]

    return {
      status,
      asOf: meetings.length || chain.length || pYearLive.length ? today : [last(dgs2)?.d, sepDate].filter(Boolean).sort().pop(),
      headline,
      claims,
      implied,
      gap: {
        label: 'Widest gap between sources at the same meeting or window',
        value: gap, display: `${Math.round(gap)} bp`, tension: 25, contradiction: 50, max: 100, tensionLabel: '25 bp', contradictionLabel: '50 bp',
        note: `${gap < 0.5 ? 'No gap: every source overlaps the others' : `Widest ${worst.label}: ${worst.vals.map(v => `${v.src} ${show(v)}`).join(', ')}`}. 25 bp is one full quarter-point move in expectation; 50 bp, two, is a different policy.`,
      },
      gives,
      watch,
      math,
      sources,
    }
  },
}
