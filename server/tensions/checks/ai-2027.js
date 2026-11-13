// ============================================================================
// AI 2027: is the fast-takeoff scenario's path the one we are on?
// AI 2027 (April 2025) is a story, but its compute supplement commits to dated
// numbers: what the leading lab earns and spends on compute each year, what the
// world spends on AI data centers, and what a unit of compute costs. Enough of
// those can now be set beside filed and disclosed figures to say where reality
// is ahead of the scenario, where it is behind, and what the pattern means.
//
// Each graded row is reality ÷ the scenario's path at the same date. The
// scenario gives calendar-year figures; a year's figure is read as the pace at
// mid-year and the path runs log-linearly between mid-years (pathAt, shared
// with the other AI checks), so a run-rate dated May is compared with the
// path's pace in May. Graded rows:
//   revenue      the highest disclosed lab run-rate ÷ the path
//   compute      the filed quarter's compute bill × 4 ÷ the path
//   unit cost    what an H100-hour costs against a year ago, ÷ the scenario's
//                yearly change in cost per H100-equivalent
// The gap is the furthest miss among them, in either direction: at 1.0 reality
// is on the path; from 1.25 one of the scenario's 2026 numbers is off by a
// quarter; from 1.5 by half, and the scenario and the filings cannot both be
// describing this year. The direction of each miss is what to read: revenue
// ahead while compute is behind and compute prices rise is what a shortage
// looks like, not a miss in the scenario's favour or against it.
// Shown but not graded: world AI data-center spending against the five
// hyperscalers' own capex (five companies, all capex: a different measure),
// the share of compute serving customers, and the stock market.
// Inputs: data/ai/ai-2027.json (the scenario's tables), data/ai/revenue-
// disclosures.json, src/data/labFinancials.json (filed lab income statements),
// hyperscaler-capex.json, semi-h100-index.json, FRED SP500.
// ============================================================================
import { fin, usd, pct, times, grade, mon, qtr } from '../lib.js'
import { trailingCapex, pathAt } from '../aiCapexPath.js'

const tOf = ym => +ym.slice(0, 4) + (+ym.slice(5, 7) - 0.5) / 12                 // 'YYYY-MM' → fractional year, mid-month
const tQuarterMid = end => +end.slice(0, 4) + (+end.slice(5, 7) - 1.5) / 12       // quarter-end date → the quarter's middle
const signedPct = v => (fin(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(0)}%` : '—')
const side = r => (!fin(r) ? 'not comparable' : r >= 1.1 ? 'ahead of' : r <= 0.9 ? 'behind' : 'on')
const miss = r => (fin(r) && r > 0 ? Math.max(r, 1 / r) : null)
const vals = s => Object.fromEntries(Object.entries(s?.values || {}).map(([y, v]) => [+y, v]))

export default {
  id: 'ai-2027',
  domain: 'ai',
  order: 4,
  title: 'Are we on the AI 2027 path?',
  question: 'The fast-takeoff scenario put numbers on 2026. Do the filings match them?',
  see: 'Charts: Models & Labs → Lab Economics; Compute → the GPU-hour, every way it is sold.',
  labels: { claims: 'The scenario, and what has been filed', implied: 'Reality against the path', gives: 'How to read the misses' },
  async compute(ctx) {
    const S = ctx.json('data/ai/ai-2027.json')
    const rev = vals(S.series.leadRevenue), comp = vals(S.series.leadCompute), spend = vals(S.series.globalSpend), tco = vals(S.series.tcoPerH100e), ext = vals(S.series.externalDeploymentShare)
    const disclosures = ctx.json('data/ai/revenue-disclosures.json').disclosures || []
    const labs = ctx.json('src/data/labFinancials.json').labs || []
    const hc = ctx.json('hyperscaler-capex.json')
    const year = +ctx.today.slice(0, 4)

    // revenue: each lab's newest disclosed run-rate against the path at that month; the scenario's leader is whoever is furthest along
    const byLab = {}
    for (const r of disclosures) if (fin(r.arr) && /^\d{4}-\d{2}$/.test(r.d) && (!byLab[r.co] || r.d > byLab[r.co].d)) byLab[r.co] = r
    const revRows = Object.values(byLab).map(r => { const t = tOf(r.d), path = pathAt(rev, t); return { co: r.co, d: r.d, arr: r.arr, path, ratio: fin(path) ? r.arr / path : null, approx: !!r.approx } })
      .filter(r => fin(r.ratio) && r.d >= `${year - 1}-07`).sort((a, b) => b.ratio - a.ratio)
    const lead = revRows[0] || null

    // compute: the newest filed quarter of whichever lab has filed
    const filed = labs.map(l => ({ lab: l, q: (l.quarters || []).at(-1) })).filter(x => x.q && fin(x.q.compute) && fin(x.q.revenue)).sort((a, b) => b.q.end.localeCompare(a.q.end))[0] || null
    let compRow = null, perDollar = null, serving = null
    if (filed) {
      const t = tQuarterMid(filed.q.end), path = pathAt(comp, t), revPath = pathAt(rev, t), annual = (filed.q.compute * 4) / 1000
      compRow = { co: filed.lab.name, label: filed.q.label, annual, path, ratio: fin(path) ? annual / path : null }
      perDollar = { actual: filed.q.revenue / filed.q.compute, scenario: fin(path) && fin(revPath) ? revPath / path : null }
      // share of compute serving customers: cost of revenue over total compute in the newest filed period that gives both
      const p = (filed.lab.periods || []).at(-1)
      if (p && fin(p.costOfRevenue) && p.compute > 0) serving = { label: p.label, actual: p.costOfRevenue / p.compute, scenario: ext[year] ?? null }
    }

    // unit cost of compute: the H100 one-year contract price against a year earlier, beside the scenario's yearly change
    let unit = null
    try {
      const h = ctx.json('semi-h100-index.json').byDate || {}, days = Object.keys(h).filter(d => fin(h[d].h100)).sort()
      const d1 = days.at(-1), target = `${+d1.slice(0, 4) - 1}${d1.slice(4)}`, d0 = [...days].reverse().find(d => d <= target)
      if (d1 && d0 && fin(tco[year]) && fin(tco[year - 1])) {
        const actual = h[d1].h100 / h[d0].h100 - 1, scen = tco[year] / tco[year - 1] - 1
        unit = { d1, d0, p1: h[d1].h100, p0: h[d0].h100, actual, scen, ratio: (1 + actual) / (1 + scen) }
      }
    } catch { /* the index file is a cache; the row is left out without it */ }

    // context, not graded: world AI data-center spending against five companies' capex; the stock market
    const tc = trailingCapex(hc), spendPath = tc ? pathAt(spend, tc.mid) : null
    let stocks = null
    try {
      const sp = await ctx.fred('SP500', 320), first = sp.filter(o => o.d < `${year}-01-01`).at(-1), now = sp.at(-1)
      if (first && now) stocks = { ytd: (now.v / first.v - 1) * 100, asOf: now.d, claim: (S.narrative || []).find(n => n.id === 'stocks2026')?.value ?? null }
    } catch { /* context only */ }

    const graded = [
      lead && { id: 'revenue', label: 'Lead-lab revenue', ratio: lead.ratio },
      compRow && fin(compRow.ratio) && { id: 'compute', label: 'Lead-lab compute bill', ratio: compRow.ratio },
      unit && { id: 'unit', label: 'Cost of a unit of compute', ratio: unit.ratio },
    ].filter(Boolean)
    if (graded.length < 2) return { status: 'unavailable', headline: 'Too few of the scenario\'s numbers can be set beside a filed figure yet.', asOf: ctx.today }
    const worst = graded.map(g => ({ ...g, miss: miss(g.ratio) })).sort((a, b) => b.miss - a.miss)[0]
    const status = grade(worst.miss, { tension: 1.25, contradiction: 1.5 })
    // the shortage reading holds only when all three line up that way
    const shortage = lead?.ratio >= 1.1 && compRow?.ratio <= 0.9 && unit?.actual > 0
    const glut = lead?.ratio <= 0.9 && compRow?.ratio >= 1.1 && unit?.actual < unit?.scen

    const headline = [
      lead ? `Lead-lab revenue is ${side(lead.ratio)} the AI 2027 path (${times(lead.ratio, 2)})` : null,
      compRow ? `its compute bill is ${side(compRow.ratio)} it (${times(compRow.ratio, 2)})` : null,
      unit ? `and an H100-hour costs ${signedPct(unit.actual * 100)} on a year ago where the scenario had the cost of compute ${unit.scen < 0 ? 'falling' : 'rising'} ${Math.abs(unit.scen * 100).toFixed(0)}%` : null,
    ].filter(Boolean).join(', ') + '.' + (shortage ? ' More revenue from less compute at rising prices: the scenario\'s demand arrived, its supply did not.' : glut ? ' Less revenue from more compute at falling prices: supply ran ahead of demand.' : '')

    return {
      status,
      asOf: [S.reviewed, lead && `${lead.d}-28`, filed?.q.end, unit?.d1].filter(Boolean).sort().pop(),
      headline,
      claims: [
        { label: `Scenario: leading lab's revenue, ${year}`, display: usd(rev[year]), kind: 'forecast', source: `${S.source.title} (${S.series.leadRevenue.locator})`, note: `${usd(rev[year - 1])} in ${year - 1}, ${usd(rev[year + 1])} in ${year + 1}` },
        { label: `Scenario: leading lab's compute cost, ${year}`, display: usd(comp[year]), kind: 'forecast', source: S.series.leadCompute.locator, note: `${usd(comp[year - 1])} in ${year - 1}, ${usd(comp[year + 1])} in ${year + 1}` },
        { label: `Scenario: cost of ownership per H100-equivalent, ${year}`, display: `$${tco[year]}k`, kind: 'forecast', source: S.series.tcoPerH100e.locator, note: `$${tco[year - 1]}k in ${year - 1}: ${signedPct((tco[year] / tco[year - 1] - 1) * 100)} a year` },
        { label: `Scenario: world AI data-center spending, ${year}`, display: usd(spend[year]), kind: 'forecast', source: S.series.globalSpend.locator },
        ...revRows.slice(0, 3).map(r => ({ label: `${r.co}: annualised revenue`, display: usd(r.arr, 1), kind: 'company', source: 'data/ai/revenue-disclosures.json', asOf: mon(`${r.d}-15`), note: r.approx ? 'reported, approximate' : null })),
        filed && { label: `${filed.lab.name}: compute and infrastructure, ${filed.q.label}`, display: `${usd(filed.q.compute / 1000, 2)} in the quarter`, kind: 'official', source: filed.lab.source?.title || 'filed income statement', asOf: filed.q.end, note: `revenue ${usd(filed.q.revenue / 1000, 2)} in the same quarter` },
        unit && { label: 'H100, one-year contract, per hour', display: `$${unit.p1.toFixed(2)}`, kind: 'market', source: 'SemiAnalysis H100 index (semi-h100-index.json)', asOf: unit.d1, note: `$${unit.p0.toFixed(2)} on ${unit.d0}` },
      ].filter(Boolean),
      implied: [
        lead && { label: `Revenue: ${lead.co} against the path in ${mon(`${lead.d}-15`)}`, display: times(lead.ratio, 2), note: `${usd(lead.arr, 1)} annualised against ${usd(lead.path, 1)} on the scenario's path that month${revRows[1] ? `; ${revRows[1].co} ${times(revRows[1].ratio, 2)} in ${mon(`${revRows[1].d}-15`)}` : ''}` },
        compRow && { label: `Compute bill: ${compRow.co}, ${compRow.label}`, display: times(compRow.ratio, 2), note: `${usd(compRow.annual, 1)} a year at the quarter's pace against ${usd(compRow.path, 1)} on the path` },
        perDollar && { label: 'Revenue per dollar of compute', display: `$${perDollar.actual.toFixed(2)} vs $${fin(perDollar.scenario) ? perDollar.scenario.toFixed(2) : '—'}`, note: `filed quarter against the scenario's path at the same date${fin(perDollar.scenario) ? `: ${times(perDollar.actual / perDollar.scenario, 1)} the scenario's` : ''}` },
        unit && { label: 'Unit cost of compute against the scenario', display: times(unit.ratio, 2), note: `an H100-hour is ${signedPct(unit.actual * 100)} on the year; the scenario's cost per H100-equivalent changes ${signedPct(unit.scen * 100)}. A rental price and a cost of ownership are not the same thing, but they should move together` },
        serving && fin(serving.scenario) && { label: 'Share of compute serving customers', display: `${pct(serving.actual * 100, 0)} vs ${pct(serving.scenario * 100, 0)}`, note: `${filed.lab.name}, ${serving.label}: cost of revenue over all compute, against the scenario's external-deployment share for ${year}. Not graded` },
        tc && fin(spendPath) && { label: 'Five hyperscalers\' capex against world AI spending on the path', display: `${usd(tc.capex)} vs ${usd(spendPath)}`, note: `last four quarters to ${qtr(tc.end)}: five companies, all capex, ${pct((tc.capex / spendPath) * 100, 0)} of the scenario's figure for the whole world. Not graded: a different measure` },
        stocks && fin(stocks.claim) && { label: `S&P 500, ${year} to date`, display: `${signedPct(stocks.ytd)} vs +${stocks.claim}%`, note: `to ${stocks.asOf}; the scenario's narrative has the market up ${stocks.claim}% in ${year}. Not graded` },
      ].filter(Boolean),
      gap: {
        label: `Furthest miss from the path: ${worst.label.toLowerCase()}`,
        value: worst.miss, display: times(worst.miss, 2), tension: 1.25, contradiction: 1.5, max: 3,
        note: 'Reality ÷ the scenario\'s path at the same date, or its inverse, whichever is above 1, for the worst of the graded rows. 1.0 is on the path. The size says how far off the scenario is; the direction of each row, in the list above, says why.',
      },
      gives: [
        { label: 'Revenue ahead, compute behind, prices up: a shortage', note: 'If labs earn more than the scenario on a smaller compute bill while old chips rent for more, demand outran the supply the scenario assumed. The scenario\'s takeoff then waits on chips, packaging and power, not on demand.' },
        { label: 'Revenue behind, compute ahead, prices down: a glut', note: 'The mirror image: capacity built ahead of paying demand. This is the pattern that would hurt the suppliers first.' },
        { label: 'Everything ahead: the scenario was too slow', note: 'Revenue, compute and spending all above the path would say the scenario understated the pace, with its 2027 arriving early.' },
        { label: 'The comparison itself is loose', note: 'The scenario\'s leading lab is fictional, its figures are calendar-year totals read here as mid-year paces, and a run-rate is not a year of revenue. A miss under about a quarter is inside that slack.' },
      ],
      watch: [
        { label: 'The next filed quarter', display: filed ? `after ${filed.q.label}` : '—', note: 'A compute bill that jumps toward the path would say the capacity ordered 12 to 18 months ago is arriving; revenue per compute dollar falling back toward the scenario\'s is the first sign of slack.' },
        unit && { label: 'H100 one-year contract price', display: `$${unit.p1.toFixed(2)}/hr`, note: 'A three-year-old chip renting for more each year is the cleanest shortage signal there is; a fall below last year\'s price would be the first crack.' },
        ...(S.notGradable || []).slice(0, 2).map(t => ({ label: 'Cannot be graded', note: t })),
      ].filter(Boolean),
      math: [
        `Path: the scenario's calendar-year figures are read as the pace at mid-year and joined log-linearly, so the path in a given month is between two years' figures. Revenue ${Object.entries(rev).map(([y, v]) => `${y} ${usd(v)}`).join(', ')}; compute ${Object.entries(comp).map(([y, v]) => `${y} ${usd(v)}`).join(', ')}.`,
        lead ? `Revenue: ${lead.co}'s newest disclosed run-rate, ${usd(lead.arr, 1)} (${lead.d}), ÷ the path in that month, ${usd(lead.path, 1)} = ${times(lead.ratio, 2)}. The lab furthest along is taken as the scenario's leader.` : null,
        compRow ? `Compute: ${compRow.co}'s ${compRow.label} compute and infrastructure × 4 = ${usd(compRow.annual, 1)}, ÷ the path at the quarter's middle, ${usd(compRow.path, 1)} = ${times(compRow.ratio, 2)}.` : null,
        unit ? `Unit cost: H100 one-year contract $${unit.p0.toFixed(2)} → $${unit.p1.toFixed(2)} = ${signedPct(unit.actual * 100)}; scenario cost per H100-equivalent $${tco[year - 1]}k → $${tco[year]}k = ${signedPct(unit.scen * 100)}; (1 ${unit.actual >= 0 ? '+' : '−'} ${Math.abs(unit.actual).toFixed(3)}) ÷ (1 ${unit.scen >= 0 ? '+' : '−'} ${Math.abs(unit.scen).toFixed(2)}) = ${times(unit.ratio, 2)}.` : null,
        `Gap: the largest of each graded ratio or its inverse: ${graded.map(g => `${g.label.toLowerCase()} ${times(miss(g.ratio), 2)}`).join(', ')}.`,
      ].filter(Boolean),
      sources: [
        { label: `${S.source.title} (tables read ${S.reviewed})`, url: S.source.url },
        { label: 'AI 2027, main scenario', url: 'https://ai-2027.com/' },
        filed?.lab.source?.url && { label: `${filed.lab.name} ${filed.lab.source.title}`, url: filed.lab.source.url },
      ].filter(Boolean),
    }
  },
}
