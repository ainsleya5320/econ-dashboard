"""
Minimal FRED fetcher for the SFC module.

Two paths:
  * Keyless: https://fred.stlouisfed.org/graph/fredgraph.csv?id=SERIES
    Works for every series used here, no registration needed.
  * Keyed:   https://api.stlouisfed.org/fred/series/observations
    Used automatically if FRED_API_KEY is set (higher rate limits,
    vintage support if you ever want ALFRED real-time data).

Everything is cached as CSV under data/cache/ so re-runs are free.
"""
from __future__ import annotations

import io
import os
import time
from pathlib import Path

import pandas as pd
import requests

CSV_URL = "https://fred.stlouisfed.org/graph/fredgraph.csv?id={sid}"
API_URL = "https://api.stlouisfed.org/fred/series/observations"

# NOTE: FRED's CSV endpoint has been observed to return 503 for some
# custom User-Agent strings; the default python-requests UA works.
_HEADERS: dict = {}


def _cache_path(cache_dir: Path, sid: str) -> Path:
    return cache_dir / f"{sid}.csv"


def _fetch_keyless(sid: str) -> pd.Series:
    r = requests.get(CSV_URL.format(sid=sid), headers=_HEADERS, timeout=30)
    r.raise_for_status()
    df = pd.read_csv(io.StringIO(r.text))
    # fredgraph.csv columns: observation_date (or DATE), <SID>
    date_col = df.columns[0]
    s = pd.Series(
        pd.to_numeric(df[sid], errors="coerce").values,
        index=pd.to_datetime(df[date_col]),
        name=sid,
    )
    return s.dropna()


def _fetch_keyed(sid: str, api_key: str) -> pd.Series:
    params = {"series_id": sid, "api_key": api_key, "file_type": "json"}
    r = requests.get(API_URL, params=params, headers=_HEADERS, timeout=30)
    r.raise_for_status()
    obs = r.json()["observations"]
    df = pd.DataFrame(obs)
    s = pd.Series(
        pd.to_numeric(df["value"], errors="coerce").values,
        index=pd.to_datetime(df["date"]),
        name=sid,
    )
    return s.dropna()


def fetch_series(
    sid: str,
    cache_dir: str | Path = "data/cache",
    max_age_days: float = 1.0,
    api_key: str | None = None,
) -> pd.Series:
    """Return one FRED series as a date-indexed pandas Series (cached)."""
    cache_dir = Path(cache_dir)
    cache_dir.mkdir(parents=True, exist_ok=True)
    p = _cache_path(cache_dir, sid)

    if p.exists():
        age_days = (time.time() - p.stat().st_mtime) / 86400
        if age_days < max_age_days:
            df = pd.read_csv(p, parse_dates=["date"])
            return pd.Series(df["value"].values, index=df["date"], name=sid)

    api_key = api_key or os.environ.get("FRED_API_KEY")
    s = _fetch_keyed(sid, api_key) if api_key else _fetch_keyless(sid)
    s.rename_axis("date").rename("value").reset_index().to_csv(p, index=False)
    return s.rename(sid)


def fetch_many(
    sids: list[str],
    cache_dir: str | Path = "data/cache",
    **kw,
) -> pd.DataFrame:
    """Fetch several series and outer-join them on date."""
    frames = []
    for sid in sids:
        try:
            frames.append(fetch_series(sid, cache_dir=cache_dir, **kw))
        except Exception as e:  # keep going; the ledger tolerates gaps
            print(f"[fred] warning: {sid} failed: {e}")
    return pd.concat(frames, axis=1).sort_index()
