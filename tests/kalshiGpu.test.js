import test from 'node:test'
import assert from 'node:assert/strict'
import { monthOf, envelope, monotone, survival, implied, realised, monthRow } from '../server/kalshiGpu.js'

const mk = (strike, bid, ask, last = 0, volume = 0) => ({ ticker: `T-${strike}`, strike, bid, ask, last, volume, volume24h: 0, openInterest: volume / 2 })

test('kalshi gpu: an event ticker names its month', () => {
  assert.equal(monthOf('KXH100MS-26NOV'), '2026-11')
  assert.equal(monthOf('KXRTX5090MS-27AUG'), '2027-08')
  assert.equal(monthOf('KXH100MAX-26DEC31'), null)
})

test('kalshi gpu: a bid is a floor for every lower strike and an ask a ceiling for every higher one', () => {
  const e = envelope([mk(3, 0, 1), mk(2, 0, 1), mk(4, 0.4, 0.5), mk(5, 0, 1), mk(2.5, 0.7, 0.9)])
  assert.deepEqual(e.map(x => x.strike), [2, 2.5, 3, 4, 5])                    // sorted
  assert.deepEqual(e.map(x => x.lo), [0.7, 0.7, 0.4, 0.4, 0])                  // the 40¢ bid at $4 lifts $3; the 70¢ bid at $2.50 lifts $2
  assert.deepEqual(e.map(x => x.hi), [1, 0.9, 0.9, 0.5, 0.5])                  // the 50¢ offer at $4 caps $5
})

test('kalshi gpu: pooling never lets the odds rise with the strike, and weights the better reads', () => {
  assert.deepEqual(monotone([{ p: 0.9, w: 1 }, { p: 0.5, w: 1 }, { p: 0.7, w: 1 }, { p: 0.2, w: 1 }]), [0.9, 0.6, 0.6, 0.2])
  const w = monotone([{ p: 0.4, w: 4 }, { p: 0.9, w: 1 }])
  assert.ok(Math.abs(w[0] - 0.5) < 1e-12 && w[0] === w[1])                     // (0.4×4 + 0.9×1) ÷ 5
})

test('kalshi gpu: a tightly quoted ladder gives a firm median inside one gap, and the gap is what the orders support', () => {
  const ladder = [mk(2.75, 0.94, 1, 0.7, 695), mk(3, 0.91, 0.99, 0.89, 729), mk(3.25, 0, 0.05, 0.19, 706), mk(3.5, 0, 0.05, 0.12, 509)]
  const r = implied(ladder)
  assert.equal(r.read, 'firm')
  assert.deepEqual(r.between, [3, 3.25])
  assert.deepEqual([r.lo, r.hi], [3, 3.25])
  assert.equal(Math.round(r.implied * 100) / 100, 3.12)                        // 3 + 0.25 × (0.95 − 0.5) ÷ (0.95 − 0.025)
  assert.deepEqual(r.legs, [])                                                 // nothing rests on a trade
})

test('kalshi gpu: an empty book falls back to last trades, says so, and leaves the range open', () => {
  const ladder = [mk(2, 0, 1, 0.82, 2436), mk(2.25, 0, 1, 0.66, 678), mk(2.5, 0, 1, 0.6, 515), mk(2.75, 0, 1, 0.48, 102), mk(3, 0, 1, 0.43, 421)]
  const r = implied(ladder)
  assert.equal(r.read, 'trades')
  assert.deepEqual(r.between, [2.5, 2.75])
  assert.deepEqual([r.lo, r.hi], [null, null])
  assert.deepEqual(r.legs, ['T-2.5', 'T-2.75'])
  assert.equal(Math.round(r.implied * 100) / 100, 2.71)
  // a strike nobody has quoted or traded says nothing, and crossing over it is flagged
  const gappy = implied([mk(1.5, 0, 1, 0.89, 301), mk(2, 0, 1), mk(2.5, 0, 1, 0.3, 99)])
  assert.equal(gappy.gaps, true)
  assert.deepEqual(gappy.between, [1.5, 2.5])
  assert.equal(survival([mk(2, 0, 1)])[0].p, null)
})

test('kalshi gpu: a last trade outside the book is held inside it; one-sided ladders give a floor or a ceiling, not a price', () => {
  // the 90¢ bid at $6.50 means every lower strike is worth at least 90¢, whatever it last traded at:
  // $6.00, quoted 2¢ to 99¢ and last traded at 1¢, reads as tightly quoted between 90¢ and 99¢
  const s = survival([mk(6, 0.02, 0.99, 0.01, 2797), mk(6.5, 0.9, 0.99, 0.46, 1988), mk(7, 0, 1, 0.38, 1037)])
  assert.deepEqual([s[0].read, s[0].lo, s[0].hi, s[1].read, s[2].read], ['tight', 0.9, 0.99, 'tight', 'trade'])
  assert.ok(Math.abs(s[0].p - 0.945) < 1e-12)
  // a wide book with a trade outside it: the trade is held at the offer
  const held = survival([mk(5, 0.2, 0.9, 0.95, 10)])[0]
  assert.deepEqual([held.read, held.p], ['trade', 0.9])
  const up = implied([mk(6, 0, 1, 0.8, 10), mk(6.5, 0, 1, 0.7, 10)])
  assert.deepEqual([up.implied, up.floor, up.ceiling], [null, 6.5, null])
  const down = implied([mk(6, 0, 1, 0.3, 10), mk(6.5, 0, 1, 0.2, 10)])
  assert.deepEqual([down.implied, down.floor, down.ceiling], [null, null, 6])
})

test('kalshi gpu: the index by month, and where the month in progress would settle if it held', () => {
  const rows = []
  for (let d = 1; d <= 31; d++) rows.push({ d: `2026-10-${String(d).padStart(2, '0')}`, h100: 3, a100: null })
  for (let d = 1; d <= 21; d++) rows.push({ d: `2026-11-${String(d).padStart(2, '0')}`, h100: d <= 20 ? 3.2 : 2.9 })
  const r = realised(rows, 'h100', { month: '2026-11', implied: 3.12, lo: 3, hi: 3.25 })
  assert.deepEqual(r.monthly.map(m => [m.month, m.n, m.days, m.complete]), [['2026-10', 31, 31, true], ['2026-11', 21, 30, false]])
  assert.equal(r.monthly[0].avg, 3)
  assert.deepEqual(r.latest, { d: '2026-11-21', v: 2.9 })
  // (3.2×20 + 2.9) ÷ 21 = 3.186 so far; nine more days at 2.90 settle the month at 3.10
  assert.deepEqual([r.progress.soFar, r.progress.left, r.progress.tracking, r.progress.inside, r.progress.bounded], [3.19, 9, 3.1, true, true])
  assert.equal(realised(rows, 'h100', { month: '2026-11', implied: 3.12, lo: 3.25, hi: 3.5 }).progress.inside, false)
  assert.equal(realised(rows, 'a100', { month: '2026-11', implied: 1 }).progress, null)
})

test('kalshi gpu: a month row totals the ladder and keeps each rung', () => {
  const row = monthRow({ event: 'KXH100MS-26NOV' }, [mk(3, 0.91, 0.99, 0.89, 729), mk(3.25, 0, 0.05, 0.19, 706)])
  assert.deepEqual([row.month, row.implied, row.read, row.volume, row.openInterest, row.strikes.length], ['2026-11', 3.12, 'firm', 1435, 718, 2])
})
