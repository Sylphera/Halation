// README screenshots: 1600×1000 window at 2× scale, with one credited photo per tool in docs/examples.
// Usage: SHOTS_SONG=<audio file> node app/tests/shots.js → docs/screenshots/*.jpg (12 screens). SHOTS_SONG is the song of
// Audio Visualizer and Vocal Remover (the README uses "Beyond" by Sylphera, kept out of the repo); without it a synthetic one.
// Background Remover uses Magic Wand (CUTOUT_DIR: the real SAM 2.1); Upscale uses fake-upscayl, so these images show the UI, not model quality.
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const assert = require("assert");
const { sleep, until, painted, serve, launch, openApp } = require("./common");
const { createHost } = require("./host");
const { toolOptions } = require("./fixtures");

const ONLY = process.env.SHOTS_ONLY && new Set(process.env.SHOTS_ONLY.split(","));
const SCREENS = ["home", "visualizer", "grade", "downloader", "convert", "stems", "upscale",  "framegrab", "interp", "removebg", "covertest", "library"];
if (ONLY) for (const name of ONLY) assert(SCREENS.includes(name), "Unknown screen: " + name);
const captured = new Set();
// Each screen's main panel, recorded in CSS pixels next to the captures so README cards crop exactly (docs/screenshots/panels.json)
const PANELS = { visualizer: "#stage", grade: "#stage", downloader: "#preview", convert: "#stage", stems: "section.mixer",
  upscale: "#imageView #stage", framegrab: "#previewWorkspace", interp: "section.monitor", removebg: "section.monitor", covertest: "section.monitor",
  library: "#v-library .libv-grid", home: "#v-home .hero" };
const panels = {};
const ROOT = path.join(__dirname, "..", "..");
const EX = name => path.join(ROOT, "docs", "examples", name + ".jpg");
const OUT = path.join(ROOT, "docs", "screenshots");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "halation-shots-"));
const REVIEW = process.env.SHOTS_REVIEW || fs.mkdtempSync(path.join(os.tmpdir(), "halation-readme-review-"));
fs.mkdirSync(REVIEW, { recursive: true });
const FIX = path.join(TMP, "fixtures"), MEDIA = path.join(TMP, "media");
fs.mkdirSync(FIX); fs.mkdirSync(MEDIA); fs.mkdirSync(OUT, { recursive: true });
const ff = a => execSync(`ffmpeg -hide_banner -loglevel error -y ${a}`);

// A 48 s synthetic track at 120 bpm: kick, bass, hats and a pad, with a breakdown in the middle
const kick = "0.85*sin(2*PI*(48+90*exp(-28*mod(t,0.5)))*t)*exp(-6*mod(t,0.5))";
const bass = "0.22*sin(2*PI*(if(lt(mod(t,4),2),55,49))*t)*(0.6+0.4*exp(-4*mod(t,0.5)))";
const hats = "0.10*(2*random(0)-1)*exp(-70*mod(t+0.25,0.5))";
const pad = "0.07*(sin(2*PI*220*t)+sin(2*PI*277.18*t)+sin(2*PI*329.63*t)+sin(2*PI*415.3*t))*(0.7+0.3*sin(2*PI*0.125*t))";
const drums = `(between(t,4,20)+between(t,28,44))`, fade = "min(1,t/2)*min(1,(48-t)/3)";
ff(`-f lavfi -i "aevalsrc='(${drums}*(${kick}+${hats})+between(t,2,46)*${bass}+${pad})*${fade}':s=48000:d=48" -ac 2 "${FIX}/Afterglow.wav"`);
// The song: Visualizer names it "Halation Sessions" (its title comes from the file name), Vocal Remover "Beyond"
const SONG = process.env.SHOTS_SONG;
for (const name of ["Halation Sessions", "Beyond"]) {
  if (SONG) ff(`-i "${SONG}" -vn -ac 2 -ar 44100 "${FIX}/${name}.wav"`); else fs.copyFileSync(path.join(FIX, "Afterglow.wav"), path.join(FIX, name + ".wav"));
}
// Upscale input: the escalator photo at 400 px wide, so the ×4 result is sharp enough to compare
ff(`-i "${EX("upscale")}" -vf scale=400:-2:flags=lanczos "${FIX}/Escalator.png"`);
// Video inputs: real night clips from Coverr in docs/examples (free licence, sources in docs/examples/CREDITS.md)
const CLIP = n => path.join(ROOT, "docs", "examples", `clip-${n}.mp4`);
fs.copyFileSync(CLIP(1), path.join(FIX, "Rain on chrome.mp4"));   // Frame Capture
fs.copyFileSync(CLIP(2), path.join(FIX, "After hours.mp4"));      // AI Interpolate
for (const f of ["song.opus", "song.mp3"]) ff(`-f lavfi -i "sine=f=220:d=3" -ac 2 "${MEDIA}/${f}"`);
ff(`-f lavfi -i testsrc2=size=320x180:d=2 -c:v libx264 -pix_fmt yuv420p "${MEDIA}/video.mp4"`);
for (const f of ["thumb.webp", "art.jpg", "spotify.jpg", "apple.jpg"]) fs.writeFileSync(path.join(MEDIA, f), "");   // web fixtures of the tests, unused here

const TOOLS = toolOptions({ TMP, MEDIA });
const platformFixtures = require("./covertest-fixtures")({ TMP, FIX, MEDIA }, TOOLS);
// Keep the existing synthetic artists/pages; use the credited example photos for their artwork.
const LIB = ["visualizer", "upscale", "convert", "downloader"];
let photo = 0;
for (const [url, data] of Object.entries(TOOLS.tools.web)) if (Buffer.isBuffer(data)) TOOLS.tools.web[url] = fs.readFileSync(EX(LIB[photo++ % 4]));
// A short documentation fixture runs the real preview UI/Jobs path without neural inference.
const spanModels = path.join(TMP, "span-models"), spanBin = path.join(TMP, "span-fixture.js");
fs.mkdirSync(spanModels);
for (const model of ["spanx2_ch52", "spanx4_ch52"]) for (const ext of ["param", "bin"]) fs.writeFileSync(path.join(spanModels, model + "." + ext), "fixture");
fs.writeFileSync(spanBin, `#!/usr/bin/env node
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const args=process.argv.slice(2),v=k=>args[args.indexOf(k)+1];
execFileSync('ffmpeg',['-v','error','-y','-i',path.join(v('-i'),'%08d.png'),'-vf','scale=iw*'+v('-s')+':ih*'+v('-s')+':flags=lanczos',path.join(v('-o'),'%08d.png')]);
for(const f of fs.readdirSync(v('-o')))process.stderr.write(f+' -> '+f+' done\\n');
`);
fs.chmodSync(spanBin, 0o755);
TOOLS.tools.span = { bin: spanBin, models: spanModels };
TOOLS.tools.systemFfmpeg = TOOLS.tools.ffmpegSource;
TOOLS.tools.systemFfprobe = process.env.HALATION_TEST_FFPROBE || execSync(process.platform === "win32" ? "where.exe ffprobe" : "command -v ffprobe").toString().trim().split(/\r?\n/)[0];
const cover = "https://i1.sndcdn.com/artworks-demo42-large.jpg";
Object.assign(TOOLS.tools.web, { [cover]: fs.readFileSync(EX("downloader")), [cover.replace("-large", "-original")]: fs.readFileSync(EX("downloader")) });
const INFO = path.join(TMP, "info.json");
fs.writeFileSync(INFO, JSON.stringify({
  id: "42", title: "Afterglow (Extended Mix)", uploader: "Halation Sessions", duration: 312, extractor: "soundcloud", extractor_key: "Soundcloud",
  webpage_url: "https://soundcloud.com/halation-sessions/afterglow-extended-mix", thumbnail: cover, thumbnails: [{ url: cover, width: 500, height: 500 }],
  formats: [{ format_id: "hls_mp3_128", acodec: "mp3", vcodec: "none", ext: "mp3" }, { format_id: "hls_opus_64", acodec: "opus", vcodec: "none", ext: "opus" }]
}));
TOOLS.tools.env = { ...TOOLS.tools.env, FAKE_YTDLP_INFO: INFO };

const host = createHost(TMP, { tools: TOOLS.tools });
const hostCall = host.call.bind(host);
host.call = async (...args) => {
  if (process.env.SHOTS_DEBUG) console.log("host " + args[0]);
  return hostCall(...args);
};
fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({
  settings: { language: "en", saveMode: "halation-folder", saveLocationChosen: true, artistName: "Nova Lune", links: { youtube: "https://www.youtube.com/@novalune", spotify: `https://open.spotify.com/artist/${platformFixtures.SP_ID}`, soundcloud: "https://soundcloud.com/novalune" } },
  library: { linked: [{ path: path.join(TMP, "Artwork"), name: "Release artwork" }], favorites: [path.join(host.base, "Library", "Covers", "Afterglow.jpg")], tags: { [path.join(host.base, "Library", "Covers", "Afterglow.jpg")]: ["release", "cover"] } },
  visualizer: { current: { artist: "artist", textOn: true, bgBlur: 8 }, fonts: [], updatedAt: 1 }
}));
fs.mkdirSync(path.join(host.base, "Library", "Covers"), { recursive: true });
fs.mkdirSync(path.join(host.base, "Presets", "Grade"), { recursive: true });
fs.copyFileSync(path.join(ROOT, "docs", "examples", "grade-look.json"), path.join(host.base, "Presets", "Grade", "Halation.json"));
fs.mkdirSync(path.join(TMP, "Artwork"));
for (let n = 1; n <= 4; n++) {
  fs.copyFileSync(EX(LIB[n - 1]), path.join(host.base, "Library", "Covers", ["Afterglow", "Nightfall", "Prism", "Low Tide"][n - 1] + ".jpg"));
  fs.copyFileSync(EX(LIB[n - 1]), path.join(TMP, "Artwork", ["Afterglow alternate", "Nightfall portrait", "Prism artwork", "Low Tide cover"][n - 1] + ".jpg"));
}
const server = serve();

(async () => {
  const browser = await launch();
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async opts => {
    const p = await newPage(opts);
    await p.addInitScript(() => {
      window.__halVisualTest = true;
      let seed = 1000;
      Math.random = () => { seed = (1664525 * seed + 1013904223) >>> 0; return seed / 4294967296; };
    });
    // All platform requests are answered by host fixtures; the browser itself stays local.
    await p.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, route => route.abort());
    return p;
  };
  const app = await openApp(browser, server, host, { width: 1600, height: 1000, scale: 2 });
  const { page, vis, grade, tab, appReady } = app;
  const up = page.frameLocator("#v-upscale"), dl = page.frameLocator("#v-downloader");
  const shot = async name => {
    await page.mouse.move(1590, 990); await sleep(500); assert(await painted(page), name + " did not paint");
    await page.evaluate(async () => { await window.__atmo?.review?.sceneAt?.({ time: 8, frame: 480 }); const tool = window.__atmo?.toolReview, live = await tool?.scene?.();
      // Replay at the live clock, past any field transition: an absolute clock would freeze the mix before it.
      if (live) await tool.sceneAt({ time: 8, at: live.at + 2000, wave: 0 }); });
    const file = path.join(REVIEW, name + ".jpg"), context = file + ".context.png";
    // Capture the native PNG once with the shared geometry/source contract, then encode JPEG at 90.
    // This also avoids a second compositor capture of the Background Remover's large alpha layers.
    // A toast left by an earlier export would cover the tool; keep it out of the capture.
    await page.evaluate(() => { const el = document.querySelector("#toast"); if (el) el.style.visibility = "hidden"; });
    const png = await page.screenshot({ path: context, type: "png", timeout: 120000 });
    await page.evaluate(() => { const el = document.querySelector("#toast"); if (el) el.style.visibility = ""; });
    const jpeg = await page.evaluate(async data => {
      const img = new Image(); img.src = "data:image/png;base64," + data; await img.decode();
      const canvas = document.createElement("canvas"); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      canvas.getContext("2d").drawImage(img, 0, 0);
      return canvas.toDataURL("image/jpeg", .9).split(",")[1];
    }, png.toString("base64"));
    fs.writeFileSync(file, Buffer.from(jpeg, "base64"));
    fs.copyFileSync(context + ".review.json", file + ".review.json");
    const frame = ["library", "home"].includes(name) ? page : page.frameLocator("#v-" + name);
    const box = await frame.locator(PANELS[name]).first().boundingBox();
    if (box) panels[name] = Object.fromEntries(Object.entries(box).map(([k, v]) => [k, Math.round(v)]));
    captured.add(name); console.log("saved " + name);
  };

  if (!ONLY || ONLY.has("visualizer")) {
  /* Visualizer: cover, song, background blur 8 px, paused a little before the middle */
  await tab("visualizer"); await appReady("visualizer");
  await vis.locator("#artIn").setInputFiles(EX("visualizer"));
  await vis.locator("#audIn").setInputFiles(path.join(FIX, "Halation Sessions.wav"));
  await until(async () => /Halation Sessions\.wav/.test(await vis.locator("#audName").textContent()), 20000);
  await sleep(1500);
  await vis.locator("#seek").evaluate(e => { e.value = String(+e.max * 0.42); e.dispatchEvent(new Event("input", { bubbles: true })); });
  await sleep(800);
  await vis.locator(".rack").evaluate(r => { r.scrollTop = 0; });
  await shot("visualizer");

  }
  if (!ONLY || ONLY.has("grade")) {
  /* Grade: the look docs/examples/grade-look.json (made in Grade by Java), applied from My looks */
  await tab("grade"); await appReady("grade");
  await grade.locator("#imgIn").setInputFiles(EX("grade"));
  await until(async () => /grade/.test(await grade.locator("#imgName").textContent()), 15000);
  await grade.locator("#thumbPct").evaluate(e => { e.value = "70"; e.dispatchEvent(new Event("input", { bubbles: true })); });
  const gf = page.frames().find(f => /grade\.html/.test(f.url()));
  await gf.evaluate(() => window.__halApp.applyPreset("Halation"));
  await grade.locator(".tab[data-tab=filters]").click();
  await grade.locator(".ltab[data-ltab=F]").click();
  // every filter thumbnail is drawn with the look on top before the capture
  await until(() => gf.evaluate(() => ![...document.querySelectorAll(".skel")].some(e => e.getClientRects().length)), 180000, 500);
  await sleep(2500);
  await shot("grade");

  }
  if (!ONLY || ONLY.has("upscale")) {
  /* Upscale: the escalator photo ×4 with the Photo model, the result next to the original */
  await page.evaluate(() => window.__hal.installTool("upscaler"));
  await tab("upscale"); await appReady("upscale");
  assert(await until(async () => (await up.locator("#engineBadge").textContent()) === "Ready", 30000), "Upscale engine was not ready");
  await up.locator("#imgIn").setInputFiles(path.join(FIX, "Escalator.png"));
  assert(await until(async () => (await up.locator("#inName").textContent()) === "Escalator.png", 15000), "Upscale did not load the photo");
  await up.locator('input[name=model][value=photo]').check(); await up.locator('[data-scale="4"]').click();
  await up.locator("#runBtn").click();
  assert(await until(async () => await up.locator("#result").isVisible(), 120000, 200), "Upscale did not finish: " + await up.locator("#status").textContent());
  await sleep(1500);
  await shot("upscale");

  }
  if (!ONLY || ONLY.has("downloader")) {
  /* Downloader: a link with its cover and one download done */
  await tab("downloader"); await appReady("downloader");
  if (await dl.locator("#installBtn").isVisible()) { await dl.locator("#installBtn").click(); await until(async () => await dl.locator("#engine").isHidden(), 60000); }
  await dl.locator("#url").fill("https://soundcloud.com/halation-sessions/afterglow-extended-mix"); await dl.locator("#goBtn").click();
  await until(async () => await dl.locator("#preview").isVisible() && await dl.locator("#pThumb").evaluate(i => i.complete && i.naturalWidth > 0), 20000);
  await dl.locator("#getCover").click();
  await until(async () => (await dl.locator(".job.done").count()) === 1, 30000);
  await dl.locator('input[name=afmt][value=mp3]').check(); await dl.locator("#getAudio").click();
  await until(async () => (await dl.locator(".job.done").count()) === 2, 30000);
  await sleep(500);
  await shot("downloader");

  }
  if (!ONLY || ONLY.has("framegrab")) {
  /* Frame Grab: a video a few seconds in, with frames in the queue */
  await tab("framegrab"); await appReady("framegrab");
  const fgo = page.frameLocator("#v-framegrab"), fgf = () => page.frames().find(f => /framegrab\.html/.test(f.url()));
  await fgo.locator("#videoIn").setInputFiles(path.join(FIX, "Rain on chrome.mp4"));
  await until(async () => /Rain on chrome/.test(await fgo.locator("#srcName").textContent()) && await fgf().evaluate(() => window.__halApp.state().settled), 60000);
  await fgf().evaluate(() => document.querySelector("#timeline").focus());
  for (let k = 0; k < 4; k++) { for (let i = 0; i < 90; i++) await page.keyboard.press("ArrowRight"); await page.keyboard.press("m"); }
  await until(() => fgf().evaluate(() => window.__halApp.state().queue.filter(q => q.pic).length === 4), 20000, 100);
  await sleep(1500);
  await shot("framegrab");

  }
  if (!ONLY || ONLY.has("interp")) {
  /* AI Interpolate: the night street clip open, a target of 60 fps, a little after the start */
  await tab("interp"); await appReady("interp");
  const ip = page.frameLocator("#v-interp");
  if (await ip.locator("#installBtn").isVisible()) { await ip.locator("#installBtn").click(); await until(async () => await ip.locator("#installBtn").isHidden(), 60000); }
  TOOLS.tools.pickVideo = path.join(FIX, "After hours.mp4");
  await ip.locator(await ip.locator("#browseBtn").isVisible() ? "#browseBtn" : "#changeBtn").click();
  await until(async () => /After hours/.test(await ip.locator("#inName").textContent()) && !!(await ip.locator("#still").getAttribute("src")), 30000);
  await ip.locator('[data-mode="target"]').click(); await ip.locator("#fps").selectOption("60");
  const still0 = await ip.locator("#still").getAttribute("src");
  await ip.locator("#scrub").evaluate(e => { e.value = String(Math.round(+e.max * 0.3)); e.dispatchEvent(new Event("input", { bubbles: true })); });
  await until(async () => (await ip.locator("#still").getAttribute("src")) !== still0, 20000);
  await sleep(1200);
  await shot("interp");

  }
  if (!ONLY || ONLY.has("removebg")) {
  /* Background Remover: Magic wand clicks on face, dress and both wings of a credited Unsplash portrait (CUTOUT_DIR: the real SAM 2.1). */
  await page.evaluate(() => window.__shell.installTool("cutout"));
  await tab("removebg"); await appReady("removebg");
  const rb = page.frameLocator("#v-removebg");
  const subject = path.join(FIX, "Nightfall portrait.jpg");
  fs.copyFileSync(EX("removebg"), subject);
  const frame = page.frames().find(f => /removebg\.html/.test(f.url()));
  await frame.evaluate(() => window.__rb.setMode("wand"));
  await rb.locator("#imgIn").setInputFiles(subject);
  assert(await until(async () => /Nightfall portrait/.test(await rb.locator("#inName").textContent()), 20000));
  assert(await until(() => frame.evaluate(() => !!window.__rb.R.sam && !window.__rb.R.busy), 900000, 500), "The picture was not read by the model");
  const box = await rb.locator("#stage").boundingBox();
  const st = await frame.evaluate(() => ({ ...window.__rb.cmp.st }));
  for (const [x, y] of [[.57, .22], [.57, .65], [.33, .35], [.73, .35]]) {
    await page.mouse.click(box.x + st.tx + x * st.bw * st.z, box.y + st.ty + y * st.bh * st.z);
    await until(() => frame.evaluate(() => window.__rb.R.selCount > 0 && !window.__rb.R.busy), 60000, 300);
    await sleep(1500);
  }
  assert(await until(async () => await rb.locator("#applyBtn").isEnabled(), 60000, 500), "Background selection was not ready");
  await rb.locator("#applyBtn").click({ timeout: 60000 });
  await until(() => frame.evaluate(() => !window.__rb.R.busy), 60000, 500);
  await sleep(2500);
  await shot("removebg");

  }
  if (!ONLY || ONLY.has("convert")) {
  /* Converter: one credited photo and the formats it can become */
  await tab("convert"); await appReady("convert");
  const cv = page.frameLocator("#v-convert"), prism = path.join(FIX, "Prism artwork.jpg");
  fs.copyFileSync(EX("convert"), prism);
  TOOLS.tools.convertFiles = [prism];
  await cv.locator("#browseBtn").click();
  assert(await until(() => cv.locator("#choices .out").first().isVisible(), 20000), "Converter did not list the outputs");
  await sleep(1500); await shot("convert");

  }
  if (!ONLY || ONLY.has("stems")) {
  /* Vocal Remover: the song in 4 stems (HTDemucs; the mock's filters stand in for the model: UI only) */
  await tab("stems"); await appReady("stems");
  const sv = page.frameLocator("#v-stems"), any = path.join(TMP, "stems-component");
  fs.writeFileSync(any, "x");
  TOOLS.tools.stemsSource = { onnxruntime: { "onnxruntime.dll": [any], "DirectML.dll": [any] }, "stems-hq4": { "UVR-MDX-NET-Inst_HQ_4.onnx": [any] }, "stems-htdemucs": { "htdemucs-955717e8-dml4.onnx": [any] } };
  await sv.locator('#modes [data-mode="htdemucs"]').click();
  if (await sv.locator("#installBtn").isVisible()) { await sv.locator("#installBtn").click(); await until(() => sv.locator("#engine").isHidden(), 30000); }
  TOOLS.tools.pickFiles = [path.join(FIX, "Beyond.wav")];
  await sv.locator("#addBtn").click();
  await until(async () => await page.locator("#modal[open] #mOk").isVisible() || (await sv.locator('#queue .qrow[data-state="done"]').count()) === 1, 60000);
  if (await page.locator("#modal[open] #mOk").isVisible()) await page.locator("#modal #mOk").click();
  assert(await until(async () => (await sv.locator('#queue .qrow[data-state="done"]').count()) === 1 && await sv.locator("#playBtn").isEnabled(), 120000), "Vocal Remover did not separate the song");
  await sleep(2500); await shot("stems");

  }
  if (!ONLY || ONLY.has("covertest")) {
  /* Cover Test: synthetic Nova Lune profile and reference artists, never real user data. */
  await tab("covertest"); await appReady("covertest");
  const ct = page.frameLocator("#v-covertest");
  await ct.locator("#imgIn").setInputFiles(EX("covertest"));
  assert(await until(() => ct.locator("#fTitle").isVisible(), 30000));
  await ct.locator("#fTitle").fill("Afterglow"); await ct.locator("#fViews").fill("24K");
  await ct.locator('[data-plat="youtube"]').click(); await ct.locator('[data-view="home"]').click();
  // Wait for real feed items, not the skeletons that hold their place while the fixtures load
  assert(await until(() => ct.locator("#page .cell h3").count().then(n => n >= 6), 30000), "Cover Test feed fixture was not ready");
  await sleep(1500); await shot("covertest");

  }
  if (!ONLY || ONLY.has("library")) {
  /* Library: own covers, linked fixture folder, favourites and tool outputs. */
  await tab("library");
  assert(await until(() => page.locator(".libv-card").count().then(n => n >= 4), 30000), "Library fixture was not indexed");
  await sleep(1500); await shot("library");

  }
  if (!ONLY || ONLY.has("home")) {
  /* Home with the recent files of this session */
  await page.locator(".rail .tab.home").click();
  await sleep(800);
  await shot("home");

  }
  for (const name of ONLY || SCREENS) assert(captured.has(name), "Missing requested capture: " + name);
  const errs = app.errors.filter(e => !/favicon/.test(e));
  if (errs.length) console.log("console errors:\n  " + errs.join("\n  "));
  await browser.close(); server.close();
  if (!errs.length) for (const name of captured) fs.writeFileSync(path.join(OUT, name + ".jpg"), fs.readFileSync(path.join(REVIEW, name + ".jpg")));
  if (!errs.length) {
    const file = path.join(OUT, "panels.json"), all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
    fs.writeFileSync(file, JSON.stringify({ ...all, ...panels }, null, 2) + "\n");
  }
  console.log("Native PNG context and geometry/source manifests: " + REVIEW);
  assert(path.dirname(path.resolve(TMP)) === path.resolve(os.tmpdir()) && path.basename(TMP).startsWith("halation-shots-"), "Cleanup must stay inside the generated screenshot fixture folder");
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(errs.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
