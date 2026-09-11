// ============================================================================
// SEATTLE — the Puget Sound economy at metro granularity
//   labor     MSA unemployment (SA) vs Washington and the US; King, Pierce and
//             Snohomish county rates; total nonfarm payrolls and nine sectors
//             (BLS SM series via FRED); average hourly earnings vs US; WA
//             initial claims; Indeed's daily Seattle job-postings index vs US
//             (Hiring Lab's public CSV — 62MB, streamed and filtered, daily)
//   housing   the Real Estate tab's Seattle metro feed (Zillow, Case-Shiller,
//             Redfin listing) plus Case-Shiller tiers, Realtor.com inventory,
//             permits and the FHFA index
//   prices    Seattle CPI and rent CPI vs the US, gasoline vs the US, BEA
//             regional price parity
//   business  the bankruptcy tracker's W.D. Washington slice, Washington
//             business applications, and WA ESD WARN notices (the state's
//             layoff database; the ASP.NET grid is paged with postbacks and
//             archived in warn.json so the history accumulates)
//   growth    King County GDP and income, MSA population, homeownership,
//             cost-burdened households, inequality — annual, lagged a year
//   giants    twelve Puget Sound-headquartered public companies: day change,
//             year to date, one-year sparkline, and an equal-weight index vs SPY
//   scores    labor, housing, cost of living, business — 0–100 with verdicts
// Cached 3h (postings 24h), disk-backed; complete builds only.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, TTL = 3 * H
const fin = v => v != null && Number.isFinite(v)
const last = a => (a && a.length ? a[a.length - 1] : null)
const r1 = v => (fin(v) ? +v.toFixed(1) : null), r2 = v => (fin(v) ? +v.toFixed(2) : null)
const chg = (a, b) => (fin(a) && fin(b) && b !== 0 ? ((a / b) - 1) * 100 : null)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const mean = xs => { const v = (xs || []).filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const pctile = (arr, v) => { const a = (arr || []).filter(fin); if (!a.length || !fin(v)) return null; return Math.round((a.filter(x => x < v).length / a.length) * 100) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ym = d => d.slice(0, 7)
// value n periods before the last observation (by index — the series are regular)
const back = (s, n) => (s && s.length > n ? s[s.length - 1 - n] : null)
const yoyPct = (s, n) => (s?.length ? r1(chg(last(s).v, back(s, n)?.v)) : null)
const yoyDiff = (s, n) => (s?.length && back(s, n) ? r2(last(s).v - back(s, n).v) : null)

const SECTORS = [
  ['SEAT653INFO', 'Information'], ['SEAT653PBSV', 'Professional & business'], ['SEAT653TRAD', 'Trade, transport, utilities'],
  ['SEAT653EDUH', 'Education & health'], ['SEAT653GOVT', 'Government'], ['SEAT653LEIH', 'Leisure & hospitality'],
  ['SEAT653MFG', 'Manufacturing'], ['SEAT653FIRE', 'Financial activities'], ['SEAT653SRVO', 'Other services'],
]
const GIANTS = [
  ['AMZN', 'Amazon', 'Seattle'], ['MSFT', 'Microsoft', 'Redmond'], ['COST', 'Costco', 'Issaquah'], ['SBUX', 'Starbucks', 'Seattle'],
  ['BA', 'Boeing', 'Everett · Renton'], ['TMUS', 'T-Mobile', 'Bellevue'], ['PCAR', 'PACCAR', 'Bellevue'], ['EXPD', 'Expeditors', 'Seattle'],
  ['EXPE', 'Expedia', 'Seattle'], ['ALK', 'Alaska Air', 'SeaTac'], ['WY', 'Weyerhaeuser', 'Seattle'], ['ZG', 'Zillow', 'Seattle'],
]
const PUGET = /\b(Seattle|Bellevue|Tacoma|Everett|Redmond|Kirkland|Renton|Kent|Tukwila|Bothell|Kenmore|Auburn|Federal Way|Lynnwood|Issaquah|Sumner|Puyallup|Lakewood|SeaTac|Burien|Shoreline|Woodinville|Sammamish|Snoqualmie|Marysville|Edmonds|Mukilteo|Mill Creek|Des Moines|Fife|Bonney Lake|Gig Harbor|Arlington|Monroe|Maple Valley|Covington|King County|Pierce County|Snohomish County|Puget Sound)\b/i

export function createSeattle({ fetchFredSeries, fetchYahooQuote, fetchYahooSparkline, UA, dir, reMetro, bankruptcy }) {
  const file = n => path.join(dir, n)
  const load = n => { try { if (fs.existsSync(file(n))) return JSON.parse(fs.readFileSync(file(n), 'utf8')) } catch {} return null }
  const save = (n, o) => { try { fs.writeFileSync(file(n), JSON.stringify(o)) } catch (e) { console.error(`${n} save:`, e.message) } }
  let mem = null, inflight = null
  const fred = async (id, limit) => { try { const s = await fetchFredSeries(id, limit); return (s || []).filter(p => fin(p.v)) } catch { return [] } }

  // ── Indeed Hiring Lab: Seattle metro postings index, streamed out of the 62MB metro file ──
  async function postings() {
    const disk = load('seattle-postings.json')
    if (disk && Date.now() - disk.ts < 24 * H) return disk.data
    try {
      const r = await fetch('https://raw.githubusercontent.com/hiring-lab/job_postings_tracker/master/US/metro_job_postings_us.csv', { headers: { 'User-Agent': UA } })
      if (!r.ok || !r.body) throw new Error(`Indeed metro HTTP ${r.status}`)
      const dec = new TextDecoder(); let buf = ''; const sea = []
      for await (const chunk of r.body) {
        buf += dec.decode(chunk, { stream: true })
        let i
        while ((i = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, i); buf = buf.slice(i + 1)
          if (line.includes(',42660,')) { const m = line.match(/^(\d{4}-\d{2}-\d{2}),.*,42660,([\d.]+)/); if (m) sea.push({ d: m[1], v: +m[2] }) }
        }
      }
      const ru = await fetch('https://raw.githubusercontent.com/hiring-lab/job_postings_tracker/master/US/aggregate_job_postings_US.csv', { headers: { 'User-Agent': UA } })
      const us = ru.ok ? (await ru.text()).split('\n').map(l => l.split(',')).filter(c => c[0] && c[4] === 'total postings').map(c => ({ d: c[0], v: +c[2] })) : []
      if (sea.length < 100) throw new Error('too few Seattle rows')
      const data = { sea, us }
      save('seattle-postings.json', { data, ts: Date.now() })
      return data
    } catch (e) { console.warn('Indeed postings:', e.message); return disk?.data || { sea: [], us: [] } }
  }

  // ── WA ESD WARN notices: the public grid, first pages via postback, archived ──
  const unesc = s => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
  function parseWarn(html) {
    const g = html.slice(html.indexOf('id="ucPSW_gvMain"'))
    const out = []
    for (const rm of g.matchAll(/<tr[^>]*>(.*?)<\/tr>/gs)) {
      const cells = [...rm[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(m => unesc(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim())
      if (cells.length < 7 || !/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(cells[6])) continue
      const iso = s => { const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null }
      out.push({ company: cells[0], location: cells[1], start: iso(cells[2]), workers: +cells[3].replace(/[^\d]/g, '') || 0, kind: cells[4], type: cells[5], received: iso(cells[6]), puget: PUGET.test(cells[1]), statewide: /statewide/i.test(cells[1]) })
    }
    const hidden = Object.fromEntries([...html.matchAll(/<input type="hidden" name="(__[A-Z]+)"[^>]*value="([^"]*)"/g)].map(m => [m[1], m[2]]))
    return { rows: out, hidden }
  }
  async function warn() {
    const store = load('warn.json') || { notices: {} }
    const url = 'https://fortress.wa.gov/esd/file/WARN/Public/SearchWARN.aspx'
    let fetched = 0
    try {
      const r0 = await fetch(url, { headers: { 'User-Agent': UA } })
      if (!r0.ok) throw new Error(`WARN HTTP ${r0.status}`)
      const cookie = (r0.headers.get('set-cookie') || '').split(';')[0]
      let page = parseWarn(await r0.text())
      const add = rows => { for (const n of rows) { const k = `${n.company}|${n.received}|${n.location}`; if (!store.notices[k]) fetched++; store.notices[k] = n } }
      add(page.rows)
      for (let p = 2; p <= 4 && page.rows.length; p++) {
        const body = new URLSearchParams({ ...page.hidden, __EVENTTARGET: 'ucPSW$gvMain', __EVENTARGUMENT: `Page$${p}`, 'ucPSW$txtSearch': '' })
        const r = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded', ...(cookie ? { Cookie: cookie } : {}) }, body })
        if (!r.ok) break
        page = parseWarn(await r.text())
        add(page.rows)
        await sleep(400)
      }
    } catch (e) { console.warn('WARN:', e.message) }
    save('warn.json', store)
    const all = Object.values(store.notices).filter(n => n.received).sort((a, b) => b.received.localeCompare(a.received))
    const cut = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10)
    const win = (from, to, pred) => all.filter(n => n.received >= from && n.received < to && pred(n))
    const sum = rows => rows.reduce((s, n) => s + (n.workers || 0), 0)
    const p90 = win(cut(90), cut(-1), n => n.puget), p90prev = win(cut(180), cut(90), n => n.puget)
    const monthly = {}
    for (const n of all) { const k = n.received.slice(0, 7); const m = monthly[k] = monthly[k] || { d: k + '-01', puget: 0, other: 0, notices: 0 }; m[n.puget ? 'puget' : 'other'] += n.workers || 0; m.notices++ }
    return {
      notices: all.slice(0, 60), archived: all.length, since: all.length ? all[all.length - 1].received : null, newThisRun: fetched,
      puget90: { notices: p90.length, workers: sum(p90) }, puget90prev: { notices: p90prev.length, workers: sum(p90prev) },
      state90: { notices: win(cut(90), cut(-1), () => true).length, workers: sum(win(cut(90), cut(-1), () => true)) },
      monthly: Object.values(monthly).sort((a, b) => a.d.localeCompare(b.d)).slice(-24),
    }
  }

  async function build() {
    const [metro, bk, post] = await Promise.all([reMetro('42660').catch(() => null), bankruptcy().catch(() => null), postings()])

    // ── labor ──
    const ur = await fred('SEAT653UR', 400), urWa = await fred('WAUR', 400), urUs = await fred('UNRATE', 400)
    const urKing = await fred('WAKING5URN', 200), urPierce = await fred('WAPIER6URN', 200), urSnoh = await fred('WASNOH0URN', 200), urMsaN = await fred('SEAT653URN', 200)
    const pay = await fred('SEAT653NA', 440), payUs = await fred('PAYEMS', 440)
    const sectors = []
    for (const [id, label] of SECTORS) { const s = await fred(id, 200); if (s.length) sectors.push({ id, label, v: last(s).v, d: last(s).d, yoy: yoyPct(s, 12), chg1y: r1(last(s).v - (back(s, 12)?.v ?? NaN)), chg5y: yoyPct(s, 60), spark: s.slice(-36).map(p => r1(p.v)) }) }
    const totalNow = last(pay)?.v
    for (const s of sectors) s.share = fin(totalNow) ? r1((s.v / totalNow) * 100) : null
    const ahe = await fred('SMU53426600500000003', 200), aheUs = await fred('CES0500000003', 200)
    const claims = await fred('WAICLAIMS', 170), lf = await fred('SEAT653LFN', 200)
    const c4 = s => (s.length >= 4 ? mean(s.slice(-4).map(p => p.v)) : null), c4y = s => (s.length >= 56 ? mean(s.slice(-56, -52).map(p => p.v)) : null)
    const byMonth = (s, id) => { const m = new Map(); for (const p of s) m.set(ym(p.d), p.v); return m }
    const months = [...new Set([...ur, ...urWa, ...urUs].map(p => ym(p.d)))].sort().filter(m => m >= '2000-01')
    const mU = byMonth(ur), mW = byMonth(urWa), mUS = byMonth(urUs), mK = byMonth(urKing), mP = byMonth(urPierce), mS = byMonth(urSnoh)
    const urSeries = months.map(m => ({ d: m + '-01', msa: mU.get(m) ?? null, wa: mW.get(m) ?? null, us: mUS.get(m) ?? null, king: mK.get(m) ?? null, pierce: mP.get(m) ?? null, snoh: mS.get(m) ?? null }))
    const mPay = byMonth(pay), mPayUs = byMonth(payUs)
    const payYoy = [...mPay.keys()].sort().filter(m => m >= '2000-01').map(m => { const y = `${+m.slice(0, 4) - 1}${m.slice(4)}`; return { d: m + '-01', msa: r1(chg(mPay.get(m), mPay.get(y))), us: r1(chg(mPayUs.get(m), mPayUs.get(y))) } }).filter(p => fin(p.msa))
    const seaPost = post.sea || [], usPost = post.us || []
    const pIdx = (arr, daysBack) => { const t = new Date(Date.now() - daysBack * 864e5).toISOString().slice(0, 10); const pts = arr.filter(p => p.d <= t); return last(pts)?.v ?? null }
    const postSeries = (() => { const mu = new Map(usPost.map(p => [p.d, p.v])); return seaPost.filter((_, i) => i % 7 === 0).map(p => ({ d: p.d, sea: r1(p.v), us: fin(mu.get(p.d)) ? r1(mu.get(p.d)) : null })) })()
    const labor = {
      unemployment: { msa: last(ur)?.v ?? null, msaD: last(ur)?.d, msaChg1y: yoyDiff(ur, 12), msaPct: pctile(ur.map(p => p.v), last(ur)?.v), msaMin: r1(Math.min(...ur.map(p => p.v))), wa: last(urWa)?.v ?? null, us: last(urUs)?.v ?? null, usD: last(urUs)?.d, king: last(urKing)?.v ?? null, pierce: last(urPierce)?.v ?? null, snoh: last(urSnoh)?.v ?? null, countyD: last(urKing)?.d, msaNsa: last(urMsaN)?.v ?? null, series: urSeries, spark: ur.slice(-36).map(p => r1(p.v)) },
      payrolls: { total: totalNow ?? null, d: last(pay)?.d, yoy: yoyPct(pay, 12), yoyUs: yoyPct(payUs, 12), chg1y: fin(totalNow) ? r1(totalNow - (back(pay, 12)?.v ?? NaN)) : null, m3ann: pay.length > 3 ? r1((Math.pow(last(pay).v / back(pay, 3).v, 4) - 1) * 100) : null, sinceFeb2020: r1(chg(totalNow, pay.find(p => p.d.startsWith('2020-02'))?.v)), sectors: sectors.sort((a, b) => b.v - a.v), series: payYoy, spark: pay.slice(-36).map(p => r1(p.v)) },
      earnings: { ahe: last(ahe)?.v ?? null, aheYoy: yoyPct(ahe, 12), aheUs: last(aheUs)?.v ?? null, aheUsYoy: yoyPct(aheUs, 12), d: last(ahe)?.d, premium: fin(last(ahe)?.v) && fin(last(aheUs)?.v) ? r1((last(ahe).v / last(aheUs).v - 1) * 100) : null, spark: ahe.slice(-36).map(p => r1(p.v)) },
      claims: { wa4w: c4(claims) != null ? Math.round(c4(claims)) : null, wa4wYoy: r1(chg(c4(claims), c4y(claims))), d: last(claims)?.d, series: claims.slice(-104).map(p => ({ d: p.d, v: p.v })) },
      laborForce: { v: last(lf)?.v ?? null, yoy: yoyPct(lf, 12), d: last(lf)?.d },
      postings: { sea: pIdx(seaPost, 0), us: pIdx(usPost, 0), d: last(seaPost)?.d ?? null, seaChg30: r1(chg(pIdx(seaPost, 0), pIdx(seaPost, 30))), seaChg1y: r1(chg(pIdx(seaPost, 0), pIdx(seaPost, 365))), usChg1y: r1(chg(pIdx(usPost, 0), pIdx(usPost, 365))), series: postSeries, source: 'Indeed Hiring Lab job postings index, Feb 2020 = 100, 7-day trailing' },
    }

    // ── housing ──
    const csHigh = await fred('SEXRHTSA', 200), csLow = await fred('SEXRLTSA', 200)
    const act = await fred('ACTLISCOU42660', 130), nw = await fred('NEWLISCOU42660', 130), dom = await fred('MEDDAYONMAR42660', 130), mlp = await fred('MEDLISPRI42660', 130)
    const permits = await fred('SEAT653BPPRIVSA', 300), fhfa = await fred('ATNHPIUS42644Q', 210)
    const sum12 = s => (s.length >= 12 ? s.slice(-12).reduce((a, p) => a + p.v, 0) : null), sum12y = s => (s.length >= 24 ? s.slice(-24, -12).reduce((a, p) => a + p.v, 0) : null)
    const mAct = byMonth(act), mNew = byMonth(nw), mDom = byMonth(dom)
    const invSeries = [...mAct.keys()].sort().map(m => ({ d: m + '-01', active: mAct.get(m) ?? null, newl: mNew.get(m) ?? null, dom: mDom.get(m) ?? null }))
    const housing = {
      metro, tiers: { high: yoyPct(csHigh, 12), low: yoyPct(csLow, 12), d: last(csHigh)?.d },
      inventory: { active: last(act)?.v ?? null, activeYoy: yoyPct(act, 12), newl: last(nw)?.v ?? null, newYoy: yoyPct(nw, 12), dom: last(dom)?.v ?? null, dom1y: back(dom, 12)?.v ?? null, medList: last(mlp)?.v ?? null, medListYoy: yoyPct(mlp, 12), d: last(act)?.d, series: invSeries },
      permits: { m12: sum12(permits) != null ? Math.round(sum12(permits)) : null, m12Yoy: r1(chg(sum12(permits), sum12y(permits))), latest: last(permits)?.v ?? null, d: last(permits)?.d, pct: pctile(permits.map((_, i, a) => (i >= 11 ? a.slice(i - 11, i + 1).reduce((x, p) => x + p.v, 0) : null)), sum12(permits)), series: permits.filter((_, i) => i >= 11).map((p, i, a) => ({ d: p.d, v: permits.slice(i, i + 12).reduce((x, q) => x + q.v, 0) })).slice(-200) },
      fhfa: { yoy: yoyPct(fhfa, 4), d: last(fhfa)?.d, fromPeak: fhfa.length ? r1(chg(last(fhfa).v, Math.max(...fhfa.map(p => p.v)))) : null },
    }

    // ── prices ──
    const cpiSea = await fred('CUURA423SA0', 340), cpiUs = await fred('CPIAUCNS', 340), rentSea = await fred('CUURA423SEHA', 340), rentUs = await fred('CUUR0000SEHA', 340)
    const gasSea = await fred('APUS49D7471A', 200), gasUs = await fred('APU000074714', 200), rpp = await fred('RPPALL42660', 20)
    const yoyByMonth = s => { const m = byMonth(s); return [...m.keys()].sort().map(k => { const y = `${+k.slice(0, 4) - 1}${k.slice(4)}`; return { d: k + '-01', v: m.has(y) ? r1(chg(m.get(k), m.get(y))) : null } }).filter(p => fin(p.v)) }
    const cS = yoyByMonth(cpiSea), cU = yoyByMonth(cpiUs), rS = yoyByMonth(rentSea), rU = yoyByMonth(rentUs)
    const merge2 = (a, b) => { const mb = new Map(b.map(p => [p.d, p.v])); return a.filter(p => p.d >= '2000-01-01').map(p => ({ d: p.d, sea: p.v, us: mb.get(p.d) ?? null })) }
    const prices = {
      cpi: { sea: last(cS)?.v ?? null, us: last(cU)?.v ?? null, d: last(cS)?.d, usAtSameMonth: cU.find(p => p.d === last(cS)?.d)?.v ?? null, series: merge2(cS, cU), note: 'Seattle CPI is published for even-numbered months' },
      rent: { sea: last(rS)?.v ?? null, us: last(rU)?.v ?? null, d: last(rS)?.d, usAtSameMonth: rU.find(p => p.d === last(rS)?.d)?.v ?? null, series: merge2(rS, rU) },
      gas: { sea: r2(last(gasSea)?.v), us: r2(last(gasUs)?.v), d: last(gasSea)?.d, seaYoy: yoyPct(gasSea, 12), premium: fin(last(gasSea)?.v) && fin(last(gasUs)?.v) ? r1((last(gasSea).v / last(gasUs).v - 1) * 100) : null, series: gasSea.slice(-120).map((p, i, a) => ({ d: p.d, sea: p.v, us: gasUs.find(q => q.d === p.d)?.v ?? null })) },
      rpp: { v: r1(last(rpp)?.v), d: last(rpp)?.d },
    }

    // ── business ──
    const apps = await fred('BABATOTALSAWA', 280)
    const m12avg = (s, off = 0) => (s.length >= 12 + off ? mean(s.slice(-12 - off, off ? -off : undefined).map(p => p.v)) : null)
    const bkHome = bk?.board?.find(b => b.id === (bk.home || 'wawb')) || null
    const business = {
      bk: bk ? { score: bk.scores?.local?.score ?? null, tone: bk.scores?.local?.tone ?? null, label: bk.scores?.local?.label ?? null, why: bk.scores?.local?.why ?? null, q: bkHome?.q, total: bkHome?.total, yoy: bkHome?.yoy, t4: bkHome?.t4, t4Pct: bkHome?.t4Pct, bizCh11: bkHome?.bizCh11, bizCh11T4: bkHome?.bizCh11T4, bizCh11Pct: bkHome?.bizCh11Pct, live30: bkHome?.live30, liveCh11: (bk.live?.ch11Recent || []).filter(c => c.court === 'wawb').slice(0, 8), recent: (bk.recent?.wawb?.cases || []).filter(c => c.entity).slice(0, 12), series: (bk.districts?.['WA,W'] || []).slice(-40).map(r => ({ q: r.q, total: r.total, bizCh11: r.bizCh11 })) } : null,
      apps: { latest: last(apps)?.v ?? null, d: last(apps)?.d, m12: m12avg(apps) != null ? Math.round(m12avg(apps)) : null, m12Yoy: r1(chg(m12avg(apps), m12avg(apps, 12))), pct: pctile(apps.map(p => p.v), last(apps)?.v), series: apps.filter(p => p.d >= '2010-01-01').map(p => ({ d: p.d, v: p.v })) },
      warn: await warn(),
    }

    // ── growth & income (annual) ──
    const ann = async (id, label, unit, note) => { const s = await fred(id, 30); const L = last(s), P = back(s, 1), P5 = back(s, 5); return { id, label, unit, note, v: L?.v ?? null, d: L?.d ?? null, yoy: unit === '%' || unit === 'ratio' || unit === 'index' ? (L && P ? r2(L.v - P.v) : null) : yoyPct(s, 1), cagr5: L && P5 && P5.v > 0 && unit !== '%' && unit !== 'ratio' && unit !== 'index' ? r1((Math.pow(L.v / P5.v, 1 / 5) - 1) * 100) : null, spark: s.slice(-15).map(p => r2(p.v)) } }
    const growth = [
      await ann('REALGDPALL53033', 'King County real GDP', '$k, 2017$', 'BEA county GDP, thousands of chained dollars'),
      await ann('GDPALL53033', 'King County GDP, nominal', '$k', ''),
      await ann('PCPI53033', 'Per capita personal income, King', '$', 'BEA'),
      await ann('MHIWA53033A052NCEN', 'Median household income, King', '$', 'Census SAIPE'),
      await ann('STWPOP', 'MSA population', 'k', 'Seattle-Tacoma-Bellevue, thousands'),
      await ann('WAKING5POP', 'King County population', 'k', ''),
      await ann('HOWNRATEACS053033', 'Homeownership rate, King', '%', 'ACS 5-year'),
      await ann('DP04ACS053033', 'Cost-burdened households, King', '%', 'ACS 5-year: housing costs over 30% of income'),
      await ann('2020RATIO053033', 'Income inequality, King', 'ratio', 'ACS: mean income of top quintile ÷ bottom quintile'),
      await ann('RPPALL42660', 'Regional price parity, MSA', 'index', 'BEA, US = 100'),
    ].filter(r => fin(r.v))

    // ── the Puget Sound 12 ──
    const giants = []
    const weekly = {}
    for (const [sym, name, city] of [...GIANTS, ['SPY', 'S&P 500 (SPY)', '']]) {
      const [q, sp] = await Promise.all([fetchYahooQuote(sym).catch(() => null), fetchYahooSparkline(sym, '1y', '1wk').catch(() => [])])
      weekly[sym] = sp
      const yStart = sp.find(p => new Date(p.ts).getUTCFullYear() === new Date().getUTCFullYear())
      const ytd = q && yStart ? r1(chg(q.price, yStart.v)) : null, yr1 = q && sp.length ? r1(chg(q.price, sp[0].v)) : null
      giants.push({ sym, name, city, price: q?.price ?? null, chgPct: fin(q?.changePct) ? r2(q.changePct * 100) : null, ytd, yr1, spark: sp.map(p => r2(p.v)) })
      await sleep(120)
    }
    const spyW = weekly.SPY || []
    const index = spyW.map((p, i) => {
      const legs = GIANTS.map(([s]) => weekly[s]).filter(w => w && w.length > i && w[0]?.v)
      const ew = legs.length ? mean(legs.map(w => (w[i].v / w[0].v) * 100)) : null
      return { d: new Date(p.ts).toISOString().slice(0, 10), ps12: r1(ew), spy: r1((p.v / spyW[0].v) * 100) }
    })
    const spyRow = giants.find(g => g.sym === 'SPY'), ewYtd = mean(giants.filter(g => g.sym !== 'SPY').map(g => g.ytd)), ewYr = mean(giants.filter(g => g.sym !== 'SPY').map(g => g.yr1))

    // ── scores ──
    const U = labor.unemployment, P = labor.payrolls, J = labor.postings
    const laborScore = Math.round(mean([fin(U.msaPct) ? 100 - U.msaPct : null, fin(P.yoy) ? clamp(50 + P.yoy * 15, 0, 100) : null, fin(J.seaChg1y) ? clamp(50 + J.seaChg1y, 0, 100) : null, fin(labor.claims.wa4wYoy) ? clamp(50 - labor.claims.wa4wYoy / 2, 0, 100) : null]) ?? 50)
    const cs = metro?.caseShiller, inv = housing.inventory
    const housingScore = Math.round(mean([fin(cs?.yoy) ? clamp(50 + cs.yoy * 5, 0, 100) : null, fin(inv.activeYoy) ? clamp(50 - inv.activeYoy / 2, 0, 100) : null, fin(inv.dom) && fin(inv.dom1y) ? clamp(50 - (inv.dom - inv.dom1y) * 2, 0, 100) : null, fin(housing.permits.m12Yoy) ? clamp(50 + housing.permits.m12Yoy / 2, 0, 100) : null]) ?? 50)
    const pricesScore = Math.round(mean([fin(prices.cpi.sea) ? clamp(100 - prices.cpi.sea * 15, 0, 100) : null, fin(prices.rent.sea) ? clamp(100 - prices.rent.sea * 15, 0, 100) : null, fin(prices.cpi.sea) && fin(prices.cpi.usAtSameMonth) ? clamp(50 - (prices.cpi.sea - prices.cpi.usAtSameMonth) * 12, 0, 100) : null]) ?? 50)
    const W = business.warn
    const warnChg = W.puget90prev.workers ? chg(W.puget90.workers, W.puget90prev.workers) : null
    const businessScore = Math.round(mean([business.bk?.score ?? null, fin(business.apps.m12Yoy) ? clamp(50 + business.apps.m12Yoy * 2, 0, 100) : null, fin(warnChg) ? clamp(50 - warnChg / 3, 0, 100) : null]) ?? 50)
    const tone = s => (s >= 60 ? 'green' : s >= 35 ? 'amber' : 'red')
    const sg = v => (fin(v) ? `${v >= 0 ? '+' : ''}${v}` : '—')
    const scores = {
      labor: { score: laborScore, tone: tone(laborScore), label: laborScore >= 60 ? 'Labor market firm' : laborScore >= 35 ? 'Labor market cooling' : 'Labor market weak', why: `Unemployment ${U.msa}% in the metro (${U.msaPct}th percentile since 1994; King ${U.king}%, Pierce ${U.pierce}%, Snohomish ${U.snoh}%) vs ${U.wa}% for Washington and ${U.us}% nationally. Payrolls ${sg(P.yoy)}% year on year (US ${sg(P.yoyUs)}%), ${sg(P.sinceFeb2020)}% vs February 2020. Indeed postings ${fin(J.sea) ? `${J.sea} vs 100 in Feb 2020` : 'n/a'}, ${sg(J.seaChg1y)}% over a year (US ${sg(J.usChg1y)}%). Washington initial claims ${sg(labor.claims.wa4wYoy)}% on a four-week average.` },
      housing: { score: housingScore, tone: tone(housingScore), label: housingScore >= 60 ? 'Housing firm' : housingScore >= 35 ? 'Housing softening' : 'Housing correcting', why: `Case-Shiller Seattle ${sg(cs?.yoy)}% year on year (US ${sg(cs?.yoyUs)}%), ${sg(cs?.fromPeak)}% from its peak; high tier ${sg(housing.tiers.high)}%, low tier ${sg(housing.tiers.low)}%. Active listings ${sg(inv.activeYoy)}% year on year, median days on market ${inv.dom} vs ${inv.dom1y} a year ago. Permits ${Math.round(housing.permits.m12 ?? 0).toLocaleString()} units in twelve months, ${sg(housing.permits.m12Yoy)}%. Zillow rent ${sg(metro?.zillow?.zoriYoy)}%.` },
      prices: { score: pricesScore, tone: tone(pricesScore), label: pricesScore >= 60 ? 'Cost of living easing' : pricesScore >= 35 ? 'Cost of living sticky' : 'Cost of living squeezing', why: `Seattle CPI ${sg(prices.cpi.sea)}% year on year vs ${sg(prices.cpi.usAtSameMonth)}% nationally the same month; rent CPI ${sg(prices.rent.sea)}% vs ${sg(prices.rent.usAtSameMonth)}%. Gasoline $${prices.gas.sea?.toFixed(2)} vs $${prices.gas.us?.toFixed(2)} nationally (${sg(prices.gas.premium)}%). BEA prices the metro at ${prices.rpp.v?.toFixed(1)} with the US at 100.` },
      business: { score: businessScore, tone: tone(businessScore), label: businessScore >= 60 ? 'Business conditions healthy' : businessScore >= 35 ? 'Business stress building' : 'Business stress elevated', why: `${business.bk ? `W.D. Washington filings ${sg(business.bk.yoy)}% year on year, ${business.bk.bizCh11T4} business Chapter 11s in the trailing year (p${business.bk.bizCh11Pct} of the decade). ` : ''}WARN notices: ${W.puget90.workers.toLocaleString()} Puget Sound workers in ${W.puget90.notices} notices over 90 days${W.puget90prev.workers ? ` vs ${W.puget90prev.workers.toLocaleString()} the prior 90` : ''}. Washington business applications ${business.apps.m12?.toLocaleString()}/month on a 12-month average, ${sg(business.apps.m12Yoy)}%.` },
    }
    const worst = Object.entries(scores).sort((a, b) => a[1].score - b[1].score)[0]
    const avg = Math.round(mean(Object.values(scores).map(s => s.score)))
    const headline = {
      label: avg >= 60 ? 'Puget Sound holding up' : avg >= 45 ? `Puget Sound mixed — ${worst[1].label.toLowerCase()}` : 'Puget Sound under strain',
      color: avg >= 60 ? '#4ade80' : avg >= 45 ? '#fbbf24' : '#f87171',
      why: `Unemployment ${U.msa}% with payrolls ${sg(P.yoy)}% and job postings ${fin(J.sea) ? `${Math.round(100 - J.sea)}% below` : ''} their pre-pandemic level; home prices ${sg(cs?.yoy)}% and rents ${sg(metro?.zillow?.zoriYoy)}%; local CPI ${sg(prices.cpi.sea)}%. ${W.puget90.workers ? `${W.puget90.workers.toLocaleString()} WARN-notice layoffs in the region in 90 days` : ''}${business.bk ? `, ${business.bk.bizCh11T4} business Chapter 11s in a year` : ''}. The twelve Puget Sound majors are ${sg(r1(ewYtd))}% year to date, equal-weighted, vs ${sg(spyRow?.ytd)}% for the S&P 500.`,
    }

    return {
      headline, scores, labor, housing, prices, business, growth,
      giants: { rows: giants, index, ewYtd: r1(ewYtd), ewYr: r1(ewYr), spyYtd: spyRow?.ytd ?? null, spyYr: spyRow?.yr1 ?? null },
      source: 'BLS via FRED (LAUS unemployment, CES payrolls by sector, CPI, average prices), Indeed Hiring Lab, Zillow/Case-Shiller/Redfin via the Real Estate metro feed, Realtor.com inventory via FRED, Census permits and business applications, BEA county GDP and income, WA ESD WARN, U.S. Courts and the W.D. Washington docket via the bankruptcy tracker, Yahoo Finance quotes.',
      updated: new Date().toISOString(),
    }
  }

  async function get() {
    if (mem && Date.now() - mem.ts < TTL) return mem.data
    const disk = mem || load('seattle.json')
    if (disk && Date.now() - disk.ts < TTL) { mem = disk; return disk.data }
    if (inflight) return inflight
    inflight = (async () => {
      try { const data = await build(); mem = { data, ts: Date.now() }; save('seattle.json', mem); return data }
      catch (e) { console.warn('seattle:', e.message); if (disk) return disk.data; throw e }
      finally { inflight = null }
    })()
    return inflight
  }
  return { get }
}
