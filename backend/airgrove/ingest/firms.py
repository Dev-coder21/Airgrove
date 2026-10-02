"""NASA FIRMS VIIRS (S-NPP) fire detections over north India & Pakistan Punjab.

Area 70-85E, 24-33N. The standard-processing archive (VIIRS_SNPP_SP) is used where it exists and
the near-real-time feed (VIIRS_SNPP_NRT) after it; the two are never mixed for the same day.
Requests are <= 5 days each and cached; the MAP_KEY is never written to the cache key.
"""

from __future__ import annotations

import io
import json
import os
from datetime import date, datetime, timedelta

import pandas as pd
from dotenv import load_dotenv

from .cache import CachedGet
from .openaq import ROOT

AREA = "70,24,85,33"  # west, south, east, north
BASE = "https://firms.modaps.eosdis.nasa.gov/api"
OUT = ROOT / "data" / "interim"


def _key() -> str:
    load_dotenv(ROOT / ".env")
    k = os.environ.get("FIRMS_MAP_KEY", "").strip()
    if not k:
        raise RuntimeError("FIRMS_MAP_KEY is not set in .env")
    return k


def availability(http: CachedGet, key: str) -> dict[str, tuple[date, date]]:
    # not cached: the NRT end date moves every day
    import httpx

    txt = httpx.get(f"{BASE}/data_availability/csv/{key}/ALL", timeout=60).text
    df = pd.read_csv(io.StringIO(txt))
    return {
        r.data_id: (date.fromisoformat(r.min_date), date.fromisoformat(r.max_date))
        for r in df.itertuples()
    }


def _fetch(
    http: CachedGet, key: str, sat: str, start: date, end: date, sp_end: date
) -> list[pd.DataFrame]:
    """<= 5-day requests for one satellite; SP archive up to `sp_end`, NRT after."""
    frames, d = [], start
    while d <= end:
        src = f"VIIRS_{sat}_SP" if d <= sp_end else f"VIIRS_{sat}_NRT"
        last = min(end, d + timedelta(days=4), sp_end if d <= sp_end else end)
        n = (last - d).days + 1
        url = f"{BASE}/area/csv/{{secret}}/{src}/{AREA}/{n}/{d.isoformat()}"
        txt = http.get(url, secret=key, as_text=True)
        if txt.strip() and not txt.lower().startswith(("invalid", "error")):
            df = pd.read_csv(io.StringIO(txt))
            if len(df):
                df["source"] = src
                frames.append(df)
        d = last + timedelta(days=1)
    return frames


def _days(a: date, b: date) -> list[date]:
    return [a + timedelta(days=i) for i in range((b - a).days + 1)]


PARTIAL_GAP_RATIO = 0.3  # a NOAA-20 day with < 30% of S-NPP's detections (S-NPP >= 50) is a gap
PARTIAL_GAP_MIN = 50


def download_fires(start: date, end: date, log=print) -> pd.DataFrame:
    """One consistent source: NOAA-20 VIIRS everywhere (it has data on every day of the period);
    S-NPP only on NOAA-20's own gap days: days with no NOAA-20 data, or with < 30% of S-NPP's
    detections (missing granules). Never both satellites on the same day, so nothing is counted
    twice. `source` records the product of each detection."""
    key = _key()
    http = CachedGet("firms", per_min=60)
    av = availability(http, key)
    n20 = pd.concat(
        _fetch(http, key, "NOAA20", start, end, av["VIIRS_NOAA20_SP"][1]), ignore_index=True
    )
    snpp = pd.concat(
        _fetch(http, key, "SNPP", start, end, av["VIIRS_SNPP_SP"][1]), ignore_index=True
    )
    for df in (n20, snpp):
        df["day"] = pd.to_datetime(df["acq_date"]).dt.date
    cn, cs = n20.groupby("day").size(), snpp.groupby("day").size()
    gaps = []
    for d in _days(start, end):
        n, s = int(cn.get(d, 0)), int(cs.get(d, 0))
        if n == 0 and s > 0:
            gaps.append((d, "no NOAA-20 data", n, s))
        elif s >= PARTIAL_GAP_MIN and n < PARTIAL_GAP_RATIO * s:
            gaps.append((d, "NOAA-20 partial", n, s))
    gap_days = {g[0] for g in gaps}
    df = pd.concat(
        [n20[~n20["day"].isin(gap_days)], snpp[snpp["day"].isin(gap_days)]], ignore_index=True
    )
    log(
        f"  FIRMS: NOAA-20 primary; S-NPP on {len(gaps)} gap days: "
        + "; ".join(f"{d} ({why}: {n} vs {s})" for d, why, n, s in gaps)
        + f" | requests {http.requests_made}, cache {http.cache_hits}"
    )
    t = df["acq_time"].astype(int).astype(str).str.zfill(4)
    df["ts_utc"] = pd.to_datetime(df["acq_date"] + " " + t.str[:2] + ":" + t.str[2:], utc=True)
    df = df.rename(columns={"latitude": "lat", "longitude": "lon"})
    keep = ["ts_utc", "lat", "lon", "frp", "confidence", "daynight", "source"]
    df = (
        df[keep]
        .astype({"confidence": str})
        .drop_duplicates(["ts_utc", "lat", "lon"])
        .sort_values("ts_utc")
    )
    OUT.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT / "fires.parquet", index=False)
    return df


def period() -> tuple[date, date]:
    cov = json.loads((ROOT / "reports" / "coverage.json").read_text(encoding="utf-8"))
    latest = datetime.fromisoformat(cov["latest_reading_utc"]).date()
    return date(2025, 1, 29), latest  # 3 days before the PM2.5 start, for 72 h fire lookbacks
