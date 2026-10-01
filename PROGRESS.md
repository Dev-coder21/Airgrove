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
