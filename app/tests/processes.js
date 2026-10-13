// The processes menu (processes.js, docs/PROCESS_MENU_SPEC.md) over the mocked backend, with jobs submitted to the
// real scheduler (jobs.js): the island's states and places, its moments, the tray (sections, batches, details, cancel with its
// confirmation, hold, reorder by keys and by drag), Ctrl+J from a tool page and Esc back to it, the button's "Queued"
// confirmation, the window out of sight (one notification per batch, the taskbar, the summary on return), the small
// window, and screenshots of every state for review.
// Usage: node app/tests/processes.js   Screenshots go to $SHOTS/processes.
const fs = require("fs");
const os = require("os");
const path = require("path");
const { until, serve, launch, openApp, painted } = require("./common");
const { createHost } = require("./host");

const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "processes");
fs.mkdirSync(SHOTS, { recursive: true });
const functional = process.argv.includes("--functional");
let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// page helpers: jobs that run until the test lets them go (with a progress), or end at once
const HELPERS = () => {
  const J = window.__shell.jobs;
  window.__t = { gates: {}, ids: {} };
  window.__job = (name, o = {}) => {
    let open; const gate = new Promise(r => { open = r; });
    window.__t.gates[name] = open;
    const h = J.submit(Object.assign({ tool: "upscale", title: name, lane: "gpu" }, o, {
      run: async ctx => {
        if (o.progress != null) ctx.progress(o.progress, o.stage || "Working");
        if (o.fail) throw new Error(o.fail);
        if (o.delay) await new Promise(r => setTimeout(r, o.delay));
        if (!o.instant) await Promise.race([gate, new Promise((_, rej) => ctx.signal.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" }))))]);
        if (o.output) ctx.output(o.output, { kind: "video" });
        return name;
      }
    }));
    window.__t.ids[name] = h.id;
    return h.id;
  };
  window.__go = n => window.__t.gates[n] && window.__t.gates[n]();
  window.__st = n => (J.get(window.__t.ids[n]) || {}).state;
};

(async () => {
  const server = serve(), browser = await launch();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "halation-procs-"));
  const host = createHost(root, { tools: {} });
  fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en" } }));
  // a process that runs until killed (the job cancelled from the tray)
  const bin = path.join(host.dir("Tools"), "yt-dlp");
  fs.writeFileSync(bin, `#!/usr/bin/env node\nconsole.log("working");\nsetTimeout(() => {}, 60000);\n`); fs.chmodSync(bin, 0o755);
  const out = path.join(host.dir("Exports", "Videos"), "Single June.mp4"); fs.writeFileSync(out, "x");
  const app = await openApp(browser, server, host, { width: 1280, height: 800 });
  const { page } = app;
  await page.evaluate(HELPERS);
  const ev = (fn, a) => page.evaluate(fn, a);
  const job = (n, o) => ev(([n, o]) => window.__job(n, o), [n, o || {}]);
  const go = n => ev(n => window.__go(n), n);
  const st = n => ev(n => window.__st(n), n);
  const shot = n => functional ? Promise.resolve() : page.screenshot({ path: path.join(SHOTS, n + ".png") });
  // the island: its state, text, place in the bar (x of its centre, relative to the bar), size
  const dot = () => ev(() => { const d = document.querySelector("#procIsland"), r = d.getBoundingClientRect(), h = document.querySelector(".head").getBoundingClientRect(), k = document.querySelector("#keysBtn").getBoundingClientRect(); return { state: d.dataset.state, kind: d.dataset.kind || "", text: [".isl-t", ".isl-s", ".isl-p", ".isl-n"].map(s => d.querySelector(s).textContent).filter(Boolean).join(" · "), failed: d.classList.contains("failed"), label: document.querySelector("#procBtn").getAttribute("aria-label"), indet: d.classList.contains("indet"), w: Math.round(r.width), h: Math.round(r.height), cx: Math.round(r.left + r.width / 2 - h.left), mid: Math.round(innerWidth / 2 - h.left), gapKeys: Math.round(k.left - document.querySelector("#procBtn").getBoundingClientRect().right), rightGap: Math.round(h.right - r.right), top: r.top - h.top }; });
  // a moment on the island (its kind, text and action), or null
  const pill = () => ev(() => { const d = document.querySelector("#procIsland"); if (!d.dataset.kind) return null; const a = d.querySelector(".isl-act"); return { text: [".isl-t", ".isl-s"].map(s => d.querySelector(s).textContent).join(" "), act: a.hidden ? "" : a.textContent, kind: d.dataset.kind }; });
  const trayOpen = () => ev(() => !document.querySelector("#procTray").hidden);
  const rowsText = () => ev(() => [...document.querySelectorAll("#procList > [data-key]")].map(r => r.dataset.key + ":" + (r.querySelector(".pt") ? r.querySelector(".pt").textContent : r.textContent.trim())));
  const reset = async () => { await ev(() => { const J = window.__shell.jobs; J.cancelAll(); J.clearFinished(); window.__procs.closeTray({ restore: false }); window.__procs.closePill(true); window.__procs.setFailed(false); }); await sleep(150); };

  /* ---------- 1: at rest ---------- */
  await page.mouse.move(700, 300);
  const d0 = await dot();
  ok(d0.state === "rest" && d0.text === "" && d0.gapKeys >= 0 && d0.gapKeys <= 2, "Idle is anchored right with a text-free clickable dock: " + JSON.stringify(d0));
  ok(d0.h === 32 && d0.w === 184, "The idle toolbox (with Sessions) has one 184 × 32 px contour: " + d0.w + "×" + d0.h);
  await sleep(300);
  ok((await dot()).text === "" && await ev(() => document.getAnimations().filter(a => a.effect.target.closest("#procIsland")).length) === 0, "Idle stays text-free without rotating messages or decorative animation");
  ok(await ev(() => { const bg = getComputedStyle(document.querySelector(".isl-bg")), mark = getComputedStyle(document.querySelector(".isl-core")); return bg.visibility === "visible" && getComputedStyle(document.querySelector(".tb-bg")).visibility === "hidden" && document.querySelector("#procIsland").contains(document.querySelector("#toolbox")) && bg.boxShadow !== "none" && bg.opacity === "1" && bg.backgroundColor === "rgb(5, 5, 4)" && mark.opacity === "1"; }), "Idle Processes shares the toolbox surface and common border, without its own pill");
  if (!functional) await page.locator("#procIsland").screenshot({ path: path.join(SHOTS, "island-rest.png") });
  await shot("01-rest");

  /* ---------- 2: a job running elsewhere; it ends while another tool is open ---------- */
  await app.tab("grade");
  await job("Single June.mp4", { tool: "visualizer", lane: "cpu", progress: 0.35, stage: "Encoding", output: out });
  ok(await until(async () => { const p = await pill(); return p && p.kind === "started" && p.text.trim() === "Single June.mp4 started"; }, 2000), "It started from another view: the island says so");
  await sleep(3800);
  await until(async () => !(await pill()), 4000);
  { const p = await pill(); ok(!p, "The moment goes after 4 s" + (p ? ": " + JSON.stringify(p) : "")); }
  await until(async () => (await dot()).state === "active", 3000);
  const d1 = await dot();
  ok(d1.state === "active" && d1.indet && /^Single June\.mp4 · Encoding · 35 %$/.test(d1.text), "Running uses one activity icon, short name, its stage and known %: " + JSON.stringify(d1));
  ok(Math.abs(d1.cx - d1.mid) <= 1 && d1.h === 32 && d1.w <= 280 && await ev(() => !document.querySelector("#procIsland").contains(document.querySelector("#toolbox")) && getComputedStyle(document.querySelector(".tb-bg")).visibility === "visible"), "Live activity detaches a centered island while the other toolbox controls stay available");
  ok(/1 running/.test(d1.label), "The island's label counts the jobs: " + d1.label);
  if (!functional) await page.locator("#procIsland").screenshot({ path: path.join(SHOTS, "island-active.png") });
  await shot("02-active");
  await go("Single June.mp4");
  ok(await until(async () => { const p = await pill(); return p && p.kind === "done" && p.act === "Show in folder"; }, 2000), "When it ends: a tick with Show in folder");
  // the pointer on it: Show in folder appears left of Open, never over it
  { const b = await page.locator("#procIsland .isl-act").boundingBox(); await page.mouse.move(b.x - 40, b.y + b.height / 2); }
  await until(() => ev(() => getComputedStyle(document.querySelector(".isl-acts")).opacity === "1"), 1000);
  const overOpen = await ev(() => { const a = document.querySelector(".isl-acts").getBoundingClientRect(), o = document.querySelector(".isl-act").getBoundingClientRect(); return { acts: a.right, open: o.left }; });
  ok(overOpen.acts <= overOpen.open + 1, "The pointer's buttons stay left of Show in folder: " + JSON.stringify(overOpen));
  if (!functional) await page.locator("#procIsland").screenshot({ path: path.join(SHOTS, "island-done-hover.png") });
  if (!functional) await page.locator("#procIsland").screenshot({ path: path.join(SHOTS, "island-done.png") });
  await shot("03-pill-done");
  host.log.length = 0;
  await page.locator("#procIsland .isl-act").click();
  ok(host.log.some(l => l[0] === "reveal_path" && l[1].path === out) && await ev(() => window.__shell.active()) === "grade", "Show in folder reveals the exported file; the tool stays");
  ok(await until(async () => (await dot()).state === "rest", 2000), "Nothing left: the island is back at rest");
  ok(await until(async () => Math.abs((await dot()).cx - d0.cx) <= 2, 2000), "…at its right-hand idle anchor again");
  await reset();

  /* ---------- 3: counts, waiting for the GPU, the batch, failures ---------- */
  await job("cover.jpg", { tool: "upscale", lane: "gpu", progress: 0.62, stage: "Upscaling", detail: "4× · realesrgan-x4plus" });
  await job("clip.mov", { tool: "interp", lane: "gpu", progress: null, stage: "Interpolating" });
  await job("vhs.mov", { tool: "interp", lane: "gpu", needs: { vramMB: 1 } });
  for (let i = 1; i <= 20; i++) await job(`photo-${String(i).padStart(2, "0")}.jpg`, { tool: "upscale", lane: "gpu", group: "batch-1" });
  await until(async () => (await st("clip.mov")) === "running", 3000);
  ok(await until(async () => { const p = await pill(); return p && p.kind === "wait" && /GPU/.test(p.text); }, 8000), "A job waiting for the GPU more than 3 s: the island says it: " + JSON.stringify(await pill()));
  await shot("04-pill-waiting");
  await ev(() => window.__procs.closePill(true));
  await until(async () => /\+22/.test((await dot()).text), 2000);
  const d2 = await dot();
  ok(/^cover\.jpg · Upscaling · 62 % · \+22$/.test(d2.text) && d2.w <= 400, "Several jobs: count, name and progress within the complete toolbox: " + JSON.stringify(d2));
  if (!functional) await page.locator("#procIsland").screenshot({ path: path.join(SHOTS, "island-several.png") });
  // the wheel goes through the jobs
  const ib = await page.locator("#procIsland").boundingBox();
  await ev(() => { const d=document.querySelector('#procIsland');window.__hoverEvents=[];for(const type of ['pointerenter','pointerleave'])d.addEventListener(type,e=>window.__hoverEvents.push({type,x:e.clientX,width:d.getBoundingClientRect().width})); });
  await page.mouse.move(ib.x + 30, ib.y + ib.height / 2); await page.mouse.wheel(0, 100);
  ok(await until(async () => /^clip\.mov/.test((await dot()).text), 1500), "The wheel on the island goes to the next job: " + (await dot()).text);
  const hoverReady = await until(() => ev(() => getComputedStyle(document.querySelector(".isl-acts")).opacity === "1"), 1000);
  ok(hoverReady, "The pointer on it shows pause and cancel after the hover fade" + (hoverReady ? '' : JSON.stringify(await ev(()=>{const d=document.querySelector('#procIsland');return {hover:d.matches(':hover'),style:d.style.cssText,rect:d.getBoundingClientRect().toJSON(),events:window.__hoverEvents};}))));
  if (!functional) await page.locator("#procIsland").screenshot({ path: path.join(SHOTS, "island-hover.png") });
  await page.mouse.move(700, 400);
  await page.keyboard.press("Control+j");
  ok(await until(trayOpen, 2000), "Ctrl+J opens the tray");
  ok(await ev(() => document.querySelector("#procIsland").contains(document.querySelector("#toolbox")) && !document.querySelector("#procIsland").classList.contains("detached")), "Manual opening reunites the toolbox in the same manager surface");
  ok(!(await pill()), "Opening the tray puts the moment away");
  // the tray shows the job the island follows, not the whole queue
  const rows = await rowsText();
  ok(rows.length === 1 && /cover\.jpg/.test(rows[0]), "The tray shows the followed job: " + JSON.stringify(rows));
  await shot("05-tray");
  // the tray drops from the island
  const tg = await ev(() => { const t = document.querySelector("#procTray").getBoundingClientRect(), i = document.querySelector("#procIsland").getBoundingClientRect(); return { dx: Math.round(t.left + t.width / 2 - (i.left + i.width / 2)), gap: Math.round(t.top - i.top - 30), nested: document.querySelector("#procIsland").contains(document.querySelector("#procTray")), bottom: Math.round(i.bottom - t.bottom), w: t.width, h: t.height, max: innerHeight * 0.7, sx: document.querySelector("#procList").scrollWidth - document.querySelector("#procList").clientWidth }; });
  ok(Math.abs(tg.dx) <= 2 && tg.gap === 0 && tg.nested && tg.bottom === 2 && tg.w === 396 && tg.h <= tg.max + 1 && tg.sx === 0, "The expanded body is inside the island, with no gap or second surface, at most 70 % high: " + JSON.stringify(tg));
  await reset();

  /* ---------- 5: Ctrl+J from a tool page, cancel a job with a process, Esc back to the tool ---------- */
  await ev(() => { window.__procJob = window.__shell.jobs.submit({ tool: "upscale", kind: "upscale", title: "poster.png", lane: "gpu", run: async ctx => { ctx.progress(0.2, "Upscaling"); const p = await ctx.proc("ytdlp", ["x"], l => { window.__line = l; }); return p.done; } }); });
  await until(() => ev(() => window.__line === "working"), 5000);
  const gradeFrame = page.frames().find(f => /grade\.html/.test(f.url()));
  await gradeFrame.evaluate(() => { const i = document.querySelector("input,button"); i.focus(); window.__focused = i; });
  await page.keyboard.press("Control+j");
  ok(await until(trayOpen, 2000), "Ctrl+J opens the tray from inside a tool page");
  await page.locator(".prow[data-state=running] .pcancel").click();
  ok(await until(() => host.jobTrees.size === 0, 3000) && (await ev(() => window.__procJob.state)) === "cancelled", "Cancel from the tray: the job's process no longer exists");
  await page.keyboard.press("Escape");
  ok(!(await trayOpen()) && await gradeFrame.evaluate(() => document.activeElement === window.__focused) && await ev(() => window.__shell.active()) === "grade", "Esc closes it and the focus goes back where it was in Grade");
  await reset();

  /* ---------- 6: cancelling a job running for more than 10 s asks in place; Cancel all asks ---------- */
  await job("long.mov", { tool: "interp", lane: "cpu", progress: 0.5, stage: "Interpolating" });
  await until(async () => (await st("long.mov")) === "running", 2000);
  await ev(() => { const j = window.__jobs.jobs.get(window.__t.ids["long.mov"]); j.startedAt -= 11000; });
  await page.keyboard.press("Control+j"); await until(trayOpen, 2000);
  await page.locator(".prow[data-state=running] .pcancel").click();
  ok(await ev(() => !!document.querySelector(".pcancel.armed")) && (await st("long.mov")) === "running", "Running for more than 10 s: the button asks \"Cancel?\" first");
  await shot("07-cancel-ask");
  await page.locator(".pcancel.armed").click();
  ok(await until(async () => (await st("long.mov")) === "cancelled", 1500), "A second click cancels");
  await reset();

  /* ---------- compact names and finishing: no clipped text or competing indicators ---------- */
  const longName = "A very long exported artwork name that must not take over the toolbar.png";
  await job(longName, { tool: "grade", lane: "cpu", progress: 0.99, stage: "Finalizing" });
  await until(async () => (await st(longName)) === "running", 3000);
  await until(() => ev(name => document.querySelector("#procBtn").title.includes(name), longName), 3000);
  await ev(() => window.__procs.closePill(true));
  await until(async () => (await dot()).state === "finishing", 3000);
  const compact = await ev(() => {
    const d = document.querySelector("#procIsland"), box = d.querySelector(".isl-text"), title = d.querySelector(".isl-t");
    const visible = e => getComputedStyle(e).display !== "none" && getComputedStyle(e).opacity !== "0";
    return { state: d.dataset.state, text: title.textContent, full: document.querySelector("#procBtn").title,
      fits: box.scrollWidth <= box.clientWidth + 1, count: [...d.querySelector(".isl-mark").children].filter(visible).length,
      pct: d.querySelector(".isl-p").textContent, drift: getComputedStyle(d.querySelector(".isl-tick")).animationName,
      outline: getComputedStyle(d.querySelector(".isl-bg")).boxShadow };
  });
  ok(compact.state === "finishing" && compact.count === 1 && compact.pct === "", "Finishing is a single distinct status icon, without a redundant 99 % or progress track: " + JSON.stringify(compact));
  ok(compact.text.includes("…") && compact.text.endsWith(".png") && compact.fits && compact.full.includes(longName) && compact.drift === "none" && compact.outline !== "none", "Long names are deliberately shortened, retain their extension and full accessible context, and never drift or clip");
  await shot("07a-finishing-short-name");
  await reset();

  /* ---------- 7: a failure: red edge until the tray opens; details ---------- */
  await job("broken.png", { tool: "grade", lane: "cpu", fail: "encoder error: exit code 1" });
  ok(await until(async () => (await dot()).failed, 2000), "A failure keeps a status marker until the island opens");
  ok(await until(async () => { const p = await pill(); return p && p.kind === "failed" && p.text.startsWith("broken.png ") && p.act === "Retry"; }, 2000), "Failure is an icon, short name, the error's first line and Retry: " + JSON.stringify(await pill()));
  if (!functional) await page.locator("#procIsland").screenshot({ path: path.join(SHOTS, "island-failed.png") });
  await shot("08-failed");
  await page.keyboard.press("Control+j"); await until(trayOpen, 2000);
  ok(!(await dot()).failed, "Opening the island acknowledges the persistent failure marker");
  await page.locator('.prow[data-state="failed"]').click();
  ok(/exit code 1/.test(await page.locator(".pdetail").textContent()), "A click on the failed row shows its error");
  // a row with nothing more to say does not unfold
  await job("plain.png", { tool: "removebg", lane: "cpu" });
  const plain = page.locator('.prow[data-state="running"]', { hasText: "plain.png" }).first();
  await until(() => plain.isVisible(), 2000);
  await plain.click();
  ok(await plain.getAttribute("aria-expanded") === null && await plain.locator(".pdetail").count() === 0, "A running row with no details does not unfold on a click");
  await shot("09-tray-failed-details");
  await reset();

  /* ---------- 8: launch and keep working: the button's confirmation, control back at once ---------- */
  await app.tab("upscale");
  const up = page.frames().find(f => /upscale\.html/.test(f.url()));
  await up.evaluate(() => { const b = document.createElement("button"); b.className = "btn primary"; b.id = "__launch"; b.textContent = "Upscale"; document.body.appendChild(b); Object.assign(b.style, { position: "fixed", right: "40px", bottom: "40px", zIndex: 9 }); });
  await job("busy1", { lane: "gpu" }); await job("busy2", { lane: "gpu" });
  const took = await up.evaluate(() => { const t0 = performance.now(), HAL = window.parent.__hal; const h = HAL.jobs.submit({ tool: "upscale", title: "late.png", lane: "gpu", run: async () => 1 }); HAL.jobLaunched(document.querySelector("#__launch"), h, { tool: "upscale" }); return performance.now() - t0; });
  ok(took < 100, `Submitting a job gives control back at once (${took.toFixed(1)} ms)`);
  ok(await until(() => up.evaluate(() => /Queued · 1st/.test(document.querySelector("#__launch").textContent)), 1000), "The button says \"Queued · 1st\"");
  if (!functional) await page.screenshot({ path: path.join(SHOTS, "10-button-queued.png") });
  ok(await until(() => up.evaluate(() => document.querySelector("#__launch").textContent === "Upscale"), 2500), "…and is back after 1.5 s");
  await reset();

  /* ---------- 9: out of sight: one notification per batch, taskbar progress, a summary on return ---------- */
  await ev(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.hasFocus = () => false; document.dispatchEvent(new Event("visibilitychange")); });
  host.log.length = 0;
  // a batch is submitted at once, as the tools do
  await ev(out => { for (let i = 1; i <= 20; i++) window.__job(`b${i}.jpg`, { tool: "upscale", lane: "gpu", group: "batch-2", groupTitle: "Upscale batch", instant: true, delay: 40, progress: 0.5, output: out }); }, out);
  await until(() => ev(() => window.__shell.jobs.list().filter(j => j.group === "batch-2" && j.state === "done").length === 20), 5000);
  await sleep(300);
  const notes = host.log.filter(l => l[0] === "notify");
  ok(notes.length === 1 && /20 of 20/.test(notes[0][1].body), "A batch of 20 out of sight: one notification: " + JSON.stringify(notes.map(n => n[1])));
  ok(host.log.some(l => l[0] === "set_progress" && l[1].value > 0 && l[1].value < 1), "The taskbar shows the total progress meanwhile");
  await ev(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); document.hasFocus = () => true; document.dispatchEvent(new Event("visibilitychange")); });
  ok(await until(async () => { const p = await pill(); return p && /20 finished/.test(p.text); }, 2000), "Back in view: the island says how many ended");
  await shot("11-pill-summary");
  await reset();

  /* ---------- 10: keyboard and reduced motion ---------- */
  await job("k1", { lane: "net" }); await job("k2", { lane: "net" });
  await page.keyboard.press("Control+j"); await until(trayOpen, 2000);
  const aria = await ev(() => ({ dlg: document.querySelector("#procTray").getAttribute("role"), lb: document.querySelector("#procList").getAttribute("role"), isl: document.querySelector("#procIsland").getAttribute("role"), live: document.querySelector("#procIsland").getAttribute("aria-live"), exp: document.querySelector("#procBtn").getAttribute("aria-expanded") }));
  ok(aria.dlg === "dialog" && aria.lb === "listbox" && aria.isl === "status" && aria.live === "polite" && aria.exp === "true", "Roles: dialog, listbox, status island: " + JSON.stringify(aria));
  await ev(() => document.querySelector("#procList .prow").focus());
  await page.keyboard.press("Delete");
  ok(await until(async () => (await st("k1")) === "cancelled", 1500), "Delete cancels the row's job");
  await page.keyboard.press("Control+j");
  ok(!(await trayOpen()), "Ctrl+J closes it again");
  const spin = await ev(() => { const d = document.querySelector("#procIsland"); d.classList.add("indet"); const a = getComputedStyle(d.querySelector(".isl-ring")).animationName; d.classList.remove("indet"); return a; });
  ok(spin === "none", "Reduced motion: the arc does not turn (" + spin + ")");
  await reset();

  /* ---------- 11: the smallest window ---------- */
  await page.setViewportSize({ width: 960, height: 640 });
  await job("cover.jpg", { tool: "upscale", lane: "gpu", progress: 0.4, stage: "Upscaling" });
  for (let i = 1; i <= 6; i++) await job("q" + i + ".png", { tool: "upscale", lane: "gpu" });
  await page.keyboard.press("Control+j"); await until(trayOpen, 2000);
  const sm = await ev(() => { const t = document.querySelector("#procTray").getBoundingClientRect(), i = document.querySelector("#procIsland").getBoundingClientRect(), h1 = document.querySelector("#pageTitle").getBoundingClientRect(), k = document.querySelector("#keysBtn").getBoundingClientRect(); return { bottom: innerHeight - t.bottom, right: innerWidth - t.right, left: t.left, isl: [i.left, i.right], title: h1.right, keys: k.left, controlsInert: document.querySelector("#toolbox").inert, sx: document.documentElement.scrollWidth - innerWidth }; });
  ok(sm.bottom >= 0 && sm.right >= 16 && sm.left >= 16 && sm.isl[0] > sm.title && sm.isl[1] <= 960 - 16 && sm.controlsInert && sm.sx <= 0, "Smallest window (960×640): the shared manager fits and the toolbox controls are inert: " + JSON.stringify(sm));
  await shot("12-small-window");
  await reset();

  /* ---------- 12: files dropped on the island go to the last tool's queue ---------- */
  await page.setViewportSize({ width: 1280, height: 800 });
  await job("seed.png", { tool: "upscale", lane: "gpu", instant: true });
  await until(async () => (await st("seed.png")) === "done", 2000);
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";   // 1×1 PNG
  await ev(b64 => { const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), dt = new DataTransfer(); dt.items.add(new File([bin], "dropped.png", { type: "image/png" })); document.querySelector("#procIsland").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true })); }, png);
  ok(await until(async () => /1 queued in Upscale/.test(await page.locator("#toast").textContent()), 5000), "A file dropped on the island is queued in the tool that launched a job last: " + await page.locator("#toast").textContent());
  ok(await until(() => page.frames().find(f => /upscale\.html/.test(f.url())).evaluate(() => window.__upscale.jobs.some(j => j.name === "dropped.png" && j.state !== "pending")), 3000), "…and started with the current options");
  await reset();

  ok(!app.errors.length, "No page errors" + (app.errors.length ? ": " + app.errors.join(" | ") : ""));
  await page.close();

  // Animation evidence is rendered separately with the shared deterministic review pipeline.
  // node app/tests/island-render.js (complete viewport, production timelines, no synthetic UI button or recorder).

  await browser.close(); server.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log(failures ? `\n${failures} failed` : "\nAll passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
