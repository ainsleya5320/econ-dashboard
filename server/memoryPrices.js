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

// The dollars-per-GB ladder: the headline spot parts, the server module, and the hand-kept HBM figure if there is one
export function ladder(rows, hbm) {
  const out = []
  const latestHbm = (hbm || []).filter(r => /per GB/i.test(r.metric) && fin(r.value)).sort((a, b) => String(b.asOf).localeCompare(String(a.asOf)))
  const seen = new Set()
  for (const r of latestHbm) { if (seen.has(r.product)) continue; seen.add(r.product); out.push({ id: `hbm-${r.product}`, label: r.product, family: 'HBM', perGb: r.valueHigh ? (r.value + r.valueHigh) / 2 : r.value, low: r.value, high: r.valueHigh || null, kind: 'estimate', note: `${r.statedBy || 'estimate'}, ${r.asOf}${r.appliesTo ? `; ${r.appliesTo}` : ''}`, url: r.url || null, confidence: r.confidence || null }) }
  for (const h of HEADLINE) { const r = rows.find(x => x.head === h.id); if (r && fin(r.perGb)) out.push({ id: h.id, label: h.label, family: h.family, perGb: r.perGb, kind: 'spot', note: `$${r.avg} for ${r.gb} GB; ${h.note}`, chg30: r.chg30 }) }
  return out.sort((a, b) => b.perGb - a.perGb)
}

export function createMemoryPrices({ feed, research, now = () => Date.now() }) {
  let cache = null
  async function get() {
    if (cache && now() - cache.ts < H) return cache.out
    const mem = await feed()
    if (!mem?.available) throw new Error('No memory prices yet: the first successful read of TrendForce seeds the archive')
    const days = mem.days || [], rows = board(days), last = days.at(-1)
    const f = research ? await research.read(FILE).catch(() => null) : null
    const kept = f?.data || null
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
      ladder: ladder(rows, kept?.hbm), ratio,
      breadth: { session: { up: moved.filter(r => r.session > 0).length, down: moved.filter(r => r.session < 0).length, n: moved.length }, month: { up: up30, down: down30, n: rows.filter(r => fin(r.chg30)).length } },
      contracts: (last?.contracts || []).map(c => ({ ...c, gb: rnd(gbOf(c.n), 3), perGb: gbOf(c.n) ? rnd(c.avg / gbOf(c.n), 3) : null })),
      kept: kept ? { available: true, reviewed: kept.reviewed || null, hbm: kept.hbm || [], contract: kept.contract || [], levels: kept.levels || [], makers: kept.makers || [], series: kept.series || [], caveat: kept.caveat || null }
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
