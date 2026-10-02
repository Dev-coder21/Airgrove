/**
 * Adaptive render resolution. High-DPI laptop screens (Windows at 200%, MacBook Retina) make the
 * 3D scenes draw 4x the pixels; on integrated graphics the forest then drops below 50 fps. When
 * that happens the WebGL pixel ratio steps down (2 -> 1.75 -> 1.5 -> 1.25, never below 1) and
 * steps back up when there is headroom. Layout, colours and motion are unchanged.
 */
import { pixelRatio } from './util';

const listeners: (() => void)[] = [];
let scale = 1; // fraction of the device pixel ratio actually rendered
let frames = 0, acc = 0, goodFor = 0;

export function glPixelRatio(): number {
  return Math.max(1, Math.min(pixelRatio(), pixelRatio() * scale));
}
export function onQualityChange(cb: () => void): void {
  listeners.push(cb);
}
function set(s: number): void {
  const before = glPixelRatio();
  scale = Math.min(1, Math.max(0.5, s));
  if (glPixelRatio() !== before) listeners.forEach((cb) => cb());
}
/** Call once per frame with the frame time in seconds. */
export function tickQuality(dt: number): void {
  if (document.hidden || dt <= 0 || dt > 0.25) return; // ignore tab switches and stalls
  frames++; acc += dt;
  if (acc < 1) return;
  const fps = frames / acc;
  frames = 0; acc = 0;
  if (fps < 50 && glPixelRatio() > 1) { set(scale - 0.125); goodFor = 0; }
  else if (fps > 58) { if (++goodFor >= 4 && scale < 1) { set(scale + 0.125); goodFor = 0; } }
  else goodFor = 0;
}
