// ============================================================================
// TREASURY TRADING VOLUME — Bonds → Treasuries, "Trading activity": how much of
// each part of the Treasury market changed hands each day, from FINRA TRACE.
//
//   source   FINRA Query API, fixedIncomeMarket/treasuryDailyAggregates (free
//            Public credential: FINRA_CLIENT_ID / FINRA_CLIENT_SECRET in .env,
//            OAuth client credentials at ews.fip.finra.org, a 12-hour token).
//            Daily since 2023-12-14, published the next business day. One row
//            per product (Bills, FRNs, Nominal Coupons, TIPS), and for coupons
//            and TIPS per on-the-run / off-the-run and maturity bucket. Volume
//            is $ billions par, split into dealer-to-customer trades and
//            interdealer trades on ATSs (the electronic venues), with counts.
//            FINRA refuses sorting unless every partition key is pinned, so
//            rows are pulled by date range and sorted here.
//
// Derived: total volume per product per day; coupon volume against its 20- and
// 250-day averages and its percentile over the past year; on-the-run share of
// coupon volume (falls when investors reach into older issues, as in stress or
// heavy rebalancing); customer share (dealer-to-customer over all), which rises
// when end investors, not dealers, drive the day; and each maturity bucket's
// volume against its own 20-day average.
//
// FINRA's corporate bond datasets (TRACE trades, market breadth) are not
// available to the Public credential, and finra.org's bond pages forbid
// automated copying in their Fixed Income Data User Agreement, so there is no
// corporate tape here. Cache finra-treasury.json at the root (gitignored):
// FINRA data is for personal use and is not committed or baked into the
// Netlify fork. Cadence: 12 hours, fetching only days after the last on file.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, DAY = 864e5, TTL = 12 * H, RETRY = H
const START = '2023-12-14', PAGE = 5000
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 1) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const scrub = e => String(e?.message || e || '').replace(/Basic [A-Za-z0-9+/=]+|Bearer [A-Za-z0-9._-]+/g, '…').slice(0, 200)
const iso = t => new Date(t).toISOString().slice(0, 10)
const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null)

// maturity buckets in FINRA's wording, shortest first
const BUCKETS = ['<= 2 years', '> 2 years and <= 3 years', '> 3 years and <= 5 years', '> 5 years and <= 7 years', '> 7 years and <= 10 years', '> 10 years and <= 20 years', '> 20 years']
const SHORT = { '<= 2 years': '0–2y', '> 2 years and <= 3 years': '2–3y', '> 3 years and <= 5 years': '3–5y', '> 5 years and <= 7 years': '5–7y', '> 7 years and <= 10 years': '7–10y', '> 10 years and <= 20 years': '10–20y', '> 20 years': '20y+', '<= 5 years': '0–5y', '> 5 years and <= 10 years': '5–10y', '> 10 years': '10y+' }

export function createTreasuryVolume({ dir, clientId, clientSecret }) {
  const CACHE = 'finra-treasury.json', file = path.join(dir, CACHE)
  const load = () => { try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { console.warn(`${CACHE}: ${e.message}`) } return null }
  const disk = load()
  const store = disk?.version === 1 ? disk : { version: 1, rows: [], at: 0, err: null }
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(store)) } catch (e) { console.error(`${CACHE} save:`, e.message) } }
  let token = null, tokenUntil = 0, inflight = null, mem = null, dirty = true

  async function auth() {
    if (token && Date.now() < tokenUntil) return token
    const r = await fetch('https://ews.fip.finra.org/fip/rest/ews/oauth2/access_token?grant_type=client_credentials', { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}` }, signal: AbortSignal.timeout(30_000) })
    if (!r.ok) throw new Error(`FINRA sign-in HTTP ${r.status} (check FINRA_CLIENT_ID / FINRA_CLIENT_SECRET)`)
    const j = await r.json()
    token = j.access_token; tokenUntil = Date.now() + (Number(j.expires_in) || 3600) * 1000 - 5 * 60e3
    return token
  }

  async function pull(startDate, endDate) {
    const out = []
    for (let offset = 0; ; offset += PAGE) {
      const r = await fetch('https://api.finra.org/data/group/fixedIncomeMarket/name/treasuryDailyAggregates', {
        method: 'POST', signal: AbortSignal.timeout(60_000),
        headers: { Authorization: `Bearer ${await auth()}`, Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({ limit: PAGE, offset, dateRangeFilters: [{ fieldName: 'tradeDate', startDate, endDate }] }),
      })
      if (!r.ok) throw new Error(`FINRA treasuryDailyAggregates HTTP ${r.status}`)
      const rows = await r.json()
      if (!Array.isArray(rows)) throw new Error('FINRA returned no rows')
      out.push(...rows)
      if (rows.length < PAGE) return out
    }
  }

  async function refresh() {
    if (inflight) return inflight
    inflight = (async () => {
      try {
        if (!clientId || !clientSecret) throw new Error('No FINRA_CLIENT_ID / FINRA_CLIENT_SECRET in .env')
        const last = store.rows.length ? store.rows.reduce((m, r) => (r.d > m ? r.d : m), START) : null
        const from = last ? iso(Date.parse(`${last}T00:00:00Z`) + DAY) : START, to = iso(Date.now())
        if (from <= to) {
          // a quarter at a time keeps each request small
          for (let a = Date.parse(`${from}T00:00:00Z`); a <= Date.parse(`${to}T00:00:00Z`); a += 92 * DAY) {
            const b = Math.min(a + 91 * DAY, Date.parse(`${to}T00:00:00Z`))
            const rows = await pull(iso(a), iso(b))
            store.rows.push(...rows.map(x => ({ d: x.tradeDate, p: x.productCategory, b: x.benchmark || null, m: x.yearsToMaturity || null, dc: x.dealerCustomerVolume, dcn: x.dealerCustomerCount, ats: x.atsInterdealerVolume, atsn: x.atsInterdealerCount })))
          }
        }
        store.at = Date.now(); store.err = null
      } catch (e) { store.err = scrub(e); store.at = Date.now() - TTL + RETRY; console.warn('FINRA Treasury volume:', store.err) }
      save(); dirty = true
    })().finally(() => { inflight = null })
    return inflight
  }

  function derive() {
    const days = [...new Set(store.rows.map(r => r.d))].sort()
    if (!days.length) return null
    const byDay = new Map(days.map(d => [d, []]))
    for (const r of store.rows) byDay.get(r.d).push(r)
    const vol = r => (r.dc || 0) + (r.ats || 0)
    const sum = (rows, f) => rows.filter(f).reduce((s, r) => s + vol(r), 0)
    const series = days.map(d => {
      const rows = byDay.get(d), coupons = rows.filter(r => r.p === 'Nominal Coupons')
      const all = rows.reduce((s, r) => s + vol(r), 0), dc = rows.reduce((s, r) => s + (r.dc || 0), 0)
      return {
        d, total: rnd(all), bills: rnd(sum(rows, r => r.p === 'Bills')), coupons: rnd(sum(coupons, () => true)), tips: rnd(sum(rows, r => r.p === 'TIPS')), frn: rnd(sum(rows, r => r.p === 'FRNs')),
        otrShare: rnd(sum(coupons, r => r.b === 'On-the-run') / Math.max(1e-9, sum(coupons, () => true)), 3), custShare: rnd(dc / Math.max(1e-9, all), 3),
        buckets: Object.fromEntries(BUCKETS.map(k => [k, sum(coupons, r => r.m === k)])),
      }
    })
    const last = series.at(-1), prior = series.slice(-21, -1), year = series.slice(-250)
    const avg = (rows, k) => mean(rows.map(x => x[k]).filter(fin))
    const pctile = (k, v) => (year.length > 20 ? rnd((year.filter(x => x[k] < v).length / year.length) * 100, 0) : null)
    const buckets = BUCKETS.map(k => {
      const a20 = mean(prior.map(x => x.buckets[k])), today = last.buckets[k]
      return { bucket: SHORT[k], today: rnd(today), avg20: rnd(a20), ratio: a20 > 0 ? rnd(today / a20, 2) : null }
    })
    return {
      built: new Date().toISOString(), asOf: last.d, days: days.length, from: days[0],
      latest: {
        total: last.total, coupons: last.coupons, bills: last.bills, tips: last.tips,
        couponsAvg20: rnd(avg(prior, 'coupons')), couponsAvg250: rnd(avg(year, 'coupons')), couponsPctile: pctile('coupons', last.coupons),
        otrShare: last.otrShare, otrShareAvg20: rnd(avg(prior, 'otrShare'), 3),
        custShare: last.custShare, custShareAvg20: rnd(avg(prior, 'custShare'), 3),
      },
      buckets,
      series: series.slice(-260).map(({ buckets: _b, ...x }) => x),
      error: store.err,
      source: 'FINRA TRACE Treasury daily aggregates (FINRA Query API, Public credential)',
    }
  }

  async function get() {
    if (!store.rows.length) await refresh()
    else if (Date.now() - store.at > TTL) refresh().catch(() => {})
    if (!mem || dirty) { mem = derive(); dirty = false }
    if (!mem) throw new Error(store.err || 'No FINRA Treasury volume yet')
    return { ...mem, refreshing: !!inflight }
  }

  return { get }
}
