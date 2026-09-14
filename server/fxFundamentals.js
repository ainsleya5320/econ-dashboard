// ============================================================================
// FX FUNDAMENTALS — Brent Donnelly's "The Art of Currency Trading",
// fundamentals chapter, as a feed: fourteen currencies against the dollar
//   valuation  the long-term view, three lenses on one row, positive = the
//              currency is cheap against the dollar:
//              PPP        IMF WEO implied PPP conversion rate vs spot
//              Big Mac    The Economist's GDP-adjusted index, re-marked at
//                         today's rate (from the International pulse feed)
//              REER       BIS real effective rate vs its own 10-year average,
//                         expressed against the dollar's same deviation
//              IMF ESR    the External Sector Report's staff-assessed REER gap
//                         (data/fx/imf-esr.json, refreshed each July), likewise
//                         expressed against the dollar's gap
//              The composite is the median of the lenses that exist; Donnelly's
//              caveat applies and is printed: this says nothing about a year.
//   global     his four global drivers as a regime — world growth, commodity
//              prices, risk aversion, geopolitics — each with a direction, and
//              each currency's measured sensitivity to them: 52-week betas and
//              correlations of weekly returns to the S&P 500 (risk) and WTI
//              (commodities), from FRED daily rates. Safe havens for the
//              geopolitics driver are the two the book names, JPY and CHF.
//   domestic   his three domestic drivers, scored against the dollar:
//              monetary policy split four ways (the 10-year differential and
//              its three-month change as the expectations proxy, the real
//              differential, balance-sheet growth where a series exists, and
//              the central bank's own preference from data/fx/cb-stance.json,
//              which is judgment and labelled so), capital flows (relative
//              equity performance in dollars, a proxy), and the trade balance
//              (IMF WEO current account with commodity exposure).
// Sources: FRED (daily FX, BIS REER, OECD 10-year yields, Fed/ECB/BoJ balance
// sheets, S&P 500, WTI, VIX, HY OAS, copper), IMF DataMapper (PPP rates,
// current accounts, inflation, world growth — free, annual WEO vintages),
// the Caldara–Iacoviello GPR index (monthly .xls), /api/cb-rates for policy
// rates, and the International pulse feed. Cached 6h, disk-backed, complete
// builds only, stale served on error.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'

const H = 3600e3, TTL = 6 * H, DAY = 864e5
const fin = v => v != null && Number.isFinite(v)
const last = a => (a && a.length ? a[a.length - 1] : null)
const r1 = v => (fin(v) ? +v.toFixed(1) : null), r2 = v => (fin(v) ? +v.toFixed(2) : null)
const chg = (a, b) => (fin(a) && fin(b) && b !== 0 ? ((a / b) - 1) * 100 : null)
const mean = xs => { const v = (xs || []).filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const median = xs => { const v = (xs || []).filter(fin).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[(v.length - 1) / 2] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : null }
const pctile = (arr, v) => { const a = (arr || []).filter(fin); if (!a.length || !fin(v)) return null; return Math.round((a.filter(x => x <= v).length / a.length) * 100) }
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const sleep = ms => new Promise(r => setTimeout(r, ms))
const YEAR = new Date().getFullYear()

// fred: daily rate on FRED; usdPer=true means the series quotes dollars per
// unit (EUR, GBP, AUD, NZD), otherwise units per dollar. pulse: the row code in
// the International pulse feed (null for the three it does not cover). cb: key
// in /api/cb-rates; cbFred: monthly policy-rate fallback. bs: central-bank
// balance sheet where FRED has one. haven / em: the book's shorthand for the
// geopolitics driver.
const CURRENCIES = [
  { ccy: 'EUR', name: 'Euro',              flag: '🇪🇺', pulse: 'EA', iso3: 'EUZ', pppIso: ['EUZ', 'DEU'], fred: 'DEXUSEU', usdPer: true,  reer: 'RBXMBIS', y10: 'IRLTLT01DEM156N', cb: 'EU', bs: 'ECBASSETSW', bsFreq: 52 }, // Bund: the OECD euro-area 10-year stopped in Jan 2026
  { ccy: 'JPY', name: 'Japanese yen',      flag: '🇯🇵', pulse: 'JP', iso3: 'JPN', fred: 'DEXJPUS', usdPer: false, reer: 'RBJPBIS', y10: 'IRLTLT01JPM156N', cb: 'JP', bs: 'JPNASSETS', bsFreq: 12, haven: true },
  { ccy: 'GBP', name: 'British pound',     flag: '🇬🇧', pulse: 'GB', iso3: 'GBR', fred: 'DEXUSUK', usdPer: true,  reer: 'RBGBBIS', y10: 'IRLTLT01GBM156N', cb: 'GB' },
  { ccy: 'CHF', name: 'Swiss franc',       flag: '🇨🇭', pulse: 'CH', iso3: 'CHE', fred: 'DEXSZUS', usdPer: false, reer: 'RBCHBIS', y10: 'IRLTLT01CHM156N', cb: 'CH', haven: true },
  { ccy: 'AUD', name: 'Australian dollar', flag: '🇦🇺', pulse: 'AU', iso3: 'AUS', fred: 'DEXUSAL', usdPer: true,  reer: 'RBAUBIS', y10: 'IRLTLT01AUM156N', cb: 'AU', cbFred: 'IRSTCI01AUM156N' },
  { ccy: 'CAD', name: 'Canadian dollar',   flag: '🇨🇦', pulse: 'CA', iso3: 'CAN', fred: 'DEXCAUS', usdPer: false, reer: 'RBCABIS', y10: 'IRLTLT01CAM156N', cb: 'CA' },
  { ccy: 'NZD', name: 'New Zealand dollar',flag: '🇳🇿', pulse: null, iso3: 'NZL', fred: 'DEXUSNZ', usdPer: true,  reer: 'RBNZBIS', y10: 'IRLTLT01NZM156N', cb: 'NZ' },
  { ccy: 'NOK', name: 'Norwegian krone',   flag: '🇳🇴', pulse: null, iso3: 'NOR', fred: 'DEXNOUS', usdPer: false, reer: 'RBNOBIS', y10: 'IRLTLT01NOM156N', cb: 'NO', cbFred: 'IRSTCI01NOM156N' },
  { ccy: 'SEK', name: 'Swedish krona',     flag: '🇸🇪', pulse: null, iso3: 'SWE', fred: 'DEXSDUS', usdPer: false, reer: 'RBSEBIS', y10: 'IRLTLT01SEM156N', cb: 'SE' },
  { ccy: 'CNY', name: 'Chinese yuan',      flag: '🇨🇳', pulse: 'CN', iso3: 'CHN', fred: 'DEXCHUS', usdPer: false, reer: 'RBCNBIS', y10: null, cb: 'CN', cbFred: 'INTDSRCNM193N', em: true },
  { ccy: 'INR', name: 'Indian rupee',      flag: '🇮🇳', pulse: 'IN', iso3: 'IND', fred: 'DEXINUS', usdPer: false, reer: 'RBINBIS', y10: 'INDIRLTLT01STM', cb: 'IN', em: true },
  { ccy: 'KRW', name: 'Korean won',        flag: '🇰🇷', pulse: 'KR', iso3: 'KOR', fred: 'DEXKOUS', usdPer: false, reer: 'RBKRBIS', y10: 'IRLTLT01KRM156N', cb: 'KR', em: true },
  { ccy: 'BRL', name: 'Brazilian real',    flag: '🇧🇷', pulse: 'BR', iso3: 'BRA', fred: 'DEXBZUS', usdPer: false, reer: 'RBBRBIS', y10: null, cb: 'BR', em: true },
  { ccy: 'MXN', name: 'Mexican peso',      flag: '🇲🇽', pulse: 'MX', iso3: 'MEX', fred: 'DEXMXUS', usdPer: false, reer: 'RBMXBIS', y10: 'IRLTLT01MXM156N', cb: 'MX', cbFred: 'IRSTCB01MXM156N', em: true },
]
const USD = { ccy: 'USD', pulse: 'US', iso3: 'USA', reer: 'RBUSBIS', y10: 'DGS10', cb: 'US', bs: 'WALCL', bsFreq: 52 }

export function createFxFundamentals({ fetchFredSeries, fetchCbRates, intlPulse, UA, dir }) {
  const file = n => path.join(dir, n)
  const load = n => { try { if (fs.existsSync(file(n))) return JSON.parse(fs.readFileSync(file(n), 'utf8')) } catch {} return null }
  const save = (n, o) => { try { fs.writeFileSync(file(n), JSON.stringify(o)) } catch (e) { console.error(`${n} save:`, e.message) } }
  const ref = n => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'data', 'fx', n), 'utf8')) } catch (e) { console.warn(`fx ${n}:`, e.message); return null } }
  let mem = null, inflight = null

  const F = async (id, limit) => (id ? (await fetchFredSeries(id, limit).catch(() => [])) : [])
  const asc = a => [...a].sort((x, y) => x.d.localeCompare(y.d))

  // ── IMF DataMapper: one call per indicator, every economy ─────────────────
  async function imf(ind) {
    try {
      const r = await fetch(`https://www.imf.org/external/datamapper/api/v1/${ind}`, { headers: { 'User-Agent': UA } })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const j = await r.json()
      return j.values?.[ind] || {}
    } catch (e) { console.warn(`fx IMF ${ind}:`, e.message); return {} }
  }
  // the current-year estimate, falling back a year; says which year it used
  const weo = (table, iso, prefer = YEAR) => { const row = table?.[iso]; if (!row) return null; for (const y of [prefer, prefer - 1, prefer + 1]) if (fin(row[y])) return { v: row[y], y }; return null }

  // ── GPR: monthly index, Excel serial dates ────────────────────────────────
  async function gpr() {
    try {
      const r = await fetch('https://www.matteoiacoviello.com/gpr_files/data_gpr_export.xls', { headers: { 'User-Agent': UA } })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const wb = XLSX.read(Buffer.from(await r.arrayBuffer()), { type: 'buffer' })
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 })
      const hi = rows[0].indexOf('GPR'), mi = rows[0].indexOf('month')
      const pts = rows.slice(1).map(r => ({ d: typeof r[mi] === 'number' ? new Date(Date.UTC(1899, 11, 30) + r[mi] * DAY).toISOString().slice(0, 7) : String(r[mi] || '').slice(0, 7), v: +r[hi] })).filter(p => fin(p.v) && p.d >= '1985')
      const cur = last(pts), win12 = pts.slice(-12).map(p => p.v)
      return { v: r1(cur.v), d: cur.d, avg12: r1(mean(win12)), vsAvg12: r1(chg(cur.v, mean(win12))), pct: pctile(pts.map(p => p.v), cur.v), spark: pts.slice(-36).map(p => r1(p.v)) }
    } catch (e) { console.warn('fx GPR:', e.message); return null }
  }

  // ── weekly returns, betas ─────────────────────────────────────────────────
  // sample every fifth trading day of the dependent series, look each factor up
  // on the same dates (nearest earlier date if the factor has a holiday)
  const weeklyReturns = (series, dates) => {
    const m = new Map(series.map(p => [p.d, p.v])); const keys = series.map(p => p.d)
    const at = d => { if (m.has(d)) return m.get(d); let lo = 0, hi = keys.length - 1, best = null; while (lo <= hi) { const mid = (lo + hi) >> 1; if (keys[mid] <= d) { best = keys[mid]; lo = mid + 1 } else hi = mid - 1 } return best ? m.get(best) : null }
    const vals = dates.map(at); const out = []
    for (let i = 1; i < vals.length; i++) out.push(fin(vals[i]) && fin(vals[i - 1]) && vals[i - 1] !== 0 ? vals[i] / vals[i - 1] - 1 : null)
    return out
  }
  const stats = (y, x) => {
    const pairs = y.map((v, i) => [v, x[i]]).filter(([a, b]) => fin(a) && fin(b))
    if (pairs.length < 30) return { beta: null, corr: null, n: pairs.length }
    const my = mean(pairs.map(p => p[0])), mx = mean(pairs.map(p => p[1]))
    let cov = 0, vx = 0, vy = 0
    for (const [a, b] of pairs) { cov += (a - my) * (b - mx); vx += (b - mx) ** 2; vy += (a - my) ** 2 }
    return { beta: vx ? r2(cov / vx) : null, corr: vx && vy ? r2(cov / Math.sqrt(vx * vy)) : null, n: pairs.length }
  }

  async function build() {
    const t0 = Date.now()
    const esr = ref('imf-esr.json'), stance = ref('cb-stance.json')
    const [cb, pulse, pppT, caT, cpiT, gT, geo] = await Promise.all([
      fetchCbRates().catch(() => ({})), intlPulse().catch(() => null),
      imf('PPPEX'), imf('BCA_NGDPD'), imf('PCPIPCH'), imf('NGDP_RPCH'), gpr(),
    ])
    const pulseRows = pulse?.rows || [], bigmac = pulse?.bigmac || []
    const pulseRow = code => pulseRows.find(r => r.code === code) || null

    // globals (FRED throttles itself)
    const [spx, wti, vix, hy, copper, us10, usReer, usBs] = [await F('SP500', 800), await F('DCOILWTICO', 800), await F('VIXCLS', 800), await F('BAMLH0A0HYM2', 800), await F('PCOPPUSDM', 36), await F('DGS10', 60), await F('RBUSBIS', 300), await F('WALCL', 120)]
    const dates = spx.filter((_, i) => (spx.length - 1 - i) % 5 === 0).map(p => p.d).slice(-105) // ~2 years of weekly points ending on the last trading day
    const spxW = weeklyReturns(spx, dates), wtiW = weeklyReturns(wti, dates)
    const lastN = (s, n) => (s.length > n ? s[s.length - 1 - n] : null)
    const pct3m = s => chg(last(s)?.v, lastN(s, 63)?.v), pct12m = s => chg(last(s)?.v, lastN(s, 252)?.v)
    const yoyLevel = (s, per) => (s.length > per ? chg(last(s).v, s[s.length - 1 - per].v) : null)
    const reerDev = (s, months) => { const m = asc(s); const win = m.slice(-months).map(p => p.v); const now = last(m); return now && win.length >= months * 0.8 ? { v: r1(now.v), d: now.d, dev: r1(chg(now.v, mean(win))) } : null }
    const usReer10 = reerDev(usReer, 120), usReer20 = reerDev(usReer, 240)
    const usInfl = weo(cpiT, 'USA'), usCa = weo(caT, 'USA')
    const usRow = pulseRow('US')
    const us10Now = last(us10)?.v ?? null, us10Prev3 = lastN(us10, 3)?.v ?? null, us10Prev12 = lastN(us10, 12)?.v ?? null
    const usPolicy = fin(cb?.US?.rate) ? cb.US.rate : null
    const usBsYoy = yoyLevel(usBs, 52)
    const usEsr = esr?.economies?.USA || null

    // ── the regime: four global drivers, each with a direction ──────────────
    const world = { g: weo(gT, 'WEOWORLD', YEAR), gPrev: weo(gT, 'WEOWORLD', YEAR - 1) }
    const vixNow = last(vix)?.v ?? null, vix3m = lastN(vix, 63)?.v ?? null
    const hyNow = last(hy)?.v ?? null, hy3m = lastN(hy, 63)?.v ?? null
    const copper3m = copper.length > 3 ? chg(last(copper).v, copper[copper.length - 4].v) : null
    // growth: the WEO's revision to this year against last, plus copper — two votes, direction when they agree or one abstains
    const growthVotes = (world.g && world.gPrev ? Math.sign(r1(world.g.v - world.gPrev.v)) : 0) + (fin(copper3m) ? Math.sign(copper3m - 2) : 0)
    const regime = {
      growth: { world: world.g ? r1(world.g.v) : null, worldPrev: world.gPrev ? r1(world.gPrev.v) : null, year: world.g?.y ?? null, copper3m: r1(copper3m), spx3m: r1(pct3m(spx)), dir: growthVotes >= 1 ? 1 : growthVotes <= -1 ? -1 : 0 },
      commodities: { wti: r2(last(wti)?.v), wti3m: r1(pct3m(wti)), wti12m: r1(pct12m(wti)), copper3m: r1(copper3m), dir: fin(pct3m(wti)) ? (pct3m(wti) > 5 ? 1 : pct3m(wti) < -5 ? -1 : 0) : 0 },
      risk: { vix: r1(vixNow), vix3m: r1(vixNow - vix3m), hy: r2(hyNow), hy3m: r2(hyNow - hy3m), spx3m: r1(pct3m(spx)),
        dir: (fin(vixNow) && fin(vix3m) && vixNow - vix3m > 3) || (fin(hyNow) && fin(hy3m) && hyNow - hy3m > 0.4) ? 1 : (fin(vixNow) && fin(vix3m) && vixNow - vix3m < -3) || (fin(hyNow) && fin(hy3m) && hyNow - hy3m < -0.4) ? -1 : 0 },
      geopolitics: geo ? { ...geo, dir: fin(geo.vsAvg12) ? (geo.vsAvg12 > 15 ? 1 : geo.vsAvg12 < -15 ? -1 : 0) : 0 } : { dir: 0 },
    }

    const out = []
    for (const c of CURRENCIES) {
      const [fxRaw, reerRaw, y10Raw, cbFredRaw, bsRaw] = [await F(c.fred, 800), await F(c.reer, 300), await F(c.y10, 60), await F(c.cbFred, 24), await F(c.bs, 120)]
      // everything is expressed as dollars per unit, so up = the currency strengthening
      const fx = asc(fxRaw).map(p => ({ d: p.d, v: c.usdPer ? p.v : 1 / p.v })).filter(p => fin(p.v) && p.v > 0)
      const spot = last(fx)
      if (!spot) { out.push({ ccy: c.ccy, name: c.name, flag: c.flag, error: 'no spot' }); continue }
      const localPerUsd = 1 / spot.v
      const fxW = weeklyReturns(fx, dates)
      const risk = stats(fxW.slice(-52), spxW.slice(-52)), cmdty = stats(fxW.slice(-52), wtiW.slice(-52))
      const pr = c.pulse ? pulseRow(c.pulse) : null

      // ── valuation lenses, positive = cheap against the dollar ──
      const ppp = (c.pppIso || [c.iso3]).map(i => weo(pppT, i)).find(Boolean) || null
      const pppUnder = ppp && ppp.v > 0 ? (localPerUsd / ppp.v - 1) * 100 : null
      const bm = bigmac.find(b => b.ccy === c.ccy) || null
      const bmAdj = bm && fin(bm.adjNow) ? -bm.adjNow : bm && fin(bm.adj) ? -bm.adj : null
      const bmRaw = bm && fin(bm.rawNow) ? -bm.rawNow : bm && fin(bm.raw) ? -bm.raw : null
      const reer10 = reerDev(reerRaw, 120), reer20 = reerDev(reerRaw, 240)
      const reerVsUsd = reer10 && usReer10 ? -(reer10.dev - usReer10.dev) : null
      const e = esr?.economies?.[c.iso3] || null
      const imfVsUsd = e && usEsr ? usEsr.reerGap - e.reerGap : null
      const lenses = { ppp: r1(pppUnder), bigMac: r1(bmAdj), reer: r1(reerVsUsd), imf: r1(imfVsUsd) }
      // raw PPP flatters every poorer economy (Balassa-Samuelson), so for the EM
      // five it is shown but left out of the composite; the GDP-adjusted Big Mac
      // is the PPP lens that survives there
      const inComposite = c.em ? [lenses.bigMac, lenses.reer, lenses.imf] : Object.values(lenses)
      const under = median(inComposite)
      const spread = inComposite.filter(fin)
      const verdict = !fin(under) ? 'no read' : under > 10 ? 'undervalued' : under < -10 ? 'overvalued' : 'near fair value'

      // ── domestic drivers vs the dollar ──
      const y10 = asc(y10Raw), y10Now = last(y10)?.v ?? null
      const diff = fin(y10Now) && fin(us10Now) ? y10Now - us10Now : null
      const diff3m = fin(diff) && fin(lastN(y10, 3)?.v) && fin(us10Prev3) ? diff - (lastN(y10, 3).v - us10Prev3) : null
      const diff12m = fin(diff) && fin(lastN(y10, 12)?.v) && fin(us10Prev12) ? diff - (lastN(y10, 12).v - us10Prev12) : null
      const infl = weo(cpiT, c.iso3 === 'EUZ' ? 'EUZ' : c.iso3) || (c.iso3 === 'EUZ' ? weo(cpiT, 'DEU') : null)
      const inflFresh = pr?.cpi?.v ?? null
      const inflV = fin(inflFresh) ? inflFresh : infl?.v ?? null
      const realDiff = fin(diff) && fin(inflV) && fin(usInfl?.v) ? (y10Now - inflV) - (us10Now - usInfl.v) : null
      const policy = fin(cb?.[c.cb]?.rate) ? { v: cb[c.cb].rate, d: cb[c.cb].date, src: cb[c.cb].source } : cbFredRaw.length ? { v: last(asc(cbFredRaw)).v, d: last(asc(cbFredRaw)).d, src: 'FRED' } : pr?.policy ? { v: pr.policy.v, d: pr.policy.d, src: pr.policy.src } : null
      const policyDiff = policy && fin(usPolicy) ? policy.v - usPolicy : null
      const bsYoy = c.bs ? yoyLevel(asc(bsRaw), c.bsFreq) : null
      const bsRel = fin(bsYoy) && fin(usBsYoy) ? bsYoy - usBsYoy : null
      const st = stance?.banks?.[c.ccy] || null
      const mon = {
        expectations: fin(diff3m) ? (diff3m > 0.25 ? 1 : diff3m < -0.25 ? -1 : 0) : 0,
        real: fin(realDiff) ? (realDiff > 1 ? 1 : realDiff < -1 ? -1 : 0) : 0,
        balanceSheet: fin(bsRel) ? (bsRel < -5 ? 1 : bsRel > 5 ? -1 : 0) : 0,
        stance: st ? st.stance : 0,
      }
      const monetary = mon.expectations + mon.real + mon.balanceSheet + mon.stance
      const eqRel = pr?.eq && usRow?.eq && fin(pr.eq.usdYtd) && fin(usRow.eq.ytd) ? pr.eq.usdYtd - usRow.eq.ytd : null
      const eqRel1y = pr?.eq && usRow?.eq && fin(pr.eq.usd1y) && fin(usRow.eq.r1y) ? pr.eq.usd1y - usRow.eq.r1y : null
      const flows = fin(eqRel) ? (eqRel > 5 ? 1 : eqRel < -5 ? -1 : 0) : 0
      const ca = weo(caT, c.iso3) || (c.iso3 === 'EUZ' ? weo(caT, 'DEU') : null)
      const caLevel = ca ? (ca.v > 2 ? 1 : ca.v < -2 ? -1 : 0) : 0
      const cmdtySens = fin(cmdty.corr) ? (cmdty.corr > 0.25 ? 1 : cmdty.corr < -0.25 ? -1 : 0) : 0
      const tot = cmdtySens && fin(regime.commodities.wti3m) && Math.abs(regime.commodities.wti3m) > 5 ? cmdtySens * Math.sign(regime.commodities.wti3m) : 0
      const trade = caLevel + tot
      const tilt = monetary + flows + trade
      const riskSens = fin(risk.corr) ? (risk.corr > 0.3 ? 1 : risk.corr < -0.3 ? -1 : 0) : 0
      const global = {
        growth: regime.growth.dir * riskSens,
        commodities: regime.commodities.dir * cmdtySens,
        risk: regime.risk.dir * (riskSens ? -riskSens : c.haven ? 1 : 0),
        geopolitics: regime.geopolitics.dir * (c.haven ? 1 : c.em ? -1 : 0),
      }
      const globalTilt = global.growth + global.commodities + global.risk + global.geopolitics

      out.push({
        ccy: c.ccy, name: c.name, flag: c.flag, iso3: c.iso3, haven: !!c.haven, em: !!c.em,
        spot: { usdQuoted: !!c.usdPer, usdPer: r2(spot.v) === 0 ? +spot.v.toFixed(5) : r2(spot.v), localPerUsd: localPerUsd >= 100 ? r1(localPerUsd) : +localPerUsd.toFixed(4), d: spot.d, chg1m: r1(chg(spot.v, lastN(fx, 21)?.v)), chg3m: r1(pct3m(fx)), chg12m: r1(pct12m(fx)), spark: fx.slice(-252).filter((_, i) => i % 5 === 0).map(p => +p.v.toFixed(5)) },
        valuation: { under: r1(under), verdict, low: r1(Math.min(...spread)), high: r1(Math.max(...spread)), n: spread.length, lenses, pppExcluded: !!c.em,
          detail: { ppp: ppp ? { rate: r2(ppp.v), year: ppp.y } : null, bigMac: bm ? { adj: r1(bm.adjNow ?? bm.adj), raw: r1(bm.rawNow ?? bm.raw), rawUnder: r1(bmRaw) } : null,
            reer: reer10 ? { v: reer10.v, d: reer10.d, vs10y: reer10.dev, vs20y: reer20?.dev ?? null, usVs10y: usReer10?.dev ?? null } : null,
            imf: e ? { gap: e.reerGap, range: e.reerRange, assessment: e.assessment, caGap: e.caGap, usGap: usEsr?.reerGap ?? null } : null } },
        sensitivity: { riskBeta: risk.beta, riskCorr: risk.corr, cmdtyBeta: cmdty.beta, cmdtyCorr: cmdty.corr, weeks: risk.n },
        global: { ...global, tilt: globalTilt },
        domestic: {
          policy: policy ? { v: r2(policy.v), d: policy.d, src: policy.src, diff: r2(policyDiff) } : null,
          y10: fin(y10Now) ? { v: r2(y10Now), d: last(y10).d, diff: r2(diff), diff3m: r2(diff3m), diff12m: r2(diff12m) } : null,
          inflation: fin(inflV) ? { v: r1(inflV), src: fin(inflFresh) ? `monthly ${pr.cpi.d}` : `IMF WEO ${infl?.y}` } : null,
          realDiff: r2(realDiff),
          balanceSheet: fin(bsYoy) ? { yoy: r1(bsYoy), fedYoy: r1(usBsYoy), rel: r1(bsRel) } : null,
          stance: st ? { stance: st.stance, label: st.label, bank: st.bank, note: st.note } : null,
          eqRel: r1(eqRel), eqRel1y: r1(eqRel1y),
          ca: ca ? { v: r1(ca.v), year: ca.y } : null,
          scores: { monetary: { ...mon, total: monetary }, flows, trade: { level: caLevel, termsOfTrade: tot, total: trade }, tilt },
          tiltLabel: tilt >= 3 ? 'bullish' : tilt <= -3 ? 'bearish' : tilt > 0 ? 'mildly bullish' : tilt < 0 ? 'mildly bearish' : 'neutral',
        },
      })
    }

    const good = out.filter(r => !r.error)
    const avgUnder = mean(good.map(r => r.valuation.under))
    const usd = {
      imf: usEsr ? { gap: usEsr.reerGap, range: usEsr.reerRange, assessment: usEsr.assessment, caGap: usEsr.caGap } : null,
      reer: usReer10 ? { v: usReer10.v, d: usReer10.d, vs10y: usReer10.dev, vs20y: usReer20?.dev ?? null } : null,
      basketOver: r1(avgUnder), // the average cheapness of the fourteen is the dollar's richness
      policy: fin(usPolicy) ? r2(usPolicy) : null, y10: r2(us10Now), inflation: usInfl ? r1(usInfl.v) : null, ca: usCa ? r1(usCa.v) : null, bsYoy: r1(usBsYoy),
      reerPct: usRow?.reer?.pct ?? null, dollarScore: pulse?.scores?.dollar?.score ?? null,
    }
    const cheapest = [...good].filter(r => fin(r.valuation.under)).sort((a, b) => b.valuation.under - a.valuation.under)
    return {
      ts: Date.now(), built: new Date().toISOString(), buildSecs: Math.round((Date.now() - t0) / 1000), ttlHours: TTL / H,
      currencies: out, usd, regime,
      headline: { cheapest: cheapest.slice(0, 3).map(r => ({ ccy: r.ccy, under: r.valuation.under })), richest: cheapest.slice(-3).reverse().map(r => ({ ccy: r.ccy, under: r.valuation.under })), bullish: good.filter(r => r.domestic.scores.tilt >= 3).map(r => r.ccy), bearish: good.filter(r => r.domestic.scores.tilt <= -3).map(r => r.ccy) },
      esr: esr ? { report: esr.report, published: esr.published, dataYear: esr.dataYear, url: esr.url } : null,
      stanceReviewed: stance?.reviewed || null,
      source: 'FRED (H.10 daily exchange rates, BIS real effective exchange rates, OECD long-term yields, Fed/ECB/BoJ balance sheets, S&P 500, WTI, VIX, HY OAS, copper); IMF DataMapper (WEO implied PPP conversion rates, current account, inflation, world growth); IMF External Sector Report 2026 (staff-assessed REER gaps, 2025 data); The Economist Big Mac index via the International pulse feed; Caldara–Iacoviello Geopolitical Risk index; policy rates from the dashboard\'s central-bank rates route. Central-bank preferences are the dashboard\'s own dated judgment, not data.',
    }
  }

  async function get() {
    if (mem && Date.now() - mem.ts < TTL) return mem
    if (!mem) { const disk = load('fx-fundamentals.json'); if (disk && Date.now() - disk.ts < TTL) { mem = disk; return mem } }
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const d = await build()
        const complete = d.currencies.filter(r => !r.error).length >= 12 && d.currencies.filter(r => fin(r.valuation?.under)).length >= 10
        if (!complete) { console.warn('fx fundamentals: incomplete build, not cached'); const disk = mem || load('fx-fundamentals.json'); if (disk) return disk; return d }
        mem = d; save('fx-fundamentals.json', d); return d
      } catch (e) { console.warn('fx fundamentals build:', e.message); const disk = mem || load('fx-fundamentals.json'); if (disk) return disk; throw e }
      finally { inflight = null }
    })()
    return inflight
  }

  return { get, CURRENCIES }
}
