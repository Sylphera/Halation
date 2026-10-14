// Node replica of the commands in src-tauri/src/main.rs over a temporary folder,
// to test the interface in Chromium without Windows.
const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");
const CHRT = process.platform === "linux" && spawnSync("chrt", ["-i", "0", "true"]).status === 0;
const crypto = require("crypto");
const http = require("http");
// Test fixtures use a Node shebang. Windows needs the interpreter explicitly; production binaries stay untouched.
function fixtureCommand(bin, args) {
  if (process.platform !== "win32") return [bin, args];
  const fd = fs.openSync(bin, "r"), prefix = Buffer.alloc(64);
  try { fs.readSync(fd, prefix, 0, prefix.length, 0); } finally { fs.closeSync(fd); }
  return prefix.toString().startsWith("#!/usr/bin/env node") ? [process.execPath, [bin, ...args]] : [bin, args];
}

const FONT_EXT = ["ttf", "otf", "woff", "woff2"];
const LAYOUT = [["Presets", "Visualizer"], ["Presets", "Grade"], ["Exports", "Videos"], ["Exports", "Covers"], ["Exports", "Upscaled"], ["Downloads", "Video"], ["Downloads", "Audio"], ["Downloads", "Covers"], ["Resources", "Fonts"], ["Resources", "Logos"], ["Tools"], ["Settings"]];
const MODELS = ["upscayl-standard-4x", "digital-art-4x", "ultrasharp-4x", "upscayl-lite-4x"];

const fileStem = n => {
  let s = Array.from(String(n).replace(/[\u0000-\u001f\u007f-\u009f\\/:*?"<>|]/g, "-")).slice(0, 120).join("");
  s = s.trim().replace(/[. ]+$/, "");
  if (!s) s = "preset";
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(s)) s += "_";
  return s;
};
const extOf = n => (path.extname(n).slice(1) || "").toLowerCase();
const safeId = s => String(s).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 56);

// opts.tools: { upscalerInstalled: {bin, models} (an existing Upscayl install), upscalerSource: {bin, models} (what
// "Download upscaler" copies), ytdlpSource, ffmpegSource (files copied by the installs), web: { url: string|Buffer } }
function createHost(root, opts = {}) {
  const tools = opts.tools || {};
  tools.resources = tools.resources || { cores: 8, ramTotalMB: 16384, ramFreeMB: 12000, gpu: { name: "Mock GPU", vramMB: 8192, vramFreeMB: 7000 }, diskFreeMB: 200000 };
  const base = path.join(root, "Documents", "Halation");
  const dir = (...parts) => { const d = path.join(base, ...parts); fs.mkdirSync(d, { recursive: true }); return d; };
  for (const l of LAYOUT) dir(...l);
  const log = [], exports = new Map();
  let nextExport = 1, fullscreen = false;
  const opened = { queue: [], allowed: new Set() };
  const statePath = () => path.join(dir("Settings"), "app.json");
  const readState = () => { try { return JSON.parse(fs.readFileSync(statePath(), "utf8")); } catch (e) { return {}; } };
  const writeState = m => fs.writeFileSync(statePath(), JSON.stringify(m, null, 2));
  const PRESET_DIRS = { visualizer: ["Visualizer"], grade: ["Grade"] };
  const presetDir = kind => { if (!PRESET_DIRS[kind]) throw new Error("unknown kind " + kind); return dir("Presets", ...PRESET_DIRS[kind]); };
  const checkStem = n => { if (fileStem(n) !== n) throw new Error("invalid file name: " + n); };
  const exportDir = name => ["mp4", "webm", "mov", "mkv"].includes(extOf(name)) ? dir("Exports", "Videos") : ["png", "jpg", "jpeg", "webp"].includes(extOf(name)) ? dir("Exports", "Covers") : base;
  const cleanFilename = name => { const e = extOf(name), st = fileStem(path.basename(name, path.extname(name)) || "halation"); return e ? `${st}.${safeId(e)}` : st; };
  const uniquePath = (d, name) => {
    let p = path.join(d, name); if (!fs.existsSync(p)) return p;
    const e = path.extname(name), st = path.basename(name, e);
    for (let n = 2; ; n++) { p = path.join(d, `${st} (${n})${e}`); if (!fs.existsSync(p)) return p; }
  };
  const destinations = new Map(), completedExports = new Set();
  let nextSave = undefined;
  const pickPath = (name, direct, kind, folder) => {
    name = cleanFilename(name);
    const ask = ["ask", "ask-every-time"].includes((readState().settings || {}).saveMode);
    const last = (readState().exportLocation || {}).lastManualDirectory;
    let p;
    if (ask) {
      log.push(["dialog", name, last && fs.existsSync(last) ? last : null]);
      p = nextSave !== undefined ? nextSave : kind === "session" && tools.sessionSavePath !== undefined ? tools.sessionSavePath : uniquePath(last && fs.existsSync(last) ? last : exportDir(name), name);
      nextSave = undefined;
    } else { const d = kind === "session" ? dir("Sessions") : kind ? dir(...outDir(kind)) : exportDir(name); const grouped = folder ? path.join(d, ...folder.split(/[\\/]/).filter(p => p && p !== "." && p !== "..").map(fileStem)) : d; fs.mkdirSync(grouped, {recursive:true}); p = uniquePath(grouped, name); }
    if (p) { destinations.set(p, ask); completedExports.delete(p); }
    return p;
  };
  const entries = kind => fs.readdirSync(presetDir(kind)).filter(f => extOf(f) === "json").map(f => {
    const p = path.join(presetDir(kind), f), st = fs.statSync(p);
    return { name: path.basename(f, ".json"), p, st };
  }).filter(e => e.st.isFile()).sort((a, b) => a.name < b.name ? -1 : 1);
  const findAsset = id => {
    id = safeId(id); if (!id) return null;
    for (const d of [dir("Resources", "Fonts"), dir("Resources", "Logos")])
      for (const f of fs.readdirSync(d)) if (path.basename(f, path.extname(f)).toLowerCase() === id.toLowerCase()) return path.join(d, f);
    return null;
  };
  const insideBase = p => { const r = path.resolve(p); if (!destinations.has(p) && ![...destinations.keys()].some(d => fs.existsSync(d) && fs.statSync(d).isDirectory() && r.startsWith(d + path.sep)) && !r.startsWith(base) && !r.startsWith(path.join(root, "LocalAppData", "Halation", "workspace"))) throw new Error("path outside the folder"); if (!fs.existsSync(r)) throw new Error("the file no longer exists"); return r; };
  // events to the page (set by bindPage), sent in order
  let emitChain = Promise.resolve(), emitter = null;
  const emit = (ev, payload) => { if (emitter) emitChain = emitChain.then(() => emitter(ev, payload)).catch(() => {}); return emitChain; };
  const toolsDir = () => dir("Tools");
  const modelsIn = d => fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith(".param") && fs.existsSync(path.join(d, f.replace(/\.param$/, ".bin")))).map(f => f.slice(0, -6)).sort() : [];
  const findUpscaler = () => {
    const own = { bin: path.join(toolsDir(), "upscayl", "bin", "upscayl-bin"), models: path.join(toolsDir(), "upscayl", "models"), source: "downloaded" };
    for (const c of [tools.upscalerInstalled && { ...tools.upscalerInstalled, source: "installed" }, own].filter(Boolean)) {
      if (fs.existsSync(c.bin) && modelsIn(c.models).length) return c;
    }
    return null;
  };
  const findYtdlp = () => { const p = path.join(toolsDir(), "yt-dlp"); return fs.existsSync(p) ? p : null; };
  const findFfmpeg = () => { const p = path.join(toolsDir(), "ffmpeg", "ffmpeg"); return fs.existsSync(p) ? p : (tools.systemFfmpeg || null); };
  // cutout.rs: the runtime's WebAssembly, SAM's encoders (GPU and CPU), its decoder and their licence in
  // Tools\cutout; the earlier models' files go; the model's masks in Tools\cache\cutout
  const CUT = { wasm: "ort-wasm-simd-threaded.asyncify.wasm", model: "sam21-base-plus-encoder-fp16.onnx", cpu: "sam21-base-plus-encoder.onnx", decoder: "sam21-base-plus-decoder.onnx", license: "SAM2-LICENSE.txt" };
  const OLD_CUT = ["u2net.onnx", "birefnet-general-fp16.onnx", "birefnet-lite.onnx", "BiRefNet-LICENSE.txt"];
  const profDir = area => { if (area === "profile") return dir("Settings", "Profile"); if (area === "references") return dir("Settings", "Profile", "References"); if (area === "feed") return dir("Tools", "cache", "covertest"); throw new Error("unknown area: " + area); };
  const profFile = (area, name) => { const m = /^(.+)\.(webp|json|jpg)$/.exec(String(name || "")); if (!m || safeId(m[1]) !== m[1]) throw new Error("invalid file name"); return path.join(profDir(area), name); };
  const findCutout = () => { const d = path.join(toolsDir(), "cutout"), [w, m, c, k] = ["wasm", "model", "cpu", "decoder"].map(f => path.join(d, CUT[f])); return [w, m, c, k].every(f => fs.existsSync(f)) ? { dir: d, wasm: w, model: m, cpu: c, decoder: k } : null; };
  // interp.rs: RIFE's program and its rife-v4.6 model in Tools\rife
  const findRife = () => { const d = path.join(toolsDir(), "rife"), bin = path.join(d, "rife-ncnn-vulkan"), m = path.join(d, "rife-v4.6"); return fs.existsSync(bin) && ["param", "bin"].every(e => fs.existsSync(path.join(m, "flownet." + e))) ? { bin, model: m, source: "downloaded" } : null; };
  const workFolder = p => { const r = path.resolve(p); if (path.dirname(r) !== wsTemp() || !/^(interp-|j_)/.test(path.basename(r)) || safeId(path.basename(r)) !== path.basename(r)) throw new Error("not a work folder of Frame rate"); return r; };
  const cacheFile = key => { if (!key || key.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 56) !== key) throw new Error("invalid cache key"); return wsFile("masks", key); };
  const spanAt = s => s && fs.existsSync(s.bin) && ["spanx2_ch52", "spanx4_ch52"].every(m => modelsIn(s.models).includes(m)) ? { ...s, available: modelsIn(s.models) } : null;
  const ownSpan = () => ({ bin: path.join(toolsDir(), "span", "span-ncnn-vulkan.exe"), models: path.join(toolsDir(), "span", "models") });
  const findSpan = () => spanAt(tools.span && { ...tools.span, source: "custom" }) || spanAt({ ...ownSpan(), source: "downloaded" });
  const findFfprobe = () => tools.systemFfprobe || null;
  // stems.rs: ONNX Runtime's two DLLs in Tools\stems\runtime, the models in Tools\stems (present = the exact size)
  const STEMS = { onnxruntime: [["runtime", "onnxruntime.dll"], ["runtime", "DirectML.dll"]], "stems-hq4": [["UVR-MDX-NET-Inst_HQ_4.onnx"]], "stems-htdemucs": [["htdemucs-955717e8-dml4.onnx"]] };
  const stemsFile = (...p) => path.join(toolsDir(), "stems", ...p);
  const findStems = id => STEMS[id].every(p => fs.existsSync(stemsFile(...p))) ? stemsFile(...STEMS[id][0]) : null;
  // Converter's document engines: Halation's copy in Tools, or one "on PATH" (tools.systemPandoc…)
  const findPandoc = () => { const p = path.join(toolsDir(), "pandoc", "pandoc"); return fs.existsSync(p) ? p : (tools.systemPandoc || null); };
  const findSoffice = () => { const p = path.join(toolsDir(), "libreoffice", "app", "program", "soffice"); return fs.existsSync(p) ? p : (tools.systemSoffice || null); };
  const findPdfium = () => { const p = path.join(toolsDir(), "pdfium", "libpdfium.so"); return fs.existsSync(p) ? p : null; };
  const status = () => { const u = findUpscaler(); return { dir: toolsDir(), upscaler: u && { bin: u.bin, models: u.models, available: modelsIn(u.models), source: u.source }, span: findSpan(), ffprobe: findFfprobe(), wanted: MODELS, ytdlp: findYtdlp(), ffmpeg: findFfmpeg(), cutout: findCutout(), rife: findRife(), onnxruntime: findStems("onnxruntime"), "stems-hq4": findStems("stems-hq4"), "stems-htdemucs": findStems("stems-htdemucs"), pandoc: findPandoc(), libreoffice: findSoffice(), pdfium: findPdfium() }; };
  // storage.rs: sizes, unfinished downloads, Halation's own copy of each component
  const sizeOf = p => { let s; try { s = fs.lstatSync(p); } catch (e) { return 0; } return s.isFile() ? s.size : s.isDirectory() ? fs.readdirSync(p).reduce((a, f) => a + sizeOf(path.join(p, f)), 0) : 0; };
  const leftovers = d => { let out = []; try { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) out = out.concat(leftovers(p)); else if (/\.(part|zip)$/i.test(f)) out.push(p); } } catch (e) {} return out; };
  const OWN = { ffmpeg: ["ffmpeg"], ytdlp: ["yt-dlp"], upscayl: ["upscayl", "bin"], models: ["upscayl", "models"], cutout: ["cutout"], rife: ["rife"], span: ["span"], onnxruntime: ["stems", "runtime"], "stems-hq4": ["stems", "UVR-MDX-NET-Inst_HQ_4.onnx"], "stems-htdemucs": ["stems", "htdemucs-955717e8-dml4.onnx"], pandoc: ["pandoc"], libreoffice: ["libreoffice"], pdfium: ["pdfium"] };
  const components = () => {
    const u = tools.upscalerInstalled, ownBin = path.join(toolsDir(), "upscayl", "bin", "upscayl-bin"), ownModels = path.join(toolsDir(), "upscayl", "models");
    const found = { ffmpeg: findFfmpeg(), ytdlp: findYtdlp(), upscayl: fs.existsSync(ownBin) ? ownBin : u && fs.existsSync(u.bin) ? u.bin : null, models: modelsIn(ownModels).length ? ownModels : u && modelsIn(u.models).length ? u.models : null, cutout: findCutout() && findCutout().dir, rife: findRife() && path.dirname(findRife().bin) };
    Object.assign(found, { pandoc: findPandoc(), libreoffice: findSoffice(), pdfium: findPdfium() });
    found.span = fs.existsSync(path.join(toolsDir(), "span")) ? path.join(toolsDir(), "span") : findSpan() && path.dirname(findSpan().bin);
    found.onnxruntime = findStems("onnxruntime"); found["stems-hq4"] = findStems("stems-hq4"); found["stems-htdemucs"] = findStems("stems-htdemucs");
    return Object.entries(found).map(([id, p]) => { const own = !!p && p.startsWith(toolsDir()); return { id, path: p, own, size: own ? sizeOf(path.join(toolsDir(), ...OWN[id])) : 0, models: id === "models" && p ? modelsIn(p).length : 0, ready: id !== "span" || !!spanAt({ bin: path.join(p || "", "span-ncnn-vulkan.exe"), models: path.join(p || "", "models") }) }; });
  };
  const stalls = new Set();   // tools whose next download stops half-way, as download.rs reports it
  const copyWithProgress = async (tool, src, dest) => {
    const size = fs.statSync(src).size;
    if (stalls.delete(tool)) { await emit("tool-progress", { tool, file: path.basename(dest), done: Math.round(size / 2), total: size }); throw new Error("stalled: nothing received for 30 s"); }
    for (const f of [0.25, 0.5, 1]) { await emit("tool-progress", { tool, file: path.basename(dest), done: Math.round(size * f), total: size }); await new Promise(r => setTimeout(r, 30)); }
    fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(src, dest); fs.chmodSync(dest, 0o755);
  };
  const procsMap = new Map(); let nextProc = 1;
  const stemsStop = new Set();
  const LIB_MEDIA = ["png", "jpg", "jpeg", "webp", "svg", "gif", "avif", "webm", "mov", "mp4"];
  const libLinked = () => (((readState().library || {}).linked) || []).map(l => l && l.path).filter(Boolean);
  const libKnown = new Set();   // library.rs KNOWN: the index's paths, readable where they are
  const libReadable = p => { const r = path.resolve(p); if (!fs.existsSync(r)) throw new Error("the file no longer exists"); if (!r.startsWith(base) && !libLinked().some(l => r.startsWith(path.resolve(l))) && !(libKnown.has(p) && fs.statSync(r).isFile())) throw new Error("path outside the Library"); return r; };
  const LIB_SCAN = ["png", "jpg", "jpeg", "webp", "svg", "gif", "avif", "webm", "mov", "mp4", "mkv", "mp3", "wav", "opus", "m4a", "flac", "ogg", "ttf", "otf", "json"];
  const fileKey = p => { const st = fs.statSync(p, { bigint: true }); return `dev:${st.dev.toString(16).toUpperCase()}|ino:${st.ino.toString(16).toUpperCase()}`; };
  const libEntry = p => { const st = fs.statSync(p); return { path: p, name: path.basename(p), size: st.size, mtime: Math.round(st.mtimeMs), fileKey: fileKey(p) }; };
  const libScan = (d, depth, exts, out) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n), st = fs.statSync(p); if (st.isDirectory()) { if (depth > 0) libScan(p, depth - 1, exts, out); } else if (exts.includes(extOf(n))) out.push(libEntry(p)); } return out; };
  const libRemember = v => { libKnown.clear(); for (const i of (v && v.items) || []) if (i && i.path) libKnown.add(i.path); };
  const libStamp = d => { if (!fs.existsSync(d)) return [0, 0]; let n = 0, t = Math.round(fs.statSync(d).mtimeMs); for (const f of fs.readdirSync(d)) { const st = fs.statSync(path.join(d, f)); if (st.isFile() && LIB_MEDIA.includes(extOf(f))) { n++; t = Math.max(t, Math.round(st.mtimeMs)); } } return [n, t]; };
  // Raw answers (read_path, framegrab_read) as Tauri sends them, bytes and not base64: a large one is fetched from a
  // local server once (base64 through the page would cost the main thread what Tauri's IPC does not)
  const blobs = new Map(); let blobServer = null, blobId = 0;
  const bytesOut = async b => {
    if (b.length < 262144) return { __bytes: b.toString("base64") };
    if (!blobServer) {
      blobServer = http.createServer((req, res) => { const id = req.url.slice(1), d = blobs.get(id); blobs.delete(id); res.writeHead(d ? 200 : 404, { "access-control-allow-origin": "*", "content-type": "application/octet-stream" }); res.end(d || ""); }).listen(0, "127.0.0.1");
      blobServer.unref();
    }
    if (!blobServer.listening) await new Promise(r => blobServer.once("listening", r));
    const id = String(++blobId); blobs.set(id, b);
    return { __url: `http://127.0.0.1:${blobServer.address().port}/${id}` };
  };
  // framegrab.rs: its cache in %LOCALAPPDATA%\Halation\cache\framegrab; files chosen in its picker may be read anywhere
  const localDir = (...parts) => { const d = path.join(root, "LocalAppData", "Halation", ...parts); fs.mkdirSync(d, { recursive: true }); return d; };
  const fgCache = key => wsFile("frames", key);
  // workspace.rs: the jobs' work folders (temp\<job>) and one cache in areas under one budget (least recently used go first)
  const WS_AREAS = { frames: "bin", masks: "png", thumbs: "webp", probe: "json", proxy: "bin" };
  const wsTemp = () => localDir("workspace", "temp");
  const wsFile = (area, key) => { if (!WS_AREAS[area]) throw new Error("unknown cache area " + area); if (!key || safeId(key) !== key) throw new Error("invalid cache key"); return path.join(localDir("workspace", "cache", area), key + "." + WS_AREAS[area]); };
  const wsUsed = new Map(), wsPinned = new Set();
  const wsBudget = () => tools.wsBudget || Math.min(262144, Math.max(256, +(((readState().settings || {}).workspace || {}).budgetMB) || 8192)) * 1048576;
  const wsEntries = () => Object.keys(WS_AREAS).flatMap(a => fs.readdirSync(localDir("workspace", "cache", a)).map(f => { const p = path.join(localDir("workspace", "cache", a), f), k = a + "/" + path.basename(f, path.extname(f)); return { k, p, size: fs.statSync(p).size, used: wsUsed.get(k) || fs.statSync(p).mtimeMs }; }));
  const wsGet = (area, key) => { const p = wsFile(area, key); if (!fs.existsSync(p)) return { __bytes: "" }; wsUsed.set(area + "/" + key, Date.now() + (wsUsed.size * 1e-3)); return { __bytes: fs.readFileSync(p).toString("base64") }; };
  const wsPut = (area, key, bytes) => {
    fs.writeFileSync(wsFile(area, key), bytes); wsUsed.set(area + "/" + key, Date.now() + (wsUsed.size * 1e-3));
    const list = wsEntries(); let total = list.reduce((a, e) => a + e.size, 0);
    for (const e of list.filter(e => !wsPinned.has(e.k)).sort((a, b) => a.used - b.used)) { if (total <= wsBudget()) break; fs.unlinkSync(e.p); wsUsed.delete(e.k); total -= e.size; }
    return null;
  };
  const wsClean = live => {
    let freed = 0; const keep = new Set(live || []);
    for (const f of fs.readdirSync(wsTemp())) { if (keep.has(f)) continue; const p = path.join(wsTemp(), f), n = sizeOf(p); try { fs.rmSync(p, { recursive: true }); freed += n; } catch (e) {} }
    for (const e of wsEntries()) if (!wsPinned.has(e.k)) { try { fs.unlinkSync(e.p); freed += e.size; wsUsed.delete(e.k); } catch (err) {} }
    return freed;
  };
  const jobTrees = new Map();
  const picked = new Set();
  let rangeServer = null;
  const fgRange = (p, start, end) => {
    const f = fgReadable(p), size = fs.statSync(f).size, e = Math.min(end, size, start + 16 * 1024 * 1024);
    if (e <= start) return Buffer.alloc(0);
    const fd = fs.openSync(f, "r"), b = Buffer.alloc(e - start); fs.readSync(fd, b, 0, b.length, start); fs.closeSync(fd); return b;
  };
  const fgReadable = p => { const r = path.resolve(p); if (picked.has(r) && fs.existsSync(r)) return r; return insideBase(p); };
  const libThumb = key => wsFile("thumbs", key);
  const encoders = new Map(), folders = new Set(), encStats = { bytes: 0, ipc: 0 }; let nextEnc = 1;
  const outDir = kind => ({ converted: ["Exports", "Converted"], stems: ["Exports", "Stems"], video: ["Downloads", "Video"], audio: ["Downloads", "Audio"], cover: ["Downloads", "Covers"], upscaled: ["Exports", "Upscaled"], cutout: ["Exports", "Cutouts"], frames: ["Exports", "Frames"], interp: ["Exports", "Interpolated"], layers: ["Exports", "Videos"], "library-frames": ["Library", "Frames"] })[kind];
  const fakeFonts = ["DejaVu Sans", "DejaVu Serif", "DejaVu Sans Mono", "Liberation Serif", "Liberation Sans"];
  for (let i = 1; i <= 320; i++) fakeFonts.push(`Fake Font ${String(i).padStart(3, "0")}`);

  // state.rs: sessions. begin() is what the app does at start (a test calls it before opening the page)
  const temporary = k => ["grade","visualizer","visualizerExport","upscale","upscaleVideo","interp","removebg","framegrab","covertest","convert"].includes(k);
  let runtimeTools = {};
  const permanent = (key,v) => Object.fromEntries((key === "visualizer" ? ["fonts","presets","updatedAt"] : key === "grade" ? ["looks"] : []).filter(k => v && k in v).map(k=>[k,v[k]]));
  const recoveryPath = () => path.join(dir("Sessions"), ".recovery.json");
  const validSession = v => v && v.app === "halation-session" && v.version === 1 && v.tools && typeof v.tools === "object" && !Array.isArray(v.tools);
  const atomic = (p,v) => { fs.writeFileSync(p+".tmp",JSON.stringify(v));fs.renameSync(p+".tmp",p); };
  const session = { recovered: false, asked: null, quit: 0, memoryLow: [] };
  const begin = () => {
    const m = readState(); let crashed = false;
    try { crashed = validSession(JSON.parse(fs.readFileSync(recoveryPath(),"utf8"))); } catch(e) {}
    if (!m.profiles && m.covertest?.refs) m.profiles = { references:m.covertest.refs };
    delete m.intro; // Legacy removed tool state.
    for (const k of Object.keys(m).filter(temporary)) { const v=permanent(k,m[k]); if(Object.keys(v).length)m[k]=v;else delete m[k]; }
    runtimeTools = {};
    m.session = { open: true }; writeState(m);
    session.recovered = crashed; session.quit = 0;
    return crashed;
  };
  const endSession = () => { if(fs.existsSync(recoveryPath()))fs.unlinkSync(recoveryPath()); const m = readState(); m.session = { open: false }; writeState(m); };

  // convert.rs replica (see the convert_* commands)
  const cvReserved = new Set();
  const cvAllowed = p => { const r = path.resolve(p); if (!fs.existsSync(r)) throw new Error("the file no longer exists"); if (picked.has(r) || r.startsWith(base) || r.startsWith(localDir("workspace"))) return r; throw new Error("path not opened in Halation"); };
  const cvWalk = root => { const out = []; const walk = (d, rel) => { for (const n of fs.readdirSync(d).sort()) { if (n.startsWith(".")) continue; const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p, rel + "/" + n); else out.push({ path: p, name: n, rel }); } }; walk(root, path.basename(root)); return out; };
  const CV_MUX = { mp4: "mp4", mov: "mov", mkv: "matroska", webm: "webm", gif: "gif", webp: "webp", mp3: "mp3", m4a: "ipod", flac: "flac", wav: "wav", ogg: "ogg", opus: "opus", aiff: "aiff" };
  const CV_ENC = { mp3: "libmp3lame", m4a: "aac", flac: "flac", wav: "pcm_s16le", ogg: "libvorbis", opus: "libopus", aiff: "pcm_s16be" };
  const CV_COPY = { mp3: ["mp3"], m4a: ["aac", "alac"], flac: ["flac"], wav: ["pcm_s16le", "pcm_s24le"], ogg: ["vorbis"], opus: ["opus"], aiff: ["pcm_s16be", "pcm_s24be"] };
  const CV_VFITS = { mp4: ["h264", "hevc", "av1"], mov: ["h264", "hevc", "prores"], webm: ["vp8", "vp9", "av1"] };
  const CV_AFITS = { mp4: ["aac", "mp3", "ac3", "eac3", "alac"], mov: ["aac", "mp3", "ac3", "alac"], webm: ["vorbis", "opus"] };
  const cvExt = n => ({ jpeg: "jpg", tif: "tiff", aif: "aiff", oga: "ogg", m4v: "mp4" })[extOf(n)] || extOf(n);
  const cvProbe = p => {
    const size = fs.statSync(p).size, named = cvExt(p), head = Buffer.alloc(64), fd = fs.openSync(p, "r"), got = fs.readSync(fd, head, 0, 64, 0); fs.closeSync(fd);
    const ffmpeg = !!findFfmpeg(), enc = ["libx264", "libvpx-vp9", "libwebp_anim", "gif", "mov_text", "webvtt", ...Object.values(CV_ENC)].filter(e => !(tools.encodersMissing || []).includes(e));
    const sig = head.slice(0, 4).toString("latin1"), img = head[0] === 0x89 && sig.slice(1) === "PNG" ? "png" : head[0] === 0xff && head[1] === 0xd8 ? "jpg" : sig === "GIF8" ? "gif" : sig === "RIFF" && head.slice(8, 12).toString() === "WEBP" ? "webp" : sig.slice(0, 2) === "BM" ? "bmp" : head.slice(4, 12).toString("latin1") === "ftypavif" ? "avif" : null;
    let src = { class: "unsupported", format: named, named, mismatch: false, streams: [], duration: 0, width: 0, height: 0, frames: 0, alpha: false, hdr: false, fewColours: false, size, needsFfmpeg: false, pages: 0 };
    const have = { ffmpeg, pandoc: !!findPandoc(), libreoffice: !!findSoffice(), pdfium: !!findPdfium() };
    const doc = cvDoc(p, head.slice(0, got), named);
    if (doc) {
      src = { ...src, class: doc[0], format: doc[1], mismatch: CV_DOC_EXT.includes(named) && named !== doc[1] };
      if (doc[0] === "pdf" && have.pdfium) src.pages = cvPages(p);
      return { ...src, outputs: cvDocOuts(src), ffmpeg, have };
    }
    const probeJson = () => { const r = spawnSync(path.join(path.dirname(tools.ffmpegSource || "/usr/bin/ffmpeg"), "ffprobe"), ["-v", "error", "-show_streams", "-show_format", "-of", "json", p]); return r.status === 0 ? JSON.parse(r.stdout.toString()) : null; };
    if (img) {
      const all = fs.readFileSync(p), animated = img === "gif" ? all.toString("latin1").split("\x21\xf9\x04").length > 2 : img === "webp" && all.includes(Buffer.from("ANIM"));
      src = { ...src, class: animated ? "animated" : "image", format: img, frames: animated ? 2 : 1, needsFfmpeg: img === "avif" && !ffmpeg, mismatch: named !== img };
      if (img === "png") { src.width = head.readUInt32BE(16); src.height = head.readUInt32BE(20); src.alpha = [4, 6].includes(head[25]); }
      if (ffmpeg) { const j = probeJson(), v = j && (j.streams || []).find(s => s.codec_type === "video"); if (v) { src.width = v.width; src.height = v.height; if (img !== "png") src.alpha = /rgba|bgra|argb|pal8|ya/.test(v.pix_fmt || ""); } }
    } else if (ffmpeg) {
      const j = probeJson();
      if (j) {
        const streams = (j.streams || []).map(s => ({ index: s.index, kind: s.codec_type, codec: s.codec_name, cover: !!(s.disposition && s.disposition.attached_pic), width: s.width || 0, height: s.height || 0, pixFmt: s.pix_fmt || "", channels: s.channels || 0, rate: +s.sample_rate || 0, bits: 0, float: false, lang: "" }));
        const v = streams.find(s => s.kind === "video" && !s.cover), a = streams.some(s => s.kind === "audio"), fn = (j.format || {}).format_name || "";
        const cls = v ? "video" : a ? "audio" : "unsupported";
        const format = fn.includes("matroska") ? (named === "webm" ? "webm" : "mkv") : fn.startsWith("mov,mp4") ? (["mov", "m4a", "mp4"].includes(named) ? named : v ? "mp4" : "m4a") : fn.split(",")[0];
        const fam = [["mp4", "m4a", "mov"], ["mkv", "webm"], ["ogg", "opus"]];
        src = { ...src, class: cls, format, streams, duration: +((j.format || {}).duration) || 0, width: v ? v.width : 0, height: v ? v.height : 0, mismatch: cls !== "unsupported" && named !== format && !fam.some(f => f.includes(named) && f.includes(format)) };
      }
    } else if (["mp3", "m4a", "flac", "wav", "ogg", "opus", "aiff"].includes(named)) src = { ...src, class: "audio", needsFfmpeg: true };
    else if (["mp4", "mkv", "webm", "mov", "avi"].includes(named)) src = { ...src, class: "video", needsFfmpeg: true };
    const has = e => !ffmpeg || enc.includes(e);
    const a0 = src.streams.find(s => s.kind === "audio"), v0 = src.streams.find(s => s.kind === "video" && !s.cover), subs = src.streams.filter(s => s.kind === "subtitle");
    const audioOut = (id, audio) => { const copy = !!a0 && (CV_COPY[id] || []).includes(a0.codec); if (!copy && !has(CV_ENC[id])) return null; const notes = [copy ? "copy" : "reencodeAudio"]; if (!copy && a0 && ["mp3", "aac", "vorbis", "opus"].includes(a0.codec) && ["flac", "wav", "aiff"].includes(id)) notes.push("noBetter"); return { id, audio, ffmpeg: true, notes, copy }; };
    let outs = [];
    if (src.class === "image") outs = ["png", "jpg", "webp", "tiff", "bmp", "ico", "gif"].filter(id => id !== src.format).map(id => ({ id, audio: false, ffmpeg: src.format === "avif", notes: id === "jpg" && src.alpha ? ["white"] : [], copy: false }));
    else if (src.class === "animated") outs = (src.format === "webp" ? ["gif", "png"] : ["mp4", "webm", "webp", "png"]).map(id => ({ id, audio: false, ffmpeg: id !== "png" && src.format !== "webp", notes: id === "png" ? ["firstFrame"] : [], copy: false })).filter(o => !o.ffmpeg || has({ mp4: "libx264", webm: "libvpx-vp9", webp: "libwebp_anim", gif: "gif" }[o.id]));
    else if (src.class === "audio") outs = ["mp3", "m4a", "flac", "wav", "ogg", "opus", "aiff"].filter(id => id !== src.format).map(id => audioOut(id, false)).filter(Boolean);
    else if (src.class === "video") {
      outs = ["mp4", "mkv", "webm", "mov", "gif"].filter(id => id !== src.format).map(id => {
        if (id === "gif") return has("gif") ? { id, audio: false, ffmpeg: true, notes: src.duration > 30 ? ["reencode", "longGif"] : ["reencode"], copy: false } : null;
        const vfits = id === "mkv" || !!v0 && (CV_VFITS[id] || []).includes(v0.codec), afits = src.streams.filter(s => s.kind === "audio").every(s => id === "mkv" || (CV_AFITS[id] || []).includes(s.codec));
        if (!vfits && !has(id === "webm" ? "libvpx-vp9" : "libx264")) return null;
        const notes = [vfits && afits ? "copy" : vfits ? "copyVideo" : "reencode"];
        if (id !== "mkv" && subs.some(s => !["subrip", "ass", "ssa", "mov_text", "webvtt"].includes(s.codec))) notes.push("subsDropped");
        return { id, audio: false, ffmpeg: true, notes, copy: vfits && afits };
      }).filter(Boolean);
      if (a0) outs.push(...["mp3", "m4a", "flac", "wav", "opus"].map(id => audioOut(id, true)).filter(Boolean));
    }
    for (const o of outs) o.tools = o.ffmpeg ? ["ffmpeg"] : [];
    return { ...src, outputs: outs, ffmpeg, have };
  };
  // documents (convert.rs probe_doc, zip_kind, route, doc_steps): a zip's parts found in its bytes; PDF pages by pdfinfo,
  // drawn by pdftoppm (PDFium's stand-in)
  const CV_DOC_EXT = ["pdf", "docx", "doc", "odt", "rtf", "xlsx", "xls", "ods", "csv", "pptx", "ppt", "odp", "md", "html", "epub", "tex", "org", "dbk"];
  const cvDoc = (p, head, named) => {
    named = { markdown: "md", htm: "html", xhtml: "html", latex: "tex" }[named] || named;
    if (head.slice(0, 4).toString("latin1") === "%PDF") return ["pdf", "pdf"];
    if (head.slice(0, 4).toString("latin1") === "PK\x03\x04") {
      const all = fs.readFileSync(p).toString("latin1"), mt = /^mimetype(application\/[a-z.+-]+)/.exec(all.slice(30));
      if (mt) return { "application/epub+zip": ["markup", "epub"], "application/vnd.oasis.opendocument.text": ["document", "odt"], "application/vnd.oasis.opendocument.spreadsheet": ["sheet", "ods"], "application/vnd.oasis.opendocument.presentation": ["slides", "odp"] }[mt[1]] || null;
      return all.includes("word/document.xml") ? ["document", "docx"] : all.includes("xl/workbook.xml") ? ["sheet", "xlsx"] : all.includes("ppt/presentation.xml") ? ["slides", "pptx"] : null;
    }
    if (head.slice(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return { doc: ["document", "doc"], xls: ["sheet", "xls"], ppt: ["slides", "ppt"] }[named] || null;
    if (head.slice(0, 5).toString("latin1") === "{\\rtf") return ["document", "rtf"];
    if (head.length && !head.includes(0)) return ["md", "html", "tex", "org", "dbk"].includes(named) ? ["markup", named] : named === "csv" ? ["sheet", "csv"] : null;
    return null;
  };
  const cvPages = p => { const r = spawnSync("pdfinfo", [p]); const m = /Pages:\s+(\d+)/.exec(String(r.stdout || "")); if (r.status !== 0 || !m) throw new Error("PDFium could not read the PDF"); return +m[1]; };
  const cvRoute = (cls, format, target) => cls === "document" && ["md", "html", "epub"].includes(target) ? (format === "doc" ? "officePandoc" : "pandoc") : ["document", "sheet", "slides"].includes(cls) ? "office" : cls === "markup" ? (target === "pdf" ? "pandocOffice" : "pandoc") : null;
  const cvDocOuts = src => {
    const table = { document: ["pdf", "docx", "odt", "rtf", "md", "html", "epub"], sheet: ["pdf", "xlsx", "ods", "csv"], slides: ["pdf", "pptx", "odp"], markup: ["html", "docx", "odt", "epub", "md", "pdf"], pdf: ["png", "jpg"] }[src.class];
    return table.filter(id => id !== src.format).map(id => {
      if (src.class === "pdf") return { id, audio: false, ffmpeg: false, tools: ["pdfium"], notes: src.pages !== 1 ? ["pages"] : [], copy: false };
      const route = cvRoute(src.class, src.format, id), notes = [];
      if (route === "office") { if (id !== "pdf") notes.push("layout"); } else notes.push("structure");
      if (id === "md" && src.class !== "markup") notes.push("noPictures");
      if (id === "csv" && src.format !== "csv") notes.push("firstSheet");
      return { id, audio: false, ffmpeg: false, tools: route === "office" ? ["libreoffice"] : route === "pandoc" ? ["pandoc"] : ["libreoffice", "pandoc"], notes, copy: false };
    });
  };
  const cvSteps = (src, target, input, work) => {
    const FILTER = { docx: "docx:MS Word 2007 XML", xlsx: "xlsx:Calc MS Excel 2007 XML", pptx: "pptx:Impress MS PowerPoint 2007 XML", csv: "csv:Text - txt - csv (StarCalc):44,34,76,1" };
    const READ = { html: "html", epub: "epub", tex: "latex", org: "org", dbk: "docbook", docx: "docx", odt: "odt", rtf: "rtf" }, WRITE = { html: "html5", epub: "epub3", docx: "docx", odt: "odt" };
    const office = (from, to, outdir) => [{ tool: "soffice", args: ["-env:UserInstallation=file://" + path.join(work, "lo-profile"), "--headless", "--invisible", "--norestore", "--nolockcheck", "--nodefault", ...(extOf(from) === "csv" ? ["--infilter=CSV:44,34,76,1"] : []), "--convert-to", FILTER[to] || to, "--outdir", outdir, from] }, path.join(outdir, path.basename(from, path.extname(from)) + "." + to)];
    const pandoc = (from, reader, to, out) => [{ tool: "pandoc", args: [from, "-f", reader, "-t", WRITE[to] || "gfm", "-s", "--resource-path", path.dirname(input), ...(to === "html" ? ["--embed-resources"] : []), "-o", out] }, out];
    const outDir = path.join(work, "out"), mid = path.join(work, "mid");
    for (const d of [outDir, mid]) fs.mkdirSync(d, { recursive: true });
    const route = cvRoute(src.class, src.format, target);
    if (route === "office") { const [a, r] = office(input, target, outDir); return [[a], r]; }
    if (route === "pandoc") { const [a, r] = pandoc(input, READ[src.format] || "markdown", target, path.join(outDir, "converted." + target)); return [[a], r]; }
    if (route === "officePandoc") { const [a, m] = office(input, "docx", mid), [b, r] = pandoc(m, "docx", target, path.join(outDir, "converted." + target)); return [[a, b], r]; }
    const [a, m] = pandoc(input, READ[src.format] || "markdown", "docx", path.join(mid, "converted.docx")), [b, r] = office(m, target, outDir); return [[a, b], r];
  };
  // FFmpeg's arguments for an output (the plan of convert.rs, shortened: copies stay copies)
  const cvArgs = (src, o) => {
    const v0 = src.streams.find(s => s.kind === "video" && !s.cover), a0 = src.streams.find(s => s.kind === "audio");
    if (src.class === "animated") return { mp4: ["-an", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", "-c:v", "libx264", "-pix_fmt", "yuv420p"], webm: ["-an", "-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8"], webp: ["-an", "-c:v", "libwebp_anim", "-loop", "0"] }[o.id];
    if (o.audio || src.class === "audio") return ["-map", "0:" + a0.index, "-vn", ...(o.copy ? ["-c:a", "copy"] : ["-c:a", CV_ENC[o.id]]), ...(o.id === "opus" && !o.copy ? ["-ar", "48000"] : [])];
    if (o.id === "gif") return ["-map", "0:" + v0.index, "-an", "-vf", "fps=15,scale='min(480,iw)':-2", "-loop", "0"];
    const vfits = o.notes[0] !== "reencode";
    return ["-map", "0:" + v0.index, ...(a0 ? ["-map", "0:a"] : []), ...(vfits ? ["-c:v", "copy"] : o.id === "webm" ? ["-c:v", "libvpx-vp9", "-deadline", "realtime", "-cpu-used", "8"] : ["-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p"]),
      ...(a0 ? (o.copy || o.id === "mkv" ? ["-c:a", "copy"] : ["-c:a", o.id === "webm" ? "libopus" : "aac"]) : [])];
  };
  const cmds = {
    state_get: ({ key }) => temporary(key) ? (runtimeTools[key] ? {...(readState()[key] || {}),...runtimeTools[key]} : readState()[key] ?? null) : readState()[key] ?? null,
    state_set: ({key,value}) => { const m=readState();if(temporary(key)){runtimeTools[key]=value;const v=permanent(key,value);if(Object.keys(v).length)m[key]=v;else delete m[key];}else m[key]=value;writeState(m);return null; },
    session_state: () => runtimeTools,
    session_replace: ({tools}) => { runtimeTools=tools; },
    session_recovery: () => { try { const v=JSON.parse(fs.readFileSync(recoveryPath(),"utf8"));return validSession(v)?v:null; }catch(e){return null;} },
    session_recovery_write: ({snapshot}) => {if(!validSession(snapshot))throw Error("Invalid session");atomic(recoveryPath(),snapshot);},
    session_discard: () => {if(fs.existsSync(recoveryPath()))fs.unlinkSync(recoveryPath());},
    session_pick: ({save}) => save ? (tools.sessionSavePath === null ? null : tools.sessionSavePath || path.join(dir("Sessions"),"Session.halation-session")) : tools.sessionOpenPath || null,
    session_write: ({path:p,snapshot}) => {if(tools.sessionWriteError)throw Error(tools.sessionWriteError);if(!validSession(snapshot))throw Error("Invalid session");atomic(p,snapshot);},
    session_read: ({path:p}) => {const v=JSON.parse(fs.readFileSync(p,"utf8"));if(!validSession(v))throw Error("Invalid session");return v;},
    session_file_put: (_,bytes,h) => {const p=uniquePath(dir("Sessions",".media"),cleanFilename(decodeURIComponent(h["x-name"]||"media.bin")));fs.writeFileSync(p,bytes);return p;},
    session_file_read: ({path:p}) => ({__bytes:fs.readFileSync(p).toString("base64")}),
    session_file_reference: ({path:p}) => {if(!fs.existsSync(p))throw Error("Missing file "+p);if(!p.startsWith(localDir("workspace")))return p;const q=uniquePath(dir("Sessions",".media"),path.basename(p));fs.copyFileSync(p,q);return q;},
    session_allow_video: ({path:p}) => {if(!fs.existsSync(p))throw Error("Missing file "+p);picked.add(p);},
    preset_list: ({ kind }) => entries(kind).map(e => ({ name: e.name, content: fs.readFileSync(e.p, "utf8").replace(/^﻿/, ""), modified: Math.round(e.st.mtimeMs) })),
    preset_stamp: ({ kind }) => entries(kind).map(e => `${e.name}:${Math.round(e.st.mtimeMs)}:${e.st.size}`).join("|"),
    preset_write: ({ kind, name, content }) => { checkStem(name); fs.writeFileSync(path.join(presetDir(kind), name + ".json"), content); return null; },
    preset_delete: ({ kind, name }) => { checkStem(name); const p = path.join(presetDir(kind), name + ".json"); if (!fs.existsSync(p)) return false; fs.unlinkSync(p); return true; },
    preset_rename: ({ kind, from, to, copy }) => {
      checkStem(from); checkStem(to);
      const src = path.join(presetDir(kind), from + ".json"), dst = path.join(presetDir(kind), to + ".json");
      if (!fs.existsSync(src)) throw new Error(`"${from}" no longer exists`);
      if (fs.existsSync(dst) && !( !copy && from.toLowerCase() === to.toLowerCase())) throw new Error(`"${to}" already exists`);
      if (copy) fs.copyFileSync(src, dst); else fs.renameSync(src, dst);
      return null;
    },
    export_destination: ({name, kind, folder}) => pickPath(name, false, kind, folder),
    export_completed: ({path:p}) => {
      if (!fs.existsSync(p)) throw new Error("The export was not created");
      if (!destinations.has(p) || completedExports.has(p)) return {fresh:false};
      const manual = destinations.get(p), state = readState(), v = state.exportLocation ||= {};
      if (manual) v.lastManualDirectory = path.dirname(p);
      const explain = !manual && !v.folderExplanationShown;
      if (explain) v.folderExplanationShown = true;
      writeState(state); completedExports.add(p); return {fresh:true, managed:!manual, explain};
    },
    export_copy: ({source, destination}) => { insideBase(source); if (!destinations.has(destination)) throw new Error("Destination was not selected"); fs.copyFileSync(source,destination); return destination; },
    save_file: (_, bytes, h) => { const p = h["x-path"] ? decodeURIComponent(h["x-path"]) : pickPath(h["x-filename"] ? decodeURIComponent(h["x-filename"]) : "archivo", h["x-direct"] === "1", h["x-kind"] ? decodeURIComponent(h["x-kind"]) : null); if (!p) return null; fs.writeFileSync(p, bytes); return p; },
    export_open: ({ name, direct, kind, path: selected }) => { const p = selected || pickPath(name, direct, kind); if (!p) return null; const fd = fs.openSync(p, "w"); const id = nextExport++; exports.set(id, { fd, p }); return { id, path: p }; },
    export_write: (_, bytes, h) => { const e = exports.get(+h["x-id"]); if (!e) throw new Error("export already closed"); fs.writeSync(e.fd, bytes, 0, bytes.length, +h["x-pos"]); return null; },
    export_close: ({ id }) => { const e = exports.get(id); if (!e) throw new Error("export already closed"); fs.closeSync(e.fd); exports.delete(id); return e.p; },
    export_abort: ({ id }) => { const e = exports.get(id); if (e) { fs.closeSync(e.fd); fs.unlinkSync(e.p); exports.delete(id); } return null; },
    files_exist: ({ paths }) => paths.map(p => fs.existsSync(p) && fs.statSync(p).isFile()),
    open_path: ({ path: p }) => { insideBase(p); return null; },
    reveal_path: ({ path: p }) => { if (!fs.existsSync(p) && !fs.existsSync(path.dirname(p))) throw new Error("The export folder no longer exists"); return null; },
    set_progress: () => null,
    window_fullscreen: ({ on } = {}) => { fullscreen = on == null ? !fullscreen : !!on; log.push(["window_fullscreen", fullscreen]); return fullscreen; },
    notify: () => null,
    asset_put: (_, bytes, h) => {
      const ext = safeId(h["x-ext"] || "").toLowerCase() || "bin";
      const d = FONT_EXT.includes(ext) ? dir("Resources", "Fonts") : dir("Resources", "Logos");
      const orig = decodeURIComponent(h["x-name"] || "");
      const stem = safeId(path.basename(orig, path.extname(orig)));
      const b = stem || Date.now().toString(16);
      let id = b; for (let n = 2; findAsset(id); n++) id = `${b}-${n}`;
      fs.writeFileSync(path.join(d, `${id}.${ext}`), bytes); return id;
    },
    asset_get: ({ id }) => { const p = findAsset(id); if (!p) throw new Error("not found"); return { __bytes: fs.readFileSync(p).toString("base64") }; },
    asset_delete: ({ id }) => { const p = findAsset(id); if (!p) return false; fs.unlinkSync(p); return true; },
    font_files: () => fs.readdirSync(dir("Resources", "Fonts")).filter(f => FONT_EXT.includes(extOf(f))).map(f => ({ id: path.basename(f, path.extname(f)), file: f })).filter(f => safeId(f.id) === f.id && f.id).sort((a, b) => a.id < b.id ? -1 : 1),
    list_fonts: () => fakeFonts,
    open_folder: () => null,
    paths: () => ({ base, presets: dir("Presets"), exports: dir("Exports"), downloads: dir("Downloads"), resources: dir("Resources"), tools: dir("Tools"), settings: dir("Settings") }),
    legal_text: ({ which }) => { const f = { license: ["NOTICE.md", "LICENSE"], notices: ["THIRD_PARTY.md"] }[which]; if (!f) throw new Error("unknown text: " + which); return f.map(n => fs.readFileSync(path.join(__dirname, "..", "..", n), "utf8")).join("\n\n"); },
    app_info: () => ({ name: "Halation", version: require("../package.json").version, recovered: session.recovered, portable: !!(tools.update && tools.update.portable) }),
    // update.rs: tools.update ({ version, notes, portable }) is what the public releases offer; null: nothing newer
    update_check: () => { const u = tools.update; session.updateFound = u || null; return u ? { version: u.version, current: require("../package.json").version, notes: u.notes || "", date: null, page: "https://github.com/Sylphera/Halation/releases/tag/v" + u.version, portable: !!u.portable } : null; },
    update_download: async () => {
      const u = session.updateFound; if (!u) throw new Error("no update was found"); if (u.portable) throw new Error("portable");
      for (const f of [0.25, 0.5, 1]) { await emit("update-progress", { done: Math.round(4e6 * f), total: 4e6 }); await new Promise(r => setTimeout(r, 40)); }
      session.updateReady = u.version; return u.version;
    },
    update_install: ({ restart }) => { if (!session.updateReady) throw new Error("the update is not downloaded"); session.updateInstall = restart ? "restart" : "close"; if (restart) session.quit++; return null; },
    update_pending: () => !!session.updateInstall,
    update_page: ({ version }) => { log.push(["update_page", version]); return null; },
    // window.rs: closing (the page asks, then quits) and the webview's memory while minimized
    close_ack: () => { session.asked = null; return null; },
    app_quit: () => { endSession(); session.quit++; return null; },
    memory_low: ({ low }) => { session.memoryLow.push(!!low); return null; },
    tools_status: () => status(),
    cutout_cache_get: ({ key }) => { cacheFile(key); return wsGet("masks", key); },
    cutout_cache_put: (_, bytes, h) => { cacheFile(h["x-key"]); return wsPut("masks", h["x-key"], bytes); },
    // system.rs: what the machine has now (the job manager's lanes); tests set it with setResources
    sys_resources: () => JSON.parse(JSON.stringify(tools.resources)),
    workspace_lease: ({ job }) => { if (!job || safeId(job) !== job) throw new Error("invalid job id"); const d = path.join(wsTemp(), job); fs.mkdirSync(d, { recursive: true }); return d; },
    workspace_release: ({ job }) => { if (!job || safeId(job) !== job) throw new Error("invalid job id"); fs.rmSync(path.join(wsTemp(), job), { recursive: true, force: true }); return null; },
    workspace_cache_get: ({ area, key }) => wsGet(area, key),
    workspace_cache_put: (_, bytes, h) => wsPut(h["x-area"], h["x-key"], bytes),
    workspace_pin: ({ area, keys, on }) => { for (const k of keys || []) on ? wsPinned.add(area + "/" + k) : wsPinned.delete(area + "/" + k); return null; },
    workspace_report: () => { const list = wsEntries(); return { path: localDir("workspace"), areas: Object.keys(WS_AREAS).map(id => ({ id, size: list.filter(e => e.k.startsWith(id + "/")).reduce((a, e) => a + e.size, 0), path: localDir("workspace", "cache", id) })), temp: sizeOf(wsTemp()), cache: list.reduce((a, e) => a + e.size, 0), budget: wsBudget(), free: tools.diskFree == null ? 100e9 : tools.diskFree }; },
    workspace_clean: ({ live }) => wsClean(live),
    workspace_stats_get: () => { try { return JSON.parse(fs.readFileSync(path.join(localDir("workspace"), "stats.json"), "utf8")); } catch (e) { return {}; } },
    workspace_stats_put: ({ stats }) => { if (!stats || typeof stats !== "object" || Array.isArray(stats)) throw new Error("stats must be an object"); fs.writeFileSync(path.join(localDir("workspace"), "stats.json"), JSON.stringify(stats)); return null; },
    // framegrab.rs: a video's content key and byte ranges; the strips and analyses by key in Tools\cache\framegrab
    framegrab_pick: () => { log.push(["pick-video"]); if (!tools.pickVideo) return null; picked.add(path.resolve(tools.pickVideo)); return { path: tools.pickVideo, name: path.basename(tools.pickVideo) }; },
    framegrab_probe: ({ path: p }) => { const f = fgReadable(p), size = fs.statSync(f).size, fd = fs.openSync(f, "r"), h = crypto.createHash("sha1").update(String(size));
      for (const at of [0, Math.floor(Math.max(0, size - 65536) / 2), Math.max(0, size - 65536)]) { const b = Buffer.alloc(Math.min(65536, size)); fs.readSync(fd, b, 0, b.length, at); h.update(b); }
      fs.closeSync(fd); return { size, key: h.digest("hex").slice(0, 16) }; },
    framegrab_read: ({ path: p, start, end }) => bytesOut(fgRange(p, start, end)),
    // the page reads ranges in one local request (the MOCK below), as Tauri's IPC answers in one round trip
    __range: async () => {
      if (!rangeServer) {
        rangeServer = http.createServer((req, res) => {
          const q = new URL(req.url, "http://x").searchParams;
          try { const b = fgRange(q.get("p"), +q.get("s"), +q.get("e")); res.writeHead(200, { "access-control-allow-origin": "*", "content-type": "application/octet-stream" }); res.end(b); }
          catch (e) { res.writeHead(403, { "access-control-allow-origin": "*" }); res.end(String(e.message || e)); }
        }).listen(0, "127.0.0.1");
        rangeServer.unref();
      }
      if (!rangeServer.listening) await new Promise(r => rangeServer.once("listening", r));
      return `http://127.0.0.1:${rangeServer.address().port}/`;
    },
    framegrab_cache_get: ({ key }) => wsGet("frames", key),
    framegrab_cache_put: (_, bytes, h) => wsPut("frames", h["x-key"], bytes),
    framegrab_write: (_, bytes, h) => { const p = insideBase(decodeURIComponent(h["x-path"] || "")), fd = fs.openSync(p, "r+"); fs.writeSync(fd, bytes, 0, bytes.length, +h["x-offset"]); fs.closeSync(fd); return null; },
    interp_workdir: ({ job }) => { const t = wsTemp(); if (job && /^j_/.test(job) && safeId(job) === job) { const d = path.join(t, job); for (const s of ["in", "out"]) fs.mkdirSync(path.join(d, s), { recursive: true }); return d; } let n = Date.now(); while (fs.existsSync(path.join(t, "interp-" + n))) n++; const d = path.join(t, "interp-" + n); for (const s of ["in", "out"]) fs.mkdirSync(path.join(d, s), { recursive: true }); return d; },
    interp_count: ({ dir: d, sub }) => { if (!["in", "out"].includes(sub)) throw new Error("unknown folder " + sub); const p = path.join(workFolder(d), sub); return fs.existsSync(p) ? fs.readdirSync(p).filter(f => extOf(f) === "png").length : 0; },
    interp_clean: ({ dir: d }) => { fs.rmSync(workFolder(d), { recursive: true, force: true }); return null; },
    // convert.rs: detection by content, the curated table and the plan, the image engine (FFmpeg stands in for the
    // image crate here), the .part renamed at the end. tools.encodersMissing hides what that FFmpeg lacks.
    convert_probe: ({ path: p }) => cvProbe(cvAllowed(p)),
    convert_prepare: ({ request: { path: p, name, target, audio, dest, rel, work } }) => {
      const input = cvAllowed(p), src = cvProbe(input), o = (src.outputs || []).find(x => x.id === target && !!x.audio === !!audio);
      if (!o) throw new Error("this file cannot become that format");
      const stem = fileStem(path.basename(name || "converted", path.extname(name || ""))) || "converted";
      const isDoc = ["document", "sheet", "slides", "markup", "pdf"].includes(src.class), pagesDir = src.class === "pdf" && src.pages > 1;
      const out = pickPath(stem + (pagesDir ? "" : "." + target), false, "converted", rel);
      if (!out) return null;
      if (out === input || cvReserved.has(out)) throw new Error("Choose a different destination");
      cvReserved.add(out);
      const part = out + ".part", r = { engine: src.class === "pdf" ? "pdf" : isDoc ? "docs" : o.ffmpeg && src.format !== "avif" ? "ffmpeg" : "image", out, part, notes: o.notes, copy: o.copy, duration: src.duration, class: src.class };
      if (pagesDir) fs.mkdirSync(part, { recursive: true });
      if (r.engine === "docs") { if (!work) throw new Error("no work folder"); const [steps, result] = cvSteps(src, target, input, work); r.steps = steps; r.result = result; }
      else if (r.engine === "pdf") { r.source = input; r.pages = src.pages; r.folder = pagesDir; }
      else if (r.engine === "ffmpeg") r.args = ["-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", "-i", input, ...cvArgs(src, o), "-f", CV_MUX[target], part];
      else if (src.format === "avif") { const png = path.join(work, "decoded.png"); r.decode = ["-hide_banner", "-nostdin", "-y", "-i", input, "-frames:v", "1", "-c:v", "png", "-f", "image2", png]; r.source = png; }
      else r.source = input;
      log.push(["convert", { target, engine: r.engine, args: r.args || null, steps: r.steps || null }]);
      return r;
    },
    convert_image: ({ source, target, part }) => {
      if (!cvReserved.has(part.replace(/\.part$/, ""))) throw new Error("not a conversion in progress");
      if (tools.convertImageFail && path.basename(source) === tools.convertImageFail.name) throw new Error(tools.convertImageFail.error);
      const ff = tools.ffmpegSource || "ffmpeg", jpgWhite = target === "jpg" ? ["-filter_complex", "color=white,format=rgb24[b];[b][0:v]scale2ref[b][i];[b][i]overlay=shortest=1,format=yuvj444p", "-q:v", "2"] : [];
      const codec = { png: "png", jpg: "mjpeg", webp: "libwebp", tiff: "tiff", bmp: "bmp", ico: "png", gif: "gif" }[target];
      const r = spawnSync(ff, ["-v", "error", "-y", "-i", source, "-frames:v", "1", ...jpgWhite, "-c:v", codec, "-f", target === "ico" ? "ico" : target === "gif" ? "gif" : "image2", part]);
      if (r.status !== 0) throw new Error(String(r.stderr || "image engine failed").trim());
      return null;
    },
    convert_pdf_page: async ({ source, target, part, page }) => {
      const out = part.replace(/\.part$/, "");
      if (!cvReserved.has(out)) throw new Error("not a conversion in progress");
      if (!findPdfium()) throw new Error("PDFium is not installed");
      const file = fs.existsSync(part) && fs.statSync(part).isDirectory() ? path.join(part, `${path.basename(out)}-${String(page + 1).padStart(3, "0")}.${target}`) : part;
      const tmp = path.join(wsTemp(), `hal-pdf-${process.pid}-${page}-${Date.now()}`);
      const r = spawnSync("pdftoppm", ["-r", "200", "-f", String(page + 1), "-l", String(page + 1), "-singlefile", target === "jpg" ? "-jpeg" : "-png", cvAllowed(source), tmp]);
      if (r.status !== 0) throw new Error("PDFium could not read the PDF");
      fs.renameSync(tmp + (target === "jpg" ? ".jpg" : ".png"), file);
      if (tools.pdfPageDelay) await new Promise(res => setTimeout(res, tools.pdfPageDelay));
      return null;
    },
    convert_pdf_preview: ({ path: p }) => {
      if (!findPdfium()) throw new Error("PDFium is not installed");
      const tmp = path.join(wsTemp(), `hal-pdfprev-${process.pid}-${Date.now()}`);
      const r = spawnSync("pdftoppm", ["-scale-to-x", "1400", "-scale-to-y", "-1", "-f", "1", "-l", "1", "-singlefile", "-png", cvAllowed(p), tmp]);
      if (r.status !== 0) throw new Error("PDFium could not read the PDF");
      const b = fs.readFileSync(tmp + ".png"); fs.rmSync(tmp + ".png");
      return { __bytes: b.toString("base64") };
    },
    convert_finish: ({ part, from }) => {
      const out = part.replace(/\.part$/, "");
      if (!cvReserved.has(out)) throw new Error("not a conversion in progress");
      if (from) { if (!fs.existsSync(from) || !path.resolve(from).startsWith(localDir("workspace"))) { cvReserved.delete(out); throw new Error("the conversion wrote nothing"); } fs.renameSync(from, part); }
      if (!fs.existsSync(part)) { cvReserved.delete(out); throw new Error("the conversion wrote nothing"); }
      const isDir = fs.statSync(part).isDirectory(), names = isDir ? fs.readdirSync(part).sort() : [];
      const size = isDir ? names.reduce((a, n) => a + fs.statSync(path.join(part, n)).size, 0) : fs.statSync(part).size, fin = out;
      fs.renameSync(part, fin); cvReserved.delete(out); picked.add(path.resolve(fin));
      const files = names.map(n => path.join(fin, n)); for (const f of files) picked.add(path.resolve(f));
      return { path: fin, size, files };
    },
    convert_discard: ({ part }) => { const out = part.replace(/\.part$/, ""); if (!cvReserved.has(out)) throw new Error("not a conversion in progress"); if (fs.existsSync(part)) fs.rmSync(part, { recursive: true, force: true }); cvReserved.delete(out); return null; },
    convert_pick: ({ folder, kind }) => {
      log.push(["convert-pick", !!folder, kind || null]);
      const list = folder ? (tools.convertFolder ? cvWalk(tools.convertFolder) : []) : (tools.convertFiles || []).map(f => ({ path: f, name: path.basename(f), rel: "" }));
      for (const f of list) picked.add(path.resolve(f.path));
      return list;
    },
    convert_read: ({ path: p }) => ({ __bytes: fs.readFileSync(cvAllowed(p)).toString("base64") }),
    convert_reveal: ({ path: p }) => { cvAllowed(p); log.push(["convert-reveal", p]); return null; },
    // stems.rs: the model is not run here; FFmpeg decodes the song and low-passes stand for the model: HQ4's
    // instrumental is one (vocals = mix − instrumental, as in stems.rs); HTDemucs' bass, drums and other are bands and
    // its vocals the rest. Chunks of tools.stemsChunkMs (30 ms) send the waveform like the real one.
    // tools.stemsGpu === false: DirectML fails and "auto" falls back to the CPU.
    stems_separate: async ({ job, path: p, mode, device }) => {
      const t0 = Date.now(), st = status(), demucs = mode === "htdemucs";
      if (mode && !["hq4", "htdemucs"].includes(mode)) throw new Error("unknown mode " + mode);
      if (!st.onnxruntime) throw new Error("ONNX Runtime is not installed");
      if (!st[demucs ? "stems-htdemucs" : "stems-hq4"]) throw new Error(demucs ? "the HTDemucs model is not installed" : "the HQ4 model is not installed");
      const ff = findFfmpeg(); if (!ff) throw new Error("FFmpeg not installed");
      if (safeId(job) !== job) throw new Error("invalid job id");
      stemsStop.delete(job); log.push(["stems", { job, path: p, mode: mode || "hq4", device }]);
      for (const stage of ["runtime", "decode"]) await emit("stems-progress", { job, stage });
      const r = await new Promise(res => { const c = spawn(ff, ["-hide_banner", "-nostdin", "-i", p, "-map", "0:a:0", "-vn", "-ac", "2", "-ar", "44100", "-f", "f32le", "-"]); const out = [], err = []; c.stdout.on("data", d => out.push(d)); c.stderr.on("data", d => err.push(d)); c.on("close", code => res({ code, out: Buffer.concat(out), err: Buffer.concat(err).toString() })); c.on("error", e => res({ code: -1, out: Buffer.alloc(0), err: e.message })); });
      const audio = (r.err.split(/\r?\n/).find(l => /Stream #.*Audio:/.test(l)) || "");
      if (r.code !== 0 || r.out.length < 8) throw new Error(audio ? r.err.trim().split(/\r?\n/).pop() : "no audio");
      const n = Math.floor(r.out.length / 8), mix = new Float32Array(r.out.buffer.slice(r.out.byteOffset, r.out.byteOffset + n * 8));
      const low = (x, a) => { const o = new Float32Array(n * 2); for (let c = 0; c < 2; c++) { let y = 0; for (let i = 0; i < n; i++) { y += a * (x[i * 2 + c] - y); o[i * 2 + c] = y; } } return o; };
      const inst = low(mix, 0.02), voc = mix.map((x, i) => x - inst[i]);
      const mid = low(mix, 0.2), band = mid.map((x, i) => (x - inst[i]) / 2);
      const out = demucs ? { drums: band, bass: inst, other: band, vocals: mix.map((x, i) => x - mid[i]) } : { vocals: voc, instrumental: inst };
      const tracks = demucs ? ["drums", "bass", "other", "vocals"] : ["vocals", "instrumental"];
      const gpu = device !== "cpu" && tools.stemsGpu !== false, B = 4096, total = Math.ceil(n / B), chunks = Math.max(2, Math.ceil((n + 5120) / 256000));
      const peaks = (arr, b0, b1) => { const o = []; for (let b = b0; b < b1; b++) { let m = 0; for (let i = b * B; i < Math.min(n, (b + 1) * B); i++) m = Math.max(m, Math.abs(arr[i * 2]), Math.abs(arr[i * 2 + 1])); o.push(m); } return o; };
      const dir = path.join(wsTemp(), "stems-" + job); fs.mkdirSync(dir, { recursive: true });
      for (const stage of [gpu ? "model-gpu" : "model-cpu", gpu ? "first-gpu" : "first-cpu"]) await emit("stems-progress", { job, stage });
      let sent = 0;
      for (let k = 1; k <= chunks; k++) {
        await new Promise(res => setTimeout(res, tools.stemsChunkMs ?? 30));
        if (stemsStop.has(job)) { fs.rmSync(dir, { recursive: true, force: true }); stemsStop.delete(job); throw new Error("cancelled"); }
        const upto = k === chunks ? total : Math.floor(total * k / chunks);
        await emit("stems-progress", { job, chunk: k, chunks, device: gpu ? "gpu" : "cpu", total, from: sent, peaks: Object.fromEntries(tracks.map(t => [t, peaks(out[t], sent, upto)])) });
        sent = upto;
      }
      const wav = (f, data) => { const h = Buffer.alloc(44); h.write("RIFF", 0); h.writeUInt32LE(36 + data.length * 4, 4); h.write("WAVEfmt ", 8); h.writeUInt32LE(16, 16); h.writeUInt16LE(3, 20); h.writeUInt16LE(2, 22); h.writeUInt32LE(44100, 24); h.writeUInt32LE(44100 * 8, 28); h.writeUInt16LE(8, 32); h.writeUInt16LE(32, 34); h.write("data", 36); h.writeUInt32LE(data.length * 4, 40); fs.writeFileSync(path.join(dir, f), Buffer.concat([h, Buffer.from(data.buffer)])); };
      for (const t of tracks) wav(t + ".wav", out[t]);
      wav("original.wav", mix);
      const max = d => d.reduce((m, x) => Math.max(m, Math.abs(x)), 0), rate = +((/(\d+) Hz/.exec(audio) || [])[1]) || null, codec = ((/Audio: (\w+)/.exec(audio) || [])[1]) || "";
      const s = (Date.now() - t0) / 1000;
      return { dir, mode: mode || "hq4", tracks, files: Object.fromEntries(tracks.map(t => [t, path.join(dir, t + ".wav")])), original: path.join(dir, "original.wav"), peak: Object.fromEntries(tracks.map(t => [t, max(out[t])])), device: gpu ? "gpu" : "cpu", fellBack: device !== "cpu" && !gpu, seconds: n / 44100, buckets: total, source: { rate, codec }, time: { decode: 0, model: s, dsp: 0, total: s } };
    },
    stems_cancel: ({ job }) => { stemsStop.add(job); log.push(["stems-cancel", job]); return null; },
    stems_clean: ({ dir: d }) => { const r = path.resolve(path.isAbsolute(d) ? d : path.join(wsTemp(), d)); if (path.dirname(r) !== wsTemp() || !/^stems-/.test(path.basename(r))) throw new Error("not a folder of Vocal Remover"); fs.rmSync(r, { recursive: true, force: true }); return null; },
    stems_peak: ({ dir: d, gains }) => {
      const r = path.resolve(d); if (path.dirname(r) !== wsTemp() || !/^stems-/.test(path.basename(r))) throw new Error("not a folder of Vocal Remover");
      const rd = f => { if (!/^[a-z]+$/.test(f)) throw new Error("unknown track " + f); const b = fs.readFileSync(path.join(r, f + ".wav")); return new Float32Array(b.buffer.slice(b.byteOffset + 44, b.byteOffset + 44 + Math.floor((b.length - 44) / 4) * 4)); };
      const parts = Object.entries(gains || {}).filter(([, g]) => g).map(([t, g]) => [rd(t), g]);
      const len = Math.min(...parts.map(([x]) => x.length)); let m = 0;
      for (let k = 0; k < len; k++) m = Math.max(m, Math.abs(parts.reduce((a, [x, g]) => a + x[k] * g, 0)));
      return m;
    },
    storage_report: () => ({
      app: { path: path.join(root, "Halation", "halation.exe"), size: tools.appSize || 12582912 },
      components: components(),
      caches: [{ id: "temp", path: wsTemp(), size: sizeOf(wsTemp()) }, ...Object.keys(WS_AREAS).map(id => ({ id, path: localDir("workspace", "cache", id), size: sizeOf(localDir("workspace", "cache", id)) })), { id: "partial", path: toolsDir(), size: leftovers(toolsDir()).reduce((a, p) => a + sizeOf(p), 0) }, { id: "recent", path: dir("Settings", "Recent"), size: sizeOf(dir("Settings", "Recent")) }, { id: "covertest", path: dir("Tools", "cache", "covertest"), size: sizeOf(dir("Tools", "cache", "covertest")) }],
      user: [["presets", "Presets"], ["projects", "Projects"], ["library", "Library"], ["exports", "Exports"], ["downloads", "Downloads"], ["resources", "Resources"]].map(([id, d]) => ({ id, path: dir(d), size: sizeOf(dir(d)) }))
    }),
    cache_clear: ({ live }) => {
      let freed = wsClean(live);
      const gone = leftovers(toolsDir()).concat(...[dir("Settings", "Recent"), dir("Tools", "cache", "covertest")].map(d => fs.readdirSync(d).map(f => path.join(d, f))));
      for (const p of gone) { const n = sizeOf(p); try { fs.rmSync(p, { recursive: true }); freed += n; } catch (e) {} }
      return freed;
    },
    tool_uninstall: ({ tool }) => { if (!OWN[tool]) throw new Error("unknown tool " + tool); fs.rmSync(path.join(toolsDir(), ...OWN[tool]), { recursive: true, force: true }); return status(); },
    tool_install: async ({ tool }) => {
      if (["upscaler", "upscayl", "models"].includes(tool)) {
        if (!tools.upscalerSource) throw new Error("network unreachable");
        const bin = path.join(toolsDir(), "upscayl", "bin", "upscayl-bin");
        if (tool !== "models" && !fs.existsSync(bin)) await copyWithProgress("upscaler", tools.upscalerSource.bin, bin);
        if (tool !== "upscayl") for (const m of MODELS) for (const e of ["param", "bin"]) { const d = path.join(toolsDir(), "upscayl", "models", `${m}.${e}`); if (!fs.existsSync(d)) await copyWithProgress("upscaler", path.join(tools.upscalerSource.models, `${m}.${e}`), d); }
      } else if (tool === "ytdlp") {
        if (!tools.ytdlpSource) throw new Error("network unreachable");
        await copyWithProgress(tool, tools.ytdlpSource, path.join(toolsDir(), "yt-dlp"));
      } else if (tool === "cutout") {
        if (!tools.cutoutSource) throw new Error("network unreachable");
        for (const f of OLD_CUT) fs.rmSync(path.join(toolsDir(), "cutout", f), { force: true });
        for (const k of ["wasm", "license", "decoder", "cpu", "model"]) { const d = path.join(toolsDir(), "cutout", CUT[k]); if (!fs.existsSync(d)) await copyWithProgress("cutout", tools.cutoutSource[k], d); }
      } else if (tool === "rife") {
        if (!tools.rifeSource) throw new Error("network unreachable");
        const d = path.join(toolsDir(), "rife");
        if (!fs.existsSync(path.join(d, "rife-ncnn-vulkan"))) await copyWithProgress("rife", tools.rifeSource.bin, path.join(d, "rife-ncnn-vulkan"));
        for (const e of ["param", "bin"]) { const p = path.join(d, "rife-v4.6", "flownet." + e); if (!fs.existsSync(p)) await copyWithProgress("rife", path.join(tools.rifeSource.model, "flownet." + e), p); }
      } else if (tool === "span") {
        if (!tools.spanSource) throw new Error("network unreachable");
        const d = path.join(toolsDir(), "span");
        for (const f of fs.readdirSync(tools.spanSource).filter(f => fs.statSync(path.join(tools.spanSource, f)).isFile())) await copyWithProgress("span", path.join(tools.spanSource, f), path.join(d, f));
        for (const m of ["spanx2_ch52", "spanx4_ch52"]) for (const e of ["param", "bin"]) await copyWithProgress("span", path.join(tools.spanSource, "models", `${m}.${e}`), path.join(d, "models", `${m}.${e}`));
      } else if (STEMS[tool]) {
        // stems.rs fetch_verified: each file from its sources in order, kept only when its sha256 is the expected one
        // (tools.stemsSource[tool]: per file, a list of candidate files; tools.stemsSha: file name → sha256, else any)
        const src = (tools.stemsSource || {})[tool];
        if (!src) throw new Error("network unreachable");
        for (const parts of STEMS[tool]) {
          const dest = stemsFile(...parts), name = parts[parts.length - 1], errors = [];
          if (fs.existsSync(dest)) continue;
          for (const cand of src[name] || []) {
            const part = dest + ".check";
            try {
              await copyWithProgress(tool, cand, part);
              const sha = crypto.createHash("sha256").update(fs.readFileSync(part)).digest("hex"), want = (tools.stemsSha || {})[name];
              if (want && sha !== want) throw new Error(name + ": the sha256 does not match");
              fs.renameSync(part, dest); break;
            } catch (e) { fs.rmSync(part, { force: true }); errors.push(e.message); }
          }
          if (!fs.existsSync(dest)) throw new Error(errors.join(" · ") || "network unreachable");
        }
      } else if (tool === "ffmpeg") {
        if (!tools.ffmpegSource) throw new Error("network unreachable");
        await copyWithProgress(tool, tools.ffmpegSource, path.join(toolsDir(), "ffmpeg", "ffmpeg"));
      } else if (tool === "pandoc" || tool === "libreoffice" || tool === "pdfium") {
        // the sources: Pandoc's binary, a script that runs LibreOffice, PDFium's library
        const src = tools[tool + "Source"]; if (!src) throw new Error("network unreachable");
        const dest = { pandoc: ["pandoc", "pandoc"], libreoffice: ["libreoffice", "app", "program", "soffice"], pdfium: ["pdfium", "libpdfium.so"] }[tool];
        await copyWithProgress(tool, src, path.join(toolsDir(), ...dest));
        fs.chmodSync(path.join(toolsDir(), ...dest), 0o755);
      } else throw new Error("unknown tool " + tool);
      return status();
    },
    proc_start: ({ tool, args, low, job }) => {
      const bin = tool === "upscaler" ? (findUpscaler() || {}).bin : tool === "span" ? (findSpan() || {}).bin : tool === "ffprobe" ? findFfprobe() : tool === "ytdlp" ? findYtdlp() : tool === "ffmpeg" ? findFfmpeg() : tool === "rife" ? (findRife() || {}).bin : tool === "pandoc" ? findPandoc() : tool === "soffice" ? findSoffice() : null;
      if (!bin) throw new Error(tool + " not installed");
      const extra = tool === "ytdlp" && fs.existsSync(path.join(toolsDir(), "ffmpeg", "ffmpeg")) ? ["--ffmpeg-location", path.join(toolsDir(), "ffmpeg")] : [];
      // low: below normal like Windows' BELOW_NORMAL_PRIORITY_CLASS; nice has no effect across autogroups, the idle
      // scheduling class does (chrt execs the tool, so the pid stays the same)
      const cmd = low && CHRT ? ["chrt", ["-i", "0", bin, ...extra, ...args]] : fixtureCommand(bin, [...extra, ...args]);
      const id = nextProc++, child = spawn(cmd[0], cmd[1], { cwd: path.dirname(bin), stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...(tools.env || {}) } });
      procsMap.set(id, child); log.push(["proc", { tool, args, job: job || null }]);
      const key = job && safeId(job) === job ? job : "p" + id; if (!jobTrees.has(key)) jobTrees.set(key, new Set()); jobTrees.get(key).add(id);
      const readers = ["stdout", "stderr"].map(k => new Promise(res => {
        let buf = "";
        child[k].on("data", d => { buf += d.toString("utf8"); const parts = buf.split(/\r\n|\r|\n/); buf = parts.pop(); for (const l of parts) if (l.trim()) emit("proc", { id, stream: k === "stdout" ? "out" : "err", line: l.trimEnd() }); });
        child[k].on("end", () => { if (buf.trim()) emit("proc", { id, stream: k === "stdout" ? "out" : "err", line: buf.trimEnd() }); res(); });
      }));
      child.on("close", async code => { await Promise.all(readers); procsMap.delete(id); const t = jobTrees.get(key); if (t) { t.delete(id); if (!t.size) jobTrees.delete(key); } emit("proc", { id, done: true, code, peakMB: tools.peakMB == null ? 64 : tools.peakMB }); });
      child.on("error", e => emit("proc", { id, stream: "err", line: String(e.message) }));
      return id;
    },
    proc_kill: ({ id }) => { const c = procsMap.get(id); if (c) c.kill("SIGKILL"); return null; },
    proc_kill_job: ({ job }) => { const t = jobTrees.get(job); jobTrees.delete(job); for (const id of t || []) { const c = procsMap.get(id); if (c) c.kill("SIGKILL"); } log.push(["kill-job", job]); return null; },
    http_text: ({ url }) => { const w = (tools.web || {})[url]; if (w == null) throw new Error("could not reach " + url); log.push(["http", url]); return String(w); },
    http_bytes: ({ url }) => { const w = (tools.web || {})[url]; if (w == null) throw new Error("could not reach " + url); log.push(["http", url]); return { __bytes: Buffer.from(w).toString("base64") }; },
    spotify_artist_metrics: ({ artistId }) => {
      const metrics = (tools.spotifyMetrics || {})[artistId];
      if (!metrics) throw new Error("Spotify artist counters unavailable");
      return metrics;
    },
    reserve_stem: ({ kind, stem }) => {
      const d = dir(...outDir(kind)), base = fileStem(stem), names = fs.readdirSync(d).map(n => n.toLowerCase());
      const taken = s => names.some(n => n === s.toLowerCase() || n.startsWith(s.toLowerCase() + "."));
      let pick = base; for (let n = 2; taken(pick); n++) pick = `${base} (${n})`;
      return path.join(d, pick);
    },
    temp_write: (_, bytes, h) => { const job = h["x-job"] || "", d = h["x-dir"] === "recent" ? dir("Settings", "Recent") : localDir("workspace", "temp", job && safeId(job) === job ? job : "loose"); const p = uniquePath(d, cleanFilename(decodeURIComponent(h["x-name"] || "file"))); fs.writeFileSync(p, bytes); return p; },
    write_path: (_, bytes, h) => {
      const target = decodeURIComponent(h["x-path"] || ""), parent = path.resolve(path.dirname(target));
      if ((!destinations.has(target) && ![...destinations.keys()].some(d => fs.existsSync(d) && fs.statSync(d).isDirectory() && target.startsWith(d + path.sep)) && !parent.startsWith(base) && !parent.startsWith(path.join(root, "LocalAppData", "Halation", "workspace"))) || !fs.existsSync(parent)) throw new Error("path outside the Halation folder");
      const dest = path.join(parent, cleanFilename(path.basename(target))); fs.writeFileSync(dest, bytes); return dest;
    },
    read_path: ({ path: p }) => bytesOut(fs.readFileSync(insideBase(p))),
    read_path_chunk: ({ path: p, offset }) => bytesOut(fs.readFileSync(insideBase(p)).subarray(offset, offset + (512 << 10))),
    delete_paths: ({ paths }) => { let n = 0; for (const p of paths) { try { const r = path.resolve(p); if ((r.startsWith(base) || r.startsWith(localDir("workspace"))) && fs.statSync(r).isFile()) { fs.unlinkSync(r); n++; } } catch (e) {} } return n; },
    files_with_stem: ({ pathStem }) => { const d = path.dirname(pathStem), st = path.basename(pathStem) + "."; return fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.startsWith(st)).map(f => path.join(d, f)) : []; },
    // encode.rs: one real FFmpeg per output, fed through stdin
    encode_start: ({ args, output, frame, dir: isDir }) => {
      const out = path.resolve(output), folder = path.resolve(isDir ? path.dirname(path.dirname(out)) : path.dirname(out));
      if (!folder.startsWith(base) && !destinations.has(output) && ![...destinations.keys()].some(d => fs.existsSync(d) && fs.statSync(d).isDirectory() && out.startsWith(d + path.sep))) throw new Error("path outside the Halation folder");
      if (!fs.existsSync(folder)) throw new Error("the export folder does not exist");
      if (isDir) fs.mkdirSync(path.dirname(out), { recursive: true });
      const bin = findFfmpeg(); if (!bin) throw new Error("FFmpeg not installed");
      const cmd = ["-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1", "-y", ...args, out];
      const child = spawn(bin, cmd, { stdio: ["pipe", "pipe", "pipe"] });
      const id = nextEnc++, e = { child, frame, last: null, out, isDir, err: [], exit: null };
      e.exit = new Promise(res => child.on("close", code => res(code)));
      child.stdin.on("error", () => {});
      child.stderr.on("data", d => { e.err.push(...d.toString().split(/\r?\n/).filter(Boolean)); e.err = e.err.slice(-20); });
      let buf = "";
      child.stdout.on("data", d => { buf += d; const lines = buf.split("\n"); buf = lines.pop(); for (const l of lines) { const m = /^frame=(\d+)/.exec(l); if (m) emit("encode", { id, frame: +m[1] }); } });
      encoders.set(id, e); log.push(["encode", { args, output }]);
      return { id, path: out };
    },
    encode_write: async (_, bytes, h) => {
      const e = encoders.get(+h["x-id"]); if (!e) throw new Error("encoder already closed");
      let data;
      if (h["x-same"] === "1") { if (!e.last) throw new Error("no previous frame"); data = e.last; }
      else if (h["x-rect"] && e.frame) {
        const [x, y, w, hh] = h["x-rect"].split(",").map(Number), { width, height, bpp } = e.frame;
        if (x + w > width || y + hh > height || bytes.length !== w * hh * bpp) throw new Error("frame rectangle does not fit");
        data = Buffer.alloc(width * height * bpp);
        for (let r = 0; r < hh; r++) bytes.copy(data, ((y + r) * width + x) * bpp, r * w * bpp, (r + 1) * w * bpp);
      } else data = bytes;
      if (e.frame) e.last = data;
      if (e.child.exitCode != null || e.child.stdin.destroyed) throw new Error(e.err.slice(-1)[0] || "FFmpeg stopped");
      if (!e.child.stdin.write(data)) await new Promise(r => { const go = () => { e.child.stdin.off("drain", go); e.child.off("close", go); r(); }; e.child.stdin.on("drain", go); e.child.on("close", go); });
      encStats.bytes += data.length; encStats.ipc += bytes.length;
      return null;
    },
    encode_finish: async ({ id }) => {
      const e = encoders.get(id); if (!e) throw new Error("encoder already closed");
      encoders.delete(id); e.child.stdin.end();
      const code = await e.exit;
      const rm = () => { try { if (e.isDir) fs.rmSync(path.dirname(e.out), { recursive: true, force: true }); else fs.rmSync(e.out, { force: true }); } catch (x) {} };
      if (code !== 0) { rm(); throw new Error(e.err.slice(-1)[0] || "FFmpeg exited with " + code); }
      const size = e.isDir ? fs.readdirSync(path.dirname(e.out)).reduce((n, f) => n + fs.statSync(path.join(path.dirname(e.out), f)).size, 0) : fs.statSync(e.out).size;
      return { path: e.out, size };
    },
    encode_abort: async ({ id }) => {
      const e = encoders.get(id); if (!e) return null;
      encoders.delete(id); e.child.kill("SIGKILL"); await e.exit;
      try { if (e.isDir) fs.rmSync(path.dirname(e.out), { recursive: true, force: true }); else fs.rmSync(e.out, { force: true }); } catch (x) {}
      return null;
    },
    disk_free: ({ path: p }) => { if (tools.diskFree != null) return tools.diskFree; const st = fs.statfsSync(p ? insideBase(p) : base); return st.bavail * st.bsize; },
    export_folder: ({ name, destination }) => {
      const d = dir("Exports", "Videos"), stem = fileStem(name);
      let p = path.join(d, stem); for (let n = 2; fs.existsSync(p); n++) p = path.join(d, `${stem} (${n})`);
      p = destination || p; fs.mkdirSync(p, { recursive: true }); folders.add(p); return p;
    },
    export_folder_remove: ({ path: p }) => { if (!folders.delete(p)) throw new Error("not an export folder of this session"); fs.rmSync(p, { recursive: true, force: true }); return true; },
    take_open_files: () => { const q = opened.queue.splice(0); return q; },
    read_opened: ({ path: p }) => { if (!opened.allowed.has(p)) throw new Error("file not allowed"); return { __bytes: fs.readFileSync(p).toString("base64") }; },
    // library.rs: own sections in Library, packs in Library\Packs, linked folders read while the state links them
    library_sections: () => {
      const r = dir("Library"), subs = d => fs.existsSync(d) ? fs.readdirSync(d).filter(n => fs.statSync(path.join(d, n)).isDirectory()).sort((a, b) => a.toLowerCase() < b.toLowerCase() ? -1 : 1) : [];
      const sec = (name, p) => { const st = libStamp(p); return { name, path: p, missing: !fs.existsSync(p), count: st[0], stamp: st[1] }; };
      return { root: r, own: subs(r).filter(n => n !== "Packs").map(n => sec(n, path.join(r, n))), packs: subs(path.join(r, "Packs")).map(n => sec(n, path.join(r, "Packs", n))), linked: libLinked().map(p => sec(path.basename(p), p)) };
    },
    library_items: ({ path: p }) => { const d = libReadable(p); return fs.statSync(d).isDirectory() ? fs.readdirSync(d).map(name => ({ name, p: path.join(d, name) })).filter(f => fs.statSync(f.p).isFile() && LIB_MEDIA.includes(extOf(f.name))).map(f => { const st = fs.statSync(f.p); return { path: f.p, name: f.name, size: st.size, modified: Math.round(st.mtimeMs) }; }).sort((a, b) => b.modified - a.modified) : []; },
    library_read: ({ path: p }) => ({ __bytes: fs.readFileSync(libReadable(p)).toString("base64") }),
    library_section: ({ op, name, to }) => {
      const own = n => { checkStem(n); if (!n || n.toLowerCase() === "packs") throw new Error("invalid section name: " + n); return path.join(dir("Library"), n); };
      const d = own(name);
      if (op === "create") { if (fs.existsSync(d)) throw new Error("exists"); fs.mkdirSync(d, { recursive: true }); return d; }
      if (op === "rename") { const n = own(to); if (fs.existsSync(n) && n.toLowerCase() !== d.toLowerCase()) throw new Error("exists"); fs.renameSync(d, n); return n; }
      if (op === "delete") { fs.rmSync(d, { recursive: true, force: true }); return ""; }
      throw new Error("unknown operation " + op);
    },
    library_write: (_, bytes, h) => {
      const sec = decodeURIComponent(h["x-section"] || ""), parts = sec.split("/"), name = cleanFilename(decodeURIComponent(h["x-name"] || ""));
      if (!LIB_MEDIA.includes(extOf(name))) throw new Error("not a picture or video: " + name);
      if (parts.length === 2 && parts[0] === "Packs") checkStem(parts[1]); else if (parts.length !== 1 || !parts[0] || parts[0].toLowerCase() === "packs") throw new Error("invalid section " + sec); else checkStem(parts[0]);
      const p = uniquePath(dir("Library", ...parts), name); fs.writeFileSync(p, bytes); return p;
    },
    library_remove: ({ path: p }) => { const r = path.resolve(p), L = dir("Library"); if (!r.startsWith(L) || r.startsWith(path.join(L, "Packs")) || !fs.existsSync(r)) throw new Error("not an item of an own section"); fs.unlinkSync(r); return null; },
    library_pack_remove: ({ id }) => { checkStem(id); fs.rmSync(path.join(dir("Library"), "Packs", id), { recursive: true, force: true }); return null; },
    library_pick_folder: () => { log.push(["pick-folder"]); return tools.pickFolder || null; },
    library_pick_files: () => { log.push(["pick-files"]); return tools.pickFiles || []; },
    library_index_get: () => { const f = dir("Settings", "Library") + path.sep + "index.json"; if (!fs.existsSync(f)) return null; const v = JSON.parse(fs.readFileSync(f, "utf8")); libRemember(v); return v; },
    library_index_put: ({ index }) => { const f = path.join(dir("Settings", "Library"), "index.json"); fs.writeFileSync(f + ".tmp", JSON.stringify(index)); fs.renameSync(f + ".tmp", f); libRemember(index); return null; },
    library_scan: ({ path: p, depth, exts }) => {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) return [libEntry(p)];
      if (!fs.existsSync(p)) return [];
      const d = libReadable(p);
      return libScan(d, Math.min(depth || 0, 6), exts || LIB_SCAN.filter(x => x !== "json"), []);
    },
    library_resolve: ({ dirs, want }) => {
      const found = {}, walk = (d, depth) => { for (const n of fs.readdirSync(d)) { const p = path.join(d, n), st = fs.statSync(p); if (st.isDirectory()) { if (depth > 0) walk(p, depth - 1); } else if (want.some(w => w.size === st.size)) { const k = fileKey(p); if (want.some(w => w.key === k) && !found[k]) found[k] = p; } } };
      for (const d of dirs) { let r; try { r = libReadable(d); } catch (e) { if (![...libKnown].some(p => path.dirname(p) === d) || !fs.existsSync(d)) continue; r = d; } if (fs.statSync(r).isDirectory()) walk(r, 4); }
      return found;
    },
    library_thumb_get: ({ key }) => wsGet("thumbs", key),
    library_thumb_put: (_, bytes, h) => wsPut("thumbs", h["x-key"], bytes),
    // profile.rs: the artist profile in Settings\Profile, the Cover Test's feed in Tools\cache\covertest
    profile_get: () => { try { return JSON.parse(fs.readFileSync(path.join(profDir("profile"), "profile.json"), "utf8")); } catch (e) { return null; } },
    profile_set: ({ profile }) => { if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("the profile must be an object"); fs.writeFileSync(path.join(profDir("profile"), "profile.json"), JSON.stringify(profile, null, 2)); return null; },
    profile_file_get: ({ area, name }) => { const p = profFile(area, name); return { __bytes: fs.existsSync(p) ? fs.readFileSync(p).toString("base64") : "" }; },
    profile_file_put: (_, bytes, h) => { fs.writeFileSync(profFile(h["x-area"], h["x-name"]), bytes); return null; },
    profile_prune: ({ area, keep, prefix }) => { const d = profDir(area), k = new Set(keep || []); let total = 0;
      for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (!fs.statSync(p).isFile() || !f.startsWith(prefix || "")) continue; if (k.has(f)) total += fs.statSync(p).size; else fs.rmSync(p); }
      return total; }
  };

  return {
    base, log, dir, emit, status, setSaveDestination(p) { nextSave = p; }, encStats, session, begin, setDiskFree(v) { tools.diskFree = v; }, setResources(r) { tools.resources = { ...tools.resources, ...r, gpu: { ...tools.resources.gpu, ...(r.gpu || {}) } }; }, setPeakMB(v) { tools.peakMB = v; }, setWorkspaceBudget(v) { tools.wsBudget = v; }, jobTrees, setAppSize(v) { tools.appSize = v; },
    setSessionOptions(o) { Object.assign(tools,o); }, setUpdate(u) { tools.update = u; Object.assign(session, { updateFound: null, updateReady: null, updateInstall: null }); }, setToolEnv(env) { tools.env = env; }, setPickVideo(p) { tools.pickVideo = p; }, localDir, stallNext(tool) { stalls.add(tool); }, setPickFolder(p) { tools.pickFolder = p; }, setPickFiles(p) { tools.pickFiles = p; },
    // page: the Playwright page; events reach the main window like Tauri's event.listen callbacks
    bindPage(page) { emitter = (ev, payload) => page.evaluate(([ev, payload]) => window.__events[ev] && window.__events[ev]({ event: ev, payload }), [ev, payload]); },
    openWith(paths) { for (const p of paths) { opened.queue.push(p); opened.allowed.add(p); } },
    async call(cmd, args, b64, headers) {
      if (cmd !== "encode_write") log.push([cmd, ["session_file_put", "export_write", "save_file", "asset_put", "temp_write", "write_path", "cutout_cache_put", "framegrab_cache_put", "framegrab_write", "library_write", "library_thumb_put", "profile_file_put", "workspace_cache_put"].includes(cmd) ? { bytes: b64 ? Math.round(b64.length * 0.75) : 0, headers } : args]);
      const fn = cmds[cmd];
      try {
        if (!fn) throw new Error("unknown command " + cmd);
        if (["session_file_put", "save_file", "export_write", "asset_put", "temp_write", "write_path", "encode_write", "cutout_cache_put", "framegrab_cache_put", "framegrab_write", "library_write", "library_thumb_put", "profile_file_put", "workspace_cache_put"].includes(cmd) && b64 == null) throw new Error(cmd + ": no bytes from the main window");
        const r = await fn(args || {}, b64 != null ? Buffer.from(b64, "base64") : null, headers || {});
        return r === undefined ? null : r;
      } catch (e) { return { __error: String(e && e.message || e) }; }
    }
  };
}

// Injected into the page: replaces window.__TAURI__ in the main window only.
const MOCK = () => {
  if (window !== window.top) return;
  const toB64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
  window.__events = {};
  window.__TAURI__ = {
    core: {
      invoke: async (cmd, args, opts) => {
        if (cmd === "framegrab_read") {
          if (!window.__rangeUrl) window.__rangeUrl = await window.__host("__range", null, null, null);
          const r = await fetch(`${window.__rangeUrl}?p=${encodeURIComponent(args.path)}&s=${args.start}&e=${args.end}`);
          if (!r.ok) throw await r.text();
          return r.arrayBuffer();
        }
        let b64 = null, a = args;
        if (args instanceof Uint8Array) { b64 = toB64(args); a = null; }
        else if (args && ArrayBuffer.isView(args)) throw new Error(cmd + ": bytes created in another realm");
        const r = await window.__host(cmd, a === undefined ? null : a, b64, (opts && opts.headers) || null);
        if (r && r.__error) throw r.__error;
        if (r && r.__bytes !== undefined) return fromB64(r.__bytes);
        if (r && r.__url) return (await fetch(r.__url)).arrayBuffer();   // large files (a real model) skip base64
        return r;
      }
    },
    event: { listen: async (ev, cb) => { window.__events[ev] = cb; return () => {}; } }
  };
};

module.exports = { createHost, MOCK, fileStem };
