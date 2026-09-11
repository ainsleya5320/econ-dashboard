// ============================================================================
// BANKRUPTCY TRACKER — national filings, bank credit stress, and the West
// Coast courts with Seattle first
//   official  U.S. Courts Table F-2 Quarterly (cases commenced in the three
//             months ending each quarter, by district, by chapter, business vs
//             nonbusiness). One xlsx per quarter back to 2010; parsed once and
//             kept in bk-official.json (tracked), so the backfill runs once.
//             FRED has no live filings series — this is the authoritative one.
//   fred      delinquency and charge-off rates by loan type, SLOOS tightening,
//             high-yield spread, business applications (US, WA, OR, CA)
//   live      the CM/ECF RSS feed of every West Coast bankruptcy court (W.D.
//             and E.D. Washington, Oregon, the four California districts):
//             a rolling ~24 hours of docket entries, from which new voluntary
//             petitions are counted by chapter and the Chapter 11 debtors are
//             named. Archived daily in bk-filings.json (tracked), de-duplicated
//             by case number, so the tracker accumulates from today.
//   recent    CourtListener (Free Law Project) RECAP search, chapter:11 per
//             court, last 180 days — the durable named list, since it ingests
//             the same court feeds continuously. Public API, no key; coverage
//             is roughly half to two-thirds of the official count, so it is a
//             list, not a count.
//   public    SEC EDGAR full-text search for 8-K Item 1.03 (Bankruptcy or
//             Receivership), last 180 days, West Coast flagged by business
//             state.
//   scores    filings momentum (national), bank credit stress, local pressure
//             (W.D. Washington) — 0–100, with verdicts.
// Cached 2h (official/recent/public 12h), disk-backed; complete builds only.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { unzipEntries } from './realEstateFeeds.js'

const H = 3600e3, TTL = 2 * H, SLOW_TTL = 12 * H
const fin = v => v != null && Number.isFinite(v)
const last = a => (a && a.length ? a[a.length - 1] : null)
const r1 = v => (fin(v) ? +v.toFixed(1) : null), r2 = v => (fin(v) ? +v.toFixed(2) : null)
const chg = (a, b) => (fin(a) && fin(b) && b !== 0 ? ((a / b) - 1) * 100 : null)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const mean = xs => { const v = (xs || []).filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const pctile = (arr, v) => { const a = (arr || []).filter(fin); if (!a.length || !fin(v)) return null; return Math.round((a.filter(x => x < v).length / a.length) * 100) }
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ENTITY = /\b(LLC|L\.L\.C\.|Inc\.?|Corp\.?|Corporation|Company|Co\.|LP|L\.P\.|LLP|PLLC|Ltd\.?|Holdings|Group|Partners|Enterprises|Associates|Trust|Ventures|Properties|Development|Restaurant|Farms?|Services|Solutions|Industries|International|Technologies|Foundation|Church|Hospital|Clinic|Motors?|Marine|Construction|Realty|Investments?)\b/i

// The West Coast bankruptcy courts: CM/ECF id, the district label the AO uses, and the office codes where known.
export const COURTS = [
  { id: 'wawb', district: 'WA,W', name: 'W.D. Washington', cities: 'Seattle · Tacoma', offices: { 2: 'Seattle', 3: 'Tacoma' }, home: true },
  { id: 'waeb', district: 'WA,E', name: 'E.D. Washington', cities: 'Spokane · Yakima' },
  { id: 'orb', district: 'OR', name: 'D. Oregon', cities: 'Portland · Eugene' },
  { id: 'canb', district: 'CA,N', name: 'N.D. California', cities: 'San Francisco · Oakland · San Jose' },
  { id: 'caeb', district: 'CA,E', name: 'E.D. California', cities: 'Sacramento · Fresno' },
  { id: 'cacb', district: 'CA,C', name: 'C.D. California', cities: 'Los Angeles · Santa Ana · Riverside' },
  { id: 'casb', district: 'CA,S', name: 'S.D. California', cities: 'San Diego' },
]
const DISTRICTS = COURTS.map(c => c.district)
const WEST_STATES = new Set(['WA', 'OR', 'CA'])

// FRED credit-stress complex. dir +1 = up is bad.
const FRED = [
  ['DRBLACBS', 'Business loan delinquency', '%', 'Q', 1, 160],
  ['CORBLACBS', 'Business loan charge-offs', '%', 'Q', 1, 160],
  ['DRCLACBS', 'Consumer loan delinquency', '%', 'Q', 1, 160],
  ['DRCCLACBS', 'Credit card delinquency', '%', 'Q', 1, 160],
  ['DRSFRMACBS', 'Mortgage delinquency', '%', 'Q', 1, 160],
  ['DRCRELEXFACBS', 'CRE loan delinquency', '%', 'Q', 1, 160],
  ['CORALACBS', 'All-loan charge-offs', '%', 'Q', 1, 160],
  ['DRTSCILM', 'Banks tightening C&I standards', 'net %', 'Q', 1, 160],
  ['BAMLH0A0HYM2', 'High-yield OAS', '%', 'D', 1, 1500],
  ['BABATOTALSAUS', 'Business applications, US', '/mo', 'M', -1, 280],
  ['BABATOTALSAWA', 'Business applications, WA', '/mo', 'M', -1, 280],
  ['BABATOTALSAOR', 'Business applications, OR', '/mo', 'M', -1, 280],
  ['BABATOTALSACA', 'Business applications, CA', '/mo', 'M', -1, 280],
]

export function createBankruptcy({ fetchFredSeries, UA, dir }) {
  const file = n => path.join(dir, n)
  const load = n => { try { if (fs.existsSync(file(n))) return JSON.parse(fs.readFileSync(file(n), 'utf8')) } catch {} return null }
  const save = (n, o) => { try { fs.writeFileSync(file(n), JSON.stringify(o)) } catch (e) { console.error(`${n} save:`, e.message) } }
  let mem = null, inflight = null
  const slow = {} // official / recent / public sub-caches with their own TTL

  // ── official: Table F-2 Quarterly, one xlsx per quarter ──────────────────
  const QE = ['03/31', '06/30', '09/30', '12/31']
  const quarterEnds = () => {
    const out = []; const now = new Date()
    for (let y = 2010; y <= now.getUTCFullYear(); y++) for (const q of QE) { const iso = `${y}-${q.replace('/', '-')}`; if (Date.parse(iso) + 20 * 864e5 < now.getTime()) out.push(iso) }
    return out
  }
  function parseF2(buf) {
    const entries = unzipEntries(buf)
    const text = name => entries.find(e => e.name === name)?.data?.toString('utf8') || ''
    const shared = [...text('xl/sharedStrings.xml').matchAll(/<si>(.*?)<\/si>/gs)].map(m => m[1].replace(/<[^>]+>/g, ''))
    const sheet = text('xl/worksheets/sheet1.xml')
    const rows = []
    for (const rm of sheet.matchAll(/<row[^>]*>(.*?)<\/row>/gs)) {
      const cells = []
      for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*)>(.*?)<\/c>/gs)) {
        const v = cm[3].match(/<v>(.*?)<\/v>/)?.[1]
        cells.push(v == null ? null : /t="s"/.test(cm[2]) ? shared[+v] : parseFloat(v))
      }
      rows.push(cells)
    }
    const num = c => (fin(c) ? c : typeof c === 'string' && /^\d+$/.test(c.trim()) ? +c : null)
    // Two layouts. 2018Q3 onward: Total | Ch7 | Ch11 | Ch13 | Other | business (All, 7, 11, 13, Other) | nonbusiness (All, 7, 11, 13, Other).
    // Before that: Total | Ch7 | Ch11 | Ch12 | Ch13 | business (Total, 7, 11, 12, 13) | nonbusiness (Total, 7, 11, 13) | sort order,
    // with upper-case padded labels. Detect by the presence of a "Chapter 12" header.
    const legacy = rows.slice(0, 8).some(r => r.some(c => typeof c === 'string' && /chapter\s*12/i.test(c)))
    const rec = r => {
      const n = r.slice(1).map(num)
      const o = legacy
        ? { total: n[0], ch7: n[1], ch11: n[2], ch13: n[4], other: n[3], bizAll: n[5], bizCh7: n[6], bizCh11: n[7], bizCh13: n[9], nonbizAll: n[10], nonbizCh7: n[11], nonbizCh11: n[12], nonbizCh13: n[13] }
        : { total: n[0], ch7: n[1], ch11: n[2], ch13: n[3], other: n[4], bizAll: n[5], bizCh7: n[6], bizCh11: n[7], bizCh13: n[8], nonbizAll: n[10], nonbizCh7: n[11], nonbizCh11: n[12], nonbizCh13: n[13] }
      if (![o.total, o.ch7, o.ch11, o.ch13, o.bizAll, o.nonbizAll].every(fin)) return null
      // chapters 9 and 15 are omitted from the chapter columns in the legacy layout, so the chapter sum may fall a little short of the total
      const gap = o.total - (o.ch7 + o.ch11 + o.ch13 + (o.other || 0))
      if (gap < -2 || gap > Math.max(3, o.total * 0.005) || Math.abs(o.bizAll + o.nonbizAll - o.total) > 2) return null
      return o
    }
    const label = r => (typeof r[0] === 'string' ? r[0].replace(/\s+/g, '').toUpperCase() : '')
    const nat = rows.find(r => label(r) === 'TOTAL')
    const ninth = rows.find(r => label(r) === '9TH')
    const out = { national: nat ? rec(nat) : null, ninth: ninth ? rec(ninth) : null, districts: {}, legacy }
    for (const d of DISTRICTS) { const r = rows.find(x => label(x) === d.replace(/\s+/g, '').toUpperCase()); if (r) out.districts[d] = rec(r) }
    if (!out.national) throw new Error('no national row')
    return out
  }
  async function fetchQuarter(q) {
    const [y, m, d] = q.split('-')
    const direct = `https://www.uscourts.gov/sites/default/files/document/bf_f2.3_${m}${d}.${y}.xlsx`
    let r = await fetch(direct, { headers: { 'User-Agent': UA } })
    if (!r.ok) {
      const page = await fetch(`https://www.uscourts.gov/data-news/data-tables/${y}/${m}/${d}/bankruptcy-filings/f-2-three-months`, { headers: { 'User-Agent': UA }, redirect: 'follow' })
      if (!page.ok) throw new Error(`page HTTP ${page.status}`)
      const html = await page.text()
      const href = html.match(/href="([^"]*\.xlsx)"/i)?.[1]
      if (!href) throw new Error(/href="[^"]*\.xls"/i.test(html) ? 'legacy xls' : 'no xlsx link')
      r = await fetch(href.startsWith('http') ? href : `https://www.uscourts.gov${href}`, { headers: { 'User-Agent': UA } })
      if (!r.ok) throw new Error(`xlsx HTTP ${r.status}`)
    }
    return parseF2(Buffer.from(await r.arrayBuffer()))
  }
  async function official() {
    const store = load('bk-official.json') || { quarters: {}, missing: {} }
    const want = quarterEnds().reverse() // newest first, so the useful data lands first
    let fetched = 0
    for (const q of want) {
      if (store.quarters[q]) continue
      if (store.missing[q] === 'legacy-xls' || (fin(store.missing[q]) && Date.now() - store.missing[q] < 7 * 864e5)) continue // .xls era is unreadable here; other failures retry weekly
      try { store.quarters[q] = await fetchQuarter(q); delete store.missing[q]; fetched++ }
      catch (e) { console.warn(`F-2 ${q}: ${e.message}`); store.missing[q] = e.message === 'legacy xls' ? 'legacy-xls' : Date.now() }
      await sleep(250)
      if (fetched % 4 === 0) save('bk-official.json', store)
    }
    save('bk-official.json', store)
    const qs = Object.keys(store.quarters).sort()
    return { quarters: qs.map(q => ({ q, ...store.quarters[q] })), latest: last(qs), first: qs[0] }
  }

  // ── live: the court RSS feeds ────────────────────────────────────────────
  const unesc = s => s.replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
  async function courtFeed(c) {
    const r = await fetch(`https://ecf.${c.id}.uscourts.gov/cgi-bin/rss_outside.pl`, { headers: { 'User-Agent': UA } })
    if (!r.ok) throw new Error(`${c.id} RSS HTTP ${r.status}`)
    const xml = Buffer.from(await r.arrayBuffer()).toString('latin1')
    const items = []
    for (const m of xml.matchAll(/<item>(.*?)<\/item>/gs)) {
      const t = m[1]
      const title = unesc(t.match(/<title>(.*?)<\/title>/s)?.[1] || '').trim()
      const desc = unesc(t.match(/<description>(.*?)<\/description>/s)?.[1] || '').replace(/<[^>]+>/g, ' ')
      const link = (t.match(/<link>(.*?)<\/link>/s)?.[1] || '').trim()
      const pub = (t.match(/<pubDate>(.*?)<\/pubDate>/s)?.[1] || '').trim()
      const tok = title.match(/^(\S*\d{2}-(?:bk-)?\d{4,6}\S*)/)?.[1] || null
      const no = tok ? tok.replace(/-$/, '') : null
      const name = (tok ? title.slice(tok.length) : title).replace(/^[-\s]+/, '').trim()
      const chapter = desc.match(/Chapter:\s*(\d+)/)?.[1] || null
      const office = desc.match(/Office:\s*(\d+)/)?.[1] || null
      const type = desc.match(/\[(.*?)\]/)?.[1]?.trim() || ''
      items.push({ no, name, chapter, office, type, link, ts: pub ? new Date(pub).toISOString() : null })
    }
    return items
  }
  async function live() {
    const store = load('bk-filings.json') || { days: {}, seen: {} }
    const feeds = {}
    for (const c of COURTS) {
      try { feeds[c.id] = await courtFeed(c) } catch (e) { console.warn(e.message); feeds[c.id] = null }
      await sleep(200)
    }
    const today = new Date().toISOString().slice(0, 10)
    for (const c of COURTS) {
      const items = feeds[c.id]; if (!items) continue
      for (const it of items) {
        if (!it.no || !/^(Voluntary|Involuntary)\s+Petition|^Commencement of Case/i.test(it.type)) continue
        const key = `${c.id}:${it.no}`
        if (store.seen[key]) continue
        const day = (it.ts || new Date().toISOString()).slice(0, 10)
        store.seen[key] = day
        const d = store.days[day] = store.days[day] || {}
        const cc = d[c.id] = d[c.id] || { ch7: 0, ch11: 0, ch13: 0, other: 0, ch11Cases: [] }
        const ch = it.chapter === '7' ? 'ch7' : it.chapter === '11' ? 'ch11' : it.chapter === '13' ? 'ch13' : 'other'
        cc[ch]++
        if (ch === 'ch11') cc.ch11Cases.push({ no: it.no, name: it.name, office: c.offices?.[it.office] || null, link: it.link, ts: it.ts, involuntary: /^Involuntary/i.test(it.type), entity: ENTITY.test(it.name) })
      }
    }
    // keep the archive bounded: two years of days; the seen-set only needs the last 60 days to de-duplicate a 24-hour feed
    for (const day of Object.keys(store.days)) if (Date.parse(day) < Date.now() - 730 * 864e5) delete store.days[day]
    for (const [k, day] of Object.entries(store.seen)) if (Date.parse(day) < Date.now() - 60 * 864e5) delete store.seen[k]
    save('bk-filings.json', store)
    const days = Object.keys(store.days).sort()
    const window = (n, court) => { const cut = new Date(Date.now() - n * 864e5).toISOString().slice(0, 10); const acc = { ch7: 0, ch11: 0, ch13: 0, other: 0 }; for (const d of days) if (d >= cut) for (const [cid, v] of Object.entries(store.days[d])) if (!court || cid === court) { acc.ch7 += v.ch7; acc.ch11 += v.ch11; acc.ch13 += v.ch13; acc.other += v.other } return acc }
    const ch11Recent = []
    for (const d of days.slice(-45)) for (const [cid, v] of Object.entries(store.days[d])) for (const k of v.ch11Cases) ch11Recent.push({ ...k, court: cid, day: d })
    ch11Recent.sort((a, b) => (b.ts || b.day).localeCompare(a.ts || a.day))
    return {
      today, firstDay: days[0] || today, daysArchived: days.length, feedOk: Object.fromEntries(COURTS.map(c => [c.id, !!feeds[c.id]])),
      feedSize: Object.fromEntries(COURTS.map(c => [c.id, feeds[c.id]?.length ?? 0])),
      last7: Object.fromEntries(COURTS.map(c => [c.id, window(7, c.id)])), last30: Object.fromEntries(COURTS.map(c => [c.id, window(30, c.id)])),
      west7: window(7), west30: window(30),
      daily: days.slice(-90).map(d => ({ d, ...Object.fromEntries(COURTS.map(c => [c.id, store.days[d][c.id] ? store.days[d][c.id].ch7 + store.days[d][c.id].ch11 + store.days[d][c.id].ch13 + store.days[d][c.id].other : 0])), ch11: Object.values(store.days[d]).reduce((s, v) => s + v.ch11, 0) })),
      ch11Recent: ch11Recent.slice(0, 80),
    }
  }

  // ── recent: CourtListener chapter:11 dockets per court ───────────────────
  async function recent() {
    const since = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10)
    const out = {}
    for (const c of COURTS) {
      const cases = []
      let url = `https://www.courtlistener.com/api/rest/v4/search/?type=r&q=chapter%3A11&court=${c.id}&filed_after=${since}&order_by=dateFiled%20desc`
      let count = null
      try {
        for (let page = 0; page < 3 && url; page++) {
          const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
          if (!r.ok) throw new Error(`CourtListener ${c.id}: HTTP ${r.status}`)
          const j = await r.json()
          count = j.count ?? count
          for (const x of j.results || []) {
            if (String(x.chapter) !== '11') continue
            cases.push({ no: x.docketNumber, name: x.caseName, filed: x.dateFiled, terminated: x.dateTerminated || null, url: x.docket_absolute_url ? `https://www.courtlistener.com${x.docket_absolute_url}` : null, entity: ENTITY.test(x.caseName || ''), trustee: x.trustee_str || null })
          }
          url = j.next || null
          await sleep(400)
        }
      } catch (e) { console.warn(e.message) }
      out[c.id] = { count, cases, since }
    }
    return out
  }

  // ── public: EDGAR 8-K Item 1.03 ──────────────────────────────────────────
  async function publicCos() {
    const end = new Date().toISOString().slice(0, 10), start = new Date(Date.now() - 180 * 864e5).toISOString().slice(0, 10)
    const rows = []
    let total = null
    for (let from = 0; from < 300; from += 100) {
      const r = await fetch(`https://efts.sec.gov/LATEST/search-index?q=%22Item%201.03%22&forms=8-K&dateRange=custom&startdt=${start}&enddt=${end}&from=${from}`, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
      if (!r.ok) throw new Error(`EDGAR HTTP ${r.status}`)
      const j = await r.json()
      const hits = j.hits?.hits || []
      total = j.hits?.total?.value ?? total
      for (const h of hits) {
        const s = h._source || {}
        if (Array.isArray(s.items) && s.items.length && !s.items.includes('1.03')) continue
        const disp = (s.display_names || [])[0] || ''
        const name = disp.replace(/\s*\(CIK[^)]*\)\s*$/i, '').replace(/\s+\(([A-Z.\-]{1,6})\)\s*$/, '').trim()
        const ticker = disp.match(/\(([A-Z.\-]{1,6})\)\s*\(CIK/i)?.[1] || null
        const cik = (s.ciks || [])[0] || null, adsh = s.adsh || null
        const state = (s.biz_states || [])[0] || null
        rows.push({ name, ticker, date: s.file_date, state, west: WEST_STATES.has(state), sic: (s.sics || [])[0] || null, url: cik && adsh ? `https://www.sec.gov/Archives/edgar/data/${+cik}/${adsh.replace(/-/g, '')}/${adsh}-index.htm` : null })
      }
      if (hits.length < 100) break
      await sleep(300)
    }
    const seen = new Set()
    const list = rows.filter(r => { const k = `${r.name}|${r.date}`; if (seen.has(k)) return false; seen.add(k); return true }).sort((a, b) => b.date.localeCompare(a.date))
    return { since: start, total, n: list.length, west: list.filter(r => r.west).length, list: list.slice(0, 120) }
  }

  async function slowGet(key, fn) {
    const c = slow[key]
    if (c && Date.now() - c.ts < SLOW_TTL) return c.data
    const disk = load(`bk-${key}.json`)
    if (!c && disk && Date.now() - disk.ts < SLOW_TTL) { slow[key] = disk; return disk.data }
    try { const data = await fn(); slow[key] = { data, ts: Date.now() }; save(`bk-${key}.json`, slow[key]); return data }
    catch (e) { console.warn(`bankruptcy ${key}:`, e.message); return c?.data || disk?.data || null }
  }

  async function build() {
    const off = await official()
    const [rec, pub, lv] = await Promise.all([slowGet('recent', recent), slowGet('public', publicCos), live()])
    const fredRows = []
    for (const [id, label, unit, freq, dirn, limit] of FRED) {
      const s = await fetchFredSeries(id, limit).catch(() => [])
      const pts = (s || []).filter(p => fin(p.v))
      if (!pts.length) { fredRows.push({ id, label, unit, freq, dir: dirn, v: null }); continue }
      const series = freq === 'D' ? pts.filter((_, i) => i % 5 === 0 || i === pts.length - 1) : pts
      const L = last(pts), vals = pts.map(p => p.v)
      const back = freq === 'Q' ? 4 : freq === 'M' ? 12 : 250
      const yr = pts[pts.length - 1 - back] || null
      const p = pctile(vals, L.v), fav = dirn > 0 ? 100 - p : p
      fredRows.push({ id, label, unit, freq, dir: dirn, v: r2(L.v), d: L.d, chg1y: yr ? r2(L.v - yr.v) : null, pct: p, since: pts[0].d, min: r2(Math.min(...vals)), max: r2(Math.max(...vals)), spark: series.slice(-40).map(x => r2(x.v)), tone: fav >= 60 ? 'green' : fav >= 35 ? 'amber' : 'red', series: series.slice(-160).map(x => ({ d: x.d, v: r2(x.v) })) })
    }
    const F = Object.fromEntries(fredRows.map(r => [r.id, r]))

    // ── official derived ──
    const Q = off.quarters
    const yoy = (arr, key, i) => (i >= 4 ? chg(arr[i][key], arr[i - 4][key]) : null)
    const t4 = (arr, key, i) => (i >= 3 ? arr.slice(i - 3, i + 1).reduce((s, x) => s + (x[key] || 0), 0) : null)
    const natRows = Q.map((q, i) => ({ q: q.q, total: q.national.total, ch7: q.national.ch7, ch11: q.national.ch11, ch13: q.national.ch13, bizAll: q.national.bizAll, bizCh11: q.national.bizCh11, nonbizAll: q.national.nonbizAll, yoy: r1(yoy(Q.map(x => x.national), 'total', i)), bizCh11Yoy: r1(yoy(Q.map(x => x.national), 'bizCh11', i)), t4: t4(Q.map(x => x.national), 'total', i), bizCh11T4: t4(Q.map(x => x.national), 'bizCh11', i) }))
    const distRows = {}
    for (const d of DISTRICTS) {
      const arr = Q.map(x => x.districts[d]).map(x => x || {})
      distRows[d] = Q.map((q, i) => ({ q: q.q, total: arr[i].total ?? null, ch11: arr[i].ch11 ?? null, bizAll: arr[i].bizAll ?? null, bizCh11: arr[i].bizCh11 ?? null, yoy: r1(yoy(arr, 'total', i)), bizCh11Yoy: r1(yoy(arr, 'bizCh11', i)), t4: t4(arr, 'total', i), bizCh11T4: t4(arr, 'bizCh11', i), ch11T4: t4(arr, 'ch11', i) }))
    }
    const NL = last(natRows)
    const board = COURTS.map(c => { const rows = distRows[c.district], L = last(rows); const t4s = rows.map(r => r.t4).filter(fin), c11 = rows.map(r => r.bizCh11T4).filter(fin); return { ...c, offices: undefined, q: L?.q, total: L?.total, yoy: L?.yoy, ch11: L?.ch11, bizCh11: L?.bizCh11, bizCh11Yoy: L?.bizCh11Yoy, t4: L?.t4, bizCh11T4: L?.bizCh11T4, t4Pct: pctile(t4s, L?.t4), bizCh11Pct: pctile(c11, L?.bizCh11T4), peakT4: Math.max(...t4s), spark: rows.slice(-24).map(r => r.total), sparkCh11: rows.slice(-24).map(r => r.bizCh11), live7: lv.last7[c.id], live30: lv.last30[c.id], feedOk: lv.feedOk[c.id], recentCount: rec?.[c.id]?.count ?? null } })
    const home = board.find(b => b.home)

    // ── scores ──
    const natT4 = natRows.map(r => r.t4).filter(fin)
    const levelPct = pctile(natT4, NL?.t4)
    const yoyScore = v => (fin(v) ? clamp(50 - v * 2.5, 0, 100) : null)
    const filingsScore = Math.round(mean([fin(levelPct) ? 100 - levelPct : null, yoyScore(NL?.yoy), yoyScore(NL?.bizCh11Yoy)]) ?? 50)
    const creditIds = ['DRBLACBS', 'DRCLACBS', 'DRCCLACBS', 'DRCRELEXFACBS', 'CORBLACBS', 'DRTSCILM', 'BAMLH0A0HYM2']
    const creditScore = Math.round(mean(creditIds.map(id => (fin(F[id]?.pct) ? 100 - F[id].pct : null))) ?? 50)
    const localScore = Math.round(mean([fin(home?.t4Pct) ? 100 - home.t4Pct : null, yoyScore(home?.yoy), fin(home?.bizCh11Pct) ? 100 - home.bizCh11Pct : null, yoyScore(home?.bizCh11Yoy)]) ?? 50)
    const tone = s => (s >= 60 ? 'green' : s >= 35 ? 'amber' : 'red')
    const fmtQ = q => (q ? `${q.slice(0, 4)}Q${Math.ceil(+q.slice(5, 7) / 3)}` : '')
    const scores = {
      filings: { score: filingsScore, tone: tone(filingsScore), label: filingsScore >= 60 ? 'Filings subdued' : filingsScore >= 35 ? 'Filings normalizing upward' : 'Filings rising fast', why: NL ? `${(NL.t4 / 1e3).toFixed(0)}k cases in the four quarters to ${fmtQ(NL.q)}, the ${levelPct}th percentile of the period since ${off.first.slice(0, 4)} (the high in that window was ${(Math.max(...natT4) / 1e3).toFixed(0)}k). Total filings ${NL.yoy >= 0 ? '+' : ''}${NL.yoy}% year on year; business Chapter 11 ${NL.bizCh11Yoy >= 0 ? '+' : ''}${NL.bizCh11Yoy}%. Consumer chapters 7 and 13 are ${((NL.nonbizAll / NL.total) * 100).toFixed(0)}% of the total — the household cycle, not the corporate one, drives the count.` : 'official data unavailable' },
      credit: { score: creditScore, tone: tone(creditScore), label: creditScore >= 60 ? 'Bank credit calm' : creditScore >= 35 ? 'Bank credit stress building' : 'Bank credit stressed', why: `Delinquencies: business loans ${F.DRBLACBS?.v ?? '—'}% (p${F.DRBLACBS?.pct}), consumer ${F.DRCLACBS?.v ?? '—'}%, credit cards ${F.DRCCLACBS?.v ?? '—'}% (p${F.DRCCLACBS?.pct}), commercial real estate ${F.DRCRELEXFACBS?.v ?? '—'}% (p${F.DRCRELEXFACBS?.pct}). Net ${F.DRTSCILM?.v ?? '—'}% of banks tightening C&I standards; high-yield spread ${F.BAMLH0A0HYM2?.v ?? '—'}%. Delinquency leads filings by two to four quarters — this is the earlier gauge.` },
      local: { score: localScore, tone: tone(localScore), label: localScore >= 60 ? 'Seattle courts quiet' : localScore >= 35 ? 'Seattle filings rising' : 'Seattle filings elevated', why: home ? `W.D. Washington: ${home.t4?.toLocaleString()} cases in the four quarters to ${fmtQ(home.q)} (p${home.t4Pct} since ${off.first.slice(0, 4)}; high ${home.peakT4?.toLocaleString()}), ${home.yoy >= 0 ? '+' : ''}${home.yoy}% year on year. Business Chapter 11: ${home.bizCh11T4} in the trailing year (p${home.bizCh11Pct}), ${home.bizCh11 ?? '—'} in the latest quarter${home.live30?.ch11 ? `; ${home.live30.ch11} Chapter 11 petition${home.live30.ch11 === 1 ? '' : 's'} on the Seattle and Tacoma dockets in the last 30 days of the live feed` : ''}.` : 'district data unavailable' },
    }
    const headline = {
      label: filingsScore >= 60 && creditScore >= 60 ? 'Insolvency cycle quiet' : filingsScore < 35 || creditScore < 35 ? 'Insolvency cycle turning' : localScore < 35 ? 'National calm, Seattle rising' : 'Filings climbing off the floor',
      color: filingsScore < 35 || creditScore < 35 ? '#f87171' : filingsScore >= 60 && creditScore >= 60 ? '#4ade80' : '#fbbf24',
      why: NL ? `Filings are ${NL.yoy >= 0 ? 'up' : 'down'} ${Math.abs(NL.yoy)}% nationally and ${home ? `${home.yoy >= 0 ? 'up' : 'down'} ${Math.abs(home.yoy)}% in Western Washington` : ''} over a year, from a base that is ${levelPct < 50 ? 'below' : 'above'} the median of the period since ${off.first.slice(0, 4)}. Bank delinquencies sit at the ${F.DRCLACBS?.pct}th percentile for consumers and the ${F.DRBLACBS?.pct}th for businesses. The corporate Chapter 11 count is small (${NL.bizCh11} nationally last quarter, ${home?.bizCh11 ?? '—'} in W.D. Washington) and lumpy; the live docket below is where the local names surface first.` : '',
    }

    return {
      headline, scores, board, home: home?.id || 'wawb',
      national: { rows: natRows.slice(-68), latest: NL, since: off.first, quartersLoaded: Q.length, legacyBefore: off.first },
      districts: Object.fromEntries(DISTRICTS.map(d => [d, distRows[d].slice(-68)])),
      fred: fredRows.map(r => ({ ...r, series: undefined })), fredSeries: Object.fromEntries(fredRows.filter(r => r.series).map(r => [r.id, r.series])),
      live: lv, recent: rec, public: pub, courts: COURTS,
      source: 'U.S. Courts Table F-2 Quarterly (official filings by district and chapter, business vs nonbusiness); CM/ECF RSS feeds of the seven West Coast bankruptcy courts (live docket, archived daily by this dashboard); CourtListener/RECAP (named Chapter 11 dockets, partial coverage); SEC EDGAR full-text search (8-K Item 1.03); FRED (delinquency, charge-offs, SLOOS, HY OAS, business applications).',
      updated: new Date().toISOString(),
    }
  }

  async function get() {
    if (mem && Date.now() - mem.ts < TTL) return mem.data
    const disk = mem || load('bankruptcy.json')
    if (disk && Date.now() - disk.ts < TTL) { mem = disk; return disk.data }
    if (inflight) return inflight
    inflight = (async () => {
      try { const data = await build(); mem = { data, ts: Date.now() }; save('bankruptcy.json', mem); return data }
      catch (e) { console.warn('bankruptcy:', e.message); if (disk) return disk.data; throw e }
      finally { inflight = null }
    })()
    return inflight
  }
  return { get }
}
