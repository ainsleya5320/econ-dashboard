// ============================================================================
// INTELLIGENCE PER MEGAWATT: AI Economy → Compute. How much model capability
// a megawatt of data-centre power delivers:
//   index = Artificial Analysis Intelligence Index of the model
//           × output tokens per second per megawatt of provisioned power
// taken at each chip's best operating point that still gives every user at
// least 50 tokens a second (P90), counting only frontier-class models (at
// least 75% of the best score benchmarked by then, so a small model cannot win
// on volume alone). Power is what a data centre provisions:
// board power × system factor (server or rack around the GPU) × PUE.
//   throughput  SemiAnalysis InferenceX, every run of each mapped model on each
//               chip, in two workloads: replayed agentic traces (the newest
//               models, rack-scale systems included) and 1k-in/1k-out chat
//               (history from December 2025, no rack-scale points)
//   scores      Artificial Analysis through the AI pulse cache (aa-models.json),
//               with the config's snapshot when the cache is missing
//   power       board power and PUE from data/ai/gpu-econ.json; systems that
//               table lacks, the system factors and the model map from
//               data/ai/intelligence-mw.json
// History: the best throughput each model-chip pair had demonstrated by each
// month-end, so the index moves when a better model, a newer chip or faster
// software arrives. Measured GPU power, where InferenceX logs it, is reported
// next to the rating as a check.
// Route: /api/intelligence-mw (12h cache, disk-backed, stale served on error)
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const TTL = 12 * 3600e3
const IX = 'https://inferencex.semianalysis.com/api/v1/benchmarks'
const fin = v => v != null && Number.isFinite(v)
const r0 = v => (fin(v) ? Math.round(v) : null), r1 = v => (fin(v) ? Math.round(v * 10) / 10 : null), r3 = v => (fin(v) ? Math.round(v * 1000) / 1000 : null)
const GROUPS = ['Hopper', 'Blackwell', 'Rubin', 'AMD']
const monthEnd = ym => { const [y, m] = ym.split('-').map(Number); return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }
const months = (a, b) => { const out = []; let [y, m] = a.split('-').map(Number); const [by, bm] = b.split('-').map(Number); while (y < by || (y === by && m <= bm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m === 12 ? (y++, m = 1) : m++ } return out }

// ── the Pulse gauge ─────────────────────────────────────────────────────────
// The frontier index's change over the last three months, scored like the
// Pulse's token-demand gauge: flat = 50, doubling = 75, quadrupling = 100,
// halving = 25; green from 60, red under 40. A workload is scored only once it
// has a full three-month window (four monthly points), agentic traces first,
// because a new series' first month has few runs and its early jump is partly
// benchmarks arriving. A series still too new to score is reported in the
// text; if neither has a full window, the longer one is scored and says it is
// measured since the series began, with its run counts.
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const mon = ym => `${MON[+ym.slice(5, 7) - 1]} ${ym.slice(0, 4)}`
const kfmt = v => (v >= 1e6 ? `${(v / 1e6).toFixed(2)} million` : `${Math.round(v / 1e3).toLocaleString('en-US')} thousand`)
const FULL = 4
export function pulseGauge(workloads) {
  const series = k => { const W = workloads?.[k], h = (W?.history || []).filter(x => fin(x.all)); return W && fin(W.base?.value) && h.length >= 2 ? h : null }
  const KEYS = ['agentic', 'chat'].filter(series)
  if (!KEYS.length) return null
  const key = KEYS.find(k => series(k).length >= FULL) || [...KEYS].sort((a, b) => series(b).length - series(a).length)[0]
  const W = workloads[key], h = series(key), full = h.length >= FULL
  const last = h[h.length - 1], first = h[Math.max(0, h.length - FULL)]
  const g = last.all / first.all - 1
  const score = Math.round(Math.min(100, Math.max(0, 50 + 25 * Math.log2(Math.max(0.05, 1 + g)))))
  // the same rounding as the Compute panel, so both show the same index
  const level = (wl, v) => Math.round(Math.round((v / workloads[wl].base.value) * 1000) / 10)
  const pct = x => `${x >= 0 ? '+' : '−'}${Math.round(Math.abs(x) * 100)}%`
  const lead = last.lead
  // the other workload, when it exists but is too new to score
  const young = KEYS.filter(k => k !== key && series(k).length < FULL).map(k => {
    const s = series(k), a = s[0], b = s[s.length - 1]
    return ` The ${workloads[k].label.toLowerCase()} series is too new to score (since ${mon(a.m)}, ${a.n} frontier-class run${a.n === 1 ? '' : 's'} then and ${b.n} now): its index went from ${level(k, a.all)} to ${level(k, b.all)} (${pct(b.all / a.all - 1)}), led by ${b.lead?.model || '—'} on ${b.lead?.chip || '—'}.`
  }).join('')
  return {
    score, tone: score >= 60 ? 'green' : score >= 40 ? 'amber' : 'red',
    label: (score >= 60 ? 'Intelligence per megawatt rising' : score >= 40 ? 'Intelligence per megawatt steady' : 'Intelligence per megawatt slipping') + (full ? '' : ` (since ${MON[+first.m.slice(5, 7) - 1]})`),
    why: `${W.label}: the frontier index went from ${level(key, first.all)} to ${level(key, last.all)} between ${mon(first.m)} and ${mon(last.m)} to date (${pct(g)})`
      + (full ? '' : `, measured since the series began (${first.n} frontier-class run${first.n === 1 ? '' : 's'} then, ${last.n} now)`)
      + (lead ? `; ${lead.model} on ${lead.chip} serves ${kfmt(lead.tpsPerMw)} tokens a second per megawatt at an intelligence score of ${lead.idx}.` : '.')
      + young + ' Flat scores 50, a doubling 75, a quadrupling 100.',
    workload: key, workloadLabel: W.label, full, from: first.m, to: last.m, change: r3(g), index: level(key, last.all), base: W.base.m,
  }
}

export function createIntelligencePerMw({ UA, dir }) {
  const CACHE = path.join(dir, 'intelligence-mw-cache.json')
  const read = p => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
  let mem = null, inflight = null

  async function build() {
    const cfg = read(path.join(dir, 'data', 'ai', 'intelligence-mw.json')), econ = read(path.join(dir, 'data', 'ai', 'gpu-econ.json'))
    if (!cfg || !econ) throw new Error('data/ai/intelligence-mw.json or gpu-econ.json is missing')
    const A = cfg.assumptions, pue = econ.assumptions.pue, floor = A.floor
    const aa = new Map((read(path.join(dir, 'aa-models.json'))?.data || []).map(m => [m.slug, m]))

    // provisioned watts per GPU
    const chips = {}
    for (const [k, c] of Object.entries(cfg.chips)) {
      const g = Object.values(econ.gpus).find(x => x.inferencexKey === k)
      const tdpW = c.tdpW ?? g?.tdpW, factor = A.systemFactor[c.system]
      if (!fin(tdpW) || !fin(factor)) continue
      chips[k] = { key: k, name: c.name || g?.name || k, family: c.family, system: c.system, tdpW, confidence: c.confidence || 'spec', facilityW: tdpW * factor * pue }
    }
    const models = cfg.models.map(m => {
      const a = aa.get(m.aa)
      return { ...m, idx: fin(a?.idx) ? a.idx : m.aaSnapshot, idxSource: fin(a?.idx) ? 'live' : 'snapshot', release: a?.release || null }
    })

    // every operating point at or above the per-user floor, per workload
    const runs = [], errors = []
    const pull = async m => {
      try {
        const r = await fetch(`${IX}?model=${encodeURIComponent(m.ix)}`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(120_000) })
        if (!r.ok) throw new Error(`InferenceX HTTP ${r.status}`)
        const rows = await r.json()
        if (!Array.isArray(rows)) throw new Error('InferenceX: unexpected shape')
        for (const x of rows) {
          const met = x.metrics || {}
          if (!chips[x.hardware] || !fin(met.output_tput_per_gpu) || !fin(met.p90_intvty) || met.p90_intvty < floor) continue
          const wl = x.benchmark_type === 'agentic_traces' ? 'agentic'
            : x.benchmark_type === 'single_turn' && x.isl === A.workloads.chat.isl && x.osl === A.workloads.chat.osl ? 'chat' : null
          if (!wl || !x.date) continue
          runs.push({ wl, m: m.ix, hw: x.hardware, date: x.date.slice(0, 10), tps: met.output_tput_per_gpu, intvty: met.p90_intvty, conc: x.conc,
            w: met.power_valid !== false && fin(met.avg_power_w) && met.avg_power_w > 0 ? met.avg_power_w : null, disagg: !!x.disagg })
        }
      } catch (e) { errors.push(`${m.name}: ${e.message}`) }
    }
    for (let i = 0; i < models.length; i += 3) await Promise.all(models.slice(i, i + 3).map(pull))
    if (!runs.length) throw new Error(`no InferenceX runs (${errors.join('; ')})`)

    const byIx = new Map(models.map(m => [m.ix, m]))
    const score = r => { const m = byIx.get(r.m), c = chips[r.hw], perMw = r.tps / (c.facilityW / 1e6); return { perMw, ipmw: m.idx * perMw } }
    const out = {}
    for (const wl of Object.keys(A.workloads)) {
      const R = runs.filter(r => r.wl === wl)
      if (!R.length) continue
      // best demonstrated throughput per model-chip pair, as of a date
      const bestAsOf = end => {
        const best = new Map()
        for (const r of R) if (r.date <= end) { const k = `${r.m}|${r.hw}`; const b = best.get(k); if (!b || r.tps > b.tps) best.set(k, r) }
        return [...best.values()]
      }
      // frontier class: within the band of the best score benchmarked so far
      const bar = pts => { const top = Math.max(...pts.map(r => byIx.get(r.m).idx)); return { top, min: top * A.frontierBand } }
      const today = new Date().toISOString().slice(0, 10)
      const now = bestAsOf(today), nowBar = bar(now)
      const combos = now.map(r => {
        const m = byIx.get(r.m), c = chips[r.hw], s = score(r)
        return {
          model: m.name, ix: m.ix, maker: m.maker, idx: m.idx, idxSource: m.idxSource, chip: c.name, hw: r.hw, family: c.family, ratedW: c.tdpW, powerConfidence: c.confidence,
          facilityKw: r3(c.facilityW / 1000), date: r.date, tps: r0(r.tps), intvty: r1(r.intvty), conc: r.conc, disagg: r.disagg,
          measuredW: r0(r.w), tpsPerMw: r0(s.perMw), ipmw: r0(s.ipmw), frontierClass: m.idx >= nowBar.min,
        }
      }).sort((a, b) => (b.frontierClass - a.frontierClass) || b.ipmw - a.ipmw)

      const first = R.map(r => r.date).sort()[0].slice(0, 7)
      const history = months(first, today.slice(0, 7)).map(ym => {
        const asOf = bestAsOf(monthEnd(ym)), b = asOf.length ? bar(asOf) : null
        const pts = b ? asOf.filter(r => byIx.get(r.m).idx >= b.min).map(r => ({ r, ...score(r) })) : []
        const top = list => list.reduce((a, x) => (x.ipmw > (a?.ipmw ?? -1) ? x : a), null)
        const lead = top(pts)
        const row = { m: ym, all: lead ? r0(lead.ipmw) : null, lead: lead ? { model: byIx.get(lead.r.m).name, chip: chips[lead.r.hw].name, idx: byIx.get(lead.r.m).idx, tpsPerMw: r0(lead.perMw) } : null, bar: b ? r1(b.min) : null, top: b ? b.top : null, n: pts.length }
        for (const g of GROUPS) { const t = top(pts.filter(p => chips[p.r.hw].family === g)); row[g] = t ? r0(t.ipmw) : null }
        return row
      })
      const base = history.find(h => fin(h.all))
      out[wl] = { label: A.workloads[wl].label, note: A.workloads[wl].note, combos, history, base: base ? { m: base.m, value: base.all } : null, runs: R.length, bar: { top: nowBar.top, min: r1(nowBar.min) } }
    }

    return {
      built: new Date().toISOString(), reviewed: cfg.reviewed, floor, floorNote: A.floorNote, band: A.frontierBand, bandNote: A.frontierBandNote, pue, systemFactor: A.systemFactor, systemFactorNote: A.systemFactorNote,
      chips: Object.values(chips).map(c => ({ ...c, facilityW: r0(c.facilityW) })), models: models.map(m => ({ name: m.name, maker: m.maker, idx: m.idx, idxSource: m.idxSource, ix: m.ix })),
      modelsNote: cfg.modelsNote, workloads: out, errors,
      sources: { throughput: 'SemiAnalysis InferenceX (inferencex.semianalysis.com)', scores: 'Artificial Analysis Intelligence Index', power: 'vendor board power; system factor and PUE are assumptions (data/ai)' },
    }
  }

  // the gauge is derived from the cached workloads on every read, so an older
  // cache file gets it too
  const withGauge = d => ({ ...d, gauge: pulseGauge(d.workloads) })
  async function get() {
    if (mem && Date.now() - Date.parse(mem.built) < TTL) return withGauge(mem)
    if (!mem) { const disk = read(CACHE); if (disk?.built && Date.now() - Date.parse(disk.built) < TTL) { mem = disk; return withGauge(mem) } }
    if (inflight) return inflight.then(withGauge)
    inflight = (async () => {
      try { const d = await build(); mem = d; try { fs.writeFileSync(CACHE, JSON.stringify(d)) } catch (e) { console.error('intelligence-mw save:', e.message) } return d }
      catch (e) { const disk = mem || read(CACHE); if (disk) return { ...disk, stale: e.message }; throw e }
      finally { inflight = null }
    })()
    return inflight.then(withGauge)
  }
  return { get }
}
