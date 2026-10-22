// ============================================================================
// POLICY RATES — BIS central bank policy rates for ~40 economies, the one
// source behind International → Central Banks & Rates, and the base layer of
// /api/cb-rates (which the International pulse and the Forex scorecard read).
//
//   monthly  stats.bis.org WS_CBPOL/M (detail=dataonly, ~0.25 MB from 1990):
//            end-of-month policy rate, % — history, 6/12-month changes and
//            the easing/tightening breadth line.
//   daily    stats.bis.org WS_CBPOL/D, the last ~500 days (~0.4 MB): today's
//            rate, and the date and size of the last move.
//
// BIS's "policy rate" is each bank's own headline instrument: the midpoint of
// the Fed's target range, the ECB deposit facility rate (XM), Bank Rate, the
// PBoC 7-day reverse repo, and so on. BIS updates weekly, so a decision taken
// in the last few days can be missing — /api/cb-rates lets a newer decision
// from the FMP calendar override. Croatia (euro since 2023) and Greece (pre-
// euro) are dropped; a series with no observation in 120 days is flagged
// stale. Cadence: 12 hours; a failed request keeps the last good copy.
// Cache: policy-rates.json at the root (gitignored). Requests per refresh: 2.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, DAY = 24 * H, TTL = 12 * H, RETRY = H
const BIS = 'https://stats.bis.org/api/v1/data/WS_CBPOL'
const PAGE = 'https://data.bis.org/topics/CBPOL'
const OUT = '2000-01'

// BIS area → [app id (as in /api/cb-rates), economy, bank, region, peg note]
const BANKS = {
  US: ['US', 'United States', 'Federal Reserve', 'Americas'], CA: ['CA', 'Canada', 'Bank of Canada', 'Americas'],
  BR: ['BR', 'Brazil', 'Banco Central do Brasil', 'Americas'], MX: ['MX', 'Mexico', 'Banco de México', 'Americas'],
  CL: ['CL', 'Chile', 'Banco Central de Chile', 'Americas'], CO: ['CO', 'Colombia', 'Banco de la República', 'Americas'],
  PE: ['PE', 'Peru', 'Banco Central de Reserva', 'Americas'], AR: ['AR', 'Argentina', 'Banco Central (BCRA)', 'Americas'],
  XM: ['EU', 'Euro area', 'European Central Bank', 'Europe'], GB: ['GB', 'United Kingdom', 'Bank of England', 'Europe'],
  CH: ['CH', 'Switzerland', 'Swiss National Bank', 'Europe'], SE: ['SE', 'Sweden', 'Riksbank', 'Europe'],
  NO: ['NO', 'Norway', 'Norges Bank', 'Europe'], DK: ['DK', 'Denmark', 'Danmarks Nationalbank', 'Europe', 'pegged to the euro'],
  PL: ['PL', 'Poland', 'National Bank of Poland', 'Europe'], CZ: ['CZ', 'Czechia', 'Czech National Bank', 'Europe'],
  HU: ['HU', 'Hungary', 'Magyar Nemzeti Bank', 'Europe'], RO: ['RO', 'Romania', 'National Bank of Romania', 'Europe'],
  RS: ['RS', 'Serbia', 'National Bank of Serbia', 'Europe'], MK: ['MK', 'North Macedonia', 'National Bank (NBRM)', 'Europe', 'pegged to the euro'],
  IS: ['IS', 'Iceland', 'Central Bank of Iceland', 'Europe'], RU: ['RU', 'Russia', 'Bank of Russia', 'Europe'],
  TR: ['TR', 'Türkiye', 'Central Bank (CBRT)', 'Europe'],
  JP: ['JP', 'Japan', 'Bank of Japan', 'Asia-Pacific'], CN: ['CN', 'China', "People's Bank of China", 'Asia-Pacific'],
  KR: ['KR', 'Korea', 'Bank of Korea', 'Asia-Pacific'], IN: ['IN', 'India', 'Reserve Bank of India', 'Asia-Pacific'],
  ID: ['ID', 'Indonesia', 'Bank Indonesia', 'Asia-Pacific'], TH: ['TH', 'Thailand', 'Bank of Thailand', 'Asia-Pacific'],
  MY: ['MY', 'Malaysia', 'Bank Negara Malaysia', 'Asia-Pacific'], PH: ['PH', 'Philippines', 'Bangko Sentral', 'Asia-Pacific'],
  HK: ['HK', 'Hong Kong SAR', 'HKMA', 'Asia-Pacific', 'pegged to the dollar'], AU: ['AU', 'Australia', 'Reserve Bank of Australia', 'Asia-Pacific'],
  NZ: ['NZ', 'New Zealand', 'Reserve Bank of New Zealand', 'Asia-Pacific'],
  ZA: ['ZA', 'South Africa', 'SA Reserve Bank', 'Middle East & Africa'], IL: ['IL', 'Israel', 'Bank of Israel', 'Middle East & Africa'],
  SA: ['SA', 'Saudi Arabia', 'Saudi Central Bank', 'Middle East & Africa', 'pegged to the dollar'], KW: ['KW', 'Kuwait', 'Central Bank of Kuwait', 'Middle East & Africa', 'basket peg'],
  MA: ['MA', 'Morocco', 'Bank Al-Maghrib', 'Middle East & Africa'],
}

const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 2) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const scrub = s => String(s?.message || s || '').slice(0, 200)
const mOrd = k => +k.slice(0, 4) * 12 + (+k.slice(5, 7) - 1)
const mKey = o => `${Math.floor(o / 12)}-${String((o % 12) + 1).padStart(2, '0')}`
// compact monthly series { s, v }
function enc(pts) {
  if (!pts.length) return null
  const m = new Map(pts), v = []
  for (let o = mOrd(pts[0][0]), end = mOrd(pts.at(-1)[0]); o <= end; o++) v.push(m.has(mKey(o)) ? rnd(m.get(mKey(o)), 3) : null)
  return { s: pts[0][0], v }
}
function csv(text) {
  const lines = text.trim().split(/\r?\n/), h = lines[0].split(',')
  const iA = h.indexOf('REF_AREA'), iT = h.indexOf('TIME_PERIOD'), iV = h.indexOf('OBS_VALUE')
  if ([iA, iT, iV].includes(-1)) throw new Error(`columns changed (${h.join(',')})`)
  const out = {}
  for (const l of lines.slice(1)) { const c = l.split(','), v = parseFloat(c[iV]); if (c[iA] && fin(v)) (out[c[iA]] ||= []).push([c[iT], v]) }
  for (const k in out) out[k].sort((a, b) => a[0].localeCompare(b[0]))
  return out
}

// BIS refreshes weekly: a decision in /api/cb-rates (FMP calendar) dated after a bank's last BIS observation
// replaces its latest rate, with the move and the 6/12-month changes adjusted to match
export function applyDecisions(p, cb) {
  if (!p?.banks || !cb) return p
  const banks = p.banks.map(b => {
    const c = cb[b.id]
    if (!c || c.source !== 'FMP' || !fin(c.rate) || !(c.date > b.date) || c.rate === b.rate) return b
    const bp = Math.round((c.rate - b.rate) * 100)
    return { ...b, rate: c.rate, prev: b.rate, lastMove: bp, since: c.date, date: c.date, decision: 'FMP economic calendar (newer than BIS)', chg6m: fin(b.chg6m) ? b.chg6m + bp : null, chg12m: fin(b.chg12m) ? b.chg12m + bp : null }
  })
  return { ...p, banks }
}

export function createPolicyRates({ UA, dir }) {
  const CACHE = 'policy-rates.json', file = path.join(dir, CACHE)
  const load = () => { try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { console.warn(`${CACHE}: ${e.message}`) } return null }
  const save = o => { try { fs.writeFileSync(file, JSON.stringify(o)) } catch (e) { console.error(`${CACHE} save:`, e.message) } }
  let mem = null, raw = null, nextAt = 0, inflight = null

  async function text(url, label) {
    for (let a = 0; ; a++) {
      let r
      try { r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/csv, */*' }, signal: AbortSignal.timeout(60_000) }); if (r.ok) return await r.text() }
      catch (e) { if (a < 2) { await new Promise(res => setTimeout(res, 3000 * (a + 1))); continue } throw new Error(`${label}: ${scrub(e.cause?.code || e.message)}`) }
      if (r.status >= 500 && a < 2) { await new Promise(res => setTimeout(res, 3000 * (a + 1))); continue }
      throw new Error(`${label}: HTTP ${r.status}`)
    }
  }

  function derive(R, meta) {
    const today = new Date().toISOString().slice(0, 10)
    const banks = Object.entries(BANKS).map(([bis, [id, economy, bank, region, peg]]) => {
      const m = R.monthly?.[bis] || [], d = R.daily?.[bis] || []
      if (!m.length && !d.length) return null
      const last = d.at(-1) || m.at(-1), rate = last[1]
      // the last move: walk the daily series back to the first day at a different rate
      let since = null, prev = null
      for (let i = d.length - 1; i > 0; i--) if (d[i - 1][1] !== d[i][1]) { since = d[i][0]; prev = d[i - 1][1]; break }
      if (!since) for (let i = m.length - 1; i > 0; i--) if (m[i - 1][1] !== m[i][1]) { since = `${m[i][0]}-01`; prev = m[i - 1][1]; break }
      const ago = n => { const k = mKey(mOrd(today.slice(0, 7)) - n); return m.find(p => p[0] === k)?.[1] ?? null }
      const stale = (Date.parse(today) - Date.parse(last[0].length === 7 ? `${last[0]}-28` : last[0])) / DAY > 120
      return {
        id, bis, economy, bank, region, peg: peg || null, rate: rnd(rate, 3), date: last[0].length === 7 ? `${last[0]}-28` : last[0], stale,
        since, prev: rnd(prev, 3), lastMove: fin(prev) ? rnd((rate - prev) * 100, 0) : null, // basis points
        chg6m: fin(ago(6)) ? rnd((rate - ago(6)) * 100, 0) : null, chg12m: fin(ago(12)) ? rnd((rate - ago(12)) * 100, 0) : null,
        peak: m.length ? (() => { const p = m.filter(x => x[0] >= '2021-01').reduce((a, b) => (b[1] > a[1] ? b : a), m.at(-1)); return { rate: rnd(p[1], 3), month: p[0] } })() : null,
        series: enc(m.filter(p => p[0] >= OUT)),
      }
    }).filter(Boolean)
    // breadth: of the banks with a rate now and three months earlier, the share that cut and that hiked
    const live = banks.filter(b => !b.peg && b.bis !== 'AR'), byM = new Map(live.map(b => [b.id, new Map(R.monthly?.[b.bis] || [])]))
    const months = [...new Set(live.flatMap(b => (R.monthly?.[b.bis] || []).map(p => p[0])))].filter(k => k >= OUT).sort()
    const breadth = months.map(k => {
      const k3 = mKey(mOrd(k) - 3); let cut = 0, hike = 0, n = 0
      for (const mm of byM.values()) { const a = mm.get(k), b = mm.get(k3); if (!fin(a) || !fin(b)) continue; n++; if (a < b - 1e-9) cut++; else if (a > b + 1e-9) hike++ }
      return n >= 10 ? [k, rnd((hike / n) * 100, 1), rnd((cut / n) * 100, 1), n] : null
    }).filter(Boolean)
    const cur = banks.filter(b => !b.stale)
    return {
      built: new Date().toISOString(), stale: !!meta.stale, sourceErrors: meta.sourceErrors || [], sources: meta.sources || [],
      asOf: cur.map(b => b.date).sort().at(-1) || null,
      summary: {
        banks: cur.length,
        cut6m: cur.filter(b => !b.peg && b.chg6m < 0).length, hiked6m: cur.filter(b => !b.peg && b.chg6m > 0).length,
        median: rnd([...cur.map(b => b.rate)].sort((a, b) => a - b)[Math.floor(cur.length / 2)], 2),
      },
      banks, breadth,
      note: 'BIS central bank policy rates: each bank\'s own headline instrument (the Fed is the midpoint of its target range, the ECB its deposit facility rate). BIS refreshes weekly. Pegged currencies (Hong Kong, Saudi Arabia, Kuwait, Denmark, North Macedonia) follow their anchor and are left out of the breadth line, as is Argentina, whose series stopped in 2025.',
    }
  }

  async function build() {
    const since = new Date(Date.now() - 500 * DAY).toISOString().slice(0, 10)
    const prev = raw || load()?.raw || null, R = {}, errs = [], sources = []
    const jobs = { monthly: `${BIS}/M?format=csv&detail=dataonly&startPeriod=1990-01`, daily: `${BIS}/D?format=csv&detail=dataonly&startPeriod=${since}` }
    const res = await Promise.allSettled(Object.entries(jobs).map(([k, u]) => text(u, `BIS WS_CBPOL ${k}`).then(csv)))
    Object.keys(jobs).forEach((k, i) => {
      const r = res[i]
      if (r.status === 'fulfilled' && Object.keys(r.value).length) { R[k] = r.value; sources.push({ id: k, label: `BIS policy rates (${k})`, url: PAGE, fetched: new Date().toISOString(), from: 'live' }); return }
      if (prev?.[k]) R[k] = prev[k]
      errs.push(`BIS policy rates (${k}): ${r.status === 'rejected' ? scrub(r.reason) : 'no series'}${prev?.[k] ? ' — serving the cached copy' : ''}`)
      sources.push({ id: k, label: `BIS policy rates (${k})`, url: PAGE, fetched: null, from: prev?.[k] ? 'cache' : 'none' })
    })
    if (!R.monthly && !R.daily) throw new Error(errs.join('; '))
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
        console.warn('Policy rates:', scrub(e)); nextAt = Date.now() + RETRY
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
