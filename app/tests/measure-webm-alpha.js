// Measures WebM with alpha written by Mediabunny + WebCodecs (in the page) against FFmpeg's libvpx-vp9 (encoder.js
// format "webm"), on the same frames: a transparent layer like alpha.js at 1280×720, 30 fps, 3 s.
// Each file is decoded with the matrix it declares (FFmpeg BT.709, Chromium BT.601), as editors do.
// Reports size, encoding time and the composite over black / white / checkerboard against the canvas.
// Not part of npm test. Usage: node app/tests/measure-webm-alpha.js
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { serve, launch } = require("./common");

const W = 1280, H = 720, FPS = 30, N = 90;
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "webm-alpha-"));
const DRAW = (x, i, W, H) => {
  const t = i / 30;
  x.save();
  const g = x.createRadialGradient(W * 0.3 + t * 80, H * 0.5, 4, W * 0.3 + t * 80, H * 0.5, H * 0.45);
  g.addColorStop(0, "rgba(255,120,40,1)"); g.addColorStop(0.5, "rgba(255,60,160,0.55)"); g.addColorStop(1, "rgba(80,40,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.shadowColor = "rgba(0,0,0,.6)"; x.shadowBlur = 36; x.shadowOffsetY = 12;
  x.fillStyle = "rgb(40,200,255)"; x.beginPath(); x.roundRect(W * 0.55, H * 0.2 + t * 20, W * 0.3, H * 0.45, 40); x.fill();
  x.shadowColor = "rgba(0,0,0,.45)"; x.shadowBlur = 14;
  x.translate(W * 0.12, H * 0.32); x.rotate(-0.12 + t * 0.1);
  x.font = "700 76px sans-serif"; x.fillStyle = "rgba(255,255,255,0.92)"; x.fillText("Halation α", 0, 0);
  x.restore();
};

(async () => {
  const server = serve(), browser = await launch(), page = await browser.newPage();
  await page.goto(`http://localhost:${server.address().port}/visualizer.html`);
  await page.waitForFunction(() => window.Mediabunny);
  const r = await page.evaluate(async ({ W, H, FPS, N, draw }) => {
    const DRAW = eval("(" + draw + ")"), MB = window.Mediabunny;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d", { willReadFrequently: true });
    const toB64 = u => { let s = ""; for (let k = 0; k < u.length; k += 0x8000) s += String.fromCharCode.apply(null, u.subarray(k, k + 0x8000)); return btoa(s); };
    // raw frames for FFmpeg and the direct renders over each background (first, middle and last frame)
    const raw = [], direct = {};
    const back = (b, ctx) => { if (b !== "checker") { ctx.fillStyle = b === "black" ? "#000" : "#fff"; ctx.fillRect(0, 0, W, H); return; } for (let yy = 0; yy < H; yy += 16) for (let xx = 0; xx < W; xx += 16) { ctx.fillStyle = ((xx + yy) / 16) % 2 ? "#999" : "#666"; ctx.fillRect(xx, yy, 16, 16); } };
    for (let i = 0; i < N; i++) {
      x.clearRect(0, 0, W, H); DRAW(x, i, W, H); raw.push(toB64(x.getImageData(0, 0, W, H).data));
      if ([0, 45, 89].includes(i)) for (const b of ["black", "white", "checker"]) { x.clearRect(0, 0, W, H); back(b, x); DRAW(x, i, W, H); const d = x.getImageData(0, 0, W, H).data, rgb = new Uint8Array(W * H * 3); for (let p = 0, q = 0; p < d.length; p += 4) { rgb[q++] = d[p]; rgb[q++] = d[p + 1]; rgb[q++] = d[p + 2]; } (direct[b] = direct[b] || []).push(toB64(rgb)); }
    }
    x.clearRect(0, 0, W, H); back("checker", x);
    { const d = x.getImageData(0, 0, W, H).data, rgb = new Uint8Array(W * H * 3); for (let p = 0, q = 0; p < d.length; p += 4) { rgb[q++] = d[p]; rgb[q++] = d[p + 1]; rgb[q++] = d[p + 2]; } direct.checkerBg = toB64(rgb); }
    // Mediabunny: frames straight from the canvas, VP9 with alpha in WebM
    const results = {};
    for (const [name, quality] of [["high", MB.QUALITY_HIGH], ["veryHigh", MB.QUALITY_VERY_HIGH]]) {
      const target = new MB.BufferTarget(), out = new MB.Output({ format: new MB.WebMOutputFormat(), target });
      const src = new MB.CanvasSource(c, { codec: "vp9", bitrate: quality, alpha: "keep", keyFrameInterval: 2 });
      out.addVideoTrack(src, { frameRate: FPS });
      await out.start();
      const t0 = performance.now();
      for (let i = 0; i < N; i++) { x.clearRect(0, 0, W, H); DRAW(x, i, W, H); await src.add(i / FPS, 1 / FPS); }
      await out.finalize();
      results[name] = { ms: performance.now() - t0, b64: toB64(new Uint8Array(target.buffer)) };
    }
    return { raw, direct, results };
  }, { W, H, FPS, N, draw: DRAW.toString() });
  await browser.close(); server.close();

  const rawFile = path.join(DIR, "frames.rgba");
  fs.writeFileSync(rawFile, Buffer.concat(r.raw.map(b => Buffer.from(b, "base64"))));
  // FFmpeg with the same arguments encoder.js gives the "webm" format
  global.window = { __TAURI__: null }; require("../dist/encoder.js");
  const args = window.__halEncoder.args("webm", { width: W, height: H, fps: FPS }).map(a => a === "pipe:0" ? rawFile : a);
  const t0 = Date.now();
  execFileSync("ffmpeg", ["-v", "error", "-y", ...args, path.join(DIR, "ffmpeg.webm")]);
  const ffms = Date.now() - t0;
  const files = { ffmpeg: path.join(DIR, "ffmpeg.webm") };
  for (const k in r.results) { files["mediabunny-" + k] = path.join(DIR, `mb-${k}.webm`); fs.writeFileSync(files["mediabunny-" + k], Buffer.from(r.results[k].b64, "base64")); }
  const bg = b => b === "black" ? Buffer.alloc(W * H * 3, 0) : b === "white" ? Buffer.alloc(W * H * 3, 255) : null;
  const report = {};
  for (const [name, f] of Object.entries(files)) {
    const stats = [];
    for (const b of ["black", "white", "checker"]) {
      const bgFile = path.join(DIR, `bg-${b}.rgb`);
      fs.writeFileSync(bgFile, Buffer.concat(Array(N).fill(bg(b) || Buffer.from(r.direct.checkerBg, "base64"))));
      const comp = execFileSync("ffmpeg", ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-r", String(FPS), "-i", bgFile, "-c:v", "libvpx-vp9", "-i", f,
        "-filter_complex", `[1:v]scale=in_color_matrix=${name === "ffmpeg" ? "bt709" : "bt601"}:in_range=tv,format=rgba[f];[0:v]format=gbrp[b];[b][f]overlay=format=rgb:alpha=straight,select='eq(n\\,0)+eq(n\\,45)+eq(n\\,89)',format=rgb24`, "-fps_mode", "passthrough", "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
      let max = 0, sum = 0; const n = W * H * 3;
      const per = [];
      r.direct[b].forEach((d64, k) => { const d = Buffer.from(d64, "base64"); let fs = 0; for (let i = 0; i < n; i++) { const v = Math.abs(d[i] - comp[k * n + i]); sum += v; fs += v; if (v > max) max = v; } per.push((fs / n).toFixed(2)); });
      stats.push(`${b}: max ${max}, mean ${(sum / (n * 3)).toFixed(2)} (frames 0/45/89: ${per.join("/")})`);
    }
    const p = JSON.parse(execFileSync("ffprobe", ["-v", "error", "-show_entries", "stream=codec_name:stream_tags=alpha_mode", "-of", "json", f]).toString()).streams[0];
    report[name] = { kB: Math.round(fs.statSync(f).size / 1000), ms: name === "ffmpeg" ? ffms : Math.round(r.results[name.slice(11)].ms), codec: p.codec_name, alpha_mode: (p.tags || {}).alpha_mode, composite: stats.join(" · ") };
  }
  console.log(JSON.stringify(report, null, 1));
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
