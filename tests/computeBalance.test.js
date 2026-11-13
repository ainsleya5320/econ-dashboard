import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBalance, growthRace, yearChange } from '../server/computeBalance.js'

const prices = (now, then) => ({ '2025-11-10': { h100: then, a100: 1 }, '2026-05-10': { h100: (now + then) / 2, a100: 1 }, '2026-11-12': { h100: now, a100: 0.7 } })
const grade = (board, id) => board.signals.find(s => s.id === id).grade

test('reads a price against the same day a year earlier', () => {
  const y = yearChange(prices(3, 2.5), 'h100')
  assert.deepEqual([y.d1, y.d0, y.now, y.then], ['2026-11-12', '2025-11-10', 3, 2.5])
  assert.equal(y.chg.toFixed(2), '0.20')
  assert.equal(yearChange({ '2026-11-12': { h100: 3 } }, 'h100').chg, null)   // nothing a year back
  assert.equal(yearChange({}, 'h100'), null)
})

test('an ageing chip renting for more is a shortage; one falling more than a quarter is a glut', () => {
  const b = buildBalance({ contract: prices(3, 2.5), spotH100: 2.9 })
  assert.equal(grade(b, 'h100-contract'), 'shortage')
  assert.equal(grade(b, 'a100-contract'), 'glut')              // 1.00 → 0.70
  assert.equal(grade(b, 'spot-contract'), 'shortage')          // 2.9 / 3.0 = 0.97
  assert.equal(grade(buildBalance({ contract: prices(3, 2.5), spotH100: 2 }), 'spot-contract'), 'glut')   // 0.67
  assert.equal(grade(buildBalance({ contract: prices(2.3, 2.5), spotH100: 2 }), 'h100-contract'), 'balanced')
})

test('grades the curve, availability and spot discounts by their printed rules', () => {
  const b = buildBalance({
    futures: { history: { H100: [{ d: '2026-11-12', front: 3, m12: 2.7, volume: 0 }] } },                      // +11%: backwardation
    shadeform: { asOf: '2026-11-13T00:00:00Z', byGpu: { H100: { rows: 80, available: 2 }, B200: { rows: 20, available: 0 }, 'RTX 4090': { rows: 50, available: 50 } } },
    hyperscalers: { built: '2026-11-13', byGpu: { H100: { awsRatioMedian: 0.3 }, H200: { awsRatioMedian: 0.35 } } },
    nebius: { byGpu: [{ vsFixed: 20, ceilShare7: 0.1, floorShare7: 0 }, { vsFixed: 14, ceilShare7: 0, floorShare7: 0 }] },
    resale: { series: [{ month: '2025-10', index: 100 }, { month: '2026-10', index: 108 }] },
  })
  assert.equal(grade(b, 'futures-curve'), 'shortage')
  assert.equal(grade(b, 'launchable'), 'shortage')              // 2 of 100 data-center listings; consumer cards are not counted
  assert.match(b.signals.find(s => s.id === 'launchable').reading, /2 of 100/)
  assert.equal(grade(b, 'cloud-spot'), 'glut')                  // spot at a third of list
  assert.equal(grade(b, 'spot-auction'), 'shortage')
  assert.equal(grade(b, 'resale'), 'shortage')
  assert.equal(grade(buildBalance({ futures: { history: { H100: [{ d: 'x', front: 2.5, m12: 3 }] } } }), 'futures-curve'), 'glut')   // contango
})

test('revenue per compute dollar and backlog growth read orders against deliveries', () => {
  const lab = { name: 'Lab', quarters: [{ label: 'Q4', end: '2025-12-31', revenue: 100, compute: 200 }, { label: 'Q1', end: '2026-03-31', revenue: 300, compute: 250 }, { label: 'Q2', end: '2026-06-30', revenue: 600, compute: 300 }] }
  const backlog = [
    [{ end: '2025-06-30', value: 100 }, { end: '2026-06-30', value: 200 }],                                   // +100% over a year
    [{ end: '2025-09-30', value: 50 }, { end: '2026-06-30', value: 80 }],                                     // nine months, annualised
    [{ end: '2026-03-31', value: 10 }, { end: '2026-06-30', value: 30 }],                                     // three months: too short to count
  ]
  const b = buildBalance({ lab, backlog })
  assert.equal(grade(b, 'revenue-per-compute'), 'shortage')     // $0.50 → $2.00
  const s = b.signals.find(x => x.id === 'backlog')
  assert.equal(s.grade, 'shortage')
  assert.match(s.reading, /across 2 suppliers/)
  assert.equal(grade(buildBalance({ lab: { name: 'Lab', quarters: [...lab.quarters].reverse().map((q, i) => ({ ...q, label: `r${i}` })) } }), 'revenue-per-compute'), 'glut')
})

test('the verdict is the count, and missing feeds are left ungraded', () => {
  const none = buildBalance({})
  assert.equal(none.verdict, 'no data')
  assert.equal(none.counts.ungraded, none.signals.length)
  const short = buildBalance({ contract: prices(3, 2.5), spotH100: 2.9 })
  assert.deepEqual([short.counts.shortage, short.counts.glut, short.graded], [2, 1, 3])
  assert.equal(short.verdict, 'balanced')                       // two against one is not yet a lean
  const lean = buildBalance({ contract: { ...prices(3, 2.5), '2025-11-10': { h100: 2.5, a100: 0.5 } }, spotH100: 2.9 })
  assert.equal(lean.verdict, 'shortage')                        // all three
})

test('the growth race lists yearly multiples for each side and flags the forecast', () => {
  const g = growthRace({
    tokens: { growth: { w52: 400, w52Since: '2025-11-17' } },
    runRates: { Lab: [{ d: '2025-05', t: 2025.37, v: 5 }, { d: '2026-05', t: 2026.37, v: 20 }] },
    capex: { now: 600, prev: 300, end: '2026-09' },
    chain: [{ label: 'Foundry', yoy3: 0.5, m: '2026-10' }],
    scenario: { year: 2026, stock: { 2025: 18, 2026: 40 } },
  })
  assert.deepEqual(g.demand.map(r => r.multiple), [5, 4])
  assert.deepEqual(g.supply.map(r => [r.multiple, !!r.forecast]), [[2, false], [1.5, false], [2.22, true]])
})
