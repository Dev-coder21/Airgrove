/**
 * Shared app state. Modules read and write it; `main.ts` fills `D` before anything renders.
 */
import type { AirData, CitySeries } from './data';

export interface Particles {
  setText(t: string, first: boolean, keep?: boolean): void;
  relayout(): void;
  replay(): void;
  tick(now: number, dt: number): void;
}
export interface Globe { refresh(): void; tick(now: number, dt: number): void; }
export interface Card { mark(): void; redraw(): void; tick(now: number, dt: number): void; enter?: number; }
export interface Play { kind: 'fc' | 'river' | 'smoke'; to: number; rate: number; acc: number; }

export const app = {
  D: null as unknown as AirData,
  city: null as unknown as CitySeries,
  T: 0,
  lastCat: -1,
  /** 0..1 target "badness" of the selected city at T. */
  qTarget: 0,
  pmShown: 0,
  fogPulse: 0, fogPulseT: 0, camShift: 0, camShiftT: 0,
  play: null as Play | null,
  /** 0 at top, 1 once the hero has scrolled away. */
  SCROLLU: 0,
  dimV: 0,
  INTRO_END: 0,
  PW: null as Particles | null,
  GLOBE: null as Globe | null,
  CARD: null as Card | null,
};

export function pmAt(c: CitySeries, i: number): number {
  const NOW = app.D.now;
  return i <= NOW || !c.ready ? c.obs[Math.min(i, NOW)] : c.fc[i];
}
export function ready(): CitySeries[] {
  return app.D.cities.filter((c) => c.ready);
}
export function byId(id: string): CitySeries {
  return app.D.cities.find((c) => c.id === id) || app.D.cities[0];
}
export function smokeAt(i: number): number {
  return app.D.smoke[Math.max(0, Math.min(app.D.hours - 1, i))] || 0;
}
