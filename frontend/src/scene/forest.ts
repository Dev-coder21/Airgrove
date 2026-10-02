/**
 * The hero forest: moss, roots, ferns, pale flowers, pollen/dust and a butterfly, all driven by
 * the selected city's PM2.5 (app.qTarget) and the hour of day at the slider position.
 */
import * as THREE from 'three';
import { hIST } from '../core/time';
import { glPixelRatio, onQualityChange } from '../core/quality';
import { $, clamp, reduce } from '../core/util';
import { app } from '../state';

type Group = THREE.Group & { userData: Record<string, any> };

export function initForest(): { tick(dt: number): void } | null {
  const canvas = $('world') as HTMLCanvasElement;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  } catch (err) {
    return null;
  }
  const V3 = THREE.Vector3, SPEED = reduce ? 0.2 : 1;
  renderer.setPixelRatio(glPixelRatio());
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const FOG_CLEAN = new THREE.Color('#122318'), FOG_SMOG = new THREE.Color('#4d4a3f'), FOG_NIGHT = new THREE.Color('#0c171a');
  const fogCol = FOG_CLEAN.clone();
  const scene = new THREE.Scene();
  scene.background = fogCol;
  const fog = new THREE.FogExp2(fogCol.getHex(), 0.075);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
  const camBase = new V3(0, 2.1, 7.6), look = new V3(1.4, 0.85, 0);
  camera.position.copy(camBase);
  const lookTmp = new V3();

  const hemi = new THREE.HemisphereLight('#dfeccf', '#1a2616', 0.75); scene.add(hemi);
  const sun = new THREE.DirectionalLight('#fff1d2', 1.25); sun.position.set(6, 9, 4); scene.add(sun);
  const rim = new THREE.DirectionalLight('#9fd1a8', 0.45); rim.position.set(-6, 3, -6); scene.add(rim);
  const SUN_CLEAN = new THREE.Color('#fff1d2'), SUN_SMOG = new THREE.Color('#ffb27a'), HEMI_CLEAN = new THREE.Color('#dfeccf'), HEMI_SMOG = new THREE.Color('#d6cbb2');

  function rand(a: number, b: number): number { return a + Math.random() * (b - a); }
  function h(x: number, z: number): number {
    return 0.35 * Math.sin(x * 0.35 + z * 0.2) + 0.22 * Math.sin(z * 0.5 - x * 0.15) + 0.1 * Math.sin(x * 1.3) * Math.cos(z * 1.1) - 0.1;
  }

  // moss ground
  function mossTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d')!; g.fillStyle = '#b9cca6'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 6000; i++) {
      const l = Math.random();
      g.fillStyle = l < 0.5 ? 'rgba(80,110,62,' + rand(0.2, 0.6) + ')' : l < 0.85 ? 'rgba(220,236,196,' + rand(0.2, 0.6) + ')' : 'rgba(40,58,34,.7)';
      const s = rand(0.6, 2.4); g.fillRect(Math.random() * 256, Math.random() * 256, s, s);
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(18, 12); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4;
    return t;
  }
  const groundGeo = new THREE.PlaneGeometry(60, 40, 160, 110); groundGeo.rotateX(-Math.PI / 2);
  const gp = groundGeo.attributes.position as THREE.BufferAttribute, gcol: number[] = [],
    cA = new THREE.Color('#1e3a1e'), cB = new THREE.Color('#5c8a44'), tmp = new THREE.Color();
  for (let i = 0; i < gp.count; i++) {
    const x = gp.getX(i), z = gp.getZ(i), y = h(x, z); gp.setY(i, y);
    const m = 0.5 + 0.5 * Math.sin(x * 0.9 + Math.cos(z * 0.7) * 2.0) * Math.cos(z * 0.8 - x * 0.3);
    tmp.copy(cA).lerp(cB, Math.min(1, Math.max(0, m * 0.8 + y * 0.4))); gcol.push(tmp.r, tmp.g, tmp.b);
  }
  groundGeo.setAttribute('color', new THREE.Float32BufferAttribute(gcol, 3)); groundGeo.computeVertexNormals();
  const groundMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: mossTexture(), roughness: 1 });
  const ground = new THREE.Mesh(groundGeo, groundMat); ground.position.z = -8; scene.add(ground);
  function gh(x: number, z: number): number { return h(x, z + 8); }
  const WHITE = new THREE.Color('#ffffff'), GROUND_SMOG = new THREE.Color('#b4a789'), FERN_SMOG = new THREE.Color('#a8a070');

  // trunks
  const barkMat = new THREE.MeshStandardMaterial({ color: '#2a2419', roughness: 1 });
  [[-9, -14, 0.8], [-4, -18, 1.1], [3, -16, 0.7], [8, -13, 1.0], [13, -19, 1.3], [-14, -11, 0.9], [17, -10, 0.8]].forEach((t) => {
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(t[2] * 0.85, t[2] * 1.25, 22, 10), barkMat); tr.position.set(t[0], 10, t[1]); scene.add(tr);
  });

  // roots
  const rootMat = new THREE.MeshStandardMaterial({ color: '#3d2c1d', roughness: 0.9 });
  for (let r = 0; r < 8; r++) {
    const pts: THREE.Vector3[] = [], x0 = rand(-2, 9), z0 = rand(-6, 2);
    let ang = rand(0, Math.PI * 2);
    for (let k = 0; k < 7; k++) {
      const px = x0 + Math.cos(ang) * k * 0.9, pz = z0 + Math.sin(ang) * k * 0.9; ang += rand(-0.5, 0.5);
      const arch = k > 1 && k < 5 ? rand(0, 0.18) : 0; pts.push(new V3(px, gh(px, pz) + 0.03 + arch, pz));
    }
    scene.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, rand(0.035, 0.085), 7, false), rootMat));
  }

  // ferns
  function frondGeometry(): THREE.BufferGeometry {
    const pos: number[] = [], col: number[] = [], N = 20, L = 1.9, base = new THREE.Color('#244a24'), tip = new THREE.Color('#8fbd62');
    function P(t: number): THREE.Vector3 { return new V3(0, L * Math.sin(t * 1.25) * 0.72, L * (1 - Math.cos(t * 1.25)) * 0.95); }
    function push(v: THREE.Vector3, c: THREE.Color): void { pos.push(v.x, v.y, v.z); col.push(c.r, c.g, c.b); }
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) / N, p = P(t), dir = P(Math.min(1, t + 0.03)).sub(p).normalize(), len = 0.46 * (1 - t) + 0.05, c = base.clone().lerp(tip, t);
      [-1, 1].forEach((s) => {
        const b = p.clone().add(new V3(s * len, -0.05 * len, 0)).add(dir.clone().multiplyScalar(len * 0.45));
        const d = p.clone().add(dir.clone().multiplyScalar(0.1));
        push(p, c); push(b, c); push(d, c);
      });
      const q = P(Math.min(1, t + 1 / N)), w = 0.012 * (1 - t) + 0.004;
      push(new V3(p.x - w, p.y, p.z), base); push(new V3(p.x + w, p.y, p.z), base); push(new V3(q.x + w, q.y, q.z), base);
      push(new V3(p.x - w, p.y, p.z), base); push(new V3(q.x + w, q.y, q.z), base); push(new V3(q.x - w, q.y, q.z), base);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    return g;
  }
  const frondGeo = frondGeometry(), fernMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.75 }), ferns: Group[] = [];
  function addFern(x: number, z: number, s: number): void {
    const g = new THREE.Group() as Group, n = Math.floor(rand(5, 8));
    for (let f = 0; f < n; f++) {
      const fr = new THREE.Mesh(frondGeo, fernMat);
      fr.rotation.y = (f * Math.PI * 2) / n + rand(-0.3, 0.3); fr.rotation.x = rand(-0.25, 0.05); fr.scale.setScalar(rand(0.75, 1.1)); g.add(fr);
    }
    g.position.set(x, gh(x, z) - 0.02, z);
    g.userData = { ph: Math.random() * 6.28, base: s, g: reduce ? 1 : 0 };
    g.scale.setScalar(s); scene.add(g); ferns.push(g);
  }
  for (let f = 0; f < 34; f++) {
    let fx = rand(-13, 14);
    const fz = rand(-9, 2.5);
    if (fx > 0.5 && fx < 5.5 && fz > -1.5) fx += 6;
    addFern(fx, fz, rand(0.7, 1.5));
  }
  addFern(-5.2, 3.2, 1.9); addFern(7.6, 2.8, 1.7); addFern(-2.5, -3, 1.4);

  // pale flowers
  const petalGeo = new THREE.CircleGeometry(0.1, 14); petalGeo.scale(1, 0.55, 1); petalGeo.translate(0.1, 0, 0); petalGeo.rotateX(-Math.PI / 2);
  const petalMat = new THREE.MeshStandardMaterial({ color: '#f3f2e8', emissive: '#26281c', roughness: 0.55, side: THREE.DoubleSide });
  const heartMat = new THREE.MeshStandardMaterial({ color: '#e9d98c', emissive: '#3a3212', roughness: 0.6 });
  const stemMat = new THREE.MeshStandardMaterial({ color: '#4f7a3a', roughness: 0.8 });
  const heartGeo = new THREE.SphereGeometry(0.035, 10, 8), flowers: Group[] = [];
  function addFlower(x: number, z: number, H: number, s: number, thr?: number): Group {
    const g = new THREE.Group() as Group;
    const stemGeo = new THREE.CylinderGeometry(0.007, 0.012, H, 5); stemGeo.translate(0, H / 2, 0); g.add(new THREE.Mesh(stemGeo, stemMat));
    const head = new THREE.Group(); head.position.y = H;
    const n = Math.random() < 0.3 ? 6 : 5, petals: THREE.Mesh[] = [];
    for (let k = 0; k < n; k++) {
      const piv = new THREE.Group(); piv.rotation.y = (k * Math.PI * 2) / n;
      const p = new THREE.Mesh(petalGeo, petalMat); p.rotation.z = rand(0.2, 0.45); p.userData.tilt = p.rotation.z;
      piv.add(p); head.add(piv); petals.push(p);
    }
    head.add(new THREE.Mesh(heartGeo, heartMat)); head.rotation.x = rand(-0.25, 0.25); head.rotation.z = rand(-0.25, 0.25); g.add(head);
    g.position.set(x, gh(x, z) - 0.02, z); g.scale.setScalar(reduce ? s : 0.001);
    g.userData = { ph: Math.random() * 6.28, head, petals, base: s, thr: thr === undefined ? Math.random() : thr, s: reduce ? 1 : 0 };
    scene.add(g); flowers.push(g);
    return g;
  }
  for (let q = 0; q < 46; q++) addFlower(rand(0.2, 7), rand(-3.5, 2.6), rand(0.35, 1.0), rand(0.85, 1.2));
  for (let q2 = 0; q2 < 22; q2++) addFlower(rand(-12, 14), rand(-10, -3), rand(0.4, 1.1), rand(0.9, 1.3));
  const heroFlower = addFlower(2.9, 1.3, 0.95, 1.35, 0.97);
  const perches = flowers.filter((fl) => { const p = fl.position; return p.x > 0.6 && p.x < 6.2 && p.z > -1.8 && p.z < 2.4; });

  // particles: pollen (glowing) and dust (smog)
  function dotTexture(): THREE.CanvasTexture {
    const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    return new THREE.CanvasTexture(c);
  }
  const dotTex = dotTexture();
  interface Cloud { pos: Float32Array; vel: number[][]; geo: THREE.BufferGeometry; N: number; }
  function makeCloud(N: number): Cloud {
    const pos = new Float32Array(N * 3), vel: number[][] = [];
    for (let j = 0; j < N; j++) {
      pos[j * 3] = rand(-10, 12); pos[j * 3 + 1] = rand(0, 5); pos[j * 3 + 2] = rand(-9, 4.5);
      vel.push([rand(-0.05, 0.12), rand(0.03, 0.12), rand(-0.04, 0.04), Math.random() * 6.28]);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return { pos, vel, geo, N };
  }
  const pollenC = makeCloud(520), dustC = makeCloud(window.innerWidth < 640 ? 520 : 900);
  const pollenMat = new THREE.PointsMaterial({ size: 0.075, map: dotTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: '#fff4cc', opacity: 0.9 });
  const dustMat = new THREE.PointsMaterial({ size: 0.09, map: dotTex, transparent: true, depthWrite: false, color: '#a59d8e', opacity: 0 });
  scene.add(new THREE.Points(pollenC.geo, pollenMat)); scene.add(new THREE.Points(dustC.geo, dustMat));

  // butterfly
  const wingShape = new THREE.Shape(); wingShape.moveTo(0, 0);
  wingShape.bezierCurveTo(0.12, 0.26, 0.44, 0.36, 0.52, 0.16); wingShape.bezierCurveTo(0.56, 0.02, 0.4, -0.04, 0.24, -0.03);
  wingShape.bezierCurveTo(0.4, -0.12, 0.38, -0.34, 0.2, -0.33); wingShape.bezierCurveTo(0.08, -0.3, 0.02, -0.12, 0, 0);
  const wingGeoR = new THREE.ShapeGeometry(wingShape, 18); wingGeoR.rotateX(-Math.PI / 2);
  const wingGeoL = wingGeoR.clone(); wingGeoL.scale(-1, 1, 1);
  const wc: number[] = [], wp = wingGeoR.attributes.position as THREE.BufferAttribute, inner = new THREE.Color('#f7f1dc'), edge = new THREE.Color('#c9b27a');
  for (let w = 0; w < wp.count; w++) {
    const d = Math.min(1, Math.hypot(wp.getX(w), wp.getZ(w)) / 0.55);
    tmp.copy(inner).lerp(edge, Math.pow(d, 2.2)); wc.push(tmp.r, tmp.g, tmp.b);
  }
  wingGeoR.setAttribute('color', new THREE.Float32BufferAttribute(wc, 3)); wingGeoL.setAttribute('color', new THREE.Float32BufferAttribute(wc.slice(), 3));
  const wingMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.5, emissive: '#2e2a1a', transparent: true, opacity: 0.96 });
  const bodyMat = new THREE.MeshStandardMaterial({ color: '#2b2419', roughness: 0.7 });
  const bf = new THREE.Group(), bfInner = new THREE.Group(); bf.add(bfInner); bfInner.rotation.y = Math.PI;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.014, 0.34, 8), bodyMat); body.rotation.x = Math.PI / 2; bfInner.add(body);
  const headM = new THREE.Mesh(new THREE.SphereGeometry(0.03, 10, 8), bodyMat); headM.position.z = -0.18; bfInner.add(headM);
  const wingR = new THREE.Group(), wingL = new THREE.Group(); wingR.add(new THREE.Mesh(wingGeoR, wingMat)); wingL.add(new THREE.Mesh(wingGeoL, wingMat));
  wingR.position.z = wingL.position.z = -0.06; bfInner.add(wingR); bfInner.add(wingL); bf.scale.setScalar(0.42); scene.add(bf);

  type Target = THREE.Vector3 | Group;
  const headTmp = new V3(), AWAY = new V3(-11, 5.5, -4);
  function targetPos(t: Target): THREE.Vector3 {
    if ((t as THREE.Vector3).isVector3) return (t as THREE.Vector3).clone();
    (t as Group).userData.head.getWorldPosition(headTmp);
    return headTmp.clone().add(new V3(0, 0.03, 0));
  }
  function bez(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, u: number): THREE.Vector3 {
    const iu = 1 - u;
    return new V3(
      iu * iu * iu * a.x + 3 * iu * iu * u * b.x + 3 * iu * u * u * c.x + u * u * u * d.x,
      iu * iu * iu * a.y + 3 * iu * iu * u * b.y + 3 * iu * u * u * c.y + u * u * u * d.y,
      iu * iu * iu * a.z + 3 * iu * iu * u * b.z + 3 * iu * u * u * c.z + u * u * u * d.z,
    );
  }
  const B = { state: 'fly', t: 0, dur: 7, S: new V3(-9, 4.2, -2), C1: new V3(), C2: new V3(), target: heroFlower as Target, rest: 0, yaw: 0 };
  function plan(from: THREE.Vector3, target: Target, state?: string): void {
    B.S = from.clone(); B.target = target; B.t = 0; B.state = state || 'fly';
    const L = targetPos(target), dist = from.distanceTo(L);
    B.C1 = from.clone().add(new V3(rand(-1.2, 1.2), rand(0.6, 1.4), rand(-1, 1)));
    B.C2 = L.clone().add(new V3(rand(-0.9, 0.9), rand(0.9, 1.4), rand(-0.6, 0.6)));
    B.dur = Math.max(3.2, 2.4 + dist * 0.55);
  }
  plan(B.S, heroFlower, 'fly'); B.dur = reduce ? 3 : 8.5;
  function ease(u: number): number { return u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2; }
  function openPerches(cur: Group | null): Group[] { return perches.filter((fl) => fl !== cur && fl.userData.s > 0.85); }

  let mx = 0, my = 0;
  window.addEventListener('pointermove', (e) => { mx = (e.clientX / window.innerWidth) * 2 - 1; my = (e.clientY / window.innerHeight) * 2 - 1; });
  function resize(): void {
    const wv = window.innerWidth, hv = window.innerHeight;
    renderer.setSize(wv, hv, false); camera.aspect = wv / hv;
    const narrow = wv < 640;
    camera.fov = narrow ? 58 : 42;
    camBase.set(narrow ? 1.6 : 0, narrow ? 2.4 : 2.1, narrow ? 8.4 : 7.6);
    look.set(narrow ? 2.6 : 1.4, narrow ? 1.1 : 0.85, 0);
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize); resize();
  onQualityChange(() => { renderer.setPixelRatio(glPixelRatio()); resize(); });

  const st = { qs: app.qTarget, night: 0, fogIntro: reduce ? 0 : 0.32, clock: 0 };
  function moveCloud(C: Cloud, dt: number, speedK: number, sink: number): void {
    const P = C.pos, V = C.vel, t = st.clock;
    for (let j = 0; j < C.N; j++) {
      const v = V[j], o = j * 3;
      P[o] += (v[0] * speedK + Math.sin(t * 0.6 + v[3]) * 0.05) * dt;
      P[o + 1] += (v[1] * 0.6 - sink + Math.cos(t * 0.8 + v[3]) * 0.04) * dt;
      P[o + 2] += (v[2] + Math.sin(t * 0.4 + v[3] * 2) * 0.04) * dt;
      if (P[o + 1] > 5.2) P[o + 1] = 0.1;
      if (P[o + 1] < 0) P[o + 1] = 5;
      if (P[o] > 12.5) P[o] = -10;
    }
    (C.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
  const smogEl = $('smog');

  return {
    tick(dt: number): void {
      dt *= SPEED; st.clock += dt;
      const clock = st.clock, qTarget = app.qTarget;
      // springs
      st.qs += (qTarget - st.qs) * (1 - Math.exp(-dt * (reduce ? 12 : 2.6)));
      const hr = hIST(app.T), sunAlt = Math.sin((Math.PI * (hr - 6)) / 12), nightT = clamp(-sunAlt * 1.6 + 0.15, 0, 1);
      st.night += (nightT - st.night) * (1 - Math.exp(-dt * 2));
      app.fogPulse += (app.fogPulseT - app.fogPulse) * (1 - Math.exp(-dt * 7));
      app.camShift += (app.camShiftT - app.camShift) * (1 - Math.exp(-dt * 3));
      st.fogIntro *= Math.exp(-dt * 1.3);
      const qs = st.qs, nt = st.night * 0.55, fogPulse = app.fogPulse, SCROLLU = app.SCROLLU;

      // atmosphere
      fogCol.copy(FOG_CLEAN).lerp(FOG_SMOG, qs).lerp(FOG_NIGHT, nt * (1 - qs * 0.5));
      fog.color.copy(fogCol);
      fog.density = 0.075 + qs * 0.055 + fogPulse * 0.16 + st.fogIntro;
      renderer.toneMappingExposure = (1.05 - qs * 0.1) * (1 - 0.2 * nt);
      sun.color.copy(SUN_CLEAN).lerp(SUN_SMOG, qs); sun.intensity = (1.25 - qs * 0.62) * (1 - 0.6 * nt);
      hemi.color.copy(HEMI_CLEAN).lerp(HEMI_SMOG, qs); hemi.intensity = (0.75 - qs * 0.2) * (1 - 0.3 * nt);
      groundMat.color.copy(WHITE).lerp(GROUND_SMOG, qs * 0.85);
      fernMat.color.copy(WHITE).lerp(FERN_SMOG, qs);
      smogEl.style.opacity = (qs * 0.36 + fogPulse * 0.25).toFixed(3);

      // camera
      camera.position.x += (camBase.x + mx * 0.55 + app.camShift * 1.4 - camera.position.x) * 0.04;
      camera.position.y += (camBase.y - my * 0.25 + SCROLLU * 1.3 - camera.position.y) * 0.08;
      camera.position.z = camBase.z - SCROLLU * 1.1;
      lookTmp.copy(look); lookTmp.y += SCROLLU * 1.9; camera.lookAt(lookTmp);

      // ferns
      for (let i = 0; i < ferns.length; i++) {
        const fg = ferns[i], u = fg.userData;
        u.g += (1 - u.g) * (1 - Math.exp(-dt * 1.1));
        fg.scale.setScalar(u.base * (0.3 + 0.7 * u.g) * (1 - 0.38 * qs));
        fg.rotation.z = Math.sin(clock * 0.7 + u.ph) * 0.035;
        fg.rotation.x = Math.cos(clock * 0.55 + u.ph) * 0.025 + qs * 0.12;
      }
      // flowers: thin out from the cleanest-looking ones last
      for (let k = 0; k < flowers.length; k++) {
        const fl = flowers[k], fu = fl.userData;
        let want = fu.thr > qs * 1.1 - 0.02 ? 1 : 0;
        if (st.clock < 0.5 && !reduce) want = 0;
        fu.s += (want - fu.s) * (1 - Math.exp(-dt * (want ? 1.6 : 2.4)));
        fl.scale.setScalar(Math.max(0.001, fu.base * fu.s));
        for (let pi = 0; pi < fu.petals.length; pi++) {
          const pt = fu.petals[pi];
          pt.rotation.z = pt.userData.tilt + (1 - fu.s) * 1.1 + qs * 0.25;
        }
        fl.rotation.z = Math.sin(clock * 0.9 + fu.ph) * 0.045;
        fl.rotation.x = Math.cos(clock * 0.75 + fu.ph) * 0.03;
      }

      // particles
      moveCloud(pollenC, dt, 1, 0);
      moveCloud(dustC, dt, 1 + qs * 2.2, 0.06 * qs);
      pollenMat.opacity = 0.9 * (1 - qs * 0.92) + st.night * 0.1;
      pollenMat.size = 0.075 + st.night * 0.02;
      dustMat.opacity = Math.min(0.85, qs * 1.05);
      dustMat.size = 0.08 + qs * 0.05;

      // butterfly
      let ang = 1.25;
      if (qs > 0.84 && (B.state === 'fly' || B.state === 'rest')) plan(bf.position, AWAY, 'leave');
      if (B.state === 'away') {
        bf.visible = false;
        if (qs < 0.76) {
          const op = openPerches(null);
          if (op.length) { bf.visible = true; bf.position.copy(AWAY); plan(AWAY, op[Math.floor(Math.random() * op.length)], 'fly'); }
        }
      }
      if (B.state === 'fly' || B.state === 'leave') {
        B.t += dt;
        const uu = Math.min(1, B.t / B.dur), e = ease(uu), L = targetPos(B.target);
        const p = bez(B.S, B.C1, B.C2, L, e), p2 = bez(B.S, B.C1, B.C2, L, Math.min(1, e + 0.02));
        if (uu < 0.97) p.y += Math.sin(clock * 9) * 0.04 * (1 - uu);
        bf.position.copy(p);
        const dir = p2.clone().sub(p);
        if (dir.lengthSq() > 1e-6) { B.yaw = Math.atan2(dir.x, dir.z); bf.lookAt(p.clone().add(dir)); }
        const flap = 0.25 + Math.sin(((clock * 26) / SPEED) * (reduce ? 0.3 : 1)) * 0.95,
          wgt = B.state === 'fly' && uu > 0.86 ? (uu - 0.86) / 0.14 : 0;
        ang = flap * (1 - wgt) + 1.25 * wgt;
        if (uu >= 1) {
          if (B.state === 'leave') B.state = 'away';
          else { B.state = 'rest'; B.rest = rand(4, 7) * (1 + qs * 2.5); B.t = 0; }
        }
      } else if (B.state === 'rest') {
        B.t += dt;
        bf.position.copy(targetPos(B.target));
        bf.rotation.set(0, B.yaw, 0);
        ang = 1.25 - 0.95 * Math.pow(Math.max(0, Math.sin(clock * 0.9)), 6);
        if (B.t > B.rest || (B.target as Group).userData.s < 0.6) {
          const opts = openPerches(B.target as Group);
          if (!opts.length) plan(bf.position, AWAY, 'leave');
          else {
            const nx = opts[Math.floor(Math.random() * opts.length)];
            if (Math.random() < 0.22) {
              const from = bf.position.clone();
              plan(from, nx, 'fly');
              B.C1 = new V3(rand(-6, -2), rand(2.5, 3.5), rand(-4, -1));
              B.C2 = nx.position.clone().add(new V3(rand(-1, 1), 2, rand(-1, 1)));
              B.dur += 2.5;
            } else plan(bf.position, nx, 'fly');
          }
        }
      }
      wingR.rotation.z = ang; wingL.rotation.z = -ang;

      if (app.dimV < 0.999) renderer.render(scene, camera);
    },
  };
}
