// ============================================================================
// FOUR MARKETS — Cockpit: stocks, bonds, currencies and commodities read
// together, in the manner Stanley Druckenmiller describes (the framing and the
// rules below are this dashboard's, not his): the markets are the forecast,
// liquidity moves the whole market more than earnings do, look 12 to 24 months
// ahead, follow the trend, and size by how clear the picture is.
//
// Weekly, from 1999. Each signal is a market's 13-week move, in units of its
// own typical 13-week move over the prior three years (so a dull market and a
// wild one are on one scale), signed so that + means easier money (liquidity)
// or a stronger economy ahead (growth):
//   liquidity  the 2-year yield against fed funds (cuts priced), the real
//              10-year yield, Fed balance sheet net of the Treasury's cash and
//              reverse repos, the dollar, the yen (carry)
//   growth     copper against gold, the Baa credit spread, the 10-year yield,
//              cyclicals against defensives, small caps, transports and
//              regional banks against the S&P 500
// Each axis is the average of its signals; the pair puts the week in one of
// four cells (easing or tightening × improving or deteriorating). Clarity is
// how far the signals agree, how strong they are and how steady the cell has
// been; it maps to a stance. Each market also gets a chart read: its price
// against its 40-week average and its 26-week momentum.
// The playbook: what stocks, bonds, the dollar and commodities did over the
// next 26 weeks from every past week in each cell, and how clarity sorted the
// outcomes. Only data available at each week is used for that week's reading.
//
// Sources: FRED (rates, spreads, Fed balance sheet, the dollar, the yen,
// copper, oil) via the shared cache; Financial Modeling Prep daily closes for
// SPY, XLY, XLP, IWM, IYT, KRE, TLT, GLD, DBC and CPER (key server-side), kept in the
// gitignored cross-asset-prices.json and topped up daily.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const DAY = 864e5, H = 3600e3
const ETFS = ['SPY', 'XLY', 'XLP', 'IWM', 'IYT', 'KRE', 'TLT', 'GLD', 'DBC', 'CPER']
const CHUNKS = [['1999-01-01', '2008-12-31'], ['2009-01-01', '2018-12-31'], ['2019-01-01', null]]   // FMP returns at most 5,000 rows a call
const FRED_IDS = ['DFF', 'DGS2', 'DGS10', 'DFII10', 'WALCL', 'WTREGEN', 'RRPONTSYD', 'DTWEXBGS', 'DTWEXM', 'DEXJPUS', 'BAA10Y', 'PCOPPUSDM', 'DCOILWTICO']
export const START = '1999-01-01'
const W13 = 13, W26 = 26, ZWIN = 156, ZMIN = 52

const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 3) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const clip = (v, a, b) => Math.max(a, Math.min(b, v))
const iso = t => new Date(t).toISOString().slice(0, 10)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const mean = xs => { const v = xs.filter(fin); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null }
const median = xs => { const v = xs.filter(fin).sort((a, b) => a - b); if (!v.length) return null; const m = (v.length - 1) / 2; return (v[Math.floor(m)] + v[Math.ceil(m)]) / 2 }
const std = xs => { const v = xs.filter(fin); if (v.length < 2) return null; const m = mean(v); return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) }

// Fridays from `from` through `to`
export function fridays(from, to) {
  const out = []
  let t = Date.parse(`${from}T00:00:00Z`)
  while (new Date(t).getUTCDay() !== 5) t += DAY
  for (const end = Date.parse(`${to}T00:00:00Z`); t <= end; t += 7 * DAY) out.push(iso(t))
  return out
}

// a daily/weekly/monthly series [{d, v}] (ascending) sampled at each week: the last value on or before it,
// if no older than maxAge days
export function onWeeks(series, weeks, maxAge = 10) {
  const out = new Array(weeks.length).fill(null)
  let j = -1
  for (let i = 0; i < weeks.length; i++) {
    while (j + 1 < series.length && series[j + 1].d <= weeks[i]) j++
    if (j >= 0 && fin(series[j].v) && (Date.parse(weeks[i]) - Date.parse(series[j].d)) / DAY <= maxAge) out[i] = series[j].v
  }
  return out
}

// the n-week change: a log change for prices (kind 'log'), a difference for yields and spreads
export const change = (x, n, kind) => x.map((v, i) => (i >= n && fin(v) && fin(x[i - n]) && (kind !== 'log' || (v > 0 && x[i - n] > 0)) ? (kind === 'log' ? Math.log(v / x[i - n]) : v - x[i - n]) : null))

// each value over the standard deviation of the same series over the prior ZWIN weeks (past only), clipped to ±2
export function zscore(c) {
  return c.map((v, i) => {
    if (!fin(v)) return null
    const s = std(c.slice(Math.max(0, i - ZWIN), i))
    return fin(s) && s > 0 && c.slice(Math.max(0, i - ZWIN), i).filter(fin).length >= ZMIN ? clip(v / s, -2, 2) : null
  })
}

// the chart read: price against its 40-week average, 26-week momentum, distance from the 52-week high and low
export function trend(x, i) {
  if (!fin(x[i]) || i < 52) return null
  const w = x.slice(i - 39, i + 1).filter(fin)
  if (w.length < 30) return null
  const ma = mean(w), y = x.slice(i - 51, i + 1).filter(fin), hi = Math.max(...y), lo = Math.min(...y)
  const m26 = fin(x[i - 26]) ? x[i] / x[i - 26] - 1 : null, m13 = fin(x[i - 13]) ? x[i] / x[i - 13] - 1 : null, m52 = fin(x[i - 52]) ? x[i] / x[i - 52] - 1 : null
  const above = x[i] > ma
  const state = above && m26 > 0 ? 'uptrend' : !above && m26 < 0 ? 'downtrend' : above ? 'turning up' : 'turning down'
  return { state, vsMa: rnd(x[i] / ma - 1, 4), m13: rnd(m13, 4), m26: rnd(m26, 4), m52: rnd(m52, 4), fromHigh: rnd(x[i] / hi - 1, 4), fromLow: rnd(x[i] / lo - 1, 4) }
}

const ratio = (a, b) => a.map((v, i) => (fin(v) && fin(b[i]) && b[i] > 0 ? v / b[i] : null))
const neg = xs => xs.map(v => (fin(v) ? -v : null))

// The signals. `make(w)` turns the weekly inputs into a signed score series (+ = easier money / stronger growth).
// `says` and `equity` are what a reading means, by sign.
export const SIGNALS = [
  { id: 'policy', axis: 'liquidity', market: 'bonds', label: 'Cuts or hikes priced: 2-year yield against fed funds', unit: 'pp', kind: 'level',
    raw: w => w.DGS2.map((v, i) => (fin(v) && fin(w.DFF[i]) ? v - w.DFF[i] : null)),
    make: (w, raw) => raw.map(v => (fin(v) ? clip(-v / 0.5, -2, 2) : null)),
    says: ['The bond market is pricing rate cuts: the 2-year sits below the overnight rate.', 'The bond market is pricing hikes, or no cuts: the 2-year sits above the overnight rate.'],
    equity: ['Easier money ahead supports multiples, most of all for long-duration growth stocks.', 'No help from the Fed: multiples have to be earned by earnings growth.'],
    rule: '50 basis points of cuts priced scores +1; hikes score negative.' },
  { id: 'realYield', axis: 'liquidity', market: 'bonds', label: 'Real 10-year yield', unit: 'pp', kind: 'diff', from: 'DFII10', sign: -1,
    says: ['Real yields are falling: money is getting cheaper after inflation.', 'Real yields are rising: the price of money after inflation is going up.'],
    equity: ['Falling real yields lift what a dollar of distant earnings is worth.', 'Rising real yields are the discount rate rising: they compress the multiples of long-duration stocks first.'] },
  { id: 'netLiquidity', axis: 'liquidity', market: 'bonds', label: 'Fed balance sheet net of the Treasury\'s cash and reverse repos', unit: '$bn', kind: 'log',
    // WALCL and WTREGEN are in $ millions, reverse repos in $ billions
    raw: w => w.WALCL.map((v, i) => (fin(v) && fin(w.WTREGEN[i]) ? (v - w.WTREGEN[i]) / 1000 - (w.RRPONTSYD[i] ?? 0) : null)),
    says: ['Reserves in the banking system are growing.', 'Reserves in the banking system are shrinking.'],
    equity: ['More reserves have tended to go with rising risk-asset prices.', 'Draining reserves is a headwind for the most speculative assets first.'] },
  { id: 'dollar', axis: 'liquidity', market: 'currencies', label: 'Broad trade-weighted dollar', unit: 'index', kind: 'log', sign: -1,
    says: ['The dollar is weakening: global dollar funding is getting easier.', 'The dollar is strengthening: global dollar funding is getting tighter.'],
    equity: ['A weaker dollar lifts U.S. multinationals\' foreign earnings and eases conditions for emerging markets.', 'A stronger dollar cuts the dollar value of foreign earnings and tightens conditions abroad, Asian exporters and chipmakers included.'] },
  { id: 'yen', axis: 'liquidity', market: 'currencies', label: 'Yen per dollar (the carry trade)', unit: '¥', kind: 'log', from: 'DEXJPUS',
    says: ['The yen is weakening: borrowing in yen to buy other assets is paying.', 'The yen is strengthening: yen-funded positions are being unwound.'],
    equity: ['A weak yen is cheap leverage flowing into risk assets.', 'A sharp yen rally has preceded forced selling of crowded positions (August 2024).'] },
  { id: 'copperGold', axis: 'growth', market: 'commodities', label: 'Copper against gold', unit: 'ratio', kind: 'log',
    raw: w => ratio(w.copper, w.GLD),
    says: ['Copper is beating gold: the market prices more industrial demand ahead.', 'Gold is beating copper: the market prices weaker industry or wants safety.'],
    equity: ['Favors cyclicals, industrials and materials over defensives.', 'Favors quality and defensives; a warning for cyclical earnings estimates.'] },
  { id: 'credit', axis: 'growth', market: 'bonds', label: 'Baa corporate spread over Treasuries', unit: 'pp', kind: 'diff', from: 'BAA10Y', sign: -1,
    says: ['Credit spreads are narrowing: lenders see less default risk ahead.', 'Credit spreads are widening: lenders want more for default risk.'],
    equity: ['Narrowing spreads usually go with rising equities; credit tends to turn first.', 'Widening spreads have usually led equity drawdowns; the leveraged names go first.'] },
  { id: 'yield10', axis: 'growth', market: 'bonds', label: '10-year Treasury yield', unit: 'pp', kind: 'diff', from: 'DGS10',
    says: ['Long yields are rising: the bond market expects more growth or inflation.', 'Long yields are falling: the bond market expects slower growth or lower inflation.'],
    equity: ['Rising yields with rising stocks is growth; rising yields with falling stocks is the discount rate. Read it with the real yield.', 'Falling yields help valuations but often signal a slowdown in earnings.'] },
  { id: 'cyclicals', axis: 'growth', market: 'stocks', label: 'Consumer discretionary against staples', unit: 'ratio', kind: 'log', raw: w => ratio(w.XLY, w.XLP),
    says: ['Cyclical stocks are leading defensives.', 'Defensive stocks are leading cyclicals.'],
    equity: ['The equity market is pricing a consumer that keeps spending.', 'The equity market is pricing a weaker consumer before the data shows it.'] },
  { id: 'smallCaps', axis: 'growth', market: 'stocks', label: 'Small caps against the S&P 500', unit: 'ratio', kind: 'log', raw: w => ratio(w.IWM, w.SPY),
    says: ['Small caps are leading: breadth and domestic growth.', 'Small caps are lagging: the rally is narrow or domestic growth is slowing.'],
    equity: ['Broad participation is a healthier tape.', 'Narrow leadership is fragile: a few names carry the index.'] },
  { id: 'transports', axis: 'growth', market: 'stocks', label: 'Transports against the S&P 500', unit: 'ratio', kind: 'log', raw: w => ratio(w.IYT, w.SPY),
    says: ['Transports are leading: goods are moving.', 'Transports are lagging: freight is slowing.'],
    equity: ['Physical activity confirms the economy.', 'The goods economy is softening before earnings say so.'] },
  { id: 'banks', axis: 'growth', market: 'stocks', label: 'Regional banks against the S&P 500', unit: 'ratio', kind: 'log', raw: w => ratio(w.KRE, w.SPY),
    says: ['Regional banks are leading: credit is flowing.', 'Regional banks are lagging: the market worries about loan losses or funding.'],
    equity: ['Banks lending freely feeds the rest of the economy.', 'Tighter bank credit reaches small businesses and real estate first.'] },
]

export const TREND_ASSETS = [
  { market: 'stocks', label: 'S&P 500', id: 'SPY', note: 'SPY' },
  { market: 'bonds', label: 'Long Treasuries', id: 'TLT', note: 'TLT (price: up means yields falling)' },
  { market: 'currencies', label: 'Dollar', id: 'DOLLAR', note: 'broad trade-weighted dollar index' },
  { market: 'commodities', label: 'Commodities', id: 'DBC', note: 'DBC, a broad commodity basket' },
]
export const CELLS = {
  'easing-improving': { label: 'Easing into a recovery', short: 'Easy money, improving' },
  'easing-deteriorating': { label: 'Easing into a slowdown', short: 'Easy money, deteriorating' },
  'tightening-improving': { label: 'Tightening into strength', short: 'Tight money, improving' },
  'tightening-deteriorating': { label: 'Tightening into weakness', short: 'Tight money, deteriorating' },
}
export const STANCES = [[60, 'Press', 'The signals agree, strongly and steadily: the conditions under which concentration has paid.'], [40, 'Normal size', 'Most signals agree.'], [20, 'Small and two-way', 'The signals are mixed or weak: keep positions small and hedged.'], [-1, 'Flat: preserve capital', 'No clear picture. Druckenmiller\'s word for this is "taking a break".']]

// one series spliced onto an older one where the newer starts, rescaled to meet it: the broad dollar onto the major-currency
// index, the copper ETF onto the IMF's monthly copper price. Only changes are used, so the scale does not matter
export function splice(newer, older) {
  const first = newer.findIndex(fin)
  if (first < 0) return older
  const scale = fin(older[first]) && older[first] !== 0 ? newer[first] / older[first] : null
  return newer.map((v, i) => (i >= first ? v : fin(scale) && fin(older[i]) ? older[i] * scale : null))
}

// all weekly inputs → the full weekly history of signals, axes, cells, clarity and trends
export function buildHistory(w, weeks) {
  const sig = {}
  for (const s of SIGNALS) {
    const raw = s.raw ? s.raw(w) : w[s.from || s.id] || w[s.id]
    const scored = s.make ? s.make(w, raw) : zscore(change(raw, W13, s.kind)).map(v => (fin(v) ? v * (s.sign || 1) : null))
    sig[s.id] = { raw, scored, chg: s.kind === 'level' ? raw : change(raw, W13, s.kind) }
  }
  const rows = weeks.map((d, i) => {
    const axes = {}
    for (const axis of ['liquidity', 'growth']) {
      const vals = SIGNALS.filter(s => s.axis === axis).map(s => sig[s.id].scored[i]).filter(fin)
      const score = vals.length >= 2 ? mean(vals) : null
      const agree = fin(score) && vals.length ? vals.filter(v => Math.sign(v) === Math.sign(score) && v !== 0).length / vals.length : null
      axes[axis] = { score: rnd(score), agree: rnd(agree), n: vals.length }
    }
    const L = axes.liquidity.score, G = axes.growth.score
    const cell = fin(L) && fin(G) ? `${L >= 0 ? 'easing' : 'tightening'}-${G >= 0 ? 'improving' : 'deteriorating'}` : null
    return { d, liq: L, growth: G, liqAgree: axes.liquidity.agree, growthAgree: axes.growth.agree, nLiq: axes.liquidity.n, nGrowth: axes.growth.n, cell }
  })
  // clarity: per axis, agreement (½ → 0, all → 1) times strength (|score| of 0.75 or more counts in full), averaged,
  // times steadiness (each change of cell in the past 8 weeks takes off a fifth, to a floor of 0.4)
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]
    if (!r.cell) { r.clarity = null; continue }
    const part = (s, a) => clip(2 * a - 1, 0, 1) * Math.min(1, Math.abs(s) / 0.75)
    let flips = 0
    for (let k = Math.max(1, i - 7); k <= i; k++) if (rows[k].cell && rows[k - 1].cell && rows[k].cell !== rows[k - 1].cell) flips++
    r.flips = flips
    r.clarity = Math.round(100 * ((part(r.liq, r.liqAgree) + part(r.growth, r.growthAgree)) / 2) * Math.max(0.4, 1 - 0.2 * flips))
  }
  return { rows, sig }
}

export const stanceFor = clarity => STANCES.find(([min]) => clarity >= min) || STANCES.at(-1)

// What each market did over the next h weeks from every past week in each cell; and how clarity sorted stock returns.
export function playbook(rows, prices, h = W26) {
  const fwd = x => x.map((v, i) => (i + h < x.length && fin(v) && fin(x[i + h]) && v > 0 ? x[i + h] / v - 1 : null))
  const F = Object.fromEntries(TREND_ASSETS.map(a => [a.market, fwd(prices[a.id])]))
  const cells = {}
  for (const key of Object.keys(CELLS)) {
    const idx = rows.map((r, i) => (r.cell === key ? i : -1)).filter(i => i >= 0)
    let runs = 0
    for (let k = 0; k < idx.length; k++) if (k === 0 || idx[k] - idx[k - 1] > 4) runs++
    cells[key] = { weeks: idx.length, runs, share: rows.filter(r => r.cell).length ? rnd(idx.length / rows.filter(r => r.cell).length, 3) : null,
      markets: Object.fromEntries(TREND_ASSETS.map(a => { const v = idx.map(i => F[a.market][i]).filter(fin); return [a.market, { n: v.length, median: rnd(median(v), 4), mean: rnd(mean(v), 4), up: v.length ? rnd(v.filter(x => x > 0).length / v.length, 3) : null }] })) }
  }
  const bands = [[0, 33, 'Low (under 33)'], [33, 66, 'Middle (33 to 65)'], [66, 101, 'High (66 and over)']].map(([lo, hi, label]) => {
    const idx = rows.map((r, i) => (fin(r.clarity) && r.clarity >= lo && r.clarity < hi ? i : -1)).filter(i => i >= 0)
    const v = idx.map(i => F.stocks[i]).filter(fin)
    // a high-clarity reading is useful if it points the right way: stocks up in improving cells, down in deteriorating ones
    const right = idx.filter(i => fin(F.stocks[i])).filter(i => (rows[i].growth >= 0) === (F.stocks[i] > 0)).length
    return { label, weeks: idx.length, median: rnd(median(v), 4), spread: rnd(std(v), 4), worst: v.length ? rnd(Math.min(...v), 4) : null, pointedRight: v.length ? rnd(right / v.length, 3) : null }
  })
  return { horizon: h, cells, clarity: bands }
}

export function createCrossAsset({ dir, fred, FMP_KEY, UA = 'econ-dashboard', now = () => Date.now() }) {
  const FILE = path.join(dir, 'cross-asset-prices.json')
  let store = { version: 1, symbols: {}, checked: 0 }
  try { if (fs.existsSync(FILE)) { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (d?.version === 1) store = d } } catch (e) { console.warn('cross-asset-prices.json:', e.message) }
  let cache = null, inflight = null

  // FMP is shared with the rest of the dashboard and answers 429 when it is busy: back off and try again
  async function fmp(symbol, from, to) {
    const q = new URLSearchParams({ symbol, from, apikey: FMP_KEY })
    if (to) q.set('to', to)
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(`https://financialmodelingprep.com/stable/historical-price-eod/light?${q}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })
      if (r.status === 429 && attempt < 4) { await sleep(3000 * (attempt + 1)); continue }
      if (!r.ok) throw new Error(`FMP ${symbol} HTTP ${r.status}`)
      const j = await r.json()
      const rows = Array.isArray(j) ? j : j?.historical || []
      return rows.map(x => ({ d: x.date, v: x.price ?? x.close })).filter(x => x.d && fin(x.v))
    }
  }

  // the full history once, then only the newest chunk from a fortnight before the last stored day. A symbol that
  // fails keeps what is on file; the failure is reported with the reading rather than stopping it
  async function prices() {
    if (!FMP_KEY) throw new Error('No FMP key configured')
    if (now() - (store.checked || 0) < 12 * H && ETFS.every(s => store.symbols[s]?.length)) return { symbols: store.symbols, errors: [] }
    const errors = []
    for (const s of ETFS) {
      const have = store.symbols[s] || []
      const chunks = have.length ? [[iso(Date.parse(have.at(-1).d) - 14 * DAY), null]] : CHUNKS
      const got = new Map(have.map(x => [x.d, x.v]))
      try {
        for (const [from, to] of chunks) { for (const x of await fmp(s, from, to)) got.set(x.d, x.v); await sleep(450) }
      } catch (e) { errors.push(String(e?.message || e).slice(0, 80)); continue }
      store.symbols[s] = [...got].sort((a, b) => a[0].localeCompare(b[0])).map(([d, v]) => ({ d, v }))
    }
    if (!errors.length) store.checked = now()
    try { fs.writeFileSync(FILE, JSON.stringify(store)) } catch (e) { console.error('cross-asset-prices.json save:', e.message) }
    if (!store.symbols.SPY?.length) throw new Error(errors[0] || 'No price history')
    return { symbols: store.symbols, errors }
  }

  async function build() {
    const [{ symbols: etf, errors }, ...fredSeries] = await Promise.all([prices(), ...FRED_IDS.map(id => fred(id, 9000))])
    const F = Object.fromEntries(FRED_IDS.map((id, i) => [id, fredSeries[i] || []]))
    const end = [etf.SPY?.at(-1)?.d, F.DGS10.at(-1)?.d].filter(Boolean).sort()[0]
    const weeks = fridays(START, end)
    const w = {}
    for (const s of ETFS) w[s] = onWeeks(etf[s] || [], weeks)
    for (const id of FRED_IDS) w[id] = onWeeks(F[id], weeks, id === 'PCOPPUSDM' ? 45 : ['WALCL', 'WTREGEN'].includes(id) ? 10 : 7)
    w.dollar = splice(w.DTWEXBGS, w.DTWEXM)
    // copper: the copper futures ETF from late 2011, the IMF's monthly copper price before it (it arrives two months late)
    w.copper = splice(w.CPER, w.PCOPPUSDM)
    const { rows, sig } = buildHistory(w, weeks)
    const px = { SPY: w.SPY, TLT: w.TLT, DBC: w.DBC, DOLLAR: w.dollar }
    const i = rows.length - 1, last = rows[i]
    const stance = fin(last.clarity) ? stanceFor(last.clarity) : null
    const signals = SIGNALS.map(s => {
      const v = sig[s.id].scored[i], c = sig[s.id].chg[i], raw = sig[s.id].raw[i]
      return { id: s.id, axis: s.axis, market: s.market, label: s.label, unit: s.unit, kind: s.kind, score: rnd(v, 2), level: rnd(raw, s.kind === 'log' ? 2 : 3), change13: rnd(c, 4),
        says: fin(v) ? s.says[v >= 0 ? 0 : 1] : null, equity: fin(v) ? s.equity[v >= 0 ? 0 : 1] : null, rule: s.rule || null,
        series: rows.slice(-52).map((r, k) => [r.d, rnd(sig[s.id].scored[i - 51 + k], 2)]) }
    })
    const markets = TREND_ASSETS.map(a => ({ ...a, trend: trend(px[a.id], i), level: rnd(px[a.id][i], 3),
      series: rows.slice(-104).map((r, k) => { const j = i - 103 + k, ma = j >= 39 ? mean(px[a.id].slice(j - 39, j + 1)) : null; return [r.d, rnd(px[a.id][j], 3), rnd(ma, 3)] }),
      signals: signals.filter(s => s.market === a.market).map(s => s.id) }))
    const oil = onWeeks(F.DCOILWTICO, weeks), oil13 = fin(oil[i]) && fin(oil[i - 13]) ? oil[i] / oil[i - 13] - 1 : null
    // how long the cell has held, and the last time it changed
    let since = i
    while (since > 0 && rows[since - 1].cell === last.cell) since--
    const book = playbook(rows, px)
    return {
      built: new Date(now()).toISOString(), asOf: last.d, errors,
      now: { cell: last.cell, cellLabel: CELLS[last.cell]?.label || null, liquidity: last.liq, growth: last.growth, liqAgree: last.liqAgree, growthAgree: last.growthAgree, clarity: last.clarity, flips: last.flips,
        stance: stance ? { label: stance[1], note: stance[2] } : null, since: rows[since].d, weeksInCell: i - since + 1 },
      signals, markets, context: { oil: { level: rnd(oil[i], 2), change13: rnd(oil13, 4), note: 'WTI crude, shown for context and not graded: oil moves on supply as much as on demand' } },
      history: rows.map(r => [r.d, r.liq, r.growth, r.clarity, r.cell ? Object.keys(CELLS).indexOf(r.cell) : null]),
      cells: CELLS, playbook: book, stances: STANCES.map(([min, label, note]) => ({ min: Math.max(0, min), label, note })),
      method: [
        'Each signal is the market\'s 13-week move divided by its typical 13-week move over the prior three years (at least one year needed), clipped to ±2, and signed so that + means easier money or a stronger economy ahead. Cuts priced is a level: 50 basis points of cuts priced scores +1.',
        'Each axis is the average of its signals, with at least two on file. The signs of the two axes place the week in a cell.',
        'Clarity, 0 to 100: for each axis, agreement (half the signals agreeing counts 0, all of them 1) times strength (an average score of 0.75 or more counts in full); the two axes averaged; then each change of cell in the past eight weeks takes off a fifth, to a floor of 0.4.',
        'Trend: a market above its 40-week average with positive 26-week momentum is in an uptrend; below with negative momentum, a downtrend; otherwise turning.',
        'Playbook: every past week in a cell, and what each market did over the next 26 weeks. Overlapping windows and few separate episodes: a cell seen in three runs is three data points, not hundreds.',
        'Inputs start at different dates (real yields 2003, gold 2004, regional banks 2006, the broad dollar 2006 with the major-currency index spliced before it, the copper ETF late 2011 with the IMF\'s monthly copper price before it), so early readings rest on fewer signals.',
      ],
      source: 'FRED (Federal Reserve, Treasury, ICE, Moody\'s, IMF copper) and Financial Modeling Prep daily closes; the reading rules are this dashboard\'s',
    }
  }

  async function get() {
    if (cache && now() - cache.ts < 6 * H) return cache.out
    if (!inflight) inflight = build().then(out => { cache = { ts: now(), out }; return out }).finally(() => { inflight = null })
    return inflight
  }
  return { get }
}
