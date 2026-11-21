// ============================================================================
// MEMORY PRICES — AI Economy → Memory: what memory costs, from HBM down to
// NAND, on one scale. Memory is where an AI compute shortage shows first
// upstream: HBM takes the wafers conventional DRAM would have used, so DDR5
// and then DDR4 tighten, and NAND follows when enterprise SSDs are short.
//
//   spot       TrendForce's free, server-rendered price pages, read daily:
//              DRAM chips (DDR5, DDR4, DDR3), server and PC modules, graphics
//              DRAM, NAND flash (SLC, MLC), TLC NAND wafers, memory cards.
//              Their history is members-only, so this dashboard keeps its own:
//              one snapshot a day in memory-prices.json.
//   contract   the contract tables the same pages show a month or a quarter in
//              arrears (DRAM modules, NAND, PC-client SSDs)
//   per GB     every part converted to dollars per gigabyte, so HBM, server
//              DDR5, legacy DDR4 and NAND sit on one ladder
//   legacy     DDR4 against DDR5 per GB: when the old part costs more than the
//              new one, makers have moved capacity away faster than demand left
//   hand-kept  what no free page gives — HBM prices and premiums, TrendForce's
//              quarterly contract forecasts, the makers' own reported price and
//              bit changes — from the private Research Database
//              (data/curated/ai-memory-prices.json: it names holdings)
//
// parseTables() is the scraper's parser: it reads each table with its title,
// so a contract table is never mistaken for a spot one. Spot is the marginal
// traded price: it leads contract by about a quarter and overshoots both ways.
// ============================================================================

import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, DAY = 864e5
const FILE = ['data', 'curated', 'ai-memory-prices.json']
export const PAGES = ['https://www.trendforce.com/price/dram/dram_spot', 'https://www.trendforce.com/price/flash/flash_spot']
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 3) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const clean = c => c.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#9650;/g, '▲').replace(/&#9660;/g, '▼').replace(/&mdash;/g, '—').replace(/&amp;/g, '&').replace(/&#0?39;/g, '\'').replace(/\s+/g, ' ').trim()

// which family a table belongs to, from its title; null = a table this dashboard does not keep
export function tableKind(title) {
  const t = String(title || '')
  if (/Street/i.test(t) || /LPDDR|Mobile DRAM|eMMC|UFS/i.test(t)) return null       // retail brands; and tables the free page shows only as a list of names
  const k = /Contract/i.test(t) ? 'contract' : /Spot/i.test(t) ? 'spot' : null
  if (!k) return null
  const g = /GDDR/i.test(t) ? 'gddr' : /Module/i.test(t) ? 'module' : /Memory Card Spot/i.test(t) ? 'card' : /Wafer/i.test(t) ? 'wafer' : /SSD/i.test(t) ? 'ssd' : /NAND/i.test(t) ? 'nand' : /DRAM/i.test(t) ? (k === 'contract' ? 'module' : 'chip') : null
  return g ? { k, g } : null
}

// One TrendForce price page → [{ title, updated, rows: [[cell, …]] }]. The title is the nearest element before the
// table whose class marks it as a heading.
export function parseTables(html) {
  const out = [], re = /<table[\s\S]*?<\/table>/g
  let m
  while ((m = re.exec(html))) {
    const before = html.slice(Math.max(0, m.index - 1500), m.index)
    const heads = [...before.matchAll(/<(h[1-6]|div|span|p|a)[^>]*class="[^"]*(?:title|head|tit|name)[^"]*"[^>]*>([\s\S]{0,160}?)<\/\1>/g)].map(x => clean(x[2])).filter(Boolean)
    const updated = (before.match(/Last Update\s*([\d-]{10})/i) || before.match(/updated on\s*([\d/]{8,10})/i) || [])[1] || null
    const rows = (m[0].match(/<tr[^>]*>[\s\S]*?<\/tr>/g) || []).map(row => ({ cells: (row.match(/<t[dh][^>]*>[\s\S]*?<\/t[dh]>/g) || []).map(clean), down: /&#9660;|▼/.test(row), flat: /&mdash;|—/.test(row) }))
    out.push({ title: heads.at(-1) || '', updated, rows })
  }
  return out
}

// the tables of one page → items { n, g, k, avg, chg, t, period }
export function itemsOf(tables) {
  const items = []
  for (const tb of tables) {
    const kind = tableKind(tb.title)
    if (!kind) continue
    const period = (tb.title.match(/\(([^)]+)\)/) || [])[1] || null
    for (const { cells, down, flat } of tb.rows) {
      if (cells.length < 3 || !cells[0] || /^(Item|Brand)$/i.test(cells[0])) continue
      // the last purely numeric cell is the average (session average, or the contract average)
      const nums = cells.filter(c => /^[\d,]+(\.\d+)?$/.test(c)).map(c => parseFloat(c.replace(/,/g, '')))
      if (nums.length < 2) continue
      let chg = null
      const cc = cells.find(c => c.includes('%'))
      if (cc) { const q = cc.match(/(-?\d+(\.\d+)?)\s*%/); if (q) { chg = parseFloat(q[1]); if (down && chg > 0) chg = -chg } else if (flat) chg = 0 }
      const avg = nums.at(-1)
      if (fin(avg)) items.push({ n: cells[0], ...kind, avg, chg, ...(period ? { period } : {}) })
    }
  }
  return items
}

// gigabytes in a part, from its name: "16Gb" is gigabits (÷ 8), "32GB" gigabytes, "1TB" a thousand
export function gbOf(name) {
  const m = String(name || '').match(/(\d+(?:\.\d+)?)\s*(T[Bb]|G[Bb]|M[Bb])(?![a-z])/)
  if (!m) return null
  const v = +m[1], unit = m[2], scale = unit[0] === 'T' ? 1000 : unit[0] === 'G' ? 1 : 0.001
  return v * scale / (unit[1] === 'b' ? 8 : 1)
}

// The parts that carry the story, matched by the start of TrendForce's name. `family` groups the board.
export const HEADLINE = [
  { id: 'ddr5', prefix: 'DDR5 16Gb (2Gx8) 4800', label: 'DDR5 16Gb chip', family: 'DDR5', note: 'the mainstream server and PC die' },
  { id: 'ddr5rdimm', prefix: 'DDR5 RDIMM 32GB', label: 'DDR5 RDIMM 32GB', family: 'DDR5', note: 'the server module' },
  { id: 'ddr4', prefix: 'DDR4 16Gb (2Gx8) 3200', label: 'DDR4 16Gb chip', family: 'DDR4', note: 'the legacy die makers are winding down' },
  { id: 'ddr4-8', prefix: 'DDR4 8Gb (1Gx8) 3200', label: 'DDR4 8Gb chip', family: 'DDR4', note: 'legacy, smaller die' },
  { id: 'tlc512', prefix: '512Gb TLC', label: 'NAND 512Gb TLC wafer', family: 'NAND', note: 'the wafer SSDs are built from' },
  { id: 'tlc256', prefix: '256Gb TLC', label: 'NAND 256Gb TLC wafer', family: 'NAND', note: 'smaller TLC wafer' },
  { id: 'mlc64', prefix: 'MLC 64Gb', label: 'NAND 64Gb MLC', family: 'NAND', note: 'older two-bit flash, industrial and embedded' },
  { id: 'gddr6', prefix: 'GDDR6 8Gb', label: 'GDDR6 8Gb', family: 'Graphics', note: 'graphics DRAM' },
]
const FAMILY = n => (/^DDR5/.test(n) ? 'DDR5' : /^DDR4/.test(n) ? 'DDR4' : /^DDR3/.test(n) ? 'DDR3' : /^GDDR/.test(n) ? 'Graphics' : /TLC|MLC|SLC|NAND|SSD|TB-|GB-/.test(n) ? 'NAND' : /MicroSD/i.test(n) ? 'Cards' : 'Other')

// the archive (days of items) → the board: each part's latest price, per-GB price, and its move over the archive
export function board(days) {
  const last = days.at(-1)
  if (!last) return []
  const spot = d => (d.items || []).filter(i => (i.k || 'spot') === 'spot')
  const at = (name, date) => { for (let k = days.length - 1; k >= 0; k--) if (days[k].date <= date) { const it = spot(days[k]).find(i => i.n === name); if (it) return { avg: it.avg, date: days[k].date } } return null }
  const back = n => new Date(Date.parse(last.date) - n * DAY).toISOString().slice(0, 10)
  return spot(last).map(i => {
    const gb = gbOf(i.n), series = days.map(d => spot(d).find(x => x.n === i.n)?.avg ?? null), first = days.findIndex((_, k) => fin(series[k]))
    const chgTo = p => (p && p.avg > 0 ? rnd(i.avg / p.avg - 1, 4) : null)
    const d30 = at(i.n, back(30)), d7 = at(i.n, back(7))
    return { n: i.n, g: i.g, family: FAMILY(i.n), avg: i.avg, session: i.chg, gb: rnd(gb, 3), perGb: gb ? rnd(i.avg / gb, 3) : null,
      chg7: chgTo(d7), chg30: chgTo(d30), chgAll: first >= 0 && series[first] > 0 ? rnd(i.avg / series[first] - 1, 4) : null, since: first >= 0 ? days[first].date : null,
      spark: series.slice(-90).map(v => (fin(v) ? rnd(v / i.avg, 4) : null)), head: HEADLINE.find(h => i.n.startsWith(h.prefix))?.id || null }
  })
}

// DDR4 per GB over DDR5 per GB, by day: above 1 the legacy part costs more than the current one
export function legacyRatio(days) {
  const pick = (d, prefix) => (d.items || []).find(i => i.n.startsWith(prefix) && !/eTT/.test(i.n))?.avg
  return days.map(d => { const a = pick(d, 'DDR4 16Gb (2Gx8)'), b = pick(d, 'DDR5 16Gb (2Gx8)'); return fin(a) && b > 0 ? { d: d.date, ratio: rnd(a / b, 3), ddr4: a, ddr5: b } : null }).filter(Boolean)
}

// one cell of the contract table: for a segment and quarter, the figure reported after the quarter if there is one,
// otherwise the latest forecast
export function contractCell(contract, segment, quarter) {
  const c = (contract || []).filter(x => x.segment === segment && x.quarter === quarter && fin(x.changeLow))
  if (!c.length) return null
  const best = c.sort((a, b) => (a.kind === 'actual' ? 1 : 0) - (b.kind === 'actual' ? 1 : 0) || String(a.issued).localeCompare(String(b.issued))).at(-1)
  const hi = fin(best.changeHigh) ? best.changeHigh : best.changeLow
  return { low: best.changeLow, high: hi, mid: (best.changeLow + hi) / 2, kind: best.kind, issued: best.issued || null, note: best.note || null, url: best.url || null }
}

// Quarterly contract changes compounded into an index (100 before the first quarter), using the middle of each range
export function contractIndex(contract, segments, from = '2024-Q3') {
  const quarters = [...new Set((contract || []).map(c => c.quarter))].filter(q => q >= from).sort()
  const level = Object.fromEntries(segments.map(s => [s, 100])), alive = Object.fromEntries(segments.map(s => [s, true]))
  return quarters.map(q => {
    const row = { q, forecast: false }
    for (const s of segments) {
      const c = alive[s] ? contractCell(contract, s, q) : null
      if (!c) { alive[s] = false; continue }                                // a gap ends the line: nothing is interpolated
      level[s] *= 1 + c.mid / 100; row[s] = rnd(level[s], 1); if (c.kind !== 'actual') row.forecast = true
    }
    return row
  }).filter(r => segments.some(s => fin(r[s])))
}

// monthly fixed-transaction price levels quoted in the press → one row a month for the three parts that have a run
export function levelSeries(levels) {
  const key = item => (/^DDR4 8Gb/.test(item) ? 'ddr4' : /^NAND 128Gb/.test(item) ? 'nand' : /^DDR5 16Gb/.test(item) && !/DIMM|module/i.test(item) ? 'ddr5' : null)
  const by = {}
  for (const l of levels || []) { const k = key(l.item); if (k && fin(l.value) && /^\d{4}-\d{2}$/.test(l.month || '')) (by[l.month] ||= { m: l.month })[k] = l.value }
  return Object.values(by).sort((a, b) => a.m.localeCompare(b.m))
}

// a CSV with quoted fields → rows keyed by the header
const parseCsv = text => { const lines = String(text || '').trim().split(/\r?\n/).map(line => { const c = []; let cur = '', q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { c.push(cur); cur = '' } else cur += ch } c.push(cur); return c }); const h = lines[0] || []; return lines.slice(1).map(r => Object.fromEntries(h.map((k, i) => [k, r[i]]))) }

// Stanford's compilation → retail dollars per GB by month since `from`: DDR5, DDR4 and the cheapest NAND (Keepa), and
// the long DRAM record (McCallum) for the years before
export function retailSeries(rows, from = '2016-01') {
  const want = { 'DDR5 (Keepa)': 'ddr5', 'DDR4 (Keepa)': 'ddr4', 'NAND cheapest (Keepa)': 'nand', 'McCallum DRAM (historical)': 'dram' }
  const by = {}
  for (const r of rows || []) { const k = want[r.series], v = Number(r.value), m = String(r.date || '').slice(0, 7); if (k && r.metric === 'usd_per_gb' && fin(v) && v > 0 && m >= from) (by[m] ||= { m })[k] = rnd(v, 4) }
  return Object.values(by).sort((a, b) => a.m.localeCompare(b.m))
}

// The dollars-per-GB ladder: the headline spot parts, the server module, and the hand-kept HBM ranges if there are any
export function ladder(rows, hbm, hbmLadder) {
  const out = []
  for (const h of hbmLadder || []) if (fin(h.low) && fin(h.high)) out.push({ id: `hbm-${h.label}`, label: h.label, family: 'HBM', perGb: rnd((h.low + h.high) / 2, 2), low: h.low, high: h.high, kind: 'estimate', note: `${h.members?.length || 0} sourced figures, latest ${h.asOf}; ${h.note}`, confidence: null })
  if (hbmLadder?.length) hbm = []
  const latestHbm = (hbm || []).filter(r => /per GB/i.test(r.metric) && fin(r.value)).sort((a, b) => String(b.asOf).localeCompare(String(a.asOf)))
  const seen = new Set()
  for (const r of latestHbm) { if (seen.has(r.product)) continue; seen.add(r.product); out.push({ id: `hbm-${r.product}`, label: r.product, family: 'HBM', perGb: r.valueHigh ? (r.value + r.valueHigh) / 2 : r.value, low: r.value, high: r.valueHigh || null, kind: 'estimate', note: `${r.statedBy || 'estimate'}, ${r.asOf}${r.appliesTo ? `; ${r.appliesTo}` : ''}`, url: r.url || null, confidence: r.confidence || null }) }
  for (const h of HEADLINE) { const r = rows.find(x => x.head === h.id); if (r && fin(r.perGb)) out.push({ id: h.id, label: h.label, family: h.family, perGb: r.perGb, kind: 'spot', note: `$${r.avg} for ${r.gb} GB; ${h.note}`, chg30: r.chg30 }) }
  return out.sort((a, b) => b.perGb - a.perGb)
}

export const CONTRACT_SEGMENTS = ['conventional DRAM', 'HBM-blended DRAM', 'server DRAM', 'PC DRAM', 'mobile DRAM', 'overall NAND Flash', 'enterprise SSD', 'client SSD', 'NAND wafers']
const URL_STANFORD = 'https://dam.stanford.edu/assets/memory-prices/memory-prices.csv'
const BOK = { dram: '30911201AA', flash: '30911202AA' }

export function createMemoryPrices({ dir, feed, research, env = {}, UA = 'econ-dashboard', now = () => Date.now() }) {
  const FILE_LONG = dir ? path.join(dir, 'memory-long-run.json') : null
  let store = { version: 1, stanford: { fetched: 0, rows: [] }, bok: { fetched: 0, months: {} } }
  try { if (FILE_LONG && fs.existsSync(FILE_LONG)) { const d = JSON.parse(fs.readFileSync(FILE_LONG, 'utf8')); if (d?.version === 1) store = d } } catch { /* fetch afresh */ }
  const save = () => { try { if (FILE_LONG) fs.writeFileSync(FILE_LONG, JSON.stringify(store)) } catch (e) { console.error('memory-long-run.json save:', e.message) } }
  const ym = t => { const d = new Date(t); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
  let cache = null

  // Retail dollars per GB (Stanford's compilation of Keepa and McCallum): read at most once a week
  async function stanford(errors) {
    if (store.stanford.rows.length && now() - store.stanford.fetched < 7 * 24 * H) return
    try {
      const r = await fetch(URL_STANFORD, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(40000) })
      if (!r.ok) throw new Error(`Stanford answered ${r.status}`)
      const rows = retailSeries(parseCsv(await r.text()), '2010-01')
      if (rows.length < 20) throw new Error('the retail price file came back short')
      store.stanford = { fetched: now(), rows }; save()
    } catch (e) { errors.push(`retail prices: ${String(e?.message || e).slice(0, 80)}`) }
  }

  // Bank of Korea export price indexes for DRAM and flash memory, dollar basis, 2020 = 100. With a free ECOS key
  // (BOK_ECOS_KEY in .env) the record from 2015; without one, the bank's open sample key, which answers ten rows a
  // call, so only the latest ten months are asked for. Read at most once a week
  async function bok(errors) {
    if (Object.keys(store.bok.months).length && now() - store.bok.fetched < 7 * 24 * H) return
    const key = env.BOK_ECOS_KEY || process.env.BOK_ECOS_KEY || 'sample', n = key === 'sample' ? 10 : 400
    const end = ym(now()), start = key === 'sample' ? ym(now() - 330 * DAY) : '201501'
    try {
      for (const [name, item] of Object.entries(BOK)) {
        const r = await fetch(`https://ecos.bok.or.kr/api/StatisticSearch/${key}/json/en/1/${n}/402Y016/M/${start}/${end}/${item}/D`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })
        if (!r.ok) throw new Error(`Bank of Korea answered ${r.status}`)
        const rows = (await r.json())?.StatisticSearch?.row || []
        for (const x of rows) { const v = Number(x.DATA_VALUE), m = `${x.TIME.slice(0, 4)}-${x.TIME.slice(4, 6)}`; if (fin(v)) (store.bok.months[m] ||= { m })[name] = v }
      }
      store.bok.fetched = now(); store.bok.keyed = key !== 'sample'; save()
    } catch (e) { errors.push(`Bank of Korea: ${String(e?.message || e).slice(0, 80)}`) }
  }

  async function get() {
    if (cache && now() - cache.ts < H) return cache.out
    const mem = await feed()
    if (!mem?.available) throw new Error('No memory prices yet: the first successful read of TrendForce seeds the archive')
    const days = mem.days || [], rows = board(days), last = days.at(-1)
    const f = research ? await research.read(FILE).catch(() => null) : null
    const kept = f?.data || null
    const errors = []
    await Promise.all([stanford(errors), bok(errors)])
    const qNow = (() => { const d = new Date(now()); return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}` })()
    const quarters = kept ? [...new Set(kept.contract.map(c => c.quarter))].sort().filter(q => q <= `${+qNow.slice(0, 4) + 1}-Q${qNow.slice(6)}`).slice(-9) : []
    const segs = kept ? CONTRACT_SEGMENTS.filter(s => quarters.some(q => contractCell(kept.contract, s, q))) : []
    const moved = rows.filter(r => fin(r.session)), up30 = rows.filter(r => r.chg30 > 0.005).length, down30 = rows.filter(r => r.chg30 < -0.005).length
    const ratio = legacyRatio(days)
    // headline parts indexed to 100 at the first day each has a price
    const heads = HEADLINE.filter(h => rows.some(r => r.head === h.id))
    const hist = days.map(d => { const o = { d: d.date }; for (const h of heads) { const v = (d.items || []).find(i => i.n.startsWith(h.prefix) && (i.k || 'spot') === 'spot')?.avg; if (fin(v)) o[h.id] = v } return o })
    const base = Object.fromEntries(heads.map(h => [h.id, hist.find(r => fin(r[h.id]))?.[h.id]]))
    const out = {
      built: new Date(now()).toISOString(), asOf: mem.asOf, daysStale: mem.daysStale, liveOk: mem.liveOk, archiveDays: days.length, archiveFrom: days[0]?.date || null,
      rows, heads: heads.map(h => ({ id: h.id, label: h.label, family: h.family, note: h.note })),
      indexed: hist.map(r => { const o = { d: r.d }; for (const h of heads) if (fin(r[h.id]) && base[h.id] > 0) o[h.id] = rnd((r[h.id] / base[h.id]) * 100, 1); return o }),
      ladder: ladder(rows, kept?.hbm, kept?.hbmLadder), ratio, errors, now: qNow,
      contractTable: kept ? { quarters, rows: segs.map(s => ({ segment: s, cells: quarters.map(q => contractCell(kept.contract, s, q)) })) } : null,
      contractIndex: kept ? contractIndex(kept.contract, ['conventional DRAM', 'HBM-blended DRAM', 'overall NAND Flash']) : [],
      levels: kept ? levelSeries(kept.levels) : [],
      retail: store.stanford.rows.filter(r => r.m >= '2016-01'), retailFetched: store.stanford.fetched ? new Date(store.stanford.fetched).toISOString() : null,
      exportIndex: { months: Object.values(store.bok.months).sort((a, b) => a.m.localeCompare(b.m)), keyed: !!store.bok.keyed },
      breadth: { session: { up: moved.filter(r => r.session > 0).length, down: moved.filter(r => r.session < 0).length, n: moved.length }, month: { up: up30, down: down30, n: rows.filter(r => fin(r.chg30)).length } },
      contracts: (last?.contracts || []).map(c => ({ ...c, gb: rnd(gbOf(c.n), 3), perGb: gbOf(c.n) ? rnd(c.avg / gbOf(c.n), 3) : null })),
      kept: kept ? { available: true, reviewed: kept.reviewed || null, caveat: kept.caveat || null, counts: { hbm: (kept.hbm || []).length, contract: (kept.contract || []).length, makers: (kept.makers || []).length },
        // the HBM rows that are a price, a premium, a multiple or a supply statement (shares and market sizes stay in the file)
        hbm: (kept.hbm || []).filter(r => /price per|premium|multiple|relative|sold out|contract price change/i.test(r.metric)),
        makers: (kept.makers || []).filter(r => r.show) }
        : { available: false, reason: research ? (research.missing('memory price file', FILE).reason) : 'No Research Database reader configured.' },
      notes: [
        'Spot prices are TrendForce session averages for the marginal traded lot. Spot leads contract by about a quarter and overshoots both ways: read direction and breadth before level.',
        'Dollars per GB divides each price by the capacity in the part\'s name (16Gb is 2 GB; a 512Gb wafer die is 64 GB). A module\'s price includes the board and assembly, so it sits above its chips.',
        'TrendForce\'s own price history is for members; this history is the dashboard\'s own archive, one snapshot a day since the scraper first ran, and NAND and wafers only from the day those pages were added.',
        'HBM is not traded on a spot market. Its prices here are analysts\' and press estimates of negotiated contracts, kept by hand with their sources; treat them as ranges.',
      ],
      source: 'TrendForce price pages (DRAM, NAND flash), this dashboard\'s daily archive; hand-kept HBM, contract and maker figures from the Research Database',
    }
    cache = { ts: now(), out }
    return out
  }
  return { get }
}
