import scale from '../../../shared/aqi.json';

export interface Cat {
  n: string;
  max: number;
  c: string;
}
/** CPCB NAQI PM2.5 bands, shared with the backend (shared/aqi.json). */
export const CATS: Cat[] = scale.categories.map((c) => ({
  n: c.name,
  max: c.max ?? 1e9,
  c: c.color,
}));
/** India's 24-hour PM2.5 standard, µg/m³. */
export const LIMIT: number = scale.standard_24h_ugm3;

/** Category index; values are rounded first, so the label always matches the number shown. */
export function catIdx(pm: number): number {
  const v = Math.round(pm);
  for (let i = 0; i < CATS.length; i++) if (v <= CATS[i].max) return i;
  return CATS.length - 1;
}

/** 0..1 "how bad it looks" used to drive the forest, buttons and card. */
const QK: [number, number][] = [[0, 0], [30, 0.12], [60, 0.28], [90, 0.42], [120, 0.56], [250, 0.86], [400, 1]];
export function qOf(pm: number): number {
  for (let i = 1; i < QK.length; i++) {
    if (pm <= QK[i][0]) {
      const a = QK[i - 1], b = QK[i];
      return a[1] + ((b[1] - a[1]) * (pm - a[0])) / (b[0] - a[0]);
    }
  }
  return 1;
}

export const HEAD = [
  'The grove is breathing easy.',
  'Clear air. The grove is growing.',
  'A haze is settling over the grove.',
  'The grove is thinning in the haze.',
  'The grove is holding its breath.',
  'The grove has gone quiet.',
];
export const ADVICE = [
  'Clean air. A good day to be outside, open the windows and let the house breathe.',
  'Fine for most people. If you have asthma you may notice mild breathing discomfort.',
  'People with asthma, lung or heart conditions, children and older adults should take it easier outdoors.',
  'Most people may feel breathing discomfort with long exposure. Keep outdoor exercise short.',
  'Long exposure can cause breathing illness. Stay indoors where you can, and wear an N95 mask outside.',
  'This affects healthy people too. Avoid going outside, and run an air purifier if you have one.',
];
