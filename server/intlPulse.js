// ============================================================================
// INTERNATIONAL PULSE — the International tab's landing feed
// Thirteen economies on one board (equity in local and USD terms, currency,
// policy and 10-year rates, real yield where inflation is fresh, unemployment,
// GDP momentum, BIS real effective exchange rate vs its 10-year average, and
// The Economist's Big Mac valuation), three 0–100 scores (dollar, risk
// appetite, growth breadth) with verdicts, and the Big Mac index for all 54
// currencies — The Economist's July print PLUS a re-mark at today's exchange
// rates (same local burger prices, live FX from Yahoo).
// Sources: FRED (OECD/BIS/Eurostat series verified fresh 2026-09; OECD CPI
// series are NOT used because they stopped updating in 2024), Yahoo Finance
// for indexes and FX, /api/cb-rates for policy rates, and
// github.com/TheEconomist/big-mac-data (open data, CSV, twice a year).
// Cached 3 hours (Big Mac CSV 7 days), disk-backed, complete builds only.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 60 * 60 * 1000
const TTL = 3 * H, BM_TTL = 7 * 24 * H
const fin = v => v != null && Number.isFinite(v)
const last = a => (a && a.length ? a[a.length - 1] : null)
const r1 = v => (fin(v) ? +v.toFixed(1) : null), r2 = v => (fin(v) ? +v.toFixed(2) : null)
const mean = xs => { const v = (xs || []).filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const pctile = (arr, val) => { const xs = (arr || []).filter(fin); if (!xs.length || !fin(val)) return null; return Math.round((xs.filter(x => x <= val).length / xs.length) * 100) }
const chg = (a, b) => (fin(a) && fin(b) && b !== 0 ? ((a / b) - 1) * 100 : null)
function csvSplit(line) { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++ } else q = !q } else if (c === ',' && !q) { out.push(cur); cur = '' } else cur += c } out.push(cur); return out }

// fx: Yahoo symbol; invert=true means the symbol quotes USD per local unit
// (EURUSD=X) rather than local per USD (JPY=X). cb = key in /api/cb-rates;
// cbFred = monthly policy-rate fallback on FRED. cpi only where the index is
// still updating (Eurostat HICP, U.S. CPI).
export const COUNTRIES = [
  { code: 'US', name: 'United States', flag: '🇺🇸', iso3: 'USA', ccy: 'USD', fx: null, index: '^GSPC', indexName: 'S&P 500', y10: 'DGS10', unemp: 'UNRATE', cpi: 'CPIAUCSL', reer: 'RBUSBIS', gdp: { id: 'GDPC1', kind: 'level' }, cb: 'US' },
  { code: 'EA', name: 'Euro area', flag: '🇪🇺', iso3: 'EUZ', ccy: 'EUR', fx: { sym: 'EURUSD=X', invert: true }, index: '^STOXX50E', indexName: 'Euro Stoxx 50', y10: 'IRLTLT01EZM156N', unemp: null, cpi: 'CP0000EZ19M086NEST', reer: 'RBXMBIS', gdp: { id: 'CLVMNACSCAB1GQEA19', kind: 'level' }, cb: 'EU' },
  { code: 'DE', name: 'Germany', flag: '🇩🇪', iso3: 'DEU', ccy: 'EUR', fx: { sym: 'EURUSD=X', invert: true }, index: '^GDAXI', indexName: 'DAX', y10: 'IRLTLT01DEM156N', unemp: 'LRHUTTTTDEM156S', cpi: 'CP0000DEM086NEST', reer: 'RBDEBIS', gdp: { id: 'NAEXKP01DEQ657S', kind: 'qoq' }, cb: 'EU' },
  { code: 'GB', name: 'United Kingdom', flag: '🇬🇧', iso3: 'GBR', ccy: 'GBP', fx: { sym: 'GBPUSD=X', invert: true }, index: '^FTSE', indexName: 'FTSE 100', y10: 'IRLTLT01GBM156N', unemp: 'LRHUTTTTGBM156S', cpi: null, reer: 'RBGBBIS', gdp: { id: 'NAEXKP01GBQ657S', kind: 'qoq' }, cb: 'GB' },
  { code: 'JP', name: 'Japan', flag: '🇯🇵', iso3: 'JPN', ccy: 'JPY', fx: { sym: 'JPY=X' }, index: '^N225', indexName: 'Nikkei 225', y10: 'IRLTLT01JPM156N', unemp: 'LRHUTTTTJPM156S', cpi: null, reer: 'RBJPBIS', gdp: { id: 'NAEXKP01JPQ657S', kind: 'qoq' }, cb: 'JP' },
  { code: 'CN', name: 'China', flag: '🇨🇳', iso3: 'CHN', ccy: 'CNY', fx: { sym: 'CNY=X' }, index: '000001.SS', indexName: 'Shanghai Comp.', y10: null, unemp: null, cpi: null, reer: 'RBCNBIS', gdp: null, cb: null },
  { code: 'IN', name: 'India', flag: '🇮🇳', iso3: 'IND', ccy: 'INR', fx: { sym: 'INR=X' }, index: '^BSESN', indexName: 'Sensex', y10: 'INDIRLTLT01STM', unemp: null, cpi: null, reer: 'RBINBIS', gdp: { id: 'NAEXKP01INQ657S', kind: 'qoq' }, cb: null },
  { code: 'KR', name: 'South Korea', flag: '🇰🇷', iso3: 'KOR', ccy: 'KRW', fx: { sym: 'KRW=X' }, index: '^KS11', indexName: 'KOSPI', y10: 'IRLTLT01KRM156N', unemp: 'LRHUTTTTKRM156S', cpi: null, reer: 'RBKRBIS', gdp: { id: 'NAEXKP01KRQ657S', kind: 'qoq' }, cb: 'KR' },
  { code: 'CA', name: 'Canada', flag: '🇨🇦', iso3: 'CAN', ccy: 'CAD', fx: { sym: 'CAD=X' }, index: '^GSPTSE', indexName: 'TSX', y10: 'IRLTLT01CAM156N', unemp: 'LRHUTTTTCAM156S', cpi: null, reer: 'RBCABIS', gdp: { id: 'NAEXKP01CAQ657S', kind: 'qoq' }, cb: 'CA' },
  { code: 'AU', name: 'Australia', flag: '🇦🇺', iso3: 'AUS', ccy: 'AUD', fx: { sym: 'AUDUSD=X', invert: true }, index: '^AXJO', indexName: 'ASX 200', y10: 'IRLTLT01AUM156N', unemp: 'LRHUTTTTAUM156S', cpi: null, reer: 'RBAUBIS', gdp: { id: 'NAEXKP01AUQ657S', kind: 'qoq' }, cb: null, cbFred: 'IRSTCB01AUM156N' },
  { code: 'CH', name: 'Switzerland', flag: '🇨🇭', iso3: 'CHE', ccy: 'CHF', fx: { sym: 'CHF=X' }, index: '^SSMI', indexName: 'SMI', y10: 'IRLTLT01CHM156N', unemp: null, cpi: null, reer: 'RBCHBIS', gdp: { id: 'NAEXKP01CHQ657S', kind: 'qoq' }, cb: 'CH' },
  { code: 'BR', name: 'Brazil', flag: '🇧🇷', iso3: 'BRA', ccy: 'BRL', fx: { sym: 'BRL=X' }, index: '^BVSP', indexName: 'Bovespa', y10: null, unemp: null, cpi: null, reer: 'RBBRBIS', gdp: { id: 'NAEXKP01BRQ657S', kind: 'qoq' }, cb: 'BR' },
  { code: 'MX', name: 'Mexico', flag: '🇲🇽', iso3: 'MEX', ccy: 'MXN', fx: { sym: 'MXN=X' }, index: '^MXX', indexName: 'IPC', y10: 'IRLTLT01MXM156N', unemp: 'LRHUTTTTMXM156S', cpi: null, reer: 'RBMXBIS', gdp: { id: 'NAEXKP01MXQ657S', kind: 'qoq' }, cb: null, cbFred: 'IRSTCB01MXM156N' },
]
const BIGMAC_URL = 'https://raw.githubusercontent.com/TheEconomist/big-mac-data/master/output-data/big-mac-full-index.csv'

export function createIntlPulse({ fetchFredSeries, fetchYahooQuote, fetchYahooSparkline, fetchCbRates, UA, dir }) {
  const file = n => path.join(dir, n)
  const load = n => { try { if (fs.existsSync(file(n))) return JSON.parse(fs.readFileSync(file(n), 'utf8')) } catch {} return null }
  const save = (n, o) => { try { fs.writeFileSync(file(n), JSON.stringify(o)) } catch (e) { console.error(`${n} save:`, e.message) } }
  let mem = null, inflight = null, bmMem = null

  // ── The Economist's Big Mac data: latest print for every currency ────────
  async function bigMac() {
    if (bmMem && Date.now() - bmMem.ts < BM_TTL) return bmMem.data
    const disk = load('bigmac.json')
    if (disk && Date.now() - disk.ts < BM_TTL) { bmMem = disk; return disk.data }
    try {
      const r = await fetch(BIGMAC_URL, { headers: { 'User-Agent': UA } })
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      const lines = (await r.text()).split('\n').filter(l => l.trim())
      const head = csvSplit(lines[0]), ix = Object.fromEntries(head.map((h, i) => [h, i]))
      const all = lines.slice(1).map(csvSplit)
      const dates = [...new Set(all.map(c => c[ix.date]))].sort()
      const latest = dates[dates.length - 1]
      const rows = all.filter(c => c[ix.date] === latest).map(c => ({
        iso3: c[ix.iso_a3], ccy: c[ix.currency_code], name: c[ix.name], localPrice: +c[ix.local_price], dollarEx: +c[ix.dollar_ex], dollarPrice: +c[ix.dollar_price],
        raw: +c[ix.USD_raw] * 100, adj: c[ix.USD_adjusted] === '' ? null : +c[ix.USD_adjusted] * 100, adjPrice: c[ix.adj_price] === '' ? null : +c[ix.adj_price], gdp: c[ix.GDP_bigmac] === '' ? null : +c[ix.GDP_bigmac],
      })).filter(x => fin(x.localPrice) && fin(x.dollarEx))
      if (rows.length < 40) throw new Error(`only ${rows.length} rows for ${latest}`)
      const data = { asOf: latest, rows, prior: dates[dates.length - 2] || null }
      bmMem = { data, ts: Date.now() }; save('bigmac.json', bmMem)
      return data
    } catch (e) { console.warn('Big Mac data:', e.message); if (disk) return disk.data; throw e }
  }

  const monthlyLast = obs => { const m = new Map(); for (const p of obs || []) m.set(p.d.slice(0, 7), p.v); return [...m].map(([d, v]) => ({ d, v })) }
  const yoyIndex = (obs, step = 12) => { const m = monthlyLast(obs); const n = m.length; return n > step && m[n - 1 - step].v ? { v: ((m[n - 1].v / m[n - 1 - step].v) - 1) * 100, d: m[n - 1].d } : null }
  const batched = async (items, fn, size = 8) => { const out = []; for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(x => fn(x).catch(() => null)))); return out }
  const yearStart = ts => { const y = new Date(Date.now()).getUTCFullYear(); return Date.UTC(y, 0, 1) }
  function returns(spark) {
    const s = (spark || []).filter(p => fin(p.v))
    if (s.length < 10) return null
    const lastV = last(s).v, ys = yearStart()
    const first = s[0], firstYtd = s.find(p => p.ts >= ys) || null
    const i6 = Math.max(0, s.length - 27)
    return { r1y: chg(lastV, first.v), ytd: firstYtd ? chg(lastV, firstYtd.v) : null, r6m: chg(lastV, s[i6].v), spark: s.map(p => r2(p.v)).slice(-52), series: s }
  }
  // USD per local unit series from a Yahoo pair
  const toUsdPerLocal = (spark, invert) => (spark || []).filter(p => fin(p.v) && p.v > 0).map(p => ({ ts: p.ts, v: invert ? p.v : 1 / p.v }))

  async function build() {
    const F = async (id, n) => (id ? await fetchFredSeries(id, n) : [])
    // globals
    const dxy = await F('DTWEXBGS', 2700), dxyEm = await F('DTWEXEMEGS', 2700), emOas = await F('BAMLEMCBPIOAS', 2700)
    const cb = await fetchCbRates().catch(() => ({}))
    const usCpi = yoyIndex(await F('CPIAUCSL', 30))
    // per-country FRED
    const fred = {}
    for (const c of COUNTRIES) {
      fred[c.code] = {
        y10: await F(c.y10, 150), unemp: await F(c.unemp, 150), cpi: c.cpi && c.cpi !== 'CPIAUCSL' ? await F(c.cpi, 30) : [],
        reer: await F(c.reer, 150), gdp: await F(c.gdp?.id, 60), cbF: await F(c.cbFred, 24),
      }
    }
    // Yahoo: index + FX weekly sparks (1y), in parallel batches
    const idxSparks = await batched(COUNTRIES, c => fetchYahooSparkline(c.index, '1y', '1wk'))
    const fxSparks = await batched(COUNTRIES, c => (c.fx ? fetchYahooSparkline(c.fx.sym, '1y', '1wk') : Promise.resolve(null)))
    const eem = returns(await fetchYahooSparkline('EEM', '1y', '1wk').catch(() => null))
    const spx = returns(idxSparks[0])
    // Big Mac + live FX for every currency in it
    const bm = await bigMac().catch(() => null)
    const bmRows = bm?.rows || []
    const us = bmRows.find(r => r.iso3 === 'USA')
    const liveFx = Object.fromEntries((await batched(bmRows.filter(r => r.ccy !== 'USD'), async r => [r.ccy, await fetchYahooQuote(`${r.ccy}=X`)])).filter(Boolean).map(([k, q]) => [k, q?.price ?? null]))
    const bigmac = bmRows.map(r => {
      let fxNow = r.ccy === 'USD' ? 1 : liveFx[r.ccy]
      let fxSource = 'live'
      // guard against an inverted or broken quote: it must be within 60% of July's rate (or its inverse)
      if (fin(fxNow) && fxNow > 0 && Math.abs(fxNow / r.dollarEx - 1) > 0.6) { if (Math.abs((1 / fxNow) / r.dollarEx - 1) <= 0.6) fxNow = 1 / fxNow; else fxNow = null }
      if (!fin(fxNow) || fxNow <= 0) { fxNow = r.dollarEx; fxSource = 'july' }
      const dollarPriceNow = r.localPrice / fxNow
      const rawNow = us ? (dollarPriceNow / us.localPrice - 1) * 100 : null
      const adjNow = fin(r.adjPrice) && r.adjPrice > 0 ? (dollarPriceNow / r.adjPrice - 1) * 100 : null
      return { iso3: r.iso3, ccy: r.ccy, name: r.name, localPrice: r.localPrice, dollarPrice: r2(r.dollarPrice), raw: r1(r.raw), adj: r1(r.adj), fxJuly: r2(r.dollarEx), fxNow: r2(fxNow), fxSource, dollarPriceNow: r2(dollarPriceNow), rawNow: r1(rawNow), adjNow: r1(adjNow), fxMove: r1(chg(r.dollarEx, fxNow)), tracked: COUNTRIES.some(c => c.iso3 === r.iso3), pppRate: us ? r2(r.localPrice / us.localPrice) : null }
    }).sort((a, b) => (b.rawNow ?? -999) - (a.rawNow ?? -999))
    const bmBy = Object.fromEntries(bigmac.map(b => [b.iso3, b]))

    // ── country board ──
    const rows = COUNTRIES.map((c, i) => {
      const f = fred[c.code]
      const eq = returns(idxSparks[i])
      const fxU = c.fx ? returns(toUsdPerLocal(fxSparks[i], c.fx.invert)) : null
      const usd1y = eq && (c.fx ? (fxU ? ((1 + eq.r1y / 100) * (1 + fxU.r1y / 100) - 1) * 100 : null) : eq.r1y)
      const usdYtd = eq && (c.fx ? (fxU && fin(eq.ytd) && fin(fxU.ytd) ? ((1 + eq.ytd / 100) * (1 + fxU.ytd / 100) - 1) * 100 : null) : eq.ytd)
      const y10 = last(f.y10), y10Prev = f.y10.length > 6 ? f.y10[f.y10.length - 7] : null
      const cpi = c.cpi === 'CPIAUCSL' ? usCpi : c.cpi ? yoyIndex(f.cpi) : null
      const cpiFresh = cpi && (Date.now() - Date.parse(cpi.d + '-01')) / (30.44 * 864e5) < 6
      const un = last(f.unemp), unPrev = f.unemp.length > 12 ? f.unemp[f.unemp.length - 13] : null
      const reerM = monthlyLast(f.reer), reerNow = last(reerM), reerWin = reerM.slice(-120).map(p => p.v)
      const reerAvg = mean(reerWin)
      let gdpQ = null, gdpDate = null
      if (c.gdp && f.gdp.length > 1) { const g = f.gdp; gdpDate = last(g).d; gdpQ = c.gdp.kind === 'qoq' ? last(g).v : chg(last(g).v, g[g.length - 2].v) }
      const policy = c.cb && fin(cb?.[c.cb]?.rate) ? { v: cb[c.cb].rate, d: cb[c.cb].date, src: 'live' } : f.cbF.length ? { v: last(f.cbF).v, d: last(f.cbF).d, src: 'FRED' } : null
      const b = bmBy[c.iso3] || bigmac.find(x => x.ccy === c.ccy) || null // Germany etc. share the euro-area burger row
      return {
        code: c.code, name: c.name, flag: c.flag, ccy: c.ccy, indexName: c.indexName,
        eq: eq ? { ytd: r1(eq.ytd), r1y: r1(eq.r1y), r6m: r1(eq.r6m), usd1y: r1(usd1y), usdYtd: r1(usdYtd), spark: eq.spark } : null,
        fx: fxU ? { r1y: r1(fxU.r1y), ytd: r1(fxU.ytd), r6m: r1(fxU.r6m) } : c.code === 'US' ? { r1y: 0, ytd: 0, r6m: 0 } : null,
        policy: policy ? { v: r2(policy.v), d: policy.d, src: policy.src } : null,
        y10: y10 ? { v: r2(y10.v), d: y10.d, chg6m: y10Prev ? r2(y10.v - y10Prev.v) : null } : null,
        cpi: cpiFresh ? { v: r1(cpi.v), d: cpi.d } : null,
        real10y: y10 && cpiFresh ? r2(y10.v - cpi.v) : null,
        unemp: un ? { v: r1(un.v), d: un.d, chg1y: unPrev ? r1(un.v - unPrev.v) : null } : null,
        gdp: fin(gdpQ) ? { qoq: r1(gdpQ), d: gdpDate } : null,
        reer: reerNow && fin(reerAvg) ? { v: r1(reerNow.v), vsAvg: r1((reerNow.v / reerAvg - 1) * 100), pct: pctile(reerWin, reerNow.v), d: reerNow.d } : null,
        bigmac: b ? { raw: b.raw, adj: b.adj, rawNow: b.rawNow, adjNow: b.adjNow } : null,
      }
    })

    // ── scores ──
    const dxyM = monthlyLast(dxy), dxyNow = last(dxy)?.v ?? null
    const dxyPct = pctile(dxy.map(p => p.v), dxyNow), dxyYoy = dxyM.length > 12 ? chg(last(dxyM).v, dxyM[dxyM.length - 13].v) : null
    const usRow = rows.find(r => r.code === 'US')
    const dollarScore = Math.round(100 - (mean([dxyPct, usRow?.reer?.pct]) ?? 50))
    const emNow = last(emOas)?.v ?? null, emPct = pctile(emOas.map(p => p.v), emNow), emSince = emOas[0]?.d?.slice(0, 4) || null // FRED's EM corporate OAS only starts in 2023
    const emMom = fin(eem?.r6m) ? Math.max(0, Math.min(100, ((eem.r6m + 15) / 30) * 100)) : null
    const riskScore = Math.round(mean([fin(emPct) ? 100 - emPct : null, emMom]) ?? 50)
    const share = (list, f) => { const xs = list.filter(r => f(r) != null); return xs.length ? (xs.filter(r => f(r)).length / xs.length) * 100 : null }
    const gdpShare = share(rows, r => (r.gdp ? r.gdp.qoq > 0 : null)), unShare = share(rows, r => (r.unemp && fin(r.unemp.chg1y) ? r.unemp.chg1y <= 0 : null)), eqShare = share(rows, r => (r.eq && fin(r.eq.r6m) ? r.eq.r6m > 0 : null))
    const growthScore = Math.round(mean([gdpShare, unShare, eqShare]) ?? 50)
    const tone = s => (s >= 60 ? 'green' : s >= 40 ? 'amber' : 'red')
    const names = f => rows.filter(f).map(r => r.name)
    const scores = {
      dollar: { score: dollarScore, tone: tone(dollarScore), label: dollarScore >= 60 ? 'Dollar cheap — tailwind abroad' : dollarScore >= 40 ? 'Dollar fairly valued' : 'Dollar rich — headwind for foreign assets', why: `Broad dollar index ${fin(dxyNow) ? dxyNow.toFixed(1) : 'n/a'} (${fin(dxyYoy) ? `${dxyYoy >= 0 ? '+' : ''}${dxyYoy.toFixed(1)}% YoY, ` : ''}p${dxyPct} of 10y); U.S. real effective rate ${usRow?.reer ? `${usRow.reer.vsAvg >= 0 ? '+' : ''}${usRow.reer.vsAvg}% vs its 10y average (p${usRow.reer.pct})` : 'n/a'}. A strong dollar mechanically lowers foreign returns in USD and tightens conditions for dollar borrowers.`, dxy: r2(dxyNow), dxyYoy: r1(dxyYoy), dxyPct },
      risk: { score: riskScore, tone: tone(riskScore), label: riskScore >= 60 ? 'Risk appetite strong' : riskScore >= 40 ? 'Risk appetite selective' : 'Risk-off', why: `EM corporate spread ${fin(emNow) ? `${emNow.toFixed(2)}%` : 'n/a'} (p${emPct} of its history since ${emSince} — low is appetite); EM equities (EEM) ${fin(eem?.r6m) ? `${eem.r6m >= 0 ? '+' : ''}${eem.r6m.toFixed(1)}% over six months` : 'n/a'}${fin(eem?.r1y) && fin(spx?.r1y) ? `, ${eem.r1y - spx.r1y >= 0 ? 'ahead of' : 'behind'} the S&P by ${Math.abs(eem.r1y - spx.r1y).toFixed(1)} pts over a year` : ''}.`, emOas: r2(emNow), emPct, emSince, eemR6m: r1(eem?.r6m), eemR1y: r1(eem?.r1y), spxR1y: r1(spx?.r1y) },
      growth: { score: growthScore, tone: tone(growthScore), label: growthScore >= 60 ? 'Growth broad-based' : growthScore >= 40 ? 'Growth uneven' : 'Growth narrowing', why: `${fin(gdpShare) ? `${Math.round(gdpShare)}% of economies grew last quarter` : 'GDP n/a'}; ${fin(unShare) ? `${Math.round(unShare)}% have unemployment flat or falling over a year` : 'unemployment n/a'}; ${fin(eqShare) ? `${Math.round(eqShare)}% have positive six-month equity momentum` : ''}. Contracting: ${names(r => r.gdp && r.gdp.qoq < 0).join(', ') || 'none'}.`, gdpShare: r1(gdpShare), unShare: r1(unShare), eqShare: r1(eqShare) },
    }
    const tones = [scores.dollar.tone, scores.risk.tone, scores.growth.tone]
    const overallTone = tones.filter(t => t === 'red').length >= 2 ? 'red' : tones.includes('red') || tones.filter(t => t === 'amber').length >= 2 ? 'amber' : 'green'
    const overall = { tone: overallTone, label: overallTone === 'green' ? 'World in expansion, dollar not in the way' : overallTone === 'amber' ? 'Constructive abroad, with a catch' : 'Headwinds abroad', sentence: `${scores.growth.label}; ${scores.risk.label.toLowerCase()}; ${scores.dollar.label.toLowerCase()}.` }

    // ── Big Mac summary ──
    const nonUs = bigmac.filter(b => b.ccy !== 'USD')
    const bmSummary = bm ? {
      asOf: bm.asOf, prior: bm.prior, usPrice: us?.localPrice ?? null, n: nonUs.length,
      underRaw: nonUs.filter(b => fin(b.rawNow) && b.rawNow < 0).length, underAdj: nonUs.filter(b => fin(b.adjNow) && b.adjNow < 0).length,
      medianRaw: r1(mean([...nonUs.map(b => b.rawNow).filter(fin)].sort((a, b) => a - b).slice(Math.floor(nonUs.length / 2) - 1, Math.floor(nonUs.length / 2) + 1))),
      cheapest: nonUs.filter(b => fin(b.rawNow)).slice(-3).reverse().map(b => ({ name: b.name, ccy: b.ccy, rawNow: b.rawNow })), priciest: nonUs.filter(b => fin(b.rawNow)).slice(0, 3).map(b => ({ name: b.name, ccy: b.ccy, rawNow: b.rawNow })),
      movers: [...nonUs].filter(b => fin(b.fxMove) && b.fxSource === 'live').sort((a, b) => Math.abs(b.fxMove) - Math.abs(a.fxMove)).slice(0, 5).map(b => ({ name: b.name, ccy: b.ccy, fxMove: b.fxMove, raw: b.raw, rawNow: b.rawNow })),
      liveShare: r1((nonUs.filter(b => b.fxSource === 'live').length / (nonUs.length || 1)) * 100),
    } : null

    // ── charts ──
    const weekly = (obs, n) => monthlyLast(obs).slice(-n) // monthly-last is fine for 5y context lines
    return {
      rows, scores, overall, bigmac, bigmacSummary: bmSummary,
      charts: { dollar: weekly(dxy, 120).map(p => ({ d: p.d, broad: r1(p.v) })).map((p, i, a) => ({ ...p, em: r1(monthlyLast(dxyEm).find(x => x.d === p.d)?.v) })), emSpread: weekly(emOas, 120).map(p => ({ d: p.d, v: r2(p.v) })), emSince, dxyAvg10y: r1(mean(monthlyLast(dxy).slice(-120).map(p => p.v))) },
      updated: new Date().toISOString(),
    }
  }

  async function get() {
    if (mem && Date.now() - mem.ts < TTL) return mem.data
    const disk = mem || load('intl-pulse.json')
    if (disk && Date.now() - disk.ts < TTL) { mem = disk; return disk.data }
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const data = await build()
        const complete = data.rows.filter(r => r.eq).length >= 10 && data.rows.filter(r => r.reer).length >= 10
        if (complete) { mem = { data, ts: Date.now() }; save('intl-pulse.json', mem); return data }
        console.warn('intl-pulse: incomplete build, serving it without caching'); return disk?.data || data
      } catch (e) { console.warn('intl-pulse:', e.message); if (disk) return disk.data; throw e }
      finally { inflight = null }
    })()
    return inflight
  }
  return { get }
}
