// ============================================================================
// AI FINANCING: who lends the money for the AI build-out?
// SemiAnalysis's forecast has AI debt reaching ~$7T by the end of 2029. The
// pace that path needs is set against everything US nonfinancial businesses
// borrowed in the past year (Fed Z.1), and against what credit markets charge
// today: the Baa corporate spread over Treasuries (ranked since 1986; FRED
// keeps only three years of the ICE high-yield spread, shown for its level)
// and the ten-year term premium (ranked since 1990). Gap = required AI borrowing a year ÷ all business borrowing
// in the past year. Half of it is a tension; more than all of it cannot happen
// without the credit markets visibly changing, so it is a contradiction with
// today's pricing.
// Inputs: data/ai/ai-debt.json (the forecast and the named deals),
// hyperscaler-capex.json (SEC filings, five hyperscalers), FRED.
// ============================================================================
import { fin, usd, pct, times, bp, grade, lastV, last, avgLast, qtr, ord } from '../lib.js'
import { trailingCapex } from '../aiCapexPath.js'

const LAUBACH = [20, 25, 30] // bp on long yields per 1% of GDP of sustained extra borrowing (Laubach 2009)
const pctile = (s, v) => (s?.length && fin(v) ? Math.round((s.filter(x => x.v <= v).length / s.length) * 100) : null)
const yearsTo = (to, from) => (Date.parse(to) - Date.parse(from)) / (365.25 * 864e5)

export default {
  id: 'ai-financing',
  domain: 'ai',
  order: 1,
  title: 'Who lends the money for the AI build-out?',
  question: 'Can AI debt reach the forecast $7T by 2029 while credit stays this cheap?',
  see: 'Charts: Compute → AI debt market (this tab); U.S. Economy → Rates & Fed → Tightening monitor.',
  async compute(ctx) {
    const debt = ctx.json('data/ai/ai-debt.json')
    const hc = ctx.json('hyperscaler-capex.json')
    const [flow, level, gdp, m2, baa, hy, tp, y10, netfi, fedDef] = await Promise.all([
      ctx.fred('BOGZ1FA144104005Q', 8), ctx.fred('TBSDODNS', 8), ctx.fred('GDP', 4), ctx.fred('M2SL', 3),
      ctx.fred('BAA10Y', 11000), ctx.fred('BAMLH0A0HYM2', 5), ctx.fred('THREEFYTP10', 10000), ctx.fred('DGS10', 5), ctx.fred('NETFI', 4), ctx.fred('FYFSGDA188S', 2),
    ])

    // ── the forecast and what it requires ──
    const F = debt.forecast
    const stock = debt.deals.filter(d => !d.contingent).reduce((a, d) => a + (d.amt || 0), 0)
    const yrs = yearsTo('2029-12-31', ctx.today)
    const pace = (F.debtOutstanding2029 - stock) / yrs
    const paceIfTrillion = (F.debtOutstanding2029 - 1000) / yrs
    const gdpB = lastV(gdp)

    // ── what all US nonfinancial businesses borrowed in the past year ──
    // Z.1 transactions (seasonally adjusted annual rate, $M) averaged over four quarters;
    // the change in the debt level is the fallback (it also carries revaluations)
    let biz = avgLast(flow, 4), bizHow = 'Fed Z.1 transactions, average of the last four quarters (annual rate)'
    if (!fin(biz) && level?.length >= 5) { biz = lastV(level) - level[level.length - 5].v; bizHow = 'change in the Fed Z.1 debt level over four quarters' }
    biz = fin(biz) ? biz / 1000 : null // $B

    // ── how much the biggest builders fund themselves ──
    // the window every AI card shares (../aiCapexPath.js): each company's last four quarters
    // ending by the latest date all five have reported through
    const tc = trailingCapex(hc)
    const capex = tc?.capex ?? 0, ocf = tc?.ocf ?? 0, hcEnd = tc?.end ?? null

    // ── what credit markets charge ──
    const med = s => (s?.length ? s.map(x => x.v).sort((a, b) => a - b)[Math.floor(s.length / 2)] : null)
    const baaNow = lastV(baa), baaPct = pctile(baa, baaNow), baaMed = med(baa), baaFrom = baa?.[0]?.d?.slice(0, 4)
    const tpNow = lastV(tp), tpPct = pctile(tp, tpNow), tpFrom = tp?.[0]?.d?.slice(0, 4)
    const cheap = fin(baaPct) && baaPct < 50

    const ratio = fin(biz) && biz > 0 ? pace / biz : null
    const extraFloor = fin(biz) ? Math.max(0, pace - biz) : null // even if every other business stopped borrowing
    const extraPctGdp = fin(extraFloor) && gdpB ? (extraFloor / gdpB) * 100 : null
    const press = LAUBACH.map(b => (fin(extraPctGdp) ? b * extraPctGdp : null))
    const status = grade(ratio, { tension: 0.5, contradiction: 1 })
    const asOf = [last(flow)?.d, last(baa)?.d, last(tp)?.d, hcEnd].filter(Boolean).sort().pop()

    return {
      status,
      asOf,
      headline: fin(ratio)
        ? `Reaching $7T by 2029 takes about ${usd(pace)} of new AI borrowing a year, ${times(ratio)} what every US business borrowed in the past year, ${cheap ? `yet corporate bonds pay only ${pct(baaNow, 2)} over Treasuries, the ${ord(baaPct)} percentile since ${baaFrom}: credit is priced as plentiful.` : `and corporate spreads have started to price it (${pct(baaNow, 2)} over Treasuries, the ${ord(baaPct)} percentile since ${baaFrom}).`}`
        : 'Business borrowing data is unavailable.',
      claims: [
        { label: 'AI debt outstanding by end-2029', display: usd(F.debtOutstanding2029, 0), kind: 'forecast', source: F.source, note: `against ${usd(F.cumulativeCapex2024to2029)} of cumulative AI capex 2024-29` },
        { label: 'Named AI financings so far', display: usd(stock), kind: 'company', source: 'Public deal announcements (data/ai/ai-debt.json)', note: 'a floor: much AI debt is never itemized' },
        { label: 'US nonfinancial business borrowing, past year', display: usd(biz), kind: 'official', source: bizHow, asOf: qtr(last(flow)?.d || last(level)?.d) },
        { label: 'Five hyperscalers: capex vs operating cash flow, last 4 quarters', display: `${usd(capex)} vs ${usd(ocf)}`, kind: 'official', source: 'SEC filings: Microsoft, Alphabet, Meta, Amazon, Oracle (hyperscaler-capex.json)', asOf: qtr(hcEnd), note: ocf ? `cash flow covers ${times(ocf / capex, 2)} of capex` : null },
        { label: 'Baa corporate spread over Treasuries', display: `${pct(baaNow, 2)} (${ord(baaPct)} pct.)`, kind: 'market', source: "Moody's Baa yield less the ten-year Treasury (FRED)", asOf: last(baa)?.d, note: `ranked since ${baaFrom}, median ${pct(baaMed, 2)}; high-yield spread ${pct(lastV(hy), 2)}` },
        { label: 'Ten-year term premium', display: `${pct(tpNow, 2)} (${ord(tpPct)} pct.)`, kind: 'market', source: 'Kim-Wright, Federal Reserve Board (FRED)', asOf: last(tp)?.d, note: `ranked since ${tpFrom}; ten-year yield ${pct(lastV(y10), 2)}` },
        { label: 'Borrowed from abroad, past year', display: usd(-lastV(netfi)), kind: 'official', source: 'BEA net foreign investment (FRED NETFI)', asOf: qtr(last(netfi)?.d), note: `federal deficit ${pct(-lastV(fedDef))} of GDP (FY${last(fedDef)?.d?.slice(0, 4)})` },
      ],
      gap: {
        label: 'Required AI borrowing ÷ all business borrowing',
        value: ratio, display: times(ratio), tension: 0.5, contradiction: 1, max: 3,
        note: 'Above 1×, the AI build alone needs more new credit than the whole business sector raised last year.',
      },
      gives: [
        { label: 'The forecast is too high', note: `More of the build is paid from cash flow or equity than SemiAnalysis assumes, or the build slows. The five largest builders still generate ${usd(ocf)} of operating cash a year against ${usd(capex)} of capex.` },
        { label: 'Credit gets dearer', note: `If other borrowers carry on, business borrowing runs at up to ${times(1 + ratio)} its past-year pace, and lenders charge for it: corporate spreads widen from the ${ord(baaPct)} percentile and the term premium climbs from the ${ord(tpPct)}.` },
        { label: 'Foreign savers fund it', note: `The US already borrows ${usd(-lastV(netfi))} a year from abroad; more would widen the current-account deficit, usually with a firmer dollar.` },
        { label: 'Someone else borrows less', note: 'Housing, non-AI investment or the federal deficit has to give up room in the credit markets.' },
      ],
      watch: [
        { label: 'Baa spread back to its median', display: `${pct(baaNow, 2)} now, median ${pct(baaMed, 2)}`, note: 'the first place a credit-supply squeeze shows' },
        { label: 'Ten-year term premium', display: pct(tpNow, 2), note: 'what investors charge to hold duration' },
        { label: 'Z.1 business borrowing', display: usd(biz), note: 'quarterly, about ten weeks after quarter-end' },
        { label: 'Hyperscaler capex against operating cash flow', display: ocf ? `${times(capex / ocf, 2)} of it` : '—', note: 'above 1× the builders switch from self-funded to borrowed' },
      ],
      implied: [
        { label: 'AI borrowing needed per year to 2029', display: usd(pace), note: `${pct((pace / gdpB) * 100)} of GDP; ${usd(paceIfTrillion)} even if today's real stock is already $1T` },
        { label: 'Pressure on long yields, floor case', display: fin(press[1]) ? `${bp(press[0])} to ${bp(press[2])}` : '—', note: 'if every other business stopped borrowing to make room' },
      ],
      math: [
        `Years left to end-2029: ${yrs.toFixed(2)}. Debt to add: ${usd(F.debtOutstanding2029, 0)} − ${usd(stock)} named so far = ${usd(F.debtOutstanding2029 - stock)}.`,
        `Required pace: ${usd(F.debtOutstanding2029 - stock)} ÷ ${yrs.toFixed(2)} = ${usd(pace)} a year, ${pct((pace / gdpB) * 100)} of GDP (${usd(gdpB)}).`,
        `All US nonfinancial business borrowing in the past year: ${usd(biz)}. Ratio ${usd(pace)} ÷ ${usd(biz)} = ${times(ratio, 2)}.`,
        `Floor case: if every other business stopped borrowing, credit demand still rises by ${usd(extraFloor)} a year, ${pct(extraPctGdp, 1)} of GDP.`,
        `Laubach (2009) finds roughly 20 to 30 bp on long yields per 1% of GDP of sustained extra borrowing, so ${pct(extraPctGdp, 1)} of GDP is about ${bp(press[0])} to ${bp(press[2])}. That literature measures government deficits; it is used here only for scale.`,
        `Scale check: ${usd(F.cumulativeCapex2024to2029)} of cumulative build-out is ${pct((F.cumulativeCapex2024to2029 / (lastV(m2) || NaN)) * 100, 0)} of M2 (${usd(lastV(m2))}). M2 is not the constraint, though: money spent on capex lands in someone else's deposit and is lent again. The constraint is the flow of saving and the price of credit.`,
      ],
      sources: [
        { label: 'Fed Z.1 nonfinancial business borrowing (FRED)', url: 'https://fred.stlouisfed.org/series/BOGZ1FA144104005Q' },
        { label: "Moody's Baa spread over the ten-year Treasury (FRED)", url: 'https://fred.stlouisfed.org/series/BAA10Y' },
        { label: 'Kim-Wright ten-year term premium (FRED)', url: 'https://fred.stlouisfed.org/series/THREEFYTP10' },
        { label: 'Laubach (2009), New Evidence on the Interest Rate Effects of Budget Deficits and Debt', url: 'https://www.federalreserve.gov/pubs/feds/2003/200312/200312pap.pdf' },
      ],
    }
  },
}
