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
export { contrast, hueMatrix, makeGrader, mcurve, stopsAt, toneVec, buildLUT };
