import pandas as pd

from airgrove.clean import flag_station


def _df(values, gaps=()):
    ts = pd.date_range("2025-02-01T18:30Z", periods=len(values), freq="h")
    df = pd.DataFrame({"ts_utc": ts, "value": values})
    return df.drop(index=list(gaps)).reset_index(drop=True)


def test_range_flags():
    f = flag_station(_df([-1, 5, 1001, 50]))
    assert f["bad_range"].tolist() == [True, False, True, False]


def test_stuck_needs_six_consecutive_hours():
    f = flag_station(_df([10, 20, 20, 20, 20, 20, 20, 30, 40, 40, 40, 40, 40, 1]))
    assert f["stuck"].tolist() == [False] + [True] * 6 + [False] * 7


def test_stuck_run_broken_by_missing_hour():
    # 3 + 3 equal values with a missing hour between them are not one stuck run
    f = flag_station(_df([7, 7, 7, 0, 7, 7, 7], gaps=[3]))
    assert not f["stuck"].any()
