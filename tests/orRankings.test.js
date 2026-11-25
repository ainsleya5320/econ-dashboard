import test from 'node:test'
import assert from 'node:assert/strict'
import { mergeRankings, completeDates, fillLegacyVariants, rankKey } from '../server/orRankings.js'
import { weeklySnapshots, priceSnapshot } from '../server/tokenElasticity.js'

const day = k => new Date(Date.UTC(2026, 10, 1 + k)).toISOString().slice(0, 10)
const row = (date, slug, variant, prompt, completion = 0, extra = {}) => ({ date, model_permaslug: slug, variant, variant_permaslug: variant === 'standard' ? slug : `${slug}:${variant}`, total_prompt_tokens: prompt, total_completion_tokens: completion, count: 1, change: null, ...extra })
const tok = r => r.total_prompt_tokens + r.total_completion_tokens
const total = (rows, d) => rows.filter(r => r.date === d).reduce((s, r) => s + tok(r), 0)

test('rankings merge: every variant of a model is kept, today is refreshed, other dates only gain new keys', () => {
  const archive = [row(day(0), 'a/x', 'batch', 5), row(day(1), 'a/x', 'standard', 900), row(day(1), 'b/y', 'standard', 50)]
  const fresh = [
    row(`${day(1)} 00:00:00`, 'a/x', 'batch', 7), row(`${day(1)} 00:00:00`, 'a/x', 'standard', 1000), row(`${day(1)} 00:00:00`, 'b/y', 'free', 300),
    row(`${day(0)} 00:00:00`, 'a/x', 'batch', 6), row(`${day(0)} 00:00:00`, 'c/z', 'standard', 40),          // stragglers dated yesterday
    { date: '', model_permaslug: 'bad/row' }, { date: day(1) },
  ]
  const m = mergeRankings(archive, fresh, { today: day(1) })
  const at = (d, slug, v) => m.rows.find(r => r.date === d && r.model_permaslug === slug && r.variant === v)?.total_prompt_tokens
  assert.equal(rankKey(day(1), fresh[0]), `${day(1)}|a/x|batch`)
  assert.deepEqual([at(day(1), 'a/x', 'standard'), at(day(1), 'a/x', 'batch'), at(day(1), 'b/y', 'standard'), at(day(1), 'b/y', 'free')], [1000, 7, 50, 300])   // the big variant no longer loses to the small one
  assert.deepEqual([at(day(0), 'a/x', 'batch'), at(day(0), 'c/z', 'standard')], [5, 40])                       // a closed day keeps its reading; a new key is added
  assert.deepEqual([m.rows.length, m.added, m.updatedToday, m.mainDate], [6, 3, 1, day(1)])
  assert.deepEqual(m.rows.map(r => r.date), [...m.rows.map(r => r.date)].sort())
  // an old row with no variant is the standard one; an estimate handed back by mistake is not stored
  const again = mergeRankings([{ date: day(0), model_permaslug: 'a/x', total_prompt_tokens: 1 }, { ...row(day(0), 'a/x', 'free', 9), filled: 'carried' }], [row(day(0), 'a/x', 'standard', 2)], { today: day(5) })
  assert.deepEqual(again.rows.map(r => [r.variant, r.total_prompt_tokens]), [[undefined, 1]])
})

test('rankings: a complete date is judged by models, not rows', () => {
  const rows = []
  for (const m of ['a/x', 'b/y', 'c/z', 'd/w', 'e/v']) rows.push(row(day(0), m, 'standard', 10))
  for (const v of ['standard', 'batch', 'free', 'thinking']) rows.push(row(day(1), 'a/x', v, 10))             // four rows, one model
  rows.push(row(day(2), 'a/x', 'standard', 10), row(day(2), 'b/y', 'standard', 10), row(day(2), 'c/z', 'batch', 10))
  assert.deepEqual(completeDates(rows), [day(0), day(2)])
  assert.deepEqual(completeDates([]), [])
})

test('rankings: a variant lost to the old merge is estimated from its own stored days, and only on legacy dates', () => {
  const rows = []
  const others = d => { for (const m of ['b/y', 'c/z', 'd/w']) rows.push(row(d, m, 'standard', 100)) }
  // a/x: standard is the main variant; before the fix one variant survived per date
  others(day(0)); rows.push(row(day(0), 'a/x', 'standard', 1000, 100, { count: 10 }))
  others(day(1)); rows.push(row(day(1), 'a/x', 'batch', 4))
  others(day(2)); rows.push(row(day(2), 'a/x', 'batch', 6))
  others(day(4)); rows.push(row(day(4), 'a/x', 'standard', 2000, 300, { count: 30 }))
  others(day(12)); rows.push(row(day(12), 'a/x', 'batch', 8))                                                  // 8 days after the last standard row
  rows.push(row(day(13), 'a/x', 'batch', 9))                                                                   // a straggler date, not a snapshot
  others(day(20)); rows.push(row(day(20), 'a/x', 'standard', 3000), row(day(20), 'a/x', 'batch', 10))         // written after the fix
  others(day(21)); rows.push(row(day(21), 'a/x', 'batch', 11))                                                 // after the fix: served as stored

  const f = fillLegacyVariants(rows, { keyedFrom: day(20) })
  const got = (d, v) => f.rows.find(r => r.date === d && r.model_permaslug === 'a/x' && r.variant === v)
  // interpolated in a straight line between day 0 and day 4, every count
  assert.deepEqual([got(day(1), 'standard').total_prompt_tokens, got(day(1), 'standard').total_completion_tokens, got(day(1), 'standard').count], [1250, 150, 15])
  assert.deepEqual([got(day(2), 'standard').total_prompt_tokens, got(day(2), 'standard').filled, got(day(2), 'standard').filledFrom], [1500, 'interpolated', [day(0), day(4)]])
  assert.equal(got(day(2), 'standard').variant_permaslug, 'a/x')
  // day 12 lies between the standard rows of day 4 and day 20
  assert.equal(got(day(12), 'standard').total_prompt_tokens, 2500)
  // the batch variant on day 0 has a stored row after it only: carried from day 1, one day off
  assert.deepEqual([got(day(0), 'batch').total_prompt_tokens, got(day(0), 'batch').filled, got(day(0), 'batch').filledFrom], [4, 'carried', [day(1)]])
  assert.equal(got(day(4), 'batch').total_prompt_tokens, 6)                                                     // a fifth of the way from day 2 (6) to day 12 (8), rounded
  // nothing is estimated on a straggler date, or from the first variant-keyed date on
  assert.equal(got(day(13), 'standard'), undefined)
  assert.equal(got(day(21), 'standard'), undefined)
  // stored rows are untouched, models with one variant get nothing, and the count adds up
  assert.deepEqual(f.rows.filter(r => !r.filled), [...rows].sort((a, b) => a.date.localeCompare(b.date)))
  assert.equal(f.rows.filter(r => r.filled && r.model_permaslug !== 'a/x').length, 0)
  assert.deepEqual(f.filled, { rows: 5, interpolated: 4, carried: 1, models: 1, dates: 5 })
  // the model no longer collapses on the days its main variant lost
  assert.deepEqual([day(0), day(1), day(2), day(4)].map(d => total(f.rows.filter(r => r.model_permaslug === 'a/x'), d)), [1104, 1404, 1706, 2306])
  // run again over its own output: estimates are not used as evidence and nothing is added twice
  assert.equal(fillLegacyVariants(f.rows, { keyedFrom: day(20) }).filled.rows, 5)
})

test('rankings: one-sided evidence is carried a week at most; with no marker every snapshot is legacy', () => {
  const rows = []
  for (const k of [0, 7, 8, 20]) for (const m of ['b/y', 'c/z']) rows.push(row(day(k), m, 'standard', 100))
  rows.push(row(day(0), 'a/x', 'free', 500), row(day(7), 'a/x', 'standard', 20), row(day(8), 'a/x', 'standard', 21), row(day(20), 'a/x', 'standard', 30))
  const f = fillLegacyVariants(rows)
  const free = d => f.rows.find(r => r.date === d && r.model_permaslug === 'a/x' && r.variant === 'free')
  assert.deepEqual([free(day(7))?.total_prompt_tokens, free(day(7))?.filled], [500, 'carried'])                 // 7 days on: still inside the window the row sums
  assert.equal(free(day(8)), undefined)                                                                         // 8 days on: the variant may be gone
  assert.equal(free(day(20)), undefined)
  assert.equal(f.rows.find(r => r.date === day(0) && r.variant === 'standard' && r.model_permaslug === 'a/x').filled, 'carried')
  assert.equal(fillLegacyVariants(rows, { keyedFrom: day(0) }).filled.rows, 0)
  assert.deepEqual(fillLegacyVariants([]).rows, [])
})

test('elasticity: a model is the sum of its variants, and a snapshot says how much of it is estimated', () => {
  const rows = []
  for (const k of [0, 7]) {
    rows.push(row(day(k), 'a/x', 'standard', 900, 100), row(day(k), 'b/y', 'standard', 500, 500))
    rows.push(k === 0 ? { ...row(day(k), 'a/x', 'free', 450, 50), filled: 'interpolated' } : row(day(k), 'a/x', 'free', 450, 50))
  }
  const snaps = weeklySnapshots(rows)
  assert.deepEqual(snaps.map(s => [s.d, s.models.size]), [[day(0), 2], [day(7), 2]])
  assert.deepEqual(snaps[0].models.get('a/x'), { P: 1350, C: 150, K: 0, E: 500 })
  const cat = { 'a/x': { pricing: { prompt: '0.000001', completion: '0.000002' } }, 'b/y': { pricing: { prompt: '0.000002', completion: '0.000004' } } }
  const p0 = priceSnapshot(snaps[0], cat), p1 = priceSnapshot(snaps[1], cat)
  assert.deepEqual([p0.tokens, p0.estimated, p1.estimated, p0.models], [2500, 0.2, 0, 2])
  assert.equal(p0.spend, p1.spend)                                                                              // an estimated row is priced like a stored one
})
