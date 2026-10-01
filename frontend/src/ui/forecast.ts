/** Forecast chart (3 days observed + 72 h forecast with the 80% band) and the three fact tiles. */
import { CATS, catIdx } from '../core/aqi';
import { fDay, fHr, fWk, hIST, tms } from '../core/time';
import { $ } from '../core/util';
import { app, pmAt } from '../state';
import { chromaSet } from './chroma';

const FC: { x0: number; X?: (i: number) => number; Y?: (v: number) => number } = { x0: 0 };

function niceMax(v: number): number {
  const steps = [60, 90, 120, 150, 200, 250, 300, 400, 500];
  for (let i = 0; i < steps.length; i++) if (v <= steps[i]) return steps[i];
  return Math.ceil(v / 100) * 100;
}
function fact(k: string, v: number | string, u: string, p: string): string {
  return '<div class="fact glass"><span class="k">' + k + '</span><span class="big">' + v + '<small>' + u + '</small></span><p>' + p + '</p></div>';
}

export function buildFc(): void {
  const { city } = app, HRS = app.D.hours, NOW = app.D.now;
  FC.x0 = Math.max(0, NOW - 71); // three days of observations before the latest reading
  const W = 1000, H = 340, L = 46, R = 14, Tp = 14, B = 34, x0 = FC.x0, n = HRS - 1 - x0;
  let mx = 0;
  for (let i = x0; i < HRS; i++) mx = Math.max(mx, i <= NOW ? city.obs[i] : city.hi[i]);
  const ym = niceMax(mx * 1.08);
  const X = (i: number) => L + ((i - x0) / n) * (W - L - R), Y = (v: number) => Tp + (1 - Math.min(v, ym) / ym) * (H - Tp - B);
  FC.X = X; FC.Y = Y;
  let s = '', lo = 0;
  CATS.forEach((c) => {
    const hi = Math.min(c.max, ym);
    if (hi > lo) s += '<rect x="' + L + '" y="' + Y(hi).toFixed(1) + '" width="' + (W - L - R) + '" height="' + (Y(lo) - Y(hi)).toFixed(1) + '" fill="' + c.c + '" opacity=".07"/>';
    lo = Math.min(c.max, ym);
  });
  const tick = ym <= 150 ? 30 : ym <= 300 ? 50 : 100;
  for (let v = 0; v <= ym; v += tick) {
    s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v).toFixed(1) + '" y2="' + Y(v).toFixed(1) + '" stroke="rgba(220,235,210,.09)"/>';
    s += '<text x="' + (L - 8) + '" y="' + (Y(v) + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="rgba(238,242,232,.5)" font-family="Lexend,sans-serif">' + v + '</text>';
  }
  for (let i = x0; i < HRS; i++) {
    if (Math.round(hIST(i)) % 24 === 0) {
      s += '<line x1="' + X(i).toFixed(1) + '" x2="' + X(i).toFixed(1) + '" y1="' + Tp + '" y2="' + (H - B) + '" stroke="rgba(220,235,210,.07)"/>';
      s += '<text x="' + (X(i) + 6).toFixed(1) + '" y="' + (H - 12) + '" font-size="11" fill="rgba(238,242,232,.55)" font-family="Lexend,sans-serif">' + fWk.format(tms(i)) + ' ' + fDay.format(tms(i)) + '</text>';
    }
  }
  let band = '', fl = '', ol = '';
  for (let i = NOW; i < HRS; i++) {
    band += (i === NOW ? 'M' : ' L') + X(i).toFixed(1) + ',' + Y(city.hi[i]).toFixed(1);
    fl += (i === NOW ? 'M' : ' L') + X(i).toFixed(1) + ',' + Y(city.fc[i]).toFixed(1);
  }
  for (let i = HRS - 1; i >= NOW; i--) band += ' L' + X(i).toFixed(1) + ',' + Y(city.lo[i]).toFixed(1);
  for (let i = x0; i <= NOW; i++) ol += (i === x0 ? 'M' : ' L') + X(i).toFixed(1) + ',' + Y(city.obs[i]).toFixed(1);
  s += '<path d="' + band + ' Z" fill="rgba(169,194,154,.22)"/>';
  s += '<path d="' + ol + '" fill="none" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/>';
  s += '<path d="' + fl + '" fill="none" stroke="#a9c29a" stroke-width="1.8" stroke-dasharray="5 5"/>';
  s += '<line x1="' + X(NOW).toFixed(1) + '" x2="' + X(NOW).toFixed(1) + '" y1="' + Tp + '" y2="' + (H - B) + '" stroke="rgba(255,255,255,.4)" stroke-dasharray="2 3"/>';
  s += '<text x="' + (X(NOW) + 6).toFixed(1) + '" y="' + (Tp + 12) + '" font-size="11" fill="rgba(238,242,232,.75)" font-family="Lexend,sans-serif">Latest reading</text>';
  s += '<g id="fcMark"><line id="fcMarkL" y1="' + Tp + '" y2="' + (H - B) + '" stroke="rgba(255,255,255,.75)"/><circle id="fcMarkC" r="5" fill="#fff" stroke="rgba(12,24,16,.8)" stroke-width="2"/></g>';
  $('fcSvg').innerHTML = s;
  $('fcEyebrow').textContent = city.name + ' · Airgrove forecast';
  chromaSet($('fcTitle'), 'The next 72 hours in ' + city.name);
  // facts
  let pk = NOW + 1, cl = NOW + 1, bad = 0;
  for (let i = NOW + 1; i < HRS; i++) {
    if (i <= NOW + 24 && city.fc[i] > city.fc[pk]) pk = i;
    if (city.fc[i] < city.fc[cl]) cl = i;
    if (Math.round(city.fc[i]) > 90) bad++;
  }
  $('facts').innerHTML =
    fact('Peak in the next 24 h', Math.round(city.fc[pk]), 'µg/m³', fWk.format(tms(pk)) + ' ' + fHr.format(tms(pk)) + ' IST, ' + CATS[catIdx(city.fc[pk])].n + '. Night peaks come when the air near the ground stops mixing.') +
    fact('Cleanest hour ahead', Math.round(city.fc[cl]), 'µg/m³', fWk.format(tms(cl)) + ' ' + fHr.format(tms(cl)) + ' IST. The best window for a walk or opening the windows.') +
    fact('Hours above Moderate', bad, 'of 72', bad ? 'Hours forecast as Poor or worse in the next three days.' : 'No hours forecast as Poor or worse in the next three days.');
  moveFcMarker();
}

export function moveFcMarker(): void {
  const g = document.getElementById('fcMark');
  if (!g || !FC.X || !FC.Y) return;
  if (app.T < FC.x0) { g.style.display = 'none'; return; }
  g.style.display = '';
  const x = FC.X(app.T).toFixed(1);
  const l = $('fcMarkL') as unknown as SVGLineElement, c = $('fcMarkC') as unknown as SVGCircleElement;
  l.setAttribute('x1', x); l.setAttribute('x2', x);
  c.setAttribute('cx', x);
  c.setAttribute('cy', FC.Y(pmAt(app.city, app.T)).toFixed(1));
}
