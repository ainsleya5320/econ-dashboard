import test from 'node:test'
import assert from 'node:assert/strict'
import { curveRegimes, fedTurn, episodes, bookBy, curveAndTurn } from '../server/curveTurn.js'

test('curve regimes: bull or bear by the average move, steepening or flattening by the spread, a threshold for no move', () => {
  const y2 = [4, 3.5, 4, 4.5, 4, 4], y10 = [4, 3.8, 4.2, 4.6, 4.3, 4.05]
  // one-week changes: 2y −0.5 / 10y −0.2 → bull steepening; +0.5/+0.4 → bear flattening; +0.5/+0.4 → bear flattening;
  // −0.5/−0.3 → bull steepening; 0/−0.25 → bull flattening
  assert.deepEqual(curveRegimes(y2, y10, 1, 0.08), [null, 'bull-steep', 'bear-flat', 'bear-flat', 'bull-steep', 'bull-flat'])
  // a twist (2y down, 10y up) takes the sign of the average; a small spread move is no clear move
  assert.deepEqual(curveRegimes([4, 3.6], [4, 4.2], 1, 0.08), [null, 'bull-steep'])
  assert.deepEqual(curveRegimes([4, 4.1], [4, 4.15], 1, 0.08), [null, 'none'])
})

// 60 weeks: a calm S&P that falls 12% in the last weeks; the 2-year, fed funds and dollar set per case
const base = (over = {}) => {
  const n = 60, SPY = Array.from({ length: n }, (_, i) => (i < 55 ? 100 + i * 0.1 : 104 - (i - 54) * 3))
  return { SPY, DGS2: new Array(n).fill(4), DFF: new Array(n).fill(4), dollar: new Array(n).fill(100), ...over }
}
const none = new Array(60).fill('none')

test('Fed turn: blinking needs a selloff and two tells; holding firm needs no tells and no cuts priced', () => {
  const calm = fedTurn(base(), none, none)
  assert.equal(calm[50].state, 'calm')
  assert.ok(calm[59].stress)
  assert.equal(calm[59].state, 'firm')                                   // selloff, nothing giving way, 2-year at fed funds
  // the 2-year falls 50 bp over the last 8 weeks and the curve bull-steepens: two tells
  const DGS2 = base().DGS2.map((v, i) => (i >= 52 ? 4 - (i - 51) * 0.07 : v))
  const c = none.map((v, i) => (i >= 57 ? 'bull-steep' : v))
  const t = fedTurn(base({ DGS2 }), c, none)
  assert.equal(t[59].n, 2)
  assert.equal(t[59].state, 'blink')
  // at the zero bound the Fed cannot hold firm: the same selloff reads undecided
  const zero = fedTurn(base({ DGS2: new Array(60).fill(0.2), DFF: new Array(60).fill(0.1) }), none, none)
  assert.equal(zero[59].state, 'testing')
})

test('episodes start after 26 quiet weeks and carry what the S&P did next', () => {
  const weeks = Array.from({ length: 80 }, (_, i) => `w${String(i).padStart(2, '0')}`)
  const turns = weeks.map((_, i) => ({ state: [10, 11, 20, 50].includes(i) ? 'blink' : 'calm', drawdown: -0.1, n: 2 }))
  const spy = weeks.map((_, i) => 100 + i)
  const e = episodes(weeks, turns, spy, 'blink')
  assert.deepEqual(e.map(x => x.d), ['w10', 'w50'])                       // 11 and 20 are the same episode
  assert.equal(e[0].f13, Math.round((123 / 110 - 1) * 1e4) / 1e4)
  assert.equal(e[1].f52, null)                                            // not yet 52 weeks on
})

test('the book counts weeks, runs and forward returns per label', () => {
  const labels = ['a', 'a', 'b', null, 'a', 'b', 'b', 'a']
  const b = bookBy(labels, ['a', 'b'], { stocks: [1, 2, 3, 4, 5, 6, 7, 8] }, 2)
  assert.equal(b.a.weeks, 4); assert.equal(b.b.weeks, 3); assert.equal(b.a.runs, 1)
  assert.equal(b.a.markets.stocks.n, 3)                                   // the last 'a' has no week two ahead
})

test('curveAndTurn assembles both reads for the latest week', () => {
  const w = { ...base(), DGS10: new Array(60).fill(4.5) }
  const weeks = Array.from({ length: 60 }, (_, i) => `2026-${String(1 + Math.floor(i / 5)).padStart(2, '0')}-0${1 + (i % 5)}`)
  const { curve, turn } = curveAndTurn(w, weeks, { stocks: w.SPY })
  assert.equal(curve.now.r13, 'none'); assert.equal(curve.now.slope, 0.5)
  assert.equal(turn.now.state, 'firm'); assert.equal(turn.episodes.firm.length, 1)
})
