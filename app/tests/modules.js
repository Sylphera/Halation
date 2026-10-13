// Settings → Modules and Storage, over the mocked backend.
// Storage: sizes of known test files (app, caches, the user's content apart and not in the total); "Clear cache"
// asks, then empties the caches and leaves the user's content alone.
// Modules: turning a tool off removes it from the rail, Home and the Ctrl+number shortcuts without reloading, and
// turning it on brings it back; a tool that needs a missing component says so and installs it; a downloaded
// component is removed and reinstalled.
// Usage: node app/tests/modules.js   Screenshots go to $SHOTS/modules.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { until, painted, serve, launch, openApp, locale } = require("./common");
const { newHost } = require("./scan");

const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "modules");
fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };

(async () => {
  const server = serve(), browser = await launch();
  const { host, P } = newHost("en");
  const { L } = locale("en");
  const put = (bytes, ...p) => { fs.mkdirSync(P(...p.slice(0, -1)), { recursive: true }); fs.writeFileSync(P(...p), Buffer.alloc(bytes)); };
  const sizeIn = d => fs.readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? sizeIn(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0);
  fs.mkdirSync(host.localDir("workspace", "temp", "loose"), { recursive: true }); fs.writeFileSync(host.localDir("workspace", "temp", "loose") + "/frame.raw", Buffer.alloc(1000));
  put(300, "Tools", "yt-dlp.part");
  put(2000, "Settings", "Recent", "old.png");
  put(5000, "Exports", "Videos", "mine.mp4");
  put(70000, "Downloads", "Audio", "song.mp3");
  const presets = sizeIn(P("Presets"));
  host.setAppSize(900000);
  const app = await openApp(browser, server, host, { width: 1480, height: 1000 });
  const { page } = app;
  await page.evaluate(() => { window.__noReload = 1; });
  const fmt = n => page.evaluate(n => window.__shell.fmtBytes(n), n);
  const rowSize = (list, i) => page.locator(`${list} .row`).nth(i).locator(".size").textContent();
  const confirm = async () => { await until(() => page.locator("#modal").isVisible()); await page.locator("#mOk").click(); await until(() => page.locator("#modal").isHidden(), 5000, 20); await painted(page); };

  /* ---------- Storage ---------- */
  await app.tab("settings");
  await until(async () => (await page.locator("#storageApp .row").count()) >= 4);
  ok(await rowSize("#storageApp", 0) === await fmt(900000), "Storage: the app, " + await rowSize("#storageApp", 0));
  const caches = await page.$$eval("#storageApp .row", r => r.slice(-9).map(x => x.querySelector(".size").textContent));
  ok(JSON.stringify(caches) === JSON.stringify([await fmt(1000), await fmt(0), await fmt(0), await fmt(0), await fmt(0), await fmt(0), await fmt(300), await fmt(2000), await fmt(0)]), "Storage: the jobs' work folders, the workspace areas (frames, masks, thumbnails, media details, previews), unfinished downloads, recent copies, Cover Test feed: " + caches.join(", "));
  ok(await page.locator("#setBudget").inputValue() === "8192", "Storage: the workspace budget, 8 GB by default");
  const user = await page.$$eval("#storageUser .row", r => r.map(x => x.querySelector(".size").textContent));
  ok(JSON.stringify(user) === JSON.stringify([await fmt(presets), await fmt(0), await fmt(0), await fmt(5000), await fmt(70000), await fmt(0)]), "Storage: the user's presets, projects, library, exports, downloads and resources apart: " + user.join(", "));
  const total = await page.locator("#storageTotal").textContent();
  ok(total === L("set.st.total", { size: await fmt(903300) }), "Storage: the total counts the app and caches, not the user's content: " + total);
  await page.locator("#sg-storage").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "storage.png") });
  await page.locator("#clearCache").click(); await confirm();
  ok(await until(() => !fs.existsSync(path.join(host.localDir("workspace", "temp"), "loose", "frame.raw")) && !fs.existsSync(P("Tools", "yt-dlp.part")) && !fs.existsSync(P("Settings", "Recent", "old.png"))), "Clear cache: after confirming, the caches are emptied");
  ok(fs.existsSync(P("Exports", "Videos", "mine.mp4")) && fs.existsSync(P("Downloads", "Audio", "song.mp3")) && sizeIn(P("Presets")) === presets, "Clear cache: the user's content stays");
  ok(await until(() => page.locator("#clearCache").isDisabled()), "Clear cache: the button turns off with nothing left to clear");
  ok(/3\.3 kB/.test(await page.locator("#toast").textContent()), "Clear cache: the toast says what was freed: " + await page.locator("#toast").textContent());

  /* ---------- Modules: off and on without reloading ---------- */
  const rail = () => page.$$eval(".rail .tab[data-tab]", t => t.map(x => x.dataset.tab));
  const cards = () => page.$$eval("#hcards [data-go]", c => c.map(x => x.dataset.go));
  const railBefore = await rail(), cardsBefore = await cards();
  ok(railBefore.includes("downloader") && cardsBefore.includes("downloader"), "Downloader on the rail and on Home: " + railBefore.join(", "));
  await page.locator('#modules [data-mod="downloader"]').uncheck(); await until(async () => !(await rail()).includes("downloader"), 5000, 20); await painted(page);
  ok(!(await rail()).includes("downloader") && !(await cards()).includes("downloader"), "Turned off: the Downloader leaves the rail and Home at once: " + (await rail()).join(", "));
  ok((host.readState ? host.readState() : JSON.parse(fs.readFileSync(P("Settings", "app.json"), "utf8"))).settings.modules.downloader === false, "Turned off: saved in app.json (settings.modules)");
  await page.keyboard.press("Control+2");
  await until(() => page.evaluate(() => document.querySelector("#v-convert").classList.contains("on")), 5000, 20);
  ok(await page.evaluate(() => document.querySelector("#v-convert").classList.contains("on")), "Shortcuts renumber: Ctrl+2 is now the Converter");
  await app.tab("settings");
  await page.locator('#modules [data-mod="grade"]').uncheck(); await until(async () => !(await rail()).includes("grade"), 5000, 20); await painted(page);
  await app.tab("home");
  await page.evaluate(() => { const f = new File([new Uint8Array(8)], "a.png", { type: "image/png" }); window.__shell.dropped([f], 300, 300); });
  await until(() => page.locator("#homeChoice").isVisible(), 5000, 20); await painted(page);
  const items = await page.$$eval("#homeChoice [data-to]:not([data-to=cancel])", b => b.filter(x => !x.hidden).map(x => x.dataset.to));
  ok(JSON.stringify(items) === JSON.stringify(["upscale", "cover", "cutout"]), "One dropped image: the drop zone leaves out the tools turned off (Cutout is a service, not a tab): " + items.join(", "));
  await page.keyboard.press("Escape");
  await page.evaluate(() => { const f = n => new File([new Uint8Array(8)], n, { type: "image/png" }); window.__shell.routeFiles([f("a.png"), f("b.png")]); });
  await until(async () => (await page.locator("#toast").textContent()) === L("shell.moduleOff", { name: L("tab.grade") }), 5000, 20);
  ok(await page.evaluate(() => document.querySelector("#v-home").classList.contains("on")) && (await page.locator("#toast").textContent()) === L("shell.moduleOff", { name: L("tab.grade") }), "Images for Grade while it is off: a message, nothing opens");
  await app.tab("settings");
  await page.locator('#modules [data-mod="grade"]').check(); await until(async () => (await rail()).includes("grade"), 5000, 20); await painted(page);
  ok(await page.locator('#modules [data-key="home"] .badge-info').count() === 1 && await page.locator('#modules [data-key="settings"] [data-mod]').count() === 0, "Home and Settings cannot be turned off");
  await page.locator('#modules [data-mod="downloader"]').check(); await until(async () => JSON.stringify(await rail()) === JSON.stringify(railBefore), 5000, 20); await painted(page);
  ok(JSON.stringify(await rail()) === JSON.stringify(railBefore) && JSON.stringify(await cards()) === JSON.stringify(cardsBefore), "Turned on again: back in its place on the rail and Home");
  ok(await page.evaluate(() => window.__noReload === 1), "Nothing reloaded");

  /* ---------- Components: missing, install, remove, reinstall ---------- */
  const need = () => page.locator('#modules [data-key="downloader"] .need');
  ok(await need().count() === 1 && /yt-dlp/.test(await need().textContent()), "The Downloader warns that yt-dlp and FFmpeg are missing: " + (await need().count() ? await need().textContent() : "no warning"));
  await page.locator("#sg-tools").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, "modules-missing.png") });
  await need().locator("button").click();
  ok(await until(async () => (await need().count()) === 0, 60000), "Install from the warning: both components download and the warning goes");
  ok(fs.existsSync(P("Tools", "yt-dlp")) && fs.existsSync(P("Tools", "ffmpeg", "ffmpeg")), "Installed in Documents\\Halation\\Tools");
  const ffRow = () => page.locator('#tools .row[data-key="ffmpeg"]');
  ok(await until(async () => await ffRow().locator("[data-rm]").count() === 1), "FFmpeg row: downloaded copy with its size and Remove: " + await ffRow().locator(".size").textContent());
  ok(await ffRow().locator(".size").textContent() === await fmt(sizeIn(P("Tools", "ffmpeg"))), "FFmpeg row: size of the copy on disk");
  ok(/MB/.test(await page.locator("#storageTotal").textContent()) && await page.locator("#storageApp .row").count() === 12, "Storage lists the downloaded components: " + await page.locator("#storageTotal").textContent());
  await page.screenshot({ path: path.join(SHOTS, "modules-installed.png") });
  await ffRow().locator("[data-rm]").click(); await confirm();
  ok(await until(() => !fs.existsSync(P("Tools", "ffmpeg"))), "Remove FFmpeg: its folder is deleted");
  ok(await until(async () => await ffRow().locator("[data-inst]").count() === 1) && await need().count() === 1 && /FFmpeg/.test(await need().textContent()), "Removed: the row offers Install and the Downloader warns again");
  await ffRow().locator("[data-inst]").click();
  ok(await until(async () => await ffRow().locator("[data-rm]").count() === 1, 60000) && await need().count() === 0, "Reinstall FFmpeg from its row");
  ok(fs.existsSync(P("Tools", "ffmpeg", "ffmpeg")), "Reinstalled on disk");
  ok(!app.errors.length, "No console errors" + (app.errors.length ? " — " + app.errors.slice(0, 3).join(" | ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed (modules)` : "\nAll passed (modules)");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
