import { test } from 'node:test'
import assert from 'node:assert/strict'
import { monthly, windowAt, table, build, PIECES, CORE_PIECES } from '../server/inflationDecomp.js'

// A made-up economy where every piece's price grows at its own steady monthly rate and spending shares are fixed,
// so the answers can be worked by hand: a piece adds its share times its rate.
const SHARE = { services: 0.5, housing: 0.15, otherGoods: 0.1, durables: 0.1, food: 0.1, energy: 0.05 }
const RATE = { services: 0.003, housing: 0.004, otherGoods: 0.001, durables: 0, food: 0.002, energy: 0.02 }
const month = i => `${2024 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}-01`

function economy(n = 40, skip = null) {
  // aggregate price levels are built month by month from the pieces, the way a chained index is
  const agg = { total: PIECES, core: CORE_PIECES, coreExHousing: ['services', 'otherGoods', 'durables'] }
  const level = Object.fromEntries([...PIECES, ...Object.keys(agg)].map(k => [k, 100]))
  const data = Object.fromEntries([...PIECES, ...Object.keys(agg)].filter(k => k !== 'housing' && k !== 'otherGoods').map(k => [k, { price: [], nominal: [] }]))
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      for (const p of PIECES) level[p] *= 1 + RATE[p]
      for (const [k, members] of Object.entries(agg)) { const w = members.reduce((s, m) => s + SHARE[m], 0); level[k] *= 1 + members.reduce((s, m) => s + SHARE[m] * RATE[m], 0) / w }
    }
    if (i === skip) continue
    const d = month(i), spend = k => 1000 * (agg[k] ? agg[k].reduce((s, m) => s + SHARE[m], 0) : SHARE[k])
    for (const k of Object.keys(data)) {
      data[k].price.push({ d, v: level[k] })
      // the two "excluding housing" aggregates are published in $ millions
      data[k].nominal.push({ d, v: spend(k) * (k === 'coreExHousing' || k === 'services' ? 1000 : 1) })
    }
  }
  return data
}

const near = (a, b, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`)

test('a month\'s pieces are share times price change, the derived pieces included, and they sum to the headline', () => {
  const rows = monthly(economy())
  const r = rows[5]
  for (const p of PIECES) { near(r.c[p], SHARE[p] * RATE[p] * 100); near(r.w[p], SHARE[p]) }
  near(PIECES.reduce((s, p) => s + r.c[p], 0), (r.P / r.P0 - 1) * 100)
  near(r.coreShare, 0.85)
})

test('twelve months compound to the published rate with nothing left over', () => {
  const rows = monthly(economy()), w = windowAt(rows, rows.length - 1, 12)
  near(w.total, (rows.at(-1).P / rows.at(-13).P - 1) * 100, 1e-3)
  near(PIECES.reduce((s, p) => s + w[p], 0), w.total, 2e-3)
  assert.ok(Math.abs(w.resid) < 2e-3)
  assert.ok(w.energy > w.durables && w.durables === 0)     // a flat price adds nothing whatever its weight
  assert.equal(windowAt(rows, 5, 12), null)                  // not enough months yet
})

test('core uses the four core pieces with shares of core spending', () => {
  const rows = monthly(economy()), w = windowAt(rows, rows.length - 1, 12, 'core')
  assert.deepEqual(Object.keys(w).filter(k => !['d', 'total', 'resid'].includes(k)), CORE_PIECES)
  near(w.total, (rows.at(-1).C / rows.at(-13).C - 1) * 100, 1e-3)
  near(CORE_PIECES.reduce((s, p) => s + w[p], 0), w.total, 2e-3)
  // services is half of all spending but 0.5 / 0.85 of core, so it adds more to core than to the headline
  assert.ok(w.services > windowAt(rows, rows.length - 1, 12).services)
})

test('three months are annualised with the total; one month is left as quoted', () => {
  const rows = monthly(economy()), i = rows.length - 1
  const m3 = windowAt(rows, i, 3), m1 = windowAt(rows, i, 1, 'headline', false)
  near(m3.total, (Math.pow(rows[i].P / rows[i - 3].P, 4) - 1) * 100, 1e-3)
  near(PIECES.reduce((s, p) => s + m3[p], 0), m3.total, 2e-3)
  near(m1.total, (rows[i].P / rows[i].P0 - 1) * 100, 1e-3)
  near(m1.energy, 0.1, 1e-3)                                 // 5% of spending rising 2% in the month
})

test('the table sets each piece against a 2% pace and the column sums to the gap', () => {
  const t = table(monthly(economy()))
  assert.equal(t.pieces.length, 6)
  near(t.pieces.reduce((s, p) => s + p.weight, 0), 1, 1e-3)
  near(t.pieces.reduce((s, p) => s + p.vsTarget, 0), t.total - 2, 0.01)
  const energy = t.pieces.find(p => p.id === 'energy'), durables = t.pieces.find(p => p.id === 'durables')
  assert.ok(energy.vsTarget > 0 && durables.vsTarget < 0)
  near(durables.vsTarget, -0.2, 1e-3)                        // 10% of spending, flat prices: 0.2 points below a 2% pace
  // a piece with its own published index reports that index's rate exactly; a derived piece is marked implied
  near(energy.rate, (Math.pow(1.02, 12) - 1) * 100, 0.01)
  assert.equal(energy.implied, false)
  const housing = t.pieces.find(p => p.id === 'housing')
  assert.equal(housing.implied, true)
  assert.ok(Math.abs(housing.rate - (Math.pow(1.004, 12) - 1) * 100) < 0.2)
})

test('a missing month breaks the window instead of counting a two-month change as one', () => {
  const rows = monthly(economy(40, 30))
  assert.ok(rows.every(r => r.d !== month(30) && r.prev !== month(29) || r.d === month(29)))
  const i = rows.findIndex(r => r.d === month(33))
  assert.equal(windowAt(rows, i, 12), null)                  // the window spans the hole
  assert.ok(windowAt(rows, rows.length - 1, 3))              // a window clear of it still reads
  assert.ok(build(economy()).fit.maxGap < 0.01)
})
