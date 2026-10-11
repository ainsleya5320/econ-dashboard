// ============================================================================
// DEFICIT AND SAVING: who funds the government deficit?
// Every dollar the government (federal, state and local) borrows is lent by
// someone: households, businesses or the rest of the world. Each sector's
// balance is its saving less its investment (BEA "net lending"), as a share
// of GDP; in BEA's accounts the four sum to zero by construction (the private
// balance carries the statistical discrepancy), so after the fact the
// identity always closes, through incomes. The question is whether it can
// close on the paths the sources claim, and if not, which claim has to give.
// For the rest of the calendar year the Kalshi deficit market covers (the
// next year once fewer than two quarters are left), the check sets
//   government borrowing: Kalshi's full-year median read at face value on
//     BEA's basis, less what BEA shows was already borrowed that year
//     (fallback: the latest quarter plus the IMF's projected change);
//   households: their latest balance, moved by the reported months of the
//     personal saving rate, then the rate held (Kalshi's December path is
//     used only when every bucket carrying 5%+ clears the volume floor);
//   businesses: held at their latest quarter. No source forecasts them, and
//     as a two-quarter forecast the latest quarter has beaten a four-quarter
//     average since 1960 (RMS error 0.9 against 1.2 pp; computed Oct 2026);
//   foreigners: their latest quarter plus the IMF's projected change in the
//     current account for the year (fallback: held). The IMF's full-year
//     level is not backed out: the April forecast predates the year's data,
//     so the rest of the year would have to make up any miss;
// and grades the gap: borrowing minus lending, points of GDP at an annual
// rate, either way round. Backing a second-half rate out of a full-year
// price doubles any error in that price, so the card also shows the gap
// under other single readings (bid or ask quotes, last trades, the IMF-to-BEA
// basis, the one-time Q1 transfer, the saving-rate market, businesses
// averaged, foreigners on the trade data) and names those that change the
// grade.
// Thresholds. Under 0.75 pp the claims fit within the accounts' own noise:
// BEA's statistical discrepancy has a median size of 0.6% of GDP since 1990,
// and the Fed's Z.1 puts foreign lending a few tenths from BEA's. From 0.75
// the circle needs squaring, though one input's ordinary error could still
// do it: holding businesses at their latest quarter misses the next two by
// about 1 pp (RMS), and the IMF's first estimate of 2025 (the kind of figure
// Kalshi settles on) was 0.5 pp from BEA's, about 1 pp at a second-half
// rate. From 1.5 pp, closing the gap through the private sector alone means
// it lends 1.5 pp more than its path: a two-quarter rise that size came in
// about one non-recession window in fifty since 1960 (one in seventeen
// counting falls; 2020-21 left out; computed Oct 2026). The claims then
// cannot all hold without a private-sector swing that rare.
// Markets: Kalshi KXGOVBAL (settles on the IMF's April WEO; the last trade
// of each strike comes from Kalshi's public trades endpoint), KXPSAVERT
// (December saving rate, first print), KXDEFGDP (federal fiscal-year
// deficit, context only). Floor: 1,000 contracts traded on each strike or
// bucket a reading rests on. Trade-deficit markets (Polymarket
// us-trade-deficit-in-2026, Kalshi KXTRADEDEFICIT) were too thin or
// mis-specified to use in Oct 2026.
// Inputs: FRED (BEA sector net lending AD01/AD02/AD03/W994/W995/W996/W999/
// W162, GDP, DPI, PSAVERT, Treasury MTS, BOPGSTB, Z.1 RWLBACQ027S and
// NCBLACQ027S, UNRATE, CBO NROU, USREC); IMF DataMapper (GGXCNL_NGDP,
// BCA_NGDPD; data/seeds/imf-datamapper.json for the current account when
// imf.org refuses); tradeFlows (customs refunds in the Treasury statement).
// ============================================================================
import { fin, pct, pp, prob, usd, grade, ladder, last, qtr, mon } from '../lib.js'

const TENSION = 0.75 // pp of GDP: beyond the accounts' own measurement noise
const CONTRADICTION = 1.5 // pp of GDP: a private-sector rise seen in about one non-recession two-quarter window in fifty
const TH = { tension: TENSION, contradiction: CONTRADICTION }
const STRIKE_MIN = 1000 // contracts ($1 each) traded on each strike or bucket a market reading rests on
const EVENT_MIN = 5000 // contracts traded on a one-strike event (the fiscal-year market)
const RECENT_DAYS = 14 // strikes that have not traded for longer are priced by quotes alone
const ONE_OFF = 0.5 // % of GDP of private capital transfers in one quarter that marks a one-time transfer
const DM = 'https://www.imf.org/external/datamapper/api/v1'
const KX = 'https://api.elections.kalshi.com/trade-api/v2'

const yearOf = s => { const m = String(s || '').match(/\b(20\d\d)\b/); return m ? +m[1] : null }
const mIdx = d => +d.slice(0, 4) * 12 + (+d.slice(5, 7) - 1)
const addMonths = (d, n) => { const t = mIdx(d) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}-01` }
const qOf = d => `${d.slice(0, 4)}-${String(Math.floor((+d.slice(5, 7) - 1) / 3) * 3 + 1).padStart(2, '0')}-01`
const qIdx = d => Math.floor(mIdx(d) / 3)
const monthsOfQ = d => [0, 1, 2].map(i => addMonths(d, i))
const mean = xs => { const v = xs.filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }
const usdB = v => (fin(v) ? `$${Math.round(v)}B` : '—')
// signed percent with a true minus; anything that rounds to zero prints as 0
const spct = (v, dp = 1) => { if (!fin(v)) return '—'; const r = Math.abs(v) < 0.5 * 10 ** -dp ? 0 : v; return r < 0 ? `−${pct(-r, dp)}` : pct(r, dp) }
const day = d => (d ? `${mon(d).slice(0, 3)} ${+d.slice(8, 10)}` : null)
const art = s => (/^(8|11\.|18)/.test(s) ? 'an' : 'a')
const list = (xs, and = 'or') => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} ${and} ${xs[xs.length - 1]}`)
const sgn = (v, dp = 2) => (fin(v) && v > 0 ? `+${pct(v, dp)}` : spct(v, dp))
const WORD = ['no', 'one', 'two', 'three', 'four']

// A Kalshi bucket event ("3.0% to 3.4%", "Below 2.5%", "4.0% or Above") read as a distribution.
// Values settle at one decimal, so "3.0% to 3.4%" covers [2.95, 3.45) and "at least 4.0%" starts at 3.95.
function buckets(markets) {
  const rows = (markets || []).filter(m => fin(m.p) && (fin(m.strike) || fin(m.cap))).map(m => {
    const r = String(m.rules || '').toLowerCase()
    const lo = fin(m.strike) ? m.strike + (fin(m.cap) || /or above|or more|at least|or higher/.test(r) ? -0.05 : 0.05) : -Infinity
    const hi = fin(m.cap) ? m.cap + (fin(m.strike) || /or below|or less|at most|or lower/.test(r) ? 0.05 : -0.05) : Infinity
    return { lo, hi, p: m.p, label: m.label, volume: m.volume || 0 }
  }).sort((a, b) => a.lo - b.lo)
  const tot = rows.reduce((a, r) => a + r.p, 0)
  if (rows.length < 3 || !(tot > 0.5)) return null
  rows.forEach(r => { r.q = r.p / tot })
  const quant = q => {
    let cum = 0
    for (const r of rows) {
      if (cum + r.q >= q) {
        if (!Number.isFinite(r.lo)) return { v: r.hi, edge: 'below' }
        if (!Number.isFinite(r.hi)) return { v: r.lo, edge: 'above' }
        return { v: r.lo + ((q - cum) / r.q) * (r.hi - r.lo), edge: null }
      }
      cum += r.q
    }
    return { v: null, edge: null }
  }
  const m = quant(0.5)
  return { median: m.v, edge: m.edge, q25: quant(0.25), q75: quant(0.75), rows, sum: tot, thin: rows.filter(r => r.q >= 0.05 && r.volume < STRIKE_MIN) }
}
// a bucket quantile for print: an open-ended bucket prints as its edge
const qTxt = x => (!x || !fin(x.v) ? '—' : x.edge === 'above' ? `${pct(x.v + 0.05)} or more` : x.edge === 'below' ? `under ${pct(x.v + 0.05)}` : pct(x.v))
// P(outcome above x) on a ladder, linear between strikes; null outside it
const pAboveLin = (pts, x) => {
  if (!pts?.length || x < pts[0].k || x > pts[pts.length - 1].k) return null
  for (let i = 0; i < pts.length - 1; i++) if (x <= pts[i + 1].k) return pts[i].p + ((pts[i + 1].p - pts[i].p) * (x - pts[i].k)) / (pts[i + 1].k - pts[i].k)
  return pts[pts.length - 1].p
}

export default {
  id: 'deficit-saving',
  domain: 'economy',
  order: 5,
  title: 'Who funds the government deficit?',
  question: 'Can households, businesses and foreign lenders between them lend the government (federal, state and local) what the market prices it to borrow?',
  see: 'Charts: U.S. Economy → Machine → Stock-flow model (the sector balances); Growth → Profits engine (how the deficit feeds profits); Fiscal (the Treasury monthly statement).',
  async compute(ctx) {
    const dropped = []
    // fetchFredSeries returns [] rather than throwing, so an empty series counts as missing too
    const opt = (p, what) => p.then(r => { if (!r?.length) dropped.push(`${what}: no data`); return r || [] }, e => { dropped.push(`${what}: ${e.message}`); return [] })
    const [gov, fed, sl, priv, bus, hh, cap, nation, sd, gdp, dpi, psav, mts, trade, z1row, z1nfc, ur, nrou, rec] = await Promise.all([
      ctx.fred('AD01RC1Q027SBEA', 300), opt(ctx.fred('AD02RC1Q027SBEA', 12), 'federal borrowing'), opt(ctx.fred('AD03RC1Q027SBEA', 12), 'state and local borrowing'),
      opt(ctx.fred('W994RC1Q027SBEA', 300), 'private balance'), ctx.fred('W995RC1Q027SBEA', 300), ctx.fred('W996RC1Q027SBEA', 300), opt(ctx.fred('W999RC1Q027SBEA', 12), 'private capital transfers'),
      ctx.fred('W162RC1Q027SBEA', 300), opt(ctx.fred('A030RC1Q027SBEA', 12), 'statistical discrepancy'), ctx.fred('GDP', 300), opt(ctx.fred('DPI', 8), 'disposable income'),
      opt(ctx.fred('PSAVERT', 400), 'personal saving rate'), opt(ctx.fred('MTSDS133FMS', 30), 'Treasury statement'), opt(ctx.fred('BOPGSTB', 12), 'trade balance'),
      opt(ctx.fred('RWLBACQ027S', 8), 'Z.1 foreign lending'), opt(ctx.fred('NCBLACQ027S', 8), 'Z.1 corporate lending'),
      opt(ctx.fred('UNRATE', 800), 'unemployment'), opt(ctx.fred('NROU', 400), 'CBO natural rate'), opt(ctx.fred('USREC', 800), 'recession dates'),
    ])

    // ── the four balances, % of GDP (b = $B at an annual rate) ──
    const G = new Map((gdp || []).map(x => [x.d, x.v]))
    const share = (s, sign = 1) => (s || []).filter(x => G.get(x.d) > 0).map(x => ({ d: x.d, v: (sign * x.v / G.get(x.d)) * 100, b: sign * x.v }))
    const govS = share(gov), borS = share(gov, -1), fedS = share(fed), slS = share(sl), privS = share(priv), busS = share(bus), hhS = share(hh), capS = share(cap)
    const forS = share(nation, -1) // what foreigners lend the US = minus the nation's own net lending
    const at = (s, d) => (s || []).find(x => x.d === d) || null
    const dq = [govS, busS, hhS, forS].map(s => last(s)?.d).filter(Boolean).sort()[0]
    if (!dq || !at(govS, dq) || !at(busS, dq) || !at(hhS, dq) || !at(forS, dq)) throw new Error('BEA sector balances are unavailable from FRED')
    const g0 = at(govS, dq).v, h0 = at(hhS, dq).v, b0 = at(busS, dq).v, f0 = at(forS, dq).v
    // A one-time capital transfer (W999: the private capital account, + = paid by the private sector) distorts the
    // run rates. It is taken out of the government's balance and out of whichever private sector's balance jumped more.
    const runAt = d => {
      const b = at(busS, d)?.v, h = at(hhS, d)?.v, g = at(govS, d)?.v, c = at(capS, d)?.v
      if (!fin(b) || !fin(h) || !fin(g)) return null
      if (!(fin(c) && Math.abs(c) >= ONE_OFF)) return { b, h, g, c: 0 }
      const p = addMonths(d, -3), s = -Math.sign(c)
      const toHh = s * (h - (at(hhS, p)?.v ?? h)) > s * (b - (at(busS, p)?.v ?? b))
      return { b: toHh ? b : b + c, h: toHh ? h + c : h, g: g - c, c, toHh }
    }
    const run0 = runAt(dq)
    const strip = run0.c !== 0, busRun = run0.b, hhRun = run0.h, govRun = run0.g
    const busRecent = busS.filter(x => x.d <= dq).slice(-4).map(x => runAt(x.d)?.b)
    const bus4 = busRecent.length === 4 ? mean(busRecent) : null

    // ── the horizon: the rest of the calendar year, or the next year once fewer than two quarters are left ──
    const yq = +dq.slice(0, 4)
    const obsIn = y => govS.filter(x => +x.d.slice(0, 4) === y && x.d <= dq).length
    const Y = obsIn(yq) <= 2 ? yq : yq + 1
    const obsQs = govS.filter(x => +x.d.slice(0, 4) === Y && x.d <= dq).map(x => x.d)
    const remQs = [0, 3, 6, 9].map(m => addMonths(`${Y}-01-01`, m)).filter(d => !obsQs.includes(d))
    const H = remQs.length
    const qs = d => (+d.slice(0, 4) === Y ? qtr(d).slice(5) : qtr(d)) // "Q2" within the horizon year
    const spanL = obsQs.length ? (H === 2 ? `second half of ${Y}` : `${qs(remQs[0])} to Q4 ${Y}`) : `${Y}`
    const span = obsQs.length && H === 2 ? `the ${spanL}` : spanL
    const over = H === 2 ? 'over the half-year' : H === 4 ? 'over the year' : `over the ${WORD[H]} quarters`
    const obsLabel = obsQs.length === 2 ? `the first half of ${Y}` : obsQs.length === 1 ? qtr(obsQs[0]) : null
    // GDP for quarters not yet reported grows at the past year's nominal pace
    const g4 = G.get(addMonths(dq, -12))
    const gq = g4 > 0 ? Math.pow(G.get(dq) / g4, 1 / 4) - 1 : 0.012
    const gdpAt = d => G.get(d) ?? G.get(dq) * Math.pow(1 + gq, qIdx(d) - qIdx(dq))
    const obsGdp = obsQs.reduce((a, d) => a + G.get(d), 0), remGdp = remQs.reduce((a, d) => a + gdpAt(d), 0)
    const obsSum = s => obsQs.reduce((a, d) => a + (at(s, d)?.b ?? NaN), 0)
    // a full-year claim (% of GDP) less what the reported quarters already did, as a rate for the rest;
    // each point on the full-year figure is `amp` points on the rest-of-year rate
    const rest = (yearPct, s, less = 0) => (((yearPct / 100) * (obsGdp + remGdp) - (obsQs.length ? obsSum(s) + less : 0)) / remGdp) * 100
    const obsPct = s => (obsQs.length ? (obsSum(s) / obsGdp) * 100 : null)
    const amp = (obsGdp + remGdp) / remGdp
    const daysAgo = d => (Date.parse(ctx.today) - Date.parse(d)) / 864e5

    // ── Kalshi: the general government balance for Y ──
    let mkt = null
    try {
      const evs = (await ctx.markets.kalshiEvents('KXGOVBAL')).filter(e => /^(US|U\.S\.|United States)\b/i.test(e.title || '') || /^United States\b/i.test(e.subtitle || ''))
      const ev = evs.find(e => (yearOf(e.subtitle) || yearOf(e.title)) === Y)
      if (!ev) dropped.push(`Kalshi lists no open US government-balance market for ${Y}`)
      else {
        const k = await ctx.markets.kalshi(ev.event)
        // read from the contract's rules: "general government net lending/borrowing balance ... is above X% of GDP"
        const rows = k.markets.filter(m => /general government net lending/i.test(m.rules || '') && /\bis above\b/i.test(m.rules || '') && (m.volume ?? 0) >= STRIKE_MIN)
        const L = ladder(rows)
        if (!L || L.strikes.length < 3) dropped.push(`Kalshi ${ev.event}: fewer than three strikes with ${STRIKE_MIN.toLocaleString()} contracts traded`)
        else {
          const edge = L.strikes[0].p < 0.5 ? 'worse' : L.strikes[L.strikes.length - 1].p >= 0.5 ? 'better' : null
          const side = f => { const s = ladder(rows.map(m => ({ ...m, p: f(m) })).filter(m => fin(m.p))); return s && s.strikes.length >= 3 ? s.median : null }
          // each strike's last trade, from Kalshi's public trades endpoint (bounded so a slow reply cannot stall the check)
          const lastTrade = await Promise.race([
            Promise.allSettled(rows.map(m => ctx.fetchJson(`${KX}/markets/trades?ticker=${encodeURIComponent(m.ticker)}&limit=1`))),
            new Promise(res => setTimeout(() => res([]), 8000)),
          ])
          const traded = new Map(rows.map((m, i) => [m.strike, lastTrade[i]?.status === 'fulfilled' ? lastTrade[i].value?.trades?.[0]?.created_time?.slice(0, 10) || null : undefined]))
          const byK = new Map(rows.map(m => [m.strike, m]))
          const i = L.strikes.findIndex((s, j) => s.p >= 0.5 && L.strikes[j + 1] && L.strikes[j + 1].p < 0.5)
          const pair = (i >= 0 ? [L.strikes[i], L.strikes[i + 1]] : [edge === 'worse' ? L.strikes[0] : L.strikes[L.strikes.length - 1]])
            .map(s => ({ k: s.k, oi: byK.get(s.k)?.openInterest, traded: traded.get(s.k) }))
          const known = pair.every(s => s.traded !== undefined)
          const quoteOnly = known && pair.every(s => !s.traded || daysAgo(s.traded) > RECENT_DAYS)
          const allKnown = [...traded.values()].every(v => v !== undefined)
          const lastDates = allKnown ? [...traded.values()].filter(Boolean).sort() : []
          mkt = {
            ...L, event: ev.event, url: k.url, closes: rows.find(m => m.closes)?.closes, edge, pair, known, quoteOnly,
            bidMed: side(m => m.bid), askMed: side(m => m.ask), lastMed: side(m => m.last), lastFrom: lastDates[0], lastTo: lastDates[lastDates.length - 1],
          }
          if (!known) dropped.push('Kalshi trades endpoint: last-trade dates unavailable this run')
        }
      }
    } catch (e) { dropped.push(`Kalshi government-balance market: ${e.message}`) }

    // ── Kalshi: the December personal saving rate for Y ──
    let sMkt = null, sThin = null
    try {
      const evs = (await ctx.markets.kalshiEvents('KXPSAVERT')).filter(e => /year-end/i.test(e.title || ''))
      const ev = evs.find(e => (yearOf(e.subtitle) || yearOf(e.title)) === Y)
      if (ev) {
        const k = await ctx.markets.kalshi(ev.event)
        const B = buckets(k.markets.filter(m => /personal saving rate/i.test(m.rules || '')))
        if (!B || !fin(B.median)) dropped.push(`Kalshi ${ev.event}: buckets do not add up to a distribution`)
        else if (B.thin.length) {
          sThin = { ...B, event: ev.event }
          dropped.push(`Kalshi ${ev.event} (December saving rate): ${B.thin.length} of the ${B.rows.filter(r => r.q >= 0.05).length} buckets carrying 5%+ have under ${STRIKE_MIN.toLocaleString()} contracts traded, so the saving rate is held instead`)
        } else sMkt = { ...B, event: ev.event, url: k.url }
      } else dropped.push(`Kalshi lists no open year-end saving-rate market for ${Y}`)
    } catch (e) { dropped.push(`Kalshi saving-rate market: ${e.message}`) }

    // ── Kalshi: the federal fiscal-year deficit (context only) ──
    let fyMkt = null
    try {
      for (const e of await ctx.markets.kalshiEvents('KXDEFGDP')) {
        const k = await ctx.markets.kalshi(e.event)
        const m = k.markets.find(x => /fiscal year (\d{4})/i.test(x.rules || '') && /is below ([\d.]+)%/i.test(x.rules || '') && fin(x.p) && (x.volume || 0) >= EVENT_MIN)
        if (m) { fyMkt = { fy: +m.rules.match(/fiscal year (\d{4})/i)[1], below: +m.rules.match(/is below ([\d.]+)%/i)[1], p: m.p, volume: m.volume, closes: m.closes }; break }
      }
    } catch (e) { dropped.push(`Kalshi fiscal-year deficit market: ${e.message}`) }

    // ── IMF World Economic Outlook ──
    const dm = async ind => { const j = await ctx.fetchJson(`${DM}/${ind}/USA`); const v = j?.values?.[ind]?.USA; if (!v) throw new Error(`no US ${ind}`); return v }
    const [ggR, caR, metaR] = await Promise.allSettled([dm('GGXCNL_NGDP'), dm('BCA_NGDPD'), ctx.fetchJson(`${DM}/indicators`)])
    const imfGG = ggR.status === 'fulfilled' ? ggR.value : null
    let imfCA = caR.status === 'fulfilled' ? caR.value : null, caSeed = null
    if (!imfGG) dropped.push(`IMF government balance: ${ggR.reason?.message}`)
    if (!imfCA) {
      try { const seed = ctx.json('data/seeds/imf-datamapper.json'); imfCA = seed?.values?.BCA_NGDPD?.USA || null; caSeed = seed?.fetchedAt?.slice(0, 10) || 'seed' } catch { /* no seed */ }
      dropped.push(`IMF current account live: ${caR.reason?.message}${imfCA ? `; using the committed copy from ${caSeed}` : ''}`)
    }
    const weo = metaR.status === 'fulfilled' ? (metaR.value?.indicators?.GGXCNL_NGDP?.source || '').match(/\(([^)]+)\)/)?.[1] || null : null
    const weoTxt = weo ? `IMF World Economic Outlook (${weo})` : 'IMF World Economic Outlook'
    const weoEarly = weo && /^April (\d{4})$/.test(weo) && +weo.slice(-4) === Y // made before any quarter of Y was reported
    const imfG = y => (fin(imfGG?.[y]) ? -imfGG[y] : null) // government borrowing, + = deficit
    const imfF = y => (fin(imfCA?.[y]) ? -imfCA[y] : null) // foreign lending, + = current-account deficit

    // the IMF and BEA measures side by side, full years; the latest is an early IMF estimate, like the one Kalshi settles on
    const bea = (s, y) => { const q = s.filter(x => +x.d.slice(0, 4) === y); return q.length === 4 ? (q.reduce((a, x) => a + x.b, 0) / q.reduce((a, x) => a + G.get(x.d), 0)) * 100 : null }
    const basis = [Y - 3, Y - 2, Y - 1].map(y => ({ y, imfG: imfG(y), beaG: bea(borS, y), imfF: imfF(y), beaF: bea(forS, y) })).filter(b => (fin(b.beaG) && fin(b.imfG)) || (fin(b.beaF) && fin(b.imfF)))
    const basisG = basis.filter(b => fin(b.imfG) && fin(b.beaG)).pop() || null // the latest year with both
    const gapG = basisG ? basisG.beaG - basisG.imfG : null // BEA less IMF, points of GDP
    // an April WEO carries the IMF's first estimate of the year before; an October one its second
    const basisEarly = !!basisG && basisG.y === Y - 1 && !!weo && new RegExp(`^(April|October) ${Y}$`).test(weo)
    const basisTag = !basisEarly ? 'figure' : /^April/.test(weo) ? 'first estimate' : 'second estimate'

    // ── government borrowing for the rest of Y ──
    const gChg = fin(imfG(Y)) && fin(imfG(Y - 1)) ? imfG(Y) - imfG(Y - 1) : null
    const govFrom = mkt ? 'market' : fin(gChg) ? 'imf' : null
    if (!govFrom) throw new Error(`no deficit path for ${Y}: neither Kalshi's deficit market nor the IMF's projection is available (${dropped.filter(x => /government/.test(x)).join('; ')})`)
    const bRem = govFrom === 'market' ? rest(-mkt.median, borS) : -govRun + gChg
    // the full-year deficit the path means (the market's own figure, or what the IMF path adds up to)
    const D = govFrom === 'market' ? -mkt.median : obsQs.length ? ((obsSum(borS) + (bRem / 100) * remGdp) / (obsGdp + remGdp)) * 100 : bRem
    const oneOffs = obsQs.map(d => ({ d, r: runAt(d) })).filter(x => x.r && x.r.c !== 0).map(x => ({ ...at(capS, x.d), toHh: x.r.toHh }))
    const oneOffB = oneOffs.reduce((a, c) => a + c.b, 0) // $B at an annual rate, − = paid to the private sector
    const oneOffTxt = oneOffs.map(c => `a one-time ${usd(Math.abs(c.b) / 4)} capital transfer ${c.v < 0 ? 'to' : 'from'} the private sector in ${qtr(c.d)}`).join(' and ')

    // ── households: the saving-rate path ──
    const PS = new Map((psav || []).map(x => [x.d, x.v]))
    const lastM = last(psav)
    const decY = `${Y}-12-01`
    const remMonths = remQs.flatMap(monthsOfQ)
    const seenM = remMonths.filter(m => PS.has(m))
    // reported months as reported; then a straight line to a December figure, or the latest rate held
    const sPath = dec => remMonths.map(m => {
      if (PS.has(m)) return PS.get(m)
      if (!lastM) return null
      if (fin(dec) && mIdx(decY) > mIdx(lastM.d)) return m >= decY ? dec : lastM.v + ((dec - lastM.v) * (mIdx(m) - mIdx(lastM.d))) / (mIdx(decY) - mIdx(lastM.d))
      return lastM.v
    })
    const s0 = mean(monthsOfQ(dq).map(m => PS.get(m)))
    const dpiQ = (dpi || []).find(x => x.d === dq)?.v
    const dpiR = dpiQ > 0 ? dpiQ / G.get(dq) : 0.74
    const hhAt = dec => { const s = lastM ? mean(sPath(dec)) : null; return { s, h: fin(s) && fin(s0) ? hhRun + (s - s0) * dpiR : hhRun } }
    const { s: sRem, h: hRem } = hhAt(sMkt ? sMkt.median : null)

    // ── foreigners: the latest quarter plus the IMF's projected change for the year ──
    const fChg = fin(imfF(Y)) && fin(imfF(Y - 1)) ? imfF(Y) - imfF(Y - 1) : null
    const fRem = fin(fChg) ? f0 + fChg : f0
    const forFrom = fin(fChg) ? 'imf' : 'held'

    // ── the gap ──
    const lend = hRem + busRun + fRem
    const gapAt = (o = {}) => (o.b ?? bRem) - ((o.h ?? hRem) + (o.bus ?? busRun) + (o.f ?? fRem))
    const R = gapAt()
    const status = grade(Math.abs(R), TH)
    const short = R >= 0
    // against the latest quarter: the identity holds there, so the gap is the sum of the claimed changes
    const dGov = bRem + govRun, dHh = hRem - hhRun, dBus = 0, dFor = fRem - f0
    const need = bRem - fRem - (hhRun + busRun) // the private sector's move from the latest quarter that closes it alone

    // how often the private balance has moved this far, in that direction, over H quarters outside recessions and 2020-21
    const recQ = new Set((rec || []).filter(x => x.v === 1).map(x => qOf(x.d)))
    const ps = privS.filter(x => x.d >= '1960-01-01')
    const swings = []
    for (let i = 0; i + H < ps.length; i++) {
      const w = ps.slice(i, i + H + 1)
      if (w.some(x => recQ.has(x.d) || (x.d >= '2020-01-01' && x.d <= '2021-12-31'))) continue
      swings.push(w.slice(1).reduce((a, x) => a + x.v, 0) / H - w[0].v)
    }
    const dir = need >= 0 ? 1 : -1
    const shareAtLeast = v => (swings.length > 40 ? (swings.filter(s => s * dir >= v).length / swings.length) * 100 : null)
    const needShare = shareAtLeast(Math.abs(need)), thrShare = shareAtLeast(CONTRADICTION)
    const thrShare2 = swings.length > 40 ? (swings.filter(s => Math.abs(s) >= CONTRADICTION).length / swings.length) * 100 : null
    const shareTxt = v => (!fin(v) ? null : v < 0.5 ? 'none' : v < 1 ? 'under 1%' : `${Math.round(v)}%`)
    const since = `since 1960${recQ.size ? ' outside recessions' : ' (recession dates unavailable, so recessions are included)'} and 2020-21`

    // ── what would close it, one sector at a time ──
    const fNeed = fRem + R, bNeed = busRun + R
    const sNeed = fin(sRem) ? sRem + R / dpiR : null
    const dNeed = ((((bRem - R) / 100) * remGdp + (obsQs.length ? obsSum(borS) : 0)) / (obsGdp + remGdp)) * 100
    const recF = forS.filter(x => x.d >= '1960-01-01').reduce((a, x) => (!a || x.v > a.v ? x : a), null)
    // the market's own odds on the deficit that makes the claims fit
    const pUp = mkt ? pAboveLin(mkt.strikes, -dNeed) : null
    const pFit = fin(pUp) ? (short ? pUp : 1 - pUp) : null
    const pFitTxt = mkt && (short ? -dNeed > mkt.strikes[mkt.strikes.length - 1].k : -dNeed < mkt.strikes[0].k)
      ? `under ${prob(short ? mkt.strikes[mkt.strikes.length - 1].p : 1 - mkt.strikes[0].p)}` : fin(pFit) ? `about ${prob(pFit)}` : null

    // ── context: trade, the Treasury statement, the labour market, the Fed's Z.1 ──
    const TR = new Map((trade || []).map(x => [x.d, -x.v / 1000])) // monthly deficit, $B
    const tradeQ = mean(monthsOfQ(dq).map(m => TR.get(m)))
    const postM = (trade || []).map(x => x.d).filter(d => d > addMonths(dq, 2))
    const tradePost = mean(postM.map(m => TR.get(m)))
    const postLabel = postM.length ? (postM.length === 1 ? mon(postM[0]) : `${mon(postM[0]).slice(0, 3)} to ${mon(postM[postM.length - 1])}`) : null
    const tradeNeed = fin(tradeQ) ? tradeQ + ((fNeed - f0) / 100) * (G.get(dq) / 12) : null
    const tradeMove = fin(tradePost) && fin(tradeQ) ? tradePost - tradeQ : null
    const widerTrade = fin(tradeMove) && tradeMove > 5
    const fTrade = fin(tradeMove) && Math.abs(tradeMove) > 5 ? f0 + ((tradeMove * 12) / G.get(dq)) * 100 : null

    const m12 = (mts || []).slice(-12), p12 = (mts || []).slice(-24, -12)
    const sum12 = m12.length === 12 ? -m12.reduce((a, x) => a + x.v, 0) / 1000 : null
    const prev12 = p12.length === 12 ? -p12.reduce((a, x) => a + x.v, 0) / 1000 : null
    const gdp4 = mean(gdp.slice(-4).map(x => x.v))
    const mtsPct = fin(sum12) && gdp4 ? (sum12 / gdp4) * 100 : null
    let refunds = null
    if (m12.length === 12) {
      try {
        const tf = await Promise.race([ctx.source('tradeFlows'), new Promise((_, rej) => setTimeout(() => rej(new Error('still building')), 10000))])
        const months = new Set(m12.map(x => x.d.slice(0, 7)))
        const rows = (tf?.passThrough?.tariff || []).filter(r => months.has(r.d) && fin(r.refund))
        if (rows.length) refunds = rows.reduce((a, r) => a + r.refund, 0)
      } catch (e) { dropped.push(`customs refunds (trade-flows feed): ${e.message}`) }
    }

    const urQ = new Map()
    for (const x of ur || []) { const q = qOf(x.d); urQ.set(q, [...(urQ.get(q) || []), x.v]) }
    const NR = new Map((nrou || []).map(x => [x.d, x.v]))
    const lastU = last(ur), nNow = lastU ? NR.get(qOf(lastU.d)) : null
    const fe = govS.filter(x => x.d >= '1960-01-01' && x.d < '2020-01-01' && urQ.has(x.d) && NR.has(x.d) && mean(urQ.get(x.d)) <= NR.get(x.d))
    const feMax = fe.reduce((a, x) => (!a || x.v < a.v ? x : a), null)

    const sdS = share(sd)
    const sd0 = at(sdS, dq)?.v
    const sdOpp = sdS.filter(x => fin(sd0) && Math.sign(x.v) !== Math.sign(sd0)).reduce((a, x) => (!a || Math.abs(x.v) > Math.abs(a.v) ? x : a), null)
    const z1f = (z1row || []).find(x => x.d === dq), z1c = (z1nfc || []).find(x => x.d === dq)
    const z1fPct = z1f ? (z1f.v / 1000 / G.get(dq)) * 100 : null, z1cPct = z1c ? (z1c.v / 1000 / G.get(dq)) * 100 : null

    // the pre-pandemic norms, and how low households are
    const pre = s => mean((s || []).filter(x => x.d >= '2015-01-01' && x.d < '2020-01-01').map(x => x.v))
    const hhPre = pre(hhS), busPre = pre(busS), forPre = pre(forS), sPre = pre(psav)
    const hhPrior = hhS.filter(x => x.d < dq && x.v <= h0).pop()
    const hhLow = hhPrior && qIdx(dq) - qIdx(hhPrior.d) >= 4 ? `the lowest since ${qtr(hhPrior.d)}` : null

    // ── the gap under other single readings ──
    const variants = []
    const addV = (short, long, r) => { if (fin(r) && Math.abs(r - R) >= 0.005) variants.push({ short, long, r }) }
    if (govFrom === 'market') {
      if (fin(mkt.bidMed)) addV('the market read on bid prices', `the market on bid prices (median ${spct(mkt.bidMed, 2)})`, gapAt({ b: rest(-mkt.bidMed, borS) }))
      if (fin(mkt.askMed)) addV('the market read on ask prices', `the market on ask prices (median ${spct(mkt.askMed, 2)})`, gapAt({ b: rest(-mkt.askMed, borS) }))
      if (fin(mkt.lastMed)) { const when = mkt.lastFrom ? ` (${day(mkt.lastFrom)} to ${day(mkt.lastTo)})` : ''; addV(`the market read at its last trades${when}`, `the market at its last trades${mkt.lastFrom ? `, ${day(mkt.lastFrom)} to ${day(mkt.lastTo)}` : ''} (median ${spct(mkt.lastMed, 2)})`, gapAt({ b: rest(-mkt.lastMed, borS) })) }
      if (fin(gapG) && Math.abs(gapG) >= 0.1) addV(`Kalshi's figure moved by ${basisG.y}'s BEA-to-IMF difference`, `Kalshi's figure moved by ${basisG.y}'s BEA-to-IMF difference (${pp(gapG, 2)}, to ${pct(D + gapG, 2)})`, gapAt({ b: rest(D + gapG, borS) }))
      if (oneOffs.length) addV(`the ${oneOffs.map(c => qtr(c.d)).join(' and ')} transfer left out of the IMF's figure`, `the ${oneOffs.map(c => qtr(c.d)).join(' and ')} transfer left out of the IMF's ${Y} figure (second-half borrowing ${pct(rest(D, borS, oneOffB), 2)})`, gapAt({ b: rest(D, borS, oneOffB) }))
    } else if (fin(imfG(Y)) && obsQs.length) {
      addV(`the IMF's full-year ${pct(imfG(Y))} backed out`, `the IMF's full-year ${pct(imfG(Y))} with the rest of the year making up the difference`, gapAt({ b: rest(imfG(Y), borS) }))
    }
    if (sThin && lastM) { const h = hhAt(sThin.median).h; addV("households on Kalshi's thin saving-rate path", `households on Kalshi's thin path to a ${pct(sThin.median, 2)} December saving rate (lending ${pct(h, 2)})`, gapAt({ h })) }
    if (sMkt && lastM) { const h = hhAt(null).h; addV('the saving rate held', `the saving rate held at ${pct(lastM.v)} (household lending ${pct(h, 2)})`, gapAt({ h })) }
    if (fin(bus4)) addV('businesses at their four-quarter average', `businesses at their four-quarter average, one-offs out (${pct(bus4, 2)})`, gapAt({ bus: bus4 }))
    if (fin(fTrade)) addV(`foreigners on the ${postLabel} trade pace`, `foreigners on the ${postLabel} trade pace with nothing else moving (${pct(fTrade, 2)})`, gapAt({ f: fTrade }))
    if (fin(imfF(Y)) && obsQs.length) { const f = rest(imfF(Y), forS); addV(`foreigners making up the IMF's full-year ${pct(imfF(Y))}`, `foreigners making up the IMF's full-year ${pct(imfF(Y))} in ${span} (${pct(f, 2)})`, gapAt({ f })) }
    if (forFrom === 'imf') addV(`foreigners held at their ${qs(dq)} pace`, `foreigners held at their ${qs(dq)} pace (${pct(f0, 2)})`, gapAt({ f: f0 }))
    const vAbs = variants.map(v => Math.abs(v.r))
    const vLo = Math.min(Math.abs(R), ...vAbs), vHi = Math.max(Math.abs(R), ...vAbs)
    // a reading that moves the gap by under 0.15 pp is noise; it is named apart, as a sign the gap sits near a line
    const flips = (g, big) => variants.filter(v => grade(Math.abs(v.r), TH) === g && g !== status && (Math.abs(Math.abs(v.r) - Math.abs(R)) >= 0.15) === big).map(v => v.short)
    const flipTxt = ['consistent', 'tension', 'contradiction'].map(g => [g, flips(g, true)]).filter(([, xs]) => xs.length).map(([g, xs]) => `${g} with ${list(xs)}`)
    const smallFlips = ['consistent', 'tension', 'contradiction'].flatMap(g => flips(g, false))

    // ── words that depend on the data ──
    const sDir = sMkt && lastM ? (sMkt.median < lastM.v - 0.05 ? 'to fall to' : sMkt.median > lastM.v + 0.05 ? 'to rise to' : 'to hold near') : null
    const near = Math.abs(dHh) < 0.25 && Math.abs(dFor) < 0.25 && !sMkt
    const others = sMkt ? `households (saving rate priced ${sDir} ${pct(sMkt.median)} by December), businesses and foreigners` : 'households, businesses and foreigners'
    const othersAt = near ? `${others} at about their ${qs(dq)} pace` : `${others} on the paths below`
    const dollars = usd((Math.abs(R) * remGdp) / 400)
    const lead = govFrom === 'market'
      ? `Kalshi prices the ${Y} government deficit (federal, state and local) at ${pct(D)} of GDP`
      : `On ${qs(dq)}'s pace plus the IMF's projected ${gChg >= 0 ? 'rise' : 'fall'} of ${Math.abs(gChg).toFixed(1)} points, the ${Y} government deficit (federal, state and local) comes to ${pct(D)} of GDP`
    const paceTxt = Math.abs(dGov) < 0.05 ? `${qs(dq)}'s pace` : `${Math.abs(dGov).toFixed(1)} points ${dGov > 0 ? 'above' : 'below'} ${qs(dq)}'s ${pct(-govRun)}`
    const borrowTxt = obsQs.length
      ? `, so ${H === 2 ? 'second-half borrowing' : `borrowing from ${qs(remQs[0])}`} runs at ${art(pct(bRem))} ${pct(bRem)} annual rate`
      : `, ${paceTxt}`
    const tail = R >= TENSION ? `would lend ${pct(lend)}, a ${Math.abs(R).toFixed(1)}-point gap (about ${dollars} ${over}) someone must fill.`
      : R <= -TENSION ? `would lend ${pct(lend)}, ${Math.abs(R).toFixed(1)} points more (about ${dollars} ${over}), so either the deficit runs larger or someone lends less.`
      : `would lend ${pct(lend)}, within ${Math.abs(R).toFixed(1)} points: the claims fit together.`
    const headline = `${lead}${borrowTxt}; ${othersAt} ${tail}`
    const lowSave = fin(sRem) && fin(sPre) && sRem < sPre
    const mktWord = govFrom === 'market' ? "the market's" : "the IMF's"
    const moveTxt = (v, who) => (Math.abs(v) < 0.005 ? `${who} is held` : `${who} ${v > 0 ? 'rises' : 'falls'} ${Math.abs(v).toFixed(2)}`)
    const govMost = Math.abs(R) >= 0.1 && Math.sign(dGov) === Math.sign(R) && Math.abs(dGov) >= 0.75 * Math.abs(R)
    const decomp = `Against ${qs(dq)}'s pace, ${moveTxt(dGov, 'government borrowing')}, ${moveTxt(dHh, 'household lending')}, ${moveTxt(dBus, 'business lending')} and ${moveTxt(dFor, 'foreign lending')}${govMost ? `, so most of the gap is the ${dGov > 0 ? 'rise' : 'fall'} in government borrowing ${mktWord} figure implies` : ''}.`
    const needTxt = fin(needShare) && Math.abs(need) >= 0.05
      ? ` Closing it through the private sector alone means its lending ${need > 0 ? 'rising' : 'falling'} ${Math.abs(need).toFixed(2)} points from ${qs(dq)}, a ${WORD[H] || H}-quarter move that large or larger in ${shareTxt(needShare)} of windows ${since}.` : ''
    const staleTxt = mkt?.quoteOnly ? ` The deficit price comes from quotes: the strikes around its median last traded ${list(mkt.pair.map(s => day(s.traded) || 'never'), 'and')}.` : ''
    const flipNote = variants.length ? ` Other single readings put the gap between ${vLo.toFixed(1)} and ${vHi.toFixed(1)} pp${flipTxt.length ? `: ${flipTxt.join('; ')}` : ''}.${smallFlips.length ? ` It sits close enough to a line that even ${list(smallFlips)} ${smallFlips.length > 1 ? 'tip' : 'tips'} it.` : ''}${!flipTxt.length && !smallFlips.length ? ' None changes the grade.' : ''}` : ''
    const imfVsMkt = govFrom === 'market' && fin(imfG(Y)) ? D - imfG(Y) : null

    return {
      status,
      asOf: mkt || sMkt ? ctx.today : lastM ? mon(lastM.d) : qtr(dq),
      headline,
      claims: [
        mkt ? { label: `Government deficit priced for ${Y}`, display: `${pct(D)}${mkt.edge === 'worse' ? '+' : ''} of GDP`, kind: 'market', source: `Kalshi ${mkt.event}`, asOf: ctx.today,
          note: `median of the "balance above X% of GDP" ladder; federal, state and local together, on the IMF's measure, settling on its first estimate${mkt.closes ? ` (${mon(mkt.closes)})` : ''}${mkt.known ? `; the ${list(mkt.pair.map(s => spct(s.k)), 'and')} strike${mkt.pair.length > 1 ? 's' : ''} around it ${mkt.pair.length > 1 ? 'have' : 'has'} ${list(mkt.pair.map(s => Math.round(s.oi || 0).toLocaleString()), 'and')} contracts open and last traded ${list(mkt.pair.map(s => day(s.traded) || 'never'), 'and')}${mkt.quoteOnly ? ', so the price is set by quotes, not trades' : ''}` : ''}${mkt.edge ? `; the median lies beyond the last strike (${mkt.edge === 'worse' ? 'a bigger deficit' : 'a smaller one'})` : ''}` } : null,
        fin(imfG(Y)) || fin(imfF(Y)) ? { label: `IMF for ${Y}: ${[fin(imfG(Y)) && 'government deficit', fin(imfF(Y)) && 'borrowing from abroad'].filter(Boolean).join(' / ')}`, display: `${[fin(imfG(Y)) && pct(imfG(Y)), fin(imfF(Y)) && pct(imfF(Y))].filter(Boolean).join(' / ')} of GDP`, kind: 'forecast', source: weoTxt, asOf: weo,
          note: [weoEarly && `made before any ${Y} quarter was reported`, (fin(gChg) || fin(fChg)) && `${[fin(gChg) && pp(gChg), fin(fChg) && pp(fChg)].filter(Boolean).join(' / ')} from its ${Y - 1} estimates (${[fin(imfG(Y - 1)) && fin(gChg) && pct(imfG(Y - 1)), fin(imfF(Y - 1)) && fin(fChg) && pct(imfF(Y - 1))].filter(Boolean).join(' / ')})`, fin(imfG(Y)) && fin(imfF(Y)) && `leaves the private sector lending ${pct(imfG(Y) - imfF(Y))}`, fin(imfG(Y + 1)) && fin(imfF(Y + 1)) && `${Y + 1}: ${pct(imfG(Y + 1))} / ${pct(imfF(Y + 1))}`, caSeed && `current account from the copy saved ${caSeed}`].filter(Boolean).join('; ') } : null,
        { label: 'Government borrowing (federal, state and local)', display: `${pct(-g0)} of GDP`, kind: 'official', source: 'BEA net lending by sector (FRED AD01RC1Q027SBEA)', asOf: qtr(dq),
          note: [fin(at(fedS, dq)?.v) && fin(at(slS, dq)?.v) && `federal ${pct(-at(fedS, dq).v)}, state and local ${pct(-at(slS, dq).v)}`, `one-offs out, the past five quarters: ${govS.filter(x => x.d <= dq).slice(-5).map(x => `${qs(x.d)} ${pct(-(runAt(x.d)?.g ?? NaN))}`).join(', ')}`, fin(lastU?.v) && fin(nNow) && `unemployment ${pct(lastU.v)} (${mon(lastU.d)}) against CBO's ${pct(nNow)} natural rate`].filter(Boolean).join('; ') + (feMax ? `. Before 2020 government never borrowed more than ${pct(-feMax.v)} of GDP with unemployment at or below that rate (${qtr(feMax.d)})` : '') },
        fin(sum12) ? { label: 'Federal deficit, past 12 months', display: `${usd(sum12)} (${pct(mtsPct)} of GDP)`, kind: 'official', source: 'Monthly Treasury Statement (FRED MTSDS133FMS)', asOf: `12 months to ${mon(last(mts).d)}`,
          note: `cash basis, federal only; ${usd(prev12)} a year earlier${refunds >= 10 ? `; includes ${usd(refunds)} of customs duty refunds` : ''}` } : null,
        { label: 'Households and nonprofits lend', display: `${pct(h0)} of GDP`, kind: 'official', source: 'BEA (FRED W996RC1Q027SBEA)', asOf: qtr(dq),
          note: [hhLow, fin(hhPre) && `2015-19 average ${pct(hhPre)}`, lastM && `personal saving rate ${pct(lastM.v)} of disposable income in ${mon(lastM.d)}${fin(sPre) ? ` (2015-19: ${pct(sPre)})` : ''}`, strip && run0.toHh && `includes a one-time capital transfer of ${pct(Math.abs(run0.c))} of GDP`].filter(Boolean).join('; ') },
        sMkt ? { label: `Personal saving rate priced for December ${Y}`, display: `${qTxt({ v: sMkt.median, edge: sMkt.edge })}`, kind: 'market', source: `Kalshi ${sMkt.event}`, asOf: ctx.today,
          note: `median of the buckets, middle half ${qTxt(sMkt.q25)} to ${qTxt(sMkt.q75)}; settles on the first December print; every bucket carrying 5%+ has ${STRIKE_MIN.toLocaleString()}+ contracts traded` } : null,
        { label: 'Businesses lend', display: `${pct(b0)} of GDP`, kind: 'official', source: 'BEA domestic business (FRED W995RC1Q027SBEA)', asOf: qtr(dq),
          note: [fin(bus4) && `last four quarters ${pct(bus4)} on average, one-offs out`, fin(busPre) && `2015-19 average ${pct(busPre)}`, fin(z1cPct) && `nonfinancial corporations alone ${z1cPct >= 0 ? 'lend' : 'borrow'} ${pct(Math.abs(z1cPct))} of GDP (Fed Z.1)`, strip && !run0.toHh && `includes a one-time capital transfer of ${pct(Math.abs(run0.c))} of GDP`].filter(Boolean).join('; ') || null },
        { label: 'Foreigners lend (the current-account deficit)', display: `${pct(f0)} of GDP`, kind: 'official', source: 'BEA (FRED W162RC1Q027SBEA, sign reversed)', asOf: qtr(dq),
          note: [fin(forPre) && `2015-19 average ${pct(forPre)}`, recF && `record ${pct(recF.v)} (${qtr(recF.d)})`, fin(tradePost) && fin(tradeQ) && `trade deficit ${usdB(tradePost)} a month in ${postLabel} against ${usdB(tradeQ)} in ${qtr(dq)}`].filter(Boolean).join('; ') },
      ].filter(Boolean),
      implied: [
        { label: `Government borrows, ${spanL}`, display: pct(bRem),
          note: govFrom === 'market'
            ? (obsQs.length ? `what the rest of the year must run at for ${Y} to reach ${mktWord} ${pct(D, 2)} after ${pct(obsPct(borS), 2)} in ${obsLabel}${oneOffTxt ? ` (which includes ${oneOffTxt})` : ''}; ${qs(dq)}'s pace was ${pct(-govRun, 2)}` : `${mktWord} figure for the year`)
            : `the ${qs(dq)} pace (${pct(-govRun, 2)}) plus the IMF's projected change for ${Y} (${pp(gChg)}: ${pct(imfG(Y - 1))} in ${Y - 1} to ${pct(imfG(Y))})` },
        { label: `Households lend, ${spanL}`, display: pct(hRem), note: fin(sRem) && fin(s0) ? `saving rate averaging ${pct(sRem, 2)} (${seenM.length ? `${list(seenM.map(m => mon(m).slice(0, 3)), 'and')} reported, then ` : ''}${sMkt ? `a path to the ${pct(sMkt.median, 2)} priced for December` : `held at ${pct(lastM.v)}`}) against ${pct(s0, 2)} in ${qtr(dq)}; a point of saving rate is ${dpiR.toFixed(2)} points of GDP` : 'held at the latest quarter: the saving rate is unavailable' },
        { label: `Businesses lend, ${spanL}`, display: pct(busRun), note: `held at the ${qtr(dq)} pace${strip && !run0.toHh ? ', less the one-time transfer' : ''}: no source forecasts it, and since 1960 the latest quarter has been a better guess at the next two than the four-quarter average${fin(bus4) ? ` (now ${pct(bus4, 2)})` : ''}` },
        { label: `Foreigners lend, ${spanL}`, display: pct(fRem), note: forFrom === 'imf' ? `the ${qtr(dq)} pace (${pct(f0, 2)}) plus the IMF's projected change for ${Y} (${pp(fChg)}: ${pct(imfF(Y - 1))} in ${Y - 1} to ${pct(imfF(Y))})` : `held at the ${qtr(dq)} pace: the IMF projection is unavailable` },
        govFrom === 'market' && obsQs.length ? { label: `${Y} deficit at which the claims fit`, display: pct(dNeed), note: pFitTxt ? `Kalshi gives ${pFitTxt} to a deficit this ${short ? 'small or smaller' : 'large or larger'}` : `${mktWord} figure is ${pct(D)}` } : null,
        { label: 'Current-account deficit that closes it alone', display: pct(fNeed), note: [recF && `record ${pct(recF.v)} (${qtr(recF.d)})`, fin(tradeNeed) && `a trade deficit of about ${usdB(tradeNeed)} a month`].filter(Boolean).join('; ') },
        fin(sNeed) ? { label: 'Saving rate that closes it alone', display: pct(sNeed), note: `average over ${span}${fin(sPre) ? `; 2015-19 average ${pct(sPre)}` : ''}` } : null,
      ].filter(Boolean),
      gap: {
        label: short ? `Borrowing no sector's path covers, ${spanL}` : `Lending the deficit leaves unused, ${spanL}`,
        value: Math.abs(R), display: `${Math.abs(R).toFixed(1)} pp of GDP`,
        tension: TENSION, contradiction: CONTRADICTION, max: 3, tensionLabel: '0.75 pp', contradictionLabel: '1.5 pp',
        note: `${short ? 'Government borrowing less what households, businesses and foreigners lend' : 'What households, businesses and foreigners lend less government borrowing'} on the paths above, at an annual rate (about ${dollars} ${over}). ${decomp}${needTxt}${flipNote}${staleTxt} After the fact the accounts always balance, through incomes; the gap says which claim has to give.`,
      },
      gives: [
        short
          ? { label: `The deficit comes in smaller than ${govFrom === 'market' ? 'priced' : 'projected'}`, note: `A full-year deficit of ${pct(dNeed)} closes the gap on its own${pFitTxt ? `; Kalshi gives that ${pFitTxt}` : ''}.${fin(imfVsMkt) ? ` The market's ${pct(D)} is ${Math.abs(imfVsMkt).toFixed(1)} points ${imfVsMkt > 0 ? 'above' : 'below'} the IMF's ${weo || ''} projection of ${pct(imfG(Y))}, both on the IMF's measure, which is worth ${(Math.abs(imfVsMkt) * amp).toFixed(1)} points of borrowing in ${span}${weoEarly ? '; the IMF made it before any of the year was reported' : ''}.` : ''}${fin(sum12) && fin(prev12) ? ` Treasury's 12-month cash deficit is ${usd(sum12)}, ${sum12 > prev12 ? 'up' : 'down'} from ${usd(prev12)} a year earlier${refunds >= 10 ? ` (${usd(refunds)} of it customs refunds)` : ''}.` : ''}` }
          : { label: `The deficit comes in larger than ${govFrom === 'market' ? 'priced' : 'projected'}`, note: `A full-year deficit of ${pct(dNeed)} would absorb what the other sectors lend${pFitTxt ? `; Kalshi gives that ${pFitTxt}` : ''}.${fin(imfVsMkt) ? ` The market's ${pct(D)} is ${Math.abs(imfVsMkt).toFixed(1)} points ${imfVsMkt > 0 ? 'above' : 'below'} the IMF's projection of ${pct(imfG(Y))}, both on the IMF's measure.` : ''}` },
        short
          ? { label: 'Foreigners lend more', note: `The current-account deficit would have to run at ${pct(fNeed)} of GDP${recF ? `, against a record ${pct(recF.v)}` : ''}. More borrowing from abroad usually comes with a firmer dollar or higher yields to attract it.${widerTrade ? ` The trade deficit has widened to ${usdB(tradePost)} a month since ${qtr(dq)}, which shows up as more foreign lending; it funds the government only in so far as the extra imports are not paid for by businesses or households borrowing more, and equipment for the AI build would be.` : ''}` }
          : { label: 'Foreigners lend less', note: `The current-account deficit narrows to ${pct(fNeed)} of GDP: imports slow or exports pick up${widerTrade ? `, though the trade deficit has widened to ${usdB(tradePost)} a month since ${qtr(dq)}` : ''}.` },
        fin(sNeed) ? (short
          ? { label: 'Households save more', note: `The saving rate would have to average ${pct(sNeed)} rather than ${pct(sRem)}${!fin(sPre) ? '' : sNeed < sPre - 0.1 ? (lowSave ? `, back toward the ${pct(sPre)} of 2015-19` : '') : `, ${sNeed > sPre + 0.1 ? 'above' : 'about'} the 2015-19 average of ${pct(sPre)}`}. It has tended to climb after a fall in wealth (a stock-market or house-price drop) or when jobs look less secure, and consumer spending slows with it.` }
          : { label: 'Households save less', note: `The saving rate would average ${pct(sNeed)} rather than ${pct(sRem)}: consumers spend more of their income.` }) : null,
        short
          ? { label: 'Businesses lend more', note: `Business lending would rise to ${pct(bNeed)} of GDP: profits up or investment down. Deficits feed profits (the Profits engine): if the extra borrowing is itself paid out to the private sector, as more tariff refunds or tax cuts would be, it comes back as private saving and funds itself; a slower capex boom does the rest.` }
          : { label: 'Businesses invest more', note: `Business lending falls to ${pct(bNeed)} of GDP as capex outruns profits: the AI build absorbs the spare saving.` },
        { label: 'The figures are measured differently', note: [fin(gapG) && `${govFrom === 'market' ? "Kalshi settles on the IMF's first estimate, and the" : 'The'} IMF's ${basisTag} for ${basisG.y} is ${Math.abs(gapG).toFixed(2)} points ${gapG > 0 ? 'below' : 'above'} BEA's current figure.`, fin(sd0) && `BEA's statistical discrepancy (GDP less GDI) is ${sgn(sd0)} of GDP in ${qtr(dq)}${sdOpp ? `, against ${sgn(sdOpp.v)} in ${qtr(sdOpp.d)}` : ''}.`, `Revisions and these gaps move a half-year's balances by as much as the gap, in either direction.`].filter(Boolean).join(' ') },
      ].filter(Boolean),
      watch: [
        { label: `BEA sector balances for ${qtr(addMonths(dq, 3))}`, display: `${pct(bRem)} implied`, note: `government borrowing against the ${pct(bRem)} ${mktWord} figure implies for ${span} (a single quarter is noisier); out with BEA's second GDP estimate, which carries income, about two months after the quarter` },
        fin(tradeQ) ? { label: 'Monthly trade deficit', display: `${usdB(TR.get(last(trade).d))} (${mon(last(trade).d)})`, note: fin(tradeNeed) ? `foreign lending shows here first; about ${usdB(tradeNeed)} a month closes the gap through foreigners alone` : 'foreign lending shows here first' } : null,
        lastM ? { label: 'Personal saving rate', display: `${pct(lastM.v)} (${mon(lastM.d)})`, note: [sMkt && `priced at ${pct(sMkt.median)} for December`, sThin && `Kalshi's thin December market leans to ${qTxt({ v: sThin.median, edge: sThin.edge })} (middle half ${qTxt(sThin.q25)} to ${qTxt(sThin.q75)}), too lightly traded to use`, fin(sNeed) && `${pct(sNeed)} on average closes the gap through households alone`].filter(Boolean).join('; ') } : null,
        fin(sum12) ? { label: 'Treasury 12-month deficit', display: usd(sum12), note: `the monthly statement, about eight business days after each month ends${fyMkt ? `; fiscal ${fyMkt.fy}'s total comes with the year-end statement${fyMkt.closes ? ` (about ${day(fyMkt.closes.slice(0, 10))})` : ''}, and Kalshi gives ${prob(fyMkt.p)} to it coming in under ${fyMkt.below}% of GDP` : ''}` } : null,
        mkt ? { label: `Kalshi ${Y} deficit market`, display: pct(D), note: `settles on the IMF's April ${Y + 1} estimate; a trade on the strikes around the median would confirm or move the quoted price; the IMF's next outlook is its next input` } : null,
      ].filter(Boolean),
      math: [
        `The identity, ${qtr(dq)}: government ${spct(g0, 2)} + households ${spct(h0, 2)} + businesses ${spct(b0, 2)} + foreigners ${spct(f0, 2)} = ${spct(g0 + h0 + b0 + f0, 2)} of GDP. BEA's private balance carries the statistical discrepancy (GDP less GDI${fin(sd0) ? `, ${spct(sd0, 2)} of GDP` : ''}), so the sum is zero by construction.${fin(z1fPct) ? ` The Fed's Z.1 puts foreign lending at ${pct(z1fPct, 2)}, ${Math.abs(z1fPct - f0).toFixed(2)} pp from BEA's: the size of the measurement noise.` : ''}`,
        mkt ? `Kalshi ${mkt.event}, probability the ${Y} balance is above each strike: ${mkt.strikes.map(s => `${spct(s.k)} ${prob(s.p)}`).join(', ')}. The ladder crosses 50% at ${spct(mkt.median, 2)} (the median; the probability-weighted mean is ${spct(mkt.mean, 2)}).${fin(mkt.bidMed) && fin(mkt.askMed) ? ` On bid prices alone it crosses at ${spct(mkt.bidMed, 2)}, on ask prices at ${spct(mkt.askMed, 2)}.` : ''}${fin(mkt.lastMed) ? ` On each strike's last trade${mkt.lastFrom ? ` (${day(mkt.lastFrom)} to ${day(mkt.lastTo)})` : ''} it crosses at ${spct(mkt.lastMed, 2)}.` : ''} Prices are bid/ask midpoints, or the last trade when the spread is over 10¢; strikes with under ${STRIKE_MIN.toLocaleString()} contracts traded are dropped, and a strike not traded for ${RECENT_DAYS} days is priced by quotes alone.` : `No usable deficit market for ${Y}; the IMF's projected change stands in.`,
        // quarterly figures are annual rates, so a quarter's actual dollars are a quarter of them
        obsQs.length && govFrom === 'market' ? `Government borrowing in ${span}: ${pct(D, 2)} of ${usd((obsGdp + remGdp) / 4)} of GDP in ${Y} is ${usd(((D / 100) * (obsGdp + remGdp)) / 4)} for the year; less the ${usd(obsSum(borS) / 4)} borrowed in ${obsLabel} leaves ${usd(((D / 100) * (obsGdp + remGdp) - obsSum(borS)) / 4)}, which is ${pct(bRem, 2)} of the ${usd(remGdp / 4)} of GDP in ${span}. Each 0.1 point on the full-year figure moves this rate, and the gap, by ${(0.1 * amp).toFixed(2)} points. Quarters not yet reported grow at the past year's ${pct(gq * 400, 1)} nominal pace.` : null,
        basis.length ? `IMF against BEA, full years: ${basis.map(b => `${b.y} ${[fin(b.imfG) && fin(b.beaG) && `deficit ${pct(b.imfG)} vs ${pct(b.beaG, 2)}`, fin(b.imfF) && fin(b.beaF) && `borrowing from abroad ${pct(b.imfF)} vs ${pct(b.beaF, 2)}`].filter(Boolean).join(', ')}`).join('; ')}. ${!basisG ? `No government-balance comparison this run, so the basis of the ${govFrom === 'market' ? 'Kalshi' : 'IMF'} figure is unchecked.` : Math.abs(gapG) < 0.3 ? `The deficits agree within 0.3 pp, so the IMF${govFrom === 'market' ? ' and Kalshi figures are' : "'s figures are"} read on BEA's basis.` : `For ${basisG.y} the IMF's ${basisTag}${basisEarly && govFrom === 'market' ? ', the kind of figure Kalshi settles on,' : ''} differs from BEA's by ${Math.abs(gapG).toFixed(2)} pp. ${govFrom === 'market' ? `Kalshi is still read at face value on BEA's basis, and IMF projections are read as changes from the IMF's own ${Y - 1} figures; a miss that size on ${Y} would move borrowing in ${span} by about ${(Math.abs(gapG) * amp).toFixed(1)} pp.` : `IMF projections are therefore read as changes from the IMF's own ${Y - 1} figures.`}`}` : null,
        fin(sRem) && fin(s0) ? `Saving rate: ${seenM.length ? `${seenM.map(m => `${mon(m).slice(0, 3)} ${pct(PS.get(m))}`).join(', ')} reported, then ` : ''}${sMkt ? `a straight line from ${pct(lastM.v)} (${mon(lastM.d)}) to the ${pct(sMkt.median, 2)} priced for December` : `held at ${pct(lastM.v)}`}: average ${pct(sRem, 2)} over ${span} against ${pct(s0, 2)} in ${qtr(dq)}. Disposable income is ${(dpiR * 100).toFixed(0)}% of GDP, so household lending ${sRem < s0 ? 'falls' : 'rises'} by ${Math.abs((sRem - s0) * dpiR).toFixed(2)} pp of GDP, from ${pct(hhRun, 2)} to ${pct(hRem, 2)}, with their home-building held steady.${sThin ? ` Kalshi's ${sThin.event} buckets: ${sThin.rows.map(r => `${r.label} ${prob(r.q)} (${Math.round(r.volume).toLocaleString()} traded)`).join(', ')}; median ${qTxt({ v: sThin.median, edge: sThin.edge })}, not used.` : ''}` : null,
        forFrom === 'imf' ? `Foreigners: ${pct(f0, 2)} in ${qtr(dq)} plus the IMF's ${pp(fChg)} change for ${Y} gives ${pct(fRem, 2)}. The IMF's full-year ${pct(imfF(Y))} is not backed out: its forecast predates the year's data, and ${obsQs.length ? `making it up would take ${pct(rest(imfF(Y), forS), 2)} in ${span}` : 'the year has not started'}.${fin(fTrade) ? ` The trade deficit ran ${usdB(tradePost)} a month in ${postLabel} against ${usdB(tradeQ)} in ${qtr(dq)}; if that held for ${span} with nothing else moving, foreigners would lend about ${pct(fTrade, 2)}, but whoever buys the extra imports borrows more too.` : ''}` : `Foreigners held at the ${qtr(dq)} pace, ${pct(f0, 2)}: the IMF's current-account projection is unavailable.`,
        `Gap: ${pct(bRem, 2)} borrowed − (${pct(hRem, 2)} + ${pct(busRun, 2)} + ${pct(fRem, 2)}) lent = ${spct(R, 2).replace('%', ' pp')} of GDP. Against ${qtr(dq)}: government ${pp(dGov, 2)}, households ${pp(dHh, 2)}, businesses ${pp(dBus, 2)}, foreigners ${pp(dFor, 2)}. Tension from 0.75 pp, above the median size of BEA's statistical discrepancy since 1990 (0.6 pp); one input's ordinary error can still produce a gap below 1.5 (a business balance held for two quarters misses by about 1 pp RMS since 1960${govFrom === 'market' && obsQs.length ? `, and each 0.1 on the full-year price is ${(0.1 * amp).toFixed(2)} here` : ''}). Contradiction from 1.5 pp: ${fin(thrShare) ? `a ${WORD[H] || H}-quarter private-sector ${dir > 0 ? 'rise' : 'fall'} that large came in ${shareTxt(thrShare)} of windows ${since} (${shareTxt(thrShare2)} counting moves either way).` : 'a private-sector swing rarely seen outside recessions.'}${fin(needShare) ? ` Closing this gap through the private sector alone takes a move of ${pp(need, 2)} from ${qtr(dq)} (the gap less the household change already assumed), matched or exceeded in ${shareTxt(needShare)} of them.` : ''}`,
        variants.length ? `Gap under other single readings: ${variants.map(v => `${v.long}: ${spct(v.r, 2).replace('%', ' pp')}`).join('; ')}.` : null,
        dropped.length ? `Not used this run: ${dropped.join('; ')}.` : null,
      ].filter(Boolean),
      sources: [
        { label: 'Kalshi: US government budget balance (KXGOVBAL)', url: 'https://kalshi.com/markets/kxgovbal' },
        { label: 'Kalshi: US personal saving rate (KXPSAVERT)', url: 'https://kalshi.com/markets/kxpsavert' },
        fyMkt ? { label: 'Kalshi: federal deficit-to-GDP (KXDEFGDP)', url: 'https://kalshi.com/markets/kxdefgdp' } : null,
        { label: 'IMF World Economic Outlook via DataMapper: government balance', url: 'https://www.imf.org/external/datamapper/GGXCNL_NGDP@WEO/USA' },
        { label: 'IMF World Economic Outlook via DataMapper: current account', url: 'https://www.imf.org/external/datamapper/BCA_NGDPD@WEO/USA' },
        { label: 'BEA net lending by sector, NIPA Table 5.1 (FRED)', url: 'https://fred.stlouisfed.org/series/AD01RC1Q027SBEA' },
        { label: 'Monthly Treasury Statement deficit (FRED)', url: 'https://fred.stlouisfed.org/series/MTSDS133FMS' },
        { label: 'US trade balance, goods and services (FRED)', url: 'https://fred.stlouisfed.org/series/BOPGSTB' },
        { label: 'Fed Z.1: rest of the world net lending (FRED)', url: 'https://fred.stlouisfed.org/series/RWLBACQ027S' },
        { label: 'CBO natural rate of unemployment (FRED)', url: 'https://fred.stlouisfed.org/series/NROU' },
      ].filter(Boolean),
    }
  },
}
