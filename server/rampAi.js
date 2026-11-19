// ============================================================================
// RAMP AI INDEX — AI Economy → Tokens: what American businesses actually pay
// for AI, from card and bill-pay transactions of 85,000-odd firms on Ramp.
//   adoption   share of businesses with a paid AI transaction in the month:
//              overall, by vendor, by size and by industry (since July 2023)
//   spend      AI spend per employee per month (median firm paying for AI, the
//              top 10% and the top 1%), and AI's share of all non-payroll
//              business spend, overall and by industry
//   tokens     the latest week's API token spend and volume shares by lab,
//              blended price per million tokens, and growth on a month
//              earlier: Ramp publishes only the latest week against a month
//              before, so each day's reading is archived here and a weekly
//              history builds from the first day this runs
//
// Source: Ramp's AI Index page (ramp.com/data/ai-index), which embeds the full
// monthly series in its server-rendered payload and labels the dataset free to
// access; read at most twice a day. Ramp also publishes the adoption series on
// FRED (RAMPAI*), used here when the page cannot be read. Ramp is a sample of
// its own customers (skewed to tech-forward firms), not a census: Census's own
// survey counts far fewer firms using AI.
// Cache and token archive: ramp-ai.json at the root (gitignored).
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const URL_PAGE = 'https://ramp.com/data/ai-index'
const H = 3600e3
const FRED_IDS = { overall: 'RAMPAIALL', OpenAI: 'RAMPAIOPENAI', Anthropic: 'RAMPAIANTHROPIC', xAI: 'RAMPAIXAI', Small: 'RAMPAISMB', 'Mid-Market': 'RAMPAIMIDMARKET', Large: 'RAMPAIENTERPRISE' }
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 3) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)

// The page's payload is a JavaScript string with its quotes escaped: unescape, then read one JSON array by
// bracket matching from the first `"key":[` at or after `from`. Ramp writes missing values as "$undefined".
export function unescapePayload(raw) { return raw.replace(/\\"/g, '"').replace(/\\u0026/g, '&') }
export function arrayAt(s, key, from = 0) {
  const at = s.indexOf(`"${key}":[`, from)
  if (at < 0) return null
  const k = s.indexOf('[', at)
  let depth = 0, inStr = false
  for (let j = k; j < s.length; j++) {
    const c = s[j]
    if (inStr) { if (c === '\\') j++; else if (c === '"') inStr = false; continue }
    if (c === '"') inStr = true
    else if (c === '[' || c === '{') depth++
    else if (c === ']' || c === '}') { depth--; if (depth === 0) { try { return JSON.parse(s.slice(k, j + 1).replace(/"\$undefined"/g, 'null')) } catch { return null } } }
  }
  return null
}

// a figure as printed ("$$16.32", "58.7%", "+12.0%", "$$10,199.20"; RSC writes $ as $$) → a number
export const figure = t => { if (t == null) return null; const m = String(t).replace(/,/g, '').match(/[-+−]?\d+(\.\d+)?/); return m ? Number(m[0].replace('−', '-')) : null }

// The summary tables: each metric's label cell followed by its value cells (latest, then a month earlier;
// growth rows have one value). Reads the next cells after each label, whatever their styling.
export function tableRows(s) {
  const out = {}
  const re = /"children":"((?:Share of token spend|Share of token volume|Blended price per million tokens|Total token spending|Total token volume|AI spend per employee per month|AI share of business spend)[^"]*)"/g
  let m
  while ((m = re.exec(s))) {
    const label = m[1]
    if (out[label]) continue
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 1200), vals = []
    const cell = /\["\$","td",null,\{[^{}]*?"children":"([^"]*)"/g
    let c
    while ((c = cell.exec(after)) && vals.length < 2) { if (/\d/.test(c[1])) vals.push(c[1]); if (c.index > 900) break }
    if (vals.length) out[label] = { latest: figure(vals[0]), prior: vals.length > 1 ? figure(vals[1]) : null, text: vals }
  }
  return out
}

// the whole page → the series the panel draws
export function parsePage(raw) {
  const s = unescapePayload(raw)
  const overall = arrayAt(s, 'adoptionOverall'), vendor = arrayAt(s, 'adoptionVendor'), industry = arrayAt(s, 'adoptionIndustry'), size = arrayAt(s, 'adoptionSize')
  const spend = arrayAt(s, 'spendPerEmployee'), curated = arrayAt(s, 'spendPerEmployeeCurated')
  const shareAt = s.indexOf('"spendShareData":{')
  const shareOverall = shareAt >= 0 ? arrayAt(s, 'overall', shareAt) : null, shareSector = shareAt >= 0 ? arrayAt(s, 'sector', shareAt) : null
  if (!overall?.length) return null
  const week = (s.match(/week ending ([A-Z][a-z]+ \d{1,2}, \d{4})/) || [])[1] || null
  // total token growth is only written in prose: "Total token spending rose 12.0%. Total token volume rose 27.2%."
  const table = tableRows(s)
  for (const what of ['spending', 'volume']) {
    const g = s.match(new RegExp(`Total token ${what} (rose|fell|increased|decreased|grew|declined) (\\d+(?:\\.\\d+)?)%`))
    if (g) table[`Total token ${what}`] = { latest: (/fell|decreased|declined/.test(g[1]) ? -1 : 1) * Number(g[2]), prior: null }
  }
  return { overall, vendor, industry, size, spend, curated, shareOverall, shareSector, table, week, modified: (s.match(/"dateModified":"([^"]+)"/) || [])[1] || null }
}

const month = d => String(d).slice(0, 7)
const sizeName = v => String(v).replace(/^\d+\.\s*/, '').replace(/\s*\(.*\)$/, '')

// the parsed page → what the panel needs: monthly lines, latest cross-sections and the token table
export function shape(p) {
  const months = p.overall.map(r => month(r.date_month)), last = months.at(-1), yearAgo = months.at(-13)
  // Ramp names an industry one way in the adoption series ("Finance & Insurance", "Healthcare") and another in the
  // spend series ("Finance and Insurance", "Health Care and Social Assistance"): compare on letters, minus "and"
  const norm = n => String(n).toLowerCase().replace(/&|\band\b/g, '').replace(/[^a-z]/g, '')
  const lookup = (o, name) => { const k = norm(name); const hit = Object.keys(o).find(x => { const y = norm(x); return y.startsWith(k) || k.startsWith(y) }); return hit ? o[hit] : null }
  const byMonth = (rows, key, val = 'adoption_rate_pct') => { const o = {}; for (const r of rows || []) (o[r[key]] ||= {})[month(r.date_month || r.my_date)] = r[val]; return o }
  const vendors = byMonth(p.vendor, 'vendor'), inds = byMonth(p.industry, 'naics_sector'), sizes = byMonth(p.size, 'business_size')
  const shareSec = byMonth(p.shareSector, 'naics_sector', 'ai_share_of_tpv')
  const pepmInd = {}
  for (const r of (p.curated || []).filter(x => x.dimension_type === 'naics_sector')) (pepmInd[r.dimension_label] ||= {})[month(r.date_month)] = r.median_pepm
  const series = months.map((m, k) => ({
    m, overall: rnd(p.overall[k].adoption_rate_pct, 2),
    ...Object.fromEntries(Object.entries(vendors).map(([v, o]) => [v, rnd(o[m], 2)])),
    median: rnd(p.spend?.find(r => month(r.date_month) === m)?.median_pepm, 2),
    top10: rnd(p.spend?.find(r => month(r.date_month) === m)?.top_10_percent_median_pepm, 2),
    top1: rnd(p.spend?.find(r => month(r.date_month) === m)?.top_1_percent_median_pepm, 1),
    share: rnd((p.shareOverall?.find(r => month(r.my_date) === m)?.ai_share_of_tpv ?? NaN) * 100, 2),
  }))
  const cross = (o, extra) => Object.entries(o).map(([name, v]) => ({ name, latest: rnd(v[last], 1), yearAgo: rnd(v[yearAgo], 1), change: fin(v[last]) && fin(v[yearAgo]) ? rnd(v[last] - v[yearAgo], 1) : null, ...(extra ? extra(name) : {}) }))
    .filter(r => fin(r.latest)).sort((a, b) => b.latest - a.latest)
  return {
    asOf: last, yearAgo, series,
    vendors: Object.keys(vendors).sort((a, b) => (vendors[b][last] ?? 0) - (vendors[a][last] ?? 0)),
    bySize: cross(sizes).map(r => ({ ...r, name: sizeName(r.name) })),
    byIndustry: cross(inds, n => ({ spendShare: rnd((lookup(shareSec, n)?.[last] ?? NaN) * 100, 2), pepm: rnd(lookup(pepmInd, n)?.[last], 2) })),
  }
}

// the token table → named fields
export function tokens(table, week) {
  const pick = (prefix) => Object.entries(table).filter(([k]) => k.startsWith(prefix)).map(([k, v]) => ({ name: k.slice(prefix.length).replace(/^:\s*/, '').trim() || 'All', latest: v.latest, prior: v.prior }))
  return {
    week,
    spendShare: pick('Share of token spend'), volumeShare: pick('Share of token volume'), price: pick('Blended price per million tokens'),
    spendGrowth: table['Total token spending']?.latest ?? null, volumeGrowth: table['Total token volume']?.latest ?? null,
  }
}

export function createRampAi({ dir, fred, UA = 'econ-dashboard', now = () => Date.now() }) {
  const FILE = path.join(dir, 'ramp-ai.json')
  let store = { version: 1, page: null, fetched: 0, tokens: {} }
  try { if (fs.existsSync(FILE)) { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (d?.version === 1) store = d } } catch (e) { console.warn('ramp-ai.json:', e.message) }
  const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(store)) } catch (e) { console.error('ramp-ai.json save:', e.message) } }
  let cache = null, err = null

  async function readPage() {
    const r = await fetch(URL_PAGE, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(40000) })
    if (!r.ok) throw new Error(`Ramp answered ${r.status}`)
    const p = parsePage(await r.text())
    if (!p) throw new Error('The Ramp page no longer carries the series where expected')
    return p
  }

  // the adoption lines from FRED, when the page cannot be read
  async function fromFred() {
    const got = await Promise.all(Object.entries(FRED_IDS).map(async ([k, id]) => [k, await fred(id, 80).catch(() => [])]))
    const o = Object.fromEntries(got), months = (o.overall || []).map(x => x.d.slice(0, 7))
    if (!months.length) return null
    const at = (k, m) => o[k]?.find(x => x.d.startsWith(m))?.v ?? null
    const last = months.at(-1), yearAgo = months.at(-13)
    return { asOf: last, yearAgo, series: months.map(m => ({ m, overall: at('overall', m), OpenAI: at('OpenAI', m), Anthropic: at('Anthropic', m), xAI: at('xAI', m) })), vendors: ['Anthropic', 'OpenAI', 'xAI'],
      bySize: ['Small', 'Mid-Market', 'Large'].map(n => ({ name: n, latest: at(n, last), yearAgo: at(n, yearAgo), change: fin(at(n, last)) && fin(at(n, yearAgo)) ? rnd(at(n, last) - at(n, yearAgo), 1) : null })), byIndustry: [] }
  }

  async function get() {
    if (cache && now() - cache.ts < H) return cache.out
    if (!store.page || now() - store.fetched > 12 * H) {
      try {
        store.page = await readPage(); store.fetched = now(); err = null
        const t = tokens(store.page.table, store.page.week)
        if (t.week && t.spendShare.length) store.tokens[t.week] = t
        save()
      } catch (e) { err = String(e?.message || e).slice(0, 160); console.warn('Ramp AI Index:', err) }
    }
    let shaped = store.page ? shape(store.page) : null, source = 'Ramp AI Index page'
    if (!shaped) { shaped = await fromFred(); source = 'FRED (Ramp adoption series only)' }
    if (!shaped) throw new Error(err || 'Ramp AI Index unavailable')
    const tokenWeeks = Object.values(store.tokens).sort((a, b) => Date.parse(a.week) - Date.parse(b.week))
    const out = {
      built: new Date(now()).toISOString(), source, error: err, fetched: store.fetched ? new Date(store.fetched).toISOString() : null, modified: store.page?.modified || null,
      ...shaped, tokens: tokenWeeks.at(-1) || null, tokenHistory: tokenWeeks,
      table: store.page ? Object.fromEntries(Object.entries(store.page.table).filter(([k]) => /^AI (spend|share)/.test(k)).map(([k, v]) => [k, { latest: v.latest, prior: v.prior }])) : {},
      url: URL_PAGE, fred: Object.values(FRED_IDS),
      notes: [
        'Adoption: the share of Ramp businesses with a positive AI transaction in the month. Ramp\'s customers lean to tech-forward firms, so the level runs well above Census\'s survey; the trend and the vendor mix are the useful parts.',
        'Spend per employee: monthly AI spend divided by full-time employees, among firms paying for AI. The median firm, and the median within the top 10% and top 1%.',
        'AI share of business spend: AI vendors\' share of all card and bill-pay spend, payroll excluded.',
        'Tokens: API token spend and volume by lab for the latest week against the same week a month earlier, as Ramp publishes it; this dashboard archives each week it sees.',
      ],
    }
    cache = { ts: now(), out }
    return out
  }
  return { get }
}
