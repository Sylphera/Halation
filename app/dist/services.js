"use strict";
// Services of the main window on window.__hal: Library data and packs, Crop, Cutout (engine and dialog), Frame Grab's extractor.

/* ===== libdata ===== */
// The Library's data (docs/LIBRARY_SPEC.md, docs/ARCHITECTURE.md → Shared services), shared by every page through
// window.__hal.library. One index (Settings\Library\index.json) of everything Halation organises, by reference: the
// assets of the collections (own folders in Documents\Halation\Library, folders of the PC linked where they are,
// read-only packs, virtual collections), presets and looks, and what the tools export or download. Each item keeps
// its file identity (fileKey), so a file renamed or moved on the same drive keeps its favourite, tags and uses;
// one that is gone is Missing until it is found again or located. Search, recents and favourites run on the index
// in memory. The order of the collections and the linked folders stay in the state "library" (library.rs reads
// the links). Thumbnails are cached in the workspace.
(() => {
"use strict";
const S = window.__shell;
const { invoke, t, emit, on, toast } = S;
const IMG = window.__img;

const VIDEO = /\.(webm|mov|mp4|mkv)$/i, AUDIO = /\.(mp3|wav|opus|m4a|flac|ogg)$/i, FONT = /\.(ttf|otf|woff2?)$/i;
const RECENT_BAND = 24;
let state = { order: [], linked: [] };
let loaded = null, list = [], stamps = "";
const saveState = () => invoke("state_set", { key: "library", value: state }).catch(e => console.warn(e));
let legacy = null;   // favourites and tags by path (0.9.0), read once for the migration
function load() {
  if (!loaded) loaded = invoke("state_get", { key: "library" }).then(v => {
    const o = v && typeof v === "object" ? v : {};
    state = { order: Array.isArray(o.order) ? o.order : [], linked: Array.isArray(o.linked) ? o.linked.filter(l => l && l.path) : [] };
    legacy = { favorites: Array.isArray(o.favorites) ? o.favorites : [], tags: o.tags && typeof o.tags === "object" ? o.tags : {} };
  }).catch(() => {});
  return loaded;
}

/* ---------- sections: the collections that are folders ---------- */
// [{key, name, kind: own | link | pack | fav | virtual, path, missing, count, readonly}] in the user's order; packs last
async function sections() {
  await load(); await ready();
  const r = await invoke("library_sections");
  const own = r.own.map(s => ({ ...s, key: "own:" + s.name, kind: "own" }));
  const links = r.linked.map(s => { const l = state.linked.find(x => x.path === s.path); return { ...s, name: (l && l.name) || s.name, key: "link:" + s.path, kind: "link", readonly: true }; });
  const packs = r.packs.map(s => ({ ...s, key: "pack:" + s.name, kind: "pack", readonly: true, name: t("lib.pack." + s.name.toLowerCase()) === "lib.pack." + s.name.toLowerCase() ? s.name : t("lib.pack." + s.name.toLowerCase()) }));
  const virt = idx.collections.filter(c => c.kind === "virtual").map(c => ({ key: c.id, kind: "virtual", name: c.name, count: idx.items.filter(i => i.collections.includes(c.id)).length }));
  const fav = { key: "fav", kind: "fav", name: t("lib.favorites"), count: idx.items.filter(i => i.fav).length, readonly: true };
  const all = [fav, ...own, ...links, ...virt], at = k => { const i = state.order.indexOf(k); return i < 0 ? (k === "fav" ? -1 : 1e6) : i; };
  all.sort((a, b) => at(a.key) - at(b.key));
  list = all.concat(packs);
  const next = JSON.stringify(list.filter(s => s.kind !== "fav" && s.kind !== "virtual").map(s => [s.key, s.count, s.stamp, s.missing]));
  const changed = stamps && next !== stamps;
  stamps = next;
  if (changed) sync();
  return list;
}
const byKey = k => list.find(s => s.key === k) || null;
async function reorder(keys) { state.order = keys.slice(); await saveState(); emit("library", { order: true }); }
async function createSection(name, kind = "own") {
  if (kind === "virtual") {
    await ready();
    const c = { id: "c_" + rid(), kind: "virtual", name: String(name).trim() };
    idx.collections.push(c); state.order.push(c.id); persist(); await saveState(); emit("library", {});
    return c.id;
  }
  const n = S.fileStem(String(name).trim());
  await invoke("library_section", { op: "create", name: n });
  await load(); state.order.push("own:" + n); await saveState(); emit("library", {});
  return "own:" + n;
}
async function renameSection(key, to) {
  const s = byKey(key); if (!s) return;
  if (s.kind === "virtual") { const c = idx.collections.find(x => x.id === key); if (c) c.name = String(to).trim(); persist(); emit("library", {}); return; }
  if (s.kind === "link") { const l = state.linked.find(x => x.path === s.path); if (l) l.name = String(to).trim(); await saveState(); emit("library", {}); return; }
  if (s.kind !== "own") return;
  const n = S.fileStem(String(to).trim()), from = s.path;
  const path = await invoke("library_section", { op: "rename", name: s.name, to: n });
  // the items follow their files to the new folder
  for (const i of idx.items) if (i.path.startsWith(from)) { i.path = path + i.path.slice(from.length); i.collections = i.collections.map(c => c === key ? "own:" + n : c); }
  reindex(); persist();
  state.order = state.order.map(k => k === key ? "own:" + n : k);
  await saveState(); emit("library", {});
}
async function removeSection(key) {
  const s = byKey(key); if (!s) return;
  if (s.kind === "own") {
    await invoke("library_section", { op: "delete", name: s.name });
    drop(idx.items.filter(i => i.collections.includes(key)).map(i => i.id));
  } else if (s.kind === "link") {
    state.linked = state.linked.filter(l => l.path !== s.path);
    // what only the link brought leaves the index (the files stay where they are)
    drop(idx.items.filter(i => i.collections.includes(key) && i.type === "asset" && !i.fav && !i.tags.length).map(i => i.id));
    for (const i of idx.items) i.collections = i.collections.filter(c => c !== key);
  } else if (s.kind === "virtual") {
    idx.collections = idx.collections.filter(c => c.id !== key);
    for (const i of idx.items) i.collections = i.collections.filter(c => c !== key);
  } else return;
  persist();
  state.order = state.order.filter(k => k !== key);
  await saveState(); emit("library", {});
}
// A folder of the PC as a collection: read where it is, followed, never copied
async function link() {
  const p = await invoke("library_pick_folder"); if (!p) return null;
  await load();
  if (!state.linked.some(l => l.path === p)) { state.linked.push({ path: p, name: "" }); state.order.push("link:" + p); await saveState(); }
  await sections().catch(() => {}); await sync();
  emit("library", {});
  return "link:" + p;
}

/* ---------- the index ---------- */
let idx = { version: 2, items: [], collections: [], order: [], hidden: [] };
const byId = new Map(), byPath = new Map(), byFileKey = new Map();
const rid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
function reindex() {
  byId.clear(); byPath.clear(); byFileKey.clear();
  for (const i of idx.items) { byId.set(i.id, i); byPath.set(i.path, i); if (i.fileKey) byFileKey.set(i.fileKey, i); }
  warmSoon();
}
let putTimer = 0, putting = Promise.resolve();
// written a moment after the last change, in one piece (library_index_put writes it atomically)
function persist(now = false) {
  clearTimeout(putTimer);
  const put = () => { putting = putting.then(() => invoke("library_index_put", { index: idx })).catch(e => console.warn("library index", e)); return putting; };
  if (now) return put();
  putTimer = setTimeout(put, 300);
  return putting;
}
let readyP = null;
function ready() {
  if (!readyP) readyP = (async () => {
    await load();
    const v = await invoke("library_index_get").catch(() => null);
    if (v && v.version === 2 && Array.isArray(v.items)) {
      idx = { version: 2, items: v.items.filter(i => i && i.id && i.path).map(norm), collections: Array.isArray(v.collections) ? v.collections : [], order: Array.isArray(v.order) ? v.order : [], hidden: Array.isArray(v.hidden) ? v.hidden : [] };
      reindex();
    } else await migrate();
    setTimeout(sync, 0);
  })();
  return readyP;
}
const norm = i => Object.assign(i, {
  name: i.name || i.path.split(/[\\/]/).pop(), meta: i.meta || {}, origin: i.origin || { tool: null, job: null, from: [] },
  usedIn: i.usedIn || {}, tags: Array.isArray(i.tags) ? i.tags : [], collections: Array.isArray(i.collections) ? i.collections : [],
  uses: i.uses || 0, addedAt: i.addedAt || Date.now(), usedAt: i.usedAt || 0, fav: !!i.fav, missing: !!i.missing
});
const kindOf = (name, type) => type === "look" ? "look" : VIDEO.test(name) ? "video" : AUDIO.test(name) ? "audio" : FONT.test(name) ? "font" : /\.json$/i.test(name) ? "preset" : "image";
function make(e, o) {
  const it = norm({ id: "i_" + rid(), type: o.type || "asset", kind: o.kind || kindOf(e.name, o.type), path: e.path, fileKey: e.fileKey || null, name: o.name || e.name,
    size: e.size || 0, mtime: e.mtime || 0, origin: { tool: null, job: null, from: [], ...(o.origin || {}) }, collections: o.collection ? [o.collection] : [] });
  idx.items.push(it); byId.set(it.id, it); byPath.set(it.path, it); if (it.fileKey) byFileKey.set(it.fileKey, it);
  return it;
}
function drop(ids) {
  const gone = new Set(ids); if (!gone.size) return;
  idx.items = idx.items.filter(i => !gone.has(i.id)); reindex();
}
// A file entry (library_scan) onto the index: the item at that path, the item with that identity (the file was
// renamed or moved), or a new one
function upsert(e, o = {}) {
  let it = byPath.get(e.path);
  if (!it && e.fileKey) {
    const k = byFileKey.get(e.fileKey);
    if (k && (k.missing || o.moved === undefined || o.moved(k))) { byPath.delete(k.path); k.path = e.path; k.name = e.name; byPath.set(k.path, k); it = k; }
  }
  if (!it) return make(e, o);
  it.size = e.size; it.mtime = e.mtime; it.missing = false;
  if (e.fileKey && e.fileKey !== it.fileKey) { if (it.fileKey) byFileKey.delete(it.fileKey); it.fileKey = e.fileKey; byFileKey.set(e.fileKey, it); }
  if (o.type && (it.type === "asset" || o.force)) it.type = o.type;
  if (o.kind) it.kind = o.kind;
  if (o.origin) it.origin = { ...it.origin, ...o.origin };
  if (o.collection && !it.collections.includes(o.collection)) it.collections.push(o.collection);
  return it;
}

/* ---------- migration from 0.9.0 (once) ---------- */
// favourites and tags by path → by item; the exports list → export items; Home's recents keep their copies
async function migrate() {
  idx = { version: 2, items: [], collections: [], order: [], hidden: [] }; reindex();
  const known = new Set();
  for (const p of legacy.favorites) known.add(p);
  for (const p of Object.keys(legacy.tags)) known.add(p);
  for (const e of S.st.exports || []) known.add(e.path);
  const paths = [...known];
  const ok = paths.length ? await invoke("files_exist", { paths }).catch(() => paths.map(() => true)) : [];
  for (let n = 0; n < paths.length; n++) {
    if (!ok[n]) continue;
    const e = (await invoke("library_scan", { path: paths[n] }).catch(() => []))[0]; if (!e) continue;
    const ex = (S.st.exports || []).find(x => x.path === paths[n]);
    const it = upsert(e, ex ? { type: "export", kind: ex.kind === "video" ? "video" : ex.kind === "audio" ? "audio" : "image" } : {});
    if (legacy.favorites.includes(paths[n])) it.fav = true;
    if (legacy.tags[paths[n]]) it.tags = legacy.tags[paths[n]].slice();
    if (ex) { it.addedAt = ex.at || it.addedAt; if (ex.thumb) putThumb(it, ex.thumb); }
  }
  await persist(true);
  if (S.st.exports && S.st.exports.length) { S.st.exports = []; invoke("state_set", { key: "exports", value: [] }).catch(() => {}); }
  // favourites and tags now live in the index; the state keeps the order and the links
  saveState();
}

/* ---------- keeping the index in step with the disk ---------- */
// Reads the collections' folders, Exports, Downloads and the presets; follows renamed and moved files by their
// identity, marks the gone ones Missing and looks for them. A background job of the jobs system (kind "index").
let syncing = null, syncAgain = false;
function sync() {
  if (syncing) { syncAgain = true; return syncing; }
  const body = async ctx => {
    await ready();
    const P = await invoke("paths");
    const secs = list.length ? list : await sections().catch(() => []);
    const roots = [];   // [{ path, depth, exts?, o }]
    for (const s of secs) if (s.path && !s.missing && s.kind !== "fav" && s.kind !== "virtual") roots.push({ path: s.path, depth: 0, o: { type: "asset", collection: s.key } });
    const sep = P.base.includes("\\") ? "\\" : "/", j = (...p) => p.join(sep);
    roots.push({ path: P.exports, depth: 3, o: { type: "export" } }, { path: P.downloads, depth: 3, o: { type: "download" } });
    roots.push({ path: j(P.presets, "Visualizer"), depth: 0, exts: ["json"], o: { type: "preset", kind: "preset-visualizer" } },
      { path: j(P.presets, "Grade"), depth: 0, exts: ["json"], o: { type: "look", kind: "look" } });
    const seen = new Set(), scanned = [];
    for (const r of roots) {
      if (ctx && ctx.signal && ctx.signal.aborted) return;
      const got = await invoke("library_scan", { path: r.path, depth: r.depth, exts: r.exts || null }).catch(() => []);
      scanned.push([r, got]);
      for (const e of got) seen.add(e.path);
      if (ctx && ctx.yield) await ctx.yield();
    }
    const changed = [];
    // an item whose path was not seen may have moved to a path that was
    const moved = k => !seen.has(k.path);
    // files taken out of the Library by hand stay out while they keep their path
    const hidden = new Set(idx.hidden);
    for (const [r, got] of scanned) for (const e of got) {
      if (hidden.has(e.path)) continue;
      const before = byPath.get(e.path), it = upsert(e, { ...r.o, moved });
      if (!before || before !== it) changed.push(it.id);
      // a section item belongs to its section only while it is in its folder
      if (r.o.collection) it.collections = it.collections.filter(c => !c.startsWith("own:") && !c.startsWith("link:") && !c.startsWith("pack:") || c === r.o.collection || isIn(it.path, secs.find(s => s.key === c)));
    }
    // the rest: inside a folder read now → gone; anywhere else (added by reference) → asked
    const under = p => roots.some(r => isIn(p, r));
    const other = idx.items.filter(i => !seen.has(i.path));
    const exist = other.length ? await invoke("files_exist", { paths: other.map(i => i.path) }).catch(() => other.map(() => true)) : [];
    const lost = [];
    other.forEach((i, n) => {
      const gone = under(i.path) ? !exist[n] : !exist[n];
      if (gone !== i.missing) { i.missing = gone; changed.push(i.id); }
      if (gone && i.fileKey) lost.push(i);
    });
    // Missing ones are looked for by identity in the folders the index knows
    if (lost.length) {
      const dirs = [...new Set(roots.map(r => r.path).concat(lost.map(i => i.path.replace(/[\\/][^\\/]*$/, ""))))];
      const found = await invoke("library_resolve", { dirs, want: lost.map(i => ({ key: i.fileKey, size: i.size })) }).catch(() => ({}));
      for (const i of lost) if (found[i.fileKey] && !byPath.has(found[i.fileKey])) { byPath.delete(i.path); i.path = found[i.fileKey]; i.name = i.path.split(/[\\/]/).pop(); i.missing = false; byPath.set(i.path, i); changed.push(i.id); }
    }
    // presets and looks deleted by hand leave the index (their file was the item)
    const presetGone = idx.items.filter(i => (i.type === "preset" || i.type === "look") && i.missing && !i.fav && !i.tags.length).map(i => i.id);
    if (presetGone.length) drop(presetGone);
    if (changed.length || presetGone.length) { reindex(); await persist(true); emit("library", { changed, disk: true }); }
  };
  const run = S.jobs ? S.jobs.submit({ tool: "library", kind: "index", title: t("lib.indexing"), lane: "light", priority: "background", host: "page", silent: true, notify: false, run: body }).done : body(null);
  syncing = run.catch(e => console.warn("library sync", e)).then(() => { syncing = null; if (syncAgain) { syncAgain = false; return sync(); } });
  return syncing;
}
function isIn(p, r) {
  if (!r || !r.path) return false;
  const base = r.path.replace(/[\\/]+$/, "");
  if (!p.startsWith(base) || !/[\\/]/.test(p.charAt(base.length))) return false;
  const rest = p.slice(base.length + 1).split(/[\\/]/).length - 1;
  return rest <= (r.depth || 0);
}

/* ---------- API: add, use, favourites, tags, remove, locate, collections ---------- */
// A file (path) or a result without a file (Blob, written once in its output folder: o.section, or "Edits")
async function add(src, o = {}) {
  await ready();
  let path = src;
  if (typeof src !== "string") {
    const name = o.name || src.name || "item.png";
    path = await invoke("library_write", new Uint8Array(await src.arrayBuffer()), { headers: { "x-section": encodeURIComponent(o.section || t("lib.edits")), "x-name": encodeURIComponent(name) } });
  }
  const e = (await invoke("library_scan", { path }).catch(() => []))[0] || { path, name: path.split(/[\\/]/).pop(), size: 0, mtime: Date.now(), fileKey: null };
  if (idx.hidden.includes(path)) idx.hidden = idx.hidden.filter(p => p !== path);
  const type = o.type || (byPath.get(path) || {}).type || "asset";
  const it = upsert(e, { ...o, type, force: !!o.type });
  if (o.origin) { it.origin = { tool: null, job: null, from: [], ...it.origin, ...o.origin }; if (!Array.isArray(it.origin.from)) it.origin.from = []; }
  it.addedAt = Date.now(); it.missing = false;
  if (o.thumb) putThumb(it, o.thumb);
  await persist(true);
  emit("library", { changed: [it.id] });
  return it;
}
// Opened by a tool: up in Recent and in "Used in"
async function touch(id, tool) {
  await ready();
  const it = byId.get(id) || byPath.get(id); if (!it) return;
  it.usedAt = Date.now(); it.uses++; if (tool) it.usedIn[tool] = (it.usedIn[tool] || 0) + 1;
  persist(); emit("library", { changed: [it.id], use: true });
}
const items_ = ids => (Array.isArray(ids) ? ids : [ids]).map(x => typeof x === "string" ? byId.get(x) || byPath.get(x) : x && (byId.get(x.id) || byPath.get(x.path))).filter(Boolean);
async function setFav(ids, on) {
  await ready();
  const its = items_(ids); for (const i of its) i.fav = !!on;
  persist(); emit("library", { changed: its.map(i => i.id), fav: true });
}
const cleanTags = tags => [...new Set(tags.map(x => String(x).trim().replace(/^#/, "").toLowerCase()).filter(Boolean))].slice(0, 12);
async function setTagsOf(ids, tags) {
  await ready();
  const its = items_(ids), v = cleanTags(tags); for (const i of its) i.tags = v.slice();
  persist(); emit("library", { changed: its.map(i => i.id), tags: true });
}
// Off the index; the file is deleted only for an item of an own collection when o.deleteFile (asked first)
async function remove(ids, o = {}) {
  await ready();
  const its = items_(ids);
  for (const i of its) if (o.deleteFile && i.collections.some(c => c.startsWith("own:"))) await invoke("library_remove", { path: i.path }).catch(e => console.warn(e));
  const kept = its.filter(i => !(o.deleteFile && i.collections.some(c => c.startsWith("own:")))).map(i => i.path);
  idx.hidden = [...new Set(idx.hidden.concat(kept))].slice(-5000);
  drop(its.map(i => i.id)); await persist(true);
  emit("library", { changed: its.map(i => i.id), removed: true });
}
// A Missing item pointed at its file again (a path, or the file dialog)
async function locate(id, path) {
  await ready();
  const it = items_(id)[0]; if (!it) return null;
  if (!path) { const got = await invoke("library_pick_files", { label: t("common.media") }).catch(() => []); path = got && got[0]; }
  if (!path) return null;
  const e = (await invoke("library_scan", { path }).catch(() => []))[0]; if (!e) return null;
  byPath.delete(it.path);
  Object.assign(it, { path: e.path, name: e.name, size: e.size, mtime: e.mtime, fileKey: e.fileKey, missing: false });
  reindex(); await persist(true);
  emit("library", { changed: [it.id] });
  return it;
}
// Into a collection: a virtual one keeps references; an own one moves what is inside Halation's folder and asks
// for the rest (o.how: "move" | "copy" | "reference", the default)
async function addTo(key, ids, o = {}) {
  await ready();
  const its = items_(ids);
  if (key === "fav") return setFav(its, true);
  const c = idx.collections.find(x => x.id === key);
  if (c) { for (const i of its) if (!i.collections.includes(key)) i.collections.push(key); persist(); emit("library", { changed: its.map(i => i.id) }); return; }
  const s = byKey(key); if (!s || s.kind !== "own") throw new Error(t("lib.readonly"));
  for (const i of its) {
    const how = o.how || "reference";
    if (how === "reference") { if (!i.collections.includes(key)) i.collections.push(key); continue; }
    const f = await file(i);
    const p = await invoke("library_write", new Uint8Array(await f.arrayBuffer()), { headers: { "x-section": encodeURIComponent(s.name), "x-name": encodeURIComponent(i.name) } });
    if (how === "move" && i.collections.some(k => k.startsWith("own:"))) await invoke("library_remove", { path: i.path }).catch(() => {});
    if (how === "move") { byPath.delete(i.path); i.path = p; byPath.set(p, i); i.collections = i.collections.filter(k => !k.startsWith("own:")).concat(key); }
    else { const e = (await invoke("library_scan", { path: p }).catch(() => []))[0]; if (e) upsert(e, { type: "asset", collection: key, origin: { from: [i.id] } }); }
  }
  reindex(); await persist(true); emit("library", { changed: its.map(i => i.id) });
}

/* ---------- query: search, filters, sort (LIBRARY_SPEC §5) ---------- */
const fold = s => String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const hay = new WeakMap();
// the search words of every item made ahead, while the window is idle, so a keystroke only compares
let warmTimer = 0;
const warm = () => { for (const i of idx.items) wordsOf(i); };
function warmSoon() { clearTimeout(warmTimer); warmTimer = setTimeout(() => (window.requestIdleCallback || (f => f()))(warm), 50); }
// the words an item is found by: name, tags, type and kind, origin tool, collections and what it was made from
function wordsOf(i) {
  let h = hay.get(i);
  if (h && h.v === i.name + i.tags.join() + i.collections.join()) return h;
  const cols = i.collections.map(k => { const s = byKey(k) || idx.collections.find(c => c.id === k); return s ? s.name : ""; });
  const from = (i.origin.from || []).map(id => (byId.get(id) || {}).name || "");
  const name = fold(i.name), rest = fold([i.type, i.kind, i.origin.tool ? t("tab." + i.origin.tool) : "", i.origin.tool, ...cols, ...from].join(" "));
  h = { v: i.name + i.tags.join() + i.collections.join(), name, nameWords: name.split(/[^a-z0-9]+/).filter(Boolean), tags: i.tags.map(fold), rest: rest.split(/[^a-z0-9]+/).filter(Boolean) };
  hay.set(i, h);
  return h;
}
const DAY = 864e5;
const TYPE_OF_TAB = { all: null, assets: ["asset"], presets: ["preset", "look"], exports: ["export", "download"] };
const recentAt = i => Math.max(i.addedAt || 0, i.usedAt || 0);
// { text, types, kinds, tools, collection, sort: newest | used | name | relevance, limit, offset, fav, missing }
function query(q = {}) {
  let words = fold(q.text).split(/\s+/).filter(Boolean);
  const types = q.types ? new Set(q.types) : null, kinds = q.kinds ? new Set(q.kinds) : null, tools = q.tools ? new Set(q.tools) : null;
  let fav = !!q.fav, missing = q.missing, since = 0;
  // typed filters: type:look tool:grade is:fav is:missing today week
  const typed = { types: [], tools: [] };
  words = words.filter(w => {
    let m;
    if ((m = /^type:(.+)$/.exec(w))) { typed.types.push(m[1].replace(/s$/, "")); return false; }
    if ((m = /^tool:(.+)$/.exec(w))) { typed.tools.push(m[1]); return false; }
    if (w === "is:fav" || w === "is:favourite" || w === "is:favorite") { fav = true; return false; }
    if (w === "is:missing") { missing = true; return false; }
    if (w === "today") { since = Date.now() - DAY; return false; }
    if (w === "week") { since = Date.now() - 7 * DAY; return false; }
    return true;
  });
  const col = q.collection && q.collection !== "fav" ? q.collection : null;
  if (q.collection === "fav") fav = true;
  const out = [];
  for (const i of idx.items) {
    if (types && !types.has(i.type)) continue;
    if (kinds && !kinds.has(i.kind) && !(kinds.has("preset") && i.type === "preset")) continue;
    if (tools && !tools.has(i.origin.tool)) continue;
    if (typed.types.length && !typed.types.some(x => i.type === x || i.kind === x || i.kind.startsWith(x))) continue;
    if (typed.tools.length && !typed.tools.some(x => fold(i.origin.tool || "").startsWith(x))) continue;
    if (fav && !i.fav) continue;
    if (missing !== undefined && missing !== null && !!i.missing !== !!missing) continue;
    if (since && recentAt(i) < since) continue;
    if (col && !i.collections.includes(col)) continue;
    let score = 0;
    if (words.length) {
      const h = wordsOf(i);
      let okAll = true;
      for (const w of words) {
        let s = 0;
        if (h.name === w || h.name.replace(/\.[a-z0-9]+$/, "") === w) s = 100;
        else if (h.name.startsWith(w)) s = 60 + 5 * w.length / h.name.length;
        else if (h.nameWords.some(x => x.startsWith(w))) s = 50;
        else if (h.tags.some(x => x.startsWith(w))) s = 40;
        else if (h.rest.some(x => x.startsWith(w))) s = 10;
        if (!s) { okAll = false; break; }
        score += s;
      }
      if (!okAll) continue;
    }
    out.push([i, score + (i.fav ? 5 : 0)]);
  }
  const sort = q.sort || (words.length ? "relevance" : "newest");
  const cmp = {
    relevance: (a, b) => b[1] - a[1] || recentAt(b[0]) - recentAt(a[0]),
    newest: (a, b) => (b[0].mtime || b[0].addedAt) - (a[0].mtime || a[0].addedAt),
    recent: (a, b) => recentAt(b[0]) - recentAt(a[0]),
    used: (a, b) => b[0].uses - a[0].uses || recentAt(b[0]) - recentAt(a[0]),
    name: (a, b) => a[0].name.localeCompare(b[0].name, undefined, { numeric: true, sensitivity: "base" })
  }[sort] || (() => 0);
  out.sort(cmp);
  const off = q.offset || 0, lim = q.limit || out.length;
  return { items: out.slice(off, off + lim).map(x => x[0]), total: out.length };
}
const get = id => byId.get(id) || byPath.get(id) || null;

/* ---------- compatibility: 0.9.0's per-section calls ---------- */
const decorate = i => Object.assign(i, { video: i.kind === "video", modified: i.mtime });
async function items(key) {
  await ready();
  const s = byKey(key) || (await sections(), byKey(key));
  if (!s) return [];
  if (s.missing) return [];
  return query({ collection: key, sort: "newest" }).items.filter(i => !i.missing).map(decorate);
}
async function file(item) {
  const buf = await invoke("library_read", { path: item.path }), ext = (item.name.split(".").pop() || "").toLowerCase();
  const f = new File([buf], item.name, { type: S.MIME[ext] || { svg: "image/svg+xml", webm: "video/webm", mov: "video/quicktime", mp4: "video/mp4", mkv: "video/x-matroska" }[ext] || "" });
  f.__halPath = item.path;
  return f;
}
async function toggleFav(item) { const it = items_(item)[0]; if (!it) return false; await setFav([it], !it.fav); return it.fav; }
async function setTags(item, tags) { return setTagsOf(Array.isArray(item) ? item : [item], tags); }
// Files without a path (a drop) copied into an own section; with a path, indexed where they are
async function addFiles(key, files) {
  const s = byKey(key);
  const out = [];
  for (const f of files) {
    if (f.__halPath) { out.push((await add(f.__halPath, { collection: s && s.kind === "virtual" ? key : null })).path); continue; }
    if (!s || s.kind !== "own") throw new Error(t("lib.readonly"));
    const p = await invoke("library_write", new Uint8Array(await f.arrayBuffer()), { headers: { "x-section": encodeURIComponent(s.name), "x-name": encodeURIComponent(f.name) } });
    out.push((await add(p, { type: "asset", collection: key })).path);
  }
  emit("library", {});
  return out;
}
async function removeItem(item) { await remove([item], { deleteFile: true }); }
// User-created cut-out/cropped versions use the global destination policy and retain their origin.
async function version(item, how, from) {
  const stem = S.fileStem(item.name.replace(/\.[^.]+$/, ""));
  let blob, name;
  if (how === "cutout") {
    if (!(await S.cutoutEnsure())) return null;
    toast(t("lib.cutting", { name: item.name }));
    blob = (await S.cutout(await file(item), { job: { tool: "library", title: item.name } })).rgba; name = `${stem} (cutout).png`;
  } else {
    const pic = await IMG.load(await file(item)), r = await S.crop({ image: pic, name: item.name, ratio: "free", from });
    if (!r) return null;
    const jpg = /\.jpe?g$/i.test(item.name);
    blob = await IMG.toBlob(IMG.render(pic, r.params), jpg ? "image/jpeg" : "image/png", 0.95); name = `${stem} (crop).${jpg ? "jpg" : "png"}`;
  }
  const path = await S.saveOutput(blob, name, "cutout");
  if (!path) return null;
  const it = await add(path, { type: "export", origin: { tool: how === "cutout" ? "removebg" : null, from: [items_(item)[0] ? items_(item)[0].id : null].filter(Boolean) } });
  return it.path;
}

/* ---------- thumbnails: made once, kept in the workspace ---------- */
const urls = new Map();
const hash = s => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return (h >>> 0).toString(36); };
const thumbKey = i => hash(JSON.stringify([i.path, i.mtime ?? i.modified, i.size]));
// a thumbnail the tool drew (a data: URL or a Blob) kept for the item
async function putThumb(i, src) {
  try {
    const blob = typeof src === "string" ? await (await fetch(src)).blob() : src;
    const key = thumbKey(i);
    urls.set(key, Promise.resolve(URL.createObjectURL(blob)));
    await invoke("library_thumb_put", new Uint8Array(await blob.arrayBuffer()), { headers: { "x-key": key } });
  } catch (e) { /* made from the file when asked */ }
}
async function frameOf(blob) {
  const v = document.createElement("video"), u = URL.createObjectURL(blob);
  v.muted = true; v.preload = "auto"; v.src = u;
  try {
    await new Promise((res, rej) => { v.onloadeddata = res; v.onerror = () => rej(new Error("video")); });
    v.currentTime = Math.min(0.1, (v.duration || 1) / 2);
    await new Promise(res => { v.onseeked = res; setTimeout(res, 1500); });
    const c = IMG.mk(v.videoWidth, v.videoHeight); c.getContext("2d").drawImage(v, 0, 0); return c;
  } finally { URL.revokeObjectURL(u); }
}
async function draw(item) {
  if (item.kind === "look" && S.lookThumb) { const u = await S.lookThumb(item); if (!u) throw new Error("no thumbnail"); return (await fetch(u)).blob(); }
  if (item.kind !== "image" && item.kind !== "video") throw new Error("no thumbnail");
  const f = await file(item), pic = item.kind === "video" ? await frameOf(f) : await IMG.load(f);
  const [w, h] = IMG.size(pic), k = Math.min(1, 320 / Math.max(w, h)), c = IMG.mk(Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k)));
  c.getContext("2d").drawImage(pic, 0, 0, c.width, c.height);
  if (pic.__url) URL.revokeObjectURL(pic.__url);
  return IMG.toBlob(c, "image/webp", 0.85);
}
async function thumb(item) {
  if (item.missing) throw new Error("missing");
  const key = thumbKey(item);
  if (urls.has(key)) return urls.get(key);
  const p = (async () => {
    const got = await invoke("library_thumb_get", { key }).catch(() => null);
    let blob = got && got.byteLength ? new Blob([got], { type: "image/webp" }) : null;
    if (!blob) {
      blob = await draw(item);
      invoke("library_thumb_put", new Uint8Array(await blob.arrayBuffer()), { headers: { "x-key": key } }).catch(() => {});
    }
    return URL.createObjectURL(blob);
  })();
  urls.set(key, p); p.catch(() => urls.delete(key));
  return p;
}

/* ---------- watching the folders ---------- */
let watchers = 0;
async function poll() {
  if (!watchers || document.hidden) return;
  await sections().catch(() => {});
}
setInterval(poll, 2500);
const watch = fn => { watchers++; on("library", fn); };

// the outputs of a finished job (jobs.js onDone): indexed at once with the tool and the job that made them
S.libraryAddOutputs = j => {
  for (const o of j.outputs || []) {
    if (!o || !o.path) continue;
    const type = /[\\/]Downloads[\\/]/i.test(o.path) ? "download" : "export";
    add(o.path, { type, kind: o.kind && ["image", "video", "audio"].includes(o.kind) ? o.kind : undefined, origin: { tool: j.tool, job: j.id, from: o.from || [] } }).catch(e => console.warn("library add", e));
  }
};

// for tests/library.js: items added and taken out in memory (the search timing on 20 000 items)
const __test = { inject(list) { for (const i of list) idx.items.push(norm(i)); reindex(); warm(); return idx.items.length; }, eject(list) { const ids = new Set(list.map(i => i.id)); idx.items = idx.items.filter(i => !ids.has(i.id)); reindex(); } };

S.library = { __test, ready, query, get, add, touch, setFav, setTags, setTagsOf, remove, locate, addTo, sync, collections: sections, createCollection: createSection,
  renameCollection: renameSection, removeCollection: removeSection, linkFolder: link, RECENT_BAND, TYPE_OF_TAB, recentAt, kindOf,
  sections, reorder, createSection, renameSection, removeSection, link, items, file, toggleFav, addFiles, removeItem, version, thumb, putThumb, watch, byKey,
  poll };
})();

/* ===== library-packs ===== */
// Optional Library packs (docs/ARCHITECTURE.md → Shared services): grain, paper, light leaks, shapes and frames, installed and
// removed in Settings → Modules. They are Halation's own pictures, drawn here when installed (nothing is
// downloaded, no licence applies) into Library\Packs\<pack>, and show in every Library panel as read-only
// sections. Part of the main window.
(() => {
"use strict";
const S = window.__shell;
const { $, esc, t, M, invoke, emit, toast } = S;
const IMG = window.__img;

// Deterministic noise, so a pack is the same on every PC
const rng = seed => () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
const canvas = (w, h) => { const c = IMG.mk(w, h); return [c, c.getContext("2d")]; };
function noise(w, h, { base, amount, size = 1, colour = false, seed = 1 }) {
  const [c, x] = canvas(w, h), sw = Math.ceil(w / size), sh = Math.ceil(h / size), [n, y] = canvas(sw, sh), img = y.createImageData(sw, sh), p = img.data, r = rng(seed);
  for (let i = 0; i < p.length; i += 4) {
    const v = (r() - 0.5) * amount;
    p[i] = base[0] + v * (colour ? r() * 2 : 1); p[i + 1] = base[1] + v * (colour ? r() * 2 : 1); p[i + 2] = base[2] + v * (colour ? r() * 2 : 1); p[i + 3] = 255;
  }
  y.putImageData(img, 0, 0);
  x.imageSmoothingEnabled = size > 1; x.drawImage(n, 0, 0, w, h);
  return c;
}
function blotches(x, w, h, n, colour, alpha, seed) {
  const r = rng(seed);
  for (let i = 0; i < n; i++) {
    const cx = r() * w, cy = r() * h, rad = (0.1 + r() * 0.35) * Math.max(w, h), g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, `rgba(${colour},${alpha * (0.4 + r() * 0.6)})`); g.addColorStop(1, `rgba(${colour},0)`);
    x.fillStyle = g; x.fillRect(0, 0, w, h);
  }
}
function paper(tint, seed) {
  const c = noise(1920, 1080, { base: tint, amount: 22, seed }), x = c.getContext("2d"), r = rng(seed + 7);
  blotches(x, 1920, 1080, 14, "0,0,0", 0.07, seed);
  x.globalAlpha = 0.08; x.strokeStyle = "#000"; x.lineWidth = 1;
  for (let i = 0; i < 900; i++) { const a = r() * Math.PI, l = 6 + r() * 30, px = r() * 1920, py = r() * 1080; x.beginPath(); x.moveTo(px, py); x.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); x.stroke(); }
  return c;
}
function leak(colours, seed) {
  const [c, x] = canvas(1920, 1080), r = rng(seed);
  x.fillStyle = "#000"; x.fillRect(0, 0, 1920, 1080);
  x.globalCompositeOperation = "screen"; x.filter = "blur(60px)";
  for (const col of colours) {
    const cx = r() < 0.5 ? r() * 500 : 1920 - r() * 500, cy = r() * 1080, rad = 300 + r() * 500, g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, col); g.addColorStop(1, "rgba(0,0,0,0)"); x.fillStyle = g; x.fillRect(0, 0, 1920, 1080);
  }
  return c;
}
function shape(draw) { const [c, x] = canvas(1024, 1024); x.fillStyle = "#fff"; x.beginPath(); draw(x); x.fill(); return c; }
const star = (x, n, r0, r1) => { for (let i = 0; i < n * 2; i++) { const a = -Math.PI / 2 + i * Math.PI / n, r = i % 2 ? r1 : r0; x.lineTo(512 + Math.cos(a) * r, 512 + Math.sin(a) * r); } x.closePath(); };
function frame(draw) { const [c, x] = canvas(1920, 1080); draw(x); return c; }

const PACKS = [
  { id: "Grain", files: [
    ["Fine grain.jpg", () => noise(1920, 1080, { base: [128, 128, 128], amount: 70, seed: 11 })],
    ["Coarse grain.jpg", () => noise(1920, 1080, { base: [128, 128, 128], amount: 90, size: 2.5, seed: 12 })],
    ["Colour grain.jpg", () => noise(1920, 1080, { base: [128, 128, 128], amount: 70, colour: true, seed: 13 })]] },
  { id: "Paper", files: [
    ["Warm paper.jpg", () => paper([232, 222, 200], 21)], ["Grey card.jpg", () => paper([150, 150, 148], 22)], ["Black card.jpg", () => paper([30, 28, 28], 23)]] },
  { id: "Leaks", files: [
    ["Amber leak.jpg", () => leak(["rgba(255,140,40,.9)", "rgba(255,60,30,.7)"], 31)], ["Rose leak.jpg", () => leak(["rgba(255,90,140,.85)", "rgba(255,190,120,.6)"], 32)],
    ["Blue leak.jpg", () => leak(["rgba(80,140,255,.8)", "rgba(160,110,255,.6)"], 33)], ["Double leak.jpg", () => leak(["rgba(255,120,40,.8)", "rgba(255,210,120,.6)", "rgba(255,70,90,.6)"], 34)]] },
  { id: "Shapes", files: [
    ["Circle.png", () => shape(x => x.arc(512, 512, 480, 0, Math.PI * 2))], ["Star.png", () => shape(x => star(x, 5, 490, 200))],
    ["Burst.png", () => shape(x => star(x, 16, 500, 380))], ["Sparkle.png", () => shape(x => star(x, 4, 500, 90))],
    ["Heart.png", () => shape(x => { x.moveTo(512, 900); x.bezierCurveTo(-120, 480, 250, 40, 512, 300); x.bezierCurveTo(774, 40, 1144, 480, 512, 900); })],
    ["Arrow.png", () => shape(x => { x.moveTo(60, 400); x.lineTo(620, 400); x.lineTo(620, 200); x.lineTo(980, 512); x.lineTo(620, 824); x.lineTo(620, 624); x.lineTo(60, 624); x.closePath(); })]] },
  { id: "Frames", files: [
    ["Polaroid.png", () => frame(x => { x.fillStyle = "#f4f1ea"; x.fillRect(0, 0, 1920, 1080); x.clearRect(120, 90, 1680, 780); })],
    ["Film strip.png", () => frame(x => { x.fillStyle = "#0c0b0b"; x.fillRect(0, 0, 1920, 1080); x.clearRect(0, 110, 1920, 860); x.fillStyle = "#e8e2d6"; for (let i = 20; i < 1920; i += 64) { x.fillRect(i, 36, 34, 40); x.fillRect(i, 1004, 34, 40); } })],
    ["Rounded border.png", () => frame(x => { x.fillStyle = "#fff"; x.fillRect(0, 0, 1920, 1080); x.globalCompositeOperation = "destination-out"; x.beginPath(); x.roundRect(48, 48, 1824, 984, 56); x.fill(); })]] }
];

let installed = [], working = false;
async function refresh() {
  const secs = await invoke("library_sections").catch(() => null);
  installed = secs ? secs.packs.map(p => p.name) : [];
  render();
}
function render() {
  const el = $("#packs"); if (!el) return;
  M.list(el, () => {
    el.innerHTML = PACKS.map(p => {
      const on = installed.includes(p.id), name = t("lib.pack." + p.id.toLowerCase());
      return `<div class="row" data-key="${p.id}"><b>${esc(name)}<small>${esc(t("set.pack.n", { n: p.files.length }))}</small></b><code></code><span class="size">${esc(on ? t("set.pack.on") : "")}</span>`
        + (on ? `<button class="btn sm warn" data-prm="${p.id}"${working ? " disabled" : ""}>${esc(t("common.remove"))}</button>` : `<button class="btn sm" data-pin="${p.id}"${working ? " disabled" : ""}>${esc(t("set.comp.install"))}</button>`) + `</div>`;
    }).join("");
  }, { sel: ":scope > .row" });
}
async function install(id) {
  const p = PACKS.find(x => x.id === id); if (!p || working) return;
  working = true; render();
  try {
    for (const [name, make] of p.files) {
      const blob = await IMG.toBlob(make(), /\.jpg$/.test(name) ? "image/jpeg" : "image/png", 0.9);
      await invoke("library_write", new Uint8Array(await blob.arrayBuffer()), { headers: { "x-section": encodeURIComponent("Packs/" + id), "x-name": encodeURIComponent(name) } });
    }
    toast(t("set.pack.installed", { name: t("lib.pack." + id.toLowerCase()) }));
  } catch (e) { toast(String(e && e.message || e)); }
  working = false; emit("library", {}); await refresh();
}
async function remove(id) {
  if (working) return;
  await invoke("library_pack_remove", { id }).catch(e => toast(String(e && e.message || e)));
  emit("library", {}); await refresh();
}
document.addEventListener("click", e => {
  const i = e.target.closest("#packs [data-pin]"), r = e.target.closest("#packs [data-prm]");
  if (i) install(i.dataset.pin); else if (r) remove(r.dataset.prm);
});

Object.assign(S, { renderPacks: refresh });
})();

/* ===== crop ===== */
// Crop: the one crop dialog of the app (docs/ARCHITECTURE.md → Shared services), used by every tool through window.__hal.
//   crop({ image, name, params, ratio, lock, mask, from }) → { params, w, h } | null (cancelled)
//     canvas: { format: { id, label, ratio }, formats: [...] } adds the choice of §2.2 at the top: crop to the
//     canvas's format, or change the canvas to another format or to the picture's own ratio ({ canvas: id | "image" })
//   fitCrop(image, ratio, o) → the whole picture when it already has the ratio, else the dialog with the ratio locked
// The picture moves and zooms under a fixed frame; free ratios have handles on the frame. Nothing is cut here:
// the result is the parameters (imgops.js), which the tool applies to the original and can open again.
// Part of the main window (shell.js holds the shared state; this file adds its functions to window.__shell).
(() => {
"use strict";
const S = window.__shell;
const { $, t, M, esc } = S;
const IMG = window.__img;
const d = M.dialog($("#cropDlg")), stage = $("#cropStage"), img = $("#cropImg"), frame = $("#cropFrame");
const RATIO_KEYS = ["free", "orig", "16:9", "9:16", "1:1", "4:5", "3:1"];
const MAXZ = 8;
// st: the picture (iw, ih), the crop (p), how it is shown (s: stage px per image px; fc: frame centre in the stage)
let st = null, resolve = null;

const rot = (a, x, y) => { const r = a * Math.PI / 180, c = Math.cos(r), s = Math.sin(r); return [x * c - y * s, x * s + y * c]; };
const px = () => ({ W: st.p.w * st.iw, H: st.p.h * st.ih, C: [st.p.cx * st.iw, st.p.cy * st.ih] });
const ratioNow = () => { const { W, H } = px(); return W / H; };
function zoomOf() { const { W } = px(); return IMG.maxWidth(st.iw, st.ih, ratioNow(), st.p.a) / W; }
// Puts the crop at zoom z (1: the largest crop at this angle), keeping its centre
function setZoom(z) {
  z = Math.min(MAXZ, Math.max(1, z));
  const r = ratioNow(), W = IMG.maxWidth(st.iw, st.ih, r, st.p.a) / z, H = W / r;
  move({ ...st.p, w: W / st.iw, h: H / st.ih }, "picture");
}
// New crop parameters, kept inside the picture. mode "picture": the frame keeps its box and the picture moves
// or scales under it; "frame": the picture stays and the frame changes (handles); "fit": the frame is re-fitted.
function move(p, mode) {
  const before = px(), fw = before.W * st.s, q = IMG.clampCrop(p, st.iw, st.ih);
  st.p = q;
  const after = px();
  if (mode === "frame") {
    // the frame follows the crop's centre: fc' = fc + s·R(a)(C' − C)
    const [dx, dy] = rot(q.a, after.C[0] - before.C[0], after.C[1] - before.C[1]);
    st.fc = [st.fc[0] + dx * st.s, st.fc[1] + dy * st.s];
  } else if (mode === "picture") st.s = fw / after.W;
  else fit();
  draw();
}
// Frame as large as the stage allows, centred
function fit() {
  const r = stage.getBoundingClientRect(), m = 36, { W, H } = px();
  st.s = Math.min((r.width - 2 * m) / W, (r.height - 2 * m) / H);
  st.fc = [r.width / 2, r.height / 2];
}
function transforms() {
  const { W, H, C } = px();
  return {
    img: `translate(${st.fc[0]}px,${st.fc[1]}px) rotate(${st.p.a}deg) scale(${st.s}) translate(${-C[0]}px,${-C[1]}px)`,
    frame: [st.fc[0] - W * st.s / 2, st.fc[1] - H * st.s / 2, W * st.s, H * st.s]
  };
}
function draw() {
  const tr = transforms(), [x, y, w, h] = tr.frame;
  img.style.transform = tr.img;
  Object.assign(frame.style, { width: w + "px", height: h + "px", transform: `translate(${x}px,${y}px)` });
  const z = zoomOf(), zi = $("#cropZoom"), ri = $("#cropRot");
  zi.value = String(z); zi.style.setProperty("--p", ((z - 1) / (MAXZ - 1) * 100) + "%"); $("#oCropZoom").textContent = "×" + z.toFixed(2);
  ri.value = String(st.p.a); ri.style.setProperty("--p", ((st.p.a + 45) / 90 * 100) + "%"); $("#oCropRot").textContent = st.p.a.toFixed(1) + "°";
  const [ow, oh] = IMG.outSize(st.p, st.iw, st.ih);
  $("#cropOut").textContent = t("crop.out", { w: ow, h: oh });
  $("#cropOut").classList.toggle("bad", Math.min(ow, oh) < 256);
}
// Re-fit with the frame and the picture gliding to their new place (frame: scale from its old box)
function refit() {
  const old = transforms();
  fit(); draw();
  const now = transforms(), [ox, oy, ow, oh] = old.frame, [nx, ny, nw, nh] = now.frame;
  M.animate(img, [{ transform: old.img }, { transform: now.img }], { dur: "spring", channel: "move" });
  if (Math.abs(nw - ow) > 0.5 || Math.abs(nx - ox) > 0.5 || Math.abs(ny - oy) > 0.5)
    M.animate(frame, [{ transform: `translate(${ox}px,${oy}px) scale(${ow / nw},${oh / nh})`, transformOrigin: "0 0" }, { transform: `translate(${nx}px,${ny}px)`, transformOrigin: "0 0" }], { dur: "spring", channel: "move" });
}

/* ---------- ratio chips ---------- */
function renderRatios() {
  const locked = st.lock;
  $("#cropRatioRow").hidden = locked;
  $("#cropNeed").hidden = !locked || !!st.canvas;   // the choice of canvas already says what the frame is
  if (locked) $("#cropNeed").textContent = t("crop.need", { ratio: ratioLabel(st.ratio) });
  $("#cropRatios").innerHTML = RATIO_KEYS.map(k => `<button class="chip" data-ratio="${k}" aria-pressed="${k === st.ratio}">${esc(ratioLabel(k))}</button>`).join("");
  frame.classList.toggle("free", st.ratio === "free" && !locked);
}
// a number (a template's slot) is named by the ratio it is, when it is a common one
const COMMON = { "1:1": 1, "4:3": 4 / 3, "3:4": 3 / 4, "16:9": 16 / 9, "9:16": 9 / 16, "4:5": 4 / 5, "3:1": 3 };
const ratioLabel = k => k === "free" ? t("crop.free") : k === "orig" ? t("crop.original") : typeof k === "number" ? Object.keys(COMMON).find(n => Math.abs(COMMON[n] / k - 1) < 0.005) || k.toFixed(2) + ":1" : k;
function setRatio(k) {
  st.ratio = k; st.p = { ...st.p, ratio: k };
  const r = IMG.ratioValue(k, st.iw, st.ih);
  if (r) {
    // same area, new shape
    const { W, H } = px(), area = W * H, w = Math.sqrt(area * r), h = w / r;
    move({ ...st.p, w: w / st.iw, h: h / st.ih }, "fit");
  }
  renderRatios(); refit();
}
$("#cropRatios").addEventListener("click", e => { const b = e.target.closest("[data-ratio]"); if (b && st) setRatio(b.dataset.ratio); });

/* ---------- "Crop to {format}" or "Change canvas to…" (the first picture of a project, a background) ---------- */
function renderCanvas() {
  const c = st.canvas;
  $("#cropCanvas").hidden = !c;
  if (!c) return;
  $("#cropModeCrop").textContent = t("crop.cropTo", { format: c.format.label });
  for (const b of $("#cropMode").children) b.setAttribute("aria-checked", String(b.dataset.mode === c.mode));
  M.reveal($("#cropFormats"), c.mode === "canvas");
  $("#cropFormats").innerHTML = c.formats.filter(f => f.id !== c.format.id).map(f => `<button class="chip" data-fmt="${esc(f.id)}" aria-pressed="${f.id === c.pick}">${esc(f.label)}</button>`).join("")
    + `<button class="chip" data-fmt="image" aria-pressed="${c.pick === "image"}">${esc(t("crop.imageRatio"))}</button>`;
}
function pickCanvas(mode, id) {
  const c = st.canvas; c.mode = mode;
  if (mode === "crop") c.pick = c.format.id; else if (id) c.pick = id; else if (c.pick === c.format.id) c.pick = "image";
  const f = c.formats.find(x => x.id === c.pick);
  st.lock = true;
  if (c.pick === "image") { st.ratio = "orig"; st.p = { ...IMG.full(), ratio: "orig" }; } else setRatio(f.ratio);
  renderCanvas(); renderRatios(); refit();
}
$("#cropMode").addEventListener("click", e => { const b = e.target.closest("[data-mode]"); if (b && st && st.canvas) pickCanvas(b.dataset.mode); });
$("#cropFormats").addEventListener("click", e => { const b = e.target.closest("[data-fmt]"); if (b && st && st.canvas) pickCanvas("canvas", b.dataset.fmt); });

/* ---------- sliders and keys ---------- */
$("#cropZoom").addEventListener("input", e => { if (st) setZoom(+e.target.value); });
$("#cropRot").addEventListener("input", e => {
  if (!st) return;
  const z = zoomOf(); st.p = { ...st.p, a: +e.target.value };
  setZoom(z);
});
$("#cropGrid").addEventListener("change", e => frame.classList.toggle("grid", e.target.checked));
$("#cropReset").addEventListener("click", () => { if (!st) return; st.p = IMG.centered(st.iw, st.ih, st.ratio === "free" ? "orig" : st.ratio, st.focus); if (st.ratio === "free") st.p.ratio = "free"; refit(); });
d.addEventListener("keydown", e => {
  if (!st || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== "range") return;
  const k = e.shiftKey ? 10 : 1;
  const pan = { ArrowLeft: [k, 0], ArrowRight: [-k, 0], ArrowUp: [0, k], ArrowDown: [0, -k] }[e.key];
  if (pan && e.target.type !== "range") { e.preventDefault(); panBy(pan[0], pan[1]); }
  else if (e.key === "+" || e.key === "=") { e.preventDefault(); setZoom(zoomOf() * 1.1); }
  else if (e.key === "-") { e.preventDefault(); setZoom(zoomOf() / 1.1); }
});

/* ---------- dragging: pan, wheel zoom, handles ---------- */
// The picture moves by (dx, dy) screen pixels: the crop's centre moves the other way, in the picture's axes
function panBy(dx, dy) {
  const { C } = px(), [sx, sy] = rot(-st.p.a, dx / st.s, dy / st.s);
  move({ ...st.p, cx: (C[0] - sx) / st.iw, cy: (C[1] - sy) / st.ih }, "picture");
}
stage.addEventListener("wheel", e => {
  if (!st) return;
  e.preventDefault();
  const r = stage.getBoundingClientRect(), q = [e.clientX - r.left - st.fc[0], e.clientY - r.top - st.fc[1]];
  const { C } = px(), k = Math.exp(-e.deltaY * 0.0015), z0 = zoomOf(), z1 = Math.min(MAXZ, Math.max(1, z0 * k));
  if (z1 === z0) return;
  // the point under the cursor stays under it: P = C + R(−a)·q/s, C' = P − R(−a)·q/s' with s' = s·z1/z0
  const [ax, ay] = rot(-st.p.a, q[0] / st.s, q[1] / st.s), P = [C[0] + ax, C[1] + ay], kk = z1 / z0;
  const r0 = ratioNow(), W = IMG.maxWidth(st.iw, st.ih, r0, st.p.a) / z1, H = W / r0;
  move({ ...st.p, w: W / st.iw, h: H / st.ih, cx: (P[0] - ax / kk) / st.iw, cy: (P[1] - ay / kk) / st.ih }, "picture");
}, { passive: false });
stage.addEventListener("pointerdown", e => {
  if (!st || e.button !== 0) return;
  const h = e.target.closest("[data-h]"), x0 = e.clientX, y0 = e.clientY, p0 = { ...st.p }, fc0 = st.fc.slice();
  e.preventDefault(); stage.setPointerCapture(e.pointerId); stage.classList.add(h ? "sizing" : "panning");
  const moveFn = ev => {
    const dx = ev.clientX - x0, dy = ev.clientY - y0;
    if (!h) { st.p = p0; st.fc = fc0.slice(); panBy(dx, dy); return; }
    // a handle: that edge follows the pointer (in the frame's axes), the opposite one stays
    const side = h.dataset.h, ex = /e/.test(side) ? 1 : /w/.test(side) ? -1 : 0, ey = /s/.test(side) ? 1 : /n/.test(side) ? -1 : 0;
    const W0 = p0.w * st.iw, H0 = p0.h * st.ih, W = Math.max(16, W0 + ex * dx / st.s), H = Math.max(16, H0 + ey * dy / st.s);
    const [ox, oy] = rot(-p0.a, ex * (W - W0) / 2, ey * (H - H0) / 2);
    st.p = p0; st.fc = fc0.slice();
    move({ ...p0, w: W / st.iw, h: H / st.ih, cx: (p0.cx * st.iw + ox) / st.iw, cy: (p0.cy * st.ih + oy) / st.ih }, "frame");
  };
  const up = () => {
    stage.classList.remove("sizing", "panning");
    stage.removeEventListener("pointermove", moveFn); stage.removeEventListener("pointerup", up); stage.removeEventListener("pointercancel", up);
    if (h) refit();
  };
  stage.addEventListener("pointermove", moveFn); stage.addEventListener("pointerup", up); stage.addEventListener("pointercancel", up);
});
stage.addEventListener("dblclick", e => { if (st && !e.target.closest("[data-h]")) { setZoom(1); refit(); } });
new ResizeObserver(() => { if (st && d.open) { fit(); draw(); } }).observe(stage);

/* ---------- opening and closing ---------- */
async function crop(o = {}) {
  if (resolve) { resolve(null); resolve = null; }
  const pic = IMG.isBlob(o.image) ? await IMG.load(o.image) : o.image;
  const [iw, ih] = IMG.size(pic);
  const lock = !!o.lock && !!IMG.ratioValue(o.ratio, iw, ih);
  const ratio = lock ? o.ratio : (o.params && o.params.ratio) || o.ratio || "free";
  const focus = o.mask ? IMG.focusOf(o.mask) : null;
  let p = o.params && IMG.validCrop(o.params) ? IMG.clampCrop({ ...o.params, ratio }, iw, ih) : IMG.centered(iw, ih, ratio === "free" ? "orig" : ratio, focus);
  if (lock && !IMG.fits(...IMG.outSize(p, iw, ih), IMG.ratioValue(ratio, iw, ih))) p = IMG.centered(iw, ih, ratio, focus);
  p.ratio = ratio;
  st = { iw, ih, p, ratio, lock, focus, s: 1, fc: [0, 0], touched: false, canvas: o.canvas ? { ...o.canvas, mode: "crop", pick: o.canvas.format.id } : null };
  img.src = pic.src || (pic.toDataURL ? pic.toDataURL() : "");
  img.style.width = iw + "px"; img.style.height = ih + "px";
  $("#cropTitle").textContent = o.title || t("crop.title");
  $("#cropInfo").textContent = [o.name, `${iw}×${ih}`].filter(Boolean).join(" · ");
  frame.classList.toggle("grid", $("#cropGrid").checked);
  renderRatios(); renderCanvas();
  d.returnValue = "";
  d.showFrom(o.from || document.activeElement);
  fit(); draw();
  $("#cropApply").focus();
  if (!o.params && !o.mask && o.autoFocus !== false && S.cutoutFocus) focusLater(o.image, pic);
  return new Promise(res => { resolve = res; });
}
// With Cutout installed the frame moves to the subject once it is found (unless the user has moved it already)
async function focusLater(blob, pic) {
  const mine = st, before = { ...st.p };
  const f = await S.cutoutFocus(IMG.isBlob(blob) ? blob : null, pic).catch(() => null);
  if (!f || st !== mine || !d.open || !IMG.sameCrop(before, st.p)) return;
  st.focus = f;
  st.p = IMG.centered(st.iw, st.ih, st.ratio === "free" ? "orig" : st.ratio, f); st.p.ratio = st.ratio;
  refit();
}
$("#cropApply").addEventListener("click", () => d.close("ok"));
$("#cropCancel").addEventListener("click", () => d.close(""));
$("#cropClose").addEventListener("click", () => d.close(""));
d.addEventListener("close", () => {
  const r = resolve; resolve = null;
  if (!r) return;
  if (d.returnValue !== "ok" || !st) { r(null); return; }
  const [w, h] = IMG.outSize(st.p, st.iw, st.ih);
  r({ params: { ...st.p }, w, h, canvas: st.canvas && st.canvas.mode === "canvas" ? st.canvas.pick : null });
});
// A place that needs a ratio: the whole picture when it already has it, else the dialog (cancel → null)
async function fitCrop(image, ratio, o = {}) {
  const pic = IMG.isBlob(image) ? await IMG.load(image) : image, [iw, ih] = IMG.size(pic), r = IMG.ratioValue(ratio, iw, ih);
  if (!r || IMG.fits(iw, ih, r)) return { params: { ...IMG.full(), ratio }, w: iw, h: ih, img: pic };
  const res = await crop({ ...o, image: pic, ratio, lock: true });
  return res && { ...res, img: pic };
}

Object.assign(S, { crop, fitCrop, cropOpen: () => d.open });
})();

/* ===== cutout ===== */
// Cutout: removing the background, one service for the whole app (docs/ARCHITECTURE.md → Shared services).
//   cutout(image) → { rgba, mask, hash, w, h }: the picture with transparency and its mask (grey PNG, white =
//     subject), both Blobs at the picture's size; the model's answer is cached by the picture's hash
//   cutoutReady() → true when the component is on this PC; cutoutEnsure(from) offers to download it
//   cutoutFocus(blob, img) → the subject's centre ({x, y} as fractions) when the component is there, else null
//   cutoutBatch(files) → the pictures go to Upscale's queue as cut-out jobs
//   saveCutout(rgba, { name }) → global destination, recorded as an export
// The model is SAM 2.1 Base+ (promptable segmentation), in cutout-worker.js: a picture is encoded once, then each
// set of prompts (points on the subject or the background, the last answer) is decoded against it in a few ms.
//   samEmbed(image, { job }) → a handle { w, h, hash, img } of the encoded picture
//   samDecode(handle, points [{ x, y, label }] (fractions of the picture, label 1 subject / 0 background), { prev,
//     hint }) → { logits (256 × 256 Float32Array), score }: prev, the last answer's logits; hint, logits to send
//     instead of prev (the brush's strokes painted into it)
//   samAuto(handle) → the points Automatic proposes on one subject (a grid of single clicks: what reaches the top or
//     the sides is background, the best ranked of the rest is the subject), with `logits` its mask, then decoded
//     together by the caller (prev: logits)
//   samCrop(image, box, points, prev) → the logits of a crop of the picture (box in fractions), encoded on its own:
//     Remove Background's final pass at a higher resolution
// The dialog to retouch the mask is cutdlg section.
// Part of the main window (shell.js holds the shared state; this file adds its functions to window.__shell).
(() => {
"use strict";
const S = window.__shell;
const { t, invoke, toast, ask, ensureApp, show } = S;
const IMG = window.__img;
// The model: its input size and normalisation; "id" names its entries in the cache
const MODEL = { id: "sam21", size: 1024, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] };
const MB = (window.__modules.COMPONENTS.find(c => c.id === "cutout") || { mb: 0 }).mb;

/* ---------- the engine in its worker ---------- */
let worker = null, starting = null, seq = 0, life = 0, noGpu = false;
const calls = new Map();
// the engine (its model in memory, a few hundred MB) goes after 2 minutes without work, and comes back on the next call
const IDLE_MS = 120000;
let idleTimer = 0;
function call(type, data, transfer) {
  const mine = worker;
  clearTimeout(idleTimer);
  const p = new Promise((res, rej) => { const id = ++seq; calls.set(id, { res, rej }); worker.postMessage({ id, type, data }, transfer || []); });
  p.catch(() => {}).then(() => { if (worker === mine && !calls.size && type !== "init") { clearTimeout(idleTimer); idleTimer = setTimeout(() => { if (!calls.size && worker) stop(); }, IDLE_MS); } });
  return p;
}
function stop() {
  clearTimeout(idleTimer); idleTimer = 0;
  if (worker) worker.terminate(); worker = null; starting = null; life++;
  for (const c of calls.values()) c.rej(new Error("cutout engine stopped"));
  calls.clear();
}
// Keep large model responses off the renderer's critical path. The worker owns assembly.
async function modelFile(key, path) {
  const mine = worker;
  for (let offset = 0;;) {
    const bytes = await invoke("read_path_chunk", { path, offset });
    if (worker !== mine) throw new Error("cutout engine stopped");
    const length = bytes.byteLength, done = length < (512 << 10);
    await call("file", { key, bytes, offset, done }, [bytes]);
    offset += length;
    if (done) return;
  }
}
function engine() {
  if (!starting) starting = (async () => {
    const st = await S.tools(true);
    if (!st.cutout) throw new Error(t("cut.missing"));
    worker = new Worker("cutout-worker.js", { type: "module" });
    worker.onmessage = e => { const c = calls.get(e.data.id); if (!c) return; calls.delete(e.data.id); e.data.ok ? c.res(e.data.out) : c.rej(new Error(e.data.error)); };
    worker.onerror = e => { for (const c of calls.values()) c.rej(new Error(e.message || "cutout worker")); calls.clear(); };
    // WebGPU when there is one (the encoder in half precision when the GPU has it), else the CPU. The decoder loads
    // now; the encoder (hundreds of MB) only when a picture has to be encoded (encoderIn): an engine that comes back
    // after going idle answers the pictures it already read with their kept features (encodeIn)
    const { gpu, f16 } = await call("probe", { gpu: !noGpu });
    const start = async backend => {
      await modelFile("wasm", st.cutout.wasm);
      await modelFile("decoder", st.cutout.decoder);
      return call("init", { config: MODEL, backend });
    };
    let info = null;
    if (gpu) info = await start("webgpu").catch(e => { console.warn("cutout: WebGPU refused the model", e); return null; });
    if (!info) info = await start("wasm");
    S.cutoutInfo = info;
    return { ...info, life, encoderPath: info.backend === "webgpu" && f16 ? st.cutout.model : st.cutout.cpu, encoder: null };
  })().catch(e => { stop(); throw e; });
  return starting;
}
// Removing the component stops the engine; installing it again starts a new one
S.on("tools", st => { if (st && !st.cutout && worker) stop(); });

/* ---------- SAM: encode once, decode each prompt ---------- */
// The picture as the encoder's input (stretched to 1024 × 1024, as SAM 2 does), kept to encode it again if the
// engine went idle in between
function input1024(img) {
  const n = MODEL.size, c = IMG.mk(n, n), x = c.getContext("2d", { willReadFrequently: true });
  x.imageSmoothingQuality = "high"; x.drawImage(img, 0, 0, n, n);
  return x.getImageData(0, 0, n, n).data;
}
// The encoder, loaded once per engine; on WebGPU a refusal starts the engine again on the CPU
async function encoderIn(e) {
  if (!e.encoder) e.encoder = modelFile("encoder", e.encoderPath).then(() => call("encoder", {}));
  try { await e.encoder; return e; }
  catch (err) {
    if (e.backend !== "webgpu") { e.encoder = null; throw err; }
    console.warn("cutout: WebGPU refused the encoder", err);
    noGpu = true; stop();
    return encoderIn(await engine());
  }
}
// A picture's features: kept here once encoded (feats), so a new engine adopts them instead of encoding again
async function encodeIn(h, ctx) {
  let e = await engine();
  if (ctx && ctx.signal.aborted) throw Object.assign(new Error("cancelled"), { name: "AbortError" });
  if (h.life === e.life && h.id) return h;
  if (h.feats && h.backend === e.backend) {
    const list = h.feats.map(f => ({ data: f.data.slice(0), dims: f.dims })), out = await call("adopt", { feats: list }, list.map(f => f.data));
    Object.assign(h, { id: out.id, life: e.life });
    return h;
  }
  e = await encoderIn(e);
  const rgba = h.rgba.slice().buffer, out = await call("encode", { rgba }, [rgba]);
  Object.assign(h, { id: out.id, life: e.life, ms: out.ms, backend: out.backend, feats: h.hash === "crop" ? null : out.feats });
  S.cutoutLast = { ms: out.ms, backend: out.backend };
  return h;
}
// job ({ tool, title }): the encoder's run is a job of the jobs system (gpu lane, user priority, docs/JOBS_SPEC.md
// §8), so it waits for a free GPU and shows in the processes island; callers already inside a job leave it out.
const handles = new Map();   // hash → handle (the last few pictures)
async function samEmbed(image, o = {}) {
  const blob = IMG.isBlob(image) ? image : null, img = o.decoded || (blob ? await IMG.load(blob) : image);
  const hash = o.hash || await hashOf(blob, img), [w, h] = IMG.size(img);
  let hd = handles.get(hash);
  if (!hd) { hd = { hash, w, h, img, rgba: input1024(img), id: 0, life: -1 }; handles.set(hash, hd); if (handles.size > 4) handles.delete(handles.keys().next().value); }
  const run = ctx => encodeIn(hd, ctx);
  if (hd.life === life && hd.id) return hd;
  // read before: its kept features need no job
  if (hd.feats) return run();
  return o.job && S.jobs ? S.jobs.submit({ tool: o.job.tool || "removebg", kind: "detect", title: o.job.title || "", lane: "gpu", cost: 0.5, priority: "user", host: "page", run }).done : run();
}
const M2 = 256 * 256;
// Points (fractions) → the decoder's input, with the padding point the image predictor adds
function prompts(sets) {
  const n = Math.max(...sets.map(s => s.length)) + 1, b = sets.length, coords = new Float32Array(b * n * 2), labels = new Float32Array(b * n).fill(-1);
  sets.forEach((pts, k) => pts.forEach((p, i) => { coords[(k * n + i) * 2] = p.x * MODEL.size; coords[(k * n + i) * 2 + 1] = p.y * MODEL.size; labels[k * n + i] = p.label; }));
  return { b, n, coords: coords.buffer, labels: labels.buffer };
}
async function decodeRaw(h, sets, mask) {
  await encodeIn(h);
  const data = () => ({ id: h.id, ...prompts(sets), mask: mask ? mask.buffer : null });
  try { return await call("decode", data()); }
  catch (e) {
    // the engine was restarted (idle) or forgot the picture: encoded again
    if (String(e.message) !== "gone") throw e;
    h.id = 0; await encodeIn(h);
    return call("decode", data());
  }
}
// The mask the image predictor would give: of the three of multimask the best scored; the single mask unless it is
// unstable (dynamic multimask: its area changes by more than 2 % between logits −0.05 and +0.05)
function pick(out, k, multi) {
  const all = new Float32Array(out.masks, k * 4 * M2 * 4, 4 * M2), iou = out.iou.slice(k * 4, k * 4 + 4);
  let best = 1;
  if (!multi) {
    let hi = 0, lo = 0;
    for (let i = 0; i < M2; i++) { const v = all[i]; if (v > 0.05) hi++; if (v > -0.05) lo++; }
    if (!lo || hi / lo >= 0.98) best = 0;
  }
  if (best) for (let m = 2; m <= 3; m++) if (iou[m] > iou[best]) best = m;
  const logits = all.slice(best * M2, (best + 1) * M2);
  for (let i = 0; i < M2; i++) logits[i] = Math.max(-32, Math.min(32, logits[i]));
  return { logits, score: iou[best] };
}
async function samDecode(h, points, o = {}) {
  if (!points.length) return null;
  const mask = o.hint || o.prev || null, out = await decodeRaw(h, [points], mask ? Float32Array.from(mask) : null);
  const r = pick(out, 0, points.length === 1 && !mask);
  S.samLast = { ms: out.ms, backend: out.backend };
  return r;
}
// Automatic: a grid of single clicks, each answered with its three masks (part, object, whole). A mask that runs
// along the top, the upper part of a side or the whole bottom (or covers most of the picture) is background. The rest
// are grouped (the clicks that found the same thing) and ranked: confident, large, near the centre, found by many
// clicks. Only the best group's points are proposed (points on different things make the model answer for none of
// them); another group joins only when the model, asked for both, answers with their union as one confident thing
// (a person's head and body). The proposal's `logits` is the chosen mask, to decode the points against.
const V = 64, V2 = V * V;
function view(l) { const v = new Uint8Array(V2); let a = 0; for (let y = 0; y < V; y++) for (let x = 0; x < V; x++) if (l[(y * 4 + 2) * 256 + x * 4 + 2] > 0) { v[y * V + x] = 1; a++; } v.area = a / V2; return v; }
function bgLike(v) {
  let top = 0, bot = 0, up = 0;
  for (let x = 0; x < V; x++) { top += v[x]; bot += v[(V - 1) * V + x]; }
  for (let y = 0; y < 38; y++) up += v[y * V] + v[y * V + V - 1];
  return top / V > 0.3 || up / 76 > 0.3 || bot / V > 0.7 || v.area > 0.6;
}
function overlap(a, b) { let i = 0, u = 0; for (let p = 0; p < V2; p++) { i += a[p] & b[p]; u += a[p] | b[p]; } return { i, u }; }
function rankOf(g) {
  const v = g.mask; let n = 0, cx = 0, cy = 0, top = 0;
  for (let p = 0; p < V2; p++) if (v[p]) { n++; cx += p % V; cy += (p / V) | 0; }
  for (let x = 0; x < V; x++) top += v[x];
  const d = Math.hypot((cx / n + 0.5) / V - 0.5, (cy / n + 0.5) / V - 0.5) / Math.SQRT1_2;
  return g.best.score * v.area ** 0.75 * (1 - 0.6 * d) * (1 + 0.15 * Math.min(g.points.length, 6)) * Math.max(0, 1 - 2 * top / V);
}
async function samAuto(h) {
  // the same picture proposes the same subject: the proposal is kept with its handle
  if (h.auto) return Object.assign(h.auto.map(p => ({ ...p })), { logits: h.auto.logits });
  h.auto = await proposal(h);
  return samAuto(h);
}
async function proposal(h) {
  const G = S.cutoutInfo && S.cutoutInfo.backend === "webgpu" ? 8 : 4, pts = [], found = [];
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) pts.push({ x: (i + 0.5) / G, y: (j + 0.5) / G, label: 1 });
  for (let s = 0; s < pts.length; s += 16) {
    const chunk = pts.slice(s, s + 16), out = await decodeRaw(h, chunk.map(p => [p]), null);
    chunk.forEach((p, k) => {
      const px = Math.min(255, Math.floor(p.x * 256)), py = Math.min(255, Math.floor(p.y * 256));
      for (let m = 1; m <= 3; m++) {
        const score = out.iou[k * 4 + m]; if (score <= 0.7) continue;
        const logits = new Float32Array(out.masks, (k * 4 + m) * M2 * 4, M2);
        if (logits[py * 256 + px] <= 0) continue;
        const mask = view(logits);
        if (mask.area > 0.015 && !bgLike(mask)) found.push({ p, score, mask, logits });
      }
    });
  }
  const groups = [];
  for (const f of found.sort((a, b) => b.score - a.score)) {
    const g = groups.find(g => { const o = overlap(g.mask, f.mask); return o.i / o.u > 0.7; });
    if (!g) groups.push({ mask: f.mask, best: f, points: [f.p] });
    else if (!g.points.includes(f.p)) g.points.push(f.p);
  }
  if (!groups.length) return [{ x: 0.5, y: 0.5, label: 1, auto: true }];
  for (const g of groups) g.rank = rankOf(g);
  groups.sort((a, b) => b.rank - a.rank);
  const first = groups[0], clamp = l => { const c = Float32Array.from(l); for (let i = 0; i < M2; i++) c[i] = Math.max(-32, Math.min(32, c[i])); return c; };
  let chosen = first.points.slice(0, 3), mask = first.mask, logits = clamp(first.best.logits);
  for (const g of groups.slice(1, 6)) {
    if (g.rank < 0.6 * first.rank) break;
    const o = overlap(g.mask, mask); if (o.i / g.mask.area / V2 > 0.8) continue;
    const both = chosen.concat(g.points[0]), r = pick(await decodeRaw(h, [both.map(p => ({ ...p, label: 1 }))], null), 0, false), v = view(r.logits);
    const union = mask.map((x, p) => x | g.mask[p]), u = overlap(v, union);
    if (u.i / u.u > 0.85 && r.score > 0.85 && !bgLike(v)) { chosen = both; mask = v; logits = r.logits; }
  }
  return Object.assign(chosen.map(p => ({ x: p.x, y: p.y, label: 1, auto: true })), { logits });
}
// Remove Background's final pass: the crop `box` ({ x, y, w, h }, fractions) encoded on its own at 1024 px, the
// points inside it and the last answer cropped to it → the crop's logits
async function samCrop(image, box, points, prev) {
  const [iw, ih] = IMG.size(image), c = IMG.mk(Math.max(1, Math.round(box.w * iw)), Math.max(1, Math.round(box.h * ih)));
  const x = c.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(image, -box.x * iw, -box.y * ih, iw, ih);
  const h = { hash: "crop", w: c.width, h: c.height, img: c, rgba: input1024(c), id: 0, life: -1 };
  await encodeIn(h);
  const pts = points.filter(p => p.x >= box.x && p.x <= box.x + box.w && p.y >= box.y && p.y <= box.y + box.h).map(p => ({ x: (p.x - box.x) / box.w, y: (p.y - box.y) / box.h, label: p.label }));
  if (!pts.some(p => p.label === 1)) return null;
  let mask = null;
  if (prev) {
    // the last answer's logits under the crop, resampled to 256 × 256
    mask = new Float32Array(M2);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      const u = Math.min(255, Math.max(0, Math.floor((box.x + (i + 0.5) / 256 * box.w) * 256))), v = Math.min(255, Math.max(0, Math.floor((box.y + (j + 0.5) / 256 * box.h) * 256)));
      mask[j * 256 + i] = prev[v * 256 + u];
    }
  }
  const out = await decodeRaw(h, [pts], mask);
  call("forget", { id: h.id }).catch(() => {});
  return pick(out, 0, false).logits;
}

/* ---------- the model's mask, cached ---------- */
const mem = new Map();   // key → grey canvas at the model's size
// auto2: Automatic's one-subject proposal (masks cached by the earlier one are not reused)
const keyOf = hash => `${MODEL.id}-auto2-${hash.slice(0, 40)}`;
async function hashOf(blob, img) {
  if (blob) return IMG.hash(blob);
  const c = IMG.mk(256, 256); c.getContext("2d").drawImage(img, 0, 0, 256, 256);
  return IMG.hash(await IMG.toBlob(c));
}
// The subject of `img` at the model's size as a grey canvas (white = subject): Automatic's points decoded together,
// the edge refined with the picture as guide. job: as samEmbed.
async function modelMask(img, hash, job) {
  const key = keyOf(hash);
  if (mem.has(key)) return mem.get(key);
  const cached = await invoke("cutout_cache_get", { key }).catch(() => null);
  if (cached && cached.byteLength) {
    try { const g = await IMG.load(new Blob([cached], { type: "image/png" })); const c = IMG.mk(MODEL.size, MODEL.size); c.getContext("2d").drawImage(g, 0, 0); URL.revokeObjectURL(g.__url); remember(key, c); return c; } catch (e) {}
  }
  const h = await samEmbed(img, { hash, decoded: img, job }), pts = await samAuto(h), r = await samDecode(h, pts, { prev: pts.logits });
  const n = MODEL.size, l = IMG.upLogits(r.logits, n, n), p = new Float32Array(n * n);
  for (let i = 0; i < p.length; i++) p[i] = 1 / (1 + Math.exp(-l[i]));
  const a = IMG.guidedAlpha(h.rgba, n, n, p, { r: 4, eps: 4e-3, smooth: 1 });
  const c = IMG.mk(n, n), x = c.getContext("2d"), d = x.createImageData(n, n);
  for (let i = 0; i < a.length; i++) { d.data[i * 4] = d.data[i * 4 + 1] = d.data[i * 4 + 2] = Math.round(a[i] * 255); d.data[i * 4 + 3] = 255; }
  x.putImageData(d, 0, 0);
  remember(key, c);
  IMG.toBlob(c).then(b => b.arrayBuffer()).then(buf => invoke("cutout_cache_put", new Uint8Array(buf), { headers: { "x-key": key } })).catch(e => console.warn("cutout cache", e));
  return c;
}
function remember(key, c) { mem.set(key, c); if (mem.size > 24) mem.delete(mem.keys().next().value); }

/* ---------- mask edges ---------- */
// shift > 0 grows the subject, < 0 shrinks it; feather softens the edge (both in pixels of this canvas)
const refine = IMG.refineMask;

/* ---------- the API ---------- */
async function cutoutReady() { try { return !!(await S.tools()).cutout; } catch (e) { return false; } }
// Offers the download when the component is missing; true once it is there
async function cutoutEnsure() {
  if (await cutoutReady()) return true;
  const ok = await ask({ title: t("cut.installTitle"), text: t("cut.installText", { mb: MB }), okLabel: t("cut.install") });
  if (!ok) return false;
  try {
    await S.installTool("cutout", p => { if (p.total) toast(t("cut.installing", { pct: Math.round(p.done / p.total * 100) })); });
    toast(t("cut.installed"));
    return true;
  } catch (e) { toast(t("cut.installFailed", { error: String(e && e.message || e) })); return false; }
}
// The mask of a picture at its own size as an alpha canvas (the model's answer, stretched)
async function autoMask(image, o = {}) {
  // Reuse a caller's decoded original while keeping the same Blob hash and model cache key.
  const blob = IMG.isBlob(image) ? image : null, img = o.decoded || (blob ? await IMG.load(blob) : image);
  const hash = await hashOf(blob, img), g = await modelMask(img, hash, o.job), [w, h] = IMG.size(img);
  return { img, hash, w, h, alpha: IMG.alphaFromGrey(g, w, h) };
}
async function cutout(image, o = {}) {
  const r = await autoMask(image, { job: o.job }), alpha = refine(r.alpha, o.edge);
  const [rgba, mask] = await Promise.all([IMG.toBlob(IMG.masked(r.img, alpha)), IMG.toBlob(IMG.greyFromAlpha(alpha))]);
  return { rgba, mask, hash: r.hash, w: r.w, h: r.h };
}
async function cutoutFocus(blob, img) {
  if (!(await cutoutReady())) return null;
  const hash = await hashOf(blob, img), g = await modelMask(img, hash);
  return IMG.focusOf(IMG.alphaFromGrey(g, 64, 64));
}
// Saves a new version through the shared policy; recorded as an export → its actual final path
async function saveVersion(blob, { name, tag = "cutout", ext = "png" } = {}) {
  const stem = S.fileStem(String(name || "image").replace(/\.[^.]+$/, "")) + ` (${tag})`;
  const final = await S.saveOutput(blob, stem + "." + ext, "cutout");
  if (!final) throw Object.assign(new Error(t("common.saveCancelled")), { cancelled: true });
  const img = await IMG.load(blob);
  const k = 240 / Math.max(img.naturalWidth, img.naturalHeight), c = IMG.mk(img.naturalWidth * k, img.naturalHeight * k);
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(img.__url);
  S.recordExport({ path: final, name: String(final).split(/[\\/]/).pop(), kind: "image", thumb: c.toDataURL("image/png") });
  return final;
}
const saveCutout = (rgba, o = {}) => saveVersion(rgba, { ...o, tag: "cutout", ext: "png" });
async function cutoutBatch(files) {
  if (!S.usable("upscale") || !(await cutoutEnsure())) return false;
  const u = await ensureApp("upscale"); await u.addJobs(Array.from(files), { upscale: false, cutout: true }); show("upscale");
  return true;
}

Object.assign(S, { cutout, cutoutReady, cutoutEnsure, cutoutFocus, cutoutBatch, saveCutout, saveVersion, cutoutEngine: engine, autoMask, refineMask: refine, CUTOUT_MODEL: MODEL,
  samEmbed, samDecode, samAuto, samCrop, cutoutStop: stop });
})();

/* ===== cutdlg ===== */
// Cutout dialog: the one place where a cut-out is checked and retouched (docs/ARCHITECTURE.md → Shared services).
//   cutoutDialog({ image, name, edit, from }) → { rgba, mask, edit, w, h } | null (cancelled)
//     image  the picture (Blob); edit: what an earlier result returned, to go on retouching that mask
//     rgba   the picture with transparency (PNG Blob); mask: the final mask (grey PNG, white = subject)
//     edit   { base, edge }: the retouched mask before its edge settings, and those settings, to open it again
// Before / after with the comparator of Upscale (compare.js), a brush that adds or removes, the edge softened or
// moved in or out, and the preview over a checkerboard, black, white or a colour.
// Part of the main window (shell.js holds the shared state; this file adds its functions to window.__shell).
(() => {
"use strict";
const S = window.__shell;
const { $, t, M } = S;
const IMG = window.__img;
const d = M.dialog($("#cutDlg")), stageEl = $("#cutStage"), view = $("#cutView"), ring = $("#cutRing");
const WORK = 1600;           // the mask is edited at most this size (longer side); the result is made at full size
const UNDO = 8;
let k = null, resolve = null, raf = 0;
const cmp = window.__compare($("#cutCmp"), {
  stage: stageEl,
  zoomText: p => t("up.zoom", { pct: p }),
  claim: () => !!k && k.tool !== "compare" && !k.busy,
  onChange: () => placeRing()
});

/* ---------- drawing the result ---------- */
function paint() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = 0; if (!k || !k.mask) return;
    const x = view.getContext("2d"), m = S.refineMask(k.mask, { shift: k.shift * k.ws, feather: k.feather * k.ws });
    x.globalCompositeOperation = "copy"; x.imageSmoothingQuality = "high"; x.drawImage(k.img, 0, 0, view.width, view.height);
    x.globalCompositeOperation = "destination-in"; x.drawImage(m, 0, 0);
    x.globalCompositeOperation = "source-over";
  });
}
function sync() {
  const set = (id, v, lo, hi, txt) => { const r = $("#" + id); r.value = String(v); r.style.setProperty("--p", ((v - lo) / (hi - lo) * 100) + "%"); $("#o" + id[0].toUpperCase() + id.slice(1)).textContent = txt; };
  set("cutSize", k.size, 2, 400, k.size + " px");
  set("cutFeather", k.feather, 0, 20, k.feather + " px");
  set("cutShift", k.shift, -20, 20, (k.shift > 0 ? "+" : "") + k.shift + " px");
  document.querySelectorAll("#cutTools [data-tool]").forEach(b => b.setAttribute("aria-checked", String(b.dataset.tool === k.tool)));
  document.querySelectorAll("#cutBgs [data-bg]").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.bg === k.bg)));
  stageEl.dataset.bg = k.bg; stageEl.style.setProperty("--k-color", k.color);
  stageEl.classList.toggle("brush", k.tool !== "compare");
  $("#cutUndo").disabled = !k.undo.length || k.busy; $("#cutReset").disabled = k.busy || !k.auto;
  $("#cutApply").disabled = k.busy || !k.mask;
}

/* ---------- tools and settings ---------- */
function setTool(tool) {
  if (!k) return;
  k.tool = tool; sync();
  // the brush works on the result: the divider moves out of the way; comparing brings it back to the middle
  cmp.setX(tool === "compare" ? 0.5 : 0, true);
  placeRing();
}
$("#cutTools").addEventListener("click", e => { const b = e.target.closest("[data-tool]"); if (b) setTool(b.dataset.tool); });
for (const [id, key] of [["cutSize", "size"], ["cutFeather", "feather"], ["cutShift", "shift"]]) {
  $("#" + id).addEventListener("input", e => { if (!k) return; k[key] = +e.target.value; sync(); if (key !== "size") paint(); placeRing(); });
}
$("#cutBgs").addEventListener("click", e => { const b = e.target.closest("[data-bg]"); if (b && k) { k.bg = b.dataset.bg; sync(); } });
// the colour backdrop starts at the accent (a colour input only takes #rrggbb) and remembers the last pick
let lastColor = "";
function startColor() {
  if (lastColor) return lastColor;
  const x = IMG.mk(1, 1).getContext("2d"); x.fillStyle = S.cssVar("--info"); return x.fillStyle;
}
$("#cutColor").addEventListener("input", e => { if (!k) return; k.color = lastColor = e.target.value; k.bg = "color"; sync(); });
d.addEventListener("keydown", e => {
  if (!k || /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); undo(); }
  else if (e.key === "[" || e.key === "]") { e.preventDefault(); k.size = Math.max(2, Math.min(400, Math.round(k.size * (e.key === "]" ? 1.2 : 1 / 1.2)))); sync(); placeRing(); }
  else if (!e.ctrlKey && !e.altKey && ["c", "a", "r"].includes(e.key.toLowerCase())) setTool({ c: "compare", a: "add", r: "remove" }[e.key.toLowerCase()]);
});

/* ---------- brush ---------- */
function snapshot() {
  const c = IMG.mk(k.mask.width, k.mask.height); c.getContext("2d").drawImage(k.mask, 0, 0);
  k.undo.push(c); if (k.undo.length > UNDO) k.undo.shift();
}
function undo() {
  if (!k || !k.undo.length || k.busy) return;
  const c = k.undo.pop(), x = k.mask.getContext("2d");
  x.globalCompositeOperation = "copy"; x.drawImage(c, 0, 0); x.globalCompositeOperation = "source-over";
  sync(); paint();
}
function stroke(from, to) {
  const x = k.mask.getContext("2d"), r = k.size * k.ws / 2;
  x.globalCompositeOperation = k.tool === "add" ? "source-over" : "destination-out";
  x.strokeStyle = x.fillStyle = S.cssVar("--matte-light");
  x.lineCap = "round"; x.lineJoin = "round"; x.lineWidth = r * 2;
  x.beginPath(); x.moveTo(from[0], from[1]); x.lineTo(to[0], to[1]); x.stroke();
  x.beginPath(); x.arc(to[0], to[1], r, 0, Math.PI * 2); x.fill();
  x.globalCompositeOperation = "source-over";
}
const workPoint = e => { const [px, py] = cmp.toPicture(e.clientX, e.clientY); return [px * k.ws, py * k.ws]; };
stageEl.addEventListener("pointerdown", e => {
  if (!k || e.button !== 0 || k.tool === "compare" || k.busy || !k.mask || e.target.closest(".div")) return;
  e.preventDefault(); stageEl.setPointerCapture(e.pointerId);
  snapshot();
  let last = workPoint(e); stroke(last, last); paint(); sync();
  const move = ev => { const p = workPoint(ev); stroke(last, p); last = p; paint(); moveRing(ev); };
  const up = () => { stageEl.removeEventListener("pointermove", move); stageEl.removeEventListener("pointerup", up); stageEl.removeEventListener("pointercancel", up); };
  stageEl.addEventListener("pointermove", move); stageEl.addEventListener("pointerup", up); stageEl.addEventListener("pointercancel", up);
});
// The brush's outline follows the pointer, at the brush's size on screen
let pointer = null;
function moveRing(e) { pointer = [e.clientX, e.clientY]; placeRing(); }
function placeRing() {
  if (!k || !pointer || k.tool === "compare" || k.busy) { ring.hidden = true; return; }
  const r = stageEl.getBoundingClientRect(), dpx = k.size * cmp.st.bw * cmp.st.z / k.iw;
  ring.hidden = false;
  Object.assign(ring.style, { width: dpx + "px", height: dpx + "px", transform: `translate(${pointer[0] - r.left - dpx / 2}px,${pointer[1] - r.top - dpx / 2}px)` });
}
stageEl.addEventListener("pointermove", moveRing);
stageEl.addEventListener("pointerleave", () => { pointer = null; ring.hidden = true; });

/* ---------- opening, the model, applying ---------- */
function busy(on, text) {
  k.busy = on; $("#cutBusyText").textContent = text || "";
  M.reveal($("#cutBusy"), on); sync(); placeRing();
}
async function findSubject(mine) {
  busy(true, t("cut.finding"));
  try {
    const r = await S.autoMask(k.blob || k.img, { job: { tool: k.from || "removebg", title: k.name || "" } });
    if (k !== mine) return;
    const x = k.mask.getContext("2d");
    x.globalCompositeOperation = "copy"; x.imageSmoothingQuality = "high"; x.drawImage(r.alpha, 0, 0, k.mask.width, k.mask.height); x.globalCompositeOperation = "source-over";
    k.auto = true;
    const info = S.cutoutLast;
    $("#cutStatus").className = "status"; $("#cutStatus").textContent = info ? t("cut.found", { s: (info.ms / 1000).toFixed(1), where: t(info.backend === "webgpu" ? "cut.gpu" : "cut.cpu") }) : t("cut.foundCached");
  } catch (e) {
    if (k !== mine) return;
    $("#cutStatus").className = "status bad"; $("#cutStatus").textContent = t("cut.failed", { error: String(e && e.message || e) });
  }
  busy(false); paint();
}
async function cutoutDialog(o = {}) {
  if (resolve) { resolve(null); resolve = null; }
  if (!o.edit && !(await S.cutoutEnsure())) return null;
  const blob = IMG.isBlob(o.image) ? o.image : null, img = blob ? await IMG.load(blob) : o.image;
  const [iw, ih] = IMG.size(img), ws = Math.min(1, WORK / Math.max(iw, ih));
  const mask = IMG.mk(iw * ws, ih * ws);
  view.width = mask.width; view.height = mask.height; view.getContext("2d").clearRect(0, 0, view.width, view.height);
  k = { img, blob, iw, ih, ws, mask, from: S.active(), name: o.name || "", undo: [], tool: "compare", size: Math.max(8, Math.round(Math.max(iw, ih) / 24)), feather: 0, shift: 0, bg: "checker", color: startColor(), busy: false, auto: false };
  // The brush default depends on this image, independently of its edited size.
  $("#cutSize").dataset.def = String(k.size);
  $("#cutColor").value = k.color;
  $("#cutBefore").src = img.src || (img.toDataURL ? img.toDataURL() : "");
  $("#cutInfo").textContent = [o.name, `${iw}×${ih}`].filter(Boolean).join(" · ");
  $("#cutStatus").textContent = ""; $("#cutStatus").className = "status";
  if (o.edit && o.edit.base) {
    const base = IMG.isBlob(o.edit.base) ? await IMG.load(o.edit.base) : o.edit.base;
    mask.getContext("2d").drawImage(IMG.alphaFromGrey(base, mask.width, mask.height), 0, 0);
    Object.assign(k, { feather: +(o.edit.edge && o.edit.edge.feather) || 0, shift: +(o.edit.edge && o.edit.edge.shift) || 0, auto: true });
  }
  d.returnValue = ""; d.showFrom(o.from || document.activeElement);
  cmp.open(iw, ih, 0.5); sync(); paint();
  $("#cutApply").focus();
  if (!o.edit) findSubject(k);
  return new Promise(res => { resolve = res; });
}
$("#cutReset").addEventListener("click", () => { if (k && !k.busy) { snapshot(); findSubject(k); } });
$("#cutApply").addEventListener("click", () => d.close("ok"));
$("#cutCancel").addEventListener("click", () => d.close(""));
$("#cutClose").addEventListener("click", () => d.close(""));
d.addEventListener("close", async () => {
  const r = resolve, mine = k; resolve = null;
  cmp.close(); ring.hidden = true;
  if (!r) return;
  if (d.returnValue !== "ok" || !mine || !mine.mask) { r(null); return; }
  try { r(await result(mine)); } catch (e) { S.toast(t("cut.failed", { error: String(e && e.message || e) })); r(null); }
});
// The result at the picture's full size: the edited mask stretched, its edge settings applied at full scale
async function result(s) {
  const full = IMG.mk(s.iw, s.ih), x = full.getContext("2d");
  x.imageSmoothingQuality = "high"; x.drawImage(s.mask, 0, 0, s.iw, s.ih);
  const m = S.refineMask(full, { shift: s.shift, feather: s.feather });
  const [rgba, mask, base] = await Promise.all([IMG.toBlob(IMG.masked(s.img, m)), IMG.toBlob(IMG.greyFromAlpha(m)), IMG.toBlob(IMG.greyFromAlpha(s.mask))]);
  return { rgba, mask, w: s.iw, h: s.ih, edit: { base, edge: { shift: s.shift, feather: s.feather } } };
}

Object.assign(S, { cutoutDialog, cutoutOpen: () => d.open });
})();

/* ===== frames ===== */
// Frame Grab's extractor (docs/ARCHITECTURE.md → Shared services): the one component that reads video frames, for
// Frame Grab and the tools that open it, so a frame is always the same pixels. Everything goes
// through FFmpeg (the tools module): a frame at its native size and exact index, the keyframes (a packet scan and
// their small copies, under a second), and one low-resolution pass over every frame that gives the strip under the
// timeline and the candidates (the sharpest frame of each scene), reported as it goes.
//   videoPath(src)             File (a download keeps its __halPath) or { path, name } → { path, name } on disk
//   probeVideo(path)           → { w, h, fps, duration, frames, codec }
//   videoKey(path)             → { size, key }: a hash of the file's content (framegrab.rs), the disk cache's key
//   readRange(path, a, b)      → ArrayBuffer of bytes a…b (the page decodes the video from these, never whole)
//   frameAt(path, n, o)        → PNG Blob of frame n (o.maxW: smaller, for a view), exactly the frame FFmpeg decodes
//   pickVideo()                → { path, name } from the file picker (read where it is), or null
//   keyIndex(path, o)          → { n: [frame indices of the keyframes] } from the packets alone (no decoding)
//   keyframes(path, o)         → { n, w, h, rgb } small copies of the keyframes (at most MAXK), for the strip
//   keyPictures(path, o)       → { n, w, h, pics: [JPEG bytes] } the keyframes at preview size (o.w), as they come
//   frames(path, from, k, o)   → frames from…from+k-1 exact at preview size, RGBA, to o.onFrame(n, rgba, w, h)
//   analyseVideo(path, o)      → { step, n: [frame indices], w, h, rgb, sharp, scene }; o.onPartial(an) with the
//                                frames so far (an.count of them) while it runs
//   candidates(an, k)          → up to k frame indices, sorted by time
//   frameGrab({ video, name, from, dest, frame }) opens the Frame Grab tab and resolves with what was captured
// Every job takes o.signal: aborting it kills its FFmpeg and rejects with an AbortError. Keyframes and analyses are
// kept in memory for the last few videos and on disk (%LOCALAPPDATA%\Halation\cache\framegrab, limit in
// Settings → Storage) by content hash.
// Part of the main window (shell.js holds the shared state; this file adds its functions to window.__shell).
(() => {
"use strict";
const S = window.__shell;
const { t, invoke, show, ensureApp, toast } = S;

// A path FFmpeg can read: a file that came from disk keeps its path; any other is copied to Tools\temp once
const copies = new WeakMap();
async function videoPath(src) {
  if (!src) throw new Error("no video");
  if (typeof src.path === "string") return { path: src.path, name: src.name || src.path.split(/[\\/]/).pop() };
  if (src.__halPath) return { path: src.__halPath, name: src.name };
  if (!copies.has(src)) { const p = copyIn(src); copies.set(src, p); p.catch(() => copies.delete(src)); }
  return { path: await copies.get(src), name: src.name || "video" };
}
// Small IPC payloads keep WebView's synchronous request preparation within an interactive frame.
async function copyIn(file) {
  const path = await S.tempFile(new Blob([]), file.name || "video.mp4");
  const chunk = 512 << 10;
  for (let at = 0; at < file.size; at += chunk) {
    const bytes = new Uint8Array(await file.slice(at, at + chunk).arrayBuffer());
    await invoke("framegrab_write", bytes, { headers: { "x-path": encodeURIComponent(path), "x-offset": String(at) } });
  }
  return path;
}
// Frame Grab's file picker: { path, name } or null
const pickVideo = () => invoke("framegrab_pick", { label: t("fg.view") });
// An empty file in Tools\temp for FFmpeg to write over (the page cannot make folders or names there itself)
const tempOut = name => S.tempFile(new Blob([]), name);
const drop = paths => invoke("delete_paths", { paths }).catch(() => {});
const aborted = () => new DOMException("aborted", "AbortError");
// A map that keeps its last `max` entries (the oldest used goes first)
function lru(max) {
  const m = new Map();
  return {
    get(k) { if (!m.has(k)) return undefined; const v = m.get(k); m.delete(k); m.set(k, v); return v; },
    set(k, v) { m.delete(k); m.set(k, v); while (m.size > max) m.delete(m.keys().next().value); return v; },
    delete: k => m.delete(k), has: k => m.has(k), get size() { return m.size; }
  };
}

// Runs FFmpeg to the end; its stderr lines are kept for the error message. signal: aborting kills it. low: below
// normal priority and half the cores (the strip, the analysis: they give way to the frames the user is looking at)
const HALF = String(Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 2)));
async function ffmpeg(args, onLine, signal, low = false) {
  if (signal && signal.aborted) throw aborted();
  const lines = [];
  const p = await S.runTool("ffmpeg", ["-hide_banner", "-nostdin", ...(low ? ["-threads", HALF] : []), ...args], (line, stream) => { if (stream === "err") { lines.push(line); if (lines.length > 60) lines.shift(); } if (onLine) onLine(line, stream); }, { low });
  const kill = () => p.kill();
  if (signal) { if (signal.aborted) kill(); else signal.addEventListener("abort", kill, { once: true }); }
  try {
    const code = await p.done;
    if (signal && signal.aborted) throw aborted();
    return { code, lines };
  } finally { if (signal) signal.removeEventListener("abort", kill); }
}

/* ---------- what the video is ---------- */
const probes = lru(24);
function parseProbe(lines) {
  const all = lines.join("\n"), v = lines.find(l => /Stream #\d+:\d+.*: Video:/.test(l));
  if (!v) return null;
  const size = /,\s*(\d{2,5})x(\d{2,5})[\s,[]/.exec(v), fps = /([\d.]+)\s*fps/.exec(v) || /([\d.]+)\s*tbr/.exec(v);
  const d = /Duration:\s*(\d+):(\d+):([\d.]+)/.exec(all), rot = /rotation of (-?[\d.]+) degrees|rotate\s*:\s*(-?\d+)/.exec(all);
  if (!size) return null;
  let w = +size[1], h = +size[2];
  // FFmpeg turns a rotated phone video upright when it decodes; its frames then have the other orientation
  const r = rot ? Math.abs(Math.round(+(rot[1] || rot[2]))) % 180 : 0;
  if (r === 90) [w, h] = [h, w];
  const rate = fps && +fps[1] > 0 ? +fps[1] : 30, duration = d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0;
  return { w, h, fps: rate, duration, frames: Math.max(1, Math.round(duration * rate)), codec: (/Video:\s*(\w+)/.exec(v) || [])[1] || "", rotated: r === 90 };
}
function probeVideo(path) {
  if (!probes.has(path)) {
    const p = ffmpeg(["-i", path]).then(({ lines }) => {
      const info = parseProbe(lines);
      if (!info) throw new Error(t("fg.err.notVideo"));
      return info;
    });
    p.catch(() => probes.delete(path));
    probes.set(path, p);
  }
  return probes.get(path);
}
const keys = lru(24);
function videoKey(path) {
  if (!keys.has(path)) { const p = invoke("framegrab_probe", { path }); p.catch(() => keys.delete(path)); keys.set(path, p); }
  return keys.get(path);
}
const readRange = (path, start, end) => invoke("framegrab_read", { path, start, end });

/* ---------- one frame ---------- */
// Frame n starts at n / fps: seeking a quarter of a frame before it makes FFmpeg decode up to that frame and
// hand it over (it drops the frames before the position), so index and pixels always agree.
const seekOf = (n, fps) => Math.max(0, (n - 0.25) / fps).toFixed(6);
async function frameAt(path, n, o = {}) {
  const info = o.info || await probeVideo(path), out = await tempOut("frame.png");
  n = Math.max(0, Math.min(info.frames - 1, Math.round(n)));
  const vf = o.maxW && o.maxW < info.w ? ["-vf", `scale=${Math.round(o.maxW / 2) * 2}:-2:flags=bilinear`] : [];
  try {
    const { code, lines } = await ffmpeg(["-loglevel", "error", "-ss", seekOf(n, info.fps), "-i", path, "-an", "-frames:v", "1", ...vf, "-f", "image2", "-c:v", "png", "-y", out], null, o.signal);
    const buf = code === 0 ? await invoke("read_path", { path: out }).catch(() => null) : null;
    // past the last frame FFmpeg writes nothing: the previous frame is the last one there is
    if (!buf || !buf.byteLength) {
      if (n > 0 && code === 0 && !o.back) return frameAt(path, n - 1, { ...o, info, back: true });
      throw new Error(lines.slice(-1)[0] || t("fg.err.frame"));
    }
    return new Blob([buf], { type: "image/png" });
  } finally { drop([out]); }
}

/* ---------- the disk cache ---------- */
// An entry is a JSON head and binary parts: [u32 head length][head][parts…], the head listing each part's length
async function cacheGet(key) {
  try {
    const buf = await invoke("framegrab_cache_get", { key });
    if (!buf || buf.byteLength < 4) return null;
    const len = new DataView(buf).getUint32(0, true), head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, len)));
    let at = 4 + len;
    const parts = head.parts.map(n => { const b = buf.slice(at, at + n); at += n; return b; });
    return at === buf.byteLength ? { head, parts } : null;
  } catch (e) { return null; }
}
function cachePut(key, head, parts) {
  const h = new TextEncoder().encode(JSON.stringify({ ...head, parts: parts.map(p => p.byteLength) }));
  const out = new Uint8Array(4 + h.length + parts.reduce((a, p) => a + p.byteLength, 0));
  new DataView(out.buffer).setUint32(0, h.length, true); out.set(h, 4);
  let at = 4 + h.length;
  for (const p of parts) { out.set(new Uint8Array(p.buffer || p, p.byteOffset || 0, p.byteLength), at); at += p.byteLength; }
  const mb = (S.st.settings.workspace && S.st.settings.workspace.budgetMB) || 8192;   // Settings → Storage: the workspace budget
  return invoke("framegrab_cache_put", out, { headers: { "x-key": key, "x-max": String(mb) } }).catch(() => {});
}
// A job shared by everyone who asks for the same path, kept for the last few videos. Callers with a signal stop
// waiting when it aborts; the job itself (and its FFmpeg) ends only when every caller still waiting has left.
function shared(map, path, o, run) {
  let e = map.get(path);
  if (!e) {
    const ac = new AbortController();
    e = { ac, waiting: 0, done: false, partial: new Set(), progress: new Set(), last: null };
    e.run = run(ac.signal, an => { e.last = an; for (const f of e.partial) f(an); }, p => { for (const f of e.progress) f(p); });
    const end = () => { e.done = true; e.partial.clear(); e.progress.clear(); };
    e.run.then(end, () => { end(); if (map.get(path) === e) map.delete(path); });
    map.set(path, e);
  }
  if (e.done) { if (o.onProgress) e.run.then(() => o.onProgress(1), () => {}); return e.run; }
  e.waiting++;
  if (o.onPartial) { e.partial.add(o.onPartial); if (e.last) o.onPartial(e.last); }
  if (o.onProgress) e.progress.add(o.onProgress);
  return new Promise((res, rej) => {
    const off = () => { e.waiting--; e.partial.delete(o.onPartial); e.progress.delete(o.onProgress); if (o.signal) o.signal.removeEventListener("abort", stop); };
    const stop = () => { if (e.done) return; off(); if (e.waiting <= 0) { e.ac.abort(); if (map.get(path) === e) map.delete(path); } rej(aborted()); };
    if (o.signal) { if (o.signal.aborted) { stop(); return; } o.signal.addEventListener("abort", stop, { once: true }); }
    e.run.then(v => { off(); res(v); }, err => { off(); rej(err); });
  });
}

/* ---------- the keyframes ---------- */
// The index: framecrc lists every packet of the video stream (a stream copy, no decoding: well under a second for a
// long video), keyframes are the packets without an "F=" flag. Frame indices of the keyframes, in order.
const indexJobs = lru(6);
function keyIndex(path, o = {}) {
  return shared(indexJobs, path, o, async signal => {
    const info = o.info || await probeVideo(path), meta = await videoKey(path).catch(() => null), ck = meta && `${meta.key}-ix1`;
    const hit = ck && await cacheGet(ck);
    if (hit && hit.head.frames === info.frames) return { n: hit.head.n, times: hit.head.times, count: hit.head.n.length };
    const pts = [], list = await tempOut("keys.txt");
    let tb = 0;
    try {
      const r = await ffmpeg(["-loglevel", "error", "-i", path, "-map", "0:v:0", "-c", "copy", "-f", "framecrc", "-y", list], null, signal);
      const txt = r.code === 0 ? new TextDecoder().decode(await invoke("read_path", { path: list })) : "";
      for (const line of txt.split("\n")) {
        const m = /^#tb 0: (\d+)\/(\d+)/.exec(line);
        if (m) { tb = +m[1] / +m[2]; continue; }
        const f = /^0,\s*(-?\d+),\s*(-?\d+),/.exec(line);
        if (f) pts.push([+f[2], !/F=/.test(line)]);
      }
    } finally { drop([list]); }
    let t0 = Infinity; for (const p of pts) t0 = Math.min(t0, p[0]);
    const times = tb ? pts.filter(p => p[1]).map(p => (p[0] - t0) * tb).sort((a, b) => a - b) : [];
    const n = [...new Set(times.map(s => Math.max(0, Math.min(info.frames - 1, Math.round(s * info.fps)))))];
    if (!n.length || n[0] !== 0) n.unshift(0);
    if (ck) cachePut(ck, { frames: info.frames, n, times }, []);
    return { n, times, count: n.length };
  });
}
// The keyframes copied alone to a small file (a stream copy); with more than `max` of them (videos made only of
// keyframes: ProRes, MJPEG), one per 1/max of the length
async function keysOnly(path, info, idx, max, signal) {
  const times = idx.times || [];
  let gap = 0; for (let i = 1; i < times.length; i++) gap = Math.max(gap, times[i] - times[i - 1]);
  const thin = times.length > max ? `+gte(mod(pts*tb\\,${(info.duration / max).toFixed(6)})\\,${Math.max(gap * 0.98, 0.001).toFixed(6)})` : "";
  const kv = await tempOut("keys.mkv");
  const r = await ffmpeg(["-loglevel", "error", "-i", path, "-map", "0:v:0", "-c", "copy", "-bsf:v", `noise=drop=not(key)${thin}`, "-f", "matroska", "-y", kv], null, signal, true).catch(e => { drop([kv]); throw e; });
  if (r.code !== 0) { drop([kv]); throw new Error(r.lines.slice(-1)[0] || t("fg.err.frame")); }
  return kv;
}
const nOf = (info, s) => Math.max(0, Math.min(info.frames - 1, Math.round(s * info.fps)));
const timeLine = at => line => { const m = /\bn:\s*\d+.*\bpts_time:(-?[\d.]+)/.exec(line); if (m) at.push(+m[1]); };

// The strip's small copies of the keyframes (KW wide, at most MAXK)
const KW = 256, MAXK = 300;
const keyJobs = lru(3);
function keyframes(path, o = {}) {
  return shared(keyJobs, path, o, async signal => {
    const info = o.info || await probeVideo(path), meta = await videoKey(path).catch(() => null);
    const w = KW, h = Math.max(2, Math.round(KW * info.h / info.w / 2) * 2), ck = meta && `${meta.key}-kf1`;
    const hit = ck && await cacheGet(ck);
    if (hit && hit.head.frames === info.frames && hit.head.w === w && hit.head.h === h) return { n: hit.head.n, w, h, rgb: new Uint8Array(hit.parts[0]), count: hit.head.n.length, done: true };
    const idx = await keyIndex(path, { info, signal });
    const kv = await keysOnly(path, info, idx, MAXK, signal), out = await tempOut("keys.rgb");
    try {
      const at = [];
      const r = await ffmpeg(["-loglevel", "info", "-i", kv, "-an", "-sn", "-vf", `scale=${w}:${h}:flags=bilinear,showinfo`, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-y", out], timeLine(at), signal, true);
      const buf = r.code === 0 ? await invoke("read_path", { path: out }) : null;
      if (!buf) throw new Error(r.lines.slice(-1)[0] || t("fg.err.frame"));
      const rgb = new Uint8Array(buf), count = Math.min(at.length, Math.floor(rgb.length / (w * h * 3)));
      const n = at.slice(0, count).map(s => nOf(info, s));
      const res = { n, w, h, rgb: rgb.subarray(0, count * w * h * 3), count, done: true };
      if (ck && count) cachePut(ck, { frames: info.frames, w, h, n }, [res.rgb]);
      return res;
    } finally { drop([kv, out]); }
  });
}

// The keyframes at preview size (o.w wide), as JPEG at the highest quality, for videos the page cannot decode:
// dragging fast shows them. Reported as they come (o.onPartial); kept on disk.
const picJobs = lru(2);
function keyPictures(path, o = {}) {
  return shared(picJobs, path + "|" + o.w, o, async (signal, partial) => {
    const info = o.info || await probeVideo(path), meta = await videoKey(path).catch(() => null);
    const w = Math.min(o.w || 1920, info.w), h = Math.max(2, Math.round(w * info.h / info.w / 2) * 2), ck = meta && `${meta.key}-kp1-${w}`;
    const hit = ck && await cacheGet(ck);
    if (hit && hit.head.frames === info.frames) return { n: hit.head.n, w, h, pics: hit.parts.map(b => new Uint8Array(b)), count: hit.head.n.length, done: true };
    const idx = await keyIndex(path, { info, signal });
    const kv = await keysOnly(path, info, idx, 600, signal), out = await tempOut("keys.mjpg");
    const at = [], pics = [];
    let got = 0, rest = new Uint8Array(0), running = true;
    // complete JPEGs in what was written since the last read (each ends with FFD9)
    const pull = async () => {
      const buf = await invoke("framegrab_read", { path: out, start: got, end: got + (8 << 20) }).catch(() => null);
      if (!buf || !buf.byteLength) return false;
      got += buf.byteLength;
      const all = new Uint8Array(rest.length + buf.byteLength); all.set(rest); all.set(new Uint8Array(buf), rest.length);
      let start = 0;
      for (let i = 1; i < all.length; i++) if (all[i - 1] === 0xff && all[i] === 0xd9) {
        const jpg = all.slice(start, i + 1); start = i + 1;
        pics.push(jpg);
      }
      rest = all.slice(start);
      // a picture counts once FFmpeg has said which frame it is (its showinfo line)
      const count = Math.min(pics.length, at.length);
      partial({ n: at.slice(0, count).map(s => nOf(info, s)), w, h, pics: pics.slice(0, count), count, done: false });
      return true;
    };
    const poll = async () => { while (running && !signal.aborted) { await pull(); await new Promise(r => setTimeout(r, 200)); } };
    try {
      const reading = poll();
      const r = await ffmpeg(["-loglevel", "info", "-i", kv, "-an", "-sn", "-vf", `scale=${w}:${h}:flags=bicubic,showinfo`, "-fps_mode", "passthrough", "-q:v", "1", "-qmin", "1", "-f", "image2pipe", "-c:v", "mjpeg", "-y", out], timeLine(at), signal, true);
      running = false; await reading;
      if (r.code !== 0) throw new Error(r.lines.slice(-1)[0] || t("fg.err.frame"));
      while (await pull()) { /* the rest */ }
      const n = pics.map((p, i) => nOf(info, at[i] || 0));
      if (ck && pics.length) cachePut(ck, { frames: info.frames, n }, pics);
      return { n, w, h, pics, count: pics.length, done: true };
    } finally { running = false; drop([kv, out]); }
  });
}

// Frames from…from+count-1, exact, at preview size (o.w wide) as RGBA, decoded by one FFmpeg that seeks to the
// keyframe before `from` and decodes on (the frames before `from` are dropped); o.onFrame(n, rgba) as each arrives.
async function frames(path, from, count, o = {}) {
  const info = o.info || await probeVideo(path), w = Math.min(o.w || 1920, info.w), h = Math.max(2, Math.round(w * info.h / info.w / 2) * 2), fb = w * h * 4;
  from = Math.max(0, Math.min(info.frames - 1, Math.round(from))); count = Math.max(1, Math.min(count, info.frames - from));
  const out = await tempOut("frames.rgba"), vf = w < info.w ? ["-vf", `scale=${w}:${h}:flags=bicubic`] : [];
  let got = 0, k = 0, running = true;
  const pull = async () => {
    const buf = await invoke("framegrab_read", { path: out, start: got, end: got + fb }).catch(() => null);
    if (!buf || buf.byteLength < fb) return false;
    got += fb; o.onFrame(from + k++, new Uint8ClampedArray(buf), w, h);
    return true;
  };
  const poll = async () => { while (running && !(o.signal && o.signal.aborted)) { if (!await pull()) await new Promise(r => setTimeout(r, 15)); } };
  try {
    const reading = poll();
    const r = await ffmpeg(["-loglevel", "error", "-ss", seekOf(from, info.fps), "-i", path, "-an", "-sn", "-frames:v", String(count), ...vf, "-f", "rawvideo", "-pix_fmt", "rgba", "-y", out], null, o.signal);
    running = false; await reading;
    while (k < count && await pull()) { /* the rest */ }
    if (!k) {
      if (r.code === 0 && from > 0) return frames(path, from - 1, 1, o);   // past the last frame: the last one
      throw new Error(r.lines.slice(-1)[0] || t("fg.err.frame"));
    }
    return k;
  } finally { running = false; drop([out]); }
}

/* ---------- the strip and the candidates ---------- */
// One pass over every frame, AW wide, at most MAXS of them; FFmpeg writes them to a file that is read as it grows,
// so the strip, the sharpness and the scene changes fill in while it runs
const analyses = lru(3);
const AW = 192, MAXS = 240;   // width of the analysed frames; at most this many of them per video
function analyseVideo(path, o = {}) {
  return shared(analyses, path, o, async (signal, partial, progress) => {
    const info = o.info || await probeVideo(path), step = Math.max(1, Math.ceil(info.frames / MAXS));
    const w = AW, h = Math.max(2, Math.round(AW * info.h / info.w / 2) * 2), fb = w * h * 3, meta = await videoKey(path).catch(() => null);
    const ck = meta && `${meta.key}-an1`, hit = ck && await cacheGet(ck);
    if (hit && hit.head.frames === info.frames && hit.head.step === step && hit.head.w === w && hit.head.h === h) {
      const count = hit.head.count, an = { info, step, n: Array.from({ length: count }, (_, i) => Math.min(info.frames - 1, i * step)), w, h, rgb: new Uint8Array(hit.parts[0]), sharp: new Float32Array(hit.parts[1]), scene: new Float32Array(hit.parts[2]), count, done: true };
      progress(1);
      return an;
    }
    const cap = Math.ceil(info.frames / step) + 2, rgb = new Uint8Array(cap * fb), sharp = new Float32Array(cap), scene = new Float32Array(cap);
    const n = [], out = await tempOut("strip.rgb");
    let count = 0, got = 0, running = true, reading = null;
    const snapshot = done => ({ info, step, n: n.slice(), w, h, rgb: rgb.subarray(0, count * fb), sharp: sharp.subarray(0, count), scene: scene.subarray(0, count), count, done });
    // the frames written since the last read
    const pull = async () => {
      const buf = await invoke("framegrab_read", { path: out, start: got, end: got + 48 * fb }).catch(() => null);
      const whole = buf ? Math.min(cap - count, Math.floor(buf.byteLength / fb)) : 0;
      if (!whole) return false;
      rgb.set(new Uint8Array(buf, 0, whole * fb), count * fb);
      measure(rgb, w, h, count, count + whole, sharp, scene);
      for (let i = count; i < count + whole; i++) n.push(Math.min(info.frames - 1, i * step));
      count += whole; got += whole * fb;
      partial(snapshot(false));
      return true;
    };
    const poll = async () => { while (running && !signal.aborted) { await pull(); await new Promise(r => setTimeout(r, 250)); } };
    try {
      reading = poll();
      const { code, lines } = await ffmpeg(["-loglevel", "error", "-nostats", "-progress", "pipe:1", "-i", path, "-an", "-sn",
        "-vf", `select=not(mod(n\\,${step})),scale=${w}:${h}:flags=area`, "-fps_mode", "passthrough", "-f", "rawvideo", "-pix_fmt", "rgb24", "-y", out],
      (line, stream) => { const m = stream === "out" && /^frame=(\d+)/.exec(line); if (m) progress(Math.min(0.99, +m[1] * step / info.frames)); }, signal, true);
      running = false; await reading;
      if (code !== 0) throw new Error(lines.slice(-1)[0] || t("fg.err.frame"));
      while (await pull()) { /* the rest of the file */ }
      if (!count) throw new Error(t("fg.err.frame"));
      progress(1);
      const an = snapshot(true);
      if (ck) cachePut(ck, { frames: info.frames, step, w, h, count }, [an.rgb, an.sharp, an.scene]);
      return an;
    } finally { running = false; drop([out]); }
  });
}
// Per analysed frame from…to: sharpness (variance of the Laplacian of its luminance) and how different it is from
// the previous one (mean absolute difference of a 16-bin luminance histogram, 0…2)
function measure(rgb, w, h, from, to, sharp, scene) {
  const L = new Float32Array(w * h);
  const hist = f => { const o = f * w * h * 3, hs = new Float32Array(16); for (let i = 0; i < w * h; i++) { const y = 0.2126 * rgb[o + i * 3] + 0.7152 * rgb[o + i * 3 + 1] + 0.0722 * rgb[o + i * 3 + 2]; L[i] = y; hs[Math.min(15, y >> 4)]++; } for (let b = 0; b < 16; b++) hs[b] /= w * h; return hs; };
  let prev = from > 0 ? hist(from - 1) : null;
  for (let f = from; f < to; f++) {
    const hs = hist(f);
    let s = 0, s2 = 0, k = 0;
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, v = 4 * L[i] - L[i - 1] - L[i + 1] - L[i - w] - L[i + w];
      s += v; s2 += v * v; k++;
    }
    sharp[f] = k ? s2 / k - (s / k) ** 2 : 0;
    scene[f] = prev ? hs.reduce((a, v, b) => a + Math.abs(v - prev[b]), 0) : 0;
    prev = hs;
  }
}
// Where scenes change: a histogram jump well above the video's usual change
function sceneCut(scene, c = scene.length) {
  if (!c) return Infinity;
  let mean = 0; for (let i = 0; i < c; i++) mean += scene[i]; mean /= c;
  let v = 0; for (let i = 0; i < c; i++) v += (scene[i] - mean) ** 2;
  return Math.max(0.25, mean + 2.5 * Math.sqrt(v / c));
}
// The sharpest frame of each scene (a scene ends where the histogram jumps); more scenes than k: the ones whose best
// frame is sharpest; fewer: the sharpest frames of the longest scenes, kept apart, fill the rest
function candidates(an, k = 8) {
  const { sharp, scene, n } = an, c = an.count != null ? an.count : sharp.length;
  if (!c) return [];
  const cut = sceneCut(scene, c), scenes = [];
  let start = 0;
  for (let i = 1; i <= c; i++) if (i === c || scene[i] > cut) { scenes.push([start, i]); start = i; }
  const best = ([a, b]) => { let m = a; for (let i = a; i < b; i++) if (sharp[i] > sharp[m]) m = i; return m; };
  let pick = scenes.map(best).sort((a, b) => sharp[b] - sharp[a]).slice(0, k);
  const gap = Math.max(1, Math.floor(c / (k * 2)));
  for (const i of [...Array(c).keys()].sort((a, b) => sharp[b] - sharp[a])) {
    if (pick.length >= Math.min(k, c)) break;
    if (pick.every(p => Math.abs(p - i) >= gap)) pick.push(i);
  }
  return [...new Set(pick.map(i => n[i]))].sort((a, b) => a - b);
}

/* ---------- the round trip: another tab opens Frame Grab and gets the frames back ---------- */
// from: the tab that asked ("grade"…) or none (Library, Downloader: Frame Grab keeps the result);
// dest: the destination chosen when it opens; frame: the frame to start on. Resolves with
// [{ blob, n, time, w, h, path, dest }] once captured, or null if the user goes back without capturing.
async function frameGrab(o = {}) {
  if (!S.usable("framegrab")) return null;
  const fg = await ensureApp("framegrab");
  show("framegrab");
  const res = await fg.open(o);
  if (o.from && S.tabs().includes(o.from)) show(o.from);
  if (res && res.length && o.from) toast(t(res.length > 1 ? "fg.backMany" : "fg.backOne", { n: res.length, name: t("tab." + o.from) }));
  return res;
}

Object.assign(S, { videoPath, pickVideo, probeVideo, videoKey, readRange, frameAt, keyIndex, keyframes, keyPictures, frames, analyseVideo, candidates, sceneCut, frameGrab, parseProbe });
})();

/* ===== profile ===== */
// The artist profile (__hal.profile, docs/COVER_TEST_SPEC.md §4): for each link of Settings → Artist (YouTube,
// Spotify, SoundCloud) the name, avatar, banner, followers and latest releases, read by profile.js
// (window.__artist) and kept in Settings\Profile (profile.json + WebP images at the size each view shows them),
// plus the Cover Test's feed of platform content in Tools\cache\covertest. Reads are instant from disk; refresh()
// runs in the background, keeps the last good copy of a platform that fails and emits "profile" when done.
(() => {
"use strict";
const S = window.__shell;
const { invoke, emit, st } = S;
const A = window.__artist;
const PLATS = ["youtube", "spotify", "soundcloud"];
// Image sizes (§4.3): [width, height] cropped to fill, or [width, 0] to keep the ratio
const SIZE = { avatar: [176, 176], banner: [1280, 0], youtube: [336, 189], square: [336, 336], feedyoutube: [480, 270], feedsquare: [240, 240] };
const FEED_MAX_AGE = 24 * 3600e3;
const io = {
  text: (url, browser) => invoke("http_text", { url, browser: !!browser }),
  json: (url, browser) => invoke("http_text", { url, browser: !!browser }).then(JSON.parse)
};

/* ---------- files ---------- */
const urls = new Map();
const put = (area, name, bytes) => invoke("profile_file_put", bytes, { headers: { "x-area": area, "x-name": name } }).then(() => { const k = area + "/" + name, u = urls.get(k); if (u) { URL.revokeObjectURL(u); urls.delete(k); } });
// A cached image as a blob URL (same origin: the tool frames use it as it is); "" when missing
async function image(area, name) {
  if (!name) return "";
  const k = area + "/" + name;
  if (urls.has(k)) return urls.get(k);
  const b = await invoke("profile_file_get", { area, name }).catch(() => null);
  if (!b || !b.byteLength) return "";
  const u = URL.createObjectURL(new Blob([b], { type: "image/webp" }));
  urls.set(k, u);
  return u;
}
// Remote image → WebP at its view's size → the area; resolves with the file name, "" when it cannot be read
async function keep(area, name, url, size) {
  if (!url) return "";
  try {
    const bytes = await invoke("http_bytes", { url, browser: true });
    const bmp = await createImageBitmap(new Blob([bytes]));
    const [w0, h0] = size, sw = bmp.width, sh = bmp.height;
    const w = Math.min(w0, sw), h = h0 ? Math.round(w * h0 / w0) : Math.round(sh * w / sw);
    const s = h0 ? Math.max(w / sw, h / sh) : w / sw, cw = w / s, ch = h / s;
    // This canvas is only resized and encoded to disk, never presented. Keep it in CPU memory to avoid
    // a GPU readback competing with the live atmosphere while many profile images are prepared.
    const c = new OffscreenCanvas(w, h), x = c.getContext("2d", { willReadFrequently: true });
    x.imageSmoothingQuality = "high";
    x.drawImage(bmp, (sw - cw) / 2, (sh - ch) / 2, cw, ch, 0, 0, w, h);
    bmp.close();
    const blob = await c.convertToBlob({ type: "image/webp", quality: 0.82 });
    await put(area, name, new Uint8Array(await blob.arrayBuffer()));
    return name;
  } catch (e) { return ""; }
}
// At most n tasks at once
async function pool(tasks, n = 8) {
  const out = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, tasks.length) }, async () => { while (i < tasks.length) { const k = i++; out[k] = await tasks[k](); } }));
  return out;
}
const fileId = s => String(s || "").replace(/[^A-Za-z0-9_-]/g, "").slice(-40) || "x";

/* ---------- the profile ---------- */
let data = null, loading = null, running = null;
const SPOTIFY_PROFILE_PARSER_VERSION = 1, spotifyMigrationAttempted = new Set();
const blank = () => ({ v: 1, platforms: {} });
function load() {
  if (!loading) loading = invoke("profile_get").then(v => { data = v && typeof v === "object" && v.platforms ? v : blank(); }).catch(() => { data = blank(); });
  return loading;
}
const save = () => invoke("profile_set", { profile: data });
const links = () => { const l = (st.settings && st.settings.links) || {}; return Object.fromEntries(PLATS.filter(p => l[p]).map(p => [p, l[p]])); };
// what the profile keeps on disk; cv-0…2 are the Cover Test's covers
const every = () => [...Object.values(data.platforms).flatMap(p => [p.avatar, p.banner, p.manual && p.manual.avatar, ...(p.releases || []).map(r => r.image)]), "profile.json", "cv-0.webp", "cv-1.webp", "cv-2.webp"].filter(Boolean);

// The profile as the views use it: images as blob URLs, the manual name and avatar over the read ones; platforms
// without a link in Settings are left out
async function get() {
  await load();
  const out = { name: (st.settings && st.settings.artistName) || "", platforms: {} }, l = links();
  await Promise.all(Object.keys(l).map(async k => {
    const p = data.platforms[k];
    if (!p || p.link !== l[k]) { out.platforms[k] = { url: l[k], name: "", avatar: "", banner: "", followers: 0, releases: [], fetched: 0, error: "" }; return; }
    const m = p.manual || {};
    out.platforms[k] = {
      url: p.url || l[k], id: p.id, name: m.name || p.name || "", readName: p.name || "", followers: p.followers || 0, fetched: p.fetched || 0, error: p.error || "",
      ...(k === "spotify" ? { monthlyListeners: p.monthlyListeners ?? null, parserVersion: p.parserVersion } : {}),
      avatar: await image("profile", m.avatar || p.avatar), banner: await image("profile", p.banner),
      releases: await Promise.all((p.releases || []).map(async r => ({ ...r, image: await image("profile", r.image) })))
    };
  }));
  out.name = out.name || (Object.values(out.platforms).find(p => p.name) || {}).name || "";
  const spotify = data.platforms.spotify;
  if (spotify && spotify.link === l.spotify && !(spotify.parserVersion >= SPOTIFY_PROFILE_PARSER_VERSION) && !spotifyMigrationAttempted.has(l.spotify)) {
    spotifyMigrationAttempted.add(l.spotify);
    refresh(["spotify"]).catch(() => {});
  }
  return out;
}
// Reads the linked platforms again (all, or `only`), in the background; a platform that fails keeps its last copy
function refresh(only) {
  if (running) return running;
  const t0 = performance.now();
  running = (async () => {
    await load();
    const l = links(), todo = Object.keys(l).filter(k => !only || only.includes(k));
    await Promise.all(todo.map(async k => {
      const prev = data.platforms[k] && data.platforms[k].link === l[k] ? data.platforms[k] : null;
      try {
        const reader = k === "spotify" ? { ...io, spotifyMetrics: artistId => invoke("spotify_artist_metrics", { artistId }) } : io;
        const r = await A.extract(reader, l[k]), tag = k.slice(0, 2);
        const shape = k === "youtube" ? SIZE.youtube : SIZE.square;
        const [avatar, banner, ...imgs] = await pool([
          () => keep("profile", tag + "-avatar.webp", r.avatar, SIZE.avatar),
          () => keep("profile", tag + "-banner.webp", r.banner, SIZE.banner),
          ...r.releases.map(x => () => keep("profile", `${tag}-r-${fileId(x.id)}.webp`, x.image, shape))
        ]);
        data.platforms[k] = { link: l[k], url: r.url, id: r.id, name: r.name, avatar: avatar || (prev && prev.avatar) || "", banner: banner || (prev && prev.banner) || "",
          followers: r.followers, links: r.links, fetched: Date.now(), error: "", manual: (prev && prev.manual) || {},
          ...(k === "spotify" ? { monthlyListeners: r.monthlyListeners, parserVersion: SPOTIFY_PROFILE_PARSER_VERSION } : {}),
          releases: r.releases.map((x, i) => ({ id: x.id, title: x.title, url: x.url, image: imgs[i] || "", views: k === "spotify" ? x.views ?? null : x.views || 0, date: x.date || "", duration: x.duration || 0 })) };
      } catch (e) {
        data.platforms[k] = Object.assign(prev || { link: l[k], releases: [], manual: {} }, { error: String(e && e.message || e) });
      }
    }));
    for (const k of Object.keys(data.platforms)) if (!l[k] && !(data.platforms[k].manual && data.platforms[k].manual.avatar)) delete data.platforms[k];
    await save();
    const bytes = await invoke("profile_prune", { area: "profile", keep: every() }).catch(() => 0);
    const stats = { ms: Math.round(performance.now() - t0), bytes };
    emit("profile", stats);
    return stats;
  })().finally(() => { running = null; });
  return running;
}
// Manual name and avatar (§4.4): they win over what is read and survive a refresh; null puts back the read one
async function edit(platform, { name, avatar } = {}) {
  await load();
  const p = data.platforms[platform] = data.platforms[platform] || { link: links()[platform] || "", releases: [], manual: {} };
  p.manual = p.manual || {};
  if (name !== undefined) p.manual.name = name || null;
  if (avatar !== undefined) {
    if (avatar) {
      const bmp = await createImageBitmap(avatar), s = Math.min(bmp.width, bmp.height), c = new OffscreenCanvas(SIZE.avatar[0], SIZE.avatar[1]);
      c.getContext("2d").drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, c.width, c.height); bmp.close();
      const n = platform.slice(0, 2) + "-avatar-own.webp";
      await put("profile", n, new Uint8Array(await (await c.convertToBlob({ type: "image/webp", quality: 0.9 })).arrayBuffer()));
      p.manual.avatar = n;
    } else p.manual.avatar = null;
  }
  await save();
  emit("profile", {});
}
// Profiles for a name or a link on each platform (profile.js search): { source, name, candidates: { platform: [card] } }
const search = (text, skip) => A.search(io, text, skip);
// Same complete discovery route as Settings, including its existing web fallback.
const discover = name => S.findProfiles(name);
// Cover Test confirms the same Settings identity, then uses the existing profile cache.
async function confirm(candidate) {
  const link = A.parseLink(candidate.url);
  if (!link || link.platform !== candidate.platform) throw new Error("Invalid artist profile");
  if (running) await running;
  S.setSetting("artistName", String(candidate.name || "").trim());
  S.setSetting("links", { ...st.settings.links, [link.platform]: link.url });
  S.renderSettings();
  await refresh([link.platform]);
  return get();
}
// Remove the entire own identity from the shared Settings store and profile cache.
async function remove() {
  await load();
  if (running) await running;
  data = blank();
  await save();
  S.setSetting("artistName", "");
  S.setSetting("links", {});
  S.renderSettings();
  emit("profile", {});
  return get();
}
// The size of the profile on disk
const size = () => load().then(() => invoke("profile_prune", { area: "profile", keep: every() }));

/* ---------- the feed ---------- */
// Real content of a platform for a query (§5): cached for 24 h, the last copy when offline; { items, fetched, error }
// each platform's files start with its tag ("yo-", "sp-", "so-"): a platform refreshed prunes only its own
const tagOf = p => p.slice(0, 2);
const feedName = p => tagOf(p) + "-feed.json";
async function readFeed(platform) {
  const b = await invoke("profile_file_get", { area: "feed", name: feedName(platform) }).catch(() => null);
  try { return b && b.byteLength ? JSON.parse(new TextDecoder().decode(b)) : null; } catch (e) { return null; }
}
const feeding = new Map();
async function feed(platform, query, o = {}) {
  const f = await readFeed(platform);
  const same = f && f.query === query, fresh = same && Date.now() - f.fetched < FEED_MAX_AGE;
  const view = async x => x ? { query: x.query, fetched: x.fetched, error: x.error || "", items: await Promise.all(x.items.map(async i => ({ ...i, image: await image("feed", i.image), avatar: await image("feed", i.avatar) }))) } : null;
  if (fresh && !o.force) return view(f);
  const k = platform + "\n" + query;
  if (!feeding.has(k)) feeding.set(k, (async () => {
    try {
      const items = await A.feed(io, platform, query), tag = tagOf(platform), shape = platform === "youtube" ? SIZE.feedyoutube : SIZE.feedsquare;
      const avatars = new Map();
      const got = await pool(items.map(i => async () => {
        const image = await keep("feed", `${tag}-f-${fileId(i.id)}.webp`, i.image, shape);
        let avatar = "";
        if (i.avatar) { if (!avatars.has(i.avatar)) avatars.set(i.avatar, keep("feed", `${tag}-a-${fileId(i.avatar.split("/").slice(-2).join(""))}.webp`, i.avatar, [72, 72])); avatar = await avatars.get(i.avatar); }
        return image ? { ...i, image, avatar } : null;
      }));
      const out = { query, fetched: Date.now(), items: got.filter(Boolean) };
      if (!out.items.length) throw new Error("nothing found");
      await put("feed", feedName(platform), new TextEncoder().encode(JSON.stringify(out)));
      const keepList = [feedName(platform), ...out.items.flatMap(i => [i.image, i.avatar]).filter(Boolean)];
      await invoke("profile_prune", { area: "feed", keep: keepList, prefix: tag + "-" }).catch(() => {});
      return out;
    } catch (e) {
      // the last copy of this same search, else nothing (another search's content would mislead)
      return same ? { ...f, error: String(e && e.message || e) } : { query, fetched: 0, items: [], error: String(e && e.message || e) };
    } finally { feeding.delete(k); }
  })());
  const got = await feeding.get(k);
  return view(got);
}

/* ---------- references ---------- */
// Other artists as references (§5.1): for a link or a name, each platform's profile with its latest releases, in
// Tools\cache\covertest ("rf-<hash>…"), a week old at most; { text, name, fetched, error, platforms: { p: { url,
// name, avatar, followers, releases } } } with the images as blob URLs
const REF_MAX_AGE = 7 * 24 * 3600e3;
const YOUTUBE_REF_PARSER_VERSION = 1;
const hashOf = s => { let h = 2166136261; for (const c of String(s).trim().toLowerCase()) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0).toString(36); };
const refName = text => `rf-${hashOf(text)}.json`;
async function readRef(text) {
  const b = await invoke("profile_file_get", { area: "references", name: refName(text) }).catch(() => null);
  let bytes = b;
  if (!bytes?.byteLength) {
    bytes = await invoke("profile_file_get", { area: "feed", name: refName(text) }).catch(() => null);
    if (bytes?.byteLength) {
      const old = JSON.parse(new TextDecoder().decode(bytes));
      for (const name of Object.values(old.platforms || {}).flatMap(v => [v.avatar, ...(v.releases || []).map(r => r.image)]).filter(Boolean)) {
        const image = await invoke("profile_file_get", { area: "feed", name }).catch(() => null);
        if (image?.byteLength) await put("references", name, new Uint8Array(image));
      }
      await put("references", refName(text), new Uint8Array(bytes));
    }
  }
  try { return bytes?.byteLength ? JSON.parse(new TextDecoder().decode(bytes)) : null; } catch (e) { return null; }
}
const referring = new Map();
async function reference(text, o = {}) {
  text = String(text || "").trim();
  const f = await readRef(text);
  const view = async x => ({ ...x, platforms: Object.fromEntries(await Promise.all(Object.entries(x.platforms || {}).map(async ([p, v]) => [p, { ...v, avatar: await image("references", v.avatar),
    releases: await Promise.all(v.releases.map(async r => ({ ...r, image: await image("references", r.image) }))) }]))) });
  if (o.cacheOnly) return f ? view(f) : { text, name: "", platforms: {}, loading: true };
  const youtubeStale = !!(f && f.platforms && f.platforms.youtube && !(f.platforms.youtube.parserVersion >= YOUTUBE_REF_PARSER_VERSION));
  if (f && !f.error && Date.now() - f.fetched < REF_MAX_AGE && !o.force && !youtubeStale) return view(f);
  const k = refName(text);
  if (!referring.has(k)) referring.set(k, (async () => {
    try {
      // Migrate the cached YouTube channel directly, preserving the other platforms' reference data.
      const r = youtubeStale && !o.force ? { name: f.name, platforms: { youtube: await A.extract(io, f.platforms.youtube.url, 2) } } : await A.reference(io, text, 2);
      const h = hashOf(text), platforms = youtubeStale && !o.force ? { ...f.platforms } : {};
      await Promise.all(Object.entries(r.platforms).map(async ([p, x]) => {
        const tag = `rf-${h}-${tagOf(p)}`, shape = p === "youtube" ? SIZE.feedyoutube : SIZE.feedsquare;
        const [avatar, ...imgs] = await pool([() => keep("references", tag + "-a.webp", x.avatar, SIZE.avatar), ...x.releases.map((y, i) => () => keep("references", `${tag}-${i}.webp`, y.image, shape))]);
        platforms[p] = { url: x.url, name: x.name, avatar, followers: x.followers || 0,
          ...(p === "youtube" ? { parserVersion: YOUTUBE_REF_PARSER_VERSION } : {}),
          releases: x.releases.map((y, i) => ({ id: y.id, title: y.title, url: y.url, image: imgs[i] || "", views: y.views || 0, date: y.date || "", duration: y.duration || 0 })).filter(y => y.image) };
      }));
      const out = { text, name: r.name, fetched: Date.now(), error: "", platforms };
      await put("references", k, new TextEncoder().encode(JSON.stringify(out)));
      return out;
    } catch (e) {
      return f ? { ...f, error: String(e && e.message || e) } : { text, name: "", fetched: 0, platforms: {}, error: String(e && e.message || e) };
    } finally { referring.delete(k); }
  })());
  return view(await referring.get(k));
}
// Only the references in `texts` stay on disk
async function keepReferences(texts) {
  const keepList = [];
  for (const text of texts) {
    const f = await readRef(text);
    if (f) keepList.push(refName(text), ...Object.values(f.platforms || {}).flatMap(v => [v.avatar, ...v.releases.map(r => r.image)]).filter(Boolean));
  }
  await invoke("profile_prune", { area: "references", keep: keepList, prefix: "rf-" }).catch(() => {});
}

S.profile = { get, refresh, edit, search, discover, confirm, remove, size, feed, reference, keepReferences, image, PLATFORMS: PLATS };
})();
