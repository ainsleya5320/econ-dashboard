# SFC module for econ-dashboard

A stock-flow-consistent ledger plus a small four-layer macro model, designed to sit
beside the existing "can a country print?" work. Python does the data and the
simulation; the Vite/React side reads three JSON files.

The unifying idea from the earlier discussion: Dalio's debt cycle, MMT's sectoral
balances, and agent-based models are all balance-sheet accounting; "dark output" is
what balance-sheet accounting misses. So the spine is the ledger, and everything else
is layered on it.

```
Layer 1  ledger       sfc/ledger.py    Z.1 + NIPA + DFA from FRED; sectoral balances; credit gap
Layer 2  agents       sfc/model.py     two household groups, firms, banks, government+CB, RoW
Layer 3  capacity     sfc/model.py     potential output; inflation responds to TRUE utilization
Layer 4  measurement  sfc/model.py     dark-output wedge: capacity the accounts don't see,
                                       wage displacement, capture-vs-passthrough dial
```

## Install and run

```
pip install pandas numpy requests          # (matplotlib only for the optional preview)
python run_sfc.py                          # writes data/sfc/sfc_history.json, sfc_scenarios.json, sfc_crux.json
python run_sfc.py --no-crux                # skips the slower rate-hike sign scan (~1 min)
```

No FRED API key is needed: the fetcher uses FRED's keyless CSV endpoint
(`fredgraph.csv?id=SERIES`) and caches under `data/cache/`. If `FRED_API_KEY` is set
it uses the API instead. Quirk found while building: FRED's CSV endpoint returns 503
for some custom User-Agent strings; the default python-requests UA works.

Front end: copy `frontend/SfcPanel.jsx` into `src/components/`, `npm i recharts` if
it's not already there, and mount `<SfcPanel base="/data" />`. It inherits the
dashboard's styles; the only opinionated bit is a fixed series palette.

## Files

```
sfc/fred.py       cached FRED fetcher (keyless or keyed)
sfc/series.py     the ~50 series used, tagged by layer, with units
sfc/ledger.py     build_ledger() -> quarterly DataFrame; calibration_from_ledger() -> dict
sfc/model.py      Params, simulate(), calibrate(), scenarios(), crux_scan()
sfc/export.py     export_all() -> the three JSON files
run_sfc.py        CLI wrapper
frontend/SfcPanel.jsx
preview.png       nine-panel sanity check of ledger + scenarios (regenerate with your own plots)
```

## JSON contract

`sfc_history.json`: `{ as_of, columns[], data: [ { date, <46 columns> } ] }` — quarterly,
1980 onward, nulls for gaps. Every column is % of GDP, % (rates/ratios), or an index.

`sfc_scenarios.json`: `{ calibration, baseline_params, scenarios: { name: { note, diverged_at,
params_diff, data: [ { t, year, <36 columns> } ] } } }`. `params_diff` lists what each
scenario changed relative to baseline, so the panel can explain itself.

`sfc_crux.json`: the rate-hike sign table (see "Findings").

## Ledger conventions (Layer 1)

* Stocks are Z.1 levels ($mn) over nominal GDP ($bn SAAR).
* Sectoral balances follow Godley: private = −(government + foreign), with government
  net lending from NIPA (`AD01RC1Q027SBEA`) and foreign = −current account (`IEABC`,
  annualized). `bal_private_direct` (= gross private saving − investment) is kept as a
  cross-check; the gap between the two is the statistical discrepancy.
* The credit gap is the BIS one: household + business credit/GDP minus a one-sided HP
  trend, λ = 400,000. It hit +9 in 2006 and reads −11 today.
* `dark_output_signal` = professional-services wage growth minus legal-services
  employment growth — the "fewer jobs, higher wages" pattern SemiAnalysis points to.
  It is confounded by ordinary recessions (it spiked in 2009), so read it with the
  productivity series, not alone.

## Model (Layers 2–4), briefly

Quarterly. Sectors: bottom-50% and top-50% households, firms, banks with a capital
target, a consolidated government + central bank that issues the currency, and a
rest-of-world holder of bills whose interest leaks abroad. Every period the sum of net
financial assets across sectors is asserted to be zero and the bank balance sheet is
asserted to close — this caught two real accounting leaks during development, which
is the whole argument for doing it this way.

Key mechanisms and the parameter that controls each:

| Mechanism | Parameter(s) | Default | Whose idea |
|---|---|---|---|
| Demand-determined output, prices respond to true utilization | `phillips_slope`, `phillips_asymmetry`, `inflation_floor` | 0.10, 0.5, −3% | NK / Post-Keynesian |
| Central bank sees *measured* utilization | Taylor rule on `u_meas`; inflation on `u_true` | — | SemiAnalysis's "broken data" point |
| Endogenous credit cycle | `leverage_extrapolation`, `leverage_stress`, `dsr_default`, `default_writeoff`, bank `credit_supply_sens` | 0.5, 0.15, 0.16, 0.05, 3.0 | Dalio / Minsky |
| Interest-income channel | `mpc_top_capital_income`, `foreign_share_gov_debt` | 0.30, 0.30 | Mosler |
| Cost channel of rates | `cost_channel` | 0 | Mosler |
| Conventional rate channels | `invest_rate_sens`, `leverage_rate_sens` | 1.5, 2.5 | NK / Dalio |
| Fiscal reaction to debt | `fiscal_reaction` | 0.06 | Bohn (0 = fiscal dominance) |
| Fiscal stabilizer | `fiscal_stabilizer` | 0 | MMT (set > 0) |
| Dark output | `ai_max`, `dark_capacity`, `dark_substitution`, `dark_capture`, `dark_bottom_burden`, `dark_capex` | 0, 0.10, 0.10, 0.5, 0.6, 0.02 | SemiAnalysis |

`calibrate()` solves for `mpc_top` (so the model starts at full utilization) and
`tax_rate` (so the opening government balance matches the ledger). Everything in the
"calibrated" group — debt ratios by sector, wage share, government spending share,
bottom-50% share of household debt, the government balance — is pinned to the latest
four quarters of FRED data. Everything else is illustrative and meant to be turned.

## Findings from the sandbox

These are statements about the model, not about the world. They are the kind of
statement the model exists to make precise.

1. **The credit cycle is a threshold phenomenon.** A lending-standards loosening of
   10% then 5% gives a damped boom (utilization 0.95–1.11, inflation to ~4%, no
   defaults). A slightly larger shock crosses the debt-service threshold, triggers
   write-offs and a credit crunch, and the accelerator–leverage interaction then tends
   toward a limit cycle rather than a one-off bust. That last property is a known
   feature of accelerator models and is the first thing to fix in v2 (see below).

2. **Dark output opens a debt-deflation channel, then a deleveraging one.** With
   adoption to 100%, unmeasured capacity +10% and 10% of the wage bill displaced, true
   utilization falls to ~0.8, the policy rate hits zero, and government debt/GDP rises
   ~75 points relative to baseline. Household debt/GDP first rises (the Fisher effect
   — nominal income stalls while debt doesn't) and then falls as leverage targets
   respond to weak income growth, which itself depresses demand. Passthrough (σ = 0)
   is milder than capture (σ = 1) because lower prices raise real incomes; the fiscal
   stabilizer recovers most of the lost output. The central bank's measured utilization
   overstates true utilization throughout.

3. **Mosler's sign flip depends on two numbers.** `sfc_crux.json` tabulates the
   12-quarter response of true utilization to a 3pp rate shock:

   | MPC out of capital income | debt 50% | debt 107% | debt 150% |
   |---|---|---|---|
   | 0.1 | −3.2 | −2.9 | −2.7 |
   | 0.3 | −3.1 | −1.1 | −0.7 |
   | 0.5 | −0.8 | **0.0** | +1.0 |
   | 0.6 | −0.5 | +0.8 | +2.5 |
   | 0.7 | −0.1 | +1.9 | explodes |

   At today's debt ratio the hike stops cooling the economy when the MPC out of
   interest and dividends passes roughly 0.5; at 50% debt it never flips in this range.
   The empirical literature on MPCs out of capital income is thin, which is precisely
   why this is the crux.

4. **Fiscal dominance diverges.** No fiscal reaction plus a Taylor rule plus a
   moderately high capital-income MPC produces the interest-income spiral in about
   18 years. Sargent–Wallace arithmetic, Dalio's endgame, Mosler's channel — same run.

## Known limitations (v1)

* Closed goods economy: the rest of world only holds bills. The external sector — the
  layer where your sovereignty index lives — is the obvious next addition: imports
  as a leakage, an exchange rate that responds to the interest differential and to
  foreign bill demand, foreign holdings as a share of new issuance rather than
  reinvested interest only.
* Aggregate potential output. Capacity is one number; 2021 showed it is sectoral.
  The BEA input–output tables are on the shelf for a production-network Layer 3.
* Two household groups. That is the minimum heterogeneity; the DFA gives four wealth
  groups for free (`WFRBL*` series), and an agent population is the ABM step.
* No asset prices. Housing and equities are where credit booms actually live; wealth
  effects here are on net financial assets only.
* Adaptive expectations with a fixed anchor. No expectations channel for fiscal
  credibility, which is MMT's most exposed flank and Dalio's confidence mechanism.
* The dark-output block is a stylization of the SemiAnalysis argument. Whether the
  displaced wage bill is captured or passed through is an empirical question the
  ledger's Layer 4 proxies are meant to help answer, not settle.

## What to test against the ledger next

* Does the model's credit gap dynamics reproduce the 2003–2009 path when fed the
  observed lending-standards series (SLOOS)?
* Estimate `mpc_top_capital_income` by holder class from the DFA and SCF; that single
  number decides the sign in finding 3.
* Run the 2022–24 hiking cycle through the model with the observed debt ratio and
  compare the utilization response to what happened.
* Watch `productivity_yoy` against `dark_output_signal`: if the J-curve story is
  right, the former should turn up two to four years after the latter.
