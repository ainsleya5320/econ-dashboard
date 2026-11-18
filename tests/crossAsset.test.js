import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fridays, onWeeks, change, zscore, trend, splice, buildHistory, playbook, stanceFor, SIGNALS, breakout, blended, readInstrument, INSTRUMENTS } from '../server/crossAsset.js'

const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} vs ${b}`)

test('weeks are Fridays, and a series is read at each one without looking ahead or past its staleness limit', () => {
  const w = fridays('2026-01-01', '2026-01-31')
  assert.deepEqual(w, ['2026-01-02', '2026-01-09', '2026-01-16', '2026-01-23', '2026-01-30'])
  const s = [{ d: '2026-01-02', v: 1 }, { d: '2026-01-14', v: 2 }, { d: '2026-01-17', v: 3 }]
  assert.deepEqual(onWeeks(s, w, 14), [1, 1, 2, 3, 3])
  assert.deepEqual(onWeeks(s, w), [1, 1, 2, 3, null])               // 13 days old is past the default 10-day limit
})

test('changes are logs for prices and differences for yields; z-scores use only the past and are clipped', () => {
  const p = [100, 110, 121]
  near(change(p, 1, 'log')[2], Math.log(1.1))
  assert.deepEqual(change([1, 1.5, 2.5], 1, 'diff'), [null, 0.5, 1])
  // a calm series then one big move: the move scores at the clip, and early weeks have no history to score against
  const c = Array.from({ length: 80 }, (_, i) => (i % 2 ? 0.01 : -0.01)); c.push(0.5)
  const z = zscore(c)
  assert.equal(z[10], null)
  assert.equal(z.at(-1), 2)
})

test('the chart read: above a rising average is an uptrend, below a falling one a downtrend', () => {
  const up = Array.from({ length: 60 }, (_, i) => 100 + i), down = up.map(v => 300 - v)
  assert.equal(trend(up, 59).state, 'uptrend')
  assert.equal(trend(down, 59).state, 'downtrend')
  assert.equal(trend(up.slice(0, 40), 39), null)                    // under a year of weeks
  const dip = [...up.slice(0, 59), 135]                             // under the average, still above where it was 26 weeks ago
  assert.equal(trend(dip, 59).state, 'turning down')
  assert.equal(trend([...up.slice(0, 59), 120], 59).state, 'downtrend')   // a drop below both
})

test('splicing rescales the older series to meet the newer one where it starts', () => {
  assert.deepEqual(splice([null, null, 20, 22], [5, 6, 10, 11]), [10, 12, 20, 22])
  assert.deepEqual(splice([null, null], [1, 2]), [1, 2])
})

// a synthetic market where every liquidity input says easier money and every growth input says a stronger economy
function world(n, easy) {
  const g = i => (easy ? 1 + i * 0.004 : 1 - i * 0.004), wobble = i => 1 + 0.01 * Math.sin(i)
  const w = {}
  w.DGS2 = Array.from({ length: n }, () => (easy ? 3 : 5)); w.DFF = Array.from({ length: n }, () => 4)
  w.DFII10 = Array.from({ length: n }, (_, i) => (easy ? 2 - i * 0.004 : 1 + i * 0.004) * wobble(i))
  w.WALCL = Array.from({ length: n }, (_, i) => 7e6 * g(i) * wobble(i)); w.WTREGEN = Array.from({ length: n }, () => 5e5); w.RRPONTSYD = Array.from({ length: n }, () => 100)
  w.dollar = Array.from({ length: n }, (_, i) => 100 / g(i) * wobble(i)); w.DEXJPUS = Array.from({ length: n }, (_, i) => 140 * g(i) * wobble(i))
  w.copper = Array.from({ length: n }, (_, i) => 4 * g(i) * wobble(i)); w.GLD = Array.from({ length: n }, () => 200)
  w.BAA10Y = Array.from({ length: n }, (_, i) => (easy ? 3 - i * 0.004 : 1 + i * 0.004) * wobble(i)); w.DGS10 = Array.from({ length: n }, (_, i) => (easy ? 3 + i * 0.004 : 5 - i * 0.004) * wobble(i))
  for (const [a, b] of [['XLY', 'XLP'], ['IWM', 'SPY'], ['IYT', 'SPY'], ['KRE', 'SPY']]) { w[a] = Array.from({ length: n }, (_, i) => 50 * g(i) * wobble(i)); w[b] ||= Array.from({ length: n }, () => 50) }
  return w
}

test('when every signal agrees the regime is clear; the cell follows the signs of the two axes', () => {
  const n = 120, weeks = fridays('2020-01-03', '2022-12-31').slice(0, n)
  const easy = buildHistory(world(n, true), weeks).rows.at(-1)
  assert.equal(easy.cell, 'easing-improving')
  assert.equal(easy.liqAgree, 1)
  assert.equal(easy.growthAgree, 1)
  assert.ok(easy.clarity >= 60, `clarity ${easy.clarity}`)
  assert.equal(stanceFor(easy.clarity)[1], 'Press')
  const tight = buildHistory(world(n, false), weeks).rows.at(-1)
  assert.equal(tight.cell, 'tightening-deteriorating')
  assert.equal(stanceFor(5)[1], 'Flat: preserve capital')
  assert.equal(SIGNALS.filter(s => s.axis === 'liquidity').length, 5)
})

test('the playbook reports forward returns by regime and counts separate episodes', () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ d: `w${i}`, cell: i < 20 || i >= 40 ? 'easing-improving' : 'tightening-deteriorating', clarity: i < 20 ? 80 : 10, growth: i < 20 || i >= 40 ? 1 : -1 }))
  const rising = Array.from({ length: 60 }, (_, i) => 100 * 1.01 ** i)
  const book = playbook(rows, { SPY: rising, TLT: rising, DBC: rising, DOLLAR: rising }, 10)
  const ei = book.cells['easing-improving']
  assert.equal(ei.weeks, 40)
  assert.equal(ei.runs, 2)                                           // weeks 0-19 and 40-59
  near(ei.markets.stocks.median, 1.01 ** 10 - 1, 1e-4)
  assert.equal(ei.markets.stocks.n, 30)                              // the last ten weeks have no 10-week future yet
  const high = book.clarity.at(-1)
  assert.equal(high.weeks, 20)
  assert.equal(high.pointedRight, 1)                                 // growth said up, stocks went up
})

test('breakouts and breakdowns are closes beyond every close of the prior 51 weeks; otherwise a recent average cross or the range edge', () => {
  const flat = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i) * 2)
  const up = [...flat.slice(0, 59), 110], down = [...flat.slice(0, 59), 90]
  assert.equal(breakout(up, 59).event, 'new-high')
  assert.equal(breakout(up, 59).pos, 1)
  assert.match(breakout(up, 59).label, /Breakout/)
  assert.equal(breakout(down, 59).event, 'new-low')
  assert.equal(breakout(flat, 30), null)                                       // under a year of weeks
  // a long decline that turns up through its 40-week average two weeks ago, without a new high
  const turn = [...Array.from({ length: 56 }, (_, i) => 150 - i), 99, 118, 121, 123]
  const b = breakout(turn, 59)
  assert.equal(b.event, 'cross-up')
  assert.equal(b.cross.weeksAgo, 2)
  assert.match(b.label, /2 weeks ago/)
})

test('blended momentum averages the 13, 26 and 52-week returns and needs the first two', () => {
  assert.equal(blended({ m13: 0.1, m26: 0.2, m52: 0.3 }).toFixed(3), '0.200')
  assert.equal(blended({ m13: 0.1, m26: 0.2, m52: null }).toFixed(3), '0.150')
  assert.equal(blended({ m13: 0.1, m26: null }), null)
})

test('an instrument read carries trend, breakout, momentum, relative strength against the S&P and a sparkline ending at 1', () => {
  const spy = Array.from({ length: 60 }, (_, i) => 100 + i * 0.1), stock = Array.from({ length: 60 }, (_, i) => 50 + i)
  const r = readInstrument({ id: 'X', market: 'stocks' }, stock, 59, spy)
  assert.equal(r.trend.state, 'uptrend')
  assert.equal(r.breakout.event, 'new-high')
  assert.ok(r.momentum > 0)
  assert.ok(r.rs.change13 > 0 && r.rs.newHigh)                                 // outrunning the index, ratio at a high
  assert.equal(r.spark.length, 52)
  assert.equal(r.spark.at(-1), 1)
  const y = readInstrument({ id: 'Y', kind: 'yield' }, Array.from({ length: 60 }, (_, i) => 4 + i * 0.02), 59)
  assert.equal(y.read, 'Yield at a 52-week high')
  assert.equal(y.change13.toFixed(2), '0.26')
  // every currency quoted per dollar is inverted, so up always means the currency strengthened
  for (const c of INSTRUMENTS.filter(x => x.market === 'currencies' && /^DEX..US$/.test(x.id))) assert.equal(c.invert, true, c.id)
  for (const c of INSTRUMENTS.filter(x => /^DEXUS/.test(x.id))) assert.equal(c.invert, false, c.id)
})
