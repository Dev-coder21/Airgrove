export const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  return document.getElementById(id) as T;
}
export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
/** Small seeded PRNG (mulberry32), so the demo data and decorations are stable. */
export function rng(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hexA(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + (n >> 16) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}

type Tweened = HTMLElement & { _raf?: number };
/** Count a number element up/down to a new value. */
export function tween(el: HTMLElement | null, to: number, dur?: number): void {
  if (!el) return;
  const t = el as Tweened;
  const from = +(t.dataset.v || 0);
  t.dataset.v = String(to);
  if (reduce || from === to) {
    t.textContent = String(Math.round(to));
    return;
  }
  const t0 = performance.now();
  cancelAnimationFrame(t._raf || 0);
  (function step(now: number) {
    const u = clamp((now - t0) / (dur || 600), 0, 1),
      e = 1 - Math.pow(1 - u, 3);
    t.textContent = String(Math.round(from + (to - from) * e));
    if (u < 1) t._raf = requestAnimationFrame(step);
  })(t0);
}
