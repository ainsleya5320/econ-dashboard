import test from 'node:test'
import assert from 'node:assert/strict'
import { parseEvent, buildChips } from '../server/polymarketGpu.js'
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
