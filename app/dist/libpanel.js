// The Library view (docs/LIBRARY_SPEC.md, docs/ARCHITECTURE.md → Shared services), one module for every place that
// shows it: the Library page of the main window and the picker the tools open. Search first (it has the focus;
// "/" or Ctrl+F bring it back), then type and tool chips, sort and view. Without a search or a filter the grid
// comes in three bands: Recent, Favourites and everything else; with one, one grid by relevance. The collections
// (favourites, own folders, virtual collections, folders of the PC, packs) are a column on the left, the detail of
// the item selected a column on the right. Every card has a box for a selection the bar above the grid acts on.
// The data: window.__hal.library (services.js → libdata).
//   mount(root, { mode: "page" | "picker", kinds, use(item) }) → { refresh, setTab, select }
(() => {
"use strict";
const HAL = () => window.__hal || (window.parent !== window && window.parent.__hal) || null;
const M = window.__motion, esc = window.__ui.esc, t = (k, v) => window.t(k, v), icon = n => window.__icons.icon(n);

const TYPE_CHIPS = ["image", "video", "audio", "font", "preset", "look"];
const TOOL_ICON = { visualizer: "audio-lines", grade: "palette", downloader: "download", upscale: "image-up",
  framegrab: "camera", interp: "gauge", removebg: "wand-sparkles", covertest: "gallery-horizontal-end" };
const KIND_ICON = { image: "image", video: "film", audio: "music", font: "type", look: "palette", "preset-visualizer": "audio-lines",
  preset: "sliders-horizontal" };
// where a double click opens an item: its tool, by kind
const OPEN_IN = { image: "grade", video: "framegrab", audio: "visualizer" };
const PAGE = 120;
const store = { get(k, d) { try { const v = localStorage.getItem("hal.lib." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("hal.lib." + k, JSON.stringify(v)); } catch (e) { /* per viewer only */ } } };
// the view and the sort are kept; the tab and the collections column are interface state, not kept (DECISIONS: reopening)
try { localStorage.removeItem("hal.lib.tab"); localStorage.removeItem("hal.lib.cols"); } catch (e) {}

function mount(root, o = {}) {
  const H = window.__shell || HAL(), lib = H.library, picker = o.mode === "picker";
  const st = { tab: "all", q: "", types: new Set(), tools: new Set(), sort: picker ? "recent" : store.get("sort", "newest"),
    view: store.get("view", "grid"), col: null, sel: null, picked: new Set(), shown: PAGE, colsOpen: null };
  let secs = [], gen = 0, cards = new Map();   // id → item shown
  root.classList.add("libv", "libv-" + (picker ? "picker" : "page"));
  root.innerHTML = `
    <div class="libv-top">
      <label class="libv-search"><span class="i" data-icon="search"></span><input type="search" class="libv-q" placeholder="${esc(t("lib.searchAll"))}" aria-label="${esc(t("lib.searchAll"))}"></label>
      <select class="libv-sort" aria-label="${esc(t("lib.sort"))}">${["newest", "recent", "used", "name"].map(s => `<option value="${s}">${esc(t("lib.sort." + s))}</option>`).join("")}</select>
      <div class="libv-views tabs" role="tablist" aria-label="${esc(t("lib.view"))}"><button class="tab icon" role="tab" data-view="grid" title="${esc(t("lib.view.grid"))}" aria-label="${esc(t("lib.view.grid"))}"><span class="i" data-icon="layout-grid"></span></button><button class="tab icon" role="tab" data-view="list" title="${esc(t("lib.view.list"))}" aria-label="${esc(t("lib.view.list"))}"><span class="i" data-icon="list"></span></button></div>
    </div>
    <div class="libv-filters"><div class="chips libv-types" aria-label="${esc(t("lib.type"))}"></div><div class="chips libv-tools" aria-label="${esc(t("lib.tool"))}"></div></div>
    <div class="libv-body">
      <aside class="libv-cols" aria-label="${esc(t("lib.collections"))}"><div class="libv-cols-h"><b>${esc(t("lib.collections"))}</b><button class="btn sm ghost icon libv-fold" data-icon="panel-left-close" title="${esc(t("lib.hideCols"))}" aria-label="${esc(t("lib.hideCols"))}"></button></div><div class="libv-colist" role="listbox"></div>
        <div class="libv-colacts"><button class="btn sm ghost" data-lv="newcol" data-icon="plus"><span>${esc(t("lib.newCollection"))}</span></button><button class="btn sm ghost" data-lv="link" data-icon="folder-plus"><span>${esc(t("lib.linkFolder"))}</span></button><button class="btn sm ghost" data-lv="packs" data-icon="package"><span>${esc(t("set.packs"))}</span></button></div></aside>
      <div class="libv-main">
        <div class="libv-selbar" hidden><span class="libv-selcount"></span><button class="btn sm ghost" data-sel="all" data-icon="check"><span>${esc(t("common.selectAll"))}</span></button><button class="btn sm ghost" data-sel="none" data-icon="x"><span>${esc(t("common.selectNone"))}</span></button><span class="sp"></span><button class="btn sm ghost icon" data-sel="fav" data-icon="star" title="${esc(t("lib.fav"))}" aria-label="${esc(t("lib.fav"))}"></button><button class="btn sm ghost" data-sel="tags" data-icon="tag"><span>${esc(t("lib.tags"))}</span></button><button class="btn sm ghost" data-sel="addto" data-icon="folder-input"><span>${esc(t("lib.addTo"))}</span></button><button class="btn sm ghost" data-sel="send" data-icon="send"><span>${esc(t("send.to"))}</span></button><button class="btn sm primary" data-sel="cut" data-icon="scissors" hidden><span class="libv-cuttext"></span></button><button class="btn sm ghost warn" data-sel="remove" data-icon="eye-off"><span>${esc(t("lib.forget"))}</span></button></div>
        <div class="libv-colhead" hidden><button class="btn sm ghost icon libv-unfold" data-icon="panel-left-open" title="${esc(t("lib.showCols"))}" aria-label="${esc(t("lib.showCols"))}"></button><b class="libv-coltitle"></b><button class="btn sm ghost" data-lv="allcols" data-icon="x"><span>${esc(t("lib.allItems"))}</span></button></div>
        <div class="libv-grid" role="list"></div>
      </div>
      <aside class="libv-detail" aria-live="polite" hidden></aside>
    </div>
    <div class="menu libv-menu" role="menu" hidden></div>`;
  window.__icons.apply(root);
  const $ = s => root.querySelector(s), grid = $(".libv-grid"), menu = $(".libv-menu"), detail = $(".libv-detail"), qIn = $(".libv-q");
  M.segmented($(".libv-views"));

  /* ---------- what is shown ---------- */
  const filtered = () => st.types.size || st.tools.size || st.q || st.col;
  function queryOf(extra = {}) {
    const types = lib.TYPE_OF_TAB[st.tab] || null;
    const kinds = o.kinds || (st.types.size ? [...st.types] : null);
    return { text: st.q, types, kinds, tools: st.tools.size ? [...st.tools] : null, collection: st.col, sort: st.q && st.sort === "newest" ? "relevance" : st.sort, ...extra };
  }
  const when = ms => {
    if (!ms) return "";
    const d = Date.now() - ms, m = Math.round(d / 6e4);
    if (m < 1) return t("lib.ago.now");
    if (m < 60) return t("lib.ago.min", { n: m });
    if (m < 60 * 24) return t("lib.ago.h", { n: Math.round(m / 60) });
    return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short", year: d > 3e10 ? "numeric" : undefined });
  };
  const size = b => !b ? "" : b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + " KB" : (b / 1048576).toFixed(b < 1e8 ? 1 : 0) + " MB";
  const kindLabel = i => t("lib.k." + i.kind);
  // a preset or a look is shown by its name, without ".json"
  const nameOf = i => i.type === "preset" || i.type === "look" ? i.name.replace(/\.json$/i, "") : i.name;
  function card(i) {
    const tool = i.origin && i.origin.tool, picked = st.picked.has(i.id), sel = st.sel === i.id;
    const thumbable = !i.missing && (i.kind === "image" || i.kind === "video" || i.kind === "look");
    return `<div class="libv-card${i.missing ? " missing" : ""}${picked ? " picked" : ""}${sel ? " sel" : ""}" role="listitem" data-key="${esc(i.id)}" data-id="${esc(i.id)}" tabindex="-1">`
      + (picker ? "" : `<label class="libv-pick" title="${esc(t("lib.pick"))}"><input type="checkbox"${picked ? " checked" : ""} aria-label="${esc(t("lib.pickOne", { name: nameOf(i) }))}"></label>`)
      + `<button class="libv-th${thumbable ? " skel" : ""}" data-open aria-label="${esc(nameOf(i))}" title="${esc(i.path)}">${thumbable ? '<img alt="" hidden draggable="false">' : `<span class="libv-ico">${icon(KIND_ICON[i.kind] || "file")}</span>`}`
      + `<span class="libv-badge">${esc(kindLabel(i))}</span>${tool && TOOL_ICON[tool] ? `<span class="libv-from" title="${esc(t("lib.from", { tool: t("tab." + tool) }))}">${icon(TOOL_ICON[tool])}</span>` : ""}${i.missing ? `<span class="libv-miss">${esc(t("lib.missingItem"))}</span>` : ""}</button>`
      + `<div class="libv-meta"><b title="${esc(nameOf(i))}">${esc(nameOf(i))}</b><small>${esc(i.missing ? t("lib.missingItem") : when(lib.recentAt(i)))}</small>`
      + `<button class="libv-star${i.fav ? " on" : ""}" data-star aria-pressed="${i.fav}" title="${esc(t(i.fav ? "lib.unfav" : "lib.fav"))}" aria-label="${esc(t("lib.fav"))}">${icon("star")}</button></div></div>`;
  }
  function band(key, title, items, total, more) {
    return `<section class="libv-band" data-band="${key}"><div class="libv-band-h"><h3>${esc(title)}</h3>${total != null ? `<span class="n">${total}</span>` : ""}${more ? `<button class="btn sm ghost libv-more" data-more="${key}">${esc(t("lib.seeAll"))}<span class="i" data-icon="arrow-right"></span></button>` : ""}</div>`
      + `<div class="libv-cards${st.view === "list" ? " list" : ""}" role="list">${items.map(card).join("")}</div></section>`;
  }
  function render() {
    const g = ++gen;
    cards = new Map();
    let html = "";
    const bands = !picker && !filtered() && st.tab === "all" && st.sort === "newest";
    if (bands) {
      const recent = lib.query({ sort: "recent", limit: lib.RECENT_BAND }), favs = lib.query({ fav: true, sort: "recent", limit: 12 });
      const all = lib.query(queryOf({ limit: st.shown }));
      for (const i of [...recent.items, ...favs.items, ...all.items]) cards.set(i.id, i);
      if (!all.total) html = `<p class="libv-empty">${esc(t("lib.emptyAll"))}</p>`;
      else html = band("recent", t("lib.recent"), recent.items, null, recent.total > 0)
        + (favs.total ? band("fav", t("lib.favorites"), favs.items, favs.total, favs.total > 12) : "")
        + band("all", t("lib.allItems"), all.items, all.total) + (all.total > st.shown ? `<div class="libv-sentinel"></div>` : "");
    } else {
      const r = lib.query(queryOf({ limit: st.shown }));
      for (const i of r.items) cards.set(i.id, i);
      if (!r.total) html = `<p class="libv-empty">${esc(t(st.q || filtered() ? "lib.noMatch" : st.tab === "exports" ? "lib.noExports" : st.tab === "presets" ? "lib.noPresetsAll" : "lib.empty"))}</p>`;
      else if (st.tab === "exports" && !st.q && st.sort === "newest") {
        // exports grouped by day
        const days = new Map();
        for (const i of r.items) { const k = new Date(i.mtime || i.addedAt).toDateString(); if (!days.has(k)) days.set(k, []); days.get(k).push(i); }
        html = [...days].map(([k, its]) => band("d" + k.replace(/\W/g, ""), dayTitle(new Date(k)), its, its.length)).join("");
      } else html = band("results", st.q ? t("lib.results") : st.sort === "recent" ? t("lib.recent") : t("lib.allItems"), r.items, r.total);
      if (r.total > st.shown) html += `<div class="libv-sentinel"></div>`;
    }
    M.list(grid, () => { grid.innerHTML = html; window.__icons.apply(grid); }, { sel: ".libv-card", key: el => el.dataset.key + "|" + (el.closest(".libv-band") || {}).dataset?.band });
    for (const el of grid.querySelectorAll(".libv-card")) seen.observe(el);
    const s = grid.querySelector(".libv-sentinel"); if (s) more.observe(s);
    paintSel();
    if (st.sel && !lib.get(st.sel)) showDetail(null);
    return g;
  }
  const dayTitle = d => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const n = Math.round((today - new Date(d).setHours(0, 0, 0, 0)) / 864e5);
    return n === 0 ? t("lib.today") : n === 1 ? t("lib.yesterday") : d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
  };
  // thumbnails load as their cards come into view (skeletons until then)
  const seen = new IntersectionObserver(es => {
    for (const e of es) {
      if (!e.isIntersecting) continue;
      seen.unobserve(e.target);
      const i = cards.get(e.target.dataset.id), btn = e.target.querySelector(".libv-th"), img = btn && btn.querySelector("img");
      if (!i || !img) continue;
      lib.thumb(i).then(u => { img.src = u; img.hidden = false; M.skeleton(btn, false); M.fadeIn(img, { dur: "fade" }); },
        () => { M.skeleton(btn, false); img.remove(); btn.insertAdjacentHTML("afterbegin", `<span class="libv-ico">${icon(KIND_ICON[i.kind] || "file")}</span>`); });
    }
  }, { root: null, rootMargin: "200px" });
  const more = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { st.shown += PAGE; render(); } }, { rootMargin: "400px" });

  /* ---------- chips, sort, view ---------- */
  function paintChips() {
    const kinds = o.kinds ? [] : TYPE_CHIPS;
    $(".libv-types").innerHTML = kinds.map(k => `<button class="chip" data-type="${k}" aria-pressed="${st.types.has(k)}">${esc(t("lib.k." + k))}</button>`).join("");
    const tools = [...new Set(lib.query({}).items.map(i => i.origin.tool).filter(x => x && TOOL_ICON[x]))].sort();
    $(".libv-tools").innerHTML = tools.map(k => `<button class="chip" data-tool="${k}" aria-pressed="${st.tools.has(k)}"><span class="i" data-icon="${TOOL_ICON[k]}"></span>${esc(t("tab." + k))}</button>`).join("");
    window.__icons.apply($(".libv-tools"));
    $(".libv-sort").value = st.sort;
    for (const b of root.querySelectorAll(".libv-views [data-view]")) b.setAttribute("aria-selected", String(b.dataset.view === st.view));
  }

  /* ---------- collections ---------- */
  async function paintCols() {
    secs = await lib.collections().catch(() => []);
    const groups = [["", secs.filter(s => s.kind === "fav")], [t("lib.mine"), secs.filter(s => s.kind === "own" || s.kind === "virtual")], [t("lib.onPc"), secs.filter(s => s.kind === "link")], [t("lib.packs"), secs.filter(s => s.kind === "pack")]];
    $(".libv-colist").innerHTML = groups.filter(g => g[1].length).map(([h, list]) => (h ? `<div class="libv-colgrp">${esc(h)}</div>` : "")
      + list.map(s => `<button class="libv-col${s.missing ? " missing" : ""}" role="option" data-col="${esc(s.key)}" aria-selected="${s.key === st.col}" title="${esc(s.missing ? t("lib.missing") : s.path || s.name)}"><span class="i" data-icon="${s.kind === "fav" ? "star" : s.kind === "link" ? "folder-symlink" : s.kind === "pack" ? "package" : s.kind === "virtual" ? "layers" : "folder"}"></span><span class="nm">${esc(s.name)}</span><small>${s.missing ? esc(t("lib.missingShort")) : s.count || ""}</small></button>`).join("")).join("");
    window.__icons.apply($(".libv-colist"));
    paintColHead();
  }
  function paintColHead() {
    const s = secs.find(x => x.key === st.col);
    $(".libv-colhead").hidden = !s && !root.classList.contains("cols-folded");
    $(".libv-coltitle").textContent = s ? s.name : "";
    $('[data-lv="allcols"]').hidden = !s;
  }
  function foldCols(on, remember) {
    root.classList.toggle("cols-folded", on);
    if (remember) st.colsOpen = !on;   // for this run only, like the tab: both start at their defaults
    paintColHead();
  }
  const wide = () => root.getBoundingClientRect().width >= 1100 - 64;
  const ro = new ResizeObserver(() => { if (!picker && st.colsOpen == null) foldCols(!wide(), false); });
  if (!picker) { ro.observe(root); foldCols(st.colsOpen == null ? !wide() : !st.colsOpen, false); }

  /* ---------- detail ---------- */
  function showDetail(id) {
    st.sel = id;
    for (const c of grid.querySelectorAll(".libv-card")) c.classList.toggle("sel", c.dataset.id === id);
    const i = id && lib.get(id);
    if (picker || !i) { if (!detail.hidden) M.reveal(detail, false); root.classList.remove("detailing"); return; }
    const from = (i.origin.from || []).map(x => lib.get(x)).filter(Boolean);
    const used = Object.entries(i.usedIn || {}).sort((a, b) => b[1] - a[1]);
    const dims = i.meta && i.meta.w ? `${i.meta.w}×${i.meta.h}` : "";
    const isPreset = i.type === "preset" || i.type === "look", media = i.kind === "image" || i.kind === "video" || i.kind === "audio";
    const acts = [];
    if (i.missing) acts.push(`<button class="btn sm primary" data-d="locate" data-icon="locate"><span>${esc(t("lib.locate"))}</span></button>`);
    else if (isPreset) acts.push(`<button class="btn sm primary" data-d="apply" data-icon="check"><span>${esc(t("lib.act.apply"))}</span></button>`);
    else if (OPEN_IN[i.kind]) acts.push(`<button class="btn sm primary" data-d="open" data-icon="square-arrow-out-up-right"><span>${esc(t("lib.openIn", { tool: t("tab." + OPEN_IN[i.kind]) }))}</span></button>`);
    if (!i.missing && media) acts.push(`<button class="btn sm" data-d="send" data-icon="send" aria-haspopup="menu"><span>${esc(t("send.to"))}</span></button>`);
    const more = [];
    if (!i.missing) more.push(["reveal", "folder-open", t("common.reveal")]);
    if (!i.missing && i.kind === "image") more.push(["crop", "crop", t("lib.cropCopy")], ["cutout", "scissors", t("lib.addCutout")]);
    if (isPreset && !i.missing) more.push(["rename", "pencil", t("lib.act.rename")], ["dup", "copy", t("lib.act.dup")], ["del", "trash-2", t("lib.act.del")]);
    more.push(["remove", "eye-off", t("lib.forgetOne")]);
    detail.innerHTML = `<div class="libv-d-th${i.missing ? " missing" : ""}"><span class="libv-ico">${icon(KIND_ICON[i.kind] || "file")}</span><img alt="" hidden></div>
      <div class="libv-d-h"><b title="${esc(i.path)}">${esc(nameOf(i))}</b><button class="libv-star${i.fav ? " on" : ""}" data-d="fav" aria-pressed="${i.fav}" title="${esc(t(i.fav ? "lib.unfav" : "lib.fav"))}" aria-label="${esc(t("lib.fav"))}">${icon("star")}</button></div>
      <p class="libv-d-sub">${esc([kindLabel(i), size(i.size), dims].filter(Boolean).join(" · "))}</p>
      ${i.missing ? `<p class="libv-d-miss">${esc(t("lib.missingNote"))}</p>` : ""}
      <dl class="libv-d-dl">
        <dt>${esc(t("lib.d.from"))}</dt><dd>${esc(i.origin.tool ? t("tab." + i.origin.tool) : t(i.type === "download" ? "tab.downloader" : "lib.d.added"))} · ${esc(when(i.addedAt))}</dd>
        ${from.length ? `<dt>${esc(t("lib.d.madeFrom"))}</dt><dd>${from.map(f => `<button class="lnk" data-goto="${esc(f.id)}">${esc(f.name)}</button>`).join(", ")}</dd>` : ""}
        <dt>${esc(t("lib.d.usedIn"))}</dt><dd>${used.length ? used.map(([k, n]) => esc(t("tab." + k)) + (n > 1 ? " ×" + n : "")).join(", ") : esc(t("lib.d.notUsed"))}</dd>
        <dt>${esc(t("lib.d.where"))}</dt><dd class="path" title="${esc(i.path)}">${esc(i.path)}</dd>
      </dl>
      <div class="libv-d-tags">${i.tags.map(x => `<span class="libv-tag">#${esc(x)}</span>`).join("")}<button class="btn sm ghost" data-d="tags" data-icon="tag"><span>${esc(t(i.tags.length ? "lib.editTags" : "lib.addTags"))}</span></button></div>
      <div class="libv-d-acts">${acts.join("")}<button class="btn sm ghost icon" data-d="more" data-icon="ellipsis" title="${esc(t("lib.more"))}" aria-label="${esc(t("lib.more"))}" aria-haspopup="menu"></button></div>`;
    detail.__more = more;
    window.__icons.apply(detail);
    if (detail.hidden) { M.reveal(detail, true); M.enter(detail); }
    root.classList.add("detailing");
    if (!i.missing && (i.kind === "image" || i.kind === "video" || i.kind === "look")) {
      const img = detail.querySelector("img"), box = detail.querySelector(".libv-d-th");
      M.skeleton(box, true);
      lib.thumb(i).then(u => { if (st.sel !== i.id) return; img.src = u; img.hidden = false; box.querySelector(".libv-ico").remove(); M.skeleton(box, false); M.fadeIn(img, { dur: "fade" }); }, () => M.skeleton(box, false));
    }
  }

  /* ---------- actions ---------- */
  const toast = s => H.toast(s);
  const errOf = e => String(e && e.message || e);
  async function openItem(i, how) {
    lib.touch(i.id, how);
    await H.sendTo(how, { kind: i.kind, name: i.name, path: i.path, libraryId: i.id });
  }
  async function applyPreset(i) {
    const stem = i.name.replace(/\.json$/i, "");
    if (i.kind === "look") await H.presetAction("grade", "apply", stem);
    else if (i.kind === "preset-visualizer") await H.presetAction("visualizer", "apply", stem);
    else return;
    lib.touch(i.id, i.kind === "look" ? "grade" : "visualizer");
  }
  async function act(a, i, from) {
    try {
      if (a === "fav") await lib.setFav([i.id], !i.fav);
      else if (a === "open" && OPEN_IN[i.kind]) await openItem(i, OPEN_IN[i.kind]);
      else if (a === "apply") await applyPreset(i);
      else if (a === "send") window.__ui.openSend(from, { kind: i.kind, from: "library", item: () => { lib.touch(i.id); return { path: i.path, name: i.name, libraryId: i.id }; } });
      else if (a === "reveal") await H.invoke("reveal_path", { path: i.path });
      else if (a === "tags") { const v = await H.ask({ title: t("lib.tagsFor", { name: i.name }), text: t("lib.tagsNote"), input: i.tags.join(", ") }); if (v != null) await lib.setTagsOf([i.id], v.split(/[,#\s]+/)); }
      else if (a === "crop" || a === "cutout") { const p = await (H.imageVersion ? H.imageVersion(a, i, from) : lib.version(i, a, from)); if (p) toast(t("lib.versionSaved", { name: p.split(/[\\/]/).pop() })); }
      else if (a === "locate") { if (await lib.locate(i.id)) toast(t("lib.located", { name: i.name })); }
      else if (a === "remove") await removeItems([i]);
      else if (["rename", "dup", "del"].includes(a)) await H.presetAction(i.kind === "look" ? "grade" : i.kind === "preset-visualizer" ? "visualizer" : i.kind, a, i.name.replace(/\.json$/i, ""));
    } catch (e) { toast(errOf(e)); }
  }
  // off the Library; an item of an own collection may also go from the disk (asked)
  async function removeItems(its) {
    const own = its.filter(i => i.collections.some(c => c.startsWith("own:")));
    let deleteFile = false;
    if (own.length) {
      const r = await H.ask({ title: t(its.length === 1 ? "lib.removeItem" : "lib.removeItems", { name: its[0].name, n: its.length }), text: t("lib.removeOwnNote", { n: own.length }), okLabel: t("lib.forget"), altLabel: t("lib.deleteFiles"), danger: true });
      if (!r) return;
      deleteFile = r === "alt";
    }
    await lib.remove(its.map(i => i.id), { deleteFile });
    for (const i of its) st.picked.delete(i.id);
    toast(t("lib.forgotten", { n: its.length }));
  }
  function openMenu(html, at) {
    menu.innerHTML = html; window.__icons.apply(menu);
    menu.hidden = false;
    const w = menu.offsetWidth, h = menu.offsetHeight;
    menu.style.left = Math.max(4, Math.min(at.x, innerWidth - w - 8)) + "px"; menu.style.top = Math.max(4, Math.min(at.y, innerHeight - h - 8)) + "px";
    M.openPopover(menu, at);
  }
  const closeMenu = () => { if (!menu.hidden) M.closePopover(menu); };
  const mi = (a, ic, label, o2 = {}) => `<button role="menuitem" data-mi="${a}"${o2.warn ? ' class="warn"' : ""}${o2.data ? ` data-arg="${esc(o2.data)}"` : ""}><span class="i" data-icon="${ic}"></span>${esc(label)}</button>`;
  let target = null;
  function itemMenu(i, at, from) {
    target = { i, from };
    const acts = [];
    if (i.type === "preset" || i.type === "look") acts.push(mi("apply", "check", t("lib.act.apply")));
    else if (OPEN_IN[i.kind] && !i.missing) acts.push(mi("open", "square-arrow-out-up-right", t("lib.openIn", { tool: t("tab." + OPEN_IN[i.kind]) })));
    acts.push(mi("fav", "star", t(i.fav ? "lib.unfav" : "lib.fav")), mi("tags", "tag", t("lib.tags")));
    if (i.missing) acts.push(mi("locate", "locate", t("lib.locate")));
    else acts.push(mi("reveal", "folder-open", t("common.reveal")));
    if (!i.missing && i.kind === "image") acts.push(mi("crop", "crop", t("lib.cropCopy")), mi("cutout", "scissors", t("lib.addCutout")));
    if (!i.missing && (i.type === "preset" || i.type === "look")) acts.push(mi("rename", "pencil", t("lib.act.rename")), mi("dup", "copy", t("lib.act.dup")));
    openMenu(acts.join("") + "<hr>" + ((i.type === "preset" || i.type === "look") && !i.missing ? mi("del", "trash-2", t("lib.act.del"), { warn: true }) : "") + mi("remove", "eye-off", t("lib.forgetOne"), { warn: true }), at);
  }
  function colMenu(s, at) {
    target = { s };
    if (s.kind === "own" || s.kind === "virtual") openMenu(mi("rename", "pencil", t("lib.act.rename")) + mi("delcol", "trash-2", t("lib.act.del"), { warn: true }), at);
    else if (s.kind === "link") openMenu(mi("rename", "pencil", t("lib.act.rename")) + mi("unlink", "unlink", t("lib.unlink"), { warn: true }), at);
  }
  async function addToMenu(at) {
    target = { addTo: true };
    const cols = secs.filter(s => s.kind === "own" || s.kind === "virtual" || s.kind === "fav");
    openMenu(cols.map(s => mi("addto", s.kind === "fav" ? "star" : s.kind === "virtual" ? "layers" : "folder", s.name, { data: s.key })).join("") + "<hr>" + mi("addnew", "plus", t("lib.newCollection")), at);
  }
  menu.addEventListener("click", async e => {
    const b = e.target.closest("[data-mi]"); if (!b || !target) return;
    closeMenu();
    const { i, s, from } = target, a = b.dataset.mi;
    try {
      if (i) return await act(a, i, from);
      if (a === "rename") { const n = await H.ask({ title: t("lib.act.rename"), input: s.name, validate: v => !v ? t("lib.nameEmpty") : "" }); if (n) await lib.renameCollection(s.key, n); }
      else if (a === "delcol") {
        const ok = s.kind === "virtual" || await H.ask({ title: t("lib.deleteSection", { name: s.name }), text: t("lib.deleteSectionNote", { n: s.count }), okLabel: t("lib.act.del"), danger: true });
        if (ok) { await lib.removeCollection(s.key); if (st.col === s.key) st.col = null; }
      } else if (a === "unlink") { await lib.removeCollection(s.key); if (st.col === s.key) st.col = null; }
      else if (a === "addto" || a === "addnew") {
        const key = a === "addnew" ? await newCollection() : b.dataset.arg; if (!key) return;
        const its = [...st.picked].map(id => lib.get(id)).filter(Boolean), sec = secs.find(x => x.key === key);
        let how = "reference";
        if (sec && sec.kind === "own" && its.some(x => !x.collections.some(c => c.startsWith("own:")))) {
          const r = await H.ask({ title: t("lib.addToTitle", { name: sec.name }), text: t("lib.addToOwn"), okLabel: t("lib.how.reference"), altLabel: t("lib.how.copy") });
          if (!r) return; how = r === "alt" ? "copy" : "reference";
        }
        await lib.addTo(key, its.map(x => x.id), { how });
        toast(t("lib.addedTo", { n: its.length, name: sec ? sec.name : "" }));
      }
    } catch (err) { toast(errOf(err)); }
  });
  document.addEventListener("pointerdown", e => { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); }, true);
  async function newCollection() {
    const n = await H.ask({ title: t("lib.newCollection"), text: t("lib.newCollectionNote"), input: "", validate: v => !v ? t("lib.nameEmpty") : "" });
    return n ? lib.createCollection(n, "virtual") : null;
  }

  /* ---------- selection ---------- */
  function paintSel() {
    if (picker) return;
    for (const id of [...st.picked]) if (!lib.get(id)) st.picked.delete(id);
    const n = st.picked.size, its = [...st.picked].map(id => lib.get(id)).filter(Boolean), imgs = its.filter(i => i.kind === "image" && !i.missing).length;
    const bar = $(".libv-selbar");
    if (!!n === bar.hidden) M.reveal(bar, !!n);
    $(".libv-selcount").textContent = n ? t("lib.selected", { n }) : "";
    const shown = [...grid.querySelectorAll(".libv-card")].map(c => c.dataset.id);
    $('[data-sel="all"]').hidden = !shown.length || shown.every(id => st.picked.has(id));
    const cut = $('[data-sel="cut"]'); cut.hidden = !imgs; if (imgs) $(".libv-cuttext").textContent = t("lib.cutPicked", { n: imgs });
    const kinds = new Set(its.map(i => i.kind)); $('[data-sel="send"]').hidden = !(its.length === 1 && ["image", "video", "audio"].includes(its[0].kind) && !its[0].missing) || kinds.size !== 1;
    grid.classList.toggle("selecting", n > 0);
    for (const c of grid.querySelectorAll(".libv-card")) { const on = st.picked.has(c.dataset.id); c.classList.toggle("picked", on); const box = c.querySelector(".libv-pick input"); if (box) box.checked = on; }
  }
  $(".libv-selbar").addEventListener("click", async e => {
    const b = e.target.closest("[data-sel]"); if (!b) return;
    const its = [...st.picked].map(id => lib.get(id)).filter(Boolean);
    try {
      if (b.dataset.sel === "all") { for (const c of grid.querySelectorAll(".libv-card")) st.picked.add(c.dataset.id); }
      else if (b.dataset.sel === "none") st.picked.clear();
      else if (b.dataset.sel === "fav") await lib.setFav(its.map(i => i.id), !its.every(i => i.fav));
      else if (b.dataset.sel === "tags") { const v = await H.ask({ title: t("lib.tagsForN", { n: its.length }), text: t("lib.tagsNote"), input: [...new Set(its.flatMap(i => i.tags))].join(", ") }); if (v != null) await lib.setTagsOf(its.map(i => i.id), v.split(/[,#\s]+/)); }
      else if (b.dataset.sel === "addto") { const r = b.getBoundingClientRect(); addToMenu({ x: r.left, y: r.bottom + 6 }); return; }
      else if (b.dataset.sel === "send") return act("send", its[0], b);
      else if (b.dataset.sel === "cut") { const files = its.filter(i => i.kind === "image" && !i.missing).map(i => ({ path: i.path, name: i.name })); if (files.length && await H.cutoutBatch(files)) st.picked.clear(); }
      else if (b.dataset.sel === "remove") return removeItems(its);
    } catch (err) { toast(errOf(err)); }
    paintSel();
  });

  /* ---------- clicks, keys, search ---------- */
  root.addEventListener("click", async e => {
    const lv = e.target.closest("[data-lv]");
    if (lv) {
      const a = lv.dataset.lv;
      if (a === "newcol") { const k = await newCollection().catch(err => toast(errOf(err))); if (k) { st.col = k; await paintCols(); render(); } }
      else if (a === "link") { const k = await lib.linkFolder().catch(err => toast(errOf(err))); if (k) { st.col = k; await paintCols(); render(); } }
      else if (a === "allcols") { st.col = null; paintCols(); render(); }
      else if (a === "packs") { const d = document.getElementById("packsDlg"); if (d) { M.dialog(d); if (H.renderPacks) H.renderPacks(); d.showFrom(lv); } }
      return;
    }
    if (e.target.closest(".libv-fold")) { foldCols(true, true); return; }
    if (e.target.closest(".libv-unfold")) { foldCols(false, true); return; }
    const col = e.target.closest("[data-col]");
    if (col && !moved) { st.col = st.col === col.dataset.col ? null : col.dataset.col; st.shown = PAGE; paintCols(); render(); return; }
    const chip = e.target.closest("[data-type],[data-tool]");
    if (chip) {
      const set = chip.dataset.type ? st.types : st.tools, k = chip.dataset.type || chip.dataset.tool;
      if (set.has(k)) set.delete(k); else set.add(k);
      chip.setAttribute("aria-pressed", String(set.has(k))); st.shown = PAGE; render(); return;
    }
    const v = e.target.closest("[data-view]");
    if (v) { st.view = v.dataset.view; store.set("view", st.view); paintChips(); render(); return; }
    const mb = e.target.closest("[data-more]");
    if (mb) { if (mb.dataset.more === "fav") { st.col = "fav"; paintCols(); } else { st.sort = "recent"; store.set("sort", st.sort); paintChips(); } st.shown = PAGE; render(); return; }
    const go = e.target.closest("[data-goto]");
    if (go) { const i = lib.get(go.dataset.goto); if (i) showDetail(i.id); return; }
    const d = e.target.closest("[data-d]");
    if (d && st.sel) {
      const i = lib.get(st.sel); if (!i) return;
      if (d.dataset.d === "more") { target = { i, from: d }; const r = d.getBoundingClientRect(); openMenu(detail.__more.map(([a, ic, l]) => mi(a, ic, l, { warn: a === "remove" || a === "del" })).join(""), { x: r.left, y: r.bottom + 6 }); return; }
      act(d.dataset.d, i, d); return;
    }
    const c = e.target.closest(".libv-card"); if (!c) return;
    const i = cards.get(c.dataset.id) || lib.get(c.dataset.id); if (!i) return;
    if (e.target.closest(".libv-pick")) return;
    if (e.target.closest("[data-star]")) { lib.setFav([i.id], !i.fav); return; }
    if (picker) { if (!i.missing && o.use) o.use(i); return; }
    if (e.shiftKey || e.ctrlKey || e.metaKey || grid.classList.contains("selecting")) { toggle(i.id); return; }
    showDetail(st.sel === i.id && !detail.hidden ? null : i.id);
  });
  root.addEventListener("dblclick", e => {
    const c = e.target.closest(".libv-card"); if (!c || picker) return;
    const i = lib.get(c.dataset.id); if (!i || i.missing) return;
    if (i.type === "preset" || i.type === "look") act("apply", i); else if (OPEN_IN[i.kind]) act("open", i);
  });
  const toggle = id => { if (st.picked.has(id)) st.picked.delete(id); else st.picked.add(id); paintSel(); };
  root.addEventListener("change", e => { const box = e.target.closest(".libv-pick input"); if (box) toggle(box.closest(".libv-card").dataset.id); });
  root.addEventListener("contextmenu", e => {
    const c = e.target.closest(".libv-card"), col = e.target.closest("[data-col]");
    if (!c && !col) return;
    e.preventDefault();
    if (col) { const s = secs.find(x => x.key === col.dataset.col); if (s) colMenu(s, { x: e.clientX, y: e.clientY }); }
    else { const i = lib.get(c.dataset.id); if (i) itemMenu(i, { x: e.clientX, y: e.clientY }, c); }
  });
  $(".libv-sort").addEventListener("change", e => { st.sort = e.target.value; if (!picker) store.set("sort", st.sort); st.shown = PAGE; render(); });
  let qt = 0;
  qIn.addEventListener("input", () => { clearTimeout(qt); qt = setTimeout(() => { st.q = qIn.value.trim(); st.shown = PAGE; render(); }, 60); });
  qIn.addEventListener("keydown", e => { e.stopPropagation(); if (e.key === "Escape" && qIn.value) { qIn.value = ""; st.q = ""; render(); } });
  document.addEventListener("keydown", e => {
    if (!root.isConnected || !root.offsetParent) return;
    if (e.key === "Escape" && !menu.hidden) { e.stopPropagation(); closeMenu(); return; }
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test((document.activeElement || {}).tagName || "");
    if ((e.key === "/" && !typing) || ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f")) { e.preventDefault(); qIn.focus(); qIn.select(); }
  }, true);

  // a collection dragged along the column to reorder
  let moved = false;
  root.addEventListener("pointerdown", e => {
    const col = e.target.closest("[data-col]"); if (!col || e.button !== 0 || col.dataset.col.startsWith("pack:")) return;
    const y0 = e.clientY; moved = false;
    const box = $(".libv-colist");
    const move = ev => {
      if (!moved && Math.abs(ev.clientY - y0) < 6) return;
      moved = true; col.classList.add("dragging");
      const others = [...box.querySelectorAll("[data-col]")].filter(b => b !== col && !b.dataset.col.startsWith("pack:"));
      const before = others.find(b => { const r = b.getBoundingClientRect(); return ev.clientY < r.top + r.height / 2; }) || null;
      if (before && before !== col.nextElementSibling) M.flip(others, () => before.before(col));
    };
    const up = () => {
      document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up);
      col.classList.remove("dragging");
      if (moved) { lib.reorder([...box.querySelectorAll("[data-col]")].map(b => b.dataset.col).filter(k => !k.startsWith("pack:"))); setTimeout(() => { moved = false; }, 0); }
    };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up);
  });

  // files dropped: with a path, indexed where they are; without one, copied into the collection shown (own), or "Imported"
  const fileDrag = e => e.dataTransfer && [...e.dataTransfer.types].includes("Files");
  root.addEventListener("dragover", e => { if (fileDrag(e) && !picker) { e.preventDefault(); e.stopPropagation(); root.classList.add("dropping"); } });
  root.addEventListener("dragleave", e => { if (!root.contains(e.relatedTarget)) root.classList.remove("dropping"); });
  root.addEventListener("drop", e => { if (!fileDrag(e) || picker) return; e.preventDefault(); e.stopPropagation(); root.classList.remove("dropping"); addFiles([...e.dataTransfer.files]); });
  async function addFiles(files) {
    const ok = files.filter(f => /^(image|video|audio)\//.test(f.type) || /\.(png|jpe?g|webp|svg|gif|avif|webm|mov|mp4|mp3|wav|opus|m4a|flac|ogg)$/i.test(f.name));
    if (!ok.length) return;
    const s = secs.find(x => x.key === st.col);
    const key = s && (s.kind === "own" || s.kind === "virtual") ? s.key : await lib.createCollection(t("lib.imported")).catch(() => "own:" + t("lib.imported"));
    try { const got = await lib.addFiles(key, ok); toast(t("lib.added", { n: got.length })); } catch (err) { toast(errOf(err)); }
  }
  // "+ Add": files of the PC, by reference
  async function addFromPc() {
    const paths = await H.invoke("library_pick_files", { label: t("common.media") }).catch(() => []);
    if (!paths || !paths.length) return;
    H.filePicked?.();
    const s = secs.find(x => x.key === st.col), col = s && s.kind === "virtual" ? s.key : null;
    for (const p of paths) await lib.add(p, { type: "asset", collection: col });
    toast(t("lib.added", { n: paths.length }));
  }

  /* ---------- tabs (the page's), refresh ---------- */
  function setTab(tab) {
    if (!lib.TYPE_OF_TAB.hasOwnProperty(tab)) tab = "all";
    st.tab = tab; st.shown = PAGE;
    render();
  }
  let refreshing = null;
  async function refresh() {
    await lib.ready();
    if (!picker) await paintCols();
    paintChips();
    render();
  }
  let rt = 0;
  lib.watch(d => {
    if (!root.isConnected) return;
    clearTimeout(rt);
    rt = setTimeout(async () => { if (!picker && !(d && d.use)) await paintCols(); paintChips(); render(); if (st.sel) showDetail(st.sel); }, 80);
  });
  refresh();
  return { refresh, setTab, select: showDetail, addFromPc, focus: () => qIn.focus(), state: st };
}
window.__libPanel = { mount };
})();
