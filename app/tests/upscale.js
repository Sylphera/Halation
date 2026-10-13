// Upscale with any ratio (upscale.js → upscaleFile, padEven; the shared Crop dialog in services.js):
// 1. Every Crop result upscales to exactly its own size × the scale: 1:1, 4:5, 9:16, "Original", a 21:9 picture
//    and an irregular free crop dragged with the handles, at ×2 and ×4. Most of them have odd sides, which
//    upscayl-bin alone cuts short by a column or a row (tests/fake-upscayl.js does the same).
// 2. No border and no stretch: the result, brought back to the input's size, matches the input column by column
//    and row by row, edges included.
// 3. The viewer shows the input at its own aspect ratio, whole: a large portrait picture, a 1:1 crop of it and a
//    small picture scaled up to fill the stage, on the viewer grey (not black).
// 4. Using it as a user: a second picture replaces the first, the crop survives going to another tool and back,
//    "Remove crop" goes back to the whole picture, the queue gives odd pictures their exact size too, and the result
//    goes to Grade with its size.
// With the real upscayl-bin (tests/fixtures.js: UPSCAYL_BIN) the same checks run on the real model, with a looser
// tolerance. Screenshots → $SHOTS/upscale.
// Usage: node app/tests/upscale.js
const fs = require("fs"), os = require("os"), path = require("path"), { execSync } = require("child_process");
const { until, painted, serve, launch, openApp, locale } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "upscale");
const functional = process.argv.includes("--functional");
if (!functional) fs.mkdirSync(SHOTS, { recursive: true });
const FX = makeFixtures(), TOOLS = toolOptions(FX), { L } = locale("en");
const host = createHost(fs.mkdtempSync(path.join(FX.TMP, "upscale-")), TOOLS);
fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en" } }));
const P = (...p) => path.join(host.base, ...p);
const size = f => execSync(`ffprobe -v error -show_entries stream=width,height -of csv=p=0 "${f}"`).toString().trim().split(",").map(Number);
// odd sides on purpose; testsrc2 has sharp detail everywhere, so a shift of one pixel shows
const pic = (name, w, h) => {
  const f = path.join(FX.TMP, name);
  execSync(`ffmpeg -v error -f lavfi -i testsrc2=size=${w + 1}x${h + 1} -vf format=rgb24,crop=${w}:${h}:0:0 -frames:v 1 -y "${f}"`);
  return f;
};
const BIG = pic("big.png", 1601, 2401), SMALL = pic("small.png", 121, 91);
const WIDE = pic("wide.png", 641, 361), CINE = pic("cine.png", 587, 251), TALL = pic("tall.png", 203, 365);
// the mock scales by nearest neighbour (exact); a real model only resembles its input
const TOL = TOOLS.real ? { mean: 40, edge: 60 } : { mean: 3, edge: 6 };

(async () => {
  const server = serve(), browser = await launch();
  const { page, errors, tab, appReady, grade } = await openApp(browser, server, host, { width: 1480, height: 920 });
  const up = page.frameLocator("#v-upscale"), fr = () => page.frames().find(f => /upscale\.html/.test(f.url()));
  const shot = n => painted(page).then(() => functional ? undefined : page.screenshot({ path: path.join(SHOTS, n + ".png") }));
  const status = () => up.locator("#status").textContent();
  const cropOpen = () => page.evaluate(() => document.querySelector("#cropDlg").open);
  await page.evaluate(() => window.__hal.installTool("upscaler"));
  await tab("upscale"); await appReady("upscale");
  await until(async () => (await up.locator("#engineBadge").textContent()) === L("up.ready"), 30000);

  const load = async (file, name, dims) => {
    await up.locator("#imgIn").setInputFiles(file);
    return until(async () => (await up.locator("#inName").textContent()) === name && (await up.locator("#inSize").textContent()) === dims, 15000);
  };
  const openCrop = async () => { await up.locator("#cropBtn").click(); await until(cropOpen, 5000); await painted(page); };
  const apply = async () => {
    const dims = (await page.locator("#cropOut").textContent()).match(/(\d+)\s*×\s*(\d+)/);
    if (!dims) throw new Error("Crop dialog did not announce its output dimensions");
    await page.click("#cropApply"); await until(async () => !(await cropOpen()), 5000);
    ok(await until(async () => (await up.locator("#inSize").textContent()) === `${dims[1]}×${dims[2]}`, 5000), "Crop preview finishes at the announced dimensions before navigation/export");
    await painted(page);
  };
  const inSize = async () => (await up.locator("#inSize").textContent()).split("×").map(Number);
  const range = (sel, v) => page.locator(sel).evaluate((e, v) => { e.value = String(v); e.dispatchEvent(new Event("input", { bubbles: true })); }, v);
  const scale = async s => { await up.locator(`[data-scale="${s}"]`).click(); };
  // Runs the upscale and checks the file: exact size, and the same picture as the input (edges included)
  const run = async (label, s) => {
    await scale(s);
    const [w, h] = await inSize(), n0 = fs.readdirSync(P("Exports", "Upscaled")).length;
    await up.locator("#runBtn").click();
    const done = await until(async () => RXdone.test(await status()) && fs.readdirSync(P("Exports", "Upscaled")).length > n0, 600000, 100);
    const r = await fr().evaluate(() => window.__halApp.result());
    if (!done || !r) { ok(false, `${label}: upscale finished (${await status()})`); return null; }
    const [ow, oh] = size(r.path);
    ok(ow === w * s && oh === h * s && (await up.locator("#resultSize").textContent()) === `${w * s}×${h * s}`, `${label} ×${s}: ${w}×${h} → ${ow}×${oh} (exactly ${w * s}×${h * s})`);
    const d = await fr().evaluate(async ({ path: p, s }) => {
      // the result brought back to the input's size, against the input as it was upscaled (the crop, drawn again)
      const U = window.__upscale, IMG = U.IMG, HAL = U.HAL, inp = window.__halTestInput();
      const out = await IMG.load(await HAL.fileFromPath(p)), W = inp.width, H = inp.height;
      const small = IMG.mk(W, H), sx = small.getContext("2d", { willReadFrequently: true });
      sx.imageSmoothingQuality = "high"; sx.drawImage(out, 0, 0, W, H);
      const ref = inp.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, W, H).data, got = sx.getImageData(0, 0, W, H).data;
      const col = new Float64Array(W), row = new Float64Array(H);
      let sum = 0, alpha = 255;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = (y * W + x) * 4, e = (Math.abs(ref[i] - got[i]) + Math.abs(ref[i + 1] - got[i + 1]) + Math.abs(ref[i + 2] - got[i + 2])) / 3;
        col[x] += e / H; row[y] += e / W; sum += e; alpha = Math.min(alpha, got[i + 3]);
      }
      // the output's own last pixels: not black, not transparent (a padded border would be)
      const oc = IMG.mk(out.naturalWidth, out.naturalHeight), ox = oc.getContext("2d", { willReadFrequently: true }); ox.drawImage(out, 0, 0);
      const edge = [...ox.getImageData(oc.width - 1, 0, 1, oc.height).data, ...ox.getImageData(0, oc.height - 1, oc.width, 1).data];
      let dark = 0; for (let i = 0; i < edge.length; i += 4) if (edge[i + 3] < 250 || edge[i] + edge[i + 1] + edge[i + 2] === 0) dark++;
      return { mean: sum / (W * H), right: col[W - 1], bottom: row[H - 1], left: col[0], top: row[0], worstCol: Math.max(...col), worstRow: Math.max(...row), alpha, darkEdge: dark / (edge.length / 4) };
    }, { path: r.path, s });
    const f = n => n.toFixed(1);
    ok(d.mean < TOL.mean && d.worstCol < TOL.edge && d.worstRow < TOL.edge && d.alpha === 255,
      `${label} ×${s}: same picture, no stretch (mean ${f(d.mean)}, worst column ${f(d.worstCol)}, worst row ${f(d.worstRow)})`);
    ok(Math.max(d.right, d.bottom, d.left, d.top) < TOL.edge && d.darkEdge < 0.02, `${label} ×${s}: no border, the last column and row are kept (right ${f(d.right)}, bottom ${f(d.bottom)})`);
    return r;
  };
  const RXdone = new RegExp("^" + L("up.st.done", { name: "@" }).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace("@", ".+") + "$");
  // what the tests compare against: the input exactly as Upscale sends it
  await fr().evaluate(() => { window.__halTestInput = () => { const U = window.__upscale; return U.inputCanvas(); }; });

  // 3. the viewer: what is on screen is the whole input at its own ratio, touching the stage on one side
  const view = () => fr().evaluate(() => {
    const img = document.querySelector("#preview"), st = document.querySelector("#stage").getBoundingClientRect(), b = img.getBoundingClientRect();
    const k = Math.min(b.width / img.naturalWidth, b.height / img.naturalHeight), w = img.naturalWidth * k, h = img.naturalHeight * k;
    const x = b.left + (b.width - w) / 2, y = b.top + (b.height - h) / 2;
    return { ratio: w / h, nat: img.naturalWidth / img.naturalHeight, inside: x >= st.left - 0.5 && y >= st.top - 0.5 && x + w <= st.right + 0.5 && y + h <= st.bottom + 0.5,
      fills: Math.abs(w - st.width) < 1 || Math.abs(h - st.height) < 1, w: Math.round(w), h: Math.round(h), bg: getComputedStyle(document.querySelector("#stage")).backgroundColor };
  });
  const viewOk = async (label, want) => {
    await until(async () => { const v = await view(); return v.w > 0 && Math.abs(v.nat - want) < 0.01; }, 5000);
    const v = await view();
    ok(Math.abs(v.ratio / want - 1) < 0.01 && v.inside && v.fills, `Viewer, ${label}: ${v.w}×${v.h} on screen, ratio ${v.ratio.toFixed(3)} (want ${want.toFixed(3)}), whole and filling the stage`);
    return v;
  };
  ok(await load(BIG, "big.png", "1601×2401"), "A large portrait picture loads: 1601×2401");
  ok(await fr().evaluate(async () => {
    const { HAL, IMG } = window.__upscale, app = window.__halApp, before = await app.session.capture();
    const prepare = HAL.tempFile, decode = IMG.load, create = URL.createObjectURL, revoke = URL.revokeObjectURL;
    const urls = new Set(); let decoded = false;
    const blob = await IMG.toBlob(IMG.mk(16, 16));
    HAL.tempFile = async () => { throw new Error("test temporary-file failure"); };
    IMG.load = (...args) => { decoded = true; return decode(...args); };
    URL.createObjectURL = (...args) => { const url = create(...args); urls.add(url); return url; };
    URL.revokeObjectURL = url => { urls.delete(url); revoke(url); };
    try {
      await app.setInput({ blob, name: "failed.png" });
      return decoded && urls.size === 0 && JSON.stringify(await app.session.capture()) === JSON.stringify(before);
    } finally { HAL.tempFile = prepare; IMG.load = decode; URL.createObjectURL = create; URL.revokeObjectURL = revoke; }
  }), "Decode starts alongside file preparation; failed preparation revokes its URL and preserves the current input/Session");
  const vb = await viewOk("large portrait", 1601 / 2401);
  ok(vb.bg !== "rgb(0, 0, 0)", `The viewer is dark grey, not black: ${vb.bg}`);
  await shot("viewer-portrait");
  await openCrop(); await page.locator('#cropRatios [data-ratio="1:1"]').click(); await apply();
  await viewOk("1:1 crop", 1);
  const [sw1, sh1] = await inSize();
  ok(sw1 === sh1 && sw1 > 0, `…and the input is ${sw1}×${sh1}`);
  await shot("viewer-crop-1-1");
  await openCrop(); await page.locator('#cropRatios [data-ratio="9:16"]').click(); await apply();
  await viewOk("9:16 crop", 9 / 16);
  ok(await load(SMALL, "small.png", "121×91"), "A small picture loads: 121×91");
  const vs = await viewOk("small picture scaled up", 121 / 91);
  ok(vs.w > 121 * 3, `…scaled up to ${vs.w}×${vs.h}`);
  await shot("viewer-small");

  // 1-2. a wide picture with odd sides, cropped with each ratio chip
  ok(await load(WIDE, "wide.png", "641×361"), "A picture with odd sides loads: 641×361");
  await up.locator('input[name=model][value=fast]').check();
  await run("Whole picture (odd sides)", 2);
  const ratios = [["1:1", 4], ["4:5", 2], ["9:16", 4], ["orig", 2]];
  for (const [k, s] of ratios) {
    await openCrop();
    await page.locator(`#cropRatios [data-ratio="${k}"]`).click();
    // move and zoom a little, so the crop lands on arbitrary pixels
    await range("#cropZoom", 1.3); await page.locator("#cropStage").focus().catch(() => {}); await page.keyboard.press("ArrowLeft");
    const out = await page.locator("#cropOut").textContent();
    await apply();
    // the crop reaches the tool once it has rendered it
    await until(async () => { const [w, h] = await inSize(); return out === L("crop.out", { w, h }); }, 3000, 30);
    const [w, h] = await inSize(), want = { "1:1": 1, "4:5": 0.8, "9:16": 9 / 16, orig: 641 / 361 }[k];
    ok(Math.abs(w / h / want - 1) < 0.01 && out === L("crop.out", { w, h }), `Crop ${k}: ${w}×${h} in Upscale, as the dialog said`);
    if (k === "9:16") await shot("crop-9-16-ready");
    await run(`Crop ${k}`, s);
    if (k === "1:1") await shot("crop-1-1-done");
  }
  // an irregular free crop, dragged with the handles
  await openCrop();
  await page.locator('#cropRatios [data-ratio="free"]').click();
  const handle = async (h, dx, dy) => {
    const b = await page.locator(`#cropFrame [data-h="${h}"]`).boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
    await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, { steps: 6 }); await page.mouse.up();
    await painted(page);
  };
  await handle("e", -173, 0); await handle("n", 0, 61); await handle("sw", 37, -19);
  await range("#cropRot", 7.3);
  await apply();
  const [fw, fh] = await inSize();
  ok(fw !== 641 && fh !== 361 && Math.abs(fw / fh - 641 / 361) > 0.05, `Free crop, rotated: ${fw}×${fh}`);
  await run("Free crop", 4);
  await shot("free-done");

  // a 21:9 picture, whole and through "Original"
  ok(await load(CINE, "cine.png", "587×251"), "A second picture replaces the first: 587×251 (21:9)");
  ok(await up.locator("#uncropBtn").isHidden() && await up.locator("#result").isHidden(), "…with no crop and no result of the first");
  await run("21:9", 4);
  await openCrop(); await page.locator('#cropRatios [data-ratio="orig"]').click(); await apply();
  const [cw, ch] = await inSize();
  ok(Math.abs(cw / ch - 587 / 251) < 0.01, `21:9 with "Original": ${cw}×${ch}`);
  await run("21:9 Original", 2);

  // 3. the crop survives another tool; "Remove crop" goes back to the whole picture
  await openCrop(); await page.locator('#cropRatios [data-ratio="9:16"]').click(); await apply();
  const [tw, th] = await inSize();
  await tab("grade"); await tab("upscale");
  ok((await up.locator("#inSize").textContent()) === `${tw}×${th}` && await up.locator("#uncropBtn").isVisible(), `Grade and back: the 9:16 crop is still there (${tw}×${th})`);
  await up.locator("#uncropBtn").click();
  ok(await until(async () => (await up.locator("#inSize").textContent()) === "587×251"), "Remove crop: the whole picture again");
  ok((await status()) === L("up.st.ready", { w: 587 * 2, h: 251 * 2 }), "…and the size to expect follows: " + await status());

  // the queue: odd pictures, each at its exact size
  const before = fs.readdirSync(P("Exports", "Upscaled"));
  await up.locator("#imgIn").setInputFiles([TALL, CINE]);
  await until(async () => (await up.locator("#queueList .item").count()) === 2, 5000);
  await up.locator("#queueRun").click();
  ok(await until(async () => (await up.locator('#queueList .item[data-state="done"]').count()) === 2, TOOLS.real ? 600000 : 60000, 200), "Queue: both pictures upscaled: " + (await up.locator("#queueList").innerText()).replace(/\s+/g, " "));
  const made = fs.readdirSync(P("Exports", "Upscaled")).filter(f => !before.includes(f));
  const sizes = Object.fromEntries(made.map(f => [f.replace(/-x\d.*$/, ""), size(P("Exports", "Upscaled", f)).join("×")]));
  ok(sizes.tall === "406×730" && sizes.cine === "1174×502", "Queue: exact sizes for odd pictures: " + JSON.stringify(sizes));
  ok(!fs.readdirSync(host.localDir("workspace", "temp", "loose")).some(f => /-up\.png$/.test(f)), "No padded working file is left in Tools\\temp");

  // the result goes on with its size (Grade)
  const last = await fr().evaluate(() => window.__halApp.result());
  await up.locator("#sendBtn").click();
  await up.locator('.sendmenu:not([hidden]) [data-to="grade"]').click();
  const [lw, lh] = size(last.path);
  ok(await until(async () => (await grade.locator("#imgName").textContent()).includes(`${lw}×${lh}`), 15000), `Send to… Grade: ${await grade.locator("#imgName").textContent()}`);

  ok(!errors.length, "No page errors: " + errors.join(" | "));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall OK");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
