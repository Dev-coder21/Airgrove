/** Liquid-chrome WebGL2 buttons (.metal and .ghost): facets, spectral ring, pointer scratches, halo. */
import { reduce, pixelRatio } from '../core/util';
import { app } from '../state';

const VS = '#version 300 es\nin vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
const FS = [
  '#version 300 es', 'precision highp float;',
  'uniform vec2 uRes;uniform vec2 uSize;uniform float uTime,uHover,uPress,uQ,uDpr,uGhost;uniform vec2 uPtr;uniform vec3 uTrail[24];out vec4 o;',
  'float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}',
  'vec2 hash2(vec2 p){float n=hash(p);return vec2(n,hash(p+n+.17));}',
  'float sdPill(vec2 p,vec2 b){float r=b.y;vec2 q=abs(p)-b+r;return length(max(q,0.))+min(max(q.x,q.y),0.)-r;}',
  'vec3 env(vec3 d,float px){',
  ' vec3 c=mix(vec3(.09,.12,.10),vec3(.80,.84,.80),smoothstep(-.65,.75,d.y));',
  ' float s=sin(d.x*3.2+uTime*.35+px*2.4);',
  ' c+=vec3(1.)*smoothstep(.80,.985,s)*.7;',
  ' c+=vec3(.92,1.,.93)*smoothstep(.55,.95,d.y+.25*sin(d.x*2.+uTime*.2))*.22;',
  ' c-=vec3(.18)*smoothstep(.65,.95,-d.y);c=max(c,vec3(.16,.19,.17));',
  ' c*=mix(vec3(1.),vec3(1.,.92,.80),uQ*.6);',
  ' return c;}',
  'void main(){',
  ' vec2 fc=gl_FragCoord.xy;vec2 c=uRes*.5;vec2 p=fc-c;vec2 b=uSize*.5;',
  ' float d=sdPill(p,b);float e=1.5*uDpr;',
  ' vec2 g=vec2(sdPill(p+vec2(e,0.),b)-sdPill(p-vec2(e,0.),b),sdPill(p+vec2(0.,e),b)-sdPill(p-vec2(0.,e),b));g=g/max(length(g),1e-4);',
  ' float bwG=2.6*uDpr;float bw=mix(uSize.y*.34,bwG,uGhost);float t=clamp(-d/bw,0.,1.);float slope=1.-t;',
  // crystal facets in the flat centre
  ' vec2 cp=p/(uSize.y*.45)+vec2(uTime*.02,0.);vec2 cell=floor(cp);vec2 f=fract(cp);float md=8.;vec2 mo=vec2(0.);',
  ' for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 nb=vec2(float(i),float(j));vec2 r=nb+hash2(cell+nb)-f;float dd=dot(r,r);if(dd<md){md=dd;mo=hash2(cell+nb);}}',
  ' vec2 facet=(mo-.5)*.07*t*t;',
  ' vec3 n=normalize(vec3(g*slope*1.7+facet+vec2(0.,.22*t),.55+t*.6));',
  ' float px=(uPtr.x/uRes.x-.5)*uHover;vec3 v=vec3(0.,0.,-1.);',
  ' float k=.06+.06*uHover;',
  ' vec3 col;col.r=env(reflect(v,normalize(n+vec3(g*k,0.))),px).r;col.g=env(reflect(v,n),px).g;col.b=env(reflect(v,normalize(n-vec3(g*k,0.))),px).b;',
  ' col+=vec3(.05)*(1.-sqrt(md))*t*t;',
  // spectral ring
  ' float ang=atan(p.y,p.x);',
  ' vec3 rainbow=.5+.5*cos(6.2831*(ang/6.2831+uTime*.06+vec3(0.,.33,.67)));',
  ' float ring=exp(-((t-.40)/.12)*((t-.40)/.12));',
  ' col=mix(col,col*.55+rainbow*.7,ring*(.30+.40*uHover+.3*uPress));',
  ' col+=vec3(1.)*exp(-(d/(1.2*uDpr))*(d/(1.2*uDpr)))*.35;',
  // ghost: dark glass interior inside a chrome rim
  ' float rim=smoothstep(-bwG-1.2*uDpr,-bwG+.6*uDpr,d);',
  ' vec3 glass=vec3(.05,.11,.075)+vec3(.05)*(1.-sqrt(md))+vec3(.10,.12,.10)*smoothstep(.2,1.,p.y/b.y)+rainbow*.05*uHover;',
  ' float alphaIn=mix(1.,mix(.55,1.,rim),uGhost);col=mix(col,mix(glass,col,rim),uGhost);',
  // pointer-drawn scratches
  ' float sc=0.;',
  ' for(int i=0;i<23;i++){vec3 A=uTrail[i];vec3 B=uTrail[i+1];if(A.z>1.||B.z>1.)continue;',
  '  vec2 pa=fc-A.xy;vec2 ba=B.xy-A.xy;float h=clamp(dot(pa,ba)/max(dot(ba,ba),1e-3),0.,1.);float dist=length(pa-ba*h);',
  '  float w=.85*uDpr;sc+=exp(-dist*dist/(w*w))*(1.-max(A.z,B.z));}',
  ' sc=min(sc,1.)*step(d,0.);',
  ' col+=(vec3(1.)+rainbow*.5)*sc*mix(.9,.7,uGhost);alphaIn=max(alphaIn,sc);',
  ' col*=1.-uPress*.1;',
  ' float inside=clamp(.5-d,0.,1.);',
  // halo + floating particles
  ' float halo=exp(-max(d,0.)/(14.*uDpr))*(.08+.16*uHover)*(1.-inside);',
  ' vec3 glowC=mix(vec3(.85,.95,.82),rainbow,.3);',
  ' float spark=0.;float cs=13.*uDpr;vec2 gc=floor(fc/cs);',
  ' for(int j=-1;j<=1;j++)for(int i=-1;i<=1;i++){vec2 cc=gc+vec2(float(i),float(j));vec2 h2=hash2(cc);if(h2.y<.5)continue;float ph=h2.x*6.283;',
  '  vec2 pos=(cc+.5+.38*vec2(sin(uTime*.7+ph),cos(uTime*.55+ph*1.3)))*cs;',
  '  float sd=sdPill(pos-c,b);float near=smoothstep(30.*uDpr,6.*uDpr,sd)*smoothstep(1.*uDpr,5.*uDpr,sd);',
  '  float dd=length(fc-pos);float tw=.5+.5*sin(uTime*2.6+ph*5.);',
  '  spark+=exp(-dd*dd/(1.2*uDpr*uDpr))*tw*near;}',
  ' spark*=(.45+.75*uHover);',
  ' vec3 outC=glowC*halo+vec3(1.,.97,.88)*spark;',
  ' float outA=clamp(halo+spark,0.,1.)*(1.-inside);',
  ' float A=inside*alphaIn;o=vec4(col*A+outC*(1.-inside),clamp(A+outA,0.,1.));',
  '}',
].join('\n');

const M = 28;
type Tick = (now: number, dt: number) => void;
const GLBTNS: Tick[] = [];

function make(btn: HTMLElement): void {
  const cv = document.createElement('canvas'); cv.className = 'glcv'; cv.setAttribute('aria-hidden', 'true');
  const gl = cv.getContext('webgl2', { premultipliedAlpha: true, alpha: true, antialias: false });
  if (!gl) return;
  function sh(type: number, src: string): WebGLShader | null {
    const x = gl!.createShader(type)!; gl!.shaderSource(x, src); gl!.compileShader(x);
    if (!gl!.getShaderParameter(x, gl!.COMPILE_STATUS)) { console.warn(gl!.getShaderInfoLog(x)); return null; }
    return x;
  }
  const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return;
  const pr = gl.createProgram()!; gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return;
  gl.useProgram(pr);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const la = gl.getAttribLocation(pr, 'a'); gl.enableVertexAttribArray(la); gl.vertexAttribPointer(la, 2, gl.FLOAT, false, 0, 0);
  const U: Record<string, WebGLUniformLocation | null> = {};
  ['uRes', 'uSize', 'uTime', 'uHover', 'uPress', 'uQ', 'uDpr', 'uPtr', 'uTrail', 'uGhost'].forEach((n) => { U[n] = gl.getUniformLocation(pr, n); });
  btn.prepend(cv); btn.classList.add('gl');
  const ghost = btn.classList.contains('ghost') ? 1 : 0;
  const st = { w: 0, h: 0, dpr: 1, hover: 0, ht: 0, press: 0, pt: 0, ptr: [0, 0], trail: [] as number[][], vis: true, t0: performance.now() },
    TR = new Float32Array(72);
  function size(): void {
    st.dpr = pixelRatio(); st.w = btn.offsetWidth; st.h = btn.offsetHeight;
    cv.width = Math.round((st.w + 2 * M) * st.dpr); cv.height = Math.round((st.h + 2 * M) * st.dpr);
  }
  size();
  if ('ResizeObserver' in window) new ResizeObserver(size).observe(btn);
  if ('IntersectionObserver' in window) new IntersectionObserver((es) => { st.vis = es[0].isIntersecting; }).observe(btn);
  function local(e: PointerEvent): number[] {
    const r = btn.getBoundingClientRect();
    return [(e.clientX - r.left + M) * st.dpr, (r.height - (e.clientY - r.top) + M) * st.dpr];
  }
  btn.addEventListener('pointerenter', () => { st.ht = 1; });
  btn.addEventListener('pointerleave', () => { st.ht = 0; st.pt = 0; });
  btn.addEventListener('pointermove', (e) => {
    const p = local(e); st.ptr = p;
    const l = st.trail[st.trail.length - 1];
    if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 2.5 * st.dpr) { st.trail.push([p[0], p[1], performance.now()]); if (st.trail.length > 24) st.trail.shift(); }
  });
  btn.addEventListener('pointerdown', () => { st.pt = 1; });
  btn.addEventListener('pointerup', () => { st.pt = 0; });
  btn.addEventListener('focus', () => { st.ht = 1; });
  btn.addEventListener('blur', () => { st.ht = 0; });
  GLBTNS.push((now, dt) => {
    if (!st.vis || !st.w) return;
    st.hover += (st.ht - st.hover) * (1 - Math.exp(-dt * 8)); st.press += (st.pt - st.press) * (1 - Math.exp(-dt * 18));
    const n = st.trail.length, off = 24 - n;
    for (let i = 0; i < 24; i++) {
      const j = i - off;
      if (j < 0) { TR[i * 3 + 2] = 2; continue; }
      const tp = st.trail[j]; TR[i * 3] = tp[0]; TR[i * 3 + 1] = tp[1]; TR[i * 3 + 2] = (now - tp[2]) / 1300;
    }
    gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(U.uRes, cv.width, cv.height); gl.uniform2f(U.uSize, st.w * st.dpr, st.h * st.dpr);
    gl.uniform1f(U.uTime, ((now - st.t0) / 1000) * (reduce ? 0.25 : 1)); gl.uniform1f(U.uHover, st.hover); gl.uniform1f(U.uPress, st.press);
    gl.uniform1f(U.uQ, app.qTarget); gl.uniform1f(U.uGhost, ghost); gl.uniform1f(U.uDpr, st.dpr); gl.uniform2f(U.uPtr, st.ptr[0], st.ptr[1]); gl.uniform3fv(U.uTrail, TR);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  });
}

export function initChromeButtons(): void {
  document.querySelectorAll<HTMLElement>('.metal,.ghost').forEach(make);
}
export function tickChromeButtons(now: number, dt: number): void {
  for (let i = 0; i < GLBTNS.length; i++) GLBTNS[i](now, dt);
}
