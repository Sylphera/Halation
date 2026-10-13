// How fast a tool comes back: from the dock click to the tool shown and usable, for a tool still loaded, one unloaded
// on its frame). Usage: node app/tests/measure-return.js   (headless Chromium: relative figures)
const fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const { sleep, until, serve, openApp, LAUNCH, chromium } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

const FX = makeFixtures(), TOOLS = toolOptions(FX);
const host = createHost(fs.mkdtempSync(path.join(FX.TMP, "ret-")), { ...TOOLS, tools: { ...TOOLS.tools, systemFfmpeg: execSync("command -v ffmpeg").toString().trim() } });
fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en" } }));
const CLIP = path.join(FX.TMP, "ret 720p.webm");
execSync(`ffmpeg -v error -f lavfi -i testsrc2=size=1280x720:rate=30:d=6 -f lavfi -i "sine=f=330:d=6" -c:v libvpx-vp9 -deadline realtime -c:a libopus -shortest -y "${CLIP}"`);
const UNLOAD = +(process.env.UNLOAD || 4000);

(async () => {
  const server = serve(), browser = await chromium.launch(LAUNCH), r = {};
  // still loaded: nothing rests or unloads; after time away: rest and unload after UNLOAD ms (in the app: 30 s, 5 min)
  for (const away of [false, true]) {
  const app = await openApp(browser, server, host, { width: 1480, height: 920, restMs: away ? UNLOAD : 1e9, unloadMs: away ? UNLOAD : 1e9 });
  const { page } = app, frame = n => page.frames().find(f => new RegExp(n + "\\.html").test(f.url()));
  // Timed in the page: from the dock click to the tool shown and painted (two frames), its app ready and done (an
  // expression in the tool's window) true, checked every frame. hover: the pointer rests on the dock icon a moment
  // before the click (as a hand does; shell.js preload)
  async function back(tab, done = "true", hover = 0) {
    if (hover) { await page.hover(`.rail .tab[data-tab="${tab}"]`); await sleep(hover); }
    return page.evaluate(async ([tab, done]) => {
      const frame = () => requestAnimationFrame ? new Promise(r => requestAnimationFrame(r)) : null;
      const t0 = performance.now(), f = document.querySelector("#v-" + tab);
      document.querySelector(`.rail .tab[data-tab="${tab}"]`).click();
      await frame(); await frame();
      for (;;) {
        const w = f.contentWindow, a = w && w.__halApp;
        let ok = false;
        if (a && !f.classList.contains("pending") && w.document.readyState === "complete") {
          const r = await Promise.race([Promise.resolve(a.ready).then(() => true), new Promise(r => setTimeout(() => r(false), 0))]);
          if (r) ok = !!w.eval(done);
        }
        if (ok) return Math.round(performance.now() - t0);
        if (performance.now() - t0 > 30000) return -1;
        await frame();
      }
    }, [tab, done]);
  }
  for (const t of ["upscale",  "framegrab"]) { await app.tab(t); await app.appReady(t); }
  await page.frameLocator("#v-framegrab").locator("#videoIn").setInputFiles(CLIP);
  // on screen: the view shows frame 40 (the picture kept); usable: its decoder open again and the frame exact
  const fgSeen = "(s => s.frames > 0 && s.n === 40)(window.__halApp.state())";
  const fgOn = "(s => s.frames > 0 && s.n === 40 && !s.resting && s.shown && s.shown.exact)(window.__halApp.state())";
  await until(async () => (await frame("framegrab").evaluate(() => window.__halApp.state())).frames > 0, 30000);
  await frame("framegrab").evaluate(() => window.__halApp.show(40)); await sleep(1500);
  await app.tab("home"); await sleep(300);
  const src = t => page.evaluate(t => document.querySelector("#v-" + t).getAttribute("src"), t);
  if (!away) {
    r["Image Upscale, loaded"] = await back("upscale");
    r["Frame Capture with its video, loaded: on screen"] = await back("framegrab", fgSeen);
    await app.tab("home"); await sleep(300);
    r["Frame Capture with its video, loaded: usable"] = await back("framegrab", fgOn);
  } else {
    await sleep(UNLOAD + 6000);
    console.log("after time away:", { upscale: await src("upscale"), framegrab: await src("framegrab") });
    r["Image Upscale, unloaded"] = await back("upscale");
    r["Frame Capture with its video, rested: on screen"] = await back("framegrab", fgSeen);
    await app.tab("home"); await sleep(UNLOAD + 6000);
    r["Frame Capture with its video, rested: usable"] = await back("framegrab", fgOn);
    await app.tab("home"); await sleep(UNLOAD + 6000);
    r["Image Upscale, unloaded, pointer on its icon 300 ms"] = await back("upscale", "true", 300);
  }
  await page.close();
  }
  for (const [k, v] of Object.entries(r)) console.log(k.padEnd(48), String(v).padStart(6), "ms");
  await browser.close(); server.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
