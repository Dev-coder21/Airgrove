"""Build the API payloads; `python tasks.py export` writes them as static JSON for GitHub Pages.

Files under frontend/public/data/ (same content as the API):
  cities.json            /api/cities
  series/<id>.json       /api/series?city=<id>        past 168 h + next 72 h
  map.json               /api/map (all hours; /api/map?ts= returns one hour)
  fires.json             /api/fires (the series window; /api/fires?from=&to= filters it)
  model/report.json      /api/model/report            backtest + calibration
  bundle.json            everything the site needs in one file (what the frontend loads)
Missing values are null. Times are UTC ISO strings; the site shows them in IST.
"""

from __future__ import annotations

import json
import math
import shutil

import duckdb
import numpy as np
import pandas as pd

from .aqi import category
from .clean import DB, city_series, station_ratios
from .ingest.openaq import ROOT

FC = ROOT / "data" / "forecast"
OUT = ROOT / "frontend" / "public" / "data"
PAST = 168
AHEAD = 72
COMPASS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"]
PB_HR = {"lon_max": 77.5, "lat_min": 29.0}  # Punjab & Haryana crop-fire box (within 70-85E, 24-33N)
LIMIT = 60


def _r(x, nd=1):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else round(float(x), nd)


def compass(deg: float) -> str | None:
    return None if deg is None or math.isnan(deg) else COMPASS[int(((deg % 360) + 22.5) // 45) % 8]


def _iso(ts: pd.Timestamp) -> str:
    return ts.tz_convert("UTC").strftime("%Y-%m-%dT%H:%M:%SZ")


def build() -> dict:
    meta = json.loads((FC / "meta.json").read_text(encoding="utf-8"))
    now = pd.Timestamp(meta["now_utc"])
    times = pd.date_range(
        now - pd.Timedelta(hours=PAST - 1), now + pd.Timedelta(hours=AHEAD), freq="h"
    )
    con = duckdb.connect(str(DB), read_only=True)
    con.execute("SET TimeZone='UTC'")
    cities = con.execute(
        "SELECT id, name, state, lat, lon, stations, forecast_ready FROM cities"
    ).df()
    good = con.execute("SELECT city_id, sensor_id, ts_utc, value FROM pm25_station WHERE ok").df()
    n_st = (
        con.execute("SELECT city_id, count(*) n FROM stations GROUP BY 1")
        .df()
        .set_index("city_id")["n"]
    )
    w_db = con.execute("SELECT * FROM weather WHERE ts_utc >= ?", [times[0].to_pydatetime()]).df()
    fires = con.execute(
        "SELECT ts_utc, lat, lon, frp, source FROM fires WHERE ts_utc >= ? AND ts_utc < ?",
        [times[0].to_pydatetime(), (now + pd.Timedelta(hours=1)).to_pydatetime()],
    ).df()
    con.close()
    obs = city_series(good, n_st, station_ratios(good))
    obs = obs[(obs.ts_utc >= times[0]) & (obs.ts_utc <= now)]
    fc = pd.read_parquet(FC / "forecast.parquet")
    w_fc = pd.read_parquet(FC / "weather.parquet")
    weather = pd.concat([w_db, w_fc[w_fc.ts_utc > w_db.ts_utc.max()]], ignore_index=True)
    weather = weather.drop_duplicates(["city_id", "ts_utc"]).set_index(["city_id", "ts_utc"])

    # keep cities that have at least one reading in the window
    have = set(obs.city_id)
    cities = cities[cities.id.isin(have)].copy()
    has_fc = set(fc.city_id)
    cities["forecast_ready"] = cities.forecast_ready & cities.id.isin(has_fc)
    # Delhi first (default city), then by number of stations
    cities["_o"] = (cities.id != "delhi").astype(int)
    cities = cities.sort_values(["_o", "stations", "name"], ascending=[True, False, True]).drop(
        columns="_o"
    )

    city_list = [
        {
            "id": c.id,
            "name": c.name,
            "state": c.state,
            "lat": round(c.lat, 4),
            "lon": round(c.lon, 4),
            "stations": int(c.stations),
            "forecast_ready": bool(c.forecast_ready),
        }
        for c in cities.itertuples()
    ]

    series = {}
    ob = obs.set_index(["city_id", "ts_utc"])["pm25"]
    fcx = fc.set_index(["city_id", "ts_utc"])
    for c in cities.itertuples():
        rows = []
        for t in times:
            o = ob.get((c.id, t), np.nan)
            f = fcx.loc[(c.id, t)] if (c.id, t) in fcx.index else None
            try:
                w = weather.loc[(c.id, t)]
            except KeyError:
                w = None
            rows.append(
                {
                    "ts": _iso(t),
                    "observed": _r(o),
                    "forecast": _r(f["p50"])
                    if f is not None
                    else (_r(o) if t == now and c.forecast_ready else None),
                    "p10": _r(f["p10"]) if f is not None else None,
                    "p90": _r(f["p90"]) if f is not None else None,
                    "wind_kmh": _r(w["wind_speed_10m"]) if w is not None else None,
                    "wind_dir": compass(w["wind_direction_10m"]) if w is not None else None,
                    "rh": _r(w["relative_humidity_2m"], 0) if w is not None else None,
                    "mixing_height_m": _r(w["boundary_layer_height"], -1)
                    if w is not None
                    else None,
                }
            )
        series[c.id] = {"city": c.id, "now": _iso(now), "rows": rows}

    # map: every city's PM2.5 at every hour (observed up to now, forecast after; observed-only
    # cities have values only up to now)
    map_cities = {}
    for c in cities.itertuples():
        vals = [
            r["observed"] if i < PAST else r["forecast"] for i, r in enumerate(series[c.id]["rows"])
        ]
        map_cities[c.id] = vals
    map_payload = {
        "now": _iso(now),
        "times": [_iso(t) for t in times],
        "limit_24h": LIMIT,
        "pm25": map_cities,
    }

    fires["pbhr"] = (fires.lon <= PB_HR["lon_max"]) & (fires.lat >= PB_HR["lat_min"])
    fire_rows = [
        {
            "lat": round(f.lat, 3),
            "lon": round(f.lon, 3),
            "ts": _iso(f.ts_utc),
            "frp": round(f.frp, 1),
            "source": f.source,
            "pbhr": bool(f.pbhr),
        }
        for f in fires.itertuples()
    ]
    fires_payload = {
        "from": _iso(times[0]),
        "to": _iso(now),
        "area": "70-85E, 24-33N",
        "pbhr_box": PB_HR,
        "fires": fire_rows,
    }

    report = json.loads((ROOT / "reports" / "backtest.json").read_text(encoding="utf-8"))
    report["calibration"] = json.loads(
        (ROOT / "reports" / "calibration.json").read_text(encoding="utf-8")
    )
    report["calibration"].pop("per_fold", None)
    report.pop("by_city_all", None)
    report["forecast"] = meta
    return {
        "cities": city_list,
        "series": series,
        "map": map_payload,
        "fires": fires_payload,
        "report": report,
        "now": now,
        "times": times,
    }


def site_model(report: dict) -> dict:
    """What the model section and card back show, all from the backtest."""
    bh = report["by_horizon"]
    names = [
        ("airgrove", "Airgrove model", "#eef0e4", True),
        ("persistence", "Persistence (last value)", "#a9c29a", False),
        ("same_hour_yesterday", "Same hour yesterday", "#6f8f66", False),
        ("cams_raw", "CAMS, raw", "#8a7f6a", False),
        ("cams_bias_corrected", "CAMS, bias-corrected", "#b5a98c", False),
    ]
    rows = [
        {
            "name": n,
            "mae": [bh[b][k]["mae"] for b in ("1-6 h", "7-24 h", "25-72 h")],
            "color": col,
            "ours": o,
        }
        for k, n, col, o in names
    ]
    cov = report["calibration"]["coverage_after"]["overall"]
    h1 = report["by_horizon_hour"]["1"]
    pm = report["by_season"]["post-monsoon (Oct-Nov)"]["7-24 h"]
    n_cities = report["setup"]["cities"]
    loses = (
        f"One hour ahead, the last reading is still better ({h1['persistence']['mae']:.1f} vs "
        f'{h1["airgrove"]["mae"]:.1f}). In October and November, "same hour yesterday" matches it '
        f"7-24 h ahead ({pm['same_hour_yesterday']['mae']:.1f} vs {pm['airgrove']['mae']:.1f}). "
        f"It also tends to read a little low (bias {report['overall']['airgrove']['bias']:+.1f})."
    )
    honest = (
        f"After calibration, the 80% range held the real value {round(100 * cov)}% of the time "
        f"(before: {round(100 * report['calibration']['coverage_before']['overall'])}%)."
    )
    cams = (
        "CAMS is the official global forecast. Its archive keeps the latest run for each hour, not "
        "true 1-3 day forecasts, so both CAMS rows are flattering at long range. Bias-corrected = a "
        "per-city linear fit on training data only."
    )
    return {
        "rows": rows,
        "coverage": cov,
        "scope": f"{n_cities} cities",
        "notes": [loses, honest, cams],
        "eyebrow": f"All {n_cities} forecast-ready cities · backtest, last 12 months, re-trained monthly",
    }


def _col(rows: list[dict], k: str) -> list:
    return [r[k] for r in rows]


def _dump(path, obj) -> None:
    path.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")


def bundle(p: dict) -> dict:
    """One file with everything the frontend needs (arrays aligned on the 240-hour axis)."""
    times = p["times"]
    t0 = times[0]
    out_c = []
    for c in p["cities"]:
        rows = p["series"][c["id"]]["rows"]
        out_c.append(
            {
                **c,
                "observed": _col(rows, "observed"),
                "forecast": _col(rows, "forecast"),
                "p10": _col(rows, "p10"),
                "p90": _col(rows, "p90"),
                "wind_kmh": _col(rows, "wind_kmh"),
                "wind_dir": _col(rows, "wind_dir"),
                "rh": _col(rows, "rh"),
                "mixing_height_m": _col(rows, "mixing_height_m"),
            }
        )
    fires = [
        {
            "lat": f["lat"],
            "lon": f["lon"],
            "frp": f["frp"],
            "pbhr": f["pbhr"],
            "i": int((pd.Timestamp(f["ts"]) - t0) / pd.Timedelta(hours=1)),
        }
        for f in p["fires"]["fires"]
    ]
    # smoke index for the globe's smoke drift and captions: Punjab/Haryana fire count in the
    # 12-60 h before each hour, scaled to 0..1 (display heuristic, not a model input)
    cnt = np.zeros(len(times))
    for f in fires:
        if f["pbhr"] and 0 <= f["i"] < len(times):
            cnt[f["i"]] += 1
    cs = np.concatenate([[0], np.cumsum(cnt)])
    idx = np.arange(len(times))
    win = cs[np.clip(idx - 11, 0, None)] - cs[np.clip(idx - 59, 0, None)]
    smoke = np.clip(win / 400.0, 0, 1)
    m = site_model(p["report"])
    return {
        "now": _iso(p["now"]),
        "now_index": PAST - 1,
        "hours": len(times),
        "start": _iso(t0),
        "cities": out_c,
        "fires": fires,
        "smoke": [round(float(s), 3) for s in smoke],
        "model": m,
        "source_note": "CPCB stations via OpenAQ · forecast by Airgrove",
    }


def write(log=print) -> None:
    p = build()
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "series").mkdir(parents=True)
    (OUT / "model").mkdir(parents=True)
    _dump(OUT / "cities.json", p["cities"])
    for cid, s in p["series"].items():
        _dump(OUT / "series" / f"{cid}.json", s)
    _dump(OUT / "map.json", p["map"])
    _dump(OUT / "fires.json", p["fires"])
    _dump(OUT / "model" / "report.json", p["report"])
    _dump(OUT / "bundle.json", bundle(p))
    size = sum(f.stat().st_size for f in OUT.rglob("*.json")) / 1e6
    log(f"wrote {OUT.relative_to(ROOT)}: {len(p['cities'])} cities, now {p['now']}, {size:.1f} MB")


def map_at(p: dict, ts: str | None) -> dict:
    m = p["map"]
    i = m["times"].index(ts) if ts in m["times"] else m["times"].index(m["now"])
    kind = "observed" if i <= m["times"].index(m["now"]) else "forecast"
    out = []
    for cid, vals in m["pm25"].items():
        v = vals[i]
        out.append(
            {
                "id": cid,
                "pm25": v,
                "category": category(v)["name"] if v is not None else None,
                "kind": kind,
            }
        )
    return {"ts": m["times"][i], "cities": out}
