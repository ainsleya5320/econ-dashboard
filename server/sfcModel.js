// ============================================================================
// SFC MODEL — the stock-flow-consistent ledger and the four-layer simulation
//   Layer 1  ledger      ~50 FRED series (Z.1 + NIPA + DFA) → 187 quarters of
//                        debt stocks, Godley sectoral balances, the BIS credit
//                        gap, debt service, distribution by wealth percentile
//   Layers 2-4 model     two household groups, firms, banks, consolidated
//                        government + central bank, rest of world; capacity and
//                        a measurement wedge ("dark output") on top
//   crux                 the rate-hike sign table: does a hike cool or heat the
//                        economy, as a function of debt and the MPC out of
//                        capital income
// The Python in sfc/ writes three JSON files into data/sfc/; this module reads
// them, derives the board (latest per column — the Z.1 stocks lag the rate and
// labour series by two quarters — one-year change, percentile vs own history,
// sparkline, tone), scores the three channels the model exists to arbitrate,
// and trims the scenario payload (42 columns of full-precision floats is 1.9MB;
// the panel plots 26 of them, rounded).
// Static files: cached in memory, invalidated on mtime.
// ============================================================================
import fs from 'node:fs'
import path from 'node:path'

const fin = v => v != null && Number.isFinite(v)
const r1 = v => (fin(v) ? +v.toFixed(1) : null), r2 = v => (fin(v) ? +v.toFixed(2) : null), r3 = v => (fin(v) ? +v.toFixed(3) : null)
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const mean = xs => { const v = xs.filter(fin); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null }

// The scenario columns the panel plots, out of the 42 the model writes.
const SCEN_COLS = ['t', 'year', 'u_true', 'u_meas', 'inflation_yoy', 'policy_rate', 'debt_household', 'debt_bottom50', 'debt_firms', 'debt_gov', 'debt_total', 'bal_gov', 'bal_private', 'gov_interest_pct_gdp', 'wage_share', 'dsr_bottom', 'dsr_top', 'writeoffs_pct_gdp', 'real_gdp_meas', 'real_potential_true', 'adoption', 'new_credit_pct_gdp', 'credit_supply', 'leverage_bottom', 'income_bottom_real', 'income_top_real']

// dir = "up is bad" (+1), "up is good" (−1), 0 = read it, don't grade it.
const BOARD = [
  ['Debt stocks, % of GDP', [
    ['debt_household', 'Household debt', 1, 'Mortgages and consumer credit. The 2008 peak was 98%.'],
    ['debt_business', 'Business debt', 1, 'Non-financial corporate plus non-corporate.'],
    ['debt_federal', 'Federal debt', 1, 'Treasury debt held by the public and intragovernmental, Z.1 basis.'],
    ['debt_private_nonfin', 'Private non-financial', 1, 'Household + business — the Dalio private-cycle aggregate.'],
    ['debt_total', 'All sectors', 1, 'Including financial-sector debt, which double-counts credit intermediation.'],
  ]],
  ['Sectoral balances, % of GDP', [
    ['bal_gov', 'Government', 0, 'Net lending from NIPA. Negative = deficit.'],
    ['bal_private', 'Private', 0, 'Godley identity: private = −(government + foreign). A deficit here is the fragile configuration.'],
    ['bal_foreign', 'Foreign', 0, 'Minus the current account. Positive = the rest of the world is a net saver on the US.'],
  ]],
  ['Burden and rates, %', [
    ['fed_interest_pct_gdp', 'Federal interest paid', 1, 'The Mosler channel: interest paid by the government is income to whoever holds the debt.'],
    ['household_dsr', 'Household debt service', 1, 'Required payments as a share of disposable income. The model defaults above 16%.'],
    ['policy_rate', 'Policy rate', 0, 'Effective fed funds.'],
    ['ten_year', '10-year Treasury', 0, ''],
  ]],
  ['Credit cycle', [
    ['credit_gap', 'BIS credit gap, pp', 1, 'Private credit/GDP minus a one-sided HP trend, λ = 400,000. It hit +9 in 2006.'],
    ['debt_growth_yoy', 'Debt growth, % yoy', 0, ''],
    ['debt_minus_income_growth', 'Debt minus income growth, pp', 1, "Dalio's central ratio: debt outrunning income is the whole short cycle."],
  ]],
  ['Distribution (DFA)', [
    ['bottom50_share_hh_debt', 'Bottom 50% share of household debt, %', 1, ''],
    ['bottom50_share_networth', 'Bottom 50% share of net worth, %', -1, 'The denominator behind who defaults first.'],
    ['top1_share_networth', 'Top 1% share of net worth, %', 1, 'Feeds the MPC that decides the rate-hike sign.'],
    ['bottom50_debt_to_networth', 'Bottom 50% debt / net worth, %', 1, ''],
  ]],
  ['Capacity and measurement', [
    ['capacity_util', 'Capacity utilization, %', -1, 'What the central bank sees. Layer 4 asks whether it is the right gauge.'],
    ['prime_age_epop', 'Prime-age employment rate, %', -1, ''],
    ['unemployment', 'Unemployment, %', 1, ''],
    ['productivity_yoy', 'Productivity, % yoy', -1, 'If the dark-output J-curve is right, this turns up 2-4 years after the signal below.'],
    ['wage_share', 'Wage share, %', -1, 'At the bottom of its 46-year range.'],
    ['dark_output_signal', 'Dark-output signal, pp', 1, 'Professional-services wage growth minus legal-services employment growth — fewer jobs at higher pay. Confounded by ordinary recessions; it spiked in 2009.'],
  ]],
]

export function createSfcModel({ dir }) {
  const file = n => path.join(dir, 'data', 'sfc', n)
  let mem = null

  const read = n => JSON.parse(fs.readFileSync(file(n), 'utf8'))
  const stamp = () => ['sfc_history.json', 'sfc_scenarios.json', 'sfc_crux.json']
    .map(n => { try { return fs.statSync(file(n)).mtimeMs } catch { return 0 } }).join('|')

  function build() {
    const hist = read('sfc_history.json')
    const scen = read('sfc_scenarios.json')
    let crux = null
    try { crux = read('sfc_crux.json') } catch { /* --no-crux run */ }
    const rows = hist.data

    // ── per-column statistics; every series has its own last observation ──
    const col = id => rows.map(r => ({ d: r.date, v: r[id] })).filter(p => fin(p.v))
    const stats = {}
    for (const id of hist.columns) {
      const pts = col(id)
      if (!pts.length) { stats[id] = null; continue }
      const latest = pts[pts.length - 1]
      const yrTarget = `${+latest.d.slice(0, 4) - 1}${latest.d.slice(4)}`
      const prior = pts.filter(p => p.d <= yrTarget)
      const yr = prior.length ? prior[prior.length - 1] : null
      const vals = pts.map(p => p.v)
      const sorted = [...vals].sort((a, b) => a - b)
      const below = sorted.filter(v => v < latest.v).length
      stats[id] = {
        d: latest.d, v: r2(latest.v), chg1y: yr ? r2(latest.v - yr.v) : null, priorD: yr?.d ?? null,
        pct: Math.round((below / sorted.length) * 100), min: r1(sorted[0]), max: r1(sorted[sorted.length - 1]),
        n: pts.length, since: pts[0].d, spark: pts.slice(-44).map(p => r2(p.v)),
      }
    }
    const S = id => stats[id] || {}
    const V = id => (fin(stats[id]?.v) ? stats[id].v : null)
    // Percentile the way the series should be read: 100 = the comfortable end.
    const favour = (id, dir) => { const p = S(id).pct; return fin(p) ? (dir > 0 ? 100 - p : p) : null }

    const board = BOARD.map(([group, items]) => ({
      group,
      rows: items.map(([id, label, dir, note]) => {
        const s = S(id)
        const fav = favour(id, dir)
        return {
          id, label, note, dir, ...s,
          tone: dir === 0 || !fin(fav) ? 'slate' : fav >= 60 ? 'green' : fav >= 35 ? 'amber' : 'red',
        }
      }).filter(r => fin(r.v)),
    }))

    // ── charts (quarterly, trimmed) ──
    const pick = (ids, from = '1985-01-01') => rows.filter(r => r.date >= from)
      .map(r => Object.fromEntries([['date', r.date], ...ids.map(id => [id, r2(r[id])])]))
    const charts = {
      balances: pick(['bal_gov', 'bal_private', 'bal_foreign'], '1990-01-01'),
      debt: pick(['debt_household', 'debt_business', 'debt_federal', 'debt_financial']),
      credit: pick(['credit_gap', 'debt_minus_income_growth']),
      burden: pick(['fed_interest_pct_gdp', 'policy_rate', 'ten_year']),
      dark: pick(['dark_output_signal', 'productivity_yoy', 'prof_services_ahe_yoy', 'legal_emp_yoy'], '2007-01-01'),
      distribution: pick(['bottom50_share_networth', 'bottom50_share_hh_debt', 'top1_share_networth'], '1990-01-01'),
    }

    // ── scores: one per school the model arbitrates ──
    // Dalio — how much room the private balance sheet has.
    const creditInputs = [favour('credit_gap', 1), favour('household_dsr', 1), favour('debt_private_nonfin', 1),
      fin(V('debt_minus_income_growth')) ? clamp(50 - V('debt_minus_income_growth') * 8, 0, 100) : null]
    const credit = Math.round(mean(creditInputs) ?? 50)
    // Mosler — how loaded the interest-income channel is (low score = loaded).
    const interestInputs = [favour('fed_interest_pct_gdp', 1), favour('debt_federal', 1), favour('bal_gov', 1)]
    const interest = Math.round(mean(interestInputs) ?? 50)
    // SemiAnalysis — whether the gauges the central bank reads still measure the economy.
    const prodMinusJobs = fin(V('productivity_yoy')) && fin(V('legal_emp_yoy')) ? V('productivity_yoy') - V('legal_emp_yoy') : null
    const measureInputs = [favour('dark_output_signal', 1), fin(prodMinusJobs) ? clamp(50 - prodMinusJobs * 10, 0, 100) : null]
    const measure = Math.round(mean(measureInputs) ?? 50)
    const tone = s => (s >= 60 ? 'green' : s >= 35 ? 'amber' : 'red')
    const ord = p => `${p}${p % 10 === 1 && p % 100 !== 11 ? 'st' : p % 10 === 2 && p % 100 !== 12 ? 'nd' : p % 10 === 3 && p % 100 !== 13 ? 'rd' : 'th'}`

    const scores = {
      credit: {
        score: credit, tone: tone(credit), label: credit >= 60 ? 'Private balance sheets have room' : credit >= 35 ? 'Private credit mid-cycle' : 'Private credit stretched',
        why: `Credit gap ${V('credit_gap')}pp (${ord(S('credit_gap').pct)} percentile since ${S('credit_gap').since.slice(0, 4)}), household debt service ${V('household_dsr')}% of disposable income, private non-financial debt ${V('debt_private_nonfin')}% of GDP, debt growing ${V('debt_minus_income_growth') >= 0 ? '' : '−'}${Math.abs(V('debt_minus_income_growth'))}pp ${V('debt_minus_income_growth') >= 0 ? 'faster than' : 'slower than'} income. Dalio's short cycle runs on that last number.`,
      },
      interest: {
        score: interest, tone: tone(interest), label: interest >= 60 ? 'Interest channel small' : interest >= 35 ? 'Interest channel material' : 'Interest channel loaded',
        why: `The government pays ${V('fed_interest_pct_gdp')}% of GDP in interest (${ord(S('fed_interest_pct_gdp').pct)} percentile since 1980) on federal debt of ${V('debt_federal')}% of GDP, running a ${Math.abs(V('bal_gov'))}% deficit. Every dollar of that is income to a bondholder — which is why the crux table below asks whether a hike still cools the economy at this debt ratio.`,
      },
      measure: {
        score: measure, tone: tone(measure), label: measure >= 60 ? 'Gauges look trustworthy' : measure >= 35 ? 'Measurement wedge opening' : 'Gauges diverging from output',
        why: `The dark-output signal reads ${V('dark_output_signal')}pp (${ord(S('dark_output_signal').pct)} percentile of its short history; it was ${S('dark_output_signal').chg1y >= 0 ? 'lower' : 'higher'} a year ago at ${r2(V('dark_output_signal') - S('dark_output_signal').chg1y)}), productivity is running ${V('productivity_yoy')}% while legal employment grows ${V('legal_emp_yoy')}%. Layer 4 asks what the central bank's utilization gauge misses when output stops needing hours.`,
      },
    }

    // ── headline ──
    const privateEasy = credit >= 55, stateLoaded = interest <= 40
    const label = privateEasy && stateLoaded ? 'Private deleveraging, public leverage'
      : privateEasy ? 'Private balance sheets have room'
      : stateLoaded ? 'Leverage on both balance sheets'
      : 'Mid-cycle on both balance sheets'
    const headline = {
      label,
      color: stateLoaded ? '#fbbf24' : privateEasy ? '#4ade80' : '#f87171',
      why: `Households and firms sit ${Math.abs(V('credit_gap'))}pp ${V('credit_gap') < 0 ? 'below' : 'above'} their credit trend while federal debt is ${V('debt_federal')}% of GDP and interest costs ${V('fed_interest_pct_gdp')}% — the deleveraging happened in the private sector and the borrowing moved to the state. The private sector is running a ${V('bal_private') >= 0 ? 'surplus' : 'deficit'} of ${Math.abs(V('bal_private'))}% of GDP, which by the Godley identity is exactly the government deficit plus the foreign balance.`,
    }

    // ── scenarios, trimmed and transposed ──
    // Row-of-objects costs ~20 bytes of repeated key per value across 1,920
    // rows; columnar arrays cut the payload four-fold, and the panel plots one
    // metric at a time anyway, so it reassembles only the column it needs.
    const METRICS = SCEN_COLS.filter(c => c !== 't' && c !== 'year')
    const scenarios = {
      metrics: METRICS,
      calibration: Object.fromEntries(Object.entries(scen.calibration).map(([k, v]) => [k, typeof v === 'number' ? r2(v) : v])),
      list: Object.entries(scen.scenarios).map(([name, s]) => ({
        name, note: s.note, divergedAt: s.diverged_at ?? null, paramsDiff: s.params_diff || null,
        quarters: s.data.length, years: s.data.map(r => r.year),
        series: Object.fromEntries(METRICS.map(c => [c, s.data.map(r => r3(r[c]))])),
      })),
    }

    return {
      asOf: hist.as_of, latest: rows[rows.length - 1].date, quarters: rows.length, since: rows[0].date,
      headline, scores, board, charts, scenarios, crux,
      source: 'Ledger: FRED (Z.1 financial accounts, NIPA, Distributional Financial Accounts), built by sfc/ledger.py. Model: sfc/model.py, quarterly, calibrated to the latest four quarters of the ledger. Scenario paths are model output under stated assumptions, not forecasts.',
      built: new Date().toISOString(),
    }
  }

  function get() {
    const st = stamp()
    if (mem && mem.stamp === st) return mem.data
    const data = build()
    mem = { data, stamp: st }
    return data
  }
  return { get }
}
