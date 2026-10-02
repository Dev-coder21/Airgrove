"""Rolling-origin backtest: monthly re-training over the last 12 months.

For each test month M (IST calendar month):
- everything learned from data (station ratios, city medians, CAMS bias correction, models) uses
  only hours before the start of M; training rows need their *target* hour before M;
- test rows are origins inside M (every 3 h), horizons 1-72 h.
Methods: Airgrove (national LightGBM, p10/p50/p90 on the change from the latest reading),
persistence, same hour yesterday, raw CAMS, bias-corrected CAMS (per-city linear fit, training
hours only). Ablation: no fire features. Per-city models for the 5 biggest cities.
All methods are scored on the same rows (where every baseline exists).
"""

from __future__ import annotations

import json
import time
from datetime import UTC, datetime

import duckdb
import lightgbm as lgb
import numpy as np
import pandas as pd

from . import features as F
from .aqi import load as load_aqi
from .clean import DB, city_series, station_ratios
from .ingest.openaq import ROOT

REPORT = ROOT / "reports" / "backtest.json"
PRED = ROOT / "data" / "backtest_predictions.parquet"
FOLDS = ROOT / "data" / "backtest_folds"  # one parquet + json per finished fold (resumable)
TEST_MONTHS = pd.period_range("2025-10", "2026-09", freq="M")
ORIGIN_STEP_TEST = 3
ORIGIN_STEP_TRAIN = 6
MAX_TRAIN_ROWS = 3_000_000
BIG5 = ["delhi", "mumbai", "hyderabad", "ahmedabad", "chennai"]
PARAMS = dict(
    learning_rate=0.05,
    num_leaves=63,
    min_data_in_leaf=200,
    feature_fraction=0.8,
    bagging_fraction=0.8,
    bagging_freq=1,
    lambda_l2=1.0,
    max_bin=255,
    verbose=-1,
    num_threads=0,
    seed=7,
)
ROUNDS = 400
ROUNDS_OVERRIDE = 0  # set > 0 for quick smoke runs
BUCKETS = {"1-6 h": (1, 6), "7-24 h": (7, 24), "25-72 h": (25, 72)}


def season(ts: pd.Series) -> pd.Series:
    m = ts.dt.tz_convert("Asia/Kolkata").dt.month
    return pd.Series(
        np.select(
            [m.isin([12, 1, 2]), m.isin([3, 4, 5]), m.isin([6, 7, 8, 9])],
            ["winter (Dec-Feb)", "pre-monsoon (Mar-May)", "monsoon (Jun-Sep)"],
            "post-monsoon (Oct-Nov)",
        ),
        index=ts.index,
    )


def load() -> dict:
    con = duckdb.connect(str(DB), read_only=True)
    con.execute("SET TimeZone='UTC'")  # timestamps come back in the machine's zone otherwise
    cities = con.execute(
        "SELECT id, name, lat, lon, stations FROM cities WHERE forecast_ready ORDER BY id"
    ).df()
    good = con.execute("SELECT city_id, sensor_id, ts_utc, value FROM pm25_station WHERE ok").df()
    good = good[good.city_id.isin(cities.id)]
    weather = con.execute("SELECT * FROM weather").df()
    cams = con.execute("SELECT city_id, ts_utc, cams_pm25 FROM cams").df()
    fires = con.execute("SELECT ts_utc, lat, lon, frp FROM fires").df()
    n_st = (
        con.execute("SELECT city_id, count(*) n FROM stations GROUP BY 1")
        .df()
        .set_index("city_id")["n"]
    )
    con.close()
    times = pd.date_range(pd.Timestamp("2025-01-31T18:30Z"), good.ts_utc.max(), freq="h")
    return {
        "cities": cities,
        "good": good,
        "weather": weather,
        "cams": cams,
        "fires": fires,
        "n_st": n_st,
        "times": times,
    }


def base_grid(D: dict) -> F.Grid:
    """Everything except the city PM2.5 series (which depends on the fold's station ratios)."""
    c, t = D["cities"].id, D["times"]
    w = {k: F.to_grid(D["weather"], k, c, t) for k in F.WEATHER}
    wd = F.to_grid(D["weather"], "wind_direction_10m", c, t)
    g = F.Grid(
        D["cities"],
        t,
        np.full((len(c), len(t)), np.nan, np.float32),
        np.zeros((len(c), len(t)), np.float32),
        w,
        wd,
        F.to_grid(D["cams"], "cams_pm25", c, t),
    )
    g.fires = F.fire_features(D["fires"], D["cities"], t, wd)
    return g


def fold_series(D: dict, g: F.Grid, cutoff: pd.Timestamp) -> F.Grid:
    ratios = station_ratios(D["good"], before=cutoff)
    cs = city_series(D["good"], D["n_st"], ratios)
    g.y = F.to_grid(cs, "pm25", D["cities"].id, D["times"])
    g.n_st = np.nan_to_num(F.to_grid(cs, "n_stations", D["cities"].id, D["times"]))
    return g


def fit(df: pd.DataFrame, cols: list[str], alpha: float) -> lgb.Booster:
    rounds = ROUNDS_OVERRIDE or ROUNDS
    ds = lgb.Dataset(
        df[cols],
        df["target"],
        categorical_feature=["city"] if "city" in cols else [],
        free_raw_data=True,
    )
    return lgb.train({**PARAMS, "objective": "quantile", "alpha": alpha}, ds, rounds)


def leakage_checks(D: dict, g: F.Grid) -> dict:
    """Features at origin i must not change when anything after i changes."""
    rng = np.random.default_rng(0)
    i0 = len(D["times"]) // 2
    y2 = g.y.copy()
    y2[:, i0 + 1 :] = rng.uniform(0, 500, size=y2[:, i0 + 1 :].shape)
    a, b = F.origin_features(g.y), F.origin_features(y2)
    pm_ok = all(
        np.array_equal(a.lags[k][:, : i0 + 1], b.lags[k][:, : i0 + 1], equal_nan=True)
        for k in a.lags
    )
    fires2 = D["fires"].copy()
    late = fires2.ts_utc >= D["times"][i0] + pd.Timedelta(hours=1)
    fires2.loc[late, "frp"] *= 50
    extra = fires2[late].sample(min(5000, int(late.sum())), random_state=0)
    ff = F.fire_features(pd.concat([fires2, extra]), D["cities"], D["times"], g.wind_dir)
    fire_ok = all(
        np.array_equal(ff[k][:, : i0 + 1], g.fires[k][:, : i0 + 1], equal_nan=True) for k in ff
    )
    return {
        "pm_features_ignore_future": bool(pm_ok),
        "fire_features_ignore_future": bool(fire_ok),
        "perturbed_after": str(D["times"][i0]),
    }


def run(log=print, months: list[str] | None = None) -> dict:
    t_start = time.time()
    D = load()
    g = base_grid(D)
    log(f"grid: {g.shape[0]} cities x {g.shape[1]} hours; fires/weather/CAMS loaded")
    city_idx = {cid: k for k, cid in enumerate(D["cities"].id)}
    preds, fold_info = [], []
    leak = None
    for M in [m for m in TEST_MONTHS if not months or str(m) in months]:
        t0 = time.time()
        start = pd.Timestamp(M.start_time, tz="Asia/Kolkata").tz_convert("UTC") - pd.Timedelta(
            minutes=30
        )
        end = pd.Timestamp(M.end_time, tz="Asia/Kolkata").tz_convert("UTC")
        cut = D["times"].get_indexer([start], method="bfill")[0]
        stop = int(np.searchsorted(D["times"], end, side="right"))
        g = fold_series(D, g, start)
        if leak is None:
            leak = leakage_checks(D, g)
        done_p, done_j = FOLDS / f"{M}.parquet", FOLDS / f"{M}.json"
        if done_p.exists() and done_j.exists():
            preds.append(pd.read_parquet(done_p))
            fold_info.append(json.loads(done_j.read_text(encoding="utf-8")))
            log(f"  {M}: already done, loaded")
            continue
        of = F.origin_features(g.y)
        # training-period statistics
        med = np.nanmedian(np.where(np.arange(g.shape[1]) < cut, g.y, np.nan), axis=1).astype(
            np.float32
        )
        tr = F.make_rows(g, of, np.arange(0, cut, ORIGIN_STEP_TRAIN), F.HORIZONS, med)
        tr = tr[tr.target_idx < cut]
        assert (tr.target_idx < cut).all() and (tr.origin < cut).all()
        if len(tr) > MAX_TRAIN_ROWS:
            tr = tr.sample(MAX_TRAIN_ROWS, random_state=int(M.ordinal))
        te = F.make_rows(g, of, np.arange(cut, stop, ORIGIN_STEP_TEST), F.HORIZONS, med)
        # baselines
        same = te["target_idx"] - 24 * np.ceil(te["horizon"] / 24).astype(int)
        te["same_hour_yday"] = g.y[te["city"], same]
        te["persistence"] = te["pm_now"]
        te["cams_raw"] = te["cams_target"]
        # bias-corrected CAMS: per-city y = a + b*cams on training hours
        a_b = np.zeros((g.shape[0], 2), np.float32)
        for ci in range(g.shape[0]):
            yy, cc = g.y[ci, :cut], g.cams[ci, :cut]
            m = ~np.isnan(yy) & ~np.isnan(cc)
            if m.sum() > 500:
                b, a = np.polyfit(cc[m], yy[m], 1)
                a_b[ci] = (a, b)
            else:
                a_b[ci] = (np.nanmean(yy[m] - cc[m]) if m.any() else 0.0, 1.0)
        te["cams_bc"] = np.clip(
            a_b[te["city"], 0] + a_b[te["city"], 1] * te["cams_target"], 0, None
        )
        te = te.dropna(subset=["same_hour_yday", "cams_raw"])
        cols = F.feature_columns()
        for name, alpha in (("p50", 0.5), ("p10", 0.1), ("p90", 0.9)):
            te[name] = te["pm_now"] + fit(tr, cols, alpha).predict(te[cols])
        cols_nf = F.feature_columns(fire=False)
        te["nofire_p50"] = te["pm_now"] + fit(tr, cols_nf, 0.5).predict(te[cols_nf])
        te["percity_p50"] = np.nan
        cols_pc = F.feature_columns(city_id=False)
        for cid in BIG5:
            k = city_idx[cid]
            trc = tr[tr.city == k]
            if len(trc) > 1000:
                m = te.city == k
                te.loc[m, "percity_p50"] = te.loc[m, "pm_now"] + fit(trc, cols_pc, 0.5).predict(
                    te.loc[m, cols_pc]
                )
        for c in ("p50", "p10", "p90", "nofire_p50", "percity_p50"):
            te[c] = te[c].clip(lower=0)
        te["p10"], te["p90"] = np.minimum(te.p10, te.p50), np.maximum(te.p90, te.p50)
        te["month"] = str(M)
        keep = [
            "city",
            "origin",
            "target_idx",
            "horizon",
            "month",
            "y_target",
            "pm_now",
            "p50",
            "p10",
            "p90",
            "persistence",
            "same_hour_yday",
            "cams_raw",
            "cams_bc",
            "nofire_p50",
            "percity_p50",
            "n_stations",
        ]
        preds.append(te[keep])
        n_origin_possible = g.shape[0] * len(range(cut, stop, ORIGIN_STEP_TEST))
        fold_info.append(
            {
                "month": str(M),
                "train_rows": len(tr),
                "test_rows": len(te),
                "train_target_max": str(D["times"][int(tr.target_idx.max())]),
                "test_start": str(D["times"][cut]),
                "origins_with_complete_inputs_pct": round(
                    100 * of.valid[:, cut:stop:ORIGIN_STEP_TEST].sum() / max(n_origin_possible, 1),
                    1,
                ),
                "seconds": round(time.time() - t0),
            }
        )
        FOLDS.mkdir(parents=True, exist_ok=True)
        te[keep].to_parquet(FOLDS / f"{M}.parquet.tmp", index=False)
        (FOLDS / f"{M}.parquet.tmp").replace(done_p)
        done_j.write_text(json.dumps(fold_info[-1]), encoding="utf-8")
        log(f"  {M}: train {len(tr):,} rows, test {len(te):,} rows, {time.time() - t0:.0f}s")
    P = pd.concat(preds, ignore_index=True)
    P["city_id"] = D["cities"].id.to_numpy()[P.city]
    P["ts_target"] = D["times"][P.target_idx]
    P.to_parquet(PRED, index=False)
    report = summarise(P, D, fold_info, leak)
    report["runtime_minutes"] = round((time.time() - t_start) / 60, 1)
    REPORT.write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    return report


METHODS = {
    "airgrove": "p50",
    "persistence": "persistence",
    "same_hour_yesterday": "same_hour_yday",
    "cams_raw": "cams_raw",
    "cams_bias_corrected": "cams_bc",
}


def _cat(v: np.ndarray) -> np.ndarray:
    """CPCB category index of rounded values (same breakpoints as shared/aqi.json)."""
    return np.digitize(np.round(v), CAT_EDGES, right=True)


CAT_EDGES = [c["max"] for c in load_aqi()["categories"] if c["max"] is not None]


def metrics(df: pd.DataFrame, cols: dict[str, str]) -> dict:
    y = df["y_target"].to_numpy()
    cy = _cat(y)
    out = {}
    for name, c in cols.items():
        p = df[c].to_numpy()
        e = p - y
        out[name] = {
            "mae": round(float(np.mean(np.abs(e))), 2),
            "rmse": round(float(np.sqrt(np.mean(e**2))), 2),
            "bias": round(float(np.mean(e)), 2),
            "aqi_hit_rate": round(float(np.mean(_cat(p) == cy)), 3),
        }
    out["n"] = int(len(df))
    return out


def by_bucket(df: pd.DataFrame, cols: dict[str, str]) -> dict:
    return {b: metrics(df[df.horizon.between(lo, hi)], cols) for b, (lo, hi) in BUCKETS.items()}


def summarise(P: pd.DataFrame, D: dict, fold_info: list, leak: dict) -> dict:
    cities = D["cities"].set_index("id")
    P["season"] = season(P["ts_target"])
    top15 = cities.sort_values(["stations", "name"], ascending=[False, True]).index[:15]
    cov = (P.y_target >= P.p10) & (P.y_target <= P.p90)
    oct_dec = P.month.isin(["2025-10", "2025-11", "2025-12"])
    north = P.city_id.map(cities.lat) >= 24
    abl_cols = {"with_fires": "p50", "without_fires": "nofire_p50"}
    big5 = P[P.city_id.isin(BIG5)]
    return {
        "generated_utc": datetime.now(UTC).isoformat(timespec="seconds"),
        "setup": {
            "test_months": [str(m) for m in TEST_MONTHS],
            "retrain": "monthly, expanding window",
            "origins": f"every {ORIGIN_STEP_TEST} h in test, every {ORIGIN_STEP_TRAIN} h in training",
            "horizons": F.HORIZONS,
            "target": "PM2.5(t+h) - latest reading; p10/p50/p90 quantile LightGBM",
            "features": F.feature_columns(),
            "cities": int(len(cities)),
            "skipped_rows": "origins with any missing PM2.5 input (latest, lags 1-168 h, rolling 6/24/72 h at >= 75%) or missing target are skipped, not filled; rows also need same-hour-yesterday and CAMS so every method is scored on the same rows",
            "notes": [
                "CAMS (Open-Meteo archive) holds the latest run for each hour, i.e. a short-lead analysis-like series, not true 1-3 day lead forecasts. Both CAMS baselines are therefore optimistic at 25-72 h.",
                "Bias-corrected CAMS: per-city linear fit obs = a + b*CAMS on training hours only, refitted each month.",
                "Weather features at the target hour come from Open-Meteo's historical-forecast archive (stitched short-range forecasts). In live use the model will see 1-3 day forecasts, which are less accurate, so long-horizon skill here is somewhat optimistic for the model too.",
                "City value = mean of station values after dividing by each station's typical ratio to the city mean, estimated on training hours only (per fold).",
                "History starts Feb 2025: the test year contains one winter, and the first folds (Oct-Nov 2025) were trained without any winter data.",
            ],
        },
        "leakage_checks": {
            **leak,
            "train_targets_before_test_month": all(
                f["train_target_max"] < f["test_start"] for f in fold_info
            ),
            "statistics_from_training_only": [
                "station ratios",
                "city medians",
                "CAMS bias fit",
                "models",
            ],
        },
        "folds": fold_info,
        "overall": metrics(P, METHODS),
        "by_horizon": by_bucket(P, METHODS),
        "by_horizon_hour": {
            int(h): metrics(P[P.horizon == h], {"airgrove": "p50", "persistence": "persistence"})
            for h in F.HORIZONS
        },
        "by_season": {s: by_bucket(P[P.season == s], METHODS) for s in sorted(P.season.unique())},
        "by_city_top15": {
            cities.loc[c, "name"]: {
                "stations": int(cities.loc[c, "stations"]),
                **by_bucket(P[P.city_id == c], METHODS),
            }
            for c in top15
        },
        "by_city_all": {
            cities.loc[c, "name"]: metrics(g, METHODS) for c, g in P.groupby("city_id")
        },
        "band_coverage_80": {
            "overall": round(float(cov.mean()), 3),
            **{
                b: round(float(cov[P.horizon.between(lo, hi)].mean()), 3)
                for b, (lo, hi) in BUCKETS.items()
            },
            **{s: round(float(cov[P.season == s].mean()), 3) for s in sorted(P.season.unique())},
        },
        "fire_ablation": {
            "oct_dec_all_cities": by_bucket(P[oct_dec], abl_cols),
            "rest_of_year_all_cities": by_bucket(P[~oct_dec], abl_cols),
            "oct_dec_north_india": by_bucket(P[oct_dec & north], abl_cols),
            "rest_of_year_north_india": by_bucket(P[~oct_dec & north], abl_cols),
        },
        "national_vs_per_city": {
            cities.loc[c, "name"]: by_bucket(
                big5[big5.city_id == c].dropna(subset=["percity_p50"]),
                {"national": "p50", "per_city": "percity_p50", "persistence": "persistence"},
            )
            for c in BIG5
        },
    }
