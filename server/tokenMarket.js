// ============================================================================
// TOKEN MARKET — AI Economy → Tokens: what a million tokens costs to make and
// what it sells for at each step up, on one ladder; and who competes to serve
// the open models.
//
//   ladder     per million tokens, input and output priced separately:
//                derived cost   the GPU-derived floor for a 70B open model on
//                               an H100 rented by the year, and on marketplace
//                               spot (server/tokenSpot.js; its assumptions are
//                               the argument, see that panel)
//                open market    the cheapest and the median provider selling
//                               that same model on OpenRouter
//                open, used     the usage-weighted list price of the open-
//                               weights models people actually route to
//                realized       what businesses actually pay per million
//                               tokens of any kind (Ramp AI Index)
//                closed, used   the usage-weighted list price of closed-lab
//                               models: output, input, and cached input
//              A blended figure needs a mix. The measured one is OpenRouter's
//              share of tokens that are output (about 2%: prompts are long and
//              mostly re-read), not the 25% the cost model assumes.
//   references three open models matched to the cost model's archetypes, each
//              with its providers, the cheapest and median price, and the
//              margin those prices leave over the derived cost
//   providers  across the reference models and the most-used open models: who
//              serves how many, how often they are cheapest, and their price
//              against each model's median — the managed-inference market as
//              prices show it
//
// Sources: OpenRouter's public models and per-model endpoints APIs (list
// prices by provider), this dashboard's OpenRouter usage archive (weights),
// the token-spot cost model, Vast.ai H100 spot, Ramp. One row a day is kept in
// the gitignored token-market-archive.json so the ladder builds a history.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { costPerMillion } from './tokenSpot.js'

const H = 3600e3
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 3) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const median = xs => { const v = xs.filter(fin).sort((a, b) => a - b); if (!v.length) return null; const m = (v.length - 1) / 2; return (v[Math.floor(m)] + v[Math.ceil(m)]) / 2 }
const perM = s => { const v = Number(s); return fin(v) && v > 0 ? v * 1e6 : null }
const sleep = ms => new Promise(r => setTimeout(r, ms))

// the reference open models, matched to the cost model's archetypes (data/ai/token-spot.json)
export const REFERENCES = [
  { id: 'meta-llama/llama-3.3-70b-instruct', archetype: 'dense70b', label: 'Llama 3.3 70B' },
  { id: 'google/gemma-3-27b-it', archetype: 'small30b', label: 'Gemma 3 27B' },
  { id: 'deepseek/deepseek-v3.2', archetype: 'moe_frontier', label: 'DeepSeek V3.2 (670B, 37B active)' },
]

// a million tokens at a mix: `share` of them output, the rest input
export const blend = (input, output, share) => (fin(input) && fin(output) && fin(share) ? input * (1 - share) + output * share : null)

// OpenRouter's endpoints for one model → one row per provider (its cheapest live endpoint), per million tokens
export function providersOf(endpoints, share) {
  const by = {}
  for (const e of endpoints || []) {
    if (e.status != null && e.status < 0) continue                     // de-ranked or down
    const input = perM(e.pricing?.prompt), output = perM(e.pricing?.completion)
    if (!fin(input) || !fin(output)) continue                          // free or unpriced endpoints say nothing about the market
    const row = { provider: e.provider_name, input: rnd(input), output: rnd(output), cacheRead: rnd(perM(e.pricing?.input_cache_read)), quant: e.quantization || null, mix: rnd(blend(input, output, share), 4) }
    if (!by[row.provider] || row.mix < by[row.provider].mix) by[row.provider] = row
  }
  return Object.values(by).sort((a, b) => a.mix - b.mix)
}

// the price at a quantile of the providers, input and output taken from the provider at that rank by the mix price
export function priceStats(providers) {
  if (!providers.length) return null
  const mid = providers[Math.floor((providers.length - 1) / 2)]
  return { n: providers.length, cheapest: providers[0], median: mid, dearest: providers.at(-1), spread: providers[0].mix > 0 ? rnd(providers.at(-1).mix / providers[0].mix, 1) : null }
}

// one catalogue entry per canonical slug: the plain listing, not its batch tier or a moving alias
export const indexBySlug = catalog => { const o = {}; for (const m of catalog) if (!/^~|:/.test(m.id) || !o[m.canonical_slug]) { if (!o[m.canonical_slug] || !/^~|:/.test(m.id)) o[m.canonical_slug] = m } return o }

// usage-weighted list price over the top models: `top` from the usage archive, `catalog` from OpenRouter's models API.
// `open` picks open-weights or closed models; `labs`, if given, keeps only those labs (the id's prefix)
export function usageWeighted(top, catalog, open, labs = null) {
  const bySlug = indexBySlug(catalog)
  let w = 0, wi = 0, wo = 0, wc = 0, wcw = 0, all = 0, n = 0
  for (const t of top || []) {
    const m = bySlug[t.slug]
    if (!m) continue
    if (!!m.hugging_face_id !== open) continue
    if (labs && !labs.includes(m.id.split('/')[0])) continue
    all += t.tokens
    const input = perM(m.pricing?.prompt), output = perM(m.pricing?.completion), cache = perM(m.pricing?.input_cache_read)
    if (!fin(input) || !fin(output)) continue
    w += t.tokens; wi += t.tokens * input; wo += t.tokens * output; n++
    if (fin(cache)) { wc += t.tokens * cache; wcw += t.tokens }
  }
  return w ? { input: rnd(wi / w), output: rnd(wo / w), cacheRead: wcw ? rnd(wc / wcw) : null, models: n, tokens: w, priced: all ? rnd(w / all, 3) : null } : null
}

// who serves the open models: across `sets` (one provider list per model), per provider
export function providerBoard(sets) {
  const by = {}
  for (const { model, providers } of sets) {
    const med = median(providers.map(p => p.mix))
    providers.forEach((p, k) => {
      const b = (by[p.provider] ||= { provider: p.provider, models: 0, cheapest: 0, ratios: [], served: [] })
      b.models++; b.served.push(model)
      if (k === 0 && providers.length > 1) b.cheapest++
      if (fin(med) && med > 0) b.ratios.push(p.mix / med)
    })
  }
  return Object.values(by).map(b => ({ provider: b.provider, models: b.models, cheapest: b.cheapest, vsMedian: rnd(median(b.ratios), 2), served: b.served }))
    .sort((a, b) => b.models - a.models || b.cheapest - a.cheapest || (a.vsMedian ?? 9) - (b.vsMedian ?? 9))
}

export function createTokenMarket({ dir, UA = 'econ-dashboard', feeds, now = () => Date.now() }) {
  const FILE = path.join(dir, 'token-market-archive.json')
  const ref = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'ai', 'token-spot.json'), 'utf8'))
  let hist = { version: 1, days: {} }
  try { if (fs.existsSync(FILE)) { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (d?.version === 1) hist = d } } catch { /* start afresh */ }
  let cache = null, inflight = null
  const getJson = async url => { const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`OpenRouter answered ${r.status}`); return r.json() }
  const safe = async (name, fn, errors) => { try { return await fn() } catch (e) { errors.push(`${name}: ${String(e?.message || e).slice(0, 80)}`); return null } }

  async function build() {
    const errors = []
    const [catalogRaw, spot, pulse, ramp] = await Promise.all([
      getJson('https://openrouter.ai/api/v1/models'), safe('token cost model', feeds.tokenSpot, errors), safe('usage archive', feeds.pulse, errors), safe('Ramp AI Index', feeds.ramp, errors),
    ])
    const catalog = catalogRaw.data || []
    // the measured mix: the share of routed tokens that are output
    const share = fin(pulse?.tokens?.mix?.completionShare) ? pulse.tokens.mix.completionShare / 100 : 0.03
    const top = pulse?.tokens?.topModels || []
    const bySlug = indexBySlug(catalog)
    // the reference models, then the most-used open models, each with its providers
    const openTop = top.map(t => bySlug[t.slug]).filter(m => m && m.hugging_face_id && !REFERENCES.some(r => r.id === m.id)).slice(0, 9)
    const wanted = [...REFERENCES.map(r => ({ ...r, ref: true })), ...openTop.map(m => ({ id: m.id, label: m.name.replace(/^[^:]+:\s*/, ''), ref: false }))]
    const sets = []
    for (const m of wanted) {
      const j = await safe(m.label, () => getJson(`https://openrouter.ai/api/v1/models/${m.id}/endpoints`), errors)
      const providers = providersOf(j?.data?.endpoints, share)
      if (providers.length) sets.push({ ...m, model: m.label, providers })
      await sleep(250)
    }

    const contract = spot?.latest?.rate ?? null
    const vast = (pulse?.gpu?.vast || []).find(g => /^H100/.test(g.gpu))?.median ?? null
    const costAt = (arch, rate) => (fin(rate) && ref.models[arch] ? costPerMillion({ chip: ref.chips.h100, model: ref.models[arch], rateUsdHr: rate, a: ref.assumptions }) : null)
    const references = sets.filter(s => s.ref).map(s => {
      const st = priceStats(s.providers), c = costAt(s.archetype, contract), cs = costAt(s.archetype, vast)
      const cost = c ? { input: c.input, output: c.output, mix: rnd(blend(c.input, c.output, share), 4), fits: c.fits } : null
      // a model that does not fit the node the cost model assumes has no meaningful floor from it
      const margin = p => (cost && cost.fits && fin(cost.mix) && p?.mix > 0 ? rnd(1 - cost.mix / p.mix, 3) : null)
      return { id: s.id, label: s.label, archetype: s.archetype, archetypeLabel: ref.models[s.archetype]?.label || null, cost, costSpot: cs ? { input: cs.input, output: cs.output, mix: rnd(blend(cs.input, cs.output, share), 4) } : null,
        providers: s.providers, ...st, marginCheapest: margin(st.cheapest), marginMedian: margin(st.median) }
    })

    const main = references.find(r => r.archetype === 'dense70b') || references[0] || null
    const openUsed = usageWeighted(top, catalog, true), closedUsed = usageWeighted(top, catalog, false)
    // the two labs Ramp's realized price covers, so realized can be set against their own list prices
    const twoLabs = usageWeighted(top, catalog, false, ['openai', 'anthropic'])
    const rp = (ramp?.tokens?.price || []).find(p => /&/.test(p.name)) || ramp?.tokens?.price?.[0] || null
    const rung = (id, group, label, o) => ({ id, group, label, ...o, mix: fin(o.all) ? o.all : rnd(blend(o.input, o.output, share), 4) })
    const ladder = [
      main?.cost && rung('cost-contract', 'cost', `Cost to serve ${main.label} on an H100 rented by the year`, { input: main.cost.input, output: main.cost.output, kind: 'derived', note: `$${contract?.toFixed(2)}/GPU-hour, the cost model's assumptions` }),
      main?.costSpot && rung('cost-spot', 'cost', `The same on a marketplace spot H100`, { input: main.costSpot.input, output: main.costSpot.output, kind: 'derived', note: `$${vast?.toFixed(2)}/GPU-hour, Vast.ai median` }),
      main?.cheapest && rung('open-cheapest', 'open', `Cheapest provider of ${main.label}`, { input: main.cheapest.input, output: main.cheapest.output, kind: 'list', note: `${main.cheapest.provider}${main.cheapest.quant ? `, ${main.cheapest.quant}` : ''}` }),
      main?.median && rung('open-median', 'open', `Median provider of ${main.label}`, { input: main.median.input, output: main.median.output, kind: 'list', note: `${main.n} providers` }),
      openUsed && rung('open-used', 'open', 'Open-weights models, usage-weighted list price', { input: openUsed.input, output: openUsed.output, kind: 'list', note: `${openUsed.models} of the 30 most-used models on OpenRouter` }),
      closedUsed && rung('closed-used', 'closed', 'Closed-lab models, usage-weighted list price', { input: closedUsed.input, output: closedUsed.output, kind: 'list', note: `${closedUsed.models} of the 30 most-used models on OpenRouter` }),
      twoLabs && rung('two-used', 'closed', 'OpenAI and Anthropic models, usage-weighted list price', { input: twoLabs.input, output: twoLabs.output, kind: 'list', note: `${twoLabs.models} models; the two labs the realized price covers` }),
      twoLabs && fin(twoLabs.cacheRead) && rung('two-cache', 'closed', 'OpenAI and Anthropic models, cached input', { all: twoLabs.cacheRead, kind: 'list', note: 'the list price of re-reading a prompt already in the cache' }),
      rp && fin(rp.latest) && rung('realized', 'realized', 'What businesses actually pay, all tokens', { all: rp.latest, kind: 'measured', note: `Ramp AI Index, ${rp.name}, week ending ${ramp.tokens.week}; a month earlier $${rp.prior?.toFixed(2)}` }),
    ].filter(Boolean)

    const day = new Date(now() - new Date(now()).getTimezoneOffset() * 60000).toISOString().slice(0, 10)
    if (ladder.length >= 4) {
      hist.days[day] = { share: rnd(share, 4), contract, vast, rungs: Object.fromEntries(ladder.map(r => [r.id, [r.input ?? null, r.output ?? null, r.mix]])) }
      try { fs.writeFileSync(FILE, JSON.stringify(hist)) } catch (e) { console.error('token-market-archive.json save:', e.message) }
    }
    const by = id => ladder.find(r => r.id === id)
    return {
      built: new Date(now()).toISOString(), errors, outputShare: rnd(share, 4), assumedShare: ref.assumptions.outputPerInput.value, rates: { contract, vast },
      ladder, references, usage: { open: openUsed, closed: closedUsed, twoLabs },
      providers: providerBoard(sets), models: sets.map(s => ({ id: s.id, label: s.label, ref: !!s.ref, providers: s.providers.length, cheapest: s.providers[0], median: priceStats(s.providers).median })),
      reads: {
        marginCheapest: main?.marginCheapest ?? null, marginMedian: main?.marginMedian ?? null,
        closedOverOpen: by('closed-used') && by('open-used') && by('open-used').mix > 0 ? rnd(by('closed-used').mix / by('open-used').mix, 1) : null,
        realizedOverList: by('realized') && by('two-used')?.mix > 0 ? rnd(by('realized').mix / by('two-used').mix, 3) : null,
        realizedOverCache: by('realized') && by('two-cache')?.mix > 0 ? rnd(by('realized').mix / by('two-cache').mix, 2) : null,
      },
      history: Object.entries(hist.days).sort().slice(-400).map(([d, v]) => ({ d, share: v.share, ...Object.fromEntries(Object.entries(v.rungs).map(([k, r]) => [k, r[2]])) })),
      notes: [
        'Every price is per million tokens. Input and output are priced separately because they cost different things to make: reading a prompt is compute-bound and cheap, generating is memory-bound and dear.',
        `The mix: ${(share * 100).toFixed(1)}% of tokens routed through OpenRouter are output. Prompts are long (code, documents, tool results) and re-read on every turn, so the price of a typical token is close to the input price, and for closed labs close to the cached-input price.`,
        'Derived cost comes from the token-spot cost model (batch 256, 4K context, 60% utilisation, 8 GPUs to a node): a floor under good conditions, and its assumptions move the answer more than the GPU price does. A provider priced below it is batching harder, running quantised weights, using cheaper chips, or losing money.',
        'Provider prices are OpenRouter list prices for the cheapest live endpoint each provider offers for that model; quantisation differs and is shown. Direct enterprise contracts are not visible.',
        'Usage-weighted list prices weight each model\'s list price by its tokens on OpenRouter over the past week: a developer-heavy sample.',
        'Realized price is Ramp\'s blended price per million tokens across OpenAI and Anthropic API spend by its customers: it reflects caching, batch discounts and the model mix, which is why it sits far below list.',
      ],
      source: 'OpenRouter models and endpoints APIs; this dashboard\'s OpenRouter usage archive; the token-spot cost model (SemiAnalysis H100 contract index, Vast.ai spot); Ramp AI Index',
    }
  }

  async function get() {
    if (cache && now() - cache.ts < 6 * H) return cache.out
    if (!inflight) inflight = build().then(out => { cache = { ts: now(), out }; return out }).finally(() => { inflight = null })
    return inflight
  }
  return { get }
}
