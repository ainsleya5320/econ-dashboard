// ============================================================================
// GATEWAY SHARES — AI Economy → Tokens: managed inference as a second router
// shows it. Vercel's AI Gateway publishes daily shares of tokens, spend and
// requests by lab and by model (CC BY 4.0, from October 2025; shares only, no
// absolute volumes). Set beside OpenRouter, the other public router, it shows
// what a different customer base (web and app developers on Vercel) routes to.
//
//   weekly     token share and spend share by lab, averaged by week
//   latest     the past 7 days by lab: token share, spend share, and their
//              ratio (above 1 the lab's tokens cost more than the gateway's
//              average token; below 1, less), the change over 8 weeks, and the
//              same lab's token share on OpenRouter
//   models     the past 7 days by model, with the same ratio
//   open       the token and spend share of labs that publish their weights
//
// Source: vercel.com/api/ai/leaderboard-export (text modality), read at most
// once a day; kept in the gitignored vercel-gateway.json so a failed read
// serves the last good copy. OpenRouter shares come from this dashboard's
// usage archive (server/aiPulse.js).
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3, DAY = 864e5, FROM = '2025-10-01'
const URL_EXPORT = 'https://vercel.com/api/ai/leaderboard-export'
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 2) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const mean = xs => { const v = xs.filter(fin); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null }
const iso = t => new Date(t).toISOString().slice(0, 10)

// Vercel's lab names → display names, and → the lab key OpenRouter uses
export const LABS = {
  anthropic: ['Anthropic', 'anthropic'], openai: ['OpenAI', 'openai'], google: ['Google', 'google'], deepseek: ['DeepSeek', 'deepseek'], zai: ['Z.ai', 'z-ai'], moonshotai: ['Moonshot', 'moonshotai'],
  spacexai: ['xAI', 'x-ai'], xai: ['xAI', 'x-ai'], meta: ['Meta', 'meta-llama'], alibaba: ['Alibaba (Qwen)', 'qwen'], mistral: ['Mistral', 'mistralai'], minimax: ['MiniMax', 'minimax'], amazon: ['Amazon', 'amazon'],
  cohere: ['Cohere', 'cohere'], perplexity: ['Perplexity', 'perplexity'], nvidia: ['Nvidia', 'nvidia'], tencent: ['Tencent', 'tencent'], bytedance: ['ByteDance', 'bytedance'], stepfun: ['StepFun', 'stepfun'],
}
// labs whose main models are published as weights (the rest are counted closed)
export const OPEN_LABS = new Set(['deepseek', 'zai', 'moonshotai', 'meta', 'alibaba', 'mistral', 'minimax', 'nvidia', 'tencent', 'stepfun', 'bytedance', 'xiaomi', 'meituan', 'liquid', 'inclusionai'])
const nameOf = k => LABS[k]?.[0] || k.replace(/(^|[-_ ])(\w)/g, (_, a, b) => (a ? ' ' : '') + b.toUpperCase())

// the Monday of a date's week
export const weekOf = d => { const t = Date.parse(`${d}T00:00:00Z`), wd = (new Date(t).getUTCDay() + 6) % 7; return iso(t - wd * DAY) }

// rows [{date, name, metric, share_percent}] → { byDay: {date: {metric: {name: share}}}, dates }
export function pivot(rows) {
  const byDay = {}
  for (const r of rows || []) if (r.date && r.name && fin(r.share_percent)) ((byDay[r.date] ||= {})[r.metric] ||= {})[r.name] = r.share_percent
  return { byDay, dates: Object.keys(byDay).sort() }
}

// average share of each name over a set of days (a name absent on a day counts as zero that day)
export function average(byDay, days, metric) {
  const names = new Set()
  for (const d of days) for (const n of Object.keys(byDay[d]?.[metric] || {})) names.add(n)
  const live = days.filter(d => byDay[d]?.[metric])
  const out = {}
  for (const n of names) out[n] = live.length ? live.reduce((s, d) => s + (byDay[d][metric][n] || 0), 0) / live.length : null
  return out
}

// labs rows + models rows + OpenRouter lab shares → what the panel draws
export function shape(labRows, modelRows, openRouterLabs = []) {
  const { byDay, dates } = pivot(labRows)
  if (!dates.length) return null
  const last7 = dates.slice(-7), prior = dates.slice(-63, -56)                // the same seven days eight weeks earlier
  const tok = average(byDay, last7, 'tokens'), spend = average(byDay, last7, 'spend'), req = average(byDay, last7, 'requests'), tok0 = average(byDay, prior, 'tokens')
  const or = Object.fromEntries(openRouterLabs.map(l => [l.lab, l.share]))
  const labs = Object.keys(tok).filter(k => k !== 'Other').map(k => ({
    key: k, name: nameOf(k), open: OPEN_LABS.has(k), tokens: rnd(tok[k]), spend: rnd(spend[k]), requests: rnd(req[k]),
    priceRatio: tok[k] > 0.05 && fin(spend[k]) ? rnd(spend[k] / tok[k], 2) : null, change8w: prior.length && fin(tok0[k]) ? rnd(tok[k] - tok0[k], 1) : prior.length ? rnd(tok[k], 1) : null,
    openRouter: fin(or[LABS[k]?.[1]]) ? rnd(or[LABS[k][1]], 1) : null,
  })).sort((a, b) => b.tokens - a.tokens)
  // weekly lines for the labs that have mattered: any lab with 5% of tokens or spend in some week
  const weeks = [...new Set(dates.map(weekOf))].sort()
  const perWeek = weeks.map(w => { const ds = dates.filter(d => weekOf(d) === w); return { w, days: ds.length, tokens: average(byDay, ds, 'tokens'), spend: average(byDay, ds, 'spend') } }).filter(x => x.days >= 4)
  const shown = Object.keys(LABS).concat(labs.map(l => l.key)).filter((k, i, a) => a.indexOf(k) === i).filter(k => perWeek.some(x => (x.tokens[k] || 0) >= 5 || (x.spend[k] || 0) >= 5))
  const line = metric => perWeek.map(x => { const o = { w: x.w }; let sum = 0; for (const k of shown) { o[k] = rnd(x[metric][k] || 0, 1); sum += x[metric][k] || 0 } o.other = rnd(Math.max(0, 100 - sum), 1); return o })
  const openShare = m => rnd(labs.filter(l => l.open).reduce((s, l) => s + (l[m] || 0), 0), 1)
  const m = pivot(modelRows), m7 = m.dates.slice(-7), mt = average(m.byDay, m7, 'tokens'), ms = average(m.byDay, m7, 'spend')
  const models = Object.keys(mt).filter(k => k !== 'Other').map(k => ({ name: k, tokens: rnd(mt[k]), spend: rnd(ms[k]), priceRatio: mt[k] > 0.05 && fin(ms[k]) ? rnd(ms[k] / mt[k], 2) : null })).sort((a, b) => b.tokens - a.tokens).slice(0, 15)
  return {
    asOf: dates.at(-1), from: dates[0], window: [last7[0], last7.at(-1)], labs, models, shown: shown.map(k => ({ key: k, name: nameOf(k), open: OPEN_LABS.has(k) })),
    weekly: { tokens: line('tokens'), spend: line('spend'),
      // the share of labs that publish their weights, and of tokens that cost nothing (a lab with tokens and no spend)
      open: perWeek.map(x => { const sum = m => Object.entries(x[m]).reduce((t, [k, v]) => t + (OPEN_LABS.has(k) ? v || 0 : 0), 0); return { w: x.w, tokens: rnd(sum('tokens'), 1), spend: rnd(sum('spend'), 1), free: rnd(Object.entries(x.tokens).reduce((t, [k, v]) => t + (k !== 'Other' && (v || 0) >= 0.5 && (x.spend[k] || 0) < 0.02 ? v : 0), 0), 1) } }) },
    open: { tokens: openShare('tokens'), spend: openShare('spend'), openRouter: null },
  }
}

export function createGatewayShares({ dir, UA = 'econ-dashboard', pulse, now = () => Date.now() }) {
  const FILE = path.join(dir, 'vercel-gateway.json')
  let store = { version: 1, fetched: 0, labs: [], models: [] }
  try { if (fs.existsSync(FILE)) { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (d?.version === 1) store = d } } catch (e) { console.warn('vercel-gateway.json:', e.message) }
  let cache = null, err = null
  const pull = async q => { const r = await fetch(`${URL_EXPORT}?${new URLSearchParams(q)}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(60000) }); if (!r.ok) throw new Error(`Vercel answered ${r.status}`); const j = await r.json(); if (!Array.isArray(j.rows)) throw new Error(j.error || 'no rows in the export'); return j.rows }

  async function get() {
    if (cache && now() - cache.ts < H) return cache.out
    if (!store.labs.length || now() - store.fetched > 20 * H) {
      try {
        const to = iso(now())
        const [labs, models] = await Promise.all([pull({ dataset: 'labs', modality: 'text', from: FROM, to }), pull({ dataset: 'models', modality: 'text' })])
        const slim = rows => rows.map(r => ({ date: r.date, name: r.name, metric: r.metric, share_percent: r.share_percent }))
        store = { version: 1, fetched: now(), labs: slim(labs), models: slim(models) }; err = null
        try { fs.writeFileSync(FILE, JSON.stringify(store)) } catch (e) { console.error('vercel-gateway.json save:', e.message) }
      } catch (e) { err = String(e?.message || e).slice(0, 160); console.warn('Vercel AI Gateway:', err) }
    }
    if (!store.labs.length) throw new Error(err || 'Vercel AI Gateway export unavailable')
    const p = await pulse().catch(() => null)
    const out = shape(store.labs, store.models, p?.tokens?.labs || [])
    out.open.openRouter = p?.tokens?.shares?.open ?? null
    Object.assign(out, { built: new Date(now()).toISOString(), fetched: new Date(store.fetched).toISOString(), error: err, openRouterWeek: p?.tokens?.week?.d || null,
      url: 'https://vercel.com/ai-gateway/leaderboards', license: 'CC BY 4.0, Vercel AI Gateway leaderboards',
      notes: [
        'Shares of tokens, spend and requests through Vercel\'s AI Gateway, text models only. Vercel publishes shares, not volumes, so nothing here says how big the gateway is.',
        'Price ratio is a lab\'s share of spend over its share of tokens: 2 means its tokens cost twice the gateway\'s average token, 0.2 a fifth. It reflects list price, caching and the mix of input and output, all at once.',
        'Vercel\'s customers are web and app developers; OpenRouter\'s lean to individual developers and agents. Neither is the enterprise market, which buys direct or through a cloud. Where the two agree, the read is sturdier.',
        'Open-weights share counts labs whose main models are published as weights; a lab is one or the other here, which is rough.',
      ] })
    cache = { ts: now(), out }
    return out
  }
  return { get }
}
