"""Open-Meteo: historical-forecast weather and CAMS PM2.5 per city, on OpenAQ's :30 periods.

Both APIs return values on whole UTC hours. OpenAQ hours are IST clock hours, i.e. periods
[T-30min, T+30min) around each whole UTC hour T. Mapping onto a period:
- instantaneous variables (temperature, RH, boundary-layer height, wind, CAMS PM2.5): the mean of
  the linearly interpolated curve over the period = 0.125*x(T-1) + 0.75*x(T) + 0.125*x(T+1);
- wind: interpolated as u/v components, then converted back to speed/direction;
- precipitation (Open-Meteo: total over the preceding hour): 0.5*p(T) + 0.5*p(T+1).
Each period is labelled by its start (T-30min), matching OpenAQ.

Weather uses the *historical-forecast* API (stitched short-range forecasts), not reanalysis, so
features look like what a forecast would have known.

CAMS (air-quality API) is available from 2022-08-04. Historical values are a stitched series of
the most recent run at each hour (short lead time); the API returns nothing for the
`*_previous_day1..3` variables, so true 1-3-day-ahead CAMS forecasts cannot be reconstructed.
"""

from __future__ import annotations

import json
from datetime import date, datetime, timedelta

import numpy as np
import pandas as pd

from .cache import CachedGet
from .openaq import ROOT

WEATHER_URL = "https://historical-forecast-api.open-meteo.com/v1/forecast"
AQ_URL = "https://air-quality-api.open-meteo.com/v1/air-quality"
WEATHER_VARS = [
    "temperature_2m",
    "relative_humidity_2m",
    "wind_speed_10m",
    "wind_direction_10m",
    "precipitation",
    "boundary_layer_height",
]
CAMS_FIRST_DAY = date(2022, 8, 4)
OUT = ROOT / "data" / "interim"


def _cities() -> tuple[list[dict], datetime]:
    cov = json.loads((ROOT / "reports" / "coverage.json").read_text(encoding="utf-8"))
    return cov["cities"], datetime.fromisoformat(cov["latest_reading_utc"])


def _chunks(a: date, b: date, days: int = 183) -> list[tuple[date, date]]:
    out = []
    while a <= b:
        e = min(b, a + timedelta(days=days - 1))
        out.append((a, e))
        a = e + timedelta(days=1)
    return out


def _hourly_frame(js: dict) -> pd.DataFrame:
    h = js["hourly"]
    df = pd.DataFrame(h)
    df["time"] = pd.to_datetime(df["time"], utc=True)
    return df.set_index("time")


def to_periods(
    df: pd.DataFrame, inst: list[str], accum: list[str], wind: tuple[str, str] | None
) -> pd.DataFrame:
    """Hourly (whole UTC hour) frame -> OpenAQ periods labelled by start (T - 30 min)."""
    df = df.sort_index()
    df = df[~df.index.duplicated()].asfreq("h")
    out = pd.DataFrame(index=df.index - pd.Timedelta(minutes=30))
    for c in inst:
        x = df[c]
        out[c] = (0.125 * x.shift(1) + 0.75 * x + 0.125 * x.shift(-1)).to_numpy()
    for c in accum:
        p = df[c]
        out[c] = (0.5 * p + 0.5 * p.shift(-1)).to_numpy()
    if wind:
        spd, d = df[wind[0]], np.deg2rad(df[wind[1]])
        u, v = -spd * np.sin(d), -spd * np.cos(d)  # meteorological "from" direction
        um = 0.125 * u.shift(1) + 0.75 * u + 0.125 * u.shift(-1)
        vm = 0.125 * v.shift(1) + 0.75 * v + 0.125 * v.shift(-1)
        out["wind_u"] = um.to_numpy()
        out["wind_v"] = vm.to_numpy()
        out[wind[0]] = np.hypot(um, vm).to_numpy()
        out[wind[1]] = ((np.rad2deg(np.arctan2(-um, -vm)) + 360) % 360).to_numpy()
    out.index.name = "ts_utc"
    return out


def download_weather(log=print) -> pd.DataFrame:
    """Weather for every city: full period for forecast-ready cities, last 15 days for the rest.

    Open-Meteo counts long/many-variable requests as several calls (free tier: 5,000/hour,
    10,000/day); a 183-day, 6-variable request is ~8 calls, so requests are paced at 8/min.
    """
    cities, latest = _cities()
    http = CachedGet("openmeteo_weather", per_min=8)
    end = latest.date() + timedelta(days=1)
    frames = []
    for k, c in enumerate(cities, 1):
        start = date(2025, 1, 30) if c["forecast_ready"] else latest.date() - timedelta(days=15)
        parts = []
        for a, b in _chunks(start, end):
            js = http.get(
                WEATHER_URL,
                {
                    "latitude": c["lat"],
                    "longitude": c["lon"],
                    "start_date": str(a),
                    "end_date": str(b),
                    "hourly": ",".join(WEATHER_VARS),
                    "timezone": "GMT",
                },
            )
            parts.append(_hourly_frame(js))
        p = to_periods(
            pd.concat(parts),
            ["temperature_2m", "relative_humidity_2m", "boundary_layer_height"],
            ["precipitation"],
            ("wind_speed_10m", "wind_direction_10m"),
        )
        p.insert(0, "city_id", c["id"])
        frames.append(p.reset_index())
        if k % 25 == 0 or k == len(cities):
            log(
                f"  weather {k}/{len(cities)} cities (requests {http.requests_made}, cache {http.cache_hits})"
            )
    df = pd.concat(frames, ignore_index=True)
    OUT.mkdir(parents=True, exist_ok=True)
    df.to_parquet(OUT / "weather.parquet", index=False)
    return df


def download_cams(log=print) -> pd.DataFrame:
    """CAMS PM2.5 for the forecast-ready cities over the full available window."""
    cities, latest = _cities()
    cities = [c for c in cities if c["forecast_ready"]]
    http = CachedGet("openmeteo_cams", per_min=30)
    frames = []
    for k, c in enumerate(cities, 1):
        parts = []
        for a, b in _chunks(CAMS_FIRST_DAY, latest.date() + timedelta(days=1)):
            js = http.get(
                AQ_URL,
                {
                    "latitude": c["lat"],
                    "longitude": c["lon"],
                    "start_date": str(a),
                    "end_date": str(b),
                    "hourly": "pm2_5",
                    "timezone": "GMT",
                    "domains": "cams_global",
                },
            )
            parts.append(_hourly_frame(js))
        p = to_periods(pd.concat(parts), ["pm2_5"], [], None).rename(columns={"pm2_5": "cams_pm25"})
        p.insert(0, "city_id", c["id"])
        frames.append(p.reset_index())
        if k % 25 == 0 or k == len(cities):
            log(
                f"  CAMS {k}/{len(cities)} cities (requests {http.requests_made}, cache {http.cache_hits})"
            )
    df = pd.concat(frames, ignore_index=True)
    df.to_parquet(OUT / "cams.parquet", index=False)
    return df
