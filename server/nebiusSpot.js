// ============================================================================
// NEBIUS SPOT — the market-clearing price of a preemptible GPU-hour
//   live      api.nebius.cloud/billing/v1alpha1/spot-price: every preemptible
//             GPU market (platform × region) with its current price per
//             GPU-hour and the time it took effect. Nebius moves these prices
//             with demand, between a floor ($0.79 for H100/H200/RTX PRO 6000,
//             $0.99 for B200/B300 in Oct 2026) and a ceiling, so they are a
//             live read of spare capacity: markets parked at the floor mean
//             slack, markets pinned at the ceiling mean it is sold out.
//   series    .../spot-price/list-series: hourly prices for the last 30 days
//             (the API's limit; 15-minute steps only within 7 days), one
//             request for every market. Sent to the page as change points.
//   archive   data/ai/nebius-spot-daily.json (tracked): one row per market
//             per complete UTC day — time-weighted mean, min, max, close and
//             hours at the 30-day floor and ceiling — rebuilt from the hourly
//             series each refresh, so the record runs past the API's 30 days.
//   summary   per GPU: the cheapest and median live price across regions, the
//             change of the cross-region median over 1 and 7 days and against
//             the fixed price, and where each market sits between its floor
//             and ceiling. Market pricing began on 2026-10-08: before that each
//             market had one fixed preemptible price (B300 $4.30, B200 $3.95,
//             H200 $2.45, H100 $2.15, RTX PRO 6000 $0.95), so floors, ceilings
//             and states use the market-pricing period only, found from the
//             data (the first price change) and kept in the archive.
// Keyless, public (the page the prices come from offers the API). Cached 30
// minutes, disk-backed, stale served on error.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const API = 'https://api.nebius.cloud/billing/v1alpha1/spot-price'
const MIN = 60e3, H = 60 * MIN, DAY = 24 * H, TTL = 30 * MIN
const fin = v => v != null && Number.isFinite(v)
const r2 = v => (fin(v) ? Math.round(v * 100) / 100 : null), r3 = v => (fin(v) ? Math.round(v * 1000) / 1000 : null)
const median = xs => { const v = xs.filter(fin).sort((a, b) => a - b); if (!v.length) return null; const m = (v.length - 1) / 2; return (v[Math.floor(m)] + v[Math.ceil(m)]) / 2 }
// "Preemptible NVIDIA® B300 NVLink" → "B300"; "Preemptible NVIDIA® RTX PRO 6000" → "RTX PRO 6000"
const gpuOf = title => String(title || '').replace(/^Preemptible\s+/i, '').replace(/NVIDIA®?\s*/i, '').replace(/\s+(?:NVLink|PCIe|SXM\d?)$/i, '').trim() || null
const ORDER = ['GB300', 'B300', 'GB200', 'B200', 'H200', 'H100', 'RTX PRO 6000', 'L40S']
const rank = g => { const i = ORDER.indexOf(g); return i < 0 ? 99 : i }

export function createNebiusSpot({ UA, dir }) {
  const file = n => path.join(dir, n)
  const load = n => { try { if (fs.existsSync(file(n))) return JSON.parse(fs.readFileSync(file(n), 'utf8')) } catch (e) { console.warn(`${n}: ${e.message}`) } return null }
  const save = (n, o, pretty = false) => { try { fs.mkdirSync(path.dirname(file(n)), { recursive: true }); fs.writeFileSync(file(n), pretty ? JSON.stringify(o, null, 0).replace(/\},\{/g, '},\n{') : JSON.stringify(o)) } catch (e) { console.error(`${n} save:`, e.message) } }
  const CACHE = 'nebius-spot.json', ARCHIVE = path.join('data', 'ai', 'nebius-spot-daily.json')
  let mem = null, inflight = null

  async function getJson(url) {
    for (let a = 0; ; a++) {
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
      if (r.ok) return r.json()
      if (r.status >= 500 && a < 2) { await new Promise(res => setTimeout(res, 1500 * (a + 1))); continue }
      throw new Error(`Nebius HTTP ${r.status}`)
    }
  }

  // time-weighted daily stats from hourly points ([ms, price]), complete UTC days only
  function dailyRows(market, pts, floor, ceil) {
    const byDay = new Map()
    for (let i = 0; i < pts.length; i++) {
      const [t, v] = pts[i], next = pts[i + 1]?.[0] ?? t + H, w = Math.min(next - t, H) / H
      const d = new Date(t).toISOString().slice(0, 10)
      const g = byDay.get(d) || { d, sum: 0, w: 0, min: Infinity, max: -Infinity, close: null, n: 0, atFloor: 0, atCeil: 0 }
      g.sum += v * w; g.w += w; g.min = Math.min(g.min, v); g.max = Math.max(g.max, v); g.close = v; g.n++
      if (v <= floor + 1e-9) g.atFloor += w
      if (v >= ceil - 1e-9) g.atCeil += w
      byDay.set(d, g)
    }
    return [...byDay.values()].filter(g => g.n >= 24).map(g => ({ d: g.d, sku: market.sku, gpu: market.gpu, region: market.region, mean: r3(g.sum / g.w), min: g.min, max: g.max, close: g.close, hFloor: Math.round(g.atFloor), hCeil: Math.round(g.atCeil) }))
  }

  async function build() {
    const live = await getJson(`${API}?pageSize=100`)
    const items = live.items || []
    if (!items.length) throw new Error('Nebius: no spot prices listed')
    const markets = items.map(x => ({ sku: x.skuId, gpu: gpuOf(x.productTitle), title: x.productTitle, platform: x.computeInstance?.platform || null, region: x.region, price: +x.price?.value, effective: x.effectiveTime || null }))
    const start = new Date(Date.now() - 30 * DAY + 5 * MIN).toISOString()
    const ser = await getJson(`${API}/list-series?filters.startTime=${encodeURIComponent(start)}&aggregation.granularity=GRANULARITY_HOUR_1&aggregation.method=METHOD_LAST_PRICE&${markets.map(m => `filters.skuIds=${m.sku}`).join('&')}`)
    const bySku = new Map((ser.items || []).map(s => [s.skuId, (s.points || []).map(p => [Date.parse(p.timestamp), +p.value]).filter(p => fin(p[0]) && fin(p[1])).sort((a, b) => a[0] - b[0])]))

    // Market pricing began on 2026-10-08 (~11:00 UTC): before it every market sat at a fixed
    // preemptible price. The start is found, not assumed: the earliest first change across
    // markets, kept once known, so later 30-day windows that no longer reach back still use it.
    const arch = load(ARCHIVE) || { rows: [] }
    const firstMove = pts => pts.find((p, i) => i > 0 && p[1] !== pts[i - 1][1])?.[0] ?? null
    const moves = markets.map(m => firstMove(bySku.get(m.sku) || [])).filter(fin)
    const found = moves.length && (bySku.get(markets[0].sku) || [])[0]?.[0] < Math.min(...moves) - DAY ? Math.min(...moves) : null
    const dynamicSince = arch.dynamicSince || (found ? new Date(found).toISOString() : null)
    const dyn0 = dynamicSince ? Date.parse(dynamicSince) : -Infinity
    for (const m of markets) {
      const pts = bySku.get(m.sku) || []
      const before = pts.filter(p => p[0] < dyn0)
      m.fixedPrice = before.length ? before.at(-1)[1] : (arch.fixed?.[m.sku] ?? null)
      const own = firstMove(pts) // a market whose first change came an hour later still sat at its fixed price at the start
      const live = pts.filter(p => p[0] >= Math.max(dyn0, own ?? dyn0)).map(p => p[1])
      if (live.length) { m.floor30 = Math.min(...live); m.ceil30 = Math.max(...live) }
    }

    // the archive: replace this run's complete days, keep everything older
    const keep = new Map(arch.rows.map(r => [`${r.sku}|${r.d}`, r]))
    const today = new Date().toISOString().slice(0, 10)
    for (const m of markets) {
      const pts = bySku.get(m.sku) || []
      if (!pts.length || !fin(m.floor30)) continue
      for (const row of dailyRows(m, pts, m.floor30, m.ceil30)) if (row.d < today) keep.set(`${row.sku}|${row.d}`, { ...row, ...(Date.parse(`${row.d}T23:59:59Z`) < dyn0 ? { fixed: true } : {}) })
    }
    const rows = [...keep.values()].sort((a, b) => a.d.localeCompare(b.d) || rank(a.gpu) - rank(b.gpu) || a.region.localeCompare(b.region))
    const fixed = { ...(arch.fixed || {}), ...Object.fromEntries(markets.filter(m => fin(m.fixedPrice)).map(m => [m.sku, m.fixedPrice])) }
    save(ARCHIVE, { source: 'Nebius preemptible spot prices (api.nebius.cloud/billing/v1alpha1/spot-price), USD per GPU-hour; one row per market per complete UTC day: time-weighted mean, min, max, close, hours at the floor and ceiling of the market-pricing period (hFloor, hCeil); fixed: true marks days before market pricing began', dynamicSince, fixed, rows }, true)

    // per market: change points for the chart, 30-day range, position in it, history-based changes
    const at = (pts, t) => { let v = null; for (const p of pts) { if (p[0] > t) break; v = p[1] } return v }
    const now = Date.now()
    for (const m of markets) {
      const pts = bySku.get(m.sku) || []
      m.points = pts.filter((p, i) => i === 0 || i === pts.length - 1 || p[1] !== pts[i - 1][1]).map(p => [p[0], p[1]])
      m.d1 = at(pts, now - DAY); m.d7 = at(pts, now - 7 * DAY); m.d30 = pts[0]?.[1] ?? null
      m.pos = fin(m.floor30) && fin(m.ceil30) && m.ceil30 > m.floor30 ? r3((m.price - m.floor30) / (m.ceil30 - m.floor30)) : null
      m.state = !fin(m.floor30) ? null : m.price <= m.floor30 + 1e-9 ? 'floor' : m.price >= m.ceil30 - 1e-9 ? 'ceiling' : 'between'
      // share of the last 7 days spent at the floor / ceiling
      const wk = pts.filter(p => p[0] >= now - 7 * DAY)
      m.floorShare7 = wk.length ? r3(wk.filter(p => p[1] <= m.floor30 + 1e-9).length / wk.length) : null
      m.ceilShare7 = wk.length ? r3(wk.filter(p => p[1] >= m.ceil30 - 1e-9).length / wk.length) : null
    }
    // per GPU: across regions
    const gpus = [...new Set(markets.map(m => m.gpu))].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
    const byGpu = gpus.map(g => {
      const ms = markets.filter(m => m.gpu === g)
      const med = k => median(ms.map(m => m[k]))
      const nowMed = med('price')
      const pct = (a, b) => (fin(a) && fin(b) && b > 0 ? r3((a / b - 1) * 100) : null)
      // the cross-region median through the 30 days, hourly, for the GPU's own line
      const ts = [...new Set(ms.flatMap(m => (bySku.get(m.sku) || []).map(p => p[0])))].sort((a, b) => a - b)
      const medSeries = ts.map(t => [t, median(ms.map(m => at(bySku.get(m.sku) || [], t)))]).filter((p, i, a) => i === 0 || i === a.length - 1 || p[1] !== a[i - 1][1])
      return {
        gpu: g, regions: ms.length, min: Math.min(...ms.map(m => m.price)), median: r3(nowMed), max: Math.max(...ms.map(m => m.price)),
        cheapest: ms.reduce((a, b) => (b.price < a.price ? b : a)).region,
        chg1d: pct(nowMed, med('d1')), chg7d: pct(nowMed, med('d7')), chg30d: pct(nowMed, med('d30')),
        // against the fixed preemptible price that applied before market pricing began
        fixed: r3(med('fixedPrice')), vsFixed: pct(nowMed, med('fixedPrice')),
        floor: Math.min(...ms.map(m => m.floor30).filter(fin)), ceil: Math.max(...ms.map(m => m.ceil30).filter(fin)),
        atFloor: ms.filter(m => m.state === 'floor').length, atCeil: ms.filter(m => m.state === 'ceiling').length,
        floorShare7: r3(median(ms.map(m => m.floorShare7))), ceilShare7: r3(median(ms.map(m => m.ceilShare7))), medSeries,
      }
    })
    // the tightness read: share of markets at the ceiling minus share at the floor (−1 slack … +1 sold out)
    const tight = markets.length ? r3((markets.filter(m => m.state === 'ceiling').length - markets.filter(m => m.state === 'floor').length) / markets.length) : null
    return {
      built: new Date().toISOString(), snapshotTime: live.snapshotTime || null, dynamicSince, markets, byGpu, tight,
      history: { days: [...new Set(rows.map(r => r.d))].length, from: rows[0]?.d || null, to: rows.at(-1)?.d || null },
      daily: rows,
      source: 'Nebius preemptible (spot) GPU prices, api.nebius.cloud/billing/v1alpha1/spot-price — the feed behind nebius.com/spot-prices. Hourly history is limited to 30 days by the API; the daily archive in data/ai/nebius-spot-daily.json extends it from 2026-10.',
    }
  }

  async function get() {
    if (mem && Date.now() - Date.parse(mem.built) < TTL) return mem
    if (!mem) { const disk = load(CACHE); if (disk?.built && Date.now() - Date.parse(disk.built) < TTL) { mem = disk; return mem } }
    if (inflight) return inflight
    inflight = (async () => {
      try { const d = await build(); mem = d; save(CACHE, d); return d }
      catch (e) { console.warn('Nebius spot:', e.message); const disk = mem || load(CACHE); if (disk) return { ...disk, stale: true, error: e.message }; throw e }
      finally { inflight = null }
    })()
    return inflight
  }

  return { get }
}
