// ============================================================================
// AI REVENUE: does AI revenue keep up with the capex?
// A live version of David Cahn's (Sequoia) "$600B question". SemiAnalysis
// forecasts $11.1T of cumulative AI capex over 2024-29. Every chip, building
// and power line that money buys must earn back its cost plus a return in each
// year it is in service, and whoever sells AI to the end customer needs a
// gross margin on top of the compute it rents. Together those set the AI
// revenue the world needs in 2029. The need is set against the AI revenue
// actually disclosed (OpenAI and Anthropic run-rates, standing in for all AI
// revenue) and the pace it grew over the year to the newest disclosure.
// Gap = the compound growth rate the need requires, from the newest disclosure
// to mid-2029, ÷ the compound growth rate disclosed revenue showed over the
// year before it (log rates, so the ratio also reads as "years needed at the
// past year's pace ÷ years left").
// Under 0.5 the need is met even if the compound growth rate halves, which
// leaves room for the slowdown that comes with scale: the claims fit.
// From 0.5 most of the past year's pace has to hold for years: the circle
// needs squaring.
// At 1 or more revenue has to grow faster than it did in the past year, every
// year to 2029, with no slowdown as it scales. That is possible in principle
// but runs against how fast-growing revenue behaves, so the capex forecast and
// the revenue trend are read as unable to both hold.
// Inputs: data/ai/ai-debt.json (the forecast), hyperscaler-capex.json (SEC
// filings, to shape the yearly path), data/ai/gpu-econ.json (lives, power
// costs), data/ai/intelligence-mw.json (server power factor), the capexReturns
// feed (cost of capital, hyperscaler returns and revenue),
// data/ai/revenue-disclosures.json and src/data/labRevenueTracker.json
// (revenue, capacity), Polymarket.
// ============================================================================
import { fin, usd, pct, prob, times, grade, mon, qtr } from '../lib.js'
import { YEARS, IT_SHARE, POWER_GEAR_SHARE, calendarCapex, capexPath, trailingCapex, pathAt as pathFlow } from '../aiCapexPath.js'

// McKinsey's split of AI data-centre capex (IT_SHARE, POWER_GEAR_SHARE) and the yearly path live in
// ../aiCapexPath.js, shared with the AI power check.
// The same report's central case for AI data-center capex over 2025-30, $B: a second forecast to set
// SemiAnalysis's against.
const MCKINSEY_AI_CAPEX = 5200
// Buildings, power and cooling outlast several chip generations. 20 years is an assumption,
// not a filing; at 15 or 30 years the 2029 need moves by about 3%.
const FACILITY_LIFE = 20
// Cahn, "AI's $600B Question" (Sequoia, June 2024): the seller of AI to the end customer
// needs a gross margin over the compute it rents; he used 50%, so revenue = 2 × compute cost.
const CAHN_MARGIN = 0.5
// Used only when the capex-returns feed fails: the cost of capital that feed reports
// (Mauboussin and Callahan use 8% for the hyperscalers).
const WACC_FALLBACK = 8
// Microsoft, FY2025 Q2 earnings (29 January 2025): its AI business passed a $13B annual revenue
// run-rate, up 175% year over year, i.e. 2.75× a year. The one disclosed growth rate for AI revenue
// outside the two labs, used to show what slower-growing uncounted revenue does to the gap.
const MSFT_AI_GROWTH = 2.75
// An illustration, not an estimate: a true AI revenue base this many times the labs' disclosed run-rate.
const BROAD_BASE = 3
// Polymarket markets with less than this traded (lifetime, $) are ignored as too thin to read.
const MIN_VOLUME = 20000
// Revenue earned over calendar 2029 is converted to the run-rate it needs by mid-2029.
const HORIZON = 2029.5
// A company whose newest disclosure is older than another's is carried forward at its own pace over its
// last year of disclosures, for at most this many years, so one company's fresh row moves the common
// date. Six months keeps the extrapolation short; past that the common date waits for the stale company.
const CARRY = 0.5
// The gap when disclosed revenue did not grow at all: no pace reaches the need.
const GAP_CAP = 10

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const tOf = ym => +ym.slice(0, 4) + (+ym.slice(5, 7) - 0.5) / 12 // 'YYYY-MM' → fractional year, mid-month
const tDay = d => +d.slice(0, 4) + (+d.slice(5, 7) - 1 + (+d.slice(8, 10) - 0.5) / 30.44) / 12 // 'YYYY-MM-DD' → fractional year
const tLabel = t => { const y = Math.floor(t + 1e-9); return `${MONTHS[Math.min(11, Math.max(0, Math.round((t - y) * 12 - 0.5)))]} ${y}` }
const crf = (r, n) => r / (1 - (1 + r) ** -n) // level yearly payment that repays $1 plus r a year over n years
// share of calendar `year` a vintage spends in service: bought evenly through year v (in service from
// mid-v on average) and retired `life` years later
const inService = (v, life, year = 2029) => Math.max(0, Math.min(year + 1, v + 0.5 + life) - Math.max(year, v + 0.5))
// a company's run-rate at time t, log-linear between disclosures
const runRateAt = (rows, t) => {
  if (!rows.length || t < rows[0].t - 1e-6 || t > rows[rows.length - 1].t + 1e-6) return null
  for (let i = 0; i < rows.length; i++) {
    if (Math.abs(rows[i].t - t) < 1e-6) return rows[i].v
    if (rows[i].t < t && rows[i + 1]?.t > t) { const a = rows[i], b = rows[i + 1]; return a.v * (b.v / a.v) ** ((t - a.t) / (b.t - a.t)) }
  }
  return null
}
// a company's own yearly pace over its last year of disclosures (or its whole history if shorter)
const paceOf = rows => {
  const l = rows[rows.length - 1], from = Math.max(rows[0].t, l.t - 1), v0 = runRateAt(rows, from)
  return v0 > 0 && l.t - from > 1e-6 ? (l.v / v0) ** (1 / (l.t - from)) : null
}
// run-rate at t: between disclosures as above; past the newest, carried forward at the company's own
// pace for at most CARRY years; never before the first disclosure
const valueAt = (rows, t) => {
  const l = rows[rows.length - 1]
  if (t <= l.t + 1e-6) return runRateAt(rows, t)
  const g = paceOf(rows)
  return t - l.t <= CARRY + 1e-6 && fin(g) ? l.v * g ** (t - l.t) : null
}
// a year's revenue on a path growing g a year is its mid-year run-rate × sinh(r/2) ÷ (r/2), r = ln g
const yearFactor = g => { const r = Math.log(g); return Math.abs(r) < 1e-9 ? 1 : Math.sinh(r / 2) / (r / 2) }
// a Polymarket end time (11:59 PM ET, stored as the next day in UTC) → 'Jun 30, 2027'
const endLabel = iso => { const d = new Date(Date.parse(iso) - 6 * 3600e3).toISOString().slice(0, 10); return `${MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}, ${d.slice(0, 4)}` }
const median = xs => { const s = xs.filter(fin).sort((a, b) => a - b); return s.length ? (s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : null }
const list = (xs, word = 'and') => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${word} ${xs[xs.length - 1]}`)
const vol = v => (v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1000)}k`)
const article = n => (/^(8\d*|11|18)$/.test(String(Math.round(n))) ? 'An' : 'A')


// What the fleet in service during `year` must earn: capital recovery on chips and servers (life
// `life`) and on buildings and power gear (FACILITY_LIFE), plus electricity; then the revenue that
// pays that rent with `margin` left for the seller.
function needIn(year, { path, life, r, margin, powerShare }) {
  let it = 0, fac = 0, power = 0, itLive = 0
  for (const v of YEARS) {
    const c = path[v] || 0, itOn = inService(v, life, year), facOn = inService(v, FACILITY_LIFE, year)
    itLive += c * IT_SHARE * itOn
    it += c * IT_SHARE * crf(r, life) * itOn
    fac += c * (1 - IT_SHARE) * crf(r, FACILITY_LIFE) * facOn
    power += c * IT_SHARE * powerShare * itOn
  }
  const rent = it + fac + power
  return { it, fac, power, rent, itLive, revenue: rent / (1 - margin) }
}

// One Polymarket event: its open markets with enough volume, earliest end first. With `rewards`,
// the raw event is also read for Polymarket's holding-reward flag, which the normalized shape omits.
async function event(ctx, slug, { pick = () => true, rewards = false } = {}) {
  try {
    const [e, raw] = await Promise.all([
      ctx.markets.polymarket(slug),
      rewards ? ctx.fetchJson(`https://gamma-api.polymarket.com/events?slug=${encodeURIComponent(slug)}`).catch(() => null) : null,
    ])
    const flag = new Map((Array.isArray(raw) ? raw[0]?.markets || [] : []).map(m => [m.question, m.holdingRewardsEnabled === true]))
    const ok = e.markets.filter(m => !m.closed && fin(m.yes) && (m.volume ?? 0) >= MIN_VOLUME && pick(m))
      .sort((a, b) => String(a.ends).localeCompare(String(b.ends)))
      .map(m => ({ ...m, by: m.ends ? endLabel(m.ends) : m.label, rewards: flag.has(m.question) ? flag.get(m.question) : null }))
    return ok.length ? { title: e.title, url: e.url, markets: ok } : { missing: `${e.title}: no open market with $${MIN_VOLUME / 1000}k or more traded` }
  } catch (err) {
    return { missing: `${slug}: ${err.message}` }
  }
}

export default {
  id: 'ai-revenue',
  domain: 'ai',
  order: 2,
  title: 'Does AI revenue keep up with the capex?',
  question: 'Can AI revenue grow fast enough to earn a return on the AI build-out forecast to 2029?',
  see: 'Charts: Compute → Capex returns (this tab); Models & Labs → Lab revenue per gigawatt; Pulse → The Chain (disclosed run-rates).',
  async compute(ctx) {
    const debt = ctx.json('data/ai/ai-debt.json')
    const hc = ctx.json('hyperscaler-capex.json')
    const gpuEcon = ctx.json('data/ai/gpu-econ.json')
    const imw = ctx.json('data/ai/intelligence-mw.json')
    const disclosures = ctx.json('data/ai/revenue-disclosures.json').disclosures || []
    const tracker = ctx.json('src/data/labRevenueTracker.json')
    // bankruptcy markets: the latest one ending by the check's 2029 horizon
    const by2029 = m => String(m.ends) <= '2030-01-31'
    const [cr, bust, ...bkEvents] = await Promise.all([
      ctx.source('capexReturns').catch(e => ({ error: e.message })),
      event(ctx, 'ai-bubble-burst-by'),
      event(ctx, 'openai-announces-bankruptcy-by', { pick: by2029, rewards: true }),
      event(ctx, 'anthropic-announces-bankruptcy-by', { pick: by2029, rewards: true }),
    ])

    // ── the build-out ──
    const F = debt.forecast, total = F.cumulativeCapex2024to2029
    const { actual } = calendarCapex(hc)
    // the trailing four quarters on the window every AI card shares (../aiCapexPath.js)
    const tc = trailingCapex(hc)
    const hcEnd = tc?.end ?? null, last4 = tc?.capex ?? 0, per = tc?.per || {}
    const offset = (tc?.offset || []).map(o => `${o.name}'s fiscal quarters to ${mon(o.end)}`)
    const metaShare = last4 && fin(per.META) ? (per.META / last4) * 100 : null
    const { path, g, known } = capexPath(total, actual)
    const pathAt = m => pathFlow(path, m)
    const pathMid = tc ? pathAt(tc.mid) : null

    // ── what capital costs and how long it lasts ──
    const waccPct = fin(cr?.wacc) ? cr.wacc : WACC_FALLBACK
    const r = waccPct / 100
    const lives = (gpuEcon.assumptions?.lives || [3, 5, 6]).slice().sort((a, b) => a - b)
    const life = median(lives)
    const A = gpuEcon.assumptions || {}, sysF = imw.assumptions?.systemFactor || { box: 1.8, rack: 1.4 }
    // yearly electricity as a share of server cost, for the chips launched in the build-out years
    const powerRows = Object.entries(gpuEcon.gpus || {}).filter(([, x]) => x.launch >= '2024' && x.tdpW && x.capexPerGpu).map(([k, x]) => {
      const f = sysF[imw.chips?.[k]?.system] ?? sysF.box
      return { k, name: x.name, share: (x.tdpW * f * A.pue * 8760 * A.electricityUsdPerKwh * A.utilization) / 1000 / x.capexPerGpu }
    })
    const powerShare = median(powerRows.map(x => x.share)) ?? 0
    const powerRef = powerRows.slice().sort((a, b) => a.share - b.share)[Math.floor(powerRows.length / 2)]

    const base = { path, r, powerShare }
    const central = needIn(2029, { ...base, life, margin: CAHN_MARGIN })
    const grid = lives.map(L => ({ L, cost: needIn(2029, { ...base, life: L, margin: 0 }), cahn: needIn(2029, { ...base, life: L, margin: CAHN_MARGIN }) }))
    const lo = Math.min(...grid.map(x => x.cost.revenue)), hi = Math.max(...grid.map(x => x.cahn.revenue))
    const half = capexPath(total / 2, actual)
    const needHalf = needIn(2029, { path: half.path, r, powerShare, life, margin: CAHN_MARGIN }).revenue
    const needLong = needIn(2029, { ...base, life: lives[lives.length - 1], margin: CAHN_MARGIN }).revenue
    const needAtCost = needIn(2029, { ...base, life, margin: 0 }).revenue

    // ── what AI revenue is, and how fast it grew ──
    const byCo = {}
    for (const x of disclosures) if (fin(x.arr) && /^\d{4}-\d{2}$/.test(x.d || '')) (byCo[x.co] ||= []).push({ t: tOf(x.d), v: x.arr, d: x.d, approx: !!x.approx, src: x.src })
    Object.values(byCo).forEach(rows => rows.sort((a, b) => a.t - b.t))
    const lastT = rows => rows[rows.length - 1].t
    const latestT = Math.max(...Object.values(byCo).map(lastT))
    // the trend set: companies with two or more disclosures, the latest within a year of the newest
    const multi = Object.entries(byCo).filter(([, rows]) => rows.length >= 2)
    const newest = multi.length ? Math.max(...multi.map(([, rows]) => lastT(rows))) : null
    let trend = multi.filter(([, rows]) => lastT(rows) >= newest - 1 - 1e-6)
    // the common date: the newest disclosure, unless a company would be carried forward more than CARRY
    const commonDate = set => Math.min(Math.max(...set.map(([, rows]) => lastT(rows))), ...set.map(([, rows]) => lastT(rows) + CARRY))
    let t1 = trend.length ? commonDate(trend) : null
    // a window back up to a year that every company covers (at least six months)
    trend = trend.filter(([, rows]) => rows[0].t <= t1 - 0.5 + 1e-6)
    if (trend.length) t1 = commonDate(trend)
    const t0 = trend.length ? Math.max(t1 - 1, ...trend.map(([, rows]) => rows[0].t)) : null
    const win = fin(t0) ? t1 - t0 : null
    const others = Object.entries(byCo).filter(([co]) => !trend.some(([c]) => c === co))
    const coRows = trend.map(([co, rows]) => {
      const now = valueAt(rows, t1), then = valueAt(rows, t0), latest = rows[rows.length - 1]
      return { co, rows, now, then, latest, carried: t1 - latest.t, g: now > 0 && then > 0 && win > 0 ? (now / then) ** (1 / win) : null }
    })
    const level = coRows.reduce((a, x) => a + x.now, 0), level0 = coRows.reduce((a, x) => a + x.then, 0)
    const gObs = level0 > 0 && win > 0 ? (level / level0) ** (1 / win) : null
    const names = list(coRows.map(x => x.co))

    if (!coRows.length || !fin(gObs) || !(level > 0)) {
      return { status: 'unavailable', asOf: qtr(hcEnd), headline: 'No company in data/ai/revenue-disclosures.json has two run-rate disclosures to measure growth from.' }
    }

    // ── the gap ──
    const T = HORIZON - t1
    const ahead = HORIZON - tDay(ctx.today)
    const ageMo = Math.round((tDay(ctx.today) - t1) * 12)
    const grows = gObs > 1
    // calendar-2029 revenue → the mid-2029 run-rate that delivers it on a constant-growth path from `lvl`
    const rrFor = (rev, lvl) => { let rr = rev; for (let i = 0; i < 30; i++) rr = rev / yearFactor((rr / lvl) ** (1 / T)); return rr }
    const gapAt = (rev, lvl = level, gr = gObs) => (gr > 1 ? Math.max(0, Math.log(rrFor(rev, lvl) / lvl) / Math.log(gr) / T) : rrFor(rev, lvl) > lvl ? GAP_CAP : 0)
    const multFor = (rev, lvl = level) => (rrFor(rev, lvl) / lvl) ** (1 / T)
    const rrNeed = rrFor(central.revenue, level)
    const needMult = multFor(central.revenue)
    const yrsNeeded = grows ? Math.log(rrNeed / level) / Math.log(gObs) : null
    const ratio = gapAt(central.revenue)
    const onTrend = level * gObs ** T
    // growth that starts at the past year's pace and whose compound rate halves each year
    const halved = grows ? (() => { let lg = 0, a = Math.log(gObs), left = T; while (left > 1e-9) { const s = Math.min(1, left); lg += a * s; a /= 2; left -= s } return level * Math.exp(lg) })() : null
    // the multiple of disclosed revenue that, growing at the labs' pace, brings the gap to `target`
    const kFor = target => {
      if (!grows) return null
      let a = Math.log(1e-3), b = Math.log(1e5)
      for (let i = 0; i < 100; i++) { const m = (a + b) / 2; if (gapAt(central.revenue, level * Math.exp(m)) > target) a = m; else b = m }
      return Math.exp((a + b) / 2)
    }
    const kFit = kFor(0.5), kTrend = kFor(1)
    // uncounted revenue `extra` at t1 that grows `gx` a year: it raises the level and lowers the measured growth
    const gapMix = (extra, gx) => { const l1 = level + extra, l0 = level0 + extra / gx ** win; return gapAt(central.revenue, l1, (l1 / l0) ** (1 / win)) }
    const msftRow = others.map(([co, rows]) => ({ co, rows, ...rows[rows.length - 1] })).find(x => /microsoft/i.test(x.co))
    const msft = msftRow && msftRow.rows.length === 1 && t1 - msftRow.t >= 0 && t1 - msftRow.t <= 1.5 ? { ...msftRow, now: msftRow.v * MSFT_AI_GROWTH ** (t1 - msftRow.t) } : null
    const gapMsft = msft && grows ? gapMix(msft.now, MSFT_AI_GROWTH) : null
    const gapBroad = gapAt(central.revenue, level * BROAD_BASE, MSFT_AI_GROWTH)
    const gapHi = gapAt(hi), gapLong = gapAt(needLong), gapCost = gapAt(needAtCost), gapHalf = gapAt(needHalf)
    coRows.forEach(x => { x.gap = fin(x.g) ? gapAt(central.revenue, level, x.g) : null })
    const status = grade(ratio, { tension: 0.5, contradiction: 1 })
    // a gap that prints as 1.00× but grades just under the line is called out, so the reader is not left guessing
    const onLine = v => fin(v) && v < 1 && times(v, 2) === times(1, 2)
    const gapWord = v => `gap ${times(v, 2)}${v >= 1 ? ', a contradiction' : onLine(v) ? ', on the contradiction line' : ''}`
    const gx = v => (grows && fin(v) ? ` (${gapWord(v)})` : '') // after a figure
    const gxi = v => (grows && fin(v) ? `; ${gapWord(v)}` : '') // inside parentheses already open

    // how close to the contradiction line, and which single change would cross it
    const scen = [
      { label: `${lives[0]}-year chips`, v: gapHi },
      { label: `${lives[lives.length - 1]}-year chips`, v: gapLong },
      { label: 'no seller margin', v: gapCost },
      { label: 'a build half the size', v: gapHalf },
      ...(coRows.length > 1 ? coRows.map(x => ({ label: `both labs growing at ${x.co}'s ${times(x.g)} a year`, v: x.gap })) : []),
      { label: `all AI revenue on a base ${BROAD_BASE}× the labs' growing at Microsoft's ${times(MSFT_AI_GROWTH, 2)}`, v: gapBroad },
    ]
    const near = grows && Math.abs(ratio - 1) < 0.1
    const flips = scen.filter(s => fin(s.v) && (s.v >= 1) !== (ratio >= 1))
    const touches = ratio < 1 ? scen.filter(s => onLine(s.v)) : []
    const nearText = !near ? '' : ` ${ratio < 1 ? 'Just under' : 'Just over'} the contradiction line${flips.length || touches.length ? ': ' : '.'}${flips.length ? `it ${ratio < 1 ? 'crosses' : 'drops back under'} with ${list(flips.map(s => `${s.label} (${times(s.v, 2)})`), 'or')}` : ''}${touches.length ? `${flips.length ? ', and ' : 'it '}reaches it with ${list(touches.map(s => `${s.label} (${times(s.v, 2)})`), 'or')}` : ''}${flips.length || touches.length ? '.' : ''}`

    // ── checkpoints on the way ──
    const yNow = +ctx.today.slice(0, 4)
    let tCheck = yNow + 11.5 / 12
    if (tCheck <= t1) tCheck += 1
    const needAtCheck = level * needMult ** (tCheck - t1)
    // earlier years' rent, against the revenue the needed path brings in that year
    const early = [2026, 2027, 2028].filter(y => y + 0.5 > t1).map(y => ({ y, need: needIn(y, { ...base, life, margin: CAHN_MARGIN }).revenue, onPath: level * needMult ** (y + 0.5 - t1) * yearFactor(needMult) }))
    // lab capacity and revenue per megawatt (src/data/labRevenueTracker.json; $M per MW = $B per GW)
    const curYm = ctx.today.slice(0, 7)
    const perMw = coRows.map(x => {
      const obs = tracker.filter(o => o.entity === x.co && fin(o.deployed_gw)).sort((a, b) => a.date.localeCompare(b.date))
      const dep = obs.filter(o => o.date <= curYm).pop(), plan = obs.filter(o => o.date > curYm).pop()
      if (!dep) return null
      const rev = valueAt(x.rows, tOf(dep.date))
      return fin(rev) ? { co: x.co, gw: dep.deployed_gw, date: dep.date, rev, plan: plan?.deployed_gw ?? null, planDate: plan?.date ?? null } : null
    }).filter(Boolean)
    const gwNow = perMw.reduce((a, x) => a + x.gw, 0), revMw = gwNow ? perMw.reduce((a, x) => a + x.rev, 0) / gwNow : null
    const gwPlan = perMw.length && perMw.every(x => fin(x.plan)) ? perMw.reduce((a, x) => a + x.plan, 0) : null
    const bestMw = tracker.filter(o => fin(o.rev_per_mw_millions) && o.entity !== 'benchmark').sort((a, b) => a.date.localeCompare(b.date)).pop()

    // ── today's returns on the capex already spent ──
    const crHead = cr?.headline?.combinedLatest
    const roiic = fin(crHead?.roiic) ? crHead.roiic : null
    const hsRevenue = fin(crHead?.revenue) ? crHead.revenue / 1e9 : null

    // ── markets ──
    const bustMk = bust.missing ? [] : bust.markets
    const bustDeep = bustMk.slice().sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))[0]
    const bkRows = bkEvents.map((e, i) => ({ co: ['OpenAI', 'Anthropic'][i], e, m: e.missing ? null : e.markets[e.markets.length - 1] }))
    const bkOk = bkRows.filter(x => x.m), bkMissing = bkRows.filter(x => !x.m)
    const bkBy = [...new Set(bkOk.map(x => x.m.by))]
    const bkRewards = bkOk.length && bkOk.every(x => x.m.rewards === true)
    const markets = [
      bustMk.length ? { label: `AI industry downturn by ${list(bustMk.map(m => m.by), 'or')}`, display: bustMk.map(m => prob(m.yes)).join(' / '), kind: 'market', source: 'Polymarket', asOf: ctx.today, note: `Yes needs three of six stress events within one 90-day window: Nvidia down 50% from its high, the SOXX chip ETF down 40%, OpenAI or Anthropic bankrupt, OpenAI acquired, H100 rent at $1 an hour or less, or a big supplier down 50%; ${list(bustMk.map(m => `${vol(m.volume)} traded on the ${m.by} market`))}` } : null,
      bkOk.length ? { label: `Lab announces bankruptcy by ${list(bkBy, '/')}`, display: bkOk.map(x => `${x.co} ${prob(x.m.yes)}`).join(', '), kind: 'market', source: 'Polymarket', asOf: ctx.today, note: `${bkRewards ? 'Polymarket pays a holding reward on these markets that roughly offsets the interest a No holder gives up by locking money away for years, so the prices can be read close to face value' : 'with money locked away for years, a long-dated Yes price can sit above the true odds, since No holders give up the interest'}; ${list(bkOk.map(x => `${vol(x.m.volume)} traded on ${x.co}`))}${bkMissing.length ? `; ${list(bkMissing.map(x => x.co))} could not be read this run` : ''}` } : null,
    ].filter(Boolean)
    const dropped = [bust, ...bkEvents].filter(m => m.missing).map(m => m.missing)

    const lastKnown = known[known.length - 1]
    const pathText = YEARS.filter(y => y > (lastKnown ?? 2023)).map(y => `${y} ${usd(path[y])}`).join(', ')
    const tail = !grows
      ? 'but disclosed revenue did not grow over the past year, so no pace gets there'
      : ratio >= 1
        ? 'so it has to grow faster than it did, every year to 2029'
        : ratio >= 0.5
          ? `so ${ratio >= 0.85 ? 'almost all' : 'most'} of that pace has to hold for ${T.toFixed(1)} years`
          : 'so growth can slow by more than half and still get there'
    const hcCmp = fin(pathMid) ? last4 / pathMid : null
    const cmpText = !fin(hcCmp) ? '' : Math.abs(hcCmp - 1) < 0.05 ? `in line with the ${usd(pathMid)} the fitted path gives for the same twelve months` : `${pct(Math.abs(1 - hcCmp) * 100, 0)} ${hcCmp < 1 ? 'below' : 'above'} the ${usd(pathMid)} the fitted path gives for the same twelve months`
    const retiresHalf = 2029 - life >= YEARS[0] ? ` and, with ${life}-year chips, the ${2029 - life} vintage retires mid-2029, so it also counts half` : ''
    const msftText = msft && fin(gapMsft)
      ? ` Microsoft's AI business, carried forward from ${usd(msft.v)} in ${tLabel(msft.t)} at the ${times(MSFT_AI_GROWTH, 2)} a year it disclosed (about ${usd(msft.now)} by ${tLabel(t1)} if that pace held), ${msft.now >= level ? 'more than doubles' : `adds ${pct((msft.now / level) * 100, 0)} to`} the base ${Math.abs(gapMsft - ratio) < 0.05 ? `yet leaves the gap at ${times(gapMsft, 2)}` : `and moves the gap to ${times(gapMsft, 2)}`}.`
      : ''

    return {
      status,
      asOf: tLabel(t1),
      headline: `${article(waccPct)} ${pct(waccPct, 0)} return on SemiAnalysis's ${usd(total)} build-out, plus a ${pct(CAHN_MARGIN * 100, 0)} margin for whoever sells the AI, takes about ${usd(central.revenue, 1)} of AI revenue in 2029, ${times(central.revenue / level, 0)} the ${usd(level, level < 10 ? 1 : 0)} run-rate ${names} had by ${tLabel(t1)}${grows ? `: growth of ${times(needMult)} a year against ${times(gObs)} in the year to ${tLabel(t1)}, ` : ', '}${tail}.`,
      claims: [
        { label: 'Cumulative AI capex, 2024-29', display: usd(total), kind: 'forecast', source: F.source, note: 'only the six-year total is theirs; the yearly path below is fitted here' },
        { label: 'Five hyperscalers’ capex by calendar year', display: known.map(y => `${y} ${usd(actual[y])}`).join(', ') || '—', kind: 'official', source: 'SEC filings: Microsoft, Alphabet, Meta, Amazon, Oracle (hyperscaler-capex.json)', asOf: qtr(hcEnd), note: `used as the early years of the path; ${usd(last4)} in the four quarters to ${mon(hcEnd)}${offset.length ? ` (${list(offset)})` : ''}` },
        { label: 'Chip and server lives', display: `${lives.join(', ')} years`, kind: 'estimate', source: 'GPU unit-economics assumptions (data/ai/gpu-econ.json)', note: `5 to 6 years matches how the hyperscalers depreciate servers; 3 is a scenario where each chip generation makes the last uneconomic. Central case ${life} years` },
        { label: 'Cost of capital', display: pct(waccPct, 0), kind: 'forecast', source: fin(cr?.wacc) ? 'Mauboussin and Callahan, as used by the Capex returns panel' : 'Capex returns feed unavailable this run: the 8% it normally reports (Mauboussin and Callahan)', note: 'an after-tax rate: the pre-tax return the assets must earn is higher, so on this count the need below is understated' },
        { label: 'Gross margin kept by whoever sells the AI', display: pct(CAHN_MARGIN * 100, 0), kind: 'forecast', source: 'David Cahn, Sequoia, "AI’s $600B Question" (2024)', note: 'revenue = 2 × the compute it rents. An assumption, not a floor: at 0%, AI sold at cost, the need halves' },
        ...(fin(roiic) ? [{ label: 'Five hyperscalers: return on new capital', display: pct(roiic), kind: 'estimate', source: 'SEC filings via the Capex returns panel (three-year ROIIC, after estimated tax)', asOf: `FY${crHead.fy}`, note: `${roiic >= waccPct ? 'above' : 'below'} the ${pct(waccPct, 0)} cost of capital${roiic >= waccPct ? ', carried by search, ads, cloud and software' : ': the spending does not yet earn its keep'}. It is the profit gained from ${crHead.fy - 3} to ${crHead.fy} on capital added in ${crHead.fy - 3}-${String(crHead.fy - 1).slice(2)}, mostly before the AI build; spending since ${crHead.fy} is not in it yet` }] : []),
        ...coRows.map(x => {
          const span = win > 0.99 ? 'in the year' : `a year over the ${Math.round(win * 12)} months`
          const how = x.carried > 1e-6
            ? `; the ${mon(`${x.latest.d}-01`)} figure is carried forward ${Math.round(x.carried * 12)} month${Math.round(x.carried * 12) === 1 ? '' : 's'} at that pace to ${tLabel(t1)}: ${usd(x.now, 1)}`
            : x.carried < -1e-6 ? `; estimated for ${tLabel(t1)} at ${usd(x.now, 1)}, assuming steady growth between reports` : ''
          return { label: `${x.co} annualized revenue`, display: usd(x.latest.v, x.latest.v < 10 ? 1 : 0), kind: 'company', source: `${x.latest.src || 'reported run-rate'}${x.latest.approx ? ' (press coverage; date approximate)' : ''}`, asOf: mon(`${x.latest.d}-01`), note: `${times(x.g)} ${span} to ${tLabel(t1)}${how}` }
        }),
        ...others.map(([co, rows]) => { const l = rows[rows.length - 1]; return { label: `${co} annualized revenue`, display: usd(l.v, l.v < 10 ? 1 : 0), kind: 'company', source: l.src || 'reported run-rate', asOf: mon(`${l.d}-01`), note: `${rows.length === 1 ? 'a single disclosure' : l.t < latestT - 1 ? 'more than a year older than the newest disclosure' : 'too short a history'}, so outside the run-rate and growth measured here${/microsoft/i.test(co) ? `; the Chain view on the Pulse tab adds it to the labs' latest figures. Part of it may be OpenAI models resold through Azure, which would partly count twice` : ''}` } }),
        ...markets,
      ],
      implied: [
        { label: 'Compute rent the 2029 fleet must earn', display: usd(central.rent, 2), note: `capital recovery on chips and servers ${usd(central.it, 2)}, on buildings and power gear ${usd(central.fac)}, electricity ${usd(central.power)}` },
        { label: 'AI revenue needed in 2029', display: usd(central.revenue, 1), note: `${life}-year chips, ${pct(CAHN_MARGIN * 100, 0)} margin${fin(hsRevenue) ? `; ${times(central.revenue / hsRevenue, 1)} the five hyperscalers' entire FY${crHead.fy} revenue (${usd(hsRevenue, 2)})` : ''}. Range ${usd(lo, 1)} (${lives[lives.length - 1]}-year chips sold at cost${gxi(gapAt(lo))}) to ${usd(hi, 1)} (${lives[0]}-year chips, ${pct(CAHN_MARGIN * 100, 0)} margin${gxi(gapHi)})` },
        { label: `Disclosed run-rate, ${tLabel(t1)}`, display: usd(level, 1), note: `${names}, ${grows ? `up ${times(gObs)} from` : `${times(gObs)} of`} ${usd(level0, 1)} a year earlier${win < 0.99 ? ' (annualized)' : ''}` },
        { label: 'Growth needed to mid-2029', display: `${times(needMult)} a year`, note: `to a ${usd(rrNeed, 1)} run-rate by mid-2029, which earns ${usd(central.revenue, 1)} over calendar 2029; ${grows ? `at the past year's ${times(gObs)} pace revenue gets there in ${yrsNeeded.toFixed(1)} years` : 'disclosed revenue did not grow over the past year, so no pace gets there'}; ${T.toFixed(1)} years are left from ${tLabel(t1)}, ${ahead.toFixed(1)} of them still ahead` },
        { label: 'Mid-2029 run-rate if the past year’s pace held', display: usd(onTrend, 1), note: onTrend >= rrNeed ? `${times(onTrend / rrNeed, 2)} the needed run-rate, but only if ${times(gObs)} a year lasts ${T.toFixed(1)} years` : `${pct((1 - onTrend / rrNeed) * 100, 0)} short of the needed run-rate even if ${times(gObs)} a year lasts ${T.toFixed(1)} years` },
        ...(fin(halved) ? [{ label: 'Mid-2029 run-rate if growth halves each year', display: usd(halved, halved < 1000 ? 0 : 1), note: `${times(gObs)} in the first year, then ${[1, 2, 3].map(k => times(gObs ** (0.5 ** k))).join(', ')}: an illustration of revenue slowing as it scales, ${halved >= rrNeed ? `still ${times(halved / rrNeed, 1)} the needed run-rate` : `${times(rrNeed / halved, 0)} short of the needed run-rate`}` }] : []),
        { label: 'Undercount that would make the claims fit', display: fin(kFit) && kFit > 1 ? times(kFit, 0) : '—', note: !grows ? 'not defined while disclosed revenue is not growing' : kFit <= 1 ? 'none: disclosed revenue alone fits at half the past year\'s pace' : `true AI revenue would have to be about ${times(kFit, 0)} the disclosed run-rate and grow about ${times(Math.sqrt(gObs))} a year to mid-2029, half the past year's compound pace${fin(kTrend) && kTrend > 1 ? `; ${times(kTrend, 1)} for the past year's full pace to be just enough` : ''}. Uncounted revenue that grows more slowly helps much less (see what has to give)` },
      ],
      gap: {
        label: 'Growth needed ÷ growth seen (compound rates)',
        value: ratio, display: times(ratio, 2), tension: 0.5, contradiction: 1, max: 2,
        note: grows
          ? `1× means AI revenue must keep the growth rate of the year to ${tLabel(t1)} every year to mid-2029, with no slowdown; 0.5× means half the compound rate, about ${times(Math.sqrt(gObs))} a year rather than ${times(gObs)}, would do. At that past pace revenue reaches the need in ${yrsNeeded.toFixed(1)} years; ${T.toFixed(1)} are left from ${tLabel(t1)}, ${ahead.toFixed(1)} of them still ahead.${nearText}`
          : `Disclosed revenue did not grow over the past year, so no pace reaches the need; the gap is set to ${GAP_CAP}×.`,
      },
      gives: [
        { label: 'AI revenue is bigger than the disclosures', note: `The measure covers ${names} only. Hyperscaler AI products, Google, xAI, Chinese labs and in-house use go uncounted: Meta builds only for itself and spent ${pct(metaShare, 0)} of the five hyperscalers' capex in the four quarters to ${mon(hcEnd)}, earning it back through ads. A bigger base helps most if it grows as fast as the labs${fin(kFit) && kFit > 1 ? `: true AI revenue about ${times(kFit, 0)} the disclosed figure, growing ${times(Math.sqrt(gObs))} a year to mid-2029, would bring the gap down to the 0.5 line` : ''}. Revenue that grows more slowly raises the level but drags the measured growth down.${msftText}${grows ? ` And if the labs' ${times(gObs)} is the exception and all AI revenue, on a base ${BROAD_BASE}× theirs, grows at Microsoft's ${times(MSFT_AI_GROWTH, 2)} a year, the gap is ${times(gapBroad, 2)}${gapBroad >= 1 ? ', a contradiction' : ''}.` : ''}` },
        { label: 'The build-out is smaller', note: `SemiAnalysis's figure is ${times(total / MCKINSEY_AI_CAPEX, 1)} McKinsey's 2025 central case of ${usd(MCKINSEY_AI_CAPEX, 1)} for AI data centers, though McKinsey's window runs a year later (2025-30 against 2024-29), so on matching years the difference is wider still. A build half SemiAnalysis's size needs ${usd(needHalf, 1)} in 2029, or ${times(multFor(needHalf))} growth a year${gx(gapHalf)}.` },
        { label: 'Chips last longer, or AI sells closer to cost', note: `With ${lives[lives.length - 1]}-year chip lives the need is ${usd(needLong, 1)}${gx(gapLong)}; if AI sellers kept no gross margin at all it is ${usd(needAtCost, 1)}${gx(gapCost)}. The other way, ${lives[0]}-year chips raise it to ${usd(hi, 1)}${gx(gapHi)}.` },
        { label: 'The payback comes after 2029', note: `Revenue could keep climbing after 2029 while capex levels off, so part of any shortfall is delay rather than loss. That helps less than it sounds: buildings (${FACILITY_LIFE}-year life) can wait, but chips and servers, ${pct((central.it / central.rent) * 100, 0)} of the 2029 rent, wear out in about ${life} years, so those bought in 2026 must pay for themselves by mid-${2026 + life}.` },
        { label: 'Someone accepts a lower return', note: `If revenue falls short, the build earns less than ${pct(waccPct, 0)} and the loss lands on hyperscaler shareholders, chip lessors and lenders (see the AI financing check).${bkOk.length ? ` Polymarket puts the odds of a bankruptcy announcement ${bkBy.length === 1 ? `by ${bkBy[0]} at ${list(bkOk.map(x => `${prob(x.m.yes)} for ${x.co}`))}` : `at ${list(bkOk.map(x => `${prob(x.m.yes)} for ${x.co} by ${x.m.by}`))}`}.` : ''}${bkMissing.length ? ` Polymarket's ${list(bkMissing.map(x => x.co))} bankruptcy market${bkMissing.length > 1 ? 's' : ''} could not be read this run.` : ''}` },
      ],
      watch: [
        { label: 'The next lab run-rate disclosure', display: `${usd(needAtCheck)} by ${tLabel(tCheck)}`, note: `where ${names} combined must be to stay on the needed path; the newest disclosure in data/ai/revenue-disclosures.json is ${tLabel(latestT)}, so add rows as they land` },
        ...(fin(revMw) ? [{ label: 'Lab revenue per megawatt of capacity', display: `$${revMw.toFixed(1)}M`, note: `${names}: ${usd(perMw.reduce((a, x) => a + x.rev, 0))} of run-rate over about ${gwNow.toFixed(0)} GW (${mon(`${perMw[0].date}-01`)}, lab revenue tracker).${fin(gwPlan) ? ` At that yield the ${gwPlan.toFixed(0)} GW planned for ${mon(`${perMw[0].planDate}-01`)} brings in ${usd(revMw * gwPlan)}${Math.abs(tOf(perMw[0].planDate) - tCheck) < 0.1 ? `; the needed path asks for ${usd(needAtCheck)}, or $${(needAtCheck / gwPlan).toFixed(1)}M per MW` : ''}.` : ''}${bestMw ? ` For scale, ${bestMw.entity} is put at up to $${bestMw.rev_per_mw_millions}M per MW on its best inference (${bestMw.confidence}).` : ''}` }] : []),
        ...(fin(g) && fin(hcCmp) ? [{ label: 'Five hyperscalers’ capex, last four quarters', display: usd(last4), note: `to ${mon(hcEnd)}${offset.length ? ` (${list(offset)})` : ''}, ${cmpText}. These five anchor the path, which after ${lastKnown} stands for all AI capex: running below it means the ${usd(total)} is later or smaller than forecast, unless other builders make up the difference` }] : []),
        ...(bustDeep ? [{ label: 'Polymarket: AI downturn odds', display: prob(bustDeep.yes), note: `by ${bustDeep.by}, the most traded of the event's markets (${vol(bustDeep.volume)}); a rise is the market starting to doubt the payback` }] : []),
      ],
      math: [
        `Capex path: the five hyperscalers' complete calendar years (${known.map(y => `${y} ${usd(actual[y])}`).join(', ')}) stand in for the early years. They overstate AI's part of those companies' spending and miss neoclouds, xAI and overseas builders. The rest of the ${usd(total)} is spread over ${known.length ? lastKnown + 1 : 2024}-29 growing ${times(g, 2)} a year: ${pathText}.`,
        `Split: ${pct(IT_SHARE * 100, 0)} chips, servers and networking, ${pct((1 - IT_SHARE) * 100, 0)} buildings, power and cooling (McKinsey 2025). Each dollar must earn its capital recovery factor, the level yearly payment that returns the dollar plus ${pct(waccPct, 0)} a year, like a mortgage payment: ${grid.map(x => `${pct(crf(r, x.L) * 100)} over ${x.L} years`).join(', ')}; ${pct(crf(r, FACILITY_LIFE) * 100)} over ${FACILITY_LIFE} years for buildings.`,
        `In service during 2029: a vintage counts from the middle of the year it is bought until its life runs out, so the 2029 vintage counts half${retiresHalf}. With ${life}-year chips, ${usd(central.itLive, 2)} of chips and servers is in service: × ${pct(crf(r, life) * 100)} = ${usd(central.it, 2)}. Buildings: ${usd(central.fac)}.`,
        `Electricity: ${pct(powerShare * 100)} of server cost a year (${powerRef ? `${powerRef.name}, the median of the chips launched since 2024` : 'median chip'}: board power × server factor × PUE ${A.pue} (facility power ÷ IT power) × 8,760 hours × $${A.electricityUsdPerKwh}/kWh × ${pct(A.utilization * 100, 0)} use, ÷ server cost) = ${usd(central.power)}. Compute rent ${usd(central.rent, 2)}. If part of the ${pct(POWER_GEAR_SHARE * 100, 0)} spent on power, cooling and electrical gear buys generation, charging electricity at a retail price counts that part twice; the whole electricity bill is ${pct((central.power / central.rent) * 100, 0)} of the rent, so the overlap is smaller than that.`,
        `Revenue: ${usd(central.rent, 2)} ÷ (1 − ${pct(CAHN_MARGIN * 100, 0)}) = ${usd(central.revenue, 2)} over calendar 2029. By chip life (at cost / at ${pct(CAHN_MARGIN * 100, 0)} margin): ${grid.map(x => `${x.L} years ${usd(x.cost.revenue)} / ${usd(x.cahn.revenue)}`).join('; ')}.`,
        `Disclosed revenue: ${coRows.map(x => `${x.co} ${usd(x.then, 1)} → ${usd(x.now, 1)}`).join(', ')} from ${tLabel(t0)} to ${tLabel(t1)}: ${usd(level0, 1)} → ${usd(level, 1)}, ${times(gObs, 2)} a year. Between reports a company's run-rate is estimated assuming steady growth. The common date is the newest disclosure; a company whose latest figure is older is carried forward at its own pace over its last year, for at most ${CARRY * 12} months.`,
        grows
          ? `Needed: a year's revenue on a path growing at rate r is its mid-year run-rate × sinh(r/2) ÷ (r/2), ${yearFactor(needMult).toFixed(3)} at the needed pace, so ${usd(central.revenue, 2)} over 2029 takes a ${usd(rrNeed, 2)} run-rate by mid-2029. (${usd(rrNeed, 2)} ÷ ${usd(level, 1)})^(1 ÷ ${T.toFixed(2)} years) = ${times(needMult, 2)} a year. Gap = ln ${needMult.toFixed(2)} ÷ ln ${gObs.toFixed(2)} = ${ratio.toFixed(2)}, the same as ${yrsNeeded.toFixed(2)} years needed at the past year's pace ÷ ${T.toFixed(2)} years left.`
          : `Needed: ${usd(rrNeed, 2)} by mid-2029 from ${usd(level, 1)}, ${times(needMult, 2)} a year; disclosed revenue did not grow, so the gap is set to ${GAP_CAP}.`,
        ...(grows && coRows.length > 1 ? [`Company mix: the combined pace leans on ${coRows.slice().sort((a, b) => b.g - a.g)[0].co}'s growth from a small base. Had both labs grown at one company's pace, the gap would be ${coRows.map(x => `${times(x.gap, 2)} at ${x.co}'s ${times(x.g, 2)}`).join(' and ')}.`] : []),
        ...(grows && fin(kFit) && kFit > 1 ? [`Undercount: the multiple k of disclosed revenue that, growing at the labs' pace, brings the gap to 0.5 is ${times(kFit, 1)}. Uncounted revenue E growing more slowly, at g′ a year, is E ÷ g′ a year earlier, so the measured growth becomes (${usd(level, 1)} + E) ÷ (${usd(level0, 1)} + E ÷ g′): the level rises and the growth falls.`] : []),
        ...(early.length ? [`2029 is not the only year that has to pay. On the same terms the fleet in service needs ${early.map(x => `${usd(x.need)} in ${x.y}`).join(', ')}, while the needed path brings in ${early.map(x => `${usd(x.onPath)}`).join(', ')}. So even reaching the 2029 need leaves the earlier years short, and the build as a whole earns less than ${pct(waccPct, 0)} unless later revenue makes that up.`] : []),
        `Left out, which would raise the need: the ${pct(waccPct, 0)} is an after-tax return, and staff, maintenance and the AI sellers' own research are not counted beyond the margin. The ${pct(CAHN_MARGIN * 100, 0)} margin is the one input here that could be too high: at 0% the need halves. Training compute is included: models must be paid for out of the same revenue.`,
        `Markets: Polymarket bid/ask midpoints (the last trade when the spread is wide); markets with under $${MIN_VOLUME / 1000}k traded are ignored. They give context and do not enter the gap.${dropped.length ? ` Dropped: ${dropped.join('; ')}.` : ''}`,
      ],
      sources: [
        { label: 'David Cahn (Sequoia), AI’s $600B Question, June 2024', url: 'https://www.sequoiacap.com/article/ais-600b-question/' },
        { label: 'McKinsey, The cost of compute: a $7 trillion race to scale data centers, April 2025', url: 'https://www.mckinsey.com/industries/technology-media-and-telecommunications/our-insights/the-cost-of-compute-a-7-trillion-dollar-race-to-scale-data-centers' },
        { label: `${F.source} (data/ai/ai-debt.json)` },
        { label: 'SEC EDGAR XBRL company-concept API (hyperscaler capex, returns on capital)', url: 'https://www.sec.gov/edgar/sec-api-documentation' },
        { label: 'Microsoft FY2025 Q2 earnings, 29 January 2025: AI business past a $13B run-rate, up 175% a year' },
        ...bustMk.map(m => ({ label: `Polymarket: ${m.question}`, url: bust.url })),
        ...bkOk.map(x => ({ label: `Polymarket: ${x.m.question}`, url: x.e.url })),
      ],
    }
  },
}
