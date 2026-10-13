// Exercise the real three-minute callback without waiting or producing visual captures.
const fs = require("fs"), path = require("path"), os = require("os"), assert = require("assert/strict");
const { serve, launch, openApp, until } = require("./common"), { createHost } = require("./host");
(async () => {
  const server = serve(), browser = await launch();
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...args) => {
    const page = await newPage(...args);
    await page.addInitScript(() => {
      const interval = window.setInterval;
      window.setInterval = (fn, ms, ...args) => {
        if (ms === 180000) { window.__autosaveTick = fn; return 0; }
        return interval(fn, ms, ...args);
      };
    });
    return page;
  };
  try {
    const host = createHost(fs.mkdtempSync(path.join(os.tmpdir(), "halation-autosave-")));
    host.begin();
    const app = await openApp(browser, server, host), page = app.page;
    await page.waitForFunction(() => typeof window.__autosaveTick === "function");
    await page.evaluate(async () => {
      window.__edit = 0;
      await window.__shell.session.register("grade", {
        document,
        capture: async () => {
          const value = { adjustment: window.__edit };
          if (window.__gateCapture) { window.__gateCapture = false; await new Promise(resolve => window.__releaseCapture = resolve); }
          return value;
        }
      });
    });
    const writes = () => host.log.filter(([cmd]) => cmd === "session_write").length;
    const picks = () => host.log.filter(([cmd]) => cmd === "session_pick").length;
    const tick = () => page.evaluate(() => window.__autosaveTick());
    const dirty = () => page.evaluate(async () => (await window.__shell.session.capture()).dirty);
    await page.evaluate(() => { window.__edit = 1; window.__shell.session.schedule(); });
    assert(await until(() => fs.existsSync(path.join(host.base, "Sessions/.recovery.json")), 5000));
    assert.equal(await tick(), false); assert.equal(writes(), 0); assert.equal(picks(), 0);
    console.log("PASS unsaved work updates debounced recovery; three-minute tick creates no Session or picker");
    assert.equal(await page.evaluate(() => window.__shell.session.save()), true);
    const file = await page.evaluate(() => window.__shell.session.file);
    assert.equal(writes(), 1); assert.equal(await dirty(), false);
    await tick(); assert.equal(writes(), 1, "Unchanged associated Session is not rewritten");
    const idleCaptures = await page.evaluate(() => {
      const a=window.__shell.session;
      window.__idleCaptures=0;
      return a.register("interp",{capture:async()=>{window.__idleCaptures++;return {option:0};}}).then(()=>window.__idleCaptures);
    });
    await tick(); assert.equal(await page.evaluate(()=>window.__idleCaptures),idleCaptures,"Clean autosave does not capture adapters");
    await page.evaluate(() => { window.__edit = 2; window.__shell.session.schedule(); });
    assert.equal(await tick(), true); assert.equal(writes(), 2); assert.equal(picks(), 1);
    assert.equal(JSON.parse(fs.readFileSync(file)).tools.grade.adjustment, 2); assert.equal(await dirty(), false);
    await tick(); assert.equal(writes(), 2);
    console.log("PASS dirty associated Session autosaves in place and becomes clean; subsequent idle ticks write nothing");
    await page.evaluate(() => { window.__edit = 3; window.__shell.session.schedule("grade"); window.__gateCapture = true; });
    const pending = tick();
    assert(await until(() => page.evaluate(() => typeof window.__releaseCapture === "function"), 3000));
    await page.evaluate(() => { window.__edit = 4; window.__shell.session.schedule("grade"); window.__releaseCapture(); delete window.__releaseCapture; });
    assert.equal(await pending, true); assert.equal(JSON.parse(fs.readFileSync(file)).tools.grade.adjustment, 3);
    assert.equal(await dirty(), true, "Edits made during autosave remain unsaved");
    host.setSessionOptions({ sessionWriteError: "Disk full" });
    assert.equal(await tick(), false); assert.equal(await dirty(), true);
    assert.equal(JSON.parse(fs.readFileSync(file)).tools.grade.adjustment, 3);
    assert.equal(await page.locator("#modal").isVisible(), false);
    assert((await page.locator("#syncText").textContent()).includes("Disk full"));
    host.setSessionOptions({ sessionWriteError: null });
    assert.equal(await tick(), true); assert.equal(await dirty(), false);
    await page.evaluate(() => { window.__edit = 0; window.__shell.session.schedule("grade"); });
    assert.equal(await tick(),true);assert.equal(JSON.parse(fs.readFileSync(file)).tools.grade.adjustment,0,"Reverting to the initial state still updates an associated Session");
    await page.evaluate(() => { window.__edit = 5; window.__shell.session.schedule(); });
    host.emit("close-requested", null);
    await page.locator("#modal").waitFor({ state: "visible" });
    await page.click("#mCancel"); assert.equal(host.session.quit, 0); assert.equal(await dirty(), true);
    assert.deepEqual(app.errors, []);
    console.log("PASS concurrent later edits and failed autosaves stay dirty; successful retry cleans; edits before next cycle prompt on exit");
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
