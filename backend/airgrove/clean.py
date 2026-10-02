"""Clean station PM2.5 and build the city-hour series; load everything into DuckDB.

Rules (CLAUDE.md):
1. drop values < 0 or > 1,000 ug/m3;
2. stuck sensors: the same value for 6+ consecutive hours -> the whole run is flagged and dropped;
3. a city-hour exists only if >= 75% of the city's stations report (after 1-2); value = mean;
4. fill single-hour gaps only (linear), nothing longer.
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
MIN_STATION_SHARE = 0.75
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


def build(log=print) -> dict:
    st, cities = load_stations()
    files = sorted((INTERIM / "openaq").glob("*.parquet"))
    raw = pd.concat([pd.read_parquet(f) for f in files], ignore_index=True)
    raw = raw.drop_duplicates(["sensor_id", "ts_utc"])  # belt and braces: one reading per hour
    raw = raw.merge(st[["sensor_id", "city_id"]], on="sensor_id")
    log(f"raw station-hours: {len(raw):,} from {raw.sensor_id.nunique()} sensors")

    flagged = pd.concat([flag_station(g) for _, g in raw.groupby("sensor_id")], ignore_index=True)
    good = flagged[flagged["ok"]]

    end = flagged["ts_utc"].max()
    grid = pd.date_range(START, end, freq="h")
    ready = cities[cities["forecast_ready"]]
    n_st = st.groupby("city_id").size()

    city_rows, summary = [], []
    for c in cities.itertuples():
        g = good[good.city_id == c.id]
        f = flagged[flagged.city_id == c.id]
        need = math.ceil(MIN_STATION_SHARE * n_st.get(c.id, 0))
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
