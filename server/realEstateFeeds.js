// ============================================================================
// REAL ESTATE FEEDS — server-side data for the Real Estate tab
// Seven endpoints, all free sources, all cached memory → disk → rebuild:
//   redfin      Redfin Data Center market tracker: SALE prices, sale-to-list,
//               share of listings with price drops, months of supply, days on
//               market — every state monthly (latest month) + national
//               history since 2012 (seasonally adjusted). 9 MB gzip TSV.
//   pipeline    FRED supply pipeline (units under construction single/multi,
//               completions, starts, permits), Realtor.com national listing
//               flow (new listings, active, price-reduced share), a monthly
//               30-year mortgage series, and the FHFA National Mortgage
//               Database "lock-in" statistics (average rate on OUTSTANDING
//               mortgages, share below 4%, …) read from FHFA's zipped CSV.
//   creCredit   Fed SLOOS net-tightening series for CRE lending (construction
//               & land, non-residential, multifamily) + Kastle Systems'
//               weekly 10-city office occupancy scraped from their barometer
//               page and archived week by week (kastle.json, append-only).
//   metro       one CBSA at a time: Realtor.com listing series, Case-Shiller
//               metro index vs the 20-city, metro unemployment, and the
//               Zillow value/rent pair from the rents feed.
//   buildCost   the NAHB national hard-cost-per-sq-ft scaled by each state's
//               construction hourly earnings (BLS via FRED), labor share 40%.
//   rents       Zillow metro ZHVI + ZORI → price-to-rent for ~250 metros,
//               rolled up to states with Zipf weights (population ∝ 1/rank —
//               Zillow publishes rents by metro, not state), and the national
//               price-to-rent history with its percentile.
//   composite   the fair-value scoreboard: residential (income, rent,
//               rebuild) and commercial (cap-rate spread, rebuild) anchors as
//               percentiles → one 0–100 score per sector, archived daily
//               (re-composite.json, append-only) so the gauge grows a history.
// "Only cache complete builds": a FRED 429 or a half-parsed file never
// displaces a good cache (the `complete` predicate on each feed).
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

const H = 60 * 60 * 1000
const fin = v => v != null && Number.isFinite(v)
const last = a => (a && a.length ? a[a.length - 1] : null)
const num = s => { const v = parseFloat(s); return Number.isFinite(v) ? v : null }
const strip = s => (s || '').replace(/^"|"$/g, '')
const pctile = (arr, val) => { const xs = (arr || []).filter(fin); if (!xs.length || !fin(val)) return null; return Math.round((xs.filter(x => x <= val).length / xs.length) * 100) }
const yoyOf = (arr, k) => { if (!arr || arr.length <= k) return null; const a = arr[arr.length - 1].v, b = arr[arr.length - 1 - k].v; return b ? +(((a / b) - 1) * 100).toFixed(1) : null }
const mean = xs => { const v = (xs || []).filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
// merge several [{d,v}] series into rows keyed by date
function mergeSeries(named) {
  const rows = {}
  for (const [k, arr] of Object.entries(named)) for (const p of arr || []) (rows[p.d] = rows[p.d] || { d: p.d })[k] = p.v
  return Object.values(rows).sort((a, b) => a.d.localeCompare(b.d))
}
// CSV line splitter that respects quotes (Zillow quotes "Seattle, WA")
function csvSplit(line) {
  const out = []; let cur = '', q = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++ } else q = !q }
    else if (c === ',' && !q) { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}
// Minimal ZIP reader (deflate/stored entries). FHFA ships the NMDB tables
// zipped and Node has no built-in unzip; walking the central directory keeps
// data-descriptor entries (sizes written after the data) working.
export function unzipEntries(buf) {
  let eocd = -1
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 66000); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  if (eocd < 0) throw new Error('zip: no end-of-central-directory record')
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16)
  const out = []
  let p = cdOff
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break
    const method = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28), extraLen = buf.readUInt16LE(p + 30), commentLen = buf.readUInt16LE(p + 32), lho = buf.readUInt32LE(p + 42)
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen)
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28)
    const data = buf.subarray(start, start + csize)
    out.push({ name, data: method === 8 ? zlib.inflateRawSync(data) : method === 0 ? data : null })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

// Metro layer — CBSA codes for Realtor.com series on FRED, the Zillow metro
// name, Case-Shiller metro index and BLS metro unemployment where FRED has
// them (verified 2026-09; missing ids simply drop that panel).
export const METROS = [
  { code: '42660', name: 'Seattle', z: 'Seattle, WA', cs: 'SEXRSA', ur: 'SEAT653URN' },
  { code: '31080', name: 'Los Angeles', z: 'Los Angeles, CA', cs: 'LXXRSA', ur: 'LOSA106URN' },
  { code: '41860', name: 'San Francisco', z: 'San Francisco, CA', cs: 'SFXRSA', ur: 'SANF806URN' },
  { code: '41740', name: 'San Diego', z: 'San Diego, CA', cs: 'SDXRSA', ur: null },
  { code: '40900', name: 'Sacramento', z: 'Sacramento, CA', cs: null, ur: 'SACR906URN' },
  { code: '38900', name: 'Portland', z: 'Portland, OR', cs: 'POXRSA', ur: 'PORT941URN' },
  { code: '38060', name: 'Phoenix', z: 'Phoenix, AZ', cs: 'PHXRSA', ur: 'PHOE004URN' },
  { code: '29820', name: 'Las Vegas', z: 'Las Vegas, NV', cs: 'LVXRSA', ur: 'LASV832URN' },
  { code: '19740', name: 'Denver', z: 'Denver, CO', cs: 'DNXRSA', ur: 'DENV708URN' },
  { code: '41620', name: 'Salt Lake City', z: 'Salt Lake City, UT', cs: null, ur: null },
  { code: '19100', name: 'Dallas', z: 'Dallas, TX', cs: 'DAXRSA', ur: 'DALL148URN' },
  { code: '26420', name: 'Houston', z: 'Houston, TX', cs: null, ur: 'HOUS448URN' },
  { code: '12420', name: 'Austin', z: 'Austin, TX', cs: null, ur: 'AUST448URN' },
  { code: '33460', name: 'Minneapolis', z: 'Minneapolis, MN', cs: 'MNXRSA', ur: 'MINN427URN' },
  { code: '16980', name: 'Chicago', z: 'Chicago, IL', cs: 'CHXRSA', ur: 'CHIC917URN' },
  { code: '19820', name: 'Detroit', z: 'Detroit, MI', cs: 'DEXRSA', ur: 'DETR826URN' },
  { code: '34980', name: 'Nashville', z: 'Nashville, TN', cs: null, ur: 'NASH947URN' },
  { code: '12060', name: 'Atlanta', z: 'Atlanta, GA', cs: 'ATXRSA', ur: 'ATLA013URN' },
  { code: '16740', name: 'Charlotte', z: 'Charlotte, NC', cs: 'CRXRSA', ur: null },
  { code: '39580', name: 'Raleigh', z: 'Raleigh, NC', cs: null, ur: null },
  { code: '45300', name: 'Tampa', z: 'Tampa, FL', cs: 'TPXRSA', ur: 'TAMP312URN' },
  { code: '33100', name: 'Miami', z: 'Miami, FL', cs: 'MIXRSA', ur: null },
  { code: '47900', name: 'Washington DC', z: 'Washington, DC', cs: 'WDXRSA', ur: 'WASH911URN' },
  { code: '35620', name: 'New York', z: 'New York, NY', cs: 'NYXRSA', ur: 'NEWY636URN' },
  { code: '14460', name: 'Boston', z: 'Boston, MA', cs: 'BOXRSA', ur: null },
]

const BUILD_BASE = { value: 162, asOf: '2024', source: 'NAHB Cost of Constructing a Home 2024 (avg $428K / 2,647 sq ft)' }
const LABOR_SHARE = 0.4 // share of hard cost that is on-site labor (NAHB: roughly 35–45%); materials priced nationally

export function createRealEstateFeeds({ fetchFredSeries, UA, dir, stateFips, fetchHousingHealth, fetchReplacementCost, fetchCreFundamentals, fetchReitCapRates }) {
  const file = name => path.join(dir, name)
  const loadFile = name => { try { if (fs.existsSync(file(name))) return JSON.parse(fs.readFileSync(file(name), 'utf8')) } catch {} return null }
  const saveFile = (name, obj) => { try { fs.writeFileSync(file(name), JSON.stringify(obj)) } catch (e) { console.error(`${name} save:`, e.message) } }
  const mem = {}, inflight = {}

  // memory → disk → rebuild; an incomplete build never displaces a good cache
  async function cached(name, ttl, build, complete = d => !!d) {
    const m = mem[name]
    if (m && Date.now() - m.ts < ttl) return m.data
    const disk = m || loadFile(`${name}.json`)
    if (disk && Date.now() - disk.ts < ttl) { mem[name] = disk; return disk.data }
    if (inflight[name]) return inflight[name]
    inflight[name] = (async () => {
      try {
        const data = await build()
        if (complete(data)) { mem[name] = { data, ts: Date.now() }; saveFile(`${name}.json`, mem[name]); return data }
        console.warn(`${name}: incomplete build — serving ${disk ? 'the previous cache' : 'the partial result'}`)
        return disk?.data || data
      } catch (e) {
        console.warn(`${name}: ${e.message}`)
        if (disk) return disk.data
        throw e
      } finally { delete inflight[name] }
    })()
    return inflight[name]
  }
  const get = async (url, as = 'text') => {
    const r = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!r.ok) throw new Error(`${url.split('/').pop()}: HTTP ${r.status}`)
    return as === 'buffer' ? Buffer.from(await r.arrayBuffer()) : r.text()
  }

  // ── Redfin market tracker ────────────────────────────────────────────────
  const REDFIN = 'https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/'
  const RF_COLS = {
    price: 'MEDIAN_SALE_PRICE', priceYoy: 'MEDIAN_SALE_PRICE_YOY', listPrice: 'MEDIAN_LIST_PRICE', ppsf: 'MEDIAN_PPSF', ppsfYoy: 'MEDIAN_PPSF_YOY',
    sold: 'HOMES_SOLD', soldYoy: 'HOMES_SOLD_YOY', newListings: 'NEW_LISTINGS', newYoy: 'NEW_LISTINGS_YOY', inventory: 'INVENTORY', invYoy: 'INVENTORY_YOY',
    months: 'MONTHS_OF_SUPPLY', dom: 'MEDIAN_DOM', domYoy: 'MEDIAN_DOM_YOY', saleToList: 'AVG_SALE_TO_LIST', aboveList: 'SOLD_ABOVE_LIST',
    priceDrops: 'PRICE_DROPS', offMarket2w: 'OFF_MARKET_IN_TWO_WEEKS',
  }
  function parseRedfin(tsv, { sa = null } = {}) {
    const lines = tsv.split('\n')
    const head = lines[0].replace(/\r$/, '').split('\t').map(strip)
    const ix = Object.fromEntries(head.map((h, i) => [h, i]))
    const rows = []
    for (let i = 1; i < lines.length; i++) {
      const L = lines[i]
      if (!L.includes('"All Residential"')) continue
      const c = L.replace(/\r$/, '').split('\t')
      if (sa != null && strip(c[ix.IS_SEASONALLY_ADJUSTED]) !== String(sa)) continue
      const r = { d: strip(c[ix.PERIOD_BEGIN]), st: strip(c[ix.STATE_CODE]), updated: strip(c[ix.LAST_UPDATED]).slice(0, 10) }
      for (const [k, col] of Object.entries(RF_COLS)) r[k] = num(c[ix[col]])
      rows.push(r)
    }
    return rows
  }
  const redfin = () => cached('redfin', 24 * H, async () => {
    const [stTsv, usTsv] = await Promise.all([
      get(REDFIN + 'state_market_tracker.tsv000.gz', 'buffer').then(b => zlib.gunzipSync(b).toString('utf8')),
      get(REDFIN + 'us_national_market_tracker.tsv000.gz', 'buffer').then(b => zlib.gunzipSync(b).toString('utf8')),
    ])
    const st = parseRedfin(stTsv), us = parseRedfin(usTsv, { sa: true })
    const asOf = st.reduce((m, r) => (r.d > m ? r.d : m), '')
    const states = {}
    for (const r of st) if (r.d === asOf && r.st) states[r.st] = r
    us.sort((a, b) => a.d.localeCompare(b.d))
    const series = us.map(r => ({ d: r.d, price: r.price, ppsf: r.ppsf, sold: r.sold, newListings: r.newListings, inventory: r.inventory, months: r.months, dom: r.dom, saleToList: r.saleToList, aboveList: r.aboveList, priceDrops: r.priceDrops, offMarket2w: r.offMarket2w }))
    const latest = last(us)
    const pct = k => pctile(series.map(p => p[k]), latest?.[k])
    return {
      asOf, fileUpdated: latest?.updated || null, states,
      national: { latest, series, pct: { saleToList: pct('saleToList'), priceDrops: pct('priceDrops'), months: pct('months'), dom: pct('dom'), aboveList: pct('aboveList') } },
      source: 'Redfin Data Center market tracker (all residential; states not seasonally adjusted, national seasonally adjusted)',
      updated: new Date().toISOString(),
    }
  }, d => d && Object.keys(d.states).length >= 45 && d.national.series.length > 100)

  // ── FHFA National Mortgage Database — the lock-in statistics ─────────────
  const nmdb = () => cached('nmdb', 7 * 24 * H, async () => {
    const buf = await get('https://www.fhfa.gov/document/d/nmdb/nmdb-outstanding-mortgage-statistics-national-census-areas-quarterly.zip', 'buffer')
    const entry = unzipEntries(buf).find(e => e.name.toLowerCase().endsWith('.csv') && e.data)
    if (!entry) throw new Error('NMDB: no CSV inside the zip')
    const lines = entry.data.toString('utf8').split('\n')
    const head = csvSplit(lines[0].trim())
    const ix = Object.fromEntries(head.map((h, i) => [h, i]))
    const by = {}
    for (let i = 1; i < lines.length; i++) {
      const L = lines[i]
      if (!L.includes(',National,')) continue
      const c = csvSplit(L.trim())
      if (c[ix.MARKET] !== 'All Mortgages') continue
      const v = num(c[ix.VALUE1]); if (v == null) continue
      ;(by[c[ix.SERIESID]] = by[c[ix.SERIESID]] || []).push({ d: c[ix.PERIOD], v })
    }
    for (const k of Object.keys(by)) by[k].sort((a, b) => a.d.localeCompare(b.d))
    const cur = id => last(by[id])?.v ?? null
    const asOf = last(by.AVE_INTRATE)?.d || null
    if (!asOf) throw new Error('NMDB: AVE_INTRATE rows not found')
    const below4Series = (by.PCT_INTRATE_LT_3 || []).map((p, i) => ({ d: p.d, v: +(p.v + (by.PCT_INTRATE_3_4?.[i]?.v ?? 0)).toFixed(1) }))
    return {
      asOf, avgRate: cur('AVE_INTRATE'), below3: cur('PCT_INTRATE_LT_3'), r3to4: cur('PCT_INTRATE_3_4'), r4to5: cur('PCT_INTRATE_4_5'), r5to6: cur('PCT_INTRATE_5_6'), ge6: cur('PCT_INTRATE_GE_6'),
      below4: last(below4Series)?.v ?? null, avgPayment: cur('AVE_PAYMENT'), avgLtv: cur('AVE_MTMLTV'), ltvLe60: cur('PCT_MTMLTV_LE60'), vantage: cur('AVE_VANTAGESCR'), loansK: cur('TOT_LOANS'), upbB: cur('TOT_UPB'),
      series: by.AVE_INTRATE, below4Series, ge6Series: by.PCT_INTRATE_GE_6 || [],
      source: 'FHFA National Mortgage Database — outstanding residential mortgages, all markets, quarterly (loan-count weighted)',
    }
  }, d => d && fin(d.avgRate))

  // ── Residential supply pipeline + listing flow + mortgage + lock-in ──────
  const PIPE = { UNDCONTSA: 300, UNDCON5MUSA: 300, UNDCON1USA: 300, COMPUTSA: 300, HOUST1F: 300, HOUST5F: 300, PERMIT1: 300, PERMIT5: 300, NEWLISCOUUS: 130, PRIREDCOUUS: 130, ACTLISCOUUS: 130, MORTGAGE30US: 720 }
  const pipeline = () => cached('re-pipeline', 6 * H, async () => {
    const s = {}
    for (const [id, limit] of Object.entries(PIPE)) s[id] = await fetchFredSeries(id, limit)
    const mm = {}
    for (const p of s.MORTGAGE30US) { const k = p.d.slice(0, 7); (mm[k] = mm[k] || []).push(p.v) }
    const mortgageMonthly = Object.keys(mm).sort().map(k => ({ d: `${k}-01`, v: +mean(mm[k]).toFixed(2) }))
    const byM = arr => Object.fromEntries(arr.map(p => [p.d.slice(0, 7), p.v]))
    const pr = byM(s.PRIREDCOUUS), ac = byM(s.ACTLISCOUUS)
    const reducedShare = Object.keys(pr).filter(k => ac[k]).sort().map(k => ({ d: `${k}-01`, v: +((pr[k] / ac[k]) * 100).toFixed(1) }))
    const cur = id => last(s[id])?.v ?? null
    const lockin = await nmdb().catch(e => ({ error: e.message }))
    const multiHist = s.UNDCON5MUSA.map(p => p.v)
    return {
      construction: {
        series: mergeSeries({ total: s.UNDCONTSA, multi: s.UNDCON5MUSA, single: s.UNDCON1USA, completions: s.COMPUTSA }),
        underConstruction: cur('UNDCONTSA'), multi: cur('UNDCON5MUSA'), single: cur('UNDCON1USA'), completions: cur('COMPUTSA'),
        multiYoy: yoyOf(s.UNDCON5MUSA, 12), singleYoy: yoyOf(s.UNDCON1USA, 12), completionsYoy: yoyOf(s.COMPUTSA, 12),
        multiPeak: multiHist.length ? Math.max(...multiHist) : null, multiPeakDate: multiHist.length ? s.UNDCON5MUSA[multiHist.indexOf(Math.max(...multiHist))].d : null,
        multiPct: pctile(multiHist, cur('UNDCON5MUSA')), asOf: last(s.UNDCONTSA)?.d || null,
      },
      starts: {
        series: mergeSeries({ single: s.HOUST1F, multi: s.HOUST5F, permitsSingle: s.PERMIT1, permitsMulti: s.PERMIT5 }),
        single: cur('HOUST1F'), multi: cur('HOUST5F'), permitsSingle: cur('PERMIT1'), permitsMulti: cur('PERMIT5'),
        singleYoy: yoyOf(s.HOUST1F, 12), multiYoy: yoyOf(s.HOUST5F, 12), permitsMultiYoy: yoyOf(s.PERMIT5, 12), permitsSingleYoy: yoyOf(s.PERMIT1, 12), asOf: last(s.HOUST1F)?.d || null,
      },
      listings: {
        newListings: cur('NEWLISCOUUS'), newYoy: yoyOf(s.NEWLISCOUUS, 12), active: cur('ACTLISCOUUS'), activeYoy: yoyOf(s.ACTLISCOUUS, 12),
        reducedShare: last(reducedShare)?.v ?? null, reducedShare1y: reducedShare.length > 12 ? reducedShare[reducedShare.length - 13].v : null, reducedPct: pctile(reducedShare.map(p => p.v), last(reducedShare)?.v),
        series: mergeSeries({ newListings: s.NEWLISCOUUS, active: s.ACTLISCOUUS, reduced: reducedShare }), asOf: last(s.ACTLISCOUUS)?.d || null,
      },
      mortgageMonthly, mortgageNow: cur('MORTGAGE30US'), mortgageAsOf: last(s.MORTGAGE30US)?.d || null,
      lockin,
      updated: new Date().toISOString(),
    }
  }, d => d && fin(d.construction.underConstruction) && fin(d.starts.single) && d.mortgageMonthly.length > 24)

  // ── Kastle 10-city office occupancy (weekly, archived) ───────────────────
  const KASTLE_URL = 'https://www.kastle.com/safety-wellness/getting-america-back-to-work/'
  const KASTLE_CITIES = ['Austin', 'Chicago', 'Dallas', 'Houston', 'Los Angeles', 'New York City', 'Philadelphia', 'San Francisco', 'San Jose', 'Washington, D.C.']
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
  function parseKastle(html) {
    const t = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')
      .replace(/&#8217;|&rsquo;|’/g, "'").replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
    const g = re => { const m = t.match(re); return m ? parseFloat(m[1]) : null }
    const avg = g(/Back to Work Barometer reported a national average of (\d+\.\d)%/i) ?? g(/national average of (\d+\.\d)%/i)
    const prev = g(/prior week'?s (\d+\.\d)%/i)
    const peak = g(/average occupancy of (\d+\.\d)%/i)
    const cities = {}
    const re = new RegExp(`(${KASTLE_CITIES.map(c => c.replace(/\./g, '\\.').replace(/,/g, ',?')).join('|')}) \\(([+-]?\\d+\\.\\d) to (\\d+\\.\\d)%\\)`, 'g')
    let m
    while ((m = re.exec(t))) cities[m[1].replace(/ City$/, '').replace(/Washington,? D\.C\./, 'Washington DC')] = { v: parseFloat(m[3]), chg: parseFloat(m[2]) }
    // week key = the peak day named in the text (year from the chart image's mm.dd.yy)
    const pd = t.match(/(?:Monday|Tuesday|Wednesday|Thursday|Friday), (January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}),? was the peak day/i)
    const img = html.match(/Daily-Analysis_(\d\d)\.(\d\d)\.(\d\d)/)
    let d = null
    if (pd) d = `${img ? 2000 + parseInt(img[3], 10) : new Date().getFullYear()}-${String(MONTHS.indexOf(pd[1]) + 1).padStart(2, '0')}-${String(pd[2]).padStart(2, '0')}`
    else if (img) d = `20${img[3]}-${img[1]}-${img[2]}`
    return { d, avg, prev, peak, cities }
  }
  const kastle = () => cached('kastle-page', 12 * H, async () => {
    const p = parseKastle(await get(KASTLE_URL))
    if (!fin(p.avg)) throw new Error('Kastle: barometer text not found on the page')
    const store = loadFile('kastle.json') || { weeks: [] }
    const key = p.d || new Date().toISOString().slice(0, 10)
    const entry = { d: key, avg: p.avg, prev: p.prev, peak: p.peak, cities: p.cities }
    const i = store.weeks.findIndex(w => w.d === key)
    if (i >= 0) store.weeks[i] = entry; else { store.weeks.push(entry); store.weeks.sort((a, b) => a.d.localeCompare(b.d)) }
    saveFile('kastle.json', store)
    return { ...entry, weeks: store.weeks.map(w => ({ d: w.d, avg: w.avg })), source: 'Kastle Systems 10-City Back to Work Barometer — weekly card-swipe occupancy vs the February-2020 baseline (= 100%)' }
  }, d => d && fin(d.avg))

  // ── CRE credit: SLOOS standards + office occupancy ───────────────────────
  const creCredit = () => cached('cre-credit', 6 * H, async () => {
    const cld = await fetchFredSeries('SUBLPDRCSC', 120), nonres = await fetchFredSeries('SUBLPDRCSN', 120), multi = await fetchFredSeries('SUBLPDRCSM', 120)
    const k = await kastle().catch(e => ({ error: e.message }))
    const cur = a => last(a)?.v ?? null
    const avg = mean([cur(cld), cur(nonres), cur(multi)])
    let verdict
    if (avg == null) verdict = { label: 'Data unavailable', color: '#64748b', note: '' }
    else if (avg >= 20) verdict = { label: 'Banks tightening hard', color: '#ef4444', note: 'A net fifth or more of banks are tightening CRE standards — credit is being withdrawn, the classic setting for forced sales.' }
    else if (avg > 5) verdict = { label: 'Standards tightening', color: '#fbbf24', note: 'More banks tightening than easing — refinancing gets harder at the margin.' }
    else if (avg >= -5) verdict = { label: 'Standards steady', color: '#94a3b8', note: 'Tightening and easing roughly balanced — credit is neither a tailwind nor a headwind.' }
    else verdict = { label: 'Banks easing', color: '#4ade80', note: 'Net easing of CRE standards — lenders are back, which is what refinances the maturity wall and puts a floor under prices.' }
    return {
      sloos: { cld: cur(cld), nonres: cur(nonres), multi: cur(multi), avg: avg != null ? +avg.toFixed(1) : null, verdict, series: mergeSeries({ cld, nonres, multi }), asOf: last(nonres)?.d || null, source: 'Fed Senior Loan Officer Opinion Survey — net % of domestic banks tightening standards (quarterly)' },
      kastle: k, updated: new Date().toISOString(),
    }
  }, d => d && d.sloos.series.length > 8)

  // ── Zillow rents: metro price-to-rent → states (Zipf weights) ────────────
  const Z = 'https://files.zillowstatic.com/research/public_csvs/'
  function parseZillowWide(csv, keepSeries) {
    const lines = csv.split('\n')
    const head = csvSplit(lines[0].trim())
    const dateCols = head.map((h, i) => (/^\d{4}-\d{2}-\d{2}$/.test(h) ? i : -1)).filter(i => i >= 0)
    const rows = []
    for (let i = 1; i < lines.length; i++) {
      const L = lines[i].trim(); if (!L) continue
      const c = csvSplit(L)
      let li = dateCols.length - 1
      while (li >= 0 && num(c[dateCols[li]]) == null) li--
      if (li < 0) continue
      const cur = num(c[dateCols[li]]), yr = li >= 12 ? num(c[dateCols[li - 12]]) : null
      const row = { id: c[0], rank: num(c[1]), name: c[2], type: c[3], state: c[4], v: cur, d: head[dateCols[li]], yoy: yr ? +(((cur / yr) - 1) * 100).toFixed(1) : null }
      if (keepSeries && keepSeries(row)) row.series = dateCols.map(j => ({ d: head[j], v: num(c[j]) })).filter(p => p.v != null)
      rows.push(row)
    }
    return rows
  }
  const rents = () => cached('re-rents', 24 * H, async () => {
    const isUS = r => r.type === 'country'
    const [zh, zo] = await Promise.all([get(Z + 'zhvi/Metro_zhvi_uc_sfrcondo_tier_0.33_0.67_sm_sa_month.csv'), get(Z + 'zori/Metro_zori_uc_sfrcondomfr_sm_sa_month.csv')])
    const H1 = parseZillowWide(zh, isUS), R1 = parseZillowWide(zo, isUS)
    const rentBy = Object.fromEntries(R1.filter(r => r.type === 'msa').map(r => [r.name, r]))
    const metros = []
    for (const h of H1) {
      if (h.type !== 'msa') continue
      const r = rentBy[h.name]
      if (!r || !h.v || !r.v || !h.rank) continue
      const p2r = h.v / (r.v * 12)
      metros.push({ name: h.name, state: h.state, rank: h.rank, zhvi: h.v, zhviYoy: h.yoy, zori: r.v, zoriYoy: r.yoy, p2r: +p2r.toFixed(1), yield: +(100 / p2r).toFixed(2), d: h.d })
    }
    metros.sort((a, b) => a.rank - b.rank)
    const acc = {}
    for (const m of metros) {
      if (!m.state) continue
      const w = 1 / m.rank
      const s = acc[m.state] = acc[m.state] || { wP: 0, wR: 0, wY: 0, w: 0, n: 0, top: m.name }
      s.wP += w * m.p2r; s.wR += w * m.zori; s.wY += w * (m.zhviYoy ?? 0); s.w += w; s.n++
    }
    const states = {}
    for (const [st, s] of Object.entries(acc)) { const p2r = s.wP / s.w; states[st] = { p2r: +p2r.toFixed(1), yield: +(100 / p2r).toFixed(2), rent: Math.round(s.wR / s.w), n: s.n, top: s.top } }
    const nh = H1.find(isUS), nr = R1.find(isUS)
    const rentByM = Object.fromEntries((nr?.series || []).map(p => [p.d.slice(0, 7), p.v]))
    const p2rSeries = (nh?.series || []).filter(p => rentByM[p.d.slice(0, 7)]).map(p => ({ d: p.d, v: +(p.v / (rentByM[p.d.slice(0, 7)] * 12)).toFixed(2) }))
    const p2rNow = last(p2rSeries)?.v ?? null
    return {
      asOf: nh?.d || null,
      national: { zhvi: nh?.v ?? null, zhviYoy: nh?.yoy ?? null, zori: nr?.v ?? null, zoriYoy: nr?.yoy ?? null, p2r: p2rNow, yield: p2rNow ? +(100 / p2rNow).toFixed(2) : null, p2rPct: pctile(p2rSeries.map(p => p.v), p2rNow), p2rSeries, since: p2rSeries[0]?.d?.slice(0, 4) || null },
      metros: metros.slice(0, 250), states,
      method: 'State ratios average the metro ratios with Zipf weights (population ∝ 1 ÷ Zillow size rank) — Zillow publishes rents by metro, not by state.',
      source: 'Zillow ZHVI (typical value, smoothed & seasonally adjusted) and ZORI (asking rent), metro files',
      updated: new Date().toISOString(),
    }
  }, d => d && d.metros.length > 100 && Object.keys(d.states).length >= 40)

  // ── Metro layer ──────────────────────────────────────────────────────────
  const metro = code => {
    const m = METROS.find(x => x.code === String(code))
    if (!m) throw new Error(`unknown metro code ${code}`)
    return cached(`re-metro-${m.code}`, 6 * H, async () => {
      const ids = { price: `MEDLISPRI${m.code}`, ppsf: `MEDLISPRIPERSQUFEE${m.code}`, active: `ACTLISCOU${m.code}`, newListings: `NEWLISCOU${m.code}`, reduced: `PRIREDCOU${m.code}`, dom: `MEDDAYONMAR${m.code}` }
      const s = {}
      for (const [k, id] of Object.entries(ids)) s[k] = await fetchFredSeries(id, 130)
      const cs = m.cs ? await fetchFredSeries(m.cs, 320) : []
      const cs20 = cs.length ? await fetchFredSeries('SPCS20RSA', 320) : []
      const ur = m.ur ? await fetchFredSeries(m.ur, 130) : []
      const rows = mergeSeries(s).map(r => ({ ...r, reducedShare: fin(r.reduced) && r.active ? +((r.reduced / r.active) * 100).toFixed(1) : null }))
      const rs = rows.filter(r => fin(r.reducedShare))
      const cur = k => last(s[k])?.v ?? null
      let csOut = null
      if (cs.length) {
        const merged = mergeSeries({ metro: cs, us: cs20 })
        const base = merged.find(r => fin(r.metro) && fin(r.us))
        const idx = base ? merged.map(r => ({ d: r.d, metro: fin(r.metro) ? +((r.metro / base.metro) * 100).toFixed(1) : null, us: fin(r.us) ? +((r.us / base.us) * 100).toFixed(1) : null })) : []
        const peak = Math.max(...cs.map(p => p.v))
        csOut = { id: m.cs, yoy: yoyOf(cs, 12), yoyUs: yoyOf(cs20, 12), fromPeak: +(((last(cs).v / peak) - 1) * 100).toFixed(1), asOf: last(cs)?.d || null, since: idx[0]?.d?.slice(0, 4) || null, series: idx.slice(-300) }
      }
      const rr = await rents().catch(() => null)
      const zm = rr?.metros?.find(x => x.name === m.z) || null
      return {
        code: m.code, name: m.name, zillowName: m.z,
        listing: {
          price: cur('price'), priceYoy: yoyOf(s.price, 12), ppsf: cur('ppsf'), ppsfYoy: yoyOf(s.ppsf, 12), active: cur('active'), activeYoy: yoyOf(s.active, 12),
          newListings: cur('newListings'), newYoy: yoyOf(s.newListings, 12), reducedShare: last(rs)?.reducedShare ?? null, reducedShare1y: rs.length > 12 ? rs[rs.length - 13].reducedShare : null,
          dom: cur('dom'), dom1y: s.dom.length > 12 ? s.dom[s.dom.length - 13].v : null, asOf: last(s.price)?.d || null, series: rows.slice(-120),
        },
        caseShiller: csOut,
        unemployment: ur.length ? { cur: last(ur).v, yr: ur.length > 12 ? ur[ur.length - 13].v : null, asOf: last(ur).d, series: ur.slice(-120) } : null,
        zillow: zm, rentsAsOf: rr?.asOf || null, updated: new Date().toISOString(),
      }
    }, d => d && fin(d.listing.price))
  }

  // ── State build cost (NAHB base × state construction wage factor) ────────
  const buildCost = () => cached('re-buildcost', 24 * H, async () => {
    const us = await fetchFredSeries('CES2000000003', 13)
    const usW = last(us)?.v
    if (!usW) throw new Error('national construction hourly earnings unavailable')
    const states = {}
    for (const [st, fips] of Object.entries(stateFips)) {
      const obs = await fetchFredSeries(`SMU${fips}000002000000003`, 13)
      const w = last(obs)?.v
      const factor = w ? +(LABOR_SHARE * (w / usW) + (1 - LABOR_SHARE)).toFixed(3) : 1
      states[st] = { wage: w ?? null, wageYoy: w ? yoyOf(obs, 12) : null, factor, cost: Math.round(BUILD_BASE.value * factor), d: last(obs)?.d || last(us)?.d || null, est: !w }
    }
    return {
      base: BUILD_BASE, laborShare: LABOR_SHARE, us: { wage: usW, wageYoy: yoyOf(us, 12), d: last(us)?.d || null }, states,
      method: `state build cost = $${BUILD_BASE.value} × (${LABOR_SHARE} × state ÷ U.S. construction hourly earnings + ${1 - LABOR_SHARE}); materials priced nationally. States without a BLS construction-earnings series use the national cost (flagged est).`,
      updated: new Date().toISOString(),
    }
  }, d => d && Object.values(d.states).filter(s => !s.est).length >= 40)

  // ── Fair-value composite (archived daily) ────────────────────────────────
  const tone = s => s == null ? { label: 'n/a', color: '#64748b' }
    : s >= 75 ? { label: 'Rich', color: '#f87171' } : s >= 58 ? { label: 'Full', color: '#fbbf24' } : s >= 42 ? { label: 'Fair', color: '#94a3b8' } : s >= 25 ? { label: 'Reasonable', color: '#4ade80' } : { label: 'Cheap', color: '#22d3ee' }
  const composite = () => cached('re-composite-live', 1 * H, async () => {
    const [housing, repl, cre, reit, rr] = await Promise.all([
      fetchHousingHealth().catch(() => null), fetchReplacementCost().catch(() => null), fetchCreFundamentals().catch(() => null), fetchReitCapRates().catch(() => null), rents().catch(() => null),
    ])
    const r = x => (fin(x) ? Math.round(x) : null)
    const resAnchors = [
      { key: 'income', label: 'Price vs income', value: housing?.afford?.current ?? null, unit: '% of income', pct: housing?.afford?.pct ?? null, detail: housing ? `P&I on the median home = ${housing.afford.current}% of median income (p${housing.afford.pct} since ${housing.afford.since})` : 'unavailable' },
      { key: 'rent', label: 'Price vs rent', value: rr?.national?.p2r ?? null, unit: '× annual rent', pct: rr?.national?.p2rPct ?? null, detail: rr ? `Zillow value ÷ annual rent = ${rr.national.p2r}× (p${rr.national.p2rPct} since ${rr.national.since}; gross yield ${rr.national.yield}%)` : 'unavailable' },
      { key: 'rebuild', label: 'Price vs rebuild', value: repl?.verdict?.ratio ?? null, unit: 'index, 100 = parity', pct: repl?.verdict?.pct ?? null, detail: repl ? `Case-Shiller ÷ construction-input PPI = ${repl.verdict.ratio} (p${repl.verdict.pct} since ${repl.ratioSince})` : 'unavailable' },
    ]
    const spread = reit?.available ? reit.spread : null
    const spreadScore = fin(spread) ? Math.round(Math.max(0, Math.min(100, ((3.5 - spread) / 3.5) * 100))) : null
    const comAnchors = [
      { key: 'yield', label: 'Yield vs bonds', value: fin(spread) ? +spread.toFixed(2) : null, unit: 'pts over 10Y', pct: spreadScore, detail: fin(spread) ? `REIT-implied cap rate ${reit.avgCap.toFixed(2)}% − 10Y ${reit.tenYear.toFixed(2)}% = ${spread >= 0 ? '+' : ''}${spread.toFixed(1)} pts (3.5 pts scores cheap, 0 scores rich)` : 'unavailable' },
      { key: 'rebuild', label: 'Price vs rebuild', value: cre?.replacement?.current ?? null, unit: 'index, mean = 100', pct: cre?.replacement?.pct ?? null, detail: cre ? `BIS CRE price level ÷ construction-input PPI = ${cre.replacement.current} (p${cre.replacement.pct} since ${cre.replacement.since})` : 'unavailable' },
    ]
    const resScore = r(mean(resAnchors.map(a => a.pct))), comScore = r(mean(comAnchors.map(a => a.pct)))
    const support = {
      residential: housing ? { supplyMonths: housing.supply.current, supplyPct: housing.supply.pct, mortgageDq: cre?.delinquency?.mortgage?.current ?? null, verdict: housing.verdict?.label || null } : null,
      commercial: cre ? { dq: cre.delinquency.cre.current, dqPct: cre.delinquency.cre.pct, dqChg1y: cre.delinquency.cre.chg1y, priceYoy: cre.price.yoy, priceAsOf: cre.price.asOf, rentalVacancy: cre.vacancy.rental.current, cycle: cre.cycle?.label || null } : null,
    }
    const store = loadFile('re-composite.json') || { days: [] }
    const today = new Date().toISOString().slice(0, 10)
    if (resScore != null || comScore != null) {
      const row = { d: today, res: resScore, com: comScore, resAnchors: Object.fromEntries(resAnchors.map(a => [a.key, a.pct])), comAnchors: Object.fromEntries(comAnchors.map(a => [a.key, a.pct])) }
      const i = store.days.findIndex(x => x.d === today)
      if (i >= 0) store.days[i] = row; else store.days.push(row)
      saveFile('re-composite.json', store)
    }
    return {
      residential: { score: resScore, tone: tone(resScore), anchors: resAnchors, n: resAnchors.filter(a => fin(a.pct)).length },
      commercial: { score: comScore, tone: tone(comScore), anchors: comAnchors, n: comAnchors.filter(a => fin(a.pct)).length },
      support, history: store.days,
      scale: '0 = cheapest versus its own history, 100 = richest. Each score averages its valuation anchors\' percentiles; supply and credit are reported as support, not scored.',
      updated: new Date().toISOString(),
    }
  }, d => d && (fin(d.residential.score) || fin(d.commercial.score)))

  return { redfin, pipeline, creCredit, metro, buildCost, rents, composite, METROS }
}
