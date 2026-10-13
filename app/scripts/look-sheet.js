// Contact sheets of Grade's looks (docs/GRADE_LOOKS_SPEC.md §7.3): one PNG per category, looks × the test set of
// app/tests/fixtures/looks, rendered by Grade itself (__halApp.thumb: the same pipeline as the tiles and the export).
// Usage: node app/scripts/look-sheet.js [category…] [--ids a,b] [--out dir]   (default out: $SHOTS or ./shots)
const fs = require("fs"), path = require("path"), os = require("os");
const TESTS = path.join(__dirname, "..", "tests");
const { serve, launch, openApp } = require(path.join(TESTS, "common")), { createHost } = require(path.join(TESTS, "host"));
const { makeFixtures, toolOptions } = require(path.join(TESTS, "fixtures"));
const SET = path.join(TESTS, "fixtures", "looks");
const IMAGES = ["portrait-day.jpg", "portrait-warm.jpg", "portrait-dark-skin.jpg", "people-street.jpg", "landscape-sky.jpg", "landscape-green.jpg", "night-city.jpg", "interior-dark.jpg", "high-key.jpg", "render.jpg", "cover.png", "saturated.jpg", "near-mono.jpg", "ramps.png"];
const argv = process.argv.slice(2), opt = k => { const i = argv.indexOf(k); return i < 0 ? null : argv.splice(i, 2)[1]; };
const OUT = opt("--out") || process.env.SHOTS || path.join(process.cwd(), "shots"), IDS = (opt("--ids") || "").split(",").filter(Boolean);
const S = 176;

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const fixtures = makeFixtures(), server = serve(), browser = await launch(), host = createHost(fs.mkdtempSync(path.join(os.tmpdir(), "hal-sheet-")), toolOptions(fixtures));
  try {
    const app = await openApp(browser, server, host), page = app.page;
    await app.tab("grade"); await page.evaluate(() => __shell.ensureApp("grade"));
    const f = page.frames().find(x => x.url().endsWith("/grade.html"));
    await f.evaluate(() => __halApp.ready);
    const { CATS2, LOOKS2 } = await f.evaluate(async () => { const m = await import("./grade-looks.js"); return { CATS2: m.CATS2, LOOKS2: m.LOOKS2.map(l => ({ id: l.id, cat: l.cat })) }; });
    const names = await f.evaluate(ids => ids.map(id => t("lk." + id)), LOOKS2.map(l => l.id));
    const cats = argv.length ? argv : CATS2;
    const groups = IDS.length ? [["picked", LOOKS2.filter(l => IDS.includes(l.id))]] : cats.map(c => [c, LOOKS2.filter(l => l.cat === c)]).filter(g => g[1].length);
    // cells[look][image] = data URL; one picture loaded at a time, every look of every sheet rendered on it
    const cells = {};
    for (const img of IMAGES) {
      const bytes = [...fs.readFileSync(path.join(SET, img))];
      await f.evaluate(async ([bytes, name]) => { await __halApp.loadImage(new File([new Uint8Array(bytes)], name, { type: name.endsWith(".png") ? "image/png" : "image/jpeg" })); }, [bytes, img]);
      await f.waitForFunction(() => document.querySelector("#gl").width > 0);
      const ids = ["", ...new Set(groups.flatMap(g => g[1].map(l => l.id)))];
      const urls = await f.evaluate(async ([ids, S]) => {
        const out = [];
        for (const id of ids) out.push(await __halApp.thumb(id ? [{ id: "sheet", type: "look", id0: id, amt: 100, on: true }] : [], S));
        return out;
      }, [ids, S]);
      ids.forEach((id, i) => { (cells[id] = cells[id] || {})[img] = urls[i]; });
    }
    for (const [cat, looks] of groups) {
      const rows = [["", "Original"], ...looks.map(l => [l.id, names[LOOKS2.findIndex(x => x.id === l.id)]])];
      const png = await f.evaluate(async ([rows, cells, images, S, title]) => {
        const lab = 150, pad = 4, top = 30, cv = document.createElement("canvas");
        cv.width = lab + images.length * (S + pad); cv.height = top + rows.length * (S + pad);
        const x = cv.getContext("2d"); x.fillStyle = "#111"; x.fillRect(0, 0, cv.width, cv.height);
        x.fillStyle = "#eee"; x.font = "600 16px sans-serif"; x.fillText(title, 8, 21);
        x.font = "11px sans-serif"; images.forEach((n, i) => x.fillText(n.replace(/\.\w+$/, ""), lab + i * (S + pad), top - 4));
        for (let r = 0; r < rows.length; r++) {
          const [id, name] = rows[r], y = top + r * (S + pad);
          x.fillStyle = "#eee"; x.font = "600 13px sans-serif"; x.fillText(name, 8, y + 18); x.fillStyle = "#888"; x.font = "11px sans-serif"; x.fillText(id, 8, y + 34);
          for (let i = 0; i < images.length; i++) {
            const u = cells[id][images[i]]; if (!u) continue;
            const im = new Image(); im.src = u; await im.decode(); x.drawImage(im, lab + i * (S + pad), y, S, S);
          }
        }
        return cv.toDataURL("image/png");
      }, [rows, Object.fromEntries(rows.map(r => [r[0], cells[r[0]]])), IMAGES, S, cat]);
      const file = path.join(OUT, `looks-${cat}.png`);
      fs.writeFileSync(file, Buffer.from(png.split(",")[1], "base64")); console.log(file);
    }
    if (app.errors.length) { console.error(app.errors); process.exitCode = 1; }
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
