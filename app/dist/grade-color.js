// Shared colour math: no DOM, WebGL or worker dependencies.
const c01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
function hexRGB(h) { const n = parseInt(String(h).replace("#", ""), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; }
const lum = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
function mcurve(P) {
  const n = P.length, xs = P.map(p => p[0]), ys = P.map(p => p[1]), d = [], m = [];
  for (let i = 0; i < n - 1; i++) d[i] = (ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i], s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return x => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}
function contrast(x, k) {
  x = c01(x); if (!k) return x;
  if (k > 0) { const a = 1 + k * 8, f = t => 1 / (1 + Math.exp(-a * (t - 0.5))), f0 = f(0), f1 = f(1); return (f(x) - f0) / (f1 - f0); }
  return x + (0.5 - x) * (-k) * 0.75;
}
function hueMatrix(deg) {
  const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), k = (1 - c) / 3, q = Math.sqrt(1 / 3) * s;
  return [[c + k, k - q, k + q], [k + q, c + k, k - q], [k - q, k + q, c + k]];
}
function toneVec(hex) { const c = hexRGB(hex), l = lum(...c); return [c[0] - l, c[1] - l, c[2] - l]; }
function stopsAt(stops, t) {
  if (t <= stops[0][0]) return stops[0][1];
  for (let i = 0; i < stops.length - 1; i++) {
    const [a, ca] = stops[i], [b, cb] = stops[i + 1];
    if (t <= b) { const f = (t - a) / Math.max(1e-6, b - a); return [ca[0] + (cb[0] - ca[0]) * f, ca[1] + (cb[1] - ca[1]) * f, ca[2] + (cb[2] - ca[2]) * f]; }
  }
  return stops[stops.length - 1][1];
}
function makeGrader(p) {
  const C = {};
  if (p.curve) for (const k of ["m", "r", "g", "b"]) if (p.curve[k]) C[k] = mcurve(p.curve[k]);
  const sT = p.sTone && p.sTone[1] > 0 ? { v: toneVec(p.sTone[0]), a: p.sTone[1] } : null;
  const hT = p.hTone && p.hTone[1] > 0 ? { v: toneVec(p.hTone[0]), a: p.hTone[1] } : null;
  const gm = p.gmap ? p.gmap.stops.map(([s, h]) => [s, hexRGB(h)]) : null, gA = p.gmap ? (p.gmap.amt ?? 1) : 0;
  const bw = p.bw, bwn = bw ? bw[0] + bw[1] + bw[2] : 1;
  const H = p.hue ? hueMatrix(p.hue) : null;
  // Constant for every sample in this LUT, not recomputed for each RGB channel/voxel.
  const exposure = p.exp ? Math.pow(2, p.exp) : 1, con = p.con || 0;
  const slope = 1 + con * 8, floor = con > 0 ? 1 / (1 + Math.exp(slope * .5)) : 0;
  const span = con > 0 ? 1 / (1 + Math.exp(-slope * .5)) - floor : 1;
  const applyContrast = x => { x = c01(x); return con > 0 ? (1 / (1 + Math.exp(-slope * (x - .5))) - floor) / span : x + (.5 - x) * (-con) * .75; };
  return (r, g, b) => {
    if (p.temp) { r += p.temp * 0.12; b -= p.temp * 0.12; g += p.temp * 0.01; }
    if (p.tint) { g -= p.tint * 0.1; r += p.tint * 0.04; b += p.tint * 0.04; }
    if (p.exp) { r *= exposure; g *= exposure; b *= exposure; }
    if (p.sh || p.hi) { const l = c01(lum(r, g, b)); const d = (p.sh || 0) * 0.3 * Math.pow(1 - l, 3) + (p.hi || 0) * 0.3 * l * l * l; r += d; g += d; b += d; }
    if (p.crush) { const k = p.crush; r = (r - k) / (1 - k); g = (g - k) / (1 - k); b = (b - k) / (1 - k); }
    if (con) { r = applyContrast(r); g = applyContrast(g); b = applyContrast(b); }
    if (p.gamma && p.gamma !== 1) { r = Math.pow(c01(r), p.gamma); g = Math.pow(c01(g), p.gamma); b = Math.pow(c01(b), p.gamma); }
    if (C.m) { r = C.m(c01(r)); g = C.m(c01(g)); b = C.m(c01(b)); }
    if (C.r) r = C.r(c01(r)); if (C.g) g = C.g(c01(g)); if (C.b) b = C.b(c01(b));
    if (H) { const R = H[0][0] * r + H[0][1] * g + H[0][2] * b, G = H[1][0] * r + H[1][1] * g + H[1][2] * b, B = H[2][0] * r + H[2][1] * g + H[2][2] * b; r = R; g = G; b = B; }
    let s = p.sat ?? 1;
    if (p.vib) { const cs = c01(Math.max(r, g, b) - Math.min(r, g, b)); s *= 1 + p.vib * (1 - cs); }
    if (s !== 1) { const l = lum(r, g, b); r = l + (r - l) * s; g = l + (g - l) * s; b = l + (b - l) * s; }
    if (bw) { const l = (r * bw[0] + g * bw[1] + b * bw[2]) / bwn; r = g = b = l; }
    if (sT || hT) {
      const l = c01(lum(r, g, b));
      if (sT) { const w = (1 - l) * (1 - l) * sT.a * 1.3; r += sT.v[0] * w; g += sT.v[1] * w; b += sT.v[2] * w; }
      if (hT) { const w = l * l * hT.a * 1.3; r += hT.v[0] * w; g += hT.v[1] * w; b += hT.v[2] * w; }
    }
    if (gm) { const c = stopsAt(gm, c01(lum(r, g, b))); r += (c[0] - r) * gA; g += (c[1] - g) * gA; b += (c[2] - b) * gA; }
    if (p.lift) { r = p.lift + c01(r) * (1 - p.lift); g = p.lift + c01(g) * (1 - p.lift); b = p.lift + c01(b) * (1 - p.lift); }
    if (p.cap) { r = c01(r) * (1 - p.cap); g = c01(g) * (1 - p.cap); b = c01(b) * (1 - p.cap); }
    return [c01(r), c01(g), c01(b)];
  };
}

function buildLUT(parameters, size = 33) {
  const fn = makeGrader(parameters), data = new Uint8Array(size * size * size * 4); let i = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const o = fn(r / (size - 1), g / (size - 1), b / (size - 1));
    data[i++] = o[0] * 255 + .5; data[i++] = o[1] * 255 + .5; data[i++] = o[2] * 255 + .5; data[i++] = 255;
  }
  return data;
}

/* ===== looks v2 ===== */
// Looks of docs/GRADE_LOOKS_SPEC.md: a definition (data) compiled to one colour function, baked into a 33³ RGBA16F LUT.
// Fixed order (§4.1): sRGB → linear → input (white balance, exposure) → mixer → tone and curves (encoded) → OKLab:
// hsl bands, saturation, three-way zones (skin protected) → fade → gamut (hue-preserving) → sRGB. No clamp before the last step.
const s2lx = v => v < 0 ? -s2lx(-v) : v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
const l2sx = v => v < 0 ? -l2sx(-v) : v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
// Tabulated transfer functions (deterministic, linear interpolation; l2s is indexed by √v for precision near black)
const SN = 8192, S2L = new Float64Array(SN + 1), L2S = new Float64Array(SN + 1);
for (let i = 0; i <= SN; i++) { S2L[i] = s2lx(i / SN * 2); L2S[i] = l2sx((i / SN * 2) ** 2); }
const s2l = v => { if (v < 0) return -s2l(-v); const f = v * (SN / 2); if (f >= SN) return s2lx(v); const i = f | 0, u = f - i; return S2L[i] + (S2L[i + 1] - S2L[i]) * u; };
const l2s = v => { if (v < 0) return -l2s(-v); const f = Math.sqrt(v) * (SN / 2); if (f >= SN) return l2sx(v); const i = f | 0, u = f - i; return L2S[i] + (L2S[i + 1] - L2S[i]) * u; };
const smooth = (a, b, x) => { const t = c01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const OK = [0, 0, 0], RGB = [0, 0, 0];
function okLab(r, g, b, o = OK) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  o[0] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s; o[1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s; o[2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s; return o;
}
function linRGB(L, a, b, o = RGB) {
  const l = L + 0.3963377774 * a + 0.2158037573 * b, m = L - 0.1055613458 * a - 0.0638541728 * b, s = L - 0.0894841775 * a - 1.2914855480 * b;
  const l3 = l * l * l, m3 = m * m * m, s3 = s * s * s;
  o[0] = 4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3; o[1] = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3; o[2] = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.7076147010 * s3; return o;
}
const inGamut = (L, a, b) => { linRGB(L, a, b); return RGB[0] >= -1e-6 && RGB[0] <= 1 + 1e-6 && RGB[1] >= -1e-6 && RGB[1] <= 1 + 1e-6 && RGB[2] >= -1e-6 && RGB[2] <= 1 + 1e-6; };
// White balance gains in linear RGB, normalised so a white's luminance stays (temp > 0 warmer, tint > 0 magenta)
function wbGains(temp = 0, tint = 0) {
  const r = Math.pow(2, 0.42 * temp + 0.08 * tint), g = Math.pow(2, -0.22 * tint), b = Math.pow(2, -0.48 * temp + 0.08 * tint), k = 1 / (0.2126 * r + 0.7152 * g + 0.0722 * b);
  return [r * k, g * k, b * k];
}
// Hue window (degrees): 1 at the centre, 0 at ±width, cosine falloff
function hueW(h, c, w) { let d = Math.abs(h - c) % 360; if (d > 180) d = 360 - d; return d >= w ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * d / w); }
// skin: full weight within ±22° of the centre, gone at ±48° (photographed skin spans roughly 30°–75° in OKLCh)
const SKIN_H = 52;
function skinW(h) { let d = Math.abs(h - SKIN_H) % 360; if (d > 180) d = 360 - d; return d <= 22 ? 1 : d >= 48 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * (d - 22) / 26); }
// The tone curve of a look on encoded values, as a table over [0, 2] (values above 1 come from exposure or white balance)
const TN = 2048, TMAX = 2;
function toneTable(t = {}, curve) {
  const blacks = t.blacks || 0, whites = t.whites || 0, sh = t.shadows || 0, md = t.mids || 0, hl = t.highlights || 0;
  const con = t.contrast || 0, pv = t.pivot ?? 0.43, toe = t.toe || 0, shoulder = t.shoulder || 0;
  const crush = Math.max(0, -blacks), lift = Math.max(0, blacks), gain = 1 + Math.max(0, whites), top = 1 + Math.min(0, whites);
  const xs = [0, 0.12, 0.3, 0.5, 0.7, 0.88, 1], ys = [0, 0.12 + sh * 0.06, 0.3 + sh * 0.07 + md * 0.04, 0.5 + md * 0.08, 0.7 + md * 0.04 + hl * 0.07, 0.88 + hl * 0.06, 1];
  for (let i = 1; i < ys.length; i++) ys[i] = Math.max(ys[i], ys[i - 1] + 0.01);
  for (let i = ys.length - 2; i > 0; i--) ys[i] = Math.min(ys[i], ys[i + 1] - 0.01);
  const zone = mcurve(xs.map((x, i) => [x, ys[i]])), g = 1 + con * 1.4;
  const s0 = 1 - 0.38 * shoulder, H = 0.6 * shoulder, k = 1 / Math.max(1e-3, 1 - s0), norm = Math.tanh(k * (1 + H - s0));
  const out = new Float64Array(TN + 1);
  for (let i = 0; i <= TN; i++) {
    let x = i / TN * TMAX;
    x = (x - crush) / (1 - crush) * gain;
    if (x < 0) x = 0;
    // more contrast: power curves around the pivot; less contrast: a cubic that is 0 at both ends, so the slope at black
    // stays finite (a power below 1 would make the first steps from black jump)
    let y = con >= 0 ? (x <= 1 ? (x < pv ? pv * Math.pow(x / pv, g) : 1 - (1 - pv) * Math.pow((1 - x) / (1 - pv), g)) : 1 + (x - 1) * g)
      : x <= 1 ? x + con * 2.4 * (x - pv) * x * (1 - x) : 1 + (x - 1) * (1 - con * 2.4 * (1 - pv));
    y = y <= 1 ? zone(y) : y;
    if (toe > 0 && y < 0.25) { const q = 1 - y / 0.25; y += toe * 0.07 * q * q; }
    if (shoulder > 0 && y > s0) y = s0 + (1 - s0) * Math.min(1, Math.tanh(k * (y - s0)) / norm);
    y = lift + y * (top - lift);
    if (curve) y = curve(c01(y)) + (y > 1 ? y - 1 : 0);
    out[i] = y;
  }
  return out;
}
const KNEE = 0.9, KNEE_IN = 1 / KNEE;   // gamut: the chroma rolls off above 90 % of the boundary
const tab = (T, x) => { if (x <= 0) return T[0]; const f = x / TMAX * TN; if (f >= TN) return T[TN] + (x - TMAX); const i = f | 0, u = f - i; return T[i] + (T[i + 1] - T[i]) * u; };
function compileLook(def) {
  const C = def.color || {}, inp = C.input || {}, tone = C.tone || {}, cv = C.curves || {}, sat = C.sat || {}, zones = C.zones || null, fade = C.fade || {};
  const wb = wbGains(inp.temp, inp.tint), ex = Math.pow(2, inp.exposure || 0), mx = C.mixer || null;
  const curves = {}; for (const k of ["m", "r", "g", "b"]) if (cv[k]) curves[k] = mcurve(cv[k]);
  const luma = tone.mode === "luma";
  const Tm = toneTable(tone, curves.m), T = luma ? [Tm, Tm, Tm] : [0, 1, 2].map(i => { const c = curves["rgb"[i]]; if (!c) return Tm; return Tm.map(v => c(c01(v)) + (v > 1 ? v - 1 : 0)); });
  const bands = (C.hsl || []).slice(0, 8).filter(b => b.dHue || b.dSat || b.dLight);
  const sg = sat.global ?? 1, vib = sat.vibrance || 0, byL = sat.byLuma || [1, 1, 1];
  const protect = (C.skin && C.skin.protect) || 0;
  const Z = zones && ["shadows", "mids", "highlights"].map(k => { const z = zones[k] || {}, h = (z.hue || 0) * Math.PI / 180, s = (z.sat || 0) * 0.2; return [Math.cos(h) * s, Math.sin(h) * s]; });
  const zp = zones ? 0.56 + 0.14 * (zones.balance || 0) : 0, zw = zones ? 0.12 + 0.3 * (zones.blend ?? 0.5) : 0;
  const fb = fade.black || 0, fw = fade.white ?? 1, matte = fade.matte || 0;
  const soft = !C.gamut || C.gamut.soft !== false;
  // gradient map (§13): colours by lightness, stops in OKLab, mixed by `amt`; `tone` (0…1) is how much of the stops'
  // lightness is taken (0 keeps the picture's tones, only its colour changes)
  const map = C.map && Array.isArray(C.map.stops) && C.map.stops.length > 1 ? C.map.stops.map(([pos, hex]) => { const c = hexRGB(hex), o = okLab(s2l(c[0]), s2l(c[1]), s2l(c[2]), [0, 0, 0]); return [pos, o[0], o[1], o[2]]; }).sort((x, y) => x[0] - y[0]) : null;
  const mapAmt = map ? c01(C.map.amt ?? 1) : 0, mapTone = map ? c01(C.map.tone ?? 0.5) : 0;
  const needHue = bands.length || protect > 0, wbProtect = protect > 0 && (wb[0] !== 1 || wb[2] !== 1);
  return (r, g, b) => {
    r = s2l(r); g = s2l(g); b = s2l(b);
    // skin keeps its colour under the look's white balance (§3.1 skin.protect)
    let w0 = wb[0], w1 = wb[1], w2 = wb[2];
    if (wbProtect) {
      okLab(r, g, b); const c0 = Math.sqrt(OK[1] * OK[1] + OK[2] * OK[2]);
      if (c0 > 0.015) { let h0 = Math.atan2(OK[2], OK[1]) * 180 / Math.PI; if (h0 < 0) h0 += 360; const k = protect * skinW(h0) * smooth(0.015, 0.045, c0) * (1 - smooth(0.13, 0.19, c0)); w0 += (1 - w0) * k; w1 += (1 - w1) * k; w2 += (1 - w2) * k; }
    }
    r *= w0 * ex; g *= w1 * ex; b *= w2 * ex;
    if (mx) { const R = mx[0][0] * r + mx[0][1] * g + mx[0][2] * b, G = mx[1][0] * r + mx[1][1] * g + mx[1][2] * b, B = mx[2][0] * r + mx[2][1] * g + mx[2][2] * b; r = R; g = G; b = B; }
    r = l2s(r); g = l2s(g); b = l2s(b);
    let L, A, Bb;
    if (luma) {
      okLab(s2l(r), s2l(g), s2l(b)); L = OK[0]; A = OK[1]; Bb = OK[2];
      const L2 = tab(Tm, L), k = L > 1e-4 ? Math.min(1.4, Math.max(0.6, Math.sqrt(L2 / L))) : 1; L = L2; A *= k; Bb *= k;
    } else {
      r = tab(T[0], r); g = tab(T[1], g); b = tab(T[2], b);
      okLab(s2l(r), s2l(g), s2l(b)); L = OK[0]; A = OK[1]; Bb = OK[2];
    }
    let c = Math.sqrt(A * A + Bb * Bb), h = 0, skin = 0;
    if (needHue && c > 1e-5) { h = Math.atan2(Bb, A) * 180 / Math.PI; if (h < 0) h += 360; }
    if (protect > 0 && c > 1e-5) skin = protect * skinW(h) * smooth(0.015, 0.045, c) * (1 - smooth(0.13, 0.19, c));
    const keep = 1 - skin;
    if (bands.length && c > 1e-5) {
      const wc = smooth(0.008, 0.05, c); let dh = 0, ds = 0, dl = 0;
      for (const bd of bands) { const w = hueW(h, bd.hue, bd.width || 40) * wc; if (!w) continue; dh += (bd.dHue || 0) * w; ds += (bd.dSat || 0) * w; dl += (bd.dLight || 0) * w; }
      dh *= keep; ds *= keep; dl *= keep;
      if (dl) L *= 1 + dl * 0.5;
      c *= Math.max(0, 1 + ds); h += dh;
      const hr = h * Math.PI / 180; A = Math.cos(hr) * c; Bb = Math.sin(hr) * c;
    }
    const lz = c01(L), ws = 1 - smooth(0.25, 0.55, lz), wh = smooth(0.66, 0.92, lz), wm = Math.max(0, 1 - ws - wh);
    let f = sg * (ws * byL[0] + wm * byL[1] + wh * byL[2]);
    if (vib) f *= 1 + vib * (1 - smooth(0, 0.16, c)) * (vib > 0 ? 1 - 0.7 * skin : 1);
    f = 1 + (f - 1) * (f > 1 ? keep : 1 - 0.5 * skin);
    A *= f; Bb *= f;
    if (Z) {
      // the tint scales with lightness (a constant colourfulness, not a constant offset): dark pictures are not
      // flooded with it and blacks stay clean
      const zs = 1 - smooth(zp - zw, zp, lz), zh = smooth(zp, zp + zw, lz), zm = Math.max(0, 1 - zs - zh), k = keep * keep * Math.min(1, lz / 0.55);   // tints spare skin more than hsl does
      A += (Z[0][0] * zs + Z[1][0] * zm + Z[2][0] * zh) * k; Bb += (Z[0][1] * zs + Z[1][1] * zm + Z[2][1] * zh) * k;
    }
    if (map) {
      const x = c01(L); let i = 0; while (i < map.length - 2 && x > map[i + 1][0]) i++;
      const p0 = map[i], p1 = map[i + 1], u = c01((x - p0[0]) / Math.max(1e-6, p1[0] - p0[0]));
      const mL = p0[1] + (p1[1] - p0[1]) * u, ma = p0[2] + (p1[2] - p0[2]) * u, mb = p0[3] + (p1[3] - p0[3]) * u;
      A += (ma - A) * mapAmt; Bb += (mb - Bb) * mapAmt; L += (mL - L) * mapAmt * mapTone;
    }
    linRGB(L, A, Bb); r = l2s(RGB[0]); g = l2s(RGB[1]); b = l2s(RGB[2]);
    if (matte) { const m = v => v < 0.35 ? v + matte * 0.09 * (1 - v / 0.35) * (1 - v / 0.35) : v; r = m(r); g = m(g); b = m(b); }
    if (fb || fw !== 1) { r = fb + r * (fw - fb); g = fb + g * (fw - fb); b = fb + b * (fw - fb); }
    okLab(s2l(r), s2l(g), s2l(b)); L = OK[0] < 0 ? 0 : OK[0] > 1 ? 1 : OK[0]; A = OK[1]; Bb = OK[2];
    c = Math.sqrt(A * A + Bb * Bb);
    if (c > 1e-6) {
      // out of gamut: the chroma comes down to the boundary at the same lightness and hue (in-gamut colours untouched)
      // near the boundary the chroma rolls off (knee at 90 % of the boundary), so saturated areas keep their texture
      // instead of flattening against it; colours well inside the gamut are untouched
      if (soft && !inGamut(L, A * KNEE_IN, Bb * KNEE_IN)) {
        let lo = 0, hi = 4;
        for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (inGamut(L, A * mid, Bb * mid)) lo = mid; else hi = mid; }
        const cm = c * lo, k = KNEE * cm, c2 = cm < 1e-6 ? 0 : c <= k ? c : k + (cm - k) * Math.tanh((c - k) / (cm - k));
        A *= c2 / c; Bb *= c2 / c;
      }
    }
    linRGB(L, A, Bb);
    return [c01(l2s(RGB[0])), c01(l2s(RGB[1])), c01(l2s(RGB[2]))];
  };
}
// float32 → IEEE half (round to nearest even), for RGBA16F uploads
const F32 = new Float32Array(1), U32 = new Uint32Array(F32.buffer);
function half(v) {
  F32[0] = v; const x = U32[0], sign = (x >>> 16) & 0x8000, e = (x >>> 23) & 0xff, m = x & 0x7fffff;
  if (e < 103) return sign;
  if (e > 142) return sign | 0x7c00;
  if (e < 113) { const mm = m | 0x800000, sh = 126 - e, r = mm >>> sh, rem = mm & ((1 << sh) - 1), hb = 1 << (sh - 1); return sign | (r + (rem > hb || (rem === hb && (r & 1)) ? 1 : 0)); }
  let hv = ((e - 112) << 10) | (m >>> 13); const rem = m & 0x1fff;
  if (rem > 0x1000 || (rem === 0x1000 && (hv & 1))) hv++;
  return sign | hv;
}
function buildLookLUT(def, size = 33) {
  const fn = compileLook(def), data = new Uint16Array(size * size * size * 4), one = half(1); let i = 0;
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const o = fn(r / (size - 1), g / (size - 1), b / (size - 1));
    data[i++] = half(o[0]); data[i++] = half(o[1]); data[i++] = half(o[2]); data[i++] = one;
  }
  return data;
}
export { contrast, hueMatrix, makeGrader, mcurve, stopsAt, toneVec, buildLUT, compileLook, buildLookLUT, okLab, linRGB, wbGains, s2l, l2s, half };
