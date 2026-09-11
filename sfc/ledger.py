"""
Layer 1 (plus the observable bits of layers 2-4): the historical ledger.

build_ledger() returns a quarterly DataFrame in which every column is in
one of three units: % of GDP, % (rates/ratios), or an index. It is the
thing the React panel charts, and the thing the model is calibrated to.

Conventions
-----------
Sectoral balances follow Godley:   (S - I) + (T - G) + (M - X) = 0
  private  = net lending of households + firms  (S - I)
  gov      = net lending of general government  (T - G), from NIPA
  foreign  = net lending of the rest of world   (M - X) = -current account
They sum to zero by construction (private is the residual).

The credit gap is the BIS one: private nonfinancial credit / GDP minus a
one-sided HP trend with lambda = 400,000. It's the closest thing to a
Dalio "debt rising faster than income" indicator that anyone has
institutionalized (it steers the Basel III countercyclical buffer).
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .fred import fetch_many
from .series import SERIES


# ----------------------------------------------------------------------
# helpers
# ----------------------------------------------------------------------
def to_quarterly(df: pd.DataFrame) -> pd.DataFrame:
    """Resample mixed-frequency columns to quarter-start dates.

    Levels/rates are averaged within the quarter; quarterly series pass
    through untouched. Everything is stamped on the first day of the
    quarter to match FRED's Z.1 / NIPA convention (1990-01-01 = 1990Q1).
    """
    out = df.resample("QS").mean()
    return out


def hp_trend(y: np.ndarray, lam: float) -> np.ndarray:
    """Two-sided Hodrick-Prescott trend by dense solve (fine for n < 2000)."""
    n = len(y)
    if n < 3:
        return y.copy()
    K = np.zeros((n - 2, n))
    for i in range(n - 2):
        K[i, i], K[i, i + 1], K[i, i + 2] = 1.0, -2.0, 1.0
    A = np.eye(n) + lam * K.T @ K
    return np.linalg.solve(A, y)


def one_sided_hp(y: pd.Series, lam: float = 400_000.0, min_obs: int = 40) -> pd.Series:
    """BIS-style one-sided HP: refit on data up to t, keep the last value."""
    vals = y.values.astype(float)
    out = np.full(len(vals), np.nan)
    for t in range(min_obs, len(vals)):
        seg = vals[: t + 1]
        if np.isnan(seg).any():
            continue
        out[t] = hp_trend(seg, lam)[-1]
    return pd.Series(out, index=y.index)


# ----------------------------------------------------------------------
# main entry point
# ----------------------------------------------------------------------
def build_ledger(cache_dir: str = "data/cache", start: str = "1980-01-01") -> pd.DataFrame:
    raw = fetch_many(list(SERIES), cache_dir=cache_dir)
    q = to_quarterly(raw)
    q = q[q.index >= pd.Timestamp(start)]

    gdp = q["GDP"]                       # $bn SAAR
    L = pd.DataFrame(index=q.index)

    # --- stocks as % of GDP (Z.1 levels are $mn, GDP is $bn) ---
    def stock_pct(sid):
        return q[sid] / 1000.0 / gdp * 100.0

    L["debt_household"]  = stock_pct("CMDEBT")
    L["debt_business"]   = stock_pct("TBSDODNS")
    L["debt_corporate"]  = stock_pct("BCNSDODNS")
    L["debt_federal"]    = stock_pct("FGSDODNS")
    L["debt_statelocal"] = stock_pct("SLGSDODNS")
    L["debt_financial"]  = stock_pct("DODFS")
    L["debt_total"]      = stock_pct("TCMDO")
    L["debt_private_nonfin"] = L["debt_household"] + L["debt_business"]
    L["networth_household"]  = stock_pct("TNWBSHNO")
    L["household_debt_to_dpi"] = q["CMDEBT"] / 1000.0 / q["DPI"] * 100.0
    L["household_dsr"] = q["TDSP"]

    # --- Dalio-style indicators ---
    L["credit_gap"] = L["debt_private_nonfin"] - one_sided_hp(L["debt_private_nonfin"])
    L["debt_growth_yoy"]   = q["TCMDO"].pct_change(4) * 100.0
    L["income_growth_yoy"] = gdp.pct_change(4) * 100.0
    L["debt_minus_income_growth"] = L["debt_growth_yoy"] - L["income_growth_yoy"]

    # --- sectoral balances, % of GDP ---
    L["bal_gov"]     = q["AD01RC1Q027SBEA"] / gdp * 100.0
    ca_saar_bn       = q["IEABC"] * 4.0 / 1000.0
    L["bal_foreign"] = -ca_saar_bn / gdp * 100.0
    L["bal_private"] = -(L["bal_gov"] + L["bal_foreign"])
    L["bal_private_direct"] = (q["GPSAVE"] - q["GPDI"]) / gdp * 100.0  # cross-check
    L["federal_deficit_pct"] = (q["FGEXPND"] - q["FGRECPT"]) / gdp * 100.0

    # --- MMT interest-income channel ---
    L["fed_interest_pct_gdp"] = q["A091RC1Q027SBEA"] / gdp * 100.0
    L["policy_rate"] = q["FEDFUNDS"]
    L["ten_year"]    = q["GS10"]
    L["iorb"]        = q["IORB"]
    L["reserves_pct_gdp"] = stock_pct("WRESBAL")

    # --- income shares used for calibration ---
    L["wage_share"]   = q["COE"] / gdp * 100.0
    L["profit_share"] = q["CP"] / gdp * 100.0
    L["gov_spend_share"] = q["GCE"] / gdp * 100.0
    L["consumption_share"] = q["PCEC"] / gdp * 100.0
    L["personal_tax_share"] = q["W055RC1Q027SBEA"] / gdp * 100.0

    # --- Layer 2: heterogeneity (DFA) ---
    L["bottom50_share_hh_debt"] = q["WFRBLB50100"] / q["CMDEBT"] * 100.0
    L["bottom50_share_networth"] = q["WFRBSB50215"]
    L["bottom50_debt_to_networth"] = q["WFRBLB50100"] / q["WFRBLB50107"] * 100.0
    L["top1_share_hh_debt"] = q["WFRBLT01020"] / q["CMDEBT"] * 100.0
    L["top1_share_networth"] = q["WFRBST01134"]

    # --- Layer 3: capacity ---
    L["capacity_util"] = q["TCU"]
    L["vacancies_per_unemployed"] = q["JTSJOL"] / q["UNEMPLOY"]
    L["prime_age_epop"] = q["LNS12300060"]
    L["unemployment"] = q["UNRATE"]
    L["cpi_inflation_yoy"] = q["CPIAUCSL"].pct_change(4) * 100.0

    # --- Layer 4: measurement / dark-output proxies ---
    L["productivity_yoy"] = q["OPHNFB"].pct_change(4) * 100.0
    base = q.loc["2019-01-01":"2019-10-01"]
    L["prof_services_emp_idx"] = q["USPBS"] / base["USPBS"].mean() * 100.0
    L["legal_emp_idx"]         = q["CES6054110001"] / base["CES6054110001"].mean() * 100.0
    L["prof_services_ahe_yoy"] = q["CES6000000003"].pct_change(4) * 100.0
    L["legal_emp_yoy"]         = q["CES6054110001"].pct_change(4) * 100.0
    # the SemiAnalysis "fewer jobs, higher wages" signal: wage growth minus employment growth
    L["dark_output_signal"] = L["prof_services_ahe_yoy"] - L["legal_emp_yoy"]

    return L.round(4)


def calibration_from_ledger(L: pd.DataFrame, window: int = 4) -> dict:
    """Latest-`window`-quarter averages of the ratios the model is pinned to."""
    tail = L.dropna(subset=["debt_household", "debt_federal"]).tail(window)
    last = tail.mean(numeric_only=True)
    return {
        "as_of": str(tail.index[-1].date()),
        "debt_household_pct_gdp": float(last["debt_household"]),
        "debt_business_pct_gdp": float(last["debt_business"]),
        "debt_federal_pct_gdp": float(last["debt_federal"]),
        "networth_household_pct_gdp": float(last["networth_household"]),
        "wage_share": float(last["wage_share"]) / 100.0,
        "profit_share": float(last["profit_share"]) / 100.0,
        "gov_spend_share": float(last["gov_spend_share"]) / 100.0,
        "consumption_share": float(last["consumption_share"]) / 100.0,
        "fed_interest_pct_gdp": float(last["fed_interest_pct_gdp"]),
        "policy_rate": float(last["policy_rate"]),
        "bottom50_share_hh_debt": float(last["bottom50_share_hh_debt"]) / 100.0,
        "bottom50_share_networth": float(last["bottom50_share_networth"]) / 100.0,
        "capacity_util": float(last["capacity_util"]),
        "cpi_inflation_yoy": float(last["cpi_inflation_yoy"]),
        "household_dsr": float(last["household_dsr"]),
        "bal_gov": float(last["bal_gov"]),
        "bal_foreign": float(last["bal_foreign"]),
        "bal_private": float(last["bal_private"]),
    }
