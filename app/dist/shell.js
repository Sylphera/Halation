"use strict";
// Main window: rail and views, Home, Library page, Settings (Modules, Storage), files and processes.

/* ===== shell ===== */
// Main window: the rail and the views built from the module registry (modules.js), shortcuts, language,
// toasts and dialogs, and the shared services (window.__hal) the tool frames use. The pages live in the home,
// library, settings, modules and files sections below, the services in services.js; every section adds its
// functions to window.__shell, and window.__hal is assembled once they have all loaded.
(() => {
"use strict";
const { $, esc } = window.__ui;
const I = window.__i18n, t = I.t;
const T = window.__TAURI__;
const M = window.__motion;
const REG = window.__modules;
const invoke = T && T.core ? (...args) => T.core.invoke(...args).then(result => {
  if (args[0] === "state_set") {
    const key = args[1]?.key, tab = { visualizerExport: "visualizer", upscaleVideo: "upscale" }[key] || key;
    if (["visualizer", "grade", "upscale", "interp", "framegrab", "removebg", "covertest", "convert"].includes(tab)) S.session?.schedule(tab);
  }
  return result;
}) : () => Promise.reject(new Error("no Tauri"));
const S = window.__shell = {};

// Settings v2 (docs/SETTINGS_SPEC.md §3): only what works across Halation; each tool keeps its own defaults
// (toolDefaults, "Use as default" in the tool)
const DEFAULT_SETTINGS = {
  version: 2, language: "en", reduceMotion: false, showProcesses: true, notifyDone: true, artistName: "", links: {},
  saveMode: null, saveLocationChosen: false, videoName: "{title}.mp4", imageName: "{title}.png",
  processing: { mode: "balanced", gpu: true, minimized: "continue", limits: null, stems: "auto" },
  workspace: { budgetMB: 8192 }, modules: {}, advancedOpen: {}
};
const TOOL_DEFAULTS = {
  visualizer: { format: "1920x1080", fps: "30", quality: "std", videoCodec: "auto", audioCodec: "auto" },
  grade: { imageSize: "3000", imageFormat: "png" }
};
// 0.9.0's settings (no version) → v2: the export defaults go to their tools, the encoder to "Use the GPU", the
// frame cache limit to the workspace budget (when larger). Idempotent.
function migrateSettings(s, td) {
  if (!s || typeof s !== "object" || s.version >= 2) return false;
  const vis = td.visualizer = Object.assign({}, TOOL_DEFAULTS.visualizer, td.visualizer || {}), gr = td.grade = Object.assign({}, TOOL_DEFAULTS.grade, td.grade || {});
  const move = (from, obj, to) => { if (s[from] != null) obj[to] = String(s[from]); delete s[from]; };
  move("videoFormat", vis, "format"); move("videoFps", vis, "fps"); move("videoQuality", vis, "quality"); move("videoCodec", vis, "videoCodec"); move("audioCodec", vis, "audioCodec");
  move("imageSize", gr, "imageSize"); move("imageFormat", gr, "imageFormat");
  s.processing = Object.assign({}, DEFAULT_SETTINGS.processing, s.processing || {});
  if (s.encoder === "cpu") s.processing.gpu = false;
  delete s.encoder;
  const mb = +s.frameCacheMB || 0;
  s.workspace = Object.assign({}, DEFAULT_SETTINGS.workspace, s.workspace || {});
  if (mb > s.workspace.budgetMB) s.workspace.budgetMB = mb;
  delete s.frameCacheMB;
  s.version = 2;
  return true;
}
const FORMATS = ["1920x1080", "3840x2160", "2560x1440", "1280x720", "1080x1920", "1080x1350", "1080x1080"];
const BUILTIN_FONTS = ["Unbounded", "Hanken Grotesk", "Syne", "Michroma", "Cinzel", "UnifrakturCook", "JetBrains Mono"];
const IMG = /\.(png|jpe?g|webp|gif|avif|bmp)$/i, AUD = /\.(mp3|wav|flac|m4a|aac|ogg|opus|aiff?)$/i;
const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", avif: "image/avif", bmp: "image/bmp", mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", m4a: "audio/mp4", aac: "audio/aac", ogg: "audio/ogg", opus: "audio/ogg" };
const isImg = f => /^image\//.test(f.type) || IMG.test(f.name);
const isAud = f => /^audio\//.test(f.type) || AUD.test(f.name);
const TAB_NAMES = ["visualizer", "grade", "upscale"];

// Same rule as file_stem in main.rs and fileStem in shim.js
const fileStem = n => {
  let s = Array.from(String(n).replace(/[\u0000-\u001f\u007f-\u009f\\/:*?"<>|]/g, "-")).slice(0, 120).join("");
  s = s.trim().replace(/[. ]+$/, "");
  if (!s) s = "preset";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) s += "_";
  return s;
};

// A token's value (tokens.css), for the few places that draw with it on a canvas
const cssVar = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ---------- shared state ---------- */
const st = { settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), toolDefaults: JSON.parse(JSON.stringify(TOOL_DEFAULTS)), favorites: [], fontNames: {}, exports: [], recent: [] };
const listeners = {};
const on = (ev, fn) => { (listeners[ev] = listeners[ev] || []).push(fn); };
const emit = (ev, data) => (listeners[ev] || []).forEach(fn => { try { fn(data); } catch (e) { console.warn(e); } });
const save = (key, value) => invoke("state_set", { key, value }).catch(e => console.warn("could not save", key, e));

const ready = (async () => {
  const [s, fav, names, ex, rec, td] = await Promise.all(["settings", "fontFavorites", "fontNames", "exports", "recent", "toolDefaults"].map(key => invoke("state_get", { key }).catch(() => null)));
  // No settings saved yet: the very first start (Settings adds the welcome that asks for the artist name)
  st.firstRun = !(s && typeof s === "object");
  st.needsLanguage = !(s && typeof s.language === "string" && s.language.length);
  if (st.firstRun && !window.__halSkipWelcome) document.body.classList.add("welcome-active");
  const tds = td && typeof td === "object" ? td : {};
  if (!st.firstRun && migrateSettings(s, tds)) { save("settings", s); save("toolDefaults", tds); }
  if (!st.firstRun) Object.assign(st.settings, s);
  const legacyMode = { ask: "ask-every-time", direct: "halation-folder" }[st.settings.saveMode];
  if (legacyMode) { st.settings.saveMode = legacyMode; st.settings.saveLocationChosen = true; await invoke("state_set", { key: "settings", value: st.settings }); }
  for (const k of Object.keys(TOOL_DEFAULTS)) st.toolDefaults[k] = Object.assign({}, TOOL_DEFAULTS[k], tds[k] || {});
  st.settings.processing = Object.assign({}, DEFAULT_SETTINGS.processing, st.settings.processing || {});
  st.settings.workspace = Object.assign({}, DEFAULT_SETTINGS.workspace, st.settings.workspace || {});
  if (!isObj(st.settings.advancedOpen)) st.settings.advancedOpen = {};
  if (Array.isArray(fav)) st.favorites = fav.filter(x => typeof x === "string");
  if (names && typeof names === "object") st.fontNames = names;
  if (Array.isArray(ex)) st.exports = ex.filter(e => e && typeof e.path === "string");
  if (Array.isArray(rec)) st.recent = rec.filter(r => r && typeof r.path === "string" && TAB_NAMES.includes(r.tab));
  if (!isObj(st.settings.modules)) st.settings.modules = {};
  if (!isObj(st.settings.links)) st.settings.links = {};
  M.setReduce(!!st.settings.reduceMotion);
  await I.load(st.settings.language);
  buildRail();
  I.apply(document);
  window.__icons.apply(document);
  document.body.classList.remove("booting");
  enterApp();
  // the last run never closed (a crash, a power cut): its work was kept, and the user is told once
})();
window.__halFonts = invoke("list_fonts").catch(() => []);

/* ---------- rail, views and Home cards from the module registry ---------- */
const isObj = o => !!o && typeof o === "object" && !Array.isArray(o);
const on_ = m => REG.enabled(m, st.settings);
// The tabs on the rail, in order (Ctrl+1… follows it); modules turned off are left out
let TABS = [];
// Builds the rail, the frames of the tools and the Home cards; again whenever a module is turned on or off
function buildRail() {
  const btn = m => m.id === "home"
    ? `<button class="tab home" role="tab" data-tab="home" aria-controls="v-home" data-i18n-aria-label="tab.home"><img src="img/halation-mark.svg" alt="" width="573" height="282"></button>`
    : `<button class="tab" role="tab" data-tab="${m.id}" data-icon="${m.icon}" aria-controls="v-${m.id}" data-i18n-aria-label="tab.${m.id}"></button>`;
  const top = REG.MODULES.filter(m => m.place !== "bottom" && on_(m)), bottom = REG.MODULES.filter(m => m.place === "bottom" && on_(m));
  $("#railTop").innerHTML = top.map((m, i) => (i && m.group !== top[i - 1].group ? `<span class="rail-sep" aria-hidden="true"></span>` : "") + btn(m)).join("");
  $("#railBottom").innerHTML = bottom.map(btn).join("");
  TABS = [...top, ...bottom].map(m => m.id);
  // a tool's frame is created once, the first time the registry lists it; turning it off only hides its tab
  for (const m of REG.MODULES.filter(m => m.src && !$("#v-" + m.id))) {
    const f = document.createElement("iframe");
    Object.assign(f, { className: "view", id: "v-" + m.id }); f.dataset.src = m.src; f.dataset.i18nTitle = "tab." + m.id;
    if (m.heavy) { f.allow = "fullscreen; autoplay"; f.allowFullscreen = true; }
    f.addEventListener("load", () => { try { f.contentWindow.addEventListener("keydown", globalKeys, true); } catch (err) {} awayAll(); });
    $("#views").insertBefore(f, $("#v-library"));
  }
  $("#hcards").innerHTML = REG.MODULES.filter(m => m.home && on_(m)).map(m =>
    `<button class="hcard" data-go="${m.id}"><span class="hic" data-icon="${m.icon}"></span><b data-i18n="tab.${m.id}"></b><small data-i18n="home.d.${m.id}"></small></button>`).join("");
  document.querySelectorAll(".rail .tab").forEach(b => { b.addEventListener("click", () => show(b.dataset.tab)); b.addEventListener("pointerenter", () => preload(b.dataset.tab)); b.addEventListener("focus", () => preload(b.dataset.tab)); });
  I.apply(document); window.__icons.apply($(".rail")); window.__icons.apply($("#hcards"));
  sharedHover($("#hcards"), ".hcard");
  sharedHover($(".rail"), ".tab");
  document.querySelectorAll(".rail .tab").forEach((b, i) => { b.dataset.tip = t("shell.tabTip", { name: t("tab." + b.dataset.tab), n: i + 1 }); });
  if (active && !TABS.includes(active)) show("home");
  else if (active) { document.querySelectorAll(".rail .tab").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === active))); placePill(); }
}

// Save state reported by the tool pages ("Saved on this PC"), shown in the header for the active one
const syncState = {};
function setSync(app, s, text) { syncState[app] = { s, text }; if (app === active) showSync(); }
function showSync() {
  const v = syncState[active], el = $("#sync");
  el.hidden = !v; if (!v) return;
  el.dataset.s = v.s; $("#syncText").textContent = v.text;
}
let active = "";
// Every tool page but the one shown is away (common.js setAway): its sound fades, what plays pauses, loops stop
function awayAll() {
  for (const f of document.querySelectorAll("#views iframe.view")) {
    if (!hasPage(f)) continue;
    try { const u = f.contentWindow.__ui; if (u && u.setAway) u.setAway(f.id !== "v-" + active || !window.__renderBudget.visible); } catch (e) { /* loading */ }
  }
}
window.__renderBudget.subscribe(awayAll);
// WebView2 may keep document.hidden=false when its native window is minimized.
const nativeWindow = T?.window?.getCurrentWindow?.();
let windowStateRequest = 0;
async function syncNativeWindow() {
  if (!nativeWindow?.isMinimized) return;
  const request = ++windowStateRequest;
  try { const [minimized,focused] = await Promise.all([nativeWindow.isMinimized(),nativeWindow.isFocused?.()]); if(request === windowStateRequest){window.__renderBudget.setMinimized(minimized);if(typeof focused==='boolean')window.__renderBudget.setFocused(focused);} } catch(e) { console.warn("window visibility", e); }
}
nativeWindow?.onResized?.(syncNativeWindow);
nativeWindow?.onFocusChanged?.(syncNativeWindow);
// A reload can receive WebView focus after the initial native query, without a new native focus event.
addEventListener("focus", syncNativeWindow);addEventListener("blur", syncNativeWindow);
addEventListener("resize", syncNativeWindow);syncNativeWindow();
// Tools left behind, so that going back stays instant and memory is not held for nothing:
// - after REST_MS away a page with work open rests (its rest(): lets go of what weighs and opens it again behind the
//   picture when shown: Frame Capture's decoder, frames and sound, AI Interpolate's original); back in one frame;
// - after UNLOAD_MS away a page with nothing open (its idle(): no file, no job, no queue) is unloaded: its memory,
//   canvases and GPU contexts go; opened again it loads like the first time, with its options (hovering its dock
//   icon starts that load, shell.js preload). Minimized for more than a moment, both happen at once.
// WebView2 is then asked to give the memory back.
const REST_MS = window.__halRestMs ?? 30000, UNLOAD_MS = window.__halUnloadMs ?? 300000, leftAt = {}, rested = new Set();
// a tool page loaded (or loading): not one never opened, nor one unloaded (about:blank on its way out)
const hasPage = f => { const s = f.getAttribute("src"); return !!s && s !== "about:blank"; };
function unloadable(tab) {
  const a = loadedApp(tab);
  // never with a job of the tool queued or running (JOBS_SPEC §5)
  if (S.jobs && S.jobs.busy(tab)) return false;
  if (S.session && S.session.hasState(tab)) return false;
  try { return !!(a && a.idle && a.idle() && !(a.busy && a.busy())); } catch (e) { return false; }
}
async function unloadTool(tab) {
  const f = $("#v-" + tab), a = loadedApp(tab);
  if (a && a.flush) await Promise.race([Promise.resolve().then(() => a.flush()).catch(() => {}), new Promise(r => setTimeout(r, 800))]);
  if (tab === active || !hasPage(f) || !unloadable(tab)) return false;
  readyTabs.delete(tab); delete watching[tab]; delete leftAt[tab]; delete syncState[tab];
  S.session?.unregister(tab);
  f.src = "about:blank";
  await new Promise(r => { f.addEventListener("load", r, { once: true }); setTimeout(r, 1000); });
  if (f.getAttribute("src") === "about:blank") f.removeAttribute("src");
  return true;
}
let trimTimer = 0;
async function unloadIdle(now = false) {
  let any = false;
  for (const f of document.querySelectorAll("#views iframe.view")) {
    const tab = f.id.slice(2);
    if (tab === active || !hasPage(f) || !leftAt[tab]) continue;
    const away = now ? Infinity : Date.now() - leftAt[tab];
    if (away >= UNLOAD_MS && unloadable(tab)) { if (await unloadTool(tab)) any = true; continue; }
    if (away < REST_MS) continue;
    const a = loadedApp(tab);
    // a job that runs in the tool's page keeps it awake; one that runs a process does not
    if (S.jobs && S.jobs.list().some(j => j.tool === tab && j.host === "page" && j.state === "running")) continue;
    if (a && a.rest && !rested.has(tab)) { rested.add(tab); try { a.rest(); any = true; } catch (e) { /* its own */ } }
  }
  // what was freed goes back to the system: WebView2's memory target down a moment, then normal again
  if (any && !document.hidden && (!S.jobs || S.jobs.idle())) {
    invoke("memory_low", { low: true }).catch(() => {});
    clearTimeout(trimTimer);
    trimTimer = setTimeout(() => { if (!document.hidden) invoke("memory_low", { low: false }).catch(() => {}); }, 1500);
  }
  return any;
}
setInterval(() => unloadIdle(), 5000);
// Views with live canvases change place without the blur (motion.js swap: flat)
const HEAVY = REG.MODULES.filter(m => m.heavy).map(m => m.id);
// The title: the tool's icon (as in the dock) before its name; a new one slides in a few pixels
function pageTitle(tab, moved) {
  const h = $("#pageTitle"), b = document.querySelector(`.rail .tab[data-tab="${tab}"]`), ic = b && b.querySelector("svg,img");
  h.innerHTML = `<span class="ptic" aria-hidden="true">${ic ? ic.outerHTML : ""}</span><span></span>`;
  h.lastChild.textContent = t("tab." + tab);
  if (moved) M.fadeIn(h, { x: "xs" });
}
// The dock's light follows the pointer (shell.css .rail::before, ::after)
$(".rail").addEventListener("pointermove", e => { const r = e.currentTarget.getBoundingClientRect(); e.currentTarget.style.setProperty("--gy", e.clientY - r.top + "px"); }, { passive: true });
// …and along Home's tool bar (shell.css .hcards::before, ::after)
$("#hcards").addEventListener("pointermove", e => { const el = e.currentTarget, r = el.getBoundingClientRect(); el.style.setProperty("--gx", e.clientX - r.left + "px"); el.style.setProperty("--gyh", e.clientY - r.top + "px"); }, { passive: true });
function placePill() { const b = document.querySelector('.rail .tab[aria-selected="true"]'); M.slideTo($("#railPill"), b); }
// A smooth union of two rounded surfaces. At coincidence it is exactly one capsule;
// apart it is two complete capsules, with a continuous geometric neck in between.
// join: how much the neck may form (1 while the hover moves, 0 at rest: two capsules side by side).
function dockSurface(a, b, amount, join = 1) {
  const rect = r => {
    const radius = Math.min(14, r.width / 2, r.height / 2), x = r.left, y = r.top, w = r.width, h = r.height;
    return `M${x + radius},${y}H${x + w - radius}A${radius},${radius} 0 0 1 ${x + w},${y + radius}V${y + h - radius}A${radius},${radius} 0 0 1 ${x + w - radius},${y + h}H${x + radius}A${radius},${radius} 0 0 1 ${x},${y + h - radius}V${y + radius}A${radius},${radius} 0 0 1 ${x + radius},${y}Z`;
  };
  if (amount < .001) return rect(a);
  const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
  b = { left: cx - b.width * amount / 2, top: cy - b.height * amount / 2, width: b.width * amount, height: b.height * amount };
  const distance = Math.abs(a.top + a.height / 2 - cy);
  const u = Math.min(1, distance / 20), softness = 10 * u * u * (3 - 2 * u) * amount * join;
  if (distance >= (a.height + b.height) / 2 + softness / 2) return rect(a) + rect(b);
  const sdf = (x, y, r) => {
    const radius = Math.min(14, r.width / 2, r.height / 2);
    const qx = Math.abs(x - r.left - r.width / 2) - r.width / 2 + radius;
    const qy = Math.abs(y - r.top - r.height / 2) - r.height / 2 + radius;
    return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - radius;
  };
  const field = (x, y) => {
    const da = sdf(x, y, a), db = sdf(x, y, b);
    const blend = Math.max(softness - Math.abs(da - db), 0);
    return Math.min(da, db) - (softness ? blend * blend / (4 * softness) : 0);
  };
  const center = (a.left + a.width / 2 + cx) / 2;
  const boundary = (outside, inside) => {
    for (let i = 0; i < 18; i++) { const mid = (outside + inside) / 2; if (field(center, mid) > 0) outside = mid; else inside = mid; }
    return inside;
  };
  const top = boundary(Math.min(a.top, b.top) - softness - 1, Math.min(a.top + a.height / 2, cy));
  const bottom = boundary(Math.max(a.top + a.height, b.top + b.height) + softness + 1, Math.max(a.top + a.height / 2, cy));
  const left = [], right = [], count = Math.ceil(bottom - top);
  for (let i = 0; i <= count; i++) {
    const y = top + (bottom - top) * i / count;
    for (const side of [-1, 1]) {
      let inside = center, outside = side < 0 ? Math.min(a.left, b.left) - softness - 1 : Math.max(a.left + a.width, b.left + b.width) + softness + 1;
      for (let j = 0; j < 14; j++) { const mid = (inside + outside) / 2; if (field(mid, y) <= 0) inside = mid; else outside = mid; }
      (side < 0 ? left : right).push(`${inside.toFixed(3)},${y.toFixed(3)}`);
    }
  }
  return `M${right.join("L")}L${left.reverse().join("L")}Z`;
}
// Hover uses the same single moving piece and spring as the segmented selectors.
function sharedHover(box, selector) {
  if (box.__hover) { box.__hover.refresh(); return; }
  const pill = document.createElement("span");
  pill.className = "hover-selector"; pill.setAttribute("aria-hidden", "true");
  const dock = box.matches(".rail"), presence = { value: 0 };
  let target = null, fusionFrame = 0, presenceTween = null, presenceGoal = 0, surface = null;
  if (dock) {
    pill.style.width = pill.style.height = "44px";
    pill.innerHTML = '<svg aria-hidden="true"><path/></svg>';
    surface = pill.querySelector("path");
  }
  const fuse = () => {
    if (!dock) return;
    cancelAnimationFrame(fusionFrame);
    // Killed tweens retain their fractional progress. They no longer drive geometry.
    const remaining = tween => tween?.parent && !tween.paused() ? Math.max(0, 1 - tween.progress()) : 0;
    const step = () => {
      const on = box.querySelector('.tab[aria-selected="true"]');
      if (on) {
        const p = pill.getBoundingClientRect(), r = on.getBoundingClientRect();
        // joined only while the hover moves or appears; at rest next to the selected tool the two stand apart
        const motion = Math.max(remaining(pill._gl?.t), remaining(presenceTween));
        surface.setAttribute("d", dockSurface({ left: r.left - p.left, top: r.top - p.top, width: r.width, height: r.height },
          { left: 0, top: 0, width: p.width, height: p.height }, presence.value, motion));
      }
      fusionFrame = remaining(pill._gl?.t) || remaining(presenceTween)
        ? requestAnimationFrame(step) : 0;
    };
    step();
  };
  const visible = on => {
    if (!dock) { pill.style.opacity = on ? "1" : "0"; return; }
    pill.style.opacity = "1";
    if (presenceGoal !== Number(on)) {
      presenceGoal = Number(on);
      presenceTween = M.gsap.to(presence, { value: presenceGoal, duration: M.reduced() ? 0 : M.dur("fade") / 1000,
        ease: M.spring(), overwrite: true, onUpdate: fuse });
    }
  };
  const place = () => {
    if (!target?.isConnected) return;
    const r = target.getBoundingClientRect(), parent = box.getBoundingClientRect();
    pill.style.width = target.offsetWidth + "px";
    pill.style.height = target.offsetHeight + "px";
    M.slideTo(pill, target, { x: r.left - parent.left - box.clientLeft });
  };
  const refresh = () => {
    if (!pill.isConnected) { box.prepend(pill); delete pill.dataset.placed; }
    target = null; visible(false); fuse();
  };
  refresh();
  box.addEventListener("pointerover", e => {
    const next = e.target.closest(selector);
    if (!next || !box.contains(next) || next === target) return;
    target = next; place(); visible(true); fuse();
  });
  box.addEventListener("pointerleave", () => { target = null; visible(false); fuse(); });
  if (box.matches(".rail")) new MutationObserver(fuse)
    .observe(box, { subtree: true, attributes: true, attributeFilter: ["aria-selected"] });
  new ResizeObserver(() => { place(); fuse(); }).observe(box);
  box.__hover = { refresh };
}
// the rail changes size with the window and when modules are turned on or off
new ResizeObserver(placePill).observe(document.querySelector(".rail"));
let navigationReady = Promise.resolve();
function show(tab) {
  clearTimeout(preTimer);
  preloadRequest++;
  if (!TABS.includes(tab)) tab = TABS[0];
  const prev = active;
  active = tab;
  // the tab left behind saves what it has
  if (prev && prev !== tab) { const a = loadedApp(prev); if (a && a.leave) Promise.resolve().then(() => a.leave()).catch(() => {}); leftAt[prev] = Date.now(); }
  delete leftAt[tab]; rested.delete(tab);
  awayAll();
  document.querySelectorAll(".rail .tab").forEach(b => b.setAttribute("aria-selected", String(b.dataset.tab === tab)));
  placePill();
  pageTitle(tab, prev && prev !== tab);
  if (window.__atmo) window.__atmo.mode(tab === "home" ? "home" : tab === "library" || tab === "settings" ? "page" : "tool");
  showSync();
  const view = $("#v-" + tab);
  const swap = () => document.querySelectorAll(".view").forEach(v => v.classList.toggle("on", v.id === "v-" + tab));
  // All views compress and emerge from their center; only returning Home deforms the background.
  const back = tab === "home";
  if (back && prev && prev !== tab && window.__atmo) {
    window.__atmo.navigationWave();
    M.backgroundWave(document.querySelector(".auralis-host .auralis-wave"), back ? 7.5 : 1);
  }
  if (prev && prev !== tab) {
    const transition = M.swap(swap, { view, from: $("#v-" + prev), origin: birthOrigin(tab), back, backOrigin: back ? birthOrigin(prev) : null, flat: HEAVY.includes(tab), fromFlat: HEAVY.includes(prev) });
    navigationReady = transition?.settled || Promise.resolve();
  } else swap();
  const arrival = navigationReady;
  let loading;
  if (view.tagName === "IFRAME") {
    if (hasPage(view)) view.contentWindow.focus();
    // Paint the shell and skeleton first. An interrupted destination must not start a stale load.
    loading = arrival.then(() => {
      if (arrival !== navigationReady || active !== tab) return false;
      if (!hasPage(view)) {
        view.addEventListener("load", () => { if (active === tab) view.contentWindow.focus(); }, { once: true });
        view.src = view.dataset.src;
      }
      return whenReady(tab).then(() => arrival === navigationReady && active === tab);
    });
  }
  toolSkeleton(tab, loading);
  if (tab === "home") { S.renderHome(); if (prev !== "home") S.enterHome(navigationReady); }
  if (tab === "library") S.renderLibrary();
  if (tab === "settings") S.renderSettings();
  if (S.paintTrip) S.paintTrip();
}

/* ---------- motion around the tools: the app appearing, a tool born from its dock icon, its skeleton ---------- */
// The app appears: its skeleton (index.html #bootSkel, seen only when the start takes long enough) fades while the
// dock slides in from the left edge, its icons one after another, and the content comes forward into focus
function enterApp() {
  const sk = $("#bootSkel");
  if (sk) M.fadeOut(sk, { then: () => sk.remove() }).then(() => sk.remove());
  M.animate($(".rail"), [{ opacity: 0, transform: "translateX(-18px)" }, { opacity: 1, transform: "none" }], { dur: "place", channel: "vis" });
  M.stagger(document.querySelectorAll(".rail .tab"), (b, delay) => M.animate(b, [{ opacity: 0, transform: "translateX(-8px) scale(0.9)" }, { opacity: 1, transform: "none" }], { dur: "spring", delay: 60 + delay, channel: "vis" }));
  M.animate($(".frame"), [{ opacity: 0, transform: "scale(0.97)", filter: "blur(8px)" }, { opacity: 1, transform: "none", filter: "blur(0px)" }], { dur: "place", delay: 40, channel: "vis" });
}
// The loading skeleton shares the centered origin of its tool view.
function birthOrigin(tab) {
  const v = $("#views");
  if (!v) return undefined;
  const q = v.getBoundingClientRect();
  const o = `${Math.round(q.width / 2)}px ${Math.round(q.height / 2)}px`;
  document.documentElement.style.setProperty("--birth-o", o);
  return o;
}
// A tool's page is ready once its app has said so (__halApp.ready); one watcher per tool
const readyTabs = new Set(), watching = {};
function whenReady(tab) {
  const f = $("#v-" + tab);
  if (!f || f.tagName !== "IFRAME") return Promise.resolve();
  return watching[tab] || (watching[tab] = new Promise(res => {
    const check = () => { const a = f.contentWindow && f.contentWindow.__halApp; if (a) Promise.resolve(a.ready).then(res, res); else setTimeout(check, 40); };
    check();
  }).then(async () => {
    const a = loadedApp(tab);
    if (a?.session && S.session) await S.session.register(tab, { ...a.session, document: f.contentDocument });
    readyTabs.add(tab);
  }));
}
// Hovering (or focusing) a dock icon starts loading its tool, so the click finds it ready
let preTimer = 0, preloadRequest = 0;
function preload(tab) {
  clearTimeout(preTimer);
  const request = ++preloadRequest;
  preTimer = setTimeout(() => {
    const arrival = navigationReady;
    arrival.then(() => {
      const f = $("#v-" + tab);
      if (request !== preloadRequest || arrival !== navigationReady || !f || f.tagName !== "IFRAME" || hasPage(f) || !TABS.includes(tab)) return;
      f.src = f.dataset.src; whenReady(tab);
    });
  }, 60);
}
// Until a tool's page is ready its view shows the tool's shape (#toolSkel): its columns as they will be, crossed by a
// slow light. It appears only if the wait lasts long enough to be seen (shell.css), and fades as the tool comes in.
// Columns per tool: widths as in each tool's .work grid; "stage" is the big one.
const SKEL = {
  grade: { cols: ["330px", "stage", "340px"] },
  visualizer: { cols: ["stage", "360px"], pad: 18, max: 1560 }, framegrab: { cols: ["stage", "340px"], pad: 18, gap: 16 },
  upscale: { cols: ["stage", "360px"], pad: 18, max: 1400, gap: 18 }, interp: { cols: ["stage", "360px"], pad: 18, max: 1400, gap: 18 },
  removebg: { cols: ["stage", "340px"], pad: 18, max: 1400, gap: 18 }, stems: { cols: ["260px", "stage", "300px"], pad: 18, max: 1500, gap: 18 }, convert: { cols: ["stage"], pad: 18, max: 1100, list: true }, covertest: { cols: ["260px", "stage", "300px"], pad: 18, max: 1720, gap: 16 }, downloader: { cols: ["stage"], pad: 18, max: 1100, list: true }
};
function toolSkeleton(tab, loading) {
  const el = $("#toolSkel"), f = $("#v-" + tab), spec = SKEL[tab];
  if (!f || f.tagName !== "IFRAME" || readyTabs.has(tab) || !spec) { if (!el.hidden) { M.stop(el, "vis"); el.hidden = true; } delete el.dataset.tab; if (f) f.classList.remove("pending"); return; }
  if (el.dataset.tab === tab && !el.hidden) return;
  el.dataset.tab = tab;
  el.setAttribute("aria-label", t("shell.loadingTool", { name: t("tab." + tab) }));
  const side = '<div class="col"><i class="sk h"></i><i class="sk"></i><i class="sk w"></i><i class="sk tall"></i><i class="sk"></i><i class="sk w"></i></div>';
  const stage = spec.list ? '<div class="col"><i class="sk tall" style="height:44px"></i><i class="sk h"></i><i class="sk"></i><i class="sk w"></i><i class="sk"></i></div>'
    : '<div class="col"><i class="sk big"></i><i class="sk w"></i></div>';
  el.innerHTML = spec.cols.map(c => c === "stage" ? stage : side).join("");
  Object.assign(el.style, {
    gridTemplateColumns: spec.cols.map(c => c === "stage" ? "minmax(0,1fr)" : c).join(" "), gap: (spec.gap || 14) + "px",
    padding: `${spec.pad ? 4 : 0}px ${spec.pad || 14}px ${spec.pad ? 24 : 0}px`, maxWidth: spec.max ? spec.max + spec.pad * 2 + "px" : "", margin: spec.max ? "0 auto" : ""
  });
  el.querySelectorAll(".col").forEach(c => c.classList.add("skel"));
  f.classList.add("pending");   // the page paints as it loads: kept out of sight under its shape until it is ready
  // it emerges at the view's center, a moment later, so a quick load shows nothing
  el.hidden = false;
  const o = (birthOrigin(tab) || "0px 0px").split(" ").map(parseFloat);
  M.animate(el, [{ opacity: 0, transform: "scale(0.992)", transformOrigin: `${o[0] - el.offsetLeft}px ${o[1] - el.offsetTop}px` }, { opacity: 1, transform: "none", transformOrigin: `${o[0] - el.offsetLeft}px ${o[1] - el.offsetTop}px` }], { dur: "place", delay: 70, channel: "vis", noOvershoot: true });
  loading.then(ready => {
    if (!ready) return;
    const v = $("#v-" + tab);
    v.classList.remove("pending");
    if (el.dataset.tab !== tab) return;
    delete el.dataset.tab;
    // the tool comes forward out of its shape
    if (active === tab && v) M.animate(v, [{ opacity: 0, transform: "scale(0.985)" }, { opacity: 1, transform: "none" }], { dur: "spring", channel: "vis" });
    M.hide(el, { dur: "fade" });
  });
}
function loadedApp(tab) { const f = $("#v-" + tab); return f && hasPage(f) && f.contentWindow ? f.contentWindow.__halApp || null : null; }
function ensureApp(tab) {
  const f = $("#v-" + tab);
  // Explicit callers (Sessions, Send to, presets) still load hidden tools. If navigation is moving,
  // wait for its current transition, including one that supersedes an interrupted transition.
  if (!readyTabs.has(tab)) {
    const arrival = navigationReady;
    return arrival.then(() => {
      if (arrival !== navigationReady) return ensureApp(tab);
      if (!hasPage(f)) f.src = f.dataset.src;
      return whenReady(tab).then(() => loadedApp(tab));
    });
  }
  if (!hasPage(f)) f.src = f.dataset.src;
  return whenReady(tab).then(() => loadedApp(tab));
}
async function resetSessionTools() {
  for (const f of document.querySelectorAll("#views iframe.view")) {
    const id = f.id.slice(2), a = loadedApp(id);
    if (a?.flush) await a.flush();
    readyTabs.delete(id); delete watching[id]; delete leftAt[id]; delete syncState[id];
    if (hasPage(f)) {
      const loaded = new Promise(resolve => f.addEventListener("load", resolve, { once: true }));
      f.src = "about:blank"; await loaded; f.removeAttribute("src");
    }
  }
  for (const key of ["halation-grade-v1", "halation-visualizer-v1"]) sessionStorage.removeItem(key);
  rested.clear();
}
// A file or preset headed for a tool that is turned off: says so instead of opening it
function usable(id) {
  if (TABS.includes(id)) return true;
  toast(t("shell.moduleOff", { name: t("tab." + id) }));
  return false;
}
window.__halTab = i => { if (!TABS[i]) return false; show(TABS[i]); return true; };
// Keys that work everywhere, also with the focus inside a tool page: Ctrl+1…7 and "?"
function globalKeys(e) {
  // Ctrl+J: the processes tray (processes.js), from any view
  if (e.ctrlKey && !e.altKey && !e.shiftKey && (e.key === "j" || e.key === "J") && S.processes) { e.preventDefault(); S.processes.toggle(); return; }
  if (e.ctrlKey && !e.altKey && !e.shiftKey && /^[1-9]$/.test(e.key) && window.__halTab(+e.key - 1)) { e.preventDefault(); return; }
  if (e.key === "?" && !e.ctrlKey && !e.altKey) {
    const el = e.target, typing = el && ((/^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) && !["range", "checkbox", "radio", "button"].includes(el.type)) || el.isContentEditable);
    if (!typing) { e.preventDefault(); openKeys(); }
  }
}
document.addEventListener("keydown", e => { globalKeys(e); if (e.key === "Escape") closeLangMenu(); });
const KEYS = [
  ["general", [["tabs", "keys.tabs"], ["Ctrl+J", "keys.processes"], ["?", "keys.this"], ["Esc", "keys.close"]]],
  ["visualizer", [["keys.space", "keys.v.play"], ["← →", "keys.v.jump"], ["F", "keys.v.full"], ["keys.dblclick", "keys.reset"], ["keys.drag", "keys.v.marks"], ["keys.drop", "keys.v.drop"]]],
  ["grade", [["Ctrl+Z", "keys.undo"], ["Ctrl+Shift+Z · Ctrl+Y", "keys.redo"], ["B", "keys.g.orig"], ["keys.dblclick", "keys.reset"], ["keys.g.selectKeys", "keys.g.select"], ["↑ ↓", "keys.g.move"], ["Esc", "keys.g.unselect"]]],
  ["upscale", [["keys.wheel", "keys.u.zoom"], ["keys.drag", "keys.u.pan"], ["keys.dblclick", "keys.u.fit"], ["← →", "keys.u.divider"]]]
];
function openKeys() {
  const k = v => v === "tabs" ? `Ctrl+1…${TABS.length}` : /^keys\./.test(v) ? t(v) : v;
  $("#keysBody").innerHTML = KEYS.filter(([g]) => g === "general" || TABS.includes(g)).map(([g, rows]) => `<section><h3>${esc(g === "general" ? t("keys.general") : t("tab." + g))}</h3>${rows.map(([key, what]) => `<div class="k"><span>${esc(what === "keys.tabs" ? TABS.map(id => t("tab." + id)).join(", ") : t(what))}</span><kbd>${esc(k(key))}</kbd></div>`).join("")}</section>`).join("");
  const d = $("#keys"); if (!d.open) d.showFrom($("#keysBtn"));
}
M.dialog($("#modal")); M.dialog($("#keys"));
$("#keysBtn").addEventListener("click", openKeys);
$("#keysClose").addEventListener("click", () => $("#keys").close());
// Settings → About: the license and the third-party notices, as compiled into the executable (system.rs legal_text)
M.dialog($("#legalDlg"));
document.querySelectorAll("[data-legal]").forEach(b => b.addEventListener("click", async () => {
  const which = b.dataset.legal;
  $("#legalTitle").textContent = t(which === "license" ? "set.license" : "set.notices");
  try { $("#legalBody").textContent = await invoke("legal_text", { which }); } catch (e) { $("#legalBody").textContent = String(e && e.message || e); }
  $("#legalBody").scrollTop = 0;
  if (!$("#legalDlg").open) $("#legalDlg").showFrom(b);
}));
$("#legalClose").addEventListener("click", () => $("#legalDlg").close());
document.addEventListener("click", e => { const b = e.target.closest("[data-open]"); if (b) invoke("open_folder", { which: b.dataset.open }); });
document.addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) show(b.dataset.go); });
document.addEventListener("pointerover", e => { const b = e.target.closest && e.target.closest("[data-go]"); if (b) preload(b.dataset.go); });
$("#openBase").addEventListener("click", () => invoke("open_folder", { which: "base" }));

/* ---------- language ---------- */
const langOpen = () => $("#langBtn").getAttribute("aria-expanded") === "true";
function closeLangMenu() { if (!langOpen()) return; M.closePopover($("#langMenu")); $("#langBtn").setAttribute("aria-expanded", "false"); }
$("#langBtn").addEventListener("click", () => {
  const m = $("#langMenu"), open = !langOpen();
  m.querySelectorAll("[data-lang]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.lang === I.lang())));
  if (open) M.openPopover(m, $("#langBtn")); else M.closePopover(m);
  $("#langBtn").setAttribute("aria-expanded", String(open));
});
document.addEventListener("mousedown", e => { if (!e.target.closest(".langwrap")) closeLangMenu(); });
$("#langMenu").addEventListener("click", e => {
  const b = e.target.closest("[data-lang]"); if (!b) return;
  closeLangMenu(); setLanguage(b.dataset.lang);
});
// The header's menu and Settings → Interface: the window reloads in the new language (not while a tool is working).
// false when it could not change now.
async function setLanguage(lang) {
  if (lang === I.lang()) return true;
  const apps = REG.MODULES.filter(m => m.src).map(m => loadedApp(m.id)).filter(Boolean);
  if (apps.some(a => a.busy && a.busy())) { toast(t("shell.langBusy")); return false; }
  st.settings.language = lang;
  await invoke("state_set", { key: "settings", value: st.settings }).catch(() => {});
  await Promise.all(apps.map(a => a.flush ? a.flush().catch(() => {}) : null));
  // A language reload belongs to the same running session, not to a new launch.
  await S.session?.recovery();
  window.sessionStorage.setItem("halation-language-reload", "1");
  location.reload();
  return true;
}

/* ---------- pages in sections (Settings, Library) ---------- */
// nav: segmented tabs at the top of the page (.tabs, motion.js segmented), each with data-sec = the id of its
// section's heading. A click scrolls the page to it; while scrolling, the section under the tabs is selected.
// Returns mark(), to call when the page is shown.
function pageNav(page, nav) {
  const heads = () => [...nav.querySelectorAll("[data-sec]")].map(b => [b, document.getElementById(b.dataset.sec)]).filter(x => x[1]);
  const barBottom = () => (nav.closest(".pbar") || nav).getBoundingClientRect().bottom;
  let raf = 0, pinned = null;
  const select = b => { for (const [x] of heads()) if ((x.getAttribute("aria-selected") === "true") !== (x === b)) x.setAttribute("aria-selected", String(x === b)); };
  function mark() {
    raf = 0;
    const top = barBottom() + 24, list = heads();
    let cur = list[0];
    for (const x of list) if (x[1].getBoundingClientRect().top <= top) cur = x;
    // at the very bottom the last sections cannot reach the top: the one clicked stays selected
    if (pinned && page.scrollTop + page.clientHeight >= page.scrollHeight - 2) cur = list.find(x => x[0] === pinned) || cur;
    if (cur) select(cur[0]);
  }
  page.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(mark); }, { passive: true });
  page.addEventListener("wheel", () => { pinned = null; }, { passive: true });
  nav.addEventListener("click", e => {
    const b = e.target.closest("[data-sec]"), h = b && document.getElementById(b.dataset.sec); if (!h) return;
    pinned = b;
    const y = h.getBoundingClientRect().top - barBottom() + page.scrollTop - 8;
    page.scrollTo({ top: Math.max(0, y), behavior: M.reduced() ? "auto" : "smooth" });
    select(b);
  });
  return mark;
}

/* ---------- toasts and in-app dialogs ---------- */
let toastTimer = 0;
function toast(msg, action) {
  const el = $("#toast"); el.textContent = I.error(msg);
  if (action) { const button = document.createElement("button"); button.className = "btn sm"; button.textContent = action.label; button.onclick = action.run; el.append(" — ", button); }
  M.show(el, { y: "sm" });
  clearTimeout(toastTimer); toastTimer = setTimeout(() => M.hide(el, { y: "sm" }), action ? 10000 : 4200);
}
// altLabel: a third answer beside OK ("alt")
function ask({ title, text = "", input = null, okLabel = t("common.ok"), cancelLabel = t("common.cancel"), altLabel = "", danger = false, validate = null }) {
  return new Promise(res => {
    const m = $("#modal"), inp = $("#mInput"), ok = $("#mOk"), err = $("#mErr");
    $("#mTitle").textContent = title; $("#mText").textContent = text;
    inp.hidden = input == null; inp.value = input ?? ""; err.textContent = "";
    ok.textContent = okLabel; $("#mCancel").textContent = cancelLabel; $("#mAlt").textContent = altLabel; $("#mAlt").hidden = !altLabel; ok.className = "btn " + (danger ? "danger" : "primary"); ok.disabled = false;
    const check = () => { const e = validate ? validate(inp.value.trim()) : ""; err.textContent = e || ""; ok.disabled = !!e; };
    inp.oninput = check;
    inp.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); if (!ok.disabled) m.close("ok"); } };
    m.onclose = () => res(m.returnValue === "ok" ? (input != null ? inp.value.trim() : true) : m.returnValue === "alt" ? "alt" : null);
    m.returnValue = ""; m.showFrom(document.activeElement);
    if (input != null) { inp.focus(); inp.select(); check(); } else ok.focus();
  });
}

/* ---------- the settings as the pages read them ---------- */
// __hal.settings(): the plain object, with the tools' own defaults under their 0.9.0 names (the pages read those)
// and the encoder from "Use the GPU"
function flatSettings() {
  const v = st.toolDefaults.visualizer || {}, g = st.toolDefaults.grade || {};
  return { ...st.settings, videoFormat: v.format, videoFps: v.fps, videoQuality: v.quality, videoCodec: v.videoCodec, audioCodec: v.audioCodec,
    imageSize: g.imageSize, imageFormat: g.imageFormat, encoder: st.settings.processing && st.settings.processing.gpu === false ? "cpu" : "auto" };
}
// "Use as default" in a tool: its defaults, kept in app.json → toolDefaults
function setToolDefaults(id, obj) {
  st.toolDefaults[id] = Object.assign({}, TOOL_DEFAULTS[id] || {}, st.toolDefaults[id] || {}, obj || {});
  save("toolDefaults", st.toolDefaults);
  emit("toolDefaults", { id, value: { ...st.toolDefaults[id] } });
  emit("settings", flatSettings());
}

/* ---------- export file names ---------- */
const today = () => new Date().toISOString().slice(0, 10);
// Template from Settings ("{title}.mp4" by default); the extension comes from the actual export.
function fileName(kind, vars, ext) {
  const tpl = (kind === "video" ? st.settings.videoName : st.settings.imageName) || "{title}";
  const values = { title: "", artist: st.settings.artistName || "", date: today(), ...vars };
  let s = tpl.replace(/\.[A-Za-z0-9]{2,4}$/, "").replace(/\{(title|artist|date)\}/g, (m, k) => String(values[k] || "").trim());
  s = s.replace(/[\u0000-\u001f\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").replace(/^[\s\-–·_.]+|[\s\-–·_.]+$/g, "").trim();
  return (s || values.title || t("shell.untitled")) + "." + ext;
}

/* ---------- fonts ---------- */
async function uploadedFonts() {
  const [files, vis] = await Promise.all([invoke("font_files").catch(() => []), invoke("state_get", { key: "visualizer" }).catch(() => null)]);
  const known = {};
  if (vis && Array.isArray(vis.fonts)) for (const f of vis.fonts) if (f && f.id && f.family) known[f.id] = f.family;
  const used = new Set(BUILTIN_FONTS.map(n => n.toLowerCase())), out = [];
  for (const f of files) {
    const fam = String(st.fontNames[f.id] || known[f.id] || f.id.replace(/[-_]+/g, " ").trim() || f.id).slice(0, 60);
    let name = fam, i = 2;
    while (used.has(name.toLowerCase())) name = `${fam} ${i++}`;
    used.add(name.toLowerCase()); out.push({ id: f.id, family: name, file: f.file });
  }
  return out;
}
const fonts = {
  favorites: () => st.favorites.slice(),
  isFavorite: fam => st.favorites.includes(fam),
  toggleFavorite(fam) {
    const i = st.favorites.indexOf(fam);
    if (i >= 0) st.favorites.splice(i, 1); else st.favorites.push(fam);
    save("fontFavorites", st.favorites); emit("favorites", st.favorites.slice());
    return i < 0;
  },
  uploaded: uploadedFonts,
  register(id, family) { st.fontNames[id] = family; save("fontNames", st.fontNames); emit("fonts"); },
  changed() { emit("fonts"); }
};

Object.assign(S, { ready, unloadIdle, resetSessionTools, showSessionStatus: showSync, st, invoke, t, I, M, T, $, esc, on, emit, save, show, toast, ask, ensureApp, loadedApp, fileStem, fileName,
  isImg, isAud, MIME, TAB_NAMES, DEFAULT_SETTINGS, TOOL_DEFAULTS, FORMATS, flatSettings, setToolDefaults, migrateSettings, isObj, buildRail, usable, cssVar, active: () => active, tabs: () => TABS.slice(), setLanguage, pageNav });

// Once every part of the main window has loaded: the services for the tool frames, then Home
document.addEventListener("DOMContentLoaded", () => {
  window.__hal = {
    ready, invoke, on, emit, show, toast, ask, ensureApp, fileStem, fileName, session: S.session,
    settings: flatSettings, toolDefaults: id => ({ ...(st.toolDefaults[id] || {}) }), setToolDefaults,
    fonts, presetsWritten: S.presetsWritten, recordExport: S.recordExport, exportOpen: S.exportOpen, progress: S.progress, notify: S.notify,
    // "Send to…" (sendto section; common.js draws the menu)
    sendTargets: S.sendTargets, sendTo: S.sendTo, itemFile: S.itemFile,
    sendToVisualizer: S.sendToVisualizer, sendToGrade: S.sendToGrade, sendToUpscale: S.sendToUpscale, fileFromPath: S.fileFromPath,
    exportLocation: S.exportLocation,
    tempFile: S.tempFile, writeFile: S.writeFile, saveOutput: S.saveOutput, routeFiles: S.routeFiles, filePicked: S.filePicked, setSync, recent: S.recent,
    tools: S.tools, installTool: S.installTool, runTool: S.runTool, encoder: window.__halEncoder,
    // the jobs system (jobs.js): every heavy piece of work waits in its lane there
    jobs: S.jobs, jobLaunched: (btn, handle, o) => S.jobLaunched && S.jobLaunched(btn, handle, o),
    // Crop and Cutout, the shared image services (services.js: crop, cutout, cutdlg)
    crop: S.crop, fitCrop: S.fitCrop, cutout: S.cutout, cutoutDialog: S.cutoutDialog, cutoutReady: S.cutoutReady,
    cutoutEnsure: S.cutoutEnsure, cutoutBatch: S.cutoutBatch, saveCutout: S.saveCutout, saveVersion: S.saveVersion,
    autoMask: S.autoMask, refineMask: S.refineMask, samEmbed: S.samEmbed, samDecode: S.samDecode, samAuto: S.samAuto, samCrop: S.samCrop,
    // Frame Grab's extractor and the round trip into it (services.js: frames)
    videoPath: S.videoPath, pickVideo: S.pickVideo, probeVideo: S.probeVideo, videoKey: S.videoKey, readRange: S.readRange, frameAt: S.frameAt,
    keyIndex: S.keyIndex, keyframes: S.keyframes, keyPictures: S.keyPictures, frames: S.frames,
    analyseVideo: S.analyseVideo, candidates: S.candidates, sceneCut: S.sceneCut, frameGrab: S.frameGrab,
    // the Library (services.js: libdata) and its picker (library section)
    library: S.library, pickFromLibrary: S.pickFromLibrary,
    // the artist profile and the Cover Test's feed (services.js: profile)
    profile: S.profile, findLinks: (name, from) => S.findLinks(name, from),
    tabs: S.tabs, usable: S.usable, loadedApp: S.loadedApp,
    // bytes for the main window (IPC only takes arrays created here)
    U8: Uint8Array
  };
  ready
    .then(() => {
      show("home");
      // Reuse the approved Home deformation once, when its canvas has mounted.
      const entrance = () => {
        if (S.active() !== "home") return;
        const canvas = document.querySelector(".auralis-host .auralis-wave");
        if (canvas) M.backgroundWave(canvas, 7.5); else requestAnimationFrame(entrance);
      };
      requestAnimationFrame(entrance);
    })
    .then(() => { S.pollPresets(); S.firstStart(); return S.openPending(); });
});
})();

/* ===== home ===== */
// Home page: tool cards, recent files and the drop zone.
// Part of the main window (the shell section holds the shared state; this section adds its functions to window.__shell).
(() => {
"use strict";
const S = window.__shell;
const { $, esc, t, M, invoke, st, save, toast, show, ensureApp, isAud, TAB_NAMES } = S;

/* ---------- Home: tool cards, recent files, drop zone ---------- */
const RECENT_MAX = 12;
const TAB_ICON = { visualizer: "audio-lines", grade: "palette", upscale: "image-up" };
let recentDir = "";
function imageThumb(file) {
  return new Promise(res => {
    const url = URL.createObjectURL(file), img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas"), n = 200, s = Math.min(img.naturalWidth, img.naturalHeight);
      c.width = c.height = n;
      c.getContext("2d").drawImage(img, (img.naturalWidth - s) / 2, (img.naturalHeight - s) / 2, s, s, 0, 0, n, n);
      URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); res(""); };
    img.src = url;
  });
}
// Called by the tabs when a file is opened: tab is where it opens again, as "audio", "image" or "cover". Files outside the Halation folder are copied to Settings\Recent.
async function recent(file, tab, as, thumb0) {
  if (!file || !TAB_NAMES.includes(tab)) return;
  S.session?.schedule(tab);
  try {
    const kind = as || (isAud(file) ? "audio" : "image");
    const key = [tab, kind, file.name, file.size].join("|");
    const prev = st.recent.find(r => r.key === key);
    // the same file opened in another tab shares its copy
    const same = st.recent.find(r => r.name === file.name && r.size === file.size);
    let path = prev ? prev.path : file.__halPath || (same ? same.path : "");
    // a file of the Library opened in a tool: up in its Recent and "Used in"
    if (file.__halPath && S.library && S.library.get(file.__halPath)) S.library.touch(file.__halPath, tab);
    if (!path) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      path = await invoke("temp_write", bytes, { headers: { "x-name": encodeURIComponent(file.name), "x-dir": "recent" } });
    }
    const thumb = thumb0 || prev && prev.thumb || (kind === "audio" ? "" : await imageThumb(file));
    const entry = { key, name: file.name, size: file.size, tab, kind, path, thumb, at: Date.now() };
    const list = [entry].concat(st.recent.filter(r => r.key !== key));
    st.recent = list.slice(0, RECENT_MAX);
    forgetCopies(list.slice(RECENT_MAX));
    save("recent", st.recent);
    if (S.active() === "home") renderHome();
  } catch (e) { console.warn("recent", e); }
}
// Removes the copies in Settings\Recent that no entry uses any more
async function forgetCopies(gone) {
  if (!recentDir) recentDir = await invoke("paths").then(p => p.settings).catch(() => "");
  const inRecent = p => recentDir && p.startsWith(recentDir) && /[\\/]Recent[\\/][^\\/]+$/.test(p);
  const paths = gone.map(r => r.path).filter(p => inRecent(p) && !st.recent.some(r => r.path === p));
  if (paths.length) invoke("delete_paths", { paths }).catch(() => {});
}
function renderHome(cleared = false) {
  const list = st.recent;
  $("#cntRecent").textContent = list.length || "";
  $("#recentClear").hidden = !list.length;
  const paint = () => { $("#recent").innerHTML = list.length ? list.map((r, i) => {
    const to = r.kind === "cover" ? t("home.asCover") : t("tab." + r.tab);
    const th = r.thumb ? ` style="background-image:url('${esc(r.thumb)}')"` : "";
    return `<button class="rcard" data-recent="${i}" data-key="${esc(r.key || r.path)}" title="${esc(r.name + " · " + t("home.opensIn", { tab: to }))}"><span class="th"${th}>${r.thumb ? "" : window.__icons.icon("music")}</span><b>${esc(r.name)}</b><span class="to">${window.__icons.icon(TAB_ICON[r.tab])}${esc(to)}</span></button>`;
  }).join("") : `<p class="empty">${esc(t("home.noRecent"))}</p>`; };
  if (cleared) paint(); else M.list($("#recent"), paint, { sel: ":scope > .rcard" });
}
// Home appears in order: the symbol, the wordmark, the line under it, then the tool bar
function enterHome(after) {
  const hero = $("#v-home .hero");
  // Home's pieces come forward one after another, a few pixels, as the place settles
  const parts = [hero.querySelector(".logo"), hero.querySelector(".word"), hero.querySelector(".note"), $("#hcards")];
  M.stagger(parts, (el, delay) => M.fadeIn(el, { y: 8, scale: el.classList.contains("logo") ? 0.96 : 1, delay: 40 + delay, after }));
}

async function openRecent(r) {
  let file;
  try { file = await S.fileFromPath(r.path); }
  catch (e) {
    toast(t("home.missing", { name: r.name }));
    st.recent = st.recent.filter(x => x !== r); save("recent", st.recent); renderHome();
    return;
  }
  const f = new File([file], r.name, { type: file.type }); f.__halPath = r.path;
  if (r.tab === "grade") await S.sendToGrade(f, r.name);
  else if (r.tab === "upscale") await S.sendToUpscale({ path: r.path, name: r.name });
  else if (r.kind === "audio") { if (!S.usable("visualizer")) return; const v = await ensureApp("visualizer"); show("visualizer"); await v.loadAudio(f); }
  else await S.sendToVisualizer(f, r.name);
}
$("#recent").addEventListener("click", e => { const b = e.target.closest("[data-recent]"); if (b && st.recent[+b.dataset.recent]) openRecent(st.recent[+b.dataset.recent]).catch(err => toast(String(err && err.message || err))); });
$("#recentClear").addEventListener("click", async () => {
  const button = $("#recentClear"), container = $("#recent"), gone = st.recent;
  if (!gone.length || button.disabled) return;
  button.disabled = true;
  st.recent = []; save("recent", []); forgetCopies(gone);
  const out = M.animate(container, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(3px)" }],
    { dur: "fade", channel: "recent-clear", fill: "forwards", noOvershoot: true });
  await out?.finished;
  out?.cancel();
  M.flip([container.closest(".card")], () => renderHome(true), { dur: "place" });
  M.fadeIn(container.querySelector(".empty"), { y: 3, dur: "place" });
  button.disabled = false;
});
/* ---------- Home: the drop target ---------- */
// A click browses; an image dropped or picked on Home asks where it goes inside the same bubble (files: chooseImage)
const drop = $("#homeDrop");
drop.addEventListener("click", e => { if (!drop.classList.contains("choosing") && !e.target.closest(".hd-acts")) $("#homeIn").click(); });
drop.addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget && !drop.classList.contains("choosing")) { e.preventDefault(); $("#homeIn").click(); } });
drop.addEventListener("pointermove", e => { const r = drop.getBoundingClientRect(); drop.style.setProperty("--gx", e.clientX - r.left + "px"); drop.style.setProperty("--gyh", e.clientY - r.top + "px"); }, { passive: true });
$("#homeIn").addEventListener("change", e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  const r = drop.getBoundingClientRect();
  S.dropped([f], r.left + r.width / 2, r.top + r.height / 2);
});
let thumbUrl = "";
// shows the question for this image (buttons: the tools on), or goes back to the invitation with no file
function homeChoice(file, tos) {
  if (thumbUrl) { URL.revokeObjectURL(thumbUrl); thumbUrl = ""; }
  const on = !!file;
  drop.classList.toggle("choosing", on);
  if (on) {
    thumbUrl = URL.createObjectURL(file);
    $("#homeChoiceThumb").style.backgroundImage = `url("${thumbUrl}")`;
    $("#homeChoiceName").textContent = file.name; $("#homeChoiceName").title = file.name;
    $("#homeChoiceActs").querySelectorAll("[data-to]").forEach(b => { b.hidden = b.dataset.to !== "cancel" && !tos.includes(b.dataset.to); });
  }
  const out = drop.querySelector(on ? ".hd-idle" : ".hd-choice"), inn = drop.querySelector(on ? ".hd-choice" : ".hd-idle");
  out.hidden = true; inn.hidden = false; M.fadeIn(inn, { y: 4 });
  if (on) { const b = $("#homeChoiceActs").querySelector("[data-to]:not([hidden])"); if (b) b.focus(); }
}
// a file dragged over Home lights the bubble instead of the window-wide overlay
function homeDragOver(on, x, y) {
  drop.classList.toggle("over", on);
  M.dropSurface(drop, on ? "over" : "rest", x, y);
  if (on && x != null) { const r = drop.getBoundingClientRect(); drop.style.setProperty("--gx", x - r.left + "px"); drop.style.setProperty("--gyh", y - r.top + "px"); }
}

Object.assign(S, { renderHome, enterHome, recent, homeChoice, homeDragOver });
})();

/* ===== library ===== */
// Library page (docs/LIBRARY_SPEC.md): the view (libpanel.js) over the index (services.js → libdata) under four tabs,
// the presets' folders watched, exports recorded into the index, preset actions and the picker the tools open.
// Part of the main window (the shell section holds the shared state; this section adds its functions to window.__shell).
(() => {
"use strict";
const S = window.__shell;
const { $, t, M, invoke, toast, ask, show, ensureApp, loadedApp, fileStem } = S;

/* ---------- presets: watching the folder ---------- */
const stamps = {};
const TAB_OF = { visualizer: "visualizer", grade: "grade" };
function reloadApp(kind) { const a = loadedApp(TAB_OF[kind]); if (a && a.reloadPresets) a.reloadPresets().catch(e => console.warn(e)); }
async function pollPresets() {
  let changed = false;
  for (const kind of ["visualizer", "grade"]) {
    const s = await invoke("preset_stamp", { kind }).catch(() => null);
    if (s == null) continue;
    if (stamps[kind] !== undefined && s !== stamps[kind]) { reloadApp(kind); changed = true; }
    stamps[kind] = s;
  }
  if (changed && S.library) S.library.sync();
}
async function presetsWritten(kind) {
  stamps[kind] = await invoke("preset_stamp", { kind }).catch(() => stamps[kind]);
  if (S.library) S.library.sync();
}
async function afterPresetOp(kind) {
  stamps[kind] = await invoke("preset_stamp", { kind }).catch(() => stamps[kind]);
  reloadApp(kind);
  if (S.library) await S.library.sync();
}
setInterval(() => { if (!document.hidden) pollPresets(); }, 2500);

/* ---------- the page ---------- */
let panel = null;
function mountPanel() { if (!panel) panel = window.__libPanel.mount($("#libPanel"), { mode: "page" }); return panel; }
function markTab() { const tab = mountPanel().state.tab; for (const b of $("#libNav").children) if (b.dataset.tab) b.setAttribute("aria-selected", String(b.dataset.tab === tab)); }
// shown again: the view as left, without the old selection
function renderLibrary() { mountPanel(); panel.state.picked.clear(); markTab(); panel.refresh(); S.library.sync(); }
$("#libNav").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (!b) return; mountPanel().setTab(b.dataset.tab); markTab(); });
$("#libRefresh").addEventListener("click", () => { pollPresets(); if (S.library) S.library.sync(); if (panel) panel.refresh(); });
$("#libAdd").addEventListener("click", () => mountPanel().addFromPc().catch(e => toast(String(e && e.message || e))));

// An export or a download of a tool into the index (with the thumbnail the tool drew). o.tool: the tool; the one
// shown when it is not given
function recordExport(entry) {
  if (!entry || !entry.path || !S.library) return;
  S.exportLocation.success(entry.path);
  const shown = S.active(), tool = entry.tool || (shown === "home" || shown === "library" || shown === "settings" ? null : shown);
  const type = /[\\/]Downloads[\\/]/i.test(entry.path) ? "download" : "export";
  S.library.add(entry.path, { type, kind: entry.kind === "video" || entry.kind === "audio" ? entry.kind : "image", origin: tool ? { tool } : undefined, thumb: entry.thumb || null })
    .catch(e => console.warn("library", e));
}
// A look's thumbnail: its layers drawn by Grade on the sample picture
async function lookThumb(item) {
  const o = JSON.parse(new TextDecoder().decode(await invoke("library_read", { path: item.path })).replace(/^﻿/, ""));
  const layers = Array.isArray(o) ? o : o && Array.isArray(o.layers) ? o.layers : null;
  if (!layers) return null;
  const g = await ensureApp("grade");
  return g.thumb(layers, 240);
}

/* ---------- a cut-out version, a cropped copy (docs/ARCHITECTURE.md → Shared services) ---------- */
// Beside the original when it is inside Halation's folder; otherwise in Exports (the file of the PC stays untouched).
// The new file is indexed with the item it was made from.
const IMG = window.__img;
async function imageVersion(act, item, from) {
  const base = await invoke("paths").then(p => p.base).catch(() => ""), beside = base && item.path.startsWith(base) ? item.path : null;
  let p = null;
  if (act === "cutout") {
    if (!(await S.cutoutEnsure())) return null;
    toast(t("lib.cutting", { name: item.name }));
    const r = await S.cutout(await S.library.file(item), { job: { tool: "library", title: item.name } });
    p = await S.saveCutout(r.rgba, { name: item.name, beside });
  } else {
    const pic = await IMG.load(await S.library.file(item)), r = await S.crop({ image: pic, name: item.name, ratio: "free", from });
    if (!r) return null;
    const jpg = /\.jpe?g$/i.test(item.path), blob = await IMG.toBlob(IMG.render(pic, r.params), jpg ? "image/jpeg" : "image/png", 0.95);
    p = await S.saveVersion(blob, { name: item.name, beside, tag: "crop", ext: jpg ? "jpg" : "png" });
  }
  await S.library.add(p, { type: item.type === "asset" ? "asset" : "export", origin: { tool: act === "cutout" ? "removebg" : null, from: [item.id] } });
  return p;
}

/* ---------- preset actions: apply, rename, duplicate, delete ---------- */
async function presetNames(kind) { return (await invoke("preset_list", { kind }).catch(() => [])).map(p => p.name); }
async function presetAction(kind0, act, name) {
  const kind = kind0, tab = TAB_OF[kind], what = t(kind === "grade" ? "lib.look" : "lib.preset");
  if (!tab) return;
  const taken = async (v, except) => (await presetNames(kind)).some(n => n.toLowerCase() === v.toLowerCase() && n !== except);
  try {
    if (act === "apply") {
      if (!S.usable(tab)) return;
      const a = await ensureApp(tab); await a.applyPreset(name); show(tab);
    } else if (act === "rename") {
      const names = await presetNames(kind);
      const to = await ask({ title: t("lib.renameTitle", { what }), text: t("lib.renameText", { name }), input: name, okLabel: t("lib.act.rename"),
        validate: v => v === name ? "" : !v ? t("lib.err.empty") : fileStem(v) !== v ? t("lib.err.chars") : names.some(n => n.toLowerCase() === v.toLowerCase() && n !== name) ? t("lib.err.taken") : "" });
      if (!to || to === name) return;
      await invoke("preset_rename", { kind, from: name, to, copy: false }); await afterPresetOp(kind); toast(t("lib.renamed", { name: to }));
    } else if (act === "dup") {
      let to = t("lib.copyName", { name }), n = 2;
      while (await taken(to) || fileStem(to) !== to) to = t("lib.copyNameN", { name, n: n++ });
      await invoke("preset_rename", { kind, from: name, to, copy: true }); await afterPresetOp(kind); toast(t("lib.duplicated", { name: to }));
    } else if (act === "del") {
      const ok = await ask({ title: t("lib.deleteTitle", { what }), text: t("lib.deleteText", { name }), okLabel: t("common.delete"), danger: true });
      if (!ok) return;
      await invoke("preset_delete", { kind, name }); await afterPresetOp(kind); toast(t("lib.deleted", { name }));
    }
  } catch (e) { toast(String(e && e.message || e)); }
}

/* ---------- the picker for the tool tabs: the same view, the kinds the tool takes, opened on Recent ---------- */
let pickPanel = null, picking = null;
const pickDlg = $("#libPick");
M.dialog(pickDlg);
// A picture (or video) chosen in the Library, as a File; null when the dialog is closed
function pickFromLibrary(o = {}) {
  const kinds = o.images || o.kind === "image" ? ["image"] : o.kind === "video" ? ["video"] : o.kind === "audio" ? ["audio"] : ["image", "video"];
  const use = async x => { const r = picking; picking = null; pickDlg.close(); S.library.touch(x.id, S.active()); if (r) r(await S.library.file(x).catch(() => null)); };
  // one picker per set of kinds (its chips and filter are fixed)
  if (!pickPanel || pickPanel.kinds !== kinds.join()) {
    $("#libPickBody").replaceChildren();
    pickPanel = window.__libPanel.mount($("#libPickBody"), { mode: "picker", kinds, use: x => use(x) });
    pickPanel.kinds = kinds.join();
  } else pickPanel.refresh();
  return new Promise(res => {
    picking = x => res(x);
    pickDlg.addEventListener("close", () => { if (picking) { picking = null; res(null); } }, { once: true });
    pickDlg.showFrom(o.from || document.activeElement);
    setTimeout(() => pickPanel.focus(), 0);
  });
}
$("#libPickClose").addEventListener("click", () => pickDlg.close());

Object.assign(S, { renderLibrary, pollPresets, presetsWritten, recordExport, lookThumb, presetAction, imageVersion, mountLibraryPanel: mountPanel, pickFromLibrary });
})();

/* ===== settings ===== */
// Settings page: saving, names, video and image defaults, interface, notifications, folders.
// Part of the main window (the shell section holds the shared state; this section adds its functions to window.__shell).
(() => {
"use strict";
const S = window.__shell;
const { $, esc, t, M, invoke, st, save, emit, fileName, DEFAULT_SETTINGS } = S;

/* ---------- Settings ---------- */
// docs/SETTINGS_SPEC.md: General, You, Files, Processing, Tools, Storage, About; each with an "Advanced" that
// remembers whether it was left open. The tools' export defaults live in the tools ("Use as default").
const TEXTS = { setArtistName: "artistName", setVideoName: "videoName", setImageName: "imageName" };
const LIMITS = { cpu: [1, 2, 3, 4], gpu: [1, 2], net: [1, 2, 3, 4] };
function setSetting(k, v) { st.settings[k] = v; save("settings", st.settings); emit("settings", S.flatSettings()); }
const setProc = (k, v) => setSetting("processing", { ...st.settings.processing, [k]: v });
for (const [id, k] of Object.entries(TEXTS)) {
  $("#" + id).addEventListener("input", e => { st.settings[k] = e.target.value; renderNamePreview(); });
  $("#" + id).addEventListener("change", e => { const v = e.target.value.trim() || DEFAULT_SETTINGS[k]; e.target.value = v; setSetting(k, v); renderNamePreview(); });
}
document.querySelectorAll('input[name="saveMode"]').forEach(r => r.addEventListener("change", () => { if (r.checked) S.exportLocation.setMode(r.value).catch(e => S.toast(String(e))); }));
$("#setReduceMotion").addEventListener("change", e => { M.setReduce(e.target.checked); setSetting("reduceMotion", e.target.checked); });
$("#setShowProcesses").addEventListener("change", e => setSetting("showProcesses", e.target.checked));
$("#setNotifyDone").addEventListener("change", e => setSetting("notifyDone", e.target.checked));
$("#setLanguage").addEventListener("change", async e => { if (!(await S.setLanguage(e.target.value))) e.target.value = S.I.lang(); });
$("#setProcMode").addEventListener("change", e => { setProc("mode", e.target.value); renderProcessing(); });
$("#setProcGpu").addEventListener("change", e => setProc("gpu", e.target.checked));
$("#setProcStems").addEventListener("change", e => setProc("stems", e.target.value));
$("#setProcMin").addEventListener("change", e => setProc("minimized", e.target.value));
// jobs at once by hand (Advanced): "Auto" follows the mode; any number fixes that lane
document.querySelectorAll("[data-lim]").forEach(sel => sel.addEventListener("change", () => {
  const lim = {};
  document.querySelectorAll("[data-lim]").forEach(x => { if (x.value !== "auto") lim[x.dataset.lim] = +x.value; });
  setProc("limits", Object.keys(lim).length ? lim : null); renderProcessing();
}));
$("#setBudget").addEventListener("change", e => setSetting("workspace", { ...st.settings.workspace, budgetMB: +e.target.value }));
// each section's "Advanced": closed by default, remembered open or closed
document.querySelectorAll("#v-settings details.adv").forEach(d => d.addEventListener("toggle", () => {
  if (!!st.settings.advancedOpen[d.dataset.adv] === d.open) return;
  setSetting("advancedOpen", { ...st.settings.advancedOpen, [d.dataset.adv]: d.open });
}));
function renderProcessing() {
  const p = st.settings.processing, caps = S.jobs ? S.jobs.caps() : { cpu: 2, gpu: 2, net: 3 };
  $("#setProcMode").value = p.mode; $("#setProcGpu").checked = p.gpu !== false; $("#setProcMin").value = p.minimized || "continue";
  $("#setProcStems").value = p.stems === "cpu" ? "cpu" : "auto";
  $("#setProcModeNote").textContent = t("set.proc.note." + p.mode, { cpu: caps.cpu, gpu: caps.gpu });
  document.querySelectorAll("[data-lim]").forEach(sel => {
    const k = sel.dataset.lim, v = p.limits && p.limits[k];
    sel.innerHTML = `<option value="auto">${esc(t("set.proc.auto", { n: caps[k] }))}</option>` + LIMITS[k].map(n => `<option value="${n}">${n}</option>`).join("");
    sel.value = v ? String(v) : "auto";
  });
}
const markSettings = S.pageNav($("#v-settings"), $("#setNav"));

/* ---------- find existing Settings controls, including those in Advanced ---------- */
const searchInput = $("#setSearch"), searchResults = $("#setSearchResults");
let searchMatches = [], searchHit = null;
const searchText = text => String(text || "").toLocaleLowerCase().replace(/\s+/g, " ").trim();
function clearSearchHit() { if (searchHit) searchHit.classList.remove("set-search-hit"); searchHit = null; }
function settingsSearchEntries() {
  const entries = [];
  for (const section of document.querySelectorAll("#v-settings .pbody > section")) {
    const group = section.querySelector("h2").textContent.trim();
    // Read the live UI instead of maintaining a second list of settings or keywords.
    const rows = [...section.querySelectorAll("label.f, label.tog, label.radio, .mod, .rows > .row, .exprow, .acts > button, .card-h > button, .codecs, .about, #migration")];
    for (const row of rows) {
      if (row.closest(".mod") && !row.classList.contains("mod")) continue;
      const label = row.querySelector("b, label > span, .fl label") || (row.matches("label") ? row.querySelector("span") : null);
      const name = (label || row).textContent.replace(/\s+/g, " ").trim();
      if (!name) continue;
      let text = row.textContent;
      for (let next = row.nextElementSibling; next && next.matches(".note, .hint"); next = next.nextElementSibling) text += " " + next.textContent;
      entries.push({ section, row, group, name, text: searchText(group + " " + text) });
    }
    entries.push({ section, row: section.querySelector("h2"), group, name: group, text: searchText(group) });
  }
  return entries;
}
function renderSettingsSearch() {
  const query = searchText(searchInput.value);
  clearSearchHit();
  searchMatches = query ? settingsSearchEntries().filter(entry => entry.text.includes(query)) : [];
  searchResults.hidden = !query; $("#setSearchClear").hidden = !searchInput.value;
  searchInput.setAttribute("aria-expanded", String(!!query));
  searchResults.innerHTML = searchMatches.length ? searchMatches.map((entry, i) => `<button type="button" data-result="${i}"><span>${esc(entry.name)}</span><small>${esc(entry.group)}</small></button>`).join("")
    : query ? `<p class="note" role="status">${esc(t("set.searchEmpty"))}</p>` : "";
}
function selectSettingsResult(index) {
  const entry = searchMatches[index]; if (!entry || !entry.row.isConnected) { renderSettingsSearch(); return; }
  clearSearchHit();
  // Use Settings' existing tab navigation, then reveal the matched control itself.
  for (let parent = entry.row.parentElement; parent && parent !== entry.section; parent = parent.parentElement) if (parent.matches("details")) parent.open = true;
  searchResults.hidden = true; searchInput.setAttribute("aria-expanded", "false");
  $("#setNav").querySelector(`[data-sec="${entry.section.id}"]`).click();
  searchHit = entry.row; searchHit.classList.add("set-search-hit");
  requestAnimationFrame(() => {
    const page = $("#v-settings"), top = entry.row.getBoundingClientRect().top - $("#setNav").closest(".pbar").getBoundingClientRect().bottom + page.scrollTop - 14;
    page.scrollTo({ top: Math.max(0, top), behavior: M.reduced() ? "auto" : "smooth" });
  });
}
searchInput.addEventListener("input", renderSettingsSearch);
searchInput.addEventListener("focus", () => { if (searchInput.value && searchResults.hidden) renderSettingsSearch(); });
searchInput.addEventListener("keydown", e => {
  if (e.key === "Escape") { e.preventDefault(); searchInput.value = ""; renderSettingsSearch(); }
  else if (e.key === "Enter" && searchMatches.length) { e.preventDefault(); selectSettingsResult(0); }
  else if (e.key === "ArrowDown" && !searchResults.hidden) { e.preventDefault(); searchResults.querySelector("button")?.focus(); }
});
searchResults.addEventListener("click", e => { const button = e.target.closest("[data-result]"); if (button) selectSettingsResult(+button.dataset.result); });
$("#setSearchClear").addEventListener("click", () => { searchInput.value = ""; renderSettingsSearch(); searchInput.focus(); });
// Restore defaults: Settings back to how Halation ships; who you are, the language, the tools on or off and the
// tools' own defaults stay
$("#setReset").addEventListener("click", async () => {
  const ok = await S.ask({ title: t("set.resetTitle"), text: t("set.resetText"), okLabel: t("set.resetOk") });
  if (!ok) return;
  const keep = { language: st.settings.language, modules: st.settings.modules, artistName: st.settings.artistName, links: st.settings.links };
  for (const k of Object.keys(st.settings)) delete st.settings[k];
  Object.assign(st.settings, JSON.parse(JSON.stringify(DEFAULT_SETTINGS)), keep);
  M.setReduce(false);
  save("settings", st.settings); emit("settings", S.flatSettings());
  renderSettings(); S.toast(t("set.resetDone"));
});
/* ---------- artist: name and links ---------- */
// Links for the thumbnails to fill in on their own later; stored as full URLs
const LINKS = ["youtube", "spotify", "soundcloud", "instagram", "tiktok"];
const linkUrl = v => { v = String(v || "").trim(); return !v || /^https?:\/\//i.test(v) ? v : "https://" + v; };
// (type text, not url: "youtube.com/@name" is fine here)
const linkFields = pre => LINKS.map(k => `<label class="f"><span data-i18n="set.link.${k}"></span><input type="text" inputmode="url" id="${pre}${k}" data-link="${k}" maxlength="300" spellcheck="false" autocomplete="off" data-i18n-placeholder="set.linkPh.${k}"></label>`).join("");
function saveLinks(box) {
  const links = {};
  box.querySelectorAll("[data-link]").forEach(i => { i.value = linkUrl(i.value); if (i.value) links[i.dataset.link] = i.value; });
  return links;
}
$("#setLinks").innerHTML = linkFields("setLink-");
$("#setLinks").addEventListener("change", () => setSetting("links", saveLinks($("#setLinks"))));
function renderLinks() { $("#setLinks").querySelectorAll("[data-link]").forEach(i => { i.value = st.settings.links[i.dataset.link] || ""; }); }

/* ---------- finding the artist's profiles ---------- */
// YouTube, Spotify and SoundCloud first through their own pages (profile.js via __hal.profile.search: the links
// a profile shows to the others, then each site's search); for what that does not find, and for Instagram and
// TikTok, a web search per site (Bing's RSS, then DuckDuckGo's HTML page; no account, no key), the first result
// that is a profile page of that site and matches the name. Nothing is saved without a yes.
const PROFILE = {
  youtube: { site: "youtube.com", re: /^https?:\/\/(?:www\.|m\.)?youtube\.com\/(@[\w.-]+|channel\/UC[\w-]{22}|c\/[\w.-]+|user\/[\w.-]+)\/?(?:[?#].*)?$/i, url: m => "https://www.youtube.com/" + m[1] },
  spotify: { site: "open.spotify.com/artist", re: /^https?:\/\/open\.spotify\.com\/(?:intl-[a-z-]+\/)?artist\/([A-Za-z0-9]{22})(?:[/?#].*)?$/i, url: m => "https://open.spotify.com/artist/" + m[1], byTitle: true },
  soundcloud: { site: "soundcloud.com", re: /^https?:\/\/(?:www\.|m\.)?soundcloud\.com\/(?!(?:discover|search|stream|charts|tags|pages|people)\/?)([\w-]+)\/?(?:[?#].*)?$/i, url: m => "https://soundcloud.com/" + m[1].toLowerCase() },
  instagram: { site: "instagram.com", re: /^https?:\/\/(?:www\.)?instagram\.com\/(?!(?:p|reel|reels|explore|stories|accounts|tv)\/)([A-Za-z0-9_.]{1,30})\/?(?:[?#].*)?$/i, url: m => "https://www.instagram.com/" + m[1] },
  tiktok: { site: "tiktok.com", re: /^https?:\/\/(?:www\.)?tiktok\.com\/@([\w.]{2,24})(?:[/?#].*)?$/i, url: m => "https://www.tiktok.com/@" + m[1] }
};
const squash = v => String(v || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");
const unhtml = v => String(v || "").replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
// Search results as [{ url, title }]
function bingResults(xml) {
  return [...String(xml).matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => ({ url: unhtml((m[1].match(/<link>([\s\S]*?)<\/link>/) || [])[1]), title: unhtml((m[1].match(/<title>([\s\S]*?)<\/title>/) || [])[1]) }));
}
function ddgResults(html) {
  return [...String(html).matchAll(/<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => {
    let url = m[1].replace(/&amp;/g, "&"); const u = url.match(/[?&]uddg=([^&]+)/);
    if (u) url = decodeURIComponent(u[1]); else if (url.startsWith("//")) url = "https:" + url;
    return { url, title: unhtml(m[2]) };
  });
}
async function webSearch(q) {
  const tries = [
    () => invoke("http_text", { url: "https://www.bing.com/search?format=rss&q=" + encodeURIComponent(q) }).then(bingResults),
    () => invoke("http_text", { url: "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q) }).then(ddgResults)
  ];
  let reached = false;
  for (const go of tries) {
    try { const r = await go(); reached = true; if (r.length) return r; } catch (e) { /* the next engine */ }
  }
  if (!reached) throw new Error("offline");
  return [];
}
// The best profile of one site for a name: the handle or the page title holds the name
function pickProfile(k, name, results) {
  const P = PROFILE[k], n = squash(name);
  let best = null;
  for (const r of results) {
    const m = String(r.url || "").match(P.re); if (!m) continue;
    const handle = squash(decodeURIComponent(m[1]).replace(/^(@|channel\/|c\/|user\/)/i, "")), title = squash(r.title.split(/[|•·(-]/)[0]);
    const score = handle === n || title === n ? 3 : (!P.byTitle && handle.includes(n)) || title.includes(n) ? 2 : 0;
    if (score && (!best || score > best.score)) best = { k, url: P.url(m), title: unhtml(r.title), score };
  }
  return best;
}
async function findProfiles(name) {
  let offline = 0;
  const own = await S.profile.search(name).catch(() => null);
  const found = await Promise.all(LINKS.map(async k => {
    const c = own && own.candidates[k] && own.candidates[k][0];
    if (c && c.score >= 0.6) return { k, url: c.url, title: c.name, avatar: c.avatar, followers: c.followers, score: 3 };
    try { return pickProfile(k, name, await webSearch(`${name} site:${PROFILE[k].site}`)); } catch (e) { offline++; return null; }
  }));
  if (offline === LINKS.length) throw new Error("offline");
  return found.filter(Boolean);
}

// "Are these yours?": each profile found with Yes or No; a yes saves that link at once
const fDlg = M.dialog($("#findDlg"));
let findRun = 0;
function findRow(p, onboarding = false) {
  const had = st.settings.links[p.k] === p.url;
  const who = p.avatar ? `<img class="favatar" alt="" data-src="${esc(p.avatar)}">` : "";
  const sub = p.avatar || onboarding ? [p.title, p.followers ? t("find.followers", { n: window.__ui.shortCount(p.followers) }) : ""].filter(Boolean).join(" · ") : "";
  return `<div class="frow${had ? " done" : ""}" data-k="${p.k}" data-url="${esc(p.url)}">${who}<span class="ftx"><b>${esc(t("set.link." + p.k))}${sub ? ` <em>${esc(sub)}</em>` : ""}</b><small title="${esc(p.url)}">${esc(p.url.replace(/^https:\/\/(www\.)?/, ""))}</small></span>
    <span class="facts">${had ? `<span class="fstate">${esc(t("find.already"))}</span>` : `<button type="button" class="btn sm" data-ans="no">${esc(t("find.no"))}</button><button type="button" class="btn sm primary" data-ans="yes">${esc(t("find.yes"))}</button>`}</span></div>`;
}
async function findLinks(name, from) {
  name = String(name || "").trim(); if (!name) return;
  const run = ++findRun, list = $("#findList");
  $("#findText").textContent = t("find.searching", { name });
  list.innerHTML = LINKS.map(() => '<div class="frow skel"><span class="ftx"><b>&nbsp;</b><small>&nbsp;</small></span></div>').join("");
  fDlg.returnValue = ""; fDlg.showFrom(from || null); $("#findDone").focus();
  let found = null, err = false;
  try { found = await findProfiles(name); } catch (e) { err = true; }
  if (run !== findRun || !fDlg.open) return;
  $("#findText").textContent = t(err ? "find.offline" : found.length ? "find.found" : "find.none", { name });
  list.innerHTML = (found || []).map(p => findRow(p)).join("");
  // the avatars of the profiles read from their site, through the main window (no request from the page)
  list.querySelectorAll("img[data-src]").forEach(img => invoke("http_bytes", { url: img.dataset.src, browser: true }).then(b => { img.src = URL.createObjectURL(new Blob([b])); }, () => img.remove()));
  M.fadeIn(list);
}
function answerProfile(row, yes) {
  if (yes) setSetting("links", { ...st.settings.links, [row.dataset.k]: row.dataset.url });
  row.classList.add("done");
  row.querySelector(".facts").innerHTML = `<span class="fstate${yes ? " yes" : ""}">${esc(t(yes ? "find.saved" : "find.skipped"))}</span>`;
  renderLinks();
}
$("#findList").addEventListener("click", e => {
  const b = e.target.closest("[data-ans]"); if (!b) return;
  answerProfile(b.closest(".frow"), b.dataset.ans === "yes");
  const next = $("#findList [data-ans=yes]"); (next || $("#findDone")).focus();
});
fDlg.addEventListener("close", () => { findRun++; });
$("#setFind").addEventListener("click", e => {
  const name = $("#setArtistName").value.trim();
  if (!name) { S.toast(t("set.findNeedName")); $("#setArtistName").focus(); return; }
  findLinks(name, e.currentTarget);
});

// First start keeps the same absence-of-settings condition, name and profile search.
// Only its presentation changes: the existing dialog now holds one continuous surface.
const wDlg = $("#welcome"), wMotion = M.welcomeFlow(wDlg);
let welcomeStep = "seed", welcomeClosing = false, welcomeSearching = false, welcomeRun = 0;
const welcomeAvatarUrls = new Set();
function welcomeText(id, key) { const el = $("#" + id); el.dataset.i18n = key; el.textContent = t(key); }
function paintWelcome(step) {
  welcomeStep = step; wDlg.dataset.phase = step;
  $("#wLanguage").hidden = step !== "language";
  $("#wText").hidden = step === "language";
  $("#wIntro").hidden = step !== "welcome";
  $("#wIdentity").hidden = step !== "identity";
  $("#wProfiles").hidden = step !== "profiles";
  if (step === "language") {
    paintWelcomeLanguage();
    $("#wSkip").hidden = $("#wProgress").hidden = true;
    return;
  }
  const keys = step === "welcome" ? ["introTitle", "introText", "skipSetup", "getStarted"]
    : step === "identity" ? ["identityTitle", "identityText", "skipIdentity", "ok"]
    : step === "ready" ? ["readyTitle", "readyText", "skipSetup", "enter"] : ["profilesTitle", "profilesText", "notMe", "thatsMe"];
  ["wTitle", "wText", "wSkip", "wOk"].forEach((id, i) => welcomeText(id, "welcome." + keys[i]));
  $("#wSkip").hidden = step === "ready";
  if (step === "ready") $("#wOk").disabled = false;
  const index = step === "welcome" ? 0 : step === "identity" ? 1 : 2, progress = $("#wProgress");
  progress.hidden = step === "ready";
  progress.dataset.i18nAriaLabel = step === "ready" ? "welcome.complete" : "welcome.step" + (index + 1); progress.setAttribute("aria-label", t(progress.dataset.i18nAriaLabel));
  [...progress.children].forEach((dot, i) => { if (step !== "ready" && i === index) dot.setAttribute("aria-current", "step"); else dot.removeAttribute("aria-current"); });
}
function paintWelcomeLanguage() {
  const lang = $("#wLanguage input:checked")?.value === "es" ? "es" : "en";
  welcomeText("wTitle", "welcome.languageTitle." + lang);
  welcomeText("wOk", "welcome.languageContinue." + lang);
}
$("#wLanguage").addEventListener("change", paintWelcomeLanguage);
async function finishWelcome() {
  if (welcomeClosing || !wDlg.open || welcomeStep === "language") return;
  welcomeClosing = true; welcomeRun++;
  $("#wOk").disabled = welcomeStep !== "ready";
  $("#wSkip").disabled = true;
  if (welcomeStep !== "ready") {
    await save("settings", st.settings); emit("settings", S.flatSettings()); renderSettings();
    welcomeSearching = false;
    await wMotion.change(() => paintWelcome("ready"));
    welcomeClosing = false;
    $("#wOk").disabled = false;
    if (wDlg.open) $("#wOk").focus();
    return;
  }
  await wMotion.close();
  for (const url of welcomeAvatarUrls) URL.revokeObjectURL(url);
  welcomeAvatarUrls.clear();
  document.querySelector('.rail .tab[data-tab="home"]')?.focus();
}
async function continueWelcome() {
  if (welcomeClosing || welcomeSearching || welcomeStep === "seed") return;
  if (welcomeStep === "language") {
    const lang = $("#wLanguage input:checked")?.value === "es" ? "es" : "en";
    welcomeSearching = true; $("#wOk").disabled = true;
    $("#wLanguageStatus").hidden = true;
    $("#wLanguage").querySelectorAll("input").forEach(input => input.disabled = true);
    try {
      await invoke("state_set", { key: "settings", value: { ...st.settings, language: lang } });
      st.settings.language = lang; st.needsLanguage = false;
      await S.I.load(lang); S.I.apply(document); S.buildRail();
      emit("settings", S.flatSettings()); renderSettings();
      await wMotion.change(() => paintWelcome("welcome"));
    } catch (error) {
      $("#wLanguageStatus").textContent = t("welcome.languageSaveError", { error: String(error) });
      $("#wLanguageStatus").hidden = false;
    } finally {
      welcomeSearching = false; $("#wOk").disabled = false;
      $("#wLanguage").querySelectorAll("input").forEach(input => input.disabled = false);
      if (wDlg.open && !welcomeClosing) $("#wOk").focus();
    }
    return;
  }
  if (welcomeStep === "ready") return finishWelcome();
  if (welcomeStep === "welcome") {
    await wMotion.change(() => paintWelcome("identity"));
    if (!welcomeClosing && wDlg.open) $("#wName").focus();
    return;
  }
  if (welcomeStep === "profiles") {
    $("#wProfiles").querySelectorAll(".frow:not(.done)").forEach(row => answerProfile(row, true));
    return finishWelcome();
  }
  const name = $("#wName").value.trim();
  if (!name || $("#wOk").dataset.i18n === "welcome.finish") return finishWelcome();
  // As before, a submitted name is saved before looking up profiles; only confirmed URLs are saved.
  st.settings.artistName = name;
  save("settings", st.settings); emit("settings", S.flatSettings());
  welcomeSearching = true; const run = ++welcomeRun;
  $("#wName").disabled = $("#wOk").disabled = true;
  await wMotion.change(() => { welcomeText("wStatus", "welcome.checking"); $("#wStatus").hidden = false; });
  if (welcomeClosing || run !== welcomeRun) return;
  let found = [], failed = false;
  try { found = await findProfiles(name); } catch (e) { failed = true; }
  if (welcomeClosing || !wDlg.open || run !== welcomeRun) return;
  welcomeSearching = false; $("#wOk").disabled = false;
  if (failed || !found.length) {
    // Network failure stays a secondary note in Identity, never a new dialog or a major step.
    await wMotion.change(() => {
      welcomeText("wStatus", failed ? "welcome.offline" : "welcome.noProfiles");
      welcomeText("wOk", "welcome.finish"); $("#wSkip").hidden = true;
    });
    return;
  }
  await wMotion.change(() => {
    $("#wProfiles").innerHTML = found.map(p => findRow(p, true)).join("");
    paintWelcome("profiles");
  });
  if (welcomeClosing || run !== welcomeRun) return;
  // Same native image reception as the existing Settings profile dialog.
  $("#wProfiles").querySelectorAll("img[data-src]").forEach(img => invoke("http_bytes", { url: img.dataset.src, browser: true }).then(b => {
    if (welcomeClosing || !img.isConnected) return;
    const url = URL.createObjectURL(new Blob([b])); welcomeAvatarUrls.add(url); img.src = url;
  }, () => img.remove()));
  $("#wOk").focus();
}
$("#wForm").addEventListener("submit", e => { e.preventDefault(); continueWelcome(); });
$("#wSkip").addEventListener("click", () => {
  if (welcomeStep === "profiles") $("#wProfiles").querySelectorAll(".frow:not(.done)").forEach(row => answerProfile(row, false));
  finishWelcome();
});
$("#wProfiles").addEventListener("click", e => {
  const button = e.target.closest("[data-ans]"); if (!button || welcomeClosing) return;
  answerProfile(button.closest(".frow"), button.dataset.ans === "yes");
  ($("#wProfiles [data-ans=yes]") || $("#wOk")).focus();
});
wDlg.addEventListener("cancel", e => { e.preventDefault(); if (welcomeStep === "ready" || welcomeStep === "language") $("#wOk").focus(); else finishWelcome(); });
function welcome() {
  if (wDlg.open) return;
  welcomeStep = "seed"; welcomeClosing = welcomeSearching = false; welcomeRun++;
  $("#wName").value = st.settings.artistName || ""; $("#wName").disabled = false;
  $("#wOk").disabled = $("#wSkip").disabled = false; $("#wSkip").hidden = false;
  $("#wStatus").hidden = true; $("#wProfiles").innerHTML = "";
  $("#wLanguageStatus").hidden = true;
  const locale = String(navigator.language || "").toLowerCase(), lang = locale === "es" || locale.startsWith("es-") ? "es" : "en";
  $("#wLanguage input[value=" + lang + "]").checked = true;
  wMotion.open(() => paintWelcome(st.needsLanguage ? "language" : "welcome")).then(() => { if (wDlg.open && !welcomeClosing) $("#wOk").focus(); });
}
Object.assign(S, { welcome, findLinks, findProfiles, pickProfile, bingResults, ddgResults });
// once Home is up (the end of the shell section)
S.firstStart = () => { if (st.firstRun && !window.__halSkipWelcome) welcome(); };

function renderNamePreview() {
  const title = t("vis.defaultTitle");
  $("#namePreview").textContent = t("set.namePreview", { video: fileName("video", { title, artist: st.settings.artistName }, "mp4"), image: fileName("image", { title }, "png") });
}
// What this PC can encode (the same checks the Visualizer makes before exporting)
async function detectCodecs() {
  const v = async (codec, accel) => {
    if (!("VideoEncoder" in window)) return false;
    const cfg = { codec, width: 1920, height: 1080, bitrate: 8e6, framerate: 30, hardwareAcceleration: accel };
    if (codec.startsWith("avc1")) cfg.avc = { format: "avc" };
    try { return (await VideoEncoder.isConfigSupported(cfg)).supported; } catch (e) { return false; }
  };
  const a = async codec => {
    if (!("AudioEncoder" in window)) return false;
    try { return (await AudioEncoder.isConfigSupported({ codec, sampleRate: 48000, numberOfChannels: 2, bitrate: 192000 })).supported; } catch (e) { return false; }
  };
  return {
    h264gpu: await v("avc1.640028", "prefer-hardware"), h264cpu: await v("avc1.640028", "prefer-software"),
    vp9: await v("vp09.00.41.08", "no-preference"), aac: await a("mp4a.40.2"), opus: await a("opus")
  };
}
let codecsShown = false;
async function renderCodecs() {
  if (codecsShown) return;
  codecsShown = true;
  const c = await detectCodecs();
  $("#codecs").innerHTML = ["h264gpu", "h264cpu", "vp9", "aac", "opus"].map(k =>
    `<span class="codec ${c[k] ? "yes" : "no"}">${esc(t("set.support." + k))} · ${esc(t(c[k] ? "set.available" : "set.unavailable"))}</span>`).join("");
}
$("#testNotify").addEventListener("click", async () => {
  const r = $("#notifyResult");
  try { await invoke("notify", { title: t("set.testTitle"), body: t("set.testBody") }); r.className = "note ok"; r.textContent = t("set.testSent"); }
  catch (e) { r.className = "note bad"; r.textContent = t("set.testFailed", { error: String(e) }); }
});
const FOLDERS = ["base", "presets", "exports", "downloads", "resources", "tools", "settings"];
let foldersReady = false;
async function renderSettings() {
  for (const [id, k] of Object.entries(TEXTS)) $("#" + id).value = st.settings[k];
  document.querySelectorAll('input[name="saveMode"]').forEach(r => { r.checked = r.value === st.settings.saveMode; });
  $("#setReduceMotion").checked = !!st.settings.reduceMotion;
  $("#setShowProcesses").checked = st.settings.showProcesses !== false;
  $("#setNotifyDone").checked = st.settings.notifyDone !== false;
  $("#setLanguage").value = S.I.lang();
  $("#setBudget").value = String(st.settings.workspace.budgetMB || 8192);
  document.querySelectorAll("#v-settings details.adv").forEach(d => { d.open = !!st.settings.advancedOpen[d.dataset.adv]; });
  renderProcessing();
  renderLinks(); renderNamePreview(); markSettings();
  renderCodecs();
  S.renderModules(); S.renderStorage();
  if (foldersReady) return;
  try {
    const [p, m, info] = await Promise.all([invoke("paths"), invoke("state_get", { key: "migrated" }), invoke("app_info")]);
    $("#setExportsPath").textContent = p.base; $("#setExportsPath").title = p.base;
    $("#folders").innerHTML = FOLDERS.map(k => `<div class="row"><b>${esc(t("set.folder." + k))}<small>${esc(t("set.folderSub." + k))}</small></b><code title="${esc(p[k])}">${esc(p[k])}</code><button class="btn" data-open="${k}">${esc(t("common.open"))}</button></div>`).join("");
    const el = $("#migration");
    if (m && (m.presets || m.looks || m.resources || m.exports)) {
      el.className = "note ok";
      el.textContent = t("set.imported", { presets: m.presets || 0, looks: m.looks || 0, resources: m.resources || 0, exports: m.exports || 0 });
    } else el.textContent = t("set.nothingImported");
    $("#about").textContent = t("set.version", { name: info.name, version: info.version });
    foldersReady = true;
  } catch (e) { $("#migration").textContent = t("set.foldersError"); }
}

Object.assign(S, { renderSettings, setSetting });
})();

/* ===== modules ===== */
// Settings → Modules and Storage.
// Modules: turn each tool on or off (the rail and Home change at once, nothing reloads); install or remove the
// downloadable components (FFmpeg, yt-dlp, the Upscayl engine and its models) with their size and progress; a tool
// that is on and needs a component that is missing says so and offers to install it.
// Storage: what Halation takes (the app, its own components, caches) with a total; the user's work apart.
// Part of the main window (the shell section holds the shared state; this section adds its functions to window.__shell).
(() => {
"use strict";
const S = window.__shell;
const { $, esc, t, M, invoke, st, save, emit, on, ask, toast } = S;
const REG = window.__modules;

const fmtBytes = n => {
  n = +n || 0;
  const [v, u] = n >= 1e9 ? [n / 1e9, "GB"] : n >= 1e6 ? [n / 1e6, "MB"] : n >= 1e3 ? [n / 1e3, "kB"] : [n, "B"];
  return (u === "B" ? String(v) : v.toFixed(v < 10 ? 1 : 0)) + " " + u;
};
let report = null;   // last storage_report
const comp = id => report && report.components.find(c => c.id === id) || { id, path: null, own: false, size: 0 };
const has = id => !!comp(id).path && comp(id).ready !== false && (id !== "models" || comp(id).models > 0);
const compName = id => t("set.comp." + id);
const busy = () => REG.MODULES.some(m => { const a = m.src && S.loadedApp(m.id); return a && a.busy && a.busy(); });

/* ---------- components: install and remove ---------- */
const status = (msg, kind) => { $("#toolsStatus").className = "status" + (kind ? " " + kind : ""); $("#toolsStatus").textContent = msg; };
function progress(p) {
  if (p.total) { M.reveal($("#toolsProg"), true); M.bar($("#toolsBar"), p.done / p.total); }
  status(t("dl.installingFile", { file: p.file, mb: (p.done / 1e6).toFixed(1) }), "warn");
}
let working = false;
async function install(ids) {
  if (working) return;
  working = true; renderModules();
  try {
    for (const id of ids) { await S.installTool(id, progress); status(t("set.comp.installed", { name: compName(id) }), "ok"); }
  } catch (e) { status(t("set.comp.failed", { name: compName(ids[0]), error: String(e && e.message || e) }), "bad"); }
  working = false; M.reveal($("#toolsProg"), false);
  await refresh();
}
async function remove(id) {
  const c = comp(id);
  const ok = await ask({ title: t("set.comp.removeTitle", { name: compName(id) }), text: t("set.comp.removeText", { size: fmtBytes(c.size) }), okLabel: t("common.remove"), danger: true });
  if (!ok) return;
  try { const s = await invoke("tool_uninstall", { tool: id }); emit("tools", s); status(t("set.comp.removed", { name: compName(id) }), "ok"); }
  catch (e) { status(String(e && e.message || e), "bad"); }
  await refresh();
}
$("#updateEngine").addEventListener("click", async () => {
  const b = $("#updateEngine"); b.disabled = true;
  try {
    if (!has("ytdlp")) await S.installTool("ytdlp", progress);
    if (!has("ffmpeg")) await S.installTool("ffmpeg", progress);
    status(t("set.updating"), "warn");
    const lines = [], p = await S.runTool("ytdlp", ["-U"], l => lines.push(l.trim()));
    const code = await p.done, msg = lines.filter(Boolean).pop() || "";
    if (code !== 0) throw new Error(msg);
    invoke("state_set", { key: "ytdlpChecked", value: Date.now() }).catch(() => {});
    status(t("set.updated", { msg }), "ok");
  } catch (e) { status(t("set.updateFailed", { error: String(e && e.message || e).split("\n").pop() }), "bad"); }
  M.reveal($("#toolsProg"), false); b.disabled = false; refresh();
});

/* ---------- Modules card ---------- */
// Required components a module needs that are not on this PC
const missing = m => (m.deps || []).filter(d => !d.optional && !has(d.id)).map(d => d.id);
function renderModules() {
  if (!report) return;
  $("#modules").innerHTML = REG.MODULES.map(m => {
    const on_ = REG.enabled(m, st.settings), need = on_ ? missing(m) : [];
    const deps = (m.deps || []).map(d => d.optional ? t("set.mod.optional", { name: compName(d.id) }) : compName(d.id)).join(", ");
    const sw = m.core ? `<span class="badge-info">${esc(t("set.mod.always"))}</span>`
      : `<label class="tog"><span class="sr">${esc(t("tab." + m.id))}</span><input type="checkbox" data-mod="${m.id}"${on_ ? " checked" : ""}></label>`;
    return `<div class="mod${on_ ? "" : " off"}" data-key="${m.id}">${m.icon ? `<span class="mic" data-icon="${m.icon}"></span>` : `<img class="mic" src="img/halation-mark.svg" alt="" width="573" height="282">`}`
      + `<b>${esc(t("tab." + m.id))}${m.stage === "beta" ? ` <span class="badge-fx">${esc(t("set.mod.beta"))}</span>` : ""}<small>${esc(deps ? t("set.mod.uses", { list: deps }) : t("set.mod.nothing"))}</small></b>${sw}`
      + (need.length ? `<p class="need"><span class="badge-warn">${esc(t("set.mod.missing", { list: need.map(compName).join(", ") }))}</span><button class="btn sm" data-need="${need.join(",")}"${working ? " disabled" : ""}>${esc(t("set.mod.install"))}</button></p>` : "")
      + `</div>`;
  }).join("");
  window.__icons.apply($("#modules"));
  M.list($("#tools"), () => { $("#tools").innerHTML = REG.COMPONENTS.map(({ id, mb }) => {
    const c = comp(id), here = has(id);
    const where = !here ? t("set.tool.missing") : c.own ? t("set.tool.downloaded") : t("set.tool.path");
    const size = here ? (c.own ? fmtBytes(c.size) : "") : t("set.comp.download", { mb });
    const act = !here ? `<button class="btn sm" data-inst="${id}"${working ? " disabled" : ""}>${esc(t("set.comp.install"))}</button>`
      : c.own ? `<button class="btn sm warn" data-rm="${id}"${working ? " disabled" : ""}>${esc(t("common.remove"))}</button>` : `<span class="badge-ok">${esc(t("up.ready"))}</span>`;
    return `<div class="row" data-key="${id}"><b>${esc(compName(id))}<small>${esc(where)}</small></b><code title="${esc(c.path || "")}">${esc(c.path || "")}</code><span class="size">${esc(size)}</span>${act}</div>`;
  }).join(""); }, { sel: ":scope > .row" });
}
$("#modules").addEventListener("change", e => {
  const id = e.target.dataset.mod; if (!id) return;
  const mods = { ...(st.settings.modules || {}) };
  if (e.target.checked) delete mods[id]; else mods[id] = false;
  st.settings.modules = mods; save("settings", st.settings); emit("settings", S.flatSettings());
  S.buildRail(); renderModules();
});
$("#modules").addEventListener("click", e => { const b = e.target.closest("[data-need]"); if (b) install(b.dataset.need.split(",")); });
$("#tools").addEventListener("click", e => {
  const i = e.target.closest("[data-inst]"), r = e.target.closest("[data-rm]");
  if (i) install([i.dataset.inst]); else if (r) remove(r.dataset.rm);
});

/* ---------- Storage card ---------- */
function renderStorage() {
  if (!report) return;
  const own = report.components.filter(c => c.own && c.size);
  const total = report.app.size + own.reduce((a, c) => a + c.size, 0) + report.caches.reduce((a, c) => a + c.size, 0);
  const cache = report.caches.reduce((a, c) => a + c.size, 0);
  $("#storageTotal").textContent = t("set.st.total", { size: fmtBytes(total) });
  const row = (name, sub, size, path) => `<div class="row"><b>${esc(name)}<small>${esc(sub)}</small></b><code title="${esc(path || "")}">${esc(path || "")}</code><span class="size">${esc(fmtBytes(size))}</span></div>`;
  $("#storageApp").innerHTML = row(t("set.st.app"), t("set.st.appSub"), report.app.size, report.app.path)
    + own.map(c => row(compName(c.id), t("set.tool.downloaded"), c.size, c.path)).join("")
    + report.caches.map(c => row(t("set.cache." + c.id), t("set.cacheSub." + c.id), c.size, c.path)).join("");
  $("#storageUser").innerHTML = report.user.map(u => row(t("set.user." + u.id), t("set.userSub." + u.id), u.size, u.path)).join("");
  $("#clearCache").disabled = !cache;
  // at a glance: the app with its components, the workspace (caches) against its budget, the user's work
  const user = report.user.reduce((a, u) => a + u.size, 0), budget = (st.settings.workspace.budgetMB || 8192) * 1048576;
  const bar = (name, size, of) => `<div class="sbar"><span>${esc(name)}</span><i style="--p:${Math.min(1, of ? size / of : 0)}"></i><b>${esc(fmtBytes(size))}${of ? " / " + esc(fmtBytes(of)) : ""}</b></div>`;
  $("#storageBars").innerHTML = bar(t("set.st.appAll"), report.app.size + own.reduce((a, c) => a + c.size, 0)) + bar(t("set.st.workspace"), cache, budget) + bar(t("set.st.yours"), user);
}
$("#clearCache").addEventListener("click", async () => {
  if (busy()) { toast(t("set.clearBusy")); return; }
  const size = report ? report.caches.reduce((a, c) => a + c.size, 0) : 0;
  const ok = await ask({ title: t("set.clearTitle"), text: t("set.clearText", { size: fmtBytes(size) }), okLabel: t("set.clearCache"), danger: true });
  if (!ok) return;
  try {
    const freed = await invoke("cache_clear");
    // recent files whose copy was in Settings\Recent are gone; those inside the Halation folder stay
    const dirs = await invoke("paths").catch(() => ({}));
    st.recent = st.recent.filter(r => !(dirs.settings && r.path.startsWith(dirs.settings))); save("recent", st.recent);
    toast(t("set.cleared", { size: fmtBytes(freed) }));
  } catch (e) { toast(String(e && e.message || e)); }
  refresh();
});

async function refresh() {
  try { report = await invoke("storage_report"); } catch (e) { return; }
  renderModules(); renderStorage();
  if (S.renderPacks) S.renderPacks();
}
on("tools", () => { if (S.active() === "settings" && !working) refresh(); });

Object.assign(S, { renderModules: refresh, renderStorage: () => {}, fmtBytes });
})();

/* ===== files ===== */
// Files and processes: exports written piece by piece, files between tabs, dropped or opened with Halation,
// and the external tools (status, install, processes).
// Part of the main window (the shell section holds the shared state; this section adds its functions to window.__shell).
(() => {
"use strict";
const S = window.__shell;
const { $, t, M, T, invoke, st, emit, toast, show, ensureApp, isImg, isAud, MIME } = S;

/* ---------- writing videos to disk piece by piece ---------- */
// kind: the folder of an output kind; none: the folder for the extension
async function exportOpen(name, direct, kind, retryPath) {
  const path = retryPath || await S.exportLocation.destination(name, kind, { nullable: true });
  if (!path) return null;
  const info = await invoke("export_open", { name, direct: false, kind: kind || null, path });
  if (!info) return null;
  let q = Promise.resolve(), pending = 0, failed = null, end = 0;
  const headers = pos => ({ headers: { "x-id": String(info.id), "x-pos": String(pos) } });
  return {
    path: info.path,
    reopen: () => exportOpen(name, false, kind, info.path),
    name: info.path.split(/[\\/]/).pop(),
    write(data, pos) {
      const u = new Uint8Array(data.buffer, data.byteOffset, data.byteLength), n = u.byteLength;
      pending += n; end = Math.max(end, pos + n);
      q = q.then(() => failed ? null : invoke("export_write", u, headers(pos))).catch(e => { failed = failed || e; }).then(() => { pending -= n; });
    },
    pending: () => pending,
    size: () => end,
    async drain() { await q; if (failed) throw new Error(String(failed)); },
    async close() { await this.drain(); const path = await invoke("export_close", { id: info.id }); await S.exportLocation.success(path); return path; },
    async abort() { await q.catch(() => {}); return invoke("export_abort", { id: info.id }).catch(() => {}); }
  };
}
// The taskbar's progress belongs to the jobs (jobs.js: the total of what runs); a tool's own progress shows when no job runs
function progress(p) { window.__jobs.setToolProgress(p); }
const notify = (title, body) => invoke("notify", { title, body }).catch(e => console.warn("notification", e));

/* ---------- files: between tabs, dropped or "Open with" ---------- */
async function sendToVisualizer(blob, name) {
  if (!S.usable("visualizer")) return;
  const v = await ensureApp("visualizer"); await v.setCover(blob, name); show("visualizer");
  toast(t("shell.coverToVis", { name }));
}
async function sendToGrade(blob, name) {
  if (!S.usable("grade")) return;
  const g = await ensureApp("grade"); await g.loadImage(blob, name); show("grade");
  toast(t("shell.coverToGrade", { name }));
}
// The Upscale tab takes a file already on disk ({ path, name }) or bytes from another tab ({ blob, name })
async function sendToUpscale(src) {
  if (!S.usable("upscale")) return;
  const u = await ensureApp("upscale"); await u.setInput(src); show("upscale");
}
// Writes bytes from any tab to a temporary file (Tools\temp) and returns its path
// job: the job's id, so the file goes into its work folder and is deleted with it (jobs.js)
async function tempFile(blob, name, job) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return invoke("temp_write", bytes, { headers: Object.assign({ "x-name": encodeURIComponent(name || "image.png") }, job ? { "x-job": job } : {}) });
}
// Writes bytes to a path inside the Halation folder (from reserve_stem) and returns the final path
async function writeFile(path, blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return invoke("write_path", bytes, { headers: { "x-path": encodeURIComponent(path) } });
}
// Saves an export of any tab into the folder of its kind ("cutout": Exports\Cutouts) with its name, or through
// "Save as" when Settings ask for it; returns the path, or null if the user cancelled
async function saveOutput(blob, filename, kind) {
  const path = await S.exportLocation.destination(filename, kind, { nullable: true });
  if (!path) return null;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const result = await invoke("save_file", bytes, { headers: { "x-path": encodeURIComponent(path) } });
  await S.exportLocation.success(result); return result;
}
// Loads a file of the Halation folder (a download or an upscaled image), or one the Library reads where it is (a
// linked folder, a file of the PC added by reference), as a File
async function fileFromPath(path) {
  const buf = await invoke("read_path", { path }).catch(e => invoke("library_read", { path }).catch(() => { throw e; })), name = String(path).split(/[\\/]/).pop();
  const ext = (name.split(".").pop() || "").toLowerCase();
  const f = new File([buf], name, { type: MIME[ext] || "" });
  f.__halPath = path;
  return f;
}

/* ---------- external tools: status, install, processes ---------- */
let toolsCache = null;
async function tools(refresh) {
  if (!toolsCache || refresh) toolsCache = await invoke("tools_status");
  return toolsCache;
}
const installing = {};
// Installs a tool once even if several tabs ask; onProgress gets { file, done, total }
function installTool(tool, onProgress) {
  if (!installing[tool]) {
    installing[tool] = { listeners: new Set(), promise: null };
    // a job of the jobs system (net lane, docs/JOBS_SPEC.md §8): the processes island shows the download
    const run = ctx => {
      if (ctx) installing[tool].listeners.add(p => { if (p.total) ctx.progress(p.done / p.total, p.file || ""); });
      return invoke("tool_install", { tool });
    };
    const name = t("set.comp." + ({ upscaler: "upscayl" }[tool] || tool));
    installing[tool].promise = (S.jobs ? S.jobs.submit({ tool: "settings", kind: "install", title: name, lane: "net", cancellable: false, run }).done : run(null))
      .then(st => { toolsCache = st; emit("tools", st); return st; })
      // a download that stopped receiving (download.rs, STALL) gets a clear message instead of the raw error
      .catch(e => { throw /^stalled\b/.test(String(e && e.message || e)) ? new Error(t("tools.stalled")) : e; })
      .finally(() => { delete installing[tool]; });
  }
  if (onProgress) installing[tool].listeners.add(onProgress);
  return installing[tool].promise;
}
const procs = new Map(), orphans = new Map();
// Runs a tool; onLine(line, stream) gets every output line; o.low: below normal priority (background work); o.job: the
// job it belongs to (jobs.js ctx.proc: cancelling the job kills it with its children).
// Returns { id, done: Promise<exit code>, kill(), peak } (peak: its highest memory, once done).
async function runTool(tool, args, onLine, o = {}) {
  let finish; const done = new Promise(r => { finish = r; });
  const id = await invoke("proc_start", { tool, args, low: !!o.low, job: o.job || null });
  const handle = { id, done, peak: null, kill: () => invoke("proc_kill", { id }).catch(() => {}) };
  procs.set(id, { onLine, finish, handle });
  // lines that arrived before proc_start answered
  (orphans.get(id) || []).forEach(onProc); orphans.delete(id);
  return handle;
}
function onProc(p) {
  const e = procs.get(p.id);
  if (!e) { if (!orphans.has(p.id)) orphans.set(p.id, []); orphans.get(p.id).push(p); return; }
  if (p.done) { procs.delete(p.id); if (p.peakMB) e.handle.peak = { ramMB: p.peakMB }; e.finish(p.code == null ? -1 : p.code); }
  else if (e.onLine) { try { e.onLine(p.line, p.stream); } catch (err) { console.warn(err); } }
}
if (T && T.event && T.event.listen) {
  T.event.listen("proc", e => onProc(e.payload)).catch(() => {});
  // Vocal Remover's waveform and progress, chunk by chunk (stems.rs), to its page
  T.event.listen("stems-progress", e => emit("stems", e.payload)).catch(() => {});
  T.event.listen("tool-progress", e => { const k = e.payload.tool, x = installing[k] || (k === "upscaler" && (installing.upscayl || installing.models)); if (x) x.listeners.forEach(fn => { try { fn(e.payload); } catch (err) {} }); }).catch(() => {});
}

async function routeFiles(list) {
  const files = Array.from(list), imgs = files.filter(isImg), auds = files.filter(f => !isImg(f) && isAud(f));
  if (!imgs.length && !auds.length) { toast(t("shell.onlyMedia")); return false; }
  // audio goes to the Visualizer (with one image as its cover); other images to Grade
  if ((auds.length && !S.usable("visualizer")) || (imgs.length && !(auds.length && imgs.length === 1) && !S.usable("grade"))) return false;
  if (auds.length === 1 && imgs.length <= 1) {
    const v = await ensureApp("visualizer"); show("visualizer");
    await v.loadAudio(auds[0]);
    if (imgs[0]) await v.setCover(imgs[0], imgs[0].name);
    return true;
  }
  const msg = [];
  if (auds.length) {
    const cover = imgs.length === 1 ? imgs.shift() : null;
    const v = await ensureApp("visualizer"); await v.queueAudios(auds, cover);
    msg.push(t(cover ? "shell.queuedWithCover" : "shell.queued", { n: auds.length }));
  }
  if (imgs.length) {
    const g = await ensureApp("grade");
    if (imgs.length === 1) await g.loadImage(imgs[0], imgs[0].name); else await g.batchFiles(imgs);
    msg.push(imgs.length === 1 ? t("shell.imageOpened") : t("shell.batchReady", { n: imgs.length }));
  }
  show(auds.length ? "visualizer" : "grade");
  toast(msg.join(" · "));
  return true;
}
async function openPending() {
  const paths = await invoke("take_open_files").catch(() => []);
  const files = [];
  for (const p of paths) {
    try {
      const name = p.split(/[\\/]/).pop(), ext = (name.split(".").pop() || "").toLowerCase();
      files.push(new File([await invoke("read_opened", { path: p })], name, { type: MIME[ext] || "" }));
    } catch (e) { console.warn(e); }
  }
  if (files.length) await routeFiles(files);
}
if (T && T.event && T.event.listen) T.event.listen("open-files", () => openPending()).catch(() => {});

/* ---------- closing ---------- */
// The window's close (window.rs close_requested) asks here first: with a tool still working (an export, a download,
// a job, a component downloading) the user confirms, and what runs stops with the app; otherwise it closes at once.
// A clean close means the next start opens every tool empty; a crash keeps the work (state.rs sessions).
function working() {
  // the jobs running and queued, by tool; then the tools still busy with work outside a job
  const live = S.jobs ? S.jobs.list().filter(j => ["queued", "held", "running"].includes(j.state)) : [];
  const byTool = {};
  for (const j of live) byTool[j.tool] = (byTool[j.tool] || 0) + 1;
  const names = Object.keys(byTool).map(id => t("shell.closeJobs", { tool: t("tab." + id), n: byTool[id] }));
  names.push(...S.tabs().filter(id => { if (byTool[id]) return false; const a = S.loadedApp(id); try { return !!(a && a.busy && a.busy()); } catch (e) { return false; } }).map(id => t("tab." + id)));
  if (Object.keys(installing).length) names.push(t("shell.closeInstall"));
  return names;
}
let closing = false;
async function closeRequested() {
  invoke("close_ack").catch(() => {});
  if (closing) return;
  closing = true;
  try {
    if (S.session && !await S.session.close()) return;
    const busy = working();
    if (busy.length) {
    // "Quit anyway": every job stops cleanly (processes killed, work folders removed) before the app goes
    if (S.jobs) { S.jobs.cancelAll(); await new Promise(r => { const w = () => S.jobs.busy() ? setTimeout(w, 50) : r(); w(); }); }
    }
  await Promise.all(S.tabs().map(id => { const a = S.loadedApp(id); return a && a.flush ? Promise.race([Promise.resolve().then(() => a.flush()).catch(() => {}), new Promise(r => setTimeout(r, 800))]) : null; }));
  invoke("app_quit").catch(() => {});
  } finally { closing = false; }
}
S.sessionWorking = working;
if (T && T.event && T.event.listen) T.event.listen("close-requested", () => closeRequested()).catch(() => {});
// Minimized with nothing working: WebView2 gives back what memory it can (window.rs memory_low)
let memLow = false;
let hiddenTimer = 0;
document.addEventListener("visibilitychange", () => {
  // still minimized a moment later (not a quick switch away): the tools with nothing open are unloaded first
  clearTimeout(hiddenTimer);
  if (document.hidden) hiddenTimer = setTimeout(async () => { if (document.hidden) { await S.unloadIdle(true); lower(); } }, 2000);
  lower();
});
function lower() {
  const low = document.hidden && !working().length && (!S.jobs || S.jobs.idle());
  if (low !== memLow) { memLow = low; invoke("memory_low", { low }).catch(() => {}); }
}

let dragDepth = 0;
const hasFiles = e => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
// The same receiving surface yields beneath the file, without changing the layout of its contents.
const onHome = () => S.active() === "home";
// The content's persistent parent composes with page navigation transforms on the individual views.
const dropView = () => onHome() ? $("#homeDrop") : $("#views");
// Picker selections land on exactly the same surface and motion channel as a drop.
S.filePicked = () => M.dropSurface(dropView(), "drop");
let dragView = null;
function dragFeedback(on, x, y) {
  const view = on ? dropView() : null;
  if (dragView && dragView !== view) { M.dropSurface(dragView, "rest"); S.homeDragOver(false); }
  dragView = view;
  $("#dropzone").hidden = !on || onHome();
  if (onHome()) S.homeDragOver(on, x, y);
  else if (view) M.dropSurface(view, "over", x, y);
}
window.addEventListener("dragenter", e => { if (hasFiles(e)) { dragDepth++; dragFeedback(true, e.clientX, e.clientY); } });
window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) dragFeedback(false); });
window.addEventListener("dragover", e => { e.preventDefault(); if (hasFiles(e)) { dragDepth = Math.max(1, dragDepth); dragFeedback(true, e.clientX, e.clientY); } });
window.addEventListener("drop", e => {
  e.preventDefault(); dragDepth = 0; const surface = onHome() ? $("#homeDrop") : dragView || dropView(); dragFeedback(false);
  if (e.dataTransfer && e.dataTransfer.files.length) M.dropSurface(surface, "drop");
  if (e.dataTransfer && e.dataTransfer.files.length) dropped(e.dataTransfer.files, e.clientX, e.clientY);
});
window.addEventListener("blur", () => { dragDepth = 0; dragFeedback(false); });
document.addEventListener("visibilitychange", () => { if (document.hidden) { dragDepth = 0; dragFeedback(false); } });
// One image: a small menu asks where it goes. Anything else follows routeFiles.
function dropped(list, x, y) {
  const files = Array.from(list);
  if (files.length === 1 && isImg(files[0])) chooseImage(files[0], x, y);
  else routeFiles(files);
}
let chosen = null;
const TOOL_OF = { grade: "grade", upscale: "upscale", cover: "visualizer" };   // "cutout" needs no tab
function chooseImage(file, x, y) {
  const m = $("#imgChoice"), on = [...m.querySelectorAll("[data-to]")].filter(b => !(b.hidden = !!TOOL_OF[b.dataset.to] && !S.tabs().includes(TOOL_OF[b.dataset.to])));
  if (!on.length) { S.usable("grade"); return; }
  chosen = file;
  // on Home the question is asked inside the drop target, not at the pointer
  if (onHome()) { S.homeChoice(file, on.map(b => b.dataset.to)); return; }
  $("#imgChoiceName").textContent = file.name;
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + "px";
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + "px";
  M.openPopover(m, { x, y });
  on[0].focus();
}
function closeChoice() { if (!$("#imgChoice").hidden) M.closePopover($("#imgChoice")); if ($("#homeDrop").classList.contains("choosing")) S.homeChoice(null); chosen = null; }
const choicePicked = async e => {
  const b = e.target.closest("[data-to]"); if (!b || !chosen) return;
  const f = chosen; closeChoice();
  if (b.dataset.to === "cancel") return;
  try {
    if (b.dataset.to === "grade") await sendToGrade(f, f.name);
    else if (b.dataset.to === "upscale") await sendToUpscale(f.__halPath ? { path: f.__halPath, name: f.name } : { blob: f, name: f.name });
    else if (b.dataset.to === "cutout") {
      // the Cutout dialog on the picture; applied, the cut-out goes to Exports\Cutouts
      const r = await S.cutoutDialog({ image: f, name: f.name });
      if (r) toast(t("home.cutSaved", { name: String(await S.saveCutout(r.rgba, { name: f.name })).split(/[\\/]/).pop() }));
    }
    else await sendToVisualizer(f, f.name);
  } catch (err) { toast(String(err && err.message || err)); }
};
$("#imgChoice").addEventListener("click", choicePicked);
$("#homeChoiceActs").addEventListener("click", choicePicked);
document.addEventListener("mousedown", e => { if (!e.target.closest("#imgChoice, #homeChoice")) closeChoice(); });
document.addEventListener("keydown", e => { if (e.key === "Escape") closeChoice(); });


Object.assign(S, { exportOpen, progress, notify, sendToVisualizer, sendToGrade, sendToUpscale, tempFile, writeFile, saveOutput, fileFromPath,
  tools, installTool, runTool, routeFiles, openPending, dropped });
})();

/* ===== sendto ===== */
// "Send to…": the tools that take a kind of content (modules.js: accepts, gives), the send itself and "and come
// back", whose "Back to <origin>" button in the header brings the destination's result (its API's result()) to the
// tool the content came from. common.js draws the menu in every page. Part of the main window (see the shell section).
(() => {
"use strict";
const S = window.__shell;
const { $, t, M, invoke, st, save, toast, show, ensureApp, loadedApp, MIME } = S;
const REG = window.__modules;

// A component a module cannot work without, from tools_status: a module that lacks one is not a destination
const HAS = { ffmpeg: s => !!s.ffmpeg, ytdlp: s => !!s.ytdlp, upscayl: s => !!(s.upscaler && s.upscaler.bin),
  models: s => !!(s.upscaler && s.upscaler.available && s.upscaler.available.length), cutout: s => !!s.cutout, rife: s => !!s.rife,
  span: s => !!s.span && ["spanx2_ch52", "spanx4_ch52"].every(m => s.span.available.includes(m)),
  pandoc: s => !!s.pandoc, libreoffice: s => !!s.libreoffice, pdfium: s => !!s.pdfium };
let last;   // the tool sent to last (state "sendLast"), first in the menu
// The destinations for a kind, seen from the tool `from`: on the rail, with their components, not `from` itself.
// back: whether the destination's result can come back (o.back false: never; o.backKinds, or what `from` accepts).
async function sendTargets(kind, o = {}) {
  if (last === undefined) last = await invoke("state_get", { key: "sendLast" }).catch(() => null);
  let s = null;
  try { s = await S.tools(); } catch (e) {}
  const ready = m => !s || (m.deps || []).filter(d => !d.kind || d.kind === kind).every(d => d.optional || !HAS[d.id] || HAS[d.id](s));
  const origin = REG.byId(o.from), kinds = o.back === false ? [] : o.backKinds || Object.keys(origin && origin.accepts || {});
  return REG.accepting(kind, st.settings).filter(m => m.id !== o.from && S.tabs().includes(m.id) && ready(m))
    .map(m => ({ id: m.id, icon: m.icon, name: t("tab." + m.id), last: m.id === last, back: !!o.from && (m.gives || []).some(k => kinds.includes(k)) }))
    .sort((a, b) => (b.last - a.last) || a.name.localeCompare(b.name, st.settings.language));
}
// The item as a File: its bytes, or the file at its path (which the File keeps as __halPath)
async function itemFile(it) {
  // an item of the Library is read where it is (a folder of the PC included)
  if (it.libraryId && S.library && !it.blob) { const x = S.library.get(it.libraryId); if (x) return S.library.file(x); }
  if (it.blob) {
    const b = it.blob;
    if (typeof b.name === "string" && typeof b.lastModified === "number" && (!it.path || b.__halPath)) return b;
    const ext = String(it.name || "").split(".").pop().toLowerCase(), f = new File([b], it.name || "file", { type: b.type || MIME[ext] || "" });
    if (it.path) f.__halPath = it.path;
    return f;
  }
  return S.fileFromPath(it.path);
}

let trip = null;   // { from, to, back } while the destination offers "Back to <origin>"
function paintTrip() {
  const on = !!trip && S.active() === trip.to;
  if (on) $("#backToText").textContent = t("send.backTo", { name: t("tab." + trip.from) });
  M.reveal($("#backTo"), on);
}
function setTrip(x) { trip = x; paintTrip(); }
// The result into the origin: its own function (a layer's picture…) or its input handler for that kind
async function deliver(x, r) {
  if (typeof x.back === "function") await x.back(r);
  else {
    const m = REG.byId(x.from), h = m && m.accepts && m.accepts[r.kind];
    if (!h) { toast(t("send.backKind", { name: t("tab." + x.from) })); return; }
    await (await ensureApp(x.from))[h](r, {});
  }
  show(x.from);
  toast(t("send.backDone", { name: t("tab." + x.from) }));
}
// Sends the item to the tool `to` (a menu entry of common.js). o.from: the tool it comes from; o.back: "and come back"
// (a function that takes the result, or true for the origin's input handler)
async function sendTo(to, item, o = {}) {
  const m = REG.byId(to), h = m && m.accepts && m.accepts[item.kind];
  if (!h || !S.usable(to)) return false;
  last = to; save("sendLast", to);
  const back = o.back && o.from ? o.back : null, a = await ensureApp(to);
  setTrip(null);
  if (back && m.roundTrip) {
    // the tool brings the result back itself (Frame Grab's "Back to"): its handler resolves with it
    show(to);
    const r = await a[h](item, { from: o.from });
    if (r) await deliver({ from: o.from, back }, r); else if (S.active() === to) show(o.from);
    return true;
  }
  await a[h](item, {});
  show(to);
  if (back) setTrip({ from: o.from, to, back });
  return true;
}
$("#backToBtn").addEventListener("click", async () => {
  const x = trip; if (!x) return;
  const a = loadedApp(x.to), r = a && a.result ? await a.result() : null;
  if (!r) { toast(t("send.backNothing", { name: t("tab." + x.to) })); return; }
  setTrip(null);
  try { await deliver(x, r); } catch (e) { toast(t("send.failed", { error: e && e.message || e })); }
});
$("#backToX").addEventListener("click", () => setTrip(null));

Object.assign(S, { sendTargets, sendTo, itemFile, paintTrip });
})();
