// Frame Grab: the whole tab in one ES module.
/* ===== util ===== */
// Helpers shared by the Frame Grab page modules
import { openAudio } from "./avplay.js";
const { $, clamp, esc, mk, sleep, setStatus } = window.__ui;   // common.js
const HAL = window.__hal || (window.parent !== window && window.parent.__hal) || null;
const M = window.__motion;
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
// A time as the transport shows it: mm:ss.cc (h:mm:ss.cc past an hour)
const fmtTime = s => {
  s = Math.max(0, s || 0);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), r = s - h * 3600 - m * 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : String(m).padStart(2, "0")) + ":" + r.toFixed(2).padStart(5, "0");
};

/* ===== state ===== */
// Shared state of the Frame Grab page
const F = {
  video: null,        // { path, name, info: { w, h, fps, duration, frames }, size, key, pw, ph (preview), eng (view) } of the loaded video
  n: 0,               // the frame shown (index from 0)
  playing: false,
  keys: null,         // the keyframe index: { n: [frame indices], count }
  strip: null,        // the keyframes' small copies for the strip: { n, w, h, rgb, count }
  kp: null,           // the keyframes at preview size (JPEG) when FFmpeg shows the frames: { n, pics, count }
  queue: [],          // frames queued for the export, in time order (at most QMAX): [{ n, sel, pic (a small canvas) }]
  settled: false,     // the background work of the loaded video is done (the strip)
  req: null,          // a round trip from another tab: { from, dest, resolve }
  dest: "image",      // where a capture goes (see side section DESTS)
  layout: "16:9",     // the capture's layout (crop section)
  crops: {},          // the loaded video's framing per layout: crop parameters, or null when it has that shape
  results: [],        // what was captured this session: [{ n, blob, url, path, dest }]
  audio: null,        // the loaded video's sound while it plays (avplay.js), null when it has none the page can play
  sound: { volume: 0.8, muted: false },   // the transport's volume (kept in Settings\app.json → "framegrab")
  stats: { loads: 0, usableMs: 0, paints: 0, decodes: 0 }   // for the performance test
};
// One session per video: aborting its controller ends every FFmpeg job and decode of that video (main section, reset)
let sess = { id: 0, ac: new AbortController() };
const setSess = v => { sess = v; };
// Functions of higher modules that lower ones call (each registers its own when it loads)
const up = {};
const timeOf = n => F.video ? n / F.video.info.fps : 0;
// Index of the last value ≤ x in the first `count` values of a sorted array, or -1
function below(arr, x, count = arr.length) {
  let lo = 0, hi = count - 1, r = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m] <= x) { r = m; lo = m + 1; } else hi = m - 1; }
  return r;
}

/* ===== view ===== */
// The view: the frame being looked at, and playback. The preview is at most 1920 wide (a 4K video is reduced on the
// GPU as it is drawn); captures never use it: they come from FFmpeg at the native size (side section).
// Two decoders, the same policy:
//   page    Mediabunny decodes in the webview (WebCodecs, the hardware decoder when there is one), the file read in
//           ranges (a dropped file straight from its Blob), never whole
//   ffmpeg  for videos the webview cannot decode: the keyframes at preview size (main section, keyPictures) and
//           exact frames at preview size, a process per request
// Latest wins: there is no queue of seeks; whenever the decoder is free it takes the frame under the cursor now.
//   dragging fast    the keyframe nearest the cursor (one decode each, well above 24 per second)
//   dragging slowly, arrows, frame by frame, stopping or releasing: the exact frame. Forward the decoder goes on from
//                    where it is (sequential); backward the GOP comes from the frames cached on the way
// Decoded frames are kept at preview size around the playhead, up to CACHE_MB (the farthest from the playhead goes).

const view = $("#view"), stage = $("#stage"), badge = $("#frameBadge");
const ctx = view.getContext("2d");
const QUIET = 1500, PREVIEW = 1920, CACHE_MB = 400;
const REST = 50;                // ms without moving: the drag has stopped (then the exact frame)
let playToken = 0, scrubbing = false;
const setScrubbing = on => { scrubbing = on; if (on) moves.length = 0; };
// The preview's size for a video: at most PREVIEW wide, even (FFmpeg's frames have the same size)
function previewSize(info) {
  const pw = Math.min(PREVIEW, info.w), ph = Math.max(2, Math.round(pw * info.h / info.w / 2) * 2);
  return [pw, ph];
}

// The view canvas holds the preview; CSS fits it in the stage
function fitView() {
  if (!F.video) return;
  const { pw, ph } = F.video, r = stage.getBoundingClientRect();
  const s = Math.min(r.width / pw, r.height / ph);
  view.style.width = Math.max(2, Math.floor(pw * s)) + "px"; view.style.height = Math.max(2, Math.floor(ph * s)) + "px";
  if (view.width !== pw || view.height !== ph) { view.width = pw; view.height = ph; shown.n = -1; }
  up.placeCrop && up.placeCrop();
}
new ResizeObserver(() => { fitView(); if (F.video && shown.n < 0) drive(); }).observe(stage);

// Visualizer's native fullscreen pattern, with the preview's transport and timeline; secondary panels stay outside.
const workspace = $("#previewWorkspace");
async function toggleFullscreen() {
  try { if (document.fullscreenElement) await document.exitFullscreen(); else await workspace.requestFullscreen(); }
  catch (e) { setStatus(window.t("fg.noFullscreen"), "warn"); }
}
$("#fsBtn").addEventListener("click", toggleFullscreen);
document.addEventListener("fullscreenchange", () => {
  const full = document.fullscreenElement === workspace, button = $("#fsBtn"), label = window.t(full ? "fg.restore" : "fg.maximize");
  button.dataset.icon = full ? "minimize-2" : "maximize";
  button.innerHTML = window.icon(button.dataset.icon);
  button.setAttribute("aria-pressed", String(full));
  button.setAttribute("aria-label", label); button.title = label;
  button.dataset.i18nTitle = button.dataset.i18nAriaLabel = full ? "fg.restore" : "fg.maximize";
  fitView(); up.drawStrip && up.drawStrip();
});

/* ---------- the frames there are ---------- */
// Decoded frames (ImageBitmap at preview size) by frame index
const cache = new Map();
let cacheBytes = 0;
const bytesOf = b => b.width * b.height * 4;
function keep(n, bmp) {
  if (cache.has(n)) { bmp.close(); return; }
  cache.set(n, bmp); cacheBytes += bytesOf(bmp);
  while (cacheBytes > CACHE_MB * 1048576 && cache.size > 1) {
    let far = -1, d = -1;
    for (const k of cache.keys()) { const x = Math.abs(k - F.n); if (x > d) { d = x; far = k; } }
    const b = cache.get(far); cacheBytes -= bytesOf(b); b.close(); cache.delete(far);
  }
}
function forget() { for (const b of cache.values()) b.close(); cache.clear(); cacheBytes = 0; }
// Index (in F.keys) of the keyframe at or before frame n
const keyOf = n => F.keys && F.keys.count ? Math.max(0, below(F.keys.n, n, F.keys.count)) : -1;
// (without an index yet: n itself, the decoder then finds the keyframe)
const keyFrame = n => { const i = keyOf(n); return i >= 0 ? F.keys.n[i] : n; };
// The keyframe nearest frame n (before or after)
function nearKey(n) {
  const i = keyOf(n); if (i < 0) return -1;
  return i + 1 < F.keys.count && F.keys.n[i + 1] - n < n - F.keys.n[i] ? i + 1 : i;
}

/* ---------- the page's decoder ---------- */
// Opens the video in the page: { info?, keys?, eng } or null (the webview cannot decode it). source(MB): its source.
// With needInfo (a dropped file, not on disk yet) the size, speed and length come from the container, and so does
// the keyframe index; MP4 and MOV keep it in their header (a few ms), so it comes from there for them too.
async function pageDecoder(source, o) {
  let input = null;
  try {
    const MB = await import('./mediabunny.js');
    input = new MB.Input({ source: source(MB), formats: MB.ALL_FORMATS });
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) { input.dispose(); return null; }
    const first = await track.getFirstTimestamp();
    let info = o.info;
    if (!info) {
      const [dur, st] = await Promise.all([input.computeDuration(), track.computePacketStats(120)]);
      const fps = st.averagePacketRate > 0 ? +st.averagePacketRate.toFixed(3) : 30, w = track.displayWidth, h = track.displayHeight;
      info = { w, h, fps, duration: dur - first, frames: Math.max(1, Math.round((dur - first) * fps)), codec: await track.getCodec() || "", rotated: (await track.getRotation()) % 180 !== 0 };
    }
    const fmt = await input.getFormat(), header = fmt === MB.MP4 || fmt === MB.QTFF;
    let keys = null;
    if (!o.info || header) {
      const ps = new MB.EncodedPacketSink(track), n = [];
      let p = await ps.getFirstPacket({ metadataOnly: true });
      while (p) { if (p.type === "key") n.push(clamp(Math.round((p.timestamp - first) * info.fps), 0, info.frames - 1)); p = await ps.getNextKeyPacket(p, { metadataOnly: true }); if (o.signal.aborted) break; }
      const u = [...new Set(n)].sort((a, b) => a - b); if (u[0] !== 0) u.unshift(0);
      keys = { n: u, count: u.length };
    }
    const [pw, ph] = previewSize(info), rot = await track.getRotation();
    const idx = t => clamp(Math.round((t - first) * info.fps), 0, info.frames - 1);
    const at = n => first + (n + 0.1) / info.fps;   // a time inside frame n
    // A decoded frame → the preview, reduced as it is copied (on the GPU when there is one); a rotated video is
    // turned upright on a canvas
    const oc = rot ? new OffscreenCanvas(pw, ph) : null, og = oc && oc.getContext("2d");
    async function pic(frame) {
      try {
        if (!rot) return await createImageBitmap(frame, { resizeWidth: pw, resizeHeight: ph, resizeQuality: "low" });
        og.setTransform(1, 0, 0, 1, pw / 2, ph / 2); og.rotate(rot * Math.PI / 180);
        const [dw, dh] = rot % 180 ? [ph, pw] : [pw, ph];
        og.drawImage(frame, -dw / 2, -dh / 2, dw, dh);
        return oc.transferToImageBitmap();
      } finally { frame.close(); }
    }
    // WebCodecs directly, each decoder configured once: Mediabunny finds the packets (in ranges of the file), the
    // decoder gets them one by one, so a seek costs one keyframe's decode and not a pipeline's start
    const packets = new MB.EncodedPacketSink(track), config = { ...(await track.getDecoderConfig()), optimizeForLatency: true };
    // whether the GPU decodes it (the decoder itself is configured without a preference: it falls back to software)
    const hw = await VideoDecoder.isConfigSupported({ ...config, hardwareAcceleration: "prefer-hardware" }).then(r => !!r.supported, () => false);
    // The keyframes' packets, kept once read (all of them are read after the first frame, up to KEY_MB): a jump costs
    // one decode, not a search in the file
    const keyPk = new Map(), KEY_MB = 64;
    let keyBytes = 0;
    async function keyPacket(k) {
      let p = keyPk.get(k);
      if (p) return p;
      p = await packets.getKeyPacket(at(k), { verifyKeyPackets: true });
      if (p && !keyPk.has(k) && keyBytes + p.byteLength <= KEY_MB * 1048576) { keyPk.set(k, p); keyBytes += p.byteLength; }
      return p;
    }
    // The forward decoder: exact frames, one after another from a keyframe
    const outs = [];
    let outWake = null, pos = null, broken = false, closed = false;
    const ping = () => { const w = outWake; outWake = null; if (w) w(); };
    // the browser may close a decoder at any time (Chromium reclaims idle ones, e.g. while the tab is hidden): an error
    // marks it broken and the next restart makes a new one
    const makeDec = () => { const d = new VideoDecoder({ output: f => { outs.push(f); ping(); }, error: () => { if (d === seqDec) { broken = true; ping(); } } }); d.configure(config); return d; };
    let seqDec = makeDec();
    const drop = () => { for (const f of outs.splice(0)) f.close(); };
    // starts again at keyframe k (what the decoder still holds is dropped)
    function restart(k) {
      if (closed) return null;
      if (broken || seqDec.state === "closed") { try { seqDec.close(); } catch (e) { /* closed */ } drop(); seqDec = makeDec(); broken = false; pos = null; }
      seqDec.reset(); drop(); seqDec.configure(config);
      return (pos = { key: k, pk: undefined, fed: 0, got: 0, at: -1 });
    }
    // the next frame out of the decoder (packets fed a few ahead), or null at the end or when restarted meanwhile
    async function nextFrame(my) {
      for (;;) {
        if (pos !== my || broken) return null;
        if (outs.length) { my.got++; return outs.shift(); }
        if (my.pk === undefined) my.pk = await keyPacket(my.key);
        while (my.pk && pos === my && my.fed - my.got < 6 && seqDec.decodeQueueSize < 4) {
          try { seqDec.decode(my.pk.toEncodedVideoChunk()); } catch (e) { broken = true; return null; }   // closed by the browser
          my.fed++;
          my.pk = await packets.getNextPacket(my.pk);
        }
        if (pos !== my) return null;
        if (outs.length) continue;
        if (!my.pk) {
          if (my.fed <= my.got) return null;
          await seqDec.flush().catch(() => {});
          if (!outs.length) return null;
          continue;
        }
        await new Promise(r => { outWake = r; });
      }
    }
    const BACK = 15;   // stepping back: the frames kept behind the one asked for
    let lastAsked = 0;
    const eng = {
      kind: "page", input, eager: true, hw,
      // Frame n exact into the cache. want(): the frame wanted now (it may move forward while decoding), or -1 to
      // stop. Only the frame wanted is copied out of the decoder (the copy is what costs), and, going backward, the
      // BACK frames before it (the next steps back). o.onKey(k): the keyframe it starts from is shown first (copied
      // while the decoder goes on)
      async exact(n, want, o = {}) {
        const back = !scrubbing && n < lastAsked && lastAsked - n <= BACK; lastAsked = n;
        if (broken || seqDec.state === "closed" || !pos || pos.at >= n || keyFrame(n) > pos.at + 1) restart(keyFrame(n));
        let my = pos, again = true;
        if (!my) return;
        for (;;) {
          const f = await nextFrame(my);
          if (!f && broken && again && want() === n) { again = false; my = restart(keyFrame(n)); if (!my) return; continue; }   // a new decoder, once
          if (!f) return;
          const i = idx(f.timestamp / 1e6), w = want(), firstOne = my.at < 0;
          my.at = i; F.stats.decodes++;
          const key = firstOne && o.onKey;
          if (cache.has(i)) { f.close(); if (key) o.onKey(i); }
          else if (w >= 0 && (i >= w || (back && w - i <= BACK))) { keep(i, await pic(f)); if (key) o.onKey(i); }
          else if (key) pic(f).then(b => { keep(i, b); o.onKey(i); });
          else f.close();
          if (pos !== my) return;
          const w2 = want();
          if (w2 < 0 || w2 <= i || keyFrame(w2) > i + 1) return;
        }
      },
      hasKey: () => true,
      // Reads every keyframe's packet (three at a time), as the background starts
      async prefetch(signal) {
        let next = 0;
        const worker = async () => {
          while (!signal.aborted && F.keys && next < F.keys.count && keyBytes < KEY_MB * 1048576) {
            if (driving) { await sleep(30); continue; }   // what the user asks for reads first
            await keyPacket(F.keys.n[next++]).catch(() => {});
          }
        };
        await Promise.all([worker(), worker(), worker()]);
      },
      // Playback from frame n: onFrame(n, bitmap) for each frame in order until stop() says so
      async play(n, onFrame, stop) {
        const my = restart(keyFrame(n));
        while (my && !stop()) {
          const f = await nextFrame(my);
          if (!f) break;
          const i = idx(f.timestamp / 1e6);
          my.at = i;
          if (i < n) { f.close(); continue; }
          await onFrame(i, await pic(f));
        }
        if (pos === my) pos = null;
      },
      close() { closed = true; pos = null; drop(); ping(); try { seqDec.close(); } catch (e) { /* closed */ } try { input.dispose(); } catch (e) { /* already closed */ } }
    };
    // a first frame proves it decodes (canDecode can be optimistic)
    await eng.exact(0, () => 0);
    if (!cache.size && !o.signal.aborted) throw new Error("no frame");
    return { info, keys, pw, ph, eng };
  } catch (e) { if (input) try { input.dispose(); } catch (x) { /* already gone */ } forget(); return null; }
}
// A file on disk as Mediabunny reads it: byte ranges through framegrab.rs
const streamOf = (MB, path, size) => new MB.StreamSource({ getSize: () => size, read: async (a, b) => new Uint8Array(await HAL.readRange(path, a, b)), prefetchProfile: "fileSystem" });

/* ---------- FFmpeg's frames ---------- */
// For videos the webview cannot decode. Exact frames come BATCH at a time from one FFmpeg (the frames after the one
// asked for are the next steps forward); F.kp: the keyframes at preview size (JPEG), filled in the background.
const BATCH = 12;
function ffmpegDecoder(v) {
  let job = null;   // the FFmpeg decoding now: { from, count, next: the frame it gives next, over }
  const ping = my => { const p = my.ping; my.ping = null; if (p) p(); };
  function start(n, batch = BATCH) {
    const my = { from: n, count: Math.max(1, Math.min(batch, v.info.frames - n)), next: n, over: false, ping: null, ac: new AbortController(), chain: Promise.resolve() };
    HAL.frames(v.path, n, my.count, { info: v.info, w: v.pw, signal: AbortSignal.any([my.ac.signal, sess.ac.signal]),
      onFrame: (i, rgba, w, h) => {
        F.stats.decodes++; my.next = i + 1;
        my.chain = my.chain.then(() => createImageBitmap(new ImageData(rgba, w, h))).then(b => { keep(i, b); ping(my); }, () => {});
      } })
      .catch(e => { if (e.name !== "AbortError") up.status(String(e.message || e), "bad"); })
      .then(() => my.chain).then(() => { my.over = true; if (job === my) job = null; ping(my); });
    return my;
  }
  return {
    kind: "ffmpeg",
    // Frame n exact into the cache; returns early when want() moves off it (a frame further on in this batch is
    // taken from the same FFmpeg; anywhere else stops it)
    async exact(n, want, o = {}) {
      if (!job || job.over || n < job.next || n >= job.from + job.count) { if (job) job.ac.abort(); job = start(n, o.batch); }
      const my = job;
      while (!cache.has(n) && !my.over) {
        // a frame out, or a look at want() now and then (a run of one frame gives nothing before its end)
        await new Promise(r => { my.ping = r; setTimeout(r, 40); });
        if (cache.has(n)) break;
        const w = want();
        if (w !== n) { if (w < my.next || w >= my.from + my.count) my.ac.abort(); return; }
      }
    },
    hasKey(i) { const kp = F.kp, n = F.keys.n[i], j = kp ? below(kp.n, n, kp.count) : -1; return cache.has(n) || (j >= 0 && kp.n[j] === n); },
    async key(i) {
      const kp = F.kp, n = F.keys.n[i], j = kp ? below(kp.n, n, kp.count) : -1;
      if (j < 0 || kp.n[j] !== n) return;
      const dec = new ImageDecoder({ data: kp.pics[j], type: "image/jpeg" });
      let b;
      try { const { image } = await dec.decode(); b = await createImageBitmap(image); image.close(); } finally { dec.close(); }
      keep(n, b); F.stats.decodes++;
    },
    // Playback: the keyframes as they pass (a rough preview; the exact frame comes back on pause)
    async play(n, onFrame, stop) {
      const t0 = performance.now();
      while (!stop()) {
        const now = n + Math.floor((performance.now() - t0) / 1000 * v.info.fps);
        if (now >= v.info.frames) break;
        const i = keyOf(now), k = i >= 0 ? F.keys.n[i] : -1;
        if (k >= 0 && !cache.has(k) && this.hasKey(i)) await this.key(i);
        const b = cache.get(k); if (b) await onFrame(now, b, true);
        await new Promise(r => requestAnimationFrame(r));
      }
    },
    close() { if (job) job.ac.abort(); job = null; }
  };
}

/* ---------- painting ---------- */
// What the view shows: frame n, exact or not (a keyframe standing in for it)
const shown = { n: -1, at: -1, exact: false, seq: 0 };
function setBadge(exact) {
  badge.hidden = !F.video;
  badge.dataset.state = exact ? "exact" : "rough";
  badge.textContent = window.t(exact ? "fg.badge" : "fg.badgeRough", { n: F.n + 1 });
}
function paint(img, at, exact) {
  ctx.drawImage(img, 0, 0, view.width, view.height);
  shown.n = F.n; shown.at = at; shown.exact = exact;
  F.stats.paints++; F.stats.painted = true; setBadge(exact); M.skeleton(stage, false);
  perfPaint(at, exact);
  up.painted && up.painted();
}

/* ---------- performance overlay ---------- */
// Measured all the time, shown over the view with the gauge button (off by default), read by the tests in state():
// fps, the new pictures shown in the last second; exact, the time from the last move (a drag, a step, a jump) to its
// exact frame on screen, the last one and the median of the last 20; the decoding path; the decoded frames' cache.
const PERF = { on: false, pics: [], exact: [], at: -1, req: 0, done: 0, timer: 0 };
const pathOf = () => !F.video || !F.video.eng ? "" : F.video.eng.kind === "ffmpeg" ? "ffmpeg" : F.video.eng.hw ? "gpu" : "cpu";
function perfPaint(at, exact) {
  const now = performance.now();
  if (at !== PERF.at) { PERF.pics.push(now); PERF.at = at; }
  if (exact && at === F.n && PERF.req !== PERF.done) {
    PERF.done = PERF.req; PERF.exact.push(Math.round(now - PERF.req));
    if (PERF.exact.length > 20) PERF.exact.shift();
  }
}
function perfStats() {
  const now = performance.now(), e = PERF.exact, sorted = e.slice().sort((a, b) => a - b);
  while (PERF.pics.length && PERF.pics[0] < now - 1000) PERF.pics.shift();
  return { on: PERF.on, fps: PERF.pics.length, samples: e.length, exact: e.length ? e[e.length - 1] : 0, exactMed: sorted.length ? sorted[sorted.length >> 1] : 0,
    path: pathOf(), cacheMB: Math.round(cacheBytes / 1048576), cacheMax: CACHE_MB };
}
function perfShow() {
  const s = perfStats();
  $("#perfOv").textContent = window.t("fg.perf", { fps: s.fps, exact: s.exact, med: s.exactMed, path: s.path ? window.t("fg.path." + s.path) : "–", mb: s.cacheMB, max: s.cacheMax });
}
function setPerf(on) {
  PERF.on = !!on;
  $("#perfBtn").setAttribute("aria-pressed", String(PERF.on));
  clearInterval(PERF.timer);
  if (PERF.on) { perfShow(); PERF.timer = setInterval(perfShow, 250); }
  M.reveal($("#perfOv"), PERF.on);
}
$("#perfBtn").addEventListener("click", () => setPerf(!PERF.on));

/* ---------- the policy ---------- */
// The pointer's recent positions while dragging: [time, frame]
const moves = [];
let lastAct = 0;
// Resolves once the viewer has had nothing to decode for ms (the background FFmpeg jobs wait for it)
async function quiet(ms, signal) {
  for (;;) {
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    const left = ms - (performance.now() - lastAct);
    if (left <= 0 && !driving && !scrubbing) return;
    await new Promise(r => setTimeout(r, Math.max(50, left)));
  }
}
function moved_(n) { const now = performance.now(); moves.push([now, n]); while (moves.length > 2 && now - moves[0][0] > 150) moves.shift(); wake(); }
// Dragging fast: the cursor moved in the last REST ms, at more than three times the video's speed
function fast() {
  if (!scrubbing || moves.length < 2) return false;
  const now = performance.now(), [t1, n1] = moves[moves.length - 1], [t0, n0] = moves[0];
  if (now - t1 > REST) return false;
  return Math.abs(n1 - n0) / Math.max(16, now - t0) * 1000 > 3 * F.video.info.fps;
}
// Resolves on the next move or after ms
let wakeUp = null;
const wake = () => { if (wakeUp) { const w = wakeUp; wakeUp = null; w(); } };
const nap = ms => new Promise(r => { wakeUp = r; setTimeout(() => { if (wakeUp === r) wakeUp = null; r(); }, ms); });

// Waiting for the exact frame of F.n: show() resolves them when it is on screen or another frame came first
let waiters = [];
function settle() { const w = waiters; waiters = []; for (const x of w) x(shown.exact && shown.n === F.n && x.n === F.n); }

let driving = false, asked = 0;
async function drive() {
  if (driving || !F.video) return;
  driving = true;
  const id = sess.id, live = () => F.video && id === sess.id && !F.playing;
  // a closed video's decoder may never answer: its session's end lets the loop go (and the next video drive)
  const sig = sess.ac.signal, ended = new Promise(r => sig.addEventListener("abort", r, { once: true })), w = p => Promise.race([p, ended]);
  // a keyframe, unless a picture asked for later is on screen already (a copy can finish after the next request) or
  // the one on screen is nearer the cursor: the last good picture stays until a better one comes (no flicker back)
  const show1 = (k, seq = asked) => {
    const b = cache.get(k); if (!b || shown.at === k || (shown.exact && shown.n === F.n) || seq < shown.seq) return;
    if (shown.at >= 0 && Math.abs(shown.at - F.n) < Math.abs(k - F.n)) return;
    paint(b, k, k === F.n); shown.seq = seq;
  };
  try {
    while (live()) {
      const v = F.video, n = F.n, hit = cache.get(n);
      if (hit) {
        if (!(shown.n === n && shown.exact)) { paint(hit, n, true); shown.seq = ++asked; }
        settle();
        if (F.n === n) break;
        continue;
      }
      const i = F.keys && F.keys.count ? nearKey(n) : -1;
      if (fast() && i >= 0) {
        if (v.eng.eager) {
          // the page: the keyframe at or before the cursor, then on to the exact frame while the cursor stays in its
          // GOP (so the decoding is under way when the drag stops)
          const g = keyFrame(n), seq = ++asked;
          show1(g, seq);
          await w(v.eng.exact(n, () => (live() && keyFrame(F.n) === g ? F.n : -1), { onKey: k => show1(k, seq) }));
        } else if (v.eng.hasKey(i)) {
          // FFmpeg: the keyframe nearest the cursor; the exact frame once the cursor rests (a process per frame
          // would fall behind)
          const k = F.keys.n[i], seq = ++asked;
          if (!cache.has(k)) await w(v.eng.key(i));
          if (!live()) break;
          show1(k, seq);
          if (F.n === n) await nap(REST + 5);
        } else {
          // FFmpeg before its keyframes are ready: one frame at a time, each shown when it comes (the cursor has
          // moved on meanwhile), then the frame under the cursor then
          const seq = ++asked;
          await w(v.eng.exact(n, () => (live() && !v.eng.hasKey(nearKey(F.n)) && (F.n === n || fast()) ? n : -1), { batch: 1 }));
          if (!live()) break;
          show1(n, seq);
        }
        continue;
      }
      await w(v.eng.exact(n, () => (live() && (v.eng.eager || !fast()) ? F.n : -1)));
      if (live() && F.n === n && !cache.has(n)) {
        if (!scrubbing) break;   // it failed: the next move or step tries again
        await nap(REST + 5);
      }
    }
  } catch (e) { /* the video was closed while decoding */ } finally { driving = false; setTimeout(fillQueue, 0); }
}
// A queued frame without its picture (the cursor left before it was decoded) is decoded once the viewer rests; a
// move or a step takes over at once (its frame is no longer wanted)
async function fillQueue() {
  if (driving || scrubbing || F.playing || !F.video) return;
  const q = F.queue.find(x => !x.pic && !cache.has(x.n));
  if (!q) { up.queuePainted(); return; }
  const v = F.video, n0 = F.n, id = sess.id;
  driving = true;
  try { await v.eng.exact(q.n, () => (id === sess.id && F.n === n0 && !F.playing && !scrubbing ? q.n : -1)); } catch (e) { /* closed */ }
  finally { driving = false; }
  if (id !== sess.id) return;
  up.queuePainted();
  if (F.n !== n0 || !(shown.exact && shown.n === F.n)) drive(); else if (cache.has(q.n)) fillQueue();
}

/* ---------- the sharpest frame nearby ---------- */
// Motion blur makes most frames of a moving shot soft; the sharpest of the SHARP_R frames on each side of the one
// shown is found and shown. Sharpness: the variance of the Laplacian of the frame's luma, measured on a copy
// SHARP_W wide (the same scale for every frame, so they compare). Resolves with the frame, or -1 if a move came first.
const SHARP_R = 12, SHARP_W = 360;
let sharpCanvas = null;
function sharpness(img) {
  const w = SHARP_W, h = Math.max(2, Math.round(w * img.height / img.width));
  if (!sharpCanvas) sharpCanvas = new OffscreenCanvas(w, h);
  if (sharpCanvas.width !== w || sharpCanvas.height !== h) { sharpCanvas.width = w; sharpCanvas.height = h; }
  const g = sharpCanvas.getContext("2d", { willReadFrequently: true });
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data, y = new Float32Array(w * h);
  for (let i = 0, p = 0; i < y.length; i++, p += 4) y[i] = 0.2126 * d[p] + 0.7152 * d[p + 1] + 0.0722 * d[p + 2];
  let sum = 0, sq = 0, n = 0;
  for (let r = 1; r < h - 1; r++) for (let c = 1; c < w - 1; c++) {
    const i = r * w + c, l = y[i - 1] + y[i + 1] + y[i - w] + y[i + w] - 4 * y[i];
    sum += l; sq += l * l; n++;
  }
  return n ? sq / n - (sum / n) ** 2 : 0;
}
async function sharpest() {
  if (!F.video) return -1;
  if (F.playing) setPlaying(false);
  const v = F.video, id = sess.id, n0 = F.n, lo = Math.max(0, n0 - SHARP_R), hi = Math.min(v.info.frames - 1, n0 + SHARP_R);
  const live = () => id === sess.id && F.n === n0 && !F.playing && !scrubbing;
  while (driving) { await sleep(20); if (!live()) return -1; }
  driving = true;
  let best = n0, top = -1;
  try {
    for (let k = lo; k <= hi && live(); k++) {
      if (!cache.has(k)) await v.eng.exact(k, () => (live() ? k : -1), { batch: hi - k + 1 });
      const b = cache.get(k); if (!b) continue;
      const q = sharpness(b);
      if (q > top) { top = q; best = k; }
    }
  } catch (e) { /* the video was closed */ } finally { driving = false; }
  if (!live()) return -1;
  await show(best);
  return best;
}

// Shows frame n (clamped); the transport and the timeline follow. Resolves true once its exact frame is on screen,
// false if another frame came first
function show(n) {
  if (!F.video) return Promise.resolve(false);
  F.n = clamp(Math.round(n), 0, F.video.info.frames - 1); lastAct = PERF.req = performance.now();
  up.moved();
  if (scrubbing) moved_(F.n); else wake();
  const p = new Promise(r => { r.n = F.n; waiters.push(r); });
  for (const w of waiters) if (w.n !== F.n) { waiters = waiters.filter(x => x !== w); w(false); }
  drive();
  return p;
}

/* ---------- playback ---------- */
// The play button shows what a click does: pause while playing
function setPlayIcon() {
  const b = $("#playBtn"), on = F.playing;
  b.dataset.icon = on ? "pause" : "play";
  const old = b.querySelector("svg.i"); if (old) old.remove();
  b.insertAdjacentHTML("afterbegin", window.__icons.icon(b.dataset.icon));
  b.setAttribute("aria-label", window.t(on ? "fg.pause" : "fg.play")); b.title = b.getAttribute("aria-label");
}
function setPlaying(on) {
  const was = F.playing;
  F.playing = !!on && !!F.video;
  setPlayIcon();
  if (F.playing && !was) play();
  else if (!F.playing && was) { playToken++; if (F.audio) F.audio.stop(); show(F.n); }
}
// Plays from the current frame at the video's speed, with its sound; frames that are late are skipped. With sound the
// picture follows the sound's clock (they never drift apart), without it the page's
async function play() {
  const v = F.video, my = ++playToken, start = F.n >= v.info.frames - 1 ? 0 : F.n;
  const stop = () => my !== playToken || F.video !== v;
  const a = F.audio, clock = a ? await a.start(start / v.info.fps).catch(() => null) : null, t0 = performance.now();
  if (stop()) { if (clock && !F.playing) a.stop(true); return; }
  const elapsed = clock ? () => (clock() - start / v.info.fps) * 1000 : () => performance.now() - t0;
  try {
    await v.eng.play(start, async (n, b, borrowed) => {
      const wait = (n - start) / v.info.fps * 1000 - elapsed();
      if (wait < -1000 / v.info.fps) { if (!borrowed) b.close(); return; }   // late: skip it
      if (wait > 0) await sleep(wait);
      if (!stop()) { F.n = clamp(n, 0, v.info.frames - 1); paint(b, n, !borrowed); up.moved(); }
      if (!borrowed) b.close();
    }, stop);
  } catch (e) { /* the video was closed */ }
  if (!stop()) setPlaying(false);
}

// A frame's time as the transport shows it
const timeText = n => fmtTime(timeOf(n));

// Another view takes Frame Capture's place (common.js setAway): playback stops (the sound fades) and the decoded
// frames go (up to CACHE_MB); the frame on screen stays, the next move decodes again
window.__ui.onAway(() => { if (F.playing) setPlaying(false); forget(); });

Object.assign(up, { show, setPlaying, sharpest });

/* ===== crop ===== */
// The capture's layout: 16:9 (the default), 9:16, 1:1, 4:5 or the whole frame as it is. A video of another shape shows the crop frame over the view,
// dragged (or moved with the arrow keys once focused) to reframe, the picture outside dimmed. The framing is a crop
// of the shared Crop service (window.__img: non-destructive parameters on the original), kept per video and layout:
// it stays while scrubbing and between captures, and can be moved before any capture. Captures are cut with it from
// FFmpeg's frame at the native size, never from the preview.

const IMG = window.__img;
const cropEl = $("#crop"), frameEl = $("#cropFrame");
const RATIO = { orig: null, "16:9": [16, 9], "9:16": [9, 16], "1:1": [1, 1], "4:5": [4, 5] };   // orig: the whole frame
// The largest crop of the layout inside the video, in whole pixels and exactly its ratio, centred as near cx, cy
// (fractions) as it can be; null when the video already has the layout's shape
function cropRect(info, layout, cx = 0.5, cy = 0.5) {
  if (!RATIO[layout]) return null;
  const { w: iw, h: ih } = info, [a, b] = RATIO[layout];
  if (IMG.fits(iw, ih, a / b)) return null;
  const k = Math.floor(Math.min(iw / a, ih / b)), W = a * k, H = b * k;
  const left = clamp(Math.round(cx * iw - W / 2), 0, iw - W), top = clamp(Math.round(cy * ih - H / 2), 0, ih - H);
  return { cx: (left + W / 2) / iw, cy: (top + H / 2) / ih, w: W / iw, h: H / ih, a: 0, ratio: layout };
}
// The video's framing for a layout (made centred the first time)
function cropOf(layout = F.layout) {
  if (!F.video) return null;
  if (!(layout in F.crops)) F.crops[layout] = cropRect(F.video.info, layout);
  return F.crops[layout];
}
// The frame over the view: the overlay covers the view canvas exactly, the frame is placed in fractions of it
function placeCrop() {
  const p = cropOf();
  M.reveal(cropEl, !!p);
  if (!p) return;
  const vr = view.getBoundingClientRect(), sr = stage.getBoundingClientRect();
  Object.assign(cropEl.style, { left: vr.left - sr.left + "px", top: vr.top - sr.top + "px", width: vr.width + "px", height: vr.height + "px" });
  Object.assign(frameEl.style, { left: (p.cx - p.w / 2) * 100 + "%", top: (p.cy - p.h / 2) * 100 + "%", width: p.w * 100 + "%", height: p.h * 100 + "%" });
}
function moveCrop(cx, cy) {
  if (!F.video || !cropOf()) return;
  F.crops[F.layout] = cropRect(F.video.info, F.layout, cx, cy);
  HAL?.session?.schedule("framegrab");
  placeCrop();
}
frameEl.addEventListener("pointerdown", e => {
  const p = cropOf(); if (!p || e.button !== 0) return;
  e.preventDefault(); e.stopPropagation(); frameEl.focus(); frameEl.setPointerCapture(e.pointerId);
  const x0 = e.clientX, y0 = e.clientY, { cx, cy } = p, r = cropEl.getBoundingClientRect();
  const move = ev => moveCrop(cx + (ev.clientX - x0) / r.width, cy + (ev.clientY - y0) / r.height);
  const end = () => { frameEl.removeEventListener("pointermove", move); frameEl.removeEventListener("pointerup", end); frameEl.removeEventListener("pointercancel", end); frameEl.classList.remove("drag"); };
  frameEl.classList.add("drag");
  frameEl.addEventListener("pointermove", move); frameEl.addEventListener("pointerup", end); frameEl.addEventListener("pointercancel", end);
});
// Arrows move the focused frame by 1 % of the video (Shift: 10 %) instead of stepping frames
frameEl.addEventListener("keydown", e => {
  const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key], p = cropOf();
  if (!d || !p) return;
  e.preventDefault(); e.stopPropagation();
  const k = e.shiftKey ? 0.1 : 0.01;
  moveCrop(p.cx + d[0] * k, p.cy + d[1] * k);
});
function setLayout(layout) {
  F.layout = layout in RATIO ? layout : "16:9";
  for (const b of $$("#layout [data-layout]")) { const on = b.dataset.layout === F.layout; b.setAttribute("aria-checked", String(on)); b.setAttribute("aria-selected", String(on)); }
  placeCrop();
}
$("#layout").addEventListener("click", e => { const b = e.target.closest("[data-layout]"); if (b) setLayout(b.dataset.layout); });
function resetCrop() { F.crops = {}; placeCrop(); }
// A capture cut with a framing (null: the whole frame): { blob, w, h }
async function cut(blob, p, info) {
  if (!p) return { blob, w: info.w, h: info.h };
  const img = await IMG.load(blob);
  try { const c = IMG.render(img, p); return { blob: await IMG.toBlob(c), w: c.width, h: c.height }; } finally { URL.revokeObjectURL(img.__url); }
}

Object.assign(up, { placeCrop, resetCrop, cropOf, cut, setLayout });

/* ===== timeline ===== */
// The timeline under the view: the strip (the keyframes' small copies), ticks for the queued frames, the playhead;
// dragging anywhere on it scrubs. Keys: ← → one frame, Shift ±1 s, Home / End, Space plays or pauses, M adds the
// frame to the queue.

const tl = $("#timeline"), strip = $("#strip"), head = $("#head"), ticks = $("#ticks");

// The strip's small copies of the keyframes as canvases, made when first drawn
const small = new Map();
function smallFrame(i) {
  let c = small.get(i);
  if (c) { small.delete(i); small.set(i, c); return c; }
  const { w, h, rgb } = F.strip;
  c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"), im = g.createImageData(w, h), o = i * w * h * 3, d = im.data;
  for (let p = 0, q = o; p < w * h * 4; p += 4, q += 3) { d[p] = rgb[q]; d[p + 1] = rgb[q + 1]; d[p + 2] = rgb[q + 2]; d[p + 3] = 255; }
  g.putImageData(im, 0, 0);
  small.set(i, c);
  while (small.size > 400) { const k = small.keys().next().value; small.get(k).width = 0; small.delete(k); }
  return c;
}
function clearSmall() { for (const c of small.values()) c.width = 0; small.clear(); }
const frac = n => F.video && F.video.info.frames > 1 ? n / (F.video.info.frames - 1) : 0;
// The keyframe's small copy nearest frame f
function tileFor(f) {
  const ks = F.strip;
  if (!ks || !ks.count) return null;
  const i = below(ks.n, f, ks.count), j = [i, i + 1].filter(x => x >= 0 && x < ks.count).sort((x, y) => Math.abs(ks.n[x] - f) - Math.abs(ks.n[y] - f))[0];
  return j == null ? null : smallFrame(j);
}
function drawStrip() {
  const r = tl.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
  strip.width = Math.max(1, Math.round(r.width * dpr)); strip.height = Math.max(1, Math.round(r.height * dpr));
  const c = strip.getContext("2d"); c.clearRect(0, 0, strip.width, strip.height);
  const v = F.video, ks = F.strip;
  if (!v || !ks || !ks.count) return;
  // tiles of the video's shape, as many as fit; each shows the keyframe nearest its place in time
  const th = strip.height, tw = th * ks.w / ks.h, count = Math.max(1, Math.ceil(strip.width / tw)), last = v.info.frames - 1;
  for (let i = 0; i < count; i++) {
    const img = tileFor(Math.round((i + 0.5) / count * last));
    if (img) c.drawImage(img, Math.round(i * strip.width / count), 0, Math.ceil(strip.width / count), th);
  }
}
// Redraws the strip once per animation frame at most
let stripQueued = false;
function queueStrip() { if (stripQueued) return; stripQueued = true; requestAnimationFrame(() => { stripQueued = false; drawStrip(); }); }
new ResizeObserver(() => { drawStrip(); moved(); }).observe(tl);

function drawTicks() {
  ticks.innerHTML = F.queue.map(q => `<i class="mark" style="left:${frac(q.n) * 100}%"></i>`).join("");
}
// The playhead, the time and the frame number follow F.n
function moved() {
  head.style.transform = `translateX(${frac(F.n) * tl.clientWidth}px)`;
  const v = F.video;
  $("#timeOut").textContent = v ? `${timeText(F.n)} / ${timeText(v.info.frames - 1)}` : "00:00.00";
  $("#frameOut").textContent = v ? window.t("fg.frameOf", { n: F.n + 1, of: v.info.frames }) : "";
  tl.setAttribute("aria-valuemax", String(v ? v.info.frames - 1 : 0)); tl.setAttribute("aria-valuenow", String(F.n));
  tl.setAttribute("aria-valuetext", v ? timeText(F.n) : "");
  up.frameChanged && up.frameChanged();
}

// Scrubbing: dragging fast shows keyframes, slowly the exact frames; resting or releasing shows the exact frame
tl.addEventListener("pointerdown", e => {
  if (!F.video || e.button !== 0) return;
  e.preventDefault(); tl.focus(); tl.setPointerCapture(e.pointerId);
  if (F.playing) setPlaying(false);
  setScrubbing(true);
  const seek = ev => { const r = tl.getBoundingClientRect(); show(clamp((ev.clientX - r.left) / r.width, 0, 1) * (F.video.info.frames - 1)); };
  seek(e);
  const end = () => {
    tl.removeEventListener("pointermove", seek); tl.removeEventListener("pointerup", end); tl.removeEventListener("pointercancel", end);
    setScrubbing(false); if (F.video) show(F.n); HAL?.session?.schedule("framegrab");
  };
  tl.addEventListener("pointermove", seek); tl.addEventListener("pointerup", end); tl.addEventListener("pointercancel", end);
});

const typing = el => el && ((/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName) && !["radio", "checkbox", "button", "range"].includes(el.type)) || el.isContentEditable);
function step(d) { if (!F.video) return; if (F.playing) setPlaying(false); show(F.n + d); HAL?.session?.schedule("framegrab"); }
document.addEventListener("keydown", e => {
  if (!F.video || typing(e.target) || e.ctrlKey || e.altKey || e.metaKey) return;
  const sec = Math.max(1, Math.round(F.video.info.fps));
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") step((e.key === "ArrowLeft" ? -1 : 1) * (e.shiftKey ? sec : 1));
  else if (e.key === "Home") step(-F.n);
  else if (e.key === "End") step(F.video.info.frames);
  // Space plays or pauses wherever the focus is (a focused button would otherwise click itself on key up)
  else if (e.key === " ") { if (!e.repeat) setPlaying(!F.playing); }
  else if (e.key === "m" || e.key === "M") up.addFrame();
  else if (e.key === "s" || e.key === "S") findSharp();
  else return;
  e.preventDefault();
});
document.addEventListener("keyup", e => { if (e.key === " " && F.video && !typing(e.target)) e.preventDefault(); });
$("#prevBtn").addEventListener("click", () => step(-1));
$("#nextBtn").addEventListener("click", () => step(1));
$("#playBtn").addEventListener("click", () => setPlaying(!F.playing));
$("#addBtn").addEventListener("click", () => up.addFrame());
// S (or the button): the sharpest frame within half a second or so on each side
async function findSharp() {
  if (!F.video) return;
  const b = $("#sharpBtn"); b.disabled = true;
  setStatus(window.t("fg.sharpLooking"), "warn");
  const n0 = F.n, n = await up.sharpest();
  b.disabled = false;
  if (n < 0) setStatus("");
  else setStatus(window.t(n === n0 ? "fg.sharpSame" : "fg.sharpFound", { n: n + 1, d: (n > n0 ? "+" : "") + (n - n0) }), "ok");
}
$("#sharpBtn").addEventListener("click", findSharp);

// A small copy of frame n: its queued picture, else the nearest keyframe's
function thumbOf(n, w = 192) {
  const q = F.queue.find(x => x.n === n && x.pic), img = q ? q.pic : tileFor(n); if (!img) return null;
  const c = mk(w, Math.max(1, Math.round(w * img.height / img.width)));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}

Object.assign(up, { moved, drawTicks, drawStrip, queueStrip });

/* ===== side ===== */
// The panel on the right: the queue (up to QMAX frames, each selected or not) and exporting the selected ones. Every
// capture is FFmpeg's frame at the video's native size (the extractor in the main window), whatever the view shows.
//   destinations: back (the tab that opened Frame Grab), send (Send to… another tool), library (Library\Frames)
//   and image (a loose PNG in Exports\Frames)

const t_side = (k, v) => window.t(k, v);
const DESTS = ["back", "send", "library", "image"];
const QMAX = 8;
const available = d => d === "back" ? !!F.req : true;
function renderDests() {
  const list = DESTS.filter(available);
  if (!list.includes(F.dest)) F.dest = list.includes("image") ? "image" : list[0];
  const label = d => d === "back" ? t_side("fg.dest.back", { name: t_side("tab." + F.req.from) }) : t_side("fg.dest." + d);
  const sub = d => d === "back" ? t_side("fg.dest.backSub." + (F.req.dest || "image")) : t_side("fg.dest." + d + "Sub");
  $("#dests").innerHTML = list.map(d => `<label class="radio"><input type="radio" name="dest" value="${d}"${d === F.dest ? " checked" : ""}><span><b>${esc(label(d))}</b><small>${esc(sub(d))}</small></span></label>`).join("");
  renderGo();
}
$("#dests").addEventListener("change", e => { if (e.target.name === "dest") { F.dest = e.target.value; renderGo(); } });
// "Back" with a single-frame request (a video layer's frame) takes the frame shown; the rest, the selected ones
const single = () => F.dest === "back" && F.req && F.req.single;
const selected = () => single() ? [F.n] : F.queue.filter(q => q.sel).map(q => q.n);
function renderGo() {
  const n = selected().length, b = $("#captureBtn");
  $("#captureText").textContent = !n ? t_side("fg.exportNone")
    : F.dest === "back" ? t_side("fg.dest.back", { name: t_side("tab." + F.req.from) })
    : F.dest === "send" ? t_side("fg.dest.send") : t_side("fg.export", { n });
  const ic = F.dest === "send" ? "send" : "image-plus";
  if (b.dataset.icon !== ic) { b.dataset.icon = ic; const old = b.querySelector("svg.i"); if (old) old.remove(); b.insertAdjacentHTML("afterbegin", window.__icons.icon(ic)); }
  if (F.dest === "send") { b.setAttribute("aria-haspopup", "menu"); b.title = t_side("send.tip"); } else { b.removeAttribute("aria-haspopup"); b.removeAttribute("title"); }
  b.disabled = !F.video || !F.video.path || !n || busy;
}

/* ---------- the queue ---------- */
// A frame's picture for its card: its decoded frame, or the view once it shows that exact frame (the queue fills in
// as frames land)
function snap(q) {
  if (q.pic) return false;
  const src = cache.get(q.n) || (shown.exact && shown.n === q.n && shown.at === q.n ? view : null);
  if (!src) return false;
  const c = mk(240, Math.max(1, Math.round(240 * src.height / src.width)));
  c.getContext("2d").drawImage(src, 0, 0, c.width, c.height);
  q.pic = c;
  return true;
}
// Adds the frame shown (M, the Add button): selected, in time order; a frame already queued is selected again
function addFrame(n = F.n) {
  if (!F.video) return;
  HAL?.session?.schedule("framegrab");
  const had = F.queue.find(q => q.n === n);
  if (had) { had.sel = true; renderQueue(); return; }
  if (F.queue.length >= QMAX) { setStatus(t_side("fg.queueFull"), "warn"); return; }
  const q = { n, sel: true, pic: null };
  if (!snap(q)) setTimeout(fillQueue, 0);
  F.queue.push(q); F.queue.sort((a, b) => a.n - b.n);
  renderQueue();
}
function removeFrame(n) { F.queue = F.queue.filter(q => q.n !== n); renderQueue(); }
function renderQueue() {
  const Q = F.queue;
  $("#cntQueue").textContent = Q.length ? `${Q.length} / ${QMAX}` : "";
  M.reveal($("#queueHint"), !Q.length);
  M.reveal($("#queueActs"), Q.length > 0);
  $("#selAll").disabled = Q.every(q => q.sel); $("#selNone").disabled = !Q.some(q => q.sel);
  $("#addBtn").disabled = !F.video || (Q.length >= QMAX && !Q.some(q => q.n === F.n));
  M.list($("#queue"), () => {
    $("#queue").innerHTML = Q.map(q => {
      const time = esc(timeText(q.n));
      return `<div class="fg-q" data-key="${q.n}" data-n="${q.n}" aria-current="${q.n === F.n}" aria-selected="${q.sel}">`
        + `<button class="pic" data-go="${q.n}" title="${esc(t_side("fg.qGo", { time: timeText(q.n) }))}"></button><span class="time">${time}</span>`
        + `<button class="sel" role="checkbox" data-sel="${q.n}" aria-checked="${q.sel}" data-icon="check" title="${esc(t_side("fg.qSelect", { time: timeText(q.n) }))}" aria-label="${esc(t_side("fg.qSelect", { time: timeText(q.n) }))}"></button>`
        + `<button class="rm" data-rm="${q.n}" data-icon="x" title="${esc(t_side("fg.qRemove"))}" aria-label="${esc(t_side("fg.qRemove"))}"></button></div>`;
    }).join("");
    for (const q of Q) { const el = $("#queue").querySelector(`[data-go="${q.n}"]`), c = q.pic || thumbOf(q.n, 240); if (el && c) el.append(c); }
    window.__icons.apply($("#queue"));
  });
  drawTicks(); renderGo();
}
$("#queue").addEventListener("click", e => {
  const r = e.target.closest("[data-rm]"); if (r) { removeFrame(+r.dataset.rm); return; }
  const s = e.target.closest("[data-sel]");
  if (s) { const q = F.queue.find(x => x.n === +s.dataset.sel); if (q) { q.sel = !q.sel; renderQueue(); } return; }
  const g = e.target.closest("[data-go]"); if (g) show(+g.dataset.go);
});
$("#selAll").addEventListener("click", () => { for (const q of F.queue) q.sel = true; renderQueue(); });
$("#selNone").addEventListener("click", () => { for (const q of F.queue) q.sel = false; renderQueue(); });

/* ---------- capturing ---------- */
const stemOf = () => HAL.fileStem(String(F.video.name || "video").replace(/\.[^.]+$/, ""));
let busy = false;
// The frames of the list at full size, cut in the layout
async function grab(list, layout) {
  const v = F.video, p = cropOf(layout), frames = [];
  for (const [i, n] of list.entries()) {
    setStatus(list.length > 1 ? t_side("fg.capturingN", { i: i + 1, n: list.length }) : t_side("fg.capturing"), "warn");
    const c = await cut(await HAL.frameAt(v.path, n, { info: v.info }), p, v.info);
    frames.push({ blob: c.blob, n, time: timeOf(n), w: c.w, h: c.h, layout, video: { path: v.path, name: v.name, info: v.info } });
  }
  return frames;
}
const frameFile = f => `${String(f.video.name || "video").replace(/\.[^.]+$/, "")} - ${t_side("fg.frameName", { n: f.n + 1 })}.png`;
async function capture(list) {
  if (!F.video || !F.video.path || busy || !list.length) return;
  await HAL?.session?.start("framegrab");
  const dest = F.dest;
  if (dest === "send") {
    // the menu first; the frame is taken once a tool is picked. The tools take one picture: the first one selected
    window.__ui.openSend($("#captureBtn"), { kind: "image", from: "framegrab", item: async to => {
      if (busy) return null;
      busy = true; renderGo();
      try {
        const [f] = await grab(list.slice(0, 1), F.layout);
        setStatus(t_side("fg.sent", { name: t_side("tab." + to) }), "ok");
        return { blob: f.blob, name: frameFile(f) };
      } catch (e) { setStatus(t_side("fg.err.capture", { error: e.message || e }), "bad"); return null; }
      finally { busy = false; renderGo(); }
    } });
    return;
  }
  busy = true; renderGo();
  try {
    const frames = await grab(list, F.layout);
    if (dest === "back") {
      const r = F.req; F.req = null; renderOrigin(); renderDests();
      setStatus(t_side("fg.sentBack", { name: t_side("tab." + r.from) }), "ok");
      r.resolve(frames.map(f => ({ ...f, dest: r.dest })));
    } else {
      const kind = dest === "library" ? "library-frames" : "frames";
      for (const f of frames) {
        const stem = `${stemOf()} - ${t_side("fg.frameName", { n: f.n + 1 })}`;
        f.path = await HAL.saveOutput(f.blob, stem + ".png", kind);
        if (!f.path) { setStatus(t_side("common.saveCancelled"), "warn"); break; }
        const th = thumbOf(f.n, 240);
        HAL.session.recordExport("framegrab", { path: f.path, name: f.path.split(/[\\/]/).pop(), kind: "image", thumb: th ? th.toDataURL("image/png") : undefined });
      }
      if (frames.every(f => f.path)) setStatus(t_side(dest === "library" ? "fg.savedLibrary" : "fg.savedImage", { n: frames.length }), "ok");
      addResults(frames.filter(f => f.path).map(f => ({ ...f, dest })));
    }
  } catch (e) { setStatus(t_side("fg.err.capture", { error: e.message || e }), "bad"); }
  finally { busy = false; renderGo(); }
}
$("#captureBtn").addEventListener("click", () => capture(selected()));

// What was captured, newest first, with the next steps: Crop, Cutout, Send to…, Show in folder
function addResults(list) {
  for (const r of list) { r.id = Math.random().toString(36).slice(2, 9); r.url = URL.createObjectURL(r.blob); }
  const all = list.reverse().concat(F.results);
  for (const r of all.slice(12)) URL.revokeObjectURL(r.url);   // the ones that fall out free their picture
  F.results = all.slice(0, 12);
  const acts = r => ["crop", "cutout", "send", "folder"].map(a => `<button class="btn sm" data-res="${r.id}" data-act="${a}"${a === "send" ? ` title="${esc(t_side("send.tip"))}" aria-haspopup="menu"` : ""}>${esc(t_side(a === "send" ? "send.to" : "fg.act." + a))}</button>`).join("");
  M.list($("#results"), () => {
    $("#results").innerHTML = F.results.map(r => `<div class="fg-res" data-key="${r.id}"><img src="${r.url}" alt=""><b title="${esc(r.path)}">${esc(r.path.split(/[\\/]/).pop())}</b><div class="acts">${acts(r)}</div></div>`).join("");
  });
}
$("#results").addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const r = F.results.find(x => x.id === b.dataset.res); if (!r) return;
  const name = r.path ? r.path.split(/[\\/]/).pop() : "frame.png";
  try {
    if (b.dataset.act === "folder") await HAL.invoke("reveal_path", { path: r.path });
    else if (b.dataset.act === "send") window.__ui.openSend(b, { kind: "image", from: "framegrab", item: () => ({ path: r.path, blob: r.blob, name }) });
    else if (b.dataset.act === "cutout") {
      if (!(await HAL.cutoutEnsure())) return;
      const c = await HAL.cutoutDialog({ image: r.blob, name, from: b });
      if (c) setStatus(t_side("fg.savedAs", { name: String(await HAL.saveCutout(c.rgba, { name, beside: r.path })).split(/[\\/]/).pop() }), "ok");
    } else if (b.dataset.act === "crop") {
      const img = await window.__img.load(r.blob), c = await HAL.crop({ image: img, name, from: b });
      if (c) {
        const out = await window.__img.toBlob(window.__img.render(img, c.params));
        setStatus(t_side("fg.savedAs", { name: String(await HAL.saveVersion(out, { name, beside: r.path, tag: "crop" })).split(/[\\/]/).pop() }), "ok");
      }
    }
  } catch (err) { setStatus(String(err.message || err), "bad"); }
});

/* ---------- where Frame Grab was opened from ---------- */
function renderOrigin() {
  const r = F.req;
  M.reveal($("#origin"), !!r);
  if (r) $("#originText").textContent = t_side("fg.origin", { name: t_side("tab." + r.from) });
}
$("#originCancel").addEventListener("click", () => { const r = F.req; F.req = null; renderOrigin(); renderDests(); if (r) r.resolve(null); });

// The current frame's card follows the playhead; a card waiting for its picture gets it once its exact frame is shown
function frameChanged() {
  for (const c of $("#queue").querySelectorAll("[data-n]")) c.setAttribute("aria-current", String(+c.dataset.n === F.n));
  $("#addBtn").disabled = !F.video || (F.queue.length >= QMAX && !F.queue.some(q => q.n === F.n));
}
function queuePainted() {
  for (const q of F.queue) if (snap(q)) { const el = $("#queue").querySelector(`[data-go="${q.n}"]`); if (el) el.replaceChildren(q.pic); }
}

Object.assign(up, { addFrame, renderQueue, frameChanged, queuePainted, status: setStatus });

/* ===== main ===== */
// Frame Grab (docs/ARCHITECTURE.md → Frame Grab): a tool of its own for picking frames of a video. Opening a video,
// FFmpeg as a component, the round trip with other tabs (open), and the API the main window uses (__halApp).
// Modules, lowest first: util → state → view → timeline → side → main.

window.__i18n.apply(document);
window.__icons.apply(document);
const t = (k, v) => window.t(k, v);
const VIDEO = /\.(mp4|m4v|mov|webm|mkv)$/i;
const isVideo = f => !!f && (/^video\//.test(f.type) || VIDEO.test(f.name || f.path || ""));

/* ---------- FFmpeg, the one extractor ---------- */
let hasEngine = false;
async function checkEngine(fresh) {
  if (!HAL) return false;
  try { hasEngine = !!(await HAL.tools(fresh)).ffmpeg; } catch (e) { hasEngine = false; }
  M.reveal($("#engine"), !hasEngine);
  return hasEngine;
}
$("#installBtn").addEventListener("click", async () => {
  const btn = $("#installBtn"), st = $("#installStatus");
  btn.disabled = true; M.show($("#installProg")); st.className = "status warn"; st.textContent = t("dl.installing");
  try {
    await HAL.installTool("ffmpeg", p => { if (p.total) M.bar($("#installBar"), p.done / p.total); st.textContent = t("dl.installingFile", { file: p.file, mb: (p.done / 1e6).toFixed(1) }); });
    st.className = "status ok"; st.textContent = t("fg.installed"); window.__ui.retryLabel(btn, "fg.install", false);
  } catch (e) { st.className = "status bad"; st.textContent = t("dl.err.install", { error: e.message || e }); window.__ui.retryLabel(btn, "fg.install", true); }
  btn.disabled = false; M.hide($("#installProg"));
  if (await checkEngine(true) && pending) { const p = pending; pending = null; load(p.src, p.o); }
});
if (HAL) HAL.on("tools", () => checkEngine(false));

/* ---------- opening a video ---------- */
// "Loading…" until the viewer is usable: a short note over the viewer's skeleton, which the first frame replaces
function loading(on) {
  const el = $("#loading");
  if (on) { M.skeleton(stage, true); M.show(el, { scale: 0.96 }); return; }
  if (el.hidden) return;
  M.hide(el, { scale: 0.96 }); M.skeleton(stage, false);
}
// Everything of the previous video goes: its FFmpeg jobs (killed), its decoder (closed), the decoded frames and the
// small copies (freed), the strip, the framing and the queue
function reset() {
  sess.ac.abort();
  setSess({ id: sess.id + 1, ac: new AbortController() });
  playToken++; F.playing = false; setPlayIcon();
  setScrubbing(false); wake();
  PERF.exact.length = 0; PERF.at = -1;
  const v = F.video;
  if (F.audio) { F.audio.close(); F.audio = null; }
  if (v && v.sound) { try { v.sound.dispose(); } catch (e) { /* closed */ } }
  if (v && v.eng) v.eng.close();
  F.video = null; F.keys = null; F.strip = null; F.kp = null; F.queue = []; F.settled = false; F.n = 0; F.stats.painted = false;
  settle(); shown.n = shown.at = -1; shown.exact = false;
  forget(); clearSmall();
  ctx.clearRect(0, 0, view.width, view.height); badge.hidden = true;
  resetCrop(); renderQueue(); drawStrip(); moved();
}
// Resolves with p's value, or null after ms (a value that comes later goes to late)
function withTimeout(p, ms, late) {
  let out = false;
  return Promise.race([p.then(v => { if (out && v) late(v); return v; }), new Promise(r => setTimeout(() => { out = true; r(null); }, ms))]);
}

let pending = null, loadSeq = 0;
// src: a File, or { path, name } of a file on disk; o.frame: the frame to start on.
// Usable first: the keyframe index (the packets alone, nothing decoded) and the first frame. Then, in the background,
// the keyframes at preview size (when FFmpeg shows the frames) and the strip's keyframes. A dropped
// file is decoded by the page from its Blob while it is copied for FFmpeg (which the rest needs).
async function load(src, o = {}) {
  if (!HAL || !src) return false;
  if (!(await checkEngine(false))) { pending = { src, o }; setStatus(t("fg.needEngine"), "warn"); return false; }
  const my = ++loadSeq, t0 = performance.now();
  reset();
  const signal = sess.ac.signal, mine = () => my === loadSeq;
  M.reveal($("#empty"), false); loading(true);
  setStatus(t("fg.opening"), "warn");
  try {
    const blob = window.__img.isBlob(src) && !src.__halPath ? src : null;
    const disk = HAL.videoPath(src);
    disk.catch(() => {});
    let vp = null, info = null, meta = null, idx = null;
    const onDisk = async () => {
      vp = await disk;
      [info, meta] = await Promise.all([info || HAL.probeVideo(vp.path), HAL.videoKey(vp.path).catch(() => null)]);
      idx = HAL.keyIndex(vp.path, { info, signal }).catch(() => null);
    };
    if (!blob) await onDisk();
    if (!mine()) return false;
    const source = blob ? MB => new MB.BlobSource(blob) : meta ? MB => streamOf(MB, vp.path, meta.size) : null;
    const pd = source ? await withTimeout(pageDecoder(source, { info, signal }), 4000, late => late.eng.close()) : null;
    if (!mine()) { if (pd) pd.eng.close(); return false; }
    if (!pd && !vp) await onDisk();   // FFmpeg shows the frames: it needs the file on disk
    if (!mine()) return false;
    info = info || pd.info;
    const [pw, ph] = pd ? [pd.pw, pd.ph] : previewSize(info);
    F.video = { path: vp ? vp.path : null, disk, blob, name: vp ? vp.name : src.name || "video", info, size: meta ? meta.size : 0, key: meta ? meta.key : "", pw, ph, eng: null, sound: null };
    HAL?.session?.schedule("framegrab");
    F.video.eng = pd ? pd.eng : ffmpegDecoder(F.video);
    F.keys = pd && pd.keys ? pd.keys : await idx;
    console.info(`Frame Grab: ${F.video.name} (${info.codec || "?"}, ${info.w}×${info.h}) decoded by ${{ gpu: "the page (WebCodecs, hardware)", cpu: "the page (WebCodecs, software)", ffmpeg: "FFmpeg (fallback)" }[pathOf()]}`);
    if (!mine()) return false;
    $("#srcName").textContent = F.video.name;
    $("#srcMeta").textContent = `${info.w}×${info.h} · ${+info.fps.toFixed(3)} fps · ${info.frames} ${t("fg.frames")}`;
    M.reveal($("#srcInfo"), true);
    fitView(); moved(); renderGo(); placeCrop();
    if (!(await show(o.frame || 0)) && !mine()) return false;
    F.stats.usableMs = Math.round(performance.now() - t0); F.stats.loads++;
    loading(false); setStatus("");
    lastAct = performance.now() + QUIET;   // the first seconds of a video go to the viewer (users scrub right away)
    openSound(my);
    background(my, signal);
    return true;
  } catch (e) {
    if (mine()) { loading(false); if (e.name !== "AbortError") setStatus(t("fg.err.open", { error: e.message || e }), "bad"); }
    return false;
  }
}
// Left behind a long while (shell.js unloadIdle → rest): what weighs goes (the page's decoder and reader, the sound,
// the decoded frames); what is light stays (the video, its keyframes, strip, framing, queue and the picture shown), so
// the tool is back at once, on its frame, and the decoder opens again behind it.
let rested = null;
function rest() {
  const v = F.video;
  if (!v || rested || !window.__ui.away) return;
  rested = v;
  if (F.audio) { F.audio.close(); F.audio = null; }
  if (v.sound) { try { v.sound.dispose(); } catch (e) { /* closed */ } v.sound = null; }
  if (v.eng.kind === "page") v.eng.close();
  forget();
  window.__ui.whenBack(reopen);
}
async function reopen() {
  const v = rested; rested = null;
  if (!v || v !== F.video) return;
  const my = loadSeq;
  if (v.eng.kind === "page") {
    const source = v.blob ? MB => new MB.BlobSource(v.blob) : v.path && v.size ? MB => streamOf(MB, v.path, v.size) : null;
    const pd = source ? await pageDecoder(source, { info: v.info, signal: sess.ac.signal }) : null;
    if (my !== loadSeq || F.video !== v) { if (pd) pd.eng.close(); return; }
    v.eng = pd ? pd.eng : ffmpegDecoder(v);
  }
  shown.n = -1; show(F.n);
  openSound(my);
}
// The video's sound for playback: from the page's own reader when it decodes the picture, else read apart (the file
// on disk in ranges, or the dropped file); none when the page cannot decode it (the transport says so)
async function openSound(my) {
  const v = F.video;
  let input = null, a = null;
  try {
    const MB = await import("./mediabunny.js");
    input = v.eng.input || (v.blob ? new MB.Input({ source: new MB.BlobSource(v.blob), formats: MB.ALL_FORMATS })
      : v.path && v.size ? new MB.Input({ source: streamOf(MB, v.path, v.size), formats: MB.ALL_FORMATS }) : null);
    if (input) a = await openAudio(MB, input);
  } catch (e) { a = null; }
  if (my !== loadSeq || F.video !== v) { if (a) a.close(); if (input && input !== v.eng.input) try { input.dispose(); } catch (e) { /* closed */ } return; }
  if (input && input !== v.eng.input) v.sound = input;
  F.audio = a;
  if (a) { a.volume(F.sound.volume); a.mute(F.sound.muted); }
  paintSound();
}
// The transport's sound: mute and volume, kept between sessions like the other options
function paintSound() {
  const b = $("#muteBtn"), has = !!F.audio, off = F.sound.muted || !F.sound.volume;
  b.disabled = !has; $("#vol").disabled = !has;
  b.dataset.icon = !has || off ? "volume-x" : "volume-2";
  const old = b.querySelector("svg.i"); if (old) old.remove();
  b.insertAdjacentHTML("afterbegin", window.__icons.icon(b.dataset.icon));
  b.setAttribute("aria-pressed", String(has && off));
  b.title = t(!F.video ? "fg.sound" : !has ? "fg.noSound" : off ? "fg.unmute" : "fg.mute"); b.setAttribute("aria-label", b.title);
  $("#vol").value = String(F.sound.volume);
}
const saveSound = () => { if (HAL) HAL.invoke("state_set", { key: "framegrab", value: { volume: F.sound.volume, muted: F.sound.muted } }).catch(() => {}); };
$("#muteBtn").addEventListener("click", () => { F.sound.muted = !F.sound.muted; if (!F.sound.muted && !F.sound.volume) F.sound.volume = 0.8; if (F.audio) { F.audio.mute(F.sound.muted); F.audio.volume(F.sound.volume); } paintSound(); saveSound(); });
$("#vol").addEventListener("input", e => { F.sound.volume = +e.target.value; F.sound.muted = false; if (F.audio) { F.audio.volume(F.sound.volume); F.audio.mute(false); } paintSound(); });
$("#vol").addEventListener("change", saveSound);

// What fills in once the viewer is usable: the file on disk (a dropped one), the keyframes at preview size when FFmpeg
// shows the frames (dragging fast shows them), then the strip's keyframes
// A background job of the jobs system (cpu lane, silent): it gives its unit back to more urgent work of its lane
// (an export) between steps, and a new video (or a cancel from the processes tray) stops it.
function background(my, signal) {
  const v = F.video, mine = () => my === loadSeq;
  if (!HAL.jobs) return analyse(v, mine, signal, null);
  const h = HAL.jobs.submit({ tool: "framegrab", kind: "analyse", title: v.name, lane: "cpu", priority: "background", silent: true, notify: false,
    run: ctx => analyse(v, mine, AbortSignal.any ? AbortSignal.any([signal, ctx.signal]) : signal, ctx) });
  signal.addEventListener("abort", () => HAL.jobs.cancel(h.id), { once: true });
  h.done.catch(() => {});
}
async function analyse(v, mine, signal, ctx) {
  const step = async () => { if (ctx) await ctx.yield(); };
  try {
    if (v.eng.prefetch) v.eng.prefetch(signal).catch(() => {});
    if (!v.path) { const vp = await v.disk; if (!mine()) return; v.path = vp.path; renderGo(); }
    if (v.eng.kind === "ffmpeg") { await step(); await HAL.keyPictures(v.path, { info: v.info, w: v.pw, signal, onPartial: kp => { if (mine()) F.kp = kp; } }).then(kp => { if (mine()) F.kp = kp; }).catch(() => {}); }
    if (!mine()) return;
    // the strip takes cores the decoder needs, so it starts once the viewer rests
    await quiet(QUIET, signal); if (!mine()) return;
    await step();
    await HAL.keyframes(v.path, { info: v.info, signal }).then(k => { if (mine()) { F.strip = k; queueStrip(); renderQueue(); } }).catch(() => {});
  } catch (e) { if (mine() && e.name !== "AbortError") setStatus(t("fg.err.open", { error: e.message || e }), "bad"); }
  if (mine()) F.settled = true;
}

// The system's file picker: the video is read where it is (nothing copied)
async function browse() {
  const r = HAL && HAL.pickVideo ? await HAL.pickVideo().catch(() => null) : null;
  if (r) { HAL.filePicked?.(); load(r); }
}
$("#openBtn").addEventListener("click", browse);
$("#browseBtn").addEventListener("click", e => { e.stopPropagation(); browse(); });
$("#empty").addEventListener("click", browse);
$("#empty").addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); browse(); } });
$("#videoIn").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) load(f); });
document.addEventListener("dragover", e => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
document.addEventListener("drop", e => {
  const f = e.dataTransfer && [...e.dataTransfer.files].find(isVideo);
  if (!e.dataTransfer || !e.dataTransfer.files.length) return;
  e.preventDefault();
  if (f) load(f); else setStatus(t("fg.onlyVideo"), "bad");
});

/* ---------- the round trip ---------- */
// Another tab opens Frame Grab: its video, where the result goes ("back" to it) and the frame to start on.
// Resolves with the captured frames, or null if the user cancels or another tab asks in the meantime.
function open(o = {}) {
  if (F.req) F.req.resolve(null);
  let resolve;
  const done = new Promise(r => { resolve = r; });
  F.req = o.from ? { from: o.from, dest: o.dest || "image", single: o.dest === "frame" || o.dest === "start", resolve } : null;
  F.dest = F.req ? "back" : (o.dest || F.dest);
  renderOrigin(); renderDests();
  const same = F.video && o.video && (o.video.path || o.video.__halPath) === F.video.path;
  if (same) show(o.frame || 0); else if (o.video) load(o.video, { frame: o.frame || 0 });
  if (!F.req) resolve(null);
  return done;
}

renderDests(); moved(); paintSound();
const ready = (async () => {
  if (!HAL) return;
  await HAL.ready;
  const o = await HAL.invoke("state_get", { key: "framegrab" }).catch(() => null);
  if (o && typeof o === "object") { if (Number.isFinite(+o.volume)) F.sound.volume = clamp(+o.volume, 0, 1); F.sound.muted = o.muted === true; }
  paintSound();
  await checkEngine(false);
})();
// "Send to…" (modules.js: accepts, roundTrip): a video opens here; with "and come back" the first frame captured
// goes back to the tool it came from (Frame Grab's own "Back to", see the round trip above)
async function takeVideo(it, o = {}) {
  const video = it.path ? { path: it.path, name: it.name } : await HAL.itemFile(it);
  const res = await open({ video, from: o.from, dest: o.from ? "image" : it.meta && it.meta.dest }), f = res && res[0];
  if (!f) return null;
  const name = `${String(f.video.name || it.name || "video").replace(/\.[^.]+$/, "")} - ${t_side("fg.frameName", { n: f.n + 1 })}.png`;
  return { kind: "image", blob: f.blob, path: f.path || null, name };
}
// The FFmpeg copy already owns the browser File's bytes. Sessions can reference that disk copy
// instead of transferring the complete video through WebView IPC a second time.
async function sessionVideo() {
  const v = F.video;
  if (!v) return null;
  let source = v;
  if (!v.path) { try { source = await v.disk; } catch (e) { source = v.blob; } }
  return HAL.session.ref(source, v.name);
}
window.__halApp = { session: {
 clickChanges: "#queue [data-sel],#queue [data-rm],#selAll,#selNone,#layout [data-layout],#dests input",
 capture: async () => ({ video: await sessionVideo(), n: F.n, sound: { ...F.sound }, layout: F.layout, crops: Object.fromEntries(Object.entries(F.crops).filter(([,v])=>v)), dest: F.dest, queue: F.queue.map(q => ({n:q.n,sel:q.sel})) }),
 restore: async d => { Object.assign(F.sound,d.sound); paintSound(); const v = await HAL.session.video(d.video); if (v) { await load(v,{frame:d.n}); F.layout=d.layout; F.crops=d.crops||{}; F.dest=d.dest; F.queue=(d.queue||[]).map(q=>({...q,pic:null})); renderQueue(); renderDests(); moved(); show(d.n); } }
}, ready, open, load, takeVideo, show, busy: () => busy, idle: () => !F.video && !rested, rest, state: () => ({ n: F.n, frames: F.video ? F.video.info.frames : 0, fps: F.video ? F.video.info.fps : 0, sink: !!(F.video && F.video.eng && F.video.eng.kind === "page"), decoder: pathOf(), resting: !!rested, perf: perfStats(), dest: F.dest,
  queue: F.queue.map(q => ({ n: q.n, sel: q.sel, pic: !!q.pic })), settled: F.settled, keys: F.keys ? F.keys.count : 0, playing: F.playing, icon: $("#playBtn").dataset.icon, name: F.video ? F.video.name : "",
  loading: !$("#loading").hidden, stats: { ...F.stats }, held: { decoded: cache.size, decodedMB: Math.round(cacheBytes / 1048576), small: small.size, results: F.results.length },
  shown: { ...shown }, keyFrames: F.keys ? Array.from(F.keys.n.slice(0, F.keys.count)) : [], preview: F.video ? [F.video.pw, F.video.ph] : null,
  kp: F.kp ? F.kp.count : 0, layout: F.layout, crop: cropOf(), path: F.video ? F.video.path : null,
  sound: { has: !!F.audio, playing: !!(F.audio && F.audio.playing()), ...F.sound } }) };
Object.assign(up, { load, painted: () => { up.queuePainted(); const h = window.__halApp.onPaint; if (h) h(shown.at, shown.exact, F.n); } });
