"use strict";
// Remove Background: one promptable segmentation (Cutout's SAM 2.1 model) and three ways to steer it. Automatic
// proposes the subject, the Magic wand adds points (background, or with Alt the subject), the Background brush
// adds strokes; all of them build the same mask, decoded again at each change. Remove is the only thing that
// removes anything: a final pass at a higher resolution with the edge refined on the picture.
(() => {
"use strict";
__i18n.apply(document);
__icons.apply(document);
const { $, setStatus } = window.__ui;
const HAL = window.__hal || (window.parent && window.parent.__hal) || null;
const M = window.__motion, IMG = window.__img;
const t = window.t;
document.body.dataset.drop = t("rb.drop");

/* ===== state ===== */
// R: the picture and everything done to it. Work buffers are at most WORK pixels on the longer side (ws: work
// scale); the saved result is made at the picture's full size from them.
//   pix     the picture's RGBA at work size          alpha  what is kept (255) and removed (0), Uint8Array
//   sam     the picture encoded by the model (HAL.samEmbed's handle), null until the first prompt
//   points  the prompts [{ x, y, label, auto?, stroke? }] (fractions of the picture; label 1 subject, 0 background)
//   logits  the model's last answer (256 × 256 Float32Array: > 0 subject), or null
//   paint   the brush's background strokes (canvas, alpha = painted)   keep: its subject strokes
//   sel     the selection shown in blue (0…255), after the settings; null when there is none
const WORK = 1600, HISTORY = 30, MAXPTS = 32;
const DEF = { mode: "auto", intensity: 50, threshold: 50, feather: 1, shift: 0, clean: 50, islands: 0.2, size: 60, btool: "fg", bg: "checker", color: "", format: "png" };
const opts = { ...DEF };
const R = { src: null, W: 0, H: 0, ws: 1, pix: null, alpha: null, sam: null, points: [], logits: null, autoOn: false, paint: null, keep: null, sel: null, undo: [], redo: [], busy: false, hold: false, mask: false, applied: 0 };
const up = {};   // functions of lower sections filled by higher ones
const cmp = window.__compare($("#cmp"), {
  stage: $("#stage"),
  zoomText: p => t("up.zoom", { pct: p }),
  claim: () => !!R.src && !R.busy && !spaceDown && (opts.mode === "wand" || opts.mode === "brush"),
  onChange: () => up.placeRing && up.placeRing()
});
let spaceDown = false;
const saveOpts = () => { if (HAL) HAL.invoke("state_set", { key: "removebg", value: opts }).catch(() => {}); };

/* ===== select ===== */
// The model's answer as background probability per work pixel (0…1), then the shared settings: intensity (how far
// the background reaches into the subject's edge), threshold (how hard that edge is), the brush's strokes (always
// what they say), small islands, contract / expand, feather.
const clamp01 = v => v < 0 ? 0 : v > 1 ? 1 : v;
// intensity 50 cuts at logit 0; 0…100 moves the cut by ±6. threshold 0…100: from a soft to a hard edge
const cut = () => ({ bias: (opts.intensity - 50) / 50 * 6, temp: 0.05 + (1 - opts.threshold / 100) * 2 });
function samSel() {
  const { W, H } = R, v = new Float32Array(W * H), painted = paintedPixels(), kept = keptPixels();
  if (!R.logits && !painted) return null;
  if (R.logits) {
    const l = upLogits(R.logits, W, H), { bias, temp } = cut();
    for (let i = 0; i < v.length; i++) v[i] = 1 / (1 + Math.exp((l[i] - bias) / temp));
  }
  if (painted) for (let p = 0; p < v.length; p++) if (painted[p]) v[p] = 1;
  if (kept) for (let p = 0; p < v.length; p++) if (kept[p]) v[p] = 0;
  return v;
}
// The brush canvases change only through strokes, clear and restore. Reuse their committed alpha for undo and
// selection instead of forcing a full canvas readback on every pointerdown and slider update.
let paintData = null, keepData = null;
function canvasAlpha(c, cache) {
  if (cache && cache.canvas === c) return cache;
  const a = c.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, R.W, R.H).data, alpha = new Uint8Array(R.W * R.H);
  for (let p = 0; p < alpha.length; p++) alpha[p] = a[p * 4 + 3];
  return { canvas: c, alpha, mask: null };
}
function maskOf(d) {
  if (!d.mask) {
    const m = new Uint8Array(d.alpha.length); let any = false;
    for (let p = 0; p < m.length; p++) if (d.alpha[p] > 127) { m[p] = 1; any = true; }
    d.mask = m; d.any = any;
  }
  return d.any ? d.mask : null;
}
function paintAlpha() { return (paintData = canvasAlpha(R.paint, paintData)).alpha; }
function keepAlpha() { return (keepData = canvasAlpha(R.keep, keepData)).alpha; }
function paintedPixels() { paintAlpha(); return maskOf(paintData); }
function keptPixels() { keepAlpha(); return maskOf(keepData); }
function clearPaint() {
  R.paint.getContext("2d").clearRect(0, 0, R.W, R.H);
  R.keep.getContext("2d").clearRect(0, 0, R.W, R.H);
  paintData = { canvas: R.paint, alpha: new Uint8Array(R.W * R.H), mask: null };
  keepData = { canvas: R.keep, alpha: new Uint8Array(R.W * R.H), mask: null };
}
// Small islands: bits of the picture left alone in the background (smaller than `islands` % of it) join the selection
function islands(v) {
  const { W, H, alpha } = R, N = W * H, minA = opts.islands / 100 * N;
  if (minA < 1) return v;
  const seen = new Uint8Array(N), q = new Int32Array(N), kept = p => alpha[p] > 127 && v[p] < 0.5;
  for (let s = 0; s < N; s++) {
    if (seen[s] || !kept(s)) continue;
    let head = 0, tail = 0; q[tail++] = s; seen[s] = 1;
    while (head < tail) {
      const p = q[head++], x = p % W;
      let n;
      if (x > 0 && !seen[n = p - 1] && kept(n)) { seen[n] = 1; q[tail++] = n; }
      if (x < W - 1 && !seen[n = p + 1] && kept(n)) { seen[n] = 1; q[tail++] = n; }
      if (p >= W && !seen[n = p - W] && kept(n)) { seen[n] = 1; q[tail++] = n; }
      if (p < N - W && !seen[n = p + W] && kept(n)) { seen[n] = 1; q[tail++] = n; }
    }
    if (tail < minA) for (let k = 0; k < tail; k++) v[q[k]] = 1;
  }
  return v;
}
// The background probability `raw` after islands, contract / expand and feather, as 0…255 (null: nothing selected)
function finish(raw) {
  const v = islands(raw), { W, H } = R, c = IMG.mk(W, H), x = c.getContext("2d", { willReadFrequently: true }), d = x.createImageData(W, H);
  for (let p = 0; p < v.length; p++) { const i = p * 4; d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; d.data[i + 3] = Math.round(v[p] * 255); }
  x.putImageData(d, 0, 0);
  // + grows the picture, so the selection shrinks
  const m = HAL.refineMask(c, { shift: -opts.shift * R.ws, feather: opts.feather * R.ws });
  const a = m.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data, out = new Uint8Array(W * H);
  let any = 0;
  for (let p = 0; p < out.length; p++) { out[p] = a[p * 4 + 3]; if (out[p] > 127 && R.alpha[p]) any++; }
  R.selCount = any;
  return out;
}
// The selection shown while editing: the model's answer at 256 × 256 stretched to the work size
function compute() {
  if (!R.src) return null;
  const raw = samSel();
  return raw ? finish(raw) : null;
}

// Selection is independent of the DOM. Keep the same algorithm in a local worker: only the latest
// requested settings matter, and unchanged source buffers stay there until the picture changes.
let selector = null, selectorFailed = false, workerSource = null, workerAlpha = null, workerLogits = null, workerPaint = null, workerKeep = null;
let alphaVersion = 0, workerAlphaVersion = -1, requestedSelection = 0, completedSelection = 0, selecting = null;
let selectionBitmap = null, bitmapSelection = null, bitmapAlpha = null;
function dropSelectionBitmap() { selectionBitmap?.close(); selectionBitmap = bitmapSelection = bitmapAlpha = null; }
function selectionWorker() {
  if (selector || selectorFailed) return selector;
  if (!window.Worker || !window.OffscreenCanvas) { selectorFailed = true; return null; }
  const code = `"use strict"; let R = {}, opts = {};
    const mk = (w,h) => new OffscreenCanvas(Math.max(1,Math.round(w)),Math.max(1,Math.round(h)));
    const IMG = { mk }; ${IMG.blurAlpha.toString()} ${IMG.refineMask.toString()} const upLogits = ${IMG.upLogits.toString()};
    const HAL = { refineMask }; const clamp01 = ${clamp01.toString()}, cut = ${cut.toString()};
    ${[samSel, islands, finish, compute].map(f => f.toString()).join("\n")}
    function paintedPixels() { return R.paintedMask; }
    function keptPixels() { return R.keptMask; }
    let overlay;
    onmessage = e => {
      if (e.data.reset) { R = {}; overlay = null; return; }
      try {
        Object.assign(R,e.data.state); opts = e.data.options;
        const sel = compute(); let bitmap = null;
        if (sel) {
          if (!overlay || overlay.width !== R.W || overlay.height !== R.H) overlay = mk(R.W,R.H);
          const x = overlay.getContext("2d"), d = x.createImageData(R.W,R.H), [r,g,b] = e.data.blue;
          for (let p=0;p<sel.length;p++) { if (!sel[p] || !R.alpha[p]) continue; const i=p*4;
            d.data[i]=r; d.data[i+1]=g; d.data[i+2]=b; d.data[i+3]=sel[p]*R.alpha[p]/510; }
          x.putImageData(d,0,0); bitmap = overlay.transferToImageBitmap();
        }
        postMessage({sel,count:sel ? R.selCount : 0,bitmap},[...(sel ? [sel.buffer] : []),...(bitmap ? [bitmap] : [])]);
      } catch (error) { postMessage({error:String(error.stack || error)}); }
    };`;
  const url = URL.createObjectURL(new Blob([code], { type: "text/javascript" }));
  try { selector = new Worker(url); } catch (error) { selectorFailed = true; console.warn("Selection worker unavailable", error); }
  finally { URL.revokeObjectURL(url); }
  return selector;
}
const upLogits = IMG.upLogits;
function workerSelection(worker, packet) {
  return new Promise((resolve, reject) => {
    worker.onmessage = e => e.data.error ? reject(new Error(e.data.error)) : resolve(e.data);
    worker.onerror = e => reject(new Error(e.message));
    worker.postMessage(packet);
  });
}
function resetSelectionBuffers() {
  workerSource = workerAlpha = workerLogits = workerPaint = workerKeep = null; workerAlphaVersion = -1;
  selector?.postMessage({ reset: true });
  dropSelectionBitmap(); selectionView = selectionOf = selectionAlpha = strokeTint = null;
}
async function updateSelection() {
  while (completedSelection !== requestedSelection) {
    const revision = requestedSelection, source = R.src, alpha = R.alpha, version = alphaVersion;
    const needed = source && (R.logits || R.painted);
    const worker = needed ? selectionWorker() : null;
    let result;
    if (worker) {
      const state = {};
      if (workerSource !== source) { Object.assign(state, { src: true, W: R.W, H: R.H, ws: R.ws }); workerSource = source; workerAlpha = workerLogits = workerPaint = workerKeep = null; workerAlphaVersion = -1; }
      if (workerAlpha !== alpha || workerAlphaVersion !== version) { state.alpha = alpha; workerAlpha = alpha; workerAlphaVersion = version; }
      if (workerLogits !== R.logits) { state.logits = R.logits; workerLogits = R.logits; }
      const painted = paintedPixels(), kept = keptPixels();
      if (workerPaint !== painted) { state.paintedMask = painted; workerPaint = painted; }
      if (workerKeep !== kept) { state.keptMask = kept; workerKeep = kept; }
      try { result = await workerSelection(worker, { state, options: { ...opts }, blue: blueRGB() }); }
      catch (error) {
        console.warn("Selection worker failed; using canvas fallback", error);
        worker.terminate(); selector = null; selectorFailed = true;
        continue;
      }
    } else result = { sel: needed ? compute() : null, count: needed ? R.selCount : 0, bitmap: null };
    completedSelection = revision;
    if (source !== R.src || alpha !== R.alpha || version !== alphaVersion) { result.bitmap?.close(); continue; }
    dropSelectionBitmap(); R.sel = result.sel; R.selCount = result.count;
    selectionBitmap = result.bitmap; bitmapSelection = R.sel; bitmapAlpha = R.alpha;
    paintOver(); sync();
  }
}
function startSelection() {
  if (!selecting) selecting = updateSelection().finally(() => { selecting = null; });
  return selecting;
}
async function selectionIdle() {
  await decodeIdle();
  if (raf) { cancelAnimationFrame(raf); raf = 0; }
  do { await startSelection(); } while (completedSelection !== requestedSelection);
}
window.addEventListener("beforeunload", () => { selector?.terminate(); dropSelectionBitmap(); });

/* ===== model ===== */
// The picture is encoded once (busy while it runs); each change of the prompts is decoded against it with the last
// answer, the latest prompts winning when they change faster than the model answers.
let embedding = null;
async function ensureSam(offer) {
  if (!R.src || !HAL) return null;
  if (R.sam) return R.sam;
  if (!(await HAL.cutoutReady())) {
    if (!offer || !(await HAL.cutoutEnsure())) { setStatus(t("rb.st.needModel"), "warn"); return null; }
  }
  const mine = R.src;
  if (!embedding) embedding = (async () => {
    busy(true, t("rb.reading"));
    try {
      const h = await HAL.samEmbed(mine.blob, { decoded: mine.img, job: { tool: "removebg", title: mine.name || "" } });
      if (R.src === mine) R.sam = h;
      return R.src === mine ? h : null;
    } catch (e) {
      if (R.src === mine) setStatus(t("cut.failed", { error: String(e && e.message || e) }), "bad");
      return null;
    } finally { embedding = null; if (R.src === mine) busy(false); }
  })();
  return embedding;
}
let wantDecode = 0, doneDecode = 0, decoding = null, hint = null;
// prompts changed: decode them (hint: logits to send instead of the last answer, the brush's strokes painted in)
function redecode(h) {
  wantDecode++; if (h) hint = h;
  HAL?.session?.schedule("removebg");
  sync();
  if (!decoding) decoding = decodeLoop().finally(() => { decoding = null; });
  return decoding;
}
async function decodeLoop() {
  while (doneDecode !== wantDecode) {
    const rev = wantDecode, mine = R.src, pts = R.points.slice(), h = hint; hint = null;
    if (!pts.length) { doneDecode = rev; if (!R.painted) R.logits = null; refresh(); continue; }
    const sam = await ensureSam(true);
    if (!sam || R.src !== mine) { doneDecode = rev; refresh(); return; }
    try {
      const r = await HAL.samDecode(sam, pts, { prev: R.logits, hint: h });
      if (R.src !== mine) return;
      R.logits = r.logits;
    } catch (e) {
      if (R.src === mine) setStatus(t("cut.failed", { error: String(e && e.message || e) }), "bad");
    }
    doneDecode = rev;
    refresh();
  }
}
async function decodeIdle() { while (decoding) await decoding; }
// New prompts (the oldest go past MAXPTS, Automatic's last)
const hasSubject = () => R.points.some(p => p.label === 1);
function addPoints(list) {
  R.points = R.points.concat(list);
  while (R.points.length > MAXPTS) { const i = R.points.findIndex(p => !p.auto); R.points.splice(i < 0 ? 0 : i, 1); }
}

/* ===== view ===== */
// The result (or its mask) in #view, the selection in blue in #over, both at work size
function cleanEdges(d, a, W, H, radius) {
  // Colour cleanup: half-transparent edge pixels take the colour of the solid picture next to them, so the old
  // background does not tint the edge (amount: opts.clean)
  const k = opts.clean / 100; if (k <= 0) return;
  let partial = false;
  for (let p = 0; p < a.length; p++) if (a[p] > 0 && a[p] < 250) { partial = true; break; }
  if (!partial) return;
  const solid = IMG.mk(W, H), sx = solid.getContext("2d"), sd = sx.createImageData(W, H);
  for (let p = 0; p < W * H; p++) { const i = p * 4; if (a[p] >= 240) { sd.data[i] = d[i]; sd.data[i + 1] = d[i + 1]; sd.data[i + 2] = d[i + 2]; sd.data[i + 3] = 255; } }
  sx.putImageData(sd, 0, 0);
  const b = IMG.mk(W, H), bx = b.getContext("2d", { willReadFrequently: true });
  bx.filter = `blur(${radius}px)`; bx.drawImage(solid, 0, 0); bx.filter = "none";
  const bd = bx.getImageData(0, 0, W, H).data;
  for (let p = 0; p < W * H; p++) {
    const av = a[p]; if (av === 0 || av >= 250) continue;
    const i = p * 4; if (!bd[i + 3]) continue;
    const f = k * (1 - av / 255);
    d[i] += (bd[i] - d[i]) * f; d[i + 1] += (bd[i + 1] - d[i + 1]) * f; d[i + 2] += (bd[i + 2] - d[i + 2]) * f;
  }
}
function paintView() {
  if (!R.src) return;
  const { W, H, pix, alpha } = R, v = $("#view"), x = v.getContext("2d"), d = x.createImageData(W, H);
  if (R.mask) for (let p = 0; p < W * H; p++) { const i = p * 4; d.data[i] = d.data[i + 1] = d.data[i + 2] = alpha[p]; d.data[i + 3] = 255; }
  else {
    d.data.set(pix);
    for (let p = 0; p < W * H; p++) d.data[p * 4 + 3] = alpha[p];
    cleanEdges(d.data, alpha, W, H, Math.max(2, 4 * R.ws));
  }
  x.putImageData(d, 0, 0);
}
let blue = null, green = null;
const token = (name, fallback) => { const c = IMG.mk(1, 1).getContext("2d"); c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback; c.fillRect(0, 0, 1, 1); return [...c.getImageData(0, 0, 1, 1).data].slice(0, 3); };
const blueHex = () => "#" + blueRGB().map(v => v.toString(16).padStart(2, "0")).join("");
function blueRGB() { return blue || (blue = token("--bg-select", "#3d7dff")); }
function greenRGB() { return green || (green = token("--fg-select", "#5fd3a0")); }
// The selection at half opacity where something is still there; while painting, the strokes on top of it; the
// wand's points as dots (blue: background, green: subject)
let selectionView = null, selectionOf = null, selectionAlpha = null, strokeTint = null;
function paintOver() {
  const o = $("#over"), x = o.getContext("2d");
  x.clearRect(0, 0, o.width, o.height);
  if (!R.src || R.hold) return;
  if (R.sel) {
    if (selectionBitmap && bitmapSelection === R.sel && bitmapAlpha === R.alpha) x.drawImage(selectionBitmap, 0, 0);
    else {
    const { W, H, alpha } = R;
    const cached = R.stroking;
    if (cached && (!selectionView || selectionView.width !== W || selectionView.height !== H)) { selectionView = IMG.mk(W, H); selectionOf = null; }
    if (!cached || selectionOf !== R.sel || selectionAlpha !== alpha) {
      const sx = cached ? selectionView.getContext("2d") : x, d = sx.createImageData(W, H), [r, g, b] = blueRGB();
      for (let p = 0; p < W * H; p++) { const s = R.sel[p]; if (!s || !alpha[p]) continue; const i = p * 4; d.data[i] = r; d.data[i + 1] = g; d.data[i + 2] = b; d.data[i + 3] = s * alpha[p] / 510; }
      sx.putImageData(d, 0, 0); selectionOf = cached ? R.sel : null; selectionAlpha = cached ? alpha : null;
    }
    if (cached) x.drawImage(selectionView, 0, 0);
    }
  } else {
    selectionOf = null; selectionAlpha = null;
  }
  // while painting, both kinds of stroke on top, each in its colour
  if (opts.mode === "brush" && R.stroking) {
    if (!strokeTint || strokeTint.width !== o.width || strokeTint.height !== o.height) strokeTint = IMG.mk(o.width, o.height);
    const tint = strokeTint, tx = tint.getContext("2d");
    for (const [c, rgb] of [[R.paint, blueRGB()], [R.keep, greenRGB()]]) {
      tx.globalCompositeOperation = "source-over"; tx.clearRect(0, 0, tint.width, tint.height);
      tx.drawImage(c, 0, 0); tx.globalCompositeOperation = "source-in"; tx.fillStyle = `rgb(${rgb.join(",")})`; tx.fillRect(0, 0, o.width, o.height);
      x.globalAlpha = 0.5; x.drawImage(tint, 0, 0); x.globalAlpha = 1;
    }
    tx.globalCompositeOperation = "source-over";
  }
  // the clicks (Automatic's and the strokes' points are not drawn: they are not the user's)
  const r = Math.max(3, Math.round(Math.max(R.W, R.H) / 220));
  for (const p of R.points) {
    if (p.auto || p.stroke) continue;
    x.beginPath(); x.arc(p.x * R.W, p.y * R.H, r, 0, Math.PI * 2);
    x.fillStyle = `rgb(${(p.label ? greenRGB() : blueRGB()).join(",")})`; x.fill();
    x.lineWidth = Math.max(1, r / 3); x.strokeStyle = "rgba(255,255,255,.9)"; x.stroke();
  }
}
let overFrame = 0;
function requestOver() { if (!overFrame) overFrame = requestAnimationFrame(() => { overFrame = 0; paintOver(); }); }
let raf = 0;
// Recomputes the selection on the next frame (sliders, a new answer of the model, the end of a stroke)
function refresh() {
  HAL?.session?.schedule("removebg");
  requestedSelection++;
  sync();
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = 0; startSelection(); });
}
function sync() {
  document.querySelectorAll("#modes [data-mode]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.mode === opts.mode)));
  document.querySelectorAll("#brushTools [data-btool]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.btool === opts.btool)));
  document.querySelectorAll("#formats [data-format]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.format === opts.format)));
  document.querySelectorAll("#bgs [data-bg]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.bg === opts.bg)));
  const st = $("#stage"); st.dataset.mode = opts.mode; st.dataset.bg = opts.bg; st.style.setProperty("--k-color", opts.color || blueHex());
  st.classList.toggle("mask", R.mask); $("#maskBtn").setAttribute("aria-pressed", String(R.mask));
  $("#toolTitle").textContent = t("rb.mode." + opts.mode);
  $("#toolNote").textContent = t("rb.note." + opts.mode);
  $("#autoRow").hidden = opts.mode !== "auto"; $("#brushRow").hidden = opts.mode !== "brush";
  $("#howRow").hidden = opts.mode === "auto";
  $("#howFg").textContent = t("rb.how." + opts.mode + "Fg"); $("#howBg").textContent = t("rb.how." + opts.mode + "Bg");
  const has = !!R.src, sel = !!R.sel && R.selCount > 0, pending = !!decoding;
  $("#applyBtn").disabled = !has || !sel || R.busy || pending;
  $("#clearSel").disabled = !has || R.busy || !(R.points.length || R.logits || R.painted);
  $("#detectBtn").disabled = !has || R.busy;
  $("#undoBtn").disabled = !R.undo.length || R.busy; $("#redoBtn").disabled = !R.redo.length || R.busy;
  for (const id of ["saveBtn", "cropBtn", "sendBtn"]) $("#" + id).disabled = !has || R.busy;
  for (const [id, fmt] of [["intensity", v => v + " %"], ["threshold", v => v + " %"], ["feather", v => v + " px"], ["shift", v => (v > 0 ? "+" : "") + v + " px"], ["clean", v => v + " %"], ["islands", v => v + " %"], ["size", v => v + " px"]]) {
    const r = $("#" + id); r.value = String(opts[id]);
    r.style.setProperty("--p", ((opts[id] - +r.min) / (+r.max - +r.min) * 100) + "%");
    $("#o" + id[0].toUpperCase() + id.slice(1)).textContent = fmt(opts[id]);
  }
}

/* ===== history ===== */
// Every change of the prompts and every Remove is one step: the kept pixels, the points, the model's answer, the strokes
function snap() {
  return { alpha: R.alpha.slice(), points: R.points.slice(), logits: R.logits, paint: paintAlpha().slice(), keep: keepAlpha().slice(), autoOn: R.autoOn, mode: opts.mode, applied: R.applied };
}
function putAlpha(c, a) {
  const x = c.getContext("2d"), d = x.createImageData(R.W, R.H);
  for (let p = 0; p < a.length; p++) { const i = p * 4; d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; d.data[i + 3] = a[p]; }
  x.putImageData(d, 0, 0);
  return { canvas: c, alpha: a, mask: null };
}
function restore(s) {
  paintData = putAlpha(R.paint, s.paint); keepData = putAlpha(R.keep, s.keep);
  R.painted = !!(paintedPixels() || keptPixels());
  // the model's answer goes back with its points (logits are never changed in place)
  wantDecode = doneDecode; hint = null;
  Object.assign(R, { alpha: s.alpha, points: s.points, logits: s.logits, autoOn: s.autoOn, applied: s.applied });
  opts.mode = s.mode;
  paintView(); refresh();
}
function push() { R.undo.push(snap()); if (R.undo.length > HISTORY) R.undo.shift(); R.redo = []; }
async function undo() { if (!R.src || R.busy || !R.undo.length) return; await decodeIdle(); R.redo.push(snap()); restore(R.undo.pop()); setStatus(t("rb.st.undone")); }
async function redo() { if (!R.src || R.busy || !R.redo.length) return; await decodeIdle(); R.undo.push(snap()); restore(R.redo.pop()); setStatus(t("rb.st.redone")); }
$("#undoBtn").addEventListener("click", undo);
$("#redoBtn").addEventListener("click", redo);

/* ===== tools ===== */
function busy(on, text) {
  R.busy = on; $("#busyText").textContent = text || "";
  M.reveal($("#busy"), on); sync(); up.placeRing();
}
// Automatic: the model's proposal (HAL.samAuto) replaces the earlier proposal; the user's points stay
async function detect(offer) {
  if (!R.src || R.busy || !HAL) return;
  const mine = R.src, sam = await ensureSam(offer);
  if (!sam || R.src !== mine) return;
  busy(true, t("cut.finding"));
  try {
    const pts = await HAL.samAuto(sam);
    if (R.src !== mine) return;
    await decodeIdle();
    push();
    R.points = R.points.filter(p => !p.auto); addPoints(pts);
    if (!R.points.some(p => !p.auto)) R.logits = pts.logits || null;   // a fresh answer, from the subject Automatic chose
    R.autoOn = true;
    busy(false); await redecode();
    setStatus(t("rb.st.detected"));
  } catch (e) {
    if (R.src === mine) setStatus(t("cut.failed", { error: String(e && e.message || e) }), "bad");
  } finally { if (R.src === mine && R.busy) busy(false); }
}
function setMode(m) {
  if (!R || R.busy || opts.mode === m) return;
  opts.mode = m; saveOpts(); sync(); paintOver(); up.placeRing();
  if (m === "auto" && R.src && !R.autoOn) detect(false);
}
$("#modes").addEventListener("click", e => { const b = e.target.closest("[data-mode]"); if (b) setMode(b.dataset.mode); });
$("#detectBtn").addEventListener("click", () => detect(true));
$("#brushTools").addEventListener("click", e => { const b = e.target.closest("[data-btool]"); if (b) { opts.btool = b.dataset.btool; saveOpts(); sync(); up.placeRing(); } });
// The shared settings: the blue selection follows them at once; nothing is removed until Remove
for (const id of ["intensity", "threshold", "feather", "shift", "clean", "islands", "size"]) {
  const r = $("#" + id);
  r.addEventListener("input", () => { opts[id] = +r.value; sync(); if (id === "clean") paintView(); else if (id !== "size") refresh(); up.placeRing(); });
  r.addEventListener("change", saveOpts);
}
async function clearSel() {
  if (!R.src || R.busy) return;
  await decodeIdle();
  push();
  R.points = []; R.logits = null; R.autoOn = false; clearPaint(); R.painted = false;
  refresh();
}
$("#clearSel").addEventListener("click", clearSel);
// Remove's final pass: where the subject takes a small part of the picture, the crop around it is encoded on its own
// (more of the model's resolution on the edge) and decoded with the same prompts; then the edge is refined on the
// picture itself (guided filter, softened guide so grain does not stick to it). → background probability (0…1)
async function finalPass() {
  const { W, H } = R;
  let l = R.logits ? upLogits(R.logits, W, H) : null;
  if (R.logits && R.points.some(p => p.label === 1)) {
    let x0 = 256, y0 = 256, x1 = -1, y1 = -1;
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) if (R.logits[j * 256 + i] > 0) { if (i < x0) x0 = i; if (i > x1) x1 = i; if (j < y0) y0 = j; if (j > y1) y1 = j; }
    if (x1 >= x0) {
      const m = 0.12, bx = Math.max(0, x0 / 256 - m), by = Math.max(0, y0 / 256 - m), box = { x: bx, y: by, w: Math.min(1, (x1 + 1) / 256 + m) - bx, h: Math.min(1, (y1 + 1) / 256 + m) - by };
      if (box.w * box.h < 0.5 && Math.max(box.w, box.h) < 0.8) {
        const c = await HAL.samCrop(R.src.img, box, R.points, R.logits);
        if (c) {
          // the crop's answer replaces the whole picture's inside the box
          const cx = Math.round(box.x * W), cy = Math.round(box.y * H), cw = Math.max(1, Math.round(box.w * W)), ch = Math.max(1, Math.round(box.h * H)), lc = upLogits(c, cw, ch);
          for (let y = 0; y < ch && cy + y < H; y++) for (let x = 0; x < cw && cx + x < W; x++) l[(cy + y) * W + cx + x] = lc[y * cw + x];
        }
      }
    }
  }
  const p = new Float32Array(W * H), painted = paintedPixels(), kept = keptPixels(), { bias, temp } = cut();
  if (l) for (let i = 0; i < p.length; i++) p[i] = 1 / (1 + Math.exp(-(l[i] - bias) / temp));
  else p.fill(1);
  if (painted) for (let i = 0; i < p.length; i++) if (painted[i]) p[i] = 0;
  if (kept) for (let i = 0; i < p.length; i++) if (kept[i]) p[i] = 1;
  const q = IMG.guidedAlpha(R.pix, W, H, p, { r: Math.max(2, Math.round(Math.max(W, H) / 270)), eps: 4e-3, smooth: 1 });
  for (let i = 0; i < q.length; i++) q[i] = 1 - q[i];
  if (painted) for (let i = 0; i < q.length; i++) if (painted[i]) q[i] = 1;
  if (kept) for (let i = 0; i < q.length; i++) if (kept[i]) q[i] = 0;
  return q;
}
// Remove: the final pass, then the selection is removed from the picture (one undo step) and a new selection starts
let applying = false;
async function apply() {
  if (applying) return;
  const source = R.src;
  applying = true;
  try {
    await selectionIdle();
    if (!R.src || R.src !== source || R.busy || !R.sel || !R.selCount) return;
    busy(true, t("rb.removing"));
    let s;
    try { s = finish(await finalPass()); }
    catch (e) { console.warn("final pass", e); s = R.sel; }
    finally { busy(false); }
    if (R.src !== source) return;
    push();
    const a = R.alpha;
    for (let p = 0; p < a.length; p++) if (s[p]) a[p] = Math.round(a[p] * (1 - s[p] / 255));
    alphaVersion++; dropSelectionBitmap();
    R.autoOn = false; R.points = []; R.logits = null; clearPaint(); R.painted = false;
    R.applied++;
    paintView(); R.sel = null; paintOver(); refresh();
    setStatus(t("rb.st.applied"), "ok");
  } finally { applying = false; }
}
$("#applyBtn").addEventListener("click", apply);
$("#bgs").addEventListener("click", e => { const b = e.target.closest("[data-bg]"); if (b) { opts.bg = b.dataset.bg; saveOpts(); sync(); } });
$("#bgColor").addEventListener("input", e => { opts.color = e.target.value; opts.bg = "color"; saveOpts(); sync(); });
$("#maskBtn").addEventListener("click", () => { R.mask = !R.mask; paintView(); sync(); });
// Before / after: held down, the original picture
function hold(on) {
  if (!R.src || R.hold === on) return;
  R.hold = on; cmp.setX(on ? 1 : 0); $("#beforeTag").hidden = !on; paintOver();
}
$("#holdBtn").addEventListener("pointerdown", e => { e.preventDefault(); hold(true); });
for (const ev of ["pointerup", "pointerleave", "pointercancel"]) $("#holdBtn").addEventListener(ev, () => hold(false));

// Wand and brush on the picture (work pixels)
const workPoint = e => { const [px, py] = cmp.toPicture(e.clientX, e.clientY); return [px * R.ws, py * R.ws]; };
const stage = $("#stage");
// A stroke adds to its own canvas and takes from the other one (a subject stroke over a background one wins)
function stroke(from, to) {
  paintData = keepData = null;
  const fg = opts.btool === "fg", r = opts.size * R.ws / 2;
  for (const [c, add] of [[R.paint, !fg], [R.keep, fg]]) {
    const x = c.getContext("2d");
    x.globalCompositeOperation = add ? "source-over" : "destination-out";
    x.strokeStyle = x.fillStyle = "#fff"; x.lineCap = "round"; x.lineJoin = "round"; x.lineWidth = r * 2;
    x.beginPath(); x.moveTo(from[0], from[1]); x.lineTo(to[0], to[1]); x.stroke();
    x.beginPath(); x.arc(to[0], to[1], r, 0, Math.PI * 2); x.fill();
    x.globalCompositeOperation = "source-over";
  }
}
// The stroke as prompts: points along its path (at most 6, at least a brush apart), and the last answer with both
// kinds of stroke painted into it (sure background / sure subject) as the model's mask input
function strokePrompts(path, label) {
  const step = Math.max(opts.size * R.ws, Math.max(R.W, R.H) * 0.03), pts = [path[0]];
  let run = 0;
  for (let i = 1; i < path.length; i++) { run += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); if (run >= step) { pts.push(path[i]); run = 0; } }
  if (pts.length > 1 || path.length > 1) pts.push(path[path.length - 1]);
  const pick = pts.length <= 6 ? pts : Array.from({ length: 6 }, (_, i) => pts[Math.round(i * (pts.length - 1) / 5)]);
  return pick.map(([x, y]) => ({ x: clamp01(x / R.W), y: clamp01(y / R.H), label, stroke: true }));
}
function strokeHint() {
  const h = R.logits ? R.logits.slice() : new Float32Array(256 * 256), c = IMG.mk(256, 256), x = c.getContext("2d", { willReadFrequently: true });
  for (const [cv, v] of [[R.paint, -20], [R.keep, 20]]) {
    x.clearRect(0, 0, 256, 256); x.drawImage(cv, 0, 0, 256, 256);
    const a = x.getImageData(0, 0, 256, 256).data;
    for (let i = 0; i < h.length; i++) if (a[i * 4 + 3] > 96) h[i] = v;
  }
  return h;
}
stage.addEventListener("contextmenu", e => { if (R.src && opts.mode === "wand") e.preventDefault(); });
stage.addEventListener("pointerdown", async e => {
  if (!R.src || (e.button !== 0 && !(e.button === 2 && opts.mode === "wand")) || R.busy || spaceDown || !["wand", "brush"].includes(opts.mode) || !e.target.closest(".cmp")) return;
  const [x, y] = workPoint(e);
  if (opts.mode === "wand") {
    const px = Math.round(x), py = Math.round(y);
    if (px < 0 || py < 0 || px >= R.W || py >= R.H) return;
    e.preventDefault();
    // a click marks the subject; a right click (or Alt+click) takes a part away from it, only once there is one
    const label = e.altKey || e.button === 2 ? 0 : 1;
    if (!label && !hasSubject()) { setStatus(t("rb.st.subjectFirst"), "bad"); return; }
    if (!(await ensureSam(true))) return;
    await decodeIdle();
    push();
    addPoints([{ x: (px + 0.5) / R.W, y: (py + 0.5) / R.H, label }]);
    paintOver(); redecode();
    return;
  }
  e.preventDefault(); stage.setPointerCapture(e.pointerId);
  push(); R.stroking = true;
  const label = opts.btool === "fg" ? 1 : 0;
  let last = [x, y]; const path = [last]; stroke(last, last); paintOver();
  const move = ev => { const p = workPoint(ev); stroke(last, p); last = p; path.push(p); requestOver(); moveRing(ev); };
  const end = async () => {
    stage.removeEventListener("pointermove", move); stage.removeEventListener("pointerup", end); stage.removeEventListener("pointercancel", end);
    R.stroking = false; R.painted = !!(paintedPixels() || keptPixels());
    if (!R.painted) clearPaint();
    refresh();
    // a background stroke refines the subject; without one it only marks what it covers
    if (!label && !hasSubject()) { setStatus(t("rb.st.subjectFirst")); return; }
    if (!(await ensureSam(true))) return;
    await decodeIdle();
    addPoints(strokePrompts(path, label));
    redecode(strokeHint());
  };
  stage.addEventListener("pointermove", move); stage.addEventListener("pointerup", end); stage.addEventListener("pointercancel", end);
});
// The brush's outline follows the pointer at its size on screen
let pointer = null;
function moveRing(e) { pointer = [e.clientX, e.clientY]; placeRing(); }
function placeRing() {
  const ring = $("#ring");
  if (!R.src || !pointer || opts.mode !== "brush" || R.busy || !cmp.st.on) { ring.hidden = true; return; }
  const r = stage.getBoundingClientRect(), dpx = opts.size * cmp.st.bw * cmp.st.z / R.src.iw;
  ring.hidden = false; ring.classList.toggle("fg", opts.btool === "fg");
  Object.assign(ring.style, { width: dpx + "px", height: dpx + "px", transform: `translate(${pointer[0] - r.left - dpx / 2}px,${pointer[1] - r.top - dpx / 2}px)` });
}
up.placeRing = placeRing;
stage.addEventListener("pointermove", moveRing);
stage.addEventListener("pointerleave", () => { pointer = null; $("#ring").hidden = true; });

// Keys: A / W / B the tools, E switches the brush between background and subject, [ ] the brush size,
// Ctrl+Z / Ctrl+Shift+Z, Enter removes, Esc clears, C held shows the original, Space held pans
window.addEventListener("keydown", e => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== "range") return;
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && (k === "z" || k === "y")) { e.preventDefault(); if (k === "y" || e.shiftKey) redo(); else undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === " ") { spaceDown = true; if (e.target === document.body) e.preventDefault(); }
  else if (k === "c" && !e.repeat) hold(true);
  else if (k === "a") setMode("auto");
  else if (k === "w") setMode("wand");
  else if (k === "b") setMode("brush");
  else if (k === "e" && opts.mode === "brush") { opts.btool = opts.btool === "fg" ? "bg" : "fg"; HAL?.session?.schedule("removebg"); sync(); placeRing(); }
  else if (e.key === "[" || e.key === "]") { opts.size = Math.max(2, Math.min(400, Math.round(opts.size * (e.key === "]" ? 1.2 : 1 / 1.2)))); HAL?.session?.schedule("removebg"); sync(); placeRing(); }
  else if (e.key === "Enter" && !e.target.closest("button")) apply();
  else if (e.key === "Escape") clearSel();
});
window.addEventListener("keyup", e => { if (e.key === " ") spaceDown = false; else if (e.key.toLowerCase() === "c") hold(false); });
window.addEventListener("blur", () => { spaceDown = false; hold(false); });

/* ===== input ===== */
// src: { path, name } for a file on disk, { blob, name } for bytes from another tab, or a File
async function sameAsOpen(blob, path) {
  const o = R.src;
  if (!o || !blob) return false;
  if (path && o.path) return path === o.path && blob.size === o.blob.size;
  if (blob === o.blob) return true;
  if (blob.size !== o.blob.size) return false;
  return (o.hash || (o.hash = await IMG.hash(o.blob))) === await IMG.hash(blob);
}
async function setInput(src) {
  if (R.busy) return;
  try {
    let blob = src.blob || (IMG.isBlob(src) ? src : null);
    const name = src.name || "image.png";
    if (!blob && src.path) blob = await HAL.fileFromPath(src.path);
    // the picture already open (sent again, opened again from Home or the Library): its work stays as it is
    if (await sameAsOpen(blob, src.path)) { setStatus(t("rb.st.kept")); return; }
    const img = await IMG.load(blob), [iw, ih] = IMG.size(img), ws = Math.min(1, WORK / Math.max(iw, ih));
    const W = Math.max(1, Math.round(iw * ws)), H = Math.max(1, Math.round(ih * ws));
    const c = IMG.mk(W, H), x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, W, H);
    const pix = x.getImageData(0, 0, W, H).data, alpha = new Uint8Array(W * H);
    for (let p = 0; p < alpha.length; p++) alpha[p] = pix[p * 4 + 3];
    if (R.src && R.src.url) URL.revokeObjectURL(R.src.url);
    const paint = IMG.mk(W, H), keep = IMG.mk(W, H);
    paint.getContext("2d", { willReadFrequently: true }); keep.getContext("2d", { willReadFrequently: true });
    paintData = { canvas: paint, alpha: new Uint8Array(W * H), mask: null };
    keepData = { canvas: keep, alpha: new Uint8Array(W * H), mask: null };
    await decodeIdle();
    Object.assign(R, { src: { img, blob, name, type: blob.type, path: src.path || null, iw, ih, url: img.__url }, W, H, ws, pix, alpha, paint, keep, sam: null, points: [], logits: null, autoOn: false, painted: false, sel: null, undo: [], redo: [], applied: 0, hold: false });
    wantDecode = doneDecode; hint = null;
    resetSelectionBuffers();
    for (const id of ["view", "over"]) { $("#" + id).width = W; $("#" + id).height = H; }
    $("#before").src = img.src;
    $("#emptyStage").hidden = true; $("#cmp").hidden = false; $("#inputInfo").hidden = false; M.reveal($("#topbar"), true);
    $("#inThumb").src = img.src; $("#inName").textContent = name; $("#inSize").textContent = `${iw}×${ih}`;
    cmp.open(iw, ih, 0);
    paintView(); paintOver(); sync();
    setStatus(t("rb.st.loaded"));
    if (HAL && HAL.recent) { const f = new File([blob], name, { type: blob.type }); if (src.path) f.__halPath = src.path; HAL.recent(f, "removebg", "image"); }
    if (HAL?.session?.restoring) return;
    // the model reads the picture at once (Automatic proposes the subject), so the first click answers at once
    if (opts.mode === "auto") detect(false);
    else if (HAL && await HAL.cutoutReady()) ensureSam(false);
  } catch (e) { setStatus(t("common.badImage"), "bad"); }
}
$("#imgIn").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) setInput(f); });
$("#browseBtn").addEventListener("click", () => $("#imgIn").click());
$("#changeBtn").addEventListener("click", () => $("#imgIn").click());
$("#emptyStage").addEventListener("click", e => { if (!e.target.closest("button")) $("#imgIn").click(); });
$("#emptyStage").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); $("#imgIn").click(); } });
let dragDepth = 0;
window.addEventListener("dragenter", e => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { dragDepth++; document.body.classList.add("dragging"); } });
window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove("dragging"); });
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove("dragging");
  const f = e.dataTransfer && [...e.dataTransfer.files].find(x => /^image\/(png|jpeg|webp)$/.test(x.type) || /\.(png|jpe?g|webp)$/i.test(x.name));
  if (f) setInput(f); else if (e.dataTransfer && e.dataTransfer.files.length) setStatus(t("up.err.notImage"), "bad");
});

/* ===== export ===== */
// The result at the picture's full size: the kept pixels stretched from the work size, edges cleaned at full scale;
// "mask": the mask alone (grey, white = kept)
function fullCanvas(maskOnly) {
  const { iw, ih, img } = R.src, { W, H } = R;
  const a = IMG.mk(W, H), ax = a.getContext("2d"), ad = ax.createImageData(W, H);
  for (let p = 0; p < W * H; p++) { const i = p * 4; ad.data[i] = ad.data[i + 1] = ad.data[i + 2] = 255; ad.data[i + 3] = R.alpha[p]; }
  ax.putImageData(ad, 0, 0);
  const full = IMG.mk(iw, ih), fx = full.getContext("2d", { willReadFrequently: true });
  fx.imageSmoothingQuality = "high";
  if (maskOnly) {
    fx.fillStyle = "#000"; fx.fillRect(0, 0, iw, ih); fx.drawImage(a, 0, 0, iw, ih);
    return full;
  }
  const m = IMG.mk(iw, ih), mx = m.getContext("2d", { willReadFrequently: true });
  mx.imageSmoothingQuality = "high"; mx.drawImage(a, 0, 0, iw, ih);
  const md = mx.getImageData(0, 0, iw, ih).data;
  fx.drawImage(img, 0, 0, iw, ih);
  const d = fx.getImageData(0, 0, iw, ih), fa = new Uint8Array(iw * ih);
  // the picture's own transparency is in alpha already (it started from it)
  for (let p = 0; p < fa.length; p++) { fa[p] = md[p * 4 + 3]; d.data[p * 4 + 3] = fa[p]; }
  cleanEdges(d.data, fa, iw, ih, 4);
  fx.putImageData(d, 0, 0);
  return full;
}
const stem = () => String(R.src.name).replace(/\.[^.]+$/, "");
async function resultBlob(format) {
  const f = format || opts.format;
  if (f === "mask") return { blob: await IMG.toBlob(fullCanvas(true)), name: `${stem()} (mask).png` };
  if (f === "webp") return { blob: await IMG.toBlob(fullCanvas(false), "image/webp", 0.95), name: `${stem()} (no background).webp` };
  return { blob: await IMG.toBlob(fullCanvas(false)), name: `${stem()} (no background).png` };
}
$("#formats").addEventListener("click", e => { const b = e.target.closest("[data-format]"); if (b) { opts.format = b.dataset.format; saveOpts(); sync(); } });
$("#saveBtn").addEventListener("click", async () => {
  if (!R.src || R.busy || !HAL) return;
  await HAL?.session?.start("removebg");
  try {
    const r = await resultBlob(), path = await HAL.saveOutput(r.blob, r.name, "cutout");
    if (!path) { setStatus(t("common.saveCancelled"), "warn"); return; }
    const name = String(path).split(/[\\/]/).pop(), c = fullCanvas(opts.format === "mask"), k = 240 / Math.max(c.width, c.height), th = IMG.mk(c.width * k, c.height * k);
    th.getContext("2d").drawImage(c, 0, 0, th.width, th.height);
    HAL.session.recordExport("removebg", { path, name, kind: "image", thumb: th.toDataURL("image/png") });
    R.saved = path;
    setStatus(t("common.savedAs", { name }), "ok");
  } catch (e) { setStatus(t("common.saveFailed", { error: e && e.message ? e.message : e }), "bad"); }
});
// Crop: the result is cropped and becomes the picture (a new start: the history begins again)
$("#cropBtn").addEventListener("click", async () => {
  if (!R.src || R.busy || !HAL) return;
  const r = await resultBlob("png"), res = await HAL.crop({ image: r.blob, name: R.src.name, ratio: "free", from: $("#cropBtn") });
  if (!res || IMG.isFull(res.params)) return;
  const img = await IMG.load(r.blob), blob = await IMG.toBlob(IMG.render(img, res.params));
  URL.revokeObjectURL(img.__url);
  const mode = opts.mode; opts.mode = "wand";   // no new detection on a picture already cut out
  await setInput({ blob, name: R.src.name });
  opts.mode = mode; sync();
  setStatus(t("rb.st.cropped"), "ok");
});
const resultItem = async () => { if (!R.src) return null; const r = await resultBlob("png"); return { kind: "image", name: r.name, blob: r.blob }; };
window.__ui.sendMenu($("#sendBtn"), { kind: "image", from: "removebg", item: resultItem });

/* ===== main ===== */
window.__rb = { R, opts, apply, undo, redo, setMode, compute, fullCanvas, resultBlob, cmp, idle: selectionIdle };
window.__halApp = {
  session: {
    clickChanges: "#maskBtn",
    capture: async () => { await selectionIdle(); return { options: { ...opts }, source: R.src ? await HAL.session.ref(R.src.path ? R.src : R.src.blob, R.src.name) : null, alpha: R.src ? await HAL.session.encode(R.alpha) : null, points: R.points, logits: await HAL.session.encode(R.logits), paint: R.src ? await HAL.session.encode(R.paint) : null, keep: R.src ? await HAL.session.encode(R.keep) : null, selection: await HAL.session.encode(R.sel), autoOn: R.autoOn, painted: R.painted || false, applied: R.applied, mask: R.mask }; },
    restore: async d => {
      Object.assign(opts, d.options); if (opts.btool !== "fg") opts.btool = "bg";
      const f = await HAL.session.read(d.source); if (f) { await setInput({ blob: f, name: f.name, path: f.__halPath });
        R.alpha = await HAL.session.decode(d.alpha); if (Array.isArray(R.alpha)) R.alpha = new Uint8Array(R.alpha);
        R.logits = await HAL.session.decode(d.logits) || null; if (Array.isArray(R.logits)) R.logits = new Float32Array(R.logits);
        R.points = Array.isArray(d.points) ? d.points : []; R.autoOn = d.autoOn; R.painted = d.painted; R.applied = d.applied; R.mask = d.mask;
        for (const [k, v] of [["paint", d.paint], ["keep", d.keep]]) if (v) { const c = await HAL.session.decode(v, R[k]); if (Array.isArray(c)) R[k].getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(c),R.W,R.H),0,0); else R[k] = c; }
        paintData = keepData = null;
        if (R.src) { paintAlpha(); keepAlpha(); }
        R.sel = await HAL.session.decode(d.selection); if (Array.isArray(R.sel)) R.sel = new Uint8Array(R.sel); paintView(); paintOver();
      } sync();
    }
  },
  ready: (async () => {
    if (HAL) {
      await HAL.ready;
      try { Object.assign(opts, (await HAL.invoke("state_get", { key: "removebg" })) || {}); } catch (e) {}
      if (!["auto", "wand", "brush"].includes(opts.mode)) opts.mode = "auto";
      if (!["png", "webp", "mask"].includes(opts.format)) opts.format = "png";
      opts.btool = "fg";   // the brush always opens on the subject
    }
    $("#bgColor").value = opts.color || blueHex();
    sync();
  })(),
  setInput,
  // "Send to…" (modules.js: accepts, gives): a picture is the input; the result is the picture without its background
  takeImage: it => setInput(it.path && !it.blob ? { path: it.path, name: it.name } : { blob: it.blob, name: it.name, path: it.path }),
  result: resultItem,
  flush: selectionIdle,
  busy: () => R.busy,
  // nothing open or running: the shell may unload the page while it is not shown (shell.js unloadIdle)
  idle: () => !R.busy && !R.src
};
})();
