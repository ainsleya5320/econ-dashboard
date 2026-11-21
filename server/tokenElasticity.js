// ============================================================================
// TOKEN ELASTICITY — AI Economy → Tokens: when tokens get cheaper, does the
// money spent on them rise or fall? (The Jevons question.) If volume grows
// faster than price falls, cheaper tokens bring more dollars into the
// ecosystem; if not, falling prices shrink the revenue pool.
//
// Three independent reads, none of them a clean experiment:
//   router    OpenRouter, week by week. Each model's tokens (prompt, cached,
//             output) from this dashboard's archive of its rankings, priced at
//             today's list prices. Since list prices are held fixed, the
//             "price" that moves is the mix: which models people route to, how
//             much is cached, how much is output. Against it, total volume and
//             the spend the two imply.
//   gateway   Vercel AI Gateway, by lab. A lab's share of spend over its share
//             of tokens is its relative price; when that falls over four
//             weeks, does the lab's token share rise by more?
//   business  Ramp's month: blended price, token volume and token spend for
//             its customers, as Ramp reports them.
//
// What these can and cannot say. Volume also grows because more people adopt
// the tools, whatever the price, so volume ÷ price change overstates the pure
// price response; the honest reading is whether spend rose while price fell,
// and how far. The gateway read divides spend by tokens to get price, so noise
// in the token count biases its slope towards −1. Each read prints its sample.
// ============================================================================

const H = 3600e3, DAY = 864e5
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 3) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const perM = s => { const v = Number(s); return fin(v) && v > 0 ? v * 1e6 : null }
const mean = xs => xs.reduce((s, x) => s + x, 0) / xs.length

// least-squares slope of y on x, with the fit
export function ols(pairs) {
  const p = pairs.filter(([x, y]) => fin(x) && fin(y))
  if (p.length < 4) return null
  const mx = mean(p.map(q => q[0])), my = mean(p.map(q => q[1]))
  const sxx = p.reduce((s, [x]) => s + (x - mx) ** 2, 0), sxy = p.reduce((s, [x, y]) => s + (x - mx) * (y - my), 0), syy = p.reduce((s, [, y]) => s + (y - my) ** 2, 0)
  if (!(sxx > 0)) return null
  return { slope: rnd(sxy / sxx, 2), r2: syy > 0 ? rnd((sxy * sxy) / (sxx * syy), 2) : null, n: p.length }
}

// the archive's rows → complete 7-day snapshots at least a week apart, newest last
export function weeklySnapshots(rows) {
  const by = new Map()
  for (const r of rows || []) { const m = by.get(r.date) || new Map(); const c = m.get(r.model_permaslug) || { P: 0, C: 0, K: 0 }; c.P += r.total_prompt_tokens || 0; c.C += r.total_completion_tokens || 0; c.K += r.total_native_tokens_cached || 0; m.set(r.model_permaslug, c); by.set(r.date, m) }
  const dates = [...by.keys()].sort(), max = Math.max(0, ...dates.map(d => by.get(d).size))
  const full = dates.filter(d => by.get(d).size >= 0.6 * max)
  const out = []
  for (let k = full.length - 1; k >= 0; k--) if (!out.length || Date.parse(out[0].d) - Date.parse(full[k]) >= 7 * DAY) out.unshift({ d: full[k], models: by.get(full[k]) })
  return out
}

// one snapshot priced at list: spend, tokens, the effective price per million, and the mix behind it
export function priceSnapshot(snap, bySlug) {
  let tok = 0, spend = 0, all = 0, cached = 0, prompt = 0, out = 0, open = 0
  for (const [slug, c] of snap.models) {
    const t = c.P + c.C
    all += t
    const m = bySlug[slug], input = perM(m?.pricing?.prompt), output = perM(m?.pricing?.completion)
    if (!fin(input) || !fin(output)) continue
    const cacheRead = perM(m.pricing.input_cache_read) ?? input, k = Math.min(c.K, c.P)
    tok += t; prompt += c.P; cached += k; out += c.C; if (m.hugging_face_id) open += t
    spend += ((c.P - k) * input + k * cacheRead + c.C * output) / 1e6
  }
  return tok > 0 ? { d: snap.d, tokens: tok, spend: rnd(spend, 0), price: rnd((spend / tok) * 1e6, 4), cachedShare: prompt ? rnd(cached / prompt, 4) : null, outputShare: rnd(out / tok, 4), openShare: rnd(open / tok, 4), coverage: all ? rnd(tok / all, 3) : null, models: snap.models.size } : null
}

// the weekly series → what happened over the whole span, and the week-to-week slope
export function routerRead(series) {
  const s = series.filter(Boolean)
  if (s.length < 3) return null
  const a = s[0], b = s.at(-1), dP = Math.log(b.price / a.price), dQ = Math.log(b.tokens / a.tokens)
  const steps = s.slice(1).map((x, i) => [Math.log(x.price / s[i].price), Math.log(x.tokens / s[i].tokens)])
  return { from: a.d, to: b.d, weeks: s.length, priceChange: rnd(b.price / a.price - 1, 4), volumeMultiple: rnd(b.tokens / a.tokens, 2), spendMultiple: rnd(b.spend / a.spend, 2),
    arc: Math.abs(dP) > 0.02 ? rnd(dQ / dP, 2) : null, weekly: ols(steps), spendUpWhilePriceDown: b.price < a.price && b.spend > a.spend,
    cached: [a.cachedShare, b.cachedShare], output: [a.outputShare, b.outputShare], open: [a.openShare, b.openShare] }
}

// Vercel weekly shares by lab → four-week changes in relative price and token share, pooled
export function gatewayRead(weekly, labs, step = 4) {
  const tok = weekly?.tokens || [], spend = weekly?.spend || []
  const pairs = [], byLab = []
  for (const lab of labs || []) {
    const k = lab.key
    const at = i => { const t = tok[i]?.[k], s = spend[i]?.[k]; return t >= 1 && s >= 0.5 ? { t, s, r: s / t } : null }
    for (let i = tok.length - 1; i - step >= 0; i -= step) { const now = at(i), was = at(i - step); if (now && was) pairs.push([Math.log(now.r / was.r), Math.log(now.t / was.t)]) }
    const now = at(tok.length - 1), was = at(tok.length - 1 - 2 * step)
    if (now && was) byLab.push({ key: k, name: lab.name, priceChange: rnd(now.r / was.r - 1, 3), tokenShare: [rnd(was.t, 1), rnd(now.t, 1)], spendShare: [rnd(was.s, 1), rnd(now.s, 1)], ratio: [rnd(was.r, 2), rnd(now.r, 2)] })
  }
  const fit = ols(pairs)
  return { fit, step, labs: byLab.sort((a, b) => a.priceChange - b.priceChange), pairs: pairs.map(([x, y]) => [rnd(x, 3), rnd(y, 3)]),
    gainedSpendWhenCheaper: byLab.filter(l => l.priceChange < -0.05).length ? rnd(byLab.filter(l => l.priceChange < -0.05 && l.spendShare[1] > l.spendShare[0]).length / byLab.filter(l => l.priceChange < -0.05).length, 2) : null }
}

// Ramp's archived weeks → each month-on-month reading
export function businessRead(history) {
  const rows = (history || []).map(w => { const p = (w.price || []).find(q => /&/.test(q.name)) || w.price?.[0]; if (!p || !(p.prior > 0) || !fin(w.volumeGrowth)) return null
    const dP = Math.log(p.latest / p.prior), dQ = Math.log(1 + w.volumeGrowth / 100)
    return { week: w.week, price: [p.prior, p.latest], priceChange: rnd(p.latest / p.prior - 1, 4), volumeGrowth: rnd(w.volumeGrowth / 100, 4), spendGrowth: fin(w.spendGrowth) ? rnd(w.spendGrowth / 100, 4) : null, arc: Math.abs(dP) > 0.01 ? rnd(dQ / dP, 2) : null } }).filter(Boolean)
  return rows.length ? { rows, latest: rows.at(-1) } : null
}

export function createTokenElasticity({ UA = 'econ-dashboard', feeds, now = () => Date.now() }) {
  let cache = null, inflight = null
  const safe = async (name, fn, errors) => { try { return await fn() } catch (e) { errors.push(`${name}: ${String(e?.message || e).slice(0, 80)}`); return null } }

  async function build() {
    const errors = []
    const [hist, cat, gw, ramp] = await Promise.all([
      safe('OpenRouter archive', feeds.rankings, errors),
      safe('OpenRouter catalogue', async () => { const r = await fetch('https://openrouter.ai/api/v1/models', { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(30000) }); if (!r.ok) throw new Error(`OpenRouter answered ${r.status}`); return (await r.json()).data }, errors),
      safe('Vercel AI Gateway', feeds.gateway, errors), safe('Ramp AI Index', feeds.ramp, errors),
    ])
    // one catalogue entry per canonical slug: the plain listing, not its batch tier or a moving alias
    const bySlug = {}
    for (const m of cat || []) if (!bySlug[m.canonical_slug] || !/^~|:/.test(m.id)) bySlug[m.canonical_slug] = m
    const series = hist && cat ? weeklySnapshots(hist.rows).map(s => priceSnapshot(s, bySlug)).filter(Boolean) : []
    const router = routerRead(series), gateway = gw ? gatewayRead(gw.weekly, gw.shown) : null, business = businessRead(ramp?.tokenHistory)
    const reads = [
      router && { id: 'router', label: 'OpenRouter, mix-weighted list price', span: `${router.from} to ${router.to}`, priceChange: router.priceChange, volume: router.volumeMultiple - 1, spend: router.spendMultiple - 1, elasticity: router.arc, spendUp: router.spendUpWhilePriceDown, n: `${router.weeks} weekly snapshots` },
      business && { id: 'business', label: 'Ramp customers, realized price', span: `month to the week ending ${business.latest.week}`, priceChange: business.latest.priceChange, volume: business.latest.volumeGrowth, spend: business.latest.spendGrowth, elasticity: business.latest.arc, spendUp: business.latest.priceChange < 0 && business.latest.spendGrowth > 0, n: `${business.rows.length} month${business.rows.length === 1 ? '' : 's'} on file` },
      gateway?.fit && { id: 'gateway', label: 'Vercel gateway, across labs', span: `four-week changes, ${gw.from} to ${gw.asOf}`, priceChange: null, volume: null, spend: null, elasticity: gateway.fit.slope, spendUp: gateway.fit.slope < -1, n: `${gateway.fit.n} lab-periods, R² ${gateway.fit.r2}` },
    ].filter(Boolean)
    return {
      built: new Date(now()).toISOString(), errors, series, router, gateway, business, reads,
      verdict: { up: reads.filter(r => r.spendUp).length, n: reads.length },
      notes: [
        'Elasticity here is the change in volume over the change in price (in logs). Beyond −1, volume rises by more than price falls and spending goes up; between 0 and −1, spending falls.',
        'OpenRouter: every model\'s prompt, cached and output tokens over complete seven-day snapshots, priced at today\'s list prices. The archive does not break out cached tokens after April, so all input is priced at the full input price, which overstates the level but not the direction. Because list prices are held fixed, the measured price change is all mix: cheaper models, more caching, less output. Models no longer in the catalogue are left out; the coverage column says how much is priced.',
        'Adoption grows volume whatever the price does, so these elasticities overstate the pure response to price. The sturdier statement is the direction: did spending rise while the price fell.',
        'Vercel: a lab\'s relative price is its share of spend over its share of tokens. The slope is pooled over non-overlapping four-week changes for labs with at least 1% of tokens. Because price is spend divided by tokens, noise in tokens pulls the slope towards −1: treat it as a sign, not a number.',
        'Ramp: one reading a month, as Ramp publishes it; the archive of months starts in November 2026.',
      ],
      source: 'this dashboard\'s OpenRouter rankings archive and OpenRouter list prices; Vercel AI Gateway leaderboards (CC BY 4.0); Ramp AI Index',
    }
  }

  async function get() {
    if (cache && now() - cache.ts < 6 * H) return cache.out
    if (!inflight) inflight = build().then(out => { cache = { ts: now(), out }; return out }).finally(() => { inflight = null })
    return inflight
  }
  return { get }
}
