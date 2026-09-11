// ============================================================================
// MUNICIPALITIES — a metro economy at granular level, one city at a time
//   labor     MSA unemployment (SA) vs state and US; county rates; total
//             nonfarm payrolls and nine sectors (BLS CES via FRED); average
//             hourly earnings vs US; state initial claims; Indeed's daily
//             postings index for the metro vs US (Hiring Lab's public CSV —
//             62MB, streamed once and filtered for every configured metro)
//   housing   the Real Estate tab's metro feed (Zillow, Case-Shiller, Redfin)
//             plus Case-Shiller tiers, Realtor.com inventory, permits, FHFA
//   prices    metro CPI and rent CPI vs the US, gasoline vs the US, BEA
//             regional price parity
//   business  the bankruptcy tracker's district slice, state business
//             applications, and the state's WARN layoff database — Washington
//             publishes an ASP.NET grid paged by postback, California a live
//             spreadsheet of the current fiscal year; both archived so the
//             history accumulates past each source's own window
//   growth    county GDP and income, population, homeownership, cost-burdened
//             households, inequality, price parity — annual, lagged a year
//   giants    twelve locally headquartered public companies: day change, year
//             to date, one-year sparkline, equal-weight index vs SPY
//   scores    labor, housing, cost of living, business — 0–100 with verdicts
// Seattle is the default city; San Francisco, Austin and New York sit alongside.
// Cached 3h per city (postings 24h), disk-backed; complete builds only.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, TTL = 3 * H
const fin = v => v != null && Number.isFinite(v)
const last = a => (a && a.length ? a[a.length - 1] : null)
const r1 = v => (fin(v) ? +v.toFixed(1) : null), r2 = v => (fin(v) ? +v.toFixed(2) : null)
const chg = (a, b) => (fin(a) && fin(b) && b !== 0 ? ((a / b) - 1) * 100 : null)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const mean = xs => { const v = (xs || []).filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const pctile = (arr, v) => { const a = (arr || []).filter(fin); if (!a.length || !fin(v)) return null; return Math.round((a.filter(x => x < v).length / a.length) * 100) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ym = d => d.slice(0, 7)
const back = (s, n) => (s && s.length > n ? s[s.length - 1 - n] : null)
const yoyPct = (s, n) => (s?.length ? r1(chg(last(s).v, back(s, n)?.v)) : null)
const yoyDiff = (s, n) => (s?.length && back(s, n) ? r2(last(s).v - back(s, n).v) : null)
// Excel serial date (1900 system) → ISO, for the California WARN workbook
const ord = p => `${p}${p % 10 === 1 && p % 100 !== 11 ? 'st' : p % 10 === 2 && p % 100 !== 12 ? 'nd' : p % 10 === 3 && p % 100 !== 13 ? 'rd' : 'th'}`
const serialToDate = n => (fin(+n) && +n > 20000 ? new Date(Date.UTC(1899, 11, 30) + Math.round(+n) * 864e5).toISOString().slice(0, 10) : null)

// The nine CES sectors BLS publishes for every large metro, in the order the board reads.
const SECTOR_SUFFIX = [
  ['INFO', 'Information'], ['PBSV', 'Professional & business'], ['TRAD', 'Trade, transport, utilities'],
  ['EDUH', 'Education & health'], ['GOVT', 'Government'], ['LEIH', 'Leisure & hospitality'],
  ['MFG', 'Manufacturing'], ['FIRE', 'Financial activities'], ['SRVO', 'Other services'],
]
// Annual county/metro series: [id template, label, unit, note]. {county} is substituted.
const ANNUAL = [
  ['realGdp', '{county} real GDP', '$k', 'BEA county GDP, thousands of chained dollars'],
  ['gdp', '{county} GDP, nominal', '$k', ''],
  ['pcpi', 'Per capita personal income, {countyShort}', '$', 'BEA'],
  ['mhi', 'Median household income, {countyShort}', '$', 'Census SAIPE'],
  ['msaPop', 'MSA population', 'k', 'thousands'],
  ['countyPop', '{county} population', 'k', ''],
  ['hown', 'Homeownership rate, {countyShort}', '%', 'ACS 5-year'],
  ['burden', 'Cost-burdened households, {countyShort}', '%', 'ACS 5-year: housing costs over 30% of income'],
  ['ineq', 'Income inequality, {countyShort}', 'ratio', 'ACS: mean income of top quintile ÷ bottom quintile'],
  ['rpp', 'Regional price parity, MSA', 'index', 'BEA, US = 100'],
]

export const CITIES = [
  {
    id: 'seattle', name: 'Seattle', msa: 'Seattle-Tacoma-Bellevue', region: 'Puget Sound', giantsName: 'Puget Sound 12',
    cbsa: '42660', state: 'WA', stateName: 'Washington', county: 'King County', countyShort: 'King',
    sector: 'SEAT653', warn: 'wa', court: { id: 'wawb', district: 'WA,W', name: 'W.D. Washington' },
    fhfaNote: 'Seattle-Bellevue-Kent',
    ids: {
      urSa: 'SEAT653UR', urNsa: 'SEAT653URN', pay: 'SEAT653NA', lf: 'SEAT653LFN', ahe: 'SMU53426600500000003',
      permits: 'SEAT653BPPRIVSA', cpi: 'CUURA423SA0', rentCpi: 'CUURA423SEHA', gas: 'APUS49D7471A',
      csHigh: 'SEXRHTSA', csLow: 'SEXRLTSA', act: 'ACTLISCOU42660', newl: 'NEWLISCOU42660',
      dom: 'MEDDAYONMAR42660', mlp: 'MEDLISPRI42660', fhfa: 'ATNHPIUS42644Q',
      claims: 'WAICLAIMS', apps: 'BABATOTALSAWA',
      realGdp: 'REALGDPALL53033', gdp: 'GDPALL53033', pcpi: 'PCPI53033', mhi: 'MHIWA53033A052NCEN',
      msaPop: 'STWPOP', countyPop: 'WAKING5POP', hown: 'HOWNRATEACS053033', burden: 'DP04ACS053033',
      ineq: '2020RATIO053033', rpp: 'RPPALL42660',
    },
    counties: [['WAKING5URN', 'King'], ['WAPIER6URN', 'Pierce'], ['WASNOH0URN', 'Snohomish']],
    // matched against the WARN location column (Washington lists cities)
    match: /\b(Seattle|Bellevue|Tacoma|Everett|Redmond|Kirkland|Renton|Kent|Tukwila|Bothell|Kenmore|Auburn|Federal Way|Lynnwood|Issaquah|Sumner|Puyallup|Lakewood|SeaTac|Burien|Shoreline|Woodinville|Sammamish|Snoqualmie|Marysville|Edmonds|Mukilteo|Mill Creek|Des Moines|Fife|Bonney Lake|Gig Harbor|Arlington|Monroe|Maple Valley|Covington|Bremerton|King County|Pierce County|Snohomish County|Puget Sound)\b/i,
    giants: [
      ['AMZN', 'Amazon', 'Seattle'], ['MSFT', 'Microsoft', 'Redmond'], ['COST', 'Costco', 'Issaquah'], ['SBUX', 'Starbucks', 'Seattle'],
      ['BA', 'Boeing', 'Everett · Renton'], ['TMUS', 'T-Mobile', 'Bellevue'], ['PCAR', 'PACCAR', 'Bellevue'], ['EXPD', 'Expeditors', 'Seattle'],
      ['EXPE', 'Expedia', 'Seattle'], ['ALK', 'Alaska Air', 'SeaTac'], ['WY', 'Weyerhaeuser', 'Seattle'], ['ZG', 'Zillow', 'Seattle'],
    ],
    giantsNote: 'Boeing is included as the region’s largest manufacturer even though its registered headquarters left.',
    colour: '#818cf8',
    blurb: 'Seattle’s economy is a tech cycle wrapped in an aerospace cycle: information is a tenth of payrolls here against a fiftieth nationally, and Boeing’s production rate moves a manufacturing base that is a tenth more.',
  },
  {
    id: 'sf', name: 'San Francisco', msa: 'San Francisco-Oakland-Fremont', region: 'Bay Area', giantsName: 'Bay Area 12',
    cbsa: '41860', state: 'CA', stateName: 'California', county: 'San Francisco County', countyShort: 'San Francisco',
    sector: 'SANF806', warn: 'ca', court: { id: 'canb', district: 'CA,N', name: 'N.D. California' },
    fhfaNote: 'San Francisco-San Mateo-Redwood City',
    ids: {
      urSa: 'SANF806UR', urNsa: 'SANF806URN', pay: 'SANF806NA', lf: 'SANF806LFN', ahe: 'SMU06418600500000003',
      permits: 'SANF806BPPRIVSA', cpi: 'CUURA422SA0', rentCpi: 'CUURA422SEHA', gas: 'APUS49B7471A',
      csHigh: 'SFXRHTSA', csLow: 'SFXRLTSA', act: 'ACTLISCOU41860', newl: 'NEWLISCOU41860',
      dom: 'MEDDAYONMAR41860', mlp: 'MEDLISPRI41860', fhfa: 'ATNHPIUS41884Q',
      claims: 'CAICLAIMS', apps: 'BABATOTALSACA',
      realGdp: 'REALGDPALL06075', gdp: 'GDPALL06075', pcpi: 'PCPI06075', mhi: 'MHICA06075A052NCEN',
      msaPop: 'SFCPOP', countyPop: 'CASANF0POP', hown: 'HOWNRATEACS006075', burden: 'DP04ACS006075',
      ineq: '2020RATIO006075', rpp: 'RPPALL41860',
    },
    counties: [['CASANF0URN', 'San Francisco'], ['CAALAM1URN', 'Alameda'], ['CASANM0URN', 'San Mateo'], ['CACONT3URN', 'Contra Costa'], ['CAMARI5URN', 'Marin']],
    // matched against the WARN county column (California lists counties) plus common city names
    match: /\b(San Francisco|San Mateo|Alameda|Contra Costa|Marin|Oakland|Berkeley|Fremont|Hayward|Daly City|South San Francisco|Redwood City|Menlo Park|Foster City|San Bruno|Burlingame|Emeryville|San Leandro|Union City|Newark|Pleasanton|Livermore|Dublin|Concord|Richmond|Walnut Creek|San Rafael|Novato|Brisbane|Millbrae|San Carlos|Belmont|Sunnyvale)\b/i,
    giants: [
      ['CRM', 'Salesforce', 'San Francisco'], ['WFC', 'Wells Fargo', 'San Francisco'], ['META', 'Meta', 'Menlo Park'], ['V', 'Visa', 'Foster City'],
      ['UBER', 'Uber', 'San Francisco'], ['ABNB', 'Airbnb', 'San Francisco'], ['XYZ', 'Block', 'Oakland'], ['PCG', 'PG&E', 'Oakland'],
      ['WDAY', 'Workday', 'Pleasanton'], ['CLX', 'Clorox', 'Oakland'], ['GAP', 'Gap', 'San Francisco'], ['LEVI', 'Levi Strauss', 'San Francisco'],
    ],
    giantsNote: 'Scoped to the metro’s five counties, so Apple, Alphabet and Nvidia — Santa Clara County, the neighbouring San Jose MSA — are deliberately absent.',
    colour: '#22d3ee',
    blurb: 'San Francisco’s economy is the most concentrated bet on software in the country: information and professional services together are roughly a third of payrolls, office demand is downstream of both, and the metro’s price level is the highest the BEA measures.',
  },
  {
    id: 'austin', name: 'Austin', msa: 'Austin-Round Rock-San Marcos', region: 'Central Texas', giantsName: 'Austin 12',
    cbsa: '12420', state: 'TX', stateName: 'Texas', county: 'Travis County', countyShort: 'Travis',
    sector: 'AUST448', warn: 'tx', court: { id: 'txwb', district: 'TX,W', name: 'W.D. Texas' },
    fhfaNote: 'Austin-Round Rock-Georgetown',
    // BLS publishes no Austin CPI or average-price series: the South region CPI and
    // the Dallas gasoline price stand in, and both are labelled as such on the board.
    cpiLabel: 'South region', cpiNote: 'BLS publishes no Austin CPI; the South census region stands in',
    gasLabel: 'Gasoline (Dallas)',
    ids: {
      urSa: 'AUST448UR', urNsa: 'AUST448URN', pay: 'AUST448NA', lf: 'AUST448LFN', ahe: 'SMU48124200500000003',
      permits: 'AUST448BPPRIVSA', cpi: 'CUUR0300SA0', rentCpi: 'CUUR0300SEHA', gas: 'APUS37A7471A',
      csHigh: null, csLow: null, act: 'ACTLISCOU12420', newl: 'NEWLISCOU12420',
      dom: 'MEDDAYONMAR12420', mlp: 'MEDLISPRI12420', fhfa: 'ATNHPIUS12420Q',
      claims: 'TXICLAIMS', apps: 'BABATOTALSATX',
      realGdp: 'REALGDPALL48453', gdp: 'GDPALL48453', pcpi: 'PCPI48453', mhi: 'MHITX48453A052NCEN',
      msaPop: 'AUSPOP', countyPop: 'TXTRAV3POP', hown: 'HOWNRATEACS048453', burden: 'DP04ACS048453',
      ineq: '2020RATIO048453', rpp: 'RPPALL12420',
    },
    counties: [['TXTRAV3URN', 'Travis'], ['TXWILL5URN', 'Williamson'], ['TXHAYS9URN', 'Hays'], ['TXBAST1URN', 'Bastrop']],
    match: /\b(Travis|Williamson|Hays|Bastrop|Caldwell|Austin|Round Rock|Georgetown|Cedar Park|San Marcos|Pflugerville|Leander|Kyle|Buda|Bee Cave|Lakeway|Del Valle|Manor|Taylor|Hutto|Elgin|Dripping Springs|Westlake|West Lake Hills)\b/i,
    giants: [
      ['TSLA', 'Tesla', 'Austin'], ['ORCL', 'Oracle', 'Austin'], ['DELL', 'Dell', 'Round Rock'], ['CRWD', 'CrowdStrike', 'Austin'],
      ['SCHW', 'Charles Schwab', 'Westlake'], ['DLR', 'Digital Realty', 'Austin'], ['CRUS', 'Cirrus Logic', 'Austin'], ['SLAB', 'Silicon Labs', 'Austin'],
      ['QTWO', 'Q2 Holdings', 'Austin'], ['BMBL', 'Bumble', 'Austin'], ['NTRA', 'Natera', 'Austin'], ['VITL', 'Vital Farms', 'Austin'],
    ],
    giantsNote: 'Tesla and Oracle moved their headquarters here this decade, which is most of why the basket looks nothing like it would have in 2019.',
    colour: '#fb923c',
    blurb: 'Austin is the fastest-growing large metro of the past decade and the one most exposed to that growth reversing: a tech and semiconductor base bolted onto a state capital, with a housing market that overshot harder than anywhere else in the country and has been correcting since 2022.',
  },
  {
    id: 'nyc', name: 'New York', msa: 'New York-Newark-Jersey City', region: 'New York metro', giantsName: 'New York 12',
    cbsa: '35620', state: 'NY', stateName: 'New York', county: 'New York County', countyShort: 'Manhattan',
    sector: 'NEWY636', warn: null, court: { id: 'nysb', district: 'NY,S', name: 'S.D. New York' },
    fhfaNote: 'New York-Jersey City-White Plains',
    ids: {
      urSa: 'NEWY636UR', urNsa: 'NEWY636URN', pay: 'NEWY636NA', lf: 'NEWY636LFN', ahe: 'SMU36356200500000003',
      permits: 'NEWY636BPPRIVSA', cpi: 'CUURA101SA0', rentCpi: 'CUURA101SEHA', gas: 'APUS12A7471A',
      csHigh: 'NYXRHTSA', csLow: 'NYXRLTSA', act: 'ACTLISCOU35620', newl: 'NEWLISCOU35620',
      dom: 'MEDDAYONMAR35620', mlp: 'MEDLISPRI35620', fhfa: 'ATNHPIUS35614Q',
      claims: 'NYICLAIMS', apps: 'BABATOTALSANY',
      realGdp: 'REALGDPALL36061', gdp: 'GDPALL36061', pcpi: 'PCPI36061', mhi: 'MHINY36061A052NCEN',
      msaPop: 'NYTPOP', countyPop: 'NYNEWY1POP', hown: 'HOWNRATEACS036061', burden: 'DP04ACS036061',
      ineq: '2020RATIO036061', rpp: 'RPPALL35620',
    },
    counties: [['NYNEWY1URN', 'Manhattan'], ['NYKING7URN', 'Brooklyn'], ['NYQUEE1URN', 'Queens'], ['NYBRON5URN', 'Bronx'], ['NYRICH5URN', 'Staten Island']],
    match: /\b(New York|Manhattan|Brooklyn|Queens|Bronx|Staten Island|Kings County|Richmond County|Newark|Jersey City|Yonkers|White Plains|Long Island|Nassau|Suffolk|Westchester|Hoboken|Elizabeth|Paterson)\b/i,
    giants: [
      ['JPM', 'JPMorgan Chase', 'New York'], ['GS', 'Goldman Sachs', 'New York'], ['MS', 'Morgan Stanley', 'New York'], ['C', 'Citigroup', 'New York'],
      ['BLK', 'BlackRock', 'New York'], ['BX', 'Blackstone', 'New York'], ['KKR', 'KKR', 'New York'], ['AXP', 'American Express', 'New York'],
      ['VZ', 'Verizon', 'New York'], ['PFE', 'Pfizer', 'New York'], ['IBM', 'IBM', 'Armonk'], ['MET', 'MetLife', 'New York'],
    ],
    giantsNote: 'Weighted to finance because the metro is: securities alone is a twentieth of payrolls here and a much larger share of the wage bill.',
    colour: '#4ade80',
    blurb: 'New York is the one metro whose cycle is a financial cycle first: securities and banking pay a fifth of the wage bill on a twentieth of the jobs, so Wall Street bonuses move the local economy more than local employment does, and the boroughs diverge sharply from one another.',
  },
]
const byId = Object.fromEntries(CITIES.map(c => [c.id, c]))
export const DEFAULT_CITY = 'seattle'

export function createMunicipalities({ fetchFredSeries, fetchYahooQuote, fetchYahooSparkline, unzipEntries, UA, dir, reMetro, bankruptcy }) {
  const file = n => path.join(dir, n)
  const load = n => { try { if (fs.existsSync(file(n))) return JSON.parse(fs.readFileSync(file(n), 'utf8')) } catch {} return null }
  const save = (n, o) => { try { fs.writeFileSync(file(n), JSON.stringify(o)) } catch (e) { console.error(`${n} save:`, e.message) } }
  const mem = {}, inflight = {}
  const fred = async (id, limit) => { if (!id) return []; try { const s = await fetchFredSeries(id, limit); return (s || []).filter(p => fin(p.v)) } catch { return [] } }

  // ── Indeed Hiring Lab: every configured metro out of one pass over the 62MB file ──
  async function postings() {
    const codes = new Set(CITIES.map(c => c.cbsa))
    const codeKey = [...codes].sort().join(',')
    const disk = load('metro-postings.json')
    // a cache built before a city was added has no column for it, so the key counts
    if (disk && disk.codeKey === codeKey && Date.now() - disk.ts < 24 * H) return disk.data
    try {
      const r = await fetch('https://raw.githubusercontent.com/hiring-lab/job_postings_tracker/master/US/metro_job_postings_us.csv', { headers: { 'User-Agent': UA } })
      if (!r.ok || !r.body) throw new Error(`Indeed metro HTTP ${r.status}`)
      const dec = new TextDecoder(); let buf = ''
      const metros = Object.fromEntries([...codes].map(c => [c, []]))
      const take = line => {
        for (const code of codes) {
          if (!line.includes(`,${code},`)) continue
          const m = line.match(new RegExp(`^(\\d{4}-\\d{2}-\\d{2}),.*,${code},([\\d.]+)`))
          if (m) metros[code].push({ d: m[1], v: +m[2] })
        }
      }
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true })
        let i
        while ((i = buf.indexOf('\n')) >= 0) { take(buf.slice(0, i)); buf = buf.slice(i + 1) }
      }
      take(buf)
      const ru = await fetch('https://raw.githubusercontent.com/hiring-lab/job_postings_tracker/master/US/aggregate_job_postings_US.csv', { headers: { 'User-Agent': UA } })
      const us = ru.ok ? (await ru.text()).split('\n').map(l => l.split(',')).filter(c => c[0] && c[4] === 'total postings').map(c => ({ d: c[0], v: +c[2] })) : []
      if (Object.values(metros).some(v => v.length < 100)) throw new Error('too few metro rows')
      const data = { metros, us }
      save('metro-postings.json', { data, ts: Date.now(), codeKey })
      return data
    } catch (e) { console.warn('Indeed postings:', e.message); return disk?.data || { metros: {}, us: [] } }
  }

  // ── WARN: Washington's paged grid ────────────────────────────────────────
  const unesc = s => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  function parseWarnWa(html) {
    const g = html.slice(html.indexOf('id="ucPSW_gvMain"'))
    const out = []
    for (const rm of g.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)) {
      const cells = [...rm[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(m => unesc(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
      if (cells.length < 7 || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cells[6])) continue
      const iso = s => { const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null }
      out.push({ company: cells[0], location: cells[1], start: iso(cells[2]), workers: +cells[3].replace(/[^\d]/g, '') || 0, kind: /closure/i.test(cells[4]) ? 'Closure' : 'Layoff', received: iso(cells[6]), statewide: /statewide/i.test(cells[1]) })
    }
    const hidden = Object.fromEntries([...html.matchAll(/<input type="hidden" name="(__[A-Z]+)"[^>]*value="([^"]*)"/g)].map(m => [m[1], m[2]]))
    return { rows: out, hidden }
  }
  async function fetchWarnWa() {
    const url = 'https://fortress.wa.gov/esd/file/WARN/Public/SearchWARN.aspx'
    const r0 = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!r0.ok) throw new Error(`WARN WA HTTP ${r0.status}`)
    const cookie = (r0.headers.get('set-cookie') || '').split(';')[0]
    let page = parseWarnWa(await r0.text())
    const rows = [...page.rows]
    for (let p = 2; p <= 4 && page.rows.length; p++) {
      const body = new URLSearchParams({ ...page.hidden, __EVENTTARGET: 'ucPSW$gvMain', __EVENTARGUMENT: `Page$${p}`, 'ucPSW$txtSearch': '' })
      const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { Cookie: cookie } : {}) }, body })
      if (!r.ok) break
      page = parseWarnWa(await r.text())
      rows.push(...page.rows)
      await sleep(400)
    }
    return rows
  }

  // ── WARN: California's live spreadsheet (current fiscal year, county-coded) ──
  async function fetchWarnCa() {
    const r = await fetch('https://edd.ca.gov/siteassets/files/jobs_and_training/warn/warn_report1.xlsx', { headers: { 'User-Agent': UA } })
    if (!r.ok) throw new Error(`WARN CA HTTP ${r.status}`)
    const entries = unzipEntries(Buffer.from(await r.arrayBuffer()))
    const text = name => entries.find(e => e.name === name)?.data?.toString('utf8') || ''
    const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>(.*?)<\/si>/gs)].map(m => unesc(m[1].replace(/<[^>]+>/g, '')))
    // The detailed report is the third sheet, but the workbook's sheet order has
    // moved before; find it by its header row. Cells are keyed by column letter
    // because empty cells are omitted from the XML entirely.
    const col = ref => ref.replace(/\d+/g, '')
    const parseSheet = xml => {
      const out = []
      for (const rm of xml.matchAll(/<row[^>]*>(.*?)<\/row>/gs)) {
        const cells = {}
        for (const cm of rm[1].matchAll(/<c r="([A-Z]+\d+)"([^>]*)>(.*?)<\/c>/gs)) {
          const v = cm[3].match(/<v>(.*?)<\/v>/)?.[1]
          if (v != null) cells[col(cm[1])] = /t="s"/.test(cm[2]) ? shared[+v] : v
        }
        out.push(cells)
      }
      return out
    }
    let rows = []
    for (const n of [3, 1, 2, 4, 5, 6]) {
      const xml = text(`xl/worksheets/sheet${n}.xml`)
      if (!xml) continue
      const parsed = parseSheet(xml)
      if (parsed.some(c => /County\/Parish/i.test(c.A || ''))) { rows = parsed; break }
    }
    if (!rows.length) throw new Error('WARN CA: detailed sheet not found')
    // A: county, B: notice date, D: effective date, E: company, F: layoff/closure, G: employees, I: industry
    const out = []
    for (const c of rows) {
      const county = (c.A || '').trim()
      if (!/(County|Parish)$/i.test(county)) continue
      const received = serialToDate(c.B), start = serialToDate(c.D)
      if (!received) continue
      out.push({ company: (c.E || '').trim(), location: county, start, workers: +String(c.G || '').replace(/[^\d]/g, '') || 0, kind: /closure/i.test(c.F || '') ? 'Closure' : 'Layoff', received, industry: (c.I || '').replace(/^\d[\d-]*\s*/, '').trim() || null, statewide: false })
    }
    if (!out.length) throw new Error('WARN CA: no notices parsed')
    return out
  }

  // ── WARN: Texas's Socrata dataset on data.texas.gov ──────────────────────
  async function fetchWarnTx() {
    const url = 'https://data.texas.gov/resource/8w53-c4f6.json?$limit=1200&$order=notice_date%20DESC'
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
    if (!r.ok) throw new Error(`WARN TX HTTP ${r.status}`)
    const rows = await r.json()
    const out = []
    for (const x of rows) {
      const received = (x.notice_date || x.wfdd_received_date || '').slice(0, 10)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(received)) continue
      const county = (x.county_name || '').trim(), town = (x.city_name || '').trim()
      out.push({
        company: (x.job_site_name || '').trim(), location: [town, county && `${county} County`].filter(Boolean).join(', '),
        start: (x.layoff_date || '').slice(0, 10) || null, workers: +String(x.total_layoff_number || '').replace(/[^\d]/g, '') || 0,
        kind: 'Layoff', received, statewide: false,
      })
    }
    if (!out.length) throw new Error('WARN TX: no notices parsed')
    return out
  }

  async function warn(city) {
    if (!city.warn) return null // no machine-readable state feed for this metro
    const raw = load(`warn-${city.state.toLowerCase()}.json`) || { notices: {} }
    // Re-key on load: company names arrive XML-escaped from some sources, and an
    // escaping change would otherwise leave the same notice archived twice.
    const store = { notices: {} }
    for (const n of Object.values(raw.notices || {})) {
      const co = unesc(n.company || '').replace(/\s+/g, ' ').trim()
      const loc = unesc(n.location || '').replace(/\s+/g, ' ').trim()
      store.notices[`${co}|${n.received}|${loc}`] = { ...n, company: co, location: loc }
    }
    let fetched = 0
    try {
      const rows = city.warn === 'ca' ? await fetchWarnCa() : city.warn === 'tx' ? await fetchWarnTx() : await fetchWarnWa()
      for (const n of rows) {
        n.company = unesc(n.company || '').replace(/\s+/g, ' ').trim()
        n.location = unesc(n.location || '').replace(/\s+/g, ' ').trim()
        const key = `${n.company}|${n.received}|${n.location}`
        if (!store.notices[key]) fetched++
        store.notices[key] = n
      }
    } catch (e) { console.warn(`WARN ${city.state}:`, e.message) }
    save(`warn-${city.state.toLowerCase()}.json`, store)
    const all = Object.values(store.notices).filter(n => n.received).sort((a, b) => b.received.localeCompare(a.received))
    for (const n of all) n.local = city.match.test(n.location || '')
    // Some states publish on a lag (Texas's dataset trails by weeks). When the newest
    // notice predates the 90-day window, that window is an artefact, not an improvement.
    const newest = all[0]?.received || null
    const lagDays = newest ? Math.round((Date.now() - Date.parse(newest)) / 864e5) : null
    const cut = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
    const win = (from, to, pred) => all.filter(n => n.received >= from && n.received < to && pred(n))
    const sum = rows => rows.reduce((s, n) => s + (n.workers || 0), 0)
    const l90 = win(cut(90), cut(-1), n => n.local), l90prev = win(cut(180), cut(90), n => n.local)
    const monthly = {}
    for (const n of all) { const kk = n.received.slice(0, 7); const m = monthly[kk] = monthly[kk] || { d: kk + '-01', local: 0, other: 0, notices: 0 }; m[n.local ? 'local' : 'other'] += n.workers || 0; m.notices++ }
    return {
      notices: all.slice(0, 120), archived: all.length, newest, lagDays, stale: lagDays == null || lagDays > 45, since: all.length ? all[all.length - 1].received : null, newThisRun: fetched,
      local90: { notices: l90.length, workers: sum(l90) }, local90prev: { notices: l90prev.length, workers: sum(l90prev) },
      state90: { notices: win(cut(90), cut(-1), () => true).length, workers: sum(win(cut(90), cut(-1), () => true)) },
      monthly: Object.values(monthly).sort((a, b) => a.d.localeCompare(b.d)).slice(-24),
      source: city.warn === 'ca'
        ? 'California EDD WARN report (the live spreadsheet for the current fiscal year), matched to the metro by the notice’s county'
        : city.warn === 'tx'
        ? 'Texas Workforce Commission WARN notices (the data.texas.gov dataset), matched to the metro by the notice’s county and city'
        : 'Washington ESD WARN database (the public grid, first four pages each refresh), matched to the metro by the notice’s location',
    }
  }

  async function build(city) {
    const I = city.ids
    const [metro, bk, post] = await Promise.all([reMetro(city.cbsa).catch(() => null), bankruptcy().catch(() => null), postings()])

    // ── labor ──
    const ur = await fred(I.urSa, 440), urState = await fred(`${city.state}UR`, 440), urUs = await fred('UNRATE', 440), urNsa = await fred(I.urNsa, 200)
    const countySeries = []
    for (const [id, name] of city.counties) countySeries.push({ name, s: await fred(id, 200) })
    const pay = await fred(I.pay, 440), payUs = await fred('PAYEMS', 440)
    const sectors = []
    for (const [suffix, label] of SECTOR_SUFFIX) {
      const s = await fred(`${city.sector}${suffix}`, 200)
      if (s.length) sectors.push({ id: `${city.sector}${suffix}`, key: suffix, label, v: last(s).v, d: last(s).d, yoy: yoyPct(s, 12), chg5y: yoyPct(s, 60), spark: s.slice(-36).map(p => r1(p.v)) })
    }
    const totalNow = last(pay)?.v
    for (const s of sectors) s.share = fin(totalNow) ? r1((s.v / totalNow) * 100) : null
    const ahe = await fred(I.ahe, 200), aheUs = await fred('CES0500000003', 200)
    const claims = await fred(I.claims, 170), lf = await fred(I.lf, 200)
    const c4 = s => (s.length >= 4 ? mean(s.slice(-4).map(p => p.v)) : null), c4y = s => (s.length >= 56 ? mean(s.slice(-56, -52).map(p => p.v)) : null)
    const byMonth = s => { const m = new Map(); for (const p of s) m.set(ym(p.d), p.v); return m }
    const mU = byMonth(ur), mW = byMonth(urState), mUS = byMonth(urUs)
    const mCounty = countySeries.map(c => ({ name: c.name, m: byMonth(c.s), latest: last(c.s) }))
    const months = [...new Set([...ur, ...urState, ...urUs].map(p => ym(p.d)))].sort().filter(m => m >= '2000-01')
    const urSeries = months.map(m => ({ d: m + '-01', msa: mU.get(m) ?? null, state: mW.get(m) ?? null, us: mUS.get(m) ?? null }))
    const mPay = byMonth(pay), mPayUs = byMonth(payUs)
    const payYoy = [...mPay.keys()].sort().filter(m => m >= '2000-01').map(m => { const y = `${+m.slice(0, 4) - 1}${m.slice(4)}`; return { d: m + '-01', msa: r1(chg(mPay.get(m), mPay.get(y))), us: r1(chg(mPayUs.get(m), mPayUs.get(y))) } }).filter(p => fin(p.msa))
    const metroPost = post.metros?.[city.cbsa] || [], usPost = post.us || []
    const pIdx = (arr, daysBack) => { const t = new Date(Date.now() - daysBack * 864e5).toISOString().slice(0, 10); const pts = arr.filter(p => p.d <= t); return last(pts)?.v ?? null }
    const mu = new Map(usPost.map(p => [p.d, p.v]))
    const postSeries = metroPost.filter((_, i) => i % 7 === 0).map(p => ({ d: p.d, metro: r1(p.v), us: fin(mu.get(p.d)) ? r1(mu.get(p.d)) : null }))
    const labor = {
      unemployment: {
        msa: last(ur)?.v ?? null, msaD: last(ur)?.d, msaChg1y: yoyDiff(ur, 12), msaPct: pctile(ur.map(p => p.v), last(ur)?.v),
        state: last(urState)?.v ?? null, us: last(urUs)?.v ?? null, usD: last(urUs)?.d, msaNsa: last(urNsa)?.v ?? null,
        counties: mCounty.map(c => ({ name: c.name, v: r1(c.latest?.v), d: c.latest?.d })), countyD: mCounty[0]?.latest?.d,
        series: urSeries, spark: ur.slice(-36).map(p => r1(p.v)),
      },
      payrolls: {
        total: totalNow ?? null, d: last(pay)?.d, yoy: yoyPct(pay, 12), yoyUs: yoyPct(payUs, 12),
        chg1y: fin(totalNow) ? r1(totalNow - (back(pay, 12)?.v ?? NaN)) : null,
        sinceFeb2020: r1(chg(totalNow, pay.find(p => p.d.startsWith('2020-02'))?.v)),
        sectors: sectors.sort((a, b) => b.v - a.v), series: payYoy, spark: pay.slice(-36).map(p => r1(p.v)),
      },
      earnings: { ahe: r2(last(ahe)?.v), aheYoy: yoyPct(ahe, 12), aheUs: r2(last(aheUs)?.v), aheUsYoy: yoyPct(aheUs, 12), d: last(ahe)?.d, premium: fin(last(ahe)?.v) && fin(last(aheUs)?.v) ? r1((last(ahe).v / last(aheUs).v - 1) * 100) : null, spark: ahe.slice(-36).map(p => r1(p.v)) },
      claims: { state4w: c4(claims) != null ? Math.round(c4(claims)) : null, state4wYoy: r1(chg(c4(claims), c4y(claims))), d: last(claims)?.d },
      laborForce: { v: last(lf)?.v ?? null, yoy: yoyPct(lf, 12), d: last(lf)?.d },
      postings: { metro: pIdx(metroPost, 0), us: pIdx(usPost, 0), d: last(metroPost)?.d ?? null, metroChg30: r1(chg(pIdx(metroPost, 0), pIdx(metroPost, 30))), metroChg1y: r1(chg(pIdx(metroPost, 0), pIdx(metroPost, 365))), usChg1y: r1(chg(pIdx(usPost, 0), pIdx(usPost, 365))), series: postSeries, source: 'Indeed Hiring Lab job postings index, Feb 2020 = 100, 7-day trailing' },
    }

    // ── housing ──
    const csHigh = await fred(I.csHigh, 200), csLow = await fred(I.csLow, 200)
    const act = await fred(I.act, 130), nw = await fred(I.newl, 130), dom = await fred(I.dom, 130), mlp = await fred(I.mlp, 130)
    const permits = await fred(I.permits, 300), fhfa = await fred(I.fhfa, 210)
    const sum12 = s => (s.length >= 12 ? s.slice(-12).reduce((a, p) => a + p.v, 0) : null), sum12y = s => (s.length >= 24 ? s.slice(-24, -12).reduce((a, p) => a + p.v, 0) : null)
    const mAct = byMonth(act), mNew = byMonth(nw), mDom = byMonth(dom)
    const invSeries = [...mAct.keys()].sort().map(m => ({ d: m + '-01', active: mAct.get(m) ?? null, newl: mNew.get(m) ?? null, dom: mDom.get(m) ?? null }))
    const permit12 = permits.map((p, i) => (i >= 11 ? { d: p.d, v: permits.slice(i - 11, i + 1).reduce((x, q) => x + q.v, 0) } : null)).filter(Boolean)
    const housing = {
      metro, tiers: { high: yoyPct(csHigh, 12), low: yoyPct(csLow, 12), d: last(csHigh)?.d },
      inventory: { active: last(act)?.v ?? null, activeYoy: yoyPct(act, 12), newl: last(nw)?.v ?? null, newYoy: yoyPct(nw, 12), dom: last(dom)?.v ?? null, dom1y: back(dom, 12)?.v ?? null, medList: last(mlp)?.v ?? null, medListYoy: yoyPct(mlp, 12), d: last(act)?.d, series: invSeries },
      permits: { m12: sum12(permits) != null ? Math.round(sum12(permits)) : null, m12Yoy: r1(chg(sum12(permits), sum12y(permits))), d: last(permits)?.d, pct: pctile(permit12.map(p => p.v), sum12(permits)), series: permit12.slice(-200).map(p => ({ d: p.d, v: Math.round(p.v) })) },
      fhfa: { yoy: yoyPct(fhfa, 4), d: last(fhfa)?.d, fromPeak: fhfa.length ? r1(chg(last(fhfa).v, Math.max(...fhfa.map(p => p.v)))) : null, note: city.fhfaNote },
    }

    // ── prices ──
    const cpiM = await fred(I.cpi, 340), cpiUs = await fred('CPIAUCNS', 340), rentM = await fred(I.rentCpi, 340), rentUs = await fred('CUUR0000SEHA', 340)
    const gasM = await fred(I.gas, 200), gasUs = await fred('APU000074714', 200), rpp = await fred(I.rpp, 20)
    const yoyByMonth = s => { const m = byMonth(s); return [...m.keys()].sort().map(kk => { const y = `${+kk.slice(0, 4) - 1}${kk.slice(4)}`; return { d: kk + '-01', v: m.has(y) ? r1(chg(m.get(kk), m.get(y))) : null } }).filter(p => fin(p.v)) }
    const cS = yoyByMonth(cpiM), cU = yoyByMonth(cpiUs), rS = yoyByMonth(rentM), rU = yoyByMonth(rentUs)
    const merge2 = (a, b) => { const mb = new Map(b.map(p => [p.d, p.v])); return a.filter(p => p.d >= '2000-01-01').map(p => ({ d: p.d, metro: p.v, us: mb.get(p.d) ?? null })) }
    const prices = {
      cpi: { metro: last(cS)?.v ?? null, us: last(cU)?.v ?? null, d: last(cS)?.d, usAtSameMonth: cU.find(p => p.d === last(cS)?.d)?.v ?? null, series: merge2(cS, cU), label: city.cpiLabel || 'Metro', note: city.cpiNote || 'the metro CPI is published for every other month' },
      rent: { metro: last(rS)?.v ?? null, us: last(rU)?.v ?? null, d: last(rS)?.d, usAtSameMonth: rU.find(p => p.d === last(rS)?.d)?.v ?? null, series: merge2(rS, rU), label: city.cpiLabel || 'Metro' },
      gas: { metro: r2(last(gasM)?.v), us: r2(last(gasUs)?.v), d: last(gasM)?.d, label: city.gasLabel || 'Gasoline', metroYoy: yoyPct(gasM, 12), premium: fin(last(gasM)?.v) && fin(last(gasUs)?.v) ? r1((last(gasM).v / last(gasUs).v - 1) * 100) : null },
      rpp: { v: r1(last(rpp)?.v), d: last(rpp)?.d },
    }

    // ── business ──
    const apps = await fred(I.apps, 280)
    const m12avg = (s, off = 0) => (s.length >= 12 + off ? mean(s.slice(-12 - off, off ? -off : undefined).map(p => p.v)) : null)
    const bkRow = bk?.board?.find(b => b.id === city.court.id) || null
    const business = {
      bk: bk && bkRow ? {
        court: city.court.name, score: bk.scores?.local?.score ?? null,
        q: bkRow.q, total: bkRow.total, yoy: bkRow.yoy, t4: bkRow.t4, t4Pct: bkRow.t4Pct,
        bizCh11: bkRow.bizCh11, bizCh11T4: bkRow.bizCh11T4, bizCh11Pct: bkRow.bizCh11Pct, live30: bkRow.live30,
        liveCh11: (bk.live?.ch11Recent || []).filter(c => c.court === city.court.id).slice(0, 8),
        recent: (bk.recent?.[city.court.id]?.cases || []).filter(c => c.entity).slice(0, 12),
        series: (bk.districts?.[city.court.district] || []).slice(-40).map(r => ({ q: r.q, total: r.total, bizCh11: r.bizCh11 })),
      } : null,
      apps: { latest: last(apps)?.v ?? null, d: last(apps)?.d, m12: m12avg(apps) != null ? Math.round(m12avg(apps)) : null, m12Yoy: r1(chg(m12avg(apps), m12avg(apps, 12))), pct: pctile(apps.map(p => p.v), last(apps)?.v), series: apps.filter(p => p.d >= '2010-01-01').map(p => ({ d: p.d, v: p.v })) },
      warn: await warn(city),
    }

    // ── growth (annual) ──
    const growth = []
    for (const [key, labelT, unit, note] of ANNUAL) {
      const s = await fred(I[key], 30)
      if (!s.length) continue
      const L = last(s), P = back(s, 1), P5 = back(s, 5)
      const rate = unit === '%' || unit === 'ratio' || unit === 'index'
      growth.push({
        key, label: labelT.replace('{county}', city.county).replace('{countyShort}', city.countyShort), unit, note,
        v: L.v, d: L.d, yoy: rate ? (P ? r2(L.v - P.v) : null) : yoyPct(s, 1),
        cagr5: !rate && P5 && P5.v > 0 ? r1((Math.pow(L.v / P5.v, 1 / 5) - 1) * 100) : null,
        spark: s.slice(-15).map(p => r2(p.v)),
      })
    }

    // ── the local majors ──
    const giants = []
    const weekly = {}
    for (const [sym, name, town] of [...city.giants, ['SPY', 'S&P 500 (SPY)', '']]) {
      const [q, sp] = await Promise.all([fetchYahooQuote(sym).catch(() => null), fetchYahooSparkline(sym, '1y', '1wk').catch(() => [])])
      weekly[sym] = sp
      const yStart = sp.find(p => new Date(p.ts).getUTCFullYear() === new Date().getUTCFullYear())
      giants.push({ sym, name, city: town, price: q?.price ?? null, chgPct: fin(q?.changePct) ? r2(q.changePct * 100) : null, ytd: q && yStart ? r1(chg(q.price, yStart.v)) : null, yr1: q && sp.length ? r1(chg(q.price, sp[0].v)) : null, spark: sp.map(p => r2(p.v)) })
      await sleep(120)
    }
    const spyW = weekly.SPY || []
    const index = spyW.map((p, i) => {
      const legs = city.giants.map(([s]) => weekly[s]).filter(w => w && w.length > i && w[0]?.v)
      return { d: new Date(p.ts).toISOString().slice(0, 10), local: r1(legs.length ? mean(legs.map(w => (w[i].v / w[0].v) * 100)) : null), spy: r1((p.v / spyW[0].v) * 100) }
    })
    const spyRow = giants.find(g => g.sym === 'SPY'), ewYtd = mean(giants.filter(g => g.sym !== 'SPY').map(g => g.ytd)), ewYr = mean(giants.filter(g => g.sym !== 'SPY').map(g => g.yr1))

    // ── scores ──
    const U = labor.unemployment, P = labor.payrolls, J = labor.postings
    const laborScore = Math.round(mean([fin(U.msaPct) ? 100 - U.msaPct : null, fin(P.yoy) ? clamp(50 + P.yoy * 15, 0, 100) : null, fin(J.metroChg1y) ? clamp(50 + J.metroChg1y, 0, 100) : null, fin(labor.claims.state4wYoy) ? clamp(50 - labor.claims.state4wYoy / 2, 0, 100) : null]) ?? 50)
    const cs = metro?.caseShiller, inv = housing.inventory
    const housingScore = Math.round(mean([fin(cs?.yoy) ? clamp(50 + cs.yoy * 5, 0, 100) : null, fin(inv.activeYoy) ? clamp(50 - inv.activeYoy / 2, 0, 100) : null, fin(inv.dom) && fin(inv.dom1y) ? clamp(50 - (inv.dom - inv.dom1y) * 2, 0, 100) : null, fin(housing.permits.m12Yoy) ? clamp(50 + housing.permits.m12Yoy / 2, 0, 100) : null]) ?? 50)
    const pricesScore = Math.round(mean([fin(prices.cpi.metro) ? clamp(100 - prices.cpi.metro * 15, 0, 100) : null, fin(prices.rent.metro) ? clamp(100 - prices.rent.metro * 15, 0, 100) : null, fin(prices.cpi.metro) && fin(prices.cpi.usAtSameMonth) ? clamp(50 - (prices.cpi.metro - prices.cpi.usAtSameMonth) * 12, 0, 100) : null]) ?? 50)
    const W = business.warn
    const warnChg = W && !W.stale && W.local90prev.workers ? chg(W.local90.workers, W.local90prev.workers) : null
    const bkScore = bkRow ? Math.round(mean([fin(bkRow.t4Pct) ? 100 - bkRow.t4Pct : null, fin(bkRow.yoy) ? clamp(50 - bkRow.yoy * 2.5, 0, 100) : null, fin(bkRow.bizCh11Pct) ? 100 - bkRow.bizCh11Pct : null])) : null
    const businessScore = Math.round(mean([bkScore, fin(business.apps.m12Yoy) ? clamp(50 + business.apps.m12Yoy * 2, 0, 100) : null, fin(warnChg) ? clamp(50 - warnChg / 3, 0, 100) : null]) ?? 50)
    const tone = s => (s >= 60 ? 'green' : s >= 35 ? 'amber' : 'red')
    const sg = v => (fin(v) ? `${v >= 0 ? '+' : ''}${v}` : '—')
    const counties = U.counties.filter(c => fin(c.v)).map(c => `${c.name} ${c.v}%`).join(', ')
    const scores = {
      labor: { score: laborScore, tone: tone(laborScore), label: laborScore >= 60 ? 'Labor market firm' : laborScore >= 35 ? 'Labor market cooling' : 'Labor market weak', why: `Unemployment ${U.msa}% in the metro (${ord(U.msaPct)} percentile of its own history; ${counties}) vs ${U.state}% for ${city.stateName} and ${U.us}% nationally. Payrolls ${sg(P.yoy)}% year on year (US ${sg(P.yoyUs)}%), ${sg(P.sinceFeb2020)}% vs February 2020. Indeed postings ${fin(J.metro) ? `${J.metro} against 100 in February 2020` : 'n/a'}, ${sg(J.metroChg1y)}% over a year (US ${sg(J.usChg1y)}%). ${city.stateName} initial claims ${sg(labor.claims.state4wYoy)}% on a four-week average.` },
      housing: { score: housingScore, tone: tone(housingScore), label: housingScore >= 60 ? 'Housing firm' : housingScore >= 35 ? 'Housing softening' : 'Housing correcting', why: `${fin(cs?.yoy) ? `Case-Shiller ${sg(cs.yoy)}% year on year (US 20-city ${sg(cs.yoyUs)}%), ${sg(cs.fromPeak)}% from its peak; high tier ${sg(housing.tiers.high)}%, low tier ${sg(housing.tiers.low)}%.` : `This metro is not in the Case-Shiller index, so prices come from the FHFA all-transactions index, ${sg(housing.fhfa.yoy)}% year on year and ${sg(housing.fhfa.fromPeak)}% from its peak, and Zillow, ${sg(metro?.zillow?.zhviYoy)}%.`} Active listings ${sg(inv.activeYoy)}% year on year, median days on market ${inv.dom} against ${inv.dom1y} a year ago. Permits ${housing.permits.m12?.toLocaleString()} units in twelve months, ${sg(housing.permits.m12Yoy)}%. Zillow rent ${sg(metro?.zillow?.zoriYoy)}%.` },
      prices: { score: pricesScore, tone: tone(pricesScore), label: pricesScore >= 60 ? 'Cost of living easing' : pricesScore >= 35 ? 'Cost of living sticky' : 'Cost of living squeezing', why: `Metro CPI ${sg(prices.cpi.metro)}% year on year against ${sg(prices.cpi.usAtSameMonth)}% nationally the same month; rent CPI ${sg(prices.rent.metro)}% against ${sg(prices.rent.usAtSameMonth)}%. Gasoline $${prices.gas.metro?.toFixed(2)} against $${prices.gas.us?.toFixed(2)} nationally (${sg(prices.gas.premium)}%). The BEA prices the metro at ${prices.rpp.v?.toFixed(1)} with the US at 100.` },
      business: { score: businessScore, tone: tone(businessScore), label: businessScore >= 60 ? 'Business conditions healthy' : businessScore >= 35 ? 'Business stress building' : 'Business stress elevated', why: `${business.bk ? `${city.court.name} filings ${sg(business.bk.yoy)}% year on year, ${business.bk.bizCh11T4} business Chapter 11s in the trailing year (p${business.bk.bizCh11Pct} of the decade). ` : ''}${W && !W.stale ? `WARN notices: ${W.local90.workers.toLocaleString()} ${city.region} workers in ${W.local90.notices} notices over 90 days${W.local90prev.workers ? ` against ${W.local90prev.workers.toLocaleString()} the prior 90` : ''}. ` : W ? `${city.stateName}'s WARN feed last advanced ${W.lagDays} days ago, so recent layoffs are not counted here. ` : `${city.stateName} publishes no machine-readable WARN feed, so layoff notices are absent here. `}${city.stateName} business applications ${business.apps.m12?.toLocaleString()}/month on a 12-month average, ${sg(business.apps.m12Yoy)}%.` },
    }
    const worst = Object.entries(scores).sort((a, b) => a[1].score - b[1].score)[0]
    const avg = Math.round(mean(Object.values(scores).map(s => s.score)))
    const headline = {
      label: avg >= 60 ? `${city.region} holding up` : avg >= 45 ? `${city.region} mixed — ${worst[1].label.toLowerCase()}` : `${city.region} under strain`,
      color: avg >= 60 ? '#4ade80' : avg >= 45 ? '#fbbf24' : '#f87171',
      why: `Unemployment ${U.msa}% with payrolls ${sg(P.yoy)}%${fin(J.metro) ? ` and job postings ${J.metro < 100 ? `${Math.round(100 - J.metro)}% below` : `${Math.round(J.metro - 100)}% above`} their pre-pandemic level` : ''}; home prices ${fin(cs?.yoy) ? `${sg(cs.yoy)}%` : fin(metro?.zillow?.zhviYoy) ? `${sg(metro.zillow.zhviYoy)}% (Zillow — this metro is not in Case-Shiller)` : 'n/a'} and rents ${sg(metro?.zillow?.zoriYoy)}%; ${prices.cpi.label === 'Metro' ? 'local' : prices.cpi.label} CPI ${sg(prices.cpi.metro)}%. ${[W && !W.stale && W.local90.workers ? `${W.local90.workers.toLocaleString()} WARN-notice layoffs in the region in 90 days` : null, business.bk ? `${business.bk.bizCh11T4} business Chapter 11s in a year` : null].filter(Boolean).join(', ')}${(W && !W.stale && W.local90.workers) || business.bk ? '. ' : ''}The ${city.giantsName} are ${sg(r1(ewYtd))}% year to date, equal-weighted, against ${sg(spyRow?.ytd)}% for the S&P 500.`,
    }

    return {
      city: { id: city.id, name: city.name, msa: city.msa, region: city.region, state: city.state, stateName: city.stateName, cbsa: city.cbsa, county: city.county, court: city.court.name, giantsName: city.giantsName, giantsNote: city.giantsNote, colour: city.colour, blurb: city.blurb },
      cities: CITIES.map(c => ({ id: c.id, name: c.name, msa: c.msa, region: c.region })),
      headline, scores, labor, housing, prices, business, growth,
      giants: { rows: giants, index, ewYtd: r1(ewYtd), ewYr: r1(ewYr), spyYtd: spyRow?.ytd ?? null, spyYr: spyRow?.yr1 ?? null },
      source: `BLS via FRED (LAUS unemployment, CES payrolls by sector, metro CPI, average prices), Indeed Hiring Lab, Zillow/Case-Shiller/Redfin via the Real Estate metro feed, Realtor.com inventory via FRED, Census permits and business applications, BEA county GDP and income${city.warn ? `, ${city.stateName} WARN` : ''}${bkRow ? `, U.S. Courts and the ${city.court.name} docket via the bankruptcy tracker` : ''}, Yahoo Finance quotes.`,
      updated: new Date().toISOString(),
    }
  }

  async function get(id = DEFAULT_CITY) {
    const city = byId[id] || byId[DEFAULT_CITY]
    const key = city.id
    if (mem[key] && Date.now() - mem[key].ts < TTL) return mem[key].data
    const disk = mem[key] || load(`municipality-${key}.json`)
    if (disk && Date.now() - disk.ts < TTL) { mem[key] = disk; return disk.data }
    if (inflight[key]) return inflight[key]
    inflight[key] = (async () => {
      try { const data = await build(city); mem[key] = { data, ts: Date.now() }; save(`municipality-${key}.json`, mem[key]); return data }
      catch (e) { console.warn(`municipality ${key}:`, e.message); if (disk) return disk.data; throw e }
      finally { delete inflight[key] }
    })()
    return inflight[key]
  }
  return { get, CITIES }
}
