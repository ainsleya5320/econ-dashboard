// ============================================================================
// JEVONS TRACKER — AI Economy → Tokens: lab by lab on OpenRouter, when the
// price of a token falls does the money spent on it rise? (After a tracker
// built by scraping OpenRouter; this one reads the same public pages.)
//
// Two public endpoints behind every OpenRouter model page, no key:
//   model-activity     the model's last 31 days, one row a day: prompt tokens
//                      (cached ones included and counted apart), completion
//                      tokens. 31 days is all it serves, so each build keeps
//                      what it read in openrouter-daily.json (gitignored) and
//                      the window lengthens a day at a time. A gap of up to a
//                      month between builds heals itself.
//   effective-pricing  what was actually paid per million input and output
//                      tokens, by day and by provider endpoint, after cache
//                      discounts. A model's daily price is its endpoints'
//                      prices weighted by each endpoint's tokens over the
//                      range (the endpoint mix is held fixed within a range).
// Which models: the month view of the rankings, largest first, until
// RULES.cover of the month's tokens is covered (about 200 model-variants),
// plus anything already on file that is still active. Free variants count as
// tokens at a price of zero, so a free launch shows as a lab's price falling.
//
// Per lab (the slug before the slash) and for everything tracked:
//   spend     Σ prompt × input price + completion × output price, by day
//   price     spend ÷ tokens: the average dollar paid per million tokens
//   Δ         the last 7 complete days against the first 7 of the window
//             (week against week, so weekdays cancel); fewer days, fewer in
//             each end
//   β, R²     least squares of log daily tokens on log daily price
//   window    days on which at least 80% of the usual number of models have a
//             row; the endpoint's first day arrives for only some models and
//             would otherwise read as a day of tiny volume at a high price
//   verdict   direction first: "free only" (nothing was paid) · "price rose"
//             (including free turning paid) · "price flat" (within ±3%) ·
//             "spend shrank" · and where the price fell and spend rose,
//             "Jevons holds" if β < −1 with R² ≥ 0.4, "no price–volume link"
//             if R² < 0.05, otherwise "spend grew"
// What this cannot say: volume also grows with adoption whatever the price,
// and a lab's price here moves with its model mix and cache use as much as
// with its price list. β < −1 with spending up is what Jevons predicts, not
// proof of it. With a month of days β is fragile; it firms as days accrue.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'
import { ols } from './tokenElasticity.js'

const H = 3600e3
const BASE = 'https://openrouter.ai/api/frontend/v1'
const AGENT = 'econ-dashboard (personal research)'
const sleep = ms => new Promise(r => setTimeout(r, ms))
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 4) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const keyOf = (slug, variant) => `${slug}|${variant || 'standard'}`

export const RULES = { cover: 0.995, maxModels: 240, edge: 7, minDays: 6, minFit: 10, flat: 0.03, jevonsR2: 0.4, noLinkR2: 0.05, carry: 7, idleDays: 14, keepDays: 730 }

// effective-pricing payload → { 'YYYY-MM-DD': [input, output] } in dollars per million tokens
export function dailyPrice(data) {
  const w = Object.fromEntries((data?.providerSummaries || []).map(p => [p.endpointId, Math.max(0, p.totalTokens || 0)]))
  const side = rows => {
    const out = {}
    for (const r of rows || []) {
      const ys = Object.entries(r.y || {}).filter(([, v]) => fin(v) && v >= 0)
      if (!ys.length) continue
      const tw = ys.reduce((a, [e]) => a + (w[e] || 0), 0)
      out[String(r.x).slice(0, 10)] = tw > 0 ? ys.reduce((a, [e, v]) => a + v * (w[e] || 0), 0) / tw : ys.reduce((a, [, v]) => a + v, 0) / ys.length
    }
    return out
  }
  const input = side(data?.inputChartData), output = side(data?.outputChartData), out = {}
  for (const d of new Set([...Object.keys(input), ...Object.keys(output)])) out[d] = [input[d] ?? null, output[d] ?? null]
  return out
}

// one model's activity rows and prices → its days on file: { d: [prompt, completion, cached, input price, output price] }
// only complete days (before `today`); a day with no price takes the latest one within RULES.carry days
export function modelDays(activity, prices, today, R = RULES) {
  const priced = Object.keys(prices || {}).sort(), out = {}
  for (const r of activity || []) {
    const d = String(r.date || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d >= today) continue
    const P = r.total_prompt_tokens || 0, C = r.total_completion_tokens || 0
    if (P + C <= 0) continue
    let p = prices === 'free' ? [0, 0] : prices?.[d]
    if (prices !== 'free' && !(p && fin(p[0]) && fin(p[1]))) {
      const prev = priced.filter(x => x < d && fin(prices[x][0]) && fin(prices[x][1])).at(-1)
      p = prev && (Date.parse(d) - Date.parse(prev)) / 864e5 <= R.carry ? prices[prev] : null
    }
    out[d] = [P, C, Math.min(P, r.total_native_tokens_cached || 0), p ? rnd(p[0], 6) : null, p ? rnd(p[1], 6) : null]
  }
  return out
}

// the days worth comparing: those where at least `share` of the median number of models have a row
export function windowOf(models, share = 0.8) {
  const n = {}
  for (const m of models) for (const d of Object.keys(m.days || {})) n[d] = (n[d] || 0) + 1
  const dates = Object.keys(n).sort(), counts = dates.map(d => n[d]).sort((a, b) => a - b), med = counts[Math.floor(counts.length / 2)] || 0
  const ok = dates.filter(d => n[d] >= share * med)
  return ok.length ? { from: ok[0], to: ok.at(-1) } : null
}

// models → one daily series: tokens, spend, price ($ per million), free tokens; unpriced model-days are left out and counted
export function entitySeries(models, win = null) {
  const by = {}
  for (const m of models) for (const [d, [P, C, , pin, pout]] of Object.entries(m.days || {})) {
    if (win && (d < win.from || d > win.to)) continue
    const row = (by[d] ||= { d, tokens: 0, spend: 0, free: 0, unpriced: 0 })
    if (!fin(pin) || !fin(pout)) { row.unpriced += P + C; continue }
    row.tokens += P + C
    row.spend += (P * pin + C * pout) / 1e6
    if (m.variant === 'free') row.free += P + C
  }
  return Object.values(by).filter(r => r.tokens > 0).sort((a, b) => a.d.localeCompare(b.d)).map(r => ({ ...r, price: (r.spend / r.tokens) * 1e6 }))
}

export function verdictOf({ dPrice, dSpend, beta, r2, price, spend }, R = RULES) {
  if (!price) return 'too few days'
  if (!(spend > 0)) return 'free only'
  if (!(price[0] > 0)) return price[1] > 0 ? 'price rose' : 'free only'
  if (!fin(dPrice) || !fin(dSpend)) return 'too few days'
  if (Math.abs(dPrice) < R.flat) return 'price flat'
  if (dPrice > 0) return 'price rose'
  if (dSpend <= 0) return 'spend shrank'
  if (fin(beta) && fin(r2) && r2 < R.noLinkR2) return 'no price–volume link'
  return fin(beta) && fin(r2) && beta < -1 && r2 >= R.jevonsR2 ? 'Jevons holds' : 'spend grew'
}

// a daily series → the row of the table
export function stats(series, R = RULES) {
  const s = series || [], n = s.length, sum = (rows, k) => rows.reduce((a, r) => a + r[k], 0)
  const out = { days: n, from: s[0]?.d || null, to: s.at(-1)?.d || null, tokens: sum(s, 'tokens'), spend: rnd(sum(s, 'spend'), 2), free: sum(s, 'free'),
    price: null, dPrice: null, dTokens: null, dSpend: null, beta: null, r2: null, fitDays: 0, edge: 0 }
  out.avgPrice = out.tokens > 0 ? rnd((out.spend / out.tokens) * 1e6, 4) : null
  if (n >= R.minDays) {
    const k = Math.min(R.edge, Math.floor(n / 2)), a = s.slice(0, k), b = s.slice(-k)
    const at = rows => ({ tokens: sum(rows, 'tokens') / k, spend: sum(rows, 'spend') / k, price: (sum(rows, 'spend') / sum(rows, 'tokens')) * 1e6 })
    const A = at(a), B = at(b)
    out.edge = k
    out.price = [rnd(A.price, 4), rnd(B.price, 4)]
    out.dTokens = rnd(B.tokens / A.tokens - 1)
    out.dSpend = A.spend > 0 ? rnd(B.spend / A.spend - 1) : null
    out.dPrice = A.price > 0 ? rnd(B.price / A.price - 1) : null
  }
  const pts = s.filter(r => r.price > 0 && r.tokens > 0).map(r => [Math.log(r.price), Math.log(r.tokens)])
  if (pts.length >= R.minFit) { const f = ols(pts); if (f) { out.beta = f.slope; out.r2 = f.r2; out.fitDays = f.n } }
  out.verdict = verdictOf(out, R)
  return out
}

// the store → the table: everything tracked, then each lab, largest first
export function buildTable(store, R = RULES) {
  const models = Object.values(store?.models || {}), compact = s => s.map(r => ({ d: r.d, tokens: r.tokens, spend: rnd(r.spend, 2), price: rnd(r.price, 5) }))
  const win = windowOf(models), allSeries = entitySeries(models, win), all = stats(allSeries, R)
  // a lab that publishes under two slugs is one lab: group by its name
  const byLab = {}
  for (const m of models) (byLab[store.labs?.[m.lab] || m.lab] ||= []).push(m)
  const inWin = m => Object.entries(m.days || {}).reduce((a, [d, x]) => a + (!win || (d >= win.from && d <= win.to) ? x[0] + x[1] : 0), 0)
  const labs = Object.entries(byLab).map(([name, ms]) => {
    const id = [...new Set(ms.map(m => m.lab))].sort().join('+')
    const series = entitySeries(ms, win), st = stats(series, R)
    const top = ms.map(m => ({ name: m.name || m.slug, variant: m.variant, tokens: inWin(m) })).sort((a, b) => b.tokens - a.tokens)
    return { id, name, ...st, share: all.tokens > 0 ? rnd(st.tokens / all.tokens) : null, freeShare: st.tokens > 0 ? rnd(st.free / st.tokens) : null,
      models: top.filter(t => t.tokens > 0).length, top: top.slice(0, 3).map(t => ({ name: t.name + (t.variant !== 'standard' ? ` (${t.variant})` : ''), share: st.tokens > 0 ? rnd(t.tokens / st.tokens, 3) : null })), series: compact(series) }
  }).filter(l => l.tokens > 0).sort((a, b) => b.tokens - a.tokens)
  const unpriced = allSeries.reduce((a, r) => a + r.unpriced, 0)
  const tally = {}
  for (const l of labs) { const t = (tally[l.verdict] ||= { labs: 0, tokens: 0 }); t.labs++; t.tokens += l.tokens }
  return { window: win, all: { id: 'all', name: 'All tracked', ...all, share: 1, freeShare: all.tokens > 0 ? rnd(all.free / all.tokens) : null, models: models.length, series: compact(allSeries) }, labs,
    tally: Object.entries(tally).map(([verdict, t]) => ({ verdict, labs: t.labs, share: all.tokens > 0 ? rnd(t.tokens / all.tokens) : null })).sort((a, b) => b.share - a.share),
    unpricedShare: all.tokens + unpriced > 0 ? rnd(unpriced / (all.tokens + unpriced)) : null }
}

// which model-variants to read: the month's largest until `cover` of its tokens, plus those on file still active
export function pickModels(month, store, today, R = RULES) {
  const tok = r => (r.total_prompt_tokens || 0) + (r.total_completion_tokens || 0)
  const rows = (month || []).filter(r => r.model_permaslug && tok(r) > 0).sort((a, b) => tok(b) - tok(a)), total = rows.reduce((a, r) => a + tok(r), 0)
  const picked = new Map()
  let run = 0
  for (const r of rows) { if (picked.size >= R.maxModels || (total > 0 && run / total >= R.cover)) break; run += tok(r); picked.set(keyOf(r.model_permaslug, r.variant), { slug: r.model_permaslug, variant: r.variant || 'standard' }) }
  const cutoff = new Date(Date.parse(today) - R.idleDays * 864e5).toISOString().slice(0, 10)
  for (const [k, m] of Object.entries(store?.models || {})) if (!picked.has(k) && Object.keys(m.days || {}).some(d => d >= cutoff)) picked.set(k, { slug: m.slug, variant: m.variant })
  return { list: [...picked.values()], coverage: total > 0 ? rnd(Math.min(1, run / total)) : null, monthTokens: total }
}

export function createJevonsTracker({ dir, now = () => Date.now() }) {
  const FILE = path.join(dir, 'openrouter-daily.json')
  const load = () => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')) } catch { return { version: 1, updated: null, models: {}, labs: {} } } }
  let memo = null, building = null, progress = null, lastError = null, lastTry = 0

  const getJson = async url => {
    for (let attempt = 0; ; attempt++) {
      const r = await fetch(url, { headers: { 'User-Agent': AGENT, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) })
      if ((r.status === 429 || r.status >= 500) && attempt < 3) { await sleep(1500 * 2 ** attempt); continue }
      if (!r.ok) throw new Error(`OpenRouter answered ${r.status}`)
      return r.json()
    }
  }

  async function refresh() {
    const store = load(), today = new Date(now()).toISOString().slice(0, 10)
    const [month, cat] = await Promise.all([getJson(`${BASE}/rankings/models?view=month`), getJson('https://openrouter.ai/api/v1/models').catch(() => null)])
    // names: "Lab: Model" in the catalogue gives both the model's name and the lab's
    const names = {}, labNames = {}
    for (const m of cat?.data || []) {
      if (!names[m.canonical_slug] || !/^~|:/.test(m.id)) names[m.canonical_slug] = m.name
      const lab = String(m.canonical_slug || '').split('/')[0], head = /^([^:]{2,40}):/.exec(m.name || '')?.[1]?.trim()
      if (lab && head) (labNames[lab] ||= {})[head] = (labNames[lab][head] || 0) + 1
    }
    for (const [lab, c] of Object.entries(labNames)) store.labs[lab] = Object.entries(c).sort((a, b) => b[1] - a[1])[0][0]
    const { list, coverage, monthTokens } = pickModels(month.data, store, today)
    progress = { done: 0, of: list.length, failed: 0 }
    const queue = list.slice()
    const worker = async () => {
      for (let m; (m = queue.shift());) {
        try {
          const q = `permaslug=${encodeURIComponent(m.slug)}&variant=${encodeURIComponent(m.variant)}`
          const act = await getJson(`${BASE}/public/stats/model-activity?${q}`)
          const prices = m.variant === 'free' ? 'free' : dailyPrice((await getJson(`${BASE}/public/stats/effective-pricing?${q}&range=1m&shape=v8`)).data)
          const k = keyOf(m.slug, m.variant), prev = store.models[k]
          store.models[k] = { slug: m.slug, variant: m.variant, lab: m.slug.split('/')[0], name: (names[m.slug] || m.slug).replace(/^[^:]{2,40}:\s*/, ''), days: { ...(prev?.days || {}), ...modelDays(act.data?.analytics, prices, today) } }
        } catch { progress.failed++ }
        progress.done++
        await sleep(120)
      }
    }
    await Promise.all(Array.from({ length: 4 }, worker))
    if (progress.failed > list.length / 2) throw new Error(`${progress.failed} of ${list.length} models could not be read`)
    const floor = new Date(now() - RULES.keepDays * 864e5).toISOString().slice(0, 10)
    for (const m of Object.values(store.models)) for (const d of Object.keys(m.days)) if (d < floor) delete m.days[d]
    Object.assign(store, { updated: new Date(now()).toISOString(), coverage, monthTokens, read: list.length, failed: progress.failed })
    fs.writeFileSync(FILE, JSON.stringify(store))
    return store
  }

  const shape = store => ({
    built: store.updated, coverage: store.coverage ?? null, read: store.read ?? null, failed: store.failed ?? 0, rules: RULES, ...buildTable(store),
    notes: [
      'Tokens are each model\'s prompt and completion tokens by day from its OpenRouter page; spend prices them at what was actually paid that day (OpenRouter\'s effective price per million input and output tokens, after cache discounts), not at list. Price is spend ÷ tokens.',
      'Δ compares the last seven complete days with the first seven of the window, so weekdays cancel. β is the slope of log daily tokens on log daily price; beyond −1, volume rose by more than price fell.',
      'A lab\'s price moves with which of its models people use, how much is cached and how much is free, as well as with its price list. Free variants count as tokens at a price of zero.',
      'Volume also grows with adoption whatever the price does, so β overstates the response to price alone. "Jevons holds" means the price fell, spending rose, β < −1 and the fit is at least R² 0.4: what Jevons predicts, not proof of it.',
      'OpenRouter serves only the last 31 days of daily activity. This dashboard keeps each day it reads, so the window lengthens by a day each day it is opened; β on a single month is fragile.',
    ],
    source: 'OpenRouter public model pages: model-activity and effective-pricing (kept locally, not redistributed)',
  })

  return {
    // the last read is served at once; one older than 20 hours is refreshed behind it (a first build takes about a minute)
    async get() {
      if (!memo) { const disk = load(); if (Object.keys(disk.models).length) memo = { ts: Date.parse(disk.updated) || 0, out: shape(disk) } }
      const fresh = memo && now() - memo.ts < 20 * H
      if (!fresh && !building && now() - lastTry > H / 6) {
        lastTry = now(); lastError = null
        building = refresh().then(store => { memo = { ts: now(), out: shape(store) } }).catch(e => { lastError = String(e?.message || e).slice(0, 160) }).finally(() => { building = null })
      }
      if (memo) return building ? { ...memo.out, refreshing: true, progress } : !fresh && lastError ? { ...memo.out, stale: true, error: lastError } : memo.out
      return building ? { building: true, progress } : { building: false, error: lastError || 'no data yet' }
    },
  }
}
