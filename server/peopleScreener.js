// ============================================================================
// PEOPLE SCREENER — revenue (and profit, and market cap) per employee, S&P 500
// Two FMP calls per company, once a month, no model involved:
//   employee-count      10-K headcounts with the period they were reported for
//   income-statement    the last two fiscal years (revenue, operating income,
//                       net income) — matched to the headcount nearest that
//                       fiscal year-end, so the ratio is FY revenue ÷ FY-end staff
// Market cap, sector and industry are joined from the S&P screener file the
// dashboard already maintains (sp500-data.json). Results persist in
// sp500-people.json; a rate-limit stop saves partial progress and the next
// request resumes where it left off. Employee counts change once a year, so
// the TTL is 30 days.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const TTL = 30 * 24 * 60 * 60 * 1000
const DAY = 24 * 60 * 60 * 1000

export function createPeopleScreener({ FMP_KEY, UA, dir, tickers, sp500File }) {
  const FILE = path.join(dir, 'sp500-people.json')
  const load = () => { try { if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch {} return null }
  const store = load() || { ts: 0, rows: {} }
  const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(store)) } catch (e) { console.error('People screener save:', e.message) } }
  let building = false, progress = ''

  const fetchJSON = async url => {
    const ctrl = new AbortController(), t = setTimeout(() => ctrl.abort(), 12000)
    try {
      const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: ctrl.signal })
      const d = await r.json()
      if (d && d['Error Message']) return { error: d['Error Message'] }
      return d
    } catch { return null } finally { clearTimeout(t) }
  }
  const url = (ep, sym) => `https://financialmodelingprep.com/stable/${ep}?symbol=${sym}&apikey=${FMP_KEY}`

  async function fetchOne(ticker) {
    const sym = ticker.replace('.', '-')
    const [ec, inc] = await Promise.all([fetchJSON(url('employee-count', sym)), fetchJSON(`${url('income-statement', sym)}&limit=2`)])
    const err = ec?.error || inc?.error
    if (err) return { rateLimited: /limit/i.test(err) }
    if (ec == null || inc == null) return null // transient — try again next build
    const emps = (Array.isArray(ec) ? ec : []).filter(e => e.employeeCount > 0 && e.periodOfReport).sort((a, b) => b.periodOfReport.localeCompare(a.periodOfReport))
    const fy = (Array.isArray(inc) ? inc : []).filter(i => i.revenue > 0 && i.date)
    const now = Date.now()
    if (!fy.length) return { row: { symbol: ticker, fetched: now, missing: true } } // no headcount rows is fine — the profile fallback below covers it
    // headcount print nearest the fiscal year-end (10-K counts are sometimes dated a few weeks off)
    const near = date => {
      if (!emps.length) return null
      const t = Date.parse(date)
      const best = emps.reduce((b, e) => (Math.abs(Date.parse(e.periodOfReport) - t) < Math.abs(Date.parse(b.periodOfReport) - t) ? e : b), emps[0])
      return Math.abs(Date.parse(best.periodOfReport) - t) <= 120 * DAY ? best : null
    }
    let e0 = near(fy[0].date), e1 = fy[1] ? near(fy[1].date) : null
    let empSource = '10-K'
    // Two known holes in the feed: some filers have no employee-count rows at
    // all (XOM, IBM, WFC…), and the odd 10-K print is a parsing glitch (PPL
    // 300 vs 6,653 the year before). In both cases the company profile's
    // headcount is a second source — one extra call, only when needed.
    const glitch = e0 && e1 && (e0.employeeCount / e1.employeeCount > 3 || e0.employeeCount / e1.employeeCount < 1 / 3)
    if (!e0 || glitch) {
      const prof = await fetchJSON(url('profile', sym))
      const pf = Array.isArray(prof) ? parseFloat(prof[0]?.fullTimeEmployees) : NaN
      if (pf > 0 && (!e1 || (pf / e1.employeeCount < 3 && pf / e1.employeeCount > 1 / 3))) { e0 = { employeeCount: pf, periodOfReport: fy[0].date }; empSource = glitch ? 'profile (10-K print looked wrong)' : 'profile (no 10-K print in the feed)' }
      else if (glitch) { e1 = null } // can't tell which print is right — keep the latest, drop the growth comparison
    }
    if (!e0) return { row: { symbol: ticker, fetched: now, missing: true } }
    return {
      row: {
        symbol: ticker, fetched: now, empSource,
        employees: e0.employeeCount, empDate: e0.periodOfReport,
        fy: fy[0].fiscalYear, fyDate: fy[0].date, revenue: fy[0].revenue, opInc: fy[0].operatingIncome ?? null, netInc: fy[0].netIncome ?? null,
        empPrev: e1?.employeeCount ?? null, empPrevDate: e1?.periodOfReport ?? null,
        revPrev: fy[1]?.revenue ?? null, opIncPrev: fy[1]?.operatingIncome ?? null, netIncPrev: fy[1]?.netIncome ?? null,
      },
    }
  }

  async function build() {
    if (building) return
    building = true
    try {
      const need = tickers.filter(t => !store.rows[t] || store.rows[t].missing || Date.now() - (store.rows[t].fetched || 0) > TTL)
      const BATCH = 5, DELAY = 2600 // 2 calls × 5 per 2.6 s ≈ 230/min, under FMP Starter's 300/min
      console.log(`People screener: refreshing ${need.length} of ${tickers.length} companies`)
      for (let i = 0; i < need.length; i += BATCH) {
        const batch = need.slice(i, i + BATCH)
        const res = await Promise.all(batch.map(t => fetchOne(t).catch(() => null)))
        let limited = false
        res.forEach((r, j) => { if (!r) return; if (r.rateLimited) limited = true; else if (r.row) store.rows[batch[j]] = r.row })
        progress = `${Math.min(i + BATCH, need.length)}/${need.length}`
        if (limited) { console.log(`People screener: rate limited at ${progress} — partial progress saved, resumes next request`); break }
        if (i % 50 === 0) save()
        if (i + BATCH < need.length) await new Promise(r => setTimeout(r, DELAY))
      }
      store.ts = Date.now()
      save()
      console.log(`People screener: ${Object.values(store.rows).filter(r => !r.missing).length}/${tickers.length} companies with headcount + revenue`)
    } finally { building = false; progress = '' }
  }

  const sp500 = () => { try { const d = JSON.parse(fs.readFileSync(sp500File, 'utf8')); return Object.fromEntries((d.data || []).map(s => [s.symbol, s])) } catch { return {} } }

  function get() {
    const have = Object.values(store.rows).filter(r => !r.missing).length
    const pending = tickers.filter(t => !store.rows[t] || store.rows[t].missing).length
    // monthly refresh; a first build below half coverage; and a retry of names that came back empty, at most every 10 minutes
    if ((Date.now() - store.ts > TTL || have < tickers.length * 0.5 || (pending > 0 && Date.now() - store.ts > 10 * 60 * 1000)) && !building) build().catch(e => console.error('People screener build:', e.message))
    const meta = sp500()
    const g = (a, b) => (a != null && b ? +(((a / b) - 1) * 100).toFixed(1) : null)
    const rows = tickers.map(t => {
      const r = store.rows[t]
      if (!r || r.missing) return null
      const m = meta[t] || {}
      return {
        ...r, name: m.name || t, sector: m.sector || 'Unknown', industry: m.industry || null, mktCap: m.mktCap ?? null, pe: m.pe ?? null, opMargin: m.opMargin ?? null,
        revPerEmp: r.revenue / r.employees,
        opIncPerEmp: r.opInc != null ? r.opInc / r.employees : null,
        netIncPerEmp: r.netInc != null ? r.netInc / r.employees : null,
        mktCapPerEmp: m.mktCap ? m.mktCap / r.employees : null,
        revPerEmpPrev: r.revPrev && r.empPrev ? r.revPrev / r.empPrev : null,
        empGrowth: g(r.employees, r.empPrev), revGrowth: g(r.revenue, r.revPrev),
      }
    }).filter(Boolean)
    return {
      ready: rows.length > 0, building, progress, asOf: store.ts || null, coverage: `${rows.length}/${tickers.length}`, rows,
      source: 'FMP employee-count (10-K headcount, matched to the fiscal year-end) and annual income statements; market cap, sector and industry from the S&P screener feed',
      updated: new Date().toISOString(),
    }
  }
  return { get }
}
