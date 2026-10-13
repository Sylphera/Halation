// Grade's looks catalogue (docs/GRADE_LOOKS_SPEC.md §3.1, §5, §6): data only, no code. A look's name is
// "lk.<id>" in the locales, its category "cat2.<cat>". A published look never changes how it looks: a retouch
// raises `rev` and moves the old definition to LEGACY_REVS (§3.4).

/* ===== categories ===== */
const CATS2 = ["film", "cinematic", "vintage", "instant", "warm", "cold", "faded", "mono", "contrast", "soft", "landscape", "night", "mood", "dreamy", "vivid"];

/* ===== looks ===== */
const LOOKS2 = [
  /* ----- film ----- */
  { id: "neg-warm", rev: 1, cat: "film", tags: ["portrait", "skin-safe", "grain", "negative"], color: {
    input: { temp: 0.14, tint: 0.02 },
    tone: { blacks: -0.01, shadows: 0.15, highlights: -0.2, contrast: 0.14, toe: 0.3, shoulder: 0.6 },
    hsl: [{ hue: 135, width: 45, dHue: -12, dSat: -0.22 }, { hue: 250, width: 40, dSat: -0.18 }],
    sat: { global: 0.94, byLuma: [0.85, 1, 0.8] },
    zones: { shadows: { hue: 200, sat: 0.08 }, highlights: { hue: 75, sat: 0.12 } },
    skin: { protect: 0.6 }, fade: { black: 0.025 } },
    finish: [["grain", { size: 1.1, strength: 0.16 }]] },
  { id: "neg-cool", rev: 1, cat: "film", tags: ["portrait", "landscape", "negative", "muted"], color: {
    input: { temp: -0.06, tint: -0.03 },
    tone: { shadows: 0.1, highlights: -0.12, contrast: 0.1, toe: 0.35, shoulder: 0.5 },
    hsl: [{ hue: 264, width: 45, dHue: -8, dSat: -0.3 }, { hue: 140, width: 45, dHue: 12, dSat: -0.12 }],
    sat: { global: 0.88 },
    zones: { shadows: { hue: 185, sat: 0.22 }, mids: { hue: 170, sat: 0.04 } },
    skin: { protect: 0.95 }, fade: { black: 0.03 } },
    finish: [["grain", { size: 1.1, strength: 0.14 }]] },
  { id: "slide", rev: 1, cat: "film", tags: ["landscape", "vivid", "contrast"], color: {
    tone: { blacks: -0.02, shadows: -0.15, contrast: 0.32, shoulder: 0.35 },
    hsl: [{ hue: 264, width: 45, dSat: 0.12, dLight: -0.08 }, { hue: 29, width: 35, dSat: 0.1 }],
    sat: { global: 1.12, byLuma: [0.95, 1.18, 0.92] },
    zones: { shadows: { hue: 260, sat: 0.08 } },
    skin: { protect: 0.5 } } },
  { id: "pushed", rev: 1, cat: "film", tags: ["grain", "contrast", "gritty"], intent: { crush: true }, color: {
    tone: { blacks: -0.04, shadows: -0.2, highlights: 0.05, contrast: 0.45, shoulder: 0.3 },
    sat: { global: 0.68, byLuma: [0.7, 1, 0.8] },
    zones: { highlights: { hue: 90, sat: 0.06 } },
    skin: { protect: 0.4 } },
    finish: [["grain", { size: 1.7, strength: 0.42 }]] },
  { id: "expired", rev: 1, cat: "film", tags: ["vintage", "grain", "faded", "cross"], intent: { hueShift: true, skin: true }, color: {
    input: { tint: 0.05 },
    tone: { shadows: 0.12, contrast: -0.08, toe: 0.4, shoulder: 0.45 },
    hsl: [{ hue: 264, width: 50, dHue: -18, dSat: -0.3 }],
    sat: { global: 0.85 },
    zones: { shadows: { hue: 340, sat: 0.26 }, highlights: { hue: 125, sat: 0.18 }, blend: 0.6 },
    fade: { black: 0.06, white: 0.95, matte: 0.4 } },
    finish: [["grain", { size: 2.1, strength: 0.36 }], ["vignette", { size: 0.45, soft: 0.7, strength: 0.25 }]] },
  { id: "tungsten", rev: 1, cat: "film", tags: ["night", "interior", "cool", "halation"], color: {
    input: { temp: -0.3 },
    tone: { contrast: 0.12, toe: 0.25, shoulder: 0.5 },
    sat: { global: 0.95 },
    zones: { shadows: { hue: 230, sat: 0.08 } },
    skin: { protect: 0.85 } },
    finish: [["halation", { threshold: 0.78, radius: 14, intensity: 0.45, tint: "#ff5a2a" }], ["grain", { size: 1.2, strength: 0.18 }]] },
  { id: "cross-x", rev: 1, cat: "film", tags: ["creative", "cross", "retro", "cover"], intent: { creative: true }, color: {
    tone: { contrast: 0.3, shoulder: 0.4 },
    curves: { r: [[0, 0.04], [0.25, 0.14], [0.75, 0.9], [1, 1]], g: [[0, 0], [0.3, 0.32], [0.7, 0.82], [1, 0.97]], b: [[0, 0.24], [0.5, 0.46], [1, 0.66]] },
    sat: { global: 1.25 },
    zones: { shadows: { hue: 250, sat: 0.4 }, highlights: { hue: 105, sat: 0.45 } },
    fade: { black: 0.03 } },
    finish: [["grain", { size: 1.6, strength: 0.32 }], ["vignette", { size: 0.4, soft: 0.65, strength: 0.4 }]] },
  { id: "pushed-3200", rev: 1, cat: "film", tags: ["creative", "grain", "gritty", "cover"], intent: { creative: true, crush: true, clip: true }, color: {
    input: { exposure: 0.05 },
    tone: { blacks: -0.06, shadows: -0.35, contrast: 0.7, highlights: 0, shoulder: 0.25 },
    sat: { global: 0.55, byLuma: [0.5, 1, 0.6] },
    zones: { shadows: { hue: 200, sat: 0.2 }, highlights: { hue: 75, sat: 0.25 } } },
    finish: [["halation", { threshold: 0.65, radius: 18, intensity: 0.8, tint: "#ff4a22" }], ["grain", { size: 2.6, strength: 0.7 }], ["vignette", { size: 0.35, soft: 0.6, strength: 0.45 }]] },
  /* ----- cinematic ----- */
  { id: "cine-teal", rev: 1, cat: "cinematic", tags: ["portrait", "skin-safe", "teal", "orange", "blockbuster"], intent: { hueShift: true }, color: {
    tone: { contrast: 0.22, shadows: -0.1, highlights: -0.15, shoulder: 0.5 },
    hsl: [{ hue: 250, width: 50, dHue: -18, dSat: -0.2 }, { hue: 140, width: 50, dHue: 30, dSat: -0.35 }, { hue: 65, width: 35, dSat: 0.12 }],
    sat: { global: 0.94 },
    zones: { shadows: { hue: 215, sat: 0.22 }, mids: { hue: 210, sat: 0.03 }, highlights: { hue: 60, sat: 0.12 }, balance: 0.1 },
    skin: { protect: 0.85 } } },
  { id: "bleach", rev: 1, cat: "cinematic", tags: ["contrast", "desaturated", "gritty"], color: {
    tone: { blacks: -0.015, contrast: 0.42, highlights: 0.05, shoulder: 0.4 },
    hsl: [{ hue: 29, width: 30, dSat: 0.6 }],
    sat: { global: 0.42, byLuma: [0.8, 1, 0.7] },
    skin: { protect: 0.3 } },
    finish: [["grain", { size: 1.2, strength: 0.15 }]] },
  { id: "blockbuster", rev: 1, cat: "cinematic", tags: ["contrast", "warm", "cool", "action"], color: {
    tone: { blacks: -0.01, shadows: -0.15, contrast: 0.28, toe: 0.1, shoulder: 0.75 },
    sat: { global: 1.02, byLuma: [0.9, 1.05, 0.9] },
    zones: { shadows: { hue: 240, sat: 0.26 }, highlights: { hue: 70, sat: 0.18 }, balance: -0.1, blend: 0.4 },
    skin: { protect: 0.7 } } },
  { id: "noir-color", rev: 1, cat: "cinematic", tags: ["muted", "red", "moody"], intent: { selective: true }, color: {
    tone: { blacks: -0.02, contrast: 0.3, shadows: -0.1, shoulder: 0.4 },
    hsl: [{ hue: 25, width: 28, dSat: 4.5 }],
    sat: { global: 0.18 },
    zones: { shadows: { hue: 230, sat: 0.06 } } },
    finish: [["vignette", { size: 0.4, soft: 0.65, strength: 0.35 }]] },
  { id: "desert", rev: 1, cat: "cinematic", tags: ["warm", "dusty", "landscape"], intent: { hueShift: true }, color: {
    input: { temp: 0.12 },
    tone: { contrast: 0.08, shadows: 0.08, shoulder: 0.45 },
    hsl: [{ hue: 245, width: 50, dHue: -30, dSat: -0.25 }, { hue: 140, width: 50, dHue: -25, dSat: -0.4 }],
    sat: { global: 0.92 },
    zones: { mids: { hue: 80, sat: 0.2 }, highlights: { hue: 85, sat: 0.08 } },
    skin: { protect: 0.4 }, fade: { black: 0.035, matte: 0.25 } } },
  { id: "neo", rev: 1, cat: "cinematic", tags: ["green", "moody", "digital"], intent: { hueShift: true }, color: {
    tone: { contrast: 0.18, shadows: -0.05, shoulder: 0.4 },
    hsl: [{ hue: 330, width: 45, dHue: -15, dSat: -0.55 }, { hue: 264, width: 45, dHue: -25, dSat: -0.3 }],
    sat: { global: 0.85 },
    zones: { shadows: { hue: 150, sat: 0.24 }, mids: { hue: 140, sat: 0.07 }, highlights: { hue: 110, sat: 0.04 } },
    skin: { protect: 0.8 } } },
  { id: "teal-max", rev: 1, cat: "cinematic", tags: ["creative", "teal", "orange", "poster"], intent: { creative: true, crush: true }, color: {
    tone: { blacks: -0.03, shadows: -0.25, contrast: 0.5, highlights: -0.15, shoulder: 0.65 },
    hsl: [{ hue: 250, width: 70, dHue: -45, dSat: 0.2 }, { hue: 140, width: 70, dHue: 60, dSat: 0.1 }, { hue: 110, width: 40, dHue: -55, dSat: 0.3 }, { hue: 330, width: 60, dHue: -60, dSat: -0.3 }, { hue: 45, width: 45, dSat: 0.45 }],
    sat: { global: 1.2 },
    zones: { shadows: { hue: 205, sat: 0.6 }, mids: { hue: 200, sat: 0.12 }, highlights: { hue: 60, sat: 0.45 }, balance: 0.1, blend: 0.4 },
    skin: { protect: 0.6 } },
    finish: [["vignette", { size: 0.35, soft: 0.6, strength: 0.4 }], ["grain", { size: 1.2, strength: 0.2 }]] },
  { id: "smoke-orange", rev: 1, cat: "cinematic", tags: ["creative", "orange", "fog", "moody", "cover"], intent: { creative: true }, color: {
    tone: { contrast: 0.25, shadows: -0.1, shoulder: 0.7 },
    sat: { global: 0.9 },
    map: { stops: [[0, "#04202a"], [0.35, "#1f4a52"], [0.65, "#c2652a"], [1, "#ffd9a8"]], amt: 0.55, tone: 0.35 },
    fade: { black: 0.03, matte: 0.4 } },
    finish: [["glow", { radius: 60, strength: 0.45 }], ["halation", { threshold: 0.6, radius: 24, intensity: 0.6, tint: "#ff5a1a" }], ["grain", { size: 1.8, strength: 0.35 }]] },
  /* ----- warm ----- */
  { id: "golden-hour", rev: 1, cat: "warm", tags: ["sunset", "portrait", "landscape"], color: {
    input: { temp: 0.28 },
    tone: { highlights: 0.08, contrast: 0.06, shoulder: 0.4 },
    hsl: [{ hue: 135, width: 50, dHue: -14, dSat: -0.05 }],
    sat: { global: 1.04, byLuma: [0.9, 1, 1.1] },
    zones: { highlights: { hue: 55, sat: 0.22 }, balance: -0.1 },
    skin: { protect: 0.3 } } },
  { id: "honey", rev: 1, cat: "warm", tags: ["portrait", "skin-safe", "soft"], color: {
    input: { temp: 0.1 },
    tone: { shadows: 0.12, contrast: -0.04, shoulder: 0.45 },
    hsl: [{ hue: 110, width: 45, dHue: -12, dSat: 0.08 }, { hue: 264, width: 45, dSat: -0.25 }],
    sat: { global: 0.98 },
    zones: { mids: { hue: 90, sat: 0.2 }, highlights: { hue: 85, sat: 0.08 } },
    skin: { protect: 0.95 }, fade: { black: 0.02 } } },
  { id: "terracotta", rev: 1, cat: "warm", tags: ["earthy", "red", "orange"], color: {
    input: { temp: 0.08 },
    tone: { contrast: 0.12, shoulder: 0.4 },
    hsl: [{ hue: 40, width: 45, dHue: -4, dSat: 0.22 }, { hue: 264, width: 55, dHue: -15, dSat: -0.45 }, { hue: 140, width: 50, dHue: -20, dSat: -0.3 }],
    sat: { global: 1 },
    zones: { shadows: { hue: 35, sat: 0.12 } },
    skin: { protect: 0.5 }, fade: { black: 0.02 } } },
  { id: "ember", rev: 1, cat: "warm", tags: ["contrast", "red", "halation", "moody"], color: {
    input: { temp: 0.16 },
    tone: { blacks: -0.01, contrast: 0.22, shadows: -0.1, highlights: -0.12, shoulder: 0.7 },
    sat: { global: 1.02, byLuma: [1.1, 1, 0.85] },
    zones: { shadows: { hue: 25, sat: 0.3 }, highlights: { hue: 70, sat: 0.08 }, blend: 0.4 },
    skin: { protect: 0.5 } },
    finish: [["halation", { threshold: 0.76, radius: 16, intensity: 0.4, tint: "#ff4a22" }]] },
  { id: "sunlit", rev: 1, cat: "warm", tags: ["bright", "clean", "portrait"], color: {
    input: { temp: 0.18, exposure: 0.22 },
    tone: { contrast: 0.04, shoulder: 0.7, toe: 0.15 },
    sat: { global: 1.03, vibrance: 0.15 },
    zones: { highlights: { hue: 80, sat: 0.08 } },
    skin: { protect: 0.5 } } },
  { id: "sunset-glow", rev: 1, cat: "warm", tags: ["creative", "sunset", "glow", "purple", "cover"], intent: { creative: true }, color: {
    tone: { contrast: 0.25, shoulder: 0.7 },
    sat: { global: 1.1 },
    map: { stops: [[0, "#1a0b3a"], [0.35, "#7a1f6e"], [0.65, "#ff6a3a"], [1, "#ffe08a"]], amt: 0.65, tone: 0.25 } },
    finish: [["halation", { threshold: 0.65, radius: 20, intensity: 0.6, tint: "#ff5a2a" }], ["bloom", { threshold: 0.65, radius: 50, intensity: 0.4, tint: "#ffc890" }], ["grain", { size: 1.2, strength: 0.15 }]] },
  { id: "inferno", rev: 1, cat: "warm", tags: ["creative", "heat", "red", "fire", "cover"], intent: { creative: true, crush: true }, color: {
    tone: { blacks: -0.03, contrast: 0.45, shadows: -0.2, shoulder: 0.5 },
    sat: { global: 1.2 },
    map: { stops: [[0, "#0a0000"], [0.3, "#5a0a0a"], [0.6, "#e0401a"], [0.85, "#ffb02a"], [1, "#fff4c0"]], amt: 0.5, tone: 0.3 } },
    finish: [["glow", { radius: 40, strength: 0.4 }], ["halation", { threshold: 0.6, radius: 16, intensity: 0.7, tint: "#ff3a10" }], ["grain", { size: 1.5, strength: 0.3 }]] },
  /* ----- cold ----- */
  { id: "nordic", rev: 1, cat: "cold", tags: ["landscape", "portrait", "muted"], color: {
    input: { temp: -0.14 },
    tone: { blacks: -0.005, contrast: 0.08, shoulder: 0.3 },
    sat: { global: 0.8 },
    zones: { shadows: { hue: 240, sat: 0.26 }, mids: { hue: 225, sat: 0.05 } },
    skin: { protect: 0.85 }, fade: { black: 0.015 } } },
  { id: "steel", rev: 1, cat: "cold", tags: ["desaturated", "contrast", "urban"], color: {
    input: { temp: -0.2 },
    tone: { blacks: -0.015, contrast: 0.3, shoulder: 0.35 },
    sat: { global: 0.45 },
    zones: { shadows: { hue: 235, sat: 0.06 }, highlights: { hue: 220, sat: 0.02 } } } },
  { id: "glacier", rev: 1, cat: "cold", tags: ["bright", "cyan", "clean"], color: {
    input: { temp: -0.12, exposure: 0.1 },
    tone: { contrast: -0.02, highlights: 0.08, shoulder: 0.55 },
    hsl: [{ hue: 230, width: 50, dHue: -18, dSat: 0.05 }],
    sat: { global: 0.9 },
    zones: { highlights: { hue: 200, sat: 0.11 }, mids: { hue: 210, sat: 0.04 } },
    skin: { protect: 0.6 }, fade: { black: 0.03 } } },
  { id: "blue-hour", rev: 1, cat: "cold", tags: ["night", "dusk", "city"], intent: { skin: true }, color: {
    input: { temp: -0.3, exposure: -0.1 },
    tone: { contrast: 0.16, shoulder: 0.4 },
    hsl: [{ hue: 60, width: 40, dSat: 0.35 }],
    sat: { global: 1.05 },
    zones: { mids: { hue: 260, sat: 0.13 }, shadows: { hue: 265, sat: 0.16 } },
    skin: { protect: 0.95 } } },
  { id: "frost", rev: 1, cat: "cold", tags: ["bright", "soft", "bloom"], color: {
    input: { temp: -0.1, exposure: 0.15 },
    tone: { highlights: 0.12, contrast: -0.1, shoulder: 0.6 },
    sat: { global: 0.62 },
    zones: { highlights: { hue: 230, sat: 0.1 }, shadows: { hue: 230, sat: 0.1 } },
    skin: { protect: 0.5 }, fade: { black: 0.04 } },
    finish: [["bloom", { threshold: 0.72, radius: 40, intensity: 0.35, tint: "#e6f0ff" }]] },
  { id: "ice-blue", rev: 1, cat: "cold", tags: ["creative", "blue", "cold", "winter", "cover"], intent: { creative: true }, color: {
    input: { temp: -0.5 },
    tone: { contrast: 0.3, highlights: 0.1, shoulder: 0.6 },
    hsl: [{ hue: 50, width: 60, dSat: -0.5 }, { hue: 140, width: 55, dHue: 50, dSat: -0.3 }, { hue: 250, width: 55, dHue: -20, dSat: 0.35 }],
    sat: { global: 1 },
    zones: { shadows: { hue: 260, sat: 0.6 }, mids: { hue: 225, sat: 0.18 }, highlights: { hue: 200, sat: 0.12 } },
    skin: { protect: 0.5 } },
    finish: [["bloom", { threshold: 0.82, radius: 45, intensity: 0.3, tint: "#d8ecff" }], ["glints", { threshold: 0.92, length: 70, strength: 0.45, tint: "#e8f4ff" }]] },
  { id: "chrome-ice", rev: 1, cat: "cold", tags: ["creative", "metal", "silver", "cyan", "cover"], intent: { creative: true, clip: true, crush: true }, color: {
    tone: { mode: "luma", blacks: -0.04, whites: 0.04, contrast: 0.65, shoulder: 0.3 },
    hsl: [{ hue: 210, width: 50, dSat: 0.6 }],
    sat: { global: 0.25 },
    zones: { shadows: { hue: 240, sat: 0.25 }, highlights: { hue: 195, sat: 0.15 } } },
    finish: [["sharpen", { radius: 1.2, strength: 0.9 }], ["grain", { size: 1.2, strength: 0.2 }]] },
  /* ----- vintage ----- */
  { id: "seventies", rev: 1, cat: "vintage", tags: ["retro", "warm", "faded"], color: {
    input: { temp: 0.1 },
    tone: { contrast: -0.06, shadows: 0.1, toe: 0.3, shoulder: 0.5 },
    hsl: [{ hue: 140, width: 50, dHue: -22, dSat: -0.3 }, { hue: 264, width: 50, dHue: -12, dSat: -0.35 }],
    sat: { global: 0.78 },
    zones: { shadows: { hue: 50, sat: 0.2 }, highlights: { hue: 100, sat: 0.2 } },
    skin: { protect: 0.3 }, fade: { black: 0.05, white: 0.96, matte: 0.3 } },
    finish: [["grain", { size: 1.4, strength: 0.2 }]] },
  { id: "sepia-print", rev: 1, cat: "vintage", tags: ["mono", "toned", "old"], intent: { mono: true }, color: {
    mixer: [[0.3, 0.6, 0.1], [0.3, 0.6, 0.1], [0.3, 0.6, 0.1]],
    tone: { contrast: 0.08, toe: 0.3, shoulder: 0.5 },
    sat: { global: 0 },
    zones: { shadows: { hue: 50, sat: 0.22 }, mids: { hue: 65, sat: 0.26 }, highlights: { hue: 80, sat: 0.12 } },
    fade: { black: 0.06, white: 0.95, matte: 0.35 } },
    finish: [["grain", { size: 1.3, strength: 0.18 }], ["vignette", { size: 0.4, soft: 0.7, strength: 0.3 }]] },
  { id: "archive", rev: 1, cat: "vintage", tags: ["retro", "red", "cyan", "faded"], intent: { hueShift: true }, color: {
    tone: { contrast: 0.06, toe: 0.35, shoulder: 0.45 },
    hsl: [{ hue: 29, width: 35, dHue: -6, dSat: 0.18, dLight: -0.06 }, { hue: 264, width: 55, dHue: -40, dSat: -0.15 }, { hue: 140, width: 50, dHue: 25, dSat: -0.35 }],
    sat: { global: 0.85 },
    zones: { shadows: { hue: 200, sat: 0.1 }, highlights: { hue: 85, sat: 0.08 } },
    skin: { protect: 0.4 }, fade: { black: 0.06, white: 0.96, matte: 0.4 } },
    finish: [["grain", { size: 1.5, strength: 0.2 }], ["dust", { density: 0.15, scratches: 0.08 }]] },
  { id: "postcard", rev: 1, cat: "vintage", tags: ["retro", "vivid", "cyan"], intent: { hueShift: true }, color: {
    tone: { contrast: 0.14, highlights: 0.06, shoulder: 0.45 },
    hsl: [{ hue: 50, width: 45, dHue: -6, dSat: 0.3 }, { hue: 264, width: 55, dHue: -38, dSat: 0.05 }, { hue: 140, width: 50, dHue: 22, dSat: -0.1 }],
    sat: { global: 1.05, byLuma: [0.9, 1.15, 0.9] },
    zones: { highlights: { hue: 195, sat: 0.08 } },
    skin: { protect: 0.4 }, fade: { black: 0.03 } },
    finish: [["vignette", { size: 0.5, soft: 0.75, strength: 0.2 }]] },
  { id: "daguerre", rev: 1, cat: "vintage", tags: ["mono", "toned", "old", "vignette"], intent: { mono: true }, color: {
    mixer: [[0.4, 0.5, 0.1], [0.4, 0.5, 0.1], [0.4, 0.5, 0.1]],
    tone: { contrast: 0.22, shadows: -0.05, shoulder: 0.6 },
    sat: { global: 0 },
    zones: { shadows: { hue: 40, sat: 0.12 }, mids: { hue: 70, sat: 0.12 }, highlights: { hue: 90, sat: 0.1 } },
    fade: { black: 0.04, white: 0.93 } },
    finish: [["vignette", { size: 0.3, soft: 0.6, strength: 0.6 }], ["grain", { size: 1.6, strength: 0.25 }], ["dust", { density: 0.25, scratches: 0.15 }]] },
  { id: "retro-print", rev: 1, cat: "vintage", tags: ["creative", "print", "halftone", "70s", "cover"], intent: { creative: true }, color: {
    tone: { contrast: 0.35, shoulder: 0.5 },
    sat: { global: 1.1 },
    map: { stops: [[0, "#2a1408"], [0.4, "#a33a1c"], [0.7, "#e59a3a"], [1, "#f6e7c8"]], amt: 0.48, tone: 0.3 },
    fade: { black: 0.06, white: 0.94, matte: 0.4 } },
    finish: [["halftone", { size: 3, angle: 45, mono: false }], ["grain", { size: 1.4, strength: 0.25 }], ["dust", { density: 0.3, scratches: 0.15 }]] },
  { id: "riso", rev: 1, cat: "vintage", tags: ["creative", "print", "risograph", "pink", "teal", "cover"], intent: { creative: true, hueShift: true }, color: {
    tone: { contrast: 0.4, shoulder: 0.4 },
    sat: { global: 0.6 },
    map: { stops: [[0, "#123a52"], [0.45, "#1f7a8c"], [0.7, "#ff4f8b"], [1, "#fff1e0"]], amt: 0.85, tone: 0.4 },
    fade: { black: 0.08, white: 0.97 } },
    finish: [["rgbshift", { amount: 3 }], ["halftone", { size: 2.5, angle: 15, mono: false }], ["grain", { size: 1.6, strength: 0.3 }]] },
  /* ----- instant ----- */
  { id: "instant-cool", rev: 1, cat: "instant", tags: ["instant", "cyan", "soft"], color: {
    input: { temp: -0.05 },
    tone: { contrast: -0.12, highlights: -0.1, toe: 0.3, shoulder: 0.65 },
    sat: { global: 0.85 },
    zones: { shadows: { hue: 200, sat: 0.24 }, highlights: { hue: 95, sat: 0.08 } },
    skin: { protect: 0.8 }, fade: { black: 0.06, white: 0.95, matte: 0.3 } } },
  { id: "instant-warm", rev: 1, cat: "instant", tags: ["instant", "warm", "soft"], color: {
    input: { temp: 0.14 },
    tone: { contrast: 0.02, highlights: -0.18, toe: 0.2, shoulder: 0.75 },
    hsl: [{ hue: 29, width: 35, dSat: -0.15 }],
    sat: { global: 0.9 },
    zones: { mids: { hue: 95, sat: 0.12 }, highlights: { hue: 90, sat: 0.1 } },
    skin: { protect: 0.5 }, fade: { black: 0.05, white: 0.96 } } },
  { id: "peel-apart", rev: 1, cat: "instant", tags: ["instant", "cross", "magenta", "green"], intent: { hueShift: true, skin: true }, color: {
    tone: { contrast: 0.06, toe: 0.3, shoulder: 0.5 },
    hsl: [{ hue: 140, width: 50, dHue: 20, dSat: -0.1 }],
    sat: { global: 0.92 },
    zones: { shadows: { hue: 150, sat: 0.2 }, highlights: { hue: 345, sat: 0.09 }, blend: 0.6 },
    skin: { protect: 0.35 }, fade: { black: 0.05, white: 0.96, matte: 0.25 } },
    finish: [["vignette", { size: 0.55, soft: 0.4, strength: 0.4 }]] },
  { id: "square", rev: 1, cat: "instant", tags: ["instant", "faded", "social"], color: {
    tone: { contrast: 0.12, shoulder: 0.5 },
    sat: { global: 0.88 },
    zones: { shadows: { hue: 260, sat: 0.08 }, highlights: { hue: 80, sat: 0.06 } },
    skin: { protect: 0.5 }, fade: { black: 0.1, white: 0.94, matte: 0.5 } } },
  { id: "flash", rev: 1, cat: "instant", tags: ["creative", "flash", "party", "cover"], intent: { creative: true, clip: true, crush: true }, color: {
    input: { exposure: 0.3, temp: -0.08 },
    tone: { blacks: -0.05, shadows: -0.4, contrast: 0.55, highlights: 0.15, shoulder: 0.35 },
    sat: { global: 1.15, byLuma: [0.7, 1.2, 0.9] },
    zones: { shadows: { hue: 240, sat: 0.35 } },
    skin: { protect: 0.7 } },
    finish: [["vignette", { size: 0.25, soft: 0.55, strength: 0.75 }], ["bloom", { threshold: 0.85, radius: 25, intensity: 0.3, tint: "#ffffff" }], ["grain", { size: 1.4, strength: 0.3 }]] },
  { id: "burnt-instant", rev: 1, cat: "instant", tags: ["creative", "instant", "burn", "leak", "cover"], intent: { creative: true }, color: {
    tone: { contrast: -0.05, highlights: -0.2, toe: 0.4, shoulder: 0.8 },
    hsl: [{ hue: 140, width: 55, dHue: 35, dSat: -0.2 }],
    sat: { global: 0.8 },
    zones: { shadows: { hue: 190, sat: 0.5 }, mids: { hue: 175, sat: 0.12 }, highlights: { hue: 30, sat: 0.3 }, blend: 0.6 },
    fade: { black: 0.12, white: 0.92, matte: 0.6 } },
    finish: [["leak", { color: "#ff5a1a", angle: 30, size: 0.75, strength: 0.75 }], ["vignette", { size: 0.45, soft: 0.4, strength: 0.6 }], ["dust", { density: 0.35, scratches: 0.2 }], ["grain", { size: 1.8, strength: 0.3 }]] },
  /* ----- faded ----- */
  { id: "matte", rev: 1, cat: "faded", tags: ["matte", "soft", "clean"], color: {
    tone: { contrast: -0.08, shoulder: 0.4 },
    fade: { black: 0.08, matte: 0.6 } } },
  { id: "washed", rev: 1, cat: "faded", tags: ["muted", "bright", "milky"], color: {
    input: { exposure: 0.1 },
    tone: { contrast: -0.15, highlights: 0.1, shoulder: 0.6 },
    sat: { global: 0.6 },
    fade: { black: 0.05, white: 0.93 } } },
  { id: "dusty", rev: 1, cat: "faded", tags: ["warm", "dust", "retro"], color: {
    input: { temp: 0.1 },
    tone: { contrast: -0.05, toe: 0.3, shoulder: 0.5 },
    sat: { global: 0.78 },
    zones: { shadows: { hue: 55, sat: 0.1 }, mids: { hue: 70, sat: 0.08 } },
    fade: { black: 0.08, white: 0.95, matte: 0.4 } },
    finish: [["dust", { density: 0.3, scratches: 0.1 }], ["grain", { size: 1.2, strength: 0.14 }]] },
  { id: "pastel", rev: 1, cat: "faded", tags: ["pastel", "soft", "bright"], color: {
    input: { exposure: 0.25 },
    tone: { contrast: -0.2, shadows: 0.15, shoulder: 0.6 },
    sat: { global: 0.8, vibrance: 0.5, byLuma: [0.7, 1, 1.1] },
    zones: { highlights: { hue: 350, sat: 0.08 } },
    skin: { protect: 0.5 }, fade: { black: 0.07, white: 0.97 } } },
  { id: "haze", rev: 1, cat: "faded", tags: ["glow", "blue", "dreamy"], color: {
    tone: { contrast: -0.12, shoulder: 0.5 },
    sat: { global: 0.85 },
    zones: { shadows: { hue: 250, sat: 0.22 }, mids: { hue: 240, sat: 0.09 } },
    skin: { protect: 0.75 }, fade: { black: 0.09, white: 0.96, matte: 0.3 } },
    finish: [["glow", { radius: 45, strength: 0.5 }]] },
  { id: "ghost-matte", rev: 1, cat: "faded", tags: ["creative", "matte", "muted", "cover"], intent: { creative: true }, color: {
    input: { exposure: 0.15 },
    tone: { contrast: -0.3, shadows: 0.25, shoulder: 0.75 },
    sat: { global: 0.45 },
    zones: { shadows: { hue: 230, sat: 0.2 }, highlights: { hue: 70, sat: 0.08 } },
    fade: { black: 0.25, white: 0.88, matte: 0.9 } },
    finish: [["glow", { radius: 40, strength: 0.3 }], ["grain", { size: 1.4, strength: 0.25 }]] },
  { id: "mint-rose", rev: 1, cat: "faded", tags: ["creative", "pastel", "pink", "mint", "cover"], intent: { creative: true }, color: {
    input: { exposure: 0.3 },
    tone: { contrast: -0.15, shadows: 0.2, shoulder: 0.75 },
    sat: { global: 0.9, vibrance: 0.4 },
    map: { stops: [[0, "#1f5a50"], [0.4, "#7fd1b5"], [0.7, "#ffb3c7"], [1, "#fff4f4"]], amt: 0.55, tone: 0.2 },
    fade: { black: 0.12, white: 0.97, matte: 0.5 } },
    finish: [["bloom", { threshold: 0.7, radius: 40, intensity: 0.25, tint: "#fff0f4" }]] },
  /* ----- mono ----- */
  { id: "bw-classic", rev: 1, cat: "mono", tags: ["bw", "mono"], intent: { mono: true }, color: {
    mixer: [[0.3, 0.59, 0.11], [0.3, 0.59, 0.11], [0.3, 0.59, 0.11]],
    tone: { contrast: 0.14, toe: 0.2, shoulder: 0.45 },
    sat: { global: 0 } } },
  { id: "bw-high-key", rev: 1, cat: "mono", tags: ["bw", "mono", "bright"], intent: { mono: true }, color: {
    mixer: [[0.35, 0.55, 0.1], [0.35, 0.55, 0.1], [0.35, 0.55, 0.1]],
    input: { exposure: 0.35 },
    tone: { contrast: -0.05, shadows: 0.2, toe: 0.5, shoulder: 0.8 },
    sat: { global: 0 } } },
  { id: "bw-noir", rev: 1, cat: "mono", tags: ["bw", "mono", "contrast", "grain"], intent: { mono: true, crush: true }, color: {
    mixer: [[0.75, 0.3, -0.05], [0.75, 0.3, -0.05], [0.75, 0.3, -0.05]],
    tone: { blacks: -0.04, shadows: -0.2, contrast: 0.45, shoulder: 0.3 },
    sat: { global: 0 } },
    finish: [["grain", { size: 1.5, strength: 0.32 }], ["vignette", { size: 0.35, soft: 0.6, strength: 0.4 }]] },
  { id: "silver", rev: 1, cat: "mono", tags: ["bw", "mono", "soft", "cool"], intent: { mono: true }, color: {
    mixer: [[0.28, 0.6, 0.12], [0.28, 0.6, 0.12], [0.28, 0.6, 0.12]],
    tone: { contrast: -0.1, shoulder: 0.6, toe: 0.3 },
    sat: { global: 0 },
    zones: { shadows: { hue: 250, sat: 0.05 }, highlights: { hue: 230, sat: 0.04 } },
    fade: { black: 0.04, white: 0.97 } } },
  { id: "selenium", rev: 1, cat: "mono", tags: ["bw", "toned", "split"], intent: { mono: true }, color: {
    mixer: [[0.32, 0.58, 0.1], [0.32, 0.58, 0.1], [0.32, 0.58, 0.1]],
    tone: { contrast: 0.16, shoulder: 0.5 },
    sat: { global: 0 },
    zones: { shadows: { hue: 290, sat: 0.28 }, highlights: { hue: 75, sat: 0.09 }, blend: 0.6 } } },
  { id: "ghost-leaf", rev: 1, cat: "mono", tags: ["bw", "infrared", "landscape"], intent: { mono: true }, color: {
    mixer: [[0.5, 1.2, -0.7], [0.5, 1.2, -0.7], [0.5, 1.2, -0.7]],
    tone: { contrast: 0.18, shoulder: 0.65, toe: 0.2 },
    hsl: [{ hue: 135, width: 55, dLight: 0.5 }],
    sat: { global: 0 } },
    finish: [["glow", { radius: 30, strength: 0.25 }], ["grain", { size: 1.2, strength: 0.18 }]] },
  { id: "bw-hard", rev: 1, cat: "mono", tags: ["creative", "bw", "graphic", "cover"], intent: { creative: true, mono: true, clip: true, crush: true }, color: {
    mixer: [[0.5, 0.45, 0.05], [0.5, 0.45, 0.05], [0.5, 0.45, 0.05]],
    tone: { blacks: -0.08, whites: 0.08, contrast: 0.85, shoulder: 0.15 },
    sat: { global: 0 } },
    finish: [["sharpen", { radius: 1, strength: 0.8 }], ["grain", { size: 1.8, strength: 0.45 }], ["vignette", { size: 0.3, soft: 0.6, strength: 0.5 }]] },
  { id: "cyanotype", rev: 1, cat: "mono", tags: ["creative", "toned", "blue", "print", "cover"], intent: { creative: true, mono: true }, color: {
    mixer: [[0.25, 0.6, 0.15], [0.25, 0.6, 0.15], [0.25, 0.6, 0.15]],
    tone: { contrast: 0.3, shoulder: 0.6, toe: 0.2 },
    sat: { global: 0 },
    map: { stops: [[0, "#06183a"], [0.5, "#1d5fa0"], [1, "#eef6ff"]], amt: 0.9, tone: 0.3 } },
    finish: [["grain", { size: 1.6, strength: 0.3 }], ["dust", { density: 0.2, scratches: 0.1 }]] },
  { id: "solarize", rev: 1, cat: "mono", tags: ["creative", "bw", "surreal", "art", "cover"], intent: { creative: true, mono: true }, color: {
    mixer: [[0.3, 0.59, 0.11], [0.3, 0.59, 0.11], [0.3, 0.59, 0.11]],
    curves: { m: [[0, 0], [0.3, 0.5], [0.55, 0.95], [0.8, 0.55], [1, 0.25]] },
    sat: { global: 0 } },
    finish: [["grain", { size: 1.2, strength: 0.15 }]] },
  /* ----- contrast ----- */
  { id: "punch", rev: 1, cat: "contrast", tags: ["contrast", "vivid", "crisp"], color: {
    tone: { blacks: -0.01, shadows: -0.1, highlights: 0.05, contrast: 0.32, shoulder: 0.45 },
    sat: { global: 1.05, vibrance: 0.2, byLuma: [0.9, 1.15, 0.95] },
    skin: { protect: 0.6 } } },
  { id: "graphic", rev: 1, cat: "contrast", tags: ["contrast", "extreme", "poster"], intent: { clip: true, crush: true }, color: {
    tone: { blacks: -0.06, whites: 0.08, contrast: 0.75, shoulder: 0.1 },
    sat: { global: 1.1 },
    skin: { protect: 0.3 } } },
  { id: "deep", rev: 1, cat: "contrast", tags: ["contrast", "moody", "dark"], color: {
    input: { exposure: -0.15 },
    tone: { shadows: -0.25, contrast: 0.22, toe: 0.15, highlights: -0.05, shoulder: 0.7 },
    sat: { global: 1, byLuma: [1.1, 1, 0.9] },
    skin: { protect: 0.5 } },
    finish: [["vignette", { size: 0.45, soft: 0.7, strength: 0.25 }]] },
  { id: "hard-light", rev: 1, cat: "contrast", tags: ["contrast", "muted", "crisp"], color: {
    tone: { mode: "luma", contrast: 0.38, shadows: -0.08, shoulder: 0.5 },
    sat: { global: 0.75 },
    skin: { protect: 0.5 } } },
  { id: "crush", rev: 1, cat: "contrast", tags: ["creative", "dark", "moody", "cover"], intent: { creative: true, crush: true }, color: {
    input: { exposure: -0.1 },
    tone: { blacks: -0.07, shadows: -0.45, contrast: 0.65, highlights: -0.05, shoulder: 0.6 },
    sat: { global: 1.2, byLuma: [0.6, 1.3, 1] },
    zones: { shadows: { hue: 250, sat: 0.2 } },
    skin: { protect: 0.6 } },
    finish: [["vignette", { size: 0.3, soft: 0.6, strength: 0.6 }], ["glow", { radius: 30, strength: 0.25 }]] },
  { id: "poster", rev: 1, cat: "contrast", tags: ["creative", "graphic", "pop-art", "halftone", "cover"], intent: { creative: true, crush: true, clip: true }, color: {
    tone: { blacks: -0.06, whites: 0.06, contrast: 0.8, shoulder: 0.2 },
    sat: { global: 1.5 },
    zones: { shadows: { hue: 235, sat: 0.55 }, highlights: { hue: 75, sat: 0.35 } } },
    finish: [["sharpen", { radius: 1.5, strength: 1 }], ["halftone", { size: 4, angle: 30, mono: false }]] },
  /* ----- soft ----- */
  { id: "soft-skin", rev: 1, cat: "soft", tags: ["portrait", "skin-safe", "soft"], color: {
    tone: { contrast: -0.12, shadows: 0.12, highlights: -0.08, shoulder: 0.6, toe: 0.2 },
    hsl: [{ hue: 29, width: 30, dSat: -0.18 }, { hue: 55, width: 30, dLight: 0.04 }],
    sat: { global: 0.94 },
    zones: { highlights: { hue: 60, sat: 0.05 } },
    skin: { protect: 0.4 }, fade: { black: 0.025 } } },
  { id: "airy", rev: 1, cat: "soft", tags: ["bright", "light", "clean"], color: {
    input: { exposure: 0.3 },
    tone: { contrast: -0.08, shadows: 0.15, shoulder: 0.75 },
    sat: { global: 0.78 },
    zones: { shadows: { hue: 240, sat: 0.1 } },
    skin: { protect: 0.6 }, fade: { black: 0.03 } } },
  { id: "cream", rev: 1, cat: "soft", tags: ["warm", "soft", "portrait"], color: {
    input: { temp: 0.1 },
    tone: { contrast: -0.06, highlights: -0.06, shoulder: 0.6 },
    sat: { global: 0.9 },
    zones: { highlights: { hue: 85, sat: 0.18 } },
    skin: { protect: 0.6 }, fade: { black: 0.06, white: 0.96, matte: 0.5 } } },
  { id: "velvet", rev: 1, cat: "soft", tags: ["moody", "soft", "glow"], color: {
    tone: { shadows: -0.15, contrast: 0.05, toe: 0.4, shoulder: 0.6 },
    sat: { global: 0.92, byLuma: [1.05, 1, 0.9] },
    zones: { shadows: { hue: 330, sat: 0.08 } },
    skin: { protect: 0.6 } },
    finish: [["glow", { radius: 30, strength: 0.25 }]] },
  { id: "porcelain", rev: 1, cat: "soft", tags: ["creative", "bright", "portrait", "clean", "cover"], intent: { creative: true, clip: true }, color: {
    input: { exposure: 0.55 },
    tone: { contrast: 0.1, shadows: 0.15, highlights: 0.1, shoulder: 0.85 },
    sat: { global: 0.5 },
    zones: { highlights: { hue: 10, sat: 0.12 }, shadows: { hue: 240, sat: 0.15 } },
    skin: { protect: 0.4 }, fade: { black: 0.05 } },
    finish: [["glow", { radius: 45, strength: 0.45 }]] },
  { id: "peach-fuzz", rev: 1, cat: "soft", tags: ["creative", "peach", "pink", "dreamy", "cover"], intent: { creative: true }, color: {
    input: { exposure: 0.25 },
    tone: { contrast: -0.15, shadows: 0.2, shoulder: 0.8 },
    sat: { global: 0.9 },
    map: { stops: [[0, "#3a2a50"], [0.45, "#e0807a"], [0.75, "#ffc4a0"], [1, "#f4f6ff"]], amt: 0.42, tone: 0.2 },
    fade: { black: 0.08, matte: 0.4 } },
    finish: [["glow", { radius: 50, strength: 0.4 }], ["grain", { size: 1.2, strength: 0.15 }]] },
  /* ----- landscape ----- */
  { id: "greens", rev: 1, cat: "landscape", tags: ["nature", "green", "sky"], color: {
    input: { temp: 0.04 },
    tone: { contrast: 0.18, highlights: -0.08, shoulder: 0.55 },
    hsl: [{ hue: 135, width: 45, dHue: 8, dSat: 0.2, dLight: -0.04 }, { hue: 110, width: 30, dHue: 12 }, { hue: 250, width: 45, dSat: 0.15, dLight: -0.08 }],
    sat: { global: 1.06 },
    skin: { protect: 0.6 } } },
  { id: "autumn", rev: 1, cat: "landscape", tags: ["nature", "orange", "warm"], intent: { hueShift: true }, color: {
    input: { temp: 0.15 },
    tone: { contrast: 0.12, shoulder: 0.5 },
    hsl: [{ hue: 140, width: 40, dHue: -45, dSat: 0.1 }, { hue: 110, width: 30, dHue: -15, dSat: 0.12 }, { hue: 60, width: 30, dSat: 0.15 }],
    sat: { global: 1.02 },
    zones: { mids: { hue: 65, sat: 0.12 }, highlights: { hue: 75, sat: 0.08 } },
    skin: { protect: 0.7 } } },
  { id: "alpine", rev: 1, cat: "landscape", tags: ["nature", "snow", "blue", "clean"], color: {
    input: { temp: -0.12, exposure: 0.12 },
    tone: { contrast: 0.16, highlights: -0.15, shoulder: 0.8 },
    hsl: [{ hue: 245, width: 45, dHue: 6, dSat: 0.12, dLight: -0.05 }, { hue: 135, width: 45, dHue: 10, dSat: -0.3 }],
    zones: { highlights: { hue: 210, sat: 0.1 } },
    sat: { global: 1 },
    skin: { protect: 0.6 } } },
  { id: "coast", rev: 1, cat: "landscape", tags: ["beach", "cyan", "sand"], color: {
    tone: { contrast: 0.08, highlights: -0.1, shoulder: 0.65 },
    hsl: [{ hue: 240, width: 50, dHue: -30, dSat: 0.08 }, { hue: 85, width: 40, dHue: 5, dSat: 0.1 }],
    sat: { global: 1 },
    zones: { highlights: { hue: 85, sat: 0.06 } },
    skin: { protect: 0.6 }, fade: { black: 0.02 } } },
  { id: "moody-forest", rev: 1, cat: "landscape", tags: ["nature", "moody", "muted"], intent: { hueShift: true }, color: {
    input: { exposure: -0.1 },
    tone: { contrast: 0.1, shadows: -0.05, shoulder: 0.5 },
    hsl: [{ hue: 135, width: 55, dHue: 15, dSat: -0.35 }, { hue: 100, width: 35, dHue: 20, dSat: -0.3 }],
    sat: { global: 0.85 },
    zones: { shadows: { hue: 215, sat: 0.2 }, mids: { hue: 190, sat: 0.04 } },
    skin: { protect: 0.6 }, fade: { black: 0.04, matte: 0.35 } } },
  { id: "epic", rev: 1, cat: "landscape", tags: ["creative", "hdr", "sky", "drama", "cover"], intent: { creative: true, crush: true }, color: {
    tone: { mode: "luma", blacks: -0.03, shadows: 0.2, highlights: -0.5, contrast: 0.65, shoulder: 0.7 },
    hsl: [{ hue: 250, width: 55, dHue: -8, dSat: 0.5, dLight: -0.3 }, { hue: 135, width: 45, dHue: 10, dSat: 0.4, dLight: -0.12 }, { hue: 70, width: 40, dSat: 0.35 }],
    sat: { global: 1.15, vibrance: 0.4 } },
    finish: [["sharpen", { radius: 1.2, strength: 0.7 }], ["vignette", { size: 0.35, soft: 0.65, strength: 0.55 }]] },
  { id: "false-color", rev: 1, cat: "landscape", tags: ["creative", "infrared", "surreal", "pink", "cover"], intent: { creative: true, hueShift: true }, color: {
    mixer: [[0.2, 1.1, -0.3], [0.9, 0.1, 0], [0, 0.15, 0.85]],
    tone: { contrast: 0.25, shoulder: 0.55 },
    hsl: [{ hue: 29, width: 50, dHue: -10, dSat: 0.4 }],
    sat: { global: 1.25 } },
    finish: [["glow", { radius: 30, strength: 0.25 }], ["grain", { size: 1.4, strength: 0.2 }]] },
  /* ----- night ----- */
  { id: "neon-city", rev: 1, cat: "night", tags: ["city", "neon", "magenta", "cyan"], intent: { hueShift: true }, color: {
    tone: { blacks: -0.01, contrast: 0.2, shadows: -0.1, shoulder: 0.5 },
    hsl: [{ hue: 40, width: 35, dHue: -25, dSat: 0.1 }, { hue: 110, width: 35, dHue: -15, dSat: -0.1 }, { hue: 330, width: 45, dSat: 0.25 }, { hue: 220, width: 45, dHue: -10, dSat: 0.2 }],
    sat: { global: 1.1 },
    zones: { shadows: { hue: 270, sat: 0.14 } },
    skin: { protect: 0.8 } },
    finish: [["bloom", { threshold: 0.65, radius: 35, intensity: 0.45, tint: "#ffffff" }]] },
  { id: "sodium", rev: 1, cat: "night", tags: ["city", "orange", "teal", "street"], color: {
    tone: { contrast: 0.18, shoulder: 0.55 },
    hsl: [{ hue: 70, width: 50, dHue: -8, dSat: 0.15 }, { hue: 250, width: 50, dHue: -30, dSat: -0.1 }],
    sat: { global: 1 },
    zones: { shadows: { hue: 200, sat: 0.24 }, highlights: { hue: 60, sat: 0.1 }, balance: 0.15 },
    skin: { protect: 0.4 } },
    finish: [["halation", { threshold: 0.75, radius: 12, intensity: 0.35, tint: "#ff7a2a" }]] },
  { id: "moonlight", rev: 1, cat: "night", tags: ["blue", "dark", "cold"], intent: { skin: true }, color: {
    input: { temp: -0.25, exposure: -0.35 },
    tone: { contrast: 0.12, shoulder: 0.5 },
    sat: { global: 0.6 },
    zones: { shadows: { hue: 255, sat: 0.12 }, mids: { hue: 250, sat: 0.05 } } } },
  { id: "after-dark", rev: 1, cat: "night", tags: ["contrast", "neon", "dark"], intent: { crush: true }, color: {
    tone: { blacks: -0.03, shadows: -0.2, contrast: 0.32, shoulder: 0.45 },
    sat: { global: 1, byLuma: [0.6, 1.05, 1.35] },
    skin: { protect: 0.5 } },
    finish: [["vignette", { size: 0.4, soft: 0.7, strength: 0.3 }]] },
  { id: "cyberpunk", rev: 1, cat: "night", tags: ["creative", "neon", "magenta", "cyan", "cover"], intent: { creative: true, crush: true }, color: {
    tone: { blacks: -0.04, shadows: -0.25, contrast: 0.5, shoulder: 0.5 },
    sat: { global: 1.3 },
    map: { stops: [[0, "#05001a"], [0.3, "#3a0a6a"], [0.55, "#ff2a9a"], [0.8, "#2af0ff"], [1, "#f0ffff"]], amt: 0.55, tone: 0.15 } },
    finish: [["chroma", { amount: 4 }], ["bloom", { threshold: 0.55, radius: 45, intensity: 0.6, tint: "#ff7af0" }], ["scanlines", { spacing: 3, strength: 0.15 }]] },
  { id: "vhs-night", rev: 1, cat: "night", tags: ["creative", "vhs", "retro", "lofi", "cover"], intent: { creative: true }, color: {
    tone: { contrast: 0.15, toe: 0.3, shoulder: 0.6 },
    hsl: [{ hue: 29, width: 40, dSat: 0.3 }, { hue: 250, width: 55, dHue: -30, dSat: 0.2 }],
    sat: { global: 1.15 },
    zones: { shadows: { hue: 280, sat: 0.3 }, highlights: { hue: 190, sat: 0.12 } },
    fade: { black: 0.06, white: 0.94 } },
    finish: [["blur", { radius: 1 }], ["rgbshift", { amount: 5 }], ["scanlines", { spacing: 3, strength: 0.35 }], ["grain", { size: 1.4, strength: 0.3 }]] },
  /* ----- mood (cover moodboard: night blues, cyan, violet, hard mono) ----- */
  { id: "midnight", rev: 1, cat: "mood", tags: ["creative", "blue", "night", "duotone", "cover"], intent: { creative: true, duotone: true, crush: true }, color: {
    input: { exposure: -0.2 },
    tone: { blacks: -0.03, shadows: -0.2, contrast: 0.35, shoulder: 0.5 },
    map: { stops: [[0, "#02040c"], [0.35, "#0a1f4a"], [0.7, "#3a7ad8"], [1, "#e8f2ff"]], amt: 0.85, tone: 0.3 } },
    finish: [["bloom", { threshold: 0.75, radius: 40, intensity: 0.35, tint: "#7ab0ff" }], ["vignette", { size: 0.4, soft: 0.7, strength: 0.4 }], ["grain", { size: 1.6, strength: 0.25 }]] },
  { id: "deep-sea", rev: 1, cat: "mood", tags: ["creative", "cyan", "teal", "fog", "cover"], intent: { creative: true, duotone: true }, color: {
    input: { exposure: -0.15 },
    tone: { contrast: 0.3, shadows: -0.2, shoulder: 0.6 },
    map: { stops: [[0, "#010a0e"], [0.4, "#0b3a48"], [0.75, "#3ab8c8"], [1, "#e0fbff"]], amt: 0.85, tone: 0.3 } },
    finish: [["glow", { radius: 60, strength: 0.3 }], ["grain", { size: 1.4, strength: 0.2 }]] },
  { id: "ultraviolet", rev: 1, cat: "mood", tags: ["creative", "violet", "neon", "duotone", "cover"], intent: { creative: true, duotone: true, crush: true }, color: {
    tone: { blacks: -0.02, shadows: -0.15, contrast: 0.3, shoulder: 0.55 },
    map: { stops: [[0, "#06021a"], [0.35, "#2a0e6a"], [0.65, "#8a5aff"], [1, "#f0e8ff"]], amt: 0.8, tone: 0.25 } },
    finish: [["chroma", { amount: 3 }], ["bloom", { threshold: 0.7, radius: 45, intensity: 0.45, tint: "#b08aff" }], ["grain", { size: 1.4, strength: 0.2 }]] },
  { id: "blue-ink", rev: 1, cat: "mood", tags: ["creative", "bw", "blue", "manga", "cover"], intent: { creative: true, duotone: true, crush: true, clip: true }, color: {
    mixer: [[0.3, 0.59, 0.11], [0.3, 0.59, 0.11], [0.3, 0.59, 0.11]],
    tone: { blacks: -0.04, whites: 0.04, contrast: 0.6, shoulder: 0.3 },
    map: { stops: [[0, "#000208"], [0.4, "#10306a"], [0.75, "#a8c4f0"], [1, "#ffffff"]], amt: 1, tone: 0.2 } },
    finish: [["sharpen", { radius: 1.2, strength: 0.6 }], ["grain", { size: 1.2, strength: 0.2 }]] },
  { id: "red-room", rev: 1, cat: "mood", tags: ["creative", "red", "spotlight", "dark", "cover"], intent: { creative: true, duotone: true, crush: true }, color: {
    tone: { blacks: -0.05, shadows: -0.35, contrast: 0.45, shoulder: 0.45 },
    map: { stops: [[0, "#000000"], [0.4, "#3a0008"], [0.75, "#e01030"], [1, "#ffd0d8"]], amt: 0.75, tone: 0.25 } },
    finish: [["bloom", { threshold: 0.65, radius: 40, intensity: 0.45, tint: "#ff2040" }], ["vignette", { size: 0.35, soft: 0.6, strength: 0.5 }], ["grain", { size: 1.6, strength: 0.25 }]] },
  { id: "afterimage", rev: 1, cat: "mood", tags: ["creative", "blur", "motion", "blue", "cover"], intent: { creative: true, duotone: true }, color: {
    tone: { contrast: 0.2, shadows: -0.1, shoulder: 0.6 },
    map: { stops: [[0, "#030612"], [0.5, "#2a5aa8"], [1, "#f0f6ff"]], amt: 0.6, tone: 0.2 } },
    finish: [["edgeblur", { radius: 18, clear: 0.3, soft: 0.5 }], ["ghost", { dx: 3, dy: 0, opacity: 0.4 }], ["glow", { radius: 40, strength: 0.25 }], ["grain", { size: 1.4, strength: 0.2 }]] },
  { id: "mint-fog", rev: 1, cat: "mood", tags: ["creative", "mint", "green", "muted", "cover"], intent: { creative: true }, color: {
    tone: { contrast: -0.05, shoulder: 0.7 },
    sat: { global: 0.85 },
    map: { stops: [[0, "#0a1410"], [0.5, "#5a7a68"], [1, "#e6f2e8"]], amt: 0.4, tone: 0.2 },
    fade: { black: 0.06, matte: 0.3 } },
    finish: [["grain", { size: 1.4, strength: 0.25 }]] },
  { id: "data-glitch", rev: 1, cat: "mood", tags: ["creative", "glitch", "cyan", "digital", "cover"], intent: { creative: true, duotone: true }, color: {
    tone: { contrast: 0.3, shadows: -0.15, shoulder: 0.5 },
    map: { stops: [[0, "#000814"], [0.45, "#1a4a8a"], [0.75, "#9ad8ff"], [1, "#ffffff"]], amt: 0.7, tone: 0.25 } },
    finish: [["rgbshift", { amount: 6 }], ["chroma", { amount: 3 }], ["glow", { radius: 30, strength: 0.25 }], ["scanlines", { spacing: 3, strength: 0.2 }]] },
  { id: "nightfall", rev: 1, cat: "mood", tags: ["creative", "blue", "low-key", "film", "cover"], intent: { creative: true, selective: true }, color: {
    input: { exposure: -0.3 },
    tone: { contrast: 0.3, shadows: -0.15, shoulder: 0.55 },
    hsl: [{ hue: 25, width: 45, dSat: 0.3 }, { hue: 80, width: 90, dSat: -0.6 }],
    sat: { global: 0.8 },
    zones: { shadows: { hue: 235, sat: 0.6 }, mids: { hue: 225, sat: 0.35 } } },
    finish: [["halation", { threshold: 0.7, radius: 20, intensity: 0.6, tint: "#ff3a22" }], ["grain", { size: 1.8, strength: 0.3 }]] },
  /* ----- dreamy ----- */
  { id: "dream-glow", rev: 1, cat: "dreamy", tags: ["glow", "soft", "halation"], color: {
    tone: { contrast: -0.1, highlights: 0.05, shoulder: 0.6 },
    sat: { global: 0.95 },
    skin: { protect: 0.5 }, fade: { black: 0.03 } },
    finish: [["halation", { threshold: 0.7, radius: 22, intensity: 0.45, tint: "#ff7a50" }], ["glow", { radius: 40, strength: 0.45 }]] },
  { id: "lavender", rev: 1, cat: "dreamy", tags: ["purple", "pink", "soft"], color: {
    tone: { contrast: -0.06, shoulder: 0.55 },
    sat: { global: 0.9 },
    zones: { shadows: { hue: 300, sat: 0.24 }, highlights: { hue: 355, sat: 0.12 } },
    skin: { protect: 0.85 }, fade: { black: 0.05, matte: 0.3 } },
    finish: [["glow", { radius: 35, strength: 0.25 }]] },
  { id: "daydream", rev: 1, cat: "dreamy", tags: ["bright", "pastel", "bloom"], color: {
    input: { exposure: 0.3 },
    tone: { contrast: -0.15, shadows: 0.15, shoulder: 0.75 },
    sat: { global: 0.85, vibrance: 0.35 },
    zones: { highlights: { hue: 30, sat: 0.06 } },
    skin: { protect: 0.6 }, fade: { black: 0.06 } },
    finish: [["bloom", { threshold: 0.6, radius: 50, intensity: 0.45, tint: "#fff4ec" }]] },
  { id: "ethereal", rev: 1, cat: "dreamy", tags: ["cold", "milky", "soft"], color: {
    input: { exposure: 0.15, temp: -0.08 },
    tone: { contrast: -0.2, highlights: 0.1, shoulder: 0.7 },
    sat: { global: 0.55 },
    zones: { highlights: { hue: 230, sat: 0.08 }, mids: { hue: 220, sat: 0.04 } },
    skin: { protect: 0.4 }, fade: { black: 0.07, white: 0.96 } },
    finish: [["glow", { radius: 50, strength: 0.4 }]] },
  { id: "cotton-candy", rev: 1, cat: "dreamy", tags: ["creative", "pastel", "pink", "blue", "cover"], intent: { creative: true }, color: {
    input: { exposure: 0.15 },
    tone: { contrast: -0.1, shadows: 0.2, shoulder: 0.8 },
    sat: { global: 0.95, vibrance: 0.5 },
    map: { stops: [[0, "#2a2a7a"], [0.45, "#7aa8ff"], [0.75, "#ffa8d8"], [1, "#fff8fc"]], amt: 0.6, tone: 0.2 },
    fade: { black: 0.08 } },
    finish: [["bloom", { threshold: 0.7, radius: 60, intensity: 0.4, tint: "#ffe6f4" }]] },
  { id: "golden-haze", rev: 1, cat: "dreamy", tags: ["creative", "gold", "glow", "sun", "cover"], intent: { creative: true }, color: {
    input: { temp: 0.3 },
    tone: { contrast: 0.05, highlights: -0.15, shoulder: 0.75 },
    sat: { global: 1.05, byLuma: [0.9, 1, 1.15] },
    zones: { mids: { hue: 70, sat: 0.2 }, highlights: { hue: 75, sat: 0.35 } },
    fade: { black: 0.07, matte: 0.2 } },
    finish: [["halation", { threshold: 0.65, radius: 30, intensity: 0.7, tint: "#ff9a40" }], ["glow", { radius: 60, strength: 0.2 }], ["leak", { color: "#ffb060", angle: -35, size: 0.6, strength: 0.3 }]] },
  { id: "prism", rev: 1, cat: "dreamy", tags: ["creative", "rainbow", "glow", "surreal", "cover"], intent: { creative: true }, color: {
    input: { exposure: 0.1 },
    tone: { contrast: 0.05, shoulder: 0.7 },
    sat: { global: 1.15, vibrance: 0.4 },
    zones: { shadows: { hue: 280, sat: 0.25 }, highlights: { hue: 60, sat: 0.15 } } },
    finish: [["chroma", { amount: 9 }], ["ghost", { dx: 2.5, dy: 0, opacity: 0.35 }], ["glow", { radius: 50, strength: 0.5 }], ["leak", { color: "#a060ff", angle: 140, size: 0.6, strength: 0.45 }]] },
  /* ----- vivid ----- */
  { id: "vivid", rev: 1, cat: "vivid", tags: ["vivid", "color", "clean"], color: {
    tone: { contrast: 0.08, shoulder: 0.5 },
    sat: { global: 1.08, vibrance: 0.55 },
    skin: { protect: 0.7 } } },
  { id: "pop", rev: 1, cat: "vivid", tags: ["vivid", "contrast", "primaries"], color: {
    tone: { contrast: 0.22, shadows: -0.05, shoulder: 0.45 },
    hsl: [{ hue: 29, width: 30, dSat: 0.2 }, { hue: 110, width: 30, dSat: 0.2 }, { hue: 264, width: 35, dSat: 0.2 }, { hue: 145, width: 30, dSat: 0.15 }],
    sat: { global: 1.12 },
    skin: { protect: 0.7 } } },
  { id: "tropical", rev: 1, cat: "vivid", tags: ["vivid", "green", "cyan", "summer"], color: {
    input: { temp: 0.05 },
    tone: { contrast: 0.12, highlights: -0.05, shoulder: 0.55 },
    hsl: [{ hue: 135, width: 45, dHue: 20, dSat: 0.4 }, { hue: 230, width: 45, dHue: -25, dSat: 0.25 }, { hue: 100, width: 30, dHue: 15 }],
    sat: { global: 1.08 },
    zones: { mids: { hue: 175, sat: 0.08 } },
    skin: { protect: 0.75 } } },
  { id: "slide-sat", rev: 1, cat: "vivid", tags: ["vivid", "contrast", "film"], color: {
    tone: { blacks: -0.02, shadows: -0.2, contrast: 0.26, shoulder: 0.5 },
    sat: { global: 1.15, byLuma: [0.95, 1.3, 0.95] },
    skin: { protect: 0.6 } } },
  { id: "hyper", rev: 1, cat: "vivid", tags: ["creative", "vivid", "saturated", "cover"], intent: { creative: true }, color: {
    tone: { contrast: 0.4, shadows: -0.1, highlights: -0.1, shoulder: 0.6 },
    sat: { global: 1.7, vibrance: 0.8 },
    skin: { protect: 0.6 } },
    finish: [["sharpen", { radius: 1, strength: 0.6 }], ["vignette", { size: 0.4, soft: 0.65, strength: 0.35 }]] },
  { id: "acid", rev: 1, cat: "vivid", tags: ["creative", "psychedelic", "surreal", "cover"], intent: { creative: true, hueShift: true }, color: {
    tone: { contrast: 0.3, shoulder: 0.5 },
    hsl: [{ hue: 29, width: 60, dHue: 60, dSat: 0.4 }, { hue: 110, width: 60, dHue: 70, dSat: 0.3 }, { hue: 160, width: 60, dHue: 80, dSat: 0.4 }, { hue: 250, width: 60, dHue: 70, dSat: 0.3 }, { hue: 320, width: 60, dHue: 60, dSat: 0.4 }],
    sat: { global: 1.4 },
    zones: { shadows: { hue: 290, sat: 0.3 } } },
    finish: [["chroma", { amount: 5 }], ["glow", { radius: 35, strength: 0.35 }]] },
  { id: "pop-art", rev: 1, cat: "vivid", tags: ["creative", "pop-art", "halftone", "comic", "cover"], intent: { creative: true, crush: true, clip: true }, color: {
    tone: { blacks: -0.05, whites: 0.05, contrast: 0.6, shoulder: 0.2 },
    sat: { global: 1.3 },
    map: { stops: [[0, "#1a0a3a"], [0.35, "#e0207a"], [0.65, "#20b8e0"], [1, "#fff04a"]], amt: 0.75, tone: 0.15 } },
    finish: [["halftone", { size: 6, angle: 45, mono: false }], ["sharpen", { radius: 1.5, strength: 0.8 }]] }
];

// Older revisions of published looks, by "id@rev" (none yet)
const LEGACY_REVS = {};

// The classic looks of the first Grade were removed (Java, 2026-10-13); saved work that names one opens with this look.
const CLASSIC = { nocturno: "midnight", hielo: "ice-blue", medianoche: "midnight", polaroid: "instant-cool", acero: "steel", violeta: "ultraviolet", ultravioleta: "ultraviolet", synth: "cyberpunk", sangre: "red-room", neonrojo: "red-room", ambar: "golden-hour", sepia: "sepia-print", bn: "bw-classic", noir: "bw-noir", plata: "silver", bnnoche: "bw-hard", portra: "neg-warm", fuji: "neg-cool", teal: "cine-teal", cross: "cross-x", faded: "matte", profundo: "deep", humo: "haze", mate: "matte", matrix: "moody-forest", esmeralda: "moody-forest", sueno: "dream-glow", halo: "dream-glow", etereo: "ethereal", destellos: "prism", vhs: "vhs-night", ccd: "flash", trama: "retro-print", glitch: "data-glitch", dcian: "deep-sea", dviol: "ultraviolet", drojo: "red-room" };
export { CATS2, CLASSIC, LOOKS2, LEGACY_REVS };
