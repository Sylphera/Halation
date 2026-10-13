"use strict";
// Converter: any file → a format → Convert (docs/CONVERTER_SPEC.md).

/* ===== state ===== */
// What a file is and what it can become comes from convert.rs (convert_probe: detection by content, the curated
// table, what the installed FFmpeg encodes); how each output is made too (convert_prepare: FFmpeg's arguments or the
// image engine, a document's LibreOffice and Pandoc steps, a PDF's pages through PDFium). The page keeps the list, the
// choices and the jobs: one job per file (jobs.js), FFmpeg, LibreOffice and Pandoc run through ctx.proc so Cancel
// kills them, the .part renamed only when it ends well.
(() => {
"use strict";
__i18n.apply(document);
__icons.apply(document);
const { $, esc, setStatus, retryLabel } = window.__ui;
const HAL = window.__hal || (window.parent && window.parent.__hal) || null;
const M = window.__motion;
const t = window.t;
document.body.dataset.drop = t("cv.drop");

// items: { id, path, name, rel, temp (a dropped copy in the workspace), src (convert_probe), target ("mp4" or "a:mp3"
// for a video's audio only), state (probing | ready | queued | running | done | failed | cancelled), progress, out,
// bytesOut, error, job }. groups: the batch's choice per class. Global Settings owns destinations.
// have: the components installed (convert_probe, tools_status).
const C = { items: [], groups: {}, live: new Set(), have: { ffmpeg: true, pandoc: true, libreoffice: true, pdfium: true }, last: null };
const COMPONENTS = ["ffmpeg", "pandoc", "libreoffice", "pdfium"];
const haveFrom = st => { if (st) for (const k of COMPONENTS) if (k in st) C.have[k] = !!st[k]; };
let nextId = 1;

const oneLine = e => String(e && e.message || e).split(/\r?\n/).map(s => s.trim()).filter(Boolean).pop() || "";
const clock = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`; };
const bytes = n => n >= 1e9 ? (n / 1e9).toFixed(2) + " GB" : n >= 1e6 ? (n / 1e6).toFixed(1) + " MB" : n >= 1e3 ? Math.round(n / 1e3) + " KB" : (n || 0) + " B";
const FORMAT = { jpg: "JPG", tiff: "TIFF", m4a: "M4A", mkv: "MKV", ogv: "OGV", aiff: "AIFF", md: "Markdown", epub: "EPUB", tex: "LaTeX", org: "Org", dbk: "DocBook" };
const fmt = id => FORMAT[id] || String(id || "").toUpperCase();
const CODEC = { h264: "H.264", hevc: "HEVC", av1: "AV1", vp9: "VP9", vp8: "VP8", prores: "ProRes", mpeg4: "MPEG-4", mpeg2video: "MPEG-2", mjpeg: "MJPEG",
  aac: "AAC", mp3: "MP3", opus: "Opus", vorbis: "Vorbis", flac: "FLAC", alac: "ALAC", ac3: "AC-3", eac3: "E-AC-3", dts: "DTS", wmav2: "WMA" };
const codec = c => CODEC[c] || (/^pcm_/.test(c) ? "PCM" : String(c || "").toUpperCase());
// "Video · H.264 + AAC · 1920×1080 · 3:12", "Audio · WAV (named .mp3) · 44.1 kHz · 0:42"
function summary(src) {
  if (!src) return t("common.loading");
  if (src.class === "unsupported") return src.format ? t("cv.unknownOf", { ext: src.named || src.format }) : t("cv.unknown");
  const parts = [t("cv.class." + src.class)];
  if (src.class !== "pdf") parts.push(fmt(src.format) + (src.mismatch && src.named ? " " + t("cv.named", { ext: src.named }) : ""));
  const v = (src.streams || []).find(s => s.kind === "video" && !s.cover), a = (src.streams || []).filter(s => s.kind === "audio");
  if (src.class === "video") parts.push([v && codec(v.codec), ...a.slice(0, 2).map(x => codec(x.codec))].filter(Boolean).join(" + "));
  if (src.class === "audio" && a[0]) parts.push([codec(a[0].codec), a[0].rate ? (a[0].rate / 1000).toFixed(a[0].rate % 1000 ? 1 : 0) + " kHz" : ""].filter(Boolean).join(" · "));
  if (src.class === "pdf" && src.pages) parts.push(t(src.pages === 1 ? "cv.page" : "cv.pages", { n: src.pages }));
  if (src.width && src.height) parts.push(`${src.width}×${src.height}`);
  if (src.duration > 0) parts.push(clock(src.duration));
  return parts.join(" · ");
}
const outKey = o => (o.audio ? "a:" : "") + o.id;
const outOf = (src, key) => src && (src.outputs || []).find(o => outKey(o) === key) || null;
const DOCS = ["document", "sheet", "slides", "markup", "pdf"];
// The kind of an output for the Library and "Send to…" ("document": neither, the Library keeps it as a file)
function kindOf(src, key) {
  const o = outOf(src, key);
  if (!o) return "image";
  if (o.audio || src.class === "audio") return "audio";
  if (["mp4", "webm", "mkv", "mov"].includes(o.id)) return "video";
  if (DOCS.includes(src.class) && src.class !== "pdf") return "document";
  return "image";
}
const realPath = it => !it.temp;
// The output offered first: a copy without loss when there is one (a container changed), else the usual one per kind
const PREF = { video: ["mp4"], audio: ["mp3"], image: ["png"], animated: ["gif", "webp", "mp4"], document: ["pdf"], sheet: ["pdf"], slides: ["pdf"], markup: ["pdf", "html"], pdf: ["png"] };
function recommended(src) {
  const all = (src && src.outputs) || [], outs = all.filter(o => !o.audio);
  if (!outs.length) return all.length ? outKey(all[0]) : null;
  const copy = outs.find(o => o.copy);
  if (copy) return outKey(copy);
  for (const id of PREF[src.class] || []) { const o = outs.find(x => x.id === id); if (o) return outKey(o); }
  return outKey(outs[0]);
}
const ordered = src => { const outs = (src && src.outputs) || [], r = recommended(src); return [...outs.filter(o => outKey(o) === r), ...outs.filter(o => outKey(o) !== r)]; };
const ICON = { audio: "audio-lines", video: "film", image: "image", animated: "image", document: "file-text", sheet: "sheet", slides: "presentation", markup: "file-code", pdf: "file-text", unsupported: "file" };
const iconOf = it => ICON[it.src ? it.src.class : "unsupported"] || "file";
// Object URLs of a file (its picture, its preview), let go when it leaves the list
const urlOf = (it, blob) => { const u = URL.createObjectURL(blob); (it.urls = it.urls || []).push(u); return u; };

/* ===== drop ===== */
// Files from the dialog ({ path, name, rel }), dropped (File; a folder walked through its entries) or sent from another
// tool. A File without a path is copied into the workspace (services.js videoPath); the global policy chooses outputs.
async function addFiles(list) {
  const fresh = [];
  for (const f of list) {
    if (!f) continue;
    const it = { id: nextId++, path: f.path || f.__halPath || null, name: f.name || (f.path || "").split(/[\\/]/).pop() || "file", rel: f.rel || "", temp: false, src: null, target: null, state: "probing", file: f.path || f.__halPath ? null : f };
    C.items.push(it); fresh.push(it);
  }
  if (!fresh.length) return false;
  render();
  // four at a time: probing reads headers only
  const queue = fresh.slice();
  await Promise.all([0, 1, 2, 3].map(async () => { for (let it; (it = queue.shift());) await probeItem(it); }));
  HAL?.session?.schedule("convert");
  render();
  return true;
}
async function probeItem(it) {
  try {
    if (!it.path && it.file) { const v = await HAL.videoPath(it.file); it.path = v.path; it.temp = true; it.file = null; }
    let src;
    try { src = await HAL.invoke("convert_probe", { path: it.path }); }
    catch (e) {
      // a file of the Library's linked folders or of another tool: allowed once, like a session's media
      if (!/not opened/.test(oneLine(e))) throw e;
      await HAL.invoke("session_allow_video", { path: it.path });
      src = await HAL.invoke("convert_probe", { path: it.path });
    }
    it.src = src; haveFrom(src.have);
    it.state = "ready";
    const outs = src.outputs || [];
    if (!outOf(src, it.target)) it.target = outs.length ? recommended(src) : null;
  } catch (e) { it.src = { class: "unsupported", outputs: [], format: "", named: "" }; it.state = "ready"; it.target = null; it.probeError = oneLine(e); }
  thumbOf(it);
}
$("#fileIn").addEventListener("change", e => { const f = [...e.target.files]; e.target.value = ""; addFiles(f); });
// The start screen's buttons: the dialog opens showing only that kind of file (convert_pick's filter)
const KINDS = [
  { id: "video", icon: "film", fmts: "MP4 · MKV · MOV · WEBM · AVI" },
  { id: "audio", icon: "audio-lines", fmts: "MP3 · WAV · FLAC · M4A · OGG" },
  { id: "image", icon: "image", fmts: "PNG · JPG · WEBP · GIF · TIFF" },
  { id: "docs", icon: "file-text", fmts: "DOCX · ODT · RTF · MD · HTML" },
  { id: "office", icon: "sheet", fmts: "XLSX · ODS · CSV · PPTX · ODP" },
  { id: "pdf", icon: "file-text", fmts: "PDF → PNG · JPG" }
];
$("#kinds").innerHTML = KINDS.map(k => `<button class="kind" data-kind="${k.id}"><span class="ic">${window.icon(k.icon)}</span><span><b>${esc(t("cv.kind." + k.id))}</b><small>${esc(k.fmts)}</small></span></button>`).join("");
$("#kinds").addEventListener("click", e => { const b = e.target.closest("[data-kind]"); if (b) browse(false, b.dataset.kind); });
async function browse(folder, kind) {
  if (!HAL) { $("#fileIn").click(); return; }
  const picked = await HAL.invoke("convert_pick", { folder: !!folder, kind: kind || null }).catch(() => []);
  if (picked && picked.length) addFiles(picked);
}
$("#browseBtn").addEventListener("click", e => { e.stopPropagation(); browse(false); });
$("#folderBtn").addEventListener("click", e => { e.stopPropagation(); browse(true); });
$("#addBtn").addEventListener("click", () => browse(false));
$("#changeBtn").addEventListener("click", () => { if (!clearAll()) return; browse(false); });
$("#clearBtn").addEventListener("click", () => clearAll());
$("#drop").addEventListener("click", e => { if (!e.target.closest("button")) browse(false); });
$("#drop").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); browse(false); } });
// Everything out of the list (not while conversions run)
function clearAll() {
  if (C.live.size) { setStatus(t("cv.busy"), "warn"); return false; }
  stopPlayer();
  for (const it of C.items) for (const u of it.urls || []) URL.revokeObjectURL(u);
  C.items = []; C.groups = {}; C.last = null;
  setStatus(""); render(); HAL?.session?.schedule("convert");
  return true;
}
// A dropped folder: its files with their folder relative to it (webkitGetAsEntry)
async function entries(dt) {
  const roots = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!roots.some(e => e.isDirectory)) return [...dt.files];
  const out = [];
  const walk = async (e, rel, depth) => {
    if (out.length >= 2000) return;
    if (e.isFile) { const f = await new Promise(r => e.file(r, () => r(null))); if (f && !f.name.startsWith(".")) { f.rel = rel; out.push(f); } return; }
    if (!e.isDirectory || depth > 8) return;
    const reader = e.createReader(), kids = [];
    for (let batch; (batch = await new Promise(r => reader.readEntries(r, () => r([])))).length;) kids.push(...batch);
    for (const k of kids) await walk(k, rel ? rel + "/" + e.name : e.name, depth + 1);
  };
  for (const r of roots) await walk(r, "", 0);
  // a folder's own files carry its name; loose files dropped beside it none
  return out;
}
let dragDepth = 0;
window.addEventListener("dragenter", e => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { dragDepth++; document.body.classList.add("dragging"); } });
window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove("dragging"); });
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", async e => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove("dragging");
  if (!e.dataTransfer) return;
  const files = await entries(e.dataTransfer);
  // the folder's own name is its first level: entries() gives "Folder/Sub" for files below it, "" at its top
  addFiles(files.map(f => { if (f.rel === undefined) f.rel = ""; return f; }));
});

/* ===== card ===== */
// One file: the preview on the left (the picture, the video or the sound with its player, a PDF's first page, else a
// big icon), on the right the file, Convert to as a list (the recommended output first, a video's "Audio only" folded)
// and the line of consequence under it.
async function thumbOf(it) {
  if (!HAL || !it.src || it.thumb) return;
  try {
    if (it.src.class === "image" && it.src.format !== "avif" || it.src.class === "animated") it.thumb = await full(it);
    else if (it.src.class === "video" && C.have.ffmpeg) it.thumb = urlOf(it, await HAL.frameAt(it.path, 0, { maxW: 160 }));
    if (it.thumb) paintThumb();
  } catch (e) { /* the icon stays */ }
}
function paintThumb() {
  const it = C.items.length === 1 ? C.items[0] : null;
  if (it) $("#thumb").innerHTML = it.thumb ? `<img alt="" src="${it.thumb}">` : window.icon(iconOf(it));
}
// The whole file as an object URL (pictures; a video or a sound small enough to play from memory)
async function full(it) {
  if (!it.full) it.full = urlOf(it, new Blob([await HAL.invoke("convert_read", { path: it.path })], { type: MIME[it.src.format] || "" }));
  return it.full;
}
const MIME = { mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime", mp3: "audio/mpeg", wav: "audio/wav", flac: "audio/flac", ogg: "audio/ogg", opus: "audio/ogg", m4a: "audio/mp4", aac: "audio/aac" };
// What the window plays itself: H.264, VP8/9 or AV1 in MP4, WebM or MOV up to 150 MB; common sound up to 80 MB.
// A larger or other video shows its first frame (FFmpeg); a sound that can't play, its icon.
const PLAYS = {
  video: src => ["mp4", "m4v", "webm", "mov"].includes(src.format) && (src.size || 0) <= 150e6 && (src.streams || []).some(s => s.kind === "video" && !s.cover && ["h264", "vp8", "vp9", "av1"].includes(s.codec)),
  audio: src => ["mp3", "wav", "flac", "ogg", "opus", "m4a", "aac"].includes(src.format) && (src.size || 0) <= 80e6
};
async function renderPreview(it) {
  const el = $("#preview"), sig = it.id + ":" + (it.src ? it.src.class + (C.have.ffmpeg ? "f" : "") + (C.have.pdfium ? "p" : "") : "probing");
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  stopPlayer();
  if (!it.src) { el.innerHTML = ""; M.skeleton(el, true); return; }
  const card = extra => `<div class="icon">${window.icon(iconOf(it))}<b>${esc(it.name)}</b><small>${esc(summary(it.src))}</small>${extra || ""}</div>`;
  let html = card();
  const c = it.src.class;
  if (HAL) try {
    if (c === "image" && it.src.format !== "avif" || c === "animated") html = `<img alt="" src="${await full(it)}">`;
    else if (c === "video" && PLAYS.video(it.src)) html = `<video controls preload="metadata" src="${await full(it)}"></video>`;
    else if (c === "video" && C.have.ffmpeg) html = `<img alt="" src="${urlOf(it, await HAL.frameAt(it.path, 0, { maxW: 1280 }))}">`;
    else if (c === "audio" && PLAYS.audio(it.src)) html = card(`<div class="player"><button class="btn play" aria-label="${esc(t("cv.play"))}">${window.icon("play")}</button><canvas class="wave"></canvas><span class="time mono">0:00</span></div>`);
    else if (c === "pdf" && C.have.pdfium) html = `<img class="page" alt="" src="${urlOf(it, new Blob([await HAL.invoke("convert_pdf_preview", { path: it.path })], { type: "image/png" }))}">`;
  } catch (e) { /* the card stays */ }
  if (el.dataset.sig !== sig) return;
  M.skeleton(el, false);
  el.innerHTML = html;
  const pl = el.querySelector(".player");
  if (pl) player(pl, it, sig).catch(() => { if (el.dataset.sig === sig) pl.remove(); });
  // a video the window can't decode after all: its first frame instead
  const v = el.querySelector("video");
  if (v) v.addEventListener("error", async () => {
    if (el.dataset.sig !== sig) return;
    try { el.innerHTML = C.have.ffmpeg ? `<img alt="" src="${urlOf(it, await HAL.frameAt(it.path, 0, { maxW: 1280 }))}">` : card(); } catch (e) { el.innerHTML = card(); }
  }, { once: true });
}
// A sound's player: decoded whole (Web Audio, so a file with a wrong header still plays and seeks), its waveform the
// bar to click or drag through, the time beside it
let live = null, playerGeneration = 0;
function stopPlayer() { playerGeneration++; if (live) { live.stop(); live = null; } }
window.__ui.onAway(() => live?.pause());
addEventListener("pagehide", stopPlayer, { once: true });
async function player(box, it, sig) {
  const generation = playerGeneration;
  const ab = await (await fetch(await full(it))).arrayBuffer();
  if (generation !== playerGeneration || $("#preview").dataset.sig !== sig) return;
  const ac = new AudioContext();
  await ac.suspend();
  let buf; try { buf = await ac.decodeAudioData(ab); } catch (e) { ac.close(); throw e; }
  if (generation !== playerGeneration || $("#preview").dataset.sig !== sig) { ac.close(); return; }
  const cv = box.querySelector(".wave"), btn = box.querySelector(".play"), time = box.querySelector(".time"), dur = buf.duration;
  const css = getComputedStyle(document.documentElement);
  const on = css.getPropertyValue("--accent").trim(), off = css.getPropertyValue("--text-3").trim();
  let src = null, from = 0, t0 = 0, raf = 0, peaks = null, lastDraw = -Infinity;
  const now = () => src ? Math.min(dur, from + ac.currentTime - t0) : from;
  function draw() {
    if (window.__ui.away) return;
    const w = cv.clientWidth, h = cv.clientHeight, dpr = window.devicePixelRatio || 1;
    if (!w) return;
    if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); peaks = null; }
    const n = Math.max(1, Math.floor(w / 3));
    if (!peaks) {
      peaks = new Float32Array(n);
      const step = Math.max(1, Math.floor(buf.length / n));
      for (let ch = 0; ch < Math.min(2, buf.numberOfChannels); ch++) {
        const d = buf.getChannelData(ch);
        for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step, e = Math.min(d.length, j + step); j < e; j += 4) m = Math.max(m, Math.abs(d[j])); peaks[i] = Math.max(peaks[i], m); }
      }
      const top = Math.max(...peaks) || 1;
      for (let i = 0; i < n; i++) peaks[i] /= top;
    }
    const g = cv.getContext("2d"), at = dur ? now() / dur : 0;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    for (let i = 0; i < n; i++) { const bh = Math.max(2, peaks[i] * (h - 4)); g.fillStyle = i / n < at ? on : off; g.fillRect(i * 3, (h - bh) / 2, 2, bh); }
    const label = clock(now()) + " / " + clock(dur);
    if (time.textContent !== label) time.textContent = label;
  }
  function tick(t) { raf = 0; if (!src || window.__ui.away) return; if (t - lastDraw >= 1000 / 60 - 1) { lastDraw = t; draw(); } raf = requestAnimationFrame(tick); }
  function play(at) {
    halt();
    if (window.__ui.away) return;
    if (at >= dur - 0.05) at = 0;
    src = ac.createBufferSource(); src.buffer = buf; src.connect(ac.destination);
    from = at; t0 = ac.currentTime; src.start(0, at);
    const me = src;
    src.onended = () => { if (src === me) { from = now(); src = null; if (from >= dur - 0.05) from = dur; cancelAnimationFrame(raf); sleepAudio(); paint(); } };
    ac.resume().then(() => { if (!src || window.__ui.away) sleepAudio(); }).catch(() => {}); paint(); raf = requestAnimationFrame(tick);
  }
  function sleepAudio() { if (ac.state === "running") ac.suspend().catch(() => {}); }
  function halt() { if (src) { const s = src; from = now(); src = null; s.onended = null; try { s.stop(); } catch (e) {} } cancelAnimationFrame(raf); sleepAudio(); }
  function paint() { btn.innerHTML = window.icon(src ? "pause" : "play"); btn.setAttribute("aria-label", t(src ? "cv.pause" : "cv.play")); draw(); }
  btn.addEventListener("click", () => { if (src) { halt(); paint(); } else play(from); });
  // click or drag along the waveform: the sound goes there (and keeps playing if it was)
  const seek = e => { const r = cv.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * dur; };
  cv.addEventListener("pointerdown", e => {
    const was = !!src; halt(); from = seek(e); draw(); cv.setPointerCapture(e.pointerId);
    const mv = ev => { from = seek(ev); draw(); };
    const up = () => { cv.removeEventListener("pointermove", mv); if (was) play(from); else paint(); };
    cv.addEventListener("pointermove", mv); cv.addEventListener("pointerup", up, { once: true }); cv.addEventListener("pointercancel", up, { once: true });
  });
  const resize = new ResizeObserver(() => draw()); resize.observe(cv);
  live = { pause: () => { halt(); paint(); }, stop: () => { halt(); resize.disconnect(); ac.close(); } };
  paint();
}
// What a format gives, under its name: the quality and settings Converter uses (convert.rs, fixed, no controls) and
// what it is good for. By the kind of output: audio (a song, or a video's sound), video, animation, picture, PDF pages,
// documents.
const DESC = { audio: "a", video: "v", animated: "anim", image: "i", pdf: "pdf" };
const descOf = (src, o) => { const k = `cv.d.${o.audio ? "a" : DESC[src.class] || "doc"}.${o.id}`, v = t(k); return v === k ? "" : v; };
// The outputs as radio rows (or chips in a batch): the recommended first with its badge, a video's audio outputs
// folded under "Audio only" (open when one of them is chosen); a row says what its format gives (desc)
function outsHtml(outs, value, name, rec, busy, group, desc) {
  const label = o => { const d = desc && desc(o); return d ? `<span class="otext"><b>${fmt(o.id)}</b><small>${esc(d)}</small></span>` : `<b>${fmt(o.id)}</b>`; };
  const row = o => `<label class="out"><input type="radio" name="${name}" value="${outKey(o)}"${group ? ` data-group="${group}"` : ""}${outKey(o) === value ? " checked" : ""}${busy ? " disabled" : ""}>${label(o)}` +
    (outKey(o) === rec && !group ? `<span class="rec">${esc(t("cv.recommended"))}</span>` : "") + `</label>`;
  const main = outs.filter(o => !o.audio), audio = outs.filter(o => o.audio), chosen = outs.find(o => outKey(o) === value);
  return `<div class="outs" role="radiogroup">${main.map(row).join("")}</div>` +
    (audio.length ? `<details class="more"${chosen && chosen.audio ? " open" : ""}><summary>${esc(t("cv.audioOnly"))}</summary><div class="outs" role="radiogroup">${audio.map(row).join("")}</div></details>` : "");
}
// The choices are rebuilt only when what they offer changes (a details opened, the focus stay where they are)
function paintChoices(sig, html) {
  const el = $("#choices");
  if (el.dataset.sig !== sig) { el.dataset.sig = sig; el.innerHTML = html; }
}
// The consequence line: what Converter will do, by priority (convert.rs plan notes)
const conseq = o => o ? (o.notes || []).map(n => t("cv.note." + n)).join(" · ") : "";
const busyOf = it => it.state === "queued" || it.state === "running";
function renderOne(it) {
  $("#oneName").textContent = it.name;
  $("#oneType").textContent = summary(it.src);
  paintThumb();
  renderPreview(it);
  const outs = it.src ? ordered(it.src) : [];
  $("#cant").hidden = it.state === "probing" || outs.length > 0;
  $("#cant").textContent = it.probeError ? t("cv.cantWhy", { error: it.probeError }) : t("cv.cant");
  if (!outs.length) { paintChoices("none", ""); return; }
  const busy = busyOf(it);
  paintChoices([it.id, outs.map(outKey).join(","), busy].join("|"),
    `<p class="to" id="toLbl">${esc(t("cv.to"))}</p>${outsHtml(outs, it.target, "to", recommended(it.src), busy, undefined, o => descOf(it.src, o))}<p class="note conseq" id="conseq"></p>`);
  const r = $(`#choices input[name="to"][value="${it.target}"]`);
  if (r) r.checked = true;
  $("#conseq").textContent = conseq(outOf(it.src, it.target));
}
$("#choices").addEventListener("change", e => {
  const r = e.target.closest("input[type=radio]"); if (!r) return;
  if (r.name === "to") {
    const it = C.items[0]; if (!it) return;
    it.target = r.value; it.state = "ready";
  } else if (r.dataset.group) {
    C.groups[r.dataset.group] = r.value;
    for (const it of C.items) if (it.src && it.src.class === r.dataset.group && !busyOf(it)) { it.target = r.value; if (it.state !== "done") it.state = "ready"; }
  }
  render(); HAL?.session?.schedule("convert");
});

/* ===== batch ===== */
// Several files: on the left the list grouped by class, on the right one Convert to per group (chips) with the outputs
// every file of it has
const CLASSES = ["video", "audio", "image", "animated", "document", "sheet", "slides", "markup", "pdf", "unsupported"];
function groupsOf() {
  const g = new Map();
  for (const it of C.items) { const k = it.src ? it.src.class : "probing"; if (!g.has(k)) g.set(k, []); g.get(k).push(it); }
  return [...g.entries()].sort((a, b) => CLASSES.indexOf(a[0]) - CLASSES.indexOf(b[0]));
}
function common(list) {
  const ready = list.filter(it => it.src);
  if (!ready.length) return [];
  const outs = ordered(ready[0].src);
  return outs.filter(o => ready.every(it => outOf(it.src, outKey(o))));
}
// Outputs common to a group (the first file's recommended one first), and per file the notes of its own plan
function groupTarget(cls, list) {
  const outs = common(list);
  let v = C.groups[cls];
  if (!outs.some(o => outKey(o) === v)) v = outs.length ? outKey(outs[0]) : null;
  C.groups[cls] = v;
  for (const it of list) if (it.state === "ready" || it.state === "failed" || it.state === "cancelled" || it.state === "done") it.target = v && outOf(it.src, v) ? v : it.target;
  return { outs, v };
}
function stateText(it) {
  switch (it.state) {
    case "probing": return t("common.loading");
    case "queued": return t("cv.st.queued");
    case "running": return it.progress != null ? Math.round(it.progress * 100) + " %" : t("cv.st.running");
    case "done": return bytes(it.bytesOut);
    case "failed": return t("cv.st.failed");
    case "cancelled": return t("cv.st.cancelled");
    default: return it.src && it.src.class !== "unsupported" ? bytes(it.src.size) : "";
  }
}
function rowHtml(it) {
  const reveal = it.state === "done" ? `<button class="btn ghost sm" data-reveal="${it.id}" data-icon="folder-open" title="${esc(t("cv.openFolder"))}" aria-label="${esc(t("cv.openFolder"))}"></button>` : "";
  return `<li data-id="${it.id}" class="${it.state}"><span class="nm">${esc(it.name)}<small>${esc([it.rel, ...summary(it.src).split(" · ").slice(1)].filter(Boolean).join(" · "))}</small></span>` +
    `<span class="st"><span class="sv">${esc(stateText(it))}</span>${reveal}</span>` +
    (it.state === "running" ? `<div class="prog"><i></i></div>` : "") + (it.error ? `<p class="err">${esc(it.error)}</p>` : "") + `</li>`;
}
function renderBatch() {
  const n = C.items.length, done = C.items.filter(it => it.state === "done").length, groups = groupsOf();
  $("#batchTitle").textContent = done ? t("cv.filesDone", { n, done }) : t("cv.files", { n });
  $("#groups").innerHTML = groups.map(([cls, list]) =>
    `<section class="group" data-class="${cls}"><h3>${esc(cls === "probing" ? t("common.loading") : t("cv.group." + cls))} <span class="n">${list.length}</span></h3>` +
    (cls === "unsupported" ? `<p class="note cantSome">${esc(t("cv.cantSome"))}</p>` : "") + `<ul class="files">${list.map(rowHtml).join("")}</ul></section>`).join("");
  __icons.apply($("#groups"));
  for (const it of C.items) if (it.state === "running") patchRow(it);
  // the panel: a choice per group that has outputs
  const picks = groups.filter(([cls]) => cls !== "probing" && cls !== "unsupported").map(([cls, list]) => ({ cls, list, busy: list.some(busyOf), ...groupTarget(cls, list) }));
  paintChoices(picks.map(g => g.cls + ":" + g.outs.map(outKey).join(",") + ":" + g.busy).join("|"), picks.map(g =>
    `<div class="gchoice" data-class="${g.cls}"><h3>${esc(t("cv.group." + g.cls))} · ${esc(t("cv.to"))}</h3>` +
    (g.outs.length ? `<div class="chips">${outsHtml(g.outs, g.v, "g-" + g.cls, null, g.busy, g.cls)}</div><p class="note conseq"></p>` : `<p class="note cant">${esc(t("cv.noCommon"))}</p>`) + `</div>`).join(""));
  for (const g of picks) {
    const box = $(`#choices .gchoice[data-class="${g.cls}"]`); if (!box) continue;
    const r = box.querySelector(`input[value="${g.v}"]`); if (r) r.checked = true;
    const c = box.querySelector(".conseq"); if (c) c.textContent = conseq(outOf(g.list[0].src, g.v));
  }
}
$("#groups").addEventListener("click", e => {
  const b = e.target.closest("[data-reveal]"); if (!b) return;
  const it = C.items.find(x => x.id === +b.dataset.reveal);
  if (it && it.out) HAL.invoke("reveal_path", { path: it.out }).catch(err => setStatus(oneLine(err), "bad"));
});
// A running file's row: its % and bar only (the list is not rebuilt while it runs)
function patchRow(it) {
  const li = document.querySelector(`.files li[data-id="${it.id}"]`); if (!li) return;
  const sv = li.querySelector(".sv"); if (sv && sv.textContent !== stateText(it)) sv.textContent = stateText(it);
  const bar = li.querySelector(".prog i"); if (bar && it.progress != null) M.bar(bar, it.progress);
}

/* ===== foot ===== */
// Destination behavior is owned by global Settings, shared with every tool.
function renderDest() { $("#destSettings").onclick = () => HAL.show("settings"); }
// The files that would be converted now, and the components missing for them (in install order)
const pending = () => C.items.filter(it => it.target && it.src && it.state !== "probing" && it.state !== "queued" && it.state !== "running" && it.state !== "done");
function missing(list) {
  const want = new Set();
  for (const it of list) {
    const o = outOf(it.src, it.target);
    for (const k of (o && o.tools) || []) want.add(k);
    if (it.src.needsFfmpeg) want.add("ffmpeg");
  }
  return COMPONENTS.filter(k => want.has(k) && !C.have[k]);
}
const MB = id => ((window.__modules || (window.parent && window.parent.__modules) || { COMPONENTS: [] }).COMPONENTS.find(c => c.id === id) || { mb: 0 }).mb;
const listOf = ids => ids.map(id => t("cv.comp." + id)).join(" + ");
function paintFoot() {
  const list = pending(), need = missing(list.length ? list : C.items.filter(it => it.target));
  M.reveal($("#need"), !!need.length);
  if (need.length) $("#needNote").textContent = t("cv.needs", { list: listOf(need), mb: need.reduce((a, id) => a + MB(id), 0) });
  const btn = $("#convertBtn"), one = C.items.length === 1 ? C.items[0] : null, running = !!one && one.state === "running";
  btn.disabled = !running && (!list.length || !!need.length);
  // one file converting: the button's fill is its progress and its label the %
  btn.classList.toggle("running", running);
  const bar = $("#bar");
  if (!running && bar.dataset.v && bar.dataset.v !== "0") { M.gsap.killTweensOf(bar); M.gsap.set(bar, { xPercent: -100 }); bar.dataset.v = "0"; bar.style.setProperty("--v", "0"); }
  setLabel(running ? t("cv.st.converting", { pct: Math.round((one.progress || 0) * 100) }) : one && one.state === "queued" ? t("cv.st.queued") : C.items.length > 1 ? t("cv.convertAll", { n: list.length }) : t("cv.convert"));
  $("#cancelBtn").hidden = !C.live.size;
  const last = C.last && C.items.includes(C.last) && C.last.state === "done" ? C.last : null;
  M.reveal($("#done"), !!last && C.items.length === 1);
  if (last) $("#sizes").textContent = last.files > 1 ? t("cv.pagesDone", { n: last.files, b: bytes(last.bytesOut) }) : t("cv.sizes", { a: bytes(last.src.size), b: bytes(last.bytesOut) });
  // documents go nowhere else in Halation
  $("#sendBtn").hidden = !!last && kindOf(last.src, last.target) === "document";
}
// While the button says "Queued" for a moment (processes.js launched) its label is away; what comes back is this one
function setLabel(text) {
  const label = $("#convertLabel"), btn = $("#convertBtn");
  if (label && label.textContent !== text) label.textContent = text;
  if (btn.__launch) btn.__launch.html = btn.__launch.html.replace(/(<span id="convertLabel"[^>]*>)[^<]*/, (m, a) => a + esc(text));
}
function render() {
  const n = C.items.length;
  $("#empty").hidden = n > 0; $("#stage").hidden = !n;
  $("#preview").hidden = n !== 1; $("#batch").hidden = n < 2;
  $("#side .head").hidden = n !== 1;
  if (!n) { $("#preview").dataset.sig = ""; $("#choices").dataset.sig = ""; }
  if (n === 1) renderOne(C.items[0]);
  if (n > 1) renderBatch();
  renderDest(); paintFoot();
}
// Install: the missing components one after another (LibreOffice is the big one), then every file probed again so
// what they make now shows without restarting
$("#installBtn").addEventListener("click", async () => {
  const btn = $("#installBtn"), need = missing(pending().length ? pending() : C.items.filter(it => it.target));
  if (!need.length) return;
  btn.disabled = true; $("#installProg").hidden = false;
  try {
    for (const id of need) {
      setStatus(t("cv.installing", { name: t("cv.comp." + id) }), "warn"); M.bar($("#installBar"), 0);
      const st = await HAL.installTool(id, p => { if (p.total) M.bar($("#installBar"), p.done / p.total); });
      haveFrom(st); C.have[id] = true;
    }
    setStatus(t("cv.installed"), "ok"); retryLabel(btn, "cv.install", false);
    for (const it of C.items) if (it.src && it.src.class !== "image") { it.thumb = null; await probeItem(it); }
  } catch (e) { setStatus(t("cv.err.install", { error: oneLine(e) }), "bad"); retryLabel(btn, "cv.install", true); }
  btn.disabled = false; $("#installProg").hidden = true;
  render();
});
if (HAL) HAL.on("tools", st => {
  const before = { ...C.have }; haveFrom(st);
  if (COMPONENTS.some(k => C.have[k] && !before[k])) Promise.all(C.items.filter(it => it.src && it.src.class !== "image").map(probeItem)).then(render);
});

/* ===== job ===== */
// One job per file (a group when there are several): images and stream copies in the light lane, audio on the CPU,
// video re-encodes on the CPU at twice the cost. The output is written as name.ext.part and renamed at the end.
const said = (text, cancelled) => Object.assign(new Error(text), { said: true, cancelled: !!cancelled });
async function convert() {
  const list = pending();
  if (!list.length || missing(list).length || !HAL) return;
  await HAL?.session?.start("convert");
  const group = list.length > 1 ? "convert-" + Date.now().toString(36) : null;
  setStatus(t("cv.st.queued"), "warn");
  let first = null;
  for (const it of list) {
    const o = outOf(it.src, it.target), cls = it.src.class;
    const doc = DOCS.includes(cls);
    const light = o.copy || cls === "image" || (!o.ffmpeg && !doc);
    const snap = { path: it.path, name: it.name, rel: it.rel, target: o.id, audio: !!o.audio, kind: kindOf(it.src, it.target), from: realPath(it) ? [it.path] : [], work: it.src.format === "avif" || (doc && cls !== "pdf") };
    it.state = "queued"; it.progress = null; it.error = null; it.out = null;
    const handle = HAL.jobs.submit({
      tool: "convert", kind: light ? "convert-light" : doc ? "convert-document" : cls === "video" && !o.audio ? "convert-video" : "convert-audio",
      title: it.name, detail: fmt(o.id), lane: light ? "light" : "cpu", cost: !light && cls === "video" && !o.audio ? 2 : 1,
      priority: "normal", group, groupTitle: group ? t("cv.groupTitle", { n: list.length }) : "",
      run: ctx => work(ctx, it, snap)
    });
    it.job = handle.id; C.live.add(handle.id); first = first || handle;
    handle.done.then(() => { it.state = "done"; C.last = it; }, e => {
      const off = e && (e.cancelled || e.name === "AbortError");
      it.state = off ? "cancelled" : "failed"; it.error = off ? null : (e && e.said ? e.message : oneLine(e));
    }).then(() => {
      C.live.delete(handle.id); it.progress = null;
      if (!C.live.size) finished(list);
      render();
    });
  }
  render();
  if (HAL.jobLaunched && first) HAL.jobLaunched($("#convertBtn"), first, { tool: "convert" });
}
function finished(list) {
  const ok = list.filter(it => it.state === "done").length, bad = list.filter(it => it.state === "failed"), off = list.some(it => it.state === "cancelled");
  if (list.length === 1) {
    const it = list[0];
    if (it.state === "done") setStatus(t("cv.st.done", { name: it.out.split(/[\\/]/).pop() }), "ok");
    else if (it.state === "failed") setStatus(t("cv.err.failed", { error: it.error }), "bad");
    else setStatus(t("cv.st.cancelled"));
  } else setStatus(t(bad.length ? "cv.st.batchBad" : off ? "cv.st.batchCancelled" : "cv.st.batchDone", { ok, total: list.length, bad: bad.length }), bad.length ? "bad" : ok ? "ok" : "");
}
const progressItems = new Set();
let progressTimer = 0, progressWaiting = false;
function paintProgress() {
  progressTimer = 0;
  if(window.__ui.away){if(!progressWaiting){progressWaiting=true;window.__ui.whenBack(()=>{progressWaiting=false;paintProgress();});}return;}
  for(const it of progressItems) {
    if(it.state!=="running" || !C.items.includes(it))continue;
    if(C.items.length===1){M.bar($("#bar"),it.progress);setLabel(t("cv.st.converting",{pct:Math.round(it.progress*100)}));}
    else patchRow(it);
  }
  progressItems.clear();
}
function progress(ctx, it, p) {
  ctx.progress(p);it.progress=p;progressItems.add(it);
  if(!progressTimer&&!progressWaiting)progressTimer=setTimeout(paintProgress,100);
}
// FFmpeg with -progress pipe:1: out_time_us over the duration is the %; its last error line says what failed
async function ff(ctx, args, duration, it) {
  const tail = [];
  const p = await ctx.proc("ffmpeg", args, (line, stream) => {
    const m = /^out_time_(?:us|ms)=(\d+)/.exec(line);
    if (m) { if (duration > 0) progress(ctx, it, Math.min(1, +m[1] / 1e6 / duration)); return; }
    if (stream === "err" && line && !/^\s/.test(line)) { tail.push(line); if (tail.length > 12) tail.shift(); }
  });
  const code = await p.done;
  if (ctx.signal.aborted) throw said(t("cv.st.cancelled"), true);
  if (code !== 0) throw said(t("cv.err.ffmpeg", { error: tail.filter(l => !/^(Input|Output|Stream|Duration|Metadata|Press)/.test(l)).pop() || t("cv.err.code", { code }) }));
}
// A document's steps (LibreOffice, Pandoc), one after the other; neither reports progress, so the bar moves by step.
// LibreOffice ends with 0 even when it could not convert: convert_finish then finds nothing and says so.
async function steps(ctx, list, it) {
  for (let i = 0; i < list.length; i++) {
    const tail = [];
    const p = await ctx.proc(list[i].tool, list[i].args, (line, stream) => { if (stream === "err" && line.trim()) { tail.push(line.trim()); if (tail.length > 8) tail.shift(); } });
    const code = await p.done;
    if (ctx.signal.aborted) throw said(t("cv.st.cancelled"), true);
    const name = t(list[i].tool === "soffice" ? "cv.comp.libreoffice" : "cv.comp.pandoc");
    if (code !== 0) throw said(t("cv.err.engine", { name, error: tail.filter(l => !/^\[?WARNING/i.test(l)).pop() || t("cv.err.code", { code }) }));
    progress(ctx, it, (i + 1) / list.length);
  }
}
async function work(ctx, it, snap) {
  it.state = "running"; it.progress = 0;
  if (C.items.length === 1) setStatus("");
  render();
  const workdir = snap.work ? await ctx.workdir() : null;
  const p = await HAL.exportLocation.prepare(() => HAL.invoke("convert_prepare", { request: { path: snap.path, name: snap.name, target: snap.target, audio: snap.audio, rel: snap.rel || null, work: workdir } }));
  try {
    if (p.engine === "ffmpeg") await ff(ctx, p.args, p.duration, it);
    else if (p.engine === "docs") await steps(ctx, p.steps, it);
    else if (p.engine === "pdf") {
      for (let page = 0; page < p.pages; page++) {
        if (ctx.signal.aborted) throw said(t("cv.st.cancelled"), true);
        await HAL.invoke("convert_pdf_page", { source: p.source, target: snap.target, part: p.part, page });
        progress(ctx, it, (page + 1) / p.pages);
      }
    } else {
      if (p.decode) await ff(ctx, p.decode, 0, it);
      await HAL.invoke("convert_image", { source: p.source, target: snap.target, part: p.part });
    }
    if (ctx.signal.aborted) throw said(t("cv.st.cancelled"), true);
    const r = await HAL.invoke("convert_finish", { part: p.part, from: p.result || null });
    await HAL.exportLocation.success(r.path);
    it.out = r.path; it.bytesOut = r.size; it.files = (r.files || []).length;
    it.first = it.files ? r.files[0] : r.path;
    const kind = snap.kind === "document" ? undefined : snap.kind;
    for (const f of it.files ? r.files : [r.path]) ctx.output(f, { kind, from: snap.from });
    HAL.session?.recordExport?.("convert", { path: it.first, name: it.first.split(/[\\/]/).pop(), kind: snap.kind });
  } catch (e) {
    await HAL.invoke("convert_discard", { part: p.part }).catch(() => {});
    throw e;
  }
}
$("#convertBtn").addEventListener("click", convert);
// Cancel: the file converting stops and the queue empties
$("#cancelBtn").addEventListener("click", () => { if (!C.live.size) return; setStatus(t("common.cancelling")); for (const id of [...C.live]) HAL.jobs.cancel(id); });

/* ---------- result ---------- */
const resultItem = async () => {
  const it = C.last; if (!it || !it.out) return null;
  const kind = kindOf(it.src, it.target), file = it.first || it.out, name = file.split(/[\\/]/).pop();
  if (kind === "video") return { kind, name, path: file };
  const blob = new Blob([await HAL.invoke("convert_read", { path: file })]);
  return { kind, name, path: file, blob };
};
window.__ui.sendMenu($("#sendBtn"), () => ({ kind: C.last ? kindOf(C.last.src, C.last.target) : "image", from: "convert", item: resultItem }));
$("#revealBtn").addEventListener("click", () => { if (C.last && C.last.out) HAL.invoke("reveal_path", { path: C.last.out }).catch(e => setStatus(oneLine(e), "bad")); });

window.__convert = { C, summary, render, addFiles, convert };
const take = it => addFiles([it.path ? { path: it.path, name: it.name } : new File([it.blob], it.name || "file", { type: it.blob && it.blob.type || "" })]);
window.__halApp = {
  session: {
    capture: async () => ({ items: C.items.filter(it => it.path && realPath(it)).map(it => ({ path: it.path, name: it.name, rel: it.rel, target: it.target })) }),
    restore: async d => {
      clearAll();
      const list = [];
      for (const x of (d && d.items) || []) { try { await HAL.invoke("session_allow_video", { path: x.path }); list.push(x); } catch (e) { /* gone */ } }
      await addFiles(list.map(x => ({ path: x.path, name: x.name, rel: x.rel })));
      for (const x of list) { const it = C.items.find(i => i.path === x.path); if (it && outOf(it.src, x.target)) it.target = x.target; }
      render();
    }
  },
  ready: (async () => {
    if (HAL) {
      await HAL.ready;
      try { haveFrom(await HAL.tools(false)); } catch (e) {}
    }
    render();
  })(),
  takeImage: take, takeAudio: take, takeVideo: take,
  // files dropped on the processes island: added to the list (the format is still to choose)
  enqueue: async files => addFiles(files),
  result: () => C.last && C.last.out && kindOf(C.last.src, C.last.target) !== "document" ? { kind: kindOf(C.last.src, C.last.target), name: (C.last.first || C.last.out).split(/[\\/]/).pop(), path: C.last.first || C.last.out } : null,
  flush: async () => {},
  busy: () => HAL.jobs.busy("convert"),
  idle: () => !C.live.size && !C.items.length
};
})();
