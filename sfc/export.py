"""
Write the ledger, scenarios and crux scan as JSON for the Vite/React front end.

Output files (default: data/sfc/, where the Vite server reads them):
  sfc_history.json    quarterly ledger built from FRED (records, ISO dates, nulls for gaps)
  sfc_scenarios.json  calibration, baseline parameters, every scenario's path + notes
  sfc_crux.json       the rate-hike sign table (MPC out of capital income x public debt)
"""
from __future__ import annotations

import json
from dataclasses import asdict
from pathlib import Path

import numpy as np
import pandas as pd

from .ledger import build_ledger, calibration_from_ledger
from .model import Params, simulate, scenarios, crux_scan, SCENARIO_NOTES


def _records(df: pd.DataFrame, date_index: bool = False) -> list[dict]:
    out = df.copy().round(4)
    if date_index:
        out.insert(0, "date", out.index.strftime("%Y-%m-%d"))
    out = out.replace({np.nan: None, np.inf: None, -np.inf: None})
    return out.to_dict(orient="records")


def _params_diff(base: Params, other: Params) -> dict:
    b, o = asdict(base), asdict(other)
    return {k: o[k] for k in o if o[k] != b[k]}


def export_all(out_dir: str | Path = "data/sfc", cache_dir: str = "data/cache",
               run_crux: bool = True, verbose: bool = True) -> dict:
    out_dir = Path(out_dir); out_dir.mkdir(parents=True, exist_ok=True)

    # ---- layer 1: historical ledger ----
    L = build_ledger(cache_dir=cache_dir)
    calib = calibration_from_ledger(L)
    (out_dir / "sfc_history.json").write_text(json.dumps({
        "as_of": calib["as_of"],
        "columns": list(L.columns),
        "data": _records(L, date_index=True),
    }))
    if verbose:
        print(f"[export] ledger: {L.shape[0]} quarters x {L.shape[1]} series, as of {calib['as_of']}")

    # ---- layers 2-4: model, pinned to the ledger ----
    base = Params(
        debt_household=calib["debt_household_pct_gdp"] / 100,
        debt_firms=calib["debt_business_pct_gdp"] / 100,
        debt_gov=calib["debt_federal_pct_gdp"] / 100,
        bottom50_share_hh_debt=calib["bottom50_share_hh_debt"],
        wage_share=calib["wage_share"],
        gov_purchases=calib["gov_spend_share"],
        target_gov_balance=calib["bal_gov"] / 100,
    )
    sc = scenarios(base)
    b = sc["baseline"]
    runs = {}
    for name, p in sc.items():
        df = simulate(p)
        runs[name] = {
            "note": SCENARIO_NOTES.get(name, ""),
            "diverged_at": df.attrs.get("diverged_at"),
            "params_diff": _params_diff(b, p),
            "data": _records(df),
        }
        if verbose:
            tag = f" (diverged at t={df.attrs['diverged_at']})" if df.attrs.get("diverged_at") is not None else ""
            print(f"[export] scenario {name}: {len(df)} quarters{tag}")
    (out_dir / "sfc_scenarios.json").write_text(json.dumps({
        "calibration": calib,
        "baseline_params": asdict(b),
        "scenarios": runs,
    }))

    # ---- the crux table ----
    if run_crux:
        cs = crux_scan(base)
        (out_dir / "sfc_crux.json").write_text(json.dumps({
            "description": "Average change in true utilization (pp) and inflation (pp) over the 12 quarters "
                           "after a 3pp policy-rate shock, relative to each cell's own calibrated baseline.",
            "data": _records(cs),
        }))
        if verbose:
            print("[export] crux scan written")
    return {"ledger": L, "calibration": calib, "scenarios": sc}
