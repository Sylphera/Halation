// Drape: Home's window background (docs/BACKGROUNDS_SPEC.md §1). Halation's own code, written from that description.
// Silk-like waves drift slowly along a diagonal over a near-black, slightly blue base: a domain-warped surface, lit
// softly, with a few bright lobes, broad gradients and large dark voids. The light field is drawn into a small buffer
// (320 px on the long edge, half-float when the GPU allows, supersampled on thin crests) at 15 Hz; one pass at the window's native size (DPR up to
// 2) scales it with a cubic B-spline and adds a ±1/255 dither and Halation's stationary film grain.
// window.__drape.create(surface, options) → { canvas, proxy, wave(phase, previous), scene(), sceneAt(v), dispose() }
(() => {
"use strict";

/* ===== noise ===== */
// Simplex noise 3D from "webgl-noise" by Ian McEwan and Stefan Gustavson (Ashima Arts), MIT License,
// https://github.com/ashima/webgl-noise (THIRD_PARTY.md). Changed for exact 32-bit arithmetic: the integer steps
// (mod 289, permute, the 7×7 gradient lattice) cannot round across an integer, and lattice gradients that sit exactly
// on the octahedron's edge (h = 0) are never folded, so every GPU and snoise() below, the JavaScript port used on a
// small CPU grid to keep the lit share of the screen steady, pick the same gradients. The kernel radius is 0.5
// (r² < 0.5, not 0.6) so the noise and its slope stay continuous across simplex faces (the folds' shading and crests
// read the slope), rescaled to keep about the same spread.
const NOISE_GLSL = `
vec3 mod289(vec3 x){return x-floor((x+0.5)*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor((x+0.5)*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(mod289(x*34.0+1.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0);
  const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy));
  vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz);
  vec3 l=1.0-g;
  vec3 i1=min(g.xyz,l.zxy);
  vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx;
  vec3 x2=x0-i2+C.yyy;
  vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857;
  vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor((p+0.5)*(1.0/49.0));
  vec4 x_=floor((j+0.5)*ns.z);
  vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy;
  vec4 y=y_*ns.x+ns.yyyy;
  vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy);
  vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0;
  vec4 s1=floor(b1)*2.0+1.0;
  vec4 sh=-step(h,vec4(-0.0001));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy;
  vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x);
  vec3 p1=vec3(a0.zw,h.y);
  vec3 p2=vec3(a1.xy,h.z);
  vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x;p1*=norm.y;p2*=norm.z;p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0);
  m=m*m;
  return 109.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;
const mod289 = x => x - Math.floor(x * (1 / 289)) * 289, permute = x => mod289((x * 34 + 1) * x);
// one corner's contribution: offset (cx, cy, cz) from the corner, lattice cell (i, j, k) already wrapped mod 289
function corner(cx, cy, cz, i, j, k) {
  const m = .5 - (cx * cx + cy * cy + cz * cz);
  if (m <= 0) return 0;
  const p = permute(permute(permute(k) + j) + i);
  const q = p - 49 * Math.floor(p / 49), xa = Math.floor(q / 7), ya = Math.floor(q - 7 * xa);
  let a = xa * (2 / 7) + (.5 / 7 - 1), b = ya * (2 / 7) + (.5 / 7 - 1);
  const h = 1 - Math.abs(a) - Math.abs(b);
  if (h < -1e-4) { a -= Math.floor(a) * 2 + 1; b -= Math.floor(b) * 2 + 1; }
  const n = 1.79284291400159 - .85373472095314 * (a * a + b * b + h * h);
  return m * m * m * m * n * (a * cx + b * cy + h * cz);
}
// allocation-free: it runs a few thousand times per measure of the stabiliser
function snoise(x, y, z) {
  const s = (x + y + z) / 3;
  let i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
  const t = (i + j + k) / 6, x0 = x - i + t, y0 = y - j + t, z0 = z - k + t;
  const gx = x0 >= y0 ? 1 : 0, gy = y0 >= z0 ? 1 : 0, gz = z0 >= x0 ? 1 : 0;
  const i1 = Math.min(gx, 1 - gz), j1 = Math.min(gy, 1 - gx), k1 = Math.min(gz, 1 - gy);
  const i2 = Math.max(gx, 1 - gz), j2 = Math.max(gy, 1 - gx), k2 = Math.max(gz, 1 - gy);
  i = mod289(i); j = mod289(j); k = mod289(k);
  return 109 * (corner(x0, y0, z0, i, j, k)
    + corner(x0 - i1 + 1 / 6, y0 - j1 + 1 / 6, z0 - k1 + 1 / 6, i + i1, j + j1, k + k1)
    + corner(x0 - i2 + 1 / 3, y0 - j2 + 1 / 3, z0 - k2 + 1 / 3, i + i2, j + j2, k + k2)
    + corner(x0 - .5, y0 - .5, z0 - .5, i + 1, j + 1, k + 1));
}

/* ===== field ===== */
// One description of the light, shared by the shader and the CPU exposure estimate. p: centred position in screen
// heights; t: field seconds. A frame turned along the diagonal axis is stretched along it and slides slowly; its
// coordinates are displaced twice by two-octave noise (domain warping), which bends straight space into broad waves
// that curve, part and gather. The height h of the warped surface, with a faint ripple across the axis that stacks thin
// waves around the bright lobes, is lit like silk: a body of the middle colour where h is high, shaded by a soft
// diffuse light, and a broad sheen of the brightest colour where the surface faces the light. A slow, large mask
// leaves big near-black voids, so only a few places get really bright and the rest is gradient. Every rate is slow
// (the clock runs at about a two-hundredth of a unit per second), so the surface drifts and morphs without popping.
const F = {
  angle: .85, along: .38, across: .9, scale: .95, rate: .0055, drift: .5, warp: 1.3, ripple: .12, rippleFreq: 10,
  normal: .1, sheenPower: 1.6, bodyLow: -.2, bodyHigh: .55, voids: .9, diffuseFloor: .1, bodyGain: 1.1, sheenGain: .45,
  vignette: .4, target: .07, maxBias: .5, minExposure: .8, maxExposure: 1.25,
  // the whole silk at this level when it is shown (tone 2, Java 2026-10-14): darker without changing its shape or coverage
  level: .55
};
const f4 = x => x.toFixed(5);
const FIELD_GLSL = `
const vec2 AXIS=vec2(${f4(Math.cos(F.angle))},${f4(Math.sin(F.angle))});
vec2 axisSpace(vec2 p,float t){vec2 a=vec2(dot(p,AXIS),dot(p,vec2(-AXIS.y,AXIS.x)))*vec2(${f4(F.along * F.scale)},${f4(F.across * F.scale)});a.x-=t*${f4(F.drift)};return a;}
float fbm(vec3 p){float s=0.5*snoise(p);p=p*vec3(1.9,1.9,1.2)+vec3(17.1,-9.3,3.7);return s+0.225*snoise(p);}
// the surface's height at a point of the axis frame
float height(vec2 a,float t){
  vec2 q=vec2(fbm(vec3(a,t)),fbm(vec3(a+vec2(5.2,1.3),t)));
  vec2 w=a+${f4(F.warp)}*vec2(fbm(vec3(a+1.1*q+vec2(1.7,9.2),t*1.3)),fbm(vec3(a+1.1*q+vec2(8.3,2.8),t*1.3)));
  float h=fbm(vec3(w,t*0.7));
  return h+${f4(F.ripple)}*sin(w.y*${f4(F.rippleFreq)}+h*3.0);
}
float voids(vec2 a,float t){return mix(1.0,smoothstep(-0.45,0.35,snoise(vec3(a*vec2(0.3,0.54)+vec2(3.1,7.7),t*0.6))),${f4(F.voids)});}`;
const AXIS = [Math.cos(F.angle), Math.sin(F.angle)];
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const axisSpace = (px, py, t) => [(px * AXIS[0] + py * AXIS[1]) * F.along * F.scale - t * F.drift, (py * AXIS[0] - px * AXIS[1]) * F.across * F.scale];
const fbm = (x, y, z) => .5 * snoise(x, y, z) + .225 * snoise(x * 1.9 + 17.1, y * 1.9 - 9.3, z * 1.2 + 3.7);
function height(ax, ay, t) {
  const qx = fbm(ax, ay, t), qy = fbm(ax + 5.2, ay + 1.3, t);
  const wx = ax + F.warp * fbm(ax + 1.1 * qx + 1.7, ay + 1.1 * qy + 9.2, t * 1.3), wy = ay + F.warp * fbm(ax + 1.1 * qx + 8.3, ay + 1.1 * qy + 2.8, t * 1.3);
  const h = fbm(wx, wy, t * .7);
  return h + F.ripple * Math.sin(wy * F.rippleFreq + h * 3);
}
const voids = (ax, ay, t) => 1 - F.voids + F.voids * smoothstep(-.45, .35, snoise(ax * .3 + 3.1, ay * .54 + 7.7, t * .6));
const L = [.2126, .7152, .0722];
const DIFFUSE = [-.5, .5, .7].map((v, _, a) => v / Math.hypot(...a)), SHEEN = [-.3, .4, .9].map((v, _, a) => v / Math.hypot(...a));
// What the light depends on at a screen position: the height, the voids mask, the diffuse shading and the sheen.
// e: the gradient step in screen heights (1.5 field pixels, as in the shader).
function surface(px, py, t, e) {
  const tt = t * F.rate, [ax, ay] = axisSpace(px, py, tt), h = height(ax, ay, tt);
  const gx = (height(ax + e, ay, tt) - h) / e * F.normal, gy = (height(ax, ay + e, tt) - h) / e * F.normal, n = 1 / Math.hypot(gx, gy, 1);
  const dot = d => Math.max(0, (-gx * d[0] - gy * d[1] + d[2]) * n);
  return { h, voids: voids(ax, ay, tt), diffuse: F.diffuseFloor + (1 - F.diffuseFloor) * dot(DIFFUSE), sheen: Math.pow(dot(SHEEN), F.sheenPower) };
}
// the light before the base colour: [body (middle colour), sheen (brightest colour)]; bias lowers the body's threshold
function light(s, bias = 0) {
  const body = smoothstep(F.bodyLow - bias, F.bodyHigh - bias, s.h) * s.voids;
  return [body * s.diffuse * F.bodyGain, s.sheen * body * body * F.sheenGain];
}

/* ===== grain ===== */
// Halation's film grain from the previous background (its own code, reused as is): two layers of the 128×128 blue noise at
// 1.35 and 1.7 px, turned off the pixel grid and lightly warped, normalised to a standard deviation of 1; and tpdf(),
// the triangular ±1 dither. The frame is fixed (0): the grain is stationary.
const GRAIN_GLSL = `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
  m = m*m; m = m*m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

/* ---------- hash sin sin() (Hoskins): sin(dot()*43758) pierde
              precision y deja patrones; esta es uniforme ---------- */
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

/* ruido triangular en [-1, 1]: es el dither correcto, deja el
   error de cuantizacion sin correlacion con la imagen */
float tpdf(vec2 px, float seed) {
  return hash12(px + seed * 1.618) + hash12(px + 57.31 + seed * 2.414) - 1.0;
}

mat2 rot(float a) {
  float c = cos(a), s = sin(a);
  return mat2(c, -s, s, c);
}


/* ---------- grano de pelicula (blue noise real) ----------
   Textura void-and-cluster 128x128: sin energia en baja frecuencia
   (ni manchas ni grumos) y distribucion uniforme.
   - Escala 1.35 px y 1.7 px: grano fino fotografico (semiancho de
     correlacion ~0.7 px), mas que un pixel pero sin formar manchas.
   - Interpolacion bilineal al ampliarla: bordes suaves, banda limitada;
     ningun grano es un evento de 1 pixel.
   - Rotacion por frame restringida a 20-70 grados (+ k*90): la rejilla
     de la textura nunca queda alineada con gl_FragCoord.
   - Dos capas con escalas inconmensurables + warp lento (8 texeles,
     ~300 px) rompen la repeticion del tile (autocorrelacion 0.32 -> 0.01).
   Normalizado a desviacion tipica 1 (K = 5.991, medido). */
const float BN = 128.0;
float bn(vec2 tc) { return texture2D(u_blue, tc / BN).r - 0.5; }

float filmGrain(vec2 px, float frame) {
  float r0 = hash12(vec2(frame,  17.0));
  float r1 = hash12(vec2(frame,  59.0));
  float r2 = hash12(vec2(frame, 113.0));
  float r3 = hash12(vec2(frame, 211.0));
  float r4 = hash12(vec2(frame, 307.0));
  float r5 = hash12(vec2(frame, 401.0));
  vec2 w = vec2(snoise(px / 300.0 + r0 * 97.0),
                snoise(px / 300.0 + r2 * 97.0 + 50.0)) * 8.0;
  float a1 = 0.35 + r0 * 0.87 + floor(r1 * 4.0) * 1.5707963;
  float a2 = 0.35 + r2 * 0.87 + floor(r3 * 4.0) * 1.5707963;
  vec2 o = vec2(r4, r5) * BN;
  float g1 = bn(rot(a1) * px / 1.35 + o + w);
  float g2 = bn(rot(a2) * px / 1.7 + o.yx + vec2(31.0, 17.0) + vec2(-w.y, w.x));
  return (0.85 * g1 + 0.5 * g2) * 5.991;
}`;

/* ===== shader ===== */
// Both passes draw a 24×16 grid of the window (one mesh for the field and the presentation).
const GRID = [24, 16];
// SUPERSAMPLE: the change of light luma per field pixel over which the field takes four more samples (blended in)
const SUPERSAMPLE = [.02, .04];
const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
// The field, per pixel of the small target: u_bias moves the body's threshold and u_exposure scales the light (not
// the base), so the lit share and the mean brightness of the screen stay steady.
const FIELD_FS = `#extension GL_OES_standard_derivatives : enable
precision highp float;
uniform vec2 u_resolution;uniform float u_time;uniform float u_bias;uniform float u_exposure;uniform vec3 u_colors[3];uniform float u_dither;
${NOISE_GLSL}
${FIELD_GLSL}
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*0.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
// the light over the base at p (screen heights): the silk's body, shaded by the diffuse light, and its sheen
vec3 shade(vec2 p,float t,float e){
  vec2 a=axisSpace(p,t);
  float h=height(a,t);
  vec2 g=vec2(height(a+vec2(e,0.0),t)-h,height(a+vec2(0.0,e),t)-h)/e;
  vec3 n=normalize(vec3(-g*${f4(F.normal)},1.0));
  float diffuse=max(dot(n,normalize(vec3(-0.5,0.5,0.7))),0.0);
  float sheen=pow(max(dot(n,normalize(vec3(-0.3,0.4,0.9))),0.0),${f4(F.sheenPower)});
  float body=smoothstep(${f4(F.bodyLow)}-u_bias,${f4(F.bodyHigh)}-u_bias,h)*voids(a,t);
  return u_exposure*(u_colors[1]*body*(${f4(F.diffuseFloor)}+${f4(1 - F.diffuseFloor)}*diffuse)*${f4(F.bodyGain)}+u_colors[2]*sheen*body*body*${f4(F.sheenGain)});
}
void main(){
  vec2 uv=gl_FragCoord.xy/u_resolution,p=(gl_FragCoord.xy-0.5*u_resolution)/u_resolution.y;
  float t=u_time*${f4(F.rate)},e=1.5/u_resolution.y,px=1.0/u_resolution.y;
  vec3 light=shade(p,t,e);
  // where the light changes by more than about a level per field pixel (a thin fold or crest), four more samples on a
  // rotated grid: a crest thinner than a pixel, sampled once, lands brighter or darker on each pixel along it (beads)
#ifdef GL_OES_standard_derivatives
  float ss=smoothstep(${f4(SUPERSAMPLE[0])},${f4(SUPERSAMPLE[1])},fwidth(dot(light,vec3(0.2126,0.7152,0.0722))));
#else
  float ss=1.0;
#endif
  if(ss>0.0){
    vec3 more=vec3(0.0);vec2 o=vec2(0.125,0.375);
    for(int i=0;i<4;i++){more+=shade(p+px*o,t,e);o=vec2(-o.y,o.x);}
    light=mix(light,(light+more)*0.2,ss);
  }
  vec3 col=u_colors[0]+light;
  vec2 v=uv-0.5;v.x*=u_resolution.x/u_resolution.y*0.75;
  col*=1.0-${f4(F.vignette)}*smoothstep(0.2,0.85,length(v));
  col+=u_dither*(hash(gl_FragCoord.xy)+hash(gl_FragCoord.xy+17.0)-1.0)/255.0;
  gl_FragColor=vec4(max(col,0.0),1.0);
}`;
// Presentation at native pixels: the field scaled up (with the surface scale and navigation refraction), the ±1/255
// triangular dither, then the stationary film grain, a little stronger in the midtones. The field is scaled with a
// cubic B-spline (four bilinear taps): a fold thinner than a field pixel, scaled linearly, shows each texel as a bead
// along the bright crest; the B-spline is smooth across texels and keeps the crest a continuous line.
const PRESENT_FS = refraction => `precision highp float;
uniform sampler2D u_field;uniform sampler2D u_blue;uniform vec2 u_resolution;uniform vec2 u_fieldSize;uniform vec2 u_navigationWave;uniform vec2 u_scale;uniform float u_grain;
${refraction}
${GRAIN_GLSL}
vec4 bspline(float f){vec4 n=vec4(1.0,2.0,3.0,4.0)-f,s=n*n*n;float x=s.x,y=s.y-4.0*s.x,z=s.z-4.0*s.y+6.0*s.x;return vec4(x,y,z,6.0-x-y-z)/6.0;}
vec3 field(vec2 uv){
  vec2 tc=uv*u_fieldSize-0.5,f=fract(tc);tc-=f;
  vec4 wx=bspline(f.x),wy=bspline(f.y),s=vec4(wx.xz+wx.yw,wy.xz+wy.yw);
  vec4 o=(tc.xxyy+vec4(-0.5,1.5,-0.5,1.5)+vec4(wx.yw,wy.yw)/s)/u_fieldSize.xxyy;
  float sx=s.x/(s.x+s.y),sy=s.z/(s.z+s.w);
  return mix(mix(texture2D(u_field,o.yw).rgb,texture2D(u_field,o.xw).rgb,sx),mix(texture2D(u_field,o.yz).rgb,texture2D(u_field,o.xz).rgb,sx),sy);
}
void main(){
  vec2 fc=gl_FragCoord.xy;
  vec2 p=(fc-0.5*u_resolution)/u_resolution.y;
  float extent=length(vec2(u_resolution.x/u_resolution.y,1.0)*0.5)+0.12;
  p=navigationRefraction(p/u_scale,u_navigationWave,extent);
  vec3 col=field(p*vec2(u_resolution.y/u_resolution.x,1.0)+0.5)*${f4(F.level)};
  col+=vec3(tpdf(fc,0.0),tpdf(fc+13.7,0.0),tpdf(fc+41.9,0.0))/255.0;
  float luma=dot(col,vec3(0.2126,0.7152,0.0722));
  col+=vec3(filmGrain(fc,0.0))*mix(1.0,1.4,smoothstep(0.0,0.2,luma))*u_grain;
  gl_FragColor=vec4(max(col,0.0),1.0);
}`;
const NO_REFRACTION = "vec2 navigationRefraction(vec2 p,vec2 phases,float extent){return p;}";

/* ===== stabiliser ===== */
// The surface is broad, so how much of it faces the light on screen swings over minutes. On a 24×14 grid of the same
// light, the body's threshold bias that brings the screen's mean brightness (Rec. 709 luma, vignette included) to the
// target is found by bisection; an exposure then closes what the bias's limits leave, within narrow bounds. The shader
// follows both with a lag of about a second and a half, so the background never fades out for a stretch nor floods.
// aspect: width / height; fieldHeight: the field target's height in pixels; colors: the three RGB colours.
const GRID_X = 24, GRID_Y = 14;
function stabiliserAt(aspect, t, fieldHeight, colors) {
  const e = 1.5 / fieldHeight, luma = c => c[0] * L[0] + c[1] * L[1] + c[2] * L[2];
  const base = luma(colors[0]), mid = luma(colors[1]), bright = luma(colors[2]), samples = [];
  let fixed = 0;
  for (let y = 0; y < GRID_Y; y++) for (let x = 0; x < GRID_X; x++) {
    const u = (x + .5) / GRID_X - .5, w = (y + .5) / GRID_Y - .5;
    const vig = 1 - F.vignette * smoothstep(.2, .85, Math.hypot(u * aspect * .75, w));
    fixed += base * vig; samples.push([surface(u * aspect, w, t, e), vig]);
  }
  const n = samples.length, goal = F.target - fixed / n;
  const lit = bias => { let sum = 0; for (const [s, vig] of samples) { const [body, sheen] = light(s, bias); sum += (mid * body + bright * sheen) * vig; } return sum / n; };
  let lo = -F.maxBias, hi = F.maxBias;
  for (let i = 0; i < 16; i++) { const m = (lo + hi) / 2; if (lit(m) < goal) lo = m; else hi = m; }
  const bias = (lo + hi) / 2;
  return { bias, exposure: Math.min(F.maxExposure, Math.max(F.minExposure, goal / Math.max(1e-4, lit(bias)))) };
}

/* ===== render ===== */
// GRAIN_UNIT: grain amplitude per unit of settings.grain × review strength; at the defaults (1.25 × 0.5) the grain is
// half of the previous background film grain at full strength (0.0098).
const GRAIN_UNIT = .00784, FIELD_EDGE = 320, FIELD_FPS = 15, WAVE_FPS = 60, RESIZE_MS = 160, MAX_DT = .1;
const DEFAULTS = { colors: ["#0c0c0d", "#5d6577", "#b4c4f0"], speed: 1, grain: 1.25 };
const rgb = c => { const s = String(c).replace("#", ""), h = s.length === 3 ? s.replace(/./g, "$&$&") : s, n = parseInt(h, 16); return isNaN(n) ? [0, 0, 0] : [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const decode = b64 => Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));

function create(surface, options = {}) {
  const budget = window.__renderBudget, host = surface.closest(".drape-host") || surface;
  const settings = { ...DEFAULTS, ...(options.settings || {}) };
  const canvas = document.createElement("canvas"), proxy = document.createElement("div");
  canvas.setAttribute("aria-hidden", "true"); proxy.className = "drape-wave";
  surface.append(canvas, proxy);
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
  if (!gl) { canvas.hidden = true; return null; }
  const noise = decode(window.__drapeBlueNoise || "");
  let res = null, time = Number(options.time) || 0, bias = 0, exposure = null, exposureTime = 0, target = null, measuredAt = -Infinity, generations = 0, presentations = 0, uploads = 0;
  let last = 0, lastField = -Infinity, lost = false, disposed = false, valid = false, fast = false, resizeTimer = 0;
  let grainStrength = .5, wave = [0, -1], scale = [1, 1];
  const css = { w: Math.max(1, surface.clientWidth || innerWidth), h: Math.max(1, surface.clientHeight || innerHeight) };
  const size = { w: 0, h: 0, fw: 0, fh: 0, dpr: 1, dirty: true };

  function program(fs, vs = VS) {
    const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw Error("Drape shader: " + log); } return s; };
    const v = shader(gl.VERTEX_SHADER, vs);
    let f;
    try { f = shader(gl.FRAGMENT_SHADER, fs); } catch (e) { gl.deleteShader(v); throw e; }
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f); gl.bindAttribLocation(p, 0, "p"); gl.linkProgram(p);
    gl.detachShader(p, v); gl.detachShader(p, f); gl.deleteShader(v); gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) { const log = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw Error("Drape program: " + log); }
    const u = {}, count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0;
    for (let i = 0; i < count; i++) { const name = gl.getActiveUniform(p, i).name; u[name.replace("[0]", "")] = gl.getUniformLocation(p, name); }
    return { p, u };
  }
  // GL resources: one buffer, the field program and the presentation (plus its refraction variant), the field target
  // (texture + framebuffer) and the blue-noise texture
  function build() {
    gl.getExtension("OES_standard_derivatives");
    const half = gl.getExtension("OES_texture_half_float"), linear = gl.getExtension("OES_texture_half_float_linear");
    gl.getExtension("EXT_color_buffer_half_float");
    const r = res = { half: half && linear ? half.HALF_FLOAT_OES : 0 };
    r.buffer = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, r.buffer);
    const mesh = [];
    for (let y = 0; y < GRID[1]; y++) for (let x = 0; x < GRID[0]; x++) {
      const x0 = x / GRID[0] * 2 - 1, x1 = (x + 1) / GRID[0] * 2 - 1, y0 = y / GRID[1] * 2 - 1, y1 = (y + 1) / GRID[1] * 2 - 1;
      mesh.push(x0, y0, x1, y0, x0, y1, x0, y1, x1, y0, x1, y1);
    }
    r.vertices = mesh.length / 2;
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    r.field = program(FIELD_FS); r.present = program(PRESENT_FS(NO_REFRACTION));
    // the refraction variant only while a navigation packet travels: at rest the cheaper program presents
    r.wave = options.refraction ? program(PRESENT_FS(options.refraction)) : r.present;
    r.blue = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, r.blue);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 128, 128, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, noise.length === 16384 ? noise : new Uint8Array(16384).fill(128));
    uploads++;
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.REPEAT], [gl.TEXTURE_WRAP_T, gl.REPEAT]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
    r.target = gl.createTexture(); r.fbo = gl.createFramebuffer();
    r.fw = r.fh = 0;
  }
  function release() {
    const r = res; res = null;
    if (!r || gl.isContextLost()) return;
    for (const p of new Set([r.field, r.present, r.wave])) if (p) gl.deleteProgram(p.p);
    if (r.buffer) gl.deleteBuffer(r.buffer);
    for (const t of [r.blue, r.target]) if (t) gl.deleteTexture(t);
    if (r.fbo) gl.deleteFramebuffer(r.fbo);
  }
  // the field target; half-float when it can be rendered to and filtered, otherwise 8-bit with its own dither
  function allocate(w, h) {
    const alloc = type => {
      gl.bindTexture(gl.TEXTURE_2D, res.target);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, type, null);
      for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR], [gl.TEXTURE_MAG_FILTER, gl.LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, res.target, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      return ok;
    };
    if (res.half && alloc(res.half)) res.storage = "half-float";
    else if (alloc(gl.UNSIGNED_BYTE)) res.storage = "rgba8";
    else if (!gl.isContextLost()) throw Error("Drape: field framebuffer incomplete");
    res.fw = w; res.fh = h;
  }
  // whole pixels: the canvas at CSS size × DPR (at most 2), the field at 320 px on its long edge
  function applySize() {
    clearTimeout(resizeTimer); resizeTimer = 0;
    const dpr = Math.min(2, devicePixelRatio || 1), w = Math.max(1, Math.round(css.w * dpr)), h = Math.max(1, Math.round(css.h * dpr));
    const fw = css.w >= css.h ? FIELD_EDGE : Math.max(1, Math.round(FIELD_EDGE * css.w / css.h));
    const fh = css.w >= css.h ? Math.max(1, Math.round(FIELD_EDGE * css.h / css.w)) : FIELD_EDGE;
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    Object.assign(size, { w, h, fw, fh, dpr, dirty: false });
    if (res && (res.fw !== fw || res.fh !== fh)) allocate(fw, fh);
    valid = false;
  }

  const allowed = () => !lost && !disposed && !!res && budget.visible && budget.focused && host.dataset.rest !== "tool" && !document.body.classList.contains("welcome-active");
  const still = () => budget.reduced || !(settings.speed > 0);
  // measured twice a field second; a jump in time (first frame, review) takes the exposure at once, otherwise
  // it eases toward the measure over about a second and a half
  function stabilise() {
    const jump = exposure === null || Math.abs(time - exposureTime) > 1;
    if (jump || Math.abs(time - measuredAt) >= .5) { target = stabiliserAt(size.fw / size.fh, time, size.fh, settings.colors.slice(0, 3).map(rgb)); measuredAt = time; }
    const k = jump ? 1 : 1 - Math.exp(-Math.abs(time - exposureTime) / 1.5);
    bias = jump ? target.bias : bias + (target.bias - bias) * k;
    exposure = jump ? target.exposure : exposure + (target.exposure - exposure) * k;
    exposureTime = time;
  }
  function renderField() {
    const f = res.field;
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo); gl.viewport(0, 0, res.fw, res.fh);
    gl.useProgram(f.p);
    gl.uniform2f(f.u.u_resolution, res.fw, res.fh); gl.uniform1f(f.u.u_time, time); gl.uniform1f(f.u.u_bias, bias); gl.uniform1f(f.u.u_exposure, exposure);
    gl.uniform3fv(f.u.u_colors, settings.colors.slice(0, 3).flatMap(rgb));
    gl.uniform1f(f.u.u_dither, res.storage === "rgba8" ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, res.vertices);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    generations++;
  }
  function present() {
    const q = wave[0] > 0 || wave[1] > 0 && wave[1] < 1.4 ? res.wave : res.present;
    gl.viewport(0, 0, size.w, size.h); gl.useProgram(q.p);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, res.target);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, res.blue);
    gl.uniform1i(q.u.u_field, 0); gl.uniform1i(q.u.u_blue, 1);
    gl.uniform2f(q.u.u_resolution, size.w, size.h); gl.uniform2f(q.u.u_fieldSize, res.fw, res.fh); gl.uniform2f(q.u.u_navigationWave, wave[0], wave[1]);
    gl.uniform2f(q.u.u_scale, scale[0], scale[1]); gl.uniform1f(q.u.u_grain, settings.grain * grainStrength * GRAIN_UNIT);
    gl.drawArrays(gl.TRIANGLES, 0, res.vertices);
    presentations++; valid = true;
  }
  function draw(field = true, now = performance.now()) {
    if (!res || lost || gl.isContextLost()) return;
    if (size.dirty) applySize();
    if (field || !generations) { stabilise(); renderField(); lastField = now; }
    present();
  }
  // the surface scale animated on the .drape-wave proxy (motion.js backgroundWave), read at each frame
  function readSurface() {
    const t = getComputedStyle(proxy).transform;
    if (!t || t === "none") { scale = [1, 1]; return; }
    const m = new DOMMatrixReadOnly(t); scale = [m.a || 1, m.d || 1];
  }
  // 15 Hz for the field; 60 Hz presentation only while the navigation wave or the surface scale moves
  function cadence() {
    const want = !still() && (wave[0] > 0 || scale[0] !== 1 || scale[1] !== 1);
    if (want !== fast) { fast = want; task.setFps(fast ? WAVE_FPS : FIELD_FPS); }
  }
  function frame(now) {
    if (!allowed() || still()) { sync(); return; }
    const dt = last ? Math.min(MAX_DT, (now - last) / 1000) : 0;
    last = now; time += dt * settings.speed;
    readSurface();
    // at 15 Hz every tick is a new field; at 60 Hz (wave) only every fourth or so
    draw(!fast || now - lastField >= 1000 / FIELD_FPS - 4, now);
    cadence();
  }
  const task = budget.add(frame, { fps: FIELD_FPS });
  // Runs on every change of policy: suspended views do no work at all, reduced motion keeps the last image.
  function sync(invalidate = false) {
    if (lost || disposed) { task.stop(); return; }
    if (!allowed()) { task.stop(); last = 0; return; }
    if (still()) {
      task.stop(); last = 0;
      if (fast) { fast = false; task.setFps(FIELD_FPS); }
      if (invalidate || size.dirty || !valid) draw(true);
      return;
    }
    if (invalidate && !valid) draw(true);
    task.start();
  }
  const onResize = () => { css.w = Math.max(1, surface.clientWidth || innerWidth); css.h = Math.max(1, surface.clientHeight || innerHeight); size.dirty = true; clearTimeout(resizeTimer); if (!lost) resizeTimer = setTimeout(() => { resizeTimer = 0; sync(true); }, RESIZE_MS); };
  const ro = new ResizeObserver(onResize); ro.observe(surface);
  addEventListener("resize", onResize);
  const mo = new MutationObserver(() => sync()); mo.observe(host, { attributes: true, attributeFilter: ["data-mode", "data-rest"] });
  const bo = new MutationObserver(() => sync()); bo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
  const unsubscribe = budget.subscribe(() => sync());
  const invalidate = () => { valid = false; sync(true); };
  addEventListener("drapeinvalidate", invalidate);
  const onLost = e => { e.preventDefault(); lost = true; res = null; task.stop(); clearTimeout(resizeTimer); resizeTimer = 0; size.dirty = true; };
  const onRestored = () => { if (disposed) return; lost = false; generations = presentations = 0; valid = false; try { build(); } catch (e) { release(); throw e; } size.dirty = true; sync(true); };
  canvas.addEventListener("webglcontextlost", onLost); canvas.addEventListener("webglcontextrestored", onRestored);

  try { build(); applySize(); } catch (e) { release(); canvas.remove?.(); proxy.remove?.(); throw e; }
  if (budget.visible && host.dataset.rest !== "tool" && !document.body.classList.contains("welcome-active")) draw(true);
  sync();

  // Read-only state and review controls (tests and visual review); no product setting.
  canvas.__drapeState = () => ({
    architecture: "tiny-field-blue-noise", state: lost ? "lost" : !allowed() ? "suspended" : still() ? "sleep" : "animate",
    time, bias, exposure, generations, presentations, fieldWidth: size.fw, fieldHeight: size.fh, fieldStorage: res?.storage || null,
    outputWidth: canvas.width, outputHeight: canvas.height, cssWidth: Math.round(css.w), cssHeight: Math.round(css.h), dpr: size.dpr,
    dirty: size.dirty, targetFps: FIELD_FPS, fps: fast ? WAVE_FPS : FIELD_FPS, grain: "static-film-grain", grainStrength,
    grainUpdates: 1, textureUploads: uploads, textures: res ? 2 : 0, framebuffers: res ? 1 : 0, programs: res ? (res.wave === res.present ? 2 : 3) : 0, scale: scale.slice(), wave: wave.slice()
  });
  canvas.__drapeReview = { setGrainStrength(v) { grainStrength = Math.max(0, Math.min(3, Number(v) || 0)); valid = false; sync(true); } };
  const scene = () => res && ({
    renderer: "drape", width: canvas.width, height: canvas.height, cssWidth: surface.clientWidth, cssHeight: surface.clientHeight,
    bufferWidth: gl.drawingBufferWidth, bufferHeight: gl.drawingBufferHeight, viewport: Array.from(gl.getParameter(gl.VIEWPORT)), dpr: devicePixelRatio,
    time, frame: generations, grain: settings.grain * grainStrength, bias, exposure, colors: settings.colors.slice(0, 3).map(rgb),
    resolution: [size.w, size.h], field: [size.fw, size.fh], storage: res.storage
  });
  return {
    canvas, proxy, scene,
    // a controlled draw at a given field time (visual review); the clock carries on from there
    sceneAt(v = {}) { if (Number.isFinite(v.time)) { time = v.time; exposure = null; } if (res && !lost) { readSurface(); draw(true); } return scene(); },
    // navigation refraction phases (navigation-refraction section of atmosphere.js)
    wave(phase, previous = -1) { wave = [phase, previous]; if (!allowed() || still()) return; cadence(); if (phase > 0) task.request(); else if (valid) present(); },
    set(next) { Object.assign(settings, next); valid = false; sync(true); },
    dispose() {
      if (disposed) return; disposed = true;
      task.dispose(); unsubscribe(); ro.disconnect(); mo.disconnect(); bo.disconnect(); clearTimeout(resizeTimer);
      removeEventListener("resize", onResize); removeEventListener("drapeinvalidate", invalidate);
      canvas.removeEventListener("webglcontextlost", onLost); canvas.removeEventListener("webglcontextrestored", onRestored);
      release();
    }
  };
}

window.__drape = { create, snoise, height, surface, light, stabiliserAt, field: F, glsl: { noise: NOISE_GLSL, field: FIELD_GLSL, grain: GRAIN_GLSL } };
})();
