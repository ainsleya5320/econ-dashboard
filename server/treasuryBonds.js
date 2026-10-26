// ============================================================================
// TREASURY BONDS — Income → Bonds: every outstanding marketable Treasury, priced
// and read bond by bond.
//
//   prices    TreasuryDirect FedInvest (treasurydirect.gov/GA-FI/FedInvest): the
//             end-of-day price of every marketable Treasury (bills, notes, bonds,
//             TIPS, FRNs), about 460 CUSIPs, published each business day. The
//             page is a form: load it for a session cookie and CSRF token, post
//             the date, then read the price table (the server refuses the table
//             without a same-site Referer). FedInvest prices are clean prices per
//             $100; TIPS are real prices (no index ratio).
//   auctions  TreasuryDirect TA_WS (keyless JSON): results of the past 400 days
//             (high yield, bid-to-cover, who was awarded what) and the schedule
//             of announced auctions.
//
// Derived per security: yield (bills bond-equivalent; coupons street yield,
// semiannual, settlement next business day; TIPS give real yields), modified
// duration, DV01 per $1M, yield change over 1 day and about a month, and rich /
// cheap: the yield minus a Svensson curve fitted each day to notes and bonds
// (bp, positive = cheap). On-the-run issues are the latest auctioned CUSIP of
// each tenor. TIPS breakevens are the fitted nominal yield at each TIPS maturity
// minus its real yield. Each auction is graded against the six before it of the
// same tenor: bid-to-cover and the share primary dealers had to take.
//
// Archive: about 300 business days of prices per CUSIP in treasury-bonds.json at
// the root (gitignored), built 25 days back on first run, then a day at a time.
// Cadence: prices every 3 hours (a new day appears in the afternoon, ET);
// auctions every 6 hours. FRNs are priced but have no yield here.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, DAY = 864e5
const PRICE_TTL = 3 * H, AUCTION_TTL = 6 * H, RETRY = 30 * 60e3
const KEEP_DAYS = 300, BACKFILL = 25
const FI = 'https://www.treasurydirect.gov/GA-FI/FedInvest'
const TA = 'https://www.treasurydirect.gov/TA_WS/securities'

const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 2) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const num = v => (v === '' || v == null ? null : Number.isFinite(+v) ? +v : null)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const scrub = e => String(e?.message || e || '').slice(0, 200)
const iso = t => new Date(t).toISOString().slice(0, 10)
const utc = s => Date.parse(`${s}T00:00:00Z`)

// ── calendar ───────────────────────────────────────────────────────────────
const isWeekend = t => { const d = new Date(t).getUTCDay(); return d === 0 || d === 6 }
const nextBiz = t => { let x = t + DAY; while (isWeekend(x)) x += DAY; return x }
const prevBiz = t => { let x = t - DAY; while (isWeekend(x)) x -= DAY; return x }
const lastDom = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
// a coupon date n months before maturity; end-of-month maturities pay at month end
function couponDate(mat, monthsBack) {
  const d = new Date(mat), y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate()
  const eom = day === lastDom(y, m)
  const t = new Date(Date.UTC(y, m - monthsBack, 1)), ty = t.getUTCFullYear(), tm = t.getUTCMonth()
  return Date.UTC(ty, tm, eom ? lastDom(ty, tm) : Math.min(day, lastDom(ty, tm)))
}

// ── yields ─────────────────────────────────────────────────────────────────
// bill: bond-equivalent yield from price per 100 and days to maturity
function billYield(p, days) {
  if (!(p > 0 && p < 100.5 && days > 0)) return null
  if (days <= 182) return ((100 - p) / p) * (365 / days) * 100
  const a = days / 365, b = 2 * a - 1, disc = a * a - b * (1 - 100 / p)
  return disc >= 0 ? ((-2 * a + 2 * Math.sqrt(disc)) / b) * 100 : null
}
// coupon security: cash flows from settlement (clean price, coupon %, maturity)
function couponFlows(coupon, mat, settle) {
  let k = 0
  while (couponDate(mat, 6 * (k + 1)) > settle) k++
  const next = couponDate(mat, 6 * k), last = couponDate(mat, 6 * (k + 1))
  const w = (next - settle) / (next - last), accrued = (coupon / 2) * ((settle - last) / (next - last))
  return { n: k + 1, w, accrued, c: coupon / 2 }
}
const pvFlows = (f, y) => { const v = 1 / (1 + y / 2); let s = 0; for (let i = 0; i < f.n; i++) s += f.c * v ** (f.w + i); return s + 100 * v ** (f.w + f.n - 1) }
function couponYield(clean, coupon, mat, settle) {
  if (!(clean > 0) || mat <= settle) return null
  const f = couponFlows(coupon, mat, settle), dirty = clean + f.accrued
  let lo = -0.05, hi = 0.4
  for (let i = 0; i < 80; i++) { const mid = (lo + hi) / 2; if (pvFlows(f, mid) > dirty) lo = mid; else hi = mid }
  const y = (lo + hi) / 2, h = 1e-4
  const md = (pvFlows(f, y - h) - pvFlows(f, y + h)) / (2 * h) / dirty
  return { y: y * 100, md, dirty }
}

// ── the fitted curve: Svensson, linear betas over a grid of the two decays ──
function basis(t, l1, l2) {
  const a = t / l1, b = t / l2, e1 = Math.exp(-a), e2 = Math.exp(-b)
  const f1 = (1 - e1) / a, f2 = (1 - e2) / b
  return [1, f1, f1 - e1, f2 - e2]
}
function solve(A, b) { // tiny normal-equations solve with partial pivoting
  const n = b.length, M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c; for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-12) return null
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = 0; r < n; r++) if (r !== c) { const f = M[r][c] / M[c][c]; for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k] }
  }
  return M.map((r, i) => r[n] / r[i])
}
function fitCurve(points) {
  if (points.length < 12) return null
  let best = null
  for (const l1 of [0.5, 0.8, 1.2, 1.7, 2.5, 3.5, 5]) for (const l2 of [6, 8, 11, 15, 20, 28]) {
    const X = points.map(p => basis(p.t, l1, l2)), k = 4
    const XtX = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => X.reduce((s, r) => s + r[i] * r[j], 0) + (i === j ? 1e-6 : 0)))
    const Xty = Array.from({ length: k }, (_, i) => X.reduce((s, r, n) => s + r[i] * points[n].y, 0))
    const beta = solve(XtX, Xty)
    if (!beta) continue
    const sse = X.reduce((s, r, n) => s + (r.reduce((a, x, i) => a + x * beta[i], 0) - points[n].y) ** 2, 0)
    if (!best || sse < best.sse) best = { l1, l2, beta, sse }
  }
  if (!best) return null
  const at = t => basis(Math.max(t, 0.01), best.l1, best.l2).reduce((a, x, i) => a + x * best.beta[i], 0)
  return { at, rmse: Math.sqrt(best.sse / points.length) * 100 }
}

// ── reading one day's FedInvest table ──────────────────────────────────────
const cookieJar = res => (res.headers.getSetCookie?.() || []).map(c => c.split(';')[0])
function parseTable(html) {
  const rows = []
  for (const tr of html.split(/<tr[\s>]/i).slice(1)) {
    const cells = [...tr.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/<[^>]*>/g, '').trim())
    if (cells.length < 8 || !/^[0-9A-Z]{9}$/.test(cells[0])) continue
    const [mm, dd, yy] = cells[3].split('/')
    if (!yy) continue
    rows.push({ cusip: cells[0], kind: cells[1], rate: num(cells[2].replace('%', '')), maturity: `${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`, buy: num(cells[5]), sell: num(cells[6]), eod: num(cells[7]) })
  }
  return rows
}
const KIND = k => (/BILL/i.test(k) ? 'Bill' : /TIPS|INFLATION/i.test(k) ? 'TIPS' : /FRN|FLOATING/i.test(k) ? 'FRN' : /BOND/i.test(k) ? 'Bond' : /NOTE/i.test(k) ? 'Note' : null)

export function createTreasuryBonds({ UA, dir }) {
  const CACHE = 'treasury-bonds.json', file = path.join(dir, CACHE)
  const load = () => { try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { console.warn(`${CACHE}: ${e.message}`) } return null }
  const disk = load()
  const store = disk?.version === 1 ? disk : { version: 1, days: {}, meta: {}, auctions: null, upcoming: null, pricesAt: 0, auctionsAt: 0, pricesErr: null, auctionsErr: null }
  const save = () => { try { fs.writeFileSync(file, JSON.stringify(store)) } catch (e) { console.error(`${CACHE} save:`, e.message) } }
  let mem = null, dirty = true, inflight = null

  async function priceDay(date) {
    const page = await fetch(`${FI}/selectSecurityPriceDate`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30_000) })
    if (!page.ok) throw new Error(`FedInvest form HTTP ${page.status}`)
    const html = await page.text(), token = /name="_csrf" value="([^"]+)"/.exec(html)?.[1]
    if (!token) throw new Error('FedInvest form has no CSRF token')
    let cookies = cookieJar(page)
    const body = new URLSearchParams({ priceDate: date, _csrf: token, submit: 'Show Prices' })
    const post = await fetch(`${FI}/selectSecurityPriceDate`, { method: 'POST', redirect: 'manual', body, headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies.join('; '), Origin: 'https://www.treasurydirect.gov', Referer: `${FI}/selectSecurityPriceDate` }, signal: AbortSignal.timeout(30_000) })
    cookies = [...cookies.filter(c => !cookieJar(post).some(n => n.split('=')[0] === c.split('=')[0])), ...cookieJar(post)]
    if (post.status !== 302 && !post.ok) throw new Error(`FedInvest date post HTTP ${post.status}`)
    const res = await fetch(`${FI}/securityPriceDetail`, { headers: { 'User-Agent': UA, Cookie: cookies.join('; '), Referer: `${FI}/selectSecurityPriceDate` }, signal: AbortSignal.timeout(30_000) })
    if (!res.ok) throw new Error(`FedInvest price table HTTP ${res.status}`)
    return parseTable(await res.text())
  }

  // the latest published day, then back-fill so the archive reaches BACKFILL business days
  async function refreshPrices() {
    let t = utc(iso(Date.now()))
    if (isWeekend(t)) t = prevBiz(t)
    const want = []
    for (let i = 0; want.length < BACKFILL && i < 40; i++, t = prevBiz(t)) want.push(iso(t))
    let got = 0, empty = 0
    for (const d of want) {
      if (store.days[d]) continue
      if (got + empty > 0) await sleep(1200)
      const rows = await priceDay(d)
      if (!rows.length) { empty++; if (empty > 6) break; continue } // today before publication, or a holiday
      store.days[d] = Object.fromEntries(rows.map(r => [r.cusip, r.eod > 0 ? r.eod : r.sell]))
      for (const r of rows) store.meta[r.cusip] = { kind: KIND(r.kind), rate: r.rate, maturity: r.maturity }
      got++
    }
    const keep = Object.keys(store.days).sort().slice(-KEEP_DAYS)
    store.days = Object.fromEntries(keep.map(d => [d, store.days[d]]))
    return got
  }

  async function refreshAuctions() {
    const get = async u => { const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60_000) }); if (!r.ok) throw new Error(`TreasuryDirect HTTP ${r.status}`); return r.json() }
    const [done, next] = await Promise.all([get(`${TA}/auctioned?format=json&days=400`), get(`${TA}/upcoming?format=json`)])
    const pick = a => ({
      cusip: a.cusip, type: a.type || a.securityType, term: a.securityTerm, original: a.originalSecurityTerm || a.securityTerm, cmb: a.cashManagementBill === 'Yes' || a.type === 'CMB',
      auction: (a.auctionDate || a.competitiveAuctionCloseDate || '').slice(0, 10), issue: (a.issueDate || '').slice(0, 10), maturity: (a.maturityDate || '').slice(0, 10), reopening: a.reopening === 'Yes',
      coupon: num(a.interestRate), highYield: num(a.highYield) ?? num(a.investmentRate) ?? num(a.highInvestmentRate), highDiscount: num(a.highRate) ?? num(a.highDiscountRate), btc: num(a.bidToCoverRatio), offering: num(a.offeringAmount),
      dealer: num(a.primaryDealersCompetitiveParAwarded), direct: num(a.directBiddersCompetitiveParAwarded), indirect: num(a.indirectBiddersCompetitiveParAwarded),
    })
    store.auctions = done.map(pick).filter(a => a.auction)
    store.upcoming = next.map(pick).filter(a => a.auction).map(a => ({ ...a, announced: true }))
  }

  async function refresh() {
    if (inflight) return inflight
    inflight = (async () => {
      const now = Date.now()
      if (now - store.pricesAt > PRICE_TTL) {
        try { await refreshPrices(); store.pricesAt = now; store.pricesErr = null } catch (e) { store.pricesErr = scrub(e); store.pricesAt = now - PRICE_TTL + RETRY; console.warn('Treasury prices:', store.pricesErr) }
      }
      if (now - store.auctionsAt > AUCTION_TTL) {
        try { await refreshAuctions(); store.auctionsAt = now; store.auctionsErr = null } catch (e) { store.auctionsErr = scrub(e); store.auctionsAt = now - AUCTION_TTL + RETRY; console.warn('Treasury auctions:', store.auctionsErr) }
      }
      save(); dirty = true
    })().finally(() => { inflight = null })
    return inflight
  }

  // ── one day's measures for every security ────────────────────────────────
  function measureDay(date) {
    const prices = store.days[date]
    if (!prices) return null
    const settle = nextBiz(utc(date)), out = {}
    for (const [cusip, price] of Object.entries(prices)) {
      const m = store.meta[cusip]
      if (!m?.kind || !(price > 0)) continue
      const mat = utc(m.maturity), t = (mat - settle) / (365.25 * DAY)
      if (t <= 0) continue
      let y = null, md = null
      if (m.kind === 'Bill') { y = billYield(price, Math.round((mat - settle) / DAY)); md = fin(y) ? t / (1 + y / 200) : null }
      // a coupon issue with weeks left trades like a bill and its street yield is noise: no yield under a month
      else if (m.kind !== 'FRN' && fin(m.rate) && t >= 1 / 12) { const r = couponYield(price, m.rate, mat, settle); if (r) { y = r.y; md = r.md } }
      out[cusip] = { price, t, y, md }
    }
    // fit nominal notes and bonds with over a year left (bills trade off their own money-market curve)
    const pts = Object.entries(out).filter(([c, v]) => ['Note', 'Bond'].includes(store.meta[c].kind) && v.t >= 1 && fin(v.y)).map(([, v]) => ({ t: v.t, y: v.y / 100 }))
    const curve = fitCurve(pts)
    // rich / cheap against nearby issues: a kernel-weighted local line through the other notes and bonds
    // around each maturity, the issue itself left out (one smooth curve can't bend where the old 30-years sit)
    const nb = Object.entries(out).filter(([c, v]) => ['Note', 'Bond'].includes(store.meta[c].kind) && v.t >= 0.5 && fin(v.y)).map(([c, v]) => ({ c, t: v.t, y: v.y }))
    for (const [c, v] of Object.entries(out)) {
      if (!fin(v.y) || !['Note', 'Bond'].includes(store.meta[c].kind) || v.t < 1) continue
      const h = Math.max(0.35, 0.12 * v.t)
      let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0, n = 0
      for (const p of nb) {
        if (p.c === c) continue
        const x = p.t - v.t, w = Math.exp(-0.5 * (x / h) ** 2)
        if (w < 1e-3) continue
        sw += w; sx += w * x; sy += w * p.y; sxx += w * x * x; sxy += w * x * p.y; n++
      }
      if (n < 4) continue
      const den = sw * sxx - sx * sx, fit = Math.abs(den) > 1e-12 ? (sy * sxx - sx * sxy) / den : sy / sw
      v.rc = (v.y - fit) * 100
    }
    return { date, out, curve }
  }

  // the latest tenor auction per standard term is the on-the-run issue
  function onTheRun() {
    const map = {}
    for (const a of [...(store.auctions || [])].sort((x, y) => x.auction.localeCompare(y.auction))) {
      if (a.cmb) continue
      const key = `${a.type} ${a.original}`
      map[key] = a.cusip
    }
    return map
  }

  function gradeAuctions() {
    const list = [...(store.auctions || [])].filter(a => !a.cmb).sort((x, y) => x.auction.localeCompare(y.auction))
    const share = a => { const tot = (a.dealer || 0) + (a.direct || 0) + (a.indirect || 0); return tot > 0 ? { dealer: a.dealer / tot, direct: a.direct / tot, indirect: a.indirect / tot } : null }
    const graded = list.map((a, i) => {
      const prior = list.slice(0, i).filter(b => b.type === a.type && b.original === a.original).slice(-6)
      const s = share(a), ps = prior.map(share).filter(Boolean)
      const avg = f => (ps.length ? ps.reduce((x, p) => x + p[f], 0) / ps.length : null)
      const btcAvg = prior.filter(b => fin(b.btc)).length ? prior.filter(b => fin(b.btc)).reduce((x, b) => x + b.btc, 0) / prior.filter(b => fin(b.btc)).length : null
      const dBtc = fin(a.btc) && fin(btcAvg) ? a.btc - btcAvg : null
      const dDealer = s && fin(avg('dealer')) ? s.dealer - avg('dealer') : null
      // weak: fewer bids than usual and dealers left holding more; strong: the reverse
      const score = (fin(dBtc) ? dBtc / 0.15 : 0) - (fin(dDealer) ? dDealer / 0.04 : 0)
      const grade = prior.length < 3 ? null : score >= 1.5 ? 'strong' : score <= -1.5 ? 'weak' : 'in line'
      return { ...a, dealerShare: rnd(s?.dealer, 3), indirectShare: rnd(s?.indirect, 3), directShare: rnd(s?.direct, 3), btcAvg: rnd(btcAvg, 2), dealerAvg: rnd(avg('dealer'), 3), dBtc: rnd(dBtc, 2), dDealer: rnd(dDealer, 3), grade, priorN: prior.length }
    })
    return graded.reverse()
  }

  function derive() {
    const dates = Object.keys(store.days).sort()
    if (!dates.length) return null
    const today = measureDay(dates.at(-1)), prev = dates.length > 1 ? measureDay(dates.at(-2)) : null
    const monthAgo = dates.length > 15 ? measureDay(dates[Math.max(0, dates.length - 22)]) : null
    const otr = onTheRun(), otrSet = new Map(Object.entries(otr).map(([k, c]) => [c, k]))
    const bonds = Object.entries(today.out).map(([cusip, v]) => {
      const m = store.meta[cusip], p = prev?.out[cusip], o = monthAgo?.out[cusip]
      const nominalAt = today.curve && m.kind === 'TIPS' ? today.curve.at(v.t) * 100 : null
      return {
        cusip, kind: m.kind, coupon: m.rate, maturity: m.maturity, years: rnd(v.t, 2), price: rnd(v.price, 4),
        yield: rnd(v.y, 3), md: rnd(v.md, 2), dv01: fin(v.md) ? Math.round(v.md * v.price * 100 * 1e-4 * 100) / 100 : null,
        d1: fin(v.y) && fin(p?.y) ? rnd((v.y - p.y) * 100, 1) : null, d1m: fin(v.y) && fin(o?.y) ? rnd((v.y - o.y) * 100, 1) : null,
        rc: rnd(v.rc, 1), rc1m: fin(v.rc) && fin(o?.rc) ? rnd(v.rc - o.rc, 1) : null,
        otr: otrSet.get(cusip) || null,
        breakeven: fin(nominalAt) && fin(v.y) && v.t >= 1 ? rnd(nominalAt - v.y, 3) : null,
      }
    }).sort((a, b) => a.years - b.years)
    const fitAt = (c, t) => (c ? rnd(c.at(t) * 100, 3) : null)
    const tenors = [1, 2, 3, 5, 7, 10, 20, 30]
    const curve = tenors.map(t => ({ t, y: fitAt(today.curve, t), d1: today.curve && prev?.curve ? rnd((today.curve.at(t) - prev.curve.at(t)) * 1e4, 1) : null, d1m: today.curve && monthAgo?.curve ? rnd((today.curve.at(t) - monthAgo.curve.at(t)) * 1e4, 1) : null }))
    const line = today.curve ? Array.from({ length: 59 }, (_, i) => { const t = 1 + i * 0.5; return { years: t, yield: rnd(today.curve.at(t) * 100, 3) } }) : []
    const yAt = t => curve.find(c => c.t === t)?.y
    return {
      built: new Date().toISOString(), asOf: today.date, prevDate: prev?.date || null, monthDate: monthAgo?.date || null, archiveDays: dates.length,
      fitRmseBp: rnd(today.curve?.rmse * 100, 1), curve, line,
      spreads: { s2s10: fin(yAt(2)) && fin(yAt(10)) ? rnd((yAt(10) - yAt(2)) * 100, 1) : null, s5s30: fin(yAt(5)) && fin(yAt(30)) ? rnd((yAt(30) - yAt(5)) * 100, 1) : null },
      bonds, onTheRun: otr,
      auctions: gradeAuctions().slice(0, 80),
      upcoming: (store.upcoming || []).filter(a => !a.cmb).sort((a, b) => a.auction.localeCompare(b.auction)),
      errors: [store.pricesErr && `FedInvest prices: ${store.pricesErr}`, store.auctionsErr && `TreasuryDirect auctions: ${store.auctionsErr}`].filter(Boolean),
      sources: { prices: 'TreasuryDirect FedInvest end-of-day prices (clean, per $100; TIPS real)', auctions: 'TreasuryDirect auction results and announcements (TA_WS)' },
    }
  }

  async function get() {
    const stale = Date.now() - store.pricesAt > PRICE_TTL || Date.now() - store.auctionsAt > AUCTION_TTL
    if (!Object.keys(store.days).length) await refresh()
    else if (stale) refresh().catch(() => {})
    if (!mem || dirty) { mem = derive(); dirty = false }
    if (!mem) throw new Error(store.pricesErr || 'No Treasury prices yet')
    return { ...mem, refreshing: !!inflight }
  }

  return { get }
}
