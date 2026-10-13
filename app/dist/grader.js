import { contrast, hueMatrix, makeGrader, mcurve, stopsAt, toneVec } from './grade-color.js';
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

const CATS = ["Azul", "Violeta", "Rojo", "B&N", "Película", "Oscuro", "Verde", "Soñado", "Retro", "Duotono"];
// Category ids are stable data (saved G.looks refer to them); only the label is translated.
const CAT_KEY = { Todos: "all", Azul: "blue", Violeta: "violet", Rojo: "red", "B&N": "bw", Película: "film", Oscuro: "dark", Verde: "green", Soñado: "dreamy", Retro: "retro", Duotono: "duotone" };
const catName = c => t("cat." + (CAT_KEY[c] || c));
const LOOKS = [
  { id: "nocturno", name: t("look.nocturno"), cat: "Azul", g: { temp: -.55, tint: .04, con: .28, sat: .72, sh: -.1, hi: -.15, sTone: ["#0b2d6e", .45], hTone: ["#a8d8ff", .22], lift: .03 }, fx: [["vignette", { strength: .45 }]] },
  { id: "hielo", name: t("look.hielo"), cat: "Azul", g: { temp: -.45, exp: .18, con: .12, sat: .5, sTone: ["#2d5f91", .35], hTone: ["#d2f4ff", .35], lift: .06 }, fx: [["bloom", { threshold: .7, intensity: .45, radius: 40, tint: "#cfefff" }]] },
  { id: "medianoche", name: t("look.medianoche"), cat: "Azul", g: { temp: -.7, exp: -.25, con: .45, crush: .05, sat: .8, sTone: ["#0a1150", .6], hTone: ["#7b95ff", .3] }, fx: [["vignette", { strength: .6 }]] },
  { id: "polaroid", name: t("look.polaroid"), cat: "Azul", g: { temp: -.35, tint: .02, con: .08, sat: .8, lift: .06, cap: .03, sTone: ["#16306e", .38], hTone: ["#e2f3ff", .24], curve: { m: [[0, .03], [.3, .27], [.7, .74], [1, .98]] } }, fx: [["grain", { strength: .22, size: 1.2 }], ["glow", { strength: .15, radius: 30 }], ["vignette", { strength: .25 }]] },
  { id: "acero", name: t("look.acero"), cat: "Azul", g: { sat: .25, temp: -.35, con: .22, lift: .03, sTone: ["#1c2a3a", .3] } },
  { id: "violeta", name: t("look.violeta"), cat: "Violeta", g: { temp: -.25, tint: .35, con: .3, crush: .03, sat: 1.05, sTone: ["#1b0640", .55], hTone: ["#dcc2ff", .3] }, fx: [["bloom", { threshold: .6, intensity: .7, tint: "#b894ff" }]] },
  { id: "ultravioleta", name: t("look.ultravioleta"), cat: "Violeta", g: { con: .15, gmap: { stops: [[0, "#04010d"], [.45, "#3a1c91"], [.8, "#9f86ff"], [1, "#f4eeff"]], amt: .88 } } },
  { id: "synth", name: t("look.synth"), cat: "Violeta", g: { tint: .2, con: .25, sat: 1.15, sTone: ["#1c0b5c", .5], hTone: ["#ff66d6", .28] }, fx: [["bloom", { intensity: .5 }], ["chroma", { amount: 3 }]] },
  { id: "sangre", name: t("look.sangre"), cat: "Rojo", g: { con: .3, crush: .04, gmap: { stops: [[0, "#060001"], [.5, "#720814"], [.85, "#e3323d"], [1, "#ffd9d2"]], amt: .8 } } },
  { id: "neonrojo", name: t("look.neonrojo"), cat: "Rojo", g: { temp: .35, tint: .28, con: .38, sat: 1.2, sTone: ["#2d0008", .5], hTone: ["#ff4d5f", .3], hue: -6 }, fx: [["bloom", { intensity: .6, tint: "#ff3a4c" }], ["halation", { intensity: .6 }]] },
  { id: "ambar", name: t("look.ambar"), cat: "Rojo", g: { temp: .5, tint: .05, con: .15, sat: 1.05, lift: .03, sTone: ["#2e1606", .35], hTone: ["#ffd08e", .28] } },
  { id: "sepia", name: t("look.sepia"), cat: "Rojo", g: { con: .1, lift: .04, gmap: { stops: [[0, "#1b1007"], [.5, "#7c5636"], [1, "#f4e4c6"]], amt: .92 } }, fx: [["grain", { strength: .3 }]] },
  { id: "bn", name: t("look.bn"), cat: "B&N", g: { bw: [.3, .59, .11], con: .22 } },
  { id: "noir", name: t("look.noir"), cat: "B&N", g: { bw: [.4, .45, .15], con: .6, crush: .06, exp: -.08 }, fx: [["grain", { strength: .6 }], ["vignette", { strength: .6 }]] },
  { id: "plata", name: t("look.plata"), cat: "B&N", g: { bw: [.25, .6, .15], con: -.18, lift: .1, cap: .04, exp: .1 }, fx: [["glow", { strength: .3 }]] },
  { id: "bnnoche", name: t("look.bnnoche"), cat: "B&N", g: { bw: [.1, .3, .6], con: .48, crush: .04 }, fx: [["bloom", { intensity: .55, threshold: .65 }], ["grain", { strength: .35 }]] },
  { id: "portra", name: t("look.portra"), cat: "Película", g: { temp: .18, tint: -.03, sat: .9, lift: .04, sTone: ["#3b2a1f", .2], hTone: ["#ffe3c4", .22], curve: { m: [[0, .04], [.25, .23], [.75, .8], [1, .97]] } }, fx: [["grain", { strength: .3 }]] },
  { id: "fuji", name: t("look.fuji"), cat: "Película", g: { temp: -.12, tint: -.12, con: .12, sat: .9, lift: .04, sTone: ["#0f3b37", .35], hTone: ["#f2fff2", .12] }, fx: [["grain", { strength: .3 }]] },
  { id: "teal", name: t("look.teal"), cat: "Película", g: { con: .25, sat: 1.05, vib: .2, sTone: ["#0b4d5c", .5], hTone: ["#ffb26e", .32] } },
  { id: "bleach", name: t("look.bleach"), cat: "Película", g: { sat: .35, con: .55, crush: .03, lift: .02, exp: .05, temp: -.05 } },
  { id: "cross", name: t("look.cross"), cat: "Película", g: { con: .2, sat: 1.15, curve: { r: [[0, .04], [.5, .56], [1, 1]], g: [[0, 0], [.5, .52], [1, .96]], b: [[0, .2], [.5, .45], [1, .8]] } } },
  { id: "faded", name: t("look.faded"), cat: "Película", g: { lift: .14, cap: .06, con: -.1, sat: .75, temp: -.05 }, fx: [["grain", { strength: .25 }]] },
  { id: "profundo", name: t("look.profundo"), cat: "Oscuro", g: { exp: -.35, con: .45, crush: .08, sat: .8, sh: -.3, temp: -.1 }, fx: [["vignette", { strength: .65 }]] },
  { id: "humo", name: t("look.humo"), cat: "Oscuro", g: { lift: .18, con: -.3, sat: .5, temp: -.08, cap: .05 }, fx: [["glow", { strength: .35 }]] },
  { id: "mate", name: t("look.mate"), cat: "Oscuro", g: { exp: -.2, lift: .09, cap: .12, con: .12, sat: .7 } },
  { id: "matrix", name: t("look.matrix"), cat: "Verde", g: { tint: -.45, temp: -.1, con: .3, sat: .8, sTone: ["#001f0c", .45], hTone: ["#bfffd4", .22] } },
  { id: "esmeralda", name: t("look.esmeralda"), cat: "Verde", g: { tint: -.3, temp: -.3, exp: -.15, con: .35, crush: .05, sat: .7, sTone: ["#03302f", .55], hTone: ["#aee9dc", .18] }, fx: [["vignette", { strength: .45 }]] },
  { id: "sueno", name: t("look.sueno"), cat: "Soñado", g: { lift: .05, con: -.05, sat: .9, exp: .1 }, fx: [["glow", { strength: .55 }], ["bloom", { intensity: .4 }]] },
  { id: "halo", name: t("look.halo"), cat: "Soñado", g: { con: .15 }, fx: [["halation", { intensity: 1 }], ["bloom", { intensity: .55 }]] },
  { id: "etereo", name: t("look.etereo"), cat: "Soñado", g: { exp: .3, sat: .45, lift: .08, temp: -.15, hTone: ["#e9f6ff", .25] }, fx: [["glow", { strength: .5 }], ["bloom", { intensity: .35 }]] },
  { id: "destellos", name: t("look.destellos"), cat: "Soñado", g: { con: .1 }, fx: [["glints", { strength: 1 }], ["bloom", { intensity: .35 }]] },
  { id: "vhs", name: t("look.vhs"), cat: "Retro", g: { sat: .85, con: .1, lift: .06, tint: .05 }, fx: [["blur", { radius: 1.5 }], ["rgbshift", { amount: 5 }], ["scanlines", { strength: .45 }], ["grain", { strength: .35 }]] },
  { id: "ccd", name: t("look.ccd"), cat: "Retro", g: { temp: -.2, con: .25, sat: 1.1, exp: .1, hTone: ["#e2f1ff", .18] }, fx: [["bloom", { threshold: .75, intensity: .7 }], ["sharpen", { strength: .5 }], ["grain", { strength: .25, colored: true }]] },
  { id: "trama", name: t("look.trama"), cat: "Retro", g: { con: .2, gmap: { stops: [[0, "#02101f"], [.5, "#2a80c0"], [1, "#e8f8ff"]], amt: 1 } }, fx: [["halftone", { size: 6 }]] },
  { id: "glitch", name: t("look.glitch"), cat: "Retro", g: { con: .2, sat: 1.1 }, fx: [["rgbshift", { amount: 10 }], ["chroma", { amount: 6 }], ["scanlines", { strength: .25 }]] },
  { id: "dcian", name: t("look.dcian"), cat: "Duotono", g: { con: .15, gmap: { stops: [[0, "#021119"], [1, "#90f1ff"]], amt: 1 } } },
  { id: "dviol", name: t("look.dviol"), cat: "Duotono", g: { con: .15, gmap: { stops: [[0, "#0b0421"], [1, "#caa9ff"]], amt: 1 } } },
  { id: "drojo", name: t("look.drojo"), cat: "Duotono", g: { con: .15, gmap: { stops: [[0, "#130002"], [1, "#ff6b6b"]], amt: 1 } } }
];
const LOOK = Object.fromEntries(LOOKS.map(l => [l.id, l]));

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

export { ADJ, BUILTIN_FONTS, CATS, CAT_KEY, FX, GMAP, GROUP_KEY, LOOK, LOOKS, TEXT, adjustToGrade, catName, contrast, fxDefaults, gmapToGrade, groupName, hueMatrix, makeGrader, mcurve, schemaDefaults, stopsAt, toneVec };
