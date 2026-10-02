/**
 * 3D globe: dark sphere, white graticule, dotted land, white coastlines, city light pillars sized
 * by PM2.5, crop-fire embers, smoke drift, value labels, and spin / zoom / fly-to controls.
 */
import * as THREE from 'three';
import { feature } from 'topojson-client';
import { CATS, catIdx, qOf } from '../core/aqi';
import { $, clamp, lerp, reduce, rng, pixelRatio } from '../core/util';
import type { CitySeries } from '../data';
import { app, pmAt, smokeAt } from '../state';
import { setCity } from '../ui/controls';
import { renderRanks } from '../ui/india';
import worldTopo from './world-topo.json';

interface CityMark {
  c: CitySeries; n: THREE.Vector3; pil: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  cap: THREE.Sprite; halo: THREE.Sprite; grove: THREE.Sprite; lab: HTMLElement; dot: HTMLElement; val: HTMLElement;
  grow: number; delay: number; lastPm: number; kick: number; sx: number; sy: number; face: number;
  pri: number; show: boolean; lx: number; ly: number;
  ci: number; shown: boolean | null; tf: string; sel: boolean | null;
}

export function initGlobe(): { refresh(): void; tick(now: number, dt: number): void } | null {
  const wrap = document.querySelector('.map-wrap') as HTMLElement, cv = $('globe') as HTMLCanvasElement, mapTip = $('mapTip');
  function fail(): null {
    $('gfail').hidden = false; cv.style.display = 'none';
    (document.querySelector('.gctl') as HTMLElement).hidden = true; $('ghint').hidden = true;
    return null;
  }
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); } catch (e) { return fail(); }
  renderer.setPixelRatio(pixelRatio());
  const scene = new THREE.Scene(), cam = new THREE.PerspectiveCamera(30, 1, 0.05, 60);
  const G = new THREE.Group(); G.rotation.order = 'XYZ'; scene.add(G);
  const D2R = Math.PI / 180, Yax = new THREE.Vector3(0, 1, 0);
  function v3(lat: number, lon: number, r: number): THREE.Vector3 {
    const la = lat * D2R, lo = lon * D2R;
    return new THREE.Vector3(r * Math.cos(la) * Math.sin(lo), r * Math.sin(la), r * Math.cos(la) * Math.cos(lo));
  }
  function texDot(inner: number, outer: number): THREE.CanvasTexture {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(inner, 'rgba(255,255,255,.6)'); gr.addColorStop(outer, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  const dotTex = texDot(0.35, 1), haloTex = texDot(0.18, 1);
  const groveTex = (function () {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!; g.fillStyle = '#fff';
    for (let k = 0; k < 9; k++) { const a = (k / 9) * 6.283; g.beginPath(); g.arc(64 + Math.cos(a) * 34, 64 + Math.sin(a) * 34, 10, 0, 6.283); g.fill(); }
    g.beginPath(); g.arc(64, 64, 15, 0, 6.283); g.fill();
    return new THREE.CanvasTexture(c);
  })();
  const VS = 'varying vec3 vN;varying vec3 vV;void main(){vN=normalize(normalMatrix*normal);vec4 mv=modelViewMatrix*vec4(position,1.);vV=normalize(-mv.xyz);gl_Position=projectionMatrix*mv;}';
  const oceanU = { uQ: { value: 0 } };
  G.add(new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), new THREE.ShaderMaterial({
    uniforms: oceanU, vertexShader: VS,
    fragmentShader: 'uniform float uQ;varying vec3 vN;varying vec3 vV;void main(){float d=max(dot(vN,vV),0.);float f=1.-d;vec3 base=vec3(.012,.016,.014)+vec3(.02,.024,.022)*d;float rim=smoothstep(.86,.985,f);gl_FragColor=vec4(base+vec3(.92,.95,.93)*rim+vec3(.06,.07,.065)*pow(f,3.),1.);}',
  })));
  const atmU = { uC: { value: new THREE.Color('#e9f0ea') } };
  const atm = new THREE.Mesh(new THREE.SphereGeometry(1.16, 64, 48), new THREE.ShaderMaterial({
    uniforms: atmU, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, vertexShader: VS,
    fragmentShader: 'uniform vec3 uC;varying vec3 vN;varying vec3 vV;void main(){float i=pow(clamp(-dot(vN,vV)*2.2,0.,1.),3.);gl_FragColor=vec4(uC*i*.28,i*.28);}',
  }));
  scene.add(atm);
  // graticule
  (function () {
    const pts: number[] = [];
    for (let la = -75; la <= 75; la += 15) for (let lo = -180; lo < 180; lo += 3) { const a = v3(la, lo, 1.0015), b = v3(la, lo + 3, 1.0015); pts.push(a.x, a.y, a.z, b.x, b.y, b.z); }
    for (let lo2 = -180; lo2 < 180; lo2 += 15) for (let la2 = -84; la2 < 84; la2 += 3) { const c = v3(la2, lo2, 1.0015), d = v3(la2 + 3, lo2, 1.0015); pts.push(c.x, c.y, c.z, d.x, d.y, d.z); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    G.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.2, depthWrite: false })));
  })();
  // land as dots, plus coastlines
  (function () {
    try {
      const topo = worldTopo as any;
      const fc = feature(topo, topo.objects[Object.keys(topo.objects)[0]]) as any;
      const W = 2048, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H;
      const g = c.getContext('2d')!; g.fillStyle = '#fff';
      const polysOf = (gm: any): number[][][][] => (gm.type === 'Polygon' ? [gm.coordinates] : gm.type === 'MultiPolygon' ? gm.coordinates : []);
      fc.features.forEach((f: any) => {
        const gm = f.geometry; if (!gm) return;
        polysOf(gm).forEach((poly) => {
          [-360, 0, 360].forEach((off) => {
            g.beginPath();
            poly.forEach((ring) => {
              let prev: number | null = null, acc = 0;
              ring.forEach((pt, i) => {
                const lon = pt[0];
                if (prev !== null) { const dd = lon - prev; if (dd > 180) acc -= 360; else if (dd < -180) acc += 360; }
                prev = lon;
                const x = ((lon + acc + off + 180) / 360) * W, y = ((90 - pt[1]) / 180) * H;
                if (i) g.lineTo(x, y); else g.moveTo(x, y);
              });
              g.closePath();
            });
            g.fill('evenodd');
          });
        });
      });
      const data = g.getImageData(0, 0, W, H).data, pos: number[] = [], col: number[] = [],
        cA = new THREE.Color('#9da39e'), cB = new THREE.Color('#f2f4ee'), tmp = new THREE.Color();
      for (let la = -84; la <= 84; la += 1.0) {
        const step = 1.0 / Math.max(Math.cos(la * D2R), 0.12);
        for (let lo = -180; lo < 180; lo += step) {
          const x = Math.floor(((lo + 180) / 360) * W), y = Math.floor(((90 - la) / 180) * H);
          if (data[(y * W + x) * 4 + 3] > 128) {
            const p = v3(la, lo, 1.003); pos.push(p.x, p.y, p.z);
            const near = Math.max(0, 1 - Math.hypot(la - 22, (lo - 80) * 0.85) / 30);
            tmp.copy(cA).lerp(cB, 0.25 + near * 0.75); col.push(tmp.r, tmp.g, tmp.b);
          }
        }
      }
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); lg.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      G.add(new THREE.Points(lg, new THREE.PointsMaterial({ size: 0.0105, vertexColors: true, map: dotTex, transparent: true, depthWrite: false, alphaTest: 0.04 })));
      const cs: number[] = [];
      fc.features.forEach((f: any) => {
        const gm = f.geometry; if (!gm) return;
        polysOf(gm).forEach((poly) => {
          const ring = poly[0];
          for (let i = 1; i < ring.length; i++) {
            const a = ring[i - 1], b = ring[i];
            if (Math.abs(a[0] - b[0]) > 180) continue;
            const pa = v3(a[1], a[0], 1.0035), pb = v3(b[1], b[0], 1.0035); cs.push(pa.x, pa.y, pa.z, pb.x, pb.y, pb.z);
          }
        });
      });
      const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cs, 3));
      G.add(new THREE.LineSegments(cg, new THREE.LineBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.75, depthWrite: false })));
    } catch (err) {
      console.warn('land dots', err);
    }
  })();
  // cities: pillar + halo + grove
  const pillarGeo = new THREE.CylinderGeometry(0.0026, 0.0026, 1, 6, 1, true); pillarGeo.translate(0, 0.5, 0);
  const CM: CityMark[] = app.D.cities.map((c, i) => {
    const n = v3(c.lat, c.lon, 1).normalize(), base = n.clone().multiplyScalar(1.003);
    const pil = new THREE.Mesh(pillarGeo, new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
    pil.position.copy(base); pil.quaternion.setFromUnitVectors(Yax, n); G.add(pil);
    const cap = new THREE.Sprite(new THREE.SpriteMaterial({ map: dotTex, color: '#fff', transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); G.add(cap);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTex, color: '#fff', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending }));
    halo.position.copy(n.clone().multiplyScalar(1.006)); G.add(halo);
    const grove = new THREE.Sprite(new THREE.SpriteMaterial({ map: groveTex, color: '#cfe6b4', transparent: true, depthWrite: false }));
    grove.position.copy(n.clone().multiplyScalar(1.008)); G.add(grove);
    const lab = document.createElement('div'); lab.className = 'glabel'; lab.innerHTML = '<i></i><span>' + c.name + '</span><b></b>'; $('glabels').appendChild(lab);
    return { c, n, pil, cap, halo, grove, lab, dot: lab.querySelector('i')!, val: lab.querySelector('b')!, grow: 0, delay: i * 45, lastPm: -1, kick: 0, sx: 0, sy: 0, face: 0, pri: 0, show: false, lx: 0, ly: 0, ci: -1, shown: null, tf: '', sel: null };
  });
  // halos and grove sprites were sized for ~20 cities; with many more they merge into one glow,
  // so they shrink with the city count (unchanged for <= 25 cities, e.g. the demo)
  const DENS = clamp(Math.sqrt(25 / Math.max(CM.length, 1)), 0.45, 1);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.018, 0.022, 40), new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  G.add(ring);
  // fires and smoke streaks
  const FIRES = app.D.fires;
  const FN = FIRES.length, fpos = new Float32Array(FN * 3), fcol = new Float32Array(FN * 3);
  FIRES.forEach((f, i) => { const p = v3(f.lat, f.lon, 1.005); fpos[i * 3] = p.x; fpos[i * 3 + 1] = p.y; fpos[i * 3 + 2] = p.z; });
  const fg = new THREE.BufferGeometry(); fg.setAttribute('position', new THREE.BufferAttribute(fpos, 3)); fg.setAttribute('color', new THREE.BufferAttribute(fcol, 3));
  G.add(new THREE.Points(fg, new THREE.PointsMaterial({ size: 0.022, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  const WIND: { lat: number; lon: number; a: number }[] = [];
  { const r = rng(99); for (let k = 0; k < 90; k++) WIND.push({ lat: 24 + r() * 8.5, lon: 72 + r() * 14, a: r() }); }
  const WN = WIND.length, wpos = new Float32Array(WN * 3), wcol = new Float32Array(WN * 3);
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.BufferAttribute(wpos, 3)); wg.setAttribute('color', new THREE.BufferAttribute(wcol, 3));
  G.add(new THREE.Points(wg, new THREE.PointsMaterial({ size: 0.016, map: dotTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
  // stars
  (function () {
    const sp: number[] = [], r = rng(5);
    for (let k = 0; k < 700; k++) { const v = new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize().multiplyScalar(18 + r() * 10); sp.push(v.x, v.y, v.z); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    scene.add(new THREE.Points(sg, new THREE.PointsMaterial({ size: 0.05, map: dotTex, color: '#dfe9d6', transparent: true, opacity: 0.55, depthWrite: false })));
  })();

  /* ---- camera control ---- */
  const HOME = { lat: 21.5, lon: 80, dist: 2.45 };
  interface Fly { a: { lat: number; lon: number; dist: number }; b: { lat: number; lon: number; dist: number }; t0: number; dur: number; }
  const st = {
    lat: HOME.lat, lon: HOME.lon, dist: HOME.dist, tDist: HOME.dist, vLat: 0, vLon: 0,
    drag: null as null | { x: number; y: number; x0: number; y0: number; t: number },
    engaged: false, fly: null as Fly | null, vis: false, growT0: 0,
    sel: null as CityMark | null, hover: null as CityMark | null,
    pts: {} as Record<number, { x: number; y: number }>, pinch: null as null | { d: number; dist: number },
  };
  function wrapLon(l: number): number { return ((l + 540) % 360) - 180; }
  function flyTo(lat: number, lon: number, dist: number, dur: number): void {
    const dl = wrapLon(lon - st.lon);
    st.fly = { a: { lat: st.lat, lon: st.lon, dist: st.dist }, b: { lat, lon: st.lon + dl, dist }, t0: performance.now(), dur: reduce ? 1 : dur };
    st.vLat = st.vLon = 0;
  }
  function intro(): void {
    if (reduce) { st.lat = HOME.lat; st.lon = HOME.lon; st.dist = st.tDist = HOME.dist; st.growT0 = performance.now() - 5000; return; }
    st.lat = 8; st.lon = HOME.lon - 110; st.dist = st.tDist = 4.4;
    flyTo(HOME.lat, HOME.lon, HOME.dist, 2600); st.tDist = HOME.dist; st.growT0 = performance.now() + 1500;
    CM.forEach((m) => { m.grow = 0; });
  }
  const hint = $('ghint');
  function setHint(t: string): void { hint.textContent = t; }
  cv.addEventListener('pointerdown', (e) => {
    st.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    const ids = Object.keys(st.pts);
    if (ids.length === 2) { const a = st.pts[+ids[0]], b = st.pts[+ids[1]]; st.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: st.tDist }; st.drag = null; }
    else st.drag = { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, t: performance.now() };
    st.engaged = true; st.fly = null; cv.classList.add('dragging'); cv.setPointerCapture(e.pointerId);
    setHint('Scroll or pinch to zoom · drag to spin');
  });
  cv.addEventListener('pointermove', (e) => {
    const r = cv.getBoundingClientRect();
    if (st.pts[e.pointerId]) st.pts[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (st.pinch && Object.keys(st.pts).length === 2) {
      const ids = Object.keys(st.pts), a = st.pts[+ids[0]], b = st.pts[+ids[1]], d = Math.hypot(a.x - b.x, a.y - b.y);
      st.tDist = clamp((st.pinch.dist * st.pinch.d) / Math.max(d, 1), 1.28, 4.4);
      return;
    }
    if (st.drag) {
      const dx = e.clientX - st.drag.x, dy = e.clientY - st.drag.y; st.drag.x = e.clientX; st.drag.y = e.clientY;
      const k = (0.22 * (st.dist - 1)) / 1.4;
      st.lon -= dx * k; st.lat = clamp(st.lat + dy * k, -75, 75); st.vLon = -dx * k * 60; st.vLat = dy * k * 60;
      return;
    }
    hoverAt(e.clientX - r.left, e.clientY - r.top);
  });
  function endPtr(e: PointerEvent): void {
    delete st.pts[e.pointerId];
    if (Object.keys(st.pts).length < 2) st.pinch = null;
    if (st.drag) {
      const moved = Math.hypot(e.clientX - st.drag.x0, e.clientY - st.drag.y0);
      if (moved < 5) { const r = cv.getBoundingClientRect(), m = pick(e.clientX - r.left, e.clientY - r.top); if (m) select(m); st.vLat = st.vLon = 0; }
    }
    st.drag = null; cv.classList.remove('dragging');
  }
  cv.addEventListener('pointerup', endPtr); cv.addEventListener('pointercancel', endPtr);
  cv.addEventListener('pointerleave', () => { if (!st.drag) { mapTip.hidden = true; st.hover = null; } });
  wrap.addEventListener('pointerleave', () => { st.engaged = false; setHint('Drag to spin · click, then scroll to zoom'); });
  cv.addEventListener('wheel', (e) => {
    if (!st.engaged && !e.ctrlKey) return;
    e.preventDefault(); st.fly = null; st.tDist = clamp(st.tDist * Math.exp(e.deltaY * 0.0011), 1.28, 4.4);
  }, { passive: false });
  $('gIn').addEventListener('click', () => { st.fly = null; st.tDist = clamp(st.tDist * 0.78, 1.28, 4.4); });
  $('gOut').addEventListener('click', () => { st.fly = null; st.tDist = clamp(st.tDist / 0.78, 1.28, 4.4); });
  $('gHome').addEventListener('click', () => { flyTo(HOME.lat, HOME.lon, HOME.dist, 1400); });
  // reused vectors and a per-frame canvas size: this runs for every city every frame, and
  // reading clientWidth between DOM writes would force a layout each time
  const sw = new THREE.Vector3(), sn = new THREE.Vector3(), sc = new THREE.Vector3();
  let cvW = cv.clientWidth, cvH = cv.clientHeight;
  function screenOf(m: CityMark, out: { x: number; y: number; face: number }): typeof out {
    sw.copy(m.n).multiplyScalar(1.01).applyMatrix4(G.matrixWorld);
    sn.copy(m.n).applyQuaternion(G.quaternion);
    out.face = sn.dot(sc.copy(cam.position).sub(sw).normalize());
    sw.project(cam);
    out.x = (sw.x * 0.5 + 0.5) * cvW; out.y = (-sw.y * 0.5 + 0.5) * cvH;
    return out;
  }
  function pick(x: number, y: number): CityMark | null {
    let best: CityMark | null = null, bd = 24 * 24;
    const o = { x: 0, y: 0, face: 0 };
    CM.forEach((m) => {
      screenOf(m, o);
      if (o.face < 0.08) return;
      const d = (o.x - x) * (o.x - x) + (o.y - y) * (o.y - y);
      if (d < bd) { bd = d; best = m; }
    });
    return best;
  }
  function hoverAt(x: number, y: number): void {
    const m = pick(x, y);
    st.hover = m; cv.style.cursor = m ? 'pointer' : '';
    if (!m) { mapTip.hidden = true; return; }
    const c = m.c, pm = pmAt(c, app.T), ci = catIdx(pm),
      label = app.T <= app.D.now ? 'Observed' : c.ready ? 'Airgrove forecast' : 'Observed only · not enough history to forecast';
    mapTip.innerHTML = '<b>' + c.name + '</b><br><span style="color:' + CATS[ci].c + '">●</span> ' + Math.round(pm) + ' µg/m³ · ' + CATS[ci].n + '<br><span style="color:var(--ink-faint)">' + label + '</span><br><span style="color:var(--lichen)">Click to fly there</span>';
    mapTip.hidden = false;
    const w = cv.clientWidth;
    mapTip.style.left = Math.min(x + 16, w - 220) + 'px';
    mapTip.style.top = Math.max(10, y - 20) + 'px';
  }
  function select(m: CityMark): void {
    st.sel = m; flyTo(m.c.lat, m.c.lon, 1.6, 1500);
    if (m.c.ready) setCity(m.c);
    renderRanks();
  }
  function size(): void {
    const w = wrap.clientWidth, h = wrap.clientHeight;
    renderer.setSize(w, h, false); cam.aspect = w / h; cam.updateProjectionMatrix();
    cvW = cv.clientWidth; cvH = cv.clientHeight;
  }
  window.addEventListener('resize', size); size();
  if ('IntersectionObserver' in window) {
    new IntersectionObserver((es) => { const was = st.vis; st.vis = es[0].isIntersecting; if (st.vis && !was) intro(); }, { threshold: 0.12 }).observe(wrap);
  } else { st.vis = true; intro(); }
  function easeIO(u: number): number { return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2; }
  const CLEAN = new THREE.Color('#cfe6b4'), GREY = new THREE.Color('#8a8577'), tmpC = new THREE.Color(), o = { x: 0, y: 0, face: 0 };

  return {
    refresh(): void { /* the globe reads app state every frame */ },
    tick(now: number, dt: number): void {
      if (!st.vis) return;
      const T = app.T, city = app.city;
      if (st.fly) {
        const u = clamp((now - st.fly.t0) / st.fly.dur, 0, 1), e = easeIO(u), a = st.fly.a, b = st.fly.b;
        st.lat = lerp(a.lat, b.lat, e); st.lon = lerp(a.lon, b.lon, e); st.dist = lerp(a.dist, b.dist, e); st.tDist = st.dist;
        if (u >= 1) st.fly = null;
      } else if (!st.drag) {
        st.lon += st.vLon * dt; st.lat = clamp(st.lat + st.vLat * dt, -75, 75);
        st.vLon *= Math.exp(-dt * 3.2); st.vLat *= Math.exp(-dt * 3.2);
        st.dist += (st.tDist - st.dist) * (1 - Math.exp(-dt * 7));
      }
      G.rotation.set(st.lat * D2R, -st.lon * D2R, 0); cam.position.set(0, 0, st.dist); cam.lookAt(0, 0, 0); G.updateMatrixWorld();
      const q = app.qTarget, smoke = smokeAt(T), tt = now / 1000;
      oceanU.uQ.value = q; atmU.uC.value.set('#9fd1a8').lerp(new THREE.Color('#c8b893'), q * 0.6);
      const zoomK = clamp((st.dist - 1) / 1.45, 0.35, 2.4);
      CM.forEach((m) => {
        const c = m.c, pm = pmAt(c, T), ci = catIdx(pm), qq = qOf(pm), col = CATS[ci].c;
        const gT = clamp((now - st.growT0 - m.delay) / 1100, 0, 1); m.grow += (easeIO(gT) - m.grow) * 0.25;
        const hgt = (0.02 + (Math.min(pm, 420) / 420) * 0.26) * m.grow * (1 + m.kick * 0.25);
        if (ci !== m.ci) { m.ci = ci; m.pil.material.color.set(col); m.cap.material.color.set(col); m.halo.material.color.set(col); }
        m.pil.scale.set(1, Math.max(hgt, 0.0001), 1); m.pil.material.opacity = 0.85 * m.grow;
        m.cap.position.copy(m.n).multiplyScalar(1.003 + hgt); m.cap.scale.setScalar(0.02 * zoomK * (0.6 + 0.4 * m.grow)); m.cap.material.opacity = m.grow;
        const pulse = 1 + 0.08 * Math.sin(tt * 2 + c.lat);
        m.halo.scale.setScalar((0.04 + Math.sqrt(pm) * 0.0045) * zoomK * pulse * DENS); m.halo.material.opacity = 0.55 * m.grow;
        tmpC.copy(CLEAN).lerp(GREY, qq); m.grove.material.color.copy(tmpC); m.grove.material.opacity = (qq < 0.5 ? 1 : 0.7) * m.grow; m.grove.scale.setScalar(0.028 * zoomK * (1 - qq * 0.35) * DENS);
        if (Math.round(pm) !== m.lastPm) {
          if (m.lastPm >= 0 && Math.abs(pm - m.lastPm) > 3) m.kick = 1;
          m.lastPm = Math.round(pm); m.val.textContent = String(m.lastPm); m.dot.style.background = col;
        }
        m.kick *= Math.exp(-dt * 5);
        screenOf(m, o); m.sx = o.x; m.sy = o.y; m.face = o.face;
      });
      // labels: value chips, placed by priority so they never overlap
      const placed: { x: number; y: number; w: number; h: number }[] = [], cand = CM.filter((m) => m.face > 0.12 && m.grow > 0.4);
      cand.forEach((m) => { m.pri = (m.c === city ? 1e5 : 0) + (m === st.hover ? 5e4 : 0) + (m.c.label ? 400 : 0) + pmAt(m.c, T); });
      cand.sort((a, b) => b.pri - a.pri);
      CM.forEach((m) => { m.show = false; });
      cand.forEach((m) => {
        const w = (m.c.name.length + 4) * 6.6 + 26, h = 22, x = m.c.labelLeft ? m.sx - 12 - w : m.sx + 12, y = m.sy - 11;
        const hit = placed.some((r) => x < r.x + r.w + 4 && x + w + 4 > r.x && y < r.y + r.h + 3 && y + h + 3 > r.y);
        if (!hit || m.c === city) { placed.push({ x, y, w, h }); m.show = true; m.lx = x; m.ly = y; }
      });
      CM.forEach((m) => {
        // touch the DOM only when something changed (hundreds of labels with real data)
        if (m.show !== m.shown) { m.shown = m.show; m.lab.style.opacity = m.show ? '1' : '0'; }
        if (m.show) {
          const tf = 'translate(' + m.lx.toFixed(1) + 'px,' + m.ly.toFixed(1) + 'px)';
          if (tf !== m.tf) { m.tf = tf; m.lab.style.transform = tf; }
        }
        const isSel = m.c === city;
        if (isSel !== m.sel) { m.sel = isSel; m.lab.classList.toggle('sel', isSel); }
      });
      const selM = CM.filter((m) => m.c === city)[0];
      if (selM) {
        ring.visible = true; ring.position.copy(selM.n).multiplyScalar(1.004);
        ring.lookAt(selM.n.clone().multiplyScalar(2).applyMatrix4(G.matrixWorld));
        ring.scale.setScalar((1 + 0.15 * Math.sin(tt * 3)) * zoomK);
      }
      for (let i = 0; i < FN; i++) {
        const f = FIRES[i], age = T - f.i, br = age < 0 || age > 48 ? 0 : (1 - age / 48) * (0.65 + 0.35 * Math.sin(tt * 6 + f.ph)) * (0.4 + f.frp / 60);
        fcol[i * 3] = br; fcol[i * 3 + 1] = br * 0.55; fcol[i * 3 + 2] = br * 0.2;
      }
      (fg.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      for (let j = 0; j < WN; j++) {
        const w = WIND[j], ph = (tt * 0.06 * (reduce ? 0.3 : 1) + w.a) % 1, lt = w.lat - ph * 2.2, ln = w.lon + ph * 5.5, p = v3(lt, ln, 1.012), ok = ln <= 88 && lt >= 23.5 && smoke > 0.2;
        const a2 = ok ? (Math.sin(ph * Math.PI) * 0.5 * (smoke - 0.2)) / 0.8 : 0;
        wpos[j * 3] = p.x; wpos[j * 3 + 1] = p.y; wpos[j * 3 + 2] = p.z; wcol[j * 3] = a2 * 0.8; wcol[j * 3 + 1] = a2 * 0.76; wcol[j * 3 + 2] = a2 * 0.68;
      }
      (wg.attributes.position as THREE.BufferAttribute).needsUpdate = true; (wg.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      renderer.render(scene, cam);
    },
  };
}
