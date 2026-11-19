// ============================================================================
// COMPUTE BALANCE — AI Economy → Compute: is compute short or in glut? One
// board that reads the signals this dashboard already collects the way a
// commodity desk reads a market: what old supply fetches, the shape of the
// forward curve, whether you can get any today, and whether buyers' orders are
// outrunning deliveries. Each signal is graded shortage, balanced or glut by a
// stated rule; the verdict is the count. Nothing here is a model or a forecast.
//
// No data of its own: every reading comes from a feed another module keeps
// (prices and availability from the GPU market modules, the lab's filed income
// statement, suppliers' backlog from the Research Database), so each row names
// the chart it summarises. A feed that fails leaves its rows ungraded.
//
// Why these signals. A glut shows first where supply is most replaceable: old
// chips, spot prices and the deferred end of the curve fall before anything
// else does. A shortage shows as the opposite and as rationing: an ageing chip
// that rents for more than a year ago, spot at or above the committed price,
// nothing launchable, backlogs growing faster than revenue, and a lab earning
// more per dollar of compute because it cannot buy more.
//
// Also returned, not graded: the growth race, the yearly multiples at which
// demand (tokens, lab revenue, businesses' token spend on Ramp) and supply (capex, hardware shipments, the
// AI 2027 scenario's stock of compute) are growing. Dollars and tokens are not
// the same unit and each new chip does more work, so the two columns are set
// side by side and not netted.
// History of the verdict: compute-balance.json at the root (gitignored), one
// row per day the board builds.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 2) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const med = xs => { const v = xs.filter(fin).sort((a, b) => a - b); if (!v.length) return null; const m = (v.length - 1) / 2; return (v[Math.floor(m)] + v[Math.ceil(m)]) / 2 }
const pctS = (v, dp = 0) => (fin(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v * 100).toFixed(dp)}%` : '—')
const usd = v => (fin(v) ? `$${v.toFixed(2)}` : '—')
const yearBefore = d => `${+d.slice(0, 4) - 1}${d.slice(4)}`
const DATACENTER = ['H100', 'H200', 'B200', 'B300']

// value ≥ hi → `high`, ≤ lo → `low`, else balanced (which of shortage/glut is "high" depends on the signal)
const band = (v, lo, hi, high = 'shortage') => (!fin(v) ? 'none' : v >= hi ? high : v <= lo ? (high === 'shortage' ? 'glut' : 'shortage') : 'balanced')

// a price series keyed by day → the latest value against the same day a year earlier, and a monthly line for the sparkline
export function yearChange(byDate, key) {
  const days = Object.keys(byDate || {}).filter(d => fin(byDate[d]?.[key])).sort()
  const d1 = days.at(-1)
  if (!d1) return null
  const d0 = [...days].reverse().find(d => d <= yearBefore(d1))
  const months = {}
  for (const d of days) months[d.slice(0, 7)] = byDate[d][key]
  return { d1, d0: d0 || null, now: byDate[d1][key], then: d0 ? byDate[d0][key] : null, chg: d0 ? byDate[d1][key] / byDate[d0][key] - 1 : null, series: Object.entries(months).slice(-24) }
}

// x: the raw inputs (any may be null) → { signals, verdict, growth }
export function buildBalance(x) {
  const S = []
  const add = (id, group, label, o) => S.push({ id, group, label, grade: 'none', ...o })

  // ── what old supply fetches ──
  for (const [key, name, id] of [['h100', 'H100 (2022 chip), one-year contract', 'h100-contract'], ['a100', 'A100 (2020 chip), one-year contract', 'a100-contract']]) {
    const y = x.contract && yearChange(x.contract, key)
    add(id, 'price', name, !y || !fin(y.chg) ? { reading: '—', detail: 'No price a year apart on file.' } : {
      grade: band(y.chg, -0.25, 0), value: rnd(y.chg, 4), reading: `${usd(y.now)}/hr, ${pctS(y.chg)} on a year ago`, series: y.series, asOf: y.d1,
      detail: `${usd(y.then)} on ${y.d0}. An ageing chip should rent for less each year as better ones arrive.`,
      rule: 'Up on the year: shortage. Down by more than 25%: glut.', home: 'Compute → the GPU-hour, every way it is sold',
    })
  }
  {
    const y = x.contract && yearChange(x.contract, 'h100'), spot = x.spotH100
    const r = y && fin(spot) ? spot / y.now : null
    add('spot-contract', 'price', 'Marketplace spot against the one-year contract (H100)', !fin(r) ? { reading: '—', detail: 'No spot price or no contract price.' } : {
      grade: band(r, 0.75, 0.95), value: rnd(r, 3), reading: `${usd(spot)} spot vs ${usd(y.now)} contract (${r.toFixed(2)}×)`, asOf: y.d1,
      detail: 'An interruptible hour on a marketplace should cost well under a committed one. When it does not, nobody needs to discount to fill machines.',
      rule: 'Spot at 95% of contract or more: shortage. Under 75%: glut.', home: 'Compute → GPU rental rates',
    })
  }
  {
    const h = x.futures?.history?.H100?.at(-1), spot = x.contract && yearChange(x.contract, 'h100')?.now
    const slope = h && fin(h.front) && fin(h.m12) ? h.front / h.m12 - 1 : null
    add('futures-curve', 'price', 'Forward curve: front month against twelve months out (H100 futures)', !fin(slope) ? { reading: '—', detail: 'No futures settlements on file.' } : {
      grade: band(slope, -0.05, 0.05), value: rnd(slope, 4), reading: `${usd(h.front)} front, ${usd(h.m12)} in a year (${pctS(slope)})`, asOf: h.d, series: (x.futures.history.H100 || []).slice(-60).map(r => [r.d, fin(r.front) && fin(r.m12) ? rnd(r.front / r.m12 - 1, 4) : null]),
      detail: `A front month above the deferred ones (backwardation) is a market short today and expecting relief; the reverse is a market with plenty now.${fin(spot) ? ` The front month is ${pctS(h.front / spot - 1)} against today's contract price.` : ''}${h.volume === 0 ? ' No contracts traded: these are the exchange\'s settlement marks.' : ''}`,
      rule: 'Front more than 5% above twelve months out: shortage. More than 5% below: glut.', home: 'Compute → the forward curve',
    })
  }

  // ── can you get one ──
  {
    const by = x.shadeform?.byGpu || {}, rows = DATACENTER.map(g => by[g]).filter(g => g && g.rows > 0)
    const total = rows.reduce((s, g) => s + g.rows, 0), avail = rows.reduce((s, g) => s + (g.available || 0), 0), share = total ? avail / total : null
    const days = {}
    for (const r of x.availabilityDaily || []) if (DATACENTER.includes(r.gpu)) { const d = (days[r.d] ||= [0, 0]); d[0] += r.available || 0; d[1] += r.rows || 0 }
    add('launchable', 'availability', 'Listings you can launch right now (H100 to B300, about 18 clouds)', !fin(share) ? { reading: '—', detail: 'No availability snapshot.' } : {
      grade: band(share, 0.25, 0.6, 'glut'), value: rnd(share, 3), reading: `${avail} of ${total} listings (${Math.round(share * 100)}%)`, asOf: x.shadeform.asOf?.slice(0, 10),
      series: Object.entries(days).sort().slice(-60).map(([d, v]) => [d, v[1] ? rnd(v[0] / v[1], 3) : null]),
      detail: DATACENTER.filter(g => by[g]?.rows).map(g => `${g} ${by[g].available}/${by[g].rows}`).join(', ') + '. A listed price with nothing to launch is a queue, not a market.',
      rule: 'Under 25% launchable: shortage. Over 60%: glut.', home: 'Compute → can you launch one right now?',
    })
  }
  {
    const g = (x.nebius?.byGpu || []).filter(r => fin(r.vsFixed)), v = med(g.map(r => r.vsFixed / 100)), ceil = med(g.map(r => r.ceilShare7)), floor = med(g.map(r => r.floorShare7))
    add('spot-auction', 'availability', 'A neocloud\'s spot auction against its old fixed price', !fin(v) ? { reading: '—', detail: 'No spot auction data.' } : {
      grade: band(v, -0.1, 0.1), value: rnd(v, 3), reading: `median ${pctS(v)} against the fixed price`, asOf: x.nebius.snapshotTime?.slice(0, 10),
      detail: `${g.length} chips priced by auction since October: the price floats between a floor and a ceiling. Hours at the ceiling in the past week ${Math.round((ceil || 0) * 100)}%, at the floor ${Math.round((floor || 0) * 100)}% (medians across chips).`,
      rule: 'Clearing more than 10% above the old fixed price: shortage. More than 10% below: glut.', home: 'Compute → the live price of a preemptible GPU-hour',
    })
  }
  {
    const by = x.hyperscalers?.byGpu || {}, r = med(DATACENTER.map(g => by[g]?.awsRatioMedian))
    add('cloud-spot', 'availability', 'Big-cloud spot price as a share of list (AWS)', !fin(r) ? { reading: '—', detail: 'No hyperscaler spot data.' } : {
      grade: band(r, 0.4, 0.7), value: rnd(r, 3), reading: `${Math.round(r * 100)}% of the on-demand price`, asOf: x.hyperscalers.built?.slice(0, 10),
      detail: DATACENTER.filter(g => fin(by[g]?.awsRatioMedian)).map(g => `${g} ${Math.round(by[g].awsRatioMedian * 100)}%`).join(', ') + '. Spot is the cloud selling what its committed customers are not using; a small discount means little is idle.',
      rule: 'Spot at 70% of list or more: shortage. Under 40%: glut.', home: 'Compute → hyperscaler spot against list',
    })
  }
  {
    const s = x.resale?.series || [], last = s.at(-1), prev = last && s.find(r => r.month === yearBefore(`${last.month}-01`).slice(0, 7)), chg = last && prev ? last.index / prev.index - 1 : null
    add('resale', 'price', 'Used GPU resale index', !fin(chg) ? { reading: last ? `${last.index} (${last.month})` : '—', detail: 'Under a year of index on file.' } : {
      grade: band(chg, -0.15, 0.05), value: rnd(chg, 4), reading: `${last.index}, ${pctS(chg)} on a year ago`, asOf: last.month, series: s.slice(-24).map(r => [r.month, r.index]),
      detail: 'Secondhand hardware is the first thing to lose its bid when capacity is plentiful.',
      rule: 'Up more than 5% on the year: shortage. Down more than 15%: glut.', home: 'Compute → secondhand hardware',
    })
  }

  // ── orders against deliveries ──
  {
    const q = x.lab?.quarters || [], now = q.at(-1), was = q.at(-3), a = now && now.revenue / now.compute, b = was && was.revenue / was.compute, chg = fin(a) && fin(b) ? a / b - 1 : null
    add('revenue-per-compute', 'orders', 'A lab\'s revenue per dollar of compute (filed)', !fin(chg) ? { reading: '—', detail: 'No filed lab quarters.' } : {
      grade: band(chg, -0.1, 0.1), value: rnd(a, 3), reading: `$${a.toFixed(2)} in ${now.label}, $${b.toFixed(2)} two quarters earlier`, asOf: now.end, series: q.map(r => [r.label, rnd(r.revenue / r.compute, 3)]),
      detail: `${x.lab.name}: compute is bought 12 to 18 months ahead, so a lab that cannot add capacity sells more from what it has. This rises in a shortage and falls when capacity arrives ahead of demand.`,
      rule: 'Up more than 10% over two quarters: shortage. Down more than 10%: glut.', home: 'Models & Labs → Lab Economics',
    })
  }
  {
    // each supplier's newest figure against the one about a year earlier; a series shorter than that (but at least
    // six months) is annualised over the span it has
    const yrs = (a, b) => (Date.parse(b) - Date.parse(a)) / (365.25 * 864e5)
    const g = (x.backlog || []).map(pts => {
      const p = pts.filter(r => fin(r.value) && r.value > 0), last = p.at(-1)
      const prev = last && ([...p].reverse().find(r => yrs(r.end, last.end) >= 0.95) || (p[0] !== last && yrs(p[0].end, last.end) >= 0.5 ? p[0] : null))
      return prev ? (last.value / prev.value) ** (1 / yrs(prev.end, last.end)) - 1 : null
    }).filter(fin)
    const m = med(g)
    add('backlog', 'orders', 'Suppliers\' backlog of signed, undelivered business', !fin(m) ? { reading: '—', detail: 'Backlog series are read from the Research Database; none spans six months yet.' } : {
      grade: band(m, 0.1, 0.4), value: rnd(m, 3), reading: `median ${pctS(m)} a year across ${g.length} suppliers`,
      detail: `Range ${pctS(Math.min(...g))} to ${pctS(Math.max(...g))}. Clouds and neoclouds report what customers have committed to but not yet received; it grows faster than revenue when capacity, not demand, sets the pace.`,
      rule: 'Median up more than 40% on the year: shortage. Under 10%: glut.', home: 'Models & Labs → who pays whom',
    })
  }
  {
    const d = x.memoryDays || [], pick = day => (day?.items || []).find(i => /^DDR5 16Gb/.test(i.n) && !/eTT/.test(i.n)), a = pick(d.at(-1)), b = pick(d[0]), chg = a && b && b.avg > 0 ? a.avg / b.avg - 1 : null
    add('memory', 'orders', 'DRAM spot price (DDR5 16Gb)', !fin(chg) ? { reading: '—', detail: 'No memory prices on file.' } : {
      grade: band(chg, -0.1, 0.1), value: rnd(chg, 4), reading: `$${a.avg.toFixed(1)}, ${pctS(chg)} since ${d[0].date}`, asOf: d.at(-1).date, series: d.map(r => [r.date, pick(r)?.avg ?? null]),
      detail: `Memory is the input the accelerator makers cannot get enough of in a build-out; its spot price moves before contract prices do. Only ${d.length} days on file, so this is a short window.`,
      rule: 'Up more than 10% over the window: shortage. Down more than 10%: glut.', home: 'Supply Chain → memory prices',
    })
  }

  const graded = S.filter(s => s.grade !== 'none'), n = g => graded.filter(s => s.grade === g).length
  const counts = { shortage: n('shortage'), balanced: n('balanced'), glut: n('glut'), ungraded: S.length - graded.length }
  const lean = counts.shortage - counts.glut
  const verdict = !graded.length ? 'no data' : lean >= Math.ceil(graded.length / 2) ? 'shortage' : lean >= 2 ? 'leaning short' : -lean >= Math.ceil(graded.length / 2) ? 'glut' : lean <= -2 ? 'leaning long' : 'balanced'
  return { signals: S, counts, graded: graded.length, verdict }
}

// Ramp's archived token weeks (each: spend growth on the same week a month earlier, in %) → a yearly multiple.
// Readings are taken going back from the newest, each at least four weeks before the one after it, so no two
// overlap; up to twelve are compounded and scaled to twelve months. One month scaled up is noisy: flagged.
export function rampAnnual(history) {
  const h = (history || []).filter(w => fin(w.spendGrowth) && fin(Date.parse(w.week))).sort((a, b) => Date.parse(b.week) - Date.parse(a.week))
  const used = []
  for (const w of h) if (used.length < 12 && (!used.length || Date.parse(used.at(-1).week) - Date.parse(w.week) >= 27 * 864e5)) used.push(w)
  if (!used.length) return null
  const comp = used.reduce((p, w) => p * (1 + w.spendGrowth / 100), 1)
  return { multiple: comp ** (12 / used.length), months: used.length, latest: used[0] }
}

// yearly multiples of demand and supply, each labelled with what it measures; nothing is netted
export function growthRace(x) {
  const demand = [], supply = []
  const t = x.tokens?.growth
  if (fin(t?.w52)) demand.push({ label: 'Tokens through OpenRouter', multiple: rnd(1 + t.w52 / 100, 1), note: `weekly volume against a year ago (since ${t.w52Since}); a developer-heavy sample` })
  const r = rampAnnual(x.ramp)
  if (r) {
    const l = r.latest, p = (l.price || []).find(q => /&/.test(q.name)) || l.price?.[0]
    const sign = v => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`
    demand.push({ label: 'Business token spending (Ramp)', multiple: rnd(r.multiple, 1), extrapolated: r.months < 12, months: r.months,
      note: `${sign(l.spendGrowth)} in the month to the week ending ${l.week}${fin(l.volumeGrowth) ? `; volume ${sign(l.volumeGrowth)}` : ''}${p && fin(p.latest) && fin(p.prior) ? `, blended price $${p.prior.toFixed(2)} to $${p.latest.toFixed(2)} per million` : ''}. ${r.months === 1 ? 'One month compounded to a year' : `${r.months} months compounded to a year`}; API spend by Ramp's customers` })
  }
  for (const [co, rows] of Object.entries(x.runRates || {})) {
    const l = rows.at(-1), from = l && [...rows].reverse().find(r => r.t <= l.t - 0.9)
    if (l && from && from.v > 0) demand.push({ label: `${co}, annualised revenue`, multiple: rnd((l.v / from.v) ** (1 / (l.t - from.t)), 1), note: `$${from.v.toFixed(1)}B (${from.d}) to $${l.v.toFixed(1)}B (${l.d}), per year` })
  }
  if (fin(x.capex?.now) && x.capex.prev > 0) supply.push({ label: 'Five hyperscalers\' capex', multiple: rnd(x.capex.now / x.capex.prev, 2), note: `$${Math.round(x.capex.now)}B over the last four quarters against $${Math.round(x.capex.prev)}B the four before (to ${x.capex.end})` })
  for (const g of x.chain || []) if (fin(g.yoy3)) supply.push({ label: `${g.label}, revenue`, multiple: rnd(1 + g.yoy3, 2), note: `Taiwan-listed, three months to ${g.m} against a year earlier` })
  const sc = x.scenario
  if (sc?.stock && sc.year && sc.stock[sc.year] && sc.stock[sc.year - 1]) supply.push({ label: 'Stock of AI compute (AI 2027 scenario)', multiple: rnd(sc.stock[sc.year] / sc.stock[sc.year - 1], 2), forecast: true, note: `${sc.stock[sc.year - 1]}M to ${sc.stock[sc.year]}M H100-equivalents over ${sc.year}: a forecast, not a count` })
  return { demand, supply }
}

export function createComputeBalance({ dir, feeds, research, now = () => Date.now() }) {
  const FILE = path.join(dir, 'compute-balance.json')
  const read = rel => { try { return JSON.parse(fs.readFileSync(path.join(dir, rel), 'utf8')) } catch { return null } }
  let hist = { version: 1, days: {} }
  try { if (fs.existsSync(FILE)) { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (d?.version === 1) hist = d } } catch { /* start afresh */ }
  let cache = null
  const safe = async (name, fn, errors) => { try { return await Promise.race([fn(), new Promise((_, rej) => setTimeout(() => rej(new Error('timed out')), 45000))]) } catch (e) { errors.push(`${name}: ${String(e?.message || e).slice(0, 80)}`); return null } }

  async function get() {
    if (cache && now() - cache.ts < H) return cache.out
    const errors = []
    const [futures, market, nebius, hyperscalers, pulse, chainFeed, rampFeed, backlogFile] = await Promise.all([
      safe('GPU futures', feeds.futures, errors), safe('GPU market data', feeds.market, errors), safe('spot auction', feeds.nebius, errors),
      safe('hyperscaler spot', feeds.hyperscalers, errors), safe('AI pulse', feeds.pulse, errors), safe('supply chain', feeds.chain, errors),
      feeds.ramp ? safe('Ramp AI Index', feeds.ramp, errors) : null,
      safe('Research Database backlog', () => research.read(['data', 'curated', 'backlog.json']), errors),
    ])
    const lab = (read('src/data/labFinancials.json')?.labs || []).filter(l => (l.quarters || []).length >= 3).sort((a, b) => b.quarters.at(-1).end.localeCompare(a.quarters.at(-1).end))[0] || null
    const x = {
      contract: read('semi-h100-index.json')?.byDate || null,
      spotH100: (pulse?.gpu?.vast || []).find(g => /^H100/.test(g.gpu))?.median ?? null,
      futures, shadeform: market?.shadeform || null, resale: market?.resale || null, availabilityDaily: read('data/ai/gpu-availability-daily.json')?.rows || [],
      nebius, hyperscalers, lab, memoryDays: read('memory-prices.json')?.days || [],
      backlog: Object.values(backlogFile?.data?.tickers || {}).map(t => t.series?.[0]?.points || []),
    }
    const board = buildBalance(x)

    // the growth race
    const tOf = ym => +ym.slice(0, 4) + (+ym.slice(5, 7) - 0.5) / 12
    const runRates = {}
    for (const r of read('data/ai/revenue-disclosures.json')?.disclosures || []) if (fin(r.arr) && /^\d{4}-\d{2}$/.test(r.d)) (runRates[r.co] ||= []).push({ d: r.d, t: tOf(r.d), v: r.arr })
    for (const k of Object.keys(runRates)) { runRates[k].sort((a, b) => a.t - b.t); if (runRates[k].length < 2 || runRates[k].at(-1).t < new Date(now()).getFullYear() - 0.5) delete runRates[k] }
    const hc = read('hyperscaler-capex.json'), cos = Object.values(hc?.companies || {}).filter(c => (c.quarters || []).length >= 8)
    const end = cos.map(c => c.quarters.at(-1).date).sort()[0], sum = (c, a, b) => c.quarters.filter(q => q.date <= end).slice(a, b).reduce((s, q) => s + (q.capex || 0), 0) / 1e9
    const scenario = read('data/ai/ai-2027.json'), year = new Date(now()).getFullYear()
    const growth = growthRace({
      tokens: pulse?.tokens || null, runRates, ramp: rampFeed?.tokenHistory || null,
      capex: cos.length ? { now: cos.reduce((s, c) => s + sum(c, -4), 0), prev: cos.reduce((s, c) => s + sum(c, -8, -4), 0), end: end?.slice(0, 7) } : null,
      chain: (chainFeed?.groups || []).filter(g => ['foundry', 'odm', 'memory'].includes(g.id) && g.latest).map(g => ({ label: g.label, yoy3: g.latest.yoy3, m: g.latest.m })),
      scenario: scenario ? { year, stock: Object.fromEntries(Object.entries(scenario.series?.stockH100e?.values || {}).map(([y, v]) => [+y, v])) } : null,
    })

    const day = new Date(now() - new Date(now()).getTimezoneOffset() * 60000).toISOString().slice(0, 10)
    if (board.graded) {
      hist.days[day] = { ...board.counts, verdict: board.verdict, by: Object.fromEntries(board.signals.filter(s => s.grade !== 'none').map(s => [s.id, s.grade])) }
      try { fs.writeFileSync(FILE, JSON.stringify(hist)) } catch (e) { console.error('compute-balance.json save:', e.message) }
    }
    const out = { built: new Date(now()).toISOString(), ...board, growth, errors,
      history: Object.entries(hist.days).sort().slice(-180).map(([d, v]) => ({ d, shortage: v.shortage, balanced: v.balanced, glut: v.glut, verdict: v.verdict })),
      note: 'Each signal is graded by the rule printed beside it; the thresholds are judgment, written down so they can be argued with. The verdict is the count, not a weighted score.' }
    cache = { ts: now(), out }
    return out
  }
  return { get }
}
