// Continuity, interruption, reduced motion and evidence for the real Processes frontend.
// Jobs are controlled through the existing mocked backend; this is not native Tauri validation.
const fs = require("fs"), os = require("os"), path = require("path");
const { until, sleep, serve, launch, openApp } = require("./common");
const { createHost } = require("./host");

const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "island-motion");
fs.mkdirSync(SHOTS, { recursive: true });
let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const longTasks = trace => {
  const events = JSON.parse(trace).traceEvents;
  const main = new Set(events.filter(e => e.ph === "M" && e.name === "thread_name" && e.args.name === "CrRendererMain").map(e => e.pid + ":" + e.tid));
  return events.filter(e => e.ph === "X" && main.has(e.pid + ":" + e.tid) && /^(RunTask|ThreadControllerImpl::RunTask)$/.test(e.name) && e.dur > 50000).map(e => Math.round(e.dur / 1000));
};
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "halation-island-"));
  const host = createHost(root, { tools: {} }), server = serve(), browser = await launch();
  const app = await openApp(browser, server, host, { width: 1440, height: 900, motion: true });
  const { page } = app;
  await sleep(700);
  const shot = n => page.screenshot({ path: path.join(SHOTS, n + ".png") });
  const rect = () => page.locator("#procIsland").boundingBox();
  const settle = () => until(() => page.evaluate(() => !window.__motion.busy()), 4000);
  await page.evaluate(() => {
    const M = window.__motion, animate = M.animate;
    window.__islandAnimations = [];
    M.animate = (el, frames, o) => {
      if (el.closest && el.closest("#procIsland")) window.__islandAnimations.push({ frames, o });
      return animate(el, frames, o);
    };
    window.__islandGates = new Map();
    window.__islandJob = o => {
      let release; const gate = new Promise(r => { release = r; });
      const h = window.__shell.jobs.submit({ tool: "grade", kind: "export-image", lane: "cpu", ...o, run: async ctx => {
        ctx.progress(o.progress ?? null, o.stage || "");
        await Promise.race([gate, new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true }))]);
        if (o.fail) throw new Error(o.fail);
      } });
      h.done.catch(() => {}); window.__islandGates.set(h.id, release); return h.id;
    };
  });
  const job = o => page.evaluate(o => window.__islandJob(o), o);
  const finish = id => page.evaluate(id => window.__islandGates.get(id)(), id);
  const boundary = () => page.evaluate(() => {
    const snapshot = () => ['.isl-bg','.isl-mark','#toolbox'].map(selector => {
      const r = document.querySelector(selector).getBoundingClientRect();
      return [r.left,r.top,r.width,r.height];
    });
    const before = snapshot(); document.querySelector('#procBtn').click(); const after = snapshot();
    return {open:window.__procs.trayOpen(),before,after,jump:Math.max(...before.flatMap((r,i)=>r.map((v,k)=>Math.abs(v-after[i][k]))))};
  });
  const reset = () => page.evaluate(async () => {
    const J = window.__shell.jobs; J.cancelAll();
    while (J.busy()) await new Promise(r => setTimeout(r, 10));
    J.clearFinished(); window.__procs.closePill(true); window.__procs.setFailed(false); window.__procs.paintIsland();
  });
  await app.tab("home"); await page.mouse.move(900, 400); await settle(); await shot("00-home-idle");
  await page.locator("#procBtn").hover(); await sleep(150); await shot("00-home-hover");
  await page.mouse.move(900, 400);
  await app.tab("grade"); await settle(); const idle = await rect(); await shot("01-idle");
  ok(idle.width === 148 && idle.height === 32 && await page.locator("#procBtn").evaluate(el => el.getBoundingClientRect().width === 36 && !el.querySelector(".isl-t").textContent && !!el.querySelector('svg[data-name="list"]')), "Idle has a full clickable 36 × 28 px surface and a recognizable list icon, without text");
  ok(await page.evaluate(() => {
    const d=document.querySelector('#procIsland'),box=document.querySelector('#toolbox');
    const centers=[document.querySelector('#procBtn'),...box.querySelectorAll('.btn.icon')].map(el=>{const r=el.getBoundingClientRect();return r.left+r.width/2;});
    return d.contains(box) && document.querySelectorAll('.isl-bg').length===1 && !document.querySelector('.tb-bg') && centers.every((x,i)=>!i||Math.abs(x-centers[i-1]-36)<.1);
  }), 'At rest the four controls share one toolbox contour, without individual pills');
  await page.locator("#procBtn").click(); await settle();
  ok(await page.locator("#procTray").isVisible(), "Clicking the idle surface opens Processes");
  await page.keyboard.press("Escape"); await settle();
  const sameFrame = await page.evaluate(() => {
    const bg=document.querySelector('.isl-bg'),btn=document.querySelector('#procBtn');let jump=0;
    for(let i=0;i<20;i++) { const a=bg.getBoundingClientRect();btn.click();const b=bg.getBoundingClientRect();jump=Math.max(jump,Math.abs(a.x-b.x),Math.abs(a.width-b.width),Math.abs(a.height-b.height)); }
    return {jump,open:window.__procs.trayOpen()};
  });
  ok(sameFrame.jump < .2 && !sameFrame.open, 'Twenty inversions before the next frame preserve the current surface: '+JSON.stringify(sameFrame));
  await settle();
  for (const gap of [16,32,60,16,80,24,16,120]) {
    const b = await boundary();
    ok(b.jump < .2, `Interrupting the same toolbox preserves surface, mark and controls in the click frame (${gap} ms): ${b.jump.toFixed(3)} px${b.jump >= .2 ? JSON.stringify(b) : ''}`);
    await sleep(gap);
  }
  await page.evaluate(()=>window.__procs.closeTray({restore:false})); await settle();
  const id = await job({ title: "Single June artwork with a long descriptive source filename.png", progress: 0.37 });
  await until(() => page.evaluate(() => document.querySelector("#procIsland").dataset.state === "active"), 3000);
  await settle(); const active = await rect(); await shot("02-running");
  for (const gap of [16,40,80,16,60,32]) {
    const b = await boundary(); ok(b.jump < .2, `Activity interruption remains continuous (${gap} ms): ${b.jump.toFixed(3)} px${b.jump >= .2 ? JSON.stringify(b) : ''}`); await sleep(gap);
  }
  await page.evaluate(()=>window.__procs.closeTray({restore:false})); await settle();
  ok(await page.locator('.isl-x').evaluate(el=>!!el.querySelector('svg')&&!el.hidden), 'The cancel X is loaded before its first activity hover');
  await page.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(150);
  await page.evaluate(() => { Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});document.dispatchEvent(new Event('visibilitychange')); });
  await settle();
  const restored = await rect();
  ok(Math.abs(restored.x-active.x)<.2&&Math.abs(restored.width-active.width)<.2, 'Minimize/restore visibility preserves the toolbox geometry with activity');
  ok(await page.evaluate(() => document.querySelector('#procIsland').contains(document.querySelector('#toolbox')) && !document.querySelector('#toolbox').inert), 'Activity remains in the same complete toolbox');
  const anchors = await page.evaluate(() => ({right: document.querySelector('.head').getBoundingClientRect().right - 16}));
  ok(Math.abs(active.x + active.width - anchors.right)<1, 'Activity keeps the complete toolbox at its right anchor');
  ok(await page.evaluate(() => {
    const d = document.querySelector("#procIsland"), text = d.querySelector(".isl-text");
    return text.scrollWidth <= text.clientWidth + 1 && d.querySelector(".isl-t").textContent.endsWith(".png") && !d.querySelector(".isl-prog") && getComputedStyle(d.querySelector(".isl-bg")).boxShadow !== "none" && getComputedStyle(d.querySelector(".isl-bg")).opacity === "1" && getComputedStyle(d.querySelector(".isl-bg")).backgroundColor === "rgb(5, 5, 4)";
  }), "The compact name fits, keeps its extension, and uses the same thin border without a second progress track");

  // Trace only the island after the view and list have warmed up.
  await page.keyboard.press("Control+j"); await settle(); await page.keyboard.press("Escape"); await settle();
  await page.evaluate(() => {
    window.__managerRuntime = { running:true, intervals:[], last:null };
    const sample = time => { const m=window.__managerRuntime;if(!m.running)return;if(m.last!==null)m.intervals.push(time-m.last);m.last=time;requestAnimationFrame(sample); };
    requestAnimationFrame(sample);
  });
  await browser.startTracing(page, { categories: ["toplevel", "devtools.timeline", "disabled-by-default-devtools.timeline"] });
  for (let n = 0; n < 3; n++) {
    await page.keyboard.press("Control+j"); await sleep(50);
    await page.keyboard.press("Escape"); await sleep(50);
    await page.keyboard.press("Control+j"); await settle();
    ok(await page.evaluate(() => {
      const d = document.querySelector("#procIsland"), t = document.querySelector("#procTray"), a = d.getBoundingClientRect(), b = t.getBoundingClientRect();
      return d.contains(t) && !t.hidden && !t.inert && d.classList.contains("expanded") && !d.classList.contains("closing") && Math.abs(a.bottom - b.bottom - 2) < 1 && Math.abs(a.top + 30 - b.top) < 1 && document.querySelector("#toolbox").inert;
    }), "Reopening during collapse keeps the same continuous surface and restores interaction (" + (n + 1) + ")");
    await page.keyboard.press("Escape"); await settle();
  }
  const trace = await browser.stopTracing(); fs.writeFileSync(path.join(SHOTS, "island-trace.json"), trace);
  const tasks = longTasks(trace.toString());
  const intervals = await page.evaluate(() => { window.__managerRuntime.running=false;return window.__managerRuntime.intervals; });
  const events=JSON.parse(trace).traceEvents,sorted=intervals.slice().sort((a,b)=>a-b);
  const runtime={frames:intervals.length,intervals,p50:sorted[Math.floor(sorted.length*.5)],p95:sorted[Math.floor(sorted.length*.95)],max:Math.max(...intervals),framesOver50ms:intervals.filter(x=>x>50).length,
    rendererTasksOver50ms:tasks,layoutEvents:events.filter(e=>e.ph==='X'&&e.name==='Layout').length,paintEvents:events.filter(e=>e.ph==='X'&&e.name==='Paint').length,
    environment:'Windows headless Chromium with ANGLE SwiftShader and mocked backend; native WebView2/GPU and OS minimize/restore remain unvalidated.'};
  fs.writeFileSync(path.join(SHOTS,'runtime.json'),JSON.stringify(runtime,null,2));
  ok(tasks.length === 0, "No renderer task over 50 ms during repeated expansion/collapse" + (tasks.length ? ": " + tasks.join(", ") : ""));
  await page.keyboard.press("Control+j"); await settle(); await shot("03-expanded");
  await page.keyboard.press("Escape"); await settle();
  const folded = await rect();
  ok(Math.abs(folded.x - active.x) < 1 && Math.abs(folded.width - active.width) < 1 && folded.height === 32, "Closing returns exactly to the compact geometry");
  ok(await page.evaluate(() => window.__islandAnimations.every(a => a.frames.every(f => Object.keys(f).every(k => k === "transform" || k === "opacity")))), "Island animations use transform and opacity only");
  await page.evaluate(id => { const j = window.__jobs.jobs.get(id); j.progress = 0.99; j.stage = "Finalizing"; window.__jobs.touch(j); }, id);
  await until(() => page.evaluate(() => document.querySelector("#procIsland").dataset.state === "finishing"), 3000);
  await settle(); await shot("04-finishing"); await sleep(600);
  await finish(id); await until(() => page.evaluate(() => document.querySelector("#procIsland").dataset.kind === "done"), 3000); await settle(); await shot("05-completed"); await sleep(700);
  await reset();
  const blocker = await job({ title: "Test CPU hold", priority: "background", cost: 2 });
  await until(() => page.evaluate(id => window.__shell.jobs.get(id).state === "running", blocker), 3000);
  await job({ title: "cover.png", progress: null });
  await until(() => page.evaluate(() => document.querySelector("#procIsland").dataset.state === "waiting"), 3000); await settle(); await shot("06-waiting"); await sleep(700);
  await reset();
  const failed = await job({ title: "broken.png", fail: "A long encoder failure belongs to expanded details, not the compact header" });
  await until(() => page.evaluate(id => window.__shell.jobs.get(id).state === "running", failed), 3000); await finish(failed);
  await until(() => page.evaluate(() => document.querySelector("#procIsland").dataset.kind === "failed"), 3000); await settle(); await shot("07-failed"); await sleep(700);
  await page.keyboard.press("Control+j"); await settle();
  await page.locator("#procMore").click(); await page.keyboard.press("Escape");
  ok(await until(() => page.evaluate(() => document.querySelector("#procMenu").hidden && document.activeElement.id === "procMore" && window.__procs.trayOpen()), 1000), "Escape closes the header menu before the island and restores its button's focus");
  await page.keyboard.press("Escape"); await settle(); await reset();
  await page.evaluate(() => window.__motion.setReduce(true));
  await job({ title: "reduced.png", progress: null });
  await until(() => page.evaluate(() => document.querySelector("#procIsland").dataset.state === "active"), 3000);
  await page.keyboard.press("Control+j"); await sleep(200);
  const reduced = await page.evaluate(() => {
    const d = document.querySelector("#procIsland");
    return { expanded: d.classList.contains("expanded"), mode: document.documentElement.dataset.motion,
      animations: document.getAnimations().filter(a => a.effect.target.closest("#procIsland")).map(a => ({ name: a.animationName, target: a.effect.target.className })) };
  });
  ok(reduced.expanded && !reduced.animations.length, "Reduced motion has no spinner, pulse or geometric animation: " + JSON.stringify(reduced));
  await page.keyboard.press("Escape"); await sleep(200);
  ok(await page.locator("#procTray").isHidden(), "Reduced motion closes without leaving a stale expanded surface");
  await page.evaluate(() => window.__shell.setSetting('showProcesses',false)); await sleep(200);
  const hiddenToolbox = await rect();
  ok(await page.locator('#procBtn').isHidden() && await page.locator('#toolbox').isVisible() && hiddenToolbox.width===112 && hiddenToolbox.height===32, 'Hiding Processes keeps the three remaining controls in their shared surface');
  await page.keyboard.press('Control+j'); await sleep(200);
  ok(await page.locator('#procTray').isVisible(), 'Ctrl+J retains manager access when its toolbox icon is hidden');
  await page.keyboard.press('Escape'); await sleep(200);
  await page.evaluate(() => window.__shell.setSetting('showProcesses',true)); await sleep(200);
  ok(!app.errors.length, "No page errors" + (app.errors.length ? ": " + app.errors.join(" | ") : ""));
  await browser.close(); server.close(); fs.rmSync(root, { recursive: true, force: true });
  console.log(failures ? `\n${failures} failed` : "\nAll passed (island motion)"); process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
