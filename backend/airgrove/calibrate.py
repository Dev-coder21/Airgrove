"""Conformal calibration of the p10-p90 band, per horizon bucket, from saved backtest folds.

Conformalized quantile regression: score = max(p10 - y, y - p90). For test fold k the band is
widened (or narrowed) by q_k = the ceil((n+1)*0.8)/n quantile of the scores in folds before k,
for the same horizon bucket. Fold 1 has no earlier folds and stays uncalibrated (reported apart).
The final model uses q from all 12 folds. No retraining.
"""

from __future__ import annotations

import json
import math

import numpy as np
import pandas as pd

from .backtest import BUCKETS, PRED, REPORT, season
from .ingest.openaq import ROOT

LEVEL = 0.8
OUT = ROOT / "reports" / "calibration.json"


def bucket_of(h: pd.Series) -> pd.Series:
    return pd.cut(h, [0, 6, 24, 72], labels=list(BUCKETS)).astype(str)


def conformal_q(scores: np.ndarray, level: float = LEVEL) -> float:
    n = len(scores)
    k = min(n, math.ceil((n + 1) * level))
    return float(np.sort(scores)[k - 1])


def run() -> dict:
    P = pd.read_parquet(PRED)  # all saved fold predictions (with target timestamps)
    P["bucket"] = bucket_of(P["horizon"])
    P["score"] = np.maximum(P.p10 - P.y_target, P.y_target - P.p90)
    months = sorted(P.month.unique())
    P["lo_c"], P["hi_c"], P["q"] = np.nan, np.nan, np.nan
    per_fold = []
    for m in months:
        cur = P.month == m
        for b in BUCKETS:
            sel = cur & (P.bucket == b)
            prev = P[(P.month < m) & (P.bucket == b)]
            if len(prev) == 0:
                continue
            q = conformal_q(prev.score.to_numpy())
            P.loc[sel, "q"] = q
            P.loc[sel, "lo_c"] = (P.loc[sel, "p10"] - q).clip(lower=0)
            P.loc[sel, "hi_c"] = P.loc[sel, "p90"] + q
            per_fold.append({"month": m, "bucket": b, "q": round(q, 2), "n_prev": int(len(prev))})
    cal = P.dropna(subset=["q"])
    inside_raw = (cal.y_target >= cal.p10) & (cal.y_target <= cal.p90)
    inside = (cal.y_target >= cal.lo_c) & (cal.y_target <= cal.hi_c)
    seasons = season(pd.to_datetime(cal.ts_target, utc=True))
    final_q = {b: round(conformal_q(P[P.bucket == b].score.to_numpy()), 2) for b in BUCKETS}
    out = {
        "method": "split-conformal (CQR) per horizon bucket; fold k uses scores from folds before k",
        "evaluated_months": months[1:],
        "uncalibrated_first_fold": months[0],
        "coverage_before": {
            "overall": round(float(inside_raw.mean()), 3),
            **{b: round(float(inside_raw[cal.bucket == b].mean()), 3) for b in BUCKETS},
        },
        "coverage_after": {
            "overall": round(float(inside.mean()), 3),
            **{b: round(float(inside[cal.bucket == b].mean()), 3) for b in BUCKETS},
            **{s: round(float(inside[seasons == s].mean()), 3) for s in sorted(seasons.unique())},
        },
        "mean_width_before": round(float((cal.p90 - cal.p10).mean()), 1),
        "mean_width_after": round(float((cal.hi_c - cal.lo_c).mean()), 1),
        "per_fold": per_fold,
        "final_q_all_folds": final_q,
    }
    OUT.write_text(json.dumps(out, indent=1), encoding="utf-8")
    rep = json.loads(REPORT.read_text(encoding="utf-8"))
    rep["band_coverage_80_calibrated"] = {
        k: out[k] for k in ("method", "coverage_before", "coverage_after", "final_q_all_folds")
    }
    REPORT.write_text(json.dumps(rep, indent=1, ensure_ascii=False), encoding="utf-8")
    return out
