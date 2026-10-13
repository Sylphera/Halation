// Settings v2 (SETTINGS_SPEC §5; shell.js → shell and settings sections, visualizer.js, grade.js):
// 1. A 0.9.0 app.json migrates with nothing lost: the Visualizer's and Grade's output defaults move to
//    toolDefaults, the encoder to "Use the graphics card", the frame cache limit to the workspace budget.
// 2. Settings holds no option of a single tool; without opening "Advanced" a section shows at most four controls.
// 3. The Visualizer's format, frame rate, quality and codecs are chosen in the tool; "Use as default" keeps them
//    after a restart. Grade's size and format, the same.
// 4. Processing: the mode changes how many jobs run at once; "Advanced" is remembered open or closed per section.
// 5. Restore defaults leaves the artist, language, modules and the tools' own defaults alone.
// Screenshots → $SHOTS/settings.
// Usage: node app/tests/settings.js
const fs = require("fs"), os = require("os"), path = require("path");
const { until, painted, serve, launch, openApp } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const functional = process.argv.includes("--functional");
const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "settings");
if (!functional) fs.mkdirSync(SHOTS, { recursive: true });
const FX = makeFixtures(), TOOLS = toolOptions(FX);
const root = fs.mkdtempSync(path.join(FX.TMP, "settings-"));
const host = createHost(root, TOOLS);
const appFile = path.join(host.base, "Settings", "app.json");
const appState = () => JSON.parse(fs.readFileSync(appFile, "utf8"));

// 0.9.0's settings: no version, the tools' output defaults and the encoder among them
fs.mkdirSync(path.dirname(appFile), { recursive: true });
fs.writeFileSync(appFile, JSON.stringify({ settings: {
  language: "en", artistName: "Nova", links: { spotify: "https://open.spotify.com/artist/x" }, saveMode: "ask", reduceMotion: false,
  videoFormat: "1080x1920", videoFps: "60", videoQuality: "high", videoCodec: "vp9", audioCodec: "opus",
  imageSize: "1080", imageFormat: "jpg", encoder: "cpu", frameCacheMB: "16384", videoName: "{artist} - {title}.mp4", modules: { removebg: false }
} }));

(async () => {
  const server = serve(), browser = await launch();
  let app = await openApp(browser, server, host, { width: 1480, height: 920 });
  let { page } = app;
  const errors = [];
  const watch = p => p.on("pageerror", e => errors.push(String(e)));
  watch(page);
  const shot = n => functional ? painted(page) : painted(page).then(() => page.screenshot({ path: path.join(SHOTS, n + ".png") }));

  /* ---------- 1: migration ---------- */
  await until(() => (appState().settings || {}).version === 2, 5000, 30);
  const a = appState(), s = a.settings, td = a.toolDefaults || {};
  ok(s.version === 2 && !["videoFormat", "videoFps", "videoQuality", "videoCodec", "audioCodec", "imageSize", "imageFormat", "encoder", "frameCacheMB"].some(k => k in s), "Migration: settings v2, the old keys gone");
  const v = td.visualizer || {}, g = td.grade || {};
  ok(v.format === "1080x1920" && v.fps === "60" && v.quality === "high" && v.videoCodec === "vp9" && v.audioCodec === "opus", "Migration: the Visualizer's defaults as they were: " + JSON.stringify(v));
  ok(g.imageSize === "1080" && g.imageFormat === "jpg", "Migration: Grade's defaults as they were: " + JSON.stringify(g));
  ok(s.processing && s.processing.gpu === false && s.processing.mode === "balanced", "Migration: processor-only encoding → «Use the graphics card» off");
  ok(s.workspace && s.workspace.budgetMB === 16384, "Migration: a frame cache limit above the budget raises the budget: " + (s.workspace && s.workspace.budgetMB));
  ok(s.artistName === "Nova" && s.links.spotify && s.saveMode === "ask-every-time" && s.videoName === "{artist} - {title}.mp4" && s.modules.removebg === false, "Migration: the rest kept (artist, links, saving, name template, modules)");
  await app.tab("visualizer"); await app.appReady("visualizer");
  const vis = app.vis;
  ok(await until(async () => await vis.locator("#f-format").inputValue() === "1080x1920", 10000, 30) && await vis.locator("#f-fps").inputValue() === "60" && await vis.locator("#f-quality").inputValue() === "high", "The Visualizer starts from its migrated defaults");
  await vis.locator("#audIn").setInputFiles(path.join(FX.FIX, "song one.wav"));
  await app.cover(path.join(FX.FIX, "cover.png"));
  await until(async () => !(await vis.locator("#exportBtn").isDisabled()), 20000, 50);
  await vis.locator("#exportBtn").click(); await until(() => vis.locator("#xDialog").isVisible(), 5000, 30);
  await vis.locator('#xMode [data-mode="single"]').click();
  await vis.locator("#xAdv > summary").click();
  ok(await vis.locator("#xVcodec").inputValue() === "vp9" && await vis.locator("#xAcodec").inputValue() === "opus", "The codecs are in the Visualizer's export dialog, under Advanced");
  await shot("visualizer-export-codecs");
  await vis.locator('#xDialog button[value="cancel"]').click();
  await app.tab("grade"); await app.appReady("grade");
  ok(await until(async () => await app.grade.locator("#outSize").inputValue() === "1080", 10000, 30) && await app.grade.locator("#outFmt").inputValue() === "jpg", "Grade starts from its migrated defaults");

  /* ---------- 2: what Settings shows ---------- */
  await app.tab("settings");
  for (const id of ["setVideoFormat", "setVideoFps", "setVideoQuality", "setVideoCodec", "setAudioCodec", "setImageSize", "setImageFormat", "setEncoder", "setFrameCache"])
    if (await page.locator("#" + id).count()) ok(false, "Settings still has #" + id);
  ok(true, "Settings shows no option of a single tool");
  // controls in view with every Advanced closed: a radio group counts once
  const counts = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll("#v-settings section.card")].map(sec => {
    const shown = [...sec.querySelectorAll("select, input:not([type=radio]), .radios")].filter(el => !el.closest("details.adv") && !el.closest(".links") && !el.closest("#modules") && el.getClientRects().length);
    return [sec.id, shown.length];
  })));
  ok(["sg-general", "sg-files", "sg-processing", "sg-storage"].every(k => counts[k] <= 4), "Without Advanced, at most four controls per section: " + JSON.stringify(counts));
  ok(await page.locator("#setProcGpu").isChecked() === false && await page.locator("#setBudget").inputValue() === "16384", "Settings shows the migrated values (GPU off, 16 GB)");
  await page.locator("#setProcGpu").check();
  await shot("settings-general");
  ok(await page.locator("#setShowProcesses").isChecked() && await page.locator("#procBtn").isVisible(), "Processes dock is visible by default for migrated settings");
  await page.locator("#setShowProcesses").uncheck();
  ok(await until(() => appState().settings.showProcesses === false, 3000) && await page.locator("#procBtn").isHidden() && await page.locator("#toolbox").isVisible(), "Hiding Processes persists the preference and preserves the other toolbox controls");
  const job = await page.evaluate(() => {
    const h = window.__shell.jobs.submit({ tool: "grade", kind: "export-image", lane: "cpu", title: "visibility.png", run: ctx => new Promise(resolve => { window.__visibilityRelease = resolve; ctx.progress(.4); }) });
    return h.id;
  });
  ok(await until(() => page.evaluate(id => window.__shell.jobs.get(id).state === "running", job), 3000) && await page.locator("#procBtn").isHidden() && await page.locator("#toolbox").isVisible(), "Hidden Processes leaves the scheduler running and the other controls available");
  await page.keyboard.press("Control+j");
  ok(await until(() => page.locator("#procTray").isVisible(), 3000), "Ctrl+J still opens Processes with its dock disabled");
  await page.keyboard.press("Escape");
  ok(await until(() => page.locator("#procBtn").isHidden(), 3000) && await page.locator("#toolbox").isVisible(), "Closing hides Processes again and restores the other toolbox controls");
  await page.evaluate(async () => { window.__visibilityRelease(); while (window.__shell.jobs.busy()) await new Promise(r => setTimeout(r, 10)); window.__shell.jobs.clearFinished(); window.__procs.closePill(true); });


  /* ---------- 4: processing ---------- */
  const caps = () => page.evaluate(() => window.__shell.jobs.caps());
  await page.locator("#setProcMode").selectOption("quiet");
  ok(await until(async () => (await caps()).cpu === 1, 3000, 30) && (appState().settings.processing || {}).mode === "quiet", "Quiet: one processor job at a time, saved");
  const quietNote = await page.locator("#setProcModeNote").textContent();
  await page.locator("#setProcMode").selectOption("fast");
  ok(await until(async () => (await caps()).gpu === 2, 3000, 30) && await page.locator("#setProcModeNote").textContent() !== quietNote, "Fast: more at once, and the note says so: " + await page.locator("#setProcModeNote").textContent());
  await page.locator("#setProcMode").selectOption("balanced");
  await page.locator('#sg-processing details.adv > summary').click();
  ok(await until(() => (appState().settings.advancedOpen || {}).processing === true, 3000, 30), "Advanced: open, remembered for Processing");
  await page.locator("#setLimCpu").selectOption("1");
  ok(await until(async () => (await caps()).cpu === 1, 3000, 30), "Processor jobs at once: 1 → the lane takes one");
  await page.locator("#setLimCpu").selectOption("auto");
  await page.locator("#sg-processing").scrollIntoViewIfNeeded();
  await shot("settings-processing");

  /* ---------- 3: "Use as default" survives a restart ---------- */
  await app.tab("visualizer");
  await vis.locator("#f-format").selectOption("1920x1080"); await vis.locator("#f-fps").selectOption("24");
  await vis.locator("#useDefault").click();
  ok(await until(() => { const d = (appState().toolDefaults || {}).visualizer || {}; return d.format === "1920x1080" && d.fps === "24"; }, 3000, 30), "Visualizer: «Use as default» saves format and frame rate");
  await shot("visualizer-use-default");
  await app.tab("grade");
  await app.grade.locator("#outSize").selectOption("2048"); await app.grade.locator("#outFmt").selectOption("png");
  await app.grade.locator("#useDefault").click();
  ok(await until(() => { const d = (appState().toolDefaults || {}).grade || {}; return d.imageSize === "2048" && d.imageFormat === "png"; }, 3000, 30), "Grade: «Use as default» saves size and format");
  await shot("grade-use-default");
  await host.call("app_quit"); // A clean restart; page.close alone simulates a crash now.
  await page.close(); host.begin();
  app = await openApp(browser, server, host, { width: 1480, height: 920 }); page = app.page; watch(page);
  ok(await page.locator("#procBtn").isHidden() && await page.locator("#toolbox").isVisible(), "Processes visibility survives a restart while the other controls remain available");
  await app.tab("visualizer"); await app.appReady("visualizer");
  ok(await until(async () => await app.vis.locator("#f-format").inputValue() === "1920x1080", 10000, 30) && await app.vis.locator("#f-fps").inputValue() === "24", "After a restart the Visualizer starts from its own defaults");
  await app.tab("grade"); await app.appReady("grade");
  ok(await until(async () => await app.grade.locator("#outSize").inputValue() === "2048", 10000, 30) && await app.grade.locator("#outFmt").inputValue() === "png", "After a restart Grade starts from its own defaults");

  /* ---------- 5: Restore defaults ---------- */
  await app.tab("settings");
  await page.locator("#setProcMode").selectOption("fast");
  await page.locator("#setReset").click(); await page.locator("#mOk").click();
  ok(await until(() => { const x = appState().settings; return x.processing.mode === "balanced" && x.workspace.budgetMB === 8192; }, 3000, 30), "Restore defaults: processing and the budget back to how Halation ships");
  ok(await page.locator("#setShowProcesses").isChecked() && await page.locator("#procIsland").isVisible(), "Restore defaults enables the Processes dock again");
  await shot("settings-dock-toggle");
  const r = appState();
  ok(r.settings.artistName === "Nova" && r.settings.language === "en" && r.settings.modules.removebg === false, "Restore defaults: artist, language and modules stay");
  ok(r.toolDefaults.visualizer.format === "1920x1080" && r.toolDefaults.grade.imageSize === "2048", "Restore defaults: the tools' own defaults stay");

  /* ---------- About: license and third-party notices ---------- */
  await page.locator("#noticesBtn").scrollIntoViewIfNeeded(); await page.locator("#noticesBtn").click();
  ok(await until(() => page.locator("#legalDlg").isVisible(), 5000) && await until(async () => /^# Third-party software/.test(await page.locator("#legalBody").textContent()), 3000) && (await page.locator("#legalBody").textContent()).includes("Figtree"), "About → Third-party notices: THIRD_PARTY.md in full");
  await shot("about-notices");
  await page.locator("#legalClose").click(); await until(() => page.locator("#legalDlg").isHidden(), 3000);
  await page.locator("#licenseBtn").click();
  ok(await until(async () => /GNU GENERAL PUBLIC LICENSE/.test(await page.locator("#legalBody").textContent()), 3000) && await page.locator("#legalTitle").textContent() === "License", "About → License: the notice and the GNU GPL v3");
  await page.keyboard.press("Escape"); ok(await until(() => page.locator("#legalDlg").isHidden(), 3000), "The dialog closes with Esc");

  ok(!errors.length, "No page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed` : "\nAll passed (settings)");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
