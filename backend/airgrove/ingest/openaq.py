"""OpenAQ v3 client: rate-limited (<= 50 req/min and <= 1,900 req/hour), every raw response
cached on disk (gzipped JSON, written atomically so stopping mid-write never leaves a bad file).

Cached responses are never re-fetched. The cache key is the path plus sorted query params, so
re-running any job only costs requests for what is missing. Responses that are still "live"
(e.g. a window that ends in the future) can be fetched with ``cache=False``.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[3]
CACHE_DIR = ROOT / "data" / "raw" / "openaq"
BASE_URL = "https://api.openaq.org/v3"
PM25_PARAMETER_ID = 2


class SlowQuery(RuntimeError):
    """The API kept timing out (408) on this query; ask for a smaller range."""


class RateLimiter:
    """Sliding window: at most `max_calls` in any `period` seconds."""

    def __init__(self, max_calls: int = 50, period: float = 60.0) -> None:
        self.max_calls, self.period = max_calls, period
        self.calls: deque[float] = deque()
        self.lock = threading.Lock()

    def wait(self) -> None:
        with self.lock:
            while True:
                now = time.monotonic()
                while self.calls and now - self.calls[0] >= self.period:
                    self.calls.popleft()
                if len(self.calls) < self.max_calls:
                    self.calls.append(now)
                    return
                time.sleep(self.period - (now - self.calls[0]) + 0.05)


def cache_path(path: str, params: dict[str, Any] | None) -> Path:
    key = json.dumps({"path": path, "params": params or {}}, sort_keys=True, default=str)
    h = hashlib.sha1(key.encode()).hexdigest()
    folder = path.strip("/").split("/")[0] or "root"
    return CACHE_DIR / folder / h[:2] / f"{h}.json.gz"


def read_cache(cp: Path) -> dict | None:
    if cp.exists():
        return json.loads(gzip.decompress(cp.read_bytes()))
    legacy = cp.with_suffix("")  # plain .json from the first coverage run
    if legacy.exists():
        return json.loads(legacy.read_text(encoding="utf-8"))
    return None


def write_cache(cp: Path, data: dict) -> None:
    cp.parent.mkdir(parents=True, exist_ok=True)
    tmp = cp.with_name(cp.name + ".tmp")
    tmp.write_bytes(gzip.compress(json.dumps(data).encode(), compresslevel=6))
    os.replace(tmp, cp)


class OpenAQ:
    def __init__(self, api_key: str | None = None, max_per_min: int = 50) -> None:
        load_dotenv(ROOT / ".env")
        key = (api_key or os.environ.get("OPENAQ_API_KEY", "")).strip()
        if not key:
            raise RuntimeError("OPENAQ_API_KEY is not set in .env")
        self.client = httpx.Client(base_url=BASE_URL, headers={"X-API-Key": key}, timeout=90)
        self.limiter = RateLimiter(max_per_min, 60.0)
        self.hourly = RateLimiter(1900, 3600.0)  # API cap is 2,000/hour
        self.requests_made = 0
        self.cache_hits = 0

    def get(self, path: str, params: dict[str, Any] | None = None, cache: bool = True) -> dict:
        cp = cache_path(path, params)
        if cache and (hit := read_cache(cp)) is not None:
            self.cache_hits += 1
            return hit
        backoff = 5.0
        timeouts = 0
        for _attempt in range(6):
            self.hourly.wait()
            self.limiter.wait()
            try:
                r = self.client.get(path, params=params)
            except httpx.TransportError:
                time.sleep(backoff)
                backoff *= 2
                continue
            self.requests_made += 1
            if r.status_code == 429:
                # back off hard: repeated 429s can get the key banned
                reset = float(r.headers.get("x-ratelimit-reset", 60))
                time.sleep(max(reset, backoff))
                backoff *= 2
                continue
            if r.status_code == 408:
                timeouts += 1
                if timeouts >= 2:
                    raise SlowQuery(f"{path} {params}")
                time.sleep(backoff)
                continue
            if r.status_code >= 500:
                time.sleep(backoff)
                backoff *= 2
                continue
            r.raise_for_status()
            data = r.json()
            # keep under the hourly cap too: slow down when the window is nearly used
            if int(r.headers.get("x-ratelimit-remaining", 60)) <= 2:
                time.sleep(float(r.headers.get("x-ratelimit-reset", 60)))
            if cache:
                write_cache(cp, data)
            return data
        raise RuntimeError(f"OpenAQ request failed after retries: {path} {params}")

    def paged(self, path: str, params: dict[str, Any], limit: int = 1000) -> list[dict]:
        """All results across pages (each page cached separately)."""
        out: list[dict] = []
        page = 1
        while True:
            data = self.get(path, {**params, "limit": limit, "page": page})
            res = data.get("results", [])
            out.extend(res)
            if len(res) < limit:
                return out
            page += 1

    # ---- endpoints ----
    def locations_india_pm25(self) -> list[dict]:
        return self.paged("/locations", {"iso": "IN", "parameters_id": PM25_PARAMETER_ID})

    def sensor_hours(
        self, sensor_id: int, dt_from: str, dt_to: str, cache: bool = True
    ) -> list[dict]:
        """Hourly values for one sensor; datetimes are ISO strings (UTC)."""
        out: list[dict] = []
        page = 1
        while True:
            params = {"datetime_from": dt_from, "datetime_to": dt_to, "limit": 1000, "page": page}
            data = self.get(f"/sensors/{sensor_id}/hours", params, cache=cache)
            res = data.get("results", [])
            out.extend(res)
            if len(res) < 1000:
                return out
            page += 1

    def sensor_hours_monthly(self, sensor_id: int, dt_from: str, dt_to: str) -> list[dict]:
        """Monthly aggregates of hourly values, with observed/expected counts per month."""
        return self.paged(
            f"/sensors/{sensor_id}/hours/monthly", {"datetime_from": dt_from, "datetime_to": dt_to}
        )


def hourly_by_start(rows: list[dict]) -> dict[str, float]:
    """Index /hours rows by period start (UTC ISO). OpenAQ hours are IST clock hours, so in UTC
    they start at :30 (00:00 IST = 18:30Z). Duplicates from overlapping windows collapse here."""
    return {r["period"]["datetimeFrom"]["utc"]: r["value"] for r in rows}


def padded_window(day0_utc: str, days: int, pad_hours: int = 2) -> tuple[str, str]:
    """UTC request window covering `days` IST days from `day0_utc`, padded on both sides so
    edge hours (incl. 00:00 IST and the hour around 00:00 UTC) are never cut off."""
    from datetime import datetime, timedelta

    d0 = datetime.fromisoformat(day0_utc.replace("Z", "+00:00"))
    a = d0 - timedelta(hours=pad_hours)
    b = d0 + timedelta(days=days, hours=pad_hours)
    return a.strftime("%Y-%m-%dT%H:%M:%SZ"), b.strftime("%Y-%m-%dT%H:%M:%SZ")
