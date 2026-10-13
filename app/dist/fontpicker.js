// Font picker: replaces the look of any <select data-font>. The <select> stays (hidden)
// and still receives the value and the "change" event.
(() => {
"use strict";
const S = window.__hal || null;
const ROW = 34;
const SPECIAL = new Set(["s", "__sys"]);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const famOf = v => /^[gu]:/.test(v) ? v.slice(2) : v;
const cssFam = f => `'${String(f).replace(/['\\]/g, "\\$&")}', var(--ui)`;
const fold = s => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

const style = document.createElement("style");
style.textContent = `
.fp-hidden{display:none!important}
.fp-btn{display:flex;align-items:center;justify-content:space-between;gap:8px;width:100%;min-width:0;height:36px;padding:0 12px;border:1px solid var(--line);border-radius:var(--r);background:var(--field);color:var(--text);font-size:14.5px;line-height:1.3;text-align:left;cursor:pointer}
.fp-btn:hover{border-color:var(--line-strong)}
.fp-btn span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fp-btn::after{content:"";flex:none;width:5px;height:5px;margin:-3px 3px 0 0;border-right:1.5px solid var(--text-3);border-bottom:1.5px solid var(--text-3);transform:rotate(45deg)}
.fp-pop{position:fixed;z-index:1000;display:flex;flex-direction:column;overflow:hidden;border-radius:12px;background:var(--panel);box-shadow:0 0 0 1px var(--line),inset 0 1px 0 var(--edge);font-family:var(--ui)}
.fp-sample{min-width:0;padding:14px 14px 10px;border-bottom:1px solid var(--line)}
.fp-sample b{display:block;overflow:hidden;font-size:27px;font-weight:500;line-height:1.25;text-overflow:ellipsis;white-space:nowrap}
.fp-sample small{display:block;overflow:hidden;margin-top:3px;font-size:11px;color:var(--text-2);text-overflow:ellipsis;white-space:nowrap}
.fp-pop input.fp-search{width:auto;margin:10px 10px 6px}
.fp-list{position:relative;flex:1;min-height:0;overflow-y:auto;outline:0}
.fp-row{position:absolute;left:0;right:0;height:${ROW}px;display:flex;align-items:center;gap:8px;padding:0 8px 0 14px;cursor:pointer}
.fp-row.hl{background:var(--raised)}
.fp-row.sel .fp-name{color:var(--accent)}
.fp-name{flex:1;overflow:hidden;font-size:16px;color:var(--text);text-overflow:ellipsis;white-space:nowrap}
.fp-row.special .fp-name{font-size:13px;color:var(--text-2)}
.fp-star{flex:none;width:26px;height:26px;padding:0;border:0;border-radius:50%;background:transparent;color:var(--text-2);font-size:15px;cursor:pointer}
.fp-star:hover{background:var(--state-press)}
.fp-star.on{color:var(--accent)}
.fp-h{position:absolute;left:0;right:0;height:${ROW}px;display:flex;align-items:flex-end;padding:0 14px 6px;font-size:10.5px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:var(--text-3)}
.fp-foot{padding:7px 12px;border-top:1px solid var(--line);font-size:11px;color:var(--text-2)}
.fp-empty{position:absolute;left:14px;top:10px;font-size:12.5px;color:var(--text-2)}
`;
document.head.appendChild(style);

let favs = S ? S.fonts.favorites() : [];
const pop = { el: null, sel: null, items: [], flat: [], hl: -1, q: "" };

/* ---------- botón que sustituye al desplegable ---------- */
const valueDesc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
function paint(sel) {
  const btn = sel.__fpBtn; if (!btn) return;
  const o = sel.selectedOptions[0], v = valueDesc.get.call(sel);
  const label = o ? o.textContent : famOf(v || "");
  btn.innerHTML = `<span>${esc(label || t("fp.choose"))}</span>`;
  btn.firstChild.style.fontFamily = v && !SPECIAL.has(v) ? cssFam(famOf(v)) : "";
  btn.title = label;
}
function enhance(sel) {
  if (sel.__fpBtn) return;
  const btn = document.createElement("button");
  btn.type = "button"; btn.className = "fp-btn"; btn.setAttribute("aria-haspopup", "listbox");
  if (sel.id) {
    btn.id = sel.id + "-fp";
    document.querySelectorAll(`label[for="${CSS.escape(sel.id)}"]`).forEach(l => { l.htmlFor = btn.id; });
  }
  sel.__fpBtn = btn;
  sel.classList.add("fp-hidden");
  sel.insertAdjacentElement("afterend", btn);
  Object.defineProperty(sel, "value", { configurable: true, get() { return valueDesc.get.call(this); }, set(v) { valueDesc.set.call(this, v); paint(this); } });
  sel.addEventListener("change", () => paint(sel));
  new MutationObserver(() => paint(sel)).observe(sel, { childList: true, subtree: true });
  btn.addEventListener("click", () => (pop.sel === sel ? close() : open(sel)));
  paint(sel);
}
function scan(root) {
  if (root.matches && root.matches("select[data-font]")) enhance(root);
  if (root.querySelectorAll) root.querySelectorAll("select[data-font]").forEach(enhance);
}
new MutationObserver(muts => { for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) scan(n); })
  .observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener("DOMContentLoaded", () => scan(document));

/* ---------- ventana con la lista ---------- */
function sampleText(sel) {
  const scope = (sel.dataset.sampleScope && sel.closest(sel.dataset.sampleScope)) || document;
  const src = sel.dataset.sampleFrom ? scope.querySelector(sel.dataset.sampleFrom) : null;
  const txt = src && typeof src.value === "string" ? src.value.trim() : "";
  return txt || t("fp.sample");
}
function collect(sel) {
  const out = [];
  for (const o of sel.options) {
    const v = o.value, special = SPECIAL.has(v);
    const g = o.parentElement && o.parentElement.tagName === "OPTGROUP" ? o.parentElement.label : (sel.dataset.defaultGroup || t("fonts.builtin"));
    if (o.dataset.loading && [...sel.options].some(x => x !== o && x.value === v)) continue;
    out.push({ value: v, label: o.textContent, family: special ? null : famOf(v), group: special ? t("fonts.other") : g });
  }
  return out;
}
function build() {
  const q = fold(pop.q.trim()), cur = valueDesc.get.call(pop.sel);
  const match = it => !q || fold(it.label).includes(q) || (it.family && fold(it.family).includes(q));
  const items = pop.items.filter(match);
  const groups = new Map();
  const favItems = [], seen = new Set();
  for (const it of items) if (it.family && favs.includes(it.family) && !seen.has(it.family)) { seen.add(it.family); favItems.push(it); }
  if (favItems.length) groups.set(t("fonts.favorites"), favItems);
  for (const it of items) { if (!groups.has(it.group)) groups.set(it.group, []); groups.get(it.group).push(it); }
  const flat = [];
  for (const [g, list] of groups) { flat.push({ header: g }); for (const it of list) flat.push(it); }
  pop.flat = flat;
  const first = flat.findIndex(x => !x.header && x.value === cur);
  pop.hl = first >= 0 ? first : flat.findIndex(x => !x.header);
  render();
}
function render() {
  if (!pop.sel) return;
  const list = pop.el.querySelector(".fp-list"), rows = pop.el.querySelector(".fp-rows");
  const top = list.scrollTop, h = list.clientHeight || 300;
  const a = Math.max(0, Math.floor(top / ROW) - 4), b = Math.min(pop.flat.length, Math.ceil((top + h) / ROW) + 4);
  rows.style.height = pop.flat.length * ROW + "px";
  const cur = valueDesc.get.call(pop.sel);
  let html = "";
  for (let i = a; i < b; i++) {
    const it = pop.flat[i], y = i * ROW;
    if (it.header) { html += `<div class="fp-h" style="top:${y}px">${esc(it.header)}</div>`; continue; }
    const fav = it.family && favs.includes(it.family);
    const fam = it.family ? ` style="${esc("font-family:" + cssFam(it.family))}"` : "";
    html += `<div class="fp-row${it.value === cur ? " sel" : ""}${i === pop.hl ? " hl" : ""}${it.family ? "" : " special"}" role="option" aria-selected="${it.value === cur}" data-i="${i}" style="top:${y}px">` +
      `<span class="fp-name"${fam}>${esc(it.label)}</span>` +
      (it.family ? `<button type="button" class="fp-star${fav ? " on" : ""}" data-star="${i}" title="${esc(t(fav ? "fp.unfav" : "fp.fav"))}" aria-label="${esc(t(fav ? "fp.unfav" : "fp.fav"))}">${fav ? "★" : "☆"}</button>` : "") + `</div>`;
  }
  if (!pop.flat.length) html = `<p class="fp-empty">${esc(t("fp.none", { q: pop.q }))}</p>`;
  rows.innerHTML = html;
}
function preview(it) {
  if (!pop.sel) return;
  const b = pop.el.querySelector(".fp-sample b"), s = pop.el.querySelector(".fp-sample small");
  const cur = pop.items.find(x => x.value === valueDesc.get.call(pop.sel));
  const show = it || cur;
  b.textContent = sampleText(pop.sel);
  b.style.fontFamily = show && show.family ? cssFam(show.family) : "";
  s.textContent = show ? (show === cur ? t("fp.current", { name: show.family || show.label }) : show.family || show.label) : "";
}
function ensureVisible(i) {
  const list = pop.el.querySelector(".fp-list"), y = i * ROW;
  if (y < list.scrollTop) list.scrollTop = y - ROW;
  else if (y + ROW > list.scrollTop + list.clientHeight) list.scrollTop = y + ROW - list.clientHeight;
}
function move(d) {
  let i = pop.hl;
  do { i += d; } while (i >= 0 && i < pop.flat.length && pop.flat[i].header);
  if (i < 0 || i >= pop.flat.length) return;
  pop.hl = i; ensureVisible(i); render(); preview(pop.flat[i]);
}
function choose(it) {
  const sel = pop.sel, btn = sel.__fpBtn;
  close();
  if (!it) return;
  sel.value = it.value;
  sel.dispatchEvent(new Event("input", { bubbles: true }));
  sel.dispatchEvent(new Event("change", { bubbles: true }));
  if (btn && btn.isConnected) btn.focus();
}
function place() {
  const r = pop.sel.__fpBtn.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
  const w = Math.min(vw - 16, Math.max(r.width, 340)), below = vh - r.bottom - 8, above = r.top - 8;
  const h = Math.min(460, Math.max(below, above) - 4);
  pop.el.style.width = w + "px"; pop.el.style.height = Math.max(220, h) + "px";
  pop.el.style.left = Math.max(8, Math.min(r.left, vw - w - 8)) + "px";
  pop.el.style.top = (below >= 300 || below >= above ? r.bottom + 4 : Math.max(8, r.top - 4 - Math.max(220, h))) + "px";
}
function open(sel) {
  close();
  if (!pop.el) {
    pop.el = document.createElement("div");
    pop.el.className = "fp-pop"; pop.el.setAttribute("role", "dialog"); pop.el.setAttribute("aria-label", t("fp.choose"));
    pop.el.innerHTML = `<div class="fp-sample"><b></b><small></small></div><input type="text" class="fp-search" placeholder="${esc(t("fp.search"))}" aria-label="${esc(t("fp.searchLabel"))}"><div class="fp-list" role="listbox" tabindex="-1"><div class="fp-rows"></div></div><div class="fp-foot">${esc(t("fp.foot"))}</div>`;
    const list = pop.el.querySelector(".fp-list"), search = pop.el.querySelector(".fp-search");
    list.addEventListener("scroll", render);
    list.addEventListener("mousemove", e => {
      const r = e.target.closest(".fp-row"); if (!r) return;
      const i = +r.dataset.i; if (i === pop.hl) return;
      pop.hl = i; render(); preview(pop.flat[i]);
    });
    list.addEventListener("mouseleave", () => preview(null));
    list.addEventListener("click", e => {
      const star = e.target.closest("[data-star]");
      if (star) {
        const it = pop.flat[+star.dataset.star];
        if (S && it && it.family) { const top = list.scrollTop; S.fonts.toggleFavorite(it.family); build(); list.scrollTop = top; render(); }
        return;
      }
      const r = e.target.closest(".fp-row"); if (r) choose(pop.flat[+r.dataset.i]);
    });
    search.addEventListener("input", () => { pop.q = search.value; list.scrollTop = 0; build(); preview(pop.flat[pop.hl]); });
    search.addEventListener("keydown", e => {
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") { e.preventDefault(); const it = pop.flat[pop.hl]; if (it && !it.header) choose(it); }
      else if (e.key === "Escape") { e.preventDefault(); const b = pop.sel && pop.sel.__fpBtn; close(); if (b) b.focus(); }
    });
    document.body.appendChild(pop.el);
  }
  pop.sel = sel; pop.items = collect(sel); pop.q = "";
  pop.el.hidden = false;
  const search = pop.el.querySelector(".fp-search"); search.value = "";
  place(); build();
  if (pop.hl >= 0) { const list = pop.el.querySelector(".fp-list"); list.scrollTop = Math.max(0, pop.hl * ROW - list.clientHeight / 2); render(); }
  preview(null);
  search.focus();
  if (window.__motion) window.__motion.pop(pop.el, sel.__fpBtn);
}
function close() {
  if (pop.el && !pop.el.hidden && pop.sel) { if (window.__motion) window.__motion.closePopover(pop.el); else pop.el.hidden = true; }
  pop.sel = null;
}
document.addEventListener("mousedown", e => {
  if (!pop.sel || pop.el.contains(e.target) || (pop.sel.__fpBtn && pop.sel.__fpBtn.contains(e.target))) return;
  close();
}, true);
document.addEventListener("scroll", e => { if (pop.sel && !pop.el.contains(e.target)) close(); }, true);
window.addEventListener("resize", close);
window.addEventListener("blur", () => { if (pop.sel && document.activeElement && !pop.el.contains(document.activeElement)) close(); });
if (S) S.on("favorites", f => { favs = f; if (pop.sel) { const list = pop.el.querySelector(".fp-list"), top = list.scrollTop; build(); list.scrollTop = top; render(); } });

window.__halFontPicker = { open, close, enhance };
})();
