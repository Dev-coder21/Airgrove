/**
 * Real data: the static export (frontend/public/data/bundle.json, written by
 * `python tasks.py export`), or the same payload from the API (/api/bundle).
 */
import type { AirData, CitySeries, Fire } from './types';

interface BundleCity {
  id: string; name: string; state: string | null; lat: number; lon: number; stations: number;
  forecast_ready: boolean;
  observed: (number | null)[]; forecast: (number | null)[]; p10: (number | null)[]; p90: (number | null)[];
  wind_kmh: (number | null)[]; wind_dir: (string | null)[]; rh: (number | null)[]; mixing_height_m: (number | null)[];
}
interface Bundle {
  now: string; now_index: number; hours: number; start: string;
  cities: BundleCity[];
  fires: { lat: number; lon: number; frp: number; pbhr: boolean; i: number }[];
  smoke: number[];
  model: { rows: { name: string; mae: [number, number, number]; color: string; ours: boolean }[]; coverage: number;
    scope: string; notes: [string, string, string]; eyebrow: string };
  source_note: string;
}

const fmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

/** Display arrays need a value at every hour: carry the last reading forward over gaps (and the
 * first one back over a leading gap). The API keeps the gaps as null. */
function fillForward(a: (number | null)[], upto: number): Float32Array {
  const out = new Float32Array(a.length).fill(NaN);
  let last = NaN;
  for (let i = 0; i <= upto && i < a.length; i++) {
    const v = a[i];
    if (v !== null && v !== undefined) last = v;
    out[i] = last;
  }
  const first = out.findIndex((v) => !Number.isNaN(v));
  if (first > 0) for (let i = 0; i < first; i++) out[i] = out[first];
  return out;
}
function arr(a: (number | null)[]): Float32Array {
  return Float32Array.from(a, (v) => (v === null || v === undefined ? NaN : v));
}
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return ((h >>> 0) % 10000) / 10000;
}

export async function staticData(url: string): Promise<AirData> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  const b: Bundle = await r.json();
  const NOW = b.now_index, HRS = b.hours;
  const nowMs = Date.parse(b.now);
  const ranked = [...b.cities].sort((a, c) => c.stations - a.stations);
  const labelled = new Set(ranked.slice(0, 16).map((c) => c.id));
  const cities: CitySeries[] = b.cities
    .filter((c) => c.observed.some((v) => v !== null))
    .map((c) => {
      const obs = fillForward(c.observed, NOW);
      for (let i = NOW + 1; i < HRS; i++) obs[i] = obs[NOW];
      const fc = arr(c.forecast), lo = arr(c.p10), hi = arr(c.p90);
      fc[NOW] = lo[NOW] = hi[NOW] = obs[NOW];
      // cities forecast from a slightly earlier hour end up to 6 h short: hold the last value
      for (let i = NOW + 1; i < HRS; i++) if (Number.isNaN(fc[i])) { fc[i] = fc[i - 1]; lo[i] = lo[i - 1]; hi[i] = hi[i - 1]; }
      const ready = c.forecast_ready && !Number.isNaN(fc[NOW + 1]);
      const w = (a: (number | null)[]) => fillForward(a, HRS - 1);
      const dirs: string[] = [];
      let lastDir = '—';
      for (let i = 0; i < HRS; i++) { lastDir = c.wind_dir[i] ?? lastDir; dirs.push(lastDir); }
      return {
        id: c.id, name: c.name, lat: c.lat, lon: c.lon, stations: c.stations, ready,
        label: labelled.has(c.id), labelLeft: c.lon < 76,
        obs, fc: ready ? fc : obs, lo: ready ? lo : obs, hi: ready ? hi : obs,
        windKmh: w(c.wind_kmh), windDir: dirs, rh: w(c.rh), mixM: w(c.mixing_height_m),
      };
    });
  const fires: Fire[] = b.fires.map((f) => ({ lat: f.lat, lon: f.lon, i: f.i, frp: f.frp, pbhr: f.pbhr, ph: hash(`${f.lat},${f.lon},${f.i}`) * 6.28 }));
  return {
    source: 'static',
    tag: `Latest reading ${fmt.format(nowMs)} IST`,
    footer: `Latest reading ${fmt.format(nowMs)} IST (CPCB data reaches OpenAQ about 1.5 days late). Forecast and backtest by Airgrove; ${b.model.scope}.`,
    cardSource: b.source_note,
    hours: HRS, now: NOW, nowMs, cities, fires, smoke: Float32Array.from(b.smoke),
    model: b.model.rows.map((m) => ({ name: m.name, mae: m.mae, color: m.color, ours: m.ours })),
    backtest: {
      eyebrow: b.model.eyebrow, scope: b.model.scope, coverage: b.model.coverage, notes: b.model.notes,
      lede: 'Average error in µg/m³, lower is better. Each forecast was made only with data available at that moment, then compared with four other ways to predict the air.',
    },
  };
}
