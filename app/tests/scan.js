// Walks every tab, empty and with content, and checks:
// 1. Pseudo mode: t() wraps every string in ⟦ ⟧; visible text (or title/placeholder/aria-label/option) with words
//    outside ⟦ ⟧ that are not user data or technical tokens did not come from the locale files.
// 2. WCAG AA contrast of every visible text against its surface, in English and Spanish.
// 3. Language menu (globe): switching language reloads the window in the new language and keeps the work.
// 4. Screenshots of every tab in both languages → $SHOTS/scan (default: the system temp folder), for review.
// Usage: node app/tests/scan.js
const fs = require("fs");
const path = require("path");
const { until, painted, locale, serve, launch, openApp } = require("./common");
const { createHost } = require("./host");
const { contrast } = require("./contrast");
const { makeFixtures, toolOptions } = require("./fixtures");

const LANGS = ["en", "es"];
const LOCALIZATION_ONLY = process.argv.includes("--localization");
const DOCS = path.join(process.env.SHOTS || path.join(require("os").tmpdir(), "halation-shots"), "scan");
if (!LOCALIZATION_ONLY) fs.mkdirSync(DOCS, { recursive: true });
let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };

const FX = makeFixtures(), TOOLS = toolOptions(FX), fx = n => path.join(FX.FIX, n);
function newHost(lang) {
  const host = createHost(fs.mkdtempSync(path.join(FX.TMP, lang + "-")), { tools: TOOLS.tools });
  const P = (...p) => path.join(host.base, ...p);
  const w = (p, o) => fs.writeFileSync(p, JSON.stringify(o));
  w(P("Presets", "Visualizer", "Night drive.json"), { app: "halation-visualizer", version: 1, settings: { coverSize: 64, bgBlur: 70 } });
  w(P("Presets", "Visualizer", "Vertical.json"), { app: "halation-visualizer", version: 1, settings: { format: "1080x1920" } });
  w(P("Presets", "Grade", "Cold.json"), { app: "halation-grade", version: 1, layers: [{ type: "look", id0: "hielo", on: true, amt: 80 }] });
  w(P("Settings", "app.json"), { settings: { language: lang } });
  return { host, P };
}

// Data that is not interface text: preset, file and song names, sizes.
const USER = new Set(["Night drive", "Vertical", "Cold", "Halation", "cover", "cover.png", "video.mp4", "small.png", "small-x2.png", "song one", "song one.wav",
  "Free Song (Official Video)", "Free Song (Off… Video)", "Free Song (Official Video).mp3", "Free Song (Official Video).mp4", "Open Artist", "Youtube", "Nova", "Mock GPU", "@you", "@tú"]);
// Technical tokens that stay the same in every language.
const TECH = new Set(["px", "fps", "hz", "khz", "mb", "kb", "gb", "s", "ms", "db", "bpm", "k", "x", "h.264", "vp9", "aac", "opus", "mp4", "png", "jpg", "jpeg", "webp", "webm", "wav", "mp3", "json", "mov", "ctrl", "shift", "alt", "esc", "enter", "rgb", "hsl", "lut", "gpu", "cpu", "fx", "ttf", "otf", "woff", "woff2", "a", "b", "rpm", "mbps", "kbps", "yt-dlp", "ffmpeg", "upscayl-bin", "ev", "f", "z", "y", "j", "youtube", "spotify", "soundcloud", "tiff", "bmp", "ico", "gif", "mkv", "m4a", "flac", "ogg", "aiff", "avif", "pcm", "hevc", "av1", "vp8", "mjpeg", "prores", "mpeg-4", "mpeg-2", "alac", "ac-3", "e-ac-3", "dts", "wma", "mka", "ogv", "ts", "avi", "qoi", "tga", "docx", "odt", "rtf", "md", "html", "epub", "xlsx", "ods", "csv", "pptx", "odp", "pdf"]);

async function scanFrame(frame, fonts) {
  return frame.evaluate(({ fonts }) => {
    const out = [];
    const visible = el => el && el.checkVisibility && el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true });
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const where = el => el.id ? "#" + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.split(" ")[0] : "");
    for (let n; (n = walker.nextNode());) {
      const el = n.parentElement;
      if (!el || /^(SCRIPT|STYLE|TEMPLATE|NOSCRIPT)$/.test(el.tagName) || !visible(el)) continue;
      if (n.nodeValue.trim()) out.push([where(el), n.nodeValue.trim()]);
    }
    for (const el of document.querySelectorAll("[title], [placeholder], [aria-label], [data-tip]")) {
      if (!visible(el)) continue;
      for (const a of ["title", "placeholder", "aria-label", "data-tip"]) { const v = el.getAttribute(a); if (v && v.trim()) out.push([where(el) + "@" + a, v.trim()]); }
    }
    for (const s of document.querySelectorAll("select")) {
      if (!visible(s)) continue;
      for (const o of s.options) if (o.textContent.trim()) out.push([where(s) + ">option", o.textContent.trim()]);
    }
    return out.filter(([, v]) => !fonts.includes(v));
  }, { fonts });
}

function leftover(text) {
  let s = text, prev;
  do { prev = s; s = s.replace(/⟦[^⟦⟧]*⟧/g, " "); } while (s !== prev);
  if (USER.has(s.trim())) return "";
  if (/^([A-Za-z]:\\|\/)[^⟦]*$/.test(s.trim())) return "";            // a folder path
  if (/^\d{1,2}[ .]\S+\.?( \d{4})?, \d{1,2}:\d{2}$/.test(s.trim())) return "";  // a date from toLocaleString
  for (const u of [...USER].sort((a, b) => b.length - a.length)) s = s.split(u).join(" ");
  const words = s.split(/[\s·,;:()\[\]{}"“”«»'’|/…=+<>]+/).filter(Boolean);
  return words.filter(w => {
    const lw = w.toLowerCase().replace(/[.!?%×–—-]+$/, "").replace(/^[-–—×]+/, "");
    if (!lw) return false;
    if (/^[\d.,%×x°+\-–—−:#↑↓←→☆★✓✕×⌘≤≥≈•]+$/.test(lw)) return false;
    if (/^#[0-9a-f]{3,8}$/.test(lw)) return false;
    if (/^\d+(\.\d+)?(px|fps|hz|khz|gb|mb|kb|s|ms|db|k|x|%|°|p)$/.test(lw)) return false;
    if (/^\d+x\d+$/.test(lw)) return false;
    if (TECH.has(lw) || TECH.has(lw.replace(/^\./, "")) || USER.has(w)) return false;
    return true;
  }).join(" ");
}

// Every tab, first empty and then with content. at(label, frame, { scanOnly }) runs at each step.
async function tour(app, at) {
  const { page, vis, grade, tab, appReady } = app;
  const up = page.frameLocator("#v-upscale"), dl = page.frameLocator("#v-downloader");
  const frame = re => page.frames().find(f => re.test(f.url()));
  const visible = (loc, n = 1) => until(async () => (await loc.count()) >= n && await loc.first().isVisible(), 10000, 20);
  await painted(page);
  await at("home", page.mainFrame());
  await page.locator("#homeIn").setInputFiles(fx("cover.png")); await visible(page.locator("#homeChoice")); await painted(page);
  await at("home-choose", page.mainFrame(), { scanOnly: true });
  await page.keyboard.press("Escape");
  await page.keyboard.press("?"); await visible(page.locator("#keys")); await painted(page);
  await at("shortcuts", page.mainFrame(), { scanOnly: true });
  await page.keyboard.press("Escape");
  await tab("visualizer"); await appReady("visualizer");
  await at("visualizer-empty", app.vFrame());
  await vis.locator("#artIn").setInputFiles(fx("cover.png"));
  await vis.locator("#audIn").setInputFiles(fx("song one.wav"));
  await until(async () => /song one\.wav/.test(await vis.locator("#audName").textContent()) && /cover\.png/.test(await vis.locator("#artName").textContent()), 15000);
  await painted(page);
  await at("visualizer", app.vFrame());
  await vis.locator("details").evaluateAll(ds => ds.forEach(d => { d.hidden = false; d.open = true; }));
  await vis.locator("#queueAudio").setInputFiles([fx("song one.wav")]);
  await visible(vis.locator("#queueList .job")); await painted(page);
  await at("visualizer-all", app.vFrame(), { scanOnly: true });
  await vis.locator("#f-titleFont-fp").click(); await vis.locator(".fp-pop").waitFor(); await visible(vis.locator(".fp-pop .fp-row"), 6); await painted(page);
  await at("font-picker", app.vFrame(), { scanOnly: true });
  await vis.locator(".fp-search").fill("zzzz"); await until(async () => (await vis.locator(".fp-pop .fp-row").count()) === 0, 5000, 20); await painted(page);
  await at("font-picker-empty", app.vFrame(), { scanOnly: true });
  await vis.locator(".fp-search").press("Escape");
  await vis.locator("details").evaluateAll(ds => ds.forEach(d => { d.open = false; }));
  await vis.locator("#sec-output, details.sec").first().evaluate(d => { d.open = true; });

  await tab("grade"); await appReady("grade");
  await at("grade-empty", app.gFrame());
  await grade.locator("#imgIn").setInputFiles(fx("cover.png"));
  await until(async () => /cover\.png/.test(await grade.locator("#imgName").textContent()));
  await grade.locator('.tile[data-look="nordic"]').click();
  await grade.locator(".tab[data-tab=tools]").click();
  await grade.locator(".acc").first().evaluate(d => { d.open = true; });
  await grade.locator(".acc .tool").first().locator("summary").click();
  await grade.locator(".acc .tool[open] [data-dact=add]").click().catch(() => {});
  await grade.locator(".tab[data-tab=filters]").click();
  await visible(grade.locator("#listF .layer")); await painted(page);
  await at("grade", app.gFrame());
  await grade.locator(".ltab[data-ltab=E]").click();
  await grade.locator("#listE .layer .lname").first().click(); await painted(page);
  await at("grade-layer-open", app.gFrame(), { scanOnly: true });
  await grade.locator("#listE .layer .lname").first().click({ modifiers: ["Control"] });
  await grade.locator("#listE .layer [data-act=more]").first().click(); await visible(grade.locator("#lmenu")); await painted(page);
  await at("grade-layer-menu", app.gFrame(), { scanOnly: true });
  await grade.locator("body").press("Escape");
  await grade.locator(".ltab[data-ltab=F]").click();
  for (const tb of ["tools", "mine"]) {
    await grade.locator(`.tab[data-tab=${tb}]`).click(); await painted(page);
    await grade.locator("details").evaluateAll(ds => ds.forEach(d => { d.open = true; }));
    await painted(page);
    await at("grade-" + tb, app.gFrame(), { scanOnly: true });
  }
  await grade.locator("details").evaluateAll(ds => ds.forEach(d => { d.open = false; }));
  await grade.locator(".tab[data-tab=filters]").click();

  await tab("downloader"); await appReady("downloader");
  await at("downloader-empty", frame(/downloader\.html/));
  await dl.locator("#installBtn").click();
  await until(async () => await dl.locator("#engine").isHidden(), 30000);
  await dl.locator("#url").fill("https://www.youtube.com/watch?v=abc123"); await dl.locator("#goBtn").click();
  await until(async () => await dl.locator("#preview").isVisible(), 15000);
  await dl.locator('input[name=afmt][value=mp3]').check(); await dl.locator("#getAudio").click(); await dl.locator("#getCover").click();
  await until(async () => (await dl.locator(".job.done").count()) === 2, 30000);
  await dl.locator("#getVideo").click();
  await until(async () => (await dl.locator(".job.running").count()) === 1, 10000, 50);
  await until(() => dl.locator(".job.running .prog i").evaluate(b => parseFloat(b.style.getPropertyValue("--v")) > 0), 10000, 20).catch(() => {}); await painted(page);
  await at("downloader", frame(/downloader\.html/));
  await until(async () => (await dl.locator(".job.done").count()) === 3, 30000);

  await tab("upscale"); await appReady("upscale");
  await at("upscale-empty", frame(/upscale\.html/));
  await up.locator("#installBtn").click();
  await until(async () => await up.locator("#installRow").isHidden(), 30000);
  await up.locator("#imgIn").setInputFiles(fx("small.png"));
  await up.locator('input[name=model][value=fast]').check(); await up.locator('[data-scale="2"]').click();
  await up.locator("#runBtn").click();
  await until(async () => !(await up.locator("#result").isHidden()), 120000, 200);
  await painted(page);
  await at("upscale", frame(/upscale\.html/));

  await tab("framegrab"); await appReady("framegrab"); await painted(page);
  await at("framegrab", frame(/framegrab\.html/));

  await tab("interp"); await appReady("interp");
  const ipf = frame(/interp\.html/), ip = page.frameLocator("#v-interp");
  await at("interp-empty", ipf);
  await ip.locator("#installBtn").click();
  await until(async () => await ip.locator("#installRow").isHidden(), 30000);
  TOOLS.tools.pickVideo = path.join(FX.MEDIA, "video.mp4");
  await ip.locator("#browseBtn").click();
  await until(async () => !!(await ip.locator("#still").getAttribute("src")) && await ip.locator("#still").isVisible(), 20000);
  await ip.locator('[data-mode="target"]').click(); await painted(page);
  await at("interp", ipf);

  await tab("convert"); await appReady("convert");
  const cvf = frame(/convert\.html/), cvl = page.frameLocator("#v-convert");
  await at("convert-empty", cvf);
  TOOLS.tools.convertFiles = [fx("small.png")];
  await cvl.locator("#browseBtn").click();
  await until(async () => await cvl.locator("#choices .out").first().isVisible(), 15000);
  await painted(page);
  await at("convert", cvf);
  await tab("stems"); await appReady("stems");
  const stf = frame(/stems\.html/), stl = page.frameLocator("#v-stems");
  await at("stems-empty", stf);
  const any = path.join(FX.TMP, "stems-component"); fs.writeFileSync(any, "x");
  TOOLS.tools.stemsSource = { onnxruntime: { "onnxruntime.dll": [any], "DirectML.dll": [any] }, "stems-hq4": { "UVR-MDX-NET-Inst_HQ_4.onnx": [any] } };
  await stl.locator("#installBtn").click();
  await until(() => stl.locator("#engine").isHidden(), 30000);
  TOOLS.tools.pickFiles = [fx("song one.wav")];
  await stl.locator("#addBtn").click();
  // the first automatic export asks once whether to change the folder: keep it
  await until(async () => await page.locator("#modal[open] #mOk").isVisible() || (await stl.locator('#queue .qrow[data-state="done"]').count()) === 1, 30000);
  if (await page.locator("#modal[open] #mOk").isVisible()) await page.locator("#modal #mOk").click();
  await until(async () => (await stl.locator('#queue .qrow[data-state="done"]').count()) === 1 && await stl.locator("#playBtn").isEnabled(), 30000);
  await painted(page);
  await at("stems", stf);

  await tab("library"); await visible(page.locator("#libPanel .libv-card")); await painted(page);
  await at("library", page.mainFrame());
  await tab("settings"); await visible(page.locator("#codecs .codec"), 5); await visible(page.locator("#tools .row"), 5); await painted(page);
  await at("settings", page.mainFrame());
  for (const section of await page.locator('#setNav [data-sec]').evaluateAll(bs => bs.map(b => b.dataset.sec))) {
    await page.locator(`#${section}`).scrollIntoViewIfNeeded(); await painted(page);
    await at("settings-" + section, page.mainFrame(), { scanOnly: true });
  }
  await page.locator('#sg-general details > summary').click();
  await page.locator("#testNotify").click(); await painted(page);
  await page.locator("#langBtn").click(); await visible(page.locator("#langMenu")); await painted(page);
  await at("settings-menu", page.mainFrame(), { scanOnly: true });
  await page.keyboard.press("Escape");
  await tab("library"); await page.locator('#libNav [data-tab="presets"]').click(); await visible(page.locator("#libPanel .libv-card"));
  await page.locator("#libPanel .libv-card").first().click({ button: "right" }); await page.locator('.libv-menu [data-mi="rename"]').click(); await visible(page.locator("#mInput"));
  await page.locator("#mInput").fill("a/b"); await until(() => page.locator("#mOk").isDisabled(), 5000, 20); await painted(page);
  await at("rename-dialog", page.mainFrame(), { scanOnly: true });
  await page.keyboard.press("Escape");
}

module.exports = { tour, newHost, fx, FX, scanFrame, leftover };
if (require.main === module) (async () => {
  const server = serve();
  const browser = await launch();
  const fonts = ["Unbounded", "Archivo", "Hanken Grotesk", "Syne", "Michroma", "Cinzel", "UnifrakturCook", "JetBrains Mono", "DejaVu Sans", "DejaVu Serif", "DejaVu Sans Mono", "Liberation Serif", "Liberation Sans"];
  for (let i = 1; i <= 320; i++) fonts.push(`Fake Font ${String(i).padStart(3, "0")}`);

  /* ---------- 1. pseudo-locale scan ---------- */
  for (const lang of LANGS) {
    const { host } = newHost(lang);
    const app = await openApp(browser, server, host, { pseudo: true });
    const found = new Map();
    await tour(app, async (label, frame) => {
      for (const f of [app.page.mainFrame(), frame].filter((x, i, a) => a.indexOf(x) === i)) {
        for (const [where, text] of await scanFrame(f, fonts)) {
          const rest = leftover(text);
          if (rest) found.set(`${label} ${where}: “${text}” → ${rest}`, 1);
        }
      }
    });
    const list = [...found.keys()];
    ok(list.length === 0, `[${lang}] no hardcoded visible text in any tab, empty or with content (pseudo-locale)` + (list.length ? ":\n  " + list.join("\n  ") : ""));
    const missing = await app.page.evaluate(() => [...window.__i18n.missing]);
    ok(missing.length === 0, `[${lang}] every key used exists in en.json` + (missing.length ? ": " + missing.join(", ") : ""));
    const errs = app.errors.filter(e => !/favicon/.test(e));
    ok(errs.length === 0, `[${lang}] no console errors in pseudo mode` + (errs.length ? ":\n  " + errs.join("\n  ") : ""));
    await app.page.close();
  }

  /* ---------- 2. contrast and screenshots ---------- */
  if (!LOCALIZATION_ONLY) {
  const SHOTS = ["home", "visualizer-empty", "visualizer", "grade-empty", "grade", "downloader", "upscale",  "library", "settings"];
  for (const lang of LANGS) {
    const { host } = newHost(lang);
    const app = await openApp(browser, server, host, { width: 1440, height: 900 });
    const bad = [], taken = [];
    await tour(app, async (label, frame, o = {}) => {
      for (const f of [app.page.mainFrame(), frame].filter((x, i, a) => a.indexOf(x) === i)) for (const b of await contrast(f)) bad.push(`${label}: ${b}`);
      if (!o.scanOnly && SHOTS.includes(label)) {
        await app.page.mouse.move(700, 450); await painted(app.page);
        await app.page.screenshot({ path: path.join(DOCS, `${lang}-${label}.png`) }); taken.push(label);
      }
    });
    ok(bad.length === 0, `[${lang}] WCAG AA contrast of all text in every tab and state` + (bad.length ? ":\n  " + bad.join("\n  ") : ""));
    ok(taken.length === SHOTS.length, `[${lang}] screenshots: ${taken.join(", ")}`);
    const errs = app.errors.filter(e => !/favicon/.test(e));
    ok(errs.length === 0, `[${lang}] no console errors` + (errs.length ? ":\n  " + errs.join("\n  ") : ""));
    await app.page.close();
  }

  }
  /* ---------- 3. language menu ---------- */
  {
    const { host, P } = newHost("en");
    const app = await openApp(browser, server, host);
    const { page, vis, appReady } = app;
    const es = locale("es").L, en = locale("en").L;
    const libLabel = () => page.locator(".rail .tab[data-tab=library]").getAttribute("aria-label");
    await app.tab("visualizer"); await appReady("visualizer");
    await vis.locator("#sec-text").evaluate(d => { d.open = true; });
    await vis.locator("#f-artist").fill("Keep me"); await vis.locator("#f-artist").dispatchEvent("input");
    ok(await libLabel() === en("tab.library"), "English by default");
    const box = await page.locator("#langBtn").boundingBox(), vw = page.viewportSize().width;
    const saveBox = await page.locator("#sessionBtn").boundingBox();
    ok(saveBox.x > vw - 80 && box.x + box.width === saveBox.x && box.y === saveBox.y && box.y < 60, "The globe precedes Save Session in the top-right toolbox");
    await page.locator("#langBtn").click();
    ok(await page.locator("#langMenu").isVisible(), "The globe opens the language menu");
    ok(await page.locator('#langMenu [data-lang="en"]').getAttribute("aria-checked") === "true", "The current language is checked");
    await Promise.all([page.waitForEvent("load"), page.locator('#langMenu [data-lang="es"]').click()]);
    await page.waitForFunction(() => !document.body.classList.contains("booting"));
    ok(await page.evaluate(() => document.documentElement.lang) === "es" && await libLabel() === es("tab.library"), "Choosing Español reloads the window in Spanish");
    ok(JSON.parse(fs.readFileSync(P("Settings", "app.json"), "utf8")).settings.language === "es", "The language is saved in settings");
    await app.tab("visualizer"); await appReady("visualizer");
    await vis.locator("#sec-text").evaluate(d => { d.open = true; });
    ok(await vis.locator("#f-artist").inputValue() === "Keep me", "The Visualizer keeps its work across the language change");
    ok(await vis.locator("#play").getAttribute("aria-label") === es("vis.play"), "The Visualizer frame is in Spanish too");
    await page.locator("#langBtn").click();
    await Promise.all([page.waitForEvent("load"), page.locator('#langMenu [data-lang="en"]').click()]);
    await page.waitForFunction(() => !document.body.classList.contains("booting"));
    ok(await libLabel() === en("tab.library"), "And back to English");
    const errs = app.errors.filter(e => !/favicon/.test(e));
    ok(errs.length === 0, "No console errors while switching" + (errs.length ? ":\n  " + errs.join("\n  ") : ""));
    await page.close();
  }

  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed` : "\nAll passed");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
