// Visualizer: the whole tab in one ES module.
import { bassRaw as rawOf, bassEnv as envOf } from './bass.js';
import * as MB from './mediabunny.js';

/* ===== util ===== */
// Helpers shared by the Visualizer modules

// Interface colours for the canvases (timeline), read from tokens.css
const tok = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
/* ---------- helpers ---------- */
const { $, clamp, mk, clone, sleep, esc, cap, setStatus, saveFile: saveFile_util, retryLabel } = window.__ui;   // common.js
const fmtTime = (s, dec = true) => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); const r = s - m * 60; return m + ":" + (dec ? r.toFixed(1).padStart(4, "0") : String(Math.floor(r)).padStart(2, "0")); };
const LS_KEY = "halation-visualizer-v1";
const HAL = window.__hal || null;
const IMG = window.__img;
const M = window.__motion;

/* ===== schema ===== */
// Settings schema: groups, fields and defaults

/* ---------- settings schema ---------- */
const FORMATS = {
  "1920x1080": t("vis.fmt.1920x1080"),
  "3840x2160": t("vis.fmt.3840x2160"),
  "2560x1440": t("vis.fmt.2560x1440"),
  "1280x720": t("vis.fmt.1280x720"),
  "1080x1920": t("vis.fmt.1080x1920"),
  "1080x1350": t("vis.fmt.1080x1350"),
  "1080x1080": t("vis.fmt.1080x1080")
};
const WEIGHTS = ["300", "400", "500", "600", "700", "800"].map(w => [w, t("weight." + w)]);
const optList = (k, values) => values.map(v => [v, t(`vis.o.${k}.${v}`)]);
const GROUPS = [
  // shown in the main column under the sources, not in the side panel
  { id: "out", title: t("vis.g.out"), main: true, fields: [
    { k: "format", type: "select", label: t("vis.f.format"), options: Object.entries(FORMATS) },
    { k: "fps", type: "select", label: t("vis.f.fps"), options: ["24", "30", "60"].map(v => [v, t("vis.fps", { n: v })]) },
    { k: "quality", type: "select", label: t("vis.f.quality"), options: optList("quality", ["low", "std", "high"]) },
    { k: "clipStart", type: "number", session: true, label: t("vis.f.clipStart"), min: 0, step: 0.1 },
    { k: "clipLen", type: "number", session: true, label: t("vis.f.clipLen"), min: 0, step: 0.1 },
    { type: "button", id: "clipHere", label: t("vis.f.clipHere") }
  ]},
  { id: "cover", title: t("vis.g.cover"), open: true, fields: [
    { k: "coverSize", label: t("vis.f.size"), min: 15, max: 95, step: 1, unit: "%" },
    { k: "radius", label: t("vis.f.radius"), min: 0, max: 50, step: 0.5, unit: "%" },
    { k: "smooth", label: t("vis.f.smooth"), min: 0, max: 100, step: 1, unit: "%" },
    { type: "row", fields: [
      { k: "coverX", label: t("vis.f.coverX"), min: -40, max: 40, step: 0.5, unit: "%" },
      { k: "coverY", label: t("vis.f.coverY"), min: -40, max: 40, step: 0.5, unit: "%" }
    ]},
    { k: "shadowOpacity", label: t("vis.f.shadowOpacity"), min: 0, max: 100, step: 1, unit: "%" },
    { type: "row", fields: [
      { k: "shadowBlur", label: t("vis.f.shadowBlur"), min: 0, max: 200, step: 1, unit: "px" },
      { k: "shadowY", label: t("vis.f.shadowY"), min: 0, max: 100, step: 1, unit: "px" }
    ]},
    { k: "glow", label: t("vis.f.glow"), min: 0, max: 100, step: 1, unit: "%" },
    { k: "coverCut", type: "toggle", label: t("vis.f.coverCut") },
    { k: "popOut", label: t("vis.f.popOut"), min: 0, max: 30, step: 0.5, unit: "%" },
    { type: "row", fields: [
      { k: "borderWidth", label: t("vis.f.borderWidth"), min: 0, max: 8, step: 0.5, unit: "px" },
      { k: "borderOpacity", label: t("vis.f.borderOpacity"), min: 0, max: 100, step: 1, unit: "%" }
    ]}
  ]},
  { id: "bg", title: t("vis.g.bg"), open: true, fields: [
    { k: "bgBlur", label: t("vis.f.bgBlur"), min: 0, max: 200, step: 1, unit: "px" },
    { k: "bgZoom", label: t("vis.f.bgZoom"), min: 100, max: 300, step: 1, unit: "%" },
    { type: "row", fields: [
      { k: "bgBrightness", label: t("vis.f.bgBrightness"), min: 20, max: 200, step: 1, unit: "%" },
      { k: "bgSaturation", label: t("vis.f.bgSaturation"), min: 0, max: 250, step: 1, unit: "%" }
    ]},
    { k: "bgDarken", label: t("vis.f.bgDarken"), min: 0, max: 90, step: 1, unit: "%" },
    { k: "tintColor", type: "color", label: t("vis.f.tintColor") },
    { k: "tintAmount", label: t("vis.f.tintAmount"), min: 0, max: 100, step: 1, unit: "%" }
  ]},
  { id: "bass", title: t("vis.g.bass"), open: false, fields: [
    { k: "bassOn", type: "toggle", label: t("vis.f.bassOn") },
    { k: "bassCutoff", label: t("vis.f.bassCutoff"), min: 40, max: 250, step: 1, unit: "Hz", sub: t("vis.f.bassCutoff.sub") },
    { type: "row", fields: [
      { k: "sensitivity", label: t("vis.f.sensitivity"), min: 0, max: 250, step: 1, unit: "%" },
      { k: "threshold", label: t("vis.f.threshold"), min: 0, max: 90, step: 1, unit: "%" }
    ]},
    { type: "row", fields: [
      { k: "attack", label: t("vis.f.attack"), min: 0, max: 200, step: 1, unit: "ms" },
      { k: "release", label: t("vis.f.release"), min: 20, max: 1000, step: 5, unit: "ms" }
    ]},
    { k: "bgPulse", label: t("vis.f.bgPulse"), min: 0, max: 30, step: 0.5, unit: "%" },
    { k: "bgFlash", label: t("vis.f.bgFlash"), min: 0, max: 100, step: 1, unit: "%" },
    { k: "coverPulse", label: t("vis.f.coverPulse"), min: 0, max: 15, step: 0.1, unit: "%" },
    { k: "glowPulse", label: t("vis.f.glowPulse"), min: 0, max: 100, step: 1, unit: "%" },
    { k: "shake", label: t("vis.f.shake"), min: 0, max: 30, step: 0.5, unit: "px" }
  ]},
  { id: "text", title: t("vis.g.text"), open: false, fields: [
    { k: "textOn", type: "toggle", label: t("vis.f.textOn") },
    { k: "title", type: "text", session: true, label: t("vis.f.title"), placeholder: t("vis.f.title.ph") },
    { k: "artist", type: "text", label: t("vis.f.artist"), placeholder: t("vis.defaultArtist") },
    { k: "textPos", type: "select", label: t("vis.f.textPos"), options: optList("textPos", ["below", "above", "bottomleft", "bottomcenter"]) },
    { type: "caption", label: t("vis.cap.title") },
    { k: "titleFont", type: "font", label: t("vis.f.titleFont") },
    { k: "titleSys", type: "text", label: t("vis.f.sysFont"), placeholder: t("vis.f.titleSys.ph"), sysFor: "titleFont" },
    { type: "row", fields: [
      { k: "titleWeight", type: "select", label: t("vis.f.weight"), options: WEIGHTS },
      { k: "titleSize", label: t("vis.f.size"), min: 10, max: 120, step: 1, unit: "px" }
    ]},
    { type: "caption", label: t("vis.cap.artist") },
    { k: "artistFont", type: "font", label: t("vis.f.artistFont") },
    { k: "artistSys", type: "text", label: t("vis.f.sysFont"), placeholder: t("vis.f.artistSys.ph"), sysFor: "artistFont" },
    { type: "row", fields: [
      { k: "artistWeight", type: "select", label: t("vis.f.weight"), options: WEIGHTS },
      { k: "artistSize", label: t("vis.f.size"), min: 8, max: 100, step: 1, unit: "px" }
    ]},
    { type: "row", fields: [
      { k: "artistSpacing", label: t("vis.f.artistSpacing"), min: -10, max: 80, step: 1, unit: "%" },
      { k: "lineGap", label: t("vis.f.lineGap"), min: 0, max: 80, step: 1, unit: "px" }
    ]},
    { k: "artistUpper", type: "toggle", label: t("vis.f.artistUpper") },
    { type: "caption", label: t("vis.cap.color") },
    { k: "textColor", type: "color", label: t("vis.f.textColor") },
    { k: "textOpacity", label: t("vis.f.textOpacity"), min: 10, max: 100, step: 1, unit: "%" },
    { type: "caption", label: t("vis.cap.fonts") },
    { type: "fontlib" }
  ]},
  { id: "logo", title: t("vis.g.logo"), open: false, fields: [
    { k: "logoOn", type: "toggle", label: t("vis.f.logoOn") },
    { k: "logoStyle", type: "select", label: t("vis.f.logoStyle"), options: optList("logoStyle", ["note", "custom"]) },
    { type: "logolib" },
    { type: "row", fields: [
      { k: "logoSide", type: "select", label: t("vis.f.logoSide"), options: optList("logoSide", ["left", "right"]) },
      { k: "logoDir", type: "select", label: t("vis.f.logoDir"), options: optList("logoDir", ["cw", "ccw"]) }
    ]},
    { type: "row", fields: [
      { k: "logoSize", label: t("vis.f.logoSize"), min: 30, max: 500, step: 1, unit: "%" },
      { k: "logoGap", label: t("vis.f.logoGap"), min: 0, max: 100, step: 1, unit: "px" }
    ]},
    { k: "logoRpm", label: t("vis.f.logoRpm"), min: 0, max: 45, step: 0.5, unit: "rpm" },
    { k: "logoPulse", label: t("vis.f.logoPulse"), min: 0, max: 25, step: 0.5, unit: "%" }
  ]},
  { id: "finish", title: t("vis.g.finish"), open: false, fields: [
    { k: "vignette", label: t("vis.f.vignette"), min: 0, max: 100, step: 1, unit: "%" },
    { k: "grain", label: t("vis.f.grain"), min: 0, max: 40, step: 1, unit: "%" },
    { type: "row", fields: [
      { k: "fadeIn", label: t("vis.f.fadeIn"), min: 0, max: 5, step: 0.1, unit: "s" },
      { k: "fadeOut", label: t("vis.f.fadeOut"), min: 0, max: 5, step: 0.1, unit: "s" }
    ]},
    { k: "audioFades", type: "toggle", label: t("vis.f.audioFades") }
  ]}
];
const DEFAULTS = {
  format: "1920x1080", fps: "30", quality: "std",
  coverSize: 52, radius: 10, smooth: 60, coverX: 0, coverY: 0,
  shadowOpacity: 55, shadowBlur: 70, shadowY: 24, glow: 0, coverCut: false, popOut: 8, borderWidth: 0, borderOpacity: 25,
  bgBlur: 55, bgZoom: 130, bgBrightness: 95, bgSaturation: 125, bgDarken: 25, tintColor: "#1d3f8f", tintAmount: 0,
  bassOn: true, bassCutoff: 110, sensitivity: 100, threshold: 30, attack: 8, release: 220,
  bgPulse: 6, bgFlash: 30, coverPulse: 1.5, glowPulse: 0, shake: 0,
  textOn: false, artist: t("vis.defaultArtist"), textPos: "below",
  titleFont: "g:Unbounded", titleSys: "", titleWeight: "600", titleSize: 34,
  artistFont: "g:Hanken Grotesk", artistSys: "", artistWeight: "400", artistSize: 22, artistSpacing: 8, lineGap: 10, artistUpper: false,
  textColor: "#ffffff", textOpacity: 92,
  logoOn: false, logoStyle: "note", logoAsset: "", logoSide: "left", logoDir: "cw", logoSize: 130, logoGap: 22, logoRpm: 12, logoPulse: 0,
  vignette: 40, grain: 6, fadeIn: 0.8, fadeOut: 1.5, audioFades: false
};
const FIELD = {};
(function index(list) { for (const f of list) { if (f.fields) index(f.fields); else if (f.k) FIELD[f.k] = f; } })(GROUPS);

/* ===== state ===== */
// Shared state: settings, media, flags, and the render snapshot

/* ---------- fonts ---------- */
const BUILTIN_FONTS = ["Unbounded", "Hanken Grotesk", "Syne", "Michroma", "Cinzel", "UnifrakturCook", "JetBrains Mono"];
let fontLib = [];
let sysFonts = [];
const sysOpts = () => sysFonts.length ? `<optgroup label="${esc(t("fonts.system"))}">${sysFonts.map(n => `<option value="u:${esc(n)}">${esc(n)}</option>`).join("")}</optgroup>` : "";            // [{id, family, file, local?, missing?}]
const loadedFamilies = new Set();
function fontFamilyCSS(val, sys) {
  let name = "Hanken Grotesk";
  if (val === "s") name = (sys || "").replace(/["\\]/g, "").trim() || "Hanken Grotesk";
  else if (typeof val === "string" && val.length > 2) name = val.slice(2);
  return `"${name}", "Hanken Grotesk", sans-serif`;
}
function fontOptionsHTML() {
  const g = BUILTIN_FONTS.map(n => `<option value="g:${esc(n)}">${esc(n)}</option>`).join("");
  const u = fontLib.map(f => `<option value="u:${esc(f.family)}">${esc(f.family)}</option>`).join("");
  return `<optgroup label="${esc(t("fonts.builtin"))}">${g}</optgroup>${u ? `<optgroup label="${esc(t("fonts.uploaded"))}">${u}</optgroup>` : ""}${sysOpts()}<optgroup label="${esc(t("fonts.other"))}"><option value="s">${esc(t("fonts.typeName"))}</option></optgroup>`;
}
function systemFontAvailable(name) {
  name = (name || "").trim(); if (!name) return null;
  const x = mk(10, 10).getContext("2d"), probe = "mmmmmmmmmmlliWWQ@0O#";
  return ["monospace", "serif", "sans-serif"].some(b => {
    x.font = `72px ${b}`; const w0 = x.measureText(probe).width;
    x.font = `72px "${name.replace(/"/g, "")}", ${b}`; return x.measureText(probe).width !== w0;
  });
}

let S = clone(DEFAULTS);
let presets = {};
const session = { clipStart: 0, clipLen: 0, title: "" };

/* ---------- media state ---------- */
// src: the original picture; crop: its 1:1 crop (imgops.js); mask: the Cutout mask on the original, or null.
// img: the crop drawn (what the renderer reads); cut: the same crop of the cut-out subject, or null
const art = { img: null, cut: null, src: null, crop: null, mask: null, edit: null, name: "", avg: [120, 150, 220], ver: 0 };
const aud = { buffer: null, url: "", name: "", duration: 0 };
const bass = { raw: null, p: 1, env: null, rate: 100, ver: 0 };
const logo = { img: null, id: "", name: "", local: false, ver: 0 };
const audioEl = new Audio();
audioEl.preload = "auto";
// Flags and lists several modules change
const V = { playing: false, seekTime: 0, needsDraw: true, exporting: false, exports: 0, cancelFlag: false, lastExport: null, queueRunning: false, jobs: [], live: new Set() };
// Functions of higher modules that lower ones call (registered by each module when it loads)
const up = {};

/* ---------- render snapshot ----------
   Everything the renderer reads lives in R. The preview builds a live R each frame;
   an export builds one frozen copy when it starts, so later edits never reach the file. */
function liveR() {
  return { S, ses: session, art, env: bass.env, rate: bass.rate, logo, clip: clipBounds(session, aud.duration) };
}
function frozenR() {
  return {
    S: clone(S), ses: clone(session),
    art: { img: art.img, cut: art.cut, avg: art.avg.slice(), ver: art.ver },
    env: bass.env, rate: bass.rate,
    logo: { img: logo.img, ver: logo.ver },
    clip: clipBounds(session, aud.duration), codecs: { ...CODEC }, encoder: HAL ? HAL.settings().encoder : "auto"
  };
}
function clipBounds(ses, dur) {
  dur = dur || 0;
  const start = clamp(ses.clipStart || 0, 0, Math.max(0, dur - 0.1));
  const len = ses.clipLen > 0 ? Math.min(ses.clipLen, dur - start) : dur - start;
  return { start, len: Math.max(0.1, len) };
}
function envAt(R, t) {
  const env = R.env; if (!env) return 0;
  const f = t * R.rate, i = Math.floor(f);
  if (i < 0) return 0; if (i >= env.length - 1) return env[env.length - 1] || 0;
  return env[i] + (env[i + 1] - env[i]) * (f - i);
}

function outSize(P = S) { const [w, h] = P.format.split("x").map(Number); return { W: w, H: h }; }
function currentTime() { return V.playing ? audioEl.currentTime : V.seekTime; }
function setS(v) { S = v; }
function setPresets(v) { presets = v; }
function setFontLib(v) { fontLib = v; }
function setSysFonts(v) { sysFonts = v; }

/* ===== ui ===== */
// Status line, progress bar and the export spec

function setProgress(p) {
  if (p == null) { M.hide($("#prog")); return; }
  M.show($("#prog")); M.bar($("#progBar"), p);
}
const fmtMB = b => (b / 1e6).toFixed(b < 1e7 ? 1 : 0) + " MB";
/* ---------- export spec ---------- */
function videoBitrate(P = S) {
  const { W, H } = outSize(P), fps = +P.fps, area = W * H / (1920 * 1080);
  const q = { low: 0.55, std: 1, high: 1.8 }[P.quality] || 1;
  return Math.round(8e6 * Math.pow(area, 0.9) * (fps > 30 ? 1.5 : 1) * q);
}
function updateSpec() {
  const { W, H } = outSize(), { len } = clipBounds(session, aud.duration);
  const vb = videoBitrate(), mb = (vb + 256000) * len / 8 / 1e6;
  $("#spec").innerHTML = [`${W}×${H}`, `${S.fps} fps`, `${(vb / 1e6).toFixed(1)} Mbps`, fmtTime(len, false), `≈ ${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`, "MP4"].map(s => `<span>${s}</span>`).join("");
}

/* ===== render ===== */
// Frame renderer: cached assets and the passes of a frame

const FILTER_OK = (() => {
  try {
    const c = mk(8, 8), x = c.getContext("2d");
    x.fillStyle = "#000"; x.fillRect(0, 0, 8, 8);
    x.filter = "blur(2px)"; x.fillStyle = "#fff"; x.fillRect(4, 3, 2, 2);
    return x.getImageData(1, 4, 1, 1).data[0] > 0;
  } catch (e) { return false; }
})();

/* ---------- shape ---------- */
function shapePath(ctx, x, y, w, h, rPct, smooth) {
  const m = Math.min(w, h), s = smooth / 100;
  const r = Math.min(m * rPct / 100 * (1 + 0.9 * s), m / 2);
  ctx.beginPath();
  if (r <= 0.5) { ctx.rect(x, y, w, h); return; }
  const e = 2 / (2 + s * 3), N = 18;
  const corner = (cx, cy, a0) => {
    for (let i = 0; i <= N; i++) {
      const th = a0 + (Math.PI / 2) * i / N, c = Math.cos(th), sn = Math.sin(th);
      ctx.lineTo(cx + r * Math.sign(c) * Math.pow(Math.abs(c), e), cy + r * Math.sign(sn) * Math.pow(Math.abs(sn), e));
    }
  };
  ctx.moveTo(x + r, y);
  corner(x + w - r, y + r, -Math.PI / 2);
  corner(x + w - r, y + h - r, 0);
  corner(x + r, y + h - r, Math.PI / 2);
  corner(x + r, y + r, Math.PI);
  ctx.closePath();
}
function softBlur(src, w, h, radius) {
  const out = mk(w, h);
  if (radius < 1) { out.getContext("2d").drawImage(src, 0, 0, w, h); return out; }
  let cur = src, f = 1; const target = Math.max(2, radius / 2.2);
  while (f * 2 <= target) {
    f *= 2; const n = mk(Math.max(2, Math.round(w / f)), Math.max(2, Math.round(h / f))), nx = n.getContext("2d");
    nx.imageSmoothingQuality = "high"; nx.drawImage(cur, 0, 0, n.width, n.height); cur = n;
  }
  const ox = out.getContext("2d"); ox.imageSmoothingQuality = "high"; ox.drawImage(cur, 0, 0, w, h);
  return out;
}

/* ---------- cached layers ---------- */
function part(cache, name, key, build) {
  const p = cache[name];
  if (p && p.key === key) return p.val;
  const val = build(); cache[name] = { key, val }; return val;
}
function coverGeom(W, H, P) {
  return { px: Math.round(P.coverSize / 100 * Math.min(W, H)), cx: W / 2 + P.coverX / 100 * W, cy: H / 2 + P.coverY / 100 * H };
}
function imgSize(img) { return [img.naturalWidth || img.width || 512, img.naturalHeight || img.height || 512]; }
function buildBg(W, H, R) {
  const P = R.S, u = Math.min(W, H) / 1080, k = 0.5;
  const ow = Math.ceil(W * 1.1 * k), oh = Math.ceil(H * 1.1 * k);
  const c = mk(ow, oh), x = c.getContext("2d");
  const img = R.art.img, [iw, ih] = imgSize(img);
  const blur = P.bgBlur * u * k, m = blur * 3;
  const sc = Math.max((ow + 2 * m) / iw, (oh + 2 * m) / ih) * P.bgZoom / 100;
  const dw = iw * sc, dh = ih * sc;
  x.fillStyle = "#000"; x.fillRect(0, 0, ow, oh);
  if (FILTER_OK) {
    x.filter = `blur(${blur}px) brightness(${P.bgBrightness}%) saturate(${P.bgSaturation}%)`;
    x.drawImage(img, (ow - dw) / 2, (oh - dh) / 2, dw, dh);
    x.filter = "none";
  } else {
    const tmp = mk(ow, oh); tmp.getContext("2d").drawImage(img, (ow - dw) / 2, (oh - dh) / 2, dw, dh);
    x.drawImage(softBlur(tmp, ow, oh, blur), 0, 0);
    const b = P.bgBrightness / 100;
    if (b < 1) { x.fillStyle = `rgba(0,0,0,${1 - b})`; x.fillRect(0, 0, ow, oh); }
    else if (b > 1) { x.globalCompositeOperation = "lighter"; x.globalAlpha = Math.min(1, b - 1); x.drawImage(c, 0, 0); }
    x.globalAlpha = 1; x.globalCompositeOperation = "source-over";
    const s = P.bgSaturation / 100;
    if (s < 1) { x.globalCompositeOperation = "saturation"; x.globalAlpha = 1 - s; x.fillStyle = "#808080"; x.fillRect(0, 0, ow, oh); x.globalAlpha = 1; x.globalCompositeOperation = "source-over"; }
  }
  if (P.tintAmount > 0) {
    x.globalCompositeOperation = "color"; x.globalAlpha = P.tintAmount / 100;
    x.fillStyle = P.tintColor; x.fillRect(0, 0, ow, oh);
    x.globalAlpha = 1; x.globalCompositeOperation = "source-over";
  }
  return { c, k };
}
function buildCover(W, H, R) {
  const P = R.S, { px } = coverGeom(W, H, P), u = Math.min(W, H) / 1080;
  const c = mk(px, px), x = c.getContext("2d");
  const img = R.art.img, [iw, ih] = imgSize(img), m = Math.min(iw, ih);
  x.save(); shapePath(x, 0, 0, px, px, P.radius, P.smooth); x.clip();
  x.imageSmoothingQuality = "high";
  x.drawImage(img, (iw - m) / 2, (ih - m) / 2, m, m, 0, 0, px, px);
  if (P.borderWidth > 0 && P.borderOpacity > 0) {
    x.lineWidth = P.borderWidth * u * 2; x.strokeStyle = `rgba(255,255,255,${P.borderOpacity / 100})`;
    shapePath(x, 0, 0, px, px, P.radius, P.smooth); x.stroke();
  }
  x.restore();
  return c;
}
// "Cover cutout": the subject of the cover drawn again over the frame, pop-out % larger (standing on the frame's
// bottom edge, so it comes out over the top and sides), with a shadow of its own
function buildSubject(W, H, R) {
  const P = R.S, { px } = coverGeom(W, H, P), u = Math.min(W, H) / 1080, sp = Math.round(px * (1 + P.popOut / 100));
  const blur = P.shadowBlur * u * 0.4, dy = P.shadowY * u * 0.4, pad = Math.ceil(blur * 1.6 + dy + 4);
  const c = mk(sp + pad * 2, sp + pad * 2), x = c.getContext("2d");
  x.imageSmoothingQuality = "high";
  if (P.shadowOpacity > 0) { x.shadowColor = `rgba(0,0,0,${P.shadowOpacity / 100 * 0.8})`; x.shadowBlur = blur; x.shadowOffsetY = dy; }
  x.drawImage(R.art.cut, pad, pad, sp, sp);
  return { c, pad, sp };
}
function buildShadow(W, H, R) {
  const P = R.S, { px } = coverGeom(W, H, P), u = Math.min(W, H) / 1080;
  const blur = P.shadowBlur * u, dy = P.shadowY * u, pad = Math.ceil(blur * 1.6 + dy + 4);
  const c = mk(px + pad * 2, px + pad * 2), x = c.getContext("2d");
  if (P.shadowOpacity > 0) {
    const off = 20000;
    x.shadowColor = `rgba(0,0,0,${P.shadowOpacity / 100})`; x.shadowBlur = blur; x.shadowOffsetX = off; x.shadowOffsetY = dy;
    x.fillStyle = "#000"; shapePath(x, pad - off, pad, px, px, P.radius, P.smooth); x.fill();
  }
  return { c, pad };
}
// The cover's average colour at full brightness
function glowColor(R) { const [r, g, b] = R.art.avg, mx = Math.max(r, g, b, 1), f = 255 / mx; return `rgb(${Math.round(r * f)},${Math.round(g * f)},${Math.round(b * f)})`; }
function buildGlow(W, H, R) {
  const P = R.S, { px } = coverGeom(W, H, P);
  const blur = px * 0.22, pad = Math.ceil(blur * 1.8);
  const c = mk(px + pad * 2, px + pad * 2), x = c.getContext("2d");
  const off = 20000;
  x.shadowColor = glowColor(R); x.shadowBlur = blur; x.shadowOffsetX = off;
  x.fillStyle = "#000"; shapePath(x, pad - off, pad, px, px, P.radius, P.smooth); x.fill();
  x.shadowBlur = blur * 0.45; shapePath(x, pad - off, pad, px, px, P.radius, P.smooth); x.fill();
  return { c, pad };
}
function buildVignette(W, H, R) {
  const c = mk(W, H), x = c.getContext("2d"), d = Math.hypot(W, H) / 2;
  const g = x.createRadialGradient(W / 2, H / 2, d * 0.35, W / 2, H / 2, d);
  g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${R.S.vignette / 100 * 0.92})`);
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  return c;
}
let GRAIN = null;
function grainTile() {
  if (GRAIN) return GRAIN;
  const c = mk(256, 256), x = c.getContext("2d"), id = x.createImageData(256, 256);
  let seed = 1337;
  for (let i = 0; i < 256 * 256; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0; const v = seed >>> 24;
    id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = v; id.data[i * 4 + 3] = 255;
  }
  x.putImageData(id, 0, 0); GRAIN = c; return c;
}
function buildDisc(D, R) {
  const P = R.S, pad = Math.ceil(D * 0.14), N = D + pad * 2;
  const c = mk(N, N), x = c.getContext("2d"), C = N / 2, r = D / 2;
  if (P.logoStyle === "custom" && R.logo.img) {
    const [iw, ih] = imgSize(R.logo.img), s = Math.min(D / iw, D / ih);
    x.shadowColor = "rgba(0,0,0,.45)"; x.shadowBlur = D * 0.08;
    x.drawImage(R.logo.img, C - iw * s / 2, C - ih * s / 2, iw * s, ih * s);
    return { c, pad, sheen: null };
  }
  // soft white button; the note (a quarter note whose top line runs out to the rim) is cut out,
  // so whatever is behind the button shows through it
  x.save(); x.shadowColor = "rgba(0,0,0,.42)"; x.shadowBlur = D * 0.12; x.shadowOffsetY = D * 0.04;
  x.beginPath(); x.arc(C, C, r, 0, Math.PI * 2); x.fillStyle = "#eeeeee"; x.fill(); x.restore();
  const g = x.createRadialGradient(C - r * 0.32, C - r * 0.38, r * 0.05, C, C, r);
  g.addColorStop(0, "#ffffff"); g.addColorStop(0.6, "#f3f3f3"); g.addColorStop(0.88, "#dedede"); g.addColorStop(1, "#c2c2c2");
  x.beginPath(); x.arc(C, C, r, 0, Math.PI * 2); x.fillStyle = g; x.fill();
  // two beamed eighth notes, as in the reference button
  const lw = r * 0.1, bt = r * 0.18, jr = r * 0.03;
  const heads = [[C - r * 0.3, C + r * 0.3], [C + r * 0.255, C + r * 0.22]];
  const stems = [C - r * 0.2, C + r * 0.355];                          // stem centres
  const yAt = xx => (C - r * 0.3) + (xx - (C - r * 0.25)) / (r * 0.655) * (-r * 0.1);   // beam top edge
  const bl = stems[0] - lw / 2, br = stems[1] + lw / 2;
  const note = () => {
    x.beginPath();
    for (const [hx, hy] of heads) { x.moveTo(hx + r * 0.16, hy); x.ellipse(hx, hy, r * 0.16, r * 0.125, -0.4, 0, Math.PI * 2); }
    x.fill();
    x.lineJoin = "round"; x.lineWidth = jr * 2;
    x.beginPath();                                                     // beam
    x.moveTo(bl, yAt(bl)); x.lineTo(br, yAt(br)); x.lineTo(br, yAt(br) + bt); x.lineTo(bl, yAt(bl) + bt); x.closePath();
    stems.forEach((sx, i) => {                                         // stems, from the beam down into each head
      const y0 = yAt(sx) + bt * 0.5, y1 = heads[i][1];
      x.rect(sx - lw / 2, y0, lw, y1 - y0);
    });
    x.fill("nonzero"); x.stroke();
  };
  x.globalCompositeOperation = "destination-out"; x.fillStyle = x.strokeStyle = "#000"; note();
  x.globalCompositeOperation = "source-atop";                          // soft inner edge so the cut reads as depth
  x.shadowColor = "rgba(0,0,0,.28)"; x.shadowBlur = r * 0.08; x.shadowOffsetY = -r * 0.02; note();
  x.globalCompositeOperation = "source-over"; x.shadowColor = "transparent";
  return { c, pad, sheen: null };
}
function getAssets(cache, ctx, W, H, R) {
  const P = R.S, base = `${W}x${H}|${R.art.ver}`;
  const coverKey = `${base}|${P.coverSize}|${P.radius}|${P.smooth}`;
  return {
    cache,
    bg: part(cache, "bg", `${base}|${P.bgBlur}|${P.bgZoom}|${P.bgBrightness}|${P.bgSaturation}|${P.tintColor}|${P.tintAmount}`, () => buildBg(W, H, R)),
    cover: part(cache, "cover", `${coverKey}|${P.borderWidth}|${P.borderOpacity}`, () => buildCover(W, H, R)),
    shadow: part(cache, "shadow", `${coverKey}|${P.shadowOpacity}|${P.shadowBlur}|${P.shadowY}`, () => buildShadow(W, H, R)),
    glow: part(cache, "glow", coverKey, () => buildGlow(W, H, R)),
    subject: P.coverCut && R.art.cut ? part(cache, "subject", `${coverKey}|${P.popOut}|${P.shadowOpacity}|${P.shadowBlur}|${P.shadowY}`, () => buildSubject(W, H, R)) : null,
    vig: part(cache, "vig", `${W}x${H}|${P.vignette}`, () => buildVignette(W, H, R)),
    grain: part(cache, "grain", "g", () => ctx.createPattern(grainTile(), "repeat"))
  };
}

/* ---------- frame renderer ----------
   The frame is drawn in passes that the layer export reuses one by one (see renderLayers):
   background (with its darkening, flash and vignette) → cover glow → shadow and cover → text and icon → grain → fade. */
function frameState(W, H, t, R) {
  const P = R.S, u = Math.min(W, H) / 1080;
  const ee = P.bassOn ? envAt(R, t) : 0;
  let sx = 0, sy = 0;
  if (P.shake > 0 && ee > 0.001) {
    const k = P.shake * u * ee;
    sx = (Math.sin(t * 53.1) * 0.6 + Math.sin(t * 97.3 + 1.7) * 0.4) * k;
    sy = (Math.sin(t * 61.7 + 4.2) * 0.6 + Math.sin(t * 83.9 + 0.3) * 0.4) * k;
  }
  const geom = coverGeom(W, H, P);
  geom.cs = 1 + ee * P.coverPulse / 100;
  const glowA = clamp(P.glow / 100 + ee * P.glowPulse / 100, 0, 1.5);
  return { P, u, ee, sx, sy, geom, glowA };
}
function resetCtx(ctx) { ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; ctx.filter = "none"; ctx.shadowColor = "transparent"; ctx.imageSmoothingQuality = "high"; }
function drawBackground(ctx, W, H, R, A, F) {
  const P = F.P;
  ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
  const z = 1 + F.ee * P.bgPulse / 100;
  const bw = A.bg.c.width / A.bg.k, bh = A.bg.c.height / A.bg.k;
  const drawBg = () => { ctx.save(); ctx.translate(W / 2 + F.sx, H / 2 + F.sy); ctx.scale(z, z); ctx.drawImage(A.bg.c, -bw / 2, -bh / 2, bw, bh); ctx.restore(); };
  drawBg();
  const flash = F.ee * P.bgFlash / 100;
  const dark = P.bgDarken / 100 * (1 - clamp(flash, 0, 1));
  if (dark > 0.001) { ctx.fillStyle = `rgba(0,0,0,${dark})`; ctx.fillRect(0, 0, W, H); }
  if (flash > 0.01) { ctx.globalCompositeOperation = "lighter"; ctx.globalAlpha = clamp(flash * 0.4, 0, 0.8); drawBg(); ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"; }
  if (P.vignette > 0) ctx.drawImage(A.vig, 0, 0);
}
// Cover pieces are drawn at the cover's place, scaled with its pulse; returns the rectangle they cover
function placeOn(ctx, g, img, pad) { const s = (g.px + pad * 2) * g.cs; ctx.drawImage(img, g.cx - s / 2, g.cy - s / 2, s, s); return s; }
function drawGlow(ctx, A, F) {
  if (F.glowA <= 0.005) return;
  ctx.globalAlpha = clamp(F.glowA, 0, 1); placeOn(ctx, F.geom, A.glow.c, A.glow.pad);
  if (F.glowA > 1) { ctx.globalAlpha = F.glowA - 1; placeOn(ctx, F.geom, A.glow.c, A.glow.pad); }
  ctx.globalAlpha = 1;
}
// The subject's square (with its shadow's margin), scaled with the cover's pulse; its bottom sits on the cover's
function subjectRect(A, F) {
  const g = F.geom, s = A.subject, k = (s.sp + s.pad * 2) * g.cs;
  return { x: g.cx - k / 2, y: g.cy + (g.px / 2 + s.pad) * g.cs - k, w: k, h: k };
}
function drawCoverPart(ctx, A, F) {
  if (F.P.shadowOpacity > 0) placeOn(ctx, F.geom, A.shadow.c, A.shadow.pad);
  ctx.imageSmoothingQuality = "high";
  placeOn(ctx, F.geom, A.cover, 0);
  if (A.subject) { const r = subjectRect(A, F); ctx.drawImage(A.subject.c, r.x, r.y, r.w, r.h); }
}
function coverRect(A, F) {
  const g = F.geom, pad = Math.max(F.glowA > 0.005 ? A.glow.pad : 0, F.P.shadowOpacity > 0 ? A.shadow.pad : 0), s = (g.px + pad * 2) * g.cs;
  const r = { x: g.cx - s / 2, y: g.cy - s / 2, w: s, h: s };
  if (!A.subject) return r;
  const b = subjectRect(A, F), x = Math.min(r.x, b.x), y = Math.min(r.y, b.y);
  return { x, y, w: Math.max(r.x + r.w, b.x + b.w) - x, h: Math.max(r.y + r.h, b.y + b.h) - y };
}
function drawGrain(ctx, W, H, A, P, u, grainSeed, alpha) {
  if (!(P.grain > 0 && A.grain)) return;
  ctx.save();
  ctx.globalCompositeOperation = alpha == null ? "overlay" : "source-over"; ctx.globalAlpha = alpha == null ? P.grain / 100 * 0.7 : alpha;
  const gs = Math.max(0.5, u), ox = (grainSeed * 97) % 256, oy = (grainSeed * 57) % 256;
  ctx.scale(gs, gs); ctx.translate(-ox, -oy);
  ctx.fillStyle = A.grain; ctx.fillRect(ox, oy, W / gs, H / gs);
  ctx.restore();
}
// Fade in and out of the clip: 1 = fully visible
function fadeAt(R, t) {
  const P = R.S, { start, len } = R.clip, tc = t - start;
  let a = 1;
  if (P.fadeIn > 0) a = Math.min(a, clamp(tc / P.fadeIn, 0, 1));
  if (P.fadeOut > 0) a = Math.min(a, clamp((len - tc) / P.fadeOut, 0, 1));
  return a;
}
function renderFrame(ctx, W, H, t, R, A, grainSeed, noFades) {
  const F = frameState(W, H, t, R);
  resetCtx(ctx);
  drawBackground(ctx, W, H, R, A, F);
  if (F.glowA > 0.005) { ctx.globalCompositeOperation = "screen"; drawGlow(ctx, A, F); ctx.globalCompositeOperation = "source-over"; }
  drawCoverPart(ctx, A, F);
  drawTextBlock(ctx, W, H, t, F.ee, R, A, F.geom, F.u);
  drawGrain(ctx, W, H, A, F.P, F.u, grainSeed);
  if (noFades) return;
  const a = fadeAt(R, t);
  if (a < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - a})`; ctx.fillRect(0, 0, W, H); }
}

function drawTextBlock(ctx, W, H, t, ee, R, A, geom, u) {
  const P = R.S;
  const title = P.textOn ? (R.ses.title || "").trim() : "";
  let artist = P.textOn ? (P.artist || "").trim() : "";
  if (P.artistUpper) artist = artist.toUpperCase();
  const showText = !!(title || artist), showLogo = P.logoOn;
  if (!showText && !showLogo) return null;
  const hasLS = "letterSpacing" in ctx;
  const fsT = P.titleSize * u, fsA = P.artistSize * u, gap = P.lineGap * u;
  const fT = `${P.titleWeight} ${fsT}px ${fontFamilyCSS(P.titleFont, P.titleSys)}`;
  const fA = `${P.artistWeight} ${fsA}px ${fontFamilyCSS(P.artistFont, P.artistSys)}`;
  const lsA = P.artistSpacing / 100 * fsA;
  ctx.save();
  let wT = 0, wA = 0;
  if (title) { ctx.font = fT; if (hasLS) ctx.letterSpacing = "0px"; wT = ctx.measureText(title).width; }
  if (artist) { ctx.font = fA; if (hasLS) ctx.letterSpacing = lsA + "px"; wA = ctx.measureText(artist).width - (hasLS ? lsA : 0); }
  const tw = Math.max(wT, wA);
  const th = (title ? fsT : 0) + (title && artist ? gap : 0) + (artist ? fsA : 0);
  const D = showLogo ? Math.max(8, (th > 0 ? th : 90 * u) * P.logoSize / 100) : 0;
  const lg = showLogo && showText ? P.logoGap * u : 0;
  const totalW = D + lg + tw, blockH = Math.max(th, D);
  const off = Math.max(26 * u, fsT * 0.9);
  let left, midY;
  if (P.textPos === "bottomleft") { left = W * 0.05; midY = H * 0.94 - blockH / 2; }
  else if (P.textPos === "bottomcenter") { left = W / 2 - totalW / 2; midY = H * 0.94 - blockH / 2; }
  else if (P.textPos === "above") { left = geom.cx - totalW / 2; midY = geom.cy - geom.px * geom.cs / 2 - off - blockH / 2; }
  else { left = geom.cx - totalW / 2; midY = geom.cy + geom.px * geom.cs / 2 + off + blockH / 2; }
  const logoRight = P.logoSide === "right";
  const logoX = logoRight ? left + tw + lg : left;
  const textX = logoRight ? left : left + D + lg;
  // what this block can touch: the text with its shadow, and the icon turned at any angle
  const tpad = Math.max(fsT, fsA) * 1.6 + 4;
  let box = { x0: left - tpad, y0: midY - blockH / 2 - tpad, x1: left + totalW + tpad, y1: midY + blockH / 2 + tpad };

  if (showLogo) {
    const Dq = Math.max(8, Math.round(D));
    const disc = part(A.cache, "disc", `${Dq}|${P.logoStyle}|${R.art.ver}|${R.logo.ver}`, () => buildDisc(Dq, R));
    const scale = (D / Dq) * (1 + ee * P.logoPulse / 100);
    const ang = t * P.logoRpm / 60 * Math.PI * 2 * (P.logoDir === "ccw" ? -1 : 1);
    const cx = logoX + D / 2, full = disc.c.width * scale;
    ctx.save(); ctx.translate(cx, midY); ctx.rotate(ang); ctx.drawImage(disc.c, -full / 2, -full / 2, full, full); ctx.restore();
    const rr = full * 0.75 + 4;
    box = { x0: Math.min(box.x0, cx - rr), y0: Math.min(box.y0, midY - rr), x1: Math.max(box.x1, cx + rr), y1: Math.max(box.y1, midY + rr) };
    if (disc.sheen) { const s = Dq * scale; ctx.save(); ctx.globalCompositeOperation = "screen"; ctx.drawImage(disc.sheen, cx - s / 2, midY - s / 2, s, s); ctx.restore(); }
  }
  if (showText) {
    ctx.globalAlpha = P.textOpacity / 100; ctx.fillStyle = P.textColor;
    ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = Math.max(fsT, fsA) * 0.5; ctx.textBaseline = "alphabetic";
    const centered = !showLogo && P.textPos !== "bottomleft";
    const align = centered ? "center" : (logoRight ? "right" : "left");
    ctx.textAlign = align;
    const x = align === "center" ? textX + tw / 2 : align === "right" ? textX + tw : textX;
    let top = midY - th / 2;
    if (title) { ctx.font = fT; if (hasLS) ctx.letterSpacing = "0px"; ctx.fillText(title, x, top + fsT * 0.8); top += fsT + (artist ? gap : 0); }
    if (artist) {
      ctx.font = fA; if (hasLS) ctx.letterSpacing = lsA + "px";
      const fix = !hasLS ? 0 : align === "center" ? lsA / 2 : align === "right" ? lsA : 0;
      if (title) ctx.globalAlpha *= 0.8;
      ctx.fillText(artist, x + fix, top + fsA * 0.8);
    }
  }
  ctx.restore();
  return { x: box.x0, y: box.y0, w: box.x1 - box.x0, h: box.y1 - box.y0 };
}

/* ===== timeline ===== */
// Waveform timeline with the clip markers

const scrubEl = $("#seek"), hoverTime = $("#hoverTime");
scrubEl.addEventListener("pointermove", e => {
  if (!aud.duration) return;
  const r = scrubEl.getBoundingClientRect(), f = clamp((e.clientX - r.left) / r.width, 0, 1);
  hoverTime.hidden = false; hoverTime.style.left = (f * 100) + "%"; hoverTime.textContent = fmtTime(f * aud.duration);
});
scrubEl.addEventListener("pointerleave", () => { hoverTime.hidden = true; });
const strip = $("#strip"), sctx = strip.getContext("2d");
// Waveform of the whole song (neutral) with the bass envelope over it (lavender), as mirrored rounded bars.
// Two copies are painted once: dimmed and lit. Each frame shows the lit copy up to the playhead.
let wave = null, stripLit = null, stripDim = null;
const WAVE_BUCKETS = 2400;
function wavePeaks(buffer) {
  const n = buffer.length, chans = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) chans.push(buffer.getChannelData(c));
  const peaks = new Float32Array(WAVE_BUCKETS), step = n / WAVE_BUCKETS;
  let top = 1e-6;
  for (let b = 0; b < WAVE_BUCKETS; b++) {
    const a = Math.floor(b * step), e = Math.min(n, Math.floor((b + 1) * step));
    let m = 0;
    for (const d of chans) for (let i = a; i < e; i += 4) { const v = Math.abs(d[i]); if (v > m) m = v; }
    peaks[b] = m; if (m > top) top = m;
  }
  for (let b = 0; b < WAVE_BUCKETS; b++) peaks[b] /= top;
  return peaks;
}
function paintWave(ctx, W, H, dpr, lit) {
  const env = bass.env, peaks = wave, bw = 2 * dpr, gap = 1 * dpr, mid = H / 2, half = H / 2 - 4 * dpr;
  const bars = Math.floor(W / (bw + gap));
  const maxIn = (arr, a, b) => { let m = 0; for (let i = a; i < b && i < arr.length; i++) if (arr[i] > m) m = arr[i]; return m; };
  const bar = h => { h = Math.max(dpr, h); ctx.beginPath(); ctx.roundRect(0, mid - h, bw, 2 * h, bw / 2); ctx.fill(); };
  for (let i = 0; i < bars; i++) {
    const x = i * (bw + gap), f0 = i / bars, f1 = (i + 1) / bars;
    ctx.save(); ctx.translate(x, 0);
    if (peaks) { ctx.fillStyle = tok(lit ? "--n-300" : "--n-600"); bar(maxIn(peaks, Math.floor(f0 * peaks.length), Math.max(Math.floor(f0 * peaks.length) + 1, Math.floor(f1 * peaks.length))) * half); }
    if (env) {
      const m = maxIn(env, Math.floor(f0 * env.length), Math.max(Math.floor(f0 * env.length) + 1, Math.floor(f1 * env.length)));
      ctx.globalAlpha = lit ? 1 : 0.45; ctx.fillStyle = tok("--lavender"); bar(clamp(m, 0, 1.2) / 1.2 * half * 0.92); ctx.globalAlpha = 1;
    }
    ctx.restore();
  }
}
function drawStrip() {
  const r = strip.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  strip.width = Math.max(2, Math.round(r.width * dpr)); strip.height = Math.max(2, Math.round(r.height * dpr));
  const W = strip.width, H = strip.height;
  sctx.clearRect(0, 0, W, H);
  placeMarks();
  if ((!bass.env && !wave) || !aud.duration) { stripLit = stripDim = null; return; }
  const { start, len } = clipBounds(session, aud.duration);
  const x0 = start / aud.duration * W, x1 = (start + len) / aud.duration * W;
  for (const lit of [false, true]) {
    const c = mk(W, H), x = c.getContext("2d");
    paintWave(x, W, H, dpr, lit);
    // outside the clip: veiled
    x.globalCompositeOperation = "source-atop"; x.fillStyle = tok("--scrim");
    x.fillRect(0, 0, x0, H); x.fillRect(x1, 0, W - x1, H);
    if (lit) stripLit = c; else stripDim = c;
  }
  drawStripHead(currentTime());
}
function drawStripHead(t) {
  if (!stripLit || !aud.duration) return;
  const W = strip.width, h = strip.height, x = Math.round(t / aud.duration * W), k = h / 58;
  sctx.clearRect(0, 0, W, h);
  sctx.drawImage(stripDim, 0, 0);
  if (x > 0) sctx.drawImage(stripLit, 0, 0, x, h, 0, 0, x, h);
  sctx.fillStyle = tok("--text"); sctx.fillRect(x - k, 0, 2 * k, h);
}
// Clip markers: positions follow Start / Duration; dragging them changes both fields
function placeMarks() {
  const has = !!aud.duration;
  M.reveal($("#markIn"), has); M.reveal($("#markOut"), has);
  if (!has) return;
  const { start, len } = clipBounds(session, aud.duration);
  $("#markIn").style.left = (start / aud.duration * 100) + "%";
  $("#markOut").style.left = ((start + len) / aud.duration * 100) + "%";
  $("#markIn").setAttribute("aria-valuetext", fmtTime(start)); $("#markOut").setAttribute("aria-valuetext", fmtTime(start + len));
}
function setClip(start, end) {
  const d = aud.duration; if (!d) return;
  start = clamp(Math.round(start * 10) / 10, 0, Math.max(0, d - 0.5));
  end = clamp(Math.round(end * 10) / 10, start + 0.5, d);
  session.clipStart = start;
  session.clipLen = end >= d - 0.05 ? 0 : Math.round((end - start) * 10) / 10;
  up.syncSessionInputs(); up.onChange("clipStart");
}
for (const which of ["In", "Out"]) {
  const m = $("#mark" + which);
  m.addEventListener("pointerdown", e => {
    if (!aud.duration) return;
    e.preventDefault(); m.setPointerCapture(e.pointerId); m.focus();
    const move = ev => {
      const r = $("#scrub").getBoundingClientRect(), tt = clamp((ev.clientX - r.left) / r.width, 0, 1) * aud.duration;
      const { start, len } = clipBounds(session, aud.duration);
      if (which === "In") setClip(tt, start + len); else setClip(start, tt);
      hoverTime.hidden = false; hoverTime.style.left = (tt / aud.duration * 100) + "%"; hoverTime.textContent = fmtTime(tt);
    };
    const up = () => { m.removeEventListener("pointermove", move); m.removeEventListener("pointerup", up); m.removeEventListener("pointercancel", up); hoverTime.hidden = true; };
    m.addEventListener("pointermove", move); m.addEventListener("pointerup", up); m.addEventListener("pointercancel", up);
  });
  m.addEventListener("keydown", e => {
    if (!aud.duration || !["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault(); e.stopPropagation();
    const dv = (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 1 : 0.1), { start, len } = clipBounds(session, aud.duration);
    if (which === "In") setClip(start + dv, start + len); else setClip(start, start + len + dv);
  });
}
new ResizeObserver(() => drawStrip()).observe(strip);

function setWave(v) { wave = v; }

/* ===== media ===== */
// Bass analysis and loading the song and the cover

/* ---------- bass analysis (../bass.js, at the rate of the state) ---------- */
const bassRaw = (buf, cutoff) => rawOf(buf, cutoff, bass.rate);
const bassEnv = (raw, p, P) => envOf(raw, p, P, bass.rate);
async function analyzeBass() {
  if (!aud.buffer) return;
  const ver = ++bass.ver, r = await bassRaw(aud.buffer, S.bassCutoff);
  if (ver !== bass.ver) return;
  bass.raw = r.raw; bass.p = r.p;
  computeEnv();
}
function computeEnv() {
  if (!bass.raw) return;
  bass.env = bassEnv(bass.raw, bass.p, S); drawStrip(); requestPreview();
}

/* ---------- media loading ---------- */
function loadImage(src) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error("img")); i.src = src; });
}
function averageColor(img) {
  const c = mk(16, 16), x = c.getContext("2d"); x.drawImage(img, 0, 0, 16, 16);
  const d = x.getImageData(0, 0, 16, 16).data; let r = 0, g = 0, b = 0, w = 0;
  for (let i = 0; i < d.length; i += 4) { const k = 0.2 + (d[i] + d[i + 1] + d[i + 2]) / 765; r += d[i] * k; g += d[i + 1] * k; b += d[i + 2] * k; w += k; }
  return [r / w, g / w, b / w];
}
/* ---------- the cover: an original, its 1:1 crop and its cut-out (docs/ARCHITECTURE.md → Shared services) ---------- */
const COVER_MAX = 3000;   // the crop is drawn at most this size, from the original
function applyArt() {
  art.img = IMG.render(art.src, art.crop, { maxSide: COVER_MAX });
  art.cut = art.mask ? IMG.render(art.src, art.crop, { maxSide: COVER_MAX, mask: art.mask }) : null;
  art.avg = averageColor(art.img); art.ver++;
  const th = mk(128, 128); th.getContext("2d").drawImage(art.img, 0, 0, 128, 128);
  $("#artThumb").src = th.toDataURL("image/jpeg", 0.85); $("#artThumb").dataset.px = art.img.width; $("#artName").textContent = art.name;
  updateReady(); requestPreview();
}
function setArt(img, name, crop, file) {
  Object.assign(art, { src: img, name, crop: crop || IMG.centered(...IMG.size(img), "1:1"), file: file || null, mask: null, edit: null });
  applyArt();
}
// The crop again, on the original (a button, or a double-click on the preview)
async function editCrop(from) {
  if (!HAL || !art.src) return;
  const r = await HAL.crop({ image: art.src, name: art.name, params: art.crop, ratio: "1:1", lock: true, mask: art.mask, from });
  if (r) { art.crop = r.params; applyArt(); }
}
// Cutout of the cover (for "Cover cutout"); cancelled with the switch on and no cut-out, the switch goes off
async function cutCover(from) {
  if (!HAL || !art.src) return;
  const src = art.src, r = await HAL.cutoutDialog({ image: art.file || art.src, name: art.name, edit: art.edit, from });
  if (r && art.src === src) {
    art.mask = await IMG.maskFrom(r.mask, r.w, r.h); art.edit = r.edit; applyArt();
    if (!S.coverCut) up.setValue("coverCut", true);
  } else if (!art.cut && S.coverCut) up.setValue("coverCut", false);
}
// Controls that need a song (play, timeline) or a song and a cover (export) stay disabled until then
function updateReady() {
  const hasAudio = !!aud.buffer, full = hasAudio && !!art.img;
  if (!full && $("#emptyStage").hidden) M.enter($("#emptyStage"));   // appears; it goes at once, so the preview shows at once
  $("#emptyStage").hidden = full;
  for (const id of ["play", "fsBtn", "seek", "vol"]) $("#" + id).disabled = !hasAudio;
  $("#exportBtn").disabled = !full;
  for (const id of ["sendCoverBtn", "artCropBtn", "artCutBtn"]) $("#" + id).disabled = !art.img;
  M.reveal($("#artThumb"), !!art.img, { scale: 0.96 });
  up.renderQueue();
}
// A cover must be square: a picture of another shape goes through the Crop dialog first (cancelled: not placed)
async function useArtFile(file) {
  try {
    const url = URL.createObjectURL(file), img = await loadImage(url);
    let crop = null;
    if (HAL) {
      const r = await HAL.fitCrop(img, "1:1", { name: file.name });
      if (!r) { URL.revokeObjectURL(url); setStatus(t("vis.st.notPlaced"), "warn"); return; }
      crop = r.params;
    }
    setArt(img, file.name, crop, file);
    setStatus(t("vis.st.coverLoaded", { name: file.name }));
    if (HAL) HAL.recent(file, "visualizer", "cover");
  } catch (e) { setStatus(t("vis.st.badImage"), "bad"); }
}
async function decodeAudio(arrayBuf) { return await new OfflineAudioContext(2, 1, 48000).decodeAudioData(arrayBuf); }
async function setAudio(buffer, url, name) {
  up.pause();
  if (aud.url && aud.url.startsWith("blob:") && aud.url !== url) URL.revokeObjectURL(aud.url);
  aud.buffer = buffer; aud.url = url; aud.name = name; aud.duration = buffer.duration;
  setWave(wavePeaks(buffer));
  audioEl.src = url; V.seekTime = 0;
  $("#seek").max = String(buffer.duration); $("#seek").value = "0";
  $("#audName").textContent = name + " · " + fmtTime(buffer.duration, false);
  session.title = name.replace(/\.[^.]+$/, "").replace(/_+/g, " ").trim();
  session.clipStart = 0; session.clipLen = 0; up.syncSessionInputs();
  updateReady(); updateSpec();
  await analyzeBass(); requestPreview();
}
async function useAudioFile(file) {
  setStatus(t("vis.st.analyzing", { name: file.name }));
  try {
    const buf = await decodeAudio(await file.arrayBuffer());
    await setAudio(buf, URL.createObjectURL(file), file.name); aud.file = file;
    setStatus(t("vis.st.audioLoaded", { name: file.name, time: fmtTime(buf.duration, false) }), "ok");
    if (HAL) HAL.recent(file, "visualizer", "audio");
  } catch (e) { setStatus(t("vis.st.badAudio"), "bad"); }
}

Object.assign(up, { cutCover });

/* ===== preview ===== */
// Preview canvas, playback and keyboard

/* ---------- preview ---------- */
const pv = $("#pv"), pctx = pv.getContext("2d");
const pvCache = {};
function sizePreview() {
  const { W, H } = outSize(), stage = $("#stage");
  stage.style.setProperty("--ar", `${W}/${H}`); stage.style.setProperty("--ar-n", String(W / H));
  if (document.fullscreenElement === $("#player")) {       // fit the frame inside the free space
    const box = stage.parentElement.getBoundingClientRect();
    const s = Math.min(box.width / W, box.height / H);
    stage.style.width = Math.floor(W * s) + "px"; stage.style.height = Math.floor(H * s) + "px";
  } else { stage.style.width = ""; stage.style.height = ""; }
  const rect = stage.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
  let pw = Math.round(Math.min(rect.width * dpr, 2400)), ph = Math.round(pw * H / W);
  if (pw < 2 || ph < 2) { pw = 640; ph = Math.round(640 * H / W); }
  if (pv.width !== pw || pv.height !== ph) { pv.width = pw; pv.height = ph; }
  $("#fmtBadge").textContent = `${W}×${H} · ${S.fps} fps`;
  requestPreview();
}
new ResizeObserver(() => sizePreview()).observe($("#stage").parentElement);
let previewFrame = 0, previewWaiting = false;
function requestPreview() {
  V.needsDraw = true;
  if (window.__ui.away) { if (!previewWaiting) { previewWaiting = true; window.__ui.whenBack(() => { previewWaiting = false; requestPreview(); }); } return; }
  if (!previewFrame) previewFrame = requestAnimationFrame(frameLoop);
}
function frameLoop() {
  previewFrame = 0;
  if (window.__ui.away) { requestPreview(); return; }
  if (V.playing) previewFrame = requestAnimationFrame(frameLoop);
  if (!art.img || (!V.playing && !V.needsDraw)) return;
  V.needsDraw = false;
  const t = currentTime(), R = liveR();
  const A = getAssets(pvCache, pctx, pv.width, pv.height, R);
  renderFrame(pctx, pv.width, pv.height, t, R, A, V.playing ? (Math.random() * 1000) | 0 : 3, !V.playing);
  M.bar($("#meter"), clamp(S.bassOn ? envAt(R, t) : 0, 0, 1));
  $("#time").textContent = `${fmtTime(t)} / ${fmtTime(aud.duration)}`;
  if (V.playing) { $("#seek").value = String(t); drawStripHead(t); }
}
function whenSeekable() {
  return audioEl.readyState >= 1 ? Promise.resolve() : new Promise(r => audioEl.addEventListener("loadedmetadata", r, { once: true }));
}
async function seekTo(t) {
  t = clamp(t, 0, aud.duration || 0); V.seekTime = t;
  $("#seek").value = String(t); drawStripHead(t); requestPreview();
  if (V.playing) { await whenSeekable(); audioEl.currentTime = t; }
}
async function play() {
  if (!aud.url) return;
  if (V.seekTime >= (aud.duration || 0) - 0.05) V.seekTime = 0;
  await whenSeekable();
  audioEl.currentTime = V.seekTime;
  audioEl.play().then(() => { V.playing = true; setPlayIcon(); requestPreview(); }).catch(() => setStatus(t("vis.st.playBlocked"), "warn"));
}
$("#vol").addEventListener("input", e => { audioEl.volume = +e.target.value; up.paintRange(e.target); });
audioEl.volume = 0.8;
async function toggleFullscreen() {
  const el = $("#player");
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await el.requestFullscreen(); }
  catch (e) { setStatus(t("vis.st.noFullscreen"), "warn"); }
}
$("#fsBtn").addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", () => { sizePreview(); drawStrip(); });
$("#pv").addEventListener("click", () => V.playing ? pause() : play());
function pause() {
  if (V.playing) V.seekTime = audioEl.currentTime;
  audioEl.pause(); V.playing = false; setPlayIcon(); requestPreview();
}
// Another view takes its place: the song fades out and stops where it was
window.__ui.onAway(() => {
  cancelAnimationFrame(previewFrame); previewFrame = 0;
  requestPreview();
  if (!V.playing) return;
  V.seekTime = audioEl.currentTime; V.playing = false; setPlayIcon();
  window.__ui.fadeOut(audioEl);
});
function setPlayIcon() {
  $("#play").innerHTML = icon(V.playing ? "pause" : "play");
  $("#play").setAttribute("aria-label", t(V.playing ? "vis.pause" : "vis.play"));
}
audioEl.addEventListener("ended", () => { V.playing = false; V.seekTime = 0; setPlayIcon(); requestPreview(); });
$("#play").addEventListener("click", () => V.playing ? pause() : play());
$("#seek").addEventListener("input", e => seekTo(parseFloat(e.target.value) || 0));
document.addEventListener("keydown", e => {
  const el = document.activeElement, tag = (el && el.tagName) || "";
  const typing = /INPUT|SELECT|TEXTAREA/.test(tag) && el.type !== "range";
  if (typing) return;
  if (e.code === "Space") { if (tag === "BUTTON") return; e.preventDefault(); V.playing ? pause() : play(); }
  else if (e.key === "f" || e.key === "F") { e.preventDefault(); toggleFullscreen(); }
  else if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && (el === document.body || el === scrubEl || !el)) {
    e.preventDefault(); seekTo(currentTime() + (e.key === "ArrowRight" ? 5 : -5));
  }
});

Object.assign(up, { pause });

/* ===== controls ===== */
// Side panel and output fields

/* ---------- controls ---------- */
function fieldValue(k) { return FIELD[k].session ? session[k] : S[k]; }
function fmtVal(f, v) {
  const st = f.step || 1, d = st < 1 ? (st < 0.1 ? 2 : 1) : 0;
  return Number(v).toFixed(d) + (f.unit ? " " + f.unit : "");
}
function paintRange(el) { el.style.setProperty("--p", ((el.value - el.min) / (el.max - el.min) * 100) + "%"); }
function fieldHTML(f) {
  const id = "f-" + f.k;
  switch (f.type) {
    case "row": return `<div class="row2">${f.fields.map(fieldHTML).join("")}</div>`;
    case "caption": return `<div class="divider"></div><p class="caption">${esc(f.label)}</p>`;
    case "button": return `<div class="btnrow"><button class="btn" id="${f.id}">${esc(f.label)}</button></div>`;
    case "fontlib": return `<p class="note">${esc(t("vis.fontlibNote"))}</p><div class="list" id="fontList"></div><div class="btnrow"><label class="btn" for="fontIn">${esc(t("vis.uploadFont"))}</label></div>`;
    case "logolib": return `<div class="f" id="logoLib"><div class="list" id="logoList"></div><div class="btnrow"><label class="btn" for="logoIn">${esc(t("vis.uploadLogo"))}</label></div></div>`;
    case "select": return `<div class="f"><div class="fl"><label for="${id}">${f.label}</label></div><select id="${id}">${f.options.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select></div>`;
    case "font": return `<div class="f"><div class="fl"><label for="${id}">${f.label}</label></div><select id="${id}" data-font="1" data-sample-from="${f.k === "titleFont" ? "#f-title" : "#f-artist"}">${fontOptionsHTML()}</select></div>`;
    case "toggle": return `<label class="tog" for="${id}"><span>${f.label}</span><input type="checkbox" id="${id}"></label>`;
    case "color": return `<div class="f"><div class="fl"><label for="${id}">${f.label}</label></div><div class="colorrow"><input type="color" id="${id}"><code id="o-${f.k}"></code></div></div>`;
    case "text": return `<div class="f" id="wrap-${f.k}"><div class="fl"><label for="${id}">${f.label}</label></div><input type="text" id="${id}" maxlength="80" placeholder="${f.placeholder || ""}">${f.sysFor ? `<div class="sub" id="o-${f.k}"></div>` : ""}</div>`;
    case "number": return `<div class="f"><div class="fl"><label for="${id}">${f.label}</label></div><input type="number" id="${id}" min="${f.min}" step="${f.step}">${f.sub ? `<div class="sub">${f.sub}</div>` : ""}</div>`;
    default: return `<div class="f"><div class="fl"><label for="${id}">${f.label}</label><output id="o-${f.k}" for="${id}"></output></div><input type="range" id="${id}" data-def="${DEFAULTS[f.k]}" min="${f.min}" max="${f.max}" step="${f.step}" title="${esc(t("common.dblReset"))}">${f.sub ? `<div class="sub">${f.sub}</div>` : ""}</div>`;
  }
}
function buildControls() {
  $("#outFields").innerHTML = GROUPS.filter(g => g.main).map(g => g.fields.map(fieldHTML).join("")).join("") + `<p class="sub outnote">${esc(t("vis.f.clipLen.sub"))}</p>`;
  $("#groups").innerHTML = GROUPS.filter(g => !g.main).map(g => `<details class="sec" id="sec-${g.id}" ${g.open ? "open" : ""}><summary><span class="l">${g.title}</span></summary><div class="fields">${g.fields.map(fieldHTML).join("")}</div></details>`).join("");
  for (const k in FIELD) {
    const f = FIELD[k], el = document.getElementById("f-" + k);
    const ev = (f.type === "select" || f.type === "font" || f.type === "toggle" || f.type === "color") ? "change" : "input";
    el.addEventListener(ev, () => {
      let v;
      if (f.type === "toggle") v = el.checked;
      else if (f.type === "select" || f.type === "font" || f.type === "color" || f.type === "text") v = el.value;
      else if (f.type === "number") v = Math.max(0, parseFloat(el.value) || 0);
      else v = parseFloat(el.value);
      setValue(k, v);
    });
    if (f.type === "color") el.addEventListener("input", () => setValue(k, el.value));
  }
  $("#clipHere").addEventListener("click", () => { session.clipStart = Math.round(currentTime() * 10) / 10; syncSessionInputs(); onChange("clipStart"); });
  // "Use as default": this video's format, frame rate, quality and codecs start every new one
  $("#useDefault").hidden = !HAL || !HAL.setToolDefaults;
  $("#useDefault").addEventListener("click", () => {
    HAL.setToolDefaults("visualizer", { format: S.format, fps: S.fps, quality: S.quality, videoCodec: CODEC.video, audioCodec: CODEC.audio });
    HAL.toast(t("common.defaultSaved"));
  });
}
function refreshFontSelects() {
  document.querySelectorAll("select[data-font]").forEach(sel => { sel.innerHTML = fontOptionsHTML(); });
  syncControl("titleFont"); syncControl("artistFont");
}
function syncSysFont(fontKey) {
  const sysKey = fontKey === "titleFont" ? "titleSys" : "artistSys";
  const wrap = document.getElementById("wrap-" + sysKey), note = document.getElementById("o-" + sysKey);
  if (!wrap) return;
  M.reveal(wrap, S[fontKey] === "s", { y: "xs" });
  if (wrap.hidden) return;
  const ok = systemFontAvailable(S[sysKey]);
  note.className = "sub" + (ok === true ? " ok" : ok === false ? " bad" : "");
  note.textContent = t(ok === null ? "vis.sys.hint" : ok ? "vis.sys.found" : "vis.sys.missing");
}
function syncControl(k) {
  const f = FIELD[k], el = document.getElementById("f-" + k); if (!el) return;
  const v = fieldValue(k);
  if (f.type === "toggle") el.checked = !!v;
  else if (f.type === "color") { el.value = v; $("#o-" + k).textContent = String(v).toUpperCase(); }
  else if (f.type === "font") {
    el.value = v;
    if (el.value !== v) { const o = document.createElement("option"); o.value = v; o.dataset.loading = "1"; o.textContent = t("fonts.loading", { name: v.slice(2) }); el.appendChild(o); el.value = v; }
    syncSysFont(k);
  }
  else if (f.type === "select" || f.type === "text" || f.type === "number") { if (document.activeElement !== el) el.value = v ?? ""; }
  else { el.value = v; paintRange(el); $("#o-" + k).textContent = fmtVal(f, v); }
  if (f.sysFor) syncSysFont(f.sysFor);
}
function syncAll() { for (const k in FIELD) syncControl(k); up.renderLogoLib(); }
function syncSessionInputs() { ["clipStart", "clipLen", "title"].forEach(syncControl); }
function setValue(k, v, fromReset) {
  const f = FIELD[k];
  if (f.session) session[k] = v; else S[k] = v;
  if (fromReset || f.type === "select" || f.type === "toggle" || f.type === "font") syncControl(k);
  else if (!f.type) { const el = document.getElementById("f-" + k); paintRange(el); $("#o-" + k).textContent = fmtVal(f, v); }
  else if (f.type === "color") $("#o-" + k).textContent = String(v).toUpperCase();
  else if (f.sysFor) syncSysFont(f.sysFor);
  onChange(k);
}
let bassTimer = 0;
function onChange(k) {
  HAL?.session?.schedule("visualizer");
  const f = FIELD[k];
  if (k === "format" || k === "fps") sizePreview();
  if (k === "bassCutoff") { $("#meterHz").textContent = `≤ ${S.bassCutoff} Hz`; clearTimeout(bassTimer); bassTimer = setTimeout(analyzeBass, 220); }
  if (["sensitivity", "threshold", "attack", "release"].includes(k)) computeEnv();
  if (k === "clipStart" || k === "clipLen") drawStrip();
  if (/Font|Weight|Sys|textOn/.test(k)) ensureFonts();
  if (k === "logoStyle") up.renderLogoLib();
  if (k === "coverCut" && S.coverCut && !art.cut && art.img) up.cutCover();   // switched on without a cut-out: make one
  if (["format", "fps", "quality", "clipStart", "clipLen"].includes(k)) updateSpec();
  requestPreview();
  if (!f.session) up.schedulePersist();
}
async function ensureFonts(P = S) {
  const jobs = [];
  for (const [fk, wk, sk] of [["titleFont", "titleWeight", "titleSys"], ["artistFont", "artistWeight", "artistSys"]]) {
    if (P[fk] && P[fk].startsWith("g:")) jobs.push(document.fonts.load(`${P[wk]} 40px ${fontFamilyCSS(P[fk], P[sk])}`).catch(() => {}));
  }
  await Promise.all(jobs);
  requestPreview();
}

Object.assign(up, { onChange, paintRange, setValue, syncSessionInputs });

/* ===== library ===== */
// Uploaded fonts and the custom logo

/* ---------- font library (uploaded files) ---------- */
let assetsNs;
async function getAssetsNs() { if (assetsNs === undefined) assetsNs = await cap("assets"); return assetsNs; }
function fontType(name) {
  const e = (name.split(".").pop() || "").toLowerCase();
  return { ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2" }[e] || "";
}
function uniqueFamily(base) {
  base = base.replace(/\.[^.]+$/, "").replace(/_+/g, " ").replace(/["'\\]/g, "").trim().slice(0, 40) || "Fuente";
  let name = base, i = 2;
  const taken = n => BUILTIN_FONTS.includes(n) || fontLib.some(f => f.family === n);
  while (taken(name)) name = `${base} ${i++}`;
  return name;
}
async function registerFont(family, data) {
  const face = new FontFace(family, data);
  await face.load(); document.fonts.add(face); loadedFamilies.add(family);
}
async function mergeSharedFonts() {
  if (!HAL) return;
  try {
    for (const f of await HAL.fonts.uploaded()) {
      if (fontLib.some(x => x.id === f.id)) continue;
      fontLib.push({ id: f.id, family: fontLib.some(x => x.family === f.family) ? uniqueFamily(f.family) : f.family, file: f.file });
    }
  } catch (e) {}
}
async function loadLibraryFonts() {
  await mergeSharedFonts();
  for (const f of fontLib) {
    if (loadedFamilies.has(f.family) || !f.id) continue;
    try {
      const r = await window.__halBlob(f.id); if (!r.ok) throw new Error(String(r.status));
      await registerFont(f.family, await r.arrayBuffer()); f.missing = false;
    } catch (e) { f.missing = true; }
  }
  renderFontLib(); refreshFontSelects(); requestPreview();
}
function armButton(b, label) {
  if (b.dataset.armed) return true;
  b.dataset.armed = "1"; b.textContent = t("common.sure"); b.classList.add("warn");
  setTimeout(() => { if (b.isConnected) { delete b.dataset.armed; b.textContent = label; b.classList.remove("warn"); } }, 3000);
  return false;
}
function renderFontLib() {
  const list = $("#fontList"); if (!list) return;
  if (!fontLib.length) { list.innerHTML = `<p class="empty">${esc(t("vis.noFonts"))}</p>`; return; }
  list.innerHTML = fontLib.map((f, i) => `<div class="item"><b style="font-family:'${esc(f.family)}',var(--ui)">${esc(f.family)}</b><small>${esc(t(f.missing ? "vis.font.failed" : f.local ? "common.sessionOnly" : "common.saved"))}</small><button class="btn" data-fdel="${i}">${esc(t("common.delete"))}</button></div>`).join("");
  list.querySelectorAll("[data-fdel]").forEach(b => b.addEventListener("click", async () => {
    if (!armButton(b, t("common.delete"))) return;
    const f = fontLib[+b.dataset.fdel]; if (!f) return;
    setFontLib(fontLib.filter(x => x !== f));
    if (f.id) { const a = await getAssetsNs(); if (a) await a.delete(f.id).catch(() => {}); }
    renderFontLib(); refreshFontSelects(); up.schedulePersist();
    if (HAL) HAL.fonts.changed();
    setStatus(t("vis.st.fontDeleted", { name: f.family }));
  }));
}
$("#fontIn").addEventListener("change", async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  const type = fontType(file.name);
  if (!type) { setStatus(t("vis.st.notFont"), "bad"); return; }
  const family = uniqueFamily(file.name);
  try { await registerFont(family, await file.arrayBuffer()); }
  catch (err) { setStatus(t("vis.st.fontUnreadable"), "bad"); return; }
  const entry = { id: "", family, file: file.name, local: true };
  const a = await getAssetsNs();
  if (a) {
    try { const r = await a.upload(file, { type }); entry.id = r.id; entry.local = false; if (HAL) HAL.fonts.register(r.id, family); }
    catch (err) { setStatus(t("vis.st.fontNotSaved"), "warn"); }
  }
  fontLib.push(entry);
  renderFontLib(); refreshFontSelects(); up.schedulePersist(); requestPreview();
  if (!entry.local) setStatus(t("vis.st.fontAdded", { name: family }), "ok");
});

/* ---------- custom logo ---------- */
async function blobToImage(blob) { return await loadImage(URL.createObjectURL(blob)); }
async function loadLogoAsset(id) {
  if (!id || logo.id === id) return;
  try {
    const r = await window.__halBlob(id); if (!r.ok) throw new Error(String(r.status));
    logo.img = await blobToImage(await r.blob()); logo.id = id; logo.local = false; logo.name = logo.name || t("vis.yourLogo"); logo.ver++;
  } catch (e) { logo.img = null; logo.id = ""; logo.ver++; }
  renderLogoLib(); requestPreview();
}
function renderLogoLib() {
  const wrap = $("#logoLib"); if (!wrap) return;
  M.reveal(wrap, S.logoStyle === "custom", { y: "xs" });
  const list = $("#logoList");
  if (!logo.img) { list.innerHTML = `<p class="empty">${esc(t("vis.noLogo"))}</p>`; return; }
  list.innerHTML = `<div class="item"><img id="logoThumb" alt=""><b>${esc(logo.name || t("vis.yourLogo"))}</b><small>${esc(t(logo.local ? "common.sessionOnly" : "common.saved"))}</small><button class="btn" id="logoDel">${esc(t("common.remove"))}</button></div>`;
  const th = $("#logoThumb"); M.skeleton(th, true); th.onload = th.onerror = () => { M.skeleton(th, false); M.fadeIn(th); }; th.src = logo.img.src;
  $("#logoDel").addEventListener("click", async e => {
    if (!armButton(e.currentTarget, t("common.remove"))) return;
    const old = S.logoAsset;
    logo.img = null; logo.id = ""; logo.ver++; S.logoAsset = "";
    if (old && !Object.values(presets).some(p => p.logoAsset === old)) { const a = await getAssetsNs(); if (a) a.delete(old).catch(() => {}); }
    renderLogoLib(); up.schedulePersist(); requestPreview();
  });
}
$("#logoIn").addEventListener("change", async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  let img;
  try { img = await blobToImage(file); } catch (err) { setStatus(t("common.badImage"), "bad"); return; }
  logo.img = img; logo.name = file.name; logo.local = true; logo.id = ""; logo.ver++;
  S.logoStyle = "custom"; S.logoOn = true; S.logoAsset = "";
  const a = await getAssetsNs();
  if (a) {
    try { const r = await a.upload(file, file.type ? undefined : { type: "image/png" }); S.logoAsset = r.id; logo.id = r.id; logo.local = false; }
    catch (err) { setStatus(t("vis.st.logoNotSaved"), "warn"); }
  }
  syncControl("logoStyle"); syncControl("logoOn"); renderLogoLib(); up.schedulePersist(); requestPreview();
  if (!logo.local) setStatus(t("vis.st.logoSaved"), "ok");
});

Object.assign(up, { renderLogoLib });

/* ===== persist ===== */
// Saving the state, presets and files

let localStamp = 0;
/* ---------- persistence: account (db) + this browser ---------- */
let dbDoc = null, persistTimer = 0, persistPending = false, writing = false, writeAgain = false;
function setSync(state, text) { $("#sync").dataset.s = state; $("#syncText").textContent = text; if (HAL && HAL.setSync) HAL.setSync("visualizer", state, text); }
function payload() {
  return { current: clone(S), presets: clone(presets), fonts: fontLib.filter(f => f.id).map(f => ({ id: f.id, family: f.family, file: f.file })), updatedAt: Date.now() };
}
function sanitize(o) {
  const out = {};
  if (!o || typeof o !== "object") return out;
  for (const k in DEFAULTS) {
    if (!(k in o)) continue;
    const d = DEFAULTS[k], v = o[k], f = FIELD[k];
    if (typeof d === "number") { const n = Number(v); if (isFinite(n)) out[k] = f && f.min !== undefined && f.max !== undefined ? clamp(n, f.min, f.max) : n; }
    else if (typeof d === "boolean") out[k] = !!v;
    else if (f && f.type === "select") { if (f.options.some(([ov]) => ov === String(v))) out[k] = String(v); }
    else if (f && f.type === "font") { if (typeof v === "string" && (v === "s" || /^[gu]:.{1,80}$/.test(v))) out[k] = v; }
    else if (typeof v === "string") out[k] = v.slice(0, k === "logoAsset" ? 64 : 80);
  }
  return out;
}
function applyPayload(p) {
  if (!p) return;
  if (p.current) setS(Object.assign(clone(DEFAULTS), sanitize(p.current)));
  if (p.presets && typeof p.presets === "object") { setPresets({}); for (const n in p.presets) presets[n] = Object.assign(clone(DEFAULTS), sanitize(p.presets[n])); }
  if (Array.isArray(p.fonts)) {
    const keep = fontLib.filter(f => f.local);
    setFontLib(p.fonts.filter(f => f && typeof f.id === "string" && typeof f.family === "string").map(f => ({ id: f.id, family: f.family.slice(0, 60), file: String(f.file || "").slice(0, 120) })));
    for (const f of keep) if (!fontLib.some(x => x.family === f.family)) fontLib.push(f);
  }
  localStamp = p.updatedAt || 0;
}
let localLoaded = false;   // a video kept from before: its own values win over the defaults at start
function loadLocal() { try { const raw = sessionStorage.getItem(LS_KEY); if (raw) { applyPayload(JSON.parse(raw)); localLoaded = true; } } catch (e) {} }
function schedulePersist() { HAL?.session?.schedule("visualizer"); persistPending = true; clearTimeout(persistTimer); persistTimer = setTimeout(persistNow, 700); }
function persistNow() {
  persistPending = false;
  const p = payload(); localStamp = p.updatedAt;
  try { sessionStorage.setItem(LS_KEY, JSON.stringify(p)); } catch (e) {}
  if (dbDoc) writeDb(); else setSync("local", t("sync.local"));
}
async function writeDb() {
  if (writing) { writeAgain = true; return; }
  writing = true; setSync("saving", t("sync.saving"));
  const fail = () => setSync("error", t("sync.error"));
  try { await dbDoc.set(payload()); setSync("cloud", t("sync.saved")); }
  catch (e) {
    if (e && e.code === "unavailable") { await sleep(600 + Math.random() * 800); try { await dbDoc.set(payload()); setSync("cloud", t("sync.saved")); } catch (e2) { fail(); } }
    else fail();
  }
  writing = false;
  if (writeAgain) { writeAgain = false; writeDb(); }
}
function afterBulkChange(persist = true) {
  syncAll(); refreshFontSelects(); renderFontLib(); sizePreview(); updateSpec(); $("#meterHz").textContent = `≤ ${S.bassCutoff} Hz`;
  if (aud.buffer) analyzeBass();
  ensureFonts(); loadLibraryFonts(); if (S.logoAsset) loadLogoAsset(S.logoAsset);
  requestPreview(); if (persist) schedulePersist();
}
async function connectAccount() {
  const [db, user] = await Promise.all([cap("db"), cap("user")]);
  if (!db || !user) { setSync("local", t("sync.local")); return; }
  try {
    const uid = await user.id();
    if (!uid) { setSync("local", t("sync.local")); return; }
    const ref = db.doc("data/users/" + uid + "/prefs");
    const snap = await ref.get();
    dbDoc = ref;
    if (snap.exists) {
      const d = clone(snap.data());
      if ((d.updatedAt || 0) > localStamp) {
        applyPayload(d); renderPresets(); afterBulkChange(false);
        try { sessionStorage.setItem(LS_KEY, JSON.stringify(d)); } catch (e) {}
      } else if ((d.updatedAt || 0) < localStamp) writeDb();
      setSync("cloud", t("sync.saved"));
    } else await writeDb();
  } catch (e) { setSync("local", t("sync.local")); }
}

/* presets */
function renderPresets() {
  if (V.jobs.length) up.renderQueue();
  const names = Object.keys(presets).sort((a, b) => a.localeCompare(b));
  const list = $("#presetList");
  if (!names.length) { list.innerHTML = `<p class="empty">${esc(t("vis.noPresets"))}</p>`; return; }
  list.innerHTML = names.map((n, i) => `<div class="item"><b title="${esc(n)}">${esc(n)}</b><button class="btn" data-apply="${i}">${esc(t("common.apply"))}</button><button class="btn" data-del="${i}">${esc(t("common.delete"))}</button></div>`).join("");
  list.querySelectorAll("[data-apply]").forEach(b => b.addEventListener("click", () => {
    const n = names[+b.dataset.apply]; setS(Object.assign(clone(DEFAULTS), clone(presets[n])));
    afterBulkChange(); setStatus(t("vis.st.presetApplied", { name: n }), "ok");
  }));
  list.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => {
    if (!armButton(b, t("common.delete"))) return;
    delete presets[names[+b.dataset.del]]; renderPresets(); schedulePersist();
  }));
}
$("#presetSave").addEventListener("click", () => {
  const n = $("#presetName").value.trim();
  if (!n) { $("#presetName").focus(); return; }
  presets[n] = clone(S); $("#presetName").value = ""; renderPresets(); schedulePersist();
  setStatus(t("vis.st.presetSaved", { name: n }), "ok");
});
$("#presetName").addEventListener("keydown", e => { if (e.key === "Enter") $("#presetSave").click(); });
$("#resetAll").addEventListener("click", e => {
  const b = e.currentTarget;
  if (b.dataset.armed) { delete b.dataset.armed; b.textContent = t("vis.resetAll"); setS(clone(DEFAULTS)); afterBulkChange(); setStatus(t("vis.st.reset"), "ok"); return; }
  b.dataset.armed = "1"; b.textContent = t("vis.resetConfirm");
  setTimeout(() => { delete b.dataset.armed; b.textContent = t("vis.resetAll"); }, 3500);
});
$("#exportJson").addEventListener("click", () => saveFile("halation-visualizer-settings.json", JSON.stringify({ app: "halation-visualizer", version: 2, current: S, presets }, null, 2)));
$("#importJson").addEventListener("change", async e => {
  const file = e.target.files[0]; e.target.value = "";
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (d.current) setS(Object.assign(clone(DEFAULTS), sanitize(d.current)));
    if (d.presets) for (const n in d.presets) presets[n] = Object.assign(clone(DEFAULTS), sanitize(d.presets[n]));
    afterBulkChange(); renderPresets(); setStatus(t("vis.st.imported"), "ok");
  } catch (err) { setStatus(t("vis.st.badJson"), "bad"); }
});

/* ---------- saving files ---------- */

/* ---------- used by the Library and the other tabs ---------- */
async function flushPersist() {
  if (persistPending) { clearTimeout(persistTimer); persistNow(); }
  while (writing) await sleep(30);
}
async function reloadPresets() {
  if (!dbDoc) return;
  await flushPersist();
  const snap = await dbDoc.get(), d = snap.exists ? snap.data() : null;
  setPresets({});
  if (d && d.presets) for (const n in d.presets) presets[n] = Object.assign(clone(DEFAULTS), sanitize(d.presets[n]));
  renderPresets();
}
async function applyPresetByName(name) {
  if (!presets[name]) await reloadPresets();
  if (!presets[name]) throw new Error(t("vis.err.noPreset", { name }));
  setS(Object.assign(clone(DEFAULTS), clone(presets[name])));
  afterBulkChange(); setStatus(t("vis.st.presetApplied", { name }), "ok");
}

Object.assign(up, { schedulePersist });

/* ===== export ===== */
// Single-video export (WebCodecs + Mediabunny, or real time)

/* ---------- export ---------- */
function safeName(s) { return s.replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, " ").trim() || "visualizer"; }
// File name from the template in Settings ("{title}.mp4" by default)
function exportName(R, ext) {
  const title = (R.ses.title || aud.name.replace(/\.[^.]+$/, "") || t("vis.defaultTitle")).trim(), artist = (R.S.artist || "").trim();
  return HAL ? HAL.fileName("video", { title, artist }, ext) : safeName(title) + "." + ext;
}
function audioSlice(R, buffer, sr) {
  const { start, len } = R.clip, a = Math.floor(start * sr), n = Math.max(1, Math.floor(len * sr));
  const chans = [0, 1].map(c => {
    const src = buffer.getChannelData(Math.min(c, buffer.numberOfChannels - 1));
    const out = new Float32Array(n); out.set(src.subarray(a, Math.min(src.length, a + n))); return out;
  });
  if (R.S.audioFades) {
    const fi = Math.floor(R.S.fadeIn * sr), fo = Math.floor(R.S.fadeOut * sr);
    for (const ch of chans) {
      for (let i = 0; i < fi && i < n; i++) ch[i] *= i / fi;
      for (let i = 0; i < fo && i < n; i++) ch[n - 1 - i] *= i / fo;
    }
  }
  return chans;
}
// Códecs candidatos: H.264 (primero por GPU si Ajustes lo permite) y, si no hay H.264, VP9 dentro del MP4.
// Video codecs to try, in order: H.264 (GPU first unless Settings says CPU) or VP9, both inside MP4.
// Settings can force one codec; "auto" prefers H.264 and falls back to VP9.
async function videoCandidates(W, H, fps, bitrate, codecs = CODEC, encoder = HAL ? HAL.settings().encoder : "auto") {
  if (!("VideoEncoder" in window)) return [];
  const want = codecs.video;
  const accels = encoder === "cpu" ? ["prefer-software", "no-preference"] : ["prefer-hardware", "no-preference"];
  const vp9 = W * H > 2228224 ? "vp09.00.51.08" : "vp09.00.41.08";
  const families = [["avc", ["avc1.640033", "avc1.64002a", "avc1.640028", "avc1.4d0033", "avc1.42e033"]], ["vp9", [vp9]]]
    .filter(([mux]) => want === "auto" || (want === "h264" ? mux === "avc" : mux === "vp9"));
  const out = [];
  for (const [mux, codecs] of families) {
    for (const accel of accels) {
      for (const codec of codecs) {
        const cfg = { codec, width: W, height: H, bitrate, framerate: fps, hardwareAcceleration: accel };
        if (mux === "avc") cfg.avc = { format: "avc" };
        try { const r = await VideoEncoder.isConfigSupported(cfg); if (r.supported) { out.push({ cfg: r.config || cfg, mux, accel }); break; } } catch (e) {}
      }
    }
    if (out.length) break;
  }
  return out;
}
async function pickAudioConfig(codecs = CODEC) {
  if (!("AudioEncoder" in window)) return null;
  const want = codecs.audio;
  const options = [
    { cfg: { codec: "mp4a.40.2", sampleRate: 48000, numberOfChannels: 2, bitrate: 256000 }, mux: "aac" },
    { cfg: { codec: "opus", sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 }, mux: "opus" }
  ].filter(o => want === "auto" || o.mux === want);
  for (const o of options) { try { const r = await AudioEncoder.isConfigSupported(o.cfg); if (r.supported) return o; } catch (e) {} }
  return null;
}
const codecLabel = (v, a) => `${v.mux === "avc" ? "H.264" : "VP9"} + ${a.mux === "aac" ? "AAC" : "Opus"} · ${v.accel === "prefer-hardware" ? "GPU" : "CPU"}`;
// Renders R. With WebCodecs the MP4 is written to disk piece by piece (never whole in memory).
// opts: { direct, ui: { status(msg, kind), progress(p) }, cancelled() }
async function renderVideo(R, buffer, name, opts) {
  await ensureFonts(R.S);
  const { W, H } = outSize(R.S), fps = +R.S.fps, bitrate = videoBitrate(R.S);
  const codecs = R.codecs || CODEC;
  const cands = await videoCandidates(W, H, fps, bitrate, codecs, R.encoder), acfg = await pickAudioConfig(codecs);
  if (codecs.video !== "auto" && !cands.length) throw new Error(t("vis.err.codecMissing", { codec: t("set.codec." + codecs.video) }));
  if (codecs.audio !== "auto" && !acfg) throw new Error(t("vis.err.codecMissing", { codec: t("set.codec." + codecs.audio) }));
  if (cands.length && acfg && HAL) {
    let sink = await HAL.exportOpen(name, opts.direct);
    if (!sink) return { declined: true };
    for (let k = 0; k < cands.length; k++) {
      try {
        const done = await encodeWebCodecs(R, buffer, W, H, fps, cands[k], acfg, sink, opts);
        if (!done) { await sink.abort(); return { cancelled: true }; }
        const size = sink.size(), path = await sink.close();
        return { path, name: String(path).split(/[\\/]/).pop(), size, codecs: codecLabel(cands[k], acfg) };
      } catch (e) {
        await sink.abort();
        if (k === cands.length - 1) throw e;
        console.warn("codec rejected, trying the next one", cands[k], e);
        opts.ui.status(t("vis.st.codecRetry"), "warn");
        sink = await sink.reopen();
        if (!sink) return { declined: true };
      }
    }
  }
  // Sin WebCodecs: grabación en tiempo real y guardado del archivo completo
  const r = await encodeRealtime(R, buffer, W, H, fps, bitrate, opts);
  if (!r.blob) return { cancelled: true };
  const saved = await saveFile_util(name.replace(/\.mp4$/i, "." + r.ext), r.blob, { direct: opts.direct, quiet: true });
  return { path: saved.path, name: saved.name, size: r.blob.size, codecs: r.ext.toUpperCase() };
}
async function encodeWebCodecs(R, buffer, W, H, fps, vcfg, acfg, sink, opts) {
  const sr = 48000, { start, len } = R.clip, ui = opts.ui;
  // MP4 written by Mediabunny as it goes: every write lands at its position in the file on disk
  const output = new MB.Output({
    format: new MB.Mp4OutputFormat({ fastStart: false }),
    target: new MB.StreamTarget(new WritableStream({ write: c => sink.write(c.data, c.position) }), { chunked: true, chunkSize: window.__halChunkSize || 8 * 1024 * 1024 })
  });
  const vsrc = new MB.EncodedVideoPacketSource(vcfg.mux), asrc = new MB.EncodedAudioPacketSource(acfg.mux);
  output.addVideoTrack(vsrc, { frameRate: fps }); output.addAudioTrack(asrc);
  await output.start();
  // packets reach the muxer in encoder order; muxErr stops the render when the muxer fails
  let encErr = null, vq = Promise.resolve(), aq = Promise.resolve(), vPending = 0;
  const fail = e => { encErr = encErr || e; };
  const venc = new VideoEncoder({ output: (c, m) => { vPending++; vq = vq.then(() => vsrc.add(MB.EncodedPacket.fromEncodedChunk(c), m)).catch(fail).then(() => { vPending--; }); }, error: fail });
  venc.configure(vcfg.cfg);
  const aenc = new AudioEncoder({ output: (c, m) => { aq = aq.then(() => asrc.add(MB.EncodedPacket.fromEncodedChunk(c), m)).catch(fail); }, error: fail });
  aenc.configure(acfg.cfg);
  const closeAll = () => { try { venc.close(); } catch (e) {} try { aenc.close(); } catch (e) {} if (output.state !== "finalized") output.cancel().catch(() => {}); };

  try {
    ui.status(t("vis.st.encodingAudio"));
    const [L, Rch] = audioSlice(R, buffer, sr), CH = 4800;
    for (let i = 0; i < L.length; i += CH) {
      const n = Math.min(CH, L.length - i), data = new Float32Array(n * 2);
      data.set(L.subarray(i, i + n), 0); data.set(Rch.subarray(i, i + n), n);
      const ad = new AudioData({ format: "f32-planar", sampleRate: sr, numberOfFrames: n, numberOfChannels: 2, timestamp: Math.round(i / sr * 1e6), data });
      aenc.encode(ad); ad.close();
      if (encErr) throw encErr;
    }
    await aenc.flush();
    if (encErr) throw encErr;

    const canvas = mk(W, H), ctx = canvas.getContext("2d", { alpha: false });
    const A = getAssets({}, ctx, W, H, R);
    const total = Math.max(1, Math.round(len * fps)), t0 = performance.now();
    const how = codecLabel(vcfg, acfg);
    for (let i = 0; i < total; i++) {
      if (opts.cancelled()) { closeAll(); return false; }
      if (encErr) throw encErr;
      renderFrame(ctx, W, H, start + i / fps, R, A, i, false);
      const vf = new VideoFrame(canvas, { timestamp: Math.round(i * 1e6 / fps), duration: Math.round(1e6 / fps) });
      venc.encode(vf, { keyFrame: i % (fps * 2) === 0 });
      vf.close();
      while (venc.encodeQueueSize > 6 || vPending > 12) await sleep(1);
      if (sink.pending() > 64 * 1024 * 1024) await sink.drain();
      if (i % 8 === 0) {
        const el = (performance.now() - t0) / 1000, speed = (i / fps) / Math.max(0.001, el);
        ui.progress(i / total);
        ui.status(t("vis.st.rendering", { pct: Math.round(i / total * 100), speed: speed.toFixed(1), left: fmtTime(speed > 0 ? (len - i / fps) / speed : 0, false), codec: how }));
        await sleep(0);
      }
    }
    ui.status(t("vis.st.finishing"));
    await venc.flush();
    await vq; await aq;
    if (encErr) throw encErr;
    await output.finalize();
    closeAll();
    return true;
  } catch (e) { closeAll(); throw e; }
}
async function encodeRealtime(R, buffer, W, H, fps, bitrate, opts) {
  if (!("MediaRecorder" in window) || !HTMLCanvasElement.prototype.captureStream) throw new Error(t("vis.err.noEncoder"));
  const mime = ["video/mp4;codecs=avc1.640028,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"].find(t => MediaRecorder.isTypeSupported(t));
  if (!mime) throw new Error(t("vis.err.noRecorder"));
  const ext = mime.startsWith("video/mp4") ? "mp4" : "webm", { start, len } = R.clip;
  const canvas = mk(W, H), ctx = canvas.getContext("2d", { alpha: false }), A = getAssets({}, ctx, W, H, R);
  renderFrame(ctx, W, H, start, R, A, 0, false);
  const ac = new AudioContext({ sampleRate: 48000 });
  const [L, Rch] = audioSlice(R, buffer, 48000);
  const ab = ac.createBuffer(2, L.length, 48000); ab.copyToChannel(L, 0); ab.copyToChannel(Rch, 1);
  const src = ac.createBufferSource(); src.buffer = ab;
  const dest = ac.createMediaStreamDestination(); src.connect(dest);
  const stream = new MediaStream([...canvas.captureStream(fps).getVideoTracks(), ...dest.stream.getAudioTracks()]);
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: bitrate, audioBitsPerSecond: 256000 });
  const chunks = []; rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  const done = new Promise(r => rec.onstop = r);
  await ac.resume(); rec.start(1000);
  const tStart = ac.currentTime + 0.05; src.start(tStart);
  let frame = 0;
  await new Promise(resolve => {
    const tick = () => {
      if (opts.cancelled()) return resolve();
      const el = ac.currentTime - tStart;
      if (el >= len) return resolve();
      renderFrame(ctx, W, H, start + Math.max(0, el), R, A, frame++, false);
      opts.ui.progress(el / len); opts.ui.status(t("vis.st.realtime", { format: ext.toUpperCase(), time: fmtTime(el, false), total: fmtTime(len, false) }), "warn");
      requestAnimationFrame(tick);
    };
    tick();
  });
  rec.stop(); try { src.stop(); } catch (e) {}
  await done; ac.close();
  if (opts.cancelled()) return { blob: null, ext };
  return { blob: new Blob(chunks, { type: mime.split(";")[0] }), ext };
}

function videoThumb(R) {
  try {
    const { W, H } = outSize(R.S), s = 360 / Math.max(W, H), w = Math.round(W * s), h = Math.round(H * s);
    const c = mk(w, h), x = c.getContext("2d");
    renderFrame(x, w, h, R.clip.start + R.clip.len * 0.35, R, getAssets({}, x, w, h, R), 1, true);
    return c.toDataURL("image/jpeg", 0.8);
  } catch (e) { return ""; }
}
// An export as a job of the jobs system (docs/JOBS_SPEC.md §8): the processes island shows its progress and its end,
// a cancel from the tray stops it like the Cancel button; each export owns its renderer.
// Without the jobs system (the page alone) it runs straight.
const isCancel = e => !!e && (e.cancelled || e.name === "AbortError");
function asJob(o, body) {
  if (!HAL || !HAL.jobs) return body({ progress() {}, output() {}, signal: null, id: null });
  // done settles after the renderer and its bound resources have stopped and removed their partial files
  let ran = null;
  // Each export owns its canvases and encoders; CPU capacity controls how many run together (JOBS_SPEC §10.2).
  const h = HAL.jobs.submit(Object.assign({ tool: "visualizer", lane: "cpu", host: "page" }, o, { run: ctx => (ran = Promise.resolve(body(ctx))) }));
  V.live.add(h.id); h.done.catch(() => {}).then(() => V.live.delete(h.id));
  if (o.btn && HAL.jobLaunched) HAL.jobLaunched(o.btn, h, { thumb: o.thumb, tool: "visualizer" });
  return h.done.catch(async e => { if (ran && isCancel(e)) await ran.catch(() => {}); throw e; });
}
const stopped = ctx => () => ctx.signal ? ctx.signal.aborted : V.cancelFlag;
async function exportVideo() {
  if (!art.img || !aud.buffer) return;
  await HAL?.session?.start("visualizer");
  pause();
  const R = frozenR(), buffer = aud.buffer;         // settings are frozen here
  V.exports++; V.exporting = true; V.cancelFlag = false; V.lastExport = null;
  M.reveal($("#cancelBtn"), true); $("#saveAgain").hidden = true; $("#recTag").hidden = false;
  setProgress(0); setStatus(t("vis.st.preparing"));
  let t0 = performance.now();
  try {
    const name = exportName(R, "mp4");
    const res = await asJob({ kind: "export-video", title: name, thumb: videoThumb(R), btn: $("#exportBtn") }, async ctx => {
      t0 = performance.now();
      const r = await renderVideo(R, buffer, name, { direct: false, cancelled: stopped(ctx), ui: { status: setStatus, progress: p => { setProgress(p); ctx.progress(p); } } });
      if (r.path) ctx.output(r.path, { kind: "video" });
      return r;
    });
    if (res.declined) setStatus(t("common.saveCancelled"), "warn");
    else if (res.cancelled) setStatus(t("vis.st.exportCancelled"));
    else {
      V.lastExport = res; setProgress(1);
      const secs = Math.round((performance.now() - t0) / 1000);
      setStatus(t("vis.st.videoSaved", { name: res.name, size: fmtMB(res.size), time: fmtTime(secs, false), codec: res.codecs }), "ok");
      M.reveal($("#saveAgain"), !!res.path); M.reveal($("#sendVideoBtn"), !!res.path && !!HAL);
      if (HAL && res.path) HAL.session.recordExport("visualizer", { path: res.path, name: res.name, kind: "video", thumb: videoThumb(R) });
    }
  } catch (e) {
    if (isCancel(e)) setStatus(t("vis.st.exportCancelled"));
    else { console.warn(e); setStatus(t("vis.st.exportFailed", { error: e && e.message ? e.message : e }), "bad"); }
  } finally {
    V.exports--; V.exporting = V.exports > 0 || V.queueRunning; updateReady(); M.reveal($("#cancelBtn"), V.exports > 0); $("#recTag").hidden = !V.exporting;
    if (!V.lastExport) setProgress(null);
  }
}

/* ===== layers ===== */
// Export in layers through FFmpeg

/* ---------- export in layers ----------
   Each frame is rendered once into four canvases that each hold one pass of the full render, and every pass
   goes to its own FFmpeg process (encoder.js), so the files encode in parallel while the next frame renders.
   Composited in an editor (bottom to top, Normal, and Overlay for a separate finish) they give the full render:
   · the vignette darkens only the background in the full render, so it stays in 01 Background;
   · the glow is drawn with "screen" in the full render; as a Normal layer its colour is screen(background, glow
     colour) with the glow's alpha, which composites to exactly the same result;
   · grain ("overlay") is either applied to each layer (baked) or exported as a separate layer over 50 % grey
     that gives the same result in Overlay mode;
   · the fade to black scales the colour of every layer (Normal compositing is linear in colour). */
const LAYER_FILES = { bg: "01 Background", cover: "02 Cover", text: "03 Text", finish: "04 Finish", audio: "05 Audio", env: "06 Bass envelope" };
function layerCanvases(W, H) {
  const o = {};
  for (const k of ["bg", "cover", "text", "finish", "tmp", "grain"]) { const c = mk(W, H); o[k] = { c, x: c.getContext("2d", { willReadFrequently: true }) }; }
  return o;
}
function clipRect(r, W, H) {
  const x0 = clamp(Math.floor(r.x), 0, W), y0 = clamp(Math.floor(r.y), 0, H), x1 = clamp(Math.ceil(r.x + r.w), 0, W), y1 = clamp(Math.ceil(r.y + r.h), 0, H);
  return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 1, h: 1 };
}
// Draws the passes of one frame. opt: { want: { cover, text, finish }, finish: "baked" | "overlay" }.
// Returns the rectangle each pass can touch, the grain strength to bake in and the fade.
function renderLayers(L, W, H, t, R, A, seed, opt) {
  const F = frameState(W, H, t, R), full = { x: 0, y: 0, w: W, h: H }, rects = { bg: full };
  const bg = L.bg.x; resetCtx(bg); drawBackground(bg, W, H, R, A, F);
  if (opt.want.cover) {
    const x = L.cover.x; resetCtx(x); x.clearRect(0, 0, W, H);
    if (F.glowA > 0.005) {
      const tx = L.tmp.x; resetCtx(tx); tx.drawImage(L.bg.c, 0, 0);
      tx.globalCompositeOperation = "screen"; tx.fillStyle = glowColor(R); tx.fillRect(0, 0, W, H);
      drawGlow(x, A, F);
      x.globalCompositeOperation = "source-in"; x.drawImage(L.tmp.c, 0, 0); x.globalCompositeOperation = "source-over";
    }
    drawCoverPart(x, A, F);
    rects.cover = clipRect(coverRect(A, F), W, H);
  }
  if (opt.want.text) {
    const x = L.text.x; resetCtx(x); x.clearRect(0, 0, W, H);
    const b = drawTextBlock(x, W, H, t, F.ee, R, A, F.geom, F.u);
    rects.text = b ? clipRect(b, W, H) : { x: 0, y: 0, w: 1, h: 1 };
  }
  const grain = F.P.grain > 0 && !!A.grain;
  if (opt.finish === "overlay" && opt.want.finish) {
    const x = L.finish.x; resetCtx(x); x.fillStyle = "#808080"; x.fillRect(0, 0, W, H);
    drawGrain(x, W, H, A, F.P, F.u, seed);
    rects.finish = full;
  }
  const grainK = opt.finish === "baked" && grain ? F.P.grain / 100 * 0.7 : 0;
  if (grainK) { const gx = L.grain.x; resetCtx(gx); gx.clearRect(0, 0, W, H); drawGrain(gx, W, H, A, F.P, F.u, seed, 1); }
  return { rects, grainK, fade: fadeAt(R, t) };
}
// Pixels of one pass, with the baked grain ("overlay" of the grain value, as the full render) and the fade
function layerPixels(L, k, rect, grainK, fade) {
  const d = L[k].x.getImageData(rect.x, rect.y, rect.w, rect.h).data;
  if (!grainK && fade >= 1) return d;
  const g = grainK ? L.grain.x.getImageData(rect.x, rect.y, rect.w, rect.h).data : null;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    for (let c = 0; c < 3; c++) {
      let v = d[i + c];
      if (g) { const gv = g[i]; const ov = v < 128 ? 2 * v * gv / 255 : 255 - 2 * (255 - v) * (255 - gv) / 255; v += grainK * (ov - v); }
      d[i + c] = v * fade;          // Uint8ClampedArray rounds to the nearest level
    }
  }
  return d;
}
function sameBytes(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  const x = new Uint32Array(a.buffer, a.byteOffset, a.length >> 2), y = new Uint32Array(b.buffer, b.byteOffset, b.length >> 2);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
// What the layer export writes: [{ key, name, format, alpha }]
function layerPlan(X) {
  const out = [];
  if (X.want.bg) out.push({ key: "bg", name: LAYER_FILES.bg, format: "h264", blend: "normal" });
  if (X.want.cover) out.push({ key: "cover", name: LAYER_FILES.cover, format: X.format, blend: "normal" });
  if (X.want.text) out.push({ key: "text", name: LAYER_FILES.text, format: X.format, blend: "normal" });
  // the finish layer is opaque (grain over grey): MP4 like the background; ProRes of noise is ~1.2 Gbit/s at 1080p
  if (X.finish === "overlay" && X.want.finish) out.push({ key: "finish", name: LAYER_FILES.finish, format: "h264", blend: "overlay" });
  if (X.audio) out.push({ key: "audio", name: LAYER_FILES.audio, format: "wav" });
  if (X.envelope) out.push({ key: "env", name: LAYER_FILES.env, format: "gray" }, { key: "csv", name: LAYER_FILES.env, format: "csv" });
  return out;
}
// Bits per pixel and frame of each file, measured on Visualizer exports (docs/ARCHITECTURE.md → Export). Grain is noise and
// costs the most: it multiplies the size of whatever carries it.
function layerBits(key, format, P, W, H, X) {
  const g = P.grain > 0 ? P.grain : 0, baked = X.finish === "baked" ? g : 0;
  const px = P.coverSize / 100 * Math.min(W, H), cover = Math.min(1, Math.pow(px * (1.3 + P.glow / 250), 2) / (W * H));
  const B = {
    h264: { bg: 0.07 + 0.08 * baked, finish: 0.1 + 0.04 * g, env: 0.002 },
    prores4444: { cover: cover * (9.5 + 0.9 * baked), text: 0.3 + 0.01 * baked, finish: 0.2 + 0.58 * g },
    webm: { cover: cover * (0.06 + 0.02 * baked), text: 0.006 + 0.001 * baked, finish: 0.02 + 0.04 * g },
    png: { cover: cover * (10 + 0.5 * baked), text: 0.6 + 0.1 * baked, finish: 2 + 0.6 * g }
  };
  return (B[format] || {})[key];
}
function layerEstimates(X, R, E) {
  const { W, H } = outSize(R.S), fps = +R.S.fps, frames = Math.max(1, Math.round(R.clip.len * fps)), seconds = frames / fps;
  return layerPlan(X).map(f => {
    const ext = f.format === "csv" ? "csv" : E.FORMATS[f.format].ext;
    const bits = f.format === "h264" || f.format === "gray" ? layerBits(f.key, "h264", R.S, W, H, X) : layerBits(f.key, f.format, R.S, W, H, X);
    const bytes = f.format === "csv" ? frames * 22 : bits != null ? bits / 8 * W * H * fps * seconds : E.estimate(f.format, { width: W, height: H, fps, seconds });
    return { ...f, file: f.name + (f.format === "png" ? "" : "." + ext), bytes: Math.round(bytes) };
  });
}
function importNotes(R, X, files, frames) {
  const { W, H } = outSize(R.S), fps = +R.S.fps, title = (R.ses.title || aud.name || "").trim();
  const lines = [t("vis.notes.title", { title }), "", t("vis.notes.spec", { w: W, h: H, fps, time: fmtTime(frames / fps), frames }), "", t("vis.notes.order")];
  for (const f of files.filter(f => f.blend)) lines.push(`  ${f.file} — ${t("vis.notes.blend." + f.blend)}${f.format === "h264" ? " · " + t("vis.notes.opaque") : ""}`);
  lines.push("", t("vis.notes.alpha", { format: X.format === "png" ? "PNG" : X.format === "webm" ? "WebM VP9" : "ProRes 4444" }));
  lines.push(t(X.finish === "overlay" ? "vis.notes.overlay" : "vis.notes.baked"));
  if (X.want.cover && R.S.glow + R.S.glowPulse > 0) lines.push(t("vis.notes.glow"));
  if (X.audio) lines.push(t("vis.notes.audio"));
  if (X.envelope) lines.push(t("vis.notes.env"));
  lines.push("", t("vis.notes.frozen"));
  return lines.join("\r\n") + "\r\n";
}
// Renders R in layers into a new folder. opts: { ui: { status, progress }, cancelled() }
async function exportLayers(R, buffer, X, opts) {
  const HALx = HAL, E = HALx.encoder;
  await ensureFonts(R.S);
  const { W, H } = outSize(R.S), fps = +R.S.fps, { start } = R.clip;
  const frames = Math.max(1, Math.round(R.clip.len * fps)), seconds = frames / fps;
  const title = (R.ses.title || aud.name.replace(/\.[^.]+$/, "") || t("vis.defaultTitle")).trim();
  const dir = await E.folder(`${title} - layers`);
  const plan = layerEstimates(X, R, E), encs = {};
  const t0 = performance.now();
  try {
    for (const f of plan) {
      if (f.format === "csv") continue;
      const o = { file: E.join(dir, f.name), width: W, height: H, fps };
      if (f.format === "h264") o.crf = 16; // opaque passes must remain within the layer-composite fidelity limit
      if (f.format === "wav") o.input = { audio: true, rate: 48000, channels: 2 };
      if (f.format === "gray") o.input = { pix: "gray", width: 16, height: 16 };
      encs[f.key] = await (opts.encoder || E.open)(f.format, o);
    }
    // audio of the clip, exactly as long as the video
    if (encs.audio) {
      opts.ui.status(t("vis.st.encodingAudio"));
      const sr = 48000, n = Math.round(seconds * sr), [Lc, Rc] = audioSlice(R, buffer, sr), CH = sr;
      for (let i = 0; i < n; i += CH) {
        const m = Math.min(CH, n - i), chunk = new Float32Array(m * 2);
        for (let j = 0; j < m; j++) { chunk[j * 2] = Lc[i + j] || 0; chunk[j * 2 + 1] = Rc[i + j] || 0; }
        await encs.audio.write(new Uint8Array(chunk.buffer));
      }
    }
    // bass envelope: one grey value per frame, as a video and as a CSV
    const envAt0 = i => (R.env ? envAt(R, start + i / fps) : 0);
    if (encs.env) {
      const B = 16 * 16, batch = 240;
      for (let i = 0; i < frames; i += batch) {
        const m = Math.min(batch, frames - i), buf = new Uint8Array(m * B);
        for (let j = 0; j < m; j++) buf.fill(Math.round(clamp(envAt0(i + j), 0, 1) * 255), j * B, (j + 1) * B);
        await encs.env.write(buf);
      }
    }
    const L = layerCanvases(W, H), A = getAssets({}, L.bg.x, W, H, R);
    const want = { cover: !!encs.cover, text: !!encs.text, finish: !!encs.finish };
    const videos = ["bg", "cover", "text", "finish"].filter(k => encs[k]);
    const prev = {};
    for (let i = 0; i < frames; i++) {
      if (opts.cancelled()) throw { cancelled: true };
      const tt = start + i / fps;
      const fr = renderLayers(L, W, H, tt, R, A, i, { want, finish: X.finish });
      await Promise.all(videos.map(k => {
        const rect = fr.rects[k], d = layerPixels(L, k, rect, k === "finish" ? 0 : fr.grainK, k === "finish" ? 1 : fr.fade);
        const p = prev[k], isSame = p && p.rect.x === rect.x && p.rect.y === rect.y && p.rect.w === rect.w && p.rect.h === rect.h && sameBytes(p.d, d);
        prev[k] = { rect, d };
        if (isSame) return encs[k].same();
        return encs[k].write(d, rect.w === W && rect.h === H ? null : rect);
      }));
      if (i % 4 === 0 || i === frames - 1) {
        const done = Math.min(...videos.map(k => encs[k].encoded || 0)), el = (performance.now() - t0) / 1000, speed = (i + 1) / fps / Math.max(0.001, el);
        opts.ui.progress(Math.min(i + 1, done) / frames * 0.97);
        opts.ui.status(t("vis.st.layersRendering", { n: i + 1, total: frames, done, speed: speed.toFixed(2), left: fmtTime(speed > 0 ? (frames - i - 1) / fps / speed : 0, false) }));
        await sleep(0);
      }
    }
    opts.ui.status(t("vis.st.finishing"));
    const results = {};
    for (const k in encs) results[k] = await encs[k].finish();
    const files = plan.map(f => ({ ...f }));
    if (X.envelope) {
      const rows = ["frame,time_s,bass"];
      for (let i = 0; i < frames; i++) rows.push(`${i},${(i / fps).toFixed(4)},${envAt0(i).toFixed(4)}`);
      await HALx.writeFile(E.join(dir, LAYER_FILES.env + ".csv"), new Blob([rows.join("\r\n") + "\r\n"], { type: "text/csv" }));
    }
    await HALx.writeFile(E.join(dir, "IMPORT NOTES.txt"), new Blob([importNotes(R, X, files, frames)], { type: "text/plain" }));
    await HALx.exportLocation.success(dir);
    const size = Object.values(results).reduce((n, r) => n + (r.size || 0), 0);
    opts.ui.progress(1);
    return { dir, results, size, frames, seconds: (performance.now() - t0) / 1000, name: dir.split(/[\\/]/).pop(), bg: results.bg ? results.bg.path : "" };
  } catch (e) {
    for (const k in encs) await encs[k].abort();
    await E.removeFolder(dir);
    if (e && e.cancelled) return { cancelled: true };
    throw e;
  }
}

/* ===== dialog ===== */
// Export dialog: single video or layers

/* ---------- export dialog: single video or layers ---------- */
// Choices of the dialog, kept between sessions (Settings\app.json, key "visualizerExport")
const X = { mode: "single", want: { bg: true, cover: true, text: true, finish: true }, format: "prores4444", finish: "baked", audio: true, envelope: false };
const xd = M.dialog($("#xDialog"));
function sanitizeX(o) {
  if (!o || typeof o !== "object") return;
  if (["single", "layers"].includes(o.mode)) X.mode = o.mode;
  if (o.want && typeof o.want === "object") for (const k in X.want) if (k in o.want) X.want[k] = !!o.want[k];
  if (["prores4444", "webm", "png"].includes(o.format)) X.format = o.format;
  if (["baked", "overlay"].includes(o.finish)) X.finish = o.finish;
  if ("audio" in o) X.audio = !!o.audio;
  if ("envelope" in o) X.envelope = !!o.envelope;
}
const textShown = () => (S.textOn && !!((session.title || "").trim() || (S.artist || "").trim())) || S.logoOn;
// What the layer export will write with the current choices
function effectiveX() {
  const x = clone(X);
  if (x.finish !== "overlay") x.want.finish = false;
  if (!textShown()) x.want.text = false;
  return x;
}
let ffmpegReady = null;
async function refreshFfmpeg(fresh) {
  if (!HAL) return;
  try { ffmpegReady = !!(await HAL.tools(fresh)).ffmpeg; } catch (e) { ffmpegReady = false; }
  syncDialog();
}
let spaceGen = 0;
function syncDialog() {
  const layers = X.mode === "layers";
  $("#xMode").querySelectorAll("[data-mode]").forEach(b => { b.setAttribute("aria-checked", String(b.dataset.mode === X.mode)); b.setAttribute("aria-selected", String(b.dataset.mode === X.mode)); });
  const turned = $("#xLayers").hidden === layers;
  $("#xSingle").hidden = layers; $("#xLayers").hidden = !layers;
  if (turned) M.enter(layers ? $("#xLayers") : $("#xSingle"));
  $("#xSpec").innerHTML = $("#spec").innerHTML;
  for (const k of ["bg", "cover", "text", "finish"]) $("#xW" + k).checked = X.want[k];
  const txt = textShown();
  $("#xWtext").disabled = !txt; if (!txt) $("#xWtext").checked = false;
  $("#xTextNote").textContent = t(txt ? "vis.x.l.textNote" : "vis.x.l.textOff");
  $("#xWfinish").disabled = X.finish !== "overlay"; if (X.finish !== "overlay") $("#xWfinish").checked = false;
  $("#xFinishNote").textContent = t(X.finish !== "overlay" ? "vis.x.l.finishBaked" : S.grain > 0 ? "vis.x.l.finishNote" : "vis.x.l.finishNoGrain");
  $("#xFormat").value = X.format;
  $("#xVcodec").value = CODEC.video; $("#xAcodec").value = CODEC.audio;
  document.querySelectorAll('input[name="xFinish"]').forEach(r => { r.checked = r.value === X.finish; });
  $("#xAudio").checked = X.audio; $("#xEnv").checked = X.envelope;
  M.reveal($("#xFf"), layers && ffmpegReady === false, { y: "xs" });
  const ex = effectiveX(), any = ex.want.bg || ex.want.cover || ex.want.text || ex.want.finish || ex.audio || ex.envelope;
  $("#xGo").disabled = !hasMedia() || (layers && (!any || ffmpegReady === false));
  $("#xGo").textContent = t(layers ? "vis.x.goLayers" : "vis.x.go");
  if (layers) renderEstimates(ex);
}
const hasMedia = () => !!(aud.buffer && art.img);
// Size of each file and in total, and the free space of the drive
async function renderEstimates(ex) {
  if (!HAL || !HAL.encoder || !aud.buffer) { $("#xFiles").innerHTML = ""; return; }
  const E = HAL.encoder, R = liveR(), list = layerEstimates(ex, R, E), total = list.reduce((n, f) => n + f.bytes, 0);
  const title = (session.title || aud.name.replace(/\.[^.]+$/, "") || t("vis.defaultTitle")).trim();
  $("#xFiles").innerHTML = `<div class="xfile"><code>${esc(t("vis.x.folder", { name: title + " - layers" }))}</code></div>` +
    list.map(f => `<div class="xfile"><code>${esc(f.file)}</code><span>≈ ${esc(fmtBytes(f.bytes))}</span></div>`).join("") +
    `<div class="xfile total"><b>${esc(t("vis.x.total"))}</b><span>≈ ${esc(fmtBytes(total))}</span></div>`;
  const gen = ++spaceGen, el = $("#xSpace");
  let free = null;
  try { free = await E.freeSpace(); } catch (e) {}
  if (gen !== spaceGen) return;
  if (free == null) { el.className = "status"; el.textContent = ""; return; }
  const tight = total * 1.1 > free;
  el.className = "status " + (tight ? "bad" : "ok");
  el.textContent = t(tight ? "vis.x.noSpace" : "vis.x.space", { free: fmtBytes(free), total: fmtBytes(total) });
}
const fmtBytes = b => b >= 1e9 ? (b / 1e9).toFixed(b >= 1e10 ? 0 : 1) + " GB" : b >= 1e6 ? (b / 1e6).toFixed(b >= 1e7 ? 0 : 1) + " MB" : Math.max(1, Math.round(b / 1e3)) + " kB";
function saveX() { if (HAL) HAL.invoke("state_set", { key: "visualizerExport", value: X }).catch(() => {}); }
$("#xMode").addEventListener("click", e => { const b = e.target.closest("[data-mode]"); if (!b) return; X.mode = b.dataset.mode; syncDialog(); if (X.mode === "layers" && ffmpegReady == null) refreshFfmpeg(false); });
for (const k of ["bg", "cover", "text", "finish"]) $("#xW" + k).addEventListener("change", e => { X.want[k] = e.target.checked; syncDialog(); });
$("#xFormat").addEventListener("change", e => { X.format = e.target.value; syncDialog(); });
$("#xVcodec").addEventListener("change", e => { CODEC.video = e.target.value; });
$("#xAcodec").addEventListener("change", e => { CODEC.audio = e.target.value; });
document.querySelectorAll('input[name="xFinish"]').forEach(r => r.addEventListener("change", () => { if (r.checked) { X.finish = r.value; if (X.finish === "overlay") X.want.finish = true; syncDialog(); } }));
$("#xAudio").addEventListener("change", e => { X.audio = e.target.checked; syncDialog(); });
$("#xEnv").addEventListener("change", e => { X.envelope = e.target.checked; syncDialog(); });
$("#xFfGet").addEventListener("click", async () => {
  const b = $("#xFfGet"), st = $("#xFfStatus");
  b.disabled = true; M.show($("#xFfProg")); st.className = "status warn"; st.textContent = t("dl.installing");
  try {
    await HAL.installTool("ffmpeg", p => { if (p.total) M.bar($("#xFfBar"), p.done / p.total); st.textContent = t("dl.installingFile", { file: p.file, mb: (p.done / 1e6).toFixed(1) }); });
    st.className = "status ok"; st.textContent = t("vis.x.ffReady"); retryLabel(b, "vis.x.ffGet", false);
  } catch (e) { st.className = "status bad"; st.textContent = t("vis.x.ffFailed", { error: String(e && e.message || e) }); retryLabel(b, "vis.x.ffGet", true); }
  b.disabled = false; M.hide($("#xFfProg"));
  await refreshFfmpeg(true);
});
function openExportDialog() {
  if (!hasMedia()) return;
  syncDialog();
  if (X.mode === "layers") refreshFfmpeg(true);
  xd.showFrom($("#exportBtn"));
}
xd.addEventListener("close", () => {
  if (xd.returnValue !== "go") return;
  saveX();
  if (X.mode === "layers") exportVideoLayers(); else exportVideo();
});
$("#exportBtn").addEventListener("click", openExportDialog);
if (HAL) HAL.invoke("state_get", { key: "visualizerExport" }).then(sanitizeX).catch(() => {});

async function exportVideoLayers() {
  await HAL?.session?.start("visualizer");
  if (!hasMedia() || !HAL || !HAL.encoder) return;
  pause();
  const R = frozenR(), buffer = aud.buffer, XX = effectiveX();       // settings and choices are frozen here
  V.exports++; V.exporting = true; V.cancelFlag = false; V.lastExport = null;
  M.reveal($("#cancelBtn"), true); $("#saveAgain").hidden = true; $("#recTag").hidden = false;
  setProgress(0); setStatus(t("vis.st.preparing"));
  try {
    if (!(await HAL.tools(true)).ffmpeg) throw new Error(t("vis.x.ffNeeded"));
    const res = await asJob({ kind: "export-layers", title: exportName(R, "mp4").replace(/\.mp4$/, ""), thumb: videoThumb(R), btn: $("#exportBtn") }, async ctx => {
      const r = await exportLayers(R, buffer, XX, { encoder: ctx.encoder && ctx.encoder.bind(ctx), cancelled: stopped(ctx), ui: { status: setStatus, progress: p => { setProgress(p); ctx.progress(p); } } });
      if (r.dir) ctx.output(r.bg || r.dir, { kind: "video" });
      return r;
    });
    if (res.cancelled) setStatus(t("vis.st.exportCancelled"));
    else {
      V.lastExport = { path: res.dir }; setProgress(1);
      const n = Object.keys(res.results).length + (XX.envelope ? 1 : 0) + 1;
      setStatus(t("vis.st.layersSaved", { n, name: res.name, size: fmtMB(res.size), time: fmtTime(Math.round(res.seconds), false) }), "ok");
      M.reveal($("#saveAgain"), true);
      window.__halLastLayers = res;
      if (res.bg) HAL.session.recordExport("visualizer", { path: res.bg, name: res.name + " · " + LAYER_FILES.bg + ".mp4", kind: "video", thumb: videoThumb(R) });
    }
  } catch (e) {
    if (isCancel(e)) setStatus(t("vis.st.exportCancelled"));
    else { console.warn(e); setStatus(t("vis.st.exportFailed", { error: e && e.message ? e.message : e }), "bad"); }
  } finally {
    V.exports--; V.exporting = V.exports > 0 || V.queueRunning; updateReady(); M.reveal($("#cancelBtn"), V.exports > 0); $("#recTag").hidden = !V.exporting;
    if (!V.lastExport) setProgress(null);
  }
}
// Cancel: this tool's exports, running or still queued
const cancelAll = () => { V.cancelFlag = true; if (HAL && HAL.jobs) for (const id of [...V.live]) HAL.jobs.cancel(id); };
$("#cancelBtn").addEventListener("click", () => { cancelAll(); setStatus(t("common.cancelling")); });
$("#saveAgain").addEventListener("click", () => { if (V.lastExport && V.lastExport.path && HAL) HAL.invoke("reveal_path", { path: V.lastExport.path }).catch(e => setStatus(String(e), "bad")); });
// The video just rendered, to another tool; its frame can come back as the cover
window.__ui.sendMenu($("#sendVideoBtn"), { kind: "video", from: "visualizer", item: () => V.lastExport && V.lastExport.path ? { path: V.lastExport.path, name: V.lastExport.name } : null });

/* ===== queue ===== */
// Export queue: several songs in a row

/* ---------- cola de exportación: varios vídeos seguidos ---------- */
const isAudioFile = f => /^audio\//.test(f.type) || /\.(mp3|wav|flac|m4a|aac|ogg|opus|aiff?)$/i.test(f.name);
let jobSeq = 0, pickCoverFor = null;
const jobTitle = name => name.replace(/\.[^.]+$/, "").replace(/_+/g, " ").trim();
async function coverFromFile(file) {
  const url = URL.createObjectURL(file);
  return { img: await loadImage(url), thumb: url, name: file.name, file };
}
function currentCover() { return { file: art.file, img: art.img, cut: art.cut, thumb: art.img ? $("#artThumb").src : "", name: art.name }; }
async function queueAudios(files, coverFile) {
  let cover = currentCover();
  if (coverFile) { try { cover = await coverFromFile(coverFile); } catch (e) { setQueueStatus(t("vis.q.badCover"), "warn"); } }
  for (const f of Array.from(files).filter(isAudioFile)) V.jobs.push({ id: ++jobSeq, file: f, title: jobTitle(f.name), cover, preset: "", state: "pending", progress: 0, msg: t("vis.q.pending") });
  HAL?.session?.schedule("visualizer");
  renderQueue(); if (!$("#queueSec").open) M.toggle($("#queueSec"), true);
  $("#queueSec").scrollIntoView({ block: "nearest" });
}
function setQueueStatus(msg, kind) { const s = $("#queueStatus"); s.textContent = msg; s.className = "status" + (kind ? " " + kind : ""); }
function jobPresetOptions(sel) {
  const names = Object.keys(presets).sort((a, b) => a.localeCompare(b));
  return `<option value="">${esc(t("vis.q.current"))}</option>` + names.map(n => `<option value="${esc(n)}"${n === sel ? " selected" : ""}>${esc(n)}</option>`).join("");
}
function renderQueue() {
  const n = V.jobs.length, pend = V.jobs.filter(j => j.state !== "done").length;
  $("#queueCount").textContent = n ? `${V.jobs.length - pend}/${n}` : "";
  $("#queueRun").disabled = !pend || V.queueRunning || V.jobs.some(j => j.state !== "done" && !(j.cover && j.cover.img) && !art.img);
  M.reveal($("#queueClear"), !!n && !V.queueRunning);
  M.list($("#queueList"), () => { $("#queueList").innerHTML = n ? V.jobs.map(j => `<div class="item job ${j.state}" data-job="${j.id}">
      <button class="jcover" data-jcover="${j.id}" title="${esc(t("vis.q.changeCover", { name: j.cover.name }))}"><img alt="" src="${esc(j.cover.thumb)}"></button>
      <div class="jmain"><b title="${esc(j.file.name)}">${esc(j.title)}</b>
        <div class="jrow"><select data-jpreset="${j.id}" aria-label="${esc(t("vis.q.preset"))}" ${V.queueRunning ? "disabled" : ""}>${jobPresetOptions(j.preset)}</select></div>
        <small data-jmsg="${j.id}">${esc(j.msg)}</small>
        <div class="jprog"><i data-jbar="${j.id}" style="--v:${j.progress.toFixed(3)}"></i></div></div>
      <button class="btn" data-jdel="${j.id}" ${V.queueRunning ? "disabled" : ""}>${esc(t("common.remove"))}</button></div>`).join("")
    : `<p class="empty">${esc(t("vis.q.empty"))}</p>`; }, { sel: ":scope > .job", key: el => el.dataset.job });
}
function updateJob(j) {
  const m = document.querySelector(`[data-jmsg="${j.id}"]`), b = document.querySelector(`[data-jbar="${j.id}"]`), row = document.querySelector(`[data-job="${j.id}"]`);
  if (m) m.textContent = j.msg; M.bar(b, j.progress); if (row) row.className = "item job " + j.state;
}
$("#queueList").addEventListener("change", e => { const id = +e.target.dataset.jpreset; const j = V.jobs.find(x => x.id === id); if (j) j.preset = e.target.value; });
$("#queueList").addEventListener("click", e => {
  const del = e.target.closest("[data-jdel]"), cov = e.target.closest("[data-jcover]");
  if (del && !V.queueRunning) { V.jobs = V.jobs.filter(j => j.id !== +del.dataset.jdel); renderQueue(); }
  if (cov && !V.queueRunning) { pickCoverFor = +cov.dataset.jcover; $("#queueCover").click(); }
});
$("#queueCover").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; const j = V.jobs.find(x => x.id === pickCoverFor);
  if (!f || !j) return;
  try { j.cover = await coverFromFile(f); HAL?.session?.schedule("visualizer"); renderQueue(); } catch (err) { setQueueStatus(t("common.badImage"), "bad"); }
});
$("#queueAudio").addEventListener("change", e => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length) queueAudios(fs); });
$("#queueClear").addEventListener("click", () => { if (!V.queueRunning) { V.jobs = []; renderQueue(); setQueueStatus(""); } });
$("#queueCancel").addEventListener("click", () => { cancelAll(); setQueueStatus(t("common.cancelling")); });
// Todo lo que el render necesita para un trabajo, sin tocar lo que hay en pantalla
async function jobR(j, baseR) {
  const buffer = await decodeAudio(await j.file.arrayBuffer());
  const P = j.preset ? Object.assign(clone(DEFAULTS), clone(j.preset)) : clone(baseR.S);
  const br = await bassRaw(buffer, P.bassCutoff);
  const ses = { clipStart: 0, clipLen: 0, title: j.title };
  const img = j.cover.img || baseR.art.img, cut = j.cover.img ? j.cover.cut || null : baseR.art.cut;
  return {
    buffer,
    R: { S: P, ses, art: { img, cut, avg: averageColor(img), ver: 1e6 + j.id }, env: bassEnv(br.raw, br.p, P), rate: baseR.rate, logo: baseR.logo, clip: clipBounds(ses, buffer.duration), codecs: baseR.codecs, encoder: baseR.encoder }
  };
}
// Every song is a job of one batch, with its own renderer; the list is a view of them
async function runQueue() {
  await HAL?.session?.start("visualizer");
  if (V.queueRunning) return;
  const todo = V.jobs.filter(j => j.state !== "done");
  if (!todo.length) return;
  pause();
  V.queueRunning = V.exporting = true; V.cancelFlag = false;
  M.reveal($("#queueCancel"), true);
  for (const j of todo) { j.state = "pending"; j.progress = 0; j.msg = t("vis.q.pending"); }
  renderQueue();
  const baseR = frozenR(), group = "visualizer-queue-" + Date.now();
  const snapshots = new Map(todo.map(j => [j, { ...j, cover: { ...j.cover }, preset: j.preset && presets[j.preset] ? clone(presets[j.preset]) : null }]));
  let ok = 0, bad = 0, n = 0;
  const one = async (j, ctx) => {
    j.state = "running"; j.msg = t("vis.q.analyzing"); updateJob(j);
    setQueueStatus(t("vis.q.job", { n: ++n, total: todo.length, name: j.title }));
    const { R, buffer } = await jobR(snapshots.get(j), baseR);
    const res = await renderVideo(R, buffer, exportName(R, "mp4"), {
      direct: true, cancelled: stopped(ctx),
      ui: { status: m => { j.msg = m; updateJob(j); ctx.progress(j.progress || 0, m); }, progress: p => { j.progress = p; updateJob(j); ctx.progress(p); } }
    });
    if (res.cancelled || res.declined) { const e = new Error("cancelled"); e.cancelled = true; throw e; }
    if (res.path) ctx.output(res.path, { kind: "video" });
    if (HAL) HAL.session.recordExport("visualizer", { path: res.path, name: res.name, kind: "video", thumb: videoThumb(R) });
    return res;
  };
  await Promise.allSettled(todo.map((j, k) => asJob({ kind: "export-video", title: j.title, group, groupTitle: t("vis.q.batch"), btn: k ? null : $("#queueRun") }, ctx => one(j, ctx)).then(res => {
    j.state = "done"; j.progress = 1; j.msg = t("common.savedAs", { name: res.name }); j.path = res.path; ok++; updateJob(j);
  }, e => {
    if (isCancel(e) || V.cancelFlag) { j.state = "pending"; j.progress = 0; j.msg = t("vis.q.cancelled"); }
    else { console.warn("cola:", j.title, e); j.state = "error"; j.msg = t("common.error", { error: e && e.message ? e.message : e }); bad++; }
    updateJob(j);
  })));
  V.queueRunning = false; V.exporting = V.exports > 0;
  M.reveal($("#queueCancel"), false); updateReady();
  const msg = t(todo.length === 1 ? "vis.q.doneOne" : "vis.q.done", { ok, total: todo.length }) + (bad ? " · " + t("common.withErrors", { n: bad }) : "") + (V.cancelFlag ? " · " + t("vis.q.wasCancelled") : "");
  setQueueStatus(msg, bad || V.cancelFlag ? "warn" : "ok");
  renderQueue();
}
$("#queueRun").addEventListener("click", runQueue);
$("#queueSec").hidden = !HAL;

Object.assign(up, { renderQueue });

/* ===== main ===== */
// Entry point: files, drag and drop, the API for the other tabs, boot
// every module, in the order of the original script (their top-level code registers listeners)

__i18n.apply(document);
__icons.apply(document);
document.body.dataset.drop = t("vis.drop");

/* ---------- file inputs & drag/drop ---------- */
$("#artIn").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) useArtFile(f); });
// the cover from the Library (the shared picker of the main window)
$("#artLibBtn").addEventListener("click", async () => { const f = HAL && await HAL.pickFromLibrary({ images: true }); if (f) useArtFile(f); });
$("#audIn").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) useAudioFile(f); });
$("#emptyStage").addEventListener("click", e => { if (!e.target.closest("button")) $("#anyIn").click(); });
$("#emptyStage").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); $("#anyIn").click(); } });
$("#browseBtn").addEventListener("click", () => $("#anyIn").click());
$("#linkBtn").addEventListener("click", () => { if (HAL) HAL.show("downloader"); });
$("#anyIn").addEventListener("change", e => { const fs = [...e.target.files]; e.target.value = ""; if (fs.length) routeFiles(fs); });
function routeFiles(files) {
  for (const f of files) {
    if (/^image\//.test(f.type) || /\.(png|jpe?g|webp|gif|avif|bmp)$/i.test(f.name)) useArtFile(f);
    else if (/^audio\//.test(f.type) || /\.(mp3|wav|flac|m4a|aac|ogg|opus|aiff?)$/i.test(f.name)) useAudioFile(f);
  }
}
let dragDepth = 0;
window.addEventListener("dragenter", e => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { dragDepth++; document.body.classList.add("dragging"); } });
window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove("dragging"); });
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => { e.preventDefault(); dragDepth = 0; document.body.classList.remove("dragging"); if (e.dataTransfer && e.dataTransfer.files.length) routeFiles(e.dataTransfer.files); });

// The tool's defaults (its "Use as default", kept by the main window) → format, frame rate and quality (applied at
// once when they change), and the codecs of the export dialog
let shellDefaults = null;
const CODEC = { video: "auto", audio: "auto" };
function applyShellSettings(st, live) {
  if (!st) return;
  if (["auto", "h264", "vp9"].includes(st.videoCodec)) CODEC.video = st.videoCodec;
  if (["auto", "aac", "opus"].includes(st.audioCodec)) CODEC.audio = st.audioCodec;
  const map = { format: st.videoFormat, fps: st.videoFps, quality: st.videoQuality, artist: (st.artistName || "").trim() || t("vis.defaultArtist") };
  for (const k in map) {
    if (FIELD[k].options && !FIELD[k].options.some(([v]) => v === map[k])) continue;
    const changed = shellDefaults && shellDefaults[k] !== map[k];
    DEFAULTS[k] = map[k];
    if ((live && changed) || (!live && !shellDefaults && !localLoaded && k !== "artist")) setValue(k, map[k], true);
  }
  shellDefaults = map;
}
const isFile = b => typeof b.name === "string" && typeof b.lastModified === "number";   // a File, also from the main window
const asFile = (blob, name, type) => isFile(blob) ? blob : new File([blob], name || "file", { type: blob.type || type || "" });
$("#shellRow").hidden = !HAL;
$("#artCropBtn").addEventListener("click", e => editCrop(e.currentTarget));
$("#artCutBtn").addEventListener("click", e => cutCover(e.currentTarget));
$("#pv").addEventListener("dblclick", e => editCrop(e.currentTarget));
// The cover (its file as it came, or the picture drawn when there is none) to another tool, with the title and
// artist; "and come back" makes the result the cover
async function coverItem() {
  if (!art.img) return null;
  let blob = art.file, name = art.file ? art.file.name : (art.name || t("vis.cover")).replace(/\.[^.]+$/, "") + ".png";
  if (!blob) {
    const [w, h] = imgSize(art.img), c = mk(w, h);
    c.getContext("2d").drawImage(art.img, 0, 0, w, h);
    blob = await new Promise(r => c.toBlob(r, "image/png"));
  }
  return { blob, path: blob.__halPath || null, name, meta: { title: (session.title || "").trim(), artist: (S.artist || "").trim() } };
}
window.__ui.sendMenu($("#sendCoverBtn"), { kind: "image", from: "visualizer", item: coverItem });
let resolveReady;
window.__halApp = {
  session: {
    clickChanges: "#queueList [data-jdel],#queueClear,#clipHere",
    capture: async () => ({ settings: clone(S), clip: clone(session), export: clone(X), audio: await HAL.session.ref(aud.file), cover: await HAL.session.ref(art.file, art.name), crop: art.crop, mask: await HAL.session.encode(art.mask), edit: await HAL.session.encode(art.edit), queue: await Promise.all(V.jobs.filter(j => j.state !== "done").map(async j => ({ audio: await HAL.session.ref(j.file), title: j.title, preset: j.preset, cover: j.cover?.file ? await HAL.session.ref(j.cover.file) : null }))) }),
    restore: async d => {
      const audio = await HAL.session.read(d.audio); if (audio) await useAudioFile(audio);
      const cover = await HAL.session.read(d.cover); if (cover) { const img = await loadImage(URL.createObjectURL(cover)); setArt(img, cover.name, d.crop, cover); art.mask = await HAL.session.decode(d.mask); art.edit = await HAL.session.decode(d.edit); applyArt(); }
      setS(Object.assign(clone(DEFAULTS), sanitize(d.settings))); Object.assign(session, d.clip); sanitizeX(d.export);
      up.syncSessionInputs(); buildControls(); syncAll(); updateReady(); updateSpec(); computeEnv();
      for (const j of d.queue || []) { const f = await HAL.session.read(j.audio), c = await HAL.session.read(j.cover); if (!f) continue; await queueAudios([f], c); const q = V.jobs[V.jobs.length - 1]; q.title = j.title; q.preset = j.preset; }
      renderQueue(); requestPreview();
    }
  },
  ready: new Promise(r => { resolveReady = r; }),
  reloadPresets,
  applyPreset: applyPresetByName,
  setCover: (blob, name) => useArtFile(asFile(blob, name, "image/png")),
  // "Send to…" (modules.js: accepts, gives): a picture becomes the cover, a song the audio; the result is the video
  takeImage: async it => useArtFile(await HAL.itemFile(it)),
  takeAudio: async it => useAudioFile(await HAL.itemFile(it)),
  result: () => V.lastExport && V.lastExport.name && V.lastExport.path ? { kind: "video", path: V.lastExport.path, name: V.lastExport.name } : null,
  loadAudio: file => useAudioFile(asFile(file, file.name)),
  queueAudios: (files, cover) => queueAudios(Array.from(files).map(f => asFile(f, f.name)), cover ? asFile(cover, cover.name) : null),
  flush: flushPersist,
  busy: () => V.exporting,
  // nothing open or running: the shell may unload the page while it is not shown (shell.js unloadIdle)
  idle: () => !V.exporting && !V.queueRunning && !V.jobs.length && !audioEl.src && !art.img,
  // Diagnostics for the tests: the layers composited in JS against the full render, and reference frames
  testing: {
    async layerCheck(times, finish) {
      const R = frozenR(); await ensureFonts(R.S);
      const { W, H } = outSize(R.S), fps = +R.S.fps, L = layerCanvases(W, H), A = getAssets({}, L.bg.x, W, H, R);
      const ref = mk(W, H).getContext("2d", { willReadFrequently: true }), Ar = getAssets({}, ref, W, H, R), out = [];
      for (const tt of times) {
        const i = Math.round((tt - R.clip.start) * fps), t2 = R.clip.start + i / fps;
        renderFrame(ref, W, H, t2, R, Ar, i, false);
        const want = ref.getImageData(0, 0, W, H).data;
        const fr = renderLayers(L, W, H, t2, R, A, i, { want: { cover: true, text: true, finish: finish === "overlay" }, finish });
        const px = {};
        for (const k of ["bg", "cover", "text", "finish"]) if (fr.rects[k]) {
          const r = fr.rects[k], d = layerPixels(L, k, r, k === "finish" ? 0 : fr.grainK, k === "finish" ? 1 : fr.fade);
          px[k] = { r, d };
        }
        // composite as an editor does: Normal (straight alpha) bottom to top, Overlay for the finish
        const c = new Float32Array(W * H * 3);
        const b = px.bg.d; for (let p = 0, q = 0; p < b.length; p += 4) { c[q++] = b[p]; c[q++] = b[p + 1]; c[q++] = b[p + 2]; }
        for (const k of ["cover", "text"]) {
          const { r, d } = px[k];
          for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) {
            const s0 = (y * r.w + x) * 4, a = d[s0 + 3] / 255; if (!a) continue;
            const q = ((r.y + y) * W + r.x + x) * 3;
            for (let ch = 0; ch < 3; ch++) c[q + ch] = d[s0 + ch] * a + c[q + ch] * (1 - a);
          }
        }
        if (px.finish) {
          const f = px.finish.d;
          for (let p = 0, q = 0; p < f.length; p += 4, q += 3) for (let ch = 0; ch < 3; ch++) {
            const bb = c[q + ch] / 255, ss = f[p + ch] / 255;
            c[q + ch] = 255 * (bb <= 0.5 ? 2 * bb * ss : 1 - 2 * (1 - bb) * (1 - ss));
          }
        }
        let max = 0, sum = 0; const hist = new Uint32Array(256);
        let at = null;
        for (let p = 0, q = 0; p < want.length; p += 4, q += 3) for (let ch = 0; ch < 3; ch++) { const dd = Math.min(255, Math.round(Math.abs(Math.round(c[q + ch]) - want[p + ch]))); hist[dd]++; sum += dd; if (dd > max) { max = dd; at = { x: (p / 4) % W, y: Math.floor(p / 4 / W), got: Math.round(c[q + ch]), want: want[p + ch], ch }; } }
        let n = 0, p999 = 0; const total = W * H * 3; for (let v = 0; v < 256; v++) { n += hist[v]; if (n >= total * 0.999) { p999 = v; break; } }
        out.push({ t: +t2.toFixed(3), max, mean: sum / total, p999, fade: fr.fade, at, rects: fr.rects });
      }
      return out;
    },
    // one pass of a frame as a PNG data URL (for inspection)
    async layerPNG(i, k, finish) {
      const R = frozenR(); await ensureFonts(R.S);
      const { W, H } = outSize(R.S), fps = +R.S.fps, L = layerCanvases(W, H), A = getAssets({}, L.bg.x, W, H, R);
      renderLayers(L, W, H, R.clip.start + i / fps, R, A, i, { want: { cover: true, text: true, finish: finish === "overlay" }, finish: finish || "baked" });
      return L[k].c.toDataURL("image/png");
    },
    // frames of the full render (RGB, base64) at frame indices of the clip, with the export's seeds
    // opaque: the canvas of the single-video export ({ alpha: false }) instead of the one the layers use
    async reference(indices, opaque) {
      const R = frozenR(); await ensureFonts(R.S);
      const { W, H } = outSize(R.S), fps = +R.S.fps, x = mk(W, H).getContext("2d", opaque ? { alpha: false } : { willReadFrequently: true }), A = getAssets({}, x, W, H, R);
      return indices.map(i => {
        renderFrame(x, W, H, R.clip.start + i / fps, R, A, i, false);
        const d = x.getImageData(0, 0, W, H).data, rgb = new Uint8Array(W * H * 3);
        for (let p = 0, q = 0; p < d.length; p += 4) { rgb[q++] = d[p]; rgb[q++] = d[p + 1]; rgb[q++] = d[p + 2]; }
        let s = ""; for (let k = 0; k < rgb.length; k += 0x8000) s += String.fromCharCode.apply(null, rgb.subarray(k, k + 0x8000));
        return btoa(s);
      });
    }
  }
};
if (HAL) {
  HAL.on("fonts", () => loadLibraryFonts());
  HAL.on("settings", st => applyShellSettings(st, true));
  HAL.ready.then(() => applyShellSettings(HAL.settings(), false));
}

/* ---------- boot ---------- */
async function boot() {
  loadLocal();
  buildControls(); renderPresets(); renderFontLib(); syncAll(); paintRange($("#vol"));
  $("#meterHz").textContent = `≤ ${S.bassCutoff} Hz`;
  sizePreview(); updateSpec();
  setSync("none", t("vis.sync.loading"));
  updateReady();
  requestPreview();
  M.autoDetails(document);
  ensureFonts(); loadLibraryFonts(); if (S.logoAsset) loadLogoAsset(S.logoAsset);
  if (window.__halFonts) window.__halFonts.then(l => { setSysFonts((l || []).filter(n => !BUILTIN_FONTS.includes(n))); refreshFontSelects(); requestPreview(); });
  connectAccount().finally(resolveReady);
}
boot();
