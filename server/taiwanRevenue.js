// ============================================================================
// TAIWAN MONTHLY REVENUE — AI Economy → Supply Chain: the AI hardware supply
// chain, month by month. Every Taiwan-listed company must publish the prior
// month's revenue by the 10th, so the foundry, the packagers, the server
// builders and the board, cooling and memory makers report five to eight weeks
// before any hyperscaler says what it spent.
//
// Source: the exchange's Market Observation Post System, monthly revenue pages
// (mopsov.twse.com.tw/nas/t21/{sii|otc}/t21sc03_{ROC year}_{month}_{0|1}.html:
// listed and over-the-counter, domestic and foreign-registered; Big5 HTML, one
// page per market per month, every company on it, NT$ thousands). Public
// disclosure, read lightly: three or four pages per month, each past month
// fetched once and kept (the first build takes several minutes); only the two newest months are re-read (twice a
// day) while companies are still filing.
//
// Which companies: data/curated/ai-supply-chain.json in the Research Database
// (server/researchDb.js), because the list names holdings. This repository
// holds no company list and the cache file is gitignored (taiwan-revenue.json).
//
// Derived per company: latest month, change on the month and on the year, the
// three-month sum against a year earlier (quarter-end months run hot for the
// server builders, so the three-month figure is the one to read) and year to
// date. Per group: the same sums over members that are not marked `mixed`.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const BASE = 'https://mopsov.twse.com.tw/nas/t21'
const PAGES = ['sii_0', 'otc_0', 'sii_1', 'otc_1']
const UNIVERSE = ['data', 'curated', 'ai-supply-chain.json']
const H = 3600e3, GAP = 350, SPAN = 38, RECHECK = 12 * H

const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 4) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const sleep = ms => new Promise(r => setTimeout(r, ms))
export const monthKey = (y, m) => `${y}-${String(m).padStart(2, '0')}`
export const shift = (key, n) => { const [y, m] = key.split('-').map(Number), t = y * 12 + (m - 1) + n; return monthKey(Math.floor(t / 12), (t % 12) + 1) }

// One revenue page → { code: this month's revenue in NT$ thousands }.
export function parsePage(html) {
  const out = {}
  for (const row of html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || []) {
    const cells = (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/gi) || []).map(c => c.replace(/<[^>]+>/g, '').replace(/&nbsp;/g, '').trim())
    if (cells.length < 7 || !/^\d{4}$/.test(cells[0])) continue
    const v = Number(cells[2].replace(/,/g, ''))
    if (cells[2] !== '' && Number.isFinite(v)) out[cells[0]] = v
  }
  return out
}

// months: { 'YYYY-MM': { code: revenue } } → what the page draws.
export function derive(months, universe) {
  const keys = Object.keys(months).sort()
  const codes = universe.companies.map(c => c.code)
  const latest = [...keys].reverse().find(k => codes.some(c => fin(months[k]?.[c])))
  if (!latest) return null
  const shown = keys.filter(k => k <= latest).slice(-25)
  const sum = (get, m, n) => { let s = 0; for (let i = 0; i < n; i++) { const v = get(shift(m, -i)); if (!fin(v)) return null; s += v } return s }
  const stats = get => m => {
    const rev = get(m), prev = get(shift(m, -1)), ago = get(shift(m, -12)), s3 = sum(get, m, 3), a3 = sum(get, shift(m, -12), 3)
    return { m, rev, mom: fin(rev) && prev > 0 ? rnd(rev / prev - 1) : null, yoy: fin(rev) && ago > 0 ? rnd(rev / ago - 1) : null, yoy3: fin(s3) && a3 > 0 ? rnd(s3 / a3 - 1) : null }
  }
  const ytd = get => { const n = +latest.slice(5), a = sum(get, latest, n), b = sum(get, shift(latest, -12), n); return fin(a) && b > 0 ? rnd(a / b - 1) : null }
  // a company's own latest month: the newest one it has reported (a late filer lags the page by a month)
  const companies = universe.companies.map(c => {
    const get = m => months[m]?.[c.code], at = stats(get), own = [...shown].reverse().find(m => fin(get(m)))
    return { code: c.code, name: c.name, group: c.group, mixed: !!c.mixed, note: c.note || null, reported: fin(get(latest)),
      latest: own ? at(own) : null, ytdYoy: fin(get(latest)) ? ytd(get) : null, series: shown.map(m => { const s = at(m); return [m, fin(s.rev) ? s.rev : null, s.yoy, s.yoy3] }) }
  })
  const groups = (universe.groups || []).map(g => {
    const members = universe.companies.filter(c => c.group === g.id && !c.mixed).map(c => c.code)
    // a group month counts only when every member has reported it, so a late filer cannot fake a fall
    const get = m => { let s = 0; for (const c of members) { const v = months[m]?.[c]; if (!fin(v)) return null; s += v } return members.length ? s : null }
    const at = stats(get), own = [...shown].reverse().find(m => fin(get(m)))
    return { id: g.id, label: g.label, reads: g.reads || null, members: members.length, latest: own ? at(own) : null, ytdYoy: own === latest ? ytd(get) : null,
      series: shown.map(m => { const s = at(m); return [m, s.rev, s.yoy, s.yoy3] }) }
  })
  return { asOf: latest, months: shown, groups, companies, pending: companies.filter(c => !c.reported).map(c => c.name) }
}

export function createTaiwanRevenue({ dir, research, UA = 'econ-dashboard', now = () => Date.now() }) {
  const FILE = path.join(dir, 'taiwan-revenue.json')
  let store = { version: 1, codes: '', pages: null, months: {}, fetched: {}, err: null }
  try { if (fs.existsSync(FILE)) { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (d?.version === 1) store = d } } catch (e) { console.warn('taiwan-revenue.json:', e.message) }
  const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(store)) } catch (e) { console.error('taiwan-revenue.json save:', e.message) } }
  let inflight = null, progress = null

  async function page(id, key) {
    const [mk, kind] = id.split('_'), [y, m] = key.split('-').map(Number)
    const r = await fetch(`${BASE}/${mk}/t21sc03_${y - 1911}_${m}_${kind}.html`, { headers: { 'User-Agent': UA } })
    if (r.status === 404) return null
    if (!r.ok) throw new Error(`MOPS answered ${r.status}`)
    return parsePage(new TextDecoder('big5').decode(await r.arrayBuffer()))
  }

  // one month: the universe's rows from the pages that carry them (all four until we know which do), fetched
  // side by side because the exchange serves each page slowly (5 to 10 seconds)
  async function month(key, codes) {
    const want = new Set(codes), got = {}, carried = [], ids = store.pages || PAGES
    const pages = await Promise.all(ids.map(id => page(id, key)))
    await sleep(GAP)
    pages.forEach((rows, i) => {
      if (!rows) return
      let hit = false
      for (const [c, v] of Object.entries(rows)) if (want.has(c)) { got[c] = v; hit = true }
      if (hit) carried.push(ids[i])
    })
    // learn the pages from a month where every company was found
    if (!store.pages && codes.every(c => c in got)) store.pages = carried
    return got
  }

  function wanted() {
    // the latest month that can have data: last calendar month, Taipei time
    const t = new Date(now() + 8 * H), end = shift(monthKey(t.getUTCFullYear(), t.getUTCMonth() + 1), -1)
    return Array.from({ length: SPAN }, (_, i) => shift(end, -i))
  }

  function refresh(codes) {
    if (inflight) return inflight
    const list = wanted(), fresh = new Set(list.slice(0, 2))
    const todo = list.filter(k => !store.months[k] || (fresh.has(k) && now() - (store.fetched[k] || 0) > RECHECK))
    if (!todo.length) return null
    progress = { done: 0, total: todo.length }
    inflight = (async () => {
      let fails = 0
      for (const k of todo) {
        try {
          const got = await month(k, codes)
          if (Object.keys(got).length || !fresh.has(k)) store.months[k] = { ...(store.months[k] || {}), ...got }
          store.fetched[k] = now(); store.err = null; fails = 0
        } catch (e) { store.err = String(e?.message || e).slice(0, 200); if (++fails >= 3) break }
        progress.done++
        save()   // each month as it lands: a dev-server restart then loses nothing
      }
      for (const k of Object.keys(store.months)) if (!list.includes(k)) { delete store.months[k]; delete store.fetched[k] }
      save()
    })().finally(() => { inflight = null; progress = null })
    return inflight
  }

  async function get() {
    const u = await research.read(UNIVERSE)
    if (!u) return research.missing()
    if (!u.data?.companies?.length) return research.missing('AI supply-chain company list', UNIVERSE)
    const codes = u.data.companies.map(c => c.code), sig = [...codes].sort().join(',')
    if (store.codes !== sig) { store = { version: 1, codes: sig, pages: null, months: {}, fetched: {}, err: null } }
    const job = refresh(codes)
    // the first build waits for the two newest months so the page opens with something; the rest fills in behind
    if (job && !Object.keys(store.months).length) await Promise.race([job, sleep(8000)])
    const d = derive(store.months, u.data)
    return { available: true, building: progress ? { ...progress } : null, error: store.err, reviewed: u.data.reviewed || null, universe: u.source, researchUrl: research.researchUrl,
      ...(d || { asOf: null, months: [], groups: [], companies: [], pending: [] }), unit: 'NT$ thousands',
      source: 'Taiwan Stock Exchange Market Observation Post System, monthly revenue (companies report by the 10th of the following month; unaudited)' }
  }

  return { get }
}
