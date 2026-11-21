// ============================================================================
// REGIME ANALOGS — Regime Map: when has the market looked like this before?
// Every four weeks since 1990 the past 13 weeks (63 trading days) are reduced
// to one vector of sixteen cross-asset readings, and today's vector is compared
// with every earlier one.
//
//   readings   equities    S&P 500 return, small caps and cyclicals against it,
//                          how far the S&P sits below its 52-week high
//              rates       the 13-week change in the 2-year and 10-year yields
//              credit      the Baa spread: its change and its level
//              currencies  the broad dollar, the yen
//              commodities oil, gold, copper
//              volatility  the VIX (change and level) and the change in
//                          realised 10-year-yield volatility (a stand-in for
//                          the MOVE index, which is not free)
//              Each is put in units of its own full-history standard deviation
//              (levels are measured from their average), clipped to ±3, and
//              weighted so the six groups count equally.
//   similarity 75% the cosine of the two vectors (direction: are the same
//              things moving the same way; floored at zero) plus 25% how close
//              their lengths are (magnitude: is it as violent)
//   analogs    the ten most similar earlier nodes, at least 24 weeks apart and
//              at least 24 weeks before today, with what the S&P 500 and the
//              Baa spread did afterwards
//   regime     a label by printed rules from the same readings (credit stress,
//              growth scare, tightening, reflation, easing, quiet), which
//              group moved most ("rates-led"), and a stress flag
//   map        the nodes laid out by a force layout over each node's three
//              nearest non-overlapping neighbours, started from the first two
//              principal components: near means alike, but distances are not
//              to scale
//   check      the same exercise run at every past node with only what was
//              known then: did the analogs' median call the next 26 weeks?
//
// No data of its own beyond the VIX (FRED VIXCLS): everything else is the daily
// inputs server/crossAsset.js already keeps, including the S&P 500 and Russell
// 2000 indexes and gold back to 1988, which is what lets this start in 1990
// (cyclicals against defensives needs the sector funds and starts in 1999).
// Without that long history it falls back to the funds, from 1999.
// Descriptive, not a forecast.
// ============================================================================
import { fridays, onWeeks, splice, START, LONG_START } from './crossAsset.js'

const H = 3600e3, W = 13, STEP = 4, GAP = 6 /* nodes: 24 weeks */, TOP = 10, PATH = 26
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 3) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const clip = (v, a, b) => Math.max(a, Math.min(b, v))
const mean = xs => { const v = xs.filter(fin); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null }
const std = xs => { const v = xs.filter(fin); if (v.length < 2) return null; const m = mean(v); return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) }
export const quantile = (xs, q) => { const v = xs.filter(fin).sort((a, b) => a - b); if (!v.length) return null; const p = (v.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return v[lo] + (v[hi] - v[lo]) * (p - lo) }
const ratio = (a, b) => a.map((v, i) => (fin(v) && fin(b[i]) && b[i] > 0 ? v / b[i] : null))
const chg = (x, kind) => x.map((v, i) => (i >= W && fin(v) && fin(x[i - W]) ? (kind === 'log' ? (v > 0 && x[i - W] > 0 ? Math.log(v / x[i - W]) : null) : v - x[i - W]) : null))
const drawdown = x => x.map((v, i) => { const w = x.slice(Math.max(0, i - 51), i + 1).filter(fin); return fin(v) && w.length >= 40 ? v / Math.max(...w) - 1 : null })

// kind: 'log' and 'diff' are 13-week changes (scaled by their standard deviation, sign kept); 'level' is measured from its average
export const FEATURES = [
  { id: 'spx', group: 'equities', label: 'S&P 500', kind: 'log', x: s => s.SPX },
  { id: 'small', group: 'equities', label: 'Small caps against the S&P', kind: 'log', x: s => ratio(s.RUT, s.SPX) },
  { id: 'cyc', group: 'equities', label: 'Cyclicals against defensives', kind: 'log', x: s => ratio(s.XLY, s.XLP) },
  { id: 'dd', group: 'equities', label: 'S&P below its 52-week high', kind: 'level', x: s => drawdown(s.SPX) },
  { id: 'y2', group: 'rates', label: '2-year yield', kind: 'diff', x: s => s.DGS2 },
  { id: 'y10', group: 'rates', label: '10-year yield', kind: 'diff', x: s => s.DGS10 },
  { id: 'baa', group: 'credit', label: 'Baa credit spread', kind: 'diff', x: s => s.BAA10Y },
  { id: 'baaLvl', group: 'credit', label: 'Baa credit spread, level', kind: 'level', x: s => s.BAA10Y },
  { id: 'usd', group: 'currencies', label: 'Broad dollar', kind: 'log', x: s => s.dollar },
  { id: 'jpy', group: 'currencies', label: 'Yen against the dollar', kind: 'log', x: s => s.DEXJPUS.map(v => (fin(v) && v > 0 ? 1 / v : null)) },
  { id: 'oil', group: 'commodities', label: 'Oil (WTI)', kind: 'log', x: s => s.oil },
  { id: 'gold', group: 'commodities', label: 'Gold', kind: 'log', x: s => s.GOLD },
  { id: 'copper', group: 'commodities', label: 'Copper', kind: 'log', x: s => s.copper },
  { id: 'vix', group: 'volatility', label: 'VIX', kind: 'diff', x: s => s.VIX },
  { id: 'vixLvl', group: 'volatility', label: 'VIX, level', kind: 'level', x: s => s.VIX.map(v => (fin(v) && v > 0 ? Math.log(v) : null)) },
  { id: 'rateVol', group: 'volatility', label: 'Rate volatility', kind: 'diff', x: s => s.rateVol },
]
export const GROUPS = ['equities', 'rates', 'credit', 'currencies', 'commodities', 'volatility']
// each group counts equally: a feature's weight is 1/√(features in its group)
export const WEIGHTS = FEATURES.map(f => 1 / Math.sqrt(FEATURES.filter(g => g.group === f.group).length))
const MIN_COMMON = 12

export const REGIMES = {
  credit: { label: 'Credit stress / vol shock', stress: true },
  scare: { label: 'Growth scare', stress: true },
  tightening: { label: 'Tightening / rates shock', stress: false },
  reflation: { label: 'Risk-on / reflation', stress: false },
  easing: { label: 'Risk-on / easing', stress: false },
  quiet: { label: 'Quiet', stress: false },
}
export const REGIME_ORDER = ['credit', 'scare', 'tightening', 'reflation', 'easing', 'quiet']

// Fixed benchmark episodes: shown whether today resembles them or not
export const EPISODES = [
  ['Gulf War recession (1990)', '1990-08-01', '1991-01-31'], ['Bond rout (1994)', '1994-02-01', '1994-12-15'], ['Asian crisis (1997)', '1997-10-01', '1997-12-31'], ['Russia and LTCM (1998)', '1998-08-01', '1998-10-31'],
  ['Dot-com bust', '2000-04-01', '2001-04-30'], ['September 2001', '2001-09-14', '2001-11-30'], ['2002 credit and accounting', '2002-06-01', '2002-10-31'],
  ['Financial crisis', '2008-09-01', '2009-03-31'], ['Euro crisis', '2011-08-01', '2011-11-30'], ['Taper tantrum', '2013-05-15', '2013-09-30'],
  ['China shock', '2015-08-01', '2016-02-29'], ['Vol shock (Feb 2018)', '2018-02-01', '2018-04-30'], ['Q4 2018', '2018-10-01', '2019-01-15'],
  ['COVID', '2020-03-01', '2020-04-30'], ['Inflation shock (2022)', '2022-04-01', '2022-10-31'], ['Bank stress (2023)', '2023-03-10', '2023-05-31'],
  ['Yen unwind (Aug 2024)', '2024-08-01', '2024-09-30'], ['Tariff shock (Apr 2025)', '2025-04-01', '2025-05-31'],
]

// raw weekly series → one z-vector per week (null where a reading is missing)
export function vectors(s) {
  const cols = FEATURES.map(f => {
    const v = f.kind === 'level' ? f.x(s) : chg(f.x(s), f.kind), sd = std(v), m = f.kind === 'level' ? mean(v) : 0
    return v.map(x => (fin(x) && fin(sd) && sd > 0 ? clip((x - m) / sd, -3, 3) : null))
  })
  return cols[0].map((_, i) => cols.map(c => c[i]))
}

// 75% direction (cosine over the readings both have, floored at zero) + 25% magnitude (shorter length ÷ longer)
export function similarity(a, b) {
  let dot = 0, na = 0, nb = 0, n = 0
  for (let k = 0; k < a.length; k++) if (fin(a[k]) && fin(b[k])) { const u = a[k] * WEIGHTS[k], v = b[k] * WEIGHTS[k]; dot += u * v; na += u * u; nb += v * v; n++ }
  if (n < Math.min(MIN_COMMON, a.length) || !na || !nb) return null
  const cos = dot / Math.sqrt(na * nb), mag = Math.min(na, nb) / Math.max(na, nb)
  return { sim: 0.75 * Math.max(0, cos) + 0.25 * Math.sqrt(mag), cos, mag: Math.sqrt(mag), n }
}

// length of the weighted vector per reading present: how violent the 13 weeks were
export function intensity(a) {
  let s = 0, w = 0
  for (let k = 0; k < a.length; k++) if (fin(a[k])) { s += (a[k] * WEIGHTS[k]) ** 2; w += WEIGHTS[k] ** 2 }
  return w ? Math.sqrt(s / w) : null
}

const IDX = Object.fromEntries(FEATURES.map((f, k) => [f.id, k]))
// the label, by rule. stress = the average of stocks down, VIX up and spreads wider, in standard deviations
export function regimeOf(a) {
  const z = id => a[IDX[id]], avg = (...ids) => mean(ids.map(z))
  if (!fin(z('spx')) || !fin(z('vix')) || !fin(z('baa'))) return null
  const stress = mean([-z('spx'), z('vix'), z('baa')]), rates = avg('y2', 'y10'), com = avg('oil', 'copper')
  let regime
  if (stress >= 0.6) regime = z('baa') >= 1 && z('vix') >= 1 ? 'credit' : rates >= 0.6 ? 'tightening' : 'scare'
  else if (stress <= -0.4) regime = rates >= 0.3 || com >= 0.5 ? 'reflation' : 'easing'
  else regime = rates >= 1 ? 'tightening' : rates <= -1 ? (z('spx') < 0 ? 'scare' : 'easing') : 'quiet'
  const by = { equities: Math.abs(z('spx')), rates: Math.abs(rates ?? 0), credit: Math.abs(z('baa')), currencies: Math.abs(z('usd') ?? 0), commodities: Math.abs(com ?? 0), volatility: Math.abs(z('vix')) }
  const led = Object.entries(by).sort((p, q) => q[1] - p[1])[0][0]
  return { regime, led, stress: rnd(stress, 2), riskOff: stress >= 0.6 }
}

// the most similar earlier nodes to node t: at least `gap` nodes before it and from each other. `usable(j)` can
// restrict further (the backtest needs the analog's own future to be known by t)
export function pickAnalogs(vecs, t, { gap = GAP, top = TOP, usable = () => true } = {}) {
  const scored = []
  for (let j = 0; j <= t - gap; j++) { if (!usable(j)) continue; const s = similarity(vecs[t], vecs[j]); if (s) scored.push({ j, ...s }) }
  scored.sort((a, b) => b.sim - a.sim)
  const out = []
  for (const c of scored) { if (out.every(o => Math.abs(o.j - c.j) >= gap)) out.push(c); if (out.length >= top) break }
  return out
}

// first two principal components of the node vectors (missing readings count as zero), by power iteration
function pca2(rows) {
  const d = rows[0].length, X = rows.map(r => r.map((v, k) => (fin(v) ? v * WEIGHTS[k] : 0)))
  const mu = Array.from({ length: d }, (_, k) => mean(X.map(r => r[k])))
  for (const r of X) for (let k = 0; k < d; k++) r[k] -= mu[k]
  const cov = Array.from({ length: d }, (_, a) => Array.from({ length: d }, (_, b) => X.reduce((s, r) => s + r[a] * r[b], 0) / X.length))
  const comps = []
  for (let c = 0; c < 2; c++) {
    let v = Array.from({ length: d }, (_, k) => 1 / (k + 1 + c))
    for (let it = 0; it < 200; it++) {
      let w = cov.map(row => row.reduce((s, x, k) => s + x * v[k], 0))
      for (const p of comps) { const dp = w.reduce((s, x, k) => s + x * p[k], 0); w = w.map((x, k) => x - dp * p[k]) }
      const n = Math.sqrt(w.reduce((s, x) => s + x * x, 0)) || 1
      v = w.map(x => x / n)
    }
    comps.push(v)
  }
  return X.map(r => comps.map(p => r.reduce((s, x, k) => s + x * p[k], 0)))
}

// A force layout (Fruchterman–Reingold) over the nearest-neighbour edges, started from the principal components, so
// the result is the same on every build. Returns positions in the unit square
export function layout(vecs, edges, iterations = 300) {
  const n = vecs.length, P = pca2(vecs)
  const span = Math.max(...P.flat().map(Math.abs)) || 1
  const pos = P.map(p => [p[0] / span, p[1] / span]), k = Math.sqrt(4 / n)
  for (let it = 0; it < iterations; it++) {
    const disp = pos.map(() => [0, 0]), temp = 0.12 * (1 - it / iterations) + 0.002
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      let dx = pos[a][0] - pos[b][0], dy = pos[a][1] - pos[b][1]
      if (!dx && !dy) { dx = ((a * 7 + b) % 11 - 5) * 1e-4; dy = ((a + b * 5) % 13 - 6) * 1e-4 }
      const d2 = Math.max(1e-6, dx * dx + dy * dy), f = (k * k) / d2
      disp[a][0] += dx * f; disp[a][1] += dy * f; disp[b][0] -= dx * f; disp[b][1] -= dy * f
    }
    for (const [a, b] of edges) {
      const dx = pos[a][0] - pos[b][0], dy = pos[a][1] - pos[b][1], d = Math.sqrt(dx * dx + dy * dy) || 1e-6, f = d / k
      disp[a][0] -= dx * f; disp[a][1] -= dy * f; disp[b][0] += dx * f; disp[b][1] += dy * f
    }
    for (let a = 0; a < n; a++) {
      disp[a][0] -= pos[a][0] * 0.6 * k; disp[a][1] -= pos[a][1] * 0.6 * k      // gentle pull to the centre
      const m = Math.sqrt(disp[a][0] ** 2 + disp[a][1] ** 2) || 1e-9, step = Math.min(m, temp)
      pos[a][0] += (disp[a][0] / m) * step; pos[a][1] += (disp[a][1] / m) * step
    }
  }
  // to the unit square, order kept: the middle 96% of nodes fills 6% to 94% of each axis and the few outliers (the
  // most extreme windows drift far out) are drawn into the margins, so a handful of crises do not squeeze the rest
  const fit = v => { const lo = quantile(v, 0.02), hi = quantile(v, 0.98), mn = Math.min(...v), mx = Math.max(...v); return x => rnd(x <= lo ? 0.06 * (x - mn) / (lo - mn || 1) : x >= hi ? 0.94 + 0.06 * (x - hi) / (mx - hi || 1) : 0.06 + 0.88 * (x - lo) / (hi - lo || 1), 4) }
  const fx = fit(pos.map(p => p[0])), fy = fit(pos.map(p => p[1]))
  return pos.map(p => [fx(p[0]), fy(p[1])])
}

// each node's `kn` most similar nodes whose 13-week windows do not overlap its own
export function neighbours(vecs, kn = 3) {
  const seen = new Set(), edges = []
  for (let a = 0; a < vecs.length; a++) {
    const near = []
    for (let b = 0; b < vecs.length; b++) if (Math.abs(a - b) >= 4) { const s = similarity(vecs[a], vecs[b]); if (s) near.push([b, s.sim]) }
    for (const [b] of near.sort((p, q) => q[1] - p[1]).slice(0, kn)) { const key = a < b ? `${a}-${b}` : `${b}-${a}`; if (!seen.has(key)) { seen.add(key); edges.push([Math.min(a, b), Math.max(a, b)]) } }
  }
  return edges
}

const summary = v => ({ n: v.filter(fin).length, median: rnd(quantile(v, 0.5), 4), p25: rnd(quantile(v, 0.25), 4), p75: rnd(quantile(v, 0.75), 4), positive: v.filter(fin).length ? rnd(v.filter(x => fin(x) && x > 0).length / v.filter(fin).length, 3) : null })

// weeks, raw weekly series → everything the panel draws
export function buildAnalogs(weeks, s) {
  const all = vectors(s), last = weeks.length - 1
  // nodes: every fourth week, counted back from the latest, once enough readings exist
  const at = []
  for (let i = last; i >= W; i -= STEP) if (all[i].filter(fin).length >= MIN_COMMON && regimeOf(all[i])) at.unshift(i)
  const vecs = at.map(i => all[i]), t = vecs.length - 1
  const fwd = (x, i, h) => (i + h <= last && fin(x[i]) && fin(x[i + h]) && x[i] > 0 ? x[i + h] / x[i] - 1 : null)
  const inten = vecs.map(intensity), rankOf = v => rnd(inten.filter(x => x <= v).length / inten.length, 3)
  const reg = vecs.map(regimeOf)
  const toNow = vecs.map((v, j) => (j === t ? null : similarity(vecs[t], v)))

  const HZ = [[4, '1 month'], [13, '3 months'], [26, '6 months'], [52, '12 months']]
  const picked = pickAnalogs(vecs, t)
  const analogs = picked.map((a, k) => {
    const i = at[a.j], why = FEATURES.map((f, q) => { const now = vecs[t][q], then = vecs[a.j][q]; return { id: f.id, label: f.label, group: f.group, kind: f.kind, now: rnd(now, 2), then: rnd(then, 2), read: !fin(now) || !fin(then) ? 'missing' : Math.abs(now) < 0.5 && Math.abs(then) < 0.5 ? 'both quiet' : Math.sign(now) === Math.sign(then) && Math.min(Math.abs(now), Math.abs(then)) >= 0.5 ? 'agree' : Math.sign(now) !== Math.sign(then) && Math.min(Math.abs(now), Math.abs(then)) >= 0.5 ? 'differ' : 'one quiet' } })
    return { rank: k + 1, node: a.j, d: weeks[i], sim: rnd(a.sim, 3), cos: rnd(a.cos, 3), mag: rnd(a.mag, 3), regime: reg[a.j].regime, led: reg[a.j].led, riskOff: reg[a.j].riskOff,
      ...Object.fromEntries(HZ.map(([h]) => [`f${h}`, rnd(fwd(s.SPX, i, h), 4)])), credit13: i + 13 <= last && fin(s.BAA10Y[i]) && fin(s.BAA10Y[i + 13]) ? rnd(s.BAA10Y[i + 13] - s.BAA10Y[i], 2) : null,
      path: Array.from({ length: PATH + 1 }, (_, h) => rnd(h === 0 ? 0 : fwd(s.SPX, i, h), 4)), why }
  })
  const bands = Array.from({ length: PATH + 1 }, (_, h) => { const v = analogs.map(a => a.path[h]); return { h, n: v.filter(fin).length, median: rnd(quantile(v, 0.5), 4), p10: rnd(quantile(v, 0.1), 4), p25: rnd(quantile(v, 0.25), 4), p75: rnd(quantile(v, 0.75), 4), p90: rnd(quantile(v, 0.9), 4) } })
  const outcomes = HZ.map(([h, label]) => ({ h, label, ...summary(analogs.map(a => a[`f${h}`])), base: summary(weeks.map((_, i) => fwd(s.SPX, i, h))) }))

  const episodes = EPISODES.map(([label, from, to]) => {
    const inside = at.map((i, j) => ({ j, d: weeks[i] })).filter(x => x.d >= from && x.d <= to && x.j !== t)
    const best = inside.map(x => ({ ...x, s: toNow[x.j]?.sim })).filter(x => fin(x.s)).sort((a, b) => b.s - a.s)[0]
    const peak = inside.sort((a, b) => inten[b.j] - inten[a.j])[0]
    return best ? { label, d: best.d, node: best.j, sim: rnd(best.s, 3), peak: peak.j, regime: reg[best.j].regime } : null
  }).filter(Boolean).sort((a, b) => b.sim - a.sim)

  // The check: at every past node with five years behind it, the ten analogs whose own next 26 weeks were already
  // known, and their median, against what the S&P then did. (The scaling of each reading uses the full history.)
  const hB = 26, test = []
  for (let q = 0; q < vecs.length - 1; q++) {
    if (at[q] - at[0] < 260) continue
    const actual = fwd(s.SPX, at[q], hB)
    if (!fin(actual)) continue
    const an = pickAnalogs(vecs, q, { usable: j => at[j] + hB <= at[q] })
    if (an.length < 5) continue
    const med = quantile(an.map(a => fwd(s.SPX, at[a.j], hB)), 0.5)
    if (fin(med)) test.push({ d: weeks[at[q]], predicted: med, actual, riskOff: reg[q].riskOff })
  }
  const share = (rows, f) => (rows.length ? rnd(rows.filter(f).length / rows.length, 3) : null)
  const neg = test.filter(r => r.predicted < 0), pos = test.filter(r => r.predicted >= 0)
  const rankCorr = (() => { if (test.length < 10) return null; const rk = v => { const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = []; o.forEach(([, i], k) => { r[i] = k }); return r }; const a = rk(test.map(r => r.predicted)), b = rk(test.map(r => r.actual)), ma = mean(a), mb = mean(b); const num = a.reduce((x, v, i) => x + (v - ma) * (b[i] - mb), 0), den = Math.sqrt(a.reduce((x, v) => x + (v - ma) ** 2, 0) * b.reduce((x, v) => x + (v - mb) ** 2, 0)); return den ? rnd(num / den, 2) : null })()
  const backtest = { horizon: hB, n: test.length, from: test[0]?.d || null, signHit: share(test, r => (r.predicted > 0) === (r.actual > 0)), alwaysUp: share(test, r => r.actual > 0), rankCorr,
    whenNegative: { n: neg.length, median: rnd(quantile(neg.map(r => r.actual), 0.5), 4), positive: share(neg, r => r.actual > 0) },
    whenPositive: { n: pos.length, median: rnd(quantile(pos.map(r => r.actual), 0.5), 4), positive: share(pos, r => r.actual > 0) } }

  const edges = neighbours(vecs), xy = layout(vecs, edges)
  const i = at[t], d13 = (x, kind) => chg(x, kind)[i]
  return {
    asOf: weeks[i], since: weeks[at[0]],
    now: { ...reg[t], label: REGIMES[reg[t].regime].label, intensity: rnd(inten[t], 2), intensityPct: rankOf(inten[t]), stressAnalogs: analogs.filter(a => a.riskOff).length, analogs: analogs.length,
      stats: { spx13: rnd(d13(s.SPX, 'log') != null ? Math.exp(d13(s.SPX, 'log')) - 1 : null, 4), small13: rnd(d13(s.RUT, 'log') != null ? Math.exp(d13(s.RUT, 'log')) - 1 : null, 4), drawdown: rnd(drawdown(s.SPX)[i], 4),
        y10: rnd(s.DGS10[i], 2), y10chg: rnd(d13(s.DGS10), 2), y2: rnd(s.DGS2[i], 2), y2chg: rnd(d13(s.DGS2), 2), curveChg: fin(d13(s.DGS10)) && fin(d13(s.DGS2)) ? rnd(d13(s.DGS10) - d13(s.DGS2), 2) : null,
        baa: rnd(s.BAA10Y[i], 2), baaChg: rnd(d13(s.BAA10Y), 2), vix: rnd(s.VIX[i], 1), vixChg: rnd(d13(s.VIX), 1), rateVol: rnd(s.rateVol[i], 0), dollar13: rnd(d13(s.dollar, 'log'), 4), oil13: rnd(d13(s.oil, 'log'), 4), gold13: rnd(d13(s.GOLD, 'log'), 4) } },
    nodes: at.map((w, j) => ({ d: weeks[w], x: xy[j][0], y: xy[j][1], regime: reg[j].regime, led: reg[j].led, riskOff: reg[j].riskOff, size: rankOf(inten[j]), sim: rnd(toNow[j]?.sim, 3) })),
    edges, analogs, bands, outcomes, episodes, backtest,
    features: FEATURES.map((f, k) => ({ id: f.id, label: f.label, group: f.group, kind: f.kind, weight: rnd(WEIGHTS[k], 3) })), regimes: REGIMES, regimeOrder: REGIME_ORDER,
  }
}

export function createRegimeAnalogs({ cross, fred, now = () => Date.now() }) {
  let cache = null, inflight = null

  async function build() {
    const [{ etf, F, end, long }, vixDaily] = await Promise.all([cross.inputs(), fred('VIXCLS', 9600)])
    // the indexes and gold reach back before the funds do; with them the record starts in 1990
    const deep = ['^GSPC', '^RUT', 'GCUSD'].every(k => long?.[k]?.length && long[k][0].d <= '1990-01-31')
    const fr = fridays(deep ? LONG_START : START, end), weeks = end > fr.at(-1) ? [...fr, end] : fr
    // realised volatility of the 10-year yield: the standard deviation of its daily changes over 63 days, in basis points a year
    const y = F.DGS10.filter(r => fin(r.v)), rv = []
    for (let k = 63; k < y.length; k++) { const c = []; for (let q = k - 62; q <= k; q++) c.push(y[q].v - y[q - 1].v); rv.push({ d: y[k].d, v: std(c) * Math.sqrt(252) * 100 }) }
    const E = id => onWeeks(etf[id] || [], weeks), R = (id, age = 12) => onWeeks(F[id] || [], weeks, age)
    const P = (sym, fund) => (deep ? onWeeks(long[sym], weeks) : E(fund))
    const s = { SPX: P('^GSPC', 'SPY'), RUT: P('^RUT', 'IWM'), XLY: E('XLY'), XLP: E('XLP'), GOLD: P('GCUSD', 'GLD'), copper: splice(E('CPER'), R('PCOPPUSDM', 45)), oil: R('DCOILWTICO'),
      DGS2: R('DGS2', 7), DGS10: R('DGS10', 7), BAA10Y: R('BAA10Y'), dollar: splice(R('DTWEXBGS'), R('DTWEXM')), DEXJPUS: R('DEXJPUS'), VIX: onWeeks(vixDaily, weeks, 7), rateVol: onWeeks(rv, weeks, 7) }
    return { built: new Date(now()).toISOString(), ...buildAnalogs(weeks, s),
      method: [
        'Each node is the 13 weeks (63 trading days) ending that week; nodes are four weeks apart, counted back from the latest close.',
        'Sixteen readings in six groups (equities, rates, credit, currencies, commodities, volatility). Changes are over the 13 weeks and are divided by that reading\'s standard deviation over the whole history; levels (the S&P\'s distance below its high, the Baa spread, the VIX) are measured from their average. Each is clipped to ±3 and weighted so the six groups count equally.',
        'Similarity is 75% direction (the cosine of the two vectors, floored at zero) and 25% magnitude (the shorter vector\'s length over the longer\'s). At least 12 of the 16 readings must exist on both dates; cyclicals against defensives starts in 1999, when the sector funds do.',
        'Analogs are the ten most similar nodes at least 24 weeks before today and at least 24 weeks from each other, so one episode cannot fill the list.',
        'Regime, by rule. Stress is the average of stocks down, the VIX up and the Baa spread wider, in standard deviations. Stress of 0.6 or more: credit stress if both the spread and the VIX rose by one standard deviation or more, tightening if yields rose 0.6 or more, otherwise a growth scare. Stress of −0.4 or less: reflation if yields or commodities rose, otherwise easing. In between: tightening or easing if yields moved a full standard deviation, otherwise quiet. "Led" names the group that moved most.',
        'The map is a force layout over each node\'s three most similar non-overlapping neighbours, started from the first two principal components. Near means alike; distances and axes are not to scale.',
        'Forward paths are the S&P 500 index (price only, no dividends) from each analog\'s date. Ten analogs is a small sample and several share the same bear markets.',
        'Differences from the Bloomberg-based original this follows: the Baa spread stands in for high-yield spreads (the free series covers three years), realised 10-year-yield volatility for the MOVE index, and history starts in 1990 because the VIX does.',
      ],
      source: 'FRED (Treasury yields, Moody\'s Baa spread, the dollar, the yen, WTI, IMF copper, Cboe VIX) and Financial Modeling Prep daily closes (S&P 500 and Russell 2000 indexes, gold, sector funds); the readings, weights and regime rules are this dashboard\'s' }
  }

  async function get() {
    if (cache && now() - cache.ts < 6 * H) return cache.out
    if (!inflight) inflight = build().then(out => { cache = { ts: now(), out }; return out }).finally(() => { inflight = null })
    return inflight
  }
  return { get }
}
