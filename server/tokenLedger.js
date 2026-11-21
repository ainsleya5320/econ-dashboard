// ============================================================================
// TOKEN LEDGER — AI Economy → Tokens: every token volume a company has put on
// the record, on one scale. Nobody publishes a world total, but the big
// processors each say a number now and then (a keynote, an earnings call, a
// funding announcement). Kept by hand, with the source of each figure, in the
// private Research Database (data/curated/ai-token-volumes.json: the list
// names companies that are holdings, so this public repository only reads it),
// and put on one unit here: tokens per day.
//
//   series     one line per company and scope (a company's "all products" and
//              its "API only" are different lines), each point a dated
//              disclosure
//   growth     the yearly multiple between the latest figure and the one
//              nearest a year before it (at least six months apart)
//   measured   this dashboard's own count of tokens routed through OpenRouter,
//              the one series here that is observed and not stated; the
//              company's own earlier figures extend it backwards
//   customers  how many customers each cloud says pass a trillion tokens a year
//   platforms  what the inference platforms have said about their own scale
//              (revenue, valuation), with who said it
//
// These are not comparable across companies and must not be added up: a
// company-wide total counts its own products, an API count is only outside
// developers, a router's tokens are also counted by the labs it routes to, and
// a "token" is not the same size in every tokenizer. Each row carries what it
// counts. The file is the argument: correct a figure there.
// ============================================================================

const H = 3600e3
const FILE = ['data', 'curated', 'ai-token-volumes.json']
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 2) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
// "2026-05" → 2026.375 (mid-month), "2026-05-20" → the day
export const yearOf = d => { const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(String(d || '')); return m ? +m[1] + (+m[2] - 1 + (m[3] ? (+m[3] - 1) / 30.4 : 0.5)) / 12 : null }

// a stated figure → tokens per day
export function perDay(value, metric) {
  if (!fin(value)) return null
  const m = String(metric || '').toLowerCase()
  if (/minute/.test(m)) return value * 1440
  if (/second/.test(m)) return value * 86400
  if (/hour/.test(m)) return value * 24
  if (/week/.test(m)) return value / 7
  if (/month/.test(m)) return value / 30.4
  if (/quarter/.test(m)) return value / 91.3
  if (/year|annual/.test(m)) return value / 365
  if (/day|daily/.test(m)) return value
  return null
}

// the yearly multiple between the latest point and the one nearest a year earlier (at least half a year back)
export function yearlyMultiple(points) {
  const p = points.filter(x => fin(x.perDay) && x.perDay > 0 && fin(x.t)), last = p.at(-1)
  if (!last) return null
  const earlier = p.filter(x => last.t - x.t >= 0.5)
  if (!earlier.length) return null
  const from = earlier.reduce((b, x) => (Math.abs(last.t - x.t - 1) < Math.abs(last.t - b.t - 1) ? x : b))
  return { multiple: rnd((last.perDay / from.perDay) ** (1 / (last.t - from.t)), 1), from: from.asOf, to: last.asOf, years: rnd(last.t - from.t, 2) }
}

// the file's rows → series, one per entity and series label
export function buildSeries(volumes) {
  const by = {}
  for (const v of volumes || []) {
    const pd = perDay(v.value, v.metric), t = yearOf(v.asOf)
    if (!fin(pd) || !fin(t)) continue
    const key = `${v.entity}|${v.series || 'all'}`
    const s = (by[key] ||= { key, entity: v.entity, series: v.series || null, group: v.group || 'other', scope: v.scope || null, kind: 'disclosed', points: [] })
    s.points.push({ asOf: v.asOf, t, perDay: pd, value: v.value, metric: v.metric, statedBy: v.statedBy || null, sourceType: v.sourceType || null, url: v.url || null, confidence: v.confidence || null, note: v.note || null })
    if (v.scope && (!s.scopeAsOf || v.asOf >= s.scopeAsOf)) { s.scope = v.scope; s.scopeAsOf = v.asOf }
  }
  return Object.values(by).map(s => {
    s.points.sort((a, b) => a.t - b.t)
    const last = s.points.at(-1)
    delete s.scopeAsOf
    return { ...s, label: s.series ? `${s.entity}, ${s.series}` : s.entity, latest: { asOf: last.asOf, perDay: last.perDay, url: last.url, confidence: last.confidence, statedBy: last.statedBy }, growth: yearlyMultiple(s.points) }
  }).sort((a, b) => b.latest.perDay - a.latest.perDay)
}

export function createTokenLedger({ research, pulse, now = () => Date.now() }) {
  let cache = null

  async function get() {
    if (cache && now() - cache.ts < H) return cache.out
    const f = await research.read(FILE)
    if (!f) return research.missing()
    if (!f.data?.volumes?.length) return research.missing('token volume ledger', FILE)
    const file = f.data
    // OpenRouter's own stated figures only extend the measured series backwards; they are not a second line
    const stated = buildSeries(file.volumes.filter(v => v.entity === 'OpenRouter'))[0]?.points || []
    const series = buildSeries(file.volumes.filter(v => v.entity !== 'OpenRouter'))
    // the one measured series: tokens through OpenRouter, a complete week at a time, taken every fourth week
    const p = await pulse().catch(() => null)
    const wk = p?.tokens?.weekly || []
    if (wk.length >= 8) {
      const pts = wk.filter((_, i) => (wk.length - 1 - i) % 4 === 0).map(w => ({ asOf: w.d, t: yearOf(w.d), perDay: w.total / 7, value: w.total, metric: 'tokens per week', statedBy: 'OpenRouter public rankings', sourceType: 'measured', url: 'https://openrouter.ai/rankings', confidence: 'high', note: null }))
      pts.unshift(...stated.filter(x => x.t < pts[0].t - 0.05))
      const last = pts.at(-1)
      series.push({ key: 'OpenRouter|measured', entity: 'OpenRouter', series: 'measured', group: 'router', kind: 'measured', points: pts, label: 'OpenRouter, measured',
        scope: 'tokens routed through OpenRouter, counted from its public rankings (the company\'s own figures before late 2025); also counted by the labs and providers it routes to',
        latest: { asOf: last.asOf, perDay: last.perDay, url: 'https://openrouter.ai/rankings', confidence: 'high', statedBy: 'this dashboard\'s archive of OpenRouter\'s rankings' }, growth: yearlyMultiple(pts) })
      series.sort((a, b) => b.latest.perDay - a.latest.perDay)
    } else if (stated.length) series.push(...buildSeries(file.volumes.filter(v => v.entity === 'OpenRouter')))
    const out = {
      available: true, built: new Date(now()).toISOString(), reviewed: file.reviewed || null, universe: f.source, researchUrl: research.researchUrl,
      series, platforms: file.platforms || [], customers: file.customers || [],
      counts: { series: series.length, points: series.reduce((s, x) => s + x.points.length, 0), entities: new Set(series.map(s => s.entity)).size },
      notes: [
        'Every figure is what a company or its executive said, converted to tokens per day (a month is 30.4 days, a quarter 91.3). The original figure, who said it and the link are in the table.',
        'Do not add the rows up. A company-wide total counts its own products; an API figure counts only outside developers; a router\'s or an inference platform\'s tokens are also counted by whoever made the model; Chinese and Western labs tokenize differently.',
        'Growth is the yearly multiple between the latest figure and the one nearest a year before it, at least six months apart; a company with one disclosure has none.',
        'Confidence: high is an on-record company statement or filing, medium a credible outlet reporting a company figure, low a third-party estimate or a leak.',
        file.caveat || null,
      ].filter(Boolean),
      source: 'the Research Database\'s ai-token-volumes.json (hand-kept company disclosures with links) and this dashboard\'s OpenRouter archive',
    }
    cache = { ts: now(), out }
    return out
  }
  return { get }
}
