// ============================================================================
// TENSIONS: helpers shared by the check modules in ./checks. A check states
// what several sources claim, derives what those claims jointly require, and
// grades the gap. Everything here is plain arithmetic; no I/O.
// ============================================================================

export const fin = v => v != null && Number.isFinite(v)
export const r1 = v => (fin(v) ? Math.round(v * 10) / 10 : null)
export const r2 = v => (fin(v) ? Math.round(v * 100) / 100 : null)

// ── formatting (the board prints `display` strings as given) ─────────────────
export const pct = (v, dp = 1) => (fin(v) ? `${v.toFixed(dp)}%` : '—')
export const pp = (v, dp = 1) => (fin(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(dp)} pp` : '—')
export const bp = v => (fin(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.round(Math.abs(v))} bp` : '—')
export const prob = v => (fin(v) ? `${Math.round(v * 100)}%` : '—')
// 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st ...
export const ord = n => { if (!fin(n)) return '—'; const v = Math.round(n), t = v % 100; return `${v}${t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][v % 10] || 'th'}` }
export const times = (v, dp = 1) => (fin(v) ? `${v.toFixed(dp)}×` : '—')
// dollars given in billions
export const usd = (b, dp) => {
  if (!fin(b)) return '—'
  const s = b < 0 ? '−' : '', a = Math.abs(b)
  if (a >= 1000) return `${s}$${(a / 1000).toFixed(dp ?? (a >= 10000 ? 1 : 2))}T`
  if (a >= 1) return `${s}$${a.toFixed(dp ?? 0)}B`
  return `${s}$${Math.round(a * 1000)}M`
}

// asOf labels: the board prints a YYYY-MM-DD date as a day and any other string as given,
// so quarterly and annual data say which period they cover rather than its first day
export const qtr = d => (d ? `${d.slice(0, 4)} Q${Math.floor((+d.slice(5, 7) - 1) / 3) + 1}` : null)
export const mon = d => (d ? `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][+d.slice(5, 7) - 1]} ${d.slice(0, 4)}` : null)

// ── series ([{ d, v }] oldest first, as fetchFredSeries returns) ─────────────
export const last = s => (s && s.length ? s[s.length - 1] : null)
export const lastV = s => last(s)?.v ?? null
export const ago = (s, n) => (s && s.length > n ? s[s.length - 1 - n] : null)
export const sumLast = (s, n) => (s && s.length >= n ? s.slice(-n).reduce((a, x) => a + x.v, 0) : null)
export const avgLast = (s, n) => (s && s.length >= n ? sumLast(s, n) / n : null)

// ── grading ─────────────────────────────────────────────────────────────────
// gap.value is oriented so that bigger means less coherent. Under `tension` the
// claims fit together; from `tension` the circle needs squaring; from
// `contradiction` they cannot all hold at once.
export const STATUSES = ['consistent', 'tension', 'contradiction', 'unavailable']
export function grade(value, { tension, contradiction }) {
  if (!fin(value)) return 'unavailable'
  return value >= contradiction ? 'contradiction' : value >= tension ? 'tension' : 'consistent'
}

// standard normal CDF (Abramowitz-Stegun 7.1.26, error < 1.5e-7)
export function normCdf(x) {
  const t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2)
  return x >= 0 ? (1 + y) / 2 : (1 - y) / 2
}

// ── strike ladders ──────────────────────────────────────────────────────────
// A Kalshi "Above X" event is a ladder of P(outcome > strike). Prices are
// noisy, so the ladder is forced non-increasing (each strike's probability
// capped by the one below it) before buckets are read off. Returns the median
// (where the ladder crosses 50%, interpolated), the mean (bucket midpoints;
// the open tails sit half a step beyond the end strikes), the buckets and a
// pAbove(x) reader. Markets without a price or strike are skipped.
export function ladder(markets, { minVolume = 0 } = {}) {
  const rows = (markets || []).filter(m => fin(m.strike) && fin(m.p) && (m.volume ?? 0) >= minVolume).sort((a, b) => a.strike - b.strike)
  if (rows.length < 2) return null
  const pts = []
  let cap = 1
  for (const m of rows) { cap = Math.min(cap, m.p); pts.push({ k: m.strike, p: cap }) }
  const step = (pts[pts.length - 1].k - pts[0].k) / (pts.length - 1)
  const buckets = [{ lo: null, hi: pts[0].k, mid: pts[0].k - step / 2, p: 1 - pts[0].p }]
  for (let i = 0; i < pts.length - 1; i++) buckets.push({ lo: pts[i].k, hi: pts[i + 1].k, mid: (pts[i].k + pts[i + 1].k) / 2, p: pts[i].p - pts[i + 1].p })
  buckets.push({ lo: pts[pts.length - 1].k, hi: null, mid: pts[pts.length - 1].k + step / 2, p: pts[pts.length - 1].p })
  const mean = buckets.reduce((a, b) => a + b.mid * b.p, 0)
  let median = null
  if (pts[0].p < 0.5) median = pts[0].k
  else if (pts[pts.length - 1].p >= 0.5) median = pts[pts.length - 1].k
  else for (let i = 0; i < pts.length - 1; i++) if (pts[i].p >= 0.5 && pts[i + 1].p < 0.5) { const f = (pts[i].p - 0.5) / (pts[i].p - pts[i + 1].p || 1); median = pts[i].k + f * (pts[i + 1].k - pts[i].k); break }
  const pAbove = x => { if (x < pts[0].k) return null; let p = null; for (const q of pts) if (q.k <= x) p = q.p; return p }
  return { mean, median, buckets, pAbove, strikes: pts, step, volume: rows.reduce((a, m) => a + (m.volume || 0), 0) }
}
