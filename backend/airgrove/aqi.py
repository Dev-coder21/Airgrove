"""CPCB NAQI categories for PM2.5, loaded from shared/aqi.json."""

import json
from functools import cache
from pathlib import Path

AQI_PATH = Path(__file__).resolve().parents[2] / "shared" / "aqi.json"


@cache
def load() -> dict:
    return json.loads(AQI_PATH.read_text(encoding="utf-8"))


def category(pm25: float) -> dict:
    """Category for a PM2.5 value; values are rounded to whole µg/m³ as CPCB does."""
    v = round(pm25)
    for c in load()["categories"]:
        if c["max"] is None or v <= c["max"]:
            return c
    raise AssertionError("unreachable")
