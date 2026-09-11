"""Build the ledger from FRED, run the model, write JSON for the dashboard.

    python run_sfc.py                 # writes to data/sfc/
    python run_sfc.py --out other/dir --no-crux
"""
import argparse
from sfc.export import export_all

if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="data/sfc")
    ap.add_argument("--cache", default="data/cache")
    ap.add_argument("--no-crux", action="store_true", help="skip the (slower) rate-hike sign scan")
    a = ap.parse_args()
    export_all(out_dir=a.out, cache_dir=a.cache, run_crux=not a.no_crux)
