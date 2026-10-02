"""Discover Indian CPCB PM2.5 stations on OpenAQ, group them into cities and measure coverage.

Coverage uses OpenAQ's monthly aggregates of hourly values (one request per sensor), not the full
hourly history. Their `expectedCount` is unreliable (sometimes doubled), so coverage is computed as
observed hours / real hours in the window.

Definitions (written to reports/coverage.json):
- window: the 12 months ending at the latest reading of any station.
- station coverage: share of window hours with an hourly value.
- city coverage: mean station coverage (= share of station-hours present).
- history start: first month of the current unbroken run of data (a month with <5% of hours counts
  as a break). Old 2016-2018 sensors are ignored because a multi-year gap follows them.
- forecast-ready: city coverage >= 75% and >= 12 months between history start and latest reading.
"""

from __future__ import annotations

import json
import re
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

from .openaq import ROOT, OpenAQ, SlowQuery

IST = timezone(timedelta(hours=5, minutes=30))
REPORT = ROOT / "reports" / "coverage.json"
STATIONS_OUT = ROOT / "data" / "stations.json"
MIN_COVERAGE = 0.75
MIN_MONTHS = 12
ACTIVE_DAYS = 30  # a station must have reported within this many days of the latest reading
# Monthly aggregates are requested from here on (older ranges time out server-side). A run that
# starts at this date is reported as "2023-01 or earlier"; that is already > 12 months.
HISTORY_FROM = "2023-01-01T00:00:00Z"

# station-name agency suffix -> state
AGENCY_STATE = {
    "DPCC": "Delhi",
    "HSPCB": "Haryana",
    "UPPCB": "Uttar Pradesh",
    "MPCB": "Maharashtra",
    "RSPCB": "Rajasthan",
    "BSPCB": "Bihar",
    "KSPCB": "Karnataka",
    "WBPCB": "West Bengal",
    "WBSPCB": "West Bengal",
    "OSPCB": "Odisha",
    "MPPCB": "Madhya Pradesh",
    "TSPCB": "Telangana",
    "CECB": "Chhattisgarh",
    "TNPCB": "Tamil Nadu",
    "APPCB": "Andhra Pradesh",
    "PPCB": "Punjab",
    "APCB": "Assam",
    "PCBA": "Assam",
    "KSPCB Kerala": "Kerala",
    "Kerala PCB": "Kerala",
    "GPCB": "Gujarat",
    "CPCC": "Chandigarh",
    "UKPCB": "Uttarakhand",
    "UEPPCB": "Uttarakhand",
    "JSPCB": "Jharkhand",
    "MSPCB": "Meghalaya",
    "Mizoram PCB": "Mizoram",
    "NPCB": "Nagaland",
    "PPCC": "Puducherry",
    "JKSPCB": "Jammu and Kashmir",
    "JKPCB": "Jammu and Kashmir",
    "APSPCB": "Arunachal Pradesh",
    "HPSPCB": "Himachal Pradesh",
    "TSPCB Tripura": "Tripura",
    "SSPCB": "Sikkim",
    "IMC": "Madhya Pradesh",
    "JMC": "Madhya Pradesh",
    "BMC": "Maharashtra",
    "SMC": "Gujarat",
}
# owner name fragment -> state (used when the suffix is a central agency like CPCB/IITM/IMD)
OWNER_STATE = [
    ("Maharashtra", "Maharashtra"),
    ("Uttar Pradesh", "Uttar Pradesh"),
    ("Rajasthan", "Rajasthan"),
    ("Bihar", "Bihar"),
    ("Karnataka", "Karnataka"),
    ("Haryana", "Haryana"),
    ("Delhi", "Delhi"),
    ("West Bengal", "West Bengal"),
    ("Odisha", "Odisha"),
    ("Madhya Pradesh", "Madhya Pradesh"),
    ("Telangana", "Telangana"),
    ("Chhattisgarh", "Chhattisgarh"),
    ("Bhilai", "Chhattisgarh"),
    ("Tamil Nadu", "Tamil Nadu"),
    ("Andhra Pradesh", "Andhra Pradesh"),
    ("Punjab", "Punjab"),
    ("Assam", "Assam"),
    ("Kerala", "Kerala"),
    ("Gujarat", "Gujarat"),
    ("Surat", "Gujarat"),
    ("Nandesari", "Gujarat"),
    ("Chandigarh", "Chandigarh"),
    ("Uttarakhand", "Uttarakhand"),
    ("Jharkha", "Jharkhand"),
    ("Meghalaya", "Meghalaya"),
    ("Mizoram", "Mizoram"),
    ("Nagaland", "Nagaland"),
    ("Puducherry", "Puducherry"),
    ("Jammu", "Jammu and Kashmir"),
    ("Arunachal", "Arunachal Pradesh"),
    ("H.P.", "Himachal Pradesh"),
    ("Tripura", "Tripura"),
    ("Brihanmumbai", "Maharashtra"),
    ("Indore", "Madhya Pradesh"),
    ("Jabalpur", "Madhya Pradesh"),
]
# city -> state for stations run by central agencies
CITY_STATE = {
    "Delhi": "Delhi",
    "Mumbai": "Maharashtra",
    "Pune": "Maharashtra",
    "Kolkata": "West Bengal",
    "Chennai": "Tamil Nadu",
    "Bengaluru": "Karnataka",
    "Hyderabad": "Telangana",
    "Ahmedabad": "Gujarat",
    "Lucknow": "Uttar Pradesh",
    "Patna": "Bihar",
    "Jaipur": "Rajasthan",
    # stations run by companies (the name suffix is the company)
    "Ratlam": "Madhya Pradesh",
    "Satna": "Madhya Pradesh",
    "Maihar": "Madhya Pradesh",
    "Rupnagar": "Punjab",
    "Gangtok": "Sikkim",
}
CITY_ALIASES = {
    # spellings, and station areas that sit inside a listed city
    "Pimpri-Chinchwad": "Pimpri Chinchwad",
    "Kalaburgi": "Kalaburagi",
    "Tirupathi": "Tirupati",
    "Belapur": "Navi Mumbai",
    "Vatva": "Ahmedabad",
    "New Delhi": "Delhi",
    "Bangalore": "Bengaluru",
    "Gurgaon": "Gurugram",
    "Navi mumbai": "Navi Mumbai",
    "Bombay": "Mumbai",
    "Calcutta": "Kolkata",
}

NAME_RE = re.compile(r"^(?P<station>.*?)(?:,\s*|\s+-\s+)(?P<city>[^,]+?)\s*-\s*(?P<agency>[^-]+)$")


def parse_name(name: str) -> tuple[str, str, str]:
    """'Anand Vihar, New Delhi - DPCC' -> ('Anand Vihar', 'Delhi', 'DPCC')."""
    m = NAME_RE.match(name.strip())
    if not m:
        parts = [p.strip() for p in name.split("-")]
        return name.strip(), parts[0] if parts else name, parts[-1] if len(parts) > 1 else ""
    city = re.sub(r"\s+", " ", m["city"]).strip()
    station = m["station"].strip()
    # "Sector - 125, Noida, UP - UPPCB": the last part is a state code, the city is before it
    if re.fullmatch(r"[A-Z]{2,3}", city) and "," in station:
        station, city = (x.strip() for x in station.rsplit(",", 1))
    city = CITY_ALIASES.get(city, city)
    return station, city, m["agency"].strip()


def state_of(agency: str, owner: str, city: str) -> str | None:
    if agency in AGENCY_STATE:
        return AGENCY_STATE[agency]
    for frag, st in OWNER_STATE:
        if frag in owner:
            return st
    return CITY_STATE.get(city)


def _ts(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def month_rows(oa: OpenAQ, sensor_id: int, until: str) -> list[dict]:
    try:
        raw = oa.sensor_hours_monthly(sensor_id, HISTORY_FROM, until)
    except SlowQuery:
        raw = []
        for y in range(int(HISTORY_FROM[:4]), int(until[:4]) + 1):
            end = min(f"{y + 1}-01-01T00:00:00Z", until)
            raw += oa.sensor_hours_monthly(sensor_id, f"{y}-01-01T00:00:00Z", end)
    rows = []
    for r in raw:
        a = _ts(r["period"]["datetimeFrom"]["utc"])
        b = _ts(r["period"]["datetimeTo"]["utc"])
        hours = max(1.0, (b - a).total_seconds() / 3600)
        obs = r["coverage"]["observedCount"] or 0
        rows.append({"from": a, "to": b, "hours": hours, "obs": min(obs, hours)})
    rows = list({r["from"]: r for r in rows}.values())  # year chunks can overlap
    return sorted(rows, key=lambda x: x["from"])


def current_run_start(rows: list[dict]) -> datetime | None:
    start, prev_to = None, None
    for r in rows:
        # a near-empty month, or a missing month (no aggregate row), breaks the run
        gap = prev_to is not None and r["from"] - prev_to > timedelta(days=20)
        if r["obs"] / r["hours"] < 0.05 or gap:
            start = None
        if r["obs"] / r["hours"] >= 0.05 and start is None:
            start = r["from"]
        prev_to = r["to"]
    return start


def window_hours(rows: list[dict], w0: datetime, w1: datetime) -> float:
    """Observed hours inside [w0, w1], pro-rating months that straddle the edges."""
    tot = 0.0
    for r in rows:
        a, b = max(r["from"], w0), min(r["to"], w1)
        if b > a:
            tot += r["obs"] * ((b - a).total_seconds() / 3600) / r["hours"]
    return tot


def discover(oa: OpenAQ, log=print) -> dict:
    locs = oa.locations_india_pm25()
    cp = [
        loc for loc in locs if loc["provider"]["name"] in ("CPCB", "caaqm") and loc["datetimeLast"]
    ]
    latest = max(_ts(loc["datetimeLast"]["utc"]) for loc in cp)
    active = [
        loc for loc in cp if _ts(loc["datetimeLast"]["utc"]) >= latest - timedelta(days=ACTIVE_DAYS)
    ]
    log(
        f"{len(locs)} PM2.5 locations in India, {len(cp)} CPCB, {len(active)} active; latest {latest:%Y-%m-%d %H:%M} UTC"
    )
    until = (latest + timedelta(days=1)).strftime("%Y-%m-%dT00:00:00Z")
    w1, w0 = latest, latest - timedelta(days=365)
    win_h = (w1 - w0).total_seconds() / 3600

    stations = []
    for n, loc in enumerate(active, 1):
        best = None
        for s in loc["sensors"]:
            if s["parameter"]["id"] != 2:
                continue
            rows = month_rows(oa, s["id"], until)
            if not rows:
                continue
            last = rows[-1]["to"]
            if best is None or last > best[1]:
                best = (s["id"], last, rows)
        if n % 25 == 0:
            log(
                f"  {n}/{len(active)} stations (requests {oa.requests_made}, cache hits {oa.cache_hits})"
            )
        if not best:
            continue
        sid, _, rows = best
        start = current_run_start(rows)
        station, city, agency = parse_name(loc["name"])
        stations.append(
            {
                "location_id": loc["id"],
                "sensor_id": sid,
                "name": loc["name"],
                "station": station,
                "city": city,
                "agency": agency,
                "owner": loc["owner"]["name"],
                "state": state_of(agency, loc["owner"]["name"], city),
                "lat": loc["coordinates"]["latitude"],
                "lon": loc["coordinates"]["longitude"],
                "history_start": start.isoformat() if start else None,
                "coverage_12m": round(window_hours(rows, w0, w1) / win_h, 4),
            }
        )

    # fill missing states from other stations of the same city
    by_city: dict[str, list[dict]] = {}
    for s in stations:
        by_city.setdefault(s["city"], []).append(s)
    for sts in by_city.values():
        known = [s["state"] for s in sts if s["state"]]
        for s in sts:
            if not s["state"] and known:
                s["state"] = max(set(known), key=known.count)

    cities = []
    for name, sts in sorted(by_city.items()):
        starts = [_ts(s["history_start"]) for s in sts if s["history_start"]]
        start = min(starts) if starts else None
        months = (latest - start).days / 30.44 if start else 0.0
        cov = sum(s["coverage_12m"] for s in sts) / len(sts)
        states = [s["state"] for s in sts if s["state"]]
        cities.append(
            {
                "id": re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-"),
                "name": name,
                "state": max(set(states), key=states.count) if states else None,
                "lat": round(sum(s["lat"] for s in sts) / len(sts), 4),
                "lon": round(sum(s["lon"] for s in sts) / len(sts), 4),
                "stations": len(sts),
                "history_start": start.astimezone(IST).strftime("%Y-%m-%d")
                if start
                else None,  # IST date
                "history_start_capped": bool(
                    start and start <= _ts(HISTORY_FROM) + timedelta(days=1)
                ),
                "history_months": round(months, 1),
                "coverage_pct": round(100 * cov, 1),
                "best_station_coverage_pct": round(100 * max(s["coverage_12m"] for s in sts), 1),
                "forecast_ready": bool(cov >= MIN_COVERAGE and months >= MIN_MONTHS),
                "station_ids": [s["location_id"] for s in sts],
            }
        )
    cities.sort(key=lambda c: (-c["forecast_ready"], -c["stations"], c["name"]))
    report = {
        "generated_utc": datetime.now(UTC).isoformat(timespec="seconds"),
        "latest_reading_utc": latest.isoformat(),
        "window_utc": [w0.isoformat(), w1.isoformat()],
        "definitions": {
            "coverage_pct": "mean over the city's stations of hours with a value / hours in the 12-month window",
            "history_start": "start of the current unbroken run of monthly data across the city's stations",
            "forecast_ready": f"coverage_pct >= {MIN_COVERAGE * 100:.0f} and history >= {MIN_MONTHS} months",
            "active_station": f"CPCB PM2.5 station that reported within {ACTIVE_DAYS} days of the latest reading",
        },
        "totals": {
            "stations": len(stations),
            "cities": len(cities),
            "forecast_ready": sum(c["forecast_ready"] for c in cities),
        },
        "cities": cities,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    STATIONS_OUT.parent.mkdir(parents=True, exist_ok=True)
    STATIONS_OUT.write_text(json.dumps(stations, indent=1, ensure_ascii=False), encoding="utf-8")
    log(
        f"wrote {REPORT.relative_to(ROOT)}: {len(cities)} cities, {report['totals']['forecast_ready']} forecast-ready"
    )
    return report


def write_table(report: dict, path: Path) -> str:
    lines = [
        "| City | State | Stations | History start | % hours covered | Forecast-ready |",
        "| --- | --- | ---: | --- | ---: | --- |",
    ]
    for c in report["cities"]:
        lines.append(
            f"| {c['name']} | {c['state'] or '?'} | {c['stations']} | {('<= ' if c.get('history_start_capped') else '') + (c['history_start'] or '-')} "
            f"| {c['coverage_pct']:.1f} | {'yes' if c['forecast_ready'] else 'no'} |"
        )
    text = "\n".join(lines) + "\n"
    path.write_text(text, encoding="utf-8")
    return text
