"use strict";
// The updater (docs/UPDATES.md). Some seconds after the start, update.rs asks the public releases for a newer version.
// Settings → About → Updates decides what follows: a dialog (Update, Later, Skip this version, Don't show again), only
// a quiet row in Activity, or nothing until "Check for updates". The setup downloads as a job (Activity shows it);
// then "Save session & restart" (the work comes back as it was) or "Install on close". After an update, "What's new"
// shows the release notes once. The portable copy cannot replace itself: its "Download" opens the release page.

/* ===== model ===== */
(() => {
"use strict";
const S = window.__shell, { t, $, esc, invoke } = S;
const U = window.__updates = {
  phase: "idle",      // idle | checking | available | downloading | ready | pending (installs on close)
  info: null,         // what update_check answered: { version, current, notes, page, portable }
  current: "", portable: false, checked: false, error: ""
};
const DEFAULTS = { notify: "ask", skip: "", whatsNew: true };
// Halation Preview only (window.__halPreview, set by app/scripts/halation-preview.cjs): dev/updates-fixture.js answers
// the update_* commands with a simulated version and adds buttons to Settings → Updates. Never loaded in the app.
let preview = false; try { preview = !!window.__halPreview; } catch (e) {}
U.dev = null;
U.devReady = !preview ? Promise.resolve() : new Promise(r => {
  const s = document.createElement("script"); s.src = "dev/updates-fixture.js";
  s.onload = s.onerror = () => { U.dev = window.__updDev || null; r(); }; document.head.append(s);
});
U.call = (cmd, args) => U.dev && U.dev.owns(cmd) ? U.dev.invoke(cmd, args) : invoke(cmd, args);
U.prefs = () => Object.assign({}, DEFAULTS, S.isObj(S.st.settings.updates) ? S.st.settings.updates : {});
U.setPrefs = o => { S.setSetting("updates", Object.assign(U.prefs(), o)); U.paint(); };
// 1.10.0 > 1.9.2; a suffix (-beta.1) sorts before its release
U.compare = (a, b) => {
  const parse = v => { const [main, pre] = String(v || "").split("-"); return { n: main.split(".").map(x => parseInt(x, 10) || 0), pre: pre || "" }; };
  const x = parse(a), y = parse(b);
  for (let i = 0; i < 3; i++) if ((x.n[i] || 0) !== (y.n[i] || 0)) return (x.n[i] || 0) - (y.n[i] || 0);
  if (x.pre === y.pre) return 0;
  return !x.pre ? 1 : !y.pre ? -1 : x.pre < y.pre ? -1 : 1;
};
// Release notes (Markdown of CHANGELOG.md) → headings, lists and paragraphs; links keep only their text
U.notesHtml = md => {
  const inline = s => esc(s).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>");
  let html = "", list = false;
  for (const raw of String(md || "").split(/\r?\n/)) {
    const line = raw.trim(), item = /^[-*]\s+(.*)$/.exec(line), head = /^#{1,6}\s+(.*)$/.exec(line);
    if (!item && list) { html += "</ul>"; list = false; }
    if (item) { if (!list) { html += "<ul>"; list = true; } html += `<li>${inline(item[1])}</li>`; }
    else if (head) html += `<h3>${inline(head[1])}</h3>`;
    else if (line) html += `<p>${inline(line)}</p>`;
  }
  return html + (list ? "</ul>" : "");
};
})();

/* ===== dialog ===== */
// One dialog for the three moments: a version is available, the download is ready, what's new after updating.
// Resolves with the value of the button pressed ("" for Esc).
(() => {
"use strict";
const S = window.__shell, U = window.__updates, { $, esc } = S;
U.dialog = ({ title, sub = "", notes = "", actions }) => new Promise(res => {
  const d = $("#updDlg");
  $("#uTitle").textContent = title;
  $("#uSub").textContent = sub; $("#uSub").hidden = !sub;
  $("#uNotes").innerHTML = notes; $("#uNotes").hidden = !notes; $("#uNotes").scrollTop = 0;
  $("#uActs").innerHTML = actions.map(a => `<button class="btn${a.primary ? " primary" : a.ghost ? " ghost" : ""}" value="${esc(a.value)}"${a.push ? ' data-push' : ""}>${esc(a.label)}</button>`).join("");
  d.onclose = () => res(d.returnValue || "");
  d.returnValue = ""; d.showFrom(document.activeElement);
  const p = $("#uActs .primary"); if (p) p.focus();
});
S.M.dialog($("#updDlg"));
})();

/* ===== check ===== */
(() => {
"use strict";
const S = window.__shell, U = window.__updates, { t, invoke } = S;
// manual: from Settings (the dialog shows even for a skipped version, and "up to date" is said)
U.check = async (manual = false) => {
  if (U.phase === "checking" || U.phase === "downloading" || U.phase === "ready" || U.phase === "pending") return U.info;
  U.phase = "checking"; U.error = ""; U.paint();
  let found = null;
  try { found = await U.call("update_check"); }
  catch (e) { U.error = String(e && e.message || e); }
  U.checked = true; U.info = found || null; U.phase = found ? "available" : "idle";
  if (found) await U.remember(found);
  U.paint();
  const p = U.prefs();
  if (found && (manual || p.notify === "ask" && p.skip !== found.version)) U.offer();
  return found;
};
// the notes travel to the next start: "What's new" reads them there, with no network
U.remember = async found => {
  const st = await invoke("state_get", { key: "update" }).catch(() => null) || {};
  st.notes = { version: found.version, text: found.notes || "" };
  await invoke("state_set", { key: "update", value: st }).catch(() => {});
};
U.offer = async () => {
  const f = U.info; if (!f) return;
  const choice = await U.dialog({
    title: t("upd.title", { version: f.version }),
    sub: (f.portable ? t("upd.subPortable", { current: f.current }) : t("upd.sub", { current: f.current })),
    notes: U.notesHtml(f.notes),
    actions: [
      { value: "never", label: t("upd.dontShow"), ghost: true },
      { value: "skip", label: t("upd.skip") },
      { value: "later", label: t("upd.later") },
      { value: "update", label: f.portable ? t("upd.download") : t("upd.update"), primary: true }
    ]
  });
  if (choice === "update") U.download();
  else if (choice === "skip") { U.setPrefs({ skip: f.version }); S.toast(t("upd.skipped", { version: f.version })); }
  else if (choice === "never") { U.setPrefs({ notify: "activity" }); S.toast(t("upd.inActivity")); }
  U.paint();
};
})();

/* ===== download and install ===== */
(() => {
"use strict";
const S = window.__shell, U = window.__updates, { t, invoke } = S;
let onProgress = null;
U.progress = p => { if (onProgress) onProgress(p || {}); };
if (S.T && S.T.event && S.T.event.listen) S.T.event.listen("update-progress", e => U.progress(e.payload)).catch(() => {});
U.download = () => {
  const f = U.info; if (!f) return;
  if (f.portable) { U.call("update_page", { version: f.version }).catch(e => S.toast(String(e))); return; }
  if (U.phase !== "available") return;
  U.phase = "downloading"; U.paint();
  const run = ctx => {
    onProgress = p => { if (ctx && p.total) ctx.progress(p.done / p.total, ""); };
    return U.call("update_download");
  };
  const job = S.jobs ? S.jobs.submit({ tool: "settings", kind: "update", title: t("upd.job", { version: f.version }), lane: "net", cancellable: false, run }).done : run(null);
  job.then(() => { U.phase = "ready"; U.paint(); U.askInstall(); })
    .catch(e => { U.phase = "available"; U.paint(); S.toast(t("upd.failed", { error: String(e && e.message || e) })); })
    .finally(() => { onProgress = null; });
};
// the work that would stop: jobs running or waiting, and tools busy outside a job (shell.js working())
const busy = () => S.sessionWorking ? S.sessionWorking() : [];
U.askInstall = async () => {
  const f = U.info; if (!f || U.phase !== "ready" && U.phase !== "pending") return;
  const list = busy();
  const choice = await U.dialog({
    title: t("upd.readyTitle", { version: f.version }),
    sub: list.length ? t("upd.readyBusy", { list: list.join(", ") }) : t("upd.readyText"),
    actions: [{ value: "close", label: t("upd.onClose") }, { value: "restart", label: t("upd.restart"), primary: true }]
  });
  if (choice === "restart") U.restart();
  else U.installOnClose();
};
U.installOnClose = async () => {
  if (U.phase === "pending") return;
  try { await U.call("update_install", { restart: false }); U.phase = "pending"; S.toast(t("upd.onCloseToast", { version: U.info.version })); }
  catch (e) { S.toast(t("upd.failed", { error: String(e) })); }
  U.paint();
};
// Save session & restart: what runs stops cleanly and is listed for the next start; the session is written for
// recovery, which the next start takes without asking (sessions.js, "updateResume").
U.restart = async () => {
  const live = S.jobs ? S.jobs.list().filter(j => ["queued", "held", "running"].includes(j.state) && j.kind !== "update") : [];
  const stopped = live.length ? [...new Set(live.map(j => j.title || t("tab." + j.tool)))] : busy();
  if (S.jobs && live.length) {
    S.jobs.cancelAll();
    await new Promise(r => { const end = Date.now() + 8000, w = () => S.jobs.busy() && Date.now() < end ? setTimeout(w, 50) : r(); w(); });
  }
  await Promise.all(S.tabs().map(id => { const a = S.loadedApp(id); return a && a.flush ? Promise.race([Promise.resolve().then(() => a.flush()).catch(() => {}), new Promise(r => setTimeout(r, 800))]) : null; }));
  try {
    if (S.session) await S.session.recovery();
    await invoke("state_set", { key: "updateResume", value: { from: U.current, to: U.info.version, stopped } });
    await U.call("update_install", { restart: true });
  } catch (e) { S.toast(t("upd.failed", { error: String(e) })); }
};
})();

/* ===== activity ===== */
// A quiet row in Activity while a version waits (and a dot on the island at rest): open it, or restart for one
// already downloaded.
(() => {
"use strict";
const S = window.__shell, U = window.__updates, { t } = S;
U.notice = () => {
  const f = U.info, p = U.prefs();
  if (!f) return null;
  if (U.phase === "available" && p.skip !== f.version)
    return { key: "update", title: t("upd.noticeTitle", { version: f.version }), sub: f.portable ? t("upd.noticePortable") : t("upd.noticeSub"), label: t("upd.view"), run: () => U.offer() };
  if (U.phase === "ready" || U.phase === "pending")
    return { key: "update", title: t("upd.noticeReady", { version: f.version }), sub: U.phase === "pending" ? t("upd.noticePending") : "", label: t("upd.restartShort"), run: () => U.askInstall() };
  return null;
};
})();

/* ===== settings ===== */
// Settings → About → Updates: when to say it, "What's new" after updating, "Check for updates" and the state.
(() => {
"use strict";
const S = window.__shell, U = window.__updates, { t, $ } = S;
U.paint = () => {
  const p = U.prefs(), f = U.info;
  const sel = $("#setUpdates"); if (sel) sel.value = p.notify;
  const wn = $("#setWhatsNew"); if (wn) wn.checked = p.whatsNew !== false;
  const status = $("#updStatus"), check = $("#updCheck"), act = $("#updAction");
  if (status) {
    const v = f ? f.version : "";
    status.textContent = U.phase === "checking" ? t("upd.checking")
      : U.phase === "downloading" ? t("upd.downloading", { version: v })
      : U.phase === "ready" ? t("upd.ready", { version: v })
      : U.phase === "pending" ? t("upd.pending", { version: v })
      : U.phase === "available" ? t("upd.available", { version: v }) + (p.skip === v ? " " + t("upd.isSkipped") : "")
      : U.error ? t("upd.error", { error: U.error })
      : U.checked ? t("upd.latest", { version: U.current }) : "";
    status.className = "note" + (U.error && U.phase === "idle" ? " bad" : "");
  }
  if (check) check.disabled = U.phase === "checking" || U.phase === "downloading";
  if (act) {
    const label = U.phase === "available" ? (f.portable ? t("upd.download") : t("upd.update")) : U.phase === "ready" || U.phase === "pending" ? t("upd.restartShort") : "";
    act.hidden = !label; act.textContent = label;
  }
  if (S.setActivityNotice) S.setActivityNotice(U.notice());
};
$("#setUpdates").addEventListener("change", e => U.setPrefs({ notify: e.target.value }));
$("#setWhatsNew").addEventListener("change", e => U.setPrefs({ whatsNew: e.target.checked }));
$("#updCheck").addEventListener("click", () => U.check(true));
$("#updAction").addEventListener("click", () => U.phase === "available" ? U.download() : U.askInstall());
})();

/* ===== start ===== */
// What's new once after an update (and what the restart stopped), then the check some seconds later.
(() => {
"use strict";
const S = window.__shell, U = window.__updates, { t, invoke } = S;
const CHECK_AFTER_MS = 6000;
async function whatsNew(st, resume) {
  const notes = st.notes && st.notes.version === U.current ? st.notes.text : "";
  const stopped = resume && Array.isArray(resume.stopped) ? resume.stopped.filter(x => typeof x === "string") : [];
  const choice = await U.dialog({
    title: t("upd.newTitle", { version: U.current }),
    sub: stopped.length ? t("upd.stopped", { list: stopped.join(", ") }) : "",
    notes: notes ? U.notesHtml(notes) : `<p>${S.esc(t("upd.noNotes"))}</p>`,
    actions: [{ value: "page", label: t("upd.page"), ghost: true }, { value: "ok", label: t("common.close"), primary: true }]
  });
  if (choice === "page") U.call("update_page", { version: U.current }).catch(() => {});
}
U.whatsNew = whatsNew;
async function start() {
  await Promise.all([S.ready, U.devReady]);
  if (S.session && S.session.ready) await S.session.ready.catch(() => {});
  const [info, st, resume] = await Promise.all([invoke("app_info").catch(() => null), invoke("state_get", { key: "update" }).catch(() => null), invoke("state_get", { key: "updateResume" }).catch(() => null)]);
  if (!info) return;
  U.current = info.version; U.portable = !!info.portable;
  const state = S.isObj(st) ? st : {};
  const updated = state.seen && U.compare(U.current, state.seen) > 0;
  if (state.seen !== U.current) { state.seen = U.current; await invoke("state_set", { key: "update", value: state }).catch(() => {}); }
  if (resume) await invoke("state_set", { key: "updateResume", value: null }).catch(() => {});
  U.paint();
  if (updated && U.prefs().whatsNew !== false) await whatsNew(state, resume);
  if (U.prefs().notify !== "off") setTimeout(() => U.check(false), CHECK_AFTER_MS);
}
start();
})();
