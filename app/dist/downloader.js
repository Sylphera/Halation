// Downloader tab: link → preview (yt-dlp -J, Spotify, Apple Music), the three options and the queue. An album link
// lists its songs first; the one chosen opens in the same preview.
(() => {
"use strict";
__i18n.apply(document);
__icons.apply(document);
const { $, esc, setStatus, retryLabel } = window.__ui;
const HAL = window.__hal || (window.parent && window.parent.__hal) || null;
const M = window.__motion;
const SP = window.__spotify;
const t = window.t;
const DAY = 24 * 3600 * 1000;
let engine = { ytdlp: null, ffmpeg: null }, info = null, album = null, jobs = [], seq = 0;
// Halation Preview only (window.__halPreview, set by app/scripts/halation-preview.cjs): simulated links, pictures and
// downloads from dev/downloader-fixture.js, to review the interface without internet. Never loaded in the app.
let dev = null;
const devReady = (() => {
  let preview = false; try { preview = !!window.top.__halPreview; } catch (e) {}
  if (!preview) return Promise.resolve();
  return new Promise(r => { const s = document.createElement("script"); s.src = "dev/downloader-fixture.js"; s.onload = s.onerror = () => { dev = window.__dlDev || null; r(); }; document.head.append(s); });
})();
// A picture's bytes through the app (no direct request from the page). YouTube has no maxresdefault for every video
// (404): then sddefault, hqdefault and mqdefault, the largest first.
const ytSizes = u => /i\.ytimg\.com\/vi(_webp)?\/[^/]+\/maxresdefault\./.test(u) ? ["maxresdefault", "sddefault", "hqdefault", "mqdefault"].map(n => u.replace(/\/vi_webp\//, "/vi/").replace(/maxresdefault\.\w+/, n + ".jpg")) : [u];
async function fetchBytes(u) {
  if (dev && dev.owns(u)) return dev.bytes(u);
  const list = ytSizes(u);
  for (let k = 0; ; k++) {
    try { return await HAL.invoke("http_bytes", { url: k ? list[k] : u }); } catch (e) { if (k >= list.length - 1) throw e; }
  }
}
// "YoutubeTab", "SoundcloudSet", "BandcampAlbum" → the site's name
function siteName(j, url) {
  if (/^https?:\/\/music\.youtube\.com\//i.test(url)) return "YouTube Music";
  const k = String(j.extractor_key || j.extractor || "").replace(/(Tab|Set|Album|Playlist|Track|User|Weekly|:.*)$/i, "");
  return { youtube: "YouTube", soundcloud: "SoundCloud", bandcamp: "Bandcamp", vimeo: "Vimeo", twitter: "X", tiktok: "TikTok", instagram: "Instagram" }[k.toLowerCase()] || k;
}
// Bandcamp and SoundCloud give an album's songs without their details in a flat list: those are read in full (slower)
const fullList = u => /^https?:\/\/([^/]+\.)?(bandcamp\.com|soundcloud\.com)\//i.test(u);
// A short yt-dlp run the user waits for (a link's details, Spotify's sources) or one in the background (the daily
// update), as a job (jobs.js) that shows in the processes tray only if it takes more than 10 s
function quick(kind, args, onLine, background) {
  const h = HAL.jobs.submit({ tool: "downloader", kind, title: kind === "update" ? "yt-dlp" : t("dl.job." + kind), lane: "net", host: "process",
    priority: background ? "background" : "user", silent: true, notify: false,
    run: async ctx => (await ctx.proc("ytdlp", args, onLine)).done });
  return h.done;
}

const oneLine = e => String(e && e.message || e).split(/\r?\n/).map(s => s.trim()).filter(Boolean).pop() || "";
// "ERROR: [youtube] abc123: Video unavailable. This video is private" → "Video unavailable. This video is private"
function readableError(lines) {
  const err = lines.filter(l => /^ERROR:/.test(l)).pop() || lines.filter(Boolean).pop() || "";
  let m = err.replace(/^ERROR:\s*/, "").replace(/^\[[^\]]+\]\s*[^:\s]+:\s*/, "").trim();
  if (/Unsupported URL/i.test(m)) m = t("dl.err.unsupported");
  else if (/Unable to download|urlopen error|getaddrinfo|timed out|Connection/i.test(m) && !/HTTP Error 4/.test(m)) m = t("dl.err.network");
  return m.replace(/\s*\(caused by [^)]*\)$/i, "").slice(0, 240);
}
const fmtDur = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };

/* ---------- engine: yt-dlp + FFmpeg in Documents\Halation\Tools ---------- */
async function refreshEngine(fresh) {
  if (!HAL) return;
  try { const s = await HAL.tools(fresh); engine = { ytdlp: s.ytdlp, ffmpeg: s.ffmpeg }; } catch (e) {}
  $("#engine").hidden = !!(engine.ytdlp && engine.ffmpeg);
  updateButtons();
}
async function installEngine() {
  const btn = $("#installBtn"), st = $("#installStatus");
  btn.disabled = true; $("#installProg").hidden = false; st.className = "status warn"; st.textContent = t("dl.installing");
  const onP = p => { if (p.total) M.bar($("#installBar"), p.done / p.total); st.textContent = t("dl.installingFile", { file: p.file, mb: (p.done / 1e6).toFixed(1) }); };
  try {
    const s = await HAL.tools(true);
    if (!s.ytdlp) await HAL.installTool("ytdlp", onP);
    if (!s.ffmpeg) await HAL.installTool("ffmpeg", onP);
    st.className = "status ok"; st.textContent = t("dl.installed"); retryLabel(btn, "dl.install", false);
    HAL.invoke("state_set", { key: "ytdlpChecked", value: Date.now() }).catch(() => {});
  } catch (e) { st.className = "status bad"; st.textContent = t("dl.err.install", { error: oneLine(e) }); retryLabel(btn, "dl.install", true); }
  btn.disabled = false; $("#installProg").hidden = true;
  await refreshEngine(true);
  if (info && info.spotify && !info.sources && engine.ytdlp) findSources(info);
}
$("#installBtn").addEventListener("click", installEngine);
if (HAL) HAL.on("tools", () => refreshEngine(false));
// yt-dlp -U at most once a day, when the tab opens, for the copy Halation downloaded
async function dailyUpdate() {
  if (!HAL || !engine.ytdlp) return;
  const s = await HAL.tools(false);
  if (!s.ytdlp || !s.ytdlp.startsWith(s.dir)) return;
  const last = await HAL.invoke("state_get", { key: "ytdlpChecked" }).catch(() => 0);
  if (last && Date.now() - last < DAY) return;
  HAL.invoke("state_set", { key: "ytdlpChecked", value: Date.now() }).catch(() => {});
  try { await quick("update", ["-U"], () => {}, true); } catch (e) {}
}

/* ---------- link → preview ---------- */
const isSpotify = u => /^https?:\/\/(open|play)\.spotify\.com\//i.test(u);
const isApple = u => /^https?:\/\/(music|itunes)\.apple\.com\//i.test(u);
// Largest artwork each site gives: SoundCloud "-original", Bandcamp "_0", Spotify 640 px, Apple Music 3000×3000
function bestCoverUrl(url) {
  if (!url) return url;
  if (/sndcdn\.com\//.test(url)) return url.replace(/-(large|t\d+x\d+|crop|small|badge|tiny|mini|original)\.(jpg|png)/, "-original.$2");
  if (/bcbits\.com\/img\//.test(url)) return url.replace(/_\d+\.(jpg|png)$/, "_0.$1");
  if (/i\.scdn\.co\/image\//.test(url)) return url.replace(/ab67616d0000(1e02|4851)/, "ab67616d0000b273");
  if (/mzstatic\.com\//.test(url)) return url.replace(/\/\d+x\d+[a-z]*\.(jpg|png|webp)$/, "/3000x3000bb.jpg");
  return url;
}
// fromAlbum: a song chosen in the album's list (the list stays, behind «Back to the album»)
async function fetchInfo(url, fromAlbum) {
  url = url.trim();
  if (!/^https?:\/\//i.test(url)) { setStatus(t("dl.err.notLink"), "bad"); return; }
  $("#preview").hidden = true; info = null;
  if (!fromAlbum) { album = null; $("#album").hidden = true; }
  setStatus(t("dl.st.reading"), "warn"); $("#goBtn").disabled = true;
  try {
    const r = dev && dev.owns(url) ? await dev.read(url) : isSpotify(url) ? await spotifyInfo(url) : isApple(url) ? await appleInfo(url) : await ytdlpInfo(url, fromAlbum);
    if (r && r.tracks) { album = r; renderAlbum(); setStatus(""); }
    else if (r) { info = r; $("#album").hidden = true; renderPreview(); setStatus(""); if (info.spotify) findSources(info); }
  } catch (e) { setStatus(oneLine(e), "bad"); if (fromAlbum) M.show($("#album"), { y: "sm" }); }
  $("#goBtn").disabled = false;
  HAL?.session?.schedule("downloader");
}
// A Spotify song: its public metadata; the audio is looked for on YouTube (findSources). Albums and playlists: the cover.
async function spotifyInfo(url) {
  const link = SP.parseLink(url), get = u => HAL.invoke("http_text", { url: u });
  // an album: its songs to choose from (each one is then a Spotify song)
  const al = link && link.kind === "album" ? await SP.fetchAlbum(get, link) : null;
  if (al) {
    const cover = bestCoverUrl(al.cover);
    return { url, site: "Spotify", spotify: true, title: al.title, author: [al.artist, al.date.slice(0, 4)].filter(Boolean).join(" · "), cover, thumb: cover,
      tracks: al.tracks.map(x => ({ url: x.url, title: x.title, artist: x.artist, duration: x.duration, thumb: "" })) };
  }
  if (!link || link.kind !== "track") {
    const j = JSON.parse(await get("https://open.spotify.com/oembed?url=" + encodeURIComponent(url)));
    return { url, site: "Spotify", title: j.title || "", author: "", duration: 0, thumb: j.thumbnail_url, cover: bestCoverUrl(j.thumbnail_url), heights: [], audio: false, notice: t("dl.sp.onlyTracks") };
  }
  const m = await SP.fetchMeta(get, link, url);
  if (!m.title) throw new Error(t("dl.err.notFound"));
  const cover = bestCoverUrl(m.cover);
  return { url, site: "Spotify", title: m.title, author: [m.artists.join(", "), m.album].filter(Boolean).join(" · "), duration: m.duration, thumb: cover, cover,
    heights: [], audio: false, notice: t("dl.sp.notice"), spotify: m, sources: null };
}
// YouTube Music and YouTube through yt-dlp, scored against Spotify's title, artist and length; the best 3 to choose from
async function findSources(i) {
  const note = $("#srcNote"), say = msg => { note.textContent = msg; M.reveal(note, !!msg); };
  $("#srcList").innerHTML = "";
  if (!engine.ytdlp) { say(t("dl.sp.noEngine")); M.show($("#engine"), { y: "sm" }); return; }
  say(t("dl.sp.searching"));
  const run = async args => {
    const out = [];
    await quick("search", args, (line, stream) => { if (stream === "out") out.push(line); });
    try { return JSON.parse(out.join("\n")); } catch (e) { return null; }
  };
  const list = await SP.search(run, i.spotify).catch(() => []);
  if (info !== i) return;
  i.sources = list; i.audio = list.length > 0;
  HAL?.session?.schedule("downloader");
  say(!list.length ? t("dl.sp.none") : list[0].score.total < 0.6 ? t("dl.sp.weak") : "");
  M.list($("#srcList"), () => { $("#srcList").innerHTML = list.map(srcRow).join(""); }, { sel: ":scope > .src", key: el => el.dataset.id });
  M.reveal($("#cAudio"), i.audio);
  updateButtons();
}
const SRC = { ytmusic: "dl.sp.ytmusic", youtube: "dl.sp.youtube" };
function srcRow(c, k) {
  const want = info.spotify.duration, d = want && c.duration ? Math.round(c.duration - want) : null;
  const off = d == null ? "" : Math.abs(d) <= SP.DUR_OK ? t("dl.sp.same") : t("dl.sp.off", { s: (d > 0 ? "+" : "\u2212") + Math.abs(d) });
  const pct = Math.round(c.score.total * 100), sub = [c.artist || c.channel, c.duration ? fmtDur(c.duration) : "", off].filter(Boolean).join(" · ");
  return `<label class="src" data-id="${esc(c.id)}"><input type="radio" name="src" value="${k}"${k ? "" : " checked"}><span class="grow"><b>${esc(c.title)}</b><small>${esc(sub)}</small></span>` +
    `<span class="where">${esc(t(SRC[c.source]))}</span><span class="${pct >= 80 ? "badge-ok" : "badge-warn"}">${esc(t("dl.sp.match", { pct }))}</span></label>`;
}
async function appleInfo(url) {
  const u = new URL(url), id = u.searchParams.get("i") || (u.pathname.match(/\/(?:id)?(\d{5,})(?:$|[/?])/) || [])[1];
  if (!id) throw new Error(t("dl.err.unsupported"));
  const r = JSON.parse(await HAL.invoke("http_text", { url: "https://itunes.apple.com/lookup?id=" + id })).results || [];
  const x = r[0]; if (!x) throw new Error(t("dl.err.notFound"));
  return { url, site: "Apple Music", title: x.trackName || x.collectionName || "", author: x.artistName || "", duration: (x.trackTimeMillis || 0) / 1000, thumb: x.artworkUrl100, cover: bestCoverUrl(x.artworkUrl100), heights: [], audio: false, notice: t("dl.appleDrm") };
}
async function ytdlpInfo(url, fromAlbum) {
  if (!engine.ytdlp) { $("#engine").hidden = false; throw new Error(t("dl.err.noEngine")); }
  const out = [], err = [];
  const code = await quick("info", ["-J", "--no-playlist", ...(fullList(url) ? [] : ["--flat-playlist"]), "--playlist-items", "1:" + MAX_TRACKS, "--encoding", "utf-8", "--no-warnings", url], (line, stream) => (stream === "out" ? out : err).push(line));
  if (code !== 0) throw new Error(readableError(err));
  let j; try { j = JSON.parse(out.join("\n")); } catch (e) { throw new Error(t("dl.err.badInfo")); }
  if (j._type === "playlist") {
    if (fromAlbum) throw new Error(t("dl.err.badInfo"));
    return ytdlpAlbum(j, url);
  }
  const heights = [...new Set((j.formats || []).filter(f => f.vcodec && f.vcodec !== "none" && f.height).map(f => f.height))].sort((a, b) => b - a);
  const hasAudio = (j.formats || []).some(f => f.acodec && f.acodec !== "none") || !j.formats;
  const thumbs = (j.thumbnails || []).filter(x => x.url).sort((a, b) => ((b.preference || 0) - (a.preference || 0)) || ((b.width || 0) * (b.height || 0) - (a.width || 0) * (a.height || 0)));
  const cover = bestCoverUrl(j.thumbnail || (thumbs[0] && thumbs[0].url));
  const inList = /[?&]list=/.test(url);
  return { url: j.webpage_url || url, site: siteName(j, url), title: j.title || j.id || "", author: j.uploader || j.artist || j.channel || "", duration: j.duration || 0,
    thumb: j.thumbnail || cover, cover, fallbackCover: j.thumbnail, heights, audio: hasAudio, notice: inList && !album ? t("dl.playlistItem") : "" };
}
// An album, set or playlist (a link to the list itself, not to one of its songs): yt-dlp's flat entries, without
// the ones that are not a song (no link)
const MAX_TRACKS = 300;
const bySize = list => (list || []).filter(x => x && x.url).sort((a, b) => (a.width || 0) * (a.height || 0) - (b.width || 0) * (b.height || 0));
function ytdlpAlbum(j, url) {
  // a flat entry's url is the song's page; a full entry's url is its media stream, its page is webpage_url
  const entryUrl = e => (e._type === "url" || !e.webpage_url) && e.url && /^https?:\/\//i.test(e.url) ? e.url : e.webpage_url || (e.id && /youtube/i.test(e.ie_key || j.extractor_key || "") ? "https://www.youtube.com/watch?v=" + e.id : "");
  // SoundCloud's flat entries have only the link: the name comes from it ("…/night-drive" → "night drive")
  const fromSlug = u => decodeURIComponent((String(u).split(/[?#]/)[0].split("/").filter(Boolean).pop() || "")).replace(/[-_]+/g, " ");
  const tracks = (j.entries || []).filter(Boolean).map(e => {
    const u = entryUrl(e), small = bySize(e.thumbnails).find(x => (x.width || 0) >= 120);
    const big = bySize(e.thumbnails).pop();
    return u && { url: u, title: e.title || e.track || fromSlug(u), artist: e.artist || e.uploader || e.channel || "", duration: e.duration || 0,
      thumb: (small && small.url) || e.thumbnail || "", cover: bestCoverUrl((big && big.url) || e.thumbnail || "") };
  }).filter(Boolean);
  if (!tracks.length) throw new Error(t("dl.err.notFound"));
  const big = bySize(j.thumbnails).pop(), cover = bestCoverUrl(j.thumbnail || (big && big.url) || tracks.find(x => x.cover)?.cover || "");
  // YouTube Music albums have no uploader or channel: the artist most of the songs have
  const most = list => { const n = new Map(); list.filter(Boolean).forEach(x => n.set(x, (n.get(x) || 0) + 1)); return [...n].sort((p, q) => q[1] - p[1])[0]?.[0] || ""; };
  return { url: j.webpage_url || url, site: siteName(j, url), title: j.title || j.id || "", author: j.album_artist || j.uploader || j.channel || j.artist || most(tracks.map(x => x.artist)),
    cover, thumb: cover, tracks };
}
// The album: cover, name, artist and its songs, each with a checkbox, a thumbnail (the album's cover when the song has
// none), the state of its downloads and «Choose» (that song alone, in the preview). The selection goes to the queue
// as one kind of download per song (Add to queue).
function renderAlbum(show = true) {
  const a = album;
  if (!a.sel) a.sel = a.tracks.map((x, k) => k);
  $("#preview").hidden = true;
  $("#aCover").removeAttribute("src"); $("#aCover").hidden = true;
  const total = a.tracks.every(x => x.duration) ? a.tracks.reduce((s, x) => s + x.duration, 0) : 0;
  $("#aTitle").textContent = a.title; $("#aAuthor").textContent = a.author;
  $("#aChips").innerHTML = [a.site, t("dl.album.count", { n: a.tracks.length }), total ? fmtDur(total) : ""].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join("");
  $("#aNotice").textContent = a.notice || ""; $("#aNotice").hidden = !a.notice;
  $("#tracks").innerHTML = a.tracks.map((x, k) => `<div class="track" role="listitem" data-k="${k}"><input type="checkbox" aria-label="${esc(x.title)}"><span class="n">${k + 1}</span><img class="tthumb" alt="">` +
    `<span class="grow"><b>${esc(x.title)}</b><small>${esc([x.artist, x.duration ? fmtDur(x.duration) : ""].filter(Boolean).join(" · "))}</small></span>` +
    `<span class="tstate"></span><button class="btn sm" type="button" data-act="pick">${esc(t("dl.album.pick"))}</button></div>`).join("");
  // Spotify: no video; one cover for the whole album
  const kinds = a.spotify ? ["audio", "cover"] : ["audio", "video", "cover"];
  if (!kinds.includes(a.kind)) a.kind = "audio";
  $("#bKind").querySelectorAll(".tab").forEach(b => { b.hidden = !kinds.includes(b.dataset.k); b.setAttribute("aria-checked", String(b.dataset.k === a.kind)); });
  renderSelection(); trackStates();
  if (show) M.show($("#album"), { y: "sm" }); else $("#album").hidden = true;
  loadThumbs(a);
}
function renderSelection() {
  const a = album; if (!a) return;
  const n = a.sel.length, all = n === a.tracks.length;
  [...$("#tracks").children].forEach((row, k) => { const on = a.sel.includes(k); row.classList.toggle("on", on); row.querySelector("input").checked = on; });
  $("#selAll").checked = all && n > 0; $("#selAll").indeterminate = n > 0 && !all;
  $("#selCount").textContent = t("dl.album.selected", { n, total: a.tracks.length });
  $("#bAudio").hidden = a.kind !== "audio"; $("#bQuality").hidden = a.kind !== "video";
  const covers = a.kind === "cover" && a.spotify ? 1 : n;
  $("#addSel").querySelector(".lbl").textContent = t("dl.album.add", { n: covers });
  $("#addSel").disabled = !n || (a.kind !== "cover" && !engine.ytdlp && !a.dev);
}
// Each song's downloads, as the queue shows them: waiting, a percentage, saved, failed or cancelled
const TSTATE = { pending: ["badge-info", "dl.q.pending"], running: ["badge-warn", ""], done: ["badge-ok", "dl.album.saved"], error: ["badge-bad", "dl.album.failed"], cancelled: ["badge-info", "dl.q.cancelled"] };
const STATE_ORDER = ["running", "pending", "error", "cancelled", "done"];
function trackStates() {
  const a = album; if (!a) return;
  [...$("#tracks").children].forEach((row, k) => {
    const mine = jobs.filter(j => j.track === a.tracks[k].url), j = STATE_ORDER.map(s => mine.find(x => x.state === s)).find(Boolean);
    const el = row.querySelector(".tstate");
    if (!j) { el.className = "tstate"; el.textContent = ""; return; }
    const [cls, key] = TSTATE[j.state];
    el.className = "tstate " + cls; el.textContent = key ? t(key) : t("dl.q.progress", { pct: Math.round(j.progress * 100) });
  });
}
// Thumbnails through the app (no direct request from the page), four at a time; the same picture is fetched once
async function loadThumbs(a) {
  const cache = new Map(), get = u => {
    if (!cache.has(u)) cache.set(u, fetchBytes(u).then(b => URL.createObjectURL(new Blob([b]))));
    return cache.get(u);
  };
  const show = (img, u) => get(u).then(src => { if (album === a) { img.src = src; img.hidden = false; } }).catch(() => {});
  const firstPic = (a.tracks.find(x => x.cover || x.thumb) || {});
  const alt = firstPic.cover || firstPic.thumb;
  if (a.thumb || alt) (a.thumb ? get(a.thumb) : Promise.reject()).catch(() => get(alt)).then(src => { if (album === a) { $("#aCover").src = src; $("#aCover").hidden = false; } }).catch(() => {});
  const rows = [...$("#tracks").children];
  let next = 0;
  const lane = async () => { while (album === a && next < rows.length) { const k = next++, u = a.tracks[k].thumb || a.thumb; if (u) await show(rows[k].querySelector(".tthumb"), u); } };
  await Promise.all([lane(), lane(), lane(), lane()]);
}
// A click on a row (not on «Choose») checks or unchecks it
$("#tracks").addEventListener("click", e => {
  const row = e.target.closest(".track"); if (!row || !album) return;
  const k = +row.dataset.k, x = album.tracks[k]; if (!x) return;
  if (e.target.closest("[data-act=pick]")) { $("#album").hidden = true; fetchInfo(x.url, true); return; }
  const on = e.target.matches("input") ? e.target.checked : !album.sel.includes(k);
  album.sel = album.sel.filter(i => i !== k); if (on) album.sel.push(k);
  album.sel.sort((p, q) => p - q);
  renderSelection(); HAL?.session?.schedule("downloader");
});
$("#selAll").addEventListener("change", e => {
  if (!album) return;
  album.sel = e.target.checked ? album.tracks.map((x, k) => k) : [];
  renderSelection(); HAL?.session?.schedule("downloader");
});
$("#bKind").addEventListener("click", e => {
  const b = e.target.closest(".tab"); if (!b || !album) return;
  album.kind = b.dataset.k;
  $("#bKind").querySelectorAll(".tab").forEach(x => x.setAttribute("aria-checked", String(x === b)));
  renderSelection(); HAL?.session?.schedule("downloader");
});
$("#addSel").addEventListener("click", e => addSelected(e.currentTarget));
$("#backAlbum").addEventListener("click", () => {
  if (!album) return;
  info = null; $("#preview").hidden = true; setStatus("");
  M.show($("#album"), { y: "sm" }); trackStates();
  HAL?.session?.schedule("downloader");
});
function renderPreview() {
  const i = info;
  // the thumbnail comes through the app (no direct request from the page)
  $("#pThumb").removeAttribute("src"); $("#pThumb").hidden = !i.thumb;
  if (i.thumb) fetchBytes(i.thumb).then(b => { if (info === i) $("#pThumb").src = URL.createObjectURL(new Blob([b])); }).catch(() => { $("#pThumb").hidden = true; });
  $("#pTitle").textContent = i.title; $("#pAuthor").textContent = i.author;
  $("#pChips").innerHTML = [i.site, i.duration ? fmtDur(i.duration) : "", i.heights.length ? i.heights[0] + "p" : ""].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join("");
  $("#pNotice").textContent = i.notice || ""; $("#pNotice").hidden = !i.notice;
  $("#pSources").hidden = !i.spotify; $("#srcNote").hidden = true; $("#srcList").innerHTML = "";
  $("#quality").innerHTML = i.heights.map(h => `<option value="${h}">${esc(t("dl.height", { h }))}</option>`).join("") || `<option value="0">${esc(t("dl.best"))}</option>`;
  const h1080 = i.heights.find(h => h <= 1080); if (h1080) $("#quality").value = String(h1080);
  $("#cVideo").hidden = !i.heights.length;
  $("#cAudio").hidden = !i.audio;
  $("#cCover").hidden = !i.cover;
  $("#backAlbum").hidden = !album;
  M.show($("#preview"), { y: "sm" });
  updateButtons();
}
$("#linkForm").addEventListener("submit", e => { e.preventDefault(); fetchInfo($("#url").value); });
$("#pasteBtn").addEventListener("click", async () => {
  try { const txt = await navigator.clipboard.readText(); if (txt) { $("#url").value = txt.trim(); fetchInfo(txt); } } catch (e) { $("#url").focus(); setStatus(t("dl.pasteHint")); }
});
// Ctrl+V anywhere in the tab pastes the link and reads it
document.addEventListener("paste", e => {
  if (e.target && e.target.closest && e.target.closest("input, textarea")) return;
  const txt = (e.clipboardData && e.clipboardData.getData("text") || "").trim();
  if (!/^https?:\/\//i.test(txt)) return;
  e.preventDefault(); $("#url").value = txt; fetchInfo(txt);
});
$("#url").addEventListener("paste", e => {
  const txt = (e.clipboardData && e.clipboardData.getData("text") || "").trim();
  if (/^https?:\/\//i.test(txt) && !$("#url").value.trim()) setTimeout(() => fetchInfo($("#url").value), 0);
});

/* ---------- queue ---------- */
function addJob(kind, btn) {
  if (!info) return;
  const i = info, j = { id: ++seq, kind, url: i.url, title: i.title || "download", state: "pending", progress: 0, msg: t("dl.q.pending") };
  if (kind === "video") { j.height = +$("#quality").value || 0; j.sub = t("dl.height", { h: j.height }); }
  if (kind === "audio") { j.fmt = document.querySelector('input[name="afmt"]:checked').value; j.sub = t(j.fmt === "mp3" ? "dl.mp3" : "dl.original"); }
  // Spotify: the chosen YouTube audio, named and tagged after Spotify's song
  if (kind === "audio" && i.spotify) {
    const c = i.sources[+(document.querySelector('input[name="src"]:checked') || { value: 0 }).value] || i.sources[0];
    Object.assign(j, { url: c.url, from: c.url, spotify: i.spotify, cover: i.cover, title: SP.fileStem(i.spotify) });
  }
  if (kind === "cover") { j.cover = i.cover; j.fallback = i.fallbackCover || i.thumb; j.sub = t("dl.coverPng"); j.song = { title: i.title || "", artist: String(i.author || "").split(" · ")[0] }; }
  j.thumb = i.thumb || "";
  if (i.dev) j.dev = true;
  if (album && album.tracks.some(x => x.url === i.url)) j.track = i.url;
  jobs.push(j); HAL?.session?.schedule("downloader"); submit(j, btn); renderQueue();
}
// The album's selected songs, one download each of the kind chosen; a Spotify song finds its YouTube audio when its
// turn comes (resolveSpotify). A Spotify album's cover is one download.
function addSelected(btn) {
  const a = album; if (!a || !a.sel.length) return;
  const kind = a.kind, fmt = $("#bAudio").value, height = +$("#bQuality").value || 0;
  const picked = kind === "cover" && a.spotify ? [{ url: a.url, title: a.title, artist: String(a.author).split(" · ")[0], cover: a.cover, thumb: a.thumb }] : a.sel.map(k => a.tracks[k]);
  const added = picked.map(x => {
    const j = { id: ++seq, kind, url: x.url, track: x.url, title: x.title || "download", thumb: x.thumb || a.thumb || "", state: "pending", progress: 0, msg: t("dl.q.pending") };
    if (kind === "video") { j.height = height; j.sub = height ? t("dl.height", { h: height }) : t("dl.best"); }
    if (kind === "audio") { j.fmt = fmt; j.sub = t(fmt === "mp3" ? "dl.mp3" : "dl.original"); }
    if (kind === "audio" && a.spotify) Object.assign(j, { spTrack: x.url, cover: a.cover, title: [x.artist, x.title].filter(Boolean).join(" - ") });
    if (kind === "cover") Object.assign(j, { cover: x.cover || a.cover, fallback: x.thumb || a.thumb, sub: t("dl.coverPng"), song: { title: x.title || "", artist: x.artist || String(a.author).split(" · ")[0] } });
    if (a.dev) j.dev = true;
    return j;
  });
  jobs.push(...added); HAL?.session?.schedule("downloader");
  added.forEach((j, k) => submit(j, k ? null : btn));
  renderQueue();
}
$("#getVideo").addEventListener("click", e => addJob("video", e.currentTarget));
$("#getAudio").addEventListener("click", e => addJob("audio", e.currentTarget));
$("#getCover").addEventListener("click", e => addJob("cover", e.currentTarget));
const ICON = { video: "film", audio: "music", cover: "image" };
function renderQueue() {
  $("#qEmpty").hidden = jobs.length > 0; $("#qCount").textContent = jobs.length ? String(jobs.length) : "";
  $("#clearDone").hidden = !jobs.some(j => j.state === "done");
  M.list($("#queue"), () => { $("#queue").innerHTML = jobs.map(j => {
    const acts = [];
    if (j.state === "running" || j.state === "pending" && j.jobId) acts.push(`<button class="btn sm" data-act="cancel">${esc(t("common.cancel"))}</button>`);
    if (j.state === "pending" && !j.jobId) acts.push(`<button class="btn sm" data-act="retry">${icon("download")}${esc(t("common.download"))}</button>`);
    if (j.state === "error" || j.state === "cancelled") acts.push(`<button class="btn sm" data-act="retry">${icon("rotate-ccw")}${esc(t("dl.retry"))}</button>`);
    if (j.state === "done") {
      acts.push(`<button class="btn sm" data-act="send" title="${esc(t("send.tip"))}" aria-haspopup="menu">${icon("send")}${esc(t("send.to"))}</button>`);
      if (j.kind === "cover") acts.push(`<button class="btn sm" data-act="cut" title="${esc(t("dl.cutTip"))}">${icon("scissors")}${esc(t("dl.cut"))}</button>`);
      acts.push(`<button class="btn sm ghost icon" data-act="reveal" title="${esc(t("common.reveal"))}" aria-label="${esc(t("common.reveal"))}">${icon("folder-open")}</button>`);
    }
    const bar = j.state === "running" ? `<div class="prog"><i style="--v:${j.progress.toFixed(3)}"></i></div>` : "";
    return `<div class="job ${j.state}" data-id="${j.id}"><span class="kind">${icon(ICON[j.kind])}</span><div><b>${esc(j.title)}</b><small>${esc(j.sub)} · ${esc(j.msg)}</small>${bar}</div><div class="acts">${acts.join("")}</div></div>`;
  }).join(""); }, { sel: ":scope > .job", key: el => el.dataset.id });
  trackStates();
}
function updateJob(j) {
  const el = document.querySelector(`.job[data-id="${j.id}"]`);
  if (!el || j.state !== "running" || !el.querySelector(".prog i")) { renderQueue(); return; }
  M.bar(el.querySelector(".prog i"), j.progress);
  el.querySelector("small").textContent = `${j.sub} · ${j.msg}`;
  if (j.track) trackStates();
}
$("#queue").addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const j = jobs.find(x => x.id === +b.closest(".job").dataset.id); if (!j) return;
  const act = b.dataset.act;
  if (act === "cancel") { if (j.jobId) HAL.jobs.cancel(j.jobId); }
  else if (act === "retry") { Object.assign(j, { progress: 0, file: null }); submit(j, b); renderQueue(); }
  else if (act === "send" && j.file) window.__ui.openSend(b, { kind: j.kind === "cover" ? "image" : j.kind, from: "downloader", item: () => ({ path: j.file, name: j.file.split(/[\\/]/).pop(), meta: j.song || null }) });
  else if (act === "reveal" && j.file) reveal(j);
  else if (act === "cut" && j.file) cutCover(j, b);
});
// The file selected in Explorer; when it was moved or renamed since, its folder opens instead
async function reveal(j) {
  await HAL.exportLocation.reveal(j.file);
}
// Cutout of a downloaded cover, exported through the global destination policy.
async function cutCover(j, b) {
  if (!(await HAL.cutoutEnsure())) return;
  b.disabled = true; setStatus(t("dl.st.cutting"));
  try {
    const f = await HAL.fileFromPath(j.file), r = await HAL.cutout(f), p = await HAL.saveCutout(r.rgba, { name: f.name, beside: j.file });
    setStatus(t("dl.st.cut", { name: p.split(/[\\/]/).pop() }), "ok");
  } catch (err) { setStatus(t("cut.failed", { error: oneLine(err) }), "bad"); }
  b.disabled = false;
}
$("#clearDone").addEventListener("click", () => { jobs = jobs.filter(j => j.state !== "done"); renderQueue(); });
$("#openDownloads").addEventListener("click", () => HAL && HAL.invoke("open_folder", { which: "downloads" }));

// Each download is a job in the network lane (jobs.js: three at once in Balanced); a cover is a light one. The list
// here is a view of them; Cancel and Retry go through the jobs.
function submit(j, btn) {
  Object.assign(j, { state: "pending", msg: t("dl.q.pending"), cancelled: false });
  const h = HAL.jobs.submit({
    tool: "downloader", kind: j.kind === "cover" ? "cover" : "download", title: j.title, detail: j.sub, thumb: j.thumb,
    lane: j.kind === "cover" ? "light" : "net", host: j.kind === "cover" ? "page" : "process",
    onCancel: () => { j.cancelled = true; if (!j.ctx) { j.state = "cancelled"; j.msg = t("dl.q.cancelled"); renderQueue(); } },
    run: async ctx => {
      j.ctx = ctx; j.state = "running"; j.msg = t("dl.q.starting"); renderQueue();
      if (j.dev && j.kind !== "cover") await dev.run(j, { updateJob, t, writeFile: HAL.writeFile, reserve: async k => { const work = await j.ctx.workdir(); return work + (work.includes("\\") ? "\\" : "/") + HAL.fileStem(j.title); }, finish: (path, kind) => HAL.exportLocation.copy(path, path.split(/[\\/]/).pop(), kind), record: e => HAL.session.recordExport("downloader", e) });
      else if (j.kind === "cover") await runCover(j); else await runYtdlp(j);
      if (j.state === "error") throw new Error(j.msg);
      if (j.file) ctx.output(j.file, { kind: j.kind === "cover" ? "image" : j.kind });
      return j.file;
    }
  });
  j.jobId = h.id;
  h.done.catch(e => { if (e.name === "AbortError" || e.cancelled) { if (j.state !== "cancelled") { j.state = "cancelled"; j.msg = t("dl.q.cancelled"); } } else if (j.state !== "error") { j.state = "error"; j.msg = oneLine(e); } })
    .then(() => { j.ctx = null; renderQueue(); });
  if (btn && HAL.jobLaunched) HAL.jobLaunched(btn, h, { tool: "downloader", thumb: j.thumb });
}
function ytdlpArgs(j, stem) {
  const out = stem.replace(/%/g, "%%") + (j.spotify ? ".src" : "") + ".%(ext)s";
  // --encoding: the [hal-file] path is read as UTF-8 (a title with accents would otherwise come back as another name)
  const common = ["--no-playlist", "--encoding", "utf-8", "--newline", "--progress", "--no-simulate", "--no-warnings", "--windows-filenames",
    "--progress-template", "download:[hal] %(progress._percent_str)s %(progress.downloaded_bytes)s %(progress.total_bytes)s %(progress.total_bytes_estimate)s",
    "--print", "after_move:[hal-file] %(filepath)s", "-o", out];
  if (j.kind === "video") {
    const h = j.height ? `[height<=${j.height}]` : "";
    return [...common, "-f", `bv*${h}[vcodec^=avc1]+ba[acodec^=mp4a]/bv*${h}+ba/b${h}/b`, "-S", "vcodec:h264,acodec:aac", "--merge-output-format", "mp4", j.url];
  }
  // Spotify's "original" is the AAC stream (M4A): it can hold the cover without re-encoding
  return [...common, "-f", j.spotify && j.fmt !== "mp3" ? "ba[ext=m4a]/ba/b" : "ba/b", "-x", ...(j.fmt === "mp3" ? ["--audio-format", "mp3", "--audio-quality", "0"] : []), j.url];
}
async function runYtdlp(j) {
  if (!engine.ytdlp) throw new Error(t("dl.err.noEngine"));
  if (j.spTrack && !j.spotify && !(await resolveSpotify(j))) return;
  const work = await j.ctx.workdir();
  const stem = work + (work.includes("\\") ? "\\" : "/") + HAL.fileStem(j.title);
  const stages = j.kind === "video" ? 2 : 1, err = [];
  let stage = 0, lastPct = 0, file = null;
  j.proc = await j.ctx.proc("ytdlp", ytdlpArgs(j, stem), line => {
    const m = /^\[hal\]\s+([\d.]+)%/.exec(line.trim());
    if (m) {
      const pct = parseFloat(m[1]) / 100;
      if (pct + 0.2 < lastPct && stage < stages - 1) stage++;      // the second stream (audio) starts again from 0
      lastPct = pct;
      j.progress = Math.min(1, (stage + pct) / stages);
      j.msg = pct >= 1 && stage === stages - 1 ? t("dl.q.processing") : t("dl.q.progress", { pct: Math.round(j.progress * 100) });
      j.ctx.progress(j.progress, j.msg);
      updateJob(j); return;
    }
    const f = /^\[hal-file\]\s+(.+)$/.exec(line.trim());
    if (f) { file = f[1]; return; }
    err.push(line.trim());
  });
  const code = await j.proc.done; j.proc = null;
  if (j.cancelled) return cancelled(j, stem);
  if (code !== 0) { j.state = "error"; j.msg = readableError(err) || t("up.err.code", { code }); return; }
  // the printed path is checked: when it is not there, the file is found by the name reserved for it
  if (file && !(await HAL.invoke("files_exist", { paths: [file] }).catch(() => [true]))[0]) file = null;
  if (!file) file = ((await HAL.invoke("files_with_stem", { pathStem: stem }).catch(() => [])).filter(p => !/\.(part|ytdl|temp)$/i.test(p))[0]) || null;
  if (!file) { j.state = "error"; j.msg = t("dl.err.noFile"); return; }
  if (j.spotify) file = await tagSpotify(j, stem, file);
  if (j.cancelled) return cancelled(j, stem);
  file = await HAL.exportLocation.copy(file, file.split(/[\\/]/).pop(), j.kind === "video" ? "video" : "audio");
  j.file = file; j.state = "done"; j.progress = 1; j.msg = t("dl.q.done", { name: file.split(/[\\/]/).pop() });
  HAL.session.recordExport("downloader", { path: file, name: file.split(/[\\/]/).pop(), kind: j.kind === "video" ? "video" : "audio", thumb: "" });
}
async function cancelled(j, stem) {
  const left = await HAL.invoke("files_with_stem", { pathStem: stem }).catch(() => []);
  await HAL.invoke("delete_paths", { paths: left }).catch(() => {});
  j.state = "cancelled"; j.msg = t("dl.q.cancelled");
}
// A song of a Spotify album: its metadata and the best YouTube match, found inside its own job (searches run as this
// job's processes, not as jobs of their own that would wait behind it in the network lane)
async function resolveSpotify(j) {
  j.msg = t("dl.sp.searching"); updateJob(j); j.ctx.stage(j.msg);
  const get = u => HAL.invoke("http_text", { url: u });
  const m = await SP.fetchMeta(get, SP.parseLink(j.spTrack), j.spTrack);
  if (!m.title) { j.state = "error"; j.msg = t("dl.err.notFound"); return false; }
  const run = async args => {
    const out = [];
    j.proc = await j.ctx.proc("ytdlp", args, (line, stream) => { if (stream === "out") out.push(line); });
    await j.proc.done; j.proc = null;
    try { return JSON.parse(out.join("\n")); } catch (e) { return null; }
  };
  const list = await SP.search(run, m).catch(() => []);
  if (j.cancelled) { j.state = "cancelled"; j.msg = t("dl.q.cancelled"); return false; }
  if (!list.length) { j.state = "error"; j.msg = t("dl.sp.none"); return false; }
  Object.assign(j, { spotify: m, url: list[0].url, from: list[0].url, cover: bestCoverUrl(m.cover) || j.cover, title: SP.fileStem(m) });
  return true;
}
// Spotify's tags and cover on the YouTube audio with FFmpeg, without re-encoding; without the cover if the
// format cannot hold it, and the untagged file is kept if FFmpeg fails
async function tagSpotify(j, stem, src) {
  j.msg = t("dl.q.tagging"); updateJob(j);
  // tagging is FFmpeg's work: the CPU lane
  await j.ctx.switch("cpu"); j.ctx.stage(j.msg);
  const out = stem + "." + src.split(".").pop();
  let cover = null, code = -1;
  try { cover = await HAL.tempFile(new Blob([await fetchBytes(j.cover)]), "spotify-cover.jpg", j.ctx.id); } catch (e) {}
  for (const c of cover ? [cover, null] : [null]) {
    if (j.cancelled) break;
    j.proc = await j.ctx.proc("ffmpeg", SP.tagArgs(j.spotify, src, c, out, j.from), () => {});
    code = await j.proc.done; j.proc = null;
    if (code === 0) break;
  }
  await HAL.invoke("delete_paths", { paths: [cover, code === 0 ? src : out].filter(Boolean) }).catch(() => {});
  return code === 0 ? out : src;
}
// Covers are fetched directly (largest version), converted to PNG and saved to Downloads\Covers
async function runCover(j) {
  let bytes = null;
  for (const u of [j.cover, j.fallback].filter((x, k, a) => x && a.indexOf(x) === k)) {
    try { bytes = await fetchBytes(u); break; } catch (e) { bytes = null; }
  }
  if (j.cancelled) { j.state = "cancelled"; j.msg = t("dl.q.cancelled"); return; }
  if (!bytes) throw new Error(t("dl.err.cover"));
  j.progress = 0.6; j.msg = t("dl.q.processing"); updateJob(j);
  const bmp = await createImageBitmap(new Blob([bytes]));
  const c = document.createElement("canvas"); c.width = bmp.width; c.height = bmp.height;
  c.getContext("2d").drawImage(bmp, 0, 0);
  const png = await new Promise(r => c.toBlob(r, "image/png"));
  const file = await HAL.saveOutput(png, HAL.fileStem(j.title) + ".png", "cover");
  if (!file) throw Object.assign(new Error(t("common.saveCancelled")), { cancelled: true });
  j.file = file; j.state = "done"; j.progress = 1; j.msg = t("dl.q.coverDone", { w: bmp.width, h: bmp.height });
  const s = 240 / Math.max(bmp.width, bmp.height), tc = document.createElement("canvas");
  tc.width = Math.max(1, Math.round(bmp.width * s)); tc.height = Math.max(1, Math.round(bmp.height * s)); tc.getContext("2d").drawImage(bmp, 0, 0, tc.width, tc.height);
  HAL.session.recordExport("downloader", { path: file, name: file.split(/[\\/]/).pop(), kind: "image", thumb: tc.toDataURL("image/jpeg", 0.8) });
}
function updateButtons() {
  const has = !!engine.ytdlp || !!(info && info.dev);
  $("#getVideo").disabled = !has; $("#getAudio").disabled = !has;
  renderSelection();
}

/* ---------- rights: shown the first time, then the fixed line under the queue ---------- */
async function showTerms() {
  const seen = HAL ? await HAL.invoke("state_get", { key: "downloaderTerms" }).catch(() => null) : true;
  if (!seen) M.show($("#terms"));
}
$("#termsOk").addEventListener("click", () => {
  M.hide($("#terms"));
  if (HAL) HAL.invoke("state_set", { key: "downloaderTerms", value: Date.now() }).catch(() => {});
});

window.__halApp = {
  session: {
    capture: async () => ({ url: $("#url").value, info, album, quality: $("#quality").value, audioFormat: document.querySelector('input[name="afmt"]:checked')?.value, source: document.querySelector('input[name="src"]:checked')?.value, queue: jobs.filter(j => j.state !== "done").map(j => Object.fromEntries(["kind","url","title","height","fmt","sub","spotify","cover","fallback","song","thumb","from","track","spTrack","dev"].filter(k => j[k] !== undefined).map(k => [k,j[k]]))) }),
    restore: async d => { $("#url").value = d.url || ""; info = d.info; album = d.album || null; if (album) renderAlbum(!info); if (info) renderPreview(); $("#quality").value = d.quality; document.querySelectorAll('input[name="afmt"]').forEach(e=>e.checked=e.value===d.audioFormat); document.querySelectorAll('input[name="src"]').forEach(e=>e.checked=e.value===d.source); jobs = (d.queue || []).map(j=>({...j,id:++seq,state:"pending",progress:0,msg:t("dl.q.pending")})); renderQueue(); updateButtons(); }
  },
  ready: (async () => {
    if (HAL) await HAL.ready;
    await devReady;
    await refreshEngine(false); renderQueue();
    await showTerms();
    dailyUpdate();
  })(),
  paste: txt => { $("#url").value = txt; return fetchInfo(txt); },
  flush: async () => {},
  busy: () => HAL.jobs.busy("downloader"),
  // nothing open or running: the shell may unload the page while it is not shown (shell.js unloadIdle)
  idle: () => !HAL.jobs.busy("downloader") && !jobs.length && !info && !album && !$("#url").value.trim()
};
})();
