/** India section: summary strip, ranked city bars, map clock, story captions, time range. */
import { CATS, LIMIT, catIdx } from '../core/aqi';
import { fDay, fHr, fWk, stamp, tms } from '../core/time';
import { $, reduce, tween } from '../core/util';
import { app, byId, pmAt, ready, smokeAt } from '../state';
import { goToCity, setT, stopPlay } from './controls';

export function firesLive(): number {
  let n = 0;
  app.D.fires.forEach((f) => {
    const age = app.T - f.i;
    if (age >= 0 && age <= 48) n++;
  });
  return n;
}

export function updateMapClock(): void {
  const T = app.T;
  $('mapClock').textContent = fWk.format(tms(T)) + ' ' + stamp(T) + ' · ' + (T <= app.D.now ? 'observed' : 'forecast');
}

const rkRows: Record<string, HTMLButtonElement> = {};
const RKH = 29;

export function renderRanks(): void {
  const T = app.T, NOW = app.D.now;
  const arr = ready().map((c) => ({ c, pm: pmAt(c, T) })).sort((a, b) => a.pm - b.pm);
  const list = $('rkList'), mx = Math.max(300, Math.ceil(arr[arr.length - 1].pm / 50) * 50);
  $('rkMax').textContent = String(mx);
  list.style.height = arr.length * RKH + 'px';
  const limPct = (LIMIT / mx) * 100;
  arr.forEach((o, i) => {
    let r = rkRows[o.c.id];
    if (!r) {
      r = document.createElement('button');
      r.className = 'rk-row';
      r.dataset.id = o.c.id;
      r.innerHTML = '<span class="nm"></span><span class="tr"><span class="fl"></span><span class="lim"></span></span><span class="v"></span>';
      r.addEventListener('click', function (this: HTMLButtonElement) { goToCity(byId(this.dataset.id!)); });
      list.appendChild(r);
      rkRows[o.c.id] = r;
    }
    r.style.transform = 'translateY(' + i * RKH + 'px)';
    r.querySelector('.nm')!.textContent = o.c.name;
    const fl = r.querySelector<HTMLElement>('.fl')!;
    fl.style.width = Math.min(100, (o.pm / mx) * 100).toFixed(1) + '%';
    fl.style.background = CATS[catIdx(o.pm)].c;
    r.querySelector<HTMLElement>('.lim')!.style.left = limPct.toFixed(1) + '%';
    r.querySelector('.v')!.textContent = String(Math.round(o.pm));
    r.classList.toggle('cur', o.c === app.city);
    r.setAttribute('aria-label', o.c.name + ', ' + Math.round(o.pm) + ' micrograms, ' + CATS[catIdx(o.pm)].n);
  });
  // summary strip
  const counts = CATS.map(() => 0);
  arr.forEach((o) => { counts[catIdx(o.pm)]++; });
  $('isN').textContent = String(arr.length);
  $('isWhen').textContent = fDay.format(tms(T)) + ', ' + fHr.format(tms(T)) + (T <= NOW ? ' · observed' : ' · forecast');
  const bar = $('isBar');
  if (!bar.children.length) bar.innerHTML = CATS.map((c) => '<span style="background:' + c.c + '"></span>').join('');
  [].forEach.call(bar.children, (sp: HTMLElement, k: number) => { sp.style.flexGrow = String(counts[k]); sp.title = CATS[k].n + ': ' + counts[k]; });
  $('isLeg').innerHTML = CATS.map((c, k) => (counts[k] ? '<span><span class="dot" style="background:' + c.c + '"></span>' + c.n + ' <b>' + counts[k] + '</b></span>' : '')).join('');
  tween($('isCleanV'), arr[0].pm);
  $('isCleanN').textContent = arr[0].c.name + ' · ' + CATS[catIdx(arr[0].pm)].n;
  const w = arr[arr.length - 1];
  tween($('isWorstV'), w.pm);
  $('isWorstN').textContent = w.c.name + ' · ' + CATS[catIdx(w.pm)].n;
  const over = arr.filter((o) => o.pm > LIMIT).length;
  tween($('isOverV'), over);
  $('isOverN').textContent = 'of ' + arr.length + ' cities above ' + LIMIT + ' µg/m³';
  tween($('isFireV'), firesLive());
  updateCaption();
}

let capLast = '', capT = 0;
function updateCaption(): void {
  const el = $('gcap');
  if (!el) return;
  const T = app.T, nF = firesLive(), sm = smokeAt(T), c0 = app.D.cities[0], dl = pmAt(c0, T);
  let t = '';
  if (dl > 250) t = c0.name + ' turns Severe: ' + Math.round(dl) + ' µg/m³, more than ' + Math.floor(dl / LIMIT) + '× India’s daily limit.';
  else if (sm > 0.7 && nF > 10) t = 'North-west winds carry the smoke toward ' + c0.name + ' and the Gangetic plain.';
  else if (nF > 40) t = 'Crop fires are burning across Punjab and Haryana: ' + nF + ' seen in the last 48 hours.';
  else if (T > app.D.now) t = 'Forecast: the smoke thins as the fires die down.';
  else if (nF > 0) t = 'Fewer fires today. The haze over the north is starting to lift.';
  if (t === capLast) return;
  capLast = t;
  el.classList.add('out');
  clearTimeout(capT);
  capT = window.setTimeout(() => { el.textContent = t; el.classList.remove('out'); }, reduce ? 0 : 260);
}

export function initIndia(): void {
  const n = app.D.cities.length;
  document.querySelector('#india .sec-head .eyebrow')!.textContent = 'India · ' + n + ' cities with government sensors';
  const mapRange = $('mapRange') as HTMLInputElement;
  mapRange.max = String(app.D.hours - 1);
  mapRange.addEventListener('input', () => { stopPlay(); setT(+mapRange.value); });
}
