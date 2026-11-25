// ============================================================================
// OPENROUTER RANKINGS ARCHIVE — how rankings-history.json is merged and read.
//
// The source. openrouter.ai/api/frontend/v1/rankings/models returns one row
// per model VARIANT ('standard', 'batch', 'free', now and then 'thinking'),
// not one per model: about 90 of ~600 models have more than one. Each row is
// a trailing-7-day total (?view=day is 24 hours, ?view=month 30 days). `date`
// is the row's own date, the last day that variant was used, not the day it
// was captured, so a response is mostly today's rows plus a few stragglers
// dated up to a week back.
//
// The merge. Rows are keyed `${date}|${model_permaslug}|${variant}`. Rows
// dated today replace what is stored; rows for any other date are added only
// if that key is absent.
//
// The bug this module exists for. Until 24 November 2026 the key had no
// variant in it, so the variants of one model overwrote each other and one
// survived per date: the last in the response for today's rows, the first for
// other dates. Which one was arbitrary. A model whose main variant lost is
// stored at a sliver of its volume (the largest model at ~0.05T instead of
// ~70T), and per-date totals swing by half from one day to the next. The rows
// that lost were never written, so the file cannot be repaired. It is left as
// captured.
//
// What readers get instead (fillLegacyVariants). The archive records the first
// date written with the variant in the key (`variantKeyedFrom`); complete
// snapshots before it are "legacy". Because the surviving variant alternated,
// each variant of a model has its own stored rows scattered across the legacy
// dates. On a legacy date, every variant the model is known to have (from any
// date in the archive) but that is missing that day is estimated from that
// variant's own stored rows on other days:
//   - a stored row before and one after: every count is interpolated in a
//     straight line over time between the two (trailing-week totals move slowly);
//   - a stored row on one side only: it is carried over if it is within 7 days,
//     the length of the window each row sums; further away the variant is left
//     out, because it may not have existed yet or any more.
// Estimated rows carry `filled` ('interpolated' or 'carried') and `filledFrom`,
// are appended to the rows handed to readers, and are never written to the
// file. Dates from `variantKeyedFrom` on are served exactly as stored.
//
// What that does not fix. A variant that never once survived before the fix is
// unknown to the archive and stays missing. A model's first week is overstated
// when its main variant is carried back from a later day. Interpolation flattens
// real day-to-day moves, so a legacy date is good for levels and week-scale
// trends, not for one-day changes.
//
// For readers: a date has several rows per model. Sum by model_permaslug for a
// per-model figure, and count models, not rows.
// ============================================================================

const DAY = 864e5
const iso10 = d => String(d || '').slice(0, 10)
export const variantOf = r => r.variant || 'standard'
export const rankKey = (date, r) => `${date}|${r.model_permaslug}|${variantOf(r)}`

// archive rows + one live response → the rows to store, and the date the response is mostly about
export function mergeRankings(archiveRows, fresh, { today, normDate = iso10 } = {}) {
  const merged = new Map()
  for (const row of archiveRows || []) {
    const d = normDate(row.date)
    if (!d || !row.model_permaslug || row.filled) continue          // an estimate is never stored
    merged.set(rankKey(d, row), { ...row, date: d })
  }
  let added = 0, updatedToday = 0
  const tally = new Map()
  for (const row of fresh || []) {
    const d = normDate(row.date)
    if (!d || !row.model_permaslug) continue
    tally.set(d, (tally.get(d) || 0) + 1)
    const key = rankKey(d, row), existed = merged.has(key)
    // today: the latest reading replaces the earlier one. Any other date: the archive stands, new keys are added.
    if (d === today || !existed) { merged.set(key, { ...row, date: d }); if (existed) updatedToday++; else added++ }
  }
  const rows = [...merged.values()].sort((a, b) => a.date.localeCompare(b.date))
  const mainDate = [...tally].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]))[0]?.[0] || null
  return { rows, added, updatedToday, mainDate }
}

// dates holding a whole snapshot: at least 60% as many models as the fullest date (the rest are stragglers)
export function completeDates(rows) {
  const by = new Map()
  for (const r of rows || []) { const s = by.get(r.date) || new Set(); s.add(r.model_permaslug); by.set(r.date, s) }
  const max = Math.max(0, ...[...by.values()].map(s => s.size))
  return [...by.keys()].filter(d => by.get(d).size >= 0.6 * max).sort()
}

const between = (lo, hi, t) => {
  const w = (t - lo.t) / (hi.t - lo.t), out = {}
  for (const k of new Set([...Object.keys(lo.row), ...Object.keys(hi.row)])) {
    const a = lo.row[k], b = hi.row[k]
    if (typeof a === 'number' || typeof b === 'number') out[k] = Math.round((a || 0) + ((b || 0) - (a || 0)) * w)
  }
  return out
}

// stored rows → stored rows plus an estimate for each variant a legacy date lost (see the header)
export function fillLegacyVariants(rows, { keyedFrom = null, carryDays = 7 } = {}) {
  const complete = new Set(completeDates(rows))
  const series = new Map(), onDate = new Map()
  for (const r of rows || []) {
    if (r.filled) continue
    const vs = series.get(r.model_permaslug) || new Map(), v = variantOf(r)
    const pts = vs.get(v) || []; pts.push({ t: Date.parse(r.date), row: r }); vs.set(v, pts); series.set(r.model_permaslug, vs)
    const slugs = onDate.get(r.date) || new Map(); const have = slugs.get(r.model_permaslug) || new Set(); have.add(v); slugs.set(r.model_permaslug, have); onDate.set(r.date, slugs)
  }
  for (const vs of series.values()) for (const pts of vs.values()) pts.sort((a, b) => a.t - b.t)
  const extra = [], models = new Set(), dates = new Set()
  let interpolated = 0, carried = 0
  for (const [d, slugs] of onDate) {
    if (!complete.has(d) || (keyedFrom && d >= keyedFrom)) continue
    const t = Date.parse(d)
    for (const [slug, have] of slugs) {
      const vs = series.get(slug)
      if (vs.size < 2) continue
      for (const [v, pts] of vs) {
        if (have.has(v)) continue
        let lo = null, hi = null
        for (const p of pts) { if (p.t < t) lo = p; else if (p.t > t) { hi = p; break } }
        const one = lo || hi
        let row = null
        if (lo && hi) { row = { ...lo.row, ...between(lo, hi, t), date: d, filled: 'interpolated', filledFrom: [lo.row.date, hi.row.date] }; interpolated++ }
        else if (one && Math.abs(one.t - t) <= carryDays * DAY) { row = { ...one.row, date: d, filled: 'carried', filledFrom: [one.row.date] }; carried++ }
        if (row) { extra.push(row); models.add(slug); dates.add(d) }
      }
    }
  }
  const out = extra.length ? [...(rows || []), ...extra].sort((a, b) => a.date.localeCompare(b.date)) : rows || []
  return { rows: out, filled: { rows: extra.length, interpolated, carried, models: models.size, dates: dates.size } }
}
