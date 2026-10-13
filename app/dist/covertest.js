// Cover Test: up to three covers of the user's seen inside YouTube, Spotify and SoundCloud, at the platforms' real
// sizes, among real content (the artist profile's releases and a feed of the platform, both through
// window.__hal.profile) — docs/COVER_TEST_SPEC.md. The views are local HTML/CSS (covertest.css), never the
// platforms' own pages. Sections: state · util · covers · profile · feed · youtube · spotify · soundcloud · render ·
// controls · export · main. References: other artists' releases next to the user's (§5.1).
const { $, esc, setStatus, shortCount } = window.__ui;
const HAL = window.__hal || (window.parent && window.parent.__hal) || null;
const M = window.__motion, IMG = window.__img;
const t = window.t;
__i18n.apply(document);
__icons.apply(document);
document.body.dataset.drop = t("ct.drop");

/* ===== state ===== */
// C: what the user set (saved as the state "covertest"); covers: [{ img, name, crop: { "16:9": p, "1:1": p }, url: { "16:9", "1:1" }, hue }]
const VIEWS = { youtube: ["channel", "home", "search", "mobile"], spotify: ["artist", "release", "row"], soundcloud: ["profile", "track", "feed"] };
const POS = { channel: 6, home: 8, search: 3, mobile: 4, artist: 5, row: 6, profile: 4, feed: 4 };
const THEMED = { youtube: true, soundcloud: true };
const DEF = {
  platform: "youtube", view: { youtube: "channel", spotify: "artist", soundcloud: "profile" }, dark: { youtube: true, soundcloud: true },
  pos: { channel: 1, home: 2, search: 1, mobile: 1, artist: 1, row: 2, profile: 1, feed: 1 }, active: 0, scale: 1, far: false, refs: [],
  fields: { title: "", artist: "", views: "1.2M", duration: "3:12", date: t("ct.defaultDate") },
  query: { youtube: "new music", soundcloud: "new music", spotify: "" }, mobileView: "home", searchTest: null, leftTab: "cover", youtubeArtistInTitle: false
};
const C = JSON.parse(JSON.stringify(DEF));
const covers = [];
let profile = { name: "", platforms: {} }, feeds = {}, stats = { profileMs: 0, feedMs: {}, firstPaint: 0 };
const MAX = 3, RATIO = p => p === "youtube" ? "16:9" : "1:1";
const saveState = () => { if (HAL) { const { refs, ...view } = C; HAL.invoke("state_set", { key: "covertest", value: view }).catch(() => {}); } };
const saveProfiles = () => HAL && HAL.invoke("state_set", { key: "profiles", value: { references: C.refs.slice() } });

/* ===== util ===== */
const views = n => t("ct.v.views", { n: shortCount(n) });
const clock = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, x = String(s % 60).padStart(2, "0"); return h ? `${h}:${String(m).padStart(2, "0")}:${x}` : `${m}:${x}`; };
// "2026-09-01" → "4 weeks ago"; text that is already relative stays
function ago(d) {
  if (!d || !/^\d{4}-\d{2}-\d{2}/.test(d)) return d || "";
  const days = Math.floor((Date.now() - Date.parse(d)) / 864e5), lang = document.documentElement.lang || "en", rtf = new Intl.RelativeTimeFormat(lang, { numeric: "always" });
  if (days < 1) return new Intl.RelativeTimeFormat(lang, { numeric: "auto" }).format(0, "day");
  if (days < 7) return rtf.format(-days, "day");
  if (days < 30) return rtf.format(-Math.floor(days / 7), "week");
  if (days < 365) return rtf.format(-Math.floor(days / 30), "month");
  return rtf.format(-Math.floor(days / 365), "year");
}
const img = (src, cls = "") => src ? `<img class="${cls}" src="${esc(src)}" alt="" draggable="false">` : `<div class="${cls} ph"></div>`;
// One signal per track, shared by every SoundCloud view regardless of its displayed width.
const waveCache = new Map(), WAVE_BARS = 420;
function wave(id, played = 0, bars = WAVE_BARS) {
  const key = String(id);
  let cached = waveCache.get(key);
  if (!cached) {
    let h = 2166136261; for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    h = h || 1;
    const rnd = () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return (h >>> 0) / 4294967296; };
    // Compressed, sustained blocks contrast with calmer passages that retain a clear energy floor.
    // Short blends join the sections; small internal slopes never turn the drops into isolated hills.
    const count = 10 + Math.floor(rnd() * 4), calm = [2 + Math.floor(rnd() * 2), 6 + Math.floor(rnd() * 2)];
    const sections = Array.from({ length: count }, (_, i) => {
      const low = calm.includes(i), strong = !low && (calm.includes(i - 1) || rnd() > .35);
      const start = low ? .40 + rnd() * .12 : strong ? .84 + rnd() * .08 : .60 + rnd() * .10;
      const end = start + (rnd() - .5) * (strong ? .04 : .08);
      return { length: low ? .50 + rnd() * .45 : .80 + rnd(), start, end, blend: .07 + rnd() * .15 };
    });
    const total = sections.reduce((sum, s) => sum + s.length, 0);
    let edge = 0;
    for (const s of sections) { s.from = edge; edge += s.length / total; s.to = edge; }
    const beats = 52 + Math.floor(rnd() * 48), phase = rnd(), heights = [];
    let k = 0, texture = .96, accent = 1;
    for (let i = 0; i < WAVE_BARS; i++) {
      const x = i / (WAVE_BARS - 1);
      while (k < count - 1 && x > sections[k].to) k++;
      const s = sections[k], p = Math.max(0, Math.min(1, (x - s.from) / (s.to - s.from)));
      let env = s.start + (s.end - s.start) * p;
      if (k && p < s.blend) {
        const u = p / s.blend, mix = u * u * (3 - 2 * u);
        env = sections[k - 1].end * (1 - mix) + env * mix;
      }
      // Irregular bars and sparse transients sit inside a full envelope, with tighter variation keeping
      // strong sections visually solid. Calm passages preserve texture rather than becoming gaps.
      if (i % 7 === 0) accent = .94 + rnd() * .12;
      texture += ((.86 + rnd() * .22) - texture) * .45;
      const attack = Math.exp(-8 * ((x * beats + phase) % 1));
      const micro = .86 + rnd() * .25, transient = rnd() < .045 ? .05 + rnd() * .10 : 0;
      const v = Math.max(.26, Math.min(.98, env * (texture * accent * micro + .10 * attack) + transient));
      heights.push(+(v * 62).toFixed(2));
    }
    cached = { heights, svg: new Map() }; waveCache.set(key, cached);
  }
  const resolution = `${bars}/${played}`;
  if (!cached.svg.has(resolution)) {
    let out = "";
    for (let i = 0; i < bars; i++) {
      const top = cached.heights[Math.round(i * (WAVE_BARS - 1) / Math.max(1, bars - 1))];
      const reflection = +(top * .43).toFixed(2), cls = i < bars * played ? ' class="p"' : "";
      out += `<rect${cls} x="${i * 3}" y="${66 - top}" width="2" height="${top}"/><rect class="reflection${i < bars * played ? " p" : ""}" x="${i * 3}" y="68" width="2" height="${reflection}"/>`;
    }
    cached.svg.set(resolution, `<svg data-wave="${esc(key)}" data-played="${played}" viewBox="0 0 ${bars * 3} 100" preserveAspectRatio="none" aria-hidden="true">${out}</svg>`);
  }
  return cached.svg.get(resolution);
}
const waveResolutions = page => [...page.querySelectorAll('.wave svg')].map(svg => Math.max(1, Math.round(svg.parentElement.clientWidth / 3)));
function fitWaves(page, resolutions = waveResolutions(page)) {
  page.querySelectorAll('.wave svg').forEach((svg, i) => { svg.outerHTML = wave(svg.dataset.wave, +svg.dataset.played, resolutions[i]); });
}

/* ===== covers ===== */
// The cover as the view shows it: cropped to the platform's ratio (the Crop service's parameters, centred until
// edited) and reduced to what the largest view needs (YouTube 1280×720, square 640)
async function cut(c, ratio) {
  const [iw, ih] = IMG.size(c.img);
  if (!c.crop[ratio]) c.crop[ratio] = { ...IMG.centered(iw, ih, ratio), ratio };
  const cv = IMG.render(c.img, c.crop[ratio], { readback: true }), [w, h] = ratio === "16:9" ? [1280, 720] : [640, 640];
  const out = IMG.mk(w, h), x = out.getContext("2d", { willReadFrequently: true });
  x.imageSmoothingQuality = "high"; x.drawImage(cv, 0, 0, w, h);
  if (c.url[ratio]) URL.revokeObjectURL(c.url[ratio]);
  c.url[ratio] = URL.createObjectURL(await IMG.toBlob(out, "image/jpeg", 0.92));
  if (ratio === "1:1") c.hue = hueOf(out);
}
// Spotify's header colour: the cover's most saturated average, darkened (as the app picks a dark, rich tone)
function hueOf(cv) {
  const s = IMG.mk(8, 8), sx = s.getContext("2d", { willReadFrequently: true });
  sx.drawImage(cv, 0, 0, 8, 8);
  const d = sx.getImageData(0, 0, 8, 8).data;
  let best = null;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, g = d[i + 1] / 255, b = d[i + 2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx ? (mx - mn) / mx : 0;
    if (!best || sat * (0.3 + mx) > best.k) best = { k: sat * (0.3 + mx), r, g, b, mx };
  }
  const f = best.mx > 0 ? Math.min(1, 0.42 / best.mx) : 0;
  return `rgb(${Math.round(best.r * f * 255)},${Math.round(best.g * f * 255)},${Math.round(best.b * f * 255)})`;
}
// A picture in: a File, a Blob, { blob, name } or { path, name }; it takes the first free place, else the active one
let adding = Promise.resolve(), pending = 0;
const addCover = (src, at) => { pending++; return (adding = adding.then(() => addOne(src, at)).finally(() => pending--)); };
async function addOne(src, at) {
  try {
    let blob = src.blob || (IMG.isBlob(src) ? src : null);
    if (!blob && src.path && HAL) blob = await HAL.fileFromPath(src.path);
    const pic = await IMG.load(blob), name = src.name || "cover";
    const i = at != null ? at : covers.length < MAX ? covers.length : C.active;
    const c = { source: src.path ? {path:src.path,name} : blob, img: pic, blob, name, crop: (src.crop && typeof src.crop === "object") ? src.crop : {}, url: {}, hue: "" };
    await Promise.all(["16:9", "1:1"].map(r => cut(c, r)));
    if (covers[i]) { Object.values(covers[i].url).forEach(u => URL.revokeObjectURL(u)); URL.revokeObjectURL(covers[i].img.__url); }
    covers[i] = c; C.active = i;
    if (!src.restored && !C.fields.title) { C.fields.title = name.replace(/\.[^.]+$/, ""); syncFields(); }
    // Restore all saved covers before painting the page once; intermediate restores are never user edits.
    if (!src.restored) { renderCovers(); render(); }
    if (!src.restored && HAL) {
      saveState();
      if (HAL.recent) { const f = new File([blob], name, { type: blob.type }); if (src.path) f.__halPath = src.path; HAL.recent(f, "covertest", "image"); }
    }
    return true;
  } catch (e) { setStatus(t("common.badImage"), "bad"); return false; }
}
function removeCover(i) {
  const c = covers[i]; if (!c) return;
  Object.values(c.url).forEach(u => URL.revokeObjectURL(u));
  URL.revokeObjectURL(c.img.__url);
  covers.splice(i, 1);
  C.active = Math.min(C.active, Math.max(0, covers.length - 1));
  saveState(); renderCovers(); render();
}
function pick(i) {
  if (!covers[i] || i === C.active) return;
  C.active = i; saveState();
  $("#covers").querySelectorAll(".cv[data-i]").forEach(b => b.setAttribute("aria-checked", String(+b.dataset.i === i)));
  swapCover();
}
async function editCrop(i) {
  const c = covers[i], ratio = RATIO(C.platform);
  if (!c || !HAL) return;
  const res = await HAL.crop({ image: c.img, name: c.name, params: c.crop[ratio], ratio, lock: true, from: $("#covers") });
  if (!res) return;
  c.crop[ratio] = { ...res.params, ratio };
  await cut(c, ratio); saveState(); renderCovers(); swapCover();
}
// Empty: one place to upload the cover. With covers: each one to pick, crop or remove, and "Upload another" while
// there is room
function renderCovers() {
  const box = $("#covers");
  box.classList.toggle("none", !covers.length);
  box.innerHTML = !covers.length
    ? `<button class="cv add up" data-add="1"><span class="big" data-icon="image-plus"></span><b>${esc(t("ct.upload"))}</b><small>${esc(t("ct.uploadNote"))}</small></button>`
    : covers.map((c, i) => `<div class="cv" role="radio" tabindex="0" data-i="${i}" aria-checked="${i === C.active}" title="${esc(c.name)}"><img src="${c.url[RATIO(C.platform)]}" alt=""><span class="nm"><b>${esc(c.name)}</b><small>${esc(t("ct.coverN", { n: i + 1 }))}</small></span><button class="btn ghost icon sm" data-act="crop" title="${esc(t("ct.crop"))}" aria-label="${esc(t("ct.crop"))}" data-icon="crop"></button><button class="btn ghost icon sm" data-act="remove" title="${esc(t("ct.remove"))}" aria-label="${esc(t("ct.remove"))}" data-icon="trash-2"></button></div>`).join("")
      + (covers.length < MAX ? `<button class="cv add" data-add="1"><span data-icon="plus"></span>${esc(t("ct.addMore"))}</button>` : "");
  __icons.apply(box);
  $("#coversHint").hidden = covers.length < 2;
  $("#coverCount").textContent = covers.length ? `${covers.length}/${MAX}` : "";
  $("#saveBtn").disabled = !covers.length;
  $("#emptyStage").hidden = covers.length > 0;
}
$("#covers").addEventListener("click", e => {
  const act = e.target.closest("[data-act]"), b = e.target.closest(".cv");
  if (!b) return;
  if (b.dataset.add) { $("#imgIn").click(); return; }
  const i = +b.dataset.i;
  if (act && act.dataset.act === "remove") removeCover(i);
  else if (act && act.dataset.act === "crop") editCrop(i);
  else pick(i);
});
$("#covers").addEventListener("keydown", e => { const b = e.target.closest(".cv[data-i]"); if (b && e.target === b && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(+b.dataset.i); } });
$("#covers").addEventListener("dblclick", e => { const b = e.target.closest(".cv[data-i]"); if (b) editCrop(+b.dataset.i); });

/* ===== profile ===== */
const PLAT_NAME = { youtube: "YouTube", spotify: "Spotify", soundcloud: "SoundCloud" };
async function loadProfile() {
  if (!HAL || !HAL.profile) return;
  profile = await HAL.profile.get();
  renderProfile();
}
function renderProfile() {
  const ps = profile.platforms, keys = Object.keys(ps);
  $("#prof").innerHTML = keys.length ? keys.map(k => {
    const p = ps[k], sub = p.error && !p.fetched ? t("ct.readFailed") : p.fetched ? [p.followers ? t("find.followers", { n: shortCount(p.followers) }) : "", t("ct.releases", { n: p.releases.length })].filter(Boolean).join(" · ") : t("ct.notRead");
    return `<div class="prow" data-k="${k}">${p.avatar ? `<img src="${esc(p.avatar)}" alt="">` : '<span class="av"></span>'}<span class="tx"><b>${esc(p.name || PLAT_NAME[k])}</b><small class="${p.error ? "bad" : ""}" title="${esc(p.error ? __i18n.error(p.error) : p.url)}">${esc(PLAT_NAME[k] + " · " + sub)}</small></span></div>`;
  }).join("") : `<p class="none">${esc(t("ct.noProfile"))}</p>`;
  const last = Math.max(0, ...keys.map(k => ps[k].fetched || 0));
  $("#profAge").textContent = last ? ago(new Date(last).toISOString().slice(0, 10)) : "";
  $("#removeArtistBtn").hidden = !profile.name && !keys.length;
  if (!C.fields.artist && profile.name) { $("#fArtist").placeholder = profile.name; }
}
async function refreshProfile(quiet) {
  if (!HAL || !HAL.profile) return;
  const keys = Object.keys(profile.platforms);
  if (!keys.length) { if (!quiet) setStatus(t("ct.noProfile"), "warn"); return; }
  $("#profStatus").textContent = t("ct.reading");
  $("#refreshBtn").disabled = true;
  $("#removeArtistBtn").disabled = true;
  try {
    const r = await HAL.profile.refresh();
    stats.profileMs = r.ms; stats.profileBytes = r.bytes;
    await loadProfile(); render();
    const bad = Object.values(profile.platforms).filter(p => p.error).length;
    $("#profStatus").textContent = bad ? t("ct.readSome", { n: bad }) : t("ct.readDone", { s: (r.ms / 1000).toFixed(1) });
  } finally { $("#refreshBtn").disabled = false; $("#removeArtistBtn").disabled = profileConfirming || profileRemoving; }
}
$("#refreshBtn").addEventListener("click", () => refreshProfile(false));
let profileSearchRun = 0, profileCandidates = [], candidateImages = [], profileConfirming = false, profileRemoving = false;
function profileDecision(p) {
  const own = (HAL.settings().links || {})[p.platform] === p.url;
  if (own || p.skipped) return `<p class="candidate-state">${esc(t(own ? p.confirmed ? "find.saved" : "find.already" : "find.skipped"))}</p>`;
  return `<p class="candidate-question">${esc(t("ct.profileQuestion"))}</p><div class="btnrow"><button type="button" class="btn sm ghost" data-profile-answer="no">${esc(t("find.no"))}</button><button type="button" class="btn sm primary" data-profile-answer="yes">${esc(t("ct.profileMine"))}</button></div>`;
}
function clearProfileCandidates() {
  candidateImages.forEach(URL.revokeObjectURL); candidateImages = [];
  profileCandidates = [];
  $("#profileCandidates").innerHTML = "";
}
async function searchOwnProfile() {
  const name = $("#profileName").value.trim();
  if (profileConfirming || profileRemoving || !HAL?.profile?.discover) return;
  if (!name) { $("#profileName").focus(); return; }
  const run = ++profileSearchRun, box = $("#profileCandidates");
  clearProfileCandidates();
  box.setAttribute("aria-busy", "true");
  $("#profileSearchStatus").textContent = t("ct.profileSearching", { name });
  try {
    const result = await HAL.profile.discover(name);
    if (run !== profileSearchRun) return;
    profileCandidates = result.filter(p => PLAT_NAME[p.k]).map(p => ({ ...p, platform: p.k, name: p.title || name }));
    box.innerHTML = profileCandidates.map((p, i) => `<section class="profile-candidate" data-candidate="${i}">
      <div class="prow"><span class="av"></span><span class="tx"><b>${esc(p.name)}</b><small>${esc(PLAT_NAME[p.platform])}${p.followers ? " · " + esc(t("find.followers", { n: shortCount(p.followers) })) : ""}</small></span></div>
      <span class="candidate-url">${esc(p.url)}</span>
      <div class="candidate-decision">${profileDecision(p)}</div>
    </section>`).join("");
    $("#profileSearchStatus").textContent = t(profileCandidates.length ? "ct.profileFound" : "ct.profileNone");
    profileCandidates.forEach(async (p, i) => {
      if (!p.avatar) return;
      try {
        const bytes = await HAL.invoke("http_bytes", { url: p.avatar, browser: true });
        if (run !== profileSearchRun) return;
        const image = document.createElement("img"), url = URL.createObjectURL(new Blob([bytes]));
        candidateImages.push(url); image.src = url; image.alt = "";
        image.onerror = () => { image.replaceWith(Object.assign(document.createElement("span"), { className: "av" })); };
        box.querySelector(`[data-candidate="${i}"] .av`)?.replaceWith(image);
      } catch (e) { /* Keep the existing avatar placeholder. */ }
    });
  } catch (e) {
    if (run === profileSearchRun) $("#profileSearchStatus").textContent = t("ct.profileSearchFailed");
  } finally { if (run === profileSearchRun) box.setAttribute("aria-busy", "false"); }
}
$("#profileSearch").addEventListener("submit", e => { e.preventDefault(); searchOwnProfile(); });
$("#profileName").addEventListener("input", () => {
  profileSearchRun++; clearProfileCandidates();
  $("#profileCandidates").setAttribute("aria-busy", "false");
  $("#profileSearchStatus").textContent = "";
});
$("#profileCandidates").addEventListener("click", async e => {
  const button = e.target.closest("[data-profile-answer]"), row = button?.closest("[data-candidate]");
  if (!row || profileConfirming || profileRemoving) return;
  const candidate = profileCandidates[Number(row.dataset.candidate)];
  if (!candidate) return;
  if (button.dataset.profileAnswer === "no") {
    candidate.skipped = true;
    row.querySelector(".candidate-decision").innerHTML = profileDecision(candidate);
    return;
  }
  profileConfirming = true;
  const controls = [...document.querySelectorAll("#profileSearch input,#profileSearch button,#profileCandidates button,#refreshBtn,#removeArtistBtn")];
  controls.forEach(b => { b.disabled = true; });
  $("#profileSearchStatus").textContent = t("ct.reading");
  try {
    profile = await HAL.profile.confirm(candidate);
    renderProfile(); syncFields(); render();
    candidate.confirmed = true;
    profileCandidates.forEach((p, i) => {
      if (p.platform === candidate.platform) $("#profileCandidates").querySelector(`[data-candidate="${i}"] .candidate-decision`).innerHTML = profileDecision(p);
    });
    $("#profileSearchStatus").textContent = t(profile.platforms[candidate.platform]?.error ? "ct.profileReadFailed" : "ct.profileReady");
  } catch (e) { $("#profileSearchStatus").textContent = t("ct.profileConfirmFailed"); }
  finally { profileConfirming = false; controls.forEach(b => { b.disabled = false; }); }
});
$("#removeArtistBtn").addEventListener("click", async () => {
  if (profileConfirming || profileRemoving || !HAL?.profile?.remove) return;
  profileRemoving = true; profileSearchRun++;
  const controls = [...document.querySelectorAll("#profileSearch input,#profileSearch button,#profileCandidates button,#refreshBtn,#removeArtistBtn")];
  controls.forEach(b => { b.disabled = true; });
  $("#profileCandidates").setAttribute("aria-busy", "false");
  try {
    profile = await HAL.profile.remove();
    clearProfileCandidates();
    $("#profileName").value = "";
    $("#profileSearchStatus").textContent = "";
    $("#profStatus").textContent = "";
    renderProfile(); syncFields(); render();
  } catch (e) { $("#profStatus").textContent = t("ct.profileRemoveFailed"); }
  finally { profileRemoving = false; controls.forEach(b => { b.disabled = false; }); }
  if (!Object.keys(profile.platforms).length && !profile.name) $("#profileName").focus();
});
window.addEventListener("beforeunload", () => candidateImages.forEach(URL.revokeObjectURL));

/* ===== feed ===== */
// The platform's content around the cover (§5): from the disk at once, read again in the background when old
let youtubeFeedLoad = 0, searchFeed = null;
async function loadFeed(plat, force) {
  if (!HAL || !HAL.profile) return;
  const q = plat === "spotify" ? (C.query.spotify || "") : (C.query[plat] || DEF.query[plat]);
  const request = plat === "youtube" ? ++youtubeFeedLoad : 0;
  const t0 = performance.now(), f = await HAL.profile.feed(plat, q, { force });
  if (plat === "youtube" && request !== youtubeFeedLoad) return;
  stats.feedMs[plat] = Math.round(performance.now() - t0);
  feeds[plat] = f || { items: [], fetched: 0, error: "" };
  if (plat === C.platform) { renderFeedInfo(); render(); }
}
function renderFeedInfo() {
  const f = feeds[C.platform];
  $("#feedWhat").textContent = t("ct.feedWhat." + C.platform);
  $("#queryRow").hidden = C.platform === "spotify";
  $("#fQuery").value = C.query[C.platform] || "";
  $("#cancelSearchBtn").hidden = C.platform !== "youtube" || !C.searchTest;
  $("#feedAge").textContent = f && f.fetched ? ago(new Date(f.fetched).toISOString().slice(0, 10)) : "";
  $("#feedNote").textContent = !f ? "" : !f.items.length ? t(f.error ? "ct.feedOffline" : "ct.feedEmpty") : f.error ? t("ct.feedStale") : "";
}
$("#feedBtn").addEventListener("click", () => { $("#feedNote").textContent = t("ct.reading"); loadFeed(C.platform, true); });
function cancelSearchTest() {
  if (!C.searchTest) return;
  ++youtubeFeedLoad;
  C.query.youtube = C.searchTest.query; C.searchTest = null;
  const previous = searchFeed; searchFeed = null;
  saveState();
  if (previous) { feeds.youtube = previous; renderFeedInfo(); render(); }
  else { renderFeedInfo(); loadFeed("youtube", false); }
}
$("#cancelSearchBtn").addEventListener("click", cancelSearchTest);
$("#fQuery").addEventListener("change", e => {
  const q = e.target.value.trim(), plat = C.platform;
  if (plat === "youtube") {
    if (C.searchTest && (!q || q === C.searchTest.query)) { cancelSearchTest(); return; }
    if (q && q !== C.query.youtube && !C.searchTest) { C.searchTest = { query: C.query.youtube || "" }; searchFeed = feeds.youtube || null; }
  }
  C.query[plat] = q; saveState(); renderFeedInfo(); loadFeed(plat, false);
});

/* ===== references ===== */
// Other artists: up to eight links or names; one or two releases of each sit next to the user's in every view that
// shows other artists (not on the user's own page)
const REFS = 8;
let refs = [];
async function loadRefs(force, cacheOnly = false) {
  if (!HAL || !HAL.profile || !HAL.profile.reference) return;
  refs = C.refs.map(text => refs.find(r => r.text === text) || { text, name: "", platforms: {}, loading: true });
  renderRefs();
  if (!C.refs.length) return;
  await Promise.all(C.refs.map(async text => {
    const r = await HAL.profile.reference(text, { force, cacheOnly }).catch(e => ({ text, name: "", platforms: {}, error: String(e && e.message || e) }));
    const i = refs.findIndex(x => x.text === text);
    if (i >= 0) refs[i] = r;
  }));
  renderRefs(); render();
}
function renderRefs() {
  $("#refs").innerHTML = refs.map((r, i) => {
    const ps = Object.keys(r.platforms || {}), av = ps.map(p => r.platforms[p].avatar).find(Boolean);
    const sub = r.loading ? t("ct.reading") : !ps.length ? t("ct.refNotFound") : t("ct.refOn", { list: ps.map(p => PLAT_NAME[p]).join(", ") });
    return `<div class="prow ref" data-i="${i}">${av ? `<img src="${esc(av)}" alt="">` : '<span class="av"></span>'}<span class="tx"><b>${esc(r.name || r.text)}</b><small class="${!r.loading && !ps.length ? "bad" : ""}" title="${esc(r.text)}">${esc(sub)}</small></span><button class="btn ghost icon sm" data-act="remove" title="${esc(t("ct.remove"))}" aria-label="${esc(t("ct.remove"))}" data-icon="x"></button></div>`;
  }).join("");
  __icons.apply($("#refs"));
  $("#refCount").textContent = C.refs.length ? `${C.refs.length}/${REFS}` : "";
  $("#refIn").disabled = $("#refAdd").disabled = C.refs.length >= REFS;
}
const refItems = plat => refs.flatMap(r => { const p = r.platforms && r.platforms[plat]; return ((p && p.releases) || []).slice(0, 2).map(x => ({ ...x, channel: p.name, avatar: p.avatar, ref: true })); });
$("#refForm").addEventListener("submit", e => {
  e.preventDefault();
  const text = $("#refIn").value.trim();
  if (!text) return;
  if (C.refs.length >= REFS) { $("#refStatus").textContent = t("ct.refFull"); return; }
  $("#refIn").value = ""; $("#refStatus").textContent = "";
  if (C.refs.includes(text)) return;
  C.refs.push(text); saveProfiles();
  loadRefs(false).then(() => HAL && HAL.profile.keepReferences(C.refs));
});
$("#refs").addEventListener("click", e => {
  const b = e.target.closest("[data-act=remove]"), row = e.target.closest(".ref");
  if (!b || !row) return;
  const i = +row.dataset.i;
  C.refs.splice(i, 1); refs.splice(i, 1); saveProfiles(); renderRefs(); render();
  if (HAL && HAL.profile.keepReferences) HAL.profile.keepReferences(C.refs);
});

/* ===== youtube ===== */
// The content of a view: the references' releases first (one of each artist), then the feed's items (and the
// profile's releases where the platform shows them), with the user's cover at its place; items missing (no cache,
// offline) are skeletons
const ME = "me";
function items(plat, n, pos, mix) {
  const f = (feeds[plat] && feeds[plat].items) || [], own = mix ? ((profile.platforms[plat] || {}).releases || []).map(r => ({ ...r, channel: myName(plat), avatar: myAvatar(plat), own: true })) : [];
  const pool = refItems(plat), total = pool.length + n - 1;
  for (let i = 0, a = 0, b = 0; pool.length < total && (a < f.length || b < own.length); i++) {
    if (mix && i % 3 === 1 && b < own.length) pool.push(own[b++]); else if (a < f.length) pool.push(f[a++]); else if (b < own.length) pool.push(own[b++]);
  }
  while (pool.length < total) pool.push(null);
  pool.splice(Math.max(0, Math.min(total, pos - 1)), 0, ME);
  return pool;
}
// The user's own releases on their page, the new cover at its place among them
function mine(plat, n, pos) {
  const list = ((profile.platforms[plat] || {}).releases || []).slice(0, n - 1).map(r => ({ ...r, channel: myName(plat), avatar: myAvatar(plat), own: true }));
  while (list.length < n - 1) list.push(null);
  list.splice(Math.max(0, Math.min(n - 1, pos - 1)), 0, ME);
  return list;
}
const myName = plat => C.fields.artist || (profile.platforms[plat] || {}).name || profile.name || t("ct.v.you");
const myAvatar = plat => (profile.platforms[plat] || {}).avatar || Object.values(profile.platforms).map(p => p.avatar).find(Boolean) || "";
const cover = plat => { const c = covers[C.active]; return c ? c.url[RATIO(plat)] : ""; };
const meTitle = () => C.fields.title || t("ct.v.untitled");
const ytMeta = it => it === ME ? [C.fields.views ? t("ct.v.views", { n: C.fields.views }) : "", C.fields.date].filter(Boolean).join(" • ") : [it.views ? views(it.views) : "", ago(it.date)].filter(Boolean).join(" • ");
const handle = (url, name) => { const m = /\/(@[^/?#]+)/.exec(url || ""); return m ? decodeURIComponent(m[1]) : "@" + String(name || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""); };
const icon = (n, cls = "") => `<span class="${cls}" data-icon="${n}"></span>`;

function ytThumb(it, prog) {
  if (!it) return `<div class="th"></div>`;
  const me = it === ME, src = me ? cover("youtube") : it.image, d = me ? C.fields.duration : it.duration ? clock(it.duration) : "";
  return `<div class="th${me ? " mine" : ""}"${me ? " data-me" : ""}>${src ? `<img src="${esc(src)}" alt="">` : ""}${d ? `<span class="dur">${esc(d)}</span>` : ""}${prog ? `<span class="yprog"><i style="width:${prog}%"></i></span>` : ""}</div>`;
}
const ytAv = it => img(it === ME ? myAvatar("youtube") : it && it.avatar, "av");
const ytT = it => it === ME ? [C.youtubeArtistInTitle ? myName("youtube") : "", meTitle()].filter(Boolean).join(" - ") : it.title;
const ytCh = it => it === ME ? myName("youtube") : it.channel || "";
function ytMast(phone, query) {
  return `<div class="mast">${phone ? "" : icon("menu", "burger")}<span class="ylogo"><img src="assets/brands/youtube-${C.dark.youtube ? "dark" : "light"}.svg" alt="YouTube"></span>${phone ? '<span class="spacer"></span>' : `<div class="search${query ? " q" : ""}">${esc(query || t("ct.v.search"))}</div>`}${img(myAvatar("youtube"), "me")}</div>`;
}
const CHIPS = ["all", "music", "mixes", "live", "gaming", "new"];
const ytChips = () => `<div class="ychips">${CHIPS.map((c, i) => `<span class="ychip${i ? "" : " on"}">${esc(t("ct.v.chip." + c))}</span>`).join("")}</div>`;
// From 1312 px YouTube shows its guide on the left (the wide page "at a distance")
const GUIDE = [["house", "home"], ["clapperboard", "shorts"], ["users", "subs"], null, ["history", "history"], ["layers", "playlists"], ["clock", "later"], ["thumbs-up", "liked"]];
const ytGuide = on => `<nav class="guide">${GUIDE.map(g => g ? `<span class="gi${g[1] === on ? " on" : ""}">${icon(g[0])}${esc(t("ct.v.guide." + g[1]))}</span>` : `<hr><p class="gh">${esc(t("ct.v.guide.you"))}${icon("chevron-right")}</p>`).join("")}</nav>`;
const GUIDE_W = 240;
function ytPage(W, body, o = {}) {
  const guide = W >= 1312;
  return `${ytMast(!!o.phone, o.query)}${guide ? `<div class="yshell">${ytGuide(o.on)}<div class="ymain">${body(W - GUIDE_W)}</div></div>` : body(W)}`;
}
function ytCell(it, i, avatar) {
  if (!it) return `<div class="cell"><div class="th"></div><div class="info">${avatar ? '<div class="av"></div>' : ""}<div style="flex:1"><div class="blk" style="height:18px;margin-bottom:8px"></div><div class="blk" style="height:14px;width:60%"></div></div></div></div>`;
  return `<div class="cell">${ytThumb(it, avatar && it !== ME && i === 5 ? 38 : 0)}<div class="info">${avatar ? ytAv(it) : ""}<div><h3 class="t clamp2">${esc(ytT(it))}</h3>${avatar ? `<p class="m clamp1">${esc(ytCh(it))}</p>` : ""}<p class="m">${esc(ytMeta(it))}</p></div></div></div>`;
}
function ytHome(W) {
  return ytPage(W, w => {
    const cols = Math.max(1, Math.min(5, Math.floor((w - 48 + 16) / (320 + 16)))), list = items("youtube", cols * 3, C.pos.home, false);
    return `${ytChips()}<div class="grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${list.map((it, i) => ytCell(it, i, true)).join("")}</div>`;
  }, { on: "home" });
}
// The artist's channel: banner, avatar, name and their videos, the new one at its place
const CTABS = ["home", "videos", "shorts", "releases", "playlists", "posts"];
function ytChannel(W, phone = false) {
  return ytPage(W, w => {
    const p = profile.platforms.youtube || {}, inner = Math.min(w - 48, 1284), cols = Math.max(1, Math.min(4, Math.floor((inner + 16) / (300 + 16))));
    const n = ((p.releases || []).length) + 1, list = mine("youtube", phone ? Math.max(n, 4) : cols * 3, phone ? C.pos.mobile : C.pos.channel);
    const sub = [`<b>${esc(handle(p.url, myName("youtube")))}</b>`, p.followers ? esc(t("ct.v.subs", { n: shortCount(p.followers) })) : "", esc(t("ct.v.videos", { n }))].filter(Boolean).join(" • ");
    return `<div class="chan" style="max-width:${inner + 48}px">${p.banner ? `<div class="banner"><img src="${esc(p.banner)}" alt=""></div>` : ""}
      <div class="chead">${img(myAvatar("youtube"), "cav")}<div style="min-width:0"><h1 class="clamp1">${esc(myName("youtube"))}</h1><p class="m">${sub}</p><p class="m">${esc(t("ct.v.more"))} <b>${esc(t("ct.v.moreLink"))}</b></p><span class="subbtn">${esc(t("ct.v.subscribe"))}</span></div></div>
      <div class="ctabs">${CTABS.map(k => `<span class="${k === "videos" ? "on" : ""}">${esc(t("ct.v.tab." + k))}</span>`).join("")}${icon("search")}</div>
      <div class="ychips"><span class="ychip on">${esc(t("ct.v.latest"))}</span><span class="ychip">${esc(t("ct.v.popularChip"))}</span><span class="ychip">${esc(t("ct.v.oldest"))}</span></div>
      <div class="grid" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${list.map((it, i) => ytCell(it, i, false)).join("")}</div></div>`;
  }, { on: "", phone });
}
function ytSearch(W) {
  return ytPage(W, w => {
    const list = items("youtube", 6, C.pos.search, true), tw = Math.round(Math.max(240, Math.min(500, (w - 48) * 0.42)));
    return `${ytChips()}<div class="results">${list.map(it => it ? `<div class="res"><div style="width:${tw}px;flex:none">${ytThumb(it)}</div><div style="min-width:0"><h3 class="t clamp2">${esc(ytT(it))}</h3><p class="m">${esc(ytMeta(it))}</p><div class="ch">${ytAv(it)}<span class="m">${esc(ytCh(it))}</span></div><p class="desc clamp2">${esc(it === ME ? t("ct.v.desc") : "")}</p></div></div>`
      : `<div class="res"><div style="width:${tw}px;flex:none"><div class="th"></div></div><div style="flex:1"><div class="blk" style="height:20px;margin-bottom:10px"></div><div class="blk" style="height:14px;width:40%"></div></div></div>`).join("")}</div>`;
  }, { query: meTitle() });
}
function ytMobile() {
  const view = C.mobileView, f = (feeds.youtube || {}).items || [], list = items("youtube", Math.max(5, f.length + 1), C.pos.mobile, view === "search");
  const content = view === "channel" ? ytChannel(390, true) : `${ytMast(true)}${view === "search" ? `<div class="mobile-query">${icon("search")}<span>${esc(meTitle())}</span></div>` : ytChips()}<div class="mfeed">${list.map(it => it ? `<div>${ytThumb(it)}<div class="info">${ytAv(it)}<div style="min-width:0"><h3 class="t clamp2">${esc(ytT(it))}</h3><p class="m clamp2">${esc([ytCh(it), ytMeta(it)].join(" • "))}</p></div></div></div>` : `<div><div class="th"></div></div>`).join("")}</div>`;
  return `<div class="phone-scroll" data-mobile-view="${view}">${content}</div><nav class="mobile-nav" aria-label="${esc(t("ct.view"))}">${["home", "search", "channel"].map(v => `<button data-mobile-view="${v}" aria-current="${v === view ? "page" : "false"}">${icon({ home: "house", search: "search", channel: "users" }[v])}<span>${esc(t("ct.view." + v))}</span></button>`).join("")}</nav>`;
}

/* ===== spotify ===== */
function spCard(it) {
  if (!it) return `<div class="spc"><div class="ph"></div><div class="blk" style="height:16px;margin-top:10px"></div></div>`;
  const me = it === ME;
  return `<div class="spc"${me ? " data-me" : ""}>${img(me ? cover("spotify") : it.image)}<p class="t clamp1">${esc(me ? meTitle() : it.title)}</p><p class="m clamp2">${esc(me ? t("ct.v.single", { artist: myName("spotify") }) : it.channel || myName("spotify"))}</p></div>`;
}
const hue = () => { const c = covers[C.active]; return c ? c.hue : "var(--sp-card)"; };
// Icons specific to the modern Spotify desktop chrome.
function spIcon(name) {
  const paths = { bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>', mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>', 'circle-plus': '<circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/>', 'chevron-left': '<path d="m15 18-6-6 6-6"/>' };
  paths["circle-arrow-down"] = '<circle cx="12" cy="12" r="9"/><path d="M12 6v12m-4-4 4 4 4-4"/>';
  return `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
function spShell(content, W, disc) {
  const name = myName("spotify"), wide = W >= 1000;
  const rail = disc.map(it => `<div class="sp-library-item${it.kind === "artist" ? " sp-library-artist" : ""}"${it === ME ? " data-me" : ""} title="${esc(it === ME ? meTitle() : it.title)}">${img(it === ME ? cover("spotify") : it.image)}</div>`).join("");
  const H = C.far ? FAR.h - 84 : $("#stage").clientHeight;
  return `<div class="sp-artist-app${wide ? " sp-wide" : ""}" style="height:${H}px">
    <div class="sp-topbar"><div class="sp-history">${icon("ellipsis")}${spIcon("chevron-left")}${icon("chevron-right")}</div><div class="sp-search-group"><span class="sp-home">${icon("house")}</span><div class="sp-search">${icon("search")}<span class="clamp1">${esc(t("ct.v.spotifySearch"))}</span><span class="sp-browse">${icon("library")}</span></div></div><div class="sp-account">${spIcon("bell")}${icon("users")}${img(myAvatar("spotify"), "sp-account-avatar")}</div></div>
    <div class="sp-workspace"><aside class="sp-library" aria-label="${esc(t("tab.library"))}"><div class="sp-library-head">${icon("library")}<span class="sp-add">${icon("plus")}</span></div><div class="sp-library-list">${rail}</div></aside>
    <div class="sp-artist-main">${content}</div><aside class="sp-right-rail">${spIcon("chevron-left")}</aside></div>
    <div class="sp-player"><div class="sp-now"><div data-me>${img(cover("spotify"))}</div><div class="sp-now-text"><p class="clamp1">${esc(meTitle())}</p><small class="clamp1">${esc(name)}</small></div>${spIcon("circle-plus")}</div><div class="sp-transport"><div class="sp-player-controls">${icon("shuffle")}${icon("skip-back")}<span class="sp-player-play">${icon("play")}</span>${icon("skip-forward")}${icon("repeat")}</div><div class="sp-timeline"><span>0:00</span><i></i><span>${esc(C.fields.duration)}</span></div></div><div class="sp-player-options">${spIcon("mic")}${icon("list")}${icon("monitor-play")}${icon("volume-2")}<i class="sp-volume"></i>${icon("maximize")}</div></div></div>`;
}
// The artist's page: header (their banner, else their picture on the cover's colour), Popular with the new song at
// its place, the artist pick and the discography
function spArtist(W) {
  const p = profile.platforms.spotify || {}, name = myName("spotify");
  const pop = mine("spotify", 5, C.pos.artist), disc = [ME, ...((p.releases || []).slice(0, 7))];
  const listenerCount = p.monthlyListeners ?? (p.followers || null);
  const listeners = listenerCount != null ? `<p class="lis">${esc(t("ct.v.listeners", { n: listenerCount.toLocaleString(document.documentElement.lang || "en") }))}</p>` : "";
  const identity = `<h1 class="aname clamp1">${esc(name)}</h1><p class="ver">${icon("badge-check")}${esc(t("ct.v.spotifyVerified"))}</p>${listeners}`;
  const hero = p.banner
    ? `<div class="ahero pic"><img src="${esc(p.banner)}" alt=""><div class="atx">${identity}</div></div>`
    : `<div class="ahero" style="--hue:${hue()}">${img(myAvatar("spotify"), "aav")}<div class="atx">${identity}</div></div>`;
  const row = (it, i) => it ? `<div class="pr"><span class="num">${i + 1}</span><div${it === ME ? " data-me" : ""}>${img(it === ME ? cover("spotify") : it.image, "pt")}</div><span class="song"><span class="clamp1">${esc(it === ME ? meTitle() : it.title)}</span><small class="clamp1">${esc(it === ME ? name : it.channel || name)}</small></span><span class="r">${esc(it === ME ? C.fields.views : it.views != null ? it.views.toLocaleString(document.documentElement.lang || "en") : "")}</span><span class="r">${esc(it === ME ? C.fields.duration : it.duration ? clock(it.duration) : "")}</span></div>`
    : `<div class="pr"><span class="num">${i + 1}</span><div class="pt ph"></div><div class="blk" style="height:14px;width:50%"></div><span></span><span></span></div>`;
  return spShell(`${hero}<div class="sp-artist-content" style="--sp-fade:${p.banner ? "var(--sp-card-hover)" : hue()}"><div class="tools"><span class="pbtn"></span><span class="sp-current-cover" data-me>${img(cover("spotify"))}</span>${icon("shuffle", "ic")}<span class="fol">${esc(t("ct.v.follow"))}</span>${icon("ellipsis", "ic")}</div>
    <div class="abody"><div class="sp-popular"><h3>${esc(t("ct.v.popularH"))}</h3>${pop.map(row).join("")}</div>
    <div class="sp-artist-pick"><h3>${esc(t("ct.v.pick"))}</h3><div class="pick"><div class="sp-pick-backdrop" data-me>${img(cover("spotify"))}</div><p class="by">${img(myAvatar("spotify"))}<span class="clamp1">${esc(t("ct.v.pickBy", { artist: name }))}</span></p><div class="sp-pick-release"><div data-me>${img(cover("spotify"), "pc")}</div><div><p class="t clamp1">${esc(meTitle())}</p><p class="m">${esc(t("ct.v.singleKind"))}</p></div></div></div></div></div>
    <h3>${esc(t("ct.v.discography"))}</h3><div class="cards">${disc.map(spCard).join("")}</div></div>`, W, disc);
}
function spRelease(W) {
  const c = covers[C.active], year = new Date().getFullYear(), own = ((profile.platforms.spotify || {}).releases || []).slice(0, 6), f = (feeds.spotify && feeds.spotify.items) || [];
  const more = (own.length ? own : f.slice(0, 6));
  return spShell(`<div class="hero" style="--hue:${c ? c.hue : "var(--sp-card)"}"><div data-me>${img(cover("spotify"), "cover")}</div><div style="min-width:0"><p class="kind">${esc(t("ct.v.singleKind"))}</p><h1 class="hl clamp1">${esc(meTitle())}</h1>
    <div class="by">${img(myAvatar("spotify"))}<b>${esc(myName("spotify"))}</b><span>• ${year} • ${esc(t("ct.v.oneSong", { d: C.fields.duration }))}</span></div></div></div>
    <div class="sp-release-content" style="--hue:${c ? c.hue : "var(--sp-card)"}"><div class="tools"><span class="pbtn"></span><span class="sp-current-cover" data-me>${img(cover("spotify"))}</span>${icon("shuffle", "ic")}${spIcon("circle-plus")}${spIcon("circle-arrow-down")}${icon("ellipsis", "ic")}<span class="sp-track-layout">${esc(t("ct.v.list"))}${icon("list")}</span></div>
    <div class="tracks"><div class="tr head"><span class="num">#</span><span>${esc(t("ct.v.titleCol"))}</span><span class="r">${esc(t("ct.v.plays"))}</span><span class="r">${icon("clock")}</span></div>
    <div class="tr"><span class="num">1</span><span class="clamp1">${esc(meTitle())}<small>${esc(myName("spotify"))}</small></span><span class="r">${esc(C.fields.views)}</span><span class="r">${esc(C.fields.duration)}</span></div></div>
    <div class="sp-release-notes">${C.fields.date ? `<p>${esc(C.fields.date)}</p>` : ""}</div>
    <div class="sp-related-head"><h3>${esc(t("ct.v.moreBy", { artist: myName("spotify") }))}</h3><span>${esc(t("ct.v.viewDiscography"))}</span></div><div class="cards">${(more.length ? more : Array(6).fill(null)).map(spCard).join("")}</div></div>`, W, [ME, ...own]);
}
function spHomeCard(it) {
  if (!it) return `<div class="sp-home-card"><div class="ph"></div><div class="blk" style="height:16px;margin-top:12px"></div><div class="blk" style="height:14px;margin-top:8px;width:70%"></div></div>`;
  const me = it === ME, artist = it.kind === "artist";
  const title = me ? meTitle() : it.title;
  const subtitle = artist ? t("ct.view.artist") : me ? t("ct.v.single", { artist: myName("spotify") }) : it.channel || "";
  return `<div class="sp-home-card${artist ? " sp-home-artist" : ""}" data-kind="${artist ? "artist" : "release"}"${me ? " data-me" : ""}>${img(me ? cover("spotify") : it.image)}<p class="t clamp1">${esc(title)}</p><p class="m clamp2">${esc(subtitle)}</p></div>`;
}
function spRow(W) {
  const p = profile.platforms.spotify || {}, name = myName("spotify");
  const own = (p.releases || []).map(r => ({ ...r, channel: name }));
  const feed = (feeds.spotify && feeds.spotify.items) || [], related = refItems("spotify");
  const artists = refs.flatMap(r => {
    const artist = (r.platforms || {}).spotify || Object.values(r.platforms || {}).find(x => x.name && x.avatar);
    return artist ? [{ kind: "artist", title: artist.name || r.name, image: artist.avatar, releases: (r.platforms.spotify || {}).releases || [] }] : [];
  });
  if (p.name || p.avatar) artists.unshift({ kind: "artist", title: name, image: myAvatar("spotify"), releases: own });
  const recent = [];
  // Mix identities and publications; the active release occurs once at the user's chosen position.
  for (let i = 0; recent.length < 8 && (i < artists.length || i < feed.length || i < own.length); i++) {
    if (artists[i]) recent.push(artists[i]);
    const release = artists[i] && artists[i].releases[0] || feed[i] || own[i];
    if (release && recent.length < 8) recent.push({ ...release, channel: release.channel || (artists[i] && artists[i].title) || name });
  }
  while (recent.length < 8) recent.push(null);
  recent.splice(Math.max(0, Math.min(8, (C.pos.row || 1) - 1)), 0, ME);
  const unique = list => [...new Map(list.map(it => [it.url || it.id || it.title, it])).values()];
  const releases = unique([...related, ...feed, ...own]).slice(0, 12);
  const shelf = (heading, list, caption = "", id = "") => `<section class="sp-home-shelf"${id ? ` id="${id}"` : ""}>${caption ? `<p class="sp-home-caption">${esc(caption)}</p>` : ""}<div class="sp-home-heading"><h3>${esc(heading)}</h3><span>${esc(t("ct.v.showAll"))}</span></div><div class="sp-home-cards">${(list.length ? list : Array(9).fill(null)).map(spHomeCard).join("")}</div></section>`;
  return spShell(`<div class="sp-home-filters"><span class="sp-home-filter active">${esc(t("ct.v.all"))}</span><span class="sp-home-filter">${esc(t("ct.v.music"))}</span><span class="sp-home-filter">${esc(t("ct.v.podcasts"))}</span></div><div class="sp-home-content">
    ${shelf(t("ct.v.recent"), recent, "", "spRecent")}
    ${shelf(t("ct.v.newReleases"), releases)}
    ${shelf(t("ct.v.recommendedArtists"), artists.slice(0, 12), t("ct.v.homeBasedOn"))}
    ${own.length ? shelf(t("ct.v.moreBy", { artist: name }), own.slice(0, 12)) : ""}</div>`, W, recent.filter(Boolean));
}

/* ===== soundcloud ===== */
function scIcon(name) {
  const paths = { cloud:'<path d="M10 6a6 6 0 0 1 11 5 4 4 0 0 1-1 8H10Z"/><path d="M2 12v5M5 9v10M8 7v12"/>', heart:'<path d="M20 4a5 5 0 0 0-8 1 5 5 0 0 0-8-1c-4 4 0 9 8 15 8-6 12-11 8-15Z"/>', bell:'<path d="M4 17h16l-2-3V9a6 6 0 0 0-12 0v5ZM10 21h4"/>', share:'<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m9 10 6-4m-6 8 6 4"/>' };
  return `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
function scNav() {
  return `<div class="sc-nav"><div class="sc-nav-inner"><span class="sc-logo"><img src="assets/brands/soundcloud.webp" alt="SoundCloud"></span><span class="sc-nav-link">${esc(t("ct.view.home"))}</span><span class="sc-nav-link">${esc(t("ct.view.feed"))}</span><span class="sc-nav-link">${esc(t("tab.library"))}</span><span class="sc-search">${esc(t("ct.v.search"))}${icon("search")}</span>${img(myAvatar("soundcloud"), "sc-nav-avatar")}${scIcon("bell")}${icon("ellipsis")}</div></div>`;
}
const scActions = () => `<div class="sc-actions">${[["heart","like"],["repeat","repost"],["share","share"],["link","copyLink"],["ellipsis","moreAction"]].map(([i,k]) => `<span class="sc-action">${["heart","share"].includes(i)?scIcon(i):icon(i)}${esc(t("ct.sc." + k))}</span>`).join("")}</div>`;
function scRelated() {
  const own = ((profile.platforms.soundcloud || {}).releases || []).slice(0, 4);
  return `<h4>${esc(t("ct.v.moreFrom", { artist: myName("soundcloud") }))}</h4>${own.map(r => `<div class="mini">${img(r.image)}<div style="min-width:0"><p class="m clamp1">${esc(myName("soundcloud"))}</p><p class="t clamp2">${esc(r.title)}</p><p class="m">▶ ${esc(shortCount(r.views))}</p></div></div>`).join("")}`;
}
function scTrack(W) {
  const p = profile.platforms.soundcloud || {}, name = myName("soundcloud");
  const links = Object.entries(profile.platforms).filter(([,value]) => value.url);
  const action = (i,k) => `<span class="sct-action" title="${esc(t("ct.sc." + k))}">${i === "heart" ? scIcon(i) : i === "shopping-cart" ? scProfileIcon("cart") : icon(i)}</span>`;
  return `<div class="sct-hero" style="--hue:${covers[C.active]?.hue || "var(--sc-track-hero-dark)"}"><div class="sct-main"><div class="sct-heading"><span class="pbtn"></span><div><h1 class="clamp1">${esc(meTitle())}</h1><p class="sct-byline"><b>${esc(name)}</b><span>·</span>${esc(C.fields.date)}</p></div></div>
    <div class="wave">${wave(meTitle())}<span class="wave-time">0:00</span><span class="wave-time end">${esc(C.fields.duration)}</span></div>
    <div class="sct-actions">${action("heart","like")}<div class="sct-comment">${img(myAvatar("soundcloud"))}<span>${esc(t("ct.sc.commentAt", {time:"0:00"}))}</span>${icon("send")}</div>${action("upload","share")}${action("link","copyLink")}${action("repeat","repost")}${action("plus","addToPlaylist")}${action("shopping-cart","buy")}${action("ellipsis","moreAction")}</div></div><div class="sct-art" data-me>${img(cover("soundcloud"),"art")}</div></div>
    <div class="sct-body"><div class="sct-details"><h2>${esc(t("ct.sc.details"))}</h2><p>${esc(meTitle())}</p><p class="m">${esc(t("ct.v.single", {artist:name}))}</p><div class="sct-links">${links.map(([platform,value]) => `<div><b>${esc(PLAT_NAME[platform])}</b><span>${esc(value.url)}</span></div>`).join("")}</div><h2 class="sct-comments-title">${esc(t("ct.sc.comments"))}</h2><p class="sct-empty">${esc(t("ct.sc.noComments"))}</p></div>
    <aside class="sct-side"><div class="sct-artist"><div class="sct-artist-info">${img(myAvatar("soundcloud"))}<div><b class="clamp1">${esc(name)}</b><p>${esc(handle(p.url,name))}</p><p>${p.followers ? esc(shortCount(p.followers)) : "—"} ${esc(t("ct.v.followers"))} · ${(p.releases || []).length + 1} ${esc(t("ct.v.tracks"))}</p></div></div><div class="sct-artist-actions"><span>${esc(t("ct.v.follow"))}</span><span>${esc(t("ct.sc.message"))}</span></div></div><div class="sct-metrics">${[[C.fields.views,"plays"],["—","likes"],["—","reposts"]].map(([value,key]) => `<div><b>${esc(value)}</b><small>${esc(t("ct.sc." + key))}</small></div>`).join("")}</div><div class="sct-related">${scRelated()}</div></aside></div>`;
}
function scPost(it, who = true) {
  if (!it) return `<div class="post"><div class="trk"><div class="art ph"></div><div class="r"><div class="blk" style="height:16px;width:40%"></div></div></div></div>`;
  const me = it === ME, name = me ? myName("soundcloud") : it.channel;
  return `<div class="post">${who ? `<div class="who">${img(me ? myAvatar("soundcloud") : it.avatar)}<span><b>${esc(name)}</b> ${esc(t("ct.v.posted"))} ${esc(me ? C.fields.date : ago(it.date))}</span></div>` : ""}
    <div class="trk"><div${me ? " data-me" : ""}>${img(me ? cover("soundcloud") : it.image, "art")}</div><div class="r"><div class="head"><span class="pbtn"></span><div style="min-width:0"><p class="m clamp1">${esc(name)}</p><p class="t clamp1">${esc(me ? meTitle() : it.title)}</p></div>${who ? "" : `<span class="when2">${esc(me ? C.fields.date : ago(it.date))}</span>`}</div>
    <div class="wave">${wave(me ? meTitle() : (it.id ?? it.title), me ? 0.3 : 0)}<span class="wave-time">${me ? "0:58" : "0:00"}</span><span class="wave-time end">${esc(me ? C.fields.duration : clock(it.duration))}</span></div><div class="sc-track-tools">${scActions()}<div class="stats"><span>▶ ${esc(me ? C.fields.views : shortCount(it.views))}</span></div></div></div></div></div>`;
}
function scFeedPost(it) {
  const actions = `<div class="sc-actions">${[["heart","like","likes"],["repeat","repost","reposts"],["upload","share"],["copy","copyLink"],["ellipsis","moreAction"]].map(([i,k,count]) => `<span class="sc-action" title="${esc(t("ct.sc." + k))}">${i === "heart" ? scIcon(i) : icon(i)}${it && it !== ME && count && Number.isFinite(it[count]) ? `<b>${esc(shortCount(it[count]))}</b>` : ""}</span>`).join("")}</div>`;
  // Retain scPost's content, order and exact waveform call; Feed only changes the actions' presentation.
  return scPost(it).replace(scActions(),actions);
}
function scFeed() {
  const list = items("soundcloud",5,C.pos.feed,true), seen = new Set();
  const artists = list.filter(it => {
    if (!it || it === ME || !it.channel || seen.has(it.channel)) return false;
    seen.add(it.channel); return true;
  });
  const suggestions = artists.filter(it => !it.own).slice(0,3);
  return `<div class="scf-columns"><div class="stream"><div class="scf-heading"><h1>${esc(t("ct.sc.feedHeading"))}</h1><span class="scf-reposts">${esc(t("ct.v.sc.reposts"))}<i></i></span></div>${list.map(scFeedPost).join("")}</div>
    <aside class="scf-side"><section class="scf-insights"><h2>${esc(t("ct.sc.activity", {artist:myName("soundcloud")}))}</h2><p>${esc(t("ct.sc.lastSevenDays"))}</p><div class="scf-insight-cards">${["plays","likes","comments"].map(k => `<div class="scf-insight-card"><small>${esc(t("ct.sc." + k))}</small><b>—</b></div>`).join("")}</div><span class="scf-insights-link">${esc(t("ct.sc.viewInsights"))}</span></section>
    <section class="scf-tools"><h2>${esc(t("ct.sc.artistTools"))}${icon("chevron-down")}</h2><div>${[["zap","boost"],["repeat","replace"],["globe","distribute"],["audio-lines","master"]].map(([i,k]) => `<span class="scf-tool">${icon(i)}<b>${esc(t("ct.sc." + k))}</b></span>`).join("")}</div></section>
    <section class="scf-new"><h2>${esc(t("ct.sc.newTracks"))}</h2><div class="scf-new-artists">${artists.slice(0,5).map(it => `<div>${img(it.avatar || it.image)}<b class="clamp1">${esc(it.channel)}</b></div>`).join("")}</div></section>
    <section class="scf-suggestions"><h2>${esc(t("ct.sc.artistsToFollow"))}<span>${esc(t("ct.sc.refreshList"))}</span></h2>${suggestions.map(it => `<div class="scf-suggestion">${img(it.avatar || it.image)}<div><b class="clamp1">${esc(it.channel)}</b>${it.ref ? (() => { const p = refs.map(r => r.platforms?.soundcloud).find(p => p?.name === it.channel); return p?.followers ? `<small>${icon("users")}${esc(shortCount(p.followers))}</small>` : ""; })() : ""}</div><span>${esc(t("ct.v.follow"))}</span></div>`).join("")}</section>
    <section class="scf-related">${scRelated()}</section></aside></div>`;
}
// The artist's profile: banner, picture and name, the tabs and their tracks with the new one at its place
const PTABS = ["all", "popular", "tracks", "albums", "playlists", "reposts"];
function scProfileIcon(name) {
  const paths = { mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 6 9 7 9-7"/>', radio: '<circle cx="12" cy="12" r="2"/><path d="M7 7a7 7 0 0 0 0 10m10-10a7 7 0 0 1 0 10M4 4a11 11 0 0 0 0 16M20 4a11 11 0 0 1 0 16"/>', cart: '<path d="M2 3h3l3 13h11l3-10H6"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>' };
  return `<svg class="i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
}
function scProfileNav(view = "profile") {
  return `<div class="scp-nav"><div class="scp-nav-inner"><span class="scp-mark"><img src="assets/brands/soundcloud.webp" alt="SoundCloud"></span><span>${esc(t("ct.view.home"))}</span><span${view === "feed" ? ' class="scf-nav-active"' : ""}>${esc(t("ct.view.feed"))}</span><span>${esc(t("tab.library"))}</span><div class="scp-search">${esc(t("ct.v.search"))}${icon("search")}</div><span class="scp-upgrade">${esc(t("ct.sc.tryGo"))}</span><span class="scp-nav-extra">${esc(t("ct.sc.artistStudio"))}</span><span class="scp-nav-extra">${esc(t("ct.sc.upload"))}</span>${img(myAvatar("soundcloud"), "scp-nav-avatar")}${icon("chevron-down")}${scIcon("bell")}${scProfileIcon("mail")}${icon("ellipsis")}</div></div>`;
}
function scProfilePost(it) {
  const actions = `<div class="sc-actions">${[["heart","like"],["repeat","repost"],["share","share"],["copy","copyLink"],["ellipsis","moreAction"]].map(([i,k]) => `<span class="sc-action" title="${esc(t("ct.sc." + k))}">${i === "heart" ? scIcon(i) : icon(i)}</span>`).join("")}</div>`;
  // Keep scPost's data and its current wave() call; only Profile's action presentation changes.
  return scPost(it, false).replace(scActions(), actions);
}
function scProfile(W) {
  const p = profile.platforms.soundcloud || {}, list = mine("soundcloud", 4, C.pos.profile), n = ((p.releases || []).length) + 1;
  const name = myName("soundcloud"), links = Object.entries(profile.platforms).filter(([,value]) => value.url);
  return `<div class="phero">${p.banner ? `<img class="pban" src="${esc(p.banner)}" alt="">` : ""}<div class="pin">${img(myAvatar("soundcloud"), "pav")}<div class="boxes"><span class="box">${esc(name)}</span><br><span class="box a">${esc(handle(p.url,name))}</span></div></div></div>
    <div class="scp-profile-toolbar"><div class="ptabs">${PTABS.map(k => `<span class="${k === "tracks" ? "on" : ""}">${esc(t("ct.v.sc." + k))}</span>`).join("")}</div><div class="scp-profile-actions"><span class="scp-action">${scProfileIcon("radio")}${esc(t("ct.sc.station"))}</span><span class="scp-action">${icon("users")}${esc(t("ct.v.follow"))}</span><span class="scp-action">${icon("upload")}${esc(t("ct.sc.share"))}</span><span class="scp-action">${scProfileIcon("mail")}</span><span class="scp-action">${icon("ellipsis")}</span></div></div>
    <div class="pbody" style="grid-template-columns:${W >= 900 ? "minmax(0,1fr) 328px" : "minmax(0,1fr)"}"><div class="stream"><h2 class="scp-recent">${esc(t("ct.sc.recent"))}</h2>${list.map(scProfilePost).join("")}</div>
    ${W >= 900 ? `<aside class="pside"><div class="scp-support"><p>${esc(t("ct.sc.supportNote"))}</p><span class="scp-support-more">${esc(t("ct.sc.learnMore"))}</span><span class="scp-support-button">${esc(t("ct.sc.supportArtist", {artist:name}))}</span></div><div class="pstat"><span><small>${esc(t("ct.v.followers"))}</small><b>${p.followers ? esc(shortCount(p.followers)) : "—"}</b></span><span><small>${esc(t("ct.v.following"))}</small><b>—</b></span><span><small>${esc(t("ct.v.tracks"))}</small><b>${n}</b></span></div><div class="scp-identity"><b>${esc(name)}</b><span>${esc(handle(p.url,name))}</span></div><div class="sc-profile-links">${links.map(([platform,value]) => `<span class="scp-social" title="${esc(value.url)}">${platform === "soundcloud" ? scIcon("cloud") : icon(platform === "youtube" ? "play" : "music")}${esc(PLAT_NAME[platform])}</span>`).join("")}</div>${scRelated()}</aside>` : ""}</div>`;
}
function scProfilePage(W, view = "profile") {
  const H = C.far ? FAR.h - 84 : $("#stage").clientHeight;
  return `<div class="scp-app" style="height:${H}px">${scProfileNav(view)}<div class="scp-scroll"><div class="scp-container">${(view === "track" ? scTrack : view === "feed" ? scFeed : scProfile)(Math.min(1240,W))}</div></div><div class="scp-player"><div class="scp-player-inner"><div class="scp-transport">${icon("skip-back")}<span class="scp-player-play">${icon("play")}</span>${icon("skip-forward")}${icon("shuffle")}${icon("repeat")}</div><span class="scp-player-time">0:00</span><i class="scp-progress"></i><span class="scp-player-time">${esc(C.fields.duration)}</span>${icon("volume-2")}<div class="scp-playing"><span data-me>${img(cover("soundcloud"))}</span><div><small class="clamp1">${esc(myName("soundcloud"))}</small><b class="clamp1">${esc(meTitle())}</b></div></div>${scIcon("heart")}${icon("users")}${icon("list")}</div></div></div>`;
}

/* ===== render ===== */
const RENDER = { channel: ytChannel, home: ytHome, search: ytSearch, mobile: ytMobile, artist: spArtist, release: spRelease, row: spRow, profile: scProfile, track: scTrack, feed: scFeed };
const PHONE = new Set(["mobile"]);
// "At a distance" (§2): the page as a browser shows it on a 1920 × 1080 screen, scaled down to fit the stage — the
// same view with the room a wide screen gives it (more columns, YouTube's guide), not only smaller
const FAR = { w: 1920, h: 1080, phone: [430, 884] };
const slug = s => String(s || "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "");
function address() {
  const plat = C.platform, v = C.view[plat], p = profile.platforms[plat] || {}, name = myName(plat), title = meTitle();
  const home = { youtube: "www.youtube.com", spotify: "open.spotify.com", soundcloud: "soundcloud.com" }[plat];
  const path = {
    channel: "/" + handle(p.url, name) + "/videos", home: "/", search: "/results?search_query=" + encodeURIComponent(title).replace(/%20/g, "+"),
    artist: "/artist/" + (p.id || slug(name)), release: "/album/" + slug(title), row: "/",
    profile: "/" + slug(name), track: "/" + slug(name) + "/" + slug(title), feed: "/feed"
  }[v] || "/";
  const tab = {
    channel: `${name} - YouTube`, home: "YouTube", search: `${title} - YouTube`,
    artist: `${name} | Spotify`, release: t("ct.browser.release", { title, name }), row: t("ct.browser.spotify"),
    profile: `${name} | SoundCloud`, track: t("ct.browser.track", { title, name }), feed: "SoundCloud"
  }[v];
  return { url: home + path, tab };
}
function renderChrome() {
  const a = address(), el = $("#chrome");
  el.innerHTML = `<div class="btabs"><span class="btab"><i class="fav ${C.platform}"></i><span class="clamp1">${esc(a.tab)}</span>${icon("x")}</span><span class="bnew" title="${esc(t("ct.v.newTab"))}">${icon("plus")}</span></div>
    <div class="baddr">${icon("arrow-left")}${icon("arrow-right")}${icon("refresh-cw")}<span class="url">${icon("lock")}<span class="clamp1">${esc(a.url)}</span></span></div>`;
  __icons.apply(el);
}
function placeFar() {
  const fb = $("#farbox"), st = $("#stage"), phone = PHONE.has(C.view[C.platform]);
  st.classList.toggle("far", C.far);
  fb.classList.toggle("phonebox", C.far && phone);
  $("#chrome").hidden = !C.far || phone;
  if (!C.far) { fb.style.width = fb.style.height = fb.style.transform = ""; return; }
  const [W, H] = phone ? FAR.phone : [FAR.w, FAR.h], sw = st.clientWidth, sh = st.clientHeight, k = Math.min((sw - 32) / W, (sh - 32) / H, 1);
  Object.assign(fb.style, { width: W + "px", height: H + "px", transform: `translate(${Math.round((sw - W * k) / 2)}px,${Math.round((sh - H * k) / 2)}px) scale(${k})` });
}
function pageWidth() { return C.far ? FAR.w : Math.max(360, $("#stage").clientWidth); }
function render() {
  const plat = C.platform, view = C.view[plat], page = $("#page");
  const cls = ["pf", { youtube: "yt", spotify: "sp", soundcloud: "sc" }[plat], view];
  if (PHONE.has(view)) cls.push("phone");
  if (THEMED[plat]) cls.push(C.dark[plat] ? "dark" : "light");
  if (plat === "soundcloud" && pageWidth() <= 1050) cls.push("sc-narrow");
  page.className = cls.join(" ");
  page.style.width = PHONE.has(view) ? "" : pageWidth() + "px";
  let resolutions;
  if (plat === "soundcloud" && C.far) {
    // Measure the base view before rendering the wide scene: distance scales its waveform resolution,
    // rather than adding bars for the wider virtual browser. This also works when opening directly in far.
    const baseWidth = Math.max(360, $("#stage").clientWidth);
    page.classList.toggle("sc-narrow", baseWidth <= 1050);
    page.style.width = baseWidth + "px";
    page.innerHTML = scProfilePage(baseWidth, view);
    resolutions = waveResolutions(page);
    page.className = cls.join(" ");
    page.style.width = pageWidth() + "px";
  }
  page.innerHTML = plat === "soundcloud" ? scProfilePage(pageWidth(),view) : RENDER[view](pageWidth());
  if (plat === "soundcloud") fitWaves(page, resolutions);
  __icons.apply(page);
  placeFar();
  if (C.far) renderChrome();
  if (!stats.firstPaint && covers.length) stats.firstPaint = Math.round(performance.now());
}
// Changing the active cover touches only its pictures and cover-derived hero colours, never the rest of the view
function swapCover() {
  const plat = C.platform, src = cover(plat), c = covers[C.active];
  $("#page").querySelectorAll("[data-me] img").forEach(i => { i.src = src; });
  if (c && plat === "spotify") $("#page").querySelectorAll("[style*='--hue'],[style*='--sp-fade']").forEach(el => { if (el.style.getPropertyValue("--hue")) el.style.setProperty("--hue", c.hue); if (el.style.getPropertyValue("--sp-fade") && !el.style.getPropertyValue("--sp-fade").startsWith("var(")) el.style.setProperty("--sp-fade", c.hue); });
  if (c && plat === "soundcloud") $("#page").querySelector(".sct-hero")?.style.setProperty("--hue", c.hue);
}
new ResizeObserver(() => { if (C.far) placeFar(); else if (!PHONE.has(C.view[C.platform])) render(); }).observe($("#stage"));

/* ===== controls ===== */
const leftScroll = { cover: 0, references: 0 };
function renderLeftTabs() {
  $("#leftTabs").querySelectorAll("[data-left-tab]").forEach(b => b.setAttribute("aria-selected", String(b.dataset.leftTab === C.leftTab)));
  $("#coverPanel").hidden = C.leftTab !== "cover";
  $("#referencesPanel").hidden = C.leftTab !== "references";
}
$("#leftTabs").addEventListener("click", e => {
  const b = e.target.closest("[data-left-tab]"); if (!b || b.dataset.leftTab === C.leftTab) return;
  leftScroll[C.leftTab] = $("#leftContent").scrollTop;
  C.leftTab = b.dataset.leftTab; renderLeftTabs();
  $("#leftContent").scrollTop = leftScroll[C.leftTab];
  saveState();
});
function renderViews() {
  const plat = C.platform;
  // the options are replaced, the segmented pill (motion.js) stays
  $("#views").querySelectorAll("[data-view]").forEach(b => b.remove());
  $("#views").insertAdjacentHTML("beforeend", VIEWS[plat].map(v => `<button class="tab" role="radio" data-view="${v}" aria-checked="${C.view[plat] === v}">${esc(t("ct.view." + v))}</button>`).join(""));
  $("#plats").querySelectorAll("[data-plat]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.plat === plat)));
  $("#themeBtn").hidden = !THEMED[plat];
  $("#youtubeArtistInTitleRow").hidden = plat !== "youtube";
  $("#themeBtn").setAttribute("aria-pressed", String(!!C.dark[plat]));
  const v = C.view[plat], n = POS[v];
  $("#fPos").innerHTML = n ? Array.from({ length: n }, (_, i) => `<option value="${i + 1}">${esc(t("ct.pos", { n: i + 1 }))}</option>`).join("") : `<option>${esc(t("ct.posFixed"))}</option>`;
  $("#fPos").disabled = !n; if (n) $("#fPos").value = String(C.pos[v] || 1);
  renderCovers(); renderFeedInfo();
}
$("#plats").addEventListener("click", e => {
  const b = e.target.closest("[data-plat]"); if (!b || b.dataset.plat === C.platform) return;
  C.platform = b.dataset.plat; saveState(); renderViews(); render(); $("#bview").scrollTop = 0;
  if (!feeds[C.platform]) loadFeed(C.platform, false);
  M.enter && M.enter($("#page"));
});
$("#views").addEventListener("click", e => {
  const b = e.target.closest("[data-view]"); if (!b) return;
  C.view[C.platform] = b.dataset.view; saveState(); renderViews(); render();
  $("#scroller").scrollTop = 0; $("#bview").scrollTop = 0;
});
$("#page").addEventListener("click", e => {
  const b = e.target.closest("button[data-mobile-view]");
  if (!b) return;
  C.mobileView = b.dataset.mobileView; saveState(); render();
});
$("#themeBtn").addEventListener("click", () => { C.dark[C.platform] = !C.dark[C.platform]; saveState(); renderViews(); render(); });
$("#fPos").addEventListener("change", e => { C.pos[C.view[C.platform]] = +e.target.value; saveState(); render(); });
// "At a distance" (render: FAR): the page laid out for a wide screen inside a browser window, scaled to fit
function setFar(on, quiet) {
  C.far = on;
  if (!quiet) saveState();
  $("#farBtn").setAttribute("aria-pressed", String(on));
  $("#scroller").scrollTop = 0; $("#bview").scrollTop = 0;
  render();
  if (!quiet) M.scaleIn($("#scroller"));
}
$("#farBtn").addEventListener("click", () => setFar(!C.far));
let previewMaximized = false;
function setPreviewMaximized(on) {
  previewMaximized = on;
  document.body.classList.toggle("preview-maximized", on);
  $(".monitor").classList.toggle("preview-maximized", on);
  document.querySelectorAll(".rack").forEach(el => { el.inert = on; });
  const button = $("#maximizePreviewBtn"), label = t(on ? "ct.restorePreview" : "ct.maximizePreview");
  button.setAttribute("aria-pressed", String(on));
  button.setAttribute("aria-label", label); button.title = label;
  button.innerHTML = icon(on ? "minimize-2" : "maximize"); __icons.apply(button);
  render(); button.focus({ preventScroll: true });
}
$("#maximizePreviewBtn").addEventListener("click", () => setPreviewMaximized(!previewMaximized));
window.addEventListener("keydown", e => {
  if (e.key === "Escape" && previewMaximized || e.ctrlKey && !e.altKey && !e.metaKey && e.key.toLowerCase() === "m") {
    e.preventDefault(); e.stopImmediatePropagation();
    if (!e.repeat) setPreviewMaximized(e.key === "Escape" ? false : !previewMaximized);
  }
}, true);
const FIELDS = { fTitle: "title", fArtist: "artist", fViews: "views", fDuration: "duration", fDate: "date" };
function syncFields() { for (const [id, k] of Object.entries(FIELDS)) $("#" + id).value = C.fields[k] || ""; $("#fArtist").placeholder = profile.name || ""; $("#youtubeArtistInTitle").checked = C.youtubeArtistInTitle; }
for (const [id, k] of Object.entries(FIELDS)) $("#" + id).addEventListener("input", e => { C.fields[k] = e.target.value; render(); });
for (const id of Object.keys(FIELDS)) $("#" + id).addEventListener("change", saveState);
$("#youtubeArtistInTitle").addEventListener("change", e => { C.youtubeArtistInTitle = e.target.checked; saveState(); render(); });
$("#scales").addEventListener("click", e => { const b = e.target.closest("[data-scale]"); if (!b) return; C.scale = +b.dataset.scale; saveState(); syncScale(); });
const syncScale = () => $("#scales").querySelectorAll("[data-scale]").forEach(b => b.setAttribute("aria-checked", String(+b.dataset.scale === C.scale)));
// Keys: 1, 2, 3 the covers
window.addEventListener("keydown", e => {
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) || e.ctrlKey || e.metaKey || e.altKey) return;
  if (/^[123]$/.test(e.key)) pick(+e.key - 1);
});
// Input: file, drop, the Library
$("#imgIn").addEventListener("change", e => { const f = e.target.files[0]; e.target.value = ""; if (f) addCover(f); });
$("#browseBtn").addEventListener("click", () => $("#imgIn").click());
$("#libBtn").addEventListener("click", async () => {
  if (!HAL || !HAL.pickFromLibrary) return;
  const r = await HAL.pickFromLibrary({ kind: "image", from: $("#libBtn") }).catch(() => null);
  const it = Array.isArray(r) ? r[0] : r;
  if (it) addCover(it.blob ? { blob: it.blob, name: it.name } : { path: it.path, name: it.name });
});
$("#emptyStage").addEventListener("click", e => { if (!e.target.closest("button")) $("#imgIn").click(); });
$("#emptyStage").addEventListener("keydown", e => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); $("#imgIn").click(); } });
window.addEventListener("dragover", e => e.preventDefault());
window.addEventListener("drop", e => {
  e.preventDefault(); document.body.classList.remove("dragging");
  const f = e.dataTransfer && [...e.dataTransfer.files].find(x => /^image\/(png|jpeg|webp)$/.test(x.type) || /\.(png|jpe?g|webp)$/i.test(x.name));
  if (f) addCover(f); else if (e.dataTransfer && e.dataTransfer.files.length) setStatus(t("up.err.notImage"), "bad");
});

/* ===== export ===== */
// The view as a PNG at its real size (×1 or ×2): the page's DOM with its styles, fonts and pictures inlined into an
// SVG foreignObject, drawn on a canvas
const toData = blob => new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(blob); });
const fontCache = new Map();
async function inlineCSS() {
  let css = "";
  for (const sh of document.styleSheets) {
    let rules; try { rules = sh.cssRules; } catch (e) { continue; }
    for (const r of rules) {
      if (r.type === CSSRule.FONT_FACE_RULE && !/Roboto|Figtree|Inter/.test(r.style.getPropertyValue("font-family"))) continue;
      // font files resolved against their own stylesheet
      css += r.cssText.replace(/url\("?([^")]+\.woff2)"?\)/g, (m, u) => `url("${new URL(u, sh.href || location.href).href}")`) + "\n";
    }
  }
  const urls = [...new Set([...css.matchAll(/url\("?([^")]+\.woff2)"?\)/g)].map(m => m[1]))];
  for (const u of urls) {
    if (!fontCache.has(u)) fontCache.set(u, fetch(u).then(r => r.blob()).then(toData).catch(() => ""));
    const d = await fontCache.get(u);
    if (d) css = css.split(u).join(d);
  }
  return css;
}
async function snapshot(scale = 1) {
  const page = $("#page"), w = page.offsetWidth, h = page.offsetHeight, clone = page.cloneNode(true);
  for (const im of clone.querySelectorAll("img")) {
    try { im.setAttribute("src", await toData(await (await fetch(im.src)).blob())); } catch (e) { im.removeAttribute("src"); }
  }
  clone.style.margin = "0";
  const css = (await inlineCSS()).replace(/<\/style/gi, "");
  const html = `<div xmlns="http://www.w3.org/1999/xhtml" style="width:${w}px;height:${h}px"><style>${css}</style>${new XMLSerializer().serializeToString(clone)}</div>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><foreignObject width="100%" height="100%">${html}</foreignObject></svg>`;
  const pic = new Image();
  await new Promise((res, rej) => { pic.onload = res; pic.onerror = () => rej(new Error("render")); pic.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
  const cv = IMG.mk(w * scale, h * scale), x = cv.getContext("2d");
  x.scale(scale, scale); x.drawImage(pic, 0, 0);
  return cv;
}
$("#saveBtn").addEventListener("click", async () => {
  if (!covers.length || !HAL) return;
  await HAL?.session?.start("covertest");
  $("#saveBtn").disabled = true;
  try {
    const cv = await snapshot(C.scale), blob = await IMG.toBlob(cv);
    const name = `${(C.fields.title || "Cover") } - ${PLAT_NAME[C.platform]} ${t("ct.view." + C.view[C.platform])}.png`;
    const path = await HAL.saveOutput(blob, name);
    if (!path) { setStatus(t("common.saveCancelled"), "warn"); return; }
    const k = 240 / Math.max(cv.width, cv.height), th = IMG.mk(cv.width * k, cv.height * k);
    th.getContext("2d").drawImage(cv, 0, 0, th.width, th.height);
    HAL.session.recordExport("covertest", { path, name: String(path).split(/[\\/]/).pop(), kind: "image", thumb: th.toDataURL("image/png") });
    setStatus(t("common.savedAs", { name: String(path).split(/[\\/]/).pop() }), "ok");
  } catch (e) { setStatus(t("common.saveFailed", { error: e && e.message ? e.message : e }), "bad"); }
  finally { $("#saveBtn").disabled = !covers.length; }
});

/* ===== main ===== */
window.__ct = { C, covers, stats, render, snapshot, addCover, pick, feeds, get refs() { return refs; }, get profile() { return profile; } };
window.__halApp = {
  session: {
    capture: async () => { const { refs, ...view } = C; return { view, covers: await Promise.all(covers.map(async c => ({ source: await HAL.session.ref(c.source,c.name), crop: c.crop, name:c.name }))) }; },
    restore: async d => { Object.assign(C,d.view); for (const c of d.covers || []) { const f=await HAL.session.read(c.source); if(f) await addCover({blob:f,name:c.name,crop:c.crop,restored:true},covers.length); } C.active=Math.min(C.active,Math.max(0,covers.length-1)); renderLeftTabs(); syncFields(); syncScale(); renderViews(); setFar(C.far,true); render(); }
  },
  ready: (async () => {
    if (HAL) {
      await HAL.ready;
      let s = null;
      try { s = await HAL.invoke("state_get", { key: "covertest" }); } catch (e) {}
      const profiles = await HAL.invoke("state_get", { key: "profiles" }).catch(() => null);
      if (Array.isArray(profiles?.references)) C.refs = profiles.references.filter(x => typeof x === "string").slice(0, REFS);
      if (s && typeof s === "object") {
        // what the test is about comes back; the platform, view, zoom, distance and left tab start at their defaults
        // (DECISIONS: reopening)
        if (s.active != null) C.active = s.active;
        if (typeof s.youtubeArtistInTitle === "boolean") C.youtubeArtistInTitle = s.youtubeArtistInTitle;
        for (const k of ["dark", "pos", "fields", "query"]) if (s[k] && typeof s[k] === "object") Object.assign(C[k], s[k]);
        if (s.searchTest && typeof s.searchTest.query === "string") C.searchTest = { query: s.searchTest.query };
      }
      // views of earlier versions (Up next, Now playing) → the platform's first
      for (const p of Object.keys(VIEWS)) if (!VIEWS[p].includes(C.view[p])) C.view[p] = DEF.view[p];
      if (!VIEWS[C.platform]) C.platform = "youtube";
      if (!["home", "search", "channel"].includes(C.mobileView)) C.mobileView = "home";
      if (!["cover", "references"].includes(C.leftTab)) C.leftTab = "cover";
      await loadProfile();
      // the covers of last time, from Settings\Profile
      const saved = (s && Array.isArray(s.covers) ? s.covers : []).slice(0, MAX);
      for (let i = 0; i < saved.length; i++) {
        const b = await HAL.invoke("profile_file_get", { area: "profile", name: "cv-" + i + ".webp" }).catch(() => null);
        if (b && b.byteLength) await addCover({ blob: new Blob([b], { type: "image/webp" }), name: saved[i].name, crop: saved[i].crop, restored: true }, covers.length);
      }
      C.active = Math.min(C.active, Math.max(0, covers.length - 1));
      HAL.on("profile", () => loadProfile().then(render));
      HAL.on("settings", () => loadProfile().then(render));
    }
    renderLeftTabs(); syncFields(); syncScale(); renderViews(); renderRefs();
    setFar(C.far, true);
    // Hydrate persisted references before attempting their network refresh, independently of the own profile.
    loadRefs(false, true).then(() => loadRefs(false));
    const last = Math.max(0, ...Object.values(profile.platforms).map(p => p.fetched || 0));
    // The profile refresh can continue in parallel; only the surrounding feeds wait for its image work.
    const fresh = Object.keys(profile.platforms).length && Date.now() - last > 864e5 ? refreshProfile(true) : Promise.resolve();
    fresh.catch(() => {}).then(() => {
      loadFeed(C.platform, false).then(() => Promise.all(Object.keys(VIEWS).filter(p => p !== C.platform).map(p => loadFeed(p, false))));
    });
  })(),
  // "Send to…" (modules.js: accepts): a picture becomes a cover
  takeImage: it => addCover(it.path && !it.blob ? { path: it.path, name: it.name } : { blob: it.blob, name: it.name, path: it.path }),
  flush: () => adding.then(() => {}),
  busy: () => pending > 0
};
