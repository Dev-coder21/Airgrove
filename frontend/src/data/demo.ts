/**
 * Demo data source: the reference's sample generator, unchanged in behaviour.
 * A November week shaped like 2025, with a crop-smoke episode over the north.
 */
import { clamp, rng } from '../core/util';
import type { AirData, CitySeries, Fire } from './types';

const HRS = 240, NOW = 167, NOW_MS = Date.UTC(2025, 10, 14, 8, 30);
function hIST(i: number): number {
  return (((NOW_MS / 3600e3 + 5.5 + (i - NOW)) % 24) + 24) % 24;
}

interface Seed {
  id: string; n: string; lat: number; lon: number; base: number; amp: number; smoke: number;
  st: number; lab?: 1; left?: 1; ready?: 0;
}
const SEEDS: Seed[] = [
  { id: 'delhi', n: 'Delhi', lat: 28.61, lon: 77.21, base: 120, amp: 0.38, smoke: 170, st: 35, lab: 1 },
  { id: 'chandigarh', n: 'Chandigarh', lat: 30.73, lon: 76.78, base: 80, amp: 0.34, smoke: 110, st: 3, lab: 1 },
  { id: 'amritsar', n: 'Amritsar', lat: 31.63, lon: 74.87, base: 95, amp: 0.34, smoke: 120, st: 2 },
  { id: 'jaipur', n: 'Jaipur', lat: 26.91, lon: 75.79, base: 78, amp: 0.32, smoke: 40, st: 6, lab: 1, left: 1 },
  { id: 'lucknow', n: 'Lucknow', lat: 26.85, lon: 80.95, base: 110, amp: 0.36, smoke: 95, st: 6, lab: 1 },
  { id: 'varanasi', n: 'Varanasi', lat: 25.32, lon: 82.97, base: 105, amp: 0.34, smoke: 70, st: 4 },
  { id: 'patna', n: 'Patna', lat: 25.59, lon: 85.14, base: 118, amp: 0.36, smoke: 60, st: 6, lab: 1 },
  { id: 'kolkata', n: 'Kolkata', lat: 22.57, lon: 88.36, base: 82, amp: 0.32, smoke: 0, st: 7, lab: 1 },
  { id: 'guwahati', n: 'Guwahati', lat: 26.14, lon: 91.74, base: 62, amp: 0.3, smoke: 0, st: 3, lab: 1 },
  { id: 'shillong', n: 'Shillong', lat: 25.58, lon: 91.89, base: 17, amp: 0.25, smoke: 0, st: 1, ready: 0 },
  { id: 'ahmedabad', n: 'Ahmedabad', lat: 23.02, lon: 72.57, base: 68, amp: 0.32, smoke: 0, st: 9, lab: 1, left: 1 },
  { id: 'bhopal', n: 'Bhopal', lat: 23.26, lon: 77.41, base: 70, amp: 0.3, smoke: 15, st: 3 },
  { id: 'mumbai', n: 'Mumbai', lat: 19.08, lon: 72.88, base: 56, amp: 0.3, smoke: 0, st: 25, lab: 1, left: 1 },
  { id: 'pune', n: 'Pune', lat: 18.52, lon: 73.86, base: 50, amp: 0.3, smoke: 0, st: 8 },
  { id: 'hyderabad', n: 'Hyderabad', lat: 17.39, lon: 78.49, base: 46, amp: 0.3, smoke: 0, st: 13, lab: 1, left: 1 },
  { id: 'vizag', n: 'Visakhapatnam', lat: 17.69, lon: 83.22, base: 40, amp: 0.28, smoke: 0, st: 1, ready: 0 },
  { id: 'bengaluru', n: 'Bengaluru', lat: 12.97, lon: 77.59, base: 27, amp: 0.28, smoke: 0, st: 10, lab: 1, left: 1 },
  { id: 'chennai', n: 'Chennai', lat: 13.08, lon: 80.27, base: 29, amp: 0.28, smoke: 0, st: 8, lab: 1 },
  { id: 'kochi', n: 'Kochi', lat: 9.93, lon: 76.27, base: 20, amp: 0.26, smoke: 0, st: 2 },
  { id: 'tvm', n: 'Thiruvananthapuram', lat: 8.52, lon: 76.94, base: 16, amp: 0.25, smoke: 0, st: 2, lab: 1 },
];

const FIRE = [0.35, 0.55, 0.9, 1, 0.85, 0.6, 0.45, 0.4, 0.3, 0.25, 0.2];
function F(i: number): number {
  return FIRE[clamp(Math.floor((i + 14) / 24), 0, 10)];
}
function smokeAt(i: number): number {
  return 0.6 * F(i - 36) + 0.4 * F(i - 60);
}

export function demoData(): AirData {
  const cities: CitySeries[] = SEEDS.map((c, ci) => {
    const r = rng(ci * 977 + 13), ph = r() * 6.28;
    let n = 0;
    const obs = new Float32Array(HRS), det = new Float32Array(HRS), fc = new Float32Array(HRS),
      lo = new Float32Array(HRS), hi = new Float32Array(HRS);
    for (let i = 0; i < HRS; i++) {
      const h = hIST(i), diur = 1 + c.amp * Math.cos((2 * Math.PI * (h - 1)) / 24), ep = 1 + 0.22 * Math.sin(i / 38 + ph);
      const s = c.smoke ? smokeAt(i) : 0;
      const d = c.base * diur * ep + c.smoke * s * (1 + 0.3 * Math.cos((2 * Math.PI * (h - 2)) / 24));
      n = 0.88 * n + 0.12 * (r() * 2 - 1) * 1.6;
      det[i] = d;
      obs[i] = Math.max(4, d * (1 + n * 0.35));
    }
    const nNow = obs[NOW] / det[NOW] - 1;
    for (let k = NOW; k < HRS; k++) {
      const hz = k - NOW, f = det[k] * (1 + nNow * Math.exp(-hz / 14)), w = 0.1 + 0.0045 * hz;
      fc[k] = f; lo[k] = f * (1 - w); hi[k] = f * (1 + w * 1.25);
    }
    fc[NOW] = lo[NOW] = hi[NOW] = obs[NOW];
    // weather readings
    const windKmh = new Float32Array(HRS), rh = new Float32Array(HRS), mixM = new Float32Array(HRS);
    const dir = c.smoke ? 'NW' : c.lat < 20 ? 'SE' : 'E';
    for (let i = 0; i < HRS; i++) {
      const h = hIST(i), day = Math.max(0, Math.sin((Math.PI * (h - 6)) / 12)), s = c.smoke ? smokeAt(i) : 0;
      windKmh[i] = Math.round(3 + 7 * day + 2 * Math.sin(i / 9 + c.lat));
      rh[i] = Math.round(56 + 28 * (1 - day));
      mixM[i] = Math.round((180 + 1250 * day * (1 - 0.45 * s)) / 10) * 10;
    }
    return {
      id: c.id, name: c.n, lat: c.lat, lon: c.lon, stations: c.st, ready: c.ready !== 0,
      label: !!c.lab, labelLeft: !!c.left, obs, fc, lo, hi,
      windKmh, windDir: new Array(HRS).fill(dir), rh, mixM,
    };
  });

  const fires: Fire[] = [];
  {
    const r = rng(4242), tot = FIRE.reduce((a, b) => a + b, 0);
    for (let k = 0; k < 190; k++) {
      let u = r() * tot, d = 0;
      while (u > FIRE[d] && d < 10) { u -= FIRE[d]; d++; }
      const west = r() < 0.18;
      // evaluation order matches the reference so the sample fires land in the same places
      const lat = west ? 30 + r() * 1.8 : 29.4 + r() * 2.5;
      const lon = west ? 72.6 + r() * 1.5 : 74.3 + r() * 3.1;
      const i = d * 24 - 14 + 11 + Math.floor(r() * 7);
      const frp = 5 + r() * 55;
      fires.push({ lat, lon, i, frp, ph: r() * 6.28 });
    }
  }

  const smoke = new Float32Array(HRS);
  for (let i = 0; i < HRS; i++) smoke[i] = smokeAt(i);

  return {
    source: 'demo',
    tag: 'Sample data',
    footer: 'This demo runs on sample data shaped like a November week in 2025.',
    cardSource: 'CPCB stations via OpenAQ · sample data',
    hours: HRS, now: NOW, nowMs: NOW_MS, cities, fires, smoke,
    backtest: {
      eyebrow: 'Delhi backtest · last 12 months, re-trained monthly',
      scope: 'Delhi',
      coverage: 0.78,
      lede: 'Average error in µg/m³, lower is better. Each forecast was made only with data available at that moment, then compared with three simpler ways to predict the air.',
      notes: [
        'In October and November, "same hour yesterday" beats it 2–3 days ahead (53 vs 60). Its 10 worst days are all smoke spikes it underestimated, like the day after Diwali: 281 observed, 139 forecast.',
        'The 80% range held the real value 78% of the time, so the band means what it says.',
        'CAMS is the official global forecast, shown here without local bias correction. A corrected version closes much of the gap; both appear in the full report.',
      ],
    },
    model: [
      { name: 'Airgrove model', mae: [15.2, 23.8, 30.7], color: '#eef0e4', ours: true },
      { name: 'Persistence (last value)', mae: [23.5, 36.5, 41.8], color: '#a9c29a' },
      { name: 'Same hour yesterday', mae: [28.3, 28.2, 34.8], color: '#6f8f66' },
      { name: 'CAMS, raw', mae: [48.7, 48.2, 48.4], color: '#8a7f6a' },
    ],
  };
}
