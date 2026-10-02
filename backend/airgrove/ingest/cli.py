"""Entry points used by tasks.py."""

from datetime import UTC

from .discover import REPORT, discover, write_table
from .openaq import OpenAQ


def coverage() -> None:
    oa = OpenAQ()
    report = discover(oa, log=lambda m: print(m, flush=True))
    print(write_table(report, REPORT.with_suffix(".md")))
    print(f"requests made: {oa.requests_made}, cache hits: {oa.cache_hits}")


def hourcheck(sensor_id: int = 12234787, day0_ist: str = "2026-09-24", days: int = 3) -> None:
    """Fetch `days` IST days for one sensor (default: R K Puram, Delhi) and report which hours of
    the day are present, including 00:00 IST and the period that contains 00:00 UTC."""
    from collections import Counter
    from datetime import datetime, timedelta, timezone

    from .openaq import hourly_by_start, padded_window

    ist = timezone(timedelta(hours=5, minutes=30))
    d0 = datetime.fromisoformat(day0_ist).replace(tzinfo=ist)
    a, b = padded_window(d0.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ"), days)
    got = hourly_by_start(OpenAQ().sensor_hours(sensor_id, a, b))
    starts = {datetime.fromisoformat(k.replace("Z", "+00:00")) for k in got}
    want = [d0 + timedelta(hours=k) for k in range(24 * days)]
    present = [h for h in want if h in starts]
    by_hour = Counter(h.astimezone(ist).hour for h in present)
    print(
        f"sensor {sensor_id}: {len(present)}/{len(want)} hours present ({day0_ist}, {days} IST days)"
    )
    print(
        "hours of day (IST) with data:",
        sorted(by_hour),
        "missing entirely:",
        [h for h in range(24) if h not in by_hour],
    )
    print(
        "missing hours:",
        [h.astimezone(ist).strftime("%d %b %H:%M IST") for h in want if h not in starts],
    )
    for h in want:
        if h.astimezone(ist).hour == 0:
            print(
                f"  00:00 IST {h.astimezone(ist):%d %b} = period starting {h.astimezone(UTC):%H:%MZ}: {'present' if h in starts else 'MISSING'}"
            )
        if h.astimezone(UTC).hour == 23:  # period 23:30Z-00:30Z contains 00:00 UTC
            print(
                f"  00:00 UTC {(h + timedelta(hours=1)).astimezone(UTC):%d %b} (period {h.astimezone(UTC):%H:%MZ}-{(h + timedelta(hours=1)).astimezone(UTC):%H:%MZ}): {'present' if h in starts else 'MISSING'}"
            )


def download_openaq() -> None:
    from .openaq_history import download

    oa = OpenAQ()
    download(oa, log=lambda m: print(m, flush=True))
    print(f"done: requests {oa.requests_made}, cache hits {oa.cache_hits}", flush=True)


def download_rest() -> None:
    """Weather, CAMS and fires (independent of OpenAQ, can run alongside it)."""
    from .firms import download_fires, period
    from .openmeteo import download_cams, download_weather

    log = lambda m: print(m, flush=True)  # noqa: E731
    f = download_fires(*period(), log=log)
    log(f"fires: {len(f)} detections {f.ts_utc.min()} -> {f.ts_utc.max()}")
    c = download_cams(log=log)
    log(f"CAMS: {len(c)} rows, {c.cams_pm25.notna().mean():.1%} non-null")
    w = download_weather(log=log)
    log(f"weather: {len(w)} rows")


def clean() -> None:
    from ..clean import build, write_report

    build(log=lambda m: print(m, flush=True))
    print(write_report().split("# Fire points")[1])
