import numpy as np
from fastapi.testclient import TestClient

from airgrove import api, export
from airgrove.calibrate import conformal_q
from airgrove.features import rolling, shift


def test_compass():
    assert export.compass(0) == "N"
    assert export.compass(350) == "N"
    assert export.compass(91) == "E"
    assert export.compass(float("nan")) is None


def test_conformal_quantile_is_finite_sample():
    scores = np.arange(1, 11, dtype=float)  # n = 10 -> ceil(11 * 0.8) = 9th smallest
    assert conformal_q(scores, 0.8) == 9.0


def test_features_never_look_ahead():
    y = np.arange(10, dtype=np.float32)[None, :]
    assert np.isnan(shift(y, 3)[0, 2]) and shift(y, 3)[0, 5] == 2
    m, _ = rolling(y, 4)
    assert m[0, 5] == np.mean([2, 3, 4, 5])  # window (i - 4, i], nothing after i


def _fake() -> dict:
    times = ["2026-09-29T12:30:00Z", "2026-09-29T13:30:00Z", "2026-09-29T14:30:00Z"]
    row = {
        "ts": times[1],
        "observed": 50.0,
        "forecast": 50.0,
        "p10": None,
        "p90": None,
        "wind_kmh": 5.0,
        "wind_dir": "NW",
        "rh": 60,
        "mixing_height_m": 400,
    }
    return {
        "cities": [
            {
                "id": "delhi",
                "name": "Delhi",
                "state": "Delhi",
                "lat": 28.6,
                "lon": 77.2,
                "stations": 38,
                "forecast_ready": True,
            }
        ],
        "series": {"delhi": {"city": "delhi", "now": times[1], "rows": [row]}},
        "map": {
            "now": times[1],
            "times": times,
            "limit_24h": 60,
            "pm25": {"delhi": [40.0, 95.0, 130.0]},
        },
        "fires": {
            "from": times[0],
            "to": times[1],
            "fires": [
                {
                    "lat": 30,
                    "lon": 75,
                    "ts": times[0],
                    "frp": 9.0,
                    "source": "VIIRS_NOAA20_NRT",
                    "pbhr": True,
                }
            ],
        },
        "report": {"overall": {}},
    }


def test_api_endpoints(monkeypatch):
    monkeypatch.setattr(api, "payloads", _fake)
    c = TestClient(api.app)
    assert c.get("/api/cities").json()[0]["id"] == "delhi"
    assert c.get("/api/series", params={"city": "delhi"}).json()["rows"][0]["observed"] == 50.0
    assert c.get("/api/series", params={"city": "nowhere"}).status_code == 404
    m = c.get("/api/map", params={"ts": "2026-09-29T14:30:00Z"}).json()
    assert m["cities"][0] == {
        "id": "delhi",
        "pm25": 130.0,
        "category": "Very Poor",
        "kind": "forecast",
    }
    assert c.get("/api/map").json()["cities"][0]["kind"] == "observed"
    assert len(c.get("/api/fires").json()["fires"]) == 1
    assert c.get("/api/model/report").status_code == 200
