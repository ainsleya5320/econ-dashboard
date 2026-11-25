import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEvent, buildChips, parsePointEvent, bracketRead } from '../server/polymarketGpu.js'
import { crossing, implied } from '../server/kalshiGpu.js'

// a Polymarket "above $X" market as the Gamma API returns it
const mk = (strike, bid, ask, extra = {}) => ({ slug: `m-${strike}`, groupItemTitle: `Above $${strike.toFixed(2)}`, question: `Will the average Ornn H100 rental price in January 2027 be above $${strike.toFixed(2)}?`, bestBid: bid, bestAsk: ask, lastTradePrice: (bid + ask) / 2, volumeNum: 1000, volume24hr: 100, liquidityNum: 5000, active: true, closed: false, ...extra })
const event = (title, slug, markets, extra = {}) => ({ title, slug, closed: false, volume: 50000, volume24hr: 4000, liquidity: 90000, markets, ...extra })
const ladder = [mk(2.6, 0.79, 0.8), mk(2.7, 0.73, 0.74), mk(2.8, 0.62, 0.63), mk(2.9, 0.53, 0.54), mk(3, 0.46, 0.47), mk(3.1, 0.4, 0.41), mk(3.2, 0.35, 0.36), mk(3.3, 0.3, 0.31), mk(3.4, 0.19, 0.2)]

test('polymarket gpu: an event is read as chip, month and an "above" ladder; other events are passed over', () => {
  const e = parseEvent(event('H100 average rental price in January 2027?', 'h100-average-rental-price-in-january-2027', ladder))
  assert.deepEqual([e.chip, e.label, e.month, e.markets.length], ['h100', 'H100', '2027-01', 9])
  assert.deepEqual([e.markets[0].strike, e.markets[0].bid, e.markets[0].ask, e.markets[0].volume], [2.6, 0.79, 0.8, 1000])
  assert.equal(parseEvent(event('GPU rental prices (H100) end of November?', 'x', ladder)), null)        // a month-end value, not an average
  assert.equal(parseEvent(event('H100 average rental price in January 2027?', 'x', ladder, { closed: true })), null)
  // a market with no bid and no offer reads as an empty book, and closed rungs are dropped
  const thin = parseEvent(event('B300 average rental price in December 2028?', 'b', [mk(7, 0.5, 0.52), mk(8, undefined, undefined), mk(9, 0.1, 0.12, { closed: true })]))
  assert.deepEqual([thin.chip, thin.month, thin.markets.length, thin.markets[1].bid, thin.markets[1].ask], ['b300', '2028-12', 2, 0, 1])
})

test('polymarket gpu: a tight ladder gives the median and the middle half of the odds', () => {
  const known = [{ strike: 2, p: 0.9 }, { strike: 3, p: 0.5 }, { strike: 4, p: 0.1 }]
  assert.equal(crossing(known, 0.75).at, 2.375)                 // 2 + (0.9 − 0.75) ÷ (0.9 − 0.5)
  assert.equal(crossing(known, 0.95), null)                     // above every rung's odds
  assert.equal(crossing(known, 0.05), null)
  const r = implied(parseEvent(event('H100 average rental price in January 2027?', 's', ladder)).markets)
  assert.equal(r.read, 'firm')
  assert.equal(Math.round(r.implied * 100) / 100, 2.95)         // 53.5% above $2.90, 46.5% above $3.00
  assert.deepEqual(r.band.map(v => Math.round(v * 100) / 100), [2.68, 3.35])
  // a ladder that never reaches 75% has no middle half
  assert.equal(implied(ladder.slice(2).map((m, i) => ({ strike: 2.8 + i / 10, bid: m.bestBid, ask: m.bestAsk, last: 0.5, volume: 1 }))).band, null)
})

test('polymarket gpu: chips carry their months in order with dollars traded and resting', () => {
  const events = [
    event('H100 average rental price in March 2027?', 'h-mar', ladder), event('H100 average rental price in January 2027?', 'h-jan', ladder),
    event('B200 average rental price in January 2027?', 'b-jan', ladder, { volume: 900000 }),
  ].map(parseEvent)
  const rows = [{ d: '2026-11-23', h100: 3.1, b200: 9 }, { d: '2026-11-24', h100: 3.16, b200: 9.07 }]
  const chips = buildChips(events, rows)
  assert.deepEqual(chips.map(c => c.id), ['b200', 'h100'])                                   // most traded first
  const h = chips[1]
  assert.deepEqual(h.months.map(m => m.month), ['2027-01', '2027-03'])
  assert.deepEqual([h.months[0].implied, h.months[0].volume, h.months[0].liquidity, h.volume, h.liquidity, h.supported], [2.95, 50000, 90000, 100000, 180000, 2])
  assert.deepEqual(h.index, { d: '2026-11-24', v: 3.16 })
  assert.equal(h.months[0].url, 'https://polymarket.com/event/h-jan')
  assert.equal('legs' in h.months[0], false)
})

// a month-end bracket market as the Gamma API returns it
const bk = (title, bid, ask, extra = {}) => ({ groupItemTitle: title, question: `Will the Ornn H200 Index be ${title} on December 31, 2026?`, bestBid: bid, bestAsk: ask, lastTradePrice: (bid + ask) / 2, volumeNum: 500, active: true, closed: false, ...extra })

test('polymarket gpu: a month-end event is read as brackets on one day, lowest first', () => {
  const e = parsePointEvent(event('GPU rental prices (H200) end of December 2026?', 'h200-dec', [bk('$6.50+', 0.44, 0.5), bk('<$4.50', 0.1, 0.12), bk('$4.50-$5.00', 0.05, 0.07), bk('$5.00-$6.50', 0.3, 0.34)]))
  assert.deepEqual([e.chip, e.label, e.date, e.buckets.length], ['h200', 'H200', '2026-12-31', 4])
  assert.deepEqual(e.buckets.map(b => [b.lo, b.hi]), [[null, 4.5], [4.5, 5], [5, 6.5], [6.5, null]])
  assert.equal(parsePointEvent(event('GPU rental prices (RTX 6000) end of November 2026?', 'r', [bk('$1.00-$1.25', 0.1, 0.12), bk('$1.25-$1.50', 0.3, 0.32), bk('$1.50+', 0.55, 0.57)])).chip, 'rtx6000')
  assert.equal(parsePointEvent(event('H100 average rental price in January 2027?', 'x', ladder)), null)       // a monthly average, read elsewhere
  assert.equal(parsePointEvent(event('GPU rental prices (H200) hit___ in 2026?', 'x', [bk('↑ $7.00', 0.2, 0.3)])), null)
})

test('polymarket gpu: bracket chances are scaled to one and the median sits inside its bracket in proportion', () => {
  const b = (lo, hi, bid, ask, extra = {}) => ({ lo, hi, bid, ask, last: (bid + ask) / 2, volume: 10, ...extra })
  // mids 0.1, 0.2, 0.5, 0.2 sum to one: half the odds are reached 40% of the way through the $5–$6 bracket
  const r = bracketRead([b(null, 4, 0.09, 0.11), b(4, 5, 0.19, 0.21), b(5, 6, 0.49, 0.51), b(6, null, 0.19, 0.21)])
  assert.deepEqual([r.sum, Math.round(r.implied * 100) / 100, r.read], [1, 5.4, 'firm'])
  assert.deepEqual(r.band.map(v => Math.round(v * 100) / 100), [4.75, 5.9])
  // mids that sum to 1.25 are scaled back; the answer is the same
  const over = bracketRead([b(null, 4, 0.115, 0.135), b(4, 5, 0.24, 0.26), b(5, 6, 0.615, 0.635), b(6, null, 0.24, 0.26)])
  assert.deepEqual([over.sum, Math.round(over.implied * 100) / 100], [1.25, 5.4])
  // more than half the odds in the open top bracket: a floor and its chance, no median and no middle half
  const top = bracketRead([b(null, 6, 0.1, 0.12), b(6, 6.5, 0.24, 0.26), b(6.5, null, 0.63, 0.65)])
  assert.deepEqual([top.implied, top.floor, top.odds, top.band], [null, 6.5, 0.64, null])
  // a book wider than 15 points falls back to its last trade, held inside the book, and the read is not firm
  const wide = bracketRead([b(null, 5, 0.1, 0.5, { last: 0.9 }), b(5, 6, 0.3, 0.32), b(6, null, 0.19, 0.21)])
  assert.deepEqual([wide.buckets[0].p, wide.read], [0.495, 'quoted'])                                   // 0.5 ÷ (0.5 + 0.31 + 0.2)
})

test('polymarket gpu: one bracket event per chip and day, the deeper one; a chip with brackets only is still a chip', () => {
  const mkE = (slug, liquidity) => ({ ...parsePointEvent(event('GPU rental prices (A100) end of December 2026?', slug, [bk('<$0.75', 0.02, 0.04), bk('$0.75-$1.00', 0.45, 0.47), bk('$1.00-$1.25', 0.42, 0.44), bk('$1.25+', 0.05, 0.07)])), liquidity })
  const chips = buildChips([parseEvent(event('H100 average rental price in January 2027?', 'h-jan', ladder))], [{ d: '2026-11-24', h100: 3.16, a100: 1 }], [mkE('shallow', 1000), mkE('deep', 9000)])
  const a = chips.find(c => c.id === 'a100'), h = chips.find(c => c.id === 'h100')
  assert.deepEqual([a.months.length, a.points.length, a.points[0].url, a.points[0].date, a.points[0].month], [0, 1, 'https://polymarket.com/event/deep', '2026-12-31', '2026-12'])
  assert.equal(a.points[0].implied, 1)                          // mids 0.03, 0.46, 0.43, 0.06 sum to 0.98: scaled, the first two brackets hold exactly half the odds
  assert.deepEqual(a.index, { d: '2026-11-24', v: 1 })
  assert.deepEqual([h.months.length, h.points.length], [1, 0])
})
