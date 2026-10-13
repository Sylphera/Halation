// Shared synthetic platform pages for Cover Test tests and README captures. No live accounts.
const fs=require("fs"),path=require("path"),{execSync}=require("child_process");
const AR=require("../dist/profile.js");
module.exports=function coverTestFixtures(FX,TOOLS){
/* ---------- saved pages ---------- */
// pictures: a few gradients and patterns, as JPG (the platforms' images)
const PICS = [];
for (let i = 0; i < 8; i++) {
  const f = path.join(FX.TMP, `pic${i}.jpg`);
  const src = i % 2 ? `gradients=size=640x360:seed=${i + 3}:c0=0x${(0x203050 + i * 0x151a07).toString(16).slice(-6)}:c1=0x${(0xe0a080 - i * 0x0a1511).toString(16).slice(-6)}` : `testsrc2=size=640x640`;
  execSync(`ffmpeg -v error -f lavfi -i "${src}" -vf "hue=h=${i * 45}" -frames:v 1 -y "${f}"`);
  PICS.push(fs.readFileSync(f));
}
const THUMB = path.join(FX.TMP, "thumb16x9.png");
execSync(`ffmpeg -v error -f lavfi -i "gradients=size=1280x720:seed=7:c0=0xff4d2e:c1=0x16002e" -vf "drawbox=x=420:y=180:w=440:h=360:color=white@0.9:t=fill" -frames:v 1 -y "${THUMB}"`);
const web = TOOLS.tools.web;
let picN = 0;
const pic = url => { web[url] = PICS[picN++ % PICS.length]; return url; };
const script = (name, obj) => `<script nonce="x">var ${name} = ${JSON.stringify(obj)};</script>`;
const txt = s => ({ simpleText: s });

// YouTube: the channel of "Nova Lune", its videos (videoRenderer, gridVideoRenderer and a lockupViewModel)
const YT_ID = "UCaBcDeFgHiJkLmNoPqRsTuV";
const SP_ID = "4Z8W4fKeB5YxbusRsdQVPb", SC_USER = 9912345;
TOOLS.tools.spotifyMetrics = { [SP_ID]: { artistId: SP_ID, monthlyListeners: 48200, tracks: [] } };
const ytVideo = (i, kind = "videoRenderer") => ({ [kind]: { videoId: `vid${String(i).padStart(8, "0")}`, title: { runs: [{ text: `Nova Lune - Track ${i}` }] }, viewCountText: txt(`${(i + 1) * 1234} views`),
  publishedTimeText: txt(`${i + 1} weeks ago`), lengthText: txt(`3:${String(10 + i).padStart(2, "0")}`), thumbnail: { thumbnails: [{ url: pic(`https://i.ytimg.com/vi/vid${String(i).padStart(8, "0")}/hqdefault.jpg`), width: 480 }] } } });
// Current channel-page shape: the play icon marks a compact count with no visible "views" suffix.
const channelLockup = v => ({ lockupViewModel: { contentId: v.videoId, contentType: "LOCKUP_CONTENT_TYPE_VIDEO",
  contentImage: { thumbnailViewModel: { image: { sources: v.thumbnail.thumbnails }, overlays: [{ thumbnailOverlayBadgeViewModel: { thumbnailBadges: [{ thumbnailBadgeViewModel: { text: v.lengthText.simpleText } }] } }] } },
  metadata: { lockupMetadataViewModel: { title: { content: v.title.simpleText || v.title.runs.map(r => r.text).join("") }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [
    { text: { content: v.viewCountText.simpleText.replace(/ views$/, "") }, leadingIcon: { name: "PLAY_ARROW_OUTLINED", height: 12, width: 12 } },
    { text: { content: v.publishedTimeText.simpleText } }
  ] }] } } } } } });
web["https://www.youtube.com/@novalune"] = `<html><head><meta property="og:title" content="Nova Lune"><meta property="og:image" content="https://yt3.googleusercontent.com/og"></head><body>` + script("ytInitialData", {
  metadata: { channelMetadataRenderer: { title: "Nova Lune", externalId: YT_ID, vanityChannelUrl: "http://www.youtube.com/@novalune", description: "New single out now", avatar: { thumbnails: [{ url: pic("https://yt3.googleusercontent.com/avatar=s900"), width: 900 }] } } },
  header: { pageHeaderRenderer: { content: { pageHeaderViewModel: {
    title: { dynamicTextViewModel: { text: { content: "Nova Lune" } } },
    banner: { imageBannerViewModel: { image: { sources: [{ url: pic("https://yt3.googleusercontent.com/banner=w1060-fcrop64"), width: 1060 }, { url: "https://yt3.googleusercontent.com/banner=w2560-fcrop64", width: 2560 }] } } },
    metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: "@novalune" } }, { text: { content: "12.4K subscribers" } }] }] } },
    attribution: { attributionViewModel: { text: { content: "open.spotify.com/artist/… and 2 more links" } } }
  } } } },
  // the channel's links as YouTube writes them: behind a redirect, percent-encoded
  onResponseReceivedEndpoints: [{ links: [`https://www.youtube.com/redirect?q=https%3A%2F%2Fopen.spotify.com%2Fartist%2F${SP_ID}%3Fsi%3Dabc`, "https://www.youtube.com/redirect?q=https%3A%2F%2Fsoundcloud.com%2Fnovalune"] }]
}) + "</body></html>";
web["https://yt3.googleusercontent.com/banner=w1280-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj"] = web["https://yt3.googleusercontent.com/banner=w1060-fcrop64"];
web["https://www.youtube.com/@novalune/videos"] = script("ytInitialData", { contents: { twoColumnBrowseResultsRenderer: { tabs: [{ tabRenderer: { content: { richGridRenderer: { contents: [
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map(i => { const v = ytVideo(i, i === 4 ? "gridVideoRenderer" : "videoRenderer"); return { richItemRenderer: { content: i === 0 ? channelLockup(v.videoRenderer) : v } }; }),
  { richItemRenderer: { content: { lockupViewModel: { contentId: "lockup00001", contentType: "LOCKUP_CONTENT_TYPE_VIDEO", contentImage: { thumbnailViewModel: { image: { sources: [{ url: pic("https://i.ytimg.com/vi/lockup00001/hq720.jpg"), width: 720 }] }, overlays: [{ thumbnailOverlayBadgeViewModel: { thumbnailBadges: [{ thumbnailBadgeViewModel: { text: "4:05" } }] } }] } },
    metadata: { lockupMetadataViewModel: { title: { content: "Nova Lune - Lockup Song" }, metadata: { contentMetadataViewModel: { metadataRows: [{ metadataParts: [{ text: { content: "Nova Lune" } }] }, { metadataParts: [{ text: { content: "88K views" } }, { text: { content: "3 months ago" } }] }] } } } } } } } },
  ...[10, 11].map(i => ({ richItemRenderer: { content: ytVideo(i) } }))
] } } } }] } } });
// a reference: another artist's channel, with no links to other platforms
web["https://www.youtube.com/@aurel"] = script("ytInitialData", { metadata: { channelMetadataRenderer: { title: "Aurel", externalId: "UCaurelaurelaurelaurel00", vanityChannelUrl: "http://www.youtube.com/@aurel", avatar: { thumbnails: [{ url: pic("https://yt3.googleusercontent.com/aurel=s900"), width: 900 }] } } } });
web["https://www.youtube.com/@aurel/videos"] = script("ytInitialData", { contents: [0, 1, 2].map(i => ({ richItemRenderer: { content: channelLockup({ videoId: `aurel00000${i}`, title: { runs: [{ text: `Aurel - Shine ${i}` }] }, viewCountText: txt("77K views"), publishedTimeText: txt("5 days ago"), lengthText: txt("2:58"),
  thumbnail: { thumbnails: [{ url: pic(`https://i.ytimg.com/vi/aurel00000${i}/hqdefault.jpg`), width: 480 }] } }) } })) });
const REF_NAMES = ["Aurel", "Mika Sol", "The Vales", "KXNG", "Lumen", "Odette", "Silver Arc", "Night Coast"];
for (let i = 1; i < REF_NAMES.length; i++) {
  const name = REF_NAMES[i], url = `https://www.youtube.com/@reference${i}`;
  web[url] = script("ytInitialData", { metadata: { channelMetadataRenderer: { title: name, externalId: `UCreference${i}00000000000`, vanityChannelUrl: url, avatar: { thumbnails: [{ url: pic(`https://yt3.googleusercontent.com/reference${i}=s900`), width: 900 }] } } } });
  web[url + "/videos"] = script("ytInitialData", { contents: [0,1,2].map(j => ({ richItemRenderer: { content: { videoRenderer: { videoId: `r${i}vid00000${j}`, title: txt(`${name} - Shine ${j}`), thumbnail: { thumbnails: [{ url: pic(`https://i.ytimg.com/vi/r${i}vid00000${j}/hqdefault.jpg`), width: 480 }] }, lengthText: txt("3:12"), viewCountText: txt("42K views"), publishedTimeText: txt("2 weeks ago") } } } })) });
}
// channel search (by name) and video search (the feed)
web["https://www.youtube.com/results?sp=EgIQAg%253D%253D&search_query=Nova%20Lune"] = script("ytInitialData", { contents: [
  { channelRenderer: { channelId: YT_ID, title: txt("Nova Lune"), thumbnail: { thumbnails: [{ url: "//yt3.googleusercontent.com/avatar=s176", width: 176 }] }, subscriberCountText: txt("@novalune"), videoCountText: txt("12.4K subscribers"), navigationEndpoint: { browseEndpoint: { canonicalBaseUrl: "/@novalune" } } } },
  { channelRenderer: { channelId: "UCzzzzzzzzzzzzzzzzzzzzzz", title: txt("Nova Lune Fan Club"), thumbnail: { thumbnails: [] }, subscriberCountText: txt("@novafans"), videoCountText: txt("120 subscribers") } }
] });
pic("https://yt3.googleusercontent.com/avatar=s176");
const FEED_YT = [];
for (let i = 0; i < 16; i++) FEED_YT.push({ videoRenderer: { videoId: `feed${String(i).padStart(7, "0")}`, title: { runs: [{ text: ["Midnight Drive", "Glass Heart", "Neon Rain", "Paper Moon", "Low Tide", "Static Bloom"][i % 6] + " (Official Video)" }] },
  ownerText: { runs: [{ text: ["Aurel", "Mika Sol", "The Vales", "KXNG", "Lumen", "Odette"][i % 6] }] }, viewCountText: txt(`${(i * 37 + 5) * 1000} views`), publishedTimeText: txt(`${i + 1} days ago`), lengthText: txt(`${2 + i % 3}:${String(i * 7 % 60).padStart(2, "0")}`),
  channelThumbnailSupportedRenderers: { channelThumbnailWithLinkRenderer: { thumbnail: { thumbnails: [{ url: pic(`https://yt3.ggpht.com/ch${i % 6}=s68`), width: 68 }] } } } } });
FEED_YT.forEach(v => pic(`https://i.ytimg.com/vi/${v.videoRenderer.videoId}/hqdefault.jpg`));
web["https://www.youtube.com/results?sp=EgIQAQ%253D%253D&search_query=new%20music"] = script("ytInitialData", { contents: { twoColumnSearchResultsRenderer: { primaryContents: { sectionListRenderer: { contents: [{ itemSectionRenderer: { contents: FEED_YT } }] } } } } });
for (const q of ["cover comparison", "second comparison"]) web["https://www.youtube.com/results?sp=EgIQAQ%253D%253D&search_query=" + encodeURIComponent(q)] = script("ytInitialData", { contents: FEED_YT.slice(4, 6) });

// Spotify: the artist page, its embed (top tracks) and each track's cover (oEmbed); New Music Friday for the feed
// the page's own state (base64 JSON) carries the header image
const spState = { entities: { items: { ["spotify:artist:" + SP_ID]: { profile: { name: "Nova Lune" }, visuals: { headerImage: { sources: [{ url: pic("https://image-cdn-fa.spotifycdn.com/image/header-nova"), width: 2660, height: 1140 }] } } } } } };
web[`https://open.spotify.com/artist/${SP_ID}`] = `<meta property="og:title" content="Nova Lune"/><meta property="og:image" content="${pic("https://i.scdn.co/image/avatar-nova")}"/><meta property="og:description" content="Artist · 48.2K monthly listeners."/><script id="initialState" type="text/plain">${Buffer.from(JSON.stringify(spState)).toString("base64")}</script>`;
const spTrack = (id, title, sub) => ({ uri: "spotify:track:" + id, title, subtitle: sub, duration: 201000 });
const SP_TRACKS = Array.from({ length: 11 }, (_, i) => spTrack(("Tr" + i).padEnd(22, "x"), `Lune ${i}`, "Nova Lune"));
const nextData = entity => `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script>`;
web[`https://open.spotify.com/embed/artist/${SP_ID}`] = nextData({ name: "Nova Lune", visualIdentity: { image: [{ url: "https://i.scdn.co/image/avatar-nova", maxWidth: 640 }] }, trackList: SP_TRACKS });
const oembed = (id, title) => { web["https://open.spotify.com/oembed?url=" + encodeURIComponent("https://open.spotify.com/track/" + id)] = JSON.stringify({ title, thumbnail_url: pic("https://i.scdn.co/image/c-" + id) }); };
SP_TRACKS.forEach(t => oembed(t.uri.slice(14), t.title));
const NMF = Array.from({ length: 12 }, (_, i) => spTrack(("Nm" + i).padEnd(22, "y"), ["Afterglow", "Silver", "Honey", "Wires", "Dune", "Kite"][i % 6], ["Aurel", "Mika Sol", "The Vales", "KXNG", "Lumen", "Odette"][i % 6]));
NMF.forEach(t => oembed(t.uri.slice(14), t.title));
web[`https://open.spotify.com/embed/playlist/${AR.SPOTIFY_FEED}`] = nextData({ name: "New Music Friday", trackList: NMF });

// SoundCloud: the profile page (hydration with the public client id), its tracks, its web profiles, search
const CID = "abcdefghijklmnopqrstuvwxyz012345";
const scUser = { id: SC_USER, username: "Nova Lune", permalink: "novalune", permalink_url: "https://soundcloud.com/novalune", avatar_url: pic("https://i1.sndcdn.com/avatars-nova-t500x500.jpg").replace("t500x500", "large"), followers_count: 3120,
  visuals: { visuals: [{ visual_url: pic("https://i1.sndcdn.com/visuals-nova-t2480x520.jpg") }] } };
const hydration = extra => `<script>window.__sc_hydration = ${JSON.stringify([{ hydratable: "anonymousId", data: "x" }, { hydratable: "apiClient", data: { id: CID, isExpiring: false } }, ...extra])};</script>`;
web["https://soundcloud.com/novalune"] = hydration([{ hydratable: "user", data: scUser }]);
web["https://soundcloud.com/"] = hydration([]);
const scTrack = (i, user = scUser, title) => ({ id: 5000 + i, title: title || `Lune (demo ${i})`, permalink_url: `https://soundcloud.com/${user.permalink}/t${i}`, artwork_url: pic(`https://i1.sndcdn.com/artworks-t${user.id}-${i}-t500x500.jpg`).replace("t500x500", "large"),
  playback_count: 1000 + i * 77, likes_count: 20 + i, created_at: "2026-08-0" + (1 + i % 9) + "T10:00:00Z", duration: 180000 + i * 1000, user });
web[`https://api-v2.soundcloud.com/users/${SC_USER}/tracks?representation=&limit=10&client_id=${CID}`] = JSON.stringify({ collection: Array.from({ length: 10 }, (_, i) => scTrack(i)) });
web[`https://api-v2.soundcloud.com/users/soundcloud:users:${SC_USER}/web-profiles?client_id=${CID}`] = JSON.stringify([{ network: "youtube", url: "https://www.youtube.com/@novalune" }, { network: "spotify", url: `https://open.spotify.com/artist/${SP_ID}` }]);
web[`https://api-v2.soundcloud.com/search/users?limit=3&q=Nova%20Lune&client_id=${CID}`] = JSON.stringify({ collection: [scUser, { id: 42, username: "nova lunes", permalink: "novalunes", avatar_url: "", followers_count: 3 }] });
const others = ["aurel", "mikasol", "thevales", "kxng", "lumen"].map((p, i) => ({ id: 100 + i, username: p, permalink: p, avatar_url: pic(`https://i1.sndcdn.com/avatars-${p}-t500x500.jpg`).replace("t500x500", "large") }));
others.forEach(u => pic(`https://i1.sndcdn.com/avatars-${u.permalink}-t120x120.jpg`)); pic("https://i1.sndcdn.com/avatars-nova-t120x120.jpg");
web[`https://api-v2.soundcloud.com/search/tracks?limit=24&q=new%20music&client_id=${CID}`] = JSON.stringify({ collection: Array.from({ length: 12 }, (_, i) => scTrack(20 + i, others[i % 5], ["Pale Blue", "Orbit", "Fever Dream", "Halcyon", "Low Light", "Tangerine"][i % 6])) });

return { PICS, THUMB, web, pic, script, txt, YT_ID, SP_ID, ytVideo, channelLockup, REF_NAMES, FEED_YT, spState, spTrack, SP_TRACKS, nextData, oembed, NMF, CID, scUser, hydration, scTrack, others, SC_USER };
};
