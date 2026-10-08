// ============================================================================
// SIN MONITOR SEED: Stocks → Sin & Folly, built from free SEC sources.
//  1. The accounting posture of the 500 largest non-financial SEC filers by
//     revenue, each calendar year since 2010, from the XBRL frames API (one
//     call returns every filer's value for one tag and period).
//  2. The league table: those 500 ranked on accruals, Beneish, Montier and
//     useful-life lengthening, on each company's latest fiscal year.
//  3. Counts per quarter since 2001 of the filings companies make when the
//     books go wrong (EDGAR full-text search), for all filers and for the 500.
//  4. Folly: 8-Ks per quarter that mention blockchain, the metaverse,
//     artificial intelligence or a crypto treasury, and SPAC registrations.
// The formulas are src/lib/accountingQuality.js. A full build is about 4,400
// SEC requests, ~15 minutes inside the ten-a-second limit:
//   node scripts/refresh-seeds.mjs sin
// server/sinMonitor.js re-runs the recent years in the background.
//
// On the data:
//  - Frames put each fiscal year in the calendar year it mostly covers
//    (Walmart's year to January 2024 is CY2023, Apple's to September 2023 is
//    CY2023). Balances are matched to each company's own year-end date from
//    the quarterly instant frames.
//  - Frames carry the latest figure filed for a period, so a restatement
//    replaces the original numbers.
//  - Tags vary by filer, so each line tries several. Revenue takes the largest
//    of its tags; depreciation and PP&E prefer the tag a company uses most, so
//    a year-on-year change is rarely a change of tag.
//  - The universe is 10-K filers, so foreign companies filing 20-Fs (which
//    tag dollar convenience translations) stay out, as they do from the S&P.
//    Financials (SIC 6000–6999: banks, insurers, brokers, REITs) are left out,
//    as Beneish left them out. Both come from EDGAR's company record.
//  - A few filers tag figures in the wrong units (one small company reported
//    $30 trillion of revenue, another $1.2 trillion of net income), so revenue
//    above $1.2 trillion, or a one-year spike of eight times the years either
//    side, is dropped, and any other line larger than three times the
//    company's revenue and assets is treated as unreported.
//  - The aggregate keeps every filer in the 500, listed or not (debt-only
//    filers and companies since acquired), so the history has no survivorship
//    bias; the league table shows only companies with listed shares today.
//  - Full-text counts are documents, not filings: an exhibit that repeats the
//    phrase counts again. That is consistent over time, so fine for a trend.
// ============================================================================
import { assess, pctRank, quantile, M_CUT, C_ZONE } from '../src/lib/accountingQuality.js'

export const SEED_NAME = 'sin-monitor.json'
const FIRST = 2009          // first frame year fetched; 2010 is the first scored
const SCORED = 2010
const UNIVERSE = 500, CANDIDATES = 900

// row field → XBRL tags in priority order (durations by calendar year)
const DUR = {
  rev: ['Revenues', 'RevenueFromContractWithCustomerExcludingAssessedTax', 'RevenueFromContractWithCustomerIncludingAssessedTax', 'SalesRevenueNet', 'SalesRevenueGoodsNet'],
  cogs: ['CostOfRevenue', 'CostOfGoodsAndServicesSold', 'CostOfGoodsSold', 'CostOfGoodsAndServiceExcludingDepreciationDepletionAndAmortization'],
  sga: ['SellingGeneralAndAdministrativeExpense'],
  ni: ['IncomeLossFromContinuingOperations', 'NetIncomeLoss', 'ProfitLoss'],
  cfo: ['NetCashProvidedByUsedInOperatingActivities', 'NetCashProvidedByUsedInOperatingActivitiesContinuingOperations'],
  dep: ['Depreciation', 'DepreciationDepletionAndAmortization', 'DepreciationAndAmortization'],
  sbc: ['ShareBasedCompensation', 'AllocatedShareBasedCompensationExpense'],
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment'],
}
// balances, from the quarterly instant frames
const INST = {
  rec: ['AccountsReceivableNetCurrent', 'ReceivablesNetCurrent'],
  inv: ['InventoryNet'],
  ca: ['AssetsCurrent'],
  cash: ['CashAndCashEquivalentsAtCarryingValue', 'CashCashEquivalentsRestrictedCashAndRestrictedCashEquivalents'],
  sti: ['ShortTermInvestments', 'MarketableSecuritiesCurrent', 'AvailableForSaleSecuritiesDebtSecuritiesCurrent'],
  ppe: ['PropertyPlantAndEquipmentNet', 'PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetAfterAccumulatedDepreciationAndAmortization'],
  ppeGross: ['PropertyPlantAndEquipmentGross', 'PropertyPlantAndEquipmentAndFinanceLeaseRightOfUseAssetBeforeAccumulatedDepreciationAndAmortization'],
  ta: ['Assets'],
  cl: ['LiabilitiesCurrent'],
  ltd: ['LongTermDebtNoncurrent', 'LongTermDebtAndCapitalLeaseObligations'],
  gw: ['Goodwill'],
}
const STICKY = new Set(['dep', 'ppe', 'ppeGross'])

// [key, label, full-text query, forms, first quarter the query means anything]
// Item 4.02 (non-reliance) arrived with the August 2004 8-K overhaul; the
// auditor-change caption is older Item 4's, so that series runs from 2001.
export const EVENTS = [
  ['restatement', 'Restatements (8-K non-reliance)', '"Non-Reliance on Previously Issued Financial Statements"', '8-K', '2004Q3'],
  ['auditor', 'Auditor changes (8-K)', '"Changes in Registrant\'s Certifying Accountant"', '8-K'],
  ['late10k', 'Late 10-Ks (NT 10-K notices)', 'a', 'NT 10-K'],
  ['weakness', 'Material weakness: controls "was not effective" (10-K)', '"material weakness" "was not effective"', '10-K'],
  ['goingConcern', 'Going-concern doubt (10-K)', '"substantial doubt" "going concern"', '10-K'],
  ['preferability', 'Preferability letters: voluntary accounting changes', '"preferable in the circumstances"', '10-K,10-Q'],
]
export const BIG_EVENTS = ['restatement', 'auditor', 'late10k', 'weakness']
export const FOLLY = [
  ['blockchain', 'Blockchain', '"blockchain"', '8-K'],
  ['metaverse', 'Metaverse', '"metaverse"', '8-K'],
  ['ai', 'Artificial intelligence', '"artificial intelligence"', '8-K'],
  ['treasury', 'Crypto treasury', '"digital asset treasury" OR "bitcoin treasury" OR "crypto treasury"', '8-K'],
  ['spac', 'SPAC registrations (S-1 "blank check company")', '"blank check company"', 'S-1'],
]

const sleep = ms => new Promise(r => setTimeout(r, ms))
const fin = v => v != null && Number.isFinite(v)
const pad = cik => String(cik).padStart(10, '0')
const day = s => Date.parse(`${s}T00:00:00Z`) / 864e5
const r4 = v => (fin(v) ? Math.round(v * 1e4) / 1e4 : null)
const median = a => { const s = a.filter(fin).sort((x, y) => x - y); return s.length ? quantile(s, 0.5) : null }

async function pmap(items, n, fn) {
  const out = new Array(items.length); let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k], k) } }))
  return out
}

// one request slot every 125 ms across all SEC hosts (their limit is ten a
// second); 5xx, 429 and timeouts are retried with a growing pause; 404 = no data
function secClient(UA, log) {
  let next = 0, calls = 0
  async function get(url, as = 'json') {
    for (let a = 0; ; a++) {
      const slot = Math.max(Date.now(), next); next = slot + 125
      if (slot > Date.now()) await sleep(slot - Date.now())
      let r
      try { r = await fetch(url, { headers: { 'User-Agent': UA, Accept: as === 'json' ? 'application/json' : '*/*' }, signal: AbortSignal.timeout(90_000) }) }
      catch (e) { if (a < 3) { await sleep(2000 * (a + 1)); continue } throw new Error(`${e.message} ${url.slice(0, 140)}`) }
      if (++calls % 250 === 0) log?.(`  … ${calls} SEC requests`)
      if (r.ok) return as === 'json' ? r.json() : r.text()
      if (r.status === 404) return null
      if ((r.status >= 500 || r.status === 429) && a < 4) { await sleep(2500 * (a + 1)); continue }
      throw new Error(`SEC HTTP ${r.status} ${url.slice(0, 140)}`)
    }
  }
  get.count = () => calls
  return get
}

// quarters from "2001Q1" through the one containing `to`
function quarters(from, to) {
  const [fy, fq] = from.split('Q').map(Number), ty = to.getUTCFullYear(), tq = Math.floor(to.getUTCMonth() / 3) + 1
  const out = []
  for (let y = fy, q = fq; y < ty || (y === ty && q <= tq); q === 4 ? (y++, q = 1) : q++) {
    const m0 = (q - 1) * 3 + 1, last = new Date(Date.UTC(y, m0 + 2, 0)).getUTCDate()
    out.push({ label: `${y}Q${q}`, y, start: `${y}-${String(m0).padStart(2, '0')}-01`, end: `${y}-${String(m0 + 2).padStart(2, '0')}-${last}` })
  }
  return out
}

export async function buildSinMonitor({ UA, prev = null, recentOnly = false, log = console.log } = {}) {
  const get = secClient(UA, log)
  const now = new Date(), thisYear = now.getUTCFullYear()
  const first = recentOnly && prev ? thisYear - 4 : FIRST
  const years = Array.from({ length: thisYear - first + 1 }, (_, i) => first + i)
  const frame = (tag, per) => get(`https://data.sec.gov/api/xbrl/frames/us-gaap/${tag}/USD/${per}.json`)

  // ── 1. revenue for every filer, every year ──
  log(`sin monitor: revenue frames ${first}–${thisYear}`)
  const rev = new Map(), names = new Map()
  const revJobs = years.flatMap(y => DUR.rev.map(tag => [tag, y]))
  const revFrames = await pmap(revJobs, 6, ([tag, y]) => frame(tag, `CY${y}`))
  revJobs.forEach(([, y], k) => {
    for (const d of revFrames[k]?.data || []) {
      if (!(d.val > 0) || d.val > 1.2e12) continue
      let m = rev.get(d.cik); if (!m) rev.set(d.cik, m = new Map())
      const cur = m.get(y)
      if (!cur || d.val > cur.val) m.set(y, { val: d.val, end: d.end })
      if (!names.has(d.cik) || y >= (names.get(d.cik).y ?? 0)) names.set(d.cik, { n: d.entityName, y })
    }
  })
  // a one-year spike of eight times the years either side is a unit error, not
  // growth (Nvidia's best year was 2.3×)
  for (const m of rev.values()) {
    const ys = [...m.keys()].sort((a, b) => a - b)
    const bad = ys.filter((y, i) => {
      const v = m.get(y).val, a = m.get(ys[i - 1])?.val, b = m.get(ys[i + 1])?.val
      return (a != null || b != null) && (a == null || v > 8 * a) && (b == null || v > 8 * b)
    })
    for (const y of bad) m.delete(y)
  }
  const filers = Object.fromEntries(years.map(y => [y, [...rev.values()].filter(m => m.has(y)).length]))
  // a calendar year is complete once its filer count reaches 85% of the year before
  const complete = y => y === first || filers[y] >= 0.85 * (filers[y - 1] || 0)
  const latest = Math.max(...years.filter(complete))

  // ── 2. the largest filers' EDGAR records: SIC code, and whether they file 10-Ks ──
  const cands = new Set()
  for (const y of years) [...rev].filter(([, m]) => m.has(y)).sort((a, b) => b[1].get(y).val - a[1].get(y).val).slice(0, CANDIDATES).forEach(([c]) => cands.add(c))
  const sic = { ...(prev?.sic || {}) }
  const need = [...cands].filter(c => !(c in sic) || sic[c].length < 3)
  log(`sin monitor: EDGAR records for ${need.length} companies`)
  const record = async cik => {
    const t = await get(`https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${pad(cik)}&type=10-K&dateb=&owner=include&count=10&output=atom`, 'text').catch(() => null)
    if (!t) return
    const code = /<assigned-sic>(\d+)<\/assigned-sic>/.exec(t)?.[1]
    let desc = /<assigned-sic-desc>([^<]*)<\/assigned-sic-desc>/.exec(t)?.[1] || ''
    while (desc.includes('&amp;')) desc = desc.replace(/&amp;/g, '&')
    // [SIC, description, files 10-Ks]: the feed lists 10-K filings, so none means a 20-F/40-F filer
    sic[cik] = [code ? +code : null, desc, /<entry>/.test(t)]
  }
  await pmap(need, 4, record)
  // one more pass for any that failed (EDGAR's full-text and record hosts drop the odd request)
  await pmap(need.filter(c => !sic[c]), 2, record)
  const missing = need.filter(c => !sic[c])
  if (missing.length) log(`  ${missing.length} EDGAR records failed; left out of the universe: ${missing.join(', ')}`)
  const isFin = c => { const s = sic[c]?.[0]; return s >= 6000 && s <= 6999 }
  const tenK = c => sic[c]?.[2] === true

  // ── 3. the universe: the 500 largest non-financial 10-K filers by revenue, each year ──
  const U = {}
  for (const y of years) U[y] = [...rev].filter(([c, m]) => m.has(y) && cands.has(c) && tenK(c) && !isFin(c)).sort((a, b) => b[1].get(y).val - a[1].get(y).val).slice(0, UNIVERSE).map(([c]) => c)
  const K = new Set(Object.values(U).flat())

  // ── 4. every other line, kept only for the companies that matter ──
  const dur = {}, inst = {}
  const durJobs = Object.entries(DUR).filter(([f]) => f !== 'rev').flatMap(([f, tags]) => tags.flatMap(tag => years.map(y => [f, tag, y])))
  log(`sin monitor: ${durJobs.length} duration frames`)
  await pmap(durJobs, 6, async ([f, tag, y]) => {
    const j = await frame(tag, `CY${y}`)
    const byTag = (dur[f] ??= {})[tag] ??= new Map()
    for (const d of j?.data || []) {
      if (!K.has(d.cik) || !fin(d.val)) continue
      let m = byTag.get(d.cik); if (!m) byTag.set(d.cik, m = new Map())
      m.set(y, { val: d.val, end: d.end })
    }
  })
  const qs = quarters(`${first}Q1`, now).filter(q => day(q.end) < day(now.toISOString().slice(0, 10)))
  const instJobs = Object.entries(INST).flatMap(([f, tags]) => tags.flatMap(tag => qs.map(q => [f, tag, q.label])))
  log(`sin monitor: ${instJobs.length} instant frames`)
  await pmap(instJobs, 6, async ([f, tag, label]) => {
    const j = await frame(tag, `CY${label}I`)
    const byTag = (inst[f] ??= {})[tag] ??= new Map()
    for (const d of j?.data || []) {
      if (!K.has(d.cik) || !fin(d.val)) continue
      let m = byTag.get(d.cik); if (!m) byTag.set(d.cik, m = new Map())
      m.set(d.end, d.val)
    }
  })

  // ── 5. normalised rows and scores per company ──
  const tagOrder = (src, f, cik) => {
    const tags = (src === dur ? DUR : INST)[f]
    if (!STICKY.has(f)) return tags
    const n = tag => src[f]?.[tag]?.get(cik)?.size || 0
    return [...tags].sort((a, b) => n(b) - n(a) || tags.indexOf(a) - tags.indexOf(b))
  }
  const near = (m, end) => {
    if (!m) return null
    if (m.has(end)) return m.get(end)
    const e = day(end); let best = null, gap = 11
    for (const [d, v] of m) { const g = Math.abs(day(d) - e); if (g < gap) { gap = g; best = v } }
    return best
  }
  // any line over three times the larger of revenue and assets is a unit error
  const LINES = ['cogs', 'sga', 'ni', 'cfo', 'dep', 'sbc', 'capex', 'rec', 'inv', 'ca', 'cash', 'ppe', 'ppeGross', 'cl', 'ltd', 'gw']
  const sane = r => { const cap = 3 * Math.max(r.rev || 0, r.ta || 0); for (const k of LINES) if (fin(r[k]) && Math.abs(r[k]) > cap) r[k] = null; return r }
  const scored = new Map()
  for (const cik of K) {
    const m = rev.get(cik), order = {}
    const D = (f, y, end) => { for (const tag of (order[`d${f}`] ??= tagOrder(dur, f, cik))) { const v = dur[f]?.[tag]?.get(cik)?.get(y); if (v && Math.abs(day(v.end) - day(end)) <= 15) return v.val } return null }
    const I = (f, end) => { for (const tag of (order[`i${f}`] ??= tagOrder(inst, f, cik))) { const v = near(inst[f]?.[tag]?.get(cik), end); if (fin(v)) return v } return null }
    const rows = [...m.keys()].sort((a, b) => a - b).map(y => {
      const { val, end } = m.get(y), cash = I('cash', end), sti = I('sti', end)
      return sane({
        cik, y, end, rev: val, cogs: D('cogs', y, end), sga: D('sga', y, end), ni: D('ni', y, end), cfo: D('cfo', y, end),
        dep: D('dep', y, end), sbc: D('sbc', y, end), capex: D('capex', y, end),
        rec: I('rec', end), inv: I('inv', end), ca: I('ca', end), cash: fin(cash) ? cash + (sti ?? 0) : null,
        ppe: I('ppe', end), ppeGross: I('ppeGross', end), ta: I('ta', end), cl: I('cl', end), ltd: I('ltd', end), gw: I('gw', end),
      })
    })
    scored.set(cik, new Map(assess(rows).map(r => [r.y, r])))
  }

  // ── 6. the aggregate, year by year ──
  const sum = (rows, f) => rows.reduce((s, r) => s + f(r), 0)
  const agg = { ...(recentOnly ? prev?.agg || {} : {}) }
  for (const y of years.filter(y => y >= Math.max(SCORED, first + 1))) {
    const rows = U[y].map(c => scored.get(c)?.get(y)).filter(Boolean)
    const has = (...fs) => rows.filter(r => fs.every(f => fin(r[f])))
    const acc = rows.filter(r => fin(r.accruals))
    const avgTa = r => { const p = scored.get(r.cik)?.get(y - 1); return fin(p?.ta) ? (r.ta + p.ta) / 2 : r.ta }
    const accW = has('ni', 'cfo', 'ta')
    const ms = rows.map(r => r.beneish?.m).filter(fin)
    const cs = rows.filter(r => r.montier && r.montier.testable >= 5)
    const life = rows.filter(r => fin(r.life))
    const sbc = has('sbc', 'rev'), dso = has('rec', 'rev'), dio = rows.filter(r => r.inv > 0 && r.cogs > 0), gw = has('gw', 'ta')
    agg[y] = {
      n: rows.length, partial: !complete(y),
      accruals: { med: r4(median(acc.map(r => r.accruals))), wtd: r4(sum(accW, r => r.ni - r.cfo) / sum(accW, r => avgTa(r))), n: acc.length },
      m: { med: r4(median(ms)), share: r4(ms.filter(v => v > M_CUT).length / (ms.length || 1)), n: ms.length },
      c: { mean: r4(sum(cs, r => r.montier.score) / (cs.length || 1)), share: r4(cs.filter(r => r.montier.score >= C_ZONE).length / (cs.length || 1)), n: cs.length },
      life: { agg: r4(sum(life, r => r.ppeGross) / sum(life, r => r.dep)), med: r4(median(life.map(r => r.life))), n: life.length },
      sbc: { agg: r4(sum(sbc, r => r.sbc) / sum(sbc, r => r.rev)), med: r4(median(sbc.map(r => r.sbcRev))), n: sbc.length },
      dso: { agg: r4((sum(dso, r => r.rec) / sum(dso, r => r.rev)) * 365), n: dso.length },
      dio: { agg: r4((sum(dio, r => r.inv) / sum(dio, r => r.cogs)) * 365), n: dio.length },
      gw: { agg: r4(sum(gw, r => r.gw) / sum(gw, r => r.ta)), n: gw.length },
    }
  }

  // ── 7. the league: the latest complete year's 500, each on its newest year ──
  const tickers = new Map()
  const ct = await get('https://www.sec.gov/files/company_tickers.json').catch(() => null)
  for (const v of Object.values(ct || {})) if (!tickers.has(v.cik_str)) tickers.set(v.cik_str, v.ticker)
  const league = U[latest].map(cik => {
    const ys = [...(scored.get(cik)?.keys() || [])].filter(y => y >= latest).sort((a, b) => b - a)
    const r = ys.map(y => scored.get(cik).get(y)).find(r => fin(r.accruals) || fin(r.beneish?.m)) || scored.get(cik)?.get(latest)
    if (!r) return null
    return {
      cik, ticker: tickers.get(cik) || null, name: names.get(cik)?.n || String(cik), sic: sic[cik]?.[0] ?? null, sicDesc: sic[cik]?.[1] || '',
      y: r.y, end: r.end, rev: r.rev, ta: r.ta, growth: r4(r.growth),
      accruals: r4(r.accruals), m: r4(r.beneish?.m), mNeutral: r.beneish?.neutral?.length ?? null,
      c: r.montier?.score ?? null, cTestable: r.montier?.testable ?? null, cTests: r.montier ? Object.entries(r.montier.tests).filter(([, v]) => v).map(([k]) => k) : [],
      life: r4(r.life), lifeChg3: r4(r.lifeChg3), sbcRev: r4(r.sbcRev), dso: r4(r.dso),
    }
  }).filter(r => r && r.ticker)
  // the composite ranks the three scores; useful-life change is shown but not
  // ranked, since for an asset-light company it is noise
  const COMP = ['accruals', 'm', 'c']
  const sorted = Object.fromEntries(COMP.map(k => [k, league.map(r => r[k]).filter(fin).sort((a, b) => a - b)]))
  for (const r of league) {
    const ps = COMP.map(k => [k, pctRank(sorted[k], r[k])]).filter(([, p]) => fin(p))
    r.pct = Object.fromEntries(ps.map(([k, p]) => [k, r4(p)]))
    r.comp = ps.length >= 2 ? r4(ps.reduce((s, [, p]) => s + p, 0) / ps.length) : null
  }
  league.sort((a, b) => (b.comp ?? -1) - (a.comp ?? -1))
  league.forEach((r, i) => { r.rank = fin(r.comp) ? i + 1 : null })
  const dist = Object.fromEntries([...COMP, 'lifeChg3', 'comp'].map(k => { const s = league.map(r => r[k]).filter(fin).sort((a, b) => a - b); return [k, s.length ? [0.1, 0.25, 0.5, 0.75, 0.9].map(q => r4(quantile(s, q))) : null] }))

  // ── 8. full-text counts: trouble filings and folly ──
  const Q = quarters('2001Q1', now)
  const ftsTotal = async (q, forms, s, e, ciks) => {
    const j = await get(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&forms=${encodeURIComponent(forms)}&dateRange=custom&startdt=${s}&enddt=${e}${ciks ? `&ciks=${ciks.map(pad).join(',')}` : ''}`)
    const t = j?.hits?.total
    return t ? { v: t.value, capped: t.relation !== 'eq' } : null
  }
  // a quarter's count does not change once it is well past, so an earlier
  // build's series is reused when its query is unchanged; the last two
  // quarters are always fetched again. The 500's series depend on who is in
  // the 500, so a full build fetches them afresh.
  const prevQ = prev?.events?.quarters || []
  const reuseUntil = Math.max(0, Math.min(prevQ.length, Q.length) - 2)
  const prevDef = (defs, key) => (defs || []).find(x => x.key === key)
  const same = (old, q, forms) => !!old && old.query === q && old.forms === forms
  const series = (old, keep) => { const a = new Array(Q.length).fill(null); for (let i = 0; i < keep; i++) a[i] = old?.[i] ?? null; return a }
  const events = { all: {}, big: {} }, folly = {}, capped = []
  const ftsJobs = []
  for (const [key, , q, forms, from] of EVENTS) {
    const keep = same(prevDef(prev?.events?.defs, key), q, forms) ? reuseUntil : 0
    events.all[key] = series(prev?.events?.all?.[key], keep)
    Q.forEach((qq, i) => { if (i >= keep && (!from || qq.label >= from)) ftsJobs.push(['all', key, q, forms, qq, i, null]) })
  }
  for (const key of BIG_EVENTS) {
    const [, , q, forms] = EVENTS.find(e => e[0] === key)
    const keep = recentOnly && same(prevDef(prev?.events?.defs, key), q, forms) ? reuseUntil : 0
    events.big[key] = series(prev?.events?.big?.[key], keep)
    Q.forEach((qq, i) => { if (i >= keep && qq.y >= SCORED) ftsJobs.push(['big', key, q, forms, qq, i, U[qq.y] && complete(qq.y) ? U[qq.y] : U[latest]]) })
  }
  for (const [key, , q, forms] of FOLLY) {
    const keep = same(prevDef(prev?.folly?.defs, key), q, forms) ? reuseUntil : 0
    folly[key] = series(prev?.folly?.series?.[key], keep)
    Q.forEach((qq, i) => { if (i >= keep) ftsJobs.push(['folly', key, q, forms, qq, i, null]) })
  }
  log(`sin monitor: ${ftsJobs.length} full-text counts`)
  await pmap(ftsJobs, 5, async ([grp, key, q, forms, qq, i, ciks]) => {
    const t = await ftsTotal(q, forms, qq.start, qq.end, ciks).catch(e => { log(`  full-text ${key} ${qq.label}: ${e.message}`); return null })
    if (!t) return
    if (t.capped) capped.push(`${key} ${qq.label}`)
    if (grp === 'folly') folly[key][i] = t.v
    else events[grp][key][i] = t.v
  })

  log(`sin monitor: done, ${get.count()} SEC requests`)
  return {
    built: now.toISOString(), latest, partialYear: complete(thisYear) ? null : thisYear,
    universeSize: UNIVERSE, filers,
    agg, league, dist,
    events: { quarters: Q.map(q => q.label), all: events.all, big: events.big, bigKeys: BIG_EVENTS, defs: EVENTS.map(([key, label, query, forms, from]) => ({ key, label, query, forms, from: from || Q[0].label })) },
    folly: { quarters: Q.map(q => q.label), series: folly, defs: FOLLY.map(([key, label, query, forms]) => ({ key, label, query, forms })) },
    capped, universe: { [latest]: U[latest] }, sic,
    sources: {
      frames: 'SEC XBRL frames API (data.sec.gov/api/xbrl/frames)', fts: 'EDGAR full-text search (efts.sec.gov), 2001 onward',
      sic: "EDGAR company records (assigned SIC)", tickers: 'SEC company_tickers.json',
    },
  }
}
