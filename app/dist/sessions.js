// One session coordinator for every tool. Preferences and saved collections stay outside snapshots.
(() => {
"use strict";
const S = window.__shell, { t, M } = S;
const invoke = (...args) => S.invoke(...args);
const clone = v => JSON.parse(JSON.stringify(v));
const canonical = v => JSON.stringify(v, (k, x) => k === "updatedAt" ? undefined : x);
const adapters = new Map(), initial = new Map(), clean = new Map(), refs = new WeakMap();
const paths = new Map();
const signatures = new Map();
const exportStates = new Map();
const cache = new Map(), changed = new Set(), versions = new Map(), binaries = new WeakMap();
let dirty = false, allChanged = false;
const hasDirtyState = () => allChanged || changed.size > 0 || [...signatures].some(([id, sig]) => sig !== (clean.get(id) ?? initial.get(id)));
let file = null, enabled = false, restoring = false, collecting = null, writing = Promise.resolve(), lastRecovery = "", timer = 0;
let pendingMissing = [], statusTimer = 0, generation = 0;
let revision = 0, recoveredRevision = -1;
let saving = false;
function status(key, vars, bad = false) {
  const el = document.querySelector("#sync");
  el.hidden = false; el.dataset.s = bad ? "error" : "saved"; document.querySelector("#syncText").textContent = t(key, vars);
  clearTimeout(statusTimer); statusTimer = setTimeout(() => S.showSessionStatus ? S.showSessionStatus() : (el.hidden = true), bad ? 7000 : 2200);
}
async function ref(src, name) {
  if (!src) return null;
  if (src.path || src.__halPath) {
    const original = src.path || src.__halPath;
    if (!paths.has(original)) paths.set(original, invoke("session_file_reference", { path: original }).catch(e => { paths.delete(original); throw e; }));
    return { path: await paths.get(original), name: name || src.name || original.split(/[\\/]/).pop(), type: src.type || "" };
  }
  if (refs.has(src)) return refs.get(src);
  const task = (async () => {
    const blob = src.blob || src;
    if (!blob.arrayBuffer) throw new Error(t("session.unreadableMedia"));
    const path = await invoke("session_file_put", new Uint8Array(await blob.arrayBuffer()), { headers: { "x-name": encodeURIComponent(name || src.name || "media.bin") } });
    return { path, name: name || src.name || "media.bin", type: blob.type || "" };
  })();
  refs.set(src, task); try { return await task; } catch (e) { refs.delete(src); throw e; }
}
async function read(r) {
  if (!r?.path) return null;
  try {
    const bytes = await invoke("session_file_read", { path: r.path });
    const f = new File([bytes], r.name || r.path.split(/[\\/]/).pop(), { type: r.type || "" }); f.__halPath = r.path;
    return f;
  } catch (e) { pendingMissing.push(r.path); return null; }
}
async function video(r) {
  if (!r?.path) return null;
  try { await invoke("session_allow_video", { path: r.path }); return r; }
  catch (e) { pendingMissing.push(r.path); return null; }
}
async function encode(value) {
  if (value == null || typeof value !== "object") return value;
  if (value instanceof Blob || Object.prototype.toString.call(value) === "[object Blob]" || Object.prototype.toString.call(value) === "[object File]") return { sessionBlob: await ref(value) };
  if (ArrayBuffer.isView(value)) return { sessionArray: value.constructor.name, file: await binary(value, new Uint8Array(value.buffer, value.byteOffset, value.byteLength)) };
  if (value.tagName === "CANVAS") return { sessionCanvas: { width: value.width, height: value.height, file: await binary(value, value.getContext("2d").getImageData(0,0,value.width,value.height).data) } };
  if (Array.isArray(value)) return Promise.all(value.map(encode));
  return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await encode(v)])));
}
async function binary(owner, bytes) {
  const previous = binaries.get(owner);
  if (previous && previous.bytes.length === bytes.length) {
    let same = true;
    for (let i = 0; i < bytes.length; i++) if (bytes[i] !== previous.bytes[i]) { same = false; break; }
    if (same) return previous.file;
  }
  const copy = bytes.slice(), entry = { bytes: copy, file: ref(new Blob([copy], { type: "application/octet-stream" }), "session-buffer.bin") };
  binaries.set(owner, entry);
  try { return await entry.file; }
  catch (error) { if (binaries.get(owner) === entry) binaries.delete(owner); throw error; }
}
async function decode(value, target) {
  if (value == null || typeof value !== "object") return value;
  if (value.sessionBlob) return read(value.sessionBlob);
  if (value.sessionCanvas) { const d=value.sessionCanvas,c=target || document.createElement("canvas");c.width=d.width;c.height=d.height;const f=d.file ? await read(d.file) : null;const pixels=d.file ? (f ? await f.arrayBuffer() : new ArrayBuffer(d.width*d.height*4)) : d.pixels;c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(pixels),d.width,d.height),0,0);if(d.file&&f)binaries.set(c,{bytes:new Uint8Array(pixels),file:d.file});return c; }
  if (value.sessionArray) {
    const types = { Uint8Array, Uint8ClampedArray, Float32Array, Float64Array, Uint32Array, Int32Array, Uint16Array, Int16Array };
    if (!types[value.sessionArray] || !value.file && !Array.isArray(value.values)) throw new Error(t("session.invalid"));
    const f=value.file ? await read(value.file) : null;
    const result=new types[value.sessionArray](value.file ? (f ? await f.arrayBuffer() : 0) : value.values);
    if(value.file&&f)binaries.set(result,{bytes:new Uint8Array(result.buffer).slice(),file:value.file});
    return result;
  }
  if (Array.isArray(value)) return Promise.all(value.map(v => decode(v)));
  return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([k, v]) => [k, await decode(v)])));
}
function missing(name) { pendingMissing.push(String(name)); }
async function register(id, adapter) {
  if (adapters.has(id) && adapters.get(id).document === adapter.document) return;
  adapters.set(id, adapter);
  const value = clone(await adapter.capture()), signature = canonical(value);
  initial.set(id, signature); signatures.set(id, signature); cache.set(id, value);
  const notify = e => { if (e?.target?.type !== "file") schedule(id); };
  adapter.document?.addEventListener("input", notify, true);
  adapter.document?.addEventListener("change", notify, true);
  // Adapters can opt into specific editable controls; previews and pointer movement are never observed.
  if (adapter.clickChanges) adapter.document?.addEventListener("click", e => { if (e.target.closest(adapter.clickChanges)) notify(); });
}
async function capture(full = true) {
  if (collecting) { await collecting; return capture(full); }
  collecting = (async () => {
    const runRevision = revision, all = allChanged;
    const ids = full || all ? [...adapters.keys()] : [...changed];
    for (const id of ids) {
      const a = adapters.get(id); if (!a) continue;
      const version = versions.get(id), value = clone(await a.capture());
      if (adapters.get(id) !== a) continue;
      cache.set(id, value); signatures.set(id, canonical(value));
      if (versions.get(id) === version) changed.delete(id);
    }
    if (runRevision === revision) allChanged = false;
    const meaningful = [...signatures].filter(([id, sig]) => sig !== initial.get(id));
    dirty = hasDirtyState();
    return { app: "halation-session", version: 1, active: S.active(), tools: Object.fromEntries(cache), dirty, meaningful: meaningful.length > 0 || !!file && dirty };
  })();
  try { return await collecting; } finally { collecting = null; }
}
function schedule(id) {
  if (restoring) return;
  if (id) { changed.add(id); versions.set(id, (versions.get(id) || 0) + 1); }
  else allChanged = true;
  dirty = true;
  revision++;
  if (!enabled || restoring) return;
  clearTimeout(timer); timer = setTimeout(() => recovery(false).catch(() => {}), 900);
}
async function recovery(force = true) {
  if (!enabled || restoring) return;
  if (!force && revision === recoveredRevision) return;
  const capturedRevision = revision;
  const run = generation;
  const v = await capture(false);
  if (!enabled || restoring || run !== generation) return;
  const signature = canonical(v);
  if (signature === lastRecovery) { recoveredRevision = capturedRevision; return; }
  writing = writing.catch(() => {}).then(async () => {
    if (run !== generation) return;
    if (!v.meaningful) await invoke("session_discard");
    else { await invoke("session_recovery_write", { snapshot: { ...v, file } }); }
    lastRecovery = signature;
    recoveredRevision = capturedRevision;
  });
  try { await writing; } catch (error) {
    status("session.failed", { error: String(error) }, true);
    if (enabled && !restoring && run === generation && revision === capturedRevision) {
      clearTimeout(timer); timer = setTimeout(() => recovery(false).catch(() => {}), 3000);
    }
    throw error;
  }
}
async function save(as = false, automatic = false) {
  if (saving || automatic && (!enabled || restoring || !file || !dirty)) return false;
  saving = true;
  try {
    const autosnapshot = automatic ? await capture(false) : null;
    if (automatic && (!autosnapshot.dirty || !enabled || restoring || !file)) return false;
    const target = !automatic ? await S.exportLocation.destination(file ? file.split(/[\\/]/).pop() : "Session.halation-session", "session", { nullable: true }) : file;
    if (!target) return false;
    status("session.saving");
    const v = autosnapshot || await capture();
    await invoke("session_write", { path: target, snapshot: { ...v, dirty: false } });
    if (!automatic) await S.exportLocation.success(target);
    file = target; clean.clear(); Object.entries(v.tools).forEach(([id, x]) => clean.set(id, canonical(x)));
    dirty = hasDirtyState();
    lastRecovery = ""; await recovery(); status("session.saved");
    const button = document.querySelector("#sessionBtn"); button.innerHTML = window.icon("check");
    setTimeout(() => { button.innerHTML = window.icon("save"); }, 1300);
    return true;
  } catch (error) { status("session.failed", { error: String(error) }, true); return false; }
  finally { saving = false; }
}
async function restore(snapshot, associated = null, recovered = false) {
  if (snapshot.app !== "halation-session" || snapshot.version !== 1 || !snapshot.tools || typeof snapshot.tools !== "object") throw new Error(t("session.invalid"));
  restoring = true; clearTimeout(timer); generation++; await writing.catch(() => {}); pendingMissing = [];
  try {
    // Stop no jobs here: Open refuses active work, recovery never starts a job.
    // Reload tool frames to reset tools absent from the session and transient result buffers.
    adapters.clear(); initial.clear(); clean.clear(); signatures.clear(); cache.clear(); changed.clear(); versions.clear(); dirty = false; allChanged = false;
    await S.resetSessionTools();
    await invoke("session_replace", { tools: {} });
    for (const [id, data] of Object.entries(snapshot.tools)) {
      if (!S.tabs().includes(id)) { pendingMissing.push(t("session.disabled", { tool: t("tab." + id) })); continue; }
      await S.ensureApp(id);
      const a = adapters.get(id); if (!a) throw new Error(t("session.adapterMissing", { tool: t("tab." + id) }));
      try { await a.restore(clone(data)); }
      catch (error) { pendingMissing.push(t("session.toolError", { tool: t("tab." + id), error: String(error) })); }
      const value = clone(await a.capture()), sig = canonical(value);
      cache.set(id, value); signatures.set(id, sig);
      if (!recovered || !snapshot.dirty) clean.set(id, sig);
    }
    file = associated;
    S.show(S.tabs().includes(snapshot.active) ? snapshot.active : "home");
    dirty = recovered && !!snapshot.dirty; revision++; lastRecovery = "";
  } finally { restoring = false; }
  await recovery();
  if (pendingMissing.length) await S.ask({ title: t("session.missingTitle"), text: [...new Set(pendingMissing)].join("\n"), okLabel: t("common.ok") });
}
async function open() {
  if (S.sessionWorking().length) { await S.ask({ title: t("session.openBusy"), text: t("session.openBusyText") }); return false; }
  const v = await capture();
  if (v.dirty) {
    const choice = await S.ask({ title: t("session.unsaved"), text: t("session.replaceText"), okLabel: t("session.save"), altLabel: t("session.discard") });
    if (!choice || choice === true && !await save()) return false;
  }
  try {
    const path = await invoke("session_pick", { save: false, label: t("session.filter") }); if (!path) return false;
    const snapshot = await invoke("session_read", { path }); await restore(snapshot, path); status("session.opened"); return true;
  } catch (error) { status("session.failed", { error: String(error) }, true); return false; }
}
async function completed(id) {
  const a = adapters.get(id); if (!a) return;
  if (S.jobs?.busy(id) || S.loadedApp(id)?.busy?.()) { setTimeout(() => completed(id), 150); return; }
  const value = await a.capture();
  if (value.queue?.length || value.batch?.length) return;
  const before = exportStates.get(id);
  if (before && before !== editable(value)) return;
  const sig = canonical(value); clean.set(id, sig); cache.set(id, clone(value)); signatures.set(id, sig); schedule(id);
}
const editable = value => canonical(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "queue" && key !== "batch")));
async function start(id) {
  try { const a = adapters.get(id); if (a) exportStates.set(id, editable(await a.capture())); }
  catch (error) { status("session.failed", { error: String(error) }, true); }
}
function recordExport(id, data) { S.recordExport(data); schedule(id); completed(id).catch(error => status("session.failed", { error: String(error) }, true)); }
async function close() {
  try {
  const v = dirty ? await capture(false) : { dirty: false }, busy = S.sessionWorking();
  if (v.dirty || busy.length) {
    const choice = await S.ask({ title: t("session.closeTitle"), text: busy.length ? t("session.closeBusy", { list: busy.join(", ") }) : t("session.closeText"), okLabel: t("session.save"), altLabel: t("session.exit"), danger: false });
    if (!choice || choice === true && !await save()) return false;
  }
  enabled = false; clearTimeout(timer); generation++; await writing.catch(() => {}); return true;
  } catch (error) { status("session.failed", { error: String(error) }, true); return false; }
}
const api = S.session = { ref, read, video, encode, decode, missing, register, capture, save, open, restore, completed, start, recordExport, recovery, close, schedule,
  hasState: id => changed.has(id) || signatures.has(id) && signatures.get(id) !== initial.get(id),
  unregister: id => { adapters.delete(id); initial.delete(id); signatures.delete(id); clean.delete(id); cache.delete(id); changed.delete(id); versions.delete(id); },
  get file() { return file; }, get restoring() { return restoring; } };
const button = document.querySelector("#sessionBtn"), menu = document.querySelector("#sessionMenu");
function hide() { if (!menu.hidden) M.closePopover(menu); button.setAttribute("aria-expanded", "false"); }
button.addEventListener("click", () => { if (!menu.hidden) hide(); else { M.openPopover(menu, button); button.setAttribute("aria-expanded", "true"); menu.querySelector("button").focus(); } });
document.addEventListener("mousedown", e => { if (!e.target.closest("#sessionWrap")) hide(); });
menu.addEventListener("keydown", e => { if (e.key === "Escape") { hide(); button.focus(); } });
menu.addEventListener("click", e => { const action = e.target.closest("[data-session]")?.dataset.session; if (!action) return; hide(); if (action === "open") open(); else save(action === "saveAs"); });
api.ready = S.ready.then(async () => {
  if (document.readyState === "loading") await new Promise(resolve => document.addEventListener("DOMContentLoaded", resolve, { once: true }));
  window.__hal.session = api;
  const previous = await invoke("session_recovery").catch(error => { status("session.failed", { error: String(error) }, true); return null; });
  enabled = true;
  if (previous) {
    // a language reload, or the restart of "Save session & restart" (updates.js): the work comes back without asking
    const sameRun = window.sessionStorage.getItem("halation-language-reload") === "1" || !!await invoke("state_get", { key: "updateResume" }).catch(() => null);
    window.sessionStorage.removeItem("halation-language-reload");
    const recover = sameRun || await S.ask({ title: t("session.recoverTitle"), text: t("session.recoverText"), okLabel: t("session.recover"), cancelLabel: t("session.discard") });
    if (recover) { try { await restore(previous, previous.file || null, true); } catch (error) { status("session.failed", { error: String(error) }, true); } }
    else await invoke("session_discard");
  }
  setInterval(() => save(false, true), 3 * 60 * 1000);
  if (dirty) { clearTimeout(timer); timer = setTimeout(() => recovery(false).catch(() => {}), 900); }
});
})();
