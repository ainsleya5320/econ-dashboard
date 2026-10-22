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
//
// Every request is keyless and official. Cadence: the sources are quarterly,
// so a week; a build with a failed source retries after 6 hours. A failed
// source keeps its last good raw block from the cache (sourceErrors notes it);
// get() never throws once data exists. Cache: global-housing.json at the root
// (gitignored: payload + raw blocks). Requests per refresh: 4.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, DAY = 24 * H, TTL = 7 * DAY, RETRY = 6 * H
const BIS = 'https://stats.bis.org/api/v1/data'
const OECD = 'https://sdmx.oecd.org/public/rest/data/OECD.ECO.MPD,DSD_AN_HOUSE_PRICES@DF_HOUSE_PRICES,1.0'
const URLS = {
  spp: `${BIS}/WS_SPP/Q..N+R.628?format=csv&startPeriod=1970`,
  oecd: `${OECD}/.Q.HPI_YDH_AVG+HPI_RPI_AVG+RPI.?startPeriod=1990-Q1&format=csvfile`,
  tc: `${BIS}/WS_TC/Q..H.A.M.770.A?format=csv&startPeriod=1990`,
  dsr: `${BIS}/WS_DSR/Q..H?format=csv&startPeriod=1999`,
}
const PAGE = { spp: 'https://data.bis.org/topics/RPP', oecd: 'https://www.oecd.org/en/data/datasets/analytical-house-prices-indicators.html', tc: 'https://data.bis.org/topics/TOTAL_CREDIT', dsr: 'https://data.bis.org/topics/DSR' }
const LABEL = { spp: 'BIS residential property prices', oecd: 'OECD analytical house price indicators', tc: 'BIS credit to households', dsr: 'BIS household debt service ratios' }
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
    const countries = Object.entries(C).map(([iso2, [name, iso3, num, region, adv]]) => {
      const real = S('spp', `${iso2}|R`), nom = S('spp', `${iso2}|N`)
      if (!real.length && !nom.length) return null
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
        series: {
          real: enc(real.filter(p => p[0] >= OUT)), pti: enc(pti.filter(p => p[0] >= OUT)), ptr: enc(ptr.filter(p => p[0] >= OUT)),
          hhDebt: enc(tc.filter(p => p[0] >= OUT)), dsr: enc(dsr.filter(p => p[0] >= OUT)),
        },
      }
    }).filter(Boolean)
    const aggregates = Object.entries(AGG).map(([id, name]) => {
      const real = S('spp', `${id}|R`)
      return real.length ? { id, name, real: realStats(real), nominal1y: rnd(pct(S('spp', `${id}|N`).at(-1)?.[1], back(S('spp', `${id}|N`), 4))), series: enc(real.filter(p => p[0] >= OUT)) } : null
    }).filter(Boolean)
    const live = countries.filter(c => c.real && fin(c.real.chg1y))
    const latestQ = live.map(c => c.real.asOf).sort().at(-1) || null
    const current = live.filter(c => latestQ && qOrd(latestQ) - qOrd(c.real.asOf) <= 2) // reported within two quarters of the latest
    const summary = {
      latestQ, countries: countries.length, current: current.length,
      fallingReal: current.filter(c => c.real.chg1y < 0).length,
      medianReal1y: rnd([...current.map(c => c.real.chg1y)].sort((a, b) => a - b)[Math.floor(current.length / 2)]),
      deepFromPeak: current.filter(c => c.real.fromPeak <= -20).length,
      overvalued: countries.filter(c => fin(c.valuation) && c.valuation >= 20).length,
      withValuation: countries.filter(c => fin(c.valuation)).length,
    }
    return {
      built: new Date().toISOString(), stale: !!meta.stale, sourceErrors: meta.sourceErrors || [], sources: meta.sources || [],
      summary, aggregates, countries,
      note: 'Real prices are BIS residential property prices deflated by each country\'s CPI (2010 = 100); coverage differs by country (whole country vs cities, new vs existing homes, BIS documents each series). ' +
        'Valuation is the OECD price-to-income and price-to-rent ratios against their own long-run averages (+20 = 20% above), averaged where both exist; it compares a country with its own history, not with other countries, and some OECD ratios lag a year or more. ' +
        'Household debt is BIS credit to households and non-profits, % of GDP; the debt service ratio is interest and principal as a share of household income, against the country\'s own average since 1999. ' +
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
    return { payload, raw: R, failed: errs.length > 0 }
  }

  function refresh() {
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const { payload, raw: R, failed } = await build()
        mem = payload; raw = R; nextAt = Date.now() + (failed ? RETRY : TTL)
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
      }
    }
    if (mem && Date.now() < nextAt) return mem
    if (mem) { refresh().catch(() => {}); return { ...mem, stale: true } }
    return refresh()
  }

  return { get }
}
