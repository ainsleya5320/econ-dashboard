"""
Catalogue of the FRED series the ledger uses, tagged by model layer.

Layer 1  ledger     -- Z.1 Financial Accounts + NIPA sectoral flows
Layer 2  agents     -- Distributional Financial Accounts (heterogeneity)
Layer 3  capacity   -- real-resource constraint indicators
Layer 4  measurement-- proxies for output the accounts may not see

Units column matters: Z.1 levels are $ millions (not annualized);
NIPA flows are $ billions at seasonally adjusted annual rates (SAAR);
BEA current-account balance (IEABC) is $ millions per quarter.
All series were verified live against fredgraph.csv on 2026-09-10.
"""

SERIES = {
    # ---------------- Layer 1: ledger (stocks) ----------------
    "GDP":        dict(name="Nominal GDP",                               layer="ledger", units="bn_saar"),
    "DPI":        dict(name="Disposable personal income",                layer="ledger", units="bn_saar"),
    "CP":         dict(name="Corporate profits after tax",               layer="ledger", units="bn_saar"),
    "CMDEBT":     dict(name="Household & nonprofit debt (Z.1)",          layer="ledger", units="mn_level"),
    "TBSDODNS":   dict(name="Nonfinancial business debt (Z.1)",          layer="ledger", units="mn_level"),
    "BCNSDODNS":  dict(name="Nonfinancial corporate debt (Z.1)",         layer="ledger", units="mn_level"),
    "FGSDODNS":   dict(name="Federal government debt (Z.1)",             layer="ledger", units="mn_level"),
    "SLGSDODNS":  dict(name="State & local government debt (Z.1)",       layer="ledger", units="mn_level"),
    "DODFS":      dict(name="Domestic financial sector debt (Z.1)",      layer="ledger", units="mn_level"),
    "TCMDO":      dict(name="All-sector debt (Z.1)",                     layer="ledger", units="mn_level"),
    "TNWBSHNO":   dict(name="Household net worth (Z.1)",                 layer="ledger", units="mn_level"),
    "TDSP":       dict(name="Household debt service ratio (%)",          layer="ledger", units="pct"),
    # ---------------- Layer 1: ledger (flows / sectoral balances) ----------------
    "AD01RC1Q027SBEA": dict(name="Government net lending (+) / borrowing (-)", layer="ledger", units="bn_saar"),
    "IEABC":      dict(name="Current account balance",                   layer="ledger", units="mn_qtr"),
    "GPSAVE":     dict(name="Gross private saving",                      layer="ledger", units="bn_saar"),
    "GPDI":       dict(name="Gross private domestic investment",         layer="ledger", units="bn_saar"),
    "FGRECPT":    dict(name="Federal current receipts",                  layer="ledger", units="bn_saar"),
    "FGEXPND":    dict(name="Federal current expenditures",              layer="ledger", units="bn_saar"),
    "A091RC1Q027SBEA": dict(name="Federal interest payments",            layer="ledger", units="bn_saar"),
    "COE":        dict(name="Compensation of employees",                 layer="ledger", units="bn_saar"),
    "PCEC":       dict(name="Personal consumption expenditures",         layer="ledger", units="bn_saar"),
    "GCE":        dict(name="Government consumption & gross investment", layer="ledger", units="bn_saar"),
    "W055RC1Q027SBEA": dict(name="Personal current taxes",               layer="ledger", units="bn_saar"),
    "FEDFUNDS":   dict(name="Effective fed funds rate (%)",              layer="ledger", units="pct"),
    "GS10":       dict(name="10-year Treasury yield (%)",                layer="ledger", units="pct"),
    "IORB":       dict(name="Interest on reserve balances (%)",          layer="ledger", units="pct"),
    "WRESBAL":    dict(name="Reserve balances at the Fed",               layer="ledger", units="mn_level"),
    # ---------------- Layer 2: agents (heterogeneity) ----------------
    "WFRBLB50100": dict(name="Liabilities held by bottom 50% (DFA)",     layer="agents", units="mn_level"),
    "WFRBLB50107": dict(name="Net worth held by bottom 50% (DFA)",       layer="agents", units="mn_level"),
    "WFRBSB50215": dict(name="Bottom 50% share of net worth (%)",        layer="agents", units="pct"),
    "WFRBLT01020": dict(name="Liabilities held by top 1% (DFA)",         layer="agents", units="mn_level"),
    "WFRBLT01026": dict(name="Net worth held by top 1% (DFA)",           layer="agents", units="mn_level"),
    "WFRBST01134": dict(name="Top 1% share of net worth (%)",            layer="agents", units="pct"),
    # ---------------- Layer 3: real capacity ----------------
    "TCU":        dict(name="Capacity utilization, total industry (%)", layer="capacity", units="pct"),
    "JTSJOL":     dict(name="Job openings (thousands)",                  layer="capacity", units="thous"),
    "UNEMPLOY":   dict(name="Unemployed (thousands)",                    layer="capacity", units="thous"),
    "LNS12300060": dict(name="Prime-age employment/population (%)",     layer="capacity", units="pct"),
    "UNRATE":     dict(name="Unemployment rate (%)",                     layer="capacity", units="pct"),
    "CPIAUCSL":   dict(name="CPI-U (index)",                             layer="capacity", units="index"),
    # ---------------- Layer 4: measurement / dark output proxies ----------------
    "OPHNFB":     dict(name="Nonfarm business output per hour (index)", layer="measurement", units="index"),
    "USPBS":      dict(name="Professional & business services employment (thous)", layer="measurement", units="thous"),
    "CES6054110001": dict(name="Legal services employment (thous)",     layer="measurement", units="thous"),
    "CES6000000003": dict(name="Avg hourly earnings, prof. & business services", layer="measurement", units="usd"),
}

BY_LAYER = {}
for sid, meta in SERIES.items():
    BY_LAYER.setdefault(meta["layer"], []).append(sid)
