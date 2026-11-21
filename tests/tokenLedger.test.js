import test from 'node:test'
import assert from 'node:assert/strict'
import { perDay, yearOf, yearlyMultiple, buildSeries, createTokenLedger } from '../server/tokenLedger.js'

test('stated figures convert to tokens per day', () => {
  assert.equal(perDay(7e9, 'tokens per minute'), 7e9 * 1440)
  assert.equal(perDay(304, 'tokens per month'), 10)
  assert.equal(perDay(70, 'tokens per week'), 10)
  assert.equal(perDay(3650, 'tokens per year'), 10)
  assert.equal(perDay(5, 'tokens per day'), 5)
  assert.equal(perDay(5, 'customers'), null)
  assert.ok(Math.abs(yearOf('2026-05') - (2026 + 4.5 / 12)) < 1e-9)
  assert.equal(yearOf('May 2026'), null)
})

test('growth is the yearly multiple against the figure nearest a year earlier, at least six months back', () => {
  const pt = (asOf, perDay) => ({ asOf, t: yearOf(asOf), perDay })
  const g = yearlyMultiple([pt('2024-05', 1), pt('2025-05', 50), pt('2026-01', 200), pt('2026-05', 350)])
  assert.deepEqual([g.multiple, g.from, g.to], [7, '2025-05', '2026-05'])
  assert.equal(yearlyMultiple([pt('2026-02', 1), pt('2026-05', 3)]), null)          // three months apart
  assert.equal(yearlyMultiple([pt('2026-05', 3)]), null)
  // nine months apart is annualised
  assert.equal(yearlyMultiple([pt('2025-08', 10), pt('2026-05', 80)]).multiple, 16)
})

test('series are split by company and scope, sorted by the latest volume', () => {
  const s = buildSeries([
    { entity: 'A', series: 'API', metric: 'tokens per minute', value: 1e9, asOf: '2025-10', scope: 'API only' },
    { entity: 'A', series: 'API', metric: 'tokens per minute', value: 4e9, asOf: '2026-10', scope: 'API only, first-party' },
    { entity: 'A', series: 'all products', metric: 'tokens per month', value: 3.04e15, asOf: '2026-05', scope: 'everything' },
    { entity: 'B', metric: 'customers', value: 300, asOf: '2026-04' },
  ])
  assert.deepEqual(s.map(x => x.label), ['A, all products', 'A, API'])
  assert.equal(s[1].points.length, 2)
  assert.equal(s[1].scope, 'API only, first-party')                                // the latest wording
  assert.equal(s[1].growth.multiple, 4)
  assert.equal(s[0].growth, null)
})

test('the ledger reads the Research Database, says so when it is missing, and folds OpenRouter into one measured line', async () => {
  const missing = { available: false, reason: 'none' }
  const none = createTokenLedger({ research: { read: async () => null, missing: () => missing }, pulse: async () => null })
  assert.equal(await none.get(), missing)
  const volumes = [{ entity: 'A', metric: 'tokens per day', value: 5e12, asOf: '2026-06' }, { entity: 'OpenRouter', series: 'stated', metric: 'tokens per week', value: 7e11, asOf: '2025-01' }, { entity: 'OpenRouter', series: 'stated', metric: 'tokens per week', value: 7e13, asOf: '2026-05' }]
  const weekly = Array.from({ length: 12 }, (_, k) => ({ d: new Date(Date.UTC(2026, 1, 2 + 7 * k)).toISOString().slice(0, 10), total: 7e12 * (k + 1) }))
  const led = createTokenLedger({ research: { read: async () => ({ data: { volumes, reviewed: '2026-11-21' }, source: 'local' }), missing: () => missing, researchUrl: 'x' }, pulse: async () => ({ tokens: { weekly } }) })
  const out = await led.get()
  const or = out.series.filter(s => s.entity === 'OpenRouter')
  assert.equal(or.length, 1)
  assert.equal(or[0].kind, 'measured')
  assert.equal(or[0].points[0].asOf, '2025-01')                                    // the stated figure from before the archive
  assert.ok(!or[0].points.some(p => p.asOf === '2026-05'))                         // a stated figure inside the measured span is dropped
  assert.equal(or[0].latest.perDay, 12e12)
})
