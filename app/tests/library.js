// Library v2 (docs/LIBRARY_SPEC.md §8; services.js → libdata, libpanel.js, library.rs):
// 1. Migration from 0.9.0: favourites and tags by path, the order, a linked folder and the exports list come into
//    the index (Settings\Library\index.json) with nothing lost.
// 2. An export of a tool is in Exports and in Recent in under a second, with its tool and "Made from".
// 3. 200 pictures added from a folder of the PC: no file is written into Documents\Halation (index only).
// 4. A file renamed or moved on the same drive keeps its favourite, tags and uses; a deleted one is Missing and
//    "Locate…" reconnects it.
// 5. Search: prefixes, any order, no accents, typed filters (type:look, is:fav, tool:grade); under 50 ms per
//    keystroke on 20 000 items.
// 6. Favourites mix types and filter by type; the tabs are filters; the detail shows origin and use; the selection
//    bar removes from the Library without touching the files.
// 7. The picker shows only the kinds the tool takes and opens on Recent.
// Screenshots → $SHOTS/library.
// Usage: node app/tests/library.js
const fs = require("fs"), os = require("os"), path = require("path");
const { until, painted, serve, launch, openApp, locale } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const functional = process.argv.includes("--functional");
const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "library");
if (!functional) fs.mkdirSync(SHOTS, { recursive: true });
const FX = makeFixtures(), TOOLS = toolOptions(FX), { L } = locale("en");
const root = fs.mkdtempSync(path.join(FX.TMP, "library-"));
const host = createHost(root, TOOLS);
const B = (...p) => path.join(host.base, ...p);
const cp = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); };

// 0.9.0's data: an own section, a linked folder of the PC, favourites and tags by path, the exports list
const PC = path.join(root, "PC", "Art");
cp(path.join(FX.FIX, "cover.png"), B("Library", "Covers", "cover.png"));
cp(path.join(FX.FIX, "fractal.png"), B("Library", "Covers", "fractal.png"));
cp(path.join(FX.FIX, "sky.png"), path.join(PC, "sky.png"));
cp(path.join(FX.FIX, "sky.png"), B("Exports", "Covers", "sky graded.png"));
fs.mkdirSync(B("Presets", "Grade"), { recursive: true });
fs.writeFileSync(B("Presets", "Grade", "My blue.json"), JSON.stringify({ app: "halation-grade", version: 1, layers: [{ type: "look", id0: "nocturno", on: true, amt: 80 }] }));
fs.mkdirSync(B("Presets", "Visualizer"), { recursive: true });
fs.writeFileSync(B("Presets", "Visualizer", "Blue wave.json"), JSON.stringify({ app: "halation-visualizer", version: 1, settings: { coverSize: 70 } }));
fs.writeFileSync(B("Settings", "app.json"), JSON.stringify({
  settings: { language: "en" },
  library: { order: ["link:" + PC, "fav", "own:Covers"], linked: [{ path: PC, name: "My art" }], favorites: [B("Library", "Covers", "cover.png"), path.join(PC, "sky.png")], tags: { [B("Library", "Covers", "fractal.png")]: ["fractal", "loud"] } },
  exports: [{ path: B("Exports", "Covers", "sky graded.png"), name: "sky graded.png", kind: "image", at: Date.now() - 3600e3, thumb: "" }]
}));
const indexFile = B("Settings", "Library", "index.json");
const index = () => JSON.parse(fs.readFileSync(indexFile, "utf8"));
const walk = d => fs.readdirSync(d).flatMap(n => { const p = path.join(d, n); return fs.statSync(p).isDirectory() ? walk(p) : [p]; });

(async () => {
  const server = serve(), browser = await launch();
  const { page, errors, tab } = await openApp(browser, server, host, { width: 1480, height: 920 });
  const shot = n => functional ? painted(page) : painted(page).then(() => page.screenshot({ path: path.join(SHOTS, n + ".png") }));
  const lib = (fn, arg) => page.evaluate(([f, a]) => new Function("lib", "a", "return (" + f + ")(lib, a)")(window.__shell.library, a), [String(fn), arg]);
  const settle = () => lib(async l => { await l.ready(); await l.sync(); });
  const cards = () => page.locator("#libPanel .libv-card");
  const names = () => page.locator("#libPanel .libv-band").last().locator(".libv-card .libv-meta b").allTextContents();

  /* ---------- 1: migration ---------- */
  await tab("library");
  await settle();
  ok(fs.existsSync(indexFile), "The index is written to Settings\\Library\\index.json");
  const ix = index(), by = n => ix.items.find(i => i.name === n);
  ok(ix.version === 2 && by("cover.png") && by("cover.png").fav && by("sky.png") && by("sky.png").fav, "Migration: favourites by path become favourite items (own section and linked folder)");
  ok(by("fractal.png") && by("fractal.png").tags.join() === "fractal,loud", "Migration: tags follow their item");
  ok(by("sky graded.png") && by("sky graded.png").type === "export", "Migration: the exports list becomes export items");
  ok(by("My blue.json") && by("My blue.json").type === "look" && by("Blue wave.json") && by("Blue wave.json").kind === "preset-visualizer", "Presets and looks are indexed");
  ok(ix.items.every(i => i.fileKey), "Every item keeps its file identity (fileKey)");
  const st = JSON.parse(fs.readFileSync(B("Settings", "app.json"), "utf8"));
  ok(!(st.exports || []).length && st.library.linked.length === 1 && !st.library.favorites, "The old lists are gone; the links stay in the state (library.rs reads them)");
  await until(async () => (await page.locator(".libv-col").count()) >= 3, 5000);
  const cols = await page.locator(".libv-col .nm").allTextContents();
  ok(cols.join("|") === "Favourites|Covers|My art" || cols.join("|") === "My art|Favourites|Covers" || (cols.includes("My art") && cols.includes("Covers")), "Collections: favourites, own and the linked folder with its name: " + cols.join(", "));
  const sky = await page.evaluate(p => window.__shell.fileFromPath(p).then(f => f.size, e => String(e)), path.join(PC, "sky.png"));
  ok(sky === fs.statSync(path.join(PC, "sky.png")).size, "A file of a linked folder opens by its path in the tools (Send to, Recent, sessions): " + sky);
  await shot("1-all");

  /* ---------- 2: an export shows up at once ---------- */
  cp(path.join(FX.FIX, "fractal.png"), B("Exports", "Covers", "fractal graded.png"));
  const src = ix.items.find(i => i.name === "fractal.png").id;
  const t0 = Date.now();
  await page.evaluate(([p, from]) => window.__shell.jobs.submit({ tool: "grade", kind: "export", title: "fractal graded.png", run: async ctx => { ctx.output(p, { kind: "image", from: [from] }); } }).done, [B("Exports", "Covers", "fractal graded.png"), src]);
  const shown = await until(async () => (await page.locator('.libv-band[data-band="recent"] .libv-card', { hasText: "fractal graded" }).count()) === 1, 1000, 20);
  ok(shown, `An export is in Recent in ${Date.now() - t0} ms (< 1 s)`);
  await page.locator('#libNav [data-tab="exports"]').click();
  ok(await until(async () => (await cards().filter({ hasText: "fractal graded" }).count()) === 1), "…and in the Exports tab");
  const exp = cards().filter({ hasText: "fractal graded" }).first();
  ok(await exp.locator(".libv-from").count() === 1, "The card shows the tool it came from");
  await exp.click();
  ok(await until(() => page.locator(".libv-detail").isVisible()), "A click opens the detail");
  const det = await page.locator(".libv-detail").textContent();
  ok(det.includes(L("lib.d.madeFrom")) && det.includes("fractal.png") && det.includes(L("tab.grade")), "Detail: From Grade, Made from fractal.png");
  await page.locator('.libv-detail [data-goto]').click();
  ok(await until(async () => (await page.locator(".libv-detail .libv-d-h b").textContent()) === "fractal.png"), "«Made from» leads to the original");
  await shot("2-exports-detail");

  /* ---------- 3: 200 pictures by reference ---------- */
  const MANY = path.join(root, "PC", "Many");
  fs.mkdirSync(MANY, { recursive: true });
  for (let n = 0; n < 200; n++) fs.copyFileSync(path.join(FX.FIX, n % 2 ? "sky.png" : "cover.png"), path.join(MANY, `pic ${String(n).padStart(3, "0")}.png`));
  const before = walk(host.base).filter(p => !p.startsWith(B("Settings"))).length;
  host.setPickFiles(fs.readdirSync(MANY).map(n => path.join(MANY, n)));
  await page.locator('#libNav [data-tab="all"]').click();
  await page.locator("#libAdd").click();
  ok(await until(async () => (await lib(l => l.query({ text: "pic" }).total)) === 200, 20000, 100), "200 pictures added from the PC");
  ok(walk(host.base).filter(p => !p.startsWith(B("Settings"))).length === before, "…and no file written into Documents\\Halation (only the index)");
  ok(await lib(async l => { const i = l.query({ text: "pic 007" }).items[0]; const u = await l.thumb(i); return !!u; }), "…read where they are (thumbnail of a file outside Halation)");

  /* ---------- 4: renamed, moved, missing, located ---------- */
  const pic = await lib(l => l.query({ text: "pic 010" }).items[0].id);
  await lib(async (l, id) => { await l.setFav([id], true); await l.setTagsOf([id], ["hero", "blue"]); await l.touch(id, "grade"); await l.touch(id, "visualizer"); }, pic);
  fs.mkdirSync(path.join(MANY, "moved"), { recursive: true });
  fs.renameSync(path.join(MANY, "pic 010.png"), path.join(MANY, "moved", "hero shot.png"));
  // the file is followed where the index can look: the folder it was in (and those below)
  await settle();
  const after = await lib((l, id) => l.get(id), pic);
  ok(after && after.path === path.join(MANY, "moved", "hero shot.png") && !after.missing, "Renamed and moved on the same drive: the item follows it: " + (after && after.path));
  ok(after && after.fav && after.tags.join() === "hero,blue" && after.uses === 2 && after.usedIn.grade === 1, "…keeping favourite, tags and uses");
  fs.renameSync(path.join(MANY, "moved", "hero shot.png"), path.join(root, "hero shot.png"));
  await settle();
  ok(await lib((l, id) => l.get(id).missing, pic), "A file gone from where the index can look is Missing");
  await page.locator(".libv-q").fill("is:missing");
  ok(await until(async () => (await cards().count()) === 1 && (await cards().first().getAttribute("class")).includes("missing")), "«is:missing» finds it, drawn as Missing");
  await cards().first().click();
  await shot("4-missing");
  host.setPickFiles([path.join(root, "hero shot.png")]);
  await page.locator('.libv-detail [data-d="locate"]').click();
  ok(await until(async () => !(await lib((l, id) => l.get(id).missing, pic))), "«Locate…» reconnects it");
  ok(await lib((l, id) => { const i = l.get(id); return i.fav && i.tags.length === 2; }, pic), "…with its favourite and tags");
  await page.locator(".libv-q").fill("");

  /* ---------- 5: search ---------- */
  const q = (text, o = {}) => lib((l, a) => l.query(Object.assign({ text: a.text }, a.o)).items.map(i => i.name), { text, o });
  ok((await q("frac"))[0] === "fractal.png", "Prefix: «frac» finds fractal.png first");
  ok((await q("graded sky")).includes("sky graded.png"), "Words in any order: «graded sky»");
  ok((await q("fráctal")).includes("fractal.png"), "No accents: «fráctal»");
  ok((await q("loud")).join() === "fractal.png", "Tags: «loud»");
  ok((await q("type:look")).join() === "My blue.json", "type:look");
  ok((await q("tool:grade")).join() === "fractal graded.png", "tool:grade");
  const favs = await q("is:fav");
  ok(favs.includes("cover.png") && favs.includes("sky.png") && favs.includes("hero shot.png"), "is:fav");
  // favourites mix kinds and filter by type
  await lib(async l => { const lk = l.query({ text: "type:look" }).items[0], pr = l.query({ kinds: ["preset-visualizer"] }).items[0]; await l.setFav([lk.id, pr.id], true); });
  const favKinds = await lib(l => [...new Set(l.query({ fav: true }).items.map(i => i.type))].sort().join());
  ok(favKinds === "asset,look,preset", "Favourites mix a look, a preset and pictures: " + favKinds);
  ok((await lib(l => l.query({ fav: true, kinds: ["look"] }).items.map(i => i.name).join()) === "My blue.json"), "…and filter by type");
  // 20 000 items, measured per keystroke
  const perf = await page.evaluate(() => {
    const l = window.__shell.library, words = ["sunset", "neon", "cover", "grain", "night", "city", "blue", "loop", "final", "draft"];
    const extra = [];
    for (let n = 0; n < 20000; n++) extra.push({ id: "p" + n, type: n % 7 ? "asset" : "export", kind: n % 5 ? "image" : "video", path: "C:\\Art\\" + n + ".png", name: `${words[n % 10]} ${words[(n * 7) % 10]} ${n}.png`, meta: {}, origin: { tool: n % 3 ? null : "grade", from: [] }, usedIn: {}, tags: n % 11 ? [] : ["favourite"], collections: [], uses: n % 4, addedAt: n, usedAt: 0, fav: !(n % 13), missing: false, mtime: n });
    const all = l.__test.inject(extra);
    const times = [];
    for (const s of ["n", "ne", "neo", "neon", "neon c", "neon ci", "neon cit", "neon city", "neon city 1", "type:video neon"]) { const t0 = performance.now(); l.query({ text: s, limit: 120 }); times.push(performance.now() - t0); }
    l.__test.eject(extra);
    return { all, max: Math.max(...times), times };
  });
  ok(perf.all >= 20000 && perf.max < 50, `Search over ${perf.all} items: ${perf.max.toFixed(1)} ms at most per keystroke (< 50 ms): ${perf.times.map(x => x.toFixed(1)).join(" ")}`);

  /* ---------- 6: tabs, UI search, selection ---------- */
  await page.locator('#libNav [data-tab="presets"]').click();
  ok(await until(async () => (await cards().count()) === 2), "Presets & looks: the look and the preset");
  await shot("6-presets");
  await page.locator('#libNav [data-tab="all"]').click();
  await page.keyboard.press("/");
  ok(await page.evaluate(() => document.activeElement.classList.contains("libv-q")), "«/» focuses the search");
  await page.keyboard.type("cover");
  ok(await until(async () => (await page.locator(".libv-band").count()) === 1 && (await cards().first().locator(".libv-meta b").textContent()) === "cover.png"), "Searching shows one grid by relevance");
  await page.locator(".libv-q").fill("");
  await page.locator('.libv-types [data-type="look"]').click();
  ok(await until(async () => (await cards().count()) === 1), "A type chip filters");
  await page.locator('.libv-types [data-type="look"]').click();
  await page.locator(".libv-q").fill("pic 0");
  await until(async () => (await cards().count()) >= 10);
  await cards().nth(0).hover(); await cards().nth(0).locator(".libv-pick input").check();
  await cards().nth(1).locator(".libv-pick input").check();
  ok(await until(() => page.locator(".libv-selbar").isVisible()) && (await page.locator(".libv-selcount").textContent()) === L("lib.selected", { n: 2 }), "Ticking two cards shows the selection bar");
  await shot("6-selection");
  const gone = await cards().nth(0).locator(".libv-meta b").textContent();
  await page.locator('.libv-selbar [data-sel="remove"]').click();
  ok(await until(async () => !(await lib((l, n) => l.query({ text: n }).items.some(i => i.name === n), gone))), "«Remove from Library» takes them off the index");
  ok(fs.existsSync(path.join(MANY, gone)), "…and the files stay where they are");
  await page.locator(".libv-q").fill("");

  /* ---------- 7: the picker ---------- */
  await lib(async l => { const v = l.query({ text: "sky graded" }).items[0]; await l.touch(v.id, "grade"); });
  const picked = page.evaluate(() => window.__shell.pickFromLibrary({ images: true }).then(f => f && f.name));
  ok(await until(() => page.locator("#libPick").isVisible()), "The picker opens");
  await until(async () => (await page.locator("#libPick .libv-card").count()) > 0);
  const pk = await page.locator("#libPick .libv-card .libv-badge").allTextContents();
  ok(pk.length && pk.every(x => x === L("lib.k.image")), "…with pictures only");
  ok((await page.locator("#libPick .libv-card .libv-meta b").first().textContent()) === "sky graded.png" && (await page.locator("#libPick .libv-sort").inputValue()) === "recent", "…opened on Recent (the last used first)");
  await shot("7-picker");
  await page.locator("#libPick .libv-card").first().click();
  ok((await picked) === "sky graded.png", "Choosing one gives it to the tool");

  ok(!errors.length, "No console errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  console.log(failures ? `\n${failures} failed (library)` : "\nAll passed (library)");
  await browser.close(); server.close();
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
