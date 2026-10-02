# Progress

## Step 1: repo setup
- Works: git repo, .gitignore, .env.example, venv (`python tasks.py setup`), ruff, pytest,
  `shared/aqi.json` (CPCB PM2.5 breakpoints + reference colours) with `airgrove.aqi` and tests.
- To check: `.env` filled with OPENAQ_API_KEY and FIRMS_MAP_KEY (never committed).

## Step 2: frontend port (demo data)
- Works: `frontend/` Vite + TS + three r128 port of the reference, split into `scene/` (forest),
  `globe/`, `card/`, `ui/` (hero, river, controls, india, forecast, model, chrome buttons, intro,
  headline, headings, scroll + vine), `data/` (single `AirData` interface; `demo.ts` = the reference
  generator), `core/` (aqi from `shared/aqi.json`, time, utils). `python tasks.py dev` → http://localhost:5173.
- Checked against the reference by DOM/text/style diff (771 elements, 2 cities × 7 times, scroll
  reveals both ways, play buttons, city list): identical apart from the deliberate changes below.
- Deliberate differences: AQI category uses the rounded value (reference put e.g. 30.4 in
  "Satisfactory" while showing "30"); globe "couldn't load" message no longer shows over a working
  globe (reference CSS bug); card peak/cleanest no longer NaN at the last hour; intro waits for a
  non-zero viewport; `<meta charset="utf-8">` added.
- To check by eye: forest/globe/card motion side by side (rAF paused in my headless check);
  `prefers-reduced-motion` (ported flag-for-flag, not tested in a browser).
- Reference still has hard-coded copy to make data-driven later: model notes, "78%", "Delhi backtest".

## Step 3: OpenAQ discovery + coverage (no full history yet)
- Works: `backend/airgrove/ingest/openaq.py`: sliding-window limiter (50 req/min), backs off on
  429 / 5xx / 408 and when `x-ratelimit-remaining` is low, every raw response cached under
  `data/raw/openaq/` (re-runs cost 0 requests). `ingest/discover.py` + `python tasks.py coverage`
  writes `reports/coverage.json`, `reports/coverage.md`, `data/stations.json`.
- Key numbers: 754 PM2.5 locations in India → 640 CPCB → **492 active** (reported within 30 days
  of the latest reading, 2026-09-29 14:30 UTC) → **257 cities**, **177 forecast-ready**
  (381 stations). Not ready: 80 (63 under 75% coverage, 44 under 12 months; some both).
  Coverage run cost 784 requests.
- History: current sensors start **Feb 2025** for most cities (204 of 257); older 2016–18 sensors
  are separate and followed by a 7-year gap, so they are ignored. So ~20 months of history.
- Coverage = observed hours / real hours in the last 12 months, from monthly aggregates
  (OpenAQ's own `expectedCount` is unreliable, sometimes doubled). City = mean over its stations.
  Best stations reach ~90%; nothing reaches 100%.
- **Hour alignment (the old midnight bug):** OpenAQ hourly periods are IST clock hours, so in
  UTC they start at :30 (00:00 IST = 18:30Z; the period containing 00:00 UTC is 23:30Z–00:30Z,
  = 05:00 IST). Never floor/round to UTC hours; key rows by period start; fetch windows padded
  ±2 h and de-duplicated. `python tasks.py hourcheck` (R K Puram, Delhi, 24–26 Sep 2026 IST):
  71/72 hours, all 24 hours of day present incl. 00:00 IST and 00:00 UTC; one genuine gap
  (26 Sep 20:00 IST).
- To check: city grouping is by station name ("Station, City - AGENCY") with a few aliases
  (Belapur→Navi Mumbai, Vatva→Ahmedabad, spellings). NCR cities (Noida, Gurugram, Ghaziabad,
  Faridabad) are kept separate from Delhi. Weather (Open-Meteo) is on whole UTC hours: features
  must be interpolated to the :30 period, decide in step 4.

## Step 4: full download + cleaning
- Commands: `python tasks.py download` (resumable, cached, safe to stop), `python tasks.py clean`
  (builds `data/airgrove.duckdb`, writes `reports/cleaning.md` / `.json`).
- Two-sensor stations (292): the second PM2.5 sensor is an older instrument whose data ends by
  Oct 2022; the current sensor starts Feb 2025. Never overlap; we use only the current sensor
  (one sensor per station, rows unique on (sensor, hour)). Pusa IMD and Pusa DPCC share
  coordinates but are different instruments (clean data: r = 0.88, median |diff| 15 ug/m3), so
  both are kept. Neither disagrees persistently with the Delhi median (r 0.91 / 0.93; IMD reads
  16% low, DPCC 8% low); the check is in `reports/cleaning.md` for all 38 Delhi stations
  (9 flagged: > 30% off for 3+ consecutive months, e.g. Jahangirpuri +31%, NSIT Dwarka r = 0.53).
- OpenAQ: 489/492 stations (3 observed-only stations fail server-side every time; logged,
  retried on the next run), 4.59 M station-hours, ~7,800 requests.
- Weather: Open-Meteo historical-forecast, all 257 cities (full period for the 177 ready ones,
  15 days for the rest), mapped onto :30 periods (period mean of the interpolated curve; wind via
  u/v; precipitation split over the two hours).
- CAMS: available **2022-08-04 → today+5 d**; downloaded for the 177 cities. Only a stitched
  short-lead series exists (`pm2_5_previous_day1..3` are empty), so the CAMS baseline is
  optimistic at 25-72 h. Say so in the backtest.
- Fires (revised, step 4b): **NOAA-20 VIIRS is the single source**: it has data on all 606
  days 2025-01-29 → 2026-09-29 (median daily count = S-NPP's). S-NPP fills only NOAA-20's own
  gaps: no zero days, 2 partial days (2025-06-21: 45 vs 259; 2026-02-09: 166 vs 572). Never two
  satellites on one day, so no de-duplication needed; `source` column per detection.
  364,294 points. Monthly before/after in `reports/fires_before_after.csv` (+3% overall).
  (S-NPP itself is missing 47 days, incl. 28 Apr - 2 Jun 2026.)
- Cleaning (177 cities): median 84.5% of hours have a city value (range 33-91%); 3,711 stuck
  runs (70,037 station-hours) removed; 371 out-of-range values; 31,846 single-hour gaps filled.
- **Midnight:** 00:00 IST has ~9% fewer station-hours than other hours. Traced to the source:
  on 65 nights the raw 15-min CPCB data itself stops ~23:45 IST and resumes ~01:30 IST across
  165-360 stations (checked IGI Airport T3, 17-18 Dec 2025). Not our windows (they don't fall on
  month edges). City-level single-hour fill repairs most of them.
- No city exceeds ~91% because of national outages (1,187 hours with zero stations: data starts
  18 Feb 2025; big gaps in Jan 2026).
- To check: the 75%-of-stations rule is strict for small cities (Rourkela 3/3 needed → 33%);
  some 1-station Haryana cities sit at ~50% over the full period. Consider in step 5.

## Step 5: QC rules, features, model, backtest
- Station-month QC (user choice): a station flagged for persistent disagreement (> 30% off the
  others' median for 3+ consecutive months) loses the months where it is > 30% off AND the
  daily-mean correlation with that median is < 0.7. 503 station-months / 302k station-hours
  excluded; list in `reports/cleaning.md`. Delhi: NSIT Dwarka 8, Shadipur 6, Mandir Marg 3,
  Anand Vihar 2, Bawana 2, IGI T3 1. (Hourly r < 0.7 is normal in ~half of all station-months,
  so it could not be the test.)
- City-hour valid if >= min(50% of stations, 2) report. % hours now: Delhi 92.0, Mumbai 91.6,
  Chennai 90.6, Indore 88.1, Gurugram 58.2, Rourkela 42.8 (median of 177 cities 86.4).
- City value = mean of station values / each station's typical ratio to the city mean
  (ratios from training hours only, per fold). n_stations reporting is a feature.
- `features.py` (dense city x hour grid), `backtest.py`; `python tasks.py backtest` (~65 min,
  resumable per fold in data/backtest_folds/, writes reports/backtest.json).
- Backtest: 12 monthly folds Oct 2025 - Sep 2026, 4.86 M scored rows (177 cities, origins every
  3 h, 21 horizons). Only 31-71% of origins have complete input history (skipped, not filled).
- **MAE (ug/m3), Airgrove / persistence / same hour yesterday / CAMS raw / CAMS bias-corr:**
  1-6 h 10.8 / 13.5 / 15.1 / 25.6 / 20.2; 7-24 h 13.6 / 18.5 / 15.1 / 25.7 / 20.3;
  25-72 h 15.6 / 21.0 / 18.3 / 26.0 / 20.6. AQI category hit rate 0.73 / 0.67 / 0.63 at the
  three buckets (persistence 0.69 / 0.60 / 0.56).
- Where it loses: 1 h ahead persistence wins (6.7 vs 7.4); post-monsoon 7-24 h same hour
  yesterday ties/wins (19.4 vs 19.5); Delhi 7-24 h only 29.9 vs 30.5; 4 small cities
  (Byrnihat, Hapur, Kannur, Satna) lose overall to the best simple baseline. Bias -4 ug/m3.
- 80% band holds 74.7% (post-monsoon 70%): slightly too narrow.
- Fire ablation: **fire features don't help** (Oct-Dec north India 25-72 h: 27.40 with vs 27.39
  without). National vs per-city: national better in Mumbai/Hyderabad/Ahmedabad/Chennai;
  per-city slightly better in Delhi at 7-72 h (29.5 vs 29.9, 34.7 vs 35.5).
- Leakage checks passed (future-perturbation of PM and fires leaves features unchanged; training
  targets end before each test month; ratios/medians/CAMS fit from training only). Caveats in the
  report: CAMS archive = latest run per hour (not true 1-3 day leads); weather at target comes
  from stitched short-range forecasts, so long-horizon skill is somewhat optimistic for both.
- To check next: why fires add nothing (FIRMS latency, 600 km/±45° too broad, smoke transport
  > 72 h?); widen the band (conformal calibration per horizon); Delhi-specific features.
