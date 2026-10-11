// ============================================================================
// AI POWER: is there power for the build-out?
// SemiAnalysis forecasts $11.1T of AI capex over 2024-29. The yearly path is
// the one the AI revenue check fits to that total (the five hyperscalers'
// complete calendar years, then constant growth to the six-year sum), read
// for the same years EIA's Short-Term Energy Outlook covers. That spend is
// turned into gigawatts at today's all-in cost: GB200 NVL72 servers
// (gpu-econ.json) at their provisioned power (intelligence-mw.json), grossed
// up for buildings, power and cooling by McKinsey's split of AI data-centre
// capex, and cut to the US share. It is set against the reliable capacity EIA
// expects the grid to add in those years net of retirements: each fuel's
// change in net summer capacity times the capacity credit PJM gives that kind
// of plant (gas about three-quarters, batteries half, wind a third, solar a
// tenth). The market reads are PJM's capacity auction (the price the largest
// US grid pays for guaranteed capacity) and Polymarket's odds of a state
// moratorium on new data centres.
// Gap = new US data-centre load a year ÷ reliable capacity added a year, net
// of retirements. Under 0.5× data centres take less than half of it and the
// rest covers every other source of load growth: the claims fit. From 0.5×
// most new reliable capacity goes to data centres and everything else
// competes for what is left: the circle needs squaring. From 1× data centres
// alone need more reliable capacity than the grid adds, so reserve margins
// shrink by the excess every year: the forecast, EIA's build plan and today's
// reliability margins cannot all hold.
// Inputs: data/ai/ai-debt.json (the forecast), hyperscaler-capex.json (SEC
// filings, the early years of the path), data/ai/gpu-econ.json and
// data/ai/intelligence-mw.json (cost and power per GPU),
// data/ai/pjm-capacity.json, EIA STEO via ctx.eia, Polymarket, FRED.
// ============================================================================
import { fin, usd, pct, times, prob, grade, last, qtr } from '../lib.js'
import { YEARS, IT_SHARE, LAND_BUILD_SHARE, calendarCapex, capexPath, trailingCapex, pathAt } from '../aiCapexPath.js'

// Reference system: the rack-scale Nvidia system most of the 2026-27 build uses. It is the dearest per MW in
// gpu-econ.json, so it gives the fewest GW of the systems there; Nvidia's own $/GW quote gives fewer still.
const REF = 'gb200'
// McKinsey's split of AI data-centre capex (IT_SHARE, LAND_BUILD_SHARE) and the yearly path live in
// ../aiCapexPath.js, shared with the AI revenue check, so both cards describe the same build-out.
// JLL Global Data Center Outlook 2026: average global shell-and-core cost $11.3M per MW of IT load for 2026,
// excluding land, fit-out (electrical and mechanical systems) and IT equipment. A cross-check on McKinsey's 15%.
const JLL_SHELL_PER_MW = 11.3
// IEA, Energy and AI (April 2025): the US was 45% of world data-centre electricity use in 2024 (China 25%, Europe 15%).
// SemiAnalysis's capex figure is read as worldwide.
const US_SHARE = 0.45
// Nvidia (Jensen Huang, Q2 FY2026 earnings call, Aug 2025): a gigawatt of AI data centre costs $50-60B all in. A cross-check.
const NVDA_PER_GW = [50, 60]
// Average draw as a share of provisioned facility power, to turn GW into TWh (and the peak-draw sensitivity).
const LOAD_FACTOR = 0.7
// Capacity credit: the share of a plant's nameplate a grid operator counts on at the hour of greatest risk. PJM's ELCC
// class ratings for the 2028/29 Base Residual Auction (Special Markets and Reliability Committee, Feb 13, 2026):
// gas combined cycle 78%, combustion turbine 67%, nuclear 96%, coal 85%, steam 75%, oil-fired turbine 83%,
// four-hour storage 59%, ten-hour storage 78%, onshore wind 34%, tracking solar 10%. PJM's ratings stand in for the
// whole country: the other grids rate plants differently, but no national set exists.
const ELCC = { gasCC: 0.78, gasCT: 0.67, nuclear: 0.96, coal: 0.85, steam: 0.75, oilCT: 0.83, storage4h: 0.59, storage10h: 0.78, wind: 0.34, solar: 0.1 }
// Batteries: PJM rates four-hour storage 59%, but many US batteries (ERCOT's especially) run one to two hours, so half is used.
const BATTERY_CREDIT = 0.5
// EIA STEO, US electric power sector net summer capacity (GW, end of year) → [name, group, capacity credit].
// Gas takes the midpoint of combined cycle and combustion turbine (STEO does not split new gas by type); the small
// other dispatchable fuels take PJM's steam class.
const SERIES = {
  NGEPCGW_US: ['gas', 'firm', (ELCC.gasCC + ELCC.gasCT) / 2],
  NUEPCGW_US: ['nuclear', 'firm', ELCC.nuclear],
  CLEPCGW_US: ['coal', 'firm', ELCC.coal],
  HVEPCGW_US: ['hydro', 'firm', ELCC.steam],
  GEEPCGW_US: ['geothermal', 'firm', ELCC.steam],
  PAEPCGW_US: ['oil', 'firm', ELCC.oilCT],
  WWEPCGW_US: ['wood', 'firm', ELCC.steam],
  OWEPCGW_US: ['waste biomass', 'firm', ELCC.steam],
  OGEPCGW_US: ['other gases', 'firm', ELCC.steam],
  OTEPCGW_US: ['other', 'firm', ELCC.steam],
  BAEPCGW_US: ['batteries', 'store', BATTERY_CREDIT],
  HPEPCGW_US: ['pumped hydro', 'store', ELCC.storage10h],
  SOEPCGWX_US: ['solar', 'variable', ELCC.solar],
  WNEPCGW_US: ['wind', 'variable', ELCC.wind],
}
const USE = 'ELCOTWH' // total US electricity use, billion kWh = TWh
// Duke Nicholas Institute, "Rethinking Load Growth" (Norris et al., Feb 2025): new load the existing US grid could take
// if that load accepts being cut back in 0.25%, 0.5% or 1% of hours, GW (a one-off stock of headroom, not a yearly flow).
const DUKE_FLEX = [[0.25, 76], [0.5, 98], [1, 126]]
// PJM capacity price caps ($/MW-day, RTO) under the FERC-approved collar agreed with the PJM states in 2025, by delivery
// year. Used only when a row in pjm-capacity.json carries no `cap` of its own.
const PJM_CAP = { '2026/27': 329.17, '2027/28': 333.44, '2028/29': 325 }
// The last two auctions before prices jumped in 2025/26: the pre-scarcity base the latest price is compared with.
const PJM_PRE = ['2023/24', '2024/25']
// Polymarket: statewide moratorium on new data centres. State markets (rules): an enacted law that by default prohibits
// or suspends approval, permitting, construction, grid connection or operation of all new data centres, or of all above
// 100 MW, throughout the state. The any-state market also counts a moratorium on "a defined category" of new data
// centres, so it is broader. Slugs are fixed; a missing event is dropped. Volume floor per market ($ traded):
const MIN_VOL = 50000
const STATE_SLUGS = [
  'texas-enacts-data-center-moratorium-by-20260928', 'ohio-enacts-data-center-moratorium-by-20260928',
  'indiana-enacts-data-center-moratorium-by-20260929', 'louisiana-enacts-data-center-moratorium-by-20260929',
  'missouri-enacts-data-center-moratorium-by-20260929', 'oklahoma-enacts-data-center-moratorium-by-20260929',
  'north-carolina-enacts-data-center-moratorium-by',
]
const ANY_STATE_SLUG = 'will-any-state-enact-a-data-center-moratorium-by-december-31-20260707003733282'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const gw = v => (fin(v) ? `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(Math.abs(v) < 10 ? 1 : 0)} GW` : '—')
const sgw = v => (fin(v) ? `${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(1)}` : '—')
const twh = v => (fin(v) ? `${Math.round(v).toLocaleString()} TWh` : '—')
const mpm = v => (fin(v) ? `$${v.toFixed(1)}M` : '—')
const share = v => (fin(v) ? (v >= 1 ? times(v) : pct(v * 100, 0)) : '—')
const dayLabel = d => `${MONTHS[+d.slice(5, 7) - 1]} ${+d.slice(8, 10)}, ${d.slice(0, 4)}`
// a Polymarket end time (11:59 PM ET, stored as the next day in UTC) → the ET day it covers
const etDay = iso => (iso ? new Date(Date.parse(iso) - 6 * 3600e3).toISOString().slice(0, 10) : null)
const andList = xs => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const stateName = slug =>slug.split('-enacts')[0].split('-').map(w => w[0].toUpperCase() + w.slice(1)).join(' ')


export default {
  id: 'ai-power',
  domain: 'ai',
  order: 3,
  title: 'Is there power for the build-out?',
  question: 'Can the US grid add reliable power as fast as the forecast AI capex adds data centres?',
  see: 'Charts: AI Economy → Compute: the power bottleneck (PJM capacity prices, retail electricity), GPU unit economics, Intelligence per megawatt.',
  async compute(ctx) {
    const debt = ctx.json('data/ai/ai-debt.json')
    const econ = ctx.json('data/ai/gpu-econ.json')
    const imw = ctx.json('data/ai/intelligence-mw.json')
    const pjm = ctx.json('data/ai/pjm-capacity.json')
    const hc = ctx.json('hyperscaler-capex.json')
    const yNow = +ctx.today.slice(0, 4), now = Date.parse(ctx.today)

    const ids = [...Object.keys(SERIES), USE]
    const [steoRows, elec, anyState, ...states] = await Promise.all([
      ctx.eia('steo/data/', { frequency: 'annual', 'data[]': ['value'], 'facets[seriesId][]': ids, start: String(yNow - 3), 'sort[0][column]': 'period', 'sort[0][direction]': 'asc', length: 500 }).catch(e => ({ error: e.message })),
      ctx.fred('APU000072610', 18).catch(() => null),
      ctx.markets.polymarket(ANY_STATE_SLUG).catch(() => null),
      ...STATE_SLUGS.map(s => ctx.markets.polymarket(s).catch(() => null)),
    ])

    // ── what a gigawatt of AI data centre costs ──
    const gpu = econ.gpus[REF], chip = imw.chips[REF]
    const sysF = imw.assumptions.systemFactor, factor = sysF[chip.system], pue = econ.assumptions.pue
    const itW = gpu.tdpW * factor
    const serverPerMw = gpu.capexPerGpu / itW // $ per W of IT load = $M per MW
    const allInIt = serverPerMw / IT_SHARE // $M per MW of IT load, buildings, power and cooling included
    const perGw = allInIt / pue // $M per MW of grid load = $B per GW
    const landBuild = allInIt * LAND_BUILD_SHARE
    // the range across the other systems with a price in gpu-econ.json (each at its own system factor)
    const others = Object.entries(econ.gpus).filter(([k, g]) => k !== REF && fin(g.capexPerGpu) && fin(g.tdpW) && imw.chips[k])
      .map(([k, g]) => ({ name: g.name, v: g.capexPerGpu / (g.tdpW * sysF[imw.chips[k].system]) / IT_SHARE / pue }))
      .sort((a, b) => a.v - b.v)

    // ── the forecast's yearly path (SEC filings for the early years) ──
    const F = debt.forecast, total = F.cumulativeCapex2024to2029
    const { actual } = calendarCapex(hc)
    const { path, g, known } = capexPath(total, actual)
    // the trailing four quarters on the window every AI card shares (../aiCapexPath.js), and the
    // fitted path's flow over the same twelve months
    const tc = trailingCapex(hc)
    const capex4q = tc?.capex ?? 0, hcEnd = tc?.end ?? null
    const hcOk = capex4q > 0 && hcEnd
    const pathSame = tc ? pathAt(path, tc.mid) : null
    const onPath = fin(pathSame) && pathSame > 0 ? capex4q / pathSame : null
    const offsetNote = (tc?.offset || []).map(o => `${o.name}'s fiscal quarters run to ${o.end.slice(0, 7)}`).join('; ')

    // ── the grid (EIA STEO) ──
    const steoErr = steoRows?.error || (!Array.isArray(steoRows) || !steoRows.length ? 'EIA STEO returned no rows' : null)
    const S = {}
    if (!steoErr) for (const r of steoRows) (S[r.seriesId] ||= {})[+r.period] = +r.value
    const capYears = Object.keys(S.NGEPCGW_US || {}).map(Number)
    const yMax = capYears.length ? Math.max(...capYears) : null, y0 = fin(yMax) ? yMax - 2 : null
    const chg = (id, y) => (fin(S[id]?.[y]) && fin(S[id]?.[y - 1]) ? S[id][y] - S[id][y - 1] : null)
    const avg2 = id => { const a = chg(id, y0 + 1), b = chg(id, y0 + 2); return fin(a) && fin(b) ? (a + b) / 2 : null }
    // each fuel's change a year, averaged over the two forecast years; a fuel that grows counts as added, one that shrinks as retired
    const fuel = {}
    if (fin(yMax)) for (const [id, [name, group, c]] of Object.entries(SERIES)) { const d = avg2(id); if (fin(d)) fuel[name] = { d, c, group } }
    let firmAdd = 0, firmRet = 0, credAdd = 0, credRet = 0
    for (const f of Object.values(fuel)) {
      if (f.group === 'firm') { if (f.d > 0) firmAdd += f.d; else firmRet += f.d }
      if (f.d > 0) credAdd += f.d * f.c; else credRet += f.d * f.c
    }
    const firmNet = firmAdd + firmRet, credNet = credAdd + credRet
    const d = name => fuel[name]?.d ?? null
    const cred = name => (fuel[name] ? fuel[name].d * fuel[name].c : 0)
    const bat = d('batteries'), sol = d('solar'), wind = d('wind'), ph = d('pumped hydro'), coal = d('coal')
    const useOk = fin(S[USE]?.[yMax]) && fin(S[USE]?.[y0])
    const useGrowth = useOk ? (S[USE][yMax] - S[USE][y0]) / 2 : null

    // ── the forecast, in gigawatts, for the years EIA covers ──
    const win = fin(yMax) ? [y0 + 1, yMax] : [yNow, yNow + 1]
    const avgPath = ys => (ys.length && ys.every(y => fin(path[y])) ? ys.reduce((a, y) => a + path[y], 0) / ys.length : null)
    const gwOf = capex => (fin(capex) ? (capex / perGw) * US_SHARE : null)
    const capexWin = avgPath(win)
    const worldGw = fin(capexWin) ? capexWin / perGw : null
    const dcGw = gwOf(capexWin)
    const capexLag = avgPath(win.map(y => y - 1)), dcGwLag = gwOf(capexLag) // a year from spend to switch-on
    const later = YEARS.filter(y => y > win[1]), capexLater = avgPath(later), dcGwLater = gwOf(capexLater)
    const capexAvgYr = total / YEARS.length, dcGwAvg = gwOf(capexAvgYr)
    const yrs = `${win[0]}-${String(win[1]).slice(2)}`

    if (steoErr || !fuel.gas || !(credAdd > 0) || !fin(dcGw)) {
      return {
        status: 'unavailable', asOf: ctx.today,
        headline: fin(dcGw)
          ? `On SemiAnalysis's path, AI capex in ${yrs} implies about ${gw(dcGw)} of new US data-centre load a year, but EIA's capacity outlook is unavailable, so there is nothing to set it against.`
          : 'The forecast capex path does not cover the years EIA projects, so there is no matched load to compare.',
        error: steoErr || (!fuel.gas ? 'EIA STEO capacity series empty' : !fin(dcGw) ? `no capex path for ${yrs}` : 'EIA STEO shows no capacity added'),
      }
    }

    // ── the gap ──
    const ratio = credNet > 0 ? dcGw / credNet : 99 // no net addition at all: data centres alone overdraw reserves
    const status = grade(ratio, { tension: 0.5, contradiction: 1 })
    const excess = dcGw - credNet // > 0: reserve margins shrink by this much a year
    const firmRatio = firmAdd > 0 ? dcGw / firmAdd : null
    const breakEven = (credNet * perGw) / capexWin // US share of the build at which the ratio is 1×
    const batCred = cred('batteries'), varCred = cred('solar') + cred('wind'), storeCred = Math.max(0, batCred) + Math.max(0, cred('pumped hydro'))
    const firmCredAdd = credAdd - storeCred - Math.max(0, varCred)
    const coalCred = fin(coal) && coal < 0 ? -coal * fuel.coal.c : 0
    const sens = {
      lag: fin(dcGwLag) ? dcGwLag / credNet : null,
      avgYr: dcGwAvg / credNet,
      batFull: fin(bat) && bat > 0 ? dcGw / (credNet + bat * (ELCC.storage4h - BATTERY_CREDIT)) : null,
      nvda: NVDA_PER_GW.map(c => ((capexWin / c) * US_SHARE) / credNet), // [at $50B, at $60B]
      peak: ratio * LOAD_FACTOR,
      firmNet: firmNet > 0 ? dcGw / firmNet : null,
    }
    const dcTwh = dcGw * 8.76 * LOAD_FACTOR
    const flexYears = DUKE_FLEX[0][1] / dcGw

    // ── retail electricity, same month a year earlier (FRED skips months BLS did not publish) ──
    const eLast = last(elec)
    const eYr = eLast ? elec.find(o => o.d === `${+eLast.d.slice(0, 4) - 1}${eLast.d.slice(4)}`) : null
    const elecYoy = eLast && eYr && fin(eLast.v) && fin(eYr.v) ? (eLast.v / eYr.v - 1) * 100 : null

    // ── PJM capacity auction ──
    const auctions = pjm.auctions || []
    const pj = auctions[auctions.length - 1]
    const cap = fin(pj?.cap) ? pj.cap : PJM_CAP[pj?.auction]
    const atCap = pj && fin(cap) && pj.price >= cap - 0.5
    const kwYr = pj ? (pj.price * 365) / 1000 : null
    const pre = PJM_PRE.map(a => auctions.find(x => x.auction === a)?.price).filter(fin)
    const preBase = pre.length ? pre.reduce((a, b) => a + b, 0) / pre.length : null
    // PJM holds each auction a year or more before its delivery year starts on June 1, so once the latest delivery
    // year in the file has begun, the next auction is very likely done and missing from the file
    const pjStale = pj && Date.parse(`${pj.auction.slice(0, 4)}-06-01`) < now
    const staleNote = pjStale ? `the file stops at the ${pj.auction} auction, whose delivery year began Jun 1, ${pj.auction.slice(0, 4)}; PJM holds auctions a year or more ahead, so newer ones are probably missing from data/ai/pjm-capacity.json` : null

    // ── state moratorium odds (Polymarket), all states at one date: the end of next year ──
    // a market that closes before its own end date can only have resolved Yes: the moratorium was enacted
    const resolvedYes = m => m.closed && m.ends && Date.parse(m.ends) > now && fin(m.yes) && m.yes > 0.9
    const live = m => !m.closed && fin(m.yes) && (m.volume ?? 0) >= MIN_VOL
    const horizon = `${yNow + 1}-12-31`
    const enacted = [], stateOdds = [], dropped = []
    STATE_SLUGS.forEach((slug, i) => {
      const e = states[i]
      if (!e) { dropped.push(`${stateName(slug)} (event not found)`); return }
      const st = e.title.split(' enacts')[0]
      if ((e.markets || []).some(resolvedYes)) { enacted.push({ state: st, url: e.url }); return }
      const m = (e.markets || []).find(m => live(m) && etDay(m.ends) === horizon)
      if (!m) { dropped.push(`${st} (no market for ${dayLabel(horizon)} with $${MIN_VOL / 1000}k traded)`); return }
      stateOdds.push({ state: st, p: m.yes, url: e.url, markets: e.markets })
    })
    stateOdds.sort((a, b) => b.p - a.p)
    const topState = stateOdds[0]
    const anyEnacted = !!anyState && (anyState.markets || []).some(resolvedYes)
    const anyM = anyState && !anyEnacted ? (anyState.markets || []).find(live) : null
    const anyDay = anyM ? etDay(anyM.ends) : null
    const atAny = anyDay ? stateOdds.map(s => s.markets.find(m => live(m) && etDay(m.ends) === anyDay)?.yes).filter(fin) : []
    if (!anyState) dropped.push('any-state market (event not found)')
    else if (!anyM && !anyEnacted) dropped.push(`any-state market (no open market with $${MIN_VOL / 1000}k traded)`)

    // ── headline ──
    const firmShort = fin(firmRatio) ? `${share(firmRatio)} ${firmRatio >= 1 ? 'the' : 'of the'} ${gw(firmAdd)} from gas, nuclear and other firm plants alone` : null
    const enactText = enacted.length || anyEnacted ? `${enacted.length ? andList(enacted.map(s => s.state)) : 'a state'} ${enacted.length > 1 ? 'have' : 'has'} enacted a statewide moratorium on new data centres` : null
    // the headline carries the two capacity comparisons; PJM's price and the capacity credits are rows below
    const headline = `SemiAnalysis's path implies about ${gw(dcGw)} of new US data-centre load a year in ${yrs}, ${credNet > 0 ? `${share(ratio)} ${ratio >= 1 ? 'the' : 'of the'} ${gw(credNet)} of reliable capacity the grid adds a year on EIA's forecast` : "while EIA's forecast adds no reliable capacity net of retirements"}${firmShort ? `, and ${firmShort}` : ''}${enactText ? `; ${enactText}` : ''}.`

    // ── claims ──
    const fuelLine = Object.entries(fuel).filter(([, f]) => f.group === 'firm' && Math.abs(f.d) >= 0.05).sort((a, b) => b[1].d - a[1].d).map(([k, f]) => `${k} ${sgw(f.d)}`).join(', ')
    const span = `end-${y0} to end-${yMax}`
    const claims = [
      { label: 'AI capex, 2024-29', display: usd(total), kind: 'forecast', source: F.source, note: `read as worldwide; only the six-year total is theirs. ${known.length ? `The yearly path is fitted here as in the AI revenue check: ${YEARS.filter(y => !known.includes(y)).map(y => `${y} ${usd(path[y])}`).join(', ')}` : 'No SEC capex could be read this run, so every year is set to the 2024-29 average, which overstates the early years'}` },
      hcOk && { label: 'Five hyperscalers: capex, last four quarters', display: usd(capex4q), kind: 'official', source: 'SEC filings: Microsoft, Alphabet, Meta, Amazon, Oracle (hyperscaler-capex.json)', asOf: qtr(hcEnd), note: `${offsetNote ? `${offsetNote}. ` : ''}Their calendar years (${known.map(y => `${y} ${usd(actual[y])}`).join(', ')}) are the path's early years; not all of it is AI or US` },
      { label: `${gpu.name}: server cost and power per GPU`, display: `$${Math.round(gpu.capexPerGpu / 1000)}k · ${(itW / 1000).toFixed(2)} kW`, kind: 'forecast', source: 'Trade-press estimates of vendor and integrator pricing; vendor datasheets for power (gpu-econ.json, intelligence-mw.json)', asOf: econ.reviewed, note: `${gpu.tdpW.toLocaleString()} W chip × ${factor} for CPUs, memory, networking and fans, at provisioned (nameplate) power; the building adds cooling and losses (PUE ${pue}: each watt of IT draws ${pue} W from the grid)` },
      { label: 'Share of AI data-centre capex that buys chips and servers', display: pct(IT_SHARE * 100, 0), kind: 'forecast', source: 'McKinsey, The cost of compute (April 2025)', note: `the rest: ${pct((1 - IT_SHARE - LAND_BUILD_SHARE) * 100, 0)} power, cooling and electrical gear, ${pct(LAND_BUILD_SHARE * 100, 0)} land and construction` },
      { label: 'US share of world data-centre power use', display: pct(US_SHARE * 100, 0), kind: 'forecast', source: 'IEA, Energy and AI (2025), modelled estimate', asOf: '2024', note: 'used as the US share of the build; US hyperscalers build mostly at home, so probably low' },
      { label: 'Firm capacity added a year (gas, nuclear, hydro and other)', display: gw(firmAdd), kind: 'forecast', source: 'EIA Short-Term Energy Outlook, power-sector net summer capacity', asOf: `${span} forecast`, note: `GW a year by fuel: ${fuelLine}; ${gw(firmNet)} net of retirements` },
      { label: 'Batteries, solar and wind added a year', display: `${gw(bat)} · ${gw(sol)} · ${gw(wind)}`, kind: 'forecast', source: 'EIA Short-Term Energy Outlook, power-sector net summer capacity', asOf: `${span} forecast`, note: 'nameplate; the capacity credits below count only part of it as reliable' },
      { label: 'Capacity credit: gas · batteries · wind · solar', display: `${pct(fuel.gas.c * 100, 0)} · ${pct(BATTERY_CREDIT * 100, 0)} · ${pct(ELCC.wind * 100, 0)} · ${pct(ELCC.solar * 100, 0)}`, kind: 'official', source: 'PJM ELCC class ratings, 2028/29 capacity auction (Feb 2026)', asOf: '2028/29 delivery year', note: `the share of nameplate PJM counts on at the hour of greatest risk. Nuclear ${pct(ELCC.nuclear * 100, 0)}, coal ${pct(ELCC.coal * 100, 0)}; gas is the midpoint of combined cycle ${pct(ELCC.gasCC * 100, 0)} and combustion turbine ${pct(ELCC.gasCT * 100, 0)}; PJM rates four-hour batteries ${pct(ELCC.storage4h * 100, 0)}, half is used because many US batteries run only one to two hours` },
      useOk && { label: 'Growth in all US electricity use, a year', display: twh(useGrowth), kind: 'forecast', source: 'EIA Short-Term Energy Outlook, total US consumption', asOf: `${y0}-${yMax} forecast`, note: `${twh(S[USE][y0])} in ${y0} to ${twh(S[USE][yMax])} in ${yMax}, ${pct((Math.sqrt(S[USE][yMax] / S[USE][y0]) - 1) * 100)} a year, data centres included` },
      pj && { label: 'PJM capacity auction clearing price', display: `$${pj.price.toFixed(2)}/MW-day`, kind: 'market', source: 'PJM Base Residual Auction, whole region (data/ai/pjm-capacity.json)', asOf: `${pj.auction} delivery year`, note: [atCap ? 'at the price cap' : fin(cap) ? `cap $${cap}` : null, fin(pj.shortMw) ? `${(pj.shortMw / 1000).toFixed(1)} GW short of PJM's reliability requirement` : null, fin(pj.uncapped) ? `$${Math.round(pj.uncapped)} without the cap` : null, preBase ? `${times(pj.price / preBase, 0)} the ${PJM_PRE.join(' and ')} average of $${preBase.toFixed(2)}, before prices jumped` : null, `about $${Math.round(kwYr)} per kW of capacity a year`, staleNote].filter(Boolean).join('; ') },
      ...enacted.map(s => ({ label: `${s.state}: statewide moratorium on new data centres`, display: 'enacted', kind: 'market', source: 'Polymarket (a market resolved Yes before its end date)', asOf: ctx.today, note: 'check the state law before relying on this' })),
      topState
        ? { label: `Highest single-state odds of a statewide moratorium on new data centres by ${dayLabel(horizon)}`, display: `${topState.state} ${prob(topState.p)}`, kind: 'market', source: `Polymarket, ${stateOdds.length} states priced`, asOf: ctx.today, note: [stateOdds.slice(1).map(s => `${s.state} ${prob(s.p)}`).join(', '), 'the chance that at least one of them acts is higher than any single state\'s', 'counts a law that by default halts all new data centres, or all above 100 MW', dropped.length ? `left out: ${dropped.join('; ')}` : null, `markets with at least $${MIN_VOL / 1000}k traded`].filter(Boolean).join('; ') }
        : !enacted.length && { label: 'Odds of a state data-centre moratorium', display: '—', kind: 'market', source: 'Polymarket', note: `no state has an open market for ${dayLabel(horizon)} with at least $${MIN_VOL / 1000}k traded; the events may have closed or moved${dropped.length ? ` (${dropped.join('; ')})` : ''}` },
      anyEnacted
        ? { label: 'Any state enacts a data-centre moratorium', display: 'enacted', kind: 'market', source: 'Polymarket (resolved Yes before its end date)', asOf: ctx.today }
        : anyM && { label: `Any state enacts a data-centre moratorium by ${dayLabel(anyDay)}`, display: prob(anyM.yes), kind: 'market', source: 'Polymarket', asOf: ctx.today, note: `broader rules than the state markets: a moratorium on any defined category of new data centres counts${atAny.length ? `; the ${atAny.length} states above trade at ${pct(Math.min(...atAny) * 100)} to ${pct(Math.max(...atAny) * 100)} each for the same date` : ''}; $${Math.round(anyM.volume / 1000)}k traded` },
    ].filter(Boolean)

    // ── gives ──
    const batGive = ratio < 1
      ? { label: 'Batteries keep their credit', note: `EIA's ${gw(bat)} of batteries a year supply ${gw(batCred)} of the ${gw(credNet)} of reliable capacity counted here (${pct((batCred / credNet) * 100, 0)}), solar and wind another ${gw(varCred)}. Without the batteries the ratio would be ${times(dcGw / (credNet - batCred), 1)}. Each added battery covers a longer peak and earns less credit, and batteries store power rather than make it: the energy to charge them still has to come from somewhere.` }
      : { label: 'More batteries, faster', note: `EIA's ${gw(bat)} of batteries a year already supply ${gw(batCred)} of reliable capacity. Covering the remaining ${gw(excess)} a year at half credit takes ${gw(excess / BATTERY_CREDIT)} a year more, and batteries store power rather than make it: the energy to charge them still has to come from somewhere.` }
    const gives = [
      batGive,
      { label: 'Coal plants stay open', note: coalCred > 0 ? `EIA has ${gw(-coal)} of coal retiring a year, worth ${gw(coalCred)} of reliable capacity at coal's ${pct(fuel.coal.c * 100, 0)} credit. Keeping all of it running would lift reliable additions to ${gw(credNet + coalCred)} a year and the ratio to ${times(dcGw / (credNet + coalCred), 2)}, at the cost of higher emissions and older plants.` : 'EIA expects little coal to retire, so there is no retirement to delay.' },
      { label: 'Data centres flex at the peak', note: `A Duke study (Norris et al., 2025) finds the existing US grid could take about ${DUKE_FLEX[0][1]} GW of new load if that load accepts being cut back in ${DUKE_FLEX[0][0]}% of hours (${DUKE_FLEX[1][1]} GW at ${DUKE_FLEX[1][0]}%, ${DUKE_FLEX[2][1]} GW at ${DUKE_FLEX[2][0]}%): spare capacity that sits idle outside the few hours of peak demand. It is a one-off stock, about ${flexYears.toFixed(0)} years of the load here, and only if operators accept the cuts.` },
      { label: 'Data centres bring their own power', note: 'On-site gas turbines, fuel cells and deals for existing nuclear plants put the load beside the grid rather than on it; EIA\'s power-sector tally barely counts them. Turbine makers report order books stretching years ahead, so this is slow too.' },
      { label: 'The build is smaller, later, or abroad', note: `${ratio < 1 ? `The ratio reaches 1× only if the US hosts ${pct(breakEven * 100, 0)} of the ${yrs} build, against the ${pct(US_SHARE * 100, 0)} assumed.` : `Reliable power suffices only if the US hosts under ${pct(breakEven * 100, 0)} of the ${yrs} build, against the ${pct(US_SHARE * 100, 0)} assumed, or the forecast is too high.`}${fin(dcGwLater) ? ` On the same path ${later[0]}-${String(later[later.length - 1]).slice(2)} need ${gw(dcGwLater)} a year, ${times(dcGwLater / dcGw, 1)} the ${yrs} pace and ${share(dcGwLater / credNet)} ${dcGwLater >= credNet ? 'the' : 'of the'} reliable capacity EIA has the grid adding now; that is beyond EIA's forecast window, so the squeeze comes later unless the build is smaller than forecast.` : ''} Some capex also replaces older chips in existing halls, which needs no new power.` },
      { label: 'Reliability and bills give', note: `${pj ? `PJM's auction for ${pj.auction} ${atCap ? 'cleared at its cap' : `cleared at $${Math.round(pj.price)}/MW-day`}${preBase ? `, ${times(pj.price / preBase, 0)} the price before 2025/26` : ''}. ` : ''}Thinner reserve margins and rising bills feed the political backlash${topState ? `: Polymarket puts the odds that ${topState.state} alone enacts a statewide moratorium by ${dayLabel(horizon)} at ${prob(topState.p)}, the highest of the ${stateOdds.length} states priced` : ''}.` },
    ]

    return {
      status,
      asOf: [econ.reviewed, imw.reviewed, pjm.reviewed, stateOdds.length || anyM ? ctx.today : null].filter(Boolean).sort().pop(),
      headline,
      claims,
      implied: [
        { label: 'All-in cost per GW of grid load', display: usd(perGw, 1), note: `servers ${mpm(serverPerMw)} per MW of IT load ÷ ${pct(IT_SHARE * 100, 0)} = ${mpm(allInIt)} with buildings, power and cooling, ÷ PUE ${pue}. Nvidia quotes $${NVDA_PER_GW[0]}-${NVDA_PER_GW[1]}B per GW` },
        { label: `New US data-centre load a year, ${yrs}`, display: gw(dcGw), note: `${usd(capexWin)} a year of AI capex on the fitted path ÷ ${usd(perGw, 1)} per GW = ${gw(worldGw)} worldwide; ${pct(US_SHARE * 100, 0)} in the US; provisioned power` },
        { label: 'Reliable capacity added a year, net of retirements', display: gw(credNet), note: `each fuel's change × its capacity credit: ${gw(credAdd)} added (firm plants ${gw(firmCredAdd)}, batteries and pumped hydro ${gw(storeCred)}, solar and wind ${gw(varCred)}) less ${gw(-credRet)} retiring` },
        excess > 0
          ? { label: 'Reserve margin used up a year', display: gw(excess), note: 'data centres alone need this much more reliable capacity each year than the grid adds, before any other load grows' }
          : { label: 'Reliable capacity left for other load growth', display: gw(-excess), note: `a year, for electrification, factories and everything else EIA expects to grow; ${pct((-excess / credNet) * 100, 0)} of what is added` },
        useOk && { label: 'New data-centre electricity use vs all US growth', display: `${twh(dcTwh)} vs ${twh(useGrowth)}`, note: `${share(dcTwh / useGrowth)} ${dcTwh >= useGrowth ? '' : 'of '}EIA's forecast growth in all US electricity use, at a ${pct(LOAD_FACTOR * 100, 0)} average draw` },
        fin(dcGwLater) && { label: `New US data-centre load a year, ${later[0]}-${String(later[later.length - 1]).slice(2)}`, display: gw(dcGwLater), note: `on the same fitted path (${usd(capexLater)} a year), beyond EIA's forecast window; ${share(dcGwLater / credNet)} ${dcGwLater >= credNet ? 'the' : 'of the'} reliable capacity being added now` },
        { label: 'US share of the build at which the ratio reaches 1×', display: pct(breakEven * 100, 0), note: `against the ${pct(US_SHARE * 100, 0)} assumed` },
      ].filter(Boolean),
      gap: {
        label: 'New US data-centre load ÷ reliable capacity added, net',
        value: ratio, display: credNet > 0 ? times(ratio, 2) : 'no net addition', tension: 0.5, contradiction: 1, max: 2,
        note: 'Reliable capacity counts each plant at the share of its nameplate a grid operator counts on at peak, net of retiring plants. At 1× data centres alone take all of it and reserve margins start to shrink; at 0.5× they take half, leaving half for every other source of load growth.',
      },
      gives,
      watch: [
        pj && { label: 'PJM capacity price against its cap', display: `$${Math.round(pj.price)}${fin(cap) ? ` (cap $${Math.round(cap)})` : ''}`, note: `${pj.auction} auction; a clear below the cap would say new supply is arriving${pjStale ? '. Newer auctions are probably missing from data/ai/pjm-capacity.json' : ''}` },
        { label: 'EIA battery additions', display: `${sgw(bat)} GW/yr`, note: `${pct((batCred / credNet) * 100, 0)} of the reliable capacity counted here; slipping battery projects or a lower battery credit move the ratio most` },
        { label: 'EIA gas capacity additions', display: `${sgw(d('gas'))} GW/yr`, note: 'revised monthly in the Short-Term Energy Outlook; slipping gas projects show up here first' },
        topState && { label: 'State moratorium odds', display: `${topState.state} ${prob(topState.p)}`, note: `Polymarket, highest single state, by ${dayLabel(horizon)}` },
        fin(elecYoy) && { label: 'US retail electricity price, past year', display: `${elecYoy >= 0 ? '+' : '−'}${Math.abs(elecYoy).toFixed(1)}%`, note: `$${eLast.v.toFixed(3)}/kWh in ${eLast.d.slice(0, 7)} against $${eYr.v.toFixed(3)} a year earlier (BLS average price)` },
        hcOk && fin(onPath) && { label: 'Five hyperscalers\' capex, last four quarters', display: `${usd(capex4q)} vs ${usd(pathSame)}`, note: `to ${qtr(hcEnd)}, against the fitted path over the same twelve months: ${Math.abs(onPath - 1) < 0.05 ? 'in line with it' : `${pct(Math.abs(1 - onPath) * 100, 0)} ${onPath < 1 ? 'below' : 'above'} it`}. Running below it would mean the near-term load is smaller than assumed` },
      ].filter(Boolean),
      math: [
        `Servers: ${gpu.name} at $${gpu.capexPerGpu.toLocaleString()} per GPU all in; ${gpu.tdpW.toLocaleString()} W board power × ${factor} rack overhead = ${itW.toLocaleString()} W of IT load per GPU, so ${mpm(serverPerMw)} per MW of IT load.`,
        `All in: servers are ${pct(IT_SHARE * 100, 0)} of AI data-centre capex (McKinsey), so ${mpm(serverPerMw)} ÷ ${IT_SHARE} = ${mpm(allInIt)} per MW of IT load. With PUE ${pue} each MW of IT draws ${pue} MW from the grid: ${mpm(allInIt)} ÷ ${pue} = ${usd(perGw, 1)} per GW of grid load. Cross-checks: McKinsey's ${pct(LAND_BUILD_SHARE * 100, 0)} for land and construction is ${mpm(landBuild)} per MW, against JLL's ${mpm(JLL_SHELL_PER_MW)} shell and core; Nvidia quotes $${NVDA_PER_GW[0]}-${NVDA_PER_GW[1]}B per GW. The other systems in gpu-econ.json come to ${usd(others[0]?.v, 1)} to ${usd(others[others.length - 1]?.v, 1)} per GW (more GW for the money); Nvidia's quote gives fewer.`,
        `${known.length ? `Capex path: the five hyperscalers' calendar years (${known.map(y => `${y} ${usd(actual[y])}`).join(', ')}) stand in for the early years, then ${times(g, 2)} a year to sum to ${usd(total)}: ${YEARS.filter(y => !known.includes(y)).map(y => `${y} ${usd(path[y])}`).join(', ')}.` : `Capex path: no SEC capex this run, so every year is the ${usd(capexAvgYr)} average, which overstates the early years.`} EIA covers ${win[0]} and ${win[1]}, so the load uses those years: ${usd(capexWin)} a year ÷ ${usd(perGw, 1)} per GW = ${gw(worldGw)} worldwide; × ${pct(US_SHARE * 100, 0)} = ${gw(dcGw)} a year. The GW are provisioned power, what utilities plan capacity for.`,
        `Grid: EIA STEO power-sector net summer capacity (the output a plant can promise on a hot afternoon), ${span}, change a year: ${fuelLine}; batteries ${sgw(bat)}, pumped hydro ${sgw(ph)}, solar ${sgw(sol)}, wind ${sgw(wind)}. Times PJM's capacity credits: ${gw(credAdd)} of reliable capacity added, ${gw(-credRet)} retired, ${gw(credNet)} net. Counting firm plants only at full nameplate: ${gw(firmAdd)} added, ${gw(firmNet)} net. Each fuel's net change is used, so gross additions inside a fuel are understated a little.`,
        `Ratio: ${gw(dcGw)} ÷ ${gw(credNet)} = ${times(ratio, 2)}. Other readings: firm plants only, ${times(firmRatio, 2)} of gross additions${fin(sens.firmNet) ? ` and ${times(sens.firmNet, 1)} net of coal retirements` : ''}; batteries at PJM's full ${pct(ELCC.storage4h * 100, 0)}, ${times(sens.batFull, 2)}; a year from spend to switch-on (${win[0] - 1}-${String(win[1] - 1).slice(2)} spend), ${times(sens.lag, 2)}; the forecast's 2024-29 average year (${usd(capexAvgYr)}), ${times(sens.avgYr, 2)}; Nvidia's $${NVDA_PER_GW[0]}-${NVDA_PER_GW[1]}B per GW, ${times(sens.nvda[1], 2)} to ${times(sens.nvda[0], 2)}; data centres drawing ${pct(LOAD_FACTOR * 100, 0)} of provisioned power at the peak, ${times(sens.peak, 2)}. The ratio reaches 1× at a US share of ${gw(credNet)} × ${usd(perGw, 1)} ÷ ${usd(capexWin)} = ${pct(breakEven * 100, 0)}.`,
        useOk ? `Energy: ${gw(dcGw)} × 8,760 hours × ${pct(LOAD_FACTOR * 100, 0)} average draw = ${twh(dcTwh)} a year of new use, against EIA's forecast that all US electricity use grows ${twh(useGrowth)} a year (${twh(S[USE][y0])} in ${y0} to ${twh(S[USE][yMax])} in ${yMax}), data centres included.` : 'Energy: EIA\'s electricity-use series was unavailable this run, so the energy comparison is left out.',
        'Geography: these are national totals. Most planned batteries and solar go to Texas, California and the Southwest, while data centres cluster in Virginia and the rest of PJM, which adds little; a national ratio understates the squeeze where the load lands, and PJM\'s price is the local read.',
        pj ? `PJM: $${pj.price.toFixed(2)}/MW-day × 365 = about $${Math.round(kwYr)} per kW of capacity a year${preBase ? `, ${times(pj.price / preBase, 1)} the ${PJM_PRE.join('-')} average` : ''}.${atCap ? ' A price at the cap is censored: buyers would have paid more.' : ''}${staleNote ? ` Stale: ${staleNote}.` : ''}` : 'PJM capacity data unavailable.',
        `Markets: Polymarket bid/ask midpoints (the last trade when the spread is wide); markets with under $${MIN_VOL / 1000}k traded are ignored, and every state is read at the same date. A market that closes before its end date is read as resolved Yes. They give context and do not enter the gap.${dropped.length ? ` Left out: ${dropped.join('; ')}.` : ''}`,
      ],
      sources: [
        { label: 'EIA Short-Term Energy Outlook (capacity and electricity use)', url: 'https://www.eia.gov/outlooks/steo/' },
        { label: 'PJM, 2028/29 auction parameters and ELCC class ratings (Feb 2026)', url: 'https://www.pjm.com/-/media/DotCom/committees-groups/committees/mrc/2026/20260213-special/item-01---2028-2029-bra-fpr--irm---presentation.pdf' },
        { label: 'PJM capacity market (RPM) auction results', url: 'https://www.pjm.com/markets-and-operations/rpm' },
        { label: 'McKinsey, The cost of compute: a $7 trillion race to scale data centers, April 2025', url: 'https://www.mckinsey.com/industries/technology-media-and-telecommunications/our-insights/the-cost-of-compute-a-7-trillion-dollar-race-to-scale-data-centers' },
        { label: 'JLL Global Data Center Outlook 2026', url: 'https://www.jll.com/en-us/insights/market-outlook/data-center-outlook' },
        { label: 'IEA, Energy and AI (2025)', url: 'https://www.iea.org/reports/energy-and-ai' },
        { label: 'Duke Nicholas Institute, Rethinking Load Growth (Feb 2025)', url: 'https://nicholasinstitute.duke.edu/publications/rethinking-load-growth' },
        topState && { label: `Polymarket: ${topState.state} data-centre moratorium`, url: topState.url },
        ...enacted.map(s => ({ label: `Polymarket: ${s.state} data-centre moratorium`, url: s.url })),
        (anyM || anyEnacted) && { label: 'Polymarket: any state data-centre moratorium', url: anyState.url },
        { label: 'BLS average US electricity price (FRED)', url: 'https://fred.stlouisfed.org/series/APU000072610' },
      ].filter(Boolean),
    }
  },
}
