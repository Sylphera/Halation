// Shared test helpers: static server for dist/, browser launch, locale-based expectations.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const http = require("http");

const DIST = path.join(__dirname, "..", "dist");
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const { chromium } = require(path.join(execSync("npm root -g").toString().trim(), "playwright"));

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms = 8000, step = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { const v = await fn(); if (v) return v; } catch (e) {} await sleep(step); }
  return false;
}

// Waits until what the last step changed is on screen: fonts loaded, images decoded, no skeleton left, and two frames
// drawn (a tool frame whose view is hidden draws none and is skipped). Takes a page or a frame; a page includes its
// tool frames.
async function painted(target, { ms = 10000 } = {}) {
  const frames = target.frames ? target.frames() : [target];
  const check = f => f.evaluate(async () => {
    if (window.frameElement && !window.frameElement.offsetParent) return true;
    await document.fonts.ready;
    // a skeleton on screen (hidden ones, like the Cutout dialog's busy veil, do not count)
    if ([...document.querySelectorAll(".skel")].some(e => e.getClientRects().length) || [...document.images].some(i => i.src && !i.complete)) return false;
    const frame = () => new Promise(r => requestAnimationFrame(() => r()));
    await frame(); await frame();
    return true;
  }).catch(() => true);
  // a frame the browser stops drawing (throttled) must not hang the test: after 3 s it counts as drawn
  const bounded = f => Promise.race([check(f), sleep(3000).then(() => true)]);
  return until(async () => (await Promise.all(frames.map(bounded))).every(Boolean), ms, 50);
}

const readLocale = lang => JSON.parse(fs.readFileSync(path.join(DIST, "locales", lang + ".json"), "utf8"));
// L(key, vars): the text the app shows in `lang`; RX(key, vars): regex for it, unknown {vars} match anything.
function locale(lang) {
  const en = readLocale("en"), dict = lang === "en" ? en : readLocale(lang);
  const L = (key, vars) => {
    let s = dict[key] != null ? dict[key] : en[key];
    if (s == null) throw new Error("missing locale key " + key);
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? String(vars[k]) : m));
    return s;
  };
  const RX = (key, vars) => new RegExp(L(key, vars).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\{\w+\\\}/g, ".*"));
  return { L, RX, en, dict };
}

// tests/verify.js starts one static server and one browser for the whole run and hands them over in
// HALATION_PORT and HALATION_BROWSER; a test file run on its own starts its own.
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".ico": "image/x-icon" };
function serve() {
  if (process.env.HALATION_PORT) return { address: () => ({ port: +process.env.HALATION_PORT }), close() {} };
  return serveDist();
}
function serveDist() {
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split("?")[0]);
    if (url === "/favicon.ico") { res.writeHead(204); res.end(); return; }
    const file = path.join(DIST, url === "/" ? "index.html" : url);
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream" }); res.end(data);
    });
  }).listen(0);
  return server;
}
const LAUNCH = { executablePath: CHROME, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"] };
const launch = () => process.env.HALATION_BROWSER ? chromium.connect(process.env.HALATION_BROWSER) : chromium.launch(LAUNCH);

// Opens the app on a page with the mocked backend. Collects page errors and console errors.
// The functional flows run with reduced motion (no animation can change what a step measures);
// tests/motion.js opens the app with motion: true to test the animations themselves.
async function openApp(browser, server, host, { width = 1480, height = 900, scale = 1, pseudo = false, onRequest = null, motion = false, welcome = false, restMs = 1e9, unloadMs = 1e9, video = null, init = null } = {}) {
  const { MOCK } = require("./host");
  if(video)throw Error('Use the deterministic visual-review renderer; real-time recordings cannot be review evidence');
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: scale, reducedMotion: motion ? "no-preference" : "reduce" });
  await require('./visual-review').attach(page);
  const errors = [];
  if (onRequest) page.on("request", r => onRequest(r.url()));
  page.on("pageerror", e => errors.push("pageerror: " + e.message + " " + (e.stack || "").split("\n").slice(0, 4).join(" | ")));
  page.on("console", m => { if (m.type() === "error") errors.push("console.error: " + m.text()); });
  await page.exposeBinding("__host", (_src, cmd, args, b64, headers) => host.call(cmd, args, b64, headers));
  if (host.bindPage) host.bindPage(page);
  await page.addInitScript(MOCK);
  if (!motion) await page.addInitScript(() => { window.__motionOff = true; });
  // the first-start welcome (artist name) only where a test asks for it
  if (!welcome) await page.addInitScript(() => { window.__halSkipWelcome = true; });
  // tools left behind rest, then unload, after a while (shell.js unloadIdle): off unless a test sets when
  await page.addInitScript(([r, u]) => { window.__halRestMs = r; window.__halUnloadMs = u; }, [restMs, unloadMs]);
  // a script of the test's own before every page (Halation Preview's window.__halPreview, for example)
  if (init) await page.addInitScript(init);
  if (pseudo) await page.addInitScript(() => { if (window === window.top) window.__halPseudo = true; });
  await page.goto(`http://localhost:${server.address().port}/`);
  const frame = re => page.frames().find(f => re.test(f.url()));
  const vFrame = () => frame(/visualizer\.html/), gFrame = () => frame(/grade\.html/);
  // A tab is open once its view is shown and selected, and has painted
  const tab = async name => {
    await page.locator(`.tab[data-tab=${name}]`).click();
    await until(() => page.evaluate(n => document.querySelector("#v-" + n).classList.contains("on") && document.querySelector(`.rail .tab[data-tab=${n}]`).getAttribute("aria-selected") === "true", name), 10000, 20);
    await painted(page);
  };
  const appReady = async name => {
    // the tool page has loaded and, when it has one, its app says it is ready
    await until(async () => { const f = frame(new RegExp(name + "\\.html")); return f && await f.evaluate(() => document.readyState === "complete" && (!window.__halApp || !window.__halApp.ready || window.__halApp.ready.then(() => true))); }, 20000);
    await painted(page);
  };
  const vis = page.frameLocator("#v-visualizer");
  // A cover for the Visualizer: one that is not square goes through the Crop dialog first (its centred 1:1 crop)
  const cover = async file => {
    const thumb = () => vis.locator("#artThumb").getAttribute("src"), before = await thumb();
    const cropOpen = () => page.evaluate(() => document.querySelector("#cropDlg").open);
    await vis.locator("#artIn").setInputFiles(file);
    await until(async () => await cropOpen() || (await thumb()) !== before, 10000);
    if (await cropOpen()) { await page.click("#cropApply"); await until(async () => (await thumb()) !== before, 10000); }
  };
  // "Send to…": the button (a selector or a locator inside `where`, the page or a tool frame) opens the menu, which
  // lists `to`; back ticks "and come back" first
  const sendTo = async (where, btn, to, { back = false } = {}) => {
    await (typeof btn === "string" ? where.locator(btn) : btn).click();
    const m = where.locator(".sendmenu:not([hidden])");
    await m.waitFor({ timeout: 5000 });
    if (back) await m.locator(".send-back input").check();
    await m.locator(`[data-to="${to}"]`).click();
  };
  await page.waitForFunction(() => !document.body.classList.contains("booting"), null, { timeout: 15000 });
  return { page, errors, vFrame, gFrame, tab, appReady, cover, vis, grade: page.frameLocator("#v-grade"), sendTo };
}

module.exports = { DIST, chromium, LAUNCH, serveDist, sleep, until, painted, locale, serve, launch, openApp };
