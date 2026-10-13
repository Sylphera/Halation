// The updater (docs/UPDATES.md; updates.js, processes.js notice, sessions.js resume, update.rs mocked in host.js):
// 1. A new version asks at the start: notes, Update / Later / Skip this version / Don't show again. Later leaves a
//    quiet row in Activity and a dot on the island; Skip silences that version only.
// 2. "Check for updates" in Settings asks even for a skipped version; "Don't show again" moves to Activity only.
// 3. Update downloads as a job; ready: "Install on close" leaves it pending, Activity offers the restart.
// 4. "Save session & restart" saves the session and what stopped; the next start shows What's new once, with
//    what stopped, and takes the session back without asking.
// 5. The portable copy offers "Download", which opens the release page.
// Screenshots → $SHOTS/updates.
// Usage: node app/tests/updates.js
const fs = require("fs"), os = require("os"), path = require("path");
const { until, painted, serve, launch, openApp } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "updates");
fs.mkdirSync(SHOTS, { recursive: true });
const FX = makeFixtures(), TOOLS = toolOptions(FX);
const root = fs.mkdtempSync(path.join(FX.TMP, "updates-"));
const host = createHost(root, TOOLS);
const appFile = path.join(host.base, "Settings", "app.json");
const appState = () => JSON.parse(fs.readFileSync(appFile, "utf8"));
const CURRENT = require("../package.json").version;
const NOTES = "## 9.0.0\n\n### New\n- **Updater**: Halation updates itself.\n- `Activity` shows the download.\n\n### Fixed\n- A [linked](https://example.com) fix.";
fs.mkdirSync(path.dirname(appFile), { recursive: true });
fs.writeFileSync(appFile, JSON.stringify({ settings: { version: 2, language: "en", artistName: "Nova" }, update: { seen: CURRENT } }));
host.setUpdate({ version: "9.0.0", notes: NOTES });

(async () => {
  const server = serve(), browser = await launch();
  const errors = [];
  let app, page;
  const open = async () => { app = await openApp(browser, server, host, { width: 1480, height: 920 }); page = app.page; page.on("pageerror", e => errors.push(String(e))); };
  // clean: closed by hand (the next start opens empty); otherwise as the updater leaves it (the session stays)
  const restart = async (clean = true) => { if (clean) await host.call("app_quit"); await page.close(); host.begin(); await open(); };
  const shot = n => painted(page).then(() => page.screenshot({ path: path.join(SHOTS, n + ".png") }));
  const dlg = () => page.locator("#updDlg");
  const dialogOpen = (ms = 12000) => until(() => dlg().evaluate(d => d.open), ms, 50);
  const press = async value => { await dlg().locator(`button[value="${value}"]`).click(); await until(async () => !await dlg().evaluate(d => d.open), 3000, 30); };
  const prefs = () => (appState().settings || {}).updates || {};
  const notice = () => page.locator("#procTray .prow.notice");
  const openTray = async () => { if (!await page.locator("#procTray").isVisible()) await page.locator("#procBtn").click(); await until(() => page.locator("#procTray").isVisible(), 3000, 30); };
  const closeTray = async () => { if (await page.locator("#procTray").isVisible()) { await page.keyboard.press("Escape"); await until(async () => !await page.locator("#procTray").isVisible(), 3000, 30); } };

  /* ---------- 1: asked at the start ---------- */
  await open();
  ok(await dialogOpen(), "A newer version opens the update dialog some seconds after the start");
  ok((await page.locator("#uTitle").textContent()).includes("9.0.0") && (await page.locator("#uSub").textContent()).includes(CURRENT), "The dialog names the new version and the current one");
  ok(await page.locator("#uNotes li").count() === 3 && await page.locator("#uNotes h3").count() === 3 && await page.locator("#uNotes b").count() === 1 && !(await page.locator("#uNotes").innerHTML()).includes("example.com"), "The release notes render as headings and lists; links keep only their text");
  ok(JSON.stringify(await dlg().locator("button").evaluateAll(b => b.map(x => x.value))) === JSON.stringify(["never", "skip", "later", "update"]), "Buttons: Don't show again, Skip this version, Later, Update");
  await shot("1-available");
  await press("later");
  ok(await until(() => page.locator("#procIsland.has-notice").count().then(n => n === 1), 3000, 30), "Later: the island carries a quiet dot");
  await openTray();
  ok(await notice().isVisible() && (await notice().textContent()).includes("9.0.0"), "Later: Activity lists the available version");
  await shot("2-activity");
  await notice().locator("[data-act=notice]").click();
  ok(await dialogOpen(3000), "The Activity row opens the update dialog again");
  await press("skip");
  ok(await until(() => prefs().skip === "9.0.0", 3000, 30), "Skip this version is remembered");
  await openTray();
  ok(await notice().count() === 0 && await page.locator("#procIsland.has-notice").count() === 0, "A skipped version leaves Activity and the island quiet");
  await closeTray();

  /* ---------- 2: Settings ---------- */
  await app.tab("settings");
  ok(await page.locator("#setUpdates").inputValue() === "ask" && await page.locator("#setWhatsNew").isChecked(), "Settings → Updates: ask at the start and What's new on by default");
  ok((await page.locator("#updStatus").textContent()).includes("9.0.0"), "Settings says which version is available");
  await page.locator("#updCheck").click();
  ok(await dialogOpen(5000), "Check for updates asks even for a skipped version");
  await press("never");
  ok(await until(() => prefs().notify === "activity", 3000, 30) && await page.locator("#setUpdates").inputValue() === "activity", "Don't show again: new versions only show in Activity (Settings follows)");
  await page.locator("#sg-about").scrollIntoViewIfNeeded();
  await shot("3-settings");

  /* ---------- 3: download, install on close ---------- */
  ok(await page.locator("#updAction").isVisible(), "Settings offers Update for the version found");
  await page.locator("#updAction").click();
  ok(await dialogOpen(8000), "The download ends in the install dialog");
  ok(await page.evaluate(() => window.__hal.jobs.list().some(j => j.kind === "update" && j.state === "done")), "The download ran as a job in Activity");
  ok(JSON.stringify(await dlg().locator("button").evaluateAll(b => b.map(x => x.value))) === JSON.stringify(["close", "restart"]), "Ready: Install on close, Save session & restart");
  await shot("4-ready");
  await press("close");
  ok(await until(() => host.session.updateInstall === "close", 3000, 30), "Install on close: the setup waits for the app to close");
  ok((await page.locator("#updStatus").textContent()).includes("close"), "Settings says it installs on close");
  await openTray();
  ok(await notice().isVisible() && (await notice().locator("[data-act=notice]").textContent()).length > 0, "Activity offers the restart for the downloaded version");
  await shot("5-pending");
  await closeTray();

  /* ---------- 4: save session & restart, then What's new ---------- */
  await restart();
  host.setUpdate({ version: "9.0.0", notes: NOTES });
  // some work in Grade, which the restart must keep
  await app.tab("grade"); await app.appReady("grade");
  const pct = await page.frameLocator("#v-grade").locator("#thumbPct").evaluate(e => { e.value = String(+e.value <= 5 ? 100 : +e.value - 5); e.dispatchEvent(new Event("input", { bubbles: true })); return e.value; });
  await app.tab("settings");
  await page.locator("#updCheck").click();
  ok(await dialogOpen(5000), "A manual check asks again in a new start");
  await press("update");
  ok(await dialogOpen(8000), "Downloaded again");
  await press("restart");
  ok(await until(() => host.session.updateInstall === "restart", 5000, 30), "Save session & restart installs and restarts");
  ok(fs.existsSync(path.join(host.base, "Sessions", ".recovery.json")), "Save session & restart writes the session for recovery first");
  const resume = appState().updateResume;
  ok(resume && resume.to === "9.0.0" && resume.from === CURRENT && Array.isArray(resume.stopped), "The restart leaves the note for the next start: " + JSON.stringify(resume));
  // the next start is the new version: its notes were kept at the check
  const st = appState(); st.update.seen = "1.0.0"; st.update.notes.version = CURRENT; st.updateResume.stopped = ["Upscale · cover"];
  fs.writeFileSync(appFile, JSON.stringify(st));
  host.setUpdate(null);
  await restart(false);
  ok(await dialogOpen(), "After an update, What's new opens once");
  ok((await page.locator("#uTitle").textContent()).includes(CURRENT) && (await page.locator("#uSub").textContent()).includes("Upscale · cover") && await page.locator("#uNotes li").count() === 3, "What's new: the version, what the restart stopped and the notes");
  await shot("6-whats-new");
  await press("page");
  ok(await until(() => host.log.some(e => e[0] === "update_page" && e[1] === CURRENT), 3000, 30), "Release page opens the version's page");
  ok(!await page.locator("#modal").evaluate(d => d.open), "After Save session & restart the session comes back without the recovery question");
  await app.tab("grade"); await app.appReady("grade");
  ok(await until(async () => await page.frameLocator("#v-grade").locator("#thumbPct").inputValue() === pct, 8000, 50), "Grade's work is back as it was before the restart");
  ok(await until(() => appState().update.seen === CURRENT && !appState().updateResume, 3000, 30), "What's new is marked seen and the restart note cleared");
  await restart();
  await page.waitForTimeout(1500);
  ok(!await dlg().evaluate(d => d.open), "What's new shows only once");

  /* ---------- 5: portable ---------- */
  host.setUpdate({ version: "9.0.0", notes: NOTES, portable: true });
  await restart();
  await app.tab("settings");
  await page.locator("#updCheck").click();
  ok(await dialogOpen(5000) && (await dlg().locator('button[value="update"]').textContent()) === "Download" && (await page.locator("#uSub").textContent()).includes("portable"), "Portable: the dialog says so and offers Download");
  await shot("7-portable");
  await press("update");
  ok(await until(() => host.log.filter(e => e[0] === "update_page" && e[1] === "9.0.0").length === 1, 3000, 30) && !host.session.updateReady, "Portable: Download opens the release page and downloads nothing");

  /* ---------- 6: Halation Preview's simulated version (dev/updates-fixture.js) ---------- */
  host.setUpdate(null);
  await host.call("app_quit"); await page.close(); host.begin();
  app = await openApp(browser, server, host, { width: 1480, height: 920, init: () => { window.__halPreview = { missing() {} }; } }); page = app.page; page.on("pageerror", e => errors.push(String(e)));
  await app.tab("settings");
  ok(await page.locator("#updDev [data-upd-dev]").count() === 4, "Preview: Settings → Updates has the simulation buttons");
  await page.locator('[data-upd-dev="installed"]').click();
  ok(await dialogOpen(5000) && (await page.locator("#uTitle").textContent()).includes("1.2.0"), "Preview: a simulated 1.2.0 opens the dialog");
  await press("update");
  ok(await dialogOpen(15000), "Preview: the simulated download ends in the install dialog");
  await press("restart");
  ok(await until(() => page.evaluate(() => document.readyState === "complete" && !!window.__updates && window.__updates.current !== ""), 15000, 100) && await dialogOpen(), "Preview: Save session & restart reloads the window into What's new");
  ok((await page.locator("#uTitle").textContent()).includes(CURRENT) && await page.locator("#uNotes li").count() === 4, "Preview: What's new shows the simulated notes");
  await shot("8-preview-whats-new");
  await press("ok");
  ok(!host.session.updateInstall, "Preview: nothing reached the real installer");

  ok(!errors.length, "No page errors" + (errors.length ? ": " + errors.join(" | ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed` : "\nAll passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
