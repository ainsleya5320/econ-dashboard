// ============================================================================
// THE ECONOMIC MACHINE — a Ray Dalio tracker ("How the Economic Machine Works")
// Three forces and three rules of thumb, each mapped to live FRED data:
//   productivity      output per hour, real GDP per capita vs its fitted trend,
//                     real GDP vs CBO potential (the output gap), unit labor
//                     costs vs productivity
//   short-term cycle  Dalio's sequence — credit expands → spending → inflation
//                     → the central bank tightens → activity turns → easing —
//                     scored as a checklist per stage, the stage with the most
//                     conditions met is "where we are"
//   long-term cycle   total debt of every sector vs GDP since 1951, debt
//                     service, the "beautiful deleveraging" test (nominal growth
//                     vs the interest rate on the debt), and the four levers —
//                     austerity, defaults, redistribution, printing — with a
//                     current setting for each (gold as the monetization gauge)
//   rules             1. debt must not rise faster than income
//                     2. income must not rise faster than productivity
//                     3. do all you can to raise productivity
// ~26 FRED series + Yahoo gold; cached 6h, disk-backed (machine.json).
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 60 * 60 * 1000, TTL = 6 * H
const fin = v => v != null && Number.isFinite(v)
const last = a => (a && a.length ? a[a.length - 1] : null)
const r1 = v => (fin(v) ? +v.toFixed(1) : null), r2 = v => (fin(v) ? +v.toFixed(2) : null)
const mean = xs => { const v = (xs || []).filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const yoy = (arr, step) => arr.map((p, i) => (i >= step && arr[i - step].v ? { d: p.d, v: ((p.v / arr[i - step].v) - 1) * 100 } : null)).filter(Boolean)
const monthly = obs => { const m = new Map(); for (const p of obs || []) m.set(p.d.slice(0, 7), p.v); return [...m].map(([d, v]) => ({ d, v })) }
const quarterOf = d => `${d.slice(0, 4)}-Q${Math.floor((+d.slice(5, 7) - 1) / 3) + 1}`
const at = (arr, d) => { let v = null; for (const p of arr) { if (p.d <= d) v = p.v; else break } return v }
const back = (arr, n) => (arr.length > n ? arr[arr.length - 1 - n] : null)
const cagr = (arr, n) => { const a = last(arr), b = back(arr, n); return a && b && b.v > 0 ? (Math.pow(a.v / b.v, 4 / n) - 1) * 100 : null } // n quarters → annual

export function createMachine({ fetchFredSeries, fetchYahooSparkline, dir }) {
  const FILE = path.join(dir, 'machine.json')
  let mem = null, inflight = null
  const load = () => { try { if (fs.existsSync(FILE)) return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch {} return null }
  const save = o => { try { fs.writeFileSync(FILE, JSON.stringify(o)) } catch (e) { console.error('machine save:', e.message) } }

  async function build() {
    const F = (id, n) => fetchFredSeries(id, n)
    const oph = await F('OPHNFB', 220), rpc = await F('A939RX0Q048SBEA', 330), gdpc = await F('GDPC1', 330), pot = await F('GDPPOT', 420), ulc = await F('ULCNFB', 220), comp = await F('COMPRNFB', 220)
    const tcmdo = await F('TCMDO', 330), gdp = await F('GDP', 330), pce = await F('PCEPILFE', 420), ffr = await F('FEDFUNDS', 880), un = await F('UNRATE', 420), sahm = await F('SAHMREALTIME', 220), t10y3m = await F('T10Y3M', 2700), dgs10 = await F('DGS10', 2700)
    const tdsp = await F('TDSP', 220), intr = await F('A091RC1Q027SBEA', 220), rec = await F('FGRECPT', 220), debtFed = await F('GFDEBTN', 220), exp = await F('FGEXPND', 220), defl = await F('GDPDEF', 220)
    const walcl = await F('WALCL', 1100), m2 = await F('M2SL', 800), top1 = await F('WFRBST01134', 140), bot50 = await F('WFRBSB50215', 140), hy = await F('BAMLH0A0HYM2', 2700), dqC = await F('DRCLACBS', 140), dqB = await F('DRBLACBS', 140)
    const goldRaw = await fetchYahooSparkline('GC=F', '10y', '1mo').catch(() => [])
    const gold = monthly(goldRaw.map(p => ({ d: new Date(p.ts).toISOString().slice(0, 10), v: p.v })))
    const okCount = [oph, rpc, gdpc, pot, tcmdo, gdp, pce, ffr, un, tdsp, intr, rec, debtFed, exp, walcl, m2].filter(a => a.length > 8).length
    if (okCount < 14) throw new Error(`only ${okCount}/16 core series came back`)

    // ── Productivity ──────────────────────────────────────────────────────
    const ophYoy = yoy(oph, 4), ophNow = last(ophYoy)?.v ?? null
    const oph5y = r1(cagr(oph, 20)), oph10y = r1(cagr(oph, 40)), oph20yAvg = mean(ophYoy.slice(-80).map(p => p.v))
    // log-linear trend of real GDP per capita over the whole sample
    const ys = rpc.map(p => Math.log(p.v)), n = ys.length
    const xm = (n - 1) / 2, ym = mean(ys)
    const slope = ys.reduce((s, y, i) => s + (i - xm) * (y - ym), 0) / ys.reduce((s, _, i) => s + (i - xm) ** 2, 0)
    const trendGrowth = (Math.exp(slope * 4) - 1) * 100
    const trendAt = i => Math.exp(ym + slope * (i - xm))
    const perCapita = rpc.map((p, i) => ({ d: p.d, actual: Math.round(p.v), trend: Math.round(trendAt(i)) }))
    const pcGap = rpc.length ? (last(rpc).v / trendAt(n - 1) - 1) * 100 : null
    const pcYoy = last(yoy(rpc, 4))?.v ?? null
    const potBy = Object.fromEntries(pot.map(p => [p.d, p.v]))
    const gapSeries = gdpc.filter(p => potBy[p.d]).map(p => ({ d: p.d, v: (p.v / potBy[p.d] - 1) * 100 }))
    const outputGap = last(gapSeries)?.v ?? null
    const ulcYoy = last(yoy(ulc, 4))?.v ?? null, compYoy = last(yoy(comp, 4))?.v ?? null
    const realGdpYoy = last(yoy(gdpc, 4))?.v ?? null

    // ── Short-term debt cycle ─────────────────────────────────────────────
    const credit = yoy(tcmdo, 4), creditNow = last(credit)?.v ?? null, creditYrAgo = back(credit, 4)?.v ?? null
    const nom = yoy(gdp, 4), nomNow = last(nom)?.v ?? null, nomYrAgo = back(nom, 4)?.v ?? null
    const pceYoy = yoy(monthly(pce), 12), pceNow = last(pceYoy)?.v ?? null, pce6m = back(pceYoy, 6)?.v ?? null
    const ffrM = monthly(ffr), ffrNow = last(ffrM)?.v ?? null, ffr12 = back(ffrM, 12)?.v ?? null
    const realPolicy = fin(ffrNow) && fin(pceNow) ? ffrNow - pceNow : null
    const curveM = monthly(t10y3m), curveNow = last(t10y3m)?.v ?? null, curve6m = back(curveM, 6)?.v ?? null
    const unM = monthly(un), unNow = last(unM)?.v ?? null, un12 = back(unM, 12)?.v ?? null
    const sahmNow = last(sahm)?.v ?? null
    const c = {
      creditAccel: fin(creditNow) && fin(creditYrAgo) ? creditNow > creditYrAgo + 0.3 : null,
      creditAboveIncome: fin(creditNow) && fin(nomNow) ? creditNow > nomNow : null,
      inflAboveTarget: fin(pceNow) ? pceNow > 2.5 : null,
      inflRising: fin(pceNow) && fin(pce6m) ? pceNow > pce6m + 0.2 : null,
      inflFalling: fin(pceNow) && fin(pce6m) ? pceNow < pce6m - 0.2 : null,
      fedHiking: fin(ffrNow) && fin(ffr12) ? ffrNow - ffr12 >= 0.25 : null,
      fedCutting: fin(ffrNow) && fin(ffr12) ? ffr12 - ffrNow >= 0.25 : null,
      realRateRestrictive: fin(realPolicy) ? realPolicy > 1 : null,
      curveInverted: fin(curveNow) ? curveNow < 0 : null,
      curveSteepening: fin(curveNow) && fin(curve6m) ? curveNow > curve6m + 0.2 : null,
      unempRising: fin(unNow) && fin(un12) ? unNow - un12 >= 0.3 : null,
      unempFalling: fin(unNow) && fin(un12) ? unNow - un12 <= -0.1 : null,
      sahmTriggered: fin(sahmNow) ? sahmNow >= 0.5 : null,
      capacityTight: fin(outputGap) ? outputGap > 0 : null,
      spendingSlowing: fin(nomNow) && fin(nomYrAgo) ? nomNow < nomYrAgo - 0.5 : null,
      spendingAccel: fin(nomNow) && fin(nomYrAgo) ? nomNow > nomYrAgo + 0.5 : null,
    }
    const STAGES = [
      { key: 'early', name: 'Early expansion', dalio: 'Credit is cheap and starts to expand; spending and incomes rise together; inflation is quiet, so the central bank stays easy.', tests: [['creditAccel', 'credit growth accelerating'], ['spendingAccel', 'spending growth accelerating'], ['inflAboveTarget', 'inflation still contained', true], ['fedHiking', 'central bank not tightening', true], ['unempFalling', 'unemployment falling']] },
      { key: 'late', name: 'Late expansion', dalio: 'Borrowing outruns income, the economy runs above capacity, and prices start to rise — the seed of the tightening.', tests: [['creditAboveIncome', 'credit growing faster than income'], ['capacityTight', 'output above potential'], ['inflAboveTarget', 'inflation above target'], ['inflRising', 'inflation rising'], ['unempFalling', 'labor market still tightening']] },
      { key: 'tightening', name: 'Tightening', dalio: 'The central bank raises rates; borrowing costs climb, debt service bites, and the yield curve flattens or inverts.', tests: [['fedHiking', 'central bank hiking'], ['realRateRestrictive', 'real policy rate restrictive'], ['curveInverted', 'yield curve inverted'], ['inflAboveTarget', 'inflation still above target'], ['creditAccel', 'credit growth decelerating', true]] },
      { key: 'contraction', name: 'Contraction', dalio: 'Spending falls because borrowing falls; incomes drop, unemployment rises, and debts become hard to service — the recession.', tests: [['unempRising', 'unemployment rising'], ['sahmTriggered', 'Sahm rule triggered'], ['spendingSlowing', 'spending growth falling'], ['creditAccel', 'credit growth falling', true], ['inflFalling', 'inflation falling']] },
      { key: 'easing', name: 'Easing / recovery', dalio: 'The central bank cuts, the curve steepens, debt burdens ease and the next expansion is seeded — as long as productivity keeps rising.', tests: [['fedCutting', 'central bank cutting'], ['curveSteepening', 'yield curve steepening'], ['inflFalling', 'inflation falling or low'], ['realRateRestrictive', 'real policy rate no longer restrictive', true], ['unempRising', 'unemployment stabilizing', true]] },
    ]
    const stages = STAGES.map(s => {
      const checks = s.tests.map(([k, text, invert]) => ({ text, met: c[k] == null ? null : invert ? !c[k] : c[k] }))
      const known = checks.filter(x => x.met != null).length
      return { key: s.key, name: s.name, dalio: s.dalio, checks, met: checks.filter(x => x.met).length, known, score: known ? checks.filter(x => x.met).length / known : 0 }
    })
    // ties are common mid-cycle; break them by what the central bank is doing, which is
    // the hinge of Dalio's sequence, and keep the runners-up visible in the verdict
    const top = Math.max(...stages.map(s => s.score))
    const tied = stages.filter(s => s.score === top)
    const pref = c.fedHiking ? ['tightening', 'late', 'early', 'contraction', 'easing']
      : c.fedCutting ? (c.creditAccel && c.spendingAccel ? ['early', 'easing', 'late', 'contraction', 'tightening'] : ['easing', 'contraction', 'early', 'late', 'tightening'])
      : (c.inflAboveTarget && c.capacityTight ? ['late', 'early', 'tightening', 'easing', 'contraction'] : ['early', 'late', 'easing', 'tightening', 'contraction'])
    const current = tied.length === 1 ? tied[0] : tied.sort((a, b) => pref.indexOf(a.key) - pref.indexOf(b.key))[0]
    const runnersUp = tied.filter(s => s.key !== current.key).map(s => s.name)
    const shortCycle = {
      stage: current.key, name: current.name, runnersUp, stages,
      inputs: { creditYoy: r1(creditNow), creditYrAgo: r1(creditYrAgo), nominalYoy: r1(nomNow), nominalYrAgo: r1(nomYrAgo), corePce: r1(pceNow), corePce6m: r1(pce6m), ffr: r2(ffrNow), ffrChg12: r2(fin(ffrNow) && fin(ffr12) ? ffrNow - ffr12 : null), realPolicy: r2(realPolicy), curve: r2(curveNow), curve6m: r2(curve6m), unemp: r1(unNow), unempChg12: r1(fin(unNow) && fin(un12) ? unNow - un12 : null), sahm: r2(sahmNow), outputGap: r1(outputGap), realGdpYoy: r1(realGdpYoy) },
      why: `${current.name}: ${current.met} of ${current.known} conditions met${runnersUp.length ? ` (${runnersUp.join(' and ')} tie on conditions; the central bank's direction breaks the tie)` : ''} — credit ${fin(creditNow) ? `${creditNow.toFixed(1)}%` : 'n/a'} vs nominal income ${fin(nomNow) ? `${nomNow.toFixed(1)}%` : 'n/a'} YoY, core PCE ${fin(pceNow) ? `${pceNow.toFixed(1)}%` : 'n/a'}, fed funds ${fin(ffrNow) ? `${ffrNow.toFixed(2)}%` : 'n/a'} (${fin(ffrNow) && fin(ffr12) ? `${ffrNow - ffr12 >= 0 ? '+' : ''}${(ffrNow - ffr12).toFixed(2)}pp over a year` : 'n/a'}), real policy rate ${fin(realPolicy) ? `${realPolicy >= 0 ? '+' : ''}${realPolicy.toFixed(1)}pp` : 'n/a'}, curve ${fin(curveNow) ? `${curveNow >= 0 ? '+' : ''}${curveNow.toFixed(2)}pp` : 'n/a'}, unemployment ${fin(unNow) ? `${unNow.toFixed(1)}%` : 'n/a'}.`,
    }

    // ── Long-term debt cycle ──────────────────────────────────────────────
    const gdpBy = Object.fromEntries(gdp.map(p => [p.d, p.v]))
    const debtGdp = tcmdo.filter(p => gdpBy[p.d]).map(p => ({ d: p.d, v: (p.v / 1000 / gdpBy[p.d]) * 100 }))
    const fedGdp = debtFed.filter(p => gdpBy[p.d]).map(p => ({ d: p.d, v: (p.v / 1000 / gdpBy[p.d]) * 100 }))
    const dNow = last(debtGdp)?.v ?? null, d1y = back(debtGdp, 4)?.v ?? null, d5y = back(debtGdp, 20)?.v ?? null
    const peak = debtGdp.reduce((b, p) => (p.v > b.v ? p : b), debtGdp[0] || { v: 0, d: null })
    const chg5 = fin(dNow) && fin(d5y) ? dNow - d5y : null
    const ltStage = !fin(chg5) ? 'n/a' : chg5 > 5 ? 'Leveraging up' : chg5 < -5 ? 'Deleveraging' : fin(dNow) && peak.v && dNow > peak.v * 0.92 ? 'Plateau near the peak' : 'Stable'
    const effRate = intr.filter(p => debtFed.find(x => x.d === p.d)).map(p => ({ d: p.d, v: (p.v / (debtFed.find(x => x.d === p.d).v / 1000)) * 100 }))
    const effNow = last(effRate)?.v ?? null
    const recBy = Object.fromEntries(rec.map(p => [p.d, p.v]))
    const intRec = intr.filter(p => recBy[p.d]).map(p => ({ d: p.d, v: (p.v / recBy[p.d]) * 100 }))
    const y10M = monthly(dgs10), y10Now = last(dgs10)?.v ?? null
    const beautifulGap = fin(nomNow) && fin(effNow) ? nomNow - effNow : null
    let beautiful
    if (!fin(beautifulGap)) beautiful = { label: 'n/a', tone: 'amber', note: '' }
    else if (fin(pceNow) && pceNow > 5) beautiful = { label: 'Ugly, inflationary', tone: 'red', note: 'Debt is being inflated away faster than the economy can stand — the printing lever is doing too much of the work.' }
    else if (beautifulGap < 0) beautiful = { label: 'Ugly, deflationary risk', tone: 'red', note: 'Interest rates exceed nominal growth, so debt burdens compound even without new borrowing — the setup that forces austerity or defaults.' }
    else if (fin(realGdpYoy) && realGdpYoy > 0 && fin(pceNow) && pceNow >= 1) beautiful = { label: 'Beautiful, so far', tone: 'green', note: 'Nominal growth runs above the interest rate on the debt with positive real growth and moderate inflation — burdens fall while the economy grows.' }
    else beautiful = { label: 'Muddling through', tone: 'amber', note: 'Growth clears the interest rate only narrowly, or real growth is stalling.' }
    // levers
    const deflBy = Object.fromEntries(defl.map(p => [p.d, p.v]))
    const realExp = exp.filter(p => deflBy[p.d]).map(p => ({ d: p.d, v: p.v / deflBy[p.d] }))
    const realSpendYoy = last(yoy(realExp, 4))?.v ?? null
    const deficitGdp = last(exp) && recBy[last(exp).d] && gdpBy[last(exp).d] ? ((last(exp).v - recBy[last(exp).d]) / gdpBy[last(exp).d]) * 100 : null
    const recGdp = rec.filter(p => gdpBy[p.d]).map(p => ({ d: p.d, v: (p.v / gdpBy[p.d]) * 100 }))
    const recNow = last(recGdp)?.v ?? null, rec5y = back(recGdp, 20)?.v ?? null
    const top1Now = last(top1)?.v ?? null, top1_5y = back(top1, 20)?.v ?? null, bot50Now = last(bot50)?.v ?? null, bot50_5y = back(bot50, 20)?.v ?? null
    const hyNow = last(hy)?.v ?? null, dqCNow = last(dqC)?.v ?? null, dqC1y = back(dqC, 4)?.v ?? null, dqBNow = last(dqB)?.v ?? null, dqB1y = back(dqB, 4)?.v ?? null
    const walclM = monthly(walcl), walclNow = last(walclM)?.v ?? null, walcl12 = back(walclM, 12)?.v ?? null
    const walclGdp = fin(walclNow) && last(gdp) ? (walclNow / 1e6 / (last(gdp).v / 1000)) * 100 : null
    const walclYoy = fin(walclNow) && fin(walcl12) ? ((walclNow / walcl12) - 1) * 100 : null
    const m2Yoy = last(yoy(monthly(m2), 12))?.v ?? null
    const goldNow = last(gold)?.v ?? null, gold1y = back(gold, 12)?.v ?? null, gold5y = back(gold, 60)?.v ?? null
    const goldR1y = fin(goldNow) && fin(gold1y) ? ((goldNow / gold1y) - 1) * 100 : null
    const goldCagr5 = fin(goldNow) && fin(gold5y) ? (Math.pow(goldNow / gold5y, 1 / 5) - 1) * 100 : null
    const setting = (heavy, light, offLabel = 'off') => (heavy ? 'heavy' : light ? 'light' : offLabel)
    const levers = [
      { key: 'austerity', name: 'Austerity', dalio: 'Cutting spending. Deflationary and painful — incomes fall as fast as debts.', setting: setting(fin(realSpendYoy) && realSpendYoy < -2, fin(realSpendYoy) && realSpendYoy < 0), value: fin(realSpendYoy) ? `real federal spending ${realSpendYoy >= 0 ? '+' : ''}${realSpendYoy.toFixed(1)}% YoY` : 'n/a', sub: fin(deficitGdp) ? `deficit ${deficitGdp.toFixed(1)}% of GDP` : '' },
      { key: 'defaults', name: 'Debt defaults', dalio: 'Restructuring or writing debt off. Deflationary; one person\'s debt is another\'s asset.', setting: setting((fin(hyNow) && hyNow > 7) || (fin(dqCNow) && fin(dqC1y) && dqCNow - dqC1y > 1), (fin(hyNow) && hyNow > 4.5) || (fin(dqCNow) && fin(dqC1y) && dqCNow > dqC1y + 0.2)), value: fin(hyNow) ? `high-yield spread ${hyNow.toFixed(2)}%` : 'n/a', sub: fin(dqCNow) ? `consumer-loan delinquency ${dqCNow.toFixed(2)}% (${fin(dqC1y) ? `${dqCNow - dqC1y >= 0 ? '+' : ''}${(dqCNow - dqC1y).toFixed(2)}pp 1y` : ''}), business ${fin(dqBNow) ? `${dqBNow.toFixed(2)}%` : 'n/a'}` : '' },
      { key: 'redistribution', name: 'Redistribution', dalio: 'Taxing the haves to fund the have-nots. Politically charged; rises when wealth gaps are widest.', setting: setting(fin(recNow) && fin(rec5y) && recNow - rec5y > 1 && fin(top1Now) && fin(top1_5y) && top1Now < top1_5y, (fin(recNow) && fin(rec5y) && recNow - rec5y > 0.5) || (fin(top1Now) && fin(top1_5y) && top1Now < top1_5y)), value: fin(top1Now) ? `top 1% hold ${top1Now.toFixed(1)}% of wealth${fin(top1_5y) ? ` (${top1Now - top1_5y >= 0 ? '+' : ''}${(top1Now - top1_5y).toFixed(1)}pp in 5y)` : ''}` : 'n/a', sub: fin(recNow) ? `federal receipts ${recNow.toFixed(1)}% of GDP${fin(rec5y) ? ` (${recNow - rec5y >= 0 ? '+' : ''}${(recNow - rec5y).toFixed(1)}pp in 5y)` : ''} · bottom 50% hold ${fin(bot50Now) ? `${bot50Now.toFixed(1)}%` : 'n/a'}` : '' },
      { key: 'printing', name: 'Printing money', dalio: 'The central bank buys assets with new money. Inflationary; the lever that makes a deleveraging beautiful if balanced against the other three.', setting: fin(walclYoy) ? (walclYoy > 10 ? 'heavy' : walclYoy > 0 ? 'light' : 'reverse (QT)') : 'n/a', value: fin(walclGdp) ? `Fed balance sheet ${walclGdp.toFixed(0)}% of GDP (${fin(walclYoy) ? `${walclYoy >= 0 ? '+' : ''}${walclYoy.toFixed(1)}% YoY` : 'n/a'})` : 'n/a', sub: `M2 ${fin(m2Yoy) ? `${m2Yoy >= 0 ? '+' : ''}${m2Yoy.toFixed(1)}%` : 'n/a'} vs nominal GDP ${fin(nomNow) ? `${nomNow.toFixed(1)}%` : 'n/a'} YoY · gold ${fin(goldNow) ? `$${Math.round(goldNow).toLocaleString()}` : 'n/a'} (${fin(goldR1y) ? `${goldR1y >= 0 ? '+' : ''}${goldR1y.toFixed(0)}% 1y` : ''}${fin(goldCagr5) ? `, ${goldCagr5.toFixed(0)}%/yr over 5y` : ''})` },
    ]
    const longCycle = {
      stage: ltStage, debtGdp: r1(dNow), chg1y: r1(fin(dNow) && fin(d1y) ? dNow - d1y : null), chg5y: r1(chg5), peak: { v: r1(peak.v), d: peak.d }, federalGdp: r1(last(fedGdp)?.v), federalShare: r1(fin(dNow) && last(fedGdp) ? (last(fedGdp).v / dNow) * 100 : null),
      householdDsr: r1(last(tdsp)?.v), interestToReceipts: r1(last(intRec)?.v), effRate: r2(effNow), y10: r2(y10Now), nominalGrowth: r1(nomNow), realGrowth: r1(realGdpYoy), beautifulGap: r1(beautifulGap), beautiful, levers,
      monetization: { walclGdp: r1(walclGdp), walclYoy: r1(walclYoy), m2Yoy: r1(m2Yoy), goldNow: r1(goldNow), goldR1y: r1(goldR1y), goldCagr5: r1(goldCagr5) },
      wealth: { top1: r1(top1Now), top1Chg5y: r1(fin(top1Now) && fin(top1_5y) ? top1Now - top1_5y : null), bot50: r1(bot50Now), bot50Chg5y: r1(fin(bot50Now) && fin(bot50_5y) ? bot50Now - bot50_5y : null), asOf: last(top1)?.d || null },
      why: `Total debt ${fin(dNow) ? `${dNow.toFixed(0)}% of GDP` : 'n/a'} (${fin(chg5) ? `${chg5 >= 0 ? '+' : ''}${chg5.toFixed(0)}pp over five years` : 'n/a'}; peak ${peak.v ? `${peak.v.toFixed(0)}% in ${peak.d?.slice(0, 4)}` : 'n/a'}), federal ${fin(last(fedGdp)?.v) ? `${last(fedGdp).v.toFixed(0)}%` : 'n/a'} of it. Nominal growth ${fin(nomNow) ? `${nomNow.toFixed(1)}%` : 'n/a'} vs ${fin(effNow) ? `${effNow.toFixed(2)}%` : 'n/a'} paid on federal debt → ${beautiful.label.toLowerCase()}.`,
    }

    // ── Rules of thumb ────────────────────────────────────────────────────
    const rule = (ok, warn) => (ok ? 'pass' : warn ? 'watch' : 'fail')
    const rules = [
      { key: 'debt', text: 'Debt must not rise faster than income', status: fin(creditNow) && fin(nomNow) ? rule(creditNow <= nomNow + 1, creditNow <= nomNow + 3) : 'n/a', detail: `total credit ${fin(creditNow) ? `${creditNow.toFixed(1)}%` : 'n/a'} vs nominal GDP ${fin(nomNow) ? `${nomNow.toFixed(1)}%` : 'n/a'} YoY` },
      { key: 'income', text: 'Income must not rise faster than productivity', status: fin(compYoy) && fin(ophNow) ? rule(compYoy <= ophNow + 0.5, compYoy <= ophNow + 1.5) : 'n/a', detail: `real compensation per hour ${fin(compYoy) ? `${compYoy.toFixed(1)}%` : 'n/a'} vs output per hour ${fin(ophNow) ? `${ophNow.toFixed(1)}%` : 'n/a'} YoY (unit labor costs ${fin(ulcYoy) ? `${ulcYoy.toFixed(1)}%` : 'n/a'})` },
      { key: 'productivity', text: 'Do all you can to raise productivity', status: fin(oph5y) ? rule(oph5y >= 1.5, oph5y >= 1) : 'n/a', detail: `productivity ${fin(oph5y) ? `${oph5y.toFixed(1)}%/yr` : 'n/a'} over five years, ${fin(oph20yAvg) ? `${oph20yAvg.toFixed(1)}%` : 'n/a'} 20-year average` },
    ]

    const productivity = {
      ophYoy: r1(ophNow), oph5y: r1(oph5y), oph10y: r1(oph10y), oph20yAvg: r1(oph20yAvg), ophAsOf: last(oph)?.d || null,
      perCapita: { now: last(rpc)?.v ?? null, yoy: r1(pcYoy), trendGrowth: r2(trendGrowth), gapVsTrend: r1(pcGap), since: rpc[0]?.d?.slice(0, 4) || null },
      outputGap: r1(outputGap), outputGapAsOf: last(gapSeries)?.d || null, ulcYoy: r1(ulcYoy), compYoy: r1(compYoy), realGdpYoy: r1(realGdpYoy),
      tone: !fin(oph5y) ? 'amber' : oph5y >= 1.5 ? 'green' : oph5y >= 1 ? 'amber' : 'red',
      label: !fin(oph5y) ? 'n/a' : oph5y >= 2 ? 'Productivity accelerating' : oph5y >= 1.5 ? 'Productivity on trend' : oph5y >= 1 ? 'Productivity soft' : 'Productivity stalled',
      why: `Output per hour ${fin(ophNow) ? `${ophNow >= 0 ? '+' : ''}${ophNow.toFixed(1)}%` : 'n/a'} YoY, ${fin(oph5y) ? `${oph5y.toFixed(1)}%/yr` : 'n/a'} over five years vs ${fin(oph20yAvg) ? `${oph20yAvg.toFixed(1)}%` : 'n/a'} long-run. Real GDP per person sits ${fin(pcGap) ? `${pcGap >= 0 ? '+' : ''}${pcGap.toFixed(1)}%` : 'n/a'} vs its ${fin(trendGrowth) ? `${trendGrowth.toFixed(1)}%/yr` : ''} trend line since ${rpc[0]?.d?.slice(0, 4)}; output is ${fin(outputGap) ? `${outputGap >= 0 ? '+' : ''}${outputGap.toFixed(1)}%` : 'n/a'} vs CBO potential.`,
    }

    // ── charts ──
    const ffrQ = (() => { const m = new Map(); for (const p of ffr) { const q = quarterOf(p.d); m.set(q, p.v) } return m })()
    const creditChart = credit.filter(p => p.d >= '1960').map(p => ({ d: p.d, credit: r1(p.v), nominal: r1(nom.find(x => x.d === p.d)?.v), ffr: r2(ffrQ.get(quarterOf(p.d))) }))
    const debtChart = debtGdp.map(p => ({ d: p.d, total: r1(p.v), federal: r1(fedGdp.find(x => x.d === p.d)?.v) }))
    const beautifulChart = nom.filter(p => p.d >= '1970').map(p => ({ d: p.d, nominal: r1(p.v), effRate: r2(effRate.find(x => x.d === p.d)?.v), y10: r2(at(y10M.map(x => ({ d: `${x.d}-01`, v: x.v })), p.d)) }))
    const goldChart = gold.map(p => ({ d: p.d, v: Math.round(p.v) }))
    const gapChart = gapSeries.filter(p => p.d >= '1980').map(p => ({ d: p.d, v: r1(p.v) }))

    return { productivity, shortCycle, longCycle, rules, charts: { perCapita, credit: creditChart, debt: debtChart, beautiful: beautifulChart, gold: goldChart, outputGap: gapChart }, updated: new Date().toISOString() }
  }

  async function get() {
    if (mem && Date.now() - mem.ts < TTL) return mem.data
    const disk = mem || load()
    if (disk && Date.now() - disk.ts < TTL) { mem = disk; return disk.data }
    if (inflight) return inflight
    inflight = (async () => {
      try { const data = await build(); mem = { data, ts: Date.now() }; save(mem); return data }
      catch (e) { console.warn('machine:', e.message); if (disk) return disk.data; throw e }
      finally { inflight = null }
    })()
    return inflight
  }
  return { get }
}
