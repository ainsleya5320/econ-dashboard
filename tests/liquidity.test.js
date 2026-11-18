import { test } from 'node:test'
import assert from 'node:assert/strict'
import { realizedVol, maxOver, buildLiquidity, leadTest, GAUGES, LAYERS } from '../server/liquidity.js'
import { fridays } from '../server/crossAsset.js'

test('realized volatility is the standard deviation of the last 20 daily changes, in basis points', () => {
  const daily = Array.from({ length: 40 }, (_, k) => ({ d: `2026-01-${String(k + 1).padStart(2, '0')}`.replace(/-(3\d|4\d)$/, m => `-${m.slice(1)}`), v: 4 + (k % 2 ? 0.05 : 0) }))
    .map((r, k) => ({ d: new Date(Date.UTC(2026, 0, 1 + k)).toISOString().slice(0, 10), v: r.v }))
  const v = realizedVol(daily, ['2026-01-10', '2026-02-09'])
  assert.equal(v[0], null)                                   // fewer than 20 changes so far
  assert.ok(Math.abs(v[1] - 5.13) < 0.05, `${v[1]}`)        // alternating ±5 bp
})

test('a facility drawn for a day still shows for four weeks', () => {
  const daily = [{ d: '2026-03-02', v: 0 }, { d: '2026-03-03', v: 30 }, { d: '2026-03-04', v: 0 }, { d: '2026-04-20', v: 0 }]
  assert.deepEqual(maxOver(daily, ['2026-03-06', '2026-03-27', '2026-04-24']), [30, 30, 0])
})

// a synthetic system where everything eases steadily, with some noise
function easing(n) {
  const wob = k => 1 + 0.01 * Math.sin(k * 1.7), up = k => 1 + k * 0.003, w = {}
  const series = (f) => Array.from({ length: n }, (_, k) => f(k))
  Object.assign(w, {
    WALCL: series(k => 7e6 * up(k) * wob(k)), WTREGEN: series(k => 7e5 / up(k) * wob(k)), WLRRAL: series(k => 3e5 / up(k) * wob(k)),
    WRESBAL: series(() => 3.5e6), TLAACBW027SBOG: series(() => 24000), RRPONTSYD: series(() => 400), WSHOTSL: series(k => 4e6 * up(k)), WSHOMCB: series(() => 2e6),
    WLCFLPCL: series(() => 1000), SWPT: series(() => 0), RPONTTLD_max4: series(() => 0), SOFR: series(() => 4), IORB: series(() => 4.1), IOER: series(() => null),
    SOFR1: series(k => 3.95), SOFR99: series(k => 4.2 - k * 0.0005 * wob(k)), SOFRVOL: series(k => 2000 * up(k) * wob(k)),
    M2SL: series(k => 20000 * (1 + k * 0.0015)), CPIAUCSL: series(k => 300 * (1 + k * 0.0004)), TOTLL: series(k => 12000 * (1 + k * 0.0012)), DPSACBW027SBOG: series(k => 17000 * (1 + k * 0.001)),
    DRTSCILM: series(() => -5), THREEFYTP10: series(k => 1 - k * 0.002 * wob(k)), rateVol: series(k => 6 - k * 0.01 * wob(k)),
    BAMLC0A0CM: series(k => 1.2 - k * 0.001 * wob(k)), BAMLH0A0HYM2: series(k => 4 - k * 0.003 * wob(k)), BAA10Y: series(k => 2 - k * 0.002 * wob(k)), NFCI: series(k => -0.3 - k * 0.002 * wob(k)),
    DTWEXBGS: series(k => 120 / up(k) * wob(k)), ECBASSETSW: series(k => 6e6 * up(k)), DEXUSEU: series(() => 1.1), JPNASSETS: series(k => 7e6 * up(k)), DEXJPUS: series(() => 150),
  })
  return w
}

test('when every gauge eases, most grade expanding and the composite is positive', () => {
  const n = 260, weeks = fridays('2020-01-03', '2025-12-31').slice(0, n)
  const L = buildLiquidity(easing(n), weeks)
  assert.ok(L.composite[L.i] > 0.3, `composite ${L.composite[L.i]}`)
  const grades = Object.fromEntries(L.gauges.map(q => [q.g.id, q.gradeAt(L.i)]))
  assert.equal(grades.reserveShare, 'expanding')            // 3,500 / 24,000 = 14.6%
  assert.equal(grades.rrpBuffer, 'expanding')
  assert.equal(grades.sofrIorb, 'expanding')                // 10 bp under the reserve rate
  assert.equal(grades.standards, 'expanding')
  assert.equal(grades.facilities, 'expanding')
  assert.equal(grades.realM2, 'expanding')                  // money ~8% a year against prices ~2%
  for (const id of ['dollar', 'baa', 'nfci']) assert.notEqual(grades[id], 'contracting', id)
})

test('every gauge belongs to a layer, and every layer has a gauge', () => {
  const layers = new Set(LAYERS.map(l => l[0]))
  for (const g of GAUGES) assert.ok(layers.has(g.layer), g.id)
  for (const l of layers) assert.ok(GAUGES.some(g => g.layer === l), l)
  for (const g of GAUGES.filter(g => g.kind === 'flow')) assert.ok([1, -1].includes(g.sign), g.id)
  for (const g of GAUGES.filter(g => g.kind === 'level')) assert.equal(typeof g.grade, 'function', g.id)
})

test('the lead test sorts forward returns by composite band', () => {
  const comp = Array.from({ length: 200 }, (_, k) => (k < 100 ? 1 : -1))
  const spx = Array.from({ length: 200 }, (_, k) => (k < 113 ? 100 * 1.01 ** k : 100 * 1.01 ** 113 * 0.995 ** (k - 113)))
  const t = leadTest(comp, spx, [13])[13]
  assert.equal(t.bands[0].label.startsWith('Easier'), true)
  assert.ok(t.bands[0].median > 0 && t.bands[2].median < 0)
  assert.equal(t.bands[1].weeks, 0)
})
