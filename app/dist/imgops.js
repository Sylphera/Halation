// Image helpers shared by the Crop and Cutout services and the tools that use them: window.__img.
// A classic script so the main window, the inline pages and the ES modules use the same copy.
//
// Crop parameters are stored on the original, never on a cropped copy, so a crop can be edited again later with
// the original's quality: { cx, cy, w, h, a, ratio }
//   cx, cy  centre of the crop, as a fraction of the original's width and height
//   w, h    size of the crop, as a fraction of the original's width and height
//   a       rotation in degrees (−45…45): the picture turns clockwise inside the crop
//   ratio   the ratio the crop was made with ("free", "orig", "16:9", "1:1"…); informative
// Masks (Cutout) are canvases the size of the original whose alpha is the subject (saved as grey PNGs, white =
// subject; maskFrom reads one back): a crop cuts the mask too.
(() => {
"use strict";
const RATIOS = { "16:9": 16 / 9, "9:16": 9 / 16, "1:1": 1, "4:5": 4 / 5, "3:1": 3 };
const rad = d => d * Math.PI / 180;
const mk = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };

// A Blob or File from any window (instanceof fails on one made in another frame of the app)
const isBlob = v => !!v && /^\[object (Blob|File)\]$/.test(Object.prototype.toString.call(v));
function load(src) {
  return new Promise((res, rej) => {
    const url = isBlob(src) ? URL.createObjectURL(src) : src, i = new Image();
    i.onload = () => { i.__url = url; res(i); };
    i.onerror = () => { if (isBlob(src)) URL.revokeObjectURL(url); rej(new Error("image")); };
    i.decoding = "async"; i.src = url;
  });
}
const size = img => [img.naturalWidth || img.videoWidth || img.width, img.naturalHeight || img.videoHeight || img.height];
async function hash(blob) {
  const d = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return Array.from(new Uint8Array(d), b => b.toString(16).padStart(2, "0")).join("");
}
const toBlob = (c, type = "image/png", q = 0.95) => new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error("encode")), type, q));
// "1:1" → 1, "orig" → the image's own, "free" or unknown → null
function ratioValue(ratio, iw, ih) {
  if (typeof ratio === "number" && ratio > 0) return ratio;
  if (ratio === "orig") return iw / ih;
  return RATIOS[ratio] || null;
}

/* ---------- crop geometry ---------- */
const full = () => ({ cx: 0.5, cy: 0.5, w: 1, h: 1, a: 0, ratio: "orig" });
const ratioOf = (p, iw, ih) => (p.w * iw) / (p.h * ih);
// The image already has the ratio (within 0.5 %): no crop is needed
const fits = (iw, ih, r) => !r || Math.abs(iw / ih / r - 1) < 0.005;
// Bounding box, in pixels, of a W×H crop turned by a
function bbox(W, H, a) { const c = Math.abs(Math.cos(rad(a))), s = Math.abs(Math.sin(rad(a))); return [W * c + H * s, W * s + H * c]; }
// Largest width of a crop of ratio r turned by a that fits inside the image
function maxWidth(iw, ih, r, a) { const c = Math.abs(Math.cos(rad(a))), s = Math.abs(Math.sin(rad(a))); return Math.min(iw / (c + s / r), ih / (s + c / r)); }
// Keeps the crop inside the picture: smaller if it cannot fit at this angle, then moved back inside
function clampCrop(p, iw, ih, minPx = 16) {
  let W = p.w * iw, H = p.h * ih;
  const r = W / H, mw = maxWidth(iw, ih, r, p.a);
  if (W > mw) { W = mw; H = W / r; }
  if (Math.min(W, H) < minPx) { const k = minPx / Math.min(W, H); W *= k; H *= k; }
  const [bw, bh] = bbox(W, H, p.a);
  const cx = Math.min(Math.max(p.cx * iw, bw / 2), iw - bw / 2), cy = Math.min(Math.max(p.cy * ih, bh / 2), ih - bh / 2);
  return { ...p, cx: cx / iw, cy: cy / ih, w: W / iw, h: H / ih };
}
// The largest crop of ratio r (null: the whole picture) centred on focus ({x, y} as fractions)
function centered(iw, ih, ratio, focus) {
  const r = ratioValue(ratio, iw, ih);
  if (!r) return { ...full(), ratio: ratio || "orig" };
  const W = Math.min(iw, ih * r), H = W / r;
  return clampCrop({ cx: focus ? focus.x : 0.5, cy: focus ? focus.y : 0.5, w: W / iw, h: H / ih, a: 0, ratio }, iw, ih);
}
// Output pixel size of a crop
const outSize = (p, iw, ih) => [Math.max(1, Math.round(p.w * iw)), Math.max(1, Math.round(p.h * ih))];
const isFull = p => !p || (Math.abs(p.w - 1) < 1e-4 && Math.abs(p.h - 1) < 1e-4 && Math.abs(p.a) < 1e-3);
// Point of the source (pixels) under an output point (x, y in pixels of the crop)
function toSource(p, iw, ih, x, y) {
  const W = p.w * iw, H = p.h * ih, t = rad(-p.a), dx = x - W / 2, dy = y - H / 2;
  return [p.cx * iw + dx * Math.cos(t) - dy * Math.sin(t), p.cy * ih + dx * Math.sin(t) + dy * Math.cos(t)];
}
// Draws the crop of `img` on a new canvas, at most maxSide pixels on its longer side. mask: cuts the picture out first.
function render(img, p, o = {}) {
  const [iw, ih] = size(img), q = p || full(), [W, H] = outSize(q, iw, ih);
  const k = o.maxSide ? Math.min(1, o.maxSide / Math.max(W, H)) : 1, c = mk(W * k, H * k), x = c.getContext("2d", o.readback ? { willReadFrequently: true } : undefined);
  x.imageSmoothingQuality = "high";
  x.translate(c.width / 2, c.height / 2); x.scale(c.width / W, c.height / H); x.rotate(rad(q.a)); x.translate(-q.cx * iw, -q.cy * ih);
  x.drawImage(o.mask ? masked(img, o.mask) : img, 0, 0, iw, ih);
  return c;
}
function sameCrop(a, b) { return !!a && !!b && ["cx", "cy", "w", "h", "a"].every(k => Math.abs(a[k] - b[k]) < 1e-6); }
function validCrop(p) { return !!p && ["cx", "cy", "w", "h", "a"].every(k => typeof p[k] === "number" && isFinite(p[k])) && p.w > 0 && p.h > 0 && Math.abs(p.a) <= 45; }
// The crop in the coordinates Grade's shader takes: centre and size as fractions, angle in radians
const shaderCrop = p => ({ c: [p.cx, p.cy], s: [p.w, p.h], a: rad(p.a) });

/* ---------- masks ---------- */
// The picture with the mask's alpha (mask: image or canvas, any size: it is stretched over the picture)
function masked(img, mask) {
  const [iw, ih] = size(img), c = mk(iw, ih), x = c.getContext("2d");
  x.drawImage(img, 0, 0, iw, ih);
  x.globalCompositeOperation = "destination-in"; x.imageSmoothingQuality = "high";
  x.drawImage(mask, 0, 0, iw, ih);
  return c;
}
// A grey picture (white = subject) → a canvas whose alpha is that grey, at w×h
function alphaFromGrey(src, w, h) {
  const c = mk(w, h), x = c.getContext("2d", { willReadFrequently: true });
  x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, c.width, c.height);
  const d = x.getImageData(0, 0, c.width, c.height), a = d.data;
  for (let i = 0; i < a.length; i += 4) { a[i + 3] = a[i]; a[i] = a[i + 1] = a[i + 2] = 255; }
  x.putImageData(d, 0, 0);
  return c;
}
// The other way: an alpha mask → an opaque grey picture (what is saved as a mask PNG)
function greyFromAlpha(mask) {
  const [w, h] = size(mask), c = mk(w, h), x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(mask, 0, 0, w, h);
  const d = x.getImageData(0, 0, c.width, c.height), a = d.data;
  for (let i = 0; i < a.length; i += 4) { a[i] = a[i + 1] = a[i + 2] = a[i + 3]; a[i + 3] = 255; }
  x.putImageData(d, 0, 0);
  return c;
}
// Centre of the subject of an alpha mask ({x, y} as fractions), or null when it is empty
// A saved mask (grey PNG Blob, white = subject) → an alpha canvas at w×h
async function maskFrom(blob, w, h) {
  const g = await load(blob), c = alphaFromGrey(g, w || size(g)[0], h || size(g)[1]);
  URL.revokeObjectURL(g.__url);
  return c;
}
// Canvas-only mask refinement, shared with the Cutout service and Background Remover's worker.
function blurAlpha(src, sigma) {
  const w = src.width, h = src.height, p = Math.ceil(sigma * 3), c = mk(w + 2 * p, h + 2 * p), x = c.getContext("2d");
  x.drawImage(src, p, p);
  x.drawImage(src, 0, 0, w, 1, p, 0, w, p); x.drawImage(src, 0, h - 1, w, 1, p, h + p, w, p);
  x.drawImage(c, p, 0, 1, h + 2 * p, 0, 0, p, h + 2 * p); x.drawImage(c, w + p - 1, 0, 1, h + 2 * p, w + p, 0, p, h + 2 * p);
  const o = mk(w, h), ox = o.getContext("2d");
  ox.filter = `blur(${sigma}px)`; ox.drawImage(c, -p, -p); ox.filter = "none";
  return o;
}
function refineMask(mask, { shift = 0, feather = 0 } = {}) {
  let m = mask;
  if (Math.abs(shift) >= 0.25) {
    const b = blurAlpha(m, Math.abs(shift) / 0.674), x = b.getContext("2d", { willReadFrequently: true });
    const d = x.getImageData(0, 0, b.width, b.height), a = d.data, at = shift > 0 ? 64 : 191;
    for (let i = 3; i < a.length; i += 4) a[i] = Math.max(0, Math.min(255, (a[i] - at) * 4 + 128));
    x.putImageData(d, 0, 0); m = b;
  }
  if (feather >= 0.25) m = blurAlpha(m, feather);
  return m;
}
// SAM's 256 × 256 mask logits stretched to W × H (bilinear, pixel centres: F.interpolate with align_corners=False)
function upLogits(l, W, H, n = 256) {
  const out = new Float32Array(W * H), sx = n / W, sy = n / H;
  for (let y = 0; y < H; y++) {
    const fy = Math.min(n - 1, Math.max(0, (y + 0.5) * sy - 0.5)), y0 = Math.floor(fy), y1 = Math.min(n - 1, y0 + 1), wy = fy - y0;
    for (let x = 0; x < W; x++) {
      const fx = Math.min(n - 1, Math.max(0, (x + 0.5) * sx - 0.5)), x0 = Math.floor(fx), x1 = Math.min(n - 1, x0 + 1), wx = fx - x0;
      const a = l[y0 * n + x0] + (l[y0 * n + x1] - l[y0 * n + x0]) * wx, b = l[y1 * n + x0] + (l[y1 * n + x1] - l[y1 * n + x0]) * wx;
      out[y * W + x] = a + (b - a) * wy;
    }
  }
  return out;
}
// Box mean of a W × H plane, radius r (clamped at the borders), two running sums
function boxMean(src, W, H, r) {
  const tmp = new Float32Array(W * H), out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const o = y * W; let s = 0;
    for (let x = -r; x <= r; x++) s += src[o + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[o + x] = s / (2 * r + 1);
      s += src[o + Math.min(W - 1, x + r + 1)] - src[o + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = s / (2 * r + 1);
      s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}
// Edge refinement with the picture as guide (He et al., the colour guided filter): the mask p (0…1) follows the
// picture's edges within r pixels. The guide is softened first (smooth: box radius) so film grain and filter noise
// do not stick to the edge, and eps (in 0…1 intensities squared) keeps variations below it flat. Only the band near
// the edge changes; solid subject and background stay as they are.
function guidedAlpha(rgba, W, H, p, { r = 6, eps = 4e-3, smooth = 1 } = {}) {
  const N = W * H, ch = [0, 1, 2].map(c => { const v = new Float32Array(N); for (let i = 0; i < N; i++) v[i] = rgba[i * 4 + c] / 255; return smooth > 0 ? boxMean(v, W, H, smooth) : v; });
  const [I0, I1, I2] = ch, m = c => boxMean(c, W, H, r);
  const mP = m(p), m0 = m(I0), m1 = m(I1), m2 = m(I2), prod = (a, b) => { const v = new Float32Array(N); for (let i = 0; i < N; i++) v[i] = a[i] * b[i]; return v; };
  const p0 = m(prod(I0, p)), p1 = m(prod(I1, p)), p2 = m(prod(I2, p));
  const v00 = m(prod(I0, I0)), v01 = m(prod(I0, I1)), v02 = m(prod(I0, I2)), v11 = m(prod(I1, I1)), v12 = m(prod(I1, I2)), v22 = m(prod(I2, I2));
  const A0 = new Float32Array(N), A1 = new Float32Array(N), A2 = new Float32Array(N), B = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const c0 = p0[i] - m0[i] * mP[i], c1 = p1[i] - m1[i] * mP[i], c2 = p2[i] - m2[i] * mP[i];
    const a = v00[i] - m0[i] * m0[i] + eps, b = v01[i] - m0[i] * m1[i], c = v02[i] - m0[i] * m2[i];
    const d = v11[i] - m1[i] * m1[i] + eps, e = v12[i] - m1[i] * m2[i], f = v22[i] - m2[i] * m2[i] + eps;
    // the inverse of the symmetric 3 × 3 covariance (+ eps) times the covariance of guide and mask
    const i00 = d * f - e * e, i01 = c * e - b * f, i02 = b * e - c * d, i11 = a * f - c * c, i12 = b * c - a * e, i22 = a * d - b * b;
    const det = a * i00 + b * i01 + c * i02 || 1e-12;
    const x0 = (i00 * c0 + i01 * c1 + i02 * c2) / det, x1 = (i01 * c0 + i11 * c1 + i12 * c2) / det, x2 = (i02 * c0 + i12 * c1 + i22 * c2) / det;
    A0[i] = x0; A1[i] = x1; A2[i] = x2; B[i] = mP[i] - x0 * m0[i] - x1 * m1[i] - x2 * m2[i];
  }
  const a0 = m(A0), a1 = m(A1), a2 = m(A2), b = m(B), out = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    if (mP[i] <= 0.001 || mP[i] >= 0.999) { out[i] = p[i]; continue; }
    const q = a0[i] * I0[i] + a1[i] * I1[i] + a2[i] * I2[i] + b[i];
    out[i] = q < 0 ? 0 : q > 1 ? 1 : q;
  }
  return out;
}
function focusOf(mask) {
  const c = mk(64, 64), x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(mask, 0, 0, 64, 64);
  const a = x.getImageData(0, 0, 64, 64).data;
  let sx = 0, sy = 0, n = 0;
  for (let i = 3, k = 0; i < a.length; i += 4, k++) { const v = a[i] / 255; sx += (k % 64 + 0.5) * v; sy += (Math.floor(k / 64) + 0.5) * v; n += v; }
  return n > 4 ? { x: sx / n / 64, y: sy / n / 64 } : null;
}

window.__img = { RATIOS, isBlob, load, size, hash, toBlob, mk, ratioValue, full, ratioOf, fits, bbox, maxWidth, clampCrop, centered, outSize, isFull,
  toSource, render, sameCrop, validCrop, shaderCrop, masked, alphaFromGrey, greyFromAlpha, maskFrom, focusOf, blurAlpha, refineMask,
  upLogits, boxMean, guidedAlpha };
})();
