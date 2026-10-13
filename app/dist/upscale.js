"use strict";
// Upscale: one picture, crop and cutout, and the queue.

/* ===== upscale ===== */
// Upscale: one picture made larger with Upscayl (upscayl-bin, a downloaded tool), optionally cropped first and
// cut out after (the shared Crop and Cutout services of the main window). Several pictures go to the queue
// (the queue section), which uses upscaleFile and the finished list from here (window.__upscale).
(() => {
"use strict";
__i18n.apply(document);
__icons.apply(document);
const { $, setStatus, retryLabel } = window.__ui;
const HAL = window.__hal || (window.parent && window.parent.__hal) || null;
const M = window.__motion, IMG = window.__img;
const t = window.t;
document.body.dataset.drop = t("up.drop");

// Native fullscreen includes only the image/comparator, keeping its existing elements and view state.
const viewer = $("#viewer");
const fullscreenHome = document.createComment("Fullscreen image controls position");
$("#fsBtn").before(fullscreenHome);
let fullscreenView = null, fullscreenChange = 0;
$("#fsBtn").addEventListener("click", async () => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else {
      fullscreenView = cmp.st.on ? { shown, state: { ...cmp.st } } : null;
      await viewer.requestFullscreen();
    }
  } catch (e) { fullscreenView = null; setStatus(t("up.noFullscreen"), "warn"); }
});
document.addEventListener("fullscreenchange", () => {
  const full = document.fullscreenElement === viewer, button = $("#fsBtn"), key = full ? "up.restore" : "up.maximize";
  if (full) $("#fullscreenControls").append(button);
  else fullscreenHome.after(button);
  button.dataset.icon = full ? "minimize-2" : "maximize";
  button.innerHTML = window.icon(button.dataset.icon);
  button.setAttribute("aria-pressed", String(full));
  button.setAttribute("aria-label", t(key)); button.title = t(key);
  button.dataset.i18nTitle = button.dataset.i18nAriaLabel = key;
  // Measure the final fullscreen grid, then fit; keep the previous view for restoration.
  const change = ++fullscreenChange;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (change !== fullscreenChange) return;
    if (full) cmp.fit();
    else if (fullscreenView) {
      if (cmp.st.on && shown === fullscreenView.shown) {
        cmp.fit(); Object.assign(cmp.st, fullscreenView.state); cmp.apply();
      }
      fullscreenView = null;
    }
  }));
});

// Interface names → Upscayl models (all 4× Real-ESRGAN models that ship with Upscayl)
const MODELS = { photo: "upscayl-standard-4x", art: "digital-art-4x", sharp: "ultrasharp-4x", fast: "upscayl-lite-4x" };
const opts = { scale: 4, model: "photo", format: "png", cut: false };
// live: the ids of this tool's jobs queued or running (jobs.js); latest: the one the status line follows
const U = { live: new Set(), latest: null };
let engine = null, input = null, last = null;

function setProgress(p) {
  if (p == null) M.hide($("#prog")); else M.show($("#prog"));
  $("#prog").classList.remove("done");
  if (p != null) M.bar($("#bar"), p);
}

/* ---------- engine ---------- */
async function refreshEngine(fresh) {
  if (!HAL) return;
  try { engine = (await HAL.tools(fresh)).upscaler; } catch (e) { engine = null; }
  const b = $("#engineBadge");
  if (engine) {
    b.className = "badge-ok"; b.textContent = t("up.ready");
    $("#engineNote").textContent = t(engine.source === "installed" ? "up.usingInstalled" : "up.usingDownloaded");
    $("#installRow").hidden = true;
  } else {
    b.className = "badge-warn"; b.textContent = t("up.missing");
    $("#engineNote").textContent = t("up.missingNote");
    $("#installRow").hidden = false;
  }
  updateButtons();
}
$("#installBtn").addEventListener("click", async () => {
  const btn = $("#installBtn"), st = $("#installStatus");
  btn.disabled = true; $("#installProg").hidden = false; st.className = "status warn"; st.textContent = t("up.installing");
  try {
    await HAL.installTool("upscaler", p => {
      if (p.total) M.bar($("#installBar"), p.done / p.total);
      st.textContent = t("up.installingFile", { file: p.file, mb: (p.done / 1e6).toFixed(1) });
    });
    st.className = "status ok"; st.textContent = t("up.installed"); retryLabel(btn, "up.install", false);
  } catch (e) { st.className = "status bad"; st.textContent = t("up.err.install", { error: oneLine(e) }); retryLabel(btn, "up.install", true); }
  btn.disabled = false; $("#installProg").hidden = true;
  refreshEngine(true);
});
if (HAL) HAL.on("tools", () => refreshEngine(false));

/* ---------- input ---------- */
// src: { path, name } for a file on disk, { blob, name } for bytes from another tab, or a File
async function setInput(src) {
  try {
    let blob = src.blob || (IMG.isBlob(src) ? src : null), path = src.path || null;
    const name = src.name || "image.png";
    if (!blob && path) blob = await HAL.fileFromPath(path);
    // Disk preparation and image decoding are independent. Commit the input only when both are
    // ready, preserving the original bytes/path and the existing Run/Session behavior.
    const url = URL.createObjectURL(blob);
    let img;
    try { [path, img] = await Promise.all([path || HAL.tempFile(blob, name), IMG.load(url)]); }
    catch (error) { URL.revokeObjectURL(url); throw error; }
    if (input && input.url && !done.some(d => d.before === input.url)) URL.revokeObjectURL(input.url);
    input = { path, name, blob, img, url, w: img.naturalWidth, h: img.naturalHeight, crop: null, cropUrl: null };
    last = null; $("#result").hidden = true;
    showInput();
    if (HAL) { const f = new File([blob], name, { type: blob.type }); if (src.path) f.__halPath = src.path; HAL.recent(f, "upscale", "image"); }
  } catch (e) { setStatus(t("common.badImage"), "bad"); }
  updateButtons();
}
// The input as it will be upscaled: cropped when a crop was chosen
const inSize = () => input.crop ? IMG.outSize(input.crop, input.w, input.h) : [input.w, input.h];
function showInput() {
  const [w, h] = inSize();
  showImage(input.cropUrl || input.url, t(input.crop ? "up.cropped" : "up.original"));
  $("#inThumb").src = input.cropUrl || input.url; $("#inName").textContent = input.name; $("#inSize").textContent = `${w}×${h}`;
  M.reveal($("#uncropBtn"), !!input.crop);
  setStatus(t("up.st.ready", { w: w * opts.scale, h: h * opts.scale }));
}
function showImage(url, label) {
  cmpClose();
  $("#preview").src = url; $("#preview").hidden = false;
  $("#which").textContent = label; $("#which").hidden = false;
  $("#emptyStage").hidden = true; $("#inputInfo").hidden = false;
}
// Crop before upscaling (non-destructive: the crop is kept on the original and can be changed again)
async function setCrop(p) {
  if (input.cropUrl) URL.revokeObjectURL(input.cropUrl);
  input.crop = p && !IMG.isFull(p) ? p : null;
  input.cropUrl = input.crop ? URL.createObjectURL(await IMG.toBlob(IMG.render(input.img, input.crop))) : null;
  showInput(); updateButtons();
}
$("#cropBtn").addEventListener("click", async () => {
  if (!input || !HAL) return;
  const r = await HAL.crop({ image: input.img, name: input.name, params: input.crop, ratio: input.crop ? input.crop.ratio : "free", from: $("#cropBtn") });
  if (r) await setCrop(r.params);
});
$("#uncropBtn").addEventListener("click", () => { if (input) setCrop(null); });
$("#imgIn").addEventListener("change", e => { const f = [...e.target.files]; e.target.value = ""; takeFiles(f); });
$("#browseBtn").addEventListener("click", () => $("#imgIn").click());
$("#changeBtn").addEventListener("click", () => $("#imgIn").click());
$("#linkBtn").addEventListener("click", () => { if (HAL) HAL.show("downloader"); });
$("#emptyStage").addEventListener("click", e => { if (!e.target.closest("button")) $("#imgIn").click(); });
$("#emptyStage").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); $("#imgIn").click(); } });
// One picture becomes the input; several go to the queue
function takeFiles(files) {
  if (window.__upscaleVideo?.active()) { window.__upscaleVideo.takeFiles(files); return; }
  const imgs = files.filter(x => /^image\/(png|jpeg|webp)$/.test(x.type) || /\.(png|jpe?g|webp)$/i.test(x.name));
  if (!imgs.length) { if (files.length) setStatus(t("up.err.notImage"), "bad"); return; }
  if (imgs.length === 1) setInput(imgs[0]); else U.addJobs(imgs, { upscale: true, cutout: opts.cut });
}
let dragDepth = 0;
window.addEventListener("dragenter", e => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { dragDepth++; document.body.classList.add("dragging"); } });
window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove("dragging"); });
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove("dragging");
  if (e.dataTransfer) takeFiles([...e.dataTransfer.files]);
});

/* ---------- options ---------- */
function syncOpts() {
  document.querySelectorAll("[data-scale]").forEach(b => { const on = +b.dataset.scale === opts.scale; b.setAttribute("aria-checked", String(on)); b.setAttribute("aria-selected", String(on)); });
  document.querySelectorAll("[data-format]").forEach(b => { const on = b.dataset.format === opts.format; b.setAttribute("aria-checked", String(on)); b.setAttribute("aria-selected", String(on)); });
  document.querySelectorAll('input[name="model"]').forEach(r => { r.checked = r.value === opts.model; });
  $("#chainCut").checked = opts.cut;
  if (input && !U.live.size) { const [w, h] = inSize(); setStatus(t("up.st.ready", { w: w * opts.scale, h: h * opts.scale })); }
}
function saveOpts() { if (HAL) HAL.invoke("state_set", { key: "upscale", value: opts }).catch(() => {}); }
document.querySelectorAll("[data-scale]").forEach(b => b.addEventListener("click", () => { opts.scale = +b.dataset.scale; syncOpts(); saveOpts(); }));
document.querySelectorAll("[data-format]").forEach(b => b.addEventListener("click", () => { opts.format = b.dataset.format; syncOpts(); saveOpts(); }));
document.querySelectorAll('input[name="model"]').forEach(r => r.addEventListener("change", () => { if (r.checked) { opts.model = r.value; saveOpts(); } }));
$("#chainCut").hidden = !HAL;
$("#chainCut").addEventListener("change", e => { opts.cut = e.target.checked; saveOpts(); });
function updateButtons() {
  // the tool stays free while its jobs run: another picture, a crop, another Upscale (docs/PROCESS_MENU_SPEC.md §2.1)
  $("#runBtn").disabled = !input || !engine;
  $("#cancelBtn").hidden = !U.live.size;
  if (U.renderQueue) U.renderQueue();
}

/* ---------- running upscayl-bin ---------- */
const oneLine = e => String(e && e.message || e).split(/\r?\n/).map(s => s.trim()).filter(Boolean).pop() || "";
// Reads one line of upscayl-bin's output: progress ("45.00%") or a known error
function readLine(line, st) {
  const clean = line.replace(/^[^\x20-\x7E]+\s*/u, "").trim();
  const pct = /^(\d{1,3}(?:[.,]\d+)?)%$/.exec(clean);
  if (pct) { st.progress = Math.min(1, parseFloat(pct[1].replace(",", ".")) / 100); return; }
  if (/vkCreateInstance|vkEnumeratePhysicalDevices|invalid gpu device|no vulkan|vulkan.*(fail|error)|failed to create gpu instance/i.test(clean)) st.error = st.error || "vulkan";
  else if (/find_blob_index_by_name|load_param|load_model|\.param.*failed|\.bin.*failed|fopen .*(param|bin)/i.test(clean)) st.error = st.error || "model";
  else if (/^Error:|Couldn't|failed/i.test(clean)) st.last = clean.replace(/^Error:\s*/i, "");
  if (clean) st.tail = clean;
}
// An error whose message is the text to show (shown), with .cancelled when Cancel stopped the job
const said = (text, cancelled) => Object.assign(new Error(text), { said: true, cancelled: !!cancelled });
const errText = e => e && e.said ? e.message : t("up.err.failed", { error: oneLine(e) });
// upscayl-bin drops the last column and row of a picture with odd sides (171×304 comes back 680×1216 at ×4, not
// 684×1216), which most crops have. Such a picture is padded to even sides by repeating its edge pixels, and the
// result is cut back to exactly its own size × the scale: any ratio keeps its size and ratio, with no border.
function padEven(pic) {
  const [w, h] = IMG.size(pic), c = IMG.mk(w + w % 2, h + h % 2), x = c.getContext("2d");
  x.drawImage(pic, 0, 0, w, h);
  if (w % 2) x.drawImage(c, w - 1, 0, 1, h, w, 0, 1, h);
  if (h % 2) x.drawImage(c, 0, h - 1, c.width, 1, 0, h, c.width, 1);
  return c;
}
// Upscales the picture `pic` (an image or canvas; loaded from `path` when missing) saved at `path` (null: not saved
// yet), named `name`, with the current options into Exports\Upscaled → its path. Runs inside a job (ctx).
// ctx: the job's (jobs.js): its process, its work folder, its cancel; o: the options as they were at launch.
async function upscaleFile(path, name, onProgress, pic, ctx, o = opts) {
  const model = MODELS[o.model];
  try { engine = (await HAL.tools(true)).upscaler || engine; } catch (e) {}     // models may have changed on disk
  if (!engine) throw said(t("up.missingNote"));
  if (!engine.available.includes(model)) throw said(t("up.err.model", { model }));
  if (!pic) pic = await IMG.load(await HAL.fileFromPath(path));
  // (a result too large for a canvas, over 250 megapixels, keeps upscayl-bin's own size)
  const [w, h] = IMG.size(pic), odd = (w % 2 || h % 2) && w * h * o.scale ** 2 <= 2.5e8, temp = [];
  const stem = name.replace(/\.[^.]+$/, "") + "-x" + o.scale;
  const out = await HAL.exportLocation.destination(stem + "." + o.format, "upscaled");
  // an odd picture goes padded to Tools\temp, and comes back there as a PNG that is cut and encoded into `out`
  let inPath = path, rawOut = out, fmt = o.format;
  if (odd || !inPath) {
    inPath = await HAL.tempFile(await IMG.toBlob(odd ? padEven(pic) : pic), name.replace(/\.[^.]+$/, "") + ".png", ctx.id); temp.push(inPath);
  }
  if (odd) { rawOut = inPath.replace(/\.[^.\\/]+$/, "") + "-up.png"; fmt = "png"; temp.push(rawOut); }
  const st = { progress: 0, error: null, last: "", tail: "" };
  const args = ["-i", inPath, "-o", rawOut, "-z", "4", "-s", String(o.scale), "-m", engine.models, "-n", model, "-f", fmt];
  if (fmt === "jpg") args.push("-c", "92");
  const cancelled = () => ctx.signal.aborted, clean = () => HAL.invoke("delete_paths", { paths: temp }).catch(() => {});
  try {
    const proc = await ctx.proc("upscaler", args, line => { readLine(line, st); if (!cancelled()) onProgress(st.progress); });
    const code = await proc.done;
    const [exists] = await HAL.invoke("files_exist", { paths: [rawOut] });
    if (cancelled() || !(code === 0 && exists && !st.error)) {
      await HAL.invoke("delete_paths", { paths: [out] }).catch(() => {});
      if (cancelled()) throw said(t("up.st.cancelled"), true);
      throw said(st.error === "vulkan" ? t("up.err.vulkan") : st.error === "model" ? t("up.err.model", { model }) : t("up.err.failed", { error: st.last || st.tail || t("up.err.code", { code }) }));
    }
    if (odd) {
      const big = await IMG.load(await HAL.fileFromPath(rawOut)), c = IMG.mk(w * o.scale, h * o.scale);
      c.getContext("2d").drawImage(big, 0, 0);
      URL.revokeObjectURL(big.__url);
      await HAL.writeFile(out, await IMG.toBlob(c, o.format === "jpg" ? "image/jpeg" : "image/png", 0.92));
    }
  } finally { await clean(); }
  return out;
}
// The picture of `file` without its background, saved to Exports\Cutouts → a finished entry
async function cutFile(file, name, before) {
  const r = await HAL.cutout(file), path = await HAL.saveCutout(r.rgba, { name });
  const url = URL.createObjectURL(r.rgba);
  return { path, name: path.split(/[\\/]/).pop(), file: new File([r.rgba], path.split(/[\\/]/).pop(), { type: "image/png" }), url, before, w: r.w, h: r.h, cut: true };
}
// A job of this tool (jobs.js) followed here: its id among the live ones, the status line on the latest, the buttons
function track(h) {
  U.live.add(h.id); U.latest = h.id; updateButtons();
  h.done.catch(() => {}).then(() => { U.live.delete(h.id); if (U.latest === h.id && !U.live.size) setProgress(null); updateButtons(); });
  return h;
}
const following = id => U.latest === id;
// Upscale: a job with a snapshot of the picture (its crop) and the options as they are now; the tool is free at once
// (another picture, other options, another Upscale) and the job waits in the GPU lane (docs/JOBS_SPEC.md).
function run(e) {
  if (!input || !engine) return;
  launch(e && e.currentTarget);
}
async function launch(btn) {
  await HAL?.session?.start("upscale");
  if (opts.cut && !(await HAL.cutoutEnsure())) return;
  const o = { ...opts }, snap = { path: input.crop ? null : input.path, name: input.name, before: input.cropUrl || input.url };
  const pic = input.crop ? IMG.render(input.img, input.crop) : input.img, [w, h] = IMG.size(pic);
  let id = null;
  const handle = HAL.jobs.submit({
    tool: "upscale", kind: "upscale", title: snap.name, detail: `×${o.scale} · ${o.format.toUpperCase()}`, thumb: snap.before,
    lane: "gpu", host: "process", size: w * h, then: o.cut ? "gpu" : null,
    run: async ctx => {
      const show = (p, text) => { if (following(ctx.id)) { setProgress(p); setStatus(text, "warn"); } };
      show(0, t("up.st.running", { pct: 0 }));
      const out = await upscaleFile(snap.path, snap.name, p => { ctx.progress(o.cut ? p * 0.8 : p, t("up.stage.upscaling")); show(p, t("up.st.running", { pct: Math.round(p * 100) })); }, pic, ctx, o);
      ctx.output(out, { kind: "image" });
      const r = await finished(out, snap.before, following(ctx.id));
      if (o.cut) {
        ctx.progress(null, t("up.st.cutting")); show(null, t("up.st.cutting"));
        const c = await cutFile(r.file, r.name, r.url);
        ctx.output(c.path, { kind: "image" });
        addDone(c); if (following(ctx.id)) { showDone(c); setStatus(t("up.st.cut", { name: c.name }), "ok"); }
      }
      return out;
    }
  });
  id = handle.id;
  track(handle);
  handle.done.catch(e => { if (!following(id)) return; const off = e.cancelled || e.name === "AbortError"; setStatus(off ? t("up.st.cancelled") : errText(e), off ? "" : "bad"); });
  if (HAL.jobLaunched) HAL.jobLaunched(btn || $("#runBtn"), handle, { thumb: snap.before, tool: "upscale" });
}
// show: the status line and the comparator follow this result (the latest job launched)
async function finished(out, before, show = true) {
  const file = await HAL.fileFromPath(out), url = URL.createObjectURL(file), img = await IMG.load(url);
  const r = { path: out, name: file.name, file, url, before, w: img.naturalWidth, h: img.naturalHeight };
  addDone(r);
  if (show) { showDone(r); setStatus(t("up.st.done", { name: file.name }), "ok"); }
  HAL.session.recordExport("upscale", { path: out, name: file.name, kind: "image", thumb: thumbOf(img) });
  return r;
}
function thumbOf(img) {
  const s = 240 / Math.max(img.naturalWidth, img.naturalHeight), c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}

/* ---------- finished pictures and the before / after comparator (compare.js) ---------- */
const done = [];          // finished jobs of this session, newest first
const cmpEl = $("#cmp"), cmp = window.__compare(cmpEl, { stage: $("#stage"), zoomText: pct => t("up.zoom", { pct }), preserveViewOnResize: true });
let shown = null;
function addDone(r) { done.unshift(r); renderDone(); }
// The result card and the comparator on a finished picture
function showDone(r) {
  last = r;
  $("#resultName").textContent = r.name; $("#resultSize").textContent = `${r.w}×${r.h}`; $("#result").hidden = false;
  cmpOpen(r);
}
function cmpOpen(r) {
  shown = r;
  cmpEl.querySelector("#cmpBefore img").src = r.before;
  cmpEl.querySelector("#cmpAfter img").src = r.url; cmpEl.classList.toggle("cut", !!r.cut);
  const was = cmpEl.hidden;
  cmpEl.hidden = false; $("#preview").hidden = true; $("#which").hidden = true;
  cmp.open(r.w, r.h); renderDone();
  if (was) M.fadeIn(cmpEl, { dur: "spring" });
}
function cmpClose() { if (!shown) return; shown = null; cmp.close(); cmpEl.hidden = true; renderDone(); }
function renderDone() {
  $("#doneCard").hidden = !done.length;
  M.list($("#doneList"), () => { $("#doneList").innerHTML = done.map((j, i) => `<div class="item" data-key="${esc(j.url)}"><b title="${esc(j.name)}">${esc(j.name)}</b><small>${j.w}×${j.h}</small><button class="btn sm" data-cmp="${i}" ${shown === j ? "disabled" : ""}>${esc(t("up.compare"))}</button></div>`).join(""); });
}
$("#doneList").addEventListener("click", e => {
  const b = e.target.closest("[data-cmp]"); if (!b) return;
  const j = done[+b.dataset.cmp]; if (j) showDone(j);
});
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
$("#runBtn").addEventListener("click", run);
// Cancel: every job of this tool still queued or running
$("#cancelBtn").addEventListener("click", () => { if (!U.live.size) return; setStatus(t("common.cancelling")); for (const id of [...U.live]) HAL.jobs.cancel(id); });
// The upscaled file to another tool; "and come back" makes the result the next input
const resultItem = () => last ? { kind: "image", path: last.path, blob: last.file, name: last.name } : null;
window.__ui.sendMenu($("#sendBtn"), { kind: "image", from: "upscale", item: resultItem });
$("#reveal").addEventListener("click", () => { if (last) HAL.invoke("reveal_path", { path: last.path }).catch(e => setStatus(oneLine(e), "bad")); });

// the input as it is sent to the upscaler (the tests compare the result with it)
const inputCanvas = () => input && IMG.render(input.img, input.crop);
Object.assign(U, { HAL, IMG, M, t, $, esc, opts, inputCanvas, errText, finished: done, setProgress, updateButtons, upscaleFile, cutFile, addDone, showDone, track, following, engine: () => engine });
window.__upscale = U;
window.__halApp = {
  session: {
    clickChanges: "#queueList [data-qdel],#queueClear",
    capture: async () => ({ options: { ...opts }, input: input ? await HAL.session.ref(input.path ? input : input.blob, input.name) : null, crop: input?.crop || null, queue: await Promise.all((U.jobs || []).filter(j => j.state !== "done").map(async j => ({ source: await HAL.session.ref(j.src), upscale: j.upscale, cutout: j.cutout }))), video: await window.__upscaleVideo.session.capture() }),
    restore: async d => {
      Object.assign(opts, d.options); syncOpts();
      const f = await HAL.session.read(d.input); if (f) { await setInput({ blob: f, name: f.name, path: f.__halPath }); if (input && d.crop) { input.crop = d.crop; input.cropUrl = URL.createObjectURL(await IMG.toBlob(IMG.render(input.img, input.crop))); $("#before").src = input.cropUrl; } }
      for (const j of d.queue || []) { const f = await HAL.session.read(j.source); if (f) U.addJobs([f], j); }
      await window.__upscaleVideo.session.restore(d.video); updateButtons();
    }
  },
  ready: (async () => {
    if (HAL) {
      await HAL.ready;
      try { Object.assign(opts, (await HAL.invoke("state_get", { key: "upscale" })) || {}); } catch (e) {}
      if (!MODELS[opts.model]) opts.model = "photo";
      if (![2, 4].includes(opts.scale)) opts.scale = 4;
      if (!["png", "jpg"].includes(opts.format)) opts.format = "png";
      opts.cut = opts.cut === true;
    }
    syncOpts(); await refreshEngine(false); updateButtons();
  })(),
  setInput,
  // "Send to…" (modules.js: accepts, gives): a picture is the input (its path when it has one); the result is the
  // last upscaled file
  takeImage: it => { window.__upscaleVideo?.mode("image"); return setInput(it.path ? { path: it.path, name: it.name } : { blob: it.blob, name: it.name }); },
  takeVideo: it => window.__upscaleVideo.setInput(it),
  result: () => window.__upscaleVideo?.active() ? window.__upscaleVideo.result() : resultItem(),
  addJobs: (files, o) => U.addJobs(files, o),
  // files dropped on the processes island: queued and started with the current options
  enqueue: async files => {
    const imgs = files.filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|avif|bmp)$/i.test(f.name)); if (!imgs.length) return false;
    U.addJobs(imgs, { upscale: true, cutout: opts.cut }); U.runQueue(); return true;
  },
  flush: async () => {},
  busy: () => HAL.jobs.busy("upscale"),
  // nothing open or running: the shell may unload the page while it is not shown (shell.js unloadIdle)
  idle: () => !window.__upscaleVideo?.hasInput() && !U.live.size && !input && !(U.jobs && U.jobs.length)
};
})();

/* ===== queue ===== */
// Upscale's queue: several pictures one after another, each upscaled, cut out, or both (docs/ARCHITECTURE.md → Shared
// services: batches of cut-outs from the Library or dropped files use it). Upscaling uses the options of the card
// above; cut-outs are saved to Exports\Cutouts. addJobs(files, { upscale, cutout }): files are Files or
// { path, name } for files of the Halation folder.
(() => {
"use strict";
const U = window.__upscale;
const { HAL, IMG, M, t, $, esc } = U;
const jobs = [];
let seq = 0;

function addJobs(files, o = {}) {
  HAL?.session?.schedule("upscale");
  const upscale = o.upscale !== false, cutout = !!o.cutout;
  if (!upscale && !cutout) return;
  for (const f of files) jobs.push({ id: ++seq, src: f, name: f.name || String(f.path || "").split(/[\\/]/).pop() || "image.png", upscale, cutout, state: "pending", msg: "" });
  renderQueue();
  $("#queueCard").scrollIntoView({ block: "nearest" });
}
const what = j => [j.upscale ? `×${U.opts.scale}` : "", j.cutout ? t("up.q.cutout") : ""].filter(Boolean).join(" · ");
function stateText(j) {
  if (j.state === "running") return j.msg || t("up.q.running");
  if (j.state === "queued") return t("up.q.queued");
  if (j.state === "done") return t("up.q.done");
  if (j.state === "failed") return j.msg || t("up.q.failed");
  return t("up.q.pending");
}
const live = j => j.state === "queued" || j.state === "running";
function renderQueue() {
  const card = $("#queueCard");
  if (!jobs.length) { M.reveal(card, false); return; }
  M.reveal(card, true);
  const pend = jobs.filter(j => j.state === "pending"), needsEngine = pend.some(j => j.upscale) && !U.engine();
  M.list($("#queueList"), () => {
    $("#queueList").innerHTML = jobs.map(j => `<div class="item" data-key="q${j.id}" data-state="${j.state}"><b title="${esc(j.name)}">${esc(j.name)}</b>`
      + `<small>${esc(what(j))}</small><small class="st">${esc(stateText(j))}</small>`
      + (j.state === "pending" ? `<button class="ib" data-qdel="${j.id}" aria-label="${esc(t("common.remove"))}" title="${esc(t("common.remove"))}" data-icon="x"></button>` : "") + `</div>`).join("");
    window.__icons.apply($("#queueList"));
  });
  $("#queueRun").disabled = !pend.length || needsEngine;
  $("#queueClear").disabled = !jobs.some(j => !live(j));
  $("#queueNote").textContent = needsEngine ? t("up.q.needsEngine") : "";
}
$("#queueList").addEventListener("click", e => {
  const b = e.target.closest("[data-qdel]"); if (!b) return;
  const i = jobs.findIndex(j => j.id === +b.dataset.qdel && j.state === "pending"); if (i >= 0) jobs.splice(i, 1);
  renderQueue();
});
// Clear: what is not queued or running (those stay until they end; the processes tray cancels them)
$("#queueClear").addEventListener("click", () => { for (let i = jobs.length - 1; i >= 0; i--) if (!live(jobs[i])) jobs.splice(i, 1); renderQueue(); });

// one picture of the queue, inside its job (ctx); o: the options at launch
async function runOne(j, ctx, o) {
  let file = IMG.isBlob(j.src) ? j.src : await HAL.fileFromPath(j.src.path), name = j.name, before = URL.createObjectURL(file);
  if (j.upscale) {
    const pic = await IMG.load(file);
    const out = await U.upscaleFile(j.src.path || null, name, p => { ctx.progress(j.cutout ? p * 0.8 : p, t("up.stage.upscaling")); j.msg = t("up.st.running", { pct: Math.round(p * 100) }); renderQueue(); }, pic, ctx, o);
    URL.revokeObjectURL(pic.__url);
    ctx.output(out, { kind: "image" });
    file = await HAL.fileFromPath(out); name = file.name;
    const img = await IMG.load(URL.createObjectURL(file));
    U.addDone({ path: out, name, file, url: img.src, before, w: img.naturalWidth, h: img.naturalHeight });
    HAL.session.recordExport("upscale", { path: out, name, kind: "image" });
    before = img.src;
  }
  if (j.cutout && !ctx.signal.aborted) {
    j.msg = t("up.st.cutting"); renderQueue(); ctx.progress(null, t("up.st.cutting"));
    const c = await U.cutFile(file, name, before);
    ctx.output(c.path, { kind: "image" });
    U.addDone(c);
  }
}
let batch = 0;
// Run the queue: one job per picture, in one batch (one row in the processes tray, one notification); the tool is
// free meanwhile, and more pictures can be added and run as another batch
async function runQueue(e) {
  await HAL?.session?.start("upscale");
  const btn = e && e.currentTarget;
  const list = jobs.filter(j => j.state === "pending");
  if (!list.length || (list.some(j => j.cutout) && !(await HAL.cutoutEnsure()))) return;
  const o = { ...U.opts }, group = "upscale-batch-" + (++batch) + "-" + Date.now();
  const handles = list.map(j => {
    j.state = "queued"; j.msg = "";
    const h = HAL.jobs.submit({
      tool: "upscale", kind: j.upscale ? "upscale" : "cutout", title: j.name, detail: what(j), group, groupTitle: t("up.q.batch"),
      lane: "gpu", host: j.upscale ? "process" : "page",
      run: async ctx => { j.state = "running"; renderQueue(); $("#status").className = "status warn"; $("#status").textContent = t("up.q.step", { n: list.indexOf(j) + 1, total: list.length, name: j.name }); await runOne(j, ctx, o); }
    });
    U.track(h);
    h.done.then(() => { j.state = "done"; j.msg = ""; }, err => { if (err.cancelled || err.name === "AbortError") { j.state = "pending"; j.msg = ""; } else { j.state = "failed"; j.msg = U.errText(err); } }).then(renderQueue);
    return h;
  });
  renderQueue();
  if (HAL.jobLaunched) HAL.jobLaunched(btn || $("#queueRun"), handles[0], { tool: "upscale" });
  await Promise.allSettled(handles.map(h => h.done));
  const ok = list.filter(j => j.state === "done").length, failed = list.filter(j => j.state === "failed").length, cancelled = list.some(j => j.state === "pending");
  const msg = t("up.q.finished", { ok, total: list.length }) + (failed ? " · " + t("common.withErrors", { n: failed }) : "") + (cancelled ? " · " + t("up.st.cancelled") : "");
  $("#status").className = "status " + (failed ? "warn" : "ok"); $("#status").textContent = msg;
  if (ok && U.finished[0]) U.showDone(U.finished[0]);
  U.updateButtons();
}
$("#queueRun").addEventListener("click", runQueue);

Object.assign(U, { addJobs, renderQueue, runQueue, jobs });
})();

/* ===== video ===== */
// One video runner in the existing Jobs system, with the same frame workspace as Interpolate.
(() => {
"use strict";
const { HAL, IMG, M, t, $, errText } = window.__upscale;
const live = window.__upscale.live;
let media = "image", scale = 2, tools = null, input = null, last = null, latest = null, loading = 0;
const videoJobs = new Set();
let preview = null, previewJob = null, previewRequest = 0;
const clock = s => { s = Math.max(0, Math.round(s || 0)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const status = (text, kind = "") => { $("#videoStatus").textContent = text; $("#videoStatus").className = "status " + kind; };
const cancelled = () => Object.assign(new Error(t("up.st.cancelled")), { cancelled: true, name: "AbortError" });
const check = ctx => { if (ctx.signal.aborted) throw cancelled(); };
function mode(value) {
  if (value === "image" && (preview || previewJob)) dropPreview(false);
  media = value;
  $("#imageView").hidden = value !== "image"; $("#videoView").hidden = value !== "video";
  document.querySelectorAll("[data-media]").forEach(b => { b.setAttribute("aria-selected", String(b.dataset.media === value)); b.tabIndex = b.dataset.media === value ? 0 : -1; });
  document.body.dataset.drop = t(value === "image" ? "up.drop" : "ip.drop");
  if (value === "image") pause();
  M.enter($(value === "image" ? "#imageView" : "#videoView"));
}
document.querySelectorAll("[data-media]").forEach(b => {
  b.addEventListener("click", () => mode(b.dataset.media));
  b.addEventListener("keydown", e => { if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return; e.preventDefault(); mode(e.key === "Home" ? "image" : e.key === "End" ? "video" : media === "image" ? "video" : "image"); $(media === "image" ? "#imageTab" : "#videoTab").focus(); });
});
const ready = () => tools?.ffmpeg && tools?.ffprobe && tools?.span && ["spanx2_ch52", "spanx4_ch52"].every(m => tools.span.available.includes(m));
function update() {
  $("#videoRun").disabled = !input || !ready(); $("#videoCancel").hidden = !videoJobs.size;
  $("#videoPreviewBtn").disabled = !player || !ready() || !!previewJob;
  $("#videoEngineBadge").className = ready() ? "badge-ok" : "badge-warn";
  $("#videoEngineBadge").textContent = t(ready() ? "up.ready" : "up.missing");
  $("#videoEngineNote").textContent = t(ready() ? "up.v.engine" : "up.v.missing");
  $("#videoPlan").textContent = input ? `${input.info.w * scale} × ${input.info.h * scale} · ${input.info.rate} FPS · ${clock(input.info.duration)}` : t("up.v.planEmpty");
  document.querySelectorAll("[data-video-scale]").forEach(b => b.setAttribute("aria-checked", String(+b.dataset.videoScale === scale)));
}
async function refresh() { try { tools = await HAL.tools(true); } catch (e) { tools = null; } update(); }
document.querySelectorAll("[data-video-scale]").forEach(b => b.addEventListener("click", () => { scale = +b.dataset.videoScale; update(); HAL.invoke("state_set", { key: "upscaleVideo", value: { scale } }).catch(() => {}); }));

// FFprobe supplies the exact rational rate and colour metadata; no rounded FPS reconstruction.
async function probe(path) {
  const lines = [];
  const p = await HAL.runTool("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", path], (line, stream) => { if (stream === "out") lines.push(line); });
  if (await p.done !== 0) throw new Error(t("ip.err.notVideo"));
  const data = JSON.parse(lines.join("\n")), v = data.streams.find(s => s.codec_type === "video" && !s.disposition?.attached_pic);
  if (!v) throw new Error(t("ip.err.notVideo"));
  const rate = v.avg_frame_rate, [num, den] = String(rate).split("/").map(Number);
  if (!(num > 0 && den > 0) || /smpte2084|arib-std-b67/.test(v.color_transfer || "") || /bt2020/.test(v.color_space || "")) throw new Error(t("up.v.unsupported"));
  const rotation = Math.abs(Math.round(+(v.side_data_list?.find(s => s.rotation != null)?.rotation || v.tags?.rotate || 0))) % 180;
  const sar = /^\d+:\d+$/.test(v.sample_aspect_ratio || "") && v.sample_aspect_ratio !== "0:1" ? v.sample_aspect_ratio : "1:1";
  const [sn, sd] = sar.split(":").map(Number);
  return { w: rotation === 90 ? v.height : v.width, h: rotation === 90 ? v.width : v.height, rate, fps: num / den,
    duration: +(v.duration || data.format.duration), frames: +v.nb_frames || Math.round(+data.format.duration * num / den),
    tick: v.time_base.split("/").map(Number).reduce((a, b) => a / b), sar: rotation === 90 ? `${sd}:${sn}` : sar,
    audio: data.streams.find(s => s.codec_type === "audio")?.codec_name || null };
}
async function setInput(src) {
  await dropPreview(false);
  mode("video"); const token = ++loading; status(t("common.loading"), "warn");
  try {
    const v = await HAL.videoPath(src), info = await probe(v.path);
    if (token !== loading) return;
    input = { ...v, info }; HAL?.session?.schedule("upscale"); last = null; $("#videoResult").hidden = true;
    $("#videoName").textContent = v.name; $("#videoMeta").textContent = `${info.w} × ${info.h} · ${info.rate} FPS · ${clock(info.duration)}`;
    $("#videoInfo").hidden = false; status(""); await openPlayer(input, t("up.original"));
  } catch (e) { if (token === loading) status(String(e.message || e), "bad"); }
  update();
}
async function browse() { if (HAL.pickVideo) { const v = await HAL.pickVideo().catch(() => null); if (v) await setInput(v); } else $("#videoIn").click(); }
$("#videoBrowse").addEventListener("click", browse); $("#videoChange").addEventListener("click", browse);
$("#videoEmpty").addEventListener("click", e => { if (!e.target.closest("button")) browse(); });
$("#videoEmpty").addEventListener("keydown", e => { if (e.target === e.currentTarget && ["Enter", " "].includes(e.key)) { e.preventDefault(); browse(); } });
function takeFiles(files) { const v = files.find(f => /^video\//.test(f.type) || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f.name)); if (v) setInput(v); else status(t("ip.err.notVideo"), "bad"); }
$("#videoIn").addEventListener("change", e => { takeFiles([...e.target.files]); e.target.value = ""; });

/* ---------- processing: FFmpeg → SPAN → FFmpeg ---------- */
async function ff(ctx, args, onLine) {
  const tail = [];
  const p = await ctx.proc("ffmpeg", ["-hide_banner", "-nostdin", ...args], line => { tail.push(line); if (tail.length > 20) tail.shift(); if (onLine) onLine(line); });
  const code = await p.done; check(ctx);
  if (code !== 0) throw new Error(t("up.v.failed", { error: tail.slice(-4).join(" · ") || code }));
}
async function processVideo(ctx, snap, factor) {
  const info = snap.info, model = `spanx${factor}_ch52`, found = await HAL.tools(true);
  if (!found.span?.available.includes(model) || !found.ffmpeg || !found.ffprobe) throw new Error(t("up.v.missing"));
  await ctx.workdir(); const work = await HAL.invoke("interp_workdir", { job: ctx.id }), sep = work.includes("\\") ? "\\" : "/";
  const folder = sub => work + sep + sub;
  let file = null, previous = null, timebase = info.tick, variable = false, completed = 0, fps = null, eta = null, sampleTime = 0;
  const report = (stage, p) => {
    check(ctx); ctx.progress(p, t("up.v." + stage)); ctx.eta(stage === "upscale" ? eta : null);
    const metrics = fps == null ? "" : t("up.v.metrics", { fps: fps.toFixed(2), eta: clock(eta) });
    ctx.detail(`×${factor} · ${info.w * factor} × ${info.h * factor} · MP4${stage === "upscale" && metrics ? " · " + metrics : ""}`);
    if (latest !== ctx.id) return;
    M.show($("#videoProg")); M.bar($("#videoBar"), p);
    status(`${t("up.v." + stage)} · ${Math.round(p * 100)}%${stage === "upscale" && metrics ? " · " + metrics : ""}`, "warn");
  };
  try {
    report("extract", 0);
    // Preserve every frame; verify timestamp spacing before any GPU work. Padding protects odd edges.
    await ff(ctx, ["-y", "-i", snap.path, "-map", "0:v:0", "-an", "-sn", "-vf", "showinfo,pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0", "-fps_mode", "passthrough", "-pix_fmt", "rgb24", folder("in") + sep + "%08d.png"], line => {
      const tb = /config in time_base:\s*(\d+)\/(\d+)/.exec(line); if (tb) timebase = +tb[1] / +tb[2];
      const pts = /\bn:\s*(\d+)\s+pts:\s*(-?\d+)/.exec(line);
      if (pts) { const at = +pts[2] * timebase; if (previous != null && Math.abs(at - previous - 1 / info.fps) > Math.max(timebase * 1.1, 0.000001)) variable = true; previous = at; report("extract", .08 * Math.min(1, (+pts[1] + 1) / info.frames)); }
    });
    if (variable) throw new Error(t("up.v.unsupported"));
    const count = await HAL.invoke("interp_count", { dir: work, sub: "in" });
    if (!count) throw new Error(t("ip.err.notVideo"));
    await ctx.switch("gpu"); report("upscale", .08);
    let tail = "", engineError = false;
    const p = await ctx.proc("span", ["-i", folder("in"), "-o", folder("out"), "-m", found.span.models, "-n", model, "-s", String(factor), "-g", "0", "-j", "1:1:1", "-v"], line => {
      tail = line || tail;
      if (/vkCreateInstance|vkEnumeratePhysicalDevices|load_param|load_model|failed|VK_ERROR|find_blob_index_by_name/i.test(line)) engineError = true;
      if (/ -> .* done$/.test(line)) {
        completed++; const now = performance.now();
        if (sampleTime) { const sample = 1000 / Math.max(1, now - sampleTime); fps = fps == null ? sample : fps + .18 * (sample - fps); const left = Math.max(0, count - completed) / fps; eta = eta == null ? left : eta + .18 * (left - eta); }
        sampleTime = now; report("upscale", .08 + .82 * Math.min(1, completed / count));
      }
    });
    const code = await p.done; check(ctx);
    const made = await HAL.invoke("interp_count", { dir: work, sub: "out" });
    if (code !== 0 || engineError || made !== count || completed !== count) throw new Error(t("up.v.failed", { error: tail || code }));
    await ctx.switch("cpu"); report("encode", .9);
    file = await HAL.exportLocation.destination(snap.name.replace(/\.[^.]+$/, "") + "-x" + factor + ".mp4", "upscaled");
    const base = ["-y", "-framerate", info.rate, "-i", folder("out") + sep + "%08d.png", "-i", snap.path, "-map", "0:v:0", "-map", "1:a:0?", "-map_metadata", "-1", "-vf", `crop=${info.w * factor}:${info.h * factor}:0:0,setsar=${info.sar.replace(":", "/")}`,
      "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", "-fps_mode", "passthrough", "-movflags", "+faststart"];
    const onEncode = line => { const m = /frame=\s*(\d+)/.exec(line); if (m) report("encode", .9 + .1 * Math.min(1, +m[1] / count)); };
    // Existing Interpolate policy: copy audio where MP4 accepts it; AAC fallback for unsupported audio.
    try { await ff(ctx, [...base, "-c:a", "copy", file], onEncode); }
    catch (e) { check(ctx); if (!info.audio) throw e; await ff(ctx, [...base, "-c:a", "aac", "-b:a", "320k", file], onEncode); }
    check(ctx);
    ctx.output(file, { kind: "video" });
    const result = { path: file, name: file.split(/[\\/]/).pop(), kind: "video", info: { ...info, w: info.w * factor, h: info.h * factor } };
    HAL.session.recordExport("upscale", { path: file, name: result.name, kind: "video" }); file = null;
    return result;
  } finally { if (file) await HAL.invoke("delete_paths", { paths: [file] }).catch(() => {}); }
}
function run(btn) {
  if (!input || !ready()) return;
  const original = input, snap = { ...input, info: { ...input.info } }, factor = scale;
  const handle = HAL.jobs.submit({ tool: "upscale", kind: "upscale-video", title: snap.name, detail: `×${factor} · MP4`, lane: "cpu", then: "gpu", host: "process", size: snap.info.w * snap.info.h,
    needs: { diskMB: Math.ceil(snap.info.w * snap.info.h * snap.info.frames * 3 * (1 + factor * factor) / 1e6) },
    run: ctx => processVideo(ctx, snap, factor) });
  latest = handle.id; live.add(handle.id); videoJobs.add(handle.id); update();
  status(t("up.q.queued"));
  handle.done.then(async result => {
    if (latest !== handle.id || input !== original) return;
    last = result; $("#videoResultName").textContent = result.name; $("#videoResultSize").textContent = `${result.info.w} × ${result.info.h}`; M.reveal($("#videoResult"), true);
    status(t("up.st.done", { name: result.name }), "ok"); await openPlayer(result, t("up.result"));
  }, e => { if (latest === handle.id) status(e.cancelled || e.name === "AbortError" ? t("up.st.cancelled") : errText(e), e.cancelled ? "" : "bad"); }).finally(() => {
    live.delete(handle.id); videoJobs.delete(handle.id); if (latest === handle.id) M.hide($("#videoProg")); update(); window.__upscale.updateButtons();
  });
  HAL.jobLaunched?.(btn, handle, { tool: "upscale" });
}
$("#videoRun").addEventListener("click", e => run(e.currentTarget));
$("#videoCancel").addEventListener("click", () => { for (const id of videoJobs) HAL.jobs.cancel(id); });
$("#videoReveal").addEventListener("click", () => { if (last) HAL.invoke("reveal_path", { path: last.path }).catch(e => status(e.message || String(e), "bad")); });
window.__ui.sendMenu($("#videoSend"), { kind: "video", from: "upscale", item: () => last });
$("#videoOriginal").addEventListener("click", () => input && openPlayer(input, t("up.original")));
$("#videoShowResult").addEventListener("click", () => last && openPlayer(last, t("up.result")));

/* ---------- short preview: Interpolate's paired clips and shared transport ---------- */
const vB = $("#videoBefore"), vA = $("#videoAfter");
async function playPair(on) {
  if (!preview?.a) return;
  if (on) { vA.currentTime = vB.currentTime; await Promise.all([vB.play(), vA.play()]).catch(() => {}); }
  else { vB.pause(); vA.pause(); }
  paintPlay();
}
vB.addEventListener("ended", () => { if (preview?.a) { vB.currentTime = vA.currentTime = 0; playPair(true); } });
vB.addEventListener("timeupdate", () => {
  if (!preview?.a) return;
  if (Math.abs(vA.currentTime - vB.currentTime) > .08 && !vA.seeking) vA.currentTime = vB.currentTime;
  seek.value = String(Math.round(vB.currentTime / (vB.duration || 1) * 1000));
  $("#videoTime").textContent = `${clock(preview.from + vB.currentTime)} / ${clock(player?.item.info.duration)}`;
});
async function dropPreview(resume = true) {
  ++previewRequest;
  if (previewJob) { HAL.jobs.cancel(previewJob.id); previewJob = null; }
  const saved = preview; if (!saved) { update(); return null; }
  vB.pause(); vA.pause();
  vB.removeAttribute("src"); vA.removeAttribute("src"); vB.load(); vA.load();
  preview = null; $("#videoPair").hidden = true; $("#videoPreviewClose").hidden = true;
  if (saved.a) URL.revokeObjectURL(saved.a); if (saved.b) URL.revokeObjectURL(saved.b);
  if (player === saved.player) {
    canvas.hidden = false; $("#videoWhich").hidden = false;
    scale = saved.scale; speed = saved.speed; position(saved.at);
    document.querySelectorAll("[data-video-speed]").forEach(b => b.setAttribute("aria-checked", String(+b.dataset.videoSpeed === speed)));
    if (resume && saved.playing && media === "video" && !window.__ui.away) play();
  }
  paintPlay(); update(); return saved;
}
async function previewClip(ctx, item, from, factor) {
  const found = await HAL.tools(true), model = `spanx${factor}_ch52`, info = item.info;
  if (!found.span?.available.includes(model) || !found.ffmpeg) throw new Error(t("up.v.missing"));
  await ctx.workdir(); const work = await HAL.invoke("interp_workdir", { job: ctx.id }), sep = work.includes("\\") ? "\\" : "/";
  const folder = sub => work + sep + sub, len = Math.min(2, info.duration - from), guess = Math.max(1, Math.round(len * info.fps));
  const report = (p, stage) => { check(ctx); ctx.progress(p, t("up.v." + stage)); M.show($("#videoProg")); M.bar($("#videoBar"), p); status(t("up.v." + stage), "warn"); };
  try {
    report(0, "extract");
    await ff(ctx, ["-y", "-ss", from.toFixed(6), "-i", item.path, "-t", len.toFixed(6), "-frames:v", String(guess),
      "-map", "0:v:0", "-an", "-sn", "-vf", `fps=${info.rate},pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0`, "-pix_fmt", "rgb24", folder("in") + sep + "%08d.png"]);
    const count = await HAL.invoke("interp_count", { dir: work, sub: "in" });
    await ctx.switch("gpu"); report(.08, "upscale");
    let tail = "", made = 0;
    const p = await ctx.proc("span", ["-i", folder("in"), "-o", folder("out"), "-m", found.span.models, "-n", model, "-s", String(factor), "-g", "0", "-j", "1:1:1", "-v"], line => {
      tail = line || tail; if (/ -> .* done$/.test(line)) report(.08 + .82 * Math.min(1, ++made / count), "upscale");
    });
    const code = await p.done; check(ctx);
    if (!count || code !== 0 || await HAL.invoke("interp_count", { dir: work, sub: "out" }) !== count) throw new Error(t("up.v.failed", { error: tail || code }));
    await ctx.switch("cpu"); report(.9, "encode");
    // Interpolate's browser-friendly temporary VP9 clips. Audio is omitted for this comparison preview.
    const encode = async (sub, multiple, out) => ff(ctx, ["-y", "-framerate", info.rate, "-i", folder(sub) + sep + "%08d.png",
      "-vf", `crop=${info.w * multiple}:${info.h * multiple}:0:0,setsar=${info.sar.replace(":", "/")}`, "-an",
      "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-crf", "24", "-b:v", "0", "-pix_fmt", "yuv420p", out]);
    const before = work + sep + "before.webm", after = work + sep + "after.webm";
    await encode("out", factor, after); await encode("in", 1, before);
    const [b, a] = await Promise.all([HAL.fileFromPath(before), HAL.fileFromPath(after)]);
    check(ctx); ctx.progress(1, t("ip.preview")); return { a, b };
  } finally { await HAL.invoke("interp_clean", { dir: work }).catch(() => {}); }
}
async function runPreview(btn) {
  if (!player || !ready() || previewJob) return;
  const factor = scale, previous = await dropPreview(false), p = player;
  const saved = previous || { player: p, at, playing, scale, speed, status: $("#videoStatus").textContent, kind: $("#videoStatus").className };
  pause(); preview = saved;
  saved.from = Math.max(0, Math.min(saved.at, p.item.info.duration - 1 / p.item.info.fps));
  const request = previewRequest;
  const handle = HAL.jobs.submit({ tool: "upscale", kind: "upscale-video-preview", title: p.item.name, detail: `×${factor} · ${t("ip.preview")}`, priority: "user", lane: "cpu", then: "gpu", host: "process", size: p.item.info.w * p.item.info.h,
    run: ctx => previewClip(ctx, p.item, saved.from, factor) });
  previewJob = handle; live.add(handle.id); videoJobs.add(handle.id); update(); status(t("up.q.queued"), "warn");
  HAL.jobLaunched?.(btn, handle, { tool: "upscale" });
  try {
    const result = await handle.done;
    if (request !== previewRequest || player !== p || preview !== saved) return;
    saved.a = URL.createObjectURL(result.a); saved.b = URL.createObjectURL(result.b);
    vB.src = saved.b; vA.src = saved.a; vB.playbackRate = vA.playbackRate = speed;
    canvas.hidden = true; $("#videoWhich").hidden = true; $("#videoPair").hidden = false; $("#videoPreviewClose").hidden = false;
    M.fadeIn($("#videoPair"), { dur: "spring" }); await playPair(true);
    status(t("up.v.previewed", { from: clock(saved.from) }), "ok");
  } catch (e) {
    if (request === previewRequest) { await dropPreview(); status(e.cancelled ? t("up.st.cancelled") : errText(e), e.cancelled ? "" : "bad"); }
  } finally {
    live.delete(handle.id); videoJobs.delete(handle.id); if (previewJob === handle) previewJob = null;
    M.hide($("#videoProg")); update(); window.__upscale.updateButtons();
  }
}
$("#videoPreviewBtn").addEventListener("click", e => runPreview(e.currentTarget));
$("#videoPreviewClose").addEventListener("click", async () => {
  const saved = await dropPreview(); if (saved) { $("#videoStatus").textContent = saved.status; $("#videoStatus").className = saved.kind; }
});

/* ---------- viewer: shared ranged reader and audio clock ---------- */
let player = null, playerRequest = 0, playToken = 0, playing = false, at = 0, speed = 1;
const canvas = $("#videoCanvas"), seek = $("#videoSeek");
let paintedPlaying;
function paintPlay() { const on = preview?.a ? !vB.paused : playing, b = $("#videoPlay"); if (paintedPlaying !== on) { b.innerHTML = window.icon(on ? "pause" : "play"); paintedPlaying = on; } b.setAttribute("aria-label", t(on ? "ip.pause" : "ip.play")); }
function pause() { playToken++; playing = false; player?.audio?.stop(); paintPlay(); }
function position(value) { at = value; seek.value = String(Math.round(value / (player?.item.info.duration || 1) * 1000)); $("#videoTime").textContent = `${clock(value)} / ${clock(player?.item.info.duration)}`; }
function draw(c) { canvas.width = c.width; canvas.height = c.height; canvas.getContext("2d").drawImage(c, 0, 0); canvas.hidden = false; }
async function openPlayer(item, label) {
  await dropPreview(false);
  const request = ++playerRequest; pause(); if (player) { player.audio?.close(); player.src.dispose(); player = null; }
  canvas.hidden = true; $("#videoTransport").hidden = true;
  let src = null, audio = null;
  try {
    const [MB, { openAudio }] = await Promise.all([import("./mediabunny.js"), import("./avplay.js")]);
    const meta = await HAL.videoKey(item.path);
    src = new MB.Input({ source: new MB.StreamSource({ getSize: () => meta.size, read: async (a, b) => new Uint8Array(await HAL.readRange(item.path, a, b)), prefetchProfile: "fileSystem" }), formats: MB.ALL_FORMATS });
    const track = await src.getPrimaryVideoTrack(); if (!track || !await track.canDecode()) throw new Error(t("up.v.playerError"));
    const [sn, sd] = item.info.sar.split(":").map(Number), aspect = item.info.w * sn / sd / item.info.h;
    const width = Math.min(1280, item.info.w), height = Math.max(2, Math.round(width / aspect));
    const sink = new MB.CanvasSink(track, { width, height, fit: "fill", poolSize: 2 }), first = await track.getFirstTimestamp();
    audio = await openAudio(MB, src); const frame = await sink.getCanvas(first);
    if (request !== playerRequest) { audio?.close(); src.dispose(); return; }
    player = { item, src, sink, first, audio }; if (frame) { draw(frame.canvas); $("#videoThumb").src = canvas.toDataURL("image/jpeg", .8); }
    $("#videoEmpty").hidden = true; $("#videoTransport").hidden = false; $("#videoWhich").hidden = false; $("#videoWhich").textContent = label;
    position(0); $("#videoPlay").disabled = false;
    update();
  } catch (e) { audio?.close(); src?.dispose(); if (request === playerRequest) status(t("up.v.playerError"), "warn"); }
}
async function play() {
  if (preview?.a) { await playPair(vB.paused); return; }
  if (playing) { pause(); return; } const p = player; if (!p) return;
  const token = ++playToken, from = at >= p.item.info.duration - .05 ? 0 : at; playing = true; paintPlay();
  const rate = speed, heard = await p.audio?.start(from, rate).catch(() => null), start = performance.now();
  if (token !== playToken) return;
  const now = heard || (() => from + (performance.now() - start) / 1000 * rate);
  try {
    for await (const f of p.sink.canvases(p.first + from)) {
      if (token !== playToken) break; const time = f.timestamp - p.first, wait = time - now(); if (wait < -.08) continue;
      if (wait > 0) await new Promise(r => setTimeout(r, wait / rate * 1000)); if (token !== playToken) break;
      draw(f.canvas); position(time);
    }
  } catch (e) { if (token === playToken) status(t("up.v.playerError"), "warn"); }
  if (token === playToken) pause();
}
$("#videoPlay").addEventListener("click", play);
seek.addEventListener("input", async () => { if (preview?.a) { await playPair(false); vB.currentTime = vA.currentTime = +seek.value / 1000 * vB.duration; return; } pause(); const p = player, token = playToken; if (!p) return; position(+seek.value / 1000 * p.item.info.duration); try { const f = await p.sink.getCanvas(p.first + at); if (f && token === playToken) draw(f.canvas); } catch (e) {} });
$("#videoFullscreen").addEventListener("click", async () => { try { if (document.fullscreenElement) await document.exitFullscreen(); else await $("#videoViewer").requestFullscreen(); } catch (e) { status(t("up.noFullscreen"), "warn"); } });
const videoFullscreenHome = document.createComment("Fullscreen video transport position");
$("#videoFullscreen").before(videoFullscreenHome);
document.addEventListener("fullscreenchange", () => {
  const full = document.fullscreenElement === $("#videoViewer"), button = $("#videoFullscreen"), key = full ? "up.restore" : "up.maximize";
  if (full) $("#videoFullscreenControls").append(button);
  else videoFullscreenHome.after(button);
  button.dataset.icon = full ? "minimize-2" : "maximize";
  button.innerHTML = window.icon(button.dataset.icon);
  button.setAttribute("aria-pressed", String(full));
  button.setAttribute("aria-label", t(key)); button.title = t(key);
  button.dataset.i18nTitle = button.dataset.i18nAriaLabel = key;
});
document.querySelectorAll("[data-video-speed]").forEach(b => b.addEventListener("click", () => {
  const resume = playing; if (resume) pause(); speed = +b.dataset.videoSpeed;
  vB.playbackRate = vA.playbackRate = speed;
  document.querySelectorAll("[data-video-speed]").forEach(x => x.setAttribute("aria-checked", String(x === b)));
  if (resume) play();
}));
window.__ui.onAway(() => { pause(); if (preview?.a) playPair(false); });
window.__upscaleVideo = { session: {
  capture: async () => ({ media, scale, input: input ? await HAL.session.ref(input) : null, at, speed }),
  restore: async d => { if (!d) return; scale = d.scale; speed = d.speed; const v = await HAL.session.video(d.input); if (v) { await setInput(v); at = d.at; position(at); } mode(d.media); update(); }
}, active: () => media === "video", mode, setInput, takeFiles, result: () => last, hasInput: () => !!input, processVideo, probe,
  viewState: () => ({ at, playing, scale, path: input?.path, playerPath: player?.item.path, previewFrom: preview?.from }) };
if (HAL) {
  HAL.on("tools", refresh);
  window.__halApp.ready.then(async () => { try { const o = await HAL.invoke("state_get", { key: "upscaleVideo" }); if ([2, 4].includes(o?.scale)) scale = o.scale; } catch (e) {} await refresh(); });
}
})();
