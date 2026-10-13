// Vocal Remover (stems.js, stems.rs) used as a user would, with host.js standing in for the model (a low-pass for the
// instrumental, the rest for the vocals, the waveform sent chunk by chunk like stems.rs):
// 1. Not installed: the engine card names what is missing. A download whose every source is wrong leaves nothing; with
//    a wrong first source the mirror is used, each file kept only with its sha256.
// 2. A batch of 4 from the file picker (MP3, WAV, a broken file, an MP4 video): the waveform fills chunk by chunk with
//    its progress; 3 are done and exported on their own as 24-bit WAV at 44.1 kHz into Exports\Stems\<song>, the
//    broken one is red with its reason. The first export asks once whether to change the folder (kept).
// 3. Mute / Solo dim the lanes; a lane's volume in dB; Original / Separated; one track from its lane; "Export all" with
//    the mix at the volumes heard, as FLAC 24 bit; the files are in the Library, made from the song. Save to: a folder
//    chosen takes the next export, and back to Exports\Stems.
// 4. Cancel in the middle leaves no stems and no export. With no GPU, "auto" falls back to the CPU and says so.
// 5. 4 stems: the mode asks for its model (HTDemucs) and shows its notice; a song gives four lanes and four files, and
//    the mix of what is on with Solo on two of them.
// Songs added start on their own; with the engine missing they wait and start once it is installed.
// 6. At most 8 songs in the list.
// The windows: the empty mixer shows the three steps; the mode tiles show their stems and download sizes.
// Screenshots → $SHOTS/stems. Usage: node app/tests/stems.js
const fs = require("fs"), os = require("os"), path = require("path"), crypto = require("crypto"), { execSync } = require("child_process");
const { until, painted, serve, launch, openApp, locale } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "stems");
fs.mkdirSync(SHOTS, { recursive: true });
const FX = makeFixtures(), TOOLS = toolOptions(FX), { L } = locale("en");
const host = createHost(fs.mkdtempSync(path.join(FX.TMP, "stems-")), TOOLS);
fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en" } }));
const P = (...p) => path.join(host.base, ...p);
const sh = c => execSync(c).toString().trim();
const probe = (f, e) => sh(`ffprobe -v error -select_streams a:0 -show_entries stream=${e} -of csv=p=0 "${f}"`);
// the songs: a low tone (the "instrumental") under a high one (the "vocals")
const D = fs.mkdtempSync(path.join(FX.TMP, "songs-"));
const song = (name, args) => { const f = path.join(D, name); execSync(`ffmpeg -v error -f lavfi -i "sine=f=110:d=3" -f lavfi -i "sine=f=2400:d=3" ${args} -y "${f}"`); return f; };
const mix = '-filter_complex "[0:a][1:a]amix=inputs=2,aformat=channel_layouts=stereo[a]" -map "[a]"';
const A = song("first song.mp3", `${mix} -c:a libmp3lame -b:a 192k`);
const B = song("second.wav", `${mix} -ar 48000 -c:a pcm_s16le`);
const V = path.join(D, "clip.mp4");
execSync(`ffmpeg -v error -f lavfi -i testsrc=size=160x90:rate=25:d=3 -f lavfi -i "sine=f=330:d=3" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest -y "${V}"`);
const BAD = path.join(D, "broken.mp3"); fs.writeFileSync(BAD, "not a song at all");
// the components: stand-ins with their sha256, and a wrong copy of each
const C = fs.mkdtempSync(path.join(FX.TMP, "comp-")), sha = {}, src = {};
for (const n of ["onnxruntime.dll", "DirectML.dll", "UVR-MDX-NET-Inst_HQ_4.onnx", "htdemucs-955717e8-dml4.onnx"]) {
  const good = path.join(C, n), bad = path.join(C, "bad-" + n);
  fs.writeFileSync(good, crypto.randomBytes(200000)); fs.writeFileSync(bad, crypto.randomBytes(200000));
  sha[n] = crypto.createHash("sha256").update(fs.readFileSync(good)).digest("hex"); src[n] = { good, bad };
}
TOOLS.tools.stemsSha = sha;

(async () => {
  const server = serve(), browser = await launch();
  const { page, errors, tab, appReady } = await openApp(browser, server, host, { width: 1480, height: 920 });
  const st = page.frameLocator("#v-stems"), fr = () => page.frames().find(f => /stems\.html/.test(f.url()));
  const shot = n => process.argv.includes('--functional') ? Promise.resolve() : painted(page).then(() => page.screenshot({ path: path.join(SHOTS, n + ".png") }));
  const S = fn => fr().evaluate(fn);
  const status = () => st.locator("#status").textContent();
  const rows = state => st.locator(`#queue .qrow${state ? `[data-state="${state}"]` : ""}`).count();
  const tempLeft = () => fs.readdirSync(host.localDir("workspace", "temp")).filter(f => /^stems-/.test(f));
  const stemsDir = P("Exports", "Stems");
  const out = () => fs.existsSync(stemsDir) ? fs.readdirSync(stemsDir).sort() : [];
  const runtime = () => { const d = P("Tools", "stems", "runtime"); return fs.existsSync(d) ? fs.readdirSync(d) : []; };

  // 1. the engine
  await tab("stems"); await appReady("stems");
  ok(await st.locator("#engine").isVisible() && (await st.locator("#engineNote").textContent()).includes(L("set.comp.onnxruntime")), "Not installed: " + await st.locator("#engineNote").textContent());
  ok(await st.locator("#runBtn").isDisabled(), "…Separate all is off");
  await shot("1-missing");
  TOOLS.tools.stemsSource = { onnxruntime: { "onnxruntime.dll": [src["onnxruntime.dll"].bad, src["DirectML.dll"].good], "DirectML.dll": [src["DirectML.dll"].good] }, "stems-hq4": { "UVR-MDX-NET-Inst_HQ_4.onnx": [src["UVR-MDX-NET-Inst_HQ_4.onnx"].good] } };
  await st.locator("#installBtn").click();
  ok(await until(async () => (await st.locator("#installStatus").textContent()).startsWith(L("st.err.install", { error: "" }).trim()), 30000), "Both sources wrong: " + await st.locator("#installStatus").textContent());
  ok(!runtime().some(f => /onnxruntime/.test(f)), "…nothing kept of ONNX Runtime: " + runtime().join(", "));
  TOOLS.tools.stemsSource.onnxruntime["onnxruntime.dll"] = [src["onnxruntime.dll"].bad, src["onnxruntime.dll"].good];
  await st.locator("#installBtn").click();
  ok(await until(() => st.locator("#engine").isHidden(), 30000), "Wrong first source: the mirror is used and the engine is ready");
  ok(runtime().sort().join() === "DirectML.dll,onnxruntime.dll" && fs.existsSync(P("Tools", "stems", "UVR-MDX-NET-Inst_HQ_4.onnx")), "…in Tools\\stems: " + runtime().join(", "));
  ok(crypto.createHash("sha256").update(fs.readFileSync(P("Tools", "stems", "runtime", "onnxruntime.dll"))).digest("hex") === sha["onnxruntime.dll"], "…the right file");

  // 2. a batch of 4
  TOOLS.tools.pickFiles = [A, B, BAD, V]; TOOLS.tools.stemsChunkMs = 250;
  await st.locator("#addBtn").click();
  ok(await until(async () => (await rows("queued")) + (await rows("running")) === 4), "Four songs added: they start on their own, without Separate all");
  ok((await st.locator("#songName").textContent()) === "first song.mp3", "…the first is shown");
  ok(await until(() => S(() => { const w = window.__stems.Q.items[0].wave; return !!w && w.filled > 0 && w.filled < w.total; }), 20000, 20), "The waveform fills as chunks arrive");
  ok(await until(async () => (await status()).startsWith(L("st.chunk", { k: 1, n: 2 }).replace(/1\/2$/, "")), 5000, 20) && await st.locator('.lane[data-track="vocals"] .cover').isVisible(), "…with the chunk and the skeleton over the rest: " + await status());
  await shot("2-running");
  TOOLS.tools.stemsChunkMs = 20;
  ok(await until(() => page.evaluate(() => document.querySelector("#modal").open), 30000) && (await page.locator("#mTitle").textContent()) === L("st.destAsk"), "The first export asks whether to change the folder: " + await page.locator("#mText").textContent());
  await shot("2-ask-folder");
  await page.locator("#mOk").click();
  ok(await until(() => S(() => window.__stems.opts.destAsked && window.__stems.opts.dest === ""), 5000), "…kept: Exports\\Stems, and it is not asked again");
  ok(await until(async () => (await rows("done")) === 3 && (await rows("error")) === 1, 60000), "3 done, 1 failed");
  ok(await until(() => out().length === 3, 20000), "…the 3 exported on their own: " + out().join(", "));
  const bad = st.locator('#queue .qrow[data-state="error"]');
  ok((await bad.locator("b").textContent()) === "broken.mp3" && (await bad.locator(".nm span").textContent()) === L("st.err.noAudio"), "The broken one says why: " + await bad.locator(".nm span").textContent());
  const v1 = path.join(stemsDir, "first song", "first song (vocals).wav"), i1 = path.join(stemsDir, "first song", "first song (instrumental).wav");
  ok(fs.existsSync(v1) && fs.existsSync(i1), "Exports\\Stems\\first song has the vocals and the instrumental");
  ok(probe(v1, "codec_name,sample_rate") === "pcm_s24le,44100", "…24-bit WAV at 44.1 kHz: " + probe(v1, "codec_name,sample_rate"));
  ok(await until(() => fs.existsSync(path.join(stemsDir, "clip", "clip (instrumental).wav")), 20000), "The video's sound is separated too");
  ok(!(await S(() => window.__stems.Q.items.some(x => x.state === "done" && x.wave && x.wave.filled < x.wave.total))), "…every done waveform is whole");
  ok(await until(async () => (await rows("waiting")) === 0 && await st.locator("#cancelBtn").isHidden()), "Nothing left running");

  // 3. the player, Mute / Solo, the mix, the Library
  await st.locator('#queue .qrow[data-state="done"]').first().click();
  ok(await until(() => st.locator("#playBtn").isEnabled(), 10000), "A done song can be played");
  ok((await status()).startsWith(L("st.doneIn", { s: 0 }).split("0")[0]) && (await status()).includes(L("st.dev.gpu")), "…its status: " + await status());
  await st.locator('.lane[data-track="vocals"] [data-ms="solo"]').click();
  ok(await S(() => window.__stems.audible("vocals") && !window.__stems.audible("instrumental")) && await st.locator('.lane[data-track="instrumental"]').evaluate(e => e.classList.contains("quiet")), "Solo on the vocals: the instrumental is dimmed");
  await st.locator('.lane[data-track="vocals"] [data-ms="solo"]').click();
  await st.locator('.lane[data-track="vocals"] [data-ms="mute"]').click();
  ok(await S(() => !window.__stems.audible("vocals") && window.__stems.audible("instrumental")), "Mute on the vocals: only the instrumental is heard");
  await st.locator('.lane[data-track="vocals"] [data-ms="mute"]').click();
  await st.locator('.lane[data-track="vocals"] .vol').fill("-6");
  ok((await st.locator('.lane[data-track="vocals"] .lane-v output').textContent()) === L("st.db", { v: "-6.0" }) && await S(() => window.__stems.opts.vol.vocals === -6), "Vocals at -6 dB: " + await st.locator('.lane[data-track="vocals"] .lane-v output').textContent());
  await st.locator('.lane[data-track="instrumental"] .vol').fill("-30");
  ok(await st.locator('.lane[data-track="instrumental"]').evaluate(e => e.classList.contains("quiet")) && (await st.locator('.lane[data-track="instrumental"] .lane-v output').textContent()) === L("st.dbOff"), "Instrumental all the way down: off and dimmed");
  await st.locator('.lane[data-track="instrumental"] .vol').dblclick();
  ok(await S(() => window.__stems.opts.vol.instrumental === 0), "…a double click: back to 0 dB");
  await st.locator("#playBtn").click();
  ok(await until(() => S(() => window.__stems.P.playing && !!window.__stems.P.og)), "Play: the stems and the original on one clock");
  ok(await until(() => S(() => Math.abs(window.__stems.P.gains.vocals.gain.value - 0.501) < 0.01 && window.__stems.P.og.gain.value === 0), 3000), "…the vocals at -6 dB, the original silent");
  await st.locator('#ab [data-ab="orig"]').click();
  ok(await until(() => S(() => window.__stems.P.og.gain.value > 0.99 && window.__stems.P.gains.vocals.gain.value < 0.01), 3000) && await st.locator("#lanes").evaluate(e => e.classList.contains("orig")), "Original: only the song as it came in");
  await st.locator('#ab [data-ab="sep"]').click();
  await st.locator("#playBtn").click();
  await shot("3-mixer");
  const name = await st.locator("#songName").textContent(), stem = name.replace(/\.[^.]+$/, "");
  await st.locator('#olist [data-dl="vocals"]').click();
  const one = path.join(stemsDir, stem + " (2)");
  ok(await until(() => fs.existsSync(one) && fs.readdirSync(one).length === 1, 20000) && fs.existsSync(path.join(one, `${stem} (vocals).wav`)), "Export's row for the vocals: the vocals alone: " + (fs.existsSync(one) ? fs.readdirSync(one).join(", ") : out().join(", ")));
  await st.locator("#format").selectOption("flac");
  await st.locator("#mixOut").check();
  const runs = host.log.filter(l => l[0] === "proc").length;
  await st.locator("#exportBtn").click();
  ok(await until(async () => (await st.locator("#exportStatus").textContent()).startsWith(L("st.exported", { folder: "" }).trim()), 20000), "Export all: " + await st.locator("#exportStatus").textContent());
  const all = path.join(stemsDir, stem + " (3)"), mixFile = path.join(all, `${stem} (mix).flac`);
  ok(fs.existsSync(all) && fs.readdirSync(all).length === 3, "…both tracks and the mix: " + (fs.existsSync(all) ? fs.readdirSync(all).join(", ") : ""));
  ok(fs.existsSync(mixFile) && probe(mixFile, "codec_name,bits_per_raw_sample") === "flac,24", "…the mix as FLAC 24 bit: " + (fs.existsSync(mixFile) ? probe(mixFile, "codec_name,bits_per_raw_sample") : out().join(", ")));
  const mixArgs = host.log.filter(l => l[0] === "proc").slice(runs).map(l => l[1].args.join(" ")).find(a => a.includes("(mix)")) || "";
  ok(/volume=0\.50118\d*\[a0\]/.test(mixArgs) && /volume=1\[a1\]/.test(mixArgs), "…at the volumes heard (vocals -6 dB): " + (mixArgs.match(/volume=[^;]+/g) || []).join(" "));
  await S(() => { window.__stems.opts.vol.vocals = 0; });
  // Save to: another folder, then back
  const mine = path.join(D, "my stems"); TOOLS.tools.pickFolder = mine;
  ok((await st.locator("#dest").inputValue()) === "" && (await st.locator("#dest option").first().textContent()) === L("st.dest.exports"), "Save to shows Exports\\Stems");
  await st.locator("#dest").selectOption("choose");
  ok(await until(() => S(() => window.__stems.opts.dest !== ""), 5000) && (await st.locator("#dest").inputValue()) === mine, "Save to: a folder chosen: " + await st.locator("#dest").inputValue());
  await st.locator('#olist [data-dl="vocals"]').click();
  ok(await until(() => fs.existsSync(path.join(mine, stem, `${stem} (vocals).flac`)), 20000) && !page.isClosed() && !(await page.evaluate(() => document.querySelector("#modal").open)), "…the next export goes there, without asking: " + (fs.existsSync(mine) ? fs.readdirSync(mine).join(", ") : ""));
  ok(await until(async () => (await st.locator("#exportStatus").textContent()) === L("st.exportedTo", { folder: "my stems › " + stem }), 10000), "…and says where: " + await st.locator("#exportStatus").textContent());
  await st.locator("#dest").selectOption("");
  ok(await S(() => window.__stems.opts.dest === ""), "Back to Exports\\Stems");
  const lib = await page.evaluate(([f, s]) => { const L = window.__hal.library, a = L.get(f), o = L.get(s); return a && { tool: a.origin && a.origin.tool, from: (a.origin && a.origin.from) || [], orig: o && o.id }; }, [v1, A]);
  ok(!!lib && lib.tool === "stems" && !!lib.orig && lib.from.includes(lib.orig), "The stems are in the Library, made from the song: " + JSON.stringify(lib));
  await shot("3-done");

  // 4. cancel; no GPU
  await st.locator("#format").selectOption("wav");
  await st.locator("#mixOut").uncheck();
  const before = out();
  TOOLS.tools.stemsChunkMs = 3000; TOOLS.tools.pickFiles = [A];
  await st.locator("#addBtn").click();
  ok(await until(() => S(() => window.__stems.Q.items.some(x => x.state === "running" && x.chunk >= 1)), 20000, 50), "A song added starts on its own");
  await st.locator("#cancelBtn").click();
  ok(await until(async () => (await rows("cancelled")) === 1 && await st.locator("#cancelBtn").isHidden(), 20000), "Cancel: the song is cancelled");
  ok(await until(() => tempLeft().length === 3, 5000) && out().join() === before.join(), "…no stems and no export left: " + tempLeft().join(", "));
  TOOLS.tools.stemsChunkMs = 20; TOOLS.tools.stemsGpu = false;
  ok(await st.locator("#runBtn").isEnabled(), "…Separate all takes it again");
  await st.locator("#runBtn").click();
  ok(await until(async () => (await rows("done")) === 4, 30000), "Again with no GPU: done");
  await st.locator("#queue .qrow").last().click();
  ok(await until(async () => (await status()).includes(L("st.fellBack")), 5000), "…on the CPU, and it says so: " + await status());
  await shot("4-cpu");

  // 5. 4 stems
  TOOLS.tools.stemsGpu = true;
  ok((await st.locator("#modeNote").textContent()) === L("st.credit"), "Vocals · Instrumental: UVR's credit under the mode");
  await st.locator('#modes [data-mode="htdemucs"]').click();
  ok((await st.locator("#modeNote").textContent()) === L("st.credit.htdemucs"), "4 stems: the notice about its training data");
  ok(await until(() => st.locator("#engine").isVisible(), 5000) && (await st.locator("#engineNote").textContent()).includes(L("set.comp.stems-htdemucs")) && await st.locator("#runBtn").isDisabled(), "…its model is missing: " + await st.locator("#engineNote").textContent());
  ok((await st.locator('#modes [data-mode="htdemucs"] .chips i').evaluateAll(b => b.map(x => x.dataset.track))).join() === "vocals,drums,bass,other" && (await st.locator('#modes [data-mode="htdemucs"] small').textContent()).includes(L("st.m.get", { mb: 170 })), "…its tile: four stems and 170 MB to download");
  TOOLS.tools.pickFiles = [B];
  await st.locator("#addBtn").click();
  ok(await until(async () => (await rows("waiting")) === 1), "A song added with the model missing waits");
  await st.locator('#queue .qrow[data-state="waiting"]').click();
  ok((await st.locator("#songMeta").textContent()) === ["vocals", "drums", "bass", "other"].map(k => L("st.t." + k)).join(" · "), "…its header names the four stems");
  TOOLS.tools.stemsSource["stems-htdemucs"] = { "htdemucs-955717e8-dml4.onnx": [src["htdemucs-955717e8-dml4.onnx"].good] };
  await st.locator("#installBtn").click();
  ok(await until(() => st.locator("#engine").isHidden(), 30000) && fs.existsSync(P("Tools", "stems", "htdemucs-955717e8-dml4.onnx")), "Download: HTDemucs in Tools\\stems, and the waiting song starts");
  ok(await until(async () => (await rows("done")) === 5, 30000), "4 stems: done");
  ok(host.log.filter(l => l[0] === "stems").pop()[1].mode === "htdemucs", "…with HTDemucs");
  ok((await st.locator("#lanes .lane").evaluateAll(l => l.map(x => x.dataset.track))).join() === "vocals,drums,bass,other", "Four lanes: vocals, drums, bass, other");
  const four = path.join(stemsDir, "second (2)");
  ok(await until(() => fs.existsSync(four) && fs.readdirSync(four).length === 4, 20000), "…four files exported: " + (fs.existsSync(four) ? fs.readdirSync(four).join(", ") : out().join(", ")));
  for (const k of ["drums", "bass"]) await st.locator(`.lane[data-track="${k}"] [data-ms="solo"]`).click();
  ok(await S(() => ["drums", "bass"].every(k => window.__stems.audible(k)) && !window.__stems.audible("vocals")), "Solo on drums and bass: only they are heard");
  await st.locator("#mixOut").check();
  await st.locator("#exportBtn").click();
  const mix4 = path.join(stemsDir, "second (3)", "second (mix).wav");
  ok(await until(() => fs.existsSync(mix4), 20000) && fs.readdirSync(path.dirname(mix4)).length === 5, "Export all: four stems and the mix of drums and bass");
  ok((await st.locator("#stats [data-stat=model] dd").textContent()) === L("st.model.htdemucs") + " · " + L("st.n", { n: 4 }), "The facts name the model: " + await st.locator("#stats").textContent());
  await shot("5-four");
  await st.locator("#queue .qrow").first().click();
  ok(await st.locator("#runBtn").isEnabled(), "All is on: songs separated with the other model");
  await st.locator("#sepBtn").click();
  ok(await until(async () => (await st.locator("#queue .qrow").first().getAttribute("data-state")) === "done" && (await st.locator("#lanes .lane").count()) === 4, 30000), "Separate: the song open again with 4 stems");

  // 6. at most 8 songs: 4 more with 6 in the list, 2 are added and the drop place says why the rest are not
  TOOLS.tools.pickFiles = [A, B, A, B];
  await st.locator("#addBtn").click();
  ok(await until(async () => (await rows()) === 8) && (await st.locator("#dropNote").textContent()) === L("st.full", { n: 2, max: 8 }), "Up to 8 songs: " + await st.locator("#dropNote").textContent());
  ok(await until(async () => (await rows("done")) === 7, 30000) && (await st.locator("#dropMore").getAttribute("aria-disabled")) === "true", "…the drop place is off while the list is full");

  ok(!errors.length, "No page errors: " + errors.join(" | "));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall OK");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
