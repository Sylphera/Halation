// Alpha export test (docs/ARCHITECTURE.md → Export): a layer with soft edges, blurred shadows, antialiased text and
// semi-transparent colours is rendered on a transparent canvas and streamed through encoder.js (FFmpeg) to
// ProRes 4444, WebM VP9 with alpha and a PNG sequence. Each file is composited by FFmpeg over black, white
// and a checkerboard and compared with the same drawing rendered directly over those backgrounds by the canvas.
// A control file with premultiplied colours shows the halo the test would catch.
// Usage: node app/tests/alpha.js   Prints the measured differences (0–255 levels).
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { serve, launch, openApp } = require("./common");
const { createHost } = require("./host");
const { makeFixtures, toolOptions } = require("./fixtures");

let failures = 0;
const ok = (c, msg) => { console.log((c ? "OK   " : "FAIL ") + msg); if (!c) failures++; };
const W = 480, H = 270, N = 10, FPS = 30;
// Limits in levels of 0–255 (measured values are printed; see docs/ARCHITECTURE.md → Export)
const LIMITS = {
  // the canvas itself: 8-bit straight colours read back from its premultiplied pixels
  png: { max: 4, p999: 2, mean: 0.2, edge: 0.4 },
  // 10-bit 4:4:4 with 16-bit alpha: only rounding
  prores4444: { max: 6, p999: 3, mean: 0.3, edge: 0.6 },
  // 4:2:0 chroma: sharp colour edges lose detail (max), soft alpha edges stay clean
  webm: { max: 100, p999: 55, mean: 1.2, edge: 2 }
};

const FX = makeFixtures(), TOOLS = toolOptions(FX);
const ffmpeg = execFileSync("sh", ["-c", "command -v ffmpeg"]).toString().trim();
const host = createHost(FX.TMP, { tools: { ...TOOLS.tools, systemFfmpeg: ffmpeg } });
const OUT = path.join(host.base, "Exports", "Videos", "alpha-test");
fs.mkdirSync(OUT, { recursive: true });

// The layer: drawn by the page on any 2D context (transparent, or over a background for the direct render)
const DRAW = (x, i, W, H) => {
  const t = i / 10;
  x.save();
  const g = x.createRadialGradient(W * 0.3 + t * 40, H * 0.5, 4, W * 0.3 + t * 40, H * 0.5, H * 0.45);
  g.addColorStop(0, "rgba(255,120,40,1)"); g.addColorStop(0.5, "rgba(255,60,160,0.55)"); g.addColorStop(1, "rgba(80,40,255,0)");
  x.fillStyle = g; x.fillRect(0, 0, W, H);
  x.shadowColor = "rgba(0,0,0,.6)"; x.shadowBlur = 18; x.shadowOffsetY = 6;
  x.fillStyle = "rgb(40,200,255)";
  x.beginPath(); x.roundRect(W * 0.55, H * 0.2 + t * 10, W * 0.3, H * 0.45, 24); x.fill();
  x.shadowColor = "transparent";
  x.fillStyle = "rgba(120,255,90,0.5)"; x.fillRect(W * 0.1, H * 0.7, W * 0.5, H * 0.18);
  x.shadowColor = "rgba(0,0,0,.45)"; x.shadowBlur = 8;
  x.translate(W * 0.12, H * 0.32); x.rotate(-0.12 + t * 0.05);
  x.font = "700 38px sans-serif"; x.fillStyle = "rgba(255,255,255,0.92)"; x.fillText("Halation α", 0, 0);
  x.restore();
};
const BACKS = ["black", "white", "checker"];

(async () => {
  const server = serve(), browser = await launch();
  const { page, errors } = await openApp(browser, server, host);
  // Streams the transparent layer to each format and returns the direct renders over each background
  const direct = await page.evaluate(async ({ W, H, N, FPS, OUT, draw, backs }) => {
    const DRAW = eval("(" + draw + ")");
    const E = window.__halEncoder;
    const c = document.createElement("canvas"); c.width = W; c.height = H;
    const x = c.getContext("2d", { willReadFrequently: true });
    const back = (b, ctx) => {
      if (b === "black" || b === "white") { ctx.fillStyle = b === "black" ? "#000" : "#fff"; ctx.fillRect(0, 0, W, H); return; }
      for (let yy = 0; yy < H; yy += 16) for (let xx = 0; xx < W; xx += 16) { ctx.fillStyle = ((xx + yy) / 16) % 2 ? "#999" : "#666"; ctx.fillRect(xx, yy, 16, 16); }
    };
    const encs = {};
    for (const f of ["prores4444", "webm", "png"]) encs[f] = await E.open(f, { file: E.join(OUT, f), width: W, height: H, fps: FPS });
    encs.premult = await E.open("prores4444", { file: E.join(OUT, "premultiplied"), width: W, height: H, fps: FPS });
    const outs = {}; for (const b of backs) outs[b] = [];
    for (let i = 0; i < N; i++) {
      x.clearRect(0, 0, W, H); DRAW(x, i, W, H);
      const px = x.getImageData(0, 0, W, H).data;
      await Promise.all(["prores4444", "webm", "png"].map(f => encs[f].write(px)));
      const pm = new Uint8Array(px.length);
      for (let k = 0; k < px.length; k += 4) { const a = px[k + 3] / 255; pm[k] = Math.round(px[k] * a); pm[k + 1] = Math.round(px[k + 1] * a); pm[k + 2] = Math.round(px[k + 2] * a); pm[k + 3] = px[k + 3]; }
      await encs.premult.write(pm);
      for (const b of backs) {
        x.clearRect(0, 0, W, H); back(b, x); DRAW(x, i, W, H);
        const d = x.getImageData(0, 0, W, H).data, rgb = new Uint8Array(W * H * 3);
        for (let k = 0, j = 0; k < d.length; k += 4) { rgb[j++] = d[k]; rgb[j++] = d[k + 1]; rgb[j++] = d[k + 2]; }
        let s = ""; for (let k = 0; k < rgb.length; k += 0x8000) s += String.fromCharCode.apply(null, rgb.subarray(k, k + 0x8000));
        outs[b].push(btoa(s));
      }
      // the layer's alpha, to find the soft edges
      if (i === 0) { const a = new Uint8Array(W * H); for (let k = 0; k < a.length; k++) a[k] = px[k * 4 + 3]; let s = ""; for (let k = 0; k < a.length; k += 0x8000) s += String.fromCharCode.apply(null, a.subarray(k, k + 0x8000)); outs.alpha0 = btoa(s); }
      back("checker", x);
      if (i === 0) { const d = x.getImageData(0, 0, W, H).data, rgb = new Uint8Array(W * H * 3); for (let k = 0, j = 0; k < d.length; k += 4) { rgb[j++] = d[k]; rgb[j++] = d[k + 1]; rgb[j++] = d[k + 2]; } let s = ""; for (let k = 0; k < rgb.length; k += 0x8000) s += String.fromCharCode.apply(null, rgb.subarray(k, k + 0x8000)); outs.checkerBg = btoa(s); }
    }
    const sizes = {};
    for (const f in encs) sizes[f] = (await encs[f].finish()).size;
    return { outs, sizes };
  }, { W, H, N, FPS, OUT, draw: DRAW.toString(), backs: BACKS });

  const bgFrame = b => b === "black" ? Buffer.alloc(W * H * 3, 0) : b === "white" ? Buffer.alloc(W * H * 3, 255) : Buffer.from(direct.outs.checkerBg, "base64");
  const alpha0 = Buffer.from(direct.outs.alpha0, "base64");
  const input = f => f === "png" ? ["-framerate", String(FPS), "-i", path.join(OUT, "png", "%05d.png")] : ["-i", path.join(OUT, (f === "premult" ? "premultiplied" : f) + (f === "webm" ? ".webm" : ".mov"))];
  // FFmpeg composites the file over the background, as an editor does (straight alpha)
  function composite(f, b) {
    const bgFile = path.join(OUT, `bg-${b}.rgb`);
    fs.writeFileSync(bgFile, Buffer.concat(Array(N).fill(bgFrame(b))));
    const dec = f === "png" ? "format=rgba" : "scale=in_color_matrix=bt709:in_range=tv,format=rgba";
    const codec = f === "webm" ? ["-c:v", "libvpx-vp9"] : [];
    return execFileSync(ffmpeg, ["-v", "error", "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", `${W}x${H}`, "-r", String(FPS), "-i", bgFile, ...codec, ...input(f),
      "-filter_complex", `[1:v]${dec}[f];[0:v]format=gbrp[b];[b][f]overlay=format=rgb:alpha=straight:eof_action=pass,format=rgb24`, "-frames:v", String(N), "-f", "rawvideo", "-"], { maxBuffer: 1 << 28 });
  }
  function compare(got, b) {
    const diffs = [];
    let max = 0, sum = 0, edge = 0, edgeN = 0;
    for (let i = 0; i < N; i++) {
      const ref = Buffer.from(direct.outs[b][i], "base64"), off = i * W * H * 3;
      for (let k = 0; k < ref.length; k++) {
        const d = Math.abs(ref[k] - got[off + k]); if (d > max) max = d; sum += d; diffs.push(d);
        if (i === 0) { const a = alpha0[Math.floor(k / 3)]; if (a > 0 && a < 255) { edge += d; edgeN++; } }
      }
    }
    diffs.sort((a, c) => a - c);
    return { max, mean: sum / diffs.length, p999: diffs[Math.floor(diffs.length * 0.999)], edge: edge / Math.max(1, edgeN) };
  }
  const fmt = r => `max ${r.max}, p99.9 ${r.p999}, mean ${r.mean.toFixed(2)}, soft edges ${r.edge.toFixed(2)}`;
  const report = {};
  for (const f of ["png", "prores4444", "webm"]) {
    for (const b of BACKS) {
      const r = compare(composite(f, b), b), L = LIMITS[f];
      report[f + "/" + b] = r;
      ok(r.max <= L.max && r.p999 <= L.p999 && r.mean <= L.mean && r.edge <= L.edge, `${f} over ${b}: ${fmt(r)} (limits: max ${L.max}, p99.9 ${L.p999}, mean ${L.mean}, edges ${L.edge})`);
    }
  }
  const halo = compare(composite("premult", "white"), "white");
  ok(halo.edge > LIMITS.prores4444.edge * 4, `Control: premultiplied colours read as straight darken the soft edges over white: ${fmt(halo)}`);
  for (const f in direct.sizes) console.log(`     size ${f}: ${(direct.sizes[f] / 1e3).toFixed(0)} kB for ${N} frames of ${W}×${H}`);
  fs.writeFileSync(path.join(process.env.SHOTS || require("os").tmpdir(), "alpha-report.json"), JSON.stringify({ W, H, N, report, halo, sizes: direct.sizes }, null, 2));
  const errs = errors.filter(e => !/favicon/.test(e));
  ok(errs.length === 0, "No console errors" + (errs.length ? ": " + errs.join(" | ") : ""));
  await browser.close(); server.close();
  console.log(failures ? `\n${failures} failed (alpha)` : "\nAll passed (alpha)");
  process.exit(failures ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
