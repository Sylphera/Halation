// Vocal Remover: a song separated, then its export when done stopped (the Save dialog dismissed, as in the 1.2.0 video):
// the song stays separated with its lanes, the export says why, and no song turns "Cancelled". Usage: node app/tests/stems-export-cancel.js
const fs = require("fs"), path = require("path"), { execSync } = require("child_process");
const { until, serve, launch, openApp, locale } = require("./common"), { createHost } = require("./host"), { makeFixtures, toolOptions } = require("./fixtures");
let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const FX = makeFixtures(), TOOLS = toolOptions(FX), { L } = locale("en");
TOOLS.tools.systemFfmpeg = TOOLS.tools.ffmpegSource;
const host = createHost(fs.mkdtempSync(path.join(FX.TMP, "stems-cancel-")), TOOLS);
fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en", saveMode: "ask-every-time", saveLocationChosen: true } }));
for (const p of [["runtime", "onnxruntime.dll"], ["runtime", "DirectML.dll"], ["UVR-MDX-NET-Inst_HQ_4.onnx"]]) { const f = path.join(host.base, "Tools", "stems", ...p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, "x"); }
const D = fs.mkdtempSync(path.join(FX.TMP, "songs-")), A = path.join(D, "song.mp3");
execSync(`ffmpeg -v error -f lavfi -i "sine=f=110:d=3" -f lavfi -i "sine=f=2400:d=3" -filter_complex "[0:a][1:a]amix=inputs=2[a]" -map "[a]" -c:a libmp3lame -y "${A}"`);
(async () => {
  const server = serve(), browser = await launch();
  try {
    const { page, errors, tab, appReady } = await openApp(browser, server, host, { width: 1480, height: 920 });
    const st = page.frameLocator("#v-stems"), S = fn => page.frames().find(f => /stems\.html/.test(f.url())).evaluate(fn);
    await tab("stems"); await appReady("stems");
    ok(await until(() => st.locator("#engine").isHidden(), 10000), "The engine is there: " + await st.locator("#engineNote").textContent());
    await S(() => { window.__stems.opts.auto = true; });
    TOOLS.tools.stemsChunkMs = 20; TOOLS.tools.pickFiles = [A];
    host.setSaveDestination(null);
    await st.locator("#addBtn").click();
    ok(await until(async () => (await st.locator("#exportStatus").textContent()) === L("common.saveCancelled") && await S(() => window.__stems.Q.sel?.state === "done" && !!window.__stems.Q.sel.res), 30000),
      "Save dialog dismissed on the export when done: the song stays separated · " + await st.locator("#exportStatus").textContent());
    ok(await st.locator('#queue .qrow[data-state="cancelled"]').count() === 0 && await st.locator("#lanes .lane").count() === 2, "…not cancelled, its two lanes stay");
    ok(await until(() => page.evaluate(() => !window.__hal.jobs.list().some(j => j.state === "running")), 10000), "…and its job has ended");
    ok(errors.length === 0, "No page errors: " + errors.join(" | "));
  } finally { await browser.close(); server.close(); }
  console.log(failures ? `${failures} failed` : "all passed"); process.exitCode = failures ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
