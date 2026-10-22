// ============================================================================
// GLOBAL HOUSING — residential property markets across ~60 countries, for
// breadth next to the US detail (Real Estate tab) and China (International →
// China). Not as granular as the US views: one row per country, quarterly.
//
//   spp    stats.bis.org SDMX WS_SPP Q..N+R.628 (keyless, one request, ~0.7 MB):
//          BIS selected residential property prices, nominal (N) and deflated
//          by CPI (R), 2010 = 100, 58 countries + world (XW), advanced (5R),
//          emerging (4T) and euro-area (XM) aggregates; most from 1970.
//   oecd   sdmx.oecd.org OECD.ECO.MPD DSD_AN_HOUSE_PRICES@DF_HOUSE_PRICES
//          (keyless, ~2.7 MB filtered to five measures): price-to-income and
//          price-to-rent ratios standardised to their long-run average = 100
//          (HPI_YDH_AVG, HPI_RPI_AVG) and rent prices (RPI), ~40 countries.
//          The OECD file is not sorted by period; some ratios lag a year or
//          more (each carries its own as-of date).
//   tc     stats.bis.org WS_TC Q..H.A.M.770.A: credit to households and NPISHs,
//          % of GDP, market value (BIS total credit statistics).
//   dsr    stats.bis.org WS_DSR Q..H: household debt service ratio, % of
//          income (17 countries).
//   cpp    stats.bis.org WS_CPP Q (detail=dataonly, ~0.1 MB): BIS commercial
//          property prices, 52 series in 20 economies. Thin and mixed: some
//          countries publish all commercial property, others offices and
//          retail only, land prices, or one city; France stopped in 2021, the
//          UAE and Argentina in 2024. One headline per economy is chosen in
//          CPP below (its parts kept beside it). Real = deflated by the CPI
//          implied by BIS's nominal ÷ real residential pair. No free index
//          exists for the UK, Canada, Australia, China, Hong Kong or Korea
//          (MSCI and Green Street are paid).
//
// Every request is keyless and official. Cadence: the sources are quarterly,
// so a week; a build with a failed source retries after 6 hours (30 minutes when the source has no cached copy). A failed
// source keeps its last good raw block from the cache (sourceErrors notes it);
// get() never throws once data exists. Cache: global-housing.json at the root
// (gitignored: payload + raw blocks). Requests per refresh: 5.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, DAY = 24 * H, TTL = 7 * DAY, RETRY = 6 * H, RETRY_EMPTY = H / 2 // a source with no cached copy to fall back on is retried sooner
const BIS = 'https://stats.bis.org/api/v1/data'
const OECD = 'https://sdmx.oecd.org/public/rest/data/OECD.ECO.MPD,DSD_AN_HOUSE_PRICES@DF_HOUSE_PRICES,1.0'
const URLS = {
  spp: `${BIS}/WS_SPP/Q..N+R.628?format=csv&startPeriod=1970`,
  oecd: `${OECD}/.Q.HPI_YDH_AVG+HPI_RPI_AVG+RPI.?startPeriod=1990-Q1&format=csvfile`,
  tc: `${BIS}/WS_TC/Q..H.A.M.770.A?format=csv&startPeriod=1990`,
  dsr: `${BIS}/WS_DSR/Q..H?format=csv&startPeriod=1999`,
  cpp: `${BIS}/WS_CPP/Q?format=csv&detail=dataonly&startPeriod=1990`,
}
const PAGE = { spp: 'https://data.bis.org/topics/RPP', oecd: 'https://www.oecd.org/en/data/datasets/analytical-house-prices-indicators.html', tc: 'https://data.bis.org/topics/TOTAL_CREDIT', dsr: 'https://data.bis.org/topics/DSR', cpp: 'https://data.bis.org/topics/CPP' }
const LABEL = { spp: 'BIS residential property prices', oecd: 'OECD analytical house price indicators', tc: 'BIS credit to households', dsr: 'BIS household debt service ratios', cpp: 'BIS commercial property prices' }

// commercial property: one headline per economy, keyed REF_AREA|COVERED_AREA|RE_TYPE|RE_VINTAGE|COMPILING_ORG|PRICED_UNIT
// (covered area 0 = whole country; type A all commercial, B offices, C retail, D offices + retail, G industrial, M land,
// O residential investment property). kind flags what isn't a whole-country building index.
const CPP = {
  US: { h: 'US|0|A|0|2|6', label: 'All commercial property' },
  XM: { h: 'XM|0|A|0|0|0', label: 'All commercial property (ECB)' },
  DE: { h: 'DE|0|A|0|2|6', label: 'All commercial property', parts: { 'DE|0|B|0|2|6': 'Offices', 'DE|0|C|0|2|6': 'Retail' } },
  ES: { h: 'ES|0|A|0|0|6', label: 'All commercial property', parts: { 'ES|0|B|0|0|6': 'Offices', 'ES|0|C|0|0|6': 'Retail', 'ES|0|G|0|0|6': 'Industrial', 'ES|4|A|0|0|6': 'Prime, major cities' } },
  FR: { h: 'FR|0|A|0|0|6', label: 'All commercial property', kind: 'discontinued', parts: { 'FR|4|A|0|0|6': 'Prime, major cities' } },
  NL: { h: 'NL|0|B|0|1|6', label: 'Offices (trend)', kind: 'offices', parts: { 'NL|0|C|0|1|6': 'Retail', 'NL|0|G|0|1|6': 'Industrial', 'NL|0|O|0|1|6': 'Rental dwellings' } },
  DK: { h: 'DK|0|A|0|1|5', label: 'All business property', parts: { 'DK|0|G|0|1|5': 'Industrial & warehouses' } },
  CH: { h: 'CH|0|O|0|2|6', label: 'Residential investment property', kind: 'investment housing' },
  SI: { h: 'SI|0|D|0|1|6', label: 'Offices & retail', parts: { 'SI|0|B|0|1|6': 'Offices', 'SI|0|C|0|1|6': 'Retail' } },
  CZ: { h: 'CZ|0|M|0|1|6', label: 'Commercial land', kind: 'land' },
  IS: { h: 'IS|3|A|0|0|1', label: 'All commercial, Greater Reykjavik', kind: 'city' },
  TR: { h: 'TR|0|D|0|0|6', label: 'Offices & retail', parts: { 'TR|0|B|0|0|6': 'Offices', 'TR|0|C|0|0|6': 'Retail', 'TR|2|D|0|0|6': 'Istanbul' } },
  JP: { h: 'JP|0|A|0|3|6', label: 'All commercial property', parts: { 'JP|4|A|0|3|6': 'Three metro areas', 'JP|3|M|1|4|1': 'Tokyo commercial land' } },
  SG: { h: 'SG|0|B|0|3|1', label: 'Offices', kind: 'offices', parts: { 'SG|0|C|0|3|1': 'Retail', 'SG|0|G|0|3|1': 'Industrial' } },
  ID: { h: 'ID|4|A|0|0|6', label: 'All commercial, 11 cities', kind: 'cities', parts: { 'ID|3|A|0|0|6': 'Jakarta' } },
  PH: { h: 'PH|2|M|0|2|1', label: 'Commercial land, Makati', kind: 'land' },
  MA: { h: 'MA|0|D|0|0|6', label: 'Offices & retail', parts: { 'MA|2|D|0|0|6': 'Rabat' } },
  SA: { h: 'SA|0|C|0|1|6', label: 'Retail property', kind: 'retail' },
  AE: { h: 'AE|5|B|0|2|1', label: 'Offices, Dubai', kind: 'city', parts: { 'AE|2|B|0|2|1': 'Offices, Abu Dhabi', 'AE|5|C|0|2|1': 'Retail, Dubai' } },
  AR: { h: 'AR|2|C|0|1|1', label: 'Retail, Buenos Aires', kind: 'city', parts: { 'AR|2|B|0|1|1': 'Offices, Buenos Aires' } },
}
const CPP_TYPE = { A: 'All commercial property', B: 'Offices', C: 'Retail', D: 'Offices & retail', G: 'Industrial', M: 'Commercial land', O: 'Investment property' }
const CPP_BASE = '2019' // commercial indices rebased to the 2019 average, the pre-pandemic level
const OUT = '2000-Q1' // series in the payload start here; peaks use the full history

// iso2 (BIS) → [name, iso3 (OECD), ISO numeric (world-atlas), region, advanced?]
const C = {
  US: ['United States', 'USA', '840', 'Americas', 1], CA: ['Canada', 'CAN', '124', 'Americas', 1], MX: ['Mexico', 'MEX', '484', 'Americas', 0],
  BR: ['Brazil', 'BRA', '076', 'Americas', 0], CL: ['Chile', 'CHL', '152', 'Americas', 0], CO: ['Colombia', 'COL', '170', 'Americas', 0], PE: ['Peru', 'PER', '604', 'Americas', 0],
  GB: ['United Kingdom', 'GBR', '826', 'Europe', 1], IE: ['Ireland', 'IRL', '372', 'Europe', 1], FR: ['France', 'FRA', '250', 'Europe', 1], DE: ['Germany', 'DEU', '276', 'Europe', 1],
  NL: ['Netherlands', 'NLD', '528', 'Europe', 1], BE: ['Belgium', 'BEL', '056', 'Europe', 1], LU: ['Luxembourg', 'LUX', '442', 'Europe', 1], AT: ['Austria', 'AUT', '040', 'Europe', 1],
  CH: ['Switzerland', 'CHE', '756', 'Europe', 1], IT: ['Italy', 'ITA', '380', 'Europe', 1], ES: ['Spain', 'ESP', '724', 'Europe', 1], PT: ['Portugal', 'PRT', '620', 'Europe', 1],
  GR: ['Greece', 'GRC', '300', 'Europe', 1], CY: ['Cyprus', 'CYP', '196', 'Europe', 1], MT: ['Malta', 'MLT', '470', 'Europe', 1],
  SE: ['Sweden', 'SWE', '752', 'Europe', 1], NO: ['Norway', 'NOR', '578', 'Europe', 1], DK: ['Denmark', 'DNK', '208', 'Europe', 1], FI: ['Finland', 'FIN', '246', 'Europe', 1], IS: ['Iceland', 'ISL', '352', 'Europe', 1],
  EE: ['Estonia', 'EST', '233', 'Europe', 1], LV: ['Latvia', 'LVA', '428', 'Europe', 1], LT: ['Lithuania', 'LTU', '440', 'Europe', 1], PL: ['Poland', 'POL', '616', 'Europe', 0],
  CZ: ['Czechia', 'CZE', '203', 'Europe', 1], SK: ['Slovakia', 'SVK', '703', 'Europe', 1], SI: ['Slovenia', 'SVN', '705', 'Europe', 1], HU: ['Hungary', 'HUN', '348', 'Europe', 0],
  HR: ['Croatia', 'HRV', '191', 'Europe', 1], RO: ['Romania', 'ROU', '642', 'Europe', 0], BG: ['Bulgaria', 'BGR', '100', 'Europe', 0], RS: ['Serbia', 'SRB', '688', 'Europe', 0],
  MK: ['North Macedonia', 'MKD', '807', 'Europe', 0], RU: ['Russia', 'RUS', '643', 'Europe', 0], TR: ['Türkiye', 'TUR', '792', 'Europe', 0],
  IL: ['Israel', 'ISR', '376', 'Middle East & Africa', 1], ZA: ['South Africa', 'ZAF', '710', 'Middle East & Africa', 0], MA: ['Morocco', 'MAR', '504', 'Middle East & Africa', 0],
  CN: ['China', 'CHN', '156', 'Asia-Pacific', 0], HK: ['Hong Kong SAR', 'HKG', '344', 'Asia-Pacific', 1], JP: ['Japan', 'JPN', '392', 'Asia-Pacific', 1], KR: ['Korea', 'KOR', '410', 'Asia-Pacific', 1],
  SG: ['Singapore', 'SGP', '702', 'Asia-Pacific', 1], IN: ['India', 'IND', '356', 'Asia-Pacific', 0], ID: ['Indonesia', 'IDN', '360', 'Asia-Pacific', 0], MY: ['Malaysia', 'MYS', '458', 'Asia-Pacific', 0],
  TH: ['Thailand', 'THA', '764', 'Asia-Pacific', 0], PH: ['Philippines', 'PHL', '608', 'Asia-Pacific', 0], AU: ['Australia', 'AUS', '036', 'Asia-Pacific', 1], NZ: ['New Zealand', 'NZL', '554', 'Asia-Pacific', 1],
  // commercial property only (no BIS residential series)
  AE: ['United Arab Emirates', 'ARE', '784', 'Middle East & Africa', 1], SA: ['Saudi Arabia', 'SAU', '682', 'Middle East & Africa', 0], AR: ['Argentina', 'ARG', '032', 'Americas', 0],
}
const AGG = { XW: 'World (BIS aggregate)', '5R': 'Advanced economies', '4T': 'Emerging economies', XM: 'Euro area' }
const ISO3 = Object.fromEntries(Object.entries(C).map(([k, v]) => [v[1], k]))

const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 1) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const pct = (a, b) => (fin(a) && fin(b) && b !== 0 ? (a / b - 1) * 100 : null)
const mean = xs => { const v = xs.filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const qOrd = k => +k.slice(0, 4) * 4 + (+k.slice(6) - 1)
const qKey = o => `${Math.floor(o / 4)}-Q${(o % 4) + 1}`
const scrub = s => String(s?.message || s || '').slice(0, 240)
// compact quarterly series { s: first quarter, v: [values, null for gaps] }
function enc(pts, d = 1) {
  if (!pts?.length) return null
  const m = new Map(pts), v = []
  for (let o = qOrd(pts[0][0]), end = qOrd(pts.at(-1)[0]); o <= end; o++) v.push(m.has(qKey(o)) ? rnd(m.get(qKey(o)), d) : null)
  return { s: pts[0][0], v }
}
const dec = e => (e?.s ? e.v.map((v, i) => [qKey(qOrd(e.s) + i), v]).filter(p => fin(p[1])) : [])
const at = (pts, k) => pts.find(p => p[0] === k)?.[1]
const back = (pts, n) => { const l = pts.at(-1); return l ? at(pts, qKey(qOrd(l[0]) - n)) : null }

// SDMX CSV (BIS and OECD): split plain lines; the columns used never hold commas
function sdmx(text, area, extra = []) {
  const lines = text.trim().split(/\r?\n/), h = lines[0].split(',')
  const iA = h.indexOf(area), iT = h.indexOf('TIME_PERIOD'), iV = h.indexOf('OBS_VALUE'), iX = extra.map(x => h.indexOf(x))
  if ([iA, iT, iV, ...iX].includes(-1)) throw new Error(`columns changed (${h.slice(0, 8).join(',')})`)
  const out = {}
  for (const l of lines.slice(1)) {
    const c = l.split(','), v = parseFloat(c[iV]), t = c[iT]
    if (!c[iA] || !fin(v) || !/^\d{4}-Q[1-4]$/.test(t)) continue
    const k = [c[iA], ...iX.map(i => c[i])].join('|');
    (out[k] ||= []).push([t, v])
  }
  for (const k in out) out[k].sort((a, b) => a[0].localeCompare(b[0]))
  return out
}

export function createGlobalHousing({ UA, dir }) {
  const CACHE = 'global-housing.json', file = path.join(dir, CACHE)
  const load = () => { try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { console.warn(`${CACHE}: ${e.message}`) } return null }
  const save = o => { try { fs.writeFileSync(file, JSON.stringify(o)) } catch (e) { console.error(`${CACHE} save:`, e.message) } }
  let mem = null, raw = null, nextAt = 0, inflight = null

  // OECD's SDMX service answers bursts with an occasional HTTP 500 that clears on retry: back off 5, 10, 20 s
  async function text(url, label, tries = 4) {
    for (let a = 0; ; a++) {
      let r
      try { r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/csv, */*' }, signal: AbortSignal.timeout(90_000) }); if (r.ok) return await r.text() }
      catch (e) { if (a < tries - 1) { await new Promise(res => setTimeout(res, 5000 * 2 ** a)); continue } throw new Error(`${label}: ${scrub(e.cause?.code || e.message)}`) }
      if ((r.status >= 500 || r.status === 429) && a < tries - 1) { await new Promise(res => setTimeout(res, 5000 * 2 ** a)); continue }
      throw new Error(`${label}: HTTP ${r.status}`)
    }
  }

  // raw blocks: { asOf, series: { key: [[q, v], …] } } — full history, unrounded
  const fetchers = {
    spp: async () => ({ asOf: new Date().toISOString(), series: sdmx(await text(URLS.spp, 'BIS WS_SPP'), 'REF_AREA', ['VALUE']) }),
    oecd: async () => ({ asOf: new Date().toISOString(), series: sdmx(await text(URLS.oecd, 'OECD house prices'), 'REF_AREA', ['MEASURE']) }),
    tc: async () => ({ asOf: new Date().toISOString(), series: sdmx(await text(URLS.tc, 'BIS WS_TC'), 'BORROWERS_CTY') }),
    dsr: async () => ({ asOf: new Date().toISOString(), series: sdmx(await text(URLS.dsr, 'BIS WS_DSR'), 'BORROWERS_CTY') }),
    cpp: async () => ({ asOf: new Date().toISOString(), series: sdmx(await text(URLS.cpp, 'BIS WS_CPP'), 'REF_AREA', ['COVERED_AREA', 'RE_TYPE', 'RE_VINTAGE', 'COMPILING_ORG', 'PRICED_UNIT']) }),
  }

  // one economy's commercial block: headline (nominal + CPI-deflated), its parts, 2019 = 100 series
  function commercialOf(R, iso2, latestQ) {
    const all = R.cpp?.series || {}, mine = Object.keys(all).filter(k => k.startsWith(`${iso2}|`))
    if (!mine.length) return null
    const pick = CPP[iso2] || (() => { // an economy BIS adds later: whole country first, broadest type first
      const rank = k => { const [, cov, t] = k.split('|'); return (cov === '0' ? 0 : 10) + 'ADBCGOM'.indexOf(t) }
      const h = [...mine].sort((a, b) => rank(a) - rank(b))[0]
      return { h, label: CPP_TYPE[h.split('|')[2]] || 'Commercial property', kind: h.split('|')[1] === '0' ? null : 'city' }
    })()
    const nom = (all[pick.h] || []).filter(p => fin(p[1]))
    if (nom.length < 5) return null
    // CPI implied by BIS residential nominal ÷ real (both 2010 = 100)
    const rm = new Map(R.spp?.series?.[`${iso2}|R`] || []), cpi = new Map((R.spp?.series?.[`${iso2}|N`] || []).filter(([q]) => fin(rm.get(q)) && rm.get(q)).map(([q, v]) => [q, v / rm.get(q)]))
    const real = nom.filter(([q]) => fin(cpi.get(q))).map(([q, v]) => [q, v / cpi.get(q)])
    const rebase = pts => { const b = mean(pts.filter(p => p[0].startsWith(CPP_BASE)).map(p => p[1])) || pts[0]?.[1]; return b ? pts.map(([q, v]) => [q, (v / b) * 100]) : [] }
    const stats = pts => { if (pts.length < 5) return null; const l = pts.at(-1), pk = pts.reduce((m, p) => (p[1] > m[1] ? p : m)); return { chg1y: rnd(pct(l[1], back(pts, 4))), chg5y: rnd(pct(l[1], back(pts, 20))), since2019: rnd(pct(l[1], mean(pts.filter(p => p[0].startsWith(CPP_BASE)).map(p => p[1])))), fromPeak: rnd(pct(l[1], pk[1])), peak: pk[0] } }
    const asOf = nom.at(-1)[0], lag = latestQ ? qOrd(latestQ) - qOrd(asOf) : 0
    return {
      label: pick.label, kind: pick.kind || null, key: pick.h, asOf, stale: lag > 4, first: nom[0][0],
      nominal: stats(nom), // real may end a quarter or two before nominal (CPI lags): it carries its own as-of
      real: real.length >= 5 && qOrd(asOf) - qOrd(real.at(-1)[0]) <= 2 ? { ...stats(real), asOf: real.at(-1)[0] } : null,
      parts: Object.entries(pick.parts || {}).map(([k, label]) => { const p = (all[k] || []).filter(x => fin(x[1])); return p.length >= 5 ? { label, asOf: p.at(-1)[0], chg1y: rnd(pct(p.at(-1)[1], back(p, 4))), since2019: rnd(pct(p.at(-1)[1], mean(p.filter(x => x[0].startsWith(CPP_BASE)).map(x => x[1])))) } : null }).filter(Boolean),
      series: enc(rebase(nom).filter(p => p[0] >= OUT)), realSeries: real.length >= 5 ? enc(rebase(real).filter(p => p[0] >= OUT)) : null,
    }
  }

  function derive(R, meta) {
    const S = (blk, k) => R[blk]?.series?.[k] || []
    const realStats = pts => {
      if (!pts.length) return null
      const l = pts.at(-1), pk = pts.reduce((m, p) => (p[1] > m[1] ? p : m))
      const y1 = back(pts, 4), y5 = back(pts, 20), pre = at(pts, '2019-Q4')
      return { asOf: l[0], chg1y: rnd(pct(l[1], y1)), chg5y: rnd(pct(l[1], y5)), since2019: rnd(pct(l[1], pre)), fromPeak: rnd(pct(l[1], pk[1])), peak: pk[0] }
    }
    const ratio = pts => { const l = pts.at(-1); return l ? { v: rnd(l[1] - 100), asOf: l[0] } : null } // % above (+) / below (−) the long-run average
    const sppLatest = Object.keys(C).map(k => S('spp', `${k}|R`).at(-1)?.[0]).filter(Boolean).sort().at(-1) || null
    const countries = Object.entries(C).map(([iso2, [name, iso3, num, region, adv]]) => {
      const real = S('spp', `${iso2}|R`), nom = S('spp', `${iso2}|N`), commercial = commercialOf(R, iso2, sppLatest)
      if (!real.length && !nom.length && !commercial) return null
      const pti = S('oecd', `${iso3}|HPI_YDH_AVG`), ptr = S('oecd', `${iso3}|HPI_RPI_AVG`), rent = S('oecd', `${iso3}|RPI`)
      const tc = S('tc', iso2), dsr = S('dsr', iso2)
      const P = ratio(pti), Rr = ratio(ptr), parts = [P?.v, Rr?.v].filter(fin)
      const dsrAvg = mean(dsr.map(p => p[1]))
      return {
        iso2, iso3, num, name, region, advanced: !!adv,
        real: realStats(real), nominal1y: rnd(pct(nom.at(-1)?.[1], back(nom, 4))),
        rent1y: rent.length ? rnd(pct(rent.at(-1)[1], back(rent, 4))) : null, rentAsOf: rent.at(-1)?.[0] || null,
        pti: P, ptr: Rr, valuation: parts.length ? rnd(mean(parts)) : null,
        valuationAsOf: [P?.asOf, Rr?.asOf].filter(Boolean).sort()[0] || null,
        hhDebt: tc.length ? { v: rnd(tc.at(-1)[1]), asOf: tc.at(-1)[0], chg5y: rnd(tc.at(-1)[1] - back(tc, 20)), peak: rnd(Math.max(...tc.map(p => p[1]))) } : null,
        dsr: dsr.length ? { v: rnd(dsr.at(-1)[1]), asOf: dsr.at(-1)[0], avg: rnd(dsrAvg), gap: rnd(dsr.at(-1)[1] - dsrAvg) } : null,
        commercial,
        series: {
          real: enc(real.filter(p => p[0] >= OUT)), pti: enc(pti.filter(p => p[0] >= OUT)), ptr: enc(ptr.filter(p => p[0] >= OUT)),
          hhDebt: enc(tc.filter(p => p[0] >= OUT)), dsr: enc(dsr.filter(p => p[0] >= OUT)),
        },
      }
    }).filter(Boolean)
    const aggregates = Object.entries(AGG).map(([id, name]) => {
      const real = S('spp', `${id}|R`)
      return real.length ? { id, name, real: realStats(real), commercial: commercialOf(R, id, sppLatest), nominal1y: rnd(pct(S('spp', `${id}|N`).at(-1)?.[1], back(S('spp', `${id}|N`), 4))), series: enc(real.filter(p => p[0] >= OUT)) } : null
    }).filter(Boolean)
    const live = countries.filter(c => c.real && fin(c.real.chg1y)), resi = countries.filter(c => c.real)
    const latestQ = live.map(c => c.real.asOf).sort().at(-1) || null
    const current = live.filter(c => latestQ && qOrd(latestQ) - qOrd(c.real.asOf) <= 2) // reported within two quarters of the latest
    const summary = {
      latestQ, countries: resi.length, current: current.length,
      fallingReal: current.filter(c => c.real.chg1y < 0).length,
      medianReal1y: rnd([...current.map(c => c.real.chg1y)].sort((a, b) => a - b)[Math.floor(current.length / 2)]),
      deepFromPeak: current.filter(c => c.real.fromPeak <= -20).length,
      overvalued: countries.filter(c => fin(c.valuation) && c.valuation >= 20).length,
      withValuation: countries.filter(c => fin(c.valuation)).length,
    }
    const cm = countries.filter(c => c.commercial?.nominal && !c.commercial.stale), med = xs => { const v = xs.filter(fin).sort((a, b) => a - b); return v.length ? rnd(v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null }
    summary.commercial = {
      economies: countries.filter(c => c.commercial).length, current: cm.length, latestQ: cm.map(c => c.commercial.asOf).sort().at(-1) || null,
      fallingNominal: cm.filter(c => c.commercial.nominal.chg1y < 0).length, fallingReal: cm.filter(c => fin(c.commercial.real?.chg1y) && c.commercial.real.chg1y < 0).length, withReal: cm.filter(c => fin(c.commercial.real?.chg1y)).length,
      medianNominal1y: med(cm.map(c => c.commercial.nominal.chg1y)), medianReal1y: med(cm.map(c => c.commercial.real?.chg1y)),
      belowPre: cm.filter(c => fin(c.commercial.real?.since2019) && c.commercial.real.since2019 < 0).length,
    }
    return {
      built: new Date().toISOString(), stale: !!meta.stale, sourceErrors: meta.sourceErrors || [], sources: meta.sources || [],
      summary, aggregates, countries,
      note: 'Real prices are BIS residential property prices deflated by each country\'s CPI (2010 = 100); coverage differs by country (whole country vs cities, new vs existing homes, BIS documents each series). ' +
        'Valuation is the OECD price-to-income and price-to-rent ratios against their own long-run averages (+20 = 20% above), averaged where both exist; it compares a country with its own history, not with other countries, and some OECD ratios lag a year or more. ' +
        'Household debt is BIS credit to households and non-profits, % of GDP; the debt service ratio is interest and principal as a share of household income, against the country\'s own average since 1999. ' +
        'Commercial property is BIS\x27s collection: about 20 economies, each with its own coverage (all commercial property, offices and retail, land, or one city — named on each row), rebased to 2019 = 100 and deflated by the CPI implied by BIS\x27s residential series; there is no free commercial index for the UK, Canada, Australia, China, Hong Kong or Korea. ' +
        'China and the United States appear for comparison; their detail lives in International → China and the Real Estate tab\'s residential views.',
    }
  }

  async function build() {
    const prev = raw || load()?.raw || null, R = {}, errs = [], sources = []
    const names = Object.keys(fetchers), res = await Promise.allSettled(names.map(n => fetchers[n]()))
    res.forEach((r, i) => {
      const n = names[i]
      if (r.status === 'fulfilled' && Object.keys(r.value.series).length) { R[n] = r.value; sources.push({ id: n, label: LABEL[n], url: PAGE[n], fetched: r.value.asOf, from: 'live' }); return }
      const msg = r.status === 'rejected' ? scrub(r.reason) : 'no series returned'
      if (prev?.[n]) R[n] = prev[n]
      errs.push(`${LABEL[n]}: ${msg}${prev?.[n] ? ` — serving the copy fetched ${String(prev[n].asOf).slice(0, 10)}` : ' — no fallback'}`)
      sources.push({ id: n, label: LABEL[n], url: PAGE[n], fetched: prev?.[n]?.asOf || null, from: prev?.[n] ? 'cache' : 'none' })
    })
    if (!R.spp) throw new Error(`BIS property prices unavailable (${errs.join('; ').slice(0, 300)})`)
    const payload = derive(R, { stale: errs.length > 0, sourceErrors: errs, sources })
    console.log(`Global housing: ${payload.countries.length} countries, latest ${payload.summary.latestQ}${errs.length ? `, ${errs.length} source error(s)` : ''}`)
    return { payload, raw: R, failed: errs.length > 0, empty: names.some(n => !R[n]) }
  }

  function refresh() {
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const { payload, raw: R, failed, empty } = await build()
        mem = payload; raw = R; nextAt = Date.now() + (empty ? RETRY_EMPTY : failed ? RETRY : TTL)
        save({ version: 1, nextAt, payload, raw: R })
        return payload
      } catch (e) {
        console.warn('Global housing:', scrub(e)); nextAt = Date.now() + RETRY
        if (mem) return { ...mem, stale: true }
        throw e
      } finally { inflight = null }
    })()
    return inflight
  }

  async function get() {
    if (!mem) {
      const disk = load()
      if (disk?.version === 1 && disk.payload?.built) {
        // re-derive from the cached raw blocks so a code change shows without refetching
        const p = disk.payload
        try { mem = disk.raw ? { ...derive(disk.raw, { stale: p.stale, sourceErrors: p.sourceErrors, sources: p.sources }), built: p.built } : p } catch (e) { console.warn('Global housing re-derive:', e.message); mem = p }
        raw = disk.raw || null; nextAt = disk.nextAt || Date.parse(p.built) + TTL
        if (raw && Object.keys(fetchers).some(n => !raw[n])) nextAt = Math.min(nextAt, Date.parse(p.built) + RETRY_EMPTY) // a source added or never fetched
      }
    }
    if (mem && Date.now() < nextAt) return mem
    if (mem) { refresh().catch(() => {}); return { ...mem, stale: true } }
    return refresh()
  }

  return { get }
}
