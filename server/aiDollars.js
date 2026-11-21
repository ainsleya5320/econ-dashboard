// ============================================================================
// AI DOLLARS — AI Economy → Models & Labs: what new dollars are entering the AI
// ecosystem, and whose they are. Two kinds of money, kept apart:
//
//   customers   revenue, annualised, in four tiers that overlap and are never
//               added together:
//                 labs          what the model makers say their run-rate is
//                 cloud AI      the AI revenue run-rates the clouds have put a
//                               number on (they resell the labs' models)
//                 applications  AI-native software (it pays the labs for tokens)
//                 inference     inference platforms and neoclouds (their
//                               customers are mostly the three tiers above)
//               each company's latest figure, the one nearest a year before it,
//               and so the dollars a year it is adding
//   capital     what builders and investors are putting in over a year: the
//               hyperscalers' capex as filed (trailing four quarters, with how
//               much of it their operating cash flow covers) and as guided,
//               neocloud capex guidance, and venture funding into AI companies
//   reads       lab revenue per dollar of capex, new revenue against new capex,
//               and the surveys of enterprise AI spending as a cross-check
//
// The disclosures are hand-kept in the private Research Database
// (data/curated/ai-dollars.json: the list names companies that are holdings, so
// this public repository only reads it); capex as filed comes from the
// hyperscaler-capex.json this dashboard already keeps. Run-rates are a recent
// month or quarter times twelve or four, as each company states them: not
// audited revenue, and not on one basis.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3
const FILE = ['data', 'curated', 'ai-dollars.json']
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 2) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const sum = xs => xs.filter(fin).reduce((s, x) => s + x, 0)
const tOf = ym => { const m = /^(\d{4})-(\d{2})/.exec(String(ym || '')); return m ? +m[1] + (+m[2] - 0.5) / 12 : null }
const RANK = { high: 3, medium: 2, low: 1 }

export const TIERS = [
  { id: 'labs', label: 'AI labs', what: 'what customers pay the model makers', caveat: 'includes what they sell through the clouds' },
  { id: 'cloud-ai', label: 'Clouds\' AI lines', what: 'the AI revenue the clouds have put a number on', caveat: 'includes reselling the labs\' models; not every cloud gives a figure' },
  { id: 'applications', label: 'AI-native applications', what: 'software built on the models', caveat: 'much of it is passed on to the labs as token spend' },
  { id: 'inference', label: 'Inference platforms and neoclouds', what: 'rented compute and hosted open models', caveat: 'their customers are mostly labs, clouds and applications: intermediate, not end demand' },
]

// one tier's rows → per company: the latest annualised figure, the one nearest a year earlier, and the dollars added
// between them. `extra` adds dated points from elsewhere ({entity, asOf, usd}) to lengthen a company's history.
export function tierOf(rows, id, extra = []) {
  const by = {}
  for (const x of extra) if (fin(x.usd) && fin(tOf(x.asOf))) (by[x.entity] ||= []).push({ asOf: x.asOf, t: tOf(x.asOf), usd: x.usd, basis: 'run-rate', metric: 'run-rate', statedBy: x.statedBy || null, sourceType: x.sourceType || null, url: x.url || null, confidence: x.confidence || 'medium', note: null, extra: true })
  for (const r of rows) {
    if (r.tier !== id || !['run-rate', 'quarter'].includes(r.use) || !fin(r.value) || !fin(tOf(r.asOf))) continue
    ;(by[r.entity] ||= []).push({ asOf: r.asOf, t: tOf(r.asOf), usd: r.use === 'quarter' ? r.value * 4 : r.value, basis: r.use === 'quarter' ? 'a quarter × 4' : /bookings/i.test(r.metric) ? 'bookings' : 'run-rate', metric: r.metric, statedBy: r.statedBy || null, sourceType: r.sourceType || null, url: r.url || null, confidence: r.confidence || null, note: r.note || null })
  }
  const entities = Object.entries(by).map(([entity, p]) => {
    // the latest month; within a month the better-sourced figure
    p.sort((a, b) => a.t - b.t || (RANK[a.confidence] || 0) - (RANK[b.confidence] || 0))
    // the figure nearest a year before the latest: at least nine months back if there is one, else at least six
    const last = p.at(-1), far = p.filter(x => last.t - x.t >= 0.74), earlier = far.length ? far : p.filter(x => last.t - x.t >= 0.5)
    const from = earlier.length ? earlier.reduce((b, x) => (Math.abs(last.t - x.t - 1) < Math.abs(last.t - b.t - 1) ? x : b)) : null
    return { entity, usd: last.usd, asOf: last.asOf, basis: last.basis, confidence: last.confidence, sourceType: last.sourceType, statedBy: last.statedBy, url: last.url, note: last.note, points: p.length,
      prior: from ? { usd: from.usd, asOf: from.asOf } : null, added: from ? last.usd - from.usd : null, months: from ? Math.round((last.t - from.t) * 12) : null, multiple: from && from.usd > 0 ? rnd((last.usd / from.usd) ** (1 / (last.t - from.t)), 1) : null }
  }).sort((a, b) => b.usd - a.usd)
  const hist = entities.filter(e => e.prior)
  return { total: sum(entities.map(e => e.usd)), added: sum(entities.map(e => e.added)), withHistory: hist.length, months: hist.length ? [Math.min(...hist.map(e => e.months)), Math.max(...hist.map(e => e.months))] : null, entities }
}

// capex rows → per company: the latest guidance (the middle of a range), or a quarter's actual × 4
export function guidanceOf(rows, id) {
  const by = {}
  for (const r of rows) if (r.tier === id && fin(r.value)) { const cur = by[r.entity]; if (!cur || r.asOf > cur.asOf) by[r.entity] = r }
  const entities = Object.values(by).map(r => {
    const q = r.use === 'quarter', lo = q ? r.value * 4 : r.value, hi = q ? r.value * 4 : (r.valueHigh || r.value)
    return { entity: r.entity, usd: (lo + hi) / 2, low: lo, high: hi, period: r.period, asOf: r.asOf, basis: q ? 'a quarter\'s actual × 4' : 'guidance', confidence: r.confidence || null, statedBy: r.statedBy || null, url: r.url || null, note: r.note || null }
  }).sort((a, b) => b.usd - a.usd)
  return { total: sum(entities.map(e => e.usd)), low: sum(entities.map(e => e.low)), high: sum(entities.map(e => e.high)), entities }
}

// hyperscaler capex as filed: the last four quarters every company has, the four before, and operating cash flow
export function filedCapex(file) {
  const cos = Object.entries(file?.companies || {}).filter(([, c]) => (c.quarters || []).length >= 8)
  if (!cos.length) return null
  const end = cos.map(([, c]) => c.quarters.at(-1).date).sort()[0]
  const win = (c, a, b, k) => sum(c.quarters.filter(q => q.date <= end).slice(a, b).map(q => q[k]))
  const now = sum(cos.map(([, c]) => win(c, -4, undefined, 'capex'))), prev = sum(cos.map(([, c]) => win(c, -8, -4, 'capex'))), ocf = sum(cos.map(([, c]) => win(c, -4, undefined, 'operatingCashFlow')))
  return { usd: now, prior: prev, added: now - prev, operatingCashFlow: ocf, coverage: ocf > 0 ? rnd(now / ocf, 3) : null, through: end, companies: cos.length }
}

export function buildDollars(rows, capexFile, extra = {}) {
  const tiers = TIERS.map(t => ({ ...t, ...tierOf(rows, t.id, (extra[t.id] || []).filter(x => rows.some(r => r.tier === t.id && r.entity === x.entity))) }))
  const T = Object.fromEntries(tiers.map(t => [t.id, t]))
  const filed = filedCapex(capexFile), guided = guidanceOf(rows, 'capex'), neo = guidanceOf(rows, 'neocloud-capex')
  const v = rows.filter(r => r.tier === 'venture' && fin(r.value))
  const pick = r => ({ label: r.entity, period: r.period, usd: r.value, asOf: r.asOf, confidence: r.confidence || null, url: r.url || null, note: r.note || null, metric: r.metric })
  const venture = { years: v.filter(r => r.use === 'year').sort((a, b) => a.asOf.localeCompare(b.asOf)).map(pick), quarters: v.filter(r => r.use === 'quarter').sort((a, b) => a.asOf.localeCompare(b.asOf)).map(pick), rounds: v.filter(r => r.use === 'round').sort((a, b) => b.value - a.value).map(pick) }
  const vy = venture.years.at(-1) || null, vq = venture.quarters.at(-1) || null
  const end = T.labs.total + T['cloud-ai'].total, capex = filed?.usd ?? guided.total
  return {
    tiers, capital: { filed, guided, neocloud: neo, venture },
    survey: rows.filter(r => r.tier === 'survey').map(r => ({ entity: r.entity, metric: r.metric, usd: r.value, unit: r.unit, period: r.period, asOf: r.asOf, confidence: r.confidence || null, url: r.url || null, note: r.note || null })),
    reads: {
      labs: T.labs.total, labsAdded: T.labs.added, cloud: T['cloud-ai'].total, endRevenue: end, capex, capexBasis: filed ? `filed, four quarters to ${filed.through.slice(0, 7)}` : 'guided',
      labsPerCapexDollar: capex > 0 ? rnd(T.labs.total / capex, 3) : null, endPerCapexDollar: capex > 0 ? rnd(end / capex, 3) : null,
      capexAdded: filed?.added ?? null, capexPerNewRevenueDollar: filed && T.labs.added > 0 ? rnd(filed.added / T.labs.added, 2) : null,
      ventureYear: vy, ventureQuarter: vq, capexCoverage: filed?.coverage ?? null,
    },
  }
}

export function createAiDollars({ dir, research, now = () => Date.now() }) {
  let cache = null
  async function get() {
    if (cache && now() - cache.ts < H) return cache.out
    const f = await research.read(FILE)
    if (!f) return research.missing()
    if (!f.data?.rows?.length) return research.missing('AI dollar ledger', FILE)
    let capexFile = null
    try { capexFile = JSON.parse(fs.readFileSync(path.join(dir, 'hyperscaler-capex.json'), 'utf8')) } catch { /* guidance stands in */ }
    // the lab run-rates this dashboard already keeps lengthen the labs' history (same companies only)
    let labsExtra = []
    try { labsExtra = (JSON.parse(fs.readFileSync(path.join(dir, 'data', 'ai', 'revenue-disclosures.json'), 'utf8')).disclosures || []).filter(r => fin(r.arr) && /^\d{4}-\d{2}$/.test(r.d)).map(r => ({ entity: r.co, asOf: r.d, usd: r.arr * 1e9, statedBy: r.source || 'on file in this dashboard', confidence: r.confidence || 'medium' })) } catch { /* none */ }
    const out = {
      available: true, built: new Date(now()).toISOString(), reviewed: f.data.reviewed || null, universe: f.source, researchUrl: research.researchUrl,
      ...buildDollars(f.data.rows, capexFile, { labs: labsExtra }),
      context: f.data.rows.filter(r => !r.tier && fin(r.value)).map(r => ({ entity: r.entity, metric: r.metric, value: r.value, unit: r.unit, period: r.period, asOf: r.asOf, confidence: r.confidence || null, url: r.url || null })),
      notes: [
        'Revenue figures are annualised run-rates as each company states them (a recent month × 12 or quarter × 4), or a quarter\'s reported revenue × 4 where marked. They are not audited revenue and not on one basis; a lab\'s figure can differ by tens of billions depending on how sales through clouds are counted.',
        'The four revenue tiers overlap and are never added together: applications pay labs for tokens, labs sell through clouds, and neoclouds rent compute to labs and clouds. The labs\' tier is the cleanest single measure of what end customers pay for models.',
        'Dollars added is the latest figure less the one nearest a year earlier (at least nine months back where there is one, else six), as it is and not scaled to a year; the window is shown. A company with one figure on file adds nothing to that column, so the tier totals understate.',
        'Capex as filed is the five hyperscalers\' capital expenditure over the latest four quarters all five have reported; it is all capex, not only AI. Guidance is each company\'s latest stated figure for the calendar year, the middle of a range.',
        'Venture funding is a data provider\'s count of rounds into companies it classes as AI; definitions differ between providers and get revised.',
        f.data.caveat || null,
      ].filter(Boolean),
      source: 'the Research Database\'s ai-dollars.json (hand-kept disclosures with links) and this dashboard\'s hyperscaler capex file (SEC XBRL)',
    }
    cache = { ts: now(), out }
    return out
  }
  return { get }
}
