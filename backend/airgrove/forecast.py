"""Final model: train the national LightGBM (p10/p50/p90) on all data and forecast the next 72 h
from the latest reading for every forecast-ready city, with conformally calibrated bands.

"Now" is the latest hour at which at least 80% of forecast-ready cities have a reading; cities
without complete input history at that hour get no forecast (they show observations only).
Weather at the target hours comes from Open-Meteo (archived forecasts up to today, forecast API
after), fetched once and cached.
"""

from __future__ import annotations

import json
from datetime import timedelta

import lightgbm as lgb
import numpy as np
import pandas as pd

from . import features as F
from .backtest import BUCKETS, PARAMS, ROUNDS, base_grid, load
from .clean import city_series, station_ratios
from .ingest.cache import CachedGet
from .ingest.openaq import ROOT
from .ingest.openmeteo import WEATHER_VARS, _hourly_frame, to_periods

OUT = ROOT / "data" / "forecast"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
TRAIN_STEP = 6
MAX_TRAIN = 3_000_000
FALLBACK_H = 6


def future_weather(cities: pd.DataFrame, start, end) -> pd.DataFrame:
    """Hourly weather [start, end] for each city from the forecast API (past_days covers recent
    days), mapped onto :30 periods like the archive."""
    http = CachedGet("openmeteo_forecast", per_min=30)
    frames = []
    for c in cities.itertuples():
        js = http.get(
            FORECAST_URL,
            {
                "latitude": c.lat,
                "longitude": c.lon,
                "hourly": ",".join(WEATHER_VARS),
                "start_date": str(start),
                "end_date": str(end),
                "timezone": "GMT",
            },
        )
        p = to_periods(
            _hourly_frame(js),
            ["temperature_2m", "relative_humidity_2m", "boundary_layer_height"],
            ["precipitation"],
            ("wind_speed_10m", "wind_direction_10m"),
        )
        p.insert(0, "city_id", c.id)
        frames.append(p.reset_index())
    return pd.concat(frames, ignore_index=True)


def run(log=print, retrain: bool = False) -> dict:
    D = load()
    cal = json.loads((ROOT / "reports" / "calibration.json").read_text(encoding="utf-8"))
    q = cal["final_q_all_folds"]
    last_obs = D["times"][-1]
    # extend the grid 72 h past the last reading and add forecast weather for those hours
    D["times"] = pd.date_range(D["times"][0], last_obs + pd.Timedelta(hours=73), freq="h")
    fw = future_weather(
        D["cities"], (last_obs - timedelta(days=2)).date(), (last_obs + timedelta(days=4)).date()
    )
    fw = fw[fw.ts_utc > D["weather"].ts_utc.max()]
    D["weather"] = pd.concat([D["weather"], fw], ignore_index=True)
    g = base_grid(D)
    ratios = station_ratios(D["good"])
    cs = city_series(D["good"], D["n_st"], ratios)
    g.y = F.to_grid(cs, "pm25", D["cities"].id, D["times"])
    g.n_st = np.nan_to_num(F.to_grid(cs, "n_stations", D["cities"].id, D["times"]))
    of = F.origin_features(g.y)
    n_obs = int(D["times"].get_loc(last_obs)) + 1
    share = (~np.isnan(g.y[:, :n_obs])).mean(axis=0)
    now = int(np.nonzero(share >= 0.8)[0].max())
    med = np.nanmedian(g.y[:, : now + 1], axis=1).astype(np.float32)
    tr = F.make_rows(g, of, np.arange(0, now, TRAIN_STEP), F.HORIZONS, med)
    tr = tr[tr.target_idx <= now]
    if len(tr) > MAX_TRAIN:
        tr = tr.sample(MAX_TRAIN, random_state=1)
    cols = F.feature_columns()
    log(f"final model: {len(tr):,} training rows; now = {D['times'][now]} UTC")
    hz = list(range(1, 73))
    models = {}
    for name, alpha in (("p50", 0.5), ("p10", 0.1), ("p90", 0.9)):
        path = OUT / f"model_{name}.txt"
        if path.exists() and not retrain:
            models[name] = lgb.Booster(model_file=str(path))
            continue
        ds = lgb.Dataset(tr[cols], tr["target"], categorical_feature=["city"])
        models[name] = lgb.train({**PARAMS, "objective": "quantile", "alpha": alpha}, ds, ROUNDS)
        OUT.mkdir(parents=True, exist_ok=True)
        models[name].save_model(str(path))
    # origin = now for cities with complete inputs; otherwise their latest complete hour within
    # FALLBACK_H hours (forecast then ends at origin + 72 h, up to FALLBACK_H h short of now + 72)
    parts, done = [], np.zeros(g.shape[0], bool)
    for k in range(FALLBACK_H + 1):
        rows = F.make_rows(g, of, np.array([now - k]), hz, med, need_target=False)
        rows = rows[~done[rows.city] & (rows.target_idx > now)]
        done[rows.city.unique()] = True
        parts.append(rows)
    te = pd.concat(parts, ignore_index=True)
    for name, m in models.items():
        te[name] = (te["pm_now"] + m.predict(te[cols])).clip(lower=0)
    qh = te["horizon"].map(lambda h: next(q[b] for b, (lo, hi) in BUCKETS.items() if lo <= h <= hi))
    te["p10"] = (np.minimum(te.p10, te.p50) - qh).clip(lower=0)
    te["p90"] = np.maximum(te.p90, te.p50) + qh
    te["city_id"] = D["cities"].id.to_numpy()[te.city]
    te["ts_utc"] = D["times"][te.target_idx]
    te["origin_utc"] = D["times"][te.origin]
    fc = te[["city_id", "ts_utc", "origin_utc", "horizon", "p50", "p10", "p90"]]
    fc.to_parquet(OUT / "forecast.parquet", index=False)
    # the grid used (observed city series + weather), for the export
    obs = cs[cs.ts_utc <= D["times"][now]]
    obs.to_parquet(OUT / "observed_city.parquet", index=False)
    D["weather"].to_parquet(OUT / "weather.parquet", index=False)
    meta = {
        "now_utc": str(D["times"][now]),
        "last_obs_utc": str(last_obs),
        "cities_forecast": int(fc.city_id.nunique()),
        "cities_ready": int(len(D["cities"])),
        "train_rows": int(len(tr)),
        "conformal_q": q,
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    log(f"forecast for {meta['cities_forecast']} of {meta['cities_ready']} cities")
    return meta
