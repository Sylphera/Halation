// Streaming export through FFmpeg, shared by every tool (docs/ARCHITECTURE.md → Export). Runs in the main window
// (window.__halEncoder, also window.__hal.encoder): frames rendered by a page go as raw bytes over IPC to
// encode.rs, which feeds them to the stdin of one FFmpeg process per file. Nothing piles up in memory:
// each write waits while FFmpeg's queue is full.
(() => {
"use strict";
const T = window.__TAURI__;
const invoke = T && T.core ? T.core.invoke : () => Promise.reject(new Error("no Tauri"));

// RGB → YUV with the BT.709 matrix in limited range, and the file tagged the same way, so editors and
// players convert it back to the same colours. Straight (not premultiplied) alpha: see docs/ARCHITECTURE.md → Export.
const BT709 = ["-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709"];
const toYUV = pix => ["-vf", `scale=out_color_matrix=bt709:out_range=tv,format=${pix}`];

// bits: estimated bits per pixel and frame (measured on Visualizer layers, see docs/ARCHITECTURE.md → Export);
// alpha: keeps transparency; seq: a folder of numbered images
const FORMATS = {
  prores4444: {
    ext: "mov", alpha: true, label: "ProRes 4444", bits: 2.2,
    out: () => [...toYUV("yuva444p10le"), "-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-alpha_bits", "16", "-vendor", "apl0", ...BT709]
  },
  webm: {
    ext: "webm", alpha: true, label: "WebM VP9", bits: 0.09,
    out: () => [...toYUV("yuva420p"), "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-auto-alt-ref", "0", "-crf", "20", "-b:v", "0", "-row-mt", "1", "-deadline", "good", "-cpu-used", "4", ...BT709]
  },
  h264: {
    ext: "mp4", alpha: false, label: "H.264", bits: 0.06,
    out: o => [...toYUV("yuv420p"), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", String(o.crf == null ? 17 : o.crf), "-preset", "medium", "-movflags", "+faststart", ...BT709]
  },
  png: {
    ext: "png", alpha: true, seq: true, label: "PNG", bits: 3.2,
    out: () => ["-c:v", "png", "-pix_fmt", "rgba"]
  },
  // grayscale values (one small frame per video frame), scaled up to the video size
  gray: {
    ext: "mp4", alpha: false, label: "H.264", bits: 0.002,
    out: o => ["-vf", `scale=${o.width}:${o.height}:flags=neighbor,format=yuv420p`, "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "12", "-preset", "medium", "-movflags", "+faststart", ...BT709]
  },
  wav: { ext: "wav", audio: true, label: "WAV 24-bit", bytesPerSecond: 48000 * 2 * 3, out: () => ["-c:a", "pcm_s24le"] }
};

// Estimated size in bytes of a file: { width, height, fps, seconds }
function estimate(format, o) {
  const f = FORMATS[format];
  if (f.audio) return Math.round(f.bytesPerSecond * o.seconds + 44);
  return Math.round(f.bits / 8 * o.width * o.height * o.fps * o.seconds);
}

// Arguments for FFmpeg (without the output file). input: { pix: "rgba" | "gray", width, height } for video,
// or { audio: true, rate, channels } for interleaved 32-bit float samples.
function args(format, o) {
  const f = FORMATS[format], inp = o.input || {};
  if (f.audio) return ["-f", "f32le", "-ar", String(inp.rate || 48000), "-ac", String(inp.channels || 2), "-i", "pipe:0", ...f.out(o)];
  const pix = inp.pix || "rgba", w = inp.width || o.width, h = inp.height || o.height;
  return ["-f", "rawvideo", "-pix_fmt", pix, "-s", `${w}x${h}`, "-r", String(o.fps), "-i", "pipe:0", ...f.out(o), "-r", String(o.fps)];
}

const live = new Map();   // id → encoder, for the "encode" progress events
if (T && T.event && T.event.listen) T.event.listen("encode", e => { const x = live.get(e.payload.id); if (x) { x.encoded = e.payload.frame; if (x.onProgress) x.onProgress(x.encoded); } }).catch(() => {});

// open(format, { file, width, height, fps, input, onProgress }): file is the output path without extension
// (for a sequence, the folder: images go inside as 00001.png…). Returns an encoder.
async function open(format, o) {
  const f = FORMATS[format];
  if (!f) throw new Error("unknown format " + format);
  const output = f.seq ? `${o.file}${sep(o.file)}%05d.${f.ext}` : `${o.file}.${f.ext}`;
  const inp = o.input || {};
  const frame = !f.audio && (inp.pix || "rgba") === "rgba" ? { width: inp.width || o.width, height: inp.height || o.height, bpp: 4 } : null;
  const r = await invoke("encode_start", { args: args(format, o), output, frame, dir: !!f.seq });
  let failed = null, closed = false;
  const x = {
    id: r.id, path: f.seq ? o.file : r.path, format, encoded: 0, sent: 0, onProgress: o.onProgress || null,
    // bytes: a Uint8Array (from any window) with a whole frame, or with rect {x, y, w, h} of it (the rest is transparent)
    async write(bytes, rect) {
      if (failed) throw failed;
      const u = new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const headers = { "x-id": String(r.id) };
      if (rect) headers["x-rect"] = `${rect.x},${rect.y},${rect.w},${rect.h}`;
      try { await invoke("encode_write", u, { headers }); x.sent++; }
      catch (e) { failed = new Error(String(e && e.message || e)); throw failed; }
    },
    // the same frame again (nothing is sent over IPC)
    async same() {
      if (failed) throw failed;
      try { await invoke("encode_write", new Uint8Array(0), { headers: { "x-id": String(r.id), "x-same": "1" } }); x.sent++; }
      catch (e) { failed = new Error(String(e && e.message || e)); throw failed; }
    },
    async finish() {
      closed = true; live.delete(r.id);
      const res = await invoke("encode_finish", { id: r.id });
      return { path: f.seq ? o.file : res.path, size: res.size };
    },
    async abort() { if (closed) return; closed = true; live.delete(r.id); await invoke("encode_abort", { id: r.id }).catch(() => {}); }
  };
  live.set(r.id, x);
  return x;
}
const sep = p => (/\\/.test(p) ? "\\" : "/");

// Free space on the drive of a folder inside Halation's (or of the Halation folder)
const freeSpace = path => invoke("disk_free", { path: path || null });
// A new folder in Exports\Videos for an export with several files, and its removal (cancel, error)
const folder = async name => { const destination = await window.__shell.exportLocation.destination(name, "layers"); return invoke("export_folder", { name, destination }); };
const removeFolder = path => invoke("export_folder_remove", { path }).catch(() => false);

window.__halEncoder = { FORMATS, estimate, args, open, freeSpace, folder, removeFolder, join: (d, n) => d + sep(d) + n };
})();
