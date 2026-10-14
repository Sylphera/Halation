// Halation Preview (docs/PREVIEW.md): the frontend of a worktree or branch, live, in a native Halation Preview window
// (or in Chromium with the mocked backend), reloaded on every change without building anything.
//   node app/scripts/halation-preview.cjs <worktree path | branch> [--chromium] [--profile name] [--port n]
//   node app/scripts/halation-preview.cjs --build <worktree path | branch>   (the Preview exe, once per Rust change)
// The routing is the benchmarks' (ui-benchmark.cjs): CDP on the WebView2 window, tauri.localhost served from the
// worktree. Never touches app/dist, main, the real Halation's data, releases or a worktree with changes.
"use strict";
const fs = require("fs"), path = require("path"), os = require("os"), cp = require("child_process"), http = require("http");

/* ===== options ===== */

const REPO = path.resolve(__dirname, "../..");            // the checkout this script belongs to, never the cwd
const STATE = path.join(REPO, ".tools", "preview");
const BIN = path.join(STATE, "bin"), EXE = path.join(BIN, "halation-preview.exe"), BUILD_INFO = path.join(BIN, "halation-preview.build.json");
const INFO_PATH = "/__halation-preview/info.json";
const GIT = process.env.GIT || "git";

function parseArgs(argv) {
  const o = { target: null, chromium: false, build: false, profile: "default", port: 9237, interval: 3, kind: null, exe: process.env.HALATION_PREVIEW_EXE || EXE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => { if (i + 1 >= argv.length) fail(`${a} needs a value`); return argv[++i]; };
    if (a === "--chromium") o.chromium = true;
    else if (a === "--build") o.build = true;
    else if (a === "--profile") o.profile = next();
    else if (a === "--port") o.port = +next();
    else if (a === "--interval") o.interval = +next();
    else if (a === "--path") { o.kind = "path"; o.target = next(); }
    else if (a === "--branch") { o.kind = "branch"; o.target = next(); }
    else if (a === "--exe") o.exe = path.resolve(next());
    else if (a === "-h" || a === "--help") usage(0);
    else if (a.startsWith("--")) fail("unknown option " + a);
    else if (o.target) fail("only one worktree or branch");
    else o.target = a;
  }
  if (!o.target) usage(1);
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(o.profile)) fail("--profile: letters, digits, - and _ only");
  if (!(o.port > 1024 && o.port < 65536)) fail("--port: 1025–65535");
  if (!(o.interval >= 1)) fail("--interval: seconds, at least 1");
  return o;
}
function usage(code) {
  console.log("usage: node app/scripts/halation-preview.cjs <worktree path | branch> [--chromium] [--profile name] [--port n] [--interval s]\n" +
    "       node app/scripts/halation-preview.cjs --build <worktree path | branch>\n" +
    "       --path <dir> / --branch <name> force how the target is read. See docs/PREVIEW.md.");
  process.exit(code);
}
function fail(msg) { console.error("halation-preview: " + msg); process.exit(1); }
const log = msg => console.log(`[${new Date().toLocaleTimeString()}] ${msg}`);

/* ===== git ===== */

function git(cwd, args, { allowFail = false } = {}) {
  const r = cp.spawnSync(GIT, ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) {
    if (allowFail) return null;
    throw new Error(`git ${args.join(" ")}: ${(r.stderr || r.error || "").toString().trim()}`);
  }
  return r.stdout.trim();
}
const gitAsync = (cwd, args) => new Promise((res, rej) =>
  cp.execFile(GIT, ["-C", cwd, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }, (e, out, err) => e ? rej(new Error(`git ${args.join(" ")}: ${(err || e.message).trim()}`)) : res(out.trim())));

// The backend a tree contains: the git tree of app/src-tauri, or null when it has uncommitted changes (unknown).
function backendOf(root, rev = "HEAD") {
  if (rev === "HEAD" && git(root, ["status", "--porcelain", "--", "app/src-tauri"], { allowFail: true })) return null;
  return git(root, ["rev-parse", `${rev}:app/src-tauri`], { allowFail: true });
}

/* ===== targets ===== */

// An existing folder, or something only a path can be (., ~, absolute, a drive, a backslash), is a worktree used as it
// is; anything else is a branch of origin, "/" included (claude/…).
function targetKind(o) {
  if (o.kind) return o.kind;
  const t = o.target;
  if (fs.existsSync(t) && fs.statSync(t).isDirectory()) return "path";
  if (/^[.~]/.test(t) || path.isAbsolute(t) || /^[A-Za-z]:/.test(t) || t.includes("\\")) return "path";
  return "branch";
}

function localTarget(dir) {
  if (!fs.existsSync(dir)) fail(`no folder ${path.resolve(dir)} (for a branch use --branch <name>)`);
  const root = fs.realpathSync(path.resolve(dir));
  if (!fs.existsSync(path.join(root, "app", "dist", "index.html"))) fail(`${root} has no app/dist/index.html`);
  const inGit = git(root, ["rev-parse", "--is-inside-work-tree"], { allowFail: true }) === "true";
  const describe = () => {
    if (!inGit) return { label: path.basename(root), commit: "no git", dirty: false, backend: null };
    const branch = git(root, ["rev-parse", "--abbrev-ref", "HEAD"], { allowFail: true }) || "?";
    return {
      label: `${branch === "HEAD" ? "detached" : branch} @ ${path.basename(root)}`,
      commit: git(root, ["rev-parse", "--short", "HEAD"]),
      dirty: !!git(root, ["status", "--porcelain", "--", "app/dist"], { allowFail: true }),
      backend: backendOf(root)
    };
  };
  return { kind: "path", root, dist: path.join(root, "app", "dist"), describe };
}

// A branch is followed in a worktree of its own (.tools/preview/<profile>/worktree, detached), created and moved only
// by this script, and only while it has no changes.
function branchTarget(o) {
  const branch = o.target;
  if (git(REPO, ["check-ref-format", "--branch", branch], { allowFail: true }) === null) fail(`invalid branch name ${branch}`);
  if (branch === "main" || branch === "master") log(`following ${branch}: read-only, nothing is ever written to it`);
  const dir = path.join(STATE, o.profile, "worktree"), mark = path.join(STATE, o.profile, "worktree.json");
  const remoteRef = `refs/remotes/origin/${branch}`;
  const t = { kind: "branch", branch, root: dir, dist: path.join(dir, "app", "dist"), sha: null, blocked: null };
  t.fetch = async () => {
    await gitAsync(REPO, ["fetch", "--quiet", "origin", `+refs/heads/${branch}:${remoteRef}`]);
    return gitAsync(REPO, ["rev-parse", remoteRef]);
  };
  t.remoteSha = async () => {
    const out = await gitAsync(REPO, ["ls-remote", "origin", `refs/heads/${branch}`]);
    if (!out) throw new Error(`origin has no branch ${branch}`);
    return out.split(/\s+/)[0];
  };
  t.checkout = sha => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(path.dirname(dir), { recursive: true });
      git(REPO, ["worktree", "add", "--detach", dir, sha]);
      fs.writeFileSync(mark, JSON.stringify({ owner: "halation-preview", branch, created: new Date().toISOString() }, null, 2));
    } else {
      if (!fs.existsSync(mark)) throw new Error(`${dir} exists but was not created by halation-preview; not touching it`);
      const common = p => path.resolve(p, git(p, ["rev-parse", "--git-common-dir"]));
      if (common(dir) !== common(REPO)) throw new Error(`${dir} is not a worktree of ${REPO}; not touching it`);
      const changes = git(dir, ["status", "--porcelain", "--untracked-files=normal"]);
      if (changes) { t.blocked = "the preview worktree has changes: not updated"; throw new Error(`${dir} has changes, not updating it:\n${changes}`); }
      if (git(dir, ["rev-parse", "HEAD"]) !== sha) git(dir, ["checkout", "--quiet", "--detach", sha]);
    }
    t.blocked = null;
    t.sha = sha;
  };
  t.describe = () => ({ label: `origin/${branch}`, commit: t.sha ? t.sha.slice(0, 7) : "?", dirty: false, backend: t.sha ? backendOf(dir, t.sha) : null, blocked: t.blocked });
  return t;
}

/* ===== serving app/dist ===== */

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".ico": "image/x-icon",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".otf": "font/otf", ".wasm": "application/wasm",
  ".txt": "text/plain; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".map": "application/json",
  ".mp4": "video/mp4", ".webm": "video/webm", ".mp3": "audio/mpeg", ".wav": "audio/wav", ".onnx": "application/octet-stream"
};

// A request for http://tauri.localhost/<path> → a file of `dist`, never anything outside it and never the embedded
// frontend: a missing file is a 404 that the badge and the console show.
function resolveAsset(dist, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { return { status: 400, reason: "bad URL" }; }
  if (rel === "/" || rel === "") rel = "/index.html";
  if (rel.includes("\0")) return { status: 400, reason: "bad URL" };
  const file = path.resolve(dist, "." + rel);
  if (file !== dist && !file.startsWith(dist + path.sep)) return { status: 403, reason: "outside app/dist" };
  let real;
  try { real = fs.realpathSync(file); } catch (e) { return { status: 404, reason: "not in app/dist" }; }
  const realDist = fs.realpathSync(dist);
  if (!real.startsWith(realDist + path.sep)) return { status: 403, reason: "outside app/dist" };
  if (!fs.statSync(real).isFile()) return { status: 404, reason: "not a file" };
  return { status: 200, file: real, type: TYPES[path.extname(real).toLowerCase()] || "application/octet-stream" };
}

/* ===== what the window shows (injected, app/dist untouched) ===== */

// Runs in every frame before the page's own scripts. The top frame gets the badge; every frame reports an IPC command
// the exe does not have (the call still fails as it would, it is only made visible).
const PAGE_SCRIPT = info => {
  const TOP = window === window.top;
  const missing = cmd => {
    console.error(`Halation Preview: the exe has no command "${cmd}". Rebuild Halation Preview (docs/PREVIEW.md).`);
    try { window.top.__halPreview && window.top.__halPreview.missing(cmd); } catch (e) {}
  };
  const isMissing = (cmd, e) => {
    const m = String((e && e.message) || e);
    return new RegExp(`(command\\s+${cmd}\\s+not found|unknown command\\s+${cmd})`, "i").test(m);
  };
  const wrap = core => {
    if (!core || core.__halPreview || typeof core.invoke !== "function") return;
    const inner = core.invoke;
    const invoke = function (cmd, ...rest) {
      return Promise.resolve(inner.call(this, cmd, ...rest)).catch(e => { if (isMissing(cmd, e)) missing(cmd); throw e; });
    };
    try { core.invoke = invoke; core.__halPreview = true; } catch (e) {}
  };
  const hook = () => { try { wrap(window.__TAURI__ && window.__TAURI__.core); } catch (e) {} };
  if (window.__TAURI__) hook();
  else {
    let v;
    try {
      Object.defineProperty(window, "__TAURI__", { configurable: true, enumerable: true, get: () => v, set: x => { v = x; hook(); } });
    } catch (e) {}
  }
  // the internals too, for a frontend that calls them directly
  const hookInternals = () => {
    const i = window.__TAURI_INTERNALS__;
    if (!i || i.__halPreview || typeof i.invoke !== "function") return;
    const inner = i.invoke;
    try {
      i.invoke = function (cmd, ...rest) { return Promise.resolve(inner.call(this, cmd, ...rest)).catch(e => { if (isMissing(cmd, e)) missing(cmd); throw e; }); };
      i.__halPreview = true;
    } catch (e) {}
  };
  hookInternals();
  document.addEventListener("DOMContentLoaded", () => { hook(); hookInternals(); });
  if (!TOP) return;

  const state = { info, missing: new Set() };
  const host = document.createElement("halation-preview-badge");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
    :host { all: initial; visibility: visible !important; position: fixed; left: 8px; bottom: 8px; z-index: 2147483647; pointer-events: none; }
    .b { font: 600 10.5px/1.35 ui-monospace, Consolas, monospace; color: #f2efe8; background: rgba(12,12,13,.82);
         border: 1px solid rgba(255,190,60,.75); border-radius: 6px; padding: 4px 7px; max-width: 46vw; }
    .t { color: #ffbe3c; letter-spacing: .08em; } .w { color: #ff6b5b; } .n { color: #b9b4aa; font-weight: 500; }
  </style><div class="b"></div>`;
  const box = root.querySelector(".b");
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const render = () => {
    const i = state.info || {};
    const lines = [`<span class="t">PREVIEW</span> · ${esc(i.label || "?")} · ${esc(i.commit || "?")}${i.dirty ? " +changes" : ""}${i.mode === "chromium" ? ' <span class="n">· chromium + host.js</span>' : ""}`];
    for (const w of i.warnings || []) lines.push(`<span class="w">${esc(w)}</span>`);
    for (const m of i.missingFiles || []) lines.push(`<span class="w">404 ${esc(m)}</span>`);
    for (const c of state.missing) lines.push(`<span class="w">IPC: the exe has no command ${esc(c)}: rebuild Preview</span>`);
    box.innerHTML = lines.join("<br>");
  };
  window.__halPreview = { missing: c => { state.missing.add(c); render(); } };
  // on <html>, outside <body>: the app's rules on body's children (the welcome hides them) never reach it
  // the launcher keeps the info current (Rust fingerprint, 404s) at INFO_PATH; when it stops, the badge says so
  const poll = async () => {
    try { state.info = await (await fetch(info.infoPath, { cache: "no-store" })).json(); }
    catch (e) { state.info = Object.assign({}, state.info, { warnings: ["launcher stopped: this window is no longer live"] }); }
    render();
  };
  const mount = () => { document.documentElement.appendChild(host); render(); poll(); setInterval(poll, 2000); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", mount); else mount();
};

/* ===== Rust fingerprint ===== */

function readBuild() { try { return JSON.parse(fs.readFileSync(BUILD_INFO, "utf8")); } catch (e) { return null; } }

// The backend the exe was built from (the sidecar written by --build) against the one the target has now.
function rustWarnings(desc, build) {
  if (!build) return ["no build info for the exe: rebuild Preview (--build) to compare its Rust"];
  if (!build.backend) return [`the exe was built from uncommitted Rust (${build.commit}): rebuild Preview from a commit`];
  if (!desc.backend) return ["Rust: uncommitted changes in app/src-tauri — rebuild Preview to use them"];
  if (desc.backend !== build.backend) return [`Rust changed since the exe (${build.commit}): rebuild Preview`];
  return [];
}

/* ===== playwright ===== */

function playwright() {
  const paths = [path.join(REPO, ".tools"), path.join(REPO, "app"), REPO];
  try { paths.push(cp.execSync("npm root -g", { encoding: "utf8" }).trim()); } catch (e) {}
  try { return require(require.resolve("playwright", { paths })); }
  catch (e) { fail("Playwright not found. Install it once: npm i --prefix .tools playwright (PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 is enough for the native preview)"); }
}

/* ===== session: routing, badge, reload ===== */

async function startSession(firstContext, target, mode) {
  const missingFiles = new Set();
  let desc = target.describe();
  const build = mode === "native" ? readBuild() : null;
  const info = () => ({
    mode, label: desc.label, commit: desc.commit, dirty: desc.dirty,
    warnings: [...(mode === "native" ? rustWarnings(desc, build) : []), ...(desc.blocked ? [desc.blocked] : [])],
    missingFiles: [...missingFiles].slice(-6), infoPath: INFO_PATH
  });
  // the routing and the badge live on a CDP connection: attach() puts them on a context, again after a reconnect
  let context = null, pending = null;
  const attach = async ctx => {
    context = ctx;
    await ctx.route("http://tauri.localhost/**", serve);
    await ctx.addInitScript(PAGE_SCRIPT, info());
  };
  const serve = async route => {
    const url = new URL(route.request().url());
    if (url.pathname === INFO_PATH) return route.fulfill({ status: 200, contentType: "application/json", headers: { "cache-control": "no-store" }, body: JSON.stringify(info()) });
    const r = resolveAsset(target.dist, url.pathname);
    if (r.status !== 200) {
      missingFiles.add(url.pathname);
      log(`${r.status} ${url.pathname} (${r.reason}) — served from ${target.dist}`);
      return route.fulfill({ status: r.status, contentType: "text/plain; charset=utf-8", body: `Halation Preview: ${url.pathname} ${r.reason} (${target.dist})` });
    }
    return route.fulfill({ status: 200, contentType: r.type, headers: { "cache-control": "no-store" }, body: fs.readFileSync(r.file) });
  };
  await attach(firstContext);
  const pages = () => context ? context.pages().filter(p => p.url().startsWith("http://tauri.localhost")) : [];
  // One reload at a time: changes that arrive during a reload (a reconnect, a burst of saves) reload once more after it.
  let running = null, again = null;
  const reloadNow = async why => {
    desc = target.describe();
    if (!context) { pending = why; log(`change while reconnecting (${why}): reloads on reconnect`); return; }
    missingFiles.clear();
    log(`reload (${why}): ${desc.label} ${desc.commit}${desc.dirty ? " +changes" : ""}`);
    for (const w of info().warnings) log("  ! " + w);
    await Promise.all(pages().map(p => p.reload({ waitUntil: "domcontentloaded" }).catch(e => log("reload failed: " + e.message))));
  };
  const reload = why => {
    if (running) { again = why; return running; }
    running = (async () => {
      try { await reloadNow(why); while (again) { const w = again; again = null; await reloadNow(w); } }
      finally { running = null; }
    })();
    return running;
  };
  const refresh = () => { desc = target.describe(); };
  const detach = () => { context = null; };
  const reattach = async ctx => { await attach(ctx); const why = pending; pending = null; await reload(why ? `reconnected; ${why}` : "reconnected"); };
  return { reload, refresh, pages, detach, reattach };
}

/* ===== watchers ===== */

// A local worktree: app/dist reloads the window; app/src-tauri only refreshes the Rust warning.
function watchLocal(target, session) {
  let timer = null;
  setInterval(() => session.refresh(), 2000);           // commits and checkouts change the badge, not app/dist
  const later = why => { clearTimeout(timer); timer = setTimeout(() => session.reload(why), 250); };
  fs.watch(target.dist, { recursive: true }, (ev, file) => later(`app/dist/${file || ""}`));
  const rust = path.join(target.root, "app", "src-tauri");
  if (fs.existsSync(rust)) fs.watch(rust, { recursive: true }, (ev, file) => {
    if (!file || /^(target|gen)([\\/]|$)/.test(file)) return;
    session.refresh();
  });
  log(`watching ${target.dist}`);
}

// A branch: ls-remote every few seconds; a new commit is fetched, checked out in the preview worktree and reloaded.
async function watchBranch(target, session, seconds) {
  log(`following origin/${target.branch} every ${seconds} s in ${target.root}`);
  for (;;) {
    await new Promise(r => setTimeout(r, seconds * 1000));
    try {
      const remote = await target.remoteSha();
      if (remote === target.sha) continue;
      const sha = await target.fetch();
      target.checkout(sha);
      await session.reload(`origin/${target.branch} → ${sha.slice(0, 7)}`);
    } catch (e) {
      log("! " + e.message.split("\n")[0]);
      session.refresh();
    }
  }
}

/* ===== native window ===== */

const cdpUp = port => new Promise(res => {
  const req = http.get({ host: "127.0.0.1", port, path: "/json/version", timeout: 800 }, r => { r.resume(); res(r.statusCode === 200); });
  req.on("error", () => res(false)); req.on("timeout", () => { req.destroy(); res(false); });
});

async function nativeContext(o) {
  if (!(await cdpUp(o.port))) {
    if (!fs.existsSync(o.exe)) fail(`no Halation Preview exe at ${o.exe}. Build it once: node app/scripts/halation-preview.cjs --build <worktree|branch>`);
    log(`starting ${o.exe} (profile ${o.profile}, CDP ${o.port})`);
    const env = { ...process.env, HALATION_PREVIEW_PROFILE: o.profile, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${o.port}` };
    delete env.WEBVIEW2_USER_DATA_FOLDER;                   // the exe picks the profile's own
    cp.spawn(o.exe, [], { env, detached: true, stdio: "ignore" }).unref();
    const t0 = Date.now();
    while (!(await cdpUp(o.port))) { if (Date.now() - t0 > 30000) fail(`Halation Preview did not open CDP on ${o.port}`); await new Promise(r => setTimeout(r, 300)); }
  } else log(`reusing the window on CDP ${o.port}`);
  return connectNative(o);
}

// Connects to the window on o.port and checks it is Halation Preview. When the CDP connection drops while the window
// is still there (CDP still answers), onDrop reconnects instead of ending; only a window that is gone ends the launcher.
async function connectNative(o) {
  const { chromium } = playwright();
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${o.port}`);
  const t0 = Date.now();
  let page;
  while (!(page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith("http://tauri.localhost")))) {
    if (Date.now() - t0 > 20000) fail("no Halation window on that CDP port");
    await new Promise(r => setTimeout(r, 200));
  }
  // Only ever drive Halation Preview: its folders are com.halation.preview's, never the real app's
  const paths = await page.evaluate(() => window.__TAURI__.core.invoke("paths")).catch(e => ({ error: String(e) }));
  if (!paths.base || !/com\.halation\.preview/i.test(paths.base)) {
    await browser.close().catch(() => {});
    fail(`the window on CDP ${o.port} is not Halation Preview (base folder: ${paths.base || paths.error}); refusing to touch it`);
  }
  log(`Halation Preview data: ${paths.base}`);
  return { context: page.context(), browser };
}

const RECONNECT_MS = +process.env.HALATION_PREVIEW_RECONNECT_MS || 15000;
function keepConnected(o, ctx, session) {
  ctx.browser.once("disconnected", async () => {
    session.detach();
    log("CDP connection lost: reconnecting");
    const t0 = Date.now();
    while (Date.now() - t0 < RECONNECT_MS) {
      await new Promise(r => setTimeout(r, 500));
      if (!(await cdpUp(o.port))) continue;
      try {
        const next = await connectNative(o);
        await session.reattach(next.context);
        keepConnected(o, next, session);
        return;
      } catch (e) { log("reconnect: " + e.message.split("\n")[0]); }
    }
    log("Halation Preview closed");
    process.exit(0);
  });
}

/* ===== chromium + host.js ===== */

async function chromiumContext(o, target) {
  const { chromium } = playwright();
  const data = path.join(STATE, o.profile, "chromium-data");
  fs.mkdirSync(data, { recursive: true });
  // the mocked backend of the target itself, so it matches its frontend
  const { createHost, MOCK } = require(path.join(target.root, "app", "tests", "host.js"));
  const host = createHost(data);
  // CDP on the same port as the native preview, for tools that attach to it (tests/preview.js)
  const opts = { headless: false, args: ["--autoplay-policy=no-user-gesture-required", `--remote-debugging-port=${o.port}`] };
  if (process.env.CHROME) opts.executablePath = process.env.CHROME;
  else if (process.platform === "win32") opts.channel = "msedge";
  const browser = await chromium.launch(opts);
  const context = await browser.newContext({ viewport: null });
  await context.exposeBinding("__host", (_src, cmd, args, b64, headers) => host.call(cmd, args, b64, headers));
  await context.addInitScript(MOCK);
  browser.on("disconnected", () => { log("Chromium closed"); process.exit(0); });
  return { context, browser, open: async () => { const p = await context.newPage(); if (host.bindPage) host.bindPage(p); await p.goto("http://tauri.localhost/"); } };
}

/* ===== build ===== */

// Builds the Preview exe from the target's own Rust (release, --no-bundle, feature "preview" +
// tauri.preview.conf.json) in .tools/preview/target, copies it to .tools/preview/bin and records its backend.
function build(o, target) {
  const cli = [path.join(REPO, "app", "node_modules", "@tauri-apps", "cli", "tauri.js"), path.join(target.root, "app", "node_modules", "@tauri-apps", "cli", "tauri.js")].find(fs.existsSync);
  if (!cli) fail("no @tauri-apps/cli: run npm install in app/ once");
  const conf = path.join(target.root, "app", "src-tauri", "tauri.preview.conf.json");
  if (!fs.existsSync(conf)) fail(`${target.root} has no tauri.preview.conf.json: that tree predates Halation Preview`);
  const desc = target.describe(), targetDir = path.join(STATE, "target");
  log(`building Halation Preview from ${desc.label} ${desc.commit}${desc.backend ? "" : " (uncommitted Rust)"}`);
  const r = cp.spawnSync(process.execPath, [cli, "build", "--no-bundle", "--features", "preview", "--config", conf], {
    cwd: path.join(target.root, "app"), stdio: "inherit", env: { ...process.env, CARGO_TARGET_DIR: targetDir }
  });
  if (r.status !== 0) fail("the build failed");
  const out = ["halation-preview.exe", "halation.exe"].map(n => path.join(targetDir, "release", n)).find(fs.existsSync);
  if (!out) fail(`no exe in ${path.join(targetDir, "release")}`);
  fs.mkdirSync(BIN, { recursive: true });
  try { fs.copyFileSync(out, EXE); } catch (e) { fail(`could not replace ${EXE} (${e.code}): close Halation Preview and build again`); }
  const info = { commit: desc.commit, label: desc.label, backend: desc.backend, builtAt: new Date().toISOString(), exe: EXE };
  fs.writeFileSync(BUILD_INFO, JSON.stringify(info, null, 2));
  log(`Halation Preview: ${EXE}\n  backend ${desc.backend || "uncommitted"} (${desc.commit})`);
}

/* ===== main ===== */

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const kind = targetKind(o);
  const target = kind === "path" ? localTarget(o.target) : branchTarget(o);
  if (kind === "branch") {
    log(`fetching origin/${target.branch}`);
    target.checkout(await target.fetch());
  }
  if (o.build) return build(o, target);
  if (process.platform !== "win32" && !o.chromium && !process.env.HALATION_PREVIEW_ALLOW_ANY_OS) fail("the native preview is Windows only; use --chromium");
  const mode = o.chromium ? "chromium" : "native";
  const ctx = o.chromium ? await chromiumContext(o, target) : await nativeContext(o);
  const session = await startSession(ctx.context, target, mode);
  if (mode === "native") keepConnected(o, ctx, session);
  if (ctx.open) await ctx.open(); else await session.reload("start");
  if (kind === "path") watchLocal(target, session); else watchBranch(target, session, o.interval);
}

if (require.main === module) main().catch(e => fail(e.stack || e.message));
module.exports = { resolveAsset, rustWarnings, PAGE_SCRIPT, targetKind, parseArgs, startSession, localTarget, branchTarget, TYPES };
