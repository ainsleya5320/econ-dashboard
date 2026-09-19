// ============================================================================
// CAPEX RETURNS — does the AI build-out earn its cost of capital?
// The reproducible half of Mauboussin & Callahan, "To Free or Not to Free
// (Cash Flow)" (Counterpoint Global, 17 Sep 2026). Their point: the sign of
// free cash flow tells you nothing on its own. Walmart ran negative FCF for
// fourteen straight years to 1986 while earning 18% on capital, and returned
// 33% a year. What matters is the return on the money going in.
//   FCF        cash from operations MINUS stock-based compensation minus
//              capex. The SBC subtraction is theirs and it matters: SBC is two
//              transactions, issuing shares and paying people, so it belongs in
//              financing rather than operations. It cuts reported operating
//              cash flow by 10–20% for large technology companies, and both
//              definitions are carried here so the gap is visible.
//   ROIC       NOPAT over invested capital, against an assumed cost of capital.
//   ROIIC      their formula exactly — a three-year change in NOPAT over the
//              capital deployed in the three years BEFORE it:
//                 (NOPAT_t − NOPAT_t-3) ÷ (IC_t-1 − IC_t-4)
//              The one-year lag is the whole point when invested capital is
//              compounding this fast: without it you divide this year's profit
//              by plant that has not been switched on.
//   life cycle Dickinson's classification from the signs of operating,
//              investing and financing cash flow. Eight sign combinations, five
//              stages, and a firm can move backwards — which is the finding:
//              Alphabet, Meta and Oracle went from maturity back to growth.
// Everything comes from SEC XBRL company-concept (10-K and 10-Q, audited).
// The consensus forecasts in the paper come from FactSet and are NOT
// reproducible here, so this covers actuals only — which do at least update
// every quarter rather than being a September snapshot.
// Cached 24h, disk-backed, stale served on error.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, TTL = 24 * H, DAY = 864e5
const fin = v => v != null && Number.isFinite(v)
const r1 = v => (fin(v) ? +v.toFixed(1) : null), r2 = v => (fin(v) ? +v.toFixed(2) : null)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const sum = (xs, f) => xs.reduce((s, x) => s + (f(x) || 0), 0)

const COMPANIES = [
  { t: 'MSFT',  name: 'Microsoft',      cik: '0000789019', hyper: true,  color: '#00A4EF' },
  { t: 'AMZN',  name: 'Amazon',         cik: '0001018724', hyper: true,  color: '#FF9900' },
  { t: 'GOOGL', name: 'Alphabet',       cik: '0001652044', hyper: true,  color: '#4285F4' },
  { t: 'META',  name: 'Meta Platforms', cik: '0001326801', hyper: true,  color: '#0668E1' },
  { t: 'ORCL',  name: 'Oracle',         cik: '0001341439', hyper: true,  color: '#F80000' },
  { t: 'NVDA',  name: 'Nvidia',         cik: '0001045810', hyper: false, color: '#76b900' },
  { t: 'AAPL',  name: 'Apple',          cik: '0000320193', hyper: false, color: '#A2AAAD' },
  { t: 'MU',    name: 'Micron',         cik: '0000723125', hyper: false, color: '#8B5CF6' },
]
// flow concepts (duration facts) — first tagged wins
const FLOW = {
  cfo:    ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  cfi:    ['NetCashProvidedByUsedInInvestingActivities'],
  cff:    ['NetCashProvidedByUsedInFinancingActivities'],
  sbc:    ['ShareBasedCompensation'],
  // filers change capex tags mid-life: Amazon and Nvidia moved to
  // PaymentsToAcquireProductiveAssets, so candidates are merged rather than
  // chosen between — picking the first populated one loses the recent years
  capex:  ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets', 'PaymentsForCapitalImprovements'],
  ebit:   ['OperatingIncomeLoss'],
  tax:    ['IncomeTaxExpenseBenefit'],
  pretax: ['IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest',
           'IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments'],
  revenue: ['RevenueFromContractWithCustomerExcludingAssessedTax', 'Revenues'],
}
// balance-sheet concepts (instant facts). Debt and marketable securities are
// tagged differently by different filers, so each is a sum over a candidate set.
const STOCK = {
  equity: ['StockholdersEquity'],
  cash:   ['CashAndCashEquivalentsAtCarryingValue'],
}
const DEBT_SETS = [
  ['LongTermDebtNoncurrent', 'LongTermDebtCurrent'],
  ['LongTermDebt'],
  ['DebtLongtermAndShorttermCombinedAmount'],
  ['LongTermDebtAndCapitalLeaseObligations'],
]
const MKTSEC = ['MarketableSecuritiesCurrent', 'ShortTermInvestments', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent']

// Dickinson (2011): the life-cycle stage is the sign pattern of the three
// cash-flow statements. Shake-out is the catch-all.
function dickinson(cfo, cfi, cff) {
  if (![cfo, cfi, cff].every(fin)) return null
  const o = cfo > 0, i = cfi > 0, f = cff > 0
  if (!o && !i && f) return 'introduction'
  if (o && !i && f) return 'growth'
  if (o && !i && !f) return 'maturity'
  if (!o && i) return 'decline'
  return 'shake-out'
}

export function createCapexReturns({ UA, dir, wacc = 8, taxFloor = 0.05, taxCap = 0.40, defaultTaxRate = 0.21 }) {
  const file = n => path.join(dir, n)
  const load = n => { try { if (fs.existsSync(file(n))) return JSON.parse(fs.readFileSync(file(n), 'utf8')) } catch {} return null }
  const save = (n, o) => { try { fs.writeFileSync(file(n), JSON.stringify(o)) } catch (e) { console.error(`${n} save:`, e.message) } }
  let mem = null, inflight = null

  let next = 0
  async function concept(cik, name) {
    const slot = Math.max(Date.now(), next); next = slot + 150
    if (slot > Date.now()) await sleep(slot - Date.now())
    const r = await fetch(`https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${name}.json`, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (r.status === 404) return null
    if (!r.ok) throw new Error(`SEC ${name} HTTP ${r.status}`)
    const j = await r.json()
    const unit = Object.keys(j.units || {})[0]
    return (j.units?.[unit] || []).filter(x => /^10-[QK]$/.test(x.form) && fin(x.val))
  }
  // Merge every candidate concept into one series. A company can switch tags
  // between years, so taking the first concept that looks populated silently
  // drops the recent end of the series — which is exactly where the AI capex is.
  // An earlier-listed concept wins a date tie; otherwise the later filing does.
  async function merged(cik, names, keep) {
    const by = new Map(), used = []
    for (const n of names) {
      const rows = await concept(cik, n)
      if (!rows?.length) continue
      let added = 0
      for (const x of rows) {
        if (!keep(x)) continue
        const prev = by.get(x.end)
        if (!prev) { by.set(x.end, { ...x, _c: n }); added++ }
        else if (prev._c === n && (x.filed || '') > (prev.filed || '')) by.set(x.end, { ...x, _c: n })
      }
      if (added) used.push(n)
    }
    return by.size >= 4 ? { concept: used.join(' + '), byEnd: by } : null
  }
  // A fiscal year is a full-year duration inside a 10-K. A 365-day window inside
  // a 10-Q is a trailing-twelve-month figure — Amazon and Nvidia both publish
  // those, and counting them produces dozens of overlapping "years".
  const annualFlow = (cik, names) => merged(cik, names, x => {
    if (!x.start || !x.fy || x.form !== '10-K') return false
    const days = (Date.parse(x.end) - Date.parse(x.start)) / DAY
    return days >= 330 && days <= 400
  })
  const instant = (cik, names) => merged(cik, names, x => !x.start)

  async function forCompany(c) {
    const flows = {}, notes = []
    for (const [k, names] of Object.entries(FLOW)) {
      const s = await annualFlow(c.cik, names)
      flows[k] = s
      if (!s) notes.push(`${k}: not tagged`)
    }
    const equity = await instant(c.cik, STOCK.equity)
    const cash = await instant(c.cik, STOCK.cash)
    let debt = null
    for (const set of DEBT_SETS) {
      const parts = []
      for (const n of set) { const s = await instant(c.cik, [n]); if (s) parts.push(s) }
      if (parts.length) { debt = { concepts: parts.map(p => p.concept), parts }; break }
    }
    let msec = null
    for (const n of MKTSEC) { const s = await instant(c.cik, [n]); if (s) { msec = s; break } }

    // the fiscal-year ends we have a cash-flow statement for
    const ends = [...(flows.cfo?.byEnd.keys() || [])].sort()
    const at = (s, end) => (s?.byEnd.get(end)?.val ?? null)
    // a balance-sheet instant is dated the same day as the fiscal year end; allow a few days' slack
    const near = (s, end) => {
      if (!s) return null
      if (s.byEnd.has(end)) return s.byEnd.get(end).val
      const t = Date.parse(end)
      let best = null, bd = Infinity
      for (const [k, v] of s.byEnd) { const d = Math.abs(Date.parse(k) - t); if (d < bd && d <= 6 * DAY) { bd = d; best = v.val } }
      return best?.val ?? best ?? null
    }
    const nearVal = (s, end) => { const v = near(s, end); return fin(v) ? v : null }

    const years = ends.map(end => {
      const cfo = at(flows.cfo, end), cfi = at(flows.cfi, end), cff = at(flows.cff, end)
      const sbc = at(flows.sbc, end), capex = at(flows.capex, end)
      const ebit = at(flows.ebit, end), tax = at(flows.tax, end), pretax = at(flows.pretax, end)
      const rev = at(flows.revenue, end)
      const eq = nearVal(equity, end), csh = nearVal(cash, end)
      const dbt = debt ? debt.parts.reduce((s, p) => s + (nearVal(p, end) || 0), 0) : null
      const ms = nearVal(msec, end)
      const usable = fin(tax) && fin(pretax) && pretax > 0
      const rate = usable ? Math.min(taxCap, Math.max(taxFloor, tax / pretax)) : defaultTaxRate
      const rateAssumed = !usable
      const nopat = fin(ebit) ? ebit * (1 - rate) : null
      // invested capital, financing view: equity + debt − cash and near-cash
      const ic = fin(eq) ? eq + (dbt || 0) - (csh || 0) - (ms || 0) : null
      return {
        end, fy: +end.slice(0, 4),
        cfo, cfi, cff, sbc, capex, ebit, tax, pretax, revenue: rev,
        fcf: fin(cfo) && fin(capex) ? cfo - (sbc || 0) - capex : null,      // Mauboussin: SBC removed
        fcfStandard: fin(cfo) && fin(capex) ? cfo - capex : null,           // the common definition
        sbcDrag: fin(cfo) && fin(sbc) && cfo !== 0 ? r1((sbc / cfo) * 100) : null,
        taxRate: r1(rate * 100), taxRateAssumed: rateAssumed, nopat, equity: eq, cash: csh, marketable: ms, debt: dbt, ic,
        stage: dickinson(cfo, cfi, cff),
      }
    }).filter(y => fin(y.cfo))

    // ROIC on beginning invested capital, and ROIIC exactly as they define it
    for (let i = 0; i < years.length; i++) {
      const y = years[i], prev = years[i - 1]
      y.roic = fin(y.nopat) && prev && fin(prev.ic) && prev.ic > 0 ? r1((y.nopat / prev.ic) * 100) : null
      // Oracle and others have run negative book equity after large buybacks, which
      // makes the financing view of invested capital meaningless rather than absent
      y.icNegative = !!(prev && fin(prev.ic) && prev.ic <= 0)
      const y3 = years[i - 3], ic1 = years[i - 1], ic4 = years[i - 4]
      if (fin(y.nopat) && y3 && fin(y3.nopat) && ic1 && ic4 && fin(ic1.ic) && fin(ic4.ic)) {
        const dNopat = y.nopat - y3.nopat, dIc = ic1.ic - ic4.ic
        y.roiic = dIc > 0 ? r1((dNopat / dIc) * 100) : null
        if (dIc <= 0) y.roiicNote = 'invested capital shrank over the window, so a return on the increment is undefined'
        y.roiicWindow = { nopatFrom: y3.fy, nopatTo: y.fy, icFrom: ic4.fy, icTo: ic1.fy, dNopat, dIc }
      } else { y.roiic = null; y.roiicNote = 'needs four prior years' }
    }
    return { ...c, years, notes, concepts: { flows: Object.fromEntries(Object.entries(flows).map(([k, v]) => [k, v?.concept || null])), equity: equity?.concept, cash: cash?.concept, debt: debt?.concepts || null, marketable: msec?.concept } }
  }

  async function build() {
    const t0 = Date.now()
    const out = []
    for (const c of COMPANIES) {
      try { out.push(await forCompany(c)) }
      catch (e) { console.warn(`capex-returns ${c.t}:`, e.message); out.push({ ...c, years: [], error: e.message }) }
    }
    const good = out.filter(c => c.years.length)
    // aggregate the five hyperscalers, mapping each fiscal year to the calendar
    // year its year-end falls in. The paper calendarizes properly with FactSet;
    // this is an approximation and is labelled as one.
    const hypers = good.filter(c => c.hyper)
    const calYears = [...new Set(hypers.flatMap(c => c.years.map(y => y.fy)))].sort()
    const combined = calYears.map(fy => {
      const rows = hypers.map(c => c.years.find(y => y.fy === fy)).filter(Boolean)
      if (rows.length < hypers.length) return null // only complete years
      const nopat = sum(rows, r => r.nopat), ic = sum(rows, r => r.ic)
      return { fy, n: rows.length, fcf: sum(rows, r => r.fcf), fcfStandard: sum(rows, r => r.fcfStandard),
        capex: sum(rows, r => r.capex), cfo: sum(rows, r => r.cfo), sbc: sum(rows, r => r.sbc), nopat, ic,
        revenue: sum(rows, r => r.revenue) }
    }).filter(Boolean)
    for (let i = 0; i < combined.length; i++) {
      const y = combined[i], prev = combined[i - 1]
      y.roic = prev && prev.ic > 0 ? r1((y.nopat / prev.ic) * 100) : null
      y.icNegative = !!(prev && prev.ic <= 0)
      const y3 = combined[i - 3], ic1 = combined[i - 1], ic4 = combined[i - 4]
      y.roiic = y3 && ic1 && ic4 && ic1.ic - ic4.ic > 0 ? r1(((y.nopat - y3.nopat) / (ic1.ic - ic4.ic)) * 100) : null
    }

    const latest = c => c.years[c.years.length - 1] || null
    return {
      ts: Date.now(), built: new Date().toISOString(), buildSecs: Math.round((Date.now() - t0) / 1000), ttlHours: TTL / H,
      wacc, companies: out, combined,
      headline: {
        combinedLatest: combined[combined.length - 1] || null,
        combinedPeakRoic: combined.reduce((a, b) => (fin(b.roic) && (!a || b.roic > a.roic) ? b : a), null),
        aboveWacc: good.filter(c => fin(latest(c)?.roic) && latest(c).roic > wacc).map(c => c.t),
        negativeFcf: good.filter(c => fin(latest(c)?.fcf) && latest(c).fcf < 0).map(c => c.t),
        stageShifts: good.map(c => {
          const ys = c.years.filter(y => y.stage)
          const last = ys[ys.length - 1], prior = [...ys].reverse().find(y => y.stage !== last?.stage)
          return last ? { t: c.t, stage: last.stage, fy: last.fy, from: prior ? { stage: prior.stage, fy: prior.fy } : null } : null
        }).filter(Boolean),
      },
      method: {
        fcf: 'cash flow from operations minus stock-based compensation minus capital expenditures',
        roic: 'NOPAT (operating income after the effective tax rate) over beginning invested capital',
        roiic: '(NOPAT in year t minus NOPAT in year t−3) ÷ (invested capital at t−1 minus at t−4) — a three-year change in profit over the capital deployed in the three years before it',
        ic: 'shareholders equity plus total debt minus cash and marketable securities',
        lifeCycle: 'Dickinson (2011): the stage is the sign pattern of operating, investing and financing cash flow',
        wacc: `cost of capital assumed at ${wacc}%, the figure the paper uses for this group`,
      },
      source: `SEC XBRL company-concept API — annual 10-K figures, audited. Method after Michael J. Mauboussin and Dan Callahan, "To Free or Not to Free (Cash Flow)", Counterpoint Global Consilient Observer, 17 September 2026. The consensus forecasts in that paper come from FactSet and are not reproducible from public sources, so everything here is actuals. Figures are each company's own fiscal year, mapped to the calendar year of its year-end for the combined series; the paper calendarizes properly.`,
    }
  }

  async function get() {
    if (mem && Date.now() - mem.ts < TTL) return mem
    if (!mem) { const disk = load('capex-returns.json'); if (disk && Date.now() - disk.ts < TTL) { mem = disk; return mem } }
    if (inflight) return inflight
    inflight = (async () => {
      try { const d = await build(); if (d.companies.filter(c => c.years?.length).length < 6) throw new Error('too few companies resolved'); mem = d; save('capex-returns.json', d); return d }
      catch (e) { console.warn('capex returns build:', e.message); const disk = mem || load('capex-returns.json'); if (disk) return disk; throw e }
      finally { inflight = null }
    })()
    return inflight
  }

  return { get }
}
