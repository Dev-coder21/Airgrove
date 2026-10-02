/** Scroll choreography (reveals that replay in both directions, hero parallax, card entry,
 * finale fill) and the vine scroll bar with section leaves. */
import { $, clamp, reduce } from '../core/util';
import { app } from '../state';

let heroCopy: HTMLElement, foot: HTMLElement, river: HTMLElement, finale: HTMLElement, cardStage: HTMLElement;
let heroAway = false;
let heroSec: HTMLElement | null = null;

export function initScrollFx(): void {
  const groups = [
    '.sec-head .eyebrow', '.sec-head .lede', '.sec-head .actions', '.sec-head .note',
    '.map-wrap', '.rank', '.map-controls', '.card-stage', '.chart-wrap', '.chart-wrap + .facts .fact',
    '.model-grid > .table-wrap', '.bars', '.notes .fact', 'footer > span', '.finale .tag2'];
  const io = 'IntersectionObserver' in window && !reduce
    ? new IntersectionObserver((es) => {
      es.forEach((e) => {
        if (e.isIntersecting && e.intersectionRatio >= 0.12) e.target.classList.add('in');
        else if (!e.isIntersecting) e.target.classList.remove('in');
      });
    }, { threshold: [0, 0.12] })
    : null;
  if (io) groups.forEach((sel) => {
    document.querySelectorAll<HTMLElement>(sel).forEach((el, i) => {
      const sib = el.parentNode ? [].indexOf.call(el.parentNode.children, el as never) : i;
      el.style.setProperty('--d', Math.min(sib, 5) * 90 + 'ms'); el.classList.add('rv'); io.observe(el);
    });
  });
  heroCopy = document.querySelector('.hero-copy')!; foot = document.querySelector('.hero .foot')!; river = document.querySelector('.hero .river')!;
  finale = $('finaleWord'); cardStage = $('cardStage'); heroSec = document.getElementById('top');
}

export function tickScrollFx(): void {
  const y = window.scrollY, vhh = window.innerHeight;
  // replay the particle headline only after the whole hero has left the screen and you come back
  const heroH = heroSec ? heroSec.offsetHeight : vhh;
  if (y >= heroH) heroAway = true;
  else if (heroAway && y < vhh * 0.35) { heroAway = false; if (app.PW) app.PW.replay(); }
  if (!reduce && y < vhh * 1.2) {
    const k = y / vhh;
    heroCopy.style.transform = 'translate3d(0,' + (-y * 0.28).toFixed(1) + 'px,0)'; heroCopy.style.opacity = (1 - clamp(k * 1.25, 0, 1)).toFixed(3);
    foot.style.transform = 'translate3d(0,' + (-y * 0.12).toFixed(1) + 'px,0)'; foot.style.opacity = (1 - clamp(k * 1.1, 0, 1)).toFixed(3);
    river.style.transform = 'translate3d(0,' + (-y * 0.05).toFixed(1) + 'px,0)';
  }
  // card turns in as its section arrives
  if (app.CARD && cardStage) { const r = cardStage.getBoundingClientRect(); app.CARD.enter = clamp((vhh - r.top) / (vhh * 0.85), 0, 1); }
  // finale wordmark fills as you reach the bottom
  const maxY = document.documentElement.scrollHeight - vhh, f = clamp((y - (maxY - vhh * 0.9)) / (vhh * 0.9), 0, 1);
  finale.style.setProperty('--fill', reduce ? '1' : f.toFixed(3));
}

/* ---------------- vine scroll bar ---------------- */
interface Leaf { f: number; el: HTMLElement; name: string; }
export function initVine(): { build(): void; tick(now: number, dt: number): void } {
  const vine = $('vine'), grow = $('vineGrow'), thumb = $('vineThumb'), marks = $('vineMarks');
  const SECS = [['top', 'The grove'], ['india', 'India'], ['card', 'Air card'], ['forecast', 'Forecast'], ['model', 'Model']];
  let leaves: Leaf[] = [], railH = 0, thH = 0, lastY = window.scrollY, vel = 0, idleT = 0, sparkT = 0, resizeT = 0;
  let drag: null | { y0: number; s0: number } = null;
  function maxY(): number { return Math.max(1, document.documentElement.scrollHeight - window.innerHeight); }
  function build(): void {
    marks.innerHTML = ''; leaves = []; railH = vine.clientHeight;
    SECS.forEach((sc, i) => {
      const el = document.getElementById(sc[0]);
      if (!el) return;
      const f = clamp((sc[0] === 'top' ? 0 : el.offsetTop - 60) / maxY(), 0, 1), top = (f * railH).toFixed(1) + 'px';
      const lf = document.createElement('div'); lf.className = 'leaf' + (i % 2 ? ' l' : ''); lf.style.top = top; marks.appendChild(lf);
      const bt = document.createElement('button'); bt.className = 'leaf-btn'; bt.style.top = top; bt.setAttribute('aria-label', 'Go to ' + sc[1]); bt.tabIndex = -1;
      bt.innerHTML = '<span>' + sc[1] + '</span>';
      bt.dataset.top = String(sc[0] === 'top' ? 0 : el.offsetTop - 60);
      marks.appendChild(bt); leaves.push({ f, el: lf, name: sc[1] });
    });
    thH = Math.max(34, (railH * window.innerHeight) / document.documentElement.scrollHeight);
    thumb.style.height = thH + 'px';
  }
  function spark(y: number): void {
    if (reduce) return;
    const sp = document.createElement('span'); sp.className = 'spark';
    sp.style.top = y + 'px';
    sp.style.setProperty('--sx', ((Math.random() - 0.5) * 26).toFixed(1) + 'px');
    sp.style.setProperty('--sy', ((Math.random() - 0.2) * 30).toFixed(1) + 'px');
    vine.appendChild(sp); setTimeout(() => sp.remove(), 950);
  }
  // Behaves like a native scrollbar: press anywhere on the rail to grab it (the thumb jumps under
  // the pointer unless you pressed the thumb itself), then the page follows the pointer 1:1,
  // instantly, with no easing, snapping or section jumps. The leaves are decoration only.
  const jump = (top: number) => window.scrollTo({ top: clamp(top, 0, maxY()), behavior: 'instant' as ScrollBehavior });
  vine.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const r = vine.getBoundingClientRect(), ty = thumb.getBoundingClientRect();
    let grab = (e.clientY - ty.top) / Math.max(ty.height, 1); // where on the thumb we hold it
    if (grab < 0 || grab > 1) grab = 0.5;
    drag = { y0: r.top + grab * thH, s0: 0 };
    vine.classList.add('dragging'); vine.setPointerCapture(e.pointerId); e.preventDefault();
    follow(e.clientY);
  });
  function follow(clientY: number): void {
    if (!drag) return;
    const f = (clientY - drag.y0) / Math.max(railH - thH, 1); // thumb top as a fraction of its travel
    jump(clamp(f, 0, 1) * maxY());
  }
  vine.addEventListener('pointermove', (e) => follow(e.clientY));
  function endDrag(): void { drag = null; vine.classList.remove('dragging'); }
  vine.addEventListener('pointerup', endDrag); vine.addEventListener('pointercancel', endDrag);
  window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = window.setTimeout(build, 120); });
  let lastH = 0;
  return {
    build,
    tick(now, dt) {
      // keep the thumb proportional when the page height changes (fonts, data, reveals)
      const h = document.documentElement.scrollHeight;
      if (!railH || h !== lastH) { lastH = h; build(); }
      const y = window.scrollY, p = clamp(y / maxY(), 0, 1);
      vel += ((y - lastY) / Math.max(dt, 1 / 120) - vel) * (1 - Math.exp(-dt * 10)); lastY = y;
      const ty = p * (railH - thH);
      thumb.style.transform = 'translate3d(0,' + ty.toFixed(1) + 'px,0)';
      grow.style.height = (ty + thH / 2).toFixed(1) + 'px';
      leaves.forEach((l) => l.el.classList.toggle('on', p >= l.f - 0.005));
      if (Math.abs(vel) > 40 || drag) idleT = now;
      vine.classList.toggle('active', now - idleT < 900);
      if (Math.abs(vel) > 500 && now - sparkT > 45) { sparkT = now; spark(ty + (vel > 0 ? 2 : thH - 2)); }
    },
  };
}
