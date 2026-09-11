"""
A small stock-flow-consistent (SFC) macro model with four layers.

  Ledger      : every sector has a balance sheet; all flows land somewhere;
                sum of net financial assets is zero every period (asserted).
  Agents      : two household groups (bottom 50% / top 50% by wealth) with
                different MPCs and leverage; firms; banks with capital;
                a consolidated government + central bank that issues
                the currency (MMT "vertical money"); banks create loans
                and deposits (Dalio/MMT "horizontal money").
  Capacity    : potential output; inflation responds to true utilization;
                the central bank's Taylor rule sees *measured* utilization.
  Measurement : a dark-output wedge. AI adoption A_t expands true capacity
                (unmeasured) and displaces a share s of the wage bill;
                a fraction sigma of the displaced wage bill is captured as
                profits, the rest is passed through as lower prices.

The credit cycle is endogenous: household leverage targets extrapolate
recent income growth (Minsky), banks lend in proportion to their capital,
and debt-service stress triggers write-offs that hit bank capital.

This is a sandbox, not a forecast. Parameters marked 'calibrated' are
pinned to the FRED ledger; the rest are illustrative and meant to be
turned. Time step = one quarter. Rates are annual percentages.
"""
from __future__ import annotations

from dataclasses import dataclass, field, asdict, replace
import math

import numpy as np
import pandas as pd


# ----------------------------------------------------------------------
# parameters
# ----------------------------------------------------------------------
@dataclass
class Params:
    # --- horizon / growth ---
    T: int = 160                      # quarters (40 years)
    g_potential: float = 0.02         # real potential growth, annual
    pi_target: float = 0.02           # inflation target, annual

    # --- initial stocks, share of annual GDP (calibrated to Z.1, 2026Q1) ---
    debt_household: float = 0.667
    bottom50_share_hh_debt: float = 0.289
    debt_firms: float = 0.71
    debt_gov: float = 1.07
    hh_bills_share: float = 0.5       # share of domestically held gov bills held by top households (rest: banks)
    foreign_share_gov_debt: float = 0.30  # initial share of gov bills held abroad; their interest leaks abroad
    deposits_bottom: float = 0.10
    deposits_top: float = 0.60
    bank_capital_ratio: float = 0.10  # target equity / loans

    # --- income distribution (calibrated) ---
    wage_share: float = 0.508         # COE / GDP
    wage_share_bottom: float = 0.35   # bottom 50%'s share of the wage bill
    profit_payout: float = 0.62       # share of firm profits distributed
    tax_rate: float = 0.22            # on household income (solved by calibrate())
    production_tax: float = 0.07      # taxes on production & imports, share of sales
    fiscal_reaction: float = 0.06     # Bohn-style: tax rate rises by this per unit rise in debt/GDP (0 = fiscal dominance)
    transfers_bottom: float = 0.085   # share of potential GDP, to bottom 50%
    transfers_top: float = 0.035
    gov_purchases: float = 0.17       # GCE / GDP

    # --- behaviour ---
    mpc_bottom: float = 0.95
    mpc_top: float = 0.85             # out of labour income & transfers; solved by calibrate()
    mpc_top_capital_income: float = 0.30  # out of interest & dividends -- THE crux parameter for the Mosler channel
    wealth_effect_top: float = 0.04   # annual, on net financial assets
    target_gov_balance: float = -0.078  # calibrate(): initial gov balance / GDP
    invest_share: float = 0.17        # GPDI / GDP (business part)
    invest_accel: float = 1.0         # response of I to utilization gap
    invest_rate_sens: float = 1.5     # % fall in I per 1pp rise in the loan rate (conventional channel)
    leverage_rate_sens: float = 2.5   # % fall in household leverage targets per 1pp rise in the loan rate
    fiscal_stabilizer: float = 0.0    # extra G per unit utilization gap (Mosler mode > 0)

    # --- credit cycle ---
    leverage_target_bottom: float | None = None  # loans / annual disposable income; None = start at actual
    leverage_target_top: float | None = None
    leverage_extrapolation: float = 0.5  # response of targets to income growth - trend
    leverage_stress: float = 0.15        # response to debt-service ratio above threshold
    dsr_threshold: float = 0.12          # debt service / disposable income (quarterly)
    dsr_default: float = 0.16
    default_writeoff: float = 0.05       # share of the group's loans written off per stress quarter
    loan_adjust: float = 0.06            # speed of closing the gap to target leverage
    amortization: float = 0.06           # annual
    credit_supply_sens: float = 3.0      # lending response to bank capital shortfall

    # --- rates ---
    policy_rule: str = "taylor"          # "taylor" | "zirp" | "fixed"
    fixed_rate: float = 0.04
    r_neutral: float = 0.01
    taylor_pi: float = 1.5
    taylor_gap: float = 0.5
    rate_smoothing: float = 0.8
    spread_loans: float = 0.03
    spread_deposits: float = 0.02
    cost_channel: float = 0.0            # Mosler: inflation response to change in loan rate

    # --- inflation / expectations ---
    phillips_slope: float = 0.10         # annual inflation per unit of utilization gap (above u*)
    phillips_asymmetry: float = 0.5      # slope below u* relative to above (downward nominal rigidity)
    inflation_floor: float = -0.03       # annual; wages and prices rarely fall faster than this
    expectations_anchor: float = 0.6     # 1 = fully backward-looking, 0 = fully anchored
    u_star: float = 1.0

    # --- dark output (Layer 4) ---
    ai_start: int = 8                    # quarter at which adoption begins
    ai_speed: float = 0.15               # logistic speed per quarter
    ai_max: float = 0.0                  # asymptotic adoption (0 = no AI)
    dark_capacity: float = 0.10          # unmeasured capacity gain at full adoption
    dark_substitution: float = 0.10      # share of wage bill displaced at full adoption
    dark_capture: float = 0.5            # sigma: displaced wages captured as profits (vs passed to prices)
    dark_bottom_burden: float = 0.6      # share of displacement borne by bottom 50%
    dark_capex: float = 0.02             # AI capex, share of GDP at the peak of adoption (the visible cost)

    # --- shocks ---
    demand_shock: dict = field(default_factory=dict)   # {quarter: pct of GDP}
    leverage_shock: dict = field(default_factory=dict) # {quarter: multiplier on household leverage targets}
    rate_shock: dict = field(default_factory=dict)     # {quarter: pct points}; deviation decays by rate_shock_persistence
    rate_shock_persistence: float = 0.9


# ----------------------------------------------------------------------
# simulation
# ----------------------------------------------------------------------
def adoption_path(p: Params) -> np.ndarray:
    t = np.arange(p.T)
    if p.ai_max <= 0:
        return np.zeros(p.T)
    mid = p.ai_start + int(2.5 / p.ai_speed)
    return p.ai_max / (1.0 + np.exp(-p.ai_speed * (t - mid)))


def simulate(p: Params) -> pd.DataFrame:
    q = 0.25  # quarter as a fraction of a year
    A = adoption_path(p)

    # ---------- initial stocks (annual GDP = 1.0, quarterly = 0.25) ----------
    Y0 = 1.0
    P = 1.0
    Ystar_meas = Y0 * q                      # real potential per quarter
    L_B = p.debt_household * p.bottom50_share_hh_debt
    L_T = p.debt_household - L_B
    L_F = p.debt_firms
    B = p.debt_gov
    D_B = p.deposits_bottom
    D_T = p.deposits_top
    B_f = p.foreign_share_gov_debt * B               # held by the rest of the world
    Bh_T = p.hh_bills_share * (B - B_f)
    E_K = p.bank_capital_ratio * (L_B + L_T + L_F)
    # banks' holdings of government IOUs (bills + reserves, consolidated)
    B_K = B - B_f - Bh_T
    # the bank balance sheet must close: L + B_K - D = E_K. Absorb the residual
    # in bank-held gov IOUs and household deposits consistently (adjust D_T).
    D_T = (L_B + L_T + L_F) + B_K - D_B - E_K

    lev_B = p.leverage_target_bottom   # may be None: set after the first period's income is known
    lev_T = p.leverage_target_top
    r_base = p.fixed_rate if p.policy_rule != "zirp" else 0.0
    if p.policy_rule == "taylor":
        r_base = p.r_neutral + p.pi_target
    r = r_base
    pi = p.pi_target
    pi_hist = [pi] * 4
    u_true_prev = 1.0
    u_meas_prev = 1.0
    r_loan_prev = r + p.spread_loans
    r_loan_0 = r + p.spread_loans
    r_dev = 0.0                                  # accumulated policy-rate shock
    YD_B_prev = YD_T_prev = None
    S_prev = Y0 * q

    growth_q = (1 + p.g_potential) ** q * (1 + p.pi_target) ** q - 1   # trend nominal growth per quarter

    rows = []
    for t in range(p.T):
        # ---------- potential & prices ----------
        Ystar_meas *= (1 + p.g_potential) ** q
        Ystar_true = Ystar_meas * (1 + p.dark_capacity * A[t])
        dA = A[t] - (A[t - 1] if t > 0 else 0.0)

        pi_e = p.expectations_anchor * pi + (1 - p.expectations_anchor) * p.pi_target
        r_loan = r + p.spread_loans
        passthrough = (1 - p.dark_capture) * p.dark_substitution * p.wage_share * dA
        gap = u_true_prev - p.u_star
        slope = p.phillips_slope * (1.0 if gap >= 0 else p.phillips_asymmetry)
        pi = (pi_e
              + slope * gap
              + p.cost_channel * (r_loan - r_loan_prev)
              - passthrough / q)          # level shift spread over the quarter, annualized
        pi = max(pi, p.inflation_floor)
        P *= (1 + pi) ** q
        pi_hist.append(pi); pi_yoy = float(np.mean(pi_hist[-4:]))

        # ---------- rates ----------
        r_dep = max(0.0, r - p.spread_deposits)
        r_bill = r

        # ---------- government purchases ----------
        G = p.gov_purchases * P * Ystar_meas
        G += p.fiscal_stabilizer * P * Ystar_meas * (p.u_star - u_meas_prev)
        G += p.demand_shock.get(t, 0.0) * P * Ystar_meas
        int_hh_bills = r_bill * q * Bh_T
        int_bank_bills = r_bill * q * B_K
        int_foreign = r_bill * q * B_f
        interest_gov = int_hh_bills + int_bank_bills + int_foreign
        transfers_B = p.transfers_bottom * P * Ystar_meas
        transfers_T = p.transfers_top * P * Ystar_meas

        # ---------- passive fiscal reaction (Bohn): taxes respond to the debt ratio ----------
        debt_ratio_prev = B / (S_prev * 4)
        tax_rate_t = p.tax_rate + p.fiscal_reaction * (debt_ratio_prev - p.debt_gov)

        # ---------- household debt service & new lending ----------
        amort_B = p.amortization * q * L_B
        amort_T = p.amortization * q * L_T
        int_B = r_loan * q * L_B
        int_T = r_loan * q * L_T
        cap_ratio = E_K / max(L_B + L_T + L_F, 1e-9)
        credit_supply = float(np.clip(1 + p.credit_supply_sens * (cap_ratio - p.bank_capital_ratio) / p.bank_capital_ratio, 0.2, 1.3))
        # leverage targets extrapolate income growth and react to debt-service stress
        if YD_B_prev and lev_B is None:
            lev_B = L_B / (YD_B_prev * 4)
        if YD_T_prev and lev_T is None:
            lev_T = L_T / (YD_T_prev * 4)
        rate_adj = max(0.0, 1 - p.leverage_rate_sens * (r_loan - r_loan_0))
        target_B = lev_B * rate_adj * (YD_B_prev * 4) if YD_B_prev else 0.0
        target_T = lev_T * rate_adj * (YD_T_prev * 4) if YD_T_prev else 0.0
        # steady-state new lending = amortization + nominal-growth top-up, plus a gap-closing term
        new_B = credit_supply * (amort_B + growth_q * L_B + p.loan_adjust * (target_B - L_B)) if YD_B_prev else amort_B + growth_q * L_B
        new_T = credit_supply * (amort_T + growth_q * L_T + p.loan_adjust * (target_T - L_T)) if YD_T_prev else amort_T + growth_q * L_T
        new_B, new_T = max(new_B, 0.0), max(new_T, 0.0)

        # ---------- firms: demand-determined sales ----------
        # investment responds to last period's utilization
        I = p.invest_share * P * Ystar_meas * (1 + p.invest_accel * (u_meas_prev - p.u_star)
                                               - p.invest_rate_sens * (r_loan - r_loan_0))
        I += p.dark_capex * P * Ystar_meas * 4 * A[t] * (1 - A[t])   # bell-shaped capex boom during adoption
        I = max(I, 0.0)
        int_F = r_loan * q * L_F

        # wage share with AI substitution (share captured as profit vs passed through)
        sA = p.dark_substitution * A[t]
        denom = 1 - (1 - p.dark_capture) * sA * p.wage_share
        omega = p.wage_share * (1 - sA) / denom
        wB_share = (p.wage_share_bottom - p.dark_bottom_burden * sA) / max(1 - sA, 1e-9)
        wB_share = float(np.clip(wB_share, 0.05, 0.95))

        # Solve the within-period simultaneity S = C(S) + I + G.
        # Everything is (piecewise) linear in S, so evaluate the map at two points,
        # solve the linear fixed point exactly, then verify.
        def flows(S):
            W = omega * S
            W_B, W_T = wB_share * W, (1 - wB_share) * W
            prod_tax = p.production_tax * S
            profit_F = S - W - int_F - prod_tax
            div_F = p.profit_payout * max(profit_F, 0.0)
            bank_income = r_loan * q * (L_B + L_T + L_F) + int_bank_bills
            bank_cost = r_dep * q * (D_B + D_T)
            profit_K = bank_income - bank_cost           # write-offs handled after
            shortfall = p.bank_capital_ratio * (L_B + L_T + L_F) * (1 + growth_q) - E_K
            retained_K = float(np.clip(shortfall, 0.0, max(profit_K, 0.0))) if profit_K > 0 else profit_K
            div_K = profit_K - retained_K
            cap_inc_T = r_dep * q * D_T + int_hh_bills + div_F + div_K
            inc_B = W_B + r_dep * q * D_B + transfers_B
            inc_T = W_T + cap_inc_T + transfers_T
            tax_B = tax_rate_t * (inc_B - transfers_B)
            tax_T = tax_rate_t * (inc_T - transfers_T)
            YD_B = inc_B - tax_B - int_B
            YD_T = inc_T - tax_T - int_T
            V_T = D_T + Bh_T - L_T
            yd_T_labour = (W_T + transfers_T) * (1 - tax_rate_t) + tax_rate_t * transfers_T
            yd_T_capital = cap_inc_T * (1 - tax_rate_t) - int_T
            C_B = p.mpc_bottom * (YD_B - amort_B) + new_B
            C_T = (p.mpc_top * (yd_T_labour - amort_T) + p.mpc_top_capital_income * yd_T_capital
                   + p.wealth_effect_top * q * max(V_T, 0.0) + new_T)
            S_out = C_B + C_T + I + G
            return dict(W=W, W_B=W_B, W_T=W_T, prod_tax=prod_tax, profit_F=profit_F, div_F=div_F,
                        profit_K=profit_K, retained_K=retained_K, div_K=div_K, tax_B=tax_B, tax_T=tax_T,
                        YD_B=YD_B, YD_T=YD_T, C_B=C_B, C_T=C_T, S_out=S_out)

        S1, S2 = S_prev, S_prev * 1.01
        f1, f2 = flows(S1), flows(S2)
        slope_S = (f2["S_out"] - f1["S_out"]) / (S2 - S1)      # the within-period multiplier's 1/(1-b) has b = slope
        if slope_S >= 0.999:
            df = pd.DataFrame(rows); df.attrs["diverged_at"] = t; df.attrs["reason"] = "within-period multiplier >= 1"
            return df
        S = (f1["S_out"] - slope_S * S1) / (1 - slope_S)
        f = flows(S)
        if abs(f["S_out"] - S) > 1e-9 * max(S, 1.0):             # a max() branch flipped; polish by iteration
            for _ in range(200):
                S = f["S_out"]; f = flows(S)
                if abs(f["S_out"] - S) < 1e-12:
                    break
        S = f["S_out"]                                            # receipts == expenditures exactly
        W, W_B, W_T = f["W"], f["W_B"], f["W_T"]
        prod_tax, profit_F, div_F = f["prod_tax"], f["profit_F"], f["div_F"]
        profit_K, retained_K, div_K = f["profit_K"], f["retained_K"], f["div_K"]
        tax_B, tax_T, YD_B, YD_T, C_B, C_T = f["tax_B"], f["tax_T"], f["YD_B"], f["YD_T"], f["C_B"], f["C_T"]

        # ---------- realized flows ----------
        Y_meas = S / P
        u_true = Y_meas / Ystar_true
        u_meas = Y_meas / Ystar_meas
        retained_F = profit_F - div_F
        dL_F = I - retained_F
        taxes = tax_B + tax_T + prod_tax
        deficit = G + interest_gov + transfers_B + transfers_T - taxes

        # debt-service stress and write-offs
        dsr_B = (int_B + amort_B) / max(YD_B + int_B, 1e-9)
        dsr_T = (int_T + amort_T) / max(YD_T + int_T, 1e-9)
        wo_B = p.default_writeoff * L_B if dsr_B > p.dsr_default else 0.0
        wo_T = p.default_writeoff * L_T if dsr_T > p.dsr_default else 0.0
        writeoffs = wo_B + wo_T

        # ---------- update stocks ----------
        L_B = L_B + new_B - amort_B - wo_B
        L_T = L_T + new_T - amort_T - wo_T
        L_F = L_F + dL_F
        B = B + deficit
        # households' financial assets: cash-flow identity
        D_B = D_B + (YD_B - C_B - amort_B + new_B)
        fa_T = (D_T + Bh_T) + (YD_T - C_T - amort_T + new_T)
        Bh_T = p.hh_bills_share * (B - B_f)
        D_T = fa_T - Bh_T
        # rest of world reinvests its interest in bills
        B_f = B_f + int_foreign
        # banks
        E_K = E_K + retained_K - writeoffs
        B_K = B - B_f - Bh_T

        # ---------- divergence guard: stop cleanly if the run explodes ----------
        if not np.isfinite(S) or S > 100 or P > 100 or P < 1e-3 or abs(B) > 1e3:
            df = pd.DataFrame(rows)
            df.attrs["diverged_at"] = t
            return df

        # ---------- SFC check: sum of net financial assets == 0 ----------
        nfa_hh = (D_B + D_T + Bh_T) - (L_B + L_T)
        nfa_F = -L_F
        nfa_K = (L_B + L_T + L_F + B_K) - (D_B + D_T)
        nfa_G = -B
        nfa_row = B_f
        resid = nfa_hh + nfa_F + nfa_K + nfa_G + nfa_row
        bank_close = nfa_K - E_K
        scale = max(1.0, abs(B), abs(L_B + L_T + L_F), S * 4)
        if abs(resid) > 1e-8 * scale or abs(bank_close) > 1e-8 * scale:
            raise AssertionError(f"SFC identity violated at t={t}: resid={resid:.3e}, bank={bank_close:.3e}")

        # ---------- policy rate for next period ----------
        if p.policy_rule == "taylor":
            r_rule = (p.r_neutral + pi_yoy + p.taylor_pi * (pi_yoy - p.pi_target)
                      + p.taylor_gap * (u_meas - p.u_star))
            r_rule = max(0.0, r_rule)
            r_base = p.rate_smoothing * r_base + (1 - p.rate_smoothing) * r_rule
        elif p.policy_rule == "zirp":
            r_base = 0.0
        else:
            r_base = p.fixed_rate
        r_dev = r_dev * p.rate_shock_persistence + p.rate_shock.get(t + 1, 0.0)
        r = max(0.0, r_base + r_dev)

        # ---------- leverage targets for next period (Minsky) ----------
        if (t + 1) in p.leverage_shock and lev_B is not None:
            lev_B *= p.leverage_shock[t + 1]; lev_T *= p.leverage_shock[t + 1]
        if YD_B_prev:
            gB = YD_B / YD_B_prev - 1 - (p.g_potential + p.pi_target) * q
            gT = YD_T / YD_T_prev - 1 - (p.g_potential + p.pi_target) * q
            lev_B *= 1 + p.leverage_extrapolation * gB - p.leverage_stress * max(0.0, dsr_B - p.dsr_threshold)
            lev_T *= 1 + p.leverage_extrapolation * gT - p.leverage_stress * max(0.0, dsr_T - p.dsr_threshold)
            lev_B = float(np.clip(lev_B, 0.3, 3.0)); lev_T = float(np.clip(lev_T, 0.3, 3.0))

        gdp_annual = S * 4
        rows.append(dict(
            t=t, year=t / 4,
            adoption=A[t],
            inflation=pi * 100, inflation_yoy=pi_yoy * 100,
            policy_rate=r * 100, loan_rate=r_loan * 100,
            u_true=u_true, u_meas=u_meas,
            output_gap_meas=(u_meas - 1) * 100, output_gap_true=(u_true - 1) * 100,
            real_gdp_meas=Y_meas * 4, real_potential_true=Ystar_true * 4,
            nominal_gdp=gdp_annual, price_level=P,
            debt_household=(L_B + L_T) / gdp_annual * 100,
            debt_bottom50=L_B / gdp_annual * 100, debt_top50=L_T / gdp_annual * 100,
            debt_firms=L_F / gdp_annual * 100, debt_gov=B / gdp_annual * 100,
            debt_private_nonfin=(L_B + L_T + L_F) / gdp_annual * 100,
            debt_total=(L_B + L_T + L_F + B) / gdp_annual * 100,
            leverage_bottom=L_B / max(YD_B * 4, 1e-9), leverage_top=L_T / max(YD_T * 4, 1e-9),
            dsr_bottom=dsr_B * 100, dsr_top=dsr_T * 100,
            writeoffs_pct_gdp=writeoffs / gdp_annual * 100,
            bank_capital_ratio=E_K / max(L_B + L_T + L_F, 1e-9) * 100,
            credit_supply=credit_supply,
            bal_gov=-deficit / S * 100, bal_private=deficit / S * 100,
            gov_interest_pct_gdp=interest_gov / S * 100,
            tax_rate=tax_rate_t * 100,
            gov_interest_domestic_pct_gdp=(int_hh_bills + int_bank_bills) / S * 100,
            foreign_share_gov_debt=B_f / B * 100,
            wage_share=omega * 100, bottom50_wage_share=wB_share * 100,
            consumption_share=(C_B + C_T) / S * 100, invest_share=I / S * 100,
            income_bottom_real=YD_B / P * 4, income_top_real=YD_T / P * 4,
            new_credit_pct_gdp=(new_B + new_T + max(dL_F, 0)) / gdp_annual * 100,
        ))

        # ---------- carry ----------
        u_true_prev, u_meas_prev = u_true, u_meas
        r_loan_prev = r_loan
        YD_B_prev, YD_T_prev = YD_B, YD_T
        S_prev = S

    df = pd.DataFrame(rows)
    df.attrs["diverged_at"] = None
    return df


# ----------------------------------------------------------------------
# calibration: pick mpc_top and tax_rate so period 0 starts at u = 1 and
# the government balance matches the ledger
# ----------------------------------------------------------------------
def calibrate(p: Params, iters: int = 12) -> Params:
    p = replace(p)
    for _ in range(iters):
        # mpc_top -> utilization
        lo, hi = 0.3, 1.0
        for _ in range(40):
            mid = (lo + hi) / 2
            u0 = simulate(replace(p, mpc_top=mid, T=1))["u_true"].iloc[0]
            if u0 < 1.0:
                lo = mid
            else:
                hi = mid
        p = replace(p, mpc_top=(lo + hi) / 2)
        # tax_rate -> government balance
        lo, hi = 0.05, 0.6
        for _ in range(40):
            mid = (lo + hi) / 2
            bal = simulate(replace(p, tax_rate=mid, T=1))["bal_gov"].iloc[0] / 100
            if bal < p.target_gov_balance:
                lo = mid
            else:
                hi = mid
        p = replace(p, tax_rate=(lo + hi) / 2)
    return p


# ----------------------------------------------------------------------
# scenarios
# ----------------------------------------------------------------------
def scenarios(base: Params | None = None) -> dict[str, Params]:
    b = calibrate(base or Params())
    return {
        "baseline": b,
        "credit_boom": replace(b, leverage_extrapolation=0.5, loan_adjust=0.08, rate_smoothing=0.9,
                               leverage_shock={8: 1.1, 12: 1.05}),
        "baseline_high_capital_mpc": calibrate(replace(b, mpc_top_capital_income=0.6)),
        "dark_output_captured": replace(b, ai_max=1.0, dark_capture=1.0),
        "dark_output_passthrough": replace(b, ai_max=1.0, dark_capture=0.0),
        "dark_output_mixed": replace(b, ai_max=1.0, dark_capture=0.5),
        "dark_output_fiscal_offset": replace(b, ai_max=1.0, dark_capture=0.5, fiscal_stabilizer=0.5),
        "mosler_zirp_fiscal": replace(b, policy_rule="zirp", fiscal_stabilizer=0.5),
        "rate_hike_300bp": replace(b, rate_shock={20: 0.03}),
        "rate_hike_300bp_cost_channel": replace(b, rate_shock={20: 0.03}, cost_channel=0.5),
        "rate_hike_300bp_high_capital_mpc": replace(calibrate(replace(b, mpc_top_capital_income=0.6)), rate_shock={20: 0.03}),
        "fiscal_dominance": replace(b, fiscal_reaction=0.0, mpc_top_capital_income=0.5),
    }


SCENARIO_NOTES = {
    "baseline": "Calibrated to the 2026Q1 ledger; Taylor rule; passive (Bohn) fiscal reaction; no AI adoption.",
    "credit_boom": "Dalio's short-term debt cycle: lending standards loosen at quarters 8 and 12, leverage targets extrapolate income growth, the boom ends in debt-service stress and write-offs.",
    "dark_output_captured": "AI adoption to 100%; displaced wage bill captured as profits (sigma = 1). Real capacity rises 10% unmeasured.",
    "dark_output_passthrough": "AI adoption to 100%; displaced wage bill passed through as lower prices (sigma = 0).",
    "dark_output_mixed": "AI adoption to 100%; half captured, half passed through.",
    "dark_output_fiscal_offset": "As 'mixed', but with an active fiscal stabilizer (the MMT prescription).",
    "mosler_zirp_fiscal": "Policy rate permanently zero; fiscal policy does the stabilizing.",
    "rate_hike_300bp": "A 3pp policy-rate shock at quarter 20, decaying; conventional channels only (MPC out of capital income = 0.3).",
    "rate_hike_300bp_cost_channel": "Same hike, plus Mosler's cost channel: inflation responds to the change in loan rates.",
    "rate_hike_300bp_high_capital_mpc": "Same hike, with a higher MPC out of interest and dividends (0.6): the sign of rate policy flips. Compare against baseline_high_capital_mpc, not baseline.",
    "baseline_high_capital_mpc": "Reference run for the high-capital-MPC hike: same parameters, no shock.",
    "fiscal_dominance": "No fiscal reaction to debt, higher MPC out of capital income, Taylor rule: the interest-income spiral (Sargent-Wallace / Dalio's endgame). Diverges by design.",
}


def crux_scan(base: Params | None = None, shock: float = 0.03, at: int = 20, window: int = 12,
              mpcs=(0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7), debt_levels=(0.5, 1.07, 1.5)) -> pd.DataFrame:
    """The Mosler test: sign of a rate hike as a function of the MPC out of capital
    income and the level of public debt. Each cell recalibrates its own baseline."""
    out = []
    b = base or Params()
    for dg in debt_levels:
        for m in mpcs:
            pp = calibrate(replace(b, debt_gov=dg, mpc_top_capital_income=m))
            bb = simulate(pp)
            d = simulate(replace(pp, rate_shock={at: shock}))
            w = slice(at + 1, at + 1 + window)
            if d.attrs.get("diverged_at") is not None or len(d) < at + window:
                out.append(dict(debt_gov=dg * 100, mpc_capital=m, d_utilization=np.nan, d_inflation=np.nan, diverged=True))
                continue
            out.append(dict(
                debt_gov=dg * 100, mpc_capital=m,
                d_utilization=float((d.u_true.iloc[w] - bb.u_true.iloc[w]).mean() * 100),
                d_inflation=float((d.inflation_yoy.iloc[w] - bb.inflation_yoy.iloc[w]).mean()),
                diverged=False,
            ))
    return pd.DataFrame(out)


def run_all(base: Params | None = None) -> dict[str, pd.DataFrame]:
    return {name: simulate(p) for name, p in scenarios(base).items()}
