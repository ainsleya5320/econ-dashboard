import test from 'node:test'
import assert from 'node:assert/strict'
import { blend, providersOf, priceStats, usageWeighted, providerBoard, indexBySlug } from '../server/tokenMarket.js'
import { pivot, average, shape, weekOf } from '../server/gatewayShares.js'

const ep = (provider_name, prompt, completion, extra = {}) => ({ provider_name, pricing: { prompt: String(prompt / 1e6), completion: String(completion / 1e6) }, status: 0, ...extra })

test('a typical token is priced at the mix of input and output', () => {
  assert.equal(blend(1, 5, 0), 1)
  assert.equal(blend(1, 5, 1), 5)
  assert.ok(Math.abs(blend(0.1, 0.32, 0.023) - 0.10506) < 1e-9)
  assert.equal(blend(null, 5, 0.1), null)
})

test('providers: one row each at its cheapest live endpoint, free and down endpoints dropped, sorted by the mix price', () => {
  const p = providersOf([ep('A', 0.3, 0.9), ep('A', 0.1, 0.4, { quantization: 'fp8' }), ep('B', 0.2, 0.2), ep('Free', 0, 0), ep('Down', 0.01, 0.01, { status: -2 })], 0.5)
  assert.deepEqual(p.map(x => x.provider), ['B', 'A'])
  assert.deepEqual([p[1].input, p[1].output, p[1].quant], [0.1, 0.4, 'fp8'])
  const s = priceStats(p)
  assert.deepEqual([s.n, s.cheapest.provider, s.median.provider, s.dearest.provider, s.spread], [2, 'B', 'B', 'A', 1.3])
  assert.equal(priceStats([]), null)
})

test('usage-weighted list price splits open from closed and skips batch tiers and aliases', () => {
  const m = (id, slug, hf, prompt, completion, cache) => ({ id, canonical_slug: slug, hugging_face_id: hf, pricing: { prompt: String(prompt / 1e6), completion: String(completion / 1e6), ...(cache ? { input_cache_read: String(cache / 1e6) } : {}) } })
  const catalog = [m('lab/open-a', 'lab/open-a-1', 'lab/Open-A', 1, 2), m('lab/open-a:batch', 'lab/open-a-1', 'lab/Open-A', 0.5, 1), m('anthropic/closed-b', 'anthropic/closed-b-1', '', 4, 20, 0.4), m('other/closed-c', 'other/closed-c-1', '', 2, 10)]
  assert.equal(indexBySlug(catalog)['lab/open-a-1'].id, 'lab/open-a')
  const top = [{ slug: 'lab/open-a-1', tokens: 300 }, { slug: 'anthropic/closed-b-1', tokens: 100 }, { slug: 'other/closed-c-1', tokens: 100 }, { slug: 'unknown/x', tokens: 999 }]
  assert.deepEqual([usageWeighted(top, catalog, true).input, usageWeighted(top, catalog, true).models], [1, 1])
  const closed = usageWeighted(top, catalog, false)
  assert.deepEqual([closed.input, closed.output, closed.cacheRead, closed.models], [3, 15, 0.4, 2])
  assert.equal(usageWeighted(top, catalog, false, ['anthropic']).input, 4)
})

test('the provider board counts models served, times cheapest and price against the median', () => {
  const b = providerBoard([{ model: 'M1', providers: [{ provider: 'A', mix: 1 }, { provider: 'B', mix: 2 }, { provider: 'C', mix: 4 }] }, { model: 'M2', providers: [{ provider: 'B', mix: 1 }, { provider: 'A', mix: 3 }] }])
  const a = b.find(x => x.provider === 'A'), c = b.find(x => x.provider === 'C')
  assert.deepEqual([a.models, a.cheapest, a.vsMedian], [2, 1, 1])               // 1/2 and 3/2, median 1
  assert.deepEqual([c.models, c.cheapest, c.vsMedian, c.served], [1, 0, 2, ['M1']])
})

test('gateway shares: weeks start on Monday; a lab absent on a day counts as zero; price ratio is spend share over token share', () => {
  assert.equal(weekOf('2026-11-21'), '2026-11-16')
  assert.equal(weekOf('2026-11-16'), '2026-11-16')
  const rows = []
  for (let k = 0; k < 14; k++) {
    const date = new Date(Date.UTC(2026, 10, 2 + k)).toISOString().slice(0, 10)
    rows.push({ date, name: 'anthropic', metric: 'tokens', share_percent: 20 }, { date, name: 'anthropic', metric: 'spend', share_percent: 60 }, { date, name: 'deepseek', metric: 'tokens', share_percent: 60 }, { date, name: 'deepseek', metric: 'spend', share_percent: 12 })
    if (k % 2 === 0) rows.push({ date, name: 'newlab', metric: 'tokens', share_percent: 10 })
  }
  const { byDay, dates } = pivot(rows)
  assert.equal(dates.length, 14)
  assert.equal(average(byDay, dates, 'tokens').newlab, 5)
  const out = shape(rows, [], [{ lab: 'deepseek', share: 40 }])
  const a = out.labs.find(l => l.key === 'anthropic'), d = out.labs.find(l => l.key === 'deepseek')
  assert.deepEqual([a.priceRatio, d.priceRatio, d.open, d.openRouter, a.open], [3, 0.2, true, 40, false])
  assert.deepEqual([out.open.tokens, out.open.spend], [60, 12])
  assert.equal(out.weekly.tokens.length, 2)
  assert.equal(out.weekly.open.at(-1).tokens, 60)
})
