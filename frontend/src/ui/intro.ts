/** Opening: the "Airgrove" wordmark lit by a growing root network, a flower opens in the "o". */
import { $, clamp, reduce, rng, pixelRatio } from '../core/util';
import { app } from '../state';

interface Target { x: number; y: number; li: number; taken: boolean; lit: number; }
interface Node { x: number; y: number; vx: number; vy: number; t: Target | null; sp: number; ph: number; }
interface Letter { x0: number; x1: number; hit: number; tot: number; ch: string; }

const LINK_BANDS = 8;
// stroke colour for each band, at the band's mid opacity (links fade from 0.32 down to 0 with distance)
const BAND_STYLE = Array.from({ length: LINK_BANDS }, (_, k) => 'rgba(169,194,154,' + (((k + 0.5) / LINK_BANDS) * 0.32).toFixed(3) + ')');
const bands = Array.from({ length: LINK_BANDS }, () => new Float32Array(4 * 12000));
const bandLen = new Int32Array(LINK_BANDS);

export function initIntro(gate: Promise<unknown> = Promise.resolve()): { tick(now: number): void } | null {
  const ov = document.getElementById('intro');
  if (!ov) return null;
  if (reduce) { ov.remove(); return null; }
  const cv = $('introCv') as HTMLCanvasElement, g = cv.getContext('2d')!;
  let W = 0, H = 0, dpr = 1, font = '', base = 0, targets: Target[] = [], nodes: Node[] = [], letters: Letter[] = [],
    oCenter = { x: 0, y: 0, r: 0 }, t0 = 0, started = false, done = false;
  const TEXT = 'Airgrove';
  app.INTRO_END = performance.now() + 4200;
  function setup(): void {
    dpr = pixelRatio(); W = window.innerWidth; H = window.innerHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const fs = Math.round(clamp(W * 0.15, 58, 168));
    font = '300 ' + fs + 'px Lexend, ui-sans-serif, system-ui, sans-serif';
    // Only the wordmark's box is rasterised and read back (not the whole screen), on a canvas
    // flagged for readback so getImageData doesn't stall on a GPU round trip.
    const oc = document.createElement('canvas'); const c = oc.getContext('2d', { willReadFrequently: true })!;
    c.font = font;
    const tw = c.measureText(TEXT).width, ox = (W - tw) / 2;
    base = H * 0.5 + fs * 0.32;
    const bx = Math.max(0, Math.floor(ox - fs * 0.1)), by = Math.max(0, Math.floor(base - fs * 1.05));
    const bw = Math.min(W - bx, Math.ceil(tw + fs * 0.2)), bh = Math.min(H - by, Math.ceil(fs * 1.4));
    oc.width = bw; oc.height = bh; c.font = font; c.textBaseline = 'alphabetic';
    letters = [];
    for (let i = 0; i < TEXT.length; i++) {
      const wpre = c.measureText(TEXT.slice(0, i)).width, wl = c.measureText(TEXT[i]).width;
      letters.push({ x0: ox + wpre, x1: ox + wpre + wl, hit: 0, tot: 0, ch: TEXT[i] });
    }
    const o = letters[5]; oCenter = { x: (o.x0 + o.x1) / 2, y: base - fs * 0.255, r: fs * 0.2 };
    c.fillStyle = '#fff'; c.fillText(TEXT, ox - bx, base - by);
    const img = c.getImageData(0, 0, bw, bh).data, step = Math.max(4, Math.round(fs / 26));
    targets = [];
    // same screen-space grid as before, sampled only inside the box
    for (let y = Math.ceil(by / step) * step; y < by + bh; y += step) for (let x = Math.ceil(bx / step) * step; x < bx + bw; x += step) {
      if (img[((y - by) * bw + (x - bx)) * 4 + 3] > 120) {
        let li = 0; while (li < letters.length - 1 && x > letters[li].x1) li++;
        targets.push({ x, y, li, taken: false, lit: 0 }); letters[li].tot++;
      }
    }
    nodes = []; const r = rng(7);
    const spanW = letters[letters.length - 1].x1 - ox;
    for (let k = 0; k < 230; k++) nodes.push({ x: ox + r() * spanW, y: base + fs * 0.45 + r() * fs * 0.9, vx: (r() - 0.5) * 2, vy: -1 - r() * 2, t: null, sp: 0.6 + r() * 0.5, ph: r() * 6.28 });
  }
  function claim(n: Node): void {
    let best: Target | null = null, bd = 1e12;
    for (let k = 0; k < 14; k++) {
      const c = targets[Math.floor(Math.random() * targets.length)];
      if (!c || c.taken) continue;
      const d = (c.x - n.x) * (c.x - n.x) + (c.y - n.y) * (c.y - n.y);
      if (d < bd) { bd = d; best = c; }
    }
    if (best) { best.taken = true; n.t = best; }
  }
  function finish(): void {
    if (done) return;
    done = true; ov!.classList.add('out'); app.INTRO_END = performance.now();
    setTimeout(() => { ov!.remove(); }, 950);
  }
  ov.addEventListener('click', finish);
  window.addEventListener('keydown', (e) => { if (!done && (e.key === 'Escape' || e.key === ' ' || e.key === 'Enter')) finish(); });
  function start(): void {
    if (started) return;
    // a hidden/zero-size viewport (background tab) can't be measured yet; try again shortly
    if (!window.innerWidth || !window.innerHeight) { setTimeout(start, 200); return; }
    started = true; setup(); t0 = performance.now(); app.INTRO_END = t0 + 3600;
  }
  // Start once the font is ready and the page has finished its heavy setup (gate), so that work
  // never lands mid-animation. The overlay is a plain dark screen until then.
  const fontsReady = document.fonts && document.fonts.ready ? Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 700))]) : Promise.resolve();
  Promise.all([fontsReady, gate]).then(start, start);
  let lastI = 0;
  window.addEventListener('resize', () => { if (started && !done) setup(); });
  return {
    tick(now: number): void {
      if (!started || done) return;
      const t = (now - t0) / 1000, fr = lastI ? clamp((now - lastI) / 16.7, 0.5, 3) : 1; lastI = now;
      g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
      // nodes search, crawl and connect
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (!n.t || (n.t.lit >= 1 && Math.random() < 0.04)) claim(n);
        const tx = n.t ? n.t.x : W / 2, ty = n.t ? n.t.y : H / 2, dx = tx - n.x, dy = ty - n.y, d = Math.sqrt(dx * dx + dy * dy) + 1e-3;
        const acc = 0.95 * n.sp;
        n.vx = n.vx * 0.84 + (dx / d) * acc + Math.sin(t * 3 + n.ph) * 0.22;
        n.vy = n.vy * 0.84 + (dy / d) * acc + Math.cos(t * 2.6 + n.ph) * 0.22;
        n.x += n.vx * fr; n.y += n.vy * fr;
        if (n.t && d < 6) { if (!n.t.lit) { n.t.lit = 1; letters[n.t.li].hit++; } claim(n); }
      }
      // links
      // links: grouped into LINK_BANDS opacity bands, one path and one stroke per band
      g.lineWidth = 0.8;
      for (let k = 0; k < LINK_BANDS; k++) bandLen[k] = 0;
      for (let i = 0; i < nodes.length; i++) {
        const a = nodes[i];
        for (let j = i + 1; j < nodes.length; j++) {
          const b = nodes[j], ddx = a.x - b.x, ddy = a.y - b.y, dd = ddx * ddx + ddy * ddy;
          if (dd < 2400) {
            const k = Math.min(LINK_BANDS - 1, Math.floor((1 - dd / 2400) * LINK_BANDS)), arr = bands[k], o = bandLen[k];
            if (o + 4 > arr.length) continue;
            arr[o] = a.x; arr[o + 1] = a.y; arr[o + 2] = b.x; arr[o + 3] = b.y; bandLen[k] = o + 4;
          }
        }
      }
      for (let k = 0; k < LINK_BANDS; k++) {
        const arr = bands[k], len = bandLen[k];
        if (!len) continue;
        g.strokeStyle = BAND_STYLE[k]; g.beginPath();
        for (let o = 0; o < len; o += 4) { g.moveTo(arr[o], arr[o + 1]); g.lineTo(arr[o + 2], arr[o + 3]); }
        g.stroke();
      }
      // lit targets
      g.fillStyle = 'rgba(238,242,228,.55)';
      for (let i = 0; i < targets.length; i++) if (targets[i].lit) g.fillRect(targets[i].x - 0.8, targets[i].y - 0.8, 1.6, 1.6);
      g.fillStyle = 'rgba(220,236,200,.85)';
      for (let i = 0; i < nodes.length; i++) g.fillRect(nodes[i].x - 1.1, nodes[i].y - 1.1, 2.2, 2.2);
      // letters illuminate as the network reaches them
      g.font = font; g.textBaseline = 'alphabetic';
      for (let i = 0; i < letters.length; i++) {
        const L = letters[i], k = L.tot ? Math.min(1, (L.hit / L.tot) * 2.4) : 0;
        g.fillStyle = 'rgba(255,255,255,' + (0.07 + 0.93 * k).toFixed(3) + ')';
        if (k < 0.02) { g.fillText(L.ch, L.x0, base); continue; } // no glow yet: skip the costly blur pass
        g.save(); g.shadowColor = 'rgba(200,230,180,' + (0.55 * k).toFixed(3) + ')'; g.shadowBlur = 24 * k;
        g.fillText(L.ch, L.x0, base); g.restore();
      }
      // pale flower opens inside the "o"
      const bl = clamp((t - 2.0) / 1.0, 0, 1), e = 1 - Math.pow(1 - bl, 3);
      if (bl > 0) {
        g.save(); g.translate(oCenter.x, oCenter.y); g.rotate(t * 0.25);
        for (let pI = 0; pI < 5; pI++) {
          g.save(); g.rotate((pI * Math.PI * 2) / 5); g.fillStyle = 'rgba(243,242,232,' + (0.92 * e).toFixed(3) + ')';
          g.beginPath(); g.ellipse(oCenter.r * 0.55 * e, 0, oCenter.r * 0.5 * e, oCenter.r * 0.27 * e, 0, 0, 6.283); g.fill(); g.restore();
        }
        g.fillStyle = 'rgba(233,217,140,' + e.toFixed(3) + ')'; g.beginPath(); g.arc(0, 0, oCenter.r * 0.17 * e, 0, 6.283); g.fill(); g.restore();
      }
      if (t > 3.4) finish();
    },
  };
}
