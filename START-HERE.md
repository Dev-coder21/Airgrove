# Starting Airgrove in Claude Code

## Before you open Claude Code (15 minutes)

1. Check tools in a terminal: `python --version` (3.11+), `node --version` (18+), `git --version`.
2. Get two free keys:
   - OpenAQ: sign up at explore.openaq.org → account → API key
   - NASA FIRMS: firms.modaps.eosdis.nasa.gov/api/map_key
3. Unzip this folder somewhere simple, e.g. `C:\projects\airgrove`.
4. Open Claude Code in that folder.

Paste the prompts below one at a time. Read what it reports before sending the next one.

---

## Prompt 1: setup

```
Read CLAUDE.md and open reference/airgrove-final.html. Set up the repo: git init, .gitignore
(data/, .env, caches, node_modules, .venv, __pycache__, .claude/), .env.example and an empty .env
with OPENAQ_API_KEY= and FIRMS_MAP_KEY=, a Python venv with requirements, tasks.py, ruff, pytest,
and shared/aqi.json. Then tell me to fill in .env. Commit.
```

→ Open `.env` yourself and paste both keys. Don't paste keys into the chat.

## Prompt 2: frontend port (do this first, on sample data)

```
Port reference/airgrove-final.html into a Vite + TypeScript + Three.js app in frontend/, split into
modules (scene, globe, card, ui, data). It must look and behave exactly like the reference. Keep the
reference's sample data generator as the "demo" data source. Run it, open both side by side and list
any differences, then fix them. Commit.
```

→ Open the dev server URL and the reference file side by side yourself. This is the moment to catch
anything that looks different.

## Prompt 3: coverage check

```
Build the OpenAQ ingest with the rate limiter and raw cache. Discover all Indian PM2.5 CPCB hourly
stations and group them into cities. Write reports/coverage.json and show me a table: city, stations,
history start, % hours covered, forecast-ready yes/no. Do NOT download full history yet. Also verify
that every hour of the day, including 00:00, appears in a test fetch. Commit.
```

→ **Send me that coverage table.** We'll decide together which cities to keep before the long download.

## Prompt 4: full data download

```
Download full hourly history for the cities we kept, plus Open-Meteo historical-forecast weather,
CAMS from the Open-Meteo air-quality API, and NASA FIRMS fires for north India. Make it resumable and
safe to stop. Then run cleaning and show me row counts and coverage per city. Commit.
```

→ This can take several hours. Keep the computer awake. If it stops, run the same prompt again.

## Prompt 5: model and backtests

```
Build features (including upwind fire features), the national LightGBM model with p10/p90, and the
rolling-origin backtest exactly as in CLAUDE.md. Check for leakage before reporting. Show me:
the accuracy table by horizon vs all four baselines, per-city results, band coverage, the fire
ablation, and national vs per-city models. Write reports/backtest.json. Commit.
```

→ **Send me the results.** I'll help you check them before they go on the site.

## Prompt 6: connect real data

```
Add the API endpoints from CLAUDE.md and `python tasks.py export` for static JSON. Switch the frontend
from demo data to real data (keep ?demo). Make captions, rankings, fire counts and "× daily limit"
come from data; label "now" as the latest reading time; label the 60 µg/m³ line as the 24-hour
standard. Use real backtest numbers in the model section and the card's back. Commit.
```

## Prompt 7: tests and polish

```
Write tests: pytest for cleaning, AQI, features, leakage; Playwright smoke tests for the page,
time slider, globe and card. Run everything, fix failures. Write README.md (pitch, how it works,
results table, limitations, how to run). Check git history for secrets. Commit. Don't push.
```

Then create an empty GitHub repo, give Claude Code the link, and ask it to push and set up GitHub
Pages from the exported data.
