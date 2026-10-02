"""FastAPI app serving the same payloads as the static export.

Run: python tasks.py api   (http://localhost:8000/api/cities)
"""

from __future__ import annotations

from functools import lru_cache

import pandas as pd
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

from . import export

app = FastAPI(title="Airgrove API")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET"])


@lru_cache(maxsize=1)
def payloads() -> dict:
    return export.build()


@app.get("/api/cities")
def cities() -> list[dict]:
    return payloads()["cities"]


@app.get("/api/series")
def series(city: str = Query(...)) -> dict:
    s = payloads()["series"].get(city)
    if s is None:
        raise HTTPException(404, f"unknown city {city}")
    return s


@app.get("/api/map")
def map_(ts: str | None = None) -> dict:
    return export.map_at(payloads(), ts)


@app.get("/api/fires")
def fires(from_: str | None = Query(None, alias="from"), to: str | None = None) -> dict:
    f = payloads()["fires"]
    lo = pd.Timestamp(from_) if from_ else pd.Timestamp(f["from"])
    hi = pd.Timestamp(to) if to else pd.Timestamp(f["to"])
    rows = [r for r in f["fires"] if lo <= pd.Timestamp(r["ts"]) <= hi]
    return {**f, "from": str(lo), "to": str(hi), "fires": rows}


@app.get("/api/model/report")
def report() -> dict:
    return payloads()["report"]


@app.get("/api/bundle")
def bundle() -> dict:
    return export.bundle(payloads())
