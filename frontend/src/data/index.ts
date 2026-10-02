import { demoData } from './demo';
import { staticData } from './static';
import type { AirData } from './types';

export type { AirData, CitySeries, Fire, ModelRow } from './types';

/**
 * Pick the data source. Default: real data from the static export (data/bundle.json).
 * `?demo` uses the reference's sample generator; `?api=<origin>` reads the live API.
 */
export async function loadData(): Promise<AirData> {
  const q = new URLSearchParams(location.search);
  if (q.has('demo') || q.get('data') === 'demo') return demoData();
  const api = q.get('api');
  try {
    return await staticData(api ? `${api.replace(/\/$/, '')}/api/bundle` : 'data/bundle.json');
  } catch (e) {
    console.warn('real data unavailable, falling back to the demo:', e);
    return demoData();
  }
}
