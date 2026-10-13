// The artist profile's readers (window.__artist): links, public pages and APIs of YouTube, Spotify and SoundCloud
// read into { name, avatar, banner, followers, links, releases } with remote image URLs, the search of an artist by
// name or link, and the Cover Test's feed of platform content (docs/COVER_TEST_SPEC.md §4, §5). Only public metadata,
// no login and no keys; Spotify's audio never. Every reader takes a page's text and answers empty when the page
// lacks the data (the pages change: several paths are tried, the caller keeps the last good copy).
// A classic script without DOM, also loaded by the Node tests (module.exports). The requests go through io:
// { text(url, browser) → string, json(url, browser) → object }.
(() => {
"use strict";

/* ===== links ===== */
const PLATFORMS = ["youtube", "spotify", "soundcloud"];
// Any link or handle of the three → { platform, url (canonical), id | handle | permalink }; null for anything else
function parseLink(s) {
  s = String(s || "").trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s) && /^(www\.|m\.)?(youtube\.com|youtu\.be|open\.spotify\.com|soundcloud\.com)\//i.test(s)) s = "https://" + s;
  let m = /^https?:\/\/(?:open|play)\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:embed\/)?artist\/([A-Za-z0-9]{22})/i.exec(s);
  if (m) return { platform: "spotify", id: m[1], url: "https://open.spotify.com/artist/" + m[1] };
  m = /^https?:\/\/(?:www\.|m\.|music\.)?youtube\.com\/(?:channel\/(UC[\w-]{22})|(@[\w.\-·]{3,})|c\/([\w.-]+)|user\/([\w.-]+))/i.exec(s);
  if (m) {
    if (m[1]) return { platform: "youtube", id: m[1], url: "https://www.youtube.com/channel/" + m[1] };
    const path = m[2] || (m[3] ? "c/" + m[3] : "user/" + m[4]);
    return { platform: "youtube", handle: m[2] || "", url: "https://www.youtube.com/" + path };
  }
  m = /^https?:\/\/(?:www\.|m\.)?soundcloud\.com\/([\w-]+)\/?(?:[?#].*)?$/i.exec(s);
  if (m && !/^(discover|search|stream|you|upload|charts|pages|terms-of-use|mobile|signin|people|tags|stations)$/i.test(m[1])) return { platform: "soundcloud", permalink: m[1].toLowerCase(), url: "https://soundcloud.com/" + m[1].toLowerCase() };
  return null;
}
const isLink = s => /^(https?:\/\/|www\.)|\.(com|be)\//i.test(String(s || "").trim());

/* ===== text ===== */
const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const unescape = s => String(s).replace(/&(#x[\da-f]+|#\d+|\w+);/gi, (m, e) => e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] != null ? ENT[e.toLowerCase()] : m);
function metaTags(html) {
  const tags = {};
  for (const [tag] of String(html || "").matchAll(/<meta\b[^>]*>/gi)) {
    const a = {};
    for (const [, k, v] of tag.matchAll(/([\w:-]+)\s*=\s*"([^"]*)"/g)) a[k.toLowerCase()] = unescape(v);
    const key = a.property || a.name || a.itemprop;
    if (key && a.content != null && !(key in tags)) tags[key] = a.content;
  }
  return tags;
}
// "1.2M subscribers", "12,400 followers", "5.1K", "1,2 M" → a number; 0 when there is none
function count(s) {
  const m = /([\d.,\s]*\d)\s*([KMB])?/i.exec(String(s || "").replace(/ /g, " "));
  if (!m) return 0;
  let n = m[1].replace(/\s/g, "");
  if (m[2]) n = n.replace(",", "."); else n = n.replace(/[.,](?=\d{3}(\D|$))/g, "");
  const v = parseFloat(n) * (m[2] ? { k: 1e3, m: 1e6, b: 1e9 }[m[2].toLowerCase()] : 1);
  return isFinite(v) ? Math.round(v) : 0;
}
// "3:12", "1:02:03" → seconds
const clock = s => { const p = String(s || "").trim().split(":").map(Number); return p.length > 1 && p.every(isFinite) ? p.reduce((a, b) => a * 60 + b, 0) : 0; };
// The JSON object assigned in a page's script: `var ytInitialData = {…};`, `window.__sc_hydration = […];`
function scriptJSON(html, name) {
  const s = String(html || ""), at = s.search(new RegExp("(?:var\\s+|window\\.|window\\[\"|\\b)" + name.replace(/[$.]/g, "\\$&") + "\"?\\]?\\s*=\\s*[\\[{]"));
  if (at < 0) return null;
  const start = s.indexOf(s.slice(at).match(/[[{]/)[0], at);
  let depth = 0, str = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const c = s[i];
    if (str) { if (esc) esc = false; else if (c === "\\") esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true;
    else if (c === "{" || c === "[") depth++;
    else if (c === "}" || c === "]") { if (--depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { return null; } } }
  }
  return null;
}
// Every value under `key` anywhere in a JSON tree (depth first, in document order)
function findAll(o, key, out = [], depth = 0) {
  if (!o || typeof o !== "object" || depth > 60) return out;
  if (Array.isArray(o)) { for (const x of o) findAll(x, key, out, depth + 1); return out; }
  for (const k of Object.keys(o)) {
    if (k === key) out.push(o[k]);
    findAll(o[k], key, out, depth + 1);
  }
  return out;
}
const first = (o, key) => findAll(o, key)[0];
// YouTube's text: { simpleText } | { runs: [{ text }] } | { content }
const ytText = t => !t ? "" : typeof t === "string" ? t : t.simpleText || t.content || (Array.isArray(t.runs) ? t.runs.map(r => r.text).join("") : "");
// The largest image of a list of { url, width }
const largest = list => { const l = (Array.isArray(list) ? list : []).filter(x => x && x.url); l.sort((a, b) => (b.width || b.maxWidth || 0) - (a.width || a.maxWidth || 0)); return l.length ? abs(l[0].url) : ""; };
const abs = u => !u ? "" : u.startsWith("//") ? "https:" + u : u;
// Links to the other platforms anywhere in a page (plain, escaped or inside a redirect)
function crossLinks(text) {
  const s = String(text || "").replace(/\\u0026/g, "&").replace(/\\\//g, "/");
  let d = s; try { d = s.replace(/%[0-9a-f]{2}/gi, m => { try { return decodeURIComponent(m); } catch (e) { return m; } }); } catch (e) {}
  const out = {};
  for (const [u] of d.matchAll(/https?:\/\/(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?artist\/[A-Za-z0-9]{22}|(?:www\.|m\.)?soundcloud\.com\/[\w-]+|(?:www\.)?youtube\.com\/(?:channel\/UC[\w-]{22}|@[\w.-]{3,}))/gi)) {
    const l = parseLink(u);
    if (l && !out[l.platform]) out[l.platform] = l.url;
  }
  return out;
}

/* ===== youtube ===== */
const YT = "https://www.youtube.com";
function ytChannel(html) {
  const d = scriptJSON(html, "ytInitialData"), tags = metaTags(html), out = { name: "", id: "", url: "", avatar: "", banner: "", followers: 0, handle: "", links: {} };
  const meta = d && first(d, "channelMetadataRenderer");
  if (meta) {
    out.name = meta.title || ""; out.id = meta.externalId || "";
    out.avatar = largest(meta.avatar && meta.avatar.thumbnails);
    const v = /youtube\.com\/(@[^/?#]+)/.exec(meta.vanityChannelUrl || ""); if (v) out.handle = decodeURIComponent(v[1]);
  }
  const ph = d && first(d, "pageHeaderViewModel");
  if (ph) {
    out.name = out.name || ytText(ph.title && ph.title.dynamicTextViewModel && ph.title.dynamicTextViewModel.text);
    out.avatar = out.avatar || largest(first(ph, "avatarViewModel") && first(ph, "avatarViewModel").image && first(ph, "avatarViewModel").image.sources);
    const b = first(ph, "imageBannerViewModel"); if (b) out.banner = largest(b.image && b.image.sources);
    for (const part of findAll(first(ph, "contentMetadataViewModel") || {}, "text").map(ytText)) {
      if (/^@/.test(part) && !out.handle) out.handle = part.trim();
      if (/subscriber/i.test(part)) out.followers = count(part);
    }
  }
  const c4 = d && first(d, "c4TabbedHeaderRenderer");
  if (c4) {
    out.name = out.name || c4.title || ""; out.id = out.id || c4.channelId || "";
    out.avatar = out.avatar || largest(c4.avatar && c4.avatar.thumbnails);
    out.banner = out.banner || largest(c4.banner && c4.banner.thumbnails);
    out.followers = out.followers || count(ytText(c4.subscriberCountText));
  }
  out.name = out.name || tags["og:title"] || "";
  out.avatar = out.avatar || tags["og:image"] || "";
  if (!out.id) { const m = /"(?:externalId|channelId|browseId)"\s*:\s*"(UC[\w-]{22})"/.exec(String(html || "")); if (m) out.id = m[1]; }
  out.url = out.handle ? YT + "/" + out.handle : out.id ? YT + "/channel/" + out.id : "";
  out.banner = out.banner && out.banner.replace(/=w\d+-[^?]*$/, "=w1280-fcrop64=1,00005a57ffffa5a8-k-c0xffffffff-no-nd-rj");
  const links = crossLinks(html); delete links.youtube; out.links = links;
  return out;
}
// A video of any list (channel videos, search, sidebar): videoRenderer, gridVideoRenderer or lockupViewModel
function ytVideo(v, kind) {
  if (kind === "lockupViewModel") {
    if (v.contentType && !/VIDEO/.test(v.contentType)) return null;
    const md = first(v, "lockupMetadataViewModel") || {}, metadataParts = findAll(md.metadata || {}, "metadataParts").flat(), parts = metadataParts.map(p => ytText(p && p.text));
    const badge = findAll(v.contentImage || {}, "thumbnailBadgeViewModel").map(b => b.text).find(t => /^\d+:\d/.test(t || "")) || "";
    // Channel cards omit "views" from the visible count; their play icon identifies the same metadata.
    const viewPart = metadataParts.find(p => p && (/view/i.test(ytText(p.text)) || p.leadingIcon && p.leadingIcon.name === "PLAY_ARROW_OUTLINED"));
    const views = ytText(viewPart && viewPart.text), date = parts.find(p => /ago|hace|streamed/i.test(p)) || "";
    return v.contentId ? { id: v.contentId, title: ytText(md.title), channel: parts.find(p => p && p !== views && p !== date) || "", views: count(views), date, duration: clock(badge),
      image: largest(first(v.contentImage || {}, "sources")), avatar: largest(first(md, "avatarViewModel") && first(md, "avatarViewModel").image && first(md, "avatarViewModel").image.sources) } : null;
  }
  if (!v.videoId) return null;
  const owner = v.ownerText || v.longBylineText || v.shortBylineText;
  const avatar = v.channelThumbnailSupportedRenderers && v.channelThumbnailSupportedRenderers.channelThumbnailWithLinkRenderer;
  const length = ytText(v.lengthText) || (findAll(v.thumbnailOverlays || [], "thumbnailOverlayTimeStatusRenderer").map(x => ytText(x.text))[0] || "");
  return { id: v.videoId, title: ytText(v.title), channel: ytText(owner), views: count(ytText(v.viewCountText) || ytText(v.shortViewCountText)), date: ytText(v.publishedTimeText),
    duration: clock(length), image: "https://i.ytimg.com/vi/" + v.videoId + "/hqdefault.jpg", avatar: largest(avatar && avatar.thumbnail && avatar.thumbnail.thumbnails) };
}
function ytVideos(html, n = 10) {
  const d = scriptJSON(html, "ytInitialData"), out = [], seen = new Set();
  if (!d) return out;
  // document order: walk once, collecting the three kinds as they come
  (function walk(o, depth) {
    if (!o || typeof o !== "object" || depth > 60 || out.length >= n) return;
    if (Array.isArray(o)) { for (const x of o) walk(x, depth + 1); return; }
    for (const k of Object.keys(o)) {
      if ((k === "videoRenderer" || k === "gridVideoRenderer" || k === "lockupViewModel" || k === "compactVideoRenderer") && o[k] && typeof o[k] === "object") {
        const v = ytVideo(o[k], k);
        if (v && !seen.has(v.id)) { seen.add(v.id); v.url = YT + "/watch?v=" + v.id; out.push(v); }
        continue;
      }
      walk(o[k], depth + 1);
    }
  })(d, 0);
  return out.slice(0, n);
}
function ytSearchChannels(html, n = 3) {
  const d = scriptJSON(html, "ytInitialData");
  return (d ? findAll(d, "channelRenderer") : []).map(c => {
    const texts = [ytText(c.subscriberCountText), ytText(c.videoCountText)];
    const handle = texts.find(t => /^@/.test(t)) || ((c.navigationEndpoint && first(c.navigationEndpoint, "canonicalBaseUrl")) || "").replace(/^\//, "");
    return { platform: "youtube", name: ytText(c.title), id: c.channelId, avatar: abs(largest(c.thumbnail && c.thumbnail.thumbnails)),
      followers: count(texts.find(t => /subscriber/i.test(t)) || ""), url: /^@/.test(handle) ? YT + "/" + handle : YT + "/channel/" + c.channelId };
  }).filter(c => c.id).slice(0, n);
}

/* ===== soundcloud ===== */
const SC_API = "https://api-v2.soundcloud.com";
const scImage = (u, size = "t500x500") => abs(u || "").replace(/-(large|t\d+x\d+|crop|original)\./, "-" + size + ".");
function scHydration(html) {
  const h = scriptJSON(html, "__sc_hydration");
  const of = kind => (Array.isArray(h) ? h : []).find(x => x && x.hydratable === kind);
  const u = of("user"), c = of("apiClient");
  return { user: u && u.data || null, clientId: c && c.data && c.data.id || "" };
}
function scUser(u) {
  if (!u || !u.id) return null;
  const vis = u.visuals && Array.isArray(u.visuals.visuals) && u.visuals.visuals[0];
  return { name: u.username || u.full_name || "", id: String(u.id), url: u.permalink_url || "https://soundcloud.com/" + (u.permalink || ""), avatar: scImage(u.avatar_url),
    banner: vis && vis.visual_url ? abs(vis.visual_url) : "", followers: u.followers_count || 0 };
}
function scTrack(t) {
  if (!t || !t.id) return null;
  const u = t.user || {};
  return { id: String(t.id), title: t.title || "", channel: u.username || "", url: t.permalink_url || "", image: scImage(t.artwork_url || u.avatar_url), avatar: scImage(u.avatar_url, "t120x120"),
    views: t.playback_count || 0, likes: t.likes_count || 0, date: String(t.display_date || t.release_date || t.created_at || "").slice(0, 10), duration: Math.round((t.full_duration || t.duration || 0) / 1000),
    genre: t.genre || "", waveform: t.waveform_url || "" };
}
const scCollection = j => (j && Array.isArray(j.collection) ? j.collection : Array.isArray(j) ? j : []);
// The public client id of SoundCloud's web app: in the page's hydration, else in its last scripts
async function scClient(io, html) {
  const h = scHydration(html);
  if (h.clientId) return h.clientId;
  const scripts = [...String(html || "").matchAll(/<script[^>]+src="(https:\/\/a-v2\.sndcdn\.com\/assets\/[^"]+\.js)"/g)].map(m => m[1]).reverse();
  for (const s of scripts.slice(0, 6)) {
    const m = /client_id\s*[:=]\s*"(\w{32})"/.exec(await io.text(s).catch(() => ""));
    if (m) return m[1];
  }
  return "";
}

/* ===== spotify ===== */
const SP_OPEN = "https://open.spotify.com";
function nextData(html) {
  const m = /<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i.exec(String(html || ""));
  if (!m) return null;
  try { const j = JSON.parse(m[1]); return j.props && j.props.pageProps && j.props.pageProps.state && j.props.pageProps.state.data && j.props.pageProps.state.data.entity || null; } catch (e) { return null; }
}
// The artist page's own state (a base64 JSON in <script id="initialState">), where the header image lives
function spState(page) {
  const m = /<script[^>]*id="initialState"[^>]*>([\s\S]*?)<\/script>/i.exec(String(page || ""));
  if (!m) return null;
  try { const b = atob(m[1].trim()); return JSON.parse(new TextDecoder().decode(Uint8Array.from(b, c => c.charCodeAt(0)))); } catch (e) { return null; }
}
// The header image (banner) of the artist: the embed's, else the page's state
const spHeader = (e, st) => largest(e.headerImage && e.headerImage.sources || []) || (st ? largest((first(st, "headerImage") || {}).sources || []) : "");
function spArtist(page, embed) {
  const tags = metaTags(page), e = nextData(embed) || {};
  const imgs = [...((e.visualIdentity && e.visualIdentity.image) || []), ...((e.coverArt && e.coverArt.sources) || [])];
  const desc = tags["og:description"] || "";
  return { name: e.name || e.title || tags["og:title"] || "", avatar: largest(imgs) || tags["og:image"] || "", banner: spHeader(e, spState(page)),
    followers: count((/([\d.,]+\s*[KMB]?)\s+monthly listeners/i.exec(desc) || [])[1] || ""),
    tracks: spTracks(e) };
}
// The track list of an embed entity (artist: its top tracks; playlist: its songs), without covers
function spTracks(e) {
  return ((e && e.trackList) || []).map(t => {
    const id = (/track:([A-Za-z0-9]{22})/.exec(t.uri || "") || [])[1];
    return id ? { id, title: t.title || "", channel: t.subtitle || "", url: SP_OPEN + "/track/" + id, duration: Math.round((t.duration || 0) / 1000), image: "" } : null;
  }).filter(Boolean);
}
// The cover of a track (oEmbed: title and thumbnail)
const spCover = (io, url) => io.json("https://open.spotify.com/oembed?url=" + encodeURIComponent(url)).then(o => o && o.thumbnail_url || "", () => "");
// Spotify has no search without a key: MusicBrainz's links, then a web search of the artist's page
async function spFind(io, name) {
  const out = [];
  try {
    const s = await io.json("https://musicbrainz.org/ws/2/artist?fmt=json&limit=3&query=" + encodeURIComponent('artist:"' + name + '"'));
    for (const a of ((s && s.artists) || []).filter(a => a.score >= 90).slice(0, 2)) {
      const r = await io.json("https://musicbrainz.org/ws/2/artist/" + a.id + "?fmt=json&inc=url-rels").catch(() => null);
      const u = ((r && r.relations) || []).map(x => x.url && x.url.resource).find(u => parseLink(u) && parseLink(u).platform === "spotify");
      if (u) out.push(parseLink(u).url);
    }
  } catch (e) {}
  if (!out.length) {
    const html = await io.text("https://html.duckduckgo.com/html/?q=" + encodeURIComponent("site:open.spotify.com/artist " + name)).catch(() => "");
    for (const [, id] of crossLinksAll(html, /open\.spotify\.com\/(?:intl-[a-z-]+\/)?artist\/([A-Za-z0-9]{22})/g)) if (!out.includes(SP_OPEN + "/artist/" + id)) out.push(SP_OPEN + "/artist/" + id);
  }
  return out.slice(0, 3);
}
const crossLinksAll = (html, re) => { let d = String(html || ""); try { d = decodeURIComponent(d.replace(/%(?![0-9a-f]{2})/gi, "%25")); } catch (e) {} return [...d.matchAll(re)]; };

/* ===== profile of a link ===== */
// { platform, url, id, name, avatar, banner, followers, links, releases[] } with remote images; throws when the
// page cannot be read or has no artist
async function extract(io, link, n = 10) {
  const l = typeof link === "string" ? parseLink(link) : link;
  if (!l) throw new Error("not a YouTube, Spotify or SoundCloud artist link");
  if (l.platform === "youtube") {
    const base = l.url.replace(/\/+$/, "");
    const [page, vids] = await Promise.all([io.text(base, true), n ? io.text(base + "/videos", true).catch(() => "") : ""]);
    const c = ytChannel(page);
    if (!c.name) throw new Error("no channel on this page");
    const releases = ytVideos(vids || page, n).map(v => ({ id: v.id, title: v.title, url: v.url, image: v.image, views: v.views, date: v.date, duration: v.duration }));
    return { platform: "youtube", url: c.url || l.url, id: c.id, name: c.name, avatar: c.avatar, banner: c.banner, followers: c.followers, links: c.links, releases };
  }
  if (l.platform === "soundcloud") {
    const page = await io.text(l.url, true), h = scHydration(page), u = scUser(h.user);
    if (!u) throw new Error("no profile on this page");
    const cid = await scClient(io, page);
    let releases = [], links = crossLinks(page);
    if (cid) {
      const [tr, web] = await Promise.all([
        n ? io.json(`${SC_API}/users/${u.id}/tracks?representation=&limit=${n}&client_id=${cid}`).catch(() => null) : null,
        io.json(`${SC_API}/users/soundcloud:users:${u.id}/web-profiles?client_id=${cid}`).catch(() => null)
      ]);
      releases = scCollection(tr).map(scTrack).filter(Boolean).slice(0, n).map(t => ({ id: t.id, title: t.title, url: t.url, image: t.image, views: t.views, date: t.date, duration: t.duration }));
      links = Object.assign(crossLinks(JSON.stringify(scCollection(web).map(w => w && w.url))), links);
    }
    delete links.soundcloud;
    return { platform: "soundcloud", url: u.url, id: u.id, name: u.name, avatar: u.avatar, banner: u.banner, followers: u.followers, links, releases };
  }
  const [page, embed, metrics] = await Promise.all([io.text(l.url, true).catch(() => ""), io.text(SP_OPEN + "/embed/artist/" + l.id, true).catch(() => ""),
    io.spotifyMetrics ? io.spotifyMetrics(l.id) : null]);
  const a = spArtist(page, embed);
  if (!a.name) throw new Error("no artist on this page");
  const tracks = a.tracks.slice(0, n);
  await Promise.all(tracks.map(async t => { t.image = await spCover(io, t.url); }));
  const plays = new Map(((metrics && metrics.tracks) || []).map(t => [t.id, t.plays]));
  return { platform: "spotify", url: l.url, id: l.id, name: a.name, avatar: a.avatar, banner: a.banner, followers: a.followers, links: {},
    monthlyListeners: metrics && metrics.monthlyListeners != null ? metrics.monthlyListeners : a.followers || null,
    releases: tracks.map(t => ({ id: t.id, title: t.title, url: t.url, image: t.image, views: plays.has(t.id) ? plays.get(t.id) : null, date: "", duration: t.duration })) };
}

/* ===== search ===== */
const norm = s => String(s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
// 1 for the same name (case, accents, spaces and signs aside), less the further apart
function likeness(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.8 * Math.min(a.length, b.length) / Math.max(a.length, b.length) + 0.1;
  const d = [...Array(b.length + 1).keys()];
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; }
  }
  return Math.max(0, 1 - d[b.length] / Math.max(a.length, b.length)) * 0.8;
}
// Candidates by name first, followers break ties; a cross link (the artist's own page says so) goes first
function rank(list, name, n = 3) {
  const s = c => (c.linked ? 2 : 0) + likeness(c.name, name) + Math.min(0.15, Math.log10(1 + (c.followers || 0)) / 50);
  return list.filter(Boolean).map(c => Object.assign(c, { score: Math.round(Math.min(1, likeness(c.name, name) + (c.linked ? 0.5 : 0)) * 100) / 100 }))
    .sort((a, b) => s(b) - s(a)).filter((c, i, all) => all.findIndex(x => x.url === c.url) === i).slice(0, n);
}
// A small card of a profile for "Is this you?"
const card = (p, linked) => ({ platform: p.platform, url: p.url, id: p.id, name: p.name, avatar: p.avatar, followers: p.followers || 0, linked: !!linked });

async function byName(io, platform, name) {
  if (platform === "youtube") {
    return ytSearchChannels(await io.text(YT + "/results?sp=EgIQAg%253D%253D&search_query=" + encodeURIComponent(name), true));
  }
  if (platform === "soundcloud") {
    const cid = await scClient(io, await io.text("https://soundcloud.com/", true));
    if (!cid) return [];
    const j = await io.json(`${SC_API}/search/users?limit=3&q=${encodeURIComponent(name)}&client_id=${cid}`);
    return scCollection(j).map(scUser).filter(Boolean).map(u => Object.assign(card(Object.assign(u, { platform: "soundcloud" }))));
  }
  const urls = await spFind(io, name), out = [];
  await Promise.all(urls.map(async u => { try { out.push(card(await extract(io, u, 0))); } catch (e) {} }));
  return out;
}
// text: a link or a name. → { source: the extracted profile of the link or null, name, candidates: { platform: [card] } }
// `skip`: platforms not to look for (already linked). The links a profile shows to the others come first (the
// artist's own word); by name, YouTube and SoundCloud are searched first and the best match's page gives the links
// to the rest (Spotify has no search without a key).
async function search(io, text, skip = []) {
  text = String(text || "").trim();
  let source = null, name = text;
  const link = parseLink(text);
  if (isLink(text) && !link) throw new Error("not a YouTube, Spotify or SoundCloud artist link");
  if (link) { source = await extract(io, link); name = source.name; }
  const candidates = {}, from = source ? [source] : [];
  const want = PLATFORMS.filter(p => (!source || p !== source.platform) && !skip.includes(p));
  const lookup = async p => {
    const list = [];
    for (const s of from) {
      const u = s.links && s.links[p];
      if (u && !list.some(c => c.url === u)) { try { list.push(card(await extract(io, u, 0), true)); } catch (e) {} }
    }
    if (!list.length) { try { list.push(...await byName(io, p, name)); } catch (e) {} }
    return rank(list, name);
  };
  const first = want.filter(p => p !== "spotify"), then = want.filter(p => p === "spotify");
  await Promise.all(first.map(async p => { candidates[p] = await lookup(p); }));
  if (!source) {
    await Promise.all(first.map(async p => {
      const c = candidates[p][0];
      if (c && c.score >= 0.9) { try { from.push(await extract(io, c.url, 0)); } catch (e) {} }
    }));
  }
  await Promise.all(then.map(async p => { candidates[p] = await lookup(p); }));
  return { source, name, candidates };
}

/* ===== references ===== */
// Another artist as a reference (§5.1): a link or a name → { name, platforms: { platform: profile with its latest n
// releases } } for each platform found (the link's own, its cross links, and a sure match by name); throws when
// nothing is found
async function reference(io, text, n = 2) {
  const { source, name, candidates } = await search(io, text);
  const platforms = {};
  if (source) platforms[source.platform] = Object.assign(source, { releases: source.releases.slice(0, n) });
  await Promise.all(PLATFORMS.filter(p => !platforms[p]).map(async p => {
    const c = (candidates[p] || [])[0];
    if (c && (c.linked || c.score >= 0.9)) { try { platforms[p] = await extract(io, c.url, n); } catch (e) {} }
  }));
  const found = PLATFORMS.map(p => platforms[p]).filter(Boolean);
  if (!found.length) throw new Error("no artist found");
  return { name: source ? source.name : (found.find(p => likeness(p.name, name) >= 0.9) || found[0]).name, platforms };
}

/* ===== feed ===== */
// Real content around the user's cover (§5): up to n items { id, title, channel, url, image, avatar, views, date, duration }
async function feed(io, platform, query, n = 24) {
  if (platform === "youtube") {
    return ytVideos(await io.text(YT + "/results?sp=EgIQAQ%253D%253D&search_query=" + encodeURIComponent(query), true), n);
  }
  if (platform === "soundcloud") {
    const cid = await scClient(io, await io.text("https://soundcloud.com/", true));
    if (!cid) throw new Error("SoundCloud did not answer");
    return scCollection(await io.json(`${SC_API}/search/tracks?limit=${n}&q=${encodeURIComponent(query)}&client_id=${cid}`)).map(scTrack).filter(Boolean).slice(0, n);
  }
  const list = /^[A-Za-z0-9]{22}$/.test(query) ? query : SPOTIFY_FEED;
  const e = nextData(await io.text(SP_OPEN + "/embed/playlist/" + list, true));
  const tracks = spTracks(e).slice(0, n);
  await Promise.all(tracks.map(async t => { t.image = await spCover(io, t.url); }));
  return tracks.filter(t => t.image);
}
const SPOTIFY_FEED = "37i9dQZF1DX4JAvHpjipBk"; // New Music Friday

const api = { PLATFORMS, parseLink, isLink, metaTags, count, clock, scriptJSON, findAll, crossLinks, ytChannel, ytVideos, ytSearchChannels, scHydration, scUser, scTrack, scImage,
  spArtist, spTracks, nextData, extract, likeness, rank, search, byName, reference, feed, SPOTIFY_FEED };
if (typeof window !== "undefined") window.__artist = api;
if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
