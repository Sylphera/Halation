// Frame Grab (docs/ARCHITECTURE.md → Shared services), its own tool with the one shared extractor:
// 1. WebM (decoded by the page) and MP4 (shown by FFmpeg): a captured frame is exactly FFmpeg's frame n
//    (difference 0 against select=eq(n)), saved as "{video} - frame {n}.png" in Exports\Frames.
// 2. The queue: frames added with M and Add, in time order with their pictures; removed; at most 8; selected
//    all, none or one by one; the selected ones exported to the Library (listed there), and exported again.
// 3. The destinations (Send to…, Library, Image; "Back to" only with a round trip); Send to… Grade takes the first
//    frame selected.
// 4. Integrations: Grade "Frame from a video" (the round trip, back in Grade with the frame), the Library's
//    "Grab a frame" on a video export.
// 5. A second video (everything follows it; the first one's FFmpeg jobs are killed), play / pause with the button
//    and Space, scrubbing, another tab and back, a capture after all that.
// 6. The capture's layout (16:9, 1:1) over 9:16, 4:3, 21:9 and 16:9 sources: exact sizes against FFmpeg's crop, the
//    frame dragged holds through scrubbing and captures, a 1:1 capture is sent as it is.
// 7. The performance overlay: off by default; fps, the exact frame's time, the decoding path, the cache.
// 8. With the animations on (the rest runs with reduced motion): the queue adds and removes, exports twice, and
//    another video opens with its loading screen.
// 9. The sound: a video with sound plays it (mute and volume kept in Settings), one without says so; another tab
//    stops playback and frees the decoded frames. The sharpest frame nearby (S): a soft shot with one sharp frame.
//    The other layouts: the whole frame, 9:16 and 4:5, exact against FFmpeg's crop.
//    Screenshots → $SHOTS/framegrab.
// Usage: node app/tests/framegrab.js
const fs = require("fs"), os = require("os"), path = require("path"), { execSync } = require("child_process");
const { until, sleep, painted, serve, launch, openApp } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "framegrab");
fs.mkdirSync(SHOTS, { recursive: true });
const FX = makeFixtures(), TOOLS = toolOptions(FX);
const ffmpeg = execSync("command -v ffmpeg").toString().trim();
const host = createHost(fs.mkdtempSync(path.join(FX.TMP, "fg-")), { ...TOOLS, tools: { ...TOOLS.tools, systemFfmpeg: ffmpeg } });
fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en" } }));
const WEBM = path.join(FX.TMP, "clip.webm"), MP4 = path.join(FX.TMP, "clip.mp4");
execSync(`ffmpeg -v error -f lavfi -i testsrc2=size=640x360:rate=24:duration=4 -f lavfi -i "color=c=navy:s=640x360:r=24:d=2" -filter_complex "[0][1]concat=n=2:v=1" -c:v libvpx-vp9 -b:v 800k -y "${WEBM}"`);
execSync(`ffmpeg -v error -f lavfi -i testsrc2=size=640x360:rate=30:duration=3 -c:v libx264 -pix_fmt yuv420p -y "${MP4}"`);
const rgba = (args, file) => execSync(`ffmpeg -v error -i "${file}" ${args} -frames:v 1 -f rawvideo -pix_fmt rgba -`, { maxBuffer: 1 << 26 });
const maxDiff = (a, b) => { if (a.length !== b.length) return 999; let d = 0; for (let i = 0; i < a.length; i++) d = Math.max(d, Math.abs(a[i] - b[i])); return d; };
const FRAMES = path.join(host.base, "Exports", "Frames"), LIB = path.join(host.base, "Library", "Frames");
const newIn = (dir, have) => fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => !have.has(f)) : [];
const list = dir => new Set(fs.existsSync(dir) ? fs.readdirSync(dir) : []);

(async () => {
  const server = serve(), browser = await launch();
  const app = await openApp(browser, server, host, { width: 1480, height: 920 });
  const { page, errors } = app;
  const fg = page.frameLocator("#v-framegrab"), ff = () => page.frames().find(f => /framegrab\.html/.test(f.url()));
  const S = () => ff().evaluate(() => window.__halApp.state());
  const active = t => page.evaluate(t => document.querySelector("#v-" + t).classList.contains("on"), t);
  const shot = n => page.screenshot({ path: path.join(SHOTS, n) });
  await app.tab("framegrab");
  await until(() => ff() && ff().evaluate(() => window.__halApp && window.__halApp.ready.then(() => true)), 20000);
  // loaded once the page shows this file's name and its strip is in (the previous video's state is reset on load)
  const loadVideo = async file => { await fg.locator("#videoIn").setInputFiles(file); await until(async () => (await fg.locator("#srcName").textContent()) === path.basename(file) && (await S()).settled, 60000); await painted(page); };
  const dest = async d => { await fg.locator(`#dests input[value="${d}"]`).check(); await until(async () => (await S()).dest === d, 5000, 20); };
  // the frame shown, alone in the queue, exported to d (the queue is emptied first)
  const clearQueue = () => ff().evaluate(() => { for (let b; (b = document.querySelector("#queue .fg-q:not([data-ghost]) [data-rm]"));) b.click(); });
  const capOne = async d => { await clearQueue(); await fg.locator("#addBtn").click(); if (d) await dest(d); await until(async () => !(await fg.locator("#captureBtn").isDisabled()), 5000, 20); await fg.locator("#captureBtn").click(); };
  const Q = async () => (await S()).queue.map(q => q.n).join();
  const step = async n => { await ff().evaluate(() => document.querySelector("#timeline").focus()); const n0 = (await S()).n; for (let i = 0; i < n; i++) await page.keyboard.press("ArrowRight"); await until(async () => (await S()).n === n0 + n, 5000, 20); await painted(page); };

  // 1. the exact frame, WebM and MP4
  for (const [file, name] of [[WEBM, "clip.webm"], [MP4, "clip.mp4"]]) {
    await loadVideo(file);
    const s0 = await S();
    await step(7);
    const n = (await S()).n;
    const have = list(FRAMES);
    await capOne("image");
    await until(() => newIn(FRAMES, have).length === 1, 15000);
    const out = path.join(FRAMES, newIn(FRAMES, have)[0]);
    const d = maxDiff(rgba("", out), rgba(`-vf "select=eq(n\\,${n})"`, file));
    ok(n === 7 && d === 0 && /^clip - frame 8( \(\d\))?\.png$/.test(path.basename(out)), `${name} (${s0.sink ? "decoded by the page" : "shown by FFmpeg"}): frame ${n} saved as ${path.basename(out)}, difference to FFmpeg ${d}`);
    if (name === "clip.webm") await shot("framegrab.png");
  }

  // 2. the queue, the Library
  await loadVideo(WEBM);
  const home = async () => { await ff().evaluate(() => document.querySelector("#timeline").focus()); await page.keyboard.press("Home"); };
  for (const k of [25, 3]) { await home(); await step(k); await page.keyboard.press("m"); }
  await home(); await step(10); await fg.locator("#addBtn").click();
  await until(async () => (await S()).queue.every(q => q.pic), 5000, 20);
  let s = await S();
  ok(await Q() === "3,10,25" && s.queue.every(q => q.sel && q.pic) && await fg.locator("#queue .fg-q canvas").count() === 3 && await fg.locator("#cntQueue").textContent() === "3 / 8",
    `M and Add queue frames in time order, selected, each with its picture (${JSON.stringify(s.queue)}, ${await fg.locator("#queue .fg-q canvas").count()} pictures, ${await fg.locator("#cntQueue").textContent()})`);
  await page.keyboard.press("m");
  ok(await Q() === "3,10,25", "a frame already queued is not added twice");
  await fg.locator('#queue [data-rm="10"]').click();
  await until(async () => await Q() === "3,25", 3000, 20);
  ok(await Q() === "3,25" && await fg.locator("#queue .fg-q").count() === 2, `the x removes a frame (${await Q()})`);
  await fg.locator('#queue [data-go="25"]').click(); await until(async () => (await S()).n === 25, 5000, 20);
  ok((await S()).n === 25 && await fg.locator('#queue [data-n="25"]').getAttribute("aria-current") === "true", "a queued frame clicked shows it");
  for (const k of [40, 50, 60, 70, 80, 90, 100]) { await home(); await step(k); await page.keyboard.press("m"); }
  ok((await S()).queue.length === 8 && !(await Q()).includes("100") && /8 frames/.test(await fg.locator("#status").textContent()) && await fg.locator("#addBtn").isDisabled(),
    `at most 8 frames: the 9th is refused (${await Q()})`);
  await fg.locator("#selNone").click();
  ok((await S()).queue.every(q => !q.sel) && await fg.locator("#captureBtn").isDisabled() && /Select a frame/.test(await fg.locator("#captureText").textContent()), "Select none: nothing to export, the button says so");
  await fg.locator("#selAll").click();
  ok((await S()).queue.every(q => q.sel) && /Export 8 selected/.test(await fg.locator("#captureText").textContent()), "Select all: the 8 frames");
  await fg.locator("#selNone").click();
  for (const n of [3, 25]) await fg.locator(`#queue [data-sel="${n}"]`).click();
  s = await S();
  ok(s.queue.filter(q => q.sel).map(q => q.n).join() === "3,25" && /Export 2 selected/.test(await fg.locator("#captureText").textContent()), "frames selected one by one");
  await dest("library");
  const haveL = list(LIB);
  await fg.locator("#captureBtn").click();
  await until(() => newIn(LIB, haveL).length === 2, 20000);
  ok(newIn(LIB, haveL).length === 2, "the two selected frames go to Library\\Frames at once");
  await until(async () => !(await fg.locator("#captureBtn").isDisabled()), 5000, 20);
  await fg.locator("#captureBtn").click();
  await until(() => newIn(LIB, haveL).length === 4, 20000);
  ok(newIn(LIB, haveL).length === 4 && !/Could not/.test(await fg.locator("#status").textContent()), `and again (${newIn(LIB, haveL).length} files, no error)`);
  await app.tab("library"); await until(async () => (await page.locator("#libPanel .libv-card", { hasText: "clip - frame 26" }).count()) >= 1, 5000, 20); await painted(page);
  ok(await page.locator("#libPanel .libv-card", { hasText: "clip - frame 26" }).count() >= 1, "and they are listed in the Library");
  await shot("library.png");
  await app.tab("framegrab"); await painted(page); await shot("queue.png");

  // 3. the destinations; Send to… Grade with two frames selected: the first one
  const dests = await fg.locator('#dests input[name="dest"]').evaluateAll(l => l.map(x => x.value));
  ok(dests.join() === "send,library,image", `destinations without a round trip: Send to…, Library and Image (${dests})`);

  // 4. integrations
  await app.tab("grade"); await app.appReady("grade");
  await app.grade.locator("#frameBtn").click();
  await until(() => active("framegrab"), 10000);
  ok(/Grade/.test(await fg.locator("#origin").textContent()), "Grade → Frame Grab with \"Back to Grade\"");
  await step(2);
  await capOne();
  ok(await until(() => active("grade"), 15000) && await until(async () => /frame \d+\.png/.test(await app.grade.locator("#imgName").textContent()), 15000), "the frame comes back into Grade as its picture");
  // Send to… as the destination, two frames selected (3 and 25): Grade gets the first one
  await app.tab("framegrab"); await clearQueue();
  for (const k of [25, 3]) { await ff().evaluate(n => window.__halApp.show(n), k); await fg.locator("#addBtn").click(); }
  await until(async () => await Q() === "3,25", 5000, 20);
  await dest("send");
  ok(/Send to/.test(await fg.locator("#captureText").textContent()), "Send to… as a destination: the button opens the menu");
  await app.sendTo(fg, "#captureBtn", "grade");
  ok(await until(() => active("grade"), 15000) && await until(async () => /clip - frame 4( \(\d\))?\.png/.test(await app.grade.locator("#imgName").textContent()), 15000),
    "Send to… Grade: the first frame selected (queue " + await Q() + ", " + await app.grade.locator("#imgName").textContent() + ")");
  await page.evaluate(p => window.__hal.recordExport({ path: p, name: "clip.webm", kind: "video" }), (() => { const d = path.join(host.base, "Exports", "Videos"); fs.mkdirSync(d, { recursive: true }); fs.copyFileSync(WEBM, path.join(d, "clip.webm")); return path.join(d, "clip.webm"); })());
  await app.tab("library"); await page.locator("#libPanel .libv-card", { hasText: "clip.webm" }).first().click();
  await page.locator('.libv-detail [data-d="send"]').waitFor();
  await app.sendTo(page, page.locator('.libv-detail [data-d="send"]'), "framegrab");
  ok(await until(() => active("framegrab"), 10000) && await until(async () => (await fg.locator("#srcName").textContent()) === "clip.webm", 15000), "Library → Send to… Frame Grab opens the video");

  // 5. a second video, as a user goes: everything follows it (name, size, timeline, strip, view, suggestions), the
  // first one's jobs end; play / pause with the button and Space; scrubbing; another tab and back; capturing
  const pix = (sel, fr = ff()) => fr.evaluate(s => { const c = document.querySelector(s), g = c.getContext("2d").getImageData(0, 0, c.width, c.height).data; let h = 0; for (let i = 0; i < g.length; i += 97) h = (h * 31 + g[i]) >>> 0; return h + ":" + c.width; }, sel);
  await app.tab("framegrab");
  await loadVideo(WEBM);
  await step(12); await page.keyboard.press("m");
  const a1 = { s: await S(), strip: await pix("#strip"), view: await pix("#view"), meta: await fg.locator("#srcMeta").textContent(), max: await fg.locator("#timeline").getAttribute("aria-valuemax"), time: await fg.locator("#timeOut").textContent() };
  // the second video while the first one's analysis would still run: its FFmpeg is killed at once
  const ffCount = () => host.log.filter(l => l[0] === "proc" && l[1].tool === "ffmpeg").length;
  await fg.locator("#videoIn").setInputFiles(MP4);
  await until(async () => (await fg.locator("#srcName").textContent()) === "clip.mp4" && (await S()).settled, 60000);
  await painted(page);
  const b1 = { s: await S(), strip: await pix("#strip"), view: await pix("#view"), meta: await fg.locator("#srcMeta").textContent(), max: await fg.locator("#timeline").getAttribute("aria-valuemax"), time: await fg.locator("#timeOut").textContent() };
  ok(b1.s.frames === 90 && a1.s.frames === 144 && b1.max === "89" && a1.meta !== b1.meta && /00:02\.97$/.test(b1.time), `a second video: its size, frames and timeline (${a1.meta} → ${b1.meta}, ${a1.time} → ${b1.time})`);
  ok(a1.s.queue.length === 1 && b1.strip !== a1.strip && b1.view !== a1.view && b1.s.n === 0 && !b1.s.queue.length && !(await fg.locator("#queue .fg-q").count()), "its strip and its first frame; the queue is emptied");
  // a long job interrupted: load a video, then another before its keyframes at preview size are done
  const LONG = path.join(FX.TMP, "long.mp4");
  execSync(`ffmpeg -v error -f lavfi -i testsrc2=size=1280x720:rate=30:duration=60 -c:v libx264 -preset ultrafast -g 60 -pix_fmt yuv420p -y "${LONG}"`);
  const n0 = ffCount();
  await fg.locator("#videoIn").setInputFiles(LONG);
  await until(async () => (await fg.locator("#srcName").textContent()) === "long.mp4" && (await S()).kp > 0, 30000, 20);
  await fg.locator("#videoIn").setInputFiles(WEBM);
  await until(async () => (await fg.locator("#srcName").textContent()) === "clip.webm" && (await S()).settled, 30000);
  const kids = () => { try { return execSync(`ps -o args= --ppid ${process.pid}`).toString().split("\n").filter(l => /ffmpeg/.test(l) && /long\.mp4/.test(l)).length; } catch (e) { return 0; } };
  ok(ffCount() > n0 && await until(() => kids() === 0, 3000, 50), "the first video's FFmpeg job, still running, is killed when the next one loads");
  ok((await S()).frames === 144 && (await fg.locator("#srcName").textContent()) === "clip.webm", "and the video shown is the last one opened");

  // play and pause: the icon and the state, with the button and with Space (also while a button has the focus)
  const icon = () => fg.locator("#playBtn").getAttribute("data-icon"), label = () => fg.locator("#playBtn").getAttribute("aria-label");
  const svgOf = () => fg.locator("#playBtn svg").innerHTML();
  const playSvg = await svgOf();
  await fg.locator("#playBtn").click();
  ok(await until(async () => (await S()).playing && await icon() === "pause" && await label() === "Pause" && (await svgOf()) !== playSvg, 3000, 20), "Play turns into Pause (icon, label, state)");
  const nPlay = (await S()).n;
  ok(await until(async () => (await S()).n > nPlay + 5, 5000, 20), "and the frames move while it plays");
  await page.keyboard.press(" ");
  ok(await until(async () => !(await S()).playing && await icon() === "play" && (await svgOf()) === playSvg, 3000, 20), "Space pauses (the focus on the button): the icon goes back to Play");
  const haveImg = list(FRAMES);
  await fg.locator("#captureBtn").focus();
  await page.keyboard.press(" ");
  ok(await until(async () => (await S()).playing && await icon() === "pause", 3000, 20), "Space plays with the focus on another button");
  await page.keyboard.press(" ");
  await until(async () => !(await S()).playing, 3000, 20); await sleep(400);
  ok(!(await S()).playing && newIn(FRAMES, haveImg).length === 0, "and pauses again, without pressing that button (nothing captured)");

  // scrubbing: small copies while the pointer moves, the exact frame on release
  const tbox = await fg.locator("#timeline").boundingBox();
  await page.mouse.move(tbox.x + tbox.width * 0.2, tbox.y + tbox.height / 2); await page.mouse.down();
  for (let k = 1; k <= 10; k++) await page.mouse.move(tbox.x + tbox.width * (0.2 + k * 0.05), tbox.y + tbox.height / 2);
  const mid = await S();
  await page.mouse.up();
  const want = Math.round(0.7 * 143);
  ok(Math.abs(mid.n - want) <= 2 && await until(async () => (await S()).n === mid.n && await fg.locator("#frameBadge").getAttribute("data-state") === "exact", 5000, 20), `scrubbing to 70 % shows frame ${mid.n + 1}, exact once released`);
  const scrubView = await pix("#view");
  // another tab and back: the same video, frame, queue and picture
  await page.keyboard.press("m");
  await app.tab("grade"); await app.tab("framegrab");
  const back = await S();
  ok(back.n === mid.n && back.queue.map(q => q.n).join() === String(mid.n) && back.frames === 144 && await pix("#view") === scrubView, "another tab and back: the same frame, queue and picture");
  // capture after all that: still exactly FFmpeg's frame
  await dest("image");
  const have2 = list(FRAMES);
  await fg.locator("#captureBtn").click();
  await until(() => newIn(FRAMES, have2).length === 1, 15000);
  const out2 = path.join(FRAMES, newIn(FRAMES, have2)[0]);
  ok(maxDiff(rgba("", out2), rgba(`-vf "select=eq(n\\,${back.n})"`, WEBM)) === 0, `and the capture is exactly frame ${back.n} (${path.basename(out2)})`);
  await shot("second-video.png");

  // 6. the capture's layout and crop: sources 9:16, 4:3, 21:9 and 16:9 in 16:9 and 1:1. The capture has the layout's
  // exact size and is FFmpeg's crop of the source (no border, no stretch); the frame shows over the view when the
  // shapes differ; dragged, it stays through scrubbing and captures
  const pngSize = f => { const b = fs.readFileSync(f); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  const RAT = { "16:9": [16, 9], "1:1": [1, 1] };
  const capImage = async () => {
    const have = list(FRAMES);
    await capOne("image");
    await until(() => newIn(FRAMES, have).length === 1, 15000);
    return path.join(FRAMES, newIn(FRAMES, have)[0]);
  };
  // the capture against FFmpeg's crop at the framing the page holds now (in RGBA: on YUV 4:2:0 the crop filter
  // rounds odd offsets down)
  const checkCut = async (file, w, h, layout, label) => {
    const st = await S(), [a, b] = RAT[layout], k = Math.floor(Math.min(w / a, h / b)), fits = Math.abs(w / h - a / b) < 0.01;
    const W = fits ? w : a * k, H = fits ? h : b * k, p = st.crop;
    const x = p ? Math.round(p.cx * w - W / 2) : 0, y = p ? Math.round(p.cy * h - H / 2) : 0;
    const out = await capImage(), [cw, ch] = pngSize(out);
    const d = maxDiff(rgba("", out), rgba(`-vf "select=eq(n\\,${st.n}),format=rgba,crop=${W}:${H}:${x}:${y}"`, file));
    ok(cw === W && ch === H && d === 0 && !!p === !fits, `${label}: ${layout} capture ${cw}×${ch} (want ${W}×${H}), FFmpeg's crop at ${x},${y}, difference ${d}${p ? "" : ", no crop"}`);
    return { x, y, W, H };
  };
  const overlay = () => ff().evaluate(() => { const c = document.querySelector("#crop"), f = document.querySelector("#cropFrame"); return { on: !c.hidden && c.offsetWidth > 0, top: f.style.top, left: f.style.left }; });
  const SHAPES = [["9x16", 360, 640], ["4x3", 480, 360], ["21x9", 840, 360], ["16x9", 640, 360]];
  let tall = null;
  for (const [nm, w, h] of SHAPES) {
    const file = path.join(FX.TMP, `shape-${nm}.webm`);
    execSync(`ffmpeg -v error -f lavfi -i testsrc2=size=${w}x${h}:rate=24:duration=2 -c:v libvpx-vp9 -b:v 1M -y "${file}"`);
    await loadVideo(file);
    ok((await S()).layout === "16:9" && await fg.locator('#layout [data-layout="16:9"]').getAttribute("aria-checked") === "true", `${nm}: the layout starts at 16:9`);
    for (const layout of ["16:9", "1:1"]) {
      await fg.locator(`#layout [data-layout="${layout}"]`).click();
      await until(async () => (await S()).layout === layout, 3000, 20);
      await step(5);
      const fits = Math.abs(w / h - RAT[layout][0] / RAT[layout][1]) < 0.01, o = await overlay();
      ok(o.on === !fits, `${nm} in ${layout}: the crop frame is ${o.on ? "shown" : "hidden"} over the view`);
      if (nm === "9x16" && layout === "16:9") { await shot("crop.png"); tall = file; }
      await checkCut(file, w, h, layout, nm);
    }
    await fg.locator('#layout [data-layout="16:9"]').click();
  }

  // the 9:16 source again: drag the frame down, scrub and step, capture twice; the framing holds
  await loadVideo(tall);
  const fb = await fg.locator("#cropFrame").boundingBox(), c0 = (await S()).crop;
  await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2); await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(fb.x + fb.width / 2, fb.y + fb.height / 2 + k * 20);
  await page.mouse.up();
  const c1 = (await S()).crop, o1 = await overlay();
  ok(c1.cy > c0.cy + 0.05 && c1.w === c0.w && c1.h === c0.h, `dragging the frame reframes it (centre ${c0.cy.toFixed(3)} → ${c1.cy.toFixed(3)}, same size)`);
  const tb = await fg.locator("#timeline").boundingBox();
  await page.mouse.move(tb.x + tb.width * 0.2, tb.y + tb.height / 2); await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(tb.x + tb.width * (0.2 + k * 0.07), tb.y + tb.height / 2);
  await page.mouse.up();
  await until(async () => await fg.locator("#frameBadge").getAttribute("data-state") === "exact", 5000, 20);
  await ff().evaluate(() => document.querySelector("#timeline").focus()); await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft");
  await painted(page);
  const c2 = (await S()).crop, o2 = await overlay();
  ok(JSON.stringify(c2) === JSON.stringify(c1) && o2.top === o1.top && o2.on, "the framing and the frame over the view stay after scrubbing and stepping");
  const k1 = await checkCut(tall, 360, 640, "16:9", "after the drag");
  await step(3);
  const k2 = await checkCut(tall, 360, 640, "16:9", "the next capture");
  ok(k1.y === k2.y && k1.y > Math.round(0.5 * 640 - k1.H / 2), `both captures keep the framing (top ${k1.y}, ${k2.y})`);
  // a 1:1 capture is a square picture, and "Send to…" sends it as it is
  await fg.locator('#layout [data-layout="1:1"]').click();
  await until(async () => (await S()).layout === "1:1", 3000, 20);
  const sq = await capImage(), [sw, sh] = pngSize(sq);
  ok(sw === 360 && sh === 360, `a 1:1 capture is 360×360 (${sw}×${sh})`);
  await app.sendTo(fg, fg.locator("#results .fg-res").first().locator('[data-act="send"]'), "grade");
  await until(() => active("grade"), 15000);
  ok(await until(async () => /frame \d+( \(\d\))?\.png/.test(await app.grade.locator("#imgName").textContent()), 15000), "\"Send to…\" Grade with the 1:1 capture: " + await app.grade.locator("#imgName").textContent());
  await app.tab("framegrab");

  // 7. the performance overlay: off by default, the gauge shows it over the view with the decoding path of each video
  const pv = () => ff().evaluate(() => { const o = document.querySelector("#perfOv"); return { on: !o.hidden && o.offsetWidth > 0, text: o.textContent }; });
  await loadVideo(WEBM);
  ok(!(await pv()).on && (await fg.locator("#perfBtn").getAttribute("aria-pressed")) === "false", "the performance overlay starts off");
  await fg.locator("#perfBtn").click();
  // show(n) resolves once frame n is on screen; bounded here so a stuck viewer fails instead of hanging the test
  const showIn = n => ff().evaluate(n => Promise.race([window.__halApp.show(n).then(() => true), new Promise(r => setTimeout(() => r(false), 10000))]), n);
  let moved7 = true;
  for (const k of [20, 60, 100]) moved7 = await showIn(k) && moved7;
  ok(moved7, "jumps to frames 21, 61 and 101 each land");
  await step(3);
  ok((await S()).n === 103, `arrow keys step after all of the above (frame ${(await S()).n}, want 103)`);
  await until(async () => (await S()).perf.samples > 0 && /exact frame \d+ ms/.test((await pv()).text), 5000, 50);
  let ps = await S(), o7 = await pv();
  ok(o7.on && ["gpu", "cpu"].includes(ps.decoder) && o7.text.includes("WebCodecs") && ps.perf.samples > 0 && ps.perf.cacheMB > 0 && /cache \d+ \/ 400 MB/.test(o7.text),
    `on (${o7.on}): WebM through the page (${ps.decoder}), exact frame ${ps.perf.exact} ms over ${ps.perf.samples} moves, cache ${ps.perf.cacheMB} MB: “${o7.text.replace(/\n/g, " | ")}”`);
  await shot("perf-overlay.png");
  // the next video opened while this one still decodes a far frame: the viewer follows the new one
  await ff().evaluate(() => { window.__halApp.show(137); });
  await loadVideo(MP4);
  ok(await showIn(40) && (await S()).n === 40, "a video opened while the previous one was decoding: its frames come");
  await until(async () => /FFmpeg/.test((await pv()).text), 5000, 50);
  ps = await S(); o7 = await pv();
  ok(o7.on && ps.decoder === "ffmpeg" && /FFmpeg/.test(o7.text), `MP4 here (H.264, which headless Chromium cannot decode): FFmpeg, and the overlay says so (“${o7.text.split("\n")[1]}”)`);
  await fg.locator("#perfBtn").click();
  await until(async () => !(await pv()).on, 3000, 20);
  ok(!(await pv()).on, "the gauge hides it again");

  // 8. with the animations on: adding and removing, exporting twice, another video (the lists animate keyed items)
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await loadVideo(WEBM);
  for (const k of [5, 15, 30]) { await home(); await step(k); await page.keyboard.press("m"); }
  await fg.locator('#queue [data-rm="15"]').click();
  await until(async () => await Q() === "5,30", 3000, 20); await sleep(500);
  ok(await Q() === "5,30" && await fg.locator("#queue .fg-q:not([data-ghost])").count() === 2, `animated: a frame removed from the queue goes (${await Q()})`);
  await dest("image");
  const have8 = list(FRAMES);
  for (let i = 1; i <= 2; i++) {
    await until(async () => !(await fg.locator("#captureBtn").isDisabled()), 5000, 20);
    await fg.locator("#captureBtn").click();
    await until(() => newIn(FRAMES, have8).length === 2 * i, 15000);
  }
  ok(newIn(FRAMES, have8).length === 4 && !/Could not/.test(await fg.locator("#status").textContent()), `animated: exported twice, no error (${newIn(FRAMES, have8).length} files)`);
  const sawLoading = ff().evaluate(() => new Promise(r => { const el = document.querySelector("#loading"), t = setTimeout(() => r(false), 15000); new MutationObserver((m, o) => { if (!el.hidden) { clearTimeout(t); o.disconnect(); r(true); } }).observe(el, { attributes: true }); }));
  await loadVideo(MP4);
  ok(await sawLoading && (await S()).frames === 90 && !(await S()).queue.length && await until(async () => (await S()).loading === false, 5000, 20), "animated: another video opens, with its loading screen, the queue emptied");
  await page.emulateMedia({ reducedMotion: "reduce" });

  // 9. sound, the sharpest frame nearby, the other layouts
  const SOUND = path.join(FX.TMP, "with sound.webm");
  execSync(`ffmpeg -v error -f lavfi -i testsrc2=size=640x360:rate=24:duration=4 -f lavfi -i "sine=f=440:d=4" -c:v libvpx-vp9 -b:v 800k -c:a libopus -shortest -y "${SOUND}"`);
  await loadVideo(SOUND);
  await until(async () => (await S()).sound.has, 10000, 50);
  ok((await S()).sound.has && !(await fg.locator("#muteBtn").isDisabled()), "a video with sound: the transport's sound is on");
  await fg.locator("#playBtn").click();
  ok(await until(async () => (await S()).sound.playing && (await S()).n > 10, 10000, 50), `it plays with its sound (frame ${(await S()).n})`);
  await shot("sound.png");
  await fg.locator("#playBtn").click();
  ok(await until(async () => !(await S()).playing && !(await S()).sound.playing, 3000, 20), "pause stops the sound");
  await fg.locator("#muteBtn").click();
  ok(await until(async () => (await S()).sound.muted && JSON.parse(fs.readFileSync(path.join(host.base, "Settings", "app.json"), "utf8")).framegrab.muted === true, 3000, 50), "mute, kept in Settings");
  await fg.locator("#muteBtn").click();
  // another tab while it plays: playback and its sound stop, the decoded frames go; back, the frame is there
  await fg.locator("#playBtn").click();
  await until(async () => (await S()).sound.playing, 5000, 20);
  await app.tab("grade");
  const away = await S();
  ok(!away.playing && !away.sound.playing && away.held.decoded <= 2, `another tab: playback and sound stop, the decoded frames are freed (${away.held.decoded} left)`);
  await app.tab("framegrab");
  await step(1);
  ok((await S()).shown.exact, "back: the next frame decodes as before");
  await loadVideo(WEBM);
  ok(!(await S()).sound.has && await fg.locator("#muteBtn").isDisabled(), "a video without sound: the sound control is off");
  // the sharpest frame: a soft (blurred) shot where only frame 15 is sharp; from frame 9, S finds it
  const SOFT = path.join(FX.TMP, "soft.webm");
  execSync(`ffmpeg -v error -f lavfi -i testsrc2=size=640x360:rate=24:duration=2 -vf "gblur=sigma=5:enable='not(eq(n\,14))'" -c:v libvpx-vp9 -crf 18 -b:v 0 -y "${SOFT}"`);
  await loadVideo(SOFT);
  await step(9);
  await page.keyboard.press("s");
  ok(await until(async () => (await S()).n === 14 && (await S()).shown.exact, 15000, 50), `S: the sharpest frame nearby is frame 15 (frame ${(await S()).n + 1}): ${await fg.locator("#status").textContent()}`);
  await fg.locator("#sharpBtn").click();
  ok(await until(async () => /already the sharpest/.test(await fg.locator("#status").textContent()), 15000, 50) && (await S()).n === 14, "again on it: it says it is already the sharpest");
  // the other layouts on a 16:9 source
  RAT["9:16"] = [9, 16]; RAT["4:5"] = [4, 5];
  const wide = path.join(FX.TMP, "shape-16x9.webm");
  await loadVideo(wide);
  for (const layout of ["9:16", "4:5"]) {
    await fg.locator(`#layout [data-layout="${layout}"]`).click();
    await until(async () => (await S()).layout === layout, 3000, 20);
    await step(4);
    ok((await overlay()).on, `16x9 in ${layout}: the crop frame is shown`);
    if (layout === "9:16") await shot("layout-9x16.png");
    await checkCut(wide, 640, 360, layout, "16x9");
  }
  await fg.locator('#layout [data-layout="orig"]').click();
  await until(async () => (await S()).layout === "orig", 3000, 20);
  const whole = await capImage(), [ow, oh] = pngSize(whole);
  ok(!(await overlay()).on && ow === 640 && oh === 360, `Original: no crop frame, the whole frame (${ow}×${oh})`);
  await fg.locator('#layout [data-layout="16:9"]').click();

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall green");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
