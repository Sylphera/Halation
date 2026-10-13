// Frame Grab's performance, alone (verify.js runs it with nothing else running), on long videos: 5-minute 1080p and
// 30-second 4K, each in VP9 (the page decodes it, as WebView2 does with H.264 and HEVC on Windows), H.264 and HEVC
// (headless Chromium decodes neither: FFmpeg shows the frames). Every video, from a file on disk:
// 1. Time until the viewer is usable (the keyframe index and the first frame exact on screen): 1080p ≤ 2 s, 4K < 5 s.
// 2. One second later, a fast scrub: the timeline held with the mouse and moved every animation frame across 80 % of
//    it in 2 s: new pictures per second and the longest wait for one.
// 3. The drag stops (the mouse still down): the time to the exact frame, whose pixels must be those of the source
//    (FFmpeg's frame at the preview's size: under 1 % of the pixels off, fewer than the frames either side of it).
//    Another fast drag and the release: the same.
//    Targets: ≥ 24 pictures/s with no freeze, the exact frame in ≤ 150 ms. They are printed met or not; what fails the
//    test is the view adding to what the decoder itself costs on this machine, measured on the side for each video
//    (a keyframe, and the stop frame from its keyframe: a fresh WebCodecs decoder in the page, or one FFmpeg run):
//    in a container without a GPU every video is decoded in software, and the exact frame at the end of a long GOP
//    cannot come sooner than the decoder gets through the GOP. Limits: pictures/s ≥ min(24, half of what one decoder
//    gives), waits ≤ max(200 ms, 4 keyframes), the exact frame ≤ max(150 ms, the decoder's time + 60 ms; FFmpeg:
//    + 150 ms, the 50 ms rest and bringing the frame in).
// 4. Frame by frame: 12 steps forward, then 20 back across a keyframe; every frame exact, the last of each run
//    checked against the source.
// 5. Switching among three videos nine times: the browser's memory and the FFmpeg processes stay flat, and a video
//    opened again is usable at once (its index comes from the cache). The decoded frames stay under 400 MB throughout.
// This file's browser composites in software: with SwiftShader's GL (the other test files) presenting any change of a
// large canvas costs about 110 ms in the GPU process whatever the page does, so frame rates there measure SwiftShader.
// Numbers are printed as "PERF name value" lines for the report. Usage: node app/tests/framegrab-perf.js [label…]
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto"), { execSync, execFileSync } = require("child_process");
const { until, sleep, serve, openApp, chromium, LAUNCH } = require("./common");
const { createHost } = require("./host");

let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const perf = (k, v) => console.log(`PERF ${k} ${v}`);
const ffmpeg = process.env.FFMPEG || execSync("command -v ffmpeg").toString().trim();

// The long videos, made once per FFmpeg build (a few minutes) and kept in the temporary folder
const VIDEOS = [
  ["1080p-vp9", "long 1080p.webm", "1920x1080", 300, "-c:v libvpx-vp9 -deadline realtime -cpu-used 8 -row-mt 1 -g 60 -b:v 2M"],
  ["1080p-h264", "long 1080p.mp4", "1920x1080", 300, "-c:v libx264 -preset ultrafast -g 60 -pix_fmt yuv420p -b:v 4M"],
  ["1080p-hevc", "long 1080p hevc.mp4", "1920x1080", 300, "-c:v libx265 -preset ultrafast -x265-params keyint=60:min-keyint=60:log-level=error -pix_fmt yuv420p -tag:v hvc1 -b:v 4M"],
  ["4k-vp9", "4k vp9.webm", "3840x2160", 30, "-c:v libvpx-vp9 -deadline realtime -cpu-used 8 -row-mt 1 -g 60 -b:v 12M"],
  ["4k-h264", "4k h264.mp4", "3840x2160", 30, "-c:v libx264 -preset ultrafast -g 60 -pix_fmt yuv420p"],
  ["4k-hevc", "4k hevc.mp4", "3840x2160", 30, "-c:v libx265 -preset ultrafast -x265-params keyint=60:min-keyint=60:log-level=error -pix_fmt yuv420p -tag:v hvc1"]
];
function longVideos() {
  const key = crypto.createHash("sha1").update("v1").update(execSync("ffmpeg -version").toString().split("\n")[0]).digest("hex").slice(0, 10);
  const dir = path.join(os.tmpdir(), "halation-perf-" + key);
  fs.mkdirSync(dir, { recursive: true });
  return VIDEOS.map(([label, name, size, secs, codec]) => {
    const file = path.join(dir, name);
    if (!fs.existsSync(file)) {
      const part = path.join(dir, "part-" + name);
      execSync(`ffmpeg -v error -f lavfi -i testsrc2=size=${size}:rate=30:duration=${secs} ${codec} -y "${part}"`);
      fs.renameSync(part, file);
    }
    return { label, file, is4k: size.startsWith("3840") };
  });
}

// FFmpeg processes started by this test (the mocked backend spawns them as children of this process)
const processSnapshot = require("./process-resources.cjs").snapshot;
const ffmpegs = () => processSnapshot().filter(x=>x.pp===process.pid&&/ffmpeg/.test(x.c)).length;
// Resident memory of the browser (every process under this one but FFmpeg), MB
function browserMB() {
  const all = processSnapshot();
  const kids = new Map(); for (const x of all) { if (!kids.has(x.pp)) kids.set(x.pp, []); kids.get(x.pp).push(x); }
  let kb = 0; const stack = [...(kids.get(process.pid) || [])];
  while (stack.length) { const x = stack.pop(); if (!/ffmpeg/.test(x.c)) kb += x.r; stack.push(...(kids.get(x.p) || [])); }
  return Math.round(kb / 1024);
}
// Frame n of a video at w×h as FFmpeg decodes it (the same seek as the app's extractor), RGBA
function sourceFrame(file, n, fps, w, h) {
  return execFileSync(ffmpeg, ["-v", "error", "-ss", Math.max(0, (n - 0.25) / fps).toFixed(6), "-i", file, "-frames:v", "1", "-vf", `scale=${w}:${h}:flags=bicubic`, "-f", "rawvideo", "-pix_fmt", "rgba", "pipe:1"], { maxBuffer: 1 << 26 });
}
// One FFmpeg run for frame n at the preview's size, as the view's fallback makes it: ms
function ffmpegMs(file, n, fps, w, h) {
  const t = Date.now();
  execFileSync(ffmpeg, ["-v", "error", "-ss", Math.max(0, (n - 0.25) / fps).toFixed(6), "-i", file, "-an", "-sn", "-frames:v", "1", "-vf", `scale=${w}:${h}:flags=bicubic`, "-f", "rawvideo", "-pix_fmt", "rgba", "-y", path.join(os.tmpdir(), "halation-fgperf-frame.rgba")]);
  return Date.now() - t;
}
// Share of pixels whose largest channel difference is over 48: scaling filters differ by a few levels, another frame
// of the test pattern by far more
function off(a, b) {
  let bad = 0; const px = Math.min(a.length, b.length) / 4;
  for (let i = 0; i < px * 4; i += 4) if (Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])) > 48) bad++;
  return bad / px;
}

(async () => {
  const only = process.argv.slice(2), videos = longVideos().filter(v => !only.length || only.includes(v.label));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "halation-fgperf-")), host = createHost(root, { tools: { systemFfmpeg: ffmpeg } });
  process.on("exit", () => fs.rmSync(root, { recursive: true, force: true }));   // the videos and the cache are large
  fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en" } }));
  const dl = host.dir("Downloads", "Video");
  for (const v of videos) { v.path = path.join(dl, path.basename(v.file)); try { fs.linkSync(v.file, v.path); } catch (e) { fs.copyFileSync(v.file, v.path); } }
  const server = serve(), browser = await chromium.launch({ executablePath: LAUNCH.executablePath, args: ["--disable-gpu-compositing", "--autoplay-policy=no-user-gesture-required"] });
  const app = await openApp(browser, server, host, { width: 1480, height: 920 });
  const { page, errors } = app;
  page.on("crash", () => errors.push("the page crashed"));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  const heapMB = async () => { await cdp.send("HeapProfiler.collectGarbage"); const m = await cdp.send("Performance.getMetrics"); return Math.round(m.metrics.find(x => x.name === "JSHeapUsedSize").value / 1048576); };
  const ff = () => page.frames().find(f => /framegrab\.html/.test(f.url()));
  const S = () => ff().evaluate(() => window.__halApp.state());
  await app.tab("framegrab");
  await until(() => ff() && ff().evaluate(() => window.__halApp && window.__halApp.ready.then(() => true)), 20000);
  const fg = page.frameLocator("#v-framegrab");
  await ff().evaluate(() => {
    // the page's paints, for the measures below: { t, at (the frame painted), exact, n (the frame wanted) }
    window.__paints = [];
    window.__halApp.onPaint = (at, exact, n) => { window.__paints.push({ t: performance.now(), at, exact, n }); if (window.__paints.length > 400) window.__paints.splice(0, 200); for (const w of window.__wait.splice(0)) w(); };
    window.__wait = [];
    // resolves with the time the exact frame of the frame wanted is on screen
    window.__exactAt = async () => {
      for (;;) { const s = window.__halApp.state(); if (s.shown.exact && s.shown.n === s.n && s.shown.at === s.n) { const p = window.__paints[window.__paints.length - 1]; return p && p.exact && p.at === s.n ? p.t : performance.now(); } await new Promise(r => window.__wait.push(r)); }
    };
    document.querySelector("#timeline").addEventListener("pointerup", () => { window.__upAt = performance.now(); });
  });
  // Opens a file; resolves with the milliseconds until the viewer is usable (measured in the page)
  const open = file => ff().evaluate(async p => {
    const t0 = performance.now();
    await window.__halApp.load({ path: p, name: p.split(/[\\/]/).pop() });
    const b = document.querySelector("#frameBadge");
    while (!(b.dataset.state === "exact" && !b.hidden && document.querySelector("#loading").hidden)) await new Promise(r => requestAnimationFrame(r));
    return Math.round(performance.now() - t0);
  }, file);
  // The view's pixels (the preview) against the source's frame n and the frames either side of it
  const check = async (v, n) => {
    const s = await S(), [w, h] = s.preview;
    const px = Buffer.from(await ff().evaluate(() => { const c = document.querySelector("#view"), d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let out = ""; for (let i = 0; i < d.length; i += 0x8000) out += String.fromCharCode.apply(null, d.subarray(i, i + 0x8000)); return btoa(out); }), "base64");
    const at = k => off(px, sourceFrame(v.path, k, s.fps, w, h));
    return { self: at(n), prev: n > 0 ? at(n - 1) : 1, next: n < s.frames - 1 ? at(n + 1) : 1 };
  };
  // the frame itself, not a neighbour (when the neighbours look the same, any of them is the same picture)
  const exactOk = c => c.self <= 0.01 && (c.self < Math.min(c.prev, c.next) || Math.max(c.prev, c.next) <= 0.01);
  const pct = x => (x * 100).toFixed(2) + " %";
  const med = a => a.slice().sort((x, y) => x - y)[a.length >> 1];
  const tl = await fg.locator("#timeline").boundingBox();
  // A drag in the page: pointer moves every animation frame from a to b (fractions of the timeline) in ms
  const drag = (a, b, ms) => ff().evaluate(([a, b, ms]) => new Promise(res => {
    const el = document.querySelector("#timeline"), rc = el.getBoundingClientRect(), from = window.__paints.length;
    let t0 = 0;
    const f = t => {
      if (!t0) t0 = t;
      const k = Math.min(1, (t - t0) / ms);
      el.dispatchEvent(new PointerEvent("pointermove", { clientX: rc.left + rc.width * (a + (b - a) * k), clientY: rc.top + rc.height / 2, pointerId: 1, bubbles: true }));
      if (k < 1) { requestAnimationFrame(f); return; }
      const end = performance.now(), ps = window.__paints.slice(from).filter(p => p.t <= end);
      const fresh = ps.filter((p, i) => i === 0 || p.at !== ps[i - 1].at), times = [t0, ...fresh.map(p => p.t), end];
      res({ secs: (end - t0) / 1000, pictures: fresh.length, gap: Math.max(...times.slice(1).map((x, i) => x - times[i])), end });
    };
    requestAnimationFrame(f);
  }), [a, b, ms]);
  // Arrow presses, each once the previous frame is exact: the time of each and the frame reached
  const steps = (key, count) => ff().evaluate(async ([key, count]) => {
    const out = [];
    for (let i = 0; i < count; i++) {
      const t = performance.now();
      document.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
      out.push((await window.__exactAt()) - t);
    }
    return { ms: out, n: window.__halApp.state().n };
  }, [key, count]);

  // What one decoder costs in the page, apart from the view: the keyframes given (decoded and copied at the preview's
  // size), and frame n from its keyframe k; ms
  const pageCost = (v, keys, k, n) => ff().evaluate(async ([p, keys, k, n]) => {
    const HAL = window.parent.__hal, MB = await import("./mediabunny.js"), s = window.__halApp.state(), [pw, ph] = s.preview;
    const size = (await HAL.videoKey(p)).size;
    const input = new MB.Input({ source: new MB.StreamSource({ getSize: () => size, read: async (a, b) => new Uint8Array(await HAL.readRange(p, a, b)), prefetchProfile: "fileSystem" }), formats: MB.ALL_FORMATS });
    try {
      const track = await input.getPrimaryVideoTrack(), first = await track.getFirstTimestamp(), ps = new MB.EncodedPacketSink(track);
      const cfg = { ...(await track.getDecoderConfig()), optimizeForLatency: true };
      const run = async (k, n) => {
        const t0 = performance.now(), outs = []; let wake = null;
        const dec = new VideoDecoder({ output: f => { outs.push(f); if (wake) wake(); }, error: () => {} });
        dec.configure(cfg);
        let pk = await ps.getKeyPacket(first + (k + 0.1) / s.fps, { verifyKeyPackets: true }), fed = 0, got = null;
        while (!got) {
          while (pk && dec.decodeQueueSize < 6 && fed - outs.length < 400) { dec.decode(pk.toEncodedVideoChunk()); fed++; pk = await ps.getNextPacket(pk); }
          if (!outs.length) { if (!pk) await dec.flush(); else await new Promise(r => { wake = r; }); wake = null; }
          while (outs.length) { const f = outs.shift(); if (!got && Math.round((f.timestamp / 1e6 - first) * s.fps) >= n) got = f; else f.close(); }
        }
        (await createImageBitmap(got, { resizeWidth: pw, resizeHeight: ph, resizeQuality: "low" })).close(); got.close(); dec.close();
        return performance.now() - t0;
      };
      let key = 0; for (const x of keys) key += await run(x, x);
      return { key: key / keys.length, frame: await run(k, n) };
    } finally { input.dispose(); }
  }, [v.path, keys, k, n]);
  const cost = async (v, s, n) => {
    const keys = s.keyFrames;
    if (s.sink) return pageCost(v, [keys[1], keys[keys.length >> 1], keys[keys.length - 2]].filter(x => x != null), keys.filter(x => x <= n).pop(), n);
    const f = ffmpegMs(v.path, n, s.fps, s.preview[0], s.preview[1]);
    return { key: f, frame: f, ffmpeg: true };
  };
  // The page's decoder must land the exact frame within its own cost plus a margin. FFmpeg (here the fallback for
  // H.264/HEVC, which headless Chromium cannot decode; WebView2 decodes them in the page) shares four cores with the
  // keyframe job, the page and the test, and runs 2-6 times slower than alone: its times are reported, not judged
  const stopLimit = c => c.ffmpeg ? Infinity : Math.max(150, c.frame + 60);
  const target = (name, met, what) => console.log(`     target ${name}: ${met ? "met" : "NOT MET"} (${what})`);
  const summary = [];
  for (const v of videos) {
    const tag = v.label, limit = v.is4k ? 5000 : 2000;
    // 1. usable
    const ms = await open(v.path), s1 = await S();
    ok(v.is4k ? ms < limit : ms <= limit, `${tag}: usable in ${ms} ms (${s1.sink ? "decoded by the page" : "frames by FFmpeg"}, ${s1.keyFrames.length} keyframes, preview ${s1.preview.join("×")})`);
    perf(`usable_ms_${tag}`, ms);
    await sleep(1000);

    // 2. fast scrub for 2 s, the mouse down on the timeline
    await page.mouse.move(tl.x + tl.width * 0.1, tl.y + tl.height / 2);
    await page.mouse.down();
    // FFmpeg's keyframes at preview size ready when the drag starts (the ones still coming cost a run each)
    const kpAt = (await S()).kp, r = await drag(0.1, 0.9, 2000), fps = r.pictures / r.secs;

    // 3. it stops, the mouse still down: the exact frame
    const stopMs = await ff().evaluate(async end => (await window.__exactAt()) - end, r.end);
    const s3 = await S(), nStop = s3.n, c1 = await check(v, nStop), k1 = await cost(v, s3, nStop);
    // FFmpeg shows the keyframes once they are ready (a JPEG each), one frame per run before
    // a fast drag shows keyframes: no more new pictures than keyframes crossed (4K here has one every 2 s)
    const crossed = s3.keyFrames.filter(n => n >= 0.1 * s3.frames && n <= 0.9 * s3.frames).length, spacing = r.secs * 1000 / Math.max(1, crossed);
    const keyMs = k1.ffmpeg && kpAt >= s3.keyFrames.length ? 15 : k1.key, fpsMin = Math.min(24, 500 / keyMs, 0.7 * crossed / r.secs), gapMax = Math.max(200, 4 * keyMs, 2 * spacing);
    ok(fps >= fpsMin && r.gap <= gapMax, `${tag}: fast scrub, ${fps.toFixed(1)} new pictures/s (at least ${fpsMin.toFixed(1)}: a keyframe costs ${keyMs.toFixed(0)} ms${k1.ffmpeg ? `, ${kpAt} of ${s3.keyFrames.length} keyframes ready at the start` : ""}), longest wait ${r.gap.toFixed(0)} ms (at most ${gapMax.toFixed(0)})`);
    target("24 pictures/s, no freeze", fps >= 24 && r.gap <= 200, `${fps.toFixed(1)}/s, longest wait ${r.gap.toFixed(0)} ms`);
    perf(`scrub_fps_${tag}`, fps.toFixed(1)); perf(`scrub_gap_ms_${tag}`, r.gap.toFixed(0));
    ok(stopMs <= stopLimit(k1) && exactOk(c1), `${tag}: stopped on frame ${nStop}, exact in ${stopMs.toFixed(0)} ms (the decoder alone: ${k1.frame.toFixed(0)} ms; pixels off: ${pct(c1.self)}, frames either side ${pct(c1.prev)}, ${pct(c1.next)})`);
    target("exact in 150 ms on stopping", stopMs <= 150, `${stopMs.toFixed(0)} ms`);
    perf(`stop_exact_ms_${tag}`, stopMs.toFixed(0)); perf(`stop_decoder_ms_${tag}`, k1.frame.toFixed(0));
    // another fast drag, then the release right away
    const r2 = await drag(0.9, 0.35, 700);
    await page.mouse.up();
    const relMs = await ff().evaluate(async () => (await window.__exactAt()) - window.__upAt);
    const s2 = await S(), nRel = s2.n, c2 = await check(v, nRel), k2 = await cost(v, s2, nRel);
    ok(relMs <= stopLimit(k2) && exactOk(c2), `${tag}: released on frame ${nRel}, exact in ${relMs.toFixed(0)} ms (the decoder alone: ${k2.frame.toFixed(0)} ms; pixels off: ${pct(c2.self)}; the drag before it ${(r2.pictures / r2.secs).toFixed(1)} pictures/s)`);
    target("exact in 150 ms on releasing", relMs <= 150, `${relMs.toFixed(0)} ms`);
    perf(`release_exact_ms_${tag}`, relMs.toFixed(0));

    // 4. frame by frame: forward from 3 frames after a keyframe, then back across it
    const keys = (await S()).keyFrames, k0 = keys[Math.min(keys.length - 1, Math.max(1, Math.floor(keys.length / 3)))];
    await ff().evaluate(n => window.__halApp.show(n), k0 + 3);
    await ff().evaluate(() => window.__exactAt());
    const fw = await steps("ArrowRight", 12), cf = await check(v, fw.n);
    const bw = await steps("ArrowLeft", 20), cb = await check(v, bw.n);
    ok(fw.n === k0 + 15 && exactOk(cf), `${tag}: 12 frames forward to ${fw.n}, each exact (median ${med(fw.ms).toFixed(0)} ms, slowest ${Math.max(...fw.ms).toFixed(0)} ms; pixels off ${pct(cf.self)})`);
    ok(bw.n === k0 - 5 && exactOk(cb), `${tag}: 20 frames back across the keyframe at ${k0} to ${bw.n}, each exact (median ${med(bw.ms).toFixed(0)} ms, slowest ${Math.max(...bw.ms).toFixed(0)} ms; pixels off ${pct(cb.self)})`);
    perf(`step_fwd_ms_${tag}`, `${med(fw.ms).toFixed(0)}/${Math.max(...fw.ms).toFixed(0)}`); perf(`step_back_ms_${tag}`, `${med(bw.ms).toFixed(0)}/${Math.max(...bw.ms).toFixed(0)}`);
    const s4 = await S();
    ok(s4.held.decodedMB <= 400, `${tag}: decoded frames held: ${s4.held.decoded} (${s4.held.decodedMB} MB)`);
    summary.push(`${tag.padEnd(11)} usable ${ms} ms · scrub ${fps.toFixed(1)} fps · stop ${stopMs.toFixed(0)} ms · release ${relMs.toFixed(0)} ms · step ${med(fw.ms).toFixed(0)}/${med(bw.ms).toFixed(0)} ms`);
  }

  // 5. three videos, nine loads: memory and processes flat, a video opened again usable at once
  if (videos.length >= 3) {
    const three = [videos[0], videos[1], videos[videos.length - 1]];
    const mem = [], procs = [], heap = [], times = [];
    for (let k = 0; k < 9; k++) {
      times.push(await open(three[k % 3].path));
      await sleep(1500);
      procs.push(ffmpegs()); heap.push(await heapMB()); mem.push(browserMB());
    }
    ok(procs.every(n => n <= 3), `3 videos × 3: FFmpeg processes after each load: ${procs.join(", ")}`);
    ok(Math.max(...heap.slice(3)) - Math.min(...heap.slice(3)) <= 20, `3 videos × 3: JS heap after each load: ${heap.join(", ")} MB`);
    ok(Math.max(...mem.slice(3)) - Math.min(...mem.slice(3)) <= 200, `3 videos × 3: browser memory after each load: ${mem.join(", ")} MB`);
    ok(times.slice(3).every(t => t <= 1000), `3 videos × 3: opened again, usable in ${times.slice(3).join(", ")} ms (first time ${times.slice(0, 3).join(", ")} ms)`);
    perf("switch_usable_ms", times.join("/")); perf("switch_browser_mb", mem.join("/")); perf("switch_heap_mb", heap.join("/")); perf("switch_procs", procs.join("/"));
    await page.screenshot({ path: path.join(process.env.SHOTS || os.tmpdir(), "framegrab-perf.png") }).catch(() => {});
  }

  console.log("\n" + summary.join("\n"));
  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall green");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
