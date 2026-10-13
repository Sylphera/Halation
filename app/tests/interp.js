// Frame rate ×AI (interp.js, interp.rs) used as a user would, with RIFE's stand-in (tests/fake-rife.js: the same
// arguments, exactly -n frames) or the real rife-ncnn-vulkan when RIFE_BIN and RIFE_MODEL name it:
// 1. Not installed: the button downloads RIFE and FFmpeg, and the tool says it is ready.
// 2. A 23.976 fps video with AAC audio from the file picker: its size, rate and length, the plan for ×2, ×4 and a
//    target rate; the scrubber moves the still and its time.
// 3. Preview: 3 s from the chosen point, before and after side by side, playing together; pause, speed ¼×.
// 4. Interpolate to 60 fps: an MP4 in Exports\Interpolated at 60/1 with the frames in proportion, the same length,
//    and the audio stream bit for bit the original's; the work folder is gone.
// 5. Another tool and back: the video, the options and the result are still there.
// 6. A second video (25 fps, Vorbis in WebM, which MP4 cannot hold): ×2 gives 50 fps with the audio in AAC.
// 7. The result to Frame Grab (Send to…), and from the Library's exports back into Frame rate.
// 6b. The WebM plays in the page with its sound; another tab stops it. Quality High runs RIFE with -x; a zone painted
//    in "Keep original" goes into FFmpeg's assembly (alphamerge over RIFE's frames) for the preview and the result.
// 8. Cancel during RIFE leaves no file and no work folder; with no Vulkan it runs on the CPU and says so.
// Screenshots → $SHOTS/interp. Usage: node app/tests/interp.js
const fs = require("fs"), os = require("os"), path = require("path"), { execSync } = require("child_process");
const { until, painted, serve, launch, openApp, locale } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "interp");
fs.mkdirSync(SHOTS, { recursive: true });
const FX = makeFixtures(), TOOLS = toolOptions(FX), { L } = locale("en");
const host = createHost(fs.mkdtempSync(path.join(FX.TMP, "interp-")), TOOLS);
fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en" } }));
const P = (...p) => path.join(host.base, ...p);
const sh = c => execSync(c).toString().trim();
const probe = (f, what) => sh(`ffprobe -v error -select_streams ${what} -of csv=p=0 "${f}"`);
const audioMd5 = f => sh(`ffmpeg -v error -i "${f}" -map 0:a -c copy -f md5 -`);
// 4 s at 24000/1001 with AAC audio; 3 s at 25 fps with Vorbis in WebM
const A = path.join(FX.TMP, "dance clip.mp4"), B = path.join(FX.TMP, "second.webm");
execSync(`ffmpeg -v error -f lavfi -i testsrc2=size=320x180:rate=24000/1001:d=4 -f lavfi -i "sine=f=330:d=4" -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 128k -shortest -y "${A}"`);
execSync(`ffmpeg -v error -f lavfi -i testsrc=size=256x144:rate=25:d=3 -f lavfi -i "sine=f=440:d=3" -c:v libvpx-vp9 -deadline realtime -cpu-used 8 -c:a libvorbis -shortest -y "${B}"`);
const LONG = TOOLS.rifeReal ? 900000 : 90000;

(async () => {
  const server = serve(), browser = await launch();
  const { page, errors, tab, appReady, sendTo } = await openApp(browser, server, host, { width: 1480, height: 920 });
  const ip = page.frameLocator("#v-interp"), fr = () => page.frames().find(f => /interp\.html/.test(f.url()));
  const shot = n => painted(page).then(() => page.screenshot({ path: path.join(SHOTS, n + ".png") }));
  const status = () => ip.locator("#status").textContent();
  const plan = () => ip.locator("#plan").textContent();
  const tempLeft = () => fs.readdirSync(host.localDir("workspace", "temp")).filter(f => /^(interp-|j_)/.test(f));
  const out = () => fs.existsSync(P("Exports", "Interpolated")) ? fs.readdirSync(P("Exports", "Interpolated")) : [];

  // 1. install
  await tab("interp"); await appReady("interp");
  ok((await ip.locator("#engineBadge").textContent()) === L("ip.missing") && await ip.locator("#installBtn").isVisible(), "Not installed: the download button is offered");
  await shot("1-missing");
  await ip.locator("#installBtn").click();
  ok(await until(async () => (await ip.locator("#engineBadge").textContent()) === L("ip.ready"), 30000), "Download: RIFE and FFmpeg installed, ready");
  ok(fs.existsSync(P("Tools", "rife", "rife-ncnn-vulkan")) && fs.existsSync(P("Tools", "rife", "rife-v4.6", "flownet.param")), "…in Tools\\rife with its model");

  // 2. a video from the file picker
  const pick = async (file, name) => {
    TOOLS.tools.pickVideo = file;
    await ip.locator(await ip.locator("#browseBtn").isVisible() ? "#browseBtn" : "#changeBtn").click();
    return until(async () => (await ip.locator("#inName").textContent()) === name && !!(await ip.locator("#still").getAttribute("src")), 20000);
  };
  ok(await pick(A, "dance clip.mp4"), "Browse: the video is open with its first frame");
  ok((await ip.locator("#inMeta").textContent()) === "320×180 · 23.98 fps · 0:04.0", "Its size, rate and length: " + await ip.locator("#inMeta").textContent());
  ok((await plan()) === L("ip.plan", { from: "23.98", to: "47.95", a: 96, b: 192 }), "×2: " + await plan());
  await ip.locator('[data-mode="x4"]').click();
  ok((await plan()) === L("ip.plan", { from: "23.98", to: "95.9", a: 96, b: 384 }), "×4: " + await plan());
  await ip.locator('[data-mode="target"]').click();
  ok(await until(() => ip.locator("#fpsRow").isVisible()), "Target: the rate field appears");
  ok((await plan()) === L("ip.plan", { from: "23.98", to: "60", a: 96, b: 240 }), "Target 60: " + await plan());
  await ip.locator("#fps").selectOption("120");
  ok((await plan()).includes("→ 120 fps"), "Target 120: " + await plan());
  await ip.locator("#fps").selectOption("60");
  const still0 = await ip.locator("#still").getAttribute("src");
  await ip.locator("#scrub").evaluate(e => { e.value = "250"; e.dispatchEvent(new Event("input", { bubbles: true })); });
  ok((await ip.locator("#scrubTime").textContent()) === "0:01.0", "Scrub: the time follows (0:01.0)");
  ok(await until(async () => (await ip.locator("#still").getAttribute("src")) !== still0, 10000), "…and the still shows that frame");
  await shot("2-loaded");

  // 3. preview
  await ip.locator("#previewBtn").click();
  ok(await until(async () => (await status()) === L("ip.st.previewed", { from: "0:01.0" }), LONG, 200), "Preview: " + await status());
  const vids = () => fr().evaluate(() => [...document.querySelectorAll("video")].map(v => ({ ready: v.readyState, d: v.duration, paused: v.paused, rate: v.playbackRate, t: v.currentTime })));
  ok(await until(async () => (await vids()).every(v => v.ready >= 2 && !v.paused), 10000), "Before and after play side by side: " + JSON.stringify(await vids()));
  const [vb, va] = await vids();
  ok(Math.abs(vb.d - 3) < 0.1 && Math.abs(va.d - 3) < 0.1, `Both are 3 s long: ${vb.d.toFixed(2)} / ${va.d.toFixed(2)}`);
  ok((await ip.locator("#tagBefore").textContent()) === L("ip.before", { fps: "23.98" }) && (await ip.locator("#tagAfter").textContent()) === L("ip.after", { fps: "60" }), "Their labels give the rates");
  ok(!tempLeft().length, "The preview's work folder is gone");
  const procArgs = () => host.log.filter(([c]) => c === "proc_start").map(([, a]) => a.args || []);
  ok(procArgs().some(a => a.includes("libopus") && a.some(x => /before\.webm$/.test(x))), "\"Before\" carries the sound of those seconds (Opus)");
  ok(await until(() => fr().evaluate(() => document.querySelector("#vBefore").webkitAudioDecodedByteCount > 0 && !document.querySelector("#vBefore").muted), 8000), "…and it is heard (before is not muted)");
  await shot("3-preview");
  ok((await ip.locator("#playBtn").getAttribute("data-icon")) === "pause" && (await ip.locator("#playBtn").getAttribute("title")) === L("ip.pause"), "While playing, the button offers Pause");
  await ip.locator("#playBtn").click();
  ok(await until(async () => (await vids()).every(v => v.paused)), "Pause stops both");
  ok((await ip.locator("#playBtn").getAttribute("data-icon")) === "play" && (await ip.locator("#playBtn svg.i").count()) === 1, "…and the button offers Play again");
  await ip.locator('[data-speed="0.25"]').click(); await ip.locator("#playBtn").click();
  ok(await until(async () => (await vids()).every(v => v.rate === 0.25 && !v.paused)), "0.25×: both play slowed down");
  const drift = await until(async () => { const [b, a] = await vids(); return b.t > 0.2 && Math.abs(b.t - a.t) < 0.15; }, 8000);
  ok(drift, "…and together: " + JSON.stringify(await vids()));
  await ip.locator("#scrub").evaluate(e => { e.value = "0"; e.dispatchEvent(new Event("input", { bubbles: true })); });
  ok(await until(async () => await ip.locator("#pair").isHidden() && await ip.locator("#still").isVisible()), "Scrubbing again drops the preview for the still");

  // 4. the whole video to 60 fps
  await ip.locator("#runBtn").click();
  ok(await until(async () => (await status()).startsWith(L("ip.st.done", { name: "" })), LONG, 200), "Interpolate: " + await status());
  const res = P("Exports", "Interpolated", "dance clip-60fps.mp4");
  ok(fs.existsSync(res), "Saved as Exports\\Interpolated\\dance clip-60fps.mp4");
  if (fs.existsSync(res)) {
    const [rate, frames] = probe(res, "v:0 -count_frames -show_entries stream=r_frame_rate,nb_read_frames").split(",");
    ok(rate === "60/1" && Math.abs(+frames - 240) <= 3, `60 fps, about 240 frames (4 s × 60): ${rate}, ${frames}`);
    const dur = +sh(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${res}"`);
    ok(Math.abs(dur - 4) < 0.1, `Same length: ${dur.toFixed(2)} s`);
    ok(audioMd5(res) === audioMd5(A), "The audio is the original's, bit for bit");
  }
  ok(!tempLeft().length && await ip.locator("#result").isVisible() && (await ip.locator("#resultFps").textContent()) === "60 fps", "No work folder left; the result card says 60 fps");
  await shot("4-done");

  // 5. another tool and back
  await tab("grade"); await tab("interp");
  ok((await ip.locator("#inName").textContent()) === "dance clip.mp4" && (await ip.locator('[data-mode="target"]').getAttribute("aria-checked")) === "true" && await ip.locator("#result").isVisible(), "Grade and back: video, options and result are still there");

  // 6. a second video, Vorbis in WebM
  ok(await pick(B, "second.webm"), "A second video replaces the first");
  ok(await ip.locator("#result").isHidden() && (await ip.locator("#inMeta").textContent()).startsWith("256×144 · 25 fps"), "…with its own details and no result of the first");
  await ip.locator('[data-mode="x2"]').click();
  await ip.locator("#runBtn").click();
  ok(await until(async () => (await status()).startsWith(L("ip.st.done", { name: "" })), LONG, 200), "×2: " + await status());
  const res2 = P("Exports", "Interpolated", "second-50fps.mp4");
  if (fs.existsSync(res2)) {
    ok(probe(res2, "v:0 -show_entries stream=r_frame_rate") === "50/1", "50 fps");
    ok(probe(res2, "a:0 -show_entries stream=codec_name") === "aac", "Vorbis cannot go in MP4: the audio is AAC");
  } else ok(false, "second-50fps.mp4 saved");

  // 6b. the WebM played in the page, with its sound
  ok(await until(async () => !(await ip.locator("#playBtn").isDisabled()), 10000), "The video can be played before any preview");
  await ip.locator("#playBtn").click();
  ok(await until(async () => await fr().evaluate(() => window.__interp.playing()) && await ip.locator("#orig").isVisible() && (await ip.locator("#scrubTime").textContent()) !== "0:00.0", 10000), "It plays over the still: " + await ip.locator("#scrubTime").textContent());
  ok(await fr().evaluate(() => !!(window.__interp.O.src && window.__interp.O.src.audio && window.__interp.O.src.audio.playing())), "…with its sound");
  await shot("6b-playing");
  await tab("grade");
  ok(await fr().evaluate(() => !window.__interp.playing() && !window.__interp.O.src.audio.playing()), "Another tab: it stops, and its sound");
  await tab("interp");
  const at = await fr().evaluate(() => window.__interp.input().at);
  ok(at > 0, `Where it stopped is where the preview starts (${at.toFixed(2)} s)`);
  // quality and the kept zone
  await ip.locator('[data-quality="high"]').click();
  await ip.locator("#paintBtn").click();
  const mb = await ip.locator("#mask").boundingBox();
  ok(!!mb && mb.width > 100, "Paint: the mask lies over the picture");
  await page.mouse.move(mb.x + mb.width * 0.2, mb.y + mb.height * 0.2); await page.mouse.down();
  for (let k = 1; k <= 6; k++) await page.mouse.move(mb.x + mb.width * (0.2 + k * 0.05), mb.y + mb.height * 0.3);
  await page.mouse.up();
  ok(await fr().evaluate(() => window.__interp.K.used) && !(await ip.locator("#clearMask").isDisabled()) && await ip.locator("#keepBadge").isVisible(), "A zone painted: Clear and the badge appear");
  await shot("6b-mask");
  const n0 = host.log.length;
  await ip.locator("#previewBtn").click();
  ok(await until(async () => (await status()).startsWith(L("ip.st.previewed", { from: "" }).slice(0, 10)), LONG, 200), "Preview with High and the zone: " + await status());
  const since = () => host.log.slice(n0).filter(([c]) => c === "proc_start").map(([, a]) => a.args || []);
  ok(since().some(a => a.includes("-x")), "High: RIFE runs with -x");
  ok(since().some(a => a.some(x => /alphamerge/.test(x)) && a.some(x => /keep\.png$/.test(x))), "The zone is laid over RIFE's frames (alphamerge with keep.png)");
  await ip.locator("#scrub").evaluate(e => { e.value = "0"; e.dispatchEvent(new Event("input", { bubbles: true })); });
  await ip.locator("#runBtn").click();
  ok(await until(async () => (await status()).startsWith(L("ip.st.done", { name: "" })), LONG, 200), "The result with the zone: " + await status());
  const res3 = P("Exports", "Interpolated", "second-50fps (2).mp4");
  ok(fs.existsSync(res3) && probe(res3, "v:0 -show_entries stream=r_frame_rate") === "50/1" && probe(res3, "a:0 -show_entries stream=codec_name") === "aac", "…50 fps with its sound, " + (fs.existsSync(P("Exports", "Interpolated")) ? fs.readdirSync(P("Exports", "Interpolated")).join(", ") : ""));
  await ip.locator("#clearMask").click(); await ip.locator('[data-quality="std"]').click();
  ok(!(await fr().evaluate(() => window.__interp.K.used)) && await ip.locator("#keepBadge").isHidden(), "Clear: no zone left");

  // 7. Send to… Frame Grab; the Library's exports back into Frame rate
  await sendTo(ip, "#sendBtn", "framegrab");
  const fg = page.frameLocator("#v-framegrab");
  ok(await until(() => page.evaluate(() => document.querySelector("#v-framegrab").classList.contains("on")), 10000), "Send to… Frame Grab opens it");
  ok(await until(async () => (await fg.locator("body").innerText()).includes("second-50fps"), 20000), "…with the video");
  await tab("library");
  const card = page.locator("#libPanel .libv-card", { hasText: "dance clip-60fps" }).first();
  ok(await until(() => card.isVisible(), 10000), "The result is in the Library");
  await card.click(); await page.locator('.libv-detail [data-d="send"]').waitFor();
  await sendTo(page, page.locator('.libv-detail [data-d="send"]'), "interp");
  ok(await until(async () => (await ip.locator("#inName").textContent()) === "dance clip-60fps.mp4", 20000), "Send to… Frame rate from the Library: the video is the input");
  ok((await ip.locator("#inMeta").textContent()).includes("· 60 fps ·"), "…at 60 fps: " + await ip.locator("#inMeta").textContent());

  // 8. Cancel during RIFE; no Vulkan
  await pick(A, "dance clip.mp4");
  TOOLS.tools.env.FAKE_RIFE_MS = "60";
  const before = out();
  await ip.locator("#runBtn").click();
  ok(await until(async () => (await status()).startsWith(L("ip.st.rife", { pct: 0 }).split("…")[0]), 20000, 50), "RIFE is running: " + await status());
  await ip.locator("#cancelBtn").click();
  ok(await until(async () => (await status()) === L("ip.st.cancelled"), 20000), "Cancel: " + await status());
  ok(await until(() => !tempLeft().length, 5000) && out().length === before.length, "…no file and no work folder left");
  ok(await ip.locator("#cancelBtn").isHidden() && await ip.locator("#runBtn").isEnabled(), "…and it can run again");
  if (!TOOLS.rifeReal) {
    TOOLS.tools.env.FAKE_RIFE_MS = "30"; TOOLS.tools.env.VK_ICD_FILENAMES = "/nonexistent/icd.json";
    const n0 = host.log.filter(l => l[0] === "proc" && l[1].tool === "rife").length;
    await ip.locator("#previewBtn").click();
    ok(await until(async () => (await status()).startsWith(L("ip.st.rifeCpu", { pct: 0 }).split("…")[0]), 30000, 50), "No Vulkan: on the CPU, and it says so: " + await status());
    await shot("8-cpu");
    ok(await until(async () => (await status()) === L("ip.st.previewed", { from: "0:00.0" }), 60000, 200), "…and the preview is made: " + await status());
    const runs = host.log.filter(l => l[0] === "proc" && l[1].tool === "rife").slice(n0).map(l => l[1].args.includes("-g"));
    ok(runs.join() === "false,true", "RIFE tried the GPU once, then ran with -g -1: " + runs.join());
    delete TOOLS.tools.env.VK_ICD_FILENAMES; TOOLS.tools.env.FAKE_RIFE_MS = "0";
  }

  ok(!errors.length, "No page errors: " + errors.join(" | "));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall OK");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
