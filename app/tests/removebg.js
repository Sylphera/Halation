// Remove Background (removebg.js), used as a user over the mocked backend:
// The model is the tests' stand-in for SAM 2.1 (tests/fake-sam.py): what is redder than blue is the subject, and each
// point pushes its own label around it.
// 1. Automatic: without the Cutout component it says so; installed, it marks the background in blue and nothing is
//    removed until Remove; Remove removes it, undo and redo go back and forth.
// 2. Magic wand: a click marks the subject, a right click takes a part away (only once there is a subject), on the same
//    selection; the sliders change it live.
// 3. Brush: it opens on Subject; subject and background strokes, the size; the strokes steer the same selection.
// 4. A second picture replaces the first; going to another tool and back keeps the work; "Before" held shows the
//    original; the mask view.
// 5. Export: PNG and WebP with the right transparency, the mask alone; Crop; Send to Upscale.
// Screenshots → $SHOTS/removebg.
// Usage: node app/tests/removebg.js
const fs = require("fs"), os = require("os"), path = require("path"), { execSync } = require("child_process");
const { until, painted, serve, launch, openApp, locale } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "removebg");
const functional = process.argv.includes("--functional");
if (!functional) fs.mkdirSync(SHOTS, { recursive: true });
const FX = makeFixtures(), TOOLS = toolOptions(FX), { L } = locale("en"), fx = n => path.join(FX.FIX, n);
const host = createHost(fs.mkdtempSync(path.join(FX.TMP, "removebg-")), TOOLS);
fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en", saveMode: "halation-folder", saveLocationChosen: true } }));
const P = (...p) => path.join(host.base, ...p);
// a red card (the stand-in model's subject) with a dark square on it and a red speck, on a flat green background
const CARD = path.join(FX.TMP, "card.png");
execSync(`ffmpeg -v error -f lavfi -i "color=c=0x2f9e44:s=640x480" -vf "drawbox=x=200:y=120:w=240:h=240:color=0xd03030:t=fill,drawbox=x=280:y=200:w=80:h=80:color=0x202020:t=fill,drawbox=x=40:y=40:w=6:h=6:color=0xd03030:t=fill" -frames:v 1 -y "${CARD}"`);

(async () => {
  const server = serve(), browser = await launch();
  const { page, errors, tab, appReady } = await openApp(browser, server, host, { width: 1480, height: 920 });
  const rb = page.frameLocator("#v-removebg"), fr = () => page.frames().find(f => /removebg\.html/.test(f.url()));
  const shot = n => painted(page).then(() => functional ? undefined : page.screenshot({ path: path.join(SHOTS, n + ".png") }));
  const status = () => rb.locator("#status").textContent();
  const R = fn => fr().evaluate(fn);
  // kept alpha of work pixels at fractions of the picture
  const alphaAt = pts => fr().evaluate(pts => { const { R } = window.__rb; return pts.map(([u, v]) => R.alpha[Math.floor(v * R.H) * R.W + Math.floor(u * R.W)]); }, pts);
  const selAt = pts => fr().evaluate(pts => { const { R } = window.__rb; return pts.map(([u, v]) => R.sel ? R.sel[Math.floor(v * R.H) * R.W + Math.floor(u * R.W)] : 0); }, pts);
  const selCount = () => R(() => window.__rb.R.sel ? window.__rb.R.selCount : 0);
  const settle = async () => { await R(() => window.__halApp.flush()); await painted(page); await painted(page); };
  // a point of the picture on screen (fractions)
  const at = async (u, v) => fr().evaluate(([u, v]) => {
    const { cmp, R } = window.__rb, r = document.querySelector("#stage").getBoundingClientRect(), s = cmp.st;
    return [r.left + s.tx + u * s.bw * s.z, r.top + s.ty + v * s.bh * s.z];
  }, [u, v]);
  const frameBox = async () => { const b = await page.locator("#v-removebg").boundingBox(); return [b.x, b.y]; };
  const click = async (u, v, mods = [], button = "left") => {
    const [x, y] = await at(u, v), [ox, oy] = await frameBox();
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.click(ox + x, oy + y, { button });
    for (const m of mods) await page.keyboard.up(m);
  };
  const drag = async pts => {
    const [ox, oy] = await frameBox(), ps = [];
    for (const [u, v] of pts) { const [x, y] = await at(u, v); ps.push([ox + x, oy + y]); }
    await page.mouse.move(...ps[0]); await page.mouse.down();
    for (const p of ps.slice(1)) await page.mouse.move(p[0], p[1], { steps: 6 });
    await page.mouse.up();
  };
  const range = (id, v) => rb.locator("#" + id).evaluate((e, v) => { e.value = String(v); e.dispatchEvent(new Event("input", { bubbles: true })); e.dispatchEvent(new Event("change", { bubbles: true })); }, v);
  const load = async (file, dims) => { await rb.locator("#imgIn").setInputFiles(file); return until(async () => (await rb.locator("#inSize").textContent()) === dims, 15000); };

  ok(await page.locator('.tab[data-tab=removebg]').count() === 1, "Remove Background is on the rail");
  await tab("removebg"); await appReady("removebg");
  await R(() => { const Native = window.Worker; window.__selectionWorkers = 0; window.Worker = class extends Native { constructor(...args) { super(...args); window.__selectionWorkers++; } }; });
  ok(await rb.locator("#emptyStage").isVisible(), "Empty: asks for a picture");
  await shot("empty");

  /* ---------- 1. Automatic ---------- */
  ok(await load(fx("subject.png"), "800×600"), "A picture loads (800×600)");
  ok(await until(async () => (await status()) === L("rb.st.needModel"), 5000), "Automatic without the Cutout component says what it needs: " + await status());
  ok(await rb.locator("#applyBtn").isDisabled(), "Nothing to remove yet");
  await page.evaluate(() => Promise.all([window.__shell.installTool("cutout"), window.__shell.installTool("upscaler")]));
  await rb.locator("#detectBtn").click();
  ok(await until(async () => (await status()) === L("rb.st.detected"), 60000), "Detect: the background is found: " + await status());
  await settle();
  const [cornerSel, discSel] = await selAt([[0.03, 0.05], [260 / 800, 0.5]]);
  ok(cornerSel > 200 && discSel < 50, `The background turns blue, the subject does not (corner ${cornerSel}, subject ${discSel})`);
  ok((await alphaAt([[0.03, 0.05]]))[0] === 255, "Nothing is removed before Remove");
  await shot("auto-selection");
  const autoCount = await selCount();
  ok(await R(() => window.__selectionWorkers === 1), "Selection uses one reusable worker rather than a canvas fallback");
  ok(await R(() => { const expected = window.__rb.compute(), actual = window.__rb.R.sel; return expected.length === actual.length && expected.every((v, i) => v === actual[i]); }), "Worker Automatic selection is byte-identical to the canvas algorithm");
  await range("intensity", 90); await settle();
  const moreCount = await selCount();
  await range("intensity", 10); await settle();
  const lessCount = await selCount();
  ok(moreCount >= autoCount && lessCount <= autoCount && moreCount > lessCount, `Intensity moves the selection live (${lessCount} < ${autoCount} < ${moreCount})`);
  await rb.locator("#intensity").dblclick(); await settle();
  ok(await R(() => window.__rb.opts.intensity) === 50, "Double-click puts the slider back");
  await rb.locator("#applyBtn").click(); await settle();
  let [c, d] = await alphaAt([[0.03, 0.05], [260 / 800, 0.5]]);
  ok(c === 0 && d === 255 && (await status()) === L("rb.st.applied"), `Remove removes the background and keeps the subject (${c}, ${d})`);
  ok(await rb.locator("#applyBtn").isDisabled(), "After Remove the selection starts again");
  await shot("auto-applied");
  await rb.locator("#undoBtn").click(); await settle();
  ok((await alphaAt([[0.03, 0.05]]))[0] === 255 && await selCount() > 0, "Undo brings the background and the selection back");
  await page.keyboard.press("Control+Shift+Z"); await settle();
  ok((await alphaAt([[0.03, 0.05]]))[0] === 0, "Ctrl+Shift+Z redoes the Remove");
  await page.keyboard.press("Control+z"); await page.keyboard.press("Control+z"); await settle();
  ok((await alphaAt([[0.03, 0.05]]))[0] === 255 && await selCount() === 0, "Undo twice: back to the picture as it came, no selection");

  /* ---------- 2. Magic wand, on a second picture ---------- */
  ok(await load(CARD, "640×480"), "A second picture replaces the first (640×480)");
  ok(await R(() => window.__rb.R.undo.length) <= 1 && (await rb.locator("#inName").textContent()) === "card.png", "The second picture starts with its own history and name");
  await until(() => R(() => !window.__rb.R.busy), 15000);   // Automatic's proposal for the new picture
  await rb.locator('[data-mode="wand"]').click();
  ok(await R(() => document.querySelector("#stage").dataset.mode) === "wand" && (await rb.locator("#toolTitle").textContent()) === L("rb.mode.wand"), "The wand is chosen; the panel follows");
  ok(await R(() => !!window.__rb.R.sam), "The picture is read by the model as it loads, before the first click");
  await range("islands", 0); await settle();
  await rb.locator("#clearSel").click(); await settle();
  const mine = () => R(() => window.__rb.R.points.filter(p => !p.auto).map(p => p.label).join());
  ok(L("rb.how.wandFg") === await rb.locator("#howFg").textContent() && await rb.locator("#howRow").isVisible(), "The panel says how the wand is used: left click the subject, right click takes away");
  await click(0.02, 0.02, [], "right"); await settle();
  ok(await mine() === "" && (await status()) === L("rb.st.subjectFirst"), "Without a subject a right click adds nothing and says to mark the subject first");
  await click(0.4, 0.3); await settle();
  let [g, w, k, sp] = await selAt([[0.02, 0.02], [0.4, 0.3], [0.5, 0.5], [43 / 640, 43 / 480]]);
  ok(g > 240 && w === 0, `A click on the card keeps it; the green turns blue (${g}, ${w})`);
  const k0 = k;
  ok(await mine() === "1", "The click is one subject point");
  ok(sp < 60, "A red speck inside the green stays out of the selection (" + sp + ")");
  await range("islands", 0.5); await settle();
  [sp] = await selAt([[43 / 640, 43 / 480]]);
  ok(sp > 200, "Small islands: the speck joins the selection (" + sp + ")");
  await range("islands", 0); await settle();
  await click(0.5, 0.5, [], "right"); await settle();
  [g, w, k] = await selAt([[0.02, 0.02], [0.4, 0.3], [0.5, 0.5]]);
  ok(k > 200 && g > 240 && w === 0, `A right click takes the dark square away from the subject, the rest stays (${g}, ${w}, ${k})`);
  ok(await mine() === "1,0", "Both clicks steer the same selection");
  await rb.locator("#undoBtn").click(); await settle();
  [k] = await selAt([[0.5, 0.5]]);
  ok(k === k0 && await mine() === "1", "Undo takes the last click back with its answer (" + k + ")");
  await rb.locator("#redoBtn").click(); await settle();
  const w0 = await selCount();
  await range("shift", 5); await settle();
  const w1 = await selCount();
  ok(await R(() => { const expected = window.__rb.compute(), actual = window.__rb.R.sel; return expected.length === actual.length && expected.every((v, i) => v === actual[i]); }), "Worker wand, feather and shift preserve every mask byte");
  await range("shift", 0); await range("feather", 0); await range("threshold", 100); await settle();
  ok(w1 < w0, `Contract / expand: + grows the picture, the selection shrinks (${w0} → ${w1})`);
  await shot("wand-selection");
  await page.keyboard.press("Enter"); await settle();
  [g, w, k] = await alphaAt([[0.02, 0.02], [0.4, 0.3], [0.5, 0.5]]);
  ok(g === 0 && w === 255 && k === 0, `Enter removes: green and the dark square gone, the card kept (${g}, ${w}, ${k})`);

  /* ---------- 3. Another tool and back ---------- */
  await tab("grade"); await appReady("grade");
  await tab("removebg");
  ok((await alphaAt([[0.02, 0.02]]))[0] === 0 && (await rb.locator("#inName").textContent()) === "card.png" && await R(() => window.__rb.opts.mode) === "wand", "Grade and back: the picture, what was removed and the tool are kept");
  // the same picture again (from another tool, Home or the Library): its work stays, nothing is read or proposed again
  await page.evaluate(async b64 => window.__shell.sendTo("removebg", { kind: "image", name: "card.png", blob: new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: "image/png" }) }), fs.readFileSync(CARD).toString("base64"));
  await until(async () => (await status()) === L("rb.st.kept"), 10000);
  ok((await alphaAt([[0.02, 0.02]]))[0] === 0 && await R(() => window.__rb.R.undo.length) > 0, "The same picture sent again keeps its work: " + await status());
  // the model's engine went idle in between: the picture is not encoded again, its kept features are adopted
  await page.evaluate(() => { window.__shell.cutoutStop(); window.__shell.cutoutLast = window.__encodedBefore = {}; });
  await click(0.5, 0.5); await settle();
  ok(await page.evaluate(() => window.__shell.cutoutLast === window.__encodedBefore) && await selCount() > 0, "After the engine went idle a click answers without reading the picture again");
  await rb.locator("#undoBtn").click(); await settle();

  /* ---------- 4. Brush ---------- */
  await page.keyboard.press("Control+z"); await settle();
  await rb.locator("#clearSel").click(); await settle();
  ok(await selCount() === 0, "Clear selection: no points, nothing blue");
  await rb.locator('[data-mode="brush"]').click(); await settle();
  ok(await R(() => window.__rb.opts.btool) === "fg" && await rb.locator('[data-btool="fg"]').getAttribute("aria-checked") === "true", "The brush opens on Subject");
  await range("size", 30);
  ok((await rb.locator("#oSize").textContent()) === "30 px", "Brush size shows in the panel");
  await drag([[0.4, 0.3], [0.6, 0.32]]); await settle();
  [g, w, k] = await selAt([[0.9, 0.1], [0.4, 0.3], [0.5, 0.5]]);
  ok(g === 255 && w === 0, `A subject stroke on the card: the card stays, all the green turns blue (${g}, ${w})`);
  ok(await R(() => { const p = window.__rb.R.points; return p.length >= 2 && p.length <= 6 && p.every(q => q.stroke && q.label === 1); }), "The stroke becomes a few subject points");
  const brushCount = await selCount();
  ok(await R(() => { const expected = window.__rb.compute(), actual = window.__rb.R.sel; return expected.length === actual.length && expected.every((v, i) => v === actual[i]); }), "Worker brush selection is byte-identical to the canvas algorithm");
  ok(await R(async () => {
    const e = document.querySelector("#intensity"), original = window.__rb.opts.intensity;
    for (let i = 0; i < 40; i++) { e.value = String(30 + i); e.dispatchEvent(new Event("input", { bubbles: true })); if (i < 39) await new Promise(requestAnimationFrame); }
    const saved = await window.__halApp.session.capture(), actual = window.__rb.R.sel.slice(), expected = window.__rb.compute();
    const equal = actual.every((v, i) => v === expected[i]) && saved.options.intensity === 69;
    e.value = String(original); e.dispatchEvent(new Event("input", { bubbles: true })); await window.__halApp.flush(); return equal;
  }), "Save waits for the latest selection after rapid parameter changes");
  await rb.locator("#undoBtn").click(); await settle();
  ok(await selCount() === 0, "Undo restores the empty brush selection");
  await rb.locator("#redoBtn").click(); await settle();
  ok(await selCount() === brushCount, "Redo restores the exact brush selection from cached history");
  ok(await R(() => {
    const { R, opts, compute } = window.__rb, ctx = R.paint.getContext("2d"), read = ctx.getImageData, threshold = opts.threshold;
    let calls = 0; ctx.getImageData = function (...args) { calls++; return read.apply(this, args); };
    try { opts.threshold = 55; compute(); opts.threshold = 50; compute(); return calls === 0; }
    finally { opts.threshold = threshold; ctx.getImageData = read; }
  }), "Repeated selection adjustments reuse committed brush alpha without canvas readbacks");
  await shot("brush-selection");
  // a background stroke over the dark square: it refines the subject, the square joins the selection
  await rb.locator('[data-btool="bg"]').click();
  ok(await R(() => window.__rb.opts.btool) === "bg", "Background brush chosen");
  await range("size", 40);
  await drag([[0.47, 0.47], [0.53, 0.53]]); await settle();
  [g, w, k] = await selAt([[0.9, 0.1], [0.4, 0.3], [0.5, 0.5]]);
  ok(k > 200 && g === 255 && w === 0, `A background stroke over the dark square takes it away, the rest stays (${g}, ${w}, ${k})`);
  ok(await R(() => window.__rb.R.points.some(p => p.label === 0 && p.stroke)), "…as background points of the same selection");
  ok((await alphaAt([[0.9, 0.1]]))[0] === 255, "Strokes remove nothing from the picture");
  await page.keyboard.press("e"); ok(await R(() => window.__rb.opts.btool) === "fg", "E switches the brush back to Subject");
  await rb.locator("#applyBtn").click(); await settle();
  [g, w, k] = await alphaAt([[0.9, 0.1], [0.4, 0.3], [0.5, 0.5]]);
  ok(g === 0 && w === 255 && k === 0, `Brush + Remove: green and square gone, card kept (${g}, ${w}, ${k})`);

  /* ---------- 5. Before, mask, backgrounds ---------- */
  const hb = await rb.locator("#holdBtn").boundingBox();
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2); await page.mouse.down(); await settle();
  ok(await R(() => window.__rb.cmp.st.x) === 1 && await rb.locator("#beforeTag").isVisible(), "Holding Before shows the original");
  await shot("before");
  await page.mouse.up(); await page.mouse.move(10, 10); await settle();
  ok(await R(() => window.__rb.cmp.st.x) === 0, "Letting go shows the result again");
  await rb.locator("#maskBtn").click(); await settle();
  ok(await R(() => { const x = document.querySelector("#view").getContext("2d").getImageData(5, 5, 1, 1).data; return x[0] === 0 && x[3] === 255; }), "Mask view: the removed background is black");
  await shot("mask");
  await rb.locator("#maskBtn").click();
  await rb.locator('#bgs [data-bg="white"]').click(); await settle();
  ok(await R(() => document.querySelector("#stage").dataset.bg) === "white", "Backdrop: white");
  await shot("backdrop-white");
  // the backdrop as painted on screen, at a removed pixel, through every change (a canvas's own background is not
  // repainted by Chromium when it changes: after black, the checker stayed black)
  if (!functional) {
  const gone = await R(() => { const { R } = window.__rb, p = R.alpha.indexOf(0); return p < 0 ? null : [(p % R.W + 0.5) / R.W, (Math.floor(p / R.W) + 0.5) / R.H]; });
  const screenAt = async () => { const [x, y] = await at(...gone), [ox, oy] = await frameBox(), b = await page.screenshot({ clip: { x: ox + x, y: oy + y, width: 1, height: 1 } });
    return page.evaluate(async b64 => { const i = new Image(); i.src = "data:image/png;base64," + b64; await i.decode(); const c = document.createElement("canvas"); c.width = c.height = 1; const x = c.getContext("2d"); x.drawImage(i, 0, 0); return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3); }, b.toString("base64")); };
  const seen = [];
  for (const bg of ["black", "checker", "white", "black", "checker"]) { await rb.locator(`#bgs [data-bg="${bg}"]`).click(); await settle(); seen.push(bg + " " + (await screenAt()).join(",")); }
  const lum = seen.map(s => +s.split(" ")[1].split(",")[0]);
  ok(gone && lum[0] === 0 && lum[1] > 10 && lum[1] < 60 && lum[2] === 255 && lum[3] === 0 && lum[4] > 10 && lum[4] < 60, "Every backdrop change shows on screen: " + seen.join(" · "));

  } else console.log("SKIP visual pixel captures during functional/manual-review iteration");

  /* ---------- 6. Export ---------- */
  const cuts = () => fs.existsSync(P("Exports", "Cutouts")) ? fs.readdirSync(P("Exports", "Cutouts")) : [];
  const filePixels = (file, pts) => page.evaluate(async ({ b, type, pts }) => {
    const IMG = window.__img, i = await IMG.load(new Blob([Uint8Array.from(atob(b), c => c.charCodeAt(0))], { type }));
    const c = IMG.mk(i.naturalWidth, i.naturalHeight), x = c.getContext("2d"); x.drawImage(i, 0, 0);
    return { w: c.width, h: c.height, px: pts.map(([u, v]) => [...x.getImageData(Math.floor(u * c.width), Math.floor(v * c.height), 1, 1).data]) };
  }, { b: fs.readFileSync(file).toString("base64"), type: /webp$/.test(file) ? "image/webp" : "image/png", pts });
  await rb.locator("#saveBtn").click();
  ok(await until(() => cuts().includes("card (no background).png"), 10000), "Save: PNG in Exports\\Cutouts");
  let px = await filePixels(P("Exports", "Cutouts", "card (no background).png"), [[0.9, 0.1], [0.4, 0.3], [0.5, 0.5]]);
  ok(px.w === 640 && px.h === 480 && px.px[0][3] === 0 && px.px[1][3] === 255 && px.px[1][0] > 180 && px.px[2][3] === 0, "PNG at full size: background and the square taken away transparent, the card opaque and red");
  await rb.locator('#formats [data-format="webp"]').click(); await rb.locator("#saveBtn").click();
  ok(await until(() => cuts().includes("card (no background).webp"), 10000), "Save: WebP");
  px = await filePixels(P("Exports", "Cutouts", "card (no background).webp"), [[0.9, 0.1], [0.4, 0.3]]);
  ok(px.px[0][3] < 10 && px.px[1][3] > 245, "WebP keeps the transparency");
  await rb.locator('#formats [data-format="mask"]').click(); await rb.locator("#saveBtn").click();
  ok(await until(() => cuts().includes("card (mask).png"), 10000), "Save: the mask alone");
  px = await filePixels(P("Exports", "Cutouts", "card (mask).png"), [[0.9, 0.1], [0.4, 0.3]]);
  ok(px.px[0][0] === 0 && px.px[1][0] === 255 && px.px[0][3] === 255, "The mask: black removed, white kept");
  await rb.locator('#formats [data-format="png"]').click();

  // Crop: the result, cropped, is the new picture
  await rb.locator("#cropBtn").click();
  await until(() => page.evaluate(() => document.querySelector("#cropDlg").open), 5000); await painted(page);
  await page.click('#cropRatios [data-ratio="1:1"]'); await painted(page); await page.click("#cropApply");
  ok(await until(async () => (await rb.locator("#inSize").textContent()) === "480×480", 10000), "Crop 1:1: the result becomes a 480×480 picture");
  ok((await alphaAt([[0.02, 0.5]]))[0] === 0 && (await alphaAt([[0.3, 0.5]]))[0] === 255, "The cropped picture keeps its transparency");

  // Send to Upscale
  await rb.locator("#sendBtn").click();
  const menu = rb.locator(".sendmenu:not([hidden])"); await menu.waitFor({ timeout: 5000 });
  const targets = await menu.locator("[data-to]").evaluateAll(b => b.map(x => x.dataset.to));
  ok(targets.includes("upscale") && !targets.includes("removebg"), "Send to… lists Upscale, not itself: " + targets.join(", "));
  await menu.locator('[data-to="upscale"]').click();
  const up = page.frameLocator("#v-upscale");
  ok(await until(async () => (await up.locator("#inSize").textContent()) === "480×480", 15000), "Upscale receives the picture without its background");
  await tab("removebg");

  // Upscale → Remove Background ("Send to…" from another tool)
  const sent = await page.evaluate(async b64 => window.__shell.sendTo("removebg", { kind: "image", name: "sent.png", blob: new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], { type: "image/png" }) }), fs.readFileSync(fx("subject.png")).toString("base64"));
  ok(sent && await until(async () => (await rb.locator("#inName").textContent()) === "sent.png" && (await rb.locator("#inSize").textContent()) === "800×600", 15000), "Another tool sends a picture in");

  ok(!errors.length, "No page errors" + (errors.length ? ": " + errors.join(" / ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `${failures} failed` : "all passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
