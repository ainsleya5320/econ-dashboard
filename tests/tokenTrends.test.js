import test from 'node:test'
import assert from 'node:assert/strict'
import { ols, weeklySnapshots, priceSnapshot, routerRead, gatewayRead, businessRead } from '../server/tokenElasticity.js'
import { parseCsv, frontier, epochSeries, catalogSeries } from '../server/qualityPrice.js'
import { tableKind, parseTables, itemsOf, gbOf, board, legacyRatio, ladder } from '../server/memoryPrices.js'

test('elasticity: weekly snapshots are complete and a week apart; a snapshot is priced at list', () => {
  const rows = []
  const day = k => new Date(Date.UTC(2026, 5, 1 + k)).toISOString().slice(0, 10)
  for (let k = 0; k < 22; k++) for (const m of ['a/x', 'b/y', 'c/z']) { if (k === 10 && m !== 'a/x') continue; rows.push({ date: day(k), model_permaslug: m, total_prompt_tokens: 900, total_completion_tokens: 100 }) }
  const snaps = weeklySnapshots(rows)
  assert.deepEqual(snaps.map(s => s.d), [day(0), day(7), day(14), day(21)])           // day 10 is a partial capture
  const cat = { 'a/x': { pricing: { prompt: '0.000001', completion: '0.000005' }, hugging_face_id: 'a/X' }, 'b/y': { pricing: { prompt: '0.000003', completion: '0.000015' }, hugging_face_id: '' } }
  const p = priceSnapshot(snaps[0], cat)
  assert.deepEqual([p.tokens, p.outputShare, p.openShare, p.coverage], [2000, 0.1, 0.5, 0.667])   // c/z has no price
  assert.equal(p.price, 2.8)                                                            // (0.9×1 + 0.1×5 + 0.9×3 + 0.1×15) ÷ 2
})

test('elasticity: the router read is direction first; the gateway slope is pooled; Ramp is month on month', () => {
  const series = [{ d: 'a', tokens: 100, spend: 100, price: 1 }, { d: 'b', tokens: 300, spend: 180, price: 0.6 }, { d: 'c', tokens: 800, spend: 320, price: 0.4 }]
  const r = routerRead(series)
  assert.deepEqual([r.priceChange, r.volumeMultiple, r.spendMultiple, r.spendUpWhilePriceDown], [-0.6, 8, 3.2, true])
  assert.equal(r.arc, -2.27)                                                            // ln 8 ÷ ln 0.4
  assert.equal(routerRead(series.slice(0, 2)), null)
  assert.deepEqual(ols([[0, 1], [1, 3], [2, 5], [3, 7]]), { slope: 2, r2: 1, n: 4 })
  assert.equal(ols([[0, 1], [1, 2]]), null)
  const wk = { tokens: [], spend: [] }
  for (let i = 0; i < 9; i++) { wk.tokens.push({ w: i, cheap: 10 * 1.2 ** i, dear: 30 }); wk.spend.push({ w: i, cheap: 10, dear: 30 }) }
  const g = gatewayRead(wk, [{ key: 'cheap', name: 'Cheap' }, { key: 'dear', name: 'Dear' }, { key: 'tiny', name: 'Tiny' }])
  assert.equal(g.labs.length, 2)
  assert.ok(g.labs[0].key === 'cheap' && g.labs[0].priceChange < 0)
  const b = businessRead([{ week: 'November 15, 2026', price: [{ name: 'OpenAI & Anthropic', latest: 0.45, prior: 0.51 }], volumeGrowth: 27.2, spendGrowth: 12 }])
  assert.deepEqual([b.latest.priceChange, b.latest.arc], [-0.1176, -1.92])
})

test('constant-quality: the frontier is the running minimum, and a yearly rate needs a year', () => {
  const f = frontier([{ d: '2023-03-14', price: 37.5, model: 'A' }, { d: '2023-11-06', price: 15, model: 'B' }, { d: '2024-01-01', price: 20, model: 'C' }, { d: '2025-02-05', price: 0.15, model: 'D' }])
  assert.deepEqual(f.steps.map(s => s.model), ['A', 'B', 'D'])
  assert.deepEqual([f.times, f.months], [250, 23])
  assert.ok(f.perYear > 15 && f.perYear < 20)
  assert.equal(frontier([{ d: '2026-09-01', price: 20, model: 'A' }, { d: '2026-10-26', price: 2, model: 'B' }]).perYear, null)
  const rows = parseCsv('Benchmark,Threshold model,Performance range,Model Name,Release Date,USD per 1M Tokens\nMMLU,GPT-3,"[43.9, 100]",GPT-3,2021-11-20,60.0\nMMLU,GPT-3,"[43.9, 100]",Small,2024-10-03,0.07')
  assert.equal(rows[0]['Performance range'], '[43.9, 100]')
  const e = epochSeries(rows)
  assert.deepEqual([e[0].key, e[0].floor, e[0].first.price, e[0].last.price], ['MMLU|GPT-3', 43.9, 60, 0.07])
  const at = (y, m) => Date.UTC(y, m, 1) / 1000, aa = ii => ({ artificial_analysis: { intelligence_index: ii } })
  const cat = catalogSeries([
    { id: 'a/one', name: 'A: One', created: at(2026, 6), pricing: { prompt: '0.000004', completion: '0.00002' }, benchmarks: aa(45) },
    { id: 'b/two', name: 'B: Two', created: at(2026, 9), pricing: { prompt: '0.000001', completion: '0.000005' }, benchmarks: aa(41) },
    { id: 'b/two:batch', name: 'B: Two (batch)', created: at(2026, 9), pricing: { prompt: '0.0000001', completion: '0.0000005' }, benchmarks: aa(41) },
    { id: 'c/none', name: 'C', created: at(2026, 9), pricing: { prompt: '0.000001', completion: '0.000005' }, benchmarks: {} },
  ], [40, 60])
  assert.equal(cat.models, 2)
  assert.deepEqual(cat.series.map(s => [s.level, s.first.price, s.last.price, s.last.model]), [[40, 8, 2, 'Two']])
})

const page = [
  '<div class="price-title">DRAM Spot Price</div><span>Last Update 2026-11-20 18:10</span>',
  '<table><tr><th>Item</th><th>Daily High</th><th>Daily Low</th><th>Session Average</th><th>Session Change</th></tr>',
  '<tr><td>DDR5 16Gb (2Gx8) 4800/5600</td><td>72.00</td><td>45.20</td><td>60.667</td><td>&mdash; 0.00 %</td></tr>',
  '<tr><td>DDR4 16Gb (2Gx8) 3200</td><td>110.00</td><td>44.00</td><td>78.625</td><td>&#9660; -0.16 %</td></tr></table>',
  '<div class="price-title">DRAM Contract Price (2H Sep)</div>',
  '<table><tr><th>Item</th><th>Session High</th><th>Session Low</th><th>Session Average</th><th>Average Change</th></tr>',
  '<tr><td>DDR4 16GB SO-DIMM</td><td>295.00</td><td>255.00</td><td>275.00</td><td>&#9650; 1.85 %</td></tr></table>',
  '<div class="price-title">SSD Street Price</div>',
  '<table><tr><th>Brand</th><th>High</th><th>Low</th><th>Average</th></tr><tr><td>Acme</td><td>10</td><td>9</td><td>9.5</td></tr></table>',
].join('\n')

test('memory: tables are read with their titles, so contract is never taken for spot; street prices are skipped', () => {
  assert.deepEqual(tableKind('DRAM Spot Price'), { k: 'spot', g: 'chip' })
  assert.deepEqual(tableKind('Wafer Spot Price'), { k: 'spot', g: 'wafer' })
  assert.deepEqual(tableKind('NAND Flash Contract Price in Memory Card/UFD (2H Sep)'), { k: 'contract', g: 'nand' })
  assert.deepEqual(tableKind('PC-Client OEM SSD Contract Price (3Q\'26)'), { k: 'contract', g: 'ssd' })
  assert.equal(tableKind('SSD Street Price'), null)
  assert.equal(tableKind('Mobile DRAM Contract Price'), null)
  const items = itemsOf(parseTables(page))
  assert.deepEqual(items.map(i => [i.n, i.k, i.g, i.avg, i.chg]), [['DDR5 16Gb (2Gx8) 4800/5600', 'spot', 'chip', 60.667, 0], ['DDR4 16Gb (2Gx8) 3200', 'spot', 'chip', 78.625, -0.16], ['DDR4 16GB SO-DIMM', 'contract', 'module', 275, 1.85]])
  assert.equal(items[2].period, '2H Sep')
})

test('memory: capacity from a part name, dollars per GB, the legacy ratio, and the ladder with a hand-kept HBM row', () => {
  assert.deepEqual([gbOf('DDR5 16Gb (2Gx8) 4800/5600'), gbOf('DDR5 RDIMM 32GB 4800/5600'), gbOf('512Gb TLC'), gbOf('1TB-mSATA/M.2 TLC'), gbOf('SLC 2Gb 256MBx8'), gbOf('GDDR6')], [2, 32, 64, 1000, 0.25, null])
  const day = (date, ddr5, ddr4) => ({ date, items: [{ n: 'DDR5 16Gb (2Gx8) 4800/5600', g: 'chip', avg: ddr5, chg: 0 }, { n: 'DDR4 16Gb (2Gx8) 3200', g: 'chip', avg: ddr4, chg: -1 }, { n: 'DDR4 16Gb (2Gx8) eTT', g: 'chip', avg: 12, chg: 0 }], contracts: [] })
  const days = [day('2026-08-25', 50, 90), day('2026-10-20', 60, 84), day('2026-11-21', 60, 78)]
  const rows = board(days), ddr5 = rows.find(r => r.head === 'ddr5')
  assert.deepEqual([ddr5.perGb, ddr5.chgAll, ddr5.since, ddr5.family], [30, 0.2, '2026-08-25', 'DDR5'])
  assert.equal(rows.find(r => r.head === 'ddr4').chg30, -0.0714)                       // against Oct 20, the last day on or before 30 days back
  assert.deepEqual(legacyRatio(days).map(r => r.ratio), [1.8, 1.4, 1.3])
  const l = ladder(rows, [{ product: 'HBM3E 12-high', metric: 'price per GB', value: 10, valueHigh: 14, asOf: '2026-06', statedBy: 'someone' }, { product: 'HBM3E 12-high', metric: 'price per GB', value: 9, asOf: '2025-06' }, { product: 'HBM4', metric: 'premium over HBM3E', value: 30, asOf: '2026-06' }])
  assert.deepEqual(l.map(r => [r.label, r.perGb]), [['DDR4 16Gb chip', 39], ['DDR5 16Gb chip', 30], ['HBM3E 12-high', 12]])
  assert.equal(l[2].kind, 'estimate')
})
