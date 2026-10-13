// Flows 3 to 7. Called by run.js with the page already loaded.
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const probe = file => JSON.parse(execSync(`ffprobe -v error -show_entries format=duration:stream=codec_type,codec_name,width,height -of json "${file}"`).toString());
const listDir = d => fs.existsSync(d) ? fs.readdirSync(d).sort() : [];

exports.run = async (ctx, want, ok, until, sleep) => {
  const { page, host, vis, grade, tab, appReady, cover, shot, P, FIX, TOOLS, appState, L, RX, painted, sendTo } = ctx;
  const covers = () => listDir(P("Exports", "Covers"));
  const videos = () => listDir(P("Exports", "Videos"));
  const active = name => page.evaluate(n => document.querySelector("#v-" + n).classList.contains("on"), name);
  // a setting is set once app.json holds it (#setVideoFormat → settings.videoFormat)
  const saved = (sel, value) => until(() => appState().settings[sel[4].toLowerCase() + sel.slice(5)] === value, 5000, 20);
  const showSetting = async sel => {
    await tab("settings");
    const adv = await page.locator(sel).evaluate(el => { const d = el.closest("details"); return d && !d.open ? d.dataset.adv : null; });
    if (adv) await page.locator(`[data-adv="${adv}"] > summary`).click();
  };
  const setSetting = async (sel, value) => { await showSetting(sel); await page.locator(sel).selectOption(value); await saved(sel, value); await painted(page); };
  const setText = async (sel, value) => { await showSetting(sel); await page.locator(sel).fill(value); await page.locator(sel).press("Tab"); await saved(sel, value); await painted(page); };
  const status = () => vis.locator("#status").textContent();
  const fx = n => path.join(FIX, n);
  // Export opens the dialog; "Single video" is the MP4 of the whole render. codecs: [video, audio] picked in the
  // dialog's Advanced
  const exportSingle = async codecs => {
    await vis.locator("#exportBtn").click(); await until(() => vis.locator("#xDialog").isVisible());
    await vis.locator('#xMode [data-mode="single"]').click();
    if (codecs) {
      if (!(await vis.locator("#xAdv").getAttribute("open") !== null)) await vis.locator("#xAdv > summary").click();
      await vis.locator("#xVcodec").selectOption(codecs[0]); await vis.locator("#xAcodec").selectOption(codecs[1]);
    }
    await vis.locator("#xGo").click();
  };
  // "Use as default" in a tool: its defaults land in app.json → toolDefaults
  const useDefault = async (frame, id, check) => { await frame.locator("#useDefault").click(); return until(() => { const d = (appState().toolDefaults || {})[id]; return !!d && check(d); }, 5000, 20); };

  /* ================= 3: between tabs and Settings ================= */
  if (want(3)) {
    await tab("grade"); await appReady("grade");
    await grade.locator("#imgIn").setInputFiles(fx("cover.png"));
    ok(await until(async () => /cover\.png/.test(await grade.locator("#imgName").textContent())), "Grade: loads a test PNG");
    for (const tb of ["E", "F"]) {
      await grade.locator(`.ltab[data-ltab=${tb}]`).click();
      if (!(await grade.locator("#clearBtn").isDisabled())) { await grade.locator("#clearBtn").click(); await grade.locator("#clearBtn").click(); }
    }
    await grade.locator(".tab[data-tab=filters]").click();
    for (const id of ["nordic", "cine-teal", "golden-hour"]) await grade.locator(`.tile[data-look="${id}"] [data-tact=add]`).click();   // + stacks
    await until(async () => (await grade.locator("#listF .layer").count()) === 3, 5000, 20); await painted(page);
    ok((await grade.locator('.tile[data-look="nordic"]').textContent()).includes(L("lk.nordic")), "Look names are translated: " + L("lk.nordic"));
    const n = () => grade.locator("#listF .layer").count();
    ok(await n() === 3, "Grade: three stacked filters");
    await grade.locator("#stage").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await grade.locator("body").press("Control+z"); await grade.locator("body").press("Control+z");
    ok(await n() === 1, "Grade: Ctrl+Z undoes two layers");
    await grade.locator("body").press("Control+Shift+Z");
    ok(await n() === 2, "Grade: Ctrl+Shift+Z redoes");

    await grade.locator("#exportBtn").click();
    ok(await until(() => covers().includes("cover.png"), 20000), "Export image saves straight to Exports\\Covers\\cover.png ({title}.png)");
    await until(async () => !(await grade.locator("#exportBtn").isDisabled()));
    const info = probe(P("Exports", "Covers", "cover.png"));
    ok(info.streams[0].width === 3000 && info.streams[0].height === 3000, `The cover is 3000 px: ${info.streams[0].width}×${info.streams[0].height}`);
    await grade.locator("#exportBtn").click();
    ok(await until(() => covers().includes("cover (2).png"), 20000), "If it exists it is saved as «cover (2).png»");
    await until(async () => !(await grade.locator("#exportBtn").isDisabled()));
    ok(await grade.locator("#revealBtn").isVisible() && await grade.locator("#revealBtn").textContent() === L("common.reveal"), "«Show in folder» after exporting");
    await shot("3a-grade-exported");

    await sendTo(grade, "#sendBtn", "visualizer");
    ok(await until(() => active("visualizer"), 20000), "Send to… Visualizer switches to the Visualizer tab");
    ok(await until(async () => (await vis.locator("#artName").textContent()) === "cover.png", 10000), "The Visualizer receives the edited cover");
    const nat = +(await vis.locator("#artThumb").getAttribute("data-px"));   // the cover drawn, not its thumbnail
    ok(nat === 3000, "The cover arrives at 3000 px: " + nat);
    await shot("3b-visualizer-cover");
    await sendTo(vis, "#sendCoverBtn", "grade");
    ok(await until(() => active("grade"), 10000) && await until(async () => /cover\.png/.test(await grade.locator("#imgName").textContent())), "The cover's Send to… Grade takes it back to Grade");

    // each tool's own output defaults: set in the tool, kept with "Use as default"; Settings has none of them
    await tab("visualizer");
    await vis.locator("#f-format").selectOption("1080x1920"); await vis.locator("#f-quality").selectOption("high");
    ok(await useDefault(vis, "visualizer", d => d.format === "1080x1920" && d.quality === "high"), "Visualizer: «Use as default» keeps format and quality in app.json");
    await tab("grade");
    await grade.locator("#outSize").selectOption("1080"); await grade.locator("#outFmt").selectOption("jpg");
    ok(await useDefault(grade, "grade", d => d.imageSize === "1080" && d.imageFormat === "jpg"), "Grade: «Use as default» keeps size and format in app.json");
    ok(!("videoFormat" in appState().settings) && !("imageFormat" in appState().settings), "Settings holds no tool's output defaults");
    await tab("settings");
    await page.locator('input[name="saveMode"][value="ask"]').check();
    await until(() => appState().settings.saveMode === "ask", 5000, 20);
    ok(appState().settings.saveMode === "ask", "Settings: «Ask where to save»");
    await shot("3c-settings");
    const before = host.log.filter(l => l[0] === "dialog").length;
    await tab("grade");
    await grade.locator("#exportBtn").click();
    ok(await until(() => host.log.filter(l => l[0] === "dialog").length > before, 15000), "With «Ask» the save dialog opens");
    await until(async () => !(await grade.locator("#exportBtn").isDisabled()));
    await tab("settings");
    await page.locator('input[name="saveMode"][value="direct"]').check();
    await tab("visualizer");
    await vis.locator("#f-format").selectOption("1920x1080"); await vis.locator("#f-quality").selectOption("std");
    await useDefault(vis, "visualizer", d => d.format === "1920x1080" && d.quality === "std");
    await tab("grade");
    await grade.locator("#outSize").selectOption("3000"); await grade.locator("#outFmt").selectOption("png");
    await useDefault(grade, "grade", d => d.imageSize === "3000" && d.imageFormat === "png");
    await tab("library"); await page.locator('#libNav [data-tab="exports"]').click();
    await until(async () => (await page.locator("#libPanel .libv-card img:not([hidden])").count()) >= 2, 5000); await painted(page);
    ok(await page.locator("#libPanel .libv-card img:not([hidden])").count() >= 2, "Library: exports with thumbnails");
  }

  /* ================= 4: export written to disk in pieces ================= */
  if (want(4)) {
    await tab("visualizer"); await appReady("visualizer");
    await cover(fx("sky.png"));
    await vis.locator("#audIn").setInputFiles(fx("song one.wav"));
    ok(await until(async () => /song one\.wav · 0:03/.test(await vis.locator("#audName").textContent()), 15000), "Visualizer: loads a 3 s test WAV");
    ok(await vis.locator("#outFields #f-format").count() === 1 && await vis.locator(".rack #f-format").count() === 0 && await vis.locator(".monitor .export #exportBtn").count() === 1, "Output and Export are in the main column, under the cover and audio");
    ok(await vis.locator(".export").evaluate(e => getComputedStyle(e).position) !== "sticky" && await vis.locator(".rack").evaluate(r => [...r.querySelectorAll("*")].every(e => getComputedStyle(e).position !== "sticky")), "Nothing sticky over the side panel");
    // clip markers on the waveform: shown once the song's waveform is drawn
    await until(async () => await vis.locator("#markIn").isVisible() && await vis.locator("#markOut").isVisible(), 10000, 20); await painted(page);
    const sb = await vis.locator("#scrub").boundingBox();
    const drag = async (sel, f) => {
      const m = await vis.locator(sel).boundingBox();
      await page.mouse.move(m.x + m.width / 2, m.y + m.height / 2); await page.mouse.down();
      await page.mouse.move(sb.x + sb.width * f, m.y + m.height / 2, { steps: 6 }); await page.mouse.up(); await painted(ctx.vFrame());
    };
    await drag("#markIn", 1 / 3); await drag("#markOut", 2 / 3);
    ok(await vis.locator("#f-clipStart").inputValue() === "1" && await vis.locator("#f-clipLen").inputValue() === "1", "Dragging the markers sets Start and Duration: " + await vis.locator("#f-clipStart").inputValue() + " / " + await vis.locator("#f-clipLen").inputValue());
    await vis.locator("#f-clipStart").fill("0.5"); await vis.locator("#f-clipStart").dispatchEvent("input"); await painted(ctx.vFrame());
    const left = await vis.locator("#markIn").evaluate(e => parseFloat(e.style.left));
    ok(Math.abs(left - 0.5 / 3 * 100) < 0.5, "Typing a start moves the marker: " + left.toFixed(1) + " %");
    await drag("#markOut", 1.05);
    ok(await vis.locator("#f-clipLen").inputValue() === "0", "The end marker at the end means «to the end» (0)");
    await vis.locator("#f-clipStart").fill("0"); await vis.locator("#f-clipStart").dispatchEvent("input");
    await vis.locator("#f-format").selectOption("1280x720");
    await vis.locator("#f-fps").selectOption("30");
    await vis.locator("#sec-text").evaluate(d => { d.open = true; });
    if (!(await vis.locator("#f-textOn").isChecked())) await vis.locator('label[for="f-textOn"]').click();
    await vis.locator("#sec-logo").evaluate(d => { d.open = true; });
    if (!(await vis.locator("#f-logoOn").isChecked())) await vis.locator('label[for="f-logoOn"]').click();
    await painted(page);
    await shot("4a-visualizer-ready");
    await ctx.vFrame().evaluate(() => { window.__halChunkSize = 64 * 1024; });
    const logBefore = host.log.length;
    await exportSingle();
    const name = "song one.mp4";
    ok(await until(async () => RX("vis.st.videoSaved").test(await status()), 120000, 300), "Export finished: " + await status());
    ok(videos().includes(name), "Automatic name from the template «{title}.mp4»: " + videos().join(", "));
    const pr = probe(P("Exports", "Videos", name));
    const dur = +pr.format.duration, kinds = pr.streams.map(s => s.codec_type + ":" + s.codec_name);
    ok(dur > 2.5 && dur < 3.6, `ffprobe: duration ${dur.toFixed(2)} s`);
    ok(kinds.some(k => k.startsWith("video:")) && kinds.some(k => k.startsWith("audio:")), "ffprobe: video and audio (" + kinds.join(", ") + ")");
    ok(/(H\.264|VP9) \+ (AAC|Opus) · (GPU|CPU)/.test(await status()), "The status shows the codecs used: " + await status());
    ok(pr.streams.find(s => s.codec_type === "video").width === 1280, "ffprobe: 1280×720");
    const wl = host.log.slice(logBefore).filter(l => l[0] === "export_write"), pos = wl.map(l => +l[1].headers["x-pos"]);
    ok(wl.length > 5 && !host.log.slice(logBefore).some(l => l[0] === "save_file"), `The MP4 is written in pieces (${wl.length} writes of ≤64 KB)`);
    ok(pos.some((p, i) => i > 0 && p < Math.max(...pos.slice(0, i))), "The header is fixed at the end by writing at an earlier position (seek)");
    await ctx.vFrame().evaluate(() => { delete window.__halChunkSize; });
    ok(host.log.slice(logBefore).some(l => l[0] === "set_progress" && l[1].value > 0), "Progress sent to the taskbar");
    ok(host.log.slice(logBefore).some(l => l[0] === "set_progress" && l[1].value === null), "The taskbar progress is cleared at the end");
    ok(!host.log.slice(logBefore).some(l => l[0] === "notify"), "No notification while the window is in view (the island shows the end)");
    ok(await vis.locator("#saveAgain").isVisible(), "«Show in folder» after exporting");
    await shot("4b-visualizer-exported");

    // cancel halfway: the partial file is removed
    await vis.locator("#f-format").selectOption("1920x1080");
    await exportSingle();
    await until(async () => RX("vis.st.rendering").test(await status()), 30000, 50);
    await vis.locator("#cancelBtn").click();
    ok(await until(async () => (await status()) === L("vis.st.exportCancelled"), 30000), "Cancel the export");
    ok(!videos().some(v => /\(2\)/.test(v)), "The partial file is removed on cancel: " + videos().join(", "));

    await vis.locator("#f-format").selectOption("1080x1080");
    await exportSingle();
    ok(await until(() => videos().includes("song one (2).mp4") && !host.log.slice(-3).some(l => l[0] === "export_write"), 120000, 400) && await until(async () => RX("vis.st.videoSaved").test(await status()), 60000), "If it exists it is saved as «song one (2).mp4»");
    const pr2 = probe(P("Exports", "Videos", "song one (2).mp4"));
    ok(pr2.streams.find(s => s.codec_type === "video").height === 1080 && +pr2.format.duration > 2.5, "The second video (1080×1080) is valid");
    await tab("library"); await page.locator('#libNav [data-tab="exports"]').click();
    await until(async () => (await page.locator("#libPanel .libv-card", { hasText: "song one" }).count()) >= 1, 5000); await painted(page);
    ok(await page.locator("#libPanel .libv-card", { hasText: "song one" }).count() >= 1, "The video shows up in the Library's exports");
    await shot("4c-library-videos");
    await tab("visualizer");
    await vis.locator("#f-format").selectOption("1920x1080");
  }

  /* ================= 5: batches, queue and dropping several files ================= */
  if (want(5)) {
    const dropFiles = async (frame, files, target = "body") => {
      const payload = files.map(f => ({ name: path.basename(f), type: /\.png$/.test(f) ? "image/png" : "audio/wav", b64: fs.readFileSync(f).toString("base64") }));
      await frame.evaluate(({ payload, target }) => {
        const dt = new DataTransfer();
        for (const f of payload) { const bin = atob(f.b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); dt.items.add(new File([u], f.name, { type: f.type })); }
        const el = document.querySelector(target);
        el.dispatchEvent(new DragEvent("dragenter", { dataTransfer: dt, bubbles: true }));
        el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
      }, { payload, target });
    };
    const threeImages = RX("grade.batchMany", { n: 3 }), twoImages = RX("grade.batchMany", { n: 2 });

    await tab("grade"); await appReady("grade");
    const nameBefore = await grade.locator("#imgName").textContent();
    await grade.locator(".tab[data-tab=mine]").click();
    await grade.locator("#batchFiles").setInputFiles([fx("cover.png"), fx("sky.png"), fx("fractal.png")]);
    ok(threeImages.test(await grade.locator("#batchList").textContent()), "Batch: 3 images chosen");
    await grade.locator("#batchLook").selectOption("My blue");
    const before = covers().length;
    await grade.locator("#batchRun").click();
    ok(await until(async () => (await grade.locator("#batchStatus").textContent()).startsWith(L("grade.batchDone", { ok: 3, total: 3 })), 90000, 300), "Batch finished: " + await grade.locator("#batchStatus").textContent());
    ok(covers().length === before + 3 && covers().includes("sky.png") && covers().includes("fractal.png"), "Batch: three covers in Exports\\Covers");
    ok(await grade.locator("#imgName").textContent() === nameBefore, "After the batch the open image is still the same");
    ok(!host.log.some(l => l[0] === "notify" && l[1].title === L("grade.n.batchTitle")), "No batch notification while the window is in view");
    await shot("5a-grade-batch");
    try {
      await grade.locator("#batchDir").setInputFiles(FIX);
      ok(/\d/.test(await grade.locator("#batchList").textContent()), "Batch: choose a whole folder");
    } catch (e) { console.log("SKIP folder picker not supported by this Playwright version"); }
    await grade.locator("#batchClear").click().catch(() => {});

    await tab("visualizer"); await appReady("visualizer");
    await vis.locator("#f-format").selectOption("1280x720");
    await vis.locator("#queueAudio").setInputFiles([fx("song one.wav"), fx("song two.wav")]);
    ok(await vis.locator("#queueList .job").count() === 2, "Queue: two jobs added");
    await vis.locator("#queueList .job").nth(1).locator("select").selectOption("Blue wave");
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), vis.locator("#queueList .job").nth(0).locator(".jcover").click()]);
    await chooser.setFiles(fx("fractal.png"));
    ok(await until(async () => /fractal\.png/.test(await vis.locator("#queueList .job").nth(0).locator(".jcover").getAttribute("title"))), "Queue: change a job's cover");
    await shot("5b-queue");
    const vBefore = videos().length;
    await vis.locator("#queueRun").click();
    ok(await until(async () => (await vis.locator("#queueStatus").textContent()).startsWith(L("vis.q.done", { ok: 2, total: 2 })), 240000, 500), "Queue finished: " + await vis.locator("#queueStatus").textContent());
    const vNow = videos();
    ok(vNow.length === vBefore + 2 && vNow.includes("song two.mp4"), "Queue: two MP4 files in Exports\\Videos: " + vNow.join(", "));
    const two = probe(P("Exports", "Videos", "song two.mp4"));
    ok(+two.format.duration > 2.2 && +two.format.duration < 3, `Queue: the second video lasts as long as its song (${(+two.format.duration).toFixed(2)} s)`);
    ok(await vis.locator("#queueList .job.done").count() === 2, "Queue: both jobs marked as done");
    ok(!host.log.some(l => l[0] === "notify" && l[1].title === L("vis.n.queueTitle")), "No queue notification while the window is in view");
    await shot("5c-queue-done");
    await vis.locator("#queueClear").click();

    await dropFiles(ctx.vFrame(), [fx("song one.wav"), fx("song two.wav"), fx("sky.png")]);
    ok(await until(async () => (await vis.locator("#queueList .job").count()) === 2), "Dropping 2 audio files + 1 image on the Visualizer: they go to the queue");
    ok(/sky\.png/.test(await vis.locator("#queueList .job").first().locator(".jcover").getAttribute("title")), "…and the image is the cover of those jobs");
    ok(!(await vis.locator("body").evaluate(b => b.classList.contains("dragging"))), "The «drop here» overlay goes away");
    await vis.locator("#queueClear").click();
    await dropFiles(ctx.vFrame(), [fx("cover.png"), fx("fractal.png")]);
    ok(await until(() => active("grade")) && await until(async () => twoImages.test(await grade.locator("#batchList").textContent())), "Dropping 2 images on the Visualizer: they go to the Grade batch");
    await dropFiles(ctx.gFrame(), [fx("song two.wav")]);
    ok(await until(() => active("visualizer")) && await until(async () => /song two\.wav/.test(await vis.locator("#audName").textContent()), 15000), "Dropping an audio file on Grade: it opens in the Visualizer");
    await tab("library");
    await dropFiles(page.mainFrame(), [fx("fractal.png")], "#v-library");
    ok(await until(() => page.locator("#imgChoice").isVisible()), "Dropping an image on the Library asks where it goes");
    await page.locator('#imgChoice [data-to="grade"]').click();
    ok(await until(() => active("grade")) && await until(async () => /fractal\.png/.test(await grade.locator("#imgName").textContent()), 15000), "…and «Open in Grade» opens it in Grade");
    await tab("visualizer");
    await vis.locator("#f-format").selectOption("1920x1080");
  }

  /* ================= 6: «Open with» while the app is running ================= */
  if (want(6)) {
    host.openWith([fx("song two.wav"), fx("sky.png")]);
    await page.evaluate(() => { if (window.__events["open-files"]) window.__events["open-files"](); });
    // the cover is not square: the Crop dialog comes first
    ok(await until(() => page.evaluate(() => document.querySelector("#cropDlg").open), 15000), "«Open with» a picture that is not square as the cover: the Crop dialog first");
    await page.click("#cropApply");
    ok(await until(() => active("visualizer")) && await until(async () => /song two\.wav/.test(await vis.locator("#audName").textContent()) && (await vis.locator("#artName").textContent()) === "sky.png", 15000), "«Open with» song + image while running: loaded in the Visualizer");
    host.openWith([fx("fractal.png"), fx("cover.png")]);
    await page.evaluate(() => window.__events["open-files"]());
    ok(await until(() => active("grade")) && await until(async () => RX("grade.batchMany", { n: 2 }).test(await grade.locator("#batchList").textContent())), "«Open with» several images: they go to the Grade batch");
  }

  /* ================= 7: clicks on the preview, codecs, name templates, artist ================= */
  if (want(7)) {
    await tab("visualizer"); await appReady("visualizer");
    await cover(fx("sky.png"));
    await vis.locator("#audIn").setInputFiles(fx("song one.wav"));
    await until(async () => /song one\.wav/.test(await vis.locator("#audName").textContent()), 15000);
    await vis.locator("#pv").scrollIntoViewIfNeeded();
    const playLabel = () => vis.locator("#play").getAttribute("aria-label");
    const box = await vis.locator("#pv").boundingBox();
    const points = { "top-left corner": [0.02, 0.02], "top-right corner": [0.98, 0.02], "center": [0.5, 0.5], "bottom-left corner": [0.02, 0.98], "bottom-right corner": [0.98, 0.98], "bottom edge": [0.5, 0.985], "top edge": [0.5, 0.015] };
    for (const [where, [fx0, fy0]] of Object.entries(points)) {
      const was = await playLabel();
      const expect = was === L("vis.play") ? L("vis.pause") : L("vis.play");
      await vis.locator("#pv").click({ position: { x: box.width * fx0, y: box.height * fy0 } });
      ok(await until(async () => (await playLabel()) === expect, 5000), `Click on the preview (${where}) toggles playback → ${expect}`);
    }
    if ((await playLabel()) === L("vis.pause")) await vis.locator("#play").click();
    await until(async () => (await playLabel()) === L("vis.play"));
    const scrub = await vis.locator(".scrub").boundingBox();
    for (const [where, fy0] of [["lower part", 0.85], ["upper part", 0.15], ["middle", 0.5]]) {
      const fx0 = where === "lower part" ? 0.7 : where === "upper part" ? 0.3 : 0.55;
      await vis.locator(".scrub").click({ position: { x: scrub.width * fx0, y: scrub.height * fy0 } });
      await painted(ctx.vFrame());
      const v = +(await vis.locator("#seek").inputValue()), max = +(await vis.locator("#seek").getAttribute("max"));
      ok(Math.abs(v / max - fx0) < 0.08 && (await playLabel()) === L("vis.play"), `Click on the timeline (${where}) seeks to ${(v / max * 100).toFixed(0)} % without toggling playback`);
    }
    await shot("7a-click-preview");

    // name templates and artist name
    await setText("#setArtistName", "Nova");
    ok(appState().settings.artistName === "Nova", "Settings: artist name saved");
    ok(await vis.locator("#f-artist").inputValue() === "Nova", "The artist name feeds the Visualizer artist text");
    await setText("#setVideoName", "{artist} - {title}.mp4");
    ok(await page.locator("#namePreview").textContent() === L("set.namePreview", { video: `Nova - ${L("vis.defaultTitle")}.mp4`, image: `${L("vis.defaultTitle")}.png` }), "Settings: name preview follows the template");
    await setText("#setImageName", "{title} art.png");

    // codecs: the list of what this PC supports and forcing a codec
    await tab("settings");
    ok(await until(async () => (await page.locator("#codecs .codec").count()) === 5), "Settings: codec support list");
    const support = await page.locator("#codecs .codec").evaluateAll(els => els.map(e => e.classList.contains("yes")));
    const [h264gpu, h264cpu, vp9, aac, opus] = support;
    console.log(`     codecs here: H.264 GPU ${h264gpu}, H.264 CPU ${h264cpu}, VP9 ${vp9}, AAC ${aac}, Opus ${opus}`);
    await shot("7b-settings-codecs");
    await tab("visualizer");
    await vis.locator("#f-format").selectOption("1280x720");
    const expectName = `Nova - song one.mp4`;
    await exportSingle(["vp9", "opus"]);
    ok(await until(async () => RX("vis.st.videoSaved").test(await status()), 120000, 300), "Export with VP9 + Opus: " + await status());
    ok(videos().includes(expectName), `The template names the video «${expectName}»`);
    if (videos().includes(expectName)) {
      const kinds = probe(P("Exports", "Videos", expectName)).streams.map(s => s.codec_name);
      ok(kinds.includes("vp9") && kinds.includes("opus"), "ffprobe: the forced codecs were used: " + kinds.join(", "));
    }
    await exportSingle(["h264", "aac"]);
    if (h264gpu || h264cpu) {
      ok(await until(async () => RX("vis.st.videoSaved").test(await status()), 120000, 300), "Export with H.264 + AAC: " + await status());
    } else {
      const err = L("vis.st.exportFailed", { error: L("vis.err.codecMissing", { codec: L("set.codec.h264") }) });
      ok(await until(async () => (await status()) === err, 30000), "Forcing H.264 where it is missing gives a clear error: " + await status());
    }
    await until(async () => !(await vis.locator("#exportBtn").isDisabled()), 120000);
    await vis.locator("#exportBtn").click(); await until(() => vis.locator("#xDialog").isVisible());
    await vis.locator("#xVcodec").selectOption("auto"); await vis.locator("#xAcodec").selectOption("auto");
    await vis.locator('#xDialog button[value="cancel"]').click();
    await tab("settings");
    await page.locator("#setProcGpu").uncheck();
    ok(await until(() => appState().settings.processing.gpu === false, 5000, 20), "Settings: «Use the graphics card» off saved");
    await page.locator("#setProcGpu").check();
    await until(() => appState().settings.processing.gpu === true, 5000, 20);
    await setText("#setVideoName", "");
    await setText("#setImageName", "");
    ok(appState().settings.videoName === "{title}.mp4" && appState().settings.imageName === "{title}.png", "An empty template goes back to the default");

    await showSetting("#testNotify");
    await page.locator("#testNotify").click();
    ok(await until(async () => (await page.locator("#notifyResult").textContent()) === L("set.testSent")), "Test notification button reports the result");
    ok(host.log.some(l => l[0] === "notify" && l[1].title === L("set.testTitle")), "Test notification sent to the backend");
    ok(RX("set.version", { name: "Halation", version: require("../package.json").version }).test(await page.locator("#about").textContent()), "About shows the version: " + await page.locator("#about").textContent());
    await tab("visualizer");
    await vis.locator("#f-format").selectOption("1920x1080");
  }

  /* ================= 8: Upscale ================= */
  if (want(8)) {
    const up = page.frameLocator("#v-upscale"), upscaled = () => listDir(P("Exports", "Upscaled"));
    const upStatus = () => up.locator("#status").textContent();
    await tab("upscale"); await appReady("upscale");
    ok(await up.locator("#emptyStage").isVisible() && await up.locator("#runBtn").isDisabled(), "Upscale starts empty, Upscale disabled");
    ok(await up.locator("#engineBadge").textContent() === L("up.missing") && await up.locator("#installBtn").isVisible(), "No Upscayl found: «" + L("up.install") + "» is offered");
    await up.locator("#installBtn").click();
    ok(await until(async () => (await up.locator("#engineBadge").textContent()) === L("up.ready"), 30000), "The upscaler is downloaded to Documents\\Halation\\Tools");
    ok(host.log.filter(l => l[0] === "tool_install" && l[1].tool === "upscaler").length === 1 && fs.existsSync(P("Tools", "upscayl", "bin", "upscayl-bin")), "…with its binary and the four models");
    await up.locator("#imgIn").setInputFiles(fx("small.png"));
    ok(await until(async () => !(await up.locator("#runBtn").isDisabled())) && (await up.locator("#inSize").textContent()) === "96×96", "Input image with preview and size");
    await up.locator('input[name=model][value=fast]').check(); await up.locator('[data-scale="2"]').click();
    ok(await upStatus() === L("up.st.ready", { w: 192, h: 192 }), "The expected size follows the scale: " + await upStatus());
    await shot("8a-upscale-ready");
    const seen = new Set(), before = host.log.length;
    const watch = setInterval(async () => { try { seen.add(await upStatus()); } catch (e) {} }, 40);
    await up.locator("#runBtn").click();
    ok(await until(async () => (await upStatus()) === L("up.st.done", { name: "small-x2.png" }), 180000, 200), `${TOOLS.real ? "Real upscayl-bin (Vulkan on the CPU)" : "Upscaler"} finished: ` + await upStatus());
    clearInterval(watch);
    ok([...seen].some(x => RX("up.st.running").test(x)), "Progress read from the process output: " + [...seen].filter(x => RX("up.st.running").test(x)).slice(0, 4).join(" | "));
    const call = host.log.slice(before).find(l => l[0] === "proc");
    ok(call && call[1].tool === "upscaler" && call[1].args.includes("upscayl-lite-4x") && call[1].args[call[1].args.indexOf("-s") + 1] === "2", "upscayl-bin gets the model and the scale: " + (call ? call[1].args.filter(a => !a.includes("/")).join(" ") : ""));
    const pr = probe(P("Exports", "Upscaled", "small-x2.png"));
    ok(upscaled().includes("small-x2.png") && pr.streams[0].width === 192 && pr.streams[0].height === 192, "Saved to Exports\\Upscaled at 192×192");
    ok(await up.locator("#resultSize").textContent() === "192×192" && await up.locator("#sendBtn").isVisible(), "Result with «Send to…»");
    const cmp = up.locator("#cmp");
    ok(await cmp.isVisible() && (await up.locator(".cmp .lbl").allTextContents()).join("|") === L("up.before") + "|" + L("up.after"), "Finished: before / after comparator with labels");
    const clip = () => up.locator("#cmpAfter").evaluate(e => e.style.clipPath);
    ok(/inset\(0(px)? 0(px)? 0(px)? 50/.test(await clip()), "The divider starts in the middle: " + await clip());
    const cb = await cmp.boundingBox(), db = await up.locator("#cmpDiv").boundingBox();
    await page.mouse.move(db.x + db.width / 2, db.y + db.height / 2); await page.mouse.down();
    await page.mouse.move(cb.x + cb.width * 0.3, db.y + db.height / 2, { steps: 5 }); await page.mouse.up();
    ok(/inset\(0(px)? 0(px)? 0(px)? 3\d/.test(await clip()), "Dragging the divider: " + await clip());
    const tr = () => up.locator("#cmpBefore img").evaluate(e => e.style.transform), same = () => up.locator("#cmp").evaluate(c => c.querySelector("#cmpBefore img").style.transform === c.querySelector("#cmpAfter img").style.transform);
    const z0 = await up.locator("#cmpZoom").textContent();
    await page.mouse.move(cb.x + cb.width * 0.6, cb.y + cb.height * 0.5); await page.mouse.wheel(0, -600); await until(async () => (await up.locator("#cmpZoom").textContent()) !== z0, 3000, 20); await painted(page);
    ok((await up.locator("#cmpZoom").textContent()) !== z0 && /scale\((?!1\))/.test(await tr()) && await same(), "Wheel zoom, the same on both halves: " + z0 + " → " + await up.locator("#cmpZoom").textContent());
    const t1 = await tr();
    await page.mouse.move(cb.x + cb.width * 0.7, cb.y + cb.height * 0.5); await page.mouse.down(); await page.mouse.move(cb.x + cb.width * 0.6, cb.y + cb.height * 0.4, { steps: 4 }); await page.mouse.up();
    ok((await tr()) !== t1 && await same(), "Dragging pans both halves together");
    await up.locator("#cmp").dblclick({ position: { x: cb.width * 0.8, y: cb.height * 0.8 } });
    ok((await up.locator("#cmpZoom").textContent()) === z0, "Double-click fits the picture again");
    await shot("8b-upscale-done");
    await sendTo(up, "#sendBtn", "grade");
    ok(await until(() => active("grade")) && await until(async () => /small-x2\.png · 192×192/.test(await grade.locator("#imgName").textContent()), 15000), "Send to… Grade opens the upscaled image in Grade");
    await tab("upscale");
    await sendTo(up, "#sendBtn", "visualizer");
    ok(await until(() => active("visualizer")) && await until(async () => (await vis.locator("#artName").textContent()) === "small-x2.png", 15000), "Send to… Visualizer sends it as the cover");
    // Grade → Upscale
    await tab("grade");
    await sendTo(grade, "#sendBtn", "upscale");
    ok(await until(() => active("upscale")) && await until(async () => /small-x2\.png/.test(await up.locator("#inName").textContent()), 15000), "Grade's Send to… Upscale opens the edited image in Upscale");
    ok(await up.locator("#cmp").isHidden() && await up.locator("#doneList .item").count() === 1, "A new image closes the comparator; the finished job stays in the list");
    await up.locator('#doneList [data-cmp="0"]').click();
    ok(await up.locator("#cmp").isVisible() && (await up.locator("#resultSize").textContent()) === "192×192", "«Compare» on a finished job opens it again");
    // errors
    const toolEnv = TOOLS.tools.env;
    host.setToolEnv({ ...toolEnv, VK_ICD_FILENAMES: "/nonexistent-icd.json", VK_DRIVER_FILES: "/nonexistent-icd.json" });
    await up.locator("#runBtn").click();
    ok(await until(async () => (await upStatus()) === L("up.err.vulkan"), 60000), "Without a Vulkan GPU: clear error, not a silent failure");
    ok(!upscaled().some(f => /\(2\)/.test(f)), "No partial file is left after the error");
    host.setToolEnv(toolEnv);
    ok((await up.locator('input[name=model][value=sharp] ~ span').textContent()).includes(L("up.model.sharpLicense")), "Sharp shows its model's licence (non-commercial)");
    fs.unlinkSync(P("Tools", "upscayl", "models", "ultrasharp-4x.bin"));
    await up.locator('input[name=model][value=sharp]').check();
    await up.locator("#runBtn").click();
    ok(await until(async () => (await upStatus()) === L("up.err.model", { model: "ultrasharp-4x" }), 60000), "Missing model: clear error");
    await until(async () => !(await up.locator("#runBtn").isDisabled()), 60000);
    // cancel a long run
    await up.locator('input[name=model][value=fast]').check(); await up.locator('[data-scale="4"]').click();
    await up.locator("#imgIn").setInputFiles(fx("slow.png"));
    await until(async () => (await up.locator("#inName").textContent()) === "slow.png");
    await up.locator("#runBtn").click();
    const shown = await until(async () => !(await up.locator("#cancelBtn").isHidden()), 10000, 50);
    ok(shown, "The upscale shows a Cancel button while it runs");
    // cancelled once it is under way: the progress bar has moved
    await until(() => up.locator("#bar").evaluate(b => parseFloat(b.style.getPropertyValue("--v")) > 0), 10000, 20);
    await up.locator("#cancelBtn").click();
    ok(await until(async () => (await upStatus()) === L("up.st.cancelled"), 30000), "Cancel stops the upscaler");
    ok(!upscaled().some(f => f.startsWith("slow-x4")), "…and removes the unfinished file: " + upscaled().join(", "));
    await shot("8c-upscale-errors");
  }

  /* ================= 9: Downloader (yt-dlp stand-in) ================= */
  if (want(9)) {
    const dl = page.frameLocator("#v-downloader"), dlStatus = () => dl.locator("#status").textContent();
    const files = d => listDir(P("Downloads", d));
    const jobText = () => dl.locator(".job small").allTextContents();
    await tab("downloader"); await appReady("downloader");
    ok(await dl.locator("#engine").isVisible(), "No engine yet: «" + L("dl.install") + "» is offered");
    await dl.locator("#url").fill("https://www.youtube.com/watch?v=abc123"); await dl.locator("#goBtn").click();
    ok(await until(async () => (await dlStatus()) === L("dl.err.noEngine")), "Reading a link without the engine asks to download it");
    // a download that stops receiving: clear message, the button offers a retry, and the retry completes
    host.stallNext("ffmpeg");
    await dl.locator("#installBtn").click();
    ok(await until(async () => (await dl.locator("#installStatus").textContent()) === L("dl.err.install", { error: L("tools.stalled") }), 15000), "A stalled download says so: «" + L("tools.stalled") + "»");
    ok((await dl.locator("#installBtn").textContent()).trim() === L("tools.retry") && fs.existsSync(P("Tools", "yt-dlp")) && !fs.existsSync(P("Tools", "ffmpeg", "ffmpeg")), "…the button reads «" + L("tools.retry") + "»; yt-dlp is kept, FFmpeg is not half-written");
    await dl.locator("#installBtn").click();
    ok(await until(async () => await dl.locator("#engine").isHidden(), 30000) && fs.existsSync(P("Tools", "yt-dlp")) && fs.existsSync(P("Tools", "ffmpeg", "ffmpeg")), "Engine downloaded: yt-dlp and FFmpeg in Documents\\Halation\\Tools");
    // Ctrl+V with the tab active
    const vFrame = page.frames().find(f => /downloader\.html/.test(f.url()));
    await vFrame.evaluate(u => { const dt = new DataTransfer(); dt.setData("text/plain", u); document.body.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true })); }, "https://www.youtube.com/watch?v=abc123&list=PLmix");
    ok(await until(async () => await dl.locator("#preview").isVisible(), 15000), "Ctrl+V in the tab reads the link");
    ok(await dl.locator("#pTitle").textContent() === "Free Song (Official Video)" && await dl.locator("#pAuthor").textContent() === "Open Artist" && (await dl.locator("#pChips").textContent()).includes("0:07"), "Preview: title, author and duration from yt-dlp -J");
    ok(await dl.locator("#pNotice").textContent() === L("dl.playlistItem"), "A playlist link downloads only the current item");
    ok(JSON.stringify(await dl.locator("#quality option").allTextContents()) === JSON.stringify(["1080p", "720p", "360p"].map(h => L("dl.height", { h: parseInt(h) }))), "Quality list with the available heights");
    await until(async () => !!(await dl.locator("#pThumb").getAttribute("src")), 5000);
    const thumbRatio = () => dl.locator("#pThumb").evaluate(i => ({ nat: i.naturalWidth / i.naturalHeight, box: i.clientWidth / i.clientHeight, fit: getComputedStyle(i).objectFit }));
    const r1 = await thumbRatio();
    ok(Math.abs(r1.nat - r1.box) < 0.02 && r1.fit === "contain", `The preview keeps the picture's proportions (${r1.nat.toFixed(2)})`);
    await shot("9a-downloader-preview");
    const before = host.log.length;
    await dl.locator("#quality").selectOption("720");
    await dl.locator("#getVideo").click();
    await dl.locator('input[name=afmt][value=original]').check(); await dl.locator("#getAudio").click();
    await dl.locator('input[name=afmt][value=mp3]').check(); await dl.locator("#getAudio").click();
    await dl.locator("#getCover").click();
    ok(await until(async () => (await dl.locator(".job.done").count()) === 4, 60000, 250), "Queue: video, original audio, MP3 and cover downloaded: " + (await jobText()).join(" | "));
    const calls = host.log.slice(before).filter(l => l[0] === "proc").map(l => l[1].args);
    const vid = calls.find(a => a.includes("--merge-output-format"));
    ok(vid && vid[vid.indexOf("-f") + 1].includes("[height<=720][vcodec^=avc1]+ba[acodec^=mp4a]") && vid[vid.indexOf("--merge-output-format") + 1] === "mp4", "Video: H.264 + AAC preferred, merged to MP4, at most 720p");
    ok(calls.some(a => a.includes("-x") && !a.includes("--audio-format")) && calls.some(a => a.includes("--audio-format") && a[a.indexOf("--audio-format") + 1] === "mp3"), "Audio: original without re-encoding, and MP3");
    ok(calls.every(a => a.includes("--newline") && a.includes("--progress-template")), "Real progress with --newline and a progress template");
    const title = "Free Song (Official Video)";
    ok(files("Video").includes(title + ".mp4") && files("Audio").includes(title + ".opus") && files("Audio").includes(title + " (2).mp3") && files("Covers").includes(title + ".png"), "Files in Downloads\\Video, Audio and Covers with the title as name: " + [...files("Video"), ...files("Audio"), ...files("Covers")].join(", "));
    ok(probe(P("Downloads", "Covers", title + ".png")).streams[0].width === 1280 && probe(P("Downloads", "Covers", title + ".png")).streams[0].codec_name === "png", "Cover: largest thumbnail converted to PNG (1280×720)");
    // the job manager notifies only while the window is out of sight (that case: tests/processes.js)
    ok(!host.log.some(l => l[0] === "notify"), "No notification while the window is in view");
    await shot("9b-downloader-queue");
    // send to the other tabs
    await sendTo(dl, dl.locator(".job.done", { hasText: L("dl.mp3") }).locator('[data-act="send"]'), "visualizer");
    ok(await until(() => active("visualizer")) && await until(async () => (await vis.locator("#audName").textContent()).startsWith(title + " (2).mp3"), 15000), "Audio → Send to… Visualizer");
    await tab("downloader");
    await sendTo(dl, dl.locator(".job.done", { hasText: L("dl.coverPng") }).locator('[data-act="send"]'), "grade");
    ok(await until(() => active("grade")) && await until(async () => (await grade.locator("#imgName").textContent()).startsWith(title + ".png"), 15000), "Cover → Send to… Grade");
    await tab("downloader");
    await sendTo(dl, dl.locator(".job.done", { hasText: L("dl.coverPng") }).locator('[data-act="send"]'), "upscale");
    ok(await until(() => active("upscale")) && await until(async () => (await page.frameLocator("#v-upscale").locator("#inName").textContent()) === title + ".png", 15000), "Cover → Send to… Upscale");
    await tab("downloader");
    await sendTo(dl, dl.locator(".job.done", { hasText: L("dl.height", { h: 720 }) }).locator('[data-act="send"]'), "framegrab");
    ok(await until(() => active("framegrab")), "Video → Send to… Frame Grab");
    await tab("downloader");
    // cancel and retry
    await dl.locator("#url").fill("https://www.youtube.com/watch?v=slow1"); await dl.locator("#goBtn").click();
    await until(async () => (await dl.locator("#pTitle").textContent()) === title);
    await dl.locator("#getVideo").click();
    await until(async () => (await dl.locator(".job.running").count()) === 1, 10000, 50);
    // cancelled once it is under way: the progress bar has moved
    await until(() => dl.locator(".job.running .prog i").evaluate(b => parseFloat(b.style.getPropertyValue("--v")) > 0), 10000, 20);
    await dl.locator(".job.running [data-act=cancel]").click();
    ok(await until(async () => (await dl.locator(".job.cancelled").count()) === 1, 15000), "Cancel a running download");
    ok(!files("Video").some(f => /\.part$/.test(f) || f === title + " (2).mp4"), "The partial file is removed: " + files("Video").join(", "));
    await dl.locator(".job.cancelled [data-act=retry]").click();
    ok(await until(async () => (await dl.locator(".job.done").count()) === 5, 60000, 250) && files("Video").includes(title + " (2).mp4"), "Retry downloads it again");
    ok(calls.every(a => a[a.indexOf("--encoding") + 1] === "utf-8"), "yt-dlp prints the file's path in UTF-8 (--encoding utf-8)");
    // Open folder: a path that came back wrong is found by its reserved name; a file moved since opens its folder
    await dl.locator("#url").fill("https://www.youtube.com/watch?v=mangled1"); await dl.locator("#goBtn").click();
    await until(async () => (await dl.locator("#pTitle").textContent()) === title);
    await dl.locator('input[name=afmt][value=mp3]').check(); await dl.locator("#getAudio").click();
    ok(await until(async () => (await dl.locator(".job.done").count()) === 6, 30000, 250), "A download whose printed path is not the file's still finishes: " + (await jobText()).pop());
    const rev0 = host.log.length;
    await dl.locator(".job.done").last().locator('[data-act="reveal"]').click();
    ok(await until(() => host.log.slice(rev0).some(l => l[0] === "reveal_path" && l[1].path === P("Downloads", "Audio", title + " (3).mp3"))) && !(await dlStatus()), "Open folder selects the real file: " + title + " (3).mp3");
    fs.renameSync(P("Downloads", "Audio", title + " (3).mp3"), P("Downloads", "Audio", "moved.mp3"));
    const rev1 = host.log.length;
    await dl.locator(".job.done").last().locator('[data-act="reveal"]').click();
    ok(await until(() => host.log.slice(rev1).some(l => l[0] === "open_path" && l[1].path === P("Downloads", "Audio"))) && !(await dlStatus()), "…and opens its folder, without an error, when the file was moved");
    // errors in one line
    await dl.locator("#url").fill("https://www.youtube.com/watch?v=fail1"); await dl.locator("#goBtn").click();
    ok(await until(async () => (await dlStatus()) === "Video unavailable. This video is private"), "yt-dlp errors are shown in one readable line: " + await dlStatus());
    await dl.locator("#url").fill("https://example.org/unsupported"); await dl.locator("#goBtn").click();
    ok(await until(async () => (await dlStatus()) === L("dl.err.unsupported")), "Unsupported site: " + L("dl.err.unsupported"));
    // an album: its songs to choose from; the one chosen opens in the preview, and «Back to the album» returns to the list
    await dl.locator("#url").fill("https://www.youtube.com/playlist?list=PLmix"); await dl.locator("#goBtn").click();
    ok(await until(async () => await dl.locator("#album").isVisible() && (await dl.locator(".track").count()) === 2, 15000) && await dl.locator("#preview").isHidden(), "Album link: the list of its songs, without the entries that are not one");
    ok(await dl.locator("#aTitle").textContent() === "Mix" && (await dl.locator("#aChips").textContent()).includes(L("dl.album.count", { n: 2 })) && JSON.stringify(await dl.locator(".track b").allTextContents()) === JSON.stringify([title, "Private Song"]), "…name, number of songs and their titles");
    ok(await dl.locator("#aAuthor").textContent() === "Open Artist" && (await dl.locator("#aChips span").first().textContent()) === "YouTube", "…the songs' artist when the album has no uploader, and the site's name (not «YoutubeTab»)");
    ok(await until(() => dl.locator("#aCover").evaluate(i => i.complete && i.naturalWidth > 0), 10000) && host.log.some(l => l[0] === "http" && l[1] === "https://i.ytimg.com/vi/olak1/sddefault.jpg"), "…its cover from sddefault when maxresdefault does not exist");
    ok(await until(() => dl.locator(".track .tthumb").evaluateAll(l => l.every(i => i.complete && i.naturalWidth > 0)), 10000), "…each song with its thumbnail (the album's cover when it has none)");
    await dl.locator(".track").first().locator("[data-act=pick]").click();
    ok(await until(async () => await dl.locator("#preview").isVisible() && (await dl.locator("#pTitle").textContent()) === title, 15000) && await dl.locator("#album").isHidden() && await dl.locator("#backAlbum").isVisible() && await dl.locator("#pNotice").isHidden(), "Choose: the song opens with its Video, Audio and Cover options");
    ok(await dl.locator("#cVideo").isVisible() && await dl.locator("#cAudio").isVisible() && await dl.locator("#cCover").isVisible(), "…with what is available for it");
    await dl.locator("#backAlbum").click();
    ok(await until(async () => await dl.locator("#album").isVisible()) && await dl.locator("#preview").isHidden() && (await dl.locator(".track").count()) === 2, "Back to the album: the list again, without reading the link again");
    await dl.locator(".track").nth(1).locator("[data-act=pick]").click();
    ok(await until(async () => (await dlStatus()) === "Video unavailable. This video is private") && await until(async () => await dl.locator("#album").isVisible()), "A song that cannot be read says why and leaves the album open");
    // Bandcamp: read in full (its flat list has only titles); each song links to its page, not to its audio stream
    const nInfo = host.log.length;
    await dl.locator("#url").fill("https://nova.bandcamp.com/album/blue-hour-ep"); await dl.locator("#goBtn").click();
    ok(await until(async () => (await dl.locator("#aTitle").textContent()) === "Blue Hour EP" && (await dl.locator(".track").count()) === 2, 15000) && JSON.stringify(await dl.locator(".track small").allTextContents()) === JSON.stringify(["Nova · 3:00", "Nova · 3:01"]), "Bandcamp album: songs with artist and length");
    ok(host.log.slice(nInfo).some(l => l[0] === "proc" && l[1].args.includes("-J") && !l[1].args.includes("--flat-playlist")) && (await dl.locator("#aChips span").first().textContent()) === "Bandcamp", "…read without --flat-playlist; the site is «Bandcamp»");
    await dl.locator(".track").first().locator("[data-act=pick]").click();
    ok(await until(async () => (await dl.locator("#pTitle").textContent()) === "Blue Hour", 15000), "…Choose opens the song's page");
    // special covers
    const coverOf = async (url, name, w) => {
      await dl.locator("#url").fill(url); await dl.locator("#goBtn").click();
      await until(async () => await dl.locator("#preview").isVisible() && (await dl.locator("#pTitle").textContent()) === name, 15000);
      const n = await dl.locator(".job.done").count();
      await dl.locator("#getCover").click();
      await until(async () => (await dl.locator(".job.done").count()) === n + 1, 20000);
      return probe(P("Downloads", "Covers", name + ".png")).streams[0].width === w;
    };
    ok(await coverOf("https://soundcloud.com/nova/night-drive", "Night Drive", 1400) && host.log.some(l => l[0] === "http" && l[1] === "https://i1.sndcdn.com/artworks-abc123-original.jpg"), "SoundCloud: original artwork (-large → -original)");
    await until(async () => (await dl.locator("#pThumb").evaluate(i => i.complete && i.naturalWidth > 0)), 5000);
    const r2 = await thumbRatio();
    ok(Math.abs(r2.nat - r2.box) < 0.02, `…also for a square cover (${r2.nat.toFixed(2)})`);
    ok(await coverOf("https://nova.bandcamp.com/track/blue-hour", "Blue Hour", 1400) && host.log.some(l => l[0] === "http" && /a1234567890_0\.jpg$/.test(l[1])), "Bandcamp: original cover (_10 → _0)");
    ok(await coverOf("https://open.spotify.com/track/2gReenRoomNovaLia0fake", "Green Room", 640) && await dl.locator("#pNotice").textContent() === L("dl.sp.notice") && await dl.locator("#cVideo").isHidden(), "Spotify: cover through oEmbed at 640 px when its pages cannot be read (the rest: tests/spotify.js)");
    ok(await coverOf("https://music.apple.com/us/album/red-album/1440857781", "Red Album", 3000) && await dl.locator("#pNotice").textContent() === L("dl.appleDrm"), "Apple Music: artwork at 3000×3000");
    await shot("9c-downloader-done");
  }

  /* ================= 10: Settings, tools ================= */
  if (want(10)) {
    await tab("settings"); const nComp = await page.evaluate(() => window.__modules.COMPONENTS.length); await until(async () => (await page.locator("#tools .row").count()) === nComp, 5000); await painted(page);
    const rows = await page.locator("#tools .row").allTextContents();
    const upOk = fs.existsSync(P("Tools", "upscayl", "bin", "upscayl-bin"));
    ok(rows.length === nComp && rows.slice(0, 2).every(r => r.includes(L("set.tool.downloaded"))) && rows.slice(2, 4).every(r => r.includes(L(upOk ? "set.tool.downloaded" : "set.tool.missing"))) && rows.slice(4).every(r => r.includes(L("set.tool.missing"))), "Settings → Modules lists every component (Cutout, RIFE, SPAN and the Converter's engines not downloaded) and where they come from");
    await page.locator("#updateEngine").click();
    ok(await until(async () => (await page.locator("#toolsStatus").textContent()) === L("set.updated", { msg: "yt-dlp is up to date (stable@2099.01.01)" }), 20000), "«Update engine» runs yt-dlp -U: " + await page.locator("#toolsStatus").textContent());
    ok(host.log.some(l => l[0] === "proc" && l[1].tool === "ytdlp" && l[1].args[0] === "-U"), "…with -U");
    await shot("10-settings-tools");
  }

  /* ================= 11: Home ================= */
  if (want(11)) {
    await page.locator(".rail .tab.home").click(); await until(() => active("home"), 5000, 20); await painted(page);
    ok(await active("home") && (await page.locator("#pageTitle").textContent()) === L("tab.home"), "The rail logo opens Home");
    ok((await page.locator(".hcard b").allTextContents()).join("|") === ["downloader", "convert", "stems", "visualizer", "grade", "covertest", "removebg", "upscale", "interp", "framegrab", "library"].map(k => L("tab." + k)).join("|"), "Home: a card for each tool, by what it starts from");
    ok(await page.locator("#hcards .hsep").count() === 0, "Home: one row of tools, no lines between groups (those are the rail's)");
    ok(await page.locator(".hero .logo").isVisible() && (await page.locator(".hcard small").first().textContent()) === L("home.d.downloader"), "Home: logo and one-line descriptions");
    const recentDir = P("Settings", "Recent"), copies = () => listDir(recentDir);
    // audio from the Home picker → Visualizer
    await page.locator("#homeIn").setInputFiles(fx("song two.wav"));
    ok(await until(() => active("visualizer"), 10000) && await until(async () => (await vis.locator("#audName").textContent()).startsWith("song two.wav"), 15000), "A song from Home opens in the Visualizer");
    // image → small menu
    await page.keyboard.press("Control+1"); await until(() => active("home"), 5000, 20); await painted(page);
    ok(await active("home"), "Ctrl+1 goes to Home");
    await page.locator("#homeIn").setInputFiles(fx("sky.png"));
    ok(await page.locator("#homeChoice").isVisible() && (await page.locator("#homeChoiceActs [data-to]:not([data-to=cancel])").allTextContents()).map(x => x.trim()).join("|") === [L("tab.grade"), L("tab.upscale"), L("home.asCoverShort"), L("home.cutShort")].join("|"), "An image asks, inside the drop zone: Grade, Upscale, Visualizer cover or Cutout");
    await shot("11a-home-choose");
    await page.locator('#homeChoice [data-to="upscale"]').click();
    ok(await until(() => active("upscale"), 10000) && await until(async () => (await page.frameLocator("#v-upscale").locator("#inName").textContent()) === "sky.png", 10000), "…Upscale opens it in Upscale");
    // a dropped image anywhere on the main window
    await page.locator(".rail .tab.home").click(); await until(() => active("home"), 5000, 20); await painted(page);
    const b64 = fs.readFileSync(fx("fractal.png")).toString("base64");
    await page.evaluate(b64 => {
      const u = Uint8Array.from(atob(b64), c => c.charCodeAt(0)), dt = new DataTransfer();
      dt.items.add(new File([u], "fractal.png", { type: "image/png" }));
      document.querySelector("#homeDrop").dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true, clientX: 700, clientY: 600 }));
    }, b64);
    ok(await until(() => page.locator("#homeChoice").isVisible()), "Dropping one image on Home asks the same, in the drop zone");
    await page.locator('#homeChoice [data-to="grade"]').click();
    ok(await until(() => active("grade"), 10000) && await until(async () => /fractal\.png/.test(await grade.locator("#imgName").textContent()), 10000), "…Grade opens it in Grade");
    await page.locator(".rail .tab.home").click(); await until(() => active("home"), 5000, 20); await until(async () => (await page.locator("#recent .rcard").count()) >= 3, 5000); await painted(page);
    const cards = await page.locator("#recent .rcard b").allTextContents();
    ok(cards.slice(0, 3).join("|") === "fractal.png|sky.png|song two.wav", "Recent files, newest first: " + cards.slice(0, 4).join(", "));
    const tos = await page.locator("#recent .rcard .to").allTextContents();
    ok(tos[0] === L("tab.grade") && tos[1] === L("tab.upscale") && tos[2] === L("tab.visualizer"), "Each recent file shows the tab it opens in");
    ok(/url\(/.test(await page.locator("#recent .rcard .th").first().getAttribute("style") || ""), "Images have a thumbnail");
    const kept = (appState().recent || []).slice(0, 3).map(r => r.path);
    ok(kept.every(p => p.startsWith(recentDir) && fs.existsSync(p)), "Files are kept in Settings\\Recent: " + copies().join(", "));
    await shot("11b-home");
    await page.locator("#recent .rcard", { hasText: "song two.wav" }).click();
    ok(await until(() => active("visualizer"), 10000), "A recent song opens the Visualizer again");
    await page.locator(".rail .tab.home").click(); await until(() => active("home"), 5000, 20); await painted(page);
    ok((await page.locator("#recent .rcard b").first().textContent()) === "song two.wav", "…and moves to the top");
    await page.locator("#recentClear").click();
    ok(await until(() => copies().length === 0) && (await page.locator("#recent .empty").textContent()) === L("home.noRecent"), "Clear list removes the entries and their copies");
    // shortcuts
    await page.keyboard.press("?");
    ok(await page.locator("#keys").isVisible() && (await page.locator("#keysBody h3").allTextContents()).join("|") === [L("keys.general"), L("tab.visualizer"), L("tab.grade"), L("tab.upscale")].join("|"), "«?» opens the shortcuts list");
    await shot("11c-shortcuts");
    await page.keyboard.press("Escape");
    ok(await page.locator("#keys").isHidden(), "Esc closes it");
    await page.keyboard.press("Control+2"); await until(() => active("downloader"), 5000, 20); await painted(page);
    await page.frameLocator("#v-downloader").locator("#url").click();
    await page.keyboard.press("Control+5"); await until(() => active("visualizer"), 5000, 20);
    ok(await active("visualizer"), "Ctrl+5 works with the focus inside the Downloader");
    await vis.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
    await vis.locator("#play").focus(); await page.keyboard.press("?");
    ok(await page.locator("#keys").isVisible(), "«?» also works inside the Visualizer");
    await page.locator("#keysClose").click();
    await page.locator("#keysBtn").click();
    ok(await page.locator("#keys").isVisible(), "The keyboard icon in the header opens it");
    await page.keyboard.press("Escape");
  }

  /* ================= 12: Grade with many layers ================= */
  if (want(12)) {
    await tab("grade"); await appReady("grade");
    const gf = ctx.gFrame();
    await grade.locator("#imgIn").setInputFiles(fx("cover.png"));
    await until(async () => /cover\.png/.test(await grade.locator("#imgName").textContent()));
    for (const tb of ["E", "F"]) {
      await grade.locator(`.ltab[data-ltab=${tb}]`).click();
      if (!(await grade.locator("#clearBtn").isDisabled())) { await grade.locator("#clearBtn").click(); await grade.locator("#clearBtn").click(); }
    }
    await grade.locator(".tab[data-tab=filters]").click();
    const looks = await grade.locator(".tile").evaluateAll(ts => ts.slice(0, 12).map(t => t.dataset.look));
    for (const id of looks) await grade.locator(`.tile[data-look="${id}"] [data-tact=add]`).click();
    await grade.locator(".tab[data-tab=tools]").click();
    await grade.locator(".acc").evaluateAll(ds => ds.forEach(d => { d.open = true; }));
    for (let k = 0; k < 8; k++) {
      await grade.locator(".acc .tool > summary").nth(k).click();
      await grade.locator(".acc .tool[open] [data-dact=add]").click();
    }
    const rows = tb => grade.locator(`#list${tb} .layer`);
    const ids = tb => rows(tb).evaluateAll(r => r.map(x => x.dataset.id));
    await grade.locator(".ltab[data-ltab=F]").click();
    ok(await rows("F").count() === 12 && await rows("E").count() === 8 && (await grade.locator(".ltab[data-ltab=F]").textContent()).includes("(12)") && (await grade.locator(".ltab[data-ltab=E]").textContent()).includes("(8)"), "20 layers: Filters (12) and Effects (8) tabs");
    const visible = () => gf.evaluate(() => {
      const r = document.querySelector("#stage").getBoundingClientRect(), d = document.documentElement;
      return r.width > 100 && r.top >= 0 && r.bottom <= innerHeight && d.scrollHeight <= d.clientHeight + 1;
    });
    ok(await visible(), "No page scroll and the image is fully visible");
    ok(await gf.evaluate(() => { const r = document.querySelector(".rack"); return getComputedStyle(r).overflowY === "auto"; }), "The layers column scrolls on its own");
    // drag the bottom filter to the top
    const before = await ids("F"), last = rows("F").last();
    await last.scrollIntoViewIfNeeded();
    const gb = await last.locator(".grip").boundingBox(), topRow = await rows("F").first().boundingBox();
    await grade.locator(".rack").evaluate(r => { r.scrollTop = 0; });
    const gb2 = await last.locator(".grip").boundingBox();
    await page.mouse.move(gb2.x + gb2.width / 2, gb2.y + gb2.height / 2); await page.mouse.down();
    await page.mouse.move(gb2.x + gb2.width / 2, topRow.y + 4, { steps: 12 }); await page.mouse.up(); await painted(gf);
    const after = await ids("F");
    ok(after[0] === before[before.length - 1] && after.length === 12, "Dragging the grip moves a layer to the top");
    void gb;
    // keyboard reorder
    await rows("F").first().locator(".grip").focus(); await page.keyboard.press("ArrowDown"); await painted(gf);
    ok((await ids("F"))[1] === after[0], "Arrow keys on the grip move a layer");
    // hide one
    await rows("F").nth(2).locator("[data-act=eye]").click();
    ok(await rows("F").nth(2).evaluate(r => r.classList.contains("off")), "The eye hides a layer");
    // select several and delete them
    await rows("F").nth(3).locator(".lname").click({ modifiers: ["Control"] });
    await rows("F").nth(6).locator(".lname").click({ modifiers: ["Shift"] });
    ok((await grade.locator("#selCount").textContent()) === L("grade.sel.count", { n: 4 }), "Ctrl+click and Shift+click select 4 layers");
    await shot("12a-grade-selection");
    await grade.locator("#selDel").click();
    ok(await rows("F").count() === 8, "Delete removes the 4 selected layers");
    await grade.locator("#undoBtn").click();
    ok(await rows("F").count() === 12, "Undo brings them back");
    await grade.locator("#redoBtn").click();
    ok(await rows("F").count() === 8, "Redo removes them again");
    // effects: hide three at once, one open at a time, duplicate from the menu
    await grade.locator(".ltab[data-ltab=E]").click();
    for (const k of [0, 1, 2]) await rows("E").nth(k).locator(".lname").click({ modifiers: ["Control"] });
    await grade.locator("#selHide").click();
    ok(await rows("E").evaluateAll(r => r.filter(x => x.classList.contains("off")).length) === 3, "Hide acts on the selected effects");
    await rows("E").nth(4).locator(".lname").click();
    await rows("E").nth(5).locator(".lname").click();
    ok(await grade.locator("#listE .lparams").count() === 1 && await rows("E").nth(5).locator(".lparams").count() === 1, "Clicking a layer opens its settings, one at a time");
    await rows("E").nth(0).locator("[data-act=more]").click();
    await grade.locator('#lmenu [data-m="dup"]').click();
    ok(await rows("E").count() === 9, "⋯ → Duplicate");
    // the intensity on the row
    const pct = rows("E").nth(5).locator("[data-act=pct]"), pb = await pct.boundingBox();
    await page.mouse.move(pb.x + pb.width / 2, pb.y + pb.height / 2); await page.mouse.down(); await page.mouse.move(pb.x + pb.width / 2 - 40, pb.y + pb.height / 2, { steps: 5 }); await page.mouse.up();
    ok((await pct.textContent()) === "80 %", "Dragging on the % changes the intensity: " + await pct.textContent());
    ok(await visible(), "The image is still fully visible");
    await shot("12b-grade-layers");
  }
};
