// Motion primitives shared by the main window and the tool frames (docs/MOTION.md, docs/ARCHITECTURE.md → Motion).
// Engine: GSAP (tweens) and its Flip plugin (layout changes), loaded before this file (gsap.min.js, Flip.min.js).
// Everything settles on one critically damped spring; an animation that interrupts another starts from where it is,
// with its speed, so a move never stops dead. Transform and opacity move; a place that recedes also goes out of
// focus (blur). With reduced motion (the system's or Settings → "Reduce animations", data-motion="reduce" on <html>)
// everything turns into a short fade. The durations are the tokens in tokens.css (--spring, --place, --fade, --stagger).
(() => {
  "use strict";
  const P = window.parent !== window ? window.parent : null;
  const root = document.documentElement;
  const mq = window.matchMedia ? matchMedia("(prefers-reduced-motion: reduce)") : { matches: false };
  // A frame starts with the choice of the main window
  try { if (P && P.document.documentElement.dataset.motion) root.dataset.motion = P.document.documentElement.dataset.motion; } catch (e) {}

  const reduced = () => mq.matches || root.dataset.motion === "reduce";
  // Tests of the app's flows switch motion off altogether (tests/common.js sets __motionOff in every frame), so no
  // fade can change what a step measures; reduced motion still fades
  const off = () => { try { return !!(window.__motionOff || (P && P.__motionOff)); } catch (e) { return false; } };
  const still = () => reduced() || off();
  const tokens = {};
  function tok(name) {
    if (!(name in tokens)) tokens[name] = getComputedStyle(root).getPropertyValue(name).trim();
    return tokens[name];
  }
  // durations: "spring" (the interface), "place" (changing place), "fade", "stagger"; older names map onto them
  const NAMES = { fast: "fade", fade: "fade", base: "spring", slow: "spring", spring: "spring", follow: "spring", page: "place", place: "place", stagger: "stagger" };
  const DEF = { spring: 320, place: 300, fade: 140, stagger: 28 };
  const dur = d => { if (typeof d === "number") return d; const n = NAMES[d] || "spring"; return parseFloat(tok("--" + n)) || DEF[n]; };
  const SHIFT = { xs: 4, sm: 8, md: 12 };
  const shift = s => typeof s === "number" ? s : SHIFT[s || "sm"] || 8;

  /* ---------- engine: GSAP ---------- */
  const G = window.gsap, FL = window.Flip;
  // Flip needs <body> to register (this file loads in <head>): registered again on first use
  let flipOk = false;
  const flipReady = () => { if (!flipOk && FL && document.body) { G.registerPlugin(FL); FL.register(G); flipOk = true; } return flipOk; };
  G.config({ force3D: "auto", nullTargetWarn: false });   // transforms on the GPU while they move, flat again at rest
  // The spring: x(t) = 1 − (1 + (ω − v0)·t)·e^(−ω·t), critically damped, over its settle time (ω·T = 9.23: within
  // 0.1 % at the end). v0 is the speed it starts with (in whole distances per duration), so an interrupted move goes
  // on with the speed it had. tokens.css --ease is the same curve for CSS transitions.
  const W = 9.23;
  const rest = x => x >= 1 ? 1 : 1 - (1 + W * x) * Math.exp(-W * x);
  const spring = (v0 = 0) => !v0 ? rest : x => x >= 1 ? 1 : 1 - (1 + (W - v0) * x) * Math.exp(-W * x);
  const slope = (f, p) => { const h = 1e-3; return (f(Math.min(1, p + h)) - f(Math.max(0, p - h))) / (Math.min(1, p + h) - Math.max(0, p - h)); };

  // Running animations per element and channel, so a new one replaces the old one where it is.
  // An animation is a GSAP tween wrapped like a Web Animation: .finished, .cancel(), .playState. It writes inline
  // styles while it plays; when it ends (or is cancelled) the element gets back its own inline values, so the page's
  // styles are the rest state (fill "forwards" keeps the end state until cancel()).
  const running = new WeakMap();
  const PROPS = ["transform", "opacity", "transformOrigin", "filter"];
  const cssName = p => p.replace(/[A-Z]/g, c => "-" + c.toLowerCase());
  function current(el) {
    const cs = getComputedStyle(el);
    return { transform: cs.transform === "none" ? "none" : cs.transform, opacity: cs.opacity, filter: cs.filter === "none" ? "blur(0px)" : cs.filter };
  }
  const log = el => { const m = window.__motion; if (m && m._log) try { m._log(el); } catch (e) {} };
  // A CSS transform (none, translate, translateX/Y, scale, rotate, matrix) as GSAP components, so HTML and SVG move alike
  const ID = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };
  function parseTf(v) {
    const r = Object.assign({}, ID);
    if (!v || v === "none") return r;
    const m = /matrix\(([^)]+)\)/.exec(v);
    if (m) { const [a, b, c, d, e, f] = m[1].split(",").map(Number); r.x = e; r.y = f; r.scaleX = Math.hypot(a, b); r.scaleY = (a * d - b * c) / (r.scaleX || 1); r.rotation = Math.atan2(b, a) * 180 / Math.PI; return r; }
    const re = /(translateX|translateY|translate|scale|rotate)\(([^)]*)\)/g;
    let t;
    while ((t = re.exec(v))) {
      const n = t[2].split(",").map(x => parseFloat(x));
      if (t[1] === "translate") { r.x += n[0] || 0; r.y += n[1] || 0; }
      else if (t[1] === "translateX") r.x += n[0] || 0;
      else if (t[1] === "translateY") r.y += n[0] || 0;
      else if (t[1] === "scale") { r.scaleX *= n[0]; r.scaleY *= n.length > 1 ? n[1] : n[0]; }
      else r.rotation += n[0] || 0;
    }
    return r;
  }
  const gsapVars = f => { const o = Object.assign({}, f); if ("transform" in o) { Object.assign(o, parseTf(o.transform)); delete o.transform; } return o; };
  function tween(el, from, to, o) {
    const props = PROPS.filter(p => p in from || p in to), saved = {};
    for (const p of props) saved[p] = el.style.getPropertyValue(cssName(p));
    // GSAP moves an SVG element through its transform attribute: that is what comes back
    const svg = el instanceof SVGElement, attr = svg ? el.getAttribute("transform") : null;
    let settle, restored = false;
    const a = { playState: "running", finished: new Promise(res => { settle = res; }) };
    const restore = () => {
      if (restored) return; restored = true;
      if (svg) {
        for (const p of props) el.style.removeProperty(cssName(p));
        if (attr == null) el.removeAttribute("transform"); else el.setAttribute("transform", attr);
        if (el._gsap) el._gsap.uncache = 1;
      } else G.set(el, { clearProps: props.join(",") });
      for (const p of props) if (saved[p]) el.style.setProperty(cssName(p), saved[p]);
    };
    const f0 = gsapVars(from), f1 = gsapVars(to), easeFn = o.ease || rest;
    const t = G.fromTo(el, f0, Object.assign(Object.assign({}, f1), {
      duration: o.duration / 1000, delay: (o.delay || 0) / 1000, ease: easeFn, overwrite: false, immediateRender: true,
      ...(o.after ? { paused: true } : {}),
      ...(o.lazy === undefined ? {} : { lazy: o.lazy }),
      onComplete: () => { a.playState = "finished"; if (o.fill !== "forwards") restore(); settle(true); }
    }));
    a.cancel = () => { if (a.playState === "running") { t.kill(); a.playState = "idle"; restore(); settle(false); } else if (a.playState === "finished") { a.playState = "idle"; restore(); } };
    a.tween = t; a.props = props;
    // Prepare the existing from-state now, then play after its owning place has
    // settled. Cancellation also restores a reveal that never started.
    if (o.after) Promise.resolve(o.after).then(ok => { if (a.playState !== "running") return; if (ok === false) a.cancel(); else t.play(); }, () => a.cancel());
    // its speed now, per numeric property, in units per second (for the move that interrupts it)
    a.speed = k => { const p = t.progress(); if (p <= 0 || p >= 1 || typeof f0[k] !== "number" || typeof f1[k] !== "number") return 0; return (f1[k] - f0[k]) * slope(easeFn, p) / (o.duration / 1000); };
    log(el);
    return a;
  }
  // The speed a new move starts with: the old move's speed along the property that travels most, in whole distances
  // per duration of the new one
  const SCALE = { x: 100, y: 100, scaleX: 1, scaleY: 1, opacity: 1, rotation: 90 };
  function carry(prev, from, to, ms, minDistance = 0.02, basis = {}) {
    if (!prev || !prev.speed) return 0;
    const a = gsapVars(from), b = gsapVars(to);
    let best = null, bd = minDistance;
    for (const k of Object.keys(SCALE)) { if (typeof a[k] !== "number" || typeof b[k] !== "number") continue; const d = Math.abs(b[k] - a[k]) / SCALE[k]; if (d > bd) { bd = d; best = k; } }
    if (!best) return 0;
    const v = prev.speed(best) * (basis[best] ?? 1) * (ms / 1000) / (b[best] - a[best]);
    return isFinite(v) ? Math.max(-8, Math.min(24, v)) : 0;
  }
  // animate(el, keyframes, { dur, delay, channel, fill }) → animation | null. Two keyframes (from, to), or one (to,
  // from where the element is). With an animation already running on the same channel, it starts from its current
  // state and with its speed. Reduced motion: only the opacity changes, as a short fade (nothing when it has none).
  function animate(el, frames, o = {}) {
    if (!el || !el.style) return null;
    const ch = o.channel || "main", map = running.get(el) || new Map();
    const prev = map.get(ch);
    let from = frames.length > 1 ? Object.assign({}, frames[0]) : null;
    let to = Object.assign({}, frames[frames.length - 1]);
    let v0 = 0, ms = dur(o.dur);
    if (prev) {
      if (prev.playState === "running" && from) { if (!o.rebase) from = Object.assign(from, current(el)); v0 = carry(prev, from, to, ms, o.carryMin, o.carryBasis); }
      prev.cancel();
      map.delete(ch);
    }
    // another channel moving the same properties of this element (the dock's icons arriving while the dock opens):
    // two GSAP tweens would write one transform, and the first to end would clear it under the other, the element
    // jumping; that one lets go here, the new move starts from where the element is
    const mine = PROPS.filter(p => p in to || (from && p in from));
    for (const [c, other] of map) if (c !== ch && other.props && other.props.some(p => mine.includes(p))) {
      if (!from) from = {};
      const now = current(el); for (const k of Object.keys(to)) if (!(k in from) && k in now) from[k] = now[k];
      other.cancel(); map.delete(c);
    }
    if (o.noOvershoot) v0 = Math.max(0, Math.min(W, v0));
    if (off()) return null;
    if (reduced()) {
      if (!("opacity" in to)) return null;
      from = { opacity: from && "opacity" in from ? from.opacity : current(el).opacity }; to = { opacity: to.opacity };
      if (+from.opacity === +to.opacity) return null;
      ms = dur("fade"); v0 = 0;
    }
    if (!from) { const c = current(el); from = {}; for (const k of Object.keys(to)) if (k in c) from[k] = c[k]; }
    const a = tween(el, from, to, { duration: ms, ease: spring(v0), delay: reduced() ? 0 : o.delay, fill: o.fill, lazy: o.lazy, after: reduced() ? null : o.after });
    map.set(ch, a); running.set(el, map);
    a.finished.then(() => { if (map.get(ch) === a && a.playState !== "running" && o.fill !== "forwards") map.delete(ch); });
    return a;
  }
  function stop(el, ch = "main") { const m = running.get(el), a = m && m.get(ch); if (a) { a.cancel(); m.delete(ch); } }
  const done = a => a ? a.finished : Promise.resolve(true);
  // Anything of this page still moving (GSAP tweens and Flips); CSS loops are in document.getAnimations()
  const busy = () => G.globalTimeline.getChildren(true, true, false).some(t => t.progress() < 1);

  /* ---------- enter and exit ---------- */
  const tf = (x = 0, y = 0, s = 1) => `translate(${x}px,${y}px)` + (s !== 1 ? ` scale(${s})` : "");
  // fade, fade+slide (y or x in px or a shift token) and scale-in (scale 0.98 → 1)
  function fadeIn(el, o = {}) {
    const x = o.x ? shift(o.x) * Math.sign(typeof o.x === "number" ? o.x : 1) : 0, y = o.y ? (typeof o.y === "number" ? o.y : shift(o.y)) : 0;
    return animate(el, [{ opacity: 0, transform: tf(x, y, o.scale || 1) }, { opacity: 1, transform: "none" }], { dur: o.dur || "spring", delay: o.delay, channel: "vis", after: o.after });
  }
  const scaleIn = (el, o = {}) => fadeIn(el, Object.assign({ scale: 0.96 }, o));
  // Plays the exit and keeps the end state until `then` has run (usually hiding the element), then lets go
  function fadeOut(el, o = {}) {
    const y = o.y ? (typeof o.y === "number" ? o.y : shift(o.y)) : 0;
    const a = animate(el, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: tf(0, y, o.scale || 1) }], { dur: o.dur || "fade", channel: "vis", fill: "forwards" });
    return done(a).then(ok => { if (ok && o.then) o.then(); if (a) a.cancel(); return ok; });
  }
  // show / hide an element with the hidden attribute; a show during a hide wins
  const hiding = new WeakMap();
  function show(el, o = {}) {
    hiding.delete(el);
    const was = el.hidden; el.hidden = false;
    if (was || o.force) return (o.scale ? scaleIn : fadeIn)(el, o);
    return null;
  }
  function hide(el, o = {}) {
    if (el.hidden) return Promise.resolve(true);
    const token = {}; hiding.set(el, token);
    if (off()) { el.hidden = true; hiding.delete(el); if (o.then) o.then(); return Promise.resolve(true); }
    return fadeOut(el, Object.assign({}, o, { then: () => { if (hiding.get(el) === token) { el.hidden = true; hiding.delete(el); if (o.then) o.then(); } } }));
  }

  // reveal(el, on, o): show or hide by a condition; only a real change animates
  const reveal = (el, on, o) => el && (on ? show(el, o) : hide(el, o));
  // enter(el): a panel that has just replaced another (sub-tabs, a dialog's mode) fades in with a small rise
  const enter = (el, o = {}) => fadeIn(el, Object.assign({ y: "xs", dur: "spring" }, o));

  /* ---------- popovers, menus and dialogs: they grow from where they were opened ---------- */
  function originFrom(el, from) {
    if (!from) return "50% 0";
    const r = el.getBoundingClientRect(), f = from.getBoundingClientRect ? from.getBoundingClientRect() : { left: from.x, top: from.y, width: 0, height: 0 };
    const x = Math.max(0, Math.min(r.width, f.left + f.width / 2 - r.left)), y = Math.max(0, Math.min(r.height, f.top + f.height / 2 - r.top));
    return `${x}px ${y}px`;
  }
  // pop(el, from): the element (already visible) scales from 0.96 at the point of `from` (an element or {x, y})
  function pop(el, from, o = {}) {
    hiding.delete(el);
    el.style.transformOrigin = originFrom(el, from);
    const a = animate(el, [{ opacity: 0, transform: "scale(0.96)" }, { opacity: 1, transform: "none" }], { dur: o.dur || "spring", channel: "vis" });
    // a menu's items follow it in, one after another, a few pixels from where it opened
    if (a && (el.matches('[role="menu"],[role="listbox"],.menu,.sendmenu'))) {
      const items = [...el.children].filter(c => c.matches("button,[role^=menuitem],[role=option]")).slice(0, 12);
      const dy = el.getBoundingClientRect().top < (from && from.getBoundingClientRect ? from.getBoundingClientRect().top : 0) ? 4 : -4;
      items.forEach((c, i) => animate(c, [{ opacity: 0, transform: `translateY(${dy}px)` }, { opacity: 1, transform: "none" }], { dur: "spring", delay: 20 + i * dur("stagger") * 0.6, channel: "vis" }));
    }
    return a;
  }
  function openPopover(el, from, o) { hiding.delete(el); el.hidden = false; return pop(el, from, o); }
  // closing goes back into where it came from (the origin pop left on it)
  function closePopover(el, o = {}) { return hide(el, Object.assign({ scale: 0.96 }, o)); }
  // <dialog>: showModal with a scale-in from its opener while the backdrop blurs in (ui.css), and every way of closing
  // it (buttons, form, Esc) plays the exit back into the opener first
  function dialog(d) {
    if (d.__motion) return d;
    d.__motion = true;
    const nativeClose = HTMLDialogElement.prototype.close;
    let closing = null;
    d.showFrom = from => {
      if (closing) { closing = null; stop(d, "vis"); }
      d.classList.remove("closing");
      if (!d.open) d.showModal();
      pop(d, from || null);
    };
    d.close = function (value) {
      if (!d.open || closing) return;
      if (off()) { nativeClose.call(d, value); return; }
      const token = closing = {};
      d.classList.add("closing");
      const end = () => { if (closing === token) { closing = null; d.classList.remove("closing"); if (d.open) nativeClose.call(d, value); } };
      fadeOut(d, { scale: 0.96, then: end }).then(end);
    };
    d.addEventListener("cancel", e => { e.preventDefault(); d.close(""); });
    d.addEventListener("submit", e => {
      const f = e.target; if (!f || f.method !== "dialog") return;
      e.preventDefault(); d.close(e.submitter && e.submitter.value != null ? e.submitter.value : "");
    });
    return d;
  }

  /* ---------- FLIP (GSAP Flip): layout changes played with transforms ---------- */
  // Plays the move of `els` from a Flip state recorded before a layout change: a translate (and a scale where the
  // size changed), interrupting a move already running on them from where it is. Far off-screen elements jump.
  function playFlip(state, els, o = {}) {
    if (!flipReady() || still()) return null;
    const vis = [...els].filter(el => { if (!el.isConnected) return false; const r = el.getBoundingClientRect(); return r.bottom > -200 && r.top < innerHeight + 200; }).slice(0, 60);
    if (!vis.length) return null;
    const moving = vis.filter(el => { const b = state.getElementState(el) || (el.dataset.flipId && state.idLookup[el.dataset.flipId]); if (!b) return false; const r = el.getBoundingClientRect(); return Math.abs(b.bounds.left - r.left) >= 0.5 || Math.abs(b.bounds.top - r.top) >= 0.5 || Math.abs(b.bounds.width - r.width) >= 0.5; });
    if (!moving.length) return null;
    moving.forEach(log);
    return FL.from(state, { targets: moving, duration: dur(o.dur || "spring") / 1000, ease: rest, scale: true, simple: true, prune: true });
  }
  // Elements after `el` (its later siblings and those of its ancestors up to `stop`): what moves when `el` grows
  function after(el, stopAt) {
    const out = [];
    for (let n = el; n && n !== stopAt && n !== document.body; n = n.parentElement) {
      for (let s = n.nextElementSibling; s; s = s.nextElementSibling) out.push(s);
      if (out.length > 60) break;
    }
    return out;
  }
  // flip(elements, mutate): records positions, runs mutate(), and slides every element from where it was
  function flip(els, mutate, o) {
    if (!flipReady() || still()) { mutate(); return; }
    els = [...els];
    const state = FL.getState(els, { simple: true });
    mutate();
    playFlip(state, els, o);
  }
  // Keyed lists: list(container, mutate, { sel, key }) moves the items that stay, scales in the new ones
  // and fades the removed ones out on a ghost at their old place (mutate may rebuild the list with innerHTML: the
  // items are matched by key through data-flip-id).
  function list(container, mutate, o = {}) {
    const sel = o.sel || ":scope > [data-key]", key = o.key || (el => el.dataset.key);
    if (!container || still() || !flipReady()) { mutate(); if (container) container.dataset.listed = "1"; return; }
    const c0 = container.getBoundingClientRect(), listed = !!container.dataset.listed || !!o.enterFirst;
    container.dataset.listed = "1";
    const items = () => [...container.querySelectorAll(sel)].filter(el => !el.dataset.ghost && key(el) != null);
    const tag = el => { el.dataset.flipId = "k-" + key(el); return el; };
    const olds = items().map(tag), before = new Map(olds.map(el => [key(el), { el, r: el.getBoundingClientRect() }]));
    const state = FL.getState(olds, { simple: true });
    mutate();
    const now = items().map(tag), seen = new Set(), stay = [];
    let entering = 0;
    for (const el of now) {
      const k = key(el); seen.add(k);
      if (before.has(k)) stay.push(el);
      else if (listed) scaleIn(el, { y: "xs", delay: Math.min(entering++, 6) * dur("stagger") });
    }
    playFlip(state, stay, o);
    for (const [k, b] of before) {
      if (seen.has(k) || b.el.isConnected) continue;
      ghost(container, b.el, { left: b.r.left - c0.left, top: b.r.top - c0.top, width: b.r.width, height: b.r.height });
    }
  }
  function ghost(container, el, r) {
    if (getComputedStyle(container).position === "static") container.style.position = "relative";
    const g = el;
    Object.assign(g.style, { position: "absolute", left: r.left - container.clientLeft + container.scrollLeft + "px", top: r.top - container.clientTop + container.scrollTop + "px", width: r.width + "px", height: r.height + "px", margin: "0", pointerEvents: "none", zIndex: "0" });
    g.setAttribute("aria-hidden", "true"); g.inert = true;
    g.dataset.ghost = "1"; delete g.dataset.key; delete g.dataset.flipId;
    container.appendChild(g);
    fadeOut(g, { scale: 0.98, then: () => g.remove() }).then(ok => { if (!ok) g.remove(); });
  }

  /* ---------- accordions: <details> open and close with the content fading and what follows sliding ---------- */
  function details(d, o = {}) {
    if (d.__motion) return;
    d.__motion = true;
    const sum = d.querySelector(":scope > summary");
    if (!sum) return;
    sum.addEventListener("click", e => {
      if (e.defaultPrevented || still()) return;
      e.preventDefault();
      toggle(d, d.__closing ? true : !d.open, o);   // a click while it closes opens it again
    });
  }
  const bodyOf = d => [...d.children].filter(c => c.tagName !== "SUMMARY");
  function toggle(d, open, o = {}) {
    const stopAt = o.stop || d.closest(o.scroller || ".rack,.lib,.page,.work>*,body");
    const moving = after(d, stopAt);
    if (still()) { d.open = open; return; }
    if (open) {
      d.__closing = null;
      for (const b of bodyOf(d)) stop(b, "vis");
      // "motion:open" lets the page fill the content before the new layout is measured
      flip(moving, () => { d.open = true; d.dispatchEvent(new Event("motion:open")); });
      for (const b of bodyOf(d)) fadeIn(b, { y: -shift("xs") });
    } else {
      const token = d.__closing = {};
      const outs = bodyOf(d).map(b => fadeOut(b));
      Promise.all(outs).then(() => {
        if (d.__closing !== token) return;
        d.__closing = null;
        flip(moving, () => { d.open = false; });
        for (const b of bodyOf(d)) stop(b, "vis");
      });
    }
  }
  // Every <details> under root (now and later) gets the animation
  function autoDetails(rootEl = document, o) {
    const hook = n => { if (n.tagName === "DETAILS") details(n, o); n.querySelectorAll && n.querySelectorAll("details").forEach(x => details(x, o)); };
    hook(rootEl.body || rootEl);
    new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1) hook(n); }).observe(rootEl.body || rootEl, { childList: true, subtree: true });
  }

  /* ---------- changing place: views ---------- */
  // swap(update, { view, from, origin, back, flat }): the view left behind recedes (smaller, out of focus, fading) while
  // the new one advances into place. Opening (origin: the dock icon that opened it) it grows out of the icon; going
  // back (back: the old view's own icon as origin) the old view goes back into its icon and the new one comes forward
  // from just behind. flat: no blur (a view with a live canvas). Reduced motion: a cross-fade.
  function swap(update, o = {}) {
    const old = o.from && o.from !== o.view ? o.from : null;
    // One pixel of coverage per edge while transforming; settle at the original size.
    const cover = el => `scale(${1 + 2 / Math.max(1,el.clientWidth)},${1 + 2 / Math.max(1,el.clientHeight)})`;
    if (o.view) o.view.classList.remove("leaving");
    update();
    if (old) {
      old.classList.add("leaving");
      const a = animate(old, [{ opacity: 1, transform: "none", transformOrigin: "50% 50%" }, { opacity: 0, transform: cover(old), transformOrigin: "50% 50%" }], { dur: dur("place") * .5, channel: "vis", fill: "forwards", noOvershoot: true });
      done(a).then(() => { if (!old.classList.contains("on")) { old.classList.remove("leaving"); if (a) a.cancel(); } });
    }
    if (o.view) {
      const view = o.view, org = "50% 50%", ms = dur("place");
      const stretch = `scale(${1 + 5 / Math.max(1,view.clientWidth)},${1 + 3 / Math.max(1,view.clientHeight)})`;
      const a = animate(view, [{ opacity: 0, transform: cover(view), transformOrigin: org }, { opacity: 1, transform: stretch, transformOrigin: org }], { dur: ms * .28, delay: ms * .22, channel: "vis", fill: "forwards", noOvershoot: true });
      const settled = done(a).then(ok => {
        if (!ok || !a || running.get(view)?.get("vis") !== a || !view.classList.contains("on")) return false;
        const tail = animate(view, [{ transform: stretch, transformOrigin: org }, { transform: "none", transformOrigin: org }], { dur: ms * .5, channel: "vis", noOvershoot: true });
        return done(tail);
      });
      // .finished belongs to the first tween; navigation waits for both phases (or interruption).
      if (a) a.settled = settled;
      return a;
    }
    return null;
  }

  /* ---------- first-run surface: one static mark, one transforming object ---------- */
  // Dedicated to Welcome. The surface is a sibling behind the content, so FLIP scales its geometry
  // without stretching typography. The same mark and footer travel through every layout change.
  function welcomeFlow(d) {
    const object = d.querySelector(".wl-object"), surface = d.querySelector(".wl-surface"), mark = d.querySelector(".wl-mark"), word = d.querySelector(".wl-wordmark");
    const body = d.querySelector(".wl-body"), footer = d.querySelector(".wl-footer"), veil = d.querySelector(".wl-veil");
    const geometry = [surface, mark, word, footer];
    let serial = 0, moving = null, stopBackground = null;
    const wait = ms => still() ? Promise.resolve() : new Promise(resolve => G.delayedCall(ms / 1000, resolve));
    const capture = (els = geometry) => flipReady() && !still() ? FL.getState(els, { simple: true }) : null;
    const morph = (state, ms, els = geometry) => {
      if (moving) moving.kill();
      moving = state ? playFlip(state, els, { dur: ms }) : null;
      return moving ? moving.then(() => true) : Promise.resolve(true);
    };
    async function open(mutate) {
      const run = ++serial;
      d.dataset.phase = "seed";
      delete d.dataset.arrival;
      document.body.classList.add("welcome-active");
      if (!d.open) d.showModal();
      stopBackground = window.__welcomeBackground(d.querySelector(".wl-background"));
      await done(animate(mark, [{ opacity: 0 }, { opacity: 1 }], { dur: dur("place"), channel: "welcome", noOvershoot: true }));
      await wait(dur("place") * .4);
      if (serial !== run || !d.open) return;
      const shape = [surface, mark], state = capture(shape);
      d.dataset.arrival = "geometry"; mutate();
      const travel = morph(state, dur("place") * 2.2, shape);
      animate(surface, [{ opacity: 0 }, { opacity: 1 }], { dur: dur("place") * 1.6, channel: "welcome" });
      await travel;
      if (serial !== run || !d.open) return;
      delete d.dataset.arrival;
      await Promise.all([
        done(animate(word, [{ opacity: 0 }, { opacity: 1 }], { dur: "spring", channel: "welcome" })),
        done(animate(body, [{ opacity: 0, transform: "translateY(12px)" }, { opacity: 1, transform: "none" }], { dur: "spring", channel: "welcome", noOvershoot: true })),
        done(animate(footer, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], { dur: "spring", delay: dur("stagger") * 2, channel: "welcome", noOvershoot: true }))
      ]);
    }
    async function change(mutate) {
      const run = ++serial;
      delete d.dataset.arrival;
      const exit = animate(body, [{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-12px)" }], { dur: dur("place") * .7, channel: "welcome", fill: "forwards", noOvershoot: true });
      await done(exit);
      if (serial !== run || !d.open) return;
      const state = capture(); if (exit) exit.cancel(); mutate();
      const travel = morph(state, dur("place") * 2.2);
      animate(body, [{ opacity: 0, transform: "translateY(18px)" }, { opacity: 1, transform: "none" }], { dur: dur("spring") * 1.6, delay: dur("stagger") * 2, channel: "welcome", noOvershoot: true });
      await travel;
    }
    async function close() {
      ++serial;
      delete d.dataset.arrival;
      stop(mark, "welcome"); stop(word, "welcome");
      const destination = document.querySelector("#v-home .hero .logo"), destinationWord = document.querySelector("#v-home .hero .word");
      stop(destination, "vis"); stop(destinationWord, "vis");
      document.body.classList.add("welcome-logo-handoff");
      const destinations = [destination, destinationWord];
      const targets = destinations.map(el => el.getBoundingClientRect());
      const sources = [mark, word].map(el => el.getBoundingClientRect());
      // Only the real, unboxed Home artwork participates in the exit. Each proxy has its own
      // fixed viewport layer, intrinsic aspect ratio and uniform scale, independent of the surface.
      const resolved = [destination, destinationWord].map((source, i) => {
        const svg = source.cloneNode(true), target = targets[i], from = sources[i], style = getComputedStyle(source);
        const scale = from.width / target.width;
        const y = from.y + from.height / 2 - target.height * scale / 2;
        svg.removeAttribute("style"); svg.removeAttribute("role"); svg.removeAttribute("aria-label");
        svg.setAttribute("class", "wl-resolved-brand"); svg.setAttribute("aria-hidden", "true");
        Object.assign(svg.style, { left: "0px", top: "0px", width: target.width + "px", height: "auto", margin: "0", fill: style.fill, filter: style.filter,
          transformOrigin: "0 0", transform: `translate(${from.x}px,${y}px) scale(${scale})` });
        d.append(svg);
        return svg;
      });
      d.dataset.brandProxy = "true";
      const contentExit = [
        done(animate(body, [{ opacity: current(body).opacity, transform: current(body).transform }, { opacity: 0, transform: "translateY(-8px)" }], { dur: dur("place") * .6, channel: "welcome", fill: "forwards", noOvershoot: true })),
        done(animate(footer, [{ opacity: current(footer).opacity }, { opacity: 0 }], { dur: "fade", channel: "welcome", fill: "forwards" }))
      ];
      await wait(dur("stagger") * 2);
      // Only the surface expands. Its actual card rect becomes the viewport through GSAP transforms;
      // the independent clean branding proxies retain their position, size and opacity throughout this stage.
      const expansion = surface.getBoundingClientRect();
      d.dataset.exit = "expanding";
      const expand = animate(surface, [{ transform: `translate(${expansion.x}px,${expansion.y}px) scale(${expansion.width / innerWidth},${expansion.height / innerHeight})`, transformOrigin: "0 0" }, { transform: "none", transformOrigin: "0 0" }], { dur: dur("place") * 1.6, channel: "welcome-expand", noOvershoot: true });
      if (expand) {
        // Preserve the measured rect's precision; CSSPlugin rounds scale components to four decimals.
        const width = innerWidth, height = innerHeight;
        const placeSurface = () => {
          const remaining = 1 - expand.tween.ratio;
          surface.style.transform = `matrix(${1 + (expansion.width / width - 1) * remaining},0,0,${1 + (expansion.height / height - 1) * remaining},${expansion.x * remaining},${expansion.y * remaining})`;
        };
        expand.tween.eventCallback("onUpdate", placeSurface); placeSurface();
      }
      await Promise.all([...contentExit, done(expand)]);
      d.dataset.exit = "branding";
      document.body.classList.add("welcome-releasing");
      document.body.classList.remove("welcome-active");
      // Reveal Drape during the branding travel, beneath the untouched live Welcome shader.
      const dissolve = [surface, veil].map(el => done(animate(el, [{ opacity: 1 }, { opacity: 0 }], { dur: dur("place") * 1.4, channel: "welcome", fill: "forwards" })));
      // Interpolate in viewport coordinates against the live Home geometry, including the
      // static logo placement. The same placement continues through Home's reveal.
      const placeBrand = (el, i, progress) => {
        const target = destinations[i].getBoundingClientRect(), from = sources[i];
        const startScale = from.width / target.width, scale = 1 + (startScale - 1) * (1 - progress);
        const fromY = from.y + from.height / 2 - target.height * startScale / 2;
        el.style.width = target.width + "px";
        el.style.transform = `matrix(${scale},0,0,${scale},${target.x + (from.x - target.x) * (1 - progress)},${target.y + (fromY - target.y) * (1 - progress)})`;
      };
      const travel = resolved.map(async (el, i) => {
        if (still()) {
          await done(animate(el, [{ opacity: 1 }, { opacity: 0 }], { dur: "fade", channel: "welcome-brand", fill: "forwards" }));
          placeBrand(el, i, 1);
          await done(animate(el, [{ opacity: 0 }, { opacity: 1 }], { dur: "fade", channel: "welcome-brand", fill: "forwards" }));
        } else {
          const target = destinations[i].getBoundingClientRect();
          const move = animate(el, [{ transform: el.style.transform, transformOrigin: "0 0" }, { transform: `translate(${target.x}px,${target.y}px)`, transformOrigin: "0 0" }], { dur: dur("place") * 1.1, channel: "welcome-brand", fill: "forwards", noOvershoot: true });
          if (move) move.tween.eventCallback("onUpdate", () => placeBrand(el, i, move.tween.ratio));
          await done(move);
          placeBrand(el, i, 1);
        }
      });
      await Promise.all(travel);
      let tracking = true, brandFrame;
      const trackBrand = () => { if (!tracking) return; resolved.forEach((el, i) => placeBrand(el, i, 1)); brandFrame = requestAnimationFrame(trackBrand); };
      trackBrand();
      d.dataset.exit = "reveal";
      await wait(dur("place") * .35);
      // The aligned branding stays fixed while the rest of Home arrives in deliberate groups.
      const reveal = [
        [document.querySelector("#v-home .hero .note"), "translateY(6px)", 0],
        [document.querySelector(".rail"), "translateX(-10px)", dur("stagger")],
        [document.querySelector(".head"), "translateY(-6px)", dur("stagger") * 2],
        [document.querySelector("#hcards"), "translateY(10px)", dur("stagger") * 3],
        [document.querySelector("#v-home .homecols"), "translateY(12px)", dur("stagger") * 5]
      ];
      const arrivals = reveal.map(([el, transform, delay]) => done(animate(el, [{ opacity: 0, transform }, { opacity: 1, transform: "none" }], { dur: "spring", delay, channel: "welcome-home", noOvershoot: true })));
      document.body.classList.remove("welcome-releasing");
      await Promise.all([...dissolve, ...arrivals]);
      // The real Home branding and overlays have identical rects; hand them over in the same task.
      tracking = false; cancelAnimationFrame(brandFrame);
      document.body.classList.remove("welcome-logo-handoff");
      HTMLDialogElement.prototype.close.call(d);
      stopBackground?.(); stopBackground = null;
      for (const el of [object, surface, mark, word, body, footer, veil, ...resolved]) stop(el, "welcome");
      for (const el of resolved) stop(el, "welcome-brand");
      stop(surface, "welcome-expand");
      for (const el of resolved) el.remove();
      delete d.dataset.exit; delete d.dataset.brandProxy;
    }
    return { open, change, close };
  }

  /* ---------- small things ---------- */
  // A navigation impulse gently stretches the Home canvas, outside the supplied renderer.
  // The host keeps its original Home/tool envelope; tool canvases are never transformed here.
  const waves = new Map();
  function backgroundWave(el, intensity = 1) {
    if (!el) return null;
    const token = {}; waves.set(el, token);
    if (still()) { stop(el, "wave"); waves.delete(el); return null; }
    const a = animate(el, [{ transform: current(el).transform, transformOrigin: "50% 50%" },
      { transform: `scale(${(1 + .012 * intensity).toFixed(3)},${(1 + .006 * intensity).toFixed(3)})`, transformOrigin: "50% 50%" }],
      { dur: dur("place") * .65, channel: "wave", fill: "forwards", noOvershoot: true, carryMin: .0001 });
    done(a).then(ok => {
      if (!ok || waves.get(el) !== token) return;
      const release = animate(el, [{ transform: current(el).transform, transformOrigin: "50% 50%" },
        { transform: "none", transformOrigin: "50% 50%" }], { dur: dur("place") * 1.5, channel: "wave", noOvershoot: true, carryMin: .0001 });
      done(release).then(() => { if (waves.get(el) === token) waves.delete(el); });
    });
    return a;
  }
  const releaseWaves = () => { if (still()) for (const el of waves.keys()) { stop(el, "wave"); waves.delete(el); } };
  new MutationObserver(releaseWaves).observe(root, { attributes: true, attributeFilter: ["data-motion"] });
  mq.addEventListener?.("change", releaseWaves);
  // The receiving surface gently yields toward the file, then absorbs the drop and returns to rest.
  // Retarget the same transform channel; repeated drag events never restart an unchanged target.
  const drops = new Map();
  function dropSurface(el, phase, x, y) {
    if (!el) return null;
    const r = el.getBoundingClientRect(), norm = (p, start, size) => p == null ? 0 : Math.max(-1, Math.min(1, (p - start) / Math.max(1, size) * 2 - 1));
    const nx = norm(x, r.left, r.width), ny = norm(y, r.top, r.height);
    const transform = phase === "over" ? `translate(${(nx * 2).toFixed(1)}px,${(-2 + ny * .8).toFixed(1)}px) scale(1.006,1.012)` : phase === "drop" ? "translate(0px,1px) scale(1.008,0.99)" : "none";
    if (drops.get(el) === phase + transform) return null;
    drops.set(el, phase + transform);
    const a = animate(el, [{ transform: current(el).transform }, { transform }], { dur: phase === "drop" ? 90 : "spring", channel: "drop", fill: phase === "over" || phase === "drop" ? "forwards" : undefined, noOvershoot: true, carryMin: .0001 });
    if (phase === "drop") done(a).then(ok => { if (ok && drops.get(el) === phase + transform) dropSurface(el, "rest"); });
    return a;
  }
  const releaseDrops = () => { if (reduced()) for (const el of drops.keys()) dropSurface(el, "rest"); };
  new MutationObserver(releaseDrops).observe(root, { attributes: true, attributeFilter: ["data-motion"] });
  mq.addEventListener?.("change", releaseDrops);
  // Progress is secondary motion: one shared bounded clock, not a monitor-rate tween per reporting job.
  const barBudget = window.__renderBudget || P?.__renderBudget, barMotions = new Map();
  const barNow = () => barBudget===P?.__renderBudget ? P.performance.now() : performance.now();
  let barClock = null;
  function finishBar(el, motion) {
    motion.t.progress(1);motion.t.kill();barMotions.delete(el);
  }
  function finishBars() {
    for(const [el,motion] of barMotions)finishBar(el,motion);
    barClock?.stop();
  }
  function stepBars(now) {
    if(still()||window.__ui?.away||!barBudget.visible||!barBudget.focused){finishBars();return;}
    for(const [el,motion] of barMotions){
      if(!el.isConnected){motion.t.kill();barMotions.delete(el);continue;}
      motion.t.time(Math.min(motion.d,(now-motion.start)/1000));
      if(motion.t.progress()>=1)finishBar(el,motion);
    }
    if(!barMotions.size)barClock.stop();
  }
  const releaseBarBudget=barBudget?.subscribe(()=>{if(!barBudget.visible||!barBudget.focused||barBudget.reduced)finishBars();});
  window.__ui?.onAway(finishBars);
  addEventListener('pagehide',()=>{finishBars();barClock?.dispose();releaseBarBudget?.();},{once:true});
  // The fill keeps exact progress. Subpixel changes need no interpolating animation.
  function bar(el, p) {
    if (!el) return;
    const v = Math.max(0, Math.min(1, +p || 0)), was = el.dataset.v != null ? +el.dataset.v : parseFloat(el.style.getPropertyValue("--v")) || 0;
    if(el.dataset.gs && v === was) return;
    const width=el.offsetWidth; // Read before changing style/data; no geometry reads in stepBars.
    el.style.setProperty("--v", String(v)); el.dataset.v = String(v);
    if (!el.dataset.gs) { el.dataset.gs = "1"; el.style.transition = "none"; G.set(el, { x: 0, xPercent: (was - 1) * 100 }); }
    if (still() || window.__ui?.away || (barBudget&&(!barBudget.visible||!barBudget.focused)) || !width || Math.abs(v-was)*width<1) { barMotions.delete(el);if(!barMotions.size)barClock?.stop();G.killTweensOf(el, "xPercent"); G.set(el, { xPercent: (v - 1) * 100 }); return; }
    log(el);
    const prev = el._bar, d = dur("spring") / 1000, x0 = G.getProperty(el, "xPercent"), x1 = (v - 1) * 100;
    let v0 = 0;
    if (prev && (prev.t.isActive()||barMotions.has(el)) && x1 !== x0) { v0 = (prev.x1 - prev.x0) * slope(prev.e, prev.t.progress()) / prev.d * d / (x1 - x0); v0 = isFinite(v0) ? Math.max(-8, Math.min(24, v0)) : 0; }
    const e = spring(v0);
    if(barMotions.has(el))prev.t.kill();
    el._bar = { t: G.fromTo(el, { xPercent: x0 }, { xPercent: x1, duration: d, ease: e, overwrite: "auto",paused:!!barBudget }), x0, x1, e, d,start:barNow() };
    if(barBudget){barMotions.set(el,el._bar);if(!barClock)barClock=barBudget.add(stepBars,{fps:30});barClock.start();}
  }
  // Skeleton: the shape of what is coming, crossed by a slow light, until it is there
  function skeleton(el, on) { if (el) el.classList.toggle("skel", !!on); }
  // Slides an indicator (the dock pill, a segmented pill) to line up with a target, on the spring and with the speed it
  // already had (fast clicks carry it on); placed at once the first time
  function glide(ind, x, y, first) {
    if (first || still() || !ind.offsetWidth) { G.killTweensOf(ind, "x,y"); ind._gl = null; G.set(ind, { x, y }); return; }
    log(ind);
    const x0 = G.getProperty(ind, "x"), y0 = G.getProperty(ind, "y"), prev = ind._gl, d = dur("spring") / 1000;
    let v0 = 0;
    if (prev && prev.t.isActive()) {
      const p = prev.t.progress(), k = Math.abs(y - y0) >= Math.abs(x - x0) ? "y" : "x", dist = (k === "y" ? y - y0 : x - x0);
      if (dist) v0 = (prev.to[k] - prev.from[k]) * slope(prev.e, p) / prev.d * d / dist;
      v0 = isFinite(v0) ? Math.max(-8, Math.min(24, v0)) : 0;
    }
    const e = spring(v0);
    ind._gl = { t: G.fromTo(ind, { x: x0, y: y0 }, { x, y, duration: d, ease: e, overwrite: "auto" }), from: { x: x0, y: y0 }, to: { x, y }, e, d };
  }
  function slideTo(ind, target, o = {}) {
    if (!ind || !target) return;
    const pr = ind.offsetParent ? ind.offsetParent.getBoundingClientRect() : { top: 0, left: 0 }, r = target.getBoundingClientRect();
    // relative to the parent's padding box, where the indicator is positioned (a bordered parent, the dock)
    const y = o.y != null ? o.y : r.top - pr.top - (ind.offsetParent ? ind.offsetParent.clientTop : 0) + r.height / 2 - ind.offsetHeight / 2, x = o.x != null ? o.x : 0;
    glide(ind, x, y, !ind.dataset.placed);
    ind.dataset.placed = "1";
  }
  // Segmented control (.tabs, .ltabs): one pill (.seg-pill) under the selected option. It is placed from the
  // option's layout box inside its own container (offsets, so a dialog scaling in or a pressed option does not
  // skew it) and placed again whenever the container or an option changes size (window, fonts, language) or the
  // selection changes. It slides with transform on the spring (GSAP); its size is set at once (only transform animates).
  const SEG_ON = '[aria-selected="true"],[aria-checked="true"]';
  function segmented(box) {
    if (!box || box.__seg) return box && box.__seg;
    const pill = document.createElement("span");
    pill.className = "seg-pill"; pill.setAttribute("aria-hidden", "true");
    box.prepend(pill);
    const opts = () => [...box.children].filter(c => c !== pill);
    const place = () => {
      const on = opts().find(c => c.matches(SEG_ON));
      if (!on || !on.offsetWidth) { if (!pill.hidden) pill.hidden = true; return; }
      const first = pill.hidden || !pill.dataset.placed;
      if (pill.hidden) pill.hidden = false;
      pill.style.width = on.offsetWidth + "px"; pill.style.height = on.offsetHeight + "px";
      glide(pill, on.offsetLeft, on.offsetTop, first);
      pill.dataset.placed = "1";
    };
    const ro = new ResizeObserver(place);
    const watch = () => { ro.disconnect(); ro.observe(box); opts().forEach(o => ro.observe(o)); };
    new MutationObserver(ms => { ms = ms.filter(m => m.target !== pill); if (!ms.length) return; if (ms.some(m => m.type === "childList" && m.target === box)) watch(); place(); })
      .observe(box, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["aria-selected", "aria-checked", "hidden"] });
    watch();
    if (document.fonts) { document.fonts.ready.then(place); document.fonts.addEventListener("loadingdone", place); }
    window.addEventListener("resize", place);
    place();
    return (box.__seg = { place, pill });
  }
  const segmentAll = (root = document) => root.querySelectorAll(".tabs,.ltabs").forEach(segmented);
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => segmentAll()); else segmentAll();

  // Settings → "Reduce animations": applies to this window and the frames already loaded
  function setReduce(on) {
    const v = on ? "reduce" : "";
    const apply = doc => { try { if (v) doc.documentElement.dataset.motion = v; else delete doc.documentElement.dataset.motion; } catch (e) {} };
    apply(document);
    document.querySelectorAll("iframe").forEach(f => { try { if (f.contentDocument) apply(f.contentDocument); } catch (e) {} });
    if (on) {
      document.getAnimations().forEach(a => { try { a.finish(); } catch (e) { a.cancel(); } });
      G.globalTimeline.getChildren(true, true, false).forEach(t => t.progress(1));
    }
  }

  // stagger(els, fn): calls fn(el, delay) with the delay of each item of a group that arrives together
  const stagger = (els, fn, max = 12) => [...els].forEach((el, i) => fn(el, Math.min(i, max) * dur("stagger")));

  window.__motion = { busy, gsap: G, reduced, animate, stop, fadeIn, fadeOut, scaleIn, show, hide, pop, openPopover, closePopover, dialog, flip, list, after, details, toggle, autoDetails, swap, welcomeFlow, backgroundWave, dropSurface, bar, skeleton, slideTo, reveal, enter, segmented, segmentAll, setReduce, dur, stagger, spring };
})();
