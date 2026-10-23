// ============================================================================
// MAGIC FORMULA — Joel Greenblatt's ranking ("The Little Book That Beats the
// Market") across all U.S. stocks, for the Ideas page (/ideas).
//
//   universe   FMP company-screener: U.S.-domiciled, actively trading, not an
//              ETF or fund, market value ≥ $50M, listed on the NYSE, Nasdaq or
//              NYSE American (OTC names are left out). One request a day.
//   quarters   FMP income-statement, quarterly, the last eight. EBIT is the
//              trailing four quarters of operating income (FMP's own "ebit"
//              adds non-operating items: CAT $4.69B against $4.30B); the four
//              before give its growth.
//   balance    FMP balance-sheet-statement, the latest quarter.
//
// Greenblatt's two measures, each ranked across the universe, the ranks summed
// (lowest sum first):
//   earnings yield     EBIT ÷ enterprise value; EV = market value + debt +
//                      minority interest + preferred − cash and short-term
//                      investments
//   return on capital  EBIT ÷ (net working capital + net PP&E); NWC = current
//                      assets less cash, minus current liabilities less
//                      short-term debt, and a negative NWC counts as zero
// Financials, utilities and REITs are left out (Greenblatt excluded the first
// two; EBIT and capital mean little for any of them), as are companies
// reporting in another currency and those with an operating loss. Share classes
// of one company keep the most traded line. Rankings are computed at four
// market-value floors, since the ranks are relative to who else is in.
//
// Fetching: about 2,500 companies × 2 requests, paced at one request every
// 400 ms (150 a minute, under the plan's 300 with room for the rest of the
// dashboard, which shares the limit), so a cold build takes about 35 minutes
// and runs in the background; a refusal pauses every worker for a minute. The
// page shows partial results with progress meanwhile. After
// that a company is refetched when a new quarter should be out (125 days after
// the last quarter on file ended, checked weekly) or after 45 days regardless.
// Cache: magic-formula.json at the root (gitignored), saved every 100 companies.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, DAY = 24 * H
const GAP = 400, WORKERS = 3
const UNIVERSE_TTL = 20 * H, RETRY = 30 * 60e3
const NEW_QUARTER_DAYS = 125, RECHECK = 7 * DAY, MAX_AGE = 45 * DAY, ERROR_RETRY = 7 * DAY
const STALE_DAYS = 200, DEAD_DAYS = 300 // latest quarter older than this: flagged / left out
const EXCLUDED_SECTORS = ['Financial Services', 'Utilities', 'Real Estate']
// health insurers sit in FMP's Healthcare sector but run on investment portfolios and float, like the financials
const EXCLUDED_INDUSTRIES = ['Medical - Healthcare Plans']
// royalty and mineral trusts are pass-throughs with next to no capital on the books, not operating companies
const isTrust = u => /\btrust\b/i.test(u.name || '') && ['Energy', 'Basic Materials'].includes(u.sector)
// preferreds (CTA-PA), rights and contingent value rights (CELG-RI), warrants (PEW-WT) and units carry the issuer's
// statements in FMP but are not its common stock; class shares (BF-B, MOG-A) stay
const notCommon = sym => /-(P[A-Z]?|R|RI|RT|W|WT|WS|U|UN)$/.test(sym || '')
const BAL_V = 2 // balance-sheet record version: v2 adds the fields behind the fixed-asset fallback and the balance check
const EXCHANGES = ['NASDAQ', 'NYSE', 'AMEX']
export const FLOORS = [
  { id: 'all', label: 'All ($50M+)', min: 50e6 },
  { id: '250m', label: '$250M+', min: 250e6 },
  { id: '1b', label: '$1B+', min: 1e9 },
  { id: '10b', label: '$10B+', min: 10e9 },
]
const TOP = 30, PER_SECTOR = 10, SINCE_TOP = 50

const fin = v => v != null && Number.isFinite(v)
const num = v => (v == null || v === '' ? null : Number.isFinite(+v) ? +v : null)
const rnd = (v, d = 1) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const today = () => new Date().toISOString().slice(0, 10)
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / DAY)
const scrub = s => String(s?.message || s || '').replace(/apikey=[^&\s"]+/gi, 'apikey=…').slice(0, 200)
const pct = (v, d = 0) => `${rnd(v * 100, d)}%`
const money = v => {
  const a = Math.abs(v), s = v < 0 ? '−' : ''
  return a >= 1e12 ? `${s}$${rnd(a / 1e12, 1)}T` : a >= 1e9 ? `${s}$${rnd(a / 1e9, a >= 1e10 ? 0 : 1)}B` : `${s}$${rnd(a / 1e6, 0)}M`
}

export function createMagicFormula({ FMP_KEY, UA, dir }) {
  const CACHE = 'magic-formula.json', file = path.join(dir, CACHE)
  // one fetch loop per process: a dev-server restart builds a new instance, and the old one's loop stops at its next
  // company; the request gate is shared, so overlapping instances still stay under the rate
  const G = (globalThis.__magicFormula ||= { gen: 0, gate: { next: 0 } })
  const gen = ++G.gen, alive = () => G.gen === gen
  const load = () => { try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { console.warn(`${CACHE}: ${e.message}`) } return null }
  const disk = load()
  const store = disk?.version === 1 ? disk : { version: 1, universe: null, rows: {}, since: {}, sinceStart: null }
  // merge with the file first: another instance may have saved companies this one has not seen
  const save = () => {
    try {
      const d = load()
      if (d?.version === 1) {
        for (const [k, v] of Object.entries(d.rows || {})) if (!store.rows[k] || (v.f || 0) > (store.rows[k].f || 0)) store.rows[k] = v
        if (d.universe?.fetched && (!store.universe || d.universe.fetched > store.universe.fetched)) store.universe = d.universe
      }
      fs.writeFileSync(file, JSON.stringify(store))
    } catch (e) { console.error(`${CACHE} save:`, e.message) }
  }
  let building = false, progress = null, lastError = null, nextAt = 0, mem = null, dirty = true, ranked = {}
  // the cached universe, less any industry excluded since it was screened
  const universe = () => (store.universe?.rows || []).filter(u => !EXCLUDED_INDUSTRIES.includes(u.industry) && !isTrust(u) && !notCommon(u.sym))

  async function fmp(q) {
    const at = Math.max(Date.now(), G.gate.next); G.gate.next = at + GAP
    if (at > Date.now()) await sleep(at - Date.now())
    const r = await fetch(`https://financialmodelingprep.com/stable/${q}${q.includes('?') ? '&' : '?'}apikey=${FMP_KEY}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
    if (r.status === 429) throw Object.assign(new Error('FMP rate limit (HTTP 429)'), { rate: true })
    if (!r.ok) throw new Error(`FMP HTTP ${r.status}`)
    const j = await r.json()
    if (j && !Array.isArray(j) && (j['Error Message'] || j.error)) {
      const m = String(j['Error Message'] || j.error)
      throw Object.assign(new Error(`FMP: ${m.slice(0, 120)}`), { rate: /limit/i.test(m) })
    }
    return j
  }

  // ── the universe: one screener call, deduplicated by company ─────────────
  async function screen() {
    const j = await fmp('company-screener?country=US&isEtf=false&isFund=false&isActivelyTrading=true&marketCapMoreThan=50000000&limit=10000')
    if (!Array.isArray(j) || j.length < 1000) throw new Error(`FMP screener returned ${Array.isArray(j) ? j.length : 'no'} rows`)
    const keep = j.filter(s => EXCHANGES.includes(s.exchangeShortName) && !EXCLUDED_SECTORS.includes(s.sector) && !EXCLUDED_INDUSTRIES.includes(s.industry) && !isTrust({ name: s.companyName, sector: s.sector }) && !notCommon(s.symbol) && s.sector && fin(num(s.marketCap)) && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(s.symbol || ''))
    // share classes: one line per company name, the most traded one
    const byName = new Map()
    for (const s of keep) {
      const k = String(s.companyName || s.symbol).toLowerCase().replace(/[^a-z0-9]/g, '')
      const prev = byName.get(k), dv = (num(s.avgVolume) || 0) * (num(s.price) || 0)
      if (!prev || dv > prev.dv) byName.set(k, { dv, s })
    }
    const rows = [...byName.values()].map(({ s }) => ({
      sym: s.symbol, name: s.companyName, sector: s.sector, industry: s.industry || null, ex: s.exchangeShortName,
      mcap: num(s.marketCap), price: num(s.price), vol: num(s.avgVolume) ?? num(s.volume),
    }))
    return { fetched: new Date().toISOString(), screened: j.length, listed: keep.length, rows }
  }

  // ── one company: eight quarters of income, the latest balance sheet ──────
  async function fetchBalance(sym) {
    const bal = await fmp(`balance-sheet-statement?symbol=${encodeURIComponent(sym)}&period=quarter&limit=1`)
    const b0 = Array.isArray(bal) ? bal[0] : null
    return b0 ? {
      v: BAL_V, d: b0.date, cur: b0.reportedCurrency || null, cash: num(b0.cashAndShortTermInvestments), cce: num(b0.cashAndCashEquivalents), sti: num(b0.shortTermInvestments),
      ca: num(b0.totalCurrentAssets), cl: num(b0.totalCurrentLiabilities), std: num(b0.shortTermDebt), ltd: num(b0.longTermDebt), debt: num(b0.totalDebt),
      ppe: num(b0.propertyPlantEquipmentNet), mi: num(b0.minorityInterest), pref: num(b0.preferredStock), eq: num(b0.totalEquity), ta: num(b0.totalAssets),
      tl: num(b0.totalLiabilities), tnca: num(b0.totalNonCurrentAssets), gw: num(b0.goodwill), ia: num(b0.intangibleAssets), lti: num(b0.longTermInvestments), tax: num(b0.taxAssets),
    } : null
  }
  async function fetchOne(sym) {
    const [inc, b] = await Promise.all([fmp(`income-statement?symbol=${encodeURIComponent(sym)}&period=quarter&limit=8`), fetchBalance(sym)])
    const q = (Array.isArray(inc) ? inc : []).filter(x => x.date).sort((a, b) => b.date.localeCompare(a.date)).map(x => ({
      d: x.date, p: x.period || null, fy: x.fiscalYear || null, filed: x.filingDate || null, cur: x.reportedCurrency || null,
      rev: num(x.revenue), oi: num(x.operatingIncome), ebit: num(x.ebit), ni: num(x.netIncome),
    }))
    return { f: Date.now(), q, b }
  }

  // 3 never fetched · 2 an older balance-sheet record with little or no PP&E, which needs the v2 fields (balance sheet alone) · 1 a refresh
  function due(sym, now = Date.now()) {
    const r = store.rows[sym]
    if (!r) return 3
    if (r.err) return now - r.f > (r.retry || ERROR_RETRY) ? 1 : 0
    if (now - r.f > MAX_AGE) return 1
    const last = r.q?.[0]?.d
    if (last && now - r.f > RECHECK && now - Date.parse(last) > NEW_QUARTER_DAYS * DAY) return 1
    if (r.b && r.b.v !== BAL_V && !(r.b.ppe > 0.05 * (r.b.ta || 0))) return 2
    return 0
  }

  async function build() {
    if (building || !FMP_KEY) return
    building = true; lastError = null
    try {
      if (!store.universe || Date.now() - Date.parse(store.universe.fetched) > UNIVERSE_TTL) {
        try { store.universe = await screen(); dirty = true; save() } catch (e) { lastError = `screener: ${scrub(e)}`; if (!store.universe) throw e }
      }
      const uni = universe(), now = Date.now()
      // never fetched first, biggest first, then balance-sheet upgrades, then the ones due a refresh
      const need = uni.map(u => ({ sym: u.sym, p: due(u.sym, now), mcap: u.mcap })).filter(x => x.p > 0).sort((a, b) => b.p - a.p || b.mcap - a.mcap)
      if (!need.length) { nextAt = Date.now() + 6 * H; return }
      progress = { done: 0, total: need.length, started: new Date().toISOString(), errors: 0 }
      console.log(`Magic formula: fetching fundamentals for ${need.length} of ${uni.length} companies`)
      // a refusal (the rest of the dashboard shares the plan's per-minute limit) pauses every worker for a minute;
      // five such pauses with no success between them stop the build for half an hour
      let i = 0, episodes = 0, lastLimit = 0, stop = false
      const worker = async () => {
        while (!stop && alive() && i < need.length) {
          const job = need[i++], sym = job.sym
          try {
            if (job.p === 2) { const b = await fetchBalance(sym); store.rows[sym] = { ...store.rows[sym], b: b || { ...store.rows[sym].b, v: BAL_V } } }
            else store.rows[sym] = await fetchOne(sym)
            episodes = 0; progress.pausedUntil = null
          } catch (e) {
            if (e.rate) {
              need.push(job) // back of the queue
              if (Date.now() - lastLimit > 60_000) { episodes++; lastLimit = Date.now() }
              if (episodes >= 5) { stop = true; lastError = 'FMP kept refusing requests for five minutes (the plan\'s per-minute limit); resuming in 30 minutes'; break }
              G.gate.next = Math.max(G.gate.next, Date.now() + 65_000)
              progress.pausedUntil = G.gate.next
              continue
            }
            // a refusal by status (402 premium, 404) waits a week; a timeout or server error retries within the hour.
            // A failed balance-sheet upgrade keeps the record it has and tries again next build.
            if (job.p !== 2) store.rows[sym] = { f: Date.now(), err: scrub(e), retry: /HTTP 4\d\d/.test(e.message) ? ERROR_RETRY : H }
            progress.errors++
          }
          progress.done++; dirty = true
          if (progress.done % 100 === 0) save()
        }
      }
      await Promise.all(Array.from({ length: WORKERS }, worker))
      save()
      if (!alive()) return // superseded by a restart; the new instance carries on
      nextAt = Date.now() + (stop ? RETRY : 6 * H)
      console.log(`Magic formula: ${progress.done}/${progress.total} fetched${progress.errors ? `, ${progress.errors} failed` : ''}${stop ? ' — paused on rate limits' : ''}`)
    } catch (e) {
      lastError = scrub(e); nextAt = Date.now() + RETRY
      console.warn('Magic formula:', lastError)
    } finally { building = false; progress = null; dirty = true }
  }

  // ── the measures for one company ─────────────────────────────────────────
  // a skip carries a category (counted on the page) and the detail (shown on lookup)
  function measure(u) {
    const r = store.rows[u.sym]
    if (!r) return { skip: 'not fetched yet', detail: 'its fundamentals have not been fetched yet' }
    if (r.err) return { skip: 'fetch failed', detail: `the last fetch failed (${r.err})` }
    const q = r.q || [], b = r.b
    if (q.length < 4 || !b) return { skip: 'fewer than four quarters', detail: 'fewer than four quarters are on file' }
    if (q[0].cur && q[0].cur !== 'USD') return { skip: 'reports in another currency', detail: `it reports in ${q[0].cur}` }
    const age = daysBetween(q[0].d, today())
    if (age > DEAD_DAYS) return { skip: 'no quarter in ten months', detail: `its latest quarter on file ended ${q[0].d}` }
    if (daysBetween(q[3].d, q[0].d) > 300 || q.slice(0, 4).some(x => !fin(x.oi))) return { skip: 'gap in the last four quarters', detail: 'the last four quarters have a gap' }
    const q4 = q.slice(0, 4), label = x => (x.p && x.fy ? `${x.p} FY${x.fy}` : x.d)
    const ebit = q4.reduce((s, x) => s + x.oi, 0)
    const rev = q4.every(x => fin(x.rev)) ? q4.reduce((s, x) => s + x.rev, 0) : null
    const prior = q.length >= 8 && daysBetween(q[7].d, q[4].d) <= 300 && daysBetween(q[4].d, q[3].d) <= 100 && q.slice(4, 8).every(x => fin(x.oi)) ? q.slice(4, 8).reduce((s, x) => s + x.oi, 0) : null
    const cash = fin(b.cash) && b.cash > 0 ? b.cash : (b.cce || 0) + (b.sti || 0)
    // FMP records that cannot be right (cash above total assets, a balance sheet a thousandth of the real one,
    // liabilities and equity missing) are left out rather than ranked: each would land at the top of a list
    const ta = b.ta || 0
    if (!(ta > 0)) return { skip: 'data error', detail: 'its balance sheet in the data shows no total assets' }
    if (cash > ta) return { skip: 'data error', detail: 'its reported cash exceeds its total assets, a data error' }
    if (b.v === BAL_V && fin(b.tl) ? Math.abs(b.tl + (b.eq || 0) - ta) > 0.1 * ta : !b.eq && !b.cl) return { skip: 'data error', detail: 'its balance sheet in the data is missing liabilities or equity' }
    if ((fin(rev) && rev > 0 && ta < 0.05 * rev) || ta < 0.002 * u.mcap) return { skip: 'data error', detail: 'its balance sheet is too small to measure capital against (a data error, or a pass-through such as a royalty trust)' }
    const debt = (b.std || 0) + (b.ltd || 0) || b.debt || 0
    const ev = u.mcap + debt + (b.mi || 0) + (b.pref || 0) - cash
    if (ebit > 0 && ev > 0 && ebit > ev) return { skip: 'profit above the whole price', detail: 'its operating profit over four quarters exceeds the price of the whole business, which is almost always a one-off gain or a data error' }
    // one quarter carrying the year: seasonal when the same quarter a year earlier did too (tax preparers, ski resorts,
    // holiday retail), otherwise a one-off gain (a sale, a settlement, a licensing payment)
    const top = q4.reduce((a, x) => (x.oi > a.oi ? x : a), q4[0]), same = q[q4.indexOf(top) + 4]
    const seasonal = !!same && fin(same.oi) && same.oi > 0.5 * top.oi && fin(prior) && prior > 0
    if (ebit > 0 && top.oi > ebit && !seasonal) return { skip: 'one-off quarter', detail: `${label(top)} alone earned more than the whole year and the other quarters lost money, the mark of a one-off gain (a sale, a settlement, a licensing payment)` }
    const classified = fin(b.ca) && b.ca > 0 && fin(b.cl) && b.cl > 0
    const nwc = classified ? (b.ca - cash) - (b.cl - (b.std || 0)) : 0
    // PP&E missing from the data (oil and gas properties, railroads and homebuilders' land often sit in another line):
    // with none, or under 5% of assets while tangible long-term assets are over half, use those tangible long-term
    // assets (everything but cash and intangibles when the balance sheet isn't split current/long-term)
    const base = classified ? (fin(b.tnca) && b.tnca > 0 ? b.tnca : ta - b.ca) : ta - cash
    const tangible = base - (b.gw || 0) - (b.ia || 0) - (b.lti || 0) - (b.tax || 0)
    const ppeProxy = tangible > 0 && (!(b.ppe > 0) || (b.ppe < 0.05 * ta && tangible > 0.5 * ta))
    const fixed = ppeProxy ? tangible : b.ppe > 0 ? b.ppe : 0
    const capital = Math.max(nwc, 0) + fixed
    return {
      ebit, rev, prior, ev, cash, debt, nwc, capital, classified, ppeProxy, age,
      ey: ev > 0 ? ebit / ev : null, roc: capital > 0 ? ebit / capital : null,
      growth: fin(prior) && prior > 0 ? ebit / prior - 1 : null,
      topQ: { oi: top.oi, label: label(top), seasonal },
      quarter: { end: q[0].d, label: label(q[0]), filed: q[0].filed },
    }
  }

  // ── the plain-English case for one name ──────────────────────────────────
  function words(u, m) {
    const flags = []
    if (m.ev <= 0) flags.push({ id: 'negEV', kind: 'check', text: 'Cash on hand exceeds the market value plus debt, so the earnings yield is off the scale. Payment and brokerage firms can carry customer money as cash: check the balance sheet before trusting it' })
    if (m.capital <= 0) flags.push({ id: 'noCapital', kind: 'note', text: 'Uses almost no tangible capital (no plant, negative working capital), so its return on capital is off the scale' })
    if (fin(m.ey) && m.ey > 0.5) flags.push({ id: 'hugeEY', kind: 'check', text: `An earnings yield of ${pct(m.ey)} is rarely real: check for a one-off gain or a data error` })
    if (m.ebit > 0 && m.topQ.oi > 0.6 * m.ebit) flags.push(m.topQ.seasonal
      ? { id: 'seasonal', kind: 'note', text: `Seasonal: ${m.topQ.label} supplied ${pct(m.topQ.oi / m.ebit)} of the year's operating profit, as the same quarter did a year earlier` }
      : { id: 'oneQuarter', kind: 'check', text: `${m.topQ.label} supplied ${pct(m.topQ.oi / m.ebit)} of the year's operating profit: check whether it repeats` })
    if (m.ppeProxy) flags.push({ id: 'ppeProxy', kind: 'note', text: 'The data does not break out plant and equipment, so capital counts all its tangible long-term assets' })
    if (fin(m.growth) && m.growth > 1.5) flags.push({ id: 'spike', kind: 'check', text: `Operating profit is up ${pct(m.growth)} in a year, which can mark a cyclical or one-off peak` })
    if (fin(m.growth) && m.growth < -0.25) flags.push({ id: 'falling', kind: 'risk', text: `Operating profit fell ${pct(-m.growth)} over the past year: the cheap price may be the market expecting more decline` })
    if (m.debt > 4 * m.ebit && m.debt > m.cash) flags.push({ id: 'debt', kind: 'risk', text: `Debt of ${money(m.debt)} is ${rnd(m.debt / m.ebit, 1)}× a year's operating profit` })
    if (u.mcap < 250e6) flags.push({ id: 'micro', kind: 'note', text: 'Micro-cap: thin trading and wide spreads, so use limit orders' })
    const dv = (u.vol || 0) * (u.price || 0)
    if (dv > 0 && dv < 1e6) flags.push({ id: 'illiquid', kind: 'note', text: `Trades about ${money(dv)} a day` })
    if (fin(u.price) && u.price < 5) flags.push({ id: 'penny', kind: 'note', text: `Shares trade under $5 ($${rnd(u.price, 2)})` })
    if (m.age > STALE_DAYS) flags.push({ id: 'stale', kind: 'check', text: `Latest quarter on file ended ${m.quarter.end}, ${m.age} days ago: a filing may be late` })
    if (!m.classified) flags.push({ id: 'unclassified', kind: 'note', text: 'No current assets or liabilities reported, so working capital counts as zero' })

    const eyTxt = m.ev > 0 ? `For every $100 paid for the whole business (its shares plus net debt) it earns $${rnd(m.ey * 100, 0)} a year in operating profit` : 'Its cash exceeds what the whole business costs, and it still earns an operating profit'
    const rocTxt = m.capital > 0 && m.roc <= 10 ? `, and it earns $${rnd(m.roc * 100, 0)} a year on every $100 of plant and working capital it uses.` : ', and it needs almost no plant or working capital to do it (a return on capital above 1,000%).'
    const parts = [`${eyTxt}${rocTxt}`]
    if (fin(m.growth) && m.growth >= 0.05 && m.growth <= 1.5) parts.push(`Operating profit grew ${pct(m.growth)} over the past year.`)
    else if (fin(m.growth) && Math.abs(m.growth) < 0.05) parts.push('Operating profit was flat over the past year.')
    else if (fin(m.growth) && m.growth >= -0.25 && m.growth < 0) parts.push(`Operating profit slipped ${pct(-m.growth)} over the past year.`)
    const net = m.cash - m.debt
    if (net > 0.15 * u.mcap) parts.push(`Net cash of ${money(net)} covers ${pct(net / u.mcap)} of the market value.`)
    const change = ['Greenblatt\'s rule is to hold about a year, then replace it with whatever ranks at the top then.']
    if (flags.some(f => f.id === 'oneQuarter' || f.id === 'spike' || f.id === 'hugeEY')) change.push('Sooner if the next quarter shows the profit jump was a one-off.')
    else change.push('Revisit sooner if a weak quarter drops it out of the top 100.')
    if (flags.some(f => f.id === 'falling')) change.push('A second year of falling profit would undercut the case.')
    return { why: parts.join(' '), change: change.join(' '), flags }
  }

  // no enterprise value left after cash, or no tangible capital: the measure is off the scale and ranks first
  const eyKey = x => (x.m.ev <= 0 ? 1e9 : x.m.ey), rocKey = x => (x.m.capital <= 0 ? 1e9 : x.m.roc)
  function rankSet(rows) {
    const n = rows.length
    const rEY = new Map([...rows].sort((a, b) => eyKey(b) - eyKey(a)).map((x, i) => [x.u.sym, i + 1]))
    const rROC = new Map([...rows].sort((a, b) => rocKey(b) - rocKey(a)).map((x, i) => [x.u.sym, i + 1]))
    return rows.map(x => ({ sym: x.u.sym, sector: x.u.sector, ey: rEY.get(x.u.sym), roc: rROC.get(x.u.sym), sum: rEY.get(x.u.sym) + rROC.get(x.u.sym), eyv: eyKey(x) }))
      .sort((a, b) => a.sum - b.sum || b.eyv - a.eyv).map((x, i) => ({ ...x, rank: i + 1, n }))
  }

  function derive() {
    const uni = universe()
    const skipped = {}, eligible = []
    for (const u of uni) {
      const m = measure(u)
      if (m.skip) { skipped[m.skip] = (skipped[m.skip] || 0) + 1; continue }
      if (!(m.ebit > 0)) { skipped['operating loss'] = (skipped['operating loss'] || 0) + 1; continue }
      eligible.push({ u, m })
    }
    const by = new Map(eligible.map(x => [x.u.sym, x]))
    const sectors = [...new Set(uni.map(u => u.sector))].filter(s => !EXCLUDED_SECTORS.includes(s)).sort()
    const keep = new Set(), floors = []
    ranked = {}
    for (const f of FLOORS) {
      const list = rankSet(eligible.filter(x => x.u.mcap >= f.min))
      ranked[f.id] = new Map(list.map(x => [x.sym, x]))
      const top = list.slice(0, TOP).map(x => x.sym)
      const bySector = Object.fromEntries(sectors.map(s => [s, list.filter(x => x.sector === s).slice(0, PER_SECTOR).map(x => x.sym)]))
      top.forEach(s => keep.add(s)); Object.values(bySector).flat().forEach(s => keep.add(s))
      floors.push({ ...f, n: list.length, top, sectors: bySector, sectorCounts: Object.fromEntries(sectors.map(s => [s, list.filter(x => x.sector === s).length])) })
    }
    const fetched = uni.filter(u => store.rows[u.sym] && !store.rows[u.sym].err).length
    const complete = uni.length > 0 && fetched >= uni.length * 0.95 && !building
    // first date each name entered a floor's top 50, tracked once the universe is fully fetched
    if (complete) {
      const d = today(); let changed = false
      if (!store.sinceStart) { store.sinceStart = d; changed = true }
      for (const f of FLOORS) {
        const cur = new Set([...ranked[f.id].values()].filter(x => x.rank <= SINCE_TOP).map(x => x.sym)), map = store.since[f.id] || (store.since[f.id] = {})
        for (const s of cur) if (!map[s]) { map[s] = d; changed = true }
        for (const s of Object.keys(map)) if (!cur.has(s)) { delete map[s]; changed = true }
      }
      if (changed) save()
    }
    const names = {}
    for (const sym of keep) {
      const { u, m } = by.get(sym), w = words(u, m)
      names[sym] = {
        sym, name: u.name, sector: u.sector, industry: u.industry, exchange: u.ex, mcap: u.mcap, price: u.price,
        ey: rnd(m.ey, 4), roc: rnd(m.roc, 4), ebit: m.ebit, ev: m.ev, capital: m.capital, growth: rnd(m.growth, 4), netCash: m.cash - m.debt, quarter: m.quarter,
        why: w.why, change: w.change, flags: w.flags, horizon: 'About 12 months',
        rank: Object.fromEntries(FLOORS.map(f => { const r = ranked[f.id].get(sym); return [f.id, r ? { rank: r.rank, n: r.n, ey: r.ey, roc: r.roc } : null] })),
        since: Object.fromEntries(FLOORS.map(f => [f.id, store.since[f.id]?.[sym] || null])),
      }
    }
    return {
      built: new Date().toISOString(), asOf: store.universe?.fetched || null,
      universe: { screened: store.universe?.screened ?? null, listed: store.universe?.listed ?? null, companies: uni.length, fetched, ranked: eligible.length, skipped },
      complete, building, progress, error: lastError, sinceStart: store.sinceStart, floors, names, sectors,
      method: 'Joel Greenblatt\'s Magic Formula: rank every company on earnings yield (EBIT ÷ enterprise value) and on return on capital (EBIT ÷ net working capital plus net plant), add the two ranks, and buy from the top. EBIT is the last four quarters of operating income. Financials, utilities, REITs and health insurers are excluded, as are loss-makers and foreign-currency reporters; share classes are merged. Data records that cannot be right (cash above total assets, a balance sheet a thousandth the size of the business, a year\'s profit above the price of the whole company) are left out rather than ranked. Greenblatt\'s discipline: buy 20 to 30 of the top names a few at a time over a year, hold each about a year, repeat.',
      source: 'FMP company screener (daily) and quarterly income statements and balance sheets',
    }
  }

  function kick() {
    if (!building && alive() && Date.now() >= nextAt && FMP_KEY) build().catch(e => console.warn('Magic formula build:', scrub(e)))
  }

  function get() {
    kick()
    if (!mem || dirty) { mem = derive(); dirty = false }
    return { ...mem, building, progress: progress && { ...progress }, error: lastError }
  }

  // where any listed company stands, including ones outside the top lists
  function lookup(symbol) {
    const sym = String(symbol || '').trim().toUpperCase()
    if (!mem || dirty) get()
    const u = universe().find(x => x.sym === sym)
    if (!u) return { sym, found: false, reason: 'Not in the universe: not a U.S.-listed operating company over $50M, or a financial, utility, REIT or health insurer, or a second share class.' }
    const m = measure(u)
    if (m.skip) return { sym, name: u.name, found: false, reason: `Not ranked: ${m.detail}.` }
    if (!(m.ebit > 0)) return { sym, name: u.name, found: false, reason: `Not ranked: operating loss of ${money(m.ebit)} over the last four quarters.` }
    const w = words(u, m)
    return {
      sym, name: u.name, found: true, sector: u.sector, mcap: u.mcap, ey: rnd(m.ey, 4), roc: rnd(m.roc, 4), growth: rnd(m.growth, 4), quarter: m.quarter,
      why: w.why, flags: w.flags,
      rank: Object.fromEntries(FLOORS.map(f => { const r = ranked[f.id]?.get(sym); return [f.id, r ? { rank: r.rank, n: r.n, ey: r.ey, roc: r.roc } : null] })),
    }
  }

  return { get, lookup }
}
