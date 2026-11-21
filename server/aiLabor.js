// ============================================================================
// AI LABOR — AI Economy → Dark Output: are payrolls paying for AI? Three reads
// of job cuts that employers themselves tie to AI, in place of anecdote.
//
//   announced   Challenger, Gray & Christmas's monthly count of announced U.S.
//               job cuts and the part employers attributed to artificial
//               intelligence (kept by hand in data/ai/ai-layoffs.json, each
//               month with its link). Stated reasons, not measured causes: a
//               company may cite AI for cuts it would have made anyway, or
//               not cite it for cuts it caused.
//   filed       8-K filings under Item 2.05 (costs of exit or disposal
//               activities: the form a public company files for a material
//               restructuring), counted by quarter from EDGAR full-text
//               search, and how many of them mention artificial intelligence
//   payroll     AI-attributed cuts over the past 12 months times an assumed
//               loaded cost per job (the assumption is in the file), set
//               against the growth in the AI labs' revenue run-rate over the
//               same 12 months: what share of the new AI dollars could have
//               come out of payroll
//   context     all layoffs and discharges in the economy (JOLTS), so the size
//               of the announced number is plain
//
// Sources: data/ai/ai-layoffs.json (Challenger reports), EDGAR full-text
// search (efts.sec.gov; finished quarters are kept in the gitignored
// ai-restructuring.json and not asked for again), FRED JTSLDL, and the lab
// run-rates in data/ai/revenue-disclosures.json.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const H = 3600e3
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 2) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const sleep = ms => new Promise(r => setTimeout(r, ms))
const sum = xs => xs.filter(fin).reduce((s, x) => s + x, 0)

// 'YYYY-Qn' → [first day, last day]
export function quarterRange(q) {
  const [y, n] = q.split('-Q').map(Number), m0 = (n - 1) * 3
  const last = new Date(Date.UTC(y, m0 + 3, 0)).toISOString().slice(0, 10)
  return [`${y}-${String(m0 + 1).padStart(2, '0')}-01`, last]
}
export const quartersFrom = (from, today) => { const out = []; let [y, q] = from.split('-Q').map(Number); const ty = +today.slice(0, 4), tq = Math.floor((+today.slice(5, 7) - 1) / 3) + 1; while (y < ty || (y === ty && q <= tq)) { out.push(`${y}-Q${q}`); q++; if (q > 4) { q = 1; y++ } } return out }

// the months file → a clean monthly series with the AI share, trailing 12-month totals and calendar-year totals
export function monthly(months) {
  const rows = (months || []).filter(m => /^\d{4}-\d{2}$/.test(m.month)).sort((a, b) => a.month.localeCompare(b.month))
    .map(m => ({ month: m.month, total: fin(m.totalCuts) ? m.totalCuts : null, ai: fin(m.aiCuts) ? m.aiCuts : null, aiYtd: fin(m.aiYtd) ? m.aiYtd : null, share: fin(m.aiCuts) && m.totalCuts > 0 ? rnd(m.aiCuts / m.totalCuts, 4) : null, url: m.url || null, sourceType: m.sourceType || null, note: m.note || null }))
  rows.forEach((r, i) => { const w = rows.slice(Math.max(0, i - 11), i + 1); r.ai12 = w.length === 12 && w.every(x => fin(x.ai)) ? sum(w.map(x => x.ai)) : null; r.total12 = w.length === 12 && w.every(x => fin(x.total)) ? sum(w.map(x => x.total)) : null })
  return rows
}

// AI-attributed cuts in the latest year to date against the same months a year earlier
export function yearToDate(rows) {
  const last = rows.filter(r => fin(r.ai)).at(-1)
  if (!last) return null
  const y = last.month.slice(0, 4), mm = last.month.slice(5), cur = rows.filter(r => r.month.startsWith(y) && r.month <= last.month), prev = rows.filter(r => r.month.startsWith(String(+y - 1)) && r.month.slice(5) <= mm)
  const complete = s => s.length === +mm && s.every(r => fin(r.ai))
  return { through: last.month, months: cur.length, ai: complete(cur) ? sum(cur.map(r => r.ai)) : last.aiYtd, total: cur.every(r => fin(r.total)) ? sum(cur.map(r => r.total)) : null,
    aiPrior: complete(prev) ? sum(prev.map(r => r.ai)) : null, stated: last.aiYtd, summed: complete(cur) }
}

export function createAiLabor({ dir, fred, UA = 'econ-dashboard (personal research)', now = () => Date.now() }) {
  const FILE = path.join(dir, 'data', 'ai', 'ai-layoffs.json'), STORE = path.join(dir, 'ai-restructuring.json'), FROM = '2022-Q1'
  let store = { version: 1, quarters: {} }
  try { if (fs.existsSync(STORE)) { const d = JSON.parse(fs.readFileSync(STORE, 'utf8')); if (d?.version === 1) store = d } } catch { /* start afresh */ }
  let cache = null, inflight = null

  const count = async (q, start, end) => {
    const r = await fetch(`https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(q)}&forms=8-K&dateRange=custom&startdt=${start}&enddt=${end}`, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) })
    if (!r.ok) throw new Error(`EDGAR search answered ${r.status}`)
    const j = await r.json()
    return j?.hits?.total?.value ?? null
  }

  // Item 2.05 filings by quarter, and those that also mention AI; a finished quarter is asked for once
  async function filings(today) {
    const errors = [], qs = quartersFrom(FROM, today), current = qs.at(-1)
    for (const q of qs) {
      const have = store.quarters[q]
      if (have && q !== current) continue
      if (have && q === current && now() - (have.ts || 0) < 20 * H) continue
      const [start, end] = quarterRange(q)
      try {
        const all = await count('"Item 2.05"', start, end); await sleep(250)
        const ai = await count('"Item 2.05" "artificial intelligence"', start, end); await sleep(250)
        store.quarters[q] = { all, ai, ts: now() }
      } catch (e) { errors.push(`${q}: ${String(e?.message || e).slice(0, 60)}`); break }
    }
    try { fs.writeFileSync(STORE, JSON.stringify(store)) } catch (e) { console.error('ai-restructuring.json save:', e.message) }
    return { rows: qs.filter(q => store.quarters[q]).map(q => ({ q, all: store.quarters[q].all, ai: store.quarters[q].ai, share: store.quarters[q].all > 0 ? rnd(store.quarters[q].ai / store.quarters[q].all, 3) : null, partial: q === current })), errors }
  }

  async function build() {
    const file = JSON.parse(fs.readFileSync(FILE, 'utf8'))
    const today = new Date(now()).toISOString().slice(0, 10)
    const rows = monthly(file.months), ytd = yearToDate(rows), last = rows.filter(r => fin(r.ai)).at(-1) || null
    const [fil, jolts] = await Promise.all([filings(today).catch(e => ({ rows: [], errors: [String(e?.message || e)] })), fred('JTSLDL', 60).catch(() => [])])
    // layoffs and discharges across the economy, thousands a month
    const j12 = jolts.slice(-12), jAvg = j12.length ? sum(j12.map(x => x.v)) / j12.length * 1000 : null

    // payroll freed against the labs' new revenue
    const A = file.assumptions || {}, cost = A.loadedCostPerJob?.value ?? null, lo = A.loadedCostPerJob?.low ?? cost, hi = A.loadedCostPerJob?.high ?? cost
    const ai12 = last?.ai12 ?? null
    let labs = null
    try {
      const disc = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'ai', 'revenue-disclosures.json'), 'utf8')).disclosures || []
      const tOf = ym => +ym.slice(0, 4) + (+ym.slice(5, 7) - 0.5) / 12
      const per = {}
      for (const r of disc) if (fin(r.arr) && /^\d{4}-\d{2}$/.test(r.d) && A.labs?.includes?.(r.co) !== false) (per[r.co] ||= []).push({ d: r.d, t: tOf(r.d), v: r.arr })
      const used = Object.entries(per).filter(([co]) => !A.labs || A.labs.includes(co)).map(([co, p]) => {
        p.sort((a, b) => a.t - b.t)
        const l = p.at(-1), from = [...p].reverse().find(x => l.t - x.t >= 0.75)
        return from ? { co, now: l.v, nowAt: l.d, then: from.v, thenAt: from.d, perYear: (l.v - from.v) / (l.t - from.t) } : null
      }).filter(Boolean)
      if (used.length) labs = { rows: used.map(u => ({ ...u, perYear: rnd(u.perYear, 1) })), addedPerYear: rnd(sum(used.map(u => u.perYear)), 1) }
    } catch { /* no lab file: the comparison is left out */ }
    const freed = v => (fin(ai12) && fin(v) ? rnd((ai12 * v) / 1e9, 2) : null)
    const payroll = fin(ai12) && fin(cost) ? { jobs: ai12, through: last.month, cost, low: lo, high: hi, usdBn: freed(cost), lowBn: freed(lo), highBn: freed(hi), labs,
      shareOfNewRevenue: labs?.addedPerYear > 0 ? rnd(freed(cost) / labs.addedPerYear, 3) : null, why: A.loadedCostPerJob?.why || null } : null

    return {
      built: new Date(now()).toISOString(), reviewed: file.reviewed || null, months: rows, years: file.years || [], latest: last, ytd,
      filings: fil.rows, payroll, jolts: fin(jAvg) ? { monthlyAvg: Math.round(jAvg), asOf: jolts.at(-1)?.d?.slice(0, 7), aiShare: fin(ai12) ? rnd(ai12 / (jAvg * 12), 4) : null } : null,
      errors: fil.errors, definition: file.notes || null,
      notes: [
        'Announced cuts are Challenger, Gray & Christmas\'s tally of what U.S. employers announce, by the reason the employer gives. They are plans, not separations, and the reason is the employer\'s own.',
        'Item 2.05 of Form 8-K is where a public company reports a material restructuring. The count is of filings whose text carries the item, from EDGAR full-text search; "mention AI" means the phrase "artificial intelligence" appears anywhere in the filing, which is a loose test.',
        'Payroll freed is AI-attributed cuts over the past 12 months times an assumed loaded cost per job. It is an upper bound on what those cuts could fund in a year: announced cuts are not all carried out, and not all the savings are spent on AI.',
        'New AI revenue is the rise in the labs\' annualised run-rate over roughly the same year, from their own disclosures. It leaves out what companies spend on AI through clouds and software vendors.',
      ],
      source: 'Challenger, Gray & Christmas monthly job-cut reports (hand-kept, linked); EDGAR full-text search; BLS JOLTS via FRED; lab disclosures on file',
    }
  }

  async function get() {
    if (cache && now() - cache.ts < 3 * H) return cache.out
    if (!inflight) inflight = build().then(out => { cache = { ts: now(), out }; return out }).finally(() => { inflight = null })
    return inflight
  }
  return { get }
}
