// ============================================================================
// TOP COMPANY ÷ GDP: the market value of the largest US company as a share of
// US nominal GDP, every month since 1962 (credible from 1984-01), with the top
// 5 and top 10 combined. Tano Santos (Columbia, Oct 2026): 2–4% for most of
// history, ~15% now (Nvidia).
//   history     FMP stable/historical-market-capitalization (on the dashboard's
//               plan): daily market cap per candidate, at most 5,000 rows a
//               request (≈20 years), paged back to 1962-01-02, where FMP's
//               history starts. Month value = the month's last trading day;
//               the current month = its latest day.
//   spin-offs   FMP stable/splits. FMP's market-cap history is its adjusted price
//               × shares, and the adjusted price is cut for spin-offs as well as
//               splits, so a parent's value before a spin-off is understated by
//               the spin factor: GE on 1999-12-31 shows $305bn, true $507bn
//               (GE Vernova 1.253 × GE HealthCare 1.281 × Wabtec 1.04). Every
//               splits entry that is not a plain split (type spin-off, or a
//               stock-split whose ratio is not small whole numbers, as FMP files
//               IBM/Kyndryl, Merck/Organon 131/125, Ford/Visteon) multiplies the
//               earlier values back up, unless the history visibly drops by that
//               factor on the day (FMP left that one raw). Checked in Oct 2026
//               against FMP's unadjusted prices: the recorded factors are the
//               whole gap for IBM, GE, AT&T, HP, Merck and Pfizer, and Altria
//               (Kraft 2007, PMI 2008) has no entry and a raw history.
//   glitches    FMP's share counts step at quarter ends and sometimes step back:
//               two opposite moves of 20%+ within 400 days, both on a quarter's
//               last or first trading days, that cancel to within 10%, on a
//               company worth 0.25%+ of GDP, are a share-count glitch and the
//               values between are divided back (Bank of America doubled 2003-12-31 → 2004-06-30,
//               J&J 1999-Q4, JPMorgan 2000-Q2). One-way glitches stay (Pfizer
//               1.65× from 1999-04-05 until its June 2000 merger, Bell Atlantic
//               from 1999-03 until GTE): a few top-10 months run high by them.
//   GDP         FRED GDP (quarterly, SAAR, $bn), placed on each quarter's middle
//               month and linearly interpolated; months after the latest
//               quarter's middle month hold that quarter (no extrapolation).
//               Fallbacks: the dashboard's shared fred-cache.json, then the copy
//               kept in this module's cache.
//   current     FMP stable/company-screener (country US, no ETFs, funds, notes
//               or preferreds, over $150bn): today's top 10 and the current
//               month's values; FMP quote of the leader for the timestamp.
// Candidates: every US company plausibly the largest since 1984 (IBM, Exxon,
// GE, Microsoft, Walmart, Cisco, Intel, Citigroup, Pfizer, Apple, Alphabet,
// Amazon, Nvidia, Meta, Berkshire, J&J, Coca-Cola, Altria, AT&T, Oracle, Tesla,
// Broadcom, Lilly, JPMorgan), the rest of the post-1984 top tens that are still
// listed, and today's top 15 from the screener. A company's share classes are
// one name (GOOG → GOOGL, BRK-A → BRK-B; FMP gives the whole company for each).
// US companies only (no TSMC ADR), as the ratio is to US GDP. Left out: DuPont
// (DD's FMP history runs about a third of the true value before 2019).
// Coverage: FMP has no delisted names. Before 1984 the list lacks the old AT&T
// (the largest company for much of the 1960s) and General Motors, so the leader
// can be wrong and coverageFrom is 1984-01. The top 5 and top 10 are lower
// bounds before about 2002: AT&T Corp, Mobil, Amoco, GM, BellSouth, Lucent, AOL
// Time Warner, MCI WorldCom and Sun were top-ten names then and are missing.
// Anchors: none. No free source with a checkable figure was found (the 1960s
// AT&T and IBM values that circulate are inflation-adjusted, secondary or in
// conflict; CRSP is not free), so nothing is hand-entered.
// Values: caps and GDP in $bn, ratios in % of GDP; stats over coverageFrom on
// (max and pre2015Max carry the symbol as leader, plus leaderName).
// Cadence: stale-while-revalidate. A GET answers from the cache at once; the
// history is re-pulled when over 7 days old (Oct 2026: 200 FMP requests, 52
// symbols, 61 s at ~3 a second), the current month, top 10 and GDP when the
// screener read is over a day old (2 FMP requests, 1 FRED; a top-15 newcomer
// with no history also gets its pull). The first GET with no cache waits for the full
// pull. A failed refresh is retried after 30 minutes. A symbol whose pull
// fails keeps its last months (named in sourceErrors); never a throw once
// anything is cached.
// Files: top-company-gdp.json (root, gitignored; FMP-derived, so untracked):
// the response plus each symbol's monthly values and the GDP quarters.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const FMP = 'https://financialmodelingprep.com/stable/'
const FRED = 'https://api.stlouisfed.org/fred/series/observations'
const MIN = 60e3, DAY = 24 * 60 * MIN
const HISTORY_TTL = 7 * DAY, CURRENT_TTL = DAY, RETRY = 30 * MIN
const START = '1962-01-01', COVERAGE_FROM = '1984-01', PAGE = 5000
const GAP = 300 // ms between FMP requests: ≤ 4 a second
const SCREEN_MIN = 150e9, DYNAMIC_TOP = 15
const fin = v => v != null && Number.isFinite(v)
const r1 = v => (fin(v) ? Math.round(v * 10) / 10 : null), r2 = v => (fin(v) ? Math.round(v * 100) / 100 : null), r4 = v => (fin(v) ? Math.round(v * 1e4) / 1e4 : null)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ym = d => d.slice(0, 7)
const mIndex = m => +m.slice(0, 4) * 12 + (+m.slice(5, 7) - 1)
const mName = i => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`
const gcd = (a, b) => (b ? gcd(b, a % b) : a)
const quantile = (xs, q) => { const v = xs.filter(fin).sort((a, b) => a - b); if (!v.length) return null; const p = (v.length - 1) * q, lo = Math.floor(p); return v[lo] + (v[Math.min(lo + 1, v.length - 1)] - v[lo]) * (p - lo) }

// [symbol, short name, earlier names as [first month of the next name, name], ...]
const CANDIDATES = [
  ['IBM', 'IBM'], ['XOM', 'Exxon Mobil', ['1999-11', 'Exxon']], ['GE', 'GE Aerospace', ['2024-04', 'General Electric']],
  ['MSFT', 'Microsoft'], ['WMT', 'Walmart', ['2018-02', 'Wal-Mart']], ['CSCO', 'Cisco'], ['INTC', 'Intel'],
  ['C', 'Citigroup', ['1998-10', 'Travelers Group']], ['PFE', 'Pfizer'], ['AAPL', 'Apple'], ['GOOGL', 'Alphabet', ['2015-10', 'Google']],
  ['AMZN', 'Amazon'], ['NVDA', 'Nvidia'], ['META', 'Meta', ['2021-11', 'Facebook']], ['BRK-B', 'Berkshire Hathaway'],
  ['JNJ', 'Johnson & Johnson'], ['KO', 'Coca-Cola'], ['MO', 'Altria', ['2003-01', 'Philip Morris']],
  ['T', 'AT&T', ['2005-12', 'SBC Communications']], ['ORCL', 'Oracle'], ['TSLA', 'Tesla'], ['AVGO', 'Broadcom', ['2016-02', 'Avago']],
  ['LLY', 'Eli Lilly'], ['JPM', 'JPMorgan Chase', ['1996-04', 'Chemical Banking'], ['2001-01', 'Chase Manhattan']],
  // the rest of the post-1984 top tens that FMP still lists
  ['MRK', 'Merck'], ['PG', 'Procter & Gamble'], ['BMY', 'Bristol-Myers Squibb', ['1989-10', 'Bristol-Myers']], ['AIG', 'AIG'],
  ['HPQ', 'HP', ['2015-11', 'Hewlett-Packard']], ['VZ', 'Verizon', ['2000-07', 'Bell Atlantic']], ['CVX', 'Chevron', ['1984-07', 'Standard Oil of California']],
  ['BAC', 'Bank of America', ['1998-10', 'NationsBank']], ['WFC', 'Wells Fargo', ['1998-11', 'Norwest']], ['HD', 'Home Depot'],
  ['PEP', 'PepsiCo'], ['F', 'Ford'], ['SLB', 'Schlumberger'], ['MMM', '3M'], ['ABT', 'Abbott'], ['V', 'Visa'], ['MA', 'Mastercard'],
  ['UNH', 'UnitedHealth'], ['QCOM', 'Qualcomm'], ['TXN', 'Texas Instruments'], ['PM', 'Philip Morris International'], ['AMGN', 'Amgen'],
  ['CMCSA', 'Comcast'], ['DIS', 'Disney'], ['ABBV', 'AbbVie'],
]
const STATIC = new Set(CANDIDATES.map(c => c[0]))
const NAMES = new Map(CANDIDATES.map(([s, n, ...was]) => [s, { name: n, was }]))
const SHORT = { SPCX: 'SpaceX', MU: 'Micron', AMD: 'AMD', PLTR: 'Palantir', COST: 'Costco', NFLX: 'Netflix', CAT: 'Caterpillar', LRCX: 'Lam Research', AMAT: 'Applied Materials', MS: 'Morgan Stanley', GS: 'Goldman Sachs', DELL: 'Dell', PANW: 'Palo Alto Networks', CRM: 'Salesforce', NOW: 'ServiceNow' }
const ALIAS = { GOOG: 'GOOGL', 'BRK-A': 'BRK-B' }
const LEFT_OUT = ['DD']
const JUNK = /%|\bnotes?\b|preferred|debenture|\bCDI\b|obligation|\bETF\b|\bfund\b|depositary/i
const cleanName = n => String(n || '').replace(/,?\s+(Incorporated|Inc\.?|Corporation|Corp\.?|Company|Co\.|plc|Ltd\.?|Holdings?)$/i, '').replace(/^The\s+/, '').trim()
function nameAt(sym, m, fallback) {
  const e = NAMES.get(sym)
  if (!e) return SHORT[sym] || cleanName(fallback) || sym
  for (const [until, n] of e.was) if (m < until) return n
  return e.name
}

// a plain split or stock dividend changes FMP's price and share count together
// (market cap unchanged); anything else on the splits list is a price-only cut.
// Plain: a ratio of small whole numbers (50:1, 1:8, 3:2, 21:20), or within 0.15%
// of a usual split ratio (Google's 2014 class C dividend is filed as 999/500).
// Not plain: Merck/Organon 131/125, IBM/Kyndryl, Ford/Associates 1.5058.
const USUAL = [2, 3, 4, 5, 6, 8, 10, 20, 3 / 2, 4 / 3, 5 / 4, 5 / 2]
function isPlainSplit(s) {
  if (s.splitType === 'stock-dividend') return true
  if (s.splitType === 'spin-off') return false
  const n = Math.round(+s.numerator), d = Math.round(+s.denominator)
  if (!(n > 0 && d > 0)) return true
  const g = gcd(n, d), N = n / g, D = d / g, f = n / d
  return N === 1 || D === 1 || (N <= 25 && D <= 25) || USUAL.some(u => Math.abs(f / u - 1) < 0.0015 || Math.abs(f * u - 1) < 0.0015)
}
// a quarter's last or first trading days (within 4 days of Jan 1, Apr 1, Jul 1, Oct 1), where FMP's share counts step
const nearQuarterEnd = d => { const t = Date.parse(d), y = +d.slice(0, 4); return [0, 3, 6, 9, 12].some(mo => Math.abs(t - Date.UTC(y, mo, 1)) <= 4 * DAY) }

export function createTopCompanyGdp({ FMP_KEY, FRED_KEY, UA, dir }) {
  const CACHE = path.join(dir, 'top-company-gdp.json')
  let mem = null, inflight = null, lastFail = 0, lastError = null, fmpNext = 0, requests = 0

  function loadCache() {
    if (mem) return mem
    try { if (fs.existsSync(CACHE)) { const c = JSON.parse(fs.readFileSync(CACHE, 'utf8')); if (c?.payload) mem = c } } catch (e) { console.warn(`top-company-gdp.json: ${e.message}`) }
    return mem
  }
  function saveCache(c) {
    mem = c
    try { const tmp = `${CACHE}.tmp`; fs.writeFileSync(tmp, JSON.stringify(c)); fs.renameSync(tmp, CACHE) } catch (e) { console.warn(`Top company ÷ GDP: cache not written (${e.message})`) }
  }

  async function fmp(q) {
    if (!FMP_KEY) throw new Error('FMP key not configured')
    const what = `FMP ${q.split('?')[0]}`
    for (let a = 0; ; a++) {
      const slot = Math.max(Date.now(), fmpNext); fmpNext = slot + GAP
      if (slot > Date.now()) await sleep(slot - Date.now())
      requests++
      let r
      try { r = await fetch(`${FMP}${q}${q.includes('?') ? '&' : '?'}apikey=${FMP_KEY}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) }) }
      catch (e) { if (a < 2) { await sleep(2000 * (a + 1)); continue } throw new Error(`${what}: ${e.name === 'TimeoutError' ? 'timed out' : 'network error'}`) }
      if (r.status === 429 && a < 3) { await sleep(15_000 * (a + 1)); continue } // the key is shared with the rest of the dashboard
      if (r.status >= 500 && a < 2) { await sleep(2000 * (a + 1)); continue }
      if (!r.ok) throw new Error(`${what}: HTTP ${r.status}${r.status === 402 ? ' (not on the plan)' : ''}`)
      return r.json()
    }
  }

  // ── GDP ──
  async function gdpQuarters(prev) {
    try {
      if (!FRED_KEY) throw new Error('FRED key not configured')
      const r = await fetch(`${FRED}?series_id=GDP&api_key=${FRED_KEY}&file_type=json`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
      const text = await r.text()
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      let j; try { j = JSON.parse(text) } catch { throw new Error(/maintenance/i.test(text) ? 'FRED is down for maintenance' : 'answer is not JSON') }
      const obs = (j.observations || []).map(o => ({ d: o.date, v: +o.value })).filter(o => fin(o.v))
      if (obs.length < 200) throw new Error(`${obs.length} observations`)
      return { obs, source: 'FRED GDP', fetched: new Date().toISOString() }
    } catch (e) {
      const err = `FRED GDP: ${e.name === 'TimeoutError' ? 'timed out' : e.message}`
      try { // the dashboard's shared FRED observation cache
        const shared = JSON.parse(fs.readFileSync(path.join(dir, 'fred-cache.json'), 'utf8'))?.GDP
        const obs = (shared?.obs || []).filter(o => o?.d && fin(o.v))
        if (obs.length >= 200 && (!prev?.obs?.length || obs.at(-1).d >= prev.obs.at(-1).d)) return { obs, source: 'FRED GDP (dashboard FRED cache)', fetched: new Date(shared.ts).toISOString(), error: `${err}; using the dashboard's FRED cache of ${new Date(shared.ts).toISOString().slice(0, 10)}` }
      } catch {}
      if (prev?.obs?.length) return { ...prev, error: `${err}; using the copy of ${String(prev.fetched).slice(0, 10)}` }
      throw new Error(err)
    }
  }
  // quarterly SAAR on each quarter's middle month, linear in between, last quarter held
  function gdpMonthly(obs) {
    const pts = obs.map(o => [mIndex(ym(o.d)) + 1, o.v]).sort((a, b) => a[0] - b[0])
    return m => {
      const i = mIndex(m)
      if (i <= pts[0][0]) return pts[0][1]
      if (i >= pts.at(-1)[0]) return pts.at(-1)[1]
      let lo = 0, hi = pts.length - 1
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= i) lo = mid; else hi = mid }
      const [a, va] = pts[lo], [b, vb] = pts[hi]
      return va + (vb - va) * (i - a) / (b - a)
    }
  }
  const quarterLabel = d => `${d.slice(0, 4)}-Q${Math.floor((+d.slice(5, 7) - 1) / 3) + 1}`

  // ── one symbol's history: daily caps → spin-corrected, de-glitched month values ──
  async function pullSymbol(sym, gdpAt) {
    const splits = (await fmp(`splits?symbol=${encodeURIComponent(sym)}`)) || []
    const rows = []
    let to = new Date().toISOString().slice(0, 10)
    for (let i = 0; i < 8; i++) {
      const j = await fmp(`historical-market-capitalization?symbol=${encodeURIComponent(sym)}&from=${START}&to=${to}`)
      if (!Array.isArray(j) || !j.length) break
      rows.push(...j)
      if (j.length < PAGE) break
      const oldest = j.reduce((a, b) => (a.date < b.date ? a : b)).date
      to = new Date(Date.parse(oldest) - DAY).toISOString().slice(0, 10)
      if (to < START) break
    }
    const seen = new Set()
    const daily = rows.filter(r => r?.date && fin(r.marketCap) && r.marketCap > 0 && !seen.has(r.date) && seen.add(r.date)).map(r => ({ d: r.date.slice(0, 10), v: r.marketCap })).sort((a, b) => a.d.localeCompare(b.d))
    if (!daily.length) throw new Error('no market-cap history')

    // spin-offs: price-only cuts FMP applied to its history, undone
    const spins = []
    for (const s of Array.isArray(splits) ? splits : []) {
      if (!s?.date || isPlainSplit(s)) continue
      const f = +s.numerator / +s.denominator, date = s.date.slice(0, 10)
      if (!(f > 1.001) || date <= daily[0].d) { if (fin(f) && f < 1) spins.push({ date, factor: r4(f), applied: false, why: 'ratio below 1: not a spin-off cut' }); continue }
      const i = daily.findIndex(r => r.d >= date)
      let applied = true, why = 'history smooth across the date: FMP cut the earlier values'
      if (i > 0 && f >= 1.08) {
        const lr = Math.log(daily[i].v / daily[i - 1].v)
        if (Math.abs(lr + Math.log(f)) < Math.abs(lr)) { applied = false; why = 'history drops by the factor on the date: FMP left it raw' }
      } else if (i > 0) why = 'small factor, applied'
      spins.push({ date, factor: r4(f), applied, why, type: s.splitType })
    }
    for (const sp of spins.filter(x => x.applied)) for (const r of daily) { if (r.d >= sp.date) break; r.v *= sp.factor }

    // share-count glitches: opposite quarter-end steps that cancel (a spin-off day's drop is real, not one)
    const spinDays = new Set(spins.filter(x => x.applied).map(x => daily.find(r => r.d >= x.date)?.d))
    const steps = []
    for (let i = 1; i < daily.length; i++) {
      const lr = Math.log(daily[i].v / daily[i - 1].v)
      if (Math.abs(lr) >= Math.log(1.2) && nearQuarterEnd(daily[i].d) && !spinDays.has(daily[i].d)) steps.push({ i, lr, d: daily[i].d })
    }
    const glitches = []
    for (let a = 0; a < steps.length; a++) {
      const s = steps[a]
      if (s.used || Math.max(daily[s.i].v, daily[s.i - 1].v) / 1e9 < 0.0025 * gdpAt(ym(s.d))) continue
      for (let b = a + 1; b < steps.length; b++) {
        const t = steps[b]
        if (Date.parse(t.d) - Date.parse(s.d) > 400 * DAY) break
        if (t.used || Math.sign(t.lr) === Math.sign(s.lr)) continue
        if (Math.abs(s.lr + t.lr) < Math.log(1.1)) { glitches.push({ from: s.d, to: t.d, factor: r4(Math.exp(-s.lr)) }); s.used = t.used = true; break }
      }
    }
    for (const g of glitches) for (const r of daily) if (r.d >= g.from && r.d < g.to) r.v *= g.factor

    // month values [month, $bn, day]: the month's last trading day
    const months = new Map()
    for (const r of daily) months.set(ym(r.d), [ym(r.d), r1(r.v / 1e9), r.d])
    return { months: [...months.values()], first: daily[0].d, last: daily.at(-1).d, spins, glitches, pulled: new Date().toISOString() }
  }

  // ── today's large US companies ──
  async function screen() {
    const j = await fmp(`company-screener?marketCapMoreThan=${SCREEN_MIN}&country=US&isEtf=false&isFund=false&isActivelyTrading=true&limit=200`)
    if (!Array.isArray(j) || !j.length) throw new Error('FMP company-screener: empty answer')
    const byCo = new Map()
    for (const x of j) {
      if (!x?.symbol || !fin(x.marketCap) || x.isEtf || x.isFund || x.country !== 'US') continue
      if (JUNK.test(x.companyName || '') || /-P|\.(PR|WS)/i.test(x.symbol) || LEFT_OUT.includes(x.symbol)) continue
      const symbol = ALIAS[x.symbol] || x.symbol
      const key = (symbol !== x.symbol || STATIC.has(symbol)) ? symbol : cleanName(x.companyName).toLowerCase()
      const prev = byCo.get(key)
      if (!prev || x.marketCap > prev.cap) byCo.set(key, { symbol, fmpName: x.companyName, cap: x.marketCap })
    }
    return [...byCo.values()].sort((a, b) => b.cap - a.cap)
  }

  // ── assembly: series, current, stats from stored symbols ──
  function assemble(store, errors) {
    const gdpAt = gdpMonthly(store.gdp.obs)
    const nowM = ym(new Date().toISOString())
    const syms = Object.keys(store.symbols)
    const byM = new Map()
    for (const s of syms) for (const [m, v] of store.symbols[s].months) { if (!fin(v)) continue; if (!byM.has(m)) byM.set(m, []); byM.get(m).push([s, v]) }
    const first = [...byM.keys()].sort()[0]
    const series = []
    for (let i = mIndex(first); i <= mIndex(nowM); i++) {
      const m = mName(i), xs = (byM.get(m) || []).slice().sort((a, b) => b[1] - a[1])
      if (!xs.length) continue
      const g = gdpAt(m), sum = n => xs.slice(0, n).reduce((t, x) => t + x[1], 0)
      series.push({ m, leader: xs[0][0], leaderName: nameAt(xs[0][0], m, store.symbols[xs[0][0]]?.fmpName), leaderCap: r1(xs[0][1]), gdp: r1(g), ratio: r2(xs[0][1] / g * 100), top5: r2(sum(5) / g * 100), top10: r2(sum(10) / g * 100) })
    }
    const lastQ = store.gdp.obs.at(-1)
    const leaders = (store.screen?.rows || []).slice(0, 10).map(x => ({ symbol: x.symbol, name: nameAt(x.symbol, nowM, x.fmpName), cap: r1(x.cap / 1e9), pctGdp: r2(x.cap / 1e9 / lastQ.v * 100) }))
    const cred = series.filter(r => r.m >= COVERAGE_FROM)
    const peak = rs => rs.reduce((a, b) => (b.ratio > (a?.ratio ?? -1) ? b : a), null)
    const mx = peak(cred), pre = peak(cred.filter(r => r.m < '2015-01'))
    const stats = cred.length ? {
      median: r2(quantile(cred.map(r => r.ratio), 0.5)), p90: r2(quantile(cred.map(r => r.ratio), 0.9)),
      max: mx && { m: mx.m, leader: mx.leader, leaderName: mx.leaderName, ratio: mx.ratio }, pre2015Max: pre && { m: pre.m, leader: pre.leader, leaderName: pre.leaderName, ratio: pre.ratio },
    } : null
    const ledMonths = new Map(), inTop10 = new Map()
    for (const r of cred) ledMonths.set(r.leader, (ledMonths.get(r.leader) || 0) + 1)
    for (const m of cred.map(r => r.m)) for (const [s] of (byM.get(m) || []).slice().sort((a, b) => b[1] - a[1]).slice(0, 10)) inTop10.set(s, (inTop10.get(s) || 0) + 1)
    const candidates = syms.map(s => {
      const x = store.symbols[s], ms = x.months.filter(([, v]) => fin(v))
      const best = ms.reduce((a, b) => { const p = b[1] / gdpAt(b[0]) * 100; return p > (a?.pct ?? -1) ? { m: b[0], cap: b[1], pct: r2(p) } : a }, null)
      return {
        symbol: s, name: nameAt(s, nowM, x.fmpName), from: ms[0]?.[0] || null, to: ms.at(-1)?.[0] || null,
        source: STATIC.has(s) ? 'list' : 'screener top 15', monthsLeader: ledMonths.get(s) || 0, monthsTop10: inTop10.get(s) || 0, peak: best,
        spinAdjusted: x.spins.filter(sp => sp.applied).map(({ date, factor }) => ({ date, factor })), glitchesRemoved: x.glitches,
        ...(x.error ? { error: x.error } : {}),
      }
    }).sort((a, b) => b.monthsLeader - a.monthsLeader || b.monthsTop10 - a.monthsTop10 || a.symbol.localeCompare(b.symbol))
    const sp = candidates.filter(c => c.spinAdjusted.length).map(c => c.symbol)
    return {
      built: new Date().toISOString(), stale: false, sourceErrors: errors, method: 'fmp-historical-market-cap', coverageFrom: COVERAGE_FROM,
      series,
      current: { asOf: store.screen?.asOf || null, gdpQuarter: quarterLabel(lastQ.d), leaders },
      stats,
      anchors: [],
      candidates,
      note: `Market value of the largest US company each month (last trading day; the current month is today) ÷ US nominal GDP (FRED GDP, quarterly SAAR, interpolated between mid-quarter months; months after ${quarterLabel(lastQ.d)} use that quarter). Market caps are FMP's daily history, with FMP's spin-off price cuts undone (${sp.join(', ') || 'none'}) and share-count glitches that FMP reverses taken out; FMP's share counts update at quarter ends, so a month can be off by a quarter's buybacks or issuance, and a merger can show a quarter early. Candidates are ${syms.length} US companies still listed (FMP has no delisted names) chosen as plausible leaders since 1984 plus today's top ${DYNAMIC_TOP}: the leader is credible from ${COVERAGE_FROM}; before that the pre-divestiture AT&T and General Motors are missing, so the 1962–83 leader and ratio are a lower bound. Top 5 and top 10 are lower bounds before about 2002 (AT&T Corp, Mobil, Amoco, GM, BellSouth, Lucent, AOL Time Warner, MCI WorldCom and Sun are missing). US companies only (no foreign ADRs). Stats cover ${COVERAGE_FROM} on.`,
    }
  }

  async function refresh(kind) {
    const t0 = Date.now(), errors = []
    requests = 0
    const prev = loadCache()
    const store = prev?.store ? { ...prev.store, symbols: { ...prev.store.symbols } } : { symbols: {}, dynamic: [] }
    // GDP first: the glitch filter is relative to it
    const gdp = await gdpQuarters(store.gdp)
    if (gdp.error) errors.push({ source: 'FRED GDP', error: gdp.error })
    store.gdp = { obs: gdp.obs, source: gdp.source, fetched: gdp.fetched }
    // today's top companies
    try {
      const rows = await screen()
      let asOf = null
      try { const q = await fmp(`quote?symbol=${encodeURIComponent(rows[0].symbol)}`); if (fin(q?.[0]?.timestamp)) asOf = new Date(q[0].timestamp * 1000).toISOString() } catch {}
      store.screen = { rows: rows.slice(0, 40), asOf: asOf || new Date().toISOString(), fetched: new Date().toISOString() }
      store.dynamic = [...new Set([...rows.slice(0, DYNAMIC_TOP).map(x => x.symbol).filter(s => !STATIC.has(s)), ...(kind === 'full' ? [] : store.dynamic || [])])]
    } catch (e) {
      errors.push({ source: 'FMP company-screener', error: `${e.message}${store.screen ? `; today's top 10 is from ${store.screen.fetched.slice(0, 10)}` : ''}` })
    }
    // the history: every candidate on a full pull; on a daily pull only a new top-15 name that has none yet
    const full = kind === 'full' || !store.historyBuilt
    const want = [...CANDIDATES.map(c => c[0]), ...(store.dynamic || [])]
    const todo = full ? want : want.filter(s => !store.symbols[s])
    if (full) store.historyTried = new Date().toISOString()
    store.currentTried = new Date().toISOString()
    if (todo.length) {
      const gdpAt = gdpMonthly(store.gdp.obs)
      const failed = []
      let run = 0, abort = null
      for (const s of todo) {
        if (abort) { failed.push(s); continue }
        try { const x = await pullSymbol(s, gdpAt); const fmpName = (store.screen?.rows || []).find(r => r.symbol === s)?.fmpName || store.symbols[s]?.fmpName || null; store.symbols[s] = { ...x, fmpName }; run = 0 }
        catch (e) {
          failed.push(s)
          const kept = store.symbols[s] ? `kept the months pulled ${String(store.symbols[s].pulled).slice(0, 10)}` : 'left out'
          if (store.symbols[s]) store.symbols[s] = { ...store.symbols[s], error: `${e.message}; ${kept}` }
          errors.push({ source: `FMP history ${s}`, error: `${e.message}; ${kept}` })
          // three failures in a row (bad key, plan, rate limit, outage): stop asking
          if (++run >= 3) abort = e.message
        }
      }
      if (abort) {
        const rest = failed.slice(3)
        if (rest.length) errors.push({ source: 'FMP history', error: `stopped after 3 failures in a row (${abort}); ${rest.length} more symbols not refreshed, their last months kept: ${rest.join(', ')}` })
      }
      if (full) for (const s of Object.keys(store.symbols)) if (!want.includes(s)) delete store.symbols[s]
      if (!Object.keys(store.symbols).length) throw new Error(`no market-cap history (${failed.length} symbols failed${abort ? `: ${abort}` : ''})`)
      if (full && (failed.length < todo.length / 2 || !store.historyBuilt)) store.historyBuilt = new Date().toISOString()
    }
    // today's screener values are the current month's (and, kept, a month's last value until the next full pull)
    if (store.screen?.rows?.length) {
      const day = (store.screen.asOf || store.screen.fetched).slice(0, 10), m = ym(day)
      for (const x of store.screen.rows) {
        const sym = store.symbols[x.symbol]
        if (!sym) continue
        const months = sym.months.slice(), i = months.findIndex(e => e[0] === m), v = [m, r1(x.cap / 1e9), day]
        if (i < 0) { if (!months.length || months.at(-1)[0] < m) months.push(v) } else if (day >= months[i][2]) months[i] = v
        store.symbols[x.symbol] = { ...sym, months }
      }
    }
    const payload = assemble(store, errors)
    store.lastRun = { kind, ms: Date.now() - t0, requests }
    const out = { payload, store }
    saveCache(out)
    return out
  }

  function startRefresh(kind) {
    if (inflight || Date.now() - lastFail < RETRY) return inflight
    inflight = refresh(kind)
      .then(v => { lastError = null; return v })
      .catch(e => { lastFail = Date.now(); lastError = e.message; console.warn(`Top company ÷ GDP: refresh failed: ${e.message}`); return null })
      .finally(() => { inflight = null })
    return inflight
  }

  async function get() {
    let c = loadCache()
    if (!c) { await startRefresh('full'); c = loadCache() }
    else if ((!c.store?.historyBuilt || Date.now() - Date.parse(c.store.historyBuilt) > HISTORY_TTL) && Date.now() - Date.parse(c.store?.historyTried || 0) > RETRY) startRefresh('full')
    else if (Date.now() - Date.parse(c.store?.screen?.fetched || 0) > CURRENT_TTL && Date.now() - Date.parse(c.store?.currentTried || 0) > RETRY) startRefresh('current')
    if (!c) {
      return {
        built: null, stale: true, sourceErrors: [{ source: 'refresh', error: lastError || 'no data yet' }], method: 'fmp-historical-market-cap', coverageFrom: COVERAGE_FROM,
        series: [], current: null, stats: null, anchors: [], candidates: [], note: null,
      }
    }
    const out = { ...c.payload, sourceErrors: [...(c.payload.sourceErrors || [])] }
    if (lastError) out.sourceErrors.push({ source: 'refresh', error: lastError })
    out.stale = Date.now() - Date.parse(c.store?.screen?.fetched || 0) > CURRENT_TTL || Date.now() - Date.parse(c.store?.historyBuilt || 0) > HISTORY_TTL || !!lastError || out.sourceErrors.length > 0
    return out
  }

  return { get }
}
