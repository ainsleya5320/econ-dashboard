import test from 'node:test'
import assert from 'node:assert/strict'
import { FEATURES, WEIGHTS, similarity, intensity, regimeOf, pickAnalogs, quantile, layout, neighbours, vectors, buildAnalogs } from '../server/regimeAnalogs.js'

const N = FEATURES.length, ix = Object.fromEntries(FEATURES.map((f, k) => [f.id, k]))
const vec = o => { const v = new Array(N).fill(0); for (const [k, x] of Object.entries(o)) v[ix[k]] = x; return v }

test('the six groups carry equal weight', () => {
  const by = {}
  FEATURES.forEach((f, k) => { by[f.group] = (by[f.group] || 0) + WEIGHTS[k] ** 2 })
  for (const g of Object.values(by)) assert.ok(Math.abs(g - 1) < 1e-9)
})

test('similarity is 75% direction and 25% magnitude, over the readings both dates have', () => {
  const a = vec({ spx: -1, vix: 2, y10: 1, usd: 1, oil: -1, baa: 1 })
  const same = similarity(a, a)
  assert.ok(Math.abs(same.sim - 1) < 1e-9)
  const half = similarity(a, a.map(x => x / 2))                     // same direction, half as violent
  assert.ok(Math.abs(half.cos - 1) < 1e-9); assert.ok(Math.abs(half.mag - 0.5) < 1e-9); assert.ok(Math.abs(half.sim - 0.875) < 1e-9)
  const opposite = similarity(a, a.map(x => -x))                    // direction floored at zero: only the magnitude part is left
  assert.ok(Math.abs(opposite.sim - 0.25) < 1e-9)
  const sparse = a.map((x, k) => (k < 6 ? null : x))                // too few readings in common
  assert.equal(similarity(a, sparse), null)
  assert.ok(intensity(a) > intensity(a.map(x => x / 2)))
})

test('regimes follow the printed rules', () => {
  assert.equal(regimeOf(vec({ spx: -2, vix: 2, baa: 2 })).regime, 'credit')
  assert.equal(regimeOf(vec({ spx: -1.5, vix: 0.8, baa: 0.2, y2: 1, y10: 1 })).regime, 'tightening')
  assert.equal(regimeOf(vec({ spx: -1.5, vix: 0.8, baa: 0.5, y10: -1 })).regime, 'scare')
  assert.equal(regimeOf(vec({ spx: 1.5, vix: -0.5, baa: -0.5, y2: 0.5, y10: 0.5 })).regime, 'reflation')
  assert.equal(regimeOf(vec({ spx: 1.5, vix: -0.5, baa: -0.5, y2: -0.5, y10: -0.5 })).regime, 'easing')
  assert.equal(regimeOf(vec({ spx: 0.2, vix: 0.1 })).regime, 'quiet')
  const r = regimeOf(vec({ spx: -1, vix: 1, baa: 0.3, y2: 2.5, y10: 2.5 }))
  assert.deepEqual([r.led, r.riskOff], ['rates', true])
  assert.equal(regimeOf(vec({}).map((x, k) => (k === ix.vix ? null : x))), null)
})

test('analogs are earlier, apart from each other, and can be limited to those whose future was known', () => {
  // twelve nodes of one pattern at different strengths, then today
  const base = vec({ spx: -1, vix: 1, baa: 1, y10: 1, usd: 1, oil: 1 })
  const vecs = Array.from({ length: 31 }, (_, k) => base.map(x => x * (1 + (k % 5) * 0.1)))
  const picks = pickAnalogs(vecs, 30, { gap: 6, top: 10 })
  assert.ok(picks.every(p => p.j <= 24))
  for (const p of picks) for (const q of picks) if (p !== q) assert.ok(Math.abs(p.j - q.j) >= 6)
  assert.ok(picks.length >= 3 && picks.length <= 5)                  // 0…24 holds at most five nodes six apart
  assert.ok(pickAnalogs(vecs, 30, { usable: j => j < 10 }).every(p => p.j < 10))
})

test('quantiles interpolate, and the layout is deterministic and inside the unit square', () => {
  assert.equal(quantile([1, 2, 3, 4], 0.5), 2.5)
  assert.equal(quantile([], 0.5), null)
  const vecs = Array.from({ length: 40 }, (_, k) => vec({ spx: Math.sin(k), vix: Math.cos(k * 0.7), y10: Math.sin(k * 0.3), usd: Math.cos(k * 1.3), oil: Math.sin(k * 2.1), baa: Math.cos(k) }))
  const e = neighbours(vecs), a = layout(vecs, e, 60), b = layout(vecs, e, 60)
  assert.deepEqual(a, b)
  assert.ok(a.flat().every(v => v >= 0 && v <= 1))
  assert.ok(e.every(([p, q]) => p < q && q - p >= 4))
})

test('buildAnalogs runs end to end on synthetic weekly series', () => {
  const n = 420, weeks = Array.from({ length: n }, (_, i) => new Date(Date.UTC(2015, 0, 2) + i * 7 * 864e5).toISOString().slice(0, 10))
  const wave = (p, a, b = 0) => Array.from({ length: n }, (_, i) => b + a * Math.sin(i / p))
  const px = (p, a) => wave(p, a).map((v, i) => 100 * Math.exp(v + i * 0.001))
  const s = { SPX: px(17, 0.15), RUT: px(13, 0.2), XLY: px(11, 0.1), XLP: px(19, 0.05), GOLD: px(23, 0.1), copper: px(29, 0.2), oil: px(9, 0.3),
    DGS2: wave(31, 1.5, 3), DGS10: wave(37, 1, 4), BAA10Y: wave(17, 0.8, 2), dollar: px(41, 0.08), DEXJPUS: px(27, 0.1), VIX: wave(17, 8, 20), rateVol: wave(21, 20, 90) }
  const out = buildAnalogs(weeks, s)
  assert.equal(out.asOf, weeks.at(-1))
  assert.equal(out.analogs.length, 10)
  assert.ok(out.analogs.every((a, k) => k === 0 || a.sim <= out.analogs[k - 1].sim))
  assert.ok(out.analogs.every(a => a.path.length === 27 && a.path[0] === 0 && a.why.length === FEATURES.length))
  assert.equal(out.bands.length, 27)
  assert.equal(out.nodes.length, vectors(s).filter((_, i) => (n - 1 - i) % 4 === 0 && i >= 13).length)
  assert.ok(out.backtest.n > 0 && out.backtest.signHit >= 0 && out.backtest.signHit <= 1)
  assert.ok(out.outcomes.every(o => o.base.n > 0))
})
