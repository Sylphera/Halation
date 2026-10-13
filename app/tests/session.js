// Sessions, closing and tools left behind (state.rs sessions, window.rs closing and memory, shell.js closing,
// common.js setAway), used as a user would:
// 1. After a clean close the tools start empty (the work open in Grade, the Visualizer and the Intro is dropped; their
//    explicit looks and presets stay); old mixed tool payloads never restore automatically.
// 2. Closing with nothing working closes at once; with a tool working (an interpolation) it asks, Cancel keeps the
//    app open, "Close anyway" closes; a clean close marks the session closed.
// 3. A song playing in the Visualizer: another tab fades it out and stops it, its preview stops drawing and the page is
//    marked away; back, it is shown and plays again from where it stopped.
// 4. Minimized with nothing working the webview is asked to use less memory, normal again when it comes back.
// 5. Tools left behind with nothing open are unloaded after a while (and at once when minimized), the memory given
//    back; one with a video open stays and lets the video go until it is shown again; opened again, an unloaded tool loads as the first time.
// Screenshots → $SHOTS/session. Usage: node app/tests/session.js
const fs = require("fs"), os = require("os"), path = require("path"), { execSync } = require("child_process");
const { until, sleep, painted, serve, launch, openApp, locale } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

const functional = process.argv.includes("--functional");
let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "session");
fs.mkdirSync(SHOTS, { recursive: true });
const FX = makeFixtures(), TOOLS = toolOptions(FX), { L } = locale("en");
// FFmpeg from the system: Frame Capture opens a video with it when the page cannot decode it
const host = createHost(fs.mkdtempSync(path.join(FX.TMP, "session-")), { ...TOOLS, tools: { ...TOOLS.tools, systemFfmpeg: execSync(process.platform === "win32" ? "where ffmpeg" : "command -v ffmpeg").toString().trim().split(/\r?\n/)[0] } });
const APP = path.join(host.base, "Settings", "app.json");
const readApp = () => JSON.parse(fs.readFileSync(APP, "utf8"));
const WORK = {
  settings: { language: "en" },
  grade: { current: { layers: [{ id: "a", type: "adjust", on: true, p: { exposure: 0.5 } }] }, previewPct: 50, looks: {} },
  visualizer: { current: { title: "Left open" }, presets: {} },
  intro: { project: { elements: [] }, sel: "e1", quality: "high" }
};
const SONG = path.join(FX.TMP, "song.wav");
execSync(`ffmpeg -v error -f lavfi -i "sine=f=330:d=20" -y "${SONG}"`);
const CLIP = path.join(FX.TMP, "clip.webm");
execSync(`ffmpeg -v error -f lavfi -i testsrc2=size=320x180:rate=24:d=2 -c:v libvpx-vp9 -deadline realtime -y "${CLIP}"`);

(async () => {
  const server = serve(), browser = await launch();

  // 1. a clean close before: the tools start empty
  fs.writeFileSync(APP, JSON.stringify({ ...WORK, session: { open: false } }));
  ok(host.begin() === false, "The last run closed cleanly");
  let m = readApp();
  ok(!m.grade.current && m.grade.previewPct == null && !m.visualizer.current && !m.intro && m.session.open === true && m.grade.looks && m.visualizer.presets,
    "Temporary work and presentation reset; explicit looks/presets stay and the session is open");
  let app = await openApp(browser, server, host, { width: 1480, height: 920 });
  await sleep(600);
  ok(await app.page.locator("#toast").isHidden(), "Nothing to say at start");
  await app.page.close();

  // An old open marker without a valid recovery file does not restore mixed preferences.
  fs.writeFileSync(APP, JSON.stringify({ ...WORK, session: { open: true } }));
  ok(host.begin() === false, "An old open marker alone is not a recovery candidate");
  m = readApp();
  ok(!m.grade.current && !m.visualizer.current && !m.intro, "Old temporary payloads are not automatically restored");
  app = await openApp(browser, server, host, { width: 1480, height: 920 });
  let page = app.page; const errors = app.errors;
  ok(await page.locator("#modal").isHidden() && await page.locator("#toast").isHidden(), "No recovery prompt without a valid snapshot");
  if (!functional) await page.screenshot({ path: path.join(SHOTS, "1-recovered.png") });

  // 2. closing
  // not awaited: the page answers the request while it asks (as Tauri, which does not wait for listeners)
  const closeReq = () => { host.emit("close-requested", null); return sleep(50); };
  const acks = () => host.log.filter(([c]) => c === "close_ack").length;
  await closeReq();
  ok(await until(() => host.session.quit === 1, 5000), "Nothing working: the close request closes at once");
  ok(acks() >= 1 && readApp().session.open === false, "…the request is answered and the session is marked closed");
  await page.close(); host.begin(); app = await openApp(browser, server, host); page = app.page;
  // a job running in AI Interpolate
  await app.tab("interp"); await app.appReady("interp");
  const ip = () => page.frames().find(f => /interp\.html/.test(f.url()));
  await page.evaluate(() => {
    let unwind; const cleanup = new Promise(r => { unwind = r; }); window.__finishCloseCleanup = unwind;
    window.__closeJob = window.__shell.jobs.submit({ tool: "interp", kind: "close-test", lane: "cpu", run: async ctx => {
      window.__closeJobRunning = true;
      try { await new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true })); }
      finally { window.__closeJobCleaning = true; await cleanup; }
    } });
  });
  await until(() => page.evaluate(() => window.__closeJobRunning), 5000);
  await closeReq();
  ok(await until(() => page.evaluate(() => document.querySelector("#modal").open), 5000), "A tool working: the app asks first");
  const text = await page.locator("#mText").textContent();
  ok((await page.locator("#mTitle").textContent()) === L("session.closeTitle") && text.includes(L("tab.interp")) && (await page.locator("#mAlt").textContent()) === L("session.exit") && text.includes("cancel"), `…naming it and warning about cancellation: “${text}”`);
  await painted(page);
  if (!functional) await page.screenshot({ path: path.join(SHOTS, "2-close-ask.png") });
  await page.click("#mCancel");
  await sleep(400);
  ok(host.session.quit === 0 && readApp().session.open === true, "Cancel: the app stays open");
  await closeReq();
  await until(() => page.evaluate(() => document.querySelector("#modal").open), 5000);
  await page.click("#mAlt");
  await until(() => page.evaluate(() => window.__closeJobCleaning), 5000);
  ok(host.session.quit === 0 && readApp().session.open === true, "Close anyway waits for the cancelled job's cleanup before quitting");
  await page.evaluate(() => window.__finishCloseCleanup());
  ok(await until(() => host.session.quit === 1, 5000) && readApp().session.open === false, "Close anyway: it closes, the session marked closed");
  await page.close(); host.begin(); app = await openApp(browser, server, host); page = app.page;

  // 3. a song playing in the Visualizer, then another tab
  await app.tab("visualizer"); await app.appReady("visualizer");
  const vis = () => page.frames().find(f => /visualizer\.html/.test(f.url()));
  // the song's audio element, to hear where it is (the seek bar only moves with a cover drawn)
  await vis().evaluate(() => { const p = HTMLMediaElement.prototype.play; HTMLMediaElement.prototype.play = function () { window.__au = this; return p.call(this); }; });
  await app.vis.locator("#audIn").setInputFiles(SONG);
  await until(() => vis().evaluate(() => !!document.querySelector("#seek") && +document.querySelector("#seek").max > 0), 15000);
  await app.vis.locator("#play").click();
  const vstate = () => vis().evaluate(() => { return { away: document.documentElement.hasAttribute("data-away"), icon: document.querySelector("#play").getAttribute("aria-label") === "Pause" ? "pause" : "play", seek: window.__au ? window.__au.currentTime : 0, paused: !window.__au || window.__au.paused }; });
  ok(await until(async () => (await vstate()).icon === "pause", 8000), "The song plays");
  await sleep(700);
  await app.tab("grade");
  ok(await until(async () => { const s = await vstate(); return s.away && s.icon === "play" && s.paused; }, 3000), "Another tab: the Visualizer is away and its song stops");
  const at = (await vstate()).seek;
  await sleep(600);
  ok((await vstate()).seek === at, "…and it stays where it was (nothing plays or draws)");
  await app.tab("visualizer");
  ok(!(await vstate()).away, "Back: it is shown again");
  await app.vis.locator("#play").click();
  ok(await until(async () => (await vstate()).seek > at, 8000), `…and plays on from where it stopped (${at.toFixed(2)} s)`);
  await app.vis.locator("#play").click();

  // 4. minimized
  const hide = on => page.evaluate(on => { Object.defineProperty(document, "hidden", { configurable: true, get: () => on }); document.dispatchEvent(new Event("visibilitychange")); }, on);
  await hide(true);
  ok(await until(() => host.session.memoryLow.at(-1) === true, 3000), "Minimized, nothing working: the webview uses less memory");
  await hide(false);
  ok(await until(() => host.session.memoryLow.at(-1) === false, 3000), "…normal again when it comes back");

  // 5. tools left behind: nothing open → unloaded after a while (WebView2 then gives the memory back); work open → kept
  await host.call("app_quit"); await page.close(); host.begin(); // clean fresh window for the unloading scenarios
  const app2 = await openApp(browser, server, host, { width: 1480, height: 920, restMs: 8000, unloadMs: 8000 });
  const p2 = app2.page, src = id => p2.evaluate(id => document.querySelector("#v-" + id).getAttribute("src"), id);
  await app2.tab("upscale"); await app2.appReady("upscale");
  await app2.tab("framegrab"); await app2.appReady("framegrab");
  await p2.frameLocator("#v-framegrab").locator("#videoIn").setInputFiles(CLIP);
  const fgf = () => p2.frames().find(f => /framegrab\.html/.test(f.url()));
  ok(await until(async () => { const st = await fgf().evaluate(() => window.__halApp.state()); return st.settled && st.frames > 0; }, 30000), "A video open in Frame Capture");
  await fgf().evaluate(() => window.__halApp.show(20));
  await app2.tab("interp"); await app2.appReady("interp");
  const lows = host.session.memoryLow.length;
  await app2.tab("home");
  ok(!!(await src("interp")), "Just left: AI Interpolate is still loaded");
  // Advance wall time together, then run one trim: real 5 s ticks may otherwise split the tools into two passes.
  await p2.clock.setSystemTime(new Date(Date.now() + 8100));
  await p2.evaluate(() => window.__shell.unloadIdle());
  ok(await until(async () => !(await src("upscale")) && !(await src("interp")), 12000), "8 s later: Image Upscale and AI Interpolate, with nothing open, are unloaded");
  const kept = await src("framegrab"), fst = fgf() && await fgf().evaluate(() => window.__halApp.state());
  ok(!!kept && fst && fst.resting && fst.frames === 48 && fst.n === 20, "…Frame Capture, with its video open, stays loaded and lets go of what weighs (decoder, decoded frames, sound): " + kept + " " + JSON.stringify(fst && { resting: fst.resting, n: fst.n }));
  const t0 = Date.now();
  await app2.tab("framegrab");
  ok(await until(async () => { const st = await fgf().evaluate(() => window.__halApp.state()); return !st.resting && st.n === 20 && st.shown.exact; }, 20000), `…shown again, it is on the same frame (20) at once, its decoder open again (${Date.now() - t0} ms)`);
  ok(await until(() => host.session.memoryLow.slice(lows).join() === "true,false", 5000), "…and WebView2 is asked to give the memory back, then back to normal: " + host.session.memoryLow.slice(lows).join());
  await app2.tab("upscale");
  ok(await until(async () => (await src("upscale")) === "upscale.html" && await p2.frameLocator("#v-upscale").locator("#browseBtn").isVisible(), 15000), "Opened again: it loads as the first time");
  await app2.tab("home");
  await p2.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")); });
  ok(await until(async () => !(await src("upscale")), 6000), "Minimized (for more than a moment): the tools with nothing open are unloaded");
  ok(!app2.errors.length, "No page errors (unloading)" + (app2.errors.length ? ": " + app2.errors.join(" | ") : ""));

  ok(!errors.length, "No page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall OK");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
