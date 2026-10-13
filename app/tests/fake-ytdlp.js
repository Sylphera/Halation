#!/usr/bin/env node
// Stand-in for yt-dlp in the tests: same command line and the same output yt-dlp gives with the options the
// Downloader passes (-J JSON, "[hal] 42.0% …" progress lines from --progress-template, "[hal-file] path" from --print,
// "ERROR: [site] id: message" on failure). Media files come from $FAKE_YTDLP_MEDIA (song.opus, song.m4a, song.mp3,
// video.mp4). Searches (music.youtube.com/search, ytsearchN:) answer from $FAKE_YTDLP_SEARCH: { ytmusic: [...], youtube: [...] }.
const fs = require("fs");
const path = require("path");

const args = process.argv.slice(2);
const url = args[args.length - 1] || "";
const has = f => args.includes(f);
const val = f => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = (msg, code = 1) => { process.stderr.write(msg + "\n"); process.exit(code); };

const THUMB = {
  youtube: "https://i.ytimg.com/vi/abc123/maxresdefault.webp",
  soundcloud: "https://i1.sndcdn.com/artworks-abc123-large.jpg",
  bandcamp: "https://f4.bcbits.com/img/a1234567890_10.jpg"
};
function info() {
  // README screenshots: the metadata comes from a file
  if (process.env.FAKE_YTDLP_INFO) return JSON.parse(fs.readFileSync(process.env.FAKE_YTDLP_INFO, "utf8"));
  if (/^ytsearch\d*:|music\.youtube\.com\/search/.test(url)) return search();
  if (/unsupported/.test(url)) fail(`ERROR: Unsupported URL: ${url}`);
  if (/fail/.test(url)) fail("ERROR: [youtube] fail123: Video unavailable. This video is private");
  // a YouTube Music album as a flat playlist (--flat-playlist): link, title, channel, length and thumbnails of each song;
  // no uploader or channel for the album, and a maxresdefault that does not exist
  if (/\/playlist\?/.test(url)) return { _type: "playlist", id: "PL1", title: "Mix", uploader: null, channel: null, extractor_key: "YoutubeTab", webpage_url: url,
    thumbnails: [{ url: "https://i.ytimg.com/vi/olak1/maxresdefault.jpg", width: 1280, height: 720 }],
    entries: [
      { _type: "url", ie_key: "Youtube", id: "abc123", url: "https://www.youtube.com/watch?v=abc123", title: "Free Song (Official Video)", channel: "Open Artist", duration: 7, thumbnails: [{ url: THUMB.youtube, width: 1280, height: 720 }] },
      { _type: "url", ie_key: "Youtube", id: "fail1", url: "https://www.youtube.com/watch?v=fail1", title: "Private Song", channel: "Open Artist", duration: 200 },
      { _type: "url", ie_key: "Generic", id: "nolink" }
    ] };
  // a Bandcamp album: flat, only titles; in full, each song with its page (webpage_url; url is the audio stream)
  if (/bandcamp\.com\/album\//.test(url)) return has("--flat-playlist")
    ? { _type: "playlist", title: "Blue Hour EP", extractor_key: "BandcampAlbum", entries: [{ _type: "url", url: "https://nova.bandcamp.com/track/blue-hour", title: "Blue Hour" }] }
    : { _type: "playlist", title: "Blue Hour EP", uploader: "Nova", extractor_key: "BandcampAlbum", webpage_url: url, thumbnail: THUMB.bandcamp,
      entries: ["Blue Hour", "Low Tide"].map((title, k) => ({ id: "bc" + k, title, artist: "Nova", duration: 180 + k, url: "https://t4.bcbits.com/stream/bc" + k + "/mp3-128", webpage_url: "https://nova.bandcamp.com/track/" + title.toLowerCase().replace(/ /g, "-"), thumbnail: THUMB.bandcamp })) };
  if (/soundcloud\.com/.test(url)) return {
    id: "123", title: "Night Drive", uploader: "Nova", duration: 7, extractor: "soundcloud", extractor_key: "Soundcloud", webpage_url: url,
    thumbnail: THUMB.soundcloud, thumbnails: [{ url: THUMB.soundcloud, width: 100, height: 100 }],
    formats: [{ format_id: "hls_mp3_128", acodec: "mp3", vcodec: "none", ext: "mp3" }, { format_id: "hls_opus_64", acodec: "opus", vcodec: "none", ext: "opus" }]
  };
  if (/bandcamp\.com/.test(url)) return {
    id: "456", title: "Blue Hour", artist: "Nova", duration: 7, extractor: "Bandcamp", extractor_key: "Bandcamp", webpage_url: url,
    thumbnail: THUMB.bandcamp, formats: [{ format_id: "mp3-128", acodec: "mp3", vcodec: "none", ext: "mp3" }]
  };
  return {
    id: "abc123", title: "Free Song (Official Video)", uploader: "Open Artist", channel: "Open Artist", duration: 7, extractor: "youtube", extractor_key: "Youtube",
    webpage_url: url.replace(/&list=[^&]+/, ""), thumbnail: THUMB.youtube,
    thumbnails: [{ url: "https://i.ytimg.com/vi/abc123/hqdefault.jpg", width: 480, height: 360, preference: -7 }, { url: THUMB.youtube, width: 1280, height: 720, preference: 0 }],
    formats: [
      { format_id: "140", acodec: "mp4a.40.2", vcodec: "none", ext: "m4a" }, { format_id: "251", acodec: "opus", vcodec: "none", ext: "webm" },
      { format_id: "134", vcodec: "avc1.4d401e", acodec: "none", height: 360, ext: "mp4" }, { format_id: "136", vcodec: "avc1.4d401f", acodec: "none", height: 720, ext: "mp4" },
      { format_id: "137", vcodec: "avc1.640028", acodec: "none", height: 1080, ext: "mp4" }, { format_id: "248", vcodec: "vp9", acodec: "none", height: 1080, ext: "webm" }
    ]
  };
}

// A search is a playlist: full entries for YouTube Music (limited by --playlist-items), flat ones for YouTube
function search() {
  const music = /music\.youtube\.com/.test(url), q = music ? new URL(url).searchParams.get("q") : url.replace(/^ytsearch\d*:/, "");
  const all = process.env.FAKE_YTDLP_SEARCH ? JSON.parse(fs.readFileSync(process.env.FAKE_YTDLP_SEARCH, "utf8")) : {};
  const items = val("--playlist-items"), n = items ? +items.split(":")[1] : +((/^ytsearch(\d+):/.exec(url) || [])[1] || 1);
  const entries = /nothing/i.test(q) ? [] : (all[music ? "ytmusic" : "youtube"] || []).slice(0, n);
  return { _type: "playlist", id: q, title: q, entries: music ? entries : entries.map(e => ({ _type: "url", ie_key: "Youtube", url: "https://www.youtube.com/watch?v=" + e.id, ...e })) };
}

(async () => {
  if (has("-U")) { process.stdout.write("Current version: stable@2099.01.01\nLatest version: stable@2099.01.01\nyt-dlp is up to date (stable@2099.01.01)\n"); return; }
  const j = info();
  if (has("-J")) { process.stdout.write(JSON.stringify(j) + "\n"); return; }
  if (j._type === "playlist") fail("ERROR: [youtube:tab] PL1: playlists are not supported here");
  // download: -o "<stem>.%(ext)s"
  const template = val("-o"), media = process.env.FAKE_YTDLP_MEDIA || "";
  const audio = has("-x"), mp3 = val("--audio-format") === "mp3", m4a = /^ba\[ext=m4a\]/.test(val("-f") || "");
  const ext = audio ? (mp3 ? "mp3" : m4a ? "m4a" : "opus") : "mp4", src = path.join(media, audio ? "song." + ext : "video.mp4");
  const out = template.replace(/%\(ext\)s$/, ext).replace(/%%/g, "%"), part = out + ".part";
  const passes = audio ? 1 : 2, delay = /slow/.test(url) ? 250 : 30;
  fs.writeFileSync(part, "");
  for (let p = 0; p < passes; p++) {
    for (let pct = 0; pct <= 100; pct += 10) {
      process.stdout.write(`[hal] ${pct.toFixed(1).padStart(5)}% ${pct * 1000} 100000 NA\n`);
      fs.appendFileSync(part, "x".repeat(64));
      await sleep(delay);
    }
  }
  if (fs.existsSync(src)) fs.copyFileSync(src, out); else fs.renameSync(part, out);
  if (fs.existsSync(part)) fs.unlinkSync(part);
  // "mangled": the path as yt-dlp prints it on a console that is not UTF-8 (accents become another character)
  process.stdout.write(`[hal-file] ${/mangled/.test(url) ? out.replace(/e/g, "\ufffd") : out}\n`);
})();
