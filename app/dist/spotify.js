// Spotify links in the Downloader (window.__spotify). Spotify's audio is DRM-protected and never downloaded:
// only its public metadata (title, artists, album, length, date, cover) is read from the track's web page and
// its embed page, the song is looked for on YouTube Music and YouTube with yt-dlp, the results are scored
// by title, artist and length, and the chosen one is downloaded and tagged with Spotify's metadata and cover.
// A classic script; the scoring has no DOM and is also loaded by the Node tests (module.exports).
(() => {
"use strict";

/* ---------- links ---------- */
// open.spotify.com/(intl-xx/)(embed/)track/<22 chars>
function parseLink(url) {
  const m = /^https?:\/\/(?:open|play)\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|playlist|artist|episode|show)\/([A-Za-z0-9]{22})/i.exec(String(url || "").trim());
  return m ? { kind: m[1].toLowerCase(), id: m[2] } : null;
}

/* ---------- metadata from the public pages ---------- */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const unescape = s => String(s).replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m);
// <meta property|name="…" content="…"> of the track page (Open Graph and music:* tags)
function pageMeta(html) {
  const tags = {};
  for (const [tag] of String(html || "").matchAll(/<meta\b[^>]*>/gi)) {
    const a = {};
    for (const [, k, v] of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) a[k.toLowerCase()] = unescape(v);
    const key = a.property || a.name;
    if (key && a.content != null && !(key in tags)) tags[key] = a.content;
  }
  // og:description of a track: "Artist · Album · Song · 2019"
  const parts = (tags["og:description"] || "").split(" · ").map(s => s.trim());
  const desc = parts.length >= 4 && /^\d{4}$/.test(parts[parts.length - 1]) ? { artist: parts[0], album: parts[1], year: parts[parts.length - 1] } : {};
  const musicians = tags["music:musician_description"];
  return {
    title: tags["og:title"] || "", album: desc.album || "", cover: tags["og:image"] || "",
    artists: musicians ? musicians.split(/\s*,\s*/).filter(Boolean) : desc.artist ? [desc.artist] : [],
    duration: +tags["music:duration"] || 0, date: tags["music:release_date"] || desc.year || "", track: +tags["music:album:track"] || 0
  };
}
// The embed page carries the track as JSON (__NEXT_DATA__ → props.pageProps.state.data.entity)
function embedMeta(html) {
  const m = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(String(html || ""));
  if (!m) return null;
  let e; try { const j = JSON.parse(m[1]); e = j.props && j.props.pageProps && j.props.pageProps.state && j.props.pageProps.state.data && j.props.pageProps.state.data.entity; } catch (err) { return null; }
  if (!e) return null;
  const imgs = [...((e.coverArt && e.coverArt.sources) || []), ...((e.visualIdentity && e.visualIdentity.image) || [])].filter(x => x && x.url);
  imgs.sort((a, b) => (b.width || b.maxWidth || 0) - (a.width || a.maxWidth || 0));
  return {
    title: e.name || e.title || "", artists: (e.artists || []).map(a => a && a.name).filter(Boolean),
    duration: (e.duration || 0) / 1000, date: (e.releaseDate && e.releaseDate.isoString || "").slice(0, 10), cover: imgs.length ? imgs[0].url : ""
  };
}
// An album's embed page: its name, artist, cover and track list (trackList: uri, title, subtitle with the artists,
// duration in ms); null when the page has no track list
function albumMeta(html) {
  const m = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(String(html || ""));
  if (!m) return null;
  let e; try { const j = JSON.parse(m[1]); e = j.props && j.props.pageProps && j.props.pageProps.state && j.props.pageProps.state.data && j.props.pageProps.state.data.entity; } catch (err) { return null; }
  if (!e || !Array.isArray(e.trackList) || !e.trackList.length) return null;
  // the cover: coverArt.sources, or visualIdentity.image (300, 64 and 640 px) on album pages
  const imgs = [...((e.coverArt && e.coverArt.sources) || []), ...((e.visualIdentity && e.visualIdentity.image) || [])].filter(x => x && x.url).sort((a, b) => (b.width || b.maxWidth || 0) - (a.width || a.maxWidth || 0));
  const tracks = e.trackList.map(x => {
    const id = (/^spotify:track:([A-Za-z0-9]{22})$/.exec(x && x.uri || "") || [])[1];
    return id && { id, url: "https://open.spotify.com/track/" + id, title: x.title || "", artist: x.subtitle || "", duration: (x.duration || 0) / 1000 };
  }).filter(Boolean);
  if (!tracks.length) return null;
  return { title: e.name || e.title || "", artist: e.subtitle || (e.artists || []).map(a => a && a.name).filter(Boolean).join(", "),
    date: (e.releaseDate && e.releaseDate.isoString || "").slice(0, 10), cover: imgs.length ? imgs[0].url : "", tracks };
}
const fetchAlbum = (get, link) => get("https://open.spotify.com/embed/album/" + link.id).then(albumMeta, () => null);
// Both pages at once; the oEmbed answer (title and cover only) when neither can be read
async function fetchMeta(get, link, url) {
  const page = "https://open.spotify.com/track/" + link.id, embed = "https://open.spotify.com/embed/track/" + link.id;
  const [p, e] = await Promise.all([get(page).then(pageMeta, () => null), get(embed).then(embedMeta, () => null)]);
  let o = null;
  if (!(p && p.title) && !(e && e.title)) o = JSON.parse(await get("https://open.spotify.com/oembed?url=" + encodeURIComponent(url)));
  const a = e || {}, b = p || {};
  const artists = (a.artists && a.artists.length ? a.artists : b.artists) || [];
  return {
    id: link.id, url: page, title: a.title || b.title || (o && o.title) || "", artists, album: b.album || "",
    duration: a.duration || b.duration || 0, date: a.date || b.date || "", track: b.track || 0,
    cover: a.cover || b.cover || (o && o.thumbnail_url) || ""
  };
}

/* ---------- scoring ---------- */
const norm = s => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/&/g, " and ").replace(/['’`]/g, "");
const words = s => norm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
// Words that say nothing about which song it is
const NOISE = new Set("official music video audio lyric lyrics letra visualizer visualiser oficial hd hq 4k 1080p remaster remastered version explicit clean mv topic feat ft featuring with".split(" "));
// Versions that are another recording: they cost half the score unless the Spotify title says so too
const VARIANTS = ["live", "cover", "remix", "karaoke", "instrumental", "acoustic", "sped up", "slowed", "reverb", "8d", "nightcore", "bass boosted", "extended", "mashup", "reaction", "tutorial", "piano version"];
// "Song (feat. X) - Remastered 2011" → "Song"; brackets that are only noise or a featured artist go
const cleanTitle = s => String(s || "").replace(/[([][^)\]]*[)\]]/g, g => /\b(feat|ft|featuring|with)\b\.?/i.test(g) || words(g).every(w => NOISE.has(w) || /^\d{4}$/.test(w)) ? " " : g)
  .replace(/\s[-–]\s[^-–]*\bremaster(ed)?\b.*$/i, "").replace(/\s+/g, " ").trim();
const channelName = s => String(s || "").replace(/\s*-\s*topic$/i, "").replace(/vevo$/i, "").replace(/\bofficial\b/i, "");
const hasVariant = (s, v) => new RegExp("(^|[^\\p{L}\\p{N}])" + v.replace(/ /g, "\\s*") + "($|[^\\p{L}\\p{N}])", "u").test(norm(s));
const DUR_OK = 2, DUR_ZERO = 30;

// meta: Spotify track; c: { title, artist, channel, duration, source }. Returns parts and total, 0…1.
function score(meta, c) {
  const T = new Set(words(cleanTitle(meta.title)).filter(w => !NOISE.has(w)));
  const artistWords = new Set(meta.artists.flatMap(words));
  const C = words(cleanTitle(c.title)).filter(w => !NOISE.has(w) && (!artistWords.has(w) || T.has(w)));
  const hit = [...new Set(C)].filter(w => T.has(w)).length;
  const title = T.size ? 0.75 * hit / T.size + 0.25 * hit / Math.max(1, new Set(C).size) : 0;
  let artist = 0.5;
  if (meta.artists.length) {
    const A = words(meta.artists[0]), hay = [c.artist, channelName(c.channel), c.title].join(" "), H = new Set(words(hay));
    const joined = norm(hay).replace(/[^\p{L}\p{N}]/gu, "");
    artist = A.length && joined.includes(A.join("")) ? 1 : A.length ? A.filter(w => H.has(w)).length / A.length : 0.5;
  }
  let duration = 0.5;
  if (meta.duration > 0 && c.duration > 0) {
    const d = Math.abs(meta.duration - c.duration);
    duration = d <= DUR_OK ? 1 : Math.max(0, 1 - (d - DUR_OK) / (DUR_ZERO - DUR_OK));
  }
  const variant = VARIANTS.find(v => hasVariant(c.title, v) && !hasVariant(meta.title, v)) || "";
  let total = (0.45 * title + 0.25 * artist + 0.3 * duration) * (variant ? 0.5 : 1) + (c.source === "ytmusic" ? 0.03 : 0);
  total = Math.min(1, total);
  return { total, title, artist, duration, variant };
}
// Best 3, one per video (a song found on both keeps its YouTube Music entry and its best score)
function rank(meta, list, n = 3) {
  const by = new Map();
  for (const c of list) {
    if (!c || !c.id) continue;
    const s = score(meta, c), prev = by.get(c.id);
    if (!prev || s.total > prev.score.total || (s.total === prev.score.total && c.source === "ytmusic")) by.set(c.id, Object.assign({}, c, { score: s }));
  }
  return [...by.values()].sort((a, b) => b.score.total - a.score.total).slice(0, n);
}

/* ---------- search with yt-dlp ---------- */
// "Artist Song" without the featured artists and the "Remastered" suffix
const query = meta => [meta.artists[0] || "", cleanTitle(meta.title).replace(/\s+/g, " ").trim()].filter(Boolean).join(" ");
const musicSearch = q => "https://music.youtube.com/search?q=" + encodeURIComponent(q) + "#songs";
const watch = id => "https://www.youtube.com/watch?v=" + id;
const entries = j => (j && Array.isArray(j.entries) ? j.entries : []).filter(Boolean);
// YouTube Music songs (full entries: track, artists, album, length)
const fromMusic = e => e.id && ({ id: e.id, url: watch(e.id), source: "ytmusic", title: e.track || e.title || "",
  artist: (e.artists && e.artists.join(", ")) || e.artist || e.creator || "", channel: e.channel || e.uploader || "", duration: e.duration || 0 });
// YouTube search (flat entries: title, channel, length); no Shorts or live streams
const fromYoutube = e => e.id && !/\/shorts\//.test(e.url || "") && !/^(is_live|is_upcoming)$/.test(e.live_status || "") && ({ id: e.id, url: watch(e.id), source: "youtube",
  title: e.title || "", artist: "", channel: e.channel || e.uploader || "", duration: e.duration || 0 });
// run(args) → parsed JSON of yt-dlp -J, or null
async function search(run, meta) {
  const q = query(meta);
  const [m, y] = await Promise.all([
    run(["-J", "--no-warnings", "--ignore-errors", "--playlist-items", "1:3", musicSearch(q)]).catch(() => null),
    run(["-J", "--no-warnings", "--flat-playlist", "ytsearch5:" + q + " audio"]).catch(() => null)
  ]);
  return rank(meta, [...entries(m).map(fromMusic), ...entries(y).map(fromYoutube)]);
}

/* ---------- tags ---------- */
// File name: "Artist, Artist - Song"
const fileStem = meta => [meta.artists.join(", "), meta.title].filter(Boolean).join(" - ") || "Spotify " + meta.id;
// FFmpeg: the downloaded audio as it is (no re-encoding) with Spotify's tags and, if given, its cover
function tagArgs(meta, src, cover, out, from) {
  const md = { title: meta.title, artist: meta.artists.join(", "), album_artist: meta.artists[0] || "", album: meta.album, date: meta.date, track: meta.track || "",
    comment: "Tags: Spotify " + meta.url + " · Audio: YouTube " + (from || "") };
  const a = ["-hide_banner", "-loglevel", "error", "-nostdin", "-y", "-i", src];
  if (cover) a.push("-i", cover, "-map", "0:a", "-map", "1:v", "-c", "copy", "-disposition:v:0", "attached_pic");
  else a.push("-map", "0:a", "-c", "copy");
  a.push("-map_metadata", "-1");
  for (const [k, v] of Object.entries(md)) if (v) a.push("-metadata", `${k}=${v}`);
  if (/\.mp3$/i.test(out)) a.push("-id3v2_version", "3");
  a.push(out);
  return a;
}

const api = { parseLink, pageMeta, embedMeta, albumMeta, fetchMeta, fetchAlbum, cleanTitle, score, rank, query, search, fileStem, tagArgs, DUR_OK, DUR_ZERO };
if (typeof window !== "undefined") window.__spotify = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
