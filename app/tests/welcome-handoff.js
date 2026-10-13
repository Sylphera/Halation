// Welcome's proxy and live Home artwork coincide across the actual handoff.
// Numeric geometry/visibility checks only: no screenshots, video or visual-review captures.
const fs = require("fs"), path = require("path"), os = require("os"), assert = require("assert/strict");
const { serve, launch, openApp } = require("./common");
const { createHost } = require("./host");

function observeHandoff() {
  if (window !== window.top) return;
  const rect = el => {
    if (!el) return null;
    const r = el.getBoundingClientRect(), s = getComputedStyle(el);
    return { x: r.x, y: r.y, width: r.width, height: r.height, opacity: +s.opacity, visibility: s.visibility, transform: s.transform };
  };
  window.__handoff = { samples: [], frames: [] };
  const sample = phase => window.__handoff.samples.push({ phase, home: rect(document.querySelector(".hero .logo")), proxy: rect(document.querySelector("img.wl-resolved-brand")), word: rect(document.querySelector(".hero .word")), wordProxy: rect(document.querySelector("svg.wl-resolved-brand")) });
  const remove = DOMTokenList.prototype.remove, close = HTMLDialogElement.prototype.close;
  DOMTokenList.prototype.remove = function (...names) {
    if (this === document.body.classList && names.includes("welcome-logo-handoff")) sample("before");
    return remove.apply(this, names);
  };
  HTMLDialogElement.prototype.close = function (...args) {
    const result = close.apply(this, args);
    if (this.id === "welcome") {
      queueMicrotask(() => sample("after"));
      requestAnimationFrame(() => { sample("frame1"); requestAnimationFrame(() => sample("frame2")); });
    }
    return result;
  };
  const frame = () => {
    const home = rect(document.querySelector(".hero .logo")), proxy = rect(document.querySelector("img.wl-resolved-brand"));
    if (proxy || window.__handoff.samples.length) window.__handoff.frames.push({ home, proxy });
    if (!window.__handoff.samples.some(s => s.phase === "frame2")) requestAnimationFrame(frame);
  };
  window.__handoffStart = () => { window.__handoff = { samples: [], frames: [] }; requestAnimationFrame(frame); };
  requestAnimationFrame(frame);
}

function validate(result, normal = true) {
  const before = result.samples.find(s => s.phase === "before"), after = result.samples.find(s => s.phase === "after"), frame1 = result.samples.find(s => s.phase === "frame1");
  assert(before && after && frame1, "All handoff boundaries observed");
  const coincide = (a, b, label) => {
    for (const key of ["x", "y", "width", "height"]) assert(Math.abs(a[key] - b[key]) < .01, label + " " + key + ": " + a[key] + " / " + b[key]);
  };
  coincide(before.proxy, before.home, "Proxy/live mark");
  coincide(before.wordProxy, before.word, "Proxy/live wordmark");
  coincide(before.proxy, after.home, "Before/after mark");
  coincide(before.proxy, frame1.home, "First presented Home frame");
  assert.equal(after.home.transform, "none", "No ambient offset cached in GSAP's image transform");
  assert.equal(before.home.visibility, "hidden"); assert.equal(before.proxy.opacity, 1);
  assert.equal(after.home.visibility, "visible"); assert.equal(after.home.opacity, 1); assert.equal(after.proxy, null);
  if (normal) for (const frame of result.frames) {
    const visible = [frame.home, frame.proxy].filter(r => r && r.visibility === "visible" && r.opacity > .99 && r.width > 0);
    assert.equal(visible.length, 1, "Exactly one opaque mark per rendered handoff frame");
  }
}

module.exports = { observeHandoff, validate };

if (require.main === module) (async () => {
  const server = serve(), browser = await launch();
  try {
    for (const [width, height, reduced] of [[1480, 940, false], [960, 640, false], [1480, 940, true]]) {
      const host = createHost(fs.mkdtempSync(path.join(os.tmpdir(), "halation-handoff-")));
      const app = await openApp(browser, server, host, { width, height, motion: true, welcome: true, init: observeHandoff });
      const page = app.page;
      if (reduced) await page.emulateMedia({ reducedMotion: "reduce" });
      await page.waitForFunction(() => document.querySelector("#welcome").dataset.phase === "language" && !document.querySelector("#welcome").dataset.arrival);
      await page.locator('#wLanguage input[value="en"]').check();
      await page.locator("#wOk").click();
      await page.waitForFunction(() => document.querySelector("#welcome").dataset.phase === "welcome");
      await page.locator("#wSkip").click();
      await page.waitForFunction(() => document.querySelector("#welcome").dataset.phase === "ready");
      await page.waitForFunction(() => !window.__motion.busy());
      await page.locator("#wOk").click();
      await page.waitForFunction(() => window.__handoff.samples.some(s => s.phase === "frame2"), null, { timeout: 15000 });
      validate(await page.evaluate(() => window.__handoff), !reduced);
      assert.deepEqual(app.errors, []);
      console.log("PASS Welcome handoff " + width + "×" + height + (reduced ? " reduced motion" : " normal motion") + ": geometry <0.01px, one mark, no opacity/size snap");
      await page.close();
    }
  } finally { await browser.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
