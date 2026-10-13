// Spotify links in the Downloader, with simulated data (no request leaves the machine):
// 1. Scoring (Node): title, artist and length; versions (live, karaoke…) and Shorts; one entry per video;
//    reading the track page, the embed page and the links.
// 2. The tab: Spotify's metadata and the notice, the searches on YouTube Music and YouTube, the 3 candidates,
//    downloading the chosen one as MP3 and M4A with Spotify's tags and cover, a weak match, no match, the oEmbed
//    fallback, an album link without its track list (cover only) and an album's songs to choose from. Screenshots → $SHOTS/spotify.
// Usage: node app/tests/spotify.js
const { execSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { until, painted, locale, serve, launch, openApp } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");
const SP = require("../dist/spotify.js");

let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "spotify");
fs.mkdirSync(SHOTS, { recursive: true });
const { L } = locale("en");

/* ---------- 1. scoring ---------- */
const META = { id: "1a2b3c4d5e6f7g8h9i0jKL", url: "https://open.spotify.com/track/1a2b3c4d5e6f7g8h9i0jKL", title: "Green Room (feat. Lia) - Remastered 2021", artists: ["Nova", "Lia"], album: "Blue Hour", duration: 212, date: "2021-03-05", track: 3, cover: "" };
const YTM = [
  { id: "ytm1", title: "Green Room", track: "Green Room (feat. Lia)", artists: ["Nova", "Lia"], album: "Blue Hour", channel: "Nova - Topic", duration: 212 },
  { id: "ytm2", title: "Green Room (Live)", track: "Green Room (Live)", artists: ["Nova"], channel: "Nova - Topic", duration: 236 },
  { id: "ytm3", title: "Blue Hour", track: "Blue Hour", artists: ["Nova"], channel: "Nova - Topic", duration: 180 }
];
const YT = [
  { id: "yt1", title: "Nova - Green Room (Official Video) ft. Lia", channel: "NovaVEVO", duration: 241 },
  { id: "yt2", title: "Nova - Green Room (Audio)", channel: "Nova", duration: 213 },
  { id: "ytm1", title: "Nova - Green Room", channel: "Nova - Topic", duration: 212 },
  { id: "yt3", title: "Green Room (Karaoke Version)", channel: "Sing King", duration: 212 },
  { id: "yt4", title: "Green Room", url: "https://www.youtube.com/shorts/yt4", channel: "Clips", duration: 30 }
];
{
  const c = (o, source) => Object.assign({ artist: "", source }, o);
  const s = (o, source = "youtube") => SP.score(META, c(o, source)).total;
  ok(s({ title: "Green Room", artist: "Nova, Lia", channel: "Nova - Topic", duration: 212 }, "ytmusic") === 1, "The same song on YouTube Music scores 100 %");
  ok(s(YT[1]) > s(YT[0]), `Length: the audio upload (1 s off) beats the video with an intro (29 s off): ${s(YT[1]).toFixed(2)} > ${s(YT[0]).toFixed(2)}`);
  ok(SP.score(META, c({ title: "Green Room", channel: "x", duration: 214 })).duration === 1 && SP.score(META, c({ title: "Green Room", channel: "x", duration: 242 })).duration === 0, `Length: full within ±${SP.DUR_OK} s, nothing from ${SP.DUR_ZERO} s off`);
  ok(SP.score(META, c({ title: "Green Room", channel: "NovaVEVO", duration: 212 })).artist === 1 && SP.score(META, c({ title: "Green Room", channel: "Someone Else", duration: 212 })).artist === 0, "Artist: found in a VEVO or Topic channel, missing in another one");
  const live = SP.score(META, c(YTM[1], "ytmusic")), kara = SP.score(META, c(YT[3]));
  ok(live.variant === "live" && kara.variant === "karaoke" && kara.total < 0.5, `Live and karaoke versions lose half their score (karaoke ${kara.total.toFixed(2)} with the right length)`);
  ok(SP.score({ ...META, title: "Green Room (Live)" }, c(YTM[1], "ytmusic")).variant === "", "…unless the Spotify title is that version too");
  ok(SP.score(META, c({ title: "Blue Hour", channel: "Nova - Topic", duration: 180 }, "ytmusic")).title === 0, "Title: another song of the same artist scores nothing for the title");
  ok(SP.cleanTitle("Green Room (feat. Lia) - Remastered 2021") === "Green Room" && SP.cleanTitle("Song [Official Music Video] (HD)") === "Song" && SP.cleanTitle("Song (Live)") === "Song (Live)", "Titles without featured artists, «Remastered» or noise brackets; versions stay");
  ok(SP.query(META) === "Nova Green Room", "Query: first artist and the clean title: " + SP.query(META));
  const fromM = YTM.map(e => ({ id: e.id, url: "https://www.youtube.com/watch?v=" + e.id, source: "ytmusic", title: e.track, artist: e.artists.join(", "), channel: e.channel, duration: e.duration }));
  const fromY = YT.filter(e => !e.url).map(e => ({ id: e.id, url: "https://www.youtube.com/watch?v=" + e.id, source: "youtube", title: e.title, artist: "", channel: e.channel, duration: e.duration }));
  const r = SP.rank(META, [...fromM, ...fromY]);
  ok(r.length === 3 && r.map(x => x.id).join() === "ytm1,yt2,yt1" && r[0].source === "ytmusic", "Best 3 in order, a video found on both kept once as YouTube Music: " + r.map(x => `${x.id} ${Math.round(x.score.total * 100)}%`).join(", "));
  ok(r.every((x, k) => !k || r[k - 1].score.total >= x.score.total), "…sorted by score");
  // pages
  const pm = SP.pageMeta(`<meta property="og:title" content="Green Room"/><meta property="og:description" content="Nova · Blue &amp; Gold · Song · 2021"/><meta name="music:duration" content="212"/><meta name="music:release_date" content="2021-03-05"/><meta name="music:album:track" content="3"/><meta content="https://i.scdn.co/image/x" property="og:image"/>`);
  ok(pm.title === "Green Room" && pm.album === "Blue & Gold" && pm.artists.join() === "Nova" && pm.duration === 212 && pm.track === 3 && pm.cover === "https://i.scdn.co/image/x", "Track page: title, album and artist from og:description, length, track, cover (any attribute order, entities)");
  const em = SP.embedMeta(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity: { name: "Green Room", artists: [{ name: "Nova" }, { name: "Lia" }], duration: 212400, releaseDate: { isoString: "2021-03-05T00:00:00Z" }, coverArt: { sources: [{ url: "s", width: 64 }, { url: "b", width: 640 }] } } } } } } })}</script>`);
  ok(em.title === "Green Room" && em.artists.join() === "Nova,Lia" && em.duration === 212.4 && em.date === "2021-03-05" && em.cover === "b", "Embed page: artists, length, date and the largest cover");
  const al = SP.albumMeta(`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity: { name: "Blue Hour", subtitle: "Nova", releaseDate: null, visualIdentity: { image: [{ url: "m", maxWidth: 300 }, { url: "s", maxWidth: 64 }, { url: "b", maxWidth: 640 }] }, trackList: [{ uri: "spotify:track:" + META.id, title: "Green Room", subtitle: "Nova, Lia", duration: 212000 }] } } } } } })}</script>`);
  ok(al && al.cover === "b" && al.date === "" && al.tracks.length === 1 && al.tracks[0].url === META.url, "Album embed page: the cover from visualIdentity (640 px), no date when releaseDate is null, the track list");
  ok(SP.embedMeta("<html></html>") === null && SP.pageMeta("").title === "", "Pages without the data read as empty, without errors");
  ok(SP.parseLink("https://open.spotify.com/intl-es/track/2gReenRoomNovaLia0fake?si=abc").id === "2gReenRoomNovaLia0fake" && SP.parseLink("https://open.spotify.com/album/1440857781abcdefghijkl").kind === "album" && !SP.parseLink("https://open.spotify.com/"), "Links: tracks with a locale, albums, and nothing for other pages");
  const ta = SP.tagArgs(META, "in.src.mp3", "cover.jpg", "out.mp3", "https://www.youtube.com/watch?v=yt2");
  ok(ta.includes("attached_pic") && ta[ta.indexOf("-c") + 1] === "copy" && ta.includes("artist=Nova, Lia") && ta.includes("album=Blue Hour") && ta.includes("track=3") && ta.includes("-id3v2_version") && ta.pop() === "out.mp3", "FFmpeg: tags and cover without re-encoding, ID3v2.3 for MP3");
}

/* ---------- 2. the tab ---------- */
const FX = makeFixtures(), TOOLS = toolOptions(FX);
const SEARCH = path.join(FX.TMP, "search.json");
fs.writeFileSync(SEARCH, JSON.stringify({ ytmusic: YTM, youtube: YT }));
const ID = "1a2b3c4d5e6f7g8h9i0jKL", ID2 = "0z9y8x7w6v5u4t3s2r1qPO", ID3 = "5n5n5n5n5n5n5n5n5n5nZZ", COVER = "https://i.scdn.co/image/ab67616d0000b273aa11bb22cc33dd44ee55ff66";
const page = (title, desc, dur) => `<!doctype html><html><head><meta property="og:title" content="${title}"/><meta property="og:description" content="${desc}"/><meta property="og:image" content="${COVER}"/><meta name="music:duration" content="${dur}"/><meta name="music:release_date" content="2021-03-05"/><meta name="music:album:track" content="3"/></head><body></body></html>`;
const embed = e => `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity: e } } } } })}</script></body></html>`;
Object.assign(TOOLS.tools.web, {
  ["https://open.spotify.com/track/" + ID]: page("Green Room (feat. Lia)", "Nova · Blue Hour · Song · 2021", 212),
  ["https://open.spotify.com/embed/track/" + ID]: embed({ name: "Green Room (feat. Lia)", artists: [{ name: "Nova" }, { name: "Lia" }], duration: 212000, releaseDate: { isoString: "2021-03-05T00:00:00Z" }, coverArt: { sources: [{ url: COVER, width: 640 }] } }),
  ["https://open.spotify.com/track/" + ID2]: page("Paper Moons", "Quiet Harbour · Paper Moons · Song · 2019", 301),
  ["https://open.spotify.com/track/" + ID3]: page("Nothing Here", "Nobody · Nothing Here · Song · 2020", 200),
  ["https://open.spotify.com/oembed?url=" + encodeURIComponent("https://open.spotify.com/track/2gReenRoomNovaLia0fake")]: JSON.stringify({ title: "Green Room", thumbnail_url: COVER }),
  ["https://open.spotify.com/oembed?url=" + encodeURIComponent("https://open.spotify.com/album/7aaaaaaaaaaaaaaaaaaaaa")]: JSON.stringify({ title: "Blue Hour", thumbnail_url: COVER }),
  ["https://open.spotify.com/embed/album/8bbbbbbbbbbbbbbbbbbbbb"]: embed({ name: "Blue Hour", subtitle: "Nova", releaseDate: { isoString: "2021-03-05T00:00:00Z" }, coverArt: { sources: [{ url: COVER, width: 640 }] },
    trackList: [{ uri: "spotify:track:" + ID, title: "Green Room (feat. Lia)", subtitle: "Nova, Lia", duration: 212000 }, { uri: "spotify:track:" + ID2, title: "Paper Moons", subtitle: "Nova", duration: 301000 }, { uri: "spotify:episode:xyz", title: "Not a song" }] }),
  [COVER]: fs.readFileSync(path.join(FX.MEDIA, "spotify.jpg"))
});
TOOLS.tools.env.FAKE_YTDLP_SEARCH = SEARCH;
const host = createHost(fs.mkdtempSync(path.join(FX.TMP, "spotify-")), { tools: { ...TOOLS.tools, systemFfmpeg: execSync("command -v ffmpeg").toString().trim() } });
fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en" } }));
const ytdlp = path.join(host.base, "Tools", "yt-dlp");
fs.mkdirSync(path.dirname(ytdlp), { recursive: true }); fs.copyFileSync(TOOLS.tools.ytdlpSource, ytdlp); fs.chmodSync(ytdlp, 0o755);
const AUDIO = path.join(host.base, "Downloads", "Audio");
const probe = f => JSON.parse(execSync(`ffprobe -v error -show_entries stream=codec_type,codec_name,width,height:stream_disposition=attached_pic:format_tags -of json "${f}"`).toString());

(async () => {
  const server = serve(), browser = await launch();
  const app = await openApp(browser, server, host, { width: 1280, height: 900 });
  const { page: pg, errors } = app;
  await app.tab("downloader"); await app.appReady("downloader");
  await until(() => pg.frames().find(f => /downloader\.html/.test(f.url())).evaluate(() => window.__halApp.ready.then(() => true)), 20000);
  const dl = pg.frameLocator("#v-downloader"), shot = n => pg.screenshot({ path: path.join(SHOTS, n) });
  const read = async url => { await dl.locator("#url").fill(url); await dl.locator("#goBtn").click(); };
  const rows = () => dl.locator("#srcList .src");
  const procs = () => host.log.filter(l => l[0] === "proc").map(l => l[1]);
  const termsSeen = () => !!(JSON.parse(fs.readFileSync(path.join(host.base, "Settings", "app.json"), "utf8")) || {}).downloaderTerms;

  // rights: the card the first time, the fixed line always
  ok(await until(() => dl.locator("#terms").isVisible(), 5000) && (await dl.locator("#terms").textContent()).includes(L("dl.terms.body")), "First use: the rights card is shown");
  ok(await dl.locator("#termsLine").isVisible() && (await dl.locator("#termsLine").textContent()).includes(L("dl.terms.brands")), "The fixed line under the queue: own content only, not affiliated");
  await shot("dl-terms.png");
  await dl.locator("#termsOk").click();
  ok(await until(() => dl.locator("#terms").isHidden(), 5000) && await until(termsSeen, 3000), "«Understood» hides the card and remembers it");

  // metadata, notice, searches, candidates
  let n0 = procs().length;
  await read("https://open.spotify.com/intl-es/track/" + ID + "?si=x");
  ok(await until(async () => (await rows().count()) === 3, 15000), "A Spotify song shows 3 candidates");
  ok(await dl.locator("#pTitle").textContent() === "Green Room (feat. Lia)" && await dl.locator("#pAuthor").textContent() === "Nova, Lia · Blue Hour" && (await dl.locator("#pChips").textContent()).includes("3:32"), "Preview: Spotify's title, artists, album and length");
  ok(await dl.locator("#pNotice").textContent() === L("dl.sp.notice"), "Notice: " + L("dl.sp.notice"));
  ok(await dl.locator("#cVideo").isHidden() && await dl.locator("#cAudio").isVisible() && await dl.locator("#cCover").isVisible(), "Audio and cover offered, no video");
  const runs = procs().slice(n0).map(p => p.args);
  const m = runs.find(a => a.some(x => /^https:\/\/music\.youtube\.com\/search\?q=Nova%20Green%20Room#songs$/.test(x))), y = runs.find(a => a.includes("ytsearch5:Nova Green Room audio"));
  ok(m && m.includes("-J") && m[m.indexOf("--playlist-items") + 1] === "1:3" && y && y.includes("--flat-playlist"), "Searches: YouTube Music songs (3 full entries) and YouTube (5 flat results) for «Nova Green Room»");
  const texts = await rows().allTextContents();
  ok(/Green Room/.test(texts[0]) && texts[0].includes(L("dl.sp.ytmusic")) && texts[0].includes(L("dl.sp.same")) && texts[0].includes(L("dl.sp.match", { pct: 100 })), "First: the YouTube Music song, same length, 100 %: " + texts[0]);
  ok(texts[1].includes("Nova - Green Room (Audio)") && texts[2].includes("Official Video") && texts[2].includes(L("dl.sp.off", { s: "+29" })), "Then the audio upload and the video 29 s longer: " + texts.slice(1).join(" | "));
  ok(!texts.some(x => /Karaoke|Live/.test(x)) && await dl.locator("#srcList input:checked").getAttribute("value") === "0", "No karaoke or live version; the best one is chosen");
  ok(await dl.locator("#srcNote").isHidden(), "No note with a close match");
  await until(async () => !!(await dl.locator("#pThumb").getAttribute("src")), 5000);
  await shot("candidates.png");

  // the second candidate as MP3
  n0 = procs().length;
  await rows().nth(1).click();
  await dl.locator('input[name=afmt][value=mp3]').check(); await dl.locator("#getAudio").click();
  ok(await until(async () => (await dl.locator(".job.done").count()) === 1, 30000, 200), "The chosen audio downloads: " + (await dl.locator(".job small").allTextContents()).join(" | "));
  const dlArgs = procs().slice(n0).find(p => p.tool === "ytdlp").args, ffArgs = procs().slice(n0).find(p => p.tool === "ffmpeg");
  ok(dlArgs[dlArgs.length - 1] === "https://www.youtube.com/watch?v=yt2" && dlArgs.includes("mp3"), "yt-dlp gets the chosen candidate (the second one), as MP3");
  ok(ffArgs && ffArgs.args.includes("attached_pic"), "FFmpeg adds the tags and the cover");
  const mp3 = path.join(AUDIO, "Nova, Lia - Green Room (feat. Lia).mp3");
  const p1 = fs.existsSync(mp3) && probe(mp3), tags1 = p1 && p1.format.tags || {};
  ok(p1 && tags1.title === "Green Room (feat. Lia)" && tags1.artist === "Nova, Lia" && tags1.album === "Blue Hour" && tags1.date === "2021-03-05" && tags1.track === "3", "MP3 tagged with Spotify's title, artists, album, date and track: " + JSON.stringify(tags1));
  const pic = p1 && p1.streams.find(s => s.codec_type === "video");
  ok(pic && pic.disposition.attached_pic === 1 && pic.width === 640, "…and Spotify's cover (640×640) embedded");
  ok(p1 && p1.streams.find(s => s.codec_type === "audio").codec_name === "mp3" && fs.readdirSync(AUDIO).length === 1 && !fs.readdirSync(host.localDir("workspace", "temp", "loose")).length, "No leftovers: only the tagged file, no .src or temporary cover: " + fs.readdirSync(AUDIO).join(", "));
  // the best one, original (M4A)
  await rows().nth(0).click();
  await dl.locator('input[name=afmt][value=original]').check(); await dl.locator("#getAudio").click();
  ok(await until(async () => (await dl.locator(".job.done").count()) === 2, 30000, 200), "Original audio downloads too");
  const m4a = path.join(AUDIO, "Nova, Lia - Green Room (feat. Lia) (2).m4a"), p2 = fs.existsSync(m4a) && probe(m4a);
  ok(p2 && p2.streams.find(s => s.codec_type === "audio").codec_name === "aac" && p2.streams.some(s => s.disposition.attached_pic === 1) && p2.format.tags.album === "Blue Hour", "Original: the AAC stream as M4A, with tags and cover, not re-encoded: " + fs.readdirSync(AUDIO).join(", "));
  ok(procs().some(p => p.tool === "ytdlp" && p.args[p.args.indexOf("-f") + 1] === "ba[ext=m4a]/ba/b" && p.args[p.args.length - 1] === "https://www.youtube.com/watch?v=ytm1"), "…from the YouTube Music candidate");
  await dl.locator("#queue").scrollIntoViewIfNeeded(); await painted(pg);
  ok(await dl.locator("#queue .job").count() === 2 && (await dl.locator("#qCount").textContent()) === "2", "The queue shows the two downloads once each");
  await shot("downloaded.png");

  // a weak match
  await read("https://open.spotify.com/track/" + ID2);
  ok(await until(async () => (await dl.locator("#srcNote").textContent()) === L("dl.sp.weak") && (await rows().count()) === 3, 15000), "No close match: " + L("dl.sp.weak"));
  ok(/badge-warn/.test(await rows().first().locator("span").last().getAttribute("class")), "…the match is shown as a warning");
  await shot("weak.png");
  // nothing found
  await read("https://open.spotify.com/track/" + ID3);
  ok(await until(async () => (await dl.locator("#srcNote").textContent()) === L("dl.sp.none"), 15000) && (await rows().count()) === 0 && await dl.locator("#cAudio").isHidden() && await dl.locator("#cCover").isVisible(), "Nothing found: " + L("dl.sp.none") + "; the cover is still offered");
  // pages unreadable → oEmbed (title and cover only), search by title
  n0 = procs().length;
  await read("https://open.spotify.com/track/2gReenRoomNovaLia0fake");
  ok(await until(async () => (await rows().count()) === 3, 15000) && await dl.locator("#pTitle").textContent() === "Green Room" && procs().slice(n0).some(p => p.args.includes("ytsearch5:Green Room audio")), "Without Spotify's pages: oEmbed's title and cover, the search by title");
  // albums: the cover only
  await read("https://open.spotify.com/album/7aaaaaaaaaaaaaaaaaaaaa");
  ok(await until(async () => (await dl.locator("#pTitle").textContent()) === "Blue Hour", 10000) && await dl.locator("#pNotice").textContent() === L("dl.sp.onlyTracks") && await dl.locator("#pSources").isHidden() && await dl.locator("#cAudio").isHidden() && await dl.locator("#cCover").isVisible(), "Album link: " + L("dl.sp.onlyTracks"));
  await shot("album.png");
  // an album with its track list: the songs to choose from, each one then a Spotify song with its YouTube sources
  await read("https://open.spotify.com/album/8bbbbbbbbbbbbbbbbbbbbb");
  ok(await until(async () => await dl.locator("#album").isVisible() && (await dl.locator(".track").count()) === 2, 10000) && await dl.locator("#aTitle").textContent() === "Blue Hour" && await dl.locator("#aAuthor").textContent() === "Nova · 2021" && (await dl.locator("#aChips").textContent()).includes("8:33"), "Album with its songs: name, artist, year, total length");
  ok(JSON.stringify(await dl.locator(".track small").allTextContents()) === JSON.stringify(["Nova, Lia · 3:32", "Nova · 5:01"]), "…each song with its artists and length");
  ok(await until(() => dl.locator(".track .tthumb").evaluateAll(l => l.every(i => i.complete && i.naturalWidth > 0)), 10000), "…and the album's cover as thumbnail");
  await shot("album-list.png");
  await dl.locator(".track").first().locator("[data-act=pick]").click();
  ok(await until(async () => (await rows().count()) === 3, 15000) && await dl.locator("#pTitle").textContent() === "Green Room (feat. Lia)" && await dl.locator("#backAlbum").isVisible() && await dl.locator("#cAudio").isVisible() && await dl.locator("#cCover").isVisible(), "Choose: the song with its 3 YouTube candidates, audio and cover");
  await dl.locator("#backAlbum").click();
  ok(await until(async () => await dl.locator("#album").isVisible()) && await dl.locator("#preview").isHidden(), "Back to the album");
  // narrow window
  await pg.setViewportSize({ width: 1024, height: 760 });
  await read("https://open.spotify.com/track/" + ID);
  await until(async () => (await rows().count()) === 3, 15000); await painted(pg);
  const nb = await dl.locator("#pNotice").evaluate(e => { const r = e.getBoundingClientRect(), c = e.closest(".card").getBoundingClientRect(); return r.right <= c.right && e.scrollWidth <= e.clientWidth + 1; });
  ok(nb, "At 1024 px the notice wraps inside the card");
  const fits = await pg.frames().find(f => /downloader\.html/.test(f.url())).evaluate(() => [...document.querySelectorAll("#srcList .src")].every(r => r.scrollWidth <= r.clientWidth + 1));
  ok(fits, "At 1024 px the candidates fit their rows");
  await shot("candidates-1024.png");

  const missing = await pg.evaluate(() => [...window.__i18n.missing]);
  ok(missing.length === 0, "Every key used exists in en.json" + (missing.length ? ": " + missing.join(", ") : ""));
  const errs = errors.filter(e => !/favicon/.test(e));
  ok(errs.length === 0, "No console errors" + (errs.length ? ":\n  " + errs.join("\n  ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed (spotify)` : "\nAll passed (spotify)");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
