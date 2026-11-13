// ============================================================================
// INFLATION DECOMPOSITION — U.S. Economy → Inflation: what PCE inflation is made
// of, month by month. Each component's contribution to the headline (or core)
// rate, in percentage points, so the bars add up to the number everyone quotes.
//
// Source: FRED, the monthly Personal Income and Outlays release (BEA). FRED
// carries only a dozen monthly PCE price indexes (the finer product detail is
// quarterly), which is enough for six pieces that do not overlap and together
// are the whole index:
//   food               food and beverages bought for home        (direct)
//   energy             energy goods and services                 (direct)
//   durables           durable goods                             (direct)
//   services           services excluding energy and housing     (direct)
//   housing            core  −  core excluding housing
//   otherGoods         core excluding housing − services − durables
//                      (nondurable goods other than food and energy)
// Contributions add where chained price indexes do not, so the two derived
// pieces are differences of contributions, never of indexes.
//
// Method: BEA builds the index as a chained Fisher. Here each month's
// contribution is the piece's share of nominal spending in the prior month
// times its price change that month (a chained Laspeyres), and a longer window
// compounds those months along the headline index. The pieces then sum to
// within a few hundredths of a point of the published rate; that gap is
// returned as `resid` and shown, not hidden or spread over the pieces.
// The three-month window is annualised by the same factor that annualises
// the published total, so the bars still add up; the single month is left as
// the monthly change that is quoted.
// ============================================================================

export const PIECES = ['services', 'housing', 'otherGoods', 'durables', 'food', 'energy']
export const CORE_PIECES = ['services', 'housing', 'otherGoods', 'durables']
const DIRECT = ['services', 'durables', 'food', 'energy']   // pieces with a published price index of their own
const SERIES = {
  total: { price: 'PCEPI', nominal: 'PCE' },
  core: { price: 'PCEPILFE', nominal: 'DPCCRC1M027SBEA' },
  food: { price: 'DFXARG3M086SBEA', nominal: 'DFXARC1M027SBEA' },
  energy: { price: 'DNRGRG3M086SBEA', nominal: 'DNRGRC1M027SBEA' },
  durables: { price: 'DDURRG3M086SBEA', nominal: 'PCEDG' },
  coreExHousing: { price: 'IA001176M', nominal: 'LA001176M', scale: 1e-3 },   // published in $ millions
  services: { price: 'IA001260M', nominal: 'LA001260M', scale: 1e-3 },
}
const H = 3600e3
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 3) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)

// data: { key: { price: [{d, v}], nominal: [{d, v}] } } → one row per month that every series covers, from the
// second such month: the six pieces' contributions to that month's headline change (percentage points),
// each piece's share of spending going into the month, and the published price levels.
export function monthly(data) {
  const maps = {}
  for (const [k, s] of Object.entries(data)) maps[k] = { p: new Map(s.price.map(o => [o.d, o.v])), n: new Map(s.nominal.map(o => [o.d, o.v * (SERIES[k]?.scale || 1)])) }
  const keys = Object.keys(maps)
  const dates = [...maps.total.p.keys()].filter(d => keys.every(k => fin(maps[k].p.get(d)) && fin(maps[k].n.get(d)))).sort()
  const rows = []
  for (let i = 1; i < dates.length; i++) {
    const d = dates[i], d0 = dates[i - 1]
    // consecutive months only: a gap would turn a two-month change into one
    if ((+d.slice(0, 4) - +d0.slice(0, 4)) * 12 + (+d.slice(5, 7) - +d0.slice(5, 7)) !== 1) continue
    const share = k => maps[k].n.get(d0) / maps.total.n.get(d0), chg = k => maps[k].p.get(d) / maps[k].p.get(d0) - 1
    const c = Object.fromEntries(keys.map(k => [k, share(k) * chg(k) * 100])), s = Object.fromEntries(keys.map(k => [k, share(k)]))
    rows.push({
      d, prev: d0, P: maps.total.p.get(d), P0: maps.total.p.get(d0), C: maps.core.p.get(d), C0: maps.core.p.get(d0), coreShare: s.core,
      // the published index level before and after the month, for the pieces that have one
      px: Object.fromEntries(DIRECT.map(k => [k, [maps[k].p.get(d0), maps[k].p.get(d)]])),
      c: { food: c.food, energy: c.energy, durables: c.durables, services: c.services, housing: c.core - c.coreExHousing, otherGoods: c.coreExHousing - c.services - c.durables },
      w: { food: s.food, energy: s.energy, durables: s.durables, services: s.services, housing: s.core - s.coreExHousing, otherGoods: s.coreExHousing - s.services - s.durables },
    })
  }
  return rows
}

// Contributions over the h months ending at rows[i], against the headline index or the core index.
// Returns { d, total (the published rate, %), parts, resid } or null when the window is not all there.
export function windowAt(rows, i, h, base = 'headline', annualize = true) {
  if (i - h + 1 < 0) return null
  const win = rows.slice(i - h + 1, i + 1)
  if (win.some((r, k) => k > 0 && r.prev !== win[k - 1].d)) return null
  const core = base === 'core', lvl = r => (core ? r.C0 : r.P0), start = lvl(win[0]), end = core ? win.at(-1).C : win.at(-1).P
  const names = core ? CORE_PIECES : PIECES, parts = Object.fromEntries(names.map(n => [n, 0]))
  // a month's contribution to the window is its own contribution carried at that month's starting price level;
  // within core, a piece's share is of core spending, not of all spending
  for (const r of win) for (const n of names) parts[n] += (r.c[n] / (core ? r.coreShare : 1)) * (lvl(r) / start)
  const g = (end / start - 1) * 100
  const ann = h >= 12 || !annualize ? 1 : Math.abs(g) > 1e-9 ? ((Math.pow(1 + g / 100, 12 / h) - 1) * 100) / g : 12 / h
  const out = { d: win.at(-1).d, total: rnd(g * ann) }
  let sum = 0
  for (const n of names) { out[n] = rnd(parts[n] * ann); sum += parts[n] * ann }
  out.resid = rnd(g * ann - sum)
  return out
}

// The table under the chart: each piece now and a year ago, its weight, its own rate, and how far it sits
// from what it would add if its prices rose at `target` percent a year.
export function table(rows, base = 'headline', target = 2) {
  const i = rows.length - 1, now = windowAt(rows, i, 12, base), was = windowAt(rows, i - 12, 12, base), m3 = windowAt(rows, i, 3, base)
  if (!now) return null
  const core = base === 'core', names = core ? CORE_PIECES : PIECES, win = rows.slice(i - 11, i + 1)
  const pieces = names.map(n => {
    const weight = win.reduce((s, r) => s + r.w[n] / (core ? r.coreShare : 1), 0) / win.length
    // its own twelve-month rate: from its published index where there is one; for the two derived pieces,
    // what it adds over its weight, which is close for slow movers and is marked as implied
    const direct = DIRECT.includes(n), own = direct ? (win.at(-1).px[n][1] / win[0].px[n][0] - 1) * 100 : weight > 0 ? now[n] / weight : null
    return { id: n, weight: rnd(weight, 4), rate: rnd(own, 2), implied: !direct, contribution: now[n], yearAgo: was?.[n] ?? null,
      change: was ? rnd(now[n] - was[n]) : null, threeMonth: m3?.[n] ?? null, vsTarget: rnd(now[n] - weight * target) }
  })
  return { asOf: now.d, total: now.total, yearAgo: was?.total ?? null, threeMonth: m3?.total ?? null, resid: now.resid, target, pieces }
}

export function build(data, { keep = 180 } = {}) {
  const rows = monthly(data)
  if (rows.length < 14) return null
  const series = {}
  for (const base of ['headline', 'core']) {
    series[base] = {}
    // twelve months; three months annualised; and the single month as it is quoted, not annualised
    for (const [mode, h, ann] of [['yoy', 12, true], ['m3', 3, true], ['m1', 1, false]]) series[base][mode] = rows.map((_, i) => windowAt(rows, i, h, base, ann)).filter(Boolean).slice(-keep)
  }
  const gaps = series.headline.yoy.map(r => Math.abs(r.resid))
  return { asOf: rows.at(-1).d, from: series.headline.yoy[0]?.d || null, series, table: { headline: table(rows, 'headline'), core: table(rows, 'core') },
    fit: { maxGap: rnd(Math.max(...gaps), 3), meanGap: rnd(gaps.reduce((s, v) => s + v, 0) / gaps.length, 3) } }
}

export function createInflationDecomp({ fred, now = () => Date.now() }) {
  let cache = null
  async function get() {
    if (cache && now() - cache.ts < 6 * H) return cache.out
    const data = {}
    await Promise.all(Object.entries(SERIES).map(async ([k, s]) => {
      const [price, nominal] = await Promise.all([fred(s.price, 260), fred(s.nominal, 260)])
      data[k] = { price, nominal }
    }))
    const missing = Object.entries(SERIES).filter(([k]) => !data[k].price.length || !data[k].nominal.length).map(([, s]) => `${s.price}/${s.nominal}`)
    if (missing.length) throw new Error(`FRED returned nothing for ${missing.join(', ')}`)
    const built = build(data)
    if (!built) throw new Error('Not enough overlapping months to decompose')
    const out = { built: new Date(now()).toISOString(), ...built, ids: SERIES,
      source: 'FRED: BEA Personal Income and Outlays (monthly chain-type price indexes and nominal spending); contributions computed here' }
    cache = { ts: now(), out }
    return out
  }
  return { get }
}
