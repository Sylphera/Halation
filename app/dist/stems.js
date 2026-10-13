"use strict";
// Vocal Remover: songs split into vocals and instrumental, or into vocals, drums, bass and other
// (docs/VOCAL_REMOVER_SPEC.md).

/* ===== state ===== */
// The model (UVR-MDX-NET Inst HQ4, or HTDemucs for 4 stems) runs in the main process (stems.rs, stems_separate) on ONNX
// Runtime with DirectML or on the CPU; each song is a job of the jobs system, one at a time (serial "stems"), all of a "Separate all" in one
// group. The waveform arrives chunk by chunk (event "stems-progress", forwarded by the main window as "stems"); the
// stems wait as 32-bit float WAV in the workspace's temp until exported with FFmpeg to Exports\Stems\<song>.
(() => {
"use strict";
__i18n.apply(document);
__icons.apply(document);
const { $, esc, setStatus } = window.__ui;
const HAL = window.__hal || (window.parent && window.parent.__hal) || null;
const M = window.__motion;
const t = window.t;
document.body.dataset.drop = t("st.drop");

const MEDIA = /\.(mp3|wav|flac|m4a|aac|ogg|oga|opus|wma|aif|aiff|mp4|mov|mkv|webm|avi|m4v)$/i;
// the two ways to split a song: the model's component, its credit (and notice), the tracks shown, vocals first
const MODES = {
  hq4: { comp: "stems-hq4", note: "st.credit", tracks: ["vocals", "instrumental"] },
  htdemucs: { comp: "stems-htdemucs", note: "st.credit.htdemucs", tracks: ["vocals", "drums", "bass", "other"] }
};
const ALL = ["vocals", "instrumental", "drums", "bass", "other"];
// items: the queue's songs { id, name, path, mode, state (waiting | queued | running | done | error | cancelled), pct,
// error, job, device, eta, wave { total, filled, peaks { track: [] } }, res (stems_separate's answer), folder (exported to) }
const Q = { items: [], sel: null, group: null, seq: 0 };
// the mode the next songs run in, export options, the lanes' Mute / Solo and volume in dB (by track, the same for every
// song), and what the player plays: the stems ("sep") or the song as it came in ("orig")
// Export destinations come from global Settings; these options only describe audio processing.
const opts = { mode: "hq4", format: "wav", rate: "44100", out: { mix: false }, auto: true, mute: {}, solo: {}, vol: {}, ab: "sep" };
// the components' download sizes in MB (modules.js COMPONENTS), for the mode tiles
const MB = { onnxruntime: 36, "stems-hq4": 59, "stems-htdemucs": 170 };
// a song's tracks: its own mode once it ran, else the mode chosen
const tracksOf = it => MODES[(it && it.mode) || opts.mode].tracks;
// the GPU failed once in this run: the next songs go straight to the CPU lane
let cpuSeen = false, tools = null;
const up = {};
const oneLine = e => String(e && e.message || e).split(/\r?\n/).map(s => s.trim()).filter(Boolean).pop() || "";
const stemOf = n => String(n || "song").replace(/\.[^.]+$/, "");
const clock = s => { s = Math.max(0, s || 0); const m = Math.floor(s / 60); return `${m}:${String(Math.floor(s - m * 60)).padStart(2, "0")}`; };
const byJob = new Map();
// Hidden jobs keep their logical result/progress; rebuild the presentation only on return.
let presentationWaiting = false;
function deferPresentation() {
  if (!window.__ui.away) return false;
  if (!presentationWaiting) {
    presentationWaiting = true;
    window.__ui.whenBack(() => { presentationWaiting = false; renderQueue(); select(Q.sel); });
  }
  return true;
}
const settingCpu = () => !!(HAL && HAL.settings && (HAL.settings().processing || {}).stems === "cpu");
const isMedia = f => MEDIA.test(f.name || f.path || "") || /^(audio|video)\//.test(f.type || "");
// a lane is heard when it is soloed, or when none of the song's lanes is soloed and it is not muted
const audible = (k, tracks = tracksOf(Q.sel)) => tracks.some(x => opts.solo[x]) ? !!opts.solo[k] : !opts.mute[k];
// a lane's volume: -30 dB and below is silence; +6 dB at most
const VOL_MIN = -30, VOL_MAX = 6;
const volOf = k => Math.max(VOL_MIN, Math.min(VOL_MAX, +opts.vol[k] || 0));
const dbGain = d => d <= VOL_MIN ? 0 : Math.pow(10, d / 20);
const dbText = d => d <= VOL_MIN ? t("st.dbOff") : t("st.db", { v: (d > 0 ? "+" : "") + d.toFixed(1) });
const gainOf = k => audible(k) ? dbGain(volOf(k)) : 0;
// the components the chosen mode needs (tools_status)
const needs = () => ["ffmpeg", "onnxruntime", MODES[opts.mode].comp];
const missing = () => needs().filter(id => !tools || !tools[id]);

/* ===== queue ===== */
// Songs in: files (a path, or a File copied to the temp folder by the main window), a folder's media, the Library
// at most MAX songs in the list: those over it are left out and the drop place says so
const MAX = 8;
async function addFiles(list) {
  const media = [...list].filter(isMedia), files = media.slice(0, Math.max(0, MAX - Q.items.length));
  const out = media.length - files.length;
  if (!files.length) { if (out || list.length) dropNote(out ? t("st.full", { n: out, max: MAX }) : t("st.err.notAudio"), "bad"); return []; }
  const added = [];
  for (const f of files) {
    const it = { id: "s" + (++Q.seq), name: f.name || String(f.path).split(/[\\/]/).pop(), src: f, path: typeof f.path === "string" ? f.path : f.__halPath || null, state: "waiting", pct: 0 };
    Q.items.push(it); added.push(it);
  }
  if (!Q.sel) up.select(added[0]);
  if (out) dropNote(t("st.full", { n: out, max: MAX }), "bad");
  renderQueue();
  HAL?.session?.schedule("stems");
  // songs added are separated at once with the mode chosen (a run going on takes them into its group); with the engine
  // missing they wait, and start when it is installed
  if (Q.group && Q.items.some(x => x.state === "queued" || x.state === "running")) for (const it of added) up.submit(it);
  else up.runAll(null);
  return added;
}
function remove(it) {
  if (it.job && (it.state === "queued" || it.state === "running")) HAL.jobs.cancel(it.job);
  if (it.res) HAL.invoke("stems_clean", { dir: it.res.dir }).catch(() => {});
  Q.items = Q.items.filter(x => x !== it);
  if (Q.sel === it) up.select(Q.items.find(x => x.state === "done") || Q.items[0] || null);
  renderQueue(); HAL?.session?.schedule("stems");
}
const ICON = { waiting: "circle", queued: "circle", running: "audio-lines", done: "check", error: "circle-alert", cancelled: "x" };
function rowText(it) {
  if (it.state === "running") return it.pct ? t("st.q.running", { pct: Math.round(it.pct * 100) }) : t("st.q.starting");
  if (it.state === "error") return it.error || t("st.q.error");
  if (it.state === "done" && !it.res) return t("st.q.restored");
  if (it.state === "done") return t("st.q.done") + " · " + t("st.n", { n: tracksOf(it).length });
  return t("st.q." + it.state);
}
function renderQueue() {
  if (deferPresentation()) return;
  const ul = $("#queue");
  M.list(ul, () => {
    ul.replaceChildren(...Q.items.map(it => {
      const li = document.createElement("li");
      li.className = "qrow"; li.dataset.key = it.id; li.dataset.state = it.state;
      li.setAttribute("role", "tab"); li.setAttribute("aria-current", String(Q.sel === it)); li.setAttribute("aria-selected", String(Q.sel === it));
      li.draggable = it.state === "waiting" || it.state === "queued";
      li.innerHTML = `<span class="no">${Q.items.indexOf(it) + 1}</span><span class="st">${window.icon(ICON[it.state])}</span><span class="nm"><b></b><span></span></span><button class="btn ghost icon sm rm" data-icon="x"></button>${it.state === "running" ? '<div class="prog bar"><i></i></div>' : ""}`;
      li.querySelector("b").textContent = it.name; li.querySelector(".nm span").textContent = rowText(it);
      const rm = li.querySelector(".rm"); rm.innerHTML = window.icon("x"); rm.title = rm.ariaLabel = t("st.remove");
      rm.addEventListener("click", e => { e.stopPropagation(); remove(it); });
      li.addEventListener("click", () => up.select(it));
      if (it.state === "running") M.bar(li.querySelector(".bar i"), it.pct);
      return li;
    }));
  });
  const n = Q.items.length, done = Q.items.filter(x => x.state === "done").length;
  $("#qCount").textContent = n ? t("st.q.count", { done, n }) : "";
  $("#qEmpty").hidden = !!n;
  dropNote();
  up.buttons();
}
// the drop place: how many places are free, or why songs were left out (until the list changes)
let dropMsg = null;
function dropNote(msg, kind) {
  if (msg !== undefined) dropMsg = { msg, kind, n: Q.items.length };
  else if (dropMsg && dropMsg.n !== Q.items.length) dropMsg = null;
  const free = MAX - Q.items.length, el = $("#dropNote");
  el.textContent = dropMsg ? dropMsg.msg : free ? t("st.free", { free, max: MAX }) : t("st.fullNote", { max: MAX });
  el.className = dropMsg && dropMsg.kind === "bad" ? "bad" : "";
  $("#dropMore").setAttribute("aria-disabled", String(!free));
}
// one row's state and progress, without rebuilding the list
function paintRow(it) {
  if (deferPresentation()) return;
  const li = $("#queue").querySelector(`[data-key="${it.id}"]`);
  if (!li || li.dataset.state !== it.state) { renderQueue(); return; }
  li.querySelector(".nm span").textContent = rowText(it);
  const b = li.querySelector(".bar i"); if (b) M.bar(b, it.pct);
}
// waiting songs reorder by dragging (their jobs too, when queued)
let dragged = null;
$("#queue").addEventListener("dragstart", e => { const li = e.target.closest(".qrow"); dragged = li && Q.items.find(x => x.id === li.dataset.key); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; });
$("#queue").addEventListener("dragover", e => {
  const li = e.target.closest(".qrow"); if (!dragged || !li) return;
  e.preventDefault(); e.stopPropagation();
  $("#queue").querySelectorAll(".over").forEach(x => x.classList.remove("over")); li.classList.add("over");
});
$("#queue").addEventListener("drop", e => {
  const li = e.target.closest(".qrow"); if (!dragged || !li) return;
  e.preventDefault(); e.stopPropagation();
  const target = Q.items.find(x => x.id === li.dataset.key), it = dragged; dragged = null;
  if (!target || target === it || !(target.state === "waiting" || target.state === "queued")) { renderQueue(); return; }
  Q.items.splice(Q.items.indexOf(it), 1); Q.items.splice(Q.items.indexOf(target), 0, it);
  if (it.job && target.job && it.state === "queued") HAL.jobs.moveBefore(it.job, target.job);
  renderQueue(); HAL?.session?.schedule("stems");
});
$("#queue").addEventListener("dragend", () => { dragged = null; $("#queue").querySelectorAll(".over").forEach(x => x.classList.remove("over")); });

/* ===== ui ===== */
// The selected song in the middle: name, player, lanes; the export card follows it
function select(it) {
  if (Q.sel !== it) up.unload();
  Q.sel = it || null;
  if (deferPresentation()) { HAL?.session?.schedule("stems"); return; }
  const has = !!it;
  if (has && !$("#emptyStage").hidden) { $("#emptyStage").hidden = true; M.reveal($("#song"), true); }
  else if (!has) { $("#song").hidden = true; $("#emptyStage").hidden = false; $("#songName").textContent = t("st.noSong"); $("#songMeta").textContent = ""; setStatus(""); }
  if (has) {
    $("#songName").textContent = it.name;
    $("#songMeta").textContent = meta(it);
    $("#songNote").hidden = !(it.state === "done" && !it.res); $("#songNote").textContent = t("st.restoredNote");
    buildLanes(); paintLanes(); paintStatus(it); paintStats(it);
    if (it.state === "done" && it.res) up.load(it);
  }
  $("#queue").querySelectorAll(".qrow").forEach(li => { const on = String(!!it && li.dataset.key === it.id); li.setAttribute("aria-current", on); li.setAttribute("aria-selected", on); });
  buttons(); HAL?.session?.schedule("stems");
}
// the source's codec as people know it; PCM by the file's own type (WAV, AIFF)
const CODECS = { mp3: "MP3", aac: "AAC", flac: "FLAC", opus: "Opus", vorbis: "Vorbis", alac: "ALAC", wmav2: "WMA" };
const codecName = (c, name) => !c ? "" : CODECS[c] || (/^pcm_/.test(c) ? (/\.(\w+)$/.exec(name) || [, ""])[1].toUpperCase() : String(c).toUpperCase());
// under the name: the stems it gives
const meta = it => tracksOf(it).map(k => t("st.t." + k)).join(" · ");
// The facts under the lanes: what the song is, how it was split, where and how fast
function paintStats(it) {
  if (deferPresentation()) return;
  if (!it || Q.sel !== it) return;
  const r = it.res, src = r && r.source || {}, mode = it.mode || opts.mode;
  const rows = [
    ["len", r ? clock(r.seconds) : "—"],
    ["src", r ? [src.rate ? t("st.khz", { k: (src.rate / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }) }) : "", codecName(src.codec, it.name)].filter(Boolean).join(" · ") || "—" : "—"],
    ["model", t("st.model." + mode) + " · " + t("st.n", { n: MODES[mode].tracks.length })],
    ["dev", it.device ? t("st.dev." + it.device) : "—"],
    ["took", r ? t("st.secs", { s: Math.max(1, Math.round(r.time.total)) }) : "—"],
    ["speed", r && r.time.total ? t("st.speed", { x: (r.seconds / r.time.total).toFixed(1) }) : "—"]
  ];
  $("#stats").replaceChildren(...rows.map(([k, v]) => {
    const d = document.createElement("div");
    d.innerHTML = "<dt></dt><dd></dd>"; d.dataset.stat = k;
    d.querySelector("dt").textContent = t("st.i." + k); d.querySelector("dd").textContent = v;
    return d;
  }));
}
// "Chunk 14/33 · GPU · about 12 s left" while it runs; the device and the time it took when done
const STALL_S = 60;
function paintStatus(it) {
  if (deferPresentation()) return;
  if (!it || Q.sel !== it) return;
  const dev = it.device ? t("st.dev." + it.device) : "";
  if (it.state === "running") {
    const quiet = it.lastAt ? (Date.now() - it.lastAt) / 1000 : 0;
    if (quiet >= STALL_S) { setStatus(t(it.stage ? "st.stage." + it.stage : "st.decoding") + " · " + t("st.stalled", { s: Math.round(quiet) }), "bad"); return; }
    const left = it.eta != null ? (it.eta >= 60 ? t("st.leftMin", { m: Math.floor(it.eta / 60), s: Math.round(it.eta % 60) }) : t("st.leftSec", { s: Math.max(1, Math.round(it.eta)) })) : "";
    setStatus(it.chunks ? [t("st.chunk", { k: it.chunk, n: it.chunks }), dev, left].filter(Boolean).join(" · ") : t(it.stage ? "st.stage." + it.stage : "st.decoding"), "warn");
  } else if (it.state === "done" && it.res) setStatus([t("st.doneIn", { s: Math.round(it.res.time.total) }), dev, it.fell ? t("st.fellBack") : ""].filter(Boolean).join(" · "), it.fell ? "warn" : "ok");
  else if (it.state === "error") setStatus(it.error || "", "bad");
  else if (it.state === "cancelled") setStatus(t("st.q.cancelled"));
  else if (it.state === "queued") setStatus(t("st.q.queued"));
  else setStatus("");
}
// One lane per track of the selected song (or of the mode chosen): its name, Mute / Solo, the waveform
function buildLanes() {
  if (deferPresentation()) return;
  const tracks = tracksOf(Q.sel), box = $("#lanes");
  if (box.dataset.tracks === tracks.join()) return;
  box.dataset.tracks = tracks.join(); box.dataset.n = String(tracks.length);
  box.replaceChildren(...tracks.map(k => {
    const lane = document.createElement("div");
    lane.className = "lane"; lane.dataset.track = k;
    lane.innerHTML = `<div class="lane-h"><div class="lane-t"><i class="dot"></i><b></b><button class="ms" data-ms="mute" aria-pressed="false">${esc(t("st.muteKey"))}</button><button class="ms" data-ms="solo" aria-pressed="false">${esc(t("st.soloKey"))}</button></div>`
      + `<div class="lane-v"><input type="range" class="vol" data-def="0" min="${VOL_MIN}" max="${VOL_MAX}" step="0.5"><output class="mono"></output></div></div><div class="wave"><canvas></canvas><div class="cover sk skel"></div><i class="head"></i></div>`;
    const name = t("st.t." + k);
    lane.querySelector("b").textContent = name;
    for (const b of lane.querySelectorAll(".ms")) { b.title = t(b.dataset.ms === "mute" ? "st.mute" : "st.solo"); b.setAttribute("aria-label", `${b.title} · ${name}`); }
    const v = lane.querySelector(".vol"); v.title = t("st.volTip"); v.setAttribute("aria-label", `${t("st.vol")} · ${name}`);
    return lane;
  }));
  syncMs(); syncVol(); buildOuts(); buttons(); if (up.loaded()) paintHead();
}
// Export's track list: one row per track of the song, each with its own export
function buildOuts() {
  $("#olist").replaceChildren(...tracksOf(Q.sel).map(k => {
    const row = document.createElement("div");
    row.className = "orow"; row.dataset.track = k;
    row.innerHTML = `<i class="dot"></i><b></b><button class="btn ghost icon sm dl" data-dl="${k}">${window.icon("download")}</button>`;
    const name = t("st.t." + k), dl = row.querySelector(".dl");
    row.querySelector("b").textContent = name; dl.title = t("st.exportOne", { track: name }); dl.setAttribute("aria-label", dl.title);
    return row;
  }));
}
$("#olist").addEventListener("click", e => { const dl = e.target.closest(".dl"); if (dl) exportJob([dl.dataset.dl], dl); });
// The lanes: the waveform drawn as it arrives; a skeleton covers what has not, its edge moving with transform
function paintLanes() {
  if (deferPresentation()) return;
  const it = Q.sel;
  for (const lane of document.querySelectorAll(".lane")) {
    const k = lane.dataset.track, c = lane.querySelector("canvas"), cover = lane.querySelector(".cover");
    const w = Math.max(1, Math.round(c.clientWidth * devicePixelRatio)), h = Math.max(1, Math.round(c.clientHeight * devicePixelRatio));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext("2d"); g.clearRect(0, 0, w, h);
    const wave = it && it.wave, pts = wave && wave.peaks[k];
    if (pts && wave.total) drawWave(g, pts, wave.total, w, h, getComputedStyle(lane).getPropertyValue("--wave-c").trim());
    const filled = !it ? 0 : it.state === "done" ? 1 : wave && wave.total ? wave.filled / wave.total : 0;
    cover.hidden = !it || filled >= 1 || it.state === "error" || it.state === "cancelled";
    moveCover(cover, filled);
    lane.classList.toggle("quiet", !audible(k) || !dbGain(volOf(k)));
  }
  $("#lanes").classList.toggle("orig", opts.ab === "orig" && !!P.orig);
}
function drawWave(g, pts, total, w, h, color) {
  g.fillStyle = color || "#fff";
  const mid = h / 2, per = w / total;
  // one column per pixel (the highest point it covers), mirrored around the middle
  for (let x = 0; x < w; x++) {
    const a = Math.floor(x / per), b = Math.max(a + 1, Math.floor((x + 1) / per));
    let p = 0;
    for (let i = a; i < b && i < pts.length; i++) if (pts[i] > p) p = pts[i];
    if (!p) continue;
    const y = Math.max(0.5, Math.min(1, p) * (mid - 2));
    g.fillRect(x, mid - y, 1, y * 2);
  }
}
const coverAt = new WeakMap();
function moveCover(cover, p) {
  if (coverAt.get(cover) === p) return;
  coverAt.set(cover, p);
  const d = M.reduced() ? 0 : M.dur("spring") / 1000;
  M.gsap.to(cover, { xPercent: p * 100, duration: d, ease: M.spring(0), overwrite: "auto" });
}
new ResizeObserver(() => paintLanes()).observe($("#lanes"));
function buttons() {
  if (deferPresentation()) return;
  const live = Q.items.some(x => x.state === "queued" || x.state === "running");
  const ready = !!tools && !missing().length;
  $("#runBtn").disabled = !ready || !Q.items.some(x => pending(x, true));
  $("#sepBtn").disabled = !ready || !Q.sel || Q.sel.state === "queued" || Q.sel.state === "running";
  $("#cancelBtn").hidden = !live;
  const sel = Q.sel, done = !!sel && sel.state === "done" && !!sel.res;
  $("#exportBtn").disabled = !done;
  document.querySelectorAll("#olist .dl").forEach(b => { b.disabled = !done; });
  $("#sendBtn").disabled = !done;
  $("#reveal").hidden = !(sel && sel.folder);
  $("#playBtn").disabled = $("#scrub").disabled = !(done && up.loaded());
  const ab = !!(done && P.orig);
  document.querySelectorAll("#ab .tab").forEach(b => { b.disabled = !ab; });
}

/* ===== player ===== */
// The stems of the selected song played together through Web Audio (one clock); Mute / Solo and the volume set each
// lane's gain. The song as the model heard it (original.wav) plays on the same clock for Original / Separated.
const P = { ctx: null, buf: null, orig: null, item: null, src: [], gains: {}, og: null, at: 0, t0: 0, playing: false, raf: 0, token: 0 };
async function load(it) {
  if (deferPresentation()) return;
  const my = ++P.token;
  if (P.item === it && P.buf) { buttons(); return; }
  stop(); P.buf = null; P.orig = null; P.item = it; P.at = 0;
  try {
    if (!P.ctx) P.ctx = new AudioContext({ sampleRate: 44100 });
    const tracks = tracksOf(it), bufs = await Promise.all(tracks.map(async k => P.ctx.decodeAudioData(await HAL.invoke("read_path", { path: it.res.files[k] }))));
    if (my !== P.token || deferPresentation()) return;
    const orig = it.res.original ? await HAL.invoke("read_path", { path: it.res.original }).then(b => P.ctx.decodeAudioData(b)).catch(() => null) : null;
    if (my !== P.token || deferPresentation()) return;
    P.buf = Object.fromEntries(tracks.map((k, i) => [k, bufs[i]])); P.orig = orig;
  } catch (e) { if (my === P.token) setStatus(t("st.err.play", { error: oneLine(e) }), "bad"); }
  paintHead(); paintLanes(); buttons();
}
function unload() { stop(); P.token++; P.buf = null; P.orig = null; P.item = null; P.at = 0; paintHead(); }
// a stem's gain in the player: none while the original plays
const heardGain = k => opts.ab === "orig" && P.orig ? 0 : gainOf(k);
const origGain = () => opts.ab === "orig" && P.orig ? 1 : 0;
const duration = () => P.buf ? Object.values(P.buf)[0].duration : 0;
const now = () => P.playing ? Math.min(duration(), P.at + P.ctx.currentTime - P.t0) : P.at;
function play(on) {
  if (!P.buf) return;
  if (!on) { if (P.playing) { P.at = now(); stop(); } paintPlay(); return; }
  if (P.playing) return;
  if (P.at >= duration() - 0.05) P.at = 0;
  P.ctx.resume();
  const when = P.ctx.currentTime + 0.03;
  P.src = Object.keys(P.buf).map(k => {
    const s = P.ctx.createBufferSource(), gn = P.ctx.createGain();
    s.buffer = P.buf[k]; gn.gain.value = heardGain(k); s.connect(gn).connect(P.ctx.destination);
    P.gains[k] = gn; s.start(when, P.at); return s;
  });
  if (P.orig && P.at < P.orig.duration) {
    const s = P.ctx.createBufferSource(); P.og = P.ctx.createGain();
    s.buffer = P.orig; P.og.gain.value = origGain(); s.connect(P.og).connect(P.ctx.destination); s.start(when, P.at); P.src.push(s);
  }
  P.src[0].onended = () => { if (P.playing && now() >= duration() - 0.05) { P.at = 0; stop(); paintPlay(); paintHead(); } };
  P.t0 = when; P.playing = true; paintPlay();
  const tick = () => { if (!P.playing) return; paintHead(); P.raf = requestAnimationFrame(tick); };
  P.raf = requestAnimationFrame(tick);
}
function stop() {
  for (const s of P.src) { try { s.onended = null; s.stop(); } catch (e) { /* not started */ } }
  P.src = []; P.gains = {}; P.og = null; P.playing = false; cancelAnimationFrame(P.raf); paintPlay();
}
function seek(sec) { const was = P.playing; if (was) stop(); P.at = Math.max(0, Math.min(duration(), sec)); paintHead(); if (was) play(true); }
function paintPlay() {
  const b = $("#playBtn"), on = P.playing, old = b.querySelector("svg.i");
  b.dataset.icon = on ? "pause" : "play"; if (old) old.remove();
  b.insertAdjacentHTML("afterbegin", window.icon(b.dataset.icon));
  b.title = t(on ? "st.pause" : "st.play"); b.setAttribute("aria-label", b.title);
}
function paintHead() {
  const d = duration(), at = now(), p = d ? at / d : 0;
  for (const h of document.querySelectorAll(".wave .head")) { h.hidden = !P.buf; M.gsap.set(h, { x: p * h.parentElement.clientWidth }); }
  if (!$("#scrub").matches(":active")) $("#scrub").value = String(Math.round(p * 1000));
  $("#time").textContent = P.buf ? `${clock(at)} / ${clock(d)}` : "0:00";
}
function applyGains() {
  for (const k of Object.keys(P.gains)) P.gains[k].gain.setTargetAtTime(heardGain(k), P.ctx.currentTime, 0.01);
  if (P.og) P.og.gain.setTargetAtTime(origGain(), P.ctx.currentTime, 0.01);
  paintLanes();
}
$("#playBtn").addEventListener("click", () => play(!P.playing));
$("#scrub").addEventListener("input", () => seek(+$("#scrub").value / 1000 * duration()));
// the lanes are rebuilt with the song's mode: their clicks are taken on the box
$("#lanes").addEventListener("click", e => {
  const b = e.target.closest(".ms");
  if (b) {
    const k = b.closest(".lane").dataset.track, which = b.dataset.ms;
    opts[which][k] = !opts[which][k];
    syncMs(); applyGains(); saveOpts();
    return;
  }
  const w = e.target.closest(".wave");
  if (w && P.buf) { const r = w.getBoundingClientRect(); seek((e.clientX - r.left) / r.width * duration()); }
});
// the volume: dragged in 0.5 dB steps, a double click back to 0 dB
$("#lanes").addEventListener("input", e => {
  const v = e.target.closest(".vol"); if (!v) return;
  opts.vol[v.closest(".lane").dataset.track] = +v.value; syncVol(); applyGains();
});
$("#lanes").addEventListener("change", e => { if (e.target.closest(".vol")) saveOpts(); });
function syncVol() {
  document.querySelectorAll(".lane").forEach(l => {
    const d = volOf(l.dataset.track), v = l.querySelector(".vol");
    v.value = String(d); v.style.setProperty("--p", ((d - VOL_MIN) / (VOL_MAX - VOL_MIN) * 100) + "%");
    l.querySelector(".lane-v output").textContent = dbText(d);
  });
}
// Original / Separated: what the player plays, on the same clock
$("#ab").addEventListener("click", e => {
  const b = e.target.closest("[data-ab]"); if (!b || b.disabled || b.dataset.ab === opts.ab) return;
  opts.ab = b.dataset.ab; syncAb(); applyGains(); saveOpts();
});
function syncAb() { document.querySelectorAll("#ab [data-ab]").forEach(b => { b.setAttribute("aria-checked", String(b.dataset.ab === opts.ab)); b.title = t(b.dataset.ab === "orig" ? "st.ab.origNote" : "st.ab.sepNote"); }); }
function syncMs() { document.querySelectorAll(".ms").forEach(b => b.setAttribute("aria-pressed", String(!!opts[b.dataset.ms][b.closest(".lane").dataset.track]))); }
window.__ui.onAway(() => { if (P.playing) play(false); P.token++; P.ctx?.suspend().catch(() => {}); deferPresentation(); });
document.addEventListener("keydown", e => { if (e.code === "Space" && !e.target.closest("input,select,button,textarea") && P.buf) { e.preventDefault(); play(!P.playing); } });

/* ===== job ===== */
// One job per song: decoded, separated chunk by chunk (stems_separate), exported at once with "Export when done"
async function refreshEngine(fresh) {
  if (!HAL) return;
  try { tools = await HAL.tools(fresh); } catch (e) { tools = null; }
  const need = missing();
  $("#engine").hidden = !need.length;
  $("#engineNote").textContent = need.length ? t("st.missingNote", { list: need.map(id => t("set.comp." + id)).join(", ") }) : "";
  paintModes(); buttons();
}
$("#installBtn").addEventListener("click", async () => {
  const btn = $("#installBtn"), st = $("#installStatus");
  btn.disabled = true; $("#installProg").hidden = false; st.className = "status warn"; st.textContent = t("st.installing");
  let ready = false;
  try {
    for (const id of missing()) {
      await HAL.installTool(id, p => { if (p.total) M.bar($("#installBar"), p.done / p.total); st.textContent = t("st.installingFile", { file: p.file, mb: (p.done / 1e6).toFixed(1) }); });
    }
    st.className = "status ok"; st.textContent = t("st.installed");
    ready = true;
  } catch (e) { st.className = "status bad"; st.textContent = t("st.err.install", { error: oneLine(e) }); }
  btn.disabled = false; $("#installProg").hidden = true;
  await refreshEngine(true);
  if (ready) runAll(null);
});
if (HAL) HAL.on("tools", () => refreshEngine(false));

// a song still to separate: waiting or cancelled; for All, also one separated with the other model
const pending = (x, all) => x.state === "waiting" || x.state === "cancelled" || (all && x.state === "done" && (x.mode || "hq4") !== opts.mode);
function runAll(btn, all) {
  if (!tools || missing().length) return;
  const todo = Q.items.filter(x => pending(x, all));
  if (!todo.length) return;
  for (const x of todo) if (x.res) { HAL.invoke("stems_clean", { dir: x.res.dir }).catch(() => {}); if (P.item === x) up.unload(); }
  if (!Q.items.some(x => x.state === "queued" || x.state === "running")) Q.group = "stems-" + Date.now();
  const first = todo.map(submit)[0];
  if (HAL.jobLaunched && btn) HAL.jobLaunched(btn, first, { tool: "stems" });
  if (!Q.sel || Q.sel.state !== "done") select(todo[0]);
  renderQueue();
}
function submit(it) {
  const cpu = settingCpu() || cpuSeen;
  it.state = "queued"; it.pct = 0; it.error = null; it.wave = null; it.eta = null; it.chunk = 0; it.chunks = 0; it.device = null; it.stage = null;
  it.mode = opts.mode; it.res = null;
  if (Q.sel === it) { buildLanes(); paintLanes(); }
  const h = HAL.jobs.submit({
    tool: "stems", kind: "stems", title: it.name, group: Q.group, groupTitle: t("tab.stems"), lane: cpu ? "cpu" : "gpu",
    serial: "stems", host: "process", needs: { ramMB: 1024 },
    onCancel: () => { HAL.invoke("stems_cancel", { job: it.job }).catch(() => {}); },
    run: ctx => work(ctx, it, cpu)
  });
  it.job = h.id; byJob.set(h.id, it);
  h.done.then(() => { it.state = "done"; it.pct = 1; },
    e => {
      const off = e && (e.name === "AbortError" || e.cancelled || /cancelled/.test(oneLine(e)));
      it.state = off ? "cancelled" : "error";
      if (!off) it.error = errText(e);
      it.wave = off ? null : it.wave;
    })
    .then(() => { byJob.delete(h.id); renderQueue(); if (Q.sel === it) { select(it); } HAL?.session?.schedule("stems"); });
  return h;
}
function errText(e) {
  const m = oneLine(e);
  if (/no audio|does not contain any stream|matches no streams|Invalid data/i.test(m)) return t("st.err.noAudio");
  if (/No such file|not found|cannot find/i.test(m)) return t("st.err.missing");
  return t("st.err.failed", { error: m });
}
async function work(ctx, it, cpu) {
  it.state = "running"; it.times = []; it.ctx = ctx; it.lastAt = Date.now();
  // nothing heard for a while: the status says so (the stage it is in stays, and stems.log has its times)
  const watch = setInterval(() => { if (Q.sel === it) paintStatus(it); }, 5000);
  try { await separate(ctx, it, cpu); } finally { it.ctx = null; clearInterval(watch); }
}
async function separate(ctx, it, cpu) {
  if (!Q.sel || (Q.sel !== it && Q.sel.state !== "done")) select(it); else paintStatus(it);
  renderQueue();
  ctx.progress(0, t("st.decoding"));
  if (!it.path) it.path = (await HAL.videoPath(it.src)).path;
  const res = await HAL.invoke("stems_separate", { job: ctx.id, path: it.path, mode: it.mode, device: cpu ? "cpu" : "auto" });
  it.res = res; it.device = res.device; it.fell = !!res.fellBack;
  if (res.fellBack) cpuSeen = true;
  it.state = "done"; it.pct = 1;
  if (it.wave) it.wave.filled = it.wave.total;
  if (Q.sel === it) { select(it); }
  paintRow(it);
  if (opts.auto) await exportItem(it, ctx);
}
// chunk by chunk: the waveform of what is final, progress and the time left (from the mean time per chunk after two)
function onProgress(p) {
  const it = byJob.get(p.job); if (!it) return;
  it.lastAt = Date.now();
  // before the first chunk: the stage it is in (the engine, the song, the model on the GPU or the CPU, the first chunk)
  if (p.stage) {
    it.stage = p.stage; if (/-(gpu|cpu)$/.test(p.stage)) it.device = p.stage.slice(-3);
    if (it.ctx) it.ctx.progress(0, t("st.stage." + p.stage));
    if (Q.sel === it) paintStatus(it);
    return;
  }
  const names = Object.keys(p.peaks || {});
  if (!it.wave || it.wave.total !== p.total) it.wave = { total: p.total, peaks: Object.fromEntries(names.map(k => [k, new Float32Array(p.total)])), filled: 0 };
  for (const k of names) if (it.wave.peaks[k]) it.wave.peaks[k].set(p.peaks[k], p.from);
  it.wave.filled = Math.max(it.wave.filled, p.from + (names.length ? p.peaks[names[0]].length : 0));
  it.chunk = p.chunk; it.chunks = p.chunks; it.device = p.device; it.pct = p.chunk / p.chunks;
  const nowMs = performance.now(); it.times.push(nowMs);
  if (it.times.length >= 3) { const per = (nowMs - it.times[1]) / (it.times.length - 2) / 1000; it.eta = per * (p.chunks - p.chunk); }
  if (it.ctx) it.ctx.progress(it.pct, t("st.chunk", { k: p.chunk, n: p.chunks }));
  paintRow(it);
  if (Q.sel === it) { paintLanes(); paintStatus(it); paintStats(it); }
}
if (HAL) HAL.on("stems", onProgress);
function cancelAll() {
  setStatus(t("common.cancelling"));
  // the running song stops; the waiting ones leave the queue; the separated ones stay
  for (const it of Q.items.filter(x => x.state === "queued")) { HAL.jobs.cancel(it.job); }
  Q.items = Q.items.filter(x => x.state !== "queued" && x.state !== "waiting");
  for (const it of Q.items.filter(x => x.state === "running")) HAL.jobs.cancel(it.job);
  if (Q.sel && !Q.items.includes(Q.sel)) select(Q.items[0] || null);
  renderQueue();
}
$("#runBtn").addEventListener("click", e => runAll(e.currentTarget, true));
// Separate: the song open, with the model chosen (again, when it was separated with the other one)
$("#sepBtn").addEventListener("click", e => {
  const it = Q.sel; if (!it || !tools || missing().length || it.state === "queued" || it.state === "running") return;
  if (it.res) { HAL.invoke("stems_clean", { dir: it.res.dir }).catch(() => {}); up.unload(); }
  if (!Q.items.some(x => x.state === "queued" || x.state === "running")) Q.group = "stems-" + Date.now();
  const h = submit(it);
  if (HAL.jobLaunched) HAL.jobLaunched(e.currentTarget, h, { tool: "stems" });
  renderQueue();
});
$("#cancelBtn").addEventListener("click", cancelAll);

/* ===== export ===== */
// FFmpeg from the stems' WAV: WAV / FLAC 24 bit or MP3 320 kbps, at 44.1 kHz or the song's own rate. "Export all": one
// file per track of the song, and with "Also the mix" the lanes heard summed at their volumes, as the player plays them;
// a lane's button: that track alone. A file over 0 dBFS gets the least gain that keeps it whole. Into
// Global Settings chooses each destination; managed files retain Exports\Stems\<song>.
// Each exported file goes to the Library made from the song.
const CODEC = { wav: ["-c:a", "pcm_s24le"], flac: ["-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24"], mp3: ["-c:a", "libmp3lame", "-b:a", "320k"] };
const allOuts = it => [...tracksOf(it), ...(opts.out.mix ? ["mix"] : [])];
async function exportItem(it, ctx, outs = allOuts(it)) {
  if (!it.res) return null;
  const r = it.res, stem = stemOf(it.name), tracks = tracksOf(it);
  const rate = opts.rate === "source" && r.source && r.source.rate ? r.source.rate : 44100;
  let folder = null, lastFile = null;
  const orig = it.path && HAL.library ? await HAL.library.add(it.path).catch(() => null) : null;
  let lowered = [], writing = null;
  try {
    for (const k of outs) {
      // the mix: each lane heard at its volume; a track alone: as separated
      const gains = k === "mix" ? Object.fromEntries(tracks.map(x => [x, audible(x, tracks) ? dbGain(volOf(x)) : 0]).filter(([, v]) => v > 0)) : { [k]: 1 };
      const heard = Object.keys(gains);
      if (!heard.length) continue;
      const peak = k === "mix" ? await HAL.invoke("stems_peak", { dir: r.dir, gains }) : r.peak[k];
      const g = peak > 1 ? 1 / peak : 1;
      if (g < 1) lowered.push(t("st.t." + k));
      const file = await HAL.exportLocation.destination(`${stem} (${t("st.file." + k)}).${opts.format}`, "stems", { folder: stem });
      const inputs = heard.flatMap(x => ["-i", r.files[x]]);
      const vol = x => +(g * gains[x]).toFixed(6);
      const filter = heard.length > 1 ? ["-filter_complex", heard.map((x, i) => `[${i}:a]volume=${vol(x)}[a${i}]`).join(";") + ";" + heard.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${heard.length}:normalize=0[o]`, "-map", "[o]"] : vol(heard[0]) !== 1 ? ["-af", `volume=${vol(heard[0])}`] : [];
      writing = file;
      await ff(ctx, ["-y", ...inputs, ...filter, "-ar", String(rate), ...CODEC[opts.format], file]);
      writing = null;
      await HAL.exportLocation.success(file);
      lastFile = file; folder = file.replace(/[\\/][^\\/]*$/, "");
      if (ctx) ctx.output(file, { kind: "audio", from: orig ? [orig.id] : [] });
      else if (HAL.library) await HAL.library.add(file, { type: "export", kind: "audio", origin: { tool: "stems", from: orig ? [orig.id] : [] } }).catch(() => {});
    }
  } catch (e) {
    if (writing) await HAL.invoke("delete_paths", { paths: [writing] }).catch(() => {});
    throw e;
  }
  it.folder = folder; it.exportedPath = lastFile;
  if (Q.sel === it) {
    const st = $("#exportStatus"); st.className = "status " + (lowered.length ? "warn" : "ok");
    st.textContent = t("st.exportedTo", { folder: folder || "" }) + (lowered.length ? " · " + t("st.lowered", { list: lowered.join(", ") }) : "");
  }
  buttons();
  return folder;
}
// FFmpeg inside the job (cancelling kills it), or as a process of its own for an export by hand
async function ff(ctx, args) {
  const lines = [], onLine = l => { lines.push(l); if (lines.length > 30) lines.shift(); };
  const p = ctx ? await ctx.proc("ffmpeg", ["-hide_banner", "-nostdin", ...args], onLine) : await HAL.runTool("ffmpeg", ["-hide_banner", "-nostdin", ...args], onLine);
  const code = await p.done;
  if (code !== 0) throw new Error(t("st.err.ffmpeg", { error: lines.filter(l => !/^\s*(Input|Output|Stream|Duration|Metadata|  )/.test(l)).pop() || code }));
}
// an export by hand: all, or one lane's track
function exportJob(outs, btn) {
  const it = Q.sel; if (!it || !it.res) return;
  const st = $("#exportStatus"); st.className = "status warn"; st.textContent = t("st.exporting");
  const h = HAL.jobs.submit({ tool: "stems", kind: "stems-export", title: it.name, lane: "cpu", priority: "user", host: "process", run: ctx => exportItem(it, ctx, outs) });
  if (HAL.jobLaunched) HAL.jobLaunched(btn, h, { tool: "stems" });
  h.done.catch(err => { if (Q.sel === it) { st.className = "status bad"; st.textContent = oneLine(err); } });
}
$("#exportBtn").addEventListener("click", e => exportJob(allOuts(Q.sel), e.currentTarget));
$("#reveal").addEventListener("click", () => { const f = Q.sel && (Q.sel.exportedPath || Q.sel.folder); if (f) HAL.invoke("reveal_path", { path: f }).catch(e => setStatus(oneLine(e), "bad")); });
$("#mixOut").addEventListener("change", e => { opts.out.mix = e.target.checked; saveOpts(); });
// All exports share Settings; no Vocal Remover destination preference or onboarding.
$("#destSettings").addEventListener("click", () => HAL.show("settings"));
// the mode tiles: the stems each gives, its model and whether it is ready or how much it downloads
function paintModes() {
  for (const b of document.querySelectorAll("#modes [data-mode]")) {
    const m = MODES[b.dataset.mode], on = b.dataset.mode === opts.mode;
    b.setAttribute("aria-checked", String(on));
    const chips = b.querySelector(".chips");
    if (!chips.childElementCount) chips.replaceChildren(...m.tracks.map(k => { const i = document.createElement("i"); i.dataset.track = k; i.textContent = t("st.t." + k); return i; }));
    const get = ["onnxruntime", m.comp].filter(id => tools && !tools[id]).reduce((n, id) => n + MB[id], 0);
    b.querySelector("small").textContent = t("st.model." + b.dataset.mode) + " · " + (!tools ? "" : get ? t("st.m.get", { mb: get }) : t("st.m.ready"));
  }
  $("#runsOn").textContent = t(settingCpu() ? "st.runs.cpu" : "st.runs.gpu");
}
function syncOpts() {
  $("#format").value = opts.format; $("#rate").value = opts.rate; $("#autoExport").checked = !!opts.auto; $("#mixOut").checked = !!opts.out.mix;
  paintModes();
  $("#modeNote").textContent = t(MODES[opts.mode].note);
  if (!Q.sel || !Q.sel.mode) buildLanes();
  syncMs(); syncVol(); syncAb(); if (Q.sel) paintStats(Q.sel); buttons();
}
// the mode the next songs run in (those done keep theirs)
$("#modes").addEventListener("click", e => {
  const b = e.target.closest("[data-mode]"); if (!b || b.dataset.mode === opts.mode) return;
  opts.mode = b.dataset.mode; syncOpts(); paintLanes(); saveOpts(); refreshEngine(false);
  if (Q.sel && !Q.sel.mode) $("#songMeta").textContent = meta(Q.sel);
});
function saveOpts() { if (HAL) HAL.invoke("state_set", { key: "stems", value: opts }).catch(() => {}); HAL?.session?.schedule("stems"); }
$("#format").addEventListener("change", e => { opts.format = e.target.value; saveOpts(); });
$("#rate").addEventListener("change", e => { opts.rate = e.target.value; saveOpts(); });
$("#autoExport").addEventListener("change", e => { opts.auto = e.target.checked; saveOpts(); });
// "Send to…": the track heard alone (Solo, or the only one not muted), else the vocals
const sentTrack = () => { const heard = tracksOf(Q.sel).filter(audible); return heard.length === 1 ? heard[0] : "vocals"; };
const resultItem = () => { const it = Q.sel; if (!it || !it.res) return null; const k = sentTrack(); return { kind: "audio", path: it.res.files[k], name: `${stemOf(it.name)} (${t("st.file." + k)}).wav` }; };
window.__ui.sendMenu($("#sendBtn"), { kind: "audio", from: "stems", item: resultItem });

/* ===== main ===== */
async function browse() {
  const paths = HAL ? await HAL.invoke("library_pick_files", { label: t("st.files") }).catch(() => null) : null;
  if (paths) { addFiles(paths.map(p => ({ path: p, name: p.split(/[\\/]/).pop() }))); return; }
  $("#fileIn").click();
}
$("#fileIn").addEventListener("change", e => { const f = [...e.target.files]; e.target.value = ""; addFiles(f); });
$("#browseBtn").addEventListener("click", e => { e.stopPropagation(); browse(); });
$("#addBtn").addEventListener("click", browse);
$("#libBtn").addEventListener("click", async e => { const f = HAL && await HAL.pickFromLibrary({ kind: "audio", from: e.currentTarget }); if (f) addFiles([f]); });
$("#linkBtn").addEventListener("click", e => { e.stopPropagation(); if (HAL) HAL.show("downloader"); });
$("#emptyStage").addEventListener("click", e => { if (!e.target.closest("button")) browse(); });
$("#dropMore").addEventListener("click", e => { if (!e.target.closest("button") && Q.items.length < MAX) browse(); });
$("#dropMore").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); if (Q.items.length < MAX) browse(); } });
$("#emptyStage").addEventListener("keydown", e => { if ((e.key === "Enter" || e.key === " ") && e.target === e.currentTarget) { e.preventDefault(); browse(); } });
// dropped files and folders (a folder adds its media, one level deep and below)
async function entries(dt) {
  const out = [], walk = async (en, depth) => {
    if (!en) return;
    if (en.isFile) { const f = await new Promise(r => en.file(r, () => r(null))); if (f) out.push(f); return; }
    if (en.isDirectory && depth < 4) {
      const rd = en.createReader();
      for (;;) { const batch = await new Promise(r => rd.readEntries(r, () => r([]))); if (!batch.length) break; for (const x of batch) await walk(x, depth + 1); }
    }
  };
  const items = [...(dt.items || [])].map(i => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!items.length) return [...dt.files];
  for (const en of items) await walk(en, 0);
  return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
}
let dragDepth = 0;
window.addEventListener("dragenter", e => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { dragDepth++; document.body.classList.add("dragging"); } });
window.addEventListener("dragleave", () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) document.body.classList.remove("dragging"); });
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", async e => {
  e.preventDefault(); dragDepth = 0; document.body.classList.remove("dragging");
  if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) addFiles(await entries(e.dataTransfer));
});
Object.assign(up, { select, submit, runAll, unload, load, buttons, loaded: () => !!P.buf });

window.__stems = { Q, opts, P, audible, play, seek, exportItem, onProgress };
window.__halApp = {
  session: {
    clickChanges: ".ms,.mopt,#ab .tab,#runBtn,#cancelBtn",
    capture: async () => ({
      options: JSON.parse(JSON.stringify(opts)),
      items: await Promise.all(Q.items.map(async it => ({ name: it.name, mode: it.mode || null, state: it.state === "done" ? "done" : it.state === "error" ? "error" : "waiting", error: it.error || null, folder: it.folder || null, src: await HAL.session.ref(it.path ? { path: it.path, name: it.name } : it.src, it.name).catch(() => null) }))),
      sel: Q.sel ? Q.items.indexOf(Q.sel) : -1
    }),
    restore: async d => {
      Object.assign(opts, d.options || {}); syncOpts();
      for (const x of d.items || []) {
        const r = x.src && await HAL.session.video(x.src);
        if (!r) continue;
        Q.items.push({ id: "s" + (++Q.seq), name: x.name, mode: MODES[x.mode] ? x.mode : null, src: { path: r.path, name: x.name }, path: r.path, state: x.state, error: x.error, folder: x.folder, pct: x.state === "done" ? 1 : 0 });
      }
      renderQueue(); select(Q.items[d.sel] || Q.items[0] || null);
    }
  },
  ready: (async () => {
    if (HAL) {
      await HAL.ready;
      try { const s = await HAL.invoke("state_get", { key: "stems" }); if (s && typeof s === "object") { Object.assign(opts, s, { out: { mix: !!(s.out && s.out.mix) }, mute: { ...opts.mute, ...(s.mute || {}) }, solo: { ...opts.solo, ...(s.solo || {}) }, vol: { ...opts.vol, ...(s.vol || {}) } }); } } catch (e) {}
      if (!MODES[opts.mode]) opts.mode = "hq4";
      if (!CODEC[opts.format]) opts.format = "wav";
      if (!["44100", "source"].includes(opts.rate)) opts.rate = "44100";
      if (!["orig", "sep"].includes(opts.ab)) opts.ab = "sep";
      delete opts.dest; delete opts.destAsked;
    }
    syncOpts(); renderQueue(); await refreshEngine(false);
  })(),
  // "Send to…" and the Library: a song joins the queue
  takeAudio: it => addFiles([it.path ? { path: it.path, name: it.name } : new File([it.blob], it.name || "audio.wav", { type: it.blob.type || "audio/wav" })]),
  takeVideo: it => addFiles([it.path ? { path: it.path, name: it.name } : new File([it.blob], it.name || "video.mp4", { type: it.blob.type || "video/mp4" })]),
  // several at once (an album, a Library selection), and files dropped on the processes island: queued and started
  enqueue: async files => !!(await addFiles(files)).length,
  queueAudios: async list => { await addFiles(list.map(it => it.path ? { path: it.path, name: it.name } : it)); return true; },
  result: resultItem,
  flush: async () => {},
  busy: () => HAL.jobs.busy("stems"),
  idle: () => !Q.items.length && !HAL.jobs.busy("stems")
};
})();
