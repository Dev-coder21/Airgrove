"""Download hourly PM2.5 for every station, resumable.

- Forecast-ready cities: full history from 2025-02-01 (IST) to the coverage run's latest reading.
- Observed-only cities: the last 14 days, enough for the globe.

Requests go month by month (IST months, padded 2 h each side, so every IST hour incl. 00:00 is
inside a window), each one cached. When a sensor is complete its rows are written to
data/interim/openaq/<sensor>.parquet; a re-run skips finished sensors and only requests what is
missing from the cache. Rows are keyed by (sensor_id, period start UTC), so overlapping windows
never count a reading twice.
"""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

import pandas as pd

from .openaq import ROOT, OpenAQ

IST = timezone(timedelta(hours=5, minutes=30))
OUT = ROOT / "data" / "interim" / "openaq"
START_IST = datetime(2025, 2, 1, tzinfo=IST)
RECENT_DAYS = 14
F = "%Y-%m-%dT%H:%M:%SZ"


def month_windows(start: datetime, end: datetime, pad_h: int = 2) -> list[tuple[str, str]]:
    """IST calendar months from `start` to `end`, as padded UTC request windows."""
    out, cur = [], start.astimezone(IST)
    while cur < end:
        nxt = (cur.replace(day=1) + timedelta(days=32)).replace(day=1)
        b = min(nxt, end)
        out.append(
            (
                (cur - timedelta(hours=pad_h)).astimezone(timezone.utc).strftime(F),
                (b + timedelta(hours=pad_h)).astimezone(timezone.utc).strftime(F),
            )
        )
        cur = nxt
    return out


def rows_to_frame(rows: list[dict], sensor_id: int, location_id: int) -> pd.DataFrame:
    df = pd.DataFrame(
        {
            "sensor_id": sensor_id,
            "location_id": location_id,
            "ts_utc": pd.to_datetime([r["period"]["datetimeFrom"]["utc"] for r in rows], utc=True),
            "value": [r["value"] for r in rows],
            "n_obs": [(r.get("coverage") or {}).get("observedCount") for r in rows],
        }
    )
    return df.drop_duplicates(["sensor_id", "ts_utc"]).sort_values("ts_utc")


def plan() -> tuple[list[dict], datetime]:
    cov = json.loads((ROOT / "reports" / "coverage.json").read_text(encoding="utf-8"))
    stations = json.loads((ROOT / "data" / "stations.json").read_text(encoding="utf-8"))
    ready = {c["name"] for c in cov["cities"] if c["forecast_ready"]}
    latest = datetime.fromisoformat(cov["latest_reading_utc"])
    jobs = []
    for s in stations:
        full = s["city"] in ready
        start = START_IST if full else latest - timedelta(days=RECENT_DAYS)
        jobs.append(
            {**s, "full": full, "windows": month_windows(start, latest + timedelta(hours=1))}
        )
    return jobs, latest


def download(oa: OpenAQ, log=print) -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    jobs, latest = plan()
    jobs.sort(key=lambda j: (not j["full"], j["city"], j["sensor_id"]))
    todo = [j for j in jobs if not (OUT / f"{j['sensor_id']}.parquet").exists()]
    n_req = sum(len(j["windows"]) for j in todo)
    log(
        f"{len(jobs)} stations ({sum(j['full'] for j in jobs)} full history); {len(todo)} to do, "
        f"up to {n_req} requests (cached ones are free); data up to {latest:%Y-%m-%d %H:%M} UTC"
    )
    for k, j in enumerate(todo, 1):
        rows: list[dict] = []
        try:
            for a, b in j["windows"]:
                rows += oa.sensor_hours(j["sensor_id"], a, b)
        except RuntimeError as e:  # leave it for the next run; everything fetched so far is cached
            log(f"  SKIPPED {j['name']} (sensor {j['sensor_id']}): {e}")
            continue
        df = (
            rows_to_frame(rows, j["sensor_id"], j["location_id"])
            if rows
            else rows_to_frame([], j["sensor_id"], j["location_id"])
        )
        tmp = OUT / f"{j['sensor_id']}.parquet.tmp"
        df.to_parquet(tmp, index=False)
        tmp.replace(OUT / f"{j['sensor_id']}.parquet")
        if k % 10 == 0 or k == len(todo):
            log(
                f"  {k}/{len(todo)} stations · {j['city']} · requests {oa.requests_made}, cache hits {oa.cache_hits}"
            )
