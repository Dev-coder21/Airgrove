from datetime import UTC, datetime, timedelta, timezone

from airgrove.ingest.discover import current_run_start, parse_name, state_of
from airgrove.ingest.openaq import RateLimiter, cache_path, hourly_by_start, padded_window

IST = timezone(timedelta(hours=5, minutes=30))


def test_parse_name():
    assert parse_name("Anand Vihar, New Delhi - DPCC") == ("Anand Vihar", "Delhi", "DPCC")
    assert parse_name("Vikas Sadan, Gurugram - HSPCB") == ("Vikas Sadan", "Gurugram", "HSPCB")
    assert parse_name("Sector - 125, Noida, UP - UPPCB") == ("Sector - 125", "Noida", "UPPCB")
    assert parse_name("Collectorate - Gaya - BSPCB")[1:] == ("Gaya", "BSPCB")


def test_state_lookup():
    assert state_of("DPCC", "", "Delhi") == "Delhi"
    assert state_of("IITM", "Indian Institute of Tropical Meteorology", "Pune") == "Maharashtra"


def test_cache_key_ignores_param_order():
    assert cache_path("/x", {"a": 1, "b": 2}) == cache_path("/x", {"b": 2, "a": 1})


def test_rate_limiter_allows_burst_up_to_cap():
    rl = RateLimiter(max_calls=3, period=60)
    for _ in range(3):
        rl.wait()  # must not block
    assert len(rl.calls) == 3


def _row(start: datetime, v: float) -> dict:
    s = start.astimezone(UTC)
    e = s + timedelta(hours=1)
    f = "%Y-%m-%dT%H:%M:%SZ"
    return {
        "period": {"datetimeFrom": {"utc": s.strftime(f)}, "datetimeTo": {"utc": e.strftime(f)}},
        "value": v,
    }


def test_overlapping_windows_keep_every_hour_including_midnights():
    d0 = datetime(2026, 9, 24, tzinfo=IST)
    hours = [d0 + timedelta(hours=k) for k in range(72)]
    # two overlapping fetches, as a resumable ingest would do
    a = [_row(h, 1.0) for h in hours[:40]]
    b = [_row(h, 1.0) for h in hours[30:]]
    got = hourly_by_start(a + b)
    assert len(got) == 72
    ist_hours = {datetime.fromisoformat(k.replace("Z", "+00:00")).astimezone(IST).hour for k in got}
    assert ist_hours == set(range(24))
    # the period containing 00:00 UTC starts at 23:30Z
    assert any(k.endswith("T23:30:00Z") for k in got)


def test_padded_window_covers_edges():
    a, b = padded_window("2026-09-23T18:30:00Z", 3)
    assert a == "2026-09-23T16:30:00Z" and b == "2026-09-26T20:30:00Z"


def test_run_start_resets_after_gap():
    def m(y, mo, frac):
        a = datetime(y, mo, 1, tzinfo=UTC)
        return {"from": a, "to": a + timedelta(days=30), "hours": 720.0, "obs": 720.0 * frac}

    rows = [m(2016, 1, 0.9), m(2016, 2, 0.9), m(2025, 2, 0.5), m(2025, 3, 0.9)]
    assert current_run_start(rows) == datetime(2025, 2, 1, tzinfo=UTC)
