// Halation tests in headless Chromium (WebGL2 through SwiftShader) with the mocked backend from host.js.
// Usage: node app/tests/run.js [--lang en|es] [phase…]   (1 empty start … 11 home, 12 grade layers)   (no phases: all). Screenshots go to $SHOTS/<lang>.
// Expected texts come from dist/locales, so the same flows run in every language.
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { sleep, until, painted, locale, serve, launch, openApp } = require("./common");
const { createHost } = require("./host");

const argv = process.argv.slice(2);
const li = argv.indexOf("--lang");
const LANG = li >= 0 ? argv.splice(li, 2)[1] : "en";
const ONLY = argv;
const want = n => !ONLY.length || ONLY.includes(String(n));
const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), LANG);
fs.mkdirSync(SHOTS, { recursive: true });
const { L, RX } = locale(LANG);

let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };

/* ---------- fixtures ---------- */
const { makeFixtures, toolOptions } = require("./fixtures");
const { TMP, FIX, MEDIA } = makeFixtures();
const TOOLS = toolOptions({ TMP, MEDIA });
const FONT = ["/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf", "/usr/share/fonts/truetype/freefont/FreeSans.ttf"].find(f => fs.existsSync(f));

/* ---------- starting data in Documents\Halation ---------- */
const host = createHost(TMP, { tools: TOOLS.tools });
const P = (...p) => path.join(host.base, ...p);
const wjson = (p, o) => fs.writeFileSync(p, JSON.stringify(o, null, 2));
wjson(P("Presets", "Visualizer", "Blue wave.json"), { app: "halation-visualizer", version: 1, settings: { coverSize: 70, bgBlur: 80 } });
wjson(P("Presets", "Visualizer", "Manual.json"), { bgBlur: 100 });
wjson(P("Presets", "Grade", "My blue.json"), { app: "halation-grade", version: 1, layers: [{ type: "look", id0: "nocturno", on: true, amt: 80 }] });
wjson(P("Settings", "app.json"), {
  settings: { language: LANG },
  visualizer: { current: { coverSize: 61, artist: "Nova" }, fonts: [], updatedAt: 1000 },
  grade: { previewPct: 60, current: { layers: [], crop: { aspect: "orig", x: 0, y: 0 } }, updatedAt: 1000 },
  migrated: { at: 1, from: ["C:\\Users\\x\\Documents\\Old"], presets: 2, looks: 1, resources: 1, exports: 0 }
});
if (FONT) fs.copyFileSync(FONT, P("Resources", "Fonts", "MyFont.ttf"));
const appState = () => JSON.parse(fs.readFileSync(P("Settings", "app.json"), "utf8"));
const presetFiles = kind => fs.readdirSync(P("Presets", kind)).filter(f => f.endsWith(".json")).map(f => f.slice(0, -5)).sort();

const server = serve();

(async () => {
  const browser = await launch();
  const requests = [];
  const app = await openApp(browser, server, host, { onRequest: u => requests.push(u) });
  const { page, errors, vis, grade, tab, appReady } = app;
  const shot = name => page.screenshot({ path: path.join(SHOTS, name + ".png") });
  const ctx = { ...app, host, shot, P, FIX, MEDIA, TOOLS, appState, presetFiles, wjson, L, RX, LANG, browser, server, painted };
  console.log(`--- language: ${LANG} ---`);

  ok(await page.evaluate(() => document.documentElement.lang) === LANG, "The saved language is applied: " + LANG);
  ok(await page.locator(".rail .tab[data-tab=settings]").getAttribute("aria-label") === L("tab.settings") && await page.locator("#pageTitle").textContent() === L("tab.home"), "Sidebar and title are translated; the app opens on Home");
  await tab("visualizer"); await appReady("visualizer");

  /* ================= 1: clean start, empty states ================= */
  if (want(1)) {
    const vFrame = app.vFrame();
    ok(await vis.locator("#emptyStage").isVisible() && await vis.locator("#emptyStage b").textContent() === L("vis.empty.title"), "Visualizer starts empty with the drop zone: " + L("vis.empty.title"));
    ok(await vis.locator("#exportBtn").isDisabled() && await vis.locator("#play").isDisabled() && await vis.locator("#seek").isDisabled() && await vis.locator("#fsBtn").isDisabled(), "Visualizer: export, play, timeline and fullscreen disabled until something is loaded");
    ok(await vis.locator("#audName").textContent() === L("vis.noAudio") && await vis.locator("#artName").textContent() === L("vis.noCover"), "Visualizer: no sample audio or cover");
    ok(await vFrame.evaluate(() => typeof window.__halApp === "object" && !document.querySelector("#sampleTag")), "No sample tag in the Visualizer");
    await tab("grade"); await appReady("grade");
    ok(await grade.locator("#emptyStage").isVisible() && await grade.locator("#emptyStage b").textContent() === L("grade.empty.title"), "Grade starts empty with the drop zone: " + L("grade.empty.title"));
    ok(await grade.locator("#exportBtn").isDisabled() && await grade.locator("#sendBtn").isDisabled(), "Grade: export and send buttons disabled without an image");
    ok(await grade.locator("#imgName").textContent() === L("grade.noImage"), "Grade: no sample image");
    await grade.locator("#linkBtn").click();
    ok(await until(() => page.evaluate(() => document.querySelector("#v-downloader").classList.contains("on"))), "«Download from link» opens the Downloader");
    const allowed = /^\/(index\.html|shell\.(js|css)|services\.js|modules\.js|bass\.js|grader\.js|tokens\.css|ui\.css|i18n\.js|common\.js|icons\.js|shim\.js|fontpicker\.js|mediabunny\.js|avplay\.js|motion\.js|gsap\.min\.js|Flip\.min\.js|atmosphere\.js|auralis\.js|blue-noise\.js|jobs\.js|processes\.js|profile\.js|encoder\.js|visualizer\.(html|css|js)|grade\.(html|css|js)|downloader\.(html|css|js)|spotify\.js|upscale\.js|upscale\.(html|css)|imgops\.js|compare\.js|media\.css|libpanel\.(css|js)|favicon\.ico|locales\/(en|es)\.json|img\/halation-(icon|mark|logo-horizontal)\.svg|fonts\/[\w.-]+\.(css|woff2))?$/;
    const odd = requests.filter(u => { const x = new URL(u); return x.protocol !== "blob:" && x.protocol !== "data:" && (x.hostname !== "localhost" || !allowed.test(x.pathname)); });
    ok(odd.length === 0 && !requests.some(u => /sample|demo|example/i.test(u)), `Clean start: only the app's own files are loaded (${requests.length} requests)` + (odd.length ? ": " + odd.join(", ") : ""));
    await shot("1a-downloader-empty");
    await tab("visualizer");
  }

  /* ================= 2: presets as files, font picker, Library ================= */
  if (want(2)) {
    await vis.locator("summary", { hasText: L("vis.saved") }).click();
    const names = await vis.locator("#presetList .item b").allTextContents();
    ok(names.includes("Blue wave") && names.includes("Manual"), "Visualizer reads presets from Presets\\Visualizer: " + names.join(", "));
    ok(await vis.locator("#f-coverSize").inputValue() === "61", "Visualizer restores its state from app.json");

    await vis.locator("#presetName").fill("Night: 1");
    await vis.locator("#presetSave").click();
    ok(await until(() => presetFiles("Visualizer").includes("Night- 1")), "Saving a preset creates «Night- 1.json» (valid Windows name)");
    const saved = JSON.parse(fs.readFileSync(P("Presets", "Visualizer", "Night- 1.json"), "utf8"));
    ok(saved.app === "halation-visualizer" && saved.settings.coverSize === 61, "The preset file is readable JSON with its settings");
    const del = vis.locator("#presetList .item", { hasText: "Manual" }).locator("[data-del]");
    await del.click(); await del.click();
    ok(await until(() => !presetFiles("Visualizer").includes("Manual")), "Deleting a preset deletes its file");
    await vis.locator("#presetList .item", { hasText: "Blue wave" }).locator("[data-apply]").click();
    ok(await vis.locator("#f-coverSize").inputValue() === "70", "Applying a preset read from a file");

    wjson(P("Presets", "Visualizer", "Copied by hand.json"), { app: "halation-visualizer", version: 1, settings: { coverSize: 40 } });
    ok(await until(async () => (await vis.locator("#presetList .item b").allTextContents()).includes("Copied by hand"), 9000), "A .json copied by hand shows up without restarting");

    // font picker
    await vis.locator("#sec-text > summary").click();
    await vis.locator("#f-title").fill("Neon nights");
    await vis.locator("#f-title").dispatchEvent("input");
    await vis.locator("#f-titleFont-fp").click();
    const popV = vis.locator(".fp-pop");
    await popV.waitFor(); await until(async () => (await popV.locator(".fp-row").count()) > 5, 5000, 20); await painted(app.vFrame());
    const heads = await popV.locator(".fp-h").allTextContents();
    ok(heads.includes(L("fonts.builtin")) && heads.includes(L("fonts.uploaded")), "Picker: Included and Uploaded groups: " + heads.join(", "));
    const rows = await popV.locator(".fp-row").count();
    ok(rows > 5 && rows < 60, `Picker is virtualized: ${rows} rows painted out of 330+ fonts`);
    ok((await popV.locator(".fp-sample b").textContent()) === "Neon nights", "The sample uses the real title");
    await popV.locator(".fp-row", { hasText: "Syne" }).first().hover();
    const sampleFont = await popV.locator(".fp-sample b").evaluate(e => e.style.fontFamily);
    ok(/Syne/.test(sampleFont), "Hovering changes the sample font: " + sampleFont);
    await popV.locator(".fp-search").fill("fake font 31");
    const found = await popV.locator(".fp-row .fp-name").allTextContents();
    ok(found.length > 0 && found.every(n => /Fake Font 31/.test(n)), "Search filters: " + found.slice(0, 3).join(", "));
    await popV.locator(".fp-search").fill("");
    await popV.locator(".fp-row", { hasText: "Cinzel" }).first().locator(".fp-star").click();
    ok(await until(() => (appState().fontFavorites || []).includes("Cinzel")), "Favorite saved in Settings\\app.json");
    ok((await popV.locator(".fp-h").first().textContent()) === L("fonts.favorites"), "Favorites come first");
    await shot("2a-font-picker");
    await popV.locator(".fp-search").fill("myfont");
    await popV.locator(".fp-row", { hasText: "MyFont" }).first().click();
    ok(await vis.locator("#f-titleFont").inputValue() === "u:MyFont", "Picking an uploaded font applies it to the title");
    ok(/MyFont/.test(await vis.locator("#f-titleFont-fp").textContent()), "The button shows the chosen font");

    // Grade: text layer with the same picker
    await tab("grade"); await appReady("grade");
    await grade.locator("#imgIn").setInputFiles(path.join(FIX, "cover.png"));
    await until(async () => /cover\.png/.test(await grade.locator("#imgName").textContent()));
    await grade.locator(".tab[data-tab=tools]").click();
    await grade.locator(".acc > summary", { hasText: L("grade.grp.finish") }).click();
    await grade.locator('.tool[data-key="text"] > summary').click();
    await grade.locator('.tool[data-key="text"] .fp-btn').click();
    const popG = grade.locator(".fp-pop"); await popG.waitFor(); await until(async () => (await popG.locator(".fp-row").count()) > 0, 5000, 20); await painted(app.gFrame());
    const gh = await popG.locator(".fp-h").allTextContents();
    ok(gh[0] === L("fonts.favorites") && gh.includes(L("fonts.uploaded")), "Grade: same picker with shared favorites: " + gh.join(", "));
    ok((await popG.locator(".fp-sample b").textContent()) === L("grade.textDefault"), "Grade: the sample uses the layer text");
    await popG.locator(".fp-search").fill("dejavu serif");
    ok((await popG.locator(".fp-h").allTextContents()).includes(L("fonts.system")), "Grade: includes the PC's fonts");
    await popG.locator(".fp-row").first().click();
    ok(await grade.locator('.tool[data-key="text"] select[data-k="font"]').inputValue() === "DejaVu Serif", "Grade: choosing a system font");
    await grade.locator('.tool[data-key="text"] [data-dact="add"]').click();
    ok(await grade.locator("#listE .layer").count() === 1, "Grade: text layer added");
    await shot("2b-grade-text");

    // Library: presets and looks under their tab (libpanel.js); rename, duplicate and delete from a card's menu
    await tab("library");
    await page.locator('#libNav [data-tab="presets"]').click();
    const pcard = n => page.locator("#libPanel .libv-card", { has: page.locator(`.libv-meta b[title="${n}"]`) });
    const pmenu = async (n, act) => { await pcard(n).first().click({ button: "right" }); await page.locator(`.libv-menu [data-mi="${act}"]`).click(); };
    await until(async () => (await page.locator("#libPanel .libv-card").count()) >= 4, 8000);
    const libNames = await page.locator("#libPanel .libv-card .libv-meta b").allTextContents();
    ok(libNames.includes("Blue wave") && libNames.includes("Night- 1") && libNames.includes("Copied by hand"), "Library lists the presets: " + libNames.join(", "));
    ok(await until(async () => await pcard("My blue").first().locator("img:not([hidden])").count() === 1, 15000), "Library: look thumbnail rendered by Grade");
    await shot("2c-library");
    await pmenu("Copied by hand", "rename");
    await page.locator("#mInput").fill("Bad/name");
    ok(await page.locator("#mOk").isDisabled() && await page.locator("#mErr").textContent() === L("lib.err.chars"), "Rename: a name with / is rejected");
    await page.locator("#mInput").fill("Vertical shorts");
    await page.locator("#mInput").press("Enter");
    ok(await until(() => presetFiles("Visualizer").includes("Vertical shorts") && !presetFiles("Visualizer").includes("Copied by hand")), "Rename changes the file name");
    ok(await until(async () => (await vis.locator("#presetList .item b").allTextContents()).includes("Vertical shorts")), "The Visualizer sees the new name");
    ok(await until(async () => await pcard("Vertical shorts").count() === 1), "…and the Library too");
    await pmenu("Blue wave", "dup");
    const copy = L("lib.copyName", { name: "Blue wave" });
    ok(await until(() => presetFiles("Visualizer").includes(copy)), `Duplicate creates «${copy}.json»`);
    await until(async () => await pcard(copy).count() === 1);
    await pmenu(copy, "del");
    await shot("2d-confirm-delete");
    await page.locator("#mOk").click();
    ok(await until(() => !presetFiles("Visualizer").includes(copy)), "Delete from the Library with confirmation");
    await pcard("My blue").first().dblclick();
    ok(await until(async () => await page.evaluate(() => document.querySelector("#v-grade").classList.contains("on")) && (await grade.locator("#listF .layer").count()) === 1), "Applying a look from the Library opens Grade with its layers");
    await tab("visualizer");
    ok(await vis.locator("#f-title").inputValue() === "Neon nights", "The Visualizer keeps its state when coming back");
  }

  await require("./flows").run(ctx, want, ok, until, sleep);

  await tab("settings"); await shot("9-settings");
  await tab("library"); await painted(page); await shot("9-library");
  const missing = await page.evaluate(() => [...window.__i18n.missing]);
  ok(missing.length === 0, "Every key used exists in en.json" + (missing.length ? ": " + missing.join(", ") : ""));
  const errs = errors.filter(e => !/favicon/.test(e));
  ok(errs.length === 0, "No console errors" + (errs.length ? ":\n  " + errs.join("\n  ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed (${LANG})` : `\nAll passed (${LANG})`);
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
