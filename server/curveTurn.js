// ============================================================================
// CURVE AND TURN — two reads for Four Markets (Cockpit), both on the weekly
// grid crossAsset.js already builds; no data of their own.
//
// 1. The yield-curve regime. Over 13 weeks (and, for the latest turn, 4), the
//    change in the 2-year and 10-year Treasury yields:
//      steepening or flattening  the 10-year minus 2-year spread moved by at
//                                least 15 bp over 13 weeks (8 bp over 4);
//                                less than that is "no clear move"
//      bull or bear              yields on average fell (bull) or rose (bear)
//    so four regimes: bull steepening (the front end falls fastest: cuts
//    coming, a growth scare or the Fed easing), bear steepening (the long end
//    rises fastest: inflation, deficits, term premium, or reflation), bull
//    flattening (the long end falls fastest: slower growth with the Fed on
//    hold), bear flattening (the front end rises fastest: the Fed tightening).
//    A twist (one end up, the other down) takes the sign of the average move.
//
// 2. The Fed turn. Druckenmiller's question in a selloff is not whether stocks
//    are weak but what the weakness does to the Fed. Stocks are under pressure
//    when the S&P 500 closes 8% or more below its 52-week high. Three tells say
//    the Fed is blinking:
//      the 2-year yield down 35 bp or more over 8 weeks
//      the broad dollar below its 40-week average and down over 13 weeks
//      the curve bull-steepening (over 13 weeks or over 4)
//    The state each week:
//      Fed blinking                 under pressure, two or more tells
//      Fed holding firm             under pressure, no tells, and the 2-year
//                                   at or above fed funds less 10 bp (no cuts
//                                   priced) — tightening into weakness; not
//                                   at the zero bound (fed funds under 0.5%),
//                                   where the Fed's answer is its balance sheet
//      Selloff, Fed undecided       under pressure, otherwise
//      Easing without a selloff     not under pressure, two or more tells
//      No test                      neither
//    An episode starts the first week of blinking (or holding firm) with none
//    in the 26 weeks before; each is followed 13, 26 and 52 weeks on.
// The thresholds are this dashboard's, written down so they can be argued with.
// ============================================================================

const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 3) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const mean = xs => { const v = xs.filter(fin); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null }
const median = xs => { const v = xs.filter(fin).sort((a, b) => a - b); if (!v.length) return null; const m = (v.length - 1) / 2; return (v[Math.floor(m)] + v[Math.ceil(m)]) / 2 }

export const CURVE = {
  'bull-steep': { label: 'Bull steepening', says: 'The front end is falling fastest: the market is pricing cuts, from a growth scare or a Fed starting to ease.', equity: 'Historically the turn Druckenmiller waits for when it comes during a selloff; in a calm market it can be the first sign of a slowdown.' },
  'bear-steep': { label: 'Bear steepening', says: 'The long end is rising fastest: investors want more for holding long bonds, for inflation, deficits or stronger growth.', equity: 'A rising discount rate the Fed does not control: hardest on long-duration stocks unless it is reflation lifting earnings too.' },
  'bull-flat': { label: 'Bull flattening', says: 'The long end is falling fastest while the Fed stays put: the market expects slower growth or lower inflation.', equity: 'Helps valuations, but usually because earnings growth is expected to slow.' },
  'bear-flat': { label: 'Bear flattening', says: 'The front end is rising fastest: the market is pricing a tighter Fed.', equity: 'Liquidity being withdrawn: the classic late-cycle squeeze on multiples.' },
  none: { label: 'No clear move', says: 'The spread between the 10-year and 2-year has barely moved.', equity: 'The curve is not giving a signal.' },
}
export const CURVE_ORDER = ['bull-steep', 'bear-steep', 'bull-flat', 'bear-flat', 'none']
export const TURN = {
  blink: { label: 'Fed blinking', says: 'Stocks are under pressure and the bond and currency markets are pricing a Fed that gives way.' },
  firm: { label: 'Fed holding firm', says: 'Stocks are under pressure and nothing says the Fed is giving way: tightening into weakness, the backdrop Druckenmiller fears most.' },
  testing: { label: 'Selloff, Fed undecided', says: 'Stocks are under pressure and one tell has fired, or the market prices cuts without the other tells confirming.' },
  easing: { label: 'Easing without a selloff', says: 'The tells point to a Fed giving way although stocks are not under pressure: easing into strength, or a slowdown the stock market has not priced.' },
  calm: { label: 'No test', says: 'Stocks are not under pressure, so there is no Fed reaction to read.' },
}
export const TURN_ORDER = ['blink', 'firm', 'testing', 'easing', 'calm']
export const RULES = { curve13: 0.15, curve4: 0.08, stress: -0.08, twoYear: -0.35, twoYearWeeks: 8, firmGap: -0.1, zeroBound: 0.5, gap: 26 }

// the regime each week from weekly 2-year and 10-year yields (percent), over n weeks with a threshold in percentage points
export function curveRegimes(y2, y10, n, thr) {
  return y2.map((_, i) => {
    if (i < n || ![y2[i], y10[i], y2[i - n], y10[i - n]].every(fin)) return null
    const c2 = y2[i] - y2[i - n], c10 = y10[i] - y10[i - n], ds = c10 - c2
    if (Math.abs(ds) < thr) return 'none'
    return `${(c2 + c10) / 2 < 0 ? 'bull' : 'bear'}-${ds > 0 ? 'steep' : 'flat'}`
  })
}

// each week's Fed-turn state and the readings behind it. w: weekly SPY, DGS2, DFF, dollar; c13 and c4 the curve regimes
export function fedTurn(w, c13, c4, R = RULES) {
  return w.SPY.map((p, i) => {
    const win = w.SPY.slice(Math.max(0, i - 51), i + 1).filter(fin)
    if (!fin(p) || win.length < 40) return null
    const dd = p / Math.max(...win) - 1
    const y2chg = fin(w.DGS2[i]) && fin(w.DGS2[i - R.twoYearWeeks]) ? w.DGS2[i] - w.DGS2[i - R.twoYearWeeks] : null
    const dw = w.dollar.slice(Math.max(0, i - 39), i + 1).filter(fin), d13 = fin(w.dollar[i]) && fin(w.dollar[i - 13]) ? w.dollar[i] / w.dollar[i - 13] - 1 : null
    const dollarVsMa = fin(w.dollar[i]) && dw.length >= 30 ? w.dollar[i] / mean(dw) - 1 : null
    const gap = fin(w.DGS2[i]) && fin(w.DFF[i]) ? w.DGS2[i] - w.DFF[i] : null
    const tells = {
      twoYear: fin(y2chg) ? y2chg <= R.twoYear : null,
      dollar: fin(dollarVsMa) && fin(d13) ? dollarVsMa < 0 && d13 < 0 : null,
      curve: c13[i] == null && c4[i] == null ? null : c13[i] === 'bull-steep' || c4[i] === 'bull-steep',
    }
    const n = Object.values(tells).filter(v => v === true).length, stress = dd <= R.stress
    // at the zero bound the Fed cannot cut, and its answer is the balance sheet, which these tells do not see
    const zero = fin(w.DFF[i]) && w.DFF[i] < R.zeroBound
    const firm = fin(gap) && gap >= R.firmGap && !zero
    const state = stress ? (n >= 2 ? 'blink' : n === 0 && firm ? 'firm' : 'testing') : n >= 2 ? 'easing' : 'calm'
    return { state, drawdown: rnd(dd, 4), stress, tells, n, zero, y2chg: rnd(y2chg, 3), dollarVsMa: rnd(dollarVsMa, 4), dollar13: rnd(d13, 4), gap: rnd(gap, 3), firm }
  })
}

// the first week of a state with none in the `gap` weeks before, and what the S&P did after
export function episodes(weeks, turns, spy, state, gap = RULES.gap) {
  const out = []
  let last = -Infinity
  for (let i = 0; i < turns.length; i++) {
    if (turns[i]?.state !== state) continue
    if (i - last > gap) {
      const fwd = h => (i + h < spy.length && fin(spy[i + h]) && fin(spy[i]) ? rnd(spy[i + h] / spy[i] - 1, 4) : null)
      const ahead = spy.slice(i + 1, i + 27).filter(fin)
      out.push({ d: weeks[i], drawdown: turns[i].drawdown, tells: turns[i].n, f13: fwd(13), f26: fwd(26), f52: fwd(52), worst26: ahead.length ? rnd(Math.min(0, Math.min(...ahead) / spy[i] - 1), 4) : null })
    }
    last = i
  }
  return out
}

// what each market did over the next h weeks from every past week with each label
export function bookBy(labels, keys, prices, h = 26) {
  const F = Object.fromEntries(Object.entries(prices).map(([m, x]) => [m, x.map((v, i) => (i + h < x.length && fin(v) && fin(x[i + h]) && v > 0 ? x[i + h] / v - 1 : null))]))
  const labelled = labels.filter(Boolean).length
  return Object.fromEntries(keys.map(k => {
    const idx = labels.map((l, i) => (l === k ? i : -1)).filter(i => i >= 0)
    let runs = 0
    for (let j = 0; j < idx.length; j++) if (j === 0 || idx[j] - idx[j - 1] > 4) runs++
    return [k, { weeks: idx.length, runs, share: labelled ? rnd(idx.length / labelled, 3) : null,
      markets: Object.fromEntries(Object.keys(prices).map(m => { const v = idx.map(i => F[m][i]).filter(fin); return [m, { n: v.length, median: rnd(median(v), 4), up: v.length ? rnd(v.filter(x => x > 0).length / v.length, 3) : null }] })) }]
  }))
}

const summarize = eps => {
  const v26 = eps.map(e => e.f26).filter(fin), v52 = eps.map(e => e.f52).filter(fin)
  return { n: eps.length, median26: rnd(median(v26), 4), up26: v26.length ? rnd(v26.filter(x => x > 0).length / v26.length, 3) : null, median52: rnd(median(v52), 4), up52: v52.length ? rnd(v52.filter(x => x > 0).length / v52.length, 3) : null }
}

// both reads for the latest week, plus their histories and records. w: weekly inputs; px: {stocks, bonds, currencies, commodities}
export function curveAndTurn(w, weeks, px) {
  const c13 = curveRegimes(w.DGS2, w.DGS10, 13, RULES.curve13), c4 = curveRegimes(w.DGS2, w.DGS10, 4, RULES.curve4)
  const i = weeks.length - 1
  const move = n => ({ y2: fin(w.DGS2[i]) && fin(w.DGS2[i - n]) ? rnd(w.DGS2[i] - w.DGS2[i - n], 3) : null, y10: fin(w.DGS10[i]) && fin(w.DGS10[i - n]) ? rnd(w.DGS10[i] - w.DGS10[i - n], 3) : null })
  const slope = w.DGS10.map((v, k) => (fin(v) && fin(w.DGS2[k]) ? rnd(v - w.DGS2[k], 3) : null))
  let since = i
  while (since > 0 && c13[since - 1] === c13[i]) since--
  const curve = {
    now: { r13: c13[i], r4: c4[i], m13: move(13), m4: move(4), slope: slope[i], slope13: fin(slope[i]) && fin(slope[i - 13]) ? rnd(slope[i] - slope[i - 13], 3) : null, since: weeks[since], weeks: i - since + 1 },
    regimes: CURVE, order: CURVE_ORDER,
    series: weeks.slice(-104).map((d, k) => [d, slope[i - 103 + k], c13[i - 103 + k]]),
    history: weeks.map((d, k) => [d, c13[k]]).filter(r => r[1]),
    book: bookBy(c13, CURVE_ORDER, px),
  }
  const turns = fedTurn(w, c13, c4)
  let tSince = i
  while (tSince > 0 && turns[tSince - 1]?.state === turns[i]?.state) tSince--
  const blinks = episodes(weeks, turns, w.SPY, 'blink'), firms = episodes(weeks, turns, w.SPY, 'firm')
  const turn = {
    now: turns[i] ? { ...turns[i], since: weeks[tSince], weeks: i - tSince + 1, spy: rnd(w.SPY[i], 2), y2: rnd(w.DGS2[i], 3), ff: rnd(w.DFF[i], 3) } : null,
    states: TURN, order: TURN_ORDER, rules: RULES,
    history: weeks.map((d, k) => [d, turns[k]?.state || null]).filter(r => r[1]),
    episodes: { blink: blinks, firm: firms },
    record: { blink: summarize(blinks), firm: summarize(firms) },
    lastBlink: blinks.at(-1)?.d || null,
  }
  return { curve, turn }
}
