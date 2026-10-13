// Shared by every tool. Settings owns the mode; native code owns destination capabilities and last-directory commits.
(() => {
"use strict";
const S = window.__shell, { invoke, st, t } = S;
let choice = null, queue = Promise.resolve(), modeWrite = Promise.resolve();
const completed = new Set();
const cancelled = () => Object.assign(new Error(t("common.saveCancelled")), { code: "declined", cancelled: true });
async function setMode(mode) {
  if (!["ask-every-time", "halation-folder"].includes(mode)) throw new Error("Invalid save mode");
  const previous = { ...st.settings };
  const settings = { ...st.settings, saveMode: mode, saveLocationChosen: true };
  Object.assign(st.settings, settings);
  S.emit("settings", S.flatSettings()); S.renderSettings();
  const write = modeWrite.catch(() => {}).then(() => invoke("state_set", { key: "settings", value: settings }));
  modeWrite = write;
  try { await write; }
  catch (error) {
    if (modeWrite === write) { Object.assign(st.settings, previous); S.emit("settings", S.flatSettings()); S.renderSettings(); }
    throw error;
  }
}
async function ensureChoice() {
  await S.ready;
  await modeWrite;
  if (["ask-every-time", "halation-folder"].includes(st.settings.saveMode)) return true;
  if (!choice) choice = (async () => {
    const dialog = S.M.dialog(document.querySelector("#saveLocationChoice"));
    dialog.querySelector('[value="ask-every-time"]').checked = true;
    const selected = await new Promise(resolve => {
      dialog.onclose = () => resolve(dialog.returnValue === "continue" ? dialog.querySelector("input:checked").value : null);
      dialog.returnValue = ""; dialog.showFrom(document.activeElement);
      dialog.querySelector("input:checked").focus();
    });
    if (!selected) return false;
    await setMode(selected); return true;
  })().finally(() => { choice = null; });
  return choice;
}
function prepare(resolve, { nullable = false } = {}) {
  const next = queue.then(async () => {
    if (!await ensureChoice()) { if (nullable) return null; throw cancelled(); }
    const result = await resolve();
    if (!result && !nullable) throw cancelled();
    if (result && result.out) completed.delete(result.out);
    return result;
  });
  queue = next.catch(() => {}); return next;
}
function destination(name, kind, options) {
  return prepare(async () => {
    const path = await invoke("export_destination", { name, kind: kind || null, folder: options && options.folder || null });
    if (path) completed.delete(path);
    return path;
  }, options);
}
async function success(path) {
  if (!path || completed.has(path)) return;
  completed.add(path);
  try {
    const result = await invoke("export_completed", { path });
    if (!result.fresh) return;
    const name = path.split(/[\\/]/).pop();
    S.toast(t(result.explain ? "save.exportedManaged" : "save.exported", { name }), { label: t("common.reveal"), run: () => reveal(path) });
  } catch (error) { completed.delete(path); S.toast(String(error)); }
}
const reveal = path => invoke("reveal_path", { path }).catch(error => S.toast(String(error)));
async function copy(source, name, kind) {
  const destinationPath = await destination(name, kind);
  const path = await invoke("export_copy", { source, destination: destinationPath });
  await success(path); return path;
}
S.exportLocation = { destination, prepare, success, reveal, copy, setMode, ensureChoice };
})();
