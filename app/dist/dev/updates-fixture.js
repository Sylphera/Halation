// Halation Preview only: a simulated new version for the updater, to review its windows without a release. updates.js
// loads this file only when window.__halPreview exists (set by app/scripts/halation-preview.cjs); the app never loads
// it. It answers update_check, update_download, update_install and update_page, and adds buttons to Settings → About →
// Updates: a new version (installed or portable), What's new, and a reset. Nothing is downloaded or installed: the
// download is a simulated progress, "Save session & restart" reloads the window as if it were the new version, and
// "Install on close" only marks it pending.
(() => {
"use strict";
const S = window.__shell, U = window.__updates;
const VERSION = "1.3.0", RESTARTED = "halation-update-dev";
const NOTES = [
  "### Added",
  "- **Updater**: Halation finds new versions, downloads them in Activity and installs them on restart or on close.",
  "- What's new after an update, with the notes of the release.",
  "### Changed",
  "- Settings → About has an Updates section: when to ask, What's new, and `Check for updates`.",
  "### Fixed",
  "- A longer list to scroll: " + Array.from({ length: 6 }, (x, k) => "item " + (k + 1)).join(", ") + "."
].join("\n");
const sleep = ms => new Promise(r => setTimeout(r, ms));
// armed: null (no new version, as the Preview always answers) | "installed" | "portable"
const dev = { armed: null, downloaded: false };

/* ===== commands ===== */
const owns = cmd => /^update_(check|download|install|page)$/.test(cmd);
async function invoke(cmd, a = {}) {
  if (cmd === "update_check") {
    await sleep(600);
    if (!dev.armed) return null;
    return { version: VERSION, current: U.current, notes: NOTES, date: Date.now(), page: "https://github.com/Sylphera/Halation/releases/tag/v" + VERSION, portable: dev.armed === "portable" };
  }
  if (cmd === "update_download") {
    if (dev.armed !== "installed") throw new Error("portable");
    const total = 14.2e6;
    for (let k = 1; k <= 40; k++) { await sleep(150); U.progress({ done: total * k / 40, total }); }
    dev.downloaded = true;
    return VERSION;
  }
  if (cmd === "update_install") {
    if (!dev.downloaded) throw new Error("the update is not downloaded");
    if (!a.restart) return null;
    // the restart: the window opens again as if it were the new version (What's new reads these notes)
    const st = await S.invoke("state_get", { key: "update" }).catch(() => null) || {};
    // seen: the changelog's version before the running one, so What's new shows the running version's own notes
    const before = (await U.changelog()).find(v => U.compare(v.version, U.current) < 0);
    st.seen = before ? before.version : "0.0.0"; st.notes = { version: U.current, text: NOTES };
    await S.invoke("state_set", { key: "update", value: st });
    sessionStorage.setItem(RESTARTED, "1");
    location.reload();
    return null;
  }
  if (cmd === "update_page") { S.toast("Preview: the release page of " + a.version + " would open in the browser."); return null; }
  throw new Error("not simulated: " + cmd);
}

/* ===== buttons ===== */
function arm(kind) {
  dev.armed = kind; dev.downloaded = false;
  U.phase = "idle"; U.info = null; U.error = "";
  U.check(true);
}
const ACTIONS = {
  installed: () => arm("installed"),
  portable: () => arm("portable"),
  whatsnew: () => U.whatsNew({ notes: { version: U.current, text: NOTES } }, { stopped: ["Upscale · cover.png", "Vocal Remover · Night Drive"] }),
  reset: () => { dev.armed = null; dev.downloaded = false; U.phase = "idle"; U.info = null; U.checked = false; U.setPrefs({ notify: "ask", skip: "" }); S.toast("Preview: updater reset"); }
};
function panel() {
  const status = document.querySelector("#updStatus");
  if (!status || document.querySelector("#updDev")) return;
  const box = document.createElement("div");
  box.id = "updDev"; box.className = "acts";
  box.innerHTML = [["installed", "Preview: new version"], ["portable", "Preview: portable copy"], ["whatsnew", "Preview: What's new"], ["reset", "Preview: reset"]]
    .map(([k, label]) => `<button class="btn sm ghost" type="button" data-upd-dev="${k}">${label}</button>`).join("");
  box.addEventListener("click", e => { const b = e.target.closest("[data-upd-dev]"); if (b) ACTIONS[b.dataset.updDev](); });
  status.after(box);
}
panel();
if (sessionStorage.getItem(RESTARTED)) { sessionStorage.removeItem(RESTARTED); setTimeout(() => S.toast("Preview: restarted as if the update had installed"), 1500); }

window.__updDev = { owns, invoke, dev };
})();
