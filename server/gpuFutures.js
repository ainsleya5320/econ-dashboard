// ============================================================================
// GPU FUTURES: CME's Silicon Data GPU rental index futures, the forward curve
// of the GPU-hour (USD per GPU-hour, cash-settled on Silicon Data's indices).
//   products   www.cmegroup.com/services/product-slate?searchString=GPU: every
//              "Silicon Data <GPU> Rental Index Futures" product with its CME
//              id (GPU1 = H100, id 11780; GPU2 = B200, id 11781 in Oct 2026).
//              The ids are looked up each refresh; the archived ids, then the
//              two above, stand in when the lookup fails.
//   dates      .../CmeWS/mvc/Settlements/Futures/TradeDate/{id}: the trade
//              dates CME still serves ([["MM/DD/YYYY","Final"], ...]), about
//              five. First settlement 10/15/2026.
//   settles    .../CmeWS/mvc/Settlements/Futures/Settlements/{id}/FUT?strategy=
//              DEFAULT&tradeDate=MM/DD/YYYY&pageSize=100: one row per listed
//              month ("NOV 26" ... 36 months out) with settle, change, volume
//              and open interest, plus a "Total" row. "-" is no value.
// Rules: every trade date CME lists that the archive lacks (or holds only as a
// preliminary report) is fetched once and kept for good: CME drops dates after
// about a week, so the archive is the only history and no date is ever removed.
// Since launch the settles have been marks (volume and open interest 0), not
// trades; volume and OI are carried so the page can say so. History per GPU per
// date: the front contract and the contract 3, 6, 12, 24 and 36 months after the
// trade date's month (the nearest listed month, at most 2 months off, else
// null), and the day's total volume and OI.
// Cadence: stale-while-revalidate. A GET answers from the archive at once and
// refreshes in the background when the last check is over 3 hours old
// (settlements post in the evening, US Central); the first GET with no archive
// waits. A failed refresh is not retried for 15 minutes. About 3 requests a
// refresh (1 product lookup, 1 date list per product) plus 1 per new date per
// product; browser user agent, 20 s timeout. Failures are a line in
// sourceErrors, never a throw once anything is archived.
// Terms: CME market data is for personal use only. The archive holds CME data,
// so it lives at the repo root in a GITIGNORED file and nothing from CME may go
// into a tracked file.
// Files (repo root):
//   gpu-futures.json   archive (gitignored): product ids, every trade date's
//                      settlements per product, the last check. Never written
//                      over when it cannot be read (logged until someone looks);
//                      written through a temp file in data/cache/ (gitignored).
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'https://www.cmegroup.com'
const SLATE_URL = `${BASE}/services/product-slate?searchString=GPU`
const DATES_URL = id => `${BASE}/CmeWS/mvc/Settlements/Futures/TradeDate/${id}`
const SETTLE_URL = (id, mdy) => `${BASE}/CmeWS/mvc/Settlements/Futures/Settlements/${id}/FUT?strategy=DEFAULT&tradeDate=${encodeURIComponent(mdy)}&pageSize=100`
const FALLBACK = [{ code: 'GPU1', gpu: 'H100', id: 11780 }, { code: 'GPU2', gpu: 'B200', id: 11781 }]
const H = 3600e3, TTL = 3 * H, RETRY = 15 * 60e3
const TENORS = [['m3', 3], ['m6', 6], ['m12', 12], ['m24', 24], ['m36', 36]]
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

const fin = v => v != null && Number.isFinite(v)
// "2.990" → 2.99, "+.070" → 0.07, "1,234" → 1234, "-" / "" → null, "UNCH" → 0
const num = s => {
  const t = String(s ?? '').trim().replace(/,/g, '')
  if (/^unch$/i.test(t)) return 0
  if (!t || t === '-' || !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(t)) return null
  return Number(t)
}
// "NOV 26" → "2026-11"
const monthOf = s => {
  const m = /^([A-Z]{3})\s*(\d{2})$/i.exec(String(s || '').trim())
  const i = m ? MONTHS.indexOf(m[1].toUpperCase()) : -1
  return i < 0 ? null : `20${m[2]}-${String(i + 1).padStart(2, '0')}`
}
const labelOf = ym => `${MONTHS[+ym.slice(5, 7) - 1][0]}${MONTHS[+ym.slice(5, 7) - 1].slice(1).toLowerCase()} ${ym.slice(2, 4)}`
const mdyToIso = s => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s || '')); return m ? `${m[3]}-${m[1]}-${m[2]}` : null }
const isoToMdy = d => `${d.slice(5, 7)}/${d.slice(8, 10)}/${d.slice(0, 4)}`
const monthIndex = ym => +ym.slice(0, 4) * 12 + +ym.slice(5, 7) - 1
// "Silicon Data H100 Rental Index Futures" → "H100"
const gpuOf = name => /Silicon Data\s+(.+?)\s+Rental Index Futures/i.exec(String(name || ''))?.[1]?.trim() || null

function readStrict(file) {
  try { return { data: JSON.parse(fs.readFileSync(file, 'utf8')) } } catch (e) { return e?.code === 'ENOENT' ? { missing: true } : { error: e.message } }
}

export function createGpuFutures({ UA, dir }) {
  const FILE = path.join(dir, 'gpu-futures.json')
  const TMP = path.join(dir, 'data', 'cache', 'gpu-futures.json.tmp') // data/cache/ is gitignored
  let archive = null, broken = null, inflight = null, lastFail = 0, lastError = null, payload = null

  async function getJson(url) {
    for (let a = 1; ; a++) {
      try {
        const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json, text/plain, */*', Referer: `${BASE}/` }, signal: AbortSignal.timeout(20_000) })
        if (r.ok) return await r.json()
        r.body?.cancel().catch(() => {})
        const err = new Error(`CME HTTP ${r.status}`); err.status = r.status
        if (a >= 2 || r.status < 500) throw err
      } catch (e) {
        if (e.status || a >= 2) throw e.name === 'TimeoutError' ? new Error('CME timed out') : e
      }
      await new Promise(res => setTimeout(res, 1500))
    }
  }

  function loadArchive() {
    if (archive) return archive
    const st = readStrict(FILE)
    if (st.error || (st.data && typeof st.data.days !== 'object')) {
      broken = `gpu-futures.json could not be read (${st.error || 'no days'}); it is not written until it is fixed`
      console.warn(`GPU futures: ${broken}`)
      archive = { version: 1, products: [], days: {}, checked: null } // in memory only
      return archive
    }
    archive = st.data || { version: 1, products: [], days: {}, checked: null }
    return archive
  }
  function saveArchive() {
    if (broken) return false
    try {
      fs.mkdirSync(path.dirname(TMP), { recursive: true })
      fs.writeFileSync(TMP, JSON.stringify(archive))
      fs.renameSync(TMP, FILE)
      return true
    } catch (e) { console.warn(`GPU futures: archive not written (${e.message})`); return false }
  }

  // the GPU products CME lists now; archived or fallback ids when the lookup fails
  async function products(errors) {
    try {
      const j = await getJson(SLATE_URL)
      const found = (j.products || [])
        .filter(p => /^GPU\d+$/i.test(p.prodCode || '') && /futures/i.test(p.cleared || '') && gpuOf(p.name))
        .map(p => ({ code: p.prodCode.toUpperCase(), gpu: gpuOf(p.name), id: +p.id, name: p.name }))
        .filter(p => fin(p.id))
        .sort((a, b) => a.code.localeCompare(b.code, 'en', { numeric: true }))
      if (found.length) return found
      throw new Error('no GPU products in the product slate')
    } catch (e) {
      errors.push({ source: 'CME product lookup', error: `${e.message}; using the ${archive.products?.length ? 'archived' : 'known'} ids` })
      return archive.products?.length ? archive.products : FALLBACK
    }
  }

  async function refresh() {
    const a = loadArchive(), errors = []
    const prods = await products(errors)
    let lists = 0
    for (const p of prods) {
      let list
      try { list = await getJson(DATES_URL(p.id)); lists++ } catch (e) { errors.push({ source: `CME ${p.code} trade dates`, error: e.message }); continue }
      for (const [mdy, status] of Array.isArray(list) ? list : []) {
        const d = mdyToIso(mdy)
        if (!d) continue
        const have = a.days[d]?.[p.code]
        if (have && have.reportType === 'Final') continue
        try {
          const j = await getJson(SETTLE_URL(p.id, isoToMdy(d)))
          if (j.empty || !Array.isArray(j.settlements) || !j.settlements.length) continue
          const rows = [], total = { volume: null, oi: null }
          for (const s of j.settlements) {
            if (/^total$/i.test(String(s.month || '').trim())) { total.volume = num(s.volume); total.oi = num(s.openInterest); continue }
            const ym = monthOf(s.month)
            if (ym) rows.push([ym, num(s.settle), num(s.change), num(s.volume), num(s.openInterest)])
          }
          if (!rows.length) continue
          rows.sort((x, y) => x[0].localeCompare(y[0]))
          ;(a.days[d] ||= {})[p.code] = { reportType: j.reportType || status || null, updateTime: j.updateTime || null, rows, total }
        } catch (e) { errors.push({ source: `CME ${p.code} ${d}`, error: e.message }) }
      }
    }
    // nothing reachable: a failed refresh (retried in 15 minutes), not a fresh check
    if (!lists) throw new Error(errors.map(e => `${e.source}: ${e.error}`).join('; '))
    a.products = prods.map(({ code, gpu, id, name }) => ({ code, gpu, id, name }))
    a.version = 1
    a.source = 'CME Group daily settlements for the Silicon Data GPU rental index futures (cmegroup.com). CME market data: personal use only; this file is gitignored and must never be committed.'
    a.checked = new Date().toISOString()
    a.days = Object.fromEntries(Object.entries(a.days).sort(([x], [y]) => x.localeCompare(y)))
    saveArchive()
    return errors
  }

  function build(errors) {
    const a = loadArchive()
    const prods = (a.products?.length ? a.products : FALLBACK).map(({ code, gpu, id }) => ({ code, gpu, id }))
    const dates = Object.keys(a.days).sort()
    const curves = {}, history = Object.fromEntries(prods.map(p => [p.gpu, []]))
    for (const d of dates) {
      const day = a.days[d], out = {}
      for (const p of prods) {
        const e = day[p.code]
        if (!e) continue
        const rows = e.rows.filter(r => fin(r[1]))
        out[p.gpu] = rows.map(r => [r[0], r[1]])
        if (!rows.length) continue
        const t0 = monthIndex(d.slice(0, 7))
        const at = n => {
          let best = null, gap = Infinity
          for (const r of rows) { const g = Math.abs(monthIndex(r[0]) - (t0 + n)); if (g < gap || (g === gap && r[0] > best[0])) { best = r; gap = g } }
          return gap <= 2 ? best[1] : null
        }
        const sum = k => { const v = e.rows.map(r => r[k]).filter(fin); return v.length ? v.reduce((s, x) => s + x, 0) : null }
        history[p.gpu].push({
          d, front: rows[0][1], ...Object.fromEntries(TENORS.map(([k, n]) => [k, at(n)])),
          volume: fin(e.total?.volume) ? e.total.volume : sum(3), oi: fin(e.total?.oi) ? e.total.oi : sum(4),
        })
      }
      curves[d] = out
    }
    const last = dates.at(-1) || null, lastDay = last ? a.days[last] : null
    const latest = last ? {
      tradeDate: last,
      updateTime: prods.map(p => lastDay[p.code]?.updateTime).find(Boolean) || null,
      reportType: prods.map(p => lastDay[p.code]?.reportType).find(Boolean) || null,
      curves: Object.fromEntries(prods.map(p => [p.gpu, (lastDay[p.code]?.rows || []).map(r => ({ month: r[0], label: labelOf(r[0]), settle: r[1], change: r[2], volume: r[3], oi: r[4] }))])),
    } : null
    if (latest) for (const p of prods) if (!lastDay[p.code]) errors.push({ source: `CME ${p.code}`, error: `no settlement for ${last}` })
    const traded = dates.some(d => prods.some(p => (a.days[d][p.code]?.rows || []).some(r => r[3] > 0 || r[4] > 0)))
    return {
      built: a.checked || null, stale: !a.checked || Date.now() - Date.parse(a.checked) > TTL,
      sourceErrors: errors, products: prods, latest, dates, curves, history,
      traded,
      note: `CME Group daily settlement prices for the Silicon Data H100 and B200 rental index futures, USD per GPU-hour, cash-settled on Silicon Data's indices; one contract per calendar month, about 36 months listed. ${traded ? 'Some contracts have traded: volume and open interest are shown per contract.' : 'No contract has traded yet (volume and open interest 0): the settles are CME marks, not trade prices.'} CME serves only the last few trade dates; the history here is the local archive, from ${dates[0] || 'the first refresh'}. CME market data is for personal use only.`,
    }
  }

  function startRefresh() {
    if (inflight || Date.now() - lastFail < RETRY) return inflight
    inflight = refresh()
      .then(errs => { lastError = null; payload = build(errs); return payload })
      .catch(e => { lastFail = Date.now(); lastError = e.message; console.warn(`GPU futures: refresh failed: ${e.message}`); return null })
      .finally(() => { inflight = null })
    return inflight
  }

  async function get() {
    const a = loadArchive()
    const age = a.checked ? Date.now() - Date.parse(a.checked) : Infinity
    if (!Object.keys(a.days).length) await startRefresh()
    else if (age > TTL) startRefresh()
    const out = payload && payload.built === a.checked ? { ...payload, sourceErrors: [...payload.sourceErrors] } : build([])
    if (lastError) out.sourceErrors.push({ source: 'CME refresh', error: lastError })
    if (broken) out.sourceErrors.push({ source: 'archive', error: broken })
    out.stale = out.stale || !!lastError
    out.refreshing = !!inflight
    return out
  }

  return { get }
}
