// Baseline for refactors: everything a user can see or export, captured before a change and compared after it.
// Usage: node app/tests/baseline.js capture <dir>
//        node app/tests/baseline.js compare <before> <after>
// capture: screenshots of every screen of the scan tour (tests/scan.js) in English and Spanish, and 3 s exports
//          of every kind (single video, layers in ProRes, layers in WebM, a Grade image).
// compare: screenshots pixel by pixel, exports with ffprobe and frame by frame (limits below, docs/ARCHITECTURE.md).
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { sleep, until, serve, launch, openApp } = require("./common");
const { createHost } = require("./host");
const { tour, newHost, fx, FX } = require("./scan");

// A screenshot matches when at most SHOT_AREA of its pixels differ by more than SHOT_LEVEL (0–255, any channel).
// Two captures of the same build differ by at most 0.14 % of pixels (Library dates, live progress): limit ≈ 3×.
const SHOT_LEVEL = 24, SHOT_AREA = 0.004;
// Exports: same streams, and every decoded frame within FRAME_MAX levels of the baseline.
const FRAME_MAX = 0;

const args = process.argv.slice(2), only = (args.find(a => a.startsWith("--only=")) || "").slice(7);   // --only=shots|exports
const [mode, A, B] = args.filter(a => !a.startsWith("--"));
if (!["capture", "compare"].includes(mode) || !A || (mode === "compare" && !B)) { console.error("Usage: baseline.js capture <dir> | compare <before> <after>"); process.exit(2); }
let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const ffmpeg = execFileSync("sh", ["-c", "command -v ffmpeg"]).toString().trim();

async function capture(dir) {
  fs.mkdirSync(path.join(dir, "shots"), { recursive: true }); fs.mkdirSync(path.join(dir, "exports"), { recursive: true });
  const server = serve(), browser = await launch();
  for (const lang of only === "exports" ? [] : ["en", "es"]) {
    const { host } = newHost(lang);
    const app = await openApp(browser, server, host, { width: 1440, height: 900 });
    let n = 0;
    await tour(app, async label => {
      await app.page.mouse.move(700, 450); await sleep(350);
      await app.page.screenshot({ path: path.join(dir, "shots", `${lang}-${label}.png`) }); n++;
    });
    console.log(`     ${lang}: ${n} screenshots`);
    await app.page.close();
  }
  if (only === "shots") { await browser.close(); server.close(); return; }
  // exports
  const host = createHost(fs.mkdtempSync(path.join(FX.TMP, "exp-")), { tools: { systemFfmpeg: ffmpeg } });
  fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en" } }));
  const app = await openApp(browser, server, host);
  const { vis, grade, tab, appReady } = app, V = () => app.vFrame();
  await tab("visualizer"); await appReady("visualizer");
  await app.cover(fx("sky.png"));
  await vis.locator("#audIn").setInputFiles(fx("song one.wav"));
  await until(async () => /song one\.wav · 0:03/.test(await vis.locator("#audName").textContent()), 15000);
  await V().evaluate(() => {
    const set = (id, v) => { const el = document.getElementById("f-" + id); if (el.type === "checkbox") { if (el.checked !== v) el.click(); } else { el.value = v; el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input")); } };
    set("format", "1280x720"); set("fps", "30"); set("glow", 30); set("textOn", true); set("logoOn", true); set("grain", 8);
    const el = document.getElementById("f-title"); el.value = "Baseline"; el.dispatchEvent(new Event("input"));
  });
  await sleep(800);
  const dialog = async (mode, fill) => {
    await vis.locator("#exportBtn").click(); await until(() => vis.locator("#xDialog").isVisible());
    await vis.locator(`#xMode [data-mode="${mode}"]`).click();
    if (fill) await fill();
    await vis.locator("#xGo").click();
  };
  const videos = () => fs.readdirSync(path.join(host.base, "Exports", "Videos"));
  await dialog("single");
  await until(async () => /saved/i.test(await vis.locator("#status").textContent()) && videos().some(f => /\.(mp4|webm)$/.test(f)), 300000, 300);
  const single = videos().find(f => /\.(mp4|webm)$/.test(f));
  fs.copyFileSync(path.join(host.base, "Exports", "Videos", single), path.join(dir, "exports", "single" + path.extname(single)));
  for (const [name, format, finish] of [["prores", "prores4444", "overlay"], ["webm", "webm", "baked"]]) {
    await dialog("layers", async () => {
      await vis.locator(`input[name="xFinish"][value="${finish}"]`).check();
      for (const id of ["#xWbg", "#xWcover", "#xWtext", "#xAudio", "#xEnv"]) await vis.locator(id).check();
      if (finish === "overlay") await vis.locator("#xWfinish").check();
      await vis.locator("#xFormat").selectOption(format);
    });
    await until(async () => /files saved/.test(await vis.locator("#status").textContent()) && (await V().evaluate(() => window.__halLastLayers && window.__halLastLayers.dir)), 600000, 500);
    const d = await V().evaluate(() => window.__halLastLayers.dir);
    await V().evaluate(() => { window.__halLastLayers = null; });
    fs.cpSync(d, path.join(dir, "exports", name), { recursive: true });
  }
  await tab("grade"); await appReady("grade");
  await grade.locator("#imgIn").setInputFiles(fx("cover.png"));
  await until(async () => /cover\.png/.test(await grade.locator("#imgName").textContent()));
  await grade.locator('.tile[data-look="hielo"]').click();
  await grade.locator("#outSize").selectOption("1080"); await grade.locator("#outFmt").selectOption("png");
  await grade.locator("#exportBtn").click();
  const cov = path.join(host.base, "Exports", "Covers", "cover.png");
  await until(() => fs.existsSync(cov) && fs.statSync(cov).size > 0, 60000);
  await sleep(500);
  fs.copyFileSync(cov, path.join(dir, "exports", "grade.png"));
  await browser.close(); server.close();
  console.log(`     exports: ${fs.readdirSync(path.join(dir, "exports")).join(", ")}`);
}

const rgb = f => execFileSync(ffmpeg, ["-v", "error", "-i", f, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], { maxBuffer: 1 << 30 });
const rgbDec = f => execFileSync(ffmpeg, ["-v", "error", ...(/\.webm$/.test(f) ? ["-c:v", "libvpx-vp9"] : []), "-i", f, "-f", "rawvideo", "-pix_fmt", /\.(webm|mov)$/.test(f) ? "rgba" : "rgb24", "-"], { maxBuffer: 1 << 30 });
const probe = f => JSON.parse(execFileSync("ffprobe", ["-v", "error", "-count_frames", "-show_entries", "stream=codec_name,codec_type,pix_fmt,width,height,r_frame_rate,nb_read_frames,sample_rate,channels:format=duration", "-of", "json", f]).toString());
function diffBuf(a, b) {
  if (a.length !== b.length) return { max: 255, area: 1, sizes: [a.length, b.length] };
  let max = 0, bad = 0;
  for (let i = 0; i < a.length; i++) { const d = Math.abs(a[i] - b[i]); if (d > max) max = d; if (d > SHOT_LEVEL) bad++; }
  return { max, area: bad / a.length };
}
function compare(before, after) {
  const shots = only === "exports" ? [] : fs.readdirSync(path.join(before, "shots")).sort();
  const got = new Set(fs.existsSync(path.join(after, "shots")) ? fs.readdirSync(path.join(after, "shots")) : []);
  let worst = 0;
  for (const f of shots) {
    if (!got.has(f)) { ok(false, `screenshot ${f} missing`); continue; }
    const d = diffBuf(rgb(path.join(before, "shots", f)), rgb(path.join(after, "shots", f)));
    worst = Math.max(worst, d.area);
    if (d.area > SHOT_AREA) ok(false, `screenshot ${f}: ${(d.area * 100).toFixed(3)} % of pixels differ by more than ${SHOT_LEVEL} (max ${d.max})`);
  }
  ok(true, `${shots.length} screenshots compared; worst ${(worst * 100).toFixed(3)} % of pixels over ${SHOT_LEVEL} levels (limit ${(SHOT_AREA * 100).toFixed(1)} %)`);
  if (only === "shots") return;
  const files = [];
  const walk = (d, rel = "") => { for (const f of fs.readdirSync(path.join(d, rel)).sort()) { const r = path.join(rel, f); if (fs.statSync(path.join(d, r)).isDirectory()) walk(d, r); else files.push(r); } };
  walk(path.join(before, "exports"));
  for (const r of files) {
    const fa = path.join(before, "exports", r), fb = path.join(after, "exports", r);
    if (!fs.existsSync(fb)) { ok(false, `export ${r} missing`); continue; }
    if (/\.wav$/.test(r)) { ok(fs.readFileSync(fa).equals(fs.readFileSync(fb)), `export ${r}: same samples`); continue; }
    if (/\.(txt|csv)$/.test(r)) { ok(fs.readFileSync(fa, "utf8") === fs.readFileSync(fb, "utf8"), `export ${r}: same text`); continue; }
    const pa = probe(fa), pb = probe(fb);
    const key = p => JSON.stringify(p.streams.map(s => [s.codec_type, s.codec_name, s.pix_fmt, s.width, s.height, s.r_frame_rate, s.nb_read_frames, s.sample_rate, s.channels]));
    const dur = p => +(p.format.duration || 0);  // images have none
    const sameStreams = key(pa) === key(pb) && Math.abs(dur(pa) - dur(pb)) < 0.001;
    let frames = "";
    if (/\.(mp4|webm|mov|png)$/.test(r)) {
      const d = diffBuf(rgbDec(fa), rgbDec(fb));
      frames = `, frames max diff ${d.max}`;
      ok(sameStreams && d.max <= FRAME_MAX, `export ${r}: ${key(pb)}${frames}`);
    } else ok(sameStreams, `export ${r}: ${key(pb)}`);
  }
}

(async () => {
  if (mode === "capture") await capture(path.resolve(A));
  else compare(path.resolve(A), path.resolve(B));
  console.log(failures ? `\n${failures} failed (baseline)` : "\nAll passed (baseline)");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
