"""Model features on a dense city x hour grid.

Every series is an array [city, hour] on OpenAQ's hourly periods (UTC :30 = IST clock hours).
A training/test row is (city c, origin hour i, horizon h). Origin-side features use only
information up to the end of period i (the latest reading); target-side features describe the
hour i+h and come from forecasts (weather) or the calendar.

Origin side: latest PM2.5 y[i], lags 1/2/3/6/12/24/48/168 h, rolling mean/std over 6/24/72 h,
stations reporting, upwind fires (count and summed FRP in the last 24/48/72 h within 600 km and
+-45 deg of the wind direction at the origin).
Target side: horizon, IST hour, weekday, festival flags, weather at the target hour (wind u/v,
temperature, RH, rain, boundary-layer height).
City: id (categorical), lat, lon, median PM2.5 in the training period.
No month or day-of-year features (they only identify the year with < 2 years of data).

Rows are skipped, never filled, when y[i], any lag or any rolling window lacks data.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

LAGS = [1, 2, 3, 6, 12, 24, 48, 168]
ROLL = [6, 24, 72]
ROLL_MIN_SHARE = 0.75
HORIZONS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 18, 21, 24, 30, 36, 42, 48, 54, 60, 66, 72]
FIRE_WINDOWS = [24, 48, 72]
FIRE_RADIUS_KM = 600
FIRE_HALF_ANGLE = 45
SECTOR_DEG = 5
WEATHER = [
    "wind_u",
    "wind_v",
    "temperature_2m",
    "relative_humidity_2m",
    "precipitation",
    "boundary_layer_height",
]
# festival dates (IST); flags apply to the target hour
DIWALI = ["2025-10-20", "2025-10-21"]
HOLI = ["2025-03-14", "2026-03-04"]
NEW_YEAR = [("2025-12-31 18:00", "2026-01-01 12:00")]
FIRE_COLS = [f"fire_{k}_{w}h" for w in FIRE_WINDOWS for k in ("n", "frp")]


@dataclass
class Grid:
    """Dense arrays on [city, hour]."""

    cities: pd.DataFrame  # id, lat, lon in row order
    times: pd.DatetimeIndex  # period starts, UTC
    y: np.ndarray  # city PM2.5 (unfilled; NaN = missing)
    n_st: np.ndarray
    weather: dict[str, np.ndarray]
    wind_dir: np.ndarray
    cams: np.ndarray
    fires: dict[str, np.ndarray] = field(default_factory=dict)

    @property
    def shape(self) -> tuple[int, int]:
        return self.y.shape


def to_grid(df: pd.DataFrame, value: str, cities: pd.Series, times: pd.DatetimeIndex) -> np.ndarray:
    """Long (city_id, ts_utc, value) -> [city, hour] float32 array (NaN where absent)."""
    ci = pd.Index(cities).get_indexer(df["city_id"])
    ti = times.get_indexer(df["ts_utc"])
    ok = (ci >= 0) & (ti >= 0)
    out = np.full((len(cities), len(times)), np.nan, dtype=np.float32)
    out[ci[ok], ti[ok]] = df[value].to_numpy(dtype=np.float32)[ok]
    return out


def shift(a: np.ndarray, k: int) -> np.ndarray:
    """a[:, i - k] at position i (NaN where i - k < 0)."""
    out = np.full_like(a, np.nan)
    if k < a.shape[1]:
        out[:, k:] = a[:, : a.shape[1] - k]
    return out


def rolling(y: np.ndarray, w: int) -> tuple[np.ndarray, np.ndarray]:
    """Mean and std of y over (i - w, i], requiring >= 75% of the window present."""
    v = np.nan_to_num(y)
    m = (~np.isnan(y)).astype(np.float64)
    pad = lambda a: np.concatenate([np.zeros((a.shape[0], 1)), np.cumsum(a, axis=1)], axis=1)  # noqa: E731
    cs, cs2, cn = pad(v.astype(np.float64)), pad(v.astype(np.float64) ** 2), pad(m)
    n_h = y.shape[1]
    lo = np.clip(np.arange(1, n_h + 1) - w, 0, None)
    hi = np.arange(1, n_h + 1)
    n = cn[:, hi] - cn[:, lo]
    s = cs[:, hi] - cs[:, lo]
    s2 = cs2[:, hi] - cs2[:, lo]
    with np.errstate(invalid="ignore", divide="ignore"):
        mean = s / n
        std = np.sqrt(np.maximum(s2 / n - mean**2, 0))
    bad = n < np.ceil(ROLL_MIN_SHARE * w)
    mean[bad] = np.nan
    std[bad] = np.nan
    return mean.astype(np.float32), std.astype(np.float32)


def _haversine_bearing(lat0, lon0, lat, lon):
    p0, p1 = np.radians(lat0), np.radians(lat)
    dl = np.radians(lon - lon0)
    a = np.sin((p1 - p0) / 2) ** 2 + np.cos(p0) * np.cos(p1) * np.sin(dl / 2) ** 2
    dist = 2 * 6371 * np.arcsin(np.sqrt(a))
    brg = np.degrees(
        np.arctan2(
            np.sin(dl) * np.cos(p1), np.cos(p0) * np.sin(p1) - np.sin(p0) * np.cos(p1) * np.cos(dl)
        )
    )
    return dist, (brg + 360) % 360


def fire_features(
    fires: pd.DataFrame, cities: pd.DataFrame, times: pd.DatetimeIndex, wind_dir: np.ndarray
) -> dict[str, np.ndarray]:
    """Upwind fire count / FRP sums ending at each origin hour i (fires detected up to the end
    of period i). Upwind = bearing city->fire within +-45 deg of the wind's 'from' direction."""
    n_c, n_h = len(cities), len(times)
    nb = 360 // SECTOR_DEG
    half = FIRE_HALF_ANGLE // SECTOR_DEG
    out = {c: np.zeros((n_c, n_h), dtype=np.float32) for c in FIRE_COLS}
    t0 = times[0]
    hour_idx = np.floor((fires["ts_utc"] - t0).dt.total_seconds().to_numpy() / 3600).astype(
        np.int64
    )
    keep = (hour_idx >= 0) & (hour_idx < n_h)
    f_lat, f_lon = fires["lat"].to_numpy()[keep], fires["lon"].to_numpy()[keep]
    f_frp, f_h = fires["frp"].to_numpy()[keep], hour_idx[keep]
    for ci, c in enumerate(cities.itertuples()):
        dist, brg = _haversine_bearing(c.lat, c.lon, f_lat, f_lon)
        near = dist <= FIRE_RADIUS_KM
        if not near.any():
            continue
        b = (brg[near] // SECTOR_DEG).astype(int)
        cnt = np.zeros((n_h + 1, nb))
        frp = np.zeros((n_h + 1, nb))
        np.add.at(cnt, (f_h[near] + 1, b), 1)
        np.add.at(frp, (f_h[near] + 1, b), f_frp[near])
        ccnt, cfrp = np.cumsum(cnt, axis=0), np.cumsum(frp, axis=0)
        d = wind_dir[ci]
        valid = ~np.isnan(d)
        centre = np.where(valid, (np.nan_to_num(d) // SECTOR_DEG).astype(int), 0)
        bins = (centre[:, None] + np.arange(-half, half)[None, :]) % nb  # [n_h, 2*half]
        rows = np.arange(n_h)
        for w in FIRE_WINDOWS:
            lo = np.clip(rows + 1 - w, 0, None)
            for name, cum in (("n", ccnt), ("frp", cfrp)):
                win = cum[rows + 1][:, :] - cum[lo][:, :]  # [n_h, nb] fires in (i-w, i]
                v = np.take_along_axis(win, bins, axis=1).sum(axis=1)
                v[~valid] = np.nan
                out[f"fire_{name}_{w}h"][ci] = v
    return out


def festival_flags(times: pd.DatetimeIndex) -> dict[str, np.ndarray]:
    ist = times.tz_convert("Asia/Kolkata")
    d = ist.strftime("%Y-%m-%d")
    ny = np.zeros(len(times), dtype=bool)
    for a, b in NEW_YEAR:
        a_ts = pd.Timestamp(a, tz="Asia/Kolkata")
        b_ts = pd.Timestamp(b, tz="Asia/Kolkata")
        ny |= (ist >= a_ts) & (ist < b_ts)
    return {"diwali": np.isin(d, DIWALI), "holi": np.isin(d, HOLI), "new_year": ny}


@dataclass
class OriginFeatures:
    lags: dict[str, np.ndarray]
    valid: np.ndarray  # [city, hour] all PM inputs present


def origin_features(y: np.ndarray) -> OriginFeatures:
    f: dict[str, np.ndarray] = {"pm_now": y}
    for k in LAGS:
        f[f"pm_lag{k}"] = shift(y, k)
    for w in ROLL:
        f[f"pm_mean{w}"], f[f"pm_std{w}"] = rolling(y, w)
    valid = np.ones_like(y, dtype=bool)
    for a in f.values():
        valid &= ~np.isnan(a)
    return OriginFeatures(f, valid)


def make_rows(
    g: Grid,
    of: OriginFeatures,
    origins: np.ndarray,
    horizons: list[int],
    city_median: np.ndarray,
    need_target: bool = True,
) -> pd.DataFrame:
    """Rows for all (city, origin index in `origins`, horizon). Skips rows whose PM inputs are
    incomplete or (if need_target) whose target is missing or beyond the grid."""
    n_c, n_h = g.shape
    hour_ist = (g.times.tz_convert("Asia/Kolkata").hour).to_numpy()
    weekday = g.times.tz_convert("Asia/Kolkata").weekday.to_numpy()
    fest = festival_flags(g.times)
    parts = []
    for h in horizons:
        ci, ti = np.meshgrid(np.arange(n_c), origins, indexing="ij")
        ci, ti = ci.ravel(), ti.ravel()
        tt = ti + h
        ok = tt < n_h
        ci, ti, tt = ci[ok], ti[ok], tt[ok]
        ok = of.valid[ci, ti]
        if need_target:
            ok &= ~np.isnan(g.y[ci, tt])
        ci, ti, tt = ci[ok], ti[ok], tt[ok]
        d = {
            "city": ci.astype(np.int16),
            "origin": ti.astype(np.int32),
            "target_idx": tt.astype(np.int32),
            "horizon": np.full(len(ci), h, dtype=np.int16),
        }
        for k, a in of.lags.items():
            d[k] = a[ci, ti]
        d["n_stations"] = g.n_st[ci, ti]
        for k, a in g.fires.items():
            d[k] = a[ci, ti]
        d["hour"] = hour_ist[tt].astype(np.int8)
        d["weekday"] = weekday[tt].astype(np.int8)
        for k, a in fest.items():
            d[k] = a[tt].astype(np.int8)
        for k in WEATHER:
            d[f"w_{k}"] = g.weather[k][ci, tt]
        d["lat"] = g.cities["lat"].to_numpy(np.float32)[ci]
        d["lon"] = g.cities["lon"].to_numpy(np.float32)[ci]
        d["city_median"] = city_median[ci]
        d["y_target"] = g.y[ci, tt]
        d["cams_target"] = g.cams[ci, tt]
        parts.append(pd.DataFrame(d))
    df = pd.concat(parts, ignore_index=True)
    df["target"] = df["y_target"] - df["pm_now"]
    return df


def feature_columns(fire: bool = True, city_id: bool = True) -> list[str]:
    cols = (
        ["horizon", "pm_now"]
        + [f"pm_lag{k}" for k in LAGS]
        + [f"pm_{s}{w}" for w in ROLL for s in ("mean", "std")]
        + ["n_stations", "hour", "weekday", "diwali", "holi", "new_year"]
        + [f"w_{k}" for k in WEATHER]
        + ["lat", "lon", "city_median"]
    )
    if fire:
        cols += FIRE_COLS
    if city_id:
        cols += ["city"]
    return cols
