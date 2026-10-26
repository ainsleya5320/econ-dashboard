// ============================================================================
// CORPORATE BONDS — Bonds → Corporate bonds: the corporate tape, bond by bond.
//
// Source: the data service behind finra.org's Fixed Income Data pages
// (services-dynarep.ddwa.finra.org/public/reporting/v2, FixedIncomeMarket):
// TRACE last sales with S&P and Moody's ratings. PERSONAL USE ONLY. finra.org's
// Fixed Income Data User Agreement forbids automated copying ("any robot,
// spider, other automatic or manual process to monitor or copy the Data") and
// limits the data to personal, non-commercial use; the user chose to run this
// anyway (Oct 26, 2026), as with the CME curves. So: light polling (about 25
// requests a day, spaced), everything cached in gitignored files, nothing
// committed, and never baked into the Netlify fork. If FINRA blocks the
// requests the page says so; it does not retry harder.
//
// Session: GET any public lookup for an XSRF-TOKEN cookie, then POST queries
// with X-XSRF-TOKEN. Each answer wraps the rows as a JSON string in
// returnBody.data. Sorting puts nulls first and CONTAINS is refused, so rows are
// pulled with EQUAL / LESSER / date-range filters and ranked here.
//
//   snapshot   CorporateAndAgencySecurities, productSubTypeCode CORP, last trade
//              within 7 days: about 25,000 bonds in pages of 5,000, once a day.
//              Kept per day (price, yield, ratings) for 30 days to measure
//              moves and catch rating changes.
//   active     MostActiveCorporateSecurities for investment grade, high yield
//              and convertibles (10 each) on the latest report date.
//   issuers    the watchlist (exact FINRA issuer names), one query each: every
//              bond, its yield and its spread over the Treasury curve fitted on
//              Bonds → Treasuries (server/treasuryBonds.js) at its maturity.
//
// Derived: the biggest one-day and one-week price moves (plain coupon bonds
// over $5, at least 1 point), the distressed list (plain non-convertible coupon
// bonds under 70, by issuer, with new entrants), and a fallen-angel watch:
// issuers cut to BB+ / Ba1 in the past 120 days, issuers rated investment grade
// whose bonds trade at a spread over 3.5 points (priced like junk), and, once
// two snapshots exist, issuers seen moving from investment grade to junk.
// Files (root, gitignored): corporate-bonds.json (snapshots and results),
// corporate-watchlist.json (the issuer list, edited from the page).
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, DAY = 864e5, TTL = 20 * H, RETRY = 2 * H, GAP = 1500, KEEP = 30, PAGE = 5000
const SVC = 'https://services-dynarep.ddwa.finra.org/public/reporting/v2'
const DATA = `${SVC}/data/group/FixedIncomeMarket/name`
const DEFAULT_ISSUERS = ['ORACLE CORP', 'BOEING CO', 'FORD MTR CR CO LLC', 'AT&T INC', 'CHARTER COMMUNICATIONS OPER LLC / CHARTER COMMUNICATIONS OPER CAP CORP']
const SNAP_FIELDS = ['cusip', 'issuerName', 'couponRate', 'maturityDate', 'industryGroup', 'moodysRating', 'standardAndPoorsRating', 'lastSalePrice', 'lastSaleYield', 'lastTradeDate', 'isConvertible', 'isCallable', 'is144A', 'nextCallDate', 'standardAndPoorsRatingDate', 'moodyRatingDate', 'traceGradeCode']
const ACTIVE_FIELDS = ['issuerName', 'issueSymbolIdentifier', 'bondType', 'couponRate', 'maturityDate', 'moodysRating', 'standardAndPoorsRating', 'highPrice', 'lowPrice', 'lastPrice', 'priceChangeAmount', 'yieldPercent', 'reportDate', 'securityTypeCode']

const fin = v => v != null && Number.isFinite(v)
const num = v => (v == null || v === '' ? null : Number.isFinite(+v) ? +v : null)
const rnd = (v, d = 2) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const iso = t => new Date(t).toISOString().slice(0, 10)
const scrub = e => String(e?.message || e || '').slice(0, 200)
const rated = r => !!r && !['NR', 'WR', 'NA', 'N/A'].includes(r)
const yes = v => v === true || v === 'Y' || v === 'Yes' || v === 'true'

// rating scales: investment grade is BBB- / Baa3 and above
const SP = ['AAA', 'AA+', 'AA', 'AA-', 'A+', 'A', 'A-', 'BBB+', 'BBB', 'BBB-', 'BB+', 'BB', 'BB-', 'B+', 'B', 'B-', 'CCC+', 'CCC', 'CCC-', 'CC', 'C', 'D']
const MD = ['Aaa', 'Aa1', 'Aa2', 'Aa3', 'A1', 'A2', 'A3', 'Baa1', 'Baa2', 'Baa3', 'Ba1', 'Ba2', 'Ba3', 'B1', 'B2', 'B3', 'Caa1', 'Caa2', 'Caa3', 'Ca', 'C']
const spIG = r => SP.indexOf(r) >= 0 && SP.indexOf(r) <= 9, spHY = r => SP.indexOf(r) >= 10
const mdIG = r => MD.indexOf(r) >= 0 && MD.indexOf(r) <= 9, mdHY = r => MD.indexOf(r) >= 10
const grade = (sp, md) => (spIG(sp) || mdIG(md) ? 'IG' : spHY(sp) || mdHY(md) ? 'HY' : null)

export function createCorporateBonds({ UA, dir, treasury }) {
  const FILE = path.join(dir, 'corporate-bonds.json'), WFILE = path.join(dir, 'corporate-watchlist.json')
  const load = f => { try { if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8')) } catch (e) { console.warn(`${path.basename(f)}: ${e.message}`) } return null }
  const disk = load(FILE)
  const store = disk?.version === 1 ? disk : { version: 1, snaps: {}, meta: {}, active: null, issuers: {}, at: 0, err: null, spreads: {} }
  const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(store)) } catch (e) { console.error('corporate-bonds.json save:', e.message) } }
  const watchlist = () => { const w = load(WFILE); return Array.isArray(w?.issuers) ? w.issuers : DEFAULT_ISSUERS }
  let cookie = null, xsrf = null, inflight = null, mem = null, dirty = true, last = 0

  async function session() {
    const r = await fetch(`${SVC}/group/Firm/name/ActiveIndividual/dynamiclookup/examCode`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
    const jar = (r.headers.getSetCookie?.() || []).map(c => c.split(';')[0])
    xsrf = jar.find(c => c.startsWith('XSRF-TOKEN='))?.split('=')[1] || null
    if (!xsrf) throw new Error(`FINRA gave no session (HTTP ${r.status})`)
    cookie = jar.join('; ')
  }
  async function query(name, body, retried = false) {
    const wait = last + GAP - Date.now(); if (wait > 0) await sleep(wait)
    last = Date.now()
    if (!xsrf) await session()
    const r = await fetch(`${DATA}/${name}`, { method: 'POST', body: JSON.stringify(body), signal: AbortSignal.timeout(60_000), headers: { 'User-Agent': UA, 'Content-Type': 'application/json', Accept: 'application/json', 'X-XSRF-TOKEN': xsrf, Cookie: cookie, Origin: 'https://www.finra.org', Referer: 'https://www.finra.org/' } })
    if ((r.status === 401 || r.status === 403) && !retried) { xsrf = null; return query(name, body, true) }
    if (!r.ok) throw new Error(`FINRA ${name} HTTP ${r.status}${r.status === 403 || r.status === 429 ? ' (blocked or rate-limited)' : ''}`)
    const j = await r.json()
    if (j.status !== 'success') throw new Error(`FINRA ${name}: ${j.statusMessage || 'failed'}`)
    const total = num(j.returnBody?.headers?.['Record-Total']?.[0])
    return { rows: JSON.parse(j.returnBody?.data || '[]'), total }
  }

  // ── the daily pulls ──────────────────────────────────────────────────────
  async function snapshot() {
    const end = iso(Date.now()), start = iso(Date.now() - 7 * DAY), rows = []
    for (let offset = 0; ; offset += PAGE) {
      const { rows: page, total } = await query('CorporateAndAgencySecurities', { fields: SNAP_FIELDS, compareFilters: [{ fieldName: 'productSubTypeCode', fieldValue: 'CORP', compareType: 'EQUAL' }], dateRangeFilters: [{ fieldName: 'lastTradeDate', startDate: start, endDate: end }], limit: PAGE, offset })
      rows.push(...page)
      if (page.length < PAGE || (fin(total) && rows.length >= total) || offset > 60_000) break
    }
    if (rows.length < 1000) throw new Error(`FINRA returned only ${rows.length} corporate bonds`)
    const day = rows.reduce((m, r) => (r.lastTradeDate > m ? r.lastTradeDate : m), '')
    const snap = {}
    for (const r of rows) {
      if (!r.cusip) continue
      store.meta[r.cusip] = { i: r.issuerName, c: num(r.couponRate), m: r.maturityDate, ind: r.industryGroup || null, cv: yes(r.isConvertible), cl: yes(r.isCallable), a: yes(r.is144A), nc: r.nextCallDate || null, spd: r.standardAndPoorsRatingDate || null, mdd: r.moodyRatingDate || null }
      snap[r.cusip] = [rnd(num(r.lastSalePrice), 3), rnd(num(r.lastSaleYield), 3), r.lastTradeDate, r.standardAndPoorsRating || null, r.moodysRating || null]
    }
    store.snaps[day] = snap
    const keep = Object.keys(store.snaps).sort().slice(-KEEP)
    store.snaps = Object.fromEntries(keep.map(d => [d, store.snaps[d]]))
    return day
  }

  // the latest report date with a list: today's is published after the close
  async function mostActive(latest) {
    let day = latest, probe = []
    for (let i = 0; i < 6; i++) {
      probe = (await query('MostActiveCorporateSecurities', { fields: ACTIVE_FIELDS, compareFilters: [{ fieldName: 'reportDate', fieldValue: day, compareType: 'EQUAL' }, { fieldName: 'securityTypeCode', fieldValue: 'inv', compareType: 'EQUAL' }], limit: 10, offset: 0 })).rows
      if (probe.length) break
      let t = Date.parse(`${day}T00:00:00Z`) - DAY; while ([0, 6].includes(new Date(t).getUTCDay())) t -= DAY
      day = iso(t)
    }
    if (!probe.length) return null
    const out = {}
    for (const t of ['inv', 'hy', 'conv']) {
      const rows = t === 'inv' ? probe : (await query('MostActiveCorporateSecurities', { fields: ACTIVE_FIELDS, compareFilters: [{ fieldName: 'reportDate', fieldValue: day, compareType: 'EQUAL' }, { fieldName: 'securityTypeCode', fieldValue: t, compareType: 'EQUAL' }], limit: 10, offset: 0 })).rows
      out[t] = rows.map(r => ({ issuer: r.issuerName, symbol: r.issueSymbolIdentifier, coupon: num(r.couponRate), maturity: r.maturityDate, sp: r.standardAndPoorsRating || null, moodys: r.moodysRating || null, high: num(r.highPrice), low: num(r.lowPrice), last: num(r.lastPrice), change: num(r.priceChangeAmount), yield: rnd(num(r.yieldPercent), 3) }))
    }
    return { day, ...out }
  }

  async function issuers(names = watchlist()) {
    const out = {}
    for (const name of names.slice(0, 20)) {
      try {
        const { rows } = await query('CorporateAndAgencySecurities', { fields: SNAP_FIELDS, compareFilters: [{ fieldName: 'issuerName', fieldValue: name, compareType: 'EQUAL' }], limit: 500, offset: 0 })
        out[name] = rows.map(r => ({ cusip: r.cusip, coupon: num(r.couponRate), maturity: r.maturityDate, price: num(r.lastSalePrice), yield: num(r.lastSaleYield), last: r.lastTradeDate, sp: r.standardAndPoorsRating || null, moodys: r.moodysRating || null, cv: yes(r.isConvertible), cl: yes(r.isCallable) }))
      } catch (e) { out[name] = store.issuers?.[name] || { error: scrub(e) } }
    }
    return out
  }

  async function refresh() {
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const day = await snapshot()
        try { store.active = await mostActive(day) } catch (e) { console.warn('FINRA most active:', scrub(e)) }
        store.issuers = await issuers()
        store.at = Date.now(); store.err = null
      } catch (e) { store.err = scrub(e); store.at = Date.now() - TTL + RETRY; console.warn('FINRA corporate bonds:', store.err) }
      save(); dirty = true
    })().finally(() => { inflight = null })
    return inflight
  }

  // ── reading the snapshots ────────────────────────────────────────────────
  function derive(curve) {
    const days = Object.keys(store.snaps).sort()
    if (!days.length) return null
    const d0 = days.at(-1), now = store.snaps[d0]
    const back = n => { const t = Date.parse(`${d0}T00:00:00Z`) - n * DAY; return [...days].reverse().find(d => Date.parse(`${d}T00:00:00Z`) <= t) || null }
    const d1 = days.length > 1 ? days.at(-2) : null, d7 = back(6), d30 = back(28)
    const years = m => (m ? (Date.parse(`${m}T00:00:00Z`) - Date.parse(`${d0}T00:00:00Z`)) / (365.25 * DAY) : null)
    const tsy = t => { // the fitted Treasury yield at t years, from Bonds → Treasuries
      if (!curve?.length || !fin(t)) return null
      if (t <= curve[0].years) return curve[0].yield
      for (let i = 1; i < curve.length; i++) if (t <= curve[i].years) { const a = curve[i - 1], b = curve[i]; return a.yield + ((b.yield - a.yield) * (t - a.years)) / (b.years - a.years) }
      return curve.at(-1).yield
    }
    const plain = c => { const m = store.meta[c]; return m && fin(m.c) && m.c > 0 && !m.cv }
    const bond = (c, row) => { const m = store.meta[c], t = years(m.m), ty = tsy(t); return { cusip: c, issuer: m.i, industry: m.ind, coupon: m.c, maturity: m.m, years: rnd(t, 1), price: row[0], yield: row[1], last: row[2], sp: row[3], moodys: row[4], spread: fin(row[1]) && fin(ty) && t > 0.5 ? rnd(row[1] - ty, 2) : null, callable: m.cl, a144: m.a } }

    // moves: plain coupon bonds over $5 that traded on the latest day, against the earlier snapshot
    const moves = (dPrev, label) => {
      if (!dPrev) return null
      const prev = store.snaps[dPrev], out = []
      for (const [c, row] of Object.entries(now)) {
        if (row[2] !== d0 || !plain(c) || !(row[0] > 5)) continue
        const p = prev[c]?.[0]
        if (!(p > 5) || prev[c][2] === row[2]) continue
        const chg = row[0] - p
        if (Math.abs(chg) >= 1) out.push({ ...bond(c, row), from: p, change: rnd(chg, 2), pct: rnd((chg / p) * 100, 1) })
      }
      out.sort((a, b) => a.change - b.change)
      return { since: dPrev, label, down: out.slice(0, 15), up: out.slice(-15).reverse() }
    }

    // distressed: rated plain bonds between 20 and 70, by issuer (under 20 is usually defaulted paper, counted apart)
    const prevWeek = d7 ? store.snaps[d7] : null
    const byIssuer = new Map(), defaulted = new Set()
    for (const [c, row] of Object.entries(now)) {
      if (!plain(c) || !(row[0] > 0 && row[0] < 70)) continue
      if (!rated(row[3]) && !rated(row[4])) continue // unrated: mostly structured notes
      if (row[0] < 20) { defaulted.add(store.meta[c].i); continue }
      const b = bond(c, row), k = b.issuer
      if (!byIssuer.has(k)) byIssuer.set(k, { issuer: k, industry: b.industry, sp: b.sp, moodys: b.moodys, bonds: [], newly: false })
      const g = byIssuer.get(k); g.bonds.push(b)
      if (prevWeek && prevWeek[c]?.[0] >= 70) g.newly = true
    }
    const distressed = [...byIssuer.values()].map(g => ({ ...g, low: Math.min(...g.bonds.map(b => b.price)), count: g.bonds.length, bonds: g.bonds.sort((a, b) => a.price - b.price).slice(0, 6) })).sort((a, b) => (b.newly - a.newly) || a.low - b.low)

    // fallen-angel watch, by issuer
    const issuerRow = new Map()
    for (const [c, row] of Object.entries(now)) {
      if (!plain(c)) continue
      const m = store.meta[c], k = m.i
      const cur = issuerRow.get(k) || { issuer: k, industry: m.ind, sp: row[3], moodys: row[4], spd: m.spd, mdd: m.mdd, spreads: [] }
      const b = bond(c, row); if (fin(b.spread) && b.years > 1) cur.spreads.push(b.spread)
      issuerRow.set(k, cur)
    }
    const cutoff = iso(Date.parse(`${d0}T00:00:00Z`) - 120 * DAY), med = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null }
    const recentCuts = [], junkPriced = [], split = []
    for (const g of issuerRow.values()) {
      const sprd = med(g.spreads)
      const spAct = g.sp === 'BB+' && g.spd && g.spd >= cutoff, mdAct = g.moodys === 'Ba1' && g.mdd && g.mdd >= cutoff
      if (spAct || mdAct) recentCuts.push({ issuer: g.issuer, industry: g.industry, sp: g.sp, moodys: g.moodys, since: spAct ? g.spd : g.mdd, spread: rnd(sprd, 2), bonds: g.spreads.length })
      if ((spIG(g.sp) && mdHY(g.moodys)) || (spHY(g.sp) && mdIG(g.moodys))) split.push({ issuer: g.issuer, industry: g.industry, sp: g.sp, moodys: g.moodys, spread: rnd(sprd, 2), bonds: g.spreads.length })
      if (grade(g.sp, g.moodys) === 'IG' && fin(sprd) && sprd > 3.5 && g.spreads.length >= 2) junkPriced.push({ issuer: g.issuer, industry: g.industry, sp: g.sp, moodys: g.moodys, spread: rnd(sprd, 2), bonds: g.spreads.length })
    }
    // confirmed: an issuer investment grade in an earlier snapshot and junk now
    const confirmed = []
    if (days.length > 1) {
      const was = new Map()
      for (const d of days.slice(0, -1)) for (const [c, row] of Object.entries(store.snaps[d])) { const k = store.meta[c]?.i; if (k && grade(row[3], row[4]) === 'IG') was.set(k, d) }
      for (const g of issuerRow.values()) if (grade(g.sp, g.moodys) === 'HY' && !spIG(g.sp) && !mdIG(g.moodys) && was.has(g.issuer)) confirmed.push({ issuer: g.issuer, industry: g.industry, sp: g.sp, moodys: g.moodys, lastIG: was.get(g.issuer) })
    }

    // the watchlist's curves and spreads
    const recent = iso(Date.parse(`${d0}T00:00:00Z`) - 30 * DAY)
    const watch = Object.entries(store.issuers || {}).map(([name, rows]) => {
      if (!Array.isArray(rows)) return { issuer: name, error: rows?.error || 'no data' }
      const bonds = rows.filter(r => fin(r.coupon) && r.coupon > 0 && !r.cv && fin(r.yield) && r.last >= recent).map(r => { const t = years(r.maturity), ty = tsy(t); return { ...r, years: rnd(t, 1), spread: fin(ty) && t > 0.5 ? rnd(r.yield - ty, 2) : null } }).filter(r => r.years > 0).sort((a, b) => a.years - b.years)
      const sp = bonds.map(b => b.spread).filter(fin), m = med(sp)
      store.spreads[name] = { ...(store.spreads[name] || {}), [d0]: rnd(m, 3) }
      const hist = store.spreads[name], hd = Object.keys(hist).sort(), wk = hd.filter(d => d <= (d7 || '')).at(-1)
      return { issuer: name, sp: bonds.at(-1)?.sp || rows[0]?.sp || null, moodys: bonds.at(-1)?.moodys || rows[0]?.moodys || null, bonds, medianSpread: rnd(m, 2), spreadChange1w: fin(m) && fin(hist[wk]) ? rnd((m - hist[wk]) * 100, 0) : null, total: rows.length }
    })

    return {
      built: new Date().toISOString(), asOf: d0, snapshots: days.length, bondsTraded: Object.keys(now).length,
      active: store.active, moves: { day: moves(d1, '1 day'), week: moves(d7, '1 week'), month: moves(d30, '1 month') },
      distressed: { count: distressed.reduce((s, g) => s + g.count, 0), issuers: distressed.length, newIssuers: distressed.filter(g => g.newly).length, list: distressed.slice(0, 60), since: d7, defaultedIssuers: defaulted.size },
      fallenAngels: { recentCuts: recentCuts.sort((a, b) => String(b.since).localeCompare(String(a.since))), split: split.filter(x => x.bonds >= 2).sort((a, b) => (b.spread ?? -9) - (a.spread ?? -9)).slice(0, 40), junkPriced: junkPriced.sort((a, b) => b.spread - a.spread).slice(0, 25), confirmed },
      watchlist: watch, watchNames: watchlist(),
      error: store.err,
      source: 'finra.org Fixed Income Data (TRACE last sales; S&P and Moody\'s ratings), personal use under its user agreement',
    }
  }

  async function get(req) {
    const q = new URL(req?.url || '/', 'http://x').searchParams
    if (q.has('find')) { // issuer names for the watchlist picker, from the latest snapshot
      const s = q.get('find').trim().toUpperCase()
      if (s.length < 2) return { names: [] }
      const names = new Set(); for (const m of Object.values(store.meta)) if (m.i?.includes(s)) names.add(m.i)
      return { names: [...names].sort().slice(0, 25) }
    }
    if (!Object.keys(store.snaps).length) await refresh()
    else if (Date.now() - store.at > TTL) refresh().catch(() => {})
    if (!mem || dirty) {
      let curve = null
      try { curve = (await treasury.get())?.line || null } catch { /* spreads blank without the Treasury curve */ }
      mem = derive(curve); dirty = false
    }
    if (!mem) throw new Error(store.err || 'No FINRA bond data yet')
    return { ...mem, refreshing: !!inflight }
  }

  // the watchlist, edited from the page (the route takes it from this computer only)
  async function setWatchlist(list) {
    const names = [...new Set((Array.isArray(list) ? list : []).map(s => String(s).trim().toUpperCase()).filter(s => s.length >= 2 && s.length <= 120))].slice(0, 20)
    fs.writeFileSync(WFILE, JSON.stringify({ _about: 'Bonds → Corporate bonds issuer watchlist (exact FINRA issuer names). Gitignored.', issuers: names }, null, 1))
    // keep what's on file for issuers already watched; fetch only the new ones
    const have = Object.fromEntries(names.filter(n => Array.isArray(store.issuers?.[n])).map(n => [n, store.issuers[n]]))
    store.issuers = { ...have, ...(await issuers(names.filter(n => !have[n]))) }
    save(); dirty = true
    return { issuers: names }
  }

  // distressed new entrants, for the Ideas page's special-situations bucket
  function distressedEntrants() { return mem?.distressed?.list?.filter(g => g.newly) || [] }

  return { get, setWatchlist, distressedEntrants }
}
