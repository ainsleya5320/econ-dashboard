// ============================================================================
// ACCOUNTING QUALITY: the mechanical half of the forensic-accounting books
// (O'glove's Quality of Earnings, Schilit's Financial Shenanigans, Leder's
// Financial Fine Print, Clapham's Smart Money Method) as scores that run on
// any company's statements. The formulas live here once: the stock page's
// Accounting tab feeds them FMP statements (fromFmp), and
// server/sinMonitorSeed.js feeds them SEC XBRL for the 500 largest
// non-financial filers.
//
// A row is one fiscal year, already normalised (null = not reported):
//   flows     rev cogs sga ni cfo dep sbc capex
//   balances  rec inv ca cash ppe ppeGross ta cl ltd gw   (at year end)
// ni is income from continuing operations where the filer gives it; cash
// includes short-term investments; dep is depreciation alone where the filer
// separates it from amortization (FMP does not, so its rows carry D&A).
//
//   Beneish M-score (1999, eight variables). Above −1.78 the profile matches
//     his sample of earnings manipulators; −2.22 is the stricter cut some use.
//     An index whose inputs are missing counts as neutral (1), the usual
//     convention, and each index is held to 0.25–4 (accruals to ±50% of
//     assets) so one degenerate ratio cannot decide the score.
//   Montier C-score (2008): six yes/no tests, 0–6; he read 4 or more as a
//     company likely to be flattering its numbers.
//   Sloan accruals: (net income − operating cash flow) ÷ average assets.
//   Useful life: gross PP&E ÷ depreciation, in years. Lengthening it lowers
//     the depreciation charge (the hyperscalers' server lives).
// None of these proves anything; they say which filings to read.
// ============================================================================

const fin = v => v != null && Number.isFinite(v)
const pos = v => (fin(v) && v > 0 ? v : null)
const div = (a, b) => (fin(a) && fin(b) && b !== 0 ? a / b : null)
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))
// a ratio of two non-negative readings, last year's strictly positive
const ratio = (a, b) => (fin(a) && fin(b) && a >= 0 && b > 0 ? a / b : null)

export const M_CUT = -1.78, M_STRICT = -2.22, C_ZONE = 4

// [key, name, non-manipulator mean, manipulator mean, weight, what a high value says]
// The means are Beneish (1999), Table 2; the weights are his eight-variable probit.
export const BENEISH = [
  ['dsri', 'Receivables to sales', 1.031, 1.465, 0.920, 'receivables growing faster than sales'],
  ['gmi', 'Gross margin index', 1.014, 1.193, 0.528, 'gross margin shrinking'],
  ['aqi', 'Asset quality', 1.039, 1.254, 0.404, 'more of the balance sheet in soft assets'],
  ['sgi', 'Sales growth', 1.134, 1.607, 0.892, 'fast growth, and the pressure to keep it up'],
  ['depi', 'Depreciation index', 1.001, 1.077, 0.115, 'assets depreciated more slowly'],
  ['sgai', 'SG&A to sales', 1.054, 1.041, -0.172, 'overhead rising relative to sales'],
  ['lvgi', 'Leverage', 1.037, 1.111, -0.327, 'leverage rising'],
  ['tata', 'Accruals to assets', 0.018, 0.031, 4.679, 'profit not backed by operating cash'],
]
const M_CONST = -4.84

const grossMargin = r => (pos(r.rev) && fin(r.cogs) ? (r.rev - r.cogs) / r.rev : null)
const softAssets = r => (pos(r.ta) && fin(r.ca) && fin(r.ppe) ? 1 - (r.ca + r.ppe) / r.ta : null)
// Beneish's depreciation rate: depreciation ÷ (depreciation + net PP&E)
export const depRate = r => (r && pos(r.dep) && fin(r.ppe) && r.ppe >= 0 ? r.dep / (r.dep + r.ppe) : null)
const leverage = r => (pos(r.ta) && fin(r.cl) ? (r.cl + (fin(r.ltd) ? r.ltd : 0)) / r.ta : null)

export function beneish(c, p) {
  if (!c || !p) return null
  const gc = grossMargin(c), gp = grossMargin(p)
  const idx = {
    dsri: ratio(div(c.rec, c.rev), div(p.rec, p.rev)),
    gmi: gc > 0 && gp > 0 ? gp / gc : null,
    aqi: ratio(softAssets(c), softAssets(p)),
    sgi: ratio(c.rev, p.rev),
    depi: ratio(depRate(p), depRate(c)),
    sgai: ratio(div(c.sga, c.rev), div(p.sga, p.rev)),
    lvgi: ratio(leverage(c), leverage(p)),
    tata: fin(c.ni) && fin(c.cfo) && pos(c.ta) ? (c.ni - c.cfo) / c.ta : null,
  }
  if (!fin(idx.sgi) || !fin(idx.tata)) return { idx, m: null, neutral: [] }
  const neutral = BENEISH.map(b => b[0]).filter(k => k !== 'tata' && !fin(idx[k]))
  const use = k => (k === 'tata' ? clamp(idx.tata, -0.5, 0.5) : fin(idx[k]) ? clamp(idx[k], 0.25, 4) : 1)
  return { idx, m: BENEISH.reduce((s, [k, , , , w]) => s + w * use(k), M_CONST), neutral }
}

// [key, short name, what a "yes" means]
export const MONTIER = [
  ['gap', 'Profit pulling away from cash', 'the gap between net income and operating cash flow widened'],
  ['dso', 'Receivable days up', 'days sales outstanding rose'],
  ['dsi', 'Inventory days up', 'days of inventory rose'],
  ['oca', 'Other current assets up', 'other current assets rose relative to sales'],
  ['dep', 'Slower depreciation', 'depreciation fell relative to PP&E'],
  ['growth', 'Assets up more than 10%', 'total assets grew more than 10% (acquisitions, capitalised spending)'],
]
const up = (a, b) => (fin(a) && fin(b) ? a > b : null)
const otherCurrent = r => (pos(r.rev) && fin(r.ca) && fin(r.cash) ? (r.ca - r.cash - (r.rec ?? 0) - (r.inv ?? 0)) / r.rev : null)
const grossDepRate = r => (pos(r.dep) && pos(r.ppeGross) ? r.dep / r.ppeGross : null)
const invDays = r => (pos(r.inv) && pos(r.cogs) ? r.inv / r.cogs : null)

export function montier(c, p) {
  if (!c || !p) return null
  // Montier's test is depreciation ÷ gross PP&E; without gross PP&E, Beneish's rate
  const dr = fin(grossDepRate(c)) && fin(grossDepRate(p)) ? grossDepRate : depRate
  const tests = {
    gap: [c.ni, c.cfo, p.ni, p.cfo].every(fin) ? c.ni - c.cfo > p.ni - p.cfo : null,
    dso: up(div(c.rec, c.rev), div(p.rec, p.rev)),
    dsi: up(invDays(c), invDays(p)),
    oca: up(otherCurrent(c), otherCurrent(p)),
    dep: up(dr(p), dr(c)),
    growth: pos(c.ta) && pos(p.ta) ? c.ta / p.ta - 1 > 0.1 : null,
  }
  const v = Object.values(tests)
  return { tests, score: v.filter(x => x === true).length, testable: v.filter(x => x != null).length }
}

export function accruals(c, p) {
  if (!c || !fin(c.ni) || !fin(c.cfo)) return null
  const avg = pos(c.ta) && pos(p?.ta) ? (c.ta + p.ta) / 2 : pos(c.ta)
  return avg ? (c.ni - c.cfo) / avg : null
}
export const usefulLife = r => (r && pos(r.ppeGross) && pos(r.dep) ? r.ppeGross / r.dep : null)

// every score for every year; rows carry a numeric fiscal-year label y
export function assess(rows) {
  const by = new Map(rows.map(r => [r.y, r]))
  return rows.map(r => {
    const p = by.get(r.y - 1) || null, p3 = by.get(r.y - 3) || null
    const life = usefulLife(r), life3 = usefulLife(p3)
    return {
      ...r,
      accruals: accruals(r, p), beneish: beneish(r, p), montier: montier(r, p),
      life, lifeChg3: fin(life) && fin(life3) ? life / life3 - 1 : null,
      sbcRev: div(r.sbc, r.rev), dso: fin(div(r.rec, r.rev)) ? (r.rec / r.rev) * 365 : null,
      dio: fin(invDays(r)) ? invDays(r) * 365 : null, gwTa: div(r.gw, r.ta),
      growth: p && pos(r.rev) && pos(p.rev) ? r.rev / p.rev - 1 : null,
    }
  })
}

// FMP's earnings "actual" is the figure analysts compare with their
// estimates, usually the company's adjusted ("street") number; the quarterly
// statement's diluted EPS is GAAP. Each announcement is matched to the latest
// quarter that ended within 120 days before it. Shared by the stock page's
// Accounting tab and the S&P-wide street gap (server/follyMarkets.js).
export function streetVsGaap(earnings, quarters) {
  const num = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
  const dayOf = s => Date.parse(`${String(s).slice(0, 10)}T00:00:00Z`) / 864e5
  const qs = (quarters || []).filter(r => /^Q[1-4]$/.test(r.period || '') && r.date)
    .map(r => ({ end: r.date, eps: num(r.epsDiluted), shares: num(r.weightedAverageShsOutDil), rev: num(r.revenue), label: `${r.period} ${r.fiscalYear}` }))
    .sort((a, b) => a.end.localeCompare(b.end))
  const seen = new Set(), out = []
  for (const e of (earnings || []).filter(e => e.date && fin(num(e.epsActual))).sort((a, b) => a.date.localeCompare(b.date))) {
    const d = dayOf(e.date), q = qs.filter(x => dayOf(x.end) <= d && d - dayOf(x.end) <= 120).pop()
    if (!q || !fin(q.eps) || seen.has(q.end)) continue
    seen.add(q.end)
    out.push({ label: q.label, end: q.end, gaap: q.eps, street: num(e.epsActual), shares: q.shares, rev: q.rev })
  }
  return out
}

// share of a sorted (ascending) list at or below v, 0–1
export function pctRank(sorted, v) {
  if (!fin(v) || !sorted?.length) return null
  let lo = 0, hi = sorted.length
  while (lo < hi) { const mid = (lo + hi) >> 1; if (sorted[mid] <= v) lo = mid + 1; else hi = mid }
  return lo / sorted.length
}
export function quantile(sorted, q) {
  if (!sorted?.length) return null
  const i = (sorted.length - 1) * q, a = Math.floor(i), b = Math.ceil(i)
  return sorted[a] + (sorted[b] - sorted[a]) * (i - a)
}

// FMP annual statements → rows. FMP writes 0 where a company does not break a
// line out, so 0 reads as "not reported" for lines that cannot really be zero.
export function fromFmp(data) {
  const n = v => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))
  const nz = v => (n(v) ? n(v) : null)
  const abs = v => (fin(v) ? Math.abs(v) : null)
  const by = rows => new Map((rows || []).filter(r => (r.period || 'FY') === 'FY').map(r => [String(r.fiscalYear), r]))
  const I = by(data.inc), B = by(data.bs), C = by(data.cf)
  return [...I.keys()].sort().map(y => {
    const i = I.get(y) || {}, b = B.get(y) || {}, c = C.get(y) || {}
    const ga = nz(i.generalAndAdministrativeExpenses), sm = nz(i.sellingAndMarketingExpenses)
    return {
      y: +y, end: i.date || b.date || null,
      rev: nz(i.revenue), cogs: nz(i.costOfRevenue),
      sga: nz(i.sellingGeneralAndAdministrativeExpenses) ?? (ga != null || sm != null ? (ga ?? 0) + (sm ?? 0) : null),
      ni: nz(i.netIncomeFromContinuingOperations) ?? n(i.netIncome), cfo: n(c.operatingCashFlow) ?? n(c.netCashProvidedByOperatingActivities),
      dep: abs(nz(c.depreciationAndAmortization) ?? nz(i.depreciationAndAmortization)), sbc: abs(nz(c.stockBasedCompensation)), capex: abs(nz(c.capitalExpenditure)),
      rec: nz(b.netReceivables) ?? nz(b.accountsReceivables), inv: n(b.inventory), ca: nz(b.totalCurrentAssets),
      cash: nz(b.cashAndShortTermInvestments) ?? nz(b.cashAndCashEquivalents), ppe: n(b.propertyPlantEquipmentNet), ppeGross: null,
      ta: nz(b.totalAssets), cl: nz(b.totalCurrentLiabilities), ltd: n(b.longTermDebt), gw: n(b.goodwill),
      // lines only the stock page uses
      defRev: n(b.deferredRevenue), acq: n(c.acquisitionsNet), apChange: n(c.accountsPayables),
      taxPaid: nz(c.incomeTaxesPaid), taxExp: n(i.incomeTaxExpense), pretax: n(i.incomeBeforeTax),
    }
  })
}
