// ============================================================================
// LONG RUN — the historical half, data/seeds/long-run-history.json.
//
// Historical tab → Interest rates / Inflation / Growth. These datasets are
// finished history (or updated once a year), so they are parsed once on this
// machine by scripts/refresh-seeds.mjs and committed; server/longRun.js joins
// them to FRED's modern series at serve time.
//
//   Shiller (Yale, ie_data.xls)   monthly U.S. long-term government yield
//                                 1871→1953 (Homer & Sylla, then FRED GS10)
//                                 and the price index 1871→1912 (Warren &
//                                 Pearson wholesale prices before the CPI)
//   Jordà–Schularick–Taylor       Macrohistory Database R6, 18 economies,
//                                 1870→2020: real GDP per capita (Maddison),
//                                 population, CPI, short and long rates.
//                                 Licence CC BY-NC-SA 4.0, www.macrohistory.net
//   Bank of England               "A millennium of macroeconomic data" v3.1,
//                                 UK/England 1209→2016: CPI, Bank Rate (1694),
//                                 consols (1703), 10-year gilts (1929),
//                                 corporate bonds (1854), real GDP (1270),
//                                 England real GDP per capita (1270)
//   Schmelzing (BoE SWP 845)      global and "safe asset provider" nominal,
//                                 inflation and real rates, 7-year averages,
//                                 1311→2018
//   Minneapolis Fed               U.S. CPI and inflation, annual, 1800→
//
// Every series is stored as { s: first period, v: [values…] } — years for
// annual data, "YYYY-MM" for monthly — with nulls for gaps.
// ============================================================================
import XLSX from 'xlsx'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
export const SEED_NAME = 'long-run-history.json'
const SRC = {
  shiller: 'http://www.econ.yale.edu/~shiller/data/ie_data.xls',
  jst: 'https://www.macrohistory.net/app/download/9834512569/JSTdatasetR6.xlsx',
  boe: 'https://www.bankofengland.co.uk/-/media/boe/files/statistics/research-datasets/a-millennium-of-macroeconomic-data-for-the-uk.xlsx',
  schmelzing: 'https://www.bankofengland.co.uk/-/media/boe/files/working-paper/2020/eight-centuries-of-global-real-interest-rates-r-g-and-the-suprasecular-decline-1311-2018-data.xlsx',
  minneapolis: 'https://www.minneapolisfed.org/about-us/monetary-policy/inflation-calculator/consumer-price-index-1800-',
}
export const JST_NAMES = {
  AUS: 'Australia', BEL: 'Belgium', CAN: 'Canada', CHE: 'Switzerland', DEU: 'Germany', DNK: 'Denmark', ESP: 'Spain', FIN: 'Finland', FRA: 'France',
  GBR: 'United Kingdom', IRL: 'Ireland', ITA: 'Italy', JPN: 'Japan', NLD: 'Netherlands', NOR: 'Norway', PRT: 'Portugal', SWE: 'Sweden', USA: 'United States',
}

const num = v => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null)
const r3 = v => (v == null ? null : Math.round(v * 1000) / 1000)
async function get(url, as = 'buffer') {
  const r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(300_000) })
  if (!r.ok) throw new Error(`${url} HTTP ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  if (as === 'text') return buf.toString('utf8')
  // a download page instead of the file (the JST site serves one for a wrong id)
  if (/^\s*</.test(buf.subarray(0, 64).toString('latin1'))) throw new Error(`${url} returned a web page, not a spreadsheet`)
  return buf
}
// annual { year: value } → { s, v } over the years present, nulls for gaps
function annualSeries(map) {
  const ys = Object.keys(map).map(Number).filter(y => map[y] != null).sort((a, b) => a - b)
  if (!ys.length) return null
  const s = ys[0], e = ys[ys.length - 1]
  return { s, v: Array.from({ length: e - s + 1 }, (_, i) => r3(map[s + i] ?? null)) }
}
const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`

// ── Shiller: monthly long rate to 1953-03 and price index to 1912-12 ──
function shiller(buf) {
  const wb = XLSX.read(buf)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets.Data, { header: 1, defval: '' })
  const h = rows.findIndex(r => String(r[0]).trim() === 'Date')
  if (h < 0 || !/GS10/.test(String(rows[h][6])) || !/CPI/.test(String(rows[h][4]))) throw new Error('Shiller: Date / CPI / Rate GS10 columns moved')
  const rate = [], cpi = []
  for (const r of rows.slice(h + 1)) {
    if (typeof r[0] !== 'number') continue
    const y = Math.floor(r[0]), m = Math.round((r[0] - y) * 100)
    if (m < 1 || m > 12) continue
    if (y < 1953 || (y === 1953 && m <= 3)) rate.push(r3(num(r[6])))
    if (y < 1913) cpi.push(r3(num(r[4])))
  }
  if (rate.length < 900 || cpi.length < 480) throw new Error(`Shiller: short series (${rate.length} rates, ${cpi.length} prices)`)
  return { longRate: { s: '1871-01', v: rate }, cpi: { s: '1871-01', v: cpi } }
}

// ── JST: 18 economies, annual 1870–2020 ──
function jst(buf) {
  const wb = XLSX.read(buf)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' })
  const head = rows[0], ix = k => { const i = head.indexOf(k); if (i < 0) throw new Error(`JST: no ${k} column`); return i }
  const c = { year: ix('year'), iso: ix('iso'), pop: ix('pop'), gdppc: ix('rgdpmad'), cpi: ix('cpi'), stir: ix('stir'), ltrate: ix('ltrate'), crisis: ix('crisisJST') }
  const by = {}
  for (const r of rows.slice(1)) {
    const iso = r[c.iso], y = num(r[c.year])
    if (!JST_NAMES[iso] || y == null) continue
    const o = (by[iso] ||= { pop: {}, gdppc: {}, cpi: {}, stir: {}, ltrate: {}, crises: [] })
    for (const k of ['pop', 'gdppc', 'cpi', 'stir', 'ltrate']) o[k][y] = num(r[c[k]])
    if (num(r[c.crisis]) === 1) o.crises.push(y)
  }
  const countries = {}
  for (const [iso, o] of Object.entries(by)) countries[iso] = { pop: annualSeries(o.pop), gdppc: annualSeries(o.gdppc), cpi: annualSeries(o.cpi), stir: annualSeries(o.stir), ltrate: annualSeries(o.ltrate), crises: o.crises }
  if (Object.keys(countries).length < 18) throw new Error('JST: fewer than 18 economies')
  return { names: JST_NAMES, countries }
}

// ── Bank of England millennium dataset: headline sheet + England GDP per capita ──
function boe(buf) {
  const wb = XLSX.read(buf, { sheets: ['A1. Headline series', 'A21. GDP per capita 1086+'] })
  const a1 = XLSX.utils.sheet_to_json(wb.Sheets['A1. Headline series'], { header: 1, defval: '' })
  const desc = a1[3].map(x => String(x).replace(/\s+/g, ' ').trim().toLowerCase())
  const col = re => { const i = desc.findIndex(d => re.test(d)); if (i < 0) throw new Error(`BoE A1: no column matching ${re}`); return i }
  const cols = {
    cpi: col(/^consumer price index$/), inflation: col(/^consumer price inflation$/), bankRate: col(/^bank rate$/),
    consols: col(/^consols \/ long-term government bond yields$/), gilt10: col(/^10 year\/medium-term government bond yields$/),
    corporate: col(/^corporate bond yields$/), gdp: col(/^composite estimate of english and/), gdpGrowth: col(/^composite estimate of english and/) + 1,
  }
  const out = {}
  for (const [k, j] of Object.entries(cols)) {
    const m = {}
    for (const r of a1.slice(7)) { const y = num(r[0]); if (y != null) m[y] = num(r[j]) }
    out[k] = annualSeries(m)
  }
  const a21 = XLSX.utils.sheet_to_json(wb.Sheets['A21. GDP per capita 1086+'], { header: 1, defval: '' })
  if (!/real gdp per capita/i.test(String(a21[4][8]))) throw new Error('BoE A21: England real GDP per capita column moved')
  const pc = {}
  for (const r of a21.slice(5)) { const y = num(r[0]); if (y != null) pc[y] = num(r[8]) }
  out.gdppcEngland = annualSeries(pc)
  if (!out.bankRate || out.bankRate.s !== 1694 || !out.cpi || out.cpi.s > 1210) throw new Error('BoE: headline series look wrong')
  return out
}

// ── Schmelzing: headline series, 7-year averages ──
function schmelzing(buf) {
  const wb = XLSX.read(buf)
  const rows = XLSX.utils.sheet_to_json(wb.Sheets['II. Headline series'], { header: 1, defval: '' })
  const head = rows[1].map(x => String(x).trim().toLowerCase())
  const want = { globalNominal: 'global sovereign nominal', globalInflation: 'global inflation', globalReal: 'global r', safeNominal: 'safe asset provider nominal', safeReal: 'safe asset provider real' }
  const out = {}
  for (const [k, label] of Object.entries(want)) {
    const j = head.indexOf(label)
    if (j < 0) throw new Error(`Schmelzing: no "${label}" column`)
    const m = {}
    for (const r of rows.slice(2)) { const y = num(r[0]); if (y != null) m[y] = num(r[j]) }
    out[k] = annualSeries(m)
  }
  return out
}

// ── Minneapolis Fed: CPI and inflation since 1800 (a trailing "2026*" is an estimate) ──
function minneapolis(html) {
  const rows = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map(m => [...m[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(c => c[1].replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').trim()))
  const cpi = {}, infl = {}
  let estimateFrom = null
  for (const r of rows) {
    const m = /^(\d{4})(\*?)$/.exec(r[0] || '')
    if (!m) continue
    const y = Number(m[1])
    if (m[2] && estimateFrom == null) estimateFrom = y
    cpi[y] = num(String(r[1]).replace(/,/g, ''))
    infl[y] = num(String(r[2]).replace('%', ''))
  }
  const out = { cpi: annualSeries(cpi), inflation: annualSeries(infl), estimateFrom }
  if (!out.cpi || out.cpi.s !== 1800 || out.cpi.v.length < 220) throw new Error('Minneapolis Fed: table looks wrong')
  return out
}

export async function buildLongRunSeed({ log = console.log } = {}) {
  log('long run: Shiller'); const sh = shiller(await get(SRC.shiller))
  log('long run: Jordà–Schularick–Taylor macrohistory'); const j = jst(await get(SRC.jst))
  log('long run: Bank of England millennium dataset (26 MB)'); const b = boe(await get(SRC.boe))
  log('long run: Schmelzing eight centuries'); const s = schmelzing(await get(SRC.schmelzing))
  log('long run: Minneapolis Fed CPI since 1800'); const mp = minneapolis(await get(SRC.minneapolis, 'text'))
  return {
    version: 1, fetchedAt: new Date().toISOString(),
    sources: {
      shiller: { url: SRC.shiller, note: 'Robert J. Shiller, Irrational Exuberance data; long rate before 1953 from Homer & Sylla, prices before 1913 from Warren & Pearson wholesale prices' },
      jst: { url: 'https://www.macrohistory.net/database/', note: 'Jordà, Schularick and Taylor (2017), Macrofinancial History and the New Business Cycle Facts, NBER Macroeconomics Annual 2016; Macrohistory Database R6. Licence CC BY-NC-SA 4.0' },
      boe: { url: 'https://www.bankofengland.co.uk/statistics/research-datasets', note: 'Thomas and Dimsdale (2017), A Millennium of UK Data, Bank of England OBRA dataset v3.1' },
      schmelzing: { url: 'https://www.bankofengland.co.uk/working-paper/2020/eight-centuries-of-global-real-interest-rates-r-g-and-the-suprasecular-decline-1311-2018', note: 'Paul Schmelzing (2020), Bank of England Staff Working Paper 845' },
      minneapolis: { url: SRC.minneapolis, note: 'Federal Reserve Bank of Minneapolis, Consumer Price Index 1800–' },
    },
    shiller: sh, jst: j, boe: b, schmelzing: s, minneapolis: mp,
  }
}
