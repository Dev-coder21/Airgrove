"""Clean station PM2.5 and build the city-hour series; load everything into DuckDB.

Rules (CLAUDE.md):
1. drop values < 0 or > 1,000 ug/m3;
2. stuck sensors: the same value for 6+ consecutive hours -> the whole run is flagged and dropped;
3. station-month QC: stations > 30% off the median of the city's other stations for 3+
   consecutive months are flagged; a flagged station's months that are > 30% off AND have a
   daily-mean correlation < 0.7 with that median are excluded (hourly r < 0.7 is normal in
   about half of all station-months, so it does not discriminate);
4. a city-hour exists if at least min(50% of the city's stations, 2) report (1-station cities:
   that station); `n_stations` (reporting) is kept as a model feature;
5. the stored city value is the plain station mean; `city_series()` rebuilds it with each
   station's typical ratio to the city mean removed (ratios estimated on training data per fold);
6. single-hour gaps are filled for display only (`filled` flag); the model skips them.
Hours are OpenAQ periods labelled by start in UTC (:30, = IST clock hours).
"""

from __future__ import annotations

import json
import math

import duckdb
import numpy as np
import pandas as pd

from .ingest.openaq import ROOT

DB = ROOT / "data" / "airgrove.duckdb"
INTERIM = ROOT / "data" / "interim"
STUCK_HOURS = 6
MIN_STATION_SHARE = 0.5
MIN_STATIONS_CAP = 2
QC_BIAS = 0.30
QC_CORR = 0.7
START = pd.Timestamp("2025-01-31T18:30Z")  # 2025-02-01 00:00 IST


def load_stations() -> tuple[pd.DataFrame, pd.DataFrame]:
    cov = json.loads((ROOT / "reports" / "coverage.json").read_text(encoding="utf-8"))
    st = pd.DataFrame(json.loads((ROOT / "data" / "stations.json").read_text(encoding="utf-8")))
    cities = pd.DataFrame(cov["cities"]).drop(columns=["station_ids"])
    st = st.merge(
        cities[["id", "name"]].rename(columns={"id": "city_id", "name": "city"}), on="city"
    )
    return st, cities


def flag_station(df: pd.DataFrame) -> pd.DataFrame:
    """df: one sensor, columns ts_utc, value. Adds flags; never drops rows (keeps an audit)."""
    df = df.sort_values("ts_utc").reset_index(drop=True)
    df["bad_range"] = (df["value"] < 0) | (df["value"] > 1000)
    # runs of identical values over consecutive hours
    consecutive = df["ts_utc"].diff().eq(pd.Timedelta(hours=1))
    same = df["value"].diff().eq(0) & consecutive
    run_id = (~same).cumsum()
    run_len = df.groupby(run_id)["value"].transform("size")
    df["stuck"] = (run_len >= STUCK_HOURS) & ~df["bad_range"]
    df["stuck_run"] = np.where(df["stuck"], run_id, -1)
    df["ok"] = ~(df["bad_range"] | df["stuck"]) & df["value"].notna()
    return df


def need_stations(n: int) -> int:
    """min(50% of the stations, 2), at least 1."""
    return max(1, min(math.ceil(MIN_STATION_SHARE * n), MIN_STATIONS_CAP))


def _daily_corr(h: pd.DataFrame) -> float:
    """Correlation of daily (IST) means of station vs others' median; NaN if < 10 days."""
    d = h.groupby(h.index.tz_convert("Asia/Kolkata").date)[["x", "m"]].mean()
    return float(d.x.corr(d.m)) if len(d) >= 10 else float("nan")


def station_month_qc(good: pd.DataFrame) -> pd.DataFrame:
    """Per station and IST month: median relative difference and correlation vs the median of the
    city's other stations. Needs >= 2 other stations; returns one row per station-month."""
    out = []
    for cid, g in good.groupby("city_id"):
        wide = g.pivot_table(index="ts_utc", columns="sensor_id", values="value")
        if wide.shape[1] < 3:
            continue
        month = wide.index.tz_convert("Asia/Kolkata").strftime("%Y-%m")
        for sid in wide.columns:
            others = wide.drop(columns=sid).median(axis=1)
            d = pd.DataFrame({"x": wide[sid], "m": others, "month": month}).dropna()
            d = d[d.m > 5]
            for mo, h in d.groupby("month"):
                if len(h) < 48:
                    continue
                out.append(
                    {
                        "city_id": cid,
                        "sensor_id": sid,
                        "month": mo,
                        "hours": len(h),
                        "rel_diff": float(((h.x - h.m) / h.m).median()),
                        "corr": float(h.x.corr(h.m)),
                        "daily_corr": _daily_corr(h),
                    }
                )
    qc = pd.DataFrame(out).sort_values(["sensor_id", "month"])
    off = qc.rel_diff.abs() > QC_BIAS
    # station flag = 3+ consecutive months > 30% off (the persistent-disagreement test)
    run = off.groupby([qc.sensor_id, (~off).cumsum()]).transform("sum").where(off, 0)
    flagged = run.groupby(qc.sensor_id).transform("max") >= PERSIST_MONTHS
    qc["station_flagged"] = flagged
    # exclude: flagged station, > 30% off that month, and daily-mean r < 0.7 that month
    qc["exclude"] = flagged & off & (qc["daily_corr"] < QC_CORR)
    return qc


def station_ratios(good: pd.DataFrame, before: pd.Timestamp | None = None) -> pd.Series:
    """Each station's typical ratio to its city's station mean (median over hours with >= 2
    stations), estimated only on hours before `before`. 1-station cities get 1.0."""
    g = good if before is None else good[good.ts_utc < before]
    m = g.groupby(["city_id", "ts_utc"])["value"].transform("mean")
    n = g.groupby(["city_id", "ts_utc"])["value"].transform("size")
    r = (g["value"] / m).where((n >= 2) & (m > 5))
    return r.groupby(g["sensor_id"]).median().fillna(1.0).clip(0.33, 3.0)


def city_series(
    good: pd.DataFrame, n_stations: pd.Series, ratios: pd.Series | None = None
) -> pd.DataFrame:
    """City-hour mean of (value / station ratio) where enough stations report. No gap filling."""
    g = good[["city_id", "sensor_id", "ts_utc", "value"]]
    if ratios is not None:
        g = g.assign(value=g["value"] / g["sensor_id"].map(ratios).fillna(1.0))
    agg = (
        g.groupby(["city_id", "ts_utc"])["value"].agg(pm25="mean", n_stations="size").reset_index()
    )
    need = agg["city_id"].map(n_stations).map(need_stations)
    return agg[agg["n_stations"] >= need].reset_index(drop=True)


def build(log=print) -> dict:
    st, cities = load_stations()
    files = sorted((INTERIM / "openaq").glob("*.parquet"))
    raw = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
    raw = raw.drop_duplicates(["sensor_id", "ts_utc"])  # belt and braces: one reading per hour
    raw = raw.merge(st[["sensor_id", "city_id"]], on="sensor_id")
    log(f"raw station-hours: {len(raw):,} from {raw.sensor_id.nunique()} sensors")

    flagged = pd.concat([flag_station(g) for _, g in raw.groupby("sensor_id")], ignore_index=True)
    qc = station_month_qc(flagged[flagged["ok"]])
    bad = qc.loc[qc.exclude, ["sensor_id", "month"]]
    flagged["month"] = flagged["ts_utc"].dt.tz_convert("Asia/Kolkata").dt.strftime("%Y-%m")
    flagged = flagged.merge(bad.assign(qc_excluded=True), on=["sensor_id", "month"], how="left")
    flagged["qc_excluded"] = flagged["qc_excluded"].fillna(False).astype(bool)
    flagged["ok"] = flagged["ok"] & ~flagged["qc_excluded"]
    log(
        f"station-month QC: {int(qc.exclude.sum())} station-months excluded "
        f"({int(flagged.qc_excluded.sum()):,} station-hours)"
    )
    good = flagged[flagged["ok"]]

    end = flagged["ts_utc"].max()
    grid = pd.date_range(START, end, freq="h")
    ready = cities[cities["forecast_ready"]]
    n_st = st.groupby("city_id").size()

    city_rows, summary = [], []
    for c in cities.itertuples():
        g = good[good.city_id == c.id]
        f = flagged[flagged.city_id == c.id]
        need = need_stations(int(n_st.get(c.id, 0)))
        per_hour = g.groupby("ts_utc")["value"].agg(["mean", "size"])
        start = START if c.forecast_ready else (per_hour.index.min() if len(per_hour) else end)
        idx = grid[grid >= start]
        per_hour = per_hour.reindex(idx)
        enough = per_hour["size"].fillna(0) >= need
        s = per_hour["mean"].where(enough)
        # fill isolated single-hour gaps only
        gap = s.isna() & s.shift(1).notna() & s.shift(-1).notna()
        filled = s.copy()
        filled[gap] = ((s.shift(1) + s.shift(-1)) / 2)[gap]
        df = pd.DataFrame(
            {
                "city_id": c.id,
                "ts_utc": idx,
                "pm25": filled.to_numpy(),
                "n_stations": per_hour["size"].fillna(0).astype(int).to_numpy(),
                "filled": gap.to_numpy(),
            }
        )
        city_rows.append(df)
        any_station = per_hour["size"].fillna(0) > 0
        summary.append(
            {
                "city_id": c.id,
                "city": c.name,
                "state": c.state,
                "forecast_ready": c.forecast_ready,
                "stations": int(n_st.get(c.id, 0)),
                "need_stations": need,
                "raw_rows": int(len(f)),
                "dropped_range": int(f["bad_range"].sum()),
                "stuck_runs": int(f.loc[f.stuck, "stuck_run"].nunique()),
                "stuck_hours": int(f["stuck"].sum()),
                "hours": int(len(idx)),
                "city_hours": int(filled.notna().sum()),
                "pct_hours": round(100 * filled.notna().mean(), 1) if len(idx) else 0.0,
                "pct_hours_any_station": round(100 * any_station.mean(), 1) if len(idx) else 0.0,
                "filled_hours": int(gap.sum()),
            }
        )
    city = pd.concat(city_rows, ignore_index=True)
    summ = pd.DataFrame(summary)

    weather = (
        pd.read_parquet(INTERIM / "weather.parquet")
        if (INTERIM / "weather.parquet").exists()
        else None
    )
    cams = (
        pd.read_parquet(INTERIM / "cams.parquet") if (INTERIM / "cams.parquet").exists() else None
    )
    fires = (
        pd.read_parquet(INTERIM / "fires.parquet") if (INTERIM / "fires.parquet").exists() else None
    )

    DB.parent.mkdir(parents=True, exist_ok=True)
    tmp = DB.with_suffix(".tmp.duckdb")
    tmp.unlink(missing_ok=True)
    con = duckdb.connect(str(tmp))
    con.register("st", st.drop(columns=[c for c in st.columns if st[c].map(type).eq(list).any()]))
    con.execute("CREATE TABLE stations AS SELECT * FROM st")
    con.register("ci", cities)
    con.execute("CREATE TABLE cities AS SELECT * FROM ci")
    con.register("fl", flagged.drop(columns=["stuck_run"]))
    con.execute("CREATE TABLE pm25_station AS SELECT * FROM fl")
    con.register("cy", city)
    con.execute("CREATE TABLE pm25_city AS SELECT * FROM cy")
    con.register("qc", qc.merge(st[["sensor_id", "name"]], on="sensor_id"))
    con.execute("CREATE TABLE station_month_qc AS SELECT * FROM qc")
    con.register("su", summ)
    con.execute("CREATE TABLE clean_summary AS SELECT * FROM su")
    for name, df in (("weather", weather), ("cams", cams), ("fires", fires)):
        if df is not None:
            con.register("x", df)
            con.execute(f"CREATE TABLE {name} AS SELECT * FROM x")
            con.unregister("x")
    con.close()
    tmp.replace(DB)
    log(
        f"wrote {DB.relative_to(ROOT)}: {len(city):,} city-hours for {len(cities)} cities "
        f"({len(ready)} forecast-ready)"
    )
    return {"summary": summ, "flagged": flagged, "city": city}


def write_report() -> str:
    """reports/cleaning.md + cleaning.json: per-city cleaning stats and fire points by month."""
    con = duckdb.connect(str(DB), read_only=True)
    con.execute("SET TimeZone='Asia/Kolkata'")
    s = con.execute(
        "SELECT * FROM clean_summary WHERE forecast_ready ORDER BY stations DESC, city"
    ).df()
    f = con.execute(
        """SELECT strftime(ts_utc, '%Y-%m') AS month, count(*) AS n, round(sum(frp)) AS frp,
                  sum(CASE WHEN lon <= 77.5 AND lat >= 29 THEN 1 ELSE 0 END) AS punjab_haryana,
                  sum(CASE WHEN source LIKE '%SNPP%' THEN 1 ELSE 0 END) AS snpp
           FROM fires
           WHERE ts_utc >= TIMESTAMPTZ '2025-02-01 00:00:00+05:30'
             AND ts_utc < (SELECT max(ts_utc) FROM pm25_city) + INTERVAL 1 HOUR
           GROUP BY 1 ORDER BY 1"""
    ).df()
    excl = con.execute(
        """SELECT s.city, q.name, q.month, q.hours, q.rel_diff, q.daily_corr
           FROM station_month_qc q JOIN stations s USING (sensor_id)
           WHERE q.exclude ORDER BY s.city, q.name, q.month"""
    ).df()
    delhi = station_vs_city(con, "Delhi")
    pusa = delhi[delhi.station.str.startswith("Pusa")]
    con.close()
    out = [
        "# Cleaning summary",
        "",
        "Forecast-ready cities, 2025-02-01 00:00 IST to the latest reading. `% hours` = city-hours "
        "with a value after cleaning (>= 75% of the city's stations reporting, single-hour gaps "
        "filled). `% any station` = hours where at least one station reported. Stuck = same value "
        "6+ consecutive hours (whole run removed). Out of range = < 0 or > 1,000 ug/m3.",
        "",
        "| City | State | Stations | Need | Station rows | % hours | % any station | Filled | Stuck runs | Stuck hours | Out of range |",
        "| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
    ]
    for r in s.itertuples():
        out.append(
            f"| {r.city} | {r.state} | {r.stations} | {r.need_stations} | {r.raw_rows:,} | "
            f"{r.pct_hours} | {r.pct_hours_any_station} | {r.filled_hours} | {r.stuck_runs} | "
            f"{r.stuck_hours} | {r.dropped_range} |"
        )
    out += [
        "",
        "# Pusa (Delhi) vs the Delhi median",
        "",
        "Each station against the median of Delhi's other stations, hour by hour, cleaned data. "
        f"Flag = |monthly median difference| > {BIAS_FLAG:.0%} for {PERSIST_MONTHS}+ consecutive months.",
        "",
        "| Station | Hours | Median difference | Months > 30% | Longest run | Correlation | Flag |",
        "| --- | ---: | ---: | ---: | ---: | ---: | --- |",
    ]
    for r in pusa.itertuples():
        out.append(
            f"| {r.station} | {r.hours:,} | {r.median_rel_diff_pct:+.1f}% | "
            f"{r.months_over_30pct} of {r.months} | {r.longest_run_months} | {r.corr} | "
            f"{'**PERSISTENT DISAGREEMENT**' if r.flag else 'ok'} |"
        )
    flagged = delhi[delhi.flag]
    out.append(
        f"\nFor context, {len(flagged)} of {len(delhi)} Delhi stations are flagged by the same test"
        + (": " + ", ".join(flagged.station) if len(flagged) else "")
        + "."
    )
    out += [
        "",
        "# Station-months excluded",
        "",
        "A station is flagged when it is > 30% off the median of its city's other stations for 3+ "
        "consecutive months. A flagged station's month is excluded when it is > 30% off that month "
        "AND the correlation of daily means with the others' median is < 0.7. "
        f"Total: {len(excl)} station-months, {excl.name.nunique() if len(excl) else 0} stations, "
        f"{int(excl.hours.sum()) if len(excl) else 0:,} station-hours.",
        "",
        "| City | Station | Months excluded | Detail (month: difference, daily r) |",
        "| --- | --- | ---: | --- |",
    ]
    for (city, name), g in excl.groupby(["city", "name"], sort=True):
        detail = ", ".join(
            f"{r.month}: {100 * r.rel_diff:+.0f}%, r {r.daily_corr:.2f}" for r in g.itertuples()
        )
        out.append(f"| {city} | {name} | {len(g)} | {detail} |")
    out += [
        "",
        "# Fire points by month (IST)",
        "",
        "VIIRS, 70-85E 24-33N. NOAA-20 throughout; S-NPP only on NOAA-20 gap days (column S-NPP).",
        "",
        "| Month | Fire points | Sum FRP (MW) | Punjab/Haryana box (<=77.5E, >=29N) | S-NPP |",
        "| --- | ---: | ---: | ---: | ---: |",
    ]
    for r in f.itertuples():
        out.append(
            f"| {r.month} | {r.n:,} | {int(r.frp):,} | {int(r.punjab_haryana):,} | {int(r.snpp):,} |"
        )
    text = "\n".join(out) + "\n"
    (ROOT / "reports" / "cleaning.md").write_text(text, encoding="utf-8")
    s.to_json(ROOT / "reports" / "cleaning.json", orient="records", indent=1)
    return text


BIAS_FLAG = 0.30  # |monthly median relative difference| above this = disagreeing month
PERSIST_MONTHS = 3  # this many consecutive disagreeing months = persistent


def station_vs_city(con: duckdb.DuckDBPyConnection, city: str) -> pd.DataFrame:
    """Each station against the median of the city's *other* stations, hour by hour (clean data).

    rel = (station - others' median) / others' median, summarised per IST month. A station is
    flagged when |monthly median rel| > 30% for 3+ consecutive months.
    """
    df = con.execute(
        """SELECT s.name, p.sensor_id, p.ts_utc, p.value FROM pm25_station p
           JOIN stations s USING (sensor_id) WHERE s.city = ? AND p.ok""",
        [city],
    ).df()
    wide = df.pivot_table(index="ts_utc", columns="name", values="value")
    rows = []
    for name in wide.columns:
        others = wide.drop(columns=name).median(axis=1)
        rel = ((wide[name] - others) / others).where(others > 5).dropna()
        m = rel.groupby(rel.index.tz_convert("Asia/Kolkata").strftime("%Y-%m")).median()
        bad = (m.abs() > BIAS_FLAG).astype(int)
        longest = int(bad.groupby((bad == 0).cumsum()).sum().max()) if len(bad) else 0
        pair = pd.concat([wide[name], others], axis=1).dropna()
        rows.append(
            {
                "station": name,
                "hours": int(rel.size),
                "median_rel_diff_pct": round(100 * rel.median(), 1),
                "months_over_30pct": int(bad.sum()),
                "months": int(bad.size),
                "longest_run_months": longest,
                "corr": round(pair.iloc[:, 0].corr(pair.iloc[:, 1]), 2) if len(pair) > 24 else None,
                "flag": longest >= PERSIST_MONTHS,
            }
        )
    return pd.DataFrame(rows).sort_values("median_rel_diff_pct")
