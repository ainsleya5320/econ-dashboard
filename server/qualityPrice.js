// ============================================================================
// QUALITY PRICE — AI Economy → Tokens: the price of a fixed capability. A
// token is not a constant good: the same dollar buys a smarter token each
// year. The way to see a price series for "the same thing" is to fix a level
// of capability and ask what the cheapest model at or above it has cost.
//
//   2021–2025  Epoch AI's dataset: for a benchmark and a threshold ("as good
//              as GPT-4 on MMLU"), the cheapest model reaching it by release
//              date, at the price it listed then (CC BY 4.0). The record ends
//              in February 2025, when Epoch published it.
//   this year  the same construction on OpenRouter's catalogue: the cheapest
//              model at or above a score on the Artificial Analysis
//              intelligence index, by release date. These use TODAY's list
//              price for each model, not its price at release, and models
//              since withdrawn are missing, so early steps are understated.
//   going on   this dashboard archives the cheapest model at each index level
//              every day (ai-pulse-archive.json), which will join the two.
//
// The two segments use different yardsticks (benchmark scores, a composite
// index) and are not spliced. Each series reports how many times cheaper the
// level became and over how long; a yearly multiple only when it spans a year.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, YEAR = 365.25 * 864e5
const URL_EPOCH = 'https://epoch.ai/data/charts/llm-inference-price-trends/lowest_price_models_data.csv'
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 3) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const median = xs => { const v = xs.filter(fin).sort((a, b) => a - b); if (!v.length) return null; const m = (v.length - 1) / 2; return (v[Math.floor(m)] + v[Math.ceil(m)]) / 2 }

// a CSV with quoted fields → rows keyed by the header
export function parseCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/).map(line => { const c = []; let cur = '', q = false; for (const ch of line) { if (ch === '"') q = !q; else if (ch === ',' && !q) { c.push(cur); cur = '' } else cur += ch } c.push(cur); return c })
  const head = lines[0] || []
  return lines.slice(1).map(r => Object.fromEntries(head.map((k, i) => [k.trim(), r[i]])))
}

// dated prices → the running minimum as steps, and how far it fell
export function frontier(points) {
  const p = points.filter(x => x.d && fin(x.price) && x.price > 0).sort((a, b) => a.d.localeCompare(b.d) || a.price - b.price)
  const steps = []
  for (const x of p) if (!steps.length || x.price < steps.at(-1).price) steps.push({ d: x.d, price: rnd(x.price, 4), model: x.model })
  if (!steps.length) return null
  const a = steps[0], b = steps.at(-1), years = (Date.parse(b.d) - Date.parse(a.d)) / YEAR
  return { steps, first: a, last: b, times: rnd(a.price / b.price, 1), years: rnd(years, 2), months: Math.round(years * 12), perYear: years >= 1 ? rnd((a.price / b.price) ** (1 / years), 1) : null }
}

// Epoch's rows → one series per benchmark and threshold
export function epochSeries(rows) {
  const by = {}
  for (const r of rows) {
    const price = Number(r['USD per 1M Tokens']), d = r['Release Date']
    if (!fin(price) || !/^\d{4}-\d{2}-\d{2}$/.test(d || '')) continue
    const key = `${r.Benchmark}|${r['Threshold model']}`
    ;(by[key] ||= { key, benchmark: r.Benchmark, level: r['Threshold model'], range: r['Performance range'], points: [] }).points.push({ d, price, model: r['Model Name'] })
  }
  return Object.values(by).map(s => { const f = frontier(s.points); const lo = Number((s.range || '').replace(/[[\]]/g, '').split(',')[0]); return f ? { key: s.key, benchmark: s.benchmark, level: s.level, floor: fin(lo) ? lo : null, label: `${s.level}-level on ${s.benchmark}`, ...f } : null }).filter(Boolean)
}

// OpenRouter's catalogue → for each index level, the cheapest model at or above it by release date (today's prices)
export function catalogSeries(catalog, levels = [20, 30, 40, 50, 60], outputShare = 0.25) {
  const rows = (catalog || []).filter(m => !/^~|:/.test(m.id)).map(m => {
    const input = Number(m.pricing?.prompt) * 1e6, output = Number(m.pricing?.completion) * 1e6, ii = m.benchmarks?.artificial_analysis?.intelligence_index
    return m.created && fin(ii) && input > 0 && output > 0 ? { d: new Date(m.created * 1000).toISOString().slice(0, 10), price: input * (1 - outputShare) + output * outputShare, model: (m.name || m.id).replace(/^[^:]+:\s*/, ''), ii } : null
  }).filter(Boolean)
  return { models: rows.length, from: rows.map(r => r.d).sort()[0] || null, best: rows.length ? Math.max(...rows.map(r => r.ii)) : null,
    series: levels.map(level => { const f = frontier(rows.filter(r => r.ii >= level)); return f ? { key: `aa-${level}`, level, label: `Index ${level} or better`, count: rows.filter(r => r.ii >= level).length, ...f } : null }).filter(Boolean) }
}

export function createQualityPrice({ dir, UA = 'econ-dashboard', now = () => Date.now() }) {
  const FILE = path.join(dir, 'epoch-price-trends.json')
  let store = { version: 1, fetched: 0, rows: [] }
  try { if (fs.existsSync(FILE)) { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (d?.version === 1) store = d } } catch { /* fetch afresh */ }
  let cache = null, inflight = null

  async function build() {
    const errors = []
    // Epoch's file does not change often: read it at most once a week, and keep the last good copy
    if (!store.rows.length || now() - store.fetched > 7 * 24 * H) {
      try {
        const r = await fetch(URL_EPOCH, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) })
        if (!r.ok) throw new Error(`Epoch answered ${r.status}`)
        const rows = parseCsv(await r.text())
        if (rows.length < 20) throw new Error('Epoch\'s file came back short')
        store = { version: 1, fetched: now(), rows }
        try { fs.writeFileSync(FILE, JSON.stringify(store)) } catch (e) { console.error('epoch-price-trends.json save:', e.message) }
      } catch (e) { errors.push(`Epoch: ${String(e?.message || e).slice(0, 80)}`) }
    }
    let catalog = null
    try { const r = await fetch('https://openrouter.ai/api/v1/models', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`OpenRouter answered ${r.status}`); catalog = (await r.json()).data } catch (e) { errors.push(`OpenRouter: ${String(e?.message || e).slice(0, 80)}`) }
    const epoch = epochSeries(store.rows), cat = catalogSeries(catalog)
    // the dashboard's own daily record of the cheapest model at each index level
    let own = []
    try { own = (JSON.parse(fs.readFileSync(path.join(dir, 'ai-pulse-archive.json'), 'utf8')).days || []).filter(d => d.fixed).map(d => ({ d: d.d, ...d.fixed })) } catch { /* none yet */ }
    const yearly = epoch.map(s => s.perYear).filter(fin)
    return {
      built: new Date(now()).toISOString(), errors,
      epoch: { series: epoch, through: epoch.map(s => s.last.d).sort().at(-1) || null, from: epoch.map(s => s.first.d).sort()[0] || null, medianPerYear: rnd(median(yearly), 1), range: yearly.length ? [Math.min(...yearly), Math.max(...yearly)] : null, fetched: store.fetched ? new Date(store.fetched).toISOString() : null,
        url: 'https://epoch.ai/data-insights/llm-inference-price-trends', license: 'Epoch AI, CC BY 4.0' },
      catalog: cat, own: { days: own.length, from: own[0]?.d || null, latest: own.at(-1) || null },
      notes: [
        'Each line is the cheapest model at or above a fixed capability level, by the date it was released. A step down is a cheaper model arriving, not a price cut on an old one.',
        'Epoch\'s prices are per million tokens at a 3-to-1 mix of input to output, as listed at each model\'s release. The steepest falls come just after a level is first reached, when only one expensive model clears it; the long-run rate is the slower one.',
        'This year\'s lines use each model\'s price today and the Artificial Analysis intelligence index as OpenRouter publishes it. A model that has since had its price cut looks cheaper at release than it was, and withdrawn models are missing, so these understate how far prices fell.',
        'A benchmark score is not the same as useful work, and the two yardsticks are different: read each panel on its own.',
      ],
      source: 'Epoch AI, LLM inference price trends (CC BY 4.0); OpenRouter models API with Artificial Analysis index scores; this dashboard\'s daily archive',
    }
  }

  async function get() {
    if (cache && now() - cache.ts < 6 * H) return cache.out
    if (!inflight) inflight = build().then(out => { cache = { ts: now(), out }; return out }).finally(() => { inflight = null })
    return inflight
  }
  return { get }
}
