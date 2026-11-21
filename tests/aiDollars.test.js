import test from 'node:test'
import assert from 'node:assert/strict'
import { tierOf, guidanceOf, filedCapex, buildDollars } from '../server/aiDollars.js'
import { monthly, yearToDate, quarterRange, quartersFrom } from '../server/aiLabor.js'

const row = (tier, use, entity, value, asOf, extra = {}) => ({ tier, use, entity, value, asOf, metric: 'run-rate', unit: 'USD per year', confidence: 'high', ...extra })

test('a revenue tier takes each company\'s latest figure and the one nearest a year earlier, without scaling the gap', () => {
  const rows = [row('labs', 'run-rate', 'A', 10e9, '2025-06'), row('labs', 'run-rate', 'A', 20e9, '2025-12'), row('labs', 'run-rate', 'A', 50e9, '2026-10'), row('labs', 'run-rate', 'B', 5e9, '2026-07'),
    row('labs', 'context', 'A', 70e9, '2026-09'), row('inference', 'quarter', 'C', 3e9, '2026-09', { unit: 'USD per quarter' })]
  const t = tierOf(rows, 'labs')
  assert.equal(t.total, 55e9)
  const a = t.entities.find(e => e.entity === 'A')
  assert.deepEqual([a.usd, a.prior.asOf, a.added, a.months], [50e9, '2025-12', 30e9, 10])        // 10 months back beats 16
  assert.equal(t.entities.find(e => e.entity === 'B').added, null)                                // one figure: no history
  assert.deepEqual([t.added, t.withHistory, t.months], [30e9, 1, [10, 10]])
  assert.equal(tierOf(rows, 'inference').entities[0].usd, 12e9)                                    // a quarter × 4
  // points from elsewhere lengthen a history
  const ext = tierOf([row('labs', 'run-rate', 'A', 60e9, '2026-07'), row('labs', 'run-rate', 'A', 9e9, '2025-12')], 'labs', [{ entity: 'A', asOf: '2025-08', usd: 5e9 }])
  assert.deepEqual([ext.entities[0].prior.asOf, ext.entities[0].added, ext.entities[0].months], ['2025-08', 55e9, 11])
  // the same month twice: the better-sourced figure wins
  assert.equal(tierOf([row('labs', 'run-rate', 'A', 70e9, '2026-10', { confidence: 'low' }), row('labs', 'run-rate', 'A', 50e9, '2026-10', { confidence: 'medium' })], 'labs').entities[0].usd, 50e9)
})

test('capex guidance takes the latest figure per company, the middle of a range, and a quarter × 4', () => {
  const g = guidanceOf([row('capex', 'year', 'M', 190e9, '2026-04', { period: 'calendar 2026' }), row('capex', 'year', 'M', 175e9, '2026-10', { period: 'calendar 2026' }), row('capex', 'year', 'G', 195e9, '2026-10', { valueHigh: 205e9 }), row('capex', 'quarter', 'O', 28e9, '2026-08')], 'capex')
  assert.deepEqual(g.entities.map(e => [e.entity, e.usd]), [['G', 200e9], ['M', 175e9], ['O', 112e9]])
  assert.deepEqual([g.total, g.low, g.high], [487e9, 482e9, 492e9])
})

test('capex as filed: the last four quarters all companies have, the four before, and cash-flow coverage', () => {
  const q = (date, capex, ocf) => ({ date, capex, operatingCashFlow: ocf })
  const co = (end, base) => ({ quarters: Array.from({ length: 9 }, (_, k) => q(new Date(Date.UTC(2024, 5 + 3 * k + end, 30)).toISOString().slice(0, 10), base + k, 2 * (base + k))) })
  const f = filedCapex({ companies: { X: co(0, 10), Y: co(1, 20) } })
  assert.equal(f.companies, 2)
  assert.ok(f.added > 0 && f.usd > f.prior)
  assert.equal(f.coverage, 0.5)
  assert.equal(filedCapex({ companies: {} }), null)
})

test('the ledger reads lab revenue against capex', () => {
  const rows = [row('labs', 'run-rate', 'A', 20e9, '2025-10'), row('labs', 'run-rate', 'A', 100e9, '2026-10'), row('cloud-ai', 'run-rate', 'M', 50e9, '2026-04'), row('capex', 'year', 'M', 500e9, '2026-10'),
    row('venture', 'year', 'Global', 200e9, '2025-12', { period: 'calendar 2025' }), row('venture', 'round', 'A', 60e9, '2026-05', { period: 'one round' }), row('survey', 'survey', 'S', 150e9, '2026-09')]
  const d = buildDollars(rows, null)
  assert.deepEqual([d.reads.labs, d.reads.endRevenue, d.reads.capex, d.reads.labsPerCapexDollar, d.reads.endPerCapexDollar], [100e9, 150e9, 500e9, 0.2, 0.3])
  assert.equal(d.reads.capexBasis, 'guided')
  assert.deepEqual([d.capital.venture.years.length, d.capital.venture.rounds.length, d.survey.length], [1, 1, 1])
})

test('announced cuts: AI share by month, trailing 12 months, and the year to date against a year earlier', () => {
  const months = []
  for (let y = 2025; y <= 2026; y++) for (let m = 1; m <= (y === 2026 ? 10 : 12); m++) months.push({ month: `${y}-${String(m).padStart(2, '0')}`, totalCuts: 1000, aiCuts: y === 2026 ? 200 : 50, aiYtd: (y === 2026 ? 200 : 50) * m })
  const rows = monthly(months), last = rows.at(-1)
  assert.equal(last.share, 0.2)
  assert.equal(last.ai12, 200 * 10 + 50 * 2)
  assert.equal(rows[10].ai12, null)                                    // under 12 months on file
  const y = yearToDate(rows)
  assert.deepEqual([y.through, y.months, y.ai, y.aiPrior, y.total], ['2026-10', 10, 2000, 500, 10000])
  assert.deepEqual(quarterRange('2026-Q4'), ['2026-10-01', '2026-12-31'])
  assert.deepEqual(quartersFrom('2025-Q4', '2026-05-10'), ['2025-Q4', '2026-Q1', '2026-Q2'])
})
