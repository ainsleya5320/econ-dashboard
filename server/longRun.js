// ============================================================================
// LONG RUN — Historical tab → Interest rates, Inflation, Growth: series that
// run back a century or more, with the recent years attached so the long view
// reaches today. Recent detail lives on the U.S. Economy tabs; this is the
// long view.
//
// The finished history is data/seeds/long-run-history.json
// (server/longRunSeed.js); the modern tail comes from FRED through the shared
// cache:
//   GS10 1953→ spliced onto Shiller's long rate 1871→1953 (one long
//   government yield since 1871); GS30 1977→; TB3MS 1934→; FEDFUNDS 1954→;
//   Moody's AAA / BAA 1919→; NBER commercial paper (New York) 1857→1971 and
//   high-grade railroad bond yields 1857→1937; CPIAUCNS 1913→ spliced onto
//   Shiller's prices for monthly inflation since 1872; BEA real GDP growth
//   (A191RL1A225NBEA) 1930→ after the JST/Maddison estimate for 1871→1929.
//
// Route: /api/long-run (12h cache in memory and long-run.json, ignored).
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { SEED_NAME } from './longRunSeed.js'

const TTL = 12 * 3600e3
const FRED = {
  gs10: 'GS10', gs30: 'GS30', tb3m: 'TB3MS', fedfunds: 'FEDFUNDS', aaa: 'AAA', baa: 'BAA',
  cp: 'M13002US35620M156NNBR', rail: 'M13019USM156NNBR', cpi: 'CPIAUCNS', gdpGrowth: 'A191RL1A225NBEA',
}
const fin = v => v != null && Number.isFinite(v)
const r3 = v => (fin(v) ? Math.round(v * 1000) / 1000 : null)
const monthIndex = s => { const [y, m] = s.split('-').map(Number); return y * 12 + (m - 1) }
const monthLabel = i => `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`

// FRED monthly observations → { s: "YYYY-MM", v: [...] } with nulls for gaps
function monthly(obs) {
  const pts = (obs || []).filter(o => fin(o.v)).map(o => [monthIndex(o.d.slice(0, 7)), o.v])
  if (!pts.length) return null
  const s = pts[0][0], e = pts[pts.length - 1][0], v = new Array(e - s + 1).fill(null)
  for (const [i, x] of pts) v[i - s] = r3(x)
  return { s: monthLabel(s), v }
}
// join two monthly series: a until b starts, then b
function splice(a, b) {
  if (!a) return b
  if (!b) return a
  const sa = monthIndex(a.s), sb = monthIndex(b.s), out = []
  for (let i = sa; i < sb; i++) out.push(a.v[i - sa] ?? null)
  return { s: a.s, v: out.concat(b.v) }
}
const at = (ser, i) => (ser ? ser.v[i - monthIndex(ser.s)] ?? null : null)

export function createLongRun({ dir, fetchFredSeries }) {
  const FILE = path.join(dir, 'long-run.json')
  let mem = null, inflight = null
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return null } }
  const save = o => { try { fs.writeFileSync(FILE, JSON.stringify(o)) } catch (e) { console.error('long-run save:', e.message) } }

  async function build() {
    let seed
    try { seed = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'seeds', SEED_NAME), 'utf8')) }
    catch { throw new Error(`data/seeds/${SEED_NAME} is missing — run: node scripts/refresh-seeds.mjs long-run`) }
    const keys = Object.keys(FRED)
    const got = await Promise.all(keys.map(k => fetchFredSeries(FRED[k], 3000).catch(() => [])))
    const F = Object.fromEntries(keys.map((k, i) => [k, got[i]]))
    const warnings = keys.filter(k => !F[k]?.length).map(k => `FRED ${FRED[k]} unavailable`)

    // one long government yield since 1871; one price index since 1871
    const long = splice(seed.shiller.longRate, monthly(F.gs10))
    const cpi = splice(seed.shiller.cpi, monthly(F.cpi))
    // real long yield: nominal minus the past year's inflation, from 1872
    let real = null
    if (long && cpi) {
      const s = Math.max(monthIndex(long.s), monthIndex(cpi.s) + 12), e = monthIndex(long.s) + long.v.length - 1, v = []
      for (let i = s; i <= e; i++) {
        const n = at(long, i), p = at(cpi, i), p0 = at(cpi, i - 12)
        v.push(fin(n) && fin(p) && fin(p0) && p0 > 0 ? r3(n - (p / p0 - 1) * 100) : null)
      }
      real = { s: monthLabel(s), v }
    }
    const inflationMonthly = (() => {
      if (!cpi) return null
      const s = monthIndex(cpi.s) + 12, v = []
      for (let i = 0; i < cpi.v.length - 12; i++) { const p = cpi.v[i + 12], p0 = cpi.v[i]; v.push(fin(p) && fin(p0) && p0 > 0 ? r3((p / p0 - 1) * 100) : null) }
      return { s: monthLabel(s), v }
    })()

    // real GDP growth: JST (Maddison GDP per capita × population) to 1929, then BEA
    const us = seed.jst.countries.USA, gdpGrowth = {}
    for (let y = us.gdppc.s + 1; y < us.gdppc.s + us.gdppc.v.length; y++) {
      const k = y - us.gdppc.s, kp = y - us.pop.s
      const g1 = us.gdppc.v[k], g0 = us.gdppc.v[k - 1], p1 = us.pop.v[kp], p0 = us.pop.v[kp - 1]
      if ([g1, g0, p1, p0].every(fin) && y < 1930) gdpGrowth[y] = ((g1 * p1) / (g0 * p0) - 1) * 100
    }
    for (const o of F.gdpGrowth || []) { const y = Number(o.d.slice(0, 4)); if (fin(o.v)) gdpGrowth[y] = o.v }
    const gy = Object.keys(gdpGrowth).map(Number).sort((a, b) => a - b)
    const growth = gy.length ? { s: gy[0], v: Array.from({ length: gy[gy.length - 1] - gy[0] + 1 }, (_, i) => r3(gdpGrowth[gy[0] + i] ?? null)), beaFrom: 1930 } : null

    const lastOf = ser => (ser ? monthLabel(monthIndex(ser.s) + ser.v.length - 1) : null)
    return {
      built: new Date().toISOString(), warnings,
      us: {
        rates: {
          long, gs30: monthly(F.gs30), tb3m: monthly(F.tb3m), fedfunds: monthly(F.fedfunds), aaa: monthly(F.aaa), baa: monthly(F.baa),
          cp: monthly(F.cp), rail: monthly(F.rail), real,
        },
        cpi, inflationMonthly,
        inflation: seed.minneapolis.inflation, cpiAnnual: seed.minneapolis.cpi, estimateFrom: seed.minneapolis.estimateFrom,
        growth,
      },
      jst: seed.jst, boe: seed.boe, schmelzing: seed.schmelzing,
      asOf: { rates: lastOf(long), cpi: lastOf(cpi), growth: growth ? growth.s + growth.v.length - 1 : null, seed: seed.fetchedAt },
      sources: seed.sources,
    }
  }

  async function get() {
    if (mem && Date.now() - Date.parse(mem.built) < TTL) return mem
    if (!mem) { const disk = load(); if (disk?.built && Date.now() - Date.parse(disk.built) < TTL) { mem = disk; return mem } }
    if (inflight) return inflight
    inflight = (async () => {
      try { const d = await build(); mem = d; save(d); return d }
      catch (e) { const disk = mem || load(); if (disk) return disk; throw e }
      finally { inflight = null }
    })()
    return inflight
  }
  return { get }
}
