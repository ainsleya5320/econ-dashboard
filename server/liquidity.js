// ============================================================================
// LIQUIDITY — U.S. Economy → Rates & Fed → Liquidity: is money expanding or
// contracting, where, and how fast? Read from the source of money outward, in
// six layers, each gauge graded expanding, neutral or contracting by a rule
// printed beside it, then one composite and its rate of change.
//   central bank   net liquidity (assets less the Treasury's account and all
//                  reverse repos), reserves as a share of bank assets, the
//                  reverse-repo buffer, the Treasury's account, the pace of
//                  runoff, and emergency facilities (discount window, standing
//                  repo, swap lines)
//   money markets  SOFR against the rate paid on reserves, the spread between
//                  the 99th and 1st percentile of repo rates, repo volume
//   money & credit M2 in real terms, bank loans, bank deposits, lending standards
//   Treasuries     the term premium, and realized 10-year volatility
//   credit         investment-grade, high-yield and Baa spreads; the Chicago
//                  Fed's financial conditions index
//   global         the dollar, and the Fed, ECB and Bank of Japan balance
//                  sheets in dollars
// The composite is the average of the flow gauges' 13-week moves, each scored
// against its own past three years and signed so that + means easier; its
// 13-week change is the impulse. A lead test sets it against the S&P 500's
// next 13 and 26 weeks. Only data available at each week is used.
// All FRED, through the shared cache (no keys beyond FRED's). The S&P 500 is
// read from the Four markets price file when present, else FRED's SP500.
// The Tightening monitor keeps its own board (auctions, foreign buyers) and
// links here; the net-liquidity chart lives here, moved from Fed balance sheet.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { fridays, onWeeks, change, zscore } from './crossAsset.js'

const H = 3600e3
const START = '2000-01-07'
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 3) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const mean = xs => { const v = xs.filter(fin); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null }
const median = xs => { const v = xs.filter(fin).sort((a, b) => a - b); if (!v.length) return null; const m = (v.length - 1) / 2; return (v[Math.floor(m)] + v[Math.ceil(m)]) / 2 }
const std = xs => { const v = xs.filter(fin); if (v.length < 2) return null; const m = mean(v); return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) }
const corr = (a, b) => { const p = a.map((x, i) => [x, b[i]]).filter(([x, y]) => fin(x) && fin(y)); if (p.length < 30) return null; const mx = mean(p.map(q => q[0])), my = mean(p.map(q => q[1])); let sxy = 0, sxx = 0, syy = 0; for (const [x, y] of p) { sxy += (x - mx) * (y - my); sxx += (x - mx) ** 2; syy += (y - my) ** 2 } return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null }

// series: FRED id → [how many observations to ask for, how stale a value may be when sampled weekly (days)]
const FRED = {
  WALCL: [1400, 10], WTREGEN: [1400, 10], WLRRAL: [1400, 10], WRESBAL: [1400, 10], TLAACBW027SBOG: [1400, 12], RRPONTSYD: [7000, 7],
  WSHOTSL: [1400, 10], WSHOMCB: [1400, 10], WLCFLPCL: [1400, 10], RPONTTLD: [7000, 7], SWPT: [1400, 10],
  SOFR: [2400, 7], IORB: [1500, 7], IOER: [4000, 7], SOFR1: [2400, 7], SOFR99: [2400, 7], SOFRVOL: [2400, 7],
  M2SL: [330, 80], CPIAUCSL: [330, 80], TOTLL: [1400, 12], DPSACBW027SBOG: [1400, 12], DRTSCILM: [140, 100],
  THREEFYTP10: [7000, 7], DGS10: [7000, 7], BAMLC0A0CM: [1200, 7], BAMLH0A0HYM2: [1200, 7], BAA10Y: [7000, 7], NFCI: [1400, 10],
  DTWEXBGS: [5500, 7], ECBASSETSW: [1400, 10], DEXUSEU: [7000, 7], JPNASSETS: [330, 80], DEXJPUS: [7000, 7], SP500: [2700, 7],
}
const MIL = 1 / 1000

export const LAYERS = [
  ['central', 'Central bank', 'Where money is created: the Fed\'s balance sheet and what holds it back.'],
  ['money', 'Money markets', 'Where scarcity shows first: overnight funding between banks and dealers.'],
  ['credit-creation', 'Money and bank credit', 'Where the banking system turns reserves into loans and deposits.'],
  ['treasuries', 'Treasury market', 'Whether the deepest market in the world is absorbing supply smoothly.'],
  ['credit', 'Credit markets', 'What borrowers pay over Treasuries, and broad financial conditions.'],
  ['global', 'Global dollar', 'The dollar and the three largest central banks, in dollars.'],
]

// a gauge: `x(w)` builds its weekly level; `kind` 'flow' grades the 13-week move (z-scored, signed by `sign`, + = more
// liquidity); 'level' grades the level by `grade(v)`; `composite` puts its signed flow into the composite
export const GAUGES = [
  { id: 'netLiquidity', layer: 'central', label: 'Net liquidity', unit: '$bn', kind: 'flow', sign: 1, composite: true, fmt: 'bn', chg: 'pct',
    x: w => w.WALCL.map((v, i) => (fin(v) && fin(w.WTREGEN[i]) && fin(w.WLRRAL[i]) ? (v - w.WTREGEN[i] - w.WLRRAL[i]) * MIL : null)),
    says: ['The part of the Fed\'s balance sheet left in the system is growing.', 'Little changed.', 'The part of the Fed\'s balance sheet left in the system is shrinking.'],
    home: 'here: the chart below' },
  { id: 'reserveShare', layer: 'central', label: 'Reserves as a share of bank assets', unit: '%', kind: 'level', fmt: 'pct',
    x: w => w.WRESBAL.map((v, i) => (fin(v) && w.TLAACBW027SBOG[i] > 0 ? (v * MIL) / w.TLAACBW027SBOG[i] * 100 : null)),
    grade: v => (v >= 13 ? 'expanding' : v < 11 ? 'contracting' : 'neutral'), rule: 'Over 13%: ample. Under 11%: approaching scarce, where funding rates start to jump. The lines are the dashboard\'s reading of where Fed officials have placed the edge of "ample".',
    says: ['Banks hold reserves well above what they need: runoff can continue painlessly.', 'Reserves are near the edge of ample: the Fed will be watching money-market rates.', 'Reserves are scarce enough that funding markets can seize: the 2019 repo spike happened here.'],
    home: 'Fed balance sheet' },
  { id: 'rrpBuffer', layer: 'central', label: 'Overnight reverse-repo buffer', unit: '$bn', kind: 'level', fmt: 'bn', x: w => w.RRPONTSYD,
    grade: v => (v >= 200 ? 'expanding' : v < 50 ? 'contracting' : 'neutral'), rule: 'Over $200bn: a buffer that absorbs runoff and Treasury bill issuance before reserves feel it. Under $50bn: drained, so both hit reserves directly.',
    says: ['Money-market funds still park cash at the Fed: a cushion between the Fed and the banks.', 'The cushion is thinning.', 'The cushion is gone: further runoff and bill issuance come straight out of bank reserves.'],
    home: 'Fed balance sheet' },
  { id: 'tga', layer: 'central', label: 'Treasury\'s cash account', unit: '$bn', kind: 'flow', sign: -1, composite: true, fmt: 'bn', chg: 'diff', scale: MIL, x: w => w.WTREGEN.map(v => (fin(v) ? v * MIL : null)),
    says: ['The Treasury is spending down its cash: money flows out to the economy.', 'Little changed.', 'The Treasury is building its cash pile, which drains reserves.'],
    home: 'Fed balance sheet' },
  { id: 'runoff', layer: 'central', label: 'Securities the Fed holds (runoff pace)', unit: '$bn', kind: 'flow', sign: 1, composite: false, fmt: 'bn', chg: 'diff',
    x: w => w.WSHOTSL.map((v, i) => (fin(v) && fin(w.WSHOMCB[i]) ? (v + w.WSHOMCB[i]) * MIL : null)),
    says: ['The Fed is adding securities.', 'Holdings are roughly steady.', 'The Fed is letting securities run off its balance sheet (quantitative tightening).'],
    home: 'Fed balance sheet' },
  { id: 'facilities', layer: 'central', label: 'Emergency facilities in use', unit: '$bn', kind: 'level', fmt: 'bn',
    x: w => w.WLCFLPCL.map((v, i) => { const parts = [fin(v) ? v * MIL : 0, fin(w.SWPT[i]) ? w.SWPT[i] * MIL : 0, fin(w.RPONTTLD_max4[i]) ? w.RPONTTLD_max4[i] : 0]; return fin(v) ? parts.reduce((s, x) => s + x, 0) : null }),
    grade: v => (v >= 25 ? 'contracting' : v >= 8 ? 'neutral' : 'expanding'), rule: 'Discount window, dollar swap lines and the largest standing-repo take-up of the past four weeks, added. Over $25bn: someone needs the lender of last resort. Under $8bn: background use.',
    says: ['Next to nothing is drawn: nobody needs the backstop.', 'Some use of the backstops: watch whether it grows.', 'Banks or foreign central banks are leaning on the Fed\'s backstops: funding stress.'],
    home: 'Fed balance sheet' },
  { id: 'sofrIorb', layer: 'money', label: 'SOFR against the rate paid on reserves', unit: 'bp', kind: 'level', fmt: 'bp',
    x: w => w.SOFR.map((v, i) => { const floor = fin(w.IORB[i]) ? w.IORB[i] : w.IOER[i]; return fin(v) && fin(floor) ? (v - floor) * 100 : null }),
    grade: v => (v <= -5 ? 'expanding' : v > 2 ? 'contracting' : 'neutral'), rule: 'Repo below the reserve rate by 5bp or more: cash is plentiful. Above it by more than 2bp: cash is scarce enough that lenders can charge more than the Fed pays.',
    says: ['Overnight cash is plentiful: it lends below what the Fed pays banks.', 'Overnight cash is close to the Fed\'s rate: balanced.', 'Overnight cash costs more than the Fed pays on reserves: reserves are getting scarce.'],
    home: 'Tightening monitor' },
  { id: 'repoDispersion', layer: 'money', label: 'Repo rate spread, 99th less 1st percentile', unit: 'bp', kind: 'flow', sign: -1, composite: true, fmt: 'bp', chg: 'diff',
    x: w => w.SOFR99.map((v, i) => (fin(v) && fin(w.SOFR1[i]) ? (v - w.SOFR1[i]) * 100 : null)),
    says: ['Repo rates are converging: every borrower pays about the same.', 'Little changed.', 'Repo rates are spreading out: some borrowers are paying up for cash.'],
    home: 'Rates' },
  { id: 'repoVolume', layer: 'money', label: 'Repo volume (SOFR)', unit: '$bn', kind: 'flow', sign: 1, composite: false, fmt: 'bn', chg: 'pct', x: w => w.SOFRVOL,
    says: ['More financing is flowing through repo: more leverage being funded.', 'Little changed.', 'Less financing is flowing through repo.'],
    home: 'Rates' },
  { id: 'realM2', layer: 'credit-creation', label: 'M2 money supply, after inflation', unit: '% a year', kind: 'level', fmt: 'pctpt', composite: true,
    x: w => w.M2SL.map((v, i) => (i >= 52 && fin(v) && fin(w.M2SL[i - 52]) && fin(w.CPIAUCSL[i]) && fin(w.CPIAUCSL[i - 52]) ? ((v / w.M2SL[i - 52]) / (w.CPIAUCSL[i] / w.CPIAUCSL[i - 52]) - 1) * 100 : null)),
    grade: v => (v >= 2 ? 'expanding' : v < 0 ? 'contracting' : 'neutral'), rule: 'Real growth over a year above 2%: money growing faster than prices. Below zero: money shrinking in real terms, as in 2022-23.',
    says: ['Money is growing faster than prices.', 'Money is growing roughly with prices.', 'Money is shrinking after inflation.'],
    home: 'Rates' },
  { id: 'loans', layer: 'credit-creation', label: 'Bank loans and leases', unit: '% a year', kind: 'level', fmt: 'pctpt', composite: true,
    x: w => w.TOTLL.map((v, i) => (i >= 52 && fin(v) && w.TOTLL[i - 52] > 0 ? (v / w.TOTLL[i - 52] - 1) * 100 : null)),
    grade: v => (v >= 5 ? 'expanding' : v < 2 ? 'contracting' : 'neutral'), rule: 'Growth over a year above 5%: banks are creating money by lending. Below 2%: lending is stalling.',
    says: ['Banks are lending freely: new loans create new deposits.', 'Bank lending is growing at a middling pace.', 'Bank lending is stalling.'],
    home: 'Credit → Banks' },
  { id: 'deposits', layer: 'credit-creation', label: 'Bank deposits', unit: '% a year', kind: 'level', fmt: 'pctpt',
    x: w => w.DPSACBW027SBOG.map((v, i) => (i >= 52 && fin(v) && w.DPSACBW027SBOG[i - 52] > 0 ? (v / w.DPSACBW027SBOG[i - 52] - 1) * 100 : null)),
    grade: v => (v >= 4 ? 'expanding' : v < 0 ? 'contracting' : 'neutral'), rule: 'Growth over a year above 4%: deposits growing. Below zero: deposits leaving the banks, as in 2022-23.',
    says: ['Deposits are growing.', 'Deposits are growing slowly.', 'Deposits are leaving the banking system.'],
    home: 'Credit → Banks' },
  { id: 'standards', layer: 'credit-creation', label: 'Banks tightening loan standards (net share)', unit: '%', kind: 'level', fmt: 'pctpt', x: w => w.DRTSCILM,
    grade: v => (v <= 0 ? 'expanding' : v >= 20 ? 'contracting' : 'neutral'), rule: 'Senior Loan Officer Survey, business loans. At or below zero: more banks easing than tightening. 20 or more: broad tightening, which has preceded most recessions.',
    says: ['More banks are easing their standards than tightening.', 'Banks are tightening modestly.', 'Banks are broadly tightening their standards.'],
    home: 'Credit → Banks' },
  { id: 'termPremium', layer: 'treasuries', label: '10-year term premium', unit: 'pp', kind: 'flow', sign: -1, composite: true, fmt: 'pp', chg: 'diff', x: w => w.THREEFYTP10,
    says: ['Investors are demanding less to hold long bonds.', 'Little changed.', 'Investors are demanding more to hold long bonds: duration is harder to place.'],
    home: 'Tightening monitor' },
  { id: 'rateVol', layer: 'treasuries', label: 'Realized 10-year yield volatility', unit: 'bp a day', kind: 'flow', sign: -1, composite: true, fmt: 'bpday', chg: 'diff', x: w => w.rateVol,
    says: ['The Treasury market is calming.', 'Little changed.', 'Treasury yields are swinging more: dealers widen spreads and liquidity thins.'],
    home: 'Rates' },
  { id: 'igSpread', layer: 'credit', label: 'Investment-grade spread', unit: 'pp', kind: 'flow', sign: -1, composite: false, fmt: 'pp', chg: 'diff', x: w => w.BAMLC0A0CM,
    says: ['Investment-grade borrowers are paying less over Treasuries.', 'Little changed.', 'Investment-grade borrowers are paying more over Treasuries.'],
    home: 'Credit → Corporate' },
  { id: 'hySpread', layer: 'credit', label: 'High-yield spread', unit: 'pp', kind: 'flow', sign: -1, composite: false, fmt: 'pp', chg: 'diff', x: w => w.BAMLH0A0HYM2,
    says: ['Junk borrowers are paying less over Treasuries.', 'Little changed.', 'Junk borrowers are paying more over Treasuries.'],
    home: 'Credit → Corporate' },
  { id: 'baa', layer: 'credit', label: 'Baa corporate spread', unit: 'pp', kind: 'flow', sign: -1, composite: true, fmt: 'pp', chg: 'diff', x: w => w.BAA10Y,
    says: ['Credit is getting cheaper.', 'Little changed.', 'Credit is getting dearer.'],
    home: 'Credit → Corporate' },
  { id: 'nfci', layer: 'credit', label: 'Chicago Fed financial conditions', unit: 'index', kind: 'flow', sign: -1, composite: true, fmt: 'idx', chg: 'diff', x: w => w.NFCI,
    says: ['Financial conditions are loosening.', 'Little changed.', 'Financial conditions are tightening.'],
    home: 'Tightening monitor' },
  { id: 'dollar', layer: 'global', label: 'Broad dollar', unit: 'index', kind: 'flow', sign: -1, composite: true, fmt: 'idx', chg: 'pct', x: w => w.DTWEXBGS,
    says: ['A weaker dollar eases dollar funding for the rest of the world.', 'Little changed.', 'A stronger dollar tightens dollar funding for the rest of the world.'],
    home: 'International' },
  { id: 'globalCB', layer: 'global', label: 'Fed, ECB and Bank of Japan assets, in dollars', unit: '$bn', kind: 'flow', sign: 1, composite: true, fmt: 'bn', chg: 'pct',
    x: w => w.WALCL.map((v, i) => (fin(v) && fin(w.ECBASSETSW[i]) && fin(w.DEXUSEU[i]) && fin(w.JPNASSETS[i]) && w.DEXJPUS[i] > 0 ? v * MIL + w.ECBASSETSW[i] * MIL * w.DEXUSEU[i] + (w.JPNASSETS[i] * 0.1) / w.DEXJPUS[i] : null)),
    says: ['The three largest central banks are adding assets: global liquidity rising.', 'Little changed.', 'The three largest central banks are shrinking, or the dollar is up enough to shrink them in dollars.'],
    home: 'World' },
]

// a flow gauge's 13-week move: a % change ('pct') or a difference ('diff')
const move13 = (x, how) => change(x, 13, how === 'pct' ? 'log' : 'diff')

// realized volatility of the 10-year yield: the standard deviation of daily changes over the past 20 trading days, in bp
export function realizedVol(daily, weeks) {
  const ch = []
  for (let k = 1; k < daily.length; k++) if (fin(daily[k].v) && fin(daily[k - 1].v)) ch.push({ d: daily[k].d, v: (daily[k].v - daily[k - 1].v) * 100 })
  const out = new Array(weeks.length).fill(null)
  let j = -1
  for (let i = 0; i < weeks.length; i++) {
    while (j + 1 < ch.length && ch[j + 1].d <= weeks[i]) j++
    if (j >= 19) out[i] = std(ch.slice(j - 19, j + 1).map(c => c.v))
  }
  return out
}

// the largest value in the past n days at each week (for a facility drawn for a day or two)
export function maxOver(daily, weeks, days = 28) {
  const out = new Array(weeks.length).fill(null)
  for (let i = 0, a = 0; i < weeks.length; i++) {
    const from = new Date(Date.parse(weeks[i]) - days * 864e5).toISOString().slice(0, 10)
    while (a < daily.length && daily[a].d < from) a++
    let m = null
    for (let k = a; k < daily.length && daily[k].d <= weeks[i]; k++) if (fin(daily[k].v)) m = Math.max(m ?? -Infinity, daily[k].v)
    out[i] = m
  }
  return out
}

const gradeFlow = z => (!fin(z) ? 'none' : z >= 0.5 ? 'expanding' : z <= -0.5 ? 'contracting' : 'neutral')

// all weekly inputs → each gauge's history, grades and the composite
export function buildLiquidity(w, weeks) {
  const n = weeks.length, i = n - 1
  const gauges = GAUGES.map(g => {
    const x = g.x(w)
    const mv = g.kind === 'flow' ? move13(x, g.chg) : null
    const zs = g.kind === 'flow' ? zscore(mv).map(v => (fin(v) ? v * g.sign : null)) : null
    // a level gauge enters the composite through its 13-week change in level (a year-on-year rate rising is easing)
    const compZ = g.composite ? (g.kind === 'flow' ? zs : zscore(change(x, 13, 'diff'))) : null
    const gradeAt = k => (g.kind === 'flow' ? gradeFlow(zs[k]) : fin(x[k]) ? g.grade(x[k]) : 'none')
    return { g, x, mv, zs, compZ, gradeAt }
  })
  const composite = weeks.map((_, k) => { const v = gauges.filter(q => q.compZ).map(q => q.compZ[k]).filter(fin); return v.length >= 5 ? mean(v) : null })
  const impulse = composite.map((v, k) => (k >= 13 && fin(v) && fin(composite[k - 13]) ? v - composite[k - 13] : null))
  return { gauges, composite, impulse, i }
}

// does the composite lead stocks? correlation with the next h weeks of the S&P 500, and returns by composite band
export function leadTest(composite, spx, horizons = [13, 26]) {
  const out = {}
  for (const h of horizons) {
    const fwd = spx.map((v, k) => (k + h < spx.length && fin(v) && fin(spx[k + h]) && v > 0 ? spx[k + h] / v - 1 : null))
    const bands = [['Easier (above +0.5)', v => v > 0.5], ['Middle', v => v >= -0.5 && v <= 0.5], ['Tighter (below −0.5)', v => v < -0.5]].map(([label, f]) => {
      const r = composite.map((v, k) => (fin(v) && f(v) ? fwd[k] : null)).filter(fin)
      return { label, weeks: r.length, median: rnd(median(r), 4), up: r.length ? rnd(r.filter(x => x > 0).length / r.length, 3) : null }
    })
    out[h] = { corr: rnd(corr(composite, fwd), 3), bands }
  }
  return out
}

export function createLiquidity({ dir, fred, now = () => Date.now() }) {
  let cache = null, inflight = null
  const spyFromFourMarkets = () => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'cross-asset-prices.json'), 'utf8'))?.symbols?.SPY || null } catch { return null } }

  async function build() {
    const ids = Object.keys(FRED), got = await Promise.all(ids.map(id => fred(id, FRED[id][0]).catch(() => [])))
    const F = Object.fromEntries(ids.map((id, k) => [id, got[k] || []]))
    const end = [F.WALCL.at(-1)?.d, F.DGS10.at(-1)?.d].filter(Boolean).sort().at(-1)
    const weeks = fridays(START, end)
    const w = {}
    for (const id of ids) w[id] = onWeeks(F[id], weeks, FRED[id][1])
    w.rateVol = realizedVol(F.DGS10, weeks)
    w.RPONTTLD_max4 = maxOver(F.RPONTTLD, weeks)
    const L = buildLiquidity(w, weeks), i = L.i
    const spyDaily = spyFromFourMarkets(), spx = spyDaily?.length ? onWeeks(spyDaily, weeks) : w.SP500
    const lead = leadTest(L.composite, spx)

    const fmtAsOf = (id) => F[id]?.at(-1)?.d || null
    const gauges = L.gauges.map(({ g, x, mv, zs, gradeAt }) => {
      const grade = gradeAt(i), lastIdx = (() => { for (let k = i; k >= 0; k--) if (fin(x[k])) return k; return -1 })()
      const shown = k => rnd(x[k], g.fmt === 'bn' ? 1 : 3)
      return { id: g.id, layer: g.layer, label: g.label, unit: g.unit, kind: g.kind, fmt: g.fmt, chgHow: g.chg || null,
        value: lastIdx >= 0 ? shown(lastIdx) : null, asOf: lastIdx >= 0 ? weeks[lastIdx] : null,
        change13: g.kind === 'flow' ? rnd(mv[lastIdx], 4) : lastIdx >= 13 && fin(x[lastIdx - 13]) ? rnd(x[lastIdx] - x[lastIdx - 13], 3) : null,
        change52: lastIdx >= 52 && fin(x[lastIdx - 52]) ? (g.chg === 'pct' && x[lastIdx - 52] > 0 ? rnd(x[lastIdx] / x[lastIdx - 52] - 1, 4) : rnd(x[lastIdx] - x[lastIdx - 52], 3)) : null,
        z: g.kind === 'flow' ? rnd(zs[lastIdx], 2) : null, grade, composite: !!g.composite,
        says: grade === 'none' ? null : g.says[grade === 'expanding' ? 0 : grade === 'neutral' ? 1 : 2],
        rule: g.rule || (g.kind === 'flow' ? `Graded on the 13-week ${g.chg === 'pct' ? 'percentage change' : 'change'} against its own past three years: half a typical move or more ${g.sign > 0 ? 'up' : 'down'} is expanding, the same the other way contracting.` : null),
        home: g.home, series: weeks.slice(-156).map((d, k) => [d, shown(i - 155 + k)]),
        grades: weeks.slice(-26).map((d, k) => gradeAt(i - 25 + k)) }
    })
    const layers = LAYERS.map(([id, label, reads]) => {
      const mine = gauges.filter(g => g.layer === id && g.grade !== 'none'), c = k => mine.filter(g => g.grade === k).length
      const net = c('expanding') - c('contracting')
      return { id, label, reads, expanding: c('expanding'), neutral: c('neutral'), contracting: c('contracting'), verdict: !mine.length ? 'no data' : net > 0 ? 'expanding' : net < 0 ? 'contracting' : 'mixed' }
    })
    const all = gauges.filter(g => g.grade !== 'none'), cnt = k => all.filter(g => g.grade === k).length
    const comp = L.composite[i], imp = L.impulse[i]
    const verdict = !fin(comp) ? 'no data' : comp >= 0.5 ? 'Expanding' : comp > 0.15 ? 'Leaning easier' : comp <= -0.5 ? 'Contracting' : comp < -0.15 ? 'Leaning tighter' : 'Balanced'
    // net liquidity, weekly in $bn, for the chart moved here from Fed balance sheet
    const net = L.gauges.find(q => q.g.id === 'netLiquidity').x
    return {
      built: new Date(now()).toISOString(), asOf: weeks[i], verdict, composite: rnd(comp, 3), impulse: rnd(imp, 3),
      counts: { expanding: cnt('expanding'), neutral: cnt('neutral'), contracting: cnt('contracting'), graded: all.length },
      layers, gauges,
      history: weeks.map((d, k) => [d, rnd(L.composite[k], 3), rnd(L.impulse[k], 3), rnd(spx[k], 2)]).filter(r => fin(r[1]) || fin(r[3])),
      netLiquidity: weeks.map((d, k) => [d, rnd(net[k], 1), rnd(w.WRESBAL[k] * MIL, 1), rnd(w.WTREGEN[k] * MIL, 1), rnd(w.WLRRAL[k] * MIL, 1), rnd(w.WALCL[k] * MIL, 1)]).filter(r => fin(r[1])),
      lead, spxSource: spyDaily?.length ? 'SPY closes (Four markets price file)' : 'FRED SP500 (ten years)',
      asOfBy: { fed: fmtAsOf('WALCL'), sofr: fmtAsOf('SOFR'), m2: fmtAsOf('M2SL'), loans: fmtAsOf('TOTLL'), standards: fmtAsOf('DRTSCILM'), boj: fmtAsOf('JPNASSETS') },
      method: [
        'Flow gauges are graded on their 13-week move divided by their typical 13-week move over the prior three years, signed so that + means more liquidity: +0.5 or more is expanding, −0.5 or less contracting. Level gauges are graded by the thresholds printed beside them.',
        'The composite averages the flow gauges in it and the 13-week change of the money and lending growth rates, each on that same scale, from at least five; the impulse is its change over 13 weeks. Runoff pace, repo volume and the two ICE spreads are shown but not in the composite (runoff is already in net liquidity; ICE spreads have only three years on FRED).',
        'Net liquidity is the Fed\'s total assets less the Treasury\'s account and all reverse repos (overnight and foreign), the same definition the Fed balance sheet page used.',
        'Repo spread before 2021 uses the rate on excess reserves, the reserve rate\'s predecessor. Bank of Japan assets are monthly and carried forward; ECB and BoJ are converted at each week\'s exchange rate, so a dollar rally shrinks them.',
        'The lead test is correlation and returns by band over overlapping windows since the composite starts: suggestive, not proof.',
      ],
      source: 'FRED: Federal Reserve H.4.1 and H.8, New York Fed reference rates, Treasury, ICE BofA, Moody\'s, Chicago Fed, ECB, Bank of Japan, BLS',
    }
  }

  async function get() {
    if (cache && now() - cache.ts < 6 * H) return cache.out
    if (!inflight) inflight = build().then(out => { cache = { ts: now(), out }; return out }).finally(() => { inflight = null })
    return inflight
  }
  return { get }
}
