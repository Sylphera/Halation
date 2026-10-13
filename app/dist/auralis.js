// Auralis: Home's window background (docs/BACKGROUNDS_SPEC.md §1). Halation's own code, written from that description.
// Folded satin under a soft light drifts slowly along a 37° diagonal over a near-black, slightly blue base. The light field is drawn into a small
// buffer (320 px on the long edge, half-float when the GPU allows) at 15 Hz; one pass at the window's native size
// (DPR up to 2) scales it with linear filtering and adds the stationary blue-noise grain and a ±1/255 dither.
// window.__auralis.create(surface, options) → { canvas, proxy, wave(phase, previous), scene(), sceneAt(v), dispose() }
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
function snoise(x, y, z) {
  const s = (x + y + z) / 3;
  let i = Math.floor(x + s), j = Math.floor(y + s), k = Math.floor(z + s);
  const t = (i + j + k) / 6, x0 = x - i + t, y0 = y - j + t, z0 = z - k + t;
  const gx = x0 >= y0 ? 1 : 0, gy = y0 >= z0 ? 1 : 0, gz = z0 >= x0 ? 1 : 0;
  const o1 = [Math.min(gx, 1 - gz), Math.min(gy, 1 - gx), Math.min(gz, 1 - gy)];
  const o2 = [Math.max(gx, 1 - gz), Math.max(gy, 1 - gx), Math.max(gz, 1 - gy)];
  const corners = [[x0, y0, z0], [x0 - o1[0] + 1 / 6, y0 - o1[1] + 1 / 6, z0 - o1[2] + 1 / 6],
    [x0 - o2[0] + 1 / 3, y0 - o2[1] + 1 / 3, z0 - o2[2] + 1 / 3], [x0 - .5, y0 - .5, z0 - .5]];
  const ox = [0, o1[0], o2[0], 1], oy = [0, o1[1], o2[1], 1], oz = [0, o1[2], o2[2], 1];
  i = mod289(i); j = mod289(j); k = mod289(k);
  let sum = 0;
  for (let c = 0; c < 4; c++) {
    const p = permute(permute(permute(k + oz[c]) + j + oy[c]) + i + ox[c]);
    const q = p - 49 * Math.floor(p / 49), xa = Math.floor(q / 7), ya = Math.floor(q - 7 * xa);
    let a = xa * (2 / 7) + (.5 / 7 - 1), b = ya * (2 / 7) + (.5 / 7 - 1);
    const h = 1 - Math.abs(a) - Math.abs(b), sh = h < -1e-4 ? -1 : 0;
    a += (Math.floor(a) * 2 + 1) * sh; b += (Math.floor(b) * 2 + 1) * sh;
    const n = 1.79284291400159 - .85373472095314 * (a * a + b * b + h * h), [cx, cy, cz] = corners[c];
    const m = Math.max(.5 - (cx * cx + cy * cy + cz * cz), 0);
    sum += m * m * m * m * n * (a * cx + b * cy + h * cz);
  }
  return 109 * sum;
}

/* ===== field ===== */
// One description of the light, shared by the shader and the CPU estimate. p: centred position in screen heights;
// t: field seconds. Everything lives in a frame turned 37° (x along the axis, y across it) that slides slowly along
// its axis; a weak, very slow bend shifts the across coordinate. The folds are lines of constant phase: straight
// lines (tilted a little steeper than the axis) displaced by a broad wave, which makes the S-curves and lets folds
// crowd and part, and a finer one, which makes them split and merge. Each fold is a soft ridge of satin with a dark
// groove beside it and a highlight on its lit flank. Clusters stretched along the axis gather the light, leaving
// large near-black spaces, and a sheen that follows the folds makes their highlights fade softly at their ends.
// Every rate is slow (about a hundredth of a unit per second), so the cloth drifts and morphs without popping.
const F = {
  zoom: 1, angle: 37 * Math.PI / 180, drift: .008, slide: .003,
  bendScale: .5, bendAmount: .25, bendRate: .009,
  tilt: .2, folds: 3.2, waveAlong: .65, waveAcross: 1.3, wave: 8, waveRate: .008, detailScale: 2.5, detail: 2.2, detailRate: .012,
  clusterAlong: .75, clusterAcross: 1.3, clusterRate: .009, low: -.15, high: .6, target: .22, floor: .08,
  sheenAlong: 1.1, sheenAcross: .45, sheenRate: .012, sheenLow: .3,
  groove: .45, relief: 1.1, reliefFloor: .4, crest: 6, crestGain: .5, bodyGain: 1.15, vignette: .42
};
const f4 = x => x.toFixed(5);
const FIELD_GLSL = `
const float ZOOM=${f4(F.zoom)};
const vec2 AXIS=vec2(${f4(Math.cos(F.angle))},${f4(Math.sin(F.angle))});
vec2 axisSpace(vec2 p,float t){return vec2(dot(p,AXIS),dot(p,vec2(-AXIS.y,AXIS.x)))-t*vec2(${f4(F.drift)},${f4(F.slide)});}
float bend(vec2 a,float t){return snoise(vec3(a*${f4(F.bendScale)},t*${f4(F.bendRate)}))*${f4(F.bendAmount)};}
float cluster(vec2 a,float t){return snoise(vec3(a*vec2(${f4(F.clusterAlong)},${f4(F.clusterAcross)})+vec2(41.0,-23.0),t*${f4(F.clusterRate)}));}
// the folds' phase: straight lines across the axis, displaced by a broad wave (S-curves, folds that converge and
// part) and a finer one (folds that split and merge); a phase step of 2π is one fold
float foldPhase(vec2 a,float t){
  return dot(a,vec2(${f4(-Math.sin(F.tilt) * F.folds * 2 * Math.PI)},${f4(Math.cos(F.tilt) * F.folds * 2 * Math.PI)}))+${f4(F.wave)}*snoise(vec3(a*vec2(${f4(F.waveAlong)},${f4(F.waveAcross)}),t*${f4(F.waveRate)}+7.0))
    +${f4(F.detail)}*snoise(vec3(a*vec2(${f4(F.waveAlong * F.detailScale)},${f4(F.waveAcross * F.detailScale)})+vec2(5.2,1.3),t*${f4(F.detailRate)}+2.1));
}`;
const AXIS = [Math.cos(F.angle), Math.sin(F.angle)];
const smoothstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const axisSpace = (px, py, t) => [px * AXIS[0] + py * AXIS[1] - t * F.drift, py * AXIS[0] - px * AXIS[1] - t * F.slide];
const bendValue = (ax, ay, t) => snoise(ax * F.bendScale, ay * F.bendScale, t * F.bendRate) * F.bendAmount;
// the cluster value at a screen position (what the stabiliser measures; the shader evaluates it at the grid's vertices)
function clusterValue(px, py, t) {
  const [ax, ay] = axisSpace(px, py, t), by = ay + bendValue(ax, ay, t);
  return snoise(ax * F.clusterAlong + 41, by * F.clusterAcross - 23, t * F.clusterRate);
}
function foldPhase(px, py, t) {
  const [ax, ay] = axisSpace(px, py, t), by = ay + bendValue(ax, ay, t);
  return (by * Math.cos(F.tilt) - ax * Math.sin(F.tilt)) * F.folds * 2 * Math.PI + F.wave * snoise(ax * F.waveAlong, by * F.waveAcross, t * F.waveRate + 7)
    + F.detail * snoise(ax * F.waveAlong * F.detailScale + 5.2, by * F.waveAcross * F.detailScale + 1.3, t * F.detailRate + 2.1);
}

/* ===== shader ===== */
// Both passes draw a 24×16 grid of the window; the field pass evaluates the clusters at its vertices (they change
// over about a screen, so interpolating them loses nothing) and the bend and the folds per pixel.
const GRID = [24, 16];
const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
const FIELD_VS = `precision highp float;
attribute vec2 p;uniform vec2 u_resolution;uniform float u_time;varying vec2 v_axis;varying float v_cluster;
${NOISE_GLSL}
${FIELD_GLSL}
void main(){
  vec2 a=axisSpace(p*0.5*vec2(u_resolution.x/u_resolution.y,1.0)*ZOOM,u_time);
  v_axis=a;a.y+=bend(a,u_time);v_cluster=cluster(a,u_time);
  gl_Position=vec4(p,0.0,1.0);
}`;
// The field: each fold is a ridge of the phase (0.5 + 0.5 sin), lit like satin by its slope, with a dark groove
// between ridges and a highlight of the brightest colour on its lit flank. u_bias keeps coverage steady.
const FIELD_FS = `precision highp float;
uniform vec2 u_resolution;uniform float u_time;uniform float u_bias;uniform vec3 u_colors[3];uniform float u_dither;
varying vec2 v_axis;varying float v_cluster;
${NOISE_GLSL}
${FIELD_GLSL}
float hash(vec2 p){vec3 q=fract(vec3(p.xyx)*0.1031);q+=dot(q,q.yzx+33.33);return fract((q.x+q.y)*q.z);}
void main(){
  vec2 uv=gl_FragCoord.xy/u_resolution;
  float t=u_time,e=1.0/u_resolution.y;
  vec2 a=v_axis;a.y+=bend(a,t);
  float ph=foldPhase(a,t);
  vec2 dp=vec2(foldPhase(a+vec2(e,0.0),t)-ph,foldPhase(a+vec2(0.0,e),t)-ph)/e;
  // folds packed tighter than about three field pixels flatten instead of aliasing
  float fine=1.0-smoothstep(0.25,0.45,length(dp)*e/6.2831853);
  float lit=smoothstep(${f4(F.low)},${f4(F.high)},v_cluster+u_bias);
  // sheen: patches of light that follow the folds (noise in fold space: along the axis × fold number)
  float sheen=smoothstep(-0.6,0.8,snoise(vec3(a.x*${f4(F.sheenAlong)},ph*${f4(F.sheenAcross / (2 * Math.PI))},t*${f4(F.sheenRate)}+3.0)));
  lit*=mix(${f4(F.sheenLow)},1.0,sheen);
  // the cloth: a height of sin(phase) whose slope does not depend on how tightly the folds are packed (deep where
  // they are wide, shallow where they crowd, flat where they turn back) and grows with the light, so folds and
  // highlights fade at their ends
  float relief=${f4(F.relief)}*mix(${f4(F.reliefFloor)},1.0,lit)*fine;
  vec2 g=cos(ph)*dp*inversesqrt(dot(dp,dp)+${f4((F.folds * Math.PI) ** 2)})*relief;
  vec3 n=normalize(vec3(-g,1.0));
  float diffuse=clamp(0.6+0.8*dot(n,normalize(vec3(-0.35,0.55,0.75)))-0.48,0.0,1.0);
  float crest=pow(max(dot(n,normalize(vec3(-0.2,0.45,1.0))),0.0),${f4(F.crest)});
  float body=${f4(F.floor)}+${f4(1 - F.floor)}*lit*lit;
  vec3 col=u_colors[0];
  col+=u_colors[1]*0.5*body*(0.35+0.65*diffuse)*mix(1.0,${f4(1 - F.groove)}+${f4(F.groove)}*sin(ph),fine)*${f4(F.bodyGain)};
  col+=u_colors[2]*lit*crest*${f4(F.crestGain)};
  vec2 v=uv-0.5;v.x*=u_resolution.x/u_resolution.y*0.75;
  col*=1.0-${f4(F.vignette)}*smoothstep(0.18,0.85,length(v));
  col+=u_dither*(hash(gl_FragCoord.xy)+hash(gl_FragCoord.xy+17.0)-1.0)/255.0;
  gl_FragColor=vec4(max(col,0.0),1.0);
}`;
// Presentation at native pixels: the field scaled up (with the surface scale and navigation refraction), then the
// stationary grain, a little stronger in the midtones, and a triangular ±1/255 dither from the same blue noise.
const PRESENT_FS = refraction => `precision highp float;
uniform sampler2D u_field;uniform sampler2D u_blue;uniform vec2 u_resolution;uniform vec2 u_navigationWave;uniform vec2 u_scale;uniform float u_grain;
${refraction}
float blue(vec2 fc){return texture2D(u_blue,fc/128.0).r;}
void main(){
  vec2 fc=gl_FragCoord.xy;
  vec2 p=(fc-0.5*u_resolution)/u_resolution.y;
  float extent=length(vec2(u_resolution.x/u_resolution.y,1.0)*0.5)+0.12;
  p=navigationRefraction(p/u_scale,u_navigationWave,extent);
  vec3 col=texture2D(u_field,p*vec2(u_resolution.y/u_resolution.x,1.0)+0.5).rgb;
  float l=dot(col,vec3(0.2126,0.7152,0.0722));
  float mid=smoothstep(0.004,0.06,l)*(1.0-0.5*smoothstep(0.2,0.5,l));
  float a=blue(fc),b=blue(fc.yx+vec2(61.0,23.0));
  col+=(a-0.5)*u_grain*(1.0+0.6*mid)/255.0;
  col+=(a+b-1.0)/255.0;
  gl_FragColor=vec4(col,1.0);
}`;
const NO_REFRACTION = "vec2 navigationRefraction(vec2 p,vec2 phases,float extent){return p;}";

/* ===== stabiliser ===== */
// The lit share of the screen (clusters × sheen × vignette, before shading) is measured on a 24×14 grid of the same field and
// the bias that brings its mean to the target is found by bisection; the shader's bias follows it with a lag of about
// a second, so the background never fades out for a stretch nor floods.
const GRID_X = 24, GRID_Y = 14;
function coverageBias(aspect, t) {
  const n = new Float32Array(GRID_X * GRID_Y), v = new Float32Array(GRID_X * GRID_Y);
  for (let y = 0, k = 0; y < GRID_Y; y++) for (let x = 0; x < GRID_X; x++, k++) {
    const u = (x + .5) / GRID_X - .5, w = (y + .5) / GRID_Y - .5;
    const px = u * aspect * F.zoom, py = w * F.zoom, ax = px * AXIS[0] + py * AXIS[1] - t * F.drift;
    const sheen = smoothstep(-.6, .8, snoise(ax * F.sheenAlong, foldPhase(px, py, t) * F.sheenAcross / (2 * Math.PI), t * F.sheenRate + 3));
    n[k] = clusterValue(px, py, t);
    v[k] = (F.sheenLow + (1 - F.sheenLow) * sheen) * (1 - F.vignette * smoothstep(.18, .85, Math.hypot(u * aspect * .75, w)));
  }
  const mean = bias => { let s = 0; for (let k = 0; k < n.length; k++) s += smoothstep(F.low, F.high, n[k] + bias) * v[k]; return s / n.length; };
  let lo = -.8, hi = .8;
  for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (mean(mid) < F.target) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

/* ===== render ===== */
const FIELD_EDGE = 320, FIELD_FPS = 15, WAVE_FPS = 60, RESIZE_MS = 160, MAX_DT = .1;
const DEFAULTS = { colors: ["#020203", "#5d6577", "#b4c4f0"], speed: 1, grain: 1.25 };
const rgb = c => { const s = String(c).replace("#", ""), h = s.length === 3 ? s.replace(/./g, "$&$&") : s, n = parseInt(h, 16); return isNaN(n) ? [0, 0, 0] : [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };
const decode = b64 => Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));

function create(surface, options = {}) {
  const budget = window.__renderBudget, host = surface.closest(".auralis-host") || surface;
  const settings = { ...DEFAULTS, ...(options.settings || {}) };
  const canvas = document.createElement("canvas"), proxy = document.createElement("div");
  canvas.setAttribute("aria-hidden", "true"); proxy.className = "auralis-wave";
  surface.append(canvas, proxy);
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
  if (!gl) { canvas.hidden = true; return null; }
  const noise = decode(window.__auralisBlueNoise || "");
  let res = null, time = Number(options.time) || 0, bias = null, biasAt = 0, target = 0, measuredAt = -Infinity, generations = 0, presentations = 0, uploads = 0;
  let last = 0, lastField = -Infinity, lost = false, disposed = false, valid = false, fast = false, resizeTimer = 0;
  let grainStrength = .5, wave = [0, -1], scale = [1, 1];
  const css = { w: Math.max(1, surface.clientWidth || innerWidth), h: Math.max(1, surface.clientHeight || innerHeight) };
  const size = { w: 0, h: 0, fw: 0, fh: 0, dpr: 1, dirty: true };

  function program(fs, vs = VS) {
    const shader = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw Error("Auralis shader: " + log); } return s; };
    const v = shader(gl.VERTEX_SHADER, vs);
    let f;
    try { f = shader(gl.FRAGMENT_SHADER, fs); } catch (e) { gl.deleteShader(v); throw e; }
    const p = gl.createProgram();
    gl.attachShader(p, v); gl.attachShader(p, f); gl.bindAttribLocation(p, 0, "p"); gl.linkProgram(p);
    gl.detachShader(p, v); gl.detachShader(p, f); gl.deleteShader(v); gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) { const log = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw Error("Auralis program: " + log); }
    const u = {}, count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) || 0;
    for (let i = 0; i < count; i++) { const name = gl.getActiveUniform(p, i).name; u[name.replace("[0]", "")] = gl.getUniformLocation(p, name); }
    return { p, u };
  }
  // GL resources: one buffer, the field program and the presentation (plus its refraction variant), the field target
  // (texture + framebuffer) and the blue-noise texture
  function build() {
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
    r.field = program(FIELD_FS, FIELD_VS); r.present = program(PRESENT_FS(NO_REFRACTION));
    // the refraction variant only while a navigation packet travels: at rest the cheaper program presents
    r.wave = options.refraction ? program(PRESENT_FS(options.refraction)) : r.present;
    r.blue = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, r.blue);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 128, 128, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, noise.length === 16384 ? noise : new Uint8Array(16384).fill(128));
    uploads++;
    for (const [k, v] of [[gl.TEXTURE_MIN_FILTER, gl.NEAREST], [gl.TEXTURE_MAG_FILTER, gl.NEAREST], [gl.TEXTURE_WRAP_S, gl.REPEAT], [gl.TEXTURE_WRAP_T, gl.REPEAT]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
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
    else if (!gl.isContextLost()) throw Error("Auralis: field framebuffer incomplete");
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
  // measured four times a field second; a jump in time (first frame, review) takes the bias at once, otherwise it
  // eases toward the measure over about a second
  function stabilise() {
    const jump = bias === null || Math.abs(time - biasAt) > 1;
    if (jump || Math.abs(time - measuredAt) >= .25) { target = coverageBias(size.fw / size.fh, time); measuredAt = time; }
    bias = jump ? target : bias + (target - bias) * (1 - Math.exp(-Math.abs(time - biasAt)));
    biasAt = time;
  }
  function renderField() {
    const f = res.field;
    gl.bindFramebuffer(gl.FRAMEBUFFER, res.fbo); gl.viewport(0, 0, res.fw, res.fh);
    gl.useProgram(f.p);
    gl.uniform2f(f.u.u_resolution, res.fw, res.fh); gl.uniform1f(f.u.u_time, time); gl.uniform1f(f.u.u_bias, bias);
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
    gl.uniform2f(q.u.u_resolution, size.w, size.h); gl.uniform2f(q.u.u_navigationWave, wave[0], wave[1]);
    gl.uniform2f(q.u.u_scale, scale[0], scale[1]); gl.uniform1f(q.u.u_grain, settings.grain * grainStrength * 5);
    gl.drawArrays(gl.TRIANGLES, 0, res.vertices);
    presentations++; valid = true;
  }
  function draw(field = true, now = performance.now()) {
    if (!res || lost || gl.isContextLost()) return;
    if (size.dirty) applySize();
    if (field || !generations) { stabilise(); renderField(); lastField = now; }
    present();
  }
  // the surface scale animated on the .auralis-wave proxy (motion.js backgroundWave), read at each frame
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
  addEventListener("auralisinvalidate", invalidate);
  const onLost = e => { e.preventDefault(); lost = true; res = null; task.stop(); clearTimeout(resizeTimer); resizeTimer = 0; size.dirty = true; };
  const onRestored = () => { if (disposed) return; lost = false; generations = presentations = 0; valid = false; try { build(); } catch (e) { release(); throw e; } size.dirty = true; sync(true); };
  canvas.addEventListener("webglcontextlost", onLost); canvas.addEventListener("webglcontextrestored", onRestored);

  try { build(); applySize(); } catch (e) { release(); canvas.remove?.(); proxy.remove?.(); throw e; }
  if (budget.visible && host.dataset.rest !== "tool" && !document.body.classList.contains("welcome-active")) draw(true);
  sync();

  // Read-only state and review controls (tests and visual review); no product setting.
  canvas.__auralisState = () => ({
    architecture: "tiny-field-blue-noise", state: lost ? "lost" : !allowed() ? "suspended" : still() ? "sleep" : "animate",
    time, bias, generations, presentations, fieldWidth: size.fw, fieldHeight: size.fh, fieldStorage: res?.storage || null,
    outputWidth: canvas.width, outputHeight: canvas.height, cssWidth: Math.round(css.w), cssHeight: Math.round(css.h), dpr: size.dpr,
    dirty: size.dirty, targetFps: FIELD_FPS, fps: fast ? WAVE_FPS : FIELD_FPS, grain: "static-blue-noise", grainStrength,
    grainUpdates: 1, textureUploads: uploads, textures: res ? 2 : 0, framebuffers: res ? 1 : 0, programs: res ? (res.wave === res.present ? 2 : 3) : 0, scale: scale.slice(), wave: wave.slice()
  });
  canvas.__auralisReview = { setGrainStrength(v) { grainStrength = Math.max(0, Math.min(3, Number(v) || 0)); valid = false; sync(true); } };
  const scene = () => res && ({
    renderer: "auralis", width: canvas.width, height: canvas.height, cssWidth: surface.clientWidth, cssHeight: surface.clientHeight,
    bufferWidth: gl.drawingBufferWidth, bufferHeight: gl.drawingBufferHeight, viewport: Array.from(gl.getParameter(gl.VIEWPORT)), dpr: devicePixelRatio,
    time, frame: generations, grain: settings.grain * grainStrength, bias, colors: settings.colors.slice(0, 3).map(rgb),
    resolution: [size.w, size.h], field: [size.fw, size.fh], storage: res.storage
  });
  return {
    canvas, proxy, scene,
    // a controlled draw at a given field time (visual review); the clock carries on from there
    sceneAt(v = {}) { if (Number.isFinite(v.time)) { time = v.time; bias = null; } if (res && !lost) { readSurface(); draw(true); } return scene(); },
    // navigation refraction phases (navigation-refraction section of atmosphere.js)
    wave(phase, previous = -1) { wave = [phase, previous]; if (!allowed() || still()) return; cadence(); if (phase > 0) task.request(); else if (valid) present(); },
    set(next) { Object.assign(settings, next); valid = false; sync(true); },
    dispose() {
      if (disposed) return; disposed = true;
      task.dispose(); unsubscribe(); ro.disconnect(); mo.disconnect(); bo.disconnect(); clearTimeout(resizeTimer);
      removeEventListener("resize", onResize); removeEventListener("auralisinvalidate", invalidate);
      canvas.removeEventListener("webglcontextlost", onLost); canvas.removeEventListener("webglcontextrestored", onRestored);
      release();
    }
  };
}

window.__auralis = { create, snoise, clusterValue, foldPhase, coverageBias, field: F, glsl: { noise: NOISE_GLSL, field: FIELD_GLSL } };
})();
