"use strict";
// The jobs system (docs/JOBS_SPEC.md): one scheduler in the main window for all the heavy work of Halation. Tools
// submit jobs (window.__hal.jobs.submit) and go on working; each job waits in the lane of the resource it uses (GPU,
// CPU, network, light) until that lane has room and RAM, VRAM and disk allow it, then its run(ctx) runs in the page
// that submitted it. The processes menu (processes.js) shows what this holds.

/* ===== model ===== */
// Jobs, their states and the events. A job: id, tool, kind, title, detail, thumb, priority (user | normal |
// background), lane (gpu | cpu | net | light), cost, needs { vramMB, ramMB, diskMB }, host (process | page), state
// (queued | held | running | done | failed | cancelled), progress, stage, eta, times, waitingFor, outputs, error, group.
(() => {
"use strict";
const S = window.__shell;
const J = window.__jobs = {};
const PRIORITY = { user: 0, normal: 1, background: 2 };
const LANES = ["gpu", "cpu", "net", "light"];
const FINISHED_MAX = 50;
const jobs = new Map();       // id → job (every job of this session still listed: queued, running and the last finished)
const order = [];             // ids of the jobs waiting, in the order they should start (move() changes it)
let seq = 0;
const newId = () => "j_" + String(++seq).padStart(6, "0");
const isLive = j => j.state === "queued" || j.state === "held" || j.state === "running";
const isQueued = j => j.state === "queued" || j.state === "held";
const isBusy = j => isLive(j) || !!j.settling;

// What a page may read of a job (no functions, no internals)
function view(j) {
  return {
    id: j.id, tool: j.tool, kind: j.kind, title: j.title, detail: j.detail, thumb: j.thumb, priority: j.priority, lane: j.lane,
    cost: j.cost, needs: { ...j.needs }, host: j.host, state: j.state, progress: j.progress, stage: j.stage, eta: j.eta,
    createdAt: j.createdAt, startedAt: j.startedAt, endedAt: j.endedAt, cancellable: j.cancellable, waitingFor: j.waitingFor,
    waitSince: j.waitSince, outputs: j.outputs.slice(), origin: j.origin, error: j.error, log: j.log.slice(), group: j.group,
    groupTitle: j.groupTitle, silent: j.silent, index: order.indexOf(j.id)
  };
}
// "jobs" events: at most one per frame, with the ids changed since the last one and the counts
const changed = new Set();
let emitTimer = 0;
function touch(j) {
  changed.add(j.id);
  if (!emitTimer) emitTimer = setTimeout(flushEvents, 60);
}
function counts() {
  const c = { running: 0, queued: 0, waiting: 0, held: 0, done: 0, failed: 0, cancelled: 0 };
  for (const j of jobs.values()) {
    if (j.silent && !j.shown) continue;
    if (j.state === "running") c.running++;
    else if (j.state === "queued") { c.queued++; if (j.waitingFor) c.waiting++; }
    else if (j.state === "held") { c.queued++; c.held++; }
    else c[j.state]++;
  }
  return c;
}
function flushEvents() {
  emitTimer = 0;
  const ids = [...changed]; changed.clear();
  S.emit("jobs", { changed: ids, counts: counts() });
  if (J.afterEvents) J.afterEvents();
}
Object.assign(J, { jobs, order, PRIORITY, LANES, FINISHED_MAX, newId, isLive, isQueued, isBusy, view, touch, counts, flushEvents });
})();

/* ===== resources ===== */
// The machine (sys_resources: cores, RAM, the GPU and its VRAM, free disk of the workspace), read every 2 s while
// something is queued or running, and the capacity of each lane from Settings → Processing (mode, GPU, limits).
(() => {
"use strict";
const S = window.__shell, J = window.__jobs;
const R = { cores: navigator.hardwareConcurrency || 4, ramTotalMB: 0, ramFreeMB: 0, gpu: null, diskFreeMB: 0, at: 0, known: false };
// jobs started since the last reading: what they will take is not in the numbers yet
const lately = { ramMB: 0, diskMB: 0 };
let reading = null;
function readResources() {
  if (reading) return reading;
  reading = S.invoke("sys_resources").then(r => {
    if (r && typeof r === "object") {
      Object.assign(R, { cores: r.cores || R.cores, ramTotalMB: +r.ramTotalMB || 0, ramFreeMB: +r.ramFreeMB || 0, gpu: r.gpu || null, diskFreeMB: +r.diskFreeMB || 0, known: true });
      lately.ramMB = 0; lately.diskMB = 0;
    }
  }).catch(() => {}).then(() => { R.at = Date.now(); reading = null; if (J.pump) J.pump(); });
  return reading;
}
setInterval(() => { if ([...J.jobs.values()].some(J.isLive)) readResources(); }, 2000);

const DEFAULTS = { mode: "balanced", gpu: true, minimized: "continue", limits: null };
const processing = () => Object.assign({}, DEFAULTS, (S.st.settings && S.st.settings.processing) || {});
// Capacity of each lane (JOBS_SPEC §7)
function caps() {
  const p = processing(), cores = R.cores || 4;
  const byMode = {
    quiet: { cpu: 1, gpu: 1, net: 1 },
    balanced: { cpu: 2, gpu: 2, net: 3 },
    fast: { cpu: Math.max(2, Math.min(4, Math.floor(cores / 4))), gpu: 2, net: 4 }
  }[p.mode] || { cpu: 2, gpu: 2, net: 3 };
  const c = Object.assign({ light: 16 }, byMode);
  if (p.limits && typeof p.limits === "object") for (const k of ["cpu", "gpu", "net"]) { const v = Math.round(+p.limits[k]); if (v >= 1) c[k] = Math.min(k === "gpu" ? 2 : 4, v); }
  return c;
}
// the GPU lane exists when there is a GPU and Settings let it be used; otherwise its jobs go to the CPU lane
const gpuOn = () => processing().gpu !== false && !(R.known && !R.gpu);
// FFmpeg threads for a job of the CPU lane: the cores shared by what can run at once
const threads = () => Math.max(1, Math.floor((R.cores || 4) / (processing().mode === "quiet" ? 2 : caps().cpu)));
Object.assign(J, { R, lately, readResources, processing, caps, gpuOn, threads, RESERVE_RAM_MB: 1024, RESERVE_DISK_MB: 2048 });
})();

/* ===== scheduler ===== */
// Which jobs start: per lane, by priority then queue order; a job starts when the lane has room for its cost (a user
// job may use one unit more), background jobs wait while the lane has other work, the first in line keeps its place
// after 30 s (nobody overtakes it), and RAM, VRAM and disk are checked against what the jobs need. Estimates come
// from the measurements of earlier jobs of the same kind (stats), kept in the workspace.
(() => {
"use strict";
const S = window.__shell, J = window.__jobs;
const { jobs, order, PRIORITY, R, lately } = J;
const HOLD_PLACE_MS = 30000, LIGHT_TO_HEAVY_MS = 5000;

/* ---------- measurements: stats.json in the workspace ---------- */
// stats[kind] = { samples: [{ size, ramMB, vramMB, ms, pair }], heavy, cost }
let stats = {}, statsLoaded = false, statsTimer = 0;
function loadStats() {
  if (statsLoaded) return Promise.resolve();
  statsLoaded = true;
  return S.invoke("workspace_stats_get").then(s => { if (s && typeof s === "object") stats = s; }).catch(() => {});
}
function saveStats() { clearTimeout(statsTimer); statsTimer = setTimeout(() => S.invoke("workspace_stats_put", { stats }).catch(() => {}), 500); }
const bucket = size => size > 0 ? Math.round(Math.log2(size)) : 0;
// needs of a job from what earlier jobs of its kind measured (the closest input size, scaled)
function estimate(j) {
  const s = stats[j.kind];
  if (s && s.cost && j.lane === "gpu" && !j.costGiven) j.cost = Math.max(j.cost, s.cost);
  if (!s || !s.samples || !s.samples.length) return;
  const b = bucket(j.size);
  let best = null;
  for (const x of s.samples) if (!best || Math.abs(bucket(x.size) - b) < Math.abs(bucket(best.size) - b)) best = x;
  if (!best) return;
  const k = j.size > 0 && best.size > 0 ? Math.max(0.25, Math.min(4, j.size / best.size)) : 1;
  if (best.ramMB) j.needs.ramMB = Math.round(best.ramMB * k);
  if (best.vramMB) j.needs.vramMB = Math.round(best.vramMB * k);
  j.measured = true;
}
function measure(j) {
  if (!j.startedAt || j.state !== "done") return;
  const s = stats[j.kind] || (stats[j.kind] = { samples: [] });
  const ms = Date.now() - j.startedAt;
  s.samples.push({ size: j.size || 0, ramMB: Math.round(j.peak.ramMB || 0), vramMB: Math.round(j.peak.vramMB || 0), ms, pair: !!j.paired });
  if (s.samples.length > 24) s.samples.splice(0, s.samples.length - 24);
  if (j.lane === "light" && ms > LIGHT_TO_HEAVY_MS) s.heavy = true;
  // two GPU jobs of this kind together took longer than one after the other: they are not joined again
  if (j.lane === "gpu") {
    const perUnit = x => x.ms / Math.max(1, x.size || 1);
    const solo = s.samples.filter(x => !x.pair), pair = s.samples.filter(x => x.pair);
    if (solo.length && pair.length) {
      const a = solo.reduce((n, x) => n + perUnit(x), 0) / solo.length, b = pair.reduce((n, x) => n + perUnit(x), 0) / pair.length;
      if (b > 2 * a) s.cost = 2;
    }
  }
  saveStats();
}

/* ---------- admission ---------- */
const laneOf = j => j.lane === "gpu" && !J.gpuOn() ? "cpu" : j.lane;
// what runs in a lane now: the cost of the jobs holding a unit, plus light jobs running for more than 5 s (as CPU)
function used(lane) {
  let n = 0;
  for (const j of jobs.values()) {
    if (!j.holding) continue;
    if (j.holding === lane) n += j.unit;
    else if (lane === "cpu" && j.holding === "light" && Date.now() - j.startedAt > LIGHT_TO_HEAVY_MS) n += 1;
  }
  return n;
}
const vramUsed = () => [...jobs.values()].filter(j => j.holding === "gpu").reduce((n, j) => n + (j.needs.vramMB || 0), 0);
// the reason a job cannot start now (null: it can)
function blocker(j, lane, cap) {
  const unit = Math.min(j.cost, cap);
  const room = cap + (j.priority === "user" && (lane === "gpu" || lane === "cpu") ? 1 : 0);
  if (used(lane) + unit > room) return lane;
  // a job with the same serial key (one renderer, one page) runs one at a time
  if (j.serial && [...jobs.values()].some(x => x !== j && (x.state === "running" || x.settling) && x.serial === j.serial)) return lane;
  if (lane === "gpu" && R.gpu && R.gpu.vramMB) {
    if ((j.needs.vramMB || 0) && vramUsed() + j.needs.vramMB > R.gpu.vramMB * 0.8 && used("gpu") > 0) return "vram";
    if (R.gpu.vramFreeMB != null && R.gpu.vramFreeMB < R.gpu.vramMB * 0.1 && used("gpu") > 0) return "vram";
  }
  if (R.known && R.ramTotalMB) {
    const free = R.ramFreeMB - lately.ramMB;
    if ((j.needs.ramMB || 0) + J.RESERVE_RAM_MB > free) return "ram";
  }
  if (R.known && R.diskFreeMB) {
    const free = R.diskFreeMB - lately.diskMB;
    if ((j.needs.diskMB || 0) + J.RESERVE_DISK_MB > free) return "disk";
    // little disk: background jobs that write wait
    if (j.priority === "background" && j.needs.diskMB && free < 5120) return "disk";
  }
  return null;
}
// waiting jobs in the order they should start
const rank = j => PRIORITY[j.priority] ?? 1;
function waiting() {
  const list = order.map(id => jobs.get(id)).filter(j => j && (j.state === "queued" || (j.state === "running" && (j.switching || j.yielding))));
  // a job that changes lane between stages was running: it goes first in its new lane
  return list.sort((a, b) => (b.switching ? 1 : 0) - (a.switching ? 1 : 0) || rank(a) - rank(b) || order.indexOf(a.id) - order.indexOf(b.id));
}
let pumping = false, again = false;
async function pump() {
  if (pumping) { again = true; return; }
  pumping = true;
  try {
    do {
      again = false;
      if (!R.at || Date.now() - R.at > 1500) await J.readResources();
      step();
    } while (again);
  } finally { pumping = false; }
}
function step() {
  const caps = J.caps(), hiddenPause = document.hidden && J.processing().minimized === "pause";
  const blockedLanes = new Set();   // lanes where the first in line keeps its place
  const now = Date.now();
  for (const j of waiting()) {
    const lane = laneOf(j), cap = caps[lane] || 1;
    let why = null;
    if (hiddenPause && !j.switching) why = "paused";
    else if (blockedLanes.has(lane) && !j.switching) why = lane;
    // background work gives way to anything else in its lane
    else if (j.priority === "background" && [...jobs.values()].some(x => x !== j && laneOf(x) === lane && x.priority !== "background" && (x.state === "running" || x.state === "queued"))) why = lane;
    else why = blocker(j, lane, cap);
    if (!why) { admit(j, lane, cap); continue; }
    if (j.waitingFor !== why) { j.waitingFor = why; j.waitSince = j.waitSince || now; J.touch(j); }
    if (!j.waitSince) j.waitSince = now;
    // the first in line of its lane has waited long enough: those behind it do not start before it
    if (why !== "paused" && now - j.waitSince > HOLD_PLACE_MS) blockedLanes.add(lane);
  }
}
function admit(j, lane, cap) {
  j.holding = lane; j.unit = Math.min(j.cost, cap);
  j.waitingFor = null; j.waitSince = 0;
  lately.ramMB += j.needs.ramMB || 0; lately.diskMB += j.needs.diskMB || 0;
  // two GPU jobs at once: both remember it (the pair measurement)
  if (lane === "gpu") for (const x of jobs.values()) if (x !== j && x.state === "running" && x.holding === "gpu") { x.paired = true; j.paired = true; }
  // a running job back from a lane change or a yield leaves the waiting list
  if (j.switching || j.yielding) { const k = order.indexOf(j.id); if (k >= 0) order.splice(k, 1); }
  if (j.switching) { const go = j.switching; j.switching = null; J.touch(j); go(); return; }
  if (j.yielding) { const go = j.yielding; j.yielding = null; J.touch(j); go(); return; }
  J.start(j);
}
// a job that is running gives its unit back (it ended, it changes lane, it yields)
function release(j) { j.holding = null; j.unit = 0; J.pump(); }
setInterval(() => { if (order.length) J.pump(); }, 1000);
document.addEventListener("visibilitychange", () => J.pump());
Object.assign(J, { pump, release, laneOf, used, blocker, estimate, measure, loadStats, stats: () => stats, HOLD_PLACE_MS, LIGHT_TO_HEAVY_MS });
})();

/* ===== runners ===== */
// A job running: its ctx (progress, the processes and encoders bound to it, its work folder in the workspace, the
// shared cache, lane changes and yields), how it ends, and a clean cancel (processes killed with their children,
// encoders aborted, the work folder deleted).
(() => {
"use strict";
const S = window.__shell, J = window.__jobs;
const { jobs, order } = J;
const abortError = () => { const e = new Error("cancelled"); e.name = "AbortError"; e.cancelled = true; return e; };
const errText = e => String(e && e.message || e).split(/\r?\n/).map(s => s.trim()).filter(Boolean).pop() || "";
const OOM = /out of (video |device )?memory|ErrorOutOfDeviceMemory|vkAllocateMemory|VK_ERROR_OUT_OF|failed to allocate/i;

function makeCtx(j) {
  const ctx = {
    id: j.id, signal: j.abort.signal, get gpu() { return J.laneOf(j) === "gpu"; }, get threads() { return J.threads(); },
    get priority() { return j.priority; },
    progress(v, stage) {
      if (v != null) j.progress = Math.max(0, Math.min(1, +v || 0)); else j.progress = null;
      if (stage !== undefined) j.stage = stage;
      if (j.progress != null && j.startedAt) {
        const el = (Date.now() - j.startedAt) / 1000;
        j.eta = j.progress > 0.02 && el > 2 ? Math.max(0, Math.round(el / j.progress - el)) : null;
      }
      J.touch(j);
    },
    stage(text) { j.stage = text; J.touch(j); },
    eta(s) { j.eta = s == null ? null : Math.max(0, Math.round(s)); J.touch(j); },
    detail(text) { j.detail = text; J.touch(j); },
    // an external tool bound to the job: cancelling kills it and its children; its output's last lines are kept
    async proc(tool, args, onLine, o = {}) {
      if (j.abort.signal.aborted) throw abortError();
      const p = await S.runTool(tool, args, (line, stream) => {
        if (line) { j.log.push(line); if (j.log.length > 20) j.log.shift(); }
        if (onLine) onLine(line, stream);
      }, { low: j.priority === "background" || J.processing().mode === "quiet" || !!o.low, job: j.id });
      j.procs.add(p);
      p.done.then(code => { j.procs.delete(p); if (p.peak) { j.peak.ramMB = Math.max(j.peak.ramMB, p.peak.ramMB || 0); } return code; });
      if (j.abort.signal.aborted) p.kill();
      return p;
    },
    // an encoder (encoder.js) bound to the job: cancelling aborts it and deletes its partial output
    async encoder(format, o) {
      if (j.abort.signal.aborted) throw abortError();
      const enc = await window.__halEncoder.open(format, o);
      j.encoders.add(enc);
      const fin = enc.finish.bind(enc);
      enc.finish = async () => { try { return await fin(); } finally { j.encoders.delete(enc); } };
      if (j.abort.signal.aborted) { await enc.abort(); throw abortError(); }
      return enc;
    },
    // a work folder (workspace\temp\<job>), deleted when the job ends, however it ends
    async workdir() {
      if (!j.lease) j.lease = S.invoke("workspace_lease", { job: j.id });
      return j.lease;
    },
    cache: {
      get: (area, key) => S.invoke("workspace_cache_get", { area, key }).then(b => b && b.byteLength ? b : null).catch(() => null),
      put: (area, key, bytes) => S.invoke("workspace_cache_put", bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { headers: { "x-area": area, "x-key": key } }).catch(() => {})
    },
    output(path, meta = {}) { if (path) { j.outputs.push({ path, ...meta }); J.touch(j); } },
    // to another lane between stages (AI Interpolate: CPU → GPU → CPU); resolves once there is room there
    switch(lane) {
      if (!J.LANES.includes(lane) || lane === j.lane) return Promise.resolve();
      if (j.abort.signal.aborted) return Promise.reject(abortError());
      j.lane = lane;
      return new Promise((res, rej) => {
        j.switching = res; j.holding = null; j.unit = 0; J.touch(j);
        if (!order.includes(j.id)) order.unshift(j.id);
        j.abort.signal.addEventListener("abort", () => { if (j.switching) { j.switching = null; rej(abortError()); } }, { once: true });
        J.pump();
      });
    },
    // a long background job lets more urgent work of its lane go first
    yield() {
      if (j.abort.signal.aborted) return Promise.reject(abortError());
      const lane = j.holding;
      if (j.priority !== "background" || !lane) return Promise.resolve();
      const others = [...jobs.values()].some(x => x !== j && J.laneOf(x) === lane && x.priority !== "background" && (x.state === "queued" || x.state === "running"));
      if (!others) return Promise.resolve();
      return new Promise((res, rej) => {
        j.yielding = res; j.holding = null; j.unit = 0; j.waitingFor = lane; j.waitSince = Date.now(); J.touch(j);
        // it waits among the queued jobs, in its own place
        if (!order.includes(j.id)) order.push(j.id);
        j.abort.signal.addEventListener("abort", () => { if (j.yielding) { j.yielding = null; rej(abortError()); } }, { once: true });
        J.pump();
      });
    },
    // the peak memory a page measured itself (WebGPU jobs have no process to measure)
    peak(o) { if (o.ramMB) j.peak.ramMB = Math.max(j.peak.ramMB, o.ramMB); if (o.vramMB) j.peak.vramMB = Math.max(j.peak.vramMB, o.vramMB); }
  };
  return ctx;
}

async function start(j) {
  const i = order.indexOf(j.id);
  if (i >= 0) order.splice(i, 1);
  j.state = "running"; j.settling = true; j.startedAt = Date.now(); j.progress = j.progress ?? null; J.touch(j);
  const ctx = makeCtx(j);
  // a yield puts the job back among the waiting ones while it keeps its state
  const origYield = ctx.yield;
  ctx.yield = () => origYield().then(() => { const k = order.indexOf(j.id); if (k >= 0) order.splice(k, 1); });
  let result, error = null;
  try { result = await j.run(ctx); }
  catch (e) { error = e; }
  await finish(j, error, result);
}
// Stop bound work immediately on cancel, but keep its lease and lane until the runner has unwound.
function stop(j) {
  if (!j.stopping) j.stopping = Promise.allSettled([
    ...[...j.procs].map(async p => { await p.kill(); await p.done; }),
    S.invoke("proc_kill_job", { job: j.id }),
    ...[...j.encoders].map(enc => enc.abort())
  ]);
  return j.stopping;
}
// Called after run(ctx) settles: no writer can still use the job's folder or renderer.
async function cleanup(j) {
  await stop(j);
  // IPC may have returned a newly bound handle after cancellation took its first snapshot.
  await Promise.allSettled([
    ...[...j.procs].map(async p => { await p.kill(); await p.done; }),
    ...[...j.encoders].map(enc => enc.abort())
  ]);
  j.procs.clear();
  j.encoders.clear();
  if (j.lease) { const lease = j.lease; j.lease = null; await lease.then(() => S.invoke("workspace_release", { job: j.id })).catch(() => {}); }
}
async function finish(j, error, result) {
  const lane = j.holding;
  await cleanup(j);
  if (error && !j.abort.signal.aborted && lane === "gpu" && !j.retried && OOM.test(errText(error) + " " + j.log.join(" "))) {
    // out of video memory: once more, alone on the lane
    j.retried = true; j.cost = 99; j.costGiven = true; j.state = "queued"; j.progress = null; j.stage = ""; j.startedAt = null;
    j.settling = false; j.stopping = null; j.abort = new AbortController(); order.unshift(j.id);
    J.release(j); J.touch(j);
    return;
  }
  j.endedAt = Date.now();
  const k = order.indexOf(j.id);
  if (k >= 0) order.splice(k, 1);
  if (j.abort.signal.aborted || error && (error.name === "AbortError" || error.cancelled)) { j.state = "cancelled"; j.progress = null; }
  else if (error) { j.state = "failed"; j.error = errText(error) || "failed"; }
  else { j.state = "done"; j.progress = 1; j.result = result; }
  J.measure(j);
  j.settling = false;
  J.release(j);
  J.touch(j);
  if (j.state === "done") { j.resolve(result); if (J.onDone) J.onDone(j); }
  else { const e = error || abortError(); if (j.state === "cancelled") j.reject(abortError()); else j.reject(e); }
  J.ended(j);
}
function cancel(j) {
  if (!J.isLive(j) || !j.cancellable) return false;
  const was = j.state;
  j.abort.abort();
  const i = order.indexOf(j.id);
  if (i >= 0) order.splice(i, 1);
  if (typeof j.onCancel === "function") { try { j.onCancel(); } catch (e) { console.warn(e); } }
  j.state = "cancelled"; j.settling = true; j.progress = null; j.waitingFor = null;
  stop(j);
  J.touch(j);
  if (was !== "running") finish(j, abortError());
  return true;
}
Object.assign(J, { start, finish, cancel, abortError, errText });
})();

/* ===== api ===== */
// window.__hal.jobs: submit, list, get, cancel, hold, move, clearFinished, busy, idle, retry; the "jobs" event. Also
// what the rest of the main window reads: the taskbar's total progress, the notification when a job (or a whole
// group) ends out of sight, and the Library entry of each output.
(() => {
"use strict";
const S = window.__shell, J = window.__jobs;
const { jobs, order } = J;

function submit(o = {}) {
  if (typeof o.run !== "function") throw new Error("a job needs run(ctx)");
  const id = J.newId();
  let resolve, reject;
  const done = new Promise((a, b) => { resolve = a; reject = b; });
  done.catch(() => {});   // the caller may not await it
  const lane = J.LANES.includes(o.lane) ? o.lane : "cpu";
  const j = {
    id, tool: o.tool || "", kind: o.kind || o.tool || "job", title: o.title || "", detail: o.detail || "", thumb: o.thumb || "",
    priority: J.PRIORITY[o.priority] != null ? o.priority : "normal", lane, cost: Math.max(0.25, +o.cost || 1), costGiven: o.cost != null,
    needs: { vramMB: +(o.needs && o.needs.vramMB) || 0, ramMB: +(o.needs && o.needs.ramMB) || 0, diskMB: +(o.needs && o.needs.diskMB) || 0 },
    then: o.then || null, host: o.host === "page" ? "page" : "process", size: +o.size || 0, serial: o.serial || null,
    state: "queued", progress: null, stage: o.stage || "", eta: null, createdAt: Date.now(), startedAt: null, endedAt: null,
    cancellable: o.cancellable !== false, waitingFor: null, waitSince: 0, outputs: [], origin: o.origin || null, error: null, log: [],
    group: o.group || null, groupTitle: o.groupTitle || "", silent: !!o.silent, shown: false, notify: o.notify !== false,
    run: o.run, onCancel: o.onCancel || null, spec: o, abort: new AbortController(), procs: new Set(), encoders: new Set(),
    peak: { ramMB: 0, vramMB: 0 }, holding: null, unit: 0, resolve, reject, done
  };
  // a light kind that measured more than 5 s goes to the CPU lane from now on
  const st = J.stats()[j.kind];
  if (j.lane === "light" && st && st.heavy) j.lane = "cpu";
  J.estimate(j);
  jobs.set(id, j);
  if (j.priority === "user") order.unshift(id); else order.push(id);
  if (o.held) j.state = "held";
  J.touch(j);
  J.loadStats().then(() => J.pump());
  // a silent job (the Library's index) shows in the tray only after 10 s
  if (j.silent) setTimeout(() => { if (J.isLive(j)) { j.shown = true; J.touch(j); } }, 10000);
  const place = queuedAhead(j);
  return { id, done, get state() { return j.state; }, place, cancel: () => J.cancel(j) };
}
// how many jobs of its lane are ahead of a new one (the button says "Queued · 2nd")
function queuedAhead(j) {
  let n = 0;
  for (const x of jobs.values()) if (x !== j && J.laneOf(x) === J.laneOf(j) && (x.state === "running" || x.state === "queued")) n++;
  return n;
}
const list = () => [...jobs.values()].filter(j => !j.silent || j.shown).map(J.view);
const get = id => { const j = jobs.get(id); return j ? J.view(j) : null; };
function cancel(idOrGroup) {
  const j = jobs.get(idOrGroup);
  if (j) return J.cancel(j) ? 1 : 0;
  let n = 0;
  for (const x of [...jobs.values()]) if (x.group === idOrGroup && J.cancel(x)) n++;
  return n;
}
function cancelAll(o = {}) {
  let n = 0;
  for (const x of [...jobs.values()]) if ((o.queuedOnly ? J.isQueued(x) : J.isLive(x)) && J.cancel(x)) n++;
  return n;
}
function hold(id, on) {
  const j = jobs.get(id);
  if (!j || !J.isQueued(j)) return false;
  j.state = on ? "held" : "queued"; j.waitingFor = on ? "held" : null; j.waitSince = 0;
  J.touch(j); J.pump();
  return true;
}
// moves a waiting job to position `index` among the waiting jobs (the scheduler keeps priorities first)
function move(id, index) {
  const i = order.indexOf(id); if (i < 0) return false;
  order.splice(i, 1);
  order.splice(Math.max(0, Math.min(order.length, index)), 0, id);
  const j = jobs.get(id); J.touch(j); J.pump();
  return true;
}
// moves a waiting job just before another (null: to the end), within its priority (the tray's drag)
function moveBefore(id, beforeId) {
  if (id === beforeId) return false;
  const i = order.indexOf(id); if (i < 0) return false;
  order.splice(i, 1);
  const k = beforeId ? order.indexOf(beforeId) : -1;
  order.splice(k < 0 ? order.length : k, 0, id);
  const j = jobs.get(id); J.touch(j); J.pump();
  return true;
}
// a job's place in the line of its lane (1: the next to start; 0: running or ended)
function position(id) {
  const j = jobs.get(id);
  if (!j || !J.isQueued(j)) return 0;
  const lane = J.laneOf(j), rank = x => J.PRIORITY[x.priority] ?? 1;
  const line = order.map(x => jobs.get(x)).filter(x => x && J.isQueued(x) && J.laneOf(x) === lane).sort((a, b) => rank(a) - rank(b) || order.indexOf(a.id) - order.indexOf(b.id));
  return line.indexOf(j) + 1;
}
// one step up or down among the waiting jobs of the same priority
function nudge(id, dir) {
  const j = jobs.get(id); if (!j) return false;
  const same = order.filter(x => { const y = jobs.get(x); return y && J.isQueued(y) && y.priority === j.priority; });
  const k = same.indexOf(id), to = same[k + dir];
  if (k < 0 || !to) return false;
  return move(id, order.indexOf(to));
}
function clearFinished() {
  for (const [id, j] of [...jobs]) if (!J.isBusy(j)) { jobs.delete(id); J.touch(j); }
}
// the same job again (a failed or cancelled one)
function retry(id) {
  const j = jobs.get(id);
  if (!j || J.isBusy(j)) return null;
  jobs.delete(id); J.touch(j);
  return submit(j.spec);
}
const busy = tool => [...jobs.values()].some(j => J.isBusy(j) && (!tool || j.tool === tool));
const idle = () => !busy();

/* ---------- ends: finished list, taskbar, notifications ---------- */
function ended(j) {
  // at most FINISHED_MAX finished jobs stay listed
  const done = [...jobs.values()].filter(x => !J.isBusy(x)).sort((a, b) => b.endedAt - a.endedAt);
  for (const x of done.slice(J.FINISHED_MAX)) jobs.delete(x.id);
  if (j.silent && !j.shown) { jobs.delete(j.id); return; }
  maybeNotify(j);
}
const outOfSight = () => document.hidden || !document.hasFocus();
// one notification per job, or per group when its last job ends; only when the window is not in view
function maybeNotify(j) {
  const s = S.st.settings || {};
  if (!j.notify || s.notifyDone === false || j.state === "cancelled") return;
  if (!outOfSight()) return;
  if (j.state === "done" || j.state === "failed") awayEnded.push(j.id);
  if (j.group) {
    const g = [...jobs.values()].filter(x => x.group === j.group);
    if (g.some(J.isLive)) return;
    const ok = g.filter(x => x.state === "done").length, bad = g.filter(x => x.state === "failed").length;
    S.notify(j.groupTitle || S.t("proc.n.group"), S.t("proc.n.groupBody", { ok, total: g.length }) + (bad ? " · " + S.t("common.withErrors", { n: bad }) : ""));
  } else S.notify(S.t(j.state === "done" ? "proc.n.done" : "proc.n.failed", { tool: S.t("tab." + j.tool) }), j.title || "");
}
// jobs that ended while the window was out of sight (the pill sums them up when it comes back)
const awayEnded = [];
const takeAwayEnded = () => awayEnded.splice(0).map(id => jobs.get(id)).filter(Boolean).map(J.view);
// the taskbar's progress: all the jobs with a known progress, weighted by cost
let toolProgress = null, lastBar;
function paintTaskbar() {
  const live = [...jobs.values()].filter(j => J.isLive(j) && !(j.silent && !j.shown));
  let v;
  if (!live.length) v = toolProgress;
  else {
    const known = live.filter(j => j.progress != null || j.state !== "running");
    const w = known.reduce((n, j) => n + j.cost, 0);
    v = w ? known.reduce((n, j) => n + j.cost * (j.state === "running" ? j.progress || 0 : 0), 0) / w : null;
  }
  const k = v == null ? null : Math.round(v * 100);
  if (k === lastBar) return;
  lastBar = k;
  S.invoke("set_progress", { value: k == null ? null : k / 100 }).catch(() => {});
}
J.afterEvents = () => paintTaskbar();
// a tool that still sets the taskbar itself (a job-less progress) is shown when no job is running
const setToolProgress = p => { toolProgress = p == null ? null : Math.max(0, Math.min(1, p)); paintTaskbar(); };
// outputs go to the Library (LIBRARY_SPEC §7)
J.onDone = j => { if (S.libraryAddOutputs) S.libraryAddOutputs(j); };
J.ended = ended;

const api = { submit, list, get, cancel, cancelAll, hold, move, moveBefore, position, nudge, clearFinished, retry, busy, idle, counts: J.counts, takeAwayEnded,
  caps: J.caps, resources: () => ({ ...J.R }) };
Object.assign(J, { api, setToolProgress });
Object.assign(S, { jobs: api });
})();
