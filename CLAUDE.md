# Airgrove

Air quality over every Indian city with a government sensor, shown as a living 3D forest,
with a PM2.5 forecast model for the next 72 hours that is tested honestly against simple
baselines and the official CAMS forecast.

Portfolio project for data science / analytics / software roles. Free services only: no paid
APIs, no billing. Developed on Windows (no `make`; use `python tasks.py <command>`).

## The one rule about the frontend

`reference/airgrove-final.html` is the finished frontend. The real site must look and behave
**exactly** like it: same layout, copy, typography (Lexend 300/400), colours, motion and
interactions. Only the data changes: the demo's generated sample data is replaced by real data.
If anything in this file seems to conflict with the reference on a visual point, the reference wins.

What the reference contains (keep all of it):
- Opening: "Airgrove" wordmark lit by a root network, a flower opens in the "o" (skippable)
- Hero: the Three.js forest (moss, roots, ferns, pale flowers, pollen, butterfly) driven by PM2.5:
  fog, flowers closing, ferns drying, pollen → grey dust, orange light, butterfly leaves at Severe
- Particle-wordmark headline that changes with the AQI category; advice line; PM2.5 panel
- Time slider ("time river"): past 7 days + next 72 h forecast with uncertainty band, play button
- City switcher with fog transition; liquid-chrome WebGL buttons; vine scroll bar with section leaves
- India section: summary strip, 3D globe (dark sphere, white grid, dotted land, white coastlines,
  Indian cities with value labels, light pillars sized by PM2.5, crop fires, smoke drift, story
  captions, zoom/spin/India button), ranked city bars with India's 60 µg/m³ line, smoke-week player
- Air card: wavy 3D paper card, liquid-glass PM2.5 badge, front = city summary, back = model accuracy
- Forecast chart (3 days observed + 72 h forecast, 80% band) and three fact tiles
- Model section: accuracy table + bar chart + three notes
- Scroll animations that replay in both directions; footer wordmark that fills at the bottom
- `prefers-reduced-motion` support throughout

## Data sources (all free)

| Source | Use | Notes |
| --- | --- | --- |
| OpenAQ API v3 `https://api.openaq.org/v3` | Hourly PM2.5 from CPCB stations, all India | Free key, header `X-API-Key`. Limit 60 req/min, 2,000 req/hour. Stay ≤ 50/min with a client-side limiter. Repeated 429s can get the key banned. Cache every raw response on disk. Data arrives ~1.5 days late. |
| Open-Meteo historical-forecast + forecast APIs | Weather features: temperature, RH, wind speed/direction, precipitation, boundary_layer_height | No key, non-commercial. Use *forecast* weather for features (not observed) to avoid leakage. |
| Open-Meteo Air Quality API `/v1/air-quality` | CAMS PM2.5 forecast as a **baseline only** | No key. ≤ 92 past days available. |
| NASA FIRMS Area API | Crop-fire points (VIIRS) over north India & Pakistan Punjab (≈70–85°E, 24–33°N) | Free MAP_KEY. 5,000 transactions / 10 min, max 5 days per request. SP archive for history, NRT for recent. |

Keys live in `.env` (`OPENAQ_API_KEY=`, `FIRMS_MAP_KEY=`). Commit only `.env.example`.

## Known pitfalls (learned from an earlier attempt)

- **Midnight hour went missing** in an earlier ingest (~92% of 00:00 rows). Almost certainly our
  fetch-window or timezone handling, not OpenAQ. Use overlapping, UTC-aligned windows and test that
  every hour of the day appears.
- **Predict the change from the latest reading**, not the absolute level. The absolute-level model
  lost to persistence.
- **Month / day-of-year features hurt** with < 2 years of data (they just identify the year). Leave
  them out unless the backtest shows they help.
- **Raw CAMS has a large constant bias** at these sites. Report raw CAMS *and* a bias-corrected CAMS
  (correction fitted only on each fold's training data). Never claim to beat an operational 72 h
  forecast without that.
- OpenAQ Delhi history starts around Feb 2025, so the test year covers one winter. Say so.
- Early test folds were trained without any winter data. Explain the Oct–Nov weakness with this.

## Indian AQI for PM2.5 (CPCB NAQI, µg/m³)

Good 0–30 · Satisfactory 31–60 · Moderate 61–90 · Poor 91–120 · Very Poor 121–250 · Severe 251+.
Keep in one shared file `shared/aqi.json` used by backend and frontend. The 60 µg/m³ line is India's
**24-hour** standard; label it that way when comparing hourly values.

## Stack

- Backend: Python 3.11+, FastAPI, httpx, pandas, DuckDB (`data/airgrove.duckdb`), LightGBM,
  scikit-learn, SHAP, pytest, ruff. Commands via `tasks.py`.
- Frontend: Vite + TypeScript + Three.js (no React). Port the reference into modules.
- Output for hosting: static JSON export so the site runs on GitHub Pages with no server.

## Repo layout

```
airgrove/
  backend/airgrove/
    ingest/   openaq.py, openmeteo.py, firms.py   (fetch → raw cache → DuckDB, resumable)
    clean.py  features.py  model.py  backtest.py  aqi.py  api.py  export.py
  frontend/src/
    scene/ (forest)  globe/  card/  ui/ (buttons, scrollbar, text effects)  data/ (API + static + demo)
  shared/aqi.json
  data/       (gitignored)
  reports/    coverage.json, backtest.json, figures
  reference/airgrove-final.html
  tasks.py  PROGRESS.md  README.md
```

## Pipeline

1. **Discover** every OpenAQ location in India reporting PM2.5 from CPCB hourly stations; group into
   cities (name, state, lat, lon, station list).
2. **Coverage report** `reports/coverage.json`: per city: stations, history start, % hours covered.
   A city is *forecast-ready* with ≥ 75% coverage and ≥ 12 months of history. Others appear on the
   globe as "observed only".
3. **Download** full hourly history (resumable, cached), weather, CAMS, FIRMS fires.
4. **Clean:** drop negatives and > 1,000 µg/m³, flag stuck sensors (same value 6+ h), city-hour
   needs ≥ 75% of its stations reporting, fill only single-hour gaps.
5. **Features:** lags 1/2/3/6/12/24/48/168 h, rolling mean/std 6/24/72 h, hour, weekday, festival
   flags (Diwali, Holi, New Year), forecast weather at target hour (wind u/v, temp, RH, rain,
   boundary-layer height), city id (categorical), lat/lon, city median PM2.5 from training data,
   **upwind fires**: count and summed FRP in last 24/48/72 h within ±45° of the wind direction and
   600 km.
6. **Model:** one national LightGBM, direct multi-horizon (horizon as a feature), target = change
   from latest reading; p10/p90 quantile models for the band.
7. **Backtest:** rolling-origin, monthly re-train, last 12 months. Baselines: persistence, same hour
   yesterday, raw CAMS, bias-corrected CAMS. Report MAE/RMSE and AQI-category hit rate by horizon
   (1–6, 7–24, 25–72 h), by city and by season; 80% band coverage; fire-feature ablation
   (with vs without, Oct–Dec vs rest); national vs per-city model for the 5 biggest cities.

## API (and identical static JSON files)

- `/api/cities` → id, name, state, lat, lon, stations, forecast_ready
- `/api/series?city=` → hourly rows for past 168 h + next 72 h:
  `ts, observed, forecast, p10, p90, wind_kmh, wind_dir, rh, mixing_height_m`
- `/api/map?ts=` → every city's PM2.5 and category at that hour (observed or forecast)
- `/api/fires?from=&to=` → `lat, lon, ts, frp`
- `/api/model/report` → per-city and overall metrics for model + all baselines, band coverage,
  ablations
- `python tasks.py export` writes all of the above to `frontend/public/data/` for static hosting.

The frontend's "now" is the **latest available reading**, labelled with its timestamp, never "live".
Story captions, rankings, fire counts and "× daily limit" text must be computed from data.

## Conventions

- Timestamps stored in UTC, shown in Asia/Kolkata.
- Never re-fetch data already cached. All long jobs resumable.
- Commit after every working step; update PROGRESS.md (what works, key numbers, what to check).
- No secrets in git. Check history before any push.
