// Halation Preview only: simulated albums, songs, pictures and downloads for the Downloader, to review its interface
// without internet. downloader.js loads this file only when window.__halPreview exists (set by
// app/scripts/halation-preview.cjs); the app never loads it. Links live under https://preview.halation.dev/, pictures
// are drawn here (dev:img/…), and downloads write small real files (a tone, a short clip) to the Preview's own
// Documents\Halation\Downloads after a simulated progress.
(() => {
"use strict";
const t = window.t, HOST = "https://preview.halation.dev/";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const img = (hue, size, label) => `dev:img/${hue}/${size}/${encodeURIComponent(label || "")}`;

/* ===== data ===== */
// flags: unavailable (cannot be read or downloaded), fails (stops at 40 %), slow (about 15 s, to try Cancel)
const NIGHT = ["Neon Overpass", "Glass Harbour", "Afterglow (feat. Lia)", "Slow Signal", "Midnight Arcade", "Paper Satellites",
  "Cold Static", "Rearview", "Long Exposure", "Tidal Lights", "Velvet Hours", "Kilometre Zero", "Halogen", "Last Exit Home"];
const LONG = Array.from({ length: 48 }, (x, k) => ["Drift", "Pulse", "Echo", "Bloom", "Haze", "Orbit", "Fade", "Spark"][k % 8] + " " + (k + 1));
const BLUE = ["Green Room (feat. Lia)", "Paper Moons", "Blue Hour", "Static Bloom", "Northbound", "Lanterns", "Undertow", "Satellite Heart", "Quiet Harbour", "Home by Dawn"];
const ALBUMS = {
  "album/night-drive": { site: "YoutubeTab", title: "Night Drive Tapes", author: "Nova", hue: 265, video: true, own: true, names: NIGHT,
    flags: { 6: "unavailable", 9: "slow", 11: "fails" } },
  "album/long-mix": { site: "YoutubeTab", title: "Long Mix — 48 songs to scroll", author: "Various Artists", hue: 190, video: true, own: false, names: LONG, flags: { 20: "fails" } },
  "spotify/blue-hour": { site: "Spotify", spotify: true, title: "Blue Hour", author: "Nova · 2021", hue: 150, video: false, own: false, names: BLUE, flags: { 4: "unavailable" },
    notice: () => t("dl.sp.notice") }
};
const LINKS = [["album/night-drive", "Album · 14 songs"], ["album/long-mix", "Long album · 48"], ["spotify/blue-hour", "Spotify album · 10"], ["album/missing", "Link that fails"]];
const tracksOf = (key, a) => a.names.map((name, k) => {
  const n = k + 1, hue = (a.hue + n * 23) % 360;
  return { url: `${HOST}track/${key}/${n}`, title: name, artist: /feat\. Lia/.test(name) ? "Nova, Lia" : a.author.split(" · ")[0], duration: 150 + (n * 37) % 140,
    thumb: a.own ? img(hue, 160, String(n)) : "", cover: a.own ? img(hue, 1280, name) : "", flag: a.flags[n] || "" };
});

/* ===== reading links ===== */
const owns = u => String(u || "").startsWith(HOST) || /^dev:/.test(String(u || ""));
async function read(url) {
  await sleep(500);
  const path = url.slice(HOST.length).replace(/[?#].*$/, "");
  const tm = /^track\/(.+)\/(\d+)$/.exec(path);
  if (tm) {
    const a = ALBUMS[tm[1]], x = a && tracksOf(tm[1], a)[+tm[2] - 1];
    if (!x) throw new Error(t("dl.err.notFound"));
    if (x.flag === "unavailable") throw new Error("Video unavailable. This video is private");
    const cover = x.cover || img(a.hue, 1280, a.title);
    return { dev: true, url: x.url, site: a.site, title: x.title, author: a.spotify ? x.artist + " · " + a.title : x.artist, duration: x.duration,
      thumb: x.thumb || img(a.hue, 480, a.title), cover, heights: a.video ? [1080, 720, 480, 360] : [], audio: true, notice: a.notice ? a.notice() : "" };
  }
  const a = ALBUMS[path];
  if (!a) throw new Error(t("dl.err.notFound"));
  const cover = img(a.hue, 1280, a.title);
  return { dev: true, url, site: a.site, spotify: !!a.spotify, title: a.title, author: a.author, cover, thumb: img(a.hue, 480, a.title), notice: a.notice ? a.notice() : "",
    tracks: tracksOf(path, a) };
}

/* ===== pictures ===== */
async function bytes(u) {
  const m = /^dev:img\/(\d+)\/(\d+)\/(.*)$/.exec(u);
  if (!m) throw new Error("not found");
  const hue = +m[1], size = +m[2], label = decodeURIComponent(m[3]);
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, size, size);
  gr.addColorStop(0, `hsl(${hue} 70% 22%)`); gr.addColorStop(1, `hsl(${(hue + 60) % 360} 80% 62%)`);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  g.fillStyle = "rgba(255,255,255,.85)"; g.font = `800 ${Math.round(size / (label.length > 3 ? 10 : 3))}px sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  if (label) g.fillText(label, size / 2, size / 2, size * 0.86);
  return new Uint8Array(await (await new Promise(r => c.toBlob(r, "image/jpeg", 0.86))).arrayBuffer());
}

/* ===== downloads ===== */
// A 2 s tone as WAV (16-bit mono, 44.1 kHz)
function tone(seconds = 2, hz = 440) {
  const rate = 44100, n = rate * seconds, b = new DataView(new ArrayBuffer(44 + n * 2));
  const str = (o, s) => [...s].forEach((ch, k) => b.setUint8(o + k, ch.charCodeAt(0)));
  str(0, "RIFF"); b.setUint32(4, 36 + n * 2, true); str(8, "WAVE"); str(12, "fmt "); b.setUint32(16, 16, true); b.setUint16(20, 1, true); b.setUint16(22, 1, true);
  b.setUint32(24, rate, true); b.setUint32(28, rate * 2, true); b.setUint16(32, 2, true); b.setUint16(34, 16, true); str(36, "data"); b.setUint32(40, n * 2, true);
  for (let k = 0; k < n; k++) b.setInt16(44 + k * 2, Math.sin(2 * Math.PI * hz * k / rate) * 6000 * Math.min(1, k / 2000, (n - k) / 2000), true);
  return new Blob([b.buffer], { type: "audio/wav" });
}
// A 1 s clip of a moving gradient (WebM), or null where MediaRecorder is missing
async function clip(hue) {
  if (typeof MediaRecorder === "undefined") return null;
  const c = document.createElement("canvas"); c.width = 640; c.height = 360;
  const g = c.getContext("2d"), rec = new MediaRecorder(c.captureStream(30), { mimeType: "video/webm" }), parts = [];
  rec.ondataavailable = e => parts.push(e.data);
  const stop = new Promise(r => { rec.onstop = r; });
  rec.start();
  for (let f = 0; f < 30; f++) { g.fillStyle = `hsl(${(hue + f * 4) % 360} 70% 40%)`; g.fillRect(0, 0, 640, 360); g.fillStyle = "#fff"; g.fillRect(f * 20, 160, 40, 40); await sleep(33); }
  rec.stop(); await stop;
  return new Blob(parts, { type: "video/webm" });
}
// The same states as a real download: progress (two passes for a video), a failure at 40 %, Cancel at any moment
async function run(j, h) {
  const m = /^track\/(.+)\/(\d+)$/.exec(String(j.track || j.url).slice(HOST.length)), a = m && ALBUMS[m[1]];
  const flag = a ? a.flags[+m[2]] || "" : "";
  const stages = j.kind === "video" ? 2 : 1, steps = flag === "slow" ? 60 : 16;
  if (flag === "unavailable") { await sleep(400); j.state = "error"; j.msg = "Video unavailable. This video is private"; return; }
  if (j.spTrack) { j.msg = t("dl.sp.searching"); h.updateJob(j); j.ctx.stage(j.msg); await sleep(700); }
  for (let s = 0; s < stages; s++) for (let k = 1; k <= steps; k++) {
    await sleep(flag === "slow" ? 250 : 120);
    if (j.cancelled) { j.state = "cancelled"; j.msg = t("dl.q.cancelled"); return; }
    j.progress = (s + k / steps) / stages;
    if (flag === "fails" && j.progress >= 0.4) { j.state = "error"; j.msg = "HTTP Error 403: Forbidden"; return; }
    j.msg = j.progress >= 1 ? t("dl.q.processing") : t("dl.q.progress", { pct: Math.round(j.progress * 100) });
    j.ctx.progress(j.progress, j.msg); h.updateJob(j);
  }
  const stem = await h.reserve(j.kind === "video" ? "video" : "audio");
  const v = j.kind === "video" ? await clip(200).catch(() => null) : null;
  const blob = v || tone(2, 330 + (j.id % 8) * 40), ext = v ? "webm" : "wav";
  const staged = await h.writeFile(stem + "." + ext, blob);
  const file = await h.finish(staged, j.kind === "video" ? "video" : "audio");
  if (j.cancelled) { j.state = "cancelled"; j.msg = t("dl.q.cancelled"); return; }
  const name = file.split(/[\\/]/).pop();
  Object.assign(j, { file, state: "done", progress: 1, msg: t("dl.q.done", { name }) });
  h.record({ path: file, name, kind: j.kind === "video" ? "video" : "audio", thumb: "" });
}

/* ===== the links to try ===== */
const css = document.createElement("style");
css.textContent = `.devbar{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:-4px;font-size:12px;color:var(--text-2)}
.devbar b{color:var(--warn);font-weight:700;letter-spacing:.04em}`;
document.head.append(css);
const bar = document.createElement("div");
bar.className = "devbar";
bar.innerHTML = `<b>PREVIEW</b><span>Simulated links (no internet):</span>` + LINKS.map(([k, label]) => `<button class="chip" type="button" data-link="${k}">${label}</button>`).join("");
bar.addEventListener("click", e => {
  const b = e.target.closest("[data-link]"); if (!b) return;
  document.querySelector("#url").value = HOST + b.dataset.link;
  document.querySelector("#linkForm").requestSubmit();
});
document.querySelector("#linkForm").after(bar);

window.__dlDev = { owns, read, bytes, run };
})();
