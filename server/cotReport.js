// ============================================================================
// COMMITMENTS OF TRADERS — Commodities → CFTC Positioning. Who holds what in
// 34 futures markets, by the kind of trader, read the way traders read it.
//
//   disagg  publicreporting.cftc.gov/resource/kh3c-gbw2 (Disaggregated,
//           futures + options combined; keyless Socrata): commodities, split
//           into managed money (hedge funds, CTAs), producer/merchant/
//           processor/user (the hedgers), swap dealers, other reportables and
//           non-reportable small traders. Note the field swap__positions_short_all
//           (double underscore) is CFTC's own spelling.
//   tff     publicreporting.cftc.gov/resource/yw9f-hn96 (Traders in Financial
//           Futures, combined): equity indexes, Treasuries, currencies,
//           bitcoin, VIX — leveraged funds, asset managers, dealers, other,
//           small traders.
//   prices  Yahoo weekly closes (fetchYahooSparkline), 10 years, one symbol per
//           contract (VIX uses the spot index, which futures track loosely).
//
// Positions are as of Tuesday and published the following Friday at 3:30 pm
// ET. Derived per contract: each group's net (long − short) and share of open
// interest; the COT index (where the net position sits in its own trailing
// 156-week range, 0 = most short, 100 = most long) and z-score; 1- and 4-week
// changes; the classic price/open-interest read; top-4 trader concentration;
// and a backtest of forward 4- and 13-week price moves after the speculators'
// COT index was ≥ 90 or ≤ 10, measured from the Friday close of the report
// week (the first price a reader could act on). Cadence: 12 hours (the data
// changes weekly). Cache: cot-report.json at the root (gitignored).
// Requests per refresh: 2 CFTC + 34 Yahoo.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, DAY = 24 * H, TTL = 12 * H, RETRY = H
const SODA = 'https://publicreporting.cftc.gov/resource'
const WIN = 156, OUT_WEEKS = 208, YEARS = 10 // charts carry four years; statistics use all ten

// code, label, asset class, report, Yahoo symbol, what one contract is
export const CONTRACTS = [
  ['067651', 'WTI crude', 'Energy', 'disagg', 'CL=F', '1,000 barrels'], ['06765T', 'Brent crude (NYMEX)', 'Energy', 'disagg', 'BZ=F', '1,000 barrels'],
  ['023651', 'Natural gas', 'Energy', 'disagg', 'NG=F', '10,000 MMBtu'], ['111659', 'Gasoline (RBOB)', 'Energy', 'disagg', 'RB=F', '42,000 gallons'],
  ['022651', 'Diesel (ULSD)', 'Energy', 'disagg', 'HO=F', '42,000 gallons'],
  ['088691', 'Gold', 'Metals', 'disagg', 'GC=F', '100 troy oz'], ['084691', 'Silver', 'Metals', 'disagg', 'SI=F', '5,000 troy oz'],
  ['085692', 'Copper', 'Metals', 'disagg', 'HG=F', '25,000 lb'], ['076651', 'Platinum', 'Metals', 'disagg', 'PL=F', '50 troy oz'], ['075651', 'Palladium', 'Metals', 'disagg', 'PA=F', '100 troy oz'],
  ['002602', 'Corn', 'Agriculture', 'disagg', 'ZC=F', '5,000 bushels'], ['001602', 'Wheat (SRW)', 'Agriculture', 'disagg', 'ZW=F', '5,000 bushels'],
  ['005602', 'Soybeans', 'Agriculture', 'disagg', 'ZS=F', '5,000 bushels'], ['083731', 'Coffee', 'Agriculture', 'disagg', 'KC=F', '37,500 lb'],
  ['080732', 'Sugar', 'Agriculture', 'disagg', 'SB=F', '112,000 lb'], ['073732', 'Cocoa', 'Agriculture', 'disagg', 'CC=F', '10 tonnes'],
  ['033661', 'Cotton', 'Agriculture', 'disagg', 'CT=F', '50,000 lb'], ['057642', 'Live cattle', 'Agriculture', 'disagg', 'LE=F', '40,000 lb'], ['054642', 'Lean hogs', 'Agriculture', 'disagg', 'HE=F', '40,000 lb'],
  ['13874A', 'S&P 500 (E-mini)', 'Equities', 'tff', 'ES=F', '$50 × index'], ['209742', 'Nasdaq-100 (E-mini)', 'Equities', 'tff', 'NQ=F', '$20 × index'],
  ['239742', 'Russell 2000 (E-mini)', 'Equities', 'tff', 'RTY=F', '$50 × index'], ['1170E1', 'VIX futures', 'Equities', 'tff', '^VIX', '$1,000 × VIX'],
  ['042601', '2-year Treasury', 'Rates', 'tff', 'ZT=F', '$200,000 face'], ['043602', '10-year Treasury', 'Rates', 'tff', 'ZN=F', '$100,000 face'],
  ['020601', 'Treasury bond', 'Rates', 'tff', 'ZB=F', '$100,000 face'], ['020604', 'Ultra Treasury bond', 'Rates', 'tff', 'UB=F', '$100,000 face'],
  ['098662', 'U.S. dollar index', 'Currencies', 'tff', 'DX-Y.NYB', '$1,000 × index'], ['099741', 'Euro', 'Currencies', 'tff', '6E=F', '€125,000'],
  ['097741', 'Japanese yen', 'Currencies', 'tff', '6J=F', '¥12.5 million'], ['096742', 'British pound', 'Currencies', 'tff', '6B=F', '£62,500'],
  ['090741', 'Canadian dollar', 'Currencies', 'tff', '6C=F', 'C$100,000'], ['232741', 'Australian dollar', 'Currencies', 'tff', '6A=F', 'A$100,000'],
  ['095741', 'Mexican peso', 'Currencies', 'tff', '6M=F', 'MX$500,000'], ['133741', 'Bitcoin (CME)', 'Crypto', 'tff', 'BTC=F', '5 bitcoin'],
]
// trader groups, under common keys: spec (the speculators), core (hedgers / asset managers), dealer, other, small
export const GROUPS = {
  disagg: {
    spec: ['Managed money', 'm_money_positions_long_all', 'm_money_positions_short_all'],
    core: ['Producers & users', 'prod_merc_positions_long', 'prod_merc_positions_short'],
    dealer: ['Swap dealers', 'swap_positions_long_all', 'swap__positions_short_all'],
    other: ['Other large traders', 'other_rept_positions_long', 'other_rept_positions_short'],
    small: ['Small traders', 'nonrept_positions_long_all', 'nonrept_positions_short_all'],
  },
  tff: {
    spec: ['Leveraged funds', 'lev_money_positions_long', 'lev_money_positions_short'],
    core: ['Asset managers', 'asset_mgr_positions_long', 'asset_mgr_positions_short'],
    dealer: ['Dealers', 'dealer_positions_long_all', 'dealer_positions_short_all'],
    other: ['Other large traders', 'other_rept_positions_long', 'other_rept_positions_short'],
    small: ['Small traders', 'nonrept_positions_long_all', 'nonrept_positions_short_all'],
  },
}
const DATASET = { disagg: 'kh3c-gbw2', tff: 'yw9f-hn96' }

const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 1) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const mean = xs => { const v = xs.filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const sd = xs => { const v = xs.filter(fin), m = mean(v); return v.length > 2 ? Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) : null }
const pct = (a, b) => (fin(a) && fin(b) && b !== 0 ? (a / b - 1) * 100 : null)
const scrub = s => String(s?.message || s || '').slice(0, 200)

// where x sits in the trailing window (inclusive): 0 = window low, 100 = window high
function cotIndex(xs, i, win = WIN) {
  if (i < win - 1) return null
  let lo = Infinity, hi = -Infinity
  for (let j = i - win + 1; j <= i; j++) { if (xs[j] < lo) lo = xs[j]; if (xs[j] > hi) hi = xs[j] }
  return hi > lo ? ((xs[i] - lo) / (hi - lo)) * 100 : 50
}
function zScore(xs, i, win = WIN) { if (i < win - 1) return null; const w = xs.slice(i - win + 1, i + 1), s = sd(w); return s ? (xs[i] - mean(w)) / s : null }

// the textbook price / open-interest quadrant over four weeks
function quadrant(dp, doi) {
  if (!fin(dp) || !fin(doi)) return null
  if (Math.abs(dp) < 1 && Math.abs(doi) < 2) return { id: 'quiet', label: 'Quiet', why: 'Price and open interest both little changed.' }
  if (dp >= 0 && doi >= 0) return { id: 'newLongs', label: 'New buying', why: 'Price up with open interest up: fresh money is coming in on the long side — the strongest form of an uptrend.' }
  if (dp >= 0 && doi < 0) return { id: 'shortCover', label: 'Short covering', why: 'Price up while open interest falls: shorts are buying back to close, which can fade once they are done.' }
  if (dp < 0 && doi >= 0) return { id: 'newShorts', label: 'New selling', why: 'Price down with open interest up: fresh shorts are pressing — the strongest form of a downtrend.' }
  return { id: 'liquidation', label: 'Long liquidation', why: 'Price down while open interest falls: longs are giving up and closing out rather than new sellers arriving.' }
}

export function createCotReport({ UA, dir, fetchYahooSparkline }) {
  const CACHE = 'cot-report.json', file = path.join(dir, CACHE)
  const load = () => { try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { console.warn(`${CACHE}: ${e.message}`) } return null }
  const save = o => { try { fs.writeFileSync(file, JSON.stringify(o)) } catch (e) { console.error(`${CACHE} save:`, e.message) } }
  let mem = null, raw = null, nextAt = 0, inflight = null

  async function soda(report) {
    const since = new Date(Date.now() - YEARS * 365.25 * DAY).toISOString().slice(0, 10)
    const codes = CONTRACTS.filter(c => c[3] === report).map(c => `'${c[0]}'`).join(',')
    const fields = ['report_date_as_yyyy_mm_dd', 'cftc_contract_market_code', 'open_interest_all', 'conc_net_le_4_tdr_long_all', 'conc_net_le_4_tdr_short_all',
      ...Object.values(GROUPS[report]).flatMap(g => [g[1], g[2]])]
    const q = new URLSearchParams({ $select: fields.join(','), $where: `cftc_contract_market_code in(${codes}) AND report_date_as_yyyy_mm_dd > '${since}'`, $order: 'report_date_as_yyyy_mm_dd ASC', $limit: '50000' })
    for (let a = 0; ; a++) {
      try {
        const r = await fetch(`${SODA}/${DATASET[report]}.json?${q}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(90_000) })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const rows = await r.json()
        if (!Array.isArray(rows) || !rows.length) throw new Error('no rows')
        return { asOf: new Date().toISOString(), rows }
      } catch (e) { if (a < 2) { await new Promise(res => setTimeout(res, 4000 * (a + 1))); continue } throw new Error(`CFTC ${report}: ${scrub(e)}`) }
    }
  }
  async function prices(prev) {
    const out = {}, errs = []
    for (let i = 0; i < CONTRACTS.length; i += 6) {
      await Promise.all(CONTRACTS.slice(i, i + 6).map(async c => {
        const pts = await fetchYahooSparkline(c[4], `${YEARS}y`, '1wk').catch(() => [])
        if (pts?.length > 50) out[c[0]] = pts.map(p => [new Date(p.ts).toISOString().slice(0, 10), +p.v.toPrecision(6)])
        else if (prev?.[c[0]]) { out[c[0]] = prev[c[0]]; errs.push(c[4]) } else errs.push(c[4])
      }))
    }
    if (!Object.keys(out).length) throw new Error('Yahoo: no prices')
    return { asOf: new Date().toISOString(), series: out, missing: errs }
  }

  function derive(R, meta) {
    const contracts = [], pooled = { long: [], short: [], all: [] }, weekSet = new Set()
    for (const [code, label, asset, report, symbol, unit] of CONTRACTS) {
      const rows = (R[report]?.rows || []).filter(r => r.cftc_contract_market_code === code)
      if (rows.length < 20) continue
      const G = GROUPS[report], dates = rows.map(r => r.report_date_as_yyyy_mm_dd.slice(0, 10)), n = rows.length
      const num = (r, k) => +r[k] || 0
      const oi = rows.map(r => num(r, 'open_interest_all'))
      const net = Object.fromEntries(Object.entries(G).map(([k, g]) => [k, rows.map(r => num(r, g[1]) - num(r, g[2]))]))
      const longs = Object.fromEntries(Object.entries(G).map(([k, g]) => [k, rows.map(r => num(r, g[1]))]))
      const shorts = Object.fromEntries(Object.entries(G).map(([k, g]) => [k, rows.map(r => num(r, g[2]))]))
      const idx = Object.fromEntries(Object.keys(G).map(k => [k, net[k].map((_, i) => cotIndex(net[k], i))]))
      // price at the Friday close of each report week (the weekly bar that contains the Tuesday)
      const px = R.prices?.series?.[code] || [], pxAt = d => { let best = null; for (const [pd, v] of px) { if (pd <= d) best = v; else break } return best }
      const weekClose = d => { const t = Date.parse(`${d}T00:00:00Z`); let best = null; for (const [pd, v] of px) { const pt = Date.parse(`${pd}T00:00:00Z`); if (pt <= t + 3 * DAY && pt > t - 7 * DAY) best = v; if (pt > t + 3 * DAY) break } return best ?? pxAt(d) }
      const price = dates.map(weekClose)
      const i = n - 1, b4 = Math.max(0, i - 4), b1 = Math.max(0, i - 1)
      const groups = Object.fromEntries(Object.entries(G).map(([k, g]) => [k, {
        label: g[0], long: longs[k][i], short: shorts[k][i], net: net[k][i], pctOi: rnd(oi[i] ? (net[k][i] / oi[i]) * 100 : null),
        chg1w: net[k][i] - net[k][b1], chg4w: net[k][i] - net[k][b4], cotIndex: rnd(idx[k][i], 0), z: rnd(zScore(net[k], i), 2),
        min3y: Math.min(...net[k].slice(Math.max(0, n - WIN))), max3y: Math.max(...net[k].slice(Math.max(0, n - WIN))),
      }]))
      const spec = groups.spec, si = spec.cotIndex
      const extreme = !fin(si) ? null : si >= 90 ? 'crowdedLong' : si <= 10 ? 'crowdedShort' : si >= 75 ? 'leanLong' : si <= 25 ? 'leanShort' : 'neutral'
      const dp4 = pct(price[i], price[b4]), doi4 = pct(oi[i], oi[b4])
      // backtest: forward moves after the speculators' COT index was extreme (overlapping windows; signal at the report-week close)
      const fwd = (j, h) => (j + h < n && fin(price[j]) && fin(price[j + h]) ? pct(price[j + h], price[j]) : null)
      const bt = { long: [], short: [], all: [] }
      for (let j = 0; j < n; j++) {
        const s = idx.spec[j]; if (!fin(s)) continue
        const f4 = fwd(j, 4), f13 = fwd(j, 13); if (!fin(f4)) continue
        const rec = { f4, f13 }
        bt.all.push(rec); if (s >= 90) bt.long.push(rec); else if (s <= 10) bt.short.push(rec)
      }
      const sum = a => ({ n: a.length, fwd4: rnd(mean(a.map(x => x.f4)), 2), fwd13: rnd(mean(a.map(x => x.f13)), 2), up4: a.length ? rnd((a.filter(x => x.f4 > 0).length / a.length) * 100, 0) : null })
      for (const k of ['long', 'short', 'all']) pooled[k].push(...bt[k].map(x => ({ ...x, asset })))
      const out = Math.max(0, n - OUT_WEEKS)
      for (const d of dates.slice(out)) weekSet.add(d)
      contracts.push({
        code, label, asset, report, symbol, unit, firstReport: dates[0],
        latest: { date: dates[i], oi: oi[i], oiChg4w: rnd(doi4), price: rnd(price[i], 4), priceChg1w: rnd(pct(price[i], price[b1])), priceChg4w: rnd(dp4), quadrant: quadrant(dp4, doi4),
          top4Long: rnd(+rows[i].conc_net_le_4_tdr_long_all, 1), top4Short: rnd(+rows[i].conc_net_le_4_tdr_short_all, 1) },
        groups, extreme,
        backtest: { long: sum(bt.long), short: sum(bt.short), all: sum(bt.all) },
        // aligned to the shared weeks list (from = this contract's first chart week); "other" stays in groups only
        series: { from: dates[out], oi: oi.slice(out), price: price.slice(out).map(v => (fin(v) ? +v.toPrecision(5) : null)), specIdx: idx.spec.slice(out).map(v => rnd(v, 0)), coreIdx: idx.core.slice(out).map(v => rnd(v, 0)),
          ...Object.fromEntries(["spec", "core", "dealer", "small"].map(k => [k, net[k].slice(out)])) },
      })
    }
    const sumP = a => ({ n: a.length, fwd4: rnd(mean(a.map(x => x.f4)), 2), fwd13: rnd(mean(a.map(x => x.f13)), 2), up4: a.length ? rnd((a.filter(x => x.f4 > 0).length / a.length) * 100, 0) : null })
    const assets = [...new Set(CONTRACTS.map(c => c[2]))]
    const byAsset = Object.fromEntries(assets.map(a => [a, { long: sumP(pooled.long.filter(x => x.asset === a)), short: sumP(pooled.short.filter(x => x.asset === a)), all: sumP(pooled.all.filter(x => x.asset === a)) }]))
    const asOf = contracts.map(c => c.latest.date).sort().at(-1) || null
    // the report for Tuesday d is released on Friday d + 3
    const released = asOf ? new Date(Date.parse(`${asOf}T00:00:00Z`) + 3 * DAY).toISOString().slice(0, 10) : null
    return {
      built: new Date().toISOString(), stale: !!meta.stale, sourceErrors: meta.sourceErrors || [], sources: meta.sources || [],
      asOf, released, window: WIN, weeks: [...weekSet].sort(), contracts, groups: Object.fromEntries(Object.entries(GROUPS).map(([r, g]) => [r, Object.fromEntries(Object.entries(g).map(([k, v]) => [k, v[0]]))])),
      backtest: { all: { long: sumP(pooled.long), short: sumP(pooled.short), all: sumP(pooled.all) }, byAsset, note: 'Forward price change after the speculators\' COT index (trailing 156 weeks) was ≥ 90 ("crowded long") or ≤ 10 ("crowded short"), measured from the Friday close of the report week. Weekly signals overlap, so the counts overstate independent evidence; prices are front-month continuous futures from Yahoo, which jump at contract rolls.' },
      missingPrices: R.prices?.missing || [],
    }
  }

  async function build() {
    const prev = raw || load()?.raw || null, R = {}, errs = [], sources = []
    const jobs = { disagg: () => soda('disagg'), tff: () => soda('tff'), prices: () => prices(prev?.prices?.series) }
    const label = { disagg: 'CFTC Disaggregated COT (futures + options)', tff: 'CFTC Traders in Financial Futures (futures + options)', prices: 'Yahoo weekly futures prices' }
    const url = { disagg: 'https://publicreporting.cftc.gov/d/kh3c-gbw2', tff: 'https://publicreporting.cftc.gov/d/yw9f-hn96', prices: 'https://finance.yahoo.com' }
    const res = await Promise.allSettled(Object.values(jobs).map(f => f()))
    Object.keys(jobs).forEach((k, i) => {
      const r = res[i]
      if (r.status === 'fulfilled') { R[k] = r.value; sources.push({ id: k, label: label[k], url: url[k], fetched: r.value.asOf, from: 'live' }); return }
      if (prev?.[k]) R[k] = prev[k]
      errs.push(`${label[k]}: ${scrub(r.reason)}${prev?.[k] ? ' — serving the cached copy' : ''}`)
      sources.push({ id: k, label: label[k], url: url[k], fetched: prev?.[k]?.asOf || null, from: prev?.[k] ? 'cache' : 'none' })
    })
    if (!R.disagg && !R.tff) throw new Error(errs.join('; '))
    return { payload: derive(R, { stale: errs.length > 0, sourceErrors: errs, sources }), raw: R, failed: errs.length > 0 }
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
        console.warn('COT report:', scrub(e)); nextAt = Date.now() + RETRY
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
        try { mem = disk.raw ? { ...derive(disk.raw, disk.payload), built: disk.payload.built } : disk.payload } catch { mem = disk.payload }
        raw = disk.raw || null; nextAt = disk.nextAt || Date.parse(disk.payload.built) + TTL
      }
    }
    if (mem && Date.now() < nextAt) return mem
    if (mem) { refresh().catch(() => {}); return { ...mem, stale: true } }
    return refresh()
  }

  return { get }
}
