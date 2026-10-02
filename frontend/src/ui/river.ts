/** The "time river": past 7 days + 72 h forecast with its band, and the draggable thumb. */
import { CATS, catIdx } from '../core/aqi';
import { fDay, fHr, fWk, hIST, stamp, tms } from '../core/time';
import { $, clamp } from '../core/util';
import { app, pmAt } from '../state';
import { setT, stopPlay } from './controls';

let track: HTMLElement, rsvg: SVGSVGElement, thumb: HTMLElement, thumbDot: HTMLElement, thumbLabel: HTMLElement;
const RV = { w: 0, h: 0, ymax: 300 };

function rX(i: number): number {
  return (i / (app.D.hours - 1)) * RV.w;
}
function rY(v: number): number {
  return RV.h - 6 - (Math.min(v, RV.ymax) / RV.ymax) * (RV.h - 18);
}

export function drawRiver(): void {
  const { city } = app, HRS = app.D.hours, NOW = app.D.now;
  RV.w = track.clientWidth; RV.h = track.clientHeight;
  let mx = 0;
  for (let i = 0; i < HRS; i++) mx = Math.max(mx, i <= NOW ? city.obs[i] : city.hi[i]);
  RV.ymax = Math.max(120, mx * 1.05);
  let s = '<defs><linearGradient id="rg" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="' + RV.w + '" y2="0">';
  for (let i = 0; i < HRS; i += 3) s += '<stop offset="' + (i / (HRS - 1)).toFixed(4) + '" stop-color="' + CATS[catIdx(pmAt(city, i))].c + '"/>';
  s += '</linearGradient></defs>';
  // day separators
  for (let i = 0; i < HRS; i++) {
    if (Math.round(hIST(i)) % 24 === 0) {
      const x = rX(i).toFixed(1);
      s += '<line x1="' + x + '" x2="' + x + '" y1="0" y2="' + RV.h + '" stroke="rgba(220,235,210,.1)"/>';
      s += '<text x="' + (+x + 5) + '" y="10" font-size="10.5" fill="rgba(238,242,232,.5)" font-family="Lexend,sans-serif">' + fWk.format(tms(i)) + ' ' + fDay.format(tms(i)).split(' ')[0] + '</text>';
    }
  }
  let area = 'M0,' + RV.h, line = '';
  for (let i = 0; i <= NOW; i++) {
    area += ' L' + rX(i).toFixed(1) + ',' + rY(city.obs[i]).toFixed(1);
    line += (i ? ' L' : 'M') + rX(i).toFixed(1) + ',' + rY(city.obs[i]).toFixed(1);
  }
  area += ' L' + rX(NOW).toFixed(1) + ',' + RV.h + ' Z';
  let band = '', fl = '';
  for (let i = NOW; i < HRS; i++) {
    band += (i === NOW ? 'M' : ' L') + rX(i).toFixed(1) + ',' + rY(city.hi[i]).toFixed(1);
    fl += (i === NOW ? 'M' : ' L') + rX(i).toFixed(1) + ',' + rY(city.fc[i]).toFixed(1);
  }
  for (let i = HRS - 1; i >= NOW; i--) band += ' L' + rX(i).toFixed(1) + ',' + rY(city.lo[i]).toFixed(1);
  band += ' Z';
  s += '<path d="' + area + '" fill="url(#rg)" opacity=".13"/>';
  s += '<path d="' + band + '" fill="url(#rg)" opacity=".2"/>';
  s += '<path d="' + line + '" fill="none" stroke="url(#rg)" stroke-width="1.7" stroke-linejoin="round"/>';
  s += '<path d="' + fl + '" fill="none" stroke="url(#rg)" stroke-width="1.7" stroke-dasharray="4 4"/>';
  const nx = rX(NOW).toFixed(1);
  s += '<line x1="' + nx + '" x2="' + nx + '" y1="14" y2="' + RV.h + '" stroke="rgba(255,255,255,.35)" stroke-dasharray="2 3"/>';
  rsvg.setAttribute('viewBox', '0 0 ' + RV.w + ' ' + RV.h);
  rsvg.innerHTML = s;
  placeThumb();
}

export function placeThumb(): void {
  const { T } = app;
  const x = rX(T);
  thumb.style.left = x + 'px';
  thumbDot.style.top = rY(pmAt(app.city, T)) - 9 + 'px';
  thumbLabel.textContent = T === app.D.now ? (app.D.source === 'demo' ? 'Now · ' : 'Latest · ') + fHr.format(tms(T)) : fWk.format(tms(T)) + ' ' + fHr.format(tms(T));
  const half = 48;
  thumbLabel.style.left = (x < half ? half - x : x > RV.w - half ? RV.w - half - x : 0) + 'px';
  track.setAttribute('aria-valuenow', String(T));
  track.setAttribute('aria-valuetext', stamp(T));
}

export function initRiver(): void {
  track = $('track'); rsvg = document.getElementById('riverSvg') as unknown as SVGSVGElement;
  thumb = $('thumb'); thumbDot = $('thumbDot'); thumbLabel = $('thumbLabel');
  track.setAttribute('aria-valuemax', String(app.D.hours - 1));
  $('track').parentElement!.querySelector('.tag')!.textContent = app.D.tag;

  function iFromX(clientX: number): number {
    const r = track.getBoundingClientRect();
    return Math.round(clamp((clientX - r.left) / r.width, 0, 1) * (app.D.hours - 1));
  }
  let dragging = false;
  track.addEventListener('pointerdown', (e) => { dragging = true; stopPlay(); track.setPointerCapture(e.pointerId); setT(iFromX(e.clientX)); });
  track.addEventListener('pointermove', (e) => { if (dragging) setT(iFromX(e.clientX)); });
  track.addEventListener('pointerup', () => { dragging = false; });
  track.addEventListener('pointercancel', () => { dragging = false; });
  track.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 24 : 1, k = e.key, T = app.T;
    if (k === 'ArrowRight' || k === 'ArrowUp') setT(T + step);
    else if (k === 'ArrowLeft' || k === 'ArrowDown') setT(T - step);
    else if (k === 'Home') setT(0);
    else if (k === 'End') setT(app.D.hours - 1);
    else if (k === 'n' || k === 'N') setT(app.D.now);
    else return;
    stopPlay();
    e.preventDefault();
  });
}
