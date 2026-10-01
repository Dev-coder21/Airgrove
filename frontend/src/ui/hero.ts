/** Hero copy: eyebrow, headline, advice, PM2.5 panel and weather readings. */
import { ADVICE, CATS, HEAD, catIdx, qOf } from '../core/aqi';
import { stamp } from '../core/time';
import { $ } from '../core/util';
import { app, pmAt } from '../state';

let elEyebrow: HTMLElement, elHead: HTMLElement, elLede: HTMLElement, elChip: HTMLElement, elSub: HTMLElement, elRead: HTMLElement;
let swapT = 0;

export function headlineEl(): HTMLElement {
  return elHead;
}

export function initHero(): void {
  elEyebrow = $('eyebrow'); elHead = $('headline'); elLede = $('lede'); elChip = $('chip'); elSub = $('pmSub'); elRead = $('readings');
}

function setHead(t: string, first: boolean): void {
  if (app.PW) app.PW.setText(t, first);
  else elHead.textContent = t;
}

export function updateHero(): void {
  const { city, T } = app, NOW = app.D.now;
  const pm = pmAt(city, T), ci = catIdx(pm);
  const mode = T === NOW ? 'Latest reading' : T < NOW ? 'Observed' : 'Forecast +' + (T - NOW) + ' h';
  elEyebrow.textContent = city.name + ' · ' + mode + ' · ' + stamp(T);
  if (ci !== app.lastCat) {
    if (app.lastCat < 0) {
      setHead(HEAD[ci], app.lastCat === -1);
      elLede.textContent = ADVICE[ci];
    } else {
      if (!app.PW) elHead.classList.add('swap');
      elLede.classList.add('swap');
      clearTimeout(swapT);
      swapT = window.setTimeout(() => {
        const c2 = catIdx(pmAt(app.city, app.T));
        setHead(HEAD[c2], false);
        elLede.textContent = ADVICE[c2];
        elHead.classList.remove('swap');
        elLede.classList.remove('swap');
      }, app.PW ? 120 : 220);
    }
    app.lastCat = ci;
  }
  elChip.textContent = CATS[ci].n;
  elChip.style.background = CATS[ci].c;
  $('cityDot').style.background = CATS[ci].c;
  elSub.textContent = T <= NOW
    ? 'Observed · average of ' + city.stations + ' station' + (city.stations > 1 ? 's' : '')
    : 'Forecast · 80% range ' + Math.round(city.lo[T]) + '–' + Math.round(city.hi[T]);
  elRead.innerHTML =
    '<span>Wind <b>' + Math.round(city.windKmh[T]) + ' km/h ' + city.windDir[T] + '</b></span>' +
    '<span>Humidity <b>' + Math.round(city.rh[T]) + '%</b></span>' +
    '<span>Mixing height <b>' + Math.round(city.mixM[T]).toLocaleString('en-IN') + ' m</b></span>';
  app.qTarget = qOf(pm);
}
