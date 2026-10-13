// Registry of Halation's tools (docs/ARCHITECTURE.md → "Adding a module"). The rail, the Home cards, the
// Ctrl+number shortcuts and Settings → Modules are all built from this list; nothing else names the tools.
//   id       view id (#v-<id>), text keys tab.<id> (name) and home.d.<id> (Home card)
//   icon     Lucide name (icons.js); Home uses the Halation logo
//   src      page of the tool, loaded in an iframe the first time it is shown; none for pages of the main window
//   group    rail group (what the tool starts from: getting files, audio, image, video), a separator is drawn between
//            groups on the rail (not on Home's tool bar); place "bottom" goes to the foot of the rail
//   core     cannot be turned off (Home, Settings)
//   heavy    live canvas: the tab switches at once, never animated
//   home     has a card on Home
//   deps     components it uses ({ id, optional }): a required one missing is flagged in Settings → Modules
//   stage    "stable" or "beta" (shown as a badge in Settings → Modules)
//   accepts  kinds of content it takes from other tabs ("image", "video", "audio"), each with its input
//            handler: the method of the tool's API (window.__halApp) that receives the item { kind, name, path, blob,
//            meta } (shell.js → sendto). The "Send to…" menu lists only the tools that accept the kind.
//   gives    kinds its result() can be ("Back to <origin>" brings it to the tool the content came from)
//   roundTrip  the tool runs "and come back" itself: its handler resolves with the result (Frame Grab)
(() => {
"use strict";
const MODULES = [
  { id: "home", group: 0, core: true, stage: "stable" },
  { id: "downloader", icon: "download", src: "downloader.html", group: 1, home: true, deps: [{ id: "ytdlp" }, { id: "ffmpeg" }, { id: "cutout", optional: true }], stage: "stable" },
  { id: "convert", icon: "repeat", src: "convert.html", group: 1, home: true, deps: [{ id: "ffmpeg", optional: true }, { id: "pandoc", optional: true }, { id: "libreoffice", optional: true }, { id: "pdfium", optional: true }], accepts: { image: "takeImage", audio: "takeAudio", video: "takeVideo" }, gives: ["image", "audio", "video"], stage: "beta" },
  { id: "stems", icon: "mic-vocal", src: "stems.html", group: 2, home: true, deps: [{ id: "ffmpeg" }, { id: "onnxruntime" }, { id: "stems-hq4" }, { id: "stems-htdemucs", optional: true }], accepts: { audio: "takeAudio", video: "takeVideo" }, gives: ["audio"], stage: "beta" },
  { id: "visualizer", icon: "audio-lines", src: "visualizer.html", group: 2, heavy: true, home: true, deps: [{ id: "ffmpeg", optional: true }, { id: "cutout", optional: true }], accepts: { audio: "takeAudio", image: "takeImage" }, gives: ["video"], stage: "stable" },
  { id: "grade", icon: "palette", src: "grade.html", group: 3, heavy: true, home: true, deps: [{ id: "cutout", optional: true }], accepts: { image: "takeImage" }, gives: ["image"], stage: "stable" },
  { id: "covertest", icon: "gallery-horizontal-end", src: "covertest.html", group: 3, home: true, accepts: { image: "takeImage" }, stage: "beta" },
  { id: "removebg", icon: "wand-sparkles", src: "removebg.html", group: 3, home: true, deps: [{ id: "cutout", optional: true }], accepts: { image: "takeImage" }, gives: ["image"], stage: "beta" },
  { id: "upscale", icon: "image-up", src: "upscale.html", group: 3, home: true, deps: [{ id: "upscayl", kind: "image" }, { id: "models", kind: "image" }, { id: "span", kind: "video" }, { id: "ffmpeg", kind: "video" }, { id: "cutout", optional: true }], accepts: { image: "takeImage", video: "takeVideo" }, gives: ["image", "video"], stage: "stable" },
  { id: "interp", icon: "gauge", src: "interp.html", group: 4, home: true, deps: [{ id: "rife" }, { id: "ffmpeg" }], accepts: { video: "takeVideo" }, gives: ["video"], stage: "beta" },
  { id: "framegrab", icon: "camera", src: "framegrab.html", group: 4, home: true, deps: [{ id: "ffmpeg" }], accepts: { video: "takeVideo" }, gives: ["image"], roundTrip: true, stage: "beta" },
  { id: "library", icon: "library", group: 5, home: true, stage: "stable" },
  { id: "settings", icon: "settings", place: "bottom", core: true, stage: "stable" }
];
// Downloadable components, kept in Documents\Halation\Tools (tool_install / tool_uninstall in Rust).
// mb: approximate download, shown before installing; its real size on disk is measured once installed.
const COMPONENTS = [
  { id: "ffmpeg", mb: 140 },
  { id: "ytdlp", mb: 18 },
  { id: "upscayl", mb: 10 },
  { id: "models", mb: 70 },
  { id: "cutout", mb: 445 },
  { id: "rife", mb: 180 },
  { id: "span", mb: 14 },
  { id: "pandoc", mb: 40 },
  { id: "libreoffice", mb: 360 },
  { id: "pdfium", mb: 4 },
  { id: "onnxruntime", mb: 36 },
  { id: "stems-hq4", mb: 59 },
  { id: "stems-htdemucs", mb: 170 }
];
// Tabs that take a kind of content ("video"…), in rail order
const accepting = (kind, settings) => MODULES.filter(m => !!(m.accepts && m.accepts[kind]) && enabled(m, settings));
const byId = id => MODULES.find(m => m.id === id) || null;
// Modules the user turned off live in Settings\app.json → settings.modules ({ id: false }); core ones never are
const enabled = (m, settings) => !!m && (m.core || !(settings && settings.modules && settings.modules[m.id] === false));
window.__modules = { MODULES, COMPONENTS, byId, enabled, accepting };
})();
