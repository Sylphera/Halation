"use strict";
// The shared surface settles slightly slower than page switches so its departure and folding remain legible.
const ISLAND_MS = 300;
// The processes menu (docs/PROCESS_MENU_SPEC.md): the face of the jobs system (jobs.js). An island in the title bar:
// at rest inside the shared four-icon toolbox; while jobs run in the middle of the bar, with the
// job it follows and "+ N running"; a moment when a job ends, fails, starts elsewhere or waits. A click (or Ctrl+J)
// drops the tray from it: what runs, what waits, what ended, and the machine. It keeps no jobs of its own: everything
// comes from __hal.jobs and its "jobs" event. Also the "launch and keep working" confirmation on the button that
// queued a job (its text for a moment, and a thumbnail flying to the island).

/* ===== model ===== */
// What the island and the tray show, read from the jobs: sections (running, queued, finished) with batches folded into
// one row, the total progress, and the state of the dot.
(() => {
"use strict";
const S = window.__shell, P = window.__procs = {};
const LIVE = ["queued", "held", "running"], ENDED = ["done", "failed", "cancelled"];
const isLive = j => LIVE.includes(j.state);
const rank = j => ({ user: 0, normal: 1, background: 2 })[j.priority] ?? 1;
// the jobs the tray lists (a silent job only once it is shown)
const all = () => S.jobs ? S.jobs.list() : [];
// the tray's sections; a batch is one row placed where its first live job is (running, else queued, else finished)
function sections() {
  const jobs = all(), groups = new Map(), out = { running: [], queued: [], finished: [] };
  for (const j of jobs) if (j.group) { if (!groups.has(j.group)) groups.set(j.group, []); groups.get(j.group).push(j); }
  const where = j => j.state === "running" ? "running" : isLive(j) ? "queued" : "finished";
  const seen = new Set();
  const byOrder = (a, b) => rank(a) - rank(b) || (a.index < 0 ? 1e9 : a.index) - (b.index < 0 ? 1e9 : b.index) || a.createdAt - b.createdAt;
  const running = jobs.filter(j => j.state === "running").sort((a, b) => a.startedAt - b.startedAt);
  const queued = jobs.filter(j => j.state === "queued" || j.state === "held").sort(byOrder);
  const finished = jobs.filter(j => ENDED.includes(j.state)).sort((a, b) => b.endedAt - a.endedAt);
  for (const [name, list] of [["running", running], ["queued", queued], ["finished", finished]]) {
    for (const j of list) {
      if (!j.group || groups.get(j.group).length < 2) { out[name].push({ type: "job", key: j.id, job: j }); continue; }
      if (seen.has(j.group)) continue;
      const g = groups.get(j.group), home = g.some(x => x.state === "running") ? "running" : g.some(isLive) ? "queued" : "finished";
      if (home !== name) continue;
      seen.add(j.group);
      out[name].push({ type: "group", key: "g-" + j.group, group: j.group, jobs: g.slice().sort((a, b) => a.createdAt - b.createdAt), first: g[0] });
    }
  }
  return out;
}
// progress of a set of jobs (by cost): null when none knows it
function progressOf(jobs) {
  const live = jobs.filter(j => j.state === "running" || j.state === "queued" || j.state === "held" || j.state === "done");
  const known = live.filter(j => j.state !== "running" || j.progress != null);
  if (!known.length) return null;
  const w = known.reduce((n, j) => n + (j.cost || 1), 0);
  return known.reduce((n, j) => n + (j.cost || 1) * (j.state === "done" ? 1 : j.state === "running" ? j.progress || 0 : 0), 0) / w;
}
// the dot: rest (nothing live), active (running or queued; progress or indeterminate), waiting (all live jobs wait)
function dotState() {
  const live = all().filter(isLive);
  if (!live.length) return { state: "rest", n: 0, running: 0, queued: 0 };
  const running = live.filter(j => j.state === "running");
  // the ring: the running jobs with a known progress, by cost; none known: the turning arc
  return { state: running.length ? "active" : "waiting", n: live.length, running: running.length, queued: live.length - running.length, progress: running.length ? progressOf(running) : null };
}
const fmtEta = s => { if (s == null || !isFinite(s)) return ""; s = Math.max(0, Math.round(s)); const m = Math.floor(s / 60), h = Math.floor(m / 60); return h ? `${h}:${String(m % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}` : `${m}:${String(s % 60).padStart(2, "0")}`; };
const pct = p => Math.round(Math.max(0, Math.min(1, p)) * 100) + " %";
// "2nd", "3rd": the button's "Queued · 2nd"
function ordinal(n) {
  let form = "other";
  try { form = new Intl.PluralRules(document.documentElement.lang || "en", { type: "ordinal" }).select(n); } catch (e) {}
  const k = "proc.ord." + form, s = S.t(k, { n });
  return s === k ? S.t("proc.ord.other", { n }) : s;
}
const waitText = j => j.state === "held" ? S.t("proc.wait.held") : j.waitingFor ? S.t("proc.wait." + j.waitingFor) : S.t("proc.wait.next");
const toolName = id => S.t("tab." + id);
const toolIcon = id => { const m = window.__modules && window.__modules.byId(id); return (m && m.icon) || "loader-circle"; };
function verb(j) {
  if (j.state === "failed") return S.t("proc.verb.failed");
  if (j.state === "cancelled") return S.t("proc.cancelled");
  const k = "proc.verb." + j.tool, s = S.t(k);
  return s === k ? S.t("proc.verb.done") : s;
}
const groupTitle = g => g.first.groupTitle || S.t("proc.batch", { tool: toolName(g.first.tool) });
Object.assign(P, { all, sections, progressOf, dotState, fmtEta, pct, ordinal, waitText, toolName, toolIcon, verb, groupTitle, isLive, ENDED });
})();

/* ===== island ===== */
// One opaque title-bar surface: right at rest, centered during activity. The compact header uses one state mark, a short name,
// known progress and one event action. Resource metrics and full job details live in its expanded body.
// Only the shared background transforms between geometries; the text never scrolls or scales.
(() => {
"use strict";
const S = window.__shell, P = window.__procs, M = window.__motion;
const $ = s => document.querySelector(s), esc = s => S.esc(String(s == null ? "" : s)), ic = n => window.__icons.icon(n);
const R = 7.5, C = 2 * Math.PI * R, SHOW_MS = 4000, WAIT_MS = 3000;
let last = null, moment = null, timer = 0, hovered = false, pick = 0, sig = "", paintKey = "";
const prev = new Map(), announced = new Set();
// the pill never speaks of background or silent work (the Library's index, Frame Capture's analysis)
const quiet = j => j.priority === "background" || j.silent;
const visibleLive = () => P.all().filter(j => P.isLive(j) && !quiet(j)).sort((a, b) => (a.state === "running" ? 0 : 1) - (b.state === "running" ? 0 : 1) || (a.startedAt || a.createdAt) - (b.startedAt || b.createdAt));
const bytes = n => n >= 1e9 ? (n / 1e9).toFixed(1) + " GB" : n >= 1e6 ? Math.round(n / 1e6) + " MB" : Math.round(n / 1e3) + " KB";

/* ---------- the machine, for the expanded body ---------- */
const sys = { ws: null, at: 0 };
function readSys(force) {
  if (!force && Date.now() - sys.at < 15000) return;
  sys.at = Date.now();
  if (window.__jobs && window.__jobs.readResources) window.__jobs.readResources().then(() => paint());
  S.invoke("workspace_report").then(r => { sys.ws = r; paint(); P.paintSys(); }).catch(() => {});
}
const resource = j => S.t("proc.resource." + ({ ram: "memory", disk: "disk", gpu: "gpu", cpu: "cpu", net: "network", light: "queued", held: "held", paused: "held" }[j.waitingFor] || "queued"));
const finishing = j => j.state === "running" && (j.progress >= 0.98 || /finish|finaliz|mux|saving/i.test(j.stage || ""));

/* ---------- what it shows ---------- */
function view() {
  if (moment) return { mode: "moment", kind: moment.kind, t: moment.title, s: moment.kind === "wait" ? resource(S.jobs.get(moment.id) || {}) : "", p: "", n: "", thumb: "" };
  const live = visibleLive();
  if (!live.length) return { mode: "rest", t: "", s: "", p: "", n: "", thumb: "" };
  pick = Math.max(0, Math.min(live.length - 1, pick));
  const j = live[pick], running = live.filter(x => x.state === "running");
  const ending = finishing(j), p = j.state === "running" && !ending && j.progress != null ? P.pct(j.progress) : "";
  const s = j.state !== "running" ? resource(j) : "";
  return { mode: j.state === "running" ? ending ? "finishing" : "active" : "waiting", job: j, t: j.title || P.toolName(j.tool), s, p, n: live.length > 1 ? "+" + (live.length - 1) : "", thumb: "", count: live.length, running: running.length };
}
function paint(dataOnly = false) {
  const isl = $("#procIsland"); if (!isl) return;
  const v = view();
  // Job precision stays internal; repeat events with identical visible content need no DOM work.
  const keyNow = JSON.stringify([v.mode,v.kind,v.t,v.s,v.p,v.n,v.thumb,v.count,v.running,v.job?.id,v.job?.state,v.job?.stage,v.job?.cancellable,moment?.verb,moment?.path,moment?.actions,P.trayOpen(),hovered,S.st.settings.showProcesses,S.st.settings.language]);
  if (dataOnly === true && keyNow === paintKey) { last = v; return; }
  paintKey = keyNow;
  isl.classList.toggle("dock-hidden", S.st.settings.showProcesses === false);
  const btn = $("#procBtn"), before = isl.querySelector(".isl-bg").getBoundingClientRect(), layoutBefore = isl.getBoundingClientRect();
  const markBefore = isl.querySelector(".isl-mark").getBoundingClientRect(), controlsBefore = $("#toolbox").getBoundingClientRect();
  // A wheel-selected shorter job must not withdraw the hovered surface from under the pointer.
  isl.style.setProperty("--isl-hover-min", hovered && !P.trayOpen() && v.mode !== "rest" ? `${layoutBefore.width}px` : "0px");
  const was = isl.dataset.state + "|" + (isl.dataset.kind || "");
  isl.dataset.state = v.mode === "moment" ? "active" : v.mode;
  if (v.mode === "moment") isl.dataset.kind = v.kind; else delete isl.dataset.kind;
  isl.classList.toggle("indet", v.mode === "active");
  isl.querySelector(".arc").style.strokeDashoffset = String(C * 0.72);
  const mark = isl.querySelector(".isl-mark"), evIcon = mark.querySelector("svg.ev");
  if (v.mode === "moment" || v.mode === "waiting" || v.mode === "finishing" || v.mode === "rest") {
    const name = v.mode === "moment" ? ({ done: "circle-check", failed: "circle-alert", wait: "clock", started: "play", summary: "circle-check" }[v.kind] || "info") : v.mode === "waiting" ? "clock" : v.mode === "finishing" ? "ellipsis" : isl.classList.contains("failed") ? "circle-alert" : "list";
    if (!evIcon || evIcon.dataset.name !== name) { if (evIcon) evIcon.remove(); mark.insertAdjacentHTML("beforeend", ic(name)); const s = mark.lastElementChild; s.classList.add("ev"); s.dataset.name = name; }
  } else if (evIcon) evIcon.remove();
  const th = isl.querySelector(".isl-th");
  if (v.thumb) th.style.backgroundImage = `url('${v.thumb.replace(/'/g, "%27")}')`; else th.removeAttribute("style");
  const key = v.mode + (v.kind || "") + v.t + "|" + v.s;
  const title = isl.querySelector(".isl-t"), fullTitle = P.trayOpen() ? S.t("proc.title") : v.t;
  title.textContent = shortTitle(fullTitle); title.dataset.full = fullTitle;
  btn.title = v.mode === "moment" ? v.t + (moment.verb ? " · " + moment.verb : "") : v.job ? v.t + " · " + (v.job.stage || P.waitText(v.job)) : S.t("proc.ariaIdle");
  isl.querySelector(".isl-s").textContent = P.trayOpen() ? "" : v.s || (v.job && v.job.stage) || (moment && moment.verb) || "";
  isl.querySelector(".isl-p").textContent = v.p;
  const n = isl.querySelector(".isl-n"); n.textContent = v.n; n.title = v.count > 1 ? S.t("proc.moreRunning", { n: v.count - 1 }) : "";
  // a moment's one action; Show in folder under the pointer
  const a1 = isl.querySelector(".isl-act"), acts = v.mode === "moment" ? moment.actions : [];
  a1.hidden = !acts[0];
  if (acts[0]) { a1.textContent = S.t(acts[0] === "open" ? "common.reveal" : "proc." + acts[0]); a1.classList.toggle("danger", acts[0] === "retry"); a1.dataset.act = acts[0]; }
  // pause and cancel under the pointer, for the job it follows
  const j = v.job, hold = isl.querySelector(".isl-hold"), x = isl.querySelector(".isl-x"), rev = isl.querySelector(".isl-reveal");
  const canReveal = v.mode === "moment" && !!moment.path;
  isl.classList.toggle("hover-acts", (!!j && j.cancellable !== false) || canReveal);
  rev.hidden = !canReveal; x.hidden = !j || j.cancellable === false;
  // the pointer's buttons sit left of a moment's action (Open), never over it
  isl.style.setProperty("--isl-act-w", a1.hidden ? "0px" : a1.offsetWidth + 4 + "px");
  rev.title = S.t("proc.reveal"); rev.setAttribute("aria-label", S.t("proc.reveal"));
  hold.hidden = !j || !(j.state === "queued" || j.state === "held");
  if (j) {
    const hl = S.t(j.state === "held" ? "proc.resume" : "proc.hold");
    hold.title = hl; hold.setAttribute("aria-label", hl); hold.innerHTML = ic(j.state === "held" ? "play" : "pause");
    x.title = S.t("proc.cancel"); x.setAttribute("aria-label", S.t("proc.cancel"));
  }
  btn.setAttribute("aria-label", v.mode === "rest" ? S.t("proc.ariaIdle") : v.mode === "moment" ? btn.title : S.t("proc.aria", { running: v.running, queued: v.count - v.running }) + " · " + btn.title);
  // what changed: the content cross-fades, the background follows the new width, the place follows the mode
  if (key !== sig) {
    const modeChanged = was !== isl.dataset.state + "|" + (isl.dataset.kind || "");
    sig = key;
    if (isl.dataset.placed === "1") {
      const entering = was.startsWith("rest|") && v.mode !== "rest";
      if (entering) for (const el of isl.querySelectorAll(".isl-text,.isl-p,.isl-n,.isl-act")) M.animate(el, [{ opacity: 0 }, { opacity: 1 }], { dur: "fade", delay: ISLAND_MS * .2, channel: "txt" });
      else M.animate($("#procBtn"), [{ opacity: modeChanged ? 0.55 : 0.75 }, { opacity: 1 }], { dur: "fade", channel: "txt" });
    }
  }
  syncToolbox();
  fitTitle();
  place();
  const layoutAfter = isl.getBoundingClientRect();
  if (layoutAfter.left !== layoutBefore.left || layoutAfter.width !== layoutBefore.width || layoutAfter.height !== layoutBefore.height) { resizeSurface(before); preserveHeader(markBefore); preserveToolbox(controlsBefore); }
  last = v;
}
function shortTitle(title, max = 22) {
  const chars = Array.from(String(title || "").split(/[\\/]/).pop());
  if (chars.length <= max) return chars.join("");
  const tail = Math.min(7, Math.floor(max / 3));
  return chars.slice(0, max - tail - 1).join("") + "…" + chars.slice(-tail).join("");
}
function fitTitle() {
  const title = $("#procIsland .isl-t"), box = $("#procIsland .isl-text");
  for (let n = 22; n > 4 && box.scrollWidth > box.clientWidth + 1; n--) title.textContent = shortTitle(title.dataset.full, n - 1);
}
// Manual opening transforms the complete toolbox; live work releases its Processes section.
function syncToolbox() {
  const box = $("#toolbox"), isl = $("#procIsland"), open = P.trayOpen();
  const detached = !open && visibleLive().length > 0;
  if (isl.classList.contains("detached") !== detached) {
    const before = box.getBoundingClientRect(), bg = box.querySelector(".tb-bg");
    const surfaceBefore = (detached ? isl.querySelector(".isl-bg") : bg).getBoundingClientRect();
    M.stop(bg, "dock-surface");
    isl.classList.toggle("detached", detached);
    box.classList.toggle("detached", detached);
    box.classList.toggle("joining", !detached);
    if (detached) $(".head").append(box); else isl.append(box);
    isl.style.setProperty("--isl-hover-min", "0px");
    preserveToolbox(before);
    const after = bg.getBoundingClientRect();
    const a = M.animate(bg, [{ transform: `translate(${surfaceBefore.left - after.left}px,${surfaceBefore.top - after.top}px) scale(${surfaceBefore.width / after.width},${surfaceBefore.height / after.height})` }, { transform: "none" }], { dur: ISLAND_MS, channel: "dock-surface", rebase: true, noOvershoot: true, lazy: false });
    const joined = () => { if (!box.classList.contains("detached")) box.classList.remove("joining"); };
    if (a) a.finished.then(ok => { if (ok) joined(); }); else joined();
  }
  if (box.inert === open) return;
  const opacity = getComputedStyle(box).opacity;
  box.inert = open;
  box.setAttribute("aria-hidden", String(open));
  M.animate(box, [{ opacity }, { opacity: open ? 0 : 1 }], { dur: "fade", channel: "controls", fill: "forwards", rebase: true, lazy: false });
}
// Clip the body to the actual transformed surface without scaling its text or reading layout each frame.
function followSurface(a) {
  const isl = $("#procIsland"), bg = isl.querySelector(".isl-bg"), tray = $("#procTray");
  const settled = () => { if (!P.trayOpen() && isl.classList.contains("closing")) { tray.hidden = true; isl.classList.remove("closing"); } };
  if (!a) { tray.style.removeProperty("clip-path"); settled(); return; }
  const bw = parseFloat(getComputedStyle(bg).width), bh = parseFloat(getComputedStyle(bg).height), th = parseFloat(getComputedStyle(tray).height) || 0;
  const follow = () => {
    const G = M.gsap, x = +G.getProperty(bg, "x"), y = +G.getProperty(bg, "y"), sx = +G.getProperty(bg, "scaleX"), sy = +G.getProperty(bg, "scaleY");
    const radius = Math.min(14, bw * sx / 2, bh * sy / 2);
    bg.style.borderRadius = `${radius / Math.max(.001, sx)}px / ${radius / Math.max(.001, sy)}px`;
    tray.style.clipPath = `inset(${Math.max(0, y - 30)}px ${Math.max(0, bw - x - bw * sx)}px ${Math.max(0, th + 30 - y - bh * sy)}px ${Math.max(0, x)}px)`;
  };
  isl.__surfaceFollower = a;
  follow(); a.tween.eventCallback("onUpdate", follow);
  a.finished.then(() => { if (isl.__surfaceFollower === a) { isl.__surfaceFollower = null; bg.style.removeProperty("border-radius"); tray.style.removeProperty("clip-path"); settled(); } });
}
function preserveHeader(before) {
  const head = $("#procIsland .isl-head"), after = $("#procIsland .isl-mark").getBoundingClientRect();
  const oldX = +M.gsap.getProperty(head, "x") || 0;
  const delta = before.left - after.left + oldX;
  if (Math.abs(delta) < .01 && !oldX) return;
  M.animate(head, [{ transform: `translateX(${delta}px)` }, { transform: "none" }], { dur: ISLAND_MS, channel: "surface-head", rebase: true, noOvershoot: true, lazy: false });
}
function preserveToolbox(before) {
  const box = $("#toolbox"), after = box.getBoundingClientRect(), oldX = +M.gsap.getProperty(box, "x") || 0;
  const delta = before.left - after.left + oldX;
  if (Math.abs(delta) < .01 && !oldX) return;
  M.animate(box, [{ transform: `translateX(${delta}px)` }, { transform: "none" }], { dur: ISLAND_MS, channel: "controls-place", rebase: true, noOvershoot: true, lazy: false });
}
function resizeSurface(before) {
  const isl = $("#procIsland"), bg = isl.querySelector(".isl-bg"), r = isl.getBoundingClientRect();
  // offsetWidth rounds fractional text-driven geometry and introduces a small jump on every interruption.
  const width = r.width, height = r.height;
  if (!before.width || !width) return;
  const from = `translate(${before.left - r.left}px,${before.top - r.top}px) scale(${before.width / width},${before.height / height})`;
  if (Math.abs(before.left - r.left) < .01 && Math.abs(before.width - width) < .01 && Math.abs(before.height - height) < .01) {
    // An inverse in the first frame can already be at its target. Cancel the previous direction too.
    M.stop(bg, "surface"); followSurface(null); return;
  }
  const carryBasis = { scaleX: (bg.__surfaceWidth || width) / width, scaleY: (bg.__surfaceHeight || height) / height };
  const a = M.animate(bg, [{ transform: from }, { transform: "none" }], { dur: ISLAND_MS, channel: "surface", rebase: true, carryBasis, noOvershoot: true, lazy: false });
  bg.__surfaceWidth = width; bg.__surfaceHeight = height;
  followSurface(a);
  return a;
}

/* ---------- place: the complete toolbox stays right; its requested manager centers ---------- */
function place() {
  const isl = $("#procIsland"); if (!isl || !isl.offsetParent) return;
  const head = $(".head");
  let origin = 0; for (let el = head; el; el = el.offsetParent) origin += el.offsetLeft;
  const max = Math.max(184, Math.min(400, head.clientWidth - 32));
  isl.style.setProperty("--isl-max", max + "px");
  const width = parseFloat(getComputedStyle(isl).width);
  const centered = P.trayOpen() || isl.classList.contains("detached");
  const right = head.clientWidth - width - (isl.classList.contains("detached") ? 172 : 16);
  const x = centered ? Math.max(16, Math.min(right, innerWidth / 2 - origin - width / 2)) : right;
  isl.style.transform = `translateX(${x}px)`;
  isl.dataset.placed = "1";
}
/* ---------- moments ---------- */
function say(ev) {
  moment = ev;
  clearTimeout(timer);
  timer = setTimeout(end, SHOW_MS);
  paint();
}
// force: the tray opens (the moment goes even under the pointer)
function end(force) {
  if (!moment) return;
  if (hovered && force !== true) { clearTimeout(timer); timer = setTimeout(end, 900); return; }
  moment = null; paint();
}
function act(a) {
  const ev = moment; if (!ev) return;
  if (a === "open" && ev.path) S.invoke("reveal_path", { path: ev.path }).catch(e => S.toast(String(e)));
  else if (a === "reveal" && ev.path) S.invoke("reveal_path", { path: ev.path }).catch(e => S.toast(String(e)));
  else if (a === "retry" && ev.id) S.jobs.retry(ev.id);
  else P.openTray({ focus: ev.id || ev.key });
  end(true);
}
const doneEv = j => ({ kind: "done", id: j.id, title: j.title || P.toolName(j.tool), verb: P.verb(j), path: j.outputs.length ? j.outputs[0].path : "", actions: j.outputs.length ? ["open"] : ["show"] });
const failEv = j => ({ kind: "failed", id: j.id, title: j.title || P.toolName(j.tool), verb: j.error ? window.__i18n.error(String(j.error).split("\n")[0]) : P.verb(j), actions: ["retry"] });
// job transitions since the last "jobs" event
function onJobs() {
  const jobs = P.all(), trayOpen = P.trayOpen();
  const byGroup = g => jobs.filter(x => x.group === g);
  for (const j of jobs) {
    const was = prev.get(j.id);
    prev.set(j.id, j.state);
    if (was === j.state || quiet(j)) continue;
    if (j.state === "failed") P.setFailed(!trayOpen);
    if (trayOpen) continue;
    if (j.state === "running" && was !== "running" && j.tool !== S.active() && (!j.group || !byGroup(j.group).some(x => x !== j && x.state === "running")))
      say({ kind: "started", id: j.id, title: j.group ? P.groupTitle({ first: j }) : j.title, verb: S.t("proc.verb.started"), actions: ["show"] });
    else if (j.state === "done" || j.state === "failed") {
      if (j.group && byGroup(j.group).length > 1) {
        const g = byGroup(j.group);
        if (g.some(P.isLive)) continue;
        const ok = g.filter(x => x.state === "done").length, bad = g.filter(x => x.state === "failed").length;
        say({ kind: bad ? "failed" : "done", key: "g-" + j.group, title: P.groupTitle({ first: g[0] }), verb: S.t("proc.nOf", { done: ok, total: g.length }) + (bad ? " · " + S.t("common.withErrors", { n: bad }) : ""), actions: ["show"] });
      } else say(j.state === "done" ? doneEv(j) : failEv(j));
    }
  }
  for (const id of [...prev.keys()]) if (!jobs.some(j => j.id === id)) prev.delete(id);
}
// a job waiting for a resource for more than 3 s: said once (once per batch)
function checkWaits() {
  if (!S.jobs || P.trayOpen()) return;
  const now = Date.now();
  for (const j of P.all()) {
    if (j.state !== "queued" || !j.waitingFor || j.waitingFor === "held" || j.waitingFor === "paused" || !j.waitSince || quiet(j)) continue;
    const k = j.group || j.id;
    if (announced.has(k) || now - j.waitSince < WAIT_MS) continue;
    // a job behind others of its own tool in a busy lane is simply queued: only the first in line says it waits
    if (S.jobs.position(j.id) > 1) continue;
    announced.add(k);
    say({ kind: "wait", id: j.id, title: j.group ? P.groupTitle({ first: j }) : j.title || P.toolName(j.tool), verb: P.waitText(j), actions: ["show"] });
  }
}
// back in view: what ended meanwhile, in one line
function back() {
  if (document.hidden || !S.jobs) return;
  const ended = S.jobs.takeAwayEnded();
  if (ended.length > 1) say({ kind: "summary", title: S.t("proc.nFinished", { n: ended.length }), verb: "", actions: ["show"] });
  else if (ended.length === 1) { const j = ended[0]; say(j.state === "done" ? doneEv(j) : failEv(j)); }
}

/* ---------- the pointer: pause and cancel, the wheel, files dropped ---------- */
const ARM_MS = 3000;
let armed = 0;
function cancelFollowed(b) {
  const j = last && last.job; if (!j) return;
  if (j.state === "running" && Date.now() - j.startedAt > 10000 && armed !== j.id) {
    armed = j.id; b.classList.add("danger"); b.classList.remove("ghost");
    setTimeout(() => { if (armed === j.id) { armed = 0; b.classList.remove("danger"); b.classList.add("ghost"); } }, ARM_MS);
    return;
  }
  armed = 0; b.classList.remove("danger"); b.classList.add("ghost");
  S.jobs.cancel(j.group && !P.all().some(x => x.group === j.group && x !== j && P.isLive(x)) ? j.id : j.id);
}
function onWheel(e) {
  const live = visibleLive(); if (live.length < 2 || moment) return;
  e.preventDefault();
  pick = (pick + (e.deltaY > 0 ? 1 : -1) + live.length) % live.length;
  paint();
}
// dropped files go to the tool that launched a job last: queued there when it queues files, else opened in it
const kindOf = f => /^image\//.test(f.type) || /\.(png|jpe?g|webp|avif|gif|bmp)$/i.test(f.name) ? "image" : /^audio\//.test(f.type) || /\.(mp3|wav|flac|m4a|ogg|opus|aac)$/i.test(f.name) ? "audio" : "video";
async function onDrop(e) {
  const isl = $("#procIsland"); isl.classList.remove("drop");
  const files = e.dataTransfer ? [...e.dataTransfer.files] : []; if (!files.length) return;
  e.preventDefault(); e.stopPropagation();
  const recent = P.all().filter(j => !quiet(j)).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!recent) { S.toast(S.t("proc.dropNone")); return; }
  const tool = recent.tool;
  try {
    const app = await S.ensureApp(tool);
    if (app && app.enqueue && await app.enqueue(files)) { S.toast(S.t("proc.dropQueued", { n: files.length, tool: P.toolName(tool) })); return; }
    const f = files[0];
    if (await S.sendTo(tool, { kind: kindOf(f), blob: f, name: f.name }, { from: null })) S.toast(S.t("proc.dropOpened", { tool: P.toolName(tool) }));
    else S.toast(S.t("proc.dropNone"));
  } catch (err) { S.toast(String(err && err.message || err)); }
}
function bind() {
  const isl = $("#procIsland");
  window.__icons.apply(isl);
  isl.addEventListener("pointerenter", () => { hovered = true; });
  isl.addEventListener("pointerleave", () => { hovered = false; paint(); if (moment) { clearTimeout(timer); timer = setTimeout(end, 1200); } });
  isl.addEventListener("wheel", onWheel, { passive: false });
  isl.querySelector(".isl-act").addEventListener("click", e => { e.stopPropagation(); act(e.currentTarget.dataset.act); });
  isl.querySelector(".isl-reveal").addEventListener("click", e => { e.stopPropagation(); act("reveal"); });
  isl.querySelector(".isl-hold").addEventListener("click", e => { e.stopPropagation(); const j = last && last.job; if (j) S.jobs.hold(j.id, j.state !== "held"); });
  isl.querySelector(".isl-x").addEventListener("click", e => { e.stopPropagation(); cancelFollowed(e.currentTarget); });
  isl.addEventListener("dragover", e => { if (e.dataTransfer && [...e.dataTransfer.types].includes("Files")) { e.preventDefault(); isl.classList.add("drop"); } });
  isl.addEventListener("dragleave", () => isl.classList.remove("drop"));
  isl.addEventListener("drop", onDrop);
  // the bar's left side changes with the page (its title, "Saved", "Back to"): the island keeps its room
  const ro = new ResizeObserver(() => paint());
  ro.observe($(".head")); for (const s of ["#pageTitle", "#sync", "#backTo"]) if ($(s)) ro.observe($(s));
  document.fonts.ready.then(() => paint());
  new MutationObserver(() => requestAnimationFrame(paint)).observe($("#pageTitle"), { childList: true, subtree: true, characterData: true });
  setInterval(checkWaits, 1000);
  document.addEventListener("visibilitychange", back);
  window.addEventListener("focus", back);
  readSys(true);
}
function setFailed(on) { const isl = $("#procIsland"); if (isl) isl.classList.toggle("failed", !!on); }
Object.assign(P, { paintIsland: paint, placeIsland: place, resizeSurface, followSurface, preserveHeader, preserveToolbox, syncToolbox, say, closePill: end, onPillJobs: onJobs, checkWaits, bindIsland: bind, setFailed, readSys, sys, lastIsland: () => last, CIRC: C, bytes });
})();

/* ===== tray ===== */
// The expanded body belongs to the island, 400 px wide and up to 70 % of the window including its header.
// one line. Rows: thumbnail, title, tool, stage and progress; queued rows can be dragged, held and cancelled; a batch
// is one row that unfolds; a click on a row shows its details in place. Header: counts and a menu; footer: Cancel all
// (asks in place) and the way to Settings → Processing.
(() => {
"use strict";
const S = window.__shell, P = window.__procs, M = window.__motion;
const $ = s => document.querySelector(s), esc = s => S.esc(String(s == null ? "" : s)), ic = n => window.__icons.icon(n);
const ui = { open: false, groupsOpen: [], finishedOpen: false };
const openRows = new Set();
let returnFocus = null, lastSig = "", armedCancel = null, armedAll = 0;

/* ---------- rows ---------- */
function thumb(j) {
  return j.thumb ? `<span class="pth" style="background-image:url('${esc(j.thumb)}')"></span>` : `<span class="pth">${ic(P.toolIcon(j.tool))}</span>`;
}
function jobRow(j, nested) {
  const running = j.state === "running", queued = j.state === "queued" || j.state === "held", ended = P.ENDED.includes(j.state);
  const armed = armedCancel && armedCancel.id === j.id;
  const acts = [];
  if (!nested) acts.push(`<button class="btn sm ghost icon pgo" data-act="go" title="${esc(S.t("proc.goTool", { tool: P.toolName(j.tool) }))}" aria-label="${esc(S.t("proc.goTool", { tool: P.toolName(j.tool) }))}" tabindex="-1">${ic(P.toolIcon(j.tool))}</button>`);
  if (queued) acts.push(`<button class="btn sm ghost icon" data-act="hold" title="${esc(S.t(j.state === "held" ? "proc.resume" : "proc.hold"))}" aria-label="${esc(S.t(j.state === "held" ? "proc.resume" : "proc.hold"))}" tabindex="-1">${ic(j.state === "held" ? "play" : "pause")}</button>`);
  if ((running || queued) && j.cancellable) acts.push(armed ? `<button class="btn sm danger pcancel armed" data-act="cancel" tabindex="-1">${esc(S.t("proc.cancelAsk"))}</button>` : `<button class="btn sm ghost icon pcancel" data-act="cancel" title="${esc(S.t("proc.cancel"))}" aria-label="${esc(S.t("proc.cancel"))}" tabindex="-1">${ic("x")}</button>`);
  if (j.state === "done" && j.outputs.length) acts.push(`<button class="btn sm ghost" data-act="open" tabindex="-1">${esc(S.t("common.reveal"))}</button>`);
  if (j.state === "failed") acts.push(`<button class="btn sm ghost" data-act="retry" tabindex="-1">${esc(S.t("proc.retry"))}</button>`);
  let sub = "";
  if (running) sub = [j.detail, j.stage].filter(Boolean).map(esc).join(" · ");
  else if (queued) sub = esc(P.waitText(j));
  else if (j.state === "done") sub = esc(P.verb(j));
  else if (j.state === "failed") sub = `<span class="bad">${esc(S.t("proc.failed"))}</span>${j.error ? " · " + esc(window.__i18n.error(j.error)) : ""}`;
  else sub = esc(S.t("proc.cancelled"));
  const meta = running ? (j.progress != null ? P.pct(j.progress) : "") + (j.eta != null && j.progress != null ? " · " + P.fmtEta(j.eta) : "") : "";
  const bar = running ? `<span class="prog${j.progress == null ? " indet" : ""}"><i></i></span>` : "";
  const status = j.state === "done" ? `<span class="pst ok">${ic("check")}</span>` : j.state === "failed" ? `<span class="pst bad">${ic("x")}</span>` : j.state === "cancelled" ? `<span class="pst">${ic("ban")}</span>` : "";
  // it unfolds only when it has something to say (a row with no details does not open)
  const more = detail(j), open = openRows.has(j.id) && !!more;
  return `<div class="prow${nested ? " nested" : ""}${more ? "" : " plain"}" role="option" tabindex="-1" aria-selected="false"${more ? ` aria-expanded="${open}"` : ""} data-key="${esc(j.id)}" data-id="${esc(j.id)}" data-state="${esc(j.state)}">`
    + (queued && !nested ? `<span class="pgrip" data-drag title="${esc(S.t("proc.drag"))}">${ic("grip-vertical")}</span>` : `<span class="pgrip none"></span>`)
    + (status || thumb(j))
    + `<span class="pmain"><b class="pt">${esc(j.title || P.toolName(j.tool))}</b><span class="psub">${sub}</span>${bar}</span>`
    + `<span class="pmeta" data-meta>${esc(meta)}</span><span class="pacts">${acts.join("")}</span>`
    + (open ? more : "") + `</div>`;
}
function detail(j) {
  const rows = [];
  if (j.stage) rows.push([S.t("proc.detail.stage"), esc(j.stage)]);
  if (j.detail) rows.push([S.t("proc.detail.what"), esc(j.detail)]);
  if (j.outputs.length) rows.push([S.t("proc.detail.files"), j.outputs.map(o => `<code>${esc(o.path)}</code>`).join("")]);
  if (j.origin && j.origin.from && j.origin.from.length) rows.push([S.t("proc.detail.from"), esc(j.origin.from.join(", "))]);
  if (j.error) rows.push([S.t("proc.detail.error"), esc(window.__i18n.error(j.error))]);
  if (j.state === "failed" && j.log.length) rows.push([S.t("proc.detail.log"), `<pre>${esc(j.log.slice(-8).join("\n"))}</pre>`]);
  const acts = j.state === "done" && j.outputs.length ? `<span class="pdacts"><button class="btn sm ghost" data-act="reveal" tabindex="-1">${ic("folder-open")}${esc(S.t("proc.reveal"))}</button><button class="btn sm ghost" data-act="send" aria-haspopup="menu" tabindex="-1">${ic("send")}${esc(S.t("proc.sendTo"))}</button><button class="btn sm ghost" data-act="library" tabindex="-1">${ic("library")}${esc(S.t("proc.inLibrary"))}</button></span>` : "";
  if (!rows.length && !acts) return "";
  return `<div class="pdetail">${rows.map(([k, v]) => `<span class="pdk">${esc(k)}</span><span class="pdv">${v}</span>`).join("")}${acts}</div>`;
}
function groupRow(g) {
  const live = g.jobs.filter(P.isLive), running = g.jobs.some(j => j.state === "running");
  const done = g.jobs.filter(j => j.state === "done").length, failed = g.jobs.filter(j => j.state === "failed").length;
  const p = P.progressOf(g.jobs), open = ui.groupsOpen.includes(g.group);
  const acts = [];
  acts.push(`<button class="btn sm ghost icon pgo" data-act="go" title="${esc(S.t("proc.goTool", { tool: P.toolName(g.first.tool) }))}" aria-label="${esc(S.t("proc.goTool", { tool: P.toolName(g.first.tool) }))}" tabindex="-1">${ic(P.toolIcon(g.first.tool))}</button>`);
  if (live.some(j => j.state !== "running")) { const held = live.filter(j => j.state !== "running").every(j => j.state === "held"); acts.push(`<button class="btn sm ghost icon" data-act="hold" title="${esc(S.t(held ? "proc.resume" : "proc.hold"))}" aria-label="${esc(S.t(held ? "proc.resume" : "proc.hold"))}" tabindex="-1">${ic(held ? "play" : "pause")}</button>`); }
  if (live.length) acts.push(armedCancel && armedCancel.id === "g-" + g.group ? `<button class="btn sm danger pcancel armed" data-act="cancel" tabindex="-1">${esc(S.t("proc.cancelAsk"))}</button>` : `<button class="btn sm ghost icon pcancel" data-act="cancel" title="${esc(S.t("proc.cancel"))}" aria-label="${esc(S.t("proc.cancel"))}" tabindex="-1">${ic("x")}</button>`);
  const sub = S.t("proc.nOf", { done, total: g.jobs.length }) + (failed ? " · " + S.t("common.withErrors", { n: failed }) : "") + (!running && live.length ? " · " + P.waitText(live[0]) : "");
  return `<div class="prow group" role="option" tabindex="-1" aria-selected="false" aria-expanded="${open}" data-key="g-${esc(g.group)}" data-group="${esc(g.group)}" data-state="${running ? "running" : live.length ? "queued" : "ended"}">`
    + `<span class="pgrip pfoldi">${ic(open ? "chevron-down" : "chevron-right")}</span>${thumb(g.first)}`
    + `<span class="pmain"><b class="pt">${esc(P.groupTitle(g))}</b><span class="psub"><span class="ptool">${esc(P.toolName(g.first.tool))}</span> · ${esc(sub)}</span>${running ? `<span class="prog${p == null ? " indet" : ""}"><i></i></span>` : ""}</span>`
    + `<span class="pmeta" data-meta>${running && p != null ? esc(P.pct(p)) : ""}</span><span class="pacts">${acts.join("")}</span></div>`
    + (open ? `<div class="pbatch" data-key="gl-${esc(g.group)}">${g.jobs.map(j => jobRow(j, true)).join("")}</div>` : "");
}
// A notice that is not a job (updates.js: a new version waits): one quiet row under the jobs, with one action
let notice = null;
function noticeRow(n) {
  return `<div class="prow notice plain" role="option" tabindex="-1" aria-selected="false" data-key="n-${esc(n.key)}" data-notice="${esc(n.key)}"><span class="pgrip none"></span>`
    + `<span class="pth">${ic("download")}</span><span class="pmain"><b class="pt">${esc(n.title)}</b><span class="psub">${esc(n.sub || "")}</span></span>`
    + `<span class="pmeta"></span><span class="pacts"><button class="btn sm ghost" data-act="notice" tabindex="-1">${esc(n.label)}</button></span></div>`;
}
S.setActivityNotice = n => {
  notice = n || null;
  const isl = $("#procIsland"); if (isl) isl.classList.toggle("has-notice", !!notice);
  render();
};
const itemHtml = it => it.type === "group" ? groupRow(it) : jobRow(it.job, false);

/* ---------- render ---------- */
function signature(sec) {
  const f = it => it.type === "group" ? it.key + ":" + it.jobs.map(j => j.state + (j.waitingFor || "")).join(",") + (ui.groupsOpen.includes(it.group) ? "+" : "") : it.key + ":" + it.job.state + ":" + (it.job.waitingFor || "") + ":" + (it.job.progress == null ? "n" : "p") + (openRows.has(it.key) ? "+" : "") + ":" + it.job.stage + ":" + it.job.detail;
  return ["running", "queued", "finished"].map(k => sec[k].map(f).join("|")).join("#") + (ui.finishedOpen ? "F" : "") + (armedCancel ? armedCancel.id : "") + armedAll
    + (notice ? "N" + notice.title + notice.sub + notice.label : "");
}
function render(force) {
  const tray = $("#procTray"); if (!tray || tray.hidden || !ui.open) return;
  const sec = P.sections(), list = $("#procList");
  const c = S.jobs.counts();
  setText($("#procCounts"), [c.running ? S.t("proc.countRunning", { n: c.running }) : "", c.queued ? S.t("proc.countQueued", { n: c.queued }) : ""].filter(Boolean).join(" · "));
  const liveN = c.running + c.queued;
  const all = $("#procCancelAll");
  all.hidden = !liveN;
  setText(all, armedAll ? (liveN === 1 ? S.t("proc.cancelAllAskOne") : S.t("proc.cancelAllAsk", { n: liveN })) : S.t("proc.cancelAll"));
  all.classList.toggle("danger", !!armedAll); all.classList.toggle("ghost", !armedAll);
  const sig = signature(sec);
  if (!force && sig === lastSig) { patch(sec); return; }
  const before = lastSig && $("#procIsland .isl-bg").getBoundingClientRect();
  lastSig = sig;
  const focused = document.activeElement && document.activeElement.closest && document.activeElement.closest("#procList [data-key]");
  const fk = focused ? focused.dataset.key : null;
  // Presentation follows one job; scheduling, job actions and interruption geometry stay unchanged.
  const followed = P.lastIsland() && P.lastIsland().job;
  const live = P.all().filter(j => P.isLive(j) && !j.silent && j.priority !== "background").sort((a, b) => (a.state === "running" ? 0 : 1) - (b.state === "running" ? 0 : 1) || (a.startedAt || a.createdAt) - (b.startedAt || b.createdAt));
  const featured = followed && live.includes(followed) ? followed : live[0];
  const recent = P.all().filter(j => !j.silent && j.priority !== "background" && (j.state === "failed" || j.state === "done") && Date.now() - (j.endedAt || j.createdAt) < 60000).sort((a, b) => (b.endedAt || b.createdAt) - (a.endedAt || a.createdAt))[0];
  let html = featured ? jobRow(featured, false) : `<div class="pempty" data-key="h-empty" role="presentation"><span class="pquiet-mark" aria-hidden="true"></span><span><b>${esc(S.t("proc.empty"))}</b><small>${esc(S.t("proc.idleNote"))}</small></span></div>`;
  if (recent) html += jobRow(recent, false).replace('class="prow', 'class="prow recent');
  if (notice) html += noticeRow(notice);
  M.list(list, () => { list.innerHTML = html; });
  window.__icons.apply(list);
  patch(sec);
  if (before) P.resizeSurface(before);
  if (fk) { const el = list.querySelector(`[data-key="${CSS.escape(fk)}"]`); if (el) el.focus({ preventScroll: true }); }
}
function setText(el, value) { if (el && el.textContent !== value) el.textContent = value; }
// progress bars, percentages and times change in place (no rebuild)
function patch(sec) {
  const list = $("#procList");
  const each = it => {
    if (it.type === "group") {
      const row = list.querySelector(`[data-key="${CSS.escape(it.key)}"]`); if (!row) return;
      const p = P.progressOf(it.jobs), bar = row.querySelector(".prog i");
      if (bar && p != null) M.bar(bar, p);
      const m = row.querySelector("[data-meta]"); if (m && it.jobs.some(j => j.state === "running")) setText(m, p != null ? P.pct(p) : "");
      if (ui.groupsOpen.includes(it.group)) it.jobs.forEach(j => each({ type: "job", key: j.id, job: j }));
      return;
    }
    const j = it.job, row = list.querySelector(`[data-key="${CSS.escape(j.id)}"]`); if (!row || j.state !== "running") return;
    const bar = row.querySelector(".prog i"); if (bar && j.progress != null) M.bar(bar, j.progress);
    const m = row.querySelector("[data-meta]"); if (m) setText(m, (j.progress != null ? P.pct(j.progress) : "") + (j.eta != null && j.progress != null ? " · " + P.fmtEta(j.eta) : ""));
  };
  for (const k of ["running", "queued", "finished"]) sec[k].forEach(each);
}

/* ---------- open and close ---------- */
const isOpen = () => ui.open;
function open(o = {}) {
  const tray = $("#procTray"), dot = $("#procBtn");
  if (!isOpen()) {
    const isl = $("#procIsland"), before = isl.querySelector(".isl-bg").getBoundingClientRect(), markBefore = isl.querySelector(".isl-mark").getBoundingClientRect(), controlsBefore = $("#toolbox").getBoundingClientRect();
    const text = isl.querySelector(".isl-text"), titleOpacity = text.querySelector(".isl-t").textContent ? getComputedStyle(text).opacity : 0;
    const ae = document.activeElement;
    returnFocus = ae && ae.tagName === "IFRAME" ? { frame: ae, el: ae.contentDocument && ae.contentDocument.activeElement } : { el: ae };
    lastSig = "";
    ui.open = true;
    P.syncToolbox();
    isl.classList.add("expanded"); isl.classList.remove("closing");
    tray.inert = false;
    tray.hidden = false;
    P.readSys(true); paintSys();
    render(true);
    P.setFailed(false);
    P.closePill(true);
    P.paintIsland();
    P.placeIsland(); P.resizeSurface(before); P.preserveHeader(markBefore); P.preserveToolbox(controlsBefore);
    if (isl.dataset.state === "rest") M.animate(text, [{ opacity: titleOpacity }, { opacity: 1 }], { dur: "fade", delay: M.dur("fade"), channel: "txt", rebase: true, lazy: false });
    M.animate(tray, [{ opacity: 0 }, { opacity: 1 }], { dur: ISLAND_MS, channel: "surface-content" });
    M.animate(isl.querySelector(".isl-menu"), [{ opacity: 0 }, { opacity: 1 }], { dur: "fade", delay: ISLAND_MS * .65, channel: "surface-content" });
    dot.setAttribute("aria-expanded", "true");
    listenOutside(true);
    remember(true);
  } else render(true);
  const k = o.focus, row = k && $("#procList").querySelector(`[data-key="${CSS.escape(k)}"]`);
  if (k && !row) {
    // a finished job or a batch folded away: unfold it
    const j = S.jobs.get(k);
    if (j && P.ENDED.includes(j.state)) ui.finishedOpen = true;
    if (j && j.group) ui.groupsOpen = [...new Set(ui.groupsOpen.concat(j.group))];
    render(true);
  }
  const target = (k && $("#procList").querySelector(`[data-key="${CSS.escape(k)}"]`)) || $("#procList").querySelector("[role=option]") || tray;
  target.focus({ preventScroll: false });
}
function close(o = {}) {
  if (!isOpen()) return;
  const tray = $("#procTray"), isl = $("#procIsland"), bg = isl.querySelector(".isl-bg");
  const before = bg.getBoundingClientRect(), markBefore = isl.querySelector(".isl-mark").getBoundingClientRect(), controlsBefore = $("#toolbox").getBoundingClientRect();
  ui.open = false;
  closeMenu();
  isl.classList.remove("expanded"); isl.classList.add("closing");
  tray.inert = true;
  P.paintIsland();
  if (isl.dataset.state === "rest") M.stop(isl.querySelector(".isl-text"), "txt");
  P.resizeSurface(before); P.preserveHeader(markBefore); P.preserveToolbox(controlsBefore);
  M.animate(tray, [{ opacity: getComputedStyle(tray).opacity }, { opacity: 0 }], { dur: "fade", channel: "surface-content", fill: "forwards" });
  M.animate(isl.querySelector(".isl-menu"), [{ opacity: getComputedStyle(isl.querySelector(".isl-menu")).opacity }, { opacity: 0 }], { dur: "fade", channel: "surface-content", fill: "forwards" });
  $("#procBtn").setAttribute("aria-expanded", "false");
  armedCancel = null; armedAll = 0;
  listenOutside(false);
  remember(false);
  if (o.restore !== false && returnFocus) {
    try { if (returnFocus.frame) { returnFocus.frame.focus(); if (returnFocus.el && returnFocus.el.focus) returnFocus.el.focus(); } else if (returnFocus.el && returnFocus.el.focus && returnFocus.el !== document.body) returnFocus.el.focus(); } catch (e) {}
  }
  returnFocus = null;
}
const toggle = () => isOpen() ? close() : open();
// The body needs no independent placement: the parent surface contains and positions it.
function placeTray() { P.paintIsland(); }

/* ---------- the machine: RAM, GPU, the workspace, and Clean cache ---------- */
function paintSys() {
  const el = $("#procSysText"); if (!el) return;
  const r = S.jobs ? S.jobs.resources() : {}, ws = P.sys.ws, n = mb => (mb / 1024).toFixed(mb >= 10240 ? 0 : 1), parts = [];
  if (r.known && r.ramTotalMB) parts.push(S.t("proc.sysRam", { used: n(r.ramTotalMB - r.ramFreeMB), total: n(r.ramTotalMB) }));
  if (r.gpu && r.gpu.vramMB) parts.push(S.t("proc.sysGpu", { used: n(r.gpu.vramMB - (r.gpu.vramFreeMB || 0)), total: n(r.gpu.vramMB) }));
  if (ws) parts.push(S.t("proc.sysWs", { size: P.bytes((ws.cache || 0) + (ws.temp || 0)) }));
  el.title = r.gpu && r.gpu.name ? r.gpu.name : "";
  setText(el, parts.join(" · "));
  $("#procClean").disabled = !ws || !((ws.cache || 0) + (ws.temp || 0));
}
async function clean() {
  const b = $("#procClean"); b.disabled = true;
  try {
    const live = S.jobs.list().filter(P.isLive).map(j => j.id);
    const freed = await S.invoke("workspace_clean", { live });
    S.toast(S.t("proc.cleaned", { size: P.bytes(freed || 0) }));
  } catch (e) { S.toast(String(e)); }
  P.readSys(true);
}
// a click anywhere else (the main window or a tool page) closes it
function outside(e) { const t = e.target; if (t && t.closest && (t.closest("#procTray") || t.closest("#procIsland") || t.closest(".sendmenu"))) return; close({ restore: false }); }
function listenOutside(on) {
  const docs = [document, ...[...document.querySelectorAll("#views iframe.view")].map(f => { try { return f.contentDocument; } catch (e) { return null; } }).filter(Boolean)];
  for (const d of docs) d[on ? "addEventListener" : "removeEventListener"]("pointerdown", outside, true);
}
function remember(openNow) {
  ui.open = openNow;   // only for this run: the tray and its groups start closed (DECISIONS: reopening)
}

/* ---------- actions ---------- */
const CONFIRM_AFTER_MS = 10000, ARM_MS = 3000;
let armTimer = 0;
function cancelRow(row) {
  const id = row.dataset.group ? "g-" + row.dataset.group : row.dataset.id;
  const jobs = row.dataset.group ? P.all().filter(j => j.group === row.dataset.group) : [S.jobs.get(row.dataset.id)].filter(Boolean);
  const long = jobs.some(j => j.state === "running" && Date.now() - j.startedAt > CONFIRM_AFTER_MS);
  if (long && !(armedCancel && armedCancel.id === id)) {
    armedCancel = { id }; clearTimeout(armTimer); armTimer = setTimeout(() => { armedCancel = null; render(); }, ARM_MS);
    render(); const b = $("#procList").querySelector(`[data-key="${CSS.escape(id)}"] .pcancel`); if (b) b.focus();
    return;
  }
  armedCancel = null;
  if (row.dataset.group) S.jobs.cancel(row.dataset.group); else S.jobs.cancel(row.dataset.id);
}
function holdRow(row) {
  if (row.dataset.group) {
    const q = P.all().filter(j => j.group === row.dataset.group && (j.state === "queued" || j.state === "held"));
    const on = !q.every(j => j.state === "held");
    q.forEach(j => S.jobs.hold(j.id, on));
  } else { const j = S.jobs.get(row.dataset.id); if (j) S.jobs.hold(j.id, j.state !== "held"); }
}
function openResult(j) { if (j && j.outputs.length) S.invoke("reveal_path", { path: j.outputs[0].path }).catch(e => S.toast(String(e))); }
function onClick(e) {
  const b = e.target.closest("[data-act]"), row = e.target.closest(".prow");
  if (b) {
    const a = b.dataset.act, j = row && row.dataset.id ? S.jobs.get(row.dataset.id) : null;
    e.stopPropagation();
    if (a === "fold") { ui.finishedOpen = !ui.finishedOpen; render(true); return; }
    if (a === "clear") { S.jobs.clearFinished(); render(true); return; }
    if (!row) return;
    if (a === "notice") { const n = notice; close({ restore: false }); if (n && n.run) n.run(); return; }
    if (a === "cancel") cancelRow(row);
    else if (a === "hold") holdRow(row);
    else if (a === "open") openResult(j);
    else if (a === "retry" && j) S.jobs.retry(j.id);
    else if (a === "reveal" && j) S.invoke("reveal_path", { path: j.outputs[0].path }).catch(err => S.toast(String(err)));
    else if (a === "send" && j) { const o = j.outputs[0]; window.__ui.openSend(b, { kind: o.kind || kindOf(o.path), from: "processes", item: () => ({ path: o.path, name: o.path.split(/[\\/]/).pop() }) }); }
    else if (a === "library" && j) { close({ restore: false }); if (S.openInLibrary) S.openInLibrary(j.outputs[0].path); else S.show("library"); }
    else if (a === "go") { close({ restore: false }); S.show(j ? j.tool : (P.all().find(x => x.group === row.dataset.group) || {}).tool); }
    return;
  }
  if (!row) return;
  row.focus();
  if (row.dataset.group) { const g = row.dataset.group; ui.groupsOpen = ui.groupsOpen.includes(g) ? ui.groupsOpen.filter(x => x !== g) : ui.groupsOpen.concat(g); remember(true); render(true); return; }
  const id = row.dataset.id;
  if (openRows.has(id)) openRows.delete(id); else if (!row.classList.contains("plain")) openRows.add(id);
  render(true);
}
const kindOf = p => /\.(png|jpe?g|webp|avif|gif)$/i.test(p) ? "image" : /\.(mp3|wav|flac|m4a|ogg|opus)$/i.test(p) ? "audio" : "video";
function cancelAll() {
  const c = S.jobs.counts(), n = c.running + c.queued;
  if (!n) return;
  if (!armedAll) { armedAll = n; clearTimeout(armTimer); armTimer = setTimeout(() => { armedAll = 0; render(); }, ARM_MS); render(); return; }
  armedAll = 0; S.jobs.cancelAll(); render(true);
}

/* ---------- the ⋯ menu ---------- */
function openMenu() {
  const m = $("#procMenu"); if (!m.hidden) { closeMenu(); return; }
  M.openPopover(m, $("#procMore"));
  $("#procMore").setAttribute("aria-expanded", "true");
  const first = m.querySelector("button"); if (first) first.focus();
}
function closeMenu() { const m = $("#procMenu"); if (m && !m.hidden) { M.closePopover(m); $("#procMore").setAttribute("aria-expanded", "false"); } }

/* ---------- keyboard ---------- */
function rows() { return [...$("#procList").querySelectorAll("[role=option]")]; }
function onKey(e) {
  if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); if (!$("#procMenu").hidden) { closeMenu(); $("#procMore").focus(); return; } close(); return; }
  const row = e.target.closest && e.target.closest("[role=option]");
  const list = rows(), i = row ? list.indexOf(row) : -1;
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && !e.altKey) {
    if (!e.target.closest("#procList") && e.target.closest("#procMenu")) return;
    e.preventDefault();
    const next = list[Math.max(0, Math.min(list.length - 1, i < 0 ? 0 : i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) next.focus();
    return;
  }
  if (!row || e.target !== row) return;
  const j = row.dataset.id ? S.jobs.get(row.dataset.id) : null;
  if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.altKey) {
    e.preventDefault();
    if (j && (j.state === "queued" || j.state === "held") && !row.classList.contains("nested")) { S.jobs.nudge(j.id, e.key === "ArrowUp" ? -1 : 1); render(true); }
    return;
  }
  if (e.key === "Delete") { e.preventDefault(); cancelRow(row); return; }
  if (e.key === " ") { e.preventDefault(); holdRow(row); return; }
  if (e.key === "Enter") {
    e.preventDefault();
    if (j && j.state === "done") openResult(j);
    else row.click();
  }
}

/* ---------- drag to reorder (queued) ---------- */
function onDown(e) {
  const grip = e.target.closest("[data-drag]"); if (!grip || e.button !== 0) return;
  const row = grip.closest(".prow"), list = $("#procList");
  e.preventDefault();
  const queued = () => [...list.querySelectorAll('.prow:not(.nested)')].filter(r => r.dataset.state === "queued" || r.dataset.state === "held");
  const y0 = e.clientY, r0 = row.getBoundingClientRect();
  let target = undefined;
  row.classList.add("dragging");
  grip.setPointerCapture(e.pointerId);
  const move = ev => {
    const dy = ev.clientY - y0;
    row.style.transform = `translateY(${dy}px)`;
    const mid = r0.top + r0.height / 2 + dy;
    const others = queued().filter(r => r !== row);
    const before = others.find(r => { const b = r.getBoundingClientRect(); return mid < b.top + b.height / 2; });
    target = before ? before.dataset.id || before.dataset.key : null;
    others.forEach(r => r.classList.toggle("drop-before", r === before));
    list.classList.toggle("drop-end", !before);
  };
  const up = () => {
    grip.removeEventListener("pointermove", move); grip.removeEventListener("pointerup", up); grip.removeEventListener("pointercancel", up);
    row.classList.remove("dragging"); row.style.transform = "";
    list.querySelectorAll(".drop-before").forEach(r => r.classList.remove("drop-before")); list.classList.remove("drop-end");
    if (target !== undefined) {
      const before = target && target.startsWith("g-") ? (P.all().find(j => j.group === target.slice(2) && (j.state === "queued" || j.state === "held")) || {}).id : target;
      if (row.dataset.id) S.jobs.moveBefore(row.dataset.id, before || null);
      render(true);
    }
  };
  grip.addEventListener("pointermove", move); grip.addEventListener("pointerup", up); grip.addEventListener("pointercancel", up);
}

function bind() {
  const tray = $("#procTray");
  $("#procBtn").addEventListener("click", toggle);
  $("#procClean")?.addEventListener("click", clean);
  window.addEventListener("resize", () => { if (isOpen()) placeTray(); });
  tray.addEventListener("click", onClick);
  tray.addEventListener("keydown", onKey);
  $("#procIsland .isl-head").addEventListener("keydown", onKey);
  tray.addEventListener("pointerdown", onDown);
  $("#procMore").addEventListener("click", e => { e.stopPropagation(); openMenu(); });
  $("#procMenu").addEventListener("click", e => {
    const b = e.target.closest("[data-menu]"); if (!b) return;
    closeMenu();
    if (b.dataset.menu === "queued") S.jobs.cancelAll({ queuedOnly: true }); else S.jobs.clearFinished();
    render(true); $("#procMore").focus();
  });
  $("#procCancelAll").addEventListener("click", cancelAll);
  $("#procSettings")?.addEventListener("click", () => { close({ restore: false }); S.show("settings"); if (S.settingsSection) S.settingsSection("processing"); });
}
Object.assign(P, { paintSys, placeTray, openTray: open, closeTray: close, toggleTray: toggle, trayOpen: isOpen, renderTray: render, bindTray: bind });
})();

/* ===== launch ===== */
// "Launch and keep working": the button that queued a job says so for 1.5 s ("Queued · 2nd", "Started") and a
// The mark receives a tiny local cue, without a flight across the tool. Reduced motion: only the text.
(() => {
"use strict";
const S = window.__shell, P = window.__procs, M = window.__motion;
const $ = s => document.querySelector(s), esc = s => S.esc(String(s == null ? "" : s));
const BACK_MS = 1500;
function fly(from, o) {
  if (M.reduced() || !from) return;
  const dot = $("#procIsland .isl-mark"), d = dot.getBoundingClientRect();
  if (!d.width) return;
  const el = document.createElement("div");
  el.className = "pfly";
  if (o.thumb) el.style.backgroundImage = `url('${o.thumb}')`; else el.innerHTML = window.__icons.icon(P.toolIcon(o.tool || ""));
  document.body.appendChild(el);
  const size = 16, x = d.left + d.width / 2 - size / 2, y = d.top + d.height / 2 - size / 2;
  const a = M.animate(el, [{ transform: `translate(${x}px,${y + 3}px)`, opacity: 0.5 }, { transform: `translate(${x}px,${y}px)`, opacity: 0 }], { dur: "fade", fill: "forwards" });
  const end = () => el.remove();
  if (a) a.finished.then(end); else end();
}
// launched(button, handle, { thumb, tool }): button confirmation and a local cue; the button is free again at once
async function launched(btn, handle, o = {}) {
  if (!btn || !handle) return;
  fly(btn, o);
  // a moment for the scheduler to decide (it answers within a frame or two)
  await new Promise(r => setTimeout(r, 60));
  const j = S.jobs.get(handle.id);
  const text = !j ? "" : j.state === "running" || j.state === "done" ? S.t("proc.started") : S.t("proc.queuedN", { n: P.ordinal(Math.max(1, S.jobs.position(handle.id))) });
  if (!text) return;
  const lbl = btn.querySelector(".lbl") || btn;
  if (!btn.__launch) btn.__launch = { html: lbl.innerHTML, lbl };
  clearTimeout(btn.__launch.timer);
  const icon = lbl === btn ? (btn.querySelector("svg") ? btn.querySelector("svg").outerHTML : "") : "";
  lbl.innerHTML = icon + `<span class="launched">${esc(text)}</span>`;
  btn.classList.add("launched-on");
  btn.__launch.timer = setTimeout(() => { if (!btn.__launch) return; btn.__launch.lbl.innerHTML = btn.__launch.html; btn.classList.remove("launched-on"); delete btn.__launch; }, BACK_MS);
}
Object.assign(P, { launched, fly });
})();

/* ===== start ===== */
(() => {
"use strict";
const S = window.__shell, P = window.__procs;
let frame = 0;
function onJobs() {
  P.onPillJobs();
  window.__renderBudget.setLoad(S.jobs.counts().running);
  if (!window.__renderBudget.visible || frame) return;
  frame = requestAnimationFrame(() => { frame = 0; P.paintIsland(true); P.renderTray(); if (P.trayOpen()) P.paintSys(); });
}
function start() {
  if (!document.querySelector("#procIsland") || !S.jobs) return;
  window.__icons.apply(document.querySelector("#procIsland"));
  P.bindIsland(); P.bindTray();
  S.on("jobs", onJobs);
  window.__renderBudget.subscribe(()=>{if(window.__renderBudget.visible)onJobs();});
  S.on("settings", () => P.paintIsland());
  P.paintIsland();
}
// after the dictionaries load, so the dot's label is in the right language
(S.ready || Promise.resolve()).then(start, start);
Object.assign(S, { processes: { open: P.openTray, close: P.closeTray, toggle: P.toggleTray }, jobLaunched: P.launched });
})();
