// Visualizer layer export (docs/ARCHITECTURE.md → Export):
// 1. Equivalence in the page: the layers composited as an editor does match the full render at several frames
//    (inside the fades too), with the finish baked and as a separate Overlay layer.
// 2. Without FFmpeg the dialog offers to download it (Downloader flow), then exports.
// 3. A 3 s export in ProRes 4444 (separate overlay, audio, bass envelope) and in WebM with alpha (baked):
//    ffprobe checks codecs, pixel formats with alpha, identical duration, frame count and frame rate, start 0.
// 4. The layers composited by FFmpeg match the full render; settings changed during the export do not reach it.
// Usage: node app/tests/layers.js   Screenshots go to $SHOTS/layers.
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { until, painted, serve, launch, openApp, locale } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "layers");
fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const { L } = locale("en");
// Limits in 0–255 levels (docs/ARCHITECTURE.md → Export)
// JS composite vs full render; with the Overlay finish during fades the grain cannot be exact (see docs/ARCHITECTURE.md → Export)
const EQ = { baked: { max: 6, p999: 2, mean: 0.3 }, overlay: { max: 6, p999: 2, mean: 0.5 }, overlayFading: { max: 14, p999: 9, mean: 1.4 } };
// FFmpeg composite of the files vs full render (background and overlay finish are H.264 4:2:0)
const FF = { prores4444: { max: 20, p999: 10, mean: 2 }, webm: { max: 60, p999: 24, mean: 3 } };

const FX = makeFixtures(), TOOLS = toolOptions(FX), fx = n => path.join(FX.FIX, n);
const host = createHost(FX.TMP, { tools: TOOLS.tools });           // no FFmpeg yet: the dialog must offer it
fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en" } }));
const probe = (file, extra = []) => JSON.parse(execFileSync("ffprobe", ["-v", "error", ...extra, "-count_frames", "-show_entries", "format=duration,start_time:stream=codec_name,pix_fmt,r_frame_rate,nb_read_frames,duration,start_time,sample_rate,width,height:stream_tags=alpha_mode", "-of", "json", file]).toString());

(async () => {
  const server = serve(), browser = await launch();
  const app = await openApp(browser, server, host);
  const { page, errors, vis, tab, appReady } = app;
  const shot = n => page.screenshot({ path: path.join(SHOTS, n + ".png") });
  await tab("visualizer"); await appReady("visualizer");
  const V = () => app.vFrame();
  await app.cover(fx("sky.png"));
  await vis.locator("#audIn").setInputFiles(fx("song one.wav"));
  await until(async () => /song one\.wav · 0:03/.test(await vis.locator("#audName").textContent()), 15000);
  // a look that uses every pass: glow, shadow, border, text, spinning icon, grain, vignette, fades, pulse
  await V().evaluate(() => {
    const set = (id, v) => { const el = document.getElementById("f-" + id); if (el.type === "checkbox") { if (el.checked !== v) el.click(); } else { el.value = v; el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input")); } };
    set("format", "1280x720"); set("fps", "30"); set("glow", 45); set("glowPulse", 30); set("borderWidth", 2); set("grain", 12); set("vignette", 55);
    set("fadeIn", 0.6); set("fadeOut", 0.6); set("coverPulse", 4); set("bgFlash", 50); set("textOn", true); set("logoOn", true); set("logoRpm", 20); set("shake", 3);
  });
  await V().evaluate(() => { const el = document.getElementById("f-title"); el.value = "Layer test"; el.dispatchEvent(new Event("input")); });
  await painted(page);

  /* ================= 1: equivalence in the page ================= */
  for (const finish of ["baked", "overlay"]) {
    const r = await V().evaluate(f => window.__halApp.testing.layerCheck([0.2, 1.0, 1.7, 2.1, 2.7], f), finish);
    const within = r.every(x => { const L = EQ[finish === "overlay" && x.fade < 1 ? "overlayFading" : finish]; return x.max <= L.max && x.p999 <= L.p999 && x.mean <= L.mean; });
    ok(within, `Layers (${finish}) composited = full render at ${r.length} frames: ` + r.map(x => `t ${x.t}: max ${x.max}, p99.9 ${x.p999}, mean ${x.mean.toFixed(3)}`).join(" · "));
  }

  /* ================= 2: the dialog, FFmpeg missing ================= */
  await vis.locator("#exportBtn").click();
  ok(await until(() => vis.locator("#xDialog").isVisible()), "Export opens the dialog");
  await vis.locator('#xMode [data-mode="layers"]').click();
  ok(await until(() => vis.locator("#xFf").isVisible()) && await vis.locator("#xGo").isDisabled(), "Layers without FFmpeg: the dialog offers to download it and export waits");
  await shot("2a-no-ffmpeg");
  await vis.locator("#xFfGet").click();
  ok(await until(() => vis.locator("#xFf").isHidden(), 15000) && await vis.locator("#xGo").isEnabled(), "Download FFmpeg (the Downloader's flow) and export is available");
  await vis.locator('input[name="xFinish"][value="overlay"]').check();
  for (const id of ["#xWbg", "#xWcover", "#xWtext", "#xWfinish", "#xAudio", "#xEnv"]) await vis.locator(id).check();
  await vis.locator("#xFormat").selectOption("prores4444");
  const files = await vis.locator("#xFiles .xfile code").allTextContents();
  ok(["01 Background.mp4", "02 Cover.mov", "03 Text.mov", "04 Finish.mp4", "05 Audio.wav", "06 Bass envelope.mp4", "06 Bass envelope.csv"].every(f => files.includes(f)), "Estimate per file: " + files.slice(1).join(", "));
  ok(await until(async () => /free/.test(await vis.locator("#xSpace").textContent())), "Total estimate and free space: " + await vis.locator("#xSpace").textContent());
  host.setDiskFree(1e6);
  await vis.locator("#xAudio").uncheck(); await vis.locator("#xAudio").check();
  ok(await until(async () => (await vis.locator("#xSpace").getAttribute("class")).includes("bad")), "Warning when it does not fit: " + await vis.locator("#xSpace").textContent());
  host.setDiskFree(null);
  await vis.locator("#xAudio").uncheck(); await vis.locator("#xAudio").check();
  await painted(page);
  await shot("2b-dialog-layers");

  /* ================= 3: ProRes 4444, separate overlay, extras ================= */
  const refIdx = [5, 30, 52, 86];
  const ref = await V().evaluate(ix => window.__halApp.testing.reference(ix), refIdx);
  const t0 = Date.now();
  await vis.locator("#xGo").click();
  // settings changed while it exports must not reach the files
  await until(() => V().evaluate(() => window.__halApp.busy()), 10000, 20);
  await V().evaluate(() => { const el = document.getElementById("f-coverSize"); el.value = 30; el.dispatchEvent(new Event("input")); });
  ok(await until(async () => /files saved/.test(await vis.locator("#status").textContent()), 400000, 500), "Layer export finishes: " + await vis.locator("#status").textContent());
  const took1 = (Date.now() - t0) / 1000;
  const res1 = await V().evaluate(() => window.__halLastLayers);
  const dir1 = res1.dir, list1 = fs.readdirSync(dir1).sort();
  ok(JSON.stringify(list1) === JSON.stringify(["01 Background.mp4", "02 Cover.mov", "03 Text.mov", "04 Finish.mp4", "05 Audio.wav", "06 Bass envelope.csv", "06 Bass envelope.mp4", "IMPORT NOTES.txt"]), `Folder «${path.basename(dir1)}» in Exports\\Videos: ${list1.join(", ")}`);
  ok(path.basename(dir1) === "Layer test - layers" && path.dirname(dir1) === path.join(host.base, "Exports", "Videos"), "Named <title> - layers");
  const p = {}; for (const f of list1.filter(f => /\.(mp4|mov|wav)$/.test(f))) p[f] = probe(path.join(dir1, f));
  const vs = f => p[f].streams[0];
  ok(["01 Background.mp4", "04 Finish.mp4"].every(f => vs(f).codec_name === "h264" && vs(f).pix_fmt === "yuv420p"), "Background and finish (opaque): H.264 yuv420p");
  for (const f of ["02 Cover.mov", "03 Text.mov"]) ok(vs(f).codec_name === "prores" && /^yuva444p/.test(vs(f).pix_fmt), `${f}: ProRes 4444 with alpha (${vs(f).pix_fmt})`);
  ok(vs("05 Audio.wav").codec_name === "pcm_s24le" && vs("05 Audio.wav").sample_rate === "48000", "Audio: WAV 24-bit 48 kHz");
  const vids = ["01 Background.mp4", "02 Cover.mov", "03 Text.mov", "04 Finish.mp4", "06 Bass envelope.mp4"];
  const frames = vids.map(f => +vs(f).nb_read_frames), rates = vids.map(f => vs(f).r_frame_rate), sizes = vids.map(f => `${vs(f).width}x${vs(f).height}`);
  ok(frames.every(n => n === 90) && rates.every(r => r === "30/1") && sizes.every(s => s === "1280x720"), `Same frames, rate and size: ${frames.join("/")} · ${[...new Set(rates)]} · ${[...new Set(sizes)]}`);
  const durs = [...vids, "05 Audio.wav"].map(f => +p[f].format.duration), starts = [...vids, "05 Audio.wav"].map(f => +(p[f].format.start_time || 0));
  ok(durs.every(d => Math.abs(d - 3) < 0.0011) && starts.every(s => s === 0), `Same duration, all from 0: ${durs.map(d => d.toFixed(3)).join(" / ")} s`);
  const csv = fs.readFileSync(path.join(dir1, "06 Bass envelope.csv"), "utf8").trim().split(/\r?\n/);
  ok(csv.length === 91 && csv[0] === "frame,time_s,bass" && csv.slice(1).every((l, i) => new RegExp(`^${i},`).test(l)), "Bass envelope CSV: one value per frame (" + (csv.length - 1) + ")");
  const notes = fs.readFileSync(path.join(dir1, "IMPORT NOTES.txt"), "utf8");
  ok(notes.includes(L("vis.notes.order")) && /01 Background\.mp4 — blend mode Normal/.test(notes) && /04 Finish\.mp4 — blend mode Overlay/.test(notes) && notes.indexOf("01 Background") < notes.indexOf("02 Cover") && notes.indexOf("03 Text") < notes.indexOf("04 Finish"), "IMPORT NOTES.txt lists the order and blend modes");

  // FFmpeg composites the files; compared with the full render (which also proves the frozen settings)
  function composite(dir, fmt, finish) {
    const ext = fmt === "webm" ? "webm" : "mov", dec = fmt === "webm" ? ["-c:v", "libvpx-vp9"] : [];
    const yuv = "scale=in_color_matrix=bt709:in_range=tv";
    const inputs = ["-i", path.join(dir, "01 Background.mp4"), ...dec, "-i", path.join(dir, `02 Cover.${ext}`), ...dec, "-i", path.join(dir, `03 Text.${ext}`)];
    let fc = `[0:v]${yuv},format=gbrp[b];[1:v]${yuv},format=rgba[c];[2:v]${yuv},format=rgba[t];[b][c]overlay=format=rgb:alpha=straight[bc];[bc][t]overlay=format=rgb:alpha=straight`;
    if (finish) { inputs.push("-i", path.join(dir, "04 Finish.mp4")); fc += `,format=gbrp[bct];[3:v]${yuv},format=gbrp[f];[bct][f]blend=all_mode=overlay`; }
    fc += `,select='${refIdx.map(i => `eq(n\\,${i})`).join("+")}',format=rgb24`;
    return execFileSync("ffmpeg", ["-v", "error", ...inputs, "-filter_complex", fc, "-fps_mode", "passthrough", "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
  }
  function compare(buf) {
    const n = 1280 * 720 * 3, hist = new Uint32Array(256); let max = 0, sum = 0;
    let at = null;
    ref.forEach((b64, k) => { const r = Buffer.from(b64, "base64"); for (let i = 0; i < n; i++) { const d = Math.abs(r[i] - buf[k * n + i]); hist[d]++; sum += d; if (d > max) { max = d; at = { frame: refIdx[k], x: Math.floor(i / 3) % 1280, y: Math.floor(i / 3 / 1280), got: buf[k * n + i], want: r[i] }; } } });
    let c = 0, p999 = 0; const total = n * ref.length; for (let v = 0; v < 256; v++) { c += hist[v]; if (c >= total * 0.999) { p999 = v; break; } }
    return { max, p999, mean: sum / total, at };
  }
  // side by side for review: the full render and the FFmpeg composite of frame 30
  const png = (rgb, name) => execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", "1280x720", "-i", "-", path.join(SHOTS, name)], { input: rgb });
  const comp1 = composite(dir1, "prores4444", true), fn = 1280 * 720 * 3;
  png(Buffer.from(ref[1], "base64"), "3a-full-render-f30.png"); png(comp1.subarray(fn, 2 * fn), "3b-prores-composite-f30.png");
  const c1 = compare(comp1);
  ok(c1.max <= FF.prores4444.max && c1.p999 <= FF.prores4444.p999 && c1.mean <= FF.prores4444.mean, `FFmpeg composite of the ProRes layers (Overlay finish) = full render, settings frozen: max ${c1.max} ${JSON.stringify(c1.at)}, p99.9 ${c1.p999}, mean ${c1.mean.toFixed(2)}`);

  /* ================= 3b: WebM with alpha, baked finish ================= */
  await V().evaluate(() => { const el = document.getElementById("f-coverSize"); el.value = 52; el.dispatchEvent(new Event("input")); });
  await painted(V());
  const ref2 = await V().evaluate(ix => window.__halApp.testing.reference(ix), refIdx);
  ref.splice(0, ref.length, ...ref2);
  await vis.locator("#exportBtn").click(); await until(() => vis.locator("#xDialog").isVisible());
  await vis.locator('input[name="xFinish"][value="baked"]').check();
  await vis.locator("#xFormat").selectOption("webm");
  await vis.locator("#xAudio").uncheck(); await vis.locator("#xEnv").uncheck();
  ok(await vis.locator("#xWfinish").isDisabled(), "Baked finish: no separate Finish layer");
  const t1 = Date.now();
  await vis.locator("#xGo").click();
  ok(await until(async () => /files saved/.test(await vis.locator("#status").textContent()) && (await V().evaluate(() => window.__halLastLayers.dir)) !== dir1, 400000, 500), "WebM layer export finishes");
  const took2 = (Date.now() - t1) / 1000;
  const res2 = await V().evaluate(() => window.__halLastLayers), dir2 = res2.dir;
  const list2 = fs.readdirSync(dir2).sort();
  ok(JSON.stringify(list2) === JSON.stringify(["01 Background.mp4", "02 Cover.webm", "03 Text.webm", "IMPORT NOTES.txt"]) && path.basename(dir2) === "Layer test - layers (2)", "Second export in «Layer test - layers (2)»: " + list2.join(", "));
  for (const f of ["02 Cover.webm", "03 Text.webm"]) {
    const a = probe(path.join(dir2, f));
    // the alpha plane is read by libvpx (FFmpeg's own VP9 decoder ignores it): part of the frame is transparent
    const px = execFileSync("ffmpeg", ["-v", "error", "-c:v", "libvpx-vp9", "-i", path.join(dir2, f), "-vf", "select=eq(n\\,30)", "-frames:v", "1", "-pix_fmt", "rgba", "-f", "rawvideo", "-"], { maxBuffer: 1 << 26 });
    let clear = 0, solid = 0; for (let i = 3; i < px.length; i += 4) { if (px[i] === 0) clear++; else if (px[i] === 255) solid++; }
    ok(a.streams[0].codec_name === "vp9" && (a.streams[0].tags || {}).alpha_mode === "1" && clear > 0 && solid > 0 && +a.streams[0].nb_read_frames === 90 && a.streams[0].r_frame_rate === "30/1", `${f}: VP9 with alpha (alpha_mode 1, yuva420p through libvpx: ${(clear / (px.length / 4) * 100).toFixed(0)} % transparent), 90 frames at 30/1`);
  }
  const d2 = ["01 Background.mp4", "02 Cover.webm", "03 Text.webm"].map(f => +probe(path.join(dir2, f)).format.duration);
  ok(d2.every(d => Math.abs(d - 3) < 0.0011), "Same duration: " + d2.map(d => d.toFixed(3)).join(" / "));
  const c2 = compare(composite(dir2, "webm", false));
  ok(c2.max <= FF.webm.max && c2.p999 <= FF.webm.p999 && c2.mean <= FF.webm.mean, `FFmpeg composite of the WebM layers (baked finish) = full render: max ${c2.max} ${JSON.stringify(c2.at)}, p99.9 ${c2.p999}, mean ${c2.mean.toFixed(2)}`);

  /* ================= 4: cancel removes the folder ================= */
  await vis.locator("#exportBtn").click(); await until(() => vis.locator("#xDialog").isVisible());
  await vis.locator("#xGo").click();
  await until(async () => /frame/.test(await vis.locator("#status").textContent()), 60000, 100);
  await vis.locator("#cancelBtn").click();
  ok(await until(async () => (await vis.locator("#status").textContent()) === L("vis.st.exportCancelled"), 60000), "Cancel stops the export");
  ok(!fs.existsSync(path.join(host.base, "Exports", "Videos", "Layer test - layers (3)")), "…and removes its folder");

  const sz = f => fs.statSync(path.join(dir1, f)).size;
  const report = { prores: { seconds: took1, files: Object.fromEntries(list1.filter(f => !f.endsWith(".txt")).map(f => [f, sz(f)])) }, webm: { seconds: took2, files: Object.fromEntries(list2.filter(f => !f.endsWith(".txt")).map(f => [f, fs.statSync(path.join(dir2, f)).size])) }, ffmpegComposite: { prores: c1, webm: c2 }, ipc: host.encStats };
  fs.writeFileSync(path.join(SHOTS, "layers-report.json"), JSON.stringify(report, null, 2));
  console.log("     " + JSON.stringify(report));
  await shot("4a-after");
  const errs = errors.filter(e => !/favicon/.test(e));
  ok(errs.length === 0, "No console errors" + (errs.length ? ":\n  " + errs.join("\n  ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed (layers)` : "\nAll passed (layers)");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
