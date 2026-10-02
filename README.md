# Airgrove

**Air quality over every Indian city with a government sensor, shown as a living 3D forest — with a
72-hour PM2.5 forecast that is tested honestly against simple baselines and the official CAMS
forecast.**

Each city is a grove: clean air keeps the flowers open and the pollen glowing; as PM2.5 rises the
fog thickens, ferns dry, pollen turns to grey dust and the butterfly leaves. The same numbers drive
a 3D globe of India's cities with crop fires from satellites, a time slider over the past week and
the next three days, and a model section that shows exactly where the forecast wins and loses.

## How it works

| Step | What | Code |
| --- | --- | --- |
| Discover | 492 active CPCB PM2.5 stations on OpenAQ, grouped into 257 cities; 177 have >= 75% coverage and >= 12 months of history (forecast-ready) | `backend/airgrove/ingest/discover.py` |
| Download | Hourly PM2.5 from Feb 2025 (rate-limited, cached, resumable), Open-Meteo forecast-archive weather, CAMS PM2.5, NASA FIRMS VIIRS fires (NOAA-20, S-NPP on its gap days) | `ingest/` |
| Clean | Range checks, stuck sensors (6+ h), station-month QC against the other stations, city-hour needs min(50% of stations, 2), station offsets removed | `clean.py` |
| Features | Lags 1-168 h, rolling stats, hour/weekday, festivals, weather at the target hour, upwind fires (600 km, ±45°), city id/median, stations reporting | `features.py` |
| Model | One national LightGBM, direct multi-horizon (1-72 h), target = change from the latest reading, p10/p50/p90 quantiles, conformally calibrated 80% band | `backtest.py`, `calibrate.py`, `forecast.py` |
| Serve | FastAPI (`/api/cities`, `/api/series`, `/api/map`, `/api/fires`, `/api/model/report`) and the same payloads as static JSON for GitHub Pages | `api.py`, `export.py` |
| Site | Vite + TypeScript + Three.js port of the design in `reference/airgrove-final.html` | `frontend/` |

```bash
python tasks.py setup
python tasks.py coverage      # discover stations, reports/coverage.json
python tasks.py download      # OpenAQ + weather + CAMS + fires (hours; resumable)
python tasks.py clean         # data/airgrove.duckdb, reports/cleaning.md
python tasks.py backtest      # 12 monthly folds (~65 min), reports/backtest.json
python tasks.py final         # calibrate bands, train the final model, forecast 72 h
python tasks.py export        # frontend/public/data/*.json
python tasks.py dev           # http://localhost:5173   (?demo for the sample data)
python tasks.py api           # http://localhost:8000/api/cities
```

Keys go in `.env` (`OPENAQ_API_KEY`, `FIRMS_MAP_KEY`); see `.env.example`. Everything else is free.

## Results

Rolling-origin backtest, Oct 2025 - Sep 2026, re-trained monthly; 177 cities, forecasts every 3 h,
4.86 M scored rows. Each forecast uses only data available at that moment; all methods are scored
on the same rows. MAE in µg/m³ (lower is better), AQI-category hit rate in brackets.

| Method | 1-6 h | 7-24 h | 25-72 h |
| --- | ---: | ---: | ---: |
| **Airgrove** | **10.8** (0.73) | **13.6** (0.67) | **15.6** (0.63) |
| Persistence (last value) | 13.5 (0.69) | 18.5 (0.60) | 21.0 (0.56) |
| Same hour yesterday | 15.1 (0.65) | 15.1 (0.65) | 18.3 (0.59) |
| CAMS, raw | 25.6 (0.47) | 25.7 (0.47) | 26.0 (0.47) |
| CAMS, bias-corrected (per city, training data only) | 20.2 (0.52) | 20.3 (0.51) | 20.6 (0.51) |

- 80% band: held the real value 75.5% of the time as trained; 84.1% after conformal calibration
  per horizon bucket (each month calibrated only on earlier months).
- Delhi (38 stations): 20.5 / 29.9 / 35.5 vs persistence 22.4 / 38.5 / 44.9 and same hour
  yesterday 29.5 / 30.5 / 38.1.
- National vs per-city models: the national model is better in Mumbai, Hyderabad, Ahmedabad and
  Chennai; a Delhi-only model is slightly better in Delhi at 7-72 h (29.5 vs 29.9).
- Full details (by city, season, horizon, leakage checks): `reports/backtest.json`,
  `reports/calibration.json`, `reports/cleaning.md`, `PROGRESS.md`.

## Limitations

- **One winter.** OpenAQ's current CPCB sensors start in Feb 2025, so the test year contains a
  single winter, and the first test months (Oct-Nov 2025) were trained without any winter data.
- **Long horizons look optimistic.** The weather features at the target hour come from Open-Meteo's
  archive of stitched short-range forecasts, and the CAMS archive keeps the latest run for each
  hour rather than true 1-3 day forecasts. Live 2-3 day forecasts will be less accurate than these
  numbers for both Airgrove and CAMS.
- **Fire features added nothing.** With vs without upwind fire features: 27.40 vs 27.39 µg/m³ MAE
  at 25-72 h in north India, Oct-Dec. They stay in the globe, but the model does not need them yet.
- **Persistence wins at 1 hour** (6.7 vs 7.4 µg/m³), and "same hour yesterday" matches the model
  7-24 h ahead in Oct-Nov. The model also reads about 4 µg/m³ low on average.
- **CPCB outages.** 1,187 hours have no station reporting anywhere in India (incl. most of Jan 2026),
  and on 65 nights the raw feed drops 23:45-01:30 IST across many stations. Hours with incomplete
  input history are skipped, not filled; only 31-71% of forecast origins per month were usable.
  At the latest reading, 140 of the 177 forecast-ready cities have the history needed to forecast
  (24 of them from their latest complete hour within 6 h); the rest show observations only.
- **"Now" is the latest available reading**, about 1.5 days behind real time (CPCB data reaches
  OpenAQ late). The site labels it with its timestamp and never calls it live.
- The 60 µg/m³ line is India's **24-hour** standard; comparisons with hourly values are indicative.

## Data

PM2.5: CPCB stations via [OpenAQ](https://openaq.org). Weather and CAMS: [Open-Meteo](https://open-meteo.com)
(non-commercial). Fires: [NASA FIRMS](https://firms.modaps.eosdis.nasa.gov) VIIRS. AQI bands: CPCB
National AQI (`shared/aqi.json`).
