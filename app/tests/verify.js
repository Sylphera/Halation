// Every check of the repository in one run: cargo check → clippy → cargo test beside the Node test files, which run
// several at a time; the files that measure timing (animations, long tasks, frames per second) run afterwards, one
// by one, with nothing else running. One static server and one set of fixtures serve the whole run, and one browser per
// parallel slot (test files running together in one browser share its GPU process and slow each other's WebGL).
// A check that passed is not run again while nothing it reads has changed (app/dist, app/tests, app/src-tauri, $SHOTS).
// Usage: node app/tests/verify.js [--no-cargo] [--force] [--jobs N] [file.js …]   (npm test = --no-cargo, npm run verify = all)
const { spawn, execSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const APP = path.join(__dirname, ".."), CRATE = path.join(APP, "src-tauri");
// The same files, in the same order, as the serial chain (npm run test:serial)
const FILES = ["colors.js", "run.js --lang en", "run.js --lang es", "scan.js", "motion.js", "segmented.js", "modules.js", "home.js", "pages.js", "alpha.js", "layers.js",
  "editor.js", "slider-defaults.js", "slider-stems.js", "focus-defaults.js", "brand-assets.js", "spotify.js", "cutout.js", "cutout-tools.js", "framegrab.js", "framegrab-perf.js", "sendto.js", "upscale.js", "interp.js", "removebg.js", "dock.js"];
// Files whose limits are timings: the motion trace and Frame Capture load/scrub times
const SOLO = new Set(["motion.js", "framegrab-perf.js"]);

const argv = process.argv.slice(2), flag = f => { const i = argv.indexOf(f); if (i >= 0) argv.splice(i, 1); return i >= 0; };
const NO_CARGO = flag("--no-cargo"), FORCE = flag("--force");
// One core is left free: with every core busy, SwiftShader slows the Visualizer exports past their time limits
const ji = argv.indexOf("--jobs"), JOBS = ji >= 0 ? +argv.splice(ji, 2)[1] : Math.max(1, os.cpus().length - 1);
const ONLY = argv.length ? FILES.filter(f => argv.includes(f) || argv.includes(f.split(" ")[0])) : FILES;

// What a check reads: tracked and untracked (not ignored) files under the given folders, by content
function inputsHash(dirs, extra = "") {
  const h = crypto.createHash("sha1").update(extra);
  const files = execSync(`git ls-files -co --exclude-standard -- ${dirs.join(" ")}`, { cwd: APP }).toString().split("\n").filter(Boolean).sort();
  for (const f of files) { const p = path.join(APP, f); if (fs.existsSync(p)) h.update(f).update(fs.readFileSync(p)); }
  return h.digest("hex");
}
const STAMP = path.join(APP, "node_modules", ".cache", "halation-verify.json");
const stamps = (() => { try { return JSON.parse(fs.readFileSync(STAMP, "utf8")); } catch (e) { return {}; } })();
const saveStamps = () => { fs.mkdirSync(path.dirname(STAMP), { recursive: true }); fs.writeFileSync(STAMP, JSON.stringify(stamps, null, 1)); };
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), "halation-shots");
const jsKey = () => inputsHash(["dist", "tests", "package.json"], SHOTS);
const cargoKey = () => inputsHash(["src-tauri"]);

const results = [];
let browsers = [];
// Runs a command, keeps its output and prints it in one block when it ends (parallel output stays readable)
function run(name, cmd, args, opts) {
  return new Promise(res => {
    const t0 = Date.now(), p = spawn(cmd, args, { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    p.stdout.on("data", d => { out += d; }); p.stderr.on("data", d => { out += d; });
    p.on("close", code => {
      const s = (Date.now() - t0) / 1000, oks = (out.match(/^OK /gm) || []).length, fails = (out.match(/^FAIL /gm) || []).length;
      console.log(`\n===== ${name}: ${code === 0 ? "passed" : "FAILED (exit " + code + ")"} in ${s.toFixed(1)} s =====\n${out.trimEnd()}`);
      results.push({ name, code, s, oks, fails });
      res(code === 0);
    });
  });
}

async function cargo(key) {
  if (!FORCE && stamps.cargo === key) { console.log("\n===== cargo: unchanged since it passed, skipped ====="); results.push({ name: "cargo", skipped: true }); return; }
  const steps = [["cargo check", ["check"]], ["cargo clippy", ["clippy", "--", "-D", "warnings"]], ["cargo test", ["test"]]];
  for (const [name, args] of steps) if (!await run(name, "cargo", args, { cwd: CRATE })) return;
  stamps.cargo = key; saveStamps();
}

async function node(files, jobs, key) {
  const queue = files.filter(f => {
    if (!FORCE && (stamps.js || {})[f] === key) { console.log(`\n===== ${f}: unchanged since it passed, skipped =====`); results.push({ name: f, skipped: true }); return false; }
    return true;
  });
  // longest first (as long as they took last time), so the long ones do not end the run alone
  const took = f => (stamps.took || {})[f] || Infinity;
  queue.sort((a, b) => took(b) - took(a));
  const worker = async slot => {
    for (let f; (f = queue.shift());) {
      const env = { ...process.env, HALATION_BROWSER: browsers[slot].wsEndpoint() };
      const t0 = Date.now(), passed = await run(f, process.execPath, ["tests/" + f.split(" ")[0], ...f.split(" ").slice(1)], { cwd: APP, env });
      stamps.took = { ...stamps.took, [f]: Date.now() - t0 };
      if (passed) stamps.js = { ...stamps.js, [f]: key };
      saveStamps();
    }
  };
  await Promise.all(Array.from({ length: jobs }, (_, i) => worker(i)));
}

(async () => {
  const T0 = Date.now();
  const key = jsKey(), ckey = NO_CARGO ? null : cargoKey();
  // Global setup: fixtures, the static server for dist/ and the browsers the test files connect to
  const { chromium, LAUNCH, serveDist } = require("./common");
  require("./fixtures").cachedFixtures();
  const server = serveDist();
  browsers = await Promise.all(Array.from({ length: JOBS }, () => chromium.launchServer(LAUNCH)));
  process.env.HALATION_PORT = String(server.address().port);

  const par = ONLY.filter(f => !SOLO.has(f)), solo = ONLY.filter(f => SOLO.has(f));
  await Promise.all([NO_CARGO ? null : cargo(ckey), node(par, JOBS, key)]);
  // the timing files: alone, one after another
  await node(solo, 1, key);
  await Promise.all(browsers.map(b => b.close())); server.close();

  const ran = results.filter(r => !r.skipped), bad = ran.filter(r => r.code !== 0);
  console.log("\n===== summary =====");
  for (const r of results) console.log(r.skipped ? `skip  ${r.name}` : `${r.code === 0 ? "ok  " : "FAIL"}  ${r.name.padEnd(18)} ${r.s.toFixed(1).padStart(6)} s  ${r.oks} OK${r.fails ? ", " + r.fails + " FAIL" : ""}`);
  console.log(`${ran.reduce((n, r) => n + r.oks, 0)} OK, ${ran.reduce((n, r) => n + r.fails, 0)} FAIL, ${results.filter(r => r.skipped).length} skipped, ${((Date.now() - T0) / 1000).toFixed(1)} s`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
