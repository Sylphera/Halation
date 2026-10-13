// Converter (convert.js, convert.rs; host.js replicates the commands) used as a user would:
// 1. Empty: the drop zone. A PNG with alpha from the file dialog, no FFmpeg: its type, the outputs without PNG, JPG
//    says "Transparency becomes white"; Convert → Exports\Converted\<name>.jpg, sizes before → after, no .part.
// 2. A WAV without FFmpeg: "Needs FFmpeg", Convert off; Install → the outputs come without restarting; MP3 → libmp3lame.
// 3. A .mp3 that is a WAV says so; an MKV (H.264 + AAC) → MP4 copies the streams (same video packets).
// 4. Another tool and back: the file, the choice and the result are still there; Open folder; Send to… Frame Capture.
// 5. Next to the original with a name taken: "<name> (2).jpg", the original untouched.
// 6. An FFmpeg without libvorbis: OGG is hidden and nothing else.
// 7. A folder (batch): groups per class, Convert all; one image failing is red with its reason, the rest done; the
//    folder's structure is kept in Exports\Converted.
// 8. Cancel during a long re-encode: cancelled, no .part left, the button back.
// 9. A dropped file (no path): converted from its copy into Exports\Converted.
// 10. Documents: Markdown → PDF needs Pandoc + LibreOffice (both installed from the card), then DOCX (no "Send to"); a
//    CSV → XLSX; a PDF of two pages needs PDFium → a folder with one PNG per page.
// Screenshots → $SHOTS/convert. Usage: node app/tests/convert.js
const fs = require("fs"), os = require("os"), path = require("path"), { execSync } = require("child_process");
const { until, painted, serve, launch, openApp, locale } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "convert");
fs.mkdirSync(SHOTS, { recursive: true });
const FX = makeFixtures(), TOOLS = toolOptions(FX), { L } = locale("en");
const host = createHost(fs.mkdtempSync(path.join(FX.TMP, "convert-")), TOOLS);
fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en" } }));
const P = (...p) => path.join(host.base, ...p);
const sh = c => execSync(c).toString().trim();
const codecOf = (f, s = "a:0") => sh(`ffprobe -v error -select_streams ${s} -show_entries stream=codec_name -of csv=p=0 "${f}"`);
const md5 = (f, s) => sh(`ffmpeg -v error -i "${f}" -map 0:${s} -c copy -f md5 -`);
const IN = fs.mkdtempSync(path.join(FX.TMP, "convert-in-"));
const F = n => path.join(IN, n);
const ff = c => execSync(`ffmpeg -v error ${c}`);
// a 40×20 PNG, half opaque red and half transparent; a WAV; a WAV named .mp3; an MKV with H.264 + AAC; a long video
ff(`-f lavfi -i "color=red:s=20x20,format=rgba" -f lavfi -i "color=black@0:s=20x20,format=rgba" -filter_complex hstack -frames:v 1 -y "${F("logo.png")}"`);
ff(`-f lavfi -i "sine=f=440:d=2" -c:a pcm_s16le -y "${F("tone.wav")}"`);
fs.copyFileSync(F("tone.wav"), F("liar.mp3"));
ff(`-f lavfi -i testsrc=size=320x180:rate=25:d=2 -f lavfi -i "sine=f=330:d=2" -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest -y "${F("clip.mkv")}"`);
ff(`-f lavfi -i testsrc2=size=1280x720:rate=30:d=40 -c:v libx264 -preset ultrafast -pix_fmt yuv420p -y "${F("long.mp4")}"`);
const DIR = path.join(IN, "Trip"); fs.mkdirSync(path.join(DIR, "Day 1"), { recursive: true });
ff(`-f lavfi -i "sine=f=200:d=1" -y "${path.join(DIR, "a.wav")}"`);
ff(`-f lavfi -i "sine=f=300:d=1" -y "${path.join(DIR, "Day 1", "b.wav")}"`);
ff(`-f lavfi -i "color=blue:s=16x16" -frames:v 1 -y "${path.join(DIR, "Day 1", "c.png")}"`);
ff(`-f lavfi -i "color=green:s=16x16" -frames:v 1 -y "${path.join(DIR, "d.png")}"`);
fs.writeFileSync(path.join(DIR, "notes.txt"), "not media");
// documents: Markdown, CSV, a PDF of two pages (written by hand), LibreOffice behind a script as its install copies it
fs.writeFileSync(F("notes.md"), "# Notes\n\nSome *text* and a list:\n\n- one\n- two\n");
fs.writeFileSync(F("sheet.csv"), "name,n\nä,1\nb,2\n");
const pdf = pages => {
  const objs = ["<< /Type /Catalog /Pages 2 0 R >>", `<< /Type /Pages /Kids [${pages.map((_, i) => `${3 + i * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`];
  pages.forEach((t, i) => { const c = `BT /F1 24 Tf 72 720 Td (${t}) Tj ET`; objs.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents ${4 + i * 2} 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> >>`, `<< /Length ${c.length} >>\nstream\n${c}\nendstream`); });
  let out = "%PDF-1.4\n"; const at = [];
  objs.forEach((o, i) => { at.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const x = out.length; out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + at.map(n => String(n).padStart(10, "0") + " 00000 n \n").join("") + `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return out;
};
fs.writeFileSync(F("two.pdf"), pdf(["Page one", "Page two"]));
fs.writeFileSync(F("soffice.sh"), "#!/bin/sh\nexec soffice \"$@\"\n"); fs.chmodSync(F("soffice.sh"), 0o755);
fs.writeFileSync(F("libpdfium.so"), "stand-in");
Object.assign(TOOLS.tools, { pandocSource: execSync("command -v pandoc").toString().trim(), libreofficeSource: F("soffice.sh"), pdfiumSource: F("libpdfium.so") });

(async () => {
  const server = serve(), browser = await launch();
  const { page, errors, tab, appReady, sendTo } = await openApp(browser, server, host, { width: 1280, height: 860 });
  const cv = page.frameLocator("#v-convert"), fr = () => page.frames().find(f => /convert\.html/.test(f.url()));
  const shot = n => process.argv.includes("--functional") ? painted(page) : painted(page).then(() => page.screenshot({ path: path.join(SHOTS, n + ".png") }));
  const status = () => cv.locator("#status").textContent();
  const options = () => cv.locator('#choices input[name="to"]').evaluateAll(o => o.map(x => x.value));
  // Convert to: a row of the list (a video's audio outputs are folded under Audio only)
  const to = async v => { const row = cv.locator(`#choices label.out:has(input[value="${v}"])`); if (!(await row.isVisible())) await cv.locator("#choices details.more summary").click(); await row.click(); };
  const chosen = () => cv.locator('#choices input[name="to"]:checked').inputValue();
  const conv = (...p) => path.join(P("Exports", "Converted"), ...p);
  const parts = d => fs.existsSync(d) ? fs.readdirSync(d, { recursive: true }).filter(f => /\.part$/.test(f)) : [];
  const pick = async (files, btn = "#browseBtn") => {
    TOOLS.tools.convertFiles = files;
    await cv.locator(btn).click();
    return until(async () => (await fr().evaluate(() => window.__convert.C.items.length)) > 0 && await fr().evaluate(() => window.__convert.C.items.every(i => i.state !== "probing")), 15000);
  };
  const change = async files => { TOOLS.tools.convertFiles = files; await cv.locator("#changeBtn").click(); await until(async () => (await cv.locator("#oneName").textContent()) === path.basename(files[0]) && await fr().evaluate(() => window.__convert.C.items.every(i => i.state !== "probing")), 15000); };
  const convertAndWait = async (ms = 30000) => { await cv.locator("#convertBtn").click(); return until(async () => /^Saved|converted|Could not|Cancelled/.test(await status()) && await fr().evaluate(() => !window.__convert.C.live.size), ms); };

  // 1. a picture without FFmpeg
  await tab("convert"); await appReady("convert");
  ok(await cv.locator("#empty").isVisible() && (await cv.locator("#drop > b").textContent()) === L("cv.empty.title"), "Empty: the drop zone says Drop any file");
  ok(JSON.stringify(await cv.locator("#kinds .kind b").allTextContents()) === JSON.stringify(["video", "audio", "image", "docs", "office", "pdf"].map(k => L("cv.kind." + k))), "…and a button per kind of file under it");
  TOOLS.tools.convertFiles = [];
  await cv.locator('#kinds [data-kind="video"]').click();
  ok(await until(() => host.log.some(([k, f, kind]) => k === "convert-pick" && !f && kind === "video"), 3000), "Video: the dialog opens filtered to videos");
  await shot("1-empty");
  ok(await pick([F("logo.png")]), "A PNG from the file dialog is read");
  ok((await cv.locator("#oneName").textContent()) === "logo.png" && /^Image · PNG/.test(await cv.locator("#oneType").textContent()), "…its name and type: " + await cv.locator("#oneType").textContent());
  ok(JSON.stringify(await options()) === JSON.stringify(["jpg", "webp", "tiff", "bmp", "ico", "gif"]), "…the outputs are the table's, without PNG itself: " + (await options()).join(","));
  ok(await cv.locator("#preview img").isVisible() && await cv.locator("#stage").isVisible(), "…the picture in the preview, the panel beside it");
  ok(await cv.locator("#choices .rec").count() === 1 && await cv.locator('#choices label.out:first-child .rec').count() === 1, "…the recommended output first, with its badge");
  await to("jpg");
  ok((await cv.locator("#conseq").textContent()) === L("cv.note.white"), "JPG: \"Transparency becomes white\"");
  ok(!(await cv.locator("#convertBtn").isDisabled()) && await cv.locator("#need").isHidden(), "Images convert without FFmpeg");
  await shot("2-png");
  ok(await convertAndWait(), "Convert ends: " + await status());
  ok(fs.existsSync(conv("logo.jpg")) && /mjpeg/.test(codecOf(conv("logo.jpg"), "v:0")), "→ Exports\\Converted\\logo.jpg");
  ok(!parts(P("Exports")).length, "…no .part left");
  ok(await cv.locator("#done").isVisible() && /→/.test(await cv.locator("#sizes").textContent()), "The result: sizes before → after (" + await cv.locator("#sizes").textContent() + ")");
  await shot("3-done");

  // 2. audio without FFmpeg: the install, then the outputs
  await change([F("tone.wav")]);
  ok(await cv.locator("#need").isVisible() && await cv.locator("#convertBtn").isDisabled(), "A WAV without FFmpeg: Needs FFmpeg, Convert off");
  await shot("4-needs-ffmpeg");
  await cv.locator("#installBtn").click();
  ok(await until(async () => await cv.locator("#need").isHidden() && !(await cv.locator("#convertBtn").isDisabled()), 30000), "Install: FFmpeg downloaded, Convert on without restarting");
  ok(/^Audio · WAV · PCM · 44\.1 kHz/.test(await cv.locator("#oneType").textContent()), "…the type now has its detail: " + await cv.locator("#oneType").textContent());
  ok(JSON.stringify(await options()) === JSON.stringify(["mp3", "m4a", "flac", "ogg", "opus", "aiff"]), "…its outputs: " + (await options()).join(","));
  ok(await until(() => cv.locator("#preview .player .wave").isVisible(), 5000) && await until(async () => /^0:00 \/ 0:02$/.test(await cv.locator("#preview .player .time").textContent()), 5000), "…its player in the preview, the waveform and the length: " + await cv.locator("#preview .player .time").textContent());
  const wave = await cv.locator("#preview .player .wave").boundingBox();
  await page.mouse.click(wave.x + wave.width / 2, wave.y + wave.height / 2);
  ok(await until(async () => /^0:01 \/ 0:02$/.test(await cv.locator("#preview .player .time").textContent()), 3000), "…a click halfway along the waveform goes there: " + await cv.locator("#preview .player .time").textContent());
  await shot("4b-audio");
  await to("mp3");
  ok(await convertAndWait(), "MP3: " + await status());
  ok(fs.existsSync(conv("tone.mp3")) && codecOf(conv("tone.mp3")) === "mp3", "→ tone.mp3 in MP3");
  const progressed = host.log.some(([k, v]) => k === "proc" && v.args.includes("-progress"));
  ok(progressed, "FFmpeg runs as a job with -progress (the real %)");

  // 3. content over extension; a copy
  await change([F("liar.mp3")]);
  ok(/WAV \(named \.mp3\)/.test(await cv.locator("#oneType").textContent()), "A .mp3 that is a WAV says so: " + await cv.locator("#oneType").textContent());
  ok((await options()).includes("mp3"), "…and MP3 is offered (it is not one)");
  await change([F("clip.mkv")]);
  ok(/^Video · MKV · H\.264 \+ AAC · 320×180 · 0:02/.test(await cv.locator("#oneType").textContent()), "MKV: " + await cv.locator("#oneType").textContent());
  ok((await chosen()) === "mp4" && (await cv.locator("#conseq").textContent()) === L("cv.note.copy"), "MP4 recommended: \"Copies streams · no quality loss\"");
  ok((await cv.locator("#choices details.more summary").textContent()) === L("cv.audioOnly") && await cv.locator('#choices details.more input[value="a:mp3"]').count() === 1 && await cv.locator('#choices details.more input[value="a:mp3"]').isHidden(), "The audio outputs folded under \"Audio only\"");
  ok(await until(() => cv.locator("#preview img").isVisible(), 5000), "…an MKV shows its first frame");
  ok(await convertAndWait(), "MKV → MP4: " + await status());
  ok(fs.existsSync(conv("clip.mp4")) && md5(conv("clip.mp4"), "v:0") === md5(F("clip.mkv"), "v:0"), "…the video packets are the same (copied, not re-encoded)");
  const lib = await page.evaluate(p => { const x = window.__shell.library.get(p); return x && x.origin && x.origin.tool; }, conv("clip.mp4")).catch(() => null);
  ok(await until(async () => (await page.evaluate(p => { const x = window.__shell.library.get(p); return !!x; }, conv("clip.mp4"))), 5000) || lib, "…and it is in the Library");

  // 4. away and back; Open folder; Send to
  await tab("grade"); await tab("convert");
  ok((await cv.locator("#oneName").textContent()) === "clip.mkv" && await cv.locator("#done").isVisible(), "Another tool and back: the file and the result are still there");
  await cv.locator("#revealBtn").click();
  ok(await until(() => host.log.some(([k, p]) => k === "convert-reveal" && p === conv("clip.mp4")), 3000), "Open folder shows the output");
  await sendTo(cv, "#sendBtn", "framegrab");
  ok(await until(() => page.evaluate(() => document.querySelector("#v-framegrab").classList.contains("on")), 10000), "Send to… Frame Capture opens it there");
  await tab("convert");

  // 5. next to the original, a name taken
  fs.writeFileSync(F("logo.jpg"), "taken");
  await change([F("logo.png")]);
  await cv.locator("#dest").selectOption("beside");
  await to("jpg");
  ok(await convertAndWait(), "Next to the original: " + await status());
  ok(fs.existsSync(F("logo (2).jpg")) && fs.readFileSync(F("logo.jpg"), "utf8") === "taken" && fs.existsSync(F("logo.png")), "…logo (2).jpg beside it; the file there and the original untouched");
  ok((JSON.parse(fs.readFileSync(P("Settings", "app.json"), "utf8")).converter || {}).dest === "beside", "Save to is remembered");
  await cv.locator("#dest").selectOption("exports");

  // 6. an FFmpeg without libvorbis
  TOOLS.tools.encodersMissing = ["libvorbis"];
  await change([F("tone.wav")]);
  ok(JSON.stringify(await options()) === JSON.stringify(["mp3", "m4a", "flac", "opus", "aiff"]), "FFmpeg without libvorbis: only OGG is hidden");
  TOOLS.tools.encodersMissing = [];

  // 7. a folder
  await fr().evaluate(() => { window.__convert.C.items = []; window.__convert.render(); });
  TOOLS.tools.convertFolder = DIR;
  await cv.locator("#folderBtn").click();
  ok(await until(async () => (await fr().evaluate(() => window.__convert.C.items.length)) === 5 && await fr().evaluate(() => window.__convert.C.items.every(i => i.state !== "probing")), 15000), "A folder: its five files");
  const groups = await cv.locator(".group h3").allTextContents();
  ok(groups.length === 3 && /^Audio/.test(groups[0]) && /^Images/.test(groups[1]) && /^Not convertible/.test(groups[2]), "…grouped by class: " + groups.join(" | "));
  ok(await until(async () => (await cv.locator("#convertBtn").textContent()).trim() === L("cv.convertAll", { n: 4 }), 3000), "…" + (await cv.locator("#convertBtn").textContent()).trim());
  ok(await cv.locator("#preview").isHidden() && await cv.locator("#batch").isVisible() && await cv.locator("#choices .gchoice").count() === 2, "…the list on the left, a choice per group on the right");
  await cv.locator('#choices label.out:has(input[data-group="image"][value="webp"])').click();
  await shot("5-batch");
  // one picture fails (the image engine says why); the others go on
  TOOLS.tools.convertImageFail = { name: "d.png", error: "broken picture" };
  ok(await convertAndWait(60000), "Convert all: " + await status());
  TOOLS.tools.convertImageFail = null;
  const states = await fr().evaluate(() => window.__convert.C.items.map(i => i.name + ":" + i.state));
  ok(states.filter(s => s.endsWith(":done")).length === 3 && states.includes("d.png:failed"), "One failing, the rest done: " + states.join(", "));
  ok(await cv.locator(".files li.failed .err").count() === 1, "…the failed one is red with its reason: " + await cv.locator(".files li.failed .err").textContent().catch(() => ""));
  ok(fs.existsSync(conv("Trip", "a.mp3")) && fs.existsSync(conv("Trip", "Day 1", "b.mp3")) && fs.existsSync(conv("Trip", "Day 1", "c.webp")), "…the folder's structure kept in Exports\\Converted");
  await shot("6-batch-done");

  // 8. cancel
  await fr().evaluate(() => { window.__convert.C.items = []; window.__convert.render(); });
  await pick([F("long.mp4")]);
  ok(await until(() => cv.locator("#preview video").isVisible(), 5000), "An MP4 plays in the preview");
  await to("webm");
  ok((await cv.locator("#conseq").textContent()) === L("cv.note.reencode"), "WEBM: \"Re-encodes video (slow)\"");
  await cv.locator("#convertBtn").click();
  ok(await until(async () => await cv.locator("#cancelBtn").isVisible() && /Converting/.test(await cv.locator("#convertLabel").textContent()), 20000), "Converting: the progress in the button, and Cancel");
  ok(await until(() => fr().evaluate(() => +document.querySelector("#bar").dataset.v > 0), 20000), "…its fill moves");
  await shot("7-converting");
  await cv.locator("#cancelBtn").click();
  ok(await until(async () => (await status()) === L("cv.st.cancelled"), 15000), "Cancel: " + await status());
  ok(await until(() => !parts(P("Exports")).length && !fs.existsSync(conv("long.webm")), 5000), "…no .part and no output left");
  ok(await cv.locator("#cancelBtn").isHidden() && !(await cv.locator("#convertBtn").isDisabled()), "…Convert is back");

  // 9. a dropped file (no path): its copy is converted
  await fr().evaluate(() => { window.__convert.C.items = []; window.__convert.render(); });
  await cv.locator("#fileIn").setInputFiles(F("tone.wav"));
  ok(await until(async () => (await fr().evaluate(() => window.__convert.C.items.length === 1 && window.__convert.C.items[0].state === "ready")), 15000), "A dropped WAV is read from its copy");
  await cv.locator("#dest").selectOption("beside");
  await to("flac");
  ok(await convertAndWait(), "…converted: " + await status());
  ok(fs.existsSync(conv("tone.flac")), "…into Exports\\Converted (it has no folder of its own)");
  await cv.locator("#dest").selectOption("exports");

  // 10. documents
  await fr().evaluate(() => { window.__convert.C.items = []; window.__convert.render(); });
  await pick([F("notes.md")]);
  ok(/^Text document · Markdown/.test(await cv.locator("#oneType").textContent()), "Markdown: " + await cv.locator("#oneType").textContent());
  ok(JSON.stringify(await options()) === JSON.stringify(["pdf", "html", "docx", "odt", "epub"]) && (await chosen()) === "pdf", "…its outputs, PDF recommended: " + (await options()).join(","));
  ok(await cv.locator("#preview .icon").isVisible(), "…a document's preview is its icon and data");
  ok(await cv.locator("#need").isVisible() && /^Needs Pandoc \+ LibreOffice · about 400 MB/.test(await cv.locator("#needNote").textContent()) && await cv.locator("#convertBtn").isDisabled(), "PDF: " + await cv.locator("#needNote").textContent());
  ok((await cv.locator("#conseq").textContent()) === L("cv.note.structure"), "…\"" + L("cv.note.structure") + "\"");
  await shot("8-needs-engines");
  await cv.locator("#installBtn").click();
  ok(await until(async () => await cv.locator("#need").isHidden() && !(await cv.locator("#convertBtn").isDisabled()), 30000), "Install: Pandoc and LibreOffice, one after the other, Convert on");
  ok(await convertAndWait(120000), "Markdown → PDF: " + await status());
  ok(fs.existsSync(conv("notes.pdf")) && fs.readFileSync(conv("notes.pdf")).slice(0, 4).toString() === "%PDF", "→ notes.pdf, a PDF");
  const st = host.log.filter(([k, v]) => k === "proc" && ["pandoc", "soffice"].includes(v.tool)).map(([, v]) => v.tool);
  ok(st.join(",") === "pandoc,soffice", "…Pandoc (to DOCX), then LibreOffice, as the job's processes: " + st.join(","));
  ok(!parts(P("Exports")).length, "…no .part left");
  await to("docx");
  ok(await convertAndWait(60000), "Markdown → DOCX: " + await status());
  ok(fs.existsSync(conv("notes.docx")) && execSync(`unzip -l "${conv("notes.docx")}"`).toString().includes("word/document.xml"), "→ notes.docx");
  ok(await cv.locator("#done").isVisible() && await cv.locator("#sendBtn").isHidden(), "A document: Open folder, no Send to");
  await change([F("sheet.csv")]);
  ok(JSON.stringify(await options()) === JSON.stringify(["pdf", "xlsx", "ods"]), "CSV: " + (await options()).join(","));
  await to("xlsx");
  ok(await convertAndWait(120000), "CSV → XLSX: " + await status());
  ok(fs.existsSync(conv("sheet.xlsx")) && execSync(`unzip -l "${conv("sheet.xlsx")}"`).toString().includes("xl/workbook.xml"), "→ sheet.xlsx");
  await change([F("two.pdf")]);
  ok(await cv.locator("#need").isVisible() && /^Needs PDFium/.test(await cv.locator("#needNote").textContent()), "A PDF: " + await cv.locator("#needNote").textContent());
  await cv.locator("#installBtn").click();
  ok(await until(async () => / · 2 pages/.test(await cv.locator("#oneType").textContent()) && !(await cv.locator("#convertBtn").isDisabled()), 30000), "PDFium installed: " + await cv.locator("#oneType").textContent());
  ok(JSON.stringify(await options()) === JSON.stringify(["png", "jpg"]) && (await cv.locator("#conseq").textContent()) === L("cv.note.pages"), "…PNG or JPG, one picture per page");
  ok(await until(() => cv.locator("#preview img.page").isVisible(), 10000), "…its first page in the preview");
  await shot("9-pdf");
  ok(await convertAndWait(60000), "PDF → PNG: " + await status());
  const pngs = fs.existsSync(conv("two")) ? fs.readdirSync(conv("two")).sort() : [];
  ok(pngs.join(",") === "two-001.png,two-002.png", "→ the folder two with two-001.png, two-002.png: " + pngs.join(","));
  ok(/^2 pages · /.test(await cv.locator("#sizes").textContent()) && await cv.locator("#sendBtn").isVisible(), "…" + await cv.locator("#sizes").textContent() + ", Send to the first page");
  await shot("10-pdf-done");

  ok(!errors.length, "No page errors" + (errors.length ? ": " + errors.join(" / ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `${failures} FAILED` : "ALL OK");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
