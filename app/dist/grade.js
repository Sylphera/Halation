// Grade: the whole tab in one ES module.
import { makeGrader, CLASSIC, fxDefaults, adjustToGrade, gmapToGrade, FX, groupName, ADJ, GMAP, TEXT, BUILTIN_FONTS, schemaDefaults, ADJ2, CATS2, LOOK2, LOOKS2, cat2Name, cleanAdj, cleanDef, defKey, finishOf, hasAdj, layerDef, look2Name, lookUniforms } from './grader.js';
import { buildLookLUT } from './grade-color.js';

/* ===== util ===== */
// Helpers shared by the Grade modules

const { $, clamp, mk, clone, sleep, esc, cap, setStatus, saveFile } = window.__ui;   // common.js
const c01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
const rid = () => Math.random().toString(36).slice(2, 10);
const LS_KEY = "halation-grade-v1";
const HAL = window.__hal || null;
const IMG = window.__img;
const M = window.__motion;
function hexRGB(h) { const n = parseInt(String(h).replace("#", ""), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/* ===== state ===== */
// Shared state: image, layers, crop, history, looks

// State several modules read and change
const G = { img: { name: "", w: 0, h: 0 }, lastSrc: null, srcTex: null, fontsTick: 0, layers: [], crop: { aspect: "orig", p: null }, cut: null, srcBlob: null, hist: [], hi: -1, showOrig: false, systemFonts: [], thumbPct: 100, looks: {}, favs: [], batchRunning: false, activeDraft: null };
// Functions of higher modules that lower ones call (registered by each module when it loads)
const up = {};

/* ===== gl ===== */
// WebGL: shaders, render targets, LUTs, effect passes and the source texture

/* =================== WebGL =================== */
const canvas = $("#gl");
const gl = canvas.getContext("webgl2", { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
const MAXTEX = gl ? Math.min(gl.getParameter(gl.MAX_TEXTURE_SIZE), 8192) : 0;
const HEAD = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 uv; out vec4 o; uniform sampler2D tex;
float luma(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
vec3 screen(vec3 a, vec3 b){ return 1.-(1.-a)*(1.-b); }
`;
// The crop (imgops.js parameters on the original): output uv → source uv. Both are y-up here (the texture is
// flipped on upload), so the picture's clockwise turn is a positive angle. cropR: the source's width / height.
const CROPFN = `uniform vec2 cropC; uniform vec2 cropS; uniform float cropA; uniform float cropR;
vec2 cropUV(vec2 u){ vec2 q = (u-.5)*cropS*vec2(cropR,1.); float c = cos(cropA), s = sin(cropA);
  return vec2(cropC.x, 1.-cropC.y) + vec2(c*q.x - s*q.y, s*q.x + c*q.y)/vec2(cropR,1.); }
`;
const FS = {
  crop: CROPFN + `void main(){ o = vec4(texture(tex, cropUV(uv)).rgb, 1.); }`,
  copy: `uniform vec4 crop; void main(){ o = vec4(texture(tex, crop.xy + uv*crop.zw).rgb, 1.); }`,
  // a Cutout mask (its alpha, on the original) becomes the alpha
  out: CROPFN + `uniform vec2 res; uniform sampler2D mask; uniform float useMask;
    void main(){ vec3 c = texture(tex, uv).rgb; c += (hash(uv*res + 3.1) - .5)/255.; o = vec4(c, useMask > .5 ? texture(mask, cropUV(uv)).a : 1.); }`,
  lut: `uniform sampler3D lut; uniform float amt; void main(){ vec3 c = clamp(texture(tex,uv).rgb,0.,1.); vec3 l = texture(lut, c*(32./33.) + .5/33.).rgb; o = vec4(mix(c,l,amt),1.); }`,
  // A look (docs/GRADE_LOOKS_SPEC.md §4): its LUT (RGBA16F) between the layer's pre-look adjustments (white balance,
  // exposure, a soft shoulder) and post-look ones in OKLab (contrast, shadows, highlights, fade, saturation)
  look: `uniform sampler3D lut; uniform float amt; uniform vec3 wb; uniform float pre; uniform float post;
    uniform float con; uniform float hi; uniform float sh; uniform float sat; uniform float fade;
    vec3 s2l(vec3 c){ vec3 a = abs(c); return sign(c)*mix(a/12.92, pow((a+.055)/1.055, vec3(2.4)), step(.04045, a)); }
    vec3 l2s(vec3 c){ vec3 a = abs(c); return sign(c)*mix(a*12.92, 1.055*pow(a, vec3(1./2.4))-.055, step(.0031308, a)); }
    vec3 toLab(vec3 c){ vec3 l = vec3(dot(c, vec3(.4122214708,.5363325363,.0514459929)), dot(c, vec3(.2119034982,.6806995451,.1073969566)), dot(c, vec3(.0883024619,.2817188376,.6299787005)));
      l = sign(l)*pow(abs(l), vec3(1./3.));
      return vec3(dot(l, vec3(.2104542553,.7936177850,-.0040720468)), dot(l, vec3(1.9779984951,-2.4285922050,.4505937099)), dot(l, vec3(.0259040371,.7827717662,-.8086757660))); }
    vec3 toLin(vec3 L){ vec3 l = vec3(dot(L, vec3(1.,.3963377774,.2158037573)), dot(L, vec3(1.,-.1055613458,-.0638541728)), dot(L, vec3(1.,-.0894841775,-1.2914855480))); l = l*l*l;
      return vec3(dot(l, vec3(4.0767416621,-3.3077115913,.2309699292)), dot(l, vec3(-1.2684380046,2.6097574011,-.3413193965)), dot(l, vec3(-.0041960863,-.7034186147,1.7076147010))); }
    bool inG(vec3 c){ return all(greaterThanEqual(c, vec3(-1e-4))) && all(lessThanEqual(c, vec3(1.0001))); }
    void main(){
      vec3 c = clamp(texture(tex,uv).rgb, 0., 1.), x = c;
      if(pre > .5){ x = l2s(s2l(c)*wb); x = mix(x, .82 + .18*tanh((x-.82)/.18), step(.82, x)); x = clamp(x, 0., 1.); }
      vec3 l = texture(lut, x*(32./33.) + .5/33.).rgb;
      if(post > .5){
        vec3 q = toLab(s2l(clamp(l, 0., 1.))); float L = q.x, C = length(q.yz);
        float g = 1. + con*.9; L = L < .6 ? .6*pow(max(L, 0.)/.6, g) : 1. - .4*pow(max(1.-L, 0.)/.4, g);
        float u = clamp(L/.7, 0., 1.); L += sh*.09*6.75*u*(1.-u)*(1.-u);
        float v = clamp((L-.35)/.65, 0., 1.); L += hi*.09*6.75*v*v*(1.-v);
        L = fade*.1 + L*(1. - fade*.14);
        float k = 1. + sat*(sat > 0. ? .35 + .65*(1. - smoothstep(0., .2, C)) : 1.);
        q = vec3(clamp(L, 0., 1.), q.yz*max(k, 0.));
        vec3 r = toLin(q);
        if(!inG(r)){ float lo = 0., hi2 = 1.; for(int i = 0; i < 12; i++){ float m = (lo+hi2)*.5; if(inG(toLin(vec3(q.x, q.yz*m)))) lo = m; else hi2 = m; } r = toLin(vec3(q.x, q.yz*lo)); }
        l = l2s(clamp(r, 0., 1.));
      }
      o = vec4(mix(c, l, amt), 1.); }`,
  gauss: `uniform vec2 dir; void main(){ vec3 s = vec3(0.); float tw = 0.; for(int k=-4;k<=4;k++){ float w = exp(-float(k*k)/8.); s += texture(tex, uv + dir*float(k)).rgb*w; tw += w; } o = vec4(s/tw,1.); }`,
  threshold: `uniform float thr; uniform float knee; void main(){ vec3 c = texture(tex,uv).rgb; float l = max(max(c.r,c.g),c.b); o = vec4(c*smoothstep(thr, thr+knee, l),1.); }`,
  combine: `uniform sampler2D fx; uniform sampler2D fx2; uniform float w1; uniform float w2; uniform vec3 tint; uniform float amt; uniform float mode;
    void main(){ vec3 b = texture(tex,uv).rgb; vec3 f = (texture(fx,uv).rgb*w1 + texture(fx2,uv).rgb*w2)*tint*amt; o = vec4(mode < .5 ? b + f : screen(b, clamp(f,0.,1.)), 1.); }`,
  glow: `uniform sampler2D fx; uniform float amt; void main(){ vec3 b = texture(tex,uv).rgb, f = texture(fx,uv).rgb; o = vec4(mix(b, screen(b,f), amt),1.); }`,
  mixfx: `uniform sampler2D fx; uniform float amt; void main(){ o = vec4(mix(texture(tex,uv).rgb, texture(fx,uv).rgb, amt),1.); }`,
  radial: `uniform sampler2D fx; uniform float amt; uniform float inner; uniform float soft; void main(){ float d = length((uv-.5)*2.)/1.41421; float m = smoothstep(inner, inner+soft, d); o = vec4(mix(texture(tex,uv).rgb, texture(fx,uv).rgb, m*amt),1.); }`,
  dirblur: `uniform vec2 dir; void main(){ vec3 s = vec3(0.); for(int k=0;k<24;k++){ float t = float(k)/23. - .5; s += texture(tex, uv + dir*t).rgb; } o = vec4(s/24.,1.); }`,
  streak: `uniform vec2 dir; void main(){ vec3 s = vec3(0.); for(int k=-16;k<=16;k++){ float t = float(k)/16.; float w = pow(1.-abs(t),3.); s += texture(tex, uv + dir*t).rgb*w; } o = vec4(s*.22,1.); }`,
  sharpen: `uniform vec2 px; uniform float amt; void main(){ vec3 c = texture(tex,uv).rgb; vec3 n = texture(tex,uv+vec2(px.x,0.)).rgb + texture(tex,uv-vec2(px.x,0.)).rgb + texture(tex,uv+vec2(0.,px.y)).rgb + texture(tex,uv-vec2(0.,px.y)).rgb; o = vec4(c + (c*4.-n)*amt*.5,1.); }`,
  ghost: `uniform vec2 off; uniform float amt; void main(){ vec3 b = texture(tex,uv).rgb; vec3 g = texture(tex, uv-off).rgb; o = vec4(mix(b, screen(b, g*.9), amt),1.); }`,
  chroma: `uniform float k; uniform float amt; void main(){ vec2 d = uv-.5; vec3 b = texture(tex,uv).rgb; vec3 s = vec3(texture(tex, uv + d*k).r, b.g, texture(tex, uv - d*k).b); o = vec4(mix(b,s,amt),1.); }`,
  rgbshift: `uniform vec2 off; uniform float amt; void main(){ vec3 b = texture(tex,uv).rgb; vec3 s = vec3(texture(tex,uv+off).r, b.g, texture(tex,uv-off).b); o = vec4(mix(b,s,amt),1.); }`,
  grain: `uniform vec2 res; uniform float size; uniform float amt; uniform float colored; uniform float shadows;
    float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f); float a = hash(i), b = hash(i+vec2(1.,0.)), c = hash(i+vec2(0.,1.)), d = hash(i+vec2(1.,1.)); return mix(mix(a,b,f.x), mix(c,d,f.x), f.y); }
    void main(){ vec3 c = texture(tex,uv).rgb; vec2 p = uv*res/size; vec3 n = colored > .5 ? vec3(vn(p), vn(p+vec2(17.3,5.1)), vn(p+vec2(41.7,23.9))) : vec3(vn(p)); n -= .5; float l = luma(c); float w = .35 + .65*(1.-abs(l*2.-1.)); w = mix(w, .3 + .7*(1.-l)*(1.-l*.5), shadows); o = vec4(c + n*amt*w, 1.); }`,
  vignette: `uniform float size; uniform float soft; uniform float amt; uniform float aspect; void main(){ vec2 q = uv-.5; q.x *= aspect; float d = length(q)/(.5*length(vec2(aspect,1.))); float v = smoothstep(size, size+soft, d); o = vec4(texture(tex,uv).rgb*(1.-v*amt),1.); }`,
  halftone: `uniform vec2 res; uniform float cell; uniform float ang; uniform float amt; uniform float mono;
    void main(){ vec2 p = uv*res; float s = sin(ang), c = cos(ang); mat2 R = mat2(c,-s,s,c); mat2 Ri = mat2(c,s,-s,c);
      vec2 q = R*p; vec2 cc = (floor(q/cell)+.5)*cell; vec3 col = texture(tex, clamp((Ri*cc)/res, 0., 1.)).rgb;
      float l = luma(col); float r = sqrt(clamp(1.-l,0.,1.))*cell*.62; float d = length(q-cc); float dm = 1.-smoothstep(r-1., r+1., d);
      vec3 paper = mono > .5 ? vec3(1.) : min(col*1.25+.05, 1.); vec3 ink = mono > .5 ? vec3(0.) : col*.15;
      vec3 res2 = mix(paper, ink, dm); o = vec4(mix(texture(tex,uv).rgb, res2, amt),1.); }`,
  pixelate: `uniform vec2 res; uniform float cell; uniform float amt; void main(){ vec2 p = (floor(uv*res/cell)+.5)*cell/res; o = vec4(mix(texture(tex,uv).rgb, texture(tex,p).rgb, amt),1.); }`,
  scan: `uniform vec2 res; uniform float spacing; uniform float amt; void main(){ vec3 c = texture(tex,uv).rgb; float l = .5 + .5*sin(uv.y*res.y/spacing*6.2831853); o = vec4(c*(1.-amt*.6*l),1.); }`,
  dust: `uniform vec2 res; uniform float u; uniform float dens; uniform float scr; uniform float amt;
    void main(){ vec3 c = texture(tex,uv).rgb; vec2 p = uv*res/max(u,.3); float m = 0.;
      vec2 cell = floor(p/5.); if(hash(cell+7.3) > 1.-.006*dens){ vec2 cc = (cell+.5)*5.; float r = .8+1.6*hash(cell+3.7); m = max(m, 1.-smoothstep(r*.5, r, length(p-cc))); }
      float cx = floor(p.x/2.5); if(hash(vec2(cx, 11.1)) > 1.-.004*scr){ float fl = hash(vec2(cx, floor(p.y/60.)+2.)); m = max(m, .55*step(.35, fl)); }
      o = vec4(mix(c, vec3(.94), m*amt*.85),1.); }`,
  leak: `uniform vec3 col; uniform float ang; uniform float size; uniform float amt; uniform float aspect;
    void main(){ vec3 c = texture(tex,uv).rgb; vec2 q = uv-.5; q.x *= aspect; vec2 dir = vec2(cos(ang), sin(ang))*.6*max(aspect,1.); float d = length(q-dir); float g = exp(-d*d/(size*size)); o = vec4(screen(c, col*g*amt),1.); }`,
  over: `uniform sampler2D fx; uniform float amt; void main(){ vec3 b = texture(tex,uv).rgb; vec4 t = texture(fx,uv); o = vec4(mix(b, t.rgb, t.a*amt),1.); }`
};
const PROG = {};
let vao = null, srcW = 0, srcH = 0;
let vertexShader = null;
function compile(type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}
function initGL() {
  vertexShader = compile(gl.VERTEX_SHADER, `#version 300 es
in vec2 p; out vec2 uv; void main(){ uv = p*.5+.5; gl_Position = vec4(p,0.,1.); }`);
  vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
}
function program(name) {
  if (PROG[name]) return PROG[name];
  const p = gl.createProgram(), shader = compile(gl.FRAGMENT_SHADER, HEAD + FS[name]);
  gl.attachShader(p, vertexShader); gl.attachShader(p, shader);
  gl.bindAttribLocation(p, 0, "p"); gl.linkProgram(p); gl.deleteShader(shader);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { const error = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error(name + ": " + error); }
  return PROG[name] = { p, loc: {} };
}
// Prepare only the basic preview passes after the interface has painted. Effects remain lazy.
function warmPreview() {
  const names = ["crop", "copy", "out", "look"];
  const next = () => {
    if (!names.length || !gl) return;
    const run = () => {
      try { program(names.shift()); next(); }
      catch (e) { names.length = 0; console.error(e); setStatus(t("grade.st.glFailed", { error: e.message }), "bad"); }
    };
    if (window.requestIdleCallback) requestIdleCallback(run, { timeout: 1000 }); else setTimeout(run, 0);
  };
  requestAnimationFrame(() => requestAnimationFrame(next));
}
function loc(pr, n) { if (!(n in pr.loc)) pr.loc[n] = gl.getUniformLocation(pr.p, n); return pr.loc[n]; }
function pass(name, uni, texs, target) {
  const pr = program(name); gl.useProgram(pr.p);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fbo : null);
  if (target) gl.viewport(0, 0, target.w, target.h); else gl.viewport(0, 0, canvas.width, canvas.height);
  let unit = 0;
  for (const [n, t] of Object.entries(texs)) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    if (t && t.is3d) gl.bindTexture(gl.TEXTURE_3D, t.tex); else gl.bindTexture(gl.TEXTURE_2D, t);
    gl.uniform1i(loc(pr, n), unit); unit++;
  }
  for (const [n, v] of Object.entries(uni)) {
    const l = loc(pr, n); if (l === null) continue;
    if (typeof v === "number") gl.uniform1f(l, v);
    else if (typeof v === "boolean") gl.uniform1f(l, v ? 1 : 0);
    else if (v.length === 2) gl.uniform2f(l, v[0], v[1]);
    else if (v.length === 3) gl.uniform3f(l, v[0], v[1], v[2]);
    else gl.uniform4f(l, v[0], v[1], v[2], v[3]);
  }
  gl.bindVertexArray(vao); gl.drawArrays(gl.TRIANGLES, 0, 3);
}
/* render-target pool */
const pool = [];
function acquire(w, h) {
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  for (const t of pool) if (!t.busy && t.w === w && t.h === h) { t.busy = true; return t; }
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const t = { tex, fbo, w, h, busy: true }; pool.push(t); return t;
}
function release(t) { if (t) t.busy = false; }
function purge(keep) {
  for (let i = pool.length - 1; i >= 0; i--) {
    const t = pool[i];
    if (!t.busy && !(keep && keep(t))) { gl.deleteTexture(t.tex); gl.deleteFramebuffer(t.fbo); pool.splice(i, 1); }
  }
}
function blurTex(src, r) {
  let t = src, own = false;
  while (r > 5 && t.w > 8 && t.h > 8) {
    const n = acquire(Math.ceil(t.w / 2), Math.ceil(t.h / 2)); pass("copy", { crop: [0, 0, 1, 1] }, { tex: t.tex }, n);
    if (own) release(t); t = n; own = true; r /= 2;
  }
  if (r < 0.3) { if (!own) { const n = acquire(t.w, t.h); pass("copy", { crop: [0, 0, 1, 1] }, { tex: t.tex }, n); t = n; } return t; }
  const step = r / 4;
  for (let it = 0; it < 2; it++) {
    const a = acquire(t.w, t.h); pass("gauss", { dir: [step / t.w, 0] }, { tex: t.tex }, a); if (own) release(t);
    const b = acquire(a.w, a.h); pass("gauss", { dir: [0, step / a.h] }, { tex: a.tex }, b); release(a); t = b; own = true;
  }
  return t;
}

/* LUT textures */
const N = 33;
function makeLUT(fn, old) {
  const data = new Uint8Array(N * N * N * 4); let i = 0;
  for (let b = 0; b < N; b++) for (let g = 0; g < N; g++) for (let r = 0; r < N; r++) {
    const o = fn(r / (N - 1), g / (N - 1), b / (N - 1));
    data[i++] = o[0] * 255 + 0.5; data[i++] = o[1] * 255 + 0.5; data[i++] = o[2] * 255 + 0.5; data[i++] = 255;
  }
  return uploadLUT(data, old);
}
function uploadLUT(data, old) {
  const tex = old || gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, N, N, N, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
  return tex;
}
const layerLUTs = {}, textTexs = {};
// Looks (docs/GRADE_LOOKS_SPEC.md §4.3): one RGBA16F LUT per definition, bounded to the ones the layers use plus the
// LUT_KEEP most recently used. Built in the LUT worker when it can be prepared ahead (thumbnails), else here.
const LUT_KEEP = 24, lutCache = new Map();
function uploadLUT16(data) {
  const tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_3D, tex);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA16F, N, N, N, 0, gl.RGBA, gl.HALF_FLOAT, data);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  for (const w of [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T, gl.TEXTURE_WRAP_R]) gl.texParameteri(gl.TEXTURE_3D, w, gl.CLAMP_TO_EDGE);
  return tex;
}
function cachedLUT(key) { const e = lutCache.get(key); if (!e) return null; lutCache.delete(key); lutCache.set(key, e); return e; }
function storeLUT(key, bytes) {
  const had = cachedLUT(key); if (had) return had.tex;
  const tex = uploadLUT16(bytes); lutCache.set(key, { tex }); trimLUTs(); return tex;
}
function trimLUTs() {
  const used = new Set();
  for (const L of G.layers) if (L.type === "look") { const d = layerDef(L); if (d) used.add(defKey(d)); }
  const extra = [...lutCache.keys()].filter(k => !used.has(k));
  while (extra.length > LUT_KEEP) { const k = extra.shift(); gl.deleteTexture(lutCache.get(k).tex); lutCache.delete(k); }
}
function defLUT(def) { const key = defKey(def), e = cachedLUT(key); return e ? e.tex : storeLUT(key, buildLookLUT(def)); }
function layerLUT(L, gradeParams) {
  const key = JSON.stringify(gradeParams), e = layerLUTs[L.id];
  if (e && e.key === key) return e.tex;
  const tex = makeLUT(makeGrader(gradeParams), e && e.tex); layerLUTs[L.id] = { key, tex }; return tex;
}

/* text layer */
function fontCSS(P) { const n = P.font === "__sys" ? (P.sys || "").replace(/["\\]/g, "").trim() || "Hanken Grotesk" : P.font; return `"${n}", "Hanken Grotesk", sans-serif`; }
function textTexture(L, W, H) {
  const P = L.p, key = JSON.stringify(P) + W + "x" + H + "|" + G.fontsTick, e = textTexs[L.id + W + "x" + H];
  if (e && e.key === key) return e.tex;
  const c = mk(W, H), x = c.getContext("2d"), u = Math.min(W, H) / 1000;
  let txt = (P.text || "").trim(); if (P.upper) txt = txt.toUpperCase();
  if (txt) {
    const fs = P.size * u, ls = P.spacing / 100 * fs, hasLS = "letterSpacing" in x;
    x.font = `${P.weight} ${fs}px ${fontCSS(P)}`; if (hasLS) x.letterSpacing = ls + "px";
    x.fillStyle = P.color; x.textBaseline = "middle";
    const m = P.margin / 100 * Math.min(W, H);
    const w = x.measureText(txt).width - (hasLS ? ls : 0);
    let xx = P.hpos === "left" ? m : P.hpos === "right" ? W - m - w : (W - w) / 2;
    let yy = P.vpos === "top" ? m + fs / 2 : P.vpos === "middle" ? H / 2 : H - m - fs / 2;
    x.textAlign = "left";
    if (P.glow > 0) { x.shadowColor = P.color; x.shadowBlur = P.glow / 100 * fs * 1.2; x.fillText(txt, xx, yy); x.shadowBlur = 0; }
    x.fillText(txt, xx, yy);
  }
  const tex = (e && e.tex) || gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  textTexs[L.id + W + "x" + H] = { key, tex, id: L.id, w: W, h: H }; return tex;
}

/* effect passes: every function returns a new target and releases `cur` */
function applyFx(type, P, a, cur, W, H) {
  const u = Math.min(W, H) / 1000, px = v => v * u;
  const out = () => acquire(W, H);
  const done = (o) => { release(cur); return o; };
  switch (type) {
    case "bloom": case "halation": {
      const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2), th = acquire(hw, hh);
      pass("threshold", { thr: P.threshold, knee: type === "bloom" ? 0.2 : 0.12 }, { tex: cur.tex }, th);
      const r = px(P.radius) / 2;
      const b1 = blurTex(th, type === "bloom" ? r * 0.45 : r), b2 = type === "bloom" ? blurTex(th, r * 2.2) : null;
      release(th);
      const o = out();
      pass("combine", { w1: type === "bloom" ? 0.6 : 1, w2: type === "bloom" ? 0.8 : 0, tint: hexRGB(P.tint), amt: P.intensity * a, mode: type === "bloom" ? 1 : 0 }, { tex: cur.tex, fx: b1.tex, fx2: (b2 || b1).tex }, o);
      release(b1); release(b2); return done(o);
    }
    case "glow": { const b = blurTex(cur, px(P.radius)), o = out(); pass("glow", { amt: P.strength * a }, { tex: cur.tex, fx: b.tex }, o); release(b); return done(o); }
    case "glints": {
      const hw = Math.ceil(W / 2), hh = Math.ceil(H / 2), th = acquire(hw, hh);
      pass("threshold", { thr: P.threshold, knee: 0.06 }, { tex: cur.tex }, th);
      const L = px(P.length), s1 = acquire(hw, hh), s2 = acquire(hw, hh);
      pass("streak", { dir: [L / W, 0] }, { tex: th.tex }, s1); pass("streak", { dir: [0, L / H] }, { tex: th.tex }, s2); release(th);
      const o = out(); pass("combine", { w1: 1, w2: 1, tint: hexRGB(P.tint), amt: P.strength * a, mode: 0 }, { tex: cur.tex, fx: s1.tex, fx2: s2.tex }, o);
      release(s1); release(s2); return done(o);
    }
    case "leak": { const o = out(); pass("leak", { col: hexRGB(P.color), ang: P.angle * Math.PI / 180, size: P.size, amt: P.strength * a, aspect: W / H }, { tex: cur.tex }, o); return done(o); }
    case "vignette": { const o = out(); pass("vignette", { size: P.size, soft: P.soft, amt: P.strength * a, aspect: W / H }, { tex: cur.tex }, o); return done(o); }
    case "grain": { const o = out(); pass("grain", { res: [W, H], size: Math.max(0.5, px(P.size)), amt: P.strength * a * 0.45, colored: !!P.colored, shadows: P.shadows || 0 }, { tex: cur.tex }, o); return done(o); }
    case "dust": { const o = out(); pass("dust", { res: [W, H], u, dens: P.density, scr: P.scratches, amt: a }, { tex: cur.tex }, o); return done(o); }
    case "halftone": { const o = out(); pass("halftone", { res: [W, H], cell: Math.max(2, px(P.size)), ang: P.angle * Math.PI / 180, amt: a, mono: !!P.mono }, { tex: cur.tex }, o); return done(o); }
    case "pixelate": { const o = out(); pass("pixelate", { res: [W, H], cell: Math.max(1, px(P.size)), amt: a }, { tex: cur.tex }, o); return done(o); }
    case "scanlines": { const o = out(); pass("scan", { res: [W, H], spacing: Math.max(1.5, px(P.spacing)), amt: P.strength * a }, { tex: cur.tex }, o); return done(o); }
    case "blur": { const b = blurTex(cur, px(P.radius)), o = out(); pass("mixfx", { amt: a }, { tex: cur.tex, fx: b.tex }, o); release(b); return done(o); }
    case "edgeblur": { const b = blurTex(cur, px(P.radius)), o = out(); pass("radial", { amt: a, inner: P.clear, soft: P.soft }, { tex: cur.tex, fx: b.tex }, o); release(b); return done(o); }
    case "motion": {
      const L = px(P.length), an = P.angle * Math.PI / 180, dir = [Math.cos(an) * L / W, Math.sin(an) * L / H];
      const p1 = acquire(W, H); pass("dirblur", { dir }, { tex: cur.tex }, p1);
      const p2 = acquire(W, H); pass("dirblur", { dir: [dir[0] * 0.45, dir[1] * 0.45] }, { tex: p1.tex }, p2); release(p1);
      const o = out(); pass("mixfx", { amt: a }, { tex: cur.tex, fx: p2.tex }, o); release(p2); return done(o);
    }
    case "ghost": { const o = out(); pass("ghost", { off: [P.dx / 100, -P.dy / 100], amt: P.opacity * a }, { tex: cur.tex }, o); return done(o); }
    case "chroma": { const o = out(); pass("chroma", { k: px(P.amount) / (Math.min(W, H) * 0.5), amt: a }, { tex: cur.tex }, o); return done(o); }
    case "rgbshift": { const o = out(); pass("rgbshift", { off: [px(P.amount) / W, 0], amt: a }, { tex: cur.tex }, o); return done(o); }
    case "sharpen": { const o = out(); pass("sharpen", { px: [Math.max(1, px(P.radius)) / W, Math.max(1, px(P.radius)) / H], amt: P.strength * a }, { tex: cur.tex }, o); return done(o); }
  }
  return cur;
}
function lutPass(cur, lut, a, W, H) { const o = acquire(W, H); pass("lut", { amt: a }, { tex: cur.tex, lut: { tex: lut, is3d: true } }, o); release(cur); return o; }
function applyLayer(L, cur, W, H) {
  const a = L.amt / 100;
  if (L.type === "look") {
    const def = layerDef(L);
    if (!def) return cur;
    // the whole look (colour + finish) at full strength, then one mix with what came in (§4.2)
    const lut = { tex: defLUT(def), is3d: true }, u = lookUniforms(L.adj), fin = finishOf(def, L.adj);
    if (!fin.length) { const o = acquire(W, H); pass("look", { ...u, amt: a }, { tex: cur.tex, lut }, o); release(cur); return o; }
    let x = acquire(W, H); pass("look", { ...u, amt: 1 }, { tex: cur.tex, lut }, x);
    for (const [t, prm] of fin) x = applyFx(t, prm, 1, x, W, H);
    if (a >= 1) { release(cur); return x; }
    const o = acquire(W, H); pass("mixfx", { amt: a }, { tex: cur.tex, fx: x.tex }, o); release(x); release(cur); return o;
  }
  if (L.type === "adjust") return lutPass(cur, layerLUT(L, adjustToGrade(L.p)), a, W, H);
  if (L.type === "gmap") return lutPass(cur, layerLUT(L, gmapToGrade(L.p)), a, W, H);
  if (L.type === "fx") return applyFx(L.fx, L.p, a, cur, W, H);
  if (L.type === "text") { const t = textTexture(L, W, H), o = acquire(W, H); pass("over", { amt: a }, { tex: cur.tex, fx: t }, o); release(cur); return o; }
  return cur;
}
// crop: the uniforms of CROPFN (view section cropRect); mask: the Cutout texture, or null
function renderStack(stack, W, H, crop, target, mask = null) {
  let cur = acquire(W, H);
  pass("crop", crop, { tex: G.srcTex }, cur);
  for (const L of stack) if (L.on && L.amt > 0) cur = applyLayer(L, cur, W, H);
  pass("out", { res: [W, H], ...crop, useMask: !!mask }, mask ? { tex: cur.tex, mask } : { tex: cur.tex }, target);
  release(cur);
}

/* =================== source image =================== */
function uploadSource(el, w, h) {
  G.lastSrc = { el, w, h };
  let W = w, H = h, srcEl = el;
  if (Math.max(w, h) > MAXTEX) { const s = MAXTEX / Math.max(w, h); W = Math.round(w * s); H = Math.round(h * s); const c = mk(W, H); c.getContext("2d").drawImage(el, 0, 0, W, H); srcEl = c; }
  if (!G.srcTex) G.srcTex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, G.srcTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, srcEl);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  srcW = W; srcH = H;
}
// The Cutout mask (an alpha canvas the size of the original) as a texture, or none (null)
function uploadMask(el) {
  if (G.maskTex) { gl.deleteTexture(G.maskTex); G.maskTex = null; }
  if (!el) return;
  const w = el.naturalWidth || el.width, h = el.naturalHeight || el.height, s = Math.min(1, MAXTEX / Math.max(w, h));
  let m = el; if (s < 1) { m = mk(w * s, h * s); m.getContext("2d").drawImage(el, 0, 0, m.width, m.height); }
  G.maskTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, G.maskTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, m);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

/* ===== view ===== */
// History (undo/redo) and the preview

/* =================== state, history, preview =================== */
function stateJSON() { return JSON.stringify({ layers: G.layers, crop: G.crop }); }
function commit() {
  const s = stateJSON(); if (G.hist[G.hi] === s) return;
  G.hist = G.hist.slice(0, G.hi + 1); G.hist.push(s); if (G.hist.length > 120) G.hist.shift(); G.hi = G.hist.length - 1;
  updateHistButtons(); up.schedulePersist();
}
// A new picture brings its own crop: the current history step takes it, so undo does not bring back another's
function rebase() { if (G.hi >= 0) G.hist[G.hi] = stateJSON(); up.schedulePersist(); }
function restore(s) { const d = JSON.parse(s); G.layers = d.layers; G.crop = d.crop; up.syncCropUI(); up.renderLayers(); fitPreview(); up.schedulePersist(); }
function undo() { if (G.hi > 0) { G.hi--; restore(G.hist[G.hi]); updateHistButtons(); } }
function redo() { if (G.hi < G.hist.length - 1) { G.hi++; restore(G.hist[G.hi]); updateHistButtons(); } }
function updateHistButtons() { $("#undoBtn").disabled = G.hi <= 0; $("#redoBtn").disabled = G.hi >= G.hist.length - 1; }

// Format (the select's value) → the ratio the Crop dialog takes; "orig" leaves the crop free
const FORMAT = { orig: "free", "1": "1:1", "0.8": "4:5", "0.5625": "9:16", "1.7778": "16:9" };
// The crop in use: its parameters on the original (the format's centred crop until one is chosen)
function cropParams() {
  const p = G.crop.p;
  return p && IMG.validCrop(p) ? p : IMG.centered(srcW, srcH, FORMAT[G.crop.aspect] || "free");
}
// Size in source pixels and the shader's uniforms of a crop (default: the one in use)
function cropRect(p = cropParams()) {
  const [w, h] = IMG.outSize(p, srcW, srcH);
  return { w, h, uni: { cropC: [p.cx, p.cy], cropS: [p.w, p.h], cropA: p.a * Math.PI / 180, cropR: srcW / srcH } };
}
function fitPreview() {
  if (!gl || !G.srcTex) return;
  const r = cropRect(), stage = $("#stage");
  stage.style.setProperty("--ar", `${r.w}/${r.h}`); stage.style.setProperty("--arn", String(r.w / r.h));
  const rect = stage.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  let pw = Math.round(Math.min(rect.width * dpr, 1700)), ph = Math.round(pw * r.h / r.w);
  if (ph > 1700) { ph = 1700; pw = Math.round(ph * r.w / r.h); }
  if (pw < 2) { pw = 800; ph = Math.round(800 * r.h / r.w); }
  if (canvas.width !== pw || canvas.height !== ph) {
    canvas.width = pw; canvas.height = ph;
    // Old preview sizes are reconstructible; retain only matching idle targets.
    // acquire/release keeps any in-flight thumbnail/export target protected.
    purge(t => t.w === pw && t.h === ph);
  }
  requestRender();
}
let rq = 0, renderWaiting = false;
function requestRender() {
  if(window.__ui.away){if(!renderWaiting){renderWaiting=true;window.__ui.whenBack(()=>{renderWaiting=false;requestRender();});}return;}
  if(!rq)rq=requestAnimationFrame(()=>{rq=0;if(window.__ui.away)requestRender();else draw();});
}
function draw() {
  if (!gl || !G.srcTex) return;
  const r = cropRect();
  const d = G.activeDraft ? [up.draftLayer(G.activeDraft)] : [], pv = up.previewLayer ? up.previewLayer() : null;
  renderStack(G.showOrig ? [] : ordered(pv ? G.layers.concat(pv) : G.layers).concat(d), canvas.width, canvas.height, r.uni, null, G.cut && !G.showOrig ? G.maskTex : null);
  cleanupCaches();
  if (!G.showOrig) up.scheduleThumbs();
}
const isLook = l => l.type === "look";
function ordered(list) { return list.filter(isLook).concat(list.filter(l => !isLook(l))); }
function cleanupCaches() {
  const ids = new Set(G.layers.map(l => l.id));
  if (G.activeDraft) ids.add(up.draftLayer(G.activeDraft).id);
  const pv = up.previewLayer ? up.previewLayer() : null; if (pv) ids.add(pv.id);
  for (const id in layerLUTs) if (!ids.has(id)) { gl.deleteTexture(layerLUTs[id].tex); delete layerLUTs[id]; }
  for (const k in textTexs) {
    const e = textTexs[k], size = (e.w === canvas.width && e.h === canvas.height) || (e.w === 160 && e.h === 160);
    if (!ids.has(e.id) || !size) { gl.deleteTexture(e.tex); delete textTexs[k]; }
  }
}
new ResizeObserver(() => fitPreview()).observe($("#stage").parentElement);

// Native fullscreen keeps only the inspection canvas and its overlays in place.
const viewer = $("#bezel");
const originalHome = document.createComment("Original toolbar position");
$("#origBtn").before(originalHome);
const fullscreenHome = document.createComment("Fullscreen toolbar position");
$("#fsBtn").before(fullscreenHome);
$("#fsBtn").addEventListener("click", async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await viewer.requestFullscreen(); }
  catch (e) { setStatus(t("grade.noFullscreen"), "warn"); }
});
document.addEventListener("fullscreenchange", () => {
  const full = document.fullscreenElement === viewer, button = $("#fsBtn"), key = full ? "grade.restore" : "grade.maximize";
  // Move the same controls, preserving their handlers and exact toolbar positions.
  if (full) $("#fullscreenControls").append($("#origBtn"), button);
  else { originalHome.after($("#origBtn")); fullscreenHome.after(button); }
  button.dataset.icon = full ? "minimize-2" : "maximize";
  button.innerHTML = window.icon(button.dataset.icon);
  button.setAttribute("aria-pressed", String(full));
  button.setAttribute("aria-label", t(key)); button.title = t(key);
  button.dataset.i18nTitle = button.dataset.i18nAriaLabel = key;
  // Fit after the native fullscreen layout has settled, without changing Grade's state.
  requestAnimationFrame(() => requestAnimationFrame(() => fitPreview()));
});

Object.assign(up, { fitPreview, rebase });

/* ===== source ===== */
// Loading the image

function updateReady() {
  const has = !!G.srcTex;
  if (!has && $("#emptyStage").hidden) M.enter($("#emptyStage"));   // appears; it goes at once, so the image shows at once
  $("#emptyStage").hidden = has;
  M.reveal($("#thumb"), has, { scale: 0.96 });
  for (const id of ["exportBtn", "sendBtn", "origBtn", "cropBtn", "cutBtn"]) $("#" + id).disabled = !has || G.batchRunning;
}
function loadImageEl(src) { return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; }); }
let sourceURL = null;
async function useFile(file) {
  if (!/^image\//.test(file.type) && !/\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(file.name)) { setStatus(t("grade.st.notImage"), "bad"); return; }
  let url = null;
  try {
    url = URL.createObjectURL(file); const el = await loadImageEl(url);

    // a fixed format the picture does not have: the Crop dialog first; cancelled, the picture is not placed
    const ratio = FORMAT[G.crop.aspect] || "free";
    let p = IMG.centered(el.naturalWidth, el.naturalHeight, ratio);
    if (ratio !== "free" && HAL) {
      const r = await HAL.fitCrop(el, ratio, { name: file.name });
      if (!r) { setStatus(t("grade.st.notPlaced"), "warn"); return; }
      p = r.params;
    }
    uploadSource(el, el.naturalWidth, el.naturalHeight); uploadMask(null);
    G.img = { name: file.name, w: srcW, h: srcH }; G.srcBlob = file; G.cut = null; G.crop.p = p;
    $("#thumb").src = url; $("#imgName").textContent = `${file.name} · ${el.naturalWidth}×${el.naturalHeight}`;
    if (sourceURL) URL.revokeObjectURL(sourceURL); sourceURL = url; url = null;
    updateReady(); up.syncCropUI();
    up.fitPreview(); up.queueThumbs(); up.rebase();
    setStatus(t("grade.st.imageLoaded", { name: file.name }), "ok");
    if (HAL) HAL.recent(file, "grade", "image");
  } catch (e) { setStatus(t("common.badImage"), "bad"); }
  finally { if (url) URL.revokeObjectURL(url); }
}

/* ===== layersui ===== */
// Layers panel: rows, reorder, menu, selection and fonts

/* =================== G.layers UI =================== */
function layerName(L) {
  if (L.type === "look") {
    const def = layerDef(L), base = LOOK2[L.id0];
    if (!def) return [t("grade.kind.filter"), ""];
    if (L.def) return [L.mine || (base ? look2Name(L.id0) : t("grade.kind.filter")), base ? t("grade.kind.basedOn", { name: look2Name(L.id0) }) : t("grade.kind.mine")];
    return [look2Name(L.id0), t("grade.kind.lookOf", { cat: cat2Name(def.cat) })];
  }
  if (L.type === "adjust") return [t("grade.tool.adjust"), t("grade.kind.adjust")];
  if (L.type === "gmap") return [t("grade.tool.gmap"), t("grade.kind.color")];
  if (L.type === "text") return [L.p.text ? t("grade.textLayer", { text: L.p.text }) : t("grade.tool.text"), t("grade.tool.text")];
  return [FX[L.fx].name, t("grade.kind.effectOf", { group: groupName(FX[L.fx].group) })];
}
function schemaOf(L) { return L.type === "adjust" ? ADJ : L.type === "gmap" ? GMAP : L.type === "text" ? TEXT : L.type === "fx" ? FX[L.fx].params : L.type === "look" && layerDef(L) ? ADJ2 : []; }
// The values a layer's controls edit: a look's adjustments, any other layer's parameters
const valuesOf = L => L.type === "look" ? (L.adj || (L.adj = {})) : L.p;
function fmt(p, v) { const st = p.step || 1, d = st < 1 ? (st < 0.1 ? 2 : 1) : 0; return Number(v).toFixed(d) + (p.unit ? " " + p.unit : ""); }
function ctrlHTML(L, p) {
  const P = valuesOf(L), v = p.k in P ? P[p.k] : p.def, id = `p-${L.id}-${p.k}`;
  if (p.showIf && !p.showIf(P)) return "";
  if (p.type === "toggle") return `<label class="tog" for="${id}"><span>${p.label}</span><input type="checkbox" id="${id}" data-k="${p.k}" ${v ? "checked" : ""}></label>`;
  if (p.type === "color") return `<div class="f"><div class="fl"><label for="${id}">${p.label}</label></div><div class="colorrow"><input type="color" id="${id}" data-k="${p.k}" value="${esc(v)}"><code>${esc(String(v).toUpperCase())}</code></div></div>`;
  if (p.type === "text") return `<div class="f"><div class="fl"><label for="${id}">${p.label}</label></div><input type="text" id="${id}" data-k="${p.k}" value="${esc(v)}" maxlength="60"></div>`;
  if (p.font) return `<div class="f"><div class="fl"><label for="${id}">${p.label}</label></div><select id="${id}" data-k="${p.k}" data-font="1" data-sample-from="[data-k=text]" data-sample-scope=".layer,.tool-body">${fontOptionsHTML(v)}</select></div>`;
  if (p.type === "select") return `<div class="f"><div class="fl"><label for="${id}">${p.label}</label></div><select id="${id}" data-k="${p.k}">${p.options.map(([ov, ol]) => `<option value="${esc(ov)}" ${ov === v ? "selected" : ""}>${esc(ol)}</option>`).join("")}</select></div>`;
  const pct = ((v - p.min) / (p.max - p.min) * 100).toFixed(1);
  return `<div class="f"><div class="fl"><label for="${id}">${p.label}</label><output>${fmt(p, v)}</output></div><input type="range" id="${id}" data-k="${p.k}" data-def="${p.def}" min="${p.min}" max="${p.max}" step="${p.step}" value="${v}" style="--p:${pct}%" title="${esc(t("common.dblReset"))}"></div>`;
}
/* fonts: incluidas, subidas por mí (Recursos\Fuentes) y las del PC */
let uploadedFonts = [];
const loadedUploads = new Set();
function fontOptionsHTML(v) {
  const opt = (val, label) => `<option value="${esc(val)}"${val === v ? " selected" : ""}>${esc(label)}</option>`;
  const all = new Set([...BUILTIN_FONTS, ...uploadedFonts.map(f => f.family), ...G.systemFonts]);
  let h = `<optgroup label="${esc(t("fonts.builtin"))}">${BUILTIN_FONTS.map(f => opt(f, f)).join("")}</optgroup>`;
  if (uploadedFonts.length) h += `<optgroup label="${esc(t("fonts.uploaded"))}">${uploadedFonts.map(f => opt(f.family, f.family)).join("")}</optgroup>`;
  if (G.systemFonts.length) h += `<optgroup label="${esc(t("fonts.system"))}">${G.systemFonts.map(f => opt(f, f)).join("")}</optgroup>`;
  if (v && v !== "__sys" && !all.has(v)) h += `<optgroup label="${esc(t("fonts.current"))}">${opt(v, t("fonts.notOnPc", { name: v }))}</optgroup>`;
  return h + `<optgroup label="${esc(t("fonts.other"))}">${opt("__sys", t("fonts.typeName"))}</optgroup>`;
}
function refreshTextFontUI() {
  renderLayers();
  document.querySelectorAll('.tool[open][data-key="text"] .tool-body').forEach(b => { b.innerHTML = up.toolBodyHTML("text"); });
}
async function loadUploadedFonts() {
  if (!HAL) return;
  const list = await HAL.fonts.uploaded().catch(() => []), ok = [];
  for (const f of list) {
    const key = f.id + "|" + f.family;
    if (!loadedUploads.has(key)) {
      try {
        const r = await window.__halBlob(f.id); if (!r.ok) continue;
        const face = new FontFace(f.family, await r.arrayBuffer()); await face.load(); document.fonts.add(face);
        loadedUploads.add(key);
      } catch (e) { continue; }
    }
    ok.push(f);
  }
  uploadedFonts = ok; G.fontsTick++; refreshTextFontUI(); requestRender(); up.queueThumbs();
}
const ICON = { eye: icon("eye"), eyeoff: icon("eye-off"), more: icon("ellipsis") };
const GRIP = '<svg viewBox="0 0 10 16" aria-hidden="true"><circle cx="2.5" cy="3" r="1.4"/><circle cx="7.5" cy="3" r="1.4"/><circle cx="2.5" cy="8" r="1.4"/><circle cx="7.5" cy="8" r="1.4"/><circle cx="2.5" cy="13" r="1.4"/><circle cx="7.5" cy="13" r="1.4"/></svg>';
// Layers panel: two tabs (filters, effects). Rows show the top layer first (the one applied last).
let ltab = "F", openId = null, anchorId = null, shownOpen = null;
const selected = new Set();
const inTab = (L, tb = ltab) => (tb === "F") === isLook(L);
const tabList = (tb = ltab) => G.layers.filter(L => inTab(L, tb));
function renderLayers() {
  for (const id of [...selected]) if (!G.layers.some(L => L.id === id && inTab(L))) selected.delete(id);
  const nF = G.layers.filter(isLook).length, nE = G.layers.length - nF;
  $("#cntF").textContent = nF ? `(${nF})` : ""; $("#cntE").textContent = nE ? `(${nE})` : "";
  document.querySelectorAll(".ltab[data-ltab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.ltab === ltab)));
  const turned = $("#list" + ltab).hidden;
  $("#listF").hidden = ltab !== "F"; $("#listE").hidden = ltab !== "E";
  if (turned) M.enter($("#list" + ltab));
  for (const [tb, sel, empty] of [["F", "#listF", "grade.noFilters"], ["E", "#listE", "grade.noEffects"]]) {
    const list = tabList(tb), box = $(sel);
    // rows keep their place on screen and slide to the new one; new rows scale in, removed ones fade out
    M.list(box, () => { box.innerHTML = list.length ? list.slice().reverse().map(layerHTML).join("") : `<p class="empty">${esc(t(empty))}</p>`; }, { sel: ":scope > .layer", key: el => el.dataset.id });
  }
  if (openId && openId !== shownOpen) { const p = document.querySelector(`.layer[data-id="${openId}"] .lparams`); if (p) M.fadeIn(p, { y: -4, dur: "spring" }); }
  shownOpen = openId;
  const n = tabList().length;
  $("#layerCount").textContent = n ? t(n === 1 ? "grade.layerCountOne" : "grade.layerCount", { n }) : "";
  $("#clearBtn").disabled = !n;
  $("#selAllL").disabled = n < 2;
  $("#selAllL2").hidden = selected.size >= n;
  // the selection bar takes the place of the layer tools: the old one goes at once, the new one fades in
  if ($("#selbar").hidden === !!selected.size) M.enter(selected.size ? $("#selbar") : $("#ltools"));
  $("#selbar").hidden = !selected.size; $("#ltools").hidden = !!selected.size;
  $("#selCount").textContent = t("grade.sel.count", { n: selected.size });
  up.renderGridBadges();
}
function layerHTML(L) {
  const [nm, kind] = layerName(L), sch = schemaOf(L), open = openId === L.id;
  const hide = t(L.on ? "grade.l.hide" : "grade.l.show");
  return `<div class="layer${L.on ? "" : " off"}${selected.has(L.id) ? " sel" : ""}" data-id="${L.id}" role="listitem">
    <div class="lrow" data-act="row" aria-expanded="${open}">
      <button class="grip" data-act="grip" aria-label="${esc(t("grade.l.drag"))}" title="${esc(t("grade.l.drag"))}">${GRIP}</button>
      <button class="ib ${L.on ? "on" : ""}" data-act="eye" aria-label="${esc(hide)}" title="${esc(hide)}">${L.on ? ICON.eye : ICON.eyeoff}</button>
      <span class="lname" title="${esc(nm + " · " + kind)}">${esc(nm)}</span>${L.type === "look" && hasAdj(L.adj) ? `<span class="adot" title="${esc(t("grade.adjusted"))}"></span>` : ""}
      <span class="lamt"><input type="range" min="0" max="100" step="1" value="${L.amt}" data-def="100" data-act="amt" aria-label="${esc(t("grade.l.amount"))}" style="--p:${L.amt}%"><output data-act="pct" title="${esc(t("grade.l.dragPct"))}">${L.amt} %</output></span>
      <button class="ib" data-act="more" aria-haspopup="menu" aria-label="${esc(t("grade.l.more"))}" title="${esc(t("grade.l.more"))}">${ICON.more}</button>
    </div>
    ${open ? `<div class="lparams"><p class="lkind">${esc(kind)}</p>${sch.map(p => ctrlHTML(L, p)).join("")}${sch === ADJ2 ? lookActsHTML(L) : ""}</div>` : ""}
  </div>`;
}
// Under an applied look's adjustments: reset them, or save the look as it is now as a personal look (§2.2)
function lookActsHTML(L) {
  return `<div class="btnrow"><button class="btn sm" data-act="adjreset" ${hasAdj(L.adj) ? "" : "disabled"}>${esc(t("grade.resetAdj"))}</button></div>
    <div class="mlsave"><input type="text" data-act="mlname" maxlength="60" value="${esc(L.mine || "")}" placeholder="${esc(t("grade.myLookName"))}" aria-label="${esc(t("grade.myLookName"))}"><button class="btn sm primary" data-act="mlsave">${esc(t("grade.saveMyLook"))}</button></div>`;
}
function saveMyLook(L, name, input, btn) {
  name = (name || "").trim();
  const def = layerDef(L);
  if (!def) return;
  const clash = Object.keys(G.looks).find(n => n.toLowerCase() === name.toLowerCase());
  const err = !name ? t("lib.err.empty") : stem(name) !== name ? t("lib.err.chars") : clash && !isPersonal(G.looks[clash]) ? t("lib.err.taken") : "";
  if (err) { setStatus(err, "warn"); input.focus(); return; }
  // replacing a personal look asks once (the button turns into a confirmation for 3 s)
  if (clash && !btn.dataset.armed) {
    btn.dataset.armed = "1"; btn.textContent = t("grade.replaceMyLook"); btn.classList.add("warn");
    setTimeout(() => { if (btn.isConnected) { delete btn.dataset.armed; btn.textContent = t("grade.saveMyLook"); btn.classList.remove("warn"); } }, 3000);
    return;
  }
  if (clash && clash !== name) { delete G.looks[clash]; G.favs = G.favs.map(k => k === "u:" + clash ? "u:" + name : k); }
  const entry = { type: "look", id0: L.id0, on: true, amt: L.amt, adj: cleanAdj(L.adj), def: cleanDef(def) };
  if (L.rev || LOOK2[L.id0]) entry.rev = L.rev || LOOK2[L.id0].rev;
  G.looks[name] = [entry];
  L.mine = name; L.def = clone(entry.def);
  up.buildGrid(); renderLooks(); renderLayers(); commit(); up.schedulePersist();
  setStatus(t("grade.st.myLookSaved", { name }), "ok");
}
function findLayer(el) { const box = el.closest(".layer"); return box ? G.layers.find(l => l.id === box.dataset.id) : null; }
const layersEl = $("#layers");
function changed() { renderLayers(); requestRender(); commit(); }
// rebuild `layers` from a new top-to-bottom order of the current tab
function setTabOrder(topFirst) {
  const bottomFirst = topFirst.slice().reverse(), other = G.layers.filter(L => !inTab(L));
  G.layers = ltab === "F" ? bottomFirst.concat(other) : other.concat(bottomFirst);
}
function moveLayer(L, to) { // to: index in the top-first list of the tab
  const list = tabList().reverse(), from = list.indexOf(L);
  to = clamp(to, 0, list.length - 1); if (from < 0 || from === to) return false;
  list.splice(from, 1); list.splice(to, 0, L); setTabOrder(list); return true;
}
function duplicate(L) { const c = clone(L); c.id = rid(); delete c.open; G.layers.splice(G.layers.indexOf(L) + 1, 0, c); return c; }
layersEl.addEventListener("click", e => {
  const b = e.target.closest("[data-act]"); if (!b || b.tagName === "INPUT" || b.tagName === "OUTPUT") return;
  const L = findLayer(b); if (!L) return;
  const act = b.dataset.act;
  if (act === "adjreset") { L.adj = {}; changed(); return; }
  if (act === "mlsave") { const box = b.closest(".mlsave"), input = box.querySelector("input"); saveMyLook(L, input.value, input, b); return; }
  if (act === "mlname") return;
  if (act === "eye") { L.on = !L.on; changed(); return; }
  if (act === "more") { openMenu(L, b); return; }
  if (act === "grip") return;
  if (act !== "row" || e.target.closest(".lamt")) return;
  // Ctrl/⌘ toggles one, Shift selects a range; a plain click opens the settings (one at a time)
  if (e.ctrlKey || e.metaKey) { selected.has(L.id) ? selected.delete(L.id) : selected.add(L.id); anchorId = L.id; renderLayers(); return; }
  if (e.shiftKey) {
    const list = tabList().reverse(), a = list.findIndex(x => x.id === anchorId), z = list.indexOf(L);
    if (a < 0) selected.add(L.id); else for (let k = Math.min(a, z); k <= Math.max(a, z); k++) selected.add(list[k].id);
    renderLayers(); return;
  }
  selected.clear(); anchorId = L.id;
  openId = openId === L.id ? null : L.id;
  renderLayers();
});
// A look's row shows a dot while it has adjustments; its Reset follows
function markAdjusted(L, row) {
  if (!row) return;
  const on = hasAdj(L.adj), dot = row.querySelector(".adot"), reset = row.querySelector("[data-act=adjreset]");
  if (on && !dot) row.querySelector(".lname").insertAdjacentHTML("afterend", `<span class="adot" title="${esc(t("grade.adjusted"))}"></span>`);
  if (!on && dot) dot.remove();
  if (reset) reset.disabled = !on;
}
// Enter in a look's name field saves it as a personal look
layersEl.addEventListener("keydown", e => {
  if (e.key !== "Enter" || e.target.dataset.act !== "mlname") return;
  e.preventDefault(); e.target.closest(".mlsave").querySelector("[data-act=mlsave]").click();
});
// reorder with the grip: drag, or arrow keys when it has focus
layersEl.addEventListener("keydown", e => {
  const g = e.target.closest("[data-act=grip]"); if (!g || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
  e.preventDefault();
  const L = findLayer(g), list = tabList().reverse();
  if (moveLayer(L, list.indexOf(L) + (e.key === "ArrowUp" ? -1 : 1))) { changed(); layersEl.querySelector(`.layer[data-id="${L.id}"] .grip`).focus(); }
});
layersEl.addEventListener("pointerdown", e => {
  const g = e.target.closest("[data-act=grip]");
  if (g) { dragRow(e, g); return; }
  const o = e.target.closest("[data-act=pct]");
  if (o) dragPct(e, o);
});
function dragRow(e, g) {
  const L = findLayer(g), row = g.closest(".layer"), list = row.parentElement;
  // listen on the document: moving the row in the DOM would drop a pointer capture
  e.preventDefault();
  const y0 = e.clientY; let moved = false;
  row.classList.add("dragging");
  const move = ev => {
    moved = true;
    row.style.transform = `translateY(${ev.clientY - y0}px)`;
    const rows = [...list.children].filter(r => r !== row);
    const before = rows.find(r => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
    // keep the dragged row under the pointer while the others shift
    const top0 = row.getBoundingClientRect().top;
    const others = rows;
    if (before) { if (row.nextElementSibling !== before) M.flip(others, () => list.insertBefore(row, before), { dur: "spring" }); }
    else if (list.lastElementChild !== row) M.flip(others, () => list.appendChild(row), { dur: "spring" });
    const shift = row.getBoundingClientRect().top - top0;
    if (shift) { const m = /-?[\d.]+/.exec(row.style.transform); row.style.transform = `translateY(${(m ? +m[0] : 0) - shift}px)`; }
  };
  const up = () => {
    document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up);
    const dropped = row.getBoundingClientRect();
    row.classList.remove("dragging"); row.style.transform = "";
    if (!moved) return;
    const land = () => { const n = layersEl.querySelector(`.layer[data-id="${L.id}"]`); if (n) { const r = n.getBoundingClientRect(); M.animate(n, [{ transform: `translateY(${dropped.top - r.top}px)` }, { transform: "none" }], { dur: "spring", channel: "move" }); } };
    requestAnimationFrame(land);
    const ids = [...list.querySelectorAll(".layer")].map(r => r.dataset.id);
    const order = ids.map(id => G.layers.find(x => x.id === id));
    if (order.map(x => x.id).join() !== tabList().reverse().map(x => x.id).join()) { setTabOrder(order); changed(); } else renderLayers();
    void L;
  };
  document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
}
// dragging sideways on the percentage changes the intensity
function dragPct(e, o) {
  const L = findLayer(o), x0 = e.clientX, v0 = L.amt, input = o.previousElementSibling;
  e.preventDefault(); o.setPointerCapture(e.pointerId);
  const move = ev => {
    L.amt = clamp(Math.round(v0 + (ev.clientX - x0) / 2), 0, 100);
    input.value = L.amt; input.style.setProperty("--p", L.amt + "%"); o.textContent = L.amt + " %"; requestRender();
  };
  const up = () => { o.removeEventListener("pointermove", move); o.removeEventListener("pointerup", up); o.removeEventListener("pointercancel", up); if (L.amt !== v0) commit(); };
  o.addEventListener("pointermove", move); o.addEventListener("pointerup", up); o.addEventListener("pointercancel", up);
}
/* ⋯ menu */
let menuFor = null;
function openMenu(L, b) {
  const m = $("#lmenu"), r = b.getBoundingClientRect();
  menuFor = L; m.hidden = false;
  m.style.position = "fixed"; m.style.top = Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8) + "px"; m.style.left = Math.max(8, r.right - m.offsetWidth) + "px"; m.style.right = "auto";
  M.pop(m, b);
  m.querySelector("button").focus();
}
function closeMenu() { if (!$("#lmenu").hidden) M.closePopover($("#lmenu")); menuFor = null; }
$("#lmenu").addEventListener("click", e => {
  const b = e.target.closest("[data-m]"); if (!b || !menuFor) return;
  const L = menuFor; closeMenu();
  if (b.dataset.m === "dup") duplicate(L);
  else if (b.dataset.m === "top") moveLayer(L, 0);
  else if (b.dataset.m === "bottom") moveLayer(L, tabList().length - 1);
  else { G.layers.splice(G.layers.indexOf(L), 1); if (openId === L.id) openId = null; }
  changed();
});
document.addEventListener("mousedown", e => { if (!e.target.closest("#lmenu") && !e.target.closest("[data-act=more]")) closeMenu(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") { closeMenu(); if (selected.size) { selected.clear(); renderLayers(); } } });
/* several selected */
function selectedLayers() { return G.layers.filter(L => selected.has(L.id)); }
$("#selHide").addEventListener("click", () => { selectedLayers().forEach(L => { L.on = false; }); changed(); });
$("#selShow").addEventListener("click", () => { selectedLayers().forEach(L => { L.on = true; }); changed(); });
$("#selDel").addEventListener("click", () => { G.layers = G.layers.filter(L => !selected.has(L.id)); selected.clear(); changed(); });
$("#selNone").addEventListener("click", () => { selected.clear(); renderLayers(); });
// Select all: every layer of the list shown (the Layers / Text tab); also Ctrl+A over the layer list
function selectAllLayers() { tabList().forEach(L => selected.add(L.id)); renderLayers(); }
$("#selAllL").addEventListener("click", selectAllLayers);
$("#selAllL2").addEventListener("click", selectAllLayers);
// the layer list is "where you are" after a click in it, until a click elsewhere; typing in a field keeps its own Ctrl+A
let inLayers = false;
document.addEventListener("pointerdown", e => { inLayers = !!(e.target.closest && e.target.closest("#layers, #selbar, #ltools")); }, true);
document.addEventListener("keydown", e => {
  if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey || e.key.toLowerCase() !== "a") return;
  const field = e.target.closest && e.target.closest("input, textarea, select, [contenteditable]");
  if (field || !(inLayers || (e.target.closest && e.target.closest("#layers, #selbar, #ltools")))) return;
  e.preventDefault(); selectAllLayers();
});
document.querySelectorAll(".ltab[data-ltab]").forEach(b => b.addEventListener("click", () => { ltab = b.dataset.ltab; selected.clear(); renderLayers(); }));
function readCtrl(el, L) {
  const k = el.dataset.k, p = schemaOf(L).find(s => s.k === k);
  if (!p) return;
  let v = el.type === "checkbox" ? el.checked : el.type === "range" ? parseFloat(el.value) : el.value;
  valuesOf(L)[k] = v;
  if (el.type === "range") { el.style.setProperty("--p", ((v - p.min) / (p.max - p.min) * 100) + "%"); el.previousElementSibling.querySelector("output").textContent = fmt(p, v); }
  if (el.type === "color") el.nextElementSibling.textContent = String(v).toUpperCase();
  return p;
}
layersEl.addEventListener("input", e => {
  const el = e.target, L = findLayer(el); if (!L) return;
  if (el.dataset.act === "amt") { L.amt = +el.value; el.style.setProperty("--p", L.amt + "%"); el.nextElementSibling.textContent = L.amt + " %"; requestRender(); return; }
  if (el.dataset.k) { readCtrl(el, L); if (L.type === "text") ensureTextFont(L.p); requestRender(); }
});
layersEl.addEventListener("change", e => {
  const el = e.target, L = findLayer(el); if (!L) return;
  if (el.dataset.k) {
    readCtrl(el, L);
    if (L.type === "look") markAdjusted(L, el.closest(".layer"));
    if (L.type === "text" && el.dataset.k === "font") renderLayers();
    if (L.type === "text" && el.dataset.k === "text") { const b = el.closest(".layer").querySelector(".lname"); b.textContent = layerName(L)[0]; }
    requestRender();
  }
  commit();
});
async function ensureTextFont(P) {
  if (P.font === "__sys") return;
  try { await document.fonts.load(`${P.weight} 40px "${P.font}"`); G.fontsTick++; requestRender(); } catch (e) {}
}
function addLayer(L) {
  L.id = rid(); L.on = true; L.amt = L.amt ?? 100; G.layers.push(L);
  ltab = isLook(L) ? "F" : "E"; selected.clear();
  changed();
  const row = layersEl.querySelector(`.layer[data-id="${L.id}"]`); if (row) row.scrollIntoView({ block: "nearest" });
}
// "Clear" empties the tab on screen (asks once)
$("#clearBtn").addEventListener("click", e => {
  const b = e.currentTarget; if (!tabList().length) return;
  const label = b.querySelector("span");
  if (!b.dataset.armed) { b.dataset.armed = "1"; label.textContent = t("common.sure"); b.classList.add("warn"); setTimeout(() => { if (b.dataset.armed) { delete b.dataset.armed; label.textContent = t("common.clear"); b.classList.remove("warn"); } }, 3000); return; }
  delete b.dataset.armed; label.textContent = t("common.clear"); b.classList.remove("warn");
  G.layers = G.layers.filter(L => !inTab(L)); openId = null; changed();
});

Object.assign(up, { renderLayers });

/* ===== library ===== */
// Filters grid, tools and my looks

/* =================== library: filters, tools, my G.looks =================== */
// Filters (docs/GRADE_LOOKS_SPEC.md §2.1): sub-tabs All / Favorites / My Looks, categories only in All. A tile's key is
// "b:<id>" (a catalogue look) or "u:<name>" (a personal look: G.looks[name] holds one look layer that carries its def).
let fsub = "all", catSel = "every";
const subQuery = { all: "", fav: "", mine: "" }, subScroll = { all: 0, fav: 0, mine: 0 };
const isPersonal = v => Array.isArray(v) && v.length === 1 && !!v[0] && v[0].type === "look" && !!v[0].def;
const personalNames = () => Object.keys(G.looks).filter(n => isPersonal(G.looks[n])).sort((a, b) => a.localeCompare(b));
const entryName = key => key.startsWith("b:") ? look2Name(key.slice(2)) : key.slice(2);
// The layer a tile applies: a catalogue look at Preview strength, a personal look as it was saved
function entryLayer(key) {
  if (key.startsWith("b:")) { const l = LOOK2[key.slice(2)]; return l ? { type: "look", id0: l.id, rev: l.rev, amt: G.thumbPct, adj: {}, on: true } : null; }
  const v = G.looks[key.slice(2)]; if (!isPersonal(v)) return null;
  const L = v[0];
  return { type: "look", id0: L.id0, rev: L.rev, amt: clamp(+L.amt || 100, 0, 100), adj: cleanAdj(L.adj), def: clone(L.def), mine: key.slice(2), on: true };
}
const layerKey = L => L.mine && isPersonal(G.looks[L.mine]) ? "u:" + L.mine : !L.def && LOOK2[L.id0] ? "b:" + L.id0 : null;
// A tile click previews its look on top of the looks already in Layers; only "Add to layers" makes it a layer (§2.1)
let previewKey = null, previewL = null;
function previewLayer() {
  if (!previewKey) return null;
  if (!previewL || previewL.key !== previewKey) { const L = entryLayer(previewKey); previewL = L ? Object.assign(L, { id: "preview-" + rid(), key: previewKey }) : null; }
  return previewL;
}
const tileEls = new Map();   // key → { el, cv, wrap, painted: the thumbnail key it shows }
const tileSeen = new Set();  // keys of tiles on screen: their thumbnails go first
const tileObs = "IntersectionObserver" in window ? new IntersectionObserver(es => { for (const e of es) { const k = e.target.dataset.key; if (e.isIntersecting) tileSeen.add(k); else tileSeen.delete(k); } }) : null;
function renderChips() {
  $("#chips").innerHTML = ["every", ...CATS2].map(c => `<button class="chip" aria-pressed="${c === catSel}" data-cat="${esc(c)}">${esc(c === "every" ? t("cat2.every") : cat2Name(c))}</button>`).join("");
}
$("#chips").addEventListener("click", e => { const b = e.target.closest("[data-cat]"); if (!b) return; catSel = b.dataset.cat; renderChips(); filterGrid(true); });
let tileSeq = 0;
function tileHTML(key) {
  const n = ++tileSeq, mine = key.startsWith("u:"), name = entryName(key), l = mine ? null : LOOK2[key.slice(2)];
  return `<div class="tile" role="button" tabindex="0" data-key="${esc(key)}"${l ? ` data-look="${l.id}" data-cat="${l.cat}"` : ""} title="${esc(name)}" aria-label="${esc(t("grade.previewLook", { name }))}" aria-pressed="false"><span class="thw" id="tw-${n}"><canvas width="160" height="160" id="th-${n}"></canvas></span><span class="tn">${esc(name)}</span><i hidden></i>
    ${mine ? `<div class="tacts"><button class="tact" data-tact="menu" aria-haspopup="menu" aria-label="${esc(t("grade.l.more"))}" title="${esc(t("grade.l.more"))}">${icon("ellipsis")}</button></div>` : ""}
    <button class="star" data-tact="fav" aria-pressed="false" aria-label="${esc(t("grade.fav", { name }))}" title="${esc(t("grade.favShort"))}">${icon("star")}</button></div>`;
}
// Every tile exists once; the sub-tab, the category and the search only hide them
function buildGrid() {
  const keys = LOOKS2.map(l => "b:" + l.id).concat(personalNames().map(n => "u:" + n)), grid = $("#grid"), want = new Set(keys);
  for (const [k, e] of tileEls) if (!want.has(k)) { tileObs?.unobserve(e.el); e.el.remove(); tileEls.delete(k); tileSeen.delete(k); }
  for (const k of keys) if (!tileEls.has(k)) {
    grid.insertAdjacentHTML("beforeend", tileHTML(k)); const el = grid.lastElementChild;
    tileEls.set(k, { el, cv: el.querySelector("canvas"), wrap: el.querySelector(".thw"), painted: "" });
    if (G.lastSrc) M.skeleton(el.querySelector(".thw"), true);
    tileObs?.observe(el);
  }
  keys.forEach((k, i) => { const el = tileEls.get(k).el; if (grid.children[i] !== el) grid.insertBefore(el, grid.children[i] || null); });
  renderFavs(); filterGrid(false); renderGridBadges();
  if (previewKey && !want.has(previewKey)) setPreview(null);
}
function matches(key, q) {
  if (!q) return true;
  const l = key.startsWith("b:") && LOOK2[key.slice(2)];
  return (entryName(key) + " " + (l ? cat2Name(l.cat) + " " + (l.tags || []).join(" ") : t("grade.sub.mine"))).toLowerCase().includes(q);
}
function shownKeys() {
  const q = subQuery[fsub].trim().toLowerCase();
  const keys = fsub === "fav" ? G.favs.filter(k => tileEls.has(k)) : fsub === "mine" ? personalNames().map(n => "u:" + n) : LOOKS2.filter(l => catSel === "every" || l.cat === catSel).map(l => "b:" + l.id);
  return keys.filter(k => matches(k, q));
}
function filterGrid(animate) {
  const show = shownKeys(), on = new Set(show), tiles = [...tileEls.values()].map(e => e.el), was = new Set(tiles.filter(x => !x.hidden));
  const mutate = () => { for (const [k, e] of tileEls) { e.el.hidden = !on.has(k); e.el.style.order = fsub === "fav" ? String(show.indexOf(k)) : ""; } };
  if (animate) { M.flip([...was], mutate); tiles.filter(x => !x.hidden && !was.has(x)).slice(0, 24).forEach((x, i) => M.scaleIn(x, { delay: i * 12 })); }
  else mutate();
  $("#chips").hidden = fsub !== "all";
  const empty = $("#gridEmpty");
  empty.hidden = show.length > 0;
  if (!show.length) empty.textContent = t(subQuery[fsub].trim() ? "grade.noResults" : fsub === "fav" ? "grade.emptyFav" : fsub === "mine" ? "grade.emptyMine" : "grade.noResults");
  const nf = G.favs.filter(k => tileEls.has(k)).length, nm = personalNames().length;
  $("#cntFav").textContent = nf ? `(${nf})` : ""; $("#cntMine").textContent = nm ? `(${nm})` : "";
  queueShown();
}
function setSub(sub) {
  if (sub === fsub) return;
  const lib = document.querySelector(".lib");
  subScroll[fsub] = lib.scrollTop; fsub = sub;
  document.querySelectorAll("[data-fsub]").forEach(x => x.setAttribute("aria-selected", String(x.dataset.fsub === sub)));
  $("#lookSearch").value = subQuery[sub];
  filterGrid(true);
  lib.scrollTop = subScroll[sub];
}
document.querySelectorAll("[data-fsub]").forEach(b => b.addEventListener("click", () => setSub(b.dataset.fsub)));
$("#lookSearch").addEventListener("input", e => { subQuery[fsub] = e.target.value; filterGrid(false); });
/* favourites: catalogue and personal looks, in the order they were marked */
function renderFavs() {
  for (const [k, e] of tileEls) { const s = e.el.querySelector(".star"), on = G.favs.includes(k); s.setAttribute("aria-pressed", String(on)); e.el.classList.toggle("fav", on); }
}
function toggleFav(key) {
  const i = G.favs.indexOf(key);
  if (i >= 0) G.favs.splice(i, 1); else G.favs.push(key);
  renderFavs(); if (fsub === "fav") filterGrid(true); else filterGrid(false);
  const s = tileEls.get(key)?.el.querySelector(".star"); if (s && i < 0) M.pop(s);
  up.schedulePersist();
}
function setPreview(key) {
  if (key && !entryLayer(key)) key = null;
  if (key === previewKey) return;
  previewKey = key; previewL = null;
  if (key && G.activeDraft) document.querySelectorAll(".tool[open]").forEach(o => { o.open = false; });   // one thing on trial at a time
  for (const [k, e] of tileEls) { const on = k === key; e.el.classList.toggle("previewing", on); e.el.setAttribute("aria-pressed", String(on)); }
  const bar = $("#lookBar");
  if (key) { $("#lookBarName").textContent = entryName(key); if (bar.hidden) M.show(bar); }
  else if (!bar.hidden) M.hide(bar);
  requestRender();
}
function applyPreview() {
  const key = previewKey, L = key && entryLayer(key); if (!L) return;
  setPreview(null); addLayer(L);
  setStatus(t("grade.st.lookAdded", { name: entryName(key), pct: L.amt }), "ok");
}
function renderGridBadges() {
  // ✓: the look is in Layers (once or more); it pops when it goes on
  const used = new Set(); for (const L of G.layers) if (L.type === "look") { const k = layerKey(L); if (k) used.add(k); }
  for (const [k, e] of tileEls) {
    const b = e.el.querySelector("i");
    if (b.hidden && used.has(k)) { b.hidden = false; M.pop(b); }
    b.hidden = !used.has(k); b.textContent = "✓";
  }
}
$("#grid").addEventListener("click", e => {
  const tile = e.target.closest("[data-key]"); if (!tile) return;
  const key = tile.dataset.key, a = e.target.closest("[data-tact]");
  if (!a) { setPreview(key); return; }
  const act = a.dataset.tact;
  if (act === "fav") toggleFav(key); else if (act === "menu") openTileMenu(key, a);
});
// a double click, or Enter on the tile already on preview, adds it
$("#grid").addEventListener("dblclick", e => { const tile = e.target.closest("[data-key]"); if (tile && !e.target.closest("[data-tact]")) { setPreview(tile.dataset.key); applyPreview(); } });
$("#grid").addEventListener("keydown", e => {
  if ((e.key === "Enter" || e.key === " ") && e.target.classList.contains("tile")) { e.preventDefault(); if (e.key === "Enter" && previewKey === e.target.dataset.key) applyPreview(); else setPreview(e.target.dataset.key); }
});
$("#lookApply").addEventListener("click", applyPreview);
$("#lookCancel").addEventListener("click", () => setPreview(null));
document.addEventListener("keydown", e => {
  if (e.key === "Escape" && previewKey && !e.target.closest("input,textarea,select,[role=dialog],dialog") && $("#tmenu").hidden) setPreview(null);
});
/* a personal look's menu: rename, duplicate, favourite, delete (the same files the Library shows) */
let tmenuFor = null;
function openTileMenu(key, b) {
  const m = $("#tmenu"), r = b.getBoundingClientRect();
  tmenuFor = key; m.hidden = false;
  m.querySelector('[data-tm="fav"] span').textContent = t(G.favs.includes(key) ? "grade.unfav" : "grade.favShort");
  m.style.position = "fixed"; m.style.top = Math.min(r.bottom + 4, innerHeight - m.offsetHeight - 8) + "px"; m.style.left = Math.max(8, Math.min(r.left, innerWidth - m.offsetWidth - 8)) + "px"; m.style.right = "auto";
  M.pop(m, b); m.querySelector("button").focus();
}
function closeTileMenu() { if (!$("#tmenu").hidden) M.closePopover($("#tmenu")); tmenuFor = null; }
document.addEventListener("mousedown", e => { if (!e.target.closest("#tmenu") && !e.target.closest("[data-tact=menu]")) closeTileMenu(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeTileMenu(); });
const stem = v => HAL && HAL.fileStem ? HAL.fileStem(v) : v;
function nameError(v, except) {
  if (!v) return t("lib.err.empty");
  if (stem(v) !== v) return t("lib.err.chars");
  return Object.keys(G.looks).some(n => n !== except && n.toLowerCase() === v.toLowerCase()) ? t("lib.err.taken") : "";
}
function renamePersonal(from, to) {
  G.looks[to] = G.looks[from]; delete G.looks[from];
  G.favs = G.favs.map(k => k === "u:" + from ? "u:" + to : k);
  for (const L of G.layers) if (L.mine === from) L.mine = to;
  buildGrid(); renderLooks(); renderLayers(); up.schedulePersist();
}
$("#tmenu").addEventListener("click", async e => {
  const b = e.target.closest("[data-tm]"); if (!b || !tmenuFor) return;
  const key = tmenuFor, name = key.slice(2); closeTileMenu();
  if (b.dataset.tm === "fav") { toggleFav(key); return; }
  if (b.dataset.tm === "rename") {
    const to = HAL && HAL.ask ? await HAL.ask({ title: t("grade.renameLook"), text: t("lib.renameText", { name }), input: name, okLabel: t("lib.act.rename"), validate: v => v === name ? "" : nameError(v, name) }) : null;
    if (!to || to === name || nameError(to, name)) return;
    renamePersonal(name, to); setStatus(t("lib.renamed", { name: to }), "ok"); return;
  }
  if (b.dataset.tm === "dup") {
    let to = t("lib.copyName", { name }), n = 2;
    while (nameError(to)) to = t("lib.copyNameN", { name, n: n++ });
    G.looks[to] = clone(G.looks[name]); buildGrid(); renderLooks(); up.schedulePersist(); setStatus(t("lib.duplicated", { name: to }), "ok"); return;
  }
  if (b.dataset.tm === "del") {
    const ok = HAL && HAL.ask ? await HAL.ask({ title: t("grade.deleteLook"), text: t("lib.deleteText", { name }), okLabel: t("common.delete"), danger: true }) : true;
    if (!ok) return;
    delete G.looks[name]; G.favs = G.favs.filter(k => k !== key);
    for (const L of G.layers) if (L.mine === name) delete L.mine;
    buildGrid(); renderLooks(); renderLayers(); up.schedulePersist(); setStatus(t("lib.deleted", { name }), "ok");
  }
});
/* thumbnails: the same render as the preview (renderStack), 160 px, one at a time, tiles on screen first (§4.5) */
let thumbsOf = null, thumbQueue = [], thumbBusy = false, thumbTimer = 0, thumbKey = "", thumbFrame = 0, thumbsWaiting = false;
let thumbReadback = null, thumbLUTWorker = null, thumbLUTPending = null, thumbWorkerUnavailable = false;
function stopThumbWorker() { thumbLUTWorker?.terminate(); thumbLUTWorker = null; thumbLUTPending = null; }
// A tile's look LUT built in the worker before its thumbnail is drawn (true: wait for it)
function prepareThumbLUT(key) {
  const C = entryLayer(key), def = C && layerDef(C);
  if (!def || thumbWorkerUnavailable) return false;
  const dk = defKey(def);
  if (lutCache.has(dk)) return false;
  if (thumbLUTPending) return true;
  try {
    if (!thumbLUTWorker) {
      const worker = thumbLUTWorker = new Worker(new URL('./grade-lut-worker.js', import.meta.url), { type: 'module' });
      const failed = () => {
        if (thumbLUTWorker !== worker) return;
        stopThumbWorker(); thumbWorkerUnavailable = true;
        if (!window.__ui.away && !thumbFrame) thumbFrame = requestAnimationFrame(pumpThumbs);
      };
      worker.onerror = event => { event.preventDefault(); failed(); };
      worker.onmessage = ({ data }) => {
        if (thumbLUTWorker !== worker || data.id !== thumbLUTPending) return;
        if (data.error) { failed(); return; }
        thumbLUTPending = null;
        if (window.__ui.away) { stopThumbWorker(); return; }
        storeLUT(data.id, data.bytes);
        if (!thumbFrame) thumbFrame = requestAnimationFrame(pumpThumbs);
      };
    }
    thumbLUTPending = dk; thumbLUTWorker.postMessage({ id: dk, def });
    return true;
  } catch (_) { stopThumbWorker(); thumbWorkerUnavailable = true; return false; }
}
function discardThumbReadback(retry = false) {
  if (!thumbReadback) return;
  if (retry && thumbReadback.key === thumbKey && thumbReadback.source === G.lastSrc?.el) thumbQueue.unshift(thumbReadback.id);
  gl.deleteSync(thumbReadback.fence); gl.deleteBuffer(thumbReadback.buffer); release(thumbReadback.target);
  thumbReadback = null;
}
addEventListener("pagehide", () => { cancelAnimationFrame(thumbFrame); clearTimeout(thumbTimer); discardThumbReadback(); stopThumbWorker(); }, { once: true });
function waitForThumbs() { if(!thumbsWaiting){thumbsWaiting=true;window.__ui.whenBack(()=>{thumbsWaiting=false;scheduleThumbs(0);if(thumbQueue.length&&!thumbBusy)pumpThumbs();});} }
window.__ui.onAway(()=>{cancelAnimationFrame(rq);rq=0;requestRender();cancelAnimationFrame(thumbFrame);thumbFrame=0;thumbBusy=false;clearTimeout(thumbTimer);discardThumbReadback(true);stopThumbWorker();waitForThumbs();});
function queueThumbs() { thumbKey = ""; scheduleThumbs(0); }
// The tiles shown whose thumbnail is not of the current picture and layers: on screen first, then the rest shown
function queueShown() {
  if (!thumbKey || !G.srcTex) return;
  // the tile whose readback is in flight for this key is not queued again
  const todo = shownKeys().filter(k => tileEls.get(k).painted !== thumbKey && !(thumbReadback && thumbReadback.id === k && thumbReadback.key === thumbKey));
  thumbQueue = todo.filter(k => tileSeen.has(k)).concat(todo.filter(k => !tileSeen.has(k)));
  if (thumbQueue.length && !thumbBusy) pumpThumbs();
}
function scheduleThumbs(delay = 350) {
  clearTimeout(thumbTimer);
  if(window.__ui.away){waitForThumbs();return;}
  thumbTimer = setTimeout(() => {
    // a thumbnail is the look alone over the picture and its effects: the looks in Layers are left out, so adjusting
    // them changes no thumbnail
    const key = JSON.stringify(G.layers.filter(l => l.on && l.amt > 0 && !isLook(l))) + "|" + G.thumbPct + "|" + srcW + "x" + srcH + "|" + G.fontsTick + "|" + JSON.stringify(personalNames().map(n => G.looks[n]));
    if (key !== thumbKey) {
      thumbKey = key;
      // a new picture: the tiles shimmer until their thumbnail is painted
      if (G.lastSrc && thumbsOf !== G.lastSrc.el) { thumbsOf = G.lastSrc.el; for (const e of tileEls.values()) { e.painted = ""; M.skeleton(e.wrap, true); } }
    }
    queueShown();
  }, delay);
}
const thumbEl = $("#thumbPct");
thumbEl.addEventListener("input", () => {
  G.thumbPct = +thumbEl.value; thumbEl.style.setProperty("--p", ((G.thumbPct - 5) / 95 * 100) + "%");
  $("#oThumbPct").textContent = G.thumbPct + " %"; scheduleThumbs(150);
});
thumbEl.addEventListener("change", () => up.schedulePersist());
function syncThumbPct() { thumbEl.value = G.thumbPct; thumbEl.style.setProperty("--p", ((G.thumbPct - 5) / 95 * 100) + "%"); $("#oThumbPct").textContent = G.thumbPct + " %"; }
function pumpThumbs() {
  thumbFrame=0;
  if(window.__ui.away){thumbBusy=false;discardThumbReadback(true);stopThumbWorker();waitForThumbs();return;}
  if (thumbReadback) {
    const pending = thumbReadback, status = gl.clientWaitSync(pending.fence, 0, 0);
    if (status === gl.TIMEOUT_EXPIRED) { thumbFrame=requestAnimationFrame(pumpThumbs); return; }
    if (status === gl.WAIT_FAILED) {
      discardThumbReadback(); thumbBusy=false; thumbQueue=[]; stopThumbWorker();
      setStatus(t("grade.st.glFailed", { error: "Thumbnail readback failed" }), "bad"); return;
    }
    const tile = tileEls.get(pending.id);
    if (tile && pending.key === thumbKey && pending.source === G.lastSrc?.el) {
      const S = 160, buf = new Uint8Array(S * S * 4);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pending.buffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, buf);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      const x = tile.cv.getContext("2d"), idata = x.createImageData(S, S);
      for (let y = 0; y < S; y++) idata.data.set(buf.subarray((S - 1 - y) * S * 4, (S - y) * S * 4), y * S * 4);
      x.putImageData(idata, 0, 0); tile.painted = pending.key;
      if (tile.wrap.classList.contains("skel")) { M.skeleton(tile.wrap, false); M.fadeIn(tile.cv, { dur: "spring" }); }
    }
    discardThumbReadback();
    thumbFrame=requestAnimationFrame(pumpThumbs);return;
  }
  while (thumbQueue.length && !entryLayer(thumbQueue[0])) thumbQueue.shift();
  if (!thumbQueue.length || !gl || !G.srcTex) { thumbBusy = false; stopThumbWorker(); purge(t => t.w === canvas.width && t.h === canvas.height); return; }
  thumbBusy = true;
  if (prepareThumbLUT(thumbQueue[0])) return;
  const S = 160, target = acquire(S, S), uv = cropRect(IMG.centered(srcW, srcH, "1:1")).uni;
  const id = thumbQueue.shift(), C = entryLayer(id), live = G.layers.filter(l => l.on && l.amt > 0 && !isLook(l));
  C.id = "thumb-" + id;
  renderStack([C].concat(live), S, S, uv, target);
  // Queue GPU readback, then test its fence without waiting on the main thread.
  const buffer = gl.createBuffer(); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, S * S * 4, gl.STREAM_READ);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); gl.readPixels(0, 0, S, S, gl.RGBA, gl.UNSIGNED_BYTE, 0);
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.flush();
  thumbReadback = { buffer, fence, target, id, key: thumbKey, source: G.lastSrc.el };
  thumbFrame=requestAnimationFrame(pumpThumbs);
}
/* tools: each one opens in place with its controls; while open it previews on the image */
const toolDesc = key => t("tool." + key.replace(":", "."));
const drafts = {};
function toolDefaults(key) { return key === "adjust" ? schemaDefaults(ADJ) : key === "gmap" ? schemaDefaults(GMAP) : key === "text" ? schemaDefaults(TEXT) : fxDefaults(key.slice(3)); }
function toolName(key) { return key === "adjust" ? t("grade.tool.adjust") : key === "gmap" ? t("grade.tool.gmap") : key === "text" ? t("grade.tool.text") : FX[key.slice(3)].name; }
function draftLayer(key) {
  if (!drafts[key]) drafts[key] = toolDefaults(key);
  const id = "draft-" + key.replace(":", "-");
  if (key.startsWith("fx:")) return { id, type: "fx", fx: key.slice(3), p: drafts[key], amt: 100, on: true };
  return { id, type: key, p: drafts[key], amt: 100, on: true };
}
function buildTools() {
  const groups = [["Color", ["adjust", "gmap"]]];
  for (const g of ["Luz", "Textura", "Óptica"]) groups.push([g, Object.keys(FX).filter(k => FX[k].group === g).map(k => "fx:" + k)]);
  groups.push(["Acabado", ["text"]]);
  $("#pane-tools").innerHTML = `<p class="hint" style="margin:0 0 10px">${esc(t("grade.toolsHint"))}</p>` +
    groups.map(([g, keys], gi) => `<details class="acc" ${gi === 0 ? "open" : ""}><summary>${esc(groupName(g))} <small>${keys.length}</small></summary><div class="acc-body">${keys.map(k =>
      `<details class="tool" data-key="${k}"><summary><div><b>${esc(toolName(k))}</b><small>${esc(toolDesc(k))}</small></div></summary><div class="tool-body"></div></details>`).join("")}</div></details>`).join("");
  document.querySelectorAll(".tool").forEach(d => { d.addEventListener("toggle", () => onToolToggle(d)); d.addEventListener("motion:open", () => onToolToggle(d)); });
}
function toolBodyHTML(key) {
  const L = draftLayer(key);
  return schemaOf(L).map(p => ctrlHTML(L, p)).join("") +
    `<div class="btnrow"><button class="btn primary" data-dact="add">${esc(t("grade.addToLayers"))}</button><button class="btn" data-dact="reset">${esc(t("grade.defaults"))}</button></div>`;
}
function onToolToggle(d) {
  const key = d.dataset.key;
  if (d.open) {
    if (d.dataset.filled) return;                 // already filled (the animated open fills it first)
    d.dataset.filled = "1";
    document.querySelectorAll(".tool[open]").forEach(o => { if (o !== d) { o.open = false; delete o.dataset.filled; } });
    d.querySelector(".tool-body").innerHTML = toolBodyHTML(key);
    G.activeDraft = key; setPreview(null);
    if (key === "text") ensureTextFont(drafts[key]);
  } else { delete d.dataset.filled; if (G.activeDraft === key) G.activeDraft = null; }
  const tag = $("#draftTag");
  tag.hidden = !G.activeDraft; if (G.activeDraft) tag.textContent = t("grade.trying", { name: toolName(G.activeDraft) });
  requestRender();
}
const toolsEl = $("#pane-tools");
function toolOf(el) { const d = el.closest(".tool"); return d ? d.dataset.key : null; }
toolsEl.addEventListener("input", e => {
  const key = toolOf(e.target); if (!key || !e.target.dataset.k) return;
  readCtrl(e.target, draftLayer(key)); if (key === "text") ensureTextFont(drafts[key]); requestRender();
});
toolsEl.addEventListener("change", e => {
  const key = toolOf(e.target); if (!key || !e.target.dataset.k) return;
  readCtrl(e.target, draftLayer(key));
  if (key === "text" && e.target.dataset.k === "font") e.target.closest(".tool-body").innerHTML = toolBodyHTML(key);
  requestRender();
});
toolsEl.addEventListener("click", e => {
  const b = e.target.closest("[data-dact]"); if (!b) return;
  const d = b.closest(".tool"), key = d.dataset.key;
  if (b.dataset.dact === "reset") { drafts[key] = toolDefaults(key); d.querySelector(".tool-body").innerHTML = toolBodyHTML(key); requestRender(); return; }
  const src = draftLayer(key), L = { type: src.type, p: clone(src.p) };
  if (src.fx) L.fx = src.fx;
  addLayer(L); if (key === "text") ensureTextFont(L.p);
  d.open = false;
  setStatus(t("grade.st.toolAdded", { name: toolName(key) }), "ok");
});
document.querySelectorAll(".tabs .tab").forEach(t => t.addEventListener("click", () => {
  document.querySelectorAll(".tabs .tab").forEach(x => x.setAttribute("aria-selected", String(x === t)));
  const pane = $("#pane-" + t.dataset.tab), turned = pane.hidden;
  for (const p of ["filters", "tools", "mine"]) $("#pane-" + p).hidden = p !== t.dataset.tab;
  if (turned) M.enter(pane);
}));
// Home's search opens a look or a tool here: its panel, and the tile or the tool open and in view
function revealFromHome({ look, tool }) {
  document.querySelector(`.tabs .tab[data-tab="${look ? "filters" : "tools"}"]`).click();
  if (look) {
    setSub("all"); subQuery.all = ""; $("#lookSearch").value = "";
    if (catSel !== "every") { catSel = "every"; renderChips(); }
    filterGrid(false);
    const el = document.querySelector(`.tile[data-look="${look}"]`); if (!el) return;
    el.scrollIntoView({ block: "center" }); el.focus({ preventScroll: true }); M.pop(el);
    return;
  }
  const d = document.querySelector(`.tool[data-key="${tool}"]`); if (!d) return;
  const acc = d.closest("details.acc"); if (acc && !acc.open) acc.open = true;
  if (!d.open) M.toggle(d, true);
  d.scrollIntoView({ block: "start" }); d.querySelector("summary").focus({ preventScroll: true });
}

/* my G.looks */
function renderLooks() {
  up.renderBatchLooks();
  const names = Object.keys(G.looks).filter(n => !isPersonal(G.looks[n])).sort((a, b) => a.localeCompare(b)), list = $("#lookList");
  if (!names.length) { list.innerHTML = `<p class="empty">${esc(t("grade.noLooks"))}</p>`; return; }
  list.innerHTML = names.map((n, i) => `<div class="item"><b title="${esc(n)}">${esc(n)}</b><small>${esc(t(G.looks[n].length === 1 ? "grade.layerCountOne" : "grade.layerCount", { n: G.looks[n].length }))}</small><button class="btn sm" data-lk="apply" data-i="${i}">${esc(t("common.apply"))}</button><button class="btn sm" data-lk="add" data-i="${i}">${esc(t("grade.addOnTop"))}</button><button class="btn sm" data-lk="del" data-i="${i}">${esc(t("common.delete"))}</button></div>`).join("");
  list.onclick = e => {
    const b = e.target.closest("[data-lk]"); if (!b) return;
    const n = names[+b.dataset.i], L = clone(G.looks[n]).map(l => Object.assign(l, { id: rid() }));
    if (b.dataset.lk === "apply") { G.layers = L; renderLayers(); requestRender(); commit(); setStatus(t("grade.st.lookApplied", { name: n }), "ok"); }
    else if (b.dataset.lk === "add") { G.layers = G.layers.concat(L); renderLayers(); requestRender(); commit(); setStatus(t("grade.st.lookOnTop", { name: n }), "ok"); }
    else {
      if (!b.dataset.armed) { b.dataset.armed = "1"; b.textContent = t("common.sure"); b.classList.add("warn"); setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = t("common.delete"); b.classList.remove("warn"); } }, 3000); return; }
      delete G.looks[n]; renderLooks(); up.schedulePersist();
    }
  };
}
function saveLook(name) {
  name = (name || "").trim(); if (!name) return false;
  if (!G.layers.length) { setStatus(t("grade.st.noLayers"), "warn"); return false; }
  G.looks[name] = clone(G.layers).map(l => { delete l.open; return l; }); renderLooks(); up.schedulePersist();
  setStatus(t("grade.st.lookSaved", { name }), "ok"); return true;
}
$("#lookSave").addEventListener("click", () => { if (saveLook($("#lookName").value)) $("#lookName").value = ""; else $("#lookName").focus(); });
$("#lookName").addEventListener("keydown", e => { if (e.key === "Enter") $("#lookSave").click(); });
$("#saveLookBtn").addEventListener("click", () => {
  document.querySelector('.tab[data-tab="mine"]').click();
  $("#lookName").focus();
});

Object.assign(up, { buildGrid, draftLayer, previewLayer, setPreview, isPersonal, queueThumbs, renderGridBadges, scheduleThumbs, toolBodyHTML });

/* ===== controls ===== */
// Crop and Cutout, before/after, keys and the file input

/* =================== G.crop: the format and the Crop dialog (docs/ARCHITECTURE.md → Shared services) =================== */
function syncCropUI() {
  $("#aspect").value = G.crop.aspect;
  const has = !!G.srcTex, r = has ? cropRect() : null;
  $("#cropOut").textContent = r ? t("crop.out", { w: r.w, h: r.h }) : "";
  $("#stage").classList.toggle("cut", !!G.cut);
  M.reveal($("#cutOff"), !!G.cut);
  $("#outFmt").querySelector('option[value="jpg"]').disabled = !!G.cut;
  if (G.cut && $("#outFmt").value === "jpg") $("#outFmt").value = "png";
}
// The Crop dialog on the original; a fixed format locks its ratio. false when it was cancelled.
async function editCrop(o = {}) {
  if (!G.srcTex || !G.lastSrc || !HAL) return false;
  const ratio = o.ratio || FORMAT[G.crop.aspect] || "free", lock = ratio !== "free";
  const r = await HAL.crop({ image: G.lastSrc.el, name: G.img.name, params: o.params || cropParams(), ratio, lock, mask: G.cut && G.cut.mask, from: o.from || $("#cropBtn") });
  if (!r) return false;
  G.crop.p = r.params; syncCropUI(); fitPreview(); commit();
  return true;
}
$("#aspect").addEventListener("change", async e => {
  const prev = G.crop.aspect, v = e.target.value, ratio = FORMAT[v] || "free";
  if (!G.srcTex) { G.crop = { aspect: v, p: null }; syncCropUI(); commit(); return; }
  if (ratio === "free") { G.crop = { aspect: v, p: IMG.full() }; syncCropUI(); fitPreview(); commit(); return; }
  // a fixed format: the image already has it, or the dialog asks what to keep (cancelling keeps the old format)
  const p = IMG.centered(srcW, srcH, ratio, { x: cropParams().cx, y: cropParams().cy });
  if (IMG.fits(srcW, srcH, IMG.ratioValue(ratio)) || !HAL) { G.crop = { aspect: v, p }; syncCropUI(); fitPreview(); commit(); return; }
  G.crop.aspect = v;
  if (!(await editCrop({ ratio, params: p, from: e.target }))) { G.crop.aspect = prev; syncCropUI(); }
});
$("#cropBtn").addEventListener("click", () => editCrop());
$("#gl").addEventListener("dblclick", () => editCrop({ from: $("#gl") }));

/* =================== Cutout: the subject over transparency (docs/ARCHITECTURE.md → Shared services) =================== */
$("#cutBtn").hidden = !HAL;
async function setCut(cut) {
  G.cut = cut; uploadMask(cut ? cut.mask : null);
  HAL?.session?.schedule("grade");
  syncCropUI(); requestRender();
}
$("#cutBtn").addEventListener("click", async () => {
  if (!G.srcTex || !HAL || !G.srcBlob) return;
  const src = G.srcBlob, r = await HAL.cutoutDialog({ image: src, name: G.img.name, edit: G.cut && G.cut.edit, from: $("#cutBtn") });
  if (!r || G.srcBlob !== src) return;
  await setCut({ mask: await IMG.maskFrom(r.mask, r.w, r.h), edit: r.edit });
  // the cut-out is ready: export it as a transparent PNG now, or go on editing over it
  if (await HAL.ask({ title: t("grade.cutDone"), text: t("grade.cutDoneText"), okLabel: t("grade.cutExport"), cancelLabel: t("grade.cutKeep") })) $("#exportBtn").click();
});
$("#cutOff").addEventListener("click", () => setCut(null));

/* =================== before / after, keys =================== */
const origBtn = $("#origBtn");
const setOrig = v => { if (G.showOrig === v) return; G.showOrig = v; $("#origTag").hidden = !v; requestRender(); };
origBtn.addEventListener("pointerdown", () => setOrig(true));
["pointerup", "pointerleave", "pointercancel"].forEach(ev => origBtn.addEventListener(ev, () => setOrig(false)));
$("#undoBtn").addEventListener("click", undo); $("#redoBtn").addEventListener("click", redo);
document.addEventListener("keydown", e => {
  const tag = (document.activeElement && document.activeElement.tagName) || "";
  const typing = /INPUT|SELECT|TEXTAREA/.test(tag) && document.activeElement.type !== "range" && document.activeElement.type !== "checkbox";
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { if (typing) return; e.preventDefault(); e.shiftKey ? redo() : undo(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") { if (typing) return; e.preventDefault(); redo(); }
  else if (!typing && !e.ctrlKey && !e.metaKey && (e.key === "b" || e.key === "B") && !e.repeat) setOrig(true);
});
document.addEventListener("keyup", e => { if (e.key === "b" || e.key === "B") setOrig(false); });

/* =================== file input & drag/drop =================== */
$("#imgIn").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) useFile(f); });
let dragDepth = 0;
window.addEventListener("dragenter", e => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { dragDepth++; document.body.classList.add("dragging"); } });
window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove("dragging"); });
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove("dragging"); const f = e.dataTransfer && e.dataTransfer.files[0]; if (f) useFile(f); });

Object.assign(up, { syncCropUI, setCut });

/* ===== export ===== */
// Exporting the image and sending it to other tabs

/* =================== export =================== */
let lastSaved = null;
function showReveal(path) { lastSaved = path || null; M.reveal($("#revealBtn"), !!(HAL && path)); }
$("#revealBtn").addEventListener("click", () => { if (HAL && lastSaved) HAL.invoke("reveal_path", { path: lastSaved }).catch(e => setStatus(String(e), "bad")); });
function baseName() { return G.img.name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "").trim() || t("grade.untitled"); }
// File name from the template in Settings ("{title}.png" by default)
const outName = (title, ext) => HAL ? HAL.fileName("image", { title }, ext) : `${title}.${ext}`;
function outSizeFor(sizeSel, p) {
  const r = cropRect(p);
  let W = r.w, H = r.h;
  if (sizeSel !== "orig") { const s = +sizeSel / Math.max(W, H); W *= s; H *= s; }
  const lim = MAXTEX / Math.max(W, H); if (lim < 1) { W *= lim; H *= lim; }
  return { W: Math.round(W), H: Math.round(H), uni: r.uni };
}
// Render a resolución completa del stack de capas (o de otro stack, con otro recorte y sin Cutout, para los lotes)
async function renderToCanvas(sizeSel, stack = G.layers, p, source) {
  await Promise.all(stack.filter(l => l.type === "text").map(l => ensureTextFont(l.p)));
  // A queued export owns its input. Bind it only for the synchronous draw, then restore the live preview.
  const live = source && { tex: G.srcTex, mask: G.maskTex, last: G.lastSrc, w: srcW, h: srcH };
  if (source) { G.srcTex = null; G.maskTex = null; uploadSource(source.el, source.w, source.h); uploadMask(source.mask); }
  try {
    const { W, H, uni } = outSizeFor(sizeSel, p);
    const target = acquire(W, H);
    renderStack(ordered(stack), W, H, uni, target, source ? G.maskTex : p ? null : G.cut && G.maskTex);
    const c = up.readTarget(target, W, H);
    release(target); purge(t => t.w === canvas.width && t.h === canvas.height);
    for (const k in textTexs) if (!k.endsWith(canvas.width + "x" + canvas.height)) { gl.deleteTexture(textTexs[k].tex); delete textTexs[k]; }
    return c;
  } finally {
    if (live) {
      gl.deleteTexture(G.srcTex); if (G.maskTex) gl.deleteTexture(G.maskTex);
      G.srcTex = live.tex; G.maskTex = live.mask; G.lastSrc = live.last; srcW = live.w; srcH = live.h;
    }
  }
}
const canvasBlob = (c, jpg) => new Promise(res => c.toBlob(res, jpg ? "image/jpeg" : "image/png", 0.95));
function canvasThumb(c, max = 320) {
  const s = Math.min(1, max / Math.max(c.width, c.height)), t = mk(c.width * s, c.height * s);
  const x = t.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(c, 0, 0, t.width, t.height);
  return t.toDataURL("image/jpeg", 0.82);
}
$("#exportBtn").addEventListener("click", async () => {
  if (!gl || !G.srcTex) return;
  await HAL?.session?.start("grade");
  const size = $("#outSize").value, jpg = $("#outFmt").value === "jpg" && !G.cut;
  const name = outName(baseName(), jpg ? "jpg" : "png"), stack = clone(G.layers), crop = clone(cropParams());
  const source = { ...G.lastSrc, mask: G.cut && G.cut.mask };
  const work = async ctx => {
    if (ctx && ctx.signal.aborted) throw { name: "AbortError" };
    setStatus(t("grade.st.processing")); showReveal(null);
    const c = await renderToCanvas(size, stack, crop, source);
    const blob = await canvasBlob(c, jpg);
    if (ctx && ctx.signal.aborted) throw { name: "AbortError" };
    setStatus(t("grade.st.saving", { w: c.width, h: c.height, size: (blob.size / 1e6).toFixed(1) }), "ok");
    const r = await saveFile(name, blob, { onSaved: r => showReveal(r.path) });
    if (r && HAL) HAL.session.recordExport("grade", { path: r.path, name: r.name, kind: "image", thumb: canvasThumb(c) });
    if (r && ctx) ctx.output(r.path, { kind: "image" });
    return r;
  };
  try {
    if (HAL && HAL.jobs) {
      const h = HAL.jobs.submit({ tool: "grade", kind: "export-image", title: name, lane: "cpu", host: "page", serial: "grade-gl", run: work });
      if (HAL.jobLaunched) HAL.jobLaunched($("#exportBtn"), h, { tool: "grade" });
      await h.done;
    } else await work(null);
  } catch (e) { if (!(e && e.name === "AbortError")) { console.error(e); setStatus(t("grade.st.exportFailed", { error: e && e.message ? e.message : e }), "bad"); } }
  finally { updateReady(); requestRender(); }
});
// The edited picture to another tool, as a PNG: 3000 px as the Visualizer's cover, at its own size elsewhere;
// "and come back" opens the result here
async function renderedItem(to) {
  if (!gl || !G.srcTex) return null;
  const btn = $("#sendBtn"); btn.disabled = true; setStatus(t("grade.st.processing"));
  await sleep(30);
  try { return { blob: await canvasBlob(await renderToCanvas(to === "visualizer" ? "3000" : "orig"), false), name: `${baseName()}.png` }; }
  catch (e) { console.error(e); setStatus(t("grade.st.exportFailed", { error: e && e.message ? e.message : e }), "bad"); return null; }
  finally { setStatus(""); updateReady(); requestRender(); }
}
$("#sendBtn").hidden = !HAL;
window.__ui.sendMenu($("#sendBtn"), { kind: "image", from: "grade", item: renderedItem });
$("#emptyStage").addEventListener("click", e => { if (!e.target.closest("button")) $("#imgIn").click(); });
$("#emptyStage").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); $("#imgIn").click(); } });
$("#browseBtn").addEventListener("click", () => $("#imgIn").click());
// A frame of a video as the picture: Frame Grab opens and brings the frame back here (docs/ARCHITECTURE.md → Shared services)
async function frameFromVideo() {
  const res = HAL && await HAL.frameGrab({ from: "grade", dest: "image" }), f = res && res[0];
  if (!f) return;
  const name = `${f.video.name.replace(/\.[^.]+$/, "")} - ${window.t("fg.frameName", { n: f.n + 1 })}.png`;
  await window.__halApp.loadImage(new File([f.blob], name, { type: "image/png" }), name);
}
$("#frameBtn").addEventListener("click", frameFromVideo);
$("#frameTool").addEventListener("click", frameFromVideo);
$("#linkBtn").addEventListener("click", () => { if (HAL) HAL.show("downloader"); });

/* ===== persist ===== */
// Saving the state and looks; thumbnails for the Library

/* =================== persistence =================== */
let dbDoc = null, persistTimer = 0, persistPending = false, writing = false, writeAgain = false, localStamp = 0;
function setSync(s, text) { $("#sync").dataset.s = s; $("#syncText").textContent = text; if (HAL && HAL.setSync) HAL.setSync("grade", s, text); }
function payload() { return { looks: clone(G.looks), favs: G.favs.slice(), previewPct: G.thumbPct, current: { layers: clone(G.layers).map(l => { delete l.open; return l; }), crop: clone(G.crop) }, updatedAt: Date.now() }; }
function validLayer(l) {
  if (!l || typeof l !== "object") return null;
  const base = { id: rid(), on: l.on !== false, amt: clamp(+l.amt || 0, 0, 100) };
  const fill = (S, p) => { const o = schemaDefaults(S); if (p && typeof p === "object") for (const s of S) if (s.k in p && typeof p[s.k] === typeof s.def) o[s.k] = p[s.k]; return o; };
  if (l.type === "look") {
    // a catalogue look by id, or a personal look's own definition (docs/GRADE_LOOKS_SPEC.md §3.2–3.3); a removed classic
    // look opens as its closest catalogue look
    const def = l.def ? cleanDef(l.def) : null, raw = String(l.id0 || "").slice(0, 80), id0 = !def && !LOOK2[raw] && CLASSIC[raw] ? CLASSIC[raw] : raw;
    if (!def && !LOOK2[id0]) return null;
    const o = { ...base, type: "look", id0 }, adj = cleanAdj(l.adj);
    if (def) o.def = def;
    if (Object.keys(adj).length) o.adj = adj;
    if (Number.isInteger(l.rev) && l.rev > 0) o.rev = l.rev;
    if (typeof l.mine === "string" && l.mine) o.mine = l.mine.slice(0, 120);
    return o;
  }
  if (l.type === "adjust") return { ...base, type: "adjust", p: fill(ADJ, l.p) };
  if (l.type === "gmap") return { ...base, type: "gmap", p: fill(GMAP, l.p) };
  if (l.type === "text") return { ...base, type: "text", p: fill(TEXT, l.p) };
  if (l.type === "fx" && FX[l.fx]) return { ...base, type: "fx", fx: l.fx, p: fill(FX[l.fx].params, l.p) };
  return null;
}
function applyPayload(d) {
  if (!d) return;
  if (Number.isFinite(+d.previewPct)) G.thumbPct = clamp(Math.round(+d.previewPct / 5) * 5, 5, 100);
  if (Array.isArray(d.favs)) G.favs = [...new Set(d.favs.filter(k => typeof k === "string" && /^[bu]:/.test(k)).map(k => k.slice(0, 122)))];
  if (d.looks && typeof d.looks === "object") { G.looks = {}; for (const n in d.looks) if (Array.isArray(d.looks[n])) G.looks[n.slice(0, 120)] = d.looks[n].map(validLayer).filter(Boolean); }
  if (d.current) {
    if (Array.isArray(d.current.layers)) G.layers = d.current.layers.map(validLayer).filter(Boolean);
    // the format carries over; a crop is kept only in today's form (the old framing offsets, x and y, are dropped)
    if (d.current.crop) G.crop = { aspect: FORMAT[d.current.crop.aspect] ? d.current.crop.aspect : "orig", p: IMG.validCrop(d.current.crop.p) ? d.current.crop.p : null };
  }
  localStamp = d.updatedAt || 0;
}
function schedulePersist() { HAL?.session?.schedule("grade"); persistPending = true; clearTimeout(persistTimer); persistTimer = setTimeout(persistNow, 800); }
function persistNow() {
  persistPending = false;
  const p = payload(); localStamp = p.updatedAt;
  try { sessionStorage.setItem(LS_KEY, JSON.stringify(p)); } catch (e) {}
  if (dbDoc) writeDb(); else setSync("local", t("sync.local"));
}
async function writeDb() {
  if (writing) { writeAgain = true; return; }
  writing = true; setSync("saving", t("sync.saving"));
  try { await dbDoc.set(payload()); setSync("cloud", t("sync.saved")); }
  catch (e) {
    if (e && e.code === "unavailable") { await sleep(700); try { await dbDoc.set(payload()); setSync("cloud", t("sync.saved")); } catch (e2) { setSync("error", t("sync.error")); } }
    else setSync("error", t("sync.error"));
  }
  writing = false; if (writeAgain) { writeAgain = false; writeDb(); }
}
async function connectAccount() {
  const [db, user] = await Promise.all([cap("db"), cap("user")]);
  if (!db || !user) { setSync("local", t("sync.local")); return; }
  try {
    const uid = await user.id(); if (!uid) { setSync("local", t("sync.local")); return; }
    const ref = db.doc("data/users/" + uid + "/grade"), snap = await ref.get(); dbDoc = ref;
    if (snap.exists) {
      const d = clone(snap.data());
      if ((d.updatedAt || 0) > localStamp) {
        applyPayload(d); renderChips(); buildGrid(); renderLooks(); renderLayers(); syncCropUI(); syncThumbPct(); fitPreview();
        G.hist = [stateJSON()]; G.hi = 0; updateHistButtons();
        try { sessionStorage.setItem(LS_KEY, JSON.stringify(d)); } catch (e) {}
      } else if ((d.updatedAt || 0) < localStamp) writeDb();
      setSync("cloud", t("sync.saved"));
    } else await writeDb();
  } catch (e) { setSync("local", t("sync.local")); }
}

/* =================== used by the Library and the other tabs =================== */
async function flushPersist() {
  if (persistPending) { clearTimeout(persistTimer); persistNow(); }
  while (writing) await sleep(30);
}
async function reloadLooks() {
  if (!dbDoc) return;
  await flushPersist();
  const snap = await dbDoc.get(), d = snap.exists ? snap.data() : null;
  G.looks = {};
  if (d && d.looks) for (const n in d.looks) if (Array.isArray(d.looks[n])) G.looks[n.slice(0, 120)] = d.looks[n].map(validLayer).filter(Boolean);
  renderLooks(); buildGrid();
}
async function applyLookByName(name) {
  if (!G.looks[name]) await reloadLooks();
  if (!G.looks[name]) throw new Error(t("grade.err.noLook", { name }));
  G.layers = clone(G.looks[name]).map(l => Object.assign(l, { id: rid() }));
  renderLayers(); requestRender(); commit(); setStatus(t("grade.st.lookApplied", { name }), "ok");
}
function readTarget(target, W, H) {
  const buf = new Uint8Array(W * H * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.fbo); gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
  const c = mk(W, H), x = c.getContext("2d"), id = x.createImageData(W, H);
  for (let y = 0; y < H; y++) id.data.set(buf.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
  x.putImageData(id, 0, 0);
  return c;
}
// Miniatura de un look sobre la imagen abierta (para la Biblioteca)
async function lookThumb(list, size = 200, type = "image/jpeg") {
  if (!gl || !G.srcTex) return "";
  const L = (list || []).map(validLayer).filter(Boolean);
  await Promise.all(L.filter(l => l.type === "text").map(l => ensureTextFont(l.p)));
  const S = size, target = acquire(S, S);
  const uv = cropRect(IMG.centered(srcW, srcH, "1:1")).uni;
  renderStack(ordered(L.filter(l => l.on && l.amt > 0)), S, S, uv, target);
  const c = readTarget(target, S, S);
  release(target);
  for (const l of L) {
    if (layerLUTs[l.id]) { gl.deleteTexture(layerLUTs[l.id].tex); delete layerLUTs[l.id]; }
    for (const k in textTexs) if (k.startsWith(l.id)) { gl.deleteTexture(textTexs[k].tex); delete textTexs[k]; }
  }
  requestRender();
  return c.toDataURL(type, 0.86);
}

Object.assign(up, { readTarget, schedulePersist });

/* ===== batch ===== */
// Batch: many images with the same layers

/* =================== lotes: muchas imágenes con el mismo stack =================== */
const isImageFile = f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(f.name);
let batch = [], batchStop = false;
function renderBatchLooks() {
  const sel = $("#batchLook"), cur = sel.value, names = Object.keys(G.looks).sort((a, b) => a.localeCompare(b));
  sel.innerHTML = `<option value="">${esc(t("grade.batchCurrent"))}</option>` + names.map(n => `<option value="${esc(n)}">${esc(t("grade.batchLook", { name: n }))}</option>`).join("");
  if (names.includes(cur)) sel.value = cur;
}
function setBatch(files) {
  batch = Array.from(files).filter(isImageFile);
  HAL?.session?.schedule("grade");
  const n = batch.length;
  $("#batchCount").textContent = n ? `· ${n}` : "";
  $("#batchList").textContent = n ? t(n === 1 ? "grade.batchOne" : n > 4 ? "grade.batchMore" : "grade.batchMany", { n, names: batch.slice(0, 4).map(f => f.name).join(", "), more: n - 4 }) : t("grade.batchNoteExport");
  $("#batchRun").disabled = !n || G.batchRunning; M.reveal($("#batchClear"), !!n && !G.batchRunning);
  $("#batchStatus").textContent = ""; $("#batchStatus").className = "status";
}
$("#batchCard").hidden = !HAL;
$("#batchFiles").addEventListener("change", e => { setBatch(e.target.files); e.target.value = ""; });
$("#batchDir").addEventListener("change", e => { setBatch(e.target.files); e.target.value = ""; });
$("#batchClear").addEventListener("click", () => setBatch([]));
// Cancel: the batch's jobs, running or still queued
const liveBatch = new Set();
$("#batchCancel").addEventListener("click", () => { batchStop = true; if (HAL && HAL.jobs) for (const id of [...liveBatch]) HAL.jobs.cancel(id); $("#batchStatus").textContent = t("common.cancelling"); });
// Every picture is a job of one batch (docs/JOBS_SPEC.md §8, cpu lane, serial: the one WebGL context); the processes
// island shows the batch and its end. Without the jobs system (the page alone) they run straight.
async function runBatch(e) {
  await HAL?.session?.start("grade");
  if (G.batchRunning || !batch.length || !gl || !G.srcTex) return;
  const look = $("#batchLook").value, sizeSel = $("#outSize").value, jpg = $("#outFmt").value === "jpg", aspect = G.crop.aspect;
  const stack = look && G.looks[look] ? clone(G.looks[look]).map(l => Object.assign(l, { id: rid() })) : clone(G.layers);
  const keep = G.lastSrc, files = batch.slice(), st = $("#batchStatus"), bar = $("#batchBar");
  G.batchRunning = true; batchStop = false;
  $("#batchRun").disabled = true; M.reveal($("#batchCancel"), true); M.reveal($("#batchClear"), false); M.reveal($("#batchProg"), true); $("#exportBtn").disabled = true;
  let done = 0, failed = 0, ended = 0;
  M.bar(bar, 0);
  const one = async (f, i, ctx) => {
    if (batchStop) { const x = new Error("cancelled"); x.cancelled = true; throw x; }
    st.className = "status"; st.textContent = t("grade.batchStep", { n: i + 1, total: files.length, name: f.name });
    const url = URL.createObjectURL(f);
    try {
      const el = await loadImageEl(url);
      uploadSource(el, el.naturalWidth, el.naturalHeight);
      // each picture gets the format's centred crop (no dialog in a batch)
      const c = await renderToCanvas(sizeSel, stack, IMG.centered(el.naturalWidth, el.naturalHeight, FORMAT[aspect] || "free")), blob = await canvasBlob(c, jpg);
      const base = f.name.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "").trim() || t("grade.untitled");
      const r = await saveFile(outName(base, jpg ? "jpg" : "png"), blob, { direct: true, quiet: true });
      if (ctx && r.path) ctx.output(r.path, { kind: "image" });
      if (HAL) HAL.session.recordExport("grade", { path: r.path, name: r.name, kind: "image", thumb: canvasThumb(c, 240) });
    } finally { URL.revokeObjectURL(url); }
  };
  const group = "grade-batch-" + Date.now();
  const runOne = (f, i) => {
    if (!HAL || !HAL.jobs) return one(f, i, null);
    const h = HAL.jobs.submit({ tool: "grade", kind: "batch", title: f.name, group, groupTitle: t("grade.n.batchTitle"), lane: "cpu", host: "page", serial: "grade-gl", run: ctx => one(f, i, ctx) });
    liveBatch.add(h.id);
    if (!i && HAL.jobLaunched) HAL.jobLaunched((e && e.currentTarget) || $("#batchRun"), h, { tool: "grade" });
    return h.done.finally(() => liveBatch.delete(h.id));
  };
  const count = r => { ended++; if (r === true) done++; else if (!(r && (r.cancelled || r.name === "AbortError"))) { console.warn("lote:", r); failed++; } M.bar(bar, ended / files.length); };
  if (HAL && HAL.jobs) await Promise.all(files.map((f, i) => runOne(f, i).then(() => count(true), count)));
  else for (let i = 0; i < files.length && !batchStop; i++) { await runOne(files[i], i).then(() => count(true), count); await sleep(0); }
  if (keep) uploadSource(keep.el, keep.w, keep.h);
  else if (G.srcTex) { gl.deleteTexture(G.srcTex); G.srcTex = null; G.lastSrc = null; }   // nothing was open before the batch
  fitPreview();
  for (const l of stack) if (layerLUTs[l.id] && !G.layers.some(x => x.id === l.id)) { gl.deleteTexture(layerLUTs[l.id].tex); delete layerLUTs[l.id]; }
  G.batchRunning = false;
  M.reveal($("#batchCancel"), false); M.reveal($("#batchProg"), false); updateReady();
  const msg = t(files.length === 1 ? "grade.batchDoneOne" : "grade.batchDone", { ok: done, total: files.length }) + (failed ? " · " + t("common.withErrors", { n: failed }) : "") + (batchStop ? " · " + t("grade.batchCancelled") : "");
  setBatch(batchStop ? files.slice(done + failed) : []);
  st.className = "status " + (failed ? "warn" : "ok"); st.textContent = msg;
}
$("#batchRun").addEventListener("click", runBatch);

Object.assign(up, { renderBatchLooks });

/* ===== main ===== */
// Entry point: API for the other tabs, boot
// every module, in the order of the original script (their top-level code registers listeners)

__i18n.apply(document);
__icons.apply(document);
document.body.dataset.drop = t("grade.drop");
function applyShellSettings(st) {
  if (!st) return;
  if ([...$("#outSize").options].some(o => o.value === st.imageSize)) $("#outSize").value = st.imageSize;
  if ([...$("#outFmt").options].some(o => o.value === st.imageFormat)) $("#outFmt").value = st.imageFormat;
}
let resolveReady;
window.__halApp = {
  session: {
    capture: async () => ({ layers: clone(G.layers), crop: clone(G.crop), thumbnail: G.thumbPct, source: await HAL.session.ref(G.srcBlob, G.img.name), cut: await HAL.session.encode(G.cut), batch: await Promise.all(batch.map(f => HAL.session.ref(f))), batchLook: $("#batchLook").value, output: { size: $("#outSize").value, format: $("#outFmt").value } }),
    restore: async d => {
      const src = await HAL.session.read(d.source); if (src) await useFile(src);
      G.layers = clone(d.layers || []); G.crop = clone(d.crop || G.crop); G.thumbPct = d.thumbnail;
      if (src && d.cut) await setCut(await HAL.session.decode(d.cut));
      setBatch((await Promise.all((d.batch || []).map(r => HAL.session.read(r)))).filter(Boolean));
      $("#batchLook").value = d.batchLook || ""; $("#outSize").value = d.output.size; $("#outFmt").value = d.output.format;
      syncThumbPct(); syncCropUI(); renderLayers(); fitPreview(); rebase(); requestRender();
    }
  },
  ready: new Promise(r => { resolveReady = r; }),
  reloadPresets: reloadLooks,
  applyPreset: applyLookByName,
  reveal: revealFromHome,
  thumb: lookThumb,
  batchFiles: files => { document.querySelector('.tabs .tab[data-tab="mine"]').click(); setBatch(files); $("#batchCard").scrollIntoView({ block: "nearest" }); },
  flush: flushPersist,
  busy: () => G.batchRunning || !!(HAL && HAL.jobs && HAL.jobs.busy("grade")),
  // nothing open or running: the shell may unload the page while it is not shown (shell.js unloadIdle)
  idle: () => !G.batchRunning && !G.srcBlob,
  loadImage: (blob, name) => useFile(typeof blob.name === "string" && typeof blob.lastModified === "number" ? blob : new File([blob], name || "portada.png", { type: blob.type || "image/png" })),
  // "Send to…" (modules.js: accepts, gives): a picture opens here; the result is the edited picture at its size
  takeImage: async it => useFile(await HAL.itemFile(it)),
  result: () => renderedItem("result").then(r => r && { kind: "image", ...r })
};
if (HAL) {
  HAL.on("fonts", () => loadUploadedFonts());
  // "Use as default": this size and format start every new picture
  $("#useDefault").hidden = !HAL.setToolDefaults;
  $("#useDefault").addEventListener("click", () => {
    HAL.setToolDefaults("grade", { imageSize: $("#outSize").value, imageFormat: $("#outFmt").value });
    HAL.toast(t("common.defaultSaved"));
  });
  HAL.on("settings", applyShellSettings);
  HAL.ready.then(() => applyShellSettings(HAL.settings()));
}

/* =================== boot =================== */
function boot() {
  try { const raw = sessionStorage.getItem(LS_KEY); if (raw) applyPayload(JSON.parse(raw)); } catch (e) {}
  renderChips(); buildGrid(); buildTools(); renderLayers(); renderLooks(); syncCropUI(); syncThumbPct();
  M.autoDetails(document);
  setSync("none", t("common.loading"));
  if (!gl) { $("#stage").innerHTML = `<p class="nogl">${esc(t("grade.noGl"))}</p>`; setStatus(t("grade.st.noGl"), "bad"); connectAccount().finally(resolveReady); return; }
  try { initGL(); } catch (e) { console.error(e); setStatus(t("grade.st.glFailed", { error: e.message }), "bad"); connectAccount().finally(resolveReady); return; }
  warmPreview();
  G.hist = [stateJSON()]; G.hi = 0; updateHistButtons(); updateReady();
  fitPreview(); queueThumbs();
  for (const L of G.layers) if (L.type === "text") ensureTextFont(L.p);
  connectAccount().finally(resolveReady);
  loadUploadedFonts();
  if (window.__halFonts) window.__halFonts.then(l => {
    if (!l || !l.length) return;
    G.systemFonts = l.filter(n => !BUILTIN_FONTS.includes(n));
    refreshTextFontUI();
  });
}
boot();
