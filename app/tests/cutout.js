// Crop and Cutout, the shared image services (docs/ARCHITECTURE.md → Shared services), over the mocked backend:
// 1. Crop geometry against pixels drawn independently (rotation, clamping, ratios).
// 2. Cutout: component download, the model's mask (fake SAM files: red = subject; CUTOUT_DIR for the real SAM 2.1
//    exports), cache by hash, the dialog (brush, undo, edge) and reopening a retouched mask.
// 3. Crop dialog: locked ratio, cancel, the initial frame on the subject.
// 4. Grade, Visualizer and Intro. Upscale, Downloader, Library and dropping: tests/cutout-tools.js.
// Usage: node app/tests/cutout.js   Screenshots go to $SHOTS/cutout.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { until, painted, serve, launch, openApp, locale } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "cutout");
const functional = process.argv.includes("--functional");
if (!functional) fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const { L } = locale("en");

const FX = makeFixtures(), TOOLS = toolOptions(FX), fx = n => path.join(FX.FIX, n);
const host = createHost(FX.TMP, TOOLS);
const P = (...p) => path.join(host.base, ...p);
fs.writeFileSync(P("Settings", "app.json"), JSON.stringify({ settings: { language: "en", saveMode: "halation-folder", saveLocationChosen: true } }));
const dialogOpen = (page, id) => until(() => page.evaluate(id => document.querySelector(id).open, id), 10000);

(async () => {
  const server = serve(), browser = await launch();
  const app = await openApp(browser, server, host, { width: 1480, height: 950 });
  const { page, errors, grade, vis, gFrame, vFrame, tab, appReady } = app;
  const shot = n => functional ? Promise.resolve() : page.screenshot({ path: path.join(SHOTS, n + ".png") });
  const b64 = f => fs.readFileSync(f).toString("base64");
  // a picture of the fixtures as a Blob in the main window (window.__pic)
  const pic = async f => page.evaluate(b => { window.__pic = new Blob([Uint8Array.from(atob(b), c => c.charCodeAt(0))], { type: "image/png" }); }, b64(fx(f)));

  /* ---------- 1. crop geometry ---------- */
  const geo = await page.evaluate(async () => {
    const IMG = window.__img, out = {};
    // a picture with a different colour in every pixel block: a crop is checked against toSource()
    const src = IMG.mk(400, 300), x = src.getContext("2d");
    for (let i = 0; i < 40; i++) for (let j = 0; j < 30; j++) { x.fillStyle = `rgb(${i * 6},${j * 8},${(i * 7 + j * 5) % 256})`; x.fillRect(i * 10, j * 10, 10, 10); }
    const p = IMG.clampCrop({ cx: 0.55, cy: 0.45, w: 0.5, h: 0.5, a: 17, ratio: "free" }, 400, 300);
    const c = IMG.render(src, p), cx = c.getContext("2d"), sx = src.getContext("2d");
    let worst = 0;
    for (const [u, v] of [[0.5, 0.5], [0.2, 0.3], [0.8, 0.7], [0.3, 0.8], [0.7, 0.2]]) {
      const ox = Math.floor(u * c.width), oy = Math.floor(v * c.height), [px, py] = IMG.toSource(p, 400, 300, ox + 0.5, oy + 0.5);
      const a = cx.getImageData(ox, oy, 1, 1).data, b = sx.getImageData(Math.floor(px), Math.floor(py), 1, 1).data;
      worst = Math.max(worst, Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]));
    }
    out.worst = worst;
    // every corner of a turned crop stays inside the picture
    out.inside = [[0, 0], [1, 0], [0, 1], [1, 1]].every(([u, v]) => { const [px, py] = IMG.toSource(p, 400, 300, u * p.w * 400, v * p.h * 300); return px >= -0.01 && py >= -0.01 && px <= 400.01 && py <= 300.01; });
    const big = IMG.clampCrop({ cx: 0.5, cy: 0.5, w: 1, h: 1, a: 30, ratio: "orig" }, 400, 300);
    out.shrunk = big.w < 1 && Math.abs(big.w * 400 / (big.h * 300) - 4 / 3) < 1e-6;
    const sq = IMG.centered(800, 600, "1:1", { x: 0.1, y: 0.5 });
    out.square = IMG.outSize(sq, 800, 600).join("x") + " at " + sq.cx.toFixed(3);
    out.fits = IMG.fits(1920, 1080, 16 / 9) && !IMG.fits(1920, 1200, 16 / 9);
    return out;
  });
  ok(geo.worst <= 6, "A turned crop draws exactly the source pixels toSource() names (worst difference " + geo.worst + ")");
  ok(geo.inside && geo.shrunk, "A turned crop stays inside the picture and keeps its ratio when it has to shrink");
  ok(geo.square === "600x600 at 0.375" && geo.fits, "Centred 1:1 crop with a focus moves only as far as the picture allows: " + geo.square);

  /* ---------- 2. Cutout ---------- */
  ok(await page.evaluate(() => window.__hal.cutoutReady()) === false, "Cutout is not on this PC at the start");
  await pic("subject.png");
  await page.evaluate(() => { window.__res = undefined; window.__hal.cutoutDialog({ image: window.__pic, name: "subject.png" }).then(r => { window.__res = r; }); });
  ok(await dialogOpen(page, "#modal") && /\d+ MB/.test(await page.locator("#mText").textContent()), "Cutout asks to download its component, with the size: " + await page.locator("#mText").textContent());
  await page.click("#mOk");
  const found = () => page.evaluate(() => document.querySelector("#cutDlg").open && document.querySelector("#cutBusy").hidden && !!document.querySelector("#cutStatus").textContent);
  ok(await until(found, 60000), "The component is downloaded and the dialog finds the subject: " + await page.locator("#cutStatus").textContent());
  ok(["sam21-base-plus-encoder-fp16.onnx", "sam21-base-plus-encoder.onnx", "sam21-base-plus-decoder.onnx", "SAM2-LICENSE.txt"].every(f => fs.existsSync(P("Tools", "cutout", f))) && host.log.some(l => l[0] === "tool_install" && l[1].tool === "cutout"), "Runtime and model in Documents\\Halation\\Tools\\cutout");
  ok(await until(() => host.log.filter(l => l[0] === "cutout_cache_put").length === 1, 5000), "The model's mask goes to the cache");
  await shot("cutout-dialog");
  // brush: remove a stroke through the subject, undo it, remove it again
  const stage = await page.locator("#cutStage").boundingBox();
  const at = (u, v) => [stage.x + stage.width * u, stage.y + stage.height * v];
  const stroke = async () => { const [x0, y0] = at(0.25, 0.3), [x1, y1] = at(0.4, 0.62); await page.mouse.move(x0, y0); await page.mouse.down(); await page.mouse.move(x1, y1, { steps: 10 }); await page.mouse.up(); };
  await page.click('#cutTools [data-tool="remove"]'); await painted(page);
  await stroke(); await page.keyboard.press("Control+z"); await painted(page); await stroke();
  await page.click('#cutBgs [data-bg="white"]');
  await page.evaluate(() => { const r = document.querySelector("#cutFeather"); r.value = "3"; r.dispatchEvent(new Event("input")); });
  await painted(page); await shot("cutout-brush");
  await page.click("#cutApply");
  ok(await until(() => page.evaluate(() => window.__res !== undefined), 20000), "Apply returns the result");
  const res = await page.evaluate(async () => {
    const r = window.__res, IMG = window.__img, img = await IMG.load(r.rgba), c = IMG.mk(img.naturalWidth, img.naturalHeight), x = c.getContext("2d");
    x.drawImage(img, 0, 0); const a = (u, v) => x.getImageData(Math.round(u * c.width), Math.round(v * c.height), 1, 1).data[3];
    return { w: r.w, h: r.h, disc: a(0.2, 0.5), bg: a(0.8, 0.5), stroke: a(0.325, 0.46), edit: r.edit && r.edit.edge, base: !!(r.edit && r.edit.base) };
  });
  ok(res.w === 800 && res.h === 600 && res.disc > 240 && res.bg < 10, `Transparent PNG at full size: subject kept (α ${res.disc}), background gone (α ${res.bg})`);
  ok(res.stroke < 40 && res.edit.feather === 3 && res.base, `The brush stroke is removed (α ${res.stroke}) and the edit (mask + edge) is returned to reopen it`);
  // reopening the retouched mask does not run the model again
  const puts = host.log.filter(l => l[0] === "cutout_cache_put").length;
  await page.evaluate(() => { window.__res2 = undefined; window.__hal.cutoutDialog({ image: window.__pic, name: "subject.png", edit: window.__res.edit }).then(r => { window.__res2 = r; }); });
  await dialogOpen(page, "#cutDlg"); await until(async () => await page.locator("#cutFeather").inputValue() === "3" && await page.locator("#cutBusy").isHidden(), 5000, 20);
  ok(await page.locator("#cutFeather").inputValue() === "3" && await page.locator("#cutBusy").isHidden(), "Reopening the edit keeps the edge settings, without analysing again");
  await page.click("#cutApply"); await until(() => page.evaluate(() => window.__res2 !== undefined), 20000);
  ok(await page.evaluate(async () => { const IMG = window.__img, i = await IMG.load(window.__res2.rgba), c = IMG.mk(800, 600), x = c.getContext("2d"); x.drawImage(i, 0, 0); return x.getImageData(260, 276, 1, 1).data[3]; }) < 40, "…and the retouched mask comes back as it was left");
  const t0 = Date.now(); await page.evaluate(() => window.__hal.cutout(window.__pic)); const cachedMs = Date.now() - t0;
  ok(host.log.filter(l => l[0] === "cutout_cache_put").length === puts && fs.readdirSync(host.localDir("workspace", "cache", "masks")).length === 1, `The same picture again uses the cache by hash (${cachedMs} ms)`);

  /* ---------- 3. Crop dialog ---------- */
  await page.evaluate(() => { window.__c = undefined; window.__hal.fitCrop(window.__pic, "1:1", { name: "subject.png" }).then(r => { window.__c = r; }); });
  ok(await dialogOpen(page, "#cropDlg") && await page.locator("#cropNeed").isVisible() && await page.locator("#cropRatioRow").isHidden(), "A place that needs 1:1 opens the dialog locked to 1:1, saying so");
  const frameX = () => page.evaluate(() => { const f = document.querySelector("#cropFrame").getBoundingClientRect(), s = document.querySelector("#cropImg").getBoundingClientRect(); return (f.left + f.width / 2 - s.left) / s.width; });
  await until(async () => await frameX() < 0.45, 5000, 20);
  const cx = await page.evaluate(() => { const f = document.querySelector("#cropFrame").getBoundingClientRect(), s = document.querySelector("#cropImg").getBoundingClientRect(); return (f.left + f.width / 2 - s.left) / s.width; });
  ok(cx < 0.45, "With Cutout installed the frame starts on the subject, left of centre: " + cx.toFixed(2));
  await shot("crop-locked");
  await page.click("#cropCancel");
  ok(await until(() => page.evaluate(() => window.__c === null)), "Cancel: nothing is placed (null)");
  await page.evaluate(() => { window.__hal.crop({ image: window.__pic, name: "subject.png", ratio: "free" }).then(r => { window.__c = r; }); });
  await dialogOpen(page, "#cropDlg");
  await page.click('#cropRatios [data-ratio="16:9"]');
  await page.evaluate(() => { const r = document.querySelector("#cropRot"); r.value = "-8"; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); });
  await page.click("#cropGrid"); await painted(page); await shot("crop-free");
  await page.click("#cropApply");
  const c16 = await until(() => page.evaluate(() => window.__c && window.__c.params), 5000);
  ok(c16 && Math.abs(c16.w * 800 / (c16.h * 600) - 16 / 9) < 0.01 && c16.a === -8 && c16.ratio === "16:9", "Free dialog: a ratio chip and the rotation give 16:9 turned −8°");

  /* ---------- 4a. Grade: the format forces a crop, rotation, Cutout to a transparent PNG ---------- */
  await tab("grade"); await appReady("grade");
  await grade.locator("#aspect").selectOption("1");
  await grade.locator("#imgIn").setInputFiles(fx("subject.png"));
  ok(await dialogOpen(page, "#cropDlg"), "Grade 1:1 with an 800×600 picture: the Crop dialog opens before placing it");
  await page.click("#cropCancel"); await until(async () => await grade.locator("#status").textContent() === L("grade.st.notPlaced"), 5000, 20);
  ok(await grade.locator("#emptyStage").isVisible() && await grade.locator("#status").textContent() === L("grade.st.notPlaced"), "Cancelled: the picture is not placed");
  await grade.locator("#imgIn").setInputFiles(fx("subject.png"));
  await dialogOpen(page, "#cropDlg");
  await page.evaluate(() => { const r = document.querySelector("#cropRot"); r.value = "10"; r.dispatchEvent(new Event("input")); r.dispatchEvent(new Event("change")); });
  await page.click("#cropApply"); await until(async () => /^Result: (\d+) × \1 px$/.test(await grade.locator("#cropOut").textContent()), 5000, 20);
  ok(/^Result: (\d+) × \1 px$/.test(await grade.locator("#cropOut").textContent()), "Placed with its 1:1 crop: " + await grade.locator("#cropOut").textContent());
  await grade.locator("#outSize").selectOption("orig"); await grade.locator("#outFmt").selectOption("png");
  const covers = () => fs.readdirSync(P("Exports", "Covers"));
  await grade.locator("#exportBtn").click();
  ok(await until(() => fs.existsSync(P("Exports", "Covers")) && covers().includes("subject.png"), 20000), "Export of the cropped picture");
  const cmpShot = async (file, params, masked) => page.evaluate(async ({ b, p, file, masked }) => {
    const IMG = window.__img, u8 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const src = await IMG.load(new Blob([u8(b)], { type: "image/png" })), out = await IMG.load(new Blob([u8(file)], { type: "image/png" }));
    const ref = IMG.render(src, p), w = out.naturalWidth, h = out.naturalHeight, a = IMG.mk(w, h).getContext("2d"), r = IMG.mk(w, h).getContext("2d");
    a.drawImage(out, 0, 0); r.drawImage(ref, 0, 0, w, h);
    const da = a.getImageData(0, 0, w, h).data, dr = r.getImageData(0, 0, w, h).data; let s = 0, n = 0;
    for (let i = 0; i < da.length; i += 4) if (da[i + 3] === 255) { s += Math.abs(da[i] - dr[i]) + Math.abs(da[i + 1] - dr[i + 1]) + Math.abs(da[i + 2] - dr[i + 2]); n += 3; }
    return { mean: s / n, alpha: [a.getImageData(w - 2, h / 2, 1, 1).data[3], a.getImageData(w * 0.2, h / 2, 1, 1).data[3]], size: [w, ref.width] };
  }, { b: b64(fx("subject.png")), p: params, file: b64(P("Exports", "Covers", file)), masked });
  const gp = await gFrame().evaluate(async () => (await window.__halApp.session.capture()).crop.p);
  const g1 = await cmpShot("subject.png", gp);
  ok(g1.mean < 2 && gp.a === 10, `The GPU crop (turned 10°) matches imgops.render on the original (mean difference ${g1.mean.toFixed(2)})`);
  await grade.locator("#cutBtn").click();
  await dialogOpen(page, "#cutDlg"); await until(found, 30000);
  await page.click("#cutApply");
  ok(await dialogOpen(page, "#modal") && await page.locator("#mOk").textContent() === L("grade.cutExport") && await page.locator("#mCancel").textContent() === L("grade.cutKeep"), "Grade Cutout: export as PNG or keep editing");
  await page.click("#mCancel"); await until(() => grade.locator("#stage").evaluate(e => e.classList.contains("cut")), 5000, 20); await painted(page);
  ok(await grade.locator("#stage").evaluate(e => e.classList.contains("cut")) && await grade.locator('#outFmt option[value="jpg"]').isDisabled(), "Keep editing: the picture shows over a checkerboard; JPG is off while it is cut out");
  await shot("grade-cutout");
  await grade.locator("#exportBtn").click();
  ok(await until(() => covers().includes("subject (2).png"), 20000), "Export with the cut-out");
  const g2 = await cmpShot("subject (2).png", gp);
  ok(g2.alpha[0] < 10 && g2.alpha[1] > 240, `Exported PNG keeps the transparency: background α ${g2.alpha[0]}, subject α ${g2.alpha[1]}`);
  await grade.locator("#cutOff").click(); await until(async () => !(await grade.locator("#stage").evaluate(e => e.classList.contains("cut"))), 5000, 20);
  ok(!(await grade.locator("#stage").evaluate(e => e.classList.contains("cut"))), "Remove cut-out: the whole picture again");

  /* ---------- 4b. Visualizer: square cover, Cover cutout ---------- */
  await tab("visualizer"); await appReady("visualizer");
  await vis.locator("#audIn").setInputFiles(fx("song one.wav"));
  await vis.locator("#artIn").setInputFiles(fx("subject.png"));
  ok(await dialogOpen(page, "#cropDlg"), "Visualizer: a cover that is not square opens the 1:1 crop");
  await page.click("#cropCancel"); await until(() => page.evaluate(() => !document.querySelector("#cropDlg").open), 5000, 20); await painted(page);
  ok(await vis.locator("#artName").textContent() === L("vis.noCover"), "Cancelled: no cover");
  await vis.locator("#artIn").setInputFiles(fx("cover.png")); await until(async () => await vis.locator("#artName").textContent() === "cover.png", 5000, 20); await painted(page);
  ok(!(await page.evaluate(() => document.querySelector("#cropDlg").open)) && await vis.locator("#artName").textContent() === "cover.png", "A square cover goes in without the dialog");
  await vis.locator("#artIn").setInputFiles(fx("subject.png")); await dialogOpen(page, "#cropDlg");
  await page.click("#cropApply"); await until(async () => await vis.locator("#artName").textContent() === "subject.png", 5000, 20); await painted(page);
  const artSq = await vFrame().evaluate(() => { const i = document.querySelector("#artThumb"); return i.naturalWidth === i.naturalHeight; });
  ok(artSq && await vis.locator("#artName").textContent() === "subject.png", "Applied: the cover is the square crop");
  await vis.locator("#f-coverCut").check();
  await dialogOpen(page, "#cutDlg"); await until(found, 30000); await page.click("#cutApply");
  await until(async () => await vis.locator("#f-coverCut").isChecked() && !(await page.evaluate(() => document.querySelector("#cutDlg").open)), 5000, 20); await painted(page);
  ok(await vis.locator("#f-coverCut").isChecked(), "«Cover cutout» on: the subject is cut out");
  await vFrame().evaluate(() => { const r = document.querySelector("#f-popOut"); r.value = "18"; r.dispatchEvent(new Event("input")); });
  await painted(page); await shot("visualizer-popout");
  await vis.locator("#f-coverCut").uncheck(); await painted(page); await vis.locator("#f-coverCut").check(); await painted(page);
  ok(!(await page.evaluate(() => document.querySelector("#cutDlg").open)), "Switching it on again reuses the cut-out");

  ok(errors.length === 0, "No page errors" + (errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed (cutout)` : "\nAll passed (cutout)");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
