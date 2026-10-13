// "Send to…" (common.js menu, shell.js → sendto, modules.js: accepts, gives, roundTrip):
// 1. The menu from each kind of resource lists only the tools that take it: an image (Grade), a song and a video
//    (Library exports) and a frame (Frame Grab's result); never the tool itself.
// 2. A tool whose required component is missing (Upscale without upscayl-bin) or that is turned off is not listed.
// 3. Order: the last tool used first ("Last used"), the rest alphabetical.
// 4. Sending passes the path or the bytes as they are (a Library export arrives with its path).
// 5. "And come back": the list keeps the tools whose result can come back; "Back to <origin>" in the header brings
//    the result to the origin (Grade → Upscale → Grade) and Frame Grab's own
//    round trip (Visualizer ← frame as the cover). Screenshots → $SHOTS/sendto.
// Usage: node app/tests/sendto.js
const fs = require("fs"), os = require("os"), path = require("path"), { execSync } = require("child_process");
const { until, painted, serve, launch, openApp, locale } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const functional = process.argv.includes("--functional");
const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "sendto");
if (!functional) fs.mkdirSync(SHOTS, { recursive: true });
const FX = makeFixtures(), TOOLS = toolOptions(FX), { L } = locale("en");
const ffmpeg = execSync("command -v ffmpeg").toString().trim();
const host = createHost(fs.mkdtempSync(path.join(FX.TMP, "send-")), { ...TOOLS, tools: { ...TOOLS.tools, systemFfmpeg: ffmpeg } });
fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en" } }));
const WEBM = path.join(FX.TMP, "send.webm");
execSync(`ffmpeg -v error -f lavfi -i testsrc2=size=640x360:rate=24:duration=2 -c:v libvpx-vp9 -b:v 600k -y "${WEBM}"`);
const COVER = path.join(FX.FIX, "cover.png");
// Library exports live in the Halation folder (read_path reads nothing outside it)
const inBase = (file, ...dir) => { const d = path.join(host.base, ...dir); fs.mkdirSync(d, { recursive: true }); fs.copyFileSync(file, path.join(d, path.basename(file))); return path.join(d, path.basename(file)); };
const SONG = inBase(path.join(FX.FIX, "song one.wav"), "Downloads", "Audio"), VIDEO = inBase(WEBM, "Exports", "Videos");

(async () => {
  const server = serve(), browser = await launch();
  const app = await openApp(browser, server, host, { width: 1480, height: 920 });
  const { page, errors, grade, tab, appReady, sendTo } = app;
  const fr = name => page.frames().find(f => new RegExp(name + "\\.html").test(f.url()));
  const fl = name => page.frameLocator("#v-" + name);
  const active = t => page.evaluate(t => document.querySelector("#v-" + t).classList.contains("on"), t);
  const shot = n => functional ? Promise.resolve() : page.screenshot({ path: path.join(SHOTS, n) });
  // the open menu in `where` (the page or a tool frame): its entries, and whether "and come back" is offered
  const menu = where => where.locator(".sendmenu:not([hidden])");
  const entries = async where => { await menu(where).waitFor({ timeout: 5000 }); return menu(where).locator("[data-to]").evaluateAll(b => b.map(x => x.dataset.to)); };
  const closeMenu = async where => { await page.keyboard.press("Escape"); await until(async () => !(await menu(where).count()), 3000, 20); };
  const names = ids => ids.map(id => L("tab." + id));
  const sorted = ids => names(ids).every((n, i, a) => !i || a[i - 1].localeCompare(n, "en") <= 0);
  const backShown = () => page.locator("#backTo").isVisible();

  // 1-2. an image in Grade; Upscale is not installed yet
  await tab("grade"); await appReady("grade");
  await grade.locator("#imgIn").setInputFiles(COVER);
  await until(async () => /cover\.png/.test(await grade.locator("#imgName").textContent()), 15000);
  await until(async () => !(await grade.locator("#sendBtn").isDisabled()), 10000);
  await grade.locator("#sendBtn").click();
  let list = await entries(grade);
  ok(list.join() === "visualizer,removebg,convert,covertest", `image: only the tools that take an image (Converter too), not Grade itself, not Frame Capture (video), not Image Upscale without its component: ${list}`);
  ok(sorted(list), "the rest in alphabetical order: " + names(list).join(", "));
  await closeMenu(grade);
  await page.evaluate(() => window.__hal.installTool("upscaler"));
  await grade.locator("#sendBtn").click();
  list = await entries(grade);
  ok(list.join() === "visualizer,removebg,convert,covertest,upscale", `Image Upscale listed once installed: ${list}`);
  await painted(page); await shot("menu-image.png");

  // 5. "and come back" keeps the tools whose result is an image (not the Visualizer: its result is a video)
  await menu(grade).locator(".send-back input").check();
  list = await entries(grade);
  ok(list.join() === "removebg,convert,upscale", `"And come back" filters the list to the results Grade takes: ${list}`);
  await painted(page); await shot("menu-come-back.png");
  await menu(grade).locator('[data-to="upscale"]').click();
  const up = fl("upscale");
  ok(await until(() => active("upscale"), 15000) && await until(async () => (await up.locator("#inName").textContent()) === "cover.png", 15000), "Grade → Upscale: the edited picture arrives");
  ok(await until(backShown, 5000) && (await page.locator("#backToText").textContent()) === L("send.backTo", { name: L("tab.grade") }), "the destination shows \"Back to Grade\" in the header");
  await page.locator("#backToBtn").click();
  ok(await until(async () => (await page.locator(".toast").allTextContents()).some(x => x.includes(L("send.backNothing", { name: L("tab.upscale") }))), 5000) && await active("upscale"), "Back to with no result yet says so and stays");
  await up.locator("#runBtn").click();
  await until(async () => !!(await fr("upscale").evaluate(() => window.__halApp.result())), 60000);
  await painted(page); await shot("back-to-header.png");
  await page.locator("#backToBtn").click();
  ok(await until(() => active("grade"), 15000) && await until(async () => /cover-x\d\.png/.test(await grade.locator("#imgName").textContent()), 15000), "Back to Grade: the upscaled file opens in Grade: " + await grade.locator("#imgName").textContent());
  ok(!(await backShown()), "the button goes once the result is back");

  // 3. the last one used comes first
  await grade.locator("#sendBtn").click();
  list = await entries(grade);
  ok(list[0] === "upscale" && sorted(list.slice(1)) && (await menu(grade).locator('[data-to="upscale"] small').textContent()) === L("send.last"), `last used first (${list[0]}, "Last used"), the rest alphabetical: ${list.slice(1)}`);
  await closeMenu(grade);

  // a second file: it replaces the first everywhere; "Back to" follows the tab (hidden elsewhere, back on return)
  await grade.locator("#imgIn").setInputFiles(path.join(FX.FIX, "sky.png"));
  await until(async () => /sky\.png/.test(await grade.locator("#imgName").textContent()), 15000);
  await until(async () => !(await grade.locator("#sendBtn").isDisabled()), 10000);
  await sendTo(grade, "#sendBtn", "upscale", { back: true });
  ok(await until(() => active("upscale"), 15000) && await until(async () => (await up.locator("#inName").textContent()) === "sky.png", 15000) && await up.locator("#result").isHidden(), "a second picture sent replaces Upscale's input and clears the old result");
  await tab("library");
  ok(!(await backShown()) && (await page.locator("#pageTitle").textContent()) === L("tab.library"), "\"Back to\" is not shown on another tab");
  await tab("upscale");
  ok(await until(backShown, 5000), "…and comes back with the destination tab");
  await page.locator("#backToX").click();
  ok(await until(async () => !(await backShown()), 5000), "\"Stay here\" drops the round trip");
  await tab("grade");

  // 1, 4. a song and a video from the Library: their paths as they are
  await page.evaluate(([s, v]) => { window.__hal.recordExport({ path: s, name: "song one.wav", kind: "audio" }); window.__hal.recordExport({ path: v, name: "send.webm", kind: "video" }); }, [SONG, VIDEO]);
  await tab("library");
  // an item's «Send to…» is in its detail (libpanel.js): the card is selected first
  // a card's detail (clicking the card already shown would close it)
  const card = async n => { const h = page.locator(".libv-detail:not([hidden]) .libv-d-h b");
    if (!(await h.count()) || !(await h.textContent()).startsWith(n)) await page.locator("#libPanel .libv-card", { hasText: n }).first().click(); await until(() => page.locator('.libv-detail [data-d="send"]').isVisible()); return page.locator('.libv-detail [data-d="send"]'); };
  await (await card("song one.wav")).click();
  list = await entries(page);
  ok(list.join() === "visualizer,convert,stems", `audio: the Visualizer, Converter and Vocal Remover: ${list}`);
  ok(!(await menu(page).locator(".send-back").count()), "the Library takes nothing back: no \"and come back\"");
  await menu(page).locator('[data-to="visualizer"]').click();
  ok(await until(() => active("visualizer"), 15000) && await until(async () => (await app.vis.locator("#audName").textContent()).startsWith("song one.wav"), 15000), "Library song → Visualizer's audio: " + await app.vis.locator("#audName").textContent());
  await tab("library");
  await (await card("send.webm")).click();
  list = await entries(page);
  ok(list.join() === "convert,framegrab,stems", `video: Converter, Frame Capture and Vocal Remover: ${list}`);
  await painted(page); await shot("menu-video.png");


  // 1. a frame: Frame Grab's result; nothing comes back to Frame Grab (it takes videos)
  await tab("library"); await sendTo(page, await card("send.webm"), "framegrab");
  const fg = fl("framegrab"), S = () => fr("framegrab").evaluate(() => window.__halApp.state());
  await until(async () => (await fg.locator("#srcName").textContent()) === "send.webm" && (await S()).settled, 60000);
  await fg.locator('#dests input[value="image"]').check();
  await fg.locator("#addBtn").click();
  await fg.locator("#captureBtn").click();
  await fg.locator('#results [data-act="send"]').first().waitFor({ timeout: 15000 });
  await fg.locator('#results [data-act="send"]').first().click();
  list = await entries(fg);
  ok(list.join() === "visualizer,removebg,convert,covertest,grade,upscale", `frame: the image tools, alphabetical (the last used, Frame Capture, is this tool): ${list}`);
  await menu(fg).locator(".send-back input").check();
  list = await entries(fg);
  ok(list.join() === "visualizer,convert,upscale", "\"and come back\" to Frame Capture keeps the tools whose result is a video: " + list);
  await menu(fg).locator(".send-back input").uncheck();
  await menu(fg).locator('[data-to="grade"]').click();
  ok(await until(() => active("grade"), 15000) && await until(async () => /send - frame \d+\.png/.test(await grade.locator("#imgName").textContent()), 15000), "Frame Grab frame → Grade");

  // 5. Frame Grab runs its own round trip: a frame of a video comes back to the Visualizer as its cover
  const done = page.evaluate(v => window.__hal.sendTo("framegrab", { kind: "video", path: v, name: "send.webm" }, { from: "visualizer", back: true }), VIDEO);
  ok(await until(() => active("framegrab"), 15000) && await until(async () => /Visualizer/.test(await fg.locator("#origin").textContent()), 10000), "Visualizer → Frame Grab with its own \"Back to Visualizer\"");
  await until(async () => (await S()).settled, 60000);
  await fg.locator("#addBtn").click();
  await fg.locator("#captureBtn").click();
  // a picture that is not square goes through the Crop dialog on its way to the cover
  if (await until(() => page.evaluate(() => document.querySelector("#cropDlg").open), 15000, 50)) await page.click("#cropApply");
  await done;
  ok(await until(() => active("visualizer"), 15000) && await until(async () => /send - frame \d+\.png/.test(await app.vis.locator("#artName").textContent()), 15000), "the frame comes back as the Visualizer's cover: " + await app.vis.locator("#artName").textContent());

  // 2. a module turned off is not listed
  await tab("settings");
  await page.locator('#modules input[data-mod="removebg"]').uncheck();
  await until(() => page.evaluate(() => !document.querySelector('.rail .tab[data-tab="removebg"]')), 5000, 20);
  await tab("grade");
  await grade.locator("#sendBtn").click();
  list = await entries(grade);
  ok(!list.includes("removebg") && list.includes("upscale"), `Background Remover turned off: not in the menu (${list})`);
  await closeMenu(grade);
  ok(!(await menu(grade).count()), "Escape closes the menu");
  await tab("settings"); await page.locator('#modules input[data-mod="removebg"]').check();

  ok(!errors.length, "no page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall green");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
