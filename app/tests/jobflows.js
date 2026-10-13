// Real tool actions held behind the scheduler: snapshots belong to the click, not the later start.
// Usage: node app/tests/jobflows.js
const fs = require("fs"), os = require("os"), path = require("path");
const { execFileSync, execSync } = require("child_process");
const { until, serve, launch, openApp } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");
let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const probe = file => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name,width,height", "-of", "json", file]).toString()).streams[0];
(async () => {
  const FX = makeFixtures(), TOOLS = toolOptions(FX), server = serve(), browser = await launch();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "halation-jobflows-"));
  const host = createHost(root, { tools: { ...TOOLS.tools, systemFfmpeg: execSync("command -v ffmpeg").toString().trim() } });
  const app = await openApp(browser, server, host), { page, grade, tab, appReady } = app;
  const hold = async lane => {
    await page.evaluate(lane => {
      let release; const gate = new Promise(r => { release = r; });
      window.__releaseLane = release;
      window.__laneBlocker = window.__shell.jobs.submit({ tool: "test", kind: "block", lane, cost: 2, run: () => gate });
    }, lane);
    await until(() => page.evaluate(() => window.__laneBlocker.state === "running"), 5000);
  };
  const release = () => page.evaluate(async () => { window.__releaseLane(); await window.__laneBlocker.done; });

  await tab("grade"); await appReady("grade");
  await grade.locator("#imgIn").setInputFiles(path.join(FX.FIX, "small.png"));
  await until(() => grade.locator("#exportBtn").isEnabled(), 5000);
  await grade.locator("#outSize").selectOption("orig");
  await hold("cpu");
  await grade.locator("#exportBtn").click();
  ok(await until(() => page.evaluate(() => window.__shell.jobs.list().some(j => j.tool === "grade" && j.kind === "export-image" && j.state === "queued")), 3000), "Grade's individual export waits in the CPU lane");
  ok(await grade.locator("#exportBtn").isEnabled(), "Grade can enqueue another export while the first waits");
  await grade.locator("#imgIn").setInputFiles(path.join(FX.FIX, "sky.png"));
  await until(() => grade.locator("#exportBtn").isEnabled(), 5000);
  await grade.locator("#exportBtn").click();
  await grade.locator("#outSize").selectOption("3000");
  await release();
  const small = path.join(host.base, "Exports", "Covers", "small.png"), sky = path.join(host.base, "Exports", "Covers", "sky.png");
  await until(() => fs.existsSync(small) && fs.existsSync(sky) && page.evaluate(() => !window.__shell.jobs.busy("grade")), 15000);
  const a = probe(small), b = probe(sky);
  ok(a.width === 96 && a.height === 96 && b.width === 700 && b.height === 500, `Queued Grade exports keep their source and size (${a.width}×${a.height}, ${b.width}×${b.height})`);

  await page.evaluate(async () => { await window.__hal.installTool("cutout"); });
  await page.evaluate(async bytes => {
    const blob = new Blob([new Uint8Array(bytes)], {type:"image/png"});
    window.__directCut = window.__hal.cutout(blob, { job: { tool: "library", title: "Library cutout" } });
  }, [...fs.readFileSync(path.join(FX.FIX, "sky.png"))]);
  await page.evaluate(() => window.__directCut);
  ok(await page.evaluate(() => window.__shell.jobs.list().some(j => j.tool === "library" && j.kind === "detect" && j.state === "done")), "Shared cutout forwards the owning Library job to the model scheduler");
  const detected = await page.evaluate(() => window.__shell.jobs.list().filter(j => j.tool === "library" && j.kind === "detect").length);
  await tab("library");
  await page.locator('#libNav [data-tab="exports"]').click();
  const smallCard = page.locator("#libPanel .libv-card", { hasText: "small" }).first();
  await smallCard.click({ button: "right" });
  await page.locator('.libv-menu [data-mi="cutout"]').click();
  ok(await until(() => page.evaluate(n => window.__shell.jobs.list().filter(j => j.tool === "library" && j.kind === "detect" && j.state === "done").length > n, detected), 15000), "Library's real Cut out menu action runs its model through Jobs");
  ok(await until(() => fs.existsSync(path.join(host.base, "Exports", "Covers", "small (cutout).png")), 10000), "The scheduled Library action saves its cutout beside the export");

  await tab("visualizer"); await appReady("visualizer");
  await app.cover(path.join(FX.FIX, "small.png"));
  await app.vis.locator("#audIn").setInputFiles(path.join(FX.FIX, "song one.wav"));
  await until(() => app.vis.locator("#exportBtn").isEnabled(), 10000);
  await app.vFrame().evaluate(() => {
    for (const [key, value] of [["format", "1280x720"], ["fps", "24"], ["clipLen", "0.2"]]) {
      const el = document.getElementById("f-" + key); el.value = value;
      el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input"));
    }
  });
  await hold("cpu");
  const exportSingle = async codec => {
    await app.vis.locator("#exportBtn").click();
    await app.vis.locator('#xMode [data-mode="single"]').click();
    if (await app.vis.locator("#xAdv").getAttribute("open") === null) await app.vis.locator("#xAdv > summary").click();
    await app.vis.locator("#xVcodec").selectOption(codec);
    await app.vis.locator("#xAcodec").selectOption("opus");
    await app.vis.locator("#xGo").click();
  };
  await exportSingle("vp9");
  await until(() => page.evaluate(() => window.__shell.jobs.list().some(j => j.tool === "visualizer" && j.state === "queued")), 5000);
  const canQueue = await app.vis.locator("#exportBtn").isEnabled();
  ok(canQueue, "Visualizer's Export stays available while an export waits for CPU");
  if (canQueue) { await app.vis.locator("#f-format").selectOption("1080x1080"); await exportSingle("h264"); }
  ok(await until(() => page.evaluate(() => window.__shell.jobs.list().filter(j => j.tool === "visualizer" && j.state === "queued").length === 2), 5000), "A second Visualizer export is queued without disturbing the first");
  await release();
  ok(await until(() => page.evaluate(() => window.__shell.jobs.list().filter(j => j.tool === "visualizer" && j.state === "running").length === 2), 5000, 20), "Balanced admits both Visualizer exports together, as specified, with independent renderers");
  await until(() => page.evaluate(() => !window.__shell.jobs.busy("visualizer")), 30000);
  ok(await page.evaluate(() => window.__shell.jobs.list().filter(j => j.tool === "visualizer" && j.state === "done").length) === 2, "Both queued Visualizer exports finish through their own jobs");
  const outputs = await page.evaluate(() => window.__shell.jobs.list().filter(j => j.tool === "visualizer" && j.state === "done").map(j => j.outputs[0] && j.outputs[0].path));
  ok(outputs.length === 2 && outputs.every(Boolean) && probe(outputs[0]).codec_name === "vp9" && probe(outputs[1]).codec_name === "h264", "Changing the second export's codec leaves the first queued snapshot as VP9");
  if (outputs.length === 2 && outputs.every(Boolean)) {
    const first = probe(outputs[0]), second = probe(outputs[1]);
    ok(first.width === 1280 && first.height === 720 && second.width === 1080 && second.height === 1080, "Concurrent exports preserve independent frame sizes and canvases");
  }
  await app.vFrame().evaluate(() => {
    const el = document.getElementById("xVcodec"); el.value = "vp9"; el.dispatchEvent(new Event("change"));
  });
  await app.vis.locator("#queueAudio").setInputFiles(path.join(FX.FIX, "song one.wav"));
  await hold("cpu");
  await app.vis.locator("#queueRun").click();
  ok(await until(() => page.evaluate(() => window.__shell.jobs.list().some(j => j.tool === "visualizer" && j.group && j.state === "queued")), 5000), "Visualizer's batch waits inside the CPU scheduler");
  await app.vFrame().evaluate(() => {
    const el = document.getElementById("xVcodec"); el.value = "h264"; el.dispatchEvent(new Event("change"));
  });
  await release();
  await until(() => page.evaluate(() => !window.__shell.jobs.busy("visualizer")), 30000);
  const batch = await page.evaluate(() => window.__shell.jobs.list().find(j => j.tool === "visualizer" && j.group));
  ok(batch && batch.state === "done" && batch.outputs[0] && probe(batch.outputs[0].path).codec_name === "vp9", "A queued Visualizer batch keeps the codec chosen at Run after the export dialog's selection changes");
  ok(!app.errors.length, "No page errors" + (app.errors.length ? ": " + app.errors.join(" | ") : ""));
  await browser.close(); server.close(); fs.rmSync(root, { recursive: true, force: true });
  console.log(failures ? `\n${failures} failed` : "\nAll passed"); process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
