/** Time and city selection, playback, the city switcher, nav dimming and the button highlight. */
import { CATS, catIdx } from '../core/aqi';
import { $, clamp, reduce } from '../core/util';
import type { CitySeries } from '../data';
import { app, byId, pmAt, ready } from '../state';
import { buildFc, moveFcMarker } from './forecast';
import { updateHero } from './hero';
import { renderRanks, updateMapClock } from './india';
import { drawRiver, placeThumb } from './river';

/* ---------- setT / setCity ---------- */
export function setT(i: number): void {
  i = clamp(Math.round(i), 0, app.D.hours - 1);
  app.T = i;
  updateHero();
  placeThumb();
  ($('mapRange') as HTMLInputElement).value = String(i);
  updateMapClock();
  renderRanks();
  moveFcMarker();
  if (app.GLOBE) app.GLOBE.refresh();
  if (app.CARD) app.CARD.mark();
}

export function setCity(c: CitySeries): void {
  if (!c.ready || c === app.city) return;
  app.city = c;
  $('cityName').textContent = c.name;
  app.fogPulseT = 1;
  setTimeout(() => { app.fogPulseT = 0; }, reduce ? 0 : 650);
  app.camShiftT = Math.random() < 0.5 ? -1 : 1;
  setTimeout(() => { app.camShiftT = 0; }, reduce ? 0 : 650);
  app.lastCat = -2;
  updateHero(); drawRiver(); buildFc();
  if (app.CARD) app.CARD.mark();
  renderRanks();
  if (app.GLOBE) app.GLOBE.refresh();
}

export function goToCity(c: CitySeries): void {
  stopPlay();
  setCity(c);
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
}

/* ---------- playback ---------- */
const PLAY_SVG = '<path d="M5 3.5v9l7-4.5-7-4.5z" fill="currentColor"/>',
  PAUSE_SVG = '<path d="M5 3.5h2v9H5zM9 3.5h2v9H9z" fill="currentColor"/>';
function setPlayUI(): void {
  const p = app.play;
  $('playFcLbl').textContent = p && p.kind === 'fc' ? 'Pause' : 'Play the next 72 hours';
  $('playSmokeLbl').textContent = p && p.kind === 'smoke' ? 'Pause' : 'Play the smoke week';
  $('riverPlayIcon').innerHTML = p && p.kind === 'river' ? PAUSE_SVG : PLAY_SVG;
}
function startPlay(kind: 'fc' | 'river' | 'smoke', from: number | null, to: number, rate: number): void {
  if (app.play && app.play.kind === kind) { stopPlay(); return; }
  if (from !== null) setT(from);
  app.play = { kind, to, rate: reduce ? rate * 1.5 : rate, acc: 0 };
  setPlayUI();
}
export function stopPlay(): void {
  app.play = null;
  setPlayUI();
}
export function tickPlay(dt: number): void {
  const p = app.play;
  if (!p) return;
  p.acc += dt * p.rate;
  if (p.acc >= 1) {
    const n = Math.floor(p.acc);
    p.acc -= n;
    setT(Math.min(p.to, app.T + n));
    if (app.T >= p.to) stopPlay();
  }
}

/* ---------- city list ---------- */
/** Options below the search box; `query` filters by name (case- and accent-insensitive). */
function renderCityList(list: HTMLElement, query = ''): void {
  let html = '';
  const R = ready();
  const norm = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const q = norm(query.trim());
  let sorted = [app.D.cities[0]].concat(R.filter((c) => c !== app.D.cities[0]).sort((a, b) => (a.name < b.name ? -1 : 1)));
  if (q) {
    sorted = sorted.filter((c) => norm(c.name).includes(q))
      .sort((a, b) => Number(!norm(a.name).startsWith(q)) - Number(!norm(b.name).startsWith(q)));
  }
  if (!sorted.length) html = '<li class="city-none">No city with a forecast matches “' + query.replace(/[<&]/g, '') + '”</li>';
  sorted.forEach((c) => {
    const pm = pmAt(c, app.T);
    html += '<li class="opt"><button role="option" data-id="' + c.id + '" aria-selected="' + (c === app.city) + '"><span class="dot" style="background:' + CATS[catIdx(pm)].c + '"></span>' + c.name + '<span class="v">' + Math.round(pm) + '</span></button></li>';
  });
  list.querySelectorAll('li:not(.city-search-li)').forEach((li) => li.remove());
  list.insertAdjacentHTML('beforeend', html);
}

let dimEl: HTMLElement, nav: HTMLElement;
function onScroll(): void {
  const d = clamp(window.scrollY / (window.innerHeight * 0.85), 0, 1);
  app.dimV = d;
  dimEl.style.opacity = (d * 0.74).toFixed(3);
  nav.classList.toggle('scrolled', window.scrollY > 40);
}

export function initControls(): void {
  const D = app.D, HRS = D.hours, NOW = D.now;
  $('playFc').addEventListener('click', () => { startPlay('fc', app.T < NOW || app.T >= HRS - 1 ? NOW : null, HRS - 1, 6); });
  $('riverPlay').addEventListener('click', () => { startPlay('river', app.T >= HRS - 1 ? 0 : null, HRS - 1, 10); });
  $('playSmoke').addEventListener('click', () => { startPlay('smoke', app.T >= NOW ? 0 : null, NOW, 11); });

  const cityList = $('cityList'), cityBtn = $('cityBtn');
  $('cityName').textContent = app.city.name;
  // search box at the top of the list (stays put while the options below re-render)
  const searchLi = document.createElement('li');
  searchLi.className = 'city-search-li';
  searchLi.innerHTML = '<input class="city-search" type="search" placeholder="Search a city" aria-label="Search a city" autocomplete="off" spellcheck="false">';
  cityList.prepend(searchLi);
  const search = searchLi.querySelector('input') as HTMLInputElement;
  search.addEventListener('input', () => renderCityList(cityList, search.value));
  search.addEventListener('keydown', (e) => {
    const first = cityList.querySelector<HTMLElement>('li.opt button');
    if (e.key === 'Enter' && first) { e.preventDefault(); first.click(); }
    else if (e.key === 'ArrowDown' && first) { e.preventDefault(); first.focus(); }
    else if (e.key === 'Escape') { openList(false); cityBtn.focus(); }
    e.stopPropagation();
  });
  function openList(open: boolean): void {
    cityList.hidden = !open;
    cityBtn.setAttribute('aria-expanded', String(open));
    if (open) {
      search.value = '';
      renderCityList(cityList);
      const b = cityList.querySelector<HTMLElement>('[aria-selected="true"]');
      if (b) b.scrollIntoView({ block: 'nearest' });
      // focus the search on devices with a keyboard; on touch, don't pop the keyboard open
      if (window.matchMedia('(pointer: fine)').matches) search.focus({ preventScroll: true });
      else if (b) b.focus({ preventScroll: true });
    }
  }
  cityBtn.addEventListener('click', (e) => { e.stopPropagation(); openList(cityList.hidden); });
  cityList.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    goToCity(byId(b.dataset.id!));
    openList(false);
    cityBtn.focus();
  });
  cityList.addEventListener('keydown', (e) => {
    const items = [].slice.call(cityList.querySelectorAll('li.opt button')) as HTMLElement[],
      k = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'ArrowDown') { (items[k + 1] || items[0]).focus(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { (k <= 0 ? search : items[k - 1]).focus(); e.preventDefault(); }
    else if (e.key === 'Escape') { openList(false); cityBtn.focus(); }
  });
  document.addEventListener('click', (e) => {
    if (!cityList.hidden && !(e.target as HTMLElement).closest('.city-pick')) openList(false);
  });

  // metal highlight follows the pointer
  document.addEventListener('pointermove', (e) => {
    const t = e.target as HTMLElement;
    const el = t.closest && (t.closest('.metal,.ghost') as HTMLElement | null);
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', ((e.clientX - r.left) / r.width) * 100 + '%');
    el.style.setProperty('--my', ((e.clientY - r.top) / r.height) * 100 + '%');
  });

  dimEl = $('dim'); nav = $('nav');
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
}
