// The dock opened (docs/DOCK_SPEC.md): handle, Ctrl+B, double click, Esc and a choice close it over the content;
// kept open it makes room; each tool's activity from the jobs; F11 (docs/WINDOW_SPEC.md). Screenshots to $SHOTS/dock.
const assert = require("assert/strict"), fs = require("fs"), os = require("os"), path = require("path");
const { serve, launch, openApp, sleep, until } = require("./common"), { createHost } = require("./host");
const SHOTS = process.env.SHOTS && path.join(process.env.SHOTS, "dock");
(async () => {
  const server = serve(), browser = await launch(), host = createHost(fs.mkdtempSync(path.join(os.tmpdir(), "hal-dock-")));
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + ".png") }); };
  try {
    const { page, errors } = await openApp(browser, server, host, { width: 1480, height: 900 });
    const rail = () => page.evaluate(() => { const r = document.querySelector(".rail"), f = document.querySelector(".frame").getBoundingClientRect(), b = document.querySelector(".rail-bg").getBoundingClientRect();
      return { open: r.hasAttribute("data-expanded"), w: Math.round(r.getBoundingClientRect().width), left: Math.round(r.getBoundingClientRect().left), bg: Math.round(b.width), frameLeft: Math.round(f.left), frameW: Math.round(f.width),
        expanded: document.querySelector("#dockToggle").getAttribute("aria-expanded"), dock: document.body.dataset.dock || "" }; });
    const closed = await rail();
    assert.equal(closed.open, false); assert.equal(closed.w, 62); assert.equal(closed.left, 22, "closed dock stays where it was");
    await shot(page, "1-closed");

    // the handle opens it over the content: the tool does not move
    await page.click("#dockToggle");
    let r = await rail();
    assert.equal(r.open, true); assert.equal(r.expanded, "true"); assert.equal(r.w, 232); assert.equal(r.bg, 232);
    assert.equal(r.frameLeft, closed.frameLeft + 170, "wide window: the content makes room and stays centred in it (Home does not fit beside it at 1480)");
    assert.equal(await page.locator('.rail .tab[data-tab="grade"] .tl').isVisible(), true, "names shown");
    const iconX = () => page.evaluate(() => [...document.querySelectorAll(".rail .tab > .i, .rail .tab.home > img")].map(i => { const b = i.getBoundingClientRect(); return Math.round(b.left + b.width / 2); }));
    assert.deepEqual([...new Set(await iconX())], [53], "open: the icons stay in the closed dock's column");
    const tall = await page.evaluate(() => { const b = document.querySelector(".rail-bg").getBoundingClientRect(); return [Math.round(b.top), Math.round(innerHeight - b.bottom)]; });
    assert(tall[0] <= 14 && tall[1] <= 14, "open: the whole height " + tall);
    await shot(page, "2-open");
    await page.keyboard.press("Escape"); assert.equal((await rail()).open, false, "Esc closes");
    await page.keyboard.press("Control+b"); assert.equal((await rail()).open, true, "Ctrl+B opens");
    await page.keyboard.press("Control+b"); assert.equal((await rail()).open, false, "Ctrl+B closes");
    const gap = await page.locator(".rail .spacer").boundingBox();
    await page.mouse.dblclick(53, gap.y + gap.height / 2);
    assert.equal((await rail()).open, true, "double click on the empty surface opens");
    await page.mouse.click(900, 500); assert.equal((await rail()).open, false, "a click elsewhere closes");
    await page.click("#dockToggle"); await page.click('.rail .tab[data-tab="grade"] .tl');
    await until(() => page.evaluate(() => document.querySelector("#v-grade").classList.contains("on")));
    assert.equal((await rail()).open, false, "a choice closes it over the content");
    // Ctrl+B also with the focus inside a tool (Grade's own B, the original, ignores it)
    await page.frameLocator("#v-grade").locator("body").click({ position: { x: 600, y: 400 } }).catch(() => {});
    await page.frameLocator("#v-grade").locator("body").press("Control+b");
    assert.equal((await rail()).open, true, "Ctrl+B from inside a tool");
    await page.frameLocator("#v-grade").locator("body").press("Control+b");
    assert.equal((await rail()).open, false);
    await page.locator('.rail .tab[data-tab="home"]').click();

    // activity: running with progress, waiting, failed; failed clears once the tool is opened
    await page.evaluate(() => {
      const J = window.__shell.jobs; window.__rel = {};
      const job = (tool, lane, title, fn) => J.submit({ tool, lane, title, host: "page", cost: 1, run: ctx => new Promise((ok, no) => { window.__rel[title] = { ok, no, ctx }; if (fn) fn(ctx); }) });
      job("upscale", "light", "A very long artist name - A very long song title [extended mix].mp3", ctx => ctx.progress(0.42));
      J.submit({ tool: "convert", lane: "gpu", cost: 99, title: "a.wav", run: () => new Promise(() => {}) });
      J.submit({ tool: "convert", lane: "gpu", cost: 99, title: "b.wav", run: () => new Promise(() => {}) });
      J.submit({ tool: "convert", lane: "gpu", cost: 99, title: "c.wav", run: () => new Promise(() => {}) });
      J.submit({ tool: "grade", lane: "light", title: "bad.png", run: () => Promise.reject(new Error("broken")) });
    });
    const mark = id => page.evaluate(id => { const ts = document.querySelector(`.rail .tab[data-tab="${id}"] .ts`); return ts ? (ts.dataset.s || "") + "|" + ts.textContent.trim() : null; }, id);
    await until(async () => (await mark("upscale")) === "run|42 %" && (await mark("grade")) === "fail|", 5000);
    assert.match(await mark("convert"), /^(run|queue)\|/);
    await shot(page, "3-closed-activity");
    await page.keyboard.press("Control+b"); await sleep(100);
    assert.match(await page.locator('.rail .tab[data-tab="upscale"] .tl small').textContent(), /^A very long artist/);
    const spill = await page.evaluate(() => { const tab = document.querySelector('.rail .tab[data-tab="upscale"]'), tb = tab.getBoundingClientRect(), tl = tab.querySelector(".tl").getBoundingClientRect(), ts = tab.querySelector(".ts").getBoundingClientRect();
      return { inside: tl.right <= tb.right && ts.right <= tb.right, apart: tl.right <= ts.left + 0.5 }; });
    assert.deepEqual(spill, { inside: true, apart: true }, "a long file name ends in an ellipsis, clear of the mark");
    // a click inside the opened dock never opens a folder (the rail's open state once matched the folder buttons)
    await page.locator('.rail .tab[data-tab="upscale"] .tl').click(); await sleep(150);
    assert.equal(host.log.some(l => l[0] === "open_folder"), false, "no folder opens from the dock");
    await page.locator('.rail .tab[data-tab="home"]').click(); await page.keyboard.press("Control+b"); await sleep(100);
    await shot(page, "4-open-activity");
    await page.keyboard.press("Escape");
    await page.locator('.rail .tab[data-tab="grade"]').click();
    await until(async () => (await mark("grade")) === "|", 3000);
    await page.locator('.rail .tab[data-tab="home"]').click();

    // kept open: the content makes room once
    await page.evaluate(() => { const d = document.querySelector("#setDock"); d.value = "pinned"; d.dispatchEvent(new Event("change")); });   // choosing it opens it
    r = await rail();
    assert.equal(r.dock, "pinned"); assert.equal(r.frameLeft, closed.frameLeft + 170, "pinned: the content makes room");
    await page.mouse.click(900, 500); assert.equal((await rail()).open, true, "pinned stays open");
    await shot(page, "5-pinned");
    await page.keyboard.press("Control+b");
    assert.equal(await page.evaluate(() => window.__shell.st.settings.dockOpen), false, "pinned: closing is kept for the next start");
    await page.keyboard.press("Control+b");
    assert.equal(await page.evaluate(() => window.__shell.st.settings.dockOpen), true);
    await page.setViewportSize({ width: 1100, height: 760 });
    await until(async () => (await rail()).dock === "overlay", 3000).catch(() => {});
    assert.equal((await rail()).dock, "overlay", "narrow: pinned floats over the content");
    await page.setViewportSize({ width: 1480, height: 900 }); await sleep(150);
    // compact: no handle, Ctrl+B does nothing
    await page.evaluate(() => { const d = document.querySelector("#setDock"); d.value = "compact"; d.dispatchEvent(new Event("change")); });
    assert.equal(await page.locator("#dockToggle").isVisible(), false);
    await page.keyboard.press("Control+b"); assert.equal((await rail()).open, false);

    // F11: full screen through the backend
    await page.keyboard.press("F11");
    await until(() => host.log.some(l => l[0] === "window_fullscreen" && l[1] === true), 3000);
    await until(() => page.evaluate(() => document.body.textContent.includes("Press F11 to leave full screen")), 3000);
    await page.keyboard.press("F11");
    await until(() => host.log.some(l => l[0] === "window_fullscreen" && l[1] === false), 3000);
    await sleep(300);
    // the smallest window and Spanish names
    await page.evaluate(() => { const d = document.querySelector("#setDock"); d.value = "overlay"; d.dispatchEvent(new Event("change")); });
    await page.setViewportSize({ width: 960, height: 640 }); await sleep(200);
    await page.keyboard.press("Control+b"); await sleep(100);
    const fits = await page.evaluate(() => { const r = document.querySelector(".rail"), b = r.getBoundingClientRect(), t = document.querySelector("#dockToggle").getBoundingClientRect(); return b.top >= 0 && b.bottom <= innerHeight && r.scrollHeight <= r.clientHeight + 1 && t.bottom <= b.bottom; });
    assert(fits, "the open dock fits a 960 × 640 window");
    await shot(page, "6-open-960x640");
    await page.evaluate(() => window.__shell.setLanguage("es"));
    await until(() => page.evaluate(() => document.documentElement.lang === "es" && !!document.querySelector(".rail .tab[data-tab=grade]") && !document.body.classList.contains("booting")), 15000);
    await page.setViewportSize({ width: 1480, height: 900 }); await sleep(300);
    await page.keyboard.press("Control+b"); await sleep(200);
    await shot(page, "7-open-es");
    const cut = await page.evaluate(() => [...document.querySelectorAll(".rail .tab .tl > span")].filter(s => s.scrollWidth > s.parentNode.clientWidth + 1).map(s => s.textContent));
    assert.deepEqual(cut, [], "Spanish names fit");
    // a wide window: Home keeps the window's centre beside the opened dock; a tool makes room
    await page.keyboard.press("Escape"); await page.setViewportSize({ width: 1920, height: 1010 }); await sleep(300);
    const homeX = () => page.evaluate(() => { const b = document.querySelector("#hcards").getBoundingClientRect(); return Math.round(b.left + b.width / 2); });
    const centred = await homeX();
    await page.keyboard.press("Control+b"); await sleep(700);
    assert.equal((await rail()).dock, "overlay"); assert.equal(await homeX(), centred, "Home stays centred on the window");
    await page.keyboard.press("Escape");
    assert.deepEqual(errors, []);
    // with motion: the selected tab's surface and its bar ride with the rows while the dock opens (they stayed behind)
    const m = await openApp(browser, server, host, { width: 1920, height: 1010, motion: true }); await sleep(800);
    await m.page.keyboard.press("Control+b"); await sleep(1500);
    const off = await m.page.evaluate(() => { const p = document.querySelector(".rail>.hover-selector path").getBoundingClientRect(), t = document.querySelector('.rail .tab[aria-selected="true"]').getBoundingClientRect(), bar = document.querySelector("#railPill").getBoundingClientRect();
      return [p.top - t.top, bar.top + bar.height / 2 - (t.top + t.height / 2)].map(v => Math.abs(Math.round(v)) <= 1); });
    assert.deepEqual(off, [true, true], "the selected surface and its bar follow the rows");
    // the hover running over the icons: the selected tool's surface stays on it every frame (it flew off with the hover, up to 150 px; a few px is this rAF sampling against GSAP's tick)
    await m.page.keyboard.press("Control+b"); await sleep(1500);
    await m.page.evaluate(() => { window.__drift = []; const hs = document.querySelector(".rail>.hover-selector");
      const f = () => { const d = hs.querySelector("path").getAttribute("d") || "", p = hs.getBoundingClientRect(), s = document.querySelector('.rail .tab[aria-selected="true"]').getBoundingClientRect(), y = d.match(/^M[-\d.]+,([-\d.]+)H/);
        if (y) window.__drift.push(Math.abs(+y[1] + p.top - s.top)); if (window.__drift) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    for (const tb of ["grade", "covertest", "removebg", "upscale", "interp", "framegrab", "library", "settings", "upscale", "grade", "visualizer", "stems"]) {
      const b = await m.page.locator(`.rail .tab[data-tab=${tb}]`).boundingBox(); await m.page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 2 }); await sleep(60);
    }
    await m.page.mouse.move(900, 500); await sleep(1500);
    const drift = await m.page.evaluate(() => { const d = window.__drift; window.__drift = null; return d; });
    assert(drift.length > 5 && Math.max(...drift) <= 4, "the selected surface stays on its tool while the hover moves: " + Math.round(Math.max(...drift)));
    // tools chosen quickly, the dock mode changed between them: the bar ends beside the chosen tool (two glides
    // within one frame left the bar on an old row, the Preview of 2026-10-14)
    for (const [i, tb] of ["library", "stems", "interp", "removebg", "settings", "upscale", "grade"].entries()) {
      await m.page.locator(`.rail .tab[data-tab=${tb}]`).click(); await sleep(120);
      if (i === 3) await m.page.evaluate(() => { const s = document.querySelector("#setDock"); s.value = "compact"; s.dispatchEvent(new Event("change", { bubbles: true })); });
      if (i === 5) await m.page.evaluate(() => { const s = document.querySelector("#setDock"); s.value = "overlay"; s.dispatchEvent(new Event("change", { bubbles: true })); });
    }
    await sleep(1500);
    const barOff = await m.page.evaluate(() => { const b = document.querySelector("#railPill").getBoundingClientRect(), t = document.querySelector('.rail .tab[aria-selected="true"]').getBoundingClientRect(); return Math.round(b.top + b.height / 2 - (t.top + t.height / 2)); });
    assert(Math.abs(barOff) <= 1, "the bar ends beside the tool chosen last: " + barOff);
    console.log("PASS dock: opens and closes (handle, Ctrl+B, double click, Esc, outside, choice), a wide window makes room, a narrow one floats, activity marks, compact, F11");
  } finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
