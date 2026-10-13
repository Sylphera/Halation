// Measures the layer export at 1920×1080 30 fps: time, size of every file and the dialog's estimate.
// Not part of npm test (slow). Usage: node app/tests/measure-layers.js [seconds=10]
// In this headless test setup frames travel as base64 through Playwright and the canvas has no GPU,
// so times are an upper bound; see docs/ARCHITECTURE.md → Export for how to read them.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { sleep, until, serve, launch, openApp } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

const SECS = +(process.argv[2] || 10);
const FX = makeFixtures(), TOOLS = toolOptions(FX);
const ffmpeg = execSync("command -v ffmpeg").toString().trim();
execSync(`ffmpeg -v error -y -f lavfi -i "aevalsrc='0.9*sin(2*PI*55*t)*exp(-8*mod(t,0.4286))+0.1*sin(2*PI*880*t)':s=48000:d=${SECS}" -ac 2 "${FX.FIX}/long.wav"`);
const host = createHost(FX.TMP, { tools: { ...TOOLS.tools, systemFfmpeg: ffmpeg } });

(async () => {
  const server = serve(), browser = await launch();
  const app = await openApp(browser, server, host);
  const { vis, tab, appReady } = app, V = () => app.vFrame();
  await tab("visualizer"); await appReady("visualizer");
  await app.cover(path.join(FX.FIX, "sky.png"));
  await vis.locator("#audIn").setInputFiles(path.join(FX.FIX, "long.wav"));
  await until(async () => /long\.wav/.test(await vis.locator("#audName").textContent()), 20000);
  await V().evaluate(() => {
    const set = (id, v) => { const el = document.getElementById("f-" + id); if (el.type === "checkbox") { if (el.checked !== v) el.click(); } else { el.value = v; el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input")); } };
    set("format", "1920x1080"); set("fps", "30"); set("textOn", true); set("logoOn", true); set("glow", 30);
    const el = document.getElementById("f-title"); el.value = "Measure"; el.dispatchEvent(new Event("input"));
  });
  await sleep(600);
  const out = [];
  for (const [format, finish] of [["prores4444", "overlay"], ["webm", "baked"], ["prores4444", "baked"]]) {
    await vis.locator("#exportBtn").click(); await until(() => vis.locator("#xDialog").isVisible());
    await vis.locator('#xMode [data-mode="layers"]').click();
    await vis.locator(`input[name="xFinish"][value="${finish}"]`).check();
    for (const id of ["#xWbg", "#xWcover", "#xWtext", "#xAudio"]) await vis.locator(id).check();
    if (finish === "overlay") await vis.locator("#xWfinish").check();
    await vis.locator("#xFormat").selectOption(format);
    await sleep(300);
    const est = await vis.locator("#xFiles .xfile").allTextContents();
    const before = host.encStats.ipc, t0 = Date.now();
    await vis.locator("#xGo").click();
    await until(async () => /files saved/.test(await vis.locator("#status").textContent()), 3600000, 1000);
    const secs = (Date.now() - t0) / 1000, res = await V().evaluate(() => window.__halLastLayers);
    const files = Object.fromEntries(fs.readdirSync(res.dir).map(f => [f, fs.statSync(path.join(res.dir, f)).size]));
    out.push({ format, finish, seconds: secs, perFrame: secs / (SECS * 30), ipcMB: (host.encStats.ipc - before) / 1e6, files, estimate: est });
    console.log(JSON.stringify(out[out.length - 1]));
  }
  // single video for comparison
  await vis.locator("#exportBtn").click(); await until(() => vis.locator("#xDialog").isVisible());
  await vis.locator('#xMode [data-mode="single"]').click();
  const t1 = Date.now(); await vis.locator("#xGo").click();
  await until(async () => /Saved|saved/.test(await vis.locator("#status").textContent()) && !/files/.test(await vis.locator("#status").textContent()), 3600000, 1000);
  console.log(JSON.stringify({ single: (Date.now() - t1) / 1000, status: await vis.locator("#status").textContent() }));
  fs.writeFileSync(path.join(process.env.SHOTS || "/tmp", "measure-layers.json"), JSON.stringify(out, null, 2));
  await browser.close(); server.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
