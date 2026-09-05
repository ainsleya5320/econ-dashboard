// ============================================================================
// COMMODITIES PULSE — the Commodities tab's landing feed
// Fifteen contracts on one board: the tape (price, YTD, 1y, distance from the
// 200-day, place in the 52-week range), a REAL-price fair-value read (each
// commodity's inflation-adjusted price ranked against its own history since
// 1992 — IMF monthly prices via FRED; Yahoo monthly futures for the precious
// metals, which the IMF does not publish), and speculative positioning (CFTC
// non-commercial net position as % of open interest, ranked over three
// years). Three 0–100 scores: momentum breadth, real-price value, macro
// tailwind (dollar, real yields, breakevens, copper/gold). Context charts:
// the real all-commodity index since 1992, gold vs the real 10-year, and
// copper/gold vs the 10-year. Cached 1h, disk-backed (commodity-pulse.json).
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 60 * 60 * 1000, TTL = 1 * H
const fin = v => v != null && Number.isFinite(v)
const last = a => (a && a.length ? a[a.length - 1] : null)
const r1 = v => (fin(v) ? +v.toFixed(1) : null), r2 = v => (fin(v) ? +v.toFixed(2) : null)
const mean = xs => { const v = (xs || []).filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const median = xs => { const v = (xs || []).filter(fin).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null }
const pctile = (arr, val) => { const xs = (arr || []).filter(fin); if (!xs.length || !fin(val)) return null; return Math.round((xs.filter(x => x <= val).length / xs.length) * 100) }
const chg = (a, b) => (fin(a) && fin(b) && b !== 0 ? ((a / b) - 1) * 100 : null)
const monthly = obs => { const m = new Map(); for (const p of obs || []) if (fin(p.v)) m.set(p.d.slice(0, 7), p.v); return [...m].map(([d, v]) => ({ d, v })) }
const at = (arr, d) => { let v = null; for (const p of arr) { if (p.d <= d) v = p.v; else break } return v }
const iso = ts => new Date(ts).toISOString().slice(0, 10)

// IMF primary-commodity prices on FRED (monthly averages since 1992)
const IMF = { 'CL=F': 'POILWTIUSDM', 'BZ=F': 'POILBREUSDM', 'NG=F': 'PNGASUSUSDM', 'HG=F': 'PCOPPUSDM', 'ZC=F': 'PMAIZMTUSDM', 'ZW=F': 'PWHEAMTUSDM', 'ZS=F': 'PSOYBUSDM', 'CT=F': 'PCOTTINDUSDM', 'KC=F': 'PCOFFOTMUSDM', 'CC=F': 'PCOCOUSDM', 'SB=F': 'PSUGAISAUSDM' }
const YAHOO_MONTHLY = ['GC=F', 'SI=F', 'PL=F', 'PA=F']
const INDEXES = { all: 'PALLFNFINDEXM', nonfuel: 'PNFUELINDEXM', food: 'PFOODINDEXM', metals: 'PMETAINDEXM' }
// CFTC contract codes (verified against the disaggregated report, 2026-09); Brent trades on ICE Europe and has no CFTC report
const COT = { 'CL=F': '067651', 'NG=F': '03565B', 'GC=F': '088691', 'SI=F': '084691', 'HG=F': '085692', 'PL=F': '076651', 'PA=F': '075651', 'ZC=F': '002602', 'ZW=F': '001602', 'ZS=F': '005602', 'CT=F': '033661', 'KC=F': '083731', 'CC=F': '073732', 'SB=F': '080732' }

export function createCommodityPulse({ fetchFredSeries, fetchYahooSparkline, fetchCommoditySpot, UA, dir }) {
  const FILE = path.join(dir, 'commodity-pulse.json')
  let mem = null, inflight = null
  const load = () => { try { if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch {} return null }
  const save = o => { try { fs.writeFileSync(FILE, JSON.stringify(o)) } catch (e) { console.error('commodity-pulse save:', e.message) } }
  const batched = async (items, fn, size = 6) => { const out = []; for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(x => fn(x).catch(() => null)))); return out }

  async function fetchCot() {
    const since = new Date(Date.now() - 3 * 365.25 * 864e5).toISOString().slice(0, 10)
    const codes = Object.values(COT).map(c => `'${c}'`).join(',')
    const where = `cftc_contract_market_code in(${codes}) AND report_date_as_yyyy_mm_dd>'${since}'`
    const select = 'report_date_as_yyyy_mm_dd,cftc_contract_market_code,open_interest_all,noncomm_positions_long_all,noncomm_positions_short_all'
    const url = `https://publicreporting.cftc.gov/resource/jun7-fc8e.json?$where=${encodeURIComponent(where)}&$select=${encodeURIComponent(select)}&$order=${encodeURIComponent('report_date_as_yyyy_mm_dd ASC')}&$limit=5000`
    const r = await fetch(url, { headers: { 'User-Agent': UA } })
    if (!r.ok) throw new Error(`CFTC HTTP ${r.status}`)
    const by = {}
    for (const row of await r.json()) {
      const oi = +row.open_interest_all
      if (!(oi > 0)) continue
      ;(by[row.cftc_contract_market_code] = by[row.cftc_contract_market_code] || []).push({ d: row.report_date_as_yyyy_mm_dd.slice(0, 10), net: ((+row.noncomm_positions_long_all - +row.noncomm_positions_short_all) / oi) * 100 })
    }
    return by
  }
  // price series in today's dollars
  const deflate = (m, cpi) => { const now = last(cpi)?.v; return now ? m.map(p => { const c = at(cpi, p.d); return c ? { d: p.d, v: p.v * (now / c) } : null }).filter(Boolean) : [] }

  async function build() {
    const spots = await fetchCommoditySpot()
    const F = (id, n) => fetchFredSeries(id, n)
    const cpi = monthly(await F('CPIAUCSL', 500))
    const dfii = await F('DFII10', 2700), bkeven = await F('T10YIE', 2700), dxy = await F('DTWEXBGS', 2700), dgs10 = await F('DGS10', 2700)
    const imf = {}
    for (const id of [...new Set([...Object.values(IMF), ...Object.values(INDEXES)])]) imf[id] = monthly(await F(id, 500))
    const daily = await batched(spots, s => fetchYahooSparkline(s.symbol, '1y', '1d'))
    const metalsM = await batched(YAHOO_MONTHLY, s => fetchYahooSparkline(s, 'max', '1mo'))
    const [goldW, copperW] = await Promise.all([fetchYahooSparkline('GC=F', '10y', '1wk').catch(() => []), fetchYahooSparkline('HG=F', '10y', '1wk').catch(() => [])])
    const cot = await fetchCot().catch(e => { console.warn('CFTC:', e.message); return {} })
    const yearStart = Date.UTC(new Date().getUTCFullYear(), 0, 1)

    const rows = spots.map((s, i) => {
      const dd = (daily[i] || []).filter(p => fin(p.v) && p.v > 0)
      const closes = dd.map(p => p.v), lastV = fin(s.price) ? s.price : last(closes)
      const ret = n => (closes.length > n ? chg(lastV, closes[closes.length - 1 - n]) : null)
      const ytd0 = dd.find(p => p.ts >= yearStart)
      const ma200 = closes.length >= 200 ? mean(closes.slice(-200)) : null
      const hi = closes.length ? Math.max(...closes, lastV) : null, lo = closes.length ? Math.min(...closes, lastV) : null
      // real price: monthly nominal series → today's dollars → rank; "now" scales the last month by the spot move since then
      let nomM = [], realSrc = ''
      if (IMF[s.symbol]) { nomM = imf[IMF[s.symbol]] || []; realSrc = `IMF monthly average, since ${nomM[0]?.d?.slice(0, 4)}` }
      else { const j = YAHOO_MONTHLY.indexOf(s.symbol); nomM = monthly((metalsM[j] || []).map(p => ({ d: iso(p.ts), v: p.v }))); realSrc = `front-month futures, monthly, since ${nomM[0]?.d?.slice(0, 4)}` }
      const real = deflate(nomM, cpi)
      const lastM = last(real)
      const closeAtMonthEnd = lastM ? (dd.filter(p => iso(p.ts).slice(0, 7) <= lastM.d).slice(-1)[0]?.v ?? null) : null
      const sinceM = closeAtMonthEnd ? chg(lastV, closeAtMonthEnd) : 0
      const realNow = lastM ? lastM.v * (1 + (sinceM || 0) / 100) : null
      const vals = real.map(p => p.v)
      const c = cot[COT[s.symbol]]
      let pos = null
      if (c && c.length > 20) { const cur = last(c); const nets = c.map(p => p.net); const pct = pctile(nets, cur.net); pos = { net: r1(cur.net), pct, chg13: r1(c.length > 13 ? cur.net - c[c.length - 14].net : null), d: cur.d, flag: pct >= 90 ? 'crowded long' : pct <= 10 ? 'crowded short' : null } }
      return {
        symbol: s.symbol, name: s.name, unit: s.unit, icon: s.icon, group: s.group, color: s.color,
        price: r2(lastV), day: r2(fin(s.changePct) ? s.changePct * 100 : null), ytd: r1(ytd0 ? chg(lastV, ytd0.v) : null), r1m: r1(ret(21)), r3m: r1(ret(63)), r6m: r1(ret(126)), r1y: r1(closes.length ? chg(lastV, closes[0]) : null),
        vs200: r1(ma200 ? chg(lastV, ma200) : null), pos52: r1(hi != null && hi > lo ? ((lastV - lo) / (hi - lo)) * 100 : null), hi52: r2(hi), lo52: r2(lo),
        spark: closes.filter((_, k) => k % 5 === 0 || k === closes.length - 1).map(v => r2(v)),
        real: lastM ? { now: r2(realNow), pct: pctile(vals, realNow), pct10y: pctile(vals.slice(-120), realNow), median20y: r2(median(vals.slice(-240))), vsMedian20y: r1(chg(realNow, median(vals.slice(-240)))), min: r2(Math.min(...vals)), max: r2(Math.max(...vals)), n: vals.length, since: real[0].d.slice(0, 4), asOf: lastM.d, src: realSrc, unit: IMF[s.symbol] ? 'IMF units' : s.unit } : null,
        cot: pos,
      }
    })

    // ── indexes (real, in today's dollars, rebased so the since-1992 average = 100) ──
    const realIdx = Object.fromEntries(Object.entries(INDEXES).map(([k, id]) => [k, deflate(imf[id] || [], cpi)]))
    const base = Object.fromEntries(Object.entries(realIdx).map(([k, s]) => [k, mean(s.map(p => p.v))]))
    const months = realIdx.all.map(p => p.d)
    const indexChart = months.map(d => { const row = { d }; for (const k of Object.keys(realIdx)) { const v = realIdx[k].find(p => p.d === d)?.v; row[k] = fin(v) && base[k] ? r1((v / base[k]) * 100) : null } return row })
    const indexNow = Object.fromEntries(Object.entries(realIdx).map(([k, s]) => [k, { pct: pctile(s.map(p => p.v), last(s)?.v), vsAvg: r1(chg(last(s)?.v, base[k])), asOf: last(s)?.d || null }]))

    // ── macro ──
    const wk = (obs) => { const m = new Map(); for (const p of obs) if (fin(p.v)) m.set(iso(p.ts ?? Date.parse(p.d)), p.v); return m }
    const goldWk = (goldW || []).filter(p => fin(p.v)).map(p => ({ d: iso(p.ts), v: p.v })), copperWk = (copperW || []).filter(p => fin(p.v)).map(p => ({ d: iso(p.ts), v: p.v }))
    const dfiiD = dfii.filter(p => fin(p.v)), dgsD = dgs10.filter(p => fin(p.v))
    const goldReal = goldWk.map(p => ({ d: p.d, gold: r1(p.v), realYield: r2(at(dfiiD, p.d)) }))
    const copperGold = goldWk.map(p => { const cu = at(copperWk, p.d); return cu ? { d: p.d, ratio: r2((cu / p.v) * 1000), y10: r2(at(dgsD, p.d)) } : null }).filter(Boolean)
    const cgNow = last(copperGold)?.ratio ?? null, cg6m = copperGold.length > 26 ? copperGold[copperGold.length - 27].ratio : null
    const dxyNow = last(dxy)?.v ?? null, dxyM = monthly(dxy), dxyYoy = dxyM.length > 12 ? chg(last(dxyM).v, dxyM[dxyM.length - 13].v) : null, dxyPct = pctile(dxy.map(p => p.v), dxyNow)
    const dfiiNow = last(dfiiD)?.v ?? null, dfiiPct = pctile(dfiiD.map(p => p.v), dfiiNow)
    const bkNow = last(bkeven)?.v ?? null, bkPct = pctile(bkeven.map(p => p.v), bkNow)
    const gold = rows.find(r => r.symbol === 'GC=F'), oil = rows.find(r => r.symbol === 'CL=F')
    const goldOil = gold?.price && oil?.price ? gold.price / oil.price : null

    // ── scores ──
    const above200 = rows.filter(r => fin(r.vs200)); const shareAbove = above200.length ? (above200.filter(r => r.vs200 > 0).length / above200.length) * 100 : null
    const six = rows.filter(r => fin(r.r6m)); const sharePos6 = six.length ? (six.filter(r => r.r6m > 0).length / six.length) * 100 : null
    const momentum = Math.round(mean([shareAbove, sharePos6]) ?? 50)
    const realPcts = rows.map(r => r.real?.pct).filter(fin)
    const value = Math.round(100 - (mean(realPcts) ?? 50))
    const cgScore = fin(cgNow) && fin(cg6m) ? Math.max(0, Math.min(100, ((chg(cgNow, cg6m) + 20) / 40) * 100)) : null
    const macro = Math.round(mean([fin(dxyPct) ? 100 - dxyPct : null, fin(dfiiPct) ? 100 - dfiiPct : null, bkPct, cgScore]) ?? 50)
    const tone = s => (s >= 60 ? 'green' : s >= 40 ? 'amber' : 'red')
    const names = f => rows.filter(f).map(r => r.name)
    const crowdedL = names(r => r.cot?.flag === 'crowded long'), crowdedS = names(r => r.cot?.flag === 'crowded short')
    const scores = {
      momentum: { score: momentum, tone: tone(momentum), label: momentum >= 60 ? 'Broad commodity upcycle' : momentum >= 40 ? 'Mixed tape' : 'Broad downcycle', why: `${fin(shareAbove) ? `${Math.round(shareAbove)}% of contracts above their 200-day` : 'n/a'}, ${fin(sharePos6) ? `${Math.round(sharePos6)}% up over six months` : ''}. Leaders: ${names(r => r.r6m > 15).join(', ') || 'none'}; laggards: ${names(r => r.r6m < -10).join(', ') || 'none'}.`, shareAbove: r1(shareAbove), sharePos6: r1(sharePos6) },
      value: { score: value, tone: tone(value), label: value >= 60 ? 'Real prices cheap vs history' : value >= 40 ? 'Real prices near normal' : 'Real prices rich vs history', why: `Average inflation-adjusted price sits at the ${Math.round(mean(realPcts) ?? 0)}th percentile of each commodity's own history (IMF monthly since 1992; futures for the precious metals). Richest: ${[...rows].filter(r => r.real).sort((a, b) => b.real.pct - a.real.pct).slice(0, 3).map(r => `${r.name} p${r.real.pct}`).join(', ')}; cheapest: ${[...rows].filter(r => r.real).sort((a, b) => a.real.pct - b.real.pct).slice(0, 3).map(r => `${r.name} p${r.real.pct}`).join(', ')}.`, avgPct: r1(mean(realPcts)) },
      macro: { score: macro, tone: tone(macro), label: macro >= 60 ? 'Macro tailwind' : macro >= 40 ? 'Macro neutral' : 'Macro headwind', why: `Dollar ${fin(dxyNow) ? `${dxyNow.toFixed(1)} (${dxyYoy >= 0 ? '+' : ''}${dxyYoy?.toFixed(1)}% YoY, p${dxyPct} of 10y)` : 'n/a'}; real 10-year ${fin(dfiiNow) ? `${dfiiNow.toFixed(2)}% (p${dfiiPct})` : 'n/a'}; breakeven inflation ${fin(bkNow) ? `${bkNow.toFixed(2)}% (p${bkPct})` : 'n/a'}; copper/gold ${fin(cgNow) ? `${cgNow.toFixed(2)} (${chg(cgNow, cg6m) >= 0 ? '+' : ''}${chg(cgNow, cg6m)?.toFixed(0)}% in six months)` : 'n/a'}. A weaker dollar, lower real yields and rising breakevens are the classic commodity tailwinds; copper/gold falling while gold runs is the market pricing safety over growth.`, dxy: r2(dxyNow), dxyYoy: r1(dxyYoy), dxyPct, realYield: r2(dfiiNow), realYieldPct: dfiiPct, breakeven: r2(bkNow), breakevenPct: bkPct, copperGold: r2(cgNow), copperGoldChg6m: r1(chg(cgNow, cg6m)), goldOil: r1(goldOil) },
      positioning: { crowdedLong: crowdedL, crowdedShort: crowdedS, why: crowdedL.length || crowdedS.length ? `Speculators are crowded long in ${crowdedL.join(', ') || 'nothing'} and crowded short in ${crowdedS.join(', ') || 'nothing'} (top/bottom decile of three years) — the setups that reverse on news.` : 'No contract sits in the top or bottom decile of its three-year positioning range.' },
    }
    const tones = [scores.momentum.tone, scores.value.tone, scores.macro.tone]
    const overallTone = tones.filter(t => t === 'red').length >= 2 ? 'red' : tones.includes('red') || tones.filter(t => t === 'amber').length >= 2 ? 'amber' : 'green'
    const overall = { tone: overallTone, label: overallTone === 'green' ? 'Commodities in favor' : overallTone === 'amber' ? 'Selective, not a super-cycle' : 'Commodities out of favor', sentence: `${scores.momentum.label}; ${scores.value.label.toLowerCase()}; ${scores.macro.label.toLowerCase()}.` }
    const groups = [...new Set(rows.map(r => r.group))].map(g => { const rs = rows.filter(r => r.group === g); return { group: g, n: rs.length, ytd: r1(mean(rs.map(r => r.ytd))), r1y: r1(mean(rs.map(r => r.r1y))), realPct: Math.round(mean(rs.map(r => r.real?.pct)) ?? 0) } })

    return { rows, groups, scores, overall, indexNow, charts: { realIndex: indexChart, goldReal: goldReal.slice(-520), copperGold: copperGold.slice(-520) }, cotAsOf: last(Object.values(cot)[0] || [])?.d || null, updated: new Date().toISOString() }
  }

  async function get() {
    if (mem && Date.now() - mem.ts < TTL) return mem.data
    const disk = mem || load()
    if (disk && Date.now() - disk.ts < TTL) { mem = disk; return disk.data }
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const data = await build()
        const ok = data.rows.filter(r => fin(r.r1y)).length >= 12 && data.rows.filter(r => r.real).length >= 12
        if (ok) { mem = { data, ts: Date.now() }; save(mem); return data }
        console.warn('commodity-pulse: incomplete build, not caching'); return disk?.data || data
      } catch (e) { console.warn('commodity-pulse:', e.message); if (disk) return disk.data; throw e }
      finally { inflight = null }
    })()
    return inflight
  }
  return { get }
}
