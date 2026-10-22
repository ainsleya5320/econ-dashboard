// ============================================================================
// WORLD ECONOMY — the global economy read as if the world were one country:
// its GDP, growth, inflation and people; its balance sheet (real estate,
// listed equities, bonds, money, central-bank assets, FX reserves, debt by
// sector, household wealth), each also as a multiple of world GDP; its trade
// and industrial production. One feed (/api/world-economy).
//
// Sources (all keyless except FMP; verified Oct 2026, one or two requests each):
//   imf     IMF DataMapper www.imf.org/external/datamapper/api/v1/{IND} for
//           NGDPD, PPPGDP, NGDP_RPCH, PCPIPCH, LP, GGXWDG_NGDP, BCA, BCA_NGDPD,
//           LUR, NGDPDPC (+ /countries, /indicators for names and the vintage):
//           12 requests, ~1.2 MB. Every call returns all economies (the
//           /{IND}/{AREA} filter is ignored). WEOWORLD is the world aggregate
//           (it has no LUR: world unemployment comes from the World Bank).
//           NGSD_NGDP / NID_NGDP (savings, investment) are not on DataMapper;
//           the World Bank's WLD aggregates stand in (actuals only). WEO
//           projections run five years ahead: years from the vintage's year
//           on are flagged projected. curl gets an Akamai 403; Node's fetch
//           gets through; Netlify build machines are refused (hence the seed).
//   wb      World Bank api.worldbank.org/v2/country/WLD/indicator/{a;b;…}
//           ?source=2 (one request, 13 indicators) + country/all CM.MKT.LCAP.CD
//           2000→ (one request, ~1.7 MB, for the market-cap gap fill). As of
//           the 2026-10-08 update: market cap, population, working-age share,
//           unemployment and trade % GDP reach 2025; fertility, life
//           expectancy, broad money % GDP, gross savings and gross capital
//           formation reach 2024. The 2025 WLD trade-to-GDP point (68.5 after
//           56.7) is a partial-coverage artefact and is dropped (TRADE_JUMP).
//           WLD market cap is the sum of REPORTING markets only (it equals the
//           country sum): France, Belgium, Ireland, Portugal stop in 2018, the
//           Netherlands 2017, Norway 2019, the UK 2022, Russia 2023, Israel
//           2024, and Taiwan is never in it — ~$14 tn missing for 2025. A
//           gap-filled total adds each missing market's last value (≤ 10 years
//           old) grown with the reported world total since; Taiwan stays out.
//   tc      BIS stats.bis.org/api/v1/data/WS_TC/Q.5A.H+N+G+C.A.M+N.770+USD.A
//           (total credit to the non-financial sector, "all reporting
//           economies" 5A ≈ 44 economies): % of GDP (770) and USD bn, market
//           value (M; government also at nominal value N). Coverage = implied
//           5A GDP (USD ÷ % of GDP) ÷ IMF world GDP (~91%). The 5A aggregate
//           starts 2008-Q1 for households and corporates, 2001-Q4 for
//           government and the total.
//   spp     BIS WS_SPP Q.XW.N+R.628: world residential property prices (BIS
//           aggregate, PPP-GDP-weighted, local currency), 2010 = 100, from
//           2007-Q4 (so the real-estate series starts in 2007).
//   cbta    BIS WS_CBTA M..B.USD+XDC._Z+USD.B (monthly central-bank total
//           assets in USD bn, 53 areas; the US is published only as XDC/USD)
//           + Q.{big six}.B.XDF_R_B1GQ._Z.B (% of GDP): 2 requests. Most banks
//           reach the month before last; PBoC, Korea, India lag 1–3 months
//           more. XM is the consolidated Eurosystem, so euro-area national
//           central banks are excluded from their joining month on
//           (EURO_JOIN); the other 29 are summed as "others", each carrying
//           its last month up to 12 months.
//   xru     BIS WS_XRU M.{areas}..E: end-of-month local currency per USD, all
//           conversion currencies, one request. Months after its last month
//           use FRED daily rates (DEXUSEU, DEXJPUS, DEXCHUS, DEXUSUK, DEXSZUS,
//           DEXCAUS, DEXUSAL, DEXBZUS; USD-per-unit ones inverted) or, failing
//           that, the last BIS rate (flagged).
//   dss     BIS WS_NA_SEC_DSS Q.N..XW.S1+S11+S12+S13+S1311.S1.N.L.LE.F3.T._Z.USD._T.N+F+M.V.N._T
//           (~1.6 MB): debt securities outstanding by issuer residence, all
//           maturities and currencies, USD bn, ~60 countries + U2. There is no
//           world aggregate (WS_NA_SEC_C3 answers "no data", WS_DEBT_SEC2 does
//           not exist), so the world bond market is the sum of countries (U2
//           dropped to avoid double counting). Per country the valuation with
//           the longest history is used (nominal N, face F or market M); a
//           country with no all-issuer total contributes its sector sum or its
//           government alone (Hong Kong, Saudi Arabia; India central
//           government only, S1311). Korea, Brazil,
//           Mexico and Indonesia enter in 2018, so the series steps up there.
//   cofer   IMF api.imf.org/external/sdmx/2.1/data/IMF.STA,COFER/G001.AFXRA+TFXRA+TFXRA_IMP..NV_USD+SHRO_PT.Q
//           (SDMX-CSV via Accept header, detail=dataonly; keyless, ~1 request).
//           World FX reserves (BPM7: unallocated is now 0, imputed shares
//           ~10%), currency shares of allocated reserves. Excludes gold, SDRs
//           and IMF positions. DBnomics' COFER mirror stops at 2025-Q1.
//   cpb     CPB World Trade Monitor: www.cpb.nl/en/worldtrademonitor/latest
//           redirects to the latest edition page, whose
//           /system/files/cpbmedia/CPB-world-trade-monitor-{month}-{year}.xlsx
//           is the data (2 requests). Sheets trade_out (tgz_w1_qnmi_sn world
//           trade volume SA, tgz_w1_pdmi_sn USD unit values) and inpro_out
//           (ipz_w1_qnmi_sp world industrial production, production-weighted),
//           2021 = 100, monthly from 2000m01; ~2 months' lag.
//   money   Broad money, monthly, local currency, one request each:
//             us  FRED M2SL (via the shared fred(); $bn, SA)
//             ea  ECB data-api.ecb.europa.eu BSI.M.U2.Y.V.M30.X.1.U2.2300.Z01.E (M3, € mn, SA)
//             cn  Eastmoney datacenter-web RPT_ECONOMY_CURRENCY_SUPPLY BASIC_CURRENCY
//                 (PBoC M2, ¥100 mn; Referer data.eastmoney.com; from 2008)
//             jp  BoJ www.stat-search.boj.or.jp/api/v1/getDataCode db=MD02
//                 MAM1NAM3M3MO (M3, monthly AVERAGE outstanding, ¥100 mn, from
//                 2003-04). M3, not M2: it includes Japan Post Bank deposits,
//                 the closer match to euro-area M3.
//             gb  BoE IADB _iadb-fromshowcolumns.asp?csv.x=yes&SeriesCodes=LPMAUYN (M4, £ mn, SA)
//             ch  SNB data.snb.ch/api/cube/snbmonagg/data/csv/en (GM3 level "B", CHF mn)
//             ca  Bank of Canada Valet V41552794 (M3 gross, SA, C$ mn)
//             au  RBA statistics/tables/csv/d3-data.csv DMABMS (broad money SA, A$ bn)
//             br  BCB SGS bcdata.sgs.27810 (M2, R$ thousand; the API times out
//                 now and then; 27791 = M1, 27815 = M4)
//           India and Korea are not covered: no keyless source (RBI has no
//           API, BOK ECOS needs a key, the OECD MEI copies on FRED stop in 2023).
//           Converted at BIS end-of-month FX; coverage = the nine economies'
//           share of IMF world GDP. Measures differ by country (named per row).
//   fredcb  FRED WALCL (Fed, weekly $ mn), ECBASSETSW (Eurosystem, weekly € mn),
//           JPNASSETS (BoJ, monthly ¥100 mn): extend those three banks past
//           BIS's last month; MYAGM2CNM189N (IMF IFS China M2, to 2019) and
//           MABMM301JPM189S (OECD Japan broad money, to 2023) ratio-spliced
//           before Eastmoney (2008) and BoJ M3 (2003-04) start; the DEX* daily
//           rates above. FRED had outages: the shared fred() returns [] then,
//           and the cached block is kept.
//   equity  FMP stable/historical-price-eod/light?symbol=VT (Vanguard Total
//           World, FTSE Global All Cap), Yahoo v8 chart VT as fallback: the
//           world market-cap nowcast = last World Bank year's gap-filled total
//           × VT price now ÷ VT price at that year-end (price, not total return).
//   seed    data/seeds/world-economy.json (tracked): Savills global real-estate
//           totals and UBS / Credit Suisse global wealth totals by year, each
//           with its URL (anchors, hand-entered), plus the last IMF DataMapper
//           and COFER raw blocks (rewritten when a live fetch brings different
//           data) for machines imf.org refuses.
//
// Real estate (an estimate, labelled so): Savills publishes the total value of
// the world's real estate (residential + commercial + agricultural land, USD at
// market rates) for some years. Between and after anchors the value-to-GDP
// ratio moves with world nominal house prices relative to world nominal GDP,
// both in local currency so FX cancels:
//   ratio_t = ratio_A × (HPI_t ÷ HPI_A) ÷ (N_t ÷ N_A),  value_t = ratio_t × GDP_USD_t
// The brief's form uses the nominal index (XW N) and builds N from IMF world
// real growth × (1 + IMF world CPI, PCPIPCH). Flaw found: the IMF world CPI is PPP-weighted
// over all economies (Argentina, Türkiye, Egypt, Nigeria…) and rose 28% over
// 2021–24 against 22% for the CPI implied by BIS's own world index (XW N ÷ XW R),
// so the denominator outgrew the price index and projections came out ~7% low
// on average (backtest MAE 7.4%, worse than a constant ratio's 6.7%). Used instead, the
// same formula with the deflator taken from BIS: real HPI (XW R) ÷ IMF world
// real GDP (MAE 5.1%; 2.9% on anchors from 2021, after Savills re-estimated
// commercial property). The IMF-CPI form stays in the backtest (cpi columns).
// The latest anchor drives the series; the others are checkpoints. Year-end
// stocks are set against the same year's GDP; in-year points against
// trailing-12-month GDP interpolated from the annual figures (gdpTtm).
//
// Cadence: built daily (the market-cap nowcast and money move); slow sources
// are reused from the cache while younger than their own TTL (MAX_AGE), so a
// daily build makes 9 requests (8 money sources + VT), every third day 14
// (+ BIS CBTA ×2, XRU, CPB ×2) and weekly the full 32 (IMF 12, World Bank 2,
// BIS 6, COFER 1, CPB 2, money 8, VT 1), plus 14 FRED series through the
// shared cache (M2SL, WALCL, ECBASSETSW, JPNASSETS, MYAGM2CNM189N,
// MABMM301JPM189S, 8 DEX* rates). Failed requests retry twice (3 s, 6 s). Stale-while-revalidate: an expired copy is served
// at once (stale: true) and rebuilt behind it. A failed source keeps its last
// good raw block (cache, then seed), noted in sourceErrors; get() never throws.
// On load the payload is re-derived from the cached raw blocks, so a code
// change shows without refetching. The FMP key never reaches logs, errors or
// files (scrub). Cache: world-economy.json at the root (payload + raw).
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'

const H = 3600e3, DAY = 24 * H, TTL = DAY, RETRY = 6 * H, RETRY_EMPTY = H / 2
const CACHE = 'world-economy.json', SEED = path.join('data', 'seeds', 'world-economy.json')
const DM = 'https://www.imf.org/external/datamapper/api/v1'
const WBA = 'https://api.worldbank.org/v2/country'
const BIS = 'https://stats.bis.org/api/v1/data'
const IMF_SDMX = 'https://api.imf.org/external/sdmx/2.1/data'
const Y0 = 1980, M0 = '2000-01', Q0 = '2000-Q1', TOP_MEMBERS = 40, TRADE_JUMP = 0.15

// how long a fetched raw block is reused before it is fetched again
const MAX_AGE = { imf: 7 * DAY, wb: 7 * DAY, tc: 7 * DAY, spp: 7 * DAY, dss: 7 * DAY, cofer: 7 * DAY, cbta: 3 * DAY, xru: 3 * DAY, cpb: 3 * DAY }
const DEFAULT_AGE = 20 * H // money, FRED, equity: every daily build

const IMF_IND = ['NGDPD', 'PPPGDP', 'NGDP_RPCH', 'PCPIPCH', 'LP', 'GGXWDG_NGDP', 'BCA', 'BCA_NGDPD', 'LUR', 'NGDPDPC']
const WB_IND = {
  mcap: 'CM.MKT.LCAP.CD', mcapGdp: 'CM.MKT.LCAP.GD.ZS', pop: 'SP.POP.TOTL', work: 'SP.POP.1564.TO.ZS', fert: 'SP.DYN.TFRT.IN', life: 'SP.DYN.LE00.IN',
  unemp: 'SL.UEM.TOTL.ZS', trade: 'NE.TRD.GNFS.ZS', bmoney: 'FM.LBL.BMNY.GD.ZS', saving: 'NY.GNS.ICTR.ZS', invest: 'NE.GDI.TOTL.ZS',
}
// broad money: economy → BIS XRU area/currency, unit divisor to USD/local tn, IMF GDP area
const MONEY = {
  us: { label: 'United States', measure: 'M2', area: null, div: 1e3, gdp: 'USA', src: 'FRED M2SL (Federal Reserve H.6), seasonally adjusted', url: 'https://fred.stlouisfed.org/series/M2SL' },
  ea: { label: 'Euro area', measure: 'M3', area: 'XM', div: 1e6, gdp: 'EURO', src: 'ECB BSI M3 (BSI.M.U2.Y.V.M30.X.1.U2.2300.Z01.E), seasonally adjusted', url: 'https://data.ecb.europa.eu/data/datasets/BSI/BSI.M.U2.Y.V.M30.X.1.U2.2300.Z01.E' },
  cn: { label: 'China', measure: 'M2', area: 'CN', div: 1e4, gdp: 'CHN', src: 'PBoC M2 via Eastmoney (RPT_ECONOMY_CURRENCY_SUPPLY), not seasonally adjusted', url: 'https://data.eastmoney.com/cjsj/hbgyl.html' },
  jp: { label: 'Japan', measure: 'M3', area: 'JP', div: 1e4, gdp: 'JPN', src: 'Bank of Japan money stock M3, average amounts outstanding (MAM1NAM3M3MO)', url: 'https://www.stat-search.boj.or.jp/' },
  gb: { label: 'United Kingdom', measure: 'M4', area: 'GB', div: 1e6, gdp: 'GBR', src: 'Bank of England M4 (LPMAUYN), seasonally adjusted', url: 'https://www.bankofengland.co.uk/boeapps/database/' },
  ch: { label: 'Switzerland', measure: 'M3', area: 'CH', div: 1e6, gdp: 'CHE', src: 'SNB monetary aggregates (snbmonagg GM3)', url: 'https://data.snb.ch/en/topics/snb/cube/snbmonagg' },
  ca: { label: 'Canada', measure: 'M3', area: 'CA', div: 1e6, gdp: 'CAN', src: 'Bank of Canada M3 gross, seasonally adjusted (V41552794)', url: 'https://www.bankofcanada.ca/rates/banking-and-financial-statistics/' },
  au: { label: 'Australia', measure: 'Broad money', area: 'AU', div: 1e3, gdp: 'AUS', src: 'RBA D3 broad money, seasonally adjusted (DMABMS)', url: 'https://www.rba.gov.au/statistics/tables/' },
  br: { label: 'Brazil', measure: 'M2', area: 'BR', div: 1e9, gdp: 'BRA', src: 'Banco Central do Brasil SGS 27810 (M2)', url: 'https://www3.bcb.gov.br/sgspub/' },
}
const XRU_AREAS = { XM: 'EUR', JP: 'JPY', CN: 'CNY', GB: 'GBP', CH: 'CHF', CA: 'CAD', AU: 'AUD', BR: 'BRL' }
// FRED daily FX for months after BIS XRU's last: [series, true when quoted USD per unit (invert)]
const FX_FRED = { XM: ['DEXUSEU', true], JP: ['DEXJPUS', false], CN: ['DEXCHUS', false], GB: ['DEXUSUK', true], CH: ['DEXSZUS', false], CA: ['DEXCAUS', false], AU: ['DEXUSAL', true], BR: ['DEXBZUS', false] }
// history before a primary source starts (China: Eastmoney from 2008; Japan: BoJ M3 from 2003-04): FRED
// series id and divisor to the primary's unit, ratio-spliced at the first overlapping month
const BACKFILL = { cn: ['MYAGM2CNM189N', 1e8], jp: ['MABMM301JPM189S', 1e8] } // IMF IFS China M2 (yuan, to 2019); OECD MEI Japan broad money (yen, to 2023)
const BANKS = { US: ['fed', 'Federal Reserve'], XM: ['ecb', 'Eurosystem (ECB + euro-area central banks)'], JP: ['boj', 'Bank of Japan'], CN: ['pboc', "People's Bank of China"], GB: ['boe', 'Bank of England'], CH: ['snb', 'Swiss National Bank'] }
const EURO_JOIN = { AT: '1999-01', BE: '1999-01', DE: '1999-01', ES: '1999-01', FI: '1999-01', FR: '1999-01', IE: '1999-01', IT: '1999-01', LU: '1999-01', NL: '1999-01', PT: '1999-01', GR: '2001-01', SI: '2007-01', CY: '2008-01', MT: '2008-01', SK: '2009-01', EE: '2011-01', LV: '2014-01', LT: '2015-01', HR: '2023-01', BG: '2026-01' }
const MEASURED_MIN = 0.6, OTHERS_CARRY = 12
const CARRY_M = 3 // a laggard's last month carries into the total for at most this many months
const SHARES = ['USD', 'EUR', 'JPY', 'GBP', 'CNY', 'CAD', 'AUD', 'CHF', 'OTHC']
const NAME_FIX = { CHN: 'China', HKG: 'Hong Kong', KOR: 'Korea', RUS: 'Russia', TUR: 'Türkiye', TWN: 'Taiwan', IRN: 'Iran', EGY: 'Egypt', VNM: 'Vietnam' }
const cleanName = (iso, n) => NAME_FIX[iso] || String(n || iso).trim().replace(/, (Republic of|Kingdom of|Islamic Republic of|Arab Republic of|The|State of)$/, '')

const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 3) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const pct = (a, b) => (fin(a) && fin(b) && b !== 0 ? (a / b - 1) * 100 : null)
const num = v => { if (v == null || v === '' || v === 'NA' || v === 'NaN') return null; const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null }
const mOrd = k => +k.slice(0, 4) * 12 + (+k.slice(5, 7) - 1)
const mKey = o => `${Math.floor(o / 12)}-${String((o % 12) + 1).padStart(2, '0')}`
const qOrd = k => +k.slice(0, 4) * 4 + (+k.slice(6) - 1)
const qKey = o => `${Math.floor(o / 4)}-Q${(o % 4) + 1}`
const isoNow = () => new Date().toISOString()
const yearMap = o => Object.fromEntries(Object.entries(o || {}).filter(([y, v]) => /^\d{4}$/.test(y) && fin(v)).map(([y, v]) => [+y, v]))

// quote-aware CSV → rows
function csvRows(text, sep = ',') {
  const rows = []; let row = [], f = '', q = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++ } else q = false } else f += c }
    else if (c === '"') q = true
    else if (c === sep) { row.push(f); f = '' }
    else if (c === '\n') { row.push(f); rows.push(row); row = []; f = '' }
    else if (c !== '\r') f += c
  }
  if (f || row.length) { row.push(f); rows.push(row) }
  return rows
}
// SDMX CSV → { 'colA|colB': [[period, v]] } sorted by period
function sdmx(text, keyCols, re = /^\d{4}(-\d{2}|-Q[1-4])?$/) {
  const rows = csvRows(text.trim()), h = rows[0] || []
  const iK = keyCols.map(c => h.indexOf(c)), iT = h.indexOf('TIME_PERIOD'), iV = h.indexOf('OBS_VALUE')
  if ([...iK, iT, iV].includes(-1)) throw new Error(`columns changed (${h.slice(0, 8).join(',')})`)
  const out = {}
  for (const c of rows.slice(1)) {
    const v = num(c[iV]), t = c[iT]
    if (!fin(v) || !re.test(t || '')) continue
    ;(out[iK.map(i => c[i]).join('|')] ||= []).push([t, v])
  }
  for (const k in out) out[k].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  return out
}
const lastOf = pts => (pts?.length ? pts[pts.length - 1] : null)

export function createWorldEconomy({ UA, dir, fred, FMP_KEY }) {
  const file = path.join(dir, CACHE), seedFile = path.join(dir, SEED)
  const scrub = s => {
    let t = String(s?.message || s || '')
    if (FMP_KEY) t = t.split(FMP_KEY).join('***')
    return t.replace(/apikey=[^&\s"']+/gi, 'apikey=***').replace(/api_key=[^&\s"']+/gi, 'api_key=***').slice(0, 260)
  }
  const readJson = f => { try { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { console.warn(`world-economy: ${path.basename(f)} unreadable (${e.message})`) } return null }
  const writeText = (f, text) => {
    const tmp = `${f}.tmp-${process.pid}`
    try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(tmp, text); fs.renameSync(tmp, f); return true }
    catch (e) { console.warn(`world-economy: ${path.basename(f)} not written (${e.message})`); try { fs.unlinkSync(tmp) } catch {} return false }
  }
  let mem = null, raw = null, nextAt = 0, inflight = null, requests = 0

  async function fetchText(url, label, { tries = 3, timeout = 90_000, headers = {} } = {}) {
    for (let a = 0; ; a++) {
      requests++
      let r, body
      try {
        r = await fetch(url, { headers: { 'User-Agent': UA, Accept: '*/*', ...headers }, signal: AbortSignal.timeout(timeout), redirect: 'follow' })
        body = r.ok ? await r.text() : null
      } catch (e) { if (a < tries - 1) { await new Promise(res => setTimeout(res, 3000 * 2 ** a)); continue } throw new Error(`${label}: ${scrub(e.cause?.code || e.message)}`) }
      if (r.ok) return { text: body, url: r.url }
      if ((r.status >= 500 || r.status === 429) && a < tries - 1) { await new Promise(res => setTimeout(res, 3000 * 2 ** a)); continue }
      throw new Error(`${label}: HTTP ${r.status}`)
    }
  }
  const fetchJson = async (url, label, opts) => {
    const { text } = await fetchText(url, label, opts)
    try { return JSON.parse(text) } catch { throw new Error(`${label}: not JSON (${scrub(text.slice(0, 60)).replace(/\s+/g, ' ')})`) }
  }
  const F = async (id, limit) => { try { const o = await fred(id, limit); return Array.isArray(o) ? o.filter(p => p && fin(p.v)) : [] } catch { return [] } }
  const block = series => ({ asOf: isoNow(), series })
  const monthly = pts => { const m = new Map(); for (const [d, v] of pts) if (fin(v)) m.set(String(d).slice(0, 7), v); return [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1)) }

  // ── fetchers: each returns a raw block { asOf, … } (full precision, compact) ──
  const fetchers = {
    async imf() {
      const [meta, ctry, ...inds] = await Promise.all([fetchJson(`${DM}/indicators`, 'IMF DataMapper indicators'), fetchJson(`${DM}/countries`, 'IMF DataMapper countries'), ...IMF_IND.map(i => fetchJson(`${DM}/${i}`, `IMF DataMapper ${i}`))])
      const V = Object.fromEntries(IMF_IND.map((i, k) => [i, inds[k]?.values?.[i] || {}]))
      if (!V.NGDPD.WEOWORLD || !V.NGDP_RPCH.WEOWORLD) throw new Error('IMF DataMapper: no WEOWORLD aggregate')
      const labels = ctry?.countries || {}
      const iso = Object.keys(V.NGDPD).filter(k => /^[A-Z]{3}$/.test(k) && labels[k])
      if (iso.length < 150) throw new Error(`IMF DataMapper: only ${iso.length} economies`)
      const world = Object.fromEntries(['NGDPD', 'PPPGDP', 'NGDP_RPCH', 'PCPIPCH', 'LP', 'GGXWDG_NGDP', 'BCA', 'BCA_NGDPD', 'NGDPDPC'].map(i => [i, yearMap(V[i].WEOWORLD)]))
      const bcaSum = {}
      for (const c of iso) for (const [y, v] of Object.entries(yearMap(V.BCA[c]))) bcaSum[y] = (bcaSum[y] || 0) + v
      const vintage = String(meta?.indicators?.NGDPD?.source || '').match(/\(([A-Z][a-z]+ \d{4})\)/)?.[1] || null
      const vy = +String(vintage || '').match(/\d{4}/)?.[0] || new Date().getUTCFullYear()
      // members: the largest economies in the vintage year, plus every economy's GDP (coverage) for that year
      const top = iso.filter(c => fin(V.NGDPD[c]?.[vy])).sort((a, b) => V.NGDPD[b][vy] - V.NGDPD[a][vy]).slice(0, TOP_MEMBERS + 5)
      const pick = (i, c) => Object.fromEntries(Object.entries(yearMap(V[i][c])).filter(([y]) => +y >= vy - 6))
      const members = Object.fromEntries(top.map(c => [c, { name: cleanName(c, labels[c]?.label), ...Object.fromEntries(['NGDPD', 'NGDP_RPCH', 'PCPIPCH', 'LUR', 'GGXWDG_NGDP', 'BCA_NGDPD'].map(i => [i, pick(i, c)])) }]))
      const gdpByArea = Object.fromEntries(Object.values(MONEY).map(m => [m.gdp, yearMap(V.NGDPD[m.gdp])]))
      return { asOf: isoNow(), vintage, lastModified: meta?.indicators?.NGDPD?.['last-modified'] || null, world, bcaSum, members, gdpByArea, iso }
    },
    async wb() {
      const yr = new Date().getUTCFullYear()
      const ids = Object.values(WB_IND).join(';')
      const [w, all] = await Promise.all([
        fetchJson(`${WBA}/WLD/indicator/${ids}?source=2&format=json&per_page=2000&date=1960:${yr}`, 'World Bank WLD'),
        fetchJson(`${WBA}/all/indicator/CM.MKT.LCAP.CD?format=json&per_page=20000&date=2000:${yr}`, 'World Bank market cap', { timeout: 120_000 }),
      ])
      const rows = Array.isArray(w) ? w[1] || [] : []
      if (!rows.length) throw new Error(`World Bank WLD: ${w?.[0]?.message?.[0]?.value || 'no rows'}`)
      const byId = Object.fromEntries(Object.entries(WB_IND).map(([k, id]) => [id, k]))
      const wld = {}
      for (const r of rows) { const k = byId[r.indicator?.id]; if (k && fin(r.value)) (wld[k] ||= {})[+r.date] = r.value }
      const mcap = {}
      for (const r of (Array.isArray(all) ? all[1] : null) || []) { const c = r.countryiso3code; if (/^[A-Z]{3}$/.test(c || '') && fin(r.value)) (mcap[c] ||= {})[+r.date] = rnd(r.value / 1e9, 3) }
      if (!wld.mcap) throw new Error('World Bank: no WLD market cap')
      return { asOf: isoNow(), lastUpdated: w?.[0]?.lastupdated || null, wld, mcap: Object.keys(mcap).length > 50 ? mcap : null }
    },
    async tc() {
      const { text } = await fetchText(`${BIS}/WS_TC/Q.5A.H+N+G+C.A.M+N.770+USD.A?format=csv&detail=dataonly&startPeriod=1995-Q1`, 'BIS WS_TC')
      return block(sdmx(text, ['TC_BORROWERS', 'VALUATION', 'UNIT_TYPE']))
    },
    async spp() {
      const { text } = await fetchText(`${BIS}/WS_SPP/Q.XW.N+R.628?format=csv&detail=dataonly&startPeriod=1995-Q1`, 'BIS WS_SPP')
      return block(sdmx(text, ['REF_AREA', 'VALUE']))
    },
    async cbta() {
      const [m, q] = await Promise.all([
        fetchText(`${BIS}/WS_CBTA/M..B.USD+XDC._Z+USD.B?format=csv&detail=dataonly&startPeriod=1999-01`, 'BIS WS_CBTA monthly'),
        fetchText(`${BIS}/WS_CBTA/Q.${Object.keys(BANKS).join('+')}.B.XDF_R_B1GQ._Z.B?format=csv&detail=dataonly&startPeriod=2015-Q1`, 'BIS WS_CBTA % of GDP'),
      ])
      const usd = {}
      for (const [k, pts] of Object.entries(sdmx(m.text, ['REF_AREA', 'UNIT_MEASURE', 'CURRENCY']))) {
        const [area, unit, cur] = k.split('|')
        if ((unit === 'USD' && cur === '_Z') || (area === 'US' && unit === 'XDC' && cur === 'USD')) usd[area] = pts
      }
      const gdp = Object.fromEntries(Object.entries(sdmx(q.text, ['REF_AREA'])).map(([k, v]) => [k, v.slice(-8)]))
      return { asOf: isoNow(), usd, gdp }
    },
    async xru() {
      const { text } = await fetchText(`${BIS}/WS_XRU/M.${Object.keys(XRU_AREAS).join('+')}..E?format=csv&detail=dataonly&startPeriod=1999-01`, 'BIS WS_XRU')
      return block(Object.fromEntries(Object.entries(sdmx(text, ['REF_AREA'])).map(([k, v]) => [k, v])))
    },
    async dss() {
      const { text } = await fetchText(`${BIS}/WS_NA_SEC_DSS/Q.N..XW.S1+S11+S12+S13+S1311.S1.N.L.LE.F3.T._Z.USD._T.N+F+M.V.N._T?format=csv&detail=dataonly&startPeriod=${Q0}`, 'BIS WS_NA_SEC_DSS', { timeout: 150_000 })
      const s = sdmx(text, ['REF_AREA', 'REF_SECTOR', 'VALUATION'])
      if (Object.keys(s).length < 50) throw new Error(`BIS WS_NA_SEC_DSS: only ${Object.keys(s).length} series`)
      return block(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.map(([q, x]) => [q, rnd(x, 1)])])))
    },
    async cofer() {
      const { text } = await fetchText(`${IMF_SDMX}/IMF.STA,COFER/G001.AFXRA+TFXRA+TFXRA_IMP..NV_USD+SHRO_PT.Q?startPeriod=1999-Q1&detail=dataonly`, 'IMF COFER', { headers: { Accept: 'application/vnd.sdmx.data+csv;version=1.0.0' } })
      const s = sdmx(text, ['INDICATOR', 'FXR_CURRENCY', 'TYPE_OF_TRANSFORMATION'])
      if (!s['TFXRA|CI_T|NV_USD']?.length) throw new Error('IMF COFER: no world total (TFXRA)')
      // USD to the million, shares to 3 decimals (keeps the seed small)
      return block(Object.fromEntries(Object.entries(s).map(([k, pts]) => [k, pts.map(([q, v]) => [q, k.endsWith('NV_USD') ? Math.round(v / 1e6) * 1e6 : rnd(v, 3)])])))
    },
    async cpb() {
      const page = await fetchText('https://www.cpb.nl/en/worldtrademonitor/latest', 'CPB WTM page', { timeout: 45_000 })
      const href = page.text.match(/href="([^"]*CPB-world-trade-monitor-[a-z]+-\d{4}\.xlsx)"/i)?.[1]
      if (!href) throw new Error('CPB WTM: no xlsx link on the latest-edition page')
      const xurl = new URL(href, 'https://www.cpb.nl').href
      requests++
      const r = await fetch(xurl, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(90_000) })
      if (!r.ok) throw new Error(`CPB WTM xlsx: HTTP ${r.status}`)
      const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' })
      const read = (sheet, code) => {
        const ws = wb.Sheets[sheet]; if (!ws) throw new Error(`CPB WTM: no sheet ${sheet}`)
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
        const hr = rows.find(rw => rw.some(c => /^\d{4}m\d{2}$/.test(String(c ?? ''))))
        const row = rows.find(rw => String(rw[1] ?? '').trim() === code)
        if (!hr || !row) throw new Error(`CPB WTM: ${code} not found`)
        const out = []
        hr.forEach((c, i) => { const m = String(c ?? '').match(/^(\d{4})m(\d{2})$/); if (m && fin(num(row[i]))) out.push([`${m[1]}-${m[2]}`, num(row[i])]) })
        return out
      }
      const volume = read('trade_out', 'tgz_w1_qnmi_sn'), production = read('inpro_out', 'ipz_w1_qnmi_sp'), prices = read('trade_out', 'tgz_w1_pdmi_sn')
      if (volume.length < 100) throw new Error(`CPB WTM: only ${volume.length} months`)
      return { asOf: isoNow(), edition: xurl.split('/').pop(), page: page.url, series: { volume, production, prices } }
    },
    // ── broad money ──
    async m_us() {
      const obs = await F('M2SL', 360)
      if (!obs.length) throw new Error('FRED M2SL: no observations (FRED outage?)')
      return block(monthly(obs.map(o => [o.d, o.v])))
    },
    async m_ea() {
      const { text } = await fetchText('https://data-api.ecb.europa.eu/service/data/BSI/M.U2.Y.V.M30.X.1.U2.2300.Z01.E?format=csvdata&detail=dataonly&startPeriod=1999-01', 'ECB M3')
      return block(sdmx(text, ['REF_AREA'])['U2'] || [])
    },
    async m_cn() {
      const q = new URLSearchParams({ reportName: 'RPT_ECONOMY_CURRENCY_SUPPLY', columns: 'REPORT_DATE,BASIC_CURRENCY', sortColumns: 'REPORT_DATE', sortTypes: '-1', pageNumber: '1', pageSize: '500', source: 'WEB', client: 'WEB' })
      const j = await fetchJson(`https://datacenter-web.eastmoney.com/api/data/v1/get?${q}`, 'Eastmoney China M2', { headers: { Referer: 'https://data.eastmoney.com/' } })
      if (!j?.success || !j.result?.data?.length) throw new Error(`Eastmoney China M2: ${j?.message || 'no rows'}`)
      return block(monthly(j.result.data.map(d => [String(d.REPORT_DATE).slice(0, 7), num(d.BASIC_CURRENCY)])))
    },
    async m_jp() {
      const j = await fetchJson('https://www.stat-search.boj.or.jp/api/v1/getDataCode?format=json&lang=en&db=MD02&code=MAM1NAM3M3MO&startDate=199901', 'BoJ M3')
      const v = j?.RESULTSET?.[0]?.VALUES
      if (!v?.SURVEY_DATES?.length) throw new Error(`BoJ M3: ${j?.MESSAGE || 'no values'}`)
      return block(v.SURVEY_DATES.map((d, i) => [`${String(d).slice(0, 4)}-${String(d).slice(4, 6)}`, num(v.VALUES[i])]).filter(p => fin(p[1])))
    },
    async m_gb() {
      const { text } = await fetchText('https://www.bankofengland.co.uk/boeapps/database/_iadb-fromshowcolumns.asp?csv.x=yes&Datefrom=01/Jan/1999&Dateto=now&SeriesCodes=LPMAUYN&CSVF=TN&UsingCodes=Y&VPD=Y&VFD=N', 'BoE M4')
      const MON = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' }
      const pts = csvRows(text.trim()).slice(1).map(([d, v]) => { const m = String(d).match(/^\d{1,2} ([A-Z][a-z]{2}) (\d{4})$/); return m ? [`${m[2]}-${MON[m[1]]}`, num(v)] : null }).filter(p => p && fin(p[1]))
      if (!pts.length) throw new Error(`BoE M4: unexpected CSV (${scrub(text.slice(0, 40))})`)
      return block(pts)
    },
    async m_ch() {
      const { text } = await fetchText('https://data.snb.ch/api/cube/snbmonagg/data/csv/en', 'SNB M3')
      const pts = csvRows(text, ';').filter(r => r[1] === 'B' && r[2] === 'GM3' && /^\d{4}-\d{2}$/.test(r[0])).map(r => [r[0], num(r[3])]).filter(p => fin(p[1]) && p[0] >= '1999-01')
      if (!pts.length) throw new Error('SNB M3: no GM3 rows')
      return block(pts)
    },
    async m_ca() {
      const j = await fetchJson('https://www.bankofcanada.ca/valet/observations/V41552794/json?start_date=1999-01-01', 'Bank of Canada M3')
      const pts = (j?.observations || []).map(o => [String(o.d).slice(0, 7), num(o.V41552794?.v)]).filter(p => fin(p[1]))
      if (!pts.length) throw new Error('Bank of Canada M3: no observations')
      return block(pts)
    },
    async m_au() {
      const { text } = await fetchText('https://www.rba.gov.au/statistics/tables/csv/d3-data.csv', 'RBA D3')
      const rows = csvRows(text.replace(/^﻿/, ''))
      const ids = rows.find(r => r[0] === 'Series ID'), col = ids ? ids.indexOf('DMABMS') : -1
      if (col < 0) throw new Error('RBA D3: no DMABMS column')
      const pts = rows.map(r => { const m = String(r[0]).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? [`${m[3]}-${m[2]}`, num(r[col])] : null }).filter(p => p && fin(p[1]) && p[0] >= '1999-01')
      return block(pts)
    },
    async m_br() {
      const j = await fetchJson('https://api.bcb.gov.br/dados/serie/bcdata.sgs.27810/dados?formato=json&dataInicial=01/01/1999', 'BCB M2', { timeout: 60_000 })
      const pts = (Array.isArray(j) ? j : []).map(o => { const m = String(o.data).match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? [`${m[3]}-${m[2]}`, num(o.valor)] : null }).filter(p => p && fin(p[1]))
      if (!pts.length) throw new Error('BCB M2: no observations')
      return block(pts)
    },
    // ── FRED: central-bank extension + daily FX past BIS XRU ──
    async fredcb() {
      const [walcl, ecb, boj, cnM2, jpM3, ...fx] = await Promise.all([F('WALCL', 160), F('ECBASSETSW', 160), F('JPNASSETS', 40), F(BACKFILL.cn[0], 330), F(BACKFILL.jp[0], 330), ...Object.values(FX_FRED).map(([id]) => F(id, 90))])
      if (!walcl.length && !ecb.length && !boj.length) throw new Error('FRED WALCL / ECBASSETSW / JPNASSETS: no observations (FRED outage?)')
      const fxd = Object.fromEntries(Object.entries(FX_FRED).map(([area, [, inv]], i) => [area, fx[i].map(o => [o.d, inv ? 1 / o.v : o.v])]))
      const back = (obs, div) => monthly(obs.map(o => [o.d, o.v / div])).filter(p => p[0] >= '1999-01')
      return { asOf: isoNow(), walcl: walcl.map(o => [o.d, o.v]), ecb: ecb.map(o => [o.d, o.v]), boj: boj.map(o => [o.d, o.v]), fx: fxd, back: { cn: back(cnM2, BACKFILL.cn[1]), jp: back(jpM3, BACKFILL.jp[1]) } }
    },
    async equity() {
      const from = `${new Date().getUTCFullYear() - 2}-12-01`
      let pts = [], via = null, err = null
      if (FMP_KEY) {
        try {
          const j = await fetchJson(`https://financialmodelingprep.com/stable/historical-price-eod/light?symbol=VT&from=${from}&apikey=${FMP_KEY}`, 'FMP VT')
          pts = (Array.isArray(j) ? j : []).map(r => [String(r.date).slice(0, 10), num(r.price ?? r.close)]).filter(p => fin(p[1]))
          via = 'FMP'
        } catch (e) { err = scrub(e) }
      }
      if (pts.length < 100) {
        const j = await fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/VT?range=5y&interval=1d', 'Yahoo VT')
        const r = j?.chart?.result?.[0], ts = r?.timestamp || [], cl = r?.indicators?.quote?.[0]?.close || []
        pts = ts.map((t, i) => [new Date(t * 1000).toISOString().slice(0, 10), cl[i]]).filter(p => fin(p[1]) && p[0] >= from)
        via = `Yahoo${err ? ` (FMP failed: ${err})` : ''}`
      }
      if (pts.length < 100) throw new Error(`VT prices: only ${pts.length} days`)
      pts.sort((a, b) => (a[0] < b[0] ? -1 : 1))
      return { asOf: isoNow(), symbol: 'VT', via, series: pts.map(([d, v]) => [d, rnd(v, 3)]) }
    },
  }
  const LABEL = {
    imf: 'IMF World Economic Outlook (DataMapper)', wb: 'World Bank WDI (world aggregates, market cap)', tc: 'BIS total credit (all reporting economies)', spp: 'BIS residential property prices (world)',
    cbta: 'BIS central bank total assets', xru: 'BIS US dollar exchange rates', dss: 'BIS debt securities statistics', cofer: 'IMF COFER (FX reserves)', cpb: 'CPB World Trade Monitor',
    fredcb: 'FRED central-bank balance sheets + daily FX', equity: 'VT world equity ETF price (FMP / Yahoo)',
    ...Object.fromEntries(Object.entries(MONEY).map(([k, m]) => [`m_${k}`, `${m.label} ${m.measure} (${m.src.split(' (')[0]})`])),
  }
  const PAGE = {
    imf: 'https://www.imf.org/external/datamapper/', wb: 'https://data.worldbank.org/region/world', tc: 'https://data.bis.org/topics/TOTAL_CREDIT', spp: 'https://data.bis.org/topics/RPP',
    cbta: 'https://data.bis.org/topics/CBTA', xru: 'https://data.bis.org/topics/XRU', dss: 'https://data.bis.org/topics/DSS', cofer: 'https://data.imf.org/en/datasets/IMF.STA:COFER',
    cpb: 'https://www.cpb.nl/en/worldtrademonitor', fredcb: 'https://fred.stlouisfed.org/series/WALCL', equity: 'https://investor.vanguard.com/investment-products/etfs/profile/vt',
    ...Object.fromEntries(Object.entries(MONEY).map(([k, m]) => [`m_${k}`, m.url])),
  }
  const SEEDED = ['imf', 'cofer'] // raw blocks kept in the tracked seed (IMF hosts refuse some build machines)

  // ── derive ────────────────────────────────────────────────────────────────
  function derive(R, meta) {
    const seed = meta.seed || readJson(seedFile) || {}
    const I = R.imf, W = R.wb?.wld || {}
    const vy = +String(I?.vintage || '').match(/\d{4}/)?.[0] || new Date().getUTCFullYear() // projections start here
    const gdpY = I?.world?.NGDPD || {} // USD bn by year
    const tn = v => (fin(v) ? v / 1e3 : null)
    // trailing-12-month world GDP (USD tn) at the end of a period: year / 'YYYY-MM' / 'YYYY-Qn'
    const gdpTtm = p => {
      const s = String(p), y = +s.slice(0, 4)
      const m = /^\d{4}$/.test(s) ? 12 : /-Q/.test(s) ? 3 * +s.slice(6) : +s.slice(5, 7)
      const a = gdpY[y - 1], b = gdpY[y]
      if (m === 12) return tn(b)
      return fin(a) && fin(b) ? tn((a * (12 - m)) / 12 + (b * m) / 12) : tn(b)
    }
    const mult = (usdTn, p) => { const g = gdpTtm(p); return fin(usdTn) && fin(g) && g > 0 ? rnd(usdTn / g, 3) : null }
    const proj = y => +y >= vy
    const yrs = o => Object.keys(o || {}).map(Number).sort((a, b) => a - b)
    const ser = (o, d = 2, from = Y0, flag = true) => yrs(o).filter(y => y >= from).map(y => (flag ? [y, rnd(o[y], d), proj(y)] : [y, rnd(o[y], d)]))
    const notes = []

    // ── headline ──
    const at = (o, y) => (fin(o?.[y]) ? o[y] : null)
    const lastActual = o => yrs(o).filter(y => y < vy).at(-1)
    const hv = (o, d, scale = 1) => (I ? { v: rnd(at(o, vy) != null ? at(o, vy) * scale : null, d), year: vy, projected: true, lastActual: lastActual(o) != null ? { v: rnd(o[lastActual(o)] * scale, d), year: lastActual(o) } : null } : null)
    const wbPop = W.pop || {}, wbPopLast = yrs(wbPop).at(-1)
    const headline = I ? {
      gdpUsd: hv(I.world.NGDPD, 2, 1e-3), gdpPpp: hv(I.world.PPPGDP, 2, 1e-3),
      growth: { ...hv(I.world.NGDP_RPCH, 2), series: ser(I.world.NGDP_RPCH, 2) },
      inflation: { ...hv(I.world.PCPIPCH, 2), series: ser(I.world.PCPIPCH, 2) },
      population: wbPopLast ? { v: rnd(wbPop[wbPopLast] / 1e9, 3), year: wbPopLast, projected: false, series: ser(wbPop, 3, 1960, false).map(([y, v]) => [y, rnd(v / 1e9, 3)]), imf: { v: rnd(at(I.world.LP, vy) / 1e3, 3), year: vy, note: 'IMF WEO population covers WEO economies only, ~0.16 bn below the UN/World Bank world total' } } : { ...hv(I.world.LP, 3, 1e-3), series: ser(I.world.LP, 3).map(([y, v, p]) => [y, rnd(v / 1e3, 3), p]) },
      gdpPerCapita: { v: rnd(at(I.world.NGDPDPC, vy), 0), year: vy, projected: true, ppp: rnd(at(I.world.PPPGDP, vy) / at(I.world.LP, vy) * 1e3, 0) },
      govDebt: { ...hv(I.world.GGXWDG_NGDP, 1), series: ser(I.world.GGXWDG_NGDP, 1, 2001) },
      vintage: I.vintage ? `World Economic Outlook (${I.vintage})` : null, projFrom: vy,
    } : null

    // ── FX: end-of-month local per USD (BIS), FRED daily past BIS's last month, else last BIS rate ──
    const xru = R.xru?.series || {}
    const fxLast = {}
    for (const a of Object.keys(XRU_AREAS)) fxLast[a] = lastOf(xru[a])
    const fredFx = R.fredcb?.fx || {}
    const fxCarried = new Set()
    const fxMap = Object.fromEntries(Object.keys(XRU_AREAS).map(a => [a, new Map(xru[a] || [])]))
    const fxAt = (area, month) => {
      if (!area) return 1
      const v = fxMap[area]?.get(month)
      if (fin(v)) return v
      const l = fxLast[area]
      if (!l || month < l[0]) return null
      const f = (fredFx[area] || []).filter(([d]) => d.slice(0, 7) === month).at(-1)
      if (f && fin(f[1])) return f[1]
      fxCarried.add(`${area} ${month}`); return l[1]
    }

    // ── broad money ──
    const ecoSeries = {}, byEconomy = [], missing = []
    for (const [id, m] of Object.entries(MONEY)) {
      let pts = R[`m_${id}`]?.series || [], spliced = null
      if (!pts.length) { missing.push(m.label); continue }
      const bk = R.fredcb?.back?.[id]
      if (bk?.length && pts[0][0] > '1999-01') {
        const first = pts[0][0], ov = bk.find(p => p[0] === first)
        if (ov && ov[1] > 0) { const k = pts[0][1] / ov[1]; pts = [...bk.filter(p => p[0] < first).map(([p, v]) => [p, v * k]), ...pts]; spliced = { before: first, source: `FRED ${BACKFILL[id][0]}`, factor: rnd(k, 4) } }
      }
      const usd = pts.filter(([p]) => p >= '1999-01').map(([p, v]) => { const fx = fxAt(m.area, p); return [p, fin(fx) ? v / m.div / fx : null, v / m.div] }).filter(p => fin(p[1]))
      ecoSeries[id] = usd
      const l = lastOf(usd), yAgo = usd.find(p => p[0] === mKey(mOrd(l[0]) - 12))
      byEconomy.push({ id, label: m.label, measure: m.measure, usdTn: rnd(l[1], 3), localTn: rnd(l[2], 3), yoyLocal: rnd(pct(l[2], yAgo?.[2]), 1), yoyUsd: rnd(pct(l[1], yAgo?.[1]), 1), asOf: l[0], from: usd[0][0], spliced, source: m.src, url: m.url })
    }
    byEconomy.sort((a, b) => b.usdTn - a.usdTn)
    // total for a month: every covered economy (from its first month) present or carried ≤ CARRY_M months
    // (in local currency, at that month's FX)
    const totalAt = (series, ids, month, convert) => {
      let s = 0, measured = 0; const carried = []
      for (const id of ids) {
        const pts = series[id]; let hit = null, k = 0
        if (pts.first && month < pts.first) continue
        for (; k <= CARRY_M; k++) { const want = mKey(mOrd(month) - k); const p = pts.idx.get(want); if (p) { hit = p; if (k) carried.push(`${id} ${want}`); break } }
        if (!hit) return null
        const v = convert ? convert(id, hit, month) : hit[1]
        s += v; if (!k) measured += v
      }
      return { v: s, carried, measured }
    }
    // a total ends at the last month where at least MEASURED_MIN of its value is reported for that month (not carried)
    const trimCarried = series => { while (series.length && series.at(-1)[4] < MEASURED_MIN) series.pop(); return series }
    let broad = null
    const ecoIds = Object.keys(ecoSeries)
    if (ecoIds.length) {
      const S = Object.fromEntries(ecoIds.map(id => [id, { idx: new Map(ecoSeries[id].map(p => [p[0], p])), first: ecoSeries[id][0][0] }]))
      const conv = (id, p, month) => { const fx = fxAt(MONEY[id].area, month); return fin(fx) ? p[2] / fx : p[1] }
      const lastM = ecoIds.map(id => lastOf(ecoSeries[id])[0]).sort().at(-1)
      const firstM = ecoIds.map(id => ecoSeries[id][0][0]).sort()[0]
      const series = []
      for (let o = Math.max(mOrd(firstM), mOrd(M0)); o <= mOrd(lastM); o++) { const t = totalAt(S, ecoIds, mKey(o), conv); if (t) series.push([mKey(o), t.v, t.carried, null, t.v ? t.measured / t.v : 0]) }
      trimCarried(series)
      const l = lastOf(series)
      if (l) {
        const yk = mKey(mOrd(l[0]) - 12)
        // constant-FX growth: both years' local stocks at today's FX
        const constFx = (month, fxMonth) => { let s = 0; for (const id of ecoIds) { const p = S[id].idx.get(month) || [...S[id].idx.values()].filter(x => x[0] <= month).at(-1); const fx = fxAt(MONEY[id].area, fxMonth); if (!p || !fin(fx)) return null; s += p[2] / fx } return s }
        const covered = ecoIds.map(id => MONEY[id].gdp), cg = covered.reduce((s, a) => s + (I?.gdpByArea?.[a]?.[vy] || 0), 0)
        broad = {
          asOf: l[0], usdTn: rnd(l[1], 3), gdpMultiple: mult(l[1], l[0]),
          yoyUsd: rnd(pct(l[1], series.find(p => p[0] === yk)?.[1]), 1),
          yoyLocal: rnd(pct(constFx(l[0], l[0]), constFx(yk, l[0])), 1),
          coverage: fin(gdpY[vy]) && cg ? rnd((cg / gdpY[vy]) * 100, 1) : null, coverageYear: vy,
          carried: l[2], fxCarried: [...fxCarried].filter(x => x.endsWith(l[0])),
          byEconomy, missing,
          series: series.map(([p, v]) => [p, rnd(v, 3)]),
          seriesByEconomy: Object.fromEntries(ecoIds.map(id => [id, ecoSeries[id].filter(p => p[0] >= M0).map(p => [p[0], rnd(p[1], 3)])])),
          annualPctGdp: ser(W.bmoney, 1, 1960, false),
          note: 'Sum of the largest economies\' broadest commonly published aggregate (measure named per economy: US M2, euro-area M3, China M2, Japan M3, UK M4, Swiss M3, Canada M3, Australia broad money, Brazil M2), local currency converted at end-of-month USD rates (BIS). Japan is a monthly average. China before 2008 and Japan before 2003-04 are FRED series (IMF IFS China M2; OECD Japan broad money) ratio-spliced onto the primary source at its first month (byEconomy.spliced); Brazil enters the total in 2001-08. India and Korea are not covered (no keyless source). yoyLocal holds exchange rates at the latest month (local-currency growth, weighted by today\'s dollar values); yoyUsd includes currency moves. annualPctGdp is the World Bank world aggregate of broad money % GDP (all reporting economies, annual).',
        }
      }
    }

    // ── central banks ──
    let centralBanks = null
    const cb = R.cbta?.usd || {}
    if (Object.keys(cb).length) {
      const isEuroMember = (a, month) => EURO_JOIN[a] && month >= EURO_JOIN[a]
      // FRED extension (local → USD at that month's FX) after BIS's last month
      const ext = { US: [R.fredcb?.walcl, 1e6, null], XM: [R.fredcb?.ecb, 1e6, 'XM'], JP: [R.fredcb?.boj, 1e4, 'JP'] } // $ mn, € mn, ¥100 mn → tn
      const bankPts = {}
      for (const a of Object.keys(BANKS)) {
        const pts = (cb[a] || []).map(([p, v]) => [p, v / 1e3, 'BIS']) // USD bn → tn
        const last = lastOf(pts)?.[0] || '0000-00'
        const e = ext[a]
        if (e?.[0]?.length) for (const [p, v] of monthly(e[0])) { if (p <= last) continue; const fx = fxAt(e[2], p); if (fin(fx)) pts.push([p, v / e[1] / fx, 'FRED']) }
        if (pts.length) bankPts[a] = pts
      }
      const fredLastDay = { US: lastOf(R.fredcb?.walcl)?.[0], XM: lastOf(R.fredcb?.ecb)?.[0], JP: lastOf(R.fredcb?.boj)?.[0] }
      // other reporting central banks (euro members excluded from their joining month)
      const others = Object.keys(cb).filter(a => !BANKS[a] && a !== 'XM')
      const othersIdx = Object.fromEntries(others.map(a => [a, new Map(cb[a].map(([p, v]) => [p, v / 1e3]))]))
      // slow reporters carry their last month up to OTHERS_CARRY months, so a total does not dip when one is late
      const othersAt = month => {
        let s = 0, n = 0, carried = 0, oldest = null
        for (const a of others) {
          if (isEuroMember(a, month)) continue
          for (let k = 0; k <= OTHERS_CARRY; k++) { const mk = mKey(mOrd(month) - k), v = othersIdx[a].get(mk); if (fin(v)) { s += v; n++; if (k) { carried++; if (!oldest || mk < oldest) oldest = mk } break } }
        }
        return { v: s, n, carried, oldest }
      }
      const S = Object.fromEntries(Object.entries(bankPts).map(([a, pts]) => [a, { idx: new Map(pts.map(p => [p[0], p])) }]))
      const ids = Object.keys(S)
      const lastM = ids.map(a => lastOf(bankPts[a])[0]).sort().at(-1)
      const series = [], seriesByBank = Object.fromEntries(ids.map(a => [BANKS[a][0], []]).concat([['others', []]]))
      for (let o = mOrd(M0); o <= mOrd(lastM); o++) {
        const mk = mKey(o), t = totalAt(S, ids, mk)
        if (!t) continue
        const ot = othersAt(mk)
        series.push([mk, t.v + ot.v, t.carried, ot.n, t.v ? t.measured / t.v : 0]) // others are left out of the measured share
      }
      trimCarried(series)
      for (const a of ids) seriesByBank[BANKS[a][0]] = bankPts[a].filter(p => p[0] >= M0).map(p => [p[0], rnd(p[1], 3)])
      seriesByBank.others = series.map(([mk]) => [mk, rnd(othersAt(mk).v, 3)])
      const l = lastOf(series)
      const gdpQ = R.cbta?.gdp || {}
      const banks = ids.map(a => { const p = lastOf(bankPts[a]), g = lastOf(gdpQ[a]); return { id: BANKS[a][0], label: BANKS[a][1], usdTn: rnd(p[1], 3), asOf: p[0], source: p[2] === 'FRED' ? `FRED (${a === 'US' ? 'WALCL' : a === 'XM' ? 'ECBASSETSW' : 'JPNASSETS'}, ${fredLastDay[a]})` : 'BIS WS_CBTA', pctGdpLocal: g ? rnd(g[1], 1) : null, pctGdpAsOf: g?.[0] || null } }).sort((x, y) => y.usdTn - x.usdTn)
      if (l) {
        const ot = othersAt(l[0])
        banks.push({ id: 'others', label: `Other reporting central banks (${ot.n})`, usdTn: rnd(ot.v, 3), asOf: l[0], source: `BIS WS_CBTA (each bank's latest month within ${OTHERS_CARRY} months; euro-area national central banks excluded, they are in the Eurosystem)`, n: ot.n, carriedN: ot.carried, oldest: ot.oldest })
        centralBanks = {
          asOf: l[0], usdTn: rnd(l[1], 3), pctGdp: rnd((l[1] / gdpTtm(l[0])) * 100, 1), gdpMultiple: mult(l[1], l[0]), carried: l[2], banks,
          series: series.map(([p, v]) => [p, rnd(v, 3)]), seriesByBank,
          note: `Central-bank total assets in USD: BIS WS_CBTA monthly (USD at BIS's conversion), the Fed, Eurosystem and BoJ extended past BIS's last month with FRED (WALCL weekly / ECBASSETSW weekly / JPNASSETS monthly, last observation of each month, converted at end-of-month FX). A big-six bank not yet reported for the latest month carries its last month (at most ${CARRY_M}; carried lists them); the ~29 other reporting central banks report slowly and carry up to ${OTHERS_CARRY} months (banks[others].oldest). pctGdpLocal is BIS's own % of the country's GDP.`,
        }
      }
    }

    // ── reserves (COFER) ──
    let reserves = null
    const C = R.cofer?.series || {}
    if (C['TFXRA|CI_T|NV_USD']?.length) {
      const tot = C['TFXRA|CI_T|NV_USD'], l = lastOf(tot)
      const sh = cur => C[`AFXRA|CI_${cur}|SHRO_PT`] || []
      reserves = {
        asOf: l[0], usdTn: rnd(l[1] / 1e12, 3), gdpMultiple: mult(l[1] / 1e12, l[0]),
        allocatedUsdTn: rnd(lastOf(C['AFXRA|CI_T|NV_USD'])?.[1] / 1e12, 3),
        shares: SHARES.map(c => ({ currency: c === 'OTHC' ? 'Other' : c, share: rnd(lastOf(sh(c))?.[1], 2), asOf: lastOf(sh(c))?.[0] || null })).filter(s => fin(s.share)),
        series: tot.filter(p => p[0] >= Q0).map(([q, v]) => [q, rnd(v / 1e12, 3)]),
        shareSeries: Object.fromEntries(SHARES.map(c => [c === 'OTHC' ? 'Other' : c, sh(c).filter(p => p[0] >= Q0).map(([q, v]) => [q, rnd(v, 2)])]).filter(([, v]) => v.length)),
        imputedShare: rnd(lastOf(C['TFXRA_IMP|CI_T|SHRO_PT'])?.[1], 1),
        note: 'IMF COFER: official foreign-exchange reserves of all reporting countries (gold, SDRs and IMF reserve positions excluded). Shares are of allocated reserves; since the BPM7 revision the IMF imputes the currency split for non-reporters (imputedShare % of the total).',
      }
    }

    // ── debt (BIS total credit, all reporting economies) ──
    let debt = null
    const T = R.tc?.series || {}
    if (Object.keys(T).length) {
      const SEC = [['households', 'H', 'Households & NPISHs'], ['corporates', 'N', 'Non-financial corporations'], ['government', 'G', 'General government'], ['total', 'C', 'Total non-financial sector']]
      const sectors = SEC.map(([id, code, label]) => {
        const p = T[`${code}|M|770`] || [], u = T[`${code}|M|USD`] || [], l = lastOf(p), lu = lastOf(u)
        if (!l) return null
        const out = { id, label, pctGdp: rnd(l[1], 1), usdTn: rnd(lu?.[1] / 1e3, 3), asOf: l[0], series: p.filter(x => x[0] >= Q0).map(([q, v]) => [q, rnd(v, 1)]), usdSeries: u.filter(x => x[0] >= Q0).map(([q, v]) => [q, rnd(v / 1e3, 2)]) }
        if (code === 'G') { const n = lastOf(T['G|N|770']), nu = lastOf(T['G|N|USD']); if (n) out.nominal = { pctGdp: rnd(n[1], 1), usdTn: rnd(nu?.[1] / 1e3, 3), asOf: n[0] } }
        return out
      }).filter(Boolean)
      const tot = sectors.find(s => s.id === 'total')
      const implied = tot && tot.pctGdp ? tot.usdTn / (tot.pctGdp / 100) : null
      debt = {
        asOf: tot?.asOf || sectors[0]?.asOf, coverage: implied && gdpTtm(tot.asOf) ? rnd((implied / gdpTtm(tot.asOf)) * 100, 1) : null,
        sectors,
        note: 'BIS total credit to the non-financial sector for "all reporting economies" (5A, ~44 economies), loans and debt securities from all lenders, market value; % of their combined GDP and USD at market rates. coverage = their implied GDP ÷ IMF world GDP. Government is also given at nominal value (BIS\'s preferred government measure). IMF WEO world gross government debt (headline.govDebt) is the all-country check.',
      }
    }

    // ── bonds (BIS debt securities, sum of countries) ──
    let bonds = null
    const D = R.dss?.series || {}
    if (Object.keys(D).length) {
      const by = {}
      for (const [k, pts] of Object.entries(D)) { const [area, sec, val] = k.split('|'); if (area === 'U2') continue; ((by[area] ||= {})[sec] ||= {})[val] = pts }
      const chosen = {}
      for (const [area, secs] of Object.entries(by)) {
        const vals = ['N', 'F', 'M']
        const best = (s) => vals.map(v => [v, s?.[v]?.length || 0]).sort((a, b) => b[1] - a[1] || vals.indexOf(a[0]) - vals.indexOf(b[0]))[0]
        if (secs.S1) { const [v] = best(secs.S1); chosen[area] = { total: secs.S1[v], kind: 'all issuers', val: v, secs: Object.fromEntries(['S11', 'S12', 'S13'].map(s => [s, secs[s]?.[v] || null])) } }
        else if (secs.S13 || secs.S1311) { const g = secs.S13 || secs.S1311, [v] = best(g); chosen[area] = { total: g[v], kind: secs.S13 ? 'government only' : 'central government only', val: v, secs: { S13: g[v] } } }
      }
      const idx = Object.fromEntries(Object.entries(chosen).map(([a, c]) => [a, new Map(c.total)]))
      const qs = [...new Set(Object.values(chosen).flatMap(c => c.total.map(p => p[0])))].sort()
      const anchorsOk = q => ['US', 'CN', 'JP', 'DE', 'FR', 'GB'].every(a => idx[a]?.has(q))
      const lastQ = qs.filter(anchorsOk).at(-1)
      const sumAt = (q, which = null) => {
        let s = 0, n = 0; const carried = []
        for (const [a, c] of Object.entries(chosen)) {
          const src = which ? (c.secs?.[which] ? new Map(c.secs[which]) : null) : idx[a]
          if (!src) continue
          for (let k = 0; k <= 2; k++) { const qq = qKey(qOrd(q) - k); const v = src.get(qq); if (fin(v)) { s += v; n++; if (k && !which) carried.push(`${a} ${qq}`); break } }
        }
        return { v: s / 1e3, n, carried }
      }
      if (lastQ) {
        const series = qs.filter(q => q >= Q0 && q <= lastQ).map(q => { const t = sumAt(q); return [q, rnd(t.v, 3), t.n] })
        const t = sumAt(lastQ)
        const secSum = ['S13', 'S12', 'S11'].map(s => [s, sumAt(lastQ, s)])
        bonds = {
          asOf: lastQ, usdTn: rnd(t.v, 3), gdpMultiple: mult(t.v, lastQ), countries: t.n, carried: t.carried, series,
          bySector: [['government', 'S13', 'General government'], ['financial', 'S12', 'Financial corporations'], ['corporates', 'S11', 'Non-financial corporations']].map(([id, s, label]) => { const x = secSum.find(z => z[0] === s)[1]; return { id, label, usdTn: rnd(x.v, 3), countries: x.n } }),
          partial: Object.entries(chosen).filter(([, c]) => c.kind !== 'all issuers').map(([a]) => a),
          note: 'World bond market = sum of each country\'s debt securities outstanding (BIS debt securities statistics, issuer residence, all maturities and currencies, USD), euro-area aggregate dropped to avoid double counting. BIS publishes no world total. Valuation per country is nominal where available (else face or market value). partial: countries with only government securities. Coverage grows over time (Korea, Brazil, Mexico, Indonesia enter in 2018), so early years understate; the third column of series is the number of countries. Sector split leaves out countries with no sector detail. Bonds are also liabilities: government and corporate bonds are part of BIS total credit (debt), so do not add the two.',
        }
      }
    }

    // ── markets: world market cap ÷ GDP (+ nowcast) ──
    let markets = null
    const wld = W.mcap || {}
    if (Object.keys(wld).length) {
      const mc = R.wb?.mcap, members = new Set(I?.iso || [])
      const gap = y => {
        if (!mc || !members.size || !fin(wld[y])) return { v: 0, list: [] }
        let v = 0; const list = []
        for (const [c, o] of Object.entries(mc)) {
          if (!members.has(c) || fin(o[y])) continue
          const last = Object.keys(o).map(Number).filter(x => x < y && x >= y - 10 && fin(wld[x])).sort((a, b) => b - a)[0]
          if (last == null) continue
          const g = o[last] * 1e9 * (wld[y] / wld[last]); v += g; list.push([c, last, g / 1e12])
        }
        return { v, list: list.sort((a, b) => b[2] - a[2]) }
      }
      const years = yrs(wld).filter(y => y >= Y0)
      const series = years.map(y => { const g = gap(y), best = (wld[y] + g.v) / 1e12; return [y, rnd(best, 3), mult(best, y), rnd(wld[y] / 1e12, 3)] })
      const ly = years.at(-1), g = gap(ly), best = (wld[ly] + g.v) / 1e12
      let nowcast = null
      const vt = R.equity?.series || []
      if (vt.length) {
        const base = vt.filter(([d]) => d <= `${ly}-12-31`).at(-1), now = lastOf(vt)
        if (base && now && base[0] >= `${ly}-12-15`) {
          const cap = best * (now[1] / base[1]), gdpNow = tn(gdpY[vy])
          nowcast = { asOf: now[0], capUsdTn: rnd(cap, 2), ratio: fin(gdpNow) ? rnd(cap / gdpNow, 3) : null, gdpYear: vy, gdpProjected: proj(vy), base: { year: ly, capUsdTn: rnd(best, 2), reportedUsdTn: rnd(wld[ly] / 1e12, 2), vtClose: base[1], vtDate: base[0] }, vtClose: now[1], vtChgPct: rnd(pct(now[1], base[1]), 1), via: R.equity.via, method: `World Bank ${ly} world market cap (gap-filled) × VT price now ÷ VT close on ${base[0]}; ÷ IMF world GDP for ${vy}${proj(vy) ? ' (projection)' : ''}. VT (FTSE Global All Cap) is float-adjusted and price-only, so new listings, buybacks and non-index markets are not captured.` }
        } else notes.push(`VT history does not reach the end of ${ly}, so there is no market-cap nowcast.`)
      }
      markets = {
        capToGdp: {
          series, nowcast, latestYear: ly, gapFill: { year: ly, usdTn: rnd(g.v / 1e12, 2), markets: g.list.slice(0, 12).map(([c, y, v]) => ({ iso3: c, lastYear: y, usdTn: rnd(v, 2) })) },
          note: `World Bank market capitalization of listed domestic companies. The WLD total counts reporting markets only, so each missing market's last figure (≤ 10 years old) is grown with the reported world total and added (gap-filled ${ly}: +$${rnd(g.v / 1e12, 1)} tn, ${g.list.length} markets, largest ${g.list.slice(0, 4).map(x => `${x[0]} ${x[1]}`).join(', ')}). Taiwan (~2% of world cap) is never in the World Bank data. Series columns: year, gap-filled $ tn, ÷ IMF world GDP, reported WLD $ tn. Hong Kong listings of mainland companies count under Hong Kong.`,
        },
      }
    }

    // ── real estate (Savills anchors + BIS prices ÷ local nominal GDP) ──
    let realEstate = null
    const anchors = (seed.realEstate?.anchors || []).filter(a => fin(a.usdTn) && !a.derived).sort((a, b) => a.year - b.year)
    const hpiN = R.spp?.series?.['XW|N'] || [], hpiR = R.spp?.series?.['XW|R'] || []
    if (anchors.length && (hpiR.length || hpiN.length) && I) {
      // ratio_t = ratio_A × (HPI_t / HPI_A) ÷ (N_t / N_A), N = world nominal GDP in local-currency terms.
      // Used form: real HPI ÷ real GDP — BIS's CPI-deflated world index (XW R) over IMF world real GDP —
      // i.e. the same formula with the world deflator taken as the CPI implied by BIS's own aggregate
      // (XW N ÷ XW R). The IMF's PPP-weighted world CPI (PCPIPCH) includes high-inflation economies
      // outside the BIS price sample and rose ~28% over 2021–24 against ~22% for BIS's, which biased projections
      // low; it is kept as the cpi variant in the backtest.
      const g = I.world.NGDP_RPCH, pi = I.world.PCPIPCH, Y = {}, N = {}
      for (let y = Y0; y <= yrs(g).at(-1); y++) {
        Y[y] = y === Y0 ? 1 : fin(Y[y - 1]) && fin(g[y]) ? Y[y - 1] * (1 + g[y] / 100) : null
        N[y] = y === Y0 ? 1 : fin(N[y - 1]) && fin(Y[y]) && fin(pi[y]) ? N[y - 1] * (1 + g[y] / 100) * (1 + pi[y] / 100) : null
      }
      const ttmIdx = (X, p) => { const s = String(p), y = +s.slice(0, 4), m = /-Q/.test(s) ? 3 * +s.slice(6) : 12; return m === 12 ? X[y] : fin(X[y - 1]) && fin(X[y]) ? (X[y - 1] * (12 - m)) / 12 + (X[y] * m) / 12 : null }
      const useReal = hpiR.length > 0, hpi = useReal ? hpiR : hpiN, D = useReal ? Y : N
      const mapAt = (pts) => { const M = new Map(pts); return p => (/^\d{4}$/.test(String(p)) ? M.get(`${p}-Q4`) : M.get(p)) }
      const Hat = mapAt(hpi), HNat = mapAt(hpiN)
      const ratioOf = a => a.usdTn / gdpTtm(a.year)
      const project = (a, p, H = Hat, X = D) => { const h0 = H(a.year), h1 = H(p), n0 = ttmIdx(X, a.year), n1 = ttmIdx(X, p); return [h0, h1, n0, n1].every(fin) ? ratioOf(a) * (h1 / h0) / (n1 / n0) : null }
      const A = anchors.at(-1)
      const lastQ = lastOf(hpi)[0], lastFullYear = +lastQ.slice(0, 4) - (lastQ.endsWith('Q4') ? 0 : 1)
      const series = []
      for (let y = 2000; y <= lastFullYear; y++) { const r = project(A, y), gd = gdpTtm(y); if (fin(r) && fin(gd)) series.push([y, rnd(r * gd, 1), rnd(r, 3)]) }
      if (!lastQ.endsWith('Q4')) { const r = project(A, lastQ), gd = gdpTtm(lastQ); if (fin(r) && fin(gd)) series.push([lastQ, rnd(r * gd, 1), rnd(r, 3)]) }
      const backtest = []
      for (let i = 0; i < anchors.length; i++) for (let j = i + 1; j < anchors.length; j++) {
        const a = anchors[i], b = anchors[j], r = project(a, b.year), rc = project(a, b.year, HNat, N), gd = gdpTtm(b.year)
        if (!fin(r) || !fin(gd)) continue
        const naive = ratioOf(a) * gd
        backtest.push({ from: a.year, to: b.year, publishedUsdTn: b.usdTn, projectedUsdTn: rnd(r * gd, 1), errPct: rnd(pct(r * gd, b.usdTn), 1), naiveUsdTn: rnd(naive, 1), naiveErrPct: rnd(pct(naive, b.usdTn), 1), cpiUsdTn: fin(rc) ? rnd(rc * gd, 1) : null, cpiErrPct: fin(rc) ? rnd(pct(rc * gd, b.usdTn), 1) : null })
      }
      const mae = xs => { const v = xs.filter(fin); return v.length ? rnd(v.reduce((s, x) => s + Math.abs(x), 0) / v.length, 1) : null }
      const basis = backtest.filter(b => b.from >= 2021) // Savills re-estimated commercial property after its 2020 figure
      // how far the IMF world CPI ran from the CPI implied by BIS's world index over the four years to the base anchor
      const y1 = A.year, y0 = y1 - 4, imfCum = [1, 2, 3, 4].reduce((m, k) => m * (1 + (pi[y0 + k] ?? NaN) / 100), 1) - 1
      const bisCpi = y => { const n = HNat(y), r = new Map(hpiR).get(`${y}-Q4`); return fin(n) && fin(r) && r ? n / r : null }
      const bisCum = fin(bisCpi(y0)) && fin(bisCpi(y1)) ? bisCpi(y1) / bisCpi(y0) - 1 : null
      const gapTxt = fin(imfCum) && fin(bisCum) ? `${rnd(imfCum * 100, 0)}% vs ${rnd(bisCum * 100, 0)}% cumulative over ${y0 + 1}–${y1}` : 'several points over recent years'
      const l = lastOf(series)
      realEstate = {
        asOf: l?.[0] ?? null, usdTn: l?.[1] ?? null, ratio: l?.[2] ?? null,
        anchors: anchors.map(a => ({ ...a, ratio: rnd(ratioOf(a), 3) })), derivedAnchors: (seed.realEstate?.anchors || []).filter(a => a.derived),
        series, backtest,
        backtestSummary: { pairs: backtest.length, method: mae(backtest.map(b => b.errPct)), naive: mae(backtest.map(b => b.naiveErrPct)), cpiVariant: mae(backtest.map(b => b.cpiErrPct)), sameBasis: { pairs: basis.length, method: mae(basis.map(b => b.errPct)), naive: mae(basis.map(b => b.naiveErrPct)), cpiVariant: mae(basis.map(b => b.cpiErrPct)) } },
        hpiAsOf: lastQ, hpiSeries: useReal ? 'BIS WS_SPP Q.XW.R.628 (real)' : 'BIS WS_SPP Q.XW.N.628 (nominal, IMF CPI fallback)', baseAnchor: A.year,
        method: `Estimate. Anchored on Savills' published total for ${A.year} ($${A.usdTn} tn = ${rnd(ratioOf(A), 2)}× that year's IMF world GDP). Other periods: value ÷ world GDP moves with world house prices relative to world nominal GDP, both in local currency so exchange rates cancel — ratio = ratio_${A.year} × (BIS world residential price index, CPI-deflated, ÷ its Q4 ${A.year} level) ÷ (IMF world real GDP ÷ its ${A.year} level); value = ratio × IMF world GDP in USD. That is the nominal formula with the world deflator taken as the CPI implied by BIS's own world index: the IMF's world CPI (PPP-weighted, including high-inflation economies outside the BIS price sample) ran above it (${gapTxt}) and biased projections low (backtest columns cpi*). Commercial property and farmland are assumed to move with house prices. Year-end stocks use same-year GDP; the latest quarter uses trailing-12-month GDP interpolated from IMF annual figures (current-year GDP is a projection). Backtest: each Savills anchor projected to every later one, mean absolute error ${mae(backtest.map(b => b.errPct))}% (method) vs ${mae(backtest.map(b => b.naiveErrPct))}% (constant ratio) vs ${mae(backtest.map(b => b.cpiErrPct))}% (IMF-CPI form); from 2021 on, after Savills re-estimated commercial property (2020 commercial $32.6 tn, 2021 $51.7 tn), ${mae(basis.map(b => b.errPct))}% vs ${mae(basis.map(b => b.naiveErrPct))}% vs ${mae(basis.map(b => b.cpiErrPct))}%.`,
      }
    }

    // ── trade (CPB) ──
    let trade = null
    const cp = R.cpb?.series
    if (cp?.volume?.length) {
      const yoy = s => { const l = lastOf(s); const p = s.find(x => x[0] === mKey(mOrd(l[0]) - 12)); return rnd(pct(l[1], p?.[1]), 1) }
      const tr = yrs(W.trade).map(y => [y, rnd(W.trade[y], 1)])
      if (tr.length > 2) { const [a, b] = tr.slice(-2); if (Math.abs(b[1] / a[1] - 1) > TRADE_JUMP) { tr.pop(); notes.push(`World Bank WLD trade-to-GDP ${b[0]} (${b[1]}% after ${a[1]}%) dropped as a partial-coverage artefact.`) } }
      trade = {
        asOf: lastOf(cp.volume)[0], edition: R.cpb.edition,
        volume: cp.volume.filter(p => p[0] >= M0).map(([m, v]) => [m, rnd(v, 2)]), production: cp.production.filter(p => p[0] >= M0).map(([m, v]) => [m, rnd(v, 2)]), prices: (cp.prices || []).filter(p => p[0] >= M0).map(([m, v]) => [m, rnd(v, 2)]),
        volumeYoy: yoy(cp.volume), productionYoy: yoy(cp.production), productionAsOf: lastOf(cp.production)[0],
        tradeToGdp: tr,
        note: 'CPB World Trade Monitor: world merchandise trade volume (average of world imports and exports) and world industrial production excluding construction (production-weighted), seasonally adjusted, 2021 = 100; prices are USD unit values. tradeToGdp is the World Bank world aggregate of exports + imports of goods and services, % of GDP.',
      }
    }

    // ── flows, people, wealth, members ──
    const flows = {
      savings: ser(W.saving, 1, Y0).map(([y, v]) => [y, v, false]), investment: ser(W.invest, 1, Y0).map(([y, v]) => [y, v, false]),
      caDiscrepancy: I ? ser(I.world.BCA, 1) : [], caDiscrepancyCheck: I ? ser(I.bcaSum, 1, Y0, false).filter(([y]) => y >= 2015) : [],
      note: 'Savings and investment are the World Bank world aggregates (gross savings, gross capital formation, % of GDP; actuals only: WEO world savings/investment are not on DataMapper). For one world they should match; the gap is statistical. caDiscrepancy is the IMF WEOWORLD current-account balance ($ bn): for the whole world it should be zero, so it measures the global discrepancy; caDiscrepancyCheck is the sum over all IMF economies.',
    }
    const people = {
      population: ser(W.pop, 3, 1960, false).map(([y, v]) => [y, rnd(v / 1e9, 3)]), workingAgeShare: ser(W.work, 2, 1960, false), fertility: ser(W.fert, 3, 1960, false), lifeExpectancy: ser(W.life, 2, 1960, false), unemployment: ser(W.unemp, 2, 1991, false),
      note: 'World Bank / UN world aggregates. Unemployment is the ILO modelled estimate (% of labour force).',
    }
    const wealth = { anchors: (seed.wealth?.anchors || []).slice().sort((a, b) => a.year - b.year), note: seed.wealth?.note || null }
    const members = I ? Object.entries(I.members).map(([iso3, m]) => ({
      iso3, name: m.name, gdpUsd: rnd(m.NGDPD[vy] / 1e3, 3), share: fin(m.NGDPD[vy]) && fin(gdpY[vy]) ? rnd((m.NGDPD[vy] / gdpY[vy]) * 100, 2) : null,
      growth: rnd(m.NGDP_RPCH[vy], 1), inflation: rnd(m.PCPIPCH[vy], 1), unemployment: rnd(m.LUR[vy], 1), govDebt: rnd(m.GGXWDG_NGDP[vy], 1), ca: rnd(m.BCA_NGDPD[vy], 1), year: vy, projected: true,
    })).filter(m => fin(m.gdpUsd)).sort((a, b) => b.gdpUsd - a.gdpUsd).slice(0, TOP_MEMBERS) : []

    // ── balance sheet ──
    const item = (id, label, side, usdTn, asOf, method, source, series, extra = {}) => (fin(usdTn) ? { id, label, side, usdTn: rnd(usdTn, 2), gdpMultiple: mult(usdTn, asOf), asOf, method, source, series: (series || []).map(([p, v]) => [p, rnd(v, 2), mult(v, p)]), ...extra } : null)
    const wl = wealth.anchors.filter(a => fin(a.usdTn) && !a.derived).at(-1)
    const sec = id => debt?.sectors.find(s => s.id === id)
    const nc = markets?.capToGdp?.nowcast
    const items = [
      realEstate && item('realEstate', 'Real estate (residential, commercial, farmland)', 'asset', realEstate.usdTn, realEstate.asOf, 'estimate', 'Savills anchors × BIS world house prices ÷ world nominal GDP', realEstate.series.map(([p, v]) => [p, v])),
      markets && (nc ? item('equities', 'Listed equities', 'asset', nc.capUsdTn, nc.asOf, 'nowcast', 'World Bank market cap (gap-filled) × VT price', markets.capToGdp.series.map(([y, v]) => [y, v]), { ratioToCurrentGdp: nc.ratio }) : item('equities', 'Listed equities', 'asset', lastOf(markets.capToGdp.series)[1], lastOf(markets.capToGdp.series)[0], 'measured', 'World Bank market cap (gap-filled)', markets.capToGdp.series.map(([y, v]) => [y, v]))),
      bonds && item('bonds', 'Bonds and other debt securities', 'asset', bonds.usdTn, bonds.asOf, 'measured', 'BIS debt securities statistics (sum of ~60 countries)', bonds.series.map(([q, v]) => [q, v]), { overlaps: ['governmentDebt', 'corporateDebt'] }),
      broad && item('broadMoney', `Broad money (9 largest economies, ${broad.coverage}% of world GDP)`, 'asset', broad.usdTn, broad.asOf, 'measured', 'Central banks via FRED, ECB, Eastmoney, BoJ, BoE, SNB, BoC, RBA, BCB; BIS FX', broad.series.filter(([m]) => m.endsWith('-12') || m === broad.asOf), { coverage: broad.coverage }),
      centralBanks && item('cbAssets', 'Central-bank assets', 'asset', centralBanks.usdTn, centralBanks.asOf, 'measured', 'BIS central bank total assets (+ FRED for Fed/ECB/BoJ)', centralBanks.series.filter(([m]) => m.endsWith('-12') || m === centralBanks.asOf)),
      reserves && item('fxReserves', 'FX reserves (official)', 'asset', reserves.usdTn, reserves.asOf, 'measured', 'IMF COFER', reserves.series.filter(([q]) => q.endsWith('Q4') || q === reserves.asOf)),
      sec('households') && item('householdDebt', 'Household debt', 'debt', sec('households').usdTn, sec('households').asOf, 'measured', 'BIS total credit, all reporting economies', sec('households').usdSeries.filter(([q]) => q.endsWith('Q4') || q === sec('households').asOf), { coverage: debt.coverage }),
      sec('corporates') && item('corporateDebt', 'Non-financial corporate debt', 'debt', sec('corporates').usdTn, sec('corporates').asOf, 'measured', 'BIS total credit, all reporting economies', sec('corporates').usdSeries.filter(([q]) => q.endsWith('Q4') || q === sec('corporates').asOf), { coverage: debt.coverage }),
      sec('government') && item('governmentDebt', 'Government debt', 'debt', sec('government').usdTn, sec('government').asOf, 'measured', 'BIS total credit, all reporting economies (market value)', sec('government').usdSeries.filter(([q]) => q.endsWith('Q4') || q === sec('government').asOf), { coverage: debt.coverage }),
      wl && item('householdWealth', 'Household net wealth', 'wealth', wl.usdTn, wl.year, 'anchor', wl.source, wealth.anchors.filter(a => fin(a.usdTn) && !a.derived).map(a => [a.year, a.usdTn])),
    ].filter(Boolean)
    const balanceSheet = { asOf: items.map(i => String(i.asOf)).sort().at(-1) || null, items, note: 'Each item at its own latest date, ÷ world GDP over the 12 months to that date (IMF annual GDP interpolated; current-year GDP is a projection). Items overlap and must not be summed: bonds are part of government and corporate debt; broad money is bank deposits, mostly backed by the same loans; central-bank assets hold bonds and FX reserves; household wealth already includes real estate, equities, bonds and deposits held by households.' }

    const noteParts = [
      headline?.vintage ? `IMF ${headline.vintage}: ${vy} onward are projections.` : 'IMF WEO unavailable.',
      'Amounts are USD trillions at market exchange rates unless noted; gdpMultiple = amount ÷ world GDP.',
      'Coverage differs by block (broad money: 9 economies; debt: ~44 BIS reporters; bonds: ~60 countries; reserves: all COFER reporters); each block states its own.',
      ...notes,
    ]
    return {
      built: isoNow(), stale: !!meta.stale, sourceErrors: meta.sourceErrors || [], sources: meta.sources || [], requests: meta.requests ?? null,
      note: noteParts.join(' '),
      headline, balanceSheet,
      money: { broad, centralBanks, reserves },
      markets, realEstate, debt, bonds, trade, flows, people, wealth, members,
    }
  }

  // ── seed (IMF raw blocks for machines imf.org refuses) ──
  function writeSeed(R) {
    const prev = readJson(seedFile) || {}
    const strip = b => { if (!b) return null; const { asOf, fallback, ...rest } = b; return rest }
    const changed = SEEDED.filter(n => R[n] && JSON.stringify(strip(prev.raw?.[n])) !== JSON.stringify(strip(R[n])))
    if (!changed.length) return false
    const next = { ...prev, raw: { ...(prev.raw || {}), ...Object.fromEntries(changed.map(n => [n, R[n]])) } }
    // hand-entered parts one anchor per line, raw blocks one per line
    const part = ([k, v]) => {
      if (!Array.isArray(v?.anchors)) return `${JSON.stringify(k)}:${JSON.stringify(v)}`
      const { anchors, ...rest } = v
      return `${JSON.stringify(k)}:${JSON.stringify(rest).slice(0, -1)}${Object.keys(rest).length ? ',' : ''}"anchors":[\n${anchors.map(a => JSON.stringify(a)).join(',\n')}\n]}`
    }
    const lines = ['{', Object.entries(next).filter(([k]) => k !== 'raw').map(part).join(',\n') + ',', '"raw":{', Object.entries(next.raw).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n'), '}}']
    return writeText(seedFile, lines.join('\n') + '\n')
  }

  async function build() {
    const disk = raw ? null : readJson(file)
    const prev = raw || disk?.raw || {}, seed = readJson(seedFile) || {}
    const R = {}, errs = [], sources = [], now = Date.now()
    requests = 0
    const names = Object.keys(fetchers)
    const fresh = n => prev[n]?.asOf && !prev[n].fallback && now - Date.parse(prev[n].asOf) < (MAX_AGE[n] ?? DEFAULT_AGE)
    const res = await Promise.allSettled(names.map(n => (fresh(n) ? Promise.resolve({ reused: true }) : fetchers[n]())))
    res.forEach((r, i) => {
      const n = names[i]
      if (r.status === 'fulfilled' && r.value?.reused) { R[n] = prev[n]; sources.push({ id: n, label: LABEL[n], url: PAGE[n], fetched: prev[n].asOf, from: 'cache' }); return }
      const ok = r.status === 'fulfilled' && r.value && (r.value.series ? (Array.isArray(r.value.series) ? r.value.series.length : Object.keys(r.value.series).length) : true)
      if (ok) { R[n] = r.value; sources.push({ id: n, label: LABEL[n], url: PAGE[n], fetched: r.value.asOf, from: 'live' }); return }
      const msg = r.status === 'rejected' ? scrub(r.reason) : 'no data returned'
      const fb = prev[n] ? ['cache', prev[n]] : seed.raw?.[n] ? ['seed', seed.raw[n]] : null
      if (fb) R[n] = { ...fb[1], fallback: fb[0] }
      errs.push(`${LABEL[n]}: ${msg}${fb ? ` — serving the ${fb[0] === 'seed' ? 'tracked seed' : 'copy'} fetched ${String(fb[1].asOf).slice(0, 10)}` : ' — no fallback'}`)
      sources.push({ id: n, label: LABEL[n], url: PAGE[n], fetched: fb?.[1]?.asOf || null, from: fb ? fb[0] : 'none' })
    })
    const liveSeeded = SEEDED.filter(n => sources.find(s => s.id === n)?.from === 'live')
    if (liveSeeded.length) writeSeed(Object.fromEntries(liveSeeded.map(n => [n, R[n]])))
    const payload = derive(R, { stale: errs.length > 0, sourceErrors: errs, sources, requests, seed })
    const hl = payload.headline
    console.log(`World economy: GDP $${hl?.gdpUsd?.v ?? '?'} tn (${hl?.gdpUsd?.year ?? '?'}), ${payload.balanceSheet.items.length} balance-sheet items, ${requests} requests${errs.length ? `, ${errs.length} source error(s)` : ''}`)
    return { payload, raw: R, failed: errs.length > 0, empty: names.some(n => !R[n]) }
  }

  function refresh() {
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const { payload, raw: R, failed, empty } = await build()
        mem = payload; raw = R; nextAt = Date.now() + (empty ? RETRY_EMPTY : failed ? RETRY : TTL)
        writeText(file, JSON.stringify({ version: 1, nextAt, payload, raw: R }))
        return payload
      } catch (e) {
        console.warn('World economy:', scrub(e)); nextAt = Date.now() + RETRY
        if (mem) return { ...mem, stale: true }
        return { built: null, stale: true, sourceErrors: [`refresh: ${scrub(e)}`], sources: [], note: null, headline: null, balanceSheet: { asOf: null, items: [] }, money: { broad: null, centralBanks: null, reserves: null }, markets: null, realEstate: null, debt: null, bonds: null, trade: null, flows: null, people: null, wealth: null, members: [] }
      } finally { inflight = null }
    })()
    return inflight
  }

  async function get() {
    if (!mem) {
      const disk = readJson(file)
      if (disk?.version === 1 && disk.payload?.built) {
        const p = disk.payload
        // re-derive from the cached raw blocks so a code change shows without refetching
        try { mem = disk.raw ? { ...derive(disk.raw, { stale: p.stale, sourceErrors: p.sourceErrors, sources: p.sources, requests: p.requests }), built: p.built } : p } catch (e) { console.warn('World economy re-derive:', scrub(e)); mem = p }
        raw = disk.raw || null; nextAt = disk.nextAt || Date.parse(p.built) + TTL
        if (raw && Object.keys(fetchers).some(n => !raw[n])) nextAt = Math.min(nextAt, Date.parse(p.built) + RETRY_EMPTY)
      }
    }
    if (mem && Date.now() < nextAt) return mem
    if (mem) { refresh().catch(() => {}); return { ...mem, stale: true } }
    return refresh()
  }

  return { get }
}
