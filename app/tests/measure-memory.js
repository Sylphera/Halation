// Memory and CPU of the whole app (every process of the browser: main, renderer, GPU, utilities), as Windows' Task
// Manager adds them up for WebView2: PSS summed from /proc. A session as a user has it: Home at start, every tool
// opened once, a 1080p video playing in Frame Capture and open in AI Interpolate, a song in the Audio Visualizer,
// then back to Home (the tools left behind, hidden) and 40 s later (the ones with work open resting: shell.js unloadIdle, as in the app). CPU: the processes' time over 5 s at Home.
// Usage: node app/tests/measure-memory.js   (headless Chromium: relative figures, before / after a change)
const fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const { sleep, until, serve, openApp, LAUNCH, chromium } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

const FX = makeFixtures(), TOOLS = toolOptions(FX);
const ffmpeg = execSync("command -v ffmpeg").toString().trim();
const host = createHost(fs.mkdtempSync(path.join(FX.TMP, "mem-")), { ...TOOLS, tools: { ...TOOLS.tools, systemFfmpeg: ffmpeg } });
fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en" } }));
const VIDEO = path.join(FX.TMP, "clip 1080p.mp4");
execSync(`ffmpeg -v error -f lavfi -i testsrc2=size=1920x1080:rate=30:d=20 -f lavfi -i "sine=f=330:d=20" -c:v libx264 -preset ultrafast -pix_fmt yuv420p -c:a aac -shortest -y "${VIDEO}"`);
const SONG = path.join(FX.TMP, "song.mp3");
execSync(`ffmpeg -v error -f lavfi -i "sine=f=220:d=30" -y "${SONG}"`);

// the browser's processes: every descendant of this Node process
function procs() {
  const kids = {};
  for (const d of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try { const st = fs.readFileSync(`/proc/${d}/stat`, "utf8"), ppid = +st.slice(st.lastIndexOf(")") + 2).split(" ")[1]; (kids[ppid] = kids[ppid] || []).push(+d); } catch (e) { /* gone */ }
  }
  const out = [], walk = p => { for (const k of kids[p] || []) { out.push(k); walk(k); } };
  walk(process.pid);
  return out.map(pid => {
    try {
      const cmd = fs.readFileSync(`/proc/${pid}/cmdline`, "utf8");
      if (!/chrom/i.test(cmd)) return null;
      const pss = +(/^Pss:\s+(\d+)/m.exec(fs.readFileSync(`/proc/${pid}/smaps_rollup`, "utf8")) || [])[1] || 0;
      const st = fs.readFileSync(`/proc/${pid}/stat`, "utf8").slice(fs.readFileSync(`/proc/${pid}/stat`, "utf8").lastIndexOf(")") + 2).split(" ");
      const type = (/--type=([\w-]+)/.exec(cmd) || [])[1] || "browser", util = (/--utility-sub-type=([\w.]+)/.exec(cmd) || [])[1];
      return { pid, type: util ? "utility" : type, pss, cpu: +st[11] + +st[12] };
    } catch (e) { return null; }
  }).filter(Boolean);
}
const MB = kb => Math.round(kb / 1024);
function memory(label) {
  const p = procs(), by = {};
  for (const x of p) by[x.type] = (by[x.type] || 0) + x.pss;
  const total = p.reduce((a, x) => a + x.pss, 0);
  console.log(`${label.padEnd(34)} total ${String(MB(total)).padStart(5)} MB  · ` + Object.entries(by).map(([k, v]) => `${k} ${MB(v)}`).join(" · "));
  return total;
}
async function cpu(label, ms = 5000) {
  const hz = +execSync("getconf CLK_TCK").toString().trim();
  const a = procs(), t0 = Date.now(); await sleep(ms); const b = procs(), dt = (Date.now() - t0) / 1000;
  const sum = l => l.reduce((s, x) => s + x.cpu, 0);
  const pct = (sum(b) - sum(a.filter(x => b.some(y => y.pid === x.pid)))) / hz / dt * 100;
  console.log(`${label.padEnd(34)} CPU ${pct.toFixed(1)} % of one core`);
  return pct;
}

(async () => {
  const server = serve(), browser = await chromium.launch(LAUNCH);
  const app = await openApp(browser, server, host, { width: 1480, height: 920, restMs: 30000, unloadMs: 300000 });
  const { page } = app;
  const frame = n => page.frames().find(f => new RegExp(n + "\\.html").test(f.url()));
  await sleep(3000);
  memory("Home at start");
  await cpu("Home at start");
  for (const t of ["visualizer", "grade", "downloader", "upscale",  "framegrab", "interp", "removebg"]) { await app.tab(t); await app.appReady(t); }
  // a song in the Visualizer, playing
  await app.tab("visualizer");
  await app.vis.locator("#audIn").setInputFiles(SONG).catch(() => {});
  await until(() => frame("visualizer").evaluate(() => !!document.querySelector("#play")), 15000);
  await frame("visualizer").evaluate(() => document.querySelector("#play").click()).catch(() => {});
  // the video in Frame Capture, playing
  await app.tab("framegrab");
  const fg = page.frameLocator("#v-framegrab");
  await fg.locator("#videoIn").setInputFiles(VIDEO);
  await until(async () => (await frame("framegrab").evaluate(() => window.__halApp.state())).settled, 60000);
  await fg.locator("#playBtn").click();
  await sleep(3000);
  memory("Frame Capture playing");
  // the same video in AI Interpolate
  await app.tab("interp");
  TOOLS.tools.pickVideo = VIDEO;
  await page.frameLocator("#v-interp").locator("#browseBtn").click();
  await until(async () => !!(await page.frameLocator("#v-interp").locator("#still").getAttribute("src")), 20000);
  await sleep(1500);
  memory("AI Interpolate with the video");
  await app.tab("home");
  await sleep(2000);
  memory("Home, every tool left behind");
  await cpu("Home, every tool left behind");
  await sleep(33000);
  memory("Home, 40 s later");
  await cpu("Home, 40 s later");
  await browser.close(); server.close();
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
