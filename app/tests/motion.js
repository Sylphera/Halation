// Motion tests (docs/ARCHITECTURE.md → Motion), with animations on:
// 0. Places and waits (docs/MOTION.md): the boot skeleton goes, the four motion tokens, hovering a dock icon preloads
//    its tool, a slow tool shows its skeleton until it is ready, a view grows from its dock icon out of focus, loops
//    run only while shown, the switches and pills settle on the spring.
// 1. The animations run: rail pill, tab switches, menus, dialogs, toasts, accordions, keyed lists, progress bars.
// 2. Performance trace: no main-thread task longer than 50 ms while transitions play (Chromium tracing).
// 3. Interruptions: fast repeated clicks leave nothing half-animated (no running animations, no inline leftovers).
// 4. Reduced motion (system setting and Settings → "Reduce animations"): short fades only, nothing moves.
// Usage: node app/tests/motion.js   Screenshots go to $SHOTS/motion.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { sleep, until, serve, launch, openApp, locale } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "motion");
fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const { L } = locale("en");

const FX = makeFixtures(), TOOLS = toolOptions(FX), fx = n => path.join(FX.FIX, n);
const host = createHost(FX.TMP, { tools: TOOLS.tools });
fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en" } }));

// Animations running in the main window and in every frame
// the atmosphere's grain (atmosphere.js) breathes on Home for good: it is the window's background, not an interface move;
// the processes island turns its lines over at rest every few seconds (processes.js), on its own clock
// (CSS loops and transitions in document.getAnimations(), GSAP tweens and Flips in the page's gsap timeline)
const gsapActive = () => window.__motion ? window.__motion.gsap.globalTimeline.getChildren(true, true, false).filter(t => t.progress() < 1) : [];
const running = page => Promise.all(page.frames().map(f => f.evaluate(gs => document.getAnimations().filter(a => a.playState === "running" && !(a.effect && a.effect.target && a.effect.target.closest && a.effect.target.closest(".grain, #procIsland"))).length + eval(gs)().filter(t => !t.targets().some(el => el.closest && el.closest("#procIsland"))).length, "(" + gsapActive + ")").catch(() => 0))).then(a => a.reduce((x, y) => x + y, 0));
// Anything moving in one frame (CSS or GSAP), and whether any GSAP target is inside `sel`
const frameAnims = f => f.evaluate(gs => document.getAnimations().length + eval(gs)().length, "(" + gsapActive + ")");
const movesInside = (f, sel) => f.evaluate(([gs, sel]) => document.getAnimations().some(a => a.effect.target.closest(sel)) || eval(gs)().some(t => t.targets().some(el => el.closest && el.closest(sel))), ["(" + gsapActive + ")", sel]);
const settle = page => until(async () => (await running(page)) === 0, 4000, 50);
// Anything that moves (not only fades): CSS animations and transitions, GSAP tweens of anything but opacity
const META = ["opacity", "duration", "delay", "ease", "overwrite", "immediateRender", "onComplete", "startAt", "runBackwards", "stagger", "parent", "data", "callbackScope", "onInterrupt", "force3D"];
const moverList = () => { const m = window.__motion; const g = m ? m.gsap.globalTimeline.getChildren(true, true, false).filter(t => t.progress() < 1 && Object.keys(t.vars).some(k => !META.includes(k))) : []; return document.getAnimations().length + g.length; };
const moves = page => Promise.all(page.frames().map(f => f.evaluate("(" + moverList + ")()").catch(() => 0))).then(a => a.reduce((x, y) => x + y, 0));

// Long tasks in a Chromium trace: complete events of the renderer main thread longer than 50 ms
function longTasks(trace) {
  const ev = JSON.parse(trace.toString()).traceEvents || [];
  const main = new Set(ev.filter(e => e.ph === "M" && e.name === "thread_name" && e.args && e.args.name === "CrRendererMain").map(e => e.pid + ":" + e.tid));
  return ev.filter(e => e.ph === "X" && main.has(e.pid + ":" + e.tid) && /^(RunTask|ThreadControllerImpl::RunTask)$/.test(e.name) && e.dur > 50000).map(e => Math.round(e.dur / 1000));
}

(async () => {
  const server = serve(), browser = await launch();
  const app = await openApp(browser, server, host, { motion: true });
  const { page, errors, vis, grade, tab, appReady } = app;
  const shot = n => process.argv.includes("--functional") ? Promise.resolve() : page.screenshot({ path: path.join(SHOTS, n + ".png") });
  const tabBtn = n => page.locator(`.rail .tab[data-tab=${n}]`);

  // every element.animate() call is logged, so a check never depends on sampling a short animation in time
  const logAnims = f => f.evaluate(() => { if (window.__animLog || !window.__motion) return; window.__animLog = []; window.__motion._log = el => window.__animLog.push(el); });
  const animated = (f, sel) => until(() => f.evaluate(sel => { const hit = window.__animLog.some(el => el.matches && el.matches(sel)); window.__animLog.length = 0; return hit; }, sel), 1500, 30);
  const clearLog = f => f.evaluate(() => { window.__animLog.length = 0; });
  // CSS and script animations on an element (its pseudo-elements included)
  const animsOn = (f, sel) => f.evaluate(sel => document.getAnimations().filter(a => a.effect && a.effect.target && a.effect.target.matches(sel)).length, sel);

  /* ================= 0: waits and the tool opening ================= */
  ok(await until(() => page.evaluate(() => !document.querySelector("#bootSkel")), 2000), "The boot skeleton is gone once the app has started");
  const durs = await page.evaluate(() => Object.fromEntries(["spring", "place", "fade", "stagger"].map(n => [n, parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--" + n))])));
  ok(durs.spring <= 340 && durs.place === 300 && durs.fade <= 160 && durs.stagger <= 40, "Motion tokens: main transitions settle at 300 ms: " + JSON.stringify(durs));
  const sp = await page.evaluate(() => { const f = window.__motion.spring(0), g = window.__motion.spring(6); return { at42: f(0.42), end: f(1), start: f(0.05), carried: g(0.05) }; });
  ok(sp.at42 > 0.88 && sp.end === 1 && sp.carried > sp.start * 2, "The spring: 90 % at 42 % of its time, settled at the end, a carried speed starts faster: " + JSON.stringify(sp));
  const src = n => page.evaluate(n => document.querySelector("#v-" + n).getAttribute("src"), n);
  ok(!(await src("downloader")), "A tool is not loaded before it is wanted");
  await tabBtn("downloader").hover();
  ok(await until(async () => !!(await src("downloader")), 1500), "Hovering its dock icon starts loading it");
  await page.mouse.move(700, 500);
  // Frame rate's page held back, as on a slow PC: its skeleton shows until the page is ready
  let release; const gate = new Promise(r => { release = r; });
  await page.route(/interp\.html$/, async r => { await gate; r.continue().catch(() => {}); });
  await logAnims(page.mainFrame());
  await tabBtn("interp").click();
  const tl = () => page.evaluate(() => { const e = document.querySelector("#toolSkel"); return { shown: !e.hidden, tab: e.dataset.tab || "", label: e.getAttribute("aria-label"), cols: e.querySelectorAll(".col.skel").length, pe: getComputedStyle(e).pointerEvents, pending: document.querySelector("#v-interp").classList.contains("pending") }; });
  ok(await until(async () => (await tl()).shown, 1500), "A tool still loading shows its skeleton");
  const t0 = await tl();
  ok(t0.tab === "interp" && t0.label === L("shell.loadingTool", { name: L("tab.interp") }) && t0.cols === 2 && t0.pe === "none" && t0.pending, "…its two columns, named for screen readers, never taking a click, the page kept out of sight: " + JSON.stringify(t0));
  ok(await animated(page.mainFrame(), "#toolSkel"), "…it comes out of the dock icon");
  ok(await animsOn(page.mainFrame(), "#toolSkel .col") >= 2, "…crossed by its light");
  await sleep(300); await shot("0a-tool-skeleton");
  release(); await appReady("interp"); await page.unroute(/interp\.html$/);
  ok(await until(async () => { const x = await tl(); return !x.shown && !x.pending; }, 3000), "The skeleton fades into the tool once it is ready");
  ok(await until(() => animsOn(page.mainFrame(), "#toolSkel .col").then(n => n === 0), 1500), "…and nothing of it keeps running");
  // Capture creation in the click's turn: a CDP round trip can outlive the 150 ms exit.
  const { birth, place } = await page.evaluate(() => {
    document.querySelector('.rail .tab[data-tab=library]').click();
    const v = document.querySelector("#views").getBoundingClientRect();
    const [x, y] = document.documentElement.style.getPropertyValue("--birth-o").split(" ").map(parseFloat);
    const tw = window.__motion.gsap.globalTimeline.getChildren(true, true, false).filter(t => t.progress() < 1);
    const on = id => tw.find(t => t.targets().some(e => e.id === id)), n = on("v-library"), o = on("v-interp");
    return { birth: { x, y, ex: v.width / 2, ey: v.height / 2 }, place: { inFilter: !!(n && n.vars.filter), inScale: n && n.vars.scaleX, outFilter: !!(o && o.vars.filter), outScale: o && o.vars.scaleX } };
  });
  ok(Math.abs(birth.x - birth.ex) <= 1 && Math.abs(birth.y - birth.ey) <= 1 && birth.x > 0, "The view grows from the center of the viewport: " + JSON.stringify(birth));
  ok(!place.inFilter && place.inScale >= 1 && place.inScale <= 1.005 && !place.outFilter && place.outScale === .992, "Changing place: centered microcompression and a few pixels of directional stretch, without blur: " + JSON.stringify(place));
  await settle(page);
  await tabBtn("settings").click(); await settle(page);
  const prog = sel => page.evaluate(sel => { const p = document.querySelector(sel); p.hidden = false; return true; }, sel);
  await prog("#toolsProg");
  ok(await animsOn(page.mainFrame(), "#toolsBar") === 0, "A progress bar with a value has no loop: it only moves to each new value");
  await page.evaluate(() => { const p = document.querySelector("#toolsProg"); p.classList.add("indet"); });
  ok(await animsOn(page.mainFrame(), "#toolsBar") === 1, "…of unknown length: one light crosses it");
  await page.evaluate(() => { const p = document.querySelector("#toolsProg"); p.hidden = true; });
  ok(await animsOn(page.mainFrame(), "#toolsBar") === 0, "…hidden: nothing runs");
  await page.evaluate(() => document.querySelector("#toolsProg").classList.remove("indet"));
  const tog = await page.evaluate(() => getComputedStyle(document.querySelector("#setReduceMotion"), "::after").transitionTimingFunction);
  ok(/linear\(/.test(tog), "Switches slide on the spring");

  /* ---------- warm up: every view loaded once ---------- */
  for (const n of ["visualizer", "grade", "downloader", "upscale", "intro", "library", "settings", "home"]) { await tab(n); if (["visualizer", "grade", "intro"].includes(n)) await appReady(n); }
  await grade.locator("#imgIn").setInputFiles(fx("cover.png"));
  await until(async () => /cover\.png/.test(await grade.locator("#imgName").textContent()));
  await tab("home"); await settle(page);

  for (const f of page.frames()) await logAnims(f);

  /* ================= 1: the animations run ================= */
  const pillY = () => page.evaluate(() => { const p = document.querySelector("#railPill"), b = document.querySelector('.rail .tab[aria-selected="true"]'); return Math.abs(p.getBoundingClientRect().top + p.offsetHeight / 2 - (b.getBoundingClientRect().top + b.offsetHeight / 2)); });
  await clearLog(page.mainFrame()); await tabBtn("library").click();
  ok(await animated(page.mainFrame(), "#railPill"), "Rail pill slides (GSAP, on the spring)");
  ok(await until(async () => (await pillY()) < 1, 2000), "The pill ends centred on the selected tab");
  await settle(page); await clearLog(page.mainFrame());
  const vorg = await page.evaluate(() => {
    document.querySelector('.rail .tab[data-tab=settings]').click();
    return [document.querySelector("#v-settings").style.transformOrigin, document.documentElement.style.getPropertyValue("--birth-o")];
  });
  ok(await animated(page.mainFrame(), "#v-settings"), "Switching to a light view: it grows in (GSAP)");
  ok(vorg[0] === "50% 50%", "…from the centered entrance origin: " + vorg.join(" / "));
  await settle(page); await clearLog(page.mainFrame());
  await tabBtn("visualizer").click(); await sleep(60);
  const vz = await page.evaluate(() => { const t = window.__motion.gsap.globalTimeline.getChildren(true, true, false).find(t => t.targets().some(e => e.id === "v-visualizer")); return { on: document.querySelector("#v-visualizer").classList.contains("on"), moved: !!t, blur: !!(t && t.vars.filter) }; });
  ok(vz.on && vz.moved && !vz.blur, "The Visualizer (live canvas) changes place without the blur: " + JSON.stringify(vz));
  await page.keyboard.press("Control+1");
  ok(await until(() => page.evaluate(() => document.querySelector("#v-home").classList.contains("on")), 1500), "Ctrl+1 goes to Home with animations on");
  await settle(page);

  await clearLog(page.mainFrame()); await page.locator("#langBtn").click();
  ok(await animated(page.mainFrame(), "#langMenu"), "Language menu grows from the globe");
  const origin = await page.locator("#langMenu").evaluate(m => m.style.transformOrigin);
  ok(/px/.test(origin), "…with its transform origin at the button: " + origin);
  await settle(page); await shot("1a-language-menu");
  await page.keyboard.press("Escape");
  ok(await until(() => page.locator("#langMenu").isHidden(), 1500), "Esc closes it after its exit");

  await clearLog(page.mainFrame()); await page.locator("#keysBtn").click();
  ok(await animated(page.mainFrame(), "#keys") && await page.locator("#keys").isVisible(), "Shortcuts dialog scales in");
  await settle(page); await shot("1b-dialog");
  await page.keyboard.press("Escape");
  ok(await page.locator("#keys").evaluate(d => d.open), "Esc plays the exit before closing");
  ok(await until(() => page.locator("#keys").evaluate(d => !d.open), 1500), "…and then the dialog is closed");

  await clearLog(page.mainFrame()); await page.evaluate(() => window.__hal.toast("Motion test"));
  ok(await animated(page.mainFrame(), "#toast"), "Toast slides in");

  await tab("visualizer"); await settle(page);
  const sec = vis.locator("#sec-bass");
  const wasOpen = await sec.evaluate(d => d.open);
  await sec.locator("summary").click(); await sleep(20);
  const accAnims = await frameAnims(app.vFrame());
  ok(accAnims > 0, `Visualizer accordion animates (${accAnims} animations: content and what follows)`);
  ok(!(await movesInside(app.vFrame(), ".stage,.bezel")), "The preview canvas is never animated");
  await settle(page);
  ok(await sec.evaluate(d => d.open) === !wasOpen, "The accordion ends toggled");
  await sec.locator("summary").click(); await settle(page);

  await tab("grade"); await settle(page);
  await grade.locator(".tab[data-tab=filters]").click();
  await clearLog(app.gFrame()); await grade.locator('.tile[data-look="nordic"] [data-tact=add]').click();
  ok(await animated(app.gFrame(), "#listF .layer"), "A new Grade layer scales in");
  await settle(page);
  await grade.locator('.tile[data-look="cine-teal"] [data-tact=add]').click(); await settle(page);
  await clearLog(app.gFrame()); await grade.locator("#listF .layer").nth(0).locator("[data-act=more]").click();
  ok(await animated(app.gFrame(), "#lmenu"), "⋯ menu grows from its button");
  await settle(page);
  await clearLog(app.gFrame()); await grade.locator('#lmenu [data-m="bottom"]').click();
  ok(await animated(app.gFrame(), "#listF .layer"), "Moving a layer slides the rows (FLIP)");
  await settle(page);
  await clearLog(app.gFrame()); await grade.locator("#listF .layer").nth(0).locator(".lname").click();
  ok(await animated(app.gFrame(), "#listF .lparams"), "Expanding a layer fades its settings in");
  await settle(page);
  await grade.locator("#listF .layer").nth(0).locator("[data-act=more]").click(); await settle(page);
  await clearLog(app.gFrame());
  await grade.locator('#lmenu [data-m="del"]').click();
  ok(await animated(app.gFrame(), "[data-ghost]"), "A deleted layer fades out on a ghost");
  ok(await until(() => app.gFrame().evaluate(() => !document.querySelector("#listF [data-ghost]")), 1500) && await grade.locator("#listF .layer").count() === 1, "The ghost goes away and one layer is left");
  await grade.locator(".tab[data-tab=tools]").click();
  await grade.locator(".acc > summary", { hasText: L("grade.grp.light") }).click(); await sleep(20);
  ok((await frameAnims(app.gFrame())) > 0, "Grade tool groups open with an animation");
  await settle(page);
  await shot("1c-grade");
  // sub-tabs and panels, the filter grid and the segmented pill (0.5.0 audit, docs/ARCHITECTURE.md → Motion)
  const G = app.gFrame();
  await clearLog(G); await grade.locator(".tab[data-tab=mine]").click();
  ok(await animated(G, ".seg-pill"), "The segmented pill slides (GSAP, on the spring)");
  await clearLog(G); await grade.locator(".tab[data-tab=filters]").click(); await settle(page);
  await clearLog(G); await grade.locator(".tab[data-tab=mine]").click();
  ok(await animated(G, "#pane-mine"), "Grade library sub-tab: the new pane fades in");
  await clearLog(G); await grade.locator('.ltab[data-ltab="E"]').click();
  ok(await animated(G, "#listE"), "Grade layer tabs: the other list fades in");
  await grade.locator('.ltab[data-ltab="F"]').click(); await grade.locator(".tab[data-tab=filters]").click(); await settle(page);
  await clearLog(G); await grade.locator("#chips .chip").nth(1).click();
  ok(await animated(G, ".tile"), "Filter grid: a category slides and scales the tiles");
  await grade.locator("#chips .chip").nth(0).click(); await settle(page);
  await clearLog(G); await grade.locator('.tile[data-look="slide"] [data-tact=add]').click();
  ok(await animated(G, '.tile[data-look="slide"] > i'), "A filter that goes on pops its badge on the tile");
  await settle(page);
  await tab("visualizer"); const VF = app.vFrame();
  await VF.evaluate(() => { document.getElementById("xDialog").showModal(); document.querySelector("#xMode [data-mode=single]").click(); });
  await clearLog(VF); await vis.locator('#xMode [data-mode="layers"]').click();
  ok(await animated(VF, "#xLayers"), "Export dialog: switching to layers fades the layer options in");
  await vis.locator('#xMode [data-mode="single"]').click(); await VF.evaluate(() => document.getElementById("xDialog").close()); await settle(page);

  // Intro: inspector panes, a pane rebuilt by a choice, new elements and their tracks; the stage never moves
  await tab("intro"); const IF = app.iFrame();
  await clearLog(IF); await IF.locator('#inspTabs [data-itab="clip"]').click();
  ok(await animated(IF, "#pane-clip"), "Intro: another inspector pane fades in");
  await IF.locator('#inspTabs [data-itab="element"]').click(); await settle(page);
  await clearLog(IF); await IF.locator("#pane-element .mats button:nth-child(5)").click();
  ok(await animated(IF, "#pane-element .warnbox"), "Intro: choosing Inverse brings its notice and fields in (keyed rebuild)");
  await settle(page); await clearLog(IF); await IF.locator("#addText").click();
  ok(await animated(IF, "#elList .item"), "Intro: a new element scales into the list");
  await settle(page); await clearLog(IF); await IF.locator("#addText").click();
  ok(await animated(IF, "#tracks .track"), "Intro: …and its track into the timeline");
  ok(!(await movesInside(IF, ".stage,.bezel")), "The Intro stage is never animated");
  await settle(page);

  // progress bars move with transform
  const bar = await page.evaluate(() => { const i = document.querySelector("#toolsBar"); i.parentElement.hidden = false; document.querySelector("#v-settings").classList.add("on"); window.__motion.bar(i, 0.4); const v = getComputedStyle(i).transform; i.parentElement.hidden = true; document.querySelector("#v-settings").classList.remove("on"); return v; });
  ok(/matrix/.test(bar), "Progress bars fill with transform: " + bar);

  /* ================= 2: performance trace of the transitions ================= */
  await tab("home"); await settle(page);
  await browser.startTracing(page, { categories: ["toplevel", "devtools.timeline", "disabled-by-default-devtools.timeline"] });
  for (let k = 0; k < 2; k++) {
    for (const n of ["library", "settings", "downloader", "upscale", "home"]) { await tabBtn(n).click(); await sleep(380); }
    await page.locator("#langBtn").click(); await sleep(250); await page.keyboard.press("Escape"); await sleep(200);
    await page.locator("#keysBtn").click(); await sleep(300); await page.keyboard.press("Escape"); await sleep(300);
    // the processes dot: a job ends (its pill), then the tray opens and closes (Ctrl+J, Esc)
    await page.evaluate(() => window.__shell.jobs.submit({ tool: "upscale", title: "cover.png", lane: "cpu", run: async ctx => { ctx.output("/tmp/cover.png"); return 1; } }).done);
    await sleep(450); await page.keyboard.press("Control+j"); await sleep(380); await page.keyboard.press("Escape"); await sleep(300);
  }
  await tabBtn("visualizer").click(); await sleep(200);
  for (const id of ["#sec-bass", "#sec-text", "#sec-bass", "#sec-text"]) { await vis.locator(id + " > summary").click(); await sleep(320); }
  await tabBtn("home").click(); await sleep(400);
  const trace = await browser.stopTracing();
  fs.writeFileSync(path.join(SHOTS, "transitions-trace.json"), trace);
  const long = longTasks(trace);
  ok(long.length === 0, `No task over 50 ms during transitions (trace ${(trace.length / 1e6).toFixed(1)} MB)` + (long.length ? ": " + long.join(", ") + " ms" : ""));
  // Frames during each transition (requestAnimationFrame in the main window): frames per second and the longest frame.
  const frames = async act => {
    await page.evaluate(() => { window.__fr = []; let last = performance.now(); const f = t => { window.__fr.push(t - last); last = t; if (window.__fr.length < 400) window.__frId = requestAnimationFrame(f); }; window.__frId = requestAnimationFrame(f); });
    const t0 = Date.now(); await act(); await sleep(Math.max(0, 650 - (Date.now() - t0)));
    return page.evaluate(() => { cancelAnimationFrame(window.__frId); const d = window.__fr.slice(1), sum = d.reduce((a, b) => a + b, 0); return { fps: Math.round(d.length / (sum / 1000)), worst: Math.round(Math.max(...d)) }; });
  };
  const fr = {};
  fr.homeToLibrary = await frames(() => tabBtn("library").click());
  fr.libraryToSettings = await frames(() => tabBtn("settings").click());
  fr.backHome = await frames(() => tabBtn("home").click());
  fr.menu = await frames(() => page.locator("#langBtn").click()); await page.keyboard.press("Escape"); await settle(page);
  fr.dialog = await frames(() => page.locator("#keysBtn").click()); await page.keyboard.press("Escape"); await settle(page);
  fr.toGrade = await frames(() => tabBtn("grade").click());
  fr.gradeHome = await frames(() => tabBtn("home").click()); await settle(page);
  // reported, not checked: in this container the page is drawn in software (the atmosphere alone takes most of it)
  console.log("INFO Frames per transition (fps / longest frame ms): " + Object.entries(fr).map(([k, v]) => `${k} ${v.fps}/${v.worst}`).join(", "));

  /* ================= 3: interruptions ================= */
  for (let k = 0; k < 7; k++) { await page.locator("#langBtn").click({ delay: 0 }); await sleep(15); }
  await settle(page);
  const lm = await page.evaluate(() => { const m = document.querySelector("#langMenu"), b = document.querySelector("#langBtn"); return { open: b.getAttribute("aria-expanded") === "true", hidden: m.hidden, op: getComputedStyle(m).opacity, tf: getComputedStyle(m).transform }; });
  ok(lm.open === !lm.hidden && lm.open && lm.op === "1" && lm.tf === "none", "Language menu after 7 fast clicks: open, fully visible, not scaled: " + JSON.stringify(lm));
  await page.keyboard.press("Escape"); await settle(page);
  for (const n of ["library", "settings", "home", "downloader", "library", "upscale", "settings", "home"]) { await tabBtn(n).click(); await sleep(10); }
  await settle(page);
  ok(await page.evaluate(() => document.querySelectorAll(".view.on").length === 1 && document.querySelector("#v-home").classList.contains("on")), "8 fast tab switches end on the last one, with one view shown");
  ok(await until(async () => (await pillY()) < 1, 2000), "The pill follows the fast switches to the last tab");
  await tab("visualizer");
  for (let k = 0; k < 5; k++) { await vis.locator("#sec-logo > summary").click(); await sleep(25); }
  await settle(page);
  const acc = await app.vFrame().evaluate(() => { const d = document.querySelector("#sec-logo"), b = d.querySelector(".fields"), s = getComputedStyle(b); return { open: d.open, op: s.opacity, tf: s.transform, moved: [...document.querySelectorAll(".rack *")].filter(e => getComputedStyle(e).transform !== "none" && !/::|summary/.test(e.tagName) && e.closest("details") !== d).length }; });
  ok(acc.open && acc.op === "1" && acc.tf === "none", "Accordion clicked 5 times fast ends open and fully shown: " + JSON.stringify(acc));
  await tab("home");
  for (let k = 0; k < 4; k++) { await page.locator("#keysBtn").click(); await sleep(20); await page.keyboard.press("Escape"); await sleep(20); }
  await settle(page);
  ok(await page.locator("#keys").evaluate(d => !d.open), "Shortcuts opened and closed 4 times fast: closed at the end");
  ok(await running(page) === 0, "Nothing is left running after the interruptions");
  const leftovers = await Promise.all(page.frames().map(f => f.evaluate(() => [...document.querySelectorAll("[data-ghost]")].length).catch(() => 0)));
  ok(leftovers.every(n => n === 0), "No ghosts left behind");
  await shot("3a-after-interruptions");

  /* ================= 4: reduced motion ================= */
  await page.emulateMedia({ reducedMotion: "reduce" });
  await tabBtn("library").click(); await page.locator("#langBtn").click();
  const fades = await page.evaluate(() => window.__motion.gsap.globalTimeline.getChildren(true, true, false).filter(t => t.progress() < 1).map(t => Object.keys(t.vars).filter(k => !["duration", "delay", "ease", "overwrite", "immediateRender", "onComplete", "parent", "startAt"].includes(k)).join("+")));
  ok(await moves(page) === 0 && await page.locator("#langMenu").isVisible() && fades.every(f => f === "opacity"), "System reduced motion: menu and tab switch only fade, nothing moves: " + JSON.stringify(fades));
  await page.keyboard.press("Escape");
  ok(await until(() => page.locator("#langMenu").isHidden(), 600), "…and the menu fades out");
  await tab("visualizer"); await vis.locator("#sec-bass > summary").click();
  ok(await moves(page) === 0, "…accordions open without moving");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await tab("settings");
  await page.locator('label[for="setReduceMotion"]').click();
  ok(await until(() => { try { return JSON.parse(fs.readFileSync(path.join(host.base, "Settings", "app.json"), "utf8")).settings.reduceMotion === true; } catch (e) { return false; } }), "Settings → Reduce animations is saved");
  ok((await Promise.all(page.frames().map(f => f.evaluate(() => document.documentElement.dataset.motion)))).every(v => v === "reduce"), "…and applies to every loaded frame");
  await tabBtn("home").click(); await page.locator("#keysBtn").click();
  const left = await Promise.all(page.frames().map(f => f.evaluate(() => document.getAnimations().map(a => (a.effect && a.effect.target ? a.effect.target.id || a.effect.target.className : "") + (a.effect && a.effect.pseudoElement || "") + ":" + (a.animationName || a.transitionProperty || "js"))).catch(() => [])));
  left.push(...await Promise.all(page.frames().map(f => f.evaluate(gs => eval(gs)().map(t => "gsap:" + t.targets().map(el => el.id || el.className).join(",")), "(" + gsapActive + ")").catch(() => []))));
  ok(await moves(page) === 0, "With the setting on: tabs and dialogs only fade" + (left.flat().length ? ": " + left.flat().join(", ") : ""));
  await page.keyboard.press("Escape");
  ok(await until(() => page.locator("#keys").evaluate(d => !d.open), 600), "…and the dialog fades out");
  await tab("grade"); await grade.locator(".tab[data-tab=filters]").click(); await grade.locator('.tile[data-look="slide"]').click();
  ok(await moves(page) === 0, "…Grade layers without moving");
  await tab("intro"); await app.iFrame().locator("#pane-element .mats button:nth-child(1)").click(); await app.iFrame().locator("#addText").click();
  ok(await moves(page) === 0, "…Intro panes and lists without moving");
  await tab("settings"); await page.locator('label[for="setReduceMotion"]').click();
  ok(await until(() => page.evaluate(() => !document.documentElement.dataset.motion)), "Turning it off brings the animations back");
  await shot("4a-settings");

  const errs = errors.filter(e => !/favicon/.test(e));
  ok(errs.length === 0, "No console errors" + (errs.length ? ":\n  " + errs.join("\n  ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed (motion)` : "\nAll passed (motion)");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
