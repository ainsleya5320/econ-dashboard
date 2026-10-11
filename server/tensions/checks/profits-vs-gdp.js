// ============================================================================
// PROFITS VS GDP: do earnings forecasts assume profits outgrow the economy?
// Damodaran's implied equity risk premium is solved from the S&P 500's level
// at the start of the month on the assumption that index earnings grow at his
// expected rate for five years. His convention (ERPOct26.xlsx, sheets 'Impl
// premium calculator' and 'Expected growth rate'): the base is last calendar
// year's earnings (2025 in a 2026 sheet); the rate compounds analysts'
// consensus for the next two calendar years with straight steps down to the
// T-bond rate by year five; the path ends with the calendar year five years
// after the base (2030). The check keeps that calendar. The profit share starts
// from its base-year average, and the economy's growth in dollars covers the
// five years after the base: the Fed's real GDP medians, plus its PCE inflation
// path for a year mostly in the data and the higher of that path and the
// five-year breakeven after it. S&P 500 earnings are not the profits in the
// national accounts (NIPA): foreign mix, buybacks, sector mix, accounting. So
// only growth rates are compared, never levels, and the S&P rate is first cut
// by the trend gap between S&P earnings per share and NIPA profit growth over
// the past twenty years (least-squares fits, so no single year sets it).
// Gap = profit share in the end year ÷ the record since 1947, both four-quarter
// averages because the earnings are calendar-year totals. At 1× the path needs
// a record share: a tension, since records do get set (2005-06, 2010, 2012,
// 2021, 2026). The contradiction line is computed live: the next 0.05 step at
// least 0.02 above the most the share has ever beaten the record standing five
// years earlier (1.20×, 2006 Q3, so 1.25× today). Past it, the path needs more
// than the whole history of the series has shown. No prediction market prices
// five-year earnings or GDP growth, so none is used.
// Inputs: damodaranErp (monthly ERP two ways, growth, T-bond, S&P level),
// src/lib/damodaran.json (annual S&P earnings yield and level since 1960),
// follyMarkets (CAPE), kalecki (only to confirm the Profits engine shows the
// same share), FRED (CP, CPATAX, GDP, GDPC1, the latest SEP medians, T5YIE,
// DFII10). The check re-solves Damodaran's own calculator at the growth the
// record allows, to show how much of the premium rests on the growth input.
// ============================================================================
import { fin, pct, pp, times, usd, grade, last, lastV, ago, qtr, mon } from '../lib.js'

const YEARS = 5 // Damodaran's high-growth phase
const TENSION = 1 // a record profit share
const ALLOWANCE_YEARS = 20 // window for the S&P-vs-NIPA growth allowance
// Typo guard. At the sheet's own growth rate, his trailing-cash-flow premium implies a payout
// (dividends and buybacks ÷ earnings). From Jan 2016 to Oct 2026 that payout ran 63% to 104% in
// ERPbymonth.xlsx, through the 2020 earnings collapse (84-93%). The March 2026 row printed growth of
// 0.83% beside a 4.37% premium solved with about 11-12%, and needed 122%. Outside this band the
// growth input cannot have produced his own premium.
const PAYOUT_BAND = [40, 115]
// The analysts' consensus behind his growth input: ERPOct26.xlsx, sheet 'Expected growth rate',
// rows 5-7 (top-down consensus of 2026-09-24, S&P 500 earnings per share). Shown only while it
// reproduces the live input, so it drops out by itself when his next sheet moves the numbers.
const CONSENSUS = { base: [2025, 271.29], next: [[2026, 363.13], [2027, 418.64]] }
// the nearest precedent for a technology-led boom: real GDP 1995 Q4 to 2000 Q4 (FRED GDPC1)
const BOOM = ['1995-10-01', '2000-10-01']

const geo = xs => (xs.length ? Math.pow(xs.reduce((a, x) => a * (1 + x / 100), 1), 1 / xs.length) * 100 - 100 : null)
const pctile = (vals, v) => (vals.length && fin(v) ? Math.round((vals.filter(x => x <= v).length / vals.length) * 100) : null)
const ordinal = n => (fin(n) ? `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th'}` : '—')
// an optional input gets a time limit, so a cold feed cannot hold up the check
const within = (p, ms) => Promise.race([p, new Promise(res => setTimeout(() => res(null), ms))]).catch(() => null)
const cagr = (a, b, n) => (fin(a) && fin(b) && a > 0 && b > 0 && n > 0 ? (Math.pow(b / a, 1 / n) - 1) * 100 : null)
const num = (v, dp = 1) => (fin(v) ? v.toFixed(dp).replace('-', '−') : '—') // a true minus sign
const signed = (v, dp = 1) => (fin(v) ? `${v > 0 ? '+' : ''}${num(v, dp)}%` : '—')
const mean = xs => xs.reduce((a, x) => a + x, 0) / xs.length
const median = xs => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)] }
// least-squares growth rate of f(y) over the years ys, % a year
const trend = (ys, f) => {
  const v = ys.map(y => Math.log(f(y))), mx = mean(ys), mv = mean(v)
  let num = 0, den = 0
  ys.forEach((x, i) => { num += (x - mx) * (v[i] - mv); den += (x - mx) ** 2 })
  return (Math.exp(num / den) - 1) * 100
}

// Damodaran's calculator, per unit of index price. Fed his own Oct 2026 inputs (cash flow 198.17,
// trailing earnings 311.98, so a payout of 63.5%, on 2025 earnings of 271.29) it gives his 3.6975%.
// Base-year earnings grow at g for five years. Cash paid out (dividends and buybacks) starts at
// k0 per unit of price and moves in straight steps to kT by year five, where kT stands in for his
// sustainable payout. Only the part of year one still ahead counts (f = months left ÷ 12); cash
// flows fall at f, f+1, ..., f+4; the terminal value at f+4 grows at the T-bond rate forever.
// Discount at T-bond + premium.
const pv = (g, r, rf, f, k0, kT) => {
  let s = 0, e = 1
  for (let t = 1; t <= YEARS; t++) {
    e *= 1 + g
    const cf = e * (k0 - (t * (k0 - kT)) / YEARS)
    s += (t === 1 ? cf * f : cf) / Math.pow(1 + r, f + t - 1)
  }
  return s + (e * (1 + rf) * kT) / (r - rf) / Math.pow(1 + r, f + YEARS - 1)
}
// the discount rate at which that path is worth the price (bisection; pv falls as r rises)
const solveR = (g, rf, f, k0, kT) => {
  let lo = rf + 1e-4, hi = rf + 0.4
  if (pv(g, hi, rf, f, k0, kT) > 1 || pv(g, lo, rf, f, k0, kT) < 1) return null
  for (let i = 0; i < 100; i++) { const mid = (lo + hi) / 2; if (pv(g, mid, rf, f, k0, kT) > 1) lo = mid; else hi = mid }
  return (lo + hi) / 2
}

export default {
  id: 'profits-vs-gdp',
  domain: 'economy',
  order: 4,
  title: 'Do earnings forecasts assume profits outgrow the economy?',
  question: 'Can S&P 500 earnings grow as fast as the forecast behind Damodaran\'s risk premium while the economy grows at the pace the Fed and bond markets expect?',
  see: 'Charts: U.S. Economy → Growth → Profits engine (profits as a share of GDP); Stocks → Sin & Folly (CAPE); Cockpit → Valuation, three lenses (Damodaran\'s premium).',
  async compute(ctx) {
    const [dam, folly, kal, cp, cpa, gdp, rgdp, sepG, sepP, sepGlr, sepPlr, be5, tips] = await Promise.all([
      ctx.source('damodaranErp'),
      within(ctx.source('follyMarkets'), 20e3), within(ctx.source('kalecki'), 10e3),
      ctx.fred('CP', 400), ctx.fred('CPATAX', 400).catch(() => []), ctx.fred('GDP', 400), ctx.fred('GDPC1', 130).catch(() => []),
      ctx.fred('GDPC1MD', 8).catch(() => []), ctx.fred('PCECTPIMD', 8).catch(() => []),
      ctx.fred('GDPC1MDLR', 2).catch(() => []), ctx.fred('PCECTPIMDLR', 2).catch(() => []),
      ctx.fred('T5YIE', 10).catch(() => []), ctx.fred('DFII10', 10).catch(() => []),
    ])
    let annual = []
    try { annual = ctx.json('src/lib/damodaran.json').erp || [] } catch { /* without it no allowance is made */ }

    // ── Damodaran's sheet: growth, premium, and the calendar they run on ──
    const gE = fin(dam?.growth) ? dam.growth * 100 : null
    if (!fin(gE)) throw new Error('Damodaran\'s expected-growth input is missing (his monthly sheet did not load; the home-page fallback does not carry it)')
    if (gE < -10 || gE > 40) throw new Error(`Damodaran's expected growth reads ${pct(gE, 2)}, outside any plausible five-year range, so it looks like a typo in his sheet`)
    const erp = dam.erp * 100, tbond = dam.tbond * 100, erpCash = fin(dam.erpCash) ? dam.erpCash * 100 : null
    const damMonth = mon(dam.asOf), damDay = new Date(`${dam.asOf}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
    const spTxt = fin(dam.sp500) ? Math.round(dam.sp500).toLocaleString('en-US') : null
    const baseYear = +dam.asOf.slice(0, 4) - 1, endYear = baseYear + YEARS
    const monthsLeft = 13 - +dam.asOf.slice(5, 7), f = monthsLeft / 12 // his table: January 12 months left, December 1

    // annual S&P 500 earnings per share = year-end earnings yield × index level
    const eps = Object.fromEntries(annual.filter(r => fin(r.ey) && fin(r.sp)).map(r => [r.y, r.ey * r.sp]))

    // ── the calculator, calibrated to his two premiums ──
    // k0 makes his trailing-cash-flow premium come out; kT then makes the headline premium come out
    let k0 = null, kT = null, payout = null, payoutT = null
    if (fin(erp) && fin(tbond) && erp > 0.2) {
      const rf = tbond / 100, g = gE / 100
      k0 = 1 / pv(g, rf + (fin(erpCash) && erpCash > 0.2 ? erpCash : erp) / 100, rf, f, 1, 1)
      if (fin(erpCash) && erpCash > 0.2) {
        const A = pv(g, rf + erp / 100, rf, f, k0, 0), B = pv(g, rf + erp / 100, rf, f, k0, 1) - A
        kT = B > 0 ? (1 - A) / B : null
      }
      if (!fin(kT) || kT <= 0) kT = k0
      if (fin(eps[baseYear]) && fin(dam.sp500)) { payout = (k0 * dam.sp500) / eps[baseYear] * 100; payoutT = (kT * dam.sp500) / eps[baseYear] * 100 }
    }
    if (fin(payout) && (payout < PAYOUT_BAND[0] || payout > PAYOUT_BAND[1])) {
      throw new Error(`Damodaran's expected growth reads ${pct(gE, 2)}, which cannot have produced his own ${pct(erpCash ?? erp, 2)} premium: it would take companies paying out ${pct(payout, 0)} of earnings (his sheet has implied 63% to 104% since 2016), so it looks like a typo in his sheet`)
    }

    // the analysts' consensus inside the growth rate, while it still reproduces the input
    const cons = (() => {
      if (CONSENSUS.base[0] !== baseYear) return null
      const g1 = CONSENSUS.next[0][1] / CONSENSUS.base[1] - 1, g2 = CONSENSUS.next[1][1] / CONSENSUS.next[0][1] - 1, rf = tbond / 100
      const path = [g1, g2, g2 - (g2 - rf) / 3, g2 - (2 * (g2 - rf)) / 3, rf]
      const c = (Math.pow(path.reduce((a, x) => a * (1 + x), 1), 1 / YEARS) - 1) * 100
      // how much of the five-year compounding the two consensus years carry
      const front = (Math.log(1 + g1) + Math.log(1 + g2)) / path.reduce((a, x) => a + Math.log(1 + x), 0)
      return Math.abs(c - gE) < 0.02 ? { path: path.map(x => x * 100), years: path.map((_, i) => baseYear + 1 + i), front } : null
    })()

    // ── the economy's expected growth in dollars, the five calendar years after the base ──
    // Fed SEP medians by year (Q4 over Q4) where projected, the longer-run median after that
    const years = Array.from({ length: YEARS }, (_, i) => baseYear + 1 + i)
    const byYear = s => Object.fromEntries((s || []).map(x => [+x.d.slice(0, 4), x.v]))
    const gY = byYear(sepG), pY = byYear(sepP), gLR = lastV(sepGlr), pLR = lastV(sepPlr)
    const realPath = years.map(y => (fin(gY[y]) ? gY[y] : gLR))
    const pcePath = years.map(y => (fin(pY[y]) ? pY[y] : pLR))
    if (!realPath.every(fin)) throw new Error('the Fed\'s real GDP projections are unavailable')
    const be = lastV(be5)
    // a first year mostly in the data takes the Fed's projection alone (the breakeven looks forward
    // from today); later years take the higher read, which gives stock prices the benefit of the doubt
    const firstDone = f < 0.5
    const inflPath = pcePath.map((p, i) => (i === 0 && firstDone && fin(p) ? p : fin(p) && fin(be) ? Math.max(p, be) : fin(p) ? p : be))
    if (!inflPath.every(fin)) throw new Error('no inflation expectation is available (SEP PCE and the five-year breakeven both failed)')
    const nomPath = realPath.map((r, i) => ((1 + r / 100) * (1 + inflPath[i] / 100) - 1) * 100)
    const real = geo(realPath), infl = geo(inflPath), gN = geo(nomPath)
    const pce = pcePath.every(fin) ? geo(pcePath) : null
    const beYears = years.filter((y, i) => !(i === 0 && firstDone) && fin(be) && inflPath[i] === be && inflPath[i] !== pcePath[i])
    const inflFrom = !fin(be) ? 'the Fed PCE path; the five-year breakeven did not load'
      : beYears.length ? `${firstDone ? `the Fed PCE path for ${years[0]}, mostly in the data; ` : ''}the five-year breakeven for ${beYears.length > 1 ? `${beYears[0]}-${beYears[beYears.length - 1]}` : beYears[0]}, above the Fed path there`
        : 'the Fed PCE path, at or above the five-year breakeven in every year'
    const sepDate = last(sepGlr)?.d
    const lastSep = Math.max(...years.filter(y => fin(gY[y])), years[0] - 1)

    // ── corporate profits as a share of GDP ──
    // CP is after-tax book profits (no inventory or depreciation adjustments), the NIPA measure
    // closest to what companies report. The Profits engine reads A551RC1Q027SBEA (after-tax profits
    // with those adjustments) first and falls back to CP; that series id is empty on FRED, so the
    // engine shows CP today. The same adjusted measure is on FRED as CPATAX and is shown beside it.
    const gdpBy = new Map(gdp.map(x => [x.d, x.v]))
    const shareOf = s => s.filter(x => gdpBy.get(x.d) > 0).map(x => ({ d: x.d, v: (x.v / gdpBy.get(x.d)) * 100, cp: x.v, gdp: gdpBy.get(x.d) }))
    const share = shareOf(cp)
    if (share.length < 40) throw new Error('corporate profits or GDP are unavailable from FRED')
    const now = last(share), recQ = share.reduce((a, b) => (b.v > a.v ? b : a))
    const atRecordQ = now.v >= recQ.v - 1e-9
    const med = median(share.map(x => x.v)), from = share[0].d.slice(0, 4)
    // four-quarter averages, the basis that matches calendar-year earnings
    const avg4 = share.map((x, i) => (i >= 3 ? { d: x.d, v: (share[i].v + share[i - 1].v + share[i - 2].v + share[i - 3].v) / 4 } : null)).filter(Boolean)
    const now4 = last(avg4), rec = avg4.reduce((a, b) => (b.v > a.v ? b : a))
    const atRecord4 = now4.v >= rec.v - 1e-9
    // the most the four-quarter share has ever beaten the record standing five years earlier
    let over = null, runMax = -Infinity
    for (let i = YEARS * 4; i < avg4.length; i++) {
      runMax = Math.max(runMax, avg4[i - YEARS * 4].v)
      const r = avg4[i].v / runMax
      if (!over || r > over.r) over = { r, d: avg4[i].d, v: avg4[i].v, prior: runMax }
    }
    const CONTRADICTION = Math.ceil((over.r + 0.02) * 20) / 20
    // years in which the four-quarter share set a new all-time high (after the series' first five years)
    const recYears = []
    for (let i = 0, m = -Infinity; i < avg4.length; i++) {
      if (avg4[i].v > m && i >= YEARS * 4) { const y = avg4[i].d.slice(0, 4); if (!recYears.includes(y)) recYears.push(y) }
      m = Math.max(m, avg4[i].v)
    }
    // calendar-year averages, for the base year and the history of fast-growth stretches
    const yearAvg = (s, y) => { const q = s.filter(x => x.d.startsWith(`${y}-`)); return q.length === 4 ? mean(q.map(x => x.v)) : null }
    let baseShare = yearAvg(share, baseYear), baseLabel = `${baseYear}`, baseIsYear = true
    if (!fin(baseShare)) { baseShare = now4.v; baseLabel = `the four quarters to ${qtr(now.d)}`; baseIsYear = false }
    const five = ago(share, YEARS * 4)
    const cpPast = cagr(five?.cp, now.cp, YEARS), gdpPast = cagr(five?.gdp, now.gdp, YEARS)
    // the adjusted measure, and what the Profits engine shows
    const shareA = shareOf(cpa), nowA = last(shareA)
    const atRecordA = nowA && shareA.every(x => x.v <= nowA.v + 1e-9)
    const kalNow = fin(kal?.latest?.actual) && kal.latest.d === now.d ? kal.latest.actual : null

    // ── the bridge: how much faster S&P 500 earnings per share grew than NIPA profits ──
    // CP averaged over each year's four quarters; growth as least-squares trends over the window
    const cpYear = y => { const q = cp.filter(x => x.d.startsWith(`${y}-`)); return q.length === 4 ? mean(q.map(x => x.v)) : null }
    const both = Object.keys(eps).map(Number).filter(y => fin(cpYear(y)))
    const lastY = both.length ? Math.max(...both) : null, firstY = both.length ? Math.min(...both) : null
    const trendGap = (a, b) => {
      const ys = both.filter(y => y >= a && y <= b)
      if (ys.length < 0.8 * (b - a + 1)) return null
      const e = trend(ys, y => eps[y]), c = trend(ys, cpYear)
      return { e, c, w: e - c, a, b }
    }
    const wedgeOver = (a, b) => { const e = cagr(eps[a], eps[b], b - a), c = cagr(cpYear(a), cpYear(b), b - a); return fin(e) && fin(c) ? { e, c, w: e - c, a, b } : null }
    const base = both.length > 25 ? trendGap(lastY - ALLOWANCE_YEARS, lastY) : null
    const rolling = []
    if (base) for (let a = firstY; a + ALLOWANCE_YEARS <= lastY; a++) { const w = trendGap(a, a + ALLOWANCE_YEARS); if (w) rolling.push(w.w) }
    const rollMed = rolling.length ? median(rolling) : null, rollMin = rolling.length ? Math.min(...rolling) : null, rollMax = rolling.length ? Math.max(...rolling) : null
    const widestNow = base && rolling.length && base.w >= rollMax - 1e-9
    const tenY = base ? trendGap(lastY - 10, lastY) : null
    const longest = base ? wedgeOver(firstY, lastY) : null
    let widest5 = null // the widest five-year gap on record, the same length as the requirement
    if (base) for (let y = firstY; y + YEARS <= lastY; y++) { const w = wedgeOver(y, y + YEARS); if (w && (!widest5 || w.w > widest5.w)) widest5 = w }
    const allow = fin(base?.w) ? Math.max(0, base.w) : 0
    const gP = gE - allow // NIPA-basis profit growth the earnings path needs

    // ── where the profit share ends up ──
    const factor = Math.pow((1 + gP / 100) / (1 + gN / 100), YEARS)
    const factorRaw = Math.pow((1 + gE / 100) / (1 + gN / 100), YEARS)
    const implied = baseShare * factor, impliedRaw = baseShare * factorRaw
    const ratio = implied / rec.v
    const status = grade(ratio, { tension: TENSION, contradiction: CONTRADICTION })
    const needsRecord = ratio >= TENSION
    const lift = Math.pow(rec.v / baseShare, 1 / YEARS) // a year, from the base share to the record
    // the fastest S&P growth (from the base year, his terms) that leaves profits at no more than the record
    const gMaxNipa = ((1 + gN / 100) * lift - 1) * 100
    const gMax = gMaxNipa + allow
    const gConNipa = ((1 + gN / 100) * Math.pow((CONTRADICTION * rec.v) / baseShare, 1 / YEARS) - 1) * 100
    // the S&P-over-NIPA gap that would square the path with the record, and the one that ends the contradiction
    const wedgeNeeded = gE - gMaxNipa, allowFlip = gE - gConNipa
    // nominal growth that holds profits to their record share, and how real growth or inflation could supply it
    const needN = ((1 + gP / 100) / lift - 1) * 100
    const inflNeeded = ((1 + needN / 100) / (1 + real / 100) - 1) * 100
    const realNeeded = ((1 + needN / 100) / (1 + infl / 100) - 1) * 100
    const boomA = rgdp.find(x => x.d === BOOM[0])?.v, boomB = rgdp.find(x => x.d === BOOM[1])?.v
    const boomReal = cagr(boomA, boomB, 5)
    const boomShare = fin(boomReal) && needN > gN ? ((((1 + boomReal / 100) * (1 + infl / 100) - 1) * 100 - gN) / (needN - gN)) : null
    // the path's first year against the quarters already published
    const firstPath = baseShare * ((1 + gP / 100) / (1 + nomPath[0] / 100))
    const firstQs = share.filter(x => x.d.startsWith(`${years[0]}-`))
    const firstActual = baseIsYear && firstQs.length ? mean(firstQs.map(x => x.v)) : null
    // stretches when S&P earnings compounded within a point of this pace, and where the profit share started
    const yearsShare = [...new Set(share.map(x => +x.d.slice(0, 4)))].map(y => ({ y, v: yearAvg(share, y) })).filter(x => fin(x.v))
    const recThrough = y => Math.max(...yearsShare.filter(x => x.y <= y).map(x => x.v))
    const fast = []
    if (base) for (let a = firstY; a + YEARS <= lastY; a++) {
      const g = cagr(eps[a], eps[a + YEARS], YEARS), s = yearAvg(share, a)
      if (fin(g) && g >= gE - 1 && fin(s)) fast.push({ a, b: a + YEARS, g, rel: s / recThrough(a) })
    }
    const fastMax = fast.length ? Math.max(...fast.map(x => x.rel)) : null
    const nowRel = baseIsYear ? baseShare / recThrough(baseYear) : null

    // ── the premium if earnings grew only that fast ──
    let erpAtMax = null
    if (fin(k0) && fin(kT)) { const r = solveR(gMax / 100, tbond / 100, f, k0, kT); erpAtMax = fin(r) ? r * 100 - tbond : null }
    const thinner = fin(erpAtMax) && erpAtMax < erp
    const showErp = needsRecord && fin(erpAtMax) // only meaningful when the growth input exceeds what the record allows
    const annErp = annual.filter(r => fin(r.erp)).map(r => ({ y: r.y, v: r.erp * 100 }))
    const lowerYears = fin(erpAtMax) ? annErp.filter(r => r.v < erpAtMax) : []
    const monthsHigher = (dam.series || []).filter(x => fin(x.erp) && x.erp > dam.erp).length, nMonths = (dam.series || []).filter(x => fin(x.erp)).length

    // ── CAPE: what prices pay for normalized earnings ──
    const capeRows = (folly?.cape || []).filter(x => fin(x?.[1]))
    const cape = capeRows.length ? capeRows[capeRows.length - 1] : null
    const capePct = cape ? pctile(capeRows.map(x => x[1]), cape[1]) : null
    const capeMax = capeRows.length ? capeRows.reduce((a, b) => (b[1] > a[1] ? b : a)) : null
    const capeYield = cape ? 100 / cape[1] : null, tipsNow = lastV(tips)

    const asOf = [dam.asOf, now.d, last(be5)?.d, last(tips)?.d].filter(Boolean).sort().pop()
    const span = `${years[0]}-${endYear}`
    const consTxt = cons ? `analysts' consensus for ${cons.years[0]} (${signed(cons.path[0])}) and ${cons.years[1]} (${signed(cons.path[1])}), then straight steps down to the T-bond rate by ${endYear}` : `analysts' consensus for the next two years, then straight steps down to the T-bond rate by ${endYear}`
    // overlapping stretches with consecutive start years read as one span (1992-97 and 1993-98 as 1992-98)
    const spans = []
    for (const x of fast) { const s = spans[spans.length - 1]; if (s && x.a === s.lastA + 1) { s.b = x.b; s.lastA = x.a } else spans.push({ a: x.a, b: x.b, lastA: x.a }) }
    const fastList = spans.map(x => `${x.a}-${String(x.b).slice(2)}`).join(', ')

    return {
      status,
      asOf,
      headline: `Damodaran's ${pct(erp, 2)} risk premium assumes S&P 500 earnings grow ${pct(gE)} a year to ${endYear}; against ${pct(gN)} a year of GDP growth in dollars${allow > 0 ? `, ${needsRecord ? 'even ' : ''}after ${allow.toFixed(1)} points a year for buybacks and overseas profits` : ''}, corporate profits would go from ${pct(baseShare)} of GDP to about ${pct(implied)}${needsRecord ? `, ${times(ratio, 2)} their ${pct(rec.v)} record.` : `, ${implied <= baseShare ? 'no higher than now' : `still short of their ${pct(rec.v)} record`}: the claims fit.`}`,
      claims: [
        { label: `Expected S&P 500 earnings growth, ${baseYear} to ${endYear}`, display: `${pct(gE)} a year`, kind: 'forecast', source: 'Aswath Damodaran (NYU Stern), growth input to his implied-premium model', asOf: damMonth, note: `compounds ${consTxt} (his convention); after ${endYear} his model grows earnings at the T-bond rate, ${pct(tbond, 2)}` },
        { label: 'Implied equity risk premium', display: pct(erp, 2), kind: 'forecast', source: `Damodaran, solved from the S&P 500${spTxt ? ` at ${spTxt}` : ''} on ${damDay} and that growth`, asOf: damMonth, note: [nMonths > 24 && `lower than ${Math.round((monthsHigher / nMonths) * 100)}% of months since ${dam.since}`, fin(erpCash) && `${pct(erpCash, 2)} if companies keep paying out what they did in the past year, without his sustainable-payout adjustment`, !cape && 'Shiller CAPE is left out: the Sin & Folly feed did not answer in time'].filter(Boolean).join('; ') || null },
        cape && { label: 'Shiller CAPE (price ÷ ten-year average real earnings)', display: `${cape[1].toFixed(1)} (${ordinal(capePct)} pct.)`, kind: 'market', source: 'Robert Shiller, shillerdata.com', asOf: mon(`${cape[0]}-01`), note: `ranked since ${capeRows[0][0].slice(0, 4)}; record ${capeMax[1].toFixed(1)} (${mon(`${capeMax[0]}-01`)}). Earnings yield ${pct(capeYield, 2)}${fin(tipsNow) ? ` vs ${pct(tipsNow, 2)} on ten-year TIPS` : ''}` },
        { label: 'Corporate profits after tax, share of GDP', display: pct(now.v), kind: 'official', source: 'BEA corporate profits (CP) ÷ nominal GDP (FRED)', asOf: qtr(now.d), note: [`${atRecordQ ? `the highest quarter since ${from}` : `record ${pct(recQ.v)} (${qtr(recQ.d)})`}; four-quarter average ${pct(now4.v)}${atRecord4 ? ', also a record' : ` (record ${pct(rec.v)}, ${qtr(rec.d)})`}; ${baseIsYear ? `${baseYear} average ${pct(baseShare)}; ` : ''}median ${pct(med)}`, nowA && `with inventory and depreciation adjustments (CPATAX) ${pct(nowA.v)}${atRecordA ? ', also a record' : ''}`, fin(kalNow) && Math.abs(kalNow - now.v) > 0.05 && `the Profits engine chart shows ${pct(kalNow)}, on the adjusted measure`].filter(Boolean).join('; ') },
        { label: `Fed projections, ${span}: real GDP / PCE inflation`, display: `${pct(real)} / ${fin(pce) ? pct(pce) : '—'}`, kind: 'consensus', source: 'FOMC Summary of Economic Projections, medians (FRED)', asOf: sepDate, note: `year by year: real ${realPath.map(v => v.toFixed(1)).join(', ')}; inflation ${pcePath.map(v => (fin(v) ? v.toFixed(1) : '—')).join(', ')}${lastSep < endYear ? ` (longer-run medians after ${lastSep})` : ''}` },
        fin(be) && { label: 'Five-year breakeven inflation', display: pct(be, 2), kind: 'market', source: 'Treasury yield less TIPS yield, five years (FRED T5YIE)', asOf: last(be5)?.d, note: 'CPI-based, which usually runs a little above the PCE price index' },
        { label: 'Past five years: profits vs nominal GDP', display: `${pct(cpPast)} vs ${pct(gdpPast)} a year`, kind: 'official', source: 'BEA (FRED CP, GDP)', asOf: `${qtr(five?.d)} to ${qtr(now.d)}`, note: `profits ${cpPast >= gdpPast ? 'outgrew' : 'lagged'} the economy by ${Math.abs(cpPast - gdpPast).toFixed(1)} points a year, and their share went from ${pct(five?.v)} to ${pct(now.v)}` },
      ].filter(Boolean),
      implied: [
        { label: `Nominal GDP growth, ${span}`, display: `${pct(gN)} a year`, note: `${pct(real)} real growth plus ${pct(infl, 2)} inflation (${inflFrom})` },
        { label: 'Allowance: S&P earnings per share over profits in the national accounts (NIPA)', display: `${pp(allow)} a year`, note: fin(base?.w) ? `trend growth ${base.a}-${base.b}: S&P earnings per share ${pct(base.e)} a year, NIPA profits ${pct(base.c)}${base.w > 0 ? '' : ', so no allowance is made'}. Across the ${rolling.length} twenty-year windows since ${firstY} the gap ran ${num(rollMin)} to ${num(rollMax)} points (median ${num(rollMed)})${widestNow ? '; today\'s is the widest, the generous end of history' : ''}` : 'not computable, so no allowance is made' },
        { label: 'Profit growth the earnings path needs', display: `${pct(gP)} a year`, note: `${pct(gE)} less the allowance, against ${pct(gN)} for the economy` },
        { label: `Profit share of GDP in ${endYear}`, display: pct(implied), note: `${times(factor, 2)} ${baseIsYear ? `the ${baseYear} average of ${pct(baseShare)}` : `the ${pct(baseShare)} of ${baseLabel}`}; ${pct(impliedRaw)} without the allowance; record ${pct(rec.v)} (four-quarter average)` },
        { label: 'S&P earnings growth that keeps profits at their record share', display: `${pct(gMax)} a year`, note: `${baseYear} to ${endYear}, in Damodaran's terms: profits end at no more than ${pct(rec.v)} of GDP` },
        showErp && { label: `Implied premium if earnings grow ${pct(gMax)}`, display: pct(erpAtMax, 2), note: `instead of ${pct(erp, 2)}, at the ${damDay} level${spTxt ? ` of ${spTxt}` : ''}, on Damodaran's own model${annErp.length ? `; ${lowerYears.length ? `${lowerYears.length <= annErp.length / 4 ? 'only ' : ''}${lowerYears.length} of ${annErp.length} year-end readings since ${annErp[0].y} were lower` : `lower than every year-end reading since ${annErp[0].y}`}` : ''}` },
      ].filter(Boolean),
      gap: {
        label: `Profit share of GDP in ${endYear} ÷ record (four-quarter averages)`,
        value: ratio, display: times(ratio, 2), tension: TENSION, contradiction: CONTRADICTION, max: 2,
        tensionLabel: 'record', contradictionLabel: `${CONTRADICTION}×`,
        note: `At 1×, the earnings path needs profits to take a record slice of GDP. Past ${CONTRADICTION}×, it needs more than any five-year stretch since ${from} has added to a standing record (the most was ${times(over.r, 2)}, ${qtr(over.d)}).`,
      },
      gives: needsRecord ? [
        { label: 'Earnings forecasts come down', note: `${cons ? `${cons.front > 0.5 ? 'Most' : 'Much'} of the ${pct(gE)} sits in analysts' numbers for ${cons.years[0]} and ${cons.years[1]} (${signed(cons.path[0])} and ${signed(cons.path[1])}), ${Math.round(cons.front * 100)}% of the five-year compounding. ` : ''}Growth from ${baseYear} to ${endYear} would have to average ${pct(gMax)} to keep profits at their record share.${showErp ? ` At that pace the ${damDay} level implies a premium of ${pct(erpAtMax, 2)} over Treasuries${thinner ? `, not ${pct(erp, 2)}: either prices fall or investors accept a thinner reward for owning stocks` : ''}.` : ''}` },
        { label: 'Profits take a record share of the economy', note: `Wages, interest or taxes give up ground: the share goes from ${pct(baseShare)} in ${baseLabel} to ${pct(implied)} in ${endYear}, ${num(implied - rec.v)} points of GDP above the record. In the Kalecki identity, profits rise with bigger government deficits or an investment boom (see the Profits engine).${fast.length && fin(nowRel) ? ` S&P earnings have compounded ${pct(gE - 1)} a year or more over five years before (${fastList}), but each time from a profit share at most ${pct(fastMax * 100, 0)} of the record standing then; this path starts from ${pct(nowRel * 100, 0)}${nowRel > fastMax ? ', closer to a record than any of them' : ''}.` : !fast.length && base ? ` S&P earnings have not compounded ${pct(gE - 1)} a year or more over any five years since ${firstY}.` : ''}` },
        { label: 'S&P companies outgrow the rest of corporate America', note: `Buybacks, foreign earnings and the technology mix would have to open a gap of ${wedgeNeeded.toFixed(1)} points a year for five years between S&P earnings per share and profits in the national accounts, against the ${allow.toFixed(1)} allowed for above.${widest5 ? ` The widest five-year gap since ${firstY} is ${widest5.w.toFixed(1)} points (${widest5.a}-${widest5.b})` : ''}${fin(longest?.w) ? `; over the whole period the two grew at ${Math.abs(longest.w) < 1 ? 'almost the same pace' : 'different paces'} (${pct(longest.e)} vs ${pct(longest.c)} a year)` : ''}.` },
        realNeeded > real && { label: 'Real growth beats the Fed', note: `Holding profits to their record share takes nominal GDP growth near ${pct(needN)} a year: real growth near ${pct(realNeeded)} at the expected ${pct(infl, 2)} inflation, against the Fed's ${pct(real)}.${fin(boomShare) ? (boomShare < 1 ? ` Even the ${pct(boomReal)} a year of 1995-2000, the nearest precedent for a technology-led boom, would close only about ${Math.round(boomShare * 100)}% of that shortfall in nominal growth.` : ` The ${pct(boomReal)} a year of 1995-2000, the nearest precedent for a technology-led boom, would be enough.`) : ''}` },
        inflNeeded > infl && { label: 'Inflation does the work', note: `At the Fed's real growth, nominal GDP gets there only if inflation runs near ${pct(inflNeeded)} a year, against the ${pct(infl, 2)} expected, and that would raise the discount rate on the same earnings.` },
      ].filter(Boolean) : [
        { label: 'Nothing has to give on this count', note: `At ${pct(gE)} a year, earnings leave profits at ${pct(implied)} of GDP in ${endYear}, below the record ${pct(rec.v)}. The risk to prices is then a fall in profits, as in a recession, rather than a growth assumption the economy cannot carry.` },
      ],
      watch: [
        { label: 'Damodaran\'s expected earnings growth', display: pct(gE), note: needsRecord ? `monthly; the input to watch fall toward ${pct(gMax)}` : `monthly; room to rise to ${pct(gMax)} before profits need a record share` },
        { label: 'Corporate profits, share of GDP', display: pct(now.v), note: 'quarterly, BEA, about two months after quarter-end' },
        cape && { label: 'Shiller CAPE', display: cape[1].toFixed(1), note: `record ${capeMax[1].toFixed(1)}; a falling CAPE with steady earnings is prices conceding the growth` },
        fin(be) && { label: 'Five-year breakeven inflation', display: pct(be, 2), note: 'the only route to faster nominal GDP without faster real growth' },
      ].filter(Boolean),
      math: [
        `Damodaran's ${damMonth} sheet: S&P 500 ${spTxt ?? '—'} on ${damDay}, T-bond ${pct(tbond, 2)}, expected earnings growth ${pct(gE, 2)} a year from ${baseYear} earnings to ${endYear}, implied premium ${pct(erp, 2)} (${fin(erpCash) ? `${pct(erpCash, 2)} on trailing cash payouts` : 'trailing-cash version unavailable'}).${cons ? ` The rate compounds analysts' consensus for ${cons.years[0]} (${signed(cons.path[0], 2)}) and ${cons.years[1]} (${signed(cons.path[1], 2)}), then ${cons.path.slice(2).map((g, i) => `${cons.years[i + 2]} ${pct(g, 2)}`).join(', ')} in straight steps to the T-bond rate: (${cons.path.map(g => (1 + g / 100).toFixed(4)).join(' × ')})^(1/5) − 1 = ${pct(gE, 2)}.` : ''}`,
        `Nominal GDP, ${span}: real growth of ${realPath.map(v => v.toFixed(1)).join(', ')}% (SEP medians, longer-run where not projected) compounds to ${pct(real, 2)} a year. Inflation of ${inflPath.map(v => v.toFixed(2)).join(', ')}% (${inflFrom}) compounds to ${pct(infl, 2)}. Year by year (1 + real) × (1 + inflation) gives ${nomPath.map(v => v.toFixed(2)).join(', ')}%, which compounds to ${pct(gN, 2)} a year.`,
        `S&P 500 earnings are not NIPA profits. S&P companies earn a larger share abroad than corporate America as a whole (NIPA counts US companies' foreign profits but nets out profits paid to foreign owners). They are per share, so buybacks lift them; they lean to technology; and they follow company accounting. Only growth rates are compared here. ${fin(base?.w) ? `Trend growth ${base.a}-${base.b}, a least-squares fit to the logs of yearly values so no single year sets it: S&P earnings per share (Damodaran's year-end earnings yield × index) ${pct(base.e, 2)} a year, NIPA profits (CP, four-quarter average) ${pct(base.c, 2)}. The S&P rate is cut by ${allow.toFixed(2)} points: ${pct(gE, 2)} − ${allow.toFixed(2)} = ${pct(gP, 2)} a year of profit growth. Twenty-year windows since ${firstY} ran ${num(rollMin, 2)} to ${num(rollMax, 2)} points (median ${num(rollMed, 2)})${tenY ? `; the past ten years' trend gap was ${num(tenY.w, 2)}` : ''}.` : 'The allowance could not be computed, so none is made.'}`,
        `Profit share: CP ${usd(now.cp)} ÷ GDP ${usd(now.gdp)} (annual rates) = ${pct(now.v, 2)} (${qtr(now.d)}); four-quarter average ${pct(now4.v, 2)}; ${baseIsYear ? `${baseYear} average ${pct(baseShare, 2)}` : `no complete ${baseYear} yet, so the base is the latest four quarters, ${pct(baseShare, 2)}`}. Record four-quarter average since ${from}: ${pct(rec.v, 2)} (${qtr(rec.d)}); median quarter ${pct(med, 2)}.`,
        `In ${endYear}: ${pct(baseShare, 2)} × (${(1 + gP / 100).toFixed(4)} ÷ ${(1 + gN / 100).toFixed(4)})^5 = ${pct(baseShare, 2)} × ${factor.toFixed(3)} = ${pct(implied, 2)}; without the allowance ${pct(impliedRaw, 2)}. Against the record: ${pct(implied, 2)} ÷ ${pct(rec.v, 2)} = ${times(ratio, 2)}.`,
        `Thresholds: 1× is a new record. Records do get set (in ${recYears.join(', ')}), so reaching one is a tension. The four-quarter share has never ended a five-year stretch more than ${times(over.r, 3)} above the record standing at its start (${qtr(over.d)}: ${pct(over.v)} against ${pct(over.prior)}). The contradiction line is the next 0.05 step at least 0.02 beyond that: ${CONTRADICTION}×.`,
        `Sensitivity to the allowance: ${status === 'contradiction' ? `the grade stays a contradiction for any allowance below ${allowFlip.toFixed(1)} points and falls below the record only above ${wedgeNeeded.toFixed(1)}`
          : status === 'tension' ? `the grade stays a tension for any allowance below ${wedgeNeeded.toFixed(1)} points${allowFlip > 0 ? ` and becomes a contradiction below ${allowFlip.toFixed(1)}` : ''}`
            : wedgeNeeded > 0 ? `the grade stays consistent for any allowance above ${wedgeNeeded.toFixed(1)} points` : 'the grade is consistent even with no allowance'}. With no allowance the ratio is ${times(impliedRaw / rec.v, 2)}.`,
        `Fastest S&P growth the record allows: ${(1 + gN / 100).toFixed(4)} × (${pct(rec.v, 2)} ÷ ${pct(baseShare, 2)})^(1/5) − 1 = ${pct(gMaxNipa, 2)} for profits, plus the ${allow.toFixed(2)}-point allowance = ${pct(gMax, 2)} a year for S&P earnings per share. Nominal growth that holds profits to the record: ${(1 + gP / 100).toFixed(4)} ÷ ${lift.toFixed(4)} − 1 = ${pct(needN, 2)} a year.${fin(boomReal) ? ` Real GDP grew ${pct(boomReal, 2)} a year from ${qtr(BOOM[0])} to ${qtr(BOOM[1])}.` : ''}`,
        fin(firstActual) ? `Year one: the path puts the ${years[0]} share at ${pct(firstPath, 2)}; the ${firstQs.length} published quarter${firstQs.length > 1 ? 's' : ''} of ${years[0]} averaged ${pct(firstActual, 2)}, ${firstActual >= firstPath ? `so profits are running ahead of it: the path's first year is already in the data, and the latest quarter's ${pct(now.v)} is part of the path, not extra room.` : `so profits are running behind it and the rest of ${years[0]} has ground to make up.`}` : null,
        `Horizons: Damodaran's path runs from ${baseYear} earnings to ${endYear}, so the profit share starts from ${baseIsYear ? `its ${baseYear} average` : `the latest four quarters (${baseYear} is not complete yet)`} and the economy's growth covers ${span}. SEP medians are fourth quarter over fourth quarter and the shares are calendar-year averages, so the two windows differ by about half a year.`,
        showErp ? `Premium at that growth, on the structure of Damodaran's own calculator: ${baseYear} earnings grow at g for five years; ${monthsLeft === 12 ? `all of ${years[0]} counts` : `of ${years[0]}, only the ${monthsLeft} month${monthsLeft > 1 ? 's' : ''} still ahead count${monthsLeft > 1 ? '' : 's'}`}; the value after year five grows at the T-bond rate; discount at T-bond + premium. Dividends and buybacks start at ${fin(payout) ? `${pct(payout)} of earnings, ` : ''}the payout at which his ${pct(erpCash ?? erp, 2)} comes out${Math.abs(kT / k0 - 1) > 1e-3 ? `, and move in straight steps by year five to ${fin(payoutT) ? `${pct(payoutT)}, ` : ''}the end point at which his ${pct(erp, 2)} comes out (it stands in for his sustainable payout)` : ''}. At ${pct(gMax, 2)} growth and the same price: ${pct(erpAtMax, 2)}. His terminal growth, the T-bond rate ${pct(tbond, 2)}, is itself ${tbond > gN ? 'above' : 'at or below'} the ${pct(gN, 2)} nominal GDP growth used here; that is left as is.` : needsRecord ? 'The premium could not be re-solved.' : null,
        fin(payout) ? `Input check: at ${pct(gE, 2)} growth his ${pct(erpCash ?? erp, 2)} premium needs companies to pay out ${pct(payout)} of ${baseYear} earnings. From 2016 his sheet implied 63% to 104%. A growth input that needs less than ${PAYOUT_BAND[0]}% or more than ${PAYOUT_BAND[1]}% is treated as a typo; March 2026's printed 0.83% needed 122%.` : `Input check skipped: src/lib/damodaran.json has no ${baseYear} earnings yet, so a typo in the growth input would not be caught.`,
        !cape ? 'Shiller CAPE is left out: the Sin & Folly feed did not answer in time.' : null,
        fin(capeYield) ? `CAPE ${cape[1].toFixed(1)} is an earnings yield of 1 ÷ ${cape[1].toFixed(1)} = ${pct(capeYield, 2)} on ten-year average real earnings${fin(tipsNow) ? `, ${capeYield < tipsNow ? 'below' : 'above'} the ${pct(tipsNow, 2)} real yield on ten-year TIPS` : ''}: ${fin(tipsNow) && capeYield < tipsNow ? 'on normalized earnings stocks yield less than inflation-protected Treasuries, so their case rests on growth' : 'a guide to how much of the price rests on growth'}.` : null,
      ].filter(Boolean),
      sources: [
        { label: 'Damodaran, implied equity risk premium by month and the monthly calculator (NYU Stern)', url: 'https://pages.stern.nyu.edu/~adamodar/New_Home_Page/datafile/implpr.html' },
        { label: 'BEA corporate profits after tax, CP (FRED)', url: 'https://fred.stlouisfed.org/series/CP' },
        { label: 'BEA corporate profits after tax with inventory and depreciation adjustments, CPATAX (FRED)', url: 'https://fred.stlouisfed.org/series/CPATAX' },
        { label: 'Nominal GDP (FRED)', url: 'https://fred.stlouisfed.org/series/GDP' },
        { label: 'FOMC Summary of Economic Projections, real GDP medians (FRED)', url: 'https://fred.stlouisfed.org/series/GDPC1MD' },
        { label: 'FOMC Summary of Economic Projections, PCE inflation medians (FRED)', url: 'https://fred.stlouisfed.org/series/PCECTPIMD' },
        { label: 'Five-year breakeven inflation (FRED)', url: 'https://fred.stlouisfed.org/series/T5YIE' },
        { label: 'Real GDP (FRED)', url: 'https://fred.stlouisfed.org/series/GDPC1' },
        { label: 'Shiller CAPE (shillerdata.com)', url: 'https://shillerdata.com/' },
      ],
    }
  },
}
