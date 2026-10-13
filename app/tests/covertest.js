// Cover Test (covertest.js) and the artist profile (profile.js, services.js → profile), over the mocked backend
// with saved copies of the platforms' pages (no request leaves the machine):
// 1. Readers (Node): links of the three platforms, counts, YouTube's channel, videos (three kinds of item) and
//    channel search, SoundCloud's hydration and tracks, Spotify's artist and embed, the name ranking.
// 2. Search: a name finds YouTube, then Spotify and SoundCloud through the channel's own links; "Are these yours?"
//    lists SoundCloud too; a link that is not an artist's is refused.
// 3. The tool: the upload place, covers in (file, a second, a third), pick and remove, the 10 views at their sizes
//    (the artist's own page on each platform) with the profile and the feed, 1/2/3 and a click change only the cover,
//    fields everywhere, light/dark, position, references (another artist's release next to yours), at a distance (a
//    1920 px browser window scaled down), going to another tool and back, reopening restores everything.
// 4. Profile: update from the pages (name, avatar, banner, 10 releases per platform), size on disk and time; a
//    platform that fails keeps its last copy; offline, the feed comes from the cache.
// 5. Export PNG at 1× and 2×; Send to from Background Remover becomes a cover.
// Screenshots → $SHOTS/covertest.
// Usage: node app/tests/covertest.js
const fs = require("fs"), os = require("os"), path = require("path"), { execSync } = require("child_process");
const { until, painted, serve, launch, openApp, locale } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");
const AR = require("../dist/profile.js");

let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const functional = process.argv.includes("--functional");
const SHOTS = path.join(process.env.SHOTS || path.join(os.tmpdir(), "halation-shots"), "covertest");
if (!functional) fs.mkdirSync(SHOTS, { recursive: true });
const FX = makeFixtures(), TOOLS = toolOptions(FX), { L } = locale("en"), fx = n => path.join(FX.FIX, n);

const { PICS, THUMB, web, pic, script, txt, YT_ID, SP_ID, ytVideo, channelLockup, REF_NAMES, FEED_YT, spState, spTrack, SP_TRACKS, nextData, oembed, NMF, CID, scUser, hydration, scTrack, others, SC_USER } = require("./covertest-fixtures")(FX, TOOLS);

/* ---------- 1. readers ---------- */
{
  const L1 = AR.parseLink;
  ok(L1("youtube.com/@novalune").url === "https://www.youtube.com/@novalune" && L1("https://www.youtube.com/channel/" + YT_ID + "/videos").id === YT_ID && L1("https://m.youtube.com/c/NovaLune").url === "https://www.youtube.com/c/NovaLune",
    "Links: YouTube handle without https, channel id with a tab after it, /c/ names");
  ok(L1(`https://open.spotify.com/intl-es/artist/${SP_ID}?si=1`).url === `https://open.spotify.com/artist/${SP_ID}` && L1("https://soundcloud.com/NovaLune/").url === "https://soundcloud.com/novalune",
    "Links: Spotify with a language prefix and a query, SoundCloud in any case");
  ok(L1("https://soundcloud.com/discover") === null && L1("https://open.spotify.com/track/" + SP_ID) === null && L1("https://example.com/@x") === null && L1("Nova Lune") === null,
    "Links: pages that are not an artist's (SoundCloud's discover, a Spotify track, other sites, a name) are not links");
  ok(AR.count("12.4K subscribers") === 12400 && AR.count("1,234 views") === 1234 && AR.count("1.2M") === 1200000 && AR.count("48,2 K") === 48200 && AR.count("") === 0, "Counts: 12.4K, 1,234, 1.2M, 48,2 K");
  const ch = AR.ytChannel(web["https://www.youtube.com/@novalune"]);
  ok(ch.name === "Nova Lune" && ch.id === YT_ID && ch.handle === "@novalune" && ch.followers === 12400 && /avatar=s900/.test(ch.avatar) && /banner=w1280/.test(ch.banner),
    `YouTube channel: name, id, handle, subscribers, the largest avatar, the banner at 1280 (${ch.banner.slice(0, 50)})`);
  ok(ch.links.spotify === `https://open.spotify.com/artist/${SP_ID}` && ch.links.soundcloud === "https://soundcloud.com/novalune", "YouTube channel: its links to Spotify and SoundCloud, found behind the redirects");
  const vids = AR.ytVideos(web["https://www.youtube.com/@novalune/videos"]);
  ok(vids.length === 10 && vids[0].title === "Nova Lune - Track 0" && vids[0].views === 1234 && vids[0].duration === 190 && vids[0].date === "1 weeks ago" && vids[4].id === "vid00000004" && vids[9].id === "lockup00001" && vids[9].duration === 245 && vids[9].views === 88000,
    "YouTube videos: the last 10 in order (videoRenderer, gridVideoRenderer, lockupViewModel), views, length and date");
  ok(AR.ytVideos(web["https://www.youtube.com/@aurel/videos"], 2).every(v => v.views === 77000 && v.channel === "" && v.duration === 178 && v.date === "5 days ago"), "Current channel lockups: compact view counts normalize without becoming channel names or changing other metadata");
  const chs = AR.ytSearchChannels(web["https://www.youtube.com/results?sp=EgIQAg%253D%253D&search_query=Nova%20Lune"]);
  ok(chs.length === 2 && chs[0].url === "https://www.youtube.com/@novalune" && chs[0].followers === 12400 && chs[0].avatar.startsWith("https://"), "YouTube channel search: handle, subscribers, avatar made absolute");
  const h = AR.scHydration(web["https://soundcloud.com/novalune"]), u = AR.scUser(h.user);
  ok(h.clientId === CID && u.name === "Nova Lune" && u.followers === 3120 && /t500x500/.test(u.avatar) && /visuals-nova/.test(u.banner), "SoundCloud: public client id, name, followers, avatar at 500 px, banner");
  const sp = AR.spArtist(web[`https://open.spotify.com/artist/${SP_ID}`], web[`https://open.spotify.com/embed/artist/${SP_ID}`]);
  ok(sp.name === "Nova Lune" && sp.followers === 48200 && sp.tracks.length === 11 && sp.tracks[0].duration === 201, "Spotify: name, monthly listeners, the embed's tracks");
  ok(sp.banner === "https://image-cdn-fa.spotifycdn.com/image/header-nova", "Spotify: the artist's header image (banner) from the page's own state");
  ok(AR.ytChannel("<html></html>").name === "" && AR.ytVideos("").length === 0 && AR.scUser(AR.scHydration("x").user) === null && AR.spArtist("", "").name === "", "Pages without the data read as empty, without errors");
  const r = AR.rank([{ name: "Nova Lune Fan Club", followers: 9e6, url: "a" }, { name: "nova  lune", followers: 10, url: "b" }, { name: "Nova", followers: 1e6, url: "c" }], "Nova Lune");
  ok(r[0].url === "b" && r[0].score === 1, "Ranking: the same name (case and spaces aside) beats a bigger account with a longer name");
}

(async () => {
  const io = { text: async u => { if (web[u] == null) throw new Error("could not reach " + u); return String(web[u]); }, json: async u => { if (web[u] == null) throw new Error("could not reach " + u); return JSON.parse(String(web[u])); } };
  /* ---------- 2. search (Node) ---------- */
  {
    const s = await AR.search(io, "Nova Lune");
    ok(s.candidates.youtube[0].url === "https://www.youtube.com/@novalune", "Search by name: the YouTube channel first");
    ok(s.candidates.soundcloud[0].url === "https://soundcloud.com/novalune" && s.candidates.soundcloud[0].followers === 3120, "…SoundCloud through its user search");
    ok(s.candidates.spotify[0] && s.candidates.spotify[0].url === `https://open.spotify.com/artist/${SP_ID}`, "…Spotify through the links on the channel found (Spotify has no search without a key)");
    const fromLink = await AR.search(io, "https://www.youtube.com/@novalune");
    ok(fromLink.source.name === "Nova Lune" && fromLink.source.releases.length === 10, "Search from a link: the profile of that link, with its 10 releases");
    ok(fromLink.candidates.spotify[0].url === `https://open.spotify.com/artist/${SP_ID}` && fromLink.candidates.spotify[0].linked && fromLink.candidates.soundcloud[0].linked,
      "…Spotify and SoundCloud found through the channel's own links (marked as linked)");
    let refused = ""; try { await AR.search(io, "https://example.com/nova"); } catch (e) { refused = e.message; }
    ok(/not a YouTube, Spotify or SoundCloud/.test(refused), "A link of another site is refused: " + refused);
  }

  /* ---------- 3. the tool ---------- */
  const server = serve(), browser = await launch();
  const root = fs.mkdtempSync(path.join(FX.TMP, "covertest-"));
  const host = createHost(root, TOOLS);
  const links = { youtube: "https://www.youtube.com/@novalune", spotify: `https://open.spotify.com/artist/${SP_ID}`, soundcloud: "https://soundcloud.com/novalune" };
  fs.writeFileSync(path.join(host.base, "Settings", "app.json"), JSON.stringify({ settings: { language: "en", saveMode: "halation-folder", saveLocationChosen: true, artistName: "Nova Lune", links } }));
  const P = (...p) => path.join(host.base, ...p);
  let { page, errors, tab, appReady } = await openApp(browser, server, host, { width: 1600, height: 1000 });
  page.on("response", r => { if (r.status() === 404) errors.push("404 " + r.url()); });
  const ctf = () => page.frames().find(f => /covertest\.html/.test(f.url()));
  let ct = page.frameLocator("#v-covertest");
  const shot = n => functional ? painted(page) : painted(page).then(() => page.screenshot({ path: path.join(SHOTS, n + ".png") }));
  const E = fn => ctf().evaluate(fn);
  const imgsLoaded = () => until(() => E(() => [...document.querySelectorAll("#page img")].every(i => i.complete && i.naturalWidth > 0)), 15000);

  ok(await page.locator(".tab[data-tab=covertest]").count() === 1, "Cover Test is on the rail");
  const t0 = Date.now();
  await tab("covertest"); await appReady("covertest");
  ok(await ct.locator('#coverPanel').isVisible() && !await ct.locator('#referencesPanel').isVisible() && await ct.locator('#leftTabs .seg-pill').count() === 1, "Left panel opens on Cover using the shared Layers segmented control");
  ok(await ct.locator("#emptyStage").isVisible() && await ct.locator("#covers .cv.add.up").isVisible(), "Empty: \"Upload your cover here\" in the card and on the stage");
  // the profile is read in the background on first open (never read before)
  ok(await until(() => E(() => Object.values(window.__ct.profile.platforms).filter(p => p.fetched).length === 3), 20000), "First open: the profile is read in the background for the three platforms");
  const first = Date.now() - t0;
  const st = await E(() => window.__ct.stats);
  ok(st.profileMs > 0 && st.profileMs < 3000, `Profile read in ${st.profileMs} ms (< 3 s over the mocked network)`);
  const prof = await E(() => { const p = window.__ct.profile.platforms; return Object.fromEntries(Object.entries(p).map(([k, v]) => [k, { name: v.name, n: v.releases.length, av: !!v.avatar, banner: !!v.banner, imgs: v.releases.filter(r => r.image).length }])); });
  ok(prof.youtube.n === 10 && prof.spotify.n === 10 && prof.soundcloud.n === 10 && Object.values(prof).every(p => p.name === "Nova Lune" && p.av && p.imgs === 10), "Profile: name, avatar and 10 releases with pictures on each platform: " + JSON.stringify(prof));
  ok(prof.youtube.banner && prof.soundcloud.banner && prof.spotify.banner, "…the banners of the three platforms");
  const files = fs.readdirSync(P("Settings", "Profile")), bytes = files.reduce((a, f) => a + fs.statSync(P("Settings", "Profile", f)).size, 0);
  ok(files.filter(f => f.endsWith(".webp")).length === 36 && bytes < 5 * 1024 * 1024, `Profile on disk: ${files.length} files, ${(bytes / 1024).toFixed(0)} KB (< 5 MB), WebP`);
  ok(await ct.locator("#prof .prow").count() === 3, "The profile card lists the three platforms");

  await ct.locator("#referencesTab").click();
  // Discover/confirm the own identity without navigating to Settings.
  await page.evaluate(() => {
    window.__shell.setSetting("artistName", "");
    window.__shell.setSetting("links", {});
  });
  await ct.locator("#profileName").fill("Nova Lune");
  await ct.locator("#profileSearchBtn").click();
  ok(await until(() => ct.locator("#profileCandidates .profile-candidate").count().then(n => n >= 3), 15000), "Own profile: candidates appear inside Cover Test");
  ok(await page.evaluate(() => Object.keys(window.__hal.settings().links).length === 0), "Searching does not save an artist link");
  const candidate = platform => ct.locator("#profileCandidates .profile-candidate").filter({ hasText: platform }).first();
  await candidate("YouTube").locator('[data-profile-answer="no"]').click();
  ok(await page.evaluate(() => Object.keys(window.__hal.settings().links).length === 0), "Rejecting a candidate leaves Settings unchanged");
  await ct.locator("#profileSearchBtn").click();
  await until(() => ct.locator('[data-profile-answer="yes"]').count().then(n => n >= 3), 15000);
  for (const platform of ["YouTube", "Spotify", "SoundCloud"]) {
    await candidate(platform).locator('[data-profile-answer="yes"]').click();
    ok(await until(() => candidate(platform).locator(".candidate-state").count().then(n => n === 1), 15000), `Own profile: ${platform} confirmed inline`);
  }
  const confirmed = await page.evaluate(() => ({ settings: window.__hal.settings(), active: window.__shell.active() }));
  ok(confirmed.active === "covertest" && confirmed.settings.artistName === "Nova Lune" && Object.entries(links).every(([k, url]) => confirmed.settings.links[k] === url), "Confirmed identity uses the existing Settings links without leaving Cover Test");
  ok(await E(() => Object.values(window.__ct.profile.platforms).every(p => p.name === "Nova Lune" && p.fetched && p.avatar && p.releases.length === 10)), "Confirmed profiles provide their actual cached image, data and releases");
  const persisted = JSON.parse(fs.readFileSync(P("Settings", "app.json"), "utf8"));
  ok(persisted.settings.artistName === "Nova Lune" && Object.entries(links).every(([k, url]) => persisted.settings.links[k] === url), "The confirmed identity persists in the existing Settings store");

  await ct.locator("#coverTab").click();
  // covers
  await ct.locator("#imgIn").setInputFiles(THUMB);
  ok(await until(() => E(() => window.__ct.covers.length === 1)), "A first cover (16:9)");
  await ct.locator("#imgIn").setInputFiles(fx("cover.png"));
  await ct.locator("#imgIn").setInputFiles(fx("sky.png"));
  ok(await until(() => E(() => window.__ct.covers.length === 3 && window.__ct.C.active === 2 && !window.__halApp.busy())), "Two more: three covers, the last one active");
  const places = [await ct.locator("#covers .cv.add").count(), await ct.locator("#coverCount").textContent(), await ct.locator("#covers .cv[data-i] [data-act=remove]").count()];
  ok(places[0] === 0 && places[1] === "3/3" && places[2] === 3, "Three at most: no more upload, each cover with its remove button " + places);
  await shot("covers");
  // remove one, upload another
  await ct.locator('#covers .cv[data-i="1"] [data-act=remove]').click();
  ok(await until(() => E(() => window.__ct.covers.length === 2)) && await ct.locator("#covers .cv.add").count() === 1, "Remove: two covers left and \"Upload another\" is back");
  await ct.locator("#imgIn").setInputFiles(fx("cover.png"));
  ok(await until(() => E(() => window.__ct.covers.length === 3 && !window.__halApp.busy())), "Upload another: three again");
  ok(await until(() => E(() => (window.__ct.feeds.youtube || {}).items && window.__ct.feeds.youtube.items.length === 16)), "The YouTube feed: 16 real videos");
  ok(await E(() => { const cell = [...document.querySelectorAll("#page .cell")].find(e => e.querySelector(".t")?.textContent === "Nova Lune - Track 0"); return window.__ct.profile.platforms.youtube.releases[0].views === 1234 && /1.2K views/.test(cell?.textContent || ""); }), "Channel: current channel-page counts survive profile normalization, caching and rendering");
  await E(() => { window.__ct.C.fields.title = "Afterimage"; });
  await ct.locator("#fTitle").fill("Afterimage");
  await ct.locator("#fViews").fill("2.4M");
  ok(await E(() => window.__ct.C.view.youtube === "channel" && !!document.querySelector("#page .chan")), "YouTube opens on the artist's channel");
  await ct.locator("#views [data-view=home]").click();
  await imgsLoaded();
  // Home: real size (a cell is 320–400 px wide), the cover at place 2
  const home = await E(() => { const th = [...document.querySelectorAll("#page .grid .th")]; const me = document.querySelector("#page [data-me]"); return { n: th.length, w: Math.round(th[0].getBoundingClientRect().width), h: Math.round(th[0].getBoundingClientRect().height), at: th.indexOf(me), title: me.closest(".cell").querySelector(".t").textContent, meta: [...me.closest(".cell").querySelectorAll(".m")].map(x => x.textContent).join("|") }; });
  ok(home.w >= 300 && home.w <= 420 && Math.abs(home.w / home.h - 16 / 9) < 0.02 && home.at === 1, `YouTube Home: thumbnails ${home.w}×${home.h} (16:9, real size), the cover at place 2`);
  ok(home.title === "Afterimage" && home.meta === "Nova Lune|2.4M views • 2 days ago", "…with the title, the profile's name and the views typed: " + home.meta);
  await shot("yt-home");
  // one click and the keys change only the cover
  const before = await E(() => { document.querySelector("#page .grid").dataset.keep = "1"; return document.querySelector("#page [data-me] img").src; });
  await ct.locator('#covers .cv[data-i="0"]').click();
  const after = await E(() => ({ src: document.querySelector("#page [data-me] img").src, same: document.querySelector("#page .grid").dataset.keep === "1" }));
  ok(after.src !== before && after.same, "A click on cover 1: the picture changes, the view is not rebuilt");
  await ct.locator("#fTitle").press("Escape"); await ctf().evaluate(() => document.activeElement.blur());
  await ct.locator("#page").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("2");
  ok(await until(() => E(() => window.__ct.C.active === 1)), "Key 2: the second cover");
  const t1 = Date.now(); await page.keyboard.press("1"); await until(() => E(() => window.__ct.C.active === 0));
  ok(Date.now() - t1 < 500, `…switching is instant (${Date.now() - t1} ms)`);

  // every view
  const VIEWS = { youtube: ["channel", "home", "search", "mobile"], spotify: ["artist", "release", "row"], soundcloud: ["profile", "track", "feed"] };
  const sizes = {};
  for (const [plat, vs] of Object.entries(VIEWS)) {
    await ct.locator(`#plats [data-plat=${plat}]`).click();
    if (plat !== "youtube") await until(() => E(() => { const f = window.__ct.feeds[window.__ct.C.platform]; return f && f.items.length > 0; }), 15000);
    for (const v of vs) {
      await ct.locator(`#views [data-view=${v}]`).click();
      await imgsLoaded();
      sizes[plat + "/" + v] = await E(() => { const me = document.querySelector("#page [data-me] img"); const r = me.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height), n: document.querySelectorAll("#page img").length, title: document.querySelector("#page").textContent.includes("Afterimage"), hero: !!document.querySelector("#page .chan .banner img, #page .ahero img, #page .phero img"), name: document.querySelector("#page").textContent.includes("Nova Lune") }; });
      await shot(`${plat}-${v}`);
    }
  }
  const sz = k => sizes[k];
  ok(Math.abs(sz("youtube/channel").w / sz("youtube/channel").h - 16 / 9) < 0.03 && sz("youtube/channel").w >= 300, `Channel: the new video first among the channel's, 16:9 (${sz("youtube/channel").w}×${sz("youtube/channel").h})`);
  ok(sz("youtube/mobile").w === 390, "Mobile: the thumbnail as wide as the phone (390)");
  ok(sz("spotify/artist").w === 40 && sz("spotify/release").w === 232 && sz("spotify/row").w === 156, `Spotify: Popular 40, release 232, row 156 (${sz("spotify/artist").w}, ${sz("spotify/release").w}, ${sz("spotify/row").w})`);
  ok(sz("soundcloud/profile").w === 160 && sz("soundcloud/track").w === 340 && sz("soundcloud/feed").w === 160, `SoundCloud: profile 160, track 340, feed 160 (${sz("soundcloud/profile").w}, ${sz("soundcloud/track").w}, ${sz("soundcloud/feed").w})`);
  ok(Object.entries(sizes).every(([k, s]) => s.title && s.n >= 3), "All 10 views show the title and real pictures around the cover: " + Object.entries(sizes).map(([k, s]) => `${k} ${s.n}`).join(", "));
  ok(["youtube/channel", "spotify/artist", "soundcloud/profile"].every(k => sizes[k].hero && sizes[k].name), "The artist's page on the three platforms: their header (banner or picture) and name");
  // light and dark, position
  await ct.locator("#themeBtn").click();
  ok(await E(() => document.querySelector("#page").classList.contains("dark")), "SoundCloud: dark theme");
  await shot("soundcloud-feed-dark");
  await ct.locator("#fPos").selectOption("3");
  ok(await E(() => [...document.querySelectorAll("#page .post")].findIndex(p => p.querySelector("[data-me]")) === 2), "Position: the cover moves to place 3 of the feed");
  await ct.locator("#plats [data-plat=youtube]").click(); await ct.locator("#views [data-view=home]").click();
  await ct.locator("#themeBtn").click();
  ok(await E(() => document.querySelector("#page").classList.contains("light")), "YouTube: light theme");
  await imgsLoaded(); await shot("yt-home-light");
  // references: another artist's video next to yours
  await ct.locator('#referencesTab').click();
  await ct.locator("#refIn").fill("https://www.youtube.com/@aurel"); await ct.locator("#refIn").press("Enter");
  ok(await until(() => E(() => { const r = window.__ct.refs[0]; return r && r.platforms.youtube && r.platforms.youtube.releases.length > 0; }), 15000), "Reference by link: Aurel's channel is read");
  await imgsLoaded();
  ok(await E(() => [...document.querySelectorAll("#page .cell .t")].some(t => t.textContent === "Aurel - Shine 0")), "…and one of their videos sits next to yours on Home");
  ok(await E(() => { const cell = [...document.querySelectorAll("#page .cell")].find(e => e.querySelector(".t")?.textContent === "Aurel - Shine 0"); return window.__ct.refs[0].platforms.youtube.releases[0].views === 77000 && /77K views/.test(cell?.textContent || ""); }), "Home: current channel-page counts survive reference normalization, caching and rendering");
  await ct.locator("#refIn").fill("Zzyzx Nobody"); await ct.locator("#refIn").press("Enter");
  ok(await until(async () => (await ct.locator("#refs .ref").nth(1).locator("small").textContent()) === L("ct.refNotFound"), 15000), "A name found nowhere says so");
  await ct.locator("#refs .ref").nth(1).locator("[data-act=remove]").click();
  ok(await until(() => E(() => window.__ct.C.refs.length === 1)), "…and can be removed");
  for (let i = 1; i < REF_NAMES.length; i++) {
    await ct.locator("#refIn").fill(`https://www.youtube.com/@reference${i}`); await ct.locator("#refIn").press("Enter");
    ok(await until(() => E(() => window.__ct.refs.every(r => !r.loading) && window.__ct.refs.every(r => r.platforms.youtube?.releases.length === 2)),15000), `Reference ${i + 1}: two videos read through the actual profile service`);
  }
  ok(await ct.locator("#refCount").textContent() === "8/8" && await ct.locator("#refAdd").isDisabled() && await ct.locator("#refIn").isDisabled(), "Eight artists fill the limit and disable further additions");
  await E(() => { document.querySelector("#refIn").value="Ninth artist"; document.querySelector("#refForm").dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})); });
  ok(await E(() => window.__ct.C.refs.length === 8), "The submit handler also rejects a ninth artist");
  for (const view of ["home","search","mobile"]) {
    await ct.locator(`#views [data-view=${view}]`).click(); await imgsLoaded();
    const titles = await E(() => [...document.querySelectorAll("#page .t")].map(e => e.textContent));
    ok(REF_NAMES.every(name => [0,1].every(i => titles.includes(`${name} - Shine ${i}`))) && !REF_NAMES.some(name => titles.includes(`${name} - Shine 2`)), `${view}: all eight artists contribute two full-size references, without truncation`);
    const complete = await E(() => [...document.querySelectorAll("#page .t")].filter(e => / - Shine [01]$/.test(e.textContent)).every(e => {
      const card = e.closest('.cell,.res') || e.closest('.info').parentElement, image = card.querySelector('.th img');
      return image?.complete && image.naturalWidth > 0 && !!card.querySelector('.dur') && /views/.test(card.textContent);
    }));
    ok(complete, `${view}: references retain loaded artwork, video duration and view counts`);
  }
  // The left panel owns its scroll; moving it leaves the preview and the document in place.
  const tabsBefore = await E(() => { const c={...window.__ct.C};delete c.leftTab;window.__coverNode=document.querySelector('#coversCard');window.__refsNode=document.querySelector('#refsCard');return JSON.stringify(c); });
  await ct.locator('#coverTab').click();
  const panelBefore = await E(() => ({ y: document.querySelector("#stage").getBoundingClientRect().y, body: document.scrollingElement.scrollTop }));
  await ct.locator("#leftContent").hover(); await page.mouse.wheel(0, 700);
  ok(await until(() => E(() => document.querySelector("#leftContent").scrollTop > 0)), "Left panel: real wheel input scrolls its contents independently");
  ok(await ctf().evaluate(before => document.querySelector('#stage').getBoundingClientRect().y === before.y && document.scrollingElement.scrollTop === before.body, panelBefore), "Left panel: scrolling does not move the central preview or outer document");
  const coverScroll = await E(() => document.querySelector('#leftContent').scrollTop);
  await ct.locator('#referencesTab').click();
  ok(!await ct.locator('#coverPanel').isVisible() && await ct.locator('#referencesPanel').isVisible(), "References alone displays Artists and Around it");
  await ct.locator('#coverTab').click();
  ok(await ctf().evaluate(top => document.querySelector('#leftContent').scrollTop === top, coverScroll), "Each tab retains its own scroll position");
  await ct.locator('#referencesTab').click();
  ok(await ctf().evaluate(before => { const c={...window.__ct.C};delete c.leftTab;return JSON.stringify(c)===before && window.__coverNode===document.querySelector('#coversCard') && window.__refsNode===document.querySelector('#refsCard'); }, tabsBefore), "Tab changes retain mounted controls, cover selection, artists, queries and test state");
  ok(await E(() => document.querySelector('#coverPanel').contains(document.querySelector('#profileCard')) && document.querySelector('#referencesPanel').contains(document.querySelector('#refsCard')) && document.querySelector('#referencesPanel').contains(document.querySelector('#feedCard')) && !document.querySelector('.rack.right #feedCard')), "Cover and References preserve the existing cards, with Around it under References");
  await ct.locator('#views [data-view=home]').click();
  const searchBefore = await E(() => ({ query: window.__ct.C.query.youtube, ids: window.__ct.feeds.youtube.items.map(i => i.id), refs: window.__ct.C.refs.slice(), active: window.__ct.C.active }));
  for (const q of ['cover comparison', 'second comparison']) {
    await ct.locator('#fQuery').fill(q); await ct.locator('#fQuery').press('Tab');
    ok(await until(() => E(() => window.__ct.feeds.youtube.items.length === 2)) && await ct.locator('#cancelSearchBtn').isVisible(), `Around it: ${q} exposes Cancel search test`);
  }
  await ct.locator('#cancelSearchBtn').click();
  ok(await ctf().evaluate(before => { const c=window.__ct; return c.C.query.youtube === before.query && JSON.stringify(c.feeds.youtube.items.map(i => i.id)) === JSON.stringify(before.ids) && JSON.stringify(c.C.refs) === JSON.stringify(before.refs) && c.C.active === before.active && c.C.view.youtube === 'home' && !c.C.searchTest; }, searchBefore) && !await ct.locator('#cancelSearchBtn').isVisible(), "Cancel search test restores the original query and feed after repeated searches, keeping cover, references and view");
  await E(() => { const hal=window.__hal || parent.__hal, original=hal.profile.feed; window.__originalFeed=original; hal.profile.feed=(plat,q,o)=>q === 'pending comparison' ? new Promise(resolve=>{window.__finishPendingFeed=resolve;}) : original(plat,q,o); });
  await ct.locator('#fQuery').fill('pending comparison'); await ct.locator('#fQuery').press('Tab');
  ok(await until(() => E(() => !!window.__finishPendingFeed)), "Around it: a query can remain in flight");
  await ct.locator('#cancelSearchBtn').click();
  await E(() => { window.__finishPendingFeed({items:[],fetched:Date.now(),error:''}); (window.__hal || parent.__hal).profile.feed=window.__originalFeed; });
  await painted(page);
  ok(await ctf().evaluate(before => window.__ct.C.query.youtube === before.query && JSON.stringify(window.__ct.feeds.youtube.items.map(i=>i.id)) === JSON.stringify(before.ids), searchBefore), "Cancel search test ignores a late result instead of replacing the restored feed");
  await ct.locator('#views [data-view=mobile]').click();
  for (const far of [false,true]) {
    if (far) await ct.locator("#farBtn").click();
    for (const view of ["home","search","channel"]) {
      await ct.locator(`.mobile-nav [data-mobile-view=${view}]`).click(); await imgsLoaded();
      const initial = await E(() => { const p=document.querySelector(".phone-scroll"),phone=document.querySelector("#page");return {width:phone.offsetWidth,height:phone.offsetHeight,inner:p.clientHeight,total:p.scrollHeight,overflow:getComputedStyle(p).overflowY,extra:p.scrollWidth-p.clientWidth}; });
      ok(initial.width===390 && initial.height===844 && initial.inner===844 && initial.total>844 && initial.overflow==="auto" && initial.extra===0, `Mobile ${view}, far=${far}: native 390×844 viewport and a complete vertically scrollable page`);
      await ct.locator(".phone-scroll").hover(); await page.mouse.wheel(0,700);
      ok(await until(() => E(() => document.querySelector(".phone-scroll").scrollTop>0)), `Mobile ${view}, far=${far}: real wheel scroll reaches more content`);
      await E(() => { const p=document.querySelector(".phone-scroll");p.scrollTop=p.scrollHeight; });
      ok(await E(() => { const p=document.querySelector(".phone-scroll");return Math.abs(p.scrollHeight-p.clientHeight-p.scrollTop)<2; }), `Mobile ${view}, far=${far}: the complete feed/profile/results can be reached`);
      await shot(`mobile-${view}-${far?"far":"normal"}-bottom`);
    }
    if (far) await ct.locator("#farBtn").click();
  }
  await ct.locator(".mobile-nav [data-mobile-view=home]").click();
  await ct.locator("#views [data-view=home]").click();
  await shot("references");
  // at a distance: the page of a 1920 px screen in a browser window, scaled down
  await ct.locator("#farBtn").click();
  const far = await E(() => { const fb = document.querySelector("#farbox"), m = /scale\(([\d.]+)\)/.exec(fb.style.transform); return { on: document.querySelector("#stage").classList.contains("far"), w: document.querySelector("#page").offsetWidth, chrome: !document.querySelector("#chrome").hidden, guide: !!document.querySelector("#page .guide"), k: m ? +m[1] : 1, cols: getComputedStyle(document.querySelector("#page .grid")).gridTemplateColumns.split(" ").length }; });
  ok(far.on && far.w === 1920 && far.chrome && far.guide && far.k < 0.6 && far.cols >= 4, `At a distance: a 1920 px page in a browser window at ${far.k.toFixed(2)}, YouTube's guide and ${far.cols} columns`);
  await imgsLoaded(); await shot("yt-far");
  await ct.locator("#views [data-view=search]").click(); await imgsLoaded(); await shot("yt-search-far");
  await ct.locator("#views [data-view=channel]").click(); await imgsLoaded(); await shot("yt-channel-far");
  await ct.locator("#plats [data-plat=spotify]").click(); await ct.locator("#views [data-view=artist]").click(); await imgsLoaded(); await shot("spotify-artist-far");
  await ct.locator("#plats [data-plat=soundcloud]").click(); await ct.locator("#views [data-view=profile]").click(); await imgsLoaded(); await shot("soundcloud-profile-far");
  for (const view of ["profile","track","feed"]) {
    await ct.locator(`#views [data-view=${view}]`).click(); await imgsLoaded();
    ok(await E(() => document.querySelector(".sc-content").offsetWidth===1240 && document.querySelector(".sc-nav").offsetWidth===1920), `SoundCloud ${view}: at a distance retains a centered 1240 px site inside the 1920 px browser`);
    ok(await E(() => !document.querySelector('#page').classList.contains('sc-narrow') && [...document.querySelectorAll('.sc-nav-link')].every(e=>getComputedStyle(e).display!=='none') && [...document.querySelectorAll('.sc-content aside')].every(e=>getComputedStyle(e).display!=='none')), `SoundCloud ${view}: the wide page retains desktop navigation and its sidebar`);
    const shape = await E(() => { const w=document.querySelector("#page [data-me]").closest(".hero,.trk").querySelector(".wave svg");const bars=[...w.querySelectorAll("rect:not(.reflection)")].map(r=>+r.getAttribute("height"));return {n:bars.length,min:Math.min(...bars),max:Math.max(...bars),quiet:bars.filter(h=>h<4).length,reflections:w.querySelectorAll(".reflection").length}; });
    ok(shape.n>=100 && shape.max>35 && shape.min<3 && shape.quiet>shape.n*.05 && shape.reflections===shape.n, `SoundCloud ${view}: structured waveform with quiet pauses, dense phrases and reflection: ${JSON.stringify(shape)}`);
    await shot(`soundcloud-${view}-far-new`);
  }
  await ct.locator("#farBtn").click();
  ok(await E(() => !document.querySelector("#stage").classList.contains("far") && document.querySelector("#chrome").hidden && document.querySelector("#page").offsetWidth < 1920), "Back from a distance: the page at the stage's width");
  await ct.locator("#plats [data-plat=youtube]").click(); await ct.locator("#views [data-view=home]").click();

  // another tool and back; reopening
  await tab("grade"); await tab("covertest");
  ok(await E(() => window.__ct.covers.length === 3 && window.__ct.C.platform === "youtube" && !window.__ct.C.dark.youtube), "Another tool and back: covers and view as they were");
  await ct.locator('#fQuery').fill('cover comparison'); await ct.locator('#fQuery').press('Tab');
  ok(await until(() => E(() => window.__ct.feeds.youtube.items.length === 2 && !!window.__ct.C.searchTest)), "Around it: an active search test is saved before reopening");
  await E(() => new Promise(r => setTimeout(r, 400)));
  await page.close();
  ({ page, errors: errors, tab, appReady } = await openApp(browser, server, host, { width: 1600, height: 1000 }));
  page.on("response", r => { if (r.status() === 404) errors.push("404 " + r.url()); });
  ct = page.frameLocator("#v-covertest");
  const t2 = Date.now();
  await tab("covertest"); await appReady("covertest");
  const reopen = await E(() => ({ n: window.__ct.covers.length, title: window.__ct.C.fields.title, views: window.__ct.C.fields.views, rel: Object.values(window.__ct.profile.platforms).map(p => p.releases.length), refs: window.__ct.C.refs.length }));
  ok(reopen.n === 3 && reopen.title === "Afterimage" && reopen.views === "2.4M" && reopen.rel.join() === "10,10,10" && reopen.refs === 8, "Reopening Halation: three covers, fields, all eight references and the profile from disk");
  ok(await until(() => E(() => window.__ct.refs.length===8 && window.__ct.refs.every(r=>r.platforms.youtube?.releases.length===2))), "All eight reference artists restore their two cached videos");
  ok(await ct.locator('#cancelSearchBtn').isVisible(), "Reopening retains the action to cancel the active search test");
  await ct.locator('#cancelSearchBtn').click();
  ok(await until(() => E(() => window.__ct.C.query.youtube === 'new music' && !window.__ct.C.searchTest && window.__ct.feeds.youtube.items.length === 16)), "Cancel after reopening restores the original cached query and content");
  await imgsLoaded();
  ok(Date.now() - t2 < 3000, `…open with everything painted in ${Date.now() - t2} ms`);
  // Removing seven references is a separate editing flow, not part of restoring the saved page.
  for (let i=7;i>0;i--) await ct.locator("#refs .ref").nth(i).locator("[data-act=remove]").click();

  // Remove the whole own artist through the shared Settings/profile stores, keeping comparison material.
  await ct.locator('#coverTab').click();
  const beforeArtistRemove = await E(() => ({ state: JSON.stringify(window.__ct.C), covers: window.__ct.covers.map(c=>c.url), refs: window.__ct.refs, feeds: window.__ct.feeds }));
  await ct.locator('#removeArtistBtn').click();
  ok(await until(() => E(() => !window.__ct.profile.name && !Object.keys(window.__ct.profile.platforms).length)) && !await ct.locator('#removeArtistBtn').isVisible(), "Remove artist clears all own platforms and hides the secondary action");
  ok(await ct.locator('#profileName').inputValue() === '' && await ct.locator('#profileCandidates').textContent() === '' && await ct.locator('#profileSearchStatus').textContent() === '' && await ct.locator('#profAge').textContent() === '', "Remove artist returns Artist profile to the initial search state");
  ok(await ctf().evaluate(before => { const c=window.__ct;return JSON.stringify(c.C)===before.state && JSON.stringify(c.covers.map(c=>c.url))===JSON.stringify(before.covers) && JSON.stringify(c.refs)===JSON.stringify(before.refs) && JSON.stringify(c.feeds)===JSON.stringify(before.feeds); }, beforeArtistRemove), "Remove artist preserves covers, selection, external references and Around it");
  const removedSettings=JSON.parse(fs.readFileSync(P('Settings','app.json'),'utf8')).settings, removedProfile=JSON.parse(fs.readFileSync(P('Settings','Profile','profile.json'),'utf8'));
  ok(removedSettings.artistName === '' && !Object.keys(removedSettings.links).length && !Object.keys(removedProfile.platforms).length, "Remove artist clears the identity from existing Settings and profile persistence");
  ok(await page.evaluate(() => document.querySelector('#setArtistName').value === '' && [...document.querySelectorAll('#setLinks input')].every(i=>!i.value)), "Settings' existing artist and platform fields also show the removed identity");
  await ct.locator('#profileName').fill('Nova Lune');await ct.locator('#profileSearchBtn').click();
  ok(await until(() => ct.locator('.profile-candidate[data-candidate]').count().then(n=>n>=3)), "After removing, another artist can be searched normally");
  for (const platform of ['YouTube','Spotify','SoundCloud']) {
    const row=ct.locator('.profile-candidate[data-candidate]').filter({has:ct.locator('small',{hasText:platform})}).first();
    await row.locator('[data-profile-answer=yes]').click();
    ok(await until(()=>row.locator('.candidate-state').count().then(n=>n===1)), `After removing, ${platform} can be confirmed again`);
  }

  /* ---------- 4. failures and offline ---------- */
  const saved = { ...web };
  for (const k of Object.keys(web)) if (/spotify/.test(k)) delete web[k];
  await ct.locator('#coverTab').click();
  await ct.locator("#refreshBtn").click();
  ok(await until(async () => /could not be read/.test(await ct.locator("#profStatus").textContent())), "Spotify unreachable: " + await ct.locator("#profStatus").textContent());
  ok(await E(() => window.__ct.profile.platforms.spotify.releases.length === 10 && !!window.__ct.profile.platforms.spotify.error), "…its last copy stays (10 releases), marked with the error");
  await ct.locator('#referencesTab').click();
  for (const k of Object.keys(web)) delete web[k];
  await ct.locator("#fQuery").fill("lofi"); await ct.locator("#fQuery").press("Enter");
  ok(await until(async () => (await ct.locator("#feedNote").textContent()) === L("ct.feedOffline")), "Offline, a search never read: grey blocks and the note");
  await ct.locator("#fQuery").fill("new music"); await ct.locator("#fQuery").press("Enter");
  ok(await until(() => E(() => window.__ct.feeds.youtube.items.length === 16)), "Offline, the search read before: from the cache");
  Object.assign(web, saved);

  /* ---------- 5. export and Send to ---------- */
  await ct.locator("#views [data-view=search]").click(); await imgsLoaded();
  const pw = await E(() => [document.querySelector("#page").offsetWidth, document.querySelector("#page").offsetHeight]);
  await ct.locator("#saveBtn").click();
  ok(await until(async () => /saved|Saved/.test(await ct.locator("#status").textContent()), 20000), "Save PNG: " + await ct.locator("#status").textContent());
  const out = fs.readdirSync(P("Exports", "Covers")).filter(f => f.endsWith(".png"));
  const dims = f => execSync(`ffprobe -v error -select_streams v -show_entries stream=width,height -of csv=p=0 "${P("Exports", "Covers", f)}"`).toString().trim();
  ok(out.length === 1 && dims(out[0]) === pw.join(","), `…at the view's size (${dims(out[0])} = ${pw})`);
  const col = execSync(`ffmpeg -v error -i "${P("Exports", "Covers", out[0])}" -vf "scale=1:1" -f rawvideo -pix_fmt rgb24 -`).toJSON().data;
  ok(col.some(v => v > 30), "…with the view painted (not blank): " + col);
  await ct.locator("#scales [data-scale='2']").click();
  await ct.locator("#saveBtn").click();
  ok(await until(() => fs.readdirSync(P("Exports", "Covers")).filter(f => f.endsWith(".png")).length === 2, 20000), "Save PNG at 2×");
  const out2 = fs.readdirSync(P("Exports", "Covers")).filter(f => f.endsWith(".png")).find(f => f !== out[0]);
  ok(dims(out2) === pw.map(v => v * 2).join(","), "…twice the size: " + dims(out2));
  // Background Remover → Send to → Cover Test
  await tab("removebg"); await appReady("removebg");
  const rb = page.frameLocator("#v-removebg");
  await rb.locator("#imgIn").setInputFiles(fx("subject.png"));
  await until(async () => (await rb.locator("#inSize").textContent()) === "800×600", 15000);
  await rb.locator("#sendBtn").click();
  const menu = await until(async () => await rb.locator('.sendmenu [data-to="covertest"], [data-send="covertest"], .smenu [data-to="covertest"]').count() > 0, 5000);
  ok(menu, "Background Remover's Send to lists Cover Test");
  if (menu) {
    await rb.locator('.sendmenu [data-to="covertest"], [data-send="covertest"], .smenu [data-to="covertest"]').first().click();
    ok(await until(() => page.evaluate(() => document.querySelector("#v-covertest").classList.contains("on"))) && await until(() => E(() => /no background/.test(window.__ct.covers[window.__ct.C.active].name))), "…the picture arrives as a cover");
  }
  await shot("sent");

  ok(!errors.length, "No page errors" + (errors.length ? ": " + errors.join(" || ") : ""));
  console.log(`\nNumbers: first open with profile ${first} ms, profile read ${st.profileMs} ms, profile ${(bytes / 1024).toFixed(0)} KB on disk`);
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nAll OK");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
