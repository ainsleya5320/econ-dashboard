// ============================================================================
// SHARE OF THE WORLD: wealth measured as a share of what the whole world
// produces, after Li Lu (Columbia Graham & Dodd event, Oct 2026): "wealth in
// the end is the percentage ownership of global purchasing power". The measure
// is an asset's value ÷ world nominal GDP in U.S. dollars at market exchange
// rates. If world GDP in dollars grows ~5% a year, an asset compounding at 5%
// only holds its share.
//
// Three pieces, one feed (/api/share-of-world):
//   world      World GDP in current dollars (market rates) and at PPP, 1980
//              through the WEO's projections (projFrom marks the first), its
//              y/y growth and trailing 10-year CAGR: the hurdle an asset has to
//              clear to gain share.
//   assets     Growth of $1 from the start of 1928 (end-of-year values, nominal
//              USD, income reinvested) for the S&P 500, 3-month T-bills, 10-year
//              Treasuries, Baa corporates, U.S. home prices (Shiller / Case-
//              Shiller, price only, no rent), gold, and cash (a dollar bill,
//              always 1). Each one also as value ÷ world GDP in USD, rebased to
//              1980 = 100, and CAGRs since 1980 / last 10 / last 20 years against
//              world GDP's.
//   countries  Every IMF economy's share of world output at market rates and at
//              PPP in the latest year of actuals and ten years earlier, and its
//              share of world stock-market value (World Bank) against its share
//              of world GDP. A capToGdp below 1 means fewer investor dollars per
//              dollar of economy ("fish where the fish are"). countryHistory
//              has the yearly shares, projections included, for the 30 largest
//              economies plus China, India, Indonesia, Vietnam, Saudi Arabia,
//              Brazil, Mexico, Türkiye and Poland.
//
// Sources (all keyless, browser user agent):
//   IMF DataMapper  imf.org/external/datamapper/api/v1/{NGDPD, PPPGDP, countries,
//                   indicators}: GDP in current $bn and in PPP international $bn
//                   for every economy plus the WEOWORLD aggregate. The vintage
//                   ("World Economic Outlook (October 2026)") is the indicators
//                   metadata's source line. The WEO publishes the current year
//                   onward as projections, so projFrom = the vintage's year (an
//                   October 2026 vintage is still read as projecting 2026 in
//                   January 2027). DataMapper does not flag each country's
//                   "estimates start after" year, so some economies' latest
//                   "actual" year is an IMF estimate. PPP shares are PPPGDP ÷
//                   WEOWORLD PPPGDP, which equals the IMF's PPPSH to three
//                   decimals (checked Oct 2026), so PPPSH is not requested.
//                   curl gets an Akamai 403 from imf.org; Node's fetch gets
//                   through. imf.org also refuses Netlify's build machines (see
//                   server/tradeFlows.js), hence the tracked seed below.
//   World Bank      api.worldbank.org/v2/country/all/indicator/CM.MKT.LCAP.CD:
//                   market capitalization of listed domestic companies, current
//                   US$, 2000 → this year, one page (per_page=20000). WLD is the
//                   world total. It counts only the markets that report, so
//                   shares of WLD run a little high. As of Oct 2026 (WB updated
//                   2026-10-08) 2025 is in, but the U.K. ends in 2022, France,
//                   Belgium and Ireland in 2018 (Euronext stopped being split by
//                   country), the Netherlands in 2017, Norway in 2019, Russia in
//                   2023, Israel in 2024, Italy in 2014, Sweden in 2003, Denmark
//                   in 2004, and Taiwan (not a World Bank member) has no data.
//                   Hong Kong is its own market: mainland companies listed there
//                   (Tencent, Alibaba) count under HKG, not CHN.
//   Damodaran       pages.stern.nyu.edu/~adamodar/pc/datasets/histretSP.xls,
//                   sheet "Returns by year": annual returns 1928 → the last full
//                   year (updated each January) for the S&P 500 incl. dividends,
//                   3-month T-bill, 10-year T-bond, Baa corporate bond, real
//                   estate (home prices) and gold, plus small caps and CPI (kept
//                   in the seed, not served). Columns are found by header text.
//                   The sheet's "Date updated" cell is stale (2021) and is not
//                   used. Parsed with the xlsx package the other server modules
//                   use.
//
// Rules:
//   - Assets: share = (value ÷ world GDP in USD at market rates), rebased so
//     1980 = 100. Values are end-of-year and GDP is the year's flow. CAGRs run
//     from end-1980 / end-(E−10) / end-(E−20) to end-E, where E is the last
//     year both Damodaran and IMF actuals cover. The world CAGR uses GDP in
//     those same years.
//   - Countries: latestYear is the last year before projFrom. Shares are % of
//     WEOWORLD in the same year, "10" is ten years earlier, chg*10 are
//     percentage-point changes. gdpUsd and mcapUsd are $bn.
//   - Market cap: each country's latest World Bank year, as long as it is no
//     more than 10 years before mcapYear (older is null). shareMcap is % of WLD
//     in that same year. capToGdp = shareMcap ÷ the country's market-rate GDP
//     share in that same year, so a stale market cap is compared with GDP from
//     the same year, not with today's. mcapYear (top level) is the latest year
//     with a WLD total and at least 80% of the decade's peak reporting count.
//   - Each source is all-or-nothing, live first, then its tracked seed (one
//     build never mixes two WEO vintages). A live success rewrites the seed when
//     its content changed. A source with neither live data nor a seed gives
//     null blocks and a line in sourceErrors. Serving a seed also adds a line.
//
// Cadence: stale-while-revalidate. A GET answers from the cache at once and
// refreshes in the background when the cache is over 24 hours old. The first
// GET with no cache waits (1-5 s live, instant from the seeds). A failed
// refresh (every source down and no seeds) is retried after an hour, as is a
// cached build missing a whole block. Never throws: with nothing at all it
// returns null blocks plus sourceErrors, and caches nothing.
// 6 requests a refresh: IMF NGDPD (~160 KB), PPPGDP (~160 KB), countries
// (~7 KB), indicators (~48 KB); World Bank (~1.7 MB); Damodaran xls (~0.5 MB).
//
// Files:
//   share-of-world.json                      (root, gitignored) the full response
//   data/seeds/share-of-world-imf.json       (tracked) IMF NGDPD + PPPGDP for
//                                            every economy and the world, and
//                                            World Bank market caps, one economy
//                                            per line, for Netlify builds and
//                                            offline runs
//   data/seeds/damodaran-histret.json        (tracked) the parsed annual-returns
//                                            table with source URL and fetch date
// Seeds and cache are written through a temp file renamed in.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'

const H = 3600e3, TTL = 24 * H, RETRY = H
const DM = 'https://www.imf.org/external/datamapper/api/v1'
const WB = 'https://api.worldbank.org/v2/country/all/indicator/CM.MKT.LCAP.CD'
const HISTRET = 'https://pages.stern.nyu.edu/~adamodar/pc/datasets/histretSP.xls'
const Y0 = 1980, MCAP_Y0 = 2000, MCAP_MAX_AGE = 10, TOP_N = 30
const EXTRA = ['CHN', 'IND', 'IDN', 'VNM', 'SAU', 'BRA', 'MEX', 'TUR', 'POL']
const SEED_IMF = path.join('data', 'seeds', 'share-of-world-imf.json')
const SEED_DAM = path.join('data', 'seeds', 'damodaran-histret.json')
const CACHE = 'share-of-world.json'

// Damodaran's header row ("Year", "S&P 500 (includes dividends)", …): the first
// column from the left whose header matches, i.e. the annual-returns block, not
// the "Value of $100" block to its right.
const COLS = [
  { key: 'stocks', re: /^S&P 500/i, need: true },
  { key: 'smallCap', re: /small cap/i },
  { key: 'bills', re: /T\.?\s?Bill/i, need: true },
  { key: 'bonds', re: /T\.?\s?Bond/i, need: true },
  { key: 'corp', re: /Baa/i, need: true },
  { key: 'realEstate', re: /^Real Estate/i, need: true },
  { key: 'gold', re: /^Gold/i, need: true },
  { key: 'inflation', re: /^Inflation/i },
]
const ASSETS = [
  { id: 'stocks', label: 'S&P 500 (dividends reinvested)' },
  { id: 'bills', label: '3-month T-bills' },
  { id: 'bonds', label: '10-year Treasuries' },
  { id: 'corp', label: 'Baa corporate bonds' },
  { id: 'realEstate', label: 'U.S. home prices (no rent)' },
  { id: 'gold', label: 'Gold' },
  { id: 'cash', label: 'Cash (a dollar bill)' },
]

const fin = v => v != null && Number.isFinite(v)
const rd = (v, d) => (fin(v) ? +v.toFixed(d) : null)
const sig = v => (fin(v) ? +v.toPrecision(6) : null)
const range = (a, b) => Array.from({ length: Math.max(0, b - a + 1) }, (_, i) => a + i)
const cagr = (a, b, n) => (fin(a) && fin(b) && a > 0 && b > 0 && n > 0 ? ((b / a) ** (1 / n) - 1) * 100 : null)
// {"1980": 2857.3, …} → {1980: 2857.3, …}, finite values only
const yearMap = o => Object.fromEntries(Object.entries(o || {}).filter(([y, v]) => /^\d{4}$/.test(y) && typeof v === 'number' && Number.isFinite(v)).map(([y, v]) => [+y, v]))
// year map ⇄ [firstYear, [values…]] for the seed (nulls fill gaps)
const toArr = (o, d = 3) => { const ys = Object.keys(o || {}).map(Number).sort((a, b) => a - b); return ys.length ? [ys[0], range(ys[0], ys.at(-1)).map(y => rd(o[y], d))] : null }
const fromArr = a => (Array.isArray(a) ? Object.fromEntries(a[1].map((v, i) => [a[0] + i, v]).filter(([, v]) => fin(v))) : {})
const lastYear = o => Math.max(...Object.keys(o || {}).map(Number).filter(fin), -Infinity)
const isoDay = s => (fin(Date.parse(s)) ? new Date(s).toISOString().slice(0, 10) : null)

// IMF labels, shortened for tables: "Korea, Republic of" → "Korea"
const NAME_FIX = {
  CHN: 'China', HKG: 'Hong Kong', MAC: 'Macao', KOR: 'Korea', RUS: 'Russia', TUR: 'Türkiye', TWN: 'Taiwan',
  BHS: 'Bahamas', GMB: 'Gambia', COD: 'DR Congo', COG: 'Congo', FSM: 'Micronesia', LAO: 'Laos', SSD: 'South Sudan',
}
const cleanName = (iso, n) => NAME_FIX[iso] || String(n || iso).trim().replace(/, (Republic of|Kingdom of|Islamic Republic of|Arab Republic of|The|State of)$/, '')

export function createShareOfWorld({ UA, dir }) {
  const file = n => path.join(dir, n)
  const readJson = n => { try { if (fs.existsSync(file(n))) return JSON.parse(fs.readFileSync(file(n), 'utf8')) } catch (e) { console.warn(`share-of-world: ${n} unreadable (${e.message})`) } return null }
  const writeText = (n, text) => {
    const f = file(n), tmp = `${f}.tmp-${process.pid}`
    try { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(tmp, text); fs.renameSync(tmp, f); return true }
    catch (e) { console.warn(`share-of-world: ${n} not written (${e.message})`); try { fs.unlinkSync(tmp) } catch {} return false }
  }
  let mem = null, inflight = null, lastFail = 0, lastError = null

  async function fetchOk(url, ms, accept) {
    for (let a = 0; ; a++) {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: accept }, signal: AbortSignal.timeout(ms) })
      if (r.ok) return r
      if (r.status >= 500 && a < 1) { await new Promise(res => setTimeout(res, 2000)); continue }
      throw new Error(`${new URL(url).hostname} HTTP ${r.status}`)
    }
  }
  const getJson = async (url, ms = 60_000) => {
    const r = await fetchOk(url, ms, 'application/json')
    const t = await r.text()
    try { return JSON.parse(t) } catch { throw new Error(`${new URL(url).hostname}: not JSON (${t.slice(0, 60).replace(/\s+/g, ' ')})`) }
  }

  // ── IMF DataMapper ──────────────────────────────────────────────────────────
  async function imfLive() {
    const [ngdpd, ppp, ctry, ind] = await Promise.all([getJson(`${DM}/NGDPD`), getJson(`${DM}/PPPGDP`), getJson(`${DM}/countries`), getJson(`${DM}/indicators`)])
    const usd = ngdpd?.values?.NGDPD, pp = ppp?.values?.PPPGDP, labels = ctry?.countries
    if (!usd?.WEOWORLD || !pp?.WEOWORLD) throw new Error('DataMapper: no WEOWORLD aggregate in NGDPD/PPPGDP')
    if (!labels) throw new Error('DataMapper: no country list')
    const meta = ind?.indicators?.NGDPD || {}
    const countries = {}
    for (const iso of Object.keys(labels)) {
      if (!usd[iso] && !pp[iso]) continue
      countries[iso] = { name: cleanName(iso, labels[iso]?.label), usd: yearMap(usd[iso]), ppp: yearMap(pp[iso]) }
    }
    if (Object.keys(countries).length < 150 || !countries.USA || !countries.CHN) throw new Error(`DataMapper: only ${Object.keys(countries).length} economies`)
    return {
      vintage: String(meta.source || '').match(/\(([A-Z][a-z]+ \d{4})\)/)?.[1] || null, lastModified: meta['last-modified'] || null,
      fetchedAt: new Date().toISOString(), world: { usd: yearMap(usd.WEOWORLD), ppp: yearMap(pp.WEOWORLD) }, countries,
    }
  }

  // ── World Bank market capitalization ────────────────────────────────────────
  async function wbLive() {
    const j = await getJson(`${WB}?format=json&per_page=20000&date=${MCAP_Y0}:${new Date().getUTCFullYear()}`, 90_000)
    const meta = j?.[0], rows = j?.[1]
    if (!Array.isArray(rows) || !rows.length) throw new Error(`World Bank: ${meta?.message?.[0]?.value || 'no rows'}`)
    if (meta.pages > 1) throw new Error(`World Bank: ${meta.pages} pages (expected one)`)
    const mcap = {}
    for (const r of rows) {
      const iso = r.countryiso3code, v = r.value
      if (!/^[A-Z]{3}$/.test(iso || '') || !fin(v)) continue
      ;(mcap[iso] ||= {})[+r.date] = rd(v / 1e9, 3) // $bn, at the seed's precision so live and seed builds match
    }
    if (!mcap.WLD) throw new Error('World Bank: no WLD total')
    return { lastUpdated: meta.lastupdated || null, fetchedAt: new Date().toISOString(), mcap }
  }

  // ── Damodaran annual returns ────────────────────────────────────────────────
  function parseHistret(buf) {
    const wb = XLSX.read(buf, { type: 'buffer' })
    const names = ['Returns by year', ...wb.SheetNames.filter(n => n !== 'Returns by year')]
    for (const name of names) {
      const ws = wb.Sheets[name]
      if (!ws) continue
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null })
      const h = rows.findIndex(r => String(r[0] ?? '').trim() === 'Year' && r.some(c => /S&P 500/i.test(String(c ?? ''))))
      if (h < 0) continue
      const head = rows[h].map(c => String(c ?? '').trim())
      const cols = {}
      for (const c of COLS) { const i = head.findIndex(x => c.re.test(x)); if (i > 0) cols[c.key] = i }
      const missing = COLS.filter(c => c.need && cols[c.key] == null).map(c => c.key)
      if (missing.length) throw new Error(`histretSP: no column for ${missing.join(', ')}`)
      const years = [], returns = Object.fromEntries(Object.keys(cols).map(k => [k, []]))
      for (const r of rows.slice(h + 1)) {
        const y = r[0]
        if (!Number.isInteger(y) || y < 1900 || y > 2100) break
        if (years.length && y !== years.at(-1) + 1) throw new Error(`histretSP: year ${y} after ${years.at(-1)}`)
        years.push(y)
        for (const [k, i] of Object.entries(cols)) returns[k].push(fin(r[i]) ? +r[i].toFixed(8) : null)
      }
      const columns = Object.fromEntries(Object.entries(cols).map(([k, i]) => [k, head[i]]))
      return { sheet: name, columns, years, returns }
    }
    throw new Error('histretSP: no "Year / S&P 500" header row found')
  }
  function checkHistret(d) {
    const n = d.years.length, y1 = d.years.at(-1)
    if (d.years[0] !== 1928 || n < 90) throw new Error(`histretSP: ${n} years from ${d.years[0]}`)
    if (y1 < new Date().getUTCFullYear() - 2) throw new Error(`histretSP: last year ${y1}`)
    for (const c of COLS.filter(c => c.need)) {
      const bad = d.returns[c.key].findIndex(v => !fin(v) || v <= -1 || v > 3)
      if (bad >= 0) throw new Error(`histretSP: ${c.key} ${d.years[bad]} = ${d.returns[c.key][bad]}`)
    }
    // a column check against a known year: the S&P 500 lost ~37% in 2008
    const r08 = d.returns.stocks[d.years.indexOf(2008)]
    if (!(r08 < -0.3 && r08 > -0.45)) throw new Error(`histretSP: S&P 500 2008 = ${r08}, columns misread`)
    return d
  }
  async function damLive() {
    const r = await fetchOk(HISTRET, 60_000, '*/*')
    const d = checkHistret(parseHistret(Buffer.from(await r.arrayBuffer())))
    return { ...d, lastModified: r.headers.get('last-modified') || null, fetchedAt: new Date().toISOString() }
  }

  // ── seeds ───────────────────────────────────────────────────────────────────
  function readImfSeed() {
    const s = readJson(SEED_IMF)
    const imf = s?.imf?.world && s.imf.countries ? {
      vintage: s.imf.vintage, lastModified: s.imf.lastModified, fetchedAt: s.imf.fetchedAt,
      world: { usd: fromArr(s.imf.world.usd), ppp: fromArr(s.imf.world.ppp) },
      countries: Object.fromEntries(Object.entries(s.imf.countries).map(([iso, c]) => [iso, { name: c.name, usd: fromArr(c.usd), ppp: fromArr(c.ppp) }])),
    } : null
    const wb = s?.wb?.mcap ? { lastUpdated: s.wb.lastUpdated, fetchedAt: s.wb.fetchedAt, mcap: Object.fromEntries(Object.entries(s.wb.mcap).map(([iso, a]) => [iso, fromArr(a)])) } : null
    return { imf, wb }
  }
  // one economy per line; written only when the data (not the fetch time) changed
  function writeImfSeed(imf, wb) {
    const prev = readJson(SEED_IMF)
    const imfPart = imf && {
      vintage: imf.vintage, lastModified: imf.lastModified,
      world: { usd: toArr(imf.world.usd), ppp: toArr(imf.world.ppp) },
      countries: Object.fromEntries(Object.entries(imf.countries).sort(([a], [b]) => a.localeCompare(b)).map(([iso, c]) => [iso, { name: c.name, usd: toArr(c.usd), ppp: toArr(c.ppp) }])),
    }
    const wbPart = wb && { lastUpdated: wb.lastUpdated, mcap: Object.fromEntries(Object.entries(wb.mcap).sort(([a], [b]) => (a === 'WLD' ? -1 : b === 'WLD' ? 1 : a.localeCompare(b))).map(([iso, o]) => [iso, toArr(o, 3)])) }
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
    const strip = o => { if (!o) return null; const { fetchedAt, source, ...rest } = o; return rest }
    const imfNew = imfPart && !same(strip(prev?.imf), imfPart), wbNew = wbPart && !same(strip(prev?.wb), wbPart)
    if (!imfNew && !wbNew) return false
    const I = imfNew ? { source: `${DM}/{NGDPD,PPPGDP}: GDP, current prices, $bn at market exchange rates (usd) and PPP international $bn (ppp); WEOWORLD = world. [firstYear, [values…]]; years from projFrom (the vintage's year) on are WEO projections`, ...imfPart, fetchedAt: imf.fetchedAt } : prev?.imf
    const W = wbNew ? { source: `${WB}: market capitalization of listed domestic companies, current US$ bn; WLD = world (reporting markets only). [firstYear, [values…]]`, ...wbPart, fetchedAt: wb.fetchedAt } : prev?.wb
    const head = o => JSON.stringify(Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'countries' && k !== 'mcap'))).slice(0, -1)
    const lines = ['{"about":"Seed for server/shareOfWorld.js: IMF WEO GDP (DataMapper) and World Bank stock-market capitalization. imf.org refuses Netlify build machines, so the module falls back to this file; it rewrites it whenever a live fetch brings different data.",']
    if (I) lines.push(`"imf":${head(I)},"countries":{`, Object.entries(I.countries).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n'), `}}${W ? ',' : ''}`)
    if (W) lines.push(`"wb":${head(W)},"mcap":{`, Object.entries(W.mcap).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n'), '}}')
    lines.push('}')
    return writeText(SEED_IMF, lines.join('\n') + '\n')
  }
  function readDamSeed() {
    const s = readJson(SEED_DAM)
    return s?.years?.length && s.returns?.stocks ? s : null
  }
  function writeDamSeed(d) {
    const prev = readDamSeed()
    if (prev && JSON.stringify([prev.years, prev.returns, prev.columns]) === JSON.stringify([d.years, d.returns, d.columns])) return false
    const head = { source: 'Aswath Damodaran, "Historical Returns on Stocks, Bonds and Bills" (NYU Stern), annual returns as decimals, nominal USD, income reinvested; real estate = home prices only', url: HISTRET, sheet: d.sheet, lastModified: d.lastModified, fetchedAt: d.fetchedAt, lastYear: d.years.at(-1), columns: d.columns }
    const lines = [JSON.stringify(head).slice(0, -1) + ',', `"years":${JSON.stringify(d.years)},`, '"returns":{', Object.entries(d.returns).map(([k, v]) => `${JSON.stringify(k)}:${JSON.stringify(v)}`).join(',\n'), '}}']
    return writeText(SEED_DAM, lines.join('\n') + '\n')
  }

  // ── build ───────────────────────────────────────────────────────────────────
  async function build() {
    const sourceErrors = []
    const [imfR, wbR, damR] = await Promise.allSettled([imfLive(), wbLive(), damLive()])
    const seeds = readImfSeed(), damSeed = readDamSeed()
    const pick = (label, res, seed, seedAsOf) => {
      if (res.status === 'fulfilled') return { v: res.value, live: true }
      const err = res.reason?.message || String(res.reason)
      console.warn(`share-of-world: ${label}: ${err}${seed ? ' (using the seed)' : ''}`)
      sourceErrors.push({ source: label, error: seed ? `${err} (serving the tracked seed fetched ${seedAsOf(seed)})` : err })
      return { v: seed || null, live: false }
    }
    const I = pick('IMF DataMapper', imfR, seeds.imf, s => `${String(s.fetchedAt).slice(0, 10)}, WEO ${s.vintage}`)
    const W = pick('World Bank market cap', wbR, seeds.wb, s => `${String(s.fetchedAt).slice(0, 10)}, World Bank update ${s.lastUpdated}`)
    const D = pick('Damodaran histretSP.xls', damR, damSeed, s => `${String(s.fetchedAt).slice(0, 10)}, returns to ${s.lastYear}`)
    const imf = I.v, dam = D.v
    // nothing live and no seeds: a failed refresh (retried in an hour), not a cached page of nulls
    if (!imf && !W.v && !dam) throw new Error(sourceErrors.map(e => `${e.source}: ${e.error}`).join('; '))
    // market caps for IMF economies and the world only (the World Bank's regional aggregates are dropped)
    const wb = W.v && imf ? { ...W.v, mcap: Object.fromEntries(Object.entries(W.v.mcap).filter(([iso]) => iso === 'WLD' || imf.countries[iso])) } : W.v
    if (I.live || (W.live && imf)) writeImfSeed(I.live ? imf : null, W.live && imf ? wb : null)
    if (D.live) writeDamSeed(dam)

    // ── world ──
    let world = null, projFrom = null, latestYear = null, weoVintage = null
    const wUsd = imf?.world.usd || {}, wPpp = imf?.world.ppp || {}
    if (imf) {
      weoVintage = imf.vintage ? `World Economic Outlook (${imf.vintage})` : null
      const vy = +String(imf.vintage || '').match(/\d{4}/)?.[0]
      projFrom = fin(vy) ? vy : new Date().getUTCFullYear()
      const years = range(Y0, lastYear(wUsd)).filter(y => fin(wUsd[y]))
      latestYear = years.filter(y => y < projFrom).at(-1) ?? null
      world = {
        years,
        gdpUsd: years.map(y => rd(wUsd[y], 1)), gdpPpp: years.map(y => rd(wPpp[y], 1)),
        growthUsd: years.map(y => (fin(wUsd[y - 1]) ? rd((wUsd[y] / wUsd[y - 1] - 1) * 100, 2) : null)),
        cagr10: years.map(y => rd(cagr(wUsd[y - 10], wUsd[y], 10), 2)),
      }
    }

    // ── assets ──
    let assets = null, cagrTo = null
    if (dam) {
      const years = dam.years, lastY = years.at(-1)
      const grow = rs => { let v = 1; return rs.map(r => (v *= 1 + r)) }
      const series = ASSETS.map(a => ({ id: a.id, label: a.label, raw: a.id === 'cash' ? years.map(() => 1) : grow(dam.returns[a.id]) }))
      const at = (s, y) => s.raw[years.indexOf(y)]
      let share = null, worldCagr = null
      const E = cagrTo = imf && latestYear != null ? Math.min(lastY, latestYear) : lastY
      if (imf && fin(wUsd[Y0])) {
        const sy = range(Y0, lastY).filter(y => fin(wUsd[y]))
        share = { years: sy, series: series.map(s => { const base = at(s, Y0) / wUsd[Y0]; return { id: s.id, values: sy.map(y => rd((at(s, y) / wUsd[y] / base) * 100, 2)) } }) }
        worldCagr = { since1980: rd(cagr(wUsd[Y0], wUsd[E], E - Y0), 2), last10: rd(cagr(wUsd[E - 10], wUsd[E], 10), 2), last20: rd(cagr(wUsd[E - 20], wUsd[E], 20), 2) }
      }
      assets = {
        source: `Aswath Damodaran, Historical Returns on Stocks, Bonds and Bills, ${years[0]}–${lastY} (${HISTRET}${isoDay(dam.lastModified) ? `, file dated ${isoDay(dam.lastModified)}` : ''}; fetched ${String(dam.fetchedAt).slice(0, 10)}${D.live ? '' : ', tracked seed'}). Real estate is U.S. home prices (Shiller / Case-Shiller), price only; gold is the year-end price.`,
        lastYear: lastY, years,
        series: series.map(s => ({ id: s.id, label: s.label, values: s.raw.map(sig) })),
        share,
        cagr: series.map(s => ({ id: s.id, since1980: rd(cagr(at(s, Y0), at(s, E), E - Y0), 2), last10: rd(cagr(at(s, E - 10), at(s, E), 10), 2), last20: rd(cagr(at(s, E - 20), at(s, E), 20), 2) })),
        worldCagr,
      }
    }

    // ── countries ──
    let countries = null, countryHistory = null, mcapYear = null, mcapReporting = null
    const wld = wb?.mcap?.WLD || {}
    if (wb) {
      const yrs = Object.keys(wld).map(Number).sort((a, b) => a - b)
      const count = y => Object.entries(wb.mcap).filter(([iso, o]) => iso !== 'WLD' && fin(o[y])).length
      const peak = Math.max(0, ...yrs.filter(y => y >= yrs.at(-1) - 10).map(count))
      mcapYear = yrs.filter(y => count(y) >= 0.8 * peak).at(-1) ?? yrs.at(-1) ?? null
      mcapReporting = mcapYear != null ? { n: count(mcapYear), peak } : null
    }
    if (imf && latestYear != null) {
      const shareU = (c, y) => (fin(c.usd[y]) && fin(wUsd[y]) ? (c.usd[y] / wUsd[y]) * 100 : null)
      const shareP = (c, y) => (fin(c.ppp[y]) && fin(wPpp[y]) ? (c.ppp[y] / wPpp[y]) * 100 : null)
      const y10 = latestYear - 10
      const diff = (a, b) => (fin(a) && fin(b) ? a - b : null)
      countries = Object.entries(imf.countries).filter(([, c]) => fin(c.usd[latestYear])).map(([iso, c]) => {
        const su = shareU(c, latestYear), su10 = shareU(c, y10), sp = shareP(c, latestYear), sp10 = shareP(c, y10)
        const m = wb?.mcap?.[iso] || {}
        const my = mcapYear == null ? null : Object.keys(m).map(Number).filter(y => y <= mcapYear && y >= mcapYear - MCAP_MAX_AGE && fin(wld[y])).sort((a, b) => b - a)[0] ?? null
        const shareMcap = my != null ? (m[my] / wld[my]) * 100 : null
        const suM = my != null ? shareU(c, my) : null
        return {
          iso3: iso, name: c.name, gdpUsd: rd(c.usd[latestYear], 1),
          shareUsd: rd(su, 3), shareUsd10: rd(su10, 3), sharePpp: rd(sp, 3), sharePpp10: rd(sp10, 3),
          chgUsd10: rd(diff(su, su10), 3), chgPpp10: rd(diff(sp, sp10), 3),
          mcapUsd: my != null ? rd(m[my], 1) : null, mcapYear: my, shareMcap: rd(shareMcap, 3),
          capToGdp: fin(shareMcap) && suM > 0 ? rd(shareMcap / suM, 2) : null,
        }
      }).sort((a, b) => imf.countries[b.iso3].usd[latestYear] - imf.countries[a.iso3].usd[latestYear] || a.iso3.localeCompare(b.iso3))
      const pickIso = [...new Set([...countries.slice(0, TOP_N).map(c => c.iso3), ...EXTRA.filter(iso => imf.countries[iso])])]
      const yEnd = lastYear(wUsd)
      countryHistory = Object.fromEntries(pickIso.map(iso => {
        const c = imf.countries[iso]
        const ys = range(Y0, yEnd).filter(y => fin(shareU(c, y)) || fin(shareP(c, y)))
        return [iso, { years: ys, shareUsd: ys.map(y => rd(shareU(c, y), 3)), sharePpp: ys.map(y => rd(shareP(c, y), 3)) }]
      }))
    }

    // ── note ──
    const parts = []
    if (imf) parts.push(`IMF ${weoVintage || 'WEO (vintage unknown)'}${I.live ? '' : ' from the tracked seed'}: ${latestYear} is the latest year of actuals and ${projFrom}–${lastYear(wUsd)} are projections; some economies' ${latestYear} figures are IMF estimates. World GDP is the IMF's WEOWORLD aggregate at market exchange rates (USD) or at PPP (international dollars); PPP shares are each economy's PPP GDP ÷ the world's.`)
    if (wb && mcapYear != null && countries) {
      const top = countries.slice(0, 40)
      const stale = top.filter(c => c.mcapYear != null && c.mcapYear < mcapYear).map(c => `${c.name} ${c.mcapYear}`)
      const none = top.filter(c => c.mcapYear == null).map(c => { const ys = Object.keys(wb.mcap[c.iso3] || {}).map(Number); return ys.length ? `${c.name} (last ${Math.max(...ys)})` : c.name })
      parts.push(`Stock-market value is the World Bank's market capitalization of listed domestic companies (WB update ${wb.lastUpdated || 'n/a'}${W.live ? '' : ', tracked seed'}); ${mcapYear} is the latest year with broad coverage (${mcapReporting.n} economies, peak ${mcapReporting.peak} in the decade). The world total counts reporting markets only, so shares of it run a little high.${stale.length ? ` Older years used for ${stale.join(', ')}.` : ''}${none.length ? ` No usable figure (none, or over ${MCAP_MAX_AGE} years old) for ${none.join(', ')}.` : ''} Taiwan is not a World Bank member. Hong Kong is listed separately from China, and mainland companies listed in Hong Kong count there. capToGdp = share of world market cap ÷ share of world GDP (market rates) in the same year: below 1, fewer investor dollars per dollar of economy.`)
    }
    if (assets) {
      const E = cagrTo
      parts.push(`Asset values are growth of $1 invested at the start of ${assets.years[0]}, nominal USD, end of year, income reinvested (Damodaran, through ${assets.lastYear}${D.live ? '' : ', tracked seed'}); cash is a dollar bill. Share of the world = value ÷ world GDP in USD at market rates, 1980 = 100. CAGRs run to ${E}: since1980 from end-1980, last10 from end-${E - 10}, last20 from end-${E - 20}.${assets.share && projFrom != null && assets.share.years.at(-1) >= projFrom ? ` From ${projFrom} the share uses the WEO's projection of world GDP.` : ''}`)
    }
    return {
      built: new Date().toISOString(), stale: sourceErrors.length > 0, sourceErrors, weoVintage, projFrom,
      world, assets, countries, countryHistory, latestYear, mcapYear, note: parts.join(' ') || null,
    }
  }

  function startRefresh() {
    if (inflight || Date.now() - lastFail < RETRY) return inflight
    inflight = build()
      .then(d => { mem = d; writeText(CACHE, JSON.stringify(d)); lastError = null; return d })
      .catch(e => { lastFail = Date.now(); lastError = e.message; console.warn(`share-of-world: refresh failed: ${e.message}`); return null })
      .finally(() => { inflight = null })
    return inflight
  }

  async function get() {
    if (!mem) { const c = readJson(CACHE); if (c?.built && fin(Date.parse(c.built))) mem = c }
    // a build missing a whole block (a source with neither live data nor a seed) is retried hourly
    const ttl = () => (mem.world && mem.assets && mem.countries ? TTL : RETRY)
    if (!mem) await startRefresh()
    else if (Date.now() - Date.parse(mem.built) > ttl()) startRefresh()
    if (!mem) {
      return {
        built: null, stale: true, sourceErrors: [{ source: 'refresh', error: lastError || 'no data yet' }], weoVintage: null, projFrom: null,
        world: null, assets: null, countries: null, countryHistory: null, latestYear: null, mcapYear: null, note: null,
      }
    }
    const out = { ...mem, sourceErrors: [...(mem.sourceErrors || [])] }
    if (lastError) out.sourceErrors.push({ source: 'refresh', error: lastError })
    out.stale = Date.now() - Date.parse(mem.built) > ttl() || out.sourceErrors.length > 0
    return out
  }

  return { get }
}
