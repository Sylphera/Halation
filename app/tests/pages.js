// The first start (the artist name, then the profiles found, yes or no) and Settings and Library over the mocked backend, used as a person would: the tabs at the top of each page (a click
// scrolls to a section, the one in view is selected), Settings' language and Restore defaults, the Library's exports (filter,
// select all, clear, remove from the list, cut out the images ticked), and Select all on Grade's layers.
// Usage: node app/tests/pages.js   Screenshots go to $SHOTS/pages.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { until, painted, serve, launch, openApp, locale } = require("./common");
const { newHost, FX } = require("./scan");
const { createHost } = require("./host");

const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "pages");
fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };

(async () => {
  const server = serve(), browser = await launch();
  const { host, P } = newHost("en");
  const { L } = locale("en");
  const app = await openApp(browser, server, host, { width: 1480, height: 900 });
  const { page, errors, tab, appReady, grade } = app;
  const current = nav => page.$$eval(nav + ' [aria-selected="true"]', b => b.map(x => x.dataset.sec));
  const settings = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__shell.st.settings)));

  /* ---------- the first start: only the artist name, then "Are these yours?" ---------- */
  {
    const bing = q => "https://www.bing.com/search?format=rss&q=" + encodeURIComponent(q), ddg = q => "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q);
    const rss = items => `<?xml version="1.0"?><rss><channel>${items.map(([u, ti]) => `<item><title>${ti}</title><link>${u}</link></item>`).join("")}</channel></rss>`;
    const web = {
      // YouTube: a video first (not a profile), then the channel
      [bing("Nova site:youtube.com")]: rss([["https://www.youtube.com/watch?v=abc", "Nova - Live"], ["https://www.youtube.com/@novamusic", "Nova - YouTube"]]),
      // Spotify: Bing gives nothing, DuckDuckGo finds it
      [bing("Nova site:open.spotify.com/artist")]: rss([]),
      [ddg("Nova site:open.spotify.com/artist")]: '<a rel="nofollow" class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fopen.spotify.com%2Fintl-es%2Fartist%2F0123456789abcdefghijkl&amp;rut=x">Nova | Spotify</a>',
      // Instagram: a post and someone else, so nothing; TikTok: no engine reachable
      [bing("Nova site:instagram.com")]: rss([["https://www.instagram.com/p/xyz/", "Nova on Instagram"], ["https://www.instagram.com/someoneelse/", "Someone Else"]])
    };
    const fresh = createHost(fs.mkdtempSync(path.join(FX.TMP, "first-")), { tools: { web } });
    const appJson = path.join(fresh.base, "Settings", "app.json");
    fs.writeFileSync(appJson, "{}");
    const w = await openApp(browser, server, fresh, { width: 1480, height: 900, welcome: true });
    const saved = () => { try { return JSON.parse(fs.readFileSync(appJson, "utf8")).settings; } catch (e) { return null; } };
    ok(await until(() => w.page.locator("#welcome").isVisible(), 5000, 30), "First start: the welcome asks for the artist name");
    ok(await w.page.evaluate(() => document.activeElement.id) === "wName" && await w.page.locator("#welcome input").count() === 1, "First start: one field only, with the focus");
    await w.page.screenshot({ path: path.join(SHOTS, "welcome.png") });
    await w.page.locator("#wName").fill("  Nova  ");
    await w.page.locator("#wOk").click();
    ok(await until(() => (saved() || {}).artistName === "Nova", 3000, 30), "First start: Continue saves the name");
    ok(await until(() => w.page.locator("#findDlg").isVisible(), 3000, 30), "First start: then «" + L("find.title") + "»");
    const rows = w.page.locator("#findList .frow:not(.skel)");
    await until(async () => await rows.count() > 0, 5000, 30);
    const got = await rows.evaluateAll(rs => rs.map(r => r.dataset.k + " " + r.dataset.url));
    ok(JSON.stringify(got) === JSON.stringify(["youtube https://www.youtube.com/@novamusic", "spotify https://open.spotify.com/artist/0123456789abcdefghijkl"]),
      "Profiles found: the YouTube channel (not the video), Spotify through the second engine, nothing wrong for Instagram or unreachable TikTok: " + JSON.stringify(got));
    ok(await w.page.locator("#findText").textContent() === L("find.found", { name: "Nova" }), "Profiles found: the line says what was searched");
    await w.page.screenshot({ path: path.join(SHOTS, "find.png") });
    await w.page.locator('#findList [data-k="youtube"] [data-ans="yes"]').click();
    await w.page.locator('#findList [data-k="spotify"] [data-ans="no"]').click();
    ok(await until(() => { const s = saved(); return s && s.links.youtube === "https://www.youtube.com/@novamusic" && !s.links.spotify; }, 3000, 30), "Yes saves that link, No saves nothing");
    ok(await w.page.locator('#findList [data-k="youtube"] .fstate').textContent() === L("find.saved") && await w.page.locator('#findList [data-k="spotify"] .fstate').textContent() === L("find.skipped"), "Each answer shows on its row");
    await w.page.screenshot({ path: path.join(SHOTS, "find-answered.png") });
    await w.page.locator("#findDone").click();
    await until(() => w.page.locator("#findDlg").isHidden(), 3000, 30);
    await w.tab("settings");
    ok(await w.page.locator("#setArtistName").inputValue() === "Nova" && await w.page.locator("#setLink-youtube").inputValue() === "https://www.youtube.com/@novamusic", "Settings → Artist shows the name and the link");
    await w.page.locator("#setFind").click();
    await until(async () => await rows.count() > 0, 5000, 30);
    ok(await w.page.locator('#findList [data-k="youtube"] .fstate').textContent() === L("find.already") && await w.page.locator('#findList [data-k="spotify"] [data-ans]').count() === 2, "«" + L("set.findLinks") + "» asks again; a saved link reads as already yours");
    await w.page.keyboard.press("Escape"); await until(() => w.page.locator("#findDlg").isHidden(), 3000, 30);
    await w.page.reload(); await w.page.waitForTimeout(1500);
    ok(await w.page.locator("#welcome").isHidden() && await w.page.locator("#findDlg").isHidden(), "Next start: nothing is asked");
    ok(!w.errors.length, "No page errors on the first start" + (w.errors.length ? ": " + w.errors.join(" / ") : ""));
    await w.page.close();
    // Skip: nothing filled in, no search, and it is not asked again
    const f2 = newHost("en");
    fs.writeFileSync(f2.P("Settings", "app.json"), "{}");
    const w2 = await openApp(browser, server, f2.host, { width: 1480, height: 900, welcome: true });
    await until(() => w2.page.locator("#welcome").isVisible(), 5000, 30);
    await w2.page.locator("#wName").fill("Not this");
    await w2.page.locator('#welcome [value="skip"]').click();
    const s2 = await until(() => { try { return JSON.parse(fs.readFileSync(f2.P("Settings", "app.json"), "utf8")).settings; } catch (e) { return null; } }, 3000, 30);
    await w2.page.waitForTimeout(400);
    ok(s2 && s2.artistName === "" && await w2.page.locator("#findDlg").isHidden(), "First start: Skip leaves the name empty, searches nothing and is not asked again");
    await w2.page.close();
  }

  /* ---------- Settings: the index ---------- */
  await tab("settings");
  ok(JSON.stringify(await current("#setNav")) === '["sg-general"]', "Settings: the first section is marked at the top");
  await page.locator('#setNav [data-sec="sg-storage"]').click();
  ok(await until(async () => { const y = await page.evaluate(() => document.querySelector("#sg-storage").getBoundingClientRect().top - document.querySelector("#setNav").closest(".pbar").getBoundingClientRect().bottom); return y >= -2 && y < 40; }, 3000, 30), "Settings: a click on a tab scrolls its section up to just under the tabs");
  ok(JSON.stringify(await current("#setNav")) === '["sg-storage"]', "Settings: that section is marked");
  const navBox = await page.locator("#setNav").boundingBox();
  ok(navBox.y >= 0 && navBox.y < 90, "Settings: the tabs stay at the top while the page scrolls");
  await page.screenshot({ path: path.join(SHOTS, "settings-storage.png") });
  await page.evaluate(() => { document.querySelector("#v-settings").scrollTop = document.querySelector("#sg-processing").offsetTop; });
  ok(await until(async () => JSON.stringify(await current("#setNav")) === '["sg-processing"]', 2000, 30), "Settings: scrolling by hand marks the section in view");
  await page.evaluate(() => { document.querySelector("#v-settings").scrollTop = 0; });
  await until(async () => JSON.stringify(await current("#setNav")) === '["sg-general"]', 2000, 30);
  await page.screenshot({ path: path.join(SHOTS, "settings.png") });

  /* ---------- Settings: Restore defaults ---------- */
  await page.locator("#setProcMode").selectOption("fast");
  await page.locator("#setArtistName").fill("Someone"); await page.locator("#setArtistName").press("Tab");
  await page.locator("#setLink-spotify").fill("open.spotify.com/artist/x"); await page.locator("#setLink-spotify").press("Tab");
  ok(await until(async () => (await settings()).links.spotify === "https://open.spotify.com/artist/x", 2000, 30) && await page.locator("#setLink-spotify").inputValue() === "https://open.spotify.com/artist/x", "Settings → Artist: a link is saved as a full address");
  await page.locator("#setReduceMotion").check();
  await page.locator('#modules [data-mod="grade"]').uncheck();
  ok((await settings()).processing.mode === "fast" && (await settings()).artistName === "Someone", "Settings: changes are kept");
  await page.locator("#setReset").click();
  await page.locator("#mCancel").click();
  ok((await settings()).processing.mode === "fast", "Restore defaults: Cancel changes nothing");
  await page.locator("#setReset").click();
  await page.locator("#mOk").click();
  const s = await until(async () => { const x = await settings(); return x.processing.mode === "balanced" ? x : null; }, 3000, 30);
  ok(s && !s.reduceMotion && s.language === "en" && s.modules && s.modules.grade === false, "Restore defaults: the settings go back, the language and the tools turned off stay");
  ok(s && s.artistName === "Someone" && s.links.spotify === "https://open.spotify.com/artist/x", "Restore defaults: the artist name and links stay");
  ok(await page.locator("#setProcMode").inputValue() === "balanced" && await page.locator("#setArtistName").inputValue() === "Someone" && !(await page.locator("#setReduceMotion").isChecked()), "Restore defaults: the page shows them at once");
  ok(await page.evaluate(() => document.documentElement.dataset.motion !== "reduce"), "Restore defaults: animations are back on");
  await page.locator("#setFind").click();
  ok(await until(async () => await page.locator("#findText").textContent() === L("find.offline"), 5000, 30) && await page.locator("#findList .frow").count() === 0, "Search other sites, no connection: it says so, nothing to answer");
  await page.keyboard.press("Escape"); await until(() => page.locator("#findDlg").isHidden(), 3000, 30);
  await page.locator('#modules [data-mod="grade"]').check(); await until(() => page.evaluate(() => !!document.querySelector('.rail .tab[data-tab="grade"]')), 5000, 20);

  /* ---------- Settings: the language ---------- */
  ok(await page.locator("#setLanguage").inputValue() === "en", "Settings: the language shown is the one in use");

  /* ---------- Library: exports ---------- */
  const EXP = P("Exports");
  fs.mkdirSync(EXP, { recursive: true });
  const files = [["clip.mp4", "video"], ["red.png", "image"], ["blue.png", "image"], ["green.png", "image"]];
  for (const [f] of files) fs.copyFileSync(path.join(FX.FIX, f.endsWith(".mp4") ? "cover.png" : "small.png"), path.join(EXP, f));
  await page.evaluate(({ d, files }) => { for (const [f, k] of files) window.__shell.recordExport({ path: d + "/" + f, name: f, kind: k, thumb: "" }); }, { d: EXP, files });
  await tab("library");
  await page.locator('#libNav [data-tab="exports"]').click();
  const cards = () => page.locator("#libPanel .libv-card");
  const ticked = () => page.locator("#libPanel .libv-pick input:checked").count();
  ok(await until(async () => await cards().count() === 4, 5000, 30), "Library: four exports under Exports");
  ok(!(await page.locator(".libv-selbar").isVisible()), "Nothing ticked: no selection bar");
  await cards().nth(0).hover(); await cards().nth(0).locator(".libv-pick input").check();
  ok(await until(() => page.locator(".libv-selbar").isVisible(), 3000, 30) && await page.locator('[data-sel="all"]').isVisible(), "A tick shows the bar with Select all");
  await page.locator('[data-sel="all"]').click();
  ok(await ticked() === 4 && await page.locator(".libv-selcount").textContent() === L("lib.selected", { n: 4 }), "Select all ticks every export");
  ok(!(await page.locator('[data-sel="all"]').isVisible()) && await page.locator(".libv-cuttext").textContent() === L("lib.cutPicked", { n: 3 }), "All ticked: Cut out counts the 3 images only");
  await page.screenshot({ path: path.join(SHOTS, "library-selected.png") });
  await page.locator('[data-sel="none"]').click();
  ok(await ticked() === 0 && await until(async () => !(await page.locator(".libv-selbar").isVisible()), 3000, 30), "Clear unticks them all");
  // a type chip: Select all takes the ones shown
  await page.locator('.libv-types [data-type="video"]').click();
  ok(await until(async () => await cards().count() === 1, 3000, 30), "Type Video: one card");
  await cards().nth(0).hover(); await cards().nth(0).locator(".libv-pick input").check();
  await page.locator('.libv-types [data-type="video"]').click();
  await until(async () => await cards().count() === 4, 3000, 30);
  ok(await ticked() === 1 && !(await page.locator('[data-sel="cut"]').isVisible()), "The filter off: one ticked; a video is not cut out");
  // tick one by hand, then remove the two from the Library: the files stay
  const second = await cards().nth(1).locator(".libv-meta b").textContent();
  await cards().nth(1).hover(); await cards().nth(1).locator(".libv-pick input").check();
  ok(await page.locator(".libv-selcount").textContent() === L("lib.selected", { n: 2 }), "A tick by hand adds to the selection");
  await page.locator('[data-sel="remove"]').click();
  ok(await until(async () => await cards().count() === 2, 3000, 30), "Remove from Library: two left");
  ok(fs.existsSync(path.join(EXP, "clip.mp4")) && fs.existsSync(path.join(EXP, second)), "Remove from Library: the files stay in their folder");
  // switching away and back keeps the view, and the selection is gone
  await tab("home"); await tab("library");
  ok(await cards().count() === 2 && await ticked() === 0, "Back in the Library: the view as left, nothing ticked");
  ok(await page.locator('#libNav [data-tab="exports"]').getAttribute("aria-selected") === "true", "Library: the tab is remembered");
  await page.screenshot({ path: path.join(SHOTS, "library.png") });

  /* ---------- Grade: Select all on the layers ---------- */
  await tab("grade"); await appReady("grade");
  await grade.locator("#imgIn").setInputFiles(path.join(FX.FIX, "cover.png"));
  await until(async () => /cover\.png/.test(await grade.locator("#imgName").textContent()), 8000);
  await grade.locator(".tab[data-tab=filters]").click();
  const looks = await grade.locator(".tile").evaluateAll(ts => ts.slice(0, 3).map(t => t.dataset.look));
  for (const id of looks) await grade.locator(`.tile[data-look="${id}"]`).click();
  const rows = grade.locator("#listF .layer");
  await until(async () => await rows.count() === 3, 5000, 20);
  await grade.locator("#selAllL").click();
  ok(await grade.locator("#selCount").textContent() === L("grade.sel.count", { n: 3 }) && await grade.locator("#listF .layer.sel").count() === 3, "Grade: Select all selects the 3 layers");
  ok(await grade.locator("#selAllL2").isHidden(), "Grade: all selected, no Select all in the bar");
  await grade.locator("#selNone").click();
  await rows.nth(0).locator(".lname").click({ modifiers: ["Control"] });
  ok(await grade.locator("#selAllL2").isVisible(), "Grade: one selected, Select all in the bar");
  await grade.locator("#selAllL2").click();
  ok(await grade.locator("#listF .layer.sel").count() === 3, "Grade: the bar's Select all takes the rest");
  await grade.locator("#selNone").click();
  await rows.nth(1).locator(".lname").click();
  await page.keyboard.press("Control+a");
  ok(await grade.locator("#listF .layer.sel").count() === 3, "Grade: Ctrl+A over the layers selects them all");
  await page.screenshot({ path: path.join(SHOTS, "grade-selected.png") });
  await grade.locator("#selDel").click();
  ok(await rows.count() === 0, "Grade: the selection acts (Delete)");

  ok(!errors.length, "No page errors" + (errors.length ? ": " + errors.join(" / ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `${failures} failed` : "all passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
