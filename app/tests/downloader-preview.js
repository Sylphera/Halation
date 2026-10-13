// The Downloader's album selection with the Halation Preview fixture (dist/dev/downloader-fixture.js), without internet
// and without the engine:
// 1. Outside Preview the fixture is never requested and nothing of it shows.
// 2. In Preview (window.__halPreview): the simulated links; an album with all its songs selected, select all / none,
//    single songs, a long list that scrolls inside the card, the selection added to the queue as audio, video and
//    cover, each song's state (waiting, %, saved, failed, cancelled), «Choose» and «Back to the album», a Spotify
//    album (no video, one cover) and a link that fails. Screenshots → $SHOTS/downloader-preview.
// Usage: node app/tests/downloader-preview.js
const fs = require("fs");
const os = require("os");
const path = require("path");
const { until, painted, locale, serve, launch, openApp } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "downloader-preview");
fs.mkdirSync(SHOTS, { recursive: true });
const { L } = locale("en");
const FX = makeFixtures(), TOOLS = toolOptions(FX);
const newHost = () => {
  const h = createHost(fs.mkdtempSync(path.join(FX.TMP, "dlprev-")), { tools: TOOLS.tools });
  fs.writeFileSync(path.join(h.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en" } }));
  return h;
};

(async () => {
  const server = serve(), browser = await launch();
  /* ---------- 1. outside Preview ---------- */
  {
    const reqs = [], host = newHost();
    const app = await openApp(browser, server, host, { onRequest: u => reqs.push(u) });
    await app.tab("downloader"); await app.appReady("downloader");
    const dl = app.page.frameLocator("#v-downloader");
    ok(await dl.locator(".devbar").count() === 0 && !reqs.some(u => /downloader-fixture/.test(u)), "Outside Preview the simulation is not loaded");
    await app.page.close();
  }
  /* ---------- 2. in Preview ---------- */
  const host = newHost(), P = (...p) => path.join(host.base, ...p);
  const app = await openApp(browser, server, host, { width: 1280, height: 900, init: () => { if (window === window.top) window.__halPreview = { missing() {} }; } });
  const { page: pg, errors } = app;
  await app.tab("downloader"); await app.appReady("downloader");
  const dl = pg.frameLocator("#v-downloader"), shot = n => pg.screenshot({ path: path.join(SHOTS, n) });
  const fr = () => pg.frames().find(f => /downloader\.html/.test(f.url()));
  const tracks = () => dl.locator(".track"), count = () => dl.locator("#selCount").textContent();
  const link = label => dl.locator(".devbar [data-link]", { hasText: label }).click();
  const state = k => tracks().nth(k).locator(".tstate").textContent();
  ok(await until(() => dl.locator(".devbar").isVisible(), 10000) && await dl.locator("#engine").isVisible(), "Preview: the simulated links show, with no engine installed");
  await link("Album · 14 songs");
  ok(await until(async () => await dl.locator("#album").isVisible() && (await tracks().count()) === 14, 10000) && await dl.locator("#aTitle").textContent() === "Night Drive Tapes", "Album: 14 songs");
  ok(await count() === L("dl.album.selected", { n: 14, total: 14 }) && await dl.locator("#selAll").isChecked() && (await dl.locator("#addSel").textContent()).trim() === L("dl.album.add", { n: 14 }), "All songs selected at first; «" + L("dl.album.add", { n: 14 }) + "»");
  ok(await until(() => dl.locator(".track .tthumb").evaluateAll(l => l.every(i => i.complete && i.naturalWidth > 0)), 10000), "Each song with its thumbnail");
  await shot("1-album.png");
  await dl.locator("#selAll").uncheck();
  ok(await count() === L("dl.album.selected", { n: 0, total: 14 }) && await dl.locator("#addSel").isDisabled() && (await dl.locator(".track.on").count()) === 0, "Select all off: nothing selected, the button is off");
  await tracks().nth(0).locator("b").click(); await tracks().nth(2).locator("input").check();
  ok(await count() === L("dl.album.selected", { n: 2, total: 14 }) && await dl.locator("#selAll").evaluate(e => e.indeterminate) && (await dl.locator(".track.on").count()) === 2, "A click on a row or on its box selects that song; select all shows a part selected");
  await tracks().nth(0).click();
  ok(await count() === L("dl.album.selected", { n: 1, total: 14 }), "…and a second click unselects it");
  await dl.locator("#selAll").check();
  ok(await count() === L("dl.album.selected", { n: 14, total: 14 }), "Select all again");
  // long list
  await link("Long album · 48");
  ok(await until(async () => (await tracks().count()) === 48, 10000), "Long album: 48 songs");
  const sc = await dl.locator("#tracks").evaluate(e => ({ s: e.scrollHeight, c: e.clientHeight }));
  ok(sc.s > sc.c * 2, `The list scrolls inside the card (${sc.c} of ${sc.s} px)`);
  await dl.locator("#tracks").evaluate(e => { e.scrollTop = e.scrollHeight; });
  ok(await dl.locator("#addSel").isVisible(), "…and «Add to queue» stays in view");
  await shot("2-long.png");
  // downloads with every state
  await link("Album · 14 songs");
  await until(async () => (await tracks().count()) === 14 && await dl.locator("#aTitle").textContent() === "Night Drive Tapes", 10000);
  await dl.locator("#selAll").uncheck();
  for (const k of [0, 5, 8, 10]) await tracks().nth(k).locator("input").check();
  await dl.locator("#bAudio").selectOption("mp3");
  await dl.locator("#addSel").click();
  ok(await until(async () => (await dl.locator(".job").count()) === 4), "4 songs added to the queue as MP3");
  ok(await until(async () => (await state(8)).endsWith("%"), 10000), "The slow song shows its percentage in the list: " + await state(8));
  await dl.locator(".job.running", { hasText: "Long Exposure" }).locator("[data-act=cancel]").click();
  ok(await until(async () => await state(0) === L("dl.album.saved") && await state(5) === L("dl.album.failed") && await state(10) === L("dl.album.failed") && await state(8) === L("dl.q.cancelled"), 20000),
    "States in the list: saved, failed (unavailable and stopped at 40 %), cancelled: " + [await state(0), await state(5), await state(10), await state(8)].join(" | "));
  ok((await dl.locator(".job.error small").allTextContents()).some(s => s.includes("HTTP Error 403")) && fs.readdirSync(P("Downloads", "Audio")).some(f => /^Neon Overpass\.wav$/.test(f)), "The queue says why and the saved one is a file: " + fs.readdirSync(P("Downloads", "Audio")).join(", "));
  await shot("3-states.png");
  // video and cover
  await dl.locator("#selAll").uncheck(); await tracks().nth(1).locator("input").check();
  await dl.locator('#bKind [data-k="video"]').click();
  ok(await dl.locator("#bQuality").isVisible() && await dl.locator("#bAudio").isHidden(), "Video: the quality instead of the audio format");
  await dl.locator("#addSel").click();
  await dl.locator('#bKind [data-k="cover"]').click();
  ok(await dl.locator("#bQuality").isHidden() && await dl.locator("#bAudio").isHidden(), "Cover: no options");
  await dl.locator("#addSel").click();
  ok(await until(async () => (await dl.locator(".job.done", { hasText: "Glass Harbour" }).count()) === 2, 30000), "Glass Harbour as video and cover");
  ok(fs.readdirSync(P("Downloads", "Covers")).includes("Glass Harbour.png") && fs.readdirSync(P("Downloads", "Video")).some(f => f.startsWith("Glass Harbour.")), "…saved in Video and Covers");
  // Choose and back
  await tracks().nth(2).locator("[data-act=pick]").click();
  ok(await until(async () => await dl.locator("#preview").isVisible() && (await dl.locator("#pTitle").textContent()) === "Afterglow (feat. Lia)", 10000) && await dl.locator("#album").isHidden() && await dl.locator("#getAudio").isEnabled() && await dl.locator("#cVideo").isVisible(), "Choose: the song alone, with its options, downloadable");
  await shot("4-choose.png");
  await dl.locator("#backAlbum").click();
  ok(await until(async () => await dl.locator("#album").isVisible()) && await state(0) === L("dl.album.saved"), "Back to the album, with the states kept");
  await tracks().nth(5).locator("[data-act=pick]").click();
  ok(await until(async () => (await dl.locator("#status").textContent()) === "Video unavailable. This video is private" && await dl.locator("#album").isVisible(), 10000), "Choosing an unavailable song says why and leaves the album open");
  // Spotify album
  await link("Spotify album · 10");
  ok(await until(async () => (await tracks().count()) === 10, 10000) && await dl.locator('#bKind [data-k="video"]').isHidden() && await dl.locator("#aNotice").isVisible(), "Spotify album: no video, with Spotify's notice");
  await dl.locator('#bKind [data-k="cover"]').click();
  ok((await dl.locator("#addSel").textContent()).trim() === L("dl.album.add", { n: 1 }), "…its cover is one download");
  await shot("5-spotify.png");
  // a link that fails
  await link("Link that fails");
  ok(await until(async () => (await dl.locator("#status").textContent()) === L("dl.err.notFound"), 10000) && await dl.locator("#album").isHidden(), "A link that fails: " + L("dl.err.notFound"));
  // session
  const missing = await pg.evaluate(() => [...window.__i18n.missing]);
  ok(missing.length === 0, "Every key used exists in en.json" + (missing.length ? ": " + missing.join(", ") : ""));
  const errs = errors.filter(e => !/favicon/.test(e));
  ok(errs.length === 0, "No console errors" + (errs.length ? ":\n  " + errs.join("\n  ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed (downloader-preview)` : "\nAll passed (downloader-preview)");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
