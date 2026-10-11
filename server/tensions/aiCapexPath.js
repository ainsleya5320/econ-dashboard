// ============================================================================
// THE AI CAPEX PATH: one yearly path for SemiAnalysis's $11.1T of AI capex
// 2024-29, shared by the AI revenue and AI power checks so the two cards
// always describe the same build-out. SemiAnalysis gives only the six-year
// total. The early years are the five hyperscalers' complete calendar years
// of capex (hyperscaler-capex.json, SEC filings), and the rest grows at a
// constant rate sized so the six years add up to the total.
// ============================================================================
import { fin } from './lib.js'

export const YEARS = [2024, 2025, 2026, 2027, 2028, 2029]

// McKinsey, "The cost of compute: a $7 trillion race to scale data centers" (April 2025): of AI
// data-centre capex to 2030, about 60% buys chips and computing hardware, 25% power, cooling and
// electrical gear, 15% land and construction.
export const IT_SHARE = 0.6
export const POWER_GEAR_SHARE = 0.25
export const LAND_BUILD_SHARE = 0.15

// The five hyperscalers' capex ($B) by calendar year, counting a year only when every company has
// filed all four of its quarters ending in it (Oracle's fiscal quarters end Feb, May, Aug and Nov).
export function calendarCapex(hc) {
  const cos = Object.entries(hc?.companies || {})
  const yearSum = {}
  cos.forEach(([, c], i) => (c.quarters || []).forEach(q => {
    const y = +q.date.slice(0, 4)
    const e = (yearSum[y] ||= { sum: 0, n: cos.map(() => 0) })
    e.sum += (q.capex || 0) / 1e9; e.n[i]++
  }))
  const actual = {}
  for (const y of YEARS) if (cos.length && yearSum[y]?.n.every(k => k === 4)) actual[y] = yearSum[y].sum
  return { actual, cos }
}

// The five hyperscalers' capex and operating cash flow ($B) over one common window, so every
// card quotes the same figure: each company's last four quarters ending by the latest date all
// five have reported through. Oracle's fiscal quarters end a month or two off the calendar, so
// its window can end earlier; `offset` names any company whose window ends in another month.
// `mid` is the window's centre as a fractional year, for comparing with the path.
const tMonthEnd = d => +d.slice(0, 4) + +d.slice(5, 7) / 12
export function trailingCapex(hc) {
  const cos = Object.entries(hc?.companies || {})
  let end = null
  for (const [, c] of cos) { const q = c.quarters || []; if (q.length && (!end || q[q.length - 1].date < end)) end = q[q.length - 1].date }
  if (!end) return null
  let capex = 0, ocf = 0, n = 0
  const per = {}, offset = []
  for (const [k, c] of cos) {
    const q = (c.quarters || []).filter(x => x.date <= end).slice(-4)
    if (q.length < 4) continue
    per[k] = q.reduce((a, x) => a + (x.capex || 0), 0) / 1e9
    capex += per[k]
    ocf += q.reduce((a, x) => a + (x.operatingCashFlow || 0), 0) / 1e9
    n++
    if (q[3].date.slice(0, 7) !== end.slice(0, 7)) offset.push({ name: c.name || k, end: q[3].date })
  }
  return n ? { capex, ocf, per, end, mid: tMonthEnd(end) - 0.5, companies: n, of: cos.length, offset } : null
}

// The path as a twelve-month flow centred at fractional year m: log-linear between calendar
// years, each centred mid-year. Compare a trailing four quarters with pathAt(path, t.mid).
export const pathAt = (path, m) => { const y = Math.floor(m - 0.5), a = path[y], b = path[y + 1]; return fin(a) && fin(b) && a > 0 ? a * (b / a) ** (m - y - 0.5) : null }

// The yearly path: the complete actual years first, then constant growth g from the last actual
// year, solved by bisection so the six years sum to `total`.
export function capexPath(total, actual) {
  const known = []
  for (const y of YEARS) { if (fin(actual[y])) known.push(y); else break }
  if (!known.length) return { path: Object.fromEntries(YEARS.map(y => [y, total / YEARS.length])), g: 1, known }
  const lastY = known[known.length - 1], A = actual[lastY], n = 2029 - lastY
  const rest = total - known.reduce((a, y) => a + actual[y], 0)
  if (n === 0 || rest <= 0) return { path: Object.fromEntries(YEARS.map(y => [y, actual[y] ?? 0])), g: null, known }
  let lo = 0.01, hi = 20
  for (let i = 0; i < 200; i++) {
    const g = (lo + hi) / 2
    let s = 0, p = 1
    for (let j = 0; j < n; j++) { p *= g; s += p }
    if (A * s > rest) hi = g; else lo = g
  }
  const g = (lo + hi) / 2, path = {}
  YEARS.forEach(y => { path[y] = y <= lastY ? actual[y] : A * g ** (y - lastY) })
  return { path, g, known }
}
