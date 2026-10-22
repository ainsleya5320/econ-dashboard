// ============================================================================
// AI BUILD-OUT TRACKER — AI Economy → Build-Out. Two theses scored side by side:
//   funding loop (Craig Moffett): deals inside the AI complex move money around
//     without adding any; what matters is whether new dollars arrive from
//     outside it, or whether the build leans on debt, vendor financing and
//     off-balance-sheet structures;
//   productivity: AI already creates value (coding first), so productivity and
//     output per worker should rise.
// Both can hold at once (value created, captured by users rather than the
// builders), so value creation and value capture are scored separately.
//
// Sources (each verified before use, Oct 2026; see docs/ai-tracker.md):
//   SEC XBRL companyconcept (data.sec.gov, keyless; the five hyperscalers are
//     the `hyper` rows of server/capexReturns.js): capex (PaymentsToAcquire-
//     PropertyPlantAndEquipment / …ProductiveAssets), operating cash flow,
//     long-term debt proceeds (filers tag it four ways — merged), remaining
//     performance obligations (backlog), finance-lease right-of-use additions.
//     10-Q cash flows are year-to-date: quarters are un-cumulated from facts
//     sharing a start date; fiscal quarters map to the calendar quarter they
//     end in.
//   Dark Output feed (server/darkOutput.js, no new requests): Census QSS NAICS
//     518 revenue, BLS CES employment in software publishers and computer
//     systems design, BEA real software investment, BLS nonfarm productivity.
//   Census construction spending, privsatime.xlsx (monthly SAAR): the
//     "Data center" column of private construction.
//   Census BTOS National.xlsx: question 7 (business used AI in the last two
//     weeks) and 24 (expects to within six months), biweekly.
//   SF Fed utilization-adjusted TFP (quarterly_tfp.xlsx, dtfp_util). The file
//     must be requested with a query string: without one the CDN serves a
//     2023 copy.
//   FRED via the shared cache: A679RC1Q027SBEA (investment in information
//     processing equipment and software, nominal).
//   AI pulse feed (no new requests): H100 rental median, token-volume growth.
//   data/ai-tracker/manual-inputs.json (hand-kept, dated, sourced) and
//   data/ai-tracker/thresholds.json (the scoring rules — starting points).
// Staleness: a series is stale when its latest period ended more than
// 1.5 × its frequency + its usual publication lag ago. Cadence: 12 hours.
// Cache: ai-buildout.json at the root (gitignored).
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'
import { COMPANIES } from './capexReturns.js'

const H = 3600e3, DAY = 24 * H, TTL = 12 * H, RETRY = H
const SEC_UA = 'econ-dashboard personal research (AI build-out tracker)'
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 2) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const mean = xs => { const v = xs.filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const pct = (a, b) => (fin(a) && fin(b) && b !== 0 ? (a / b - 1) * 100 : null)
const scrub = s => String(s?.message || s || '').replace(/api_key=[^&\s"']+/gi, 'api_key=***').slice(0, 200)
const wait = ms => new Promise(r => setTimeout(r, ms))
const qOf = d => `${d.slice(0, 4)}-Q${Math.ceil(+d.slice(5, 7) / 3)}`
const qOrd = k => +k.slice(0, 4) * 4 + (+k.slice(6) - 1)
const qKey = o => `${Math.floor(o / 4)}-Q${(o % 4) + 1}`
const qEnd = k => { const y = +k.slice(0, 4), q = +k.slice(6); return new Date(Date.UTC(y, q * 3, 0)).toISOString().slice(0, 10) }
const mEnd = k => new Date(Date.UTC(+k.slice(0, 4), +k.slice(5, 7), 0)).toISOString().slice(0, 10)
const days = (a, b) => (Date.parse(b) - Date.parse(a)) / DAY
const usd = v => (!fin(v) ? null : Math.abs(v) >= 1000 ? `$${rnd(v / 1000, 2)}tn` : `$${rnd(v, 0)}bn`) // input in $bn

const HYPER = COMPANIES.filter(c => c.hyper)
const CONCEPTS = {
  capex: ['PaymentsToAcquirePropertyPlantAndEquipment', 'PaymentsToAcquireProductiveAssets'],
  ocf: ['NetCashProvidedByUsedInOperatingActivities'],
  debt: ['ProceedsFromIssuanceOfLongTermDebt', 'ProceedsFromIssuanceOfSeniorLongTermDebt', 'ProceedsFromDebtNetOfIssuanceCosts', 'ProceedsFromDebtMaturingInMoreThanThreeMonths'],
  rpo: ['RevenueRemainingPerformanceObligation'],
  leaseAdds: ['RightOfUseAssetObtainedInExchangeForFinanceLeaseLiability'],
}
const URLS = {
  vip: 'https://www.census.gov/construction/c30/xlsx/privsatime.xlsx',
  btos: 'https://www.census.gov/hfp/btos/downloads/National.xlsx',
  tfp: 'https://www.frbsf.org/wp-content/uploads/quarterly_tfp.xlsx',
}
const FREQ = { weekly: 7, biweekly: 14, monthly: 31, quarterly: 92, annual: 366 }

// quarterly flows from XBRL duration facts: direct 3-month facts first, else consecutive YTD differences
function quarterly(facts) {
  const byKey = new Map()
  for (const f of facts) { if (!f.start || !/^10-[QK]/.test(f.form)) continue; const k = `${f.start}|${f.end}`, prev = byKey.get(k); if (!prev || f.filed > prev.filed) byKey.set(k, f) }
  const all = [...byKey.values()], out = new Map()
  for (const f of all) { const len = days(f.start, f.end); if (len >= 80 && len <= 100) out.set(f.end, f.val) }
  const byStart = new Map(); for (const f of all) (byStart.get(f.start) || byStart.set(f.start, []).get(f.start)).push(f)
  for (const fs_ of byStart.values()) {
    fs_.sort((a, b) => a.end.localeCompare(b.end))
    for (let i = 1; i < fs_.length; i++) { const d = days(fs_[i - 1].end, fs_[i].end); if (d >= 80 && d <= 100 && !out.has(fs_[i].end)) out.set(fs_[i].end, fs_[i].val - fs_[i - 1].val) }
  }
  return [...out].sort((a, b) => a[0].localeCompare(b[0]))
}
const instants = facts => { const m = new Map(); for (const f of facts) { if (f.start || !/^10-[QK]/.test(f.form)) continue; const p = m.get(f.end); if (!p || f.filed > p.filed) m.set(f.end, f) } return [...m.values()].sort((a, b) => a.end.localeCompare(b.end)).map(f => [f.end, f.val]) }
// to calendar quarters (a fiscal quarter counts in the calendar quarter it ends in)
const toCal = pts => { const m = new Map(); for (const [d, v] of pts) m.set(qOf(d), (m.get(qOf(d)) || 0) + v); return [...m].sort((a, b) => a[0].localeCompare(b[0])) }
const ttm = pts => { const m = new Map(pts); return pts.map(([k]) => { const vs = [0, 1, 2, 3].map(i => m.get(qKey(qOrd(k) - i))); return [k, vs.every(fin) ? vs.reduce((a, b) => a + b, 0) : null] }).filter(p => fin(p[1])) }
const yoy4 = pts => { const m = new Map(pts); return pts.map(([k, v]) => [k, pct(v, m.get(qKey(qOrd(k) - 4)))]).filter(p => fin(p[1])) }
const decEnc = e => { const out = []; if (!e?.s) return out; let k = e.s; for (const v of e.v) { if (v != null) out.push([k, v]); k = e.f === 'Q' ? qKey(qOrd(k) + 1) : (() => { const o = +k.slice(0, 4) * 12 + (+k.slice(5, 7) - 1) + 1; return `${Math.floor(o / 12)}-${String((o % 12) + 1).padStart(2, '0')}` })() } return out }

export function createAiBuildout({ UA, dir, fred, darkOutput, aiPulse }) {
  const CACHE = 'ai-buildout.json', file = path.join(dir, CACHE)
  const cfg = n => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'data', 'ai-tracker', n), 'utf8')) } catch (e) { return { _error: e.message } } }
  const load = () => { try { if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8')) } catch (e) { console.warn(`${CACHE}: ${e.message}`) } return null }
  const save = o => { try { fs.writeFileSync(file, JSON.stringify(o)) } catch (e) { console.error(`${CACHE} save:`, e.message) } }
  let mem = null, raw = null, nextAt = 0, inflight = null, secUa = SEC_UA

  async function get_(url, { tries = 3, timeout = 60_000, ua = UA, accept = '*/*' } = {}) {
    for (let a = 0; ; a++) {
      let r
      try { r = await fetch(url, { headers: { 'User-Agent': ua, Accept: accept }, signal: AbortSignal.timeout(timeout) }); if (r.ok) return r }
      catch (e) { if (a < tries - 1) { await wait(2500 * (a + 1)); continue } throw new Error(scrub(e.cause?.code || e.message)) }
      if (r.status === 404) return null
      if ((r.status >= 500 || r.status === 429) && a < tries - 1) { await wait(2500 * (a + 1)); continue }
      throw new Error(`HTTP ${r.status}`)
    }
  }

  async function secConcept(cik, concept) {
    const url = `https://data.sec.gov/api/xbrl/companyconcept/CIK${cik}/us-gaap/${concept}.json`
    let r
    try { r = await get_(url, { ua: secUa, accept: 'application/json' }) }
    catch (e) { if (/HTTP 403/.test(e.message) && secUa !== UA) { secUa = UA; r = await get_(url, { ua: UA, accept: 'application/json' }) } else throw e }
    if (!r) return []
    const j = await r.json()
    return Object.values(j.units || {})[0] || []
  }
  async function fetchSec() {
    const out = {}
    for (const c of HYPER) {
      const row = {}
      for (const [k, list] of Object.entries(CONCEPTS)) {
        const facts = []
        for (const con of list) { facts.push(...(await secConcept(c.cik, con).catch(() => []))); await wait(120) }
        row[k] = facts.map(f => ({ start: f.start || null, end: f.end, val: f.val, form: f.form, filed: f.filed }))
      }
      out[c.t] = row
    }
    if (!Object.values(out).some(r => r.capex?.length)) throw new Error('SEC: no capex facts')
    return { asOf: new Date().toISOString(), companies: out }
  }
  async function fetchVip() {
    const buf = Buffer.from(await (await get_(URLS.vip)).arrayBuffer())
    const rows = XLSX.utils.sheet_to_json(XLSX.read(buf).Sheets[XLSX.read(buf).SheetNames[0]], { header: 1 })
    const hi = rows.findIndex(r => r.some(c => /data cent/i.test(String(c)))), ci = rows[hi].findIndex(c => /data cent/i.test(String(c)))
    const MON = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' }
    const pts = rows.slice(hi + 1).map(r => { const m = String(r[0] || '').match(/^([A-Z][a-z]{2})-(\d{2})/); return m && fin(+r[ci]) && r[ci] !== '' ? [`20${m[2]}-${MON[m[1]]}`, +r[ci] / 1000] : null }).filter(Boolean).sort((a, b) => a[0].localeCompare(b[0]))
    if (pts.length < 24) throw new Error('VIP: data-center column not found')
    return { asOf: new Date().toISOString(), series: pts }
  }
  async function fetchBtos() {
    const buf = Buffer.from(await (await get_(URLS.btos)).arrayBuffer()), wb = XLSX.read(buf)
    const rows = XLSX.utils.sheet_to_json(wb.Sheets['Response Estimates'], { header: 1 }), h = rows[0]
    const dates = XLSX.utils.sheet_to_json(wb.Sheets['Collection and Reference Dates'], { header: 1 }), hd = dates[0], iS = hd.indexOf('Smpdt'), iE = hd.indexOf('Ref End')
    const refEnd = new Map(dates.slice(1).map(r => [String(r[iS]), fin(+r[iE]) ? new Date(Date.UTC(1899, 11, 30) + +r[iE] * DAY).toISOString().slice(0, 10) : null]))
    const series = q => { const r = rows.find(x => x[0] === q && x[3] === 'Yes'); if (!r) return []; return h.slice(4).map((p, i) => [refEnd.get(String(p)), parseFloat(r[i + 4])]).filter(([d, v]) => d && fin(v)).sort((a, b) => a[0].localeCompare(b[0])) }
    const using = series(7), planning = series(24)
    if (using.length < 4) throw new Error('BTOS: AI question (7) not found')
    return { asOf: new Date().toISOString(), using, planning, wording: String(rows.find(x => x[0] === 7)?.[1] || '').slice(0, 220) }
  }
  async function fetchTfp() {
    const buf = Buffer.from(await (await get_(`${URLS.tfp}?${new Date().toISOString().slice(0, 10)}`)).arrayBuffer()), wb = XLSX.read(buf)
    const q = XLSX.utils.sheet_to_json(wb.Sheets.quarterly, { header: 1 }), hi = q.findIndex(r => r.includes('dtfp_util')), ci = q[hi].indexOf('dtfp_util'), cl = q[hi].indexOf('dLP')
    const pts = q.slice(hi + 1).filter(r => /^\d{4}:Q\d$/.test(String(r[0]))).map(r => [String(r[0]).replace(':', '-'), +r[ci], +r[cl]]).filter(p => fin(p[1]))
    const produced = XLSX.utils.sheet_to_json(wb.Sheets.readme, { header: 1 }).flat().find(x => /Produced on/i.test(String(x))) || null
    if (pts.length < 40) throw new Error('TFP: dtfp_util not found')
    return { asOf: new Date().toISOString(), series: pts, produced: produced ? String(produced).match(/Produced on ([A-Za-z]+ \d+, \d{4})/)?.[1] || null : null }
  }
  async function fetchFredBlock() {
    const obs = await fred('A679RC1Q027SBEA', 140)
    const pts = (obs || []).filter(o => fin(o.v)).map(o => [qOf(o.d), o.v])
    if (pts.length < 8) throw new Error('FRED A679RC1Q027SBEA: no observations (FRED may be down)')
    return { asOf: new Date().toISOString(), itInvestment: pts }
  }

  // ── scoring helpers ──
  const stale = (end, freq, lag) => (end ? days(end, new Date().toISOString().slice(0, 10)) > 1.5 * FREQ[freq] + lag : null)
  const sig = (o) => ({ status: 'nodata', ...o, stale: o.periodEnd ? stale(o.periodEnd, o.frequency, o.lag || 0) : null })

  function derive(R, meta) {
    const T = cfg('thresholds.json'), MI = cfg('manual-inputs.json')
    const D = meta.dark || null, P = meta.pulse || null
    // per-company quarterly (calendarized), $bn
    const companies = HYPER.map(c => {
      const s = R.sec?.companies?.[c.t]; if (!s) return null
      const flow = k => toCal(quarterly(s[k] || []).map(([d, v]) => [d, v / 1e9]))
      const capex = flow('capex'), ocf = flow('ocf'), debt = flow('debt'), leaseAdds = flow('leaseAdds')
      const rpo = instants(s.rpo || []).map(([d, v]) => [qOf(d), v / 1e9])
      const cT = new Map(ttm(capex)), oT = new Map(ttm(ocf))
      const ratio = [...cT].map(([k, v]) => [k, fin(oT.get(k)) && oT.get(k) > 0 ? v / oT.get(k) : null]).filter(p => fin(p[1]))
      return { t: c.t, name: c.name, color: c.color, capex, ocf, debt, rpo, leaseAdds, capexOcfTtm: ratio.map(([k, v]) => [k, rnd(v, 3)]) }
    }).filter(Boolean)
    // aggregate on quarters where every company reported (latest complete quarter)
    const agg = k => { const m = new Map(); for (const c of companies) for (const [q, v] of c[k]) { const e = m.get(q) || { n: 0, v: 0 }; e.n++; e.v += v; m.set(q, e) } return [...m].filter(([, e]) => e.n === companies.length).map(([q, e]) => [q, e.v]).sort((a, b) => a[0].localeCompare(b[0])) }
    const capexAgg = agg('capex'), ocfAgg = agg('ocf'), debtAgg = (() => { const m = new Map(); for (const c of companies) for (const [q, v] of c.debt) m.set(q, (m.get(q) || 0) + v); const qs = new Set(capexAgg.map(p => p[0])); return [...m].filter(([q]) => qs.has(q)).sort((a, b) => a[0].localeCompare(b[0])) })()
    const capexTtm = ttm(capexAgg), ocfTtm = new Map(ttm(ocfAgg))
    const ratioAgg = capexTtm.map(([k, v]) => [k, fin(ocfTtm.get(k)) ? v / ocfTtm.get(k) : null]).filter(p => fin(p[1]))
    // debt: fill missing quarters with zero for companies that issue rarely, so the trailing sum exists
    const debtFull = capexAgg.map(([q]) => [q, debtAgg.find(p => p[0] === q)?.[1] || 0])
    // backlog: summed only on quarters where every company still reporting it has filed (fiscal quarters end in different months)
    const rpoCos = companies.filter(c => c.rpo.length && c.rpo.at(-1)[0] >= qKey(qOrd(capexAgg.at(-1)?.[0] || '2000-Q1') - 4))
    const debtTtm = ttm(debtFull), rpoAgg = (() => { const m = new Map(); for (const c of rpoCos) for (const [q, v] of c.rpo) { const e = m.get(q) || { n: 0, v: 0 }; e.n++; e.v += v; m.set(q, e) } return [...m].filter(([, e]) => e.n === rpoCos.length).map(([q, e]) => [q, e.v]).sort((a, b) => a[0].localeCompare(b[0])) })()
    const lastQ = capexAgg.at(-1)?.[0] || null

    const signals = []
    // A1 capex ÷ operating cash flow
    { const th = T.capexOcf || {}, l = ratioAgg.at(-1), b4 = ratioAgg.find(p => p[0] === qKey(qOrd(l?.[0] || '2000-Q1') - 4))
      const rising = l && b4 ? l[1] > b4[1] : null
      let status = 'neutral', why = `Capex is ${rnd(l?.[1] * 100, 0)}% of operating cash flow over the last four quarters${b4 ? `, ${rising ? 'up' : 'down'} from ${rnd(b4[1] * 100, 0)}% a year earlier` : ''}.`
      if (l && l[1] > th.moffettAbove && (!th.moffettRequiresRising || rising)) { status = 'moffett'; why += ` Above ${th.moffettAbove * 100}% and rising: the build is consuming nearly all internally generated cash.` }
      else if (l && l[1] < th.productivityBelow) { status = 'productivity'; why += ` Below ${th.productivityBelow * 100}%: comfortably self-funded.` }
      signals.push(sig({ id: 'capexOcf', panel: 'A', label: 'Capex ÷ operating cash flow (5 hyperscalers, trailing 4Q)', value: rnd(l?.[1], 3), display: l ? `${rnd(l[1] * 100, 0)}%` : null, status: l ? status : 'nodata', why, period: l?.[0], periodEnd: l ? qEnd(l[0]) : null, frequency: 'quarterly', lag: 50, series: ratioAgg.map(([k, v]) => [k, rnd(v * 100, 1)]), unit: '% of OCF', source_name: 'SEC EDGAR XBRL (10-Q / 10-K)', source_url: 'https://www.sec.gov/edgar/sec-api-documentation', fetched_at: R.sec?.asOf, note: 'Microsoft and Amazon also add capacity through finance leases, so reported capex understates the build (see finance-lease additions).' })) }
    // A2 debt issuance
    { const th = T.debtIssuance || {}, l = debtTtm.at(-1), b = debtTtm.find(p => p[0] === qKey(qOrd(l?.[0] || '2000-Q1') - 4)), g = pct(l?.[1], b?.[1])
      const status = !l ? 'nodata' : fin(g) && g > th.moffettYoyAbovePct ? 'moffett' : 'neutral'
      signals.push(sig({ id: 'debt', panel: 'A', label: 'Long-term debt raised (5 hyperscalers, trailing 4Q)', value: rnd(l?.[1], 1), display: l ? `$${rnd(l[1], 0)}bn` : null, status, why: l ? `$${rnd(l[1], 0)}bn raised over the last four quarters${fin(g) ? `, ${g >= 0 ? 'up' : 'down'} ${rnd(Math.abs(g), 0)}% on the year before` : ''}.${status === 'moffett' ? ` More than ${th.moffettYoyAbovePct}% growth: borrowing is taking over from cash flow.` : ''}` : '', period: l?.[0], periodEnd: l ? qEnd(l[0]) : null, frequency: 'quarterly', lag: 50, series: debtTtm.map(([k, v]) => [k, rnd(v, 1)]), unit: '$bn', source_name: 'SEC EDGAR XBRL (debt proceeds, four tags merged)', source_url: 'https://www.sec.gov/edgar/sec-api-documentation', fetched_at: R.sec?.asOf })) }
    // A3 backlog (context)
    { const l = rpoAgg.at(-1), b = rpoAgg.find(p => p[0] === qKey(qOrd(l?.[0] || '2000-Q1') - 4)), withRpo = rpoCos.map(c => c.name)
      signals.push(sig({ id: 'rpo', panel: 'A', label: 'Contracted backlog (remaining performance obligations)', value: rnd(l?.[1], 0), display: usd(l?.[1]), status: l ? 'context' : 'nodata', why: l ? `${usd(l[1])} of signed-but-unbilled contracts at ${withRpo.join(', ')}${b ? `, ${pct(l[1], b[1]) >= 0 ? 'up' : 'down'} ${rnd(Math.abs(pct(l[1], b[1])), 0)}% on a year` : ''}. Backlog is demand, but concentration matters: a few AI labs account for much of it (manual note below). Amazon stopped tagging backlog in 2020 and Meta reports none.` : '', period: l?.[0], periodEnd: l ? qEnd(l[0]) : null, frequency: 'quarterly', lag: 50, series: rpoAgg.map(([k, v]) => [k, rnd(v, 0)]), unit: '$bn', source_name: 'SEC EDGAR XBRL', source_url: 'https://www.sec.gov/edgar/sec-api-documentation', fetched_at: R.sec?.asOf })) }
    // A4 off-balance-sheet / vendor-financing events (manual)
    { const ev = (MI.events || []).filter(e => !e.example), cutoff = new Date(Date.now() - 365 * DAY).toISOString().slice(0, 10), n12 = ev.filter(e => e.date >= cutoff).length, th = T.offBalanceSheet || {}
      const status = !ev.length ? 'nodata' : fin(th.moffettEventsTrailing12m) && n12 >= th.moffettEventsTrailing12m ? 'moffett' : 'context'
      signals.push(sig({ id: 'obs', panel: 'A', label: 'Off-balance-sheet and vendor-financing events (manual log)', value: n12, display: `${n12} in 12 months`, status, why: ev.length ? `${n12} logged in the last twelve months (${ev.length} in all): SPVs, leases not yet commenced, and chipmakers financing or investing in their customers.` : 'No events logged yet — add them to data/ai-tracker/manual-inputs.json.', period: ev.map(e => e.date).sort().at(-1) || null, periodEnd: null, frequency: 'monthly', unit: 'events', source_name: 'Hand-kept log (10-Q footnotes, filings, press)', source_url: null, fetched_at: null })) }
    // B5 QSS 518 vs capex
    { const th = T.qssVsCapex || {}, svc = D?.services?.industries?.find(i => i.id === 'dataproc')
      const qssTtm = svc ? ttm(svc.revenue.map(([k, v]) => [k, v])) : [], qY = new Map(yoy4(qssTtm)), cY = new Map(yoy4(capexTtm))
      const rows = [...qY.keys()].filter(k => cY.has(k)).sort().map(k => [k, rnd(qY.get(k), 1), rnd(cY.get(k), 1), rnd(qY.get(k) - cY.get(k), 1)])
      const l = rows.at(-1), gap = l?.[3]
      const status = !l ? 'nodata' : gap < th.moffettBelowPp ? 'moffett' : gap > th.productivityAbovePp ? 'productivity' : 'neutral'
      signals.push(sig({ id: 'qssVsCapex', panel: 'B', label: 'Outside revenue vs the spend: QSS 518 growth minus capex growth', value: gap, display: fin(gap) ? `${gap > 0 ? '+' : ''}${gap} pp` : null, status, why: l ? `Revenue at U.S. computing-infrastructure and hosting firms (NAICS 518) grew ${l[1]}% over the last four quarters against ${l[2]}% for hyperscaler capex — a gap of ${gap} points. ${status === 'moffett' ? 'Spending is running far ahead of the revenue it is meant to earn.' : status === 'productivity' ? 'Revenue from customers is keeping pace with the spend.' : 'Spending is ahead of revenue, but not by the margin that signals a funding loop.'}` : 'Needs both the Census QSS (via Dark Output) and SEC capex.', period: l?.[0], periodEnd: l ? qEnd(l[0]) : null, frequency: 'quarterly', lag: 80, series: rows.map(r => [r[0], r[1], r[2]]), seriesCols: ['QSS 518 revenue, 4Q y/y %', 'Hyperscaler capex, 4Q y/y %'], unit: 'pp', source_name: 'Census Quarterly Services Survey (NAICS 518) and SEC XBRL', source_url: 'https://www.census.gov/services/index.html', fetched_at: D?.built })) }
    // B6 investment in IT equipment and software (context)
    { const pts = R.fred?.itInvestment || [], Y = yoy4(pts), l = Y.at(-1)
      signals.push(sig({ id: 'itInvestment', panel: 'B', label: 'Business investment in IT equipment and software (BEA)', value: rnd(pts.at(-1)?.[1], 0), display: pts.length ? `$${rnd(pts.at(-1)[1] / 1000, 2)}tn SAAR` : null, status: pts.length ? 'context' : 'nodata', why: l ? `${l[1] >= 0 ? 'Up' : 'Down'} ${rnd(Math.abs(l[1]), 1)}% on a year (nominal). This is the economy-wide spend the hyperscalers are part of.` : '', period: pts.at(-1)?.[0], periodEnd: pts.length ? qEnd(pts.at(-1)[0]) : null, frequency: 'quarterly', lag: 60, series: Y.map(([k, v]) => [k, rnd(v, 1)]), unit: '% y/y', source_name: 'BEA NIPA via FRED (A679RC1Q027SBEA)', source_url: 'https://fred.stlouisfed.org/series/A679RC1Q027SBEA', fetched_at: R.fred?.asOf })) }
    // B7 data-center construction (context)
    { const pts = R.vip?.series || [], l = pts.at(-1), b = pts.find(p => p[0] === `${+l?.[0]?.slice(0, 4) - 1}${l?.[0]?.slice(4)}`)
      signals.push(sig({ id: 'dcConstruction', panel: 'B', label: 'Data-center construction spending (Census)', value: rnd(l?.[1], 1), display: l ? `$${rnd(l[1], 1)}bn SAAR` : null, status: l ? 'context' : 'nodata', why: l ? `$${rnd(l[1], 1)}bn at an annual rate${b ? `, ${pct(l[1], b[1]) >= 0 ? 'up' : 'down'} ${rnd(Math.abs(pct(l[1], b[1])), 0)}% on a year` : ''}. The shells; the chips inside are in the capex figures.` : '', period: l?.[0], periodEnd: l ? mEnd(l[0]) : null, frequency: 'monthly', lag: 35, series: pts.filter(p => p[0] >= '2016-01').map(([k, v]) => [k, rnd(v, 2)]), unit: '$bn SAAR', source_name: 'Census Value of Construction Put in Place (private, SA)', source_url: 'https://www.census.gov/construction/c30/c30index.html', fetched_at: R.vip?.asOf })) }
    // B8 business AI adoption (context)
    { const u = R.btos?.using || [], pl = R.btos?.planning || [], l = u.at(-1)
      const yAgo = [...u].reverse().find(p => days(p[0], l?.[0]) >= 350)
      signals.push(sig({ id: 'btos', panel: 'B', label: 'Share of U.S. firms using AI (Census BTOS)', value: l?.[1], display: l ? `${l[1]}%` : null, status: l ? 'context' : 'nodata', why: l ? `${l[1]}% of businesses used AI in the latest two-week survey${yAgo ? `, up from ${yAgo[1]}% a year earlier` : ''}; ${pl.at(-1)?.[1]}% expect to within six months. Census now words the question "Super Intelligence or SI (formerly AI)"; this version of the question starts in late 2025.` : '', period: l?.[0], periodEnd: l?.[0], frequency: 'biweekly', lag: 14, series: u.map(([d, v], i) => [d, v, pl.find(p => p[0] === d)?.[1] ?? null]), seriesCols: ['Using AI now', 'Expect to within 6 months'], unit: '% of firms', source_name: 'Census Business Trends and Outlook Survey (national)', source_url: 'https://www.census.gov/hfp/btos/data_downloads', fetched_at: R.btos?.asOf })) }
    // B9 context from the AI pulse: GPU rental and token volume (automated elsewhere)
    { const h100 = P?.gpu?.vast?.find?.(v => v.gpu === 'H100 SXM')?.median ?? P?.compute?.h100 ?? null, g52 = P?.tokens?.growth?.w52 ?? null
      signals.push(sig({ id: 'pulse', panel: 'B', label: 'GPU rental and token volume (AI pulse)', value: g52, display: fin(g52) ? `tokens ${rnd(1 + g52 / 100, 1)}× y/y` : null, status: fin(g52) ? 'context' : 'nodata', why: `OpenRouter token volume ${fin(g52) ? `${rnd(1 + g52 / 100, 1)} times its level a year ago` : 'unavailable'}${fin(h100) ? `; H100 rental median $${rnd(h100, 2)}/hr` : ''}. Detail lives on AI Economy → Tokens and Compute.`, period: null, periodEnd: null, frequency: 'weekly', unit: '', source_name: 'AI pulse (OpenRouter, Vast.ai and others)', source_url: null, fetched_at: P?.updated || null })) }
    // C10 utilization-adjusted TFP
    { const th = T.tfp || {}, pts = R.tfp?.series || [], w = th.window || 8, base = th.baseline || ['2010-Q1', '2019-Q4']
      const recent = mean(pts.slice(-w).map(p => p[1])), baseAvg = mean(pts.filter(p => p[0] >= base[0] && p[0] <= base[1]).map(p => p[1])), l = pts.at(-1)
      const status = !l ? 'nodata' : recent > baseAvg ? 'productivity' : 'neutral'
      const roll = pts.map((p, i) => [p[0], i >= w - 1 ? rnd(mean(pts.slice(i - w + 1, i + 1).map(x => x[1])), 2) : null]).filter(p => p[0] >= '2005-Q1')
      signals.push(sig({ id: 'tfp', panel: 'C', label: 'Utilization-adjusted TFP (SF Fed)', value: rnd(recent, 2), display: fin(recent) ? `${rnd(recent, 2)}%/yr` : null, status, why: l ? `Over the last ${w} quarters utilization-adjusted TFP grew ${rnd(recent, 2)}% a year on average, against ${rnd(baseAvg, 2)}% in ${base[0].slice(0, 4)}–${base[1].slice(0, 4)}. ${status === 'productivity' ? 'Faster than the 2010s: consistent with technology lifting output per unit of input.' : 'Not yet faster than the 2010s.'} The series is noisy quarter to quarter and revised.` : '', period: l?.[0], periodEnd: l ? qEnd(l[0]) : null, frequency: 'quarterly', lag: 100, series: roll, seriesCols: [`TFP, ${w}-quarter average (annualized %)`], baseline: rnd(baseAvg, 2), unit: '%/yr', source_name: `SF Fed, Fernald utilization-adjusted TFP${R.tfp?.produced ? ` (produced ${R.tfp.produced})` : ''}`, source_url: 'https://www.frbsf.org/research-and-insights/data-and-indicators/total-factor-productivity-tfp/', fetched_at: R.tfp?.asOf })) }
    // C11 labor productivity (BLS via Dark Output raw)
    { const th = T.laborProductivity || {}, rawD = meta.darkRaw, idx = decEnc(rawD?.bls?.series?.PRS85006093), w = th.window || 8, base = th.baseline || ['2010-Q1', '2019-Q4']
      const ann = idx.map(([k, v], i) => [k, i > 0 ? (Math.pow(v / idx[i - 1][1], 4) - 1) * 100 : null]).filter(p => fin(p[1]))
      const recent = mean(ann.slice(-w).map(p => p[1])), baseAvg = mean(ann.filter(p => p[0] >= base[0] && p[0] <= base[1]).map(p => p[1])), l = ann.at(-1)
      const status = !l ? 'nodata' : recent > baseAvg ? 'productivity' : 'neutral'
      signals.push(sig({ id: 'laborProductivity', panel: 'C', label: 'Nonfarm business labor productivity (BLS)', value: rnd(recent, 2), display: fin(recent) ? `${rnd(recent, 2)}%/yr` : null, status, why: l ? `Output per hour grew ${rnd(recent, 2)}% a year over the last ${w} quarters against ${rnd(baseAvg, 2)}% in the 2010s.` : '', period: l?.[0], periodEnd: l ? qEnd(l[0]) : null, frequency: 'quarterly', lag: 45, series: ann.map((p, i) => [p[0], i >= w - 1 ? rnd(mean(ann.slice(i - w + 1, i + 1).map(x => x[1])), 2) : null]).filter(p => p[0] >= '2005-Q1'), seriesCols: [`${w}-quarter average, annualized %`], baseline: rnd(baseAvg, 2), unit: '%/yr', source_name: 'BLS productivity (PRS85006093 = FRED OPHNFB)', source_url: 'https://fred.stlouisfed.org/series/OPHNFB', fetched_at: D?.built })) }
    // C12 software output vs headcount
    { const th = T.softwareOutputVsJobs || {}, rawD = meta.darkRaw, real = decEnc(rawD?.nipa?.series?.softwareReal)
      const L = D?.labor?.industries || [], emp = ['software', 'compsys'].map(id => L.find(i => i.id === id)?.emp || [])
      const empQ = (() => { const m = new Map(); for (const s of emp) for (const [mo, v] of s) { const q = qOf(`${mo}-01`), e = m.get(q) || { s: 0, n: 0 }; e.s += v; e.n++; m.set(q, e) } return [...m].filter(([, e]) => e.n === 6).map(([q, e]) => [q, e.s / 3]).sort((a, b) => a[0].localeCompare(b[0])) })()
      const oY = new Map(yoy4(real)), eY = new Map(yoy4(empQ)), rows = [...oY.keys()].filter(k => eY.has(k)).sort().map(k => [k, rnd(oY.get(k), 1), rnd(eY.get(k), 1)])
      const l = rows.at(-1), gap = l ? rnd(l[1] - l[2], 1) : null
      const status = !l ? 'nodata' : gap > th.productivityAbovePp ? 'productivity' : 'neutral'
      signals.push(sig({ id: 'softwareOutput', panel: 'C', label: 'Software output vs software headcount', value: gap, display: fin(gap) ? `${gap > 0 ? '+' : ''}${gap} pp` : null, status, why: l ? `Real software investment grew ${l[1]}% on a year while employment in software publishing and computer systems design changed ${l[2]}% — ${gap} points of output per worker. ${status === 'productivity' ? 'More software is being produced per programmer.' : 'Not yet a clear gain in output per worker.'}` : 'Needs the Dark Output feed (BEA real software investment and BLS employment).', period: l?.[0], periodEnd: l ? qEnd(l[0]) : null, frequency: 'quarterly', lag: 60, series: rows, seriesCols: ['Real software investment, y/y %', 'Software employment, y/y %'], unit: 'pp', source_name: 'BEA real software investment (B985RX) and BLS CES (software publishers, computer systems design)', source_url: 'https://fred.stlouisfed.org/series/B985RX1Q020SBEA', fetched_at: D?.built })) }

    // panel reads and the synthesis line
    const panelRead = p => { const s = signals.filter(x => x.panel === p && ['moffett', 'productivity', 'neutral'].includes(x.status)); const m = s.filter(x => x.status === 'moffett').length, pr = s.filter(x => x.status === 'productivity').length; return !s.length ? 'nodata' : m > pr ? 'moffett' : pr > m ? 'productivity' : 'neutral' }
    const A = panelRead('A'), B = panelRead('B'), Cc = panelRead('C')
    const line = A === 'moffett' && Cc === 'productivity' ? 'Both theses holding — gains accruing to users, not builders.'
      : A === 'moffett' && Cc !== 'productivity' ? 'Funding-loop risk without the productivity payoff yet: the build is leaning on internal cash and borrowing, and the economy-wide gains are not visible.'
      : A !== 'moffett' && Cc === 'productivity' ? 'Productivity thesis leading: the gains are showing up and the build still looks self-funded.'
      : A === 'productivity' ? 'The build looks self-funded; the productivity payoff is not visible yet.'
      : 'Neither thesis has decisive data yet.'
    const boundary = B === 'moffett' ? ' At the boundary, outside revenue is not keeping pace with the spend.' : B === 'productivity' ? ' At the boundary, outside revenue is keeping pace with the spend.' : ''
    return {
      built: new Date().toISOString(), stale: !!meta.stale, sourceErrors: meta.sourceErrors || [], sources: meta.sources || [],
      synthesis: { A, B, C: Cc, line: line + boundary },
      top3: ['capexOcf', 'qssVsCapex', 'tfp'],
      signals,
      companies: companies.map(c => ({ ...c, capex: c.capex.slice(-16).map(([k, v]) => [k, rnd(v, 2)]), ocf: c.ocf.slice(-16).map(([k, v]) => [k, rnd(v, 2)]), debt: c.debt.slice(-16).map(([k, v]) => [k, rnd(v, 2)]), rpo: c.rpo.slice(-16).map(([k, v]) => [k, rnd(v, 1)]), leaseAdds: c.leaseAdds.slice(-16).map(([k, v]) => [k, rnd(v, 2)]), capexOcfTtm: c.capexOcfTtm.slice(-16) })),
      lastQuarter: lastQ,
      events: (MI.events || []), manualSeries: MI.series || {}, manualError: MI._error || null,
      thresholds: T, thresholdsError: T._error || null,
      secUserAgent: secUa === SEC_UA ? 'descriptive' : 'browser fallback',
    }
  }

  async function build() {
    const prev = raw || load()?.raw || null, R = {}, errs = [], sources = []
    const jobs = { sec: fetchSec, vip: fetchVip, btos: fetchBtos, tfp: fetchTfp, fred: fetchFredBlock }
    const label = { sec: 'SEC EDGAR XBRL (hyperscaler capex, cash flow, debt, backlog, leases)', vip: 'Census construction spending (data centers)', btos: 'Census BTOS (AI use)', tfp: 'SF Fed utilization-adjusted TFP', fred: 'BEA IT investment via FRED' }
    const res = await Promise.allSettled(Object.values(jobs).map(f => f()))
    Object.keys(jobs).forEach((k, i) => {
      const r = res[i]
      if (r.status === 'fulfilled') { R[k] = r.value; sources.push({ id: k, label: label[k], fetched: r.value.asOf, from: 'live' }); return }
      if (prev?.[k]) R[k] = prev[k]
      errs.push(`${label[k]}: ${scrub(r.reason)}${prev?.[k] ? ' — serving the cached copy' : ''}`)
      sources.push({ id: k, label: label[k], fetched: prev?.[k]?.asOf || null, from: prev?.[k] ? 'cache' : 'none' })
    })
    return { R, errs, sources }
  }
  async function context() {
    const [dark, pulse] = await Promise.all([darkOutput?.get?.().catch(() => null), aiPulse?.get?.().catch(() => null)])
    return { dark, pulse, darkRaw: darkOutput?.rawBlocks?.() || null }
  }

  function refresh() {
    if (inflight) return inflight
    inflight = (async () => {
      try {
        const [{ R, errs, sources }, ctx] = await Promise.all([build(), context()])
        if (!Object.keys(R).length) throw new Error(errs.join('; '))
        mem = derive(R, { stale: errs.length > 0, sourceErrors: errs, sources, ...ctx }); raw = R; nextAt = Date.now() + (errs.length ? RETRY : TTL)
        save({ version: 1, nextAt, built: mem.built, raw: R, meta: { sourceErrors: errs, sources } })
        return mem
      } catch (e) {
        console.warn('AI build-out:', scrub(e)); nextAt = Date.now() + RETRY
        if (mem) return { ...mem, stale: true }
        throw e
      } finally { inflight = null }
    })()
    return inflight
  }

  async function get() {
    if (!mem) {
      const disk = load()
      // re-derive from cached raw (and the live config files, so threshold edits apply at once)
      if (disk?.version === 1 && disk.raw) { raw = disk.raw; nextAt = disk.nextAt || 0; try { mem = derive(raw, { ...(disk.meta || {}), ...(await context()) }); mem.built = disk.built || mem.built } catch (e) { console.warn('AI build-out re-derive:', e.message) } }
    } else if (raw) {
      // thresholds and manual inputs are read on every call, so edits show without a refetch
      try { const ctx = await context(); mem = { ...derive(raw, { stale: mem.stale, sourceErrors: mem.sourceErrors, sources: mem.sources, ...ctx }), built: mem.built } } catch {}
    }
    if (mem && Date.now() < nextAt) return mem
    if (mem) { refresh().catch(() => {}); return { ...mem, stale: true } }
    return refresh()
  }

  return { get }
}
