/**
 * Airgrove frontend entry. Loads data through the single data interface, then boots every
 * module in the same order as reference/airgrove-final.html and runs one animation loop.
 */
import { initCard } from './card/card';
import { qOf } from './core/aqi';
import { tickQuality } from './core/quality';
import { clamp, reduce } from './core/util';
import { loadData } from './data';
import { initGlobe } from './globe/globe';
import { initForest } from './scene/forest';
import { app, pmAt } from './state';
import { initHeadings } from './ui/chroma';
import { initChromeButtons, tickChromeButtons } from './ui/chrome';
import { initControls, setT, tickPlay } from './ui/controls';
import { buildFc } from './ui/forecast';
import { initHeadline } from './ui/headline';
import { initHero, updateHero } from './ui/hero';
import { initIndia } from './ui/india';
import { initIntro } from './ui/intro';
import { initModel } from './ui/model';
import { drawRiver, initRiver } from './ui/river';
import { initScrollFx, initVine, tickScrollFx } from './ui/scroll';

async function boot(): Promise<void> {
  // the opening wordmark needs no data: start it while the data file loads
  const intro = initIntro();
  let booted = false;
  const pre = (now: number) => { if (booted) return; if (intro) intro.tick(now); requestAnimationFrame(pre); };
  requestAnimationFrame(pre);
  const D = await loadData();
  booted = true;
  app.D = D;
  app.city = D.cities[0];
  app.T = D.now;
  app.qTarget = qOf(pmAt(app.city, app.T));

  initHero();
  initRiver();
  initControls();
  initIndia();
  app.GLOBE = initGlobe();
  initModel();
  const forest = initForest();
  initChromeButtons();
  initHeadings();
  app.PW = initHeadline();
  app.CARD = initCard();
  const vine = initVine();

  updateHero(); drawRiver(); buildFc(); setT(D.now);
  initScrollFx();
  setTimeout(() => vine.build(), 300);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => drawRiver());
  window.addEventListener('resize', () => drawRiver());

  const elPm = document.getElementById('pmNum')!;
  let last = performance.now();
  function loop(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    tickPlay(dt);
    tickQuality(dt);
    const pmT = pmAt(app.city, app.T);
    app.pmShown += (pmT - app.pmShown) * (1 - Math.exp(-dt * (reduce ? 30 : 7)));
    elPm.textContent = String(Math.round(app.pmShown));
    app.SCROLLU = clamp(window.scrollY / window.innerHeight, 0, 1);
    tickScrollFx(); vine.tick(now, dt);
    if (forest) forest.tick(dt);
    if (intro) intro.tick(now);
    if (app.CARD) app.CARD.tick(now, dt);
    if (app.PW && app.dimV < 0.999) app.PW.tick(now, dt);
    if (app.GLOBE) app.GLOBE.tick(now, dt);
    tickChromeButtons(now, dt);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}

boot();
