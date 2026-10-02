/**
 * The air card: a wavy 3D paper card. Front = the selected city at the slider hour with a
 * liquid-glass PM2.5 badge; back = model accuracy. Drag to turn, hover to light it.
 */
import * as THREE from 'three';
import { CATS, catIdx } from '../core/aqi';
import { fDay, fHr, fWk, fYr, tms } from '../core/time';
import { $, clamp, hexA, reduce, pixelRatio } from '../core/util';
import { app, pmAt, ready, type Card } from '../state';

export function initCard(): Card | null {
  const stage = $('cardStage'), cv = $('cardCv') as HTMLCanvasElement;
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); } catch (e) { return null; }
  renderer.setPixelRatio(pixelRatio());
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.1, 20); cam.position.set(0, 0, 3.35);
  const CW = 1024, CH = 1400;
  function mk(): HTMLCanvasElement { const c = document.createElement('canvas'); c.width = CW; c.height = CH; return c; }
  const front = mk(), back = mk();
  const tF = new THREE.CanvasTexture(front), tB = new THREE.CanvasTexture(back);
  [tF, tB].forEach((t) => { t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.minFilter = THREE.LinearMipmapLinearFilter; });
  const U = {
    uFront: { value: tF }, uBack: { value: tB }, uTime: { value: 0 }, uHover: { value: 0 }, uQ: { value: 0 },
    uLight: { value: new THREE.Vector3(0.6, 0.8, 2) }, uBend: { value: 0 }, uFlut: { value: 0 },
    uPtr: { value: new THREE.Vector2(9, 9) }, uRip: { value: 9 }, uRipP: { value: new THREE.Vector2(0, 0) },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms: U, side: THREE.DoubleSide, transparent: true,
    vertexShader: [
      'uniform float uTime,uBend,uFlut,uHover,uRip;uniform vec2 uPtr,uRipP;varying vec2 vUv;varying vec3 vN;varying vec3 vPos;',
      'float dz(vec2 p){float t=uTime;float a=.62+.38*(p.x+.5);',
      ' float z=.075*a*sin(p.x*3.1-t*1.45+p.y*1.3)+.042*sin(p.y*3.7+t*1.05+p.x*.9)+.018*sin(p.x*7.3+p.y*5.1-t*2.2);',
      ' z+=uFlut*(.10*sin(p.x*5.2-t*7.)*(p.x+.5)+.05*sin(p.y*6.-t*5.3));',
      ' z+=uBend*.12*p.x*p.x;',
      ' z+=.17*pow(max(0.,p.x+p.y-.6),2.)-.13*pow(max(0.,-p.x-p.y-.7),2.);',
      ' float d=distance(p,uPtr);z+=uHover*.028*exp(-d*5.)*sin(d*26.-t*7.);',
      ' float r=distance(p,uRipP);float w=uRip*1.6;float k=(r-w)*7.;z+=.06*exp(-uRip*1.8)*exp(-k*k)*sin(r*18.-uRip*14.);',
      ' return z;}',
      'void main(){vUv=uv;vec3 p=position;float z=dz(p.xy);float e=.006;',
      ' vec3 tx=vec3(e,0.,dz(p.xy+vec2(e,0.))-z);vec3 ty=vec3(0.,e,dz(p.xy+vec2(0.,e))-z);',
      ' vN=normalize(normalMatrix*normalize(cross(tx,ty)));p.z+=z;',
      ' p.y+=.012*sin(p.x*4.6+uTime*1.3)*(abs(p.y)*1.4);p.x+=.008*sin(p.y*3.9-uTime*1.1);',
      ' vec4 mv=modelViewMatrix*vec4(p,1.);vPos=mv.xyz;gl_Position=projectionMatrix*mv;}',
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D uFront,uBack;uniform vec3 uLight;uniform float uHover,uQ,uTime;varying vec2 vUv;varying vec3 vN;varying vec3 vPos;',
      'void main(){vec2 uv=vUv;vec3 n=normalize(vN);vec4 tex;',
      ' if(gl_FrontFacing){tex=texture2D(uFront,uv);}else{uv.x=1.-uv.x;tex=texture2D(uBack,uv);n=-n;}',
      ' vec3 V=normalize(-vPos);vec3 L=normalize(uLight-vPos);',
      ' float dif=.74+.36*max(dot(n,L),0.);',
      ' vec3 H=normalize(L+V);float spec=pow(max(dot(n,H),0.),70.)*(.25+1.05*uHover);',
      ' float wide=pow(max(dot(n,H),0.),8.)*(.05+.12*uHover);',
      ' float rim=pow(1.-max(dot(n,V),0.),3.)*.3;',
      ' float fib=fract(sin(dot(floor(uv*vec2(512.,700.)),vec2(12.9898,78.233)))*43758.5453);',
      ' vec3 c=tex.rgb*dif*(.97+.03*fib);',
      ' vec3 lightC=mix(vec3(1.,.98,.92),vec3(1.,.86,.66),uQ);',
      ' c+=lightC*(spec+wide)+vec3(.62,.8,.64)*rim*.5;',
      ' c=mix(c,c*vec3(1.,.95,.86),uQ*.22);',
      ' gl_FragColor=vec4(c,.97);}',
    ].join('\n'),
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, CH / CW, 72, 96), mat); scene.add(mesh);
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();

  /* ---- card artwork ---- */
  type Ctx = CanvasRenderingContext2D;
  const F = 'Lexend, ui-sans-serif, system-ui, sans-serif';
  function base(g: Ctx): void {
    const gr = g.createLinearGradient(0, 0, CW, CH); gr.addColorStop(0, '#14281b'); gr.addColorStop(0.55, '#0f1f15'); gr.addColorStop(1, '#0a140e');
    g.fillStyle = gr; g.fillRect(0, 0, CW, CH);
    g.strokeStyle = 'rgba(169,194,154,.05)'; g.lineWidth = 1;
    for (let x = 0; x <= CW; x += 32) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, CH); g.stroke(); }
    for (let y = 0; y <= CH; y += 32) { g.beginPath(); g.moveTo(0, y); g.lineTo(CW, y); g.stroke(); }
    g.strokeStyle = '#a9c29a'; g.lineWidth = 5;
    const m = 70, l = 64;
    [[m, m, 1, 1], [CW - m, m, -1, 1], [m, CH - m, 1, -1], [CW - m, CH - m, -1, -1]].forEach((c) => {
      g.beginPath(); g.moveTo(c[0], c[1] + c[3] * l); g.lineTo(c[0], c[1]); g.lineTo(c[0] + c[2] * l, c[1]); g.stroke();
    });
  }
  function txt(g: Ctx, t: string, x: number, y: number, size: number, weight: number, color: string, ls?: number, align?: CanvasTextAlign): void {
    g.font = (weight || 300) + ' ' + size + 'px ' + F; g.fillStyle = color; g.textAlign = align || 'left';
    if ('letterSpacing' in g) (g as any).letterSpacing = (ls || 0) + 'px';
    g.fillText(t, x, y);
    if ('letterSpacing' in g) (g as any).letterSpacing = '0px';
    g.textAlign = 'left';
  }
  function hexPath(g: Ctx, cx: number, cy: number, r: number): void {
    g.beginPath();
    for (let k = 0; k < 6; k++) { const a = Math.PI / 6 + (k * Math.PI) / 3; if (k) g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); else g.moveTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
    g.closePath();
  }
  function hline(g: Ctx, y: number): void {
    g.strokeStyle = 'rgba(220,235,210,.14)'; g.lineWidth = 2; g.beginPath(); g.moveTo(120, y); g.lineTo(CW - 120, y); g.stroke();
  }
  function drawFront(): void {
    const g = front.getContext('2d')!; base(g);
    const { city, T } = app, HRS = app.D.hours, NOW = app.D.now;
    const pm = pmAt(city, T), ci = catIdx(pm), col = CATS[ci].c;
    txt(g, '▶  AIR CARD  ·  ' + (T <= NOW ? 'OBSERVED' : 'FORECAST'), 120, 170, 26, 400, '#a9c29a', 6);
    hline(g, 200);
    txt(g, city.name, 120, 420, city.name.length > 11 ? 84 : 124, 300, '#ffffff', -2);
    txt(g, CATS[ci].n, 120, 505, 62, 400, col, 0);
    txt(g, (fWk.format(tms(T)) + ' ' + fDay.format(tms(T)) + ' ' + fYr.format(tms(T)) + ' · ' + fHr.format(tms(T)) + ' IST').toUpperCase(), 122, 562, 24, 400, 'rgba(238,242,232,.6)', 4);
    // liquid-glass badge: refracts and frosts whatever sits behind it (often the city name)
    const bx = CW - 230, by = 330, R = 124;
    const snap = document.createElement('canvas'); snap.width = CW; snap.height = CH; snap.getContext('2d')!.drawImage(front, 0, 0);
    g.save(); g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 44; g.shadowOffsetY = 18; hexPath(g, bx, by, R); g.fillStyle = 'rgba(14,26,18,.95)'; g.fill(); g.restore();
    g.save(); hexPath(g, bx, by, R); g.clip();
    const mag = 1.16;
    if ('filter' in g) g.filter = 'blur(6px) saturate(1.35) brightness(1.08)';
    g.drawImage(snap, 0, 0, CW, CH, bx - bx * mag, by - by * mag, CW * mag, CH * mag);
    g.filter = 'none';
    const tg = g.createLinearGradient(bx - R, by - R, bx + R, by + R);
    tg.addColorStop(0, 'rgba(255,255,255,.26)'); tg.addColorStop(0.42, hexA(col, 0.12)); tg.addColorStop(1, 'rgba(6,14,9,.42)');
    g.fillStyle = tg; g.fillRect(bx - R, by - R, R * 2, R * 2);
    const rg = g.createRadialGradient(bx, by + 6, 0, bx, by + 6, R * 0.82); rg.addColorStop(0, 'rgba(8,16,11,.5)'); rg.addColorStop(1, 'rgba(8,16,11,0)');
    g.fillStyle = rg; g.fillRect(bx - R, by - R, R * 2, R * 2);
    const sh = g.createLinearGradient(0, by - R, 0, by - R * 0.35); sh.addColorStop(0, 'rgba(255,255,255,.42)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sh; g.beginPath(); g.ellipse(bx - R * 0.18, by - R * 0.66, R * 0.62, R * 0.2, -0.32, 0, 6.283); g.fill();
    const bs = g.createLinearGradient(0, by + R * 0.55, 0, by + R); bs.addColorStop(0, 'rgba(0,0,0,0)'); bs.addColorStop(1, 'rgba(0,0,0,.35)');
    g.fillStyle = bs; g.fillRect(bx - R, by, R * 2, R);
    g.restore();
    g.lineJoin = 'round';
    ([['rgba(255,104,128,.6)', -1.8], ['rgba(104,186,255,.6)', 1.8]] as [string, number][]).forEach((e) => {
      g.save(); g.translate(e[1], e[1] * 0.4); hexPath(g, bx, by, R - 1.5); g.strokeStyle = e[0]; g.lineWidth = 2; g.stroke(); g.restore();
    });
    hexPath(g, bx, by, R);
    const eg = g.createLinearGradient(bx - R, by - R, bx + R, by + R);
    eg.addColorStop(0, 'rgba(255,255,255,.95)'); eg.addColorStop(0.5, 'rgba(255,255,255,.35)'); eg.addColorStop(1, 'rgba(255,255,255,.75)');
    g.strokeStyle = eg; g.lineWidth = 2.6; g.stroke();
    hexPath(g, bx, by, R - 15); g.strokeStyle = hexA(col, 0.9); g.lineWidth = 3; g.stroke();
    g.save(); g.shadowColor = 'rgba(0,0,0,.55)'; g.shadowBlur = 14;
    txt(g, 'PM2.5', bx, by - 46, 22, 400, hexA(col, 1), 5, 'center');
    txt(g, String(Math.round(pm)), bx, by + 30, 88, 300, '#ffffff', -2, 'center');
    txt(g, 'µg/m³', bx, by + 68, 22, 300, 'rgba(238,242,232,.85)', 1, 'center');
    g.restore();
    // next 72 h bars
    txt(g, 'NEXT 72 HOURS', 120, 660, 22, 400, 'rgba(238,242,232,.6)', 5);
    const vals: number[] = [];
    let mx = 0;
    for (let b = 0; b < 24; b++) {
      let sum = 0, n = 0;
      for (let h = 1; h <= 3; h++) { const i = Math.min(HRS - 1, T + b * 3 + h); sum += pmAt(city, i); n++; }
      vals.push(sum / n); mx = Math.max(mx, sum / n);
    }
    mx = Math.max(mx, 120);
    const bw = 24, gap = (CW - 240 - bw * 24) / 23, y0 = 880;
    vals.forEach((v, k) => { const hgt = Math.max(6, (v / mx) * 180), x = 120 + k * (bw + gap); g.fillStyle = hexA(CATS[catIdx(v)].c, 0.9); g.fillRect(x, y0 - hgt, bw, hgt); });
    txt(g, 'now', 120, 916, 20, 300, 'rgba(238,242,232,.5)', 2); txt(g, '+72 h', CW - 120, 916, 20, 300, 'rgba(238,242,232,.5)', 2, 'right');
    // stats
    let pk = T + 1, cl = T + 1, bad = 0;
    const end = Math.min(HRS - 1, T + 72);
    pk = Math.min(pk, HRS - 1); cl = Math.min(cl, HRS - 1);
    for (let j = T + 1; j <= end; j++) {
      const v2 = pmAt(city, j);
      if (j <= T + 24 && v2 > pmAt(city, pk)) pk = j;
      if (v2 < pmAt(city, cl)) cl = j;
      if (Math.round(v2) > 90) bad++;
    }
    const R2 = ready();
    const rank = R2.map((c) => ({ c, v: pmAt(c, T) })).sort((a, b) => a.v - b.v).findIndex((o) => o.c === city) + 1;
    const rows = [
      ['PEAK, NEXT 24 H', Math.round(pmAt(city, pk)) + '  ·  ' + fWk.format(tms(pk)) + ' ' + fHr.format(tms(pk))],
      ['CLEANEST HOUR AHEAD', Math.round(pmAt(city, cl)) + '  ·  ' + fWk.format(tms(cl)) + ' ' + fHr.format(tms(cl))],
      ['CLEAN-AIR RANK', '#' + rank + ' of ' + R2.length + ' cities'],
    ];
    hline(g, 960);
    rows.forEach((r, k) => { const y = 1022 + k * 72; txt(g, r[0], 120, y, 22, 400, 'rgba(238,242,232,.6)', 4); txt(g, r[1], CW - 120, y, 32, 300, '#ffffff', 0, 'right'); hline(g, y + 30); });
    // footer
    txt(g, 'AIRGROVE', 120, 1262, 30, 400, '#a9c29a', 8);
    txt(g, app.D.cardSource, 120, 1298, 20, 300, 'rgba(238,242,232,.45)', 1);
    const filled = Math.round((bad / 72) * 12);
    for (let d = 0; d < 12; d++) { g.fillStyle = d < filled ? hexA('#d0905c', 0.95) : 'rgba(220,235,210,.12)'; g.fillRect(CW - 120 - (12 - d) * 30 + 6, 1250, 22, 22); }
    txt(g, 'HOURS ABOVE MODERATE', CW - 120, 1298, 18, 400, 'rgba(238,242,232,.45)', 3, 'right');
    tF.needsUpdate = true;
  }
  function drawBack(): void {
    const g = back.getContext('2d')!; base(g);
    txt(g, '▶  HOW SURE ARE WE', 120, 170, 26, 400, '#a9c29a', 6); hline(g, 200);
    txt(g, 'Average error', 120, 330, 92, 300, '#ffffff', -2);
    txt(g, 'µg/m³, lower is better · ' + app.D.backtest.scope + ', last 12 months', 122, 385, 24, 300, 'rgba(238,242,232,.6)', 1);
    const step = app.D.model.length > 4 ? 24 : 30, barH = app.D.model.length > 4 ? 16 : 20;
    const HZ = ['1–6 h ahead', '7–24 h ahead', '25–72 h ahead'];
    let y = 490;
    HZ.forEach((hn, j) => {
      txt(g, hn.toUpperCase(), 120, y, 22, 400, 'rgba(238,242,232,.6)', 4); y += 26;
      app.D.model.forEach((m) => {
        const w = (m.mae[j] / 50) * 560; y += step;
        g.fillStyle = m.ours ? '#eef0e4' : hexA(m.color, 0.75); g.fillRect(120, y - 18, w, barH);
        txt(g, m.name.replace(' (last value)', ''), 120 + w + 16, y, 20, m.ours ? 400 : 300, m.ours ? '#ffffff' : 'rgba(238,242,232,.65)', 0);
        txt(g, m.mae[j].toFixed(1), CW - 120, y, 22, m.ours ? 400 : 300, m.ours ? '#ffffff' : 'rgba(238,242,232,.65)', 0, 'right');
      });
      y += 52;
    });
    hline(g, y - 30);
    txt(g, 'The 80% range held the real', 120, y + 36, 40, 300, '#ffffff', 0);
    txt(g, 'value ' + Math.round(100 * app.D.backtest.coverage) + '% of the time.', 120, y + 86, 40, 300, '#ffffff', 0);
    txt(g, 'AIRGROVE  ·  MODEL CARD', 120, 1262, 26, 400, '#a9c29a', 6);
    txt(g, app.D.source === 'demo' ? 'Backtest shown for Delhi in this demo' : 'Backtest across ' + app.D.backtest.scope + ', Oct 2025 – Sep 2026', 120, 1298, 20, 300, 'rgba(238,242,232,.45)', 1);
    tB.needsUpdate = true;
  }

  /* ---- interaction ---- */
  const R = { ptr: new THREE.Vector2(9, 9), flut: 0, rip: 9, y: -0.32, x: 0.06, face: 0, drag: false, lx: 0, ly: 0, vy: 0, hover: 0, ht: 0, vis: false, dirty: true, lastDraw: 0 };
  const lightT = new THREE.Vector3(0.7, 0.9, 2);
  stage.addEventListener('pointerdown', (e) => {
    R.rip = 0; U.uRipP.value.copy(R.ptr); R.drag = true; R.lx = e.clientX; R.ly = e.clientY; R.vy = 0;
    stage.classList.add('dragging'); stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    const b = stage.getBoundingClientRect(), nx = ((e.clientX - b.left) / b.width) * 2 - 1, ny = -(((e.clientY - b.top) / b.height) * 2 - 1);
    lightT.set(nx * 1.3, ny * 1.4, 1.5); R.ht = 1;
    ndc.set(nx, ny); ray.setFromCamera(ndc, cam);
    const hit = ray.intersectObject(mesh)[0];
    if (hit) { const lp = mesh.worldToLocal(hit.point.clone()); R.ptr.set(lp.x, lp.y); }
    if (R.drag) {
      const dx = e.clientX - R.lx, dy = e.clientY - R.ly; R.lx = e.clientX; R.ly = e.clientY;
      R.y += dx * 0.009; R.vy = dx * 0.009; R.x = clamp(R.x + dy * 0.004, -0.45, 0.45);
    }
  });
  function end(): void {
    if (!R.drag) return;
    R.drag = false; stage.classList.remove('dragging');
    R.face = Math.round((R.y + R.vy * 8) / Math.PI); R.flut = Math.max(R.flut, Math.min(1, Math.abs(R.vy) * 14));
  }
  stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
  stage.addEventListener('pointerleave', () => { R.ht = 0; lightT.set(0.7, 0.9, 2); });
  $('flipCard').addEventListener('click', () => { R.face += 1; R.flut = Math.max(R.flut, 1); });
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => { R.vis = es[0].isIntersecting; }, { rootMargin: '120px' }).observe(stage);
  else R.vis = true;
  function size(): void {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false); cam.aspect = w / h;
    const fit = ((CH / CW) * 1.12) / (2 * Math.tan((cam.fov * Math.PI) / 360));
    cam.position.z = Math.max(fit, 1.12 / cam.aspect / (2 * Math.tan((cam.fov * Math.PI) / 360)));
    cam.updateProjectionMatrix();
  }
  window.addEventListener('resize', size); size();
  const CARD: Card = {
    mark() { R.dirty = true; },
    redraw() { drawFront(); drawBack(); R.dirty = false; },
    tick(now, dt) {
      if (!R.vis) return;
      if (R.dirty && now - R.lastDraw > 160) { R.lastDraw = now; drawFront(); R.dirty = false; }
      const ent = typeof CARD.enter === 'number' && isFinite(CARD.enter) ? CARD.enter : 1;
      const t = (now / 1000) * (reduce ? 0.2 : 1);
      if (!R.drag) {
        const rest = R.face * Math.PI - 0.26 + Math.sin(t * 0.45) * 0.1 - (1 - (CARD.enter === undefined ? 1 : CARD.enter)) * 1.5;
        R.y += (rest - R.y) * (1 - Math.exp(-dt * 4));
        R.x += (0.06 + Math.sin(t * 0.37) * 0.05 - R.x) * (1 - Math.exp(-dt * 3));
      }
      R.hover += (R.ht - R.hover) * (1 - Math.exp(-dt * 6));
      mesh.rotation.set(R.x + (1 - ent) * 0.35, R.y, Math.sin(t * 0.3) * 0.035 + (1 - ent) * 0.2);
      mesh.position.y = Math.sin(t * 0.8) * 0.022 - (1 - ent) * 0.25;
      if (R.drag) R.flut = Math.max(R.flut, Math.min(1, Math.abs(R.vy) * 20));
      R.flut *= Math.exp(-dt * 1.6); R.rip += dt;
      const turnFlut = Math.min(1, Math.abs(R.face * Math.PI - 0.26 - R.y) * 0.9);
      U.uTime.value = t; U.uHover.value = R.hover; U.uQ.value = app.qTarget; U.uPtr.value.copy(R.ptr); U.uRip.value = reduce ? 9 : R.rip;
      U.uFlut.value = reduce ? 0 : Math.max(R.flut, turnFlut * 0.7, (1 - ent) * 1.2);
      U.uBend.value = clamp(R.vy * 7, -1.2, 1.2) * (R.drag ? 1 : 0) + Math.sin(t * 0.6) * 0.35 + (1 - ent) * 1.4;
      U.uLight.value.lerp(lightT, 1 - Math.exp(-dt * 6));
      renderer.render(scene, cam);
    },
  };
  CARD.redraw();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => CARD.redraw());
  return CARD;
}
