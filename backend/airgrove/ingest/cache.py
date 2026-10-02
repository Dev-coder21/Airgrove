"""Small cached HTTP GET for Open-Meteo and FIRMS (same gzip + atomic-write cache as OpenAQ).

The cache key never includes secrets: callers pass the URL with a placeholder and the secret
separately, so keys are not written to disk.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

import httpx

from .openaq import ROOT, RateLimiter, read_cache, write_cache

RAW = ROOT / "data" / "raw"


class CachedGet:
    def __init__(self, name: str, per_min: int = 60, timeout: float = 120) -> None:
        self.dir = RAW / name
        self.limiter = RateLimiter(per_min, 60.0)
        self.client = httpx.Client(timeout=timeout)
        self.requests_made = 0
        self.cache_hits = 0

    def path(self, url: str, params: dict[str, Any] | None) -> Path:
        key = json.dumps({"url": url, "params": params or {}}, sort_keys=True)
        h = hashlib.sha1(key.encode()).hexdigest()
        return self.dir / h[:2] / f"{h}.json.gz"

    def get(
        self,
        url: str,
        params: dict[str, Any] | None = None,
        *,
        secret: str = "",
        as_text: bool = False,
    ) -> Any:
        """GET `url` (may contain '{secret}'), cached by the URL template + params."""
        cp = self.path(url, params)
        if (hit := read_cache(cp)) is not None:
            self.cache_hits += 1
            return hit["text"] if as_text else hit
        backoff = 5.0
        for _ in range(6):
            self.limiter.wait()
            try:
                r = self.client.get(url.replace("{secret}", secret), params=params)
            except httpx.TransportError:
                time.sleep(backoff)
                backoff *= 2
                continue
            self.requests_made += 1
            if r.status_code == 429 or r.status_code >= 500:
                time.sleep(max(backoff, 60 if r.status_code == 429 else 0))
                backoff *= 2
                continue
            r.raise_for_status()
            data = {"text": r.text} if as_text else r.json()
            if not as_text and isinstance(data, dict) and data.get("error"):
                raise RuntimeError(f"{url}: {data.get('reason')}")
            write_cache(cp, data)
            return data["text"] if as_text else data
        raise RuntimeError(f"request failed after retries: {url} {params}")
