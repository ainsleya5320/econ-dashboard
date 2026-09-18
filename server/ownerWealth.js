// ============================================================================
// OWNER WEALTH — the Everywhere Millionaire question, with public data
// Zidar and Zwick's argument rests on de-identified IRS microdata linking
// businesses to their owners, which nobody outside Treasury can touch. The
// public substitutes get further than they are given credit for:
//   state    IRS SOI Historic Table 2 — returns by state and AGI bracket, with
//            income composition. The top bracket is $1M or more, and it carries
//            partnership/S-corp income separately, so "how many million-dollar
//            filers have pass-through income" is directly answerable.
//   county   the SOI county release, same shape one geography down. Its top
//            bracket is $200k or more rather than $1M — the finest public cut.
//   live     FRED's relay of BEA state proprietors' nonfarm income, quarterly
//            and current, which SOI's two-to-three-year lag cannot give.
//   book     Zwick's own Supplemental Data — the top-wealth-share series behind
//            the paper's figures — as a national reference line, so the gap
//            between the free proxies and the restricted estimates is visible.
// Tax-year files never change once published, so they are fetched once and kept
// permanently; only the FRED layer is refreshed. Cached 24h, disk-backed.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import XLSX from 'xlsx'
import { unzipEntries } from './realEstateFeeds.js'

const H = 3600e3, TTL = 24 * H
const fin = v => v != null && Number.isFinite(v)
const r1 = v => (fin(v) ? +v.toFixed(1) : null), r2 = v => (fin(v) ? +v.toFixed(2) : null)
const num = v => { const n = parseFloat(String(v ?? '').replace(/,/g, '').trim()); return Number.isFinite(n) ? n : 0 }
const sum = (xs, f) => xs.reduce((s, x) => s + f(x), 0)
// SOI includes rows that are not states: the US total and OA, foreign and
// military addresses. Both would distort a per-state concentration ranking.
const NOT_A_STATE = new Set(['US', 'OA', 'PR', 'VI', 'GU', 'AS', 'MP'])

// SOI state file: ten AGI brackets, the tenth being a million dollars or more.
// Amounts (A-prefixed columns) are thousands of dollars; counts (N-prefixed) are
// returns. Verified against the 2023 file rather than assumed from the codebook.
const STATE_STUBS = { 1: 'under $1', 2: '$1–10k', 3: '$10–25k', 4: '$25–50k', 5: '$50–75k', 6: '$75–100k', 7: '$100–200k', 8: '$200–500k', 9: '$500k–1M', 10: '$1M or more' }
const COUNTY_STUBS = { 1: 'under $1', 2: '$1–10k', 3: '$10–25k', 4: '$25–50k', 5: '$50–75k', 6: '$75–100k', 7: '$100–200k', 8: '$200k or more' }
const STATE_TOP = 10, COUNTY_TOP = 8
// the columns worth carrying: counts and amounts for the income types that
// distinguish an owner from an employee
const COLS = { returns: 'N1', agi: 'A00100', wagesN: 'N00200', wages: 'A00200', bizN: 'N00900', biz: 'A00900', pshipN: 'N26270', pship: 'A26270', capgainN: 'N01000', capgain: 'A01000', divN: 'N00600', div: 'A00600' }
const pick = r => Object.fromEntries(Object.entries(COLS).map(([k, c]) => [k, num(r[c] ?? r[c.toLowerCase()])]))

export function createOwnerWealth({ fetchFredSeries, UA, dir, homeState = 'WA' }) {
  const file = n => path.join(dir, n)
  const load = n => { try { if (fs.existsSync(file(n))) return JSON.parse(fs.readFileSync(file(n), 'utf8')) } catch {} return null }
  const save = (n, o) => { try { fs.writeFileSync(file(n), JSON.stringify(o)) } catch (e) { console.error(`${n} save:`, e.message) } }
  let mem = null, inflight = null
  // tax-year extracts, kept forever — a filed year does not change
  const archive = load('soi-archive.json') || { state: {}, county: {}, wealthShares: null }

  const get = async url => { const r = await fetch(url, { headers: { 'User-Agent': UA } }); if (!r.ok) throw new Error(`HTTP ${r.status} ${url.split('/').pop()}`); return r }
  const csvRows = text => {
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    const head = lines[0].split(',').map(h => h.trim())
    return lines.slice(1).map(l => {
      // SOI quotes any field containing a comma
      const out = []; let cur = '', q = false
      for (const ch of l) { if (ch === '"') q = !q; else if (ch === ',' && !q) { out.push(cur); cur = '' } else cur += ch }
      out.push(cur)
      return Object.fromEntries(head.map((h, i) => [h, out[i]]))
    })
  }

  // ── SOI state × AGI bracket ───────────────────────────────────────────────
  async function soiState(yy) {
    if (archive.state[yy]) return archive.state[yy]
    const r = await get(`https://www.irs.gov/pub/irs-soi/${yy}in55cmcsv.csv`)
    const rows = csvRows(await r.text()).filter(x => x.STATE && !NOT_A_STATE.has(x.STATE.trim()))
    const by = {}
    for (const x of rows) {
      const st = x.STATE.trim(), stub = +(x.AGI_STUB ?? x.agi_stub)
      if (!st || !Number.isFinite(stub)) continue
      ;(by[st] ||= {})[stub] = pick(x)
    }
    if (Object.keys(by).length < 40) throw new Error(`SOI state ${yy}: only ${Object.keys(by).length} states`)
    archive.state[yy] = by
    save('soi-archive.json', archive)
    return by
  }

  // ── SOI county × AGI bracket. The file is ~36 MB, so it is parsed once and
  // only the extract is kept: every county's top bracket, and every bracket for
  // the home state. ────────────────────────────────────────────────────────
  async function soiCounty(yy) {
    if (archive.county[yy]) return archive.county[yy]
    const r = await get(`https://www.irs.gov/pub/irs-soi/${yy}incyallagi.csv`)
    const rows = csvRows(await r.text())
    const top = [], home = []
    for (const x of rows) {
      const stub = +(x.agi_stub ?? x.AGI_STUB), st = (x.STATE || '').trim()
      const cf = (x.COUNTYFIPS || '').trim(), name = (x.COUNTYNAME || '').trim()
      if (!st || NOT_A_STATE.has(st) || !Number.isFinite(stub)) continue
      const isStateTotal = cf === '000' || cf === '0'
      const rec = { st, fips: `${(x.STATEFIPS || '').padStart(2, '0')}${cf.padStart(3, '0')}`, name, stub, stateTotal: isStateTotal, ...pick(x) }
      if (stub === COUNTY_TOP) top.push(rec)
      if (st === homeState) home.push(rec)
    }
    if (!top.length) throw new Error(`SOI county ${yy}: no top-bracket rows`)
    archive.county[yy] = { top, home, homeState }
    save('soi-archive.json', archive)
    return archive.county[yy]
  }

  // ── the book's own series, for contrast ──────────────────────────────────
  async function wealthShares() {
    if (archive.wealthShares) return archive.wealthShares
    try {
      const r = await get('https://www.ericzwick.com/wealth/Supplemental_data.zip')
      const entries = await unzipEntries(Buffer.from(await r.arrayBuffer()))
      const hit = entries.find(e => /TotalWealthShare\.xlsx$/i.test(e.name))
      if (!hit) throw new Error(`TotalWealthShare.xlsx not in the zip (${entries.map(e => e.name).join(', ')})`)
      const wb = XLSX.read(hit.data, { type: 'buffer' })
      const sheet = wb.Sheets[wb.SheetNames.find(n => /baseline/i.test(n))]
      if (!sheet) throw new Error(`Baseline sheet not found in ${wb.SheetNames.join(',')}`)
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1 }).filter(r => Number.isFinite(+r[0]) && +r[0] > 1900)
      const out = rows.map(r => ({ year: +r[0], bottom90: r2(+r[1]), top10: r2(+r[2]), top1: r2(+r[3]), top01: r2(+r[4]), top001: r2(+r[5]) })).filter(x => fin(x.top1))
      if (out.length < 20) throw new Error('too few rows')
      archive.wealthShares = { rows: out, source: 'Smith, Zidar & Zwick, Top Wealth in America — Supplemental Data, TotalWealthShare/Baseline', url: 'https://www.ericzwick.com/' }
      save('soi-archive.json', archive)
      return archive.wealthShares
    } catch (e) { console.warn('owner-wealth wealthShares:', e.message); return null }
  }

  async function build() {
    const t0 = Date.now()
    // SOI publishes roughly two years behind; walk back until a file exists
    const thisYY = +String(new Date().getFullYear()).slice(2)
    let state = null, taxYear = null
    for (let yy = thisYY - 2; yy >= thisYY - 5; yy--) {
      try { state = await soiState(String(yy).padStart(2, '0')); taxYear = 2000 + yy; break }
      catch (e) { console.warn(`owner-wealth SOI ${yy}:`, e.message) }
    }
    if (!state) throw new Error('no SOI state file found')
    const yy = String(taxYear - 2000).padStart(2, '0')
    const [county, shares] = await Promise.all([soiCounty(yy).catch(e => { console.warn('owner-wealth county:', e.message); return null }), wealthShares()])

    // ── states ──
    const codes = Object.keys(state).filter(c => !NOT_A_STATE.has(c)).sort()
    const natAll = sum(codes, c => state[c][0]?.returns || sum(Object.keys(state[c]).filter(s => +s > 0), s => state[c][s].returns))
    const natTop = sum(codes, c => state[c][STATE_TOP]?.returns || 0)
    const states = codes.map(c => {
      const b = state[c], t = b[STATE_TOP] || null
      const all = b[0]?.returns || sum(Object.keys(b).filter(s => +s > 0), s => b[s].returns)
      if (!t || !all) return null
      const inc = t.wages + t.pship + t.biz + t.capgain + t.div
      return {
        st: c, allReturns: all, topReturns: t.returns, topAgi: t.agi * 1000,
        perThousand: r1((t.returns / all) * 1000),
        shareOfTop: r2((t.returns / natTop) * 100), shareOfAll: r2((all / natAll) * 100),
        // the everywhere test: is this state's share of million-dollar filers
        // proportional to its share of all filers?
        index: r2((t.returns / natTop) / (all / natAll)),
        pshipReturns: t.pshipN, pshipShare: r1((t.pshipN / t.returns) * 100), pshipAmt: t.pship * 1000,
        bizReturns: t.bizN, bizShare: r1((t.bizN / t.returns) * 100),
        mix: inc > 0 ? { wages: r1((t.wages / inc) * 100), pship: r1((t.pship / inc) * 100), biz: r1((t.biz / inc) * 100), capgain: r1((t.capgain / inc) * 100), div: r1((t.div / inc) * 100) } : null,
        ladder: Object.keys(STATE_STUBS).map(s => ({ stub: +s, label: STATE_STUBS[s], ...(b[s] ? { returns: b[s].returns, agi: b[s].agi * 1000, pshipN: b[s].pshipN, pship: b[s].pship * 1000, bizN: b[s].bizN } : { returns: 0 }) })),
      }
    }).filter(Boolean)
    const home = states.find(s => s.st === homeState) || null

    // ── counties ──
    let counties = null
    if (county) {
      const nat = county.top.filter(r => !r.stateTotal && !NOT_A_STATE.has(r.st))
      const homeRows = county.home.filter(r => r.stub === COUNTY_TOP && !r.stateTotal)
      // the county release has no "all returns" row — brackets run 1..8 — so the
      // denominator for a rate is the sum of every bracket in that county
      const allBy = {}
      for (const r of county.home) if (!r.stateTotal) allBy[r.fips] = (allBy[r.fips] || 0) + r.returns
      const homeTotal = sum(homeRows, r => r.returns)
      counties = {
        stubLabel: COUNTY_STUBS[COUNTY_TOP], homeState,
        home: homeRows.sort((a, b) => b.returns - a.returns).map(r => ({
          fips: r.fips, name: r.name.replace(/ County$/, ''), returns: r.returns, agi: r.agi * 1000,
          shareOfState: r1((r.returns / homeTotal) * 100),
          perThousand: allBy[r.fips] ? r1((r.returns / allBy[r.fips]) * 1000) : null,
          pshipReturns: r.pshipN, pshipShare: r.returns ? r1((r.pshipN / r.returns) * 100) : null, bizReturns: r.bizN,
        })),
        nationalTop: nat.sort((a, b) => b.returns - a.returns).slice(0, 25).map(r => ({ st: r.st, name: r.name.replace(/ County$/, ''), returns: r.returns, agi: r.agi * 1000, pshipShare: r.returns ? r1((r.pshipN / r.returns) * 100) : null })),
        homeTotal,
      }
    }

    // ── the live layer: BEA state proprietors' nonfarm income via FRED ───────
    const prop = {}
    await Promise.all(states.map(async s => {
      const obs = await fetchFredSeries(`${s.st}ONON`, 60).catch(() => [])
      if (obs.length < 5) return
      const last = obs[obs.length - 1], yrAgo = obs[obs.length - 5] || obs[0]
      prop[s.st] = { v: last.v, d: last.d, yoy: r1(((last.v / yrAgo.v) - 1) * 100), spark: obs.slice(-24).map(o => r1(o.v)) }
    }))
    const usProp = Object.values(prop).reduce((a, b) => a + b.v, 0)
    for (const s of states) { const p = prop[s.st]; if (p) { s.proprietors = { ...p, shareOfUs: r2((p.v / usProp) * 100) } } }

    const sorted = [...states].sort((a, b) => b.index - a.index)
    return {
      ts: Date.now(), built: new Date().toISOString(), buildSecs: Math.round((Date.now() - t0) / 1000), ttlHours: TTL / H,
      taxYear, homeState, stateStubs: STATE_STUBS, countyStubs: COUNTY_STUBS,
      national: { topReturns: natTop, allReturns: natAll, topPerThousand: r1((natTop / natAll) * 1000),
        pshipReturns: sum(states, s => s.pshipReturns), pshipShare: r1((sum(states, s => s.pshipReturns) / natTop) * 100),
        proprietorsIncome: usProp, proprietorsAsOf: Object.values(prop)[0]?.d || null },
      states, home, counties, wealthShares: shares,
      spread: { mostConcentrated: sorted.slice(0, 5).map(s => ({ st: s.st, index: s.index })), leastConcentrated: sorted.slice(-5).reverse().map(s => ({ st: s.st, index: s.index })) },
      source: `IRS Statistics of Income, Historic Table 2 (returns by state and adjusted-gross-income bracket, tax year ${taxYear}) and the SOI county release for the same year; BEA state proprietors' nonfarm income relayed through FRED, quarterly and current; top wealth shares from Smith, Zidar and Zwick's published Supplemental Data. None of this reproduces the owner-to-firm link in the restricted microdata — it measures where high-income filers with pass-through income live, which is the closest public analogue.`,
    }
  }

  async function getPayload() {
    if (mem && Date.now() - mem.ts < TTL) return mem
    if (!mem) { const disk = load('owner-wealth.json'); if (disk && Date.now() - disk.ts < TTL) { mem = disk; return mem } }
    if (inflight) return inflight
    inflight = (async () => {
      try { const d = await build(); mem = d; save('owner-wealth.json', d); return d }
      catch (e) { console.warn('owner wealth build:', e.message); const disk = mem || load('owner-wealth.json'); if (disk) return disk; throw e }
      finally { inflight = null }
    })()
    return inflight
  }

  return { get: getPayload }
}

