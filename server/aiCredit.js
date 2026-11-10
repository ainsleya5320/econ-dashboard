// ============================================================================
// AI CREDIT BASKET — AI Economy → Build-Out: what the bond market charges the
// companies building and supplying AI capacity. The buyers, the neoclouds that
// borrow against contracts, the chip and memory makers, the hardware and the
// landlords, each as a median spread over Treasuries; the gap between the tiers
// is the market's view of who carries the risk of the build-out.
//
// No data of its own and no requests of its own: it reads the daily snapshots
// Bonds → Corporate bonds already keeps (server/corporateBonds.js, finra.org's
// Fixed Income Data, PERSONAL USE ONLY: gitignored, never committed, never
// baked into the Netlify fork) and the Treasury curve fitted on Bonds →
// Treasuries (server/treasuryBonds.js).
//
// Which issuers: data/curated/ai-credit-basket.json in the Research Database
// (server/researchDb.js), because the list names holdings.
//
// Per issuer and day: plain coupon bonds (not convertible, over a year left,
// traded within two weeks) → median yield, median spread and the range.
// Convertibles carry no meaningful yield, so an issuer that has only those is
// shown by average price. The tape keeps 30 days and no past curve, so each
// day's reading is written to ai-credit.json (gitignored) as it is made: a day
// seen only after the fact has yields but no spread.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const BASKET = ['data', 'curated', 'ai-credit-basket.json']
const DAY = 864e5
const fin = v => v != null && Number.isFinite(v)
const rnd = (v, d = 2) => (fin(v) ? Math.round(v * 10 ** d) / 10 ** d : null)
const med = xs => { const v = xs.filter(fin).sort((a, b) => a - b); if (!v.length) return null; const m = (v.length - 1) / 2; return (v[Math.floor(m)] + v[Math.ceil(m)]) / 2 }
const avg = xs => { const v = xs.filter(fin); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null }
const ms = d => Date.parse(`${d}T00:00:00Z`)

// the fitted Treasury yield at t years from the curve's 59 points, straight lines between
export function curveAt(line, t) {
  if (!line?.length || !fin(t)) return null
  if (t <= line[0].years) return line[0].yield
  for (let i = 1; i < line.length; i++) if (t <= line[i].years) { const a = line[i - 1], b = line[i]; return a.yield + ((b.yield - a.yield) * (t - a.years)) / (b.years - a.years) }
  return line.at(-1).yield
}

// Change between two readings over the bonds in both, so a bond that did not trade on one day cannot move the figure:
// median yield and spread change in basis points, average convertible price change in points.
export function matched(now, was) {
  if (!now || !was) return { dYield: null, dSpread: null, dPrice: null, bonds: 0 }
  const both = Object.keys(now.b || {}).filter(c => was.b?.[c]), cv = Object.keys(now.c || {}).filter(c => fin(was.c?.[c]))
  const dy = med(both.map(c => now.b[c][0] - was.b[c][0])), ds = med(both.filter(c => fin(now.b[c][1]) && fin(was.b[c][1])).map(c => now.b[c][1] - was.b[c][1]))
  return { dYield: fin(dy) ? Math.round(dy * 100) : null, dSpread: fin(ds) ? Math.round(ds * 100) : null, dPrice: cv.length ? rnd(avg(cv.map(c => now.c[c] - was.c[c])), 2) : null, bonds: both.length }
}

// One issuer on one day → the reading kept in the history, plus the bonds behind it.
export function readIssuer(bonds, day, line) {
  const t0 = ms(day), recent = t0 - 14 * DAY
  const plain = bonds.filter(b => !b.cv && b.coupon > 0 && fin(b.yield) && b.yield > 0 && b.yield < 40 && ms(b.last) >= recent)
    .map(b => { const years = (ms(b.maturity) - t0) / (365.25 * DAY), ty = curveAt(line, years); return { ...b, years: rnd(years, 1), spread: fin(ty) ? rnd(b.yield - ty, 2) : null } })
    .filter(b => b.years > 1 && b.years < 45).sort((a, b) => a.years - b.years)
  const conv = bonds.filter(b => b.cv && fin(b.price) && b.price > 5 && ms(b.last) >= recent)
  const sp = plain.map(b => b.spread).filter(fin), rated = plain.at(-1) || bonds[0]
  return {
    reading: { n: plain.length, y: rnd(med(plain.map(b => b.yield)), 3), s: rnd(med(sp), 3), lo: sp.length ? Math.min(...sp) : null, hi: sp.length ? Math.max(...sp) : null,
      p: rnd(avg(plain.map(b => b.price)), 2), cn: conv.length, cp: rnd(avg(conv.map(b => b.price)), 2),
      b: Object.fromEntries(plain.map(b => [b.cusip, [b.yield, b.spread]])), c: Object.fromEntries(conv.map(b => [b.cusip, b.price])) },
    bonds: plain, sp: rated?.sp || null, moodys: rated?.moodys || null,
  }
}

export function createAiCredit({ dir, research, corporate, treasury }) {
  const FILE = path.join(dir, 'ai-credit.json')
  let hist = { version: 1, days: {} }
  try { if (fs.existsSync(FILE)) { const d = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (d?.version === 1) hist = d } } catch (e) { console.warn('ai-credit.json:', e.message) }
  const save = () => { try { fs.writeFileSync(FILE, JSON.stringify(hist)) } catch (e) { console.error('ai-credit.json save:', e.message) } }

  async function get() {
    const b = await research.read(BASKET)
    if (!b) return research.missing()
    if (!b.data?.groups?.length) return research.missing('AI credit basket', BASKET)
    const names = b.data.groups.flatMap(g => g.issuers.map(i => i.name))
    let tape, line = null, curveDate = null
    try { await corporate.get(); tape = corporate.issuerSnapshots(names) } catch (e) { return { available: false, researchUrl: research.researchUrl, reason: `The corporate bond tape is not ready: ${String(e?.message || e).slice(0, 160)}` } }
    try { const t = await treasury.get(); line = t?.line?.length ? t.line : null; curveDate = t?.date || t?.asOf || null } catch { /* yields only without the curve */ }
    if (!tape.days.length) return { available: false, researchUrl: research.researchUrl, reason: 'The corporate bond tape has no snapshot yet. Open Bonds → Corporate bonds once to start it.' }

    const d0 = tape.days.at(-1).day, latest = {}
    let wrote = false
    for (const { day, bonds } of tape.days) {
      const isLast = day === d0, have = hist.days[day]
      if (have && !isLast) continue
      const by = {}
      for (const x of bonds) (by[x.issuer] ||= []).push(x)
      const row = {}
      for (const name of names) {
        const r = readIssuer(by[name] || [], day, isLast ? line : null)
        if (isLast) latest[name] = r
        if (r.reading.n || r.reading.cn) row[name] = r.reading
      }
      // the latest day is re-read on every build (more bonds trade through the day); a spread once recorded is not blanked by a build without the curve
      if (isLast && have && !line) for (const [k, v] of Object.entries(row)) if (fin(have[k]?.s)) { v.s = have[k].s; v.lo = have[k].lo; v.hi = have[k].hi; for (const c of Object.keys(v.b)) if (have[k].b?.[c]) v.b[c][1] = have[k].b[c][1] }
      hist.days[day] = row; wrote = true
    }
    // bond-level detail is kept for 90 days (enough for the one-month comparison); the issuer readings are kept for good
    const keepDetail = ms(d0) - 90 * DAY
    for (const [day, row] of Object.entries(hist.days)) if (ms(day) < keepDetail) for (const v of Object.values(row)) if (v.b || v.c) { delete v.b; delete v.c; wrote = true }
    if (wrote) save()

    const days = Object.keys(hist.days).sort().filter(d => d <= d0)
    const prevDay = days.at(-2) || null, at = (day, name) => hist.days[day]?.[name] || null
    const back = n => [...days].reverse().find(d => ms(d) <= ms(d0) - n * DAY) || null
    const d30 = back(25)
    const groups = b.data.groups.map(g => {
      const issuers = g.issuers.map(i => {
        const now = at(d0, i.name), l = latest[i.name], d1 = matched(now, prevDay && at(prevDay, i.name)), dm = matched(now, d30 && d30 !== prevDay ? at(d30, i.name) : null)
        return { name: i.name, label: i.label || i.name, n: now?.n || 0, spread: now?.s ?? null, lo: now?.lo ?? null, hi: now?.hi ?? null, yield: now?.y ?? null, price: now?.p ?? null,
          sp: l?.sp || null, moodys: l?.moodys || null, dSpread: d1.dSpread, dYield: d1.dYield, dSpread1m: dm.dSpread, dYield1m: dm.dYield,
          conv: now?.cn ? { n: now.cn, price: now.cp, dPrice: d1.dPrice } : null,
          bonds: (l?.bonds || []).map(x => ({ coupon: x.coupon, maturity: x.maturity, years: x.years, price: x.price, yield: x.yield, spread: x.spread, last: x.last })),
          series: days.map(d => [d, at(d, i.name)?.s ?? null, at(d, i.name)?.y ?? null]) }
      })
      const priced = issuers.filter(i => fin(i.spread))
      return { id: g.id, label: g.label, reads: g.reads || null, spread: rnd(med(priced.map(i => i.spread)), 2), yield: rnd(med(issuers.map(i => i.yield)), 2),
        dSpread: (() => { const both = issuers.filter(i => fin(i.dSpread)); return both.length ? Math.round(med(both.map(i => i.dSpread))) : null })(),
        dYield: (() => { const both = issuers.filter(i => fin(i.dYield)); return both.length ? Math.round(med(both.map(i => i.dYield))) : null })(),
        issuers, series: days.map(d => [d, rnd(med(g.issuers.map(i => at(d, i.name)?.s)), 3), rnd(med(g.issuers.map(i => at(d, i.name)?.y)), 3)]) }
    })
    return { available: true, asOf: d0, prevDay, monthDay: d30, days, curve: !!line, curveDate, reviewed: b.data.reviewed || null, universe: b.source, researchUrl: research.researchUrl, groups,
      tapeError: tape.err || null,
      source: 'finra.org Fixed Income Data (TRACE last sales), personal use under its user agreement; spreads over the Treasury curve fitted on Bonds → Treasuries' }
  }

  return { get }
}
