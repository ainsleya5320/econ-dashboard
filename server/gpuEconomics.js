// ============================================================================
// GPU UNIT ECONOMICS — what a GPU-hour costs, what it makes, by generation
//   throughput  SemiAnalysis InferenceX (open, nightly, reproducible): output
//               tokens per second per GPU for gpt-oss-120B at 1,024/1,024
//               tokens, single-turn, FP4. A generation's throughput is read
//               off its latest curve at a chosen interactivity floor (tokens
//               per second per user, P90), because throughput per GPU and
//               responsiveness trade against each other and the floor is the
//               product decision. Three floors are computed; the page toggles.
//   rentals     the AI pulse feed's live Vast.ai medians (spot) and the
//               SemiAnalysis one-year contract index (A100, H100, B200).
//   cost        data/ai/gpu-econ.json — all-in capex per accelerator, board
//               power, launch date — with PUE, electricity, hosting and
//               utilisation assumptions. Owner's cost per hour is computed at
//               3, 5 and 6-year straight-line lives; the gap between those
//               lines is the depreciation argument, drawn.
//   price       OpenRouter's price for the same model from the token tracker,
//               so revenue per GPU-hour and cost per million tokens sit on
//               one axis with what a token actually sells for.
// Cached 6h, disk-backed, stale served on error.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, TTL = 6 * H
const fin = v => v != null && Number.isFinite(v)
const r1 = v => (fin(v) ? +v.toFixed(1) : null), r2 = v => (fin(v) ? +v.toFixed(2) : null), r3 = v => (fin(v) ? +v.toFixed(3) : null)
const last = a => (a && a.length ? a[a.length - 1] : null)
const IX = 'https://inferencex.semianalysis.com/api/v1/benchmarks'

export function createGpuEconomics({ aiPulse, UA, dir }) {
  const file = n => path.join(dir, n)
  const load = n => { try { if (fs.existsSync(file(n))) return JSON.parse(fs.readFileSync(file(n), 'utf8')) } catch {} return null }
  const save = (n, o) => { try { fs.writeFileSync(file(n), JSON.stringify(o)) } catch (e) { console.error(`${n} save:`, e.message) } }
  let mem = null, inflight = null

  // ── InferenceX: latest-date curve per hardware, throughput at each floor ──
  async function throughput(model, floors) {
    const r = await fetch(`${IX}?model=${encodeURIComponent(model)}`, { headers: { 'User-Agent': UA } })
    if (!r.ok) throw new Error(`InferenceX HTTP ${r.status}`)
    const rows = await r.json()
    if (!Array.isArray(rows)) throw new Error('InferenceX: unexpected shape')
    const by = {}
    for (const x of rows) {
      if (x.isl !== 1024 || x.osl !== 1024 || x.benchmark_type !== 'single_turn') continue
      const m = x.metrics || {}
      if (!fin(m.output_tput_per_gpu)) continue
      ;(by[x.hardware] ||= []).push({ date: x.date, conc: x.conc, fw: x.framework, prec: x.precision, disagg: !!x.disagg, tps: m.output_tput_per_gpu, intvty: fin(m.p90_intvty) ? m.p90_intvty : null, run: x.run_url || null })
    }
    const out = {}
    for (const [hw, xs] of Object.entries(by)) {
      const date = xs.map(x => x.date).sort().pop()
      const latest = xs.filter(x => x.date === date)
      const best = list => list.reduce((a, b) => (b.tps > (a?.tps ?? -1) ? b : a), null)
      const pick = x => (x ? { tps: Math.round(x.tps), intvty: r1(x.intvty), conc: x.conc, framework: x.fw, precision: x.prec, run: x.run } : null)
      const byFloor = {}
      for (const f of floors) byFloor[f] = pick(best(latest.filter(x => fin(x.intvty) && x.intvty >= f)))
      out[hw] = { date, byFloor, max: pick(best(latest)), disagg: latest.every(x => x.disagg), intvtyKnown: latest.some(x => fin(x.intvty)), runs: latest.length }
    }
    return out
  }

  async function build() {
    const t0 = Date.now()
    const econ = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'ai', 'gpu-econ.json'), 'utf8'))
    const A = econ.assumptions, floors = A.interactivityFloors, lives = A.lives
    const [pulse, tput] = await Promise.all([aiPulse().catch(() => null), throughput(A.referenceModel, floors)])
    const gpu = pulse?.gpu || {}
    const vast = Object.fromEntries((gpu.vast || []).map(v => [v.gpu, v]))
    const semi = last(gpu.semi?.series || []) || {}
    const semiAsOf = gpu.semi?.asOf || semi.date || null

    // the reference model's market price, from the token tracker's last day
    const prices = load('ai-prices.json')
    const day = last(prices?.tokenHistory || [])
    const mdl = (day?.models || []).find(m => m.id === `openai/${A.referenceModel}`) || null
    const price = mdl ? { input: mdl.input, output: mdl.output, perMOutput: mdl.output + mdl.input, date: day.date, source: 'OpenRouter via the token tracker', note: 'per million output tokens, with the paired million of input at 1,024/1,024' } : null

    const kwh = A.electricityUsdPerKwh, pue = A.pue, host = A.hostingUsdPerGpuHour, util = A.utilization
    const hoursPerYear = 8760 * util
    const today = new Date()
    const chips = []
    for (const [key, g] of Object.entries(econ.gpus)) {
      const spot = g.vastKey && vast[g.vastKey] && fin(vast[g.vastKey].median) ? { v: r2(vast[g.vastKey].median), src: 'Vast.ai median', offers: vast[g.vastKey].count ?? null } : null
      const contract = g.semiKey && fin(semi[g.semiKey]) ? { v: r2(semi[g.semiKey]), src: 'SemiAnalysis 1-yr contract index', asOf: semiAsOf } : null
      const t = g.inferencexKey ? tput[g.inferencexKey] || null : null
      const power = (g.tdpW / 1000) * pue * kwh
      const capexPerHr = Object.fromEntries(lives.map(L => [L, g.capexPerGpu / (L * hoursPerYear)]))
      const cost = { power: r3(power), hosting: host, cash: r3(power + host), capexPerHr: Object.fromEntries(lives.map(L => [L, r3(capexPerHr[L])])), total: Object.fromEntries(lives.map(L => [L, r3(capexPerHr[L] + power + host)])) }
      const [ly, lm] = g.launch.split('-').map(Number)
      const ageYears = r1((today - new Date(ly, lm - 1, 1)) / (365.25 * 864e5))
      // per million output tokens, and per GPU-hour, at each floor
      const perM = {}, revenue = {}
      for (const f of floors) {
        const tp = t?.byFloor?.[f]?.tps
        if (!fin(tp) || tp <= 0) { perM[f] = null; revenue[f] = null; continue }
        const mPerHr = tp * 3600 / 1e6
        perM[f] = {
          atSpot: spot ? r3(spot.v / mPerHr) : null, atContract: contract ? r3(contract.v / mPerHr) : null,
          owner: Object.fromEntries(lives.map(L => [L, r3((capexPerHr[L] + power + host) / mPerHr)])), cash: r3((power + host) / mPerHr),
        }
        const rev = price ? mPerHr * price.perMOutput : null
        revenue[f] = fin(rev) ? { perHr: r2(rev), marginAtSpot: spot ? r2(rev - spot.v) : null, marginAtContract: contract ? r2(rev - contract.v) : null, marginOwner: Object.fromEntries(lives.map(L => [L, r2(rev - capexPerHr[L] - power - host)])) } : null
      }
      // the Chanos test: which cost lines does today's rental still clear, on the spot rate and on the contract rate
      const test = ref => (fin(ref) ? { rate: ref, cash: ref > power + host, life3: ref > capexPerHr[3] + power + host, life5: ref > (capexPerHr[5] ?? capexPerHr[6]) + power + host, life6: ref > capexPerHr[6] + power + host } : null)
      const clears = test(spot?.v ?? null), clearsContract = test(contract?.v ?? null)
      chips.push({ key, name: g.name, vendor: g.vendor, launch: g.launch, ageYears, capex: g.capexPerGpu, tdpW: g.tdpW, memory: g.memory, note: g.note || null,
        rental: { spot, contract }, throughput: t ? { date: t.date, byFloor: t.byFloor, max: t.max, disagg: t.disagg, intvtyKnown: t.intvtyKnown, runs: t.runs } : null,
        cost, perM, revenue, clears, clearsContract })
    }

    return {
      ts: Date.now(), built: new Date().toISOString(), buildSecs: Math.round((Date.now() - t0) / 1000), ttlHours: TTL / H,
      reviewed: econ.reviewed, assumptions: A, floors, lives, price, chips,
      h100Spot: gpu.h100SpotUsed ?? null, h100Source: gpu.h100Source || null,
      semiSeries: (gpu.semi?.series || []).slice(-60),
      source: `SemiAnalysis InferenceX (${A.referenceModel}, 1,024/1,024 tokens, single-turn, output tokens per second per GPU at a P90 interactivity floor; latest run per hardware); Vast.ai spot medians and the SemiAnalysis one-year contract index via the AI pulse feed; OpenRouter price of the same model via the token tracker; cost assumptions from data/ai/gpu-econ.json (reviewed ${econ.reviewed}).`,
    }
  }

  async function get() {
    if (mem && Date.now() - mem.ts < TTL) return mem
    if (!mem) { const disk = load('gpu-economics.json'); if (disk && Date.now() - disk.ts < TTL) { mem = disk; return mem } }
    if (inflight) return inflight
    inflight = (async () => {
      try { const d = await build(); if (d.chips.filter(c => c.throughput).length < 4) throw new Error('InferenceX coverage too thin'); mem = d; save('gpu-economics.json', d); return d }
      catch (e) { console.warn('gpu economics build:', e.message); const disk = mem || load('gpu-economics.json'); if (disk) return disk; throw e }
      finally { inflight = null }
    })()
    return inflight
  }

  return { get }
}
