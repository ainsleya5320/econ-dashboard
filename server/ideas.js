// ============================================================================
// IDEAS — the trade recommender behind /ideas. Three buckets, each idea a call
// in one line, a few sentences of why, what would change it and a horizon,
// with a link back to the dashboard view that holds the evidence. Rules only:
// no model, nothing to pay per idea, and every call can be traced to a number.
//
//   stocks    the Magic Formula (server/magicFormula.js), ranked across all
//             U.S. stocks and grouped by sector; the page picks the floor
//   special   the Special Situations scorer (server/specialScore.js): ideas
//             graded A or B, plus open odd-lot tenders with a positive edge
//             (server/specialSituations.js). Ideas marked "not interested" on
//             the dashboard's Top ideas view stay hidden here too.
//   fixed     rules on FRED (Treasury curve, TIPS real yields and breakevens,
//             ICE BofA credit spreads, Freddie Mac mortgage rates, CPI) and on
//             bond and municipal closed-end fund discounts (server/cefDiscounts.js)
//
// The fixed-income and special buckets are rebuilt at most every 10 minutes;
// the stock bucket is read live, since it fills in while its first build runs.
// A Special Situations rebuild can take minutes, so this waits 8 seconds for it
// and otherwise serves the last copy it has. Nothing is cached on disk.
// ============================================================================
const MIN = 60e3, TTL = 10 * MIN
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 1) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const f2 = v => (fin(v) ? v.toFixed(2) : '—')
const f1 = v => (fin(v) ? v.toFixed(1) : '—')
const minus = s => String(s).replace(/^-/, '−') // typographic minus for negative readings
const an = s => `${/^(8|11|18)/.test(s) ? 'an' : 'a'} ${s}` // "an 8.5", "a 6.0"
const scrub = s => String(s?.message || s || '').replace(/apikey=[^&\s"]+/gi, 'apikey=…').slice(0, 200)
const cap = s => (s ? s[0].toUpperCase() + s.slice(1) : s)
const sentence = s => { const t = cap(String(s || '').trim()); return t && !/[.!?]$/.test(t) ? `${t}.` : t }
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { timeout: true })), ms))])
const monthDay = d => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : null)
const monthYear = d => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }) : null)
const year = d => (d ? d.slice(0, 4) : null)

const LINK = {
  rates: { label: 'Bonds → Rates & mortgages', href: '/?view=bonds&sub=rates' },
  credit: { label: 'Bonds → Corporate credit', href: '/?view=bonds&sub=credit' },
  cef: { label: 'Stocks → Closed-end funds', href: '/?view=stocks&sub=cef' },
  special: { label: 'Stocks → Special Situations', href: '/?view=stocks&sub=special' },
}

// Special Situations categories: what each trade is, how long it usually takes, what ends it
const SS = {
  reorg: { kind: 'Post-bankruptcy stock', horizon: '3 to 12 months', change: 'The edge is forced selling by creditors who never wanted stock. After a few months of normal trading it is gone, and a first quarter that misses the reorganization plan\'s projections would undercut the case.' },
  '13D': { kind: 'Activist stake', horizon: '6 to 18 months', change: 'The activist selling down, or settling for less than a board seat or a sale process.' },
  recap: { kind: 'Tender or recapitalization', horizon: 'Until the offer closes', change: 'The offer being withdrawn or cut, or the shares running above the offer price.' },
  insider: { kind: 'Insider buying', horizon: '6 to 12 months', change: 'Insiders turning sellers, or the price running well above where they bought.' },
  buyback: { kind: 'Buyback', horizon: 'About 12 months', change: 'The company not executing the buyback, or issuing new stock that offsets it.' },
  merger: { kind: 'Merger arbitrage', horizon: 'Until the deal closes', change: 'A regulatory, financing or shareholder-vote problem. A sharply wider spread is the market\'s warning.' },
  spinoff: { kind: 'Spinoff', horizon: 'The first 6 months after the spin', change: 'Forced selling by index funds and parent holders usually ends within a few months; after that the first standalone quarters decide it.' },
  rights: { kind: 'Rights offering', horizon: 'Until the rights expire', change: 'The offering being undersubscribed or its backstop falling away.' },
  spac: { kind: 'SPAC below trust', horizon: 'Until the vote or the deadline', change: 'A deal announcement that lifts the shares above the trust value, which removes the floor.' },
}

// The CEF view's monthly panel (month-end discount, its one-year z-score, the month's total return per fund):
// bond and municipal funds at a 5–25% discount and z ≤ −2 at a month-end, against the average bond fund's
// return over the next month and the month after (the fast-reversal check)
function cefBacktest(panel) {
  if (!panel?.months?.length || !panel.funds?.length) return null
  const last = panel.months.length - (panel.lastPartial ? 1 : 0)
  const funds = panel.funds.filter(f => ['Taxable bond', 'Municipal'].includes(f.fam))
  const avg = m => { const v = funds.map(f => f.tr?.[m]).filter(fin); return v.length >= 30 ? v.reduce((a, b) => a + b, 0) / v.length : null }
  const next = [], after = []
  let from = null
  for (let m = 0; m + 1 < last; m++) {
    const a1 = avg(m + 1), a2 = m + 2 < last ? avg(m + 2) : null
    if (!fin(a1)) continue
    for (const f of funds) {
      const z = f.z?.[m], d = f.disc?.[m]
      if (!(fin(z) && z <= -2 && fin(d) && d <= -5 && d >= -25)) continue
      if (fin(f.tr?.[m + 1])) { next.push(f.tr[m + 1] - a1); from ??= panel.months[m] }
      if (fin(a2) && fin(f.tr?.[m + 2])) after.push(f.tr[m + 2] - a2)
    }
  }
  if (next.length < 30) return null
  const mean = v => v.reduce((a, b) => a + b, 0) / v.length
  return { n: next.length, next: mean(next), after: after.length ? mean(after) : null, hit: Math.round((next.filter(x => x > 0).length / next.length) * 100), from: `${from}-01` }
}

export function createIdeas({ magic, special, cef, fred }) {
  let cache = null, cacheAt = 0, inflight = null, lastSpecial = null
  let partial = false // a source timed out this round: rebuild after a minute rather than ten

  // ── special situations ───────────────────────────────────────────────────
  async function specialBucket(errors) {
    let ss = null
    const p = special.get()
    p.then(v => { lastSpecial = v }).catch(() => {}) // a slow rebuild still lands for next time
    try { ss = await withTimeout(p, 8000) } catch (e) {
      ss = lastSpecial
      if (e.timeout) partial = true
      errors.push(e.timeout ? `Special Situations is rebuilding${ss ? '; showing the previous copy' : '; check back in a few minutes'}` : `Special Situations: ${scrub(e)}`)
    }
    if (!ss) return { ideas: [], asOf: null }
    let dismissed = new Set()
    try { dismissed = new Set(special.dealBook.list().dismissed || []) } catch {}
    const reorgBy = new Map((ss.reorg || []).filter(r => r.ticker).map(r => [r.ticker, r]))
    const out = []
    // odd lots first: the most mechanical trades on the board
    const lots = (ss.oddlots || []).filter(o => o.stage === 'open' && fin(o.edge) && o.edge > 0 && ['stated', 'in letter', 'mentioned'].includes(o.priority) && (o.daysToExpiry ?? 0) >= 2)
    const lotTickers = new Set()
    for (const o of lots) {
      lotTickers.add(o.ticker)
      const firm = o.priority !== 'mentioned'
      const offer = o.type === 'Dutch auction' && fin(o.low) && fin(o.high) ? `a Dutch auction at $${f2(o.low)} to $${f2(o.high)}` : fin(o.fixed) ? `a tender at $${f2(o.fixed)}` : o.type
      out.push({
        id: `oddlot:${o.ticker}:${o.filed}`, bucket: 'special', kind: 'Odd-lot tender', ticker: o.ticker, name: o.name,
        call: firm ? 'Buy 99 shares and tender them' : 'Check the odd-lot clause, then buy 99 and tender',
        why: `${o.name} is buying back stock in ${offer}. Holders of fewer than 100 shares are bought first, without proration, so 99 shares bought near $${f2(o.price)} and tendered should return about $${f2(o.edge)} a share (${f1(o.edgePct)}%), $${f2(o.gross)} on $${Math.round(o.capital)}. The gain is figured on ${/^bottom/.test(o.basisNote || '') ? 'the ' : ''}${o.basisNote}.${firm ? '' : ' The offer mentions odd lots but the priority clause could not be confirmed: read the "Odd Lots" section of the offer before buying.'}`,
        change: `The offer being withdrawn or a condition failing${o.financing ? ' (it has a financing condition)' : ''}, or the stock trading up to the offer. Tender through your broker a day or two before the deadline: brokers close earlier than the offer.`,
        horizon: `Until ${monthDay(o.expiry)} (${o.daysToExpiry} days)`, strength: firm ? 'strong' : 'moderate', score: firm ? 90 : 70, date: o.filed,
        facts: [o.type, fin(o.edgePct) ? `edge ${f1(o.edgePct)}%` : null, `expires ${monthDay(o.expiry)}`].filter(Boolean),
        links: [LINK.special, { label: 'Offer filing', href: o.url, external: true }],
      })
    }
    const graded = (ss.ideas || []).filter(i => i.score >= 45 && !dismissed.has(i.id))
    for (const i of graded) {
      if (i.cat === 'recap' && lotTickers.has(i.ticker)) continue // the odd-lot card covers it
      // The reorg board prices only the new stock, so a post-reorganisation idea under ten cents is most likely an
      // old share it could not tell was being cancelled, and a sub-dime stock is no buy on this page either way
      const r = i.cat === 'reorg' ? reorgBy.get(i.ticker) : null
      if (r && fin(r.price) && r.price < 0.1) continue
      const meta = SS[i.cat] || { kind: i.cat, horizon: '—', change: '' }
      const reasons = [...(i.reasons || [])].sort((a, b) => b.pts - a.pts).slice(0, 3).map(x => sentence(x.why))
      const risks = (i.risks || []).slice(0, 2).map(x => sentence(x.why))
      out.push({
        id: i.id, bucket: 'special', kind: meta.kind, ticker: i.ticker, name: i.name, grade: i.grade,
        call: i.grade === 'A' ? 'Research now' : 'Worth a look',
        why: reasons.join(' '), headline: i.headline,
        change: [meta.change, ...risks.map(r => `Watch: ${r}`)].filter(Boolean).join(' '),
        horizon: i.catalyst?.date ? `${cap(i.catalyst.label)} ${monthDay(i.catalyst.date)}` : meta.horizon,
        strength: i.grade === 'A' ? 'strong' : 'moderate', score: i.score, date: i.date,
        links: [LINK.special, ...(i.url ? [{ label: 'Filing', href: i.url, external: true }] : [])],
      })
    }
    out.sort((a, b) => b.score - a.score)
    return { ideas: out.slice(0, 16), asOf: ss.built || (ss.ts ? new Date(ss.ts).toISOString() : null), considered: graded.length + lots.length }
  }

  // ── fixed income ─────────────────────────────────────────────────────────
  const last = s => (s?.length ? s[s.length - 1] : null)
  const valueOn = (s, d) => { let v = null; for (const o of s || []) { if (o.d > d) break; v = o.v } return v }
  // "the highest since 2007": the latest earlier date, at least 60 days back, with a reading at or past this one
  function since(s, v, dir = 1) {
    const end = last(s); if (!end) return null
    const cutoff = new Date(Date.parse(end.d) - 60 * 864e5).toISOString().slice(0, 10)
    for (let i = s.length - 1; i >= 0; i--) if (s[i].d < cutoff && (dir > 0 ? s[i].v >= v : s[i].v <= v)) return { d: s[i].d, found: true }
    return { d: s[0].d, found: false }
  }
  const sinceTxt = (r, what) => (r ? (r.found ? `the ${what} since ${year(r.d)}` : `the ${what} in the data back to ${year(r.d)}`) : null)

  async function fixedBucket(errors) {
    const ids = { b3: 'DGS3MO', t2: 'DGS2', t10: 'DGS10', t30: 'DGS30', real: 'DFII10', be: 'T10YIE', cpi: 'CPIAUCSL', hy: 'BAMLH0A0HYM2', ig: 'BAMLC0A0CM', mort: 'MORTGAGE30US' }
    const limits = { t10: 6000, t30: 6000, real: 6000, mort: 1000, cpi: 30 }
    const got = await Promise.all(Object.entries(ids).map(([k, id]) => fred(id, limits[k] || 800).then(s => [k, s]).catch(() => [k, []])))
    const S = Object.fromEntries(got)
    const missing = Object.entries(S).filter(([, s]) => !s?.length).map(([k]) => ids[k])
    if (missing.length) errors.push(`FRED: no data for ${missing.join(', ')}`)
    const L = Object.fromEntries(Object.entries(S).map(([k, s]) => [k, last(s)]))
    const cpiYoy = (() => { const s = S.cpi; if (!s || s.length < 13) return null; return (s[s.length - 1].v / s[s.length - 13].v - 1) * 100 })()
    const cpiAsOf = last(S.cpi)?.d
    const out = []
    const add = o => out.push({ bucket: 'fixed', ...o })

    // the curve: how far out to lend
    if (L.b3 && L.t10) {
      const slope = L.t10.v - L.b3.v, real = fin(cpiYoy) ? L.b3.v - cpiYoy : null
      const cash = fin(real) ? (real >= 0 ? ` Cash also beats inflation by ${f1(real)} points (CPI rose ${f1(cpiYoy)}% over the year to ${monthYear(cpiAsOf)}).` : ` Bills trail inflation by ${f1(-real)} points, though (CPI rose ${f1(cpiYoy)}% over the year to ${monthYear(cpiAsOf)}).`) : ''
      if (slope < 0) add({ id: 'fi:curve', kind: 'Treasury curve', call: 'Stay short: T-bills and 1-year Treasuries', why: `Three-month bills pay ${f2(L.b3.v)}% against ${f2(L.t10.v)}% for ten years, so you are paid more to stay short and take no interest-rate risk.${cash}`, change: 'The curve turning positive (the ten-year above bills), or the Fed starting to cut: bill yields fall within weeks of a cut, while a longer bond would have kept the higher rate.', horizon: 'Roll every 3 to 6 months', strength: slope < -0.5 ? 'strong' : 'moderate', score: 60, date: L.t10.d, links: [LINK.rates] })
      else if (slope < 1) add({ id: 'fi:curve', kind: 'Treasury curve', call: 'Ladder Treasuries from 1 to 5 years', why: `Ten-year Treasuries pay only ${f2(slope)} points more than three-month bills (${f2(L.t10.v)}% against ${f2(L.b3.v)}%), so going long earns little extra. A ladder keeps most of the bill yield while locking part of it in case short rates fall.${cash}`, change: 'The curve steepening past a point (time to extend toward ten years) or inverting (stay in bills).', horizon: '1 to 5 years, rolling', strength: 'moderate', score: 50, date: L.t10.d, links: [LINK.rates] })
      else add({ id: 'fi:curve', kind: 'Treasury curve', call: 'Extend: 7- to 10-year Treasuries', why: `The ten-year pays ${f2(slope)} points over three-month bills (${f2(L.t10.v)}% against ${f2(L.b3.v)}%). A steep curve pays you to lock rates in, and the extra yield cushions the price if rates rise.${cash}`, change: 'Inflation re-accelerating, which pushes long yields up and prices down, or the curve flattening back under a point.', horizon: '1 to 3 years', strength: slope >= 1.5 ? 'strong' : 'moderate', score: 65, date: L.t10.d, links: [LINK.rates] })
    }

    // TIPS: the real yield, and breakeven inflation against what inflation is doing now
    if (L.real && L.be) {
      const cheapVsCpi = fin(cpiYoy) && L.be.v < cpiYoy - 0.5
      const cpiTxt = fin(cpiYoy) ? ` Inflation ran ${f1(cpiYoy)}% over the past year${cheapVsCpi ? ', well above that, so the protection is cheap' : ''}.` : ''
      if (L.real.v >= 2) {
        const s = since(S.real, L.real.v)
        add({ id: 'fi:tips', kind: 'TIPS', call: 'Buy 10-year TIPS', why: `Ten-year TIPS pay ${f2(L.real.v)}% above inflation, guaranteed if held to maturity: ${sinceTxt(s, 'most') || 'a high level'}. Breakeven inflation is ${f2(L.be.v)}%: TIPS beat ordinary Treasuries if inflation averages more than that.${cpiTxt}`, change: `Real yields falling back under about 1.5%, which would take the gain early; held to maturity, TIPS lose to ordinary Treasuries only if inflation averages below ${f2(L.be.v)}%.`, horizon: 'Hold to maturity (10 years) or until real yields fall', strength: L.real.v >= 2.25 ? 'strong' : 'moderate', score: 75, date: L.real.d, links: [LINK.rates] })
      } else if (cheapVsCpi) {
        add({ id: 'fi:tips', kind: 'TIPS', call: 'Favor TIPS over ordinary Treasuries', why: `The market prices ${f2(L.be.v)}% a year of inflation over ten years while CPI rose ${f1(cpiYoy)}% over the year to ${monthYear(cpiAsOf)}. TIPS pay ${f2(L.real.v)}% above whatever inflation turns out to be, so they win if it stays anywhere near today's pace.`, change: `Inflation falling toward ${f2(L.be.v)}% or below, at which point ordinary Treasuries do as well.`, horizon: '1 to 3 years', strength: 'moderate', score: 60, date: L.be.d, links: [LINK.rates] })
      } else if (L.real.v <= 0.5) {
        add({ id: 'fi:tips', kind: 'TIPS', call: 'Avoid TIPS: real yields are thin', why: `Ten-year TIPS pay only ${f2(L.real.v)}% above inflation. Ordinary Treasuries at ${f2(L.t10?.v)}% beat them unless inflation averages above ${f2(L.be.v)}%.${cpiTxt}`, change: 'Real yields rising back above 1.5%.', horizon: '—', strength: 'moderate', score: 40, date: L.real.d, links: [LINK.rates] })
      }
    }

    // credit: what you are paid over Treasuries for default risk
    if (L.hy) {
      if (L.hy.v <= 3) add({ id: 'fi:hy', kind: 'High-yield credit', call: 'Underweight high-yield bonds', why: `Junk bonds pay just ${f2(L.hy.v)} points over Treasuries (ICE BofA U.S. High Yield index), against about 5 points on average since the late 1990s. That leaves little cushion for defaults, and spreads this tight have tended to widen sharply when the economy turns.`, change: 'Spreads widening past about 4.5 points, which would start to pay for the risk.', horizon: '6 to 12 months', strength: L.hy.v <= 2.75 ? 'strong' : 'moderate', score: 70, date: L.hy.d, links: [LINK.credit] })
      else if (L.hy.v >= 6) add({ id: 'fi:hy', kind: 'High-yield credit', call: 'Consider adding high-yield bonds', why: `Junk bonds pay ${f2(L.hy.v)} points over Treasuries (ICE BofA U.S. High Yield index), above the long-run average of about 5. Buyers at spreads this wide have usually been paid for the risk, though spreads can widen further in a recession.`, change: 'Defaults rising faster than the spread already pays for; a recession call would argue for waiting.', horizon: '12 to 24 months', strength: L.hy.v >= 7 ? 'strong' : 'moderate', score: 75, date: L.hy.d, links: [LINK.credit] })
    }
    if (L.ig) {
      if (L.ig.v <= 0.9) add({ id: 'fi:ig', kind: 'Investment-grade credit', call: 'Prefer Treasuries over investment-grade corporates', why: `High-grade corporate bonds pay only ${f2(L.ig.v)} points over Treasuries (ICE BofA U.S. Corporate index), against a long-run average of about 1.5. That is little reward for giving up Treasuries' safety and liquidity.`, change: 'The spread widening back above about 1.3 points.', horizon: '6 to 12 months', strength: L.ig.v <= 0.8 ? 'strong' : 'moderate', score: 55, date: L.ig.d, links: [LINK.credit] })
      else if (L.ig.v >= 1.8) add({ id: 'fi:ig', kind: 'Investment-grade credit', call: 'Investment-grade corporates look attractive', why: `High-grade corporate bonds pay ${f2(L.ig.v)} points over Treasuries (ICE BofA U.S. Corporate index), above the long-run average of about 1.5, for companies that rarely default.`, change: 'Downgrades picking up, which pushes fallen angels into the junk market.', horizon: '12 to 24 months', strength: L.ig.v >= 2.2 ? 'strong' : 'moderate', score: 65, date: L.ig.d, links: [LINK.credit] })
    }

    // agency mortgages: the 30-year mortgage rate over the ten-year Treasury
    if (L.mort && S.t10?.length) {
      const t = valueOn(S.t10, L.mort.d), spread = fin(t) ? L.mort.v - t : null
      if (fin(spread) && spread >= 2.5) {
        const sp = (S.mort || []).map(o => ({ d: o.d, v: fin(valueOn(S.t10, o.d)) ? o.v - valueOn(S.t10, o.d) : null })).filter(o => fin(o.v))
        add({ id: 'fi:mbs', kind: 'Agency mortgages', call: 'Agency mortgage bonds look cheap', why: `The 30-year mortgage rate (${f2(L.mort.v)}%, Freddie Mac) is ${f2(spread)} points above the ten-year Treasury, ${sinceTxt(since(sp, spread), 'widest') || 'a wide gap'}, against about 1.7 points in normal times. Agency mortgage-backed bonds, guaranteed by Fannie Mae, Freddie Mac or Ginnie Mae, pay unusually well over Treasuries.`, change: 'The gap narrowing toward 2 points (the gain is taken) or interest rates turning volatile, which hurts mortgage bonds most.', horizon: '12 to 24 months', strength: spread >= 2.8 ? 'strong' : 'moderate', score: 60, date: L.mort.d, links: [LINK.rates] })
      }
    }

    // the long bond at 5%
    if (L.t30 && L.t30.v >= 5) {
      const s = since(S.t30, L.t30.v)
      add({ id: 'fi:long', kind: 'Long Treasuries', call: `Lock in 30-year Treasuries at ${f2(L.t30.v)}%`, why: `The 30-year Treasury yields ${f2(L.t30.v)}%, ${sinceTxt(s, 'highest') || 'a high level'}.${fin(L.be?.v) ? ` That is about ${f1(L.t30.v - L.be.v)} points over the inflation the market expects.` : ''} Held to maturity the return is fixed; along the way the price swings hard with rates.`, change: 'Inflation re-accelerating or deficits widening further, either of which can push long yields higher (and prices lower) first.', horizon: 'Years, or until yields fall', strength: L.t30.v >= 5.25 ? 'strong' : 'moderate', score: 65, date: L.t30.d, links: [LINK.rates] })
    }

    // bond and municipal closed-end funds unusually cheap against their own history
    let cefNote = null
    try {
      const c = await withTimeout(cef.get(), 8000)
      const funds = (c.funds || []).filter(f => ['Taxable bond', 'Municipal'].includes(f.family) && fin(f.disc) && fin(f.z1y) && (f.advUsd || 0) >= 500e3)
      // past a 25% discount or a 20% payout the market doubts the NAV itself (private credit, CLO equity): a credit call, not a discount trade
      const doubt = funds.filter(f => f.disc < -25 || (f.distPrice || 0) > 20)
      const cands = funds.filter(f => f.disc <= -5 && f.z1y <= -2 && f.disc >= -25 && (f.distPrice || 0) <= 20).sort((a, b) => a.z1y - b.z1y)
      // the cheapest four, at most two from one category
      const pick = [], perCat = {}
      for (const f of cands) { const k = f.cat || f.family; if ((perCat[k] || 0) < 2 && pick.length < 4) { pick.push(f); perCat[k] = (perCat[k] || 0) + 1 } }
      const byCat = Object.entries(cands.reduce((o, f) => ({ ...o, [f.cat || f.family]: (o[f.cat || f.family] || 0) + 1 }), {})).sort((a, b) => b[1] - a[1])
      const crowd = byCat[0] && byCat[0][1] >= 3 && byCat[0][1] >= cands.length / 2 ? ` ${byCat[0][1]} of the ${cands.length} funds this cheap are ${byCat[0][0].toLowerCase()} funds, so this is partly one corner of the market selling off rather than separate bargains; the cards show at most two of them.` : ''
      cefNote = `${funds.length} bond and municipal closed-end funds trading over $500K a day were screened and ${cands.length} pass${doubt.length ? `; ${doubt.length} past a 25% discount or a 20% payout were left out, since at that point the market doubts the reported NAV` : ''}.${crowd}`
      const bt = cefBacktest(c.panel)
      const pts = v => `${f1(Math.abs(v * 100))} points`
      const btTxt = bt ? `Since ${year(bt.from)}, bond funds this cheap at a month-end ${bt.next >= 0 ? 'beat' : 'trailed'} the average bond fund by ${pts(bt.next)} the next month (${bt.hit}% of ${bt.n.toLocaleString()} cases)${fin(bt.after) ? `, and ${bt.after >= 0 ? 'beat it' : 'trailed it'} by ${pts(bt.after)} the month after` : ''}.` : null
      // the whole market cheap at once: a basket call, ahead of the single funds
      const medZ = funds.length ? [...funds].sort((a, b) => a.z1y - b.z1y)[Math.floor(funds.length / 2)].z1y : null
      if (fin(medZ) && medZ <= -1 && cands.length >= 10) {
        add({
          id: 'fi:cef:basket', kind: 'Bond closed-end funds', call: 'Buy a basket of the cheapest bond closed-end funds',
          why: `${cands.length} of ${funds.length} bond and municipal funds trade at least two standard deviations cheaper than their own one-year average discount, and the median fund sits at ${minus(f2(medZ))}: the whole market has cheapened, not one fund at a time. ${btTxt || ''} Spreading the bet over 10 to 20 of them cuts the risk of one fund's distribution cut.`,
          change: 'Bond prices still falling, which can keep discounts widening for a while; and the edge has shown up quickly, so take it when discounts narrow rather than waiting.',
          horizon: '1 to 2 months', strength: medZ <= -1.5 ? 'strong' : 'moderate', score: 80, date: c.snapshotDate || null,
          facts: [`${cands.length} of ${funds.length} funds 2σ cheap`, `median z ${minus(f2(medZ))}`],
          links: [LINK.cef],
        })
      }
      for (const f of pick) {
        const watch = []
        if (fin(f.coverage) && f.coverage < 0.9) watch.push(`income covers only ${Math.round(f.coverage * 100)}% of the payout, so a distribution cut is possible`)
        if (fin(f.roc12) && f.roc12 > 0.3) watch.push(`${Math.round(f.roc12 * 100)}% of last year's payout was return of capital`)
        if (fin(f.lev) && f.lev > 35) watch.push(`${Math.round(f.lev)}% leverage amplifies NAV swings`)
        add({
          id: `fi:cef:${f.t}`, kind: f.family === 'Municipal' ? 'Municipal closed-end fund' : 'Bond closed-end fund', ticker: f.t, name: f.name,
          call: `Buy ${f.t} at ${an(f1(-f.disc))}% discount to NAV`,
          why: `${f.name}${f.cat ? ` (${f.cat.toLowerCase()})` : ''} trades at ${an(f1(-f.disc))}% discount to its net asset value against a one-year average ${fin(f.disc52) ? (f.disc52 < 0 ? `discount of ${f1(-f.disc52)}%` : `premium of ${f1(f.disc52)}%`) : 'that is not on file'}: a z-score of ${minus(f2(f.z1y))}, among the cheapest bond funds against their own history. It pays ${f1(f.distPrice)}% a year on the price.${watch.length ? ` Watch: ${watch.join('; ')}.` : ''}`,
          change: `Discounts that blow out this fast tend to narrow within weeks, so this is a short trade: sell when the discount is back near its one-year average, or after about two months either way.${btTxt ? ` ${btTxt}` : ''}`,
          horizon: '2 to 8 weeks', strength: f.z1y <= -2.5 ? 'strong' : 'moderate', score: 60 + Math.min(20, Math.round(-f.z1y * 5)), date: c.snapshotDate || null,
          facts: [`discount ${f1(-f.disc)}%`, `1-yr z ${minus(f2(f.z1y))}`, `pays ${f1(f.distPrice)}%`],
          links: [LINK.cef],
        })
      }
    } catch (e) { if (e.timeout) partial = true; errors.push(e.timeout ? 'Closed-end funds are refreshing; check back shortly' : `Closed-end funds: ${scrub(e)}`) }

    out.sort((a, b) => b.score - a.score)
    return { ideas: out, asOf: L.t10?.d || null, cefNote, readings: Object.fromEntries(Object.entries(L).filter(([, v]) => v).map(([k, v]) => [k, { id: ids[k], d: v.d, v: rnd(v.v, 3) }])), cpiYoy: rnd(cpiYoy, 2) }
  }

  async function rebuild() {
    const errors = []
    partial = false
    const [sp, fx] = await Promise.all([specialBucket(errors).catch(e => { errors.push(`Special situations: ${scrub(e)}`); return { ideas: [] } }), fixedBucket(errors).catch(e => { errors.push(`Fixed income: ${scrub(e)}`); return { ideas: [] } })])
    return { built: new Date().toISOString(), special: sp, fixed: fx, errors }
  }

  async function get(req) {
    const q = new URL(req?.url || '/', 'http://x').searchParams
    if (q.has('symbol')) return magic.lookup(q.get('symbol'))
    if (q.get('only') === 'stocks') return { stocks: magic.get() }
    if (!cache || Date.now() - cacheAt > TTL || q.has('refresh')) {
      inflight ??= rebuild().then(r => { cache = r; cacheAt = Date.now() - (partial ? TTL - MIN : 0); return r }).finally(() => { inflight = null })
      if (!cache) await inflight; else inflight.catch(() => {})
    }
    return { ...cache, stocks: magic.get() }
  }

  return { get }
}
