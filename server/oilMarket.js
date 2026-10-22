// ============================================================================
// OIL MARKET: the Commodities tab's Oil page. A free, EIA-first take on a
// "global oil data deck" (after Rory Johnston's Commodity Context deck):
// prices and timespreads, refined-product cracks, U.S. inventories against
// their five-year ranges, the SPR, U.S. supply and implied demand, refining,
// EIA's STEO world balance, plus the NYMEX WTI and Brent forward curves from
// CME settlements.
//
// EIA Open Data API v2 (api.eia.gov/v2; EIA_API_KEY from .env, never logged:
// error text is scrubbed to api_key=***). Request shape, one request per route
// carrying every series of that route:
//   {route}/data/?api_key=…&frequency=…&data[0]=value&facets[series][]=…&start=…
//   &sort[0][column]=period&sort[0][direction]=desc&sort[1][column]=series
//   &sort[1][direction]=asc&offset=…&length=5000
// The API returns at most 5,000 rows a request; longer pulls page with offset
// (the secondary sort keeps the pages stable).
//   spot   petroleum/pri/spt, daily, since Dec 2014. $/bbl: RWTC (WTI Cushing),
//          RBRTE (Brent FOB Europe). $/gal, ×42 → $/bbl: EER_EPMRU_PF4_Y35NY_DPG
//          (NY Harbor conventional regular gasoline), EER_EPMRU_PF4_RGC_DPG (Gulf
//          Coast conventional regular gasoline), EER_EPD2DXL0_PF4_Y35NY_DPG (NY
//          Harbor ULSD), EER_EPD2DXL0_PF4_RGC_DPG (Gulf Coast ULSD),
//          EER_EPD2DC_PF4_Y05LA_DPG (Los Angeles CARB diesel),
//          EER_EPD2F_PF4_Y35NY_DPG (NY Harbor No. 2 heating oil),
//          EER_EPJK_PF4_RGC_DPG (Gulf Coast jet), EER_EPLLPA_PF4_Y44MB_DPG (Mont
//          Belvieu propane). All ten live in Oct 2026 (EIA posts them a day or
//          two late; Brent can trail the U.S. series). Not used: the route's
//          eleventh series, LA RBOB gasoline (EER_EPMRR_PF4_Y05LA_DPG).
//   fut    petroleum/pri/fut, daily, since 1983: RCLC1, RCLC2, RCLC4 (NYMEX
//          crude contracts 1, 2, 4, $/bbl), EER_EPMRR_PE1_Y35NY_DPG (RBOB
//          contract 1, $/gal) and EER_EPD2F_PE1_Y35NY_DPG (NY Harbor ULSD/heating
//          oil contract 1, $/gal). EIA STOPPED PUBLISHING NYMEX FUTURES ON
//          2024-04-05 (every fut series ends that day), so this block is a
//          frozen history: C1–C2 and C1–C4 since Jan 1985 (contracts 2 and 4
//          start then; contract 1 in Apr 1983) and the NYMEX 3-2-1 since RBOB
//          began (Oct 2005), all through 2024-04-05. After that the
//          timespreads continue from the CME archive below (a gap in between);
//          the headline 3-2-1 is the spot one (cracks below).
//   wstk   petroleum/stoc/wstk, weekly (week ending Friday), since 1982, thousand
//          bbl ÷ 1000 → million bbl: WCESTUS1 commercial crude ex-SPR,
//          W_EPC0_SAX_YCUOK_MBBL Cushing, WGTSTUS1 total motor gasoline, WDISTUS1
//          distillate, WKJSTUS1 kerosene-type jet, WPRSTUS1 propane/propylene
//          (excluding propylene at terminals: the WPSR headline; the older
//          W_EPLLPZ_SAE_NUS_MBBL ended Apr 2020), WTESTUS1 crude + products
//          ex-SPR, WTTSTUS1 crude + products incl. SPR, WCSSTUS1 SPR (from Aug
//          1982).
//   sndw   petroleum/sum/sndw, weekly, since 2014, thousand b/d: WCRFPUS2 crude
//          production, WCRIMUS2 crude imports, WCREXUS2 crude exports, WCRRIUS2
//          refiner net crude input, product supplied (implied demand) WRPUPUS2
//          total, WGFUPUS2 finished motor gasoline, WDIUPUS2 distillate, WKJUPUS2
//          jet.
//   wiup   petroleum/pnp/wiup, weekly, since 2014: WPULEUS3 refinery utilization,
//          % of operable capacity.
//   crpdn  petroleum/crd/crpdn, monthly, since 2010, thousand b/d: MCRFPUS2
//          U.S., MCRFPTX2 Texas, MCRFPNM2 New Mexico, MCRFPND2 North Dakota,
//          MCRFP3FM2 Federal offshore Gulf of America (Mexico), MCRFPAK2 Alaska,
//          MCRFPCO2 Colorado, MCRFPOK2 Oklahoma. Refetched whole (EIA revises).
//   steo   steo (facet seriesId), monthly, since 2015, history + forecast to the
//          end of next year; million b/d × 1000 → thousand b/d. PAPR_WORLD world
//          liquids production, PATC_WORLD world consumption (implied stock
//          change = production − consumption, + = build; EIA's own
//          T3_STCHANGE_WORLD is the same number as withdrawals, kept as a
//          check), PASC_OECD_T3 OECD commercial inventories (million bbl, end of
//          period), COPR_OPEC OPEC crude, COPS_OPEC OPEC spare capacity,
//          COPC_OPEC OPEC capacity, COPR_OPECPLUS OPEC+ crude, PAPR_NONOPEC
//          non-OPEC liquids, COPRPUS U.S. crude, BREPUUS / WTIPUUS price
//          forecasts ($/bbl). Producers: crude COPR_SA, COPR_RS, COPR_IZ,
//          COPR_KU, COPR_IR, COPR_VE, COPR_KZ (history only: STEO does not
//          forecast crude by country); total liquids PAPR_TC (UAE), PAPR_BR,
//          PAPR_CA, PAPR_GY, PAPR_NO (history + forecast; STEO has no crude
//          series for these). The payload's STEO series start in 2018.
//          The vintage: www.eia.gov/outlooks/steo/ ("Release Date: …", one page
//          request), checked against the data (country history ends the month
//          before the release month). Months from the release month on are
//          EIA projections (projected = true).
// CME Group (personal use only: the data live ONLY in the gitignored cache
// oil-market.json, including the curve archive; nothing from CME may go into a
// tracked file). Same endpoints, headers and parsing as server/gpuFutures.js:
//   dates  www.cmegroup.com/CmeWS/mvc/Settlements/Futures/TradeDate/{id}: the
//          last ~5 trade dates ([["MM/DD/YYYY","Final"], …]).
//   settle …/CmeWS/mvc/Settlements/Futures/Settlements/{id}/FUT?strategy=DEFAULT
//          &tradeDate=MM/DD/YYYY&pageSize=100: one row per listed month.
//   CL = id 425, NYMEX WTI Light Sweet Crude (~120 months listed);
//   BZ = id 424, NYMEX Brent Last Day Financial (cash-settled on ICE Brent).
//   Every listed trade date the archive lacks (or holds only as preliminary) is
//   fetched once; the first 48 months are kept per product per day. The archive
//   is deduped by trade date and pruned to ~2 years; "curve 1 month / 3 months
//   / 1 year ago" fill in as it accumulates (null until then).
//
// Cadence: each source has its own clock (stale-while-revalidate): spot, weekly
// EIA and CME every 6 h, monthly production and STEO daily, the frozen EIA
// futures weekly. Daily and weekly EIA pulls are incremental (from the last
// cached date minus a 31-day / 10-week overlap: one request) with a full
// refetch every 30 days (futures: 180). A failed source keeps its last good raw
// block (sourceErrors says so) and is retried after an hour (15 minutes when it
// has no cached copy); get() never throws once data exists, and a block that
// cannot be derived is null with a sourceErrors line. Requests: a cold build ≈
// 39 (spot 7 pages, futures 10, stocks 4, supply 2, utilization 1,
// production 1, STEO 2, CME 2 date lists + up to 10 settlement days; after a
// route's first page the rest go three at a time; a few seconds when EIA is
// quick, up to ~2 minutes when it is slow, and only the very first GET waits); a warm
// 6-hourly refresh ≈ 8 (5 EIA + 2 CME date lists + ~1 new settlement day per
// product), plus 3 a day (production, STEO + its page) and 1 a week (futures).
// Cache (repo root, gitignored): oil-market.json = payload + raw blocks + the CME
// archive + per-source clocks; written through data/cache/ (gitignored) and
// never written over when it cannot be read (it holds the only CME history).
// Units in the payload: prices $/bbl, stocks million bbl, flows thousand b/d,
// dates YYYY-MM-DD (daily/weekly) or YYYY-MM (monthly); values rounded to 2 dp
// (flows to whole thousand b/d). Chart series are multi-resolution to keep the
// payload near 500 KB (each block's `sampling` says so): from 2015 the
// month-end print, weekly for the last five years, daily for the last year
// (daily series); statistics (5-year averages, percentiles, seasonal ranges)
// always use the full raw history. The 1985+ timespreads are monthly averages.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, DAY = 24 * H, RETRY = H, RETRY_EMPTY = H / 4
const EIA = 'https://api.eia.gov/v2', PAGE_ROWS = 5000, MAX_PAGES = 25
const STEO_PAGE = 'https://www.eia.gov/outlooks/steo/'
const CME_BASE = 'https://www.cmegroup.com'
const CME_DATES = id => `${CME_BASE}/CmeWS/mvc/Settlements/Futures/TradeDate/${id}`
const CME_SETTLE = (id, mdy) => `${CME_BASE}/CmeWS/mvc/Settlements/Futures/Settlements/${id}/FUT?strategy=DEFAULT&tradeDate=${encodeURIComponent(mdy)}&pageSize=100`
const CME = { wti: { code: 'CL', id: 425, name: 'NYMEX WTI Light Sweet Crude Oil futures' }, brent: { code: 'BZ', id: 424, name: 'NYMEX Brent Last Day Financial futures' } }
const CME_KEEP = 48, CURVE_N = 36, ARCHIVE_DAYS = 760
const CHART_FROM = '2015-01-01' // chart series start here; statistics use the full raw history
const DAILY_DAYS = 365 // daily chart points for the last year, weekly (last print of each Mon–Sun week) before
const GAL = 42 // gallons per barrel

// id: [EIA series, label, quoted in $/gal]
const SPOT = {
  wti: ['RWTC', 'WTI Cushing', 0],
  brent: ['RBRTE', 'Brent (FOB Europe)', 0],
  gasNYH: ['EER_EPMRU_PF4_Y35NY_DPG', 'NY Harbor conventional gasoline', 1],
  gasUSGC: ['EER_EPMRU_PF4_RGC_DPG', 'Gulf Coast conventional gasoline', 1],
  ulsdNYH: ['EER_EPD2DXL0_PF4_Y35NY_DPG', 'NY Harbor ULSD', 1],
  ulsdUSGC: ['EER_EPD2DXL0_PF4_RGC_DPG', 'Gulf Coast ULSD', 1],
  carbLA: ['EER_EPD2DC_PF4_Y05LA_DPG', 'Los Angeles CARB diesel', 1],
  hoNYH: ['EER_EPD2F_PF4_Y35NY_DPG', 'NY Harbor No. 2 heating oil', 1],
  jetUSGC: ['EER_EPJK_PF4_RGC_DPG', 'Gulf Coast jet fuel', 1],
  propane: ['EER_EPLLPA_PF4_Y44MB_DPG', 'Mont Belvieu propane', 1],
}
const PRODUCTS = ['gasNYH', 'gasUSGC', 'ulsdNYH', 'ulsdUSGC', 'carbLA', 'hoNYH', 'jetUSGC', 'propane']
const FUT = { c1: 'RCLC1', c2: 'RCLC2', c4: 'RCLC4', rb1: 'EER_EPMRR_PE1_Y35NY_DPG', ho1: 'EER_EPD2F_PE1_Y35NY_DPG' }
const STOCKS = {
  crude: ['WCESTUS1', 'Commercial crude oil (ex-SPR)'],
  cushing: ['W_EPC0_SAX_YCUOK_MBBL', 'Cushing, Oklahoma crude'],
  gasoline: ['WGTSTUS1', 'Total motor gasoline'],
  distillate: ['WDISTUS1', 'Distillate fuel oil'],
  jet: ['WKJSTUS1', 'Kerosene-type jet fuel'],
  propane: ['WPRSTUS1', 'Propane/propylene'],
  totalExSpr: ['WTESTUS1', 'Crude oil + products, ex-SPR'],
  total: ['WTTSTUS1', 'Crude oil + products, incl. SPR'],
}
const SPR = 'WCSSTUS1'
const SNDW = { production: 'WCRFPUS2', imports: 'WCRIMUS2', exports: 'WCREXUS2', inputs: 'WCRRIUS2', total: 'WRPUPUS2', gasoline: 'WGFUPUS2', distillate: 'WDIUPUS2', jet: 'WKJUPUS2' }
const DEMAND = { total: 'Total product supplied', gasoline: 'Finished motor gasoline', distillate: 'Distillate fuel oil', jet: 'Kerosene-type jet fuel' }
const UTIL = 'WPULEUS3'
const STATES = {
  us: ['MCRFPUS2', 'United States'], tx: ['MCRFPTX2', 'Texas'], nm: ['MCRFPNM2', 'New Mexico'], nd: ['MCRFPND2', 'North Dakota'],
  gom: ['MCRFP3FM2', 'Federal offshore Gulf of America'], ak: ['MCRFPAK2', 'Alaska'], co: ['MCRFPCO2', 'Colorado'], ok: ['MCRFPOK2', 'Oklahoma'],
}
const STEO = { supply: 'PAPR_WORLD', demand: 'PATC_WORLD', draw: 'T3_STCHANGE_WORLD', oecd: 'PASC_OECD_T3', opec: 'COPR_OPEC', spare: 'COPS_OPEC', capacity: 'COPC_OPEC', opecPlus: 'COPR_OPECPLUS', nonOpec: 'PAPR_NONOPEC', usCrude: 'COPRPUS', brent: 'BREPUUS', wti: 'WTIPUUS' }
// [id, STEO series, label, measure]: STEO carries crude production for OPEC+ members, total liquids supply for the rest
const PRODUCERS = [
  ['sa', 'COPR_SA', 'Saudi Arabia', 'crude'], ['ru', 'COPR_RS', 'Russia', 'crude'], ['iq', 'COPR_IZ', 'Iraq', 'crude'], ['ae', 'PAPR_TC', 'United Arab Emirates', 'liquids'],
  ['kw', 'COPR_KU', 'Kuwait', 'crude'], ['ir', 'COPR_IR', 'Iran', 'crude'], ['ve', 'COPR_VE', 'Venezuela', 'crude'], ['kz', 'COPR_KZ', 'Kazakhstan', 'crude'],
  ['br', 'PAPR_BR', 'Brazil', 'liquids'], ['ca', 'PAPR_CA', 'Canada', 'liquids'], ['gy', 'PAPR_GY', 'Guyana', 'liquids'], ['no', 'PAPR_NO', 'Norway', 'liquids'],
]
const VINTAGE_PROBE = ['COPR_SA', 'COPR_RS', 'COPR_IZ'] // country crude history ends the month before the release month
const STEO_OUT = '2018-01' // STEO series in the payload start here (raw from 2015)

// EIA pulls: start = first period of a full pull; overlap (days) = how far back an incremental pull reaches; fullEvery 0 = always whole
const GROUPS = {
  spot: { route: 'petroleum/pri/spt', freq: 'daily', ids: Object.values(SPOT).map(s => s[0]), start: '2014-12-01', overlap: 31, fullEvery: 30 * DAY },
  fut: { route: 'petroleum/pri/fut', freq: 'daily', ids: Object.values(FUT), start: '1983-01-01', overlap: 31, fullEvery: 180 * DAY },
  wstk: { route: 'petroleum/stoc/wstk', freq: 'weekly', ids: [...Object.values(STOCKS).map(s => s[0]), SPR], start: '1982-01-01', overlap: 70, fullEvery: 30 * DAY },
  sndw: { route: 'petroleum/sum/sndw', freq: 'weekly', ids: Object.values(SNDW), start: '2014-01-01', overlap: 70, fullEvery: 30 * DAY },
  wiup: { route: 'petroleum/pnp/wiup', freq: 'weekly', ids: [UTIL], start: '2014-01-01', overlap: 70, fullEvery: 30 * DAY },
  crpdn: { route: 'petroleum/crd/crpdn', freq: 'monthly', ids: Object.values(STATES).map(s => s[0]), start: '2010-01', overlap: 0, fullEvery: 0 },
  steo: { route: 'steo', freq: 'monthly', facet: 'seriesId', ids: [...new Set([...Object.values(STEO), ...PRODUCERS.map(p => p[1])])], start: '2015-01', overlap: 0, fullEvery: 0 },
}
// source id: [label, page, refresh interval]
const SRC = {
  spot: ['EIA daily spot prices', 'https://www.eia.gov/dnav/pet/pet_pri_spt_s1_d.htm', 6 * H],
  fut: ['EIA NYMEX futures history (ended 2024-04-05)', 'https://www.eia.gov/dnav/pet/pet_pri_fut_s1_d.htm', 7 * DAY],
  wstk: ['EIA weekly petroleum stocks', 'https://www.eia.gov/petroleum/supply/weekly/', 6 * H],
  sndw: ['EIA weekly supply and product supplied', 'https://www.eia.gov/petroleum/supply/weekly/', 6 * H],
  wiup: ['EIA weekly refinery utilization', 'https://www.eia.gov/petroleum/supply/weekly/', 6 * H],
  crpdn: ['EIA monthly crude oil production by state', 'https://www.eia.gov/dnav/pet/pet_crd_crpdn_adc_mbblpd_m.htm', DAY],
  steo: ['EIA Short-Term Energy Outlook', STEO_PAGE, DAY],
  cme: ['CME Group NYMEX settlements (CL, BZ)', 'https://www.cmegroup.com/markets/energy/crude-oil/light-sweet-crude.settlements.html', 6 * H],
}

const NOTE = 'Prices are EIA daily spot assessments (LSEG data, posted a day or two late; Brent can trail the U.S. series), products converted from $/gal at 42 gal/bbl. ' +
  'Cracks are simple product − Brent spreads in $/bbl (no freight or quality adjustment; propane is a gas liquid, so its "crack" is deeply negative by nature). The 3-2-1 is the spot NY Harbor version (2 bbl conventional gasoline + 1 bbl ULSD − 3 bbl WTI Cushing, per bbl): EIA stopped publishing NYMEX futures prices on 2024-04-05, so the futures 3-2-1 and the C1–C2 / C1–C4 timespreads from EIA end there; the timespreads resume from the CME settlement archive, which starts when this page first ran, so there is a gap in between. ' +
  'The forward curves are CME settlement prices (personal use only); the curve 1 month / 3 months / 1 year ago fills in as the local archive accumulates. ' +
  'Inventories are EIA weekly (WPSR) estimates; the five-year range is the same week of the five previous calendar years (weeks are 7-day blocks counted from January 1). Implied demand is product supplied, a disappearance measure that swings week to week, so it is shown as 4-week averages. ' +
  'The world balance is EIA\'s Short-Term Energy Outlook: one agency\'s model, revised monthly; months from the release month on are projections. Country crude production (OPEC+ members) is history only, since STEO does not forecast it by country; the UAE, Brazil, Canada, Guyana and Norway are total liquids supply, which STEO does forecast.'

const sleep = t => new Promise(res => setTimeout(res, t))
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 2) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const mean = xs => { const v = xs.filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const pct = (a, b) => (fin(a) && fin(b) && b !== 0 ? (a / b - 1) * 100 : null)
const tms = d => Date.parse(`${d}T00:00:00Z`)
const iso = t => new Date(t).toISOString().slice(0, 10)
const shift = (d, n) => iso(tms(d) + n * DAY)
const doy = d => Math.round((tms(d) - Date.UTC(+d.slice(0, 4), 0, 1)) / DAY) + 1
const weekOf = d => Math.floor((doy(d) - 1) / 7) + 1 // 1–53: the year in 7-day blocks from Jan 1 (one Friday report in each of 1–52)
const monday = d => { const t = tms(d); return iso(t - ((new Date(t).getUTCDay() + 6) % 7) * DAY) }
const prevMonth = ym => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}` }
const nextMonth = ym => { const y = +ym.slice(0, 4), m = +ym.slice(5, 7); return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}` }
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']
// CME: "97.150" → 97.15, "+.070" → 0.07, "1,234" → 1234, "-" / "" → null, "UNCH" → 0
const num = s => {
  const t = String(s ?? '').trim().replace(/,/g, '')
  if (/^unch$/i.test(t)) return 0
  if (!t || t === '-' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null
  return Number(t)
}
const cmeMonth = s => { const m = /^([A-Z]{3})\s*(\d{2})$/i.exec(String(s || '').trim()), i = m ? MONTHS.indexOf(m[1].toUpperCase()) : -1; return i < 0 ? null : `20${m[2]}-${String(i + 1).padStart(2, '0')}` }
const mdyToIso = s => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '')); return m ? `${m[3]}-${m[1]}-${m[2]}` : null }
const isoToMdy = d => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`
// "October 6, 2026" → "2026-10-06"
const longDate = s => {
  const m = /^([A-Za-z]+)\s+(\d{1,2}),\s*(\d{4})$/.exec(String(s || '').trim()), i = m ? MONTHS.indexOf(m[1].slice(0, 3).toUpperCase()) : -1
  return i < 0 ? null : `${m[3]}-${String(i + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`
}

// the last point on or before date d (pts sorted ascending)
function on(pts, d) {
  let lo = 0, hi = pts.length - 1, out = null
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= d) { out = pts[mid]; lo = mid + 1 } else hi = mid - 1 }
  return out
}
const roundPts = (pts, d = 2) => pts.map(([k, v]) => [k, rnd(v, d)])
// chart sampling (keeps the payload near 500 KB): from `from`, the month-end print until five years before the last
// print, then the last print of each Mon–Sun week, then (daily series) every print for the last year
const spans = (last, daily) => { const mid = shift(last, -5 * 365); return { mid, dailyFrom: daily ? shift(last, -DAILY_DAYS) : mid } }
function chart(pts, { daily = true, dp = 2, from = CHART_FROM } = {}) {
  if (!pts.length) return []
  const { mid, dailyFrom } = spans(pts.at(-1)[0], daily), out = []
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], nx = pts[i + 1]
    if (p[0] < from) continue
    if (p[0] >= dailyFrom) out.push(p)
    else if (p[0] >= mid) { if (!nx || nx[0] >= dailyFrom || monday(nx[0]) !== monday(p[0])) out.push(p) }
    else if (!nx || nx[0] >= mid || nx[0].slice(0, 7) !== p[0].slice(0, 7)) out.push(p)
  }
  return roundPts(out, dp)
}
const sampling = (last, daily, from = CHART_FROM) => { if (!last) return null; const { mid, dailyFrom } = spans(last, daily); return `month-end prints ${from.slice(0, 7)} to ${mid.slice(0, 7)}, then weekly${daily ? ` to ${dailyFrom}, then daily` : ''}` }
function monthlyAvg(pts) {
  const by = new Map()
  for (const [d, v] of pts) { const k = d.slice(0, 7); const a = by.get(k) || [0, 0]; a[0] += v; a[1]++; by.set(k, a) }
  return [...by].map(([k, [s, n]]) => [k, s / n])
}
// daily join of two series on date: f(a, b)
function join(a, b, f) { const m = new Map(b); return a.filter(([d]) => m.has(d)).map(([d, v]) => [d, f(v, m.get(d))]) }
// trailing 4-print averages
const avg4 = pts => pts.map((p, i) => (i < 3 ? null : [p[0], (pts[i][1] + pts[i - 1][1] + pts[i - 2][1] + pts[i - 3][1]) / 4])).filter(Boolean)
// a weekly print about a year earlier (same week index 52 back, else the print on/before 364 days back)
const yearAgo = (pts, i) => (i >= 52 && Math.abs(tms(pts[i][0]) - tms(pts[i - 52][0]) - 364 * DAY) <= 3 * DAY ? pts[i - 52] : on(pts, shift(pts[i][0], -364)))

// five-year seasonal block for a weekly series: per week of year, min / max / average of the five previous calendar years, last year and this year
function seasonalOf(pts, dp = 2) {
  if (!pts.length) return null
  const last = pts.at(-1)[0], y = +last.slice(0, 4), cell = new Map()
  for (const [d, v] of pts) if (+d.slice(0, 4) >= y - 5) cell.set(`${d.slice(0, 4)}|${weekOf(d)}`, v)
  const prior = w => { const xs = []; for (let yy = y - 5; yy < y; yy++) for (const ww of w === 53 ? [52, 53] : [w]) { const v = cell.get(`${yy}|${ww}`); if (fin(v)) xs.push(v) } return xs }
  const weeks = []
  for (let w = 1; w <= 53; w++) {
    const xs = prior(w), lastYear = cell.get(`${y - 1}|${w}`) ?? null, thisYear = cell.get(`${y}|${w}`) ?? null
    if (w === 53 && lastYear == null && thisYear == null) continue
    weeks.push({ w, min: xs.length ? rnd(Math.min(...xs), dp) : null, max: xs.length ? rnd(Math.max(...xs), dp) : null, avg: rnd(mean(xs), dp), lastYear: rnd(lastYear, dp), thisYear: rnd(thisYear, dp) })
  }
  const xs = prior(weekOf(last))
  return { block: { years: [y - 5, y - 1], thisYear: y, week: weekOf(last), weeks }, avg5: mean(xs), n5: xs.length, min5: xs.length ? Math.min(...xs) : null, max5: xs.length ? Math.max(...xs) : null }
}
// five-year window statistics of a daily series at its last print
function fiveYear(pts) {
  if (!pts.length) return {}
  const [d, v] = pts.at(-1), from = shift(d, -5 * 365 - 1), xs = pts.filter(p => p[0] > from).map(p => p[1])
  return { avg5y: mean(xs), pctile5y: xs.length ? Math.round((xs.filter(x => x <= v).length / xs.length) * 100) : null, min5y: Math.min(...xs), max5y: Math.max(...xs), n5y: xs.length }
}

export function createOilMarket({ UA, dir, EIA_KEY }) {
  const CACHE = 'oil-market.json', FILE = path.join(dir, CACHE)
  const TMP = path.join(dir, 'data', 'cache', `${CACHE}.tmp`) // data/cache/ is gitignored
  let mem = null, raw = null, state = {}, inflight = null, loaded = false, broken = null, lastFail = 0, lastError = null, requests = 0

  const scrub = s => {
    let t = String(s?.message || s || '')
    if (EIA_KEY) t = t.split(EIA_KEY).join('***')
    return t.replace(/api_key=[^&\s"']+/gi, 'api_key=***').slice(0, 300)
  }
  function load() {
    try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch (e) {
      if (e?.code !== 'ENOENT') { broken = `${CACHE} could not be read (${e.message}); it holds the only CME curve history, so it is not written over until someone fixes or removes it`; console.warn(`Oil market: ${broken}`) }
      return null
    }
  }
  function save(o) {
    if (broken) return
    try { fs.mkdirSync(path.dirname(TMP), { recursive: true }); fs.writeFileSync(TMP, JSON.stringify(o)); fs.renameSync(TMP, FILE) } catch (e) { console.error(`${CACHE} save:`, e.message) }
  }

  // ── EIA ──
  async function eiaJson(url, label) {
    for (let a = 0; ; a++) {
      let r
      requests++
      try { r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(90_000) }) } catch (e) {
        if (a < 2) { await sleep(3000 * 2 ** a); continue }
        throw new Error(`${label}: ${scrub(e.name === 'TimeoutError' ? 'timed out' : e.cause?.code || e.message)}`)
      }
      if (r.ok) {
        const j = await r.json().catch(() => null)
        if (!j) throw new Error(`${label}: unreadable JSON`)
        if (j.error) throw new Error(`${label}: ${scrub(typeof j.error === 'string' ? j.error : j.error.message || j.error.code)}`)
        return j
      }
      const body = await r.text().catch(() => '')
      if ((r.status >= 500 || r.status === 429) && a < 2) { await sleep(3000 * 2 ** a); continue }
      let why = ''
      try { const e = JSON.parse(body).error; why = typeof e === 'string' ? e : e?.message || e?.code || '' } catch {}
      throw new Error(`${label}: HTTP ${r.status}${why ? ` (${scrub(why).slice(0, 120)})` : ''}`)
    }
  }
  // every series of one route from `start`, paged by 5,000 rows (the first page gives the total; the rest go
  // three at a time) → { id: [[period, value]] } ascending
  async function eiaPull(g, start) {
    const spec = GROUPS[g], facet = spec.facet || 'series', out = {}
    const page = offset => {
      const q = new URLSearchParams({ frequency: spec.freq, 'data[0]': 'value', start, 'sort[0][column]': 'period', 'sort[0][direction]': 'desc', 'sort[1][column]': facet, 'sort[1][direction]': 'asc', offset: String(offset), length: String(PAGE_ROWS) })
      for (const id of spec.ids) q.append(`facets[${facet}][]`, id)
      return eiaJson(`${EIA}/${spec.route}/data/?api_key=${encodeURIComponent(EIA_KEY)}&${q}`, `EIA ${spec.route}`)
    }
    const first = await page(0), total = +first.response?.total || 0, step = first.response?.data?.length || 0
    const offsets = []
    if (step) for (let o = step; o < total; o += step) offsets.push(o)
    if (offsets.length >= MAX_PAGES) throw new Error(`EIA ${spec.route}: ${total} rows is more than ${MAX_PAGES} pages`)
    const pages = [first]
    for (let i = 0; i < offsets.length; i += 3) pages.push(...await Promise.all(offsets.slice(i, i + 3).map(page)))
    let rows = 0
    for (const j of pages) for (const x of j.response?.data || []) { rows++; const v = parseFloat(x.value), id = x[facet]; if (id && x.period && fin(v)) (out[id] ||= new Map()).set(x.period, v) }
    if (rows < total) throw new Error(`EIA ${spec.route}: ${rows} of ${total} rows returned`)
    return Object.fromEntries(Object.entries(out).map(([id, m]) => [id, [...m].sort((a, b) => a[0].localeCompare(b[0]))]))
  }
  // one route's raw block: incremental from the last cached print (minus an overlap) unless a full pull is due
  async function eiaGroup(g, prev, warn) {
    if (!EIA_KEY) throw new Error('EIA_API_KEY not configured (free at eia.gov/opendata)')
    const spec = GROUPS[g], now = Date.now()
    const have = prev?.series && Object.values(prev.series).some(p => p?.length)
    const inc = !!(have && spec.fullEvery > 0 && prev.full && now - Date.parse(prev.full) < spec.fullEvery)
    let start = spec.start
    if (inc) {
      const lasts = Object.values(prev.series).filter(p => p?.length).map(p => p.at(-1)[0]).sort(), top = lasts.at(-1)
      start = shift(lasts.filter(d => tms(d) >= tms(top) - 60 * DAY)[0], -spec.overlap) // series that are still live; a dead one does not drag the window back
    }
    const got = await eiaPull(g, start)
    if (!Object.values(got).some(p => p.length)) throw new Error(`EIA ${spec.route}: no rows returned`)
    const series = {}
    for (const id of spec.ids) {
      const old = prev?.series?.[id] || [], nu = got[id] || []
      if (!nu.length) { series[id] = old; if (!inc) warn.push(`${id} returned no rows${old.length ? ' (kept the cached copy)' : ''}`); continue }
      series[id] = inc ? [...old.filter(p => p[0] < start), ...nu] : nu
    }
    return { asOf: new Date().toISOString(), full: inc ? prev.full : new Date().toISOString(), series }
  }
  async function fetchSteo(prev, warn) {
    const block = await eiaGroup('steo', prev, warn)
    if (!block.series[STEO.supply]?.length) throw new Error('EIA STEO: no world production rows')
    let release = null, nextRelease = null
    try {
      requests++
      const r = await fetch(STEO_PAGE, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(30_000) })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const html = (await r.text()).replace(/&nbsp;/g, ' ')
      release = longDate(/(?<!Next\s)Release Date:\s*(?:<\/?\w+[^>]*>\s*)*([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/.exec(html)?.[1])
      nextRelease = longDate(/Next Release Date:\s*(?:<\/?\w+[^>]*>\s*)*([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/.exec(html)?.[1])
      if (!release) throw new Error('no release date on the page')
    } catch (e) { warn.push(`release page: ${scrub(e.name === 'TimeoutError' ? 'timed out' : e.message)}; the vintage is inferred from the data`) }
    return { ...block, release, nextRelease }
  }

  // ── CME (same client as gpuFutures.js) ──
  async function cmeJson(url) {
    for (let a = 1; ; a++) {
      requests++
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', Referer: `${CME_BASE}/` }, signal: AbortSignal.timeout(20_000) })
        if (r.ok) return await r.json()
        r.body?.cancel().catch(() => {})
        const err = new Error(`CME HTTP ${r.status}`); err.status = r.status
        if (a >= 2 || r.status < 500) throw err
      } catch (e) {
        if (e.status || a >= 2) throw e.name === 'TimeoutError' ? new Error('CME timed out') : e
      }
      await sleep(1500)
    }
  }
  // the archive: { asOf, days: { 'YYYY-MM-DD': { CL: { t, rows: [[YYYY-MM, settle]], vol, oi }, BZ: … } } }, merged into the previous one
  async function fetchCme(prev, warn) {
    const days = { ...(prev?.days || {}) }, errs = []
    let lists = 0
    for (const { code, id } of Object.values(CME)) {
      let list
      try { list = await cmeJson(CME_DATES(id)); lists++ } catch (e) { errs.push(`${code} trade dates: ${e.message}`); continue }
      for (const [mdy, status] of Array.isArray(list) ? list : []) {
        const d = mdyToIso(mdy)
        if (!d || days[d]?.[code]?.t === 'Final') continue
        try {
          const j = await cmeJson(CME_SETTLE(id, isoToMdy(d)))
          if (j.empty || !Array.isArray(j.settlements) || !j.settlements.length) continue
          const rows = []
          let vol = null, oi = null
          for (const s of j.settlements) {
            if (/^total$/i.test(String(s.month || '').trim())) { vol = num(s.volume); oi = num(s.openInterest); continue }
            const ym = cmeMonth(s.month), v = num(s.settle)
            if (ym && fin(v)) rows.push([ym, v])
          }
          if (!rows.length) continue
          rows.sort((x, y) => x[0].localeCompare(y[0]))
          days[d] = { ...days[d], [code]: { t: j.reportType || status || null, rows: rows.slice(0, CME_KEEP), vol, oi } }
        } catch (e) { errs.push(`${code} ${d}: ${e.message}`) }
      }
    }
    if (!lists) throw new Error(errs.join('; ') || 'no trade dates')
    if (errs.length) warn.push(errs.join('; '))
    const dates = Object.keys(days).sort(), keepFrom = dates.length ? shift(dates.at(-1), -ARCHIVE_DAYS) : ''
    return {
      asOf: new Date().toISOString(),
      terms: 'CME Group settlement data: personal use only. Kept only in this gitignored cache; never commit it or copy it into a tracked file.',
      products: Object.fromEntries(Object.values(CME).map(p => [p.code, p.id])),
      days: Object.fromEntries(dates.filter(d => d >= keepFrom).map(d => [d, days[d]])),
    }
  }

  const fetchers = {
    spot: (p, w) => eiaGroup('spot', p, w), fut: (p, w) => eiaGroup('fut', p, w), wstk: (p, w) => eiaGroup('wstk', p, w),
    sndw: (p, w) => eiaGroup('sndw', p, w), wiup: (p, w) => eiaGroup('wiup', p, w), crpdn: (p, w) => eiaGroup('crpdn', p, w),
    steo: fetchSteo, cme: fetchCme,
  }

  // ── derive: one function per block ──
  function pricesOf(R) {
    const S = R.spot.series, bbl = {}
    for (const [id, [s, , gal]] of Object.entries(SPOT)) bbl[id] = (S[s] || []).map(([d, v]) => [d, gal ? v * GAL : v])
    const asOf = [bbl.wti.at(-1)?.[0], bbl.brent.at(-1)?.[0]].filter(Boolean).sort().at(-1) || null
    const latest = {}, series = {}
    for (const [id, pts] of Object.entries(bbl)) {
      if (!pts.length) { latest[id] = null; series[id] = []; continue }
      const [d, v] = pts.at(-1), back = n => on(pts, shift(d, -n))?.[1]
      latest[id] = { v: rnd(v), d, chg1w: rnd(pct(v, back(7))), chg1m: rnd(pct(v, back(30))), chg1y: rnd(pct(v, back(365))), stale: !!asOf && tms(asOf) - tms(d) > 14 * DAY }
      series[id] = chart(pts)
    }
    return {
      asOf, source: 'EIA daily spot prices (petroleum/pri/spt)', unit: '$/bbl', changes: '% change vs the last print on or before 7, 30 and 365 days earlier',
      sampling: sampling(asOf, true),
      labels: Object.fromEntries(Object.entries(SPOT).map(([id, [, label]]) => [id, label])), series, latest, raw: bbl,
    }
  }
  function cracksOf(P) {
    const { raw: b, asOf } = P, cr = {}
    for (const id of PRODUCTS) cr[id] = join(b[id], b.brent, (p, br) => p - br)
    cr['321'] = join(join(b.gasNYH, b.ulsdNYH, (g, u) => 2 * g + u), b.wti, (gu, w) => (gu - 3 * w) / 3)
    const usgc321 = join(join(b.gasUSGC, b.ulsdUSGC, (g, u) => 2 * g + u), b.wti, (gu, w) => (gu - 3 * w) / 3)
    const stat = pts => {
      if (!pts.length) return null
      const [d, v] = pts.at(-1), f = fiveYear(pts)
      return { v: rnd(v), d, avg5y: rnd(f.avg5y), pctile5y: f.pctile5y, vs5y: rnd(fin(f.avg5y) ? v - f.avg5y : null), min5y: rnd(f.min5y), max5y: rnd(f.max5y), chg1m: rnd(fin(on(pts, shift(d, -30))?.[1]) ? v - on(pts, shift(d, -30))[1] : null) }
    }
    const latest = Object.fromEntries(Object.entries(cr).map(([id, pts]) => [id, stat(pts)]))
    latest['321USGC'] = stat(usgc321)
    if (latest.propane && P.latest.brent?.v) latest.propane.pctOfBrent = rnd((P.latest.propane.v / P.latest.brent.v) * 100, 1)
    const labels = Object.fromEntries(PRODUCTS.map(id => [id, `${SPOT[id][1]} − Brent`]))
    labels['321'] = 'NY Harbor 3-2-1 vs WTI (spot: 2 gasoline + 1 ULSD − 3 WTI, per bbl)'
    labels['321USGC'] = 'Gulf Coast 3-2-1 vs WTI (spot; latest only)'
    return {
      asOf: Object.values(cr).map(p => p.at(-1)?.[0]).filter(Boolean).sort().at(-1) || null, source: 'Derived from EIA daily spot prices', unit: '$/bbl',
      stats: 'avg5y / pctile5y / min5y / max5y over the daily prints of the five years to the latest print; vs5y = latest − avg5y; chg1m in $/bbl',
      sampling: sampling(asOf, true),
      labels, series: Object.fromEntries(Object.entries(cr).map(([id, pts]) => [id, chart(pts)])), latest,
    }
  }
  function timespreadsOf(R) {
    const F = R.fut?.series || {}, c1 = F[FUT.c1] || []
    const eia12 = join(c1, F[FUT.c2] || [], (a, b) => a - b), eia14 = join(c1, F[FUT.c4] || [], (a, b) => a - b)
    const eiaEnd = c1.at(-1)?.[0] || null
    const cme12 = [], cme14 = []
    for (const d of Object.keys(R.cme?.days || {}).sort()) {
      if (eiaEnd && d <= eiaEnd) continue
      const rows = R.cme.days[d].CL?.rows || []
      if (rows.length >= 2) cme12.push([d, rows[0][1] - rows[1][1]])
      if (rows.length >= 4) cme14.push([d, rows[0][1] - rows[3][1]])
    }
    const d12 = [...eia12, ...cme12], d14 = [...eia14, ...cme14]
    const regimes = []
    const byM = new Map()
    for (const [d, v] of d14) { const k = d.slice(0, 7), a = byM.get(k) || [0, 0]; if (v > 0) a[0]++; a[1]++; byM.set(k, a) }
    for (const [k, [b, n]] of byM) regimes.push([k, Math.round((b / n) * 100)])
    const rb = F[FUT.rb1] || [], ho = F[FUT.ho1] || []
    const nymex321 = join(join(rb, ho, (r, h) => (2 * r + h) * GAL), c1, (rh, w) => (rh - 3 * w) / 3)
    const last12 = d12.at(-1), last14 = d14.at(-1)
    return {
      asOf: last14?.[0] || last12?.[0] || null, source: `EIA NYMEX futures (contracts 1, 2, 4) through ${eiaEnd || 'n/a'}; CME CL settlements (M1, M2, M4) from ${cme12[0]?.[0] || 'the first archived day'}`,
      unit: '$/bbl, C1 − Cn: positive = backwardation', since: d12[0]?.[0] || null,
      c1c2: roundPts(monthlyAvg(d12)), c1c4: roundPts(monthlyAvg(d14)), sampling: 'monthly averages of daily spreads; regimes = % of days in the month with C1 − C4 > 0',
      regimes, daily: { c1c2: chart(cme12, { from: '1983-01-01' }), c1c4: chart(cme14, { from: '1983-01-01' }) }, dailySampling: 'CME archive days: daily for the last year, weekly before',
      eiaEnd, cmeFrom: cme12[0]?.[0] || null, gap: eiaEnd && cme12.length ? { from: shift(eiaEnd, 1), to: shift(cme12[0][0], -1) } : null,
      latest: last12 ? { d: last12[0], c1c2: rnd(last12[1]), c1c4: rnd(last14?.[1]), source: cme12.length ? 'CME' : 'EIA' } : null,
      nymex321: { asOf: nymex321.at(-1)?.[0] || null, unit: '$/bbl', label: 'NYMEX 3-2-1 vs WTI (futures contract 1: 2 RBOB + 1 HO/ULSD − 3 CL), monthly average; EIA stopped publishing futures on 2024-04-05', series: roundPts(monthlyAvg(nymex321)) },
    }
  }
  function curveOf(R) {
    const days = R.cme?.days || {}, dates = Object.keys(days).sort()
    const crv = (d, code) => (days[d]?.[code]?.rows || []).slice(0, CURVE_N).map(([month, settle]) => ({ month, settle }))
    const dW = dates.filter(d => days[d].CL?.rows?.length).at(-1), dB = dates.filter(d => days[d].BZ?.rows?.length).at(-1)
    if (!dW && !dB) return null
    const latestD = [dW, dB].filter(Boolean).sort().at(-1)
    const wti = dW ? crv(dW, 'CL') : [], brent = dB ? crv(dB, 'BZ') : []
    const spreadsOf = c => { const s = i => c[i]?.settle, dd = i => (fin(s(0)) && fin(s(i)) ? rnd(s(0) - s(i)) : null); return { m1m2: dd(1), m1m3: dd(2), m1m7: dd(6), m1m13: dd(12) } }
    const structure = sp => (!fin(sp.m1m2) ? null : sp.m1m2 > 0 && (sp.m1m7 ?? 1) > 0 ? 'backwardation' : sp.m1m2 < 0 && (sp.m1m7 ?? -1) < 0 ? 'contango' : 'mixed')
    const sw = spreadsOf(wti), sb = spreadsOf(brent)
    const common = brent.find(b => wti.some(w => w.month === b.month))
    const past = {}
    for (const [k, n] of [['1M', 30], ['3M', 91], ['1Y', 365]]) {
      const target = shift(latestD, -n), d = dates.filter(x => x <= target).at(-1)
      past[k] = d && tms(target) - tms(d) <= 7 * DAY ? { date: d, wti: crv(d, 'CL'), brent: crv(d, 'BZ') } : null
    }
    // one row per archived day (daily for the last year, the last day of each week before)
    const dailyFrom = shift(latestD, -DAILY_DAYS)
    const history = dates.filter((d, i) => d >= dailyFrom || !dates[i + 1] || monday(dates[i + 1]) !== monday(d))
      .map(d => { const w = crv(d, 'CL'), b = crv(d, 'BZ'), x = spreadsOf(w), y = spreadsOf(b); return [d, w[0]?.settle ?? null, x.m1m2, x.m1m7, x.m1m13, b[0]?.settle ?? null, y.m1m2, y.m1m7, y.m1m13] })
    return {
      asOf: latestD, source: 'CME Group daily settlements: NYMEX CL (WTI, id 425) and BZ (Brent Last Day Financial, id 424). Personal use only.',
      unit: '$/bbl', dates: { wti: dW || null, brent: dB || null }, reportType: { wti: dW ? days[dW].CL.t : null, brent: dB ? days[dB].BZ.t : null },
      wti, brent, past,
      spreads: {
        wti: sw, brent: sb, brentWti: fin(brent[0]?.settle) && fin(wti[0]?.settle) ? rnd(brent[0].settle - wti[0].settle) : null,
        brentWtiFront: { brent: brent[0]?.month || null, wti: wti[0]?.month || null },
        brentWtiSameMonth: common ? { month: common.month, v: rnd(common.settle - wti.find(w => w.month === common.month).settle) } : null,
      },
      structure: { wti: structure(sw), brent: structure(sb) },
      archiveDays: dates.length, archiveFrom: dates[0] || null,
      history, historyCols: ['date', 'wtiM1', 'wtiM1M2', 'wtiM1M7', 'wtiM1M13', 'brentM1', 'brentM1M2', 'brentM1M7', 'brentM1M13'],
    }
  }
  function inventoriesOf(R) {
    const W = R.wstk.series
    const items = Object.entries(STOCKS).map(([id, [s, label]]) => {
      const pts = (W[s] || []).map(([d, v]) => [d, v / 1000])
      if (!pts.length) return { id, label, series: [], error: `${s}: no data` }
      const [d, v] = pts.at(-1), prev = pts.at(-2)?.[1], sea = seasonalOf(pts), ya = yearAgo(pts, pts.length - 1)
      return {
        id, label, eia: s, d, latest: rnd(v), chg1w: rnd(fin(prev) ? v - prev : null), chg4w: rnd(pts.length > 4 ? v - pts.at(-5)[1] : null), yoy: rnd(ya ? v - ya[1] : null),
        avg5y: rnd(sea.avg5), vs5y: rnd(fin(sea.avg5) ? v - sea.avg5 : null), vs5yPct: rnd(pct(v, sea.avg5)), min5y: rnd(sea.min5), max5y: rnd(sea.max5),
        seasonal: sea.block, series: chart(pts, { daily: false }),
      }
    })
    const asOf = items.map(i => i.d).filter(Boolean).sort().at(-1) || null
    return {
      asOf, source: 'EIA Weekly Petroleum Status Report (petroleum/stoc/wstk)', unit: 'million bbl', sampling: sampling(asOf, false),
      method: 'vs5y = latest − the average of the same week (7-day block of the year) in the five previous calendar years; chg in million bbl', items,
    }
  }
  function sprOf(R) {
    const pts = (R.wstk.series[SPR] || []).map(([d, v]) => [d, v / 1000])
    if (!pts.length) return null
    const [d, v] = pts.at(-1), pk = pts.reduce((m, p) => (p[1] > m[1] ? p : m)), since83 = pts.filter(p => p[0] >= '1983-01-01')
    const lo = since83.reduce((m, p) => (p[1] < m[1] ? p : m), since83[0] || pts[0])
    const at = n => on(pts, shift(d, -n))?.[1]
    const pace = n => (fin(at(n)) ? ((v - at(n)) * 1000) / n : null) // million bbl → thousand b/d
    return {
      asOf: d, source: 'EIA weekly SPR stocks (WCSSTUS1)', unit: 'million bbl', latest: rnd(v), chg1w: rnd(fin(pts.at(-2)?.[1]) ? v - pts.at(-2)[1] : null),
      peak: { v: rnd(pk[1]), d: pk[0] }, low: { v: rnd(lo[1]), d: lo[0], since: '1983' }, atLow: v <= lo[1],
      fromPeak: rnd(v - pk[1]), chg52w: rnd(fin(at(364)) ? v - at(364) : null), pace52w: rnd(pace(364), 0), pace13w: rnd(pace(91), 0), paceUnit: 'thousand b/d (+ = refill, − = release)',
      series: chart(pts, { daily: false, from: '1982-01-01' }), sampling: sampling(d, false, pts[0][0]),
    }
  }
  const flowStat = pts => {
    if (!pts.length) return null
    const a = avg4(pts), i = a.length - 1, ya = i >= 0 ? yearAgo(a, i) : null, l = a[i]
    return { v: rnd(pts.at(-1)[1], 0), d: pts.at(-1)[0], avg4w: rnd(l?.[1], 0), yoy4w: rnd(l && ya ? l[1] - ya[1] : null, 0), yoy4wPct: rnd(l && ya ? pct(l[1], ya[1]) : null, 1) }
  }
  function supplyOf(R) {
    const S = R.sndw?.series || {}, pts = id => S[SNDW[id]] || []
    const net = join(pts('imports'), pts('exports'), (i, e) => i - e)
    const C = R.crpdn?.series || {}
    const byState = R.crpdn ? {
      asOf: Object.values(STATES).map(([s]) => C[s]?.at(-1)?.[0]).filter(Boolean).sort().at(-1) || null, source: 'EIA monthly crude oil production (petroleum/crd/crpdn)', unit: 'thousand b/d',
      ids: Object.keys(STATES), labels: Object.fromEntries(Object.entries(STATES).map(([id, [, l]]) => [id, l])),
      series: Object.fromEntries(Object.entries(STATES).map(([id, [s]]) => [id, roundPts(C[s] || [], 0)])),
      latest: Object.fromEntries(Object.entries(STATES).map(([id, [s]]) => { const p = C[s] || [], l = p.at(-1), ya = l ? p.find(x => x[0] === `${+l[0].slice(0, 4) - 1}${l[0].slice(4)}`) : null; return [id, l ? { v: rnd(l[1], 0), m: l[0], yoy: rnd(ya ? l[1] - ya[1] : null, 0), share: rnd(C.MCRFPUS2?.length ? (l[1] / (on(C.MCRFPUS2, l[0])?.[1] || NaN)) * 100 : null, 1) } : null] })),
    } : null
    if (!R.sndw) return byState ? { asOf: null, byState } : null
    const asOf = pts('production').at(-1)?.[0] || null, wk = id => chart(pts(id), { daily: false, dp: 0 })
    return {
      asOf, source: 'EIA weekly supply estimates (petroleum/sum/sndw)', unit: 'thousand b/d', sampling: sampling(asOf, false),
      production: wk('production'), imports: wk('imports'), exports: wk('exports'),
      latest: { production: flowStat(pts('production')), imports: flowStat(pts('imports')), exports: flowStat(pts('exports')), netImports: flowStat(net) },
      byState,
    }
  }
  function demandOf(R) {
    const S = R.sndw.series
    const items = Object.entries(DEMAND).map(([id, label]) => {
      const pts = S[SNDW[id]] || [], st = flowStat(pts)
      return { id, label, eia: SNDW[id], d: st?.d || null, latest: st?.v ?? null, latest4w: st?.avg4w ?? null, yoy4w: st?.yoy4w ?? null, yoy4wPct: st?.yoy4wPct ?? null, series: chart(avg4(pts), { daily: false, dp: 0 }) }
    })
    const asOf = items.map(i => i.d).filter(Boolean).sort().at(-1) || null
    return {
      asOf, source: 'EIA weekly product supplied (petroleum/sum/sndw)', unit: 'thousand b/d', sampling: sampling(asOf, false),
      method: 'product supplied (implied demand), 4-week average; yoy4w = latest 4-week average − the 4-week average 52 weeks earlier (thousand b/d), yoy4wPct in %', items,
    }
  }
  function refiningOf(R) {
    const u = R.wiup?.series?.[UTIL] || [], inputs = R.sndw?.series?.[SNDW.inputs] || []
    if (!u.length && !inputs.length) return null
    const sea = u.length ? seasonalOf(u, 1) : null, l = u.at(-1)
    return {
      asOf: [l?.[0], inputs.at(-1)?.[0]].filter(Boolean).sort().at(-1) || null, source: 'EIA weekly refinery utilization (WPULEUS3) and refiner net crude input (WCRRIUS2)',
      utilization: u.length ? { unit: '% of operable capacity', d: l[0], latest: rnd(l[1], 1), chg1w: rnd(u.length > 1 ? l[1] - u.at(-2)[1] : null, 1), avg5y: rnd(sea.avg5, 1), vs5y: rnd(fin(sea.avg5) ? l[1] - sea.avg5 : null, 1), seasonal: sea.block, series: chart(u, { daily: false, dp: 1 }) } : null,
      inputs: chart(inputs, { daily: false, dp: 0 }), inputsLatest: flowStat(inputs), inputsUnit: 'thousand b/d', sampling: sampling(l?.[0], false),
    }
  }
  function steoOf(R) {
    const blk = R.steo, T = blk.series, M = id => new Map(T[id] || [])
    const months = (T[STEO.supply] || []).map(p => p[0])
    // vintage: country history ends the month before the release month; the release page names the date
    const probe = VINTAGE_PROBE.map(id => T[id]?.at(-1)?.[0]).filter(Boolean).sort().at(-1)
    const inferred = probe ? nextMonth(probe) : null, pageM = blk.release ? blk.release.slice(0, 7) : null
    const relM = inferred || pageM || null
    const proj = m => !!relM && m >= relM
    const k = v => rnd(fin(v) ? v * 1000 : null, 0) // million b/d → thousand b/d
    const sup = M(STEO.supply), dem = M(STEO.demand), oecd = M(STEO.oecd)
    const ser = (id, f = k) => (T[id] || []).filter(p => p[0] >= STEO_OUT).map(([m, v]) => [m, f(v), proj(m)])
    const balance = months.filter(m => m >= STEO_OUT).map(m => [m, k(sup.get(m)), k(dem.get(m)), k(fin(sup.get(m)) && fin(dem.get(m)) ? sup.get(m) - dem.get(m) : null), proj(m)])
    const lastActual = relM ? prevMonth(relM) : months.at(-1)
    const snap = m => (m && sup.has(m) ? { month: m, supply: k(sup.get(m)), demand: k(dem.get(m)), stockChange: k(sup.get(m) - dem.get(m)), oecdStocks: rnd(oecd.get(m)), opecSpare: k(M(STEO.spare).get(m)), brent: rnd(M(STEO.brent).get(m)), wti: rnd(M(STEO.wti).get(m)) } : null)
    const years = [...new Set(months.map(m => m.slice(0, 4)))].filter(y => +y >= +(lastActual || '2000').slice(0, 4) - 2)
    const annual = years.map(y => {
      const ms = months.filter(m => m.startsWith(y)), s = mean(ms.map(m => sup.get(m))), d = mean(ms.map(m => dem.get(m)))
      return { year: +y, supply: k(s), demand: k(d), stockChange: k(fin(s) && fin(d) ? s - d : null), projectedMonths: ms.filter(proj).length, months: ms.length, oecdStocksEnd: rnd(oecd.get(ms.at(-1))) }
    })
    const check = M(STEO.draw), gap = mean(months.map(m => (fin(sup.get(m)) && fin(dem.get(m)) && fin(check.get(m)) ? Math.abs(sup.get(m) - dem.get(m) + check.get(m)) : null)))
    return {
      release: blk.release && (!inferred || blk.release.slice(0, 7) === inferred) ? blk.release : null, releaseMonth: relM, releaseFromPage: blk.release || null, nextRelease: blk.nextRelease || null,
      vintageCheck: pageM && inferred && pageM !== inferred ? `release page says ${blk.release} but the data end like a ${inferred} vintage; projections flagged from ${inferred}` : null,
      asOf: blk.release || relM, lastActual, fetched: blk.asOf, source: 'EIA Short-Term Energy Outlook (api.eia.gov/v2/steo)', unit: 'thousand b/d (oecdStocks million bbl, prices $/bbl)',
      balance, balanceCols: ['month', 'supply', 'demand', 'stockChange (+ = build)', 'projected'], balanceCheck: rnd(fin(gap) ? gap * 1000 : null, 1),
      oecdStocks: ser(STEO.oecd, v => rnd(v)), since: STEO_OUT,
      opec: { crude: ser(STEO.opec), spare: ser(STEO.spare), capacity: ser(STEO.capacity) }, opecPlus: ser(STEO.opecPlus),
      nonOpec: ser(STEO.nonOpec), usCrude: ser(STEO.usCrude),
      priceForecast: { brent: ser(STEO.brent, v => rnd(v)), wti: ser(STEO.wti, v => rnd(v)) },
      producers: PRODUCERS.map(([id, s, label, measure]) => ({ id, label, measure, eia: s, series: ser(s) })),
      now: snap(lastActual), end: snap(months.at(-1)), annual,
      ids: { ...STEO, producers: Object.fromEntries(PRODUCERS.map(p => [p[0], p[1]])) },
    }
  }

  function derive(R, st) {
    const errs = [], sources = []
    for (const [n, [label, url]] of Object.entries(SRC)) {
      const s = st[n] || {}, blk = R[n]
      if (s.ok === false) errs.push(`${label}: ${s.error}${blk ? ` — serving the copy fetched ${String(blk.asOf).slice(0, 10)}` : ' — no fallback'}`)
      for (const w of s.warn || []) errs.push(`${label}: ${w}`)
      sources.push({ id: n, label, url, fetched: blk?.asOf || null, from: blk ? (s.ok === false ? 'cache' : 'live') : 'none' })
    }
    const hard = st && Object.values(st).some(s => s.ok === false)
    const safe = (name, need, fn) => {
      if (!need) return null
      try { return fn() } catch (e) { errs.push(`${name}: could not be derived (${scrub(e)})`); console.warn(`Oil market ${name}:`, scrub(e)); return null }
    }
    const P = safe('prices', R.spot, () => pricesOf(R))
    const cracks = safe('cracks', P, () => cracksOf(P))
    const prices = P ? (({ raw: _r, ...rest }) => rest)(P) : null
    return {
      built: new Date().toISOString(), stale: !!hard, sourceErrors: errs, sources, note: NOTE,
      prices, cracks,
      timespreads: safe('timespreads', R.fut || R.cme, () => timespreadsOf(R)),
      curve: safe('curve', R.cme, () => curveOf(R)),
      inventories: safe('inventories', R.wstk, () => inventoriesOf(R)),
      spr: safe('spr', R.wstk, () => sprOf(R)),
      supply: safe('supply', R.sndw || R.crpdn, () => supplyOf(R)),
      demand: safe('demand', R.sndw, () => demandOf(R)),
      refining: safe('refining', R.wiup || R.sndw, () => refiningOf(R)),
      steo: safe('steo', R.steo, () => steoOf(R)),
    }
  }

  const dueAt = () => Math.min(...Object.keys(SRC).map(n => state[n]?.nextAt ?? 0))

  async function refresh() {
    const now = Date.now(), prev = raw || {}, R = { ...prev }, warns = {}
    requests = 0
    const due = Object.keys(SRC).filter(n => now >= (state[n]?.nextAt ?? 0))
    const res = await Promise.allSettled(due.map(n => { warns[n] = []; return fetchers[n](prev[n] || null, warns[n]) }))
    const st = { ...state }
    res.forEach((r, i) => {
      const n = due[i], at = new Date().toISOString()
      if (r.status === 'fulfilled') { R[n] = r.value; st[n] = { ok: true, at, nextAt: now + SRC[n][2], warn: warns[n] } }
      else st[n] = { ok: false, at, error: scrub(r.reason), nextAt: now + (R[n] ? RETRY : RETRY_EMPTY), warn: warns[n] }
    })
    state = st
    if (!R.spot && !R.wstk) {
      raw = R
      throw new Error(`EIA prices and stocks unavailable (${due.map(n => st[n]?.error).filter(Boolean).join('; ').slice(0, 300)})`)
    }
    const payload = derive(R, st)
    payload.requests = requests
    mem = payload; raw = R
    save({ version: 1, payload, raw: R, state: st })
    const bad = due.filter(n => st[n]?.ok === false)
    console.log(`Oil market: ${due.length} source(s) refreshed in ${requests} request(s)${bad.length ? `, failed: ${bad.join(', ')}` : ''}`)
    return payload
  }

  function startRefresh() {
    if (inflight) return inflight
    inflight = refresh()
      .then(p => { lastError = null; return p })
      .catch(e => { lastFail = Date.now(); lastError = scrub(e); console.warn('Oil market:', lastError); if (mem) return { ...mem, stale: true }; throw new Error(lastError) })
      .finally(() => { inflight = null })
    return inflight
  }

  async function get() {
    if (!loaded) {
      loaded = true
      const disk = load()
      if (disk?.version === 1 && disk.raw) {
        raw = disk.raw; state = disk.state || {}
        // re-derive from the cached raw blocks so a code change shows without refetching
        try { mem = { ...derive(raw, state), built: disk.payload?.built || new Date().toISOString(), requests: disk.payload?.requests ?? null } } catch (e) { console.warn('Oil market re-derive:', scrub(e)); mem = disk.payload || null }
      }
    }
    const out = () => (broken && mem ? { ...mem, sourceErrors: [...mem.sourceErrors, broken] } : mem)
    if (mem && Date.now() < dueAt()) return out()
    if (mem) { startRefresh().catch(() => {}); return { ...out(), stale: true, refreshing: true } }
    if (lastError && Date.now() - lastFail < RETRY_EMPTY) throw new Error(lastError)
    return startRefresh()
  }

  return { get }
}
