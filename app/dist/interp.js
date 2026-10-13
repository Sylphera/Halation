"use strict";
// Frame rate: a video's frame rate multiplied with AI.

/* ===== interp ===== */
// Frame rate ×AI: RIFE (rife-ncnn-vulkan, a downloaded component, interp.rs) makes the frames in between, ×2, ×4 or
// up to a target rate. FFmpeg takes the frames out of the video (at its own constant rate, so sound and picture stay
// together) into a work folder of Tools\temp, RIFE writes the new ones beside them, and FFmpeg puts the video back
// together at the new rate with the original audio copied as it is (re-encoded to AAC only when MP4 cannot hold
// it). A preview does the same with a few seconds from the chosen point and shows before and after side by side,
// the sound with "before". The video itself plays in the page (Mediabunny, with its sound) to choose that point.
// "Keep original": a painted zone where the result keeps the video's own frames (text, logos, what RIFE warps).
(() => {
"use strict";
__i18n.apply(document);
__icons.apply(document);
const { $, setStatus, retryLabel } = window.__ui;
const HAL = window.__hal || (window.parent && window.parent.__hal) || null;
const M = window.__motion;
const t = window.t;
document.body.dataset.drop = t("ip.drop");

// Native fullscreen keeps the same video, transport and playback state in place.
const viewer = $("#viewer");
$("#fsBtn").addEventListener("click", async () => {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await viewer.requestFullscreen(); }
  catch (e) { setStatus(t("ip.noFullscreen"), "warn"); }
});
document.addEventListener("fullscreenchange", () => {
  const full = document.fullscreenElement === viewer, button = $("#fsBtn"), key = full ? "ip.restore" : "ip.maximize";
  button.dataset.icon = full ? "minimize-2" : "maximize";
  button.innerHTML = window.icon(button.dataset.icon);
  button.setAttribute("aria-pressed", String(full));
  button.setAttribute("aria-label", t(key)); button.title = t(key);
  button.dataset.i18nTitle = button.dataset.i18nAriaLabel = key;
});

const PREVIEW_S = 3;                     // seconds of the before / after preview
const FPS = [30, 48, 50, 60, 90, 120, 144];
const opts = { mode: "x2", fps: 60, quality: "std" };
// live: this tool's jobs queued or running (jobs.js); job: the one the status line and the result follow (the latest)
const J = { live: new Set(), job: null };
let tools = null, input = null, last = null, preview = null;
// The video played in the page: { input (Mediabunny), sink (its frames on a canvas, null when the page cannot decode
// them), audio (avplay.js) }; playing, and a token that ends a playback
const O = { src: null, playing: false, token: 0 };
// "Keep original": the mask painted over the video (red where kept), its brush size in % of the video's width
const K = { on: false, used: false, size: 8, c: null };

const oneLine = e => String(e && e.message || e).split(/\r?\n/).map(s => s.trim()).filter(Boolean).pop() || "";
// An error whose message is the text to show (said), with .cancelled when Cancel stopped the job
const said = (text, cancelled) => Object.assign(new Error(text), { said: true, cancelled: !!cancelled });
const errText = e => e && e.said ? e.message : t("ip.err.failed", { error: oneLine(e) });
const clock = s => { s = Math.max(0, s); const m = Math.floor(s / 60); return `${m}:${(s - m * 60).toFixed(1).padStart(4, "0")}`; };
const fmtFps = f => String(+f.toFixed(2));
const stemOf = n => String(n || "video").replace(/\.[^.]+$/, "");

/* ---------- rates ---------- */
// The video's rate as an exact fraction: FFmpeg reports 23.98 for 24000/1001 (and 29.97, 59.94…)
function exactRate(fps) {
  for (const r of [24, 30, 48, 60, 120]) if (Math.abs(fps - r * 1000 / 1001) < 0.01) return { num: r * 1000, den: 1001 };
  return { num: Math.round(fps * 1000), den: 1000 };
}
const rateStr = r => `${r.num}/${r.den}`;
const rateVal = r => r.num / r.den;
function outRate(src, o = opts) {
  if (o.mode === "x2") return { num: src.num * 2, den: src.den };
  if (o.mode === "x4") return { num: src.num * 4, den: src.den };
  return { num: o.fps, den: 1 };
}
// Frames out for n frames in: ×2 and ×4 exactly, a target rate in proportion
const framesOut = (n, src, out, o = opts) => o.mode === "x2" ? n * 2 : o.mode === "x4" ? n * 4 : Math.round(n * rateVal(out) / rateVal(src));
// A target at or below the video's own rate has nothing to make
const valid = () => !!input && (opts.mode !== "target" || opts.fps > input.info.fps + 0.01);

/* ---------- engine: RIFE and FFmpeg ---------- */
const missingParts = () => !tools ? ["rife", "ffmpeg"] : [!tools.rife && "rife", !tools.ffmpeg && "ffmpeg"].filter(Boolean);
const ready = () => !!tools && !missingParts().length;
async function refreshEngine(fresh) {
  if (!HAL) return;
  try { tools = await HAL.tools(fresh); } catch (e) { tools = null; }
  const need = missingParts(), b = $("#engineBadge");
  if (!need.length) {
    b.className = "badge-ok"; b.textContent = t("ip.ready");
    $("#engineNote").textContent = t(tools.rife.source === "custom" ? "ip.usingCustom" : "ip.usingDownloaded");
    $("#installRow").hidden = true;
  } else {
    b.className = "badge-warn"; b.textContent = t("ip.missing");
    $("#engineNote").textContent = t("ip.missingNote", { list: need.map(id => t("set.comp." + id)).join(", ") });
    $("#installRow").hidden = false;
  }
  updateButtons();
}
$("#installBtn").addEventListener("click", async () => {
  const btn = $("#installBtn"), st = $("#installStatus");
  btn.disabled = true; $("#installProg").hidden = false; st.className = "status warn"; st.textContent = t("ip.installing");
  try {
    for (const id of missingParts()) {
      await HAL.installTool(id, p => {
        if (p.total) M.bar($("#installBar"), p.done / p.total);
        st.textContent = t("ip.installingFile", { file: p.file, mb: (p.done / 1e6).toFixed(1) });
      });
    }
    st.className = "status ok"; st.textContent = t("ip.installed"); retryLabel(btn, "ip.install", false);
  } catch (e) { st.className = "status bad"; st.textContent = t("ip.err.install", { error: oneLine(e) }); retryLabel(btn, "ip.install", true); }
  btn.disabled = false; $("#installProg").hidden = true;
  refreshEngine(true);
});
if (HAL) HAL.on("tools", () => refreshEngine(false));

/* ---------- input ---------- */
// src: { path, name } for a file on disk, or a File (copied to Tools\temp by the main window when it has no path)
async function setInput(src) {
  if (!HAL) return;
  setStatus(t("common.loading"), "warn");
  try {
    const v = await HAL.videoPath(src), info = await HAL.probeVideo(v.path);
    dropPreview(); closeOriginal();
    input = { path: v.path, name: v.name, info, at: 0 };
    HAL?.session?.schedule("interp");
    last = null; $("#result").hidden = true;
    $("#scrub").value = "0"; $("#scrubTime").textContent = clock(0);
    $("#emptyStage").hidden = true;
    M.reveal($("#inputInfo"), true); M.reveal($("#transport"), true);
    $("#inName").textContent = input.name;
    $("#inMeta").textContent = t("ip.meta", { w: info.w, h: info.h, fps: fmtFps(info.fps), time: clock(info.duration) });
    clearMask(); placeMask();
    await showStill(true);
    openOriginal();
    setStatus("");
  } catch (e) { setStatus(t("ip.err.notVideo"), "bad"); }
  renderPlan(); updateButtons();
}
// The frame at the preview's starting point (FFmpeg, services.js frameAt); one at a time, the latest wins
let stillWant = 0, stillBusy = false, stillUrl = null;
async function showStill(thumb) {
  ++stillWant;
  if (stillBusy) return;
  stillBusy = true;
  try {
    for (let done = 0; done !== stillWant && input;) {
      done = stillWant;
      const n = Math.min(input.info.frames - 1, Math.round(input.at * input.info.fps));
      const blob = await HAL.frameAt(input.path, n, { info: input.info, maxW: 1280 });
      if (!input) break;
      if (stillUrl) URL.revokeObjectURL(stillUrl);
      stillUrl = URL.createObjectURL(blob);
      $("#still").src = stillUrl;
      if (thumb) $("#inThumb").src = stillUrl;
      thumb = false;
    }
  } catch (e) {}
  stillBusy = false;
  if (!preview && input) { $("#still").hidden = false; $("#stillTag").hidden = false; $("#stillTag").textContent = t("ip.stillTag", { fps: fmtFps(input.info.fps) }); }
  if (!O.playing) $("#orig").hidden = true;
}
$("#vidIn").addEventListener("change", e => { const f = [...e.target.files]; e.target.value = ""; takeFiles(f); });
async function browse() {
  if (HAL && HAL.pickVideo) { const r = await HAL.pickVideo().catch(() => null); if (r) setInput(r); }
  else $("#vidIn").click();
}
$("#browseBtn").addEventListener("click", browse);
$("#changeBtn").addEventListener("click", browse);
$("#linkBtn").addEventListener("click", () => { if (HAL) HAL.show("downloader"); });
$("#emptyStage").addEventListener("click", e => { if (!e.target.closest("button")) browse(); });
$("#emptyStage").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); browse(); } });
const isVideo = f => /^video\//.test(f.type) || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f.name);
function takeFiles(files) {
  const v = files.find(isVideo);
  if (!v) { if (files.length) setStatus(t("ip.err.notVideo"), "bad"); return; }
  setInput(v);
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
  document.querySelectorAll("[data-mode]").forEach(b => { const on = b.dataset.mode === opts.mode; b.setAttribute("aria-checked", String(on)); b.setAttribute("aria-selected", String(on)); });
  $("#fps").value = String(opts.fps);
  document.querySelectorAll("[data-quality]").forEach(b => { const on = b.dataset.quality === opts.quality; b.setAttribute("aria-checked", String(on)); b.setAttribute("aria-selected", String(on)); });
  $("#qualityNote").textContent = t("ip.q.note." + opts.quality);
  M.reveal($("#fpsRow"), opts.mode === "target");
  renderPlan(); updateButtons();
}
function saveOpts() { if (HAL) HAL.invoke("state_set", { key: "interp", value: opts }).catch(() => {}); }
document.querySelectorAll("[data-mode]").forEach(b => b.addEventListener("click", () => { opts.mode = b.dataset.mode; syncOpts(); saveOpts(); }));
$("#fps").addEventListener("change", () => { opts.fps = +$("#fps").value; syncOpts(); saveOpts(); });
document.querySelectorAll("[data-quality]").forEach(b => b.addEventListener("click", () => { opts.quality = b.dataset.quality; syncOpts(); saveOpts(); }));
// "24 fps → 60 fps · 1008 → 2520 frames"
function renderPlan() {
  if (!input) { $("#plan").textContent = ""; return; }
  if (!valid()) { $("#plan").textContent = t("ip.planLow", { fps: fmtFps(input.info.fps) }); return; }
  const src = exactRate(input.info.fps), out = outRate(src), n = input.info.frames;
  $("#plan").textContent = t("ip.plan", { from: fmtFps(rateVal(src)), to: fmtFps(rateVal(out)), a: n, b: framesOut(n, src, out) });
}
// the tool stays free while its jobs run (each took a snapshot of the video, the options and the mask at launch)
function updateButtons() {
  const can = !!input && ready() && valid();
  $("#runBtn").disabled = $("#previewBtn").disabled = !can;
  $("#cancelBtn").hidden = !J.live.size;
  $("#playBtn").disabled = !preview && !(O.src && O.src.sink);
  $("#paintBtn").disabled = !input || !!preview; $("#clearMask").disabled = !K.used;
}

/* ---------- progress ---------- */
// p: 0…1 of the whole job; the time left comes from the time so far
function setProgress(p) {
  if (p == null) M.hide($("#prog")); else M.show($("#prog"));
  if (p != null) M.bar($("#bar"), p);
}
// j: the running job; the tool's own bar and status follow the latest one
function report(j, step, p) {
  if (!j || j.cancelled) return;
  j.ctx.progress(p, t("ip.stage." + step));
  if (J.latest !== j.ctx.id) return;
  setProgress(p);
  const pct = Math.round(p * 100), secs = (performance.now() - j.t0) / 1000;
  let left = "";
  if (p > 0.03 && secs > 2) {
    const s = Math.round(secs * (1 - p) / p);
    left = " · " + (s >= 60 ? t("ip.leftMin", { m: Math.floor(s / 60), s: s % 60 }) : t("ip.leftSec", { s }));
  }
  setStatus(t("ip.st." + step, { pct }) + left, "warn");
}

/* ---------- running FFmpeg and RIFE ---------- */
async function ff(j, args, onFrame) {
  const lines = [];
  j.proc = await j.ctx.proc("ffmpeg", ["-hide_banner", "-nostdin", ...args], line => {
    const m = /frame=\s*(\d+)/.exec(line);
    if (m) { if (onFrame) onFrame(+m[1]); } else { lines.push(line); if (lines.length > 30) lines.shift(); }
  });
  const code = await j.proc.done; j.proc = null;
  if (j.cancelled) throw said(t("ip.st.cancelled"), true);
  if (code !== 0) throw said(t("ip.err.ffmpeg", { error: lines.filter(l => !/^\s*(Input|Output|Stream|Duration|Metadata|  )/.test(l)).pop() || t("ip.err.code", { code }) }));
  return lines;
}
// Audio an MP4 holds and players play; any other (Vorbis, PCM…) becomes AAC
const MP4_AUDIO = ["aac", "mp3", "ac3", "eac3", "alac", "flac", "opus"];
const audioOf = lines => ((lines.map(l => /Stream #0:\d+.*: Audio: (\w+)/.exec(l)).find(Boolean)) || [])[1] || null;
// Reads one line of RIFE's output: a Vulkan or model error
function readRife(line, st) {
  const clean = line.trim();
  if (/vkCreateInstance|vkEnumeratePhysicalDevices|invalid gpu device|no vulkan|vulkan.*(fail|error)|failed to create gpu instance/i.test(clean)) st.error = st.error || "vulkan";
  else if (/load_param|load_model|flownet.*failed|fopen .*(param|bin)/i.test(clean)) st.error = st.error || "model";
  if (clean) st.tail = clean;
}
// Without a Vulkan GPU RIFE runs on the CPU (-g -1, much slower); once seen, the rest of the session goes there first
let cpu = false;
async function rife(j, work, sep, n, onCount) {
  const st = { error: null, tail: "" };
  j.proc = await j.ctx.proc("rife", ["-i", work + sep + "in", "-o", work + sep + "out", "-m", tools.rife.model, "-n", String(n), "-f", "%08d.png", ...(j.opts.quality === "high" ? ["-x"] : []), ...(cpu ? ["-g", "-1"] : [])], line => readRife(line, st));
  const timer = setInterval(() => HAL.invoke("interp_count", { dir: work, sub: "out" }).then(k => { if (!j.cancelled) onCount(k); }).catch(() => {}), 400);
  let code;
  try { code = await j.proc.done; } finally { clearInterval(timer); j.proc = null; }
  if (j.cancelled) throw said(t("ip.st.cancelled"), true);
  if (st.error === "vulkan" && !cpu) { cpu = true; onCount(0); return rife(j, work, sep, n, onCount); }
  const made = await HAL.invoke("interp_count", { dir: work, sub: "out" });
  if (code !== 0 || made < n || st.error)
    throw said(st.error === "vulkan" ? t("ip.err.vulkan") : st.error === "model" ? t("ip.err.model") : t("ip.err.failed", { error: st.tail || t("ip.err.code", { code }) }));
}
// The video back together: the new frames at the new rate, the original audio copied (AAC when MP4 cannot hold it)
// sub: the frames' folder ("in": the video as it was, "out": RIFE's)
// keep: the painted zone's mask (a PNG at the video's size, white where the video keeps its own frames), laid over
// RIFE's frames: there the original frame nearest in time shows instead
async function assemble(j, work, sep, sub, out, rate, audio, fast, onFrame, keep) {
  const input = j.input;
  // the preview's clips are VP9: quick to make and played by any browser; the result is H.264
  const enc = fast ? ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-crf", "24", "-b:v", "0", "-pix_fmt", "yuv420p"]
    : ["-c:v", "libx264", "-crf", "16", "-preset", "medium", "-pix_fmt", "yuv420p", "-movflags", "+faststart"];
  const frames = s => ["-framerate", rateStr(s === "out" ? rate : exactRate(input.info.fps)), "-i", work + sep + s + sep + "%08d.png"];
  let base = ["-y", ...frames(sub)], pic = ["-map", "0:v"], next = 1;
  if (keep && sub === "out") {
    const { w, h } = input.info;
    base = [...base, ...frames("in"), "-loop", "1", "-i", keep, "-filter_complex",
      `[1:v]fps=${rateStr(rate)},format=rgba[o];[2:v]format=gray,scale=${w}:${h}[m];[o][m]alphamerge[k];[0:v][k]overlay=shortest=1:eof_action=endall[v]`];
    pic = ["-map", "[v]"]; next = 3;
  }
  if (!audio) return ff(j, [...base, ...pic, ...enc, out], onFrame);
  const av = [...base, "-i", input.path, ...pic, "-map", next + ":a:0", ...enc], aac = ["-c:a", "aac", "-b:a", "320k"];
  if (!MP4_AUDIO.includes(audio)) return ff(j, [...av, ...aac, out], onFrame);
  try { await ff(j, [...av, "-c:a", "copy", out], onFrame); }
  catch (e) { if (e.cancelled) throw e; await ff(j, [...av, ...aac, out], onFrame); }
}
// A job (jobs.js) with a snapshot of the video, the options and the painted mask: frames out on the CPU, RIFE on the
// GPU, the video back together on the CPU (ctx.switch between them). A preview is a user job (it is waited for in
// front); the result a normal one. The tool is free meanwhile; its status and result follow the latest job.
async function run(isPreview, btn) {
  if (!input || !ready() || !valid()) return;
  await HAL?.session?.start("interp");
  const snap = { input: { ...input, info: { ...input.info } }, opts: { ...opts }, mask: await maskBlob() };
  // a small copy of the still: the preview's own URL goes when the next still replaces it
  const thumb = thumbOf($("#inThumb")) || "";
  const info = snap.input.info, src = exactRate(info.fps), out = outRate(src, snap.opts);
  const from = isPreview ? Math.max(0, Math.min(snap.input.at, info.duration - PREVIEW_S)) : 0;
  const len = isPreview ? Math.min(PREVIEW_S, info.duration - from) : info.duration;
  const guess = Math.max(1, Math.round(len * rateVal(src)));
  if (isPreview) { stopPair(); playOriginal(false); paint(false); }
  const handle = HAL.jobs.submit({
    tool: "interp", kind: isPreview ? "interp-preview" : "interp", title: snap.input.name, detail: t("ip.fpsBadge", { fps: fmtFps(rateVal(out)) }),
    thumb, priority: isPreview ? "user" : "normal", lane: "cpu", then: "gpu", host: "process",
    size: info.w * info.h * guess, needs: { diskMB: Math.round(guess * (1 + framesOut(1, src, out, snap.opts)) * info.w * info.h * 1.5 / 1048576) },
    run: ctx => work(ctx, { ...snap, isPreview, src, out, from, len, guess })
  });
  J.live.add(handle.id); J.latest = handle.id;
  updateButtons(); setProgress(0); setStatus(t("ip.st.queued"), "warn");
  handle.done.catch(e => { if (J.latest !== handle.id) return; const off = e.cancelled || e.name === "AbortError"; setStatus(off ? t("ip.st.cancelled") : errText(e), off ? "" : "bad"); })
    .then(() => { J.live.delete(handle.id); if (J.latest === handle.id) setProgress(null); updateButtons(); });
  if (HAL.jobLaunched) HAL.jobLaunched(btn || $(isPreview ? "#previewBtn" : "#runBtn"), handle, { tool: "interp", thumb });
}
async function work(ctx, r) {
  const j = { ctx, get cancelled() { return ctx.signal.aborted; }, proc: null, work: null, t0: performance.now(), input: r.input, opts: r.opts };
  const { isPreview, src, out, from, len, guess } = r, info = r.input.info, path = r.input.path;
  report(j, "extract", 0);
  let file = null;
  try {
    j.work = await HAL.invoke("interp_workdir", { job: ctx.id });
    const sep = j.work.includes("\\") ? "\\" : "/";
    // the frames in and out as PNG, at about half their raw size
    const need = guess * (1 + framesOut(1, src, out, r.opts)) * info.w * info.h * 1.5, free = await HAL.invoke("disk_free", { path: j.work }).catch(() => null);
    if (free != null && need > free) throw said(t("ip.err.space", { gb: (need / 1e9).toFixed(1) }));
    const audio = audioOf(await ff(j, [...(isPreview ? ["-ss", from.toFixed(3)] : []), "-i", path, ...(isPreview ? ["-t", len.toFixed(3)] : []),
      "-map", "0:v:0", "-an", "-sn", "-vf", "fps=" + rateStr(src), "-pix_fmt", "rgb24", j.work + sep + "in" + sep + "%08d.png"], f => report(j, "extract", 0.08 * Math.min(1, f / guess))));
    const nIn = await HAL.invoke("interp_count", { dir: j.work, sub: "in" });
    if (!nIn) throw said(t("ip.err.notVideo"));
    const nOut = framesOut(nIn, src, out, r.opts);
    await ctx.switch("gpu");
    await rife(j, j.work, sep, nOut, k => report(j, cpu ? "rifeCpu" : "rife", 0.08 + 0.82 * Math.min(1, k / nOut)));
    await ctx.switch("cpu");
    const fin = f => report(j, "encode", 0.9 + 0.1 * Math.min(1, f / nOut)), keep = r.mask ? await HAL.writeFile(j.work + sep + "keep.png", r.mask) : null;
    if (isPreview) {
      await assemble(j, j.work, sep, "out", j.work + sep + "after.webm", out, null, true, fin, keep);
      // "before" carries the sound of those seconds (Opus), so the preview is heard
      await ff(j, ["-y", "-framerate", rateStr(src), "-i", j.work + sep + "in" + sep + "%08d.png",
        ...(audio ? ["-ss", from.toFixed(3), "-t", len.toFixed(3), "-i", path, "-map", "0:v", "-map", "1:a:0", "-c:a", "libopus", "-b:a", "128k"] : ["-map", "0:v"]),
        "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8", "-row-mt", "1", "-crf", "24", "-b:v", "0", "-pix_fmt", "yuv420p", j.work + sep + "before.webm"]);
      const [b, a] = await Promise.all([HAL.fileFromPath(j.work + sep + "before.webm"), HAL.fileFromPath(j.work + sep + "after.webm")]);
      // the preview applies to the video still open (not one loaded since)
      if (input && input.path === path) { showPair(a, b, src, out, from); if (J.latest === ctx.id) setStatus(t("ip.st.previewed", { from: clock(from) }), "ok"); }
    } else {
      file = await HAL.exportLocation.destination(`${stemOf(r.input.name)}-${fmtFps(rateVal(out))}fps.mp4`, "interp");
      await assemble(j, j.work, sep, "out", file, out, audio, false, fin, keep);
      const name = file.split(/[\\/]/).pop();
      ctx.output(file, { kind: "video" });
      last = { path: file, name, fps: rateVal(out) };
      $("#resultName").textContent = name; $("#resultFps").textContent = t("ip.fpsBadge", { fps: fmtFps(rateVal(out)) });
      M.reveal($("#result"), true);
      if (J.latest === ctx.id) setStatus(t("ip.st.done", { name }), "ok");
      HAL.session.recordExport("interp", { path: file, name, kind: "video", thumb: $("#inThumb").src && thumbOf($("#inThumb")) });
      file = null;
    }
  } catch (e) {
    if (file) HAL.invoke("delete_paths", { paths: [file] }).catch(() => {});
    throw e;
  } finally {
    if (j.work) await HAL.invoke("interp_clean", { dir: j.work }).catch(() => {});
  }
}
function thumbOf(img) {
  if (!img.naturalWidth) return null;
  const s = 240 / Math.max(img.naturalWidth, img.naturalHeight), c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(img.naturalWidth * s)); c.height = Math.max(1, Math.round(img.naturalHeight * s));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.8);
}
$("#previewBtn").addEventListener("click", e => run(true, e.currentTarget));
$("#runBtn").addEventListener("click", e => run(false, e.currentTarget));
// Cancel: every job of this tool still queued or running
$("#cancelBtn").addEventListener("click", () => { if (!J.live.size) return; setStatus(t("common.cancelling")); for (const id of [...J.live]) HAL.jobs.cancel(id); });

/* ---------- before / after ---------- */
// Both clips play together from the same moment; "before" leads and "after" follows it
const vB = $("#vBefore"), vA = $("#vAfter");
let speed = 1;
function showPair(after, before, src, out, from) {
  dropPreview(); playOriginal(false); $("#orig").hidden = true;
  preview = { a: URL.createObjectURL(after), b: URL.createObjectURL(before), from };
  vB.src = preview.b; vA.src = preview.a;
  vB.playbackRate = vA.playbackRate = speed;
  $("#tagBefore").textContent = t("ip.before", { fps: fmtFps(rateVal(src)) });
  $("#tagAfter").textContent = t("ip.after", { fps: fmtFps(rateVal(out)) });
  $("#still").hidden = $("#stillTag").hidden = true;
  const was = $("#pair").hidden;
  $("#pair").hidden = false;
  if (was) M.fadeIn($("#pair"), { dur: "spring" });
  updateButtons(); play(true);
}
function dropPreview() {
  if (!preview) return;
  stopPair();
  vB.removeAttribute("src"); vA.removeAttribute("src"); vB.load(); vA.load();
  URL.revokeObjectURL(preview.a); URL.revokeObjectURL(preview.b);
  preview = null; $("#pair").hidden = true;
  if (input) { $("#still").hidden = false; $("#stillTag").hidden = false; }
  placeMask();
  updateButtons();
}
function paintPlay() {
  const on = preview ? !vB.paused : O.playing;
  const b = $("#playBtn"), old = b.querySelector("svg.i");
  b.dataset.icon = on ? "pause" : "play";
  if (old) old.remove();
  b.insertAdjacentHTML("afterbegin", window.__icons.icon(b.dataset.icon));
  b.title = t(on ? "ip.pause" : preview ? "ip.play" : "ip.playOrig"); b.setAttribute("aria-label", b.title);
}
async function play(on) {
  if (!preview) return;
  if (on) { vA.currentTime = vB.currentTime; await Promise.all([vB.play(), vA.play()]).catch(() => {}); }
  else { vB.pause(); vA.pause(); }
  paintPlay();
}
function stopPair() { if (preview) { vB.pause(); vA.pause(); } paintPlay(); }
vB.addEventListener("ended", () => { vB.currentTime = 0; vA.currentTime = 0; play(true); });
vB.addEventListener("timeupdate", () => {
  if (!preview) return;
  if (Math.abs(vA.currentTime - vB.currentTime) > 0.08 && !vA.seeking) vA.currentTime = vB.currentTime;
  $("#scrubTime").textContent = clock(preview.from + vB.currentTime);
});
$("#playBtn").addEventListener("click", () => preview ? play(vB.paused) : playOriginal(!O.playing));
// Another view takes AI Interpolate's place (common.js setAway): what plays fades out and pauses
// Left behind a long while (shell.js unloadIdle → rest): the original's reader and sound close, opened again when shown
function rest() {
  if (!O.src || !window.__ui.away) return;
  closeOriginal();
  window.__ui.whenBack(() => { if (input && !O.src) openOriginal(); });
}
window.__ui.onAway(() => {
  if (O.playing) playOriginal(false);
  if (preview && !vB.paused) { vA.pause(); window.__ui.fadeOut(vB).then(paintPlay); }
});
document.querySelectorAll("[data-speed]").forEach(b => b.addEventListener("click", () => {
  const resume = O.playing;
  if (resume) playOriginal(false);
  speed = +b.dataset.speed; vB.playbackRate = vA.playbackRate = speed;
  if (resume) playOriginal(true);
  document.querySelectorAll("[data-speed]").forEach(x => { const on = x === b; x.setAttribute("aria-checked", String(on)); x.setAttribute("aria-selected", String(on)); });
}));
// The scrubber chooses where the preview starts; a preview from elsewhere no longer applies
$("#scrub").addEventListener("input", () => {
  if (!input) return;
  playOriginal(false);
  input.at = +$("#scrub").value / 1000 * input.info.duration;
  $("#scrubTime").textContent = clock(input.at);
  dropPreview(); showStill();
});

/* ---------- the video, played ---------- */
// Read in ranges like Frame Capture (never whole), its frames drawn at the preview's size, its sound through Web Audio
// (the picture follows the sound's clock). Pausing leaves the preview's starting point where it stopped.
const PLAY_W = 1280;
async function openOriginal() {
  const my = input;
  try {
    const [MB, { openAudio }] = await Promise.all([import("./mediabunny.js"), import("./avplay.js")]);
    const meta = await HAL.videoKey(my.path);
    if (!meta || input !== my) return;
    const src = new MB.Input({ source: new MB.StreamSource({ getSize: () => meta.size, read: async (a, b) => new Uint8Array(await HAL.readRange(my.path, a, b)), prefetchProfile: "fileSystem" }), formats: MB.ALL_FORMATS });
    const track = await src.getPrimaryVideoTrack(), can = !!track && await track.canDecode().catch(() => false);
    const w = Math.min(PLAY_W, my.info.w), h = Math.max(2, Math.round(w * my.info.h / my.info.w));
    const sink = can ? new MB.CanvasSink(track, { width: w, height: h, fit: "fill", poolSize: 2 }) : null;
    const first = can ? await track.getFirstTimestamp() : 0, audio = await openAudio(MB, src);
    if (input !== my) { if (audio) audio.close(); src.dispose(); return; }
    O.src = { input: src, sink, audio, first };
  } catch (e) { /* the still stays */ }
  updateButtons(); paintPlay();
}
function closeOriginal() {
  playOriginal(false);
  const s = O.src; O.src = null;
  if (s) { if (s.audio) s.audio.close(); try { s.input.dispose(); } catch (e) { /* closed */ } }
  $("#orig").hidden = true;
}
async function playOriginal(on) {
  if (!on) { if (O.playing) { O.token++; O.playing = false; if (O.src && O.src.audio) O.src.audio.stop(); paintPlay(); } return; }
  const s = O.src; if (!s || !s.sink || !input || O.playing) return;
  const my = ++O.token, v = input;
  O.playing = true; paintPlay();
  const from = v.at >= v.info.duration - 0.05 ? 0 : v.at;
  const playbackSpeed = speed;
  const heard = s.audio ? await s.audio.start(from, playbackSpeed).catch(() => null) : null, t0 = performance.now();
  const now = heard || (() => from + (performance.now() - t0) / 1000 * playbackSpeed);
  if (my !== O.token) { if (heard) s.audio.stop(true); return; }
  const c = $("#orig"), g = c.getContext("2d");
  try {
    for await (const { canvas, timestamp } of s.sink.canvases(s.first + from)) {
      if (my !== O.token) break;
      const at = timestamp - s.first, wait = at - now();
      if (wait < -0.08) continue;   // late: skipped
      if (wait > 0) await new Promise(r => setTimeout(r, wait / playbackSpeed * 1000));
      if (my !== O.token) break;
      if (c.width !== canvas.width || c.height !== canvas.height) { c.width = canvas.width; c.height = canvas.height; }
      g.drawImage(canvas, 0, 0);
      c.hidden = false;
      v.at = Math.min(at, v.info.duration);
      $("#scrub").value = String(Math.round(v.at / v.info.duration * 1000)); $("#scrubTime").textContent = clock(v.at);
    }
  } catch (e) { /* closed while playing */ }
  if (my === O.token) { O.playing = false; if (s.audio) s.audio.stop(); paintPlay(); }
}

/* ---------- keep original ---------- */
// A mask painted over the video: where it is, the result keeps the video's own frames (assemble). Painted at most
// 1280 wide over the picture's box; drag to paint, right button or Alt to erase. Written at the video's size, its
// edge softened, into the job's work folder.
function picBox() {
  const st = $("#stage").getBoundingClientRect(), { w, h } = input.info, k = Math.min(st.width / w, st.height / h);
  return { left: (st.width - w * k) / 2, top: (st.height - h * k) / 2, width: w * k, height: h * k };
}
function placeMask() {
  const c = K.c = K.c || $("#mask");
  const show = !!input && !preview && (K.on || K.used);
  c.hidden = !show; c.classList.toggle("painting", K.on);
  $("#keepBadge").hidden = !K.used;
  if (!input) return;
  const b = picBox(), w = Math.min(PLAY_W, input.info.w), h = Math.max(2, Math.round(w * input.info.h / input.info.w));
  Object.assign(c.style, { left: b.left + "px", top: b.top + "px", width: b.width + "px", height: b.height + "px" });
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
}
new ResizeObserver(() => { if (input) placeMask(); }).observe($("#stage"));
function clearMask() { const c = K.c || $("#mask"); c.getContext("2d").clearRect(0, 0, c.width, c.height); K.used = false; paint(false); }
function paint(on) {
  K.on = !!on && !!input && !preview;
  $("#paintBtn").setAttribute("aria-pressed", String(K.on));
  placeMask(); updateButtons();
}
$("#paintBtn").addEventListener("click", () => paint(!K.on));
$("#clearMask").addEventListener("click", clearMask);
$("#brush").addEventListener("input", e => { K.size = +e.target.value; $("#brush").nextElementSibling.textContent = K.size + " %"; });
$("#mask").addEventListener("contextmenu", e => e.preventDefault());
$("#mask").addEventListener("pointerdown", e => {
  if (!K.on) return;
  e.preventDefault();
  const c = K.c, g = c.getContext("2d"), erase = e.button === 2 || e.altKey, r = c.getBoundingClientRect();
  c.setPointerCapture(e.pointerId);
  g.globalCompositeOperation = erase ? "destination-out" : "source-over";
  g.fillStyle = g.strokeStyle = "#ff5a4f"; g.lineCap = g.lineJoin = "round"; g.lineWidth = K.size / 100 * c.width;
  const at = ev => [(ev.clientX - r.left) / r.width * c.width, (ev.clientY - r.top) / r.height * c.height];
  let [x0, y0] = at(e);
  g.beginPath(); g.arc(x0, y0, g.lineWidth / 2, 0, Math.PI * 2); g.fill();
  const move = ev => { const [x, y] = at(ev); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x, y); g.stroke(); x0 = x; y0 = y; };
  const end = () => { c.removeEventListener("pointermove", move); c.removeEventListener("pointerup", end); c.removeEventListener("pointercancel", end); g.globalCompositeOperation = "source-over"; if (!erase) K.used = true; placeMask(); updateButtons(); HAL?.session?.schedule("interp"); };
  c.addEventListener("pointermove", move); c.addEventListener("pointerup", end); c.addEventListener("pointercancel", end);
});
// The mask as the job reads it: white where the video keeps its frames, black elsewhere, at its size
// the painted mask as a PNG at the video's size (taken at launch; the job writes it in its work folder)
async function maskBlob() {
  if (!K.used || !input) return null;
  const { w, h } = input.info, c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"), m = document.createElement("canvas"); m.width = K.c.width; m.height = K.c.height;
  const mg = m.getContext("2d"); mg.drawImage(K.c, 0, 0); mg.globalCompositeOperation = "source-in"; mg.fillStyle = "#fff"; mg.fillRect(0, 0, m.width, m.height);
  g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
  g.filter = `blur(${Math.max(1, Math.round(w / 480))}px)`; g.drawImage(m, 0, 0, w, h);
  return new Promise(r => c.toBlob(r, "image/png"));
}

/* ---------- result ---------- */
const resultItem = () => last ? { kind: "video", path: last.path, name: last.name } : null;
window.__ui.sendMenu($("#sendBtn"), { kind: "video", from: "interp", item: resultItem });
$("#reveal").addEventListener("click", () => { if (last) HAL.invoke("reveal_path", { path: last.path }).catch(e => setStatus(oneLine(e), "bad")); });

window.__interp = { J, opts, K, O, exactRate, framesOut, input: () => input, preview: () => preview, playing: () => O.playing };
window.__halApp = {
  session: {
    clickChanges: "#paintBtn,#clearMask",
    capture: async () => ({ options: { ...opts }, input: input ? await HAL.session.ref(input) : null, at: input?.at || 0, brush: K.size, painting: K.on, mask: K.used && K.c ? await HAL.session.encode(K.c) : null }),
    restore: async d => { Object.assign(opts, d.options); syncOpts(); const v = await HAL.session.video(d.input); if (v) { await setInput(v); input.at = d.at; K.size = d.brush; $("#brush").value = K.size; $("#brush").nextElementSibling.textContent = K.size + " %"; if(d.mask) { placeMask(); if(d.mask.pixels) K.c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(d.mask.pixels),d.mask.w,d.mask.h),0,0); else { await HAL.session.decode(d.mask, K.c); } K.used=true; } paint(d.painting); } updateButtons(); }
  },
  ready: (async () => {
    if (HAL) {
      await HAL.ready;
      try { Object.assign(opts, (await HAL.invoke("state_get", { key: "interp" })) || {}); } catch (e) {}
      if (!["x2", "x4", "target"].includes(opts.mode)) opts.mode = "x2";
      if (!FPS.includes(+opts.fps)) opts.fps = 60;
      if (!["std", "high"].includes(opts.quality)) opts.quality = "std";
    }
    syncOpts(); await refreshEngine(false); updateButtons();
  })(),
  setInput,
  // "Send to…" (modules.js: accepts, gives): a video is the input (its path when it has one); the result is the last
  // video made
  takeVideo: it => setInput(it.path ? { path: it.path, name: it.name } : new File([it.blob], it.name || "video.mp4", { type: it.blob.type || "video/mp4" })),
  // files dropped on the processes island: the video becomes the input and is interpolated with the current options
  enqueue: async files => {
    const v = files.find(f => /^video\//.test(f.type) || /\.(mp4|mov|mkv|webm|avi|m4v)$/i.test(f.name)); if (!v) return false;
    await setInput(v); if (!input) return false;
    run(false); return true;
  },
  result: resultItem,
  flush: async () => {},
  busy: () => HAL.jobs.busy("interp"),
  // nothing open or running: the shell may unload the page while it is not shown (shell.js unloadIdle)
  idle: () => !J.live.size && !input,
  rest
};
})();
