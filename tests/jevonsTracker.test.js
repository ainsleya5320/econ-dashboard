import test from 'node:test'
import assert from 'node:assert/strict'
import { dailyPrice, modelDays, windowOf, entitySeries, stats, verdictOf, buildTable, pickModels } from '../server/jevonsTracker.js'

const day = k => new Date(Date.UTC(2026, 9, 26 + k)).toISOString().slice(0, 10)

test('jevons: a daily price is the endpoints\' prices weighted by their tokens', () => {
  const p = dailyPrice({
    providerSummaries: [{ endpointId: 'a', totalTokens: 300 }, { endpointId: 'b', totalTokens: 100 }, { endpointId: 'c', totalTokens: 0 }],
    inputChartData: [{ x: '2026-11-01 00:00:00', y: { a: 1, b: 3, c: 99 } }, { x: '2026-11-02 00:00:00', y: { c: 5, d: 7 } }],
    outputChartData: [{ x: '2026-11-01 00:00:00', y: { a: 10, b: 10 } }],
  })
  assert.deepEqual(p['2026-11-01'], [1.5, 10])        // (1×300 + 3×100) ÷ 400; the endpoint with no tokens does not count
  assert.deepEqual(p['2026-11-02'], [6, null])        // nobody there has tokens on file: a plain average
})

test('jevons: only complete days are kept, a missing price is carried a week at most, free is priced at zero', () => {
  const act = [1, 2, 3, 12, 20].map(d => ({ date: `2026-11-${String(d).padStart(2, '0')} 00:00:00`, total_prompt_tokens: 900, total_completion_tokens: 100, total_native_tokens_cached: 2000 }))
  const days = modelDays(act, { '2026-11-01': [1, 5], '2026-11-02': [null, 5] }, '2026-11-20')
  assert.deepEqual(Object.keys(days), ['2026-11-01', '2026-11-02', '2026-11-03', '2026-11-12'])   // the 20th is today: partial
  assert.deepEqual(days['2026-11-01'], [900, 100, 900, 1, 5])                                       // cached cannot exceed prompt
  assert.deepEqual(days['2026-11-03'].slice(3), [1, 5])                                             // carried from the 1st
  assert.deepEqual(days['2026-11-12'].slice(3), [null, null])                                       // eleven days on: too old to carry
  assert.deepEqual(modelDays(act, 'free', '2026-11-20')['2026-11-12'].slice(3), [0, 0])
})

test('jevons: the window drops days most models have no row for; spend is tokens at the price paid', () => {
  const paid = Object.fromEntries([0, 1, 2, 3].map(k => [day(k), [800, 200, 0, 1, 5]]))
  const free = Object.fromEntries([0, 1, 2].map(k => [day(k), [1000, 0, 0, 0, 0]]))
  const models = [{ variant: 'standard', days: { [day(-1)]: [8, 2, 0, 9, 9], ...paid } }, { variant: 'standard', days: paid }, { variant: 'free', days: { ...free, [day(3)]: [1000, 0, 0, null, null] } }]
  const win = windowOf(models)
  assert.deepEqual(win, { from: day(0), to: day(3) })                      // the day before has one model of three
  const s = entitySeries(models, win)
  assert.equal(s.length, 4)
  assert.deepEqual([s[0].tokens, s[0].free, s[0].spend], [3000, 1000, 0.0036])   // two paid models: 2 × (800×1 + 200×5) ÷ 1e6
  assert.equal(Math.round(s[0].price * 1000) / 1000, 1.2)                         // dollars per million over all 3,000 tokens
  assert.deepEqual([s[3].tokens, s[3].unpriced], [2000, 1000])                    // an unpriced model-day is left out and counted
})

test('jevons: changes are week against week, β is the log-log slope, and the verdict reads direction first', () => {
  // price halves over 28 days while volume quadruples along a clean log-log line: β = −2
  const series = Array.from({ length: 28 }, (_, k) => { const price = 2 * 0.5 ** (k / 27), tokens = 1e9 * (2 / price) ** 2; return { d: day(k), tokens, spend: (tokens * price) / 1e6, price, free: 0 } })
  const st = stats(series)
  assert.deepEqual([st.days, st.edge, st.beta, st.r2, st.fitDays], [28, 7, -2, 1, 28])
  assert.ok(st.dPrice < -0.35 && st.dTokens > 1.5 && st.dSpend > 0.5)
  assert.equal(st.verdict, 'Jevons holds')
  assert.equal(stats(series.slice(0, 5)).verdict, 'too few days')
  assert.equal(stats(series.slice(0, 8)).beta, null)                           // eight days: changes yes, a fit no
  const v = o => verdictOf({ price: [1, 1], spend: 1, ...o })
  assert.equal(v({ dPrice: 0.2, dSpend: 0.5 }), 'price rose')
  assert.equal(v({ dPrice: -0.01, dSpend: 0.5 }), 'price flat')
  assert.equal(v({ dPrice: -0.3, dSpend: -0.1, beta: -1.4, r2: 0.7 }), 'spend shrank')
  assert.equal(v({ dPrice: -0.3, dSpend: 0.2, beta: -0.4, r2: 0.02 }), 'no price–volume link')
  assert.equal(v({ dPrice: -0.3, dSpend: 0.2, beta: -0.99, r2: 0.6 }), 'spend grew')
  assert.equal(v({ dPrice: -0.3, dSpend: 0.2, beta: -2.6, r2: 0.24 }), 'spend grew')
  assert.equal(v({ dPrice: -0.3, dSpend: 0.2, beta: -1.4, r2: 0.48 }), 'Jevons holds')
  assert.equal(verdictOf({ price: [0, 0], spend: 0 }), 'free only')
  assert.equal(verdictOf({ price: [0, 0.04], spend: 10 }), 'price rose')       // free turning paid
})

test('jevons: labs are grouped by name, largest first, and shares are of everything tracked', () => {
  const days = v => Object.fromEntries(Array.from({ length: 14 }, (_, k) => [day(k), [v * (1 + k), v, 0, 1, 2]]))
  const t = buildTable({ labs: { acme: 'Acme', 'acme-labs': 'Acme' }, models: {
    a: { slug: 'acme/one', variant: 'standard', lab: 'acme', name: 'One', days: days(100) },
    b: { slug: 'acme-labs/two', variant: 'standard', lab: 'acme-labs', name: 'Two', days: days(50) },
    c: { slug: 'zed/z', variant: 'free', lab: 'zed', name: 'Z', days: Object.fromEntries(Object.entries(days(10)).map(([d, x]) => [d, [x[0], x[1], 0, 0, 0]])) } } })
  assert.deepEqual(t.labs.map(l => [l.id, l.name, l.models]), [['acme+acme-labs', 'Acme', 2], ['zed', 'zed', 1]])
  assert.equal(t.labs[1].verdict, 'free only')
  assert.equal(t.labs[1].freeShare, 1)
  assert.equal(Math.round((t.labs[0].share + t.labs[1].share) * 1000) / 1000, 1)
  assert.equal(t.all.days, 14)
  assert.deepEqual(t.labs[0].top.map(m => m.name), ['One', 'Two'])
})

test('jevons: the read list is the month\'s largest up to the cover, plus what is on file and still active', () => {
  const month = [['a/big', 900], ['b/mid', 80], ['c/small', 15], ['d/tiny', 5]].map(([model_permaslug, t]) => ({ model_permaslug, variant: 'standard', total_prompt_tokens: t, total_completion_tokens: 0 }))
  const store = { models: { 'old/live|standard': { slug: 'old/live', variant: 'standard', days: { '2026-11-20': [1, 1, 0, 1, 1] } }, 'old/dead|standard': { slug: 'old/dead', variant: 'standard', days: { '2026-09-01': [1, 1, 0, 1, 1] } } } }
  const p = pickModels(month, store, '2026-11-25', { cover: 0.99, maxModels: 10, idleDays: 14 })
  assert.deepEqual(p.list.map(m => m.slug), ['a/big', 'b/mid', 'c/small', 'old/live'])
  assert.equal(p.coverage, 0.995)
})
