// Crop and Cutout in the tools that make files (docs/ARCHITECTURE.md → Shared services), over the mocked backend:
// Upscale (crop before upscaling, Upscale → Cutout in one step, a queue of 5 cut-outs), Downloader (Cutout of a
// downloaded cover), Library (Add cutout version, Crop copy, a batch from picked images) and the drop menu.
// Usage: node app/tests/cutout-tools.js   Screenshots go to $SHOTS/cutout.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { until, painted, serve, launch, openApp, locale } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "cutout");
fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const { L } = locale("en");

const FX = makeFixtures(), TOOLS = toolOptions(FX), fx = n => path.join(FX.FIX, n);
const host = createHost(FX.TMP, TOOLS);
const P = (...p) => path.join(host.base, ...p);
const list = (...d) => fs.existsSync(P(...d)) ? fs.readdirSync(P(...d)) : [];
fs.writeFileSync(P("Settings", "app.json"), JSON.stringify({ settings: { language: "en" } }));
const dialogOpen = (page, id) => until(() => page.evaluate(id => document.querySelector(id).open, id), 10000);
// alpha of a saved PNG at (u, v), read in the page
const alphaAt = (page, file, pts) => page.evaluate(async ({ b, pts }) => {
  const IMG = window.__img, i = await IMG.load(new Blob([Uint8Array.from(atob(b), c => c.charCodeAt(0))], { type: "image/png" }));
  const c = IMG.mk(i.naturalWidth, i.naturalHeight), x = c.getContext("2d"); x.drawImage(i, 0, 0);
  return { w: c.width, h: c.height, a: pts.map(([u, v]) => x.getImageData(Math.floor(u * c.width), Math.floor(v * c.height), 1, 1).data[3]) };
}, { b: fs.readFileSync(file).toString("base64"), pts });

(async () => {
  const server = serve(), browser = await launch();
  const app = await openApp(browser, server, host, { width: 1480, height: 950 });
  const { page, errors, tab, appReady } = app;
  const shot = n => page.screenshot({ path: path.join(SHOTS, n + ".png") });
  // the component first, as Settings → Modules would
  await page.evaluate(() => window.__shell.installTool("cutout"));

  /* ---------- Upscale: crop first, then Upscale → Cutout ---------- */
  const up = page.frameLocator("#v-upscale"), upStatus = () => up.locator("#status").textContent();
  await tab("upscale"); await appReady("upscale");
  await up.locator("#installBtn").click();
  await until(async () => (await up.locator("#engineBadge").textContent()) === L("up.ready"), 30000);
  await up.locator("#imgIn").setInputFiles(fx("subject.png"));
  await until(async () => (await up.locator("#inSize").textContent()) === "800×600");
  await up.locator("#cropBtn").click(); await dialogOpen(page, "#cropDlg");
  await page.click('#cropRatios [data-ratio="1:1"]'); await painted(page); await page.click("#cropApply");
  ok(await until(async () => (await up.locator("#inSize").textContent()) === "600×600") && await up.locator("#uncropBtn").isVisible(), "Upscale: crop before upscaling (600×600 of the 800×600 original)");
  await up.locator('input[name=model][value=fast]').check(); await up.locator('[data-scale="2"]').click();
  ok(await upStatus() === L("up.st.ready", { w: 1200, h: 1200 }), "The expected size follows the crop: " + await upStatus());
  await up.locator("#chainCut").check();
  await up.locator("#runBtn").click();
  ok(await until(async () => (await upStatus()) === L("up.st.cut", { name: "subject-x2 (cutout).png" }), 120000), "Upscale → Cutout in one step: " + await upStatus());
  const upx = list("Exports", "Upscaled"), cuts = () => list("Exports", "Cutouts");
  const cutUp = await alphaAt(page, P("Exports", "Cutouts", "subject-x2 (cutout).png"), [[0.02, 0.02], [0.3, 0.5]]);
  ok(upx.includes("subject-x2.png") && cutUp.w === 1200 && cutUp.a[0] < 10 && cutUp.a[1] > 240, `Upscaled to Exports\\Upscaled and cut out to Exports\\Cutouts at 1200×1200 (α ${cutUp.a.join(" / ")})`);
  ok(await up.locator("#cmp").evaluate(e => e.classList.contains("cut")) && await up.locator("#doneList .item").count() === 2, "The comparator shows the cut-out over a checkerboard; both results are in the finished list");
  await shot("upscale-chain");
  await up.locator("#uncropBtn").click();
  ok(await until(async () => (await up.locator("#inSize").textContent()) === "800×600"), "«Whole picture» drops the crop");
  await up.locator("#chainCut").uncheck();

  /* ---------- a batch of 5 cut-outs through the queue ---------- */
  const five = [];
  for (let i = 1; i <= 5; i++) { const f = path.join(FX.TMP, `batch ${i}.png`); fs.copyFileSync(fx("subject.png"), f); five.push(f); }
  await page.evaluate(async list => {
    const files = list.map(([name, b]) => new File([Uint8Array.from(atob(b), c => c.charCodeAt(0))], name, { type: "image/png" }));
    window.__batch = await window.__hal.cutoutBatch(files);
  }, five.map(f => [path.basename(f), fs.readFileSync(f).toString("base64")]));
  ok(await until(async () => (await up.locator("#queueList .item").count()) === 5), "Five pictures in Upscale's queue as cut-out jobs");
  await shot("upscale-queue");
  await up.locator("#queueRun").click();
  ok(await until(async () => (await upStatus()) === L("up.q.finished", { ok: 5, total: 5 }), 120000), "The queue runs them one after another: " + await upStatus());
  ok([1, 2, 3, 4, 5].every(i => cuts().includes(`batch ${i} (cutout).png`)) && await up.locator('#queueList .item[data-state="done"]').count() === 5, "Five cut-outs in Exports\\Cutouts");
  await shot("upscale-queue-done");

  /* ---------- Downloader: Cutout of a downloaded cover, saved beside it ---------- */
  const dl = page.frameLocator("#v-downloader");
  await tab("downloader"); await appReady("downloader");
  await dl.locator("#installBtn").click();
  await until(async () => await dl.locator("#engine").isHidden(), 30000);
  await dl.locator("#url").fill("https://www.youtube.com/watch?v=abc123"); await dl.locator("#goBtn").click();
  await until(async () => await dl.locator("#preview").isVisible(), 15000);
  await dl.locator("#getCover").click();
  const coverJob = dl.locator(".job.done", { hasText: L("dl.coverPng") });
  await until(async () => (await coverJob.count()) === 1, 30000);
  await coverJob.locator('[data-act="cut"]').click();
  const title = "Free Song (Official Video)";
  ok(await until(() => list("Downloads", "Covers").includes(title + " (cutout).png"), 30000), "Downloader: «Cut out» saves «(cutout).png» beside the cover");
  ok(await dl.locator("#status").textContent() === L("dl.st.cut", { name: title + " (cutout).png" }), "…and says where");
  await coverJob.locator('[data-act="cut"]').click();
  ok(await until(() => list("Downloads", "Covers").includes(title + " (cutout) (2).png"), 30000), "Again: a second file, the first is kept");

  /* ---------- Library: Add cutout version, Crop copy, a batch from picked images ---------- */
  const card = name => page.locator("#libPanel .libv-card", { has: page.locator(`.libv-meta b[title="${name}"]`) }).first();
  const menuOf = async (name, act) => { await card(name).click({ button: "right" }); await page.click(`.libv-menu [data-mi="${act}"]`); };
  await tab("library"); await page.locator('#libNav [data-tab="exports"]').click();
  await until(async () => (await card("subject-x2.png").count()) === 1, 5000, 20); await painted(page);
  await card("subject-x2.png").click({ button: "right" });
  ok(await page.locator('.libv-menu [data-mi="cutout"]').count() === 1 && await page.locator('.libv-menu [data-mi="crop"]').count() === 1, "Library: an image's menu has «Add cutout version» and «Crop copy»");
  await page.click('.libv-menu [data-mi="cutout"]');
  ok(await until(() => list("Exports", "Upscaled").includes("subject-x2 (cutout).png"), 30000), "«Add cutout version» saves the cut-out beside the original");
  await menuOf("subject-x2.png", "crop");
  await dialogOpen(page, "#cropDlg");
  await page.click('#cropRatios [data-ratio="16:9"]'); await painted(page); await page.click("#cropApply");
  ok(await until(() => list("Exports", "Upscaled").includes("subject-x2 (crop).png"), 30000), "«Crop copy» saves a cropped copy beside it");
  const crop = await alphaAt(page, P("Exports", "Upscaled", "subject-x2 (crop).png"), [[0.5, 0.5]]);
  ok(Math.abs(crop.w / crop.h - 16 / 9) < 0.01 && crop.w === 1200, `…at the original's quality: ${crop.w}×${crop.h}`);
  await tab("library"); await until(async () => (await card("subject-x2 (crop).png").count()) === 1, 5000, 20); await painted(page);
  await card("subject-x2 (crop).png").click();
  ok(await until(async () => (await page.locator(".libv-detail").textContent()).includes("subject-x2.png")), "The copy is «Made from» its original");
  await card("subject-x2.png").hover(); await card("subject-x2.png").locator(".libv-pick input").check();
  await card("subject-x2 (crop).png").locator(".libv-pick input").check();
  ok(await page.locator('[data-sel="cut"]').isVisible() && await page.locator(".libv-cuttext").textContent() === L("lib.cutPicked", { n: 2 }), "Picking images offers «Cut out 2»");
  await shot("library-picked");
  await page.click('[data-sel="cut"]');
  ok(await until(async () => (await up.locator('#queueList .item[data-state="pending"]').count()) === 2, 10000), "…which queues them in Upscale");

  /* ---------- dropping one image: Cutout in the menu ---------- */
  await page.keyboard.press("Control+1"); await until(() => page.evaluate(() => document.querySelector("#v-home").classList.contains("on")), 5000, 20); await painted(page);
  await page.locator("#homeIn").setInputFiles(fx("subject.png"));
  ok(await page.locator('#homeChoice [data-to="cutout"]').isVisible(), "The drop zone offers «" + L("home.cutShort") + "»");
  await page.locator('#homeChoice [data-to="cutout"]').click();
  await dialogOpen(page, "#cutDlg");
  await until(() => page.evaluate(() => document.querySelector("#cutBusy").hidden && !!document.querySelector("#cutStatus").textContent), 30000);
  await page.click("#cutApply");
  ok(await until(() => cuts().includes("subject (cutout).png"), 20000), "…the dialog, then the cut-out in Exports\\Cutouts");

  ok(errors.length === 0, "No page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed (cutout tools)` : "\nAll passed (cutout tools)");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
