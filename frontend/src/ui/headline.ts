/** Hero headline as a particle wordmark that re-forms when the AQI category changes. */
import { clamp, reduce, rng, pixelRatio } from '../core/util';
import { app, type Particles } from '../state';
import { headlineEl } from './hero';

interface P { x: number; y: number; vx: number; vy: number; tx: number; ty: number; has: boolean; delay: number; a: number; die: boolean; sq: boolean; seed: number; }

export function initHeadline(): Particles | null {
  if (reduce) return null;
  const h1 = headlineEl(), wrap = document.createElement('div'); wrap.className = 'pw-wrap';
  h1.parentNode!.insertBefore(wrap, h1); wrap.appendChild(h1);
  const cv = document.createElement('canvas'); cv.className = 'pwcv'; cv.setAttribute('aria-hidden', 'true'); wrap.appendChild(cv);
  const g = cv.getContext('2d')!, PAD = 40, ptr = { x: -999, y: -999 }, r = rng(31);
  let W = 0, H = 0, dpr = 1, parts: P[] = [], text = '', lastT = 0, resizeT = 0;
  h1.classList.add('pw');
  function layout(t: string): { x: number; y: number }[] {
    h1.textContent = '';
    h1.innerHTML = t.split(' ').map((w) => '<span class="w">' + w + '</span>').join(' ');
    h1.setAttribute('aria-label', t);
    const cs = getComputedStyle(h1), fsz = parseFloat(cs.fontSize), font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily, hr = h1.getBoundingClientRect();
    dpr = pixelRatio(); W = Math.ceil(hr.width + PAD * 2); H = Math.ceil(hr.height + PAD * 2);
    cv.width = W * dpr; cv.height = H * dpr;
    const oc = document.createElement('canvas'); oc.width = W; oc.height = H; const c = oc.getContext('2d')!;
    c.font = font; c.textBaseline = 'alphabetic'; c.fillStyle = '#fff';
    if ('letterSpacing' in c) (c as any).letterSpacing = cs.letterSpacing;
    const asc = c.measureText('Hg').fontBoundingBoxAscent || fsz * 0.78;
    h1.querySelectorAll<HTMLElement>('.w').forEach((sp) => { const b = sp.getBoundingClientRect(); c.fillText(sp.textContent || '', b.left - hr.left + PAD, b.top - hr.top + PAD + asc); });
    const img = c.getImageData(0, 0, W, H).data, step = Math.max(2, Math.round(fsz / 22)), pts: { x: number; y: number }[] = [];
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) if (img[(y * W + x) * 4 + 3] > 110) pts.push({ x, y });
    for (let i = pts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)), tp = pts[i]; pts[i] = pts[j]; pts[j] = tp; }
    return pts;
  }
  function spawn(x: number, y: number): P {
    return { x, y, vx: 0, vy: 0, tx: 0, ty: 0, has: false, delay: 0, a: 0, die: false, sq: r() < 0.2, seed: r() };
  }
  const PW: Particles = {
    setText(t, first, keep) {
      text = t;
      const pts = layout(t), now = performance.now(), wait = Math.max(0, app.INTRO_END - now);
      if (!keep && !first) parts.forEach((p) => { p.has = false; p.vx += 1 + Math.random() * 2.2; p.vy += 0.4 + Math.random() * 1.8; });
      for (let i = 0; i < pts.length; i++) {
        let p = parts[i];
        if (!p) { p = first ? spawn(r() * W, r() * H) : spawn(Math.random() * W, -10 + Math.random() * H * 0.3); p.a = first ? 0 : 0.2; parts.push(p); }
        p.tx = pts[i].x; p.ty = pts[i].y; p.has = true; p.die = false;
        const lead = pts[i].x / W;
        p.delay = keep ? now : now + wait + (first ? 150 + lead * 900 + Math.random() * 450 : 90 + lead * 300 + Math.random() * 140);
      }
      for (let i = pts.length; i < parts.length; i++) { parts[i].has = false; parts[i].die = true; }
    },
    relayout() { if (text) PW.setText(text, false, true); },
    replay() {
      parts.forEach((p) => { p.x = Math.random() * W; p.y = Math.random() * H; p.vx = p.vy = 0; p.a = 0; });
      if (text) PW.setText(text, true);
    },
    tick(now, dt) {
      if (!W) return;
      const q = app.qTarget, haze = clamp((q - 0.3) * 0.45, 0, 0.28), tt = now / 1000, fr = lastT ? clamp((now - lastT) / 16.7, 0.5, 3) : 1;
      lastT = now;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      const keepParts: P[] = [];
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (p.has && now > p.delay) {
          const loose = p.seed < haze;
          let tx = p.tx, ty = p.ty;
          if (loose) { tx += Math.sin(tt * 0.6 + p.seed * 40) * 12 * q + 5 * q; ty += Math.cos(tt * 0.5 + p.seed * 31) * 7 * q + 3 * q; }
          p.vx = p.vx * 0.76 + (tx - p.x) * 0.11; p.vy = p.vy * 0.76 + (ty - p.y) * 0.11;
          p.a = Math.min(1, p.a + dt * 2.4);
        } else {
          p.vx = p.vx * 0.985 + 0.03 + Math.sin(tt * 1.3 + p.seed * 20) * 0.04; p.vy = p.vy * 0.985 + 0.025;
          if (p.die) p.a -= dt * 1.4; else p.a = Math.max(0.25, p.a - dt * 0.6);
        }
        const dx = p.x - ptr.x, dy = p.y - ptr.y, d2 = dx * dx + dy * dy;
        if (d2 < 3600) { const f = ((1 - d2 / 3600) * 1.6) / Math.sqrt(d2 + 1); p.vx += dx * f; p.vy += dy * f; }
        p.x += p.vx * fr; p.y += p.vy * fr;
        if (p.a <= 0 && p.die) continue;
        keepParts.push(p);
        if (p.seed < haze) g.fillStyle = 'rgba(206,196,172,' + (p.a * 0.62).toFixed(3) + ')';
        else g.fillStyle = 'rgba(255,255,255,' + (p.a * (p.sq ? 0.72 : 1)).toFixed(3) + ')';
        if (p.sq) g.fillRect(p.x - 1.3, p.y - 1.3, 2.6, 2.6); else g.fillRect(p.x - 0.9, p.y - 0.9, 1.9, 1.9);
      }
      parts = keepParts;
    },
  };
  window.addEventListener('pointermove', (e) => { const b = cv.getBoundingClientRect(); ptr.x = e.clientX - b.left; ptr.y = e.clientY - b.top; });
  // phones resize the viewport height while scrolling (address bar); only width changes need a new layout
  let lastW = window.innerWidth;
  window.addEventListener('resize', () => {
    if (window.innerWidth === lastW) return;
    lastW = window.innerWidth;
    clearTimeout(resizeT); resizeT = window.setTimeout(PW.relayout, 150);
  });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => PW.relayout());
  return PW;
}
