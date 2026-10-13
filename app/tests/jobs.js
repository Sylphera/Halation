// The jobs system (jobs.js, docs/JOBS_SPEC.md) over the mocked backend: lanes and their capacities per mode, the user
// reserve, background work giving way, RAM / VRAM / disk checks, the first in line keeping its place, cancelling
// (processes of the job killed, its work folder deleted), lane changes, the OOM retry, measurements, the shared
// cache with its budget, and what the close and the minimized window read from it.
// Usage: node app/tests/jobs.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { until, serve, launch, openApp } = require("./common");
const { createHost } = require("./host");

let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };

(async () => {
  const server = serve(), browser = await launch();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "halation-jobs-"));
  const host = createHost(root, { tools: {} });
  // a "yt-dlp" that prints and waits: the process a job starts and a cancel kills
  const bin = path.join(host.dir("Tools"), "yt-dlp");
  fs.writeFileSync(bin, `#!/usr/bin/env node\nconsole.log("working");\nsetTimeout(() => {}, 60000);\n`); fs.chmodSync(bin, 0o755);
  const app = await openApp(browser, server, host, { width: 1280, height: 800 });
  const { page } = app;

  // test helpers in the page: jobs that wait until the test lets them go
  await page.evaluate(() => {
    const J = window.__shell.jobs;
    window.__t = { gates: {}, started: [] };
    window.__sub = (name, o = {}) => {
      let open; const gate = new Promise(r => { open = r; });
      window.__t.gates[name] = open;
      const h = J.submit({ tool: o.tool || "upscale", kind: o.kind || "test", title: name, lane: o.lane || "gpu", priority: o.priority || "normal", cost: o.cost, needs: o.needs, group: o.group, serial: o.serial,
        run: o.run || (async ctx => { window.__t.started.push(name); await Promise.race([gate, new Promise((_, rej) => ctx.signal.addEventListener("abort", () => rej(Object.assign(new Error("x"), { name: "AbortError" }))))]); return name; }) });
      window.__t[name] = h.id;
      return h.place;
    };
    window.__state = name => (J.get(window.__t[name]) || {}).state;
    window.__wait = name => (J.get(window.__t[name]) || {}).waitingFor;
    window.__go = name => window.__t.gates[name] && window.__t.gates[name]();
    window.__running = () => J.list().filter(j => j.state === "running").map(j => j.title).sort();
  });
  const ev = (fn, ...a) => page.evaluate(fn, ...a);
  const running = () => ev(() => window.__running());
  const state = n => ev(n => window.__state(n), n);
  const sub = (n, o) => ev(([n, o]) => window.__sub(n, o), [n, o || {}]);
  const go = n => ev(n => window.__go(n), n);
  const settle = async () => { await ev(() => window.__shell.jobs && new Promise(r => setTimeout(r, 120))); };
  const clear = async () => { await ev(() => { const J = window.__shell.jobs; J.cancelAll(); J.clearFinished(); window.__t.started = []; }); await settle(); };
  const setSettings = s => ev(s => { Object.assign(window.__shell.st.settings, s); }, s);

  /* ---------- lanes and capacities (Balanced) ---------- */
  ok(await ev(() => !!(window.__hal && window.__hal.jobs && window.__hal.jobs.submit)), "window.__hal.jobs is there for the tools");
  ok(JSON.stringify(await ev(() => window.__shell.jobs.caps())) === JSON.stringify({ light: 16, cpu: 2, gpu: 2, net: 3 }), "Balanced: GPU 2, CPU 2, network 3, light 16");
  for (const n of ["g1", "g2", "g3"]) await sub(n, { lane: "gpu" });
  for (const n of ["c1", "c2", "c3"]) await sub(n, { lane: "cpu" });
  for (const n of ["n1", "n2", "n3", "n4"]) await sub(n, { lane: "net" });
  for (let i = 1; i <= 6; i++) await sub("l" + i, { lane: "light" });
  await until(async () => (await running()).length === 13, 5000);
  const r1 = await running();
  ok(r1.filter(x => x[0] === "g").length === 2 && r1.filter(x => x[0] === "c").length === 2 && r1.filter(x => x[0] === "n").length === 3 && r1.filter(x => x[0] === "l").length === 6,
    "Each lane fills to its capacity and lanes run at once: " + r1.join(" "));
  ok(await state("g3") === "queued" && await ev(() => window.__wait("g3")) === "gpu", "The third GPU job waits for the GPU");
  const place = await sub("g4", { lane: "gpu" });
  ok(place === 3, "A new job knows how many are ahead in its lane (the button's \"Queued · 3rd\"): " + place);
  await go("g1");
  await until(async () => await state("g3") === "running", 5000);
  ok(await state("g1") === "done" && await state("g4") === "queued", "When one ends the next in order starts, not the later one");
  const c = await ev(() => window.__shell.jobs.counts());
  ok(c.running === 13 && c.queued === 3 && c.done === 1, "Counts: running, queued, done " + JSON.stringify(c));
  await clear();

  /* ---------- user priority: one unit more ---------- */
  for (const n of ["a", "b"]) await sub(n, { lane: "gpu" });
  await sub("q", { lane: "gpu" });
  await sub("u", { lane: "gpu", priority: "user" });
  await until(async () => await state("u") === "running", 5000);
  ok(await state("q") === "queued" && (await running()).length === 3, "A user job starts on the reserve unit while the GPU lane is full; the normal one keeps waiting");
  await clear();

  /* ---------- background gives way ---------- */
  await sub("bg", { lane: "cpu", priority: "background" });
  await until(async () => await state("bg") === "running", 5000);
  await sub("x1", { lane: "cpu" }); await sub("bg2", { lane: "cpu", priority: "background" }); await sub("x2", { lane: "cpu" });
  await until(async () => await state("x1") === "running", 5000);
  ok(await state("bg2") === "queued" && await state("x2") === "queued", "Background work waits while the lane has other work (the normal job goes first)");
  // a background job that yields lets the waiting normal job take its unit
  await ev(() => { window.__yielded = window.__shell.jobs.submit({ tool: "framegrab", kind: "analyse", lane: "cpu", priority: "background", title: "yielder",
    run: async ctx => { await ctx.yield(); window.__yieldBack = Date.now(); return 1; } }); });
  await go("x1");
  await until(async () => await state("x2") === "running", 5000);
  ok(await state("x2") === "running", "Normal work starts before the background work behind it");
  await clear();

  /* ---------- modes ---------- */
  await setSettings({ processing: { mode: "quiet" } });
  ok(JSON.stringify(await ev(() => window.__shell.jobs.caps())) === JSON.stringify({ light: 16, cpu: 1, gpu: 1, net: 1 }), "Quiet: one of each");
  for (const n of ["qa", "qb"]) await sub(n, { lane: "cpu" });
  await until(async () => (await running()).length === 1, 5000);
  ok((await running()).length === 1, "Quiet runs one CPU job at a time");
  await clear();
  host.setResources({ cores: 16 });
  await ev(() => window.__jobs.readResources());
  await setSettings({ processing: { mode: "fast" } });
  ok((await ev(() => window.__shell.jobs.caps())).cpu === 4, "Fast with 16 cores: CPU 4");
  await setSettings({ processing: { mode: "balanced", limits: { cpu: 3 } } });
  ok((await ev(() => window.__shell.jobs.caps())).cpu === 3, "Advanced limits override the mode");
  await setSettings({ processing: { mode: "balanced", gpu: false } });
  await sub("nogpu", { lane: "gpu" });
  await until(async () => await state("nogpu") === "running", 5000);
  ok(await ev(() => window.__shell.jobs.get(window.__t.nogpu) && window.__jobs.laneOf(window.__jobs.jobs.get(window.__t.nogpu))) === "cpu", "GPU off: GPU jobs run in the CPU lane");
  await clear();
  await setSettings({ processing: { mode: "balanced" } });
  host.setResources({ cores: 8 });
  await ev(() => window.__jobs.readResources());

  /* ---------- VRAM, RAM and disk ---------- */
  await sub("v1", { lane: "gpu", needs: { vramMB: 5000 } });
  await sub("v2", { lane: "gpu", needs: { vramMB: 5000 } });
  await until(async () => await ev(() => window.__wait("v2")) === "vram", 5000);
  ok(await state("v1") === "running" && await ev(() => window.__wait("v2")) === "vram", "Two GPU jobs over 80 % of the VRAM do not run together (waits for vram)");
  await clear();
  host.setResources({ ramFreeMB: 2000 });
  await ev(() => window.__jobs.readResources());
  await sub("big", { lane: "cpu", needs: { ramMB: 4000 } });
  await until(async () => await ev(() => window.__wait("big")) === "ram", 5000);
  ok(await state("big") === "queued", "A job needing more RAM than free (with the 1 GB reserve) waits for RAM");
  host.setResources({ ramFreeMB: 12000 });
  await until(async () => await state("big") === "running", 6000);
  ok(await state("big") === "running", "It starts once there is RAM again (resources read every 2 s)");
  await clear();
  host.setResources({ diskFreeMB: 3000 });
  await ev(() => window.__jobs.readResources());
  await sub("disk", { lane: "cpu", needs: { diskMB: 2000 } });
  await until(async () => await ev(() => window.__wait("disk")) === "disk", 5000);
  ok(await state("disk") === "queued", "A job that would leave less than 2 GB of disk waits for disk");
  await clear();
  host.setResources({ diskFreeMB: 200000 });
  await ev(() => window.__jobs.readResources());

  /* ---------- the first in line keeps its place ---------- */
  await sub("h1", { lane: "cpu" }); await sub("h2", { lane: "cpu" });
  await sub("wide", { lane: "cpu", cost: 2 }); await sub("small", { lane: "cpu" });
  await until(async () => await ev(() => window.__wait("wide")) === "cpu", 5000);
  // 30 s later (the wait moved back) nothing behind it may start first
  await ev(() => { const j = window.__jobs.jobs.get(window.__t.wide); j.waitSince = Date.now() - 31000; });
  await go("h1");
  await settle(); await ev(() => window.__jobs.pump()); await settle();
  ok(await state("small") === "queued" && await state("wide") === "queued", "After 30 s the first in line keeps its place: the smaller job behind it does not overtake it");
  await go("h2");
  await until(async () => await state("wide") === "running", 5000);
  ok(await state("wide") === "running", "It starts when its lane has room for its whole cost");
  await clear();

  /* ---------- hold, move, cancel group ---------- */
  await sub("m1", { lane: "net" }); await sub("m2", { lane: "net" }); await sub("m3", { lane: "net" });
  await sub("m4", { lane: "net", group: "G" }); await sub("m5", { lane: "net", group: "G" });
  await until(async () => (await running()).length === 3, 5000);
  await ev(() => { const J = window.__shell.jobs; J.hold(window.__t.m4, true); J.move(window.__t.m5, 0); });
  await go("m1");
  await until(async () => await state("m5") === "running", 5000);
  ok(await state("m4") === "held", "A held job stays; one moved to the front starts first");
  ok(await ev(() => window.__shell.jobs.cancel("G")) === 2 && await state("m5") === "cancelled" && await state("m4") === "cancelled", "Cancelling a group cancels its running and queued jobs");
  await clear();

  /* ---------- processes, work folder, cancel ---------- */
  await ev(() => { window.__procJob = window.__shell.jobs.submit({ tool: "downloader", kind: "download", title: "proc", lane: "net",
    run: async ctx => { const dir = await ctx.workdir(); window.__leaseDir = dir; const p = await ctx.proc("ytdlp", ["x"], line => { window.__line = line; }); return p.done; } }); });
  await until(() => ev(() => window.__line === "working"), 8000);
  const lease = await ev(() => window.__leaseDir);
  ok(fs.existsSync(lease) && path.basename(lease) === await ev(() => window.__procJob.id), "ctx.workdir: a lease named after the job in workspace\\temp");
  ok(host.log.some(l => l[0] === "proc" && l[1].job === "j_" + (l[1].job || "").slice(2) && l[1].job), "ctx.proc starts the process under the job's id");
  const liveProcs = () => host.jobTrees.size;
  ok(liveProcs() === 1, "The process is in the job's tree");
  const t0 = Date.now();
  await ev(() => window.__procJob.cancel());
  await until(() => liveProcs() === 0 && !fs.existsSync(lease), 5000);
  ok(host.log.some(l => l[0] === "kill-job") && liveProcs() === 0 && !fs.existsSync(lease), `Cancel kills the job's processes and deletes its work folder (${Date.now() - t0} ms)`);
  ok(await ev(() => window.__procJob.done.then(() => "done", e => e.name)) === "AbortError", "The job's promise rejects as cancelled");
  await clear();

  /* ---------- cancellation must settle before reusing a renderer ---------- */
  await ev(() => {
    const J = window.__shell.jobs;
    let unwind, abortEncoder;
    window.__unwind = new Promise(r => { unwind = r; }); window.__finishUnwind = unwind;
    window.__abortEncoder = new Promise(r => { abortEncoder = r; }); window.__finishAbort = abortEncoder;
    const open = window.__halEncoder.open;
    window.__restoreEncoder = () => { window.__halEncoder.open = open; };
    window.__halEncoder.open = async () => ({ finish: async () => null, abort: async () => { window.__abortStarted = true; await window.__abortEncoder; } });
    window.__cleanupJob = J.submit({ tool: "grade", kind: "cleanup-test", lane: "gpu", serial: "cleanup-renderer",
      run: async ctx => {
        window.__cleanupDir = await ctx.workdir(); await ctx.encoder("mp4", {});
        window.__cleanupReady = true;
        try { await new Promise((_, reject) => ctx.signal.addEventListener("abort", () => reject(Object.assign(new Error("cancelled"), { name: "AbortError" })), { once: true })); }
        finally { await window.__unwind; }
      } });
    window.__cleanupJob.done.then(() => { window.__cleanupSettled = true; }, () => { window.__cleanupSettled = true; });
  });
  await until(() => ev(() => window.__cleanupReady), 5000);
  const cleanupDir = await ev(() => window.__cleanupDir);
  await ev(() => {
    const J = window.__shell.jobs;
    window.__cleanupJob.cancel();
    J.clearFinished();
    window.__successor = J.submit({ tool: "grade", kind: "cleanup-next", lane: "gpu", serial: "cleanup-renderer", run: async () => { window.__successorStarted = true; return 1; } });
  });
  await settle();
  ok(await ev(() => !window.__successorStarted && !window.__cleanupSettled && window.__shell.jobs.busy("grade") && !!window.__shell.jobs.get(window.__cleanupJob.id)), "Cancelled job retains its renderer, promise and unload guard while its runner unwinds; Clear finished cannot erase it");
  await ev(() => window.__finishUnwind());
  await until(() => ev(() => window.__abortStarted), 5000); await settle();
  ok(await ev(() => !window.__successorStarted && !window.__cleanupSettled), "The successor waits for the bound encoder's abort to finish");
  await ev(() => window.__finishAbort());
  ok(await ev(() => window.__cleanupJob.done.then(() => "done", e => e.name)) === "AbortError", "Cancellation resolves only after cleanup");
  await ev(() => window.__successor.done);
  ok(!fs.existsSync(cleanupDir), "The cancelled job's workspace lease is deleted before resources are reused");
  await ev(() => window.__restoreEncoder());
  await clear();

  /* ---------- lane change and failure ---------- */
  await ev(() => { window.__sw = window.__shell.jobs.submit({ tool: "interp", kind: "interp", title: "sw", lane: "cpu",
    run: async ctx => { window.__lanes = [ctx.gpu]; await ctx.switch("gpu"); window.__lanes.push(ctx.gpu); await ctx.switch("cpu"); window.__lanes.push(ctx.gpu); ctx.output("/x/out.mp4", { kind: "video" }); return "ok"; } }); });
  ok(await ev(() => window.__sw.done) === "ok" && JSON.stringify(await ev(() => window.__lanes)) === "[false,true,false]", "ctx.switch moves a job between lanes by stages");
  ok((await ev(() => window.__shell.jobs.get(window.__sw.id).outputs)).length === 1, "Outputs are kept on the job");
  await ev(() => { window.__bad = window.__shell.jobs.submit({ tool: "upscale", kind: "boom", title: "bad", lane: "cpu", run: async () => { throw new Error("line 1\nexit code 3"); } }); });
  ok(await ev(() => window.__bad.done.then(() => "", e => e.message)) === "line 1\nexit code 3" && (await ev(() => window.__shell.jobs.get(window.__bad.id).error)) === "exit code 3", "A failed job keeps the last line of its error");
  // out of video memory: once more, alone on the lane
  await ev(() => { window.__tries = 0; window.__oom = window.__shell.jobs.submit({ tool: "upscale", kind: "oom", title: "oom", lane: "gpu", run: async () => { if (++window.__tries === 1) throw new Error("vkAllocateMemory failed"); return window.__tries; } }); });
  ok(await ev(() => window.__oom.done) === 2, "A GPU job out of video memory is retried once, alone on the lane");
  const retried = await ev(() => window.__shell.jobs.retry(window.__bad.id).done.catch(() => "failed again"));
  ok(retried === "failed again", "Retry runs a failed job again");
  await clear();

  /* ---------- serial: one renderer, one at a time ---------- */
  await sub("s1", { lane: "cpu", serial: "render" }); await sub("s2", { lane: "cpu", serial: "render" });
  await until(async () => await state("s1") === "running", 5000); await settle();
  ok(await state("s2") === "queued", "Jobs with the same serial key run one after the other");
  await clear();

  /* ---------- measurements ---------- */
  await ev(() => window.__shell.jobs.submit({ tool: "upscale", kind: "measured", title: "m", lane: "cpu", size: 1000, run: async ctx => { ctx.peak({ ramMB: 900 }); return 1; } }).done);
  await until(() => { try { return !!JSON.parse(fs.readFileSync(path.join(host.localDir("workspace"), "stats.json"), "utf8")).measured; } catch (e) { return false; } }, 5000);
  const est = await ev(() => { const h = window.__shell.jobs.submit({ tool: "upscale", kind: "measured", title: "m2", lane: "cpu", size: 2000, run: async () => 1 }); return window.__shell.jobs.get(h.id).needs.ramMB; });
  ok(est === 1800, "The next job of the same kind is estimated from the measure, scaled by size: " + est + " MB");
  await clear();

  /* ---------- the workspace cache ---------- */
  host.setWorkspaceBudget(3000);
  const put = (area, key, n) => ev(([a, k, n]) => window.__shell.invoke("workspace_cache_put", new Uint8Array(n), { headers: { "x-area": a, "x-key": k } }), [area, key, n]);
  await put("frames", "a", 1000); await new Promise(r => setTimeout(r, 20));
  await put("masks", "b", 1000); await new Promise(r => setTimeout(r, 20));
  await ev(() => window.__shell.invoke("workspace_pin", { area: "frames", keys: ["a"], on: true }));
  await put("thumbs", "c", 1000); await new Promise(r => setTimeout(r, 20));
  await put("probe", "d", 1000);
  const has = (a, k, e) => fs.existsSync(path.join(host.localDir("workspace", "cache", a), k + "." + e));
  ok(has("frames", "a", "bin") && !has("masks", "b", "png") && has("thumbs", "c", "webp") && has("probe", "d", "json"), "Over budget the least recently used entry goes, a pinned one stays");
  const rep = await ev(() => window.__shell.invoke("workspace_report"));
  ok(rep.cache === 3000 && rep.areas.length === 5, "workspace_report: size per area " + rep.cache);
  host.setWorkspaceBudget(0);

  /* ---------- close and minimized ---------- */
  await sub("live", { lane: "cpu", tool: "upscale" });
  await until(async () => await state("live") === "running", 5000);
  ok(await ev(() => window.__shell.jobs.busy("upscale") && !window.__shell.jobs.idle()), "busy(tool) and idle() follow the jobs");
  await clear();
  ok(await ev(() => window.__shell.jobs.idle()), "Idle again once nothing is queued or running");

  ok(!app.errors.length, "No page errors" + (app.errors.length ? ": " + app.errors.join(" | ") : ""));
  await browser.close(); server.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log(failures ? `\n${failures} failed` : "\nAll passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
