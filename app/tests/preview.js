// Halation Preview (scripts/halation-preview.cjs, docs/PREVIEW.md) without Windows: Chromium stands in for the
// WebView2 window (CDP, tauri.localhost resolved to a stale "embedded" frontend, host.js as Tauri), over throwaway git
// repos (origin, the launcher's checkout, a local worktree, a pusher). Checks the routing (worktree files, MIME, 404,
// nothing outside app/dist), the badge (branch + commit), reload on a local edit and on a pushed commit, the dirty
// worktree guard, the Rust fingerprint, a missing IPC command, the refusal of a non-Preview window and --chromium.
// No screenshots. Usage: node app/tests/preview.js
const fs = require("fs"), os = require("os"), path = require("path"), cp = require("child_process"), http = require("http");
const assert = require("assert/strict");
const { chromium, sleep, until } = require("./common");
const { createHost, MOCK } = require("./host");

const SRC = path.resolve(__dirname, "..", "..");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "hal-preview-"));
const CHROME = process.env.CHROME || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const sh = (cwd, ...args) => cp.execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const results = [];
const check = (name, ok, detail = "") => { results.push([name, ok]); console.log(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " — " + detail : ""}`); };

/* ===== repos ===== */

// A small copy of the repo: app/dist, host.js, the launcher, the Preview config and a Rust file.
function seed(dir) {
  fs.mkdirSync(dir, { recursive: true });
  for (const rel of ["app/dist", "app/tests/host.js", "app/scripts/halation-preview.cjs", "app/src-tauri/tauri.preview.conf.json", "app/src-tauri/src/main.rs", ".gitignore"])
    fs.cpSync(path.join(SRC, rel), path.join(dir, rel), { recursive: true });
}
function repos() {
  const origin = path.join(TMP, "origin.git"), pusher = path.join(TMP, "pusher"), repo = path.join(TMP, "repo"), local = path.join(TMP, "local");
  cp.execFileSync("git", ["init", "--quiet", "--bare", "-b", "main", origin]);
  seed(pusher);
  sh(TMP, "init", "--quiet", "-b", "main", pusher);
  for (const d of [pusher]) { sh(d, "config", "user.email", "t@t"); sh(d, "config", "user.name", "t"); }
  sh(pusher, "add", "-A"); sh(pusher, "commit", "--quiet", "-m", "base");
  sh(pusher, "remote", "add", "origin", origin); sh(pusher, "push", "--quiet", "origin", "main");
  sh(pusher, "checkout", "--quiet", "-b", "feat"); sh(pusher, "push", "--quiet", "origin", "feat");
  cp.execFileSync("git", ["clone", "--quiet", origin, repo]);
  cp.execFileSync("git", ["clone", "--quiet", "-b", "feat", origin, local]);
  for (const d of [repo, local]) { sh(d, "config", "user.email", "t@t"); sh(d, "config", "user.name", "t"); }
  return { origin, pusher, repo, local };
}

/* ===== the stand-in native window ===== */

// "Embedded" frontend: what the exe would serve without the launcher. Any file it serves is marked, so a fallback
// to it shows.
function embeddedServer() {
  const srv = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": req.url.endsWith(".html") || req.url === "/" ? "text/html" : "text/plain" });
    res.end(req.url === "/" || req.url.endsWith(".html") ? "<!doctype html><title>embedded</title><body data-embedded=1>EMBEDDED</body>" : "/* EMBEDDED */");
  }).listen(0);
  return srv;
}

async function standIn(port, { previewPaths = true } = {}) {
  const emb = embeddedServer();
  const browser = await chromium.launch({ executablePath: CHROME, args: [`--remote-debugging-port=${port}`, `--host-resolver-rules=MAP tauri.localhost 127.0.0.1:${emb.address().port}`, "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
  const data = path.join(TMP, "host-" + port);
  const host = createHost(data);
  const base = previewPaths ? "C:\\Users\\j\\AppData\\Local\\com.halation.preview\\profiles\\default\\Documents\\Halation" : "C:\\Users\\j\\Documents\\Halation";
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // Tauri's own behaviour for what the test needs: "paths" names the Preview's folders, an unknown command rejects
  await context.exposeBinding("__host", async (_s, cmd, args, b64, headers) => {
    if (cmd === "paths") return { base };
    if (cmd === "definitely_not_a_command") return { __error: `Command ${cmd} not found` };
    return host.call(cmd, args, b64, headers);
  });
  await context.addInitScript(MOCK);
  await context.addInitScript(() => { window.__halSkipWelcome = true; });
  const page = await context.newPage();
  await page.goto("http://tauri.localhost/");
  return { browser, page, close: async () => { await browser.close(); emb.close(); } };
}

/* ===== launcher ===== */

function launch(repo, args, env = {}) {
  const child = cp.spawn(process.execPath, [path.join(repo, "app/scripts/halation-preview.cjs"), ...args], {
    env: { ...process.env, HALATION_PREVIEW_ALLOW_ANY_OS: "1", ...env }, stdio: ["ignore", "pipe", "pipe"]
  });
  child.out = "";
  child.stdout.on("data", d => { child.out += d; });
  child.stderr.on("data", d => { child.out += d; });
  child.done = new Promise(r => child.on("exit", code => r(code)));
  return child;
}
// the badge's rendered text (empty when something hides it; its shadow root is open for this)
const badgeText = page => page.evaluate(() => { const h = document.querySelector("halation-preview-badge"); return h && h.shadowRoot ? h.shadowRoot.querySelector(".b").innerText : ""; }).catch(() => "");
const loadId = page => page.evaluate(() => performance.timeOrigin).catch(() => 0);

async function main() {
  const { targetKind } = require("../scripts/halation-preview.cjs");
  check("a branch with / is a branch, not a path", targetKind({ target: "claude/halation-preview-x" }) === "branch" && targetKind({ target: "." }) === "path" && targetKind({ target: ".\\wt" }) === "path");
  const { pusher, repo, local } = repos();
  const fetchIn = (page, p) => page.evaluate(async p => { const r = await fetch(p, { cache: "no-store" }); return { status: r.status, type: r.headers.get("content-type"), body: (await r.text()).slice(0, 200) }; }, p);

  /* ===== local worktree ===== */
  const port = 9411;
  let w = await standIn(port);
  check("embedded frontend before the launcher", (await w.page.textContent("body")).includes("EMBEDDED"));
  let L = launch(repo, [local, "--port", String(port)]);
  const booted = await until(async () => (await w.page.evaluate(() => !!document.querySelector("#v-home") && !document.body.classList.contains("booting")).catch(() => false)), 30000);
  check("loads app/dist of the selected worktree", !!booted, booted ? "" : L.out);
  const sha = sh(local, "rev-parse", "--short", "HEAD");
  let text = "";
  await until(async () => (text = await badgeText(w.page)).includes(sha), 8000);
  check("badge: PREVIEW + branch + commit", /PREVIEW/.test(text) && text.includes("feat @ local") && text.includes(sha), JSON.stringify(text));
  check("Rust: no build info is said", /no build info/.test(text));
  const js = await fetchIn(w.page, "/shell.js"), css = await fetchIn(w.page, "/tokens.css"), font = await fetchIn(w.page, "/" + path.relative(path.join(local, "app/dist"), cp.execSync(`find ${path.join(local, "app/dist")} -name '*.woff2' | head -1`).toString().trim()).split(path.sep).join("/"));
  check("MIME: js / css / woff2", /javascript/.test(js.type) && /text\/css/.test(css.type) && font.type === "font/woff2", `${js.type} ${css.type} ${font.type}`);
  check("worktree files, not embedded", !js.body.includes("EMBEDDED") && js.body === fs.readFileSync(path.join(local, "app/dist/shell.js"), "utf8").slice(0, 200));
  const miss = await fetchIn(w.page, "/no-such-file.js");
  check("missing asset → 404, no fallback", miss.status === 404 && !miss.body.includes("EMBEDDED"), `${miss.status} ${miss.body}`);
  for (const p of ["/..%2f..%2fapp/src-tauri/src/main.rs", "/%2e%2e/%2e%2e/.gitignore", "/locales/..%2f..%2f..%2f.gitignore"]) {
    const r = await fetchIn(w.page, p);
    check(`outside app/dist blocked ${p}`, r.status === 403 || r.status === 404, String(r.status));
  }
  await until(async () => /404 \/no-such-file\.js/.test(await badgeText(w.page)), 5000);
  check("badge lists the 404", /404 \/no-such-file\.js/.test(await badgeText(w.page)));
  // a missing IPC command still fails, and is made visible
  const err = await w.page.evaluate(() => window.__TAURI__.core.invoke("definitely_not_a_command").then(() => "resolved", e => String(e)));
  check("missing IPC command rejects", /not found/.test(err), err);
  await until(async () => /no command definitely_not_a_command/.test(await badgeText(w.page)), 3000);
  check("badge shows the missing command", /no command definitely_not_a_command/.test(await badgeText(w.page)));
  // an existing command still goes through
  const st = await w.page.evaluate(() => window.__TAURI__.core.invoke("app_info").then(v => typeof v, e => "error " + e));
  check("existing commands work from the injected frontend", st === "object", st);

  // a visible edit reloads
  let id = await loadId(w.page), t0 = Date.now();
  fs.appendFileSync(path.join(local, "app/dist/tokens.css"), "\n:root { --preview-test: 1; }\n");
  const reloaded = await until(async () => (await loadId(w.page)) !== id, 10000, 50);
  const ms = Date.now() - t0;
  await until(() => w.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--preview-test").trim() === "1").catch(() => false), 10000);
  check("edit in app/dist → reload with the change", reloaded && await w.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--preview-test").trim() === "1"), `${ms} ms`);
  await until(async () => /\+changes/.test(await badgeText(w.page)), 4000);
  check("badge marks uncommitted frontend", /\+changes/.test(await badgeText(w.page)));

  // the fingerprint: the sidecar of the exe against the worktree's app/src-tauri
  const bin = path.join(repo, ".tools/preview/bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "halation-preview.build.json"), JSON.stringify({ commit: sha, backend: sh(local, "rev-parse", "HEAD:app/src-tauri") }));
  L.kill(); await L.done;
  L = launch(repo, [local, "--port", String(port)]);
  await until(async () => (await badgeText(w.page)).includes(sha) && !/no build info/.test(await badgeText(w.page)), 15000);
  check("Rust matches the exe: no warning", !/Rust|rebuild/.test(await badgeText(w.page)), await badgeText(w.page));
  fs.appendFileSync(path.join(local, "app/src-tauri/src/main.rs"), "\n// change\n");
  await until(async () => /uncommitted changes in app\/src-tauri/.test(await badgeText(w.page)), 8000);
  check("Rust edit → rebuild warning", /uncommitted changes in app\/src-tauri/.test(await badgeText(w.page)), await badgeText(w.page));
  sh(local, "commit", "--quiet", "-am", "rust");
  await until(async () => /Rust changed since the exe/.test(await badgeText(w.page)), 8000);
  check("Rust commit → 'Rust changed' warning", /Rust changed since the exe/.test(await badgeText(w.page)), await badgeText(w.page));
  L.kill(); await L.done;
  await until(async () => /launcher stopped/.test(await badgeText(w.page)), 6000);
  check("launcher stopped is shown", /launcher stopped/.test(await badgeText(w.page)));

  /* ===== branch ===== */
  fs.writeFileSync(path.join(local, "app/dist/only-local.js"), "// only in the local worktree\n");
  L = launch(repo, ["feat", "--port", String(port), "--interval", "1"]);
  const fsha = sh(pusher, "rev-parse", "--short", "HEAD");
  await until(async () => (await badgeText(w.page)).includes("origin/feat") && (await badgeText(w.page)).includes(fsha), 20000);
  check("branch: badge origin/feat + commit", (await badgeText(w.page)).includes(`origin/feat · ${fsha}`), await badgeText(w.page) + L.out);
  const wt = path.join(repo, ".tools/preview/default/worktree");
  check("branch: dedicated worktree", fs.existsSync(path.join(wt, "app/dist/index.html")) && sh(repo, "status", "--porcelain") === "");
  const other = await fetchIn(w.page, "/only-local.js");
  check("switching target does not mix files", other.status === 404, String(other.status));
  check("branch: no CSS edit of the local worktree", !(await w.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--preview-test").trim())));
  // a push → reload with it
  id = await loadId(w.page);
  fs.appendFileSync(path.join(pusher, "app/dist/tokens.css"), "\n:root { --preview-push: 2; }\n");
  sh(pusher, "commit", "--quiet", "-am", "push 1"); t0 = Date.now(); sh(pusher, "push", "--quiet", "origin", "feat");
  const nsha = sh(pusher, "rev-parse", "--short", "HEAD");
  const got = await until(async () => (await loadId(w.page)) !== id && await w.page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--preview-push").trim() === "2").catch(() => false), 20000, 50);
  check("pushed commit → worktree updated and reloaded", !!got, `${Date.now() - t0} ms`);
  await until(async () => (await badgeText(w.page)).includes(nsha), 5000);
  check("badge follows the new commit", (await badgeText(w.page)).includes(nsha));
  // a worktree with changes is never reset
  fs.appendFileSync(path.join(wt, "app/dist/tokens.css"), "/* user edit */\n");
  fs.appendFileSync(path.join(pusher, "app/dist/tokens.css"), "\n/* push 2 */\n");
  sh(pusher, "commit", "--quiet", "-am", "push 2"); sh(pusher, "push", "--quiet", "origin", "feat");
  await until(async () => /worktree has changes/.test(await badgeText(w.page)), 10000);
  check("dirty preview worktree: not updated, said", /worktree has changes/.test(await badgeText(w.page)) && fs.readFileSync(path.join(wt, "app/dist/tokens.css"), "utf8").includes("user edit") && sh(wt, "rev-parse", "--short", "HEAD") === nsha);
  check("main untouched", sh(repo, "rev-parse", "main") === sh(pusher, "rev-parse", "main"));
  L.kill(); await L.done;
  await w.close();

  /* ===== not a Preview window ===== */
  w = await standIn(port, { previewPaths: false });
  L = launch(repo, [local, "--port", String(port)]);
  const code = await L.done;
  check("refuses a window that is not Halation Preview", code !== 0 && /not Halation Preview/.test(L.out) && (await w.page.textContent("body")).includes("EMBEDDED"), L.out.trim().split("\n").pop());
  await w.close();

  /* ===== --chromium ===== */
  const cport = 9412;
  L = launch(repo, [local, "--chromium", "--port", String(cport)], { CHROME });
  let cb = null;
  await until(async () => { try { cb = await chromium.connectOverCDP(`http://127.0.0.1:${cport}`); return true; } catch (e) { return false; } }, 20000, 300);
  const cpage = cb && await until(() => cb.contexts().flatMap(c => c.pages()).find(p => p.url().startsWith("http://tauri.localhost")), 20000);
  const cok = cpage && await until(() => cpage.evaluate(() => !!document.querySelector("#v-home") && !document.body.classList.contains("booting")).catch(() => false), 30000);
  check("--chromium: app boots on host.js", !!cok, L.out);
  if (cpage) {
    await until(async () => /chromium \+ host\.js/.test(await badgeText(cpage)), 5000);
    check("--chromium: badge", /PREVIEW/.test(await badgeText(cpage)) && /chromium \+ host\.js/.test(await badgeText(cpage)), JSON.stringify(await badgeText(cpage)));
    const cid = await loadId(cpage);
    fs.appendFileSync(path.join(local, "app/dist/tokens.css"), "\n/* chromium edit */\n");
    check("--chromium: edit → reload", !!await until(async () => (await loadId(cpage)) !== cid, 10000, 50));
  }
  L.kill(); await L.done;
  if (cb) await cb.close().catch(() => {});

  const failed = results.filter(r => !r[1]);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(failed.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
