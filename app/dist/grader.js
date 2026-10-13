import { contrast, hueMatrix, makeGrader, mcurve, stopsAt, toneVec, wbGains } from './grade-color.js'; import { CATS2, CLASSIC, LOOKS2, LEGACY_REVS } from './grade-looks.js';
// Grade's looks and grader (no DOM work at load).
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

/* ===== data ===== */
// Effects, adjustments, text layer and the built-in looks

/* =================== effects and presets =================== */
const FX = {
  bloom: { name: t("fx.bloom"), group: "Luz", params: [
    { k: "threshold", label: t("fx.bloom.threshold"), min: 0, max: 1, step: 0.01, def: 0.62 },
    { k: "radius", label: t("fx.bloom.radius"), min: 2, max: 200, step: 1, def: 45, unit: "px" },
    { k: "intensity", label: t("fx.bloom.intensity"), min: 0, max: 2, step: 0.01, def: 0.9 },
    { k: "tint", label: t("fx.bloom.tint"), type: "color", def: "#ffffff" }] },
  halation: { name: t("fx.halation"), group: "Luz", params: [
    { k: "threshold", label: t("fx.halation.threshold"), min: 0, max: 1, step: 0.01, def: 0.7 },
    { k: "radius", label: t("fx.halation.radius"), min: 2, max: 120, step: 1, def: 16, unit: "px" },
    { k: "intensity", label: t("fx.halation.intensity"), min: 0, max: 2, step: 0.01, def: 1 },
    { k: "tint", label: t("fx.halation.tint"), type: "color", def: "#ff4a22" }] },
  glow: { name: t("fx.glow"), group: "Luz", params: [
    { k: "radius", label: t("fx.glow.radius"), min: 2, max: 200, step: 1, def: 35, unit: "px" },
    { k: "strength", label: t("fx.glow.strength"), min: 0, max: 1, step: 0.01, def: 0.6 }] },
  glints: { name: t("fx.glints"), group: "Luz", params: [
    { k: "threshold", label: t("fx.glints.threshold"), min: 0.3, max: 1, step: 0.01, def: 0.85 },
    { k: "length", label: t("fx.glints.length"), min: 10, max: 400, step: 1, def: 90, unit: "px" },
    { k: "strength", label: t("fx.glints.strength"), min: 0, max: 3, step: 0.01, def: 1 },
    { k: "tint", label: t("fx.glints.tint"), type: "color", def: "#ffffff" }] },
  leak: { name: t("fx.leak"), group: "Luz", params: [
    { k: "color", label: t("fx.leak.color"), type: "color", def: "#ff6a3a" },
    { k: "angle", label: t("fx.leak.angle"), min: -180, max: 180, step: 1, def: -35, unit: "°" },
    { k: "size", label: t("fx.leak.size"), min: 0.1, max: 1.5, step: 0.01, def: 0.55 },
    { k: "strength", label: t("fx.leak.strength"), min: 0, max: 1, step: 0.01, def: 0.7 }] },
  vignette: { name: t("fx.vignette"), group: "Luz", params: [
    { k: "size", label: t("fx.vignette.size"), min: 0, max: 1, step: 0.01, def: 0.35 },
    { k: "soft", label: t("fx.vignette.soft"), min: 0.05, max: 1, step: 0.01, def: 0.6 },
    { k: "strength", label: t("fx.vignette.strength"), min: 0, max: 1, step: 0.01, def: 0.7 }] },
  grain: { name: t("fx.grain"), group: "Textura", params: [
    { k: "size", label: t("fx.grain.size"), min: 0.5, max: 6, step: 0.1, def: 1.4, unit: "px" },
    { k: "strength", label: t("fx.grain.strength"), min: 0, max: 1, step: 0.01, def: 0.5 },
    { k: "colored", label: t("fx.grain.colored"), type: "toggle", def: false }] },
  dust: { name: t("fx.dust"), group: "Textura", params: [
    { k: "density", label: t("fx.dust.density"), min: 0, max: 1, step: 0.01, def: 0.5 },
    { k: "scratches", label: t("fx.dust.scratches"), min: 0, max: 1, step: 0.01, def: 0.4 }] },
  halftone: { name: t("fx.halftone"), group: "Textura", params: [
    { k: "size", label: t("fx.halftone.size"), min: 2, max: 40, step: 0.5, def: 7, unit: "px" },
    { k: "angle", label: t("fx.halftone.angle"), min: 0, max: 90, step: 1, def: 45, unit: "°" },
    { k: "mono", label: t("fx.halftone.mono"), type: "toggle", def: false }] },
  pixelate: { name: t("fx.pixelate"), group: "Textura", params: [
    { k: "size", label: t("fx.pixelate.size"), min: 1, max: 60, step: 0.5, def: 6, unit: "px" }] },
  scanlines: { name: t("fx.scanlines"), group: "Textura", params: [
    { k: "spacing", label: t("fx.scanlines.spacing"), min: 1.5, max: 20, step: 0.5, def: 4, unit: "px" },
    { k: "strength", label: t("fx.scanlines.strength"), min: 0, max: 1, step: 0.01, def: 0.5 }] },
  blur: { name: t("fx.blur"), group: "Óptica", params: [
    { k: "radius", label: t("fx.blur.radius"), min: 0.5, max: 120, step: 0.5, def: 8, unit: "px" }] },
  edgeblur: { name: t("fx.edgeblur"), group: "Óptica", params: [
    { k: "radius", label: t("fx.edgeblur.radius"), min: 1, max: 120, step: 0.5, def: 22, unit: "px" },
    { k: "clear", label: t("fx.edgeblur.clear"), min: 0, max: 0.9, step: 0.01, def: 0.3 },
    { k: "soft", label: t("fx.edgeblur.soft"), min: 0.05, max: 1, step: 0.01, def: 0.45 }] },
  motion: { name: t("fx.motion"), group: "Óptica", params: [
    { k: "angle", label: t("fx.motion.angle"), min: -90, max: 90, step: 1, def: 0, unit: "°" },
    { k: "length", label: t("fx.motion.length"), min: 1, max: 300, step: 1, def: 35, unit: "px" }] },
  ghost: { name: t("fx.ghost"), group: "Óptica", params: [
    { k: "dx", label: t("fx.ghost.dx"), min: -20, max: 20, step: 0.1, def: 3, unit: "%" },
    { k: "dy", label: t("fx.ghost.dy"), min: -20, max: 20, step: 0.1, def: 0, unit: "%" },
    { k: "opacity", label: t("fx.ghost.opacity"), min: 0, max: 1, step: 0.01, def: 0.6 }] },
  chroma: { name: t("fx.chroma"), group: "Óptica", params: [
    { k: "amount", label: t("fx.chroma.amount"), min: 0, max: 40, step: 0.1, def: 5, unit: "px" }] },
  rgbshift: { name: t("fx.rgbshift"), group: "Óptica", params: [
    { k: "amount", label: t("fx.rgbshift.amount"), min: 0, max: 60, step: 0.5, def: 6, unit: "px" }] },
  sharpen: { name: t("fx.sharpen"), group: "Óptica", params: [
    { k: "radius", label: t("fx.sharpen.radius"), min: 0.5, max: 4, step: 0.1, def: 1, unit: "px" },
    { k: "strength", label: t("fx.sharpen.strength"), min: 0, max: 2, step: 0.01, def: 0.6 }] }
};
const fxDefaults = t => Object.fromEntries(FX[t].params.map(p => [p.k, p.def]));

const ADJ = [
  { k: "exp", label: t("adj.exp"), min: -2, max: 2, step: 0.01, def: 0, unit: "EV" },
  { k: "con", label: t("adj.con"), min: -100, max: 100, step: 1, def: 0 },
  { k: "hi", label: t("adj.hi"), min: -100, max: 100, step: 1, def: 0 },
  { k: "sh", label: t("adj.sh"), min: -100, max: 100, step: 1, def: 0 },
  { k: "lift", label: t("adj.lift"), min: 0, max: 40, step: 1, def: 0 },
  { k: "crush", label: t("adj.crush"), min: 0, max: 30, step: 1, def: 0 },
  { k: "cap", label: t("adj.cap"), min: 0, max: 30, step: 1, def: 0 },
  { k: "temp", label: t("adj.temp"), min: -100, max: 100, step: 1, def: 0 },
  { k: "tint", label: t("adj.tint"), min: -100, max: 100, step: 1, def: 0 },
  { k: "sat", label: t("adj.sat"), min: -100, max: 100, step: 1, def: 0 },
  { k: "vib", label: t("adj.vib"), min: -100, max: 100, step: 1, def: 0 },
  { k: "hue", label: t("adj.hue"), min: -180, max: 180, step: 1, def: 0, unit: "°" },
  { k: "bw", label: t("adj.bw"), type: "toggle", def: false },
  { k: "sCol", label: t("adj.sCol"), type: "color", def: "#1a3a8a" },
  { k: "sAmt", label: t("adj.sAmt"), min: 0, max: 100, step: 1, def: 0 },
  { k: "hCol", label: t("adj.hCol"), type: "color", def: "#ffd9a8" },
  { k: "hAmt", label: t("adj.hAmt"), min: 0, max: 100, step: 1, def: 0 }
];
const GMAP = [
  { k: "c1", label: t("gmap.c1"), type: "color", def: "#050a1f" },
  { k: "c2", label: t("gmap.c2"), type: "color", def: "#3a6fd1" },
  { k: "c3", label: t("gmap.c3"), type: "color", def: "#e8f4ff" },
  { k: "mid", label: t("gmap.mid"), min: 0.1, max: 0.9, step: 0.01, def: 0.5 },
  { k: "con", label: t("gmap.con"), min: -50, max: 100, step: 1, def: 10 }
];
const BUILTIN_FONTS = ["Unbounded", "Hanken Grotesk", "Syne", "Michroma", "Cinzel", "UnifrakturCook", "JetBrains Mono"];
const TEXT = [
  { k: "text", label: t("text.text"), type: "text", def: t("grade.textDefault") },
  { k: "font", label: t("text.font"), type: "select", font: true, def: "Hanken Grotesk", options: [] },
  { k: "sys", label: t("text.sys"), type: "text", def: "", showIf: p => p.font === "__sys" },
  { k: "weight", label: t("text.weight"), type: "select", def: "600", options: [["300", t("weight.300")], ["400", t("weight.400")], ["500", t("weight.500")], ["600", t("weight.600")], ["700", t("weight.700")], ["800", t("weight.800")]] },
  { k: "size", label: t("text.size"), min: 8, max: 300, step: 1, def: 44, unit: "px" },
  { k: "spacing", label: t("text.spacing"), min: -10, max: 120, step: 1, def: 45, unit: "%" },
  { k: "upper", label: t("text.upper"), type: "toggle", def: true },
  { k: "color", label: t("text.color"), type: "color", def: "#ffffff" },
  { k: "glow", label: t("text.glow"), min: 0, max: 100, step: 1, def: 0 },
  { k: "vpos", label: t("text.vpos"), type: "select", def: "bottom", options: [["top", t("text.vpos.top")], ["middle", t("text.vpos.middle")], ["bottom", t("text.vpos.bottom")]] },
  { k: "hpos", label: t("text.hpos"), type: "select", def: "center", options: [["left", t("text.hpos.left")], ["center", t("text.hpos.center")], ["right", t("text.hpos.right")]] },
  { k: "margin", label: t("text.margin"), min: 0, max: 30, step: 0.5, def: 6, unit: "%" }
];
const schemaDefaults = S => Object.fromEntries(S.map(p => [p.k, p.def]));


// Tool groups are stable ids; only their label is translated.
const GROUP_KEY = { Color: "color", Luz: "light", Textura: "texture", Óptica: "optics", Acabado: "finish" };
const groupName = g => t("grade.grp." + (GROUP_KEY[g] || g));

/* ===== grading ===== */
// Colour grading maths baked into 3D LUTs

/* =================== colour grading (baked into 3D LUTs) =================== */
function adjustToGrade(p) {
  return {
    exp: p.exp, con: p.con / 100, hi: p.hi / 100, sh: p.sh / 100, lift: p.lift / 100, crush: p.crush / 100, cap: p.cap / 100,
    temp: p.temp / 100, tint: p.tint / 100, sat: 1 + p.sat / 100, vib: p.vib / 100, hue: p.hue,
    bw: p.bw ? [0.3, 0.59, 0.11] : null, sTone: [p.sCol, p.sAmt / 100], hTone: [p.hCol, p.hAmt / 100]
  };
}
function gmapToGrade(p) { return { con: p.con / 100, gmap: { stops: [[0, p.c1], [p.mid, p.c2], [1, p.c3]], amt: 1 } }; }


/* ===== looks ===== */
// The looks of docs/GRADE_LOOKS_SPEC.md (catalogue: grade-looks.js). The classic looks were removed (Java, 2026-10-13):
// saved work that names one opens with its closest look of the catalogue (CLASSIC in grade-looks.js).
const LOOK2 = Object.fromEntries(LOOKS2.map(l => [l.id, l]));
for (const k in LEGACY_REVS) LOOK2[k] = LEGACY_REVS[k];
const cat2Name = c => t("cat2." + c);
const look2Name = id => t("lk." + id);
// The adjustments of an applied look (§4.4): relative, 0 = the look as is
const ADJ2 = [
  { k: "exposure", label: t("adj2.exposure"), min: -100, max: 100, step: 1, def: 0 },
  { k: "warmth", label: t("adj2.warmth"), min: -100, max: 100, step: 1, def: 0 },
  { k: "contrast", label: t("adj2.contrast"), min: -100, max: 100, step: 1, def: 0 },
  { k: "highlights", label: t("adj2.highlights"), min: -100, max: 100, step: 1, def: 0 },
  { k: "shadows", label: t("adj2.shadows"), min: -100, max: 100, step: 1, def: 0 },
  { k: "saturation", label: t("adj2.saturation"), min: -100, max: 100, step: 1, def: 0 },
  { k: "fade", label: t("adj2.fade"), min: 0, max: 100, step: 1, def: 0 },
  { k: "grain", label: t("adj2.grain"), min: -100, max: 100, step: 1, def: 0 }
];
// Only known, finite, in-range adjustments other than 0
function cleanAdj(a) {
  const o = {};
  if (a && typeof a === "object") for (const s of ADJ2) { const v = +a[s.k]; if (Number.isFinite(v) && v) o[s.k] = Math.min(s.max, Math.max(s.min, Math.round(v))); }
  return o;
}
const hasAdj = a => !!a && Object.keys(cleanAdj(a)).length > 0;
// A look definition carried by a personal look (§3.3): plain data, bounded, finishing passes limited to known effects
function cleanDef(d) {
  if (!d || typeof d !== "object") return null;
  let j; try { j = JSON.stringify(d); } catch (e) { return null; }
  if (j.length > 40000) return null;
  const o = JSON.parse(j);
  if (!o.color || typeof o.color !== "object") o.color = {};
  o.finish = Array.isArray(o.finish) ? o.finish.filter(f => Array.isArray(f) && FX[f[0]] && (f[1] == null || typeof f[1] === "object")).map(([k, p]) => [k, p || {}]) : [];
  return o;
}
// The definition a look layer renders: its own copy (a personal look), the catalogue look at the layer's revision,
// or null (a classic look)
const layerDef = L => L.def || (L.rev && LOOK2[L.id0] && LOOK2[L.id0].rev !== L.rev && LOOK2[L.id0 + "@" + L.rev]) || LOOK2[L.id0] || null;
// LUT cache key of a definition: only its colour part goes into the LUT
function defKey(def) {
  const s = JSON.stringify(def.color || {}); let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return "v2:" + (h >>> 0).toString(36) + ":" + s.length;
}
// Uniforms of the look shader for a layer's adjustments (pre-look: exposure, warmth; post-look: the rest)
function lookUniforms(adj) {
  const a = k => ((adj && adj[k]) || 0) / 100, wb = wbGains(a("warmth") * 0.55, 0), ex = Math.pow(2, a("exposure"));
  const u = { wb: [wb[0] * ex, wb[1] * ex, wb[2] * ex], pre: a("warmth") || a("exposure") ? 1 : 0, con: a("contrast"), hi: a("highlights"), sh: a("shadows"), sat: a("saturation"), fade: a("fade") };
  u.post = u.con || u.hi || u.sh || u.sat || u.fade ? 1 : 0;
  return u;
}
// The finishing passes of a look with the layer's Grain adjustment, in the fixed order of §4.2
// optics first, then light, then the print and the film surface on top
const FINISH_ORDER = ["sharpen", "blur", "edgeblur", "motion", "ghost", "chroma", "rgbshift", "halation", "bloom", "glow", "glints", "leak", "vignette", "pixelate", "halftone", "scanlines", "grain", "dust"];
function finishOf(def, adj) {
  const g = ((adj && adj.grain) || 0) / 100;
  const list = (def.finish || []).filter(([k]) => FX[k]).map(([k, p]) => [k, Object.assign(fxDefaults(k), p)]);
  const grain = list.find(([k]) => k === "grain");
  if (g && grain) grain[1].strength = Math.min(1, grain[1].strength * (1 + g));
  else if (g > 0) list.push(["grain", Object.assign(fxDefaults("grain"), { size: 1.2, strength: 0.3 * g, shadows: 0.5 })]);
  const at = k => { const i = FINISH_ORDER.indexOf(k); return i < 0 ? FINISH_ORDER.length : i; };
  return list.filter(([k, p]) => !(k === "grain" && p.strength <= 0)).sort((x, y) => at(x[0]) - at(y[0]));
}

export { ADJ, ADJ2, CATS2, LOOK2, LOOKS2, cat2Name, cleanAdj, cleanDef, defKey, finishOf, hasAdj, layerDef, look2Name, lookUniforms, BUILTIN_FONTS, CLASSIC, FX, GMAP, GROUP_KEY, TEXT, adjustToGrade, contrast, fxDefaults, gmapToGrade, groupName, hueMatrix, makeGrader, mcurve, schemaDefaults, stopsAt, toneVec };
