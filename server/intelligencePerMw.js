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

  async function get() {
    if (mem && Date.now() - Date.parse(mem.built) < TTL) return mem
    if (!mem) { const disk = read(CACHE); if (disk?.built && Date.now() - Date.parse(disk.built) < TTL) { mem = disk; return mem } }
    if (inflight) return inflight
    inflight = (async () => {
      try { const d = await build(); mem = d; try { fs.writeFileSync(CACHE, JSON.stringify(d)) } catch (e) { console.error('intelligence-mw save:', e.message) } return d }
      catch (e) { const disk = mem || read(CACHE); if (disk) return { ...disk, stale: e.message }; throw e }
      finally { inflight = null }
    })()
    return inflight
  }
  return { get }
}
