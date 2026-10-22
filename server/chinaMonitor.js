// ============================================================================
// CHINA MONITOR — Li Lu's "objective vs cost" frame (Columbia, Oct 2026): each
// decade Beijing sets an objective and another sector pays for it. Since ~2021
// the objective is manufacturing upgrading + tech self-sufficiency; the cost is
// the household balance sheet, through housing. Two sides, one 2021 hinge.
//
//   bis       stats.bis.org SDMX (keyless, official): WS_SPP Q.CN.{N,R}.628
//             residential property prices nominal / CPI-deflated (2010=100,
//             rebased here to 2021=100), WS_TC Q.CN.H.A.M.770.A household
//             credit % of GDP. Fallback for prices only: FRED QCNN628BIS /
//             QCNR628BIS (FRED was in maintenance at build time, ids unverified).
//   em70      datacenter-web.eastmoney.com RPT_ECONOMY_HOUSE_PRICE (keyless
//             mirror of NBS's 70-city release): city m/m indices for new and
//             second-hand homes since 2011-01. NBS publishes no national
//             figure; ours is the equal-weight average m/m change across the
//             70 cities, chain-linked (the Reuters-style calculation). 500 rows
//             a page: 27 pages once to backfill, then page 1 per refresh, the
//             per-month averages kept in the archive.
//   em*       Eastmoney macro tables (NBS / PBoC mirrors): CPI y/y, PPI y/y,
//             retail sales y/y, consumer confidence, industrial value-added
//             y/y, and two EDB items: real-estate development investment
//             (YTD, ¥100m → 12-month rolling sum = YTD(t) + Dec(y-1) - YTD(t-12))
//             and commodity-building sales value (single month, ¥10k; NBS
//             publishes Jan–Feb only combined, so the mirror has no Jan/Feb
//             rows — shown as an index against the same month of 2021).
//   pbc       pbc.gov.cn 金融机构本外币信贷收支表 (Sources & Uses of Credit
//             Funds, RMB + FX, ¥100m), one htm table per year since 2015:
//             household deposits, household loans, household medium/long-term
//             consumer loans (mortgage proxy), enterprise medium/long-term
//             loans. Year pages are found from the statistics index; complete
//             years are kept in the archive and never refetched.
//   dbn       api.db.nomics.world NBS mirror (keyless): annual tables
//             (2016–2025) for residential sales value/floor area, GDP, FAI
//             growth by sector (manufacturing vs real estate, chained here to
//             an index), output of ICs and cement, R&D spending; monthly
//             output of NEVs, industrial robots and PV cells. DBnomics keeps
//             only a rolling 13-month window of NBS monthly data and stopped
//             updating at Feb 2026 (indexed 2026-03-22); the window is kept in
//             the archive so history grows if it resumes. NBS's own
//             data.stats.gov.cn returns 403 (WAF "UrlACL") from outside China.
//   wb        api.worldbank.org: R&D % GDP, high-tech exports, manufacturing
//             value added % GDP (annual; one multi-indicator request).
//   owid      ourworldindata.org grapher electric-car-sales (IEA Global EV
//             Outlook): China EV sales, annual.
//   comtrade  comtradeapi.un.org public preview (keyless, 1 period per call,
//             rate-limited ~1 call / 3s): China exports of EVs (HS 870380,
//             870360, 870370) + Li-ion batteries (850760), PV cells/modules
//             (854142+854143, HS2022 so 2022+ only), imports of ICs (8542).
//             The last two years are refetched each refresh, older ones archived.
//
// Rules: monthly levels where they exist; YTD-only NBS items converted as
// stated per series (`transform`). Housing cost side is shown as indices with
// 2021 = 100. chgFromPeak / chg2021 are null for rate series (y/y %). chg2021
// is vs the 2021 average, except rolling sums (vs Dec 2021 = calendar 2021) and
// same-month-2021 indices (vs 100). A source that fails keeps its series from
// the previous build (listed in sourceErrors with carriedForward: true); with
// no previous build its metrics go to `missing`. Never throws once data exists.
// Cadence: refreshed daily, stale-while-revalidate (an expired cache is served
// with stale: true while a rebuild runs; a build with failed sources expires
// after 3 hours; a rebuild that fails outright backs off 30 minutes).
// First build ≈ 70 requests (backfills), later builds ≈ 20.
// Files: china-monitor.json at the repo root (payload + `archive`, which get()
// strips). No API keys are written to the payload or the logs.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const MIN = 60e3, H = 60 * MIN, DAY = 24 * H, TTL = DAY, RETRY = 30 * MIN
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 2) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const pct = (a, b) => (fin(a) && fin(b) && b !== 0 ? (a / b - 1) * 100 : null)
const mean = xs => { const v = xs.filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const wait = ms => new Promise(r => setTimeout(r, ms))
const scrub = s => String(s?.message || s || '').replace(/api_key=[^&\s"']+/gi, 'api_key=***').slice(0, 300)
const num = v => { if (v == null || v === 'NA' || v === '') return null; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null }
const ym = s => String(s).slice(0, 7)
const prevYm = p => { const [y, m] = p.split('-').map(Number); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}` }
const byPeriod = (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)

const EM = 'https://datacenter-web.eastmoney.com/api/data/v1/get'
const PBC = 'https://www.pbc.gov.cn'
const PBC_INDEX = '/diaochatongjisi/116219/116319/index.html'
const DBN = 'https://api.db.nomics.world/v22'
const PBC_FROM = 2015, COMTRADE_FROM = 2021

// series → block, so a failed block can carry its series forward
const BLOCKS = {
  bis: ['rpp_bis_nominal', 'rpp_bis_real', 'hh_debt_gdp'],
  em70: ['nbs70_new', 'nbs70_used'],
  emCpi: ['cpi_yoy'], emPpi: ['ppi_yoy'], emRetail: ['retail_yoy'], emConf: ['consumer_confidence'], emIndus: ['industrial_va_yoy'],
  emReInv: ['re_investment'], emReSales: ['re_sales_value_m'],
  pbc: ['hh_deposits', 'hh_loans', 'hh_mortgage_proxy', 'ent_mlt_loans'],
  dbn: ['resid_sales_value', 'resid_sales_area', 'fai_re_index', 'fai_mfg_index', 'ic_output', 'cement_output', 'rd_spend', 'nev_output_m', 'robot_output_m', 'pv_output_m', 'gdp'],
  wb: ['rd_gdp', 'hightech_exports', 'mfg_va_share'],
  owid: ['ev_sales'],
  comtrade: ['ev_battery_exports', 'pv_exports', 'ic_imports'],
}
// what each block's metrics are, for `missing` when a block has never succeeded
const BLOCK_LABEL = {
  bis: 'BIS residential property prices and household debt', em70: 'NBS 70-city new and second-hand home prices (Eastmoney mirror)',
  emCpi: 'CPI y/y', emPpi: 'PPI y/y', emRetail: 'Retail sales y/y', emConf: 'Consumer confidence', emIndus: 'Industrial value added y/y',
  emReInv: 'Real-estate development investment', emReSales: 'Commodity-building sales value (monthly)',
  pbc: 'PBoC household deposits and loans, enterprise medium/long-term loans', dbn: 'NBS annual tables and monthly product output (DBnomics)',
  wb: 'World Bank R&D, high-tech exports, manufacturing share', owid: 'EV sales (IEA via OWID)', comtrade: 'EV, battery, PV exports and IC imports (UN Comtrade)',
}

// One series. kind: 'level' | 'rate' (y/y %, no peak/2021 changes) | 'index21' (rebased so the 2021 mean = 100)
// | 'samemonth21' (already an index vs the same month of 2021) | 'rolling' (12-month sum; chg2021 vs Dec 2021).
function mk(m, raw) {
  let pts = raw.filter(p => p && p[0] && fin(p[1])).sort(byPeriod)
  if (!pts.length) return null
  if (m.kind === 'index21') {
    const b = mean(pts.filter(p => p[0].startsWith('2021')).map(p => p[1]))
    if (!fin(b) || !b) return null
    pts = pts.map(([p, v]) => [p, (v / b) * 100])
  }
  pts = pts.map(([p, v]) => [p, rnd(v, m.dp ?? 2)])
  const latest = pts.at(-1), peak = pts.reduce((a, b) => (b[1] > a[1] ? b : a))
  const rate = m.kind === 'rate'
  const base21 = rate ? null
    : m.kind === 'index21' || m.kind === 'samemonth21' ? 100
    : m.kind === 'rolling' ? (pts.find(p => p[0] === '2021-12')?.[1] ?? null)
    : mean(pts.filter(p => p[0].startsWith('2021')).map(p => p[1]))
  return {
    id: m.id, side: m.side, label: m.label, unit: m.unit, freq: m.freq, source: m.source, url: m.url, transform: m.transform,
    points: pts, latest: { period: latest[0], value: latest[1] }, peak: { period: peak[0], value: peak[1] },
    chgFromPeak: rate ? null : rnd(pct(latest[1], peak[1]), 1), chg2021: rate ? null : rnd(pct(latest[1], base21), 1),
  }
}

export function createChinaMonitor({ UA, dir, FRED_KEY }) {
  const CACHE = 'china-monitor.json'
  const file = path.join(dir, CACHE)
  const load = () => { try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { console.warn(`${CACHE}: ${e.message}`) } return null }
  const save = o => { try { fs.writeFileSync(file, JSON.stringify(o)) } catch (e) { console.error(`${CACHE} save:`, e.message) } }
  let mem = null, inflight = null, lastFail = 0, requests = 0

  // PBoC's tables are GBK, its pages UTF-8: decode by declared charset, else by what reads
  const decode = buf => {
    const head = buf.subarray(0, 2048).toString('latin1')
    if (/charset=["']?(gb2312|gbk|gb18030)/i.test(head)) return new TextDecoder('gbk').decode(buf)
    const u = buf.toString('utf8')
    return (u.match(/�/g) || []).length > 20 ? new TextDecoder('gbk').decode(buf) : u
  }
  async function fetchText(url, { headers = {}, tries = 3, timeout = 45_000, label = 'request' } = {}) {
    for (let a = 0; ; a++) {
      requests++
      let r, body
      try {
        r = await fetch(url, { headers: { 'User-Agent': UA, ...headers }, signal: AbortSignal.timeout(timeout) })
        body = r.ok ? decode(Buffer.from(await r.arrayBuffer())) : null // body read inside the try: a dropped stream retries too
      } catch (e) { if (a < tries - 1) { await wait(1500 * (a + 1)); continue } throw new Error(`${label}: ${scrub(e.cause?.code || e.message)}`) }
      if (r.ok) return body
      if ((r.status >= 500 || r.status === 429) && a < tries - 1) { await wait((r.status === 429 ? 5000 : 1500) * (a + 1)); continue }
      throw new Error(`${label}: HTTP ${r.status}`)
    }
  }
  async function fetchJson(url, opts) {
    const t = await fetchText(url, opts)
    try { return JSON.parse(t) } catch { throw new Error(`${opts?.label || 'request'}: not JSON (${t.slice(0, 60).replace(/\s+/g, ' ')})`) }
  }

  // ── BIS ───────────────────────────────────────────────────────────────────
  const bisCsv = text => {
    const lines = text.trim().split(/\r?\n/), h = lines[0].split(',')
    const iT = h.indexOf('TIME_PERIOD'), iV = h.indexOf('OBS_VALUE')
    return lines.slice(1).map(l => l.split(',')).map(c => ({ key: c, t: c[iT], v: num(c[iV]) }))
  }
  async function blockBis() {
    const out = []
    const SPP = 'https://data.bis.org/topics/RPP'
    const metaN = { id: 'rpp_bis_nominal', side: 'cost', label: 'Residential property prices, nominal (BIS)', unit: 'index, 2021 = 100', freq: 'Q', url: SPP, transform: 'index 2021=100 (rebased from BIS 2010=100)', kind: 'index21', dp: 2 }
    const metaR = { ...metaN, id: 'rpp_bis_real', label: 'Residential property prices, real — CPI-deflated (BIS)' }
    try {
      const rows = bisCsv(await fetchText('https://stats.bis.org/api/v1/data/WS_SPP/Q.CN.N+R.628?format=csv', { label: 'BIS WS_SPP' }))
      const pick = val => rows.filter(r => r.key[2] === val).map(r => [r.t, r.v])
      out.push(mk({ ...metaN, source: 'BIS selected residential property prices (WS_SPP Q.CN.N.628), compiled from NBS data' }, pick('N')))
      out.push(mk({ ...metaR, source: 'BIS selected residential property prices (WS_SPP Q.CN.R.628), compiled from NBS data' }, pick('R')))
    } catch (e) {
      if (!FRED_KEY) throw e
      // fallback: the same BIS series on FRED (quarterly dates → YYYY-Qn)
      const fred = async id => {
        const j = await fetchJson(`https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${FRED_KEY}&file_type=json`, { label: `FRED ${id}` })
        return (j.observations || []).map(o => [`${o.date.slice(0, 4)}-Q${Math.floor((+o.date.slice(5, 7) - 1) / 3) + 1}`, num(o.value)])
      }
      out.push(mk({ ...metaN, source: 'BIS via FRED (QCNN628BIS)', url: 'https://fred.stlouisfed.org/series/QCNN628BIS' }, await fred('QCNN628BIS')))
      out.push(mk({ ...metaR, source: 'BIS via FRED (QCNR628BIS)', url: 'https://fred.stlouisfed.org/series/QCNR628BIS' }, await fred('QCNR628BIS')))
    }
    const tc = bisCsv(await fetchText('https://stats.bis.org/api/v1/data/WS_TC/Q.CN.H.A.M.770.A?format=csv', { label: 'BIS WS_TC' }))
    out.push(mk({ id: 'hh_debt_gdp', side: 'cost', label: 'Household debt (BIS credit to households & NPISHs)', unit: '% of GDP', freq: 'Q', source: 'BIS total credit statistics (WS_TC Q.CN.H.A.M.770.A)', url: 'https://data.bis.org/topics/TOTAL_CREDIT', transform: 'level', kind: 'level', dp: 1 }, tc.map(r => [r.t, r.v])))
    return out
  }

  // ── Eastmoney ─────────────────────────────────────────────────────────────
  const emUrl = (params, page = 1) => `${EM}?${new URLSearchParams({ ...params, pageNumber: String(page), pageSize: '500', source: 'WEB', client: 'WEB' })}`
  const emGet = async (params, page, label) => {
    const j = await fetchJson(emUrl(params, page), { headers: { Referer: 'https://data.eastmoney.com/' }, label })
    if (!j.success || !j.result) throw new Error(`${label}: ${j.message || 'no result'}`)
    return j.result
  }
  // one macro table → [[YYYY-MM, value]] (one row per month)
  async function emTable(reportName, col, label) {
    const r = await emGet({ reportName, columns: `REPORT_DATE,${col}`, sortColumns: 'REPORT_DATE', sortTypes: '-1' }, 1, label)
    return r.data.map(d => [ym(d.REPORT_DATE), num(d[col])])
  }
  // one EDB indicator (rows repeat per industry board, so dedupe by date)
  async function emEdb(id, label, since = '2010-01-01') {
    const params = { reportName: 'RPT_INDUSTRY_INDEX', columns: 'REPORT_DATE,INDICATOR_VALUE', filter: `(INDICATOR_ID="${id}")(REPORT_DATE>='${since}')`, sortColumns: 'REPORT_DATE', sortTypes: '-1' }
    const first = await emGet(params, 1, label), rows = [...first.data]
    for (let p = 2; p <= Math.min(first.pages || 1, 4); p++) rows.push(...(await emGet(params, p, label)).data)
    const m = new Map(); for (const d of rows) if (!m.has(ym(d.REPORT_DATE))) m.set(ym(d.REPORT_DATE), num(d.INDICATOR_VALUE))
    return m
  }
  const emApi = (reportName, cols) => `${EM}?reportName=${reportName}&columns=${cols}&sortColumns=REPORT_DATE&sortTypes=-1&source=WEB&client=WEB`
  const EMSRC = 'Eastmoney data center (mirror of NBS release)'

  async function blockEm70(ctx) {
    const arch = ctx.archive.nbs70 || {}
    const have = Object.keys(arch).sort()
    const full = have.length >= 150 && have[0] <= '2011-02'
    const params = { reportName: 'RPT_ECONOMY_HOUSE_PRICE', columns: 'REPORT_DATE,CITY,FIRST_COMHOUSE_SEQUENTIAL,SECOND_HOUSE_SEQUENTIAL', sortColumns: 'REPORT_DATE,CITY', sortTypes: '-1,1' }
    const rows = new Map()
    const first = await emGet(params, 1, 'Eastmoney 70-city')
    const add = data => { for (const d of data) rows.set(`${ym(d.REPORT_DATE)}|${d.CITY}`, [num(d.FIRST_COMHOUSE_SEQUENTIAL), num(d.SECOND_HOUSE_SEQUENTIAL)]) }
    add(first.data)
    const pages = first.pages || 1, latestHave = have.at(-1) || ''
    for (let p = 2; p <= pages; p++) {
      if (full) { const oldest = [...rows.keys()].map(k => k.slice(0, 7)).sort()[0]; if (oldest <= latestHave) break }
      await wait(250)
      add((await emGet(params, p, 'Eastmoney 70-city')).data)
    }
    // per month: average m/m % change across the cities reported; partial months (page edges) are skipped
    const g = new Map()
    for (const [k, [nw, us]] of rows) { const m = k.slice(0, 7); const x = g.get(m) || { n: [], u: [], c: 0 }; x.c++; if (fin(nw)) x.n.push(nw - 100); if (fin(us)) x.u.push(us - 100); g.set(m, x) }
    const next = { ...arch }
    for (const [m, x] of g) if (x.c >= 60 || (!arch[m] && !full && x.c >= 30)) next[m] = [rnd(mean(x.n), 4), rnd(mean(x.u), 4), x.c]
    ctx.patch.nbs70 = next
    const months = Object.keys(next).sort()
    const chain = k => { const pts = []; let lvl = 100, prev = null, gaps = 0; for (const m of months) { if (prev && prevYm(m) !== prev) gaps++; const c = next[m][k]; if (fin(c)) lvl *= 1 + c / 100; pts.push([m, lvl]); prev = m } return { pts, gaps } }
    const n = chain(0), u = chain(1)
    if (n.gaps) ctx.warn.push(`70-city chain has ${n.gaps} missing month(s); changes treated as 0 there`)
    const base = { side: 'cost', unit: 'index, 2021 = 100', freq: 'M', source: `${EMSRC}: NBS 70 large and medium-sized cities, sales price indices (m/m, previous month = 100)`, url: emApi('RPT_ECONOMY_HOUSE_PRICE', 'REPORT_DATE,CITY,FIRST_COMHOUSE_SEQUENTIAL,SECOND_HOUSE_SEQUENTIAL'), transform: 'index 2021=100 (equal-weight average of the 70 cities’ m/m changes, chain-linked from Dec 2010)', kind: 'index21', dp: 2 }
    return [
      mk({ ...base, id: 'nbs70_new', label: 'New-home prices, 70-city average (NBS)' }, n.pts),
      mk({ ...base, id: 'nbs70_used', label: 'Second-hand home prices, 70-city average (NBS)' }, u.pts),
    ]
  }

  const rateBlock = (id, side, label, reportName, col, source) => async () => [mk({ id, side, label, unit: '% y/y', freq: 'M', source: `${EMSRC}: ${source}`, url: emApi(reportName, `REPORT_DATE,${col}`), transform: 'yoy %', kind: 'rate', dp: 2 }, await emTable(reportName, col, `Eastmoney ${reportName}`))]
  const blockCpi = rateBlock('cpi_yoy', 'context', 'Consumer prices (CPI)', 'RPT_ECONOMY_CPI', 'NATIONAL_SAME', 'NBS CPI, national, same month last year')
  const blockPpi = rateBlock('ppi_yoy', 'context', 'Producer prices (PPI)', 'RPT_ECONOMY_PPI', 'BASE_SAME', 'NBS PPI for industrial products, same month last year')
  const blockRetail = rateBlock('retail_yoy', 'cost', 'Retail sales of consumer goods', 'RPT_ECONOMY_TOTAL_RETAIL', 'RETAIL_TOTAL_SAME', 'NBS total retail sales of consumer goods, single month (Jan–Feb published combined)')
  const blockIndus = rateBlock('industrial_va_yoy', 'context', 'Industrial value added (real)', 'RPT_ECONOMY_INDUS_GROW', 'BASE_SAME', 'NBS value added of industry above designated size, real growth')
  async function blockConf() {
    const pts = await emTable('RPT_ECONOMY_FAITH_INDEX', 'CONSUMERS_FAITH_INDEX', 'Eastmoney consumer confidence')
    return [mk({ id: 'consumer_confidence', side: 'cost', label: 'Consumer confidence index (NBS)', unit: 'index (100 = neutral)', freq: 'M', source: `${EMSRC}: NBS consumer confidence index`, url: emApi('RPT_ECONOMY_FAITH_INDEX', 'REPORT_DATE,CONSUMERS_FAITH_INDEX'), transform: 'level', kind: 'level', dp: 1 }, pts)]
  }
  async function blockReInv() {
    const ytd = await emEdb('EMI00120219', 'Eastmoney RE investment')
    const pts = []
    for (const [m, v] of ytd) {
      const [y, mm] = m.split('-'), ly = String(+y - 1)
      const dec = ytd.get(`${ly}-12`), same = ytd.get(`${ly}-${mm}`)
      if (fin(v) && fin(dec) && fin(same)) pts.push([m, (v + dec - same) / 1e4])
    }
    return [mk({ id: 're_investment', side: 'cost', label: 'Real-estate development investment', unit: '¥ trillion, 12 months', freq: 'M', source: `${EMSRC}: NBS investment in real-estate development, YTD (EDB EMI00120219)`, url: `${EM}?reportName=RPT_INDUSTRY_INDEX&columns=REPORT_DATE,INDICATOR_VALUE&filter=(INDICATOR_ID="EMI00120219")`, transform: 'rolling 12-month sum from YTD: YTD(t) + Dec(y-1) - YTD(t-12); chg2021 vs calendar 2021', kind: 'rolling', dp: 3 }, pts)]
  }
  async function blockReSales() {
    const mo = await emEdb('EMI01523157', 'Eastmoney RE sales value')
    const pts = []
    for (const [m, v] of mo) { const b = mo.get(`2021-${m.slice(5)}`); if (fin(v) && fin(b) && b > 0) pts.push([m, (v / b) * 100]) }
    return [mk({ id: 're_sales_value_m', side: 'cost', label: 'Commodity-building sales value, single month (all types)', unit: 'index, same month of 2021 = 100', freq: 'M', source: `${EMSRC}: NBS sales of commercialized buildings, current month (EDB EMI01523157); no Jan/Feb rows (published combined)`, url: `${EM}?reportName=RPT_INDUSTRY_INDEX&columns=REPORT_DATE,INDICATOR_VALUE&filter=(INDICATOR_ID="EMI01523157")`, transform: 'index, same month of 2021 = 100 (seasonality-matched)', kind: 'samemonth21', dp: 1 }, pts)]
  }

  // ── PBoC ──────────────────────────────────────────────────────────────────
  const cellsOf = html => [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(r => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()))
  function parsePbcTable(html) {
    const rows = cellsOf(html)
    const head = rows.find(r => r.some(c => /^\d{4}\.\d{2}$/.test(c)))
    if (!head) throw new Error('PBoC: table header not found')
    const months = head.map(c => (/^\d{4}\.\d{2}$/.test(c) ? c.replace('.', '-') : null))
    const out = {}
    const take = (k, r) => months.forEach((m, i) => { if (m) { const v = num(r[i]); if (v != null) (out[m] ||= {})[k] = v } })
    let sec = null, sub = null
    // rows carry Chinese + English labels; match either
    for (const r of rows) {
      const l = r[0] || ''
      if (/住户存款|Deposits of Households/i.test(l)) take('dep', r)
      else if (/住户贷款|Loans to Households/i.test(l)) { take('hhl', r); sec = 'hh'; sub = null }
      else if (/企.事.业单位贷款|Loans to Non-financial Enterprises/i.test(l)) { sec = 'ent'; sub = null }
      else if (/^[3-9]\s*[.．]/.test(l) || /^[二三四五六]、/.test(l)) { sec = null; sub = null }
      else if (/中长期贷款|Mid\s*&\s*Long-term Loans/i.test(l)) { sub = 'mlt'; if (sec === 'ent') take('entMlt', r) }
      else if (/短期贷款|票据融资|Short-term Loans|Paper Financing/i.test(l)) sub = 'other'
      else if (/消费贷款|Consumption Loans/i.test(l) && sec === 'hh' && sub === 'mlt') take('hhMlt', r)
    }
    return out
  }
  async function blockPbc(ctx) {
    const arch = ctx.archive.pbc || { months: {}, years: {} }
    const months = { ...arch.months }, years = { ...arch.years }
    const curY = new Date().getUTCFullYear()
    const idx = await fetchText(PBC + PBC_INDEX, { label: 'PBoC index' })
    const yearBase = new Map([...idx.matchAll(/href='([^']+)\/index\.html'[^>]*>(\d{4})年统计数据/g)].map(m => [+m[2], m[1]]))
    const credit = [...idx.matchAll(/href='([^']+\/index\.html)'[^>]*>金融机构信贷收支统计/g)].map(m => m[1])
    let fetched = 0
    for (let y = PBC_FROM; y <= curY; y++) {
      if (years[y] >= 12 && y < curY) continue
      const base = yearBase.get(y), page = base && credit.find(c => c.startsWith(base + '/'))
      if (!page) { if (y === curY && new Date().getUTCMonth() < 2) continue; ctx.warn.push(`PBoC: no credit-statistics page found for ${y}`); continue }
      const yp = await fetchText(PBC + page, { label: `PBoC ${y} page` })
      const cells = [...yp.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(c => c[1])
      let htm = null
      for (let i = 0; i < cells.length && !htm; i++) {
        const label = cells[i].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
        if (/^金融机构本外币信贷收支表/.test(label)) htm = cells.slice(i + 1, i + 4).map(c => (c.match(/href=["']([^"']+\.htm)["']/) || [])[1]).find(Boolean)
      }
      if (!htm) { ctx.warn.push(`PBoC: sources-and-uses table link not found for ${y}`); continue }
      await wait(300)
      const t = parsePbcTable(await fetchText(PBC + htm, { label: `PBoC ${y} table` }))
      let n = 0
      for (const [m, v] of Object.entries(t)) if (m.startsWith(String(y)) && fin(v.dep)) { months[m] = [v.dep, v.hhl ?? null, v.hhMlt ?? null, v.entMlt ?? null]; n++ }
      years[y] = n; fetched++
      await wait(300)
    }
    ctx.patch.pbc = { months, years }
    const ms = Object.keys(months).sort()
    const col = i => ms.map(m => [m, fin(months[m][i]) ? months[m][i] / 1e4 : null])
    const base = { freq: 'M', unit: '¥ trillion', source: 'People’s Bank of China, Sources & Uses of Credit Funds of Financial Institutions (RMB and foreign currency), end of month', url: PBC + PBC_INDEX, transform: 'level', kind: 'level', dp: 2 }
    return [
      mk({ ...base, id: 'hh_deposits', side: 'cost', label: 'Household deposits' }, col(0)),
      mk({ ...base, id: 'hh_loans', side: 'cost', label: 'Household loans' }, col(1)),
      mk({ ...base, id: 'hh_mortgage_proxy', side: 'cost', label: 'Household medium/long-term consumer loans (mortgage proxy)' }, col(2)),
      mk({ ...base, id: 'ent_mlt_loans', side: 'objective', label: 'Medium/long-term loans to enterprises & public bodies (all industries)' }, col(3)),
    ]
  }

  // ── DBnomics (NBS mirror) ─────────────────────────────────────────────────
  const DBN_IDS = {
    residValue: 'A_A0516/A051602', residArea: 'A_A0515/A051502', residValueYtd: 'M_A060B/A060B01', residAreaYtd: 'M_A060A/A060A01',
    gdp: 'A_A0201/A020102', faiMfg: 'A_A050B/A050B0F', faiRe: 'A_A050B/A050B28', ic: 'A_A0E0H/A0E0H28', cement: 'A_A0E0H/A0E0H0W', rd: 'A_A0N01/A0N0109',
    nev: 'M_A02092W/A02092W01', robots: 'M_A020922/A02092201', pv: 'M_A02092E/A02092E01',
    nevYtd: 'M_A02092W/A02092W02', robotsYtd: 'M_A020922/A02092202', pvYtd: 'M_A02092E/A02092E02',
  }
  async function blockDbn(ctx) {
    const ids = Object.values(DBN_IDS).map(s => `NBS/${s}`).join(',')
    const j = await fetchJson(`${DBN}/series?series_ids=${ids}&observations=1`, { label: 'DBnomics NBS' })
    const docs = j.series?.docs || []
    if (!docs.length) throw new Error('DBnomics NBS: no series returned')
    const arch = { ...(ctx.archive.dbn || {}) }
    const got = {}
    for (const d of docs) {
      const key = `${d.dataset_code}/${d.series_code}`
      const fresh = Object.fromEntries((d.period || []).map((p, i) => [p, num(d.value?.[i])]).filter(([, v]) => fin(v)))
      arch[key] = { ...(arch[key] || {}), ...fresh } // the monthly window rolls; keep what fell out of it
      got[key] = d.indexed_at || null
    }
    ctx.patch.dbn = arch
    ctx.meta.dbnIndexed = got
    const ser = k => Object.entries(arch[DBN_IDS[k]] || {}).sort(byPeriod)
    const annual = (k, div) => ser(k).filter(([p]) => /^\d{4}$/.test(p)).map(([p, v]) => [p, v / div])
    // latest full year from December YTD when the annual table has not caught up
    const withDec = (k, ytdK, div) => { const a = new Map(annual(k, div)); for (const [p, v] of ser(ytdK)) if (p.endsWith('-12') && !a.has(p.slice(0, 4))) a.set(p.slice(0, 4), v / div); return [...a].sort(byPeriod) }
    const chained = k => { const g = annual(k, 1); if (!g.length) return []; const pts = [[String(+g[0][0] - 1), 100]]; let lvl = 100; for (const [p, v] of g) { lvl *= 1 + v / 100; pts.push([p, lvl]) } return pts }
    const monthly = (k, div) => ser(k).filter(([p]) => /^\d{4}-\d{2}$/.test(p)).map(([p, v]) => [p, v / div])
    const DB = 'https://db.nomics.world/NBS/'
    const A = { freq: 'A', kind: 'level', transform: 'level' }
    const NBSA = 'NBS annual data via DBnomics'
    const MW = 'NBS monthly output of major industrial products via DBnomics (rolling 13-month window, frozen at Feb 2026; archived here)'
    return [
      mk({ ...A, id: 'resid_sales_value', side: 'cost', label: 'Residential sales value (new commodity housing)', unit: '¥ trillion', source: `${NBSA} (A051602); latest year from December YTD (A060B01) when the annual table lags`, url: DB + DBN_IDS.residValue, dp: 2 }, withDec('residValue', 'residValueYtd', 1e4)),
      mk({ ...A, id: 'resid_sales_area', side: 'cost', label: 'Residential floor area sold (new commodity housing)', unit: 'million m²', source: `${NBSA} (A051502); latest year from December YTD (A060A01) when the annual table lags`, url: DB + DBN_IDS.residArea, dp: 0 }, withDec('residArea', 'residAreaYtd', 100)),
      mk({ ...A, id: 'fai_re_index', side: 'cost', label: 'Fixed-asset investment, real-estate sector', unit: 'index, 2021 = 100', source: `${NBSA}: FAI growth by sector (A050B28), chained`, url: DB + DBN_IDS.faiRe, transform: 'index 2021=100, chained from NBS annual growth rates (NBS publishes no sector levels since 2018)', kind: 'index21', dp: 1 }, chained('faiRe')),
      mk({ ...A, id: 'fai_mfg_index', side: 'objective', label: 'Fixed-asset investment, manufacturing', unit: 'index, 2021 = 100', source: `${NBSA}: FAI growth by sector (A050B0F), chained`, url: DB + DBN_IDS.faiMfg, transform: 'index 2021=100, chained from NBS annual growth rates (NBS publishes no sector levels since 2018)', kind: 'index21', dp: 1 }, chained('faiMfg')),
      mk({ ...A, id: 'ic_output', side: 'objective', label: 'Integrated circuits output', unit: 'billion units', source: `${NBSA} (A0E0H28)`, url: DB + DBN_IDS.ic, dp: 1 }, annual('ic', 1e5)),
      mk({ ...A, id: 'cement_output', side: 'context', label: 'Cement output (construction proxy)', unit: 'million tonnes', source: `${NBSA} (A0E0H0W)`, url: DB + DBN_IDS.cement, dp: 0 }, annual('cement', 100)),
      mk({ ...A, id: 'rd_spend', side: 'objective', label: 'R&D expenditure', unit: '¥ trillion', source: `${NBSA} (A0N0109)`, url: DB + DBN_IDS.rd, dp: 2 }, annual('rd', 1e4)),
      mk({ ...A, id: 'gdp', side: 'context', label: 'Nominal GDP', unit: '¥ trillion', source: `${NBSA} (A020102)`, url: DB + DBN_IDS.gdp, dp: 1 }, annual('gdp', 1e4)),
      mk({ id: 'nev_output_m', side: 'objective', label: 'New-energy vehicle output, single month', unit: 'million units', freq: 'M', source: `${MW}: A02092W01`, url: DB + DBN_IDS.nev, transform: 'level', kind: 'level', dp: 3 }, monthly('nev', 100)),
      mk({ id: 'robot_output_m', side: 'objective', label: 'Industrial robot output, single month', unit: 'thousand units', freq: 'M', source: `${MW}: A02092201`, url: DB + DBN_IDS.robots, transform: 'level', kind: 'level', dp: 1 }, monthly('robots', 1000)),
      mk({ id: 'pv_output_m', side: 'objective', label: 'Photovoltaic cell output, single month', unit: 'GW', freq: 'M', source: `${MW}: A02092E01`, url: DB + DBN_IDS.pv, transform: 'level', kind: 'level', dp: 1 }, monthly('pv', 100)),
    ]
  }

  // ── World Bank, OWID ──────────────────────────────────────────────────────
  async function blockWb() {
    const j = await fetchJson('https://api.worldbank.org/v2/country/CHN/indicator/GB.XPD.RSDV.GD.ZS;TX.VAL.TECH.CD;NV.IND.MANF.ZS?source=2&format=json&per_page=1000&date=2000:2030', { label: 'World Bank' })
    const rows = Array.isArray(j) ? j[1] || [] : []
    if (!rows.length) throw new Error('World Bank: no rows')
    const pick = (id, div = 1) => rows.filter(r => r.indicator?.id === id).map(r => [String(r.date), fin(r.value) ? r.value / div : null])
    const W = id => `https://data.worldbank.org/indicator/${id}?locations=CN`
    const A = { freq: 'A', kind: 'level', transform: 'level', source: 'World Bank World Development Indicators' }
    return [
      mk({ ...A, id: 'rd_gdp', side: 'objective', label: 'R&D expenditure', unit: '% of GDP', url: W('GB.XPD.RSDV.GD.ZS'), source: `${A.source} (GB.XPD.RSDV.GD.ZS, UNESCO)`, dp: 2 }, pick('GB.XPD.RSDV.GD.ZS')),
      mk({ ...A, id: 'hightech_exports', side: 'objective', label: 'High-technology exports (SITC high-R&D products)', unit: 'USD billion', url: W('TX.VAL.TECH.CD'), source: `${A.source} (TX.VAL.TECH.CD, UN Comtrade)`, dp: 0 }, pick('TX.VAL.TECH.CD', 1e9)),
      mk({ ...A, id: 'mfg_va_share', side: 'context', label: 'Manufacturing value added', unit: '% of GDP', url: W('NV.IND.MANF.ZS'), source: `${A.source} (NV.IND.MANF.ZS)`, dp: 1 }, pick('NV.IND.MANF.ZS')),
    ]
  }
  async function blockOwid() {
    const csv = await fetchText('https://ourworldindata.org/grapher/electric-car-sales.csv?v=1&csvType=full&useColumnShortNames=true', { label: 'OWID EV sales' })
    const lines = csv.trim().split(/\r?\n/), h = lines[0].split(',')
    const iC = h.indexOf('code'), iY = h.indexOf('year'), iV = h.findIndex((x, i) => i > iY && x)
    const pts = lines.slice(1).map(l => l.split(',')).filter(c => c[iC] === 'CHN').map(c => [c[iY], num(c[iV]) / 1e6])
    return [mk({ id: 'ev_sales', side: 'objective', label: 'Electric car sales (BEV + PHEV)', unit: 'million cars', freq: 'A', source: 'IEA Global EV Outlook via Our World in Data (electric-car-sales)', url: 'https://ourworldindata.org/grapher/electric-car-sales?country=~CHN', transform: 'level', kind: 'level', dp: 2 }, pts)]
  }

  // ── UN Comtrade (keyless preview, annual) ─────────────────────────────────
  async function blockComtrade(ctx) {
    const arch = { ...(ctx.archive.comtrade || {}) }
    const curY = new Date().getUTCFullYear()
    let ok = 0, lastErr = null
    for (let y = COMTRADE_FROM; y < curY; y++) {
      if (arch[y] && y < curY - 2) continue
      await wait(3500)
      try {
        const j = await fetchJson(`https://comtradeapi.un.org/public/v1/preview/C/A/HS?reporterCode=156&period=${y}&partnerCode=0&flowCode=X,M&cmdCode=870380,870360,870370,850760,854142,854143,8542`, { label: `Comtrade ${y}`, tries: 3 })
        const rows = (j.data || []).filter(r => +r.partnerCode === 0 && (+r.partner2Code || 0) === 0 && (r.customsCode == null || r.customsCode === 'C00') && (+r.motCode || 0) === 0)
        if (!rows.length) continue
        const v = (flow, codes) => { const xs = rows.filter(r => r.flowCode === flow && codes.includes(String(r.cmdCode))); return xs.length ? xs.reduce((a, r) => a + (+r.primaryValue || 0), 0) / 1e9 : null }
        const ev = v('X', ['870380', '870360', '870370']), batt = v('X', ['850760'])
        arch[y] = { evBatt: fin(ev) && fin(batt) ? ev + batt : null, pv: v('X', ['854142', '854143']), icM: v('M', ['8542']), cls: rows[0].classificationCode || null, at: new Date().toISOString() }
        ok++
      } catch (e) { lastErr = e }
    }
    if (!ok && lastErr && !Object.keys(arch).length) throw lastErr
    if (lastErr) ctx.warn.push(`Comtrade: ${scrub(lastErr)} (other years kept)`)
    ctx.patch.comtrade = arch
    const ys = Object.keys(arch).sort()
    const col = k => ys.map(y => [y, arch[y][k]])
    const A = { freq: 'A', kind: 'level', transform: 'level', unit: 'USD billion', url: 'https://comtradeplus.un.org/', dp: 1 }
    return [
      mk({ ...A, id: 'ev_battery_exports', side: 'objective', label: 'Exports of electric vehicles + lithium-ion batteries', source: 'UN Comtrade (China reporter, world partner): HS 870380 + 870360 + 870370 + 850760' }, col('evBatt')),
      mk({ ...A, id: 'pv_exports', side: 'objective', label: 'Exports of solar cells and modules', source: 'UN Comtrade: HS 854142 + 854143 (HS2022 codes, so 2022 onward)' }, col('pv')),
      mk({ ...A, id: 'ic_imports', side: 'objective', label: 'Imports of integrated circuits (self-sufficiency gauge)', source: 'UN Comtrade: HS 8542 imports' }, col('icM')),
    ]
  }

  // ── checks against Li Lu's figures ────────────────────────────────────────
  function buildChecks(S) {
    const s = id => S.get(id)
    const at = (id, p) => s(id)?.points.find(x => x[0] === p)?.[1] ?? null
    const f1 = v => (fin(v) ? (Math.round(v * 10) / 10).toFixed(1) : '—')
    const f0 = v => (fin(v) ? String(Math.round(v)) : '—')
    const sgn = v => (fin(v) ? (v > 0 ? '+' : '') + f1(v) : '—')
    const has = (...ids) => ids.filter(id => s(id))
    const checks = []

    { // 1. balance-sheet composition
      const d = s('hh_debt_gdp'), l = s('hh_loans'), dep = s('hh_deposits')
      const lr = l && dep ? rnd(l.latest.value / dep.latest.value * 100, 0) : null
      checks.push({ claim: 'At the 2021 peak, homes were ~70% of a middle-class family’s net worth, with ~50% mortgage leverage', ours: `No free time series on household asset composition or loan-to-value. Context: household debt ${d ? `peaked at ${f1(d.peak.value)}% of GDP (${d.peak.period}), now ${f1(d.latest.value)}% (${d.latest.period})` : 'n/a'}; household loans ${fin(lr) ? `are ${lr}% of household deposits (${l.latest.period})` : 'n/a'}.`, verdict: 'no data', seriesIds: has('hh_debt_gdp', 'hh_loans', 'hh_deposits') })
    }
    { // 2. home prices −40%
      const ids = has('rpp_bis_nominal', 'rpp_bis_real', 'nbs70_new', 'nbs70_used'), drops = ids.map(id => s(id).chgFromPeak).filter(fin)
      const worst = drops.length ? Math.min(...drops) : null
      const txt = ids.map(id => `${s(id).label.replace(/ \(.*\)$/, '').replace('Residential property prices, ', 'BIS ')}: ${f1(s(id).chgFromPeak)}% from ${s(id).peak.period} peak (to ${s(id).latest.period})`).join('; ')
      const share = fin(worst) ? Math.round(-worst / 40 * 100) : null
      checks.push({ claim: 'Nationwide home prices are down ~40% since 2021', ours: ids.length ? `${txt}. The deepest official-based fall is ${f1(worst)}%, about ${share}% of the claimed 40%; larger drops are usually cited from private resale trackers (not free).` : 'No price series available.', verdict: !fin(worst) ? 'no data' : worst <= -32 ? 'consistent' : worst <= -15 ? 'partly' : 'not supported', seriesIds: ids })
    }
    { // 3. new home sales −70%
      const v = s('resid_sales_value'), a = s('resid_sales_area'), m = s('re_sales_value_m')
      const dv = v && at('resid_sales_value', '2021') ? pct(v.latest.value, at('resid_sales_value', '2021')) : null
      const da = a && at('resid_sales_area', '2021') ? pct(a.latest.value, at('resid_sales_area', '2021')) : null
      const dm = m ? m.latest.value - 100 : null
      const worst = [dv, da, dm].filter(fin)
      const w = worst.length ? Math.min(...worst) : null
      checks.push({ claim: 'New home sales are down ~70%', ours: `Residential sales value ${v ? `${sgn(dv)}% (2021 → ${v.latest.period})` : 'n/a'}; floor area sold ${a ? `${sgn(da)}% (2021 → ${a.latest.period})` : 'n/a'}; all commodity-building sales in ${m ? `${m.latest.period} were ${f1(dm)}% vs the same month of 2021` : 'n/a'}.`, verdict: !fin(w) ? 'no data' : w <= -60 ? 'consistent' : w <= -35 ? 'partly' : 'not supported', seriesIds: has('resid_sales_value', 'resid_sales_area', 're_sales_value_m') })
    }
    { // 4. deposits 165tn ≈ 120% GDP
      const d = s('hh_deposits'), g = s('gdp')
      const ratio = d && g ? d.latest.value / g.latest.value * 100 : null
      const cross = d ? d.points.find(p => p[1] >= 165)?.[0] : null
      const ok = d && Math.abs(d.latest.value / 165 - 1) <= 0.12 && fin(ratio) && Math.abs(ratio - 120) <= 15
      checks.push({ claim: 'Household savings deposits are ≈165 trillion yuan, ≈120% of GDP', ours: d ? `Household deposits ¥${f1(d.latest.value)}tn (${d.latest.period}; RMB + FX)${cross ? `, first above ¥165tn in ${cross}` : ''}; ${fin(ratio) ? `${f0(ratio)}% of ${g.latest.period} GDP (¥${f1(g.latest.value)}tn)` : 'GDP n/a'}${fin(d.chg2021) ? `; ${sgn(d.chg2021)}% vs the 2021 average` : ''}.` : 'No deposit series.', verdict: !d ? 'no data' : ok ? 'consistent' : 'partly', seriesIds: has('hh_deposits', 'gdp') })
    }
    { // 5. prices flat to slightly negative for 2–3 years
      const c = s('cpi_yoy'), p = s('ppi_yoy')
      const last = (x, n) => x ? x.points.slice(-n).map(q => q[1]) : []
      const c36 = last(c, 36), p36 = last(p, 36)
      const cAvg = mean(c36), cMax = c36.length ? Math.max(...c36) : null
      const pNeg = p ? p.points.filter(q => q[1] < 0).length : 0
      let run = 0; if (p) { for (let i = p.points.length - 1; i >= 0 && p.points[i][1] >= 0; i--) run++ }
      let negRun = 0; if (p) { let i = p.points.length - 1 - run; for (; i >= 0 && p.points[i][1] < 0; i--) negRun++ }
      const flat = fin(cAvg) && Math.abs(cAvg) <= 1 && cMax <= 2.5
      checks.push({ claim: 'Prices have been flat to slightly negative for 2–3 years', ours: c ? `CPI averaged ${f1(cAvg)}% y/y over the last ${c36.length} months (max ${f1(cMax)}%, latest ${f1(c.latest.value)}% in ${c.latest.period}). ${p ? `PPI: ${negRun} straight negative months${run ? ` before turning positive ${run} month(s) ago (latest ${sgn(p.latest.value)}% in ${p.latest.period})` : ' to date'}.` : ''}` : 'No CPI series.', verdict: !c ? 'no data' : flat && !run ? 'consistent' : flat ? 'partly' : 'not supported', seriesIds: has('cpi_yoy', 'ppi_yoy') })
    }
    { // 6. ~10tn a year shifted from property to manufacturing/tech
      const r = s('re_investment'), mf = s('fai_mfg_index'), e = s('ent_mlt_loans'), hl = s('hh_loans')
      const r21 = r ? at('re_investment', '2021-12') : null, drop = r && fin(r21) ? r21 - r.latest.value : null
      const yrs = e ? (() => { const [y, m] = e.latest.period.split('-').map(Number); return (y - 2021) + (m - 12) / 12 })() : null
      const eFlow = e && fin(at('ent_mlt_loans', '2021-12')) && yrs > 0 ? (e.latest.value - at('ent_mlt_loans', '2021-12')) / yrs : null
      const hFlow = hl && fin(at('hh_loans', '2021-12')) && yrs > 0 ? (hl.latest.value - at('hh_loans', '2021-12')) / yrs : null
      checks.push({ claim: '~10 trillion yuan a year has shifted from real estate to manufacturing upgrading and tech', ours: `Property development investment ran ¥${f1(r?.latest.value)}tn over the 12 months to ${r?.latest.period || '—'} vs ¥${f1(r21)}tn in 2021: ${fin(drop) ? `¥${f1(drop)}tn a year less` : 'n/a'}. Manufacturing FAI ${mf ? `is ${sgn(mf.chg2021)}% vs 2021 (${mf.latest.period}, chained from NBS growth; no yuan levels published)` : 'n/a'}. Since Dec 2021, medium/long-term enterprise loans grew ${fin(eFlow) ? `¥${f1(eFlow)}tn a year` : 'n/a'} (all industries, incl. infrastructure) vs household loans ${fin(hFlow) ? `${hFlow < 0 ? '−' : '+'}¥${f1(Math.abs(hFlow))}tn a year` : 'n/a'}.`, verdict: !fin(drop) ? 'no data' : drop >= 8 ? 'consistent' : drop >= 4 ? 'partly' : 'not supported', seriesIds: has('re_investment', 'fai_mfg_index', 'ent_mlt_loans', 'hh_loans') })
    }
    { // 7. the objective: upgrading + self-sufficiency
      const items = [['ic_output', '2021'], ['ev_sales', '2021'], ['ev_battery_exports', '2021'], ['rd_spend', '2021'], ['hightech_exports', '2021'], ['ic_imports', '2021']]
        .filter(([id]) => s(id)).map(([id, b]) => ({ id, ch: pct(s(id).latest.value, at(id, b)), p: s(id).latest.period, label: s(id).label }))
      const ups = items.filter(x => ['ic_output', 'ev_sales', 'ev_battery_exports', 'rd_spend'].includes(x.id) && fin(x.ch) && x.ch > 20).length
      const rd = s('rd_gdp'), ht = items.find(x => x.id === 'hightech_exports')
      checks.push({ claim: 'Since ~2021 the objective is mid/high-end manufacturing and technology self-sufficiency', ours: items.length ? `${items.map(x => `${x.label.replace(/ \(.*\)$/, '')} ${sgn(x.ch)}% (2021 → ${x.p})`).join('; ')}${rd ? `; R&D ${f1(rd.latest.value)}% of GDP (${rd.latest.period})` : ''}. ${ups} of 4 upgrading gauges (ICs, EVs, EV + battery exports, R&D) are up more than 20% on 2021${ht && fin(ht.ch) && ht.ch < 0 ? '; World Bank "high-tech exports" (SITC definition, mostly electronics) is the exception' : ''}. Self-sufficiency itself is only proxied (IC imports).` : 'No objective-side series.', verdict: !items.length ? 'no data' : ups >= 3 ? 'consistent' : ups >= 1 ? 'partly' : 'not supported', seriesIds: items.map(x => x.id).concat(rd ? ['rd_gdp'] : []) })
    }
    { // 8. the 2021 divergence
      const mf = s('fai_mfg_index'), re = s('fai_re_index'), hp = s('rpp_bis_nominal') || s('nbs70_new')
      const gap = mf && re ? mf.latest.value - re.latest.value : null
      checks.push({ claim: 'The two sides diverged around 2021: property down, manufacturing up', ours: mf && re ? `Index 2021 = 100 in ${mf.latest.period}: manufacturing FAI ${f1(mf.latest.value)} vs real-estate FAI ${f1(re.latest.value)} (gap ${f0(gap)} points)${hp ? `; home prices peaked ${hp.peak.period}` : ''}.` : 'FAI series unavailable.', verdict: !fin(gap) ? 'no data' : gap >= 25 && mf.latest.value > 100 && re.latest.value < 90 ? 'consistent' : gap > 0 ? 'partly' : 'not supported', seriesIds: has('fai_mfg_index', 'fai_re_index', 'rpp_bis_nominal', 'nbs70_new') })
    }
    return checks
  }

  const STATIC_MISSING = [
    { metric: 'Household balance-sheet composition (housing share of net worth, mortgage loan-to-value)', reason: 'No free time series. The often-quoted ~70% comes from the PBoC’s 2019 urban household survey, a one-off publication.' },
    { metric: 'High-tech manufacturing value-added growth (NBS, monthly)', reason: 'Not in the DBnomics NBS mirror or Eastmoney tables; NBS data.stats.gov.cn returns HTTP 403 (WAF URL ACL) outside China.' },
    { metric: 'Monthly FAI by sector, monthly housing floor area sold, and monthly product output with history', reason: 'DBnomics keeps only a rolling 13-month window of NBS monthly data and stopped at Feb 2026 data; NBS’s own query API is blocked. Annual tables (to 2025) stand in; the monthly window is archived.' },
    { metric: 'Manufacturing fixed-asset investment in yuan', reason: 'NBS has published only growth rates by sector since 2018; the chained index stands in, so the "10 trillion shift" can be measured on the property side only.' },
    { metric: 'NEV, industrial-robot and solar-cell output before 2025 (annual)', reason: 'Not in NBS annual tables on DBnomics; IFR robot statistics are paywalled. EV sales (IEA via OWID) cover the NEV side.' },
    { metric: 'Official national home-price index', reason: 'NBS publishes city indices only; the 70-city figure here is an equal-weight average. Private indices (China Index Academy, Beike) are paywalled.' },
    { metric: 'Monthly "new three" exports (customs)', reason: 'China Customs’ query site is not scriptable; UN Comtrade’s keyless preview allows one period per call, so only annual is pulled.' },
  ]

  async function build(prev) {
    requests = 0
    const ctx = { archive: prev?.archive || {}, patch: {}, warn: [], meta: {} }
    const runs = { bis: blockBis, em70: blockEm70, emCpi: blockCpi, emPpi: blockPpi, emRetail: blockRetail, emConf: blockConf, emIndus: blockIndus, emReInv: blockReInv, emReSales: blockReSales, pbc: blockPbc, dbn: blockDbn, wb: blockWb, owid: blockOwid, comtrade: blockComtrade }
    const names = Object.keys(runs), t0 = Date.now(), took = {}
    const res = await Promise.allSettled(names.map(n => { const t = Date.now(); return runs[n](ctx).finally(() => { took[n] = Math.round((Date.now() - t) / 1000) }) }))
    const prevSeries = new Map((prev?.series || []).map(x => [x.id, x]))
    const series = [], sourceErrors = [], missing = [...STATIC_MISSING]
    res.forEach((r, i) => {
      const n = names[i]
      const got = r.status === 'fulfilled' ? (r.value || []).filter(Boolean) : []
      if (r.status === 'fulfilled' && got.length) { series.push(...got); return }
      const err = r.status === 'rejected' ? scrub(r.reason) : 'no data returned'
      const carry = BLOCKS[n].map(id => prevSeries.get(id)).filter(Boolean)
      sourceErrors.push({ source: n, error: err, carriedForward: carry.length > 0, ...(carry.length ? { from: prev.built } : {}) })
      if (carry.length) series.push(...carry)
      else missing.push({ metric: BLOCK_LABEL[n], reason: `source error: ${err}` })
    })
    for (const w of ctx.warn) sourceErrors.push({ source: 'warning', error: scrub(w), carriedForward: false })
    if (!series.length) throw new Error(`China monitor: every source failed (${sourceErrors.map(e => `${e.source}: ${e.error}`).join('; ').slice(0, 400)})`)
    const order = Object.values(BLOCKS).flat()
    series.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id))
    const S = new Map(series.map(x => [x.id, x]))
    const archive = { ...(prev?.archive || {}), ...ctx.patch }
    const dbnAt = ctx.meta.dbnIndexed ? Object.values(ctx.meta.dbnIndexed).filter(Boolean).sort().at(-1) : null
    const note = [
      'Cost side = housing and household balance sheets; objective side = manufacturing upgrading and tech self-sufficiency; context = prices, GDP, cement, industrial output. Housing prices are indices with 2021 = 100.',
      '70-city prices: NBS gives city indices only; the national line is the equal-weight average of the 70 cities’ month-on-month changes, chain-linked from Dec 2010 (as Reuters computes it). BIS series are BIS’s compilation from NBS data.',
      'NBS publishes many items year-to-date and Jan–Feb combined: real-estate investment is a 12-month rolling sum from YTD levels as first published (NBS’s official y/y uses revised comparable bases, so changes can differ by a few points); monthly sales value is indexed to the same month of 2021 (no Jan/Feb).',
      `NBS annual tables and monthly product output come from DBnomics’ NBS mirror${dbnAt ? ` (last indexed ${dbnAt.slice(0, 10)})` : ''}, whose monthly window is frozen at Feb 2026; FAI by sector is chained from published growth rates because NBS no longer publishes sector levels.`,
      'PBoC figures are RMB + foreign currency, end of month; "mortgage proxy" = household medium/long-term consumer loans. Enterprise medium/long-term loans cover all industries, infrastructure included — a credit-flow proxy, not manufacturing alone.',
      'Eastmoney (data.eastmoney.com) is a commercial mirror of NBS releases, used because NBS’s own API is blocked outside China.',
    ].join(' ')
    const slow = Object.entries(took).filter(([, s]) => s >= 20).map(([n, s]) => `${n} ${s}s`).join(', ')
    console.log(`China monitor: built ${series.length} series with ${requests} requests in ${Math.round((Date.now() - t0) / 1000)}s${slow ? ` (slow: ${slow})` : ''}${sourceErrors.length ? `, ${sourceErrors.length} source note(s)` : ''}`)
    return { built: new Date().toISOString(), stale: false, sourceErrors, series, checks: buildChecks(S), missing, note, archive }
  }

  const view = (d, stale = false) => { const { archive, ...pub } = d; return { ...pub, stale: stale || !!pub.stale } }

  function refresh() {
    if (inflight) return inflight
    inflight = (async () => {
      try { const d = await build(mem); mem = d; save(d); lastFail = 0; return d }
      catch (e) { lastFail = Date.now(); console.warn('China monitor:', scrub(e)); if (mem) return mem; throw e }
      finally { inflight = null }
    })()
    return inflight
  }

  async function get() {
    if (!mem) mem = load()
    // a build with failed sources is retried after 3 hours instead of a day
    const ttl = mem?.sourceErrors?.some(e => e.source !== 'warning') ? 3 * H : TTL
    if (mem?.built && Date.now() - Date.parse(mem.built) < ttl) return view(mem)
    if (mem?.built) {
      if (!inflight && Date.now() - lastFail > RETRY) refresh().catch(() => {})
      return view(mem, true)
    }
    return view(await refresh())
  }

  return { get }
}
