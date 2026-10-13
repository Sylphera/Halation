// Before / after comparator shared by Upscale and the Cutout dialog: window.__compare(root, o).
// Markup inside `root` (the element that receives the pointer): .layer.before and .layer.after, each with one
// picture (img or canvas), a .div divider with a knob and an optional .zoom label. Both pictures share one zoom
// and pan; "after" shows on the right of the divider. Wheel zooms at the cursor, dragging pans, dragging the
// divider (or ←/→ on it) moves it, a double-click fits the picture again.
//   o.stage        element whose box the picture fits in (default: root)
//   o.zoomText(p)  text of the zoom label for p % (100 %: one picture pixel per screen pixel)
//   o.claim(e)     true when a pointerdown belongs to the page (a brush), not to panning
//   o.preserveViewOnResize  keep pixel scale and the viewed centre when the stage changes size
(() => {
"use strict";
const clampN = (v, a, b) => Math.min(b, Math.max(a, v));
function compare(root, o = {}) {
  const M = window.__motion, stage = o.stage || root, div = root.querySelector(".div");
  const st = { on: false, w: 0, h: 0, x: 0.5, z: 1, tx: 0, ty: 0, bw: 0, bh: 0 };
  if (div) {
    div.dataset.def = "50"; div.dataset.i18nTitle = "common.dblReset";
    if (window.t) div.title = window.t("common.dblReset");
  }
  const notify = commit => { if (div) { div.dispatchEvent(new Event("input", { bubbles: true })); if (commit) div.dispatchEvent(new Event("change", { bubbles: true })); } };
  const pics = () => [...root.querySelectorAll(".layer > img, .layer > canvas, .layer > .matte")];
  function apply() {
    const tr = `translate(${st.tx}px,${st.ty}px) scale(${st.z})`;
    for (const p of pics()) { p.style.width = st.bw + "px"; p.style.height = st.bh + "px"; p.style.transform = tr; }
    const pct = (st.x * 100).toFixed(2) + "%";
    root.querySelector(".layer.after").style.clipPath = `inset(0 0 0 ${pct})`;
    if (div) {
      div.style.left = pct; div.setAttribute("aria-valuenow", String(Math.round(st.x * 100)));
      // the knob stays whole inside the frame when the line reaches an edge
      const W = div.parentElement.clientWidth, px = st.x * W;
      div.style.setProperty("--kx", Math.round(clampN(px, 12, Math.max(12, W - 12)) - px) + "px");
    }
    const z = root.querySelector(".zoom");
    if (z && o.zoomText) z.textContent = o.zoomText(Math.round(st.z * st.bw / st.w * (window.devicePixelRatio || 1) * 100));
    if (o.onChange) o.onChange();
  }
  // fit: the whole picture inside the stage, centred; animated: the zoom glides back (double-click)
  function fit(animated) {
    if (!st.on) return;
    const from = pics().map(p => p.style.transform);
    const r = stage.getBoundingClientRect(), s = Math.min(r.width / st.w, r.height / st.h);
    box = r;
    st.bw = st.w * s; st.bh = st.h * s; st.z = 1;
    st.tx = (r.width - st.bw) / 2; st.ty = (r.height - st.bh) / 2;
    apply();
    if (animated) pics().forEach((p, k) => { if (from[k] && from[k] !== p.style.transform) M.animate(p, [{ transform: from[k] }, { transform: p.style.transform }], { dur: "spring", channel: "move" }); });
  }
  // a picture larger than the stage can be moved up to its edges; a smaller one stays centred
  function clampPan() {
    const r = stage.getBoundingClientRect(), w = st.bw * st.z, h = st.bh * st.z;
    st.tx = w <= r.width ? (r.width - w) / 2 : clampN(st.tx, r.width - w, 0);
    st.ty = h <= r.height ? (r.height - h) / 2 : clampN(st.ty, r.height - h, 0);
  }
  // Moves the divider (0…1); animated for a change the user did not drag
  function setX(x, animated) {
    const from = st.x; st.x = clampN(x, 0, 1); apply();
    if (animated && div && Math.abs(from - st.x) > 0.001) {
      const r = stage.getBoundingClientRect(), dx = (from - st.x) * r.width;
      M.animate(div, [{ transform: `translateX(${dx}px)` }, { transform: "none" }], { dur: "spring", channel: "move" });
    }
  }
  // Screen point → picture pixel (in the picture's own w×h)
  function toPicture(cx, cy) {
    const r = stage.getBoundingClientRect(), k = st.w / (st.bw * st.z);
    return [(cx - r.left - st.tx) * k, (cy - r.top - st.ty) * k];
  }
  root.addEventListener("wheel", e => {
    if (!st.on) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
    const z = clampN(st.z * Math.exp(-e.deltaY * 0.0015), 1, 32), k = z / st.z;
    st.tx = cx - (cx - st.tx) * k; st.ty = cy - (cy - st.ty) * k; st.z = z;
    clampPan(); apply();
  }, { passive: false });
  root.addEventListener("pointerdown", e => {
    if (!st.on || (e.button !== 0 && e.button !== 1)) return;
    const onDiv = div && e.target.closest(".div") === div;
    if (!onDiv && e.button === 0 && o.claim && o.claim(e)) return;
    const r = stage.getBoundingClientRect();
    e.preventDefault(); (onDiv ? div : root).setPointerCapture(e.pointerId);
    const x0 = e.clientX, y0 = e.clientY, tx0 = st.tx, ty0 = st.ty;
    if (!onDiv) root.classList.add("panning");
    const move = ev => {
      if (onDiv) st.x = clampN((ev.clientX - r.left) / r.width, 0, 1);
      else { st.tx = tx0 + ev.clientX - x0; st.ty = ty0 + ev.clientY - y0; clampPan(); }
      apply();
      if (onDiv) notify(false);
    };
    const up = () => { root.classList.remove("panning"); root.removeEventListener("pointermove", move); root.removeEventListener("pointerup", up); root.removeEventListener("pointercancel", up); if (onDiv) notify(true); };
    root.addEventListener("pointermove", move); root.addEventListener("pointerup", up); root.addEventListener("pointercancel", up);
  });
  root.addEventListener("dblclick", e => {
    if (!st.on) return;
    if (div && e.target.closest(".div")) { setX(0.5); notify(true); }
    else fit(true);
  });
  if (div) div.addEventListener("keydown", e => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault(); st.x = clampN(st.x + (e.key === "ArrowRight" ? 0.02 : -0.02), 0, 1); apply();
    notify(true);
  });
  let box = stage.getBoundingClientRect();
  new ResizeObserver(() => {
    const next = stage.getBoundingClientRect();
    if (st.on) {
      if (o.preserveViewOnResize) {
        st.tx += (next.width - box.width) / 2; st.ty += (next.height - box.height) / 2;
        apply();
      } else fit();
    }
    box = next;
  }).observe(stage);
  return {
    st, fit, apply, setX, toPicture,
    // w×h: the pictures' own size (the after one may be a smaller working canvas: it is stretched the same)
    open(w, h, x = 0.5) { st.on = true; st.w = w; st.h = h; st.x = x; fit(); },
    close() { st.on = false; }
  };
}
window.__compare = compare;
})();
