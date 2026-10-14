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
  // The opening waits for the setup below (WebGL scenes, shader compiles) so none of it lands
  // mid-animation; on a slow connection it starts anyway after 1.5 s.
  let setupDone!: () => void;
  const setup = new Promise<void>((r) => { setupDone = r; });
  let introStartedEarly = false;
  const intro = initIntro(Promise.race([setup, new Promise((r) => setTimeout(() => { introStartedEarly = true; r(0); }, 1500))]));
  // yield a frame between heavy setup steps so a running animation never stalls for long
  const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));
  let booted = false;
  const pre = (now: number) => { if (booted) return; if (intro) intro.tick(now); requestAnimationFrame(pre); };
  requestAnimationFrame(pre);
  const D = await loadData();
  // slow connection: the intro is already playing, so let it finish before the heavy setup
  if (introStartedEarly && intro) {
    while (performance.now() < app.INTRO_END) await new Promise((r) => setTimeout(r, 100));
  }
  app.D = D;
  app.city = D.cities[0];
  app.T = D.now;
  app.qTarget = qOf(pmAt(app.city, app.T));

  initHero();
  initRiver();
  initControls();
  initIndia();
  await nextFrame();
  app.GLOBE = initGlobe();
  initModel();
  await nextFrame();
  const forest = initForest();
  await nextFrame();
  initChromeButtons();
  initHeadings();
  app.PW = initHeadline();
  await nextFrame();
  app.CARD = initCard();
  const vine = initVine();

  updateHero(); drawRiver(); buildFc(); setT(D.now);
  initScrollFx();
  setTimeout(() => vine.build(), 300);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => drawRiver());
  window.addEventListener('resize', () => drawRiver());

  const elPm = document.getElementById('pmNum')!;
  let pmLast = NaN;
  let last = performance.now();
  function loop(now: number): void {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    tickPlay(dt);
    tickQuality(dt);
    const pmT = pmAt(app.city, app.T);
    app.pmShown += (pmT - app.pmShown) * (1 - Math.exp(-dt * (reduce ? 30 : 7)));
    const pmR = Math.round(app.pmShown);
    if (pmR !== pmLast) { pmLast = pmR; elPm.textContent = String(pmR); } // avoid a layout every frame
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
  booted = true; // the main loop takes over ticking the intro
  requestAnimationFrame(loop);
  // release the intro once the first full frame (and its GPU uploads) has rendered
  requestAnimationFrame(() => requestAnimationFrame(() => setupDone()));
}

boot();
