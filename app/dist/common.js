// Helpers shared by every page (main window, Visualizer, Grade, Downloader, Upscale): window.__ui.
// A classic script so the inline pages and the ES modules use the same copy.
(() => {
"use strict";
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const mk = (w, h) => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const clone = o => JSON.parse(JSON.stringify(o));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const cap = name => (window.__caps && typeof window.__caps.use === "function") ? window.__caps.use(name).catch(() => null) : Promise.resolve(null);
// Keep input modality consistent across shell/tool frames, including text fields
// for which Chromium considers pointer focus :focus-visible by default.
function focusInput(mode) {
  const set = doc => { if (doc.documentElement.dataset.focusInput !== mode) doc.documentElement.dataset.focusInput = mode; };
  set(document);
  try { set(top.document); top.document.querySelectorAll("iframe").forEach(f => { if (f.contentDocument) set(f.contentDocument); }); } catch (_) {}
}
document.addEventListener("pointerdown", () => focusInput("pointer"), true);
document.addEventListener("keydown", e => { if (!e.metaKey && !e.ctrlKey && !e.altKey) focusInput("keyboard"); }, true);
function setStatus(msg, kind) { const s = $("#status"); s.textContent = msg; s.className = "status" + (kind ? " " + kind : ""); }

// Saves through the "downloads" capability (shim.js). quiet: no status line, errors are thrown to the caller.
// onSaved(result) runs after a save that is not quiet.
let downloadsNs;
async function saveFile(filename, data, opts = {}) {
  const t = window.t;
  if (downloadsNs === undefined) downloadsNs = await cap("downloads");
  if (!downloadsNs) { if (opts.quiet) throw new Error(t("common.saveUnavailable")); setStatus(t("common.saveUnavailable"), "bad"); return null; }
  try {
    const r = await downloadsNs.save({ filename, data, direct: !!opts.direct });
    if (!opts.quiet) { setStatus(t("common.savedAs", { name: r.name || filename }), "ok"); if (opts.onSaved) opts.onSaved(r); }
    return r;
  } catch (e) {
    if (opts.quiet) throw e;
    const c = e && e.code;
    setStatus(c === "declined" ? t("common.saveCancelled") : t("common.saveFailed", { error: e && e.message ? e.message : e }), c === "declined" ? "warn" : "bad");
    return null;
  }
}

// An install button whose download failed reads "Retry" until it succeeds (label: its normal data-i18n key)
function retryLabel(btn, label, failed) {
  const s = btn.querySelector("span[data-i18n]"); if (!s) return;
  s.dataset.i18n = failed ? "tools.retry" : label; s.textContent = window.t(s.dataset.i18n);
}

/* ---------- typed slider values ----------
   The number beside every slider (the <output> in its .f row, or the one its for= names) opens a text field on
   click, or with Enter while the slider has the focus. Enter or leaving the field applies, Escape restores;
   ↑/↓ move one step, Shift ten (Shift+arrows on the slider itself too). The value is clamped to the slider's
   min and max, snapped to its step and handed to the slider with input + change events, so every page's own
   listeners write it as if the slider had been dragged. The output shows value × data-scale (default 1) and a
   unit; a typed "s" or "ms" converts between the two. */
const decimals = s => (String(s).split(".")[1] || "").length;
function rangeOf(out) {
  if (!out || out.tagName !== "OUTPUT") return null;
  const f = out.htmlFor && out.htmlFor.value ? document.getElementById(out.htmlFor.value) : null;
  const box = out.closest(".f, .lamt, .lane-v"), r = f && f.type === "range" ? f : box && box.querySelector('input[type="range"]');
  return r && !r.disabled ? r : null;
}
function snap(r, v) {
  const min = r.min === "" ? 0 : +r.min, max = r.max === "" ? 100 : +r.max, st = r.step === "any" ? 0 : +r.step || 1;
  v = clamp(v, min, max);
  if (st) v = clamp(min + Math.round((v - min) / st) * st, min, max);
  return +v.toFixed(Math.min(12, Math.max(decimals(r.step), decimals(r.min))));
}
const unitOf = (r, out) => r.dataset.unit != null ? r.dataset.unit : out.textContent.replace(/[-+\d.,\s]/g, "");
// Typed text → the slider's value, or null. "12", "12 %", "12,5", "×1.5", "500 ms" in a field shown in seconds
function parseTyped(text, unit, scale) {
  const m = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*([^\d\s]*)$/.exec(String(text).trim().replace(",", ".").replace(/^×\s*/, ""));
  if (!m) return null;
  let n = +m[1];
  const u = m[2].toLowerCase();
  if (u === "ms" && unit === "s") n /= 1000; else if (u === "s" && unit === "ms") n *= 1000;
  return n / scale;
}
function send(r, v, commit) {
  r.value = String(v);
  r.dispatchEvent(new Event("input", { bubbles: true }));
  if (commit) r.dispatchEvent(new Event("change", { bubbles: true }));
}
/* ---------- slider reset ----------
   data-def is immutable product metadata, independent of the saved/current value.
   Native dragging and keyboard input are untouched; reset sends normal events. */
function rangeDefault(r) {
  if (!r || r.type !== "range" || r.dataset.def == null || r.dataset.def.trim() === "") return null;
  const v = Number(r.dataset.def);
  return Number.isFinite(v) ? snap(r, v) : null;
}
function resetRange(r) {
  const v = rangeDefault(r);
  if (v == null || r.disabled || r.matches(":disabled")) return false;
  send(r, v, true); return true;
}
document.addEventListener("dblclick", e => {
  if (e.target.type === "range" && resetRange(e.target)) e.preventDefault();
});
function editValue(out) {
  const r = rangeOf(out); if (!r || out.__edit) return null;
  const scale = +r.dataset.scale || 1, unit = unitOf(r, out), v0 = r.value, shown = () => (out.textContent.match(/[-+]?\d*\.?\d+/) || [""])[0];
  const inp = document.createElement("input");
  Object.assign(inp, { type: "text", className: "numedit", inputMode: "decimal", spellcheck: false, value: shown() });
  inp.setAttribute("aria-label", (r.labels && r.labels[0] ? r.labels[0].textContent : r.getAttribute("aria-label") || "") + (unit ? " (" + unit + ")" : ""));
  out.hidden = true; out.after(inp); out.__edit = inp;
  if (window.__motion) window.__motion.fadeIn(inp, { dur: "fade" });
  inp.focus(); inp.select();
  let done = false;
  const close = (apply, refocus) => {
    if (done) return; done = true;
    const v = apply ? parseTyped(inp.value, unit, scale) : null;
    inp.remove(); out.hidden = false; out.__edit = null;
    if (refocus && r.isConnected) r.focus();
    const to = v != null && isFinite(v) ? String(snap(r, v)) : v0;
    if (to !== r.value || to !== v0) send(r, to, true);
  };
  inp.addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); if (parseTyped(inp.value, unit, scale) == null) { inp.classList.add("bad"); return; } close(true, true); }
    else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(false, true); }
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const cur = parseTyped(inp.value, unit, scale), st = r.step === "any" ? 0.01 : +r.step || 1;
      send(r, snap(r, (cur != null ? cur : +r.value) + (e.key === "ArrowUp" ? 1 : -1) * st * (e.shiftKey ? 10 : 1)), false);
      inp.value = shown(); inp.classList.remove("bad"); inp.select();
    }
  });
  inp.addEventListener("input", () => inp.classList.remove("bad"));
  inp.addEventListener("blur", () => close(true, false));
  return inp;
}
// A click is not a drag (Grade's layer amount is dragged sideways on its number)
let downAt = null;
document.addEventListener("pointerdown", e => { downAt = [e.clientX, e.clientY]; }, true);
document.addEventListener("click", e => {
  const out = e.target.closest && e.target.closest("output");
  if (!out || !rangeOf(out) || (downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 3)) return;
  editValue(out);
});
document.addEventListener("pointerover", e => {
  const out = e.target.closest && e.target.closest("output");
  if (out && !out.dataset.editable && rangeOf(out)) { out.dataset.editable = "1"; if (!out.title && window.t) out.title = window.t("common.typeValue"); }
});
// A primary button lights up under the pointer (ui.css: --mx, --my)
document.addEventListener("pointermove", e => {
  const b = e.target.closest && e.target.closest(".btn.primary");
  if (!b) return;
  const r = b.getBoundingClientRect();
  b.style.setProperty("--mx", e.clientX - r.left + "px"); b.style.setProperty("--my", e.clientY - r.top + "px");
}, { passive: true });
document.addEventListener("pointerout", e => {
  const b = e.target.closest && e.target.closest(".btn.primary");
  if (b && !b.contains(e.relatedTarget)) { b.style.removeProperty("--mx"); b.style.removeProperty("--my"); }
});
document.addEventListener("keydown", e => {
  const r = e.target;
  if (!r || r.type !== "range" || r.matches(":disabled") || e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Enter") {
    const out = [...document.querySelectorAll("output")].find(o => rangeOf(o) === r);
    if (out) { e.preventDefault(); editValue(out); }
  } else if (e.shiftKey && /^Arrow(Up|Down|Left|Right)$/.test(e.key)) {
    e.preventDefault();
    const st = r.step === "any" ? 0.01 : +r.step || 1, dir = e.key === "ArrowUp" || e.key === "ArrowRight" ? 1 : -1;
    send(r, snap(r, +r.value + dir * st * 10), true);
  }
});

// Scrubbers: a label with data-scrub drags its field's number sideways (the field: its for, or the id in
// data-scrub; a number or range input). One step per 2 px (a range: its whole span over 300 px), Shift ×10,
// Alt ÷10; the field gets input events while dragging and one change at the end. Double-click: data-def.
document.addEventListener("pointerdown", e => {
  const lab = e.button === 0 && e.target.closest && e.target.closest("[data-scrub]");
  const f = lab && document.getElementById(lab.htmlFor || lab.dataset.scrub);
  if (!f || f.disabled || !/^(number|range)$/.test(f.type)) return;
  e.preventDefault();
  const x0 = e.clientX, v0 = +f.value || 0, st = f.step === "any" || !+f.step ? 0.01 : +f.step;
  const lo = f.min === "" ? -Infinity : +f.min, hi = f.max === "" ? Infinity : +f.max;
  const per = f.type === "range" && isFinite(hi - lo) ? (hi - lo) / 300 : st / 2;
  let moved = false;
  lab.setPointerCapture(e.pointerId);
  const move = ev => {
    const dx = ev.clientX - x0; if (!moved && Math.abs(dx) < 3) return;
    moved = true; document.documentElement.classList.add("scrubbing");
    const k = ev.shiftKey ? 10 : ev.altKey ? 0.1 : 1, v = clamp(Math.round((v0 + dx * per * k) / (st * (ev.altKey ? 0.1 : 1))) * st * (ev.altKey ? 0.1 : 1), lo, hi);
    const s = String(+v.toFixed(6));
    if (f.value !== s) { f.value = s; f.dispatchEvent(new Event("input", { bubbles: true })); }
  };
  const stop = () => {
    lab.removeEventListener("pointermove", move); lab.removeEventListener("pointerup", stop); lab.removeEventListener("pointercancel", stop);
    document.documentElement.classList.remove("scrubbing");
    if (moved) f.dispatchEvent(new Event("change", { bubbles: true })); else if (f.type === "number") f.focus();
  };
  lab.addEventListener("pointermove", move); lab.addEventListener("pointerup", stop); lab.addEventListener("pointercancel", stop);
});
document.addEventListener("dblclick", e => {
  const lab = e.target.closest && e.target.closest("[data-scrub]"), f = lab && document.getElementById(lab.htmlFor || lab.dataset.scrub);
  if (!f || f.dataset.def == null || f.disabled) return;
  if (f.type === "range") { resetRange(f); return; }
  f.value = f.dataset.def; f.dispatchEvent(new Event("input", { bubbles: true })); f.dispatchEvent(new Event("change", { bubbles: true }));
});

/* ---------- "Send to…" ----------
   One menu for every output or resource (an image, a video, a song, a frame, a layer): the tools that take its
   kind, from the module registry (shell.js → sendto: turned off or without a component they need, a tool is not
   listed), the last one used first and the rest in alphabetical order. "And come back" keeps only the tools whose
   result can come back; the destination then shows "Back to <origin>" in the header.
     sendMenu(btn, o)       the button opens the menu (o, or a function returning it, read at each click)
     openSend(anchor, o)    the same menu from code (a context menu's entry); anchor: an element or { x, y }
   o: { kind, from (this tool's id), item(to) → { kind, name, path | blob, meta } (the path or the bytes as they
   are, nothing re-encoded), back: a function that takes the result, true (this tool's own input handler) or false } */
const hal = () => window.__hal || (window.parent !== window && window.parent.__hal) || null;
// Capture before the tool's handler clears the input; cancelled pickers receive nothing.
document.addEventListener("change", e => {
  if (e.target.type === "file" && e.target.files?.length) hal()?.filePicked?.();
}, true);
let sendEl = null, sendNow = null;
function closeSend() {
  const el = sendEl, x = sendNow; if (!el || !x) return;
  sendNow = null;
  if (window.__motion) window.__motion.closePopover(el); else el.hidden = true;
  if (x.anchor && x.anchor.setAttribute) x.anchor.setAttribute("aria-expanded", "false");
}
function placeSend(el, a) {
  const r = a.getBoundingClientRect ? a.getBoundingClientRect() : { left: a.x, right: a.x, top: a.y, bottom: a.y }, m = el.getBoundingClientRect();
  const below = r.bottom + 6 + m.height <= innerHeight - 8;
  el.style.left = clamp(r.left, 8, Math.max(8, innerWidth - m.width - 8)) + "px";
  el.style.top = (below ? r.bottom + 6 : Math.max(8, r.top - 6 - m.height)) + "px";
}
function paintSend() {
  const x = sendNow, t = window.t, icon = n => window.__icons ? window.__icons.icon(n) : "";
  const list = x.back ? x.list.filter(d => d.back) : x.list;
  sendEl.innerHTML = `<p class="send-h">${esc(t("send.title"))}</p>`
    + (list.length ? list.map(d => `<button role="menuitem" data-to="${esc(d.id)}">${icon(d.icon)}<span>${esc(d.name)}</span>${d.last ? `<small>${esc(t("send.last"))}</small>` : ""}</button>`).join("")
      : `<p class="send-none">${esc(t("send.none"))}</p>`)
    + (x.canBack ? `<label class="tog send-back" title="${esc(t("send.comeBackTip", { name: t("tab." + x.o.from) }))}"><span>${esc(t("send.comeBack"))}</span><input type="checkbox"${x.back ? " checked" : ""}></label>` : "");
}
async function openSend(anchor, o) {
  const H = hal(); if (!H || !H.sendTargets) return;
  const again = sendNow && sendNow.anchor === anchor;
  closeSend(); if (again) return;
  const kind = typeof o.kind === "function" ? o.kind() : o.kind;
  const list = await H.sendTargets(kind, { from: o.from, back: o.back, backKinds: o.backKinds });
  if (!sendEl) {
    sendEl = document.createElement("div");
    Object.assign(sendEl, { className: "sendmenu", hidden: true }); sendEl.setAttribute("role", "menu");
    document.body.appendChild(sendEl);
    sendEl.addEventListener("click", sendClick);
    sendEl.addEventListener("keydown", sendKeys);
  }
  sendNow = { anchor, o, kind, list, canBack: list.some(d => d.back), back: false };
  sendEl.setAttribute("aria-label", window.t("send.title"));
  paintSend();
  sendEl.hidden = false; placeSend(sendEl, anchor);
  if (anchor.setAttribute) anchor.setAttribute("aria-expanded", "true");
  if (window.__motion) window.__motion.openPopover(sendEl, anchor);
  const first = sendEl.querySelector("button, input"); if (first) first.focus();
}
async function sendClick(e) {
  const x = sendNow; if (!x) return;
  const c = e.target.closest(".send-back input");
  if (c) { x.back = c.checked; paintSend(); placeSend(sendEl, x.anchor); const b = sendEl.querySelector(".send-back input"); if (b) b.focus(); return; }
  const b = e.target.closest("[data-to]"); if (!b) return;
  const H = hal(), to = b.dataset.to, back = x.back ? (x.o.back || true) : null;
  closeSend();
  try {
    const item = await x.o.item(to);
    if (item) await H.sendTo(to, { kind: x.kind, ...item }, { from: x.o.from, back });
  } catch (err) { console.error(err); if (H && H.toast) H.toast(window.t("send.failed", { error: err && err.message || err })); }
}
function sendKeys(e) {
  const all = [...sendEl.querySelectorAll("button, input")], i = all.indexOf(document.activeElement);
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); const a = sendNow && sendNow.anchor; closeSend(); if (a && a.focus) a.focus(); }
  else if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); const n = all[(i + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]; if (n) n.focus(); }
  else if (e.key === "Tab") closeSend();
}
function sendMenu(btn, o) {
  btn.setAttribute("aria-haspopup", "menu"); btn.setAttribute("aria-expanded", "false");
  btn.addEventListener("click", e => { e.stopPropagation(); openSend(btn, typeof o === "function" ? o() : o); });
  return btn;
}
document.addEventListener("mousedown", e => { if (sendNow && !e.target.closest(".sendmenu") && e.target !== sendNow.anchor && !(sendNow.anchor.contains && sendNow.anchor.contains(e.target))) closeSend(); }, true);
window.addEventListener("blur", () => { if (sendNow && !sendEl.contains(document.activeElement)) closeSend(); });
window.addEventListener("resize", closeSend);

/* ---------- boxes in scrolling columns ----------
   A bubble never shows a straight cut: while one crosses the top or bottom edge of the column it scrolls in, its
   rounded frame stops at that edge and only its content moves on under it; once it has scrolled past, it is gone.
   Boxes inside a bubble (rows, tiles, cards) do the same a little further in, so they never meet its border.
   The frame follows the scroll through clip-path (no animation); .boxcut::after redraws the border on the cut. */
const BOX = ".card,.sec,.acc,.bubble,.row,.mod,.lcard,.tile,.item,.pcard";
const OUTER = ".card,.sec,.acc,.bubble";   // the bubbles; the rest are boxes inside them, framed a little further in
let scrollers = new WeakMap();   // box -> the column it scrolls in; forgotten on resize (layouts change there)
const scroller = el => {
  if (scrollers.has(el)) return scrollers.get(el);
  let sc = null;
  for (let p = el.parentElement; p && !sc; p = p.parentElement) { const o = getComputedStyle(p).overflowY; if (o === "auto" || o === "scroll") sc = p; }
  scrollers.set(el, sc); return sc;
};
function frameBoxes(sc) {
  const r = sc.getBoundingClientRect(), bottom = r.bottom - 2, plan = [];
  // a header stuck to the top of the column (the box on top of Settings and the Library) moves
  // the edge down to its foot
  let top = r.top + 2;
  for (const c of sc.querySelectorAll(":scope > *, :scope > * > .pbar")) if (getComputedStyle(c).position === "sticky") { const q = c.getBoundingClientRect(); if (q.top <= r.top + 24) top = Math.max(top, q.bottom + 4); }
  // read everything first, then write, so the page lays out once
  for (const b of sc.querySelectorAll(BOX)) {
    if (scroller(b) !== sc) continue;
    const cs = getComputedStyle(b), rad = parseFloat(cs.borderTopLeftRadius);
    if (!(rad >= 6)) continue;   // a layout row, not a box
    let depth = 0;
    for (let p = b.parentElement; p && p !== sc; p = p.parentElement) if (p.matches(OUTER)) depth++;
    const q = b.getBoundingClientRect(), ct = Math.max(0, top + depth * 8 - q.top), cb = Math.max(0, q.bottom - bottom + depth * 8);
    if (ct || cb) plan.push([b, q.height > ct + cb ? `inset(${ct}px 0 ${cb}px round ${rad}px)` : "inset(50%)", ct, cb, cs.borderTopWidth, cs.borderTopColor]);
    else if (b.style.clipPath) plan.push([b, ""]);
  }
  for (const [b, clip, ct, cb, bw, bc] of plan) {
    b.style.clipPath = clip;
    const cut = clip && clip !== "inset(50%)";
    b.classList.toggle("boxcut", cut);
    if (cut) { b.style.setProperty("--ct", ct + "px"); b.style.setProperty("--cb", cb + "px"); b.style.setProperty("--cbw", bw); b.style.setProperty("--cbc", bc); }
    else for (const v of ["--ct", "--cb", "--cbw", "--cbc"]) b.style.removeProperty(v);
  }
}
const dirty = new Set();
let framing = 0;
function frameSoon(sc) {
  if (!sc || sc.nodeType !== 1 || window.__ui?.away) return;
  dirty.add(sc);
  if (!framing) framing = requestAnimationFrame(() => { framing = 0; const all = [...dirty]; dirty.clear(); all.forEach(frameBoxes); });
}
let allSoon = 0;
const frameAll = () => { if (window.__ui?.away) return; if (!allSoon) allSoon = requestAnimationFrame(() => { allSoon = 0; for (const b of document.querySelectorAll(BOX)) frameSoon(scroller(b)); }); };
document.addEventListener("scroll", e => frameSoon(e.target === document ? null : e.target), true);
document.addEventListener("toggle", frameAll, true);
window.addEventListener("resize", () => { scrollers = new WeakMap(); frameAll(); });
// boxes that grow or shrink (a section opens, a list fills) move the ones below them
const grown = new ResizeObserver(frameAll), framed = new Set();
let watchSoon = 0;
const watch = () => {
  watchSoon = 0;
  if(window.__ui?.away) return;
  for(const b of framed) if(!b.isConnected){grown.unobserve(b);framed.delete(b);}
  for (const b of document.querySelectorAll(BOX)) if (!framed.has(b)) { framed.add(b); grown.observe(b); }
};
const boxesChanged = new MutationObserver(es => {
  if(window.__ui?.away || watchSoon) return;
  // Text progress/time changes cannot add a box; do not scan the whole document for them.
  if(es.some(e => [...e.addedNodes,...e.removedNodes].some(n=>n.nodeType===1))) watchSoon=requestAnimationFrame(watch);
});
const observeBoxes = () => boxesChanged.observe(document.documentElement, {childList:true,subtree:true});
observeBoxes();
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", watch); else watch();

// 1234567 → "1.2M" in the page's language (followers, views)
const shortCount = n => { try { return new Intl.NumberFormat(document.documentElement.lang || "en", { notation: "compact", maximumFractionDigits: 1 }).format(n || 0); } catch (e) { return String(n || 0); } };
/* ---------- a tool left behind ---------- */
// The main window marks a tool page away when another view takes its place (shell.js show). Away: its sound fades
// and stops, what plays pauses, loops stop drawing and CSS animations hold (ui.css [data-away]); the work running in
// it (an export, a job) goes on. onAway(fn): the page's own pause (fn runs when it goes); whenBack(fn): once, when it
// is shown again (a loop that stopped starts again there). fadeOut(media, ms): its volume down, then paused.
const AWAY = { on: false, away: [], back: [] };
function fadeOut(m, ms = 240) {
  if (!m || m.paused || m.__fading) return Promise.resolve();
  if (m.muted || !m.volume) { m.pause(); return Promise.resolve(); }
  const v0 = m.volume, t0 = performance.now();
  m.__fading = true;
  return new Promise(res => {
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      m.volume = v0 * (1 - k);
      if (k < 1 && !m.paused) return void setTimeout(step, 16);
      m.pause(); m.volume = v0; m.__fading = false; res();
    };
    step();
  });
}
function setAway(on) {
  on = !!on;
  if (AWAY.on === on) return;
  AWAY.on = on;
  document.documentElement.toggleAttribute("data-away", on);
  if (on) {
    cancelAnimationFrame(framing);cancelAnimationFrame(allSoon);cancelAnimationFrame(watchSoon);framing=allSoon=watchSoon=0;dirty.clear();grown.disconnect();framed.clear();boxesChanged.disconnect();
    for (const fn of AWAY.away) { try { fn(); } catch (e) { console.warn(e); } }
    // what the page did not pause itself
    for (const m of document.querySelectorAll("audio, video")) fadeOut(m);
  } else { observeBoxes();watch();frameAll();for (const fn of AWAY.back.splice(0)) { try { fn(); } catch (e) { console.warn(e); } } }
}
const onAway = fn => { AWAY.away.push(fn); return () => {const i=AWAY.away.indexOf(fn);if(i>=0)AWAY.away.splice(i,1);}; };
const whenBack = fn => { if (AWAY.on) AWAY.back.push(fn); else fn(); };

if(window!==parent){for(const type of ["pointerdown","pointermove","keydown","wheel"])document.addEventListener(type,()=>parent.__renderBudget?.interaction(),{passive:true,capture:true});}
window.__ui = { $, esc, clamp, mk, clone, sleep, cap, setStatus, saveFile, retryLabel, editValue, parseTyped, sendMenu, openSend, closeSend, shortCount,
  rangeDefault, resetRange,
  setAway, onAway, whenBack, fadeOut, get away() { return AWAY.on; } };
})();
