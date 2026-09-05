// ============================================================================
// AI PULSE — the AI Economy landing feed, built around a ROBUST token tracker
//   tokens   OpenRouter rankings history (the app's own daily archive of the
//            7-day token totals per model): total flow, growth over 1/4/13
//            weeks, share and growth by lab, top models and movers, the
//            prompt/completion/reasoning/cached mix, open- vs closed-weight
//            share, concentration, freshness
//   aa       Artificial Analysis (free API, key in .env): intelligence index,
//            blended price, speed and latency for ~600 models → the price/
//            intelligence frontier, cost per intelligence point, the price of
//            frontier intelligence, creator leaders; a daily archive so the
//            frontier's price gets a history from today
//   gpu      GPU rental rates: Vast.ai live marketplace (median / min / p25 per
//            GPU, no key), RunPod's published headline rates, Ornn's daily
//            rental index (already tracked), SemiAnalysis's 1-year H100 contract
//            index; archived daily; a bridge from $/GPU-hour to $/M tokens
//   scores   demand (token growth + breadth), efficiency (token price
//            trend), compute cost (rental trend) — 0–100, with verdicts
// Cached 1h (Artificial Analysis 12h), disk-backed; complete builds only.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 60 * 60 * 1000, TTL = 1 * H, AA_TTL = 12 * H
const fin = v => v != null && Number.isFinite(v)
const last = a => (a && a.length ? a[a.length - 1] : null)
const r1 = v => (fin(v) ? +v.toFixed(1) : null), r2 = v => (fin(v) ? +v.toFixed(2) : null), r3 = v => (fin(v) ? +v.toFixed(3) : null)
const mean = xs => { const v = (xs || []).filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const median = xs => { const v = (xs || []).filter(fin).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null }
const chg = (a, b) => (fin(a) && fin(b) && b !== 0 ? ((a / b) - 1) * 100 : null)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const OPEN_LABS = new Set(['deepseek', 'qwen', 'z-ai', 'meta-llama', 'mistralai', 'moonshotai', 'minimax', 'nvidia', 'tencent', 'xiaomi', 'microsoft', 'nousresearch', 'allenai', 'baidu', 'bytedance', 'stepfun', 'inclusionai', 'arcee-ai', 'thedrummer', 'sao10k', 'gryphe', 'cognitivecomputations', 'liquid'])
const CLOSED_LABS = new Set(['anthropic', 'openai', 'google', 'x-ai', 'amazon', 'cohere', 'perplexity', 'ai21', 'inflection', 'openrouter'])
const VAST_GPUS = ['H100 SXM', 'H200', 'B200', 'A100 SXM4', 'RTX 5090', 'RTX 4090', 'L40S']

export function createAiPulse({ getRankingsWithHistory, fetchOrnn, getSemiH100, AA_KEY, UA, dir }) {
  const file = n => path.join(dir, n)
  const load = n => { try { if (fs.existsSync(file(n))) return JSON.parse(fs.readFileSync(file(n), 'utf8')) } catch {} return null }
  const save = (n, o) => { try { fs.writeFileSync(file(n), JSON.stringify(o)) } catch (e) { console.error(`${n} save:`, e.message) } }
  let mem = null, inflight = null, aaMem = null

  // ── Artificial Analysis models (12h cache; the free tier is 1,000 requests/day) ──
  async function aaModels() {
    if (!AA_KEY) return null
    if (aaMem && Date.now() - aaMem.ts < AA_TTL) return aaMem.data
    const disk = load('aa-models.json')
    if (disk && Date.now() - disk.ts < AA_TTL) { aaMem = disk; return disk.data }
    try {
      const r = await fetch('https://artificialanalysis.ai/api/v2/data/llms/models', { headers: { 'x-api-key': AA_KEY, 'User-Agent': UA } })
      if (!r.ok) throw new Error(`Artificial Analysis HTTP ${r.status}`)
      const j = await r.json()
      const data = (j.data || []).map(m => ({
        id: m.id, name: m.name, slug: m.slug, creator: m.model_creator?.name || null, creatorSlug: m.model_creator?.slug || null, release: m.release_date || null,
        idx: m.evaluations?.artificial_analysis_intelligence_index ?? null, coding: m.evaluations?.artificial_analysis_coding_index ?? null,
        price: m.pricing?.price_1m_blended_3_to_1 ?? null, priceIn: m.pricing?.price_1m_input_tokens ?? null, priceOut: m.pricing?.price_1m_output_tokens ?? null,
        tps: m.median_output_tokens_per_second > 0 ? m.median_output_tokens_per_second : null, ttft: m.median_time_to_first_token_seconds > 0 ? m.median_time_to_first_token_seconds : null,
      }))
      if (data.length < 50) throw new Error(`only ${data.length} models`)
      aaMem = { data, ts: Date.now() }; save('aa-models.json', aaMem)
      return data
    } catch (e) { console.warn('Artificial Analysis:', e.message); return disk?.data || null }
  }

  // ── Vast.ai marketplace: per-GPU on-demand asks (the same query the site runs) ──
  async function vast(gpu) {
    const q = encodeURIComponent(JSON.stringify({ gpu_name: { eq: gpu }, rentable: { eq: true }, type: 'on-demand' }))
    const r = await fetch(`https://console.vast.ai/api/v0/bundles/?q=${q}`, { headers: { 'User-Agent': UA } })
    if (!r.ok) throw new Error(`Vast ${gpu}: HTTP ${r.status}`)
    const offers = (await r.json()).offers || []
    const per = offers.map(o => o.dph_total / Math.max(1, o.num_gpus || 1)).filter(v => fin(v) && v > 0).sort((a, b) => a - b)
    if (!per.length) return { gpu, n: 0 }
    return { gpu, n: per.length, median: r2(median(per)), min: r2(per[0]), p25: r2(per[Math.floor(per.length / 4)]), verified: offers.filter(o => o.verified).length }
  }
  async function runpod() {
    const r = await fetch('https://www.runpod.io/pricing', { headers: { 'User-Agent': UA } })
    if (!r.ok) throw new Error(`RunPod HTTP ${r.status}`)
    const t = (await r.text()).replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ')
    const out = {}
    for (const m of t.matchAll(/([A-Z][A-Za-z0-9 ]{2,24}?) from \$(\d+\.\d+)\/hr/g)) out[m[1].replace(/^Rent /, '').trim()] = +m[2]
    return out
  }

  async function build() {
    const [or, ornn, semi, aa] = await Promise.all([getRankingsWithHistory().catch(() => null), fetchOrnn().catch(() => null), getSemiH100().catch(() => null), aaModels()])
    const rows = or?.rows || []
    if (rows.length < 100) throw new Error('OpenRouter history unavailable')

    // ── tokens ──
    // Two samples from OpenRouter: (1) the weekly market-share series by lab
    // (complete weeks only — the trend, share and growth math), (2) the
    // per-model 7-day rankings rows this dashboard archives daily — only days
    // with a complete snapshot count (sparse days are partial captures).
    const byDate = new Map(), byDateModel = new Map()
    for (const r of rows) {
      const tok = (r.total_prompt_tokens || 0) + (r.total_completion_tokens || 0)
      const lab = String(r.model_permaslug || '').split('/')[0]
      const a = byDate.get(r.date) || { total: 0, prompt: 0, completion: 0, reasoning: 0, cached: 0, requests: 0, tools: 0, models: 0 }
      a.total += tok; a.prompt += r.total_prompt_tokens || 0; a.completion += r.total_completion_tokens || 0; a.reasoning += r.total_native_tokens_reasoning || 0; a.cached += r.total_native_tokens_cached || 0; a.requests += r.count || 0; a.tools += r.total_tool_calls || 0; a.models += 1
      byDate.set(r.date, a)
      const m = byDateModel.get(r.date) || new Map(); const slug = r.model_permaslug; const cur = m.get(slug) || { slug, lab, tok: 0, completion: 0, reasoning: 0, requests: 0 }
      cur.tok += tok; cur.completion += r.total_completion_tokens || 0; cur.reasoning += r.total_native_tokens_reasoning || 0; cur.requests += r.count || 0; m.set(slug, cur); byDateModel.set(r.date, m)
    }
    const allDates = [...byDate.keys()].sort()
    const maxModels = Math.max(...allDates.map(d => byDate.get(d).models))
    const full = allDates.filter(d => byDate.get(d).models >= 0.6 * maxModels)
    if (!full.length) throw new Error('no complete OpenRouter snapshot')
    const latest = last(full)
    const L = byDate.get(latest)
    // reference snapshot for model movers: nearest full snapshot to 28 days back (±14d), else the oldest full snapshot at least 7 days back
    const daysBetween = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5)
    let ref = null
    for (const d of full) { const off = Math.abs(daysBetween(latest, d) - 28); if (off <= 14 && (ref == null || off < Math.abs(daysBetween(latest, ref) - 28))) ref = d }
    if (!ref) ref = full.find(d => daysBetween(latest, d) >= 7) || null
    const modelsNow = [...byDateModel.get(latest).values()].sort((a, b) => b.tok - a.tok)
    const modelsRef = ref ? byDateModel.get(ref) : null
    const topModels = modelsNow.slice(0, 30).map(m => ({ slug: m.slug, name: m.slug.split('/').slice(1).join('/'), lab: m.lab, tokens: m.tok, share: r1((m.tok / L.total) * 100), chg: r1(chg(m.tok, modelsRef?.get(m.slug)?.tok)), completionShare: r1(m.tok ? (m.completion / m.tok) * 100 : null), requests: m.requests }))
    const pool = new Map(); for (const m of modelsNow.slice(0, 80)) pool.set(m.slug, m)
    for (const m of (modelsRef ? [...modelsRef.values()].sort((a, b) => b.tok - a.tok).slice(0, 80) : [])) if (!pool.has(m.slug)) pool.set(m.slug, { ...m, tok: byDateModel.get(latest).get(m.slug)?.tok || 0 })
    const deltas = modelsRef ? [...pool.values()].map(m => ({ slug: m.slug, name: m.slug.split('/').slice(1).join('/'), lab: m.lab, tokens: m.tok, delta: m.tok - (modelsRef.get(m.slug)?.tok || 0), chg: r1(chg(m.tok, modelsRef.get(m.slug)?.tok)) })) : []
    const movers = { span: ref ? daysBetween(latest, ref) : null, ref, up: [...deltas].sort((a, b) => b.delta - a.delta).slice(0, 6), down: [...deltas].sort((a, b) => a.delta - b.delta).slice(0, 6) }
    const modelsByLab = {}; for (const m of modelsNow) modelsByLab[m.lab] = (modelsByLab[m.lab] || 0) + 1
    // weekly by lab — complete weeks only (a week starting x is complete once x + 7d has passed)
    const wk = (or?.marketShare || []).filter(p => Date.parse(p.x) + 7 * 864e5 <= Date.now()).map(p => ({ d: p.x, ys: p.ys || {}, total: Object.values(p.ys || {}).reduce((s, v) => s + (v || 0), 0) }))
    if (wk.length < 8) throw new Error('OpenRouter weekly series too short')
    const W = last(wk), ago = n => wk[wk.length - 1 - n] || null
    const g = n => r1(chg(W.total, ago(n)?.total))
    const labTok = (p, lab) => p?.ys?.[lab] ?? null
    const labs = Object.entries(W.ys).filter(([lab]) => lab !== 'others').sort((a, b) => b[1] - a[1]).slice(0, 14).map(([lab, tokens]) => ({
      lab, tokens, share: r1((tokens / W.total) * 100), chg4w: r1(chg(tokens, labTok(ago(4), lab))), chg13w: r1(chg(tokens, labTok(ago(13), lab))),
      models: modelsByLab[lab] || null, weights: OPEN_LABS.has(lab) ? 'open' : CLOSED_LABS.has(lab) ? 'closed' : 'unknown',
      spark: wk.slice(-26).map(p => p.ys?.[lab] ?? null),
    }))
    const top10Labs = labs.slice(0, 10).filter(l => fin(l.chg4w))
    const breadth = top10Labs.length ? (top10Labs.filter(l => l.chg4w > 0).length / top10Labs.length) * 100 : null
    const sumLabs = pred => Object.entries(W.ys).filter(([l]) => pred(l)).reduce((s, [, v]) => s + (v || 0), 0)
    const weekly = wk.slice(-52).map(p => ({ d: p.d, total: p.total, ...p.ys }))
    const tokens = {
      week: { d: W.d, total: W.total, weeks: wk.length, since: wk[0].d },
      growth: { w1: g(1), w4: g(4), w13: g(13), w26: g(26), w52: r1(chg(W.total, (ago(52) || wk[0]).total)), w52Since: (ago(52) || wk[0]).d },
      snapshot: { d: latest, daysOld: Math.round((Date.now() - Date.parse(latest)) / 864e5), models: L.models, total: L.total, requests: L.requests, fullDays: full.length, firstFull: full[0] },
      mix: { completionShare: r1((L.completion / L.total) * 100), reasoningShare: L.reasoning ? r1((L.reasoning / L.completion) * 100) : null, cachedShare: L.cached ? r1((L.cached / L.prompt) * 100) : null, toolCallsPerK: L.tools ? r1((L.tools / L.requests) * 1000) : null, tokensPerRequest: Math.round(L.requests ? L.total / L.requests : 0) },
      shares: { open: r1((sumLabs(l => OPEN_LABS.has(l)) / W.total) * 100), closed: r1((sumLabs(l => CLOSED_LABS.has(l)) / W.total) * 100), top5Models: r1((modelsNow.slice(0, 5).reduce((s, m) => s + m.tok, 0) / L.total) * 100), top3Labs: r1((labs.slice(0, 3).reduce((s, l) => s + l.tokens, 0) / W.total) * 100) },
      labs, topModels, movers, breadth: r1(breadth), weekly, weeklyLabs: Object.keys(W.ys),
      source: 'OpenRouter weekly tokens by lab (complete weeks) and the per-model 7-day rankings this dashboard archives daily (complete snapshots only)',
    }

    // ── Artificial Analysis ──
    let aaOut = null
    if (aa) {
      const valid = aa.filter(m => fin(m.idx) && fin(m.price) && m.price > 0)
      const byPrice = [...valid].sort((a, b) => a.price - b.price || b.idx - a.idx)
      let best = -Infinity; const pareto = []
      for (const m of byPrice) if (m.idx > best) { best = m.idx; pareto.push(m) }
      const topIdx = [...valid].sort((a, b) => b.idx - a.idx)
      const top10 = topIdx.slice(0, 10)
      const bestM = topIdx[0]
      const frontier = valid.filter(m => m.idx >= bestM.idx - 5).sort((a, b) => a.price - b.price)[0]
      const cheapestAtLeast = frac => valid.filter(m => m.idx >= bestM.idx * frac).sort((a, b) => a.price - b.price)[0] || null
      const fastest = topIdx.slice(0, 25).filter(m => fin(m.tps)).sort((a, b) => b.tps - a.tps)[0] || null
      const cutoff = new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10)
      const creators = {}
      for (const m of valid) { const c = m.creator || 'unknown'; if (!creators[c] || m.idx > creators[c].idx) creators[c] = { creator: c, model: m.name, idx: m.idx, price: m.price } }
      const brief = m => ({ name: m.name, creator: m.creator, idx: m.idx, coding: m.coding, price: m.price, priceIn: m.priceIn, priceOut: m.priceOut, tps: m.tps, ttft: m.ttft, release: m.release })
      aaOut = {
        n: valid.length, best: brief(bestM), frontier: frontier ? brief(frontier) : null, fastest: fastest ? brief(fastest) : null,
        tiers: [0.9, 0.8, 0.6].map(f => ({ frac: f, min: r1(bestM.idx * f), model: cheapestAtLeast(f) ? brief(cheapestAtLeast(f)) : null })),
        top10: top10.map(brief), top10MedianPrice: r2(median(top10.map(m => m.price))), top10CostPerPoint: r3(median(top10.map(m => m.price / m.idx))),
        pareto: pareto.map(brief), releases90d: valid.filter(m => m.release && m.release >= cutoff).length,
        creators: Object.values(creators).sort((a, b) => b.idx - a.idx).slice(0, 12),
        scatter: valid.filter(m => m.price >= 0.02 && m.price <= 200).map(m => ({ name: m.name, creator: m.creator, idx: m.idx, price: m.price, tps: m.tps, pareto: pareto.includes(m) })),
        table: topIdx.slice(0, 80).map(brief),
        source: 'Artificial Analysis (free API): Intelligence Index, blended price per 1M tokens (3:1 input:output), median output speed and time to first token',
      }
      const store = load('ai-pulse-archive.json') || { days: [] }
      const today = new Date().toISOString().slice(0, 10)
      const row = { d: today, bestIdx: bestM.idx, bestName: bestM.name, frontierPrice: frontier?.price ?? null, top10MedianPrice: aaOut.top10MedianPrice, top10CostPerPoint: aaOut.top10CostPerPoint, cheapest80: aaOut.tiers[1]?.model?.price ?? null, n: valid.length }
      const i = store.days.findIndex(x => x.d === today); if (i >= 0) store.days[i] = row; else store.days.push(row)
      save('ai-pulse-archive.json', store); aaOut.history = store.days
    }

    // ── GPU rentals ──
    const vastRows = []
    for (const g of VAST_GPUS) { try { vastRows.push(await vast(g)) } catch (e) { console.warn(e.message); vastRows.push({ gpu: g, n: 0, error: e.message }) } await new Promise(r => setTimeout(r, 300)) }
    const rp = await runpod().catch(e => { console.warn('RunPod:', e.message); return null })
    const gl = ornn?.gpuLatest || {}
    const gpuStore = load('gpu-rentals.json') || { days: [] }
    const today = new Date().toISOString().slice(0, 10)
    const snap = { d: today, vast: Object.fromEntries(vastRows.filter(v => fin(v.median)).map(v => [v.gpu, v.median])), runpod: rp || {} }
    const gi = gpuStore.days.findIndex(x => x.d === today); if (gi >= 0) gpuStore.days[gi] = snap; else gpuStore.days.push(snap)
    save('gpu-rentals.json', gpuStore)
    const h100Vast = vastRows.find(v => v.gpu === 'H100 SXM')?.median ?? null
    const h100 = h100Vast ?? gl.h100?.current ?? null
    const semiSeries = (semi?.series || []).filter(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date))
    const semiNow = fin(semi?.latest?.h100) ? semi.latest.h100 : last(semiSeries)?.h100 ?? null
    const semiAsOf = /^\d{4}-\d{2}-\d{2}$/.test(semi?.latest?.date || '') ? semi.latest.date : null
    const costPerM = tps => (fin(h100) && tps ? (h100 / 3600) * 1e6 / tps : null)
    const otpi = ornn?.otpiLatest || {}
    const otpiVals = Object.values(otpi).map(x => x?.current).filter(fin)
    const otpiChg = mean(Object.values(otpi).map(x => x?.chg30))
    const gpu = {
      vast: vastRows, runpod: rp, ornn: { latest: gl, rows: (ornn?.gpuRows || []).slice(-120) }, semi: { h100Contract: semiNow, asOf: semiAsOf, series: semiSeries.filter((_, i) => i % 5 === 0).slice(-120) },
      h100SpotUsed: h100, h100Source: h100Vast != null ? 'Vast.ai median' : 'Ornn index',
      bridge: { costPerM1000: r3(costPerM(1000)), costPerM400: r3(costPerM(400)), otpiAvg: r3(mean(otpiVals)), otpiByLab: Object.fromEntries(Object.entries(otpi).map(([k, v]) => [k, v?.current ?? null])), ratio1000: fin(costPerM(1000)) && fin(mean(otpiVals)) ? r1(mean(otpiVals) / costPerM(1000)) : null, breakevenTps: fin(h100) && fin(mean(otpiVals)) && mean(otpiVals) > 0 ? Math.round((h100 / 3600) * 1e6 / mean(otpiVals)) : null },
      history: gpuStore.days.slice(-180), source: 'Vast.ai public marketplace (on-demand asks per GPU), RunPod published rates, Ornn daily rental index, SemiAnalysis 1-year H100 contract index',
    }

    // ── scores ──
    const g13 = tokens.growth.w13, g4 = tokens.growth.w4
    const gScore = fin(g13) ? clamp(50 + 25 * Math.log2(Math.max(0.05, 1 + g13 / 100)), 0, 100) : null // 0% → 50, +100% → 75, +300% → 100, −50% → 25
    const demandScore = Math.round(mean([gScore, fin(breadth) ? breadth : null]) ?? 50)
    const effScore = Math.round(fin(otpiChg) ? clamp((-otpiChg + 10) / 40 * 100, 0, 100) : 50)
    const h100Chg = gl.h100?.chg30 ?? null
    const computeScore = Math.round(fin(h100Chg) ? clamp((-h100Chg + 20) / 40 * 100, 0, 100) : 50)
    const tone = s => (s >= 60 ? 'green' : s >= 40 ? 'amber' : 'red')
    const scores = {
      demand: { score: demandScore, tone: tone(demandScore), label: demandScore >= 60 ? 'Token demand accelerating' : demandScore >= 40 ? 'Token demand steady' : 'Token demand stalling', why: `OpenRouter weekly tokens ${fin(g13) ? `${g13 >= 0 ? '+' : ''}${g13.toFixed(0)}% over 13 weeks` : 'n/a'}${fin(g4) ? `, ${g4 >= 0 ? '+' : ''}${g4.toFixed(0)}% over 4` : ''}${fin(tokens.growth.w1) ? `, ${tokens.growth.w1 >= 0 ? '+' : ''}${tokens.growth.w1.toFixed(0)}% last week` : ''} (week of ${W.d}, ${(W.total / 1e12).toFixed(0)}T)${fin(breadth) ? `; ${Math.round(breadth)}% of the top-10 labs grew over four weeks` : ''}. Open-weight labs carry ${tokens.shares.open}% of the flow.` },
      efficiency: { score: effScore, tone: tone(effScore), label: effScore >= 60 ? 'Token prices falling fast' : effScore >= 40 ? 'Token prices drifting lower' : 'Token prices firming', why: `Realized $ per million tokens (OTPI) ${fin(otpiChg) ? `${otpiChg >= 0 ? '+' : ''}${otpiChg.toFixed(0)}% over 30 days across the big four` : 'n/a'}${aaOut ? `; frontier intelligence (${aaOut.best.name}, index ${aaOut.best.idx}) sells for $${aaOut.frontier?.price}/M at the cheapest near-frontier model, top-10 median $${aaOut.top10MedianPrice}/M` : ''}. Falling prices are the demand engine and the margin question at once.` },
      compute: { score: computeScore, tone: tone(computeScore), label: computeScore >= 60 ? 'Compute getting cheaper' : computeScore >= 40 ? 'Compute cost flat' : 'Compute cost rising', why: `H100 rental ${fin(h100) ? `$${h100.toFixed(2)}/GPU-hr (${gpu.h100Source})` : 'n/a'}${fin(h100Chg) ? `, Ornn index ${h100Chg >= 0 ? '+' : ''}${h100Chg.toFixed(0)}% over 30 days` : ''}${fin(semiNow) ? `; 1-year contract $${semiNow.toFixed(2)}` : ''}. At 1,000 tokens/s an H100-hour makes a million tokens for $${gpu.bridge.costPerM1000 ?? 'n/a'} versus ~$${gpu.bridge.otpiAvg ?? 'n/a'} realized, so a GPU has to sustain about ${gpu.bridge.breakevenTps != null ? gpu.bridge.breakevenTps.toLocaleString() : 'n/a'} tokens/s to break even at today's prices.` },
    }
    return { tokens, aa: aaOut, gpu, scores, updated: new Date().toISOString() }
  }

  async function get() {
    if (mem && Date.now() - mem.ts < TTL) return mem.data
    const disk = mem || load('ai-pulse.json')
    if (disk && Date.now() - disk.ts < TTL) { mem = disk; return disk.data }
    if (inflight) return inflight
    inflight = (async () => {
      try { const data = await build(); mem = { data, ts: Date.now() }; save('ai-pulse.json', mem); return data }
      catch (e) { console.warn('ai-pulse:', e.message); if (disk) return disk.data; throw e }
      finally { inflight = null }
    })()
    return inflight
  }
  return { get }
}
