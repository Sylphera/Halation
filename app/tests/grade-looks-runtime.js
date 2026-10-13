// Grade looks at runtime (docs/GRADE_LOOKS_SPEC.md §8, §9): a click replaces the look and + stacks, applying every
// look twice keeps the LUT textures bounded, dragging an adjustment 200 times uploads no LUT, intensity mixes the whole
// look (colour and finish passes), Save as My Look writes a self-contained v2 file, and a removed classic look opens as
// its catalogue replacement.
const fs = require("fs"), path = require("path"), os = require("os"), assert = require("assert/strict");
const { serve, launch, openApp, until } = require("./common"), { createHost } = require("./host"), { makeFixtures, toolOptions } = require("./fixtures");
(async () => {
  const fixtures = makeFixtures(), server = serve(), browser = await launch(), root = fs.mkdtempSync(path.join(os.tmpdir(), "halation-grade-looks-")), host = createHost(root, toolOptions(fixtures));
  try {
    // a personal look saved by the first Grade, naming a classic look that no longer exists
    const grade = path.join(host.base || path.join(root, "Documents", "Halation"), "Presets", "Grade");
    fs.mkdirSync(grade, { recursive: true });
    fs.writeFileSync(path.join(grade, "Old blue.json"), JSON.stringify({ app: "halation-grade", version: 1, layers: [{ type: "look", id0: "nocturno", on: true, amt: 80 }] }));
    const context = await browser.newContext({ reducedMotion: "reduce" });
    await context.addInitScript(() => {
      const p = WebGL2RenderingContext.prototype, create = p.createTexture, del = p.deleteTexture, up3 = p.texImage3D;
      const probe = window.__lookProbe = { textures: new Set(), uploads3d: 0, painted: 0 };
      const put = CanvasRenderingContext2D.prototype.putImageData; CanvasRenderingContext2D.prototype.putImageData = function (...a) { if (this.canvas.id.startsWith("th-")) probe.painted++; return put.apply(this, a); };
      p.createTexture = function (...a) { const t = create.apply(this, a); probe.textures.add(t); return t; };
      p.deleteTexture = function (t) { probe.textures.delete(t); return del.call(this, t); };
      p.texImage3D = function (...a) { probe.uploads3d++; return up3.apply(this, a); };
    });
    const app = await openApp({ newPage: async o => { const p = await context.newPage(); await p.setViewportSize(o.viewport); return p; } }, server, host), page = app.page;
    await app.tab("grade"); await page.evaluate(() => __shell.ensureApp("grade"));
    const f = page.frames().find(x => x.url().endsWith("/grade.html"));
    await f.locator("#imgIn").setInputFiles(path.join(__dirname, "fixtures", "looks", "portrait-day.jpg"));
    await f.waitForFunction(() => document.querySelector("#gl").width > 0 && document.querySelectorAll('[id^="tw-"].skel').length === 0, null, { timeout: 30000 });
    const layers = () => f.locator("#listF .layer").evaluateAll(r => r.map(x => x.querySelector(".lname").textContent.trim()));
    const L = id => f.evaluate(id => t("lk." + id), id);

    // a click on the picture replaces the look, + stacks
    await f.locator('.tile[data-look="nordic"]').click();
    await f.locator('.tile[data-look="cine-teal"]').click();
    assert.deepEqual(await layers(), [await L("cine-teal")], "A tile click replaces the look");
    await f.locator('.tile[data-look="slide"] [data-tact=add]').click();
    assert.deepEqual(await layers(), [await L("slide"), await L("cine-teal")], "+ stacks a second look");

    // a removed classic look opens as its closest catalogue look
    await f.evaluate(() => __halApp.applyPreset("Old blue"));
    assert.deepEqual(await layers(), [await L("midnight")], "A classic look in saved work opens as its catalogue replacement");

    // every look applied twice: LUT textures stay bounded (LRU cache) and the second pass adds none
    await f.evaluate(() => __halApp.flush && __halApp.flush());
    const ids = await f.locator(".tile[data-look]").evaluateAll(ts => ts.map(t => t.dataset.look));
    const cycle = async () => { for (const id of ids) { await f.locator(`.tile[data-look="${id}"]`).click(); await f.evaluate(() => new Promise(r => requestAnimationFrame(() => r()))); } };
    // counted once the thumbnails and render targets in flight have settled
    const settled = async () => { let last = -1, n = await f.evaluate(() => __lookProbe.textures.size); while (n !== last) { last = n; await page.waitForTimeout(1500); n = await f.evaluate(() => __lookProbe.textures.size); } return n; };
    const before = await settled();
    await cycle(); const afterFirst = await settled();
    await cycle(); const afterSecond = await settled();
    console.log(`textures before: ${before}, after applying ${ids.length} looks: ${afterFirst}, after a second pass: ${afterSecond}`);
    // the LUT cache keeps LUT_KEEP (24) looks
    assert(Math.max(afterFirst, afterSecond) - before <= 24 + 8, "Applying every look twice keeps the LUT textures bounded");

    // dragging an adjustment 200 times uploads no LUT (the adjustments are uniforms)
    await f.locator("#listF .layer").first().locator(".lname").click();
    const warmth = f.locator("#listF .layer").first().locator("input[type=range][data-k=warmth]");
    await warmth.waitFor();
    // let the thumbnails of the last pass finish first (they may build LUTs the cache dropped)
    const busy = () => f.evaluate(() => __lookProbe.uploads3d + ":" + __lookProbe.painted);
    for (let last = "", n = await busy(); n !== last; ) { last = n; await page.waitForTimeout(2000); n = await busy(); }
    const uploads = await f.evaluate(() => __lookProbe.uploads3d), tex = await f.evaluate(() => __lookProbe.textures.size);
    await warmth.evaluate(async e => {
      for (let i = 0; i < 200; i++) { e.value = String(Math.round(Math.sin(i / 9) * 80)); e.dispatchEvent(new Event("input", { bubbles: true })); if (i % 10 === 0) await new Promise(r => requestAnimationFrame(() => r())); }
      e.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.waitForTimeout(400);
    assert.equal(await f.evaluate(() => __lookProbe.uploads3d), uploads, "Dragging an adjustment uploads no LUT");
    assert(await f.evaluate(() => __lookProbe.textures.size) <= tex, "Dragging an adjustment creates no texture");

    // intensity mixes the whole look: 50 % = mix(original, look at 100 %, 0.5), finish passes included
    const px = await f.evaluate(async () => {
      const shot = async amt => {
        const url = await __halApp.thumb(amt ? [{ id: "mix", type: "look", id0: "tungsten", amt, on: true }] : [], 128, "image/png");
        const im = new Image(); im.src = url; await im.decode();
        const c = new OffscreenCanvas(128, 128), x = c.getContext("2d"); x.drawImage(im, 0, 0); return [...x.getImageData(0, 0, 128, 128).data];
      };
      return [await shot(0), await shot(100), await shot(50)];
    });
    let worst = 0;
    for (let i = 0; i < px[0].length; i++) if (i % 4 !== 3) worst = Math.max(worst, Math.abs(px[2][i] - (px[0][i] + (px[1][i] - px[0][i]) * 0.5)));
    console.log(`intensity 50 %: worst difference from the mix ${worst.toFixed(2)} / 255`);
    assert(worst <= 1.5, "Intensity 50 % is the mix of the original and the full look (colour, halation and grain)");

    // Save as My Look: a v2 file with its own copy of the look, listed under My Looks
    const row = f.locator("#listF .layer").first();
    await row.locator("[data-act=mlname]").fill("Warm test");
    await row.locator("[data-act=mlsave]").click();
    const file = path.join(grade, "Warm test.json");
    await f.waitForFunction(() => document.querySelector('.tile[data-key="u:Warm test"]'));
    await f.evaluate(() => __halApp.flush());   // the library writes its files a moment later
    assert(await until(() => fs.existsSync(file), 5000), "Save as My Look writes Presets/Grade/<name>.json");
    const saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(saved.version, 2); assert.equal(saved.kind, "look");
    assert(saved.layers.length === 1 && saved.layers[0].def && saved.layers[0].def.color, "The personal look carries its definition");
    await f.locator("[data-fsub=mine]").click();
    assert(await f.locator('.tile[data-key="u:Warm test"]').isVisible(), "My Looks shows the saved look");
    assert.deepEqual(app.errors, []);
    console.log("PASS looks replace/stack, bounded LUT textures, adjustments without LUT uploads, whole-look intensity, My Looks v2");
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
